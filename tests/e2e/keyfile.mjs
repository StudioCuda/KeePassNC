// Test "remember key file": opt-in, reuse only with the right master password, nothing in plain text in IndexedDB, forgetting/deleting, tampering.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, waitOpened, plainWebdav } from '../browser.mjs';
import { startServer } from './davserver.mjs';
import { createKeyfileStore, limits as kfLimits } from '../../src/keyfile-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-kf-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);
execFileSync('python3', ['-I', path.join(root, 'tests/fixtures/make-daily.py'), path.join(tmp, 'fix')], { stdio: 'pipe' });
const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'fix/daily.json'), 'utf8'));
const KEY = path.join(tmp, 'fix/daily.keyx');
const KEY_TEXT = fs.readFileSync(KEY, 'utf8');
fs.copyFileSync(path.join(tmp, 'fix/daily.kdbx'), path.join(davRoot, 'daily.kdbx'));

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
    const mkCtx = async () => { const c = await browser.newContext({ locale: 'de-DE' }); await c.addInitScript(plainWebdav); await c.addInitScript(() => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} }); return c; };
    const fillLogin = async (p, { master = meta.password, withKey = false, remember = false } = {}) => {
        await p.goto(base);
        await p.locator('input[value=dav]').check({ force: true });
        await p.fill('#dav-url', `${base}/dav/daily.kdbx`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret');
        await p.fill('#master', master);
        if (withKey) { await p.setInputFiles('#keyfile', KEY); if (remember) await p.check('#kf-remember'); }
    };
    const idb = (p) => p.evaluate(async () => new Promise((res) => {
        const plain = (v) => (v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)) : ArrayBuffer.isView(v) ? Array.from(v) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
        const r = indexedDB.open('keepassnc');
        r.onsuccess = () => {
            if (!r.result.objectStoreNames.contains('files')) return res({});
            const s = r.result.transaction('files').objectStore('files'); const k = s.getAllKeys();
            k.onsuccess = () => { const out = {}; const g = s.getAll(); g.onsuccess = () => { k.result.forEach((key, i) => { out[key] = plain(g.result[i]); }); res(out); }; };
        };
        r.onerror = () => res({});
    }));
    const kfRecords = async (p) => Object.entries(await idb(p)).filter(([k]) => k.startsWith('kf:'));

    const ctx1 = await mkCtx(); const p1 = await ctx1.newPage(); p1.on('pageerror', (e) => errors.push(String(e)));
    await step('Standard: nichts wird gemerkt (Opt-in); Checkbox erscheint erst nach Wahl einer Schluesseldatei und ist aus', async () => {
        await p1.goto(base);
        expect(!(await p1.locator('#kf-remember').isVisible()), 'Checkbox vor Dateiwahl sichtbar');
        await p1.setInputFiles('#keyfile', KEY);
        expect(await p1.locator('#kf-remember').isVisible() && !(await p1.locator('#kf-remember').isChecked()), 'Checkbox muss sichtbar und AUS sein');
        await fillLogin(p1, { withKey: true });
        await p1.click('#open-btn'); await waitOpened(p1, 90000);
        expect((await kfRecords(p1)).length === 0, 'ohne Opt-in darf nichts gespeichert werden');
        await p1.click('#lock-btn');
        await p1.locator('#login-form').waitFor();
    });

    await step('Opt-in: Datei merken -> Datensatz verschluesselt in IndexedDB (kein Klartext, kein Master-Passwort), Status meldet es', async () => {
        await fillLogin(p1, { withKey: true, remember: true });
        await p1.click('#open-btn'); await waitOpened(p1, 120000);
        expect(/gemerkt/.test(await p1.locator('#status').innerText()), 'Status: ' + await p1.locator('#status').innerText());
        const recs = await kfRecords(p1);
        expect(recs.length === 1, 'ein Datensatz erwartet');
        const [key, rec] = recs[0];
        expect(rec.format === 'kpnc-keyfile-v1' && rec.kdf.alg === 'argon2id' && rec.kdf.memoryKiB >= 65536 && rec.kdf.iterations >= 3, JSON.stringify({ f: rec.format, k: { ...rec.kdf, salt: undefined } }));
        const asText = Buffer.from(rec.ct).toString('latin1');
        expect(!asText.includes('<KeyFile') && !asText.includes(meta.password) && rec.ct.length === Buffer.byteLength(KEY_TEXT) + 16, `Chiffrat-Laenge ${rec.ct.length} vs Klartext ${Buffer.byteLength(KEY_TEXT)}+16`);
        expect(!JSON.stringify(rec).includes(meta.password) && rec.iv.length === 12 && rec.kdf.salt.length === 16, 'IV/Salz-Laenge oder Passwort im Datensatz');
        return `${key}, Argon2id ${rec.kdf.memoryKiB / 1024} MiB / ${rec.kdf.iterations} Durchlaeufe`;
    });

    await step('Wiederverwenden: ohne Datei-Auswahl, nur mit Master-Passwort -> Datenbank oeffnet', async () => {
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        await fillLogin(p1);
        await p1.locator('#kf-remembered').waitFor({ state: 'visible' });
        expect(/daily\.keyx/.test(await p1.locator('#kf-remembered').innerText()), 'Name der gemerkten Datei angezeigt');
        await p1.click('#open-btn'); await waitOpened(p1, 120000);
        expect(await p1.locator('[data-testid=entry-row]').count() > 100, 'Eintraege sichtbar');
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
    });

    await step('Falsches Master-Passwort mit gemerkter Datei -> abgelehnt (Fehlermeldung, kein Oeffnen, Datensatz bleibt)', async () => {
        await fillLogin(p1, { master: meta.password + 'x' });
        await p1.click('#open-btn');
        await p1.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 60000 });
        expect(!(await p1.locator('.shell').count()), 'darf nicht geoeffnet sein');
        expect((await kfRecords(p1)).length === 1, 'Datensatz soll bleiben');
    });

    await step('Manipulierter Datensatz (Chiffrat veraendert) -> Fehlermeldung, kein Oeffnen', async () => {
        await p1.evaluate(async () => new Promise((res) => { const r = indexedDB.open('keepassnc'); r.onsuccess = () => { const tx = r.result.transaction('files', 'readwrite'); const s = tx.objectStore('files'); s.openCursor().onsuccess = (e) => { const c = e.target.result; if (!c) return; if (String(c.key).startsWith('kf:')) { const v = c.value; const u = new Uint8Array(v.ct); u[0] ^= 1; v.ct = u.buffer; c.update(v); } c.continue(); }; tx.oncomplete = () => res(); }; }));
        await fillLogin(p1); await p1.click('#open-btn');
        await p1.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 60000 });
        expect(!(await p1.locator('.shell').count()), 'darf nicht geoeffnet sein');
    });

    await step('Vergessen: Link in der Anmeldung entfernt den Datensatz; danach ohne Datei kein Oeffnen mehr (Schluesseldatei fehlt)', async () => {
        await fillLogin(p1); await p1.locator('#kf-remembered').waitFor({ state: 'visible' });
        await p1.click('#kf-forget');
        await p1.locator('#kf-remembered').waitFor({ state: 'hidden' });
        expect((await kfRecords(p1)).length === 0, 'Datensatz muss weg sein');
        await p1.fill('#master', meta.password); await p1.click('#open-btn');
        await p1.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 60000 });
    });

    await step('Einstellungen listen gemerkte Dateien; "Alle vergessen" und "Lokale Daten loeschen" entfernen sie', async () => {
        await fillLogin(p1, { withKey: true, remember: true }); await p1.click('#open-btn'); await waitOpened(p1, 120000);
        await p1.click('#settings-btn');
        await p1.locator('[data-testid=kf-forget]').first().waitFor();
        expect(await p1.locator('#kf-list').innerText().then((x) => /daily\.keyx/.test(x)), 'Liste zeigt Datei');
        await p1.click('#kf-forget-all');
        await p1.waitForFunction(() => /keine Schl/i.test(document.querySelector('#kf-list')?.textContent || ''));
        await p1.click('#settings-close'); await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        // remember again, then wipe the local data
        await fillLogin(p1, { withKey: true, remember: true }); await p1.click('#open-btn'); await waitOpened(p1, 120000);
        expect((await kfRecords(p1)).length === 1, 'wieder gemerkt');
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        await p1.click('#login-settings'); await p1.click('#wipe-btn'); await p1.click('#wipe-btn');
        await p1.waitForFunction(() => /gelöscht/.test(document.querySelector('#login-error')?.textContent || ''));
        expect((await kfRecords(p1)).length === 0, 'Wipe entfernt Datensatz');
    });

    await step('Eingaben waehrend des Oeffnens geaendert: Datensatz gilt fuer die beim Absenden gewaehlte Datei/Schluesseldatei', async () => {
        await fillLogin(p1, { withKey: true, remember: true });
        await p1.click('#open-btn');
        await p1.fill('#dav-url', `${base}/dav/andere.kdbx`); // during download/KDF
        await p1.setInputFiles('#keyfile', []);
        await waitOpened(p1, 120000);
        const recs = await kfRecords(p1);
        expect(recs.length === 1 && recs[0][0] === `kf:dav:${base}/dav/daily.kdbx` && recs[0][1].name === 'daily.keyx', 'Datensatz: ' + recs.map(([k, r]) => k + '=' + r.name).join(','));
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        await p1.click('#login-settings'); await p1.click('#wipe-btn'); await p1.click('#wipe-btn');
        await p1.waitForFunction(() => /gelöscht/.test(document.querySelector('#login-error')?.textContent || ''));
    });

    await step('Lokale Datei: gemerkt unter file:<Name>; falsches Passwort meldet moegliche Namensgleichheit; KDF-Kosten >= Datenbank', async () => {
        await p1.goto(base);
        await p1.locator('input[value=file]').check({ force: true });
        await p1.setInputFiles('#local-file', path.join(davRoot, 'daily.kdbx'));
        await p1.fill('#master', meta.password); await p1.setInputFiles('#keyfile', KEY); await p1.check('#kf-remember');
        await p1.click('#open-btn'); await waitOpened(p1, 120000);
        const recs = await kfRecords(p1);
        expect(recs.length === 1 && recs[0][0] === 'kf:file:daily.kdbx', 'Kennung: ' + recs.map(([k]) => k));
        const info = await p1.evaluate(() => document.querySelector('#status')?.textContent || '');
        const k = recs[0][1].kdf;
        expect(k.memoryKiB * k.iterations >= 256 * 1024 * 8, `Datensatz ${k.memoryKiB / 1024} MiB / ${k.iterations} schwaecher als Datenbank (256 MiB / 8)`);
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        await p1.locator('input[value=file]').check({ force: true });
        await p1.setInputFiles('#local-file', path.join(davRoot, 'daily.kdbx'));
        await p1.locator('#kf-remembered').waitFor({ state: 'visible' });
        await p1.fill('#master', 'falsch'); await p1.click('#open-btn');
        await p1.waitForFunction(() => /anderen Datei mit demselben Namen/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 60000 });
        await p1.click('#kf-forget'); await p1.locator('#kf-remembered').waitFor({ state: 'hidden' });
        return info.slice(0, 80);
    });

    await step('Aelterer, schwaecherer Datensatz (8 MiB / 1) wird nach erfolgreichem Oeffnen mit Datenbank-Kosten neu verschluesselt', async () => {
        // Record like from an older version: created in Node with the real module, but with deliberately weak parameters
        const saved = { ...kfLimits }; kfLimits.minMemoryKiB = 8192; kfLimits.minIterations = 1;
        let rec;
        const id = `dav:${base}/dav/daily.kdbx`;
        await createKeyfileStore({ put: async (k, v) => { rec = v; } }).remember({ id, name: 'daily.keyx', keyfile: new Uint8Array(fs.readFileSync(KEY)), password: meta.password, params: { kdf: 'Argon2id', memoryKiB: 8192, iterations: 1 } });
        Object.assign(kfLimits, saved);
        const plain = { ...rec, kdf: { ...rec.kdf, salt: [...rec.kdf.salt] }, iv: [...rec.iv], ct: [...new Uint8Array(rec.ct)] };
        await p1.goto(base);
        await p1.evaluate(async ({ key, r }) => new Promise((res, rej) => {
            const o = indexedDB.open('keepassnc', 1);
            o.onupgradeneeded = () => o.result.createObjectStore('files');
            o.onsuccess = () => { const tx = o.result.transaction('files', 'readwrite'); tx.objectStore('files').put({ ...r, kdf: { ...r.kdf, salt: new Uint8Array(r.kdf.salt) }, iv: new Uint8Array(r.iv), ct: new Uint8Array(r.ct).buffer }, key); tx.oncomplete = () => { o.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
        }), { key: 'kf:' + id, r: plain });
        await fillLogin(p1);
        await p1.locator('#kf-remembered').waitFor({ state: 'visible' });
        await p1.click('#open-btn'); await waitOpened(p1, 120000);
        let k;
        for (let i = 0; i < 60; i++) { k = (await kfRecords(p1))[0]?.[1]?.kdf; if (k && k.memoryKiB !== 8192) break; await p1.waitForTimeout(500); }
        expect(k && k.memoryKiB === 256 * 1024 && k.iterations === 8, 'nicht aufgewertet: ' + JSON.stringify({ ...k, salt: undefined }));
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        await fillLogin(p1); await p1.click('#open-btn'); await waitOpened(p1, 120000); // upgraded record works
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        await p1.click('#kf-forget'); await p1.locator('#kf-remembered').waitFor({ state: 'hidden' });
        return '8 MiB / 1 -> 256 MiB / 8';
    });

    await step('Anderes Browserprofil (neuer Kontext) sieht nichts; keine JS-Fehler', async () => {
        const c2 = await mkCtx(); const p2 = await c2.newPage();
        await p2.goto(base);
        expect((await kfRecords(p2)).length === 0 && !(await p2.locator('#kf-remembered').isVisible()), 'frisches Profil darf nichts gemerkt haben');
        expect(errors.length === 0, errors.join(' | '));
        await c2.close();
    });

    await browser.close(); await stop();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} Schluesseldatei-Tests bestanden`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
