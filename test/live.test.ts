import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostCpuSampler } from "../src/collectors/hostcpu.ts";
import { memoryReading, parsePressureLevel, parseSwapUsage, parseSysctl, parseVmStat } from "../src/collectors/memory.ts";
import { parseCapture } from "../src/collectors/powermetrics.ts";
import { parseBootTime, parsePs, readMemory, readTopology, topologyFromSysctl } from "../src/collectors/system.ts";
import { STALE_MS, SnapshotBus } from "../src/core/bus.ts";
import { startLive } from "../src/core/live.ts";
import { Recorder, loadNdjsonReplay } from "../src/core/recorder.ts";

const FIX = "fixtures/raw/apple-m1_macos-27.0.1";
const topo = { chip: "Apple M1", model: "Macmini9,1", eCores: 4, pCores: 4, memoryB: 16 * 1024 ** 3 };

describe("parsers (fixtures)", () => {
  test("vm_stat + swap + pressure → memory reading", async () => {
    const vm = parseVmStat(await Bun.file(`${FIX}/unprivileged/vm_stat.txt`).text());
    expect(vm.pageSize).toBe(16384);
    expect(vm.pages["pages wired down"]).toBe(166104);
    const rt = parseSysctl(await Bun.file(`${FIX}/unprivileged/sysctl-runtime.txt`).text());
    const swap = parseSwapUsage(rt["vm.swapusage"]!);
    expect(swap.totalB).toBe(15360 * 1024 ** 2);
    const usedM = Number(/used = ([\d.]+)M/.exec(rt["vm.swapusage"]!)![1]);
    expect(swap.usedB).toBeCloseTo(usedM * 1024 ** 2, -3);
    const m = memoryReading(vm, topo.memoryB, swap, parsePressureLevel(2));
    expect(m.pressure).toBe("warn");
    expect(m.usedB).toBe(m.wiredB + m.compressedB + (278419 - 4) * 16384);
    expect(m.usedB).toBeLessThan(m.totalB);
  });

  test("pressure levels", () => {
    expect(parsePressureLevel(1)).toBe("normal");
    expect(parsePressureLevel(2)).toBe("warn");
    expect(parsePressureLevel(4)).toBe("critical");
  });

  test("topology from sysctl", async () => {
    const t = topologyFromSysctl(parseSysctl(await Bun.file(`${FIX}/unprivileged/sysctl-topology.txt`).text()));
    expect(t).toEqual({ chip: "Apple M1", model: "Macmini9,1", eCores: 4, pCores: 4, memoryB: 17179869184 });
  });

  test("boot time and ps", () => {
    expect(parseBootTime("{ sec = 1795181477, usec = 304595 } Fri Nov 20 07:31:17 2026")).toBe(1795181477);
    const rows = parsePs("  511   107568  24.0 /System/Library/Frameworks/Foo.framework/Resources/WindowServer\n  38422 50976 9.7 /Applications/My App.app/Contents/MacOS/My App\n");
    expect(rows).toEqual([
      { pid: 511, rssB: 107568 * 1024, cpuPct: 24, name: "WindowServer" },
      { pid: 38422, rssB: 50976 * 1024, cpuPct: 9.7, name: "My App" },
    ]);
  });
});

const pm = parseCapture(new Uint8Array(await Bun.file(`${FIX}/powermetrics/idle-app.plist`).arrayBuffer()))[0]!;

describe("SnapshotBus merge rules", () => {

  test("fresh powermetrics → privileged, pm cpu, RSS joined from ps", () => {
    const bus = new SnapshotBus(topo, 1000);
    const pid = pm.procs[0]!.pid;
    bus.ps = [{ pid, rssB: 42, cpuPct: 1, name: "x" }];
    bus.setPowermetrics(pm, 10_000);
    const s = bus.snapshot(10_500);
    expect(s.privileged).toBe(true);
    expect(s.cpu).toBe(pm.cpu);
    expect(s.power).toBeDefined();
    expect(s.procs.find((p) => p.pid === pid)!.rssB).toBe(42);
    expect(s.uptimeS).toBe(0); // boot time after 'now' clamps to 0
  });

  test("stale powermetrics → degraded: host cpu, ps procs, no gpu/power", () => {
    const bus = new SnapshotBus(topo, 0);
    bus.setPowermetrics(pm, 10_000);
    bus.hostCpu = { clusters: [], cores: [{ id: 0, kind: "E", cluster: "E-Cluster", freqMHz: 0, activePct: 50 }] };
    bus.ps = [{ pid: 1, rssB: 1, cpuPct: 2, name: "a" }, { pid: 2, rssB: 1, cpuPct: 9, name: "b" }];
    const s = bus.snapshot(10_000 + STALE_MS + 1);
    expect(s.privileged).toBe(false);
    expect(s.cpu).toBe(bus.hostCpu);
    expect(s.power).toBeUndefined();
    expect(s.gpu).toBeUndefined();
    expect(s.procs.map((p) => p.name)).toEqual(["b", "a"]);
  });
});

describe("live (unprivileged, this machine)", () => {
  test("host CPU sampler reports every core in range", async () => {
    const t = await readTopology();
    const s = new HostCpuSampler(t);
    expect(s.sample()).toBeUndefined();
    await Bun.sleep(200);
    const r = s.sample()!;
    s.close();
    expect(r.cores.length).toBe(t.eCores + t.pCores);
    for (const c of r.cores) {
      expect(c.activePct).toBeGreaterThanOrEqual(0);
      expect(c.activePct).toBeLessThanOrEqual(100);
    }
    expect(r.cores.filter((c) => c.kind === "E").length).toBe(t.eCores);
  });

  test("memory reading is plausible", async () => {
    const t = await readTopology();
    const m = await readMemory(t.memoryB);
    expect(m.totalB).toBe(t.memoryB);
    expect(m.usedB).toBeGreaterThan(0);
    expect(m.usedB).toBeLessThanOrEqual(m.totalB);
  });

  test("degraded live source produces snapshots with cpu, memory and procs", async () => {
    const src = await startLive({ privileged: false, intervalMs: 150 });
    await Bun.sleep(400);
    const s = src.at(0);
    src.stop();
    expect(s.privileged).toBe(false);
    expect(s.cpu?.cores.length).toBeGreaterThan(0);
    expect(s.memory?.totalB).toBeGreaterThan(0);
    expect(s.procs.length).toBeGreaterThan(10);
    expect(s.uptimeS).toBeGreaterThan(0);
  });
});

test("record → replay round trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "perfbros-"));
  const path = join(dir, "s.ndjson");
  const { loadFixtureReplay } = await import("../src/core/replay.ts");
  const fixture = await loadFixtureReplay(FIX);
  let t = 0;
  const rec = new Recorder(path, { at: () => fixture.at(t++), stop() {} }, 30);
  await Bun.sleep(130);
  rec.stop();
  expect(rec.lines).toBeGreaterThanOrEqual(3);
  const replay = await loadNdjsonReplay(path);
  const a = replay.at(0);
  expect(a.cpu?.cores.length).toBe(8);
  expect(a.memory?.totalB).toBe(17179869184);
});
