import type { DiskThroughput, Proc } from "../core/snapshot.ts";
import { Smoother } from "../engine/tween.ts";
import { hash, type DrawCtx } from "./common.ts";

const MAX_CARTS = 7;
const MAX_MINERS = 3;
const IO_LOG_CAP = 9;  // 1 GB/s
const OPS_LOG_CAP = 5; // 100,000 ops/s

function logLevel(value: number, cap: number): number {
  return Math.min(1, Math.log10(1 + Math.max(0, value)) / cap);
}

export function diskRate(proc: Proc): number {
  return proc.diskReadBps + proc.diskWriteBps;
}

class MineRail {
  count = 0;
  private travel = 0;

  constructor(private readonly direction: 1 | -1) {}

  update(ops: number, bps: number, sm: Smoother, elapsed: number): void {
    const density = sm.get(`carts.${this.direction}`, logLevel(ops, OPS_LOG_CAP), elapsed);
    this.count = ops > 0 ? Math.max(1, Math.round(density * MAX_CARTS)) : 0;
    const speed = sm.get(`speed.${this.direction}`, logLevel(bps, IO_LOG_CAP), elapsed);
    this.travel = (this.travel + elapsed * (0.08 + 0.27 * speed)) % 1;
  }

  /** Normalized position along a rail, from the low end to the high end. */
  position(index: number): number {
    const phase = (this.travel + index / this.count) % 1;
    return this.direction === 1 ? phase : 1 - phase;
  }
}

interface Miner {
  proc: Proc;
  sm: Smoother;
  phase: number;
  striking: boolean;
}

export class DiskMines {
  readonly read = new MineRail(1);
  readonly write = new MineRail(-1);
  miners: Miner[] = [];
  private readonly sm = new Smoother();
  private procs: readonly Proc[] | undefined;
  private clock: number | undefined;
  private lanternPhase = 0;

  update(disk: DiskThroughput, ctx: DrawCtx): void {
    // Use the animation clock even at 5 fps, where the app caps ctx.dt at 0.1 s.
    // On re-entry, skip the time spent outside the mine.
    const elapsed = this.clock === undefined ? ctx.dt : Math.min(0.25, Math.max(0, ctx.t - this.clock));
    this.clock = ctx.t;
    const { readOps, readBps, writeOps, writeBps } = disk;
    this.read.update(readOps, readBps, this.sm, elapsed);
    this.write.update(writeOps, writeBps, this.sm, elapsed);
    const totalOps = readOps + writeOps;
    const activity = this.sm.get("lantern", logLevel(totalOps, OPS_LOG_CAP), elapsed);
    this.lanternPhase = (this.lanternPhase + elapsed * (0.4 + 2.1 * activity)) % 1;

    if (ctx.snap.procs !== this.procs) {
      this.procs = ctx.snap.procs;
      const ranked = this.procs.filter((proc) => diskRate(proc) > 0)
        .sort((a, b) => diskRate(b) - diskRate(a) || a.pid - b.pid)
        .slice(0, MAX_MINERS);
      this.miners = ranked.map((proc) => {
        const miner = this.miners.find((candidate) => candidate.proc.pid === proc.pid);
        if (miner) {
          miner.proc = proc;
          return miner;
        }
        return { proc, sm: new Smoother(), phase: hash(proc.pid, 0, 46), striking: false };
      });
    }

    for (const miner of this.miners) {
      const speed = miner.sm.get("swing", logLevel(diskRate(miner.proc), IO_LOG_CAP), elapsed);
      miner.phase = (miner.phase + elapsed * (0.35 + 1.45 * speed)) % 1;
      miner.striking = miner.phase < 0.5;
    }
  }

  lanternLit(index: number): boolean {
    return (this.lanternPhase + index / 3) % 1 < 0.65;
  }
}

/** Screen-space rails rise left to right. Cart sprites use the same profile. */
export function railY(x: number, left: number, right: number, low: number, rise: number): number {
  return low - Math.round(rise * (x - left) / (right - left));
}
