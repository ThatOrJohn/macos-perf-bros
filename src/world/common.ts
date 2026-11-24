import { Frame, mix, sprite, type Color, type PixelCanvas } from "../engine/canvas.ts";
import { P } from "../engine/palette.ts";
import type { Smoother } from "../engine/tween.ts";
import type { Snapshot, ThermalPressure } from "../core/snapshot.ts";
import { bevel } from "../engine/paint.ts";
import { HELP_KEYS, HELP_METAPHOR } from "../ui/help.ts";
import type { Scene } from "./game.ts";

/** Everything a scene needs to draw one frame. */
export interface DrawCtx {
  snap: Snapshot;
  t: number;      // seconds since start (animation clock)
  dt: number;     // seconds since last frame
  sm: Smoother;   // eases metric-bound values
}

// ---------------------------------------------------------------- formatting

export function fmtBytes(b: number, digits = 1): string {
  const units = ["B", "K", "M", "G", "T"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(digits)}${units[i]}`;
}

export const fmtRate = (bps: number) => `${fmtBytes(bps)}/s`;
export const fmtPct = (p: number) => `${Math.round(p)}%`;

export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d${String(h).padStart(2, "0")}h` : `${h}h${String(m).padStart(2, "0")}m`;
}

export function cpuTotalPct(snap: Snapshot): number {
  const cores = snap.cpu?.cores ?? [];
  return cores.length ? cores.reduce((s, c) => s + c.activePct, 0) / cores.length : 0;
}

export const thermalColor = (t: ThermalPressure | undefined): Color =>
  t === "nominal" ? P.ok : t === "moderate" ? P.warn : t === "heavy" || t === "critical" ? P.crit : P.dim;

export const pressureColor = (p: string | undefined): Color =>
  p === "normal" ? P.ok : p === "warn" ? P.warn : p === "critical" ? P.crit : P.dim;

// ---------------------------------------------------------------- noise

/** Deterministic per-pixel hash in [0, 1). */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- HUD

/**
 * Keep items in their order, dropping the least important ones first until
 * they fit. `pri`: lower = more important. `width(i)` includes separators.
 */
export function fitByPriority<T extends { pri: number }>(items: T[], budget: number, width: (item: T, index: number) => number): T[] {
  const kept = [...items];
  const total = () => kept.reduce((sum, it, i) => sum + width(it, i), 0);
  while (kept.length && total() > budget) {
    let worst = 0;
    for (let i = 1; i < kept.length; i++) if (kept[i]!.pri >= kept[worst]!.pri) worst = i;
    kept.splice(worst, 1);
  }
  return kept;
}

/** HUD field importance when the row is full (lower = kept longer). Shared by both renderers. */
export const HUD_PRI = { paused: -1, cpu: 0, gpu: 1, mem: 2, thermal: 3, power: 4, battery: 5, net: 6, nosudo: 7, uptime: 8, brand: 9 } as const;

export function drawHud(f: Frame, snap: Snapshot, paused = false): void {
  f.hudBg = P.hudBg;
  const cpu = cpuTotalPct(snap);
  const mem = snap.memory;
  type Field = { text: string; color: Color; pri: number; bold?: boolean };
  const fields: Field[] = [
    { text: " PERF·BROS ", color: P.accent, pri: HUD_PRI.brand, bold: true },
    { text: `CPU ${fmtPct(cpu).padStart(4)}`, color: cpu > 85 ? P.crit : cpu > 60 ? P.warn : P.hudFg, pri: HUD_PRI.cpu },
  ];
  // GPU busy % (powermetrics only), same thresholds as CPU.
  const gpu = snap.gpu?.activePct;
  if (gpu !== undefined) fields.push({ text: `GPU ${fmtPct(gpu).padStart(4)}`, color: gpu > 85 ? P.crit : gpu > 60 ? P.warn : P.hudFg, pri: HUD_PRI.gpu });
  if (mem) fields.push({ text: `MEM ${fmtBytes(mem.usedB)}/${fmtBytes(mem.totalB, 0)}`, color: pressureColor(mem.pressure), pri: HUD_PRI.mem });
  if (snap.net) fields.push({ text: `NET ↓${fmtBytes(snap.net.rxBps)} ↑${fmtBytes(snap.net.txBps)}`, color: P.hudFg, pri: HUD_PRI.net });
  if (snap.power) fields.push({ text: `PWR ${snap.power.packageW.toFixed(1)}W`, color: P.hudFg, pri: HUD_PRI.power });
  if (snap.thermal) fields.push({ text: snap.thermal.toUpperCase(), color: thermalColor(snap.thermal), pri: HUD_PRI.thermal });
  fields.push({ text: snap.battery ? `♥ ${Math.round(snap.battery.pct)}%` : "AC", color: P.hudFg, pri: HUD_PRI.battery });
  if (!snap.privileged) fields.push({ text: "NO SUDO", color: P.warn, pri: HUD_PRI.nosudo });
  if (paused) fields.push({ text: "PAUSED", color: P.accent, pri: HUD_PRI.paused, bold: true });
  fields.push({ text: `UP ${fmtUptime(snap.uptimeS)}`, color: P.dim, pri: HUD_PRI.uptime });

  // When the row is full the least important fields drop; separators only between drawn fields.
  const SEP = " │ ";
  const shown = fitByPriority(fields, 80, (it, i) => it.text.length + (i ? SEP.length : 0));
  let col = 0;
  for (const [i, it] of shown.entries()) {
    if (i) {
      f.text(col, 0, SEP, P.stoneDark, P.hudBg);
      col += SEP.length;
    }
    f.text(col, 0, it.text, it.color, P.hudBg, it.bold);
    col += it.text.length;
  }
}

/** Bottom hint line (screen row 23). */
export function drawHint(f: Frame, left: string, right = ""): void {
  f.canvas.rect(0, 44, 80, 2, P.hudBg);
  f.text(1, 23, left, P.white, P.hudBg);
  if (right) f.text(79 - right.length, 23, right, P.dim, P.hudBg);
}

/** Centered overlay. Retain the pieces of scene labels outside the panel. */
export function drawHelpPanel(f: Frame, scene: Scene): void {
  const left = 12;
  const right = 68;
  let kept = 0;
  for (const run of f.texts.slice()) {
    const end = run.col + run.text.length;
    if (run.row < 4 || run.row > 19 || end <= left || run.col >= right) {
      f.texts[kept++] = run;
      continue;
    }
    if (run.col < left) f.texts[kept++] = { ...run, text: run.text.slice(0, left - run.col) };
    if (end > right) f.texts[kept++] = { ...run, col: right, text: run.text.slice(right - run.col) };
  }
  f.texts.length = kept;
  bevel(f.canvas, left, 6, right - left, 32, P.hudBg, P.stoneLight, P.ink);
  f.canvas.hline(left + 1, right - 2, 33, P.stoneDeep);
  f.centered(40, 5, "HELP", P.accent, P.hudBg, true);
  for (const [i, [key, action]] of HELP_KEYS.entries()) {
    f.text(16, i + 7, key, P.accent, P.hudBg);
    f.text(32, i + 7, action, P.hudFg, P.hudBg);
  }
  f.centered(40, 18, HELP_METAPHOR[scene], P.hudFg, P.hudBg);
}

// ---------------------------------------------------------------- sprites

const playerKey = { y: P.accent, k: P.stoneDeep, T: P.bodyTeal, v: P.visor, e: P.eye, d: P.bodyTealDark };
export const PLAYER = [
  sprite(["..y..", "..k..", ".TTT.", "TvevT", ".TTT.", "dTTTd", ".T.T.", ".d.d."], playerKey),
  sprite(["..y..", "..k..", ".TTT.", "TvevT", ".TTT.", "dTTTd", "T...T", "d...d"], playerKey),
];

/** Padlock for locked (no-sudo) zones: gold body, metal shackle, ink keyhole. */
export const PADLOCK = sprite([".m.", "aaa", "aka"], { m: P.metalLight, a: P.accent, k: P.ink });

/**
 * Centered panel for a zone scene whose data needs sudo. Panel spans
 * canvas x 20–59, y 14–31 (text rows 8–16).
 */
export function drawLockedPanel(f: Frame): void {
  const cv = f.canvas;
  cv.rect(19, 13, 42, 20, P.ink);
  cv.rect(20, 14, 40, 18, P.stoneDeep);
  cv.hline(20, 59, 14, P.stoneDark);
  // padlock (canvas y 16–23 = text rows 9–12), text below on rows 13–14
  cv.rect(37, 16, 6, 1, P.metalLight);
  cv.vline(37, 16, 18, P.metalLight);
  cv.vline(42, 16, 18, P.metalLight);
  cv.rect(36, 19, 8, 5, P.accent);
  cv.hline(36, 43, 19, P.glow);
  cv.vline(39, 20, 22, P.ink);
  cv.vline(40, 20, 21, P.ink);
  f.centered(40, 13, "NEEDS SUDO", P.accent, P.stoneDeep, true);
  f.centered(40, 14, "restart without --no-sudo", P.dim, P.stoneDeep);
}

export const PUFF = [
  sprite(["ss", "ss"], { s: P.smoke }),
  sprite(["s"], { s: P.smokeDark }),
];

/** Rising smoke from (x, y): `amount` 0..1 controls puff count and height. */
export function drawSmoke(cv: PixelCanvas, x: number, y: number, amount: number, t: number, seed = 0): void {
  const n = Math.round(amount * 4);
  for (let i = 0; i < n; i++) {
    const phase = (t * 0.7 + i / Math.max(1, n) + seed * 0.37) % 1;
    const py = y - phase * (2 + amount * 6);
    const px = x + Math.round(Math.sin((phase + seed) * 5) * phase);
    cv.blit(phase < 0.55 ? PUFF[0]! : PUFF[1]!, px - (phase < 0.55 ? 1 : 0), py);
  }
}

/** A cloud blob centered at (cx, cy), roughly w×h. */
export function drawCloud(cv: PixelCanvas, cx: number, cy: number, w: number, h: number, shade = P.cloudShade, light = P.cloud): void {
  for (let y = -h; y <= h; y++) {
    for (let x = -w; x <= w; x++) {
      const bump = Math.sin(x * 0.9 + cx) * 0.6;
      if ((x / w) ** 2 + ((y - bump) / h) ** 2 <= 1) cv.set(cx + x, cy + y, y > h * 0.35 ? shade : light);
    }
  }
}

/** Grass texture over a region. */
export function drawGrass(cv: PixelCanvas, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < cv.w; x++) {
      const h = hash(x, y, 7);
      cv.set(x, y, h < 0.08 ? P.grassLight : h > 0.92 ? P.grassDark : P.grass);
    }
  }
}

export function drawStars(cv: PixelCanvas, y1: number, t: number): void {
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(hash(i, 1, 3) * cv.w);
    const y = Math.floor(hash(i, 2, 3) * y1);
    const tw = Math.sin(t * 2 + i * 1.7) > 0.3;
    if (tw) cv.set(x, y, mix(P.star, P.skyTop, hash(i, 3, 3) * 0.5));
  }
}
