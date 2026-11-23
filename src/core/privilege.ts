/**
 * sudo handling (DESIGN.md §4.1). Only powermetrics runs privileged; the UI
 * never does. We validate sudo *before* the TUI takes over the terminal so the
 * password prompt is an ordinary terminal prompt.
 */

import { powermetricsArgs } from "../collectors/powermetrics.ts";

export const POWERMETRICS = "/usr/bin/powermetrics";

/** True if sudo works without a password right now (cached timestamp or a NOPASSWD ALL rule). */
export function sudoCached(): boolean {
  return Bun.spawnSync(["sudo", "-n", "-v"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

// sudoers treats these as special inside command arguments.
const escapeSudoers = (arg: string) => arg.replace(/[\\,:=]/g, (c) => `\\${c}`);
const unescapeSudoers = (s: string) => s.replace(/\\(.)/g, "$1");

/**
 * The sudoers rule that lets exactly our powermetrics command run without a
 * password. The arguments are pinned: powermetrics accepts `-o FILE`, so a
 * rule allowing any arguments would let anyone write files as root.
 */
export function sudoersLine(user: string, args = powermetricsArgs()): string {
  return `${user} ALL=(root) NOPASSWD: ${POWERMETRICS} ${args.map(escapeSudoers).join(" ")}`;
}

/**
 * Does `sudo -l` output grant passwordless root for our exact powermetrics
 * command? Accepts `ALL`, bare `/usr/bin/powermetrics` (any arguments) or the
 * pinned command line, under a runas list that includes root or ALL.
 */
export function nopasswdCovers(listing: string, args = powermetricsArgs()): boolean {
  const want = `${POWERMETRICS} ${args.join(" ")}`;
  for (const line of listing.split("\n")) {
    const m = /^\s*\(([^)]*)\)\s*(.*)$/.exec(line);
    if (!m || !/\b(root|ALL)\b/.test(m[1]!)) continue;
    const tagged = /(?:^|\s)NOPASSWD:\s*(?:[A-Z_]+:\s*)*(.*)$/.exec(m[2]!);
    if (!tagged) continue;
    // sudo -l may print our --samplers commas escaped or not, so match the full
    // command line against the unsplit text too, as a whole comma-list entry.
    const text = unescapeSudoers(tagged[1]!).replace(/\s+/g, " ").trim();
    const at = text.indexOf(want);
    if (at >= 0 && (at === 0 || text.slice(0, at).endsWith(", ")) && /^(,|$)/.test(text.slice(at + want.length))) return true;
    for (const raw of tagged[1]!.split(/(?<!\\),\s*/)) {
      const cmd = unescapeSudoers(raw.trim()).replace(/\s+/g, " ");
      if (cmd === "ALL" || cmd === POWERMETRICS || cmd === want) return true;
    }
  }
  return false;
}

/** True if a sudoers rule lets our powermetrics command run without a password. */
export function powermetricsNopasswd(): boolean {
  const r = Bun.spawnSync(["sudo", "-n", "-l"], { stdout: "pipe", stderr: "ignore" });
  return r.exitCode === 0 && nopasswdCovers(r.stdout.toString());
}

/**
 * Make sure `sudo -n powermetrics` will work. Prompts once if needed and the
 * terminal is interactive. Returns false if sudo is unavailable or declined.
 */
export function ensureSudo(opts: { interactive: boolean; log?: (msg: string) => void }): boolean {
  if (sudoCached() || powermetricsNopasswd()) return true;
  if (!opts.interactive) return false;
  opts.log?.("perf-bros needs sudo for powermetrics (CPU frequency, GPU, power, thermal, per-process energy).");
  opts.log?.("Only powermetrics runs as root. Press Ctrl-C at the prompt to continue without it.");
  opts.log?.("To skip this prompt for good, see `perf-bros --sudoers`.");
  const r = Bun.spawnSync(["sudo", "-v", "-p", "sudo password for %u: "], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return r.exitCode === 0;
}
