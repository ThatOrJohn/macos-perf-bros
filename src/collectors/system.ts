/**
 * Unprivileged live collectors that shell out to standard macOS tools:
 * sysctl (topology, swap, pressure, boot time), vm_stat (memory), ps (RSS).
 * Parsing lives in memory.ts so it's shared with fixtures.
 */
import type { MemoryReading, Topology } from "../core/snapshot.ts";
import { memoryReading, parsePressureLevel, parseSwapUsage, parseSysctl, parseVmStat } from "./memory.ts";

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(p.stdout).text();
  await p.exited;
  return text;
}

export async function sysctl(names: string[]): Promise<Record<string, string>> {
  // -i: ignore unknown names (e.g. perflevel1 on a hypothetical single-cluster chip)
  return parseSysctl(await run(["sysctl", "-i", ...names]));
}

export function topologyFromSysctl(v: Record<string, string>): Topology {
  const levels = [0, 1].map((i) => ({ name: v[`hw.perflevel${i}.name`] ?? "", n: Number(v[`hw.perflevel${i}.logicalcpu`] ?? 0) }));
  return {
    chip: v["machdep.cpu.brand_string"] ?? "Apple Silicon",
    model: v["hw.model"] ?? "",
    pCores: levels.find((l) => l.name === "Performance")?.n ?? 0,
    eCores: levels.find((l) => l.name === "Efficiency")?.n ?? 0,
    memoryB: Number(v["hw.memsize"] ?? 0),
  };
}

export async function readTopology(): Promise<Topology> {
  return topologyFromSysctl(await sysctl([
    "hw.model", "hw.memsize", "machdep.cpu.brand_string",
    "hw.perflevel0.name", "hw.perflevel0.logicalcpu", "hw.perflevel1.name", "hw.perflevel1.logicalcpu",
  ]));
}

/** `kern.boottime: { sec = 1795181477, usec = 304595 } Fri Nov 20 07:31:17 2026` → seconds. */
export function parseBootTime(s: string | undefined): number {
  return Number(/sec = (\d+)/.exec(s ?? "")?.[1] ?? 0);
}

export async function readBootTimeS(): Promise<number> {
  return parseBootTime((await sysctl(["kern.boottime"]))["kern.boottime"]);
}

export async function readMemory(totalB: number): Promise<MemoryReading> {
  const [vm, sc] = await Promise.all([
    run(["vm_stat"]),
    sysctl(["vm.swapusage", "kern.memorystatus_vm_pressure_level"]),
  ]);
  return memoryReading(
    parseVmStat(vm),
    totalB,
    parseSwapUsage(sc["vm.swapusage"] ?? ""),
    parsePressureLevel(Number(sc["kern.memorystatus_vm_pressure_level"] ?? 1)),
  );
}

export interface PsRow { pid: number; rssB: number; cpuPct: number; name: string }

/** `ps -Ao pid=,rss=,%cpu=,comm=` → rows. comm may contain spaces (full path). */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const comm = m[4]!.trim();
    rows.push({ pid: Number(m[1]), rssB: Number(m[2]) * 1024, cpuPct: Number(m[3]), name: comm.slice(comm.lastIndexOf("/") + 1) });
  }
  return rows;
}

export async function readPs(): Promise<PsRow[]> {
  return parsePs(await run(["ps", "-Ao", "pid=,rss=,%cpu=,comm="]));
}
