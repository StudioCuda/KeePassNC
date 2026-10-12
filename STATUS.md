# Status und offene Punkte (2026-10-11, v0.5.0)

## Testergebnis
| Ebene | Anzahl | Ergebnis |
|---|---|---|
| Nextcloud-Integration NC 34.0.4 (frische Installation, Chromium, KeePassXC-Gegenprobe, Wartungsmodus 503, Prozess-Absturz) | 17 | alle bestanden |
| Nextcloud-Integration NC 35.0.1 | 17 | alle bestanden (v0.4.0; v0.4.1 neu: Pruefung `frame-ancestors 'none'` - noch lokal/CI auszufuehren) |
| Ausfall-Tests eigenstaendige Seite (Server wirklich beendet/neu gestartet, Service Worker, Merge, Intervall-Pull, Daten loeschen) | 8 | alle bestanden |
| Unit gesamt (TOTP, Pfadlogik, Suche, Generator, Schluesseldatei-Speicher, i18n-Konsistenz, Backup-Aufraeumen) | 46 | alle bestanden |
| Kompatibilitaet kdbxweb <-> KeePassXC (Cipher x KDF x Schluesseldatei, v3.1/4.0/4.1, 8-MB-Anhang, Re-Saves, Merge) | 25 | alle bestanden |
| End-to-End (Chromium, WebDAV-Testserver, KeePassXC als Gegenprobe) | 15 | alle bestanden |
| UI-Test mit synthetischer Alltagsdatei (172 Eintraege, 32 Gruppen, Argon2d 256 MiB, Schluesseldatei; Suche, Editor, Generator, Palette, Papierkorb, Sprache/Theme, mobil 390x844) | 18 | alle bestanden |
| Schluesseldatei-Merkhilfe (IndexedDB-Inhalt, falsches Passwort, Manipulation, Vergessen, anderes Profil, Eingabe-Wechsel waehrend Oeffnen, lokale Datei, KDF-Kosten >= Datenbank, Aufwerten alter Datensaetze) | 11 | alle bestanden |
| Schluesseldatei-Merkhilfe im Nextcloud-Modus gegen Nachbildung der NC-Schnittstellen (v2/Server-Geheimwert, Server weg, gestohlener Datensatz, zweiter Benutzer, auf allen Geraeten ungueltig machen, Umstellung v1->v2) | 9 | alle bestanden |
| Treue-Test: im UI gespeicherte Alltagsdatei gegen KeePassXC (XML-Export, Anhaenge, TOTP, Sonderfaelle, Tab-Zeichen) | 5 | alle bestanden |

Die E2E-Tests pruefen u. a.: Fehlermeldungen (Passwort/Zugang/404), Suche, Detailansicht, TOTP gegen KeePassXC, Anhang byte-genau,
Bearbeiten + Speichern (KeePassXC liest Ergebnis; Notiz, Tags, TOTP, Anhang, geschuetztes Feld bleiben erhalten), Sicherungskopie,
Papierkorb, Konflikt mit Zusammenfuehrung, Auto-Sperre (DOM leer; mit ungespeicherten Aenderungen erst speichern), KDBX 3.1
bleibt 3.1, lokaler Dateimodus, keine externen Anfragen, keine JS-Fehler, CSP ohne unsafe-inline.

## v0.5.0: Gemerkte Schluesseldatei in Nextcloud an Server-Geheimwert gebunden
Datensatz-Format v2: Schluessel = HKDF(Argon2id(Master-Passwort), Geheimwert pro Benutzer auf dem Server). Profilkopie allein reicht nicht mehr
zum Offline-Raten. Neu in den Einstellungen: "Auf allen Geraeten ungueltig machen". Server weg -> Schluesseldatei von Hand waehlen.
Backup/Export der KDBX unveraendert. Neuer Endpunkt `api/kf-pepper` (PepperController.php). Details: `docs/KEYFILE-MEMORY.md`.
**Noch zu pruefen:** `tests/nextcloud/run.mjs` gegen echte NC 34/35 (neuer Schritt fuer den Endpunkt) - hier nicht ausfuehrbar (Download gesperrt).

## v0.4.1: Review "Schluesseldatei merken" eingearbeitet
Kurz: Kosten je Passwort-Tipp nie mehr unter der Datenbank-KDF (vorher bis Faktor 4 darunter), alte
Datensaetze werden automatisch aufgewertet; Kennung/Datei werden beim Absenden festgehalten; Nextcloud-Benutzer sehen nur eigene Datensaetze;
lokale Datei in Nextcloud je Benutzer getrennt; KeePassNC-Seite in Nextcloud nicht mehr einbettbar (`frame-ancestors 'none'`); klarere Hinweise.
Server-Pepper: in v0.5.0 umgesetzt. WebAuthn-PRF: weiterhin offen.

## v0.3: Offline und Abgleich - Verhalten
- Offline-Kopie nur nach Opt-in (Standard aus). Sie enthaelt exakt die verschluesselten Bytes des Servers plus ETag und "modified"-Flag.
- Oeffnen: Server erreichbar -> Server-Stand (oder lokaler Stand mit offenen Aenderungen, der danach hochgeladen/gemerged wird);
  Server nicht erreichbar (Netzfehler, 5xx, Wartungsmodus) -> Offline-Kopie. 401/403/404 sind keine Ausfaelle und fallen nie auf den Cache zurueck.
- Speichern: serialisieren -> Offline-Kopie -> PUT mit If-Match; 412 -> Server-Stand sichern, zusammenfuehren, erneut (max. 3 Versuche).
  Ohne Offline-Kopie und ohne Server bleibt die Aenderung als "ungespeichert" markiert (nichts geht still verloren).
- Wiederholung ungesyncter Staende alle 30 s und beim "online"-Ereignis; Intervall-Modus holt Fremdaenderungen (HEAD/ETag, dann GET).
- Aenderte jemand das Master-Passwort auf einem anderen Geraet, wird das gemeldet; lokale Aenderungen bleiben gesichert.

## Bekannte Grenzen / nicht getestet
1. Nextcloud getestet (34.0.4, 35.0.1): ETag im PUT, If-Match/If-None-Match (412), Sitzungs-Login mit requesttoken, Dateiaktion, Konflikt-Merge. Nicht getestet: MySQL/Postgres (App beruehrt die DB nicht), Server hinter Reverse-Proxy, Nextcloud-Master/36 (noch kein Release), Firmen-SSO/2FA-Logins, Freigaben/Gruppenordner (Pfad ausserhalb des eigenen Benutzerverzeichnisses nicht unterstuetzt).
2. Oberflaeche DE/EN; `info.xml` hat eine Platzhalter-Adresse fuer den Bugtracker (bewusst nicht erfunden); vor Veroeffentlichung im App Store sind Signierung, Website/Repository-Eintraege und Screenshots (`docs/screenshots/`) noetig.
3. Service Worker/IndexedDB nur in Chromium getestet; Safari loescht Website-Daten nach laengerer Nichtbenutzung (ITP) - die Offline-Kopie ist dort kein Dauerspeicher. Nur Chromium getestet; Firefox/Safari/mobil ungetestet. Argon2 mit sehr hohem Speicherbedarf (>1 GB) kann auf Mobilgeraeten scheitern.
4. Master-Passwort liegt waehrend der Sitzung als ProtectedValue im Speicher; JavaScript-Strings lassen sich nicht aktiv loeschen.
5. Sicherungskopien (`<datei>.<zeitstempel>.bak`, `.conflict-...bak`) werden nach Einstellung (Standard: neueste 10 je Art) per PROPFIND/DELETE aufgeraeumt; nur exakt passende Namen. Auf Servern ohne PROPFIND-Unterstuetzung bleibt es still beim Anlegen.
8. Schluesseldatei-Merkhilfe: Restrisiko siehe `docs/KEYFILE-MEMORY.md` (eigenstaendige Seite: Offline-Raten aus Profilkopie; Nextcloud: nur noch mit gueltiger Sitzung).
9. UI nur in Chromium (Desktop 1440 px, Tablet, Mobil 390 px emuliert) getestet.
6. Vor dem produktiven Einsatz als einziger Passwortmanager: unabhaengige Sicherheitspruefung und weiterhin KeePassXC-Offline-Kopien behalten.
7. kdbxweb 2.2.0 ist nur als Git-Stand verfuegbar (npm endet bei 2.1.1); Patch `tests/compat/kdbxweb-enable-searching-fix.patch` ist in `vendor/` bereits eingespielt.

## Naechste Schritte (Vorschlag)
1. Zweitmeinung zum v0.4.1/v0.5.0-Diff (Pruefer und Umsetzer waren dieselben); `npm run test:nc` gegen NC 34/35 laufen lassen.
2. Firefox/Safari/echte Mobilgeraete testen; Argon2-Speicherlimit auf Mobil pruefen.
3. App-Store-Veroeffentlichung vorbereiten (Repository, Bugtracker, Signierung, Screenshots).
4. Steam-TOTP, Passkey-Anlage, Freigaben/Gruppenordner.
