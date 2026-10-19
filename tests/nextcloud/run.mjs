// Nextcloud-Integrationstest: installiert eine frische Nextcloud (SQLite) aus einem Quellverzeichnis, aktiviert die App,
// startet den PHP-Entwicklungsserver und spielt im echten Chromium den gesamten Ablauf durch. KeePassXC prueft das Ergebnis.
// Aufruf: NC_DIR=/pfad/zu/nextcloud NC_PORT=18035 node tests/nextcloud/run.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../browser.mjs';

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
    // Release-Pakete bringen den Willkommensdialog (firstrunwizard) mit, der Klicks in der Dateiansicht verdeckt; Git-Staende haben ihn nicht
    try { occ('app:disable', 'firstrunwizard'); } catch { /* nicht vorhanden */ }
    occ('user:setting', ADMIN, 'core', 'lang', 'de'); // Oberflaeche folgt der Nextcloud-Sprache des Benutzers
    return occ('app:enable', 'keepassnc').trim();
}
let php;
async function stopPhp() {
    if (!php) return;
    const p = php; php = null;
    await new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); });
}
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

    const browser = await launchBrowser();
    const problems = { external: [], pageErrors: [], consoleErrors: [], csp: [] };
    async function newSession(settingsFor = { autosync: 'off' }) {
        const ctx = await browser.newContext({ locale: 'de-DE', acceptDownloads: true, viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript((st) => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify(st)); } catch {} }, settingsFor);
        const page = await ctx.newPage();
        page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.external.push(r.url()); });
        page.on('pageerror', (e) => problems.pageErrors.push(String(e)));
        page.on('console', (m) => {
            const t = m.text();
            if (/Content Security Policy|Refused to/.test(t) && /keepassnc/i.test(m.location()?.url + t)) problems.csp.push(t);
            if (m.type() === 'error' && m.location()?.url?.includes('keepassnc') && !/Failed to load resource/.test(t)) problems.consoleErrors.push(t); // Netzfehler gehoeren zu den absichtlichen Ausfaellen
        });
        // Gelegentlich bleibt die Anmeldung auf der Login-Seite stehen (in der CI selten, auf NC 35 und master beobachtet; Ursache offen).
        // Deshalb bis zu 3 Versuche; jede Wiederholung wird mit Seite und sichtbarem Text protokolliert, damit sie nicht unbemerkt bleibt.
        for (let attempt = 1; ; attempt++) {
            await page.goto(`${BASE}/login`);
            await page.fill('input[name=user]', ADMIN); await page.fill('input[name=password]', ADMIN_PW);
            await page.click('button[type=submit]');
            try {
                await page.waitForURL(/\/apps\//, { timeout: 25000, waitUntil: 'domcontentloaded' }); // 'load' kann in Release-Paketen haengen (Dashboard-Widgets/Ankuendigungen laden extern nach)
                return page;
            } catch (e) {
                const seen = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '(Seite nicht lesbar)')).replace(/\s+/g, ' ').slice(0, 200);
                console.log(`Login-Versuch ${attempt}/3 ohne Weiterleitung. Seite: ${page.url()} | Text: ${seen}`);
                if (attempt === 3) throw new Error(`Anmeldung bleibt haengen (3 Versuche). Seite: ${page.url()} | Text: ${seen}`);
            }
        }
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
        expect(/frame-ancestors 'none'/.test(csp), 'Seite darf nicht einbettbar sein (frame-ancestors): ' + csp);
        expect(r.headers()['cache-control']?.includes('no-store'), 'no-store fehlt');
        expect(await page.inputValue('#nc-path') === '/Passwörter privat/vault4.kdbx', 'Pfad nicht vorbelegt');
        expect(await page.locator('#nc-path').getAttribute('readonly') !== null, 'Pfad sollte readonly sein');
        // Relativ, damit ein Reverse-Proxy ohne overwriteprotocol nicht zu http:// auf einer https-Seite fuehrt (Issue #50)
        const davBase = await page.locator('#app').getAttribute('data-dav-base');
        expect(davBase === `/remote.php/dav/files/${ADMIN}`, 'data-dav-base ' + davBase);
    });

    await step('Pretty URLs (htaccess.IgnoreFrontController, z. B. YunoHost): Adressen ohne "//", Entsperren klappt (Issue #50)', async () => {
        // Mit Pretty URLs liefert linkTo('', 'index.php') nur "/"; daraus wurde "//csrftoken", ein Host namens "csrftoken"
        occ('config:system:set', 'htaccess.IgnoreFrontController', '--value', 'true', '--type', 'boolean');
        try {
            await page.goto(`${BASE}/index.php/apps/keepassnc/?open=${encodeURIComponent('/Passwörter privat/vault4.kdbx')}`);
            const app = page.locator('#app');
            const urls = { csrf: await app.getAttribute('data-csrf-url'), files: await app.getAttribute('data-files-url'), nav: JSON.parse(await app.getAttribute('data-nc-nav') || '{}').moreApps };
            expect(urls.csrf === '/csrftoken' && !urls.files.startsWith('//') && urls.nav === '/settings/apps', JSON.stringify(urls));
            await page.fill('#master', PW); await page.click('#open-btn');
            await rows(page).first().waitFor({ timeout: 30000 }).catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} | err=${await page.textContent('#login-error')}`); });
        } finally {
            occ('config:system:delete', 'htaccess.IgnoreFrontController');
        }
        await page.goto(`${BASE}/index.php/apps/keepassnc/?open=${encodeURIComponent('/Passwörter privat/vault4.kdbx')}`);
        await page.locator('#login-form').waitFor();
    });

    await step('Entsperren ueber Sitzung (kein App-Passwort): falsches Master-Passwort -> Fehlermeldung', async () => {
        await page.fill('#master', 'falsch'); await page.click('#open-btn');
        await page.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 30000 }).catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} | lang=${await page.getAttribute('html', 'lang')} data-lang=${await page.locator('#app').getAttribute('data-lang')} err=${await page.textContent('#login-error')}`); });
    });

    await step('Entsperren: Eintraege, KDBX4, Gruppen; Argon2 im Web Worker (CSP und App-Pfad von Nextcloud erlauben ihn)', async () => {
        const workers = []; page.on('worker', (w) => workers.push(w.url()));
        await page.fill('#master', PW); await page.click('#open-btn');
        await rows(page).first().waitFor({ timeout: 30000 });
        expect(workers.some((u) => /\/keepassnc\/js\/keepassnc-argon2\.js\?v=/.test(u)), 'Argon2-Worker nicht gestartet: ' + JSON.stringify(workers));
        expect(await rows(page).count() === 2, 'Eintraege: ' + await rows(page).count());
        expect(/KDBX 4/.test(await status(page)), await status(page));
        return await status(page);
    });

    let newPassword;
    await step('Bearbeiten + Speichern ueber Nextcloud-Sitzung -> KeePassXC liest Ergebnis, Sicherung vorhanden', async () => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await page.click('#edit-btn'); await page.click('#gen-btn'); await page.click('#gen-tab-pw'); await page.click('#gen-use'); await page.click('#e-show');
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

    await step('Files "+ Neu" -> KeePass-Datenbank: Name und Ordner vorbelegt, Ordner-Browser listet, angelegt, KeePassXC oeffnet; Neuladen zeigt die neue Datei', async () => {
        await page.goto(`${BASE}/index.php/apps/files/files?dir=${encodeURIComponent('/Passwörter privat')}`);
        await page.locator('[data-cy-files-list-row-name="vault4.kdbx"]').waitFor({ timeout: 60000 });
        await page.locator('[data-cy-upload-picker] .action-item__menutoggle, [data-cy-upload-picker] button').first().click();
        // Nextcloud 34/35 markieren die Eintraege mit data-cy-upload-picker-menu-entry, master (36) nicht mehr: dann ueber Rolle und Namen
        await page.locator('[data-cy-upload-picker-menu-entry="keepassnc-new"]').or(page.getByRole('menuitem', { name: /KeePass/ })).first().click();
        await page.waitForURL(/apps\/keepassnc\/\?new=/, { timeout: 30000 });
        const name = await page.inputValue('#new-name'), folder = await page.locator('#new-folder').innerText();
        expect(/^(Passwörter|Passwords)$/.test(name) && folder === 'Passwörter privat', `Vorschlag: ${name} in ${folder}`);
        const suggested = `/Passwörter privat/${name}.kdbx`;
        await page.click('#new-folder-btn'); // Ordner-Browser gegen echtes Sabre: listet den Ordner samt vorhandener .kdbx
        await page.locator('.folder-item[data-name="vault4.kdbx"]').waitFor({ timeout: 15000 });
        await page.click('#folder-ok');
        await page.fill('#new-new', PW + '-neu'); await page.fill('#new-repeat', PW + '-neu');
        await page.click('#new-btn');
        await page.locator('.shell').waitFor({ timeout: 60000 });
        const created = path.join(dataDir, ADMIN, 'files', suggested.slice(1));
        expect(fs.existsSync(created), 'Datei fehlt im Datenverzeichnis: ' + created);
        expect(xc(['ls', '-q', created], PW + '-neu\n') !== null, 'KeePassXC oeffnet die neue Datei nicht');
        expect(/\?open=/.test(page.url()), 'Adresse nach dem Anlegen: ' + page.url());
        await page.reload();
        expect(await page.inputValue('#nc-path') === suggested, 'nach dem Neuladen: ' + await page.inputValue('#nc-path'));
        return suggested;
    });

    await step('Navigationseintrag der App in der Kopfleiste vorhanden', async () => {
        await page.goto(`${BASE}/index.php/apps/files/`);
        await page.locator('#header, header').first().waitFor();
        const html = await page.content();
        expect(/apps\/keepassnc/.test(html), 'Link auf die App fehlt im Menue');
    });

    // ---- Theming und Kopfleiste (OCP\Defaults, Benutzerwert theming/enabled-themes, INavigationManager) ----
    const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    const { deriveAccent } = await import('../../src/theme.js');
    const look = async () => {
        await page.goto(`${BASE}/index.php/apps/keepassnc/`); await page.locator('#login-form').waitFor();
        return page.evaluate(() => ({
            accent: getComputedStyle(document.querySelector('#open-btn')).backgroundColor, accentMode: document.documentElement.dataset.accent || '',
            theme: document.documentElement.dataset.theme || '', header: document.querySelector('#nc-header') ? getComputedStyle(document.querySelector('#nc-header')).backgroundColor : null
        }));
    };
    const setTheme = (theme) => page.evaluate((th) => { const s = JSON.parse(localStorage.getItem('kpnc.settings') || '{}'); s.theme = th; localStorage.setItem('kpnc.settings', JSON.stringify(s)); }, theme);

    await step('Kopfleiste wie Nextcloud: App-Menue aus der Navigation, Benutzermenue; Standardblau -> unser Akzent bleibt', async () => {
        const l = await look();
        expect(l.header === rgb('#00679e'), 'Kopfleiste ' + l.header);
        expect(l.accentMode === '' && l.accent === rgb('#0b1f3b'), 'Akzent ' + JSON.stringify(l));
        await page.click('#nch-waffle'); await page.locator('#nch-apps-pop').waitFor();
        const tiles = await page.locator('#nch-apps-pop .nch-tile').evaluateAll((as) => as.map((a) => ({ name: a.querySelector('.nch-tile-name').textContent, href: a.getAttribute('href'), current: a.getAttribute('aria-current') })));
        expect(tiles.some((x) => x.name === 'Dateien' && /\/apps\/files\/?$/.test(x.href)), 'Dateien fehlt: ' + JSON.stringify(tiles));
        expect(tiles.find((x) => x.current === 'page')?.name === 'KeePassNC', 'aktive App: ' + JSON.stringify(tiles));
        expect(tiles.some((x) => x.name === 'Weitere Apps'), '"Weitere Apps" fuer Admins fehlt');
        expect(await page.locator('#nch-apps-pop .nch-glyph.has-icon').count() >= 2, 'App-Symbole fehlen');
        await page.keyboard.press('Escape');
        await page.click('#nch-user'); await page.locator('#nch-user-pop').waitFor();
        const items = await page.locator('#nch-user-pop a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
        const out = items.find(([, href]) => /\/logout/.test(href));
        expect(out && !/requesttoken/.test(out[1]), 'Abmelden: ' + JSON.stringify(items));
        expect(items.some(([n]) => /Persönliche Einstellungen/.test(n)), 'Einstellungen fehlen: ' + JSON.stringify(items));
        expect(await page.locator('#nch-user-pop a.nch-item .nch-glyph.has-icon').count() >= 2, 'Symbole im Benutzermenue fehlen');
        await page.keyboard.press('Escape');
        return `${tiles.length} Apps, ${items.length} Eintraege im Benutzermenue`;
    });

    await step('Instanzfarbe per occ theming:config primary_color -> Kopfleiste und Akzent folgen ihr', async () => {
        occ('theming:config', 'primary_color', '#e6007e');
        const l = await look();
        expect(l.header === rgb('#e6007e'), 'Kopfleiste ' + l.header);
        expect(l.accentMode === 'nc' && l.accent === rgb(deriveAccent('#e6007e', 'light').accent), 'Akzent ' + JSON.stringify(l));
        return l.accent;
    });

    await step('Hell/Dunkel der Person (enabled-themes) gilt bei "Wie Nextcloud"; die App-Einstellung "Hell" hat Vorrang', async () => {
        occ('user:setting', ADMIN, 'theming', 'enabled-themes', '["dark"]');
        let l = await look();
        expect(l.theme === 'dark' && l.accent === rgb(deriveAccent('#e6007e', 'dark').accent), 'dunkel: ' + JSON.stringify(l));
        await setTheme('light');
        l = await look();
        expect(l.theme === 'light', 'App-Einstellung ignoriert: ' + JSON.stringify(l));
        await setTheme('nextcloud');
        occ('user:setting', ADMIN, 'theming', 'enabled-themes', '--delete');
        l = await look();
        expect(l.theme === '', 'System: ' + JSON.stringify(l));
    });

    await step('Fallback: Instanzfarbe zurueckgesetzt (theming:config --reset) -> wieder Standard-Look', async () => {
        occ('theming:config', 'primary_color', '--reset');
        try {
            const l = await look();
            expect(l.accentMode === '' && l.accent === rgb('#0b1f3b'), 'Akzent ' + JSON.stringify(l));
            expect(l.header === rgb('#00679e'), 'Kopfleiste ' + l.header);
        } finally { occ('theming:config', 'primary_color', '#e6007e'); } // fuer den Offline-Schritt unten
    });

    // ---- Freigaben: die Datei gehoert "bob" und ist mit admin geteilt (Rechte: 1 = lesen, 2 = aendern, 4 = erstellen) ----
    const OWNER = 'bob', OWNER_PW = 'Bob-Pass-12345';
    const ownerAuth = { Authorization: 'Basic ' + Buffer.from(`${OWNER}:${OWNER_PW}`).toString('base64') };
    const ownerDav = (p, init = {}) => fetch(`${BASE}/remote.php/dav/files/${OWNER}${p}`, { ...init, headers: { ...ownerAuth, ...(init.headers || {}) } });
    async function shareFolder(folder, permissions) {
        await ownerDav(`/${encodeURIComponent(folder)}`, { method: 'MKCOL' });
        const put = await ownerDav(`/${encodeURIComponent(folder)}/team.kdbx`, { method: 'PUT', body: fixBuf });
        expect(put.ok, `PUT ${folder}: ${put.status}`);
        const r = await fetch(`${BASE}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`, {
            method: 'POST', headers: { ...ownerAuth, 'OCS-APIRequest': 'true', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ path: `/${folder}`, shareType: '0', shareWith: ADMIN, permissions: String(permissions) })
        });
        expect(r.ok, `Freigabe ${folder}: ${r.status} ${(await r.text()).slice(0, 200)}`);
        return path.join(dataDir, OWNER, 'files', folder, 'team.kdbx');
    }
    const openShared = async (p) => {
        await page.goto(`${BASE}/index.php/apps/keepassnc/?open=${encodeURIComponent(p)}`);
        await page.fill('#master', PW); await page.click('#open-btn');
        await rows(page).first().waitFor({ timeout: 30000 });
    };
    const editMail = async (user) => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await page.click('#edit-btn'); await page.fill('#e-user', user); await page.click('#apply-btn'); await page.click('#save-btn');
    };
    execFileSync('php', ['occ', 'user:add', '--password-from-env', OWNER], { cwd: NC_DIR, env: { ...process.env, OC_PASS: OWNER_PW }, stdio: ['ignore', 'pipe', 'pipe'] });

    await step('Freigegebener Ordner "Bearbeiten ohne Erstellen": oeffnen, aendern, speichern -> beim Besitzer angekommen, Hinweis "ohne Sicherungskopie"', async () => {
        const ownerFile = await shareFolder('Team RW', 1 | 2);
        await openShared('/Team RW/team.kdbx');
        await editMail('alice-team');
        await waitStatus(page, /^Gespeichert, aber ohne Sicherungskopie/, 30000);
        expect(xc(['show', ownerFile, 'Web/Mail']).includes('alice-team'), 'Aenderung nicht beim Besitzer angekommen');
        expect(!fs.readdirSync(path.dirname(ownerFile)).some((n) => n.endsWith('.bak')), 'Sicherungskopie trotz fehlendem Recht?');
        return await status(page);
    });

    await step('Freigabe nur zum Lesen: beim Oeffnen als "nur lesbar" markiert, Speichern scheitert verstaendlich, Datei unveraendert', async () => {
        const ownerFile = await shareFolder('Team RO', 1);
        const before = fs.readFileSync(ownerFile);
        await openShared('/Team RO/team.kdbx');
        expect(/nur lesbar/.test(await status(page)), 'kein Hinweis beim Oeffnen: ' + await status(page));
        await editMail('alice-darf-nicht');
        await waitStatus(page, /nur lesen/, 30000);
        expect(!/Status 403/.test(await status(page)), 'rohe Fehlermeldung: ' + await status(page));
        expect(Buffer.compare(before, fs.readFileSync(ownerFile)) === 0, 'Datei des Besitzers wurde veraendert');
        return await status(page);
    });

    // ---- Ausfall-Szenarien: erst Wartungsmodus (503), dann harter Serverausfall ----
    const page2 = await newSession({ autosync: 'change', offline: true });
    const appUrl = `${BASE}/index.php/apps/keepassnc/`;
    const rows2 = () => page2.locator('[data-testid=entry-row]');
    const waitStatus2 = (re, t = 30000) => page2.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout: t });
    const login2 = async () => { await page2.fill('#master', PW); await page2.click('#open-btn'); };
    await step('Offline-Option: Online-Anmeldung legt Offline-Kopie und App-Cache an', async () => {
        await page2.goto(`${appUrl}?syncretry=2&open=${encodeURIComponent('/Passwörter privat/vault4.kdbx')}`);
        await login2(); await rows2().first().waitFor({ timeout: 30000 });
        await page2.waitForSelector('html[data-offline-ready="1"]', { timeout: 30000 });
    });

    await step('Wartungsmodus (503): App-Seite startet aus dem Cache, Oeffnen aus der Offline-Kopie, Aenderung lokal gesichert', async () => {
        occ('maintenance:mode', '--on');
        const direct = await fetch(appUrl, { redirect: 'manual' });
        expect(direct.status === 503, 'Server sollte 503 liefern, war ' + direct.status);
        await page2.goto(`${appUrl}?syncretry=2`);
        await page2.locator('#login-form').waitFor({ timeout: 20000 });
        expect(await page2.inputValue('#nc-path') === '/Passwörter privat/vault4.kdbx', 'zuletzt benutzter Pfad nicht vorbelegt: ' + await page2.inputValue('#nc-path'));
        expect(await page2.evaluate(() => document.documentElement.dataset.accent === 'nc' && getComputedStyle(document.querySelector('#nc-header')).backgroundColor) === 'rgb(230, 0, 126)', 'Theming aus dem Cache fehlt');
        await login2(); await rows2().first().waitFor({ timeout: 30000 });
        expect(/Offline-Kopie/.test(await page2.locator('#status').innerText()), await page2.locator('#status').innerText());
        await page2.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await page2.click('#edit-btn'); await page2.fill('#e-user', 'alice-wartung'); await page2.click('#apply-btn');
        await waitStatus2(/Server nicht erreichbar/);
        expect(!xc(['show', srvFile, 'Web/Mail']).includes('alice-wartung'), 'Server darf die Aenderung noch nicht haben');
    });

    await step('Wartungsmodus endet: Aenderung wird automatisch hochgeladen', async () => {
        occ('maintenance:mode', '--off');
        await page2.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'synced', null, { timeout: 40000 });
        expect(xc(['show', srvFile, 'Web/Mail']).includes('alice-wartung'), 'Aenderung nicht auf dem Server');
    });

    await step('Harter Serverausfall (Prozess beendet): App startet aus dem Cache, Aenderung offline, nach Neustart Upload + Zusammenfuehrung mit Fremdaenderung', async () => {
        await stopPhp();
        await page2.goto(`${appUrl}?syncretry=2`);
        await page2.locator('#login-form').waitFor({ timeout: 20000 });
        await login2(); await rows2().first().waitFor({ timeout: 30000 });
        await page2.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await page2.click('#edit-btn'); await page2.fill('#e-user', 'alice-ausfall'); await page2.click('#apply-btn');
        await waitStatus2(/Server nicht erreichbar/);
        // Fremdaenderung direkt in der Datei (anderes Geraet synchronisiert z. B. per Syncthing/Dateisystem)
        const other = path.join(tmp, 'other2.kdbx'); fs.copyFileSync(srvFile, other);
        xc(['edit', '-q', other, 'Bank/Konto', '--url', 'https://wartung.example']);
        fs.copyFileSync(other, srvFile); occ('files:scan', '--path', `${ADMIN}/files/Passwörter privat`);
        await startPhp();
        await page2.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'synced', null, { timeout: 60000 });
        expect(xc(['show', srvFile, 'Web/Mail']).includes('alice-ausfall'), 'Offline-Aenderung fehlt');
        expect(xc(['show', srvFile, 'Bank/Konto']).includes('https://wartung.example'), 'Fremdaenderung verloren');
    });

    await step('Server-Geheimwert fuer gemerkte Schluesseldateien: nur mit Sitzung + CSRF-Token, stabil, "Erneuern" wechselt ihn', async () => {
        await page.goto(`${BASE}/index.php/apps/keepassnc/`); await page.locator('#app').waitFor();
        const r = await page.evaluate(async () => {
            const url = document.querySelector('#app').dataset.pepperUrl;
            const tok = (await (await fetch('/index.php/csrftoken', { headers: { 'OCS-APIREQUEST': 'true' } })).json()).token;
            const h = { requesttoken: tok, 'OCS-APIREQUEST': 'true', Accept: 'application/json' };
            const noTok = (await fetch(url, { headers: { Accept: 'application/json' } })).status;
            const g1 = await fetch(url, { headers: h }); const a = await g1.json();
            const b = await (await fetch(url, { headers: h })).json();
            const rotGet = (await fetch(url + '/rotate', { headers: h })).status;
            const c = await (await fetch(url + '/rotate', { method: 'POST', headers: h })).json();
            const d = await (await fetch(url, { headers: h })).json();
            return { url, noTok, status: g1.status, cc: g1.headers.get('cache-control'), a, b, rotGet, c, d };
        });
        expect(/\/apps\/keepassnc\/api\/kf-pepper$/.test(r.url), 'URL: ' + r.url);
        expect(r.noTok >= 400, 'ohne CSRF-Token muss abgelehnt werden: ' + r.noTok);
        expect(r.status === 200 && /no-store/.test(r.cc || ''), `Status ${r.status}, Cache-Control ${r.cc}`);
        expect(/^[0-9a-f]{32}$/.test(r.a.id) && Buffer.from(r.a.pepper, 'base64').length === 32, 'Format: ' + JSON.stringify(r.a));
        expect(r.a.id === r.b.id && r.a.pepper === r.b.pepper, 'zweiter Abruf muss gleich sein');
        expect(r.rotGet >= 400, 'Erneuern per GET muss scheitern: ' + r.rotGet);
        expect(r.c.id !== r.a.id && r.c.pepper !== r.a.pepper && r.d.id === r.c.id, 'Erneuern wirkt nicht');
        const anon = await fetch(`${BASE}/index.php/apps/keepassnc/api/kf-pepper`, { redirect: 'manual', headers: { 'OCS-APIREQUEST': 'true' } });
        expect(anon.status >= 300 && anon.status !== 200, 'ohne Sitzung: ' + anon.status);
        return `ohne Token ${r.noTok}, anonym ${anon.status}`;
    });

    await step('Abmelden/Fremder Benutzer: ohne Sitzung kein Zugriff auf die App-Seite', async () => {
        const anon = await fetch(`${BASE}/index.php/apps/keepassnc/`, { redirect: 'manual' });
        expect([302, 303, 401, 403].includes(anon.status), 'Status ' + anon.status);
    });

    await step('Abmelden ueber das Benutzermenue der Kopfleiste (frisches CSRF-Token) -> Login-Seite', async () => {
        const p = await newSession();
        await p.goto(`${BASE}/index.php/apps/keepassnc/`); await p.locator('#login-form').waitFor();
        await p.click('#nch-user'); await p.locator('#nch-user-pop').waitFor();
        await Promise.all([p.waitForURL(/\/login/, { timeout: 30000 }), p.click('#nch-user-pop a[data-id=logout]')]);
        const back = await p.goto(`${BASE}/index.php/apps/keepassnc/`);
        expect(/\/login/.test(p.url()) || back.status() >= 300, 'Sitzung noch aktiv: ' + p.url());
        await p.context().close();
    });

    await step('Keine externen Anfragen, keine Seitenfehler, keine CSP-Verstoesse der App', async () => {
        expect(problems.external.length === 0, 'extern: ' + problems.external.slice(0, 3));
        expect(problems.pageErrors.length === 0, 'Seitenfehler: ' + problems.pageErrors.slice(0, 3));
        expect(problems.csp.length === 0, 'CSP: ' + problems.csp.slice(0, 3));
        expect(problems.consoleErrors.length === 0, 'Konsole: ' + problems.consoleErrors.slice(0, 3));
    });

    await browser.close();

    // Nextcloud fuehrt Uninstall-Schritte bei jedem Deaktivieren aus und kennt keinen eigenen Haken fuers Entfernen. Darum raeumt die
    // App dabei nichts weg: kurz aus- und wieder einschalten darf gemerkte Schluesseldateien nicht ungueltig machen.
    await step('Deaktivieren + wieder aktivieren: App laeuft, Server-Geheimwert der Benutzer unveraendert', async () => {
        const sys = (key, fallback) => { try { return occ('config:system:get', key).trim(); } catch { return fallback; } }; // SQLite-Installationen setzen dbname nicht
        const db = path.join(dataDir, `${sys('dbname', 'owncloud')}.db`);
        const sql = `SELECT userid || ':' || configvalue FROM ${sys('dbtableprefix', 'oc_')}preferences WHERE appid = 'keepassnc' AND configkey = 'kf_pepper' ORDER BY userid`;
        const peppers = () => execFileSync('php', ['-r', 'echo implode("\\n", (new PDO("sqlite:" . $argv[1]))->query($argv[2])->fetchAll(PDO::FETCH_COLUMN));', db, sql]).toString();
        const before = peppers();
        expect(before !== '', 'vorher kein Server-Geheimwert - prueft der Schritt ueberhaupt etwas?');
        occ('app:disable', 'keepassnc');
        expect(/enabled/.test(occ('app:enable', 'keepassnc')), 'App laesst sich nicht wieder aktivieren');
        expect(peppers() === before, 'Server-Geheimwert hat sich geaendert oder ist weg');
        const page = await fetch(`${BASE}/index.php/apps/keepassnc/`, { headers: davAuth, redirect: 'manual' });
        expect(page.status === 200, 'App-Seite nach Wiederaktivieren: ' + page.status);
        return `${before.split('\n').length} Benutzer`;
    });
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
