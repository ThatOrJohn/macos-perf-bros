# AGENTS.md — working on macos-perf-bros

Read this before changing anything. It applies to every contributor, human or AI agent (Codex, Claude, and others).

## What this is

A terminal system monitor for Apple Silicon Macs that looks and plays like an original NES-era platformer. The machine's subsystems are zones on an overworld map. You walk a little robot to a zone and enter it to see that subsystem as a level, where **every sprite, height, speed and color encodes a real metric**.

- Product and architecture spec: [DESIGN.md](DESIGN.md)
- Visual style guide, which is binding for all art: [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md)
- What to build next, as self-contained tasks: [docs/ROADMAP.md](docs/ROADMAP.md)
- Data source quirks (units, gotchas): [fixtures/README.md](fixtures/README.md)

## Hard rules (do not break these)

1. **Every visual element encodes a metric.** No decoration that pretends to be data, and no data without a readable number somewhere on screen (the HUD, a label, or a legend). If you add a visual, write down in code comments which metric drives it and how (scale, range).
2. **Both renderers, always.** Every scene exists twice: hi-res in `src/hires/**` (320×192) and half-block in `src/world/**` (80×46). A feature isn't done until both work. Keep them showing the same data with the same metaphor, even though the hi-res art is more detailed.
3. **Original art only.** The NES *era* (palette discipline, outlines, dithering, tile craft) is the target; any *specific* game is not. Never draw Nintendo or other existing characters or look-alikes: no plumbers, red-and-white mushrooms, goombas, koopas, `?` blocks, green pipes with plants, or castles copied from a real game. Our mascot is the teal robot (`ROBOT` in `src/hires/common.ts`). Critters are slimes. If something feels like a reference to a real game, change it.
4. **Observe-only.** Nothing may kill, renice or otherwise change processes or system state. (An action broker is planned for much later; see DESIGN.md §10. Don't start it.)
5. **The UI never runs as root.** Only `powermetrics` runs under `sudo`, as a child process (`src/collectors/powermetrics-process.ts`). Never add another privileged command. Never run `sudo` yourself while developing; use fixtures and replay.
6. **Degraded mode must work.** Without sudo there is no GPU, power, thermal, network, disk or CPU frequency data. Every `Snapshot` field except `topology`, `procs`, `t`, `privileged` and `uptimeS` is optional. Handle `undefined` everywhere; never throw on missing data.
7. **Performance budget.** UI plus collectors must stay under ~3% of one P-core at steady state. Drawing a frame must stay under ~2 ms hi-res and ~0.5 ms low-res per scene; check with `bun run bench:render`, which exits non-zero when over budget. No per-frame allocation of full-canvas buffers; reuse them, as `outlined()` does.
8. **No new runtime dependencies** without asking the maintainer. Dev dependencies need a reason in the PR.
9. **Units are fixed downstream of collectors:** percent 0–100, MHz, watts, bytes/s, ms since epoch. Collectors convert; UI code never converts raw powermetrics units. (For example, powermetrics' `gpu.freq_hz` is really MHz; that's handled in the parser.)

## Architecture in one minute

```
collectors/  (macOS-specific I/O and parsing)  →  core/bus.ts SnapshotBus  →  Snapshot
core/live.ts (timers + bus)  or  core/replay.ts / core/recorder.ts (fixtures, .ndjson)
        ↓  SnapshotSource.at(t)
world/game.ts   scene state machine (overworld ⇄ zones), keys, iris; draw() / drawHi()
        ↓                                        ↓
world/**  → Frame (80×46 + text)          hires/** → PixelCanvas (320×192)
engine/present-opentui.ts                  engine/present-image.ts (Kitty/Sixel)
```

- **The `Snapshot` type (`src/core/snapshot.ts`) is the contract.** The UI reads only Snapshots and never calls collectors.
- **Scene functions** have the signature `(canvas or frame, ctx: DrawCtx, …)`, where `ctx` is `{ snap, t, dt, sm }`:
  - `t` is the animation clock, in seconds.
  - `sm` eases metric values: `ctx.sm.get("unique.key", target, ctx.dt)`.
- **Randomness:** use `hash(x, y, seed)` from `src/world/common.ts`, never `Math.random()`. Frames must be deterministic for a given `(snapshot, t)` so stills and tests are stable.
- **Adding a zone:**
  1. Write `src/world/zones/<zone>.ts` and `src/hires/zones/<zone>.ts`.
  2. Route both in `Game.draw` and `Game.drawHi`.
  3. Add a shot to `renderStills` in `src/main.ts`.

## Commands

```bash
bun install
bun test                 # all tests (parsers, bus, live unprivileged collectors, both renderers)
bun run typecheck        # tsc --noEmit, strict
bun run stills           # writes PNGs of every scene, both renderers, to docs/stills/
bun run bench:render     # per-scene frame cost vs. budget
bun run demo             # interactive replay of the bundled M1 fixtures (no sudo)
bun start -- --no-sudo   # live, degraded mode (no sudo)
bun run src/main.ts --replay path/to/scenario.ndjson   # replay a recorded or synthetic scenario
bun run src/main.ts --renderer blocks|kitty|sixel      # force a renderer
```

In the interactive app: arrows or `hjkl` to move, `⏎` to enter, `Esc` to go back, `1`–`6` to jump to a zone, `r` to toggle renderer, `q` to quit.

## Definition of done (every task)

- [ ] `bun test` passes and `bun run typecheck` is clean.
- [ ] New logic has tests. For scenes, extend `test/present.test.ts` so the scene renders in both renderers without throwing, and with an empty or degraded snapshot.
- [ ] `bun run stills` was run and **you looked at the PNGs** for every scene you touched, in both renderers. Check:
  - Text is readable and doesn't overlap.
  - Nothing is clipped at 320×192 or 80×46.
  - The metric mapping visibly changes between the idle and load stills.
- [ ] The scene works with `--no-sudo` data, meaning missing gpu/power/thermal/net/disk.
- [ ] Art follows docs/ART_DIRECTION.md (palette, outlines, light direction, dithering, font, layout bands).
- [ ] The metric → visual mapping is documented in a comment at the top of the scene file, and in DESIGN.md §7.3 if it changed.
- [ ] One task per branch and PR. Don't commit to `main`. The PR description includes the updated stills (`docs/stills/*`) and notes any trade-offs.

## Things that need a human

- Anything requiring `sudo` (new powermetrics captures, live privileged runs). Ask; don't work around it.
- Checking how the hi-res renderer actually looks in a Kitty-protocol terminal (Ghostty, Kitty, WezTerm). Headless tests can't see the terminal.
- Changing the palette's existing colors, the mascot, the layout bands, or the zone metaphors in DESIGN.md §7. Propose the change in the PR instead of doing it.
