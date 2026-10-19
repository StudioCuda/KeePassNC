// Test "Master-Passwort / Schluesseldatei aendern": Pruefungen im Dialog, Ergebnis mit keepassxc-cli gegengeprueft, Konflikt direkt nach
// dem Aendern (Zusammenfuehren mit den alten Zugangsdaten), neue Schluesseldatei nur nach Kontrolle, gemerkte Schluesseldatei,
// Sicherungskopien loeschen, lokale Datei, und dass ein gescheitertes Speichern die alten Zugangsdaten stehen laesst.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, waitOpened } from '../browser.mjs';
import { startServer } from './davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-cred-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);
const OLD = 'Alt-Passwort-Wiesel-4711!', N1 = 'Neu-Passwort-Kuckucksuhr-7342!', N2 = 'Zweites-Passwort-Murmeltier-0815?', N3 = 'Drittes-Passwort-Gaensebluemchen-2468#';
const KEY_A = path.join(tmp, 'a.keyx');
const dav = (name) => path.join(davRoot, name);
function mkDb(file, keyfile) {
    execFileSync('keepassxc-cli', ['db-create', '-q', '-p', ...(keyfile ? ['--set-key-file', keyfile] : []), '-t', '100', file], { input: OLD + '\n' + OLD + '\n', stdio: 'pipe' });
    execFileSync('keepassxc-cli', ['add', '-q', ...(keyfile ? ['-k', keyfile] : []), '-u', 'alice', file, 'Mail'], { input: OLD + '\n' });
}
mkDb(dav('pw.kdbx')); mkDb(dav('kf.kdbx'), KEY_A); mkDb(path.join(tmp, 'local.kdbx'));
/** Oeffnet KeePassXC die Datei mit diesen Zugangsdaten? Mit Eintragsliste, falls ja. */
const xcLs = (file, pw, keyfile) => {
    const r = spawnSync('keepassxc-cli', ['ls', '-q', '-R', ...(keyfile ? ['-k', keyfile] : []), file], { input: pw + '\n' });
    return r.status === 0 ? r.stdout.toString('utf8') : null;
};
const backups = (name) => fs.readdirSync(davRoot).filter((f) => f.startsWith(name + '.') && f.endsWith('.bak'));

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 10).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

async function main() {
    const { stop, port } = await startServer({ webRoot: path.join(root, 'web'), davRoot });
    const base = `http://127.0.0.1:${port}`;
    const browser = await launchBrowser();
    const errors = [];
    const newPage = async (settings = { autosync: 'off' }) => {
        // Ohne Service Worker: Anfragen ueber ihn sieht page.route nicht (WebKit), und die Offline-Kopie liegt ohnehin in IndexedDB
        const c = await browser.newContext({ locale: 'de-DE', acceptDownloads: true, viewport: { width: 1400, height: 950 }, serviceWorkers: 'block' });
        await c.addInitScript((s) => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify(s)); } catch {} }, settings);
        const p = await c.newPage();
        p.on('pageerror', (e) => errors.push(String(e)));
        return p;
    };
    const login = async (p, file, pw, { key, remember = false } = {}) => {
        await p.goto(base);
        await p.locator('input[value=dav]').check({ force: true });
        await p.fill('#dav-url', `${base}/dav/${file}`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret');
        await p.fill('#master', pw);
        if (key) { await p.setInputFiles('#keyfile', key); if (remember) await p.check('#kf-remember'); }
        await p.click('#open-btn'); await waitOpened(p, 60000);
    };
    const lock = async (p) => { await p.click('#lock-btn'); await p.locator('#login-form').waitFor(); };
    const openCred = async (p) => {
        await p.click('#reports-btn'); await p.click('#rep-tab-info'); await p.click('#cred-btn');
        await p.locator('#cred-form').waitFor();
    };
    const fillCred = async (p, { current = '', next = '', repeat = next } = {}) => {
        await p.fill('#cred-current', current); await p.fill('#cred-new', next); await p.fill('#cred-repeat', repeat);
    };
    const credError = async (p, re) => {
        await p.click('#cred-apply');
        await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#cred-error')?.textContent || ''), re.source, { timeout: 15000 });
    };
    const waitStatus = async (p, re, timeout = 60000) => {
        try { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout }); }
        catch (e) { throw new Error(`Status ${re}: "${await p.locator('#status').innerText().catch(() => '?')}" (${String(e.message).split('\n')[0]})`); }
    };
    const failPut = (p, file) => p.route((u) => u.pathname === `/dav/${file}`, (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 403 }) : r.continue()));

    const p1 = await newPage();
    await step('Dialog prueft: aktuelles Passwort fehlt/falsch, Wiederholung, nichts geaendert, schwaches Passwort fragt nach', async () => {
        await login(p1, 'pw.kdbx', OLD);
        await openCred(p1);
        await credError(p1, /zuerst das aktuelle/);
        await fillCred(p1, { current: OLD + 'x', next: N1 }); await credError(p1, /stimmt nicht/);
        await fillCred(p1, { current: OLD, next: N1, repeat: N1 + 'x' }); await credError(p1, /nicht gleich/);
        await fillCred(p1, { current: OLD }); await credError(p1, /nichts geändert/);
        await fillCred(p1, { current: OLD, next: 'hallo123' }); await p1.click('#cred-apply');
        await p1.locator('#confirm-cancel').click();
        expect(await p1.locator('#cred-form').isVisible(), 'Dialog soll nach Abbruch offen bleiben');
        expect(xcLs(dav('pw.kdbx'), OLD), 'Datei soll unveraendert mit dem alten Passwort aufgehen');
        expect(!(await p1.locator('#cred-del-backups').isChecked()), 'Sicherungskopien loeschen ist standardmaessig aus');
        await p1.keyboard.press('Escape');
    });

    await step('Master-Passwort aendern: gespeichert, KeePassXC oeffnet nur mit dem neuen; Sicherungskopie noch mit dem alten; neu anmelden', async () => {
        await openCred(p1);
        await fillCred(p1, { current: OLD, next: N1 }); await p1.click('#cred-apply');
        await waitStatus(p1, /Zugangsdaten geändert und gespeichert/);
        expect(await p1.locator('#cred-form').count() === 0, 'Dialog soll zu sein');
        expect(xcLs(dav('pw.kdbx'), N1)?.includes('Mail'), 'neues Passwort oeffnet nicht');
        expect(!xcLs(dav('pw.kdbx'), OLD), 'altes Passwort oeffnet noch');
        const bak = backups('pw.kdbx');
        expect(bak.length === 1 && xcLs(dav(bak[0]), OLD), 'Sicherungskopie mit dem alten Passwort erwartet: ' + bak);
        await lock(p1); await login(p1, 'pw.kdbx', N1);
        await p1.click('#reports-btn'); await p1.click('#rep-tab-info');
        expect(/Zugangsdaten geändert/.test(await p1.locator('.report-body').innerText()), 'Info zeigt das Aenderungsdatum');
        await p1.keyboard.press('Escape');
    });

    await step('Konflikt direkt nach dem Aendern: Server-Stand wird mit den alten Zugangsdaten gelesen und zusammengefuehrt', async () => {
        execFileSync('keepassxc-cli', ['add', '-q', '-u', 'bob', dav('pw.kdbx'), 'Extern'], { input: N1 + '\n' });
        await openCred(p1);
        await fillCred(p1, { current: N1, next: N2 }); await p1.click('#cred-apply');
        await waitStatus(p1, /Zugangsdaten geändert und gespeichert/);
        const ls = xcLs(dav('pw.kdbx'), N2);
        expect(ls?.includes('Extern') && ls.includes('Mail'), 'zusammengefuehrter Stand mit neuem Passwort: ' + ls);
        expect(!xcLs(dav('pw.kdbx'), N1), 'altes Passwort oeffnet noch');
        expect(await p1.locator('[data-testid=entry-row]', { hasText: 'Extern' }).count() === 1, 'fremder Eintrag in der Liste');
    });

    await step('Speichern scheitert (403): Fehler im Dialog, alte Zugangsdaten gelten weiter, spaeteres Speichern nutzt sie', async () => {
        await failPut(p1, 'pw.kdbx');
        await openCred(p1);
        await fillCred(p1, { current: N2, next: N3 }); await credError(p1, /nicht geändert/);
        await p1.keyboard.press('Escape');
        await p1.unrouteAll();
        await p1.click('#save-btn'); await waitStatus(p1, /^Gespeichert/);
        expect(xcLs(dav('pw.kdbx'), N2) && !xcLs(dav('pw.kdbx'), N3), 'Datei soll mit N2 aufgehen, nicht mit N3');
        await openCred(p1); await fillCred(p1, { current: N3 }); await credError(p1, /stimmt nicht/); // auch in der Vault gilt wieder N2
        await p1.keyboard.press('Escape');
        await lock(p1);
    });

    const p2 = await newPage();
    const kfRecord = (p) => p.evaluate(() => new Promise((res) => {
        const r = indexedDB.open('keepassnc');
        r.onsuccess = () => {
            if (!r.result.objectStoreNames.contains('files')) return res(null);
            const g = r.result.transaction('files').objectStore('files').getAllKeys();
            g.onsuccess = () => res(g.result.filter((k) => String(k).startsWith('kf:')));
        };
        r.onerror = () => res(null);
    }));
    const fresh = path.join(tmp, 'neu.keyx');
    await step('Neue Schluesseldatei: erst Download, dann Kontrolle; Sicherungskopien geloescht; gemerkte Datei wird angepasst', async () => {
        await login(p2, 'kf.kdbx', OLD, { key: KEY_A, remember: true });
        await openCred(p2);
        await fillCred(p2, { current: OLD });
        await p2.locator('#cred-form input[value=new]').check();
        await credError(p2, /zuerst herunterladen/);
        const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('#cred-kf-download')]);
        expect(dl.suggestedFilename() === 'kf.keyx', 'Dateiname ' + dl.suggestedFilename());
        await dl.saveAs(fresh);
        expect(/<Version>2\.0<\/Version>/.test(fs.readFileSync(fresh, 'utf8')), 'XML-Schluesseldatei 2.0 erwartet');
        await credError(p2, /zur Kontrolle/);
        await p2.setInputFiles('#cred-kf-verify', KEY_A);
        await p2.waitForFunction(() => /nicht die neue/.test(document.querySelector('#cred-kf-check')?.textContent || ''));
        await credError(p2, /zur Kontrolle/);
        // Kopie mit Windows-Zeilenenden zaehlt als dieselbe Datei
        const crlf = path.join(tmp, 'neu-crlf.keyx'); fs.writeFileSync(crlf, fs.readFileSync(fresh, 'utf8').replace(/\n/g, '\r\n'));
        await p2.setInputFiles('#cred-kf-verify', crlf);
        await p2.waitForFunction(() => /^Passt/.test(document.querySelector('#cred-kf-check')?.textContent || ''));
        await p2.check('#cred-del-backups');
        await p2.click('#cred-apply');
        await waitStatus(p2, /Zugangsdaten geändert und gespeichert.*gemerkte Schlüsseldatei ist angepasst.*Sicherungskopien gelöscht: 1/);
        expect(xcLs(dav('kf.kdbx'), OLD, fresh)?.includes('Mail'), 'neue Schluesseldatei oeffnet nicht');
        expect(!xcLs(dav('kf.kdbx'), OLD, KEY_A), 'alte Schluesseldatei oeffnet noch');
        expect(backups('kf.kdbx').length === 0, 'Sicherungskopien uebrig: ' + backups('kf.kdbx'));
        await lock(p2);
        await p2.fill('#dav-url', `${base}/dav/kf.kdbx`); await p2.fill('#dav-pass', 'app-secret'); await p2.fill('#master', OLD);
        await p2.locator('#kf-remembered').waitFor({ state: 'visible' });
        await p2.click('#open-btn'); await waitOpened(p2, 60000); // gemerkte (neue) Schluesseldatei, ohne Auswahl
    });

    await step('Schluesseldatei entfernen und Passwort aendern: Rueckfrage, KeePassXC oeffnet ohne Datei, gemerkter Datensatz weg', async () => {
        await openCred(p2);
        await fillCred(p2, { current: OLD, next: N1 });
        await p2.locator('#cred-form input[value=none]').check();
        await p2.click('#cred-apply');
        await p2.click('#confirm-ok');
        await waitStatus(p2, /Zugangsdaten geändert und gespeichert.*vergessen/);
        expect(xcLs(dav('kf.kdbx'), N1)?.includes('Mail'), 'ohne Schluesseldatei oeffnet nicht');
        expect((await kfRecord(p2)).length === 0, 'gemerkter Datensatz soll weg sein');
        await openCred(p2);
        expect(await p2.locator('#cred-form input[value=none]').count() === 0, 'ohne Schluesseldatei gibt es nichts zu entfernen');
        await p2.keyboard.press('Escape');
        await lock(p2);
    });

    await step('Lokale Datei: nach dem Aendern wird sie neu heruntergeladen und oeffnet nur mit dem neuen Passwort', async () => {
        await p2.goto(base);
        await p2.locator('input[value=file]').check({ force: true });
        await p2.setInputFiles('#local-file', path.join(tmp, 'local.kdbx'));
        await p2.fill('#master', OLD); await p2.click('#open-btn'); await waitOpened(p2, 60000);
        await openCred(p2);
        expect(await p2.locator('#cred-del-backups').count() === 0, 'lokale Datei hat keine Sicherungskopien');
        await fillCred(p2, { current: OLD, next: N1 });
        const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('#cred-apply')]);
        const out = path.join(tmp, 'local-neu.kdbx'); await dl.saveAs(out);
        await waitStatus(p2, /neu heruntergeladen/);
        expect(dl.suggestedFilename() === 'local.kdbx' && xcLs(out, N1)?.includes('Mail') && !xcLs(out, OLD), 'heruntergeladene Datei');
        await lock(p2);
    });

    await step('Mit Offline-Kopie: gescheitertes Speichern legt den Stand lokal mit den alten Zugangsdaten ab', async () => {
        const p3 = await newPage({ autosync: 'off', offline: true });
        await login(p3, 'pw.kdbx', N2);
        await failPut(p3, 'pw.kdbx');
        await openCred(p3);
        await fillCred(p3, { current: N2, next: N3 }); await credError(p3, /nicht geändert/);
        await p3.keyboard.press('Escape');
        await p3.unrouteAll();
        await lock(p3);
        await login(p3, 'pw.kdbx', N2); // oeffnet die lokale (ungesyncte) Kopie: die muss mit N2 aufgehen
        for (let i = 0; i < 60 && !(await p3.locator('#sync-state[data-state=synced]').count()); i++) await p3.waitForTimeout(500);
        expect(xcLs(dav('pw.kdbx'), N2) && !xcLs(dav('pw.kdbx'), N3), 'Server-Stand soll mit N2 aufgehen');
        await p3.context().close();
    });

    await step('Keine JS-Fehler', async () => { expect(errors.length === 0, errors.join(' | ')); });

    await browser.close(); await stop();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} Zugangsdaten-Tests bestanden`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
