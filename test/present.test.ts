import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import { loadFixtureReplay } from "../src/core/replay.ts";
import type { Snapshot } from "../src/core/snapshot.ts";
import { P } from "../src/engine/palette.ts";
import { PixelView } from "../src/engine/present-opentui.ts";
import { Game } from "../src/world/game.ts";
import { ZONE_ORDER } from "../src/world/overworld.ts";

const source = await loadFixtureReplay("fixtures/raw/apple-m1_macos-27.0.1");

async function render(cols: number, rows: number, keys: string[]) {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: cols, height: rows });
  const view = new PixelView(renderer);
  renderer.root.add(view);
  const game = new Game();
  for (const k of keys) game.key(k);
  for (let i = 0; i < 20; i++) view.frame = game.draw(source.at(3), 3 + i / 30, 1 / 30);
  await renderOnce();
  const frame = captureCharFrame();
  renderer.destroy();
  return frame.split("\n");
}

test("overworld renders HUD, half-block pixels and hint line at 80×24", async () => {
  const lines = await render(80, 24, []);
  expect(lines[0]).toContain("PERF·BROS");
  expect(lines[0]).toContain("CPU");
  expect(lines[5]).toContain("▀");
  expect(lines[23]).toContain("CPU FORTRESS");
});

test("every zone renders without throwing", async () => {
  for (const k of ["1", "2", "3", "4", "5", "6"]) {
    const lines = await render(80, 24, [k]);
    expect(lines[0]).toContain("PERF·BROS");
  }
});

test("scales 2× and centers in a large terminal", async () => {
  const lines = await render(170, 50, ["1"]);
  const hudRow = lines.findIndex((l) => l.includes("PERF·BROS"));
  expect(hudRow).toBe(1); // (50 - 48) / 2
  expect(lines.some((l) => l.includes("CPU FORTRESS"))).toBe(true);
});

test("too-small terminal shows a resize message", async () => {
  const lines = await render(60, 20, []);
  expect(lines.join("\n")).toContain("at least 80×24");
});

test("hi-res frames render every scene and publish through the image presenter", async () => {
  const { ImagePresenter } = await import("../src/engine/present-image.ts");
  const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
  const img = new ImagePresenter(renderer, { scale: 2 });
  renderer.root.add(img.view);
  for (const k of ["", "1", "2", "3", "4", "5", "6"]) {
    const game = new Game();
    if (k) game.key(k);
    let cv = game.drawHi(source.at(3), 3, 0);
    for (let i = 1; i < 12; i++) cv = game.drawHi(source.at(3), 3 + i / 30, 1 / 30);
    expect(cv.w).toBe(320);
    expect(cv.h).toBe(192);
    img.present(cv);
    await renderOnce();
    expect(img.view.source).toBeDefined();
    expect(img.currentScale).toBe(2);
  }
  img.dispose();
  renderer.destroy();
});

const scenarioDir = "fixtures/scenarios";

test("Process Plains renders the ranked boss and handles missing RSS and empty process data", async () => {
  const replay = await loadNdjsonReplay(`${scenarioDir}/cpu-fire.ndjson`);
  const degraded = await loadNdjsonReplay(`${scenarioDir}/degraded.ndjson`);
  const empty: Snapshot = { ...degraded.at(0), procs: [] };
  const unknownRss: Snapshot = { ...degraded.at(0), procs: [{ ...degraded.at(0).procs[0]!, rssB: undefined }] };
  const low = new Game();
  const high = new Game();
  low.key("5");
  high.key("5");
  const frames = (snap: Snapshot, t: number) => [low.draw(snap, t, 0.4), high.drawHi(snap, t, 0.4)] as const;

  const [loaded, loadedHi] = frames(replay.at(10), 1);
  expect(loaded.texts.some(({ text, row }) => row === 1 && text === "PROCESS PLAINS")).toBe(true);
  expect(loaded.texts.some(({ text, row }) => row === 4 && text === "265%")).toBe(true);
  expect(loaded.texts.filter(({ row, text }) => row >= 4 && row <= 8 && text === "■")).toHaveLength(5);
  expect(loaded.canvas.px.includes(P.lava)).toBe(true);
  expect(loadedHi.px.includes(P.lava)).toBe(true);

  const [partial, partialHi] = frames(unknownRss, 2);
  expect(partial.texts.some(({ row, text }) => row === 4 && text === "-")).toBe(true);
  expect(partialHi.px.includes(P.lava)).toBe(false);
  const [vacant, vacantHi] = frames(empty, 3);
  expect(vacant.texts.some(({ text }) => text === "NO PROCESSES")).toBe(true);
  expect(vacantHi.px.includes(P.lava)).toBe(false);
});

for (const file of [...new Bun.Glob("*.ndjson").scanSync({ cwd: scenarioDir, onlyFiles: true })].sort()) {
  test(`${file} renders every sample in every scene in both renderers`, async () => {
    const replay = await loadNdjsonReplay(`${scenarioDir}/${file}`);
    const scenes = ["overworld", ...ZONE_ORDER] as const;
    for (const [i, scene] of scenes.entries()) {
      const lo = new Game();
      const hi = new Game();
      if (i > 0) {
        lo.key(String(i));
        hi.key(String(i));
      }
      expect(lo.scene).toBe(scene);
      expect(hi.scene).toBe(scene);
      for (let t = 0; t < replay.sampleCount; t++) {
        const snap = replay.at(t);
        const frame = lo.draw(snap, t, 1 / 30);
        const canvas = hi.drawHi(snap, t, 1 / 30);
        expect([frame.canvas.w, frame.canvas.h]).toEqual([80, 46]);
        expect([canvas.w, canvas.h]).toEqual([320, 192]);
      }
    }
  });
}
