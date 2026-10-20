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
```

```apache
# web/ (the full app; connect-src is wide because WebDAV can live on any HTTPS host, narrow it to yours if you only use one)
Header always set Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
Header always set Referrer-Policy "no-referrer"
Header always set X-Content-Type-Options "nosniff"
```

For `web/` on a different domain than your Nextcloud, WebDAV needs CORS, see `CONTRIBUTING.md`. More on the CSP in `SECURITY.md`.

## A demo that doesn't need a server

Because `web/` starts with "Local file", visitors can try it with nothing but a `.kdbx` file (or "New database", which they download).
Nothing is uploaded: the file is read and decrypted in the browser tab.

## License

KeePassNC is AGPL-3.0-or-later. If you run a modified version for others, they're entitled to the source of your changes. Both pages link to this
repository in their footer or "About" text; keep that link, or point it at your fork.
