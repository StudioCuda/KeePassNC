# Everything KeePassNC can do

The short tour is in the [README](../README.md). This is the long version, for when you want to know whether your favourite
KeePass trick works here too (it probably does).

<p>
  <img src="screenshots/desktop-reports.png" width="49%" alt="Health report: weak, reused and expiring passwords">
  <img src="screenshots/desktop-generator.png" width="49%" alt="Password generator">
</p>

## Finding things

- **Search like in KeePassXC:** `user:`, `tag:`, `is:weak`, `has:totp` and friends. Plain words work too. See
  [Search syntax](#search-syntax) below.
- **Command palette:** press `Ctrl+K` and type what you want to do.

## Keeping things tidy

- Groups with drag and drop.
- Icons: KeePass's own, or your pictures.
- Colors, tags and expiry dates.
- Attachments. Pictures and text files get a preview.
- Recycle bin and the full history of every entry, so an unlucky edit is never final.

## Passwords and codes

- **Two-factor codes:** TOTP codes sit right next to the password, Steam Guard included. Setting one up? Pick a screenshot
  of the QR code, no typing needed.
- **Passkeys:** passkeys saved by KeePassXC are shown and kept intact.
- **Generator:** passphrases (English or German), classic passwords, and simple ones you can type with a TV remote.
- **Health report:** finds weak, reused and expired passwords.

## Speaking fluent KeePass

- Placeholders like `{S:Host}` or `{URL:HOST}`, and `{REF:…}` references.
- Twofish, and databases locked with a key file alone.
- **Database settings:** name, recycle bin, history, encryption and key derivation. KeePassNC suggests values your browser
  can handle, and does a test run before it changes anything.
- **New master password or key file:** change both right in the app. A new key file only counts once you've shown that you
  saved it.
  Backup copies (`.bak`) still open with the old credentials, so the dialog can delete them. On Nextcloud, file versions and
  the trash bin keep old states too; clean those up in Files (see [SECURITY.md](../SECURITY.md)).
- **Key file, remembered:** if you use a key file, KeePassNC can remember it on your device, protected by a secret on your
  server. Optional, and off by default. [How it works](KEYFILE-MEMORY.md).

## Moving in (and out)

- Import CSV exports from KeePassXC, Bitwarden, 1Password, LastPass, Proton Pass, Chrome or Firefox.
- Coming from Nextcloud Passwords, Passman or Bitwarden? Import their JSON export (Passwords: "Backup or export" → "Database backup"). Folders, tags and extra fields come along, Passman's files too.
- Export to CSV the way KeePassXC does it.

## Playing nicely with Nextcloud

- **Shared files:** databases someone shared with you open fine. Read-only shares say so.
- **Feels at home:** picks up your instance's color and your light or dark choice, and keeps the Nextcloud header with the
  app menu on top. Search, notifications and the contacts menu sit this one out, [here's why](../SECURITY.md#model-in-short).
  The color, not the background image: Nextcloud has no public way to hand that one over.
- **Careful saving:** a backup copy is made before every save. If two devices change the file at once, both changes are
  kept. Got a "conflicted copy" from the Nextcloud desktop app anyway? Merge it back in from the "Database" dialog.
- **Works offline:** turn on the encrypted offline copy and your passwords stay usable when the server or network is down.
  Changes sync back later.
- **Phone or big screen:** three panes on a desktop, one on a phone. Light and dark, English, German and Chinese.

## Search syntax

Words separated by spaces must all match. Plain words look in title, user name, URL, notes and tags.

- **Fields:** `title:`, `user:`, `url:`, `notes:`, `pass:`, `tag:`, `group:` (with a `/` it matches the path), `attr:` (field
  names), `att:` (attachment names), `uuid:`, and `_Name:` for the custom field *Name*. The start of a field name is enough.
- **Filters:** `is:weak`, `is:expired`, `is:expired-30` (expired or expiring within 30 days), `has:totp`, `has:passkey`,
  `has:attachment`, `has:tags`, `has:url`, `has:notes`, `has:history`.
- **Modifiers:** `-` or `!` excludes, `+` matches exactly (case included), `*` turns the rest into a regular expression.
- **Wildcards:** `*`, `?` and `|` (or), and `"quotes"` for values with spaces.

Example: `url:bank is:weak -tag:old`

## Locking

The page locks after the idle time you choose (and, if you like, when the tab has been hidden for a minute). With changes that
can't be saved right then, the unlock screen takes over instead and keeps them in memory: unlock it with the master password
(and key file) to carry on, and it offers to save. `SECURITY.md` says what that means for security.

## Keyboard shortcuts

`Ctrl+K` palette, `Ctrl+F` search, `Ctrl+N` new entry, `Ctrl+S` save, `Ctrl+L` lock, `Ctrl+B` copy user name,
`Ctrl+C` copy password, `Ctrl+Shift+U` open URL, `Del` delete.
