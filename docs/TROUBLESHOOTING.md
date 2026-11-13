# Troubleshooting

## Saving fails: "The server refuses the save" / "…nimmt das Speichern nicht an"

KeePassNC saves with an `If-Match` header: the server only takes the file if it is still the version you opened, so a change from another device is merged instead of overwritten. For that, the `ETag` the server sends has to arrive in the browser unchanged.

If a proxy or the web server rewrites the `ETag`, the server turns every save down (HTTP 412) although nobody else touched the file. KeePassNC then says so and keeps your changes in the tab; **Save a copy** keeps them for good.

The usual suspects are compression modules: Apache's `mod_deflate` and `mod_brotli` append `-gzip` / `-br`, nginx makes the tag weak (`W/"…"`). KeePassNC cuts these additions off by itself, so if you still see the message, something else changes the tag.

To find out, open the developer tools of your browser (F12 → Network), reload the database and look at the response headers of the `.kdbx` request: `ETag` and `OC-ETag` should show the same value. If they differ, or `ETag` looks odd, the fix lives on the server side:

- Leave `/remote.php/dav` out of compression (for Apache: no `mod_deflate` filter for that path).
- Check that a reverse proxy passes the `ETag` header on as it is.

Old `*.conflict-….bak` files next to the database from earlier failed saves are safe to delete.

## Saving fails: out of space, locked, or the file is gone

Your changes stay where they are (in the tab, and in the offline copy if that's on), and a banner says what's up. **Save a copy** always downloads the database with your changes.

- **"The server is out of space" (HTTP 507):** the storage or your quota is full. Free up some space and save again. With the offline copy on, KeePassNC keeps retrying quietly and uploads as soon as there's room.
- **"The file is locked on the server" (HTTP 423):** another app or person holds a lock on the file. Save again once it's free.
- **"This file is no longer on the server":** it was moved, renamed or deleted somewhere else, or its folder was. KeePassNC never creates it again on its own, since a moved file would then turn up twice. **Put the file back** saves the open database at its old place; if a file has turned up there by then, the two are merged, nothing is overwritten. Deleted by accident? Nextcloud's trash bin has the old version as well.
- **"The server didn't answer in time":** a request went a minute without an answer (a proxy that swallows it, a dead connection). Without the offline copy your changes stay in the tab, just save again. With it they wait in the offline copy and go up once the server answers.
