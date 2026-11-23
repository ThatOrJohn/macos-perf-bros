import { describe, expect, test } from "bun:test";
import { NulSplitter, PlistParseError, parsePlist } from "../src/collectors/plist.ts";

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${body}\n</plist>\n`;

describe("parsePlist", () => {
  test("scalars", () => {
    expect(parsePlist(wrap("<integer>-42</integer>"))).toBe(-42);
    expect(parsePlist(wrap("<real>2173.79</real>"))).toBe(2173.79);
    expect(parsePlist(wrap("<real>1.5e3</real>"))).toBe(1500);
    expect(parsePlist(wrap("<true/>"))).toBe(true);
    expect(parsePlist(wrap("<false/>"))).toBe(false);
    expect(parsePlist(wrap("<string>hi there</string>"))).toBe("hi there");
    expect(parsePlist(wrap("<string/>"))).toBe("");
  });

  test("date", () => {
    const d = parsePlist(wrap("<date>2026-11-23T17:31:03Z</date>"));
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).toISOString()).toBe("2026-11-23T17:31:03.000Z");
  });

  test("entities", () => {
    expect(parsePlist(wrap("<string>a &amp; b &lt;c&gt; &#65;&#x42;</string>"))).toBe("a & b <c> AB");
  });

  test("nested dict and array, empty containers", () => {
    const v = parsePlist(
      wrap(`<dict>
        <key>name</key><string>E-Cluster</string>
        <key>cpus</key>
        <array>
          <dict><key>cpu</key><integer>0</integer></dict>
          <dict/>
        </array>
        <key>empty</key><array/>
      </dict>`),
    );
    expect(v).toEqual({ name: "E-Cluster", cpus: [{ cpu: 0 }, {}], empty: [] });
  });

  test("errors on malformed input", () => {
    expect(() => parsePlist("<dict></dict>")).toThrow(PlistParseError);
    expect(() => parsePlist(wrap("<dict><key>a</key>"))).toThrow(PlistParseError);
    expect(() => parsePlist(wrap("<integer>abc</integer>"))).toThrow(PlistParseError);
    expect(() => parsePlist(wrap("<blob>x</blob>"))).toThrow(PlistParseError);
  });
});

describe("NulSplitter", () => {
  const enc = new TextEncoder();

  test("splits records across arbitrary chunk boundaries", () => {
    const records = ["first é record", "second 🍄 record", "third"];
    const bytes = enc.encode(records.join("\0") + "\0");
    // Every possible split point, including inside multi-byte characters.
    for (let cut = 0; cut <= bytes.length; cut++) {
      const s = new NulSplitter();
      const out = [...s.push(bytes.subarray(0, cut)), ...s.push(bytes.subarray(cut))];
      expect(out).toEqual(records);
      expect(s.flush()).toBeUndefined();
    }
  });

  test("byte-at-a-time", () => {
    const s = new NulSplitter();
    const out: string[] = [];
    for (const b of enc.encode("a\0bc\0")) out.push(...s.push(Uint8Array.of(b)));
    expect(out).toEqual(["a", "bc"]);
  });

  test("ignores blank records and flushes a trailing record without NUL", () => {
    const s = new NulSplitter();
    expect(s.push(enc.encode("\0\n\0a\0tail"))).toEqual(["a"]);
    expect(s.flush()).toBe("tail");
    expect(s.flush()).toBeUndefined();
  });
});
