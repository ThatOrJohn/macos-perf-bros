/**
 * The overworld: every zone as a live tile on one map (DESIGN.md §7.2).
 * Paths are axis-aligned so the player walks straight between nodes.
 */
import { Frame, mix, sprite, type PixelCanvas } from "../engine/canvas.ts";
import { ditherGradientV, drawDimmed, outlined } from "../engine/paint.ts";
import type { Snapshot } from "../core/snapshot.ts";
import { P } from "../engine/palette.ts";
import {
  PADLOCK, PLAYER, cpuTotalPct, drawCloud, drawGrass, drawHint, drawHud, drawSmoke, drawStars,
  fmtBytes, fmtPct, pressureColor, type DrawCtx,
} from "./common.ts";

const INK = 0x0b0d18;

export type ZoneId = "net" | "cpu" | "mem" | "power" | "proc" | "disk";

export interface ZoneNode {
  id: ZoneId;
  name: string;
  x: number;
  y: number;
  links: ZoneId[];
}

export const ZONES: Record<ZoneId, ZoneNode> = {
  net: { id: "net", name: "NETWORK SKY", x: 40, y: 7, links: ["mem"] },
  cpu: { id: "cpu", name: "CPU FORTRESS", x: 14, y: 22, links: ["mem", "proc"] },
  mem: { id: "mem", name: "MEMORY RESERVOIR", x: 40, y: 22, links: ["cpu", "power", "net"] },
  power: { id: "power", name: "POWER PLANT", x: 66, y: 22, links: ["mem", "disk"] },
  proc: { id: "proc", name: "PROCESS PLAINS", x: 14, y: 37, links: ["cpu", "disk"] },
  disk: { id: "disk", name: "DISK MINES", x: 66, y: 37, links: ["proc", "power"] },
};

/**
 * Zones whose data only exists with sudo (powermetrics). Without it they're
 * drawn dimmed with a padlock and the zone scene shows a locked panel.
 */
export function zoneLocked(id: ZoneId | "overworld", snap: Snapshot): boolean {
  return id === "power" ? !snap.power : id === "net" ? !snap.net : id === "disk" ? !snap.disk : false;
}

export const ZONE_ORDER: ZoneId[] = ["cpu", "mem", "net", "disk", "proc", "power"];

/** The linked zone in a direction from `from`, if any. */
export function neighbor(from: ZoneId, dx: number, dy: number): ZoneId | undefined {
  const a = ZONES[from];
  let best: ZoneId | undefined;
  let bestD = Infinity;
  for (const id of a.links) {
    const b = ZONES[id];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const d = Math.hypot(vx, vy);
    if ((vx * dx + vy * dy) / d > 0.7 && d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

export interface OverworldState {
  selected: ZoneId;
  player: { x: number; y: number };
  walking: boolean;
}

export function newOverworldState(): OverworldState {
  return { selected: "cpu", player: { x: ZONES.cpu.x, y: ZONES.cpu.y }, walking: false };
}

/** Move the player toward the selected node along the path (call every frame). */
export function stepPlayer(s: OverworldState, dt: number): void {
  const target = ZONES[s.selected];
  const speed = 40; // px/s
  const dx = target.x - s.player.x;
  const dy = target.y - s.player.y;
  const d = Math.hypot(dx, dy);
  s.walking = d > 0.5;
  if (!s.walking) {
    s.player.x = target.x;
    s.player.y = target.y;
    return;
  }
  const step = Math.min(d, speed * dt);
  s.player.x += (dx / d) * step;
  s.player.y += (dy / d) * step;
}

// ---------------------------------------------------------------- drawing

function drawPath(cv: PixelCanvas, ax: number, ay: number, bx: number, by: number): void {
  if (ay === by) {
    cv.rect(Math.min(ax, bx), ay, Math.abs(bx - ax) + 1, 3, P.path);
    cv.hline(ax, bx, ay + 3, P.pathDark);
  } else {
    cv.rect(ax - 1, Math.min(ay, by), 3, Math.abs(by - ay) + 3, P.path);
    cv.vline(ax + 2, Math.min(ay, by), Math.max(ay, by) + 2, P.pathDark);
  }
}

function drawLadder(cv: PixelCanvas, x: number, y0: number, y1: number): void {
  cv.vline(x - 2, y0, y1, P.wood);
  cv.vline(x + 2, y0, y1, P.wood);
  for (let y = y0 + 1; y <= y1; y += 2) cv.hline(x - 1, x + 1, y, P.woodDark);
}

function cpuTile(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  // advance the smoothed cluster loads (read back by tileSmoke)
  const cl = ctx.snap.cpu?.clusters ?? [];
  ctx.sm.get("ow.cpu.e", cl.find((c) => c.kind === "E")?.activePct ?? 0, ctx.dt);
  ctx.sm.get("ow.cpu.p", cl.find((c) => c.kind === "P")?.activePct ?? 0, ctx.dt);
  // wall
  cv.rect(x - 6, y - 2, 13, 7, P.stone);
  cv.hline(x - 6, x + 6, y + 4, P.stoneDark);
  for (let i = -6; i <= 6; i += 2) cv.set(x + i, y - 3, P.stone);
  // towers: E left (blue trim), P right (orange trim)
  for (const [tx, trim, trimDark] of [
    [x - 6, P.eBrick, P.eBrickDark],
    [x + 4, P.pBrick, P.pBrickDark],
  ] as const) {
    cv.rect(tx, y - 6, 3, 11, P.stoneLight);
    cv.vline(tx + 2, y - 6, y + 4, P.stoneDark);
    cv.hline(tx, tx + 2, y - 6, trim);
    cv.set(tx, y - 7, trim);
    cv.set(tx + 2, y - 7, trimDark);
    cv.set(tx + 1, y - 2, P.ink); // window
  }
  // gate
  cv.rect(x - 1, y + 1, 3, 4, P.ink);
  cv.set(x, y, P.ink);
}

function memTile(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  const m = ctx.snap.memory;
  const frac = ctx.sm.get("ow.mem", m ? m.usedB / m.totalB : 0, ctx.dt);
  const w = 11;
  const h = 9;
  const x0 = x - 5;
  const y0 = y - 4;
  cv.rect(x0 - 1, y0 - 1, w + 2, h + 2, P.stoneDark);
  cv.rect(x0, y0, w, h, P.stoneDeep);
  const level = Math.round(frac * h);
  for (let yy = 0; yy < level; yy++) {
    const py = y0 + h - 1 - yy;
    const top = yy === level - 1;
    for (let xx = 0; xx < w; xx++) {
      const ripple = top && (xx + Math.floor(ctx.t * 4)) % 4 === 0;
      cv.set(x0 + xx, py, ripple ? P.waterHi : top ? P.appLight : P.app);
    }
  }
  // pressure lamp + glass glint
  cv.set(x0 + w, y0 - 2, pressureColor(m?.pressure));
  cv.vline(x0 + 1, y0, y0 + 2, P.glass);
  // overflow pipe (drips when swapping)
  cv.hline(x0 + w + 1, x0 + w + 3, y0 + 1, P.metal);
  if (m && m.swapUsedB > 0) {
    const dy = Math.floor((ctx.t * 6) % 5);
    cv.set(x0 + w + 3, y0 + 2 + dy, P.swapLight);
  }
}

function powerTile(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  const w = ctx.sm.get("ow.pwr", ctx.snap.power?.packageW ?? 0, ctx.dt);
  const heat = Math.min(1, w / 15);
  cv.rect(x - 6, y - 2, 11, 7, P.metal);
  cv.hline(x - 6, x + 4, y - 2, P.metalLight);
  cv.rect(x - 4, y, 2, 2, mix(P.ink, P.glow, 0.3 + heat * 0.7));
  cv.rect(x + 1, y, 2, 2, mix(P.ink, P.glow, 0.3 + heat * 0.7));
  // chimney
  cv.rect(x + 4, y - 8, 3, 13, P.stoneDark);
  cv.hline(x + 4, x + 6, y - 8, mix(P.ember, P.lavaHi, heat));
  // lava pool sized by thermal pressure
  const th = ctx.snap.thermal;
  const lava = th === "nominal" ? 0.25 : th === "moderate" ? 0.5 : th ? 1 : 0;
  for (let i = 0; i < Math.round(lava * 12); i++) {
    const bub = Math.sin(ctx.t * 5 + i) > 0.7;
    cv.set(x - 6 + i, y + 5, bub ? P.lavaHi : P.lava);
  }
}

// Process critters: original slime blobs, colored per slot; the boss glows hot.
export const SLIME_COLORS = [P.bodyTeal, P.compressedLight, P.warn, P.grassLight, P.eBrickLight, P.pBrickLight];
const slime = (c: number) => sprite([".ss.", "sese", "ssss"], { s: c, e: P.ink });
export const SLIMES = SLIME_COLORS.map(slime);
export const BOSS = sprite(["..s..", ".sss.", "seses", "sssss"], { s: P.lava, e: P.lavaHi });

function procTile(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  // fence
  for (let i = -7; i <= 7; i += 3) cv.vline(x + i, y + 2, y + 4, P.wood);
  cv.hline(x - 7, x + 7, y + 3, P.woodDark);
  const busy = ctx.snap.procs.filter((p) => p.cpuPct > 5).slice(0, 6);
  busy.forEach((p, i) => {
    const speed = 0.3 + Math.min(1, p.cpuPct / 100) * 1.5;
    const ex = x - 7 + ((i * 5 + Math.sin(ctx.t * speed + i) * 3 + 21) % 14);
    const ey = y - 3 + (i % 2) * 3;
    if (i === 0 && p.cpuPct > 50) cv.blit(BOSS, ex - 1, ey - 1);
    else cv.blit(SLIMES[i % SLIMES.length]!, ex, ey + (Math.sin(ctx.t * 4 + i) > 0.6 ? -1 : 0));
  });
}

const CART = sprite(["wwwww", ".k.k."], { w: P.wood, k: P.ink });

function diskTile(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  // hillside + mine arch
  for (let yy = -5; yy <= 4; yy++) {
    const half = Math.min(9, 4 + (yy + 5));
    cv.hline(x - half, x + half, y + yy, yy < -3 ? P.dirt : P.dirtDark);
  }
  cv.rect(x - 2, y - 2, 5, 7, P.ink);
  cv.hline(x - 3, x + 3, y - 3, P.wood);
  cv.vline(x - 3, y - 3, y + 4, P.wood);
  cv.vline(x + 3, y - 3, y + 4, P.wood);
  // rails + cart, speed by throughput
  cv.hline(x - 9, x + 9, y + 5, P.metal);
  const bps = ctx.sm.get("ow.disk", (ctx.snap.disk?.readBps ?? 0) + (ctx.snap.disk?.writeBps ?? 0), ctx.dt);
  const speed = Math.min(1, Math.log10(1 + bps) / 9);
  if (speed > 0.05) cv.blit(CART, x - 9 + ((ctx.t * speed * 20) % 16), y + 3);
}

function netTile(cv: PixelCanvas, x: number, y: number, ctx: DrawCtx): void {
  drawCloud(cv, x, y, 9, 3);
  // dish
  cv.set(x + 3, y - 4, P.metalLight);
  cv.hline(x + 2, x + 4, y - 5, P.metalLight);
  cv.set(x + 3, y - 6, Math.sin(ctx.t * 6) > 0 ? P.crit : P.ember);
  // packets: inbound right→left above, outbound left→right below
  const rx = Math.min(1, Math.log10(1 + (ctx.snap.net?.rxBps ?? 0)) / 7);
  const tx = Math.min(1, Math.log10(1 + (ctx.snap.net?.txBps ?? 0)) / 7);
  // streaks: bright head, fading tail
  const streak = (hx: number, y: number, dir: number, c: number) => {
    for (let k = 0; k < 4; k++) cv.set(hx - dir * k, y, mix(c, P.skyTop, k / 4));
  };
  for (let i = 0; i < Math.round(rx * 6); i++) streak(79 - ((ctx.t * 22 + i * 13) % 84), 2 + (i % 2) * 2, -1, P.ok);
  for (let i = 0; i < Math.round(tx * 6); i++) streak((ctx.t * 22 + i * 13 + 6) % 84, 13 + (i % 2), 1, P.accent);
}

/** Smoke drawn after the tiles so it isn't ink-outlined. */
function tileSmoke(cv: PixelCanvas, id: ZoneId, x: number, y: number, ctx: DrawCtx): void {
  if (id === "cpu") {
    const cl = ctx.snap.cpu?.clusters ?? [];
    drawSmoke(cv, x - 5, y - 8, ctx.sm.get("ow.cpu.e", cl.find((c) => c.kind === "E")?.activePct ?? 0, 0) / 100, ctx.t, 1);
    drawSmoke(cv, x + 5, y - 8, ctx.sm.get("ow.cpu.p", cl.find((c) => c.kind === "P")?.activePct ?? 0, 0) / 100, ctx.t, 2);
  } else if (id === "power" && ctx.snap.power) {
    const heat = Math.min(1, ctx.sm.get("ow.pwr", ctx.snap.power?.packageW ?? 0, 0) / 15);
    drawSmoke(cv, x + 5, y - 10, 0.25 + heat * 0.75, ctx.t, 3);
  }
}

const TILES: Record<ZoneId, (cv: PixelCanvas, x: number, y: number, ctx: DrawCtx) => void> = {
  net: netTile, cpu: cpuTile, mem: memTile, power: powerTile, proc: procTile, disk: diskTile,
};

/** Locked zones read `PWR —`; the em dash says "no reading", not zero. */
function label(id: ZoneId, ctx: DrawCtx): string {
  const s = ctx.snap;
  switch (id) {
    case "cpu": return `CPU ${fmtPct(cpuTotalPct(s))}`;
    case "mem": return s.memory ? `MEM ${fmtPct((s.memory.usedB / s.memory.totalB) * 100)}` : "MEM";
    case "power": return s.power ? `PWR ${s.power.packageW.toFixed(1)}W` : "PWR —";
    case "proc": return `PROCS ${s.procs.length}`;
    case "disk": return s.disk ? `DISK ${fmtBytes(s.disk.readBps + s.disk.writeBps)}/s` : "DISK —";
    case "net": return s.net ? `NET ↓${fmtBytes(s.net.rxBps)}` : "NET —";
  }
}

export function drawOverworld(f: Frame, ctx: DrawCtx, st: OverworldState): void {
  const cv = f.canvas;
  // sky, stars, far hills
  ditherGradientV(cv, 0, 0, 80, 16, [0x111630, 0x1b2347, 0x29356a, 0x3d4f88]);
  drawStars(cv, 12, ctx.t);
  for (let x = 0; x < 80; x++) {
    const h = 12 + Math.round(Math.sin(x * 0.12) * 2 + Math.sin(x * 0.31 + 1) * 1.5);
    cv.rect(x, h, 1, 16 - h, P.hill);
    cv.set(x, h, P.hillLight);
  }
  drawGrass(cv, 16, 46);

  // paths (beneath tiles)
  const drawn = new Set<string>();
  for (const z of Object.values(ZONES)) {
    for (const l of z.links) {
      const key = [z.id, l].sort().join("-");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const b = ZONES[l];
      if (key === "mem-net") drawLadder(cv, z.x === 40 ? 40 : b.x, Math.min(z.y, b.y) + 3, Math.max(z.y, b.y) - 5);
      else drawPath(cv, z.x, z.y + 1, b.x, b.y + 1);
    }
  }

  // tiles + labels
  for (const z of Object.values(ZONES)) {
    const locked = zoneLocked(z.id, ctx.snap);
    const draw = () => {
      if (z.id === "net" || z.id === "proc") TILES[z.id](cv, z.x, z.y, ctx);
      else outlined(cv, INK, (l) => TILES[z.id](l, z.x, z.y, ctx));
    };
    if (locked) {
      // Dim the tile toward the dark stone and hang a padlock on it.
      drawDimmed(cv, z.x - 11, z.y - 11, 23, 18, P.stoneDeep, draw);
      outlined(cv, INK, (l) => l.blit(PADLOCK, z.x - 1, z.y - 2));
    } else draw();
    tileSmoke(cv, z.id, z.x, z.y, ctx);
    const sel = st.selected === z.id;
    const text = label(z.id, ctx);
    const row = z.id === "net" ? Frame.rowOf(z.y) : Frame.rowOf(z.y + 6);
    const col = z.id === "net" ? z.x + 11 : Math.round(z.x - text.length / 2);
    if (sel && Math.sin(ctx.t * 6) > -0.2) f.text(col - 1, row, "▸", P.select);
    // Locked labels sit on the dimmed tile; an ink backing keeps them legible.
    f.text(col, row, text, sel ? P.select : locked ? P.dim : P.white, locked ? P.ink : undefined, sel);
  }

  // player
  const frame = st.walking ? Math.floor(ctx.t * 8) % 2 : 0;
  cv.blit(PLAYER[frame]!, st.player.x - 2, st.player.y - 2 + (st.walking ? 0 : Math.round(Math.sin(ctx.t * 3) * 0.5)));

  drawHud(f, ctx.snap);
  const z = ZONES[st.selected];
  drawHint(f, `▸ ${z.name}  ⏎ enter`, "←↑→↓ move  1-6 jump  q quit");
}

