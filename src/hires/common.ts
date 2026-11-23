/**
 * Shared pieces for the hi-res (320×192) renderer: layout, extra palette,
 * sprites, HUD with icons, hint bar, and backdrops.
 */
import { PixelCanvas, mix, sprite, type Color, type Sprite } from "../engine/canvas.ts";
import { drawText, drawTextRight, textWidth } from "../engine/font5x7.ts";
import { P } from "../engine/palette.ts";
import { bayer, blitOutlined, disc, ditherGradientV, glow } from "../engine/paint.ts";
import type { Snapshot } from "../core/snapshot.ts";
import { cpuTotalPct, fmtBytes, fmtPct, fmtUptime, hash, pressureColor, thermalColor } from "../world/common.ts";

export const W = 320;
export const H = 192;
export const HUD_H = 11;     // y 0..10
export const HINT_Y = 181;   // y 181..191
export const SCENE_TOP = HUD_H;

/** Extra hi-res colors (the base palette lives in engine/palette.ts). */
export const X = {
  sky0: 0x111630,
  sky1: 0x1b2347,
  sky2: 0x29356a,
  sky3: 0x3d4f88,
  moon: 0xf2ecd0,
  moonShade: 0xc9c1a0,
  mtnFar: 0x2a3360,
  mtnFarLight: 0x37437a,
  mtnNear: 0x22404a,
  mtnNearLight: 0x2f5a5e,
  snow: 0xd8e2ff,
  leaf: 0x3e8a3a,
  leafLight: 0x6cbf4a,
  leafDark: 0x285e2a,
  trunk: 0x6b4526,
  outline: 0x0b0d18,
  tealLight: 0x8af5e8,
  brickRed: 0x9a4030,
  brickRedLight: 0xc4614a,
  brickRedDark: 0x652a20,
  mortarRed: 0x3a1a16,
  window: 0xffd27a,
  cloudOutline: 0x232c55,
  gem1: 0x6ad1ff,
  gem2: 0xff8ad8,
  gem3: 0xffe066,
  rock: 0x6f6a72,
  rockLight: 0x8f8a92,
  rockDark: 0x4a464e,
} as const;

// ---------------------------------------------------------------- sprites

const robotKey = {
  y: P.accent, k: P.stoneDark, L: X.tealLight, T: P.bodyTeal, d: P.bodyTealDark, v: P.visor, e: P.eye, a: P.accent,
};
export const ROBOT: Sprite[] = [
  sprite([
    "....yy....",
    ".....k....",
    "..LLLLLL..",
    ".LTTTTTTT.",
    ".Tvvvvvvd.",
    ".Tvvveevd.",
    ".Tvvvvvvd.",
    "..dddddd..",
    ".LTTTTTTd.",
    "LTTaaTTTdd",
    ".TTTTTTTd.",
    "..dd..dd..",
    "..kk..kk..",
  ], robotKey),
  sprite([
    "....yy....",
    ".....k....",
    "..LLLLLL..",
    ".LTTTTTTT.",
    ".Tvvvvvvd.",
    ".Tvvveevd.",
    ".Tvvvvvvd.",
    "..dddddd..",
    ".LTTTTTTd.",
    "LTTaaTTTdd",
    ".TTTTTTTd.",
    ".dd....dd.",
    ".kk....kk.",
  ], robotKey),
];
/** Blink frame (eyes closed). */
export const ROBOT_BLINK = sprite([
  "....yy....", ".....k....", "..LLLLLL..", ".LTTTTTTT.", ".Tvvvvvvd.", ".Tvvvvvvd.", ".Tvvvvvvd.",
  "..dddddd..", ".LTTTTTTd.", "LTTaaTTTdd", ".TTTTTTTd.", "..dd..dd..", "..kk..kk..",
], robotKey);

export function drawRobot(cv: PixelCanvas, footX: number, footY: number, t: number, walking: boolean, flip = false): void {
  const s = walking ? ROBOT[Math.floor(t * 8) % 2]! : (t % 3.2) < 0.12 ? ROBOT_BLINK : ROBOT[0]!;
  const bob = walking ? 0 : Math.sin(t * 3) > 0.6 ? -1 : 0;
  blitOutlined(cv, s, Math.round(footX - s.w / 2), Math.round(footY - s.h + bob), X.outline, flip);
}

function slimeSprite(base: Color, squash: boolean): Sprite {
  const key = { s: base, L: mix(base, 0xffffff, 0.45), d: mix(base, X.outline, 0.4), w: P.white, k: X.outline, m: mix(base, X.outline, 0.65) };
  return squash
    ? sprite([
        "...LLLsss.....",
        ".sLLssssssss..",
        "sssswksssswksd",
        "ssssssmmsssssd",
        ".dddddddddddd.",
      ], key)
    : sprite([
        "....ssss....",
        "..sLLsssss..",
        ".sLLssssssd.",
        ".ssssssssssd",
        "sswkssswksdd",
        "ssssssssssdd",
        "sssssmmsssdd",
        ".dddddddddd.",
      ], key);
}

export const SLIME_BASES = [P.bodyTeal, P.compressedLight, P.warn, P.grassLight, P.eBrickLight, P.pBrickLight];
export const SLIMES = SLIME_BASES.map((c) => [slimeSprite(c, false), slimeSprite(c, true)] as const);

export const BOSS: Sprite = sprite([
  "..h............h..",
  "..hh..........hh..",
  "...hh.ssssss.hh...",
  "....sLLLsssssss...",
  "..sLLLssssssssss..",
  ".sLLsssssssssssss.",
  ".ssskkssssssskksd.",
  "ssswwkkssssskkwwsd",
  "ssswwwksssssskwwsd",
  "sssssssssssssssssd",
  "sssssmmmmmmmmsssdd",
  "ssssmyymyymyymssdd",
  ".sssmmmmmmmmmssdd.",
  "..dddddddddddddd..",
], { s: P.lava, L: P.lavaHi, d: P.ember, w: P.white, k: X.outline, h: P.stoneLight, m: X.outline, y: P.white });

export const CART: Sprite = sprite([
  "..a.b..c.a....",
  ".abbcaacbba...",
  "MmmmmmmmmmmmmM",
  "MWwwwwwwwwwwWM",
  "MWwwwwwwwwwwWM",
  ".MMMMMMMMMMMM.",
  "..kk......kk..",
  "..kk......kk..",
], { a: X.gem1, b: X.gem2, c: X.gem3, M: P.metal, m: P.metalLight, W: P.wood, w: P.woodDark, k: X.outline });

export const FLAME: Sprite[] = [
  sprite(["..r...", ".rr.r.", ".ryrr.", "ryyyr.", "ryWyyr", ".ryyr."], { r: P.lava, y: P.lavaHi, W: P.glow }),
  sprite(["...r..", "..rr..", ".rryr.", ".ryyrr", "ryyWyr", ".ryyr."], { r: P.lava, y: P.lavaHi, W: P.glow }),
  sprite([".r....", ".rr...", "rryrr.", "ryyyr.", "ryWyyr", ".ryyr."], { r: P.lava, y: P.lavaHi, W: P.glow }),
];

export const TREE: Sprite = sprite([
  ".....LLLL.....",
  "...LLLlllll...",
  "..LLllllllld..",
  ".Llllllllllld.",
  ".Lllllllllldd.",
  "Llllllllllllld",
  "lllllllllllldd",
  ".llllllllllddd",
  ".ldlllllllddd.",
  "..ddllllldddd.",
  "...dddddddd...",
  ".....tTT......",
  ".....tTT......",
  ".....tTT......",
  "....ttTTT.....",
], { L: X.leafLight, l: X.leaf, d: X.leafDark, t: X.trunk, T: P.woodDark });

export const PINE: Sprite = sprite([
  "....L.....",
  "...LLl....",
  "...Llld...",
  "..LLlld...",
  "...Llld...",
  "..LLllld..",
  ".LLlllldd.",
  "..Llllld..",
  ".LLllllldd",
  "LLllllllld",
  "....TT....",
  "....TT....",
], { L: X.leafLight, l: X.leaf, d: X.leafDark, T: X.trunk });

export const BANNER: Sprite[] = [0, 1, 2].map((f) => {
  const rows = ["cccccccccc", "cLLLLLLLLc", "cLLLLLLLLc", "cLLLLLLLLc", "cccccccccc", "cc.cc.cc.c"];
  // wave: shift rows by frame
  return sprite(rows.map((r, i) => (i % 2 === f % 2 ? r : `.${r.slice(0, -1)}`)), { c: 0xffffff, L: 0xffffff });
});

// ---------------------------------------------------------------- HUD icons (7×7)

const ico = (rows: string[], c: Color) => sprite(rows, { "#": c });
export const ICON = {
  cpu: ico([".#.#.#.", "#######", "##...##", "##...##", "##...##", "#######", ".#.#.#."], P.eBrickLight),
  mem: ico(["...#...", "..###..", ".#####.", ".#####.", "#######", "#######", ".#####."], P.appLight),
  net: ico(["...#...", ".#.#.#.", "#..#..#", "...#...", "..###..", ".#.#.#.", "#..#..#"], P.ok),
  bolt: ico(["...###.", "..###..", ".###...", "######.", "..###..", ".###...", "##....."], P.accent),
  temp: ico(["..##...", "..#.#..", "..#.#..", "..###..", ".#####.", ".#####.", "..###.."], P.lava),
  plug: ico([".#.#...", ".#.#...", "#####..", "#####..", ".###...", "..#....", "..###.."], P.stoneLight),
  heart: ico([".#.#...", "#####..", "#####..", ".###...", "..#....", ".......", "......."], P.crit),
};

// ---------------------------------------------------------------- HUD + hint

export function drawHudHi(cv: PixelCanvas, snap: Snapshot): void {
  cv.rect(0, 0, W, HUD_H, P.hudBg);
  cv.hline(0, W - 1, HUD_H - 1, P.stoneDeep);
  const cpu = cpuTotalPct(snap);
  const mem = snap.memory;
  const items: { icon: Sprite; text: string; color: Color }[] = [
    { icon: ICON.cpu, text: fmtPct(cpu), color: cpu > 85 ? P.crit : cpu > 60 ? P.warn : P.hudFg },
  ];
  if (mem) items.push({ icon: ICON.mem, text: `${fmtBytes(mem.usedB)}/${fmtBytes(mem.totalB, 0)}`, color: pressureColor(mem.pressure) });
  if (snap.net) items.push({ icon: ICON.net, text: `↓${fmtBytes(snap.net.rxBps, 0)}↑${fmtBytes(snap.net.txBps, 0)}`, color: P.hudFg });
  if (snap.power) items.push({ icon: ICON.bolt, text: `${snap.power.packageW.toFixed(1)}W`, color: P.hudFg });
  if (snap.thermal) items.push({ icon: ICON.temp, text: snap.thermal.toUpperCase(), color: thermalColor(snap.thermal) });
  items.push(snap.battery
    ? { icon: ICON.heart, text: `${Math.round(snap.battery.pct)}%`, color: P.hudFg }
    : { icon: ICON.plug, text: "AC", color: P.hudFg });

  const up = fmtUptime(snap.uptimeS);
  const limit = W - textWidth(up) - 8;
  let x = 3;
  for (const it of items) {
    const w = 9 + textWidth(it.text) + 7;
    if (x + w - 7 > limit) break;
    cv.blit(it.icon, x, 2);
    drawText(cv, x + 9, 2, it.text, it.color);
    x += w;
  }
  drawTextRight(cv, W - 3, 2, up, P.dim);
}

export function drawHintHi(cv: PixelCanvas, left: string, right = ""): void {
  cv.rect(0, HINT_Y, W, H - HINT_Y, P.hudBg);
  cv.hline(0, W - 1, HINT_Y, P.stoneDeep);
  drawText(cv, 4, HINT_Y + 3, left, P.white);
  if (right) drawTextRight(cv, W - 4, HINT_Y + 3, right, P.dim);
}

// ---------------------------------------------------------------- backdrops

export function drawNightSky(cv: PixelCanvas, y0: number, y1: number, t: number, moon = true): void {
  ditherGradientV(cv, 0, y0, W, y1, [X.sky0, X.sky1, X.sky2, X.sky3]);
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(hash(i, 1, 9) * W);
    const y = y0 + Math.floor(hash(i, 2, 9) * (y1 - y0) * 0.7);
    const phase = Math.sin(t * (1 + hash(i, 4, 9) * 2) + i);
    if (phase < -0.6) continue;
    const c = mix(P.star, X.sky1, hash(i, 3, 9) * 0.6);
    cv.set(x, y, c);
    if (hash(i, 5, 9) > 0.85 && phase > 0.5) {
      cv.set(x - 1, y, mix(c, X.sky1, 0.5));
      cv.set(x + 1, y, mix(c, X.sky1, 0.5));
      cv.set(x, y - 1, mix(c, X.sky1, 0.5));
      cv.set(x, y + 1, mix(c, X.sky1, 0.5));
    }
  }
  if (moon) {
    const mx = 26;
    const my = y0 + 14;
    glow(cv, mx, my, 16, X.moon, 0.35);
    disc(cv, mx, my, 8, X.moon);
    disc(cv, mx + 3, my - 2, 7, X.sky1); // crescent bite
    for (const [dx, dy] of [[-4, 1], [-2, 4], [-5, -2]] as const) cv.set(mx + dx, my + dy, X.moonShade);
  }
}

/** Mountain silhouettes: far range with snowcaps, near range darker. */
export function drawMountains(cv: PixelCanvas, baseY: number, farH: number, nearH: number, seed = 0): void {
  const far = (x: number) =>
    baseY - farH * (0.55 + 0.45 * Math.abs(Math.sin(x * 0.021 + seed))) + Math.sin(x * 0.11 + seed) * 3;
  for (let x = 0; x < W; x++) {
    const top = Math.round(far(x));
    const slope = far(x + 1) - far(x);
    for (let y = top; y < baseY; y++) {
      const snow = y < top + 4 && top < baseY - farH * 0.75;
      cv.set(x, y, snow ? (slope > 0 ? X.snow : mix(X.snow, X.mtnFar, 0.35)) : slope > 0 ? X.mtnFarLight : X.mtnFar);
    }
  }
  const near = (x: number) => baseY - nearH * (0.5 + 0.5 * Math.abs(Math.sin(x * 0.035 + seed + 1.3)));
  for (let x = 0; x < W; x++) {
    const top = Math.round(near(x));
    const lit = near(x + 1) - near(x) > 0;
    for (let y = top; y < baseY; y++) cv.set(x, y, lit && y < top + 3 ? X.mtnNearLight : X.mtnNear);
  }
}

/** Textured grass field with tufts and the odd flower. */
export function drawGrassField(cv: PixelCanvas, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const h = hash(x >> 1, y >> 1, 11);
      cv.set(x, y, h < 0.06 ? P.grassDark : h > 0.97 ? P.grassLight : P.grass);
    }
  }
  for (let i = 0; i < 140; i++) {
    const x = Math.floor(hash(i, 1, 12) * W);
    const y = y0 + 2 + Math.floor(hash(i, 2, 12) * (y1 - y0 - 4));
    if (hash(i, 3, 12) < 0.12) {
      const c = hash(i, 4, 12) < 0.5 ? P.white : P.accent;
      cv.set(x, y, c);
      cv.set(x, y + 1, P.grassDark);
    } else {
      cv.set(x, y, P.grassDark);
      cv.set(x + 2, y, P.grassDark);
      cv.set(x + 1, y - 1, P.grassLight);
      cv.set(x + 1, y, P.grassDark);
    }
  }
}

/** Rising smoke puffs from (x, y); amount 0..1. */
export function drawSmokeHi(cv: PixelCanvas, x: number, y: number, amount: number, t: number, seed = 0): void {
  const n = Math.round(amount * 6);
  for (let i = 0; i < n; i++) {
    const phase = (t * 0.45 + i / Math.max(1, n) + seed * 0.37) % 1;
    const py = y - phase * (10 + amount * 26);
    const px = x + Math.sin(phase * 5 + seed) * 4 * phase;
    const r = 2 + Math.round(phase * 3);
    const fade = phase;
    for (let yy = -r; yy <= r; yy++) {
      for (let xx = -r; xx <= r; xx++) {
        if (xx * xx + yy * yy > r * r) continue;
        const sx = Math.round(px + xx);
        const sy = Math.round(py + yy);
        if (fade > bayer(sx, sy) + 0.25) continue; // dither out as it rises
        cv.set(sx, sy, yy < 0 && xx < 0 ? P.cloud : yy > r / 2 ? P.smokeDark : P.smoke);
      }
    }
  }
}

/** Circle iris wipe: everything outside radius → ink. k in 0..1. */
export function irisHi(cv: PixelCanvas, cx: number, cy: number, k: number): void {
  const r = k * k * 380;
  for (let y = HUD_H; y < H; y++) {
    for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) > r) cv.set(x, y, P.ink);
  }
}

export { drawText, textWidth };
