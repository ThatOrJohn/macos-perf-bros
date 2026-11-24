/** Boring mode displays snapshot metrics as labelled values with fixed-width columns. */
import type { Snapshot } from "../core/snapshot.ts";
import type { Color, Frame } from "../engine/canvas.ts";
import { bevel } from "../engine/paint.ts";
import { P } from "../engine/palette.ts";
import { drawHint, drawHud } from "../world/common.ts";

export type Row = [label: string, value: string, color: Color];
export const TABLE_PAGE_SIZE = 15;
export const TABLE_LABEL_WIDTH = 23;
export const TABLE_VALUE_WIDTH = 23;

/** The two renderers share column widths, page boundaries, and truncation. */
export function tableCell(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}.`;
}

export function pageCount(rows: readonly Row[]): number {
  return Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
}

export function pageLabel(page: number, pages: number): string {
  return `PAGE ${page + 1} / ${pages}`;
}

export function tableHint(pages: number): string {
  return pages > 1 ? "PGUP PGDN PAGE  B ART" : "B ART";
}

export function drawTable(f: Frame, snap: Snapshot, title: string, rows: readonly Row[], page: number): void {
  const { canvas: cv } = f;
  cv.px.fill(P.ink);
  bevel(cv, 4, 3, 72, 40, P.hudBg, P.stoneDark, P.stoneDeep);
  cv.hline(5, 74, 6, P.stoneDeep);
  drawHud(f, snap);
  f.centered(40, 1, title, P.accent, P.hudBg, true);
  f.text(7, 3, "METRIC", P.dim, P.hudBg);
  f.text(68, 3, "VALUE", P.dim, P.hudBg);
  const start = page * TABLE_PAGE_SIZE;
  for (const [i, [label, value, color]] of rows.slice(start, start + TABLE_PAGE_SIZE).entries()) {
    const y = i + 5;
    const shown = tableCell(value, TABLE_VALUE_WIDTH);
    f.text(7, y, tableCell(label, TABLE_LABEL_WIDTH), label.startsWith(">") ? P.accent : P.hudFg, P.hudBg);
    f.text(73 - shown.length, y, shown, color, P.hudBg);
  }
  const pages = pageCount(rows);
  if (pages > 1) f.centered(40, 21, pageLabel(page, pages), P.dim, P.hudBg);
  drawHint(f, title === "OVERWORLD" ? "enter open  1-6 jump  q quit" : "esc back  q quit", tableHint(pages));
}
