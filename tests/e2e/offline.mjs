// Ausfall-Tests (eigenstaendige Seite): Der WebDAV-Server wird wirklich beendet und neu gestartet.
// Prueft: App startet ohne Server (Service Worker), Oeffnen aus der Offline-Kopie, Aendern ohne Server, Neustart, Hochladen,
// Zusammenfuehrung bei zwischenzeitlicher Fremdaenderung, Abholen von Fremdaenderungen, Loeschen der lokalen Daten.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, knownFetchNoise, uncaughtWatch } from '../browser.mjs';
import { startServer } from './davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PW = 'Test-Passwort-123';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-off-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);
const xc = (args, input = PW + '\n') => execFileSync('keepassxc-cli', args, { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString('utf8');
const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 4).join(' | ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

async function main() {
    execFileSync('python3', ['-I', path.join(root, 'tests/compat/make-pykeepass-ref.py')], { cwd: tmp });
    const f4 = path.join(davRoot, 'vault4.kdbx');
    fs.renameSync(path.join(tmp, 'ref4.kdbx'), f4);
    xc(['edit', '-q', f4, 'Web/Mail', '--notes', 'Notiz äöü € (KeePassXC)']);

    let srv = await startServer({ webRoot: path.join(root, 'web'), davRoot });
    const port = srv.port, base = `http://127.0.0.1:${port}`;
    const outage = async () => { await srv.stop(); };
    const recover = async () => { srv = await startServer({ webRoot: path.join(root, 'web'), davRoot, port }); };
    const browser = await launchBrowser();
    const pageErrors = [];

    const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(uncaughtWatch);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'change', offline: true })); } catch {} });
    const page = await ctx.newPage();
    // Der Server wird absichtlich mitten in Anfragen beendet; WebKit meldet das gelegentlich als Seitenfehler (knownFetchNoise).
    // Echte, nicht abgefangene Fehler kommen trotzdem an: ueber uncaughtWatch als "UNCAUGHT:"-Konsolenmeldung.
    page.on('pageerror', (e) => { if (!knownFetchNoise(e.message)) pageErrors.push(String(e)); });
    page.on('console', (m) => { if (m.type() === 'error' && m.text().startsWith('UNCAUGHT: ')) pageErrors.push(m.text()); });
    const url = (q = '') => `${base}/?syncretry=2${q}`;
    const rows = () => page.locator('[data-testid=entry-row]');
    const status = () => page.locator('#status').innerText();
    const waitStatus = (re, t = 25000) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout: t });
    const syncState = () => page.locator('#sync-state').getAttribute('data-state');
    const login = async () => {
        await page.locator('input[value=dav]').check({ force: true });
        await page.fill('#dav-url', `${base}/dav/vault4.kdbx`); await page.fill('#dav-user', 'tester'); await page.fill('#dav-pass', 'app-secret');
        await page.fill('#master', PW); await page.click('#open-btn');
    };
    const editUser = async (title, user) => {
        await page.locator('[data-testid=entry-row]', { hasText: title }).click();
        await page.click('#edit-btn'); await page.fill('#e-user', user); await page.click('#apply-btn');
    };

    await step('Online-Anmeldung mit Offline-Option: Offline-Kopie + App-Cache werden angelegt', async () => {
        await page.goto(url());
        await login(); await rows().first().waitFor();
        await page.waitForSelector('html[data-offline-ready="1"]', { timeout: 20000 });
        expect(await syncState() === 'synced', 'Zustand: ' + await syncState());
    });

    await step('Serverausfall: Seite startet trotzdem (Service Worker), Anmeldung oeffnet die Offline-Kopie', async () => {
        await outage();
        await page.goto(url());
        await page.locator('#login-form').waitFor({ timeout: 15000 });
        expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Seite wird nicht vom Service Worker kontrolliert');
        await login(); await rows().first().waitFor({ timeout: 30000 });
        expect(/Offline-Kopie/.test(await status()), await status());
        expect(await syncState() === 'offline', 'Zustand ' + await syncState());
        expect(await rows().count() === 2, 'Eintraege');
    });

    await step('Aendern ohne Server: automatisch lokal gesichert, Hinweis, ueberlebt Neuladen', async () => {
        await editUser('Mail', 'alice-offline');
        await waitStatus(/Server nicht erreichbar/);
        expect(await syncState() === 'unsynced', 'Zustand ' + await syncState());
        await page.goto(url()); await page.locator('#login-form').waitFor();
        await login(); await rows().first().waitFor({ timeout: 30000 });
        await page.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        expect((await page.locator('[data-testid=f-user]').innerText()).trim() === 'alice-offline', 'Aenderung nach Neuladen weg');
        expect(!xc(['show', f4, 'Web/Mail']).includes('alice-offline'), 'Server darf die Aenderung noch nicht haben');
    });

    await step('Fremdaenderung auf dem Server waehrend des Ausfalls + Wiederkehr: automatische Zusammenfuehrung, beide Aenderungen vorhanden', async () => {
        xc(['edit', '-q', f4, 'Bank/Konto', '--url', 'https://extern.example']); // anderes Geraet, Server steht
        await recover();
        await waitStatus(/zusammengef|abgeglichen/, 30000);
        await page.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'synced', null, { timeout: 15000 });
        const m = xc(['show', f4, 'Web/Mail']), k = xc(['show', f4, 'Bank/Konto']);
        expect(m.includes('alice-offline'), 'Offline-Aenderung fehlt auf dem Server:\n' + m);
        expect(k.includes('https://extern.example'), 'Fremdaenderung verloren:\n' + k);
        expect(fs.readdirSync(davRoot).some((n) => /\.conflict-.*\.bak$/.test(n)), 'conflict-Sicherung fehlt');
        return await status();
    });

    await step('Aenderung auf Server-Seite wird im Intervall-Modus abgeholt und angezeigt', async () => {
        await page.goto(url('&autosave=1&syncinterval=2')); await page.locator('#login-form').waitFor();
        await login(); await rows().first().waitFor();
        await page.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        xc(['edit', '-q', f4, 'Bank/Konto', '--username', 'bob-extern']);
        await page.waitForFunction(() => /bob-extern/.test(document.querySelector('[data-testid=f-user]')?.textContent || ''), null, { timeout: 20000 });
        expect(/Änderungen von einem anderen Gerät/.test(await status()), await status());
    });

    await step('Ohne Offline-Option: Ausfall beim Speichern -> Fehlermeldung, Aenderung bleibt ungespeichert (nichts geht still verloren); Anmeldung bei Ausfall -> klare Meldung', async () => {
        const ctx2 = await browser.newContext({ locale: 'de-DE' });
        await ctx2.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'change', offline: false })); } catch {} });
        const p2 = await ctx2.newPage();
        await p2.goto(url());
        await p2.fill('#dav-url', `${base}/dav/vault4.kdbx`); await p2.fill('#dav-user', 'tester'); await p2.fill('#dav-pass', 'app-secret'); await p2.fill('#master', PW);
        await p2.click('#open-btn'); await p2.locator('[data-testid=entry-row]').first().waitFor();
        await outage();
        await p2.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await p2.click('#edit-btn'); await p2.fill('#e-user', 'verloren?'); await p2.click('#apply-btn');
        await p2.waitForFunction(() => /Speichern fehlgeschlagen: Server nicht erreichbar/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 15000 });
        expect(/Speichern \*/.test(await p2.locator('#save-btn').innerText()), 'Aenderung muss als ungespeichert markiert bleiben');
        await p2.click('#lock-btn').catch(() => {});
        await ctx2.close();
        const ctx3 = await browser.newContext({ locale: 'de-DE' });
        const p3 = await ctx3.newPage();
        await p3.goto(url()).catch(() => {});
        await ctx3.close();
        await recover();
        const ctx4 = await browser.newContext({ locale: 'de-DE' });
        await ctx4.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off', offline: false })); } catch {} });
        const p4 = await ctx4.newPage();
        await p4.goto(url());
        await p4.fill('#dav-url', `${base}/dav/vault4.kdbx`); await p4.fill('#dav-user', 'tester'); await p4.fill('#dav-pass', 'app-secret'); await p4.fill('#master', PW);
        await outage();
        await p4.click('#open-btn');
        await p4.waitForFunction(() => /Server ist nicht erreichbar/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 15000 });
        await ctx4.close();
        await recover();
    });

    await step('"Lokale Daten loeschen" entfernt Offline-Kopie, App-Cache und Service Worker', async () => {
        await page.goto(url()); await page.locator('#login-form').waitFor();
        await page.click('#wipe-btn'); await page.click('#wipe-btn');
        await page.waitForFunction(() => /gelöscht/.test(document.querySelector('#login-error')?.textContent || ''));
        const left = await page.evaluate(async () => {
            const regs = (await navigator.serviceWorker.getRegistrations()).length;
            const caches_ = (await caches.keys()).filter((k) => k.startsWith('kpnc-')).length;
            const idb = await new Promise((res) => { const r = indexedDB.open('keepassnc'); r.onsuccess = () => { const d = r.result; const t = d.transaction('files').objectStore('files').count(); t.onsuccess = () => res(t.result); }; r.onerror = () => res(-1); });
            return { regs, caches_, idb, ls: Object.keys(localStorage).filter((k) => k.startsWith('kpnc.')).length };
        });
        expect(left.regs === 0 && left.caches_ === 0 && left.idb === 0 && left.ls === 0, JSON.stringify(left));
    });

    await step('Keine JS-Fehler waehrend der Ausfall-Szenarien', async () => { expect(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ')); });

    await browser.close();
    await srv.stop();
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; }
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '  -> ' + r.info : ''}`);
if (crashed) console.log('ABBRUCH:', crashed.stack || crashed.message);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} Ausfall-Tests bestanden`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed || crashed ? 1 : 0);
