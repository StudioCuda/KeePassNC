#!/usr/bin/env bash
# Publishes a GitHub release to the Nextcloud App Store: fresh clone of the tag, sign it (tools/sign-release.sh),
# attach the signed archive to the GitHub release, register the version with the App Store. Runs on the maintainer's machine
# (WSL), the private key never leaves it. On Windows by double click: tools/publish-nextcloud-release.cmd.
#
#   tools/publish-release.sh            # newest GitHub release
#   tools/publish-release.sh 0.7.1      # specific version
#
# One-time setup (see docs/APPSTORE.md): gh auth login, App Store token in "keepassnc.appstore-token" next to the
# key, Nextcloud for signing in /opt/nc-sign/nextcloud.
# Overridable: CERT_DIR, KEY, CRT, TOKEN_FILE, NC_DIR, REPO, WORK.
# SKIP_STORE=1 only signs and replaces the archive in the GitHub release, without the App Store (Windows: tools/sign-github-release.cmd).
set -euo pipefail

REPO="${REPO:-StudioCuda/KeePassNC}"
NC_DIR="${NC_DIR:-/opt/nc-sign/nextcloud}"
STORE_API="${STORE_API:-https://apps.nextcloud.com/api/v1/apps/releases}"
SKIP_STORE="${SKIP_STORE:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mAbbruch: %s\033[0m\n' "$*" >&2; exit 1; }

# --- Find the key folder: ~/.nextcloud/certificates or the Windows user folder
if [ -z "${CERT_DIR:-}" ]; then
    for d in "$HOME/.nextcloud/certificates" /mnt/c/Users/*/.nextcloud/certificates; do
        if [ -f "$d/keepassnc.key" ]; then CERT_DIR="$d"; break; fi
    done
fi
[ -n "${CERT_DIR:-}" ] || fail "keepassnc.key nicht gefunden (gesucht in ~/.nextcloud/certificates und /mnt/c/Users/*/.nextcloud/certificates). CERT_DIR setzen."
KEY="${KEY:-$CERT_DIR/keepassnc.key}"
CRT="${CRT:-$CERT_DIR/keepassnc.crt}"
TOKEN_FILE="${TOKEN_FILE:-$CERT_DIR/keepassnc.appstore-token}"

# --- Check everything up front, so nothing is missing halfway through
say "Vorab-Pruefung"
for c in git gh node npm php openssl curl tar; do command -v "$c" >/dev/null || fail "Programm '$c' fehlt (sudo apt install $c)."; done
[ -f "$KEY" ] || fail "Schluessel fehlt: $KEY"
[ -f "$CRT" ] || fail "Zertifikat fehlt: $CRT"
[ -n "$SKIP_STORE" ] || [ -s "$TOKEN_FILE" ] || fail "App-Store-Token fehlt: $TOKEN_FILE (von https://apps.nextcloud.com/account/token, siehe docs/APPSTORE.md)"
[ -f "$NC_DIR/occ" ] || fail "Kein Nextcloud zum Signieren in $NC_DIR"
[ -w "$NC_DIR/config" ] || fail "$NC_DIR/config ist nicht beschreibbar: sudo chown -R \$USER $NC_DIR"
gh auth status >/dev/null 2>&1 || fail "GitHub-Anmeldung fehlt: gh auth login"
[ "$(openssl pkey -in "$KEY" -pubout | openssl sha256)" = "$(openssl x509 -in "$CRT" -noout -pubkey | openssl sha256)" ] \
    || fail "Schluessel und Zertifikat gehoeren nicht zusammen."
echo "Schluessel: $KEY"

# --- Version: argument or newest release
if [ $# -ge 1 ]; then ver="${1#v}"; else ver="$(gh release view --repo "$REPO" --json tagName -q .tagName)"; ver="${ver#v}"; fi
tag="v$ver"
gh release view "$tag" --repo "$REPO" >/dev/null 2>&1 || fail "Auf GitHub gibt es kein Release $tag."
asset="keepassnc-$ver.tar.gz"
if gh release view "$tag" --repo "$REPO" --json assets -q '.assets[].name' | grep -x "$asset" >/dev/null; then
    read -r -p "$tag hat schon ein signiertes Archiv. Neu signieren und ersetzen? (j/N) " a
    [ "$a" = j ] || [ "$a" = J ] || fail "Nichts geaendert."
fi
if [ -n "$SKIP_STORE" ]; then say "Signiere KeePassNC $ver (ohne App Store)"; else say "Veroeffentliche KeePassNC $ver"; fi

# --- Fresh clone in the WSL home (not on a Windows drive: npm ci fails there)
WORK="${WORK:-$HOME/.cache/keepassnc-release}"
dir="$WORK/$tag"
rm -rf "$dir"; mkdir -p "$WORK"
git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "${CLONE_URL:-https://github.com/$REPO.git}" "$dir"
got="$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' "$dir/nextcloud-app/keepassnc/appinfo/info.xml" | head -1)"
[ "$got" = "$ver" ] || fail "info.xml im Tag $tag sagt $got, nicht $ver."
say "Abhaengigkeiten installieren"
npm --prefix "$dir" ci --no-audit --no-fund --loglevel=error

say "Bauen und signieren"
NC_DIR="$NC_DIR" KEY="$KEY" CRT="$CRT" bash "$dir/tools/sign-release.sh" >/dev/null
out="$dir/$asset"
[ -f "$out" ] || fail "Signiertes Archiv fehlt: $out"
tar tzf "$out" | grep -x 'keepassnc/appinfo/signature.json' >/dev/null || fail "signature.json fehlt im Archiv."
sig="$(openssl dgst -sha512 -sign "$KEY" "$out" | openssl base64 -A)"
# Cross-check with the public part of the certificate, exactly as the App Store checks
openssl x509 -in "$CRT" -noout -pubkey > "$dir/pub.pem"
printf '%s' "$sig" | openssl base64 -d -A > "$dir/sig.bin"
openssl dgst -sha512 -verify "$dir/pub.pem" -signature "$dir/sig.bin" "$out" >/dev/null || fail "Signatur laesst sich nicht pruefen."
echo "Archiv signiert: $out"

say "An das GitHub-Release haengen"
gh release upload "$tag" "$out" --repo "$REPO" --clobber
url="https://github.com/$REPO/releases/download/$tag/$asset"
# The store downloads exactly this file: download it ourselves once and compare
curl -fsSL "$url" -o "$dir/check.tar.gz" || fail "Download von $url klappt nicht."
cmp -s "$out" "$dir/check.tar.gz" || fail "Die Datei auf GitHub ist nicht die eben signierte."
# The unsigned archive from release.yml was only the placeholder until here; from now on there is only the signed one.
unsigned="keepassnc-$ver-unsigned.tar.gz"
if gh release view "$tag" --repo "$REPO" --json assets -q '.assets[].name' | grep -x "$unsigned" >/dev/null; then
    gh release delete-asset "$tag" "$unsigned" --repo "$REPO" --yes
    echo "Unsigniertes Archiv entfernt: $unsigned"
fi

if [ -n "$SKIP_STORE" ]; then
    rm -rf "$dir"
    say "Fertig: KeePassNC $ver ist signiert und haengt am GitHub-Release, der App Store bleibt unberuehrt."
    echo "https://github.com/$REPO/releases/tag/$tag"
    exit 0
fi

say "Beim App Store anmelden"
body="$(printf '{"download":"%s","signature":"%s","nightly":false}' "$url" "$sig")"
code="$(curl -sS -o "$dir/store-answer.txt" -w '%{http_code}' -X POST "$STORE_API" \
    -H 'Content-Type: application/json' -H @<(printf 'Authorization: Token %s\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")") \
    --data "$body")"
case "$code" in
    200|201) ;;
    401|403) fail "Der App Store lehnt den Token ab (HTTP $code). Token erneuern: https://apps.nextcloud.com/account/token" ;;
    *) fail "Der App Store antwortet mit HTTP $code: $(head -c 500 "$dir/store-answer.txt")" ;;
esac

rm -rf "$dir"
say "Fertig: KeePassNC $ver ist im App Store (HTTP $code)."
echo "https://apps.nextcloud.com/apps/keepassnc"
echo "Nextcloud-Server zeigen das Update nach einer Weile unter \"Apps\"."
