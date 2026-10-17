# kdbxweb (vendored)

[kdbxweb](https://github.com/keeweb/kdbxweb) by Antelle, MIT (see `LICENSE`). Git state `UPSTREAM_COMMIT` (2.2.0, npm stops at 2.1.1).

Three local fixes, all already applied in `lib/`. The diffs are in `patches/` so they can be re-applied after an update:

- `enable-searching-fix.patch`: write missing optional group fields as defaults instead of empty elements, which KeePassXC rejects.
- `xml-tab-fix.patch`: keep the tab character (0x09) when cleaning XML. It's valid in XML 1.0, upstream dropped it.
- `lastmodtime-binary-fix.patch`: in KDBX 4.1, write `LastModificationTime` of custom icons and custom data as binary (Base64)
  like every other KDBX 4 timestamp, text only in XML export. Same change as upstream PR #62 (issue #49), still open there.
