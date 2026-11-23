#!/usr/bin/env bash
# Capture raw data-source output into fixtures/raw/ for parser development.
#
# Usage:
#   scripts/capture-fixtures.sh            # everything (prompts for sudo)
#   SKIP_SUDO=1 scripts/capture-fixtures.sh  # unprivileged sources only
#
# Output files are written by this (user) shell, so they are user-owned even
# though powermetrics itself runs under sudo.
set -euo pipefail

cd "$(dirname "$0")/.."

CHIP=$(sysctl -n machdep.cpu.brand_string | tr '[:upper:] ' '[:lower:]-')   # e.g. apple-m1
OS=$(sw_vers -productVersion)
TAG="${CHIP}_macos-${OS}"
OUT="fixtures/raw/${TAG}"
mkdir -p "$OUT/powermetrics" "$OUT/unprivileged"

echo "==> Capturing into $OUT"

# ---------------------------------------------------------------- unprivileged
U="$OUT/unprivileged"
sysctl hw.model hw.memsize hw.ncpu hw.nperflevels machdep.cpu.brand_string \
  'hw.perflevel0.name' 'hw.perflevel0.logicalcpu' 'hw.perflevel0.physicalcpu' \
  'hw.perflevel1.name' 'hw.perflevel1.logicalcpu' 'hw.perflevel1.physicalcpu' \
  > "$U/sysctl-topology.txt"
sysctl vm.swapusage vm.loadavg kern.boottime kern.memorystatus_vm_pressure_level \
  hw.pagesize vm.page_free_count > "$U/sysctl-runtime.txt" 2>&1 || true
vm_stat > "$U/vm_stat.txt"
memory_pressure -Q > "$U/memory_pressure.txt" 2>&1 || true
pmset -g batt > "$U/pmset-batt.txt" 2>&1 || true
sw_vers > "$U/sw_vers.txt"
# Per-process network totals only (-P): no remote hosts/addresses recorded.
nettop -P -L 2 -x -J bytes_in,bytes_out > "$U/nettop-per-process.csv" 2>&1 || true
ps -Ao pid,ppid,user,%cpu,rss,comm -r | head -40 > "$U/ps-top.txt" || true   # head closes pipe early (SIGPIPE)
echo "    unprivileged: done"

if [[ "${SKIP_SUDO:-0}" == "1" ]]; then
  echo "==> SKIP_SUDO=1, skipping powermetrics"
  python3 -I scripts/anonymize-fixtures.py "$OUT"
  exit 0
fi

# ---------------------------------------------------------------- powermetrics
P="$OUT/powermetrics"
sudo -v   # prompt once up front

ALL_FLAGS=(-f plist -i 1000 --samplers all --show-process-energy --show-extra-power-info --handle-invalid-values)
APP_FLAGS=(-f plist -i 1000 --samplers cpu_power,gpu_power,ane_power,thermal,tasks,network,disk,battery --show-process-energy --handle-invalid-values)

echo "    [1/4] idle, all samplers (5 samples) — key discovery"
sudo powermetrics "${ALL_FLAGS[@]}" -n 5 > "$P/idle-all.plist"

echo "    [2/4] idle, app sampler set (5 samples)"
sudo powermetrics "${APP_FLAGS[@]}" -n 5 > "$P/idle-app.plist"

echo "    [3/4] CPU load (one 'yes' per logical core), app sampler set (5 samples)"
NCPU=$(sysctl -n hw.ncpu)
PIDS=()
for _ in $(seq 1 "$NCPU"); do yes > /dev/null & PIDS+=($!); done
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT
sleep 2
sudo powermetrics "${APP_FLAGS[@]}" -n 5 > "$P/cpu-load-app.plist"
kill "${PIDS[@]}" 2>/dev/null || true
trap - EXIT

echo "    [4/4] idle, all samplers, text format (2 samples) — human reference"
sudo powermetrics -i 1000 --samplers all --show-process-energy -n 2 > "$P/idle-all.txt"

echo "==> Anonymizing non-system process names and users"
python3 -I scripts/anonymize-fixtures.py "$OUT"

echo "==> Done. Files:"
ls -la "$P" "$U"
