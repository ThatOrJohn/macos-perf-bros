import type { GpuReading, PowerReading, ThermalPressure } from "../core/snapshot.ts";
import type { PixelCanvas } from "../engine/canvas.ts";
import { dither, line } from "../engine/paint.ts";
import { P } from "../engine/palette.ts";
import { Smoother } from "../engine/tween.ts";
import { fmtPct, hash, type DrawCtx } from "./common.ts";

export const PACKAGE_WARN_W = 10;
export const PACKAGE_CRIT_W = 20;
export const GENERATORS = [
  { label: "CPU", key: "cpuW" },
  { label: "GPU", key: "gpuW" },
  { label: "ANE", key: "aneW" },
] as const;

const TURBINE_MAX_W = 20;
const TURNS_PER_WATT = 0.065;
const THERMAL_LEVEL: Record<ThermalPressure, number> = {
  nominal: 0.2, moderate: 0.45, heavy: 0.75, critical: 1, unknown: 0,
};

function fraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export const fmtWatts = (watts: number) => `${watts.toFixed(1)} W`;
export const packageColor = (watts: number) => watts < PACKAGE_WARN_W ? P.ok : watts < PACKAGE_CRIT_W ? P.warn : P.crit;

export function gpuLabels(gpu: GpuReading | undefined): { busy: string; freq: string } {
  return {
    busy: gpu ? fmtPct(gpu.activePct) : "N/A",
    freq: gpu && gpu.maxFreqMHz > 0
      ? `${Math.round(gpu.freqMHz)}/${Math.round(gpu.maxFreqMHz)} MHZ`
      : gpu && gpu.freqMHz > 0 ? `${Math.round(gpu.freqMHz)} MHZ (MAX N/A)` : "CLK N/A",
  };
}

export class PowerPlant {
  private readonly sm = new Smoother();
  private clock: number | undefined;
  readonly turbine = [0, 0, 0];
  gpuBusy = 0;
  gpuClock = 0;
  thermalLevel = 0;
  lavaPhase = 0;

  update(power: PowerReading, ctx: DrawCtx): void {
    const { t, dt, snap } = ctx;
    // Use clock deltas at 5 fps, where the main loop caps dt at 0.1 s.
    const elapsed = this.clock === undefined ? dt : Math.min(0.25, Math.max(0, t - this.clock));
    this.clock = t;
    for (const [i, { key }] of GENERATORS.entries()) {
      const watts = this.sm.get(key, Math.max(0, Math.min(TURBINE_MAX_W, power[key])), elapsed);
      this.turbine[i] = (this.turbine[i]! + elapsed * TURNS_PER_WATT * watts) % 1;
    }
    const gpu = snap.gpu;
    this.gpuBusy = this.sm.get("busy", fraction((gpu?.activePct ?? 0) / 100), elapsed);
    const clock = gpu && gpu.maxFreqMHz > 0 ? fraction(gpu.freqMHz / gpu.maxFreqMHz) : undefined;
    const easedClock = this.sm.get("freq", clock ?? 0, elapsed);
    this.gpuClock = clock === undefined ? 0 : easedClock;
    this.thermalLevel = this.sm.get("thermal", THERMAL_LEVEL[snap.thermal ?? "unknown"], elapsed);
    this.lavaPhase = (this.lavaPhase + elapsed * (0.35 + 1.65 * this.thermalLevel)) % 1;
  }
}

/** A three-blade turbine with a brighter leading blade to make rotation legible. */
export function drawTurbine(cv: PixelCanvas, x: number, y: number, r: number, phase: number): void {
  for (let blade = 0; blade < 3; blade++) {
    const a = (phase + blade / 3) * 2 * Math.PI;
    const tipX = x + Math.round(Math.cos(a) * r);
    const tipY = y + Math.round(Math.sin(a) * r);
    const heelX = x + Math.round(Math.cos(a - 0.5) * r * 0.65);
    const heelY = y + Math.round(Math.sin(a - 0.5) * r * 0.65);
    line(cv, x, y, tipX, tipY, blade === 0 ? P.metalLight : P.metal);
    line(cv, tipX, tipY, heelX, heelY, P.stoneDark);
  }
  cv.set(x, y, P.white);
}

/** Flames grow upward from the hearth and brighten with GPU activity. */
export function drawFoundryFlame(cv: PixelCanvas, left: number, bottom: number, width: number, maxHeight: number, busy: number, t: number): void {
  if (busy <= 0) return;
  const flicker = Math.floor(t * 4);
  for (let i = 0; i < width; i++) {
    const taper = Math.sin(Math.PI * (i + 1) / (width + 1));
    const h = Math.round(maxHeight * busy * taper * (0.65 + 0.35 * hash(Math.floor(i * 12 / width), flicker, 66)));
    for (let dy = 0; dy < h; dy++) {
      const x = left + i;
      const y = bottom - dy;
      const base = dither(x, y, P.ember, P.lava, busy);
      cv.set(x, y, dither(x, y, base, P.lavaHi, busy * (1 - dy / h)));
    }
  }
}

/** A recessed lava channel. The highest level spills through two cutouts in the rim. */
export function drawThermalLava(cv: PixelCanvas, x: number, bottom: number, w: number, height: number, plant: PowerPlant, critical: boolean): void {
  const { thermalLevel: level, lavaPhase: phase } = plant;
  const h = Math.round(level * height);
  if (h === 0) return;
  const top = bottom - h + 1;
  for (let y = top; y <= bottom; y++) {
    for (let xx = x; xx < x + w; xx++) {
      cv.set(xx, y, dither(xx, y, P.ember, y === top ? P.lavaHi : P.lava, level));
    }
  }
  const bubbles = Math.ceil(6 * level);
  for (let i = 0; i < bubbles; i++) {
    const pos = (phase + hash(i, 1, 66)) % 1;
    const bx = x + Math.floor(hash(i, 2, 66) * w);
    cv.set(bx, bottom - Math.floor(pos * h), P.lavaHi);
  }
  if (critical && h === height) {
    cv.hline(x - 3, x + 4, top, P.lava);
    cv.hline(x + w - 5, x + w + 2, top, P.lava);
  }
}
