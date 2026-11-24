/**
 * Scene state machine: overworld ⇄ zones, keyboard handling, iris transitions.
 * Renderer-agnostic: draws into a Frame.
 */
import { Frame, PixelCanvas } from "../engine/canvas.ts";
import { H as HI_H, W as HI_W, drawHelpPanelHi, drawHudHi, irisHi } from "../hires/common.ts";
import { drawOverworldHi, hiPos } from "../hires/overworld.ts";
import { drawTableHi } from "../hires/table.ts";
import { drawCpuZoneHi } from "../hires/zones/cpu.ts";
import { drawDiskZoneHi } from "../hires/zones/disk.ts";
import { drawMemoryZoneHi } from "../hires/zones/memory.ts";
import { drawNetworkZoneHi } from "../hires/zones/network.ts";
import { drawPowerZoneHi } from "../hires/zones/power.ts";
import { drawProcessZoneHi } from "../hires/zones/process.ts";
import { P } from "../engine/palette.ts";
import { Smoother } from "../engine/tween.ts";
import type { Snapshot } from "../core/snapshot.ts";
import { drawTable, pageCount, type Row } from "../ui/table.ts";
import { drawHelpPanel, drawHud, type DrawCtx } from "./common.ts";
import { DiskMines } from "./disk-mines.ts";
import { ZONES, ZONE_ORDER, drawOverworld, neighbor, newOverworldState, stepPlayer, tableRows as overworldRows, type ZoneId } from "./overworld.ts";
import { NETWORK_CLOUD_LIMIT_HI, NetHistory, NetSky } from "./net-sky.ts";
import { PowerPlant } from "./power-plant.ts";
import { PROCESS_LIMIT_HI, ProcessField } from "./process-field.ts";
import { drawCpuZone, tableRows as cpuRows } from "./zones/cpu.ts";
import { drawDiskZone, tableRows as diskRows } from "./zones/disk.ts";
import { drawMemoryZone, tableRows as memoryRows } from "./zones/memory.ts";
import { drawNetworkZone, tableRows as networkRows } from "./zones/network.ts";
import { drawPowerZone, tableRows as powerRows } from "./zones/power.ts";
import { PROCESS_LIMIT, drawProcessZone, tableRows as processRows } from "./zones/process.ts";

export type Scene = "overworld" | ZoneId;

const IRIS_S = 0.3;

export class Game {
  scene: Scene = "overworld";
  readonly ow = newOverworldState();
  private readonly sm = new Smoother();
  private readonly processField = new ProcessField(PROCESS_LIMIT);
  private readonly processFieldHi = new ProcessField(PROCESS_LIMIT_HI);
  private readonly diskMines = new DiskMines();
  private readonly diskMinesHi = new DiskMines();
  private readonly powerPlant = new PowerPlant();
  private readonly powerPlantHi = new PowerPlant();
  // Output buffers are reused across frames (no per-frame canvas allocation).
  // A returned Frame / PixelCanvas is valid until the next draw() / drawHi().
  private readonly frame = new Frame();
  private readonly canvasHi = new PixelCanvas(HI_W, HI_H);
  // One throughput history for both renderers, recorded every frame in every
  // scene, so Network Sky's 60 s graph is complete when you walk in.
  private readonly netHistory = new NetHistory();
  private readonly netSky = new NetSky(4, 6, 18);
  private readonly netSkyHi = new NetSky(NETWORK_CLOUD_LIMIT_HI, 14, 60);
  private displayedSnap: Snapshot | undefined;
  private pausedHistory: NetHistory | undefined;
  private paused = false;
  private help = false;
  private boring = false;
  private tablePage = 0;
  private tablePages = 1;
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
    if (name === "p") {
      this.paused = !this.paused;
      if (this.paused && this.displayedSnap) this.pausedHistory ??= this.netHistory.copy();
      return;
    }
    if (name === "?") {
      this.help = !this.help;
      return;
    }
    if (this.help) {
      if (name === "escape" || name === "backspace") this.help = false;
      return;
    }
    if (name === "b") {
      this.boring = !this.boring;
      this.irisStart = -Infinity;
      return;
    }
    if (this.boring && (name === "pageup" || name === "pagedown")) {
      const next = this.tablePage + (name === "pageup" ? -1 : 1);
      this.tablePage = Math.max(0, Math.min(this.tablePages - 1, next));
      return;
    }
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
    this.irisStart = this.boring ? -Infinity : this.now;
    this.tablePage = 0;
    this.tablePages = 1;
  }

  private tableRows(snap: Snapshot): Row[] {
    switch (this.scene) {
      case "overworld": return overworldRows(snap, this.ow.selected);
      case "cpu": return cpuRows(snap);
      case "mem": return memoryRows(snap);
      case "net": return networkRows(snap, this.displayedHistory);
      case "disk": return diskRows(snap);
      case "proc": return processRows(snap);
      case "power": return powerRows(snap);
    }
  }

  private currentTable(snap: Snapshot): { title: string; rows: Row[]; page: number } {
    const rows = this.tableRows(snap);
    this.tablePages = pageCount(rows);
    this.tablePage = Math.min(this.tablePage, this.tablePages - 1);
    const title = this.scene === "overworld" ? "OVERWORLD" : ZONES[this.scene].name;
    return { title, rows, page: this.tablePage };
  }

  private get displayedHistory(): NetHistory {
    return this.pausedHistory ?? this.netHistory;
  }

  /** Continue recording live history even when the display is frozen. */
  private displaySnapshot(snap: Snapshot): Snapshot {
    if (snap.net) this.netHistory.record(snap.t, snap.net.rxBps, snap.net.txBps);
    if (!this.paused || !this.displayedSnap) {
      this.displayedSnap = snap;
      this.pausedHistory = this.paused ? this.netHistory.copy() : undefined;
    }
    return this.displayedSnap;
  }

  /** Advance animation state once per frame (shared by both renderers). */
  private tick(t: number, dt: number): void {
    this.now = t;
    stepPlayer(this.ow, dt);
  }

  /** Low-res (80×46 half-block) frame. */
  draw(live: Snapshot, t: number, dt: number): Frame {
    this.tick(t, dt);
    const snap = this.displaySnapshot(live);
    const f = this.frame.reset();
    if (this.boring) {
      const { title, rows, page } = this.currentTable(snap);
      drawTable(f, snap, title, rows, page);
    } else {
      const ctx: DrawCtx = { snap, t, dt, sm: this.sm };
      switch (this.scene) {
        case "overworld": drawOverworld(f, ctx, this.ow); break;
        case "cpu": drawCpuZone(f, ctx); break;
        case "mem": drawMemoryZone(f, ctx); break;
        case "net": drawNetworkZone(f, ctx, this.netSky, this.displayedHistory, snap.net); break;
        case "disk": drawDiskZone(f, ctx, this.diskMines); break;
        case "proc": drawProcessZone(f, ctx, this.processField); break;
        case "power": drawPowerZone(f, ctx, this.powerPlant); break;
      }
      this.iris(f, t);
    }
    if (this.paused) {
      let kept = 0;
      for (const run of f.texts) if (run.row !== 0) f.texts[kept++] = run;
      f.texts.length = kept;
      drawHud(f, snap, true);
    }
    if (this.help) drawHelpPanel(f, this.scene);
    return f;
  }

  /** Hi-res (320×192) frame for pixel-image terminals. */
  drawHi(live: Snapshot, t: number, dt: number): PixelCanvas {
    this.tick(t, dt);
    const snap = this.displaySnapshot(live);
    const cv = this.canvasHi;
    if (this.boring) {
      const { title, rows, page } = this.currentTable(snap);
      drawTableHi(cv, snap, title, rows, page);
    } else {
      cv.px.fill(0);
      const ctx: DrawCtx = { snap, t, dt, sm: this.sm };
      switch (this.scene) {
        case "overworld": drawOverworldHi(cv, ctx, this.ow); break;
        case "cpu": drawCpuZoneHi(cv, ctx); break;
        case "mem": drawMemoryZoneHi(cv, ctx); break;
        case "net": drawNetworkZoneHi(cv, ctx, this.netSkyHi, this.displayedHistory, snap.net); break;
        case "disk": drawDiskZoneHi(cv, ctx, this.diskMinesHi); break;
        case "proc": drawProcessZoneHi(cv, ctx, this.processFieldHi); break;
        case "power": drawPowerZoneHi(cv, ctx, this.powerPlantHi); break;
      }
      const k = (t - this.irisStart) / IRIS_S;
      if (k >= 0 && k < 1) {
        const c = hiPos(this.irisCenter);
        irisHi(cv, c.x, c.y - 20, k);
      }
    }
    if (this.paused) drawHudHi(cv, snap, true);
    if (this.help) drawHelpPanelHi(cv, this.scene);
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
