import { expect, test } from "bun:test";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import type { Snapshot } from "../src/core/snapshot.ts";
import { PixelCanvas, type Frame } from "../src/engine/canvas.ts";
import { drawDimmed } from "../src/engine/paint.ts";
import { P } from "../src/engine/palette.ts";
import { Game } from "../src/world/game.ts";
import { zoneLocked } from "../src/world/overworld.ts";

const degraded = await loadNdjsonReplay("fixtures/scenarios/degraded.ndjson");
const privileged = await loadNdjsonReplay("fixtures/scenarios/cpu-fire.ndjson");

const textOf = (f: Frame) => f.texts.map((r) => r.text).join("\n");

function settle(keys: string[], snap: Snapshot): { lo: Frame; hi: PixelCanvas } {
  const g = new Game();
  for (const k of keys) g.key(k);
  let lo = g.draw(snap, 0, 0);
  let hi = g.drawHi(snap, 0, 0);
  for (let i = 1; i <= 30; i++) {
    lo = g.draw(snap, i / 30, 1 / 30);
    hi = g.drawHi(snap, i / 30, 1 / 30);
  }
  return { lo, hi };
}

test("zoneLocked: only power, net and disk lock, and only when their reading is missing", () => {
  const d = degraded.at(3);
  const p = privileged.at(3);
  for (const id of ["power", "net", "disk"] as const) {
    expect(zoneLocked(id, d)).toBe(true);
    expect(zoneLocked(id, p)).toBe(false);
  }
  for (const id of ["cpu", "mem", "proc", "overworld"] as const) expect(zoneLocked(id, d)).toBe(false);
});

test("drawDimmed checkers only the pixels the draw changed", () => {
  const cv = new PixelCanvas(8, 8);
  cv.rect(0, 0, 8, 8, 0x111111);
  drawDimmed(cv, 0, 0, 8, 8, 0xabcdef, () => cv.rect(2, 2, 4, 4, 0xff0000));
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const inside = x >= 2 && x < 6 && y >= 2 && y < 6;
      const want = !inside ? 0x111111 : (x + y) & 1 ? 0xabcdef : 0xff0000;
      expect(cv.get(x, y)).toBe(want);
    }
  }
  // a box hanging off the canvas still draws and clips safely
  drawDimmed(cv, -4, -4, 6, 6, 0xabcdef, () => cv.set(0, 0, 0x00ff00));
  expect(cv.get(0, 0)).toBe(0x00ff00);
});

test("degraded overworld: NO SUDO tag, locked labels; privileged has neither", () => {
  const d = textOf(settle([], degraded.at(3)).lo);
  expect(d).toContain("NO SUDO");
  for (const l of ["PWR —", "NET —", "DISK —"]) expect(d).toContain(l);
  const p = textOf(settle([], privileged.at(3)).lo);
  expect(p).not.toContain("NO SUDO");
  expect(p).not.toContain("—");
});

test("CPU Fortress without frequency data says FREQ N/A instead of MHz", () => {
  const d = textOf(settle(["1"], degraded.at(3)).lo);
  expect(d).toContain("NO SUDO · FREQ N/A");
  expect(d).not.toContain("MHz");
  const p = textOf(settle(["1"], privileged.at(3)).lo);
  expect(p).toContain("MHz");
  expect(p).not.toContain("FREQ N/A");
});

test("locked zones show the NEEDS SUDO panel in both renderers", () => {
  for (const key of ["3", "4", "6"]) { // net, disk, power
    const { lo, hi } = settle([key], degraded.at(3));
    expect(textOf(lo)).toContain("NEEDS SUDO");
    expect(textOf(lo)).not.toContain("UNDER");
    expect(hi.get(100, 90)).toBe(P.hudBg); // inside the hi-res panel (x 77–242)
    const open = settle([key], privileged.at(3));
    expect(textOf(open.lo)).not.toContain("NEEDS SUDO");
    expect(open.hi.get(100, 90)).not.toBe(P.hudBg);
  }
});
