/**
 * Presents a Frame in the terminal through OpenTUI using half-block cells:
 * each cell draws '▀' with fg = upper pixel and bg = lower pixel.
 *
 * The 80×24 logical screen is scaled by the largest integer factor that fits
 * and centered.
 */
import { RGBA, Renderable, type OptimizedBuffer, type RenderContext } from "@opentui/core";
import { CANVAS_H, CANVAS_ROW0, CANVAS_W, Frame, SCREEN_COLS, SCREEN_ROWS, type Color } from "./canvas.ts";

const BOLD = 1; // OpenTUI TextAttributes.BOLD

const cache = new Map<Color, RGBA>();
function rgba(c: Color): RGBA {
  let v = cache.get(c);
  if (!v) {
    v = RGBA.fromInts((c >> 16) & 255, (c >> 8) & 255, c & 255, 255);
    cache.set(c, v);
  }
  return v;
}

export function fitScale(cols: number, rows: number): number {
  return Math.max(1, Math.min(Math.floor(cols / SCREEN_COLS), Math.floor(rows / SCREEN_ROWS)));
}

export class PixelView extends Renderable {
  frame: Frame = new Frame();
  /** Shown instead of the game when the terminal is below 80×24. */
  private tooSmall = false;

  constructor(ctx: RenderContext) {
    super(ctx, { id: "pixel-view", width: "100%", height: "100%" });
  }

  protected override renderSelf(buf: OptimizedBuffer): void {
    const cols = this.width;
    const rows = this.height;
    const black = rgba(0x000000);
    buf.fillRect(this.x, this.y, cols, rows, black);

    this.tooSmall = cols < SCREEN_COLS || rows < SCREEN_ROWS;
    if (this.tooSmall) {
      const msg = `Make the terminal at least ${SCREEN_COLS}×${SCREEN_ROWS} (now ${cols}×${rows})`;
      buf.drawText(msg, this.x + Math.max(0, Math.floor((cols - msg.length) / 2)), this.y + Math.floor(rows / 2), rgba(0xffd23f));
      return;
    }

    const s = fitScale(cols, rows);
    const ox = this.x + Math.floor((cols - SCREEN_COLS * s) / 2);
    const oy = this.y + Math.floor((rows - SCREEN_ROWS * s) / 2);
    const f = this.frame;
    const cv = f.canvas;

    // HUD band (row 0, s rows tall)
    buf.fillRect(ox, oy, SCREEN_COLS * s, s, rgba(f.hudBg));

    // canvas: physical half-pixel rows = CANVAS_H * s, each maps back to a logical pixel row
    const cellRows = (CANVAS_H * s) / 2;
    for (let cy = 0; cy < cellRows; cy++) {
      const yTop = Math.floor((cy * 2) / s);
      const yBot = Math.floor((cy * 2 + 1) / s);
      const sy = oy + CANVAS_ROW0 * s + cy;
      for (let px = 0; px < CANVAS_W * s; px++) {
        const lx = Math.floor(px / s);
        buf.setCell(ox + px, sy, "▀", rgba(cv.get(lx, yTop)), rgba(cv.get(lx, yBot)));
      }
    }

    // text runs: positioned on the scaled grid, drawn at normal size
    for (const t of f.texts) {
      const x = ox + t.col * s;
      const y = oy + t.row * s;
      if (t.bg !== undefined) {
        buf.drawText(t.text, x, y, rgba(t.fg), rgba(t.bg), t.bold ? BOLD : 0);
      } else {
        // Draw over pixels: use the pixel color under each char as its background.
        for (let i = 0; i < t.text.length; i++) {
          const col = t.col + i / s;
          const lx = Math.min(CANVAS_W - 1, Math.floor(col));
          const cy = (t.row - CANVAS_ROW0) * s; // physical canvas cell row the text sits on
          const under = t.row === 0 ? f.hudBg : cv.get(lx, Math.min(CANVAS_H - 1, Math.floor((cy * 2 + 1) / s)));
          buf.drawText(t.text[i]!, x + i, y, rgba(t.fg), rgba(under), t.bold ? BOLD : 0);
        }
      }
    }
  }
}
