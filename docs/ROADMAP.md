# Roadmap

Read [AGENTS.md](../AGENTS.md) first. Its hard rules and definition of done apply to every task here. Each task is self-contained: one branch, one PR.

## Where things stand (2026-11-23)

| Area | Status |
|---|---|
| Data: powermetrics parser, memory/topology/ps collectors, FFI CPU fallback, sudo handling, live source, record/replay | ✅ done |
| Engine: both renderers, palette, outlines/dither, 5×7 font, tweening, PNG stills, render tests | ✅ done |
| Overworld: all six live tiles, navigation, iris transitions | ✅ done |
| CPU Fortress, Memory Reservoir, Process Plains (R3) | ✅ done (both renderers) |
| Synthetic scenarios + scenario stills (R1) | ✅ done |
| Degraded-mode "locked" visuals (R2) | ✅ done. Locked zones use the placeholder scene with the locked panel; R4–R6 call `drawLockedPanel` / `drawLockedPanelHi` themselves |
| Network Sky, Disk Mines, Power Plant | ⬜ placeholder "under construction" scenes |
| Boring mode, help/pause | ⬜ not started |
| Entity focus + detail cards (phase 6) | ⬜ later, needs design review first |
| Action broker / stomp (phase 7) | 🚫 do not start |

## Suggested order

**R1 → R2 → (R3, R4, R5, R6 in any order) → R7 → R8 → R9.** R1 first because every visual task after it is verified against its scenarios.

Good first tasks for an agent: R1, R2, R8. The zone tasks (R3–R6) are the main creative work. Do one, get it reviewed against the art direction, then do the rest.

---

## R1. Synthetic scenarios for visual testing

**Goal:** Generate replayable `.ndjson` scenarios that push each metric to its interesting extremes, so every zone can be checked without sudo or a loaded machine.

**Files:**
- New `scripts/make-scenarios.ts`, which writes `fixtures/scenarios/*.ndjson`.
- Extend `renderStills` in `src/main.ts`.
- New tests.

**Spec:**
- Build snapshots by starting from `loadFixtureReplay("fixtures/raw/apple-m1_macos-27.0.1").at(0)` and overriding fields. Keep them valid `Snapshot` objects (`src/core/snapshot.ts`). About 20 lines per scenario at 1 per second, ramping values up and down so tweening is visible.
- Scenarios:

| File | What it shows |
|---|---|
| `idle.ndjson` | Everything low |
| `cpu-fire.ndjson` | All cores 95–100%, clusters at max freq, package 20 W, thermal `heavy` |
| `swap-storm.ndjson` | Memory used ≈ total, compressed large, swap 90–100%, pressure `critical` |
| `net-burst.ndjson` | rx 0 → 80 MB/s → 0, tx 5 MB/s; three procs with high `netRxBps` |
| `disk-thrash.ndjson` | Read 1.5 GB/s, write 600 MB/s; two procs with high `diskReadBps` / `diskWriteBps` |
| `gpu-busy.ndjson` | GPU 95% at max freq, gpu 12 W, ANE 2 W |
| `degraded.ndjson` | `privileged: false`; gpu/power/thermal/net/disk all undefined; cores with `freqMHz: 0` and clusters with `maxFreqMHz: 0` (as `src/collectors/hostcpu.ts` produces) |

- `bun run stills -- --scenarios` (or a separate `stills:scenarios` script) renders each scenario × each scene into `docs/stills/scenarios/` in both renderers.

**Acceptance:**
- Every scenario replays with `bun run src/main.ts --replay fixtures/scenarios/<name>.ndjson`.
- A test loads each file and checks that it's non-empty and every line parses into the `Snapshot` shape.
- `test/present.test.ts` renders every scene for every scenario in both renderers without throwing. That's the main regression net for degraded mode.

**Out of scope:** changing any scene's art.

---

## R2. Degraded-mode ("locked") visuals

**Goal:** When data is missing (no sudo), show it clearly as **locked**, not broken or blank. Today the overworld labels just read `PWR` / `NET` / `DISK` and the CPU banners sit at the bottom.

**Files:**
- `src/hires/common.ts` and `src/world/common.ts` (padlock sprite and helper).
- `src/hires/overworld.ts` and `src/world/overworld.ts`.
- The CPU zones.
- The HUD in both renderers.

**Spec:**
- **Padlock:** add an original padlock sprite (hi-res about 7×8, outlined; low-res 3×3). Draw it over a zone tile whose data is undefined: power (no `snap.power`), net (no `snap.net`), disk (no `snap.disk`). Dim the tile by dithering it 50% toward `X.sky1` (hi) or `P.stoneDeep` (lo), and change the label to `PWR —`.
- **CPU Fortress with `freqMHz === 0`:** hide the banner and frequency text. Show `NO SUDO · FREQ N/A` in `P.dim` where the MHz text was. Busy % and the pillars still work.
- **HUD:** when `!snap.privileged`, show a small `NO SUDO` tag in `P.warn` before the uptime, in both renderers.
- **Zone scenes** that need missing data (Power Plant, Network Sky, Disk Mines, once built) show a centered locked panel: padlock, `NEEDS SUDO`, and `RESTART WITHOUT --no-sudo` in `P.dim`.

**Acceptance:** the stills for the R1 `degraded` scenario look intentional in both renderers, and the `cpu-fire` stills are unchanged.

---

## R3. Process Plains

**Goal:** Replace the placeholder with the Process Plains level (DESIGN.md §7.3).

**Files:** new `src/hires/zones/process.ts` and `src/world/zones/process.ts`, routing in `src/world/game.ts`, stills.

**Data:** `snap.procs` (sorted by `cpuPct` descending), using `pid`, `name`, `cpuPct` (100 = one core; can exceed 100), `rssB` (may be undefined), `energyImpact`, `idleWakeupsPerS`.

**Metaphor (keep it):** a fenced meadow at dusk. The top processes are **slimes**, using the existing `SLIMES` sprites and colors.

| Visual | Metric |
|---|---|
| Slime size (3 sizes: small, normal, large; scale the sprite or add size variants) | RSS bucket: < 100 MB, < 1 GB, ≥ 1 GB |
| Hop speed and frequency | `cpuPct` |
| Glow (`glow()` in `P.accent`) | `energyImpact` above a threshold |
| The boss (`BOSS` sprite, already exists) | The #1 process, when its `cpuPct` > 50; health bar above it = cpuPct |

- Show the top 12 slimes in hi-res and the top 6 in low-res. Each slime keeps a stable position keyed by pid (use `hash(pid, …)`), so slimes don't swap places when the ranking changes. Slimes leaving the top N shrink out; new ones pop in.
- A right-side leaderboard panel (hi-res: x ≈ 214–316) lists the top 8 as `NAME  CPU%  RSS`, truncated to fit. Low-res: the top 5 in text rows 3–8 on the right.
- Title `PROCESS PLAINS`. Hint right: `TOP N BY CPU · BOSS > 50%`.

**Acceptance:**
- Idle vs. `cpu-fire` stills: visible difference in hop speed, and a boss appears.
- The degraded scenario works (ps-based procs, energy 0).
- Our own process appearing in the list is fine; it should never be the boss at idle.

---

## R4. Network Sky

**Goal:** Replace the placeholder with the Network Sky level: system-wide traffic as packet streaks crossing a night sky, the busiest network processes as clouds, and a 60-second throughput history.

**Depends on:** R2 (merged), for `drawLockedPanel` / `drawLockedPanelHi` and `zoneLocked`. Read `src/world/process-field.ts` and both `zones/process.ts` first: they show the expected patterns for PID-stable slots, scene state owned by `Game`, two-pass labels, and the metric comment block.

### Files

| File | Change |
|---|---|
| `src/world/zones/network.ts`, `src/hires/zones/network.ts` | New scenes (`drawNetworkZone`, `drawNetworkZoneHi`). |
| `src/world/net-sky.ts` | Shared, renderer-agnostic state: the history ring buffer and the cloud slot tracker (see below). Like `process-field.ts`. |
| `src/hires/common.ts` | Extract the cloud drawing from `cloudIsland()` in `src/hires/overworld.ts` into a reusable `drawCloudHi(cv, cx, cy, scale)`. **The overworld stills must stay byte-identical** after the extraction. |
| `src/world/game.ts` | Route `case "net"` in `draw` and `drawHi`; own one state object per renderer, as `processField` / `processFieldHi` do. |
| `src/main.ts` | Add `{ name: "8-network", keys: ["3"], t: 8.5 }` to the default stills. |
| `scripts/make-scenarios.ts` | Extend `net-burst` (see Data). |
| `test/` | See Tests. |
| `DESIGN.md` §7.3 | Replace the Network Sky bullets with what you built. |

### Data

- `snap.net`: `rxBps`, `txBps` (bytes/s), `rxPps`, `txPps` (packets/s). System-wide, from powermetrics. **Undefined without sudo.**
- Per-process: `snap.procs[].netRxBps`, `netTxBps` (bytes/s). They come from powermetrics `tasks[]` and are **0 without sudo**.
- No per-connection data and no remote hosts. Don't add `nettop`, `lsof` or any new collector; that's a future task. DESIGN.md's "process + remote host" clouds are out of scope.
- Scenarios:
  - `idle` has **all-zero** network traffic, so the empty sky must look deliberate.
  - `net-burst` peaks at 80 MB/s rx, 5 MB/s tx, but only 3 processes have traffic. Extend it so **6** processes have nonzero traffic, including at least one that is tx-heavy (tx > rx) and one under 10 KB/s. Then regenerate the scenarios and keep `test/scenarios.test.ts` passing.
  - The bundled M1 capture (`bun run demo`) has small real values, around 9 KB/s.

### Locked

When `zoneLocked("net", snap)` is true, draw the scene backdrop plus `drawLockedPanel(f)` / `drawLockedPanelHi(cv)`, then the HUD and hint, and **nothing else**: no streaks, clouds or history. Model it on `drawPlaceholderZone(…, locked = true)`.

### Metric → visual mapping

Use one log scale everywhere so the scene and the overworld tile agree: **`lvl(bps) = clamp(log10(1 + bps) / 7, 0, 1)`**, which reaches full at 10 MB/s. This matches `cloudIsland()` / `netTile()`. For packets: **`plvl(pps) = clamp(log10(1 + pps) / 5, 0, 1)`**, full at 100 k pps.

| Visual | Metric | Mapping |
|---|---|---|
| Green (`P.ok`) streaks crossing **right → left** in the upper sky lanes | Inbound bytes/s | count = `round(lvl(rxBps) × N)` (N = 14 hi-res, 6 low-res), at most N |
| Gold (`P.accent`) streaks crossing **left → right** in the lower sky lanes | Outbound bytes/s | count = `round(lvl(txBps) × N)` |
| Streak speed | Packets/s, per direction | px/s = base × (1 + 2 × `plvl(pps)`). Hi-res base 60, low-res base 18. |
| Up to 5 clouds (4 low-res), one per busiest network process | `netRxBps + netTxBps`, ranked descending, only rate > 0 | Cloud scale = 0.6 + 0.6 × `lvl(rate)`. Name under it, plus `↓rx ↑tx`. |
| Rain from a cloud, fine dithered `P.ok` drops | That process's rx share | Drop count ∝ `lvl(netRxBps)`. Optional; skip if it clutters. |
| Radio mast on the right, beacon blink | Total packets/s (rx + tx) | Blink Hz = 0.5 + 3 × `plvl(rxPps + txPps)`. Label `PKT/S` with the value under the mast. |
| Sparkline band along the bottom | Last 60 s of rx and tx | Two 1-px lines, green rx and gold tx, y ∝ `lvl()`. Axis label `60S`, and the current values at the right end. |

**Readable numbers (hard rule 1):** the header shows `↓ <rx>/S  ↑ <tx>/S` using `fmtBytes`. Each cloud shows its name and rates. The mast shows packets/s. The sparkline shows the current values.

**No traffic:** when rx and tx are both 0, draw no streaks and no clouds, and show `NO TRAFFIC` centered in `P.dim` in the cloud band. The sparkline sits flat on its baseline. Stars still twinkle, since they're backdrop, not data.

### State (`src/world/net-sky.ts`)

- **History:** a fixed 60-entry ring buffer of `{ rx, tx }`, allocated once. Push one sample each time `floor(snap.t / 1000)` changes, not per frame, so 30 fps doesn't record 30 entries a second. Frames must stay deterministic for a given sequence of `(snapshot, t)`. Note that the default stills settle on a single sample (flat history), while scenario stills replay from t=0 (`replayTimeline`), so the history fills.
- **Clouds:** stable horizontal slots keyed by PID, so clouds don't swap places when the ranking changes. Use the same idea as `ProcessField`: probe from `hash(pid, …)`, a smoothed `presence` to grow in and shrink out, and a `Smoother` per entity. If you can extract a small generic slot tracker from `ProcessField` without changing Process Plains' behavior or stills, do that; otherwise write a focused one. **Don't copy-paste `ProcessField` and edit it.**
- No `Math.random()`. Streak positions derive from `t`, the index and `hash()`, like `cloudIsland()`.

### Layout (respect the bands in docs/ART_DIRECTION.md)

**Hi-res, 320×192:**

| Band | y | Contents |
|---|---|---|
| HUD | 0–10 | `drawHudHi` |
| Title | 14 | `NETWORK SKY` centered. Header totals at y 24, centered, in `P.white` with shadow. |
| Inbound lanes | 34–62 | 4 lanes, 7 px apart |
| Cloud band | 66–128 | 5 slots across x 8–276. Name and rates take ~2 text lines under each cloud. **Clouds and labels must not overlap a neighbor's.** Draw all clouds first, then all labels (two-pass, as in Process Plains). |
| Outbound lanes | 132–150 | 3 lanes. Streaks pass *in front of* the cloud band edges but never over text. |
| Sparkline | 154–178 | Dark `P.hudBg` panel with `P.stoneDeep` bevel, x 4–315 |
| Mast | x 284–314, y 40–150 | Lattice in `P.metal`/`P.metalLight` like `cloudIsland`; beacon `P.crit`/`P.ember`; `PKT/S` and value at y ~120–138 with a dark backing |
| Hint | 181–191 | Left `ESC BACK  Q QUIT`, right `↓ IN  ↑ OUT  LOG SCALE` |

Names: show **at least 8 characters** in hi-res (5×7 font, 6 px advance). Six characters, as R3's leaderboard used, is too short to read. Use `processName()` from `process-field.ts` for sanitizing and truncation.

**Low-res, 80×46 canvas + 80×24 text:** streak lanes at canvas y 4–12 (in) and 30–33 (out); clouds at y 14–28 with names and rates as text on rows 15–16 (`f.centered`); sparkline at canvas y 36–43 with values in text row 22; mast on the right at x 74–78. Up to 4 clouds. Title on text row 1, totals on row 2.

### Art

- Reuse, don't redraw:
  - Clouds: hi-res via the extracted `drawCloudHi`, which outlines in `X.cloudOutline`, has a dithered `P.cloudShade` underside and light from the top-left. Low-res via `drawCloud` in `src/world/common.ts`.
  - Streaks: the overworld streak style, with a bright head and a Bayer-faded tail.
  - Mast: the `cloudIsland` mast.
- Clouds are **plain clouds. No faces, eyes, riders or anything sitting on a cloud.** Faces on clouds read as a reference to existing games (AGENTS.md rule 3).
- Palette only from `P` and `X`. No smooth gradients; dither instead.

### Performance

`bun run bench:render` has `net` under 2 ms hi-res and 0.5 ms low-res. Use no full-canvas allocation per frame. Cap the streak count as in the table.

### Tests

- In `test/present.test.ts`, `net` renders in both renderers for idle, `net-burst`, `degraded` and an empty snapshot (`procs: []`, `net` all-zero). Most of this is already covered by the scenario loop; confirm that it really reaches the new scene.
- In a new `test/net-sky.test.ts`:
  - The ring buffer records one entry per second regardless of frame rate, wraps at 60, and starts flat.
  - Cloud slots stay put by PID when ranks swap.
  - Processes with zero traffic get no cloud.
  - With `degraded`, the low-res frame text contains `NEEDS SUDO` and no `↓`.
  - With `idle`, it contains `NO TRAFFIC`.
- The overworld stills are byte-identical before and after the `drawCloudHi` extraction. Check with `git diff --stat docs/stills/*overworld*`.

### Acceptance

- `net-burst` and `idle` stills differ clearly in both renderers: streak density, clouds and the sparkline.
- `degraded` shows the locked panel and nothing data-driven.
- With 5–6 active processes, no text overlaps at 320×192 or 80×46. **Check the `net-burst` hi-res still for this specifically.**
- All the overworld and other-zone stills are unchanged.
- The PR description includes the idle, `net-burst` and degraded stills in both renderers, plus the bench line for `net`.

### Out of scope

- Per-connection data, `nettop` and remote hosts.
- Changing the overworld net tile.
- Interface selection (Wi-Fi vs. Ethernet).
- Any new key bindings.

---

## R5. Disk Mines

**Goal:** Replace the placeholder with the Disk Mines level.

**Files:** new `src/hires/zones/disk.ts` and `src/world/zones/disk.ts`, routing, stills.

**Data:**
- `snap.disk`: `readBps`, `writeBps`, `readOps`, `writeOps`.
- Per-process: `snap.procs[].diskReadBps` and `diskWriteBps`.
- No per-volume data yet; don't add a collector.

**Metaphor:** a cross-section of a mine.

| Visual | Metric |
|---|---|
| Upper rail line, carts loaded with ore (gems, reuse `CART`) heading **up/out** | Reads |
| Lower rail line, carts carrying stone heading **in/down** | Writes |
| Cart frequency | ops/s, log scale |
| Cart speed | bytes/s, log scale |
| One miner robot per top-3 I/O process; pickaxe swing speed ∝ that process's bytes/s; name label | Per-process disk I/O |

- Miners are variants of the existing `ROBOT` sprite with a helmet lamp. Keep it our mascot, not a new character.
- Lanterns along the tunnel walls flicker faster as total ops rise.
- Title `DISK MINES`. Hint right: `READ ↑  WRITE ↓  (LOG SCALE)`.

**Acceptance:** `disk-thrash` vs. `idle` stills differ clearly; `degraded` shows the locked panel.

---

## R6. Power Plant

**Goal:** Replace the placeholder with the Power Plant level. It also holds the GPU and thermal, so it's the richest zone.

**Files:** new `src/hires/zones/power.ts` and `src/world/zones/power.ts`, routing, stills.

**Data:**
- `snap.power`: `cpuW`, `gpuW`, `aneW`, `packageW` (watts).
- `snap.gpu`: `freqMHz`, `maxFreqMHz`, `activePct`.
- `snap.thermal`: `nominal | moderate | heavy | critical | unknown`.
- All undefined without sudo → R2 locked panel.

**Metaphor:** the factory interior.

| Visual | Metric |
|---|---|
| Three generator turbines labelled CPU, GPU, ANE; spin speed (animation frame rate) ∝ watts; watt value under each | Per-component power |
| A furnace (the "GPU foundry"); brightness and flame height ∝ `gpu.activePct` | GPU busy |
| A vertical gauge beside the furnace | GPU freq / max |
| Lava channel along the floor; level and bubbling by thermal | `nominal` low and dark, `moderate` medium, `heavy` high and bright, `critical` overflowing plus a blinking `⚠ THROTTLING` sign |
| Big package-watts readout on a panel, color-coded | `packageW` (thresholds as named constants: < 10 W ok, < 20 W warn, otherwise crit) |

- Title `POWER PLANT`. Hint right: `PACKAGE W · THERMAL`.

**Acceptance:** `gpu-busy` and `cpu-fire` vs. `idle` stills differ clearly; `degraded` shows the locked panel.

---

## R7. Boring mode (`b`)

**Goal:** DESIGN.md principle 3: one key flips the current zone into a plain table of the same data. On the overworld, it shows a summary table of all zones.

**Files:** `src/world/game.ts` (a `boring` flag toggled by `b`), new `src/ui/table.ts` (shared table model: rows of `[label, value, color]`), plus a renderer for each:
- hi-res: 5×7 font on a `P.hudBg` panel
- low-res: terminal text

**Spec:** each zone exports a `tableRows(snap): Row[]` function next to its scene, so the table and the art can never disagree on what data the zone shows. Columns are fixed-width and right-aligned numbers.

**Acceptance:** for every scene, in both renderers, `b` shows the table and `b` again restores the art. Add stills.

---

## R8. Help overlay (`?`) and pause (`p`)

**Goal:**
- `?` toggles a centered panel listing the keys (from DESIGN.md §8) plus one line explaining the current zone's metaphor.
- `p` freezes the snapshot: the source keeps running, but the UI keeps showing the last snapshot. A `PAUSED` tag appears in the HUD, and ambient animation continues.

**Files:** `src/world/game.ts`, `src/main.ts`, small panel helpers in both `common.ts` files.

**Acceptance:** works in every scene and both renderers; there are tests for the key handling.

---

## R9. Idle frame-rate drop

**Status:** done. The app now runs at 30 fps while the player walks or the zoom transition runs, and at 5 fps otherwise (`Game.busy()`, `ACTIVE_FPS`/`IDLE_FPS` in `src/main.ts`). Half-block rendering updates only changed cells in an offscreen buffer, Kitty skips identical frames, and `Game` reuses its output buffers.

Measured with `bun run demo` in the Claude terminal panel: process CPU over 60 s, as a percentage of one core.

| | Before | After |
|---|---|---|
| blocks | 17.6% | 5.3% |
| kitty | 18.9% | 5.9% |

**Budget:** the maintainer accepted ~5% at 5 fps idle (2026-11-23). The original 3% target would have needed about 2 fps idle, since a bare OpenTUI app costs about 1.0% fixed plus 0.26% per fps. AGENTS.md rule 7 and DESIGN.md now say 5%.

---

## Later (needs a design pass with the maintainer before anyone starts)

- **Entity focus and detail cards** (phase 6, DESIGN.md §7.4): `Tab` focus inside zones, an `Enter` detail card, and on-demand `lsof`/`ps` detail collectors.
- **Per-connection network** via `nettop`: the cost at 1 Hz is an open question (DESIGN.md §14).
- **Disk volumes** (`df`) as mine shafts.
- **Distribution:** `bun build --compile` and a Homebrew tap.
- **Action broker / stomp mechanic** (phase 7).
