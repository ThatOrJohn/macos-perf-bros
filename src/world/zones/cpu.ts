/**
 * CPU Fortress (DESIGN.md §7.3): one wing per cluster kind, one brick pillar
 * per core. Pillar height = core active %, flag height = cluster freq / max.
 * Pillars above 85% catch fire. Without sudo there is no frequency data
 * (maxFreqMHz 0): the flag is hidden and the header reads NO SUDO · FREQ N/A.
 */
import { mix, type Color, type Frame, type PixelCanvas } from "../../engine/canvas.ts";
import { ditherGradientV, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import type { Row } from "../../ui/table.ts";
import { cpuTotalPct, drawHint, drawHud, drawStars, fmtPct, hash, type DrawCtx } from "../common.ts";
import { fmtWatts } from "../power-plant.ts";
import type { CoreKind, CpuCluster, CpuCore, Snapshot } from "../../core/snapshot.ts";

const FLOOR = 38;      // first floor pixel row
const MAX_H = 25;      // tallest pillar
const WALL_TOP = 9;

interface Brick { base: Color; light: Color; dark: Color }
const BRICK: Record<CoreKind, Brick> = {
  E: { base: P.eBrick, light: P.eBrickLight, dark: P.eBrickDark },
  P: { base: P.pBrick, light: P.pBrickLight, dark: P.pBrickDark },
};

function drawBackdrop(cv: PixelCanvas, t: number): void {
  ditherGradientV(cv, 0, 0, 80, FLOOR, [0x111630, 0x1b2347, 0x29356a, 0x3d4f88]);
  drawStars(cv, 14, t);
  // distant mountains
  for (let x = 0; x < 80; x++) {
    const h = 26 + Math.round(Math.abs(Math.sin(x * 0.07 + 0.5)) * -6 + Math.sin(x * 0.23) * 1.5);
    cv.rect(x, h, 1, FLOOR - h, mix(P.skyBot, P.hill, 0.55));
  }
  // stone floor
  for (let y = FLOOR; y < 46; y++) {
    for (let x = 0; x < 80; x++) {
      const mortar = (y - FLOOR) % 3 === 0 || (x + ((Math.floor((y - FLOOR) / 3) % 2) * 3)) % 6 === 0;
      cv.set(x, y, mortar ? P.stoneDeep : hash(x, y, 2) < 0.15 ? P.stoneLight : P.stone);
    }
  }
}

function drawWingWall(cv: PixelCanvas, x0: number, x1: number): void {
  cv.rect(x0, WALL_TOP, x1 - x0 + 1, FLOOR - WALL_TOP, P.stoneDeep);
  for (let x = x0; x <= x1; x += 2) cv.set(x, WALL_TOP - 1, P.stoneDeep);
  // faint brick lines on the back wall
  for (let y = WALL_TOP + 2; y < FLOOR; y += 3) {
    for (let x = x0; x <= x1; x++) if ((x + y) % 7 !== 0) cv.set(x, y, mix(P.stoneDeep, P.stoneDark, 0.35));
  }
}

function drawPillar(cv: PixelCanvas, x: number, w: number, h: number, b: Brick, t: number, seed: number): void {
  const top = FLOOR - h;
  for (let y = top; y < FLOOR; y++) {
    const row = FLOOR - 1 - y;
    for (let xx = 0; xx < w; xx++) {
      const mortar = row % 3 === 2 || (xx + (Math.floor(row / 3) % 2) * 2) % 4 === 3;
      let c: Color = mortar ? b.dark : b.base;
      if (xx === 0 && !mortar) c = b.light;
      if (xx === w - 1) c = b.dark;
      cv.set(x + xx, y, c);
    }
  }
  // cap with crenels
  cv.hline(x, x + w - 1, top, b.light);
  for (let xx = 0; xx < w; xx += 2) cv.set(x + xx, top - 1, b.light);

  // on fire above 85%
  const heat = (h / MAX_H - 0.85) / 0.15;
  if (heat > 0) {
    for (let xx = 0; xx < w; xx++) {
      const flick = hash(xx, Math.floor(t * 12), seed);
      const fh = Math.round(1 + heat * 3 * flick);
      for (let k = 0; k < fh; k++) cv.set(x + xx, top - 2 - k, k === 0 ? P.lava : flick > 0.5 ? P.lavaHi : P.ember);
    }
  }
}

function drawFlag(cv: PixelCanvas, poleX: number, ratio: number, b: Brick, t: number, facingRight: boolean): void {
  const poleTop = WALL_TOP - 3;
  cv.vline(poleX, poleTop, FLOOR - 1, P.metalLight);
  cv.set(poleX, poleTop - 1, P.accent);
  const fy = Math.round(FLOOR - 5 - ratio * (FLOOR - 5 - poleTop));
  const wave = Math.floor(t * 4) % 2;
  const dir = facingRight ? 1 : -1;
  for (let i = 1; i <= 5; i++) {
    const off = (i + wave) % 2;
    cv.set(poleX + dir * i, fy + off, b.base);
    cv.set(poleX + dir * i, fy + 1 + off, i < 3 ? b.light : b.base);
    cv.set(poleX + dir * i, fy + 2 + off, b.dark);
  }
}

interface Wing { kind: CoreKind; clusters: CpuCluster[]; cores: CpuCore[]; x0: number; x1: number }

export function drawCpuZone(f: Frame, ctx: DrawCtx): void {
  const cv = f.canvas;
  drawBackdrop(cv, ctx.t);
  const cpu = ctx.snap.cpu;
  const wings: Wing[] = (["E", "P"] as const).map((kind, i) => ({
    kind,
    clusters: cpu?.clusters.filter((c) => c.kind === kind) ?? [],
    cores: cpu?.cores.filter((c) => c.kind === kind) ?? [],
    x0: i === 0 ? 6 : 44,
    x1: i === 0 ? 35 : 73,
  }));

  f.centered(40, 1, "CPU FORTRESS", P.accent, undefined, true);

  for (const wing of wings) {
    const b = BRICK[wing.kind];
    drawWingWall(cv, wing.x0, wing.x1);
    const n = Math.max(1, wing.cores.length);
    const gap = n > 6 ? 1 : 3;
    const span = wing.x1 - wing.x0 + 1 - 2;
    const w = Math.max(2, Math.floor((span - gap * (n - 1)) / n));
    const used = w * n + gap * (n - 1);
    const start = wing.x0 + 1 + Math.floor((span - used) / 2);

    wing.cores.forEach((core, i) => {
      const pct = ctx.sm.get(`cpu.core.${core.id}`, core.activePct, ctx.dt);
      const h = Math.max(1, Math.round((pct / 100) * MAX_H));
      const x = start + i * (w + gap);
      outlined(cv, 0x0b0d18, (l) => drawPillar(l, x, w, h, b, ctx.t, core.id));
      const mid = x + w / 2;
      const pl = fmtPct(pct).padStart(4);
      f.centered(mid, 21, pl, pct > 85 ? P.lavaHi : P.white, P.stoneDeep, pct > 85);
      f.centered(mid, 22, ` ${wing.kind}${i} `, P.stoneLight, P.stoneDeep);
    });

    // flag + cluster text
    const cl = wing.clusters[0];
    const freq = ctx.sm.get(`cpu.freq.${wing.kind}`, cl?.freqMHz ?? 0, ctx.dt);
    const max = cl?.maxFreqMHz || 1;
    const poleX = wing.kind === "E" ? wing.x0 - 3 : wing.x1 + 3;
    const hasFreq = !!cl?.maxFreqMHz;
    if (hasFreq) drawFlag(cv, poleX, Math.min(1, freq / max), b, ctx.t, wing.kind === "E");
    const mid = (wing.x0 + wing.x1) / 2;
    const name = wing.kind === "E" ? "EFFICIENCY" : "PERFORMANCE";
    f.centered(mid, 3, `${name} ×${wing.cores.length}`, wing.kind === "E" ? P.eBrickLight : P.pBrickLight, undefined, true);
    const act = ctx.sm.get(`cpu.cl.${wing.kind}`, cl?.activePct ?? 0, ctx.dt);
    if (hasFreq) f.centered(mid, 4, `${Math.round(freq)}/${max} MHz · busy ${fmtPct(act)}`, P.white);
    else f.centered(mid, 4, "NO SUDO · FREQ N/A", P.dim);
  }

  drawHud(f, ctx.snap);
  const pw = ctx.snap.power;
  drawHint(f, "esc back  q quit", pw ? `CPU ${pw.cpuW.toFixed(1)}W  ANE ${pw.aneW.toFixed(1)}W` : "");
}

export function tableRows(snap: Snapshot): Row[] {
  const cpu = snap.cpu;
  const rows: Row[] = [cpu?.cores.length ? ["CPU BUSY", fmtPct(cpuTotalPct(snap)), P.hudFg] : ["CPU BUSY", "N/A", P.dim]];
  for (const [kind, group] of [["E", "EFFICIENCY"], ["P", "PERFORMANCE"]] as const) {
    const cluster = cpu?.clusters.find((cl) => cl.kind === kind);
    const cores = cpu?.cores.filter((core) => core.kind === kind) ?? [];
    if (!cluster && !cores.length) continue;
    const freq = cluster?.maxFreqMHz ? `${Math.round(cluster.freqMHz)}/${cluster.maxFreqMHz} MHZ` : "N/A";
    rows.push([`${group} CLOCK`, freq, freq === "N/A" ? P.dim : P.hudFg]);
    if (cluster) rows.push([`${group} BUSY`, fmtPct(cluster.activePct), P.hudFg]);
    for (const [i, core] of cores.entries()) {
      rows.push([`CORE ${kind}${i} BUSY`, fmtPct(core.activePct), core.activePct > 85 ? P.lavaHi : P.hudFg]);
    }
  }
  if (snap.power) {
    rows.push(["CPU POWER", fmtWatts(snap.power.cpuW), P.hudFg], ["ANE POWER", fmtWatts(snap.power.aneW), P.hudFg]);
  }
  return rows;
}
