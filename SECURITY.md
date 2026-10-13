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
- **The standalone page (`web/`) sets its CSP via `<meta>`.** `frame-ancestors` doesn't work there. If you host it yourself, send the
  CSP as an HTTP header from your web server.
- **The server delivers the code.** Like every web app, KeePassNC trusts the server that ships its JavaScript. A malicious server admin
  is out of scope.

## Not tested yet

Areas without real-world testing so far. Reports from any of them are welcome.

- Real phones. Mobile layouts are emulated; Firefox and WebKit run in CI.
- Nextcloud with MySQL or Postgres (the app doesn't touch the database), behind a reverse proxy, or with SSO or 2FA logins.
- The Team folders app.
- Safari may clear site data after a while without use, so there the offline copy isn't permanent storage.
