#!/usr/bin/env bash
# Signs the app and creates the store archive + signature for the upload. Usage:
#   NC_DIR=/path/to/nextcloud KEY=~/.nextcloud/certificates/keepassnc.key CRT=~/.nextcloud/certificates/keepassnc.crt tools/sign-release.sh
# The private key never leaves the machine and does NOT belong in the repository.
set -euo pipefail
: "${NC_DIR:?NC_DIR (Nextcloud-Ordner mit occ) fehlt}" "${KEY:?KEY fehlt}" "${CRT:?CRT fehlt}"
root="$(cd "$(dirname "$0")/.." && pwd)"
npm --prefix "$root" run build
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp -r "$root/nextcloud-app/keepassnc" "$work/keepassnc"
php "$NC_DIR/occ" integrity:sign-app --privateKey="$KEY" --certificate="$CRT" --path="$work/keepassnc"
# occ reports some errors (e.g. "Cannot write into config directory") with exit code 0, so check yourself.
if [ ! -s "$work/keepassnc/appinfo/signature.json" ]; then
  echo "Signieren fehlgeschlagen: appinfo/signature.json fehlt. Ist \$NC_DIR fuer diesen Benutzer beschreibbar?" >&2
  exit 1
fi
ver="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$work/keepassnc/appinfo/info.xml" | head -1)"
out="$root/keepassnc-$ver.tar.gz"
tar czf "$out" -C "$work" keepassnc
echo "Archiv:   $out"
echo "Signatur (in das Upload-Formular einfuegen):"
openssl dgst -sha512 -sign "$KEY" "$out" | openssl base64 -A; echo
