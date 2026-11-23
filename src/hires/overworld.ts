/**
 * Hi-res overworld (320×192). Same zones, links and player state as the
 * low-res overworld; node positions map through `hiPos`.
 */
import { mix, type PixelCanvas } from "../engine/canvas.ts";
import { drawText, textWidth } from "../engine/font5x7.ts";
import { P } from "../engine/palette.ts";
import { bayer, bevel, bricks, disc, dither, drawDimmed, glow, line, outlined } from "../engine/paint.ts";
import { cpuTotalPct, fmtBytes, fmtPct, hash, pressureColor, type DrawCtx } from "../world/common.ts";
import { ZONES, zoneLocked, type OverworldState, type ZoneId } from "../world/overworld.ts";
import {
  BOSS, CART, FLAME, PADLOCK, PINE, SLIMES, TREE, W, X,
  drawGrassField, drawHintHi, drawHudHi, drawMountains, drawNightSky, drawRobot, drawSmokeHi,
} from "./common.ts";

/** Low-res node coordinates → hi-res "door" points (where the player stands). */
export function hiPos(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(((p.x - 14) * 100) / 26 + 60), y: Math.round(((p.y - 22) * 64) / 15 + 104) };
}

const GROUND_Y = 84;

// ---------------------------------------------------------------- paths

function pathH(cv: PixelCanvas, x0: number, x1: number, y: number): void {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let x = a - 5; x <= b + 5; x++) {
    for (let yy = -5; yy <= 4; yy++) {
      const edge = yy === -5 || yy === 4;
      const h = hash(x, y + yy, 21);
      cv.set(x, y + yy, edge ? P.pathDark : h < 0.05 ? P.pathDark : h > 0.96 ? P.white : P.path);
    }
  }
}

function pathV(cv: PixelCanvas, x: number, y0: number, y1: number): void {
  const a = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  for (let y = a - 5; y <= b + 4; y++) {
    for (let xx = -5; xx <= 4; xx++) {
      const edge = xx === -5 || xx === 4;
      const h = hash(x + xx, y, 21);
      cv.set(x + xx, y, edge ? P.pathDark : h < 0.05 ? P.pathDark : h > 0.96 ? P.white : P.path);
    }
  }
}

// ---------------------------------------------------------------- structures

const STONE = { base: P.stone, light: P.stoneLight, dark: P.stoneDark, mortar: P.stoneDeep };

function castle(cv: PixelCanvas, dx: number, dy: number, ctx: DrawCtx): void {
  const cl = ctx.snap.cpu?.clusters ?? [];
  const e = ctx.sm.get("hi.cpu.e", cl.find((c) => c.kind === "E")?.activePct ?? 0, ctx.dt);
  const p = ctx.sm.get("hi.cpu.p", cl.find((c) => c.kind === "P")?.activePct ?? 0, ctx.dt);

  // smoke behind the towers
  drawSmokeHi(cv, dx - 24, dy - 58, e / 100, ctx.t, 1);
  drawSmokeHi(cv, dx + 24, dy - 58, p / 100, ctx.t, 2);

  outlined(cv, X.outline, (l) => {
    // keep
    bricks(l, dx - 20, dy - 32, 40, 32, STONE, 8, 4);
    for (let x = dx - 20; x < dx + 20; x += 8) bevel(l, x, dy - 37, 5, 5, P.stone, P.stoneLight, P.stoneDark);
    // towers
    for (const [tx, roof, roofLight, roofDark] of [
      [dx - 30, P.eBrick, P.eBrickLight, P.eBrickDark],
      [dx + 18, P.pBrick, P.pBrickLight, P.pBrickDark],
    ] as const) {
      bricks(l, tx, dy - 42, 12, 42, STONE, 6, 3, tx);
      // conical roof
      for (let r = 0; r < 13; r++) {
        const half = Math.round((r / 12) * 8);
        for (let xx = -half; xx <= half; xx++) {
          const c = xx < -half / 3 ? roofLight : xx > half / 3 ? roofDark : roof;
          l.set(tx + 6 + xx, dy - 55 + r, r % 4 === 3 ? mix(c, X.outline, 0.25) : c);
        }
      }
      // flagpole
      l.vline(tx + 6, dy - 62, dy - 56, P.metalLight);
      // window
      l.rect(tx + 5, dy - 30, 2, 5, X.window);
    }
    // gate
    l.rect(dx - 7, dy - 16, 14, 16, X.outline);
    for (let x = dx - 6; x <= dx + 6; x += 3) l.vline(x, dy - 15, dy - 1, P.metal);
    l.hline(dx - 6, dx + 6, dy - 10, P.metal);
    for (let i = -7; i <= 7; i++) l.set(dx + i, dy - 17 - Math.round(Math.sqrt(Math.max(0, 49 - i * i)) * 0.4), P.stoneLight);
  });
  // flags (outside outline pass so they stay bright)
  for (const [fx, c, act] of [[dx - 24, P.eBrickLight, e], [dx + 24, P.pBrickLight, p]] as const) {
    const wave = Math.floor(ctx.t * 6) % 3;
    for (let i = 1; i <= 6; i++) {
      const off = Math.round(Math.sin((i + wave) * 1.2) * 0.8);
      cv.vline(fx + i, dy - 62 + off, dy - 59 + off, i < 3 ? mix(c, P.white, 0.3) : c);
    }
    if (act > 85) cv.blit(FLAME[Math.floor(ctx.t * 10 + fx) % 3]!, fx - 3, dy - 70);
    glow(cv, fx, dy - 28, 6, X.window, 0.4);
  }
}

function waterTower(cv: PixelCanvas, dx: number, dy: number, ctx: DrawCtx): void {
  const m = ctx.snap.memory;
  const frac = ctx.sm.get("hi.mem", m ? m.usedB / m.totalB : 0, ctx.dt);
  const tankTop = dy - 52;
  const tankBot = dy - 24;
  outlined(cv, X.outline, (l) => {
    // legs + braces
    for (const [x0, x1] of [[dx - 20, dx - 26], [dx + 20, dx + 26], [dx - 8, dx - 10], [dx + 8, dx + 10]] as const) {
      line(l, x0, tankBot, x1, dy - 1, P.metal);
      line(l, x0 + 1, tankBot, x1 + 1, dy - 1, P.metalLight);
    }
    line(l, dx - 22, tankBot + 4, dx + 22, dy - 8, P.stoneDark);
    line(l, dx + 22, tankBot + 4, dx - 22, dy - 8, P.stoneDark);
    // ladder
    l.vline(dx - 3, tankBot, dy - 1, P.wood);
    l.vline(dx + 3, tankBot, dy - 1, P.wood);
    for (let y = tankBot + 2; y < dy; y += 3) l.hline(dx - 2, dx + 2, y, P.woodDark);
    // tank: cylinder shading
    for (let x = -24; x <= 24; x++) {
      const k = (x + 24) / 48;
      const c = k < 0.18 ? P.metalLight : k > 0.78 ? P.stoneDark : k > 0.6 ? P.metal : mix(P.metal, P.metalLight, 0.4);
      l.vline(dx + x, tankTop, tankBot, c);
    }
    for (const by of [tankTop + 4, tankBot - 4]) {
      l.hline(dx - 24, dx + 24, by, P.stoneDark);
      for (let x = -22; x <= 22; x += 4) l.set(dx + x, by - 1, P.metalLight);
    }
    // roof cone
    for (let r = 0; r < 9; r++) {
      const half = Math.round(6 + (r / 8) * 20);
      for (let x = -half; x <= half; x++) l.set(dx + x, tankTop - 9 + r, x < -half / 3 ? P.metalLight : x > half / 3 ? P.stoneDark : P.metal);
    }
    l.vline(dx, tankTop - 13, tankTop - 9, P.metalLight);
  });
  // gauge window with live level
  const wx0 = dx - 14;
  const wy0 = tankTop + 7;
  const ww = 28;
  const wh = 14;
  cv.rect(wx0 - 1, wy0 - 1, ww + 2, wh + 2, X.outline);
  cv.rect(wx0, wy0, ww, wh, mix(X.outline, P.wired, 0.4));
  const lvl = Math.round(frac * wh);
  for (let y = 0; y < lvl; y++) {
    const yy = wy0 + wh - 1 - y;
    for (let x = 0; x < ww; x++) {
      const top = y === lvl - 1;
      const wave = top && (x + Math.floor(ctx.t * 8)) % 6 < 2;
      cv.set(wx0 + x, yy, wave ? P.waterHi : top ? P.appLight : dither(x, yy, P.app, P.wired, y / wh * 0.6));
    }
  }
  cv.vline(wx0 + 2, wy0 + 1, wy0 + 5, mix(P.white, P.glass, 0.4));
  // pressure lamp
  const pc = pressureColor(m?.pressure);
  const on = m?.pressure !== "critical" || Math.sin(ctx.t * 10) > 0;
  if (on) glow(cv, dx, tankTop - 15, 7, pc, 0.7);
  disc(cv, dx, tankTop - 15, 2, on ? pc : P.stoneDark);
  // overflow pipe + drips
  cv.rect(dx + 25, tankBot - 6, 10, 3, P.metal);
  cv.hline(dx + 25, dx + 34, tankBot - 6, P.metalLight);
  cv.rect(dx + 32, tankBot - 6, 3, dy - (tankBot - 6) - 2, P.metal);
  cv.vline(dx + 32, tankBot - 6, dy - 3, P.metalLight);
  if (m && m.swapUsedB > 0) {
    const fall = Math.floor((ctx.t * 14) % 8);
    cv.set(dx + 33, dy - 2 + Math.min(1, fall), P.swapLight);
    disc(cv, dx + 33, dy + 1, 1, P.swap);
  }
}

const BRICK_RED = { base: X.brickRed, light: X.brickRedLight, dark: X.brickRedDark, mortar: X.mortarRed };

function powerPlant(cv: PixelCanvas, dx: number, dy: number, ctx: DrawCtx): void {
  const watts = ctx.sm.get("hi.pwr", ctx.snap.power?.packageW ?? 0, ctx.dt);
  const heat = Math.min(1, watts / 15);
  // No power reading (no sudo): no smoke or chimney glow, since both encode watts.
  const live = !!ctx.snap.power;
  if (live) drawSmokeHi(cv, dx + 27, dy - 62, 0.25 + heat * 0.75, ctx.t, 3);
  outlined(cv, X.outline, (l) => {
    bricks(l, dx - 24, dy - 26, 44, 26, BRICK_RED, 8, 4);
    // sawtooth roof
    for (let i = 0; i < 4; i++) {
      for (let r = 0; r < 8; r++) {
        const x0 = dx - 24 + i * 11;
        for (let x = 0; x <= Math.round((r / 7) * 10); x++) l.set(x0 + x, dy - 34 + r, x === 0 ? P.metalLight : r < 2 ? P.metalLight : P.metal);
      }
    }
    // chimney with stripes
    for (let y = dy - 58; y < dy; y++) {
      const band = Math.floor((y - (dy - 58)) / 6) % 2 === 0;
      for (let x = 0; x < 9; x++) {
        const base = band ? P.white : P.crit;
        const c = x === 0 ? mix(base, P.white, 0.4) : x >= 7 ? mix(base, X.outline, 0.35) : base;
        l.set(dx + 23 + x, y, c);
      }
    }
    l.hline(dx + 22, dx + 32, dy - 59, P.stoneDark);
    // door
    l.rect(dx - 4, dy - 10, 8, 10, P.woodDark);
    l.vline(dx, dy - 10, dy - 1, X.outline);
  });
  // windows glow with watts
  for (let i = 0; i < 3; i++) {
    const wx = dx - 20 + i * 14;
    if (i === 1) continue;
    cv.rect(wx, dy - 20, 6, 6, mix(X.outline, X.window, 0.25 + heat * 0.75));
    cv.hline(wx, wx + 5, dy - 17, X.outline);
    cv.vline(wx + 3, dy - 20, dy - 15, X.outline);
    if (heat > 0.3) glow(cv, wx + 3, dy - 17, 6, X.window, heat * 0.5);
  }
  // bolt sign
  const bolt = [[2, 0], [1, 1], [0, 2], [1, 2], [2, 2], [1, 3], [0, 4]];
  for (const [bx, by] of bolt) cv.set(dx + 7 + bx!, dy - 9 + by!, P.accent);
  // chimney mouth glow
  if (live) glow(cv, dx + 27, dy - 60, 5 + Math.round(heat * 4), mix(P.ember, P.lavaHi, heat), 0.5 + heat * 0.4);
}

function lavaPit(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  const th = ctx.snap.thermal;
  const level = th === "nominal" ? 0.2 : th === "moderate" ? 0.55 : th ? 1 : 0;
  outlined(cv, X.outline, (l) => {
    for (let i = -9; i <= 9; i++) {
      const d = Math.round(Math.sqrt(81 - i * i) * 0.45);
      for (let j = -d; j <= d; j++) l.set(x + i, y + j, Math.abs(j) === d || Math.abs(i) === 9 ? X.rock : X.rockDark);
    }
  });
  for (let i = -7; i <= 7; i++) {
    const d = Math.round(Math.sqrt(49 - i * i) * 0.35);
    for (let j = -d; j <= d; j++) {
      const hot = hash(i, j + Math.floor(ctx.t * 4), 33) < level;
      cv.set(x + i, y + j, hot ? (hash(i, j, Math.floor(ctx.t * 6)) > 0.7 ? P.lavaHi : P.lava) : P.ember);
    }
  }
  if (level > 0.5) glow(cv, x, y - 2, 10, P.lava, level * 0.5);
}

function cloudIsland(cv: PixelCanvas, dx: number, dy: number, ctx: DrawCtx): void {
  // packets: inbound (green) right→left high, outbound (yellow) left→right low
  const rx = Math.min(1, Math.log10(1 + (ctx.snap.net?.rxBps ?? 0)) / 7);
  const tx = Math.min(1, Math.log10(1 + (ctx.snap.net?.txBps ?? 0)) / 7);
  const streak = (hx: number, y: number, dir: number, c: number) => {
    for (let k = 0; k < 10; k++) {
      const px = Math.round(hx - dir * k);
      if (k < 3 || k / 10 < 1 - bayer(px, y)) cv.set(px, y, k === 0 ? P.white : c);
    }
  };
  for (let i = 0; i < Math.round(rx * 8); i++) streak(W + 10 - ((ctx.t * 70 + i * 47) % (W + 20)), 16 + (i % 3) * 4, -1, P.ok);
  for (let i = 0; i < Math.round(tx * 8); i++) streak(((ctx.t * 70 + i * 47 + 20) % (W + 20)) - 10, 44 + (i % 2) * 4, 1, P.accent);

  outlined(cv, X.cloudOutline, (l) => {
    const blobs = [[-26, 4, 9], [-12, -2, 12], [6, -5, 13], [22, 0, 11], [34, 5, 7], [-34, 7, 6], [0, 6, 12], [18, 7, 9]] as const;
    for (const [bx, by, r] of blobs) disc(l, dx + bx, dy + by, r, P.cloud);
    for (const [bx, by, r] of blobs) {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y > r * r) continue;
          const px = dx + bx + x;
          const py = dy + by + y;
          if (py > dy + 6) l.set(px, py, dither(px, py, P.cloudShade, P.cloud, 0.25));
        }
      }
    }
    // radio mast
    const mx = dx + 22;
    for (let y = dy - 26; y < dy - 8; y++) {
      const half = Math.round(((y - (dy - 26)) / 18) * 3);
      l.set(mx - half, y, P.metal);
      l.set(mx + half, y, P.metalLight);
      if (y % 3 === 0) l.hline(mx - half, mx + half, y, P.stoneDark);
    }
    // dish
    for (let i = -4; i <= 4; i++) l.set(mx - 8 + Math.round(i * 0.3), dy - 18 + i, P.metalLight);
    l.hline(mx - 7, mx - 2, dy - 18, P.metal);
  });
  const blink = Math.sin(ctx.t * 5) > 0;
  if (blink) glow(cv, dx + 22, dy - 28, 5, P.crit, 0.7);
  cv.set(dx + 22, dy - 28, blink ? P.crit : P.ember);
}

function meadow(cv: PixelCanvas, dx: number, dy: number, ctx: DrawCtx): void {
  // back fence
  for (let x = dx - 36; x <= dx + 36; x += 9) {
    bevel(cv, x, dy - 40, 3, 12, P.wood, mix(P.wood, P.white, 0.3), P.woodDark);
  }
  cv.hline(dx - 36, dx + 38, dy - 36, P.woodDark);
  cv.hline(dx - 36, dx + 38, dy - 32, P.woodDark);
  // critters
  const busy = ctx.snap.procs.filter((p) => p.cpuPct > 5).slice(0, 6);
  busy.forEach((p, i) => {
    const speed = 0.4 + Math.min(1, p.cpuPct / 100) * 1.6;
    const lane = i % 3;
    const x = dx - 30 + ((i * 23 + Math.sin(ctx.t * speed * 0.7 + i) * 8 + 300) % 60);
    const hop = Math.abs(Math.sin(ctx.t * speed * 2 + i));
    const y = dy - 24 + lane * 7 - Math.round(hop * 4);
    if (i === 0 && p.cpuPct > 50) {
      outlined(cv, X.outline, (l) => l.blit(BOSS, x - 9, dy - 32 - Math.round(hop * 3)));
      if (Math.floor(ctx.t * 4) % 2) glow(cv, x, dy - 26, 12, P.lava, 0.35);
    } else {
      const [normal, squash] = SLIMES[i % SLIMES.length]!;
      const s = hop < 0.15 ? squash : normal;
      outlined(cv, X.outline, (l) => l.blit(s, x - s.w / 2, y - s.h + 8));
    }
  });
}

function mine(cv: PixelCanvas, dx: number, dy: number, ctx: DrawCtx): void {
  // rocky hill
  outlined(cv, X.outline, (l) => {
    for (let x = -46; x <= 46; x++) {
      const top = dy - 46 + Math.round((x / 46) ** 2 * 34 + Math.sin(x * 0.4) * 2);
      for (let y = top; y < dy - 2; y++) {
        const h = hash(x, y, 41);
        const c = y < top + 2 ? P.grass : h < 0.08 ? X.rockLight : h > 0.9 ? X.rockDark : y < top + 10 ? P.dirt : P.dirtDark;
        l.set(dx + x, y, c);
      }
    }
  });
  // entrance
  for (let y = dy - 28; y < dy - 2; y++) {
    const half = y < dy - 22 ? Math.round(Math.sqrt(Math.max(0, 36 - (y - (dy - 22)) ** 2)) * 1.5) : 9;
    for (let x = -half; x <= half; x++) cv.set(dx + x, y, mix(X.outline, P.stoneDeep, Math.max(0, (y - (dy - 28)) / 40)));
  }
  outlined(cv, X.outline, (l) => {
    bevel(l, dx - 12, dy - 28, 3, 26, P.wood, mix(P.wood, P.white, 0.3), P.woodDark);
    bevel(l, dx + 10, dy - 28, 3, 26, P.wood, mix(P.wood, P.white, 0.3), P.woodDark);
    bevel(l, dx - 14, dy - 31, 29, 4, P.wood, mix(P.wood, P.white, 0.3), P.woodDark);
  });
  // lantern
  cv.vline(dx + 16, dy - 27, dy - 24, P.metal);
  glow(cv, dx + 16, dy - 21, 8, X.window, 0.6);
  cv.rect(dx + 15, dy - 23, 3, 4, X.window);
  // rails heading out of the mine
  for (let x = dx - 70; x <= dx; x++) {
    if (x % 5 === 0) cv.vline(x, dy - 6, dy - 2, P.woodDark);
    cv.set(x, dy - 5, P.metalLight);
    cv.set(x, dy - 3, P.metal);
  }
  // cart: speed by disk throughput, rolls out of the mine and back
  const bps = ctx.sm.get("hi.disk", (ctx.snap.disk?.readBps ?? 0) + (ctx.snap.disk?.writeBps ?? 0), ctx.dt);
  const speed = Math.min(1, Math.log10(1 + bps) / 9);
  if (speed > 0.05) {
    const ph = (ctx.t * speed * 0.35) % 1;
    const pos = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    const cx = Math.round(dx - 6 - pos * 60);
    outlined(cv, X.outline, (l) => l.blit(CART, cx - 7, dy - 13));
  }
}

const TILES: Record<ZoneId, (cv: PixelCanvas, x: number, y: number, ctx: DrawCtx) => void> = {
  cpu: castle, mem: waterTower, power: powerPlant, net: cloudIsland, proc: meadow, disk: mine,
};

/**
 * Locked tiles (data needs sudo): bounding box to dim and where the padlock
 * hangs, relative to the zone's door point.
 */
const LOCK_BOX: Partial<Record<ZoneId, { x: number; y: number; w: number; h: number; lx: number; ly: number }>> = {
  power: { x: -26, y: -64, w: 61, h: 66, lx: -2, ly: -24 },
  net: { x: -42, y: -34, w: 89, h: 52, lx: -28, ly: -2 }, // left lobe: the water tower covers the middle
  disk: { x: -72, y: -48, w: 120, h: 50, lx: 0, ly: -18 },
};

/** Locked zones read `PWR —`; the em dash says "no reading", not zero. */
function labelOf(id: ZoneId, ctx: DrawCtx): string {
  const s = ctx.snap;
  switch (id) {
    case "cpu": return `CPU ${fmtPct(cpuTotalPct(s))}`;
    case "mem": return s.memory ? `MEM ${fmtPct((s.memory.usedB / s.memory.totalB) * 100)}` : "MEM";
    case "power": return s.power ? `PWR ${s.power.packageW.toFixed(1)}W` : "PWR —";
    case "proc": return `PROCS ${s.procs.length}`;
    case "disk": return s.disk ? `DISK ${fmtBytes(s.disk.readBps + s.disk.writeBps)}/S` : "DISK —";
    case "net": return s.net ? `NET ↓${fmtBytes(s.net.rxBps)} ↑${fmtBytes(s.net.txBps)}` : "NET —";
  }
}

export function drawOverworldHi(cv: PixelCanvas, ctx: DrawCtx, st: OverworldState): void {
  drawNightSky(cv, 11, GROUND_Y, ctx.t);
  drawMountains(cv, GROUND_Y - 4, 30, 16);
  drawGrassField(cv, GROUND_Y - 4, 181);

  const pos = Object.fromEntries(Object.values(ZONES).map((z) => [z.id, hiPos(z)])) as Record<ZoneId, { x: number; y: number }>;
  // paths
  pathH(cv, pos.cpu.x, pos.power.x, pos.cpu.y);
  pathH(cv, pos.proc.x, pos.disk.x, pos.proc.y);
  pathV(cv, pos.cpu.x, pos.cpu.y, pos.proc.y);
  pathV(cv, pos.power.x, pos.power.y, pos.disk.y);

  // scenery
  for (const [x, y, kind] of [[106, 92, 0], [122, 96, 1], [200, 90, 1], [212, 95, 0], [128, 150, 0], [146, 156, 1], [176, 148, 1], [190, 157, 0], [300, 92, 1]] as const) {
    outlined(cv, X.outline, (l) => l.blit(kind ? PINE : TREE, x - (kind ? 5 : 7), y - (kind ? 12 : 15)));
  }
  lavaPit(cv, 224, 98, ctx);

  // structures (back to front)
  for (const id of ["net", "cpu", "mem", "power", "proc", "disk"] as ZoneId[]) {
    const { x, y } = pos[id];
    const box = LOCK_BOX[id];
    if (box && zoneLocked(id, ctx.snap)) {
      // 50% checker toward the sky's mid tone, then a padlock over the tile.
      drawDimmed(cv, x + box.x, y + box.y, box.w, box.h, X.sky1, () => TILES[id](cv, x, y, ctx));
    } else TILES[id](cv, x, y, ctx);
  }
  // padlocks after every structure so nothing in front hides them
  for (const id of ["net", "power", "disk"] as const) {
    const box = LOCK_BOX[id]!;
    if (zoneLocked(id, ctx.snap)) outlined(cv, X.outline, (l) => l.blit(PADLOCK, pos[id].x + box.lx - 3, pos[id].y + box.ly - 4));
  }

  // labels
  for (const z of Object.values(ZONES)) {
    const sel = st.selected === z.id;
    const text = labelOf(z.id, ctx);
    const p = pos[z.id];
    const lx = z.id === "net" ? p.x + 50 : Math.round(p.x - textWidth(text) / 2);
    const ly = z.id === "net" ? p.y - 14 : p.y + 6;
    const locked = zoneLocked(z.id, ctx.snap);
    drawText(cv, lx, ly, text, sel ? P.select : locked ? P.dim : P.white, { shadow: X.outline });
    if (sel && Math.sin(ctx.t * 6) > -0.2) drawText(cv, lx - 8, ly, "▸", P.select, { shadow: X.outline });
  }

  // player: map low-res position into hi-res space
  const pp = hiPos(st.player);
  const facingLeft = st.walking && ZONES[st.selected].x < st.player.x - 0.1;
  drawRobot(cv, pp.x, pp.y + 3, ctx.t, st.walking, facingLeft);

  drawHudHi(cv, ctx.snap);
  drawHintHi(cv, `▸ ${ZONES[st.selected].name}   ⏎ ENTER`, "←↑→↓ MOVE  1-6 JUMP  Q QUIT");
}
