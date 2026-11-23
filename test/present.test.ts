import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { loadFixtureReplay } from "../src/core/replay.ts";
import { PixelView } from "../src/engine/present-opentui.ts";
import { Game } from "../src/world/game.ts";

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
