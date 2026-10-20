# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.15.0] - 2026-10-20
### Added
- A page for the password generator alone (`web-generator/`), for hosting it on its own, e.g. as pass.example.org: passphrases, passwords and Simple, no sign-in, and a CSP that allows no network connections at all. It speaks German or English by browser language, with a small switch at the bottom. See `docs/HOSTING.md`.
### Changed
- The generator's "Regenerate" button moved down next to the strength bars, so the preview gets the full width.
- The generator's small hint lines (word list source, bits per block) became tooltips on "Words", "Word list" and "Blocks"; the dotted underline shows where. The word list credits are in the README.
- The standalone page opens a local file by default, so you can try it without a server; the switch to Nextcloud/WebDAV is the same one as before and is remembered. Inside Nextcloud nothing changes.
- The "click a .kdbx file in Files" tip on the open-vault screen is a tooltip on the file label and field now, instead of a line of its own.

## [0.14.1] - 2026-10-20
### Changed
- The password generator sits still now: the preview keeps a fixed height (five lines for passphrases, two for Simple, and for passwords exactly as tall as the passphrase dialog), so dragging a slider or switching tabs no longer makes the window hop. Shorter values sit centred in it.
- Passphrase options got tidier: the word list moves up next to the separator, and the capitalisation menu becomes a "First letter upper case" checkbox like in Simple. Upper case and one-word-upper are gone; a saved choice of either falls back to lower case.
- Password health fills its second row: "No issues" counts the entries that are fine, "Older than a year" the passwords that haven't changed in over a year (going by the entry history). Age is just a nudge and doesn't lower the score.
- A touch more polish on the shield mark: softly rounded tips and corners, the same everywhere.
### Fixed
- The buttons under Database → Settings wrap into a tidy grid instead of running off the edge with a scrollbar.

## [0.14.0] - 2026-10-19
### Added
- The search also matches the group path, so typing a folder name finds what's inside it (as in KeePass 2.60).
### Fixed
- On phones the last entry in the list scrolls clear of the + button instead of hiding behind it.

### Changed
- A mark of its own: the shield now carries a keyhole instead of a check mark. It's a little wider with softer shoulders, and the keyhole is a circle on a shaft whose end repeats the point of the shield. It's the same drawing everywhere: the app icon in Nextcloud, the sign-in page, the big watermark (the standalone page gets it behind its dark panel too), the header of the standalone page. New: a favicon and a home-screen icon, so the browser tab and your phone's home screen show it too.
- In Nextcloud the app now sits in a rounded panel in front of your instance colour, the way the native apps do (8px margin, 16px corners, edge to edge below 1024px). A calmer sign-in page (in Nextcloud's high-contrast themes the decoration steps aside, and "‹ Files" is a quiet line above the title). Inside Nextcloud it's now just the card under the header, no big blue panel next to it. A file you opened from Files shows up as a small card with its name and folder instead of a read-only path field. The key file and the offline copy tuck away under "Key file & offline options" until you need them (they open by themselves once you pick a key file). The eye for the master password sits inside the field, and "Delete local data" moved from the page footer into the settings. A touch more warmth, too: a small shield next to the title, a soft, neutral spotlight behind the card, a huge, barely-there shield in the corner, a thin accent edge, and one quiet line saying it's decrypted in your browser only. Opening has a little moment now: a sweep on the button while it decrypts, the lock springs open, and the vault fades in (skipped if your system asks for less motion). The field label gets small capitals, the card breathes a bit more, and it glows slightly while you type.

## [0.13.0] - 2026-10-19
### Added
- Create a brand-new database. In Files it's **+ New** → **KeePass database**, on the sign-in page it's "Create one" under the form. One screen, no wizard: a name (no `.kdbx` to type), a folder (where you came from in Files, or next to your last database, with a little folder browser to pick another or make a new one), the master password (with the generator, if you like) and an optional key file, either one you have or a fresh `.keyx` that counts once you've downloaded it and picked it again. The encryption needs no decisions: KDBX 4 with AES-256 and Argon2id at 64 MiB, tuned to about a second on your device, so KeePassXC, KeePass 2 and the mobile apps open it straight away. Fiddle with it later under Database → Security if you want. If the name's already taken in that folder you hear about it while typing, an existing file is never overwritten, and the new database opens right away. Works for a local file too, which then simply gets downloaded.
- No more typing paths on the sign-in page: **Browse** next to the path field opens the same little folder browser as for a new database, this time with your `.kdbx` files to pick. It starts where the path in the field points to. When you come from Files the file is already set, so the button stays away.
- Placeholders, the way KeePass and KeePassXC know them: `{USERNAME}`, `{PASSWORD}`, `{TITLE}`, `{URL}`, `{NOTES}`, `{S:Any field}` and the URL parts `{URL:HOST}`, `{URL:RMVSCM}` (no scheme), `{URL:PORT}`, `{URL:PATH}` and friends. A URL like `https://{S:Host}/login` now opens the real address, and a username of `{S:Login}` shows and copies what's in that field. They mix with `{REF:…}` references and nest, just like in KeePassXC. The editor keeps showing the placeholder itself, so saving keeps it.
- Peek at attachments: pictures (PNG, JPEG, GIF, WebP, BMP, ICO, SVG) and text files (notes, keys, certificates, configs …) get an eye button that shows them right there, no download needed. SVGs are shown as pictures only, so nothing in them runs.
- Entry colours, the ones KeePass and KeePassXC call background colour. Pick one of six in the editor (or keep whatever colour another app set) and the entry gets a coloured stripe in the list.
- TOTP from a QR code: in the editor, "From QR code" reads a screenshot of the setup page and fills in the `otpauth://` address. The picture never leaves the browser; [jsQR](https://github.com/cozmo/jsQR) does the reading in a worker of its own, so the app itself stays as light as before.
- Merge with another copy, like KeePassXC's "Merge from database". The Nextcloud desktop and phone apps like to leave a "(conflicted copy …)" next to your file when two devices disagree; the "Database" dialog (Settings tab, or the command palette) now lists the other `.kdbx` files in the same folder, or takes one from your device. Per entry the newer version wins and the older one goes into its history, deletions come along too, and you get a short "2 new, 1 changed" summary. Encryption and master password stay yours; if the copy uses different credentials, you're asked for them. A file that's a different database altogether is turned away politely.
- CSV import and export, in the "Database" dialog (Settings tab) and the command palette. The import reads what KeePassXC, KeePass 2, Bitwarden, 1Password, LastPass, Chrome, Edge and Firefox export, shows what it found and which columns it leaves out, and puts everything into a new group of its own ("Import bitwarden"), folders included, so it's easy to sort or throw away again. TOTP secrets come along. The export writes the same columns as KeePassXC, with placeholders and field references resolved and the recycle bin left out, and only after you've confirmed that a plain-text file full of passwords is something to handle with care.
- Change the master password and the key file, right from the "Database" dialog (Settings tab). You confirm with the current password, can keep, swap, create or drop the key file, and the change is saved straight away. A freshly created key file (`.keyx`, the same format KeePassXC writes) only counts once you've downloaded it and picked it again to show it's really saved, so nobody locks themselves out by accident. A remembered key file on this device follows along. If another device saved in the meantime, both get merged as usual. Backup copies next to the file still open with the old credentials; a checkbox deletes them afterwards if the old ones got out.
- Twofish. KeePassXC lets you encrypt a database with Twofish instead of AES or ChaCha20, and until now such a file greeted you with a cryptic error here. It now opens, saves and stays Twofish, KDBX 3.1 and 4 alike. The database settings keep offering it for such files, but don't suggest it for others: it's secure, just slower in the browser, and KeePass 2 needs a plugin for it. AES-KDF works the same way. A file that uses something we really can't read (say, a KeePass 2 plugin cipher) now gets the plain "not a valid or supported KDBX file" message instead of a raw error.
- "Leave out of password health" in the entry editor. KeePassNC already respected the flag when KeePass 2 or KeePassXC had set it, you just couldn't set it here. Handy for that four-digit PIN that's weak on purpose. It's written in both dialects, `QualityCheck` for KeePass 2 (KDBX 4.1) and `KnownBad` for KeePassXC, and the "Weak passwords" filter skips such entries too.

### Changed
- The standalone page (the one without the Nextcloud app) now asks for your Nextcloud's address, like `cloud.example.org`, instead of a WebDAV URL. Enter your user name and an app password, then browse for the file or pick a name and folder for a new one, the same way as inside Nextcloud. Other WebDAV servers still work through "Enter your own WebDAV address". If you've used the page before, nothing to do: your saved address fills in the new fields, and remembered key files and offline copies stay right where they were. If the page lives on another domain and the server doesn't allow that (CORS), you now get told so instead of a bare "server unreachable".
- The App Store description and the README now mention new databases, merging, CSV, placeholders and friends.
- Small wording polish: the German texts speak to you with "du" everywhere (one error message still said "Ihre"), a few messages read a bit smoother in both languages, and the English texts use the same quotes and apostrophes throughout.
- A wrong master password now also mentions the other usual suspect: a KeePassXC database that needs a hardware key like a YubiKey. Browsers can't talk to it, so such files don't open here.

### Fixed
- Databases protected by a key file alone, without a master password, open now: leave the password empty and pick the key file. Just like KeePassXC, an empty field first tries "no password" and then "empty password", which are two different keys. Before, the login insisted on a password and such files simply didn't open. A key file can only be remembered together with a master password, since that's what encrypts the record.
- Changed the master password or key file on another device while KeePassNC was open here? It now asks for the new ones and carries on: your unsaved changes get merged and saved with them. Before, it told you to sign in again, and with unsynced offline changes that sign-in failed with the new password. If that happens at sign-in, the login now explains the way through: sign in with the old credentials, then enter the new ones.

## [0.12.0] - 2026-10-18
### Added
- Duplicating an entry now asks whether to link username and password to the original. A linked copy simply points there (`{REF:…}`, the same thing KeePassXC's "Clone" does), so a new password on the original shows up in every copy. Great for one account behind several URLs. Your choice is remembered for next time.

### Fixed
- Opening a file from Nextcloud failed with "The server is unreachable" on every Nextcloud with pretty URLs, the ones without `index.php` in the address (the default on YunoHost and in many Docker setups). The app asked a host literally called `csrftoken` for its session token instead of your server. Thanks to everyone in #50 who patiently dug through their browser's developer tools with us.
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
