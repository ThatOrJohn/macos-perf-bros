/**
 * Memoized static layers. A deterministic draw (no time input) runs once into
 * a scratch canvas; the pixels it touched are kept and replayed each frame as
 * row copies. Backdrops (sky gradients, mountains, grass with per-pixel hash
 * noise) were the biggest per-frame cost at idle, and never change.
 *
 * Rules: `key` must capture every argument that affects the output, and the
 * draw must not depend on `t`, the snapshot, or anything mutable.
 */
import { PixelCanvas } from "./canvas.ts";

/** Marks pixels the draw didn't touch. Real colors are 0x000000–0xffffff. */
const UNTOUCHED = -2;

interface Stamp {
  x: number;
  y: number;
  w: number;
  h: number;
  px: Int32Array;
  /** True when every pixel in the box was drawn: replay is plain row copies. */
  opaque: boolean;
}

const stamps = new Map<string, Stamp>();
const scratch = new Map<string, PixelCanvas>();

export function stamped(cv: PixelCanvas, key: string, draw: (target: PixelCanvas) => void): void {
  const size = `${cv.w}x${cv.h}`;
  const id = `${size}|${key}`;
  let s = stamps.get(id);
  if (!s) {
    let sc = scratch.get(size);
    if (!sc) scratch.set(size, (sc = new PixelCanvas(cv.w, cv.h)));
    sc.px.fill(UNTOUCHED);
    draw(sc);
    s = capture(sc);
    stamps.set(id, s);
  }
  replay(cv, s);
}

function capture(sc: PixelCanvas): Stamp {
  let x0 = sc.w, y0 = sc.h, x1 = -1, y1 = -1;
  for (let y = 0; y < sc.h; y++) {
    for (let x = 0; x < sc.w; x++) {
      if (sc.px[y * sc.w + x] === UNTOUCHED) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0, px: new Int32Array(0), opaque: true };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const px = new Int32Array(w * h);
  let opaque = true;
  for (let y = 0; y < h; y++) {
    const row = sc.px.subarray((y0 + y) * sc.w + x0, (y0 + y) * sc.w + x0 + w);
    px.set(row, y * w);
    if (opaque && row.includes(UNTOUCHED)) opaque = false;
  }
  return { x: x0, y: y0, w, h, px, opaque };
}

function replay(cv: PixelCanvas, s: Stamp): void {
  for (let y = 0; y < s.h; y++) {
    const src = y * s.w;
    const dst = (s.y + y) * cv.w + s.x;
    if (s.opaque) {
      cv.px.set(s.px.subarray(src, src + s.w), dst);
      continue;
    }
    for (let x = 0; x < s.w; x++) {
      const c = s.px[src + x]!;
      if (c !== UNTOUCHED) cv.px[dst + x] = c;
    }
  }
}
