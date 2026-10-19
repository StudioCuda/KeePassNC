# Security

KeePassNC handles password databases, so security reports are welcome, and boring, private ones are best.

## Reporting

Please **don't** open a public issue for a vulnerability. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability") on this repository. Include what you did, what you expected and what happened.
You'll get an answer, though this is a small project, so "within a few days" is the honest promise.

## What we consider in scope

- Anything that makes the master password, key file or decrypted entries reach the server or a third party.
- Weaknesses in how the optional key file memory (`docs/KEYFILE-MEMORY.md`) stores data in the browser.
- Ways to read or write another user's file through the Nextcloud app.
- Missing or weakened browser protections (CSP, framing, CSRF).

## Model in short

Decryption happens in the browser only. The server sees the encrypted KDBX and, for the key file memory feature, a random per-user
secret that is useless without the master password. Details and the known residual risk are in `docs/KEYFILE-MEMORY.md`.
There has been no independent audit yet. Treat it accordingly: until then, keep your regular KeePassXC copy around. The file
format being boring is the point.

Saving is defensive too: writes use ETag checks, a backup copy goes next to the file first, and if two devices edited at once the
two versions are merged instead of one quietly winning. The app loads no external scripts or fonts and runs under a strict CSP.

In Nextcloud the page is served on its own, without Nextcloud's layout and scripts. Any other app's JavaScript would otherwise run on
the very page where your passwords sit decrypted. The header with the app menu and your account menu is KeePassNC's own: the server
hands over the menu entries and the instance color, the browser checks them, and nothing else runs. That's why the header has no
unified search, notifications or contacts menu, which all need Nextcloud's JavaScript. The color reaches the page as data and gets
applied through the CSSOM, so the CSP still allows no inline styles at all.

## Known limitations

Things we know about and can't fix from inside the app. Reports that find a way around them are very welcome.

- **Your Nextcloud is the trust boundary.** The browser keeps data per origin, not per app. Every other app on the same Nextcloud
  instance, and any XSS bug anywhere in it, runs with the same rights as KeePassNC in your browser. Such a script can read what
  KeePassNC stores locally (encrypted offline copy, key file memory record) and can replace the app's offline cache, so that a fake
  page starts the next time the server is down. Only a separate origin would really wall that off. In practice: install apps you trust.
- **Key file memory turns two factors into one, on that device.** If you let KeePassNC remember the key file, the master password
  carries the whole load there. On Nextcloud the record is also bound to a per-user server secret, so a copied browser profile alone
  isn't enough. A still valid session cookie in that profile is, though. Lost a device? Use "Invalidate on all devices" and sign out
  its Nextcloud sessions.
- **Old copies keep the old credentials.** After you change the master password or key file, everything written before still
  opens with the old ones: the backup copies next to the file (the dialog can delete them), Nextcloud's own file versions and trash
  bin, offline copies on other devices until they sync, and any copy someone already made. If you change them because the old ones
  leaked, clean up those places too.
- **The standalone page (`web/`) sets its CSP via `<meta>`.** `frame-ancestors` doesn't work there. If you host it yourself, send the
  CSP as an HTTP header from your web server. Argon2 runs in a worker loaded from `keepassnc-argon2.js` next to `keepassnc.js`, so
  a `worker-src` (if you set one) needs `'self'`, and a CSP on that file itself needs `'wasm-unsafe-eval'`. Otherwise the page falls
  back to doing the math itself, which works but freezes the page while it unlocks. Reading a TOTP QR code from a picture uses a
  second worker, `keepassnc-qr.js`, under the same `worker-src` rule.
- **Some hosting setups replace the CSP.** YunoHost, for example, swaps every page's `Content-Security-Policy` for a bare
  `upgrade-insecure-requests`. Everything still works and decrypts only in your browser, but without the strict CSP. Admins can
  restore it for `/apps/keepassnc/` in their web server.
- **The server delivers the code.** Like every web app, KeePassNC trusts the server that ships its JavaScript. A malicious server admin
  is out of scope.

## Not tested yet

Areas without real-world testing so far. Reports from any of them are welcome.

- Real phones. Mobile layouts are emulated; Firefox and WebKit run in CI.
- Nextcloud with MySQL or Postgres (the app doesn't touch the database), behind a reverse proxy, or with SSO or 2FA logins.
- The Team folders app.
- Safari may clear site data after a while without use, so there the offline copy isn't permanent storage.
