// Nextcloud-Integrationstest: installiert eine frische Nextcloud (SQLite) aus einem Quellverzeichnis, aktiviert die App,
// startet den PHP-Entwicklungsserver und spielt im echten Chromium den gesamten Ablauf durch. KeePassXC prueft das Ergebnis.
// Aufruf: NC_DIR=/pfad/zu/nextcloud NC_PORT=18035 node tests/nextcloud/run.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NC_DIR = process.env.NC_DIR;
const PORT = Number(process.env.NC_PORT || 18035);
if (!NC_DIR) { console.error('NC_DIR fehlt'); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'Test-Passwort-123', ADMIN = 'admin', ADMIN_PW = 'Admin-Pass-12345';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-nc-'));
const dataDir = path.join(tmp, 'data');
const occ = (...a) => execFileSync('php', ['occ', ...a], { cwd: NC_DIR, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString();
const xc = (args, input = PW + '\n') => execFileSync('keepassxc-cli', args, { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString('utf8');

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 4).join(' | ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

// ---------- Nextcloud vorbereiten ----------
function resetNextcloud() {
    fs.rmSync(path.join(NC_DIR, 'config/config.php'), { force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    occ('maintenance:install', '--database', 'sqlite', '--admin-user', ADMIN, '--admin-pass', ADMIN_PW, '--data-dir', dataDir);
    occ('config:system:set', 'trusted_domains', '1', '--value', `127.0.0.1:${PORT}`);
    occ('config:system:set', 'overwrite.cli.url', '--value', BASE);
    occ('config:system:set', 'loglevel', '--value', '2', '--type', 'integer');
    const link = path.join(NC_DIR, 'apps/keepassnc');
    fs.rmSync(link, { force: true, recursive: true });
    fs.symlinkSync(path.join(root, 'nextcloud-app/keepassnc'), link);
    return occ('app:enable', 'keepassnc').trim();
}
let php;
async function startPhp() {
    php = spawn('php', ['-d', 'memory_limit=512M', '-S', `127.0.0.1:${PORT}`, '-t', NC_DIR], { cwd: NC_DIR, env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' }, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`${BASE}/status.php`)).ok) return; } catch { /* noch nicht bereit */ }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('PHP-Server startet nicht');
}
const davAuth = { Authorization: 'Basic ' + Buffer.from(`${ADMIN}:${ADMIN_PW}`).toString('base64') };
const dav = (p, init = {}) => fetch(`${BASE}/remote.php/dav/files/${ADMIN}${p}`, { ...init, headers: { ...davAuth, ...(init.headers || {}) } });

function makeFixture(dest) {
    execFileSync('python3', ['-I', path.join(root, 'tests/compat/make-pykeepass-ref.py')], { cwd: tmp });
    fs.renameSync(path.join(tmp, 'ref4.kdbx'), dest);
    xc(['edit', '-q', dest, 'Web/Mail', '--notes', 'Notiz äöü € (KeePassXC)']);
}

async function main() {
    const version = occ('status', '--output=json');
    console.log('Nextcloud:', JSON.parse(version.slice(version.indexOf('{'))).versionstring);
    let enabled;
    await step('Frische Installation + App aktivieren', async () => { enabled = resetNextcloud(); expect(/enabled/.test(enabled), enabled); return enabled; });
    await startPhp();

    const fixture = path.join(tmp, 'vault4.kdbx');
    makeFixture(fixture);
    const fixBuf = fs.readFileSync(fixture);
    // Datei liegt in einem Ordner mit Leerzeichen/Umlaut: prueft Pfad-Kodierung
    await dav('/Passw%C3%B6rter%20privat', { method: 'MKCOL' });
    const up = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx', { method: 'PUT', body: fixBuf });
    const srvFile = path.join(dataDir, ADMIN, 'files', 'Passwörter privat', 'vault4.kdbx');

    const exe = process.env.CHROMIUM || fs.readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const problems = { external: [], pageErrors: [], consoleErrors: [], csp: [] };
    async function newSession() {
        const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.external.push(r.url()); });
        page.on('pageerror', (e) => problems.pageErrors.push(String(e)));
        page.on('console', (m) => {
            const t = m.text();
            if (/Content Security Policy|Refused to/.test(t) && /keepassnc/i.test(m.location()?.url + t)) problems.csp.push(t);
            if (m.type() === 'error' && m.location()?.url?.includes('keepassnc')) problems.consoleErrors.push(t);
        });
        await page.goto(`${BASE}/login`);
        await page.fill('input[name=user]', ADMIN); await page.fill('input[name=password]', ADMIN_PW);
        await page.click('button[type=submit]');
        await page.waitForURL(/\/apps\//, { timeout: 60000 });
        return page;
    }
    const status = (p) => p.locator('#status').innerText();
    const waitStatus = (p, re, timeout = 20000) => p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout });
    const rows = (p) => p.locator('[data-testid=entry-row]');

    await step('Upload per WebDAV (Ordner mit Leerzeichen/Umlaut)', async () => { expect(up.ok, 'PUT ' + up.status); expect(fs.existsSync(srvFile), 'Datei fehlt im Datenverzeichnis'); });

    await step('Sabre-Verhalten: PUT liefert ETag, If-Match falsch -> 412, If-None-Match:* auf vorhandene Datei -> 412', async () => {
        const g = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx');
        const et = g.headers.get('etag'); expect(et, 'GET ohne ETag');
        const p1 = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx', { method: 'PUT', body: fixBuf, headers: { 'If-Match': et } });
        expect(p1.ok, 'PUT mit korrektem If-Match: ' + p1.status);
        const et2 = p1.headers.get('etag') || p1.headers.get('oc-etag');
        const p2 = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx', { method: 'PUT', body: fixBuf, headers: { 'If-Match': '"gibtsnicht"' } });
        expect(p2.status === 412, 'falsches If-Match muss 412 liefern, war ' + p2.status);
        const p3 = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx.x.bak', { method: 'PUT', body: fixBuf, headers: { 'If-None-Match': '*' } });
        const p4 = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx.x.bak', { method: 'PUT', body: fixBuf, headers: { 'If-None-Match': '*' } });
        expect(p3.ok && p4.status === 412, `If-None-Match: erst ${p3.status}, dann ${p4.status}`);
        await dav('/Passw%C3%B6rter%20privat/vault4.kdbx.x.bak', { method: 'DELETE' });
        return `PUT-ETag ${et2 ? 'vorhanden' : 'fehlt (HEAD-Fallback greift)'}`;
    });

    const page = await newSession();

    await step('Direktaufruf der App-Seite: rendert, Dateipfad vorbelegt und schreibgeschuetzt, strenge CSP', async () => {
        const r = await page.goto(`${BASE}/index.php/apps/keepassnc/?open=${encodeURIComponent('/Passwörter privat/vault4.kdbx')}`);
        expect(r.status() === 200, 'Status ' + r.status());
        const csp = r.headers()['content-security-policy'] || '';
        expect(/script-src 'self' 'wasm-unsafe-eval'/.test(csp) && !/unsafe-inline/.test(csp), 'CSP: ' + csp);
        expect(r.headers()['cache-control']?.includes('no-store'), 'no-store fehlt');
        expect(await page.inputValue('#nc-path') === '/Passwörter privat/vault4.kdbx', 'Pfad nicht vorbelegt');
        expect(await page.locator('#nc-path').getAttribute('readonly') !== null, 'Pfad sollte readonly sein');
    });

    await step('Entsperren ueber Sitzung (kein App-Passwort): falsches Master-Passwort -> Fehlermeldung', async () => {
        await page.fill('#master', 'falsch'); await page.click('#open-btn');
        await page.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 30000 });
    });

    await step('Entsperren: Eintraege, KDBX4, Gruppen', async () => {
        await page.fill('#master', PW); await page.click('#open-btn');
        await rows(page).first().waitFor({ timeout: 30000 });
        expect(await rows(page).count() === 2, 'Eintraege: ' + await rows(page).count());
        expect(/KDBX 4/.test(await status(page)), await status(page));
        return await status(page);
    });

    let newPassword;
    await step('Bearbeiten + Speichern ueber Nextcloud-Sitzung -> KeePassXC liest Ergebnis, Sicherung vorhanden', async () => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await page.click('#edit-btn'); await page.click('#gen-btn'); await page.check('#e-show');
        newPassword = await page.inputValue('#e-pass');
        await page.fill('#e-user', 'alice-nc'); await page.click('#apply-btn'); await page.click('#save-btn');
        await waitStatus(page, /^Gespeichert\./);
        const show = xc(['show', '-s', srvFile, 'Web/Mail']);
        expect(show.includes(`Password: ${newPassword}`) && show.includes('UserName: alice-nc'), 'KeePassXC:\n' + show);
        expect(show.includes('Notiz äöü € (KeePassXC)'), 'Notiz verloren');
        const baks = fs.readdirSync(path.dirname(srvFile)).filter((n) => /^vault4\.kdbx\..*\.bak$/.test(n) && !/conflict/.test(n));
        expect(baks.length === 1, 'Sicherungskopien: ' + baks);
        xc(['ls', '-R', path.join(path.dirname(srvFile), baks[0])]);
    });

    await step('Zweites Speichern direkt danach (ETag-Kette ueber Sabre) ohne Konflikt', async () => {
        await page.click('#new-btn'); await page.fill('#e-title', 'Neu NC'); await page.fill('#e-user', 'dave'); await page.fill('#e-pass', 'pw-nc');
        await page.click('#apply-btn'); await page.click('#save-btn'); await waitStatus(page, /^Gespeichert\./);
        expect(!/zusammengef/.test(await status(page)), 'unerwartete Zusammenfuehrung');
        expect(xc(['show', '-s', srvFile, 'Web/Neu NC']).includes('Password: pw-nc'), 'Eintrag fehlt');
    });

    await step('Konflikt: Datei wird per WebDAV von "anderem Geraet" geaendert -> Zusammenfuehrung', async () => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        await page.click('#edit-btn'); await page.fill('#e-user', 'bob-aus-App'); await page.click('#apply-btn');
        await page.waitForTimeout(1100);
        const other = path.join(tmp, 'other.kdbx');
        fs.copyFileSync(srvFile, other);
        xc(['edit', '-q', other, 'Web/Mail', '--url', 'https://extern.example']);
        const r = await dav('/Passw%C3%B6rter%20privat/vault4.kdbx', { method: 'PUT', body: fs.readFileSync(other) });
        expect(r.ok, 'externes PUT ' + r.status);
        await page.click('#save-btn'); await waitStatus(page, /zusammengef/, 30000);
        expect(xc(['show', srvFile, 'Bank/Konto']).includes('bob-aus-App'), 'App-Aenderung fehlt');
        expect(xc(['show', srvFile, 'Web/Mail']).includes('https://extern.example'), 'externe Aenderung verloren');
        expect(fs.readdirSync(path.dirname(srvFile)).some((n) => /\.conflict-.*\.bak$/.test(n)), 'conflict-Sicherung fehlt');
    });

    await step('Files-Oberflaeche: .kdbx hat Aktion "Mit KeePassNC oeffnen"; Klick auf die Datei oeffnet die App mit richtigem Pfad', async () => {
        await page.goto(`${BASE}/index.php/apps/files/files?dir=${encodeURIComponent('/Passwörter privat')}`);
        const row = page.locator('[data-cy-files-list-row-name="vault4.kdbx"]');
        await row.waitFor({ timeout: 60000 });
        await row.locator('[data-cy-files-list-row-name-link]').click();
        await page.waitForURL(/apps\/keepassnc/, { timeout: 30000 });
        expect(await page.inputValue('#nc-path') === '/Passwörter privat/vault4.kdbx', 'Pfad: ' + await page.inputValue('#nc-path'));
    });

    await step('Navigationseintrag der App in der Kopfleiste vorhanden', async () => {
        await page.goto(`${BASE}/index.php/apps/files/`);
        await page.locator('#header, header').first().waitFor();
        const html = await page.content();
        expect(/apps\/keepassnc/.test(html), 'Link auf die App fehlt im Menue');
    });

    await step('Abmelden/Fremder Benutzer: ohne Sitzung kein Zugriff auf die App-Seite', async () => {
        const anon = await fetch(`${BASE}/index.php/apps/keepassnc/`, { redirect: 'manual' });
        expect([302, 303, 401, 403].includes(anon.status), 'Status ' + anon.status);
    });

    await step('Keine externen Anfragen, keine Seitenfehler, keine CSP-Verstoesse der App', async () => {
        expect(problems.external.length === 0, 'extern: ' + problems.external.slice(0, 3));
        expect(problems.pageErrors.length === 0, 'Seitenfehler: ' + problems.pageErrors.slice(0, 3));
        expect(problems.csp.length === 0, 'CSP: ' + problems.csp.slice(0, 3));
        expect(problems.consoleErrors.length === 0, 'Konsole: ' + problems.consoleErrors.slice(0, 3));
    });

    await browser.close();
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; }
php?.kill();
fs.rmSync(path.join(NC_DIR, 'apps/keepassnc'), { force: true });
fs.rmSync(path.join(NC_DIR, 'config/config.php'), { force: true });
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  -> ' + r.info : ''}`);
if (crashed) console.log('ABBRUCH:', crashed.message);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed || crashed ? 1 : 0);
