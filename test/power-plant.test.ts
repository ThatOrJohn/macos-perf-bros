import { expect, test } from "bun:test";
import { loadNdjsonReplay } from "../src/core/recorder.ts";
import { P } from "../src/engine/palette.ts";
import { Smoother } from "../src/engine/tween.ts";
import { PowerPlant, gpuLabels, packageColor } from "../src/world/power-plant.ts";

const snap = (await loadNdjsonReplay("fixtures/scenarios/gpu-busy.ndjson")).at(10);

test("package colors change at 10 W and 20 W", () => {
  expect([9.99, 10, 19.99, 20].map(packageColor)).toEqual([P.ok, P.warn, P.warn, P.crit]);
});

test("turbines integrate watts through idle frame intervals and cap at 20 W", () => {
  const plant = new PowerPlant();
  const power = { cpuW: 0, gpuW: 10, aneW: 30, packageW: 40 };
  const sm = new Smoother();
  plant.update(power, { snap, sm, t: 1, dt: 0 });
  plant.update(power, { snap, sm, t: 1.2, dt: 0.1 });
  expect(plant.turbine[0]).toBe(0);
  expect(plant.turbine[1]).toBeCloseTo(0.13);
  expect(plant.turbine[2]).toBeCloseTo(0.26);
});

test("an unknown maximum leaves the GPU gauge empty and preserves the measured clock", () => {
  const plant = new PowerPlant();
  const gpu = { activePct: 50, freqMHz: 850, maxFreqMHz: 0 };
  const sm = new Smoother();
  plant.update(snap.power!, { snap: { ...snap, gpu: { ...gpu, maxFreqMHz: 1700 } }, sm, t: 1, dt: 0 });
  expect(plant.gpuClock).toBe(0.5);
  plant.update(snap.power!, { snap: { ...snap, gpu }, sm, t: 1.1, dt: 0.1 });
  expect(plant.gpuBusy).toBe(0.5);
  expect(plant.gpuClock).toBe(0);
  expect(gpuLabels(gpu)).toEqual({ busy: "50%", freq: "850 MHZ (MAX N/A)" });
});
