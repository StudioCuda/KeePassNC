# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- A "Pronounceable" mode in the password generator: syllables like `gosher9faggud3pizguz&dadkor` that you can read out over the phone or type on a TV remote without losing your mind. Letters that get mixed up when spelled out (c/k, v/f/w, j/y, q, x) stay out, and so do braces, slashes and `|` between the groups. Every syllable is drawn uniformly, so the bit count is exact, not wishful.

### Changed
- The App Store listing links to the docs, and the app declares itself compatible up to Nextcloud 37 (newest tested version plus two) instead of "forever".

### Fixed
- The generator's strength meter now shows the exact entropy of what it generated. It used to guess from the characters and rated a six-word passphrase at well over 150 bits instead of the honest 77. The editor keeps the exact value as long as you don't touch the generated password.
- KDBX 4.1 files with custom icons or plugin data: their "last modified" stamps are now saved in the binary format the spec asks for, not as plain text that KeePass 2 chokes on with "Invalid Base-64 string". KeePassXC never minded, so you may not have noticed.

## [0.7.1] - 2026-10-17
### Fixed
- Custom fields with several lines (KeePass 2 and KeePassXC allow that) now show their line breaks instead of one long sausage, and editing such a field no longer flattens it into a single line on save. Protected fields stay hidden in the editor until you click the eye.

## [0.7.0] - 2026-10-13
### Changed
- New colors. Night blue and gold instead of the indigo-purple gradients: warm linen greys and night-blue buttons in light mode, a night-blue dark mode with gold buttons, a sage logo tile. Contrast checked for text and buttons in both.

## [0.6.0] - 2026-10-12
### Added
- Steam Guard codes. Entries with `encoder=steam` (KeePassXC) or the old `30;S` setting now show the 5-character Steam code instead of six digits that Steam won't take.
- Shared files: a database someone shared with you read-only is marked as such when you open it, and saving says why it can't, instead of "status 403".
- "Remove passkey" on the passkey card. The previous state stays in the entry's history, so it can come back.

### Fixed
- Saving a file in a shared folder where you may edit but not create files no longer fails on the backup copy. It saves and tells you there's no backup this time.
- Duplicating an entry no longer copies its passkey. Two entries with the same key confused the browser extension.
- A duplicated entry was called "… - Kopie" in English too.

### Changed
- If a database asks for more memory than the device or browser can give (Argon2, mostly a phone problem), the login form now says so in plain words and what to do about it, instead of showing a raw `RangeError`.

## [0.5.2] - 2026-10-11
### Changed
- App Store texts rewritten in English (and kept in German). Same app, better small print.
- License field is now a proper SPDX identifier (`AGPL-3.0-or-later`), which the App Store wants from Nextcloud 31 on.

## [0.5.0] - 2026-10-11
### Added
- Server-side secret for the remembered key file. Fetching it needs a session and a CSRF token.
- `frame-ancestors 'none'`: the app page can't be embedded in someone else's frame.

## [0.4.0] - 2026-10-11
### Added
- New interface: three panes, mobile layout, light and dark, English and German.
- KeePassXC-style search, command palette, group management, attachments, history, password generator, health report.
- Optional key file memory, cleanup of old backup copies on the server.

## [0.3.0]
### Added
- Offline copy, service worker, automatic save and sync.

## [0.2.0]
### Added
- First Nextcloud app: open `.kdbx` files from Files with your Nextcloud session.
