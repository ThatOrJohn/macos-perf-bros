/**
 * Power Plant (DESIGN.md §7.3). CPU, GPU and ANE watts turn the turbines
 * (0.065 turns/s per W, capped at 20 W). GPU active % drives flame height
 * (0–30 px) and brightness. GPU MHz/max MHz fills the vertical gauge.
 * Nominal/moderate/heavy/critical pressure fills the floor channel at
 * 20/45/75/100%, with bubbles cycling at 0.35–2 Hz as the fill rises.
 * Critical pressure spills over the rim and blinks the throttling sign.
 * The package display uses green under 10 W, gold under 20 W, red at 20 W and up.
 */
import { mix, type PixelCanvas } from "../../engine/canvas.ts";
import { drawTextCentered, drawTextRight } from "../../engine/font5x7.ts";
import { bevel, bricks, disc, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { stamped } from "../../engine/stamp.ts";
import { thermalColor, type DrawCtx } from "../../world/common.ts";
import { GENERATORS, drawFoundryFlame, drawThermalLava, drawTurbine, fmtWatts, gpuLabels, packageColor, type PowerPlant } from "../../world/power-plant.ts";
import { W, X, drawHintHi, drawHudHi, drawLockedPanelHi } from "../common.ts";

const SHADOW = { shadow: X.outline };
const GENERATOR_X = [35, 87, 139];
const WALL = { base: P.stoneDeep, light: mix(P.stoneDeep, P.stoneDark, 0.35), dark: X.rockDark, mortar: X.outline };
const BRICK = { base: X.brickRedDark, light: X.brickRed, dark: X.mortarRed, mortar: X.outline };

function drawWall(cv: PixelCanvas): void {
  cv.rect(0, 11, W, 170, P.stoneDeep);
  bricks(cv, 0, 23, W, 141, WALL, 23, 11);
}

function drawFactory(cv: PixelCanvas): void {
  outlined(cv, X.outline, (l) => {
    bevel(l, 88, 26, 144, 31, P.hudBg, P.metal, P.stoneDark);
    bevel(l, 13, 120, 148, 20, P.metal, P.metalLight, P.stoneDark);
    for (const x of GENERATOR_X) {
      bevel(l, x - 21, 70, 43, 49, P.metal, P.metalLight, P.stoneDark);
      disc(l, x, 97, 17, P.stoneDark);
      disc(l, x - 1, 96, 16, P.metalLight);
      disc(l, x, 97, 14, P.hudBg);
    }
    bricks(l, 174, 64, 132, 76, BRICK, 14, 7);
    bevel(l, 182, 81, 85, 42, P.hudBg, P.metalLight, P.stoneDark);
    bevel(l, 277, 81, 20, 42, P.hudBg, P.metalLight, P.stoneDark);
    for (let y = 86; y < 119; y += 5) l.hline(291, 295, y, P.stoneDark);
  });
  bevel(cv, 5, 161, 310, 19, P.stoneDeep, P.stoneDark, X.outline);
  cv.rect(12, 164, 296, 15, P.hudBg);
}

export function drawPowerZoneHi(cv: PixelCanvas, ctx: DrawCtx, plant: PowerPlant): void {
  stamped(cv, "power.wall", drawWall);
  drawHudHi(cv, ctx.snap);
  drawTextCentered(cv, W / 2, 14, "POWER PLANT", P.accent, SHADOW);
  const { power, gpu, thermal } = ctx.snap;
  if (!power) {
    drawLockedPanelHi(cv);
    drawHintHi(cv, "ESC BACK  Q QUIT", "NO DATA WITHOUT SUDO");
    return;
  }

  stamped(cv, "power.factory", drawFactory);
  plant.update(power, ctx);
  const packageStatus = packageColor(power.packageW);
  cv.vline(92, 30, 52, packageStatus);
  cv.vline(227, 30, 52, packageStatus);
  drawTextCentered(cv, 160, 30, "PACKAGE", P.dim);
  drawTextCentered(cv, 160, 43, fmtWatts(power.packageW), packageStatus);
  for (const [i, { label, key }] of GENERATORS.entries()) {
    const x = GENERATOR_X[i]!;
    drawTextCentered(cv, x, 74, label, P.ink);
    drawTurbine(cv, x, 97, 12, plant.turbine[i]!);
    drawTextCentered(cv, x, 126, fmtWatts(power[key]), P.ink);
  }

  const labels = gpuLabels(gpu);
  drawTextCentered(cv, 216, 69, "GPU FOUNDRY", P.white, SHADOW);
  drawTextRight(cv, 302, 69, `BUSY ${labels.busy}`, P.white, SHADOW);
  if (gpu) {
    drawFoundryFlame(cv, 188, 120, 73, 30, plant.gpuBusy, ctx.t);
    const fill = Math.round(38 * plant.gpuClock);
    cv.rect(279, 121 - fill, 10, fill, P.eBrick);
    cv.rect(279, 121 - fill, 2, fill, P.eBrickLight);
  }
  drawTextCentered(cv, 240, 128, labels.freq, P.white, SHADOW);

  drawTextCentered(cv, 91, 149, `THERMAL ${thermal ?? "N/A"}`, thermalColor(thermal), SHADOW);
  if (thermal === "critical") {
    drawTextRight(cv, 307, 149, "⚠ THROTTLING", ctx.t % 1 < 0.5 ? P.crit : P.warn, SHADOW);
  }
  if (thermal && thermal !== "unknown") drawThermalLava(cv, 12, 178, 296, 15, plant, thermal === "critical");
  drawHintHi(cv, "ESC BACK  Q QUIT", "PACKAGE W · THERMAL");
}
