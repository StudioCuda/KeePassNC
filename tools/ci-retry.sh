#!/usr/bin/env bash
# Runs a command with a time limit per attempt and retries it a few times.
# CI uses this for the downloads (apt, Playwright browsers): they take seconds on a good day, but a slow mirror
# once held a job for 45 minutes. A stuck download is cut off and tried again instead of blocking the pull request.
# Usage: tools/ci-retry.sh <seconds-per-attempt> <attempts> <command> [args...]
set -uo pipefail

limit=$1
attempts=$2
shift 2

for ((try = 1; try <= attempts; try++)); do
  timeout "$limit" "$@" && exit 0
  echo "attempt $try/$attempts failed: $*" >&2
done
exit 1
