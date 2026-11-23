# macos-perf-bros — Design

A terminal system monitor for Apple Silicon Macs, presented as a retro side-scrolling platformer. The machine's subsystems are zones on an overworld map. Walk to one and enter it to see that subsystem in detail. Built with [OpenTUI](https://github.com/sst/opentui).

> Status: design only. No code yet.

---

## 1. Goals and non-goals

**Goals**
- Show the whole machine's health at a glance from one overworld screen.
- Let the user zoom in: overworld → zone → entity (a core, a process, a connection).
- Every visual element encodes a real metric. The game layer exists for glanceability, not decoration.
- Stay cheap to run. A monitor that loads the machine is a bad joke.

**Non-goals (for now)**
- Taking actions on the system (kill, renice). Planned for later (see §10), but v1 is **observe-only**.
- Intel Macs, Linux, or Windows. **Apple Silicon only.**
- Historical storage or long-term graphs beyond a short in-memory window.

## 2. Design principles

1. **The number is always available.** A persistent HUD shows key figures. Any focused sprite shows its label and value. The metaphor is never the only way to read a metric.
2. **Sample slowly, animate fast.** Collect data at 1 Hz, render at about 30 fps, and tween between samples.
3. **Boring mode.** One key (`b`) flips the current zone into a plain table of the same data.
4. **Original art.** The platformer genre is fair game (overworld maps, pipes, coins, bosses). Characters, tiles, and palettes are our own, with no sprites or look-alikes from existing games.
5. **The UI never runs as root.** Only the sampler process is privileged.

## 3. Platform and constraints

| Item | Decision |
|---|---|
| Hardware | Apple Silicon (M1 and later). Core topology is read at runtime, never hard-coded. |
| Runtime | Bun + TypeScript, using OpenTUI (native Zig render core). |
| Privilege | `sudo` is acceptable, but only for `powermetrics`. |
| Terminal | Truecolor required. Minimum size 80×24; layouts scale up from there. |

## 4. Architecture

```
                ┌────────────────────── collectors ───────────────────────┐
sudo powermetrics ──► PowermetricsCollector (plist stream, NUL-delimited) ─┐
vm_stat / sysctl ───► MemoryCollector ─────────────────────────────────────┤
sysctl hw.* ────────► TopologyCollector (once at startup) ─────────────────┼─► SnapshotBus ─┬─► UI store ─► OpenTUI renderer
nettop ─────────────► NetConnCollector ────────────────────────────────────┤   (1 Hz)       │
ps / lsof ──────────► EntityDetailCollector (on demand only) ──────────────┘                └─► Recorder ⇄ .ndjson replay files
```

- **Collectors** own all macOS-specific plumbing. Each one emits a partial snapshot.
- **SnapshotBus** merges the partials into one typed `Snapshot` per tick, stamped with a timestamp.
- **The `Snapshot` type is the main boundary.** Everything downstream (UI, game logic, recorder) is platform-agnostic and can run entirely from replay files.
- **Entity details** (open files, sockets, threads) are expensive, so they're fetched only while an entity is focused.

### 4.1 Process model

```
perf-bros (user)  ──spawn──►  sudo -n /usr/bin/powermetrics ...   (root)
      │
      └── all other collectors run as the user
```

Startup sequence:
1. Before entering the alternate screen, run `sudo -v` so the password prompt appears as a normal terminal prompt.
2. Spawn `sudo -n powermetrics …` as a child process and parse its stdout.
3. If sudo fails or is declined, continue in **degraded mode**: the GPU, power, and thermal zones render as "locked" tiles, and everything else works.
4. On exit, signal the child and confirm it's gone.

Optional later: document a sudoers entry scoped to `/usr/bin/powermetrics` with NOPASSWD.

## 5. Data sources

| Domain | Source | Privileged | Notes |
|---|---|---|---|
| CPU per-cluster freq + residency | `powermetrics` `cpu_power` | yes | E- and P-clusters reported separately |
| CPU per-core residency | `powermetrics` `cpu_power` | yes | |
| CPU / GPU / ANE / package power | `powermetrics` `cpu_power`, `gpu_power` | yes | |
| GPU freq + active residency | `powermetrics` `gpu_power` | yes | |
| Thermal pressure | `powermetrics` `thermal` | yes | nominal / moderate / heavy / critical |
| Per-process CPU, wakeups, energy | `powermetrics` `tasks` | yes | Feeds Process Plains |
| Network throughput (system) | `powermetrics` `network` | yes | |
| Disk throughput (system) | `powermetrics` `disk` | yes | |
| Battery | `powermetrics` `battery` or `pmset -g batt` / `ioreg` | mixed | |
| Memory used / wired / compressed | `vm_stat`, `sysctl hw.memsize` | no | |
| Swap | `sysctl vm.swapusage` | no | |
| Memory pressure | `sysctl kern.memorystatus_vm_pressure_level` or `memory_pressure` | no | |
| Core topology | `sysctl hw.perflevel0.*`, `hw.perflevel1.*` | no | Read once |
| Per-process network | `nettop -P -L 1 -J …` | no | |
| Process detail | `ps`, `lsof -p` | no | On demand |
| Uptime, load | `sysctl kern.boottime`, `vm.loadavg` | no | |

> Exact `powermetrics` plist key names vary by macOS version and chip. Phase 1 starts by capturing real output on the dev machine and checking it into `fixtures/` before the parser is written.

Base command:

```
sudo powermetrics -f plist -i 1000 \
  --samplers cpu_power,gpu_power,thermal,tasks,network,disk,battery \
  --show-process-energy
```

### 5.1 Possible later migration

If spawning shell commands costs too much or proves brittle (for example `vm_stat` parsing, or `nettop`), replace those collectors with a small native helper (Swift or Zig) that calls `host_statistics64`, `libproc`, and similar APIs directly and emits NDJSON. The `Snapshot` boundary means the UI doesn't change.

## 6. Snapshot schema (sketch)

```ts
interface Snapshot {
  t: number;                       // ms epoch
  privileged: boolean;             // false = degraded mode
  topology: { eCores: number; pCores: number; gpuCores?: number; chip: string };
  cpu: {
    clusters: { kind: "E" | "P"; freqMHz: number; activePct: number }[];
    cores:    { id: number; kind: "E" | "P"; activePct: number }[];
    loadAvg: [number, number, number];
  };
  gpu?:   { freqMHz: number; activePct: number };
  power?: { cpuW: number; gpuW: number; aneW: number; packageW: number };
  thermal?: { pressure: "nominal" | "moderate" | "heavy" | "critical" };
  memory: {
    totalB: number; usedB: number; wiredB: number; compressedB: number; cachedB: number;
    swapUsedB: number; swapTotalB: number;
    pressure: "normal" | "warn" | "critical";
  };
  net:  { rxBps: number; txBps: number; conns?: NetConn[] };
  disk: { readBps: number; writeBps: number; volumes?: Volume[] };
  battery?: { pct: number; charging: boolean; cycles?: number; healthPct?: number };
  procs: Proc[];                   // top N by CPU/energy, N ≈ 30
  uptimeS: number;
}

interface Proc { pid: number; name: string; cpuPct: number; rssB?: number; energy?: number; wakeups?: number }
```

Fields marked optional are missing in degraded mode or when the source doesn't report them. The UI must render sensibly in either case.

## 7. World design

### 7.1 HUD (always visible, top row)

```
♥♥♥♡ 82%  │  ⏱ 3d04h  │  CPU 34%  MEM 71%  │  ↓12.0M ↑1.1M  │  ⚡ 9.4W  │  🌡 NOMINAL
```

Battery is shown as hearts. Every value here is the literal number.

### 7.2 Overworld

A tile map of zones connected by paths. The player sprite walks between zones with the arrow keys or `hjkl`, and `Enter` enters a zone. Each zone tile animates to reflect its live state, so the overworld works as the dashboard.

| Zone | Tile state at a glance |
|---|---|
| **CPU Fortress** | Smoke from the towers scales with total CPU; flags flap faster with frequency |
| **Memory Reservoir** | Water level = used; water color = pressure |
| **Network Sky** | Cloud density = throughput |
| **Disk Mines** | Mine-cart traffic at the entrance = I/O |
| **Process Plains** | Number and size of wandering enemies = process activity |
| **Power Plant** | Chimney glow = package watts; lava at the base = thermal pressure |

### 7.3 Zones (level view)

**CPU Fortress**
- Two wings: the **E-cluster** and the **P-cluster**, drawn with different block tiles.
- One pillar per core. Pillar height = active residency %.
- Each wing has a flag whose height = cluster frequency as a fraction of its max.
- Short history: pillars leave a fading trail for the last ~10 samples.

**Memory Reservoir**
- One tank. Stacked water layers: wired (dark), app/used (mid), compressed (striped), cached (light).
- Water tint follows pressure: green, then yellow, then red.
- An overflow pipe drains into an underground **swap cistern**. Its fill = swap used.
- Unified memory: the GPU draws from the same tank. That's accurate on Apple Silicon and worth showing.

**Network Sky**
- Particles cross the sky: inbound flies right-to-left, outbound left-to-right. Density = bytes/sec on a log scale.
- Zoomed in: each active connection is a named cloud (process + remote host), sized by throughput.

**Disk Mines**
- Two rail lines underground: read and write. Cart frequency and speed = throughput.
- Each mounted volume is a shaft whose depth fill = capacity used.

**Process Plains**
- Each top process is an enemy sprite. Size = RSS, walk speed = CPU%, glow = energy impact.
- The top consumer is the **boss**, with a health bar showing its CPU%.
- Sprite archetypes come from a small set keyed by process category (app, daemon, kernel_task, dev tool) to keep the art budget small.

**Power Plant**
- Three generators: CPU, GPU, and ANE. Turbine speed = watts.
- Lava level at the base = thermal pressure state.
- The GPU foundry lives here too: furnace brightness = GPU active %, with frequency shown as a gauge.

### 7.4 Entity view

Focusing an entity in a zone (with `Tab` or arrow keys) highlights it and shows a one-line label. `Enter` opens a **detail card** overlay:

- **Process:** pid, ppid, user, CPU, RSS, energy, wakeups, thread count, open files (top N), sockets.
- **Core:** id, cluster, residency history sparkline.
- **Connection:** process, local and remote endpoints, state, throughput.

`Esc` backs out one level: card → zone → overworld.

## 8. Controls

| Key | Action |
|---|---|
| ←↑→↓ / `hjkl` | Move on the overworld; move focus inside a zone |
| `Enter` | Enter a zone, or open the detail card for the focused entity |
| `Esc` | Back out one level |
| `Tab` / `Shift-Tab` | Cycle focus between entities in a zone |
| `1`–`6` | Jump straight to a zone |
| `b` | Toggle boring mode (table view) |
| `p` | Pause sampling (freeze frame) |
| `?` | Help overlay |
| `q` | Quit |

## 9. Rendering

- **Pixel canvas:** half-block characters (`▀` with separate foreground and background colors), so each terminal cell is 1×2 pixels. 80×24 cells gives an 80×46 pixel playfield below the HUD.
- **Sprites and tiles:** defined in TypeScript as palette-indexed arrays, mostly 8×8, with players and bosses at 8×16. One shared palette module, plus a high-contrast variant.
- **Layers:** background tiles → data-driven terrain → sprites → particles → labels → overlays (cards, help).
- **Camera:** zone levels can be wider than the terminal. The camera follows focus. Zoom transitions use a short iris-in/iris-out wipe (about 250 ms).
- **Tweening:** each metric-bound property eases from its previous value to the new one over the sample interval.
- **Scales:** throughput uses log scales; percentages are linear. Scale bounds live in one config module.
- **Resize:** layouts recompute on terminal resize. Below the minimum size, show a "make it bigger" screen.

### 9.1 Performance budget

| Item | Budget |
|---|---|
| Render loop | ≤ 30 fps; drop to ~5 fps when nothing is animating |
| Total CPU (UI + collectors, excluding `powermetrics`) | < 3% of one P-core at steady state |
| Memory | < 150 MB RSS |
| Sample interval | 1000 ms (configurable) |

The app's own process should appear in Process Plains. If it ever becomes the boss, that's a bug.

## 10. Future: interactivity

v1 is observe-only. The design reserves room for actions without touching the read-only path:

- **Focus is a first-class concept from day one.** Any future action targets the focused entity.
- **A separate action broker module** will execute commands (`kill`, `renice`, and so on), every one behind a confirm prompt:
  `Stomp "Xcode" (pid 812, 4.1 GB)? [y/N]`
- Collectors stay read-only forever. The broker never runs as root unless a specific action requires it, and then only with an explicit sudo prompt.
- Game framing: stomping an enemy = terminate (SIGTERM, with SIGKILL as a second confirmed step); a "power-down" item = lower priority.

## 11. Record and replay

- `perf-bros --record session.ndjson` writes each merged `Snapshot` as one line.
- `perf-bros --replay session.ndjson [--speed 2]` drives the UI from a file, with no sudo and no live collectors.
- `fixtures/` holds hand-edited and synthetic scenarios (CPU on fire, a swap storm, a network burst, a thermal throttle) for developing visuals and for demos.
- UI tests render frames from fixtures and compare them against snapshot buffers.

## 12. Project layout (proposed)

```
src/
  collectors/      powermetrics.ts, memory.ts, topology.ts, nettop.ts, procDetail.ts
  core/            snapshot.ts (types), bus.ts, recorder.ts, replay.ts, privilege.ts
  engine/          canvas.ts (half-block), sprite.ts, tilemap.ts, camera.ts, tween.ts, palette.ts
  world/           overworld.ts, hud.ts, zones/{cpu,memory,network,disk,process,power}.ts
  ui/              detailCard.ts, boringMode.ts, help.ts
  art/             sprites/*.ts, tiles/*.ts
  main.ts
fixtures/          raw powermetrics captures, synthetic .ndjson scenarios
```

## 13. Phases

1. **Data:** capture real `powermetrics` output into fixtures; define the `Snapshot` types; write the powermetrics parser, memory and topology collectors, and privilege handling; build record/replay.
2. **Engine:** the half-block canvas, sprites, tilemaps, camera, tweening, and the HUD, plus a frame-render test harness.
3. **Overworld:** all six zone tiles driven by live data, with navigation and zone entry/exit transitions.
4. **First zones:** CPU Fortress and Memory Reservoir, plus boring mode.
5. **Remaining zones:** Network Sky, Disk Mines, Process Plains, and Power Plant.
6. **Entity view:** focus, detail cards, and on-demand detail collectors.
7. **Later:** the action broker and stomp mechanic.

## 14. Open questions

- What's the right top-N process count for the plains before it gets visually noisy (20? 30?)?
- Is `nettop` reliable and cheap enough at 1 Hz, or should per-connection data be sampled only while you're in Network Sky?
- How do we show per-process GPU usage, which `powermetrics` doesn't give cleanly?
- What's the art direction: palette size, and whether to have a recognizable "player" character as the app's mascot?
- How should distribution work (`bun build --compile` single binary, Homebrew tap)?
