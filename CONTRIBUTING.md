# Contributing

Bug reports, odd KDBX files, and patches are welcome.

## Ground rules

- Run `npm test` before sending anything. If you touch the Nextcloud side, run `npm run test:nc` against a real Nextcloud too.
  CI runs everything on each pull request.
- Build output (`web/*.js`, `nextcloud-app/keepassnc/js|css`) isn't committed. `npm run build` makes it.
- Keep the master password and plaintext in the browser. A change that sends either anywhere is a no.
- Don't copy code from KeePassXC (GPL). Ideas are fine, code isn't.
- New UI text goes into both `src/i18n-de.js` and `src/i18n-en.js`; the unit tests check that they match.
- Small, focused changes get reviewed faster than big ones.

## Build and test

```sh
npm ci
npm test                  # build, unit, KeePassXC compatibility, e2e, UI, key file, offline, fidelity
BROWSER=firefox npm run test:e2e                            # or webkit; Chromium is the default
NC_DIR=/path/to/nextcloud NC_PORT=18035 npm run test:nc   # fresh Nextcloud install + browser run
npm run package:nc        # builds keepassnc-nextcloud-app.tar.gz from source
```

Needs Node 22, `keepassxc-cli` 2.7, Python 3 with `pykeepass`, and Chromium (set `CHROMIUM`) or Playwright's browsers.
`.github/workflows/nextcloud.yml` shows the whole setup.

The app is tested against Nextcloud 34 and 35 (PHP 8.3) and kept an eye on against `master`. It only uses public interfaces
(WebDAV, the CSRF token endpoint, the files action API), and `info.xml` doesn't cap the version, so newer releases aren't locked
out in advance.

## Where things live

- `src/` app code: `src/ui/` the interface, `src/vault.js` the interesting part
- `vendor/kdbxweb/` the KDBX library
- `nextcloud-app/keepassnc/` the Nextcloud wrapper
- `tests/` the safety net
- `tools/make-showcase.py` (made-up data) and `tools/shots.mjs` make the README screenshots

## Standalone page

KeePassNC also runs without the Nextcloud app, against any WebDAV server. `npm run build`, then serve `web/` over HTTPS
(WebCrypto wants HTTPS or localhost). Enter the WebDAV URL of your file, your user name and an **app password**, not your account
password. On a different domain than the Nextcloud you need CORS for WebDAV, so the same domain is easier.
`?autolock=SECONDS` overrides the auto-lock (default 300). If you host it yourself, also read the CSP note in
[`SECURITY.md`](SECURITY.md).
