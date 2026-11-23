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

**Goal:** Replace the placeholder with the Network Sky level.

**Files:** new `src/hires/zones/network.ts` and `src/world/zones/network.ts`, routing, stills.

**Data:**
- `snap.net`: `rxBps`, `txBps`, `rxPps`, `txPps` (system-wide; undefined without sudo → R2 locked panel).
- Per-process: `snap.procs[].netRxBps` and `netTxBps`.
- There is **no per-connection data yet**. Don't add `nettop`; that's a separate future task.

**Metaphor:** an open night sky above a cloud layer.

| Visual | Metric |
|---|---|
| Packet streaks crossing right → left (green, `P.ok`), reuse the overworld streak style | Inbound: count ∝ log rx bytes/s, speed ∝ log rx packets/s |
| Streaks crossing left → right (gold, `P.accent`) | Outbound: same, for tx |
| One cloud each for the top 5 network processes by `netRxBps + netTxBps`; size ∝ log rate; name label under it; a small up/down arrow pair with values | Per-process network |
| Radio mast on the right with beacon blink rate | Total packets/s |
| Throughput sparkline along the bottom: last 60 s rx/tx as two thin dithered lines | Recent rx/tx history, kept in a scene-local ring buffer fed from `ctx.snap` each second |

- Title `NETWORK SKY`. Hint right: `↓ IN  ↑ OUT  (LOG SCALE)`.

**Acceptance:** `net-burst` vs. `idle` stills differ clearly; `degraded` shows the locked panel.

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

**Goal:** DESIGN.md §9.1 says to drop to about 5 fps when nothing is animating. Measure first, then implement.

**Spec:** measure the app's CPU with `ps -o %cpu -p <pid>` over 60 s in `bun run demo`, in both renderers. If it's above the 3% budget:
- Lower `renderer.targetFps` while the player is idle and no transition is running.
- Make ambient animations step at about 5 Hz in that state.

Report the before/after numbers in the PR.

---

## Later (needs a design pass with the maintainer before anyone starts)

- **Entity focus and detail cards** (phase 6, DESIGN.md §7.4): `Tab` focus inside zones, an `Enter` detail card, and on-demand `lsof`/`ps` detail collectors.
- **Per-connection network** via `nettop`: the cost at 1 Hz is an open question (DESIGN.md §14).
- **Disk volumes** (`df`) as mine shafts.
- **Sudoers documentation** for passwordless `powermetrics`.
- **Distribution:** `bun build --compile` and a Homebrew tap.
- **Action broker / stomp mechanic** (phase 7).
