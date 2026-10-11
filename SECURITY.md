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
There has been no independent audit yet. Treat it accordingly.
