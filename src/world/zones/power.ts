/**
 * Power Plant (DESIGN.md §7.3). CPU, GPU and ANE watts turn the turbines
 * (0.065 turns/s per W, capped at 20 W). GPU active % drives flame height
 * (0–9 px) and brightness. GPU MHz/max MHz fills the vertical gauge.
 * Nominal/moderate/heavy/critical pressure fills the floor channel at
 * 20/45/75/100%, with bubbles cycling at 0.35–2 Hz as the fill rises.
 * Critical pressure spills over the rim and blinks the throttling sign.
 * The package display uses green under 10 W, gold under 20 W, red at 20 W and up.
 */
import { mix, type Frame, type PixelCanvas } from "../../engine/canvas.ts";
import { bevel, bricks, disc, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { stamped } from "../../engine/stamp.ts";
import { drawHint, drawHud, drawLockedPanel, thermalColor, type DrawCtx } from "../common.ts";
import { GENERATORS, drawFoundryFlame, drawThermalLava, drawTurbine, fmtWatts, gpuLabels, packageColor, type PowerPlant } from "../power-plant.ts";

const GENERATOR_X = [8, 23, 38];
const WALL = { base: P.stoneDeep, light: mix(P.stoneDeep, P.stoneDark, 0.35), dark: P.stoneDeep, mortar: P.ink };
const BRICK = { base: P.woodDark, light: P.wood, dark: P.dirtDark, mortar: P.ink };

function drawFactory(cv: PixelCanvas): void {
  outlined(cv, P.ink, (l) => {
    bevel(l, 25, 4, 30, 8, P.hudBg, P.metal, P.stoneDark);
    bevel(l, 2, 30, 43, 4, P.metal, P.metalLight, P.stoneDark);
    for (const x of GENERATOR_X) {
      bevel(l, x - 6, 14, 13, 16, P.metal, P.metalLight, P.stoneDark);
      disc(l, x, 24, 5, P.stoneDark);
      disc(l, x, 24, 4, P.hudBg);
    }
    bricks(l, 47, 14, 31, 20, BRICK, 7, 4);
    bevel(l, 49, 19, 19, 12, P.hudBg, P.metalLight, P.stoneDark);
    bevel(l, 71, 19, 5, 12, P.hudBg, P.metalLight, P.stoneDark);
  });
  bevel(cv, 1, 36, 78, 8, P.stoneDeep, P.stoneDark, P.ink);
  cv.rect(4, 37, 72, 6, P.hudBg);
}

export function drawPowerZone(f: Frame, ctx: DrawCtx, plant: PowerPlant): void {
  const cv = f.canvas;
  stamped(cv, "power.wall", (l) => bricks(l, 0, 0, 80, 44, WALL, 8, 4));
  drawHud(f, ctx.snap);
  f.centered(40, 1, "POWER PLANT", P.accent, P.hudBg, true);
  const { power, gpu, thermal } = ctx.snap;
  if (!power) {
    drawLockedPanel(f);
    drawHint(f, "esc back  q quit", "no data without sudo");
    return;
  }

  stamped(cv, "power.factory", drawFactory);
  plant.update(power, ctx);
  const packageStatus = packageColor(power.packageW);
  cv.vline(26, 5, 10, packageStatus);
  cv.vline(53, 5, 10, packageStatus);
  f.centered(40, 4, "PACKAGE", P.dim, P.hudBg);
  f.centered(40, 5, fmtWatts(power.packageW), packageStatus, P.hudBg, true);
  for (const [i, { label, key }] of GENERATORS.entries()) {
    const x = GENERATOR_X[i]!;
    f.centered(x, 9, label, P.ink, P.metal, true);
    drawTurbine(cv, x, 24, 3, plant.turbine[i]!);
    f.centered(x, 17, fmtWatts(power[key]), P.ink, P.metal);
  }

  const labels = gpuLabels(gpu);
  f.centered(62, 9, "GPU FOUNDRY", P.white, P.hudBg);
  if (gpu) {
    drawFoundryFlame(cv, 51, 29, 15, 9, plant.gpuBusy, ctx.t);
    const fill = Math.round(10 * plant.gpuClock);
    cv.rect(72, 30 - fill, 3, fill, P.eBrick);
    cv.rect(72, 30 - fill, 1, fill, P.eBrickLight);
  }
  f.centered(62, 17, `BUSY ${labels.busy}  ${labels.freq}`, P.white, P.hudBg);

  f.text(3, 18, `THERMAL ${(thermal ?? "N/A").toUpperCase()}`, thermalColor(thermal), P.hudBg);
  if (thermal === "critical") {
    f.text(64, 18, "⚠ THROTTLING", ctx.t % 1 < 0.5 ? P.crit : P.warn, P.hudBg, true);
  }
  if (thermal && thermal !== "unknown") drawThermalLava(cv, 4, 42, 72, 6, plant, thermal === "critical");
  drawHint(f, "esc back  q quit", "PACKAGE W · THERMAL");
}
