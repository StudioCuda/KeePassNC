// Minimaler Testserver: liefert web/ statisch aus und stellt unter /dav/ eine WebDAV-aehnliche Dateiablage bereit
// (GET/HEAD/PUT mit ETag, If-Match, If-None-Match, HTTP-Basic-Auth). Nur fuer Tests, nicht fuer den Betrieb.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function startServer({ webRoot, davRoot, user = 'tester', pass = 'app-secret', port = 0 }) {
    const log = [];
    const etagOf = (buf) => `"${crypto.createHash('sha1').update(buf).digest('hex')}"`;
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        log.push(`${req.method} ${url.pathname}`);
        if (url.pathname.startsWith('/dav/')) {
            const auth = req.headers.authorization || '';
            const expect = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
            if (auth !== expect) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="t"' }).end(); return; }
            const rel = decodeURIComponent(url.pathname.slice(5));
            const file = path.join(davRoot, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
            if (!file.startsWith(davRoot)) { res.writeHead(403).end(); return; }
            if (req.method === 'GET' || req.method === 'HEAD') {
                if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
                const buf = fs.readFileSync(file);
                res.writeHead(200, { ETag: etagOf(buf), 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
                res.end(req.method === 'GET' ? buf : undefined);
                return;
            }
            if (req.method === 'PUT') {
                const chunks = [];
                req.on('data', (c) => chunks.push(c));
                req.on('end', () => {
                    const exists = fs.existsSync(file);
                    const cur = exists ? etagOf(fs.readFileSync(file)) : null;
                    if (req.headers['if-none-match'] === '*' && exists) { res.writeHead(412).end(); return; }
                    if (req.headers['if-match'] && req.headers['if-match'] !== cur) { res.writeHead(412).end(); return; }
                    const body = Buffer.concat(chunks);
                    fs.writeFileSync(file, body);
                    res.writeHead(exists ? 204 : 201, { ETag: etagOf(body) }).end();
                });
                return;
            }
            res.writeHead(405).end();
            return;
        }
        // statische Dateien
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.join(webRoot, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
        if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
        server, port: server.address().port, log, user, pass,
        stop: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) // simuliert einen Serverausfall
    })));
}
