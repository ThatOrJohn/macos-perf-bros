import { expect, test } from "bun:test";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import { Game } from "../src/world/game.ts";
import { CloudSlots, NET_HISTORY_SECONDS, NetHistory } from "../src/world/net-sky.ts";

const dir = "fixtures/scenarios";
const idle = (await loadNdjsonReplay(`${dir}/idle.ndjson`)).at(10);
const degraded = (await loadNdjsonReplay(`${dir}/degraded.ndjson`)).at(10);

test("network history starts flat, samples once per snapshot second, and wraps at 60", () => {
  const history = new NetHistory();
  for (let frame = 0; frame < 30; frame++) history.record(frame * 33, 8 + frame, 3);
  expect(history.size).toBe(1);
  for (let column = 0; column < NET_HISTORY_SECONDS; column++) {
    expect(history.at(column)).toEqual({ rx: 8, tx: 3 });
  }

  for (let second = 1; second <= 64; second++) {
    history.record(second * 1000, second, 100 - second);
    history.record(second * 1000 + 999, 0, 0);
  }
  expect(history.size).toBe(60);
  expect(history.at(0)).toEqual({ rx: 5, tx: 95 });
  expect(history.at(59)).toEqual({ rx: 64, tx: 36 });
});

test("cloud slots keep their PIDs across rank changes and ignore zero traffic", () => {
  const tracker = new CloudSlots(4);
  const first = { ...idle.procs[0]!, netRxBps: 200 };
  const second = { ...idle.procs[1]!, netTxBps: 100 };
  const quiet = idle.procs[2]!;
  tracker.update([quiet, second, first], 0.2);
  const pids = tracker.slots.map((cloud) => cloud?.proc.pid);
  expect(pids.filter((pid) => pid !== undefined).sort()).toEqual([first.pid, second.pid].sort());

  tracker.update([first, quiet, { ...second, netTxBps: 300 }], 0.2);
  expect(tracker.slots.map((cloud) => cloud?.proc.pid)).toEqual(pids);
  expect(tracker.slots.find((cloud) => cloud?.proc.pid === second.pid)?.proc.netTxBps).toBe(300);
});

test("a departing cloud shrinks in its slot before the replacement grows in", () => {
  const tracker = new CloudSlots(1);
  const first = { ...idle.procs[0]!, netRxBps: 200 };
  const replacement = { ...idle.procs[1]!, netTxBps: 300 };
  tracker.update([first], 0.2);
  tracker.update([replacement], 0.15);
  expect(tracker.slots[0]).toMatchObject({ proc: first, presence: 0.5, departing: true });
  tracker.update([replacement], 0.15);
  expect(tracker.slots[0]).toMatchObject({ proc: replacement, departing: false });
  expect(tracker.slots[0]!.presence).toBeCloseTo(0.75);
});

test("locked Network Sky hides throughput and idle Network Sky says NO TRAFFIC", () => {
  const game = new Game();
  game.key("3");
  const texts = (snap: typeof idle) => game.draw(snap, 1, 1 / 30).texts.map(({ text }) => text).join("\n");
  expect(texts(degraded)).toContain("NEEDS SUDO");
  expect(texts(degraded)).not.toContain("↓");
  expect(texts(idle)).toContain("NO TRAFFIC");
});
