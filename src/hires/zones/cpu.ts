/**
 * Hi-res CPU Fortress: a castle courtyard with one brick tower per core.
 * Tower height = core busy %, banner height = cluster freq / max,
 * towers above 85% burn.
 */
import { mix, type Color, type PixelCanvas } from "../../engine/canvas.ts";
import { drawText, drawTextCentered, textWidth } from "../../engine/font5x7.ts";
import { P } from "../../engine/palette.ts";
import { bevel, bricks, glow, outlined, type BrickStyle } from "../../engine/paint.ts";
import { fmtPct, hash, type DrawCtx } from "../../world/common.ts";
import type { CoreKind } from "../../core/snapshot.ts";
import { FLAME, W, X, drawHintHi, drawHudHi, drawMountains, drawNightSky } from "../common.ts";

const FLOOR = 150;
const MAX_H = 92;
const WALL_TOP = 50;

const STYLE: Record<CoreKind, BrickStyle & { name: string; text: Color }> = {
  E: { base: P.eBrick, light: P.eBrickLight, dark: P.eBrickDark, mortar: mix(P.eBrickDark, X.outline, 0.5), name: "EFFICIENCY", text: P.eBrickLight },
  P: { base: P.pBrick, light: P.pBrickLight, dark: P.pBrickDark, mortar: mix(P.pBrickDark, X.outline, 0.5), name: "PERFORMANCE", text: P.pBrickLight },
};
const BACK_WALL: BrickStyle = { base: 0x2f3142, light: 0x3c3f55, dark: 0x25273a, mortar: 0x1c1d2b };

function courtyard(cv: PixelCanvas, t: number): void {
  drawNightSky(cv, 11, FLOOR, t);
  drawMountains(cv, FLOOR - 30, 40, 22, 2.1);
  // floor flagstones
  for (let y = FLOOR; y < 181; y++) {
    for (let x = 0; x < W; x++) {
      const row = Math.floor((y - FLOOR) / 8);
      const bx = (x + (row % 2) * 8) % 16;
      const by = (y - FLOOR) % 8;
      let c: Color = P.stone;
      if (by === 7 || bx === 15) c = P.stoneDeep;
      else if (by === 0 || bx === 0) c = P.stoneLight;
      else if (hash(x >> 2, y >> 1, 5) < 0.08) c = P.stoneDark;
      cv.set(x, y, c);
    }
  }
}

function backWall(cv: PixelCanvas, x0: number, x1: number): void {
  outlined(cv, X.outline, (l) => {
    bricks(l, x0, WALL_TOP, x1 - x0, FLOOR - WALL_TOP, BACK_WALL, 10, 5, x0);
    for (let x = x0; x < x1; x += 10) bevel(l, x, WALL_TOP - 6, 6, 6, BACK_WALL.base, BACK_WALL.light, BACK_WALL.dark);
  });
  // arched windows in the back wall
  for (let x = x0 + 14; x < x1 - 10; x += 34) {
    cv.rect(x, WALL_TOP + 12, 6, 12, X.outline);
    cv.rect(x + 1, WALL_TOP + 10, 4, 2, X.outline);
    cv.rect(x + 1, WALL_TOP + 14, 4, 8, mix(X.outline, X.window, 0.25));
  }
}

function tower(cv: PixelCanvas, x: number, w: number, h: number, s: BrickStyle, t: number, seed: number): void {
  const top = FLOOR - h;
  outlined(cv, X.outline, (l) => {
    bricks(l, x, top, w, h, s, 8, 4, seed);
    // cap with merlons, 2 px wider than the shaft
    bevel(l, x - 2, top - 4, w + 4, 4, s.base, s.light, s.dark);
    for (let mx = x - 2; mx < x + w + 2; mx += 6) bevel(l, mx, top - 8, 4, 4, s.base, s.light, s.dark);
    // arrow slit
    if (h > 26) l.rect(x + Math.floor(w / 2) - 1, top + 8, 2, 7, X.outline);
  });
  // heat: flames on top above 85%
  const heat = (h / MAX_H - 0.85) / 0.15;
  if (heat > 0) {
    glow(cv, x + w / 2, top - 10, 14, P.lava, 0.35 + heat * 0.3);
    for (let fx = x; fx < x + w - 2; fx += 6) cv.blit(FLAME[Math.floor(t * 10 + fx + seed) % 3]!, fx, top - 14 - (fx % 2));
  }
}

function banner(cv: PixelCanvas, poleX: number, ratio: number, s: BrickStyle, letter: string, t: number, right: boolean): void {
  const poleTop = WALL_TOP - 4;
  outlined(cv, X.outline, (l) => {
    l.vline(poleX, poleTop, FLOOR - 1, P.metalLight);
    l.vline(poleX + 1, poleTop, FLOOR - 1, P.metal);
    l.rect(poleX - 1, poleTop - 2, 4, 2, P.accent);
  });
  const fy = Math.round(FLOOR - 16 - ratio * (FLOOR - 16 - poleTop - 2));
  const dir = right ? 1 : -1;
  const startX = right ? poleX + 2 : poleX - 1;
  outlined(cv, X.outline, (l) => {
    for (let i = 0; i < 14; i++) {
      const wave = Math.round(Math.sin(t * 6 - i * 0.6) * 1.2 * (i / 14));
      for (let j = 0; j < 10; j++) {
        const c = j === 0 ? s.light : j >= 8 ? s.dark : i < 2 ? s.light : s.base;
        l.set(startX + dir * i, fy + j + wave, c);
      }
    }
  });
  drawText(cv, startX + dir * 7 - 2, fy + 2 + Math.round(Math.sin(t * 6 - 4) * 0.6), letter, P.white);
}

export function drawCpuZoneHi(cv: PixelCanvas, ctx: DrawCtx): void {
  courtyard(cv, ctx.t);
  drawTextCentered(cv, W / 2, 14, "CPU FORTRESS", P.accent, { shadow: X.outline });
  const cpu = ctx.snap.cpu;

  (["E", "P"] as const).forEach((kind, wi) => {
    const s = STYLE[kind];
    const x0 = wi === 0 ? 16 : 168;
    const x1 = wi === 0 ? 152 : 304;
    const cores = cpu?.cores.filter((c) => c.kind === kind) ?? [];
    const cl = cpu?.clusters.find((c) => c.kind === kind);
    backWall(cv, x0, x1);

    const n = Math.max(1, cores.length);
    const gap = n > 6 ? 4 : 10;
    const span = x1 - x0 - 12;
    const w = Math.max(6, Math.min(24, Math.floor((span - gap * (n - 1)) / n)));
    const used = w * n + gap * (n - 1);
    const start = x0 + 6 + Math.floor((span - used) / 2);

    cores.forEach((core, i) => {
      const pct = ctx.sm.get(`hi.core.${core.id}`, core.activePct, ctx.dt);
      const h = Math.max(4, Math.round((pct / 100) * MAX_H));
      const x = start + i * (w + gap);
      tower(cv, x, w, h, s, ctx.t, core.id);
      const mid = x + w / 2;
      const hot = pct > 85;
      drawTextCentered(cv, mid, FLOOR + 6, fmtPct(pct), hot ? P.lavaHi : P.white, { shadow: X.outline });
      drawTextCentered(cv, mid, FLOOR + 16, `${kind}${i}`, P.stoneLight, { bg: P.stoneDeep });
    });

    // header text + banner
    const freq = ctx.sm.get(`hi.freq.${kind}`, cl?.freqMHz ?? 0, ctx.dt);
    const max = cl?.maxFreqMHz || 1;
    const busy = ctx.sm.get(`hi.busy.${kind}`, cl?.activePct ?? 0, ctx.dt);
    const mid = (x0 + x1) / 2;
    drawTextCentered(cv, mid, 25, `${s.name} ×${cores.length}`, s.text, { shadow: X.outline });
    const sub = `${Math.round(freq)}/${max} MHZ  BUSY ${fmtPct(busy)}`;
    drawText(cv, Math.round(mid - textWidth(sub) / 2), 35, sub, P.white, { shadow: X.outline });
    banner(cv, wi === 0 ? 7 : 312, Math.min(1, freq / max), s, kind, ctx.t, wi === 0);
  });

  drawHudHi(cv, ctx.snap);
  const pw = ctx.snap.power;
  drawHintHi(cv, "ESC BACK  Q QUIT", pw ? `CPU ${pw.cpuW.toFixed(1)}W  ANE ${pw.aneW.toFixed(1)}W` : "");
}
