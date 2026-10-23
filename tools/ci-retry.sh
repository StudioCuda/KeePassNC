#!/usr/bin/env bash
# Runs a command with a time limit per attempt and retries it a few times.
# CI uses this for the downloads (apt, Playwright browsers): they take seconds on a good day, but a slow mirror
# once held a job for 45 minutes. A stuck download is cut off and tried again instead of blocking the pull request.
# `timeout` only stops the command itself, not an apt-get it started through sudo. That one would keep the dpkg lock
# and fail every retry, so a failed attempt stops leftover apt-get processes and waits for the lock before going on.
# Usage: tools/ci-retry.sh <seconds-per-attempt> <attempts> <command> [args...]
set -uo pipefail

limit=$1
attempts=$2
shift 2

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

for ((try = 1; try <= attempts; try++)); do
  timeout "$limit" "$@" && exit 0
  echo "attempt $try/$attempts failed: $*" >&2
  as_root pkill -x apt-get 2>/dev/null
  for _ in $(seq 60); do
    as_root fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock >/dev/null 2>&1 || break
    sleep 2
  done
done
exit 1
