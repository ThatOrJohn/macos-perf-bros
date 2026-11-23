/**
 * Process Plains (DESIGN.md §7.3). Top six by CPU stay in PID-keyed meadow
 * slots. RSS (<100 MB, <1 GB, or larger) scales the slime, CPU drives its
 * hops, and energy impact >100 lights a gold halo. The #1 process above 50%
 * becomes a boss. Its bar fills over 0–100% of one core and its label gives
 * the full CPU percentage. The board lists five processes and sums wakeups
 * per second across the six displayed processes.
 */
import { Frame, mix, sprite, type PixelCanvas } from "../../engine/canvas.ts";
import { bevel, ditherGradientV, glow, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { drawHint, drawHud, drawStars, fmtBytes, fmtPct, type DrawCtx } from "../common.ts";
import { BOSS, SLIME_COLORS, SLIMES } from "../overworld.ts";
import { PROCESS_BOSS_CPU, PROCESS_GLOW_ENERGY, blitScaledSlime, drawProcessGrass, processName, slimeHop, type ProcessField, type Slime } from "../process-field.ts";

export const PROCESS_LIMIT = 6;
const SKY = [P.skyTop, mix(P.skyTop, P.skyBot, 0.5), P.skyBot];
const SMALL_SLIMES = SLIME_COLORS.map((color) => sprite([".s.", "ses"], { s: color, e: P.ink }));

function drawSlime(f: Frame, slime: Slime, departing: boolean): void {
  const { proc, slot, paletteSeed, boss, presence } = slime;
  if (presence === 0) return;
  const cx = 8 + (slot % 3) * 15;
  const foot = 18 + Math.floor(slot / 3) * 16;
  const hop = slimeHop(slime);
  const x = cx + Math.round(1.5 * Math.sin(slime.phase * 2 * Math.PI));
  const colorIndex = Math.floor(paletteSeed * SLIMES.length);
  const scale = slime.size * presence;
  const base = boss ? BOSS : SLIMES[colorIndex]!;
  const w = Math.max(1, Math.round(base.w * scale));
  const h = Math.max(1, Math.round(base.h * scale));
  const art = !boss && w === 3 && h === 2 ? SMALL_SLIMES[colorIndex]! : base;
  const y = foot - h - Math.round(hop * (boss ? 3 : 2));
  const cv = f.canvas;
  if (slime.glow > 0.05) glow(cv, x, y + Math.floor(h / 2), Math.ceil(w / 2) + 2, P.accent, slime.glow * presence);
  outlined(cv, P.ink, (layer) => blitScaledSlime(layer, art, x - Math.floor(w / 2), y, w, h));
  if (departing) return;

  if (boss) {
    cv.rect(x - 4, y - 3, 9, 2, P.ink);
    cv.rect(x - 3, y - 3, Math.round(7 * Math.min(1, slime.cpu / 100)), 1, P.lavaHi);
  }
  const labelRow = Frame.rowOf(foot + 2);
  const rss = proc.rssB === undefined ? "-" : fmtBytes(proc.rssB);
  f.centered(cx, labelRow, `${slime.rank} ${fmtPct(proc.cpuPct)} ${rss}`, boss ? P.lavaHi : P.hudFg, P.hudBg);
  if (slime.glow > 0.05) f.centered(cx, labelRow + 1, `E${Math.round(proc.energyImpact)}`, P.accent, P.hudBg);
}

function drawBoard(f: Frame, ranked: Slime[]): void {
  const cv = f.canvas;
  bevel(cv, 46, 3, 33, 27, P.stoneDeep, P.stone, P.ink);
  cv.rect(47, 4, 31, 24, P.hudBg);
  f.text(50, 3, "NAME", P.accent);
  f.text(66, 3, "CPU%", P.accent);
  f.text(74, 3, "RSS", P.accent);
  for (const [i, slime] of ranked.slice(0, 5).entries()) {
    const { proc, boss, paletteSeed } = slime;
    const row = 4 + i;
    const bg = i % 2 ? P.stoneDeep : P.hudBg;
    const cpu = fmtPct(proc.cpuPct);
    const rss = proc.rssB === undefined ? "-" : fmtBytes(proc.rssB);
    const marker = boss ? P.lavaHi : SLIME_COLORS[Math.floor(paletteSeed * SLIME_COLORS.length)]!;
    cv.rect(47, 2 * (row - 1), 31, 2, bg);
    f.text(48, row, "■", marker, bg);
    f.text(50, row, processName(proc.name, 14), boss ? P.lavaHi : P.hudFg, bg);
    f.text(70 - cpu.length, row, cpu, P.hudFg, bg);
    f.text(77 - rss.length, row, rss, proc.rssB === undefined ? P.dim : P.hudFg, bg);
  }
  if (!ranked.length) f.text(50, 5, "NO PROCESSES", P.dim);
  cv.hline(49, 75, 18, P.stoneDeep);
  const wakeups = ranked.reduce((sum, slime) => sum + slime.proc.idleWakeupsPerS, 0);
  f.text(49, 11, `TOP ${PROCESS_LIMIT} WAKE/S ${Math.round(wakeups)}`, P.hudFg);
  f.text(49, 12, "E = ENERGY IMPACT", P.dim);
  f.text(49, 13, `GLOW ABOVE E${PROCESS_GLOW_ENERGY}`, P.dim);
}

function drawMeadow(cv: PixelCanvas, t: number): void {
  ditherGradientV(cv, 0, 0, 80, 15, SKY);
  drawStars(cv, 10, t);
  for (let x = 0; x < 80; x++) {
    const ridge = 10 + Math.round(Math.sin(x / 9) * 2 + Math.sin(x / 4) * 2);
    cv.vline(x, ridge, 14, P.hill);
    cv.set(x, ridge, P.hillLight);
  }
  drawProcessGrass(cv, 14, 44);
  cv.rect(0, 41, 80, 3, P.dirtDark);
  cv.hline(0, 79, 41, P.grassDark);
  cv.hline(1, 44, 14, P.woodDark);
  cv.hline(1, 44, 12, P.wood);
  for (let x = 1; x <= 44; x += 7) {
    cv.vline(x, 11, 15, P.woodDark);
    cv.set(x, 11, P.path);
  }
}

export function drawProcessZone(f: Frame, ctx: DrawCtx, field: ProcessField): void {
  drawMeadow(f.canvas, ctx.t);
  const { ranked, leaving } = field.update(ctx.snap.procs, ctx.dt);
  for (const slime of leaving) drawSlime(f, slime, true);
  for (const slime of ranked) drawSlime(f, slime, false);
  drawBoard(f, ranked);
  f.centered(40, 1, "PROCESS PLAINS", P.accent, undefined, true);
  drawHud(f, ctx.snap);
  drawHint(f, "esc back  q quit", `TOP ${PROCESS_LIMIT} BY CPU · BOSS > ${PROCESS_BOSS_CPU}%`);
}
