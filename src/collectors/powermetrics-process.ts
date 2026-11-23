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
  // Drop the listener once this child is gone so supervised restarts don't pile them up.
  proc.exited.then(() => process.off("exit", stop));
  return { stop, exited: proc.exited };
}

export interface SuperviseOptions {
  start: () => PowermetricsHandle;
  /** Called with "running", "exited (code N), retrying in Ns", etc. */
  onStatus: (status: string) => void;
  /** Backoff between restarts; the last entry repeats. */
  delaysMs?: number[];
  /** A child that lived this long counts as healthy and resets the backoff. */
  healthyMs?: number;
}

/**
 * Keeps powermetrics running: when the child exits on its own, restart it with
 * backoff (2 s, 5 s, 15 s, then every 60 s). Restarts use `sudo -n`, so they
 * succeed only while sudo is cached or a NOPASSWD rule exists
 * (`perf-bros --sudoers`). Until then the bus falls back to degraded mode.
 */
export function supervise(opts: SuperviseOptions): { stop(): void } {
  const delays = opts.delaysMs ?? [2000, 5000, 15000, 60000];
  const healthyMs = opts.healthyMs ?? 30000;
  let stopped = false;
  let failures = 0;
  let current: PowermetricsHandle | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const launch = () => {
    if (stopped) return;
    const started = Date.now();
    const handle = (current = opts.start());
    handle.exited.then((code) => {
      if (stopped || handle !== current) return;
      if (Date.now() - started >= healthyMs) failures = 0;
      const delay = delays[Math.min(failures, delays.length - 1)]!;
      failures++;
      opts.onStatus(`exited (code ${code}), retrying in ${Math.round(delay / 1000)}s`);
      timer = setTimeout(launch, delay);
    });
  };
  launch();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      current?.stop();
    },
  };
}
