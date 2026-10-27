# Troubleshooting

## Saving fails: "The server refuses the save" / "…nimmt das Speichern nicht an"

KeePassNC saves with an `If-Match` header: the server only takes the file if it is still the version you opened, so a change from another device is merged instead of overwritten. For that, the `ETag` the server sends has to arrive in the browser unchanged.

If a proxy or the web server rewrites the `ETag`, the server turns every save down (HTTP 412) although nobody else touched the file. KeePassNC then says so and keeps your changes in the tab; **Save a copy** keeps them for good.

The usual suspects are compression modules: Apache's `mod_deflate` and `mod_brotli` append `-gzip` / `-br`, nginx makes the tag weak (`W/"…"`). KeePassNC cuts these additions off by itself, so if you still see the message, something else changes the tag.

To find out, open the developer tools of your browser (F12 → Network), reload the database and look at the response headers of the `.kdbx` request: `ETag` and `OC-ETag` should show the same value. If they differ, or `ETag` looks odd, the fix lives on the server side:

- Leave `/remote.php/dav` out of compression (for Apache: no `mod_deflate` filter for that path).
- Check that a reverse proxy passes the `ETag` header on as it is.

Old `*.conflict-….bak` files next to the database from earlier failed saves are safe to delete.
