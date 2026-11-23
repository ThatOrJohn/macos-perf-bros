# macos-perf-bros

A terminal system monitor for Apple Silicon Macs, presented as an original NES-style platformer. Walk a little robot around an overworld of zones (CPU Fortress, Memory Reservoir, Network Sky, Disk Mines, Process Plains, Power Plant) and enter one to see that subsystem as a level, where every sprite encodes a live metric.

![Overworld](docs/stills/2-overworld-load-hires.png)

## Quick start

```bash
bun install
bun link                  # installs the `perf-bros` command (run it from any directory)
perf-bros                 # live; asks for sudo once so powermetrics can run (the UI itself never runs as root)
perf-bros --no-sudo       # live without sudo (no GPU, power, thermal, network, disk or CPU frequency)
perf-bros --demo          # replay a bundled recording, no sudo needed
perf-bros --help          # all options
```

From the repo, `bun start` and `bun run demo` do the same without linking.

The best way to view it is Ghostty, Kitty or WezTerm, which get real pixel graphics (320×192). Other terminals get a half-block version. Needs at least 80×24.

Keys: arrows or `hjkl` move · `⏎` enter · `Esc` back · `1`–`6` jump to a zone · `r` toggle renderer · `q` quit.

### Skipping the sudo prompt (optional)

The GPU, power, thermal, network and disk readings come from Apple's `powermetrics`, which needs root. By default perf-bros asks for your password at launch, and powermetrics runs as a child process while the UI stays unprivileged.

To launch without a prompt, add a sudoers rule for **exactly** the powermetrics command perf-bros runs. `perf-bros --sudoers` prints that rule, and the install steps:

```bash
perf-bros --sudoers > /tmp/perf-bros.sudoers
sudo visudo -cf /tmp/perf-bros.sudoers && sudo install -m 0440 /tmp/perf-bros.sudoers /etc/sudoers.d/perf-bros
```

The rule pins every argument. Don't loosen it to `/usr/bin/powermetrics` with arbitrary arguments: powermetrics can write files with `-o`, so that would let anything running as you write files as root. If a perf-bros update changes the powermetrics arguments, the rule stops matching and you'll get the password prompt again; re-run the steps above. To remove the rule: `sudo rm /etc/sudoers.d/perf-bros`.

If powermetrics exits mid-session, perf-bros keeps running without it and retries after 2 s, 5 s, 15 s, then every 60 s. A retry can only succeed while sudo is still cached (about 5 minutes after the password prompt) or with the sudoers rule above.

## Docs

- [DESIGN.md](DESIGN.md): product and architecture
- [AGENTS.md](AGENTS.md): rules for contributors and coding agents
- [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md): visual style guide
- [docs/ROADMAP.md](docs/ROADMAP.md): what's next, as self-contained tasks
- [fixtures/README.md](fixtures/README.md): data-source quirks
