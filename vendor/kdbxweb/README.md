# kdbxweb (vendored)

[kdbxweb](https://github.com/keeweb/kdbxweb) by Antelle, MIT (see `LICENSE`). Git state `UPSTREAM_COMMIT` (2.2.0, npm stops at 2.1.1).

Two local fixes, both already applied in `lib/`. The diffs are in `patches/` so they can be re-applied after an update:

- `enable-searching-fix.patch`: write missing optional group fields as defaults instead of empty elements, which KeePassXC rejects.
- `xml-tab-fix.patch`: keep the tab character (0x09) when cleaning XML. It's valid in XML 1.0, upstream dropped it.
