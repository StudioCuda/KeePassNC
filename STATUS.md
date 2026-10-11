# Status und offene Punkte (2026-10-11)

## Testergebnis
| Ebene | Anzahl | Ergebnis |
|---|---|---|
| Nextcloud-Integration NC 34.0.4 (frische Installation, Chromium, KeePassXC-Gegenprobe) | 13 | alle bestanden |
| Nextcloud-Integration NC 35.0.1 | 13 | alle bestanden |
| Unit gesamt (TOTP + Nextcloud-Pfadlogik) | 14 | alle bestanden |
| Kompatibilitaet kdbxweb <-> KeePassXC (Cipher x KDF x Schluesseldatei, v3.1/4.0/4.1, 8-MB-Anhang, Re-Saves, Merge) | 19 | alle bestanden |
| End-to-End (Chromium, WebDAV-Testserver, KeePassXC als Gegenprobe) | 15 | alle bestanden |

Die E2E-Tests pruefen u. a.: Fehlermeldungen (Passwort/Zugang/404), Suche, Detailansicht, TOTP gegen KeePassXC, Anhang byte-genau,
Bearbeiten + Speichern (KeePassXC liest Ergebnis; Notiz, Tags, TOTP, Anhang, geschuetztes Feld bleiben erhalten), Sicherungskopie,
Papierkorb, Konflikt mit Zusammenfuehrung, Auto-Sperre (DOM leer; mit ungespeicherten Aenderungen erst speichern), KDBX 3.1
bleibt 3.1, lokaler Dateimodus, keine externen Anfragen, keine JS-Fehler, CSP ohne unsafe-inline.

## Bekannte Grenzen / nicht getestet
1. Nextcloud getestet (34.0.4, 35.0.1): ETag im PUT, If-Match/If-None-Match (412), Sitzungs-Login mit requesttoken, Dateiaktion, Konflikt-Merge. Nicht getestet: MySQL/Postgres (App beruehrt die DB nicht), Server hinter Reverse-Proxy, Nextcloud-Master/36 (noch kein Release), Firmen-SSO/2FA-Logins, Freigaben/Gruppenordner (Pfad ausserhalb des eigenen Benutzerverzeichnisses nicht unterstuetzt).
2. Keine Uebersetzungen (nur Deutsch); `info.xml` hat Platzhalter-Adresse fuer Bugtracker; vor Veroeffentlichung im App Store Signierung noetig.
3. Nur Chromium getestet; Firefox/Safari/mobil ungetestet. Argon2 mit sehr hohem Speicherbedarf (>1 GB) kann auf Mobilgeraeten scheitern.
4. Master-Passwort liegt waehrend der Sitzung als ProtectedValue im Speicher; JavaScript-Strings lassen sich nicht aktiv loeschen.
5. Sicherungskopien (`<datei>.<zeitstempel>.bak`, `.conflict-...bak`) werden angelegt, aber nicht automatisch aufgeraeumt.
6. Vor dem produktiven Einsatz als einziger Passwortmanager: unabhaengige Sicherheitspruefung und weiterhin KeePassXC-Offline-Kopien behalten.
7. kdbxweb 2.2.0 ist nur als Git-Stand verfuegbar (npm endet bei 2.1.1); Patch `tests/compat/kdbxweb-enable-searching-fix.patch` ist in `vendor/` bereits eingespielt.

## Naechste Schritte (Vorschlag)
1. CI (GitHub Actions) mit Matrix NC 34/35/neueste, damit neue Nextcloud-Versionen automatisch geprueft werden.
2. Englische Oberflaeche/Uebersetzungen, Support fuer Freigaben.
3. Gruppenverwaltung, Anhaenge hochladen, Verlauf, Passwort-Qualitaetsanzeige.
