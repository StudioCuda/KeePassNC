# Status und offene Punkte (2026-10-11)

## Testergebnis
| Ebene | Anzahl | Ergebnis |
|---|---|---|
| Unit (TOTP, RFC 6238 SHA1/256/512, Base32, Altformat) | 10 | alle bestanden |
| Kompatibilitaet kdbxweb <-> KeePassXC (Cipher x KDF x Schluesseldatei, v3.1/4.0/4.1, 8-MB-Anhang, Re-Saves, Merge) | 19 | alle bestanden |
| End-to-End (Chromium, WebDAV-Testserver, KeePassXC als Gegenprobe) | 15 | alle bestanden |

Die E2E-Tests pruefen u. a.: Fehlermeldungen (Passwort/Zugang/404), Suche, Detailansicht, TOTP gegen KeePassXC, Anhang byte-genau,
Bearbeiten + Speichern (KeePassXC liest Ergebnis; Notiz, Tags, TOTP, Anhang, geschuetztes Feld bleiben erhalten), Sicherungskopie,
Papierkorb, Konflikt mit Zusammenfuehrung, Auto-Sperre (DOM leer; mit ungespeicherten Aenderungen erst speichern), KDBX 3.1
bleibt 3.1, lokaler Dateimodus, keine externen Anfragen, keine JS-Fehler, CSP ohne unsafe-inline.

## Bekannte Grenzen / nicht getestet
1. **Echte Nextcloud nicht getestet.** Der WebDAV-Teil ist gegen einen Testserver geprueft (ETag, If-Match, If-None-Match, Basic-Auth).
   Zu pruefen: ETag im PUT-Antwortkopf, If-Match-Verhalten, App-Passwort-Login, CORS bei fremder Herkunft.
2. **Keine Nextcloud-App-Huelle** (Dateiaktion fuer .kdbx, gleiche Herkunft, Sitzungs-Token). Naechster Meilenstein.
3. Nur Chromium getestet; Firefox/Safari/mobil ungetestet. Argon2 mit sehr hohem Speicherbedarf (>1 GB) kann auf Mobilgeraeten scheitern.
4. Master-Passwort liegt waehrend der Sitzung als ProtectedValue im Speicher; JavaScript-Strings lassen sich nicht aktiv loeschen.
5. Sicherungskopien (`<datei>.<zeitstempel>.bak`, `.conflict-...bak`) werden angelegt, aber nicht automatisch aufgeraeumt.
6. Vor dem produktiven Einsatz als einziger Passwortmanager: unabhaengige Sicherheitspruefung und weiterhin KeePassXC-Offline-Kopien behalten.
7. kdbxweb 2.2.0 ist nur als Git-Stand verfuegbar (npm endet bei 2.1.1); Patch `tests/compat/kdbxweb-enable-searching-fix.patch` ist in `vendor/` bereits eingespielt.

## Naechste Schritte (Vorschlag)
1. Nextcloud-App-Huelle (info.xml, Dateiaktion, gleiche Herkunft, CSP angepasst) auf Basis von jhass/nextcloud-keeweb (AGPL-3).
2. Test gegen eine echte Nextcloud (Docker) in den E2E-Tests.
3. Gruppenverwaltung, Anhaenge hochladen, Verlauf, Passwort-Qualitaetsanzeige.
