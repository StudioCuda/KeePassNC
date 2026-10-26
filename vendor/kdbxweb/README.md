# kdbxweb (vendored)

[kdbxweb](https://github.com/keeweb/kdbxweb) by Antelle, MIT (see `LICENSE`). Git state `UPSTREAM_COMMIT` (2.2.0, npm stops at 2.1.1).

Six local fixes and one addition, all already applied in `lib/`. The diffs in `patches/` record what changed, so it can be carried
over after an update. They are not uniform: four are `git diff` output with different path prefixes (`a/lib/...` or
`a/vendor/kdbxweb/lib/...`, and `date-overflow-fix.patch` doesn't apply cleanly to `UPSTREAM_COMMIT` as it is), `xml-tab-fix.patch` and
`history-customdata-fix.patch` are plain `diff` output. Read them as a list of changes to redo, not as something to feed to
`git apply`. A comparison of `lib/` with `UPSTREAM_COMMIT` (second review of 0.18.0) found exactly these changes and nothing else.

- `enable-searching-fix.patch`: write missing optional group fields as defaults instead of empty elements, which KeePassXC rejects.
- `xml-tab-fix.patch`: keep the tab character (0x09) when cleaning XML. It's valid in XML 1.0, upstream dropped it.
- `lastmodtime-binary-fix.patch`: in KDBX 4.1, write `LastModificationTime` of custom icons and custom data as binary (Base64)
  like every other KDBX 4 timestamp, text only in XML export. Same change as upstream PR #62 (issue #49), still open there.
- `history-customdata-fix.patch`: `KdbxEntry.copyFrom` also copies custom data and the quality-check flag, so history items and
  merged entries keep them (KeePassXC fixed the same for its own history items in 2.8.0, #13573).
- `date-overflow-fix.patch`: read binary timestamps without `Int64.value`, which threw "too large number" on the huge "never" values some apps (KeePassDX) write, and cap them at the latest date .NET can represent. Upstream fixed the same in keenext/kdbxweb.
- `twofish.patch`: Twofish-256 as a third cipher next to AES and ChaCha20 (`lib/crypto/twofish.ts`, written from the 1998
  specification), so files KeePassXC encrypted with Twofish open and save. Upstream never had it.
- `aes-rounds-limit.patch`: `KeyEncryptorAes.encrypt` refuses more than 1 000 000 000 rounds (`KdbxError` `Unsupported`, "too many aes rounds"). The round count comes from the file header; the app asks before opening files over 100 million rounds (`src/core/kdf-policy.js`) and this is the limit behind that question.
