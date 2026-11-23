/**
 * Minimal, fast XML property-list parser.
 *
 * Supports the subset Apple's plist DTD defines: dict, array, key, string,
 * integer, real, true, false, date, data. Written by hand (no deps) because
 * powermetrics emits ~375 KB of XML per sample, once per second.
 */

export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | PlistValue[]
  | { [key: string]: PlistValue };

export class PlistParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = "PlistParseError";
  }
}

export function parsePlist(xml: string): PlistValue {
  const start = xml.indexOf("<plist");
  if (start < 0) throw new PlistParseError("no <plist> element", 0);
  const open = xml.indexOf(">", start);
  if (open < 0) throw new PlistParseError("unterminated <plist> tag", start);
  const p = new Parser(xml, open + 1);
  const value = p.value();
  p.expectClose("plist");
  return value;
}

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

class Parser {
  constructor(private readonly s: string, private pos: number) {}

  private skipWs(): void {
    const s = this.s;
    while (this.pos < s.length && WS.has(s.charCodeAt(this.pos))) this.pos++;
  }

  /** Reads `<name>` or `<name/>`; returns [name, selfClosing]. */
  private openTag(): [string, boolean] {
    this.skipWs();
    const s = this.s;
    if (s.charCodeAt(this.pos) !== 0x3c /* < */) throw this.err("expected '<'");
    const end = s.indexOf(">", this.pos);
    if (end < 0) throw this.err("unterminated tag");
    let inner = s.slice(this.pos + 1, end);
    this.pos = end + 1;
    const selfClosing = inner.endsWith("/");
    if (selfClosing) inner = inner.slice(0, -1);
    if (inner.startsWith("/")) throw new PlistParseError(`unexpected closing tag <${inner}>`, end);
    const space = inner.indexOf(" ");
    return [space < 0 ? inner : inner.slice(0, space), selfClosing];
  }

  expectClose(name: string): void {
    this.skipWs();
    const tag = `</${name}>`;
    if (!this.s.startsWith(tag, this.pos)) throw this.err(`expected ${tag}`);
    this.pos += tag.length;
  }

  private peekClose(name: string): boolean {
    this.skipWs();
    return this.s.startsWith(`</${name}>`, this.pos);
  }

  /** Text content up to the closing tag of `name`. */
  private text(name: string): string {
    const tag = `</${name}>`;
    const end = this.s.indexOf(tag, this.pos);
    if (end < 0) throw this.err(`expected ${tag}`);
    const raw = this.s.slice(this.pos, end);
    this.pos = end + tag.length;
    return raw.includes("&") ? decodeEntities(raw) : raw;
  }

  value(): PlistValue {
    const at = this.pos;
    const [name, selfClosing] = this.openTag();
    switch (name) {
      case "dict": {
        const out: { [key: string]: PlistValue } = {};
        if (selfClosing) return out;
        while (!this.peekClose("dict")) {
          const [k, kSelf] = this.openTag();
          if (k !== "key") throw this.err(`expected <key> in dict, got <${k}>`);
          const key = kSelf ? "" : this.text("key");
          out[key] = this.value();
        }
        this.expectClose("dict");
        return out;
      }
      case "array": {
        const out: PlistValue[] = [];
        if (selfClosing) return out;
        while (!this.peekClose("array")) out.push(this.value());
        this.expectClose("array");
        return out;
      }
      case "string":
        return selfClosing ? "" : this.text("string");
      case "integer":
      case "real": {
        const t = selfClosing ? "" : this.text(name).trim();
        const n = name === "integer" ? Number.parseInt(t, 10) : Number.parseFloat(t);
        if (Number.isNaN(n) && !/^(nan|[+-]?inf)/i.test(t)) {
          throw new PlistParseError(`bad <${name}> value ${JSON.stringify(t)}`, at);
        }
        return n;
      }
      case "true":
      case "false":
        if (!selfClosing) this.expectClose(name);
        return name === "true";
      case "date":
        return new Date(selfClosing ? Number.NaN : this.text("date").trim());
      case "data":
        // Base64 payload; powermetrics doesn't emit these. Kept as a string.
        return selfClosing ? "" : this.text("data").replace(/\s+/g, "");
      default:
        throw new PlistParseError(`unsupported plist element <${name}>`, at);
    }
  }

  private err(msg: string): PlistParseError {
    return new PlistParseError(msg, this.pos);
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return NAMED[e] ?? m;
  });
}

/**
 * Splits a byte stream on NUL (0x00) separators, as powermetrics' plist output
 * format uses between samples. Bytes are split before decoding so multi-byte
 * UTF-8 sequences are never cut.
 */
export class NulSplitter {
  private pending: Uint8Array[] = [];
  private pendingLen = 0;
  private readonly decoder = new TextDecoder();

  /** Feed a chunk; returns every complete record it finished (may be empty). */
  push(chunk: Uint8Array): string[] {
    const out: string[] = [];
    let from = 0;
    for (let i = chunk.indexOf(0); i >= 0; i = chunk.indexOf(0, from)) {
      this.append(chunk.subarray(from, i));
      const rec = this.take();
      if (rec.trim()) out.push(rec);
      from = i + 1;
    }
    this.append(chunk.subarray(from));
    return out;
  }

  /** Whatever is buffered after the stream ends (a final record without a trailing NUL). */
  flush(): string | undefined {
    const rec = this.take();
    return rec.trim() ? rec : undefined;
  }

  private append(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.pending.push(bytes.slice()); // copy: caller may reuse its buffer
    this.pendingLen += bytes.length;
  }

  private take(): string {
    const buf = new Uint8Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) {
      buf.set(p, o);
      o += p.length;
    }
    this.pending = [];
    this.pendingLen = 0;
    return this.decoder.decode(buf);
  }
}
