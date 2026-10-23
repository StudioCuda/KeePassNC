#!/usr/bin/env bash
# Measures how fast and how current some Ubuntu mirrors are, from wherever it runs (CI uses it on a GitHub runner).
# Per mirror: time to first byte and download speed of a real index file (3 rounds, the slowest one is dropped),
# and the age of its InRelease file, because a mirror that lags behind makes apt fail with hash mismatches.
# Prints a table, best first. Usage: tools/ci-mirror-bench.sh [rounds]
set -uo pipefail

rounds=${1:-3}
suite=noble-updates
file=dists/$suite/main/binary-amd64/Packages.xz
mirrors=(
  http://azure.archive.ubuntu.com/ubuntu
  http://archive.ubuntu.com/ubuntu
  http://us.archive.ubuntu.com/ubuntu
  https://mirrors.edge.kernel.org/ubuntu
  http://mirror.us.leaseweb.net/ubuntu
  https://mirrors.xtom.com/ubuntu
  https://mirror.math.princeton.edu/pub/ubuntu
  https://mirrors.mit.edu/ubuntu
  https://ubuntu.osuosl.org/ubuntu
  https://mirrors.cat.pdx.edu/ubuntu
  https://mirror.enzu.com/ubuntu
)

now=$(date +%s)
rows=()
for m in "${mirrors[@]}"; do
  speeds=() ttfbs=() fails=0
  for ((r = 1; r <= rounds; r++)); do
    out=$(curl -s -o /dev/null --max-time 45 -w '%{http_code} %{time_starttransfer} %{speed_download} %{size_download}' "$m/$file") || { fails=$((fails + 1)); continue; }
    read -r code ttfb speed size <<<"$out"
    if [ "$code" = 200 ] && [ "$size" -gt 100000 ]; then
      speeds+=("$speed") ttfbs+=("$ttfb")
    else
      fails=$((fails + 1))
    fi
  done
  age=-
  date_hdr=$(curl -s --max-time 20 "$m/dists/$suite/InRelease" | sed -n 's/^Date: //p' | head -1)
  [ -n "$date_hdr" ] && age=$(( (now - $(date -d "$date_hdr" +%s 2>/dev/null || echo "$now")) / 3600 ))
  if [ ${#speeds[@]} -gt 0 ]; then
    # median speed in MB/s, mean time to first byte in ms
    med=$(printf '%s\n' "${speeds[@]}" | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]/1048576}')
    ttfb=$(printf '%s\n' "${ttfbs[@]}" | awk '{s+=$1} END {print s/NR*1000}')
  else
    med=0 ttfb=0
  fi
  rows+=("$(printf '%.2f|%s|%.0f|%s|%s/%s' "$med" "$m" "$ttfb" "$age" "$fails" "$rounds")")
done

printf '%-8s %-48s %-9s %-10s %s\n' 'MB/s' mirror 'ttfb ms' 'age (h)' 'failed'
printf '%s\n' "${rows[@]}" | sort -t'|' -k1,1 -nr | awk -F'|' '{printf "%-8s %-48s %-9s %-10s %s\n", $1, $2, $3, $4, $5}'
