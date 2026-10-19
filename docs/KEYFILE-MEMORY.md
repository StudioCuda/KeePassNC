# Remember the key file: security design

Implemented in `src/keyfile-store.js`, wired up in `src/ui/login.js`, `src/ui/settings-dialog.js` and `src/ui/credentials-dialog.js`. Server side (Nextcloud):
`nextcloud-app/keepassnc/lib/Controller/PepperController.php`. Tests: `tests/unit/keyfile-store.test.mjs`, `tests/e2e/keyfile.mjs`,
`tests/e2e/keyfile-nc.mjs` (Nextcloud mode against a simulation), `tests/nextcloud/run.mjs` (endpoint against a real Nextcloud).

## Goal

If your KDBX needs a master password **and** a key file, you'd have to pick the key file at every login. On your own device that's
tedious. This feature lets you remember the key file on this device, **optionally**, without handing an attacker who lacks the
master password anything they wouldn't have with a known key file anyway.

## Behaviour

- **Off by default.** "Remember key file on this device" only shows up once a key file is chosen, and is never pre-ticked.
- Remembered only **after a successful open**, so password and key file are confirmed.
- Only with a master password. A database that opens with the key file alone has nothing to encrypt the record with, so the
  login says so and remembers nothing.
- One record per database. Ids: `nc:<user>:<path>`, `dav:<url>`, `file:<file name>`; a local file inside Nextcloud: `nc-file:<user>:<file name>`.
  Id, key file and the wish to remember are captured on submit; changes during download or KDF don't count anymore.
- Local files have no path, so two different databases with the same name share a record. The error message points that out.
- A record that is cheaper than what would be chosen for the database today (older version, DB KDF raised since) is re-encrypted in
  the background after a successful open.
- Next login: "Use remembered key file" is preselected, typing the master password is enough. A key file picked by hand wins.
- Changing the master password or key file (the "Database" dialog) re-encrypts this device's record with the new ones, or
  forgets it when the key file is gone. Records on other devices no longer fit: there, pick the key file by hand once.
- "Forget" (login), "Forget all" (settings) and "Delete local data of this browser" remove records. In Nextcloud the settings only
  show and delete records of the signed-in user; "Delete local data" still removes everything in this browser.

## Nextcloud: also bound to a server secret (format v2)

- The Nextcloud app keeps a random 32-byte value per user ("pepper", `IUserConfig`, marked sensitive, so encrypted in the database).
  Fetch: `GET /apps/keepassnc/api/kf-pepper`, renew: `POST …/rotate`. Both need a signed-in session and pass the CSRF check.
- Record key = HKDF-SHA256(Argon2id(master password), salt = pepper, info = `kpnc-keyfile-v2`).
  AAD = `kpnc-keyfile-v2\0<pepper id>\0<record id>\0<display name>`.
- So whoever only copies the browser profile **can't guess offline without access to the Nextcloud**. The server alone has nothing
  (no record, no password).
- **"Invalidate on all devices"** (settings) renews the pepper: every remembered key file of the account becomes useless everywhere at
  once (lost device). The next login says so and removes the record; pick the key file by hand once.
- **Server unreachable:** the remembered key file doesn't work ("please pick it by hand"); the offline copy of the database still does.
- **Handling unchanged:** KDBX, key file, backup and export aren't affected. If the pepper is lost (user deleted, server restored
  without user settings), only the *remembered* records are lost, never the database. Disabling the app keeps the pepper on purpose
  (Nextcloud runs uninstall steps on every disable), so switching it off and on again costs nothing.
- Older v1 records are switched to v2 after the next successful open in Nextcloud. The standalone page stays on v1.
- **Limits, honestly:** (1) The profile often holds the Nextcloud session cookie too ("stay signed in"). While it's valid, a thief can
  fetch the pepper with it. So after a loss: "Invalidate on all devices" **and** sign out the sessions and devices in Nextcloud
  under *Security*. (2) Scripts of the same origin (other apps on the instance, XSS) can fetch the pepper as the signed-in user too.
  v2 doesn't help there, but it does against quietly taking the record *without* a session.

## Cryptography

| Part | Choice |
|---|---|
| Key derivation | Argon2id (hash-wasm), parallelism 1, 128-bit random salt. Work (memory × iterations) **at least** that of the database KDF: memory = DB memory (64 MiB … 1 GiB), iterations raised so the work doesn't drop (3 … 64). AES-KDF databases: fixed 64 MiB / 16. Accepted when reading: 8 MiB … 1 GiB, 1 … 64 iterations (integers), salt ≥ 16 bytes, IV = 12 bytes |
| Password input | master password as UTF-8 (like KeePass), unchanged (no normalisation) |
| Encryption | AES-256-GCM via WebCrypto, random 96-bit IV, AAD = `kpnc-keyfile-v1\0<record id>` (v1) or see above (v2) |
| Derived key | imported as a non-extractable `CryptoKey`, raw bytes overwritten with zeros right away, never stored |
| Stored (IndexedDB, store `files`, key `kf:<id>`) | format, id, display name (file name of the key file), timestamp, KDF parameters + salt, IV, ciphertext; v2 also the pepper *id* (not its value) |
| Never stored | master password, derived key, plaintext key file, pepper value (fetched at each login) |

Why **no** device-bound key (say a non-extractable `CryptoKey` in the browser)? It would allow remembering without the master
password, but it protects neither against same-origin scripts (they just call `decrypt`) nor against a copied browser profile (the
key bytes live there). Comfort with fake security. Deriving from the master password makes the record worthless without it.

## Threat model

| Attacker | Outcome |
|---|---|
| Curious co-user of the same browser, doesn't know the master password | Sees only file name and id; ciphertext useless. The offline copy of the KDBX is encrypted too. |
| XSS or foreign script in the app's origin (**in Nextcloud: every app and every XSS on the same instance**, IndexedDB is per origin, not per app) | Can **read and take** the record (and the offline copy), then guess offline like the profile thief. Without this feature such a script would also need the key file. The page itself can't be framed anymore (`frame-ancestors 'none'`), but same-origin scripts can still reach it via `window.open`. The origin is the trust boundary. Such a script could also grab the password while you type, independent of this feature. |
| Thief with a copy of the browser profile, **Nextcloud** | Without access to the Nextcloud (session expired or signed out, server only on LAN/VPN, pepper renewed) **no offline guessing**. With a still valid session cookie from the profile: pepper fetchable, then as in the next row. Remedy: "Invalidate on all devices" + sign out sessions. |
| Thief with a copy of the browser profile or disk (standalone page, or Nextcloud with a valid session) | Can **guess the master password offline**, checking each guess against the GCM tag, cost per guess ≥ database KDF (Argon2id, at least 64 MiB / 3; upper bound 1 GiB × 64). The profile usually also holds the Nextcloud session and maybe the offline copy, so they have the KDBX anyway. **Residual risk:** the key file no longer works as a second factor here, because the attacker gets it after a successful guess. The master password has to carry this alone. |
| Attacker with write access to the profile | Can delete or replace the record: the result is a login error, not access. Tampered KDF parameters (memory or time bomb) are rejected before computing. A record of one file can't be used for another (AAD). |
| Server / network | Sees none of it; the record never leaves the device. |
| Timing / side channels | Not part of the model (WebCrypto and hash-wasm in the browser). |

## Deliberately not built

- No "remember password", no automatic login, no biometrics.
- No sync of remembered key files between devices.
- Possible later: the WebAuthn PRF extension as an extra factor for decrypting the record (device or security key instead of only
  the password). That would stop offline guessing after profile theft, but needs PRF support in all target browsers.
