/**
 * Per-scene draw cost for both renderers, driven by fixture replay.
 * Usage: bun run bench:render
 * Budget (AGENTS.md): hi-res ≤ ~2 ms/frame, low-res ≤ ~0.5 ms/frame.
 */
import { loadFixtureReplay } from "../src/core/replay.ts";
import { ZONE_ORDER } from "../src/world/overworld.ts";
import { Game } from "../src/world/game.ts";

const src = await loadFixtureReplay("fixtures/raw/apple-m1_macos-27.0.1");
const N = 120;
const scenes: [string, string][] = [["overworld", ""], ...ZONE_ORDER.map((z, i) => [z, String(i + 1)] as [string, string])];

let over = false;
for (const [name, key] of scenes) {
  const g = new Game();
  if (key) g.key(key);
  for (let i = 0; i < 30; i++) g.drawHi(src.at(8), 8 + i / 30, 1 / 30); // warm up, finish iris
  const t0 = performance.now();
  for (let i = 0; i < N; i++) g.drawHi(src.at(8), 9 + i / 30, 1 / 30);
  const t1 = performance.now();
  for (let i = 0; i < N; i++) g.draw(src.at(8), 13 + i / 30, 1 / 30);
  const hi = (t1 - t0) / N;
  const lo = (performance.now() - t1) / N;
  const flag = hi > 2 || lo > 0.5 ? "  ⚠ over budget" : "";
  if (flag) over = true;
  console.log(`${name.padEnd(10)} hi ${hi.toFixed(2).padStart(5)} ms   lo ${lo.toFixed(2).padStart(5)} ms${flag}`);
}
process.exit(over ? 1 : 0);
