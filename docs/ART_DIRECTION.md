# Art direction

The look is **original NES-era pixel craft on a dusk/night palette**: chunky, readable, outlined sprites, ordered dithering, light from the top-left, and a small cast (a teal robot, slimes, a boss slime) in a world built from bricks, metal, water, clouds and lava. Use the existing scenes as the reference implementation:

| Scene | Hi-res still | Low-res still |
|---|---|---|
| Overworld (load) | `docs/stills/2-overworld-load-hires.png` | `docs/stills/2-overworld-load.png` |
| CPU Fortress (idle / load) | `docs/stills/3-cpu-idle-hires.png`, `4-cpu-load-hires.png` | `3-cpu-idle.png`, `4-cpu-load.png` |
| Memory Reservoir | `docs/stills/5-memory-hires.png` | `5-memory.png` |

If a new scene doesn't look like it belongs next to these, it isn't done.

## Palette

- **All colors come from `P` (`src/engine/palette.ts`) or `X` (`src/hires/common.ts`).** No inline hex in scene code. If you need a new shade, add a named entry next to its family (for example `swapDark` next to `swap`), or derive it with `mix(a, b, t)` from existing entries.
- **Materials use three tones:** base, light and dark. Existing triads: `stone/stoneLight/stoneDark` (+ `stoneDeep` for mortar), `eBrick*`, `pBrick*`, `metal/metalLight` (+ `stoneDark` as the shadow), `wood/woodDark`, `brickRed*` and `leaf*`.
- **Semantic colors are reserved:**

| Color | Meaning |
|---|---|
| `ok` / `warn` / `crit` | Status only: pressure, thermal, thresholds |
| `eBrick*` (blue) | Efficiency cores |
| `pBrick*` (orange) | Performance cores |
| `app` / `wired` / `compressed` / `cached` / `swap` | Memory categories |
| `lava*` / `ember` | Heat: thermal, CPU above 85%, the boss |
| `accent` (gold) | Selection, titles, and the robot's antenna |

## Shapes and shading

- **Outlines:**
  - Draw buildings, props, sprites and critters inside `outlined(cv, X.outline, (layer) => …)`. It adds a 1 px ink outline around everything drawn into the layer.
  - Use `X.cloudOutline` for clouds.
  - Don't outline smoke, glows, particles, text or terrain.
- **Light comes from the top-left.** Highlights go on top and left edges; shadows on bottom and right. Use `bevel()` for boxes and `bricks()` for masonry (running bond, per-brick bevel). For cylinders, shade by column, light on the left and dark on the right (see the water tower).
- **No smooth gradients.** Skies and fills use `ditherGradientV()` (banded, Bayer-dithered) or `dither(x, y, a, b, t)`. Fades (smoke, packet trails, glows) dissolve through `bayer()` thresholds, not alpha.
- **Glow:** `glow(cv, x, y, r, color, strength)` for light sources (windows, lamps, lava, the radio beacon), used sparingly.
- **Sprites:** author them as string rows with `sprite(rows, key)`, one character per palette color, `.` for transparent. Keep them small: the robot is 10×13, slimes 12×8, the boss 18×14. Animate with 2–3 frames chosen by `ctx.t`.
- **Texture noise:** `hash(x, y, seed)` only, so it's deterministic. Keep speckles to 5–10% density.

## Layout bands

**Hi-res (320×192)**

| Band | y range | Contents |
|---|---|---|
| HUD | 0–10 | `drawHudHi`. Icons + values; don't edit per scene. |
| Title | about 14 | Scene name centered: `drawTextCentered(cv, W/2, 14, NAME, P.accent, { shadow: X.outline })` |
| Scene | 11–180 | Sky on top, ground below. Keep important content out of the HUD and hint bands. |
| Hint bar | 181–191 | `drawHintHi(cv, left, right)`. Left: keys. Right: one key metric or a short legend. |

**Low-res (80×46 canvas + 80×24 text grid)**

| Band | Where | Contents |
|---|---|---|
| HUD | Text row 0 | `drawHud` |
| Title | Text row 1 | `f.centered(40, 1, NAME, P.accent, undefined, true)` |
| Hint | Text row 23 | `drawHint` (dark band) |

- Canvas pixel row `y` is text row `1 + floor(y / 2)` (see `Frame.rowOf`).
- Labels over busy pixels need an explicit `bg` so they stay readable.

## Text

- **Hi-res:** only the 5×7 font (`drawText`, `drawTextCentered`, `drawTextRight`), 6 px advance, uppercase. Text over scenery always gets `{ shadow: X.outline }`; text over a flat panel can use `{ bg }`. Numbers go next to the visual they describe.
- **Low-res:** real terminal text through `Frame.text` / `Frame.centered`.
- **Number formats:** `fmtPct`, `fmtBytes`, `fmtRate` and `fmtUptime` from `src/world/common.ts`. Don't hand-roll formatting.

## Motion

- Every metric-driven size, height, speed or level is eased: `ctx.sm.get("zone.thing.id", target, ctx.dt)`. Keys must be unique per scene and per entity.
- **Ambient motion** (twinkle, waves, flags, bubbles) runs off `ctx.t` and must be gentle.
- **Data-driven motion** should scale visibly between idle and load: compare `3-cpu-idle` with `4-cpu-load`.
- **Throughput** maps on a log scale (`Math.log10(1 + bps) / 7…9`), clamped to 0..1.
- **Over-threshold states** get one clear, consistent signal: fire for CPU above 85%, a blinking lamp for critical pressure, an angry boss for a process above 50% CPU. Don't invent new alarm styles per zone; reuse these.

## Metaphor guide for new zones

Pick a physical metaphor where **the quantity reads as a size, level, count or speed**, and where the over-threshold state has an obvious "danger" look. Reuse the world's materials so the zone feels like part of the same map. The planned metaphors are in DESIGN.md §7.3, and the ROADMAP tasks spell them out. Don't change them without asking.
