/**
 * Process Plains (DESIGN.md §7.3). Top twelve by CPU stay in PID-keyed meadow
 * slots. RSS (<100 MB, <1 GB, or larger) scales the slime, CPU drives its hops,
 * and energy impact >100 lights a gold halo. The #1 process above 50% becomes a
 * boss. Its bar fills over 0–100% of one core and its label gives the full CPU
 * percentage. The board lists eight processes and sums wakeups per second
 * across the twelve displayed processes.
 */
import type { PixelCanvas } from "../../engine/canvas.ts";
import { drawText, drawTextCentered, drawTextRight } from "../../engine/font5x7.ts";
import { bevel, glow, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { fmtBytes, fmtPct, type DrawCtx } from "../../world/common.ts";
import { PROCESS_BOSS_CPU, PROCESS_GLOW_ENERGY, blitScaledSlime, drawProcessGrass, processName, slimeHop, type ProcessField, type Slime } from "../../world/process-field.ts";
import { BOSS, SLIMES, SLIME_BASES, W, X, drawHintHi, drawHudHi, drawMountains, drawNightSky } from "../common.ts";

export const PROCESS_LIMIT_HI = 12;
const SHADOW = { shadow: X.outline };

function drawSlimeHi(cv: PixelCanvas, slime: Slime, departing: boolean): void {
  const { proc, slot, paletteSeed, boss, presence } = slime;
  if (presence === 0) return;
  const cx = 26 + (slot % 4) * 49;
  const foot = 61 + Math.floor(slot / 4) * 45;
  const hop = slimeHop(slime);
  const x = cx + Math.round(4 * Math.sin(slime.phase * 2 * Math.PI));
  const [normal, squash] = SLIMES[Math.floor(paletteSeed * SLIMES.length)]!;
  const art = boss ? BOSS : hop < 0.08 ? squash : normal;
  const scale = slime.size * presence;
  const w = Math.max(1, Math.round(art.w * scale));
  const h = Math.max(1, Math.round(art.h * scale));
  const y = foot - h - Math.round(hop * (boss ? 8 : 6));
  if (slime.glow > 0.05) glow(cv, x, y + Math.floor(h / 2), Math.ceil(w / 2) + 5, P.accent, slime.glow * presence);
  outlined(cv, X.outline, (layer) => blitScaledSlime(layer, art, x - Math.floor(w / 2), y, w, h));
  if (departing) return;

  if (boss) {
    cv.rect(x - 13, y - 6, 27, 5, X.outline);
    cv.rect(x - 12, y - 5, 25, 3, P.stoneDeep);
    cv.rect(x - 12, y - 5, Math.round(25 * Math.min(1, slime.cpu / 100)), 3, P.lavaHi);
  }
  drawTextCentered(cv, cx, foot + 1, `${slime.rank} ${fmtPct(proc.cpuPct)}`, boss ? P.lavaHi : P.white, SHADOW);
  drawTextCentered(cv, cx, foot + 10, proc.rssB === undefined ? "-" : fmtBytes(proc.rssB), P.hudFg, SHADOW);
  if (slime.glow > 0.05) drawTextCentered(cv, cx, foot + 19, `E${Math.round(proc.energyImpact)}`, P.accent, SHADOW);
}

function drawBoardHi(cv: PixelCanvas, ranked: Slime[]): void {
  outlined(cv, X.outline, (layer) => {
    bevel(layer, 203, 27, 113, 148, P.stoneDark, P.stoneLight, P.stoneDeep);
    bevel(layer, 206, 30, 107, 142, P.hudBg, P.stoneDeep, P.stone);
  });
  drawText(cv, 213, 35, "NAME", P.accent);
  drawTextRight(cv, 277, 35, "CPU%", P.accent);
  drawTextRight(cv, 310, 35, "RSS", P.accent);
  cv.hline(208, 310, 44, P.stoneDark);

  for (const [i, slime] of ranked.slice(0, 8).entries()) {
    const { proc, boss, paletteSeed } = slime;
    const y = 47 + i * 11;
    if (i % 2) cv.rect(207, y - 1, 105, 10, P.stoneDeep);
    const marker = boss ? P.lavaHi : SLIME_BASES[Math.floor(paletteSeed * SLIME_BASES.length)]!;
    cv.rect(209, y + 2, 2, 3, marker);
    drawText(cv, 213, y, processName(proc.name, 6), boss ? P.lavaHi : P.hudFg);
    drawTextRight(cv, 277, y, fmtPct(proc.cpuPct), P.hudFg);
    drawTextRight(cv, 310, y, proc.rssB === undefined ? "-" : fmtBytes(proc.rssB), proc.rssB === undefined ? P.dim : P.hudFg);
  }
  if (!ranked.length) drawTextCentered(cv, 259, 65, "NO PROCESSES", P.dim);
  cv.hline(208, 310, 134, P.stoneDark);
  const wakeups = ranked.reduce((sum, slime) => sum + slime.proc.idleWakeupsPerS, 0);
  drawText(cv, 210, 140, "WAKE/S SUM", P.dim);
  drawTextRight(cv, 309, 140, String(Math.round(wakeups)), P.hudFg);
  drawText(cv, 210, 151, "E = ENERGY IMPACT", P.dim);
  drawText(cv, 210, 161, `GLOW ABOVE E${PROCESS_GLOW_ENERGY}`, P.dim);
}

function drawMeadowHi(cv: PixelCanvas, t: number): void {
  drawNightSky(cv, 11, 49, t, false);
  drawMountains(cv, 49, 19, 9, 2.8);
  drawProcessGrass(cv, 49, 181);
  cv.rect(0, 178, W, 3, P.dirtDark);
  cv.hline(0, W - 1, 178, P.grassDark);
  outlined(cv, X.outline, (layer) => {
    bevel(layer, 4, 41, 199, 4, P.wood, P.path, P.woodDark);
    bevel(layer, 4, 48, 199, 4, P.wood, P.path, P.woodDark);
    for (let x = 4; x < 203; x += 22) bevel(layer, x, 39, 4, 17, P.wood, P.path, P.woodDark);
  });
}

export function drawProcessZoneHi(cv: PixelCanvas, ctx: DrawCtx, field: ProcessField): void {
  drawMeadowHi(cv, ctx.t);
  const { ranked, leaving } = field.update(ctx.snap.procs, ctx.dt);
  for (const slime of leaving) drawSlimeHi(cv, slime, true);
  for (const slime of ranked) drawSlimeHi(cv, slime, false);
  drawBoardHi(cv, ranked);
  drawTextCentered(cv, W / 2, 14, "PROCESS PLAINS", P.accent, SHADOW);
  drawHudHi(cv, ctx.snap);
  drawHintHi(cv, "ESC BACK  Q QUIT", `TOP ${PROCESS_LIMIT_HI} BY CPU · BOSS > ${PROCESS_BOSS_CPU}%`);
}
