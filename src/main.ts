/**
 * perf-bros entry point.
 *
 *   bun start                             # live: this Mac (asks for sudo for powermetrics)
 *   bun start -- --no-sudo                # live, degraded mode (no GPU/power/thermal/freqs)
 *   bun start -- --record s.ndjson        # live, and record merged snapshots
 *   bun run demo                          # replay the bundled M1 fixtures
 *   bun run src/main.ts --replay PATH     # replay a fixture dir or a recorded .ndjson
 *   bun run src/main.ts --renderer kitty  # force a renderer: auto | kitty | sixel | blocks
 *   bun run src/main.ts --scale 3         # fixed pre-scale for pixel-image renderers
 *   bun run src/main.ts --png OUTDIR      # render review stills instead of running
 *
 * Renderers:
 *   kitty / sixel  320×192 hi-res art drawn as a real pixel image
 *   blocks         80×46 art drawn with half-block characters (works everywhere)
 * "auto" picks kitty when the terminal supports the Kitty graphics protocol.
 */
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startLive, type SnapshotSource } from "./core/live.ts";
import { ensureSudo } from "./core/privilege.ts";
import { Recorder, loadNdjsonReplay } from "./core/recorder.ts";
import { loadFixtureReplay } from "./core/replay.ts";
import { ImagePresenter } from "./engine/present-image.ts";
import { PixelView } from "./engine/present-opentui.ts";
import { canvasToPng, frameToPng } from "./engine/png.ts";
import { Game } from "./world/game.ts";

type Mode = "kitty" | "sixel" | "blocks";

const { values: args } = parseArgs({
  options: {
    replay: { type: "string" },
    record: { type: "string" },
    "no-sudo": { type: "boolean", default: false },
    png: { type: "string" },
    renderer: { type: "string", default: "auto" },
    scale: { type: "string" },
  },
});

const FIXTURE = "fixtures/raw/apple-m1_macos-27.0.1";

if (args.png) {
  await renderStills(args.png, await loadFixtureReplay(args.replay ?? FIXTURE));
  process.exit(0);
}

async function openSource(): Promise<SnapshotSource> {
  if (args.replay) {
    return args.replay.endsWith(".ndjson") ? loadNdjsonReplay(args.replay) : loadFixtureReplay(args.replay);
  }
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
let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  recorder?.stop();
  source.stop();
  image?.dispose();
}
// Every exit path (q, Ctrl-C, signals) ends up in renderer.destroy() → onDestroy.
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
  onDestroy: () => {
    cleanup();
    process.exit(0);
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
});

renderer.keyInput.on("keypress", (key) => {
  if (game.key(key.name) === "quit") renderer.destroy();
  // r: cycle renderer (handy for comparing)
  if (key.name === "r") applyMode(mode === "blocks" ? "kitty" : "blocks");
});

renderer.start();

// ---------------------------------------------------------------- stills

async function renderStills(outDir: string, source: SnapshotSource): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const shots: { name: string; keys: string[]; t: number }[] = [
    { name: "1-overworld-idle", keys: [], t: 2.5 },
    { name: "2-overworld-load", keys: [], t: 8.5 },
    { name: "3-cpu-idle", keys: ["return"], t: 2.5 },
    { name: "4-cpu-load", keys: ["return"], t: 8.5 },
    { name: "5-memory", keys: ["right", "return"], t: 2.5 },
    { name: "6-placeholder", keys: ["6"], t: 2.5 },
  ];
  for (const shot of shots) {
    // run a few frames so the player settles and the iris finishes
    const lo = new Game();
    for (const k of shot.keys) lo.key(k);
    let f = lo.draw(source.at(shot.t), shot.t - 2, 0);
    for (let i = 1; i <= 60; i++) f = lo.draw(source.at(shot.t), shot.t - 2 + i / 30, 1 / 30);
    const path = join(outDir, `${shot.name}.png`);
    await Bun.write(path, frameToPng(f));

    const hi = new Game();
    for (const k of shot.keys) hi.key(k);
    let cv = hi.drawHi(source.at(shot.t), shot.t - 2, 0);
    for (let i = 1; i <= 60; i++) cv = hi.drawHi(source.at(shot.t), shot.t - 2 + i / 30, 1 / 30);
    const hiPath = join(outDir, `${shot.name}-hires.png`);
    await Bun.write(hiPath, canvasToPng(cv, 2));
    console.log(path, hiPath);
  }
}
