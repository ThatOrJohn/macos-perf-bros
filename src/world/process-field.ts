import type { Proc } from "../core/snapshot.ts";
import { mix, type PixelCanvas, type Sprite } from "../engine/canvas.ts";
import { P } from "../engine/palette.ts";
import { Smoother } from "../engine/tween.ts";
import { hash } from "./common.ts";

export const PROCESS_BOSS_CPU = 50;
export const PROCESS_GLOW_ENERGY = 100;
export const PROCESS_LIMIT_HI = 12;

const POP_IN_S = 0.20;
const SHRINK_OUT_S = 0.30;
const MEADOW = [
  mix(P.hill, P.grass, 0.32),
  mix(P.hill, P.grass, 0.45),
  mix(P.hill, P.grass, 0.57),
];
const MEADOW_LIGHT = mix(P.hillLight, P.grass, 0.5);

export function rssScale(rssB: number | undefined): number {
  if (rssB === undefined) return 1;
  return rssB < 100_000_000 ? 0.75 : rssB < 1_000_000_000 ? 1 : 1.35;
}

export function processName(name: string, limit: number): string {
  // Keep terminal cell widths fixed and use characters available in the bitmap font.
  const label = name.normalize("NFKD").replace(/\p{Mark}/gu, "").replace(/[^a-z0-9 _().+\-]/gi, "?");
  return label.length <= limit ? label : `${label.slice(0, limit - 1)}.`;
}

export interface Slime {
  proc: Proc;
  readonly slot: number;
  readonly paletteSeed: number;
  readonly smoother: Smoother;
  rank: number;
  boss: boolean;
  presence: number;
  phase: number;
  size: number;
  glow: number;
  cpu: number;
}

/** Tracks only the visible PIDs and at most one shrinking sprite per slot. */
export class ProcessField {
  private readonly active = new Map<number, Slime>();
  private readonly leaving = new Map<number, Slime>();

  constructor(readonly limit: number) {}

  update(procs: readonly Proc[], dt: number): { ranked: Slime[]; leaving: Iterable<Slime> } {
    const top = procs.slice(0, this.limit);
    const pids = new Set(top.map(({ pid }) => pid));
    const occupied = new Set<number>();
    for (const [pid, slime] of this.active) {
      if (pids.has(pid)) {
        occupied.add(slime.slot);
      } else {
        this.active.delete(pid);
        slime.boss = false;
        this.leaving.set(slime.slot, slime);
      }
    }
    for (const [slot, slime] of this.leaving) {
      slime.presence = Math.max(0, slime.presence - dt / SHRINK_OUT_S);
      if (slime.presence === 0) this.leaving.delete(slot);
      else this.advance(slime, dt);
    }

    const ranked = top.map((proc, index) => {
      let slime = this.active.get(proc.pid);
      if (!slime) {
        // Probe from the PID's preferred slot. A rank change never moves an existing slime.
        const preferred = Math.floor(hash(proc.pid, 0, 31) * this.limit);
        let slot = preferred;
        while (occupied.has(slot)) slot = (slot + 1) % this.limit;
        occupied.add(slot);
        slime = {
          proc, slot, paletteSeed: hash(proc.pid, 1, 31), smoother: new Smoother(),
          rank: index + 1, boss: false, presence: 0, phase: hash(proc.pid, 2, 31),
          size: rssScale(proc.rssB), glow: 0, cpu: proc.cpuPct,
        };
        this.active.set(proc.pid, slime);
      }
      slime.proc = proc;
      slime.rank = index + 1;
      slime.boss = index === 0 && proc.cpuPct > PROCESS_BOSS_CPU;
      slime.presence = Math.min(1, slime.presence + dt / POP_IN_S);
      this.advance(slime, dt);
      return slime;
    });
    return { ranked, leaving: this.leaving.values() };
  }

  private advance(slime: Slime, dt: number): void {
    const { proc, smoother } = slime;
    slime.cpu = smoother.get("proc.cpu", proc.cpuPct, dt);
    slime.size = smoother.get("proc.rss", rssScale(proc.rssB), dt);
    slime.glow = smoother.get("proc.energy", proc.energyImpact > PROCESS_GLOW_ENERGY ? 0.85 : 0, dt);
    // A single core is 100%. Multi-core tasks keep getting faster up to 400%.
    const hz = 0.35 + 0.16 * Math.sqrt(Math.min(400, Math.max(0, slime.cpu)));
    slime.phase = (slime.phase + hz * dt) % 1;
  }
}

export function slimeHop(slime: Slime): number {
  return Math.sin(Math.PI * slime.phase) ** 2;
}

/** Three terrain bands give both renderers the same dusk meadow. */
export function drawProcessGrass(cv: PixelCanvas, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    const base = MEADOW[Math.floor(3 * (y - y0) / (y1 - y0))]!;
    for (let x = 0; x < cv.w; x++) {
      const h = hash(x, y, 41);
      cv.set(x, y, h < 0.051 ? P.hill : h > 0.968 ? MEADOW_LIGHT : base);
    }
  }
}

/** Nearest-neighbor scaling for the small pixel sprites, without allocating a scaled canvas. */
export function blitScaledSlime(cv: PixelCanvas, sprite: Sprite, x: number, y: number, w: number, h: number): void {
  for (let row = 0; row < h; row++) {
    const sourceRow = Math.floor((row + 0.5) * sprite.h / h) * sprite.w;
    for (let col = 0; col < w; col++) {
      const color = sprite.px[sourceRow + Math.floor((col + 0.5) * sprite.w / w)]!;
      if (color >= 0) cv.set(x + col, y + row, color);
    }
  }
}
