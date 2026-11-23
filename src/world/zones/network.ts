/**
 * Network Sky (DESIGN.md §7.3). System bytes/s drive streak counts (0–6)
 * and the 60-s graph on the log scale capped at 10 MB/s. Directional packets/s
 * ease lane speeds from 18 to 54 px/s; their sum drives the mast beacon
 * (0.5–3.5 Hz, log scale capped at 100k packets/s). Four PID-stable clouds
 * scale 0.6–1.2 with process rx + tx bytes/s, ordered by a per-PID key so both
 * renderers agree. The graph shows only measured seconds. Labels give the rates.
 */
import type { NetThroughput } from "../../core/snapshot.ts";
import { mix, type Frame, type PixelCanvas } from "../../engine/canvas.ts";
import { bevel, ditherGradientV, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { drawCloud, drawHint, drawHud, drawLockedPanel, drawStars, fmtBytes, type DrawCtx } from "../common.ts";
import { drawNetHistory, drawPacketLanes, type NetSky } from "../net-sky.ts";
import { processName } from "../process-field.ts";

const SKY = [P.skyTop, mix(P.skyTop, P.skyBot, 0.5), P.skyBot];
const INBOUND = [4, 6, 8, 10];
const OUTBOUND = [30, 31, 33];
// Cloud band x 0–72 (4 slots of 18); the mast owns x 73–79.
const BAND = [0, 72] as const;

function drawClouds(f: Frame, sky: NetSky): void {
  const { clouds } = sky.clouds;
  for (const cloud of clouds) {
    if (cloud.presence === 0) continue;
    const scale = cloud.scale * cloud.presence;
    const w = Math.max(1, Math.round(6 * scale));
    const h = Math.max(1, Math.round(4 * scale));
    outlined(f.canvas, P.ink, (layer) => drawCloud(layer, sky.clouds.center(cloud, ...BAND), 21, w, h));
  }
  // Labels only for settled clouds, so a join/leave glide never overlaps text.
  for (const cloud of clouds) {
    if (cloud.departing || cloud.presence < 1) continue;
    const { name, netRxBps, netTxBps } = cloud.proc;
    const x = sky.clouds.center(cloud, ...BAND);
    f.centered(x, 15, processName(name, 16), P.white, P.hudBg);
    f.centered(x, 16, `↓${fmtBytes(netRxBps)} ↑${fmtBytes(netTxBps)}`, P.hudFg, P.hudBg);
  }
}

function drawRadio(cv: PixelCanvas, beacon: boolean): void {
  cv.vline(76, 12, 16, P.metalLight);
  cv.hline(74, 76, 15, P.metalLight);
  for (let y = 17; y <= 25; y++) {
    cv.set(75 - Number(y > 22), y, P.metal);
    cv.set(77 + Number(y > 22), y, P.metalLight);
    if (y % 3 === 0) cv.hline(75 - Number(y > 22), 77 + Number(y > 22), y, P.stoneDark);
  }
  cv.set(76, 11, beacon ? P.crit : P.ember);
}

export function drawNetworkZone(f: Frame, ctx: DrawCtx, sky: NetSky, net: NetThroughput | undefined): void {
  const cv = f.canvas;
  ditherGradientV(cv, 0, 0, 80, 44, SKY);
  drawStars(cv, 31, ctx.t);
  f.centered(40, 1, "NETWORK SKY", P.accent, undefined, true);
  drawHud(f, ctx.snap);
  if (!net) {
    drawLockedPanel(f);
    drawHint(f, "esc back  q quit", "no data without sudo");
    return;
  }
  sky.update(net, ctx.snap.procs, ctx.snap.t, ctx.t, ctx.dt);
  const rx = `↓${fmtBytes(net.rxBps)}/S`;
  const tx = `↑${fmtBytes(net.txBps)}/S`;
  f.centered(40, 2, `${rx}  ${tx}`, P.white, P.hudBg);
  if (net.rxBps || net.txBps) {
    drawPacketLanes(cv, sky, 80, 4, INBOUND, OUTBOUND);
    drawClouds(f, sky);
  } else {
    f.centered(36, 11, "NO TRAFFIC", P.dim, P.hudBg);
  }
  drawRadio(cv, sky.beacon);
  const packets = String(Math.round(net.rxPps + net.txPps));
  // Below the mast (lattice ends at canvas y 25 = row 13), not over it.
  f.text(74, 15, "PKT/S", P.dim, P.hudBg);
  f.text(79 - packets.length, 16, packets, P.white, P.hudBg);
  bevel(cv, 1, 36, 78, 8, P.hudBg, P.stoneDeep, P.stoneDeep);
  f.text(2, 20, "60S", P.dim, P.hudBg);
  // Band y 36–43 (inner 37–42): rx spans y 38–42, tx 37–41.
  drawNetHistory(cv, sky.history, Math.floor(ctx.snap.t / 1000), 6, 77, 42, 4);
  f.text(77 - rx.length - tx.length - 2, 22, rx, P.ok, P.hudBg);
  f.text(77 - tx.length, 22, tx, P.accent, P.hudBg);
  drawHint(f, "esc back  q quit", "↓ IN  ↑ OUT  LOG SCALE");
}
