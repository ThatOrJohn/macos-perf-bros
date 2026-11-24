/**
 * Network Sky (DESIGN.md §7.3). System bytes/s drive streak counts (0–14)
 * and the 60-s graph on the log scale capped at 10 MB/s. Directional packets/s
 * ease each lane's speed from 60 to 180 px/s; their sum drives the mast beacon
 * (0.5–3.5 Hz, log scale capped at 100k packets/s). Five PID-stable clouds
 * scale 0.6–1.2 with process rx + tx bytes/s, ordered by a per-PID key so both
 * renderers agree. The graph shows only measured seconds. Labels give the rates.
 */
import type { NetThroughput } from "../../core/snapshot.ts";
import type { PixelCanvas } from "../../engine/canvas.ts";
import { drawText, drawTextCentered, drawTextRight, textWidth } from "../../engine/font5x7.ts";
import { bevel, glow, outlined } from "../../engine/paint.ts";
import { P } from "../../engine/palette.ts";
import { fmtBytes, type DrawCtx } from "../../world/common.ts";
import { drawNetHistory, drawPacketLanes, type NetHistory, type NetSky } from "../../world/net-sky.ts";
import { processName } from "../../world/process-field.ts";
import { W, X, drawCloudHi, drawHintHi, drawHudHi, drawLockedPanelHi, drawMastHi, drawNightSky } from "../common.ts";

const SHADOW = { shadow: X.outline };
const INBOUND = [36, 43, 50, 57];
const OUTBOUND = [132, 139, 146];
// Cloud band x 7–277 (5 slots of 54).
const BAND = [7, 277] as const;

function drawClouds(cv: PixelCanvas, sky: NetSky): void {
  const { clouds } = sky.clouds;
  for (const cloud of clouds) {
    if (cloud.presence === 0) continue;
    // Fit the shared 82 px island silhouette into a 54 px slot, including 2 px of ink.
    drawCloudHi(cv, sky.clouds.center(cloud, ...BAND), 80, 0.49 * cloud.scale * cloud.presence);
  }
  // Labels only for settled clouds, so a join/leave glide never overlaps text.
  for (const cloud of clouds) {
    if (cloud.departing || cloud.presence < 1) continue;
    const { name, netRxBps, netTxBps } = cloud.proc;
    const x = sky.clouds.center(cloud, ...BAND);
    // Keep eight name characters and leave a full glyph of space between slots.
    const label = processName(name, 9).slice(0, 8);
    drawTextCentered(cv, x, 94, label, P.white, SHADOW);
    drawTextCentered(cv, x, 104, `↓${fmtBytes(netRxBps)}/S`, P.ok, SHADOW);
    drawTextCentered(cv, x, 114, `↑${fmtBytes(netTxBps)}/S`, P.accent, SHADOW);
  }
}

function drawRadio(cv: PixelCanvas, packets: number, beacon: boolean): void {
  const x = 299;
  outlined(cv, X.outline, (layer) => drawMastHi(layer, x, 46, 151, 14));
  if (beacon) glow(cv, x, 43, 5, P.crit, 0.7);
  cv.set(x, 43, beacon ? P.crit : P.ember);
  const value = String(Math.round(packets));
  const labelWidth = Math.max(32, textWidth(value) + 4);
  const right = Math.min(W - 4, x + Math.ceil(labelWidth / 2));
  cv.rect(right - labelWidth, 121, labelWidth, 21, P.hudBg);
  const center = right - Math.floor(labelWidth / 2);
  drawTextCentered(cv, center, 123, "PKT/S", P.dim);
  drawTextCentered(cv, center, 133, value, P.white);
}

export function drawNetworkZoneHi(cv: PixelCanvas, ctx: DrawCtx, sky: NetSky, history: NetHistory, net: NetThroughput | undefined): void {
  drawNightSky(cv, 11, 181, ctx.t, false);
  drawTextCentered(cv, W / 2, 14, "NETWORK SKY", P.accent, SHADOW);
  drawHudHi(cv, ctx.snap);
  if (!net) {
    drawLockedPanelHi(cv);
    drawHintHi(cv, "ESC BACK  Q QUIT", "NO DATA WITHOUT SUDO");
    return;
  }
  sky.update(net, ctx.snap.procs, ctx.snap.t, ctx.t, ctx.dt);
  const rx = `↓${fmtBytes(net.rxBps)}/S`;
  const tx = `↑${fmtBytes(net.txBps)}/S`;
  drawTextCentered(cv, W / 2, 24, `${rx}  ${tx}`, P.white, SHADOW);
  if (net.rxBps || net.txBps) {
    drawPacketLanes(cv, sky, W, 10, INBOUND, OUTBOUND);
    drawClouds(cv, sky);
  } else {
    drawTextCentered(cv, 142, 88, "NO TRAFFIC", P.dim, SHADOW);
  }
  drawRadio(cv, net.rxPps + net.txPps, sky.beacon);
  bevel(cv, 4, 154, 312, 25, P.hudBg, P.stoneDeep, P.stoneDeep);
  drawText(cv, 9, 163, "60S", P.dim);
  drawNetHistory(cv, history, Math.floor(ctx.snap.t / 1000), 32, 237, 174, 15);
  drawTextRight(cv, 311, 157, rx, P.ok);
  drawTextRight(cv, 311, 168, tx, P.accent);
  drawHintHi(cv, "ESC BACK  Q QUIT", "↓ IN  ↑ OUT  LOG SCALE");
}
