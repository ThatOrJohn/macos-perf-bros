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

interface NetSample { rx: number; tx: number }

export class NetHistory {
  private readonly samples: NetSample[] = Array.from({ length: NET_HISTORY_SECONDS }, () => ({ rx: 0, tx: 0 }));
  private second = -Infinity;
  private next = 0;
  size = 0;

  record(t: number, rx: number, tx: number): void {
    const second = Math.floor(t / 1000);
    if (second === this.second) return;
    this.second = second;
    const sample = this.samples[this.next]!;
    sample.rx = rx;
    sample.tx = tx;
    this.next = (this.next + 1) % NET_HISTORY_SECONDS;
    this.size = Math.min(this.size + 1, NET_HISTORY_SECONDS);
  }

  /** Oldest on the left. Pad uncollected history with the first sample. */
  at(column: number): Readonly<NetSample> {
    const age = Math.min(NET_HISTORY_SECONDS - 1 - column, Math.max(0, this.size - 1));
    return this.samples[(this.next - 1 - age + NET_HISTORY_SECONDS) % NET_HISTORY_SECONDS]!;
  }
}

const totalRate = (p: Proc) => p.netRxBps + p.netTxBps;

interface Cloud {
  proc: Proc;
  readonly sm: Smoother;
  scale: number;
  presence: number;
  departing: boolean;
}

/** The slot array owns the clouds, including departures until their fade ends. */
export class CloudSlots {
  readonly slots: (Cloud | undefined)[];

  constructor(limit: number) {
    this.slots = Array.from({ length: limit });
  }

  update(procs: readonly Proc[], dt: number): void {
    const { slots } = this;
    const top = procs.filter((proc) => totalRate(proc) > 0)
      .sort((a, b) => totalRate(b) - totalRate(a) || a.pid - b.pid)
      .slice(0, slots.length);

    for (const [i, cloud] of slots.entries()) {
      if (!cloud) continue;
      const proc = top.find(({ pid }) => pid === cloud.proc.pid);
      cloud.departing = proc === undefined;
      if (proc) {
        cloud.proc = proc;
        cloud.scale = cloud.sm.get("size", cloudScale(proc), dt);
        cloud.presence = Math.min(1, cloud.presence + dt / 0.2);
      } else {
        cloud.presence = Math.max(0, cloud.presence - dt / 0.3);
        if (cloud.presence === 0) slots[i] = undefined;
      }
    }

    for (const proc of top) {
      if (slots.some((cloud) => cloud?.proc.pid === proc.pid)) continue;
      const preferred = Math.floor(hash(proc.pid, 0, 59) * slots.length);
      for (let offset = 0; offset < slots.length; offset++) {
        const slot = (preferred + offset) % slots.length;
        if (slots[slot]) continue;
        const sm = new Smoother();
        slots[slot] = { proc, sm, scale: sm.get("size", cloudScale(proc), dt), presence: Math.min(1, dt / 0.2), departing: false };
        break;
      }
    }
  }
}

function cloudScale(proc: Proc): number {
  return 0.6 + 0.6 * netLevel(totalRate(proc));
}

export class NetSky {
  readonly history = new NetHistory();
  readonly clouds: CloudSlots;
  private readonly sm = new Smoother();
  rxCount = 0;
  txCount = 0;
  rxTravel = 0;
  txTravel = 0;
  beacon = false;
  private clock: number | undefined;
  private beaconPhase = 0;

  constructor(cloudLimit: number, private readonly streakLimit: number, private readonly baseSpeed: number) {
    this.clouds = new CloudSlots(cloudLimit);
  }

  update(net: NetThroughput, procs: readonly Proc[], timestamp: number, t: number, dt: number): void {
    const { rxBps, txBps, rxPps, txPps } = net;
    this.history.record(timestamp, rxBps, txBps);
    this.clouds.update(rxBps || txBps ? procs : [], dt);
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

export function drawNetHistory(cv: PixelCanvas, history: NetHistory, left: number, right: number, baseline: number, height: number): void {
  const first = history.at(0);
  let lastX = left;
  let lastRx = baseline - Math.round(height * netLevel(first.rx));
  let lastTx = baseline - 1 - Math.round(height * netLevel(first.tx));
  // Adjacent zero baselines keep both directions visible when resting at zero.
  for (let i = 1; i < NET_HISTORY_SECONDS; i++) {
    const sample = history.at(i);
    const x = left + Math.round((right - left) * i / (NET_HISTORY_SECONDS - 1));
    const rx = baseline - Math.round(height * netLevel(sample.rx));
    const tx = baseline - 1 - Math.round(height * netLevel(sample.tx));
    line(cv, lastX, lastRx, x, rx, P.ok);
    line(cv, lastX, lastTx, x, tx, P.accent);
    lastX = x;
    lastRx = rx;
    lastTx = tx;
  }
}
