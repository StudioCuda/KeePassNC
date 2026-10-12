# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
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
