import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadFixtureReplay } from "../src/core/replay.ts";
import type { CpuReading, MemoryReading, Snapshot } from "../src/core/snapshot.ts";

const FIXTURE = "fixtures/raw/apple-m1_macos-27.0.1";
const OUT_DIR = "fixtures/scenarios";
const SAMPLES = 20;
const GiB = 1024 ** 3;
const MB = 1000 ** 2;

const capture = (await loadFixtureReplay(FIXTURE)).at(0);
if (!capture.cpu || !capture.gpu || !capture.memory) {
  throw new Error("Scenario seed requires CPU, GPU and memory readings");
}

function lerp(low: number, high: number, load: number): number {
  return low + (high - low) * load;
}

const cpu: CpuReading = {
  cores: capture.cpu.cores.map((core) => ({
    ...core, freqMHz: Math.round(core.freqMHz * 0.5), activePct: 4 + core.id,
  })),
  clusters: capture.cpu.clusters.map((cluster) => ({
    ...cluster, freqMHz: Math.round(cluster.freqMHz * 0.5), activePct: 12,
  })),
  loadAvg: [0.25, 0.2, 0.15],
};
const gpu = { ...capture.gpu, freqMHz: Math.round(capture.gpu.maxFreqMHz / 3), activePct: 2 };
const memory: MemoryReading = {
  totalB: capture.topology.memoryB,
  usedB: 4 * GiB,
  wiredB: GiB,
  compressedB: GiB / 8,
  cachedB: GiB,
  swapUsedB: 0,
  swapTotalB: capture.memory.swapTotalB,
  pressure: "normal",
};
const power = { cpuW: 0.8, gpuW: 0.2, aneW: 0, packageW: 1 };
const net = { rxBps: 0, txBps: 0, rxPps: 0, txPps: 0 };
const disk = { readBps: 0, writeBps: 0, readOps: 0, writeOps: 0 };
// Keep fixture PIDs and names, with deterministic RSS in all three Process Plains size buckets.
const procs = capture.procs.slice(0, 12).map(({ pid, name }, i) => ({
  pid, name, cpuPct: 6 - i / 2, rssB: [1.25 * GiB, 240 * MB, 45 * MB][i % 3]!,
  energyImpact: 0, idleWakeupsPerS: 0, intrWakeupsPerS: 0,
  diskReadBps: 0, diskWriteBps: 0, netRxBps: 0, netTxBps: 0,
}));
const idle: Snapshot = { ...capture, cpu, gpu, memory, power, net, disk, procs, thermal: "nominal" };
const maxFreq = new Map(cpu.clusters.map((cluster) => [cluster.name, cluster.maxFreqMHz]));

const scenarios: Record<string, (load: number) => Partial<Snapshot>> = {
  idle: () => ({}),
  "cpu-fire": (load) => ({
    cpu: {
      cores: cpu.cores.map((core) => ({
        ...core,
        freqMHz: Math.round(lerp(core.freqMHz, maxFreq.get(core.cluster)!, load)),
        activePct: lerp(core.activePct, 95 + core.id % 6, load),
      })),
      clusters: cpu.clusters.map((cluster) => ({
        ...cluster,
        freqMHz: Math.round(lerp(cluster.freqMHz, cluster.maxFreqMHz, load)),
        activePct: lerp(cluster.activePct, 100, load),
      })),
      loadAvg: [lerp(0.25, 8, load), lerp(0.2, 3, load), lerp(0.15, 1, load)],
    },
    power: { ...power, cpuW: lerp(power.cpuW, 19.8, load), packageW: lerp(power.packageW, 20, load) },
    thermal: load >= 0.8 ? "heavy" : load >= 0.4 ? "moderate" : "nominal",
    procs: procs.map((proc, i) => ({
      ...proc,
      cpuPct: lerp(proc.cpuPct, i === 0 ? 265 : 82 - 6 * i, load),
      energyImpact: Math.round(load * (500 - 35 * i)),
      idleWakeupsPerS: Math.round(load * (100 - 8 * i)),
    })),
  }),
  "swap-storm": (load) => ({
    memory: {
      ...memory,
      usedB: Math.round(lerp(memory.usedB, memory.totalB * 0.99, load)),
      wiredB: Math.round(lerp(memory.wiredB, 2.5 * GiB, load)),
      compressedB: Math.round(lerp(memory.compressedB, 8 * GiB, load)),
      cachedB: Math.round(lerp(memory.cachedB, 0, load)),
      swapUsedB: Math.round(load * memory.swapTotalB * 0.97),
      pressure: load >= 0.8 ? "critical" : load >= 0.5 ? "warn" : "normal",
    },
  }),
  "net-burst": (load) => ({
    net: {
      rxBps: Math.round(80 * MB * load), txBps: 5 * MB,
      rxPps: Math.round(60_000 * load), txPps: 4_000,
    },
    procs: procs.map((proc, i) => i < 3 ? {
      ...proc, netRxBps: Math.round((36 - 10 * i) * MB * load), netTxBps: (2 - i / 2) * MB,
    } : proc),
  }),
  "disk-thrash": (load) => ({
    disk: {
      readBps: Math.round(1_500 * MB * load), writeBps: Math.round(600 * MB * load),
      readOps: Math.round(12_000 * load), writeOps: Math.round(5_000 * load),
    },
    procs: procs.map((proc, i) => i < 2 ? {
      ...proc,
      diskReadBps: Math.round((900 - 400 * i) * MB * load),
      diskWriteBps: Math.round((350 - 150 * i) * MB * load),
    } : proc),
  }),
  "gpu-busy": (load) => ({
    gpu: {
      ...gpu,
      freqMHz: Math.round(lerp(gpu.freqMHz, gpu.maxFreqMHz, load)),
      activePct: lerp(gpu.activePct, 95, load),
    },
    power: { cpuW: power.cpuW, gpuW: lerp(power.gpuW, 12, load), aneW: 2 * load, packageW: lerp(1, 14.8, load) },
  }),
  degraded: (load) => ({
    privileged: false,
    gpu: undefined, power: undefined, thermal: undefined, net: undefined, disk: undefined,
    cpu: {
      cores: cpu.cores.map((core) => ({
        ...core, freqMHz: 0, activePct: core.activePct + 20 * load,
      })),
      clusters: cpu.clusters.map((cluster) => ({
        ...cluster, freqMHz: 0, maxFreqMHz: 0,
        activePct: Math.max(...cpu.cores.filter((core) => core.cluster === cluster.name).map((core) => core.activePct)) + 20 * load,
      })),
    },
  }),
};

await mkdir(OUT_DIR, { recursive: true });
for (const [name, override] of Object.entries(scenarios)) {
  const samples = Array.from({ length: SAMPLES }, (_, i) => {
    // Two peak samples in the middle, followed by a return to the starting state.
    const load = Math.min(i, SAMPLES - 1 - i) / (SAMPLES / 2 - 1);
    const snap: Snapshot = { ...idle, ...override(load), t: idle.t + i * 1000, uptimeS: idle.uptimeS + i };
    return JSON.stringify(snap);
  });
  await Bun.write(join(OUT_DIR, `${name}.ndjson`), `${samples.join("\n")}\n`);
}
