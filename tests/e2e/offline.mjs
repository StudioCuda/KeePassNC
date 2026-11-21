// Outage tests (standalone page): the WebDAV server really is stopped and restarted.
// Checks: app starts without a server (service worker), opening from the offline copy, changing without a server, restart, upload,
// merging after a foreign change in the meantime, pulling foreign changes, two tabs sharing one offline copy, new credentials set
// without a server (and merged after a reload with the previous ones), a save the server never answers, a full server, deleting the local data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, knownFetchNoise, uncaughtWatch, plainWebdav } from '../browser.mjs';
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
    execFileSync('python3', ['-I', path.join(root, 'tests/compat/make-pykeepass-ref.py')], { cwd: tmp, env: { ...process.env, KPNC_CHEAP_KDF: '1' } });
    const f4 = path.join(davRoot, 'vault4.kdbx');
    fs.renameSync(path.join(tmp, 'ref4.kdbx'), f4);
    xc(['edit', '-q', f4, 'Web/Mail', '--notes', 'Notiz äöü € (KeePassXC)']);
    const f5 = path.join(davRoot, 'vault5.kdbx'); // gets new credentials, so the other steps keep theirs
    fs.copyFileSync(f4, f5);

    let srv = await startServer({ webRoot: path.join(root, 'web'), davRoot });
    const port = srv.port, base = `http://127.0.0.1:${port}`;
    const outage = async () => { await srv.stop(); };
    const recover = async () => { srv = await startServer({ webRoot: path.join(root, 'web'), davRoot, port }); };
    const browser = await launchBrowser();
    const pageErrors = [];

    const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(plainWebdav);
    await ctx.addInitScript(uncaughtWatch);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'change', offline: true })); } catch {} });
    const page = await ctx.newPage();
    // The server is deliberately stopped in the middle of requests; WebKit occasionally reports that as a page error (knownFetchNoise).
    // Real, uncaught errors still get through: via uncaughtWatch as an "UNCAUGHT:" console message.
    const watchErrors = (p) => {
        p.on('pageerror', (e) => { if (!knownFetchNoise(e)) pageErrors.push(String(e)); });
        p.on('console', (m) => { if (m.type() === 'error' && m.text().startsWith('UNCAUGHT: ')) pageErrors.push(m.text()); });
    };
    watchErrors(page);
    const url = (q = '') => `${base}/?syncretry=2${q}`;
    const rows = () => page.locator('[data-testid=entry-row]');
    const status = () => page.locator('#status').innerText();
    const waitStatus = async (re, t = 25000, p = page) => {
        try { await p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout: t }); }
        catch (e) { throw new Error(`Status ${re}: "${await p.locator('#status').innerText().catch(() => '?')}" [${await p.locator('#sync-state').getAttribute('data-state').catch(() => '?')}] (${String(e.message).split('\n')[0]})`); }
    };
    const syncState = () => page.locator('#sync-state').getAttribute('data-state');
    const login = async (file = 'vault4.kdbx', pw = PW, p = page) => {
        await p.locator('input[value=dav]').check({ force: true });
        await p.fill('#dav-url', `${base}/dav/${file}`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret');
        await p.fill('#master', pw); await p.click('#open-btn');
    };
    const editUser = async (title, user, p = page) => {
        await p.locator('[data-testid=entry-row]', { hasText: title }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', user); await p.click('#apply-btn');
    };

    await step('Online-Anmeldung mit Offline-Option: Offline-Kopie + App-Cache werden angelegt', async () => {
        await page.goto(url());
        await login(); await rows().first().waitFor();
        await page.waitForSelector('html[data-offline-ready="1"]', { timeout: 20000 });
        expect(await syncState() === 'synced', 'Zustand: ' + await syncState());
        const cached = await page.evaluate(async () => (await (await caches.open('kpnc-app-v1')).keys()).map((r) => r.url));
        expect(cached.some((u) => /\/keepassnc-argon2\.js$/.test(u)), 'Argon2-Worker fehlt im App-Cache: ' + cached.join(', '));
    });

    await step('Serverausfall: Seite startet trotzdem (Service Worker), Anmeldung oeffnet die Offline-Kopie', async () => {
        await outage();
        await page.goto(url());
        await page.locator('#login-form').waitFor({ timeout: 15000 });
        expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Seite wird nicht vom Service Worker kontrolliert');
        const workers = []; const onWorker = (w) => workers.push(w.url()); page.on('worker', onWorker);
        await login(); await rows().first().waitFor({ timeout: 30000 });
        page.off('worker', onWorker);
        expect(workers.length === 1, 'Argon2-Worker sollte auch offline aus dem App-Cache starten: ' + JSON.stringify(workers));
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

    await step('Fremdaenderung auf dem Server waehrend des Ausfalls + Wiederkehr: automatische Zusammenfuehrung, beide Aenderungen vorhanden, Sicherung vor dem ersten Hochladen ist der Server-Stand', async () => {
        xc(['edit', '-q', f4, 'Bank/Konto', '--url', 'https://extern.example']); // another device, server is down
        await recover();
        await waitStatus(/zusammengef|abgeglichen/, 30000);
        await page.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'synced', null, { timeout: 15000 });
        const m = xc(['show', f4, 'Web/Mail']), k = xc(['show', f4, 'Bank/Konto']);
        expect(m.includes('alice-offline'), 'Offline-Aenderung fehlt auf dem Server:\n' + m);
        expect(k.includes('https://extern.example'), 'Fremdaenderung verloren:\n' + k);
        expect(fs.readdirSync(davRoot).some((n) => /\.conflict-.*\.bak$/.test(n)), 'conflict-Sicherung fehlt');
        // Opened from the offline copy with the unsynced change: the backup before the first upload must be what the server held, not that copy
        const baks = fs.readdirSync(davRoot).filter((n) => /^vault4\.kdbx\.\d{8}-\d{6}\.bak$/.test(n));
        expect(baks.length === 1, 'Sicherungen: ' + baks.join(', '));
        const bm = xc(['show', path.join(davRoot, baks[0]), 'Web/Mail']), bk = xc(['show', path.join(davRoot, baks[0]), 'Bank/Konto']);
        expect(!bm.includes('alice-offline') && bk.includes('https://extern.example'), 'Sicherung ist nicht der Server-Stand:\n' + bm + bk);
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

    await step('Zwei Tabs mit derselben Datenbank aendern waehrend des Ausfalls, einer wird geschlossen: der andere laedt beide Aenderungen hoch', async () => {
        await page.goto(url()); await page.locator('#login-form').waitFor();
        await login(); await rows().first().waitFor();
        const tab = await ctx.newPage(); // same browser profile: same IndexedDB, so both tabs share one offline copy
        watchErrors(tab);
        let down = false;
        try {
            await tab.goto(url()); await tab.locator('#login-form').waitFor();
            await login(undefined, undefined, tab); await tab.locator('[data-testid=entry-row]').first().waitFor();
            await outage(); down = true;
            await editUser('Mail', 'aus-tab-zwei', tab);
            await waitStatus(/Server nicht erreichbar/, 25000, tab);
            await editUser('Konto', 'aus-tab-eins');
            await waitStatus(/Server nicht erreichbar/);
            await page.locator('.toast', { hasText: 'anderen Tab' }).waitFor({ timeout: 10000 });
            await rows().filter({ hasText: 'Mail' }).click();
            expect((await page.locator('[data-testid=f-user]').innerText()).trim() === 'aus-tab-zwei', 'Aenderung des anderen Tabs fehlt in der Ansicht');
            await tab.close(); // before the server is back: its change only lives in the offline copy now
            await recover(); down = false;
            await page.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'synced', null, { timeout: 30000 });
            const m = xc(['show', f4, 'Web/Mail']), k = xc(['show', f4, 'Bank/Konto']);
            expect(m.includes('aus-tab-zwei'), 'Aenderung des geschlossenen Tabs fehlt auf dem Server:\n' + m);
            expect(k.includes('aus-tab-eins'), 'Aenderung des offenen Tabs fehlt auf dem Server:\n' + k);
        } finally { // the next steps need the server, whatever happened here
            if (!tab.isClosed()) await tab.close();
            if (down) await recover();
        }
    });

    await step('Zugangsdaten ohne Server geaendert, neu geladen, anderswo mit den alten bearbeitet: nach der Wiederkehr fragt die App einmal nach den vorherigen, fuehrt zusammen, die neuen bleiben', async () => {
        const N = 'Neu-Passwort-Kuckucksuhr-7342!';
        await page.goto(url()); await page.locator('#login-form').waitFor();
        await login('vault5.kdbx'); await rows().first().waitFor();
        await outage();
        try {
            await page.click('#reports-btn'); await page.click('#rep-tab-info'); await page.click('#cred-btn');
            await page.fill('#cred-current', PW); await page.fill('#cred-new', N); await page.fill('#cred-repeat', N); await page.click('#cred-apply');
            await waitStatus(/Zugangsdaten geändert und auf diesem Gerät gesichert/);
            await editUser('Mail', 'alice-neues-pw');
            // stored locally, by the auto-save or by the retry of the unsynced state, whichever comes first (only the auto-save says so)
            await page.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'unsynced', null, { timeout: 25000 });
            xc(['edit', '-q', f5, 'Bank/Konto', '--url', 'https://telefon.example']); // another device, still with the old password
            await page.goto(url()); await page.locator('#login-form').waitFor();
            await login('vault5.kdbx', N); await rows().first().waitFor({ timeout: 30000 }); // the offline copy opens with the new password
        } finally { await recover(); } // the steps after this one need the server, whatever happened here
        await page.locator('#rcred-form').waitFor({ timeout: 30000 });
        const ask = await page.locator('.modal', { has: page.locator('#rcred-form') }).innerText();
        expect(/Vorherige Zugangsdaten/.test(ask) && /neuen Zugangsdaten bleiben/.test(ask), 'Dialog soll nach den vorherigen fragen: ' + ask);
        await page.fill('#rcred-pw', PW); await page.click('#rcred-ok');
        await waitStatus(/mit deinen neuen Zugangsdaten gespeichert/, 30000);
        await page.waitForFunction(() => document.querySelector('#sync-state')?.dataset.state === 'synced', null, { timeout: 15000 });
        const m = xc(['show', f5, 'Web/Mail'], N + '\n'), k = xc(['show', f5, 'Bank/Konto'], N + '\n');
        expect(m.includes('alice-neues-pw'), 'eigene Aenderung fehlt:\n' + m);
        expect(k.includes('https://telefon.example'), 'Aenderung des anderen Geraets fehlt:\n' + k);
        let oldOpens = true;
        try { xc(['ls', '-q', f5]); } catch { oldOpens = false; }
        expect(!oldOpens, 'die Datei oeffnet noch mit dem alten Passwort');
    });

    await step('Ohne Offline-Option: Ausfall beim Speichern -> Fehlermeldung, Aenderung bleibt ungespeichert (nichts geht still verloren); Anmeldung bei Ausfall -> klare Meldung', async () => {
        const ctx2 = await browser.newContext({ locale: 'de-DE' });
        await ctx2.addInitScript(plainWebdav);
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
        await ctx3.addInitScript(plainWebdav);
        const p3 = await ctx3.newPage();
        await p3.goto(url()).catch(() => {});
        await ctx3.close();
        await recover();
        const ctx4 = await browser.newContext({ locale: 'de-DE' });
        await ctx4.addInitScript(plainWebdav);
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

    // Further pages in the same browser context (same offline copy), for the steps where the server misbehaves instead of being gone
    const openPage = async (q = '') => {
        const p = await ctx.newPage();
        watchErrors(p);
        await p.goto(url(q)); await p.locator('#login-form').waitFor();
        await p.fill('#dav-url', `${base}/dav/vault4.kdbx`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret');
        await p.fill('#master', PW); await p.click('#open-btn');
        await p.locator('[data-testid=entry-row]').first().waitFor({ timeout: 30000 });
        return p;
    };
    const statusOf = (p, re, t = 25000) => p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout: t });
    const stateOf = (p, want, t = 25000) => p.waitForFunction((w) => document.querySelector('#sync-state')?.dataset.state === w, want, { timeout: t });
    const editOn = async (p, title, user) => {
        await p.locator('[data-testid=entry-row]', { hasText: title }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', user); await p.click('#apply-btn');
    };
    const puts = () => srv.log.filter((l) => l.startsWith('PUT /dav/vault4.kdbx')).length; // the file and its backup copies

    await step('Speichern, auf das der Server nie antwortet: nach der Wartezeit "in der Offline-Kopie gesichert", Tab schliessen fragt nicht nach, die Offline-Kopie laedt spaeter hoch', async () => {
        const p = await openPage('&davtimeout=2');
        srv.options.fault = (m, rel) => (m === 'PUT' && rel === 'vault4.kdbx' ? 'hang' : undefined);
        try {
            await editOn(p, 'Mail', 'ohne-antwort'); // auto-save; its PUT never gets an answer
            await statusOf(p, /Server nicht erreichbar - Änderungen sind in der lokalen Offline-Kopie/);
            await stateOf(p, 'unsynced');
            // The retries hang the same way, but the offline copy holds the change: closing the tab asks nothing and loses nothing
            let asked = false;
            p.on('dialog', (d) => { asked = true; d.dismiss().catch(() => {}); });
            const closed = new Promise((r) => { p.once('close', r); setTimeout(r, 8000); });
            await p.close({ runBeforeUnload: true });
            await closed;
            expect(!asked && p.isClosed(), 'Rueckfrage beim Schliessen, obwohl die Offline-Kopie die Aenderung hat');
        } finally { srv.options.fault = null; }
        const p2 = await openPage();
        await stateOf(p2, 'synced', 30000);
        expect(xc(['show', f4, 'Web/Mail']).includes('ohne-antwort'), 'Aenderung aus der Offline-Kopie nicht auf dem Server');
        await p2.close();
    });

    await step('Server voll (507) mit Offline-Kopie: Fehlermeldung statt "offline gesichert", Banner mit "Kopie speichern", Wiederholungen ohne neue Meldung, nach dem Aufraeumen laedt die Wiederholung hoch', async () => {
        const p = await openPage();
        await p.evaluate(() => { // counts the error notices from here on
            window.kpncErrors = 0;
            new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast') && n.classList.contains('error')) window.kpncErrors++; }).observe(document.body, { childList: true, subtree: true });
        });
        srv.options.fault = (m, rel) => (m === 'PUT' && rel.startsWith('vault4.kdbx') ? 507 : undefined); // the backup copy too
        try {
            await editOn(p, 'Mail', 'kein-platz-offline');
            await statusOf(p, /kein Platz mehr frei/);
            expect(!/Offline-Kopie gesichert/.test(await p.locator('#status').innerText()), 'meldet "offline gesichert" bei vollem Server');
            expect(await p.locator('#readonly-banner').isVisible() && await p.locator('#ro-copy').isVisible(), 'Banner mit "Kopie speichern" fehlt');
            expect(await p.locator('#sync-state').getAttribute('data-state') === 'unsynced', 'Zustand ' + await p.locator('#sync-state').getAttribute('data-state'));
            const sent = puts(), errors = await p.evaluate(() => window.kpncErrors);
            await p.waitForTimeout(5000); // syncretry=2: two retries
            expect(puts() > sent, 'keine Wiederholung: Platz kann wiederkommen');
            expect(await p.evaluate(() => window.kpncErrors) === errors, 'jede Wiederholung meldet sich neu');
        } finally { srv.options.fault = null; }
        await statusOf(p, /Mit dem Server abgeglichen/);
        await stateOf(p, 'synced');
        expect(await p.locator('#readonly-banner').isHidden(), 'Banner bleibt nach dem Hochladen stehen');
        expect(xc(['show', f4, 'Web/Mail']).includes('kein-platz-offline'), 'Aenderung nicht auf dem Server');
        await p.close();
    });

    await step('Datei auf dem Server verschoben, waehrend die Offline-Kopie noch Aenderungen hat: Anmeldung oeffnet die Offline-Kopie mit Hinweis statt "nicht gefunden", nichts geht ohne Klick zum Server, "Datei wieder anlegen" legt sie zurueck', async () => {
        const p = await openPage('&davtimeout=2');
        srv.options.fault = (m, rel) => (m === 'PUT' && rel === 'vault4.kdbx' ? 'hang' : undefined);
        try {
            await editOn(p, 'Mail', 'nur-in-der-kopie');
            await statusOf(p, /Server nicht erreichbar - Änderungen sind in der lokalen Offline-Kopie/);
            await p.close();
        } finally { srv.options.fault = null; }
        const moved = path.join(davRoot, 'vault4-verschoben.kdbx');
        fs.renameSync(f4, moved); // someone moves the file in the Files app
        const movedBytes = fs.readFileSync(moved);
        const p2 = await ctx.newPage();
        watchErrors(p2);
        await p2.goto(url()); await p2.locator('#login-form').waitFor();
        const from = srv.log.length;
        await login('vault4.kdbx', PW, p2);
        await p2.locator('[data-testid=entry-row]').first().waitFor({ timeout: 30000 });
        await statusOf(p2, /Offline-Kopie geöffnet .*nicht mehr auf dem Server/);
        expect(await p2.locator('#readonly-banner').isVisible(), 'Hinweis fehlt');
        expect(/nicht mehr auf dem Server/.test(await p2.locator('#ro-text').innerText()), 'Hinweistext: ' + await p2.locator('#ro-text').innerText());
        expect(await p2.locator('#ro-recreate').isVisible() && await p2.locator('#ro-copy').isVisible(), '"Datei wieder anlegen" und "Kopie speichern" fehlen');
        await p2.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        expect((await p2.locator('[data-testid=f-user]').innerText()).trim() === 'nur-in-der-kopie', 'die Aenderung aus der Offline-Kopie fehlt');
        await p2.waitForTimeout(5000); // syncretry=2: background syncs would have had two goes by now
        const writes = srv.log.slice(from).filter((l) => !/^(GET|PROPFIND|HEAD) /.test(l));
        expect(writes.length === 0, 'ohne Klick zum Server geschickt: ' + writes.join(', '));
        expect(!fs.existsSync(f4), 'die Datei wurde ohne Klick wieder angelegt');
        await p2.click('#ro-recreate');
        await statusOf(p2, /^Die Datei ist wieder auf dem Server/);
        expect(await p2.locator('#readonly-banner').isHidden(), 'Hinweis bleibt nach dem Wiederanlegen');
        await stateOf(p2, 'synced');
        expect(xc(['show', f4, 'Web/Mail']).includes('nur-in-der-kopie'), 'Aenderung fehlt in der wieder angelegten Datei');
        expect(Buffer.compare(movedBytes, fs.readFileSync(moved)) === 0, 'die verschobene Datei wurde angefasst');
        fs.rmSync(moved);
        await p2.close();
    });

    await step('"Lokale Daten loeschen" entfernt Offline-Kopie, App-Cache und Service Worker', async () => {
        await page.goto(url()); await page.locator('#login-form').waitFor();
        await page.click('#login-settings'); await page.click('#wipe-btn'); await page.click('#wipe-btn');
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
