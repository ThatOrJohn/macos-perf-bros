/**
 * Scene state machine: overworld ⇄ zones, keyboard handling, iris transitions.
 * Renderer-agnostic: draws into a Frame.
 */
import { Frame, PixelCanvas } from "../engine/canvas.ts";
import { H as HI_H, W as HI_W, irisHi } from "../hires/common.ts";
import { drawOverworldHi, hiPos } from "../hires/overworld.ts";
import { drawCpuZoneHi } from "../hires/zones/cpu.ts";
import { drawMemoryZoneHi } from "../hires/zones/memory.ts";
import { drawNetworkZoneHi } from "../hires/zones/network.ts";
import { drawPlaceholderZoneHi } from "../hires/zones/placeholder.ts";
import { PROCESS_LIMIT_HI, drawProcessZoneHi } from "../hires/zones/process.ts";
import { P } from "../engine/palette.ts";
import { Smoother } from "../engine/tween.ts";
import type { Snapshot } from "../core/snapshot.ts";
import type { DrawCtx } from "./common.ts";
import { ZONES, ZONE_ORDER, drawOverworld, zoneLocked, neighbor, newOverworldState, stepPlayer, type ZoneId } from "./overworld.ts";
import { NetHistory, NetSky } from "./net-sky.ts";
import { ProcessField } from "./process-field.ts";
import { drawCpuZone } from "./zones/cpu.ts";
import { drawMemoryZone } from "./zones/memory.ts";
import { drawNetworkZone } from "./zones/network.ts";
import { drawPlaceholderZone } from "./zones/placeholder.ts";
import { PROCESS_LIMIT, drawProcessZone } from "./zones/process.ts";

export type Scene = "overworld" | ZoneId;

const IRIS_S = 0.3;

export class Game {
  scene: Scene = "overworld";
  readonly ow = newOverworldState();
  private readonly sm = new Smoother();
  private readonly processField = new ProcessField(PROCESS_LIMIT);
  private readonly processFieldHi = new ProcessField(PROCESS_LIMIT_HI);
  // Output buffers are reused across frames (no per-frame canvas allocation).
  // A returned Frame / PixelCanvas is valid until the next draw() / drawHi().
  private readonly frame = new Frame();
  private readonly canvasHi = new PixelCanvas(HI_W, HI_H);
  // One throughput history for both renderers, recorded every frame in every
  // scene, so Network Sky's 60 s graph is complete when you walk in.
  private readonly netHistory = new NetHistory();
  private readonly netSky = new NetSky(this.netHistory, 4, 6, 18);
  private readonly netSkyHi = new NetSky(this.netHistory, 5, 14, 60);
  private irisStart = -Infinity;
  private irisCenter = { x: 40, y: 23 };
  private now = 0;

  /**
   * True while something on screen needs the full frame rate: the player
   * walking or an iris transition. Otherwise only ambient animation (stars,
   * smoke, slimes) and 1 Hz data are moving, and the app drops to IDLE_FPS.
   */
  busy(): boolean {
    return this.ow.walking || this.now - this.irisStart < IRIS_S;
  }

  /** Returns "quit" when the app should exit. */
  key(name: string): "quit" | undefined {
    if (name === "q") return "quit";
    if (this.scene === "overworld") {
      const dir: Record<string, [number, number]> = {
        up: [0, -1], k: [0, -1], down: [0, 1], j: [0, 1], left: [-1, 0], h: [-1, 0], right: [1, 0], l: [1, 0],
      };
      const d = dir[name];
      if (d) {
        const next = neighbor(this.ow.selected, d[0], d[1]);
        if (next) this.ow.selected = next;
        return;
      }
      if (name === "return" || name === "enter" || name === "space") return this.enter(this.ow.selected);
    } else if (name === "escape" || name === "backspace") {
      this.go("overworld");
      return;
    }
    const n = Number(name);
    if (n >= 1 && n <= ZONE_ORDER.length) {
      const id = ZONE_ORDER[n - 1]!;
      this.ow.selected = id;
      this.ow.player = { x: ZONES[id].x, y: ZONES[id].y };
      return this.enter(id);
    }
  }

  private enter(id: ZoneId): undefined {
    this.irisCenter = { x: ZONES[id].x, y: ZONES[id].y };
    this.go(id);
    return undefined;
  }

  private go(scene: Scene): void {
    if (scene === this.scene) return;
    if (scene === "overworld") this.irisCenter = { x: this.ow.player.x, y: this.ow.player.y };
    this.scene = scene;
    this.irisStart = this.now;
  }

  /** Feed scene-independent history (once per snapshot second; cheap otherwise). */
  private record(snap: Snapshot): void {
    if (snap.net) this.netHistory.record(snap.t, snap.net.rxBps, snap.net.txBps);
  }

  /** Advance animation state once per frame (shared by both renderers). */
  private tick(t: number, dt: number): void {
    this.now = t;
    stepPlayer(this.ow, dt);
  }

  /** Low-res (80×46 half-block) frame. */
  draw(snap: Snapshot, t: number, dt: number): Frame {
    this.tick(t, dt);
    this.record(snap);
    const f = this.frame.reset();
    const ctx: DrawCtx = { snap, t, dt, sm: this.sm };
    switch (this.scene) {
      case "overworld": drawOverworld(f, ctx, this.ow); break;
      case "cpu": drawCpuZone(f, ctx); break;
      case "mem": drawMemoryZone(f, ctx); break;
      case "net": drawNetworkZone(f, ctx, this.netSky, snap.net); break;
      case "proc": drawProcessZone(f, ctx, this.processField); break;
      default: drawPlaceholderZone(f, ctx, ZONES[this.scene].name, zoneLocked(this.scene, snap));
    }
    this.iris(f, t);
    return f;
  }

  /** Hi-res (320×192) frame for pixel-image terminals. */
  drawHi(snap: Snapshot, t: number, dt: number): PixelCanvas {
    this.tick(t, dt);
    this.record(snap);
    const cv = this.canvasHi;
    cv.px.fill(0);
    const ctx: DrawCtx = { snap, t, dt, sm: this.sm };
    switch (this.scene) {
      case "overworld": drawOverworldHi(cv, ctx, this.ow); break;
      case "cpu": drawCpuZoneHi(cv, ctx); break;
      case "mem": drawMemoryZoneHi(cv, ctx); break;
      case "net": drawNetworkZoneHi(cv, ctx, this.netSkyHi, snap.net); break;
      case "proc": drawProcessZoneHi(cv, ctx, this.processFieldHi); break;
      default: drawPlaceholderZoneHi(cv, ctx, ZONES[this.scene].name, zoneLocked(this.scene, snap));
    }
    const k = (t - this.irisStart) / IRIS_S;
    if (k >= 0 && k < 1) {
      const c = hiPos(this.irisCenter);
      irisHi(cv, c.x, c.y - 20, k);
    }
    return cv;
  }

  /** Circle wipe opening from the zone/player position. */
  private iris(f: Frame, t: number): void {
    const k = (t - this.irisStart) / IRIS_S;
    if (k >= 1 || k < 0) return;
    const r = k * k * 95;
    const { x: cx, y: cy } = this.irisCenter;
    const cv = f.canvas;
    for (let y = 0; y < cv.h; y++) {
      for (let x = 0; x < cv.w; x++) if (Math.hypot(x - cx, (y - cy) * 1) > r) cv.set(x, y, P.ink);
    }
    // keep the HUD, hide in-scene text until the iris has opened
    const hud = f.texts.filter((tx) => tx.row === 0);
    f.texts.length = 0;
    f.texts.push(...hud);
  }
}
