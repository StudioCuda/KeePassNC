// Test "Schluesseldatei merken" im Nextcloud-Modus mit Server-Geheimwert (Format v2) - gegen eine NACHBILDUNG der Nextcloud-Schnittstellen,
// die KeePassNC nutzt (App-Seite aus templates/page.html, /csrftoken, WebDAV unter /remote.php/dav/files/<user>/, /apps/keepassnc/api/kf-pepper).
// Der echte PHP-Controller wird in tests/nextcloud/run.mjs gegen eine echte Nextcloud geprueft.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, waitOpened } from '../browser.mjs';
import { createKeyfileStore, limits as kfLimits } from '../../src/keyfile-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(root, 'nextcloud-app/keepassnc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-kfnc-'));
execFileSync('python3', ['-I', path.join(root, 'tests/fixtures/make-daily.py'), path.join(tmp, 'fix')], { stdio: 'pipe' });
const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'fix/daily.json'), 'utf8'));
const KEY = path.join(tmp, 'fix/daily.keyx');
const DB = fs.readFileSync(path.join(tmp, 'fix/daily.kdbx'));
const FILE = '/Passwörter/daily.kdbx';

// ---------- Nachbildung der Nextcloud-Schnittstellen ----------
const srv = { peppers: {}, pepperDown: false, davDown: false, log: [] };
const newPepper = () => ({ v: 1, id: crypto.randomBytes(16).toString('hex'), pepper: crypto.randomBytes(32).toString('base64') });
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
function startNc() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const user = /(?:^|;\s*)sess=([a-z]+)/.exec(req.headers.cookie || '')?.[1] || null;
        const p = decodeURIComponent(url.pathname);
        srv.log.push(`${req.method} ${p} ${user || '-'}`);
        if (p === '/index.php/apps/keepassnc/') {
            if (!user) { res.writeHead(302, { Location: '/login' }).end(); return; }
            const vars = { __SW_URL__: '', __PEPPER_URL__: '/index.php/apps/keepassnc/api/kf-pepper', __DAV_BASE__: `/remote.php/dav/files/${user}`, __CSRF_URL__: '/index.php/csrftoken',
                __FILES_URL__: '/index.php/apps/files/', __USER__: user, __FILE__: FILE, __NEW__: url.searchParams.get('new') || '', __CSS__: '/apps/keepassnc/css/keepassnc.css', __JS__: '/apps/keepassnc/js/keepassnc.js', __LANG__: 'de',
                __NC_COLOR__: '', __NC_THEMES__: '', __NC_NAV__: '' };
            let html = fs.readFileSync(path.join(app, 'templates/page.html'), 'utf8');
            for (const [k, v] of Object.entries(vars)) html = html.split(k).join(esc(v));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }).end(html);
            return;
        }
        if (p.startsWith('/apps/keepassnc/')) {
            const f = path.join(app, p.slice('/apps/keepassnc/'.length));
            if (!f.startsWith(app) || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/css' }).end(fs.readFileSync(f));
            return;
        }
        if (p === '/index.php/csrftoken') {
            if (!user) { res.writeHead(401).end(); return; }
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'tok-' + user }));
            return;
        }
        const csrfOk = user && req.headers.requesttoken === 'tok-' + user;
        if (p === '/index.php/apps/keepassnc/api/kf-pepper' || p === '/index.php/apps/keepassnc/api/kf-pepper/rotate') {
            if (srv.pepperDown) { res.writeHead(503).end(); return; }
            if (!user) { res.writeHead(401).end(); return; }
            if (!csrfOk) { res.writeHead(412).end(JSON.stringify({ message: 'CSRF check failed' })); return; }
            const rotate = p.endsWith('/rotate');
            if (rotate !== (req.method === 'POST')) { res.writeHead(405).end(); return; }
            if (rotate || !srv.peppers[user]) srv.peppers[user] = newPepper();
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(srv.peppers[user]));
            return;
        }
        if (p.startsWith('/remote.php/dav/files/')) {
            if (srv.davDown) { res.writeHead(503).end(); return; }
            const [, , , , owner, ...rest] = p.split('/');
            if (!user || owner !== user) { res.writeHead(401).end(); return; }
            if ('/' + rest.join('/') !== FILE) { res.writeHead(404).end(); return; }
            if (req.method === 'GET' || req.method === 'HEAD') {
                res.writeHead(200, { ETag: '"e1"', 'Content-Type': 'application/octet-stream' }).end(req.method === 'GET' ? DB : undefined);
                return;
            }
            res.writeHead(405).end(); return;
        }
        res.writeHead(404).end();
    });
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 10).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

async function main() {
    const { server, port } = await startNc();
    const base = `http://127.0.0.1:${port}`;
    const appUrl = `${base}/index.php/apps/keepassnc/`;
    const browser = await launchBrowser();
    const errors = [];
    const mkCtx = async (user) => {
        const c = await browser.newContext({ locale: 'de-DE' });
        await c.addInitScript(() => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
        await c.addCookies([{ name: 'sess', value: user, url: base }]);
        return c;
    };
    const asUser = (c, user) => c.addCookies([{ name: 'sess', value: user, url: base }]);
    const kfRecords = (p) => p.evaluate(async () => new Promise((res) => {
        const plain = (v) => (v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)) : ArrayBuffer.isView(v) ? Array.from(v) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
        const r = indexedDB.open('keepassnc');
        r.onsuccess = () => {
            if (!r.result.objectStoreNames.contains('files')) return res([]);
            const s = r.result.transaction('files').objectStore('files'); const k = s.getAllKeys();
            k.onsuccess = () => { const g = s.getAll(); g.onsuccess = () => { res(k.result.map((key, i) => [key, plain(g.result[i])]).filter(([x]) => String(x).startsWith('kf:'))); r.result.close(); }; };
        };
        r.onerror = () => res([]);
    }));
    const login = async (p, { withKey = false, remember = false, master = meta.password } = {}) => {
        await p.goto(appUrl);
        await p.locator('#login-form').waitFor();
        await p.fill('#master', master);
        if (withKey) { await p.setInputFiles('#keyfile', KEY); if (remember) await p.check('#kf-remember'); }
        await p.click('#open-btn');
    };
    const opened = (p) => waitOpened(p, 120000);
    const failedWith = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#login-error')?.textContent || ''), re.source, { timeout: 90000 });
    const lock = async (p) => { await p.click('#lock-btn'); await p.locator('#login-form').waitFor(); };
    const ID = `nc:anna:${FILE}`;

    const cA = await mkCtx('anna'); const pA = await cA.newPage(); pA.on('pageerror', (e) => errors.push(String(e)));
    await step('Merken in Nextcloud: Datensatz Format v2, an Server-Geheimwert gebunden, kein Klartext; Hinweis nennt den Server', async () => {
        await pA.goto(appUrl); await pA.setInputFiles('#keyfile', KEY);
        expect(/Nextcloud-Server/.test(await pA.locator('label:has(#kf-remember)').innerText()), 'Hinweis ohne Server-Bezug');
        await login(pA, { withKey: true, remember: true }); await opened(pA);
        const recs = await kfRecords(pA);
        expect(recs.length === 1 && recs[0][0] === 'kf:' + ID, 'Kennung: ' + recs.map(([k]) => k));
        const r = recs[0][1];
        expect(r.format === 'kpnc-keyfile-v2' && r.pepperId === srv.peppers.anna.id, `Format ${r.format}, pepperId ${r.pepperId} vs ${srv.peppers.anna?.id}`);
        expect(!Buffer.from(r.ct).toString('latin1').includes('<KeyFile') && !JSON.stringify(r).includes(srv.peppers.anna.pepper) && !JSON.stringify(r).includes(meta.password), 'Klartext/Geheimwert/Passwort im Datensatz');
        expect(r.kdf.memoryKiB * r.kdf.iterations >= 256 * 1024 * 8, 'KDF schwaecher als Datenbank');
        await lock(pA);
        return `${r.kdf.memoryKiB / 1024} MiB / ${r.kdf.iterations}`;
    });

    await step('Wiederverwenden mit Server: nur Master-Passwort -> oeffnet; Einstellungen zeigen "serverseitig gesichert"', async () => {
        await login(pA); await opened(pA);
        await pA.click('#settings-btn'); await pA.locator('[data-testid=kf-forget]').first().waitFor();
        expect(/serverseitig gesichert/.test(await pA.locator('#kf-list').innerText()), 'Markierung fehlt');
        expect(await pA.locator('#kf-revoke').isVisible(), 'Knopf "Auf allen Geraeten ungueltig machen" fehlt');
        await pA.click('#settings-close'); await lock(pA);
    });

    await step('Server-Geheimwert nicht erreichbar (503): klare Meldung, kein Oeffnen; Schluesseldatei von Hand -> oeffnet; Datensatz bleibt', async () => {
        srv.pepperDown = true;
        await login(pA); await failedWith(pA, /von Hand w/);
        expect(!(await pA.locator('.shell').count()), 'darf nicht oeffnen');
        await pA.setInputFiles('#keyfile', KEY); await pA.fill('#master', meta.password); await pA.click('#open-btn'); await opened(pA);
        srv.pepperDown = false;
        expect((await kfRecords(pA)).length === 1, 'Datensatz muss bleiben');
        await lock(pA);
    });

    await step('Falsches Master-Passwort mit Server -> "Falsches Master-Passwort"', async () => {
        await login(pA, { master: meta.password + 'x' }); await failedWith(pA, /Falsches Master-Passwort/);
    });

    await step('WebDAV antwortet 503: Meldung nennt den Status statt "nicht erreichbar" (Issue #50)', async () => {
        srv.davDown = true;
        try {
            await login(pA); await failedWith(pA, /Status 503/);
            const msg = await pA.locator('#login-error').textContent();
            expect(!/nicht erreichbar/.test(msg), 'Meldung: ' + msg);
        } finally { srv.davDown = false; }
    });

    await step('Gestohlener Datensatz ohne Server-Geheimwert: richtiges Passwort genuegt nicht (Profilkopie-Szenario, im Modul geprueft)', async () => {
        const [[, r]] = await kfRecords(pA);
        const rec = { ...r, kdf: { ...r.kdf, salt: new Uint8Array(r.kdf.salt) }, iv: new Uint8Array(r.iv), ct: new Uint8Array(r.ct).buffer };
        const m = new Map([['kf:' + ID, rec]]);
        const s = createKeyfileStore({ get: async (k) => m.get(k) });
        let code = null;
        try { await s.recall({ id: ID, password: meta.password }); } catch (e) { code = e.code; }
        expect(code === 'pepper', 'ohne Geheimwert: ' + code);
        const wrong = { id: srv.peppers.anna.id, key: crypto.randomBytes(32) }; // geratener Geheimwert mit richtiger Kennung
        try { await s.recall({ id: ID, password: meta.password, pepper: wrong }); code = 'ok'; } catch (e) { code = e.code; }
        expect(code === 'wrong', 'falscher Geheimwert: ' + code);
        const right = { id: srv.peppers.anna.id, key: Buffer.from(srv.peppers.anna.pepper, 'base64') };
        const kf = await s.recall({ id: ID, password: meta.password, pepper: right });
        expect(Buffer.from(kf).equals(fs.readFileSync(KEY)), 'mit Geheimwert + Passwort: Schluesseldatei byte-gleich');
    });

    await step('Zweiter Benutzer im selben Browser sieht/loescht nichts von anna; eigener Geheimwert', async () => {
        await asUser(cA, 'bert');
        await pA.goto(appUrl); await pA.locator('#login-form').waitFor();
        expect(!(await pA.locator('#kf-remembered').isVisible()), 'bert sieht annas gemerkte Datei');
        await pA.click('#login-settings'); await pA.locator('#kf-list').waitFor();
        await pA.waitForFunction(() => /keine Schl/i.test(document.querySelector('#kf-list')?.textContent || ''));
        await pA.click('#settings-close');
        expect((await kfRecords(pA)).length === 1, 'annas Datensatz muss bleiben');
        await asUser(cA, 'anna');
    });

    const cA2 = await mkCtx('anna'); const pA2 = await cA2.newPage(); pA2.on('pageerror', (e) => errors.push(String(e)));
    await step('Auf allen Geraeten ungueltig machen: Geheimwert erneuert, lokal geloescht; zweites Geraet -> Meldung, Datensatz entfernt, von Hand geht', async () => {
        await login(pA2, { withKey: true, remember: true }); await opened(pA2); await lock(pA2); // "Laptop"
        expect((await kfRecords(pA2)).length === 1, 'zweites Geraet hat gemerkt');
        const before = srv.peppers.anna.id;
        await login(pA); await opened(pA);
        await pA.click('#settings-btn'); await pA.locator('#kf-revoke').click();
        await pA.locator('#confirm-ok').click();
        await pA.waitForFunction(() => /keine Schl/i.test(document.querySelector('#kf-list')?.textContent || ''), null, { timeout: 30000 });
        expect(srv.peppers.anna.id !== before, 'Geheimwert nicht erneuert');
        expect((await kfRecords(pA)).length === 0, 'lokaler Datensatz nicht geloescht');
        await pA.click('#settings-close'); await lock(pA);
        await login(pA2); await failedWith(pA2, /allen Ger.ten ung.ltig/);
        expect((await kfRecords(pA2)).length === 0, 'ungueltiger Datensatz muss entfernt werden');
        await pA2.setInputFiles('#keyfile', KEY); await pA2.fill('#master', meta.password); await pA2.click('#open-btn'); await opened(pA2);
        await lock(pA2);
        const n = srv.log.filter((l) => l.startsWith('POST /index.php/apps/keepassnc/api/kf-pepper/rotate')).length;
        return `${n}x rotate`;
    });

    await step('Alter Datensatz ohne Server-Bindung (v1, aus v0.4.x) wird nach dem Oeffnen auf v2 mit Server-Geheimwert umgestellt', async () => {
        const saved = { ...kfLimits }; kfLimits.minMemoryKiB = 8192; kfLimits.minIterations = 1;
        let rec;
        await createKeyfileStore({ put: async (k, v) => { rec = v; } }).remember({ id: ID, name: 'daily.keyx', keyfile: new Uint8Array(fs.readFileSync(KEY)), password: meta.password, params: { kdf: 'Argon2id', memoryKiB: 8192, iterations: 1 } });
        Object.assign(kfLimits, saved);
        const plain = { ...rec, kdf: { ...rec.kdf, salt: [...rec.kdf.salt] }, iv: [...rec.iv], ct: [...new Uint8Array(rec.ct)] };
        await pA.goto(appUrl);
        await pA.evaluate(async ({ key, r }) => new Promise((res, rej) => {
            const o = indexedDB.open('keepassnc', 1);
            o.onupgradeneeded = () => o.result.createObjectStore('files');
            o.onsuccess = () => { const tx = o.result.transaction('files', 'readwrite'); tx.objectStore('files').put({ ...r, kdf: { ...r.kdf, salt: new Uint8Array(r.kdf.salt) }, iv: new Uint8Array(r.iv), ct: new Uint8Array(r.ct).buffer }, key); tx.oncomplete = () => { o.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
        }), { key: 'kf:' + ID, r: plain });
        await login(pA); await opened(pA);
        let r2;
        for (let i = 0; i < 60; i++) { r2 = (await kfRecords(pA))[0]?.[1]; if (r2?.format === 'kpnc-keyfile-v2') break; await pA.waitForTimeout(500); }
        expect(r2?.format === 'kpnc-keyfile-v2' && r2.pepperId === srv.peppers.anna.id && r2.kdf.memoryKiB === 256 * 1024, 'nicht umgestellt: ' + JSON.stringify({ f: r2?.format, m: r2?.kdf?.memoryKiB }));
        await lock(pA);
        await login(pA); await opened(pA); await lock(pA);
        return 'v1 8 MiB/1 -> v2 256 MiB/8';
    });

    await step('Keine JS-Fehler', async () => {
        expect(errors.length === 0, errors.join(' | '));
    });

    await browser.close(); server.close(); server.closeAllConnections?.();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} Schluesseldatei-Tests (Nextcloud-Modus, Nachbildung) bestanden`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
