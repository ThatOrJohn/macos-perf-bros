import { expect, test } from "bun:test";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import type { Snapshot } from "../src/core/snapshot.ts";

function expectNumbers<T>(reading: T, ...fields: (keyof T)[]): void {
  for (const field of fields) expect(Number.isFinite(reading[field])).toBe(true);
}

const names = ["idle", "cpu-fire", "swap-storm", "net-burst", "disk-thrash", "gpu-busy", "degraded"] as const;
type Scenario = (typeof names)[number];
const pathFor = (name: Scenario) => `fixtures/scenarios/${name}.ndjson`;

const ramps: Record<Exclude<Scenario, "idle">, (snap: Snapshot) => number> = {
  "cpu-fire": (snap) => snap.cpu!.cores[0]!.activePct,
  "swap-storm": (snap) => snap.memory!.swapUsedB,
  "net-burst": (snap) => snap.net!.rxBps,
  "disk-thrash": (snap) => snap.disk!.readBps,
  "gpu-busy": (snap) => snap.gpu!.activePct,
  degraded: (snap) => snap.cpu!.cores[0]!.activePct,
};

for (const name of names) {
  test(`${name} stores 20 valid 1 Hz snapshots and replays them in a loop`, async () => {
    const path = pathFor(name);
    const samples: Snapshot[] = (await Bun.file(path).text()).trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(samples).toHaveLength(20);
    const first = samples[0]!;
    const replay = await loadNdjsonReplay(path);
    expect(replay.sampleCount).toBe(samples.length);

    for (const [i, snap] of samples.entries()) {
      expect(snap).toMatchObject({
        t: first.t + i * 1000,
        uptimeS: first.uptimeS + i,
        privileged: name !== "degraded",
      });
      expectNumbers(snap, "t", "uptimeS");
      expectNumbers(snap.topology, "memoryB", "eCores", "pCores");
      expect(typeof snap.topology.chip).toBe("string");
      expect(typeof snap.topology.model).toBe("string");
      expectNumbers(snap.memory!, "totalB", "usedB", "wiredB", "compressedB", "cachedB", "swapUsedB", "swapTotalB");
      expect(["normal", "warn", "critical"]).toContain(snap.memory!.pressure);
      expect(snap.cpu!.cores).toHaveLength(snap.topology.eCores + snap.topology.pCores);
      expect(snap.cpu!.clusters.length).toBeGreaterThan(0);
      for (const core of snap.cpu!.cores) {
        expectNumbers(core, "freqMHz", "activePct", "id");
        expect(typeof core.cluster).toBe("string");
        expect(["E", "P"]).toContain(core.kind);
      }
      for (const cluster of snap.cpu!.clusters) {
        expectNumbers(cluster, "freqMHz", "maxFreqMHz", "activePct");
        expect(typeof cluster.name).toBe("string");
        expect(["E", "P"]).toContain(cluster.kind);
      }
      if (snap.cpu!.loadAvg !== undefined) {
        expect(snap.cpu!.loadAvg).toHaveLength(3);
        expect(snap.cpu!.loadAvg!.every(Number.isFinite)).toBe(true);
      }
      expect(snap.procs.length).toBeGreaterThanOrEqual(3);
      for (const proc of snap.procs) {
        expect(typeof proc.name).toBe("string");
        expectNumbers(proc, "pid", "cpuPct", "energyImpact", "idleWakeupsPerS", "intrWakeupsPerS",
          "diskReadBps", "diskWriteBps", "netRxBps", "netTxBps", "rssB");
      }

      if (name === "degraded") {
        for (const key of ["gpu", "power", "thermal", "net", "disk"] as const) expect(snap).not.toHaveProperty(key);
        expect(snap.cpu!.cores.every(({ freqMHz }) => freqMHz === 0)).toBe(true);
        expect(snap.cpu!.clusters.every(({ freqMHz, maxFreqMHz }) => freqMHz === 0 && maxFreqMHz === 0)).toBe(true);
      } else {
        expectNumbers(snap.gpu!, "freqMHz", "maxFreqMHz", "activePct");
        expectNumbers(snap.power!, "cpuW", "gpuW", "aneW", "packageW");
        expect(["nominal", "moderate", "heavy", "critical", "unknown"]).toContain(snap.thermal!);
        expectNumbers(snap.net!, "rxBps", "txBps", "rxPps", "txPps");
        expectNumbers(snap.disk!, "readBps", "writeBps", "readOps", "writeOps");
      }
      expect(replay.at(i)).toEqual(snap);
    }
    expect(replay.at(20)).toEqual({ ...first, t: first.t + 20_000, uptimeS: first.uptimeS + 20 });

    if (name !== "idle") {
      const values = samples.map(ramps[name]);
      expect(values[0]).toBe(values[19]);
      expect(values[0]!).toBeLessThan(values[4]!);
      expect(values[4]!).toBeLessThan(values[10]!);
      expect(values[10]!).toBeGreaterThan(values[15]!);
      expect(values[15]!).toBeGreaterThan(values[19]!);
    }
  });
}

test("the peak samples reach the specified visual stress targets", async () => {
  const peak = async (name: Scenario) => (await loadNdjsonReplay(pathFor(name))).at(10);
  const [idle, cpu, mem, net, disk, gpu] = await Promise.all([
    peak("idle"), peak("cpu-fire"), peak("swap-storm"), peak("net-burst"), peak("disk-thrash"), peak("gpu-busy"),
  ]);
  expect(idle.cpu!.cores.every(({ activePct }) => activePct <= 12)).toBe(true);
  expect(idle.memory).toMatchObject({ pressure: "normal", swapUsedB: 0 });
  expect(idle.power!.packageW).toBe(1);
  expect(idle.net).toMatchObject({ rxBps: 0, txBps: 0 });
  expect(idle.disk).toMatchObject({ readBps: 0, writeBps: 0 });
  expect(cpu.cpu!.cores.every(({ activePct }) => activePct >= 95 && activePct <= 100)).toBe(true);
  expect(cpu.cpu!.clusters.every(({ freqMHz, maxFreqMHz }) => freqMHz === maxFreqMHz)).toBe(true);
  expect(cpu.power!.packageW).toBe(20);
  expect(cpu.thermal).toBe("heavy");
  expect(cpu.procs[0]!.cpuPct).toBeGreaterThan(50);
  expect(mem.memory!.pressure).toBe("critical");
  expect(mem.memory!.usedB / mem.memory!.totalB).toBeCloseTo(0.99);
  expect(mem.memory!.compressedB).toBe(8 * 1024 ** 3);
  expect(mem.memory!.swapUsedB / mem.memory!.swapTotalB).toBeCloseTo(0.97);
  expect(net.net).toMatchObject({ rxBps: 80_000_000, txBps: 5_000_000 });
  const netTasks = net.procs.filter((proc) => proc.netRxBps + proc.netTxBps > 0);
  expect(netTasks).toHaveLength(6);
  expect(netTasks.some((proc) => proc.netTxBps > proc.netRxBps)).toBe(true);
  expect(netTasks.some((proc) => proc.netRxBps + proc.netTxBps < 10_000)).toBe(true);
  expect(net.procs.filter(({ netRxBps }) => netRxBps >= 10_000_000)).toHaveLength(3);
  expect(disk.disk).toMatchObject({ readBps: 1_500_000_000, writeBps: 600_000_000 });
  expect(disk.procs.filter(({ diskReadBps, diskWriteBps }) => diskReadBps >= 400_000_000 && diskWriteBps >= 100_000_000)).toHaveLength(2);
  expect(gpu.gpu).toMatchObject({ activePct: 95, freqMHz: gpu.gpu!.maxFreqMHz });
  expect(gpu.power).toMatchObject({ gpuW: 12, aneW: 2 });
});
