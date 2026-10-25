#!/usr/bin/env bash
# Runs browser test suites (npm run test:<name>) in parallel lanes and reports each suite's result and duration.
# Every argument is one lane: a space-separated list of suite names that run one after the other. The lanes run at the
# same time. A failing suite doesn't stop its lane, so one run shows every failure. The suites don't share ports or
# folders (the test servers use port 0 and mkdtemp folders), see the lanes in .github/workflows/nextcloud.yml.
# Logs are printed as collapsible groups at the end; the table goes to the job summary when GitHub provides one.
# Usage: tools/ci-suites.sh "e2e credentials" "keyfile ui"
set -uo pipefail

[ $# -gt 0 ] || { echo "usage: $0 \"suite suite\" [\"suite suite\"...]" >&2; exit 2; }

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

lane() {
  local name s r
  for name in $1; do
    s=$SECONDS r=ok
    npm run "test:$name" > "$out/$name.log" 2>&1 || r=FAIL
    echo "$name $r $((SECONDS - s))" >> "$out/results"
  done
}

start=$SECONDS
for l in "$@"; do lane "$l" & done
wait
total=$((SECONDS - start))

fail=0
for l in "$@"; do
  for name in $l; do
    read -r _ r t < <(grep "^$name " "$out/results")
    echo "::group::$name: $r, ${t}s"
    cat "$out/$name.log"
    echo "::endgroup::"
    [ "$r" = ok ] || { fail=1; echo "::error::test:$name failed"; }
  done
done

{
  echo "### Browser suites: ${total}s in total, $# lanes"
  echo '| suite | result | seconds |'
  echo '|---|---|---|'
  sort "$out/results" | awk '{ print "| " $1 " | " $2 " | " $3 " |" }'
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit $fail
