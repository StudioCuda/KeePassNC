[English](README.md) · **Deutsch**

# KeePassNC

Schlanker KDBX-Passwortmanager fuer den Browser, gedacht als Nachfolger der Nextcloud-App "KeeWeb".
Die Datenbank bleibt eine ganz normale KeePass-Datei (KDBX 3.x/4.x) in der Nextcloud und kann jederzeit weiterhin mit
KeePassXC, KeePassDX, Strongbox usw. geoeffnet werden.

**Sicherheitsmodell:** Die Datei wird im Browser geladen, dort entschluesselt, dort bearbeitet und verschluesselt wieder
zurueckgeschrieben. Master-Passwort und Klartext verlassen den Browser nie; der Server sieht nur die verschluesselte Datei.
Es werden keine externen Skripte, Schriften oder Dienste geladen (strikte Content-Security-Policy).

## Stand (v0.5)
Funktioniert und ist automatisch getestet (siehe `STATUS.md`): Oeffnen per WebDAV (Nextcloud-App-Passwort), Nextcloud-Sitzung oder lokaler Datei,
KDBX 3.1 / 4.0 / 4.1, AES und ChaCha20, Argon2d/Argon2id/AES-KDF, Schluesseldatei, Speichern mit ETag-Pruefung, Sicherungskopie und
Zusammenfuehrung bei Konflikten, Offline-Kopie + Service Worker, automatisches Speichern/Abgleichen.

Neu in v0.5: **Schluesseldatei merken** (optional, Standard aus). In Nextcloud zusaetzlich an einen Geheimwert auf dem Server gebunden:
wer nur das Browserprofil kopiert, kann das Master-Passwort nicht offline raten; "Auf allen Geraeten ungueltig machen" fuer verlorene Geraete.
Backup/Export der KDBX unveraendert. Details: `docs/KEYFILE-MEMORY.md`.

Neu in v0.4 (komplett neue Oberflaeche, an KeePassXC angelehnt, grosser Bildschirm hat Vorrang):
- **Drei-Spalten-Ansicht** (Gruppen/Filter - Liste - Details); unter 1180 px wird die Gruppenleiste zur Schublade, unter 760 px gibt es Liste und
  Detail nacheinander mit Schwebe-Button und Bottom-Sheets. Hell/Dunkel/Automatisch, kompakte Liste, Deutsch/Englisch (folgt der Nextcloud-Sprache).
- **Suche mit KeePassXC-Syntax**: `feld:wert` (`title:`, `user:`, `url:`, `notes:`, `tag:`, `group:` ...), `-ausschliessen`, `!` / `+` / `*`, Platzhalter,
  Filter wie `is:weak`, `is:expired`, `has:totp`, `has:passkey`, `has:attachment`. **Befehlspalette** (Strg+K).
- **Gruppenverwaltung** (anlegen, umbenennen, verschieben, Drag-and-drop, loeschen), Papierkorb (leeren/wiederherstellen), Tags, Ablaufdatum.
- **Verlauf** (ansehen, wiederherstellen, loeschen), **Anhaenge** hinzufuegen/entfernen/herunterladen, Duplizieren, Rueckgaengig nach Loeschen.
- **Passwortgenerator** (Zeichenklassen, aehnliche Zeichen ausschliessen, jede Gruppe erzwingen, Passphrase mit EFF-Wortliste), Staerkeanzeige,
  **Gesundheitsbericht** (schwach, doppelt, abgelaufen, ohne Passwort), Statistik und Datenbankinfo.
- **TOTP** mit Ablaufring, Passkeys (KeePassXC-Felder werden erhalten und angezeigt), geschuetzte Zusatzfelder.
- **Schluesseldatei-Merkhilfe** (Opt-in): verschluesselt im Browser abgelegt, entsperrbar nur mit dem Master-Passwort -
  Entwurf, Bedrohungsmodell und Restrisiko in `docs/KEYFILE-MEMORY.md`.
- **Aufraeumregel fuer Sicherungskopien** auf dem Server (Einstellung: neueste 3 / 10 / 30 oder alle behalten; nur exakt passende Namen werden angefasst).
- Kuerzel: Strg+K Palette, Strg+F Suche, Strg+N neu, Strg+S speichern, Strg+L sperren, Strg+B Benutzer kopieren, Strg+C Passwort kopieren, Strg+Umschalt+U URL oeffnen, Entf loeschen.

Noch **nicht** vorhanden: Steam-TOTP, Freigaben/Gruppenordner, Browser-Integration (Autofill), Passkey-Anlage (nur Anzeige/Erhalt), Firefox/Safari-Tests.

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
    npm test           # Build, Unit, Kompatibilitaet, E2E, UI, Schluesseldatei, Ausfall, Treue gegen KeePassXC
    NC_DIR=/pfad/nextcloud NC_PORT=18035 npm run test:nc   # Nextcloud-Integration inkl. Wartungsmodus/Serverabsturz

Voraussetzungen fuer die Tests: Node 20+, `keepassxc-cli` (KeePassXC 2.7.x), Python 3 mit `pykeepass`, Chromium
(`/opt/pw-browsers` oder Umgebungsvariable `CHROMIUM`).

## Aufbau
- `src/vault.js` Tresor-Logik (laden, aendern, speichern, Konflikte), `src/webdav.js` WebDAV mit If-Match, `src/totp.js` TOTP, `src/ui/*` Oberflaeche (Module), `src/i18n*.js` Texte DE/EN, `src/keyfile-store.js` Schluesseldatei-Merkhilfe, `src/main.js` Start
- `vendor/kdbxweb/` kdbxweb (MIT, Git-Stand siehe `UPSTREAM_COMMIT`) mit Patch gegen leere optionale Gruppenfelder
- `tests/unit` RFC-6238-Vektoren, `tests/compat` kdbxweb gegen KeePassXC, `tests/e2e` Browser gegen WebDAV-Testserver + KeePassXC

## Lizenz und Herkunft
kdbxweb: MIT (Antelle). Ideen und Verhalten orientieren sich an KeePassXC (GPL); es wurde kein KeePassXC-Code uebernommen.
Die Nextcloud-App ist von jhass/nextcloud-keeweb (AGPL-3) inspiriert und steht unter AGPL-3; `COPYING` liegt bei.
