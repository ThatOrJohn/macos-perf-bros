/**
 * Hi-res Memory Reservoir: a riveted glass tank holding all of RAM in layers,
 * a pressure gauge, and an overflow pipe down to the underground swap cistern.
 */
import { mix, type Color, type PixelCanvas } from "../../engine/canvas.ts";
import { drawText, drawTextCentered, drawTextRight } from "../../engine/font5x7.ts";
import { P } from "../../engine/palette.ts";
import { bayer, bevel, bricks, disc, dither, glow, line, outlined } from "../../engine/paint.ts";
import { fmtBytes, hash, pressureColor, type DrawCtx } from "../../world/common.ts";
import { appMemoryB, freeMemoryB } from "../../world/zones/memory.ts";
import { W, X, drawHintHi, drawHudHi, drawMountains, drawNightSky } from "../common.ts";

const GROUND = 124;
const TANK = { x0: 108, x1: 204, y0: 44, y1: 118 }; // glass interior, exclusive end
const CISTERN = { x0: 232, x1: 304, y0: 140, y1: 174 };

interface Layer { label: string; bytes: number; color: Color; paint: (x: number, y: number, top: boolean, t: number) => Color }

function ground(cv: PixelCanvas): void {
  for (let y = GROUND; y < 181; y++) {
    for (let x = 0; x < W; x++) {
      const h = hash(x >> 1, y >> 1, 15);
      let c: Color = y < GROUND + 3 ? P.grass : y < GROUND + 5 ? P.grassDark : dither(x, y, P.dirt, P.dirtDark, Math.min(1, (y - GROUND) / 30));
      if (y >= GROUND + 5 && h < 0.04) c = X.rockLight;
      else if (y >= GROUND + 5 && h > 0.97) c = X.rockDark;
      cv.set(x, y, c);
    }
  }
}

function gauge(cv: PixelCanvas, cx: number, cy: number, frac: number, pressure: string | undefined): void {
  outlined(cv, X.outline, (l) => {
    disc(l, cx, cy, 15, P.metal);
    disc(l, cx, cy, 13, 0xe9e4d4);
  });
  // colored arc: green → yellow → red across 225°..-45°
  for (let i = 0; i <= 40; i++) {
    const k = i / 40;
    const a = ((225 - k * 270) * Math.PI) / 180;
    const c = k < 0.6 ? P.ok : k < 0.85 ? P.warn : P.crit;
    for (const r of [10, 11]) cv.set(Math.round(cx + Math.cos(a) * r), Math.round(cy - Math.sin(a) * r), c);
  }
  for (let i = 0; i <= 10; i++) {
    const a = ((225 - (i / 10) * 270) * Math.PI) / 180;
    cv.set(Math.round(cx + Math.cos(a) * 8), Math.round(cy - Math.sin(a) * 8), X.outline);
  }
  const a = ((225 - frac * 270) * Math.PI) / 180;
  line(cv, cx, cy, Math.round(cx + Math.cos(a) * 9), Math.round(cy - Math.sin(a) * 9), P.crit);
  disc(cv, cx, cy, 1, X.outline);
  drawTextCentered(cv, cx, cy + 19, "PRESSURE", P.white, { shadow: X.outline });
  drawTextCentered(cv, cx, cy + 28, (pressure ?? "?").toUpperCase(), pressureColor(pressure), { shadow: X.outline });
}

export function drawMemoryZoneHi(cv: PixelCanvas, ctx: DrawCtx): void {
  drawNightSky(cv, 11, GROUND, ctx.t, false);
  drawMountains(cv, GROUND, 34, 18, 4.2);
  ground(cv);
  drawTextCentered(cv, W / 2, 14, "MEMORY RESERVOIR", P.accent, { shadow: X.outline });
  const m = ctx.snap.memory;
  if (!m) {
    drawTextCentered(cv, W / 2, 80, "NO MEMORY DATA", P.dim);
    drawHudHi(cv, ctx.snap);
    return;
  }
  const s = (k: string, v: number) => ctx.sm.get(`hi.mem.${k}`, v, ctx.dt);
  const appB = appMemoryB(m);
  const t = ctx.t;
  const layers: Layer[] = [
    { label: "WIRED", bytes: s("wired", m.wiredB), color: P.wired,
      paint: (x, y) => (hash(x >> 2, y >> 2, 3) < 0.1 ? mix(P.wired, X.outline, 0.3) : P.wired) },
    { label: "APP", bytes: s("app", appB), color: P.app,
      paint: (x, y, top) => top ? ((x + Math.floor(t * 10)) % 8 < 3 ? P.waterHi : P.appLight)
        : (Math.sin(x * 0.25 + y * 0.6 - t * 2) > 0.85 ? P.appLight : P.app) },
    { label: "COMPRESSED", bytes: s("comp", m.compressedB), color: P.compressed,
      // packed blocks: compressed pages as stacked bricks
      paint: (x, y) => {
        const by = (y - TANK.y0) % 4;
        const bx = (x + (Math.floor(y / 4) % 2) * 3) % 6;
        return by === 3 || bx === 5 ? mix(P.compressed, X.outline, 0.35) : by === 0 ? P.compressedLight : P.compressed;
      } },
    { label: "CACHED", bytes: s("cache", m.cachedB), color: P.cached,
      // reclaimable: half-transparent dither over the empty tank
      paint: (x, y) => (0.5 > bayer(x, y) ? P.cached : mix(X.outline, P.wired, 0.3)) },
  ];

  // --- tank frame
  const { x0, x1, y0, y1 } = TANK;
  outlined(cv, X.outline, (l) => {
    bevel(l, x0 - 10, y0 - 8, 10, y1 - y0 + 14, P.metal, P.metalLight, P.stoneDark);
    bevel(l, x1, y0 - 8, 10, y1 - y0 + 14, P.metal, P.metalLight, P.stoneDark);
    bevel(l, x0 - 14, y0 - 12, x1 - x0 + 28, 5, P.metal, P.metalLight, P.stoneDark);
    bevel(l, x0 - 14, y1 + 2, x1 - x0 + 28, 6, P.metal, P.metalLight, P.stoneDark);
    for (let y = y0 - 4; y < y1; y += 8) {
      l.set(x0 - 6, y, P.metalLight); l.set(x0 - 5, y + 1, P.stoneDark);
      l.set(x1 + 4, y, P.metalLight); l.set(x1 + 5, y + 1, P.stoneDark);
    }
  });
  cv.rect(x0, y0, x1 - x0, y1 - y0 + 2, mix(X.outline, P.wired, 0.3));

  // --- layers, bottom up
  const hTank = y1 - y0 + 2;
  let y = y1 + 1;
  let carry = 0;
  const bounds: { label: string; top: number; bottom: number }[] = [];
  for (const L of layers) {
    const exact = (L.bytes / m.totalB) * hTank + carry;
    const rows = Math.max(0, Math.round(exact));
    carry = exact - rows;
    const bottom = y;
    for (let r = 0; r < rows && y >= y0; r++, y--) {
      for (let x = x0; x < x1; x++) cv.set(x, y, L.paint(x, y, r === rows - 1 && L.label === "APP", t));
    }
    bounds.push({ label: L.label, top: y + 1, bottom });
  }
  // bubbles rising through the app layer
  const app = bounds[1]!;
  for (let i = 0; i < 6; i++) {
    const bx = x0 + 6 + Math.floor(hash(i, 1, 7) * (x1 - x0 - 12));
    const span = Math.max(1, app.bottom - app.top);
    const by = app.bottom - ((t * (8 + i * 3) + i * 13) % span);
    if (by > app.top + 1) { cv.set(bx, Math.round(by), P.waterHi); cv.set(bx + 1, Math.round(by) - 1, P.appLight); }
  }
  // glass reflections
  for (let i = 0; i < 22; i++) cv.set(x0 + 4 + Math.floor(i / 3), y0 + 4 + i, mix(cv.get(x0 + 4 + Math.floor(i / 3), y0 + 4 + i), P.white, 0.35));
  for (let i = 0; i < 10; i++) cv.set(x0 + 9 + Math.floor(i / 3), y0 + 4 + i, mix(cv.get(x0 + 9 + Math.floor(i / 3), y0 + 4 + i), P.white, 0.25));
  // layer tick labels on the right edge of the glass
  for (const b of bounds) {
    if (b.bottom - b.top < 8) continue;
    drawTextRight(cv, x1 - 3, Math.round((b.top + b.bottom) / 2) - 3, b.label, mix(P.white, P.glass, 0.2), { shadow: X.outline });
  }

  // --- pressure lamps on the lid
  const pc = pressureColor(m.pressure);
  const blink = m.pressure !== "critical" || Math.sin(t * 10) > 0;
  for (let x = x0 + 4; x < x1; x += 16) {
    if (blink) glow(cv, x, y0 - 15, 5, pc, 0.6);
    disc(cv, x, y0 - 15, 2, blink ? pc : P.stoneDark);
    cv.set(x - 1, y0 - 16, mix(pc, P.white, 0.6));
  }

  // --- overflow pipe → valve → cistern
  const pipeY = y0 + 6;
  const pipeX = CISTERN.x0 + 20;
  outlined(cv, X.outline, (l) => {
    bevel(l, x1 + 10, pipeY, pipeX - x1 - 4, 6, P.metal, P.metalLight, P.stoneDark);
    bevel(l, pipeX, pipeY, 6, CISTERN.y0 - pipeY + 2, P.metal, P.metalLight, P.stoneDark);
    bevel(l, pipeX - 2, pipeY - 2, 10, 10, P.metal, P.metalLight, P.stoneDark); // elbow flange
  });
  // valve wheel
  const vx = x1 + 30;
  cv.rect(vx - 1, pipeY - 4, 3, 4, P.stoneDark); // stem
  outlined(cv, X.outline, (l) => {
    l.hline(vx - 6, vx + 6, pipeY - 6, P.crit);
    l.hline(vx - 6, vx + 6, pipeY - 5, P.ember);
    l.rect(vx - 1, pipeY - 7, 3, 3, P.metalLight);
  });

  // --- cistern
  const cs = CISTERN;
  outlined(cv, X.outline, (l) => {
    bricks(l, cs.x0 - 6, cs.y0 - 6, cs.x1 - cs.x0 + 12, cs.y1 - cs.y0 + 12,
      { base: P.stoneDark, light: P.stone, dark: P.stoneDeep, mortar: X.outline }, 8, 4);
  });
  cv.rect(cs.x0, cs.y0, cs.x1 - cs.x0, cs.y1 - cs.y0, mix(X.outline, P.stoneDeep, 0.4));
  const swapFrac = m.swapTotalB > 0 ? s("swap", m.swapUsedB) / m.swapTotalB : 0;
  const sh = cs.y1 - cs.y0;
  const sRows = Math.round(swapFrac * sh);
  for (let r = 0; r < sRows; r++) {
    const yy = cs.y1 - 1 - r;
    for (let x = cs.x0; x < cs.x1; x++) {
      const top = r === sRows - 1;
      const wave = top && (x + Math.floor(t * 6)) % 7 < 2;
      cv.set(x, yy, wave ? P.white : top ? P.swapLight : dither(x, yy, P.swap, mix(P.swap, X.outline, 0.4), r / sh));
    }
  }
  if (m.swapUsedB > 0) {
    const fallSpan = Math.max(2, cs.y1 - sRows - cs.y0);
    for (let i = 0; i < 2; i++) {
      const dy = cs.y0 + ((t * 30 + i * 11) % fallSpan);
      cv.set(pipeX + 3, Math.round(dy), P.swapLight);
      cv.set(pipeX + 3, Math.round(dy) - 1, P.swap);
    }
  }
  drawText(cv, cs.x0 - 4, cs.y0 - 20, "SWAP", P.swapLight, { shadow: X.outline });
  drawTextRight(cv, cs.x1 + 4, cs.y0 - 20, `${fmtBytes(m.swapUsedB)}/${fmtBytes(m.swapTotalB, 0)}`, P.white, { shadow: X.outline });

  // --- left column: gauge + legend
  gauge(cv, 46, 44, m.usedB / m.totalB, m.pressure);
  const freeB = freeMemoryB(m);
  const rows: [string, number, Color][] = [
    ...layers.map((L) => [L.label === "COMPRESSED" ? "COMPRESS" : L.label, L.bytes, L.color] as [string, number, Color]),
    ["FREE", freeB, mix(X.outline, P.wired, 0.3)],
  ];
  rows.forEach(([label, bytes, color], i) => {
    const ry = 84 + i * 9;
    outlined(cv, X.outline, (l) => l.rect(6, ry, 7, 7, color));
    drawText(cv, 17, ry, label, P.white, { shadow: X.outline });
    drawTextRight(cv, 92, ry, fmtBytes(bytes), P.dim, { shadow: X.outline });
  });
  drawText(cv, 6, 132, "USED", P.white, { shadow: X.outline });
  drawTextRight(cv, 92, 132, `${fmtBytes(m.usedB)}/${fmtBytes(m.totalB, 0)}`, P.white, { shadow: X.outline });

  drawHudHi(cv, ctx.snap);
  drawHintHi(cv, "ESC BACK  Q QUIT", "TANK = ALL RAM  CISTERN = SWAP");
}
