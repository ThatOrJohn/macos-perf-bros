/**
 * Memory parsing from unprivileged sources: vm_stat, `sysctl vm.swapusage`,
 * `sysctl kern.memorystatus_vm_pressure_level`. Pure functions over text so
 * they run against fixtures and live output alike.
 *
 * Categories follow Activity Monitor:
 *   app        = anonymous − purgeable
 *   wired      = wired down
 *   compressed = occupied by compressor
 *   used       = app + wired + compressed
 *   cached     = file-backed + purgeable
 */
import type { MemoryPressure, MemoryReading } from "../core/snapshot.ts";

export interface VmStat {
  pageSize: number;
  pages: Record<string, number>; // keyed by vm_stat label, lowercased, quotes stripped
}

export function parseVmStat(text: string): VmStat {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384);
  const pages: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim());
    if (m) pages[m[1]!.toLowerCase()] = Number(m[2]);
  }
  return { pageSize, pages };
}

/** `vm.swapusage: total = 15360.00M  used = 14108.12M  free = 1251.88M  (encrypted)` */
export function parseSwapUsage(text: string): { totalB: number; usedB: number } {
  const unit = (n: string, u: string) => Number(n) * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[u] ?? 1);
  const get = (k: string) => {
    const m = new RegExp(`${k} = ([\\d.]+)([KMG])`).exec(text);
    return m ? unit(m[1]!, m[2]!) : 0;
  };
  return { totalB: get("total"), usedB: get("used") };
}

/** kern.memorystatus_vm_pressure_level: 1 = normal, 2 = warn, 4 = critical. */
export function parsePressureLevel(level: number): MemoryPressure {
  if (level >= 4) return "critical";
  if (level >= 2) return "warn";
  return "normal";
}

export function memoryReading(vm: VmStat, totalB: number, swap: { totalB: number; usedB: number }, pressure: MemoryPressure): MemoryReading {
  const p = (k: string) => (vm.pages[k] ?? 0) * vm.pageSize;
  const app = Math.max(0, p("anonymous pages") - p("pages purgeable"));
  const wired = p("pages wired down");
  const compressed = p("pages occupied by compressor");
  return {
    totalB,
    usedB: app + wired + compressed,
    wiredB: wired,
    compressedB: compressed,
    cachedB: p("file-backed pages") + p("pages purgeable"),
    swapUsedB: swap.usedB,
    swapTotalB: swap.totalB,
    pressure,
  };
}

/** Parse `sysctl name: value` lines into a map. */
export function parseSysctl(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
