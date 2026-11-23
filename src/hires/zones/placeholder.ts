import type { PixelCanvas } from "../../engine/canvas.ts";
import { drawTextCentered } from "../../engine/font5x7.ts";
import { P } from "../../engine/palette.ts";
import { bevel, outlined } from "../../engine/paint.ts";
import type { DrawCtx } from "../../world/common.ts";
import { W, X, drawGrassField, drawHintHi, drawHudHi, drawMountains, drawNightSky, drawRobot } from "../common.ts";

/** Hi-res stand-in for zones that aren't built yet. */
export function drawPlaceholderZoneHi(cv: PixelCanvas, ctx: DrawCtx, name: string): void {
  drawNightSky(cv, 11, 130, ctx.t);
  drawMountains(cv, 130, 36, 20, 1.7);
  drawGrassField(cv, 130, 181);
  drawTextCentered(cv, W / 2, 14, name, P.accent, { shadow: X.outline });
  outlined(cv, X.outline, (l) => {
    bevel(l, 146, 100, 4, 44, P.wood, P.path, P.woodDark);
    bevel(l, 170, 100, 4, 44, P.wood, P.path, P.woodDark);
    bevel(l, 112, 62, 96, 42, P.wood, P.path, P.woodDark);
    // hazard stripes along the top
    for (let x = 0; x < 92; x++) for (let y = 0; y < 5; y++) l.set(114 + x, 64 + y, ((x + y) >> 2) % 2 ? P.accent : X.outline);
  });
  drawTextCentered(cv, W / 2, 76, "UNDER", X.outline);
  drawTextCentered(cv, W / 2, 86, "CONSTRUCTION", X.outline);
  // traffic cones
  for (const cx of [104, 216]) {
    outlined(cv, X.outline, (l) => {
      for (let r = 0; r < 12; r++) {
        const half = Math.round(1 + r * 0.45);
        l.hline(cx - half, cx + half, 132 + r, r % 5 === 3 ? P.white : P.pBrick);
      }
      l.hline(cx - 8, cx + 8, 144, P.pBrickDark);
    });
  }
  drawRobot(cv, 196, 146, ctx.t, false);
  drawHudHi(cv, ctx.snap);
  drawHintHi(cv, "ESC BACK  Q QUIT", "COMING IN PHASE 5");
}
