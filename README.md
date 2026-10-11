# KeePassNC

Schlanker KDBX-Passwortmanager fuer den Browser, gedacht als Nachfolger der Nextcloud-App "KeeWeb".
Die Datenbank bleibt eine ganz normale KeePass-Datei (KDBX 3.x/4.x) in der Nextcloud und kann jederzeit weiterhin mit
KeePassXC, KeePassDX, Strongbox usw. geoeffnet werden.

**Sicherheitsmodell:** Die Datei wird im Browser geladen, dort entschluesselt, dort bearbeitet und verschluesselt wieder
zurueckgeschrieben. Master-Passwort und Klartext verlassen den Browser nie; der Server sieht nur die verschluesselte Datei.
Es werden keine externen Skripte, Schriften oder Dienste geladen (strikte Content-Security-Policy).

## Stand (v0.1)
Funktioniert und ist automatisch getestet (siehe `STATUS.md`): Oeffnen per WebDAV (Nextcloud-App-Passwort) oder lokaler Datei,
KDBX 3.1 / 4.0 / 4.1, AES und ChaCha20, Argon2d/Argon2id/AES-KDF, Schluesseldatei, Gruppen, Suche, Eintraege anlegen/bearbeiten/
loeschen (Papierkorb), geschuetzte Zusatzfelder, Tags, TOTP, Anhaenge herunterladen, Passwortgenerator, Auto-Sperre,
Zwischenablage-Bereinigung, Speichern mit ETag-Pruefung, Sicherungskopie und Zusammenfuehrung bei Konflikten.

Noch **nicht** vorhanden: Verpackung als Nextcloud-App, Gruppenverwaltung, Anhaenge hochladen, Verlaufsansicht, Passkeys, Steam-TOTP.

## Benutzen
Die Dateien in `web/` auf einen HTTPS-Webserver legen (WebCrypto verlangt HTTPS oder localhost), `index.html` oeffnen,
WebDAV-Adresse der KDBX-Datei, Benutzer und **App-Passwort** (nicht das Kontopasswort) eintragen.
Wichtig: Liegt die Seite auf einer anderen Domain als die Nextcloud, muss die Nextcloud CORS fuer WebDAV erlauben; einfacher ist
es, die Seite auf derselben Domain auszuliefern (spaeter: als Nextcloud-App, dann gleiche Herkunft und Anmeldung per Sitzung).
`?autolock=SEKUNDEN` ueberschreibt die Auto-Sperre (Standard 300 s).

## Entwickeln
    npm install
    npm run build      # baut web/keepassnc.js (kdbxweb + hash-wasm + App-Code, ca. 140 KB)
    npm test           # Build, Unit-, Kompatibilitaets- und End-to-End-Tests

Voraussetzungen fuer die Tests: Node 20+, `keepassxc-cli` (KeePassXC 2.7.x), Python 3 mit `pykeepass`, Chromium
(`/opt/pw-browsers` oder Umgebungsvariable `CHROMIUM`).

## Aufbau
- `src/vault.js` Tresor-Logik (laden, aendern, speichern, Konflikte), `src/webdav.js` WebDAV mit If-Match, `src/totp.js` TOTP, `src/main.js` Oberflaeche
- `vendor/kdbxweb/` kdbxweb (MIT, Git-Stand siehe `UPSTREAM_COMMIT`) mit Patch gegen leere optionale Gruppenfelder
- `tests/unit` RFC-6238-Vektoren, `tests/compat` kdbxweb gegen KeePassXC, `tests/e2e` Browser gegen WebDAV-Testserver + KeePassXC

## Lizenz und Herkunft
kdbxweb: MIT (Antelle). Ideen und Verhalten orientieren sich an KeePassXC (GPL); es wurde kein KeePassXC-Code uebernommen.
Eine spaetere Nextcloud-Huelle auf Basis von jhass/nextcloud-keeweb waere AGPL-3.
