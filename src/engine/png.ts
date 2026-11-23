/**
 * Renders a Frame to PNG, approximating how it looks in a terminal:
 * cells are 8×16 px, each canvas pixel is an 8×8 block, and text uses a small
 * built-in 3×5 bitmap font (uppercase only), scaled 2×.
 *
 * For design review and docs; the terminal is the real target.
 */
import { deflateSync } from "node:zlib";
import { CANVAS_ROW0, CANVAS_H, CANVAS_W, Frame, SCREEN_COLS, SCREEN_ROWS, type Color } from "./canvas.ts";

const CW = 8;
const CH = 16;

// 3×5 glyphs, rows top→bottom separated by '/', '#' = on.
const FONT_SRC: Record<string, string> = {
  A: ".#./#.#/###/#.#/#.#", B: "##./#.#/##./#.#/##.", C: ".##/#../#../#../.##", D: "##./#.#/#.#/#.#/##.",
  E: "###/#../##./#../###", F: "###/#../##./#../#..", G: ".##/#../#.#/#.#/.##", H: "#.#/#.#/###/#.#/#.#",
  I: "###/.#./.#./.#./###", J: "..#/..#/..#/#.#/.#.", K: "#.#/#.#/##./#.#/#.#", L: "#../#../#../#../###",
  M: "#.#/###/###/#.#/#.#", N: "##./#.#/#.#/#.#/#.#", O: ".#./#.#/#.#/#.#/.#.", P: "##./#.#/##./#../#..",
  Q: ".#./#.#/#.#/##./.##", R: "##./#.#/##./#.#/#.#", S: ".##/#../.#./..#/##.", T: "###/.#./.#./.#./.#.",
  U: "#.#/#.#/#.#/#.#/###", V: "#.#/#.#/#.#/#.#/.#.", W: "#.#/#.#/###/###/#.#", X: "#.#/#.#/.#./#.#/#.#",
  Y: "#.#/#.#/.#./.#./.#.", Z: "###/..#/.#./#../###",
  "0": "###/#.#/#.#/#.#/###", "1": ".#./##./.#./.#./###", "2": "##./..#/.#./#../###", "3": "##./..#/.#./..#/##.",
  "4": "#.#/#.#/###/..#/..#", "5": "###/#../##./..#/##.", "6": ".##/#../###/#.#/###", "7": "###/..#/.#./.#./.#.",
  "8": "###/#.#/###/#.#/###", "9": "###/#.#/###/..#/##.",
  "%": "#.#/..#/.#./#../#.#", ".": ".../.../.../.../.#.", ":": ".../.#./.../.#./...", "/": "..#/..#/.#./#../#..",
  "-": ".../.../###/.../...", "+": ".../.#./###/.#./...", "(": ".#./#../#../#../.#.", ")": ".#./..#/..#/..#/.#.",
  "[": "##./#../#../#../##.", "]": ".##/..#/..#/..#/.##", "<": "..#/.#./#../.#./..#", ">": "#../.#./..#/.#./#..",
  "?": "##./..#/.#./.../.#.", "!": ".#./.#./.#./.../.#.", "'": ".#./.#./.../.../...", "=": ".../###/.../###/...",
  "_": ".../.../.../.../###", ",": ".../.../.../.#./#..", "*": "#.#/.#./#.#/.../...", "#": "#.#/###/#.#/###/#.#",
  "↑": ".#./###/.#./.#./.#.", "↓": ".#./.#./.#./###/.#.", "←": ".#./#../###/#../.#.", "→": ".#./..#/###/..#/.#.",
  "⏎": "..#/..#/#.#/###/#..", "♥": "#.#/###/###/.#./...", "·": ".../.../.#./.../...", "×": ".../#.#/.#./#.#/...",
  "│": ".#./.#./.#./.#./.#.", "▸": "#../##./###/##./#..", "█": "###/###/###/###/###", "░": "#.#/.#./#.#/.#./#.#",
  "⚠": ".#./.#./#.#/###/###",
};
const FONT: Record<string, string> = Object.fromEntries(
  Object.entries(FONT_SRC).map(([k, v]) => [k, v.replaceAll("/", "")]),
);

function glyph(ch: string): string | undefined {
  return FONT[ch.toUpperCase()];
}

export function frameToRgb(frame: Frame): { w: number; h: number; data: Uint8Array } {
  const w = SCREEN_COLS * CW;
  const h = SCREEN_ROWS * CH;
  const data = new Uint8Array(w * h * 3);
  const put = (x: number, y: number, c: Color) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    data[i] = (c >> 16) & 255;
    data[i + 1] = (c >> 8) & 255;
    data[i + 2] = c & 255;
  };
  const fill = (x: number, y: number, ww: number, hh: number, c: Color) => {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) put(xx, yy, c);
  };

  fill(0, 0, w, CH, frame.hudBg);
  for (let y = 0; y < CANVAS_H; y++) {
    for (let x = 0; x < CANVAS_W; x++) fill(x * CW, CANVAS_ROW0 * CH + y * (CH / 2), CW, CH / 2, frame.canvas.get(x, y));
  }

  for (const t of frame.texts) {
    for (let i = 0; i < t.text.length; i++) {
      const cx = (t.col + i) * CW;
      const cy = t.row * CH;
      if (t.bg !== undefined) fill(cx, cy, CW, CH, t.bg);
      const ch = t.text[i]!;
      if (ch === " ") continue;
      const g = glyph(ch);
      if (!g) {
        fill(cx + 2, cy + 4, 4, 8, t.fg); // unknown glyph: block
        continue;
      }
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (g[gy * 3 + gx] === "#") fill(cx + 1 + gx * 2, cy + 3 + gy * 2, 2, 2, t.fg);
        }
      }
    }
  }
  return { w, h, data };
}

// ---------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

export function encodePng(w: number, h: number, rgbData: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    raw.set(rgbData.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolor RGB
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function frameToPng(frame: Frame): Uint8Array {
  const { w, h, data } = frameToRgb(frame);
  return encodePng(w, h, data);
}

/** Encode a pixel canvas directly (hi-res renderer), nearest-neighbor scaled. */
export function canvasToPng(cv: { w: number; h: number; get(x: number, y: number): Color }, scale = 2): Uint8Array {
  const w = cv.w * scale;
  const h = cv.h * scale;
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cv.get(Math.floor(x / scale), Math.floor(y / scale));
      const i = (y * w + x) * 3;
      data[i] = (c >> 16) & 255;
      data[i + 1] = (c >> 8) & 255;
      data[i + 2] = c & 255;
    }
  }
  return encodePng(w, h, data);
}
