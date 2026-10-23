#!/usr/bin/env bash
# Sets the Ubuntu mirrors a GitHub runner's apt uses, and moves on to the next one after a failed attempt.
# The runner image points apt at `mirror+file:/etc/apt/apt-mirrors.txt` (the Azure mirror, normally the fastest by far).
# apt's mirror method shuffles entries that have the same priority, so every line carries a `priority:N` tag by its
# position: the first mirror is used for every file, and apt falls over to the next one for a file that fails, so a dead
# mirror costs seconds. A slow one does not fail, it just drags: ci-retry.sh rotates the list after every failed attempt,
# so the retry starts on another mirror. The order comes from tools/ci-mirror-bench.sh run on three runners (see the mirror-bench
# workflow): all of them have the whole noble archive including -security and were at most 4 hours behind.
# Left out on purpose: mirrors.edge.kernel.org (timeouts), mirror.enzu.com (dead), mirrors.mit.edu (12 hours behind).
# Usage: tools/ci-mirrors.sh set | rotate
set -euo pipefail

file=/etc/apt/apt-mirrors.txt
mirrors=(
  http://azure.archive.ubuntu.com/ubuntu
  http://mirror.us.leaseweb.net/ubuntu
  https://mirrors.xtom.com/ubuntu
  https://mirror.math.princeton.edu/pub/ubuntu
  http://us.archive.ubuntu.com/ubuntu
)

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

# Not a runner image that reads this file: nothing to do.
[ -f "$file" ] || exit 0

# stdin: one URL per line, best first. stdout: the same with the priority tags apt reads.
tag() { awk -F'\t' '{printf "%s\tpriority:%d\n", $1, NR}'; }

case ${1:-} in
  # ci-apt.sh calls this on every attempt: once the list is ours, leave its order alone, or a retry would start on the
  # mirror that was just too slow.
  set) grep -q 'priority:' "$file" || printf '%s\n' "${mirrors[@]}" | tag | as_root tee "$file" >/dev/null ;;
  rotate)
    urls=$(cut -f1 "$file")
    { printf '%s\n' "$urls" | tail -n +2; printf '%s\n' "$urls" | head -n 1; } | tag | as_root tee "$file.new" >/dev/null
    as_root mv "$file.new" "$file" ;;
  *) echo "usage: $0 set|rotate" >&2; exit 2 ;;
esac
echo "apt mirrors, first one is used first:"; cat "$file"
