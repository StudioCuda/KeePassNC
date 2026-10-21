// Test of the standalone page against a Nextcloud: Nextcloud address, username and app password instead of a WebDAV address, then
// path/browse when opening and name + folder when creating. The test server mimics /remote.php/dav/ for this, with an
// account ID that isn't the login name (login by email). Also: a previously saved WebDAV address stays the
// identifier (remembered key file, offline copy), and a page on a different origin reports missing CORS in an understandable way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, waitOpened, knownFetchNoise, uncaughtWatch } from '../browser.mjs';
import { startServer } from './davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-remote-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(path.join(davRoot, 'Privat'), { recursive: true });
const PW = 'Wolke-Passwort-Kranich-3141!', KEY = path.join(tmp, 'team.keyx');
const dav = (name) => path.join(davRoot, name);
execFileSync('keepassxc-cli', ['db-create', '-q', '-p', '-t', '100', dav('Privat/Passwörter.kdbx')], { input: PW + '\n' + PW + '\n', stdio: 'pipe' });
execFileSync('keepassxc-cli', ['db-create', '-q', '-p', '--set-key-file', KEY, '-t', '100', dav('Privat/Team Tresor.kdbx')], { input: PW + '\n' + PW + '\n', stdio: 'pipe' });
const xcLs = (file, pw) => { const r = spawnSync('keepassxc-cli', ['ls', '-q', '-R', file], { input: pw + '\n' }); return r.status === 0 ? r.stdout.toString('utf8') : null; };

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 10).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

async function main() {
    const { stop, port, log, options } = await startServer({ webRoot: path.join(root, 'web'), davRoot, ncId: 'tester-id' });
    const base = `http://127.0.0.1:${port}`, other = `http://localhost:${port}`; // same server, different origin
    const files = `${base}/remote.php/dav/files/tester-id`;
    const browser = await launchBrowser();
    const errors = [];
    // With no previous choice the page starts with "Local file"; the tests here assume Nextcloud/WebDAV (fresh: like on the very first visit)
    const newPage = async ({ fresh = false } = {}) => {
        const c = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 950 }, serviceWorkers: 'block' });
        await c.addInitScript(uncaughtWatch);
        await c.addInitScript(() => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
        if (!fresh) await c.addInitScript(() => { try { if (!localStorage.getItem('kpnc.mode')) localStorage.setItem('kpnc.mode', 'dav'); } catch {} });
        const p = await c.newPage();
        // When CORS blocks a request, WebKit reports it as a page error even though the app catches it (knownFetchNoise); uncaught
        // errors still arrive via uncaughtWatch. Playwright splits this message at the first ":" ("http:") into name
        // and message, so the whole text counts.
        p.on('pageerror', (e) => { if (!knownFetchNoise(String(e)) && !knownFetchNoise(e.message)) errors.push(String(e)); });
        p.on('console', (m) => { if (m.type() === 'error' && m.text().startsWith('UNCAUGHT: ')) errors.push(m.text()); });
        return p;
    };
    const loginError = async (p, re) => {
        try { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#login-error')?.textContent || ''), re.source, { timeout: 15000 }); }
        catch { throw new Error(`Fehler ${re}: "${await p.locator('#login-error').innerText().catch(() => '?')}"`); }
    };
    const pick = async (p, ...names) => {
        await p.locator('#folder-picker').waitFor();
        for (const n of names) await p.locator(`.folder-item[data-name="${n}"]`).click({ timeout: 15000 }).catch(async () => { throw new Error(`${n} nicht in der Liste: "${await p.locator('#folder-picker').innerText()}"`); });
        await p.click('#folder-ok');
    };
    const ls = (p) => p.evaluate(() => ({ url: localStorage.getItem('kpnc.url'), mode: localStorage.getItem('kpnc.davmode') }));

    const p1 = await newPage();
    await step('Erststart: Nextcloud-Adresse, Benutzername, App-Passwort und Pfad statt WebDAV-Adresse; Link schaltet auf eigene WebDAV-Adresse und zurueck', async () => {
        await p1.goto(base); await p1.locator('#login-form').waitFor();
        for (const id of ['#dav-server', '#dav-user', '#dav-pass', '#dav-path', '#dav-browse']) expect(await p1.locator(id).isVisible(), id + ' fehlt');
        expect(!(await p1.locator('#dav-url').isVisible()), 'WebDAV-Feld soll versteckt sein');
        expect(await p1.evaluate(() => document.activeElement?.id) === 'dav-server', 'Fokus soll auf der Nextcloud-Adresse liegen');
        await p1.click('#dav-davmode');
        expect(await p1.locator('#dav-url').isVisible() && !(await p1.locator('#dav-server').isVisible()) && !(await p1.locator('#dav-path').isVisible()), 'eigene WebDAV-Adresse');
        expect(await p1.locator('#dav-user').isVisible(), 'Benutzername bleibt');
        await p1.click('#dav-davmode');
        expect(await p1.locator('#dav-server').isVisible() && !(await p1.locator('#dav-url').isVisible()), 'zurueck zur Nextcloud-Adresse');
    });

    await step('[Durchsuchen] ohne Zugangsdaten: Hinweis; falsches App-Passwort: "Zugriff verweigert"; beim Tippen keine Anfrage', async () => {
        await p1.click('#dav-browse');
        await loginError(p1, /zuerst Nextcloud-Adresse, Benutzername und App-Passwort/);
        const before = log.length;
        await p1.fill('#dav-server', `127.0.0.1:${port}`); // host of the page without scheme: use its scheme (http) instead of https
        await p1.fill('#dav-user', 'tester'); await p1.fill('#dav-pass', 'falsch');
        await p1.waitForTimeout(500);
        expect(!log.slice(before).some((l) => l.includes('/remote.php/')), 'Anfragen beim Tippen: ' + log.slice(before).join(', '));
        await p1.click('#dav-browse');
        await loginError(p1, /Zugriff verweigert/);
        expect(await p1.locator('#folder-picker').count() === 0, 'Dialog soll nicht aufgehen');
    });

    await step('[Durchsuchen] mit App-Passwort: Konto-ID vom Server (Anmeldename tester, ID tester-id), Datei waehlen, entsperren; gespeichert wird die volle WebDAV-Adresse', async () => {
        await p1.fill('#dav-pass', 'app-secret');
        const before = log.length;
        await p1.click('#dav-browse');
        expect(await p1.locator('.modal-title').innerText() === 'Datenbank wählen', 'Titel');
        await pick(p1, 'Privat', 'Passwörter.kdbx');
        expect(await p1.inputValue('#dav-path') === '/Privat/Passwörter.kdbx', 'Pfad: ' + await p1.inputValue('#dav-path'));
        await p1.fill('#master', PW); await p1.click('#open-btn'); await waitOpened(p1, 60000);
        const reqs = log.slice(before);
        expect(reqs.includes('PROPFIND /remote.php/dav/'), 'Konto nicht erfragt: ' + reqs.join(', '));
        expect(reqs.includes('GET /remote.php/dav/files/tester-id/Privat/Passw%C3%B6rter.kdbx'), 'Abruf: ' + reqs.join(', '));
        expect(reqs.filter((l) => l === 'PROPFIND /remote.php/dav/').length === 1, 'Konto nur einmal erfragen: ' + reqs.join(', '));
        const s = await ls(p1);
        expect(s.url === `${files}/Privat/Passw%C3%B6rter.kdbx` && s.mode === 'nc', JSON.stringify(s));
    });

    await step('Neue Datenbank: Adresse und Benutzername vorbelegt, Ordner der letzten Datei, Link zur eigenen WebDAV-Adresse; vergebener Name gemeldet', async () => {
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        expect(await p1.inputValue('#dav-server') === base && await p1.inputValue('#dav-path') === '/Privat/Passwörter.kdbx', 'Anmeldung nach dem Sperren vorbelegt');
        await p1.click('#new-db-link'); await p1.locator('#new-form').waitFor();
        expect(await p1.inputValue('#new-server') === base && await p1.inputValue('#new-user') === 'tester', 'Adresse/Benutzer: ' + await p1.inputValue('#new-server'));
        expect(await p1.locator('#new-folder').innerText() === 'Privat', 'Ordner: ' + await p1.locator('#new-folder').innerText());
        expect(!(await p1.locator('#new-url').isVisible()) && await p1.locator('#new-name').isVisible(), 'Name statt WebDAV-Adresse');
        await p1.click('#new-davmode');
        expect(await p1.locator('#new-url').isVisible() && !(await p1.locator('#new-name').isVisible()), 'eigene WebDAV-Adresse');
        await p1.click('#new-davmode');
        await p1.click('#new-folder-btn');
        await p1.waitForFunction(() => /zuerst Nextcloud-Adresse/.test(document.querySelector('#new-error')?.textContent || ''));
        await p1.fill('#new-pass', 'app-secret');
        await p1.fill('#new-name', 'Passwörter');
        await p1.waitForFunction(() => document.querySelector('#new-name-note')?.hidden === false, null, { timeout: 15000 })
            .catch(async () => { throw new Error('kein Hinweis auf den vergebenen Namen'); });
    });

    await step('Neue Datenbank anlegen: Ordner-Browser, neuer Ordner, angelegt unter /remote.php/dav/files/tester-id/, KeePassXC oeffnet', async () => {
        await p1.fill('#new-name', 'Wolke');
        await p1.click('#new-folder-btn');
        await p1.locator('#folder-picker').waitFor();
        await p1.locator('#folder-crumbs button', { hasText: 'Alle Dateien' }).click();
        await p1.locator('.folder-item[data-name="Privat"]').waitFor();
        await p1.click('#folder-new'); await p1.fill('#prompt-input', 'Neu 2026'); await p1.click('#prompt-ok');
        await p1.waitForFunction(() => /Neu 2026/.test(document.querySelector('#folder-crumbs')?.textContent || ''));
        await p1.click('#folder-ok');
        expect(await p1.locator('#new-folder').innerText() === 'Neu 2026', 'Ordner: ' + await p1.locator('#new-folder').innerText());
        await p1.fill('#new-new', PW); await p1.fill('#new-repeat', PW);
        await p1.click('#new-btn'); await waitOpened(p1, 60000);
        expect(xcLs(dav('Neu 2026/Wolke.kdbx'), PW) !== null, 'KeePassXC oeffnet die neue Datei nicht');
        const s = await ls(p1);
        expect(s.url === `${files}/Neu%202026/Wolke.kdbx` && s.mode === 'nc', JSON.stringify(s));
        await p1.context().close();
    });

    const p2 = await newPage();
    const legacyUrl = `${files}/Privat/Team Tresor.kdbx`; // typed in by hand like this (space instead of %20): the identifier has to stay exactly the same, character for character
    await step('Bisherige Nutzung: WebDAV-Adresse, Schluesseldatei gemerkt, Offline-Kopie an', async () => {
        await p2.goto(base); await p2.locator('#login-form').waitFor();
        await p2.click('#dav-davmode');
        await p2.fill('#dav-url', legacyUrl); await p2.fill('#dav-user', 'tester'); await p2.fill('#dav-pass', 'app-secret');
        await p2.fill('#master', PW); await p2.setInputFiles('#keyfile', KEY); await p2.check('#kf-remember'); await p2.check('#offline-opt'); // the file has already expanded the options
        await p2.click('#open-btn'); await waitOpened(p2, 60000);
        await p2.click('#lock-btn'); await p2.locator('#login-form').waitFor();
        await p2.evaluate(() => localStorage.removeItem('kpnc.davmode')); // like before this update: the setting didn't exist yet
    });

    await step('Nach dem Update: gespeicherte Adresse fuellt Nextcloud-Adresse und Pfad vor, gemerkte Schluesseldatei greift, ohne Konto-Abfrage; Adresse bleibt gleich', async () => {
        await p2.reload(); await p2.locator('#login-form').waitFor();
        expect(await p2.locator('#dav-server').isVisible(), 'soll die Nextcloud-Adresse zeigen');
        expect(await p2.inputValue('#dav-server') === base && await p2.inputValue('#dav-path') === '/Privat/Team Tresor.kdbx' && await p2.inputValue('#dav-user') === 'tester',
            `vorbelegt: ${await p2.inputValue('#dav-server')} ${await p2.inputValue('#dav-path')}`);
        await p2.locator('#kf-remembered').waitFor({ state: 'visible', timeout: 5000 }).catch(() => { throw new Error('gemerkte Schluesseldatei nicht erkannt'); });
        const before = log.length;
        await p2.fill('#dav-pass', 'app-secret'); await p2.fill('#master', PW);
        await p2.click('#open-btn'); await waitOpened(p2, 60000);
        expect(!log.slice(before).includes('PROPFIND /remote.php/dav/'), 'Konto unnoetig erfragt');
        expect((await ls(p2)).url === legacyUrl, 'gespeicherte Adresse geaendert: ' + (await ls(p2)).url);
    });

    await step('Nach dem Update, Server weg: Offline-Kopie unter derselben Kennung oeffnet', async () => {
        await p2.click('#lock-btn'); await p2.locator('#login-form').waitFor();
        await p2.route((u) => u.pathname.startsWith('/remote.php/'), (r) => r.abort());
        await p2.fill('#dav-pass', 'app-secret'); await p2.fill('#master', PW);
        await p2.click('#open-btn'); await waitOpened(p2, 60000);
        expect(/aus der Offline-Kopie geöffnet/.test(await p2.locator('#status').innerText()), 'Status: ' + await p2.locator('#status').innerText());
        await p2.context().close();
    });

    const p3 = await newPage();
    await step('Andere Herkunft ohne CORS (Nextcloud-Standard): Durchsuchen und Oeffnen sagen verstaendlich, woran es liegen kann', async () => {
        await p3.goto(base); await p3.locator('#login-form').waitFor();
        await p3.fill('#dav-server', other); await p3.fill('#dav-user', 'tester'); await p3.fill('#dav-pass', 'app-secret');
        await p3.click('#dav-browse');
        await loginError(p3, new RegExp(`localhost:${port}.*CORS`));
        await p3.fill('#dav-path', '/Privat/Passwörter.kdbx'); await p3.fill('#master', PW);
        await p3.click('#open-btn');
        await loginError(p3, new RegExp(`localhost:${port}.*CORS`));
    });

    await step('Andere Herkunft mit CORS: Durchsuchen, Oeffnen und Speichern (ETag ueber Expose-Headers) klappen', async () => {
        options.cors = true;
        await p3.click('#dav-browse');
        await pick(p3, 'Passwörter.kdbx'); // starts in the folder of the path in the field
        await p3.click('#open-btn'); await waitOpened(p3, 60000);
        await p3.click('#new-group-btn'); await p3.fill('#prompt-input', 'Von woanders'); await p3.keyboard.press('Enter');
        await p3.click('#save-btn');
        await p3.waitForFunction(() => /^Gespeichert/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 30000 })
            .catch(async () => { throw new Error('Status: ' + await p3.locator('#status').innerText()); });
        expect(xcLs(dav('Privat/Passwörter.kdbx'), PW)?.includes('Von woanders/'), 'Gruppe fehlt bei KeePassXC');
        expect((await ls(p3)).url === `http://localhost:${port}/remote.php/dav/files/tester-id/Privat/Passw%C3%B6rter.kdbx`, (await ls(p3)).url);
        await p3.context().close();
    });

    await step('[Durchsuchen] zum zweiten Mal: die zuletzt bekannte Liste steht sofort da, auch wenn der Server traege antwortet, und wird danach aufgefrischt', async () => {
        const p = await newPage();
        await p.goto(base); await p.locator('#login-form').waitFor();
        await p.fill('#dav-server', `127.0.0.1:${port}`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret');
        await p.click('#dav-browse');
        await p.locator('.folder-item[data-name="Privat"]').waitFor();
        await p.click('#folder-cancel');
        let release; const gate = new Promise((r) => { release = r; });
        await p.route('**/remote.php/dav/files/**', async (route) => { if (route.request().method() === 'PROPFIND') await gate; await route.continue(); });
        await p.click('#dav-browse');
        await p.locator('.folder-item[data-name="Privat"]').waitFor({ timeout: 1500 }); // PROPFIND is still held back here
        release();
        await p.waitForFunction(() => !!document.querySelector('.folder-item[data-name="Privat"]'));
        await p.unroute('**/remote.php/dav/files/**');
        await p.context().close();
    });

    await step('Allererster Besuch: "Lokale Datei" ist vorgewaehlt, der Wechsel zu Nextcloud/WebDAV ist ein Klick und bleibt', async () => {
        const p = await newPage({ fresh: true });
        await p.goto(base); await p.locator('#login-form').waitFor();
        expect(await p.locator('input[name=src][value=file]').isChecked(), 'Lokale Datei nicht vorgewaehlt');
        expect(await p.locator('#local-file').isVisible() && !(await p.locator('#dav-server').isVisible()), 'Datei-Feld soll sichtbar, Server-Feld versteckt sein');
        await p.locator('label.seg:has(input[value=dav])').click();
        expect(await p.locator('#dav-server').isVisible(), 'Nextcloud-Felder fehlen nach dem Wechsel');
        await p.reload(); await p.locator('#login-form').waitFor();
        expect(await p.locator('input[name=src][value=file]').isChecked() === false, 'Wahl wurde nicht gemerkt');
        const q = await newPage({ fresh: true });
        await q.goto(`${base}/?url=${encodeURIComponent(files + '/x.kdbx')}`); await q.locator('#login-form').waitFor();
        expect(await q.locator('input[name=src][value=dav]').isChecked(), 'Mit ?url= soll WebDAV vorgewaehlt sein');
    });

    await step('Keine JS-Fehler', async () => { expect(errors.length === 0, errors.join(' | ')); });

    await browser.close(); await stop();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} Tests "Nextcloud-Adresse" bestanden`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
