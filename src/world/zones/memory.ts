/**
 * Memory Reservoir (DESIGN.md §7.3): one tank holding all of RAM in layers
 * (wired, app, compressed, cached), pressure lamps on the rim, and an overflow
 * pipe into the underground swap cistern.
 */
import { mix, type Color, type Frame, type PixelCanvas } from "../../engine/canvas.ts";
import { ditherGradientV } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { drawHint, drawHud, drawStars, fmtBytes, hash, pressureColor, type DrawCtx } from "../common.ts";

const GROUND = 34;
const TANK = { x0: 24, x1: 52, y0: 6, y1: 33 }; // interior, inclusive
const CISTERN = { x0: 58, x1: 76, y0: 37, y1: 44 };
const PIPE_X = 63;

interface Layer { key: string; label: string; bytes: number; color: Color; alt?: Color; dither?: boolean }

function drawBackdrop(cv: PixelCanvas, t: number): void {
  ditherGradientV(cv, 0, 0, 80, GROUND, [0x111630, 0x1b2347, 0x29356a, 0x3d4f88]);
  drawStars(cv, 14, t);
  for (let y = GROUND; y < 46; y++) {
    for (let x = 0; x < 80; x++) {
      const h = hash(x, y, 5);
      cv.set(x, y, y === GROUND ? P.grass : y === GROUND + 1 ? P.grassDark : h < 0.1 ? P.dirt : P.dirtDark);
    }
  }
}

export function drawMemoryZone(f: Frame, ctx: DrawCtx): void {
  const cv = f.canvas;
  drawBackdrop(cv, ctx.t);
  f.centered(40, 1, "MEMORY RESERVOIR", P.accent, undefined, true);
  const m = ctx.snap.memory;
  if (!m) {
    f.centered(40, 10, "no memory data", P.dim);
    drawHud(f, ctx.snap);
    return;
  }
  const s = (k: string, v: number) => ctx.sm.get(`mem.${k}`, v, ctx.dt);
  const appB = Math.max(0, m.usedB - m.wiredB - m.compressedB);
  const layers: Layer[] = [
    { key: "wired", label: "WIRED", bytes: s("wired", m.wiredB), color: P.wired },
    { key: "app", label: "APP", bytes: s("app", appB), color: P.app },
    { key: "comp", label: "COMPRESSED", bytes: s("comp", m.compressedB), color: P.compressed, alt: P.compressedLight },
    { key: "cache", label: "CACHED", bytes: s("cache", m.cachedB), color: P.cached, dither: true },
  ];
  const total = m.totalB;

  // tank body
  const { x0, x1, y0, y1 } = TANK;
  const h = y1 - y0 + 1;
  cv.rect(x0 - 2, y0 - 1, x1 - x0 + 5, h + 2, P.stoneDark);
  cv.rect(x0, y0, x1 - x0 + 1, h, mix(P.stoneDeep, P.skyTop, 0.5));
  cv.hline(x0 - 3, x1 + 3, y0 - 2, P.stone);
  cv.hline(x0 - 3, x1 + 3, y1 + 1, P.stone);

  // fill layers bottom-up
  let y = y1;
  let carry = 0;
  let surfaceY = y1 + 1;
  for (const L of layers) {
    const exact = (L.bytes / total) * h + carry;
    const rows = Math.max(0, Math.round(exact));
    carry = exact - rows;
    for (let r = 0; r < rows && y >= y0; r++, y--) {
      for (let x = x0; x <= x1; x++) {
        let c = L.alt && y % 2 === 0 ? L.alt : L.color;
        if (L.dither && (x + y) % 2 === 0) c = mix(L.color, P.stoneDeep, 0.5);
        cv.set(x, y, c);
      }
    }
    if (L.key !== "cache" && rows > 0) surfaceY = y + 1;
  }
  // ripple on the "used" surface
  for (let x = x0; x <= x1; x++) {
    if ((x + Math.floor(ctx.t * 6)) % 5 === 0) cv.set(x, surfaceY, P.waterHi);
  }
  // glass glints
  cv.vline(x0 + 1, y0 + 1, y0 + 6, mix(P.glass, P.white, 0.4));
  cv.vline(x0 + 2, y0 + 1, y0 + 3, P.glass);

  // pressure lamps along the rim
  const pc = pressureColor(m.pressure);
  const blink = m.pressure === "critical" ? Math.sin(ctx.t * 10) > 0 : true;
  for (let x = x0; x <= x1; x += 4) cv.set(x, y0 - 3, blink ? pc : P.stoneDeep);

  // overflow pipe → cistern
  const py = y0 + 2;
  cv.rect(x1 + 3, py, PIPE_X - x1 - 2, 2, P.metal);
  cv.hline(x1 + 3, PIPE_X, py, P.metalLight);
  cv.rect(PIPE_X - 1, py, 2, CISTERN.y0 - py, P.metal);
  cv.vline(PIPE_X - 1, py, CISTERN.y0 - 1, P.metalLight);

  // cistern
  const cs = CISTERN;
  cv.rect(cs.x0 - 1, cs.y0 - 1, cs.x1 - cs.x0 + 3, cs.y1 - cs.y0 + 3, P.stoneDark);
  cv.rect(cs.x0, cs.y0, cs.x1 - cs.x0 + 1, cs.y1 - cs.y0 + 1, P.stoneDeep);
  const swapFrac = m.swapTotalB > 0 ? s("swap", m.swapUsedB) / m.swapTotalB : 0;
  const ch = cs.y1 - cs.y0 + 1;
  const sRows = Math.round(swapFrac * ch);
  for (let r = 0; r < sRows; r++) {
    for (let x = cs.x0; x <= cs.x1; x++) {
      const top = r === sRows - 1 && (x + Math.floor(ctx.t * 5)) % 4 === 0;
      cv.set(x, cs.y1 - r, top ? P.swapLight : P.swap);
    }
  }
  // drips in the pipe while swap is in use
  if (m.swapUsedB > 0) {
    const len = CISTERN.y0 - py;
    for (let i = 0; i < 3; i++) cv.set(PIPE_X, py + 2 + Math.floor((ctx.t * 10 + i * 7) % (len - 2)), P.swapLight);
  }

  // legend (left)
  layers.forEach((L, i) => {
    const row = 4 + i * 2;
    const py2 = (row - 1) * 2;
    cv.rect(1, py2, 2, 2, L.color);
    if (L.alt) cv.hline(1, 2, py2, L.alt);
    f.text(4, row, L.label, P.white);
    f.text(4, row + 1, fmtBytes(L.bytes), P.dim);
  });
  const freeB = Math.max(0, total - m.usedB - m.cachedB);
  f.text(4, 12, "FREE", P.white);
  f.text(4, 13, fmtBytes(freeB), P.dim);
  f.text(1, 14, `USED ${fmtBytes(m.usedB)}`, P.white, undefined, true);
  f.text(1, 15, `OF   ${fmtBytes(total, 0)}`, P.dim);
  f.text(1, 16, "PRESSURE", P.white);
  f.text(1, 17, (m.pressure === "critical" ? "⚠ " : "") + m.pressure.toUpperCase(), pc, undefined, true);

  // swap label above cistern
  f.text(cs.x0, 17, "SWAP", P.swapLight, undefined, true);
  f.text(cs.x0 + 5, 17, `${fmtBytes(m.swapUsedB)}/${fmtBytes(m.swapTotalB, 0)}`, P.white);

  drawHud(f, ctx.snap);
  drawHint(f, "esc back  q quit", "tank = all RAM · cistern = swap");
}
