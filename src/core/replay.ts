/**
 * Demo/replay source: builds Snapshots from a fixture capture directory.
 * The CPU/power stream loops idle → load → idle so the visuals have something
 * to react to. Memory is a single static capture.
 */
import { join } from "node:path";
import { memoryReading, parsePressureLevel, parseSwapUsage, parseSysctl, parseVmStat } from "../collectors/memory.ts";
import { parseCapture } from "../collectors/powermetrics.ts";
import type { MemoryReading, PowermetricsReading, Snapshot, Topology } from "./snapshot.ts";

export interface ReplaySource {
  /** Snapshot for elapsed demo time (seconds). Advances one sample per second. */
  at(tS: number): Snapshot;
  topology: Topology;
}

export async function loadFixtureReplay(dir: string): Promise<ReplaySource> {
  const read = (p: string) => Bun.file(join(dir, p)).text();
  const bytes = async (p: string) => new Uint8Array(await Bun.file(join(dir, p)).arrayBuffer());

  const idle = parseCapture(await bytes("powermetrics/idle-app.plist"));
  const busy = parseCapture(await bytes("powermetrics/cpu-load-app.plist"));
  // 5 idle, 5 busy, then idle again (reversed so it doesn't jump).
  const loop: PowermetricsReading[] = [...idle, ...busy, ...busy.slice().reverse(), ...idle.slice().reverse()];

  const topo = parseSysctl(await read("unprivileged/sysctl-topology.txt"));
  const runtime = parseSysctl(await read("unprivileged/sysctl-runtime.txt"));
  const levels = [0, 1].map((i) => ({
    name: topo[`hw.perflevel${i}.name`] ?? "",
    n: Number(topo[`hw.perflevel${i}.logicalcpu`] ?? 0),
  }));
  const topology: Topology = {
    chip: topo["machdep.cpu.brand_string"] ?? "Apple Silicon",
    model: topo["hw.model"] ?? "",
    pCores: levels.find((l) => l.name === "Performance")?.n ?? 0,
    eCores: levels.find((l) => l.name === "Efficiency")?.n ?? 0,
    memoryB: Number(topo["hw.memsize"] ?? 0),
  };

  const memory: MemoryReading = memoryReading(
    parseVmStat(await read("unprivileged/vm_stat.txt")),
    topology.memoryB,
    parseSwapUsage(runtime["vm.swapusage"] ?? ""),
    parsePressureLevel(Number(runtime["kern.memorystatus_vm_pressure_level"] ?? 1)),
  );
  const loadAvg = (runtime["vm.loadavg"] ?? "").match(/[\d.]+/g)?.slice(0, 3).map(Number) as
    | [number, number, number]
    | undefined;

  const first = loop[0]!;
  return {
    topology,
    at(tS: number): Snapshot {
      const r = loop[Math.floor(Math.max(0, tS)) % loop.length]!;
      return {
        t: first.t + tS * 1000,
        privileged: true,
        topology,
        cpu: { ...r.cpu, loadAvg },
        gpu: r.gpu,
        power: r.power,
        thermal: r.thermal,
        memory,
        net: r.net,
        disk: r.disk,
        procs: r.procs,
        uptimeS: Math.max(0, first.t / 1000 - r.bootTimeS) + tS,
      };
    },
  };
}
