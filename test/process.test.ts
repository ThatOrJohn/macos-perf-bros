import { expect, test } from "bun:test";
import type { Proc } from "../src/core/snapshot.ts";
import { ProcessField, processName, rssScale } from "../src/world/process-field.ts";

function process(pid: number, cpuPct: number, rssB?: number, energyImpact = 0): Proc {
  return {
    pid, name: `worker-${pid}`, cpuPct, rssB, energyImpact, idleWakeupsPerS: 0, intrWakeupsPerS: 0,
    diskReadBps: 0, diskWriteBps: 0, netRxBps: 0, netTxBps: 0,
  };
}

test("rank changes keep retained PIDs in place and transfers the boss to the new leader", () => {
  const field = new ProcessField(3);
  const initial = field.update([process(1, 120), process(2, 60), process(3, 3)], 0.2).ranked;
  const slots = new Map(initial.map(({ proc, slot }) => [proc.pid, slot]));
  expect(new Set(slots.values()).size).toBe(3);
  expect(initial.filter((slime) => slime.boss).map((slime) => slime.proc.pid)).toEqual([1]);
  const { ranked } = field.update([process(2, 200), process(1, 130), process(3, 3)], 1 / 30);
  expect(ranked.map(({ proc, rank, slot }) => [proc.pid, rank, slot])).toEqual([
    [2, 1, slots.get(2)!], [1, 2, slots.get(1)!], [3, 3, slots.get(3)!],
  ]);
  expect(ranked.filter((slime) => slime.boss).map((slime) => slime.proc.pid)).toEqual([2]);
  expect(field.update([process(2, 50)], 1 / 30).ranked[0]!.boss).toBe(false);
});

test("departures shrink in place while replacements grow into the field", () => {
  const field = new ProcessField(2);
  const initial = field.update([process(1, 70), process(2, 30)], 0.2).ranked;
  expect(initial[0]!.presence).toBe(1);
  const promoted = [process(3, 90), process(2, 30), process(1, 10)];
  const { ranked, leaving } = field.update(promoted, 0.1);
  const gone = Array.from(leaving);
  expect(gone.map((slime) => slime.proc.pid)).toEqual([1]);
  expect(gone[0]!.slot).toBe(initial[0]!.slot);
  expect(gone[0]!.presence).toBeCloseTo(2 / 3);
  expect(gone[0]!.boss).toBe(false);
  expect(ranked[0]!.presence).toBeCloseTo(0.5);
  expect(ranked[1]!.presence).toBe(1);
  expect(ranked[1]!.slot).toBe(initial[1]!.slot);
  const settled = field.update(promoted, 0.25);
  expect(settled.ranked[0]!.presence).toBe(1);
  expect(Array.from(settled.leaving)).toHaveLength(0);
});

test("RSS buckets, glow threshold, and hop rate follow the process metrics", () => {
  expect([0, 99_999_999, 100_000_000, 999_999_999, 1_000_000_000, undefined].map(rssScale))
    .toEqual([0.75, 0.75, 1, 1, 1.35, 1]);

  const idle = new ProcessField(1);
  const busy = new ProcessField(1);
  const idleProc = [process(1, 0, undefined, 100)];
  const busyProc = [process(1, 265, undefined, 101)];
  const phase = idle.update(idleProc, 0).ranked[0]!.phase;
  const still = idle.update(idleProc, 0.1).ranked[0]!;
  const hopping = busy.update(busyProc, 0.1).ranked[0]!;
  expect((hopping.phase - phase + 1) % 1).toBeGreaterThan((still.phase - phase + 1) % 1);
  expect(still.glow).toBe(0);
  expect(hopping.glow).toBeGreaterThan(0);
});

test("process names fit the bitmap font and fixed-width leaderboard", () => {
  expect(processName("résumé-server", 6)).toBe("resum.");
  expect(processName("a\u001b\n", 6)).toBe("a??");
});
