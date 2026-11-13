// Minimal test server: serves web/ statically and provides a WebDAV-like file store under /dav/
// (GET/HEAD/PUT with ETag, If-Match, If-None-Match, PROPFIND, MKCOL, HTTP basic auth). For tests only, not for production.
// nc: additionally a replica of the app page in Nextcloud under /index.php/apps/keepassnc/ (templates/page.html, ?open= and ?new=)
// with /index.php/csrftoken; WebDAV then accepts the session's CSRF token instead of Basic (like Nextcloud for its own page).
// The same store is also available under /remote.php/dav/files/<ncId>/ as in a Nextcloud, and PROPFIND on /remote.php/dav/ names the
// account (current-user-principal). ncId may differ from the login name (login by email). cors: allow requests from other origins
// (answer preflight with 204); off like Nextcloud itself, whose preflight gets 401 without CORS headers. Can be
// toggled via the returned options object.
// options.fault (also settable later): (method, path in the store) => what goes wrong with that request, or nothing (the default):
// 'hang' never answers; a number answers with that status (507 full, 423 locked ...); {delay: ms} answers normally, only later;
// {trickle: ms} sends a GET's body in small pieces, one every ms (a slow line that keeps going); {stall: true} sends the headers
// and half the body, then nothing more. A PUT's body is always read first, like a server that took the upload.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function startServer({ webRoot, davRoot, user = 'tester', pass = 'app-secret', port = 0, nc = null, ncId = user, cors = false, fault = null }) {
    const log = [];
    const options = { cors, fault };
    const ncFiles = `/remote.php/dav/files/${encodeURIComponent(ncId)}`;
    const etagOf = (buf) => `"${crypto.createHash('sha1').update(buf).digest('hex')}"`;
    const badEtag = (file) => path.basename(file).startsWith('badetag-'); // a proxy in front rewrites the ETag in the answer: our If-Match never matches
    const etagOut = (file, buf) => (badEtag(file) ? `"proxy-${etagOf(buf).slice(1)}` : etagOf(buf));
    const noEtag = (file) => path.basename(file).startsWith('noetag-'); // behaves like a server (or proxy) that sends no ETag and ignores If-Match
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

    /** The store itself, once the request is in (body: what a PUT sent) and the fault, if any, has had its say. */
    function serveDav(req, res, url, file, body, fault) {
        if (req.method === 'GET' || req.method === 'HEAD') {
            if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
            const buf = fs.readFileSync(file);
            res.writeHead(200, { ...(noEtag(file) ? {} : { ETag: etagOut(file, buf) }), 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
            if (req.method === 'HEAD') { res.end(); return; }
            if (fault.stall) { res.write(buf.subarray(0, buf.length >> 1)); return; } // the rest never comes
            if (fault.trickle) {
                let at = 0;
                const next = () => {
                    if (res.destroyed) return; // the client gave up
                    const part = buf.subarray(at, at + 1024);
                    at += part.length;
                    if (at >= buf.length) res.end(part); else { res.write(part); setTimeout(next, fault.trickle); }
                };
                next();
                return;
            }
            res.end(buf);
            return;
        }
        if (req.method === 'PUT') {
            const exists = fs.existsSync(file);
            const cur = exists ? etagOf(fs.readFileSync(file)) : null;
            if (req.headers['if-none-match'] === '*' && exists) { res.writeHead(412).end(); return; }
            if (req.headers['if-match'] && req.headers['if-match'] !== cur && !noEtag(file)) { res.writeHead(412).end(); return; }
            if (!fs.existsSync(path.dirname(file))) { res.writeHead(409).end(); return; } // the folder is gone (moved or deleted)
            fs.writeFileSync(file, body);
            res.writeHead(exists ? 204 : 201, noEtag(file) ? {} : { ETag: etagOut(file, body) }).end();
            return;
        }
        if (req.method === 'DELETE') {
            if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
            fs.unlinkSync(file);
            res.writeHead(204).end();
            return;
        }
        if (req.method === 'PROPFIND') {
            if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
            const base = url.pathname.endsWith('/') || !fs.statSync(file).isDirectory() ? url.pathname : url.pathname + '/';
            const entry = (href, dir) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
            const items = fs.statSync(file).isDirectory() && req.headers.depth !== '0'
                ? fs.readdirSync(file).map((n) => entry(base + encodeURIComponent(n), fs.statSync(path.join(file, n)).isDirectory())) : [];
            res.writeHead(207, { 'Content-Type': 'application/xml' }).end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entry(base, fs.statSync(file).isDirectory())}${items.join('')}</d:multistatus>`);
            return;
        }
        if (req.method === 'MKCOL') {
            if (fs.existsSync(file)) { res.writeHead(405).end(); return; }
            if (!fs.existsSync(path.dirname(file))) { res.writeHead(409).end(); return; }
            fs.mkdirSync(file);
            res.writeHead(201).end();
            return;
        }
        res.writeHead(405).end();
    }

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        log.push(`${req.method} ${url.pathname}`);
        if (options.cors && req.headers.origin) {
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
            res.setHeader('Access-Control-Expose-Headers', 'ETag');
            if (req.method === 'OPTIONS') {
                res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, PROPFIND, MKCOL',
                    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match, If-None-Match', 'Access-Control-Max-Age': '600' }).end();
                return;
            }
        }
        const davPath = url.pathname.startsWith('/dav/') ? url.pathname.slice(5)
            : url.pathname === ncFiles || url.pathname.startsWith(ncFiles + '/') ? url.pathname.slice(ncFiles.length + 1) : null;
        if (url.pathname === '/remote.php/dav' || url.pathname === '/remote.php/dav/') {
            if (req.headers.authorization !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="t"' }).end(); return; }
            if (req.method !== 'PROPFIND') { res.writeHead(405).end(); return; }
            res.writeHead(207, { 'Content-Type': 'application/xml' }).end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/remote.php/dav/principals/users/${encodeURIComponent(ncId)}/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
            return;
        }
        if (davPath !== null) {
            const auth = req.headers.authorization || '';
            const expect = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
            if (auth !== expect && !(nc && req.headers.requesttoken === 'tok-test')) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="t"' }).end(); return; }
            const rel = decodeURIComponent(davPath);
            const file = path.join(davRoot, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
            if (!file.startsWith(davRoot)) { res.writeHead(403).end(); return; }
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const f = options.fault?.(req.method, rel);
                if (f === 'hang') return; // the connection stays open, the answer never comes
                if (typeof f === 'number') { res.writeHead(f).end(); return; }
                const go = () => serveDav(req, res, url, file, Buffer.concat(chunks), f || {});
                if (f?.delay) setTimeout(go, f.delay); else go();
            });
            return;
        }
        if (nc && url.pathname === '/index.php/apps/keepassnc/') {
            const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const vars = { __SW_URL__: '', __PEPPER_URL__: '', __DAV_BASE__: '/dav', __CSRF_URL__: '/index.php/csrftoken', __FILES_URL__: '/index.php/apps/files/',
                __USER__: 'anna', __FILE__: url.searchParams.get('open') || '', __NEW__: url.searchParams.get('new') || '', __CSS__: '/keepassnc.css', __JS__: '/keepassnc.js', __ICON__: '/icon.svg', __TOUCH__: '/apple-touch-icon.png',
                __LANG__: 'de', __NC_COLOR__: '', __NC_THEMES__: '', __NC_NAV__: '' };
            let html = fs.readFileSync(nc.template, 'utf8');
            for (const [k, v] of Object.entries(vars)) html = html.split(k).join(esc(v));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }).end(html);
            return;
        }
        if (nc && url.pathname === '/index.php/csrftoken') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'tok-test' })); return; }
        // static files
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.join(webRoot, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
        if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
        server, port: server.address().port, log, user, pass, options,
        stop: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) // simulates a server outage
    })));
}
