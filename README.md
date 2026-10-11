**English** · [Deutsch](README.de.md)

# KeePassNC

Your KeePass file, opened in a browser tab, on your own Nextcloud. That's it. That's the app.

KeeWeb stopped getting updates, so this is its replacement: it reads and writes plain **KDBX 3.1 / 4.x** files, so
KeePassXC, KeePassDX and Strongbox keep working on the very same file. No lock-in, no special format, no drama.

## How it behaves

- **Everything is decrypted in your browser.** The master password and the plaintext never leave it. The server only ever sees the
  encrypted file. No external scripts, no fonts from somewhere else, strict CSP.
- **Saving is careful.** Writes use ETag checks, a backup copy goes next to the file first, and if two devices edited at once the
  two versions get merged instead of one quietly winning. Old backups are cleaned up so your folder doesn't turn into a museum.
- **Outages are survivable.** Optional encrypted offline copy plus a service worker: if the server is down for weeks, you can still
  open the database, edit it, and it syncs back when the server returns.
- **Works on a phone and on a big screen.** Three-pane layout on desktop, single pane with a drawer on mobile, light and dark,
  English and German (it follows your Nextcloud language).

## What's in the box

Search with KeePassXC-style syntax (`user:`, `tag:`, `-nope`, `is:weak`, `has:totp` …), command palette (`Ctrl+K`), groups with drag and
drop, recycle bin, tags, expiry, attachments, entry history, TOTP, passkey fields preserved, password and passphrase generator,
a health report (weak, reused, expired), and an opt-in "remember my key file" helper that is tied to a server-side secret so a
copied browser profile alone can't be used to guess your master password. Design notes live in
[`docs/KEYFILE-MEMORY.md`](docs/KEYFILE-MEMORY.md).

Not there yet: Steam TOTP, shared folders, autofill, creating new passkeys (existing ones are kept and shown).

## Install (Nextcloud 34 and up)

```sh
npm install
npm run package:nc        # builds keepassnc-nextcloud-app.tar.gz
# unpack into your Nextcloud apps/ (or custom_apps/) folder, then:
php occ app:enable keepassnc
```

Click a `.kdbx` in Files, type your master password, done. Tested against Nextcloud 34.0.4 and 35.0.1 (PHP 8.3). The app only uses
public interfaces (WebDAV, the CSRF token endpoint, the files action API), and `info.xml` doesn't cap the version, so newer
releases aren't locked out in advance.

### Standalone page

Serve `web/` over HTTPS, enter the WebDAV URL of your file, your user name and an **app password** (not your account password).
If the page lives on a different domain than the Nextcloud, you need CORS for WebDAV. Same domain is easier.

## Hack on it

```sh
npm install
npm run build
npm test                  # unit, KeePassXC compatibility, e2e, UI, key file, offline, fidelity
NC_DIR=/path/to/nextcloud NC_PORT=18035 npm run test:nc   # fresh Nextcloud install + browser run
```

Tests need Node 20+, `keepassxc-cli` 2.7.x, Python 3 with `pykeepass`, and Chromium.
Layout: `src/` app code (`src/ui/` interface, `src/vault.js` the interesting part), `vendor/kdbxweb/` the KDBX library,
`nextcloud-app/keepassnc/` the Nextcloud wrapper, `tests/` the safety net.

## Security

This is a password manager, so please be picky. Found something? Read [`SECURITY.md`](SECURITY.md) first. Until someone independent has
audited it, keep your regular KeePassXC copy around. The file format being boring is the point.

## License and credits

AGPL-3.0-or-later for the app. [kdbxweb](https://github.com/keeweb/kdbxweb) (MIT) does the KDBX heavy lifting.
Behaviour is inspired by KeePassXC (GPL), but no KeePassXC code was copied. The Nextcloud side owes a nod to
jhass/nextcloud-keeweb.
