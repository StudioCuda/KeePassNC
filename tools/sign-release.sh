#!/usr/bin/env bash
# Signiert die App und erzeugt das Store-Archiv + Signatur fuer den Upload. Aufruf:
#   NC_DIR=/pfad/nextcloud KEY=~/.nextcloud/certificates/keepassnc.key CRT=~/.nextcloud/certificates/keepassnc.crt tools/sign-release.sh
# Der private Schluessel verlaesst den Rechner nie und gehoert NICHT ins Repository.
set -euo pipefail
: "${NC_DIR:?NC_DIR (Nextcloud-Ordner mit occ) fehlt}" "${KEY:?KEY fehlt}" "${CRT:?CRT fehlt}"
root="$(cd "$(dirname "$0")/.." && pwd)"
npm --prefix "$root" run build
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp -r "$root/nextcloud-app/keepassnc" "$work/keepassnc"
php "$NC_DIR/occ" integrity:sign-app --privateKey="$KEY" --certificate="$CRT" --path="$work/keepassnc"
ver="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$work/keepassnc/appinfo/info.xml" | head -1)"
out="$root/keepassnc-$ver.tar.gz"
tar czf "$out" -C "$work" keepassnc
echo "Archiv:   $out"
echo "Signatur (in das Upload-Formular einfuegen):"
openssl dgst -sha512 -sign "$KEY" "$out" | openssl base64 -A; echo
