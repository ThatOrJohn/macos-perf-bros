import { Frame, mix, sprite, type Color, type PixelCanvas } from "../engine/canvas.ts";
import { P } from "../engine/palette.ts";
import type { Smoother } from "../engine/tween.ts";
import type { Snapshot, ThermalPressure } from "../core/snapshot.ts";

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

export function drawHud(f: Frame, snap: Snapshot): void {
  f.hudBg = P.hudBg;
  const cpu = cpuTotalPct(snap);
  const mem = snap.memory;
  const fields: [string, Color][] = [
    [" PERF·BROS ", P.accent],
    [`CPU ${fmtPct(cpu).padStart(4)}`, cpu > 85 ? P.crit : cpu > 60 ? P.warn : P.hudFg],
  ];
  if (mem) fields.push([`MEM ${fmtBytes(mem.usedB)}/${fmtBytes(mem.totalB, 0)}`, pressureColor(mem.pressure)]);
  if (snap.net) fields.push([`NET ↓${fmtBytes(snap.net.rxBps)} ↑${fmtBytes(snap.net.txBps)}`, P.hudFg]);
  if (snap.power) fields.push([`PWR ${snap.power.packageW.toFixed(1)}W`, P.hudFg]);
  if (snap.thermal) fields.push([snap.thermal.toUpperCase(), thermalColor(snap.thermal)]);
  fields.push([snap.battery ? `♥ ${Math.round(snap.battery.pct)}%` : "AC", P.hudFg]);
  if (!snap.privileged) fields.push(["NO SUDO", P.warn]);
  fields.push([`UP ${fmtUptime(snap.uptimeS)}`, P.dim]);

  // Fields drop off the right end when the row is full; separators only between drawn fields.
  let col = 0;
  for (const [i, [text, color]] of fields.entries()) {
    const sep = i === 0 ? "" : " │ ";
    if (col + sep.length + text.length > 80) break;
    if (sep) f.text(col, 0, sep, P.stoneDark, P.hudBg);
    col += sep.length;
    f.text(col, 0, text, color, P.hudBg, i === 0);
    col += text.length;
  }
}

/** Bottom hint line (screen row 23). */
export function drawHint(f: Frame, left: string, right = ""): void {
  f.canvas.rect(0, 44, 80, 2, P.hudBg);
  f.text(1, 23, left, P.white, P.hudBg);
  if (right) f.text(79 - right.length, 23, right, P.dim, P.hudBg);
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
