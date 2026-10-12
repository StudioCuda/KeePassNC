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
- **Works on a phone and on a big screen.** Three panes on desktop, one pane with a drawer on mobile, light and dark,
  English and German (it follows your Nextcloud language).

## What's in the box

Search with KeePassXC-style syntax (`user:`, `tag:`, `-nope`, `is:weak`, `has:totp` …), command palette, groups with drag and
drop, recycle bin, tags, expiry, attachments, entry history, TOTP (Steam Guard too), passkeys from KeePassXC shown and kept intact,
password and passphrase generator, a health report (weak, reused, expired), files shared with you (read-only shares say so), and an
opt-in "remember my key file" helper. That one is tied to a server-side secret, so a copied browser profile alone can't be used to
guess your master password. Design notes: [`docs/KEYFILE-MEMORY.md`](docs/KEYFILE-MEMORY.md).

Shortcuts: `Ctrl+K` palette, `Ctrl+F` search, `Ctrl+N` new, `Ctrl+S` save, `Ctrl+L` lock, `Ctrl+B` copy user, `Ctrl+C` copy password,
`Ctrl+Shift+U` open URL, `Del` delete.

Not there: autofill, and creating passkeys for websites. Both need a browser extension, which is a different project.

## Install (Nextcloud 34 and up)

```sh
npm ci
npm run package:nc        # builds keepassnc-nextcloud-app.tar.gz
# unpack into your Nextcloud apps/ (or custom_apps/) folder, then:
php occ app:enable keepassnc
```

Click a `.kdbx` in Files, type your master password, done. Tested against Nextcloud 34 and 35 (PHP 8.3) and kept an eye on against
`master`. The app only uses public interfaces (WebDAV, the CSRF token endpoint, the files action API), and `info.xml` doesn't cap
the version, so newer releases aren't locked out in advance.

### Standalone page

`npm run build`, then serve `web/` over HTTPS (WebCrypto wants HTTPS or localhost). Enter the WebDAV URL of your file, your user name
and an **app password**, not your account password. On a different domain than the Nextcloud you need CORS for WebDAV, so the same
domain is easier. `?autolock=SECONDS` overrides the auto-lock (default 300).

## Hack on it

```sh
npm ci
npm test                  # build, unit, KeePassXC compatibility, e2e, UI, key file, offline, fidelity
BROWSER=firefox npm run test:e2e                            # or webkit; Chromium is the default
NC_DIR=/path/to/nextcloud NC_PORT=18035 npm run test:nc   # fresh Nextcloud install + browser run
```

Needs Node 22, `keepassxc-cli` 2.7, Python 3 with `pykeepass`, and Chromium (set `CHROMIUM`) or Playwright's browsers.
`.github/workflows/nextcloud.yml` shows the whole setup. Layout: `src/` app code (`src/ui/` interface, `src/vault.js` the interesting
part), `vendor/kdbxweb/` the KDBX library, `nextcloud-app/keepassnc/` the Nextcloud wrapper, `tests/` the safety net.
Contributions: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Not tested yet

Real phones (mobile layouts are emulated, Firefox and WebKit run in CI), Nextcloud with MySQL/Postgres (the app doesn't touch the
database), behind a reverse proxy, with SSO or 2FA logins, and the Team folders app. Safari may clear site data after a while
without use, so there the offline copy isn't permanent storage.

## Security

This is a password manager, so please be picky. Found something? Read [`SECURITY.md`](SECURITY.md) first, it also lists what we
know and can't fix. Until someone independent has audited it, keep your regular KeePassXC copy around. The file format being
boring is the point.

## License and credits

AGPL-3.0-or-later for the app. [kdbxweb](https://github.com/keeweb/kdbxweb) (MIT) does the KDBX heavy lifting.
Behaviour is inspired by KeePassXC (GPL), but no KeePassXC code was copied. The Nextcloud side owes a nod to
jhass/nextcloud-keeweb.
