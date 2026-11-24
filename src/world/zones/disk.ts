/**
 * Disk Mines (DESIGN.md §7.3). Reads carry ore uphill/out, writes carry stone
 * downhill/in. Nonzero ops/s sets 1–7 carts per track (log cap 100k ops/s).
 * Directional bytes/s sets speed (8–35% of track/s, log cap 1 GB/s).
 * Total ops/s sets wall lantern flicker (0.4–2.5 Hz, same ops scale).
 * The top three I/O processes get miners whose combined bytes/s sets pickaxe
 * cadence (0.35–1.8 Hz, same throughput scale). Signs give the raw rates.
 */
import { mix, sprite, type Frame, type PixelCanvas } from "../../engine/canvas.ts";
import { blitOutlined, bricks, line, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { stamped } from "../../engine/stamp.ts";
import { PLAYER, drawHint, drawHud, drawLockedPanel, fmtRate, type DrawCtx } from "../common.ts";
import { diskRate, railY, type DiskMines } from "../disk-mines.ts";
import { processName } from "../process-field.ts";

const LEFT = 5;
const RIGHT = 74;
const RISE = 3;
const READ_RAIL = 14;
const WRITE_RAIL = 25;
const LANTERNS = [8, 40, 71];
const MINER_X = [14, 40, 66];
const ROCK = {
  base: P.stoneDeep,
  light: mix(P.stoneDeep, P.stoneDark, 0.45),
  dark: mix(P.stoneDeep, P.ink, 0.25),
  mortar: mix(P.stoneDeep, P.ink, 0.55),
};

const ORE_CART = sprite([".gg..", "wwwww", ".k.k."], { g: P.waterHi, w: P.wood, k: P.ink });
const STONE_CART = sprite([".gg..", "wwwww", ".k.k."], { g: P.stone, w: P.wood, k: P.ink });

function drawTunnel(cv: PixelCanvas, low: number): void {
  for (let x = 2; x < 78; x++) {
    const y = railY(x, LEFT, RIGHT, low, RISE);
    cv.vline(x, y - 4, y, P.ink);
    if (x % 4 === 0) cv.set(x, y + 1, P.woodDark);
    cv.set(x, y, P.metalLight);
  }
  for (const x of [1, 78]) {
    const y = railY(x, LEFT, RIGHT, low, RISE);
    cv.vline(x, y - 5, y + 1, P.wood);
  }
}

function drawMiner(cv: PixelCanvas, x: number, striking: boolean): void {
  outlined(cv, P.ink, (l) => {
    l.blit(PLAYER[0]!, x - 2, 31);
    l.hline(x - 1, x + 1, 31, P.metalLight);
    l.set(x + 1, 31, P.glow);
    const tipX = x + (striking ? 5 : 3);
    const tipY = striking ? 35 : 32;
    line(l, x + 2, 36, tipX, tipY, P.wood);
    l.hline(tipX, tipX + 1, tipY, P.metalLight);
  });
}

export function drawDiskZone(f: Frame, ctx: DrawCtx, mine: DiskMines): void {
  const cv = f.canvas;
  stamped(cv, "disk.wall", (l) => bricks(l, 0, 0, 80, 44, ROCK, 7, 4));
  drawHud(f, ctx.snap);
  f.centered(40, 1, "DISK MINES", P.accent, P.hudBg, true);
  const disk = ctx.snap.disk;
  if (!disk) {
    drawLockedPanel(f);
    drawHint(f, "esc back  q quit", "no data without sudo");
    return;
  }

  stamped(cv, "disk.tunnels", (l) => {
    drawTunnel(l, READ_RAIL);
    drawTunnel(l, WRITE_RAIL);
  });
  mine.update(disk, ctx);
  for (const [rail, pixels, low] of [[mine.read, ORE_CART, READ_RAIL], [mine.write, STONE_CART, WRITE_RAIL]] as const) {
    for (let i = 0; i < rail.count; i++) {
      const x = Math.round(LEFT + rail.position(i) * (RIGHT - LEFT));
      blitOutlined(cv, pixels, x - 2, railY(x, LEFT, RIGHT, low, RISE) - 2, P.ink);
    }
  }
  f.text(2, 3, `READ ↑ ${fmtRate(disk.readBps)}`, P.waterHi, P.hudBg);
  f.text(2, 9, `WRITE ↓ ${fmtRate(disk.writeBps)}`, P.stoneLight, P.hudBg);
  for (const [row, ops] of [[3, disk.readOps], [9, disk.writeOps]] as const) {
    const label = `${Math.round(ops)} OPS/S`;
    f.text(78 - label.length, row, label, P.white, P.hudBg);
  }
  for (const [i, x] of LANTERNS.entries()) {
    cv.vline(x, 26, 27, P.metal);
    cv.rect(x - 1, 28, 3, 2, mine.lanternLit(i) ? P.glow : P.woodDark);
  }
  f.text(2, 14, "TOP DISK I/O", P.accent, P.hudBg);
  const total = `TOTAL ${Math.round(disk.readOps + disk.writeOps)} OPS/S`;
  f.text(78 - total.length, 14, total, P.white, P.hudBg);
  if (!mine.miners.length) f.centered(40, 19, "NO PROCESS I/O", P.dim, P.hudBg);
  for (const [i, miner] of mine.miners.entries()) {
    const x = MINER_X[i]!;
    drawMiner(cv, x - 1, miner.striking);
    f.centered(x, 21, processName(miner.proc.name, 24), P.white, P.hudBg);
    f.centered(x, 22, fmtRate(diskRate(miner.proc)), P.dim, P.hudBg);
  }
  drawHint(f, "esc back  q quit", "READ ↑  WRITE ↓  LOG SCALE");
}
