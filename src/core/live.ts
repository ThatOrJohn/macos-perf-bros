/**
 * Live snapshot source: runs every collector on its own cadence and feeds the
 * SnapshotBus.
 *
 *   powermetrics (sudo)   1 Hz stream   cpu, gpu, power, thermal, net, disk, tasks
 *   host CPU (FFI)        1 Hz          per-core busy % (degraded-mode fallback)
 *   vm_stat + sysctl      1 Hz          memory, swap, pressure
 *   ps                    every 2 s     RSS per pid (and procs in degraded mode)
 */
import { HostCpuSampler } from "../collectors/hostcpu.ts";
import { startPowermetrics, type PowermetricsHandle } from "../collectors/powermetrics-process.ts";
import { readBootTimeS, readMemory, readPs, readTopology } from "../collectors/system.ts";
import { SnapshotBus } from "./bus.ts";
import type { Snapshot } from "./snapshot.ts";

export interface SnapshotSource {
  /** Current snapshot. `tS` is the app's elapsed time; live sources ignore it. */
  at(tS: number): Snapshot;
  stop(): void;
}

export interface LiveOptions {
  /** Start powermetrics (sudo must already be validated). */
  privileged: boolean;
  intervalMs?: number;
  log?: (msg: string) => void;
}

export interface LiveSource extends SnapshotSource {
  readonly bus: SnapshotBus;
  /** Why powermetrics isn't running, if it isn't. */
  readonly pmStatus: () => string;
}

export async function startLive(opts: LiveOptions): Promise<LiveSource> {
  const [topology, bootTimeS] = await Promise.all([readTopology(), readBootTimeS()]);
  const bus = new SnapshotBus(topology, bootTimeS);
  const interval = opts.intervalMs ?? 1000;
  const timers: ReturnType<typeof setInterval>[] = [];
  let pm: PowermetricsHandle | undefined;
  let pmStatus = opts.privileged ? "starting" : "not privileged (run with sudo access for GPU, power, thermal, frequencies)";

  // host CPU fallback (cheap; always on so degraded mode is instant)
  let hostCpu: HostCpuSampler | undefined;
  try {
    hostCpu = new HostCpuSampler(topology);
    hostCpu.sample();
    timers.push(setInterval(() => {
      try { bus.hostCpu = hostCpu!.sample(); } catch (e) { opts.log?.(`host cpu: ${e}`); }
    }, interval));
  } catch (e) {
    opts.log?.(`host cpu sampler unavailable: ${e}`);
  }

  // memory
  const pollMemory = () => readMemory(topology.memoryB).then((m) => { bus.memory = m; }, (e) => opts.log?.(`memory: ${e}`));
  await pollMemory();
  timers.push(setInterval(pollMemory, interval));

  // ps
  const pollPs = () => readPs().then((rows) => { bus.ps = rows; }, (e) => opts.log?.(`ps: ${e}`));
  await pollPs();
  timers.push(setInterval(pollPs, 2000));

  // powermetrics
  if (opts.privileged) {
    pm = startPowermetrics({
      intervalMs: interval,
      onReading: (r) => { bus.setPowermetrics(r); pmStatus = "running"; },
      onError: (e) => opts.log?.(`powermetrics sample skipped: ${e}`),
    });
    pm.exited.then((code) => {
      pmStatus = `exited (code ${code})`;
      opts.log?.(`powermetrics exited with code ${code}; continuing in degraded mode`);
    });
  }

  return {
    bus,
    pmStatus: () => pmStatus,
    at: () => bus.snapshot(),
    stop() {
      for (const t of timers) clearInterval(t);
      pm?.stop();
      hostCpu?.close();
    },
  };
}
