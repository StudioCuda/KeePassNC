# Veröffentlichung im Nextcloud App Store

Stand der Vorbereitung (v0.5.2): `info.xml` mit SPDX-Lizenz `AGPL-3.0-or-later`, `CHANGELOG.md` im App-Ordner, Archiv mit genau einem
Top-Ordner `keepassnc` ohne `.git`. Getestet gegen die offiziellen Pakete Nextcloud 34.0.4 und 35.0.1.

## Was nur der Inhaber tun kann
1. **GitHub-Repo** anlegen (öffentlich, Name z. B. `keepassnc`), Code hochladen. Danach in `info.xml` eintragen:
   `<bugs>https://github.com/<konto>/keepassnc/issues</bugs>` sowie optional `<website>` und `<repository>`.
2. **Zertifikat beantragen** (einmalig, App-ID `keepassnc`):
   ```
   mkdir -p ~/.nextcloud/certificates && cd ~/.nextcloud/certificates
   openssl req -nodes -newkey rsa:4096 -keyout keepassnc.key -out keepassnc.csr -subj "/CN=keepassnc"
   ```
   Inhalt von `keepassnc.csr` als Pull Request in `github.com/nextcloud/app-certificate-requests` einreichen (Datei `keepassnc/keepassnc.csr`, Link zum
   öffentlichen Repo in die Beschreibung). Das signierte `keepassnc.crt` kommt als Antwort im PR; unter `~/.nextcloud/certificates/` ablegen.
   **Den privaten Schlüssel (`.key`) sichern und niemals ins Repository legen.** Geht er verloren, müssen alle Releases neu registriert werden.
3. **App registrieren** auf `apps.nextcloud.com/developer/apps/new` (Zertifikat + Signatur über die App-ID):
   `echo -n "keepassnc" | openssl dgst -sha512 -sign ~/.nextcloud/certificates/keepassnc.key | openssl base64`

## Pro Release
1. Version in `package.json`, `appinfo/info.xml` und `CHANGELOG.md` anheben, `npm test` und `npm run test:nc` laufen lassen.
2. `NC_DIR=... KEY=... CRT=... tools/sign-release.sh` signiert (occ integrity:sign-app) und erzeugt `keepassnc-<version>.tar.gz` samt Signatur.
3. Archiv als Release-Asset hosten (nicht den automatischen GitHub-„Source code“-Download, dessen Ordnername passt nicht) und auf
   `apps.nextcloud.com/developer/apps/releases/new` URL + Signatur eintragen.
Nach dem Signieren darf sich keine Datei im Archiv mehr ändern.
