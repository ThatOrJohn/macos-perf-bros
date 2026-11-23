import { describe, expect, test } from "bun:test";
import {
  parseCapture,
  parseThermal,
  readPowermetrics,
  toReading,
} from "../src/collectors/powermetrics.ts";

const DIR = new URL("../fixtures/raw/apple-m1_macos-27.0.1/powermetrics/", import.meta.url);
const load = async (name: string) => new Uint8Array(await Bun.file(new URL(name, DIR)).arrayBuffer());

const idle = parseCapture(await load("idle-app.plist"));
const idleAll = parseCapture(await load("idle-all.plist"));
const busy = parseCapture(await load("cpu-load-app.plist"));

describe("M1 fixtures", () => {
  test("five samples per capture, ~1 s windows", () => {
    for (const cap of [idle, idleAll, busy]) {
      expect(cap).toHaveLength(5);
      for (const r of cap) {
        expect(r.elapsedMs).toBeGreaterThan(950);
        expect(r.elapsedMs).toBeLessThan(1100);
        expect(r.hwModel).toBe("Macmini9,1");
      }
    }
  });

  test("timestamps come from the sample and increase", () => {
    const ts = idle.map((r) => r.t);
    expect(new Date(ts[0]!).getUTCFullYear()).toBe(2026);
    for (let i = 1; i < ts.length; i++) expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
  });

  test("topology: one E and one P cluster, 4 cores each, ids 0–7", () => {
    const { clusters, cores } = idle[0]!.cpu;
    expect(clusters.map((c) => [c.name, c.kind])).toEqual([["E-Cluster", "E"], ["P-Cluster", "P"]]);
    expect(cores.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(cores.filter((c) => c.kind === "E").map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(clusters.map((c) => c.maxFreqMHz)).toEqual([2064, 3204]);
  });

  test("frequencies are normalized to MHz", () => {
    for (const r of idle) {
      for (const c of r.cpu.clusters) {
        expect(c.freqMHz).toBeGreaterThan(500);
        expect(c.freqMHz).toBeLessThanOrEqual(c.maxFreqMHz + 1);
      }
      // gpu.freq_hz is reported in MHz despite its name.
      expect(r.gpu!.freqMHz).toBeGreaterThan(300);
      expect(r.gpu!.freqMHz).toBeLessThan(1300);
      expect(r.gpu!.maxFreqMHz).toBe(1278);
    }
  });

  test("under load every core is ~100% and clusters run at max", () => {
    const last = busy.at(-1)!;
    for (const c of last.cpu.cores) expect(c.activePct).toBeGreaterThan(98);
    const [e, p] = last.cpu.clusters;
    expect(e!.freqMHz).toBeGreaterThan(e!.maxFreqMHz * 0.95);
    expect(p!.freqMHz).toBeGreaterThan(p!.maxFreqMHz * 0.9);
  });

  test("idle cores are well below 100%, and cluster active ≥ busiest core", () => {
    for (const r of idle) {
      for (const cl of r.cpu.clusters) {
        const coreMax = Math.max(...r.cpu.cores.filter((c) => c.cluster === cl.name).map((c) => c.activePct));
        expect(cl.activePct).toBeGreaterThanOrEqual(coreMax - 0.5);
      }
      const avg = r.cpu.cores.reduce((s, c) => s + c.activePct, 0) / r.cpu.cores.length;
      expect(avg).toBeLessThan(80);
    }
  });

  test("power in watts; load raises CPU power", () => {
    const p0 = idle[0]!.power!;
    expect(p0.cpuW).toBeGreaterThan(0.5);
    expect(p0.cpuW).toBeLessThan(20);
    expect(p0.packageW).toBeCloseTo(p0.cpuW + p0.gpuW + p0.aneW, 1);
    expect(busy.at(-1)!.power!.cpuW).toBeGreaterThan(p0.cpuW * 2);
  });

  test("thermal, net and disk present", () => {
    for (const r of idle) {
      expect(r.thermal).toBe("nominal");
      expect(r.net!.rxBps).toBeGreaterThanOrEqual(0);
      expect(r.disk!.readBps).toBeGreaterThanOrEqual(0);
    }
  });

  test("procs: real pids only, sorted by CPU, DEAD_TASKS split out", () => {
    for (const r of [...idle, ...busy]) {
      expect(r.procs.length).toBeGreaterThan(50);
      expect(r.procs.every((p) => p.pid >= 0)).toBe(true);
      expect(r.procs.some((p) => p.name === "DEAD_TASKS")).toBe(false);
      for (let i = 1; i < r.procs.length; i++) expect(r.procs[i - 1]!.cpuPct).toBeGreaterThanOrEqual(r.procs[i]!.cpuPct);
      expect(r.deadTasks).toBeDefined();
      expect(r.allTasks!.cpuPct).toBeGreaterThan(0);
      expect(r.procs[0]!.rssB).toBeUndefined();
    }
  });

  test("under load the top processes are the `yes` burners at ~one core each", () => {
    const top = busy.at(-1)!.procs.slice(0, 8);
    for (const p of top) {
      expect(p.name).toBe("yes");
      expect(p.cpuPct).toBeGreaterThan(60);
      expect(p.cpuPct).toBeLessThanOrEqual(105);
    }
  });
});

describe("streaming", () => {
  test("chunked stream yields the same readings as whole-file parsing", async () => {
    const bytes = await load("idle-app.plist");
    async function* chunks() {
      for (let i = 0; i < bytes.length; i += 4093) yield bytes.subarray(i, i + 4093);
    }
    const got = [];
    for await (const r of readPowermetrics(chunks())) got.push(r);
    expect(got).toEqual(idle);
  });

  test("a corrupt sample is reported and skipped, not fatal", async () => {
    const bytes = await load("idle-app.plist");
    const enc = new TextEncoder();
    async function* chunks() {
      yield enc.encode("<plist><dict><key>oops</key>\0");
      yield bytes;
    }
    const errors: unknown[] = [];
    const got = [];
    for await (const r of readPowermetrics(chunks(), { onError: (e) => errors.push(e) })) got.push(r);
    expect(errors).toHaveLength(1);
    expect(got).toHaveLength(5);
  });
});

describe("edge cases", () => {
  test("sample without processor is rejected", () => {
    expect(() => toReading({ tasks: [] })).toThrow();
  });

  test("missing optional sections stay undefined", () => {
    const r = toReading({ processor: { clusters: [] } });
    expect(r.gpu).toBeUndefined();
    expect(r.net).toBeUndefined();
    expect(r.disk).toBeUndefined();
    expect(r.power).toBeUndefined();
    expect(r.thermal).toBeUndefined();
    expect(r.procs).toEqual([]);
  });

  test("gpu freq reported in real Hz is still normalized to MHz", () => {
    const r = toReading({ processor: { clusters: [] }, gpu: { freq_hz: 713_000_000, idle_ratio: 0.5 } });
    expect(r.gpu!.freqMHz).toBeCloseTo(713);
    expect(r.gpu!.activePct).toBeCloseTo(50);
  });

  test("multi-P-cluster chips (Pro/Max) classify by prefix", () => {
    const r = toReading({
      processor: { clusters: ["E-Cluster", "P0-Cluster", "P1-Cluster"].map((name) => ({ name, cpus: [] })) },
    });
    expect(r.cpu.clusters.map((c) => c.kind)).toEqual(["E", "P", "P"]);
  });

  test("thermal strings", () => {
    expect(parseThermal("Nominal")).toBe("nominal");
    expect(parseThermal("Moderate")).toBe("moderate");
    expect(parseThermal("Heavy")).toBe("heavy");
    expect(parseThermal("Trapping")).toBe("critical");
    expect(parseThermal("Sleeping")).toBe("critical");
    expect(parseThermal("Weird")).toBe("unknown");
  });
});
