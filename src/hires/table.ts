/** Bitmap rendering of the same snapshot metrics, columns, and pages as half-block. */
import type { Snapshot } from "../core/snapshot.ts";
import type { PixelCanvas } from "../engine/canvas.ts";
import { drawText, drawTextCentered, drawTextRight } from "../engine/font5x7.ts";
import { bevel } from "../engine/paint.ts";
import { P } from "../engine/palette.ts";
import { TABLE_LABEL_WIDTH, TABLE_PAGE_SIZE, TABLE_VALUE_WIDTH, pageCount, pageLabel, tableCell, tableHint, type Row } from "../ui/table.ts";
import { W, drawHintHi, drawHudHi } from "./common.ts";

export function drawTableHi(cv: PixelCanvas, snap: Snapshot, title: string, rows: readonly Row[], page: number): void {
  cv.px.fill(P.ink);
  bevel(cv, 6, 25, W - 12, 154, P.hudBg, P.stoneDark, P.stoneDeep);
  cv.hline(7, W - 8, 38, P.stoneDeep);
  drawHudHi(cv, snap);
  drawTextCentered(cv, W / 2, 14, title, P.accent);
  drawText(cv, 15, 29, "METRIC", P.dim);
  drawTextRight(cv, W - 15, 29, "VALUE", P.dim);
  const start = page * TABLE_PAGE_SIZE;
  for (const [i, [label, value, color]] of rows.slice(start, start + TABLE_PAGE_SIZE).entries()) {
    const y = 42 + i * 8;
    drawText(cv, 15, y, tableCell(label, TABLE_LABEL_WIDTH), label.startsWith(">") ? P.accent : P.hudFg);
    drawTextRight(cv, W - 15, y, tableCell(value, TABLE_VALUE_WIDTH), color);
  }
  const pages = pageCount(rows);
  if (pages > 1) drawTextCentered(cv, W / 2, 167, pageLabel(page, pages), P.dim);
  drawHintHi(cv, title === "OVERWORLD" ? "ENTER OPEN  1-6 JUMP  Q QUIT" : "ESC BACK  Q QUIT", tableHint(pages));
}
