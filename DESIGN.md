# macos-perf-bros — Design

A terminal system monitor for Apple Silicon Macs, presented as a retro side-scrolling platformer. The machine's subsystems are zones on an overworld map. Walk to one and enter it to see that subsystem in detail. Built with [OpenTUI](https://github.com/sst/opentui).

> Status (2026-11-23): phase 1 done, plus the overworld, CPU Fortress and Memory Reservoir in both renderers. What's next and how to pick up work: [docs/ROADMAP.md](docs/ROADMAP.md). Rules for contributors (human or agent): [AGENTS.md](AGENTS.md). Visual style: [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md).

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
| Terminal | Truecolor required. Minimum 80×24. Terminals with the Kitty graphics protocol (Ghostty, Kitty, WezTerm) get the hi-res renderer; everything else gets half-blocks (§9). |

## 4. Architecture

```
sudo powermetrics ──► collectors/powermetrics-process.ts (plist stream) ──┐
Mach host_processor_info (FFI) ──► collectors/hostcpu.ts (degraded CPU) ──┤
vm_stat / sysctl ──► collectors/system.ts readMemory (1 Hz) ──────────────┼─► core/bus.ts SnapshotBus ─► core/live.ts (SnapshotSource)
ps ──► collectors/system.ts readPs (every 2 s, RSS join) ─────────────────┤                                   │
sysctl hw.* / kern.boottime ──► topology, boot time (once) ───────────────┘                                   ▼
                                                     fixtures / .ndjson ──► core/replay.ts, core/recorder.ts ─► world/game.ts
                                                                                                                │
                                                          ┌─────────────────────────────────────────────────────┴──────┐
                                                          ▼                                                            ▼
                                     src/world/** → Frame (80×46 half-block)              src/hires/** → PixelCanvas (320×192)
                                     engine/present-opentui.ts                             engine/present-image.ts (Kitty/Sixel)
```

Not built yet: per-connection network (`nettop`) and entity detail (`lsof`, on demand).

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
3. If sudo fails or is declined, continue in **degraded mode**: per-core CPU comes from Mach `host_processor_info` via Bun FFI (no frequencies), memory and processes still work, and GPU, power, thermal, network and disk are unavailable. Locked-tile visuals for that state are a roadmap task.
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

> `powermetrics` plist key names vary by macOS version and chip. The verified paths, units and gotchas for M1 on macOS 27 are in [`fixtures/README.md`](fixtures/README.md). Notable: `gpu.freq_hz` is really MHz, power is in mW, `tasks[]` has no RSS or GPU time, and `battery.percent_charge` is 0 (not missing) on Macs without a battery.

Base command:

```
sudo powermetrics -f plist -i 1000 \
  --samplers cpu_power,gpu_power,thermal,tasks,network,disk,battery \
  --show-process-energy
```

### 5.1 Possible later migration

If spawning shell commands costs too much or proves brittle (for example `vm_stat` parsing, or `nettop`), replace those collectors with a small native helper (Swift or Zig) that calls `host_statistics64`, `libproc`, and similar APIs directly and emits NDJSON. The `Snapshot` boundary means the UI doesn't change.

## 6. Snapshot schema (sketch)

> The source of truth is now [`src/core/snapshot.ts`](src/core/snapshot.ts). Units downstream of collectors: percent 0–100, MHz, watts, bytes/s.

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
- The top twelve processes by CPU in hi-res and six in half-block appear as slimes in a fenced dusk meadow. A slime keeps its slot and color by PID while ranked. New entries grow in and departures shrink away.
- Slime size follows RSS buckets below 100 MB, below 1 GB, and 1 GB or more. Unknown RSS uses the middle size and a dash. Higher CPU means faster hops. Energy impact above 100 gives the slime a gold halo and an energy readout.
- The top consumer becomes the **boss** above 50% CPU. Its health bar fills at 100% of one core, and the label shows the full CPU percentage, including multicore usage.
- Slime labels show rank, CPU, and RSS. The leaderboard shows the top eight names in hi-res and five in half-block, plus idle wakeups per second summed across the displayed slimes.

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

There are two renderers. **Every scene must be implemented in both.**

| | Hi-res | Half-block fallback |
|---|---|---|
| Used when | The terminal supports Kitty graphics (or Sixel) | Everything else, or `--renderer blocks` |
| Resolution | 320×192 pixel image, integer pre-scaled | 80×46 pixels (80×24 cells, `▀` with fg/bg) |
| Code | `src/hires/**` → `PixelCanvas` | `src/world/**` → `Frame` (canvas plus text runs) |
| Presenter | `engine/present-image.ts` (OpenTUI `ImageRenderable` + `NativeImagePool`) | `engine/present-opentui.ts` |
| Text | 5×7 pixel font drawn into the image (`engine/font5x7.ts`) | Real terminal text over the pixels |

- **Shared:** scene state, navigation and smoothing live in `world/game.ts`, which calls `draw()` (lo) or `drawHi()` (hi). Hi-res positions on the overworld come from low-res ones through `hiPos()`.
- **Style:** NES-era pixel craft. Ink outlines (`engine/paint.ts` `outlined()`), light from the top-left, ordered-dither gradients instead of smooth ones, and one palette. See [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md).
- **Transitions:** a 0.3 s iris wipe on entering or leaving a zone.
- **Tweening:** `engine/tween.ts` `Smoother`. Every metric-bound value goes through `ctx.sm.get(key, target, dt)`.
- **Scales:** throughput uses log scales; percentages are linear.
- **Resize:** low-res scales by whole numbers and centers; hi-res fits the image. Below 80×24, a "make it bigger" message.
- **Review stills:** `bun run stills` writes PNGs of every scene in both renderers to `docs/stills/`.

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

## 12. Project layout

```
src/
  collectors/   plist.ts, powermetrics.ts (parse), powermetrics-process.ts (spawn),
                memory.ts (parse), system.ts (sysctl/vm_stat/ps), hostcpu.ts (FFI)
  core/         snapshot.ts (types), bus.ts, live.ts, replay.ts, recorder.ts, privilege.ts
  engine/       canvas.ts, palette.ts, paint.ts, font5x7.ts, tween.ts, png.ts,
                present-opentui.ts, present-image.ts
  world/        game.ts (scene state machine), common.ts, overworld.ts, zones/*.ts   ← low-res
  hires/        common.ts, overworld.ts, zones/*.ts                                 ← hi-res
  main.ts
test/           bun tests (parsers, bus, live collectors, both renderers)
fixtures/       raw captures (see fixtures/README.md)
scripts/        capture-fixtures.sh, anonymize-fixtures.py, bench-parse.ts
docs/           ROADMAP.md, ART_DIRECTION.md, stills/
```

## 13. Phases

Status and task breakdown: [docs/ROADMAP.md](docs/ROADMAP.md).

1. ✅ **Data:** fixtures, `Snapshot` types, powermetrics parser, memory/topology/ps collectors, FFI CPU fallback, privilege handling, live source, record/replay.
2. ✅ **Engine:** both renderers, sprites, palette, outlines/dither, pixel font, tweening, HUD, render tests, PNG stills.
3. ✅ **Overworld:** all six zone tiles driven by data, with navigation and iris transitions.
4. 🟡 **First zones:** CPU Fortress and Memory Reservoir done; boring mode not started.
5. **Remaining zones:** Network Sky, Disk Mines, Process Plains, and Power Plant.
6. **Entity view:** focus, detail cards, and on-demand detail collectors.
7. **Later:** the action broker and stomp mechanic.

## 14. Open questions

- What's the right top-N process count for the plains before it gets visually noisy (20? 30?)?
- Is `nettop` reliable and cheap enough at 1 Hz, or should per-connection data be sampled only while you're in Network Sky?
- ~~How do we show per-process GPU usage?~~ powermetrics doesn't provide it, even with `--show-process-gpu` (see fixtures/README). Out of scope unless an IOKit source turns up.
- ~~Art direction?~~ Decided: NES-era pixel craft on a dusk/night palette, with a teal robot mascot. See docs/ART_DIRECTION.md.
- How should distribution work (`bun build --compile` single binary, Homebrew tap)?
