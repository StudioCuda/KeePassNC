#!/usr/bin/env bash
# Installs apt packages on a CI runner, as lean as possible, and prints how long each phase took.
# The runner is thrown away after the job, so dpkg may skip fsync (nothing to recover after a crash).
# The timings show whether a slow mirror (update/download) or the local disk (unpack) eats the time.
# Usage: tools/ci-apt.sh <package>...
set -euo pipefail

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

as_root tee /etc/apt/apt.conf.d/99ci-fast >/dev/null <<'CONF'
Acquire::Languages "none";
Acquire::Retries "3";
APT::Install-Recommends "false";
DPkg::Options:: "--force-unsafe-io";
CONF

echo "apt sources in use:"
grep -hE '^(URIs|deb )' /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null | sort -u || true

phase() {
  local name=$1 start=$SECONDS
  shift
  "$@"
  echo "apt timing: $name took $((SECONDS - start))s"
}

phase update as_root apt-get update
phase download as_root apt-get install -y --download-only "$@"
phase install as_root apt-get install -y "$@"
