# KeePassNC

Schlanker KDBX-Passwortmanager fuer den Browser, gedacht als Nachfolger der Nextcloud-App "KeeWeb".
Die Datenbank bleibt eine ganz normale KeePass-Datei (KDBX 3.x/4.x) in der Nextcloud und kann jederzeit weiterhin mit
KeePassXC, KeePassDX, Strongbox usw. geoeffnet werden.

**Sicherheitsmodell:** Die Datei wird im Browser geladen, dort entschluesselt, dort bearbeitet und verschluesselt wieder
zurueckgeschrieben. Master-Passwort und Klartext verlassen den Browser nie; der Server sieht nur die verschluesselte Datei.
Es werden keine externen Skripte, Schriften oder Dienste geladen (strikte Content-Security-Policy).

## Stand (v0.3)
Funktioniert und ist automatisch getestet (siehe `STATUS.md`): Oeffnen per WebDAV (Nextcloud-App-Passwort) oder lokaler Datei,
KDBX 3.1 / 4.0 / 4.1, AES und ChaCha20, Argon2d/Argon2id/AES-KDF, Schluesseldatei, Gruppen, Suche, Eintraege anlegen/bearbeiten/
loeschen (Papierkorb), geschuetzte Zusatzfelder, Tags, TOTP, Anhaenge herunterladen, Passwortgenerator, Auto-Sperre,
Zwischenablage-Bereinigung, Speichern mit ETag-Pruefung, Sicherungskopie und Zusammenfuehrung bei Konflikten.

Neu in v0.2: **Nextcloud-App** (`nextcloud-app/keepassnc`). Klick auf eine `.kdbx`-Datei in der Dateiansicht oeffnet sie in KeePassNC;
Anmeldung laeuft ueber die bestehende Nextcloud-Sitzung (kein App-Passwort noetig), Entschluesselung weiterhin nur im Browser.

Neu in v0.3 (Ausfallsicherheit, siehe `STATUS.md`):
- **Offline-Kopie** (optional, pro Browser): die *verschluesselte* KDBX wird in IndexedDB vorgehalten. Faellt der Server aus
  (Wartungsmodus, Absturz, kein Netz), laesst sich die Datei weiter oeffnen und bearbeiten; Aenderungen werden lokal gesichert
  und automatisch hochgeladen bzw. mit Fremdaenderungen zusammengefuehrt, sobald der Server wieder da ist.
- **App-Seite offline** per Service Worker: KeePassNC startet auch, wenn Nextcloud gar nicht antwortet (einmal online geoeffnet haben).
- **Automatisches Speichern/Abgleichen**: bei jeder Aenderung, alle 1/2/5/10 Minuten oder nur manuell; Intervall-Modus holt auch
  Aenderungen anderer Geraete. Merge-Schleife (max. 3 Versuche), Sicherungskopien wie bisher.
- **Einstellungen**: Auto-Sperre (1-60 min), Zwischenablage-Dauer, Sperren bei Tab im Hintergrund.
- Auf fremden Geraeten die Offline-Option ausgeschaltet lassen; "Lokale Daten dieses Browsers loeschen" entfernt alles wieder.

Noch **nicht** vorhanden: Speichern der Schluesseldatei auf dem Geraet, Uebersetzungen (Oberflaeche nur Deutsch), Gruppenverwaltung, Anhaenge hochladen, Verlaufsansicht, Passkeys, Steam-TOTP.

## Als Nextcloud-App installieren
    npm install && npm run package:nc      # erzeugt keepassnc-nextcloud-app.tar.gz
    # Archiv im Nextcloud-Verzeichnis nach apps/ (oder custom_apps/) entpacken, dann:
    php occ app:enable keepassnc
Getestet mit Nextcloud 34.0.4 und 35.0.1 (PHP 8.3, SQLite). Die App nutzt nur oeffentliche Schnittstellen (WebDAV, `/csrftoken`,
`LoadAdditionalScriptsEvent`, `registerFileAction`); in `info.xml` steht `max-version="99"`, damit kuenftige Versionen nicht
ausgesperrt werden. Der Test `npm run test:nc` (mit `NC_DIR`/`NC_PORT`) installiert eine frische Nextcloud aus einem Quellordner.

## Benutzen (eigenstaendige Webseite)
Die Dateien in `web/` auf einen HTTPS-Webserver legen (WebCrypto verlangt HTTPS oder localhost), `index.html` oeffnen,
WebDAV-Adresse der KDBX-Datei, Benutzer und **App-Passwort** (nicht das Kontopasswort) eintragen.
Wichtig: Liegt die Seite auf einer anderen Domain als die Nextcloud, muss die Nextcloud CORS fuer WebDAV erlauben; einfacher ist
es, die Seite auf derselben Domain auszuliefern (spaeter: als Nextcloud-App, dann gleiche Herkunft und Anmeldung per Sitzung).
`?autolock=SEKUNDEN` ueberschreibt die Auto-Sperre (Standard 300 s).

## Entwickeln
    npm install
    npm run build      # baut web/keepassnc.js (kdbxweb + hash-wasm + App-Code, ca. 140 KB)
    npm test           # Build, Unit-, Kompatibilitaets-, End-to-End- und Ausfall-Tests
    NC_DIR=/pfad/nextcloud NC_PORT=18035 npm run test:nc   # Nextcloud-Integration inkl. Wartungsmodus/Serverabsturz

Voraussetzungen fuer die Tests: Node 20+, `keepassxc-cli` (KeePassXC 2.7.x), Python 3 mit `pykeepass`, Chromium
(`/opt/pw-browsers` oder Umgebungsvariable `CHROMIUM`).

## Aufbau
- `src/vault.js` Tresor-Logik (laden, aendern, speichern, Konflikte), `src/webdav.js` WebDAV mit If-Match, `src/totp.js` TOTP, `src/main.js` Oberflaeche
- `vendor/kdbxweb/` kdbxweb (MIT, Git-Stand siehe `UPSTREAM_COMMIT`) mit Patch gegen leere optionale Gruppenfelder
- `tests/unit` RFC-6238-Vektoren, `tests/compat` kdbxweb gegen KeePassXC, `tests/e2e` Browser gegen WebDAV-Testserver + KeePassXC

## Lizenz und Herkunft
kdbxweb: MIT (Antelle). Ideen und Verhalten orientieren sich an KeePassXC (GPL); es wurde kein KeePassXC-Code uebernommen.
Die Nextcloud-App ist von jhass/nextcloud-keeweb (AGPL-3) inspiriert und steht unter AGPL-3; `COPYING` liegt bei.
