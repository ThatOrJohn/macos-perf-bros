# Contributing

Thanks for your interest! Contributions are welcome, human or AI-assisted.

**Read [AGENTS.md](AGENTS.md) first.** It holds the hard rules (every visual encodes a metric, both renderers, original art only, observe-only, no new runtime dependencies) and the definition of done. It applies to everyone.

Quick loop:

```bash
bun install
bun test && bun run typecheck
bun run stills        # then look at the PNGs for any scene you touched
bun run bench:render  # frame cost vs. budget
```

- One task per branch and PR; don't commit to `main`. Open an issue first for anything large. [docs/ROADMAP.md](docs/ROADMAP.md) lists self-contained tasks.
- Art must follow [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) and must be original: no characters or look-alikes from existing games.
- Never run `sudo` while developing. Use the bundled fixtures and replay (`bun run demo`).
- Include updated `docs/stills/*` in the PR when visuals change.

By contributing you agree your work is released under the [MIT License](LICENSE).
