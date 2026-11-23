/** Shared Network Sky sampling, PID slots, and renderer-independent metric scales. */
import type { NetThroughput, Proc } from "../core/snapshot.ts";
import type { Color, PixelCanvas } from "../engine/canvas.ts";
import { bayer, line } from "../engine/paint.ts";
import { P } from "../engine/palette.ts";
import { Smoother } from "../engine/tween.ts";
import { hash } from "./common.ts";

export const NET_HISTORY_SECONDS = 60;
export const netLevel = (bps: number) => Math.min(1, Math.log10(1 + Math.max(0, bps)) / 7);
export const packetLevel = (pps: number) => Math.min(1, Math.log10(1 + Math.max(0, pps)) / 5);

interface NetSample { second: number; rx: number; tx: number }
const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * The last 60 s of system throughput, stored by the snapshot's own second so
 * the graph's time axis is real: a second with no reading stays a gap, and
 * nothing is padded or invented (AGENTS.md rule 1). `Game` records into one
 * shared history on every frame, in every scene.
 */
export class NetHistory {
  private readonly samples: NetSample[] = Array.from({ length: NET_HISTORY_SECONDS }, () => ({ second: -Infinity, rx: 0, tx: 0 }));
  /** Newest recorded second, or -Infinity. */
  latest = -Infinity;

  /** Keeps the first reading of each second; ignores time going backwards. */
  record(tMs: number, rx: number, tx: number): void {
    const second = Math.floor(tMs / 1000);
    if (second <= this.latest) return;
    const sample = this.samples[mod(second, NET_HISTORY_SECONDS)]!;
    sample.second = second;
    sample.rx = rx;
    sample.tx = tx;
    this.latest = second;
  }

  /** Column 0 is 59 s before `nowSecond`, column 59 is `nowSecond`; undefined where nothing was measured. */
  at(column: number, nowSecond = this.latest): Readonly<NetSample> | undefined {
    const wanted = nowSecond - (NET_HISTORY_SECONDS - 1 - column);
    const sample = this.samples[mod(wanted, NET_HISTORY_SECONDS)]!;
    return sample.second === wanted ? sample : undefined;
  }
}

const totalRate = (p: Proc) => p.netRxBps + p.netTxBps;

export interface Cloud {
  proc: Proc;
  /** Stable per-PID order key: clouds sit left to right by key in both renderers. */
  readonly key: number;
  readonly sm: Smoother;
  scale: number;
  presence: number;
  departing: boolean;
  /** Eased position in slot units (0 = leftmost). */
  pos: number;
}

/**
 * The busiest network processes as clouds. Membership (top `limit` by
 * rx + tx bytes/s, rate > 0) is recomputed once per snapshot second; easing
 * runs every frame. Clouds are ordered by a per-PID key, never by rank, so a
 * ranking change never moves a cloud, and the 4 low-res clouds keep the same
 * relative order as the 5 hi-res ones. Joins and departures make neighbors
 * glide aside rather than jump.
 */
export class CloudSlots {
  readonly clouds: Cloud[] = [];
  /** Eased slot count used for spacing: `limit`, or more while a departure overlaps a join. */
  spread: number;
  private second = NaN;
  private readonly sm = new Smoother();

  constructor(readonly limit: number) {
    this.spread = limit;
  }

  /** `tMs` gates the ranking to once per second; omit it to re-rank on every call. */
  update(procs: readonly Proc[], dt: number, tMs?: number): void {
    const second = tMs === undefined ? NaN : Math.floor(tMs / 1000);
    if (!(second === this.second)) {
      this.second = second;
      const top = procs.filter((proc) => totalRate(proc) > 0)
        .sort((a, b) => totalRate(b) - totalRate(a) || a.pid - b.pid)
        .slice(0, this.limit);
      for (const cloud of this.clouds) {
        const proc = top.find(({ pid }) => pid === cloud.proc.pid);
        cloud.departing = proc === undefined;
        if (proc) cloud.proc = proc;
      }
      for (const proc of top) {
        if (this.clouds.some((cloud) => cloud.proc.pid === proc.pid)) continue;
        this.clouds.push({ proc, key: hash(proc.pid, 0, 59), sm: new Smoother(), scale: cloudScale(proc), presence: 0, departing: false, pos: NaN });
      }
      this.clouds.sort((a, b) => a.key - b.key);
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i]!;
      cloud.presence = cloud.departing ? Math.max(0, cloud.presence - dt / 0.3) : Math.min(1, cloud.presence + dt / 0.2);
      if (cloud.departing && cloud.presence === 0) this.clouds.splice(i, 1);
      else cloud.scale = cloud.sm.get("size", cloudScale(cloud.proc), dt);
    }
    const n = this.clouds.length;
    this.spread = this.sm.get("spread", Math.max(this.limit, n), dt);
    // Center the row of clouds in the band, so fewer clouds don't hug the left edge.
    const offset = (this.limit - Math.min(n, this.limit)) / 2;
    for (const [i, cloud] of this.clouds.entries()) {
      cloud.pos = Number.isNaN(cloud.pos) ? i + offset : cloud.sm.get("pos", i + offset, dt);
    }
  }

  /** Cloud center x within a band [left, right). */
  center(cloud: Cloud, left: number, right: number): number {
    return Math.round(left + ((cloud.pos + 0.5) * (right - left)) / this.spread);
  }
}

function cloudScale(proc: Proc): number {
  return 0.6 + 0.6 * netLevel(totalRate(proc));
}

export class NetSky {
  readonly clouds: CloudSlots;
  private readonly sm = new Smoother();
  rxCount = 0;
  txCount = 0;
  rxTravel = 0;
  txTravel = 0;
  beacon = false;
  private clock: number | undefined;
  private beaconPhase = 0;

  constructor(readonly history: NetHistory, cloudLimit: number, private readonly streakLimit: number, private readonly baseSpeed: number) {
    this.clouds = new CloudSlots(cloudLimit);
  }

  update(net: NetThroughput, procs: readonly Proc[], timestamp: number, t: number, dt: number): void {
    const { rxBps, txBps, rxPps, txPps } = net;
    this.clouds.update(rxBps || txBps ? procs : [], dt, timestamp);
    this.rxCount = this.streakCount("rx.count", rxBps, dt);
    this.txCount = this.streakCount("tx.count", txBps, dt);
    // Integrate the eased speeds so a new packet rate changes velocity without jumping lanes.
    const elapsed = this.clock === undefined ? t : Math.min(dt, Math.max(0, t - this.clock));
    this.clock = t;
    this.rxTravel += elapsed * this.baseSpeed * (1 + 2 * this.sm.get("rx.speed", packetLevel(rxPps), dt));
    this.txTravel += elapsed * this.baseSpeed * (1 + 2 * this.sm.get("tx.speed", packetLevel(txPps), dt));
    this.beaconPhase += elapsed * (0.5 + 3 * this.sm.get("beacon", packetLevel(rxPps + txPps), dt));
    this.beacon = this.beaconPhase % 1 < 0.5;
  }

  private streakCount(key: string, bps: number, dt: number): number {
    const count = Math.round(this.streakLimit * this.sm.get(key, netLevel(bps), dt));
    return bps > 0 ? count : 0;
  }
}

/** Bright head and a Bayer-faded tail, shared with the hi-res overworld. */
export function drawPacketStreak(cv: PixelCanvas, head: number, y: number, dir: number, color: Color, length: number): void {
  for (let k = 0; k < length; k++) {
    const x = Math.round(head - dir * k);
    if (k < Math.ceil(length / 4) || k / length < 1 - bayer(x, y)) cv.set(x, y, k === 0 ? P.white : color);
  }
}

export function drawPacketLanes(cv: PixelCanvas, state: NetSky, width: number, tail: number, inbound: readonly number[], outbound: readonly number[]): void {
  const span = width + 2 * tail;
  for (let i = 0; i < state.rxCount; i++) {
    const x = width + tail - ((state.rxTravel + hash(i, 0, 59) * span) % span);
    drawPacketStreak(cv, x, inbound[i % inbound.length]!, -1, P.ok, tail);
  }
  for (let i = 0; i < state.txCount; i++) {
    const x = ((state.txTravel + hash(i, 1, 59) * span) % span) - tail;
    drawPacketStreak(cv, x, outbound[i % outbound.length]!, 1, P.accent, tail);
  }
}

/**
 * Rx (green) and tx (gold, 1 px above so both stay visible at zero) over the
 * last 60 s, right edge = `nowSecond`. Only measured seconds are drawn; a gap
 * breaks the line, and a lone sample is a single dot.
 */
export function drawNetHistory(cv: PixelCanvas, history: NetHistory, nowSecond: number, left: number, right: number, baseline: number, height: number): void {
  let prev: { x: number; rx: number; tx: number } | undefined;
  for (let i = 0; i < NET_HISTORY_SECONDS; i++) {
    const sample = history.at(i, nowSecond);
    if (!sample) {
      prev = undefined;
      continue;
    }
    const x = left + Math.round(((right - left) * i) / (NET_HISTORY_SECONDS - 1));
    const rx = baseline - Math.round(height * netLevel(sample.rx));
    const tx = baseline - 1 - Math.round(height * netLevel(sample.tx));
    if (prev) {
      line(cv, prev.x, prev.rx, x, rx, P.ok);
      line(cv, prev.x, prev.tx, x, tx, P.accent);
    } else {
      cv.set(x, rx, P.ok);
      cv.set(x, tx, P.accent);
    }
    prev = { x, rx, tx };
  }
}
