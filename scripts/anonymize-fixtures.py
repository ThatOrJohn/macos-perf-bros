#!/usr/bin/env python3 -I
"""Anonymize a fixture capture directory in place.

Policy:
  * Process names belonging to Apple/system executables (live under /System,
    /usr, /bin, /sbin, /Library/Apple) are kept — they make fixtures realistic
    and reveal nothing about the user.
  * Every other process name becomes app-NN, consistently across all files.
  * Users other than root and _system accounts become "user".

The system allowlist is built from the live process table when this runs, so
run it on the capturing machine right after capturing (capture-fixtures.sh
does this). Names that can't be classified are anonymized (safe default).
Idempotent: app-NN names are left alone.

Usage: scripts/anonymize-fixtures.py fixtures/raw/<capture>
"""
import os
import plistlib
import re
import subprocess
import sys

SYSTEM_PREFIXES = ("/System/", "/usr/libexec/", "/usr/bin/", "/usr/sbin/", "/bin/", "/sbin/", "/Library/Apple/", "/private/var/db/")
# Note: /usr/local is deliberately not a system prefix (Homebrew and other third-party installs live there).
ALWAYS_KEEP = {"kernel_task", "launchd", "DEAD_TASKS", "ALL_TASKS", "yes"}
APP_RE = re.compile(r"^app-\d+$")


def system_names():
    out = subprocess.run(["ps", "-axo", "comm="], capture_output=True, text=True, check=True).stdout
    names = set(ALWAYS_KEEP)
    for path in out.splitlines():
        path = path.strip()
        if path.startswith(SYSTEM_PREFIXES):
            names.add(os.path.basename(path))
    return names


class Mapper:
    def __init__(self, keep):
        self.keep = keep
        self.map = {}

    def is_kept(self, name):
        return name in self.keep or APP_RE.match(name) is not None

    def collect(self, name):
        if not self.is_kept(name):
            self.map.setdefault(name, None)

    def finalize(self):
        for i, name in enumerate(sorted(self.map), 1):
            self.map[name] = f"app-{i:02d}"

    def __call__(self, name):
        return name if self.is_kept(name) else self.map[name]


def read_plists(path):
    data = open(path, "rb").read()
    return [plistlib.loads(s) for s in data.split(b"\0") if s.strip()]


def write_plists(path, samples):
    with open(path, "wb") as f:
        for s in samples:
            f.write(plistlib.dumps(s, fmt=plistlib.FMT_XML))
            f.write(b"\0")


TASK_TABLE_RE = re.compile(r"^(?P<name>.+?)\s+(?P<rest>-?\d+\s+\d.*)$")


def text_task_lines(lines):
    """Yield (index, name, rest) for rows inside '*** Running tasks ***' tables."""
    in_table = False
    for i, line in enumerate(lines):
        if line.startswith("*** Running tasks ***"):
            in_table = True
            continue
        if in_table and line.startswith("***"):
            in_table = False
        if not in_table or line.startswith("Name ") or not line.strip() or line.startswith("ALL_TASKS"):
            continue
        m = TASK_TABLE_RE.match(line.rstrip("\n"))
        if m:
            yield i, m.group("name"), m.group("rest")


def anonymize_user(user):
    return user if user == "root" or user.startswith("_") else "user"


def main(capture):
    pm = os.path.join(capture, "powermetrics")
    un = os.path.join(capture, "unprivileged")
    mapper = Mapper(system_names())

    plist_files = [os.path.join(pm, f) for f in sorted(os.listdir(pm)) if f.endswith(".plist")]
    text_files = [os.path.join(pm, f) for f in sorted(os.listdir(pm)) if f.endswith(".txt")]
    ps_file = os.path.join(un, "ps-top.txt")
    nettop_file = os.path.join(un, "nettop-per-process.csv")

    # ---- pass 1: collect every process name
    plists = {f: read_plists(f) for f in plist_files}
    for samples in plists.values():
        for s in samples:
            for t in s.get("tasks", []):
                mapper.collect(t["name"])
    texts = {f: open(f).read().splitlines(keepends=True) for f in text_files}
    for lines in texts.values():
        for _, name, _ in text_task_lines(lines):
            mapper.collect(name)
    ps_lines = open(ps_file).read().splitlines(keepends=True) if os.path.exists(ps_file) else []
    for line in ps_lines[1:]:
        comm = line.split(None, 5)[5].rstrip("\n")
        if not comm.startswith(SYSTEM_PREFIXES):
            mapper.collect(os.path.basename(comm))
    nettop_lines = open(nettop_file).read().splitlines(keepends=True) if os.path.exists(nettop_file) else []
    for line in nettop_lines:
        first = line.split(",", 1)[0]
        if "." in first:
            mapper.collect(first.rsplit(".", 1)[0])
    mapper.finalize()

    # ---- pass 2: rewrite
    for f, samples in plists.items():
        for s in samples:
            for t in s.get("tasks", []):
                t["name"] = mapper(t["name"])
        write_plists(f, samples)

    for f, lines in texts.items():
        for i, name, rest in list(text_task_lines(lines)):
            lines[i] = f"{mapper(name):<34} {rest}\n"
        open(f, "w").writelines(lines)

    if ps_lines:
        out = [ps_lines[0]]
        for line in ps_lines[1:]:
            pid, ppid, user, cpu, rss, comm = line.split(None, 5)
            comm = comm.rstrip("\n")
            if not comm.startswith(SYSTEM_PREFIXES):
                comm = mapper(os.path.basename(comm))
            out.append(f"{pid:>5} {ppid:>5} {anonymize_user(user):<16} {cpu:>5} {rss:>6} {comm}\n")
        open(ps_file, "w").writelines(out)

    if nettop_lines:
        out = []
        for line in nettop_lines:
            first, rest = line.split(",", 1) if "," in line else (line, "")
            if "." in first:
                name, pid = first.rsplit(".", 1)
                first = f"{mapper(name)}.{pid}"
            out.append(first + ("," + rest if rest else ""))
        open(nettop_file, "w").writelines(out)

    print(f"anonymized {len(mapper.map)} non-system process names in {capture}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
