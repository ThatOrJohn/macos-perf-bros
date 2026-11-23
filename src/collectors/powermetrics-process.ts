/**
 * Runs `sudo -n powermetrics` as a child process and streams parsed readings.
 * Requires sudo to already be validated (see core/privilege.ts).
 */
import type { PowermetricsReading } from "../core/snapshot.ts";
import { powermetricsArgs, readPowermetrics } from "./powermetrics.ts";

export interface PowermetricsHandle {
  stop(): void;
  /** Resolves when the child exits (expected or not). */
  exited: Promise<number>;
}

export interface PowermetricsOptions {
  intervalMs?: number;
  onReading: (r: PowermetricsReading) => void;
  onError?: (err: unknown) => void;
}

export function startPowermetrics(opts: PowermetricsOptions): PowermetricsHandle {
  const proc = Bun.spawn(["sudo", "-n", "/usr/bin/powermetrics", ...powermetricsArgs(opts.intervalMs ?? 1000)], {
    stdout: "pipe",
    stderr: "ignore", // powermetrics prints harmless "Second underflow occured." here
    stdin: "ignore",
  });

  (async () => {
    try {
      for await (const r of readPowermetrics(proc.stdout, { onError: opts.onError })) opts.onReading(r);
    } catch (err) {
      opts.onError?.(err);
    }
  })();

  const stop = () => {
    // sudo relays SIGTERM to powermetrics. If that fails, the closed pipe ends it (SIGPIPE).
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.once("exit", stop);
  return { stop, exited: proc.exited };
}
