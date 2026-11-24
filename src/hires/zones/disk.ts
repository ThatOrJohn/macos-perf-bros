/**
 * Disk Mines (DESIGN.md §7.3). Reads carry ore uphill/out, writes carry stone
 * downhill/in. Nonzero ops/s sets 1–7 carts per track (log cap 100k ops/s).
 * Directional bytes/s sets speed (8–35% of track/s, log cap 1 GB/s).
 * Total ops/s sets wall lantern flicker (0.4–2.5 Hz, same ops scale).
 * The top three I/O processes get miners whose combined bytes/s sets pickaxe
 * cadence (0.35–1.8 Hz, same throughput scale). Signs give the raw rates.
 */
import type { PixelCanvas } from "../../engine/canvas.ts";
import { drawText, drawTextCentered, drawTextRight } from "../../engine/font5x7.ts";
import { bevel, blitOutlined, bricks, glow, line, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { stamped } from "../../engine/stamp.ts";
import { fmtRate, hash, type DrawCtx } from "../../world/common.ts";
import { diskRate, railY, type DiskMines } from "../../world/disk-mines.ts";
import { processName } from "../../world/process-field.ts";
import { CART, ROBOT, W, X, drawHintHi, drawHudHi, drawLockedPanelHi } from "../common.ts";

const SHADOW = { shadow: X.outline };
const LEFT = 16;
const RIGHT = 303;
const RISE = 13;
const READ_RAIL = 72;
const WRITE_RAIL = 113;
const LANTERNS = [50, 160, 270];
const MINER_X = [55, 160, 265];
const ROCK = { base: X.rockDark, light: P.stoneDark, dark: P.stoneDeep, mortar: P.stoneDeep };

const STONE_CART = {
  ...CART,
  px: CART.px.map((color) => color === X.gem1 ? X.rockLight : color === X.gem2 ? X.rock : color === X.gem3 ? X.rockDark : color),
};

function drawTunnel(cv: PixelCanvas, low: number): void {
  for (let x = 0; x < W; x++) {
    const y = railY(x, LEFT, RIGHT, low, RISE);
    cv.vline(x, y - 20, y + 2, P.ink);
    cv.set(x, y - 21, P.stoneDeep);
    if (x % 8 < 2) cv.vline(x, y - 3, y + 3, P.woodDark);
    cv.set(x, y, P.metalLight);
    cv.set(x, y + 2, P.metal);
  }
  // Timber supports mark the ends of each exposed track.
  for (const x of [9, 310]) {
    const y = railY(x, LEFT, RIGHT, low, RISE);
    outlined(cv, X.outline, (l) => bevel(l, x - 2, y - 23, 5, 26, P.wood, P.pathDark, P.woodDark));
  }
}

function drawBackdrop(cv: PixelCanvas): void {
  cv.rect(0, 11, W, 170, X.rockDark);
  bricks(cv, 0, 23, W, 158, ROCK, 23, 11);
  for (let y = 25; y < 178; y++) {
    for (let x = 0; x < W; x++) {
      if (hash(x, y, 46) < 0.06) cv.set(x, y, X.rockDark);
    }
  }
}

function drawLantern(cv: PixelCanvas, x: number, lit: boolean): void {
  if (lit) glow(cv, x, 132, 6, X.window, 0.7);
  outlined(cv, X.outline, (l) => {
    l.vline(x, 128, 129, P.metal);
    bevel(l, x - 2, 130, 5, 6, lit ? X.window : P.wood, P.metalLight, P.woodDark);
  });
}

function drawMiner(cv: PixelCanvas, x: number, striking: boolean): void {
  const y = 142;
  outlined(cv, X.outline, (l) => {
    l.blit(ROBOT[0]!, x - 5, y);
    // The lamp replaces the antenna on the same teal robot.
    l.rect(x - 2, y, 6, 3, P.metal);
    l.hline(x - 2, x + 2, y, P.metalLight);
    l.set(x + 3, y + 1, P.glow);
    const tipX = x + (striking ? 13 : 7);
    const tipY = y + (striking ? 9 : 1);
    line(l, x + 4, y + 9, tipX, tipY, P.wood);
    line(l, tipX - 1, tipY - 2, tipX + 2, tipY + 1, P.metalLight);
  });
}

export function drawDiskZoneHi(cv: PixelCanvas, ctx: DrawCtx, mine: DiskMines): void {
  stamped(cv, "disk.wall", drawBackdrop);
  drawHudHi(cv, ctx.snap);
  drawTextCentered(cv, W / 2, 14, "DISK MINES", P.accent, SHADOW);
  const disk = ctx.snap.disk;
  if (!disk) {
    drawLockedPanelHi(cv);
    drawHintHi(cv, "ESC BACK  Q QUIT", "NO DATA WITHOUT SUDO");
    return;
  }

  stamped(cv, "disk.tunnels", (l) => {
    drawTunnel(l, READ_RAIL);
    drawTunnel(l, WRITE_RAIL);
  });
  mine.update(disk, ctx);
  for (const [rail, sprite, low] of [[mine.read, CART, READ_RAIL], [mine.write, STONE_CART, WRITE_RAIL]] as const) {
    for (let i = 0; i < rail.count; i++) {
      const x = Math.round(LEFT + rail.position(i) * (RIGHT - LEFT));
      blitOutlined(cv, sprite, x - 7, railY(x, LEFT, RIGHT, low, RISE) - 7, X.outline);
    }
  }
  drawText(cv, 13, 29, `READ ↑ ${fmtRate(disk.readBps)}`, X.gem1, SHADOW);
  drawTextRight(cv, 307, 29, `${Math.round(disk.readOps)} OPS/S`, P.white, SHADOW);
  drawText(cv, 13, 80, `WRITE ↓ ${fmtRate(disk.writeBps)}`, P.stoneLight, SHADOW);
  drawTextRight(cv, 307, 80, `${Math.round(disk.writeOps)} OPS/S`, P.white, SHADOW);

  LANTERNS.forEach((x, i) => drawLantern(cv, x, mine.lanternLit(i)));
  drawText(cv, 12, 121, "TOP DISK I/O", P.accent, SHADOW);
  drawTextRight(cv, 307, 121, `TOTAL ${Math.round(disk.readOps + disk.writeOps)} OPS/S`, P.white, SHADOW);
  if (!mine.miners.length) drawTextCentered(cv, W / 2, 153, "NO PROCESS I/O", P.dim, SHADOW);
  for (const [i, miner] of mine.miners.entries()) {
    const x = MINER_X[i]!;
    drawMiner(cv, x - 4, miner.striking);
    drawTextCentered(cv, x, 158, processName(miner.proc.name, 16), P.white, SHADOW);
    drawTextCentered(cv, x, 168, fmtRate(diskRate(miner.proc)), P.dim, SHADOW);
  }
  drawHintHi(cv, "ESC BACK  Q QUIT", "READ ↑  WRITE ↓  LOG SCALE");
}
