import type { Frame } from "../../engine/canvas.ts";
import { ditherGradientV } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { PLAYER, drawGrass, drawLockedPanel, drawHint, drawHud, drawStars, type DrawCtx } from "../common.ts";

/**
 * Stand-in for zones that aren't built yet. When the zone's data needs sudo
 * and is missing, the locked panel replaces the sign.
 */
export function drawPlaceholderZone(f: Frame, ctx: DrawCtx, name: string, locked = false): void {
  const cv = f.canvas;
  ditherGradientV(cv, 0, 0, 80, 34, [0x111630, 0x1b2347, 0x29356a, 0x3d4f88]);
  drawStars(cv, 20, ctx.t);
  drawGrass(cv, 34, 46);
  if (locked) {
    drawLockedPanel(f);
    cv.blit(PLAYER[Math.floor(ctx.t * 2) % 2]!, 64, 36);
    f.centered(40, 1, name, P.accent, undefined, true);
    drawHud(f, ctx.snap);
    drawHint(f, "esc back  q quit", "no data without sudo");
    return;
  }
  // sign post
  cv.vline(38, 22, 33, P.woodDark);
  cv.vline(41, 22, 33, P.woodDark);
  cv.rect(28, 14, 24, 9, P.wood);
  cv.hline(28, 51, 14, P.path);
  cv.blit(PLAYER[Math.floor(ctx.t * 2) % 2]!, 44, 26);
  f.centered(40, 1, name, P.accent, undefined, true);
  f.centered(40, 9, "UNDER", P.ink, P.wood, true);
  f.centered(40, 10, "CONSTRUCTION", P.ink, P.wood, true);
  drawHud(f, ctx.snap);
  drawHint(f, "esc back  q quit", "coming in phase 5");
}
