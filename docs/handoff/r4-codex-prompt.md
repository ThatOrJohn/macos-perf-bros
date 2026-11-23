Implement ROADMAP task R4 (Network Sky) in this repo.

Before writing code, read:
1. AGENTS.md. The hard rules and the definition of done are binding.
2. docs/ROADMAP.md, section "R4. Network Sky". This is the spec: follow its log scales, layout bands, state rules, tests and acceptance exactly.
3. docs/ART_DIRECTION.md.
4. The Process Plains implementation as the reference pattern: src/world/process-field.ts, src/world/zones/process.ts, src/hires/zones/process.ts, and how src/world/game.ts owns their state.

Work on a new branch `codex/r4-network-sky` from an up-to-date `main`. One PR, R4 only.

Things that went wrong last time; avoid them:
- Labels overlapping neighboring sprites or bars. Draw all clouds first, then all labels, and check the net-burst hi-res still for overlap.
- Process names truncated to 6 characters were unreadable. Show at least 8 in hi-res.
- Don't copy-paste ProcessField. Extract a small shared slot tracker, or write a focused one.

When you're done:
- Run `bun test`, `bun run typecheck`, `bun run bench:render`, `bun run stills` and `bun run stills -- --scenarios`.
- Open the PNGs for net (idle, net-burst, degraded) in both renderers and fix anything clipped or overlapping.
- Confirm the overworld stills are byte-identical after extracting drawCloudHi.
- The PR description includes those stills, the `net` bench line, and any trade-offs.

Don't run sudo, don't add dependencies, and don't add nettop or any new collector. If something in the spec seems wrong, say so in the PR instead of silently changing it.
