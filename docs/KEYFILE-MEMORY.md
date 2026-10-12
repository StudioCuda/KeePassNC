# Schlüsseldatei merken - Sicherheitsentwurf

Status: umgesetzt in v0.4, nach Review ueberarbeitet in v0.4.1, Server-Geheimwert (Format v2) in v0.5.0 (`src/keyfile-store.js`, Anbindung in `src/ui/login.js` und `src/ui/settings-dialog.js`).
Tests: `tests/unit/keyfile-store.test.mjs` (18), `tests/e2e/keyfile.mjs` (11, mit Argon2 256 MiB und KeePassXC-Alltagsdatei), `tests/e2e/keyfile-nc.mjs` (9, Nextcloud-Modus gegen eine Nachbildung der Schnittstellen), `tests/nextcloud/run.mjs` (Endpunkt gegen echte Nextcloud).

## Ziel

Wer seine KDBX mit Master-Passwort **und** Schlüsseldatei ("Passkey-File") schützt, muss die Schlüsseldatei bei jeder Anmeldung neu wählen.
Das ist auf einem eigenen Gerät lästig. Die Funktion erlaubt es, die Schlüsseldatei **optional** auf diesem Gerät zu merken - ohne dass
dadurch ein Angreifer ohne Master-Passwort etwas gewinnt, das er nicht auch bei einer KDBX-Datei mit bekannter Schlüsseldatei hätte.

## Verhalten

* Standard: **aus**. Die Checkbox "Schlüsseldatei auf diesem Gerät merken" erscheint erst, wenn eine Schlüsseldatei gewählt wurde, und ist nie vorangekreuzt.
* Gemerkt wird erst **nach erfolgreichem Öffnen** (Master-Passwort + Datei sind damit bestätigt).
* Pro Datenbank ein Datensatz (Kennung: `nc:<Benutzer>:<Pfad>`, `dav:<URL>`, `file:<Dateiname>`; lokale Datei innerhalb von Nextcloud: `nc-file:<Benutzer>:<Dateiname>`).
  Kennung, Schluesseldatei und Merk-Wunsch werden beim Absenden festgehalten (spaetere Eingaben waehrend Download/KDF wirken nicht mehr).
* Lokale Dateien haben keinen Pfad: zwei verschiedene Datenbanken gleichen Namens teilen sich den Datensatz. Die Fehlermeldung weist darauf hin.
* Ein Datensatz, der weniger kostet als heute für die Datenbank gewählt würde (ältere Version, Datenbank-KDF inzwischen erhöht), wird nach erfolgreichem Öffnen im Hintergrund neu verschlüsselt.
* Beim nächsten Anmelden: "Gemerkte Schlüsseldatei verwenden" ist vorausgewählt; Master-Passwort eintippen genügt. Wählt man eine Datei von Hand, hat diese Vorrang.
* "Vergessen" (Anmeldung), "Alle vergessen" (Einstellungen) und "Lokale Daten dieses Browsers löschen" entfernen die Datensätze.
  In Nextcloud zeigen/löschen die Einstellungen nur die Datensätze des angemeldeten Benutzers; "Lokale Daten löschen" entfernt weiterhin alles in diesem Browser.

## Nextcloud: zusätzlich an einen Geheimwert auf dem Server gebunden (ab v0.5.0, Format v2)

* Die Nextcloud-App hält pro Benutzer einen zufälligen 32-Byte-Wert ("Pepper", `IUserConfig`, als *sensitiv* markiert = verschlüsselt in der Datenbank).
  Abruf: `GET /apps/keepassnc/api/kf-pepper`, Erneuern: `POST …/rotate` - beides nur mit angemeldeter Sitzung und CSRF-Schutz.
* Schlüssel des Datensatzes = HKDF-SHA256(Argon2id(Master-Passwort), salt = Pepper, info = `kpnc-keyfile-v2`). AAD = `kpnc-keyfile-v2\0<Pepper-Kennung>\0<Datei-Kennung>\0<Anzeigename>`.
* Folge: Wer nur das Browser-Profil kopiert, kann **ohne Zugang zur Nextcloud nicht offline raten**. Der Server allein hat nichts (kein Datensatz, kein Passwort).
* **"Auf allen Geräten ungültig machen"** (Einstellungen) erneuert den Pepper: Alle gemerkten Schlüsseldateien des Kontos sind sofort überall unbrauchbar (Gerät verloren).
  Das nächste Anmelden meldet das und entfernt den Datensatz; Schlüsseldatei einmal von Hand wählen.
* **Server nicht erreichbar:** die gemerkte Datei greift nicht ("bitte von Hand wählen"); die Offline-Kopie der Datenbank funktioniert weiter.
* **Handling unverändert:** KDBX, Schlüsseldatei, Backup und Export sind nicht betroffen. Geht der Pepper verloren (Benutzer gelöscht, Server-Wiederherstellung
  ohne Benutzereinstellungen), gehen nur die *gemerkten* Datensätze verloren - nie die Datenbank.
* Ältere v1-Datensätze werden in Nextcloud nach dem nächsten erfolgreichen Öffnen automatisch auf v2 umgestellt. Die eigenständige Seite (ohne Nextcloud) bleibt bei v1.
* **Grenzen, ehrlich:** (1) Das Profil enthält oft auch das Sitzungs-Cookie der Nextcloud ("angemeldet bleiben"). Solange es gültig ist, kann ein Dieb damit den Pepper abrufen -
  deshalb bei Verlust: "Auf allen Geräten ungültig machen" **und** in Nextcloud unter *Sicherheit* die Sitzungen/Geräte abmelden. (2) Skripte derselben Herkunft
  (andere Apps der Instanz, XSS) können den Pepper als angemeldeter Benutzer ebenfalls abrufen; hier hilft v2 nicht, wohl aber gegen das stille Mitnehmen *ohne* Sitzung.

## Kryptografie

| Baustein | Wahl |
|---|---|
| Schlüsselableitung | Argon2id (hash-wasm), Parallelität 1, 128-Bit-Zufallssalz. Arbeit (Speicher × Durchläufe) **mindestens** wie die Datenbank-KDF: Speicher = Datenbank-Speicher (64 MiB … 1 GiB), Durchläufe so erhöht, dass die Arbeit nicht sinkt (3 … 64). Datenbank mit AES-KDF: fest 64 MiB / 16. Beim Lesen akzeptiert: 8 MiB … 1 GiB, 1 … 64 Durchläufe (ganzzahlig), Salz ≥ 16 Byte, IV = 12 Byte |
| Passwort-Eingabe | Master-Passwort als UTF-8 (wie KeePass), unverändert (keine Normalisierung) |
| Verschlüsselung | AES-256-GCM über WebCrypto, zufälliger 96-Bit-IV, AAD = `kpnc-keyfile-v1\0<Datei-Kennung>` (v1) bzw. siehe oben (v2) |
| Abgeleiteter Schlüssel | als nicht exportierbarer `CryptoKey` importiert, Rohbytes sofort mit Nullen überschrieben, nie gespeichert |
| Gespeichert (IndexedDB, Store `files`, Schlüssel `kf:<Kennung>`) | Format, Kennung, Anzeigename (Dateiname der Schlüsseldatei), Zeitstempel, KDF-Parameter + Salz, IV, Chiffrat; v2 zusätzlich die Pepper-*Kennung* (nicht der Wert) |
| Nie gespeichert | Master-Passwort, abgeleiteter Schlüssel, Klartext der Schlüsseldatei, Pepper-Wert (wird je Anmeldung abgerufen) |

Warum **kein** gerätegebundener Schlüssel (z. B. nicht exportierbarer `CryptoKey` im Browser)? Er würde das Merken ohne Master-Passwort erlauben,
schützt aber weder gegen Skripte derselben Herkunft (die können `decrypt` einfach aufrufen) noch gegen eine kopierte Browser-Profil-Datei
(die Schlüsselbytes liegen dort). Er wäre Komfort mit Scheinsicherheit. Die Ableitung aus dem Master-Passwort macht den Datensatz ohne
das Passwort wertlos.

## Bedrohungsmodell

| Angreifer | Ergebnis |
|---|---|
| Neugieriger Mitnutzer am selben Browser, kennt das Master-Passwort nicht | Sieht nur Dateiname und Kennung; Chiffrat nutzlos. Die Offline-Kopie der KDBX ist ebenfalls verschlüsselt. |
| XSS / fremdes Skript in der App-Herkunft (**in Nextcloud: jede App und jede XSS-Lücke derselben Nextcloud-Instanz**, IndexedDB ist pro Herkunft, nicht pro App) | Kann den Datensatz (und die Offline-Kopie) **auslesen und mitnehmen** und dann wie der Profildieb offline raten. Ohne die Funktion bräuchte so ein Skript zusätzlich die Schlüsseldatei. Die Seite selbst lässt sich nicht mehr einrahmen (`frame-ancestors 'none'`), per `window.open` bleibt sie für Skripte derselben Herkunft aber erreichbar - die Herkunft ist die Vertrauensgrenze. Könnte das Passwort beim Tippen abgreifen - das gilt unabhängig von dieser Funktion; Gegenmaßnahme ist die strikte CSP (kein Inline-Skript, kein `eval`, keine Fremdhosts). |
| Dieb mit Kopie des Browser-Profils, **Nextcloud ab v0.5.0** | Ohne Zugang zur Nextcloud (Sitzung abgelaufen/abgemeldet, Server nur im LAN/VPN, Pepper erneuert) **kein Offline-Raten möglich**. Mit noch gültigem Sitzungs-Cookie aus dem Profil: Pepper abrufbar, dann wie nächste Zeile. Gegenmittel: "Auf allen Geräten ungültig machen" + Sitzungen abmelden. |
| Dieb mit Kopie des Browser-Profils / Festplatte (eigenständige Seite, oder Nextcloud mit gültiger Sitzung) | Kann das Master-Passwort **offline raten**, Prüfstein ist das GCM-Tag, Kosten je Tipp ≥ Datenbank-KDF (Argon2id, mind. 64 MiB / 3; Obergrenze 1 GiB × 64). Das Profil enthält meist auch die Nextcloud-Sitzung (Cookie) und ggf. die Offline-Kopie - die KDBX hat er dann ohnehin. **Restrisiko:** Die Schlüsseldatei schützt hier nicht mehr als zweiter Faktor, denn der Angreifer bekommt sie nach erfolgreichem Raten. Das Master-Passwort muss das allein tragen. |
| Angreifer mit Schreibzugriff auf das Profil | Kann Datensatz löschen/ersetzen: Ergebnis ist ein Anmeldefehler, kein Zugriff. Manipulierte KDF-Parameter (Speicher-/Zeitbombe) werden vor dem Rechnen abgelehnt. Datensatz einer Datei lässt sich nicht für eine andere verwenden (AAD). |
| Server / Netzwerk | Sieht nichts davon; der Datensatz verlässt das Gerät nie. |
| Zeitangriff / Seitenkanal | Nicht Teil des Modells (WebCrypto/hash-wasm im Browser). |

## Bewusst nicht gebaut

* Kein "Passwort merken", keine automatische Anmeldung, keine Biometrie/WebAuthn-PRF-Variante (später denkbar, siehe unten).
* Keine Synchronisierung gemerkter Schlüsseldateien zwischen Geräten.
* Kein Merken auf Geräten, auf denen "Offline-Kopie" ausgeschaltet bleiben soll - die Funktion ist aber unabhängig davon schaltbar; die Oberfläche warnt, dass sie nur für eigene, geschützte Geräte gedacht ist.

## Mögliche Erweiterung (nicht umgesetzt)

WebAuthn-PRF-Extension als zusätzlicher Faktor für das Entschlüsseln des Datensatzes (Gerät/Sicherheitsschlüssel statt nur Passwort). Würde das
Offline-Raten bei Profildiebstahl verhindern, braucht aber PRF-Unterstützung in allen Zielbrowsern.

## Prüfaufträge für ein unabhängiges Review

Ein erstes Review ist in v0.4.1 eingearbeitet (siehe `STATUS.md`). Eine unabhaengige Pruefung von aussen steht noch aus.
