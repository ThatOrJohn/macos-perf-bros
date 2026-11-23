/**
 * SnapshotBus: holds the latest partial reading from each collector and merges
 * them into one Snapshot on demand (DESIGN.md §4). Pure — no timers or I/O —
 * so merge rules are unit-testable.
 *
 * Merge rules:
 *   - powermetrics data counts only while fresh (< STALE_MS old); stale or
 *     missing powermetrics = degraded mode (privileged: false).
 *   - cpu: powermetrics when fresh, else the unprivileged host CPU sampler.
 *   - gpu / power / thermal / net / disk: powermetrics only.
 *   - procs: powermetrics tasks joined with ps RSS by pid; in degraded mode,
 *     ps rows alone.
 */
import type { PsRow } from "../collectors/system.ts";
import type { CpuReading, MemoryReading, PowermetricsReading, Proc, Snapshot, Topology } from "./snapshot.ts";

export const STALE_MS = 3500;

export class SnapshotBus {
  pm?: PowermetricsReading;
  pmReceivedAt = 0;
  hostCpu?: CpuReading;
  memory?: MemoryReading;
  ps: PsRow[] = [];

  constructor(readonly topology: Topology, readonly bootTimeS: number) {}

  setPowermetrics(r: PowermetricsReading, receivedAt = Date.now()): void {
    this.pm = r;
    this.pmReceivedAt = receivedAt;
  }

  snapshot(now = Date.now()): Snapshot {
    const pm = this.pm && now - this.pmReceivedAt < STALE_MS ? this.pm : undefined;
    const rss = new Map(this.ps.map((r) => [r.pid, r.rssB]));
    let procs: Proc[];
    if (pm) {
      procs = pm.procs.map((p) => ({ ...p, rssB: rss.get(p.pid) }));
    } else {
      procs = this.ps
        .map((r) => ({
          pid: r.pid, name: r.name, cpuPct: r.cpuPct, rssB: r.rssB,
          energyImpact: 0, idleWakeupsPerS: 0, intrWakeupsPerS: 0, diskReadBps: 0, diskWriteBps: 0, netRxBps: 0, netTxBps: 0,
        }))
        .sort((a, b) => b.cpuPct - a.cpuPct);
    }
    return {
      t: now,
      privileged: !!pm,
      topology: this.topology,
      cpu: pm?.cpu ?? this.hostCpu,
      gpu: pm?.gpu,
      power: pm?.power,
      thermal: pm?.thermal,
      memory: this.memory,
      net: pm?.net,
      disk: pm?.disk,
      procs,
      uptimeS: this.bootTimeS > 0 ? Math.max(0, now / 1000 - this.bootTimeS) : 0,
    };
  }
}
