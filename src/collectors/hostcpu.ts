/**
 * Unprivileged per-core CPU load via Mach `host_processor_info`
 * (PROCESSOR_CPU_LOAD_INFO), called through Bun FFI.
 *
 * Used in degraded mode (no sudo) so the CPU Fortress still works. Gives busy %
 * per logical CPU but no frequencies; those need powermetrics.
 *
 * Assumption (true for every Apple Silicon chip so far): efficiency cores are
 * the lowest logical CPU ids, so ids < eCores are E and the rest are P.
 */
import { FFIType, dlopen, ptr, toArrayBuffer } from "bun:ffi";
import type { CpuCore, CpuReading, Topology } from "../core/snapshot.ts";

const PROCESSOR_CPU_LOAD_INFO = 2;
const CPU_STATE_USER = 0;
const CPU_STATE_SYSTEM = 1;
const CPU_STATE_IDLE = 2;
const CPU_STATE_NICE = 3;
const CPU_STATE_MAX = 4;

type Lib = ReturnType<typeof open>;
function open() {
  return dlopen("/usr/lib/libSystem.B.dylib", {
    mach_host_self: { args: [], returns: FFIType.u32 },
    task_self_trap: { args: [], returns: FFIType.u32 },
    host_processor_info: { args: [FFIType.u32, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    vm_deallocate: { args: [FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  });
}

export class HostCpuSampler {
  private lib: Lib;
  private host: number;
  private task: number;
  private prev?: Uint32Array;

  constructor(private readonly topology: Topology) {
    this.lib = open();
    this.host = this.lib.symbols.mach_host_self();
    this.task = this.lib.symbols.task_self_trap();
  }

  /** Raw cumulative ticks: [user, system, idle, nice] per CPU. */
  private ticks(): Uint32Array {
    const count = new Uint32Array(1);
    const info = new BigUint64Array(1);
    const infoCnt = new Uint32Array(1);
    const kr = this.lib.symbols.host_processor_info(this.host, PROCESSOR_CPU_LOAD_INFO, ptr(count), ptr(info), ptr(infoCnt));
    if (kr !== 0) throw new Error(`host_processor_info failed: kern_return ${kr}`);
    const bytes = infoCnt[0]! * 4;
    const out = new Uint32Array(toArrayBuffer(Number(info[0]), 0, bytes).slice(0));
    this.lib.symbols.vm_deallocate(this.task, info[0]!, BigInt(bytes));
    return out;
  }

  /** Busy % per core since the previous call (undefined on the first call). */
  sample(): CpuReading | undefined {
    const now = this.ticks();
    const prev = this.prev;
    this.prev = now;
    if (!prev || prev.length !== now.length) return undefined;
    const n = now.length / CPU_STATE_MAX;
    const cores: CpuCore[] = [];
    for (let id = 0; id < n; id++) {
      const o = id * CPU_STATE_MAX;
      const d = (k: number) => (now[o + k]! - prev[o + k]!) >>> 0; // wrap-safe
      const busy = d(CPU_STATE_USER) + d(CPU_STATE_SYSTEM) + d(CPU_STATE_NICE);
      const total = busy + d(CPU_STATE_IDLE);
      const kind = id < this.topology.eCores ? ("E" as const) : ("P" as const);
      cores.push({ id, kind, cluster: `${kind}-Cluster`, freqMHz: 0, activePct: total > 0 ? (busy / total) * 100 : 0 });
    }
    const clusters = (["E", "P"] as const)
      .map((kind) => {
        const cs = cores.filter((c) => c.kind === kind);
        if (!cs.length) return undefined;
        // No residency data without powermetrics: approximate cluster busy as the busiest core.
        return { name: `${kind}-Cluster`, kind, freqMHz: 0, maxFreqMHz: 0, activePct: Math.max(...cs.map((c) => c.activePct)) };
      })
      .filter((c) => c !== undefined);
    return { clusters, cores };
  }

  close(): void {
    this.lib.close();
  }
}
