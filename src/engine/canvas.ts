/**
 * Renderer-agnostic pixel canvas + frame description.
 *
 * Scenes draw into a fixed logical screen: 80 columns × 24 rows of terminal
 * cells, where row 0 is the text HUD and rows 1–23 hold an 80×46 pixel canvas
 * (two "pixels" per cell via half-block characters). Presenters (OpenTUI, PNG)
 * scale that up as space allows.
 */

export const SCREEN_COLS = 80;
export const SCREEN_ROWS = 24;
export const CANVAS_W = 80;
export const CANVAS_H = 46; // (SCREEN_ROWS - 1) * 2
export const CANVAS_ROW0 = 1; // screen row where the canvas starts

/** 0xRRGGBB */
export type Color = number;

export const rgb = (r: number, g: number, b: number): Color =>
  ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);

export const r8 = (c: Color) => (c >> 16) & 255;
export const g8 = (c: Color) => (c >> 8) & 255;
export const b8 = (c: Color) => c & 255;

/** Linear blend from a to b, t in 0..1. */
export function mix(a: Color, b: Color, t: number): Color {
  const k = Math.min(1, Math.max(0, t));
  return rgb(
    Math.round(r8(a) + (r8(b) - r8(a)) * k),
    Math.round(g8(a) + (g8(b) - g8(a)) * k),
    Math.round(b8(a) + (b8(b) - b8(a)) * k),
  );
}

export class PixelCanvas {
  readonly px: Int32Array;
  constructor(readonly w = CANVAS_W, readonly h = CANVAS_H) {
    this.px = new Int32Array(w * h);
  }

  get(x: number, y: number): Color {
    return this.px[y * this.w + x] ?? 0;
  }

  set(x: number, y: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w));
    const y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.w + x0, yy * this.w + x1);
  }

  hline(x0: number, x1: number, y: number, c: Color): void {
    this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c);
  }

  vline(x: number, y0: number, y1: number, c: Color): void {
    this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c);
  }

  /** Vertical gradient between two colors over [y0, y1). */
  vgradient(y0: number, y1: number, top: Color, bottom: Color): void {
    for (let y = y0; y < y1; y++) this.rect(0, y, this.w, 1, mix(top, bottom, (y - y0) / Math.max(1, y1 - y0 - 1)));
  }

  blit(s: Sprite, x: number, y: number, opts: { flipX?: boolean; tint?: (c: Color) => Color } = {}): void {
    x = Math.floor(x);
    y = Math.floor(y);
    for (let sy = 0; sy < s.h; sy++) {
      for (let sx = 0; sx < s.w; sx++) {
        const c = s.px[sy * s.w + (opts.flipX ? s.w - 1 - sx : sx)]!;
        if (c >= 0) this.set(x + sx, y + sy, opts.tint ? opts.tint(c) : c);
      }
    }
  }
}

// ---------------------------------------------------------------- sprites

export interface Sprite {
  w: number;
  h: number;
  /** Color per pixel, -1 = transparent. */
  px: Int32Array;
}

/**
 * Build a sprite from readable rows. Each character is looked up in `key`;
 * '.' and ' ' are transparent.
 *
 *   sprite([".aa.", "abba"], { a: P.stone, b: P.white })
 */
export function sprite(rows: string[], key: Record<string, Color>): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const px = new Int32Array(w * h).fill(-1);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === "." || ch === " ") continue;
      const c = key[ch];
      if (c === undefined) throw new Error(`sprite: no color for '${ch}'`);
      px[y * w + x] = c;
    }
  });
  return { w, h, px };
}

// ---------------------------------------------------------------- frame

export interface TextRun {
  col: number;           // screen column (0–79)
  row: number;           // screen row (0–23); row 0 is the HUD
  text: string;
  fg: Color;
  bg?: Color;            // omitted = draw over whatever pixels are there
  bold?: boolean;
}

export class Frame {
  readonly canvas = new PixelCanvas();
  readonly texts: TextRun[] = [];
  hudBg: Color = 0;

  /** Clear for reuse, so a frame can be redrawn without allocating (AGENTS.md rule 7). */
  reset(): this {
    this.canvas.px.fill(0);
    this.texts.length = 0;
    this.hudBg = 0;
    return this;
  }

  text(col: number, row: number, text: string, fg: Color, bg?: Color, bold?: boolean): void {
    this.texts.push({ col, row, text, fg, bg, bold });
  }

  /** Text horizontally centered on a column. */
  centered(centerCol: number, row: number, text: string, fg: Color, bg?: Color, bold?: boolean): void {
    this.text(Math.round(centerCol - text.length / 2), row, text, fg, bg, bold);
  }

  /** Screen row that a canvas pixel row falls in. */
  static rowOf(py: number): number {
    return CANVAS_ROW0 + Math.floor(py / 2);
  }
}
