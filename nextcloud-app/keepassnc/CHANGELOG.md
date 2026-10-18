# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Added
- Duplicating an entry now asks whether to link username and password to the original. A linked copy simply points there (`{REF:…}`, the same thing KeePassXC's "Clone" does), so a new password on the original shows up in every copy. Great for one account behind several URLs. Your choice is remembered for next time.

### Fixed
- Entries whose username, password or URL point to another entry (`{REF:P@I:…}`) now show and copy the real thing: the detail view, the list, the copy buttons and Ctrl+B / Ctrl+C / Ctrl+Shift+U all use what the reference points to instead of handing you `{REF:…}` to paste into a login form. The editor still shows the reference itself, so saving keeps it a reference.
- Long passphrases in the password generator no longer get chopped mid-word at the end of a line. A word that doesn't fit simply moves to the next line, like words do.
- Entry history now remembers an entry's custom data and its "exclude from reports" flag, too. Before, each saved state lost them, so KeePassXC showed old versions without their browser integration settings, and synced changes to that data could get dropped when merging. (KeePassXC fixed the very same thing for its own history in 2.8.)
- A password that just points to another entry's password (`{REF:P@I:…}`) is now judged by what it points to. Password health, the "Weak passwords" filter and the strength meter used to either skip it or rate the reference text itself, which looks a lot sturdier than "Summer2020". It doesn't count as reuse, though: that's the whole point of a reference.
- The password health in the "Database" dialog could read 0 % for a database that was far from hopeless. It subtracted entries with findings from the number of different passwords, so a few weak passwords shared by many entries pushed it right to the floor. It's now the average score of your entries, where an entry without findings counts as 100.
- The privacy note under the health list sits a bit lower now, with its second sentence on a line of its own.
- When the server answers an open request with an error (say, 503 because a storage behind the folder is having a moment), the login screen now shows that status instead of claiming the server is unreachable. Fetching the session token or the key file secret now leaves a note in the browser console when it fails, too, just like WebDAV requests already do.

## [0.11.0] - 2026-10-18
### Changed
- The sidebar puts your groups first now. "Expiring", "Weak passwords", TOTP and passkeys moved below them, under a new "Filters" heading.
- "Reports" is now called "Database": everything about the open file lives there, from password health and statistics to the database settings, which got their own "Settings" tab. Things that only concern the app on this device stay in the regular settings.
- The settings show which KeePassNC version you're running. Their gear icon got redrawn, too: six even teeth instead of a slightly wonky cog.

### Fixed
- Behind a reverse proxy that doesn't tell Nextcloud about HTTPS, opening a file from Files could fail with "The server is unreachable" while the server was sitting right there. The app built its WebDAV address from what PHP saw (`http://…`), and the browser blocked that on an `https://` page before it ever left. It now simply uses the page's own address. And if the server really is out of reach, the browser console now says why.
- The "Tools" block at the bottom of the sidebar is meant for narrow windows only, where the buttons in the top right go missing. A CSS mix-up showed it on wide screens too, right next to the very same buttons.
- Picking a menu item really quickly (say, on a busy laptop) could leave a stray listener behind, after which every later menu closed itself the moment you clicked one of its items. Menus now tidy up after themselves even when you're faster than they are.

## [0.10.0] - 2026-10-18
### Changed
- The header now looks like the one in Nextcloud 35 instead of its older sibling from 34: it's a bit slimmer (44 px), uses Nextcloud's font and the very same 9-dot icon. The app menu got pale round icons in your instance color that grow a little when you point at them, one shared highlight behind the 9-dot button and the app name, no arrow, and it opens when you hover there for a moment. Below the apps sits Nextcloud 35's new row of quick actions, like "Text document" from Office. Actions that need Nextcloud's own JavaScript stay out, since that doesn't run on this page.
- The password generator got simpler and clearer. Passphrases come first and now speak German too, passwords sort their symbols into two easy groups instead of six, and "Pronounceable" became "Simple": made for typing on a TV remote, and still honest about its strength.

## [0.9.1] - 2026-10-17
### Changed
- The App Store description and the README now mention icons and the database settings.

## [0.9.0] - 2026-10-17
### Added
- Icons for entries and groups: pick one of KeePass's 69 standard icons (redrawn in the app's own line style) or add your own picture. PNG, JPEG, GIF, WebP, BMP, ICO and SVG all work; they get shrunk (or, for SVG, drawn) to 128 px and saved as PNG, so KeePass, KeePassXC and the mobile apps show them too. The same picture twice is recognized, unused ones can be removed, and a group can hand its icon down to its subgroups and entries, just like in KeePassXC. Nothing is fetched from the web, not even favicons.
- Entries with a standard icon now show it in the list instead of the first letter. Entries with the default key icon keep their colorful letter.

### Changed
- More URLs are clickable: a URL field holding just `example.com` opens `https://example.com`, and extra fields with a web address are links too (bare hostnames only in fields with "URL" in the name, say `KP2A_URL_1`). `Ctrl+Shift+U` follows the same rules. Things like `cmd://` or `{REF:…}` stay plain text, and protected fields stay hidden.
- Unlocking no longer freezes the page: Argon2 does its heavy lifting in a background worker, so the page keeps reacting while your database unlocks. The worker is shut down right after, taking its (possibly gigabyte-sized) scratch memory with it. If the worker can't start, the page does the math itself like before.
- Database settings, part one: in Reports → Database, "Edit settings" lets you change the name, description and default username (pre-filled for new entries), switch the recycle bin on or off and set history limits per entry. Tighter history limits trim existing entries right away, after asking how many versions go. With the recycle bin off, deleting says "Delete permanently" and asks first, instead of promising a recycle bin that isn't there.
- Database settings, part two: the same dialog now has a Security section for encryption (AES-256 or ChaCha20), key derivation (Argon2id, Argon2d) with memory, iterations and parallelism, and the step from KDBX 3.1 up to KDBX 4. Only browser-friendly values are on offer, up to 1 GiB, and a traffic light tells you what phones will make of them. "≈ 1 s on this device" suggests iterations but never less work than you already have. Before anything is applied, the new values get a test run on this device, and you are asked first if they would make guessing your master password cheaper, need lots of memory, or make unlocking slow.

### Fixed
- The database info showed 0 iterations for KDBX 3.1 files with AES-KDF. It now shows the real number of rounds.
- Saving after someone else changed the file no longer undoes their encryption settings. If KeePassXC (or another device) beefed up the key derivation or switched the cipher in the meantime, KeePassNC used to merge the entries but quietly write its own older settings back. Now the side that actually changed them wins.
- A database without any tags no longer greets you with a lonely "null" in the sidebar above the recycle bin.

## [0.8.1] - 2026-10-17
### Changed
- The Nextcloud header looks even more like the real thing: the 9-dot button and the app name light up on their own when you hover them, and the app menu has Nextcloud's four columns of round, colored app icons with a little arrow pointing at the button.
- The account menu on the right followed suit: your picture gets Nextcloud's thin ring and bold outline on hover, and the menu shows your name with "View profile" on top, then the entries with their usual icons.

### Fixed
- An app without an icon in the app menu shows its first letter instead of an empty circle.

## [0.8.0] - 2026-10-17
### Added
- KeePassNC now dresses like your Nextcloud. It takes the instance color (or your own, if you picked one), follows your light, dark or high-contrast choice from the accessibility settings, and keeps the familiar header with the 9-dot app menu and your account menu. Garish colors get toned down until text on them is readable again, and the plain Nextcloud blue leaves our night blue and gold alone. New setting "Same as Nextcloud" is the default for the color scheme; "Use the Nextcloud accent color" can be switched off. The header has no search, notifications or contacts menu, on purpose: those need Nextcloud's JavaScript, and that stays off this page.
- A "Pronounceable" mode in the password generator: syllables like `Gosher9faggud3pizguz&dadkor` that you can read out over the phone or type on a TV remote without losing your mind. Letters that get mixed up when spelled out (c/k, v/f/w, j/y, q, x) stay out, and so do braces, slashes and `|` between the groups. Out of the box it starts with a capital and mixes in a digit and a symbol, so the usual "one of each" password rules are happy. Every syllable is drawn uniformly, so the bit count is exact, not wishful.

### Changed
- The App Store description is sorted into short sections with bullet points instead of one long paragraph, in English and German.
- The App Store listing links to the docs, and the app declares itself compatible up to Nextcloud 37 (newest tested version plus two) instead of "forever".
- The search field just says "Search" now, without the cheat sheet of filter examples. The filters (`url:`, `is:weak`, `-tag:` …) still work, the README has the full list.

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
