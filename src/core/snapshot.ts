/**
 * Snapshot types: the boundary between macOS-specific collectors and the
 * platform-agnostic UI (see DESIGN.md §4, §6).
 *
 * Unit conventions, everywhere downstream of a collector:
 *   - percentages are 0–100
 *   - frequencies are MHz
 *   - power is watts
 *   - throughput is bytes/s (or ops/s, packets/s where noted)
 *   - times are ms since epoch unless suffixed otherwise
 */

export type CoreKind = "E" | "P";

export type ThermalPressure = "nominal" | "moderate" | "heavy" | "critical" | "unknown";

export type MemoryPressure = "normal" | "warn" | "critical";

// ---------------------------------------------------------------- topology

export interface Topology {
  chip: string;          // e.g. "Apple M1"
  model: string;         // e.g. "Macmini9,1"
  eCores: number;
  pCores: number;
  memoryB: number;
}

// ---------------------------------------------------------------- cpu / gpu / power

export interface CpuCluster {
  name: string;          // as reported, e.g. "E-Cluster", "P0-Cluster"
  kind: CoreKind;
  freqMHz: number;
  maxFreqMHz: number;
  /** Cluster-level residency: active while *any* core in it is busy. Not the core average. */
  activePct: number;
}

export interface CpuCore {
  id: number;            // logical CPU id
  kind: CoreKind;
  cluster: string;       // CpuCluster.name
  freqMHz: number;
  activePct: number;
}

export interface CpuReading {
  clusters: CpuCluster[];
  cores: CpuCore[];      // sorted by id
  loadAvg?: [number, number, number];
}

export interface GpuReading {
  freqMHz: number;
  maxFreqMHz: number;
  activePct: number;
}

export interface PowerReading {
  cpuW: number;
  gpuW: number;
  aneW: number;
  packageW: number;
}

// ---------------------------------------------------------------- io

export interface NetThroughput {
  rxBps: number;
  txBps: number;
  rxPps: number;         // packets/s
  txPps: number;
}

export interface DiskThroughput {
  readBps: number;
  writeBps: number;
  readOps: number;       // ops/s
  writeOps: number;
}

// ---------------------------------------------------------------- processes

export interface Proc {
  pid: number;
  name: string;
  /** 100 = one full core. Can exceed 100 for multi-threaded processes. */
  cpuPct: number;
  energyImpact: number;  // per second, powermetrics' "energy impact" score
  idleWakeupsPerS: number;
  intrWakeupsPerS: number;
  diskReadBps: number;
  diskWriteBps: number;
  netRxBps: number;
  netTxBps: number;
  /** Not provided by powermetrics; joined from ps/libproc later. */
  rssB?: number;
}

/** Aggregate rows powermetrics reports alongside per-process tasks. */
export interface ProcAggregate {
  cpuPct: number;
  energyImpact: number;
}

// ---------------------------------------------------------------- memory

export interface MemoryReading {
  totalB: number;
  usedB: number;
  wiredB: number;
  compressedB: number;
  cachedB: number;
  swapUsedB: number;
  swapTotalB: number;
  pressure: MemoryPressure;
}

export interface BatteryReading {
  pct: number;
  charging: boolean;
  cycles?: number;
  healthPct?: number;
}

// ---------------------------------------------------------------- collector outputs

/** One parsed powermetrics sample, units normalized. */
export interface PowermetricsReading {
  t: number;             // sample timestamp, ms epoch
  elapsedMs: number;     // actual sample window (≈1020 ms at -i 1000)
  hwModel: string;
  bootTimeS: number;
  cpu: CpuReading;
  gpu?: GpuReading;
  power?: PowerReading;
  thermal?: ThermalPressure;
  net?: NetThroughput;
  disk?: DiskThroughput;
  /** Real processes only (pid ≥ 0), sorted by cpuPct descending. */
  procs: Proc[];
  /** Tasks that exited during the window (powermetrics' DEAD_TASKS). */
  deadTasks?: ProcAggregate;
  /** Sum over all tasks (powermetrics' all_tasks). */
  allTasks?: ProcAggregate;
}

// ---------------------------------------------------------------- snapshot

/** The merged, per-tick state the UI renders. */
export interface Snapshot {
  t: number;
  privileged: boolean;   // false = degraded mode (no powermetrics)
  topology: Topology;
  cpu?: CpuReading;
  gpu?: GpuReading;
  power?: PowerReading;
  thermal?: ThermalPressure;
  memory?: MemoryReading;
  net?: NetThroughput;
  disk?: DiskThroughput;
  battery?: BatteryReading;
  procs: Proc[];
  uptimeS: number;
}
