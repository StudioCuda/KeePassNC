# kdbx-compat-tests

Testet **kdbxweb** (Git-Stand 2.2.0, auf npm nur bis 2.1.1 veroeffentlicht) gegen **KeePassXC** (`keepassxc-cli`) als Referenz.
Jede Datei, die kdbxweb schreibt, muss in KeePassXC sauber oeffnen und inhaltlich stimmen; Dateien von KeePassXC muessen kdbxweb ueberstehen.

## Voraussetzungen
- Node 20+, `keepassxc-cli` (getestet mit 2.7.6), Python 3 mit `pykeepass` (nur fuer den Randfall-Test)
- `git clone https://github.com/keeweb/kdbxweb` und darin `npm ci --ignore-scripts`
- hier: `npm install` (hash-wasm fuer Argon2, ts-node)

## Lauf
    KDBXWEB=/pfad/zu/kdbxweb NODE_PATH=/pfad/zu/kdbxweb/node_modules:./node_modules \
      node -r ts-node/register/transpile-only run.ts

## Abgedeckt (19 Faelle)
- KDBX4: Cipher AES/ChaCha20 x KDF Argon2d/Argon2id/AES-KDF x mit/ohne Schluesseldatei, danach 5 Re-Saves (inkl. Verlauf)
- KDBX3.1 mit/ohne Schluesseldatei; KDBX4.1 (Gruppen-Tags)
- Inhalte: Umlaute/Euro, mehrzeilige Notizen, geschuetzte Zusatzfelder, Tags, TOTP, Anhang (2 KB und 8 MB), verschachtelte Gruppen
- Wechselseitiges Bearbeiten (kdbxweb -> KeePassXC -> kdbxweb) und Merge zweier divergierender Kopien
- Randfall: Datei ohne optionale Gruppenfelder (pykeepass)

## Befund
Ohne Patch scheitert nur der letzte Fall: kdbxweb schreibt fehlende optionale Gruppenfelder (EnableSearching, EnableAutoType, IconID, IsExpanded)
als leere Elemente, KeePassXC lehnt das ab. `kdbxweb-enable-searching-fix.patch` (4 Zeilen in `lib/format/kdbx-group.ts`) behebt das; mit Patch 19/19.
Hinweis: `keepassxc-cli attachment-export --stdout` verfaelscht Binaerdaten (UTF-8-Konvertierung), deshalb exportieren die Tests in Dateien.
