#!/usr/bin/env bash
# Wie tools/publish-nextcloud-release.sh, aber ohne App Store: frischer Klon des Tags, signieren, im GitHub-Release das unsignierte
# Archiv durch das signierte ersetzen. Fuer Versionen, die im App Store uebersprungen werden.
#
#   tools/sign-github-release.sh            # neuestes GitHub-Release
#   tools/sign-github-release.sh 0.8.1      # bestimmte Version
exec env SKIP_STORE=1 bash "$(dirname "$0")/publish-nextcloud-release.sh" "$@"
