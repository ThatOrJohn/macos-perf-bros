/**
 * sudo handling (DESIGN.md §4.1). Only powermetrics runs privileged; the UI
 * never does. We validate sudo *before* the TUI takes over the terminal so the
 * password prompt is an ordinary terminal prompt.
 */

/** True if sudo works without a password right now (cached timestamp or NOPASSWD rule). */
export function sudoCached(): boolean {
  return Bun.spawnSync(["sudo", "-n", "-v"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

/**
 * Make sure `sudo -n powermetrics` will work. Prompts once if needed and the
 * terminal is interactive. Returns false if sudo is unavailable or declined.
 */
export function ensureSudo(opts: { interactive: boolean; log?: (msg: string) => void }): boolean {
  if (sudoCached()) return true;
  if (!opts.interactive) return false;
  opts.log?.("perf-bros needs sudo for powermetrics (CPU frequency, GPU, power, thermal, per-process energy).");
  opts.log?.("Only powermetrics runs as root. Press Ctrl-C at the prompt to continue without it.");
  const r = Bun.spawnSync(["sudo", "-v", "-p", "sudo password for %u: "], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return r.exitCode === 0;
}
