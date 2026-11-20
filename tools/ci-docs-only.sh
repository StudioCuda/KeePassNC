#!/usr/bin/env bash
# Prints docs_only=true when every file a pull request changes is documentation, otherwise docs_only=false.
# CI uses this to skip the long test steps for text-only pull requests while still reporting the required checks.
# Usage: tools/ci-docs-only.sh <base-sha> <head-sha>
# When in doubt (no SHAs, git error, nothing changed) the answer is false, so everything gets tested.
set -uo pipefail

is_doc() {
  case "$1" in
    *.md | docs/* | LICENSE | .github/ISSUE_TEMPLATE/*) return 0 ;;
    *) return 1 ;;
  esac
}

answer=false
if [ -n "${1:-}" ] && [ -n "${2:-}" ] && files=$(git diff --name-status --no-renames "$1...$2") && [ -n "$files" ]; then
  answer=true
  while IFS=$'\t' read -r status f; do
    # appinfo/info.xml lists screenshots from docs/screenshots/ (tests/unit/appinfo.test.mjs checks they exist): deleting one isn't text-only.
    if is_doc "$f" && ! { [ "$status" = D ] && [[ "$f" == docs/screenshots/* ]]; }; then echo "doc:  $f" >&2; else echo "code: $f" >&2; answer=false; fi
  done <<< "$files"
fi
echo "docs_only=$answer"
