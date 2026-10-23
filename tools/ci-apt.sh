#!/usr/bin/env bash
# Installs apt packages on a CI runner, as lean as possible, and prints how long each phase took.
# The runner is thrown away after the job, so dpkg may skip fsync (nothing to recover after a crash).
# The timings show whether a slow mirror (update/download) or the local disk (unpack) eats the time.
# The downloaded .deb files go to $APT_CACHE_DIR (a folder the workflow caches between runs), and the setting stays in
# place for later apt calls, so Playwright's `install-deps` uses and fills the same cache. A stalled connection is cut off
# after 20 s and apt retries it; an attempt that ci-retry.sh stops leaves a partial file that the next one resumes.
# Usage: APT_CACHE_DIR=<dir> tools/ci-apt.sh <package>...
set -euo pipefail

cache=${APT_CACHE_DIR:-$HOME/.cache/ci-apt}
mkdir -p "$cache/partial"

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

as_root tee /etc/apt/apt.conf.d/99ci-fast >/dev/null <<CONF
Acquire::Languages "none";
Acquire::Retries "3";
APT::Install-Recommends "false";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Sandbox::User "root";
Dir::Cache::archives "$cache";
DPkg::Options:: "--force-unsafe-io";
CONF

echo "apt cache: $(ls "$cache" | grep -c '\.deb$') packages in $cache"
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
