import { expect, test } from "bun:test";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import { Game } from "../src/world/game.ts";
import type { Proc } from "../src/core/snapshot.ts";
import { CloudSlots, NET_HISTORY_SECONDS, NetHistory } from "../src/world/net-sky.ts";

const dir = "fixtures/scenarios";
const idle = (await loadNdjsonReplay(`${dir}/idle.ndjson`)).at(10);
const degraded = (await loadNdjsonReplay(`${dir}/degraded.ndjson`)).at(10);

const measured = (h: NetHistory, now: number) =>
  Array.from({ length: NET_HISTORY_SECONDS }, (_, i) => h.at(i, now)).map((x) => (x ? x.rx : null));

test("history records one sample per second regardless of frame rate, and invents nothing", () => {
  const history = new NetHistory();
  for (let frame = 0; frame < 30; frame++) history.record(frame * 33, 8 + frame, 3);
  const cols = measured(history, 0);
  expect(cols[59]).toBe(8); // first reading of the second wins
  expect(cols.slice(0, 59).every((v) => v === null)).toBe(true); // no padding before it
});

test("history keeps real time: wraps at 60 s and leaves gaps as gaps", () => {
  const history = new NetHistory();
  for (let second = 1; second <= 64; second++) history.record(second * 1000, second, 100 - second);
  expect(history.at(0, 64)).toMatchObject({ rx: 5, tx: 95 });
  expect(history.at(59, 64)).toMatchObject({ rx: 64, tx: 36 });
  // 3 s of 1 KB/s, a 5-minute gap, then 2 s of 9 MB/s: the old samples are out of the window.
  const h = new NetHistory();
  for (const s of [0, 1, 2]) h.record(s * 1000, 1000, 0);
  for (const s of [302, 303]) h.record(s * 1000, 9e6, 0);
  const cols = measured(h, 303);
  expect(cols.slice(58)).toEqual([9e6, 9e6]);
  expect(cols.slice(0, 58).every((v) => v === null)).toBe(true);
  // time going backwards (replay loop restart) is ignored rather than overwriting newer data
  h.record(1000, 5, 5);
  expect(h.at(59, 303)).toMatchObject({ rx: 9e6 });
});

test("Game records network history in every scene, so the graph is full on arrival", async () => {
  const burst = await loadNdjsonReplay(`${dir}/net-burst.ndjson`);
  const game = new Game(); // stays on the overworld
  for (let i = 0; i <= 90; i++) game.draw(burst.at(i / 10), i / 10, 0.1);
  const history = (game as unknown as { netHistory: NetHistory }).netHistory;
  const now = Math.floor(burst.at(9).t / 1000);
  expect(measured(history, now).filter((v) => v !== null)).toHaveLength(10);
});

const proc = (pid: number, rx: number, tx = 0): Proc => ({ ...idle.procs[0]!, pid, name: `p${pid}`, netRxBps: rx, netTxBps: tx });
const order = (t: CloudSlots) => t.clouds.filter((c) => !c.departing).map((c) => c.proc.pid);

test("clouds ignore zero traffic and never move when the ranking changes", () => {
  const tracker = new CloudSlots(4);
  tracker.update([proc(1, 0), proc(2, 100), proc(3, 200)], 0.2);
  const before = order(tracker);
  expect([...before].sort()).toEqual([2, 3]);
  tracker.update([proc(2, 900), proc(3, 5)], 0.2);
  expect(order(tracker)).toEqual(before);
  expect(tracker.clouds.find((c) => c.proc.pid === 2)?.proc.netRxBps).toBe(900);
});

test("both renderers show clouds in the same left-to-right order", () => {
  const procs = [11, 22, 33, 44, 55, 66].map((pid, i) => proc(pid, 1000 * (10 - i)));
  const lo = new CloudSlots(4);
  const hi = new CloudSlots(5);
  for (let i = 0; i < 10; i++) {
    lo.update(procs, 0.1);
    hi.update(procs, 0.1);
  }
  const loOrder = order(lo);
  expect(loOrder).toHaveLength(4);
  expect(order(hi).filter((pid) => loOrder.includes(pid))).toEqual(loOrder);
  // positions follow that order and stay inside the band
  const xs = lo.clouds.map((c) => lo.center(c, 0, 72));
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs)).toBeLessThan(72);
});

test("ranking runs once per snapshot second; a departing cloud fades while its replacement grows", () => {
  const tracker = new CloudSlots(1);
  tracker.update([proc(1, 200)], 0.2, 1000);
  tracker.update([proc(2, 900)], 0.15, 1500); // same second: membership unchanged
  expect(order(tracker)).toEqual([1]);
  tracker.update([proc(2, 900)], 0.15, 2000);
  expect(tracker.clouds.find((c) => c.proc.pid === 1)).toMatchObject({ departing: true });
  expect(tracker.clouds.find((c) => c.proc.pid === 2)?.presence).toBeCloseTo(0.75);
  for (let i = 0; i < 5; i++) tracker.update([proc(2, 900)], 0.1, 2000);
  expect(tracker.clouds.map((c) => c.proc.pid)).toEqual([2]);
});

test("locked Network Sky hides throughput and idle Network Sky says NO TRAFFIC", () => {
  const game = new Game();
  game.key("3");
  const texts = (snap: typeof idle) => game.draw(snap, 1, 1 / 30).texts.map(({ text }) => text).join("\n");
  expect(texts(degraded)).toContain("NEEDS SUDO");
  expect(texts(degraded)).not.toContain("↓");
  expect(texts(idle)).toContain("NO TRAFFIC");
});
