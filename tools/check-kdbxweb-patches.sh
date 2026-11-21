#!/bin/sh
# Checks that vendor/kdbxweb/patches/*.patch, applied in file-name order to the pristine upstream commit in
# vendor/kdbxweb/UPSTREAM_COMMIT, give exactly vendor/kdbxweb/lib/.
# Usage: tools/check-kdbxweb-patches.sh [path to a checkout of github.com/keeweb/kdbxweb]
# Without a path, the script clones upstream into a temporary directory (needs network).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
vendor="$root/vendor/kdbxweb"
commit=$(tr -d ' \r\n' < "$vendor/UPSTREAM_COMMIT")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ $# -ge 1 ]; then
  git -c core.autocrlf=false -c core.eol=lf clone -q --no-checkout "$1" "$work/up"
else
  git -c core.autocrlf=false -c core.eol=lf clone -q --no-checkout https://github.com/keeweb/kdbxweb.git "$work/up"
fi
git -C "$work/up" -c core.autocrlf=false -c core.eol=lf checkout -q "$commit"
rm -rf "$work/up/.git"

for p in "$vendor"/patches/*.patch; do
  if ! (cd "$work/up" && git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn "$p"); then
    echo "FAIL: $(basename "$p") does not apply on top of the patches before it" >&2
    exit 1
  fi
done

if ! diff -r "$work/up/lib" "$vendor/lib" > "$work/diff.txt"; then
  echo "FAIL: lib/ is not what the patches produce:" >&2
  head -40 "$work/diff.txt" >&2
  exit 1
fi
echo "ok: $(ls "$vendor"/patches/*.patch | wc -l | tr -d ' ') patches on $commit give vendor/kdbxweb/lib"
