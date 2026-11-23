/**
 * Pixel-art painting helpers for the hi-res renderer: ordered dithering,
 * bevelled shapes, brick/plank textures, circles, and automatic ink outlines.
 */
import { PixelCanvas, mix, type Color, type Sprite } from "./canvas.ts";

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Ordered-dither threshold for a pixel, in (0, 1). */
export const bayer = (x: number, y: number) => BAYER4[(y & 3) * 4 + (x & 3)]!;

/** Pick a or b by dithering at mix level t (0 = all a, 1 = all b). */
export const dither = (x: number, y: number, a: Color, b: Color, t: number): Color => (t > bayer(x, y) ? b : a);

/** NES-style banded gradient: stops are discrete colors, blended only by ordered dither. */
export function ditherGradientV(cv: PixelCanvas, x: number, y0: number, w: number, y1: number, stops: Color[]): void {
  const n = stops.length - 1;
  for (let y = y0; y < y1; y++) {
    const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * n;
    const i = Math.min(n - 1, Math.floor(t));
    const f = t - i;
    // compress the dither band so most of each stop is solid
    const k = Math.min(1, Math.max(0, (f - 0.35) / 0.3));
    for (let xx = x; xx < x + w; xx++) cv.set(xx, y, dither(xx, y, stops[i]!, stops[i + 1]!, k));
  }
}

/** Filled rect with 1 px highlight on top/left and shadow on bottom/right. */
export function bevel(cv: PixelCanvas, x: number, y: number, w: number, h: number, base: Color, light: Color, dark: Color): void {
  cv.rect(x, y, w, h, base);
  cv.hline(x, x + w - 1, y, light);
  cv.vline(x, y, y + h - 1, light);
  cv.hline(x, x + w - 1, y + h - 1, dark);
  cv.vline(x + w - 1, y, y + h - 1, dark);
}

export interface BrickStyle { base: Color; light: Color; dark: Color; mortar: Color }

/** Running-bond bricks with per-brick bevel and slight variation. */
export function bricks(cv: PixelCanvas, x: number, y: number, w: number, h: number, s: BrickStyle, bw = 8, bh = 4, seed = 0): void {
  for (let yy = 0; yy < h; yy++) {
    const row = Math.floor(yy / bh);
    const off = row % 2 ? Math.floor(bw / 2) : 0;
    const ry = yy % bh;
    for (let xx = 0; xx < w; xx++) {
      const bx = (xx + off) % bw;
      let c: Color;
      if (ry === bh - 1 || bx === bw - 1) c = s.mortar;
      else if (ry === 0 || bx === 0) c = s.light;
      else if (ry === bh - 2 && bx >= bw - 3) c = s.dark;
      else {
        const id = Math.floor((xx + off) / bw) * 31 + row * 17 + seed;
        c = ((id * 2654435761) >>> 0) % 7 === 0 ? s.dark : s.base;
      }
      cv.set(x + xx, y + yy, c);
    }
  }
}

/** Vertical planks / corrugated panels. */
export function planks(cv: PixelCanvas, x: number, y: number, w: number, h: number, base: Color, light: Color, dark: Color, pw = 4): void {
  for (let xx = 0; xx < w; xx++) {
    const px = xx % pw;
    const c = px === 0 ? light : px === pw - 1 ? dark : base;
    cv.rect(x + xx, y, 1, h, c);
  }
}

export function disc(cv: PixelCanvas, cx: number, cy: number, r: number, c: Color): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) cv.set(cx + x, cy + y, c);
}

export function ring(cv: PixelCanvas, cx: number, cy: number, r: number, c: Color): void {
  for (let a = 0; a < 360; a += 3) {
    const rad = (a * Math.PI) / 180;
    cv.set(Math.round(cx + Math.cos(rad) * r), Math.round(cy + Math.sin(rad) * r), c);
  }
}

export function line(cv: PixelCanvas, x0: number, y0: number, x1: number, y1: number, c: Color): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) cv.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
}

/** A transparent drawing layer that tracks the bounding box of what was drawn. */
class Layer extends PixelCanvas {
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  busy = false;
  constructor(w: number, h: number) {
    super(w, h);
    this.px.fill(-1);
  }
  private grow(x0: number, y0: number, x1: number, y1: number): void {
    this.x0 = Math.min(this.x0, Math.max(0, x0));
    this.y0 = Math.min(this.y0, Math.max(0, y0));
    this.x1 = Math.max(this.x1, Math.min(this.w - 1, x1));
    this.y1 = Math.max(this.y1, Math.min(this.h - 1, y1));
  }
  override set(x: number, y: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
    this.grow(x, y, x, y);
  }
  override rect(x: number, y: number, w: number, h: number, c: Color): void {
    super.rect(x, y, w, h, c);
    if (w > 0 && h > 0) this.grow(Math.floor(x), Math.floor(y), Math.floor(x + w) - 1, Math.floor(y + h) - 1);
  }
  /** Clear only the touched area and reset the bounds. */
  reset(): void {
    if (this.x1 >= this.x0) for (let y = this.y0; y <= this.y1; y++) this.px.fill(-1, y * this.w + this.x0, y * this.w + this.x1 + 1);
    this.x0 = this.y0 = Infinity;
    this.x1 = this.y1 = -Infinity;
  }
}

const layers = new Map<string, Layer>();

/**
 * Draw into a transparent layer, then composite it with a 1 px outline around
 * every opaque pixel — the crisp NES "ink line" look for procedural shapes.
 * Only the drawn bounding box is scanned, and layers are reused.
 */
export function outlined(cv: PixelCanvas, ink: Color, draw: (layer: PixelCanvas) => void): void {
  const key = `${cv.w}x${cv.h}`;
  let layer = layers.get(key);
  if (!layer) layers.set(key, (layer = new Layer(cv.w, cv.h)));
  if (layer.busy) layer = new Layer(cv.w, cv.h); // nested call: don't share the pooled layer
  layer.busy = true;
  try {
    draw(layer);
  } finally {
    layer.busy = false;
  }
  if (layer.x1 < layer.x0) return;
  const { w, h, px } = layer;
  const xa = Math.max(0, layer.x0 - 1);
  const xb = Math.min(w - 1, layer.x1 + 1);
  const ya = Math.max(0, layer.y0 - 1);
  const yb = Math.min(h - 1, layer.y1 + 1);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const i = y * w + x;
      const v = px[i]!;
      if (v >= 0) {
        cv.px[i] = v;
        continue;
      }
      if ((x > 0 && px[i - 1]! >= 0) || (x < w - 1 && px[i + 1]! >= 0) ||
          (y > 0 && px[i - w]! >= 0) || (y < h - 1 && px[i + w]! >= 0)) cv.px[i] = ink;
    }
  }
  layer.reset();
}

/** Blit a sprite with an automatic ink outline. */
export function blitOutlined(cv: PixelCanvas, s: Sprite, x: number, y: number, ink: Color, flipX = false): void {
  outlined(cv, ink, (l) => l.blit(s, x, y, { flipX }));
}

/** Soft glow: dithered halo of `c` over existing pixels within radius r. */
export function glow(cv: PixelCanvas, cx: number, cy: number, r: number, c: Color, strength = 0.6): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y) / r;
      if (d > 1) continue;
      const px = cx + x;
      const py = cy + y;
      if (px < 0 || py < 0 || px >= cv.w || py >= cv.h) continue;
      const t = (1 - d) * strength;
      if (t > bayer(px, py)) cv.set(px, py, mix(cv.get(px, py), c, 0.5));
    }
  }
}

// ---------------------------------------------------------------- locked tiles

let lockSaved = new Int32Array(0);

/**
 * Draw with `draw`, then dim only the pixels it changed inside the box by a
 * 50% checker toward `toward`. Used for zones whose data is unavailable
 * (no sudo) so they read as locked, not broken. Surroundings stay untouched.
 * The save buffer grows once and is reused.
 */
export function drawDimmed(cv: PixelCanvas, x: number, y: number, w: number, h: number, toward: Color, draw: () => void): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(cv.w, x + w);
  const y1 = Math.min(cv.h, y + h);
  const bw = x1 - x0;
  if (bw <= 0 || y1 <= y0) return draw();
  if (lockSaved.length < bw * (y1 - y0)) lockSaved = new Int32Array(bw * (y1 - y0));
  for (let yy = y0; yy < y1; yy++) lockSaved.set(cv.px.subarray(yy * cv.w + x0, yy * cv.w + x1), (yy - y0) * bw);
  draw();
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = yy * cv.w + xx;
      if ((xx + yy) & 1 && cv.px[i] !== lockSaved[(yy - y0) * bw + xx - x0]) cv.px[i] = toward;
    }
  }
}
