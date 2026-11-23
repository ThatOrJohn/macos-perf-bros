/**
 * Record / replay of merged Snapshots as NDJSON (DESIGN.md §11).
 *   perf-bros --record session.ndjson   one Snapshot per line, once per second
 *   perf-bros --replay session.ndjson   play it back (loops)
 */
import { appendFileSync, writeFileSync } from "node:fs";
import type { SnapshotSource } from "./live.ts";
import type { Snapshot } from "./snapshot.ts";

export class Recorder {
  private timer: ReturnType<typeof setInterval>;
  lines = 0;

  constructor(private readonly path: string, source: SnapshotSource, intervalMs = 1000) {
    writeFileSync(path, "");
    this.timer = setInterval(() => {
      appendFileSync(path, `${JSON.stringify(source.at(0))}\n`);
      this.lines++;
    }, intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

export async function loadNdjsonReplay(path: string): Promise<SnapshotSource & { sampleCount: number }> {
  const text = await Bun.file(path).text();
  const snaps: Snapshot[] = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Snapshot);
  if (!snaps.length) throw new Error(`${path}: no snapshots`);
  const t0 = snaps[0]!.t;
  return {
    sampleCount: snaps.length,
    at(tS: number): Snapshot {
      const s = snaps[Math.floor(Math.max(0, tS)) % snaps.length]!;
      // keep time moving forward across loops so uptime/animations stay sane
      return { ...s, t: t0 + tS * 1000, uptimeS: snaps[0]!.uptimeS + tS };
    },
    stop() {},
  };
}
