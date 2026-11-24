# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/ThatOrJohn/macos-perf-bros/security/advisories/new)
rather than a public issue. Expect a reply within a few days.

## Scope notes

perf-bros is observe-only and the UI never runs as root. The only privileged
command is `powermetrics`, run under `sudo` as a child process. Reports about
that boundary are especially welcome, for example:

- Anything that lets the UI process, a fixture or a replay file run a command with elevated privileges.
- The optional sudoers rule printed by `perf-bros --sudoers` matching more than the exact `powermetrics` invocation.
