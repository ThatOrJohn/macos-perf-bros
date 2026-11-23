/**
 * Turns powermetrics `-f plist` output into typed, unit-normalized readings.
 *
 * Verified paths, units and quirks are documented in fixtures/README.md.
 * Spawning powermetrics (and sudo handling) lives elsewhere; this module only
 * parses bytes it is given, so it runs identically on live output and fixtures.
 */
import { NulSplitter, parsePlist, type PlistValue } from "./plist.ts";
import type {
  CoreKind,
  CpuCluster,
  CpuCore,
  PowermetricsReading,
  Proc,
  ProcAggregate,
  ThermalPressure,
} from "../core/snapshot.ts";

type Dict = { [key: string]: PlistValue };

/** Samplers the app requests (DESIGN.md §5). */
export const POWERMETRICS_SAMPLERS = [
  "cpu_power",
  "gpu_power",
  "ane_power",
  "thermal",
  "tasks",
  "network",
  "disk",
] as const;

export function powermetricsArgs(intervalMs = 1000): string[] {
  return [
    "-f", "plist",
    "-i", String(intervalMs),
    "--samplers", POWERMETRICS_SAMPLERS.join(","),
    "--show-process-energy",
    "--handle-invalid-values",
  ];
}

// ---------------------------------------------------------------- accessors

function isDict(v: PlistValue | undefined): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function dict(v: PlistValue | undefined): Dict | undefined {
  return isDict(v) ? v : undefined;
}

function arr(v: PlistValue | undefined): PlistValue[] {
  return Array.isArray(v) ? v : [];
}

function num(d: Dict | undefined, key: string, fallback = 0): number {
  const v = d?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(d: Dict | undefined, key: string, fallback = ""): string {
  const v = d?.[key];
  return typeof v === "string" ? v : fallback;
}

const clampPct = (x: number) => Math.min(100, Math.max(0, x));
const activePct = (d: Dict) => clampPct((1 - num(d, "idle_ratio", 1)) * 100);

/** Max frequency (MHz) from the last DVFM state; DVFM `freq` values are MHz. */
function maxFreqMHz(d: Dict): number {
  let max = 0;
  for (const s of arr(d["dvfm_states"])) max = Math.max(max, num(dict(s), "freq"));
  return max;
}

function clusterKind(name: string): CoreKind {
  // "E-Cluster", "P-Cluster", "P0-Cluster", "P1-Cluster", ...
  return name.trim().toUpperCase().startsWith("E") ? "E" : "P";
}

export function parseThermal(s: string): ThermalPressure {
  switch (s.toLowerCase()) {
    case "nominal": return "nominal";
    case "moderate": return "moderate";
    case "heavy": return "heavy";
    case "trapping":
    case "sleeping":
    case "critical": return "critical";
    default: return "unknown";
  }
}

function aggregate(d: Dict | undefined): ProcAggregate | undefined {
  if (!d) return undefined;
  return { cpuPct: num(d, "cputime_ms_per_s") / 10, energyImpact: num(d, "energy_impact_per_s") };
}

// ---------------------------------------------------------------- mapping

export class PowermetricsFormatError extends Error {
  override name = "PowermetricsFormatError";
}

/** Map one parsed plist sample to a reading. Throws if the sample isn't usable at all. */
export function toReading(raw: PlistValue): PowermetricsReading {
  const root = dict(raw);
  const processor = dict(root?.["processor"]);
  if (!root || !processor) throw new PowermetricsFormatError("sample has no processor dict");

  // ---- cpu
  const clusters: CpuCluster[] = [];
  const cores: CpuCore[] = [];
  for (const c of arr(processor["clusters"])) {
    const cd = dict(c);
    if (!cd) continue;
    const name = str(cd, "name", "?");
    const kind = clusterKind(name);
    clusters.push({
      name,
      kind,
      freqMHz: num(cd, "freq_hz") / 1e6,
      maxFreqMHz: maxFreqMHz(cd),
      activePct: activePct(cd),
    });
    for (const core of arr(cd["cpus"])) {
      const kd = dict(core);
      if (!kd) continue;
      cores.push({
        id: num(kd, "cpu", -1),
        kind,
        cluster: name,
        freqMHz: num(kd, "freq_hz") / 1e6,
        activePct: activePct(kd),
      });
    }
  }
  cores.sort((a, b) => a.id - b.id);

  // ---- gpu: freq_hz is actually MHz (fixtures/README.md). Guard in case Apple fixes it.
  const g = dict(root["gpu"]);
  const gpu = g && {
    freqMHz: ((f) => (f > 100_000 ? f / 1e6 : f))(num(g, "freq_hz")),
    maxFreqMHz: maxFreqMHz(g),
    activePct: activePct(g),
  };

  // ---- power: mW → W
  const power = "cpu_power" in processor
    ? {
        cpuW: num(processor, "cpu_power") / 1000,
        gpuW: num(processor, "gpu_power") / 1000,
        aneW: num(processor, "ane_power") / 1000,
        packageW: num(processor, "combined_power") / 1000,
      }
    : undefined;

  // ---- io
  const n = dict(root["network"]);
  const net = n && {
    rxBps: num(n, "ibyte_rate"),
    txBps: num(n, "obyte_rate"),
    rxPps: num(n, "ipacket_rate"),
    txPps: num(n, "opacket_rate"),
  };
  const d = dict(root["disk"]);
  const disk = d && {
    readBps: num(d, "rbytes_per_s"),
    writeBps: num(d, "wbytes_per_s"),
    readOps: num(d, "rops_per_s"),
    writeOps: num(d, "wops_per_s"),
  };

  // ---- tasks
  const procs: Proc[] = [];
  let deadTasks: ProcAggregate | undefined;
  for (const t of arr(root["tasks"])) {
    const td = dict(t);
    if (!td) continue;
    const pid = num(td, "pid", -1);
    if (pid < 0) {
      if (str(td, "name") === "DEAD_TASKS") deadTasks = aggregate(td);
      continue;
    }
    procs.push({
      pid,
      name: str(td, "name", `pid ${pid}`),
      cpuPct: num(td, "cputime_ms_per_s") / 10,
      energyImpact: num(td, "energy_impact_per_s"),
      idleWakeupsPerS: num(td, "idle_wakeups_per_s"),
      intrWakeupsPerS: num(td, "intr_wakeups_per_s"),
      diskReadBps: num(td, "diskio_bytesread_per_s"),
      diskWriteBps: num(td, "diskio_byteswritten_per_s"),
      netRxBps: num(td, "bytes_received_per_s"),
      netTxBps: num(td, "bytes_sent_per_s"),
    });
  }
  procs.sort((a, b) => b.cpuPct - a.cpuPct);

  const ts = root["timestamp"];
  const thermalRaw = root["thermal_pressure"];

  return {
    t: ts instanceof Date && !Number.isNaN(ts.getTime()) ? ts.getTime() : Date.now(),
    elapsedMs: num(root, "elapsed_ns") / 1e6,
    hwModel: str(root, "hw_model"),
    bootTimeS: num(root, "kern_boottime"),
    cpu: { clusters, cores },
    gpu,
    power,
    thermal: typeof thermalRaw === "string" ? parseThermal(thermalRaw) : undefined,
    net,
    disk,
    procs,
    deadTasks,
    allTasks: aggregate(dict(root["all_tasks"])),
  };
}

/** Parse one NUL-delimited plist record. */
export function parseSample(xml: string): PowermetricsReading {
  return toReading(parsePlist(xml));
}

/** Parse a whole capture (e.g. a fixture file's contents). */
export function parseCapture(bytes: Uint8Array): PowermetricsReading[] {
  const splitter = new NulSplitter();
  const records = splitter.push(bytes);
  const tail = splitter.flush();
  if (tail) records.push(tail);
  return records.map(parseSample);
}

export interface StreamOptions {
  /** Called for a sample that fails to parse; the stream continues. */
  onError?: (err: unknown, record: string) => void;
}

/** Yield a reading for every complete sample on a live powermetrics stdout stream. */
export async function* readPowermetrics(
  stream: AsyncIterable<Uint8Array>,
  opts: StreamOptions = {},
): AsyncGenerator<PowermetricsReading> {
  const splitter = new NulSplitter();
  const handle = function* (records: string[]) {
    for (const rec of records) {
      try {
        yield parseSample(rec);
      } catch (err) {
        opts.onError?.(err, rec);
      }
    }
  };
  for await (const chunk of stream) yield* handle(splitter.push(chunk));
  const tail = splitter.flush();
  if (tail) yield* handle([tail]);
}
