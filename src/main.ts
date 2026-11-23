#!/usr/bin/env bun
/**
 * perf-bros entry point. Installed as the `perf-bros` command by `bun link`.
 *
 *   perf-bros                             # same as bun start
 *   perf-bros --demo                      # replay the bundled M1 fixtures, from any directory
 *   perf-bros --sudoers                   # print a sudoers rule for passwordless powermetrics
 *   bun start                             # live: this Mac (asks for sudo for powermetrics)
 *   bun start -- --no-sudo                # live, degraded mode (no GPU/power/thermal/freqs)
 *   bun start -- --record s.ndjson        # live, and record merged snapshots
 *   bun run demo                          # replay the bundled M1 fixtures
 *   bun run src/main.ts --replay PATH     # replay a fixture dir or a recorded .ndjson
 *   bun run src/main.ts --renderer kitty  # force a renderer: auto | kitty | sixel | blocks
 *   bun run src/main.ts --scale 3         # fixed pre-scale for pixel-image renderers
 *   bun run src/main.ts --png OUTDIR      # render review stills instead of running
 *   bun run stills -- --scenarios        # render the synthetic scenario matrix
 *
 * Renderers:
 *   kitty / sixel  320×192 hi-res art drawn as a real pixel image
 *   blocks         80×46 art drawn with half-block characters (works everywhere)
 * "auto" picks kitty when the terminal supports the Kitty graphics protocol.
 */
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { mkdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startLive, type SnapshotSource } from "./core/live.ts";
import { ensureSudo, sudoersLine } from "./core/privilege.ts";
import { Recorder, loadNdjsonReplay } from "./core/recorder.ts";
import { loadFixtureReplay } from "./core/replay.ts";
import { ImagePresenter } from "./engine/present-image.ts";
import { PixelView } from "./engine/present-opentui.ts";
import { canvasToPng, frameToPng } from "./engine/png.ts";
import { Game } from "./world/game.ts";
import { ZONE_ORDER } from "./world/overworld.ts";

type Mode = "kitty" | "sixel" | "blocks";

const { values: args } = parseArgs({
  options: {
    replay: { type: "string" },
    record: { type: "string" },
    "no-sudo": { type: "boolean", default: false },
    png: { type: "string" },
    scenarios: { type: "boolean" },
    renderer: { type: "string", default: "auto" },
    scale: { type: "string" },
    demo: { type: "boolean", default: false },
    sudoers: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

// Bundled data resolves from the repo, not the cwd, so `perf-bros` works anywhere.
const ROOT = join(import.meta.dir, "..");
const FIXTURE = join(ROOT, "fixtures/raw/apple-m1_macos-27.0.1");

if (args.help) {
  console.log(`perf-bros: an Apple Silicon system monitor that plays like a platformer

  perf-bros                  live (asks for sudo once so powermetrics can run)
  perf-bros --no-sudo        live without GPU, power, thermal, network, disk, CPU frequency
  perf-bros --demo           replay the bundled recording (no sudo)
  perf-bros --replay PATH    replay a fixture dir or a recorded .ndjson
  perf-bros --record FILE    live, and record snapshots to FILE (.ndjson)
  perf-bros --renderer MODE  auto | kitty | sixel | blocks
  perf-bros --scale N        fixed pre-scale for kitty/sixel
  perf-bros --sudoers        print a sudoers rule so powermetrics needs no password

Keys: arrows/hjkl move · enter · esc back · 1-6 jump · r renderer · q quit`);
  process.exit(0);
}

if (args.sudoers) {
  console.log(`# Lets perf-bros start powermetrics without a password prompt.
# Only this exact command line is allowed (powermetrics can write files with -o,
# so never allow it with arbitrary arguments). Install it with a syntax check:
#
#   tmp=$(mktemp) && perf-bros --sudoers > "$tmp"
#   sudo visudo -cf "$tmp" && sudo install -m 0440 -o root -g wheel "$tmp" /etc/sudoers.d/perf-bros; rm -f "$tmp"
#
# (mktemp gives a private, unpredictable file; never stage this in a fixed /tmp path.)
#
# Remove it with: sudo rm /etc/sudoers.d/perf-bros
${sudoersLine(userInfo().username)}`);
  process.exit(0);
}
if (args.demo) args.replay ??= FIXTURE;

if (args.png) {
  if (args.scenarios) {
    if (args.replay) throw new Error("--scenarios uses the bundled replays and cannot be combined with --replay");
    const dir = join(ROOT, "fixtures/scenarios");
    const files = [...new Bun.Glob("*.ndjson").scanSync({ cwd: dir, onlyFiles: true })].sort();
    if (!files.length) throw new Error(`No scenarios found in ${dir}`);
    for (const file of files) {
      const replay = await loadNdjsonReplay(join(dir, file));
      // The generator places peak load at the middle sample.
      const t = Math.floor(replay.sampleCount / 2) + 0.5;
      const shots: StillShot[] = [
        { name: "overworld", keys: [], t },
        ...ZONE_ORDER.map((name, i) => ({ name, keys: [String(i + 1)], t })),
      ];
      await renderStills(join(args.png, "scenarios", file.slice(0, -".ndjson".length)), replay, shots, true);
    }
  } else {
    const shots: StillShot[] = [
      { name: "1-overworld-idle", keys: [], t: 2.5 },
      { name: "2-overworld-load", keys: [], t: 8.5 },
      { name: "3-cpu-idle", keys: ["return"], t: 2.5 },
      { name: "4-cpu-load", keys: ["return"], t: 8.5 },
      { name: "5-memory", keys: ["right", "return"], t: 2.5 },
      { name: "6-placeholder", keys: ["6"], t: 2.5 },
      { name: "7-process", keys: ["5"], t: 8.5 },
      { name: "8-network", keys: ["3"], t: 8.5 },
    ];
    await renderStills(args.png, await openReplay(args.replay ?? FIXTURE), shots);
  }
  process.exit(0);
}
if (args.scenarios) throw new Error("--scenarios requires --png (or use bun run stills -- --scenarios)");

function openReplay(path: string): Promise<SnapshotSource> {
  return path.endsWith(".ndjson") ? loadNdjsonReplay(path) : loadFixtureReplay(path);
}

async function openSource(): Promise<SnapshotSource> {
  if (args.replay) return openReplay(args.replay);
  // Validate sudo before the TUI owns the terminal, so the prompt is a normal one.
  const privileged = !args["no-sudo"] && ensureSudo({ interactive: !!process.stdin.isTTY, log: (m) => console.error(m) });
  if (!privileged) console.error("Continuing without sudo: GPU, power, thermal and CPU frequencies will be unavailable.");
  return startLive({ privileged });
}

const source = await openSource();
const recorder = args.record ? new Recorder(args.record, source) : undefined;

/** Environment hints for terminals known to speak the Kitty graphics protocol. */
function envSaysKitty(): boolean {
  const e = process.env;
  return e.TERM === "xterm-kitty" || !!e.KITTY_WINDOW_ID || e.TERM_PROGRAM === "ghostty" || !!e.GHOSTTY_RESOURCES_DIR ||
    e.TERM_PROGRAM === "WezTerm";
}

function detectMode(r: CliRenderer): Mode | undefined {
  const caps = r.capabilities;
  if (caps?.kitty_graphics) return "kitty";
  if (caps?.sixel) return "sixel";
  return undefined;
}

const game = new Game();
// Adaptive frame rate (DESIGN.md §9.1, ROADMAP R9): full speed only while the
// player walks or a transition runs; ambient animation is fine at IDLE_FPS.
const ACTIVE_FPS = 30;
// OpenTUI alone costs ~1% + 0.26% per fps; ~5 fps keeps ambient motion readable.
const IDLE_FPS = 5;
let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  recorder?.stop();
  source.stop();
  image?.dispose();
}
// Every exit path (q, Ctrl-C, signals) ends up in renderer.destroy() → onDestroy.
// OpenTUI restores the terminal asynchronously; its docs ask to await
// `renderer.closed` before process.exit().
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: ACTIVE_FPS,
  // Pixel art compresses extremely well: zlib (Kitty o=z) cut a pre-scaled
  // frame from ~1 MB of base64 RGB to a few KB. PB_KITTY_TRANSPORT overrides it for measuring.
  kittyImageTransport: (process.env.PB_KITTY_TRANSPORT as "raw" | "zlib" | "file" | undefined) ?? "zlib",
  onDestroy: () => {
    cleanup();
    void renderer.closed.finally(() => process.exit(0));
  },
});
const blocks = new PixelView(renderer);
const image = new ImagePresenter(renderer, { scale: args.scale ? Number(args.scale) : undefined });
renderer.root.add(blocks);
renderer.root.add(image.view);

let mode: Mode = args.renderer === "auto" ? (envSaysKitty() ? "kitty" : "blocks") : (args.renderer as Mode);
const decided = args.renderer !== "auto" || mode === "kitty";
function applyMode(m: Mode): void {
  mode = m;
  blocks.visible = m === "blocks";
  image.view.visible = m !== "blocks";
  if (m !== "blocks") image.view.protocol = m;
}
applyMode(mode);

const t0 = performance.now();
let last = t0;
renderer.setFrameCallback(async () => {
  const now = performance.now();
  const t = (now - t0) / 1000;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // "auto": upgrade from blocks once the terminal answers capability queries (first ~2 s)
  if (!decided && mode === "blocks" && t < 2) {
    const m = detectMode(renderer);
    if (m) applyMode(m);
  }
  const snap = source.at(t);
  if (mode === "blocks") blocks.frame = game.draw(snap, t, dt);
  else image.present(game.drawHi(snap, t, dt));
  const fps = game.busy() ? ACTIVE_FPS : IDLE_FPS;
  if (renderer.targetFps !== fps) renderer.targetFps = fps;
});

renderer.keyInput.on("keypress", (key) => {
  renderer.targetFps = ACTIVE_FPS; // respond at full speed; the frame callback drops it again when idle
  if (game.key(key.name) === "quit") renderer.destroy();
  // r: cycle renderer (handy for comparing)
  if (key.name === "r") applyMode(mode === "blocks" ? "kitty" : "blocks");
});

renderer.start();

// ---------------------------------------------------------------- stills

type StillShot = { name: string; keys: string[]; t: number };

async function renderStills(outDir: string, source: SnapshotSource, shots: StillShot[], replayTimeline = false): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const shot of shots) {
    // Scenario stills follow the replay through the ramp so smoothing and scene
    // history reflect the actual samples. The original stills settle on one sample.
    const start = replayTimeline ? 0 : shot.t - 2;
    const final = source.at(shot.t);
    const initial = replayTimeline ? source.at(start) : final;
    const lo = new Game();
    const hi = new Game();
    for (const k of shot.keys) {
      lo.key(k);
      hi.key(k);
    }
    let f = lo.draw(initial, start, 0);
    let cv = hi.drawHi(initial, start, 0);
    const frames = Math.round((shot.t - start) * 30);
    for (let i = 1; i <= frames; i++) {
      const t = start + i / 30;
      const snap = replayTimeline ? source.at(t) : final;
      f = lo.draw(snap, t, 1 / 30);
      cv = hi.drawHi(snap, t, 1 / 30);
    }
    const path = join(outDir, `${shot.name}.png`);
    const hiPath = join(outDir, `${shot.name}-hires.png`);
    await Bun.write(path, frameToPng(f));
    await Bun.write(hiPath, canvasToPng(cv, 2));
    console.log(path, hiPath);
  }
}
