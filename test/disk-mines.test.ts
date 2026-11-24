import { expect, test } from "bun:test";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import type { DiskThroughput } from "../src/core/snapshot.ts";
import { Smoother } from "../src/engine/tween.ts";
import { DiskMines } from "../src/world/disk-mines.ts";

const snap = (await loadNdjsonReplay("fixtures/scenarios/disk-thrash.ndjson")).at(10);
const sm = new Smoother();

test("disk operations set cart count while bytes set speed in opposite directions", () => {
  const track = (ops: number, bps: number) => {
    const disk: DiskThroughput = { readOps: ops, writeOps: ops, readBps: bps, writeBps: bps };
    const mine = new DiskMines();
    mine.update(disk, { snap, sm, t: 1, dt: 0 });
    mine.update(disk, { snap, sm, t: 1.2, dt: 0.1 });
    return mine;
  };
  const slow = track(100, 0);
  const fast = track(100, 1e9);
  const busy = track(1e6, 1e9);
  expect(track(0, 0).read.count).toBe(0);
  expect(fast.read.count).toBe(slow.read.count);
  expect(fast.read.position(0)).toBeGreaterThan(slow.read.position(0));
  expect(fast.write.position(0)).toBeLessThan(slow.write.position(0));
  expect(busy.read.count).toBe(7);
  expect(busy.read.count).toBeGreaterThan(fast.read.count);
  expect(busy.read.position(0)).toBe(fast.read.position(0));
});

test("Disk Mines keeps the three highest combined rates, breaking ties by PID", () => {
  const mine = new DiskMines();
  const base = snap.procs[0]!;
  const procs = [
    { ...base, pid: 3, diskReadBps: 500, diskWriteBps: 0 },
    { ...base, pid: 9, diskReadBps: 0, diskWriteBps: 1000 },
    { ...base, pid: 1, diskReadBps: 250, diskWriteBps: 250 },
    { ...base, pid: 2, diskReadBps: 400, diskWriteBps: 0 },
    { ...base, pid: 4, diskReadBps: 0, diskWriteBps: 0 },
  ];
  mine.update(snap.disk!, { snap: { ...snap, procs }, sm, t: 1, dt: 0 });
  expect(mine.miners.map(({ proc }) => proc.pid)).toEqual([9, 1, 3]);
  mine.update(snap.disk!, { snap: { ...snap, procs: [procs[4]!] }, sm, t: 2, dt: 0.1 });
  expect(mine.miners).toHaveLength(0);
});
