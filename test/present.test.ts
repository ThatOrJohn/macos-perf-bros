import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import { loadFixtureReplay } from "../src/core/replay.ts";
import type { Snapshot } from "../src/core/snapshot.ts";
import { P } from "../src/engine/palette.ts";
import { X } from "../src/hires/common.ts";
import { HELP_KEYS, HELP_METAPHOR } from "../src/ui/help.ts";
import { PixelView } from "../src/engine/present-opentui.ts";
import { fmtRate } from "../src/world/common.ts";
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
  // The brand is the first field to drop when the HUD row is full.
  expect(lines[0]).toMatch(/^(?: PERF·BROS │ )?CPU /);
  expect(lines[0]).toContain("GPU");
  expect(lines[5]).toContain("▀");
  expect(lines[23]).toContain("CPU FORTRESS");
});

test("every zone renders without throwing", async () => {
  for (const k of ["1", "2", "3", "4", "5", "6"]) {
    const lines = await render(80, 24, [k]);
    expect(lines[0]).toMatch(/CPU +\d+%/);
  }
});

test("scales 2× and centers in a large terminal", async () => {
  const lines = await render(170, 50, ["1"]);
  const hudRow = lines.findIndex((l) => /CPU +\d+%/.test(l));
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

test("incremental half-block updates match a full redraw, across scene changes and resizes", async () => {
  const game = new Game();
  const capture = async (frames: (() => import("../src/engine/canvas.ts").Frame)[], size: [number, number]) => {
    const { renderer, renderOnce, captureSpans, resize } = await createTestRenderer({ width: size[0], height: size[1] });
    const view = new PixelView(renderer);
    renderer.root.add(view);
    for (const next of frames) {
      view.frame = next();
      await renderOnce();
    }
    return { spans: JSON.stringify(captureSpans()), renderer, view, renderOnce, captureSpans, resize };
  };
  // A: many frames with walking, a zone change and back, then the final frame.
  const steps: (() => import("../src/engine/canvas.ts").Frame)[] = [];
  for (let i = 0; i < 40; i++) {
    steps.push(() => {
      if (i === 10) game.key("right");
      if (i === 20) game.key("1");
      if (i === 30) game.key("escape");
      return game.draw(source.at(2 + i / 10), 2 + i / 30, 1 / 30);
    });
  }
  const a = await capture(steps, [80, 24]);
  // B: a fresh view that only ever sees the last frame.
  const last = (a.view as PixelView).frame;
  const b = await capture([() => last], [80, 24]);
  expect(a.spans).toBe(b.spans);

  // A again after a resize to 2× scale: the offscreen buffer is rebuilt in full.
  a.resize(170, 50);
  await a.renderOnce();
  const c = await capture([() => last], [170, 50]);
  expect(JSON.stringify(a.captureSpans())).toBe(c.spans);
  a.renderer.destroy();
  b.renderer.destroy();
  c.renderer.destroy();
});

test("Network Sky renders traffic, idle, degraded and empty process snapshots in both renderers", async () => {
  const [burst, idle, degraded] = await Promise.all(
    ["net-burst", "idle", "degraded"].map(async (name) => (await loadNdjsonReplay(`${scenarioDir}/${name}.ndjson`)).at(10)),
  );
  const empty: Snapshot = { ...idle!, procs: [] };
  const fixtures = [
    { snap: burst!, label: "PKT/S", clouds: true },
    { snap: idle!, label: "NO TRAFFIC", clouds: false },
    { snap: degraded!, label: "NEEDS SUDO", clouds: false },
    { snap: empty, label: "NO TRAFFIC", clouds: false },
  ];
  for (const { snap, label, clouds } of fixtures) {
    const game = new Game();
    game.key("3");
    const frame = game.draw(snap, 1, 0.3);
    const canvas = game.drawHi(snap, 1, 0.3);
    expect(frame.texts.some(({ text }) => text === "NETWORK SKY")).toBe(true);
    expect(frame.texts.some(({ text }) => text === label)).toBe(true);
    expect(frame.canvas.px.includes(P.cloud)).toBe(clouds);
    expect(canvas.px.includes(P.cloud)).toBe(clouds);
  }
});

test("Disk Mines shows carts, rates and miners under load, and handles idle and missing disk data", async () => {
  const [thrash, idle, degraded] = await Promise.all(
    ["disk-thrash", "idle", "degraded"].map(async (name) => (await loadNdjsonReplay(`${scenarioDir}/${name}.ndjson`)).at(10)),
  );
  const cases = [
    { snap: thrash!, label: "17000 OPS/S", miner: "mdworker_shared", carts: true },
    { snap: { ...thrash!, procs: [] }, label: "NO PROCESS I/O", carts: true },
    { snap: idle!, label: "READ ↑ 0B/s", carts: false },
    { snap: degraded!, label: "NEEDS SUDO", carts: false },
  ];
  for (const { snap, label, miner, carts } of cases) {
    const game = new Game();
    game.key("4");
    expect(game.scene).toBe("disk");
    const frame = game.draw(snap, 1, 0.3);
    const hi = game.drawHi(snap, 1, 0.3);
    expect(frame.texts.some(({ row, text }) => row === 1 && text === "DISK MINES")).toBe(true);
    expect(frame.texts.some(({ text }) => text.includes(label))).toBe(true);
    expect(frame.canvas.px.includes(P.waterHi)).toBe(carts);
    expect(hi.px.includes(X.gem2)).toBe(carts);
    expect(frame.canvas.px.includes(P.bodyTeal)).toBe(Boolean(miner));
    expect(hi.px.includes(P.bodyTeal)).toBe(Boolean(miner));
    if (miner) expect(frame.texts.some(({ row, text }) => row === 21 && text === miner)).toBe(true);
  }
});

test("Power Plant shows the GPU foundry, thermal overflow and partial or missing readings", async () => {
  const [busy, idle, degraded] = await Promise.all(
    ["gpu-busy", "idle", "degraded"].map(async (name) => (await loadNdjsonReplay(`${scenarioDir}/${name}.ndjson`)).at(10)),
  );
  const fixtures = [
    { snap: busy!, labels: ["14.8 W", "BUSY 95%"], gpuFill: true, spilled: false },
    { snap: idle!, labels: ["THERMAL NOMINAL"], gpuFill: false, spilled: false },
    { snap: { ...busy!, thermal: "critical" as const }, labels: ["⚠ THROTTLING"], gpuFill: true, spilled: true },
    { snap: { ...busy!, gpu: undefined, thermal: undefined }, labels: ["BUSY N/A", "THERMAL N/A"], gpuFill: false, spilled: false },
    { snap: degraded!, labels: ["NEEDS SUDO"], gpuFill: false, spilled: false },
  ];
  for (const { snap, labels, gpuFill, spilled } of fixtures) {
    const game = new Game();
    game.key("6");
    expect(game.scene).toBe("power");
    const frame = game.draw(snap, 1, 0.3);
    const hi = game.drawHi(snap, 1, 0.3);
    expect(frame.texts.some(({ row, text }) => row === 1 && text === "POWER PLANT")).toBe(true);
    for (const label of labels) expect(frame.texts.some(({ text }) => text.includes(label))).toBe(true);
    expect(frame.canvas.get(73, 21) === P.eBrick).toBe(gpuFill);
    expect(hi.get(282, 84) === P.eBrick).toBe(gpuFill);
    expect(frame.canvas.get(2, 37) === P.lava).toBe(spilled);
    expect(hi.get(10, 164) === P.lava).toBe(spilled);
  }
});

test("b toggles tables and restores art in every scene, with complete or empty snapshots", () => {
  const loaded = source.at(8);
  const empty: Snapshot = { t: loaded.t, privileged: false, topology: loaded.topology, procs: [], uptimeS: 0 };
  const metrics = ["CPU FORTRESS", "CPU BUSY", "USED", "RX BYTES/S", "READ BYTES/S", "TOP PROCESSES", "PACKAGE POWER"];
  for (const [i, metric] of metrics.entries()) {
    for (const snap of [loaded, empty]) {
      const game = new Game();
      if (i) game.key(String(i));
      const art = game.drawHi(snap, 1, 0).get(6, 25);
      game.key("b");
      const table = game.draw(snap, 1, 0);
      expect(table.texts.some(({ row, text }) => row === 3 && text === "METRIC")).toBe(true);
      if (snap === loaded) expect(table.texts.some(({ text }) => text.includes(metric))).toBe(true);
      const values = table.texts.filter(({ row, col }) => row >= 5 && row <= 19 && col > 7);
      expect(values.length).toBeGreaterThan(0);
      expect(values.every(({ text, col }) => col + text.length === 73)).toBe(true);
      expect(game.drawHi(snap, 1, 0).get(6, 25)).toBe(P.stoneDark); // table panel bevel
      game.key("b");
      expect(game.draw(snap, 1, 0).texts.some(({ text }) => text === "METRIC")).toBe(false);
      expect(game.drawHi(snap, 1, 0).get(6, 25)).toBe(art);
    }
  }
});

test("table navigation keeps the selected zone and reaches the last CPU core", () => {
  const snap = source.at(8);
  const game = new Game();
  game.key("b");
  game.key("right");
  expect(game.draw(snap, 1, 0).texts.some(({ text }) => text === "> 2 MEMORY RESERVOIR")).toBe(true);
  game.key("enter");
  expect(game.scene).toBe("mem");
  expect(game.draw(snap, 2, 0).texts.some(({ text }) => text === "USED")).toBe(true);
  game.key("escape");
  expect(game.scene).toBe("overworld");
  game.key("1");
  expect(game.scene).toBe("cpu");

  const cpu = snap.cpu!;
  const big: Snapshot = {
    ...snap,
    cpu: { ...cpu, cores: Array.from({ length: 36 }, (_, id) => ({ ...cpu.cores[0]!, id, kind: "P" })) },
  };
  const first = game.drawHi(big, 3, 0).px.slice();
  expect(game.draw(big, 3, 0).texts.some(({ text }) => text === "PAGE 1 / 3")).toBe(true);
  game.key("pagedown");
  game.key("pagedown");
  game.key("pagedown");
  const end = game.draw(big, 4, 0).texts;
  expect(end.some(({ text }) => text === "PAGE 3 / 3")).toBe(true);
  expect(end.some(({ text }) => text === "CORE P35 BUSY")).toBe(true);
  expect(game.drawHi(big, 4, 0).px).not.toEqual(first);
  game.key("pageup");
  expect(game.draw(big, 5, 0).texts.some(({ text }) => text === "PAGE 2 / 3")).toBe(true);
  expect(game.draw(snap, 6, 0).texts.some(({ text }) => text.startsWith("PAGE"))).toBe(false);
});

test("Network Sky table keeps measured history and skips unmeasured seconds", () => {
  const snap = source.at(8);
  const game = new Game();
  game.draw({ ...snap, t: 1_000 }, 1, 0);
  game.key("3");
  game.key("b");
  const table = game.draw({ ...snap, t: 3_000 }, 3, 0).texts.map(({ text }) => text);
  expect(table).toContain("LAST 60 S");
  expect(table).toContain("0 S AGO");
  expect(table).toContain("2 S AGO");
  expect(table).not.toContain("1 S AGO");
});

test("help shows the controls and each scene's metaphor in art and table views", () => {
  const loaded = source.at(8);
  const empty: Snapshot = { t: loaded.t, privileged: false, topology: loaded.topology, procs: [], uptimeS: 0 };
  for (const [i, scene] of (["overworld", ...ZONE_ORDER] as const).entries()) {
    for (const table of [false, true]) {
      const game = new Game();
      if (i) game.key(String(i));
      if (table) game.key("b");
      game.key("?");
      const snap = table ? empty : loaded;
      const texts = game.draw(snap, 1, 0).texts.map(({ text }) => text);
      expect(texts).toContain("HELP");
      expect(texts).toContain(HELP_METAPHOR[scene]);
      for (const [key, action] of HELP_KEYS) {
        expect(texts).toContain(key);
        expect(texts).toContain(action);
      }
      expect(game.drawHi(snap, 1, 0).get(18, 31)).toBe(P.stoneLight);
      game.key(i === 6 ? "1" : "6");
      expect(game.scene).toBe(scene);
      game.key("escape");
      expect(game.scene).toBe(scene);
      expect(game.draw(snap, 1, 0).texts.some(({ text }) => text === "HELP")).toBe(false);
      game.key("?");
      game.key("?");
      expect(game.draw(snap, 1, 0).texts.some(({ text }) => text === "HELP")).toBe(false);
    }
  }
});

test("pause preserves the displayed snapshot while animation and navigation continue", () => {
  const idle = source.at(2);
  const load = source.at(8);
  const game = new Game();
  game.key("6");
  game.draw(idle, 1, 0);
  game.key("p");
  const low = game.draw(load, 1.2, 0.2);
  expect(low.texts.some(({ row, text }) => row === 0 && text === "PAUSED")).toBe(true);
  expect(low.texts.some(({ row, text }) => row === 5 && text === `${idle.power!.packageW.toFixed(1)} W`)).toBe(true);
  const first = game.drawHi(load, 1.2, 0.2).px.slice();
  const later = game.drawHi(load, 1.4, 0.2).px.slice();
  expect(later.slice(0, 320 * 11)).toEqual(first.slice(0, 320 * 11));
  expect(later.slice(320 * 11)).not.toEqual(first.slice(320 * 11));

  game.key("b");
  expect(game.draw(load, 1.5, 0).texts.some(({ text }) => text === "PAUSED")).toBe(true);
  game.key("4");
  expect(game.scene).toBe("disk");
  const readRate = (snap: Snapshot) => fmtRate(snap.disk!.readBps);
  const tableValue = (snap: Snapshot) => game.draw(snap, 2, 0).texts.find(({ row, col }) => row === 5 && col > 7)?.text;
  expect(tableValue(load)).toBe(readRate(idle));
  game.key("p");
  expect(tableValue(load)).toBe(readRate(load));
  expect(game.draw(load, 2, 0).texts.some(({ text }) => text === "PAUSED")).toBe(false);
});

test("paused Network Sky keeps its chart and resumes with history collected during the pause", () => {
  const snap = source.at(8);
  const game = new Game();
  game.key("3");
  const before = game.draw(snap, 1, 0).canvas.px.slice(80 * 36, 80 * 44);
  game.key("p");
  const sample = (seconds: number): Snapshot => ({ ...snap, t: snap.t + seconds * 1000 });
  for (let sec = 1; sec <= 61; sec++) game.draw(sample(sec), sec + 1, 0.1);
  expect(game.draw(sample(62), 63, 0.1).canvas.px.slice(80 * 36, 80 * 44)).toEqual(before);
  game.key("b");
  const labels = (seconds: number) => game.draw(sample(seconds), seconds + 1, 0).texts.map(({ text }) => text);
  expect(labels(62)).toContain("0 S AGO");
  expect(labels(62)).not.toContain("1 S AGO");
  game.key("p");
  expect(labels(63)).toContain("1 S AGO");
});

test("the Kitty presenter keeps publishing past the image pool's capacity", async () => {
  // Regression: publishRgba's handle was never released, so after 3 frames
  // every publish returned null and the hi-res picture froze.
  const { ImagePresenter } = await import("../src/engine/present-image.ts");
  const { PixelCanvas } = await import("../src/engine/canvas.ts");
  const { renderer, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
  const img = new ImagePresenter(renderer, { scale: 1 });
  renderer.root.add(img.view);
  const cv = new PixelCanvas(320, 192);
  for (let i = 0; i < 12; i++) {
    cv.px.fill(0x101010 * (i + 1)); // a different frame each time
    img.present(cv);
    await renderOnce();
  }
  // The view must hold the 12th frame's pixels, not a stale 3rd one.
  await img.view.loadPromise;
  const shown = img.view.image!;
  const px = new Uint8Array(shown.width * shown.height * 4);
  shown.copyTo(px);
  const last = 0x101010 * 12;
  expect([px[0], px[1], px[2]]).toEqual([(last >> 16) & 255, (last >> 8) & 255, last & 255]);
  img.present(cv); // identical frame: skipped, not dropped
  expect(img.dropped ?? 0).toBe(0);
  img.dispose();
  renderer.destroy();
});
