# Contributing

Bug reports, odd KDBX files, and patches are welcome.

- Run `npm test` before sending anything. If you touch the Nextcloud side, run `npm run test:nc` against a real Nextcloud too.
- Keep the master password and plaintext in the browser. A change that sends either anywhere is a no.
- Don't copy code from KeePassXC (GPL). Ideas are fine, code isn't.
- New UI text goes into both `src/i18n-de.js` and `src/i18n-en.js`; the unit tests check that they match.
- Small, focused changes get reviewed faster than big ones.
