# Hosting the web pages yourself

`npm run build` makes two static sites you can put on any web space. Both need HTTPS (WebCrypto), and neither needs PHP or a database.

| Folder | What it is |
| --- | --- |
| `web/` | The full app without Nextcloud. Opens a local `.kdbx` file by default, or one from Nextcloud/WebDAV (see `CONTRIBUTING.md`). |
| `web-generator/` | Just the password generator. No sign-in, no network at all (`connect-src 'none'`). |

Upload the folder's contents, not the folder itself, e.g. `web-generator/*` to `pass.example.org`. `index.html` is committed; the rest is build output.

## Headers

Both pages carry a CSP in a `<meta>` tag, but `frame-ancestors` only works as a real header, so send one too. Apache (`.htaccess`):

```apache
# web-generator/
Header always set Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
Header always set Referrer-Policy "no-referrer"
Header always set X-Content-Type-Options "nosniff"
Header always set Strict-Transport-Security "max-age=63072000"
```

```apache
# web/ (the full app; connect-src is wide because WebDAV can live on any HTTPS host, narrow it to yours if you only use one)
Header always set Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
Header always set Referrer-Policy "no-referrer"
Header always set X-Content-Type-Options "nosniff"
Header always set Strict-Transport-Security "max-age=63072000"
```

`Strict-Transport-Security` keeps browsers on HTTPS for two years after the first visit, so nobody on the way can catch a later plain `http://` request before the redirect. It's left without `includeSubDomains` on purpose, since that would cover every other site under the same domain too. Add it (and `preload`) only if all of them run on HTTPS.

For `web/` on a different domain than your Nextcloud, WebDAV needs CORS, see `CONTRIBUTING.md`. More on the CSP in `SECURITY.md`.

`web/` and `web-generator/` already ship a ready-made `.htaccess` with these headers and an HTTPS redirect, so on Apache hosting such as Netcup shared webhosting you only upload the folder's contents (the dotfile included, make sure your FTP client shows hidden files). It also sets a two-hour browser cache, so an update reaches returning visitors the same day. Some hosts put their own web server in front for static files and ignore that line: if the response still says `max-age=2419200` (or similar), change the cache time for static files in your hosting panel.

## A demo that doesn't need a server

Because `web/` starts with "Local file", visitors can try it with nothing but a `.kdbx` file (or "New database", which they download). Nothing is uploaded: the file is read and decrypted in the browser tab.

## License

KeePassNC is AGPL-3.0-or-later. If you run a modified version for others, they're entitled to the source of your changes. Both pages link to this repository in their footer or "About" text; keep that link, or point it at your fork.
