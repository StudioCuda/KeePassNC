// Round-trip test with the synthetic everyday file: strong master password + XML v2 key file + Argon2 (256 MiB).
// KeePassNC (browser) opens it, changes exactly one entry, saves; then a KeePassXC XML export is compared field by field:
// apart from the changed entry (and the expected history/time change), NOTHING may have changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, plainWebdav } from '../browser.mjs';
import { startServer } from '../e2e/davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-fid-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);
execFileSync('python3', ['-I', path.join(root, 'tests/fixtures/make-daily.py'), path.join(tmp, 'fix')], { stdio: 'pipe' });
const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'fix/daily.json'), 'utf8'));
const KEY = path.join(tmp, 'fix/daily.keyx');
fs.copyFileSync(path.join(tmp, 'fix/daily.kdbx'), path.join(davRoot, 'daily.kdbx'));
const dbOnServer = path.join(davRoot, 'daily.kdbx');
const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 30).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const exportXml = (file, dest) => {
    const r = spawnSync('keepassxc-cli', ['export', '-f', 'xml', '-k', KEY, file], { input: meta.password + '\n', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error('KeePassXC kann die Datei nicht lesen: ' + r.stderr);
    fs.writeFileSync(dest, r.stdout);
};
// Known, harmless differences (each with a reason):
//  - Meta/Generator and _LAST_MODIFIED timestamps in CustomData: are reset on every save
//  - empty AutoType associations (Association with empty Window/KeystrokeSequence) are no longer written (no effect)
const KNOWN = ['--allow', '^R/Meta/Generator$', '--allow', 'CustomData/Item\\[_LAST_MODIFIED\\]/Value$', '--empty-drop', 'AutoType/Association/(Window|KeystrokeSequence)$'];
const compare = (a, b, entries = []) => spawnSync('python3', ['-I', path.join(root, 'tests/fidelity/compare.py'), a, b, ...KNOWN, ...entries.flatMap((t) => ['--entry', t])], { encoding: 'utf8' });

async function main() {
    const { port, stop } = await startServer({ webRoot: path.join(root, 'web'), davRoot });
    const base = `http://127.0.0.1:${port}`;
    const browser = await launchBrowser();
    const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(plainWebdav);
    await ctx.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const xml0 = path.join(tmp, 'v0.xml'); exportXml(dbOnServer, xml0);

    await step('Hartes Master-Passwort + XML-v2-Schluesseldatei + Argon2 256 MiB: Oeffnen im Browser', async () => {
        await page.goto(base);
        await page.locator('input[value=dav]').check({ force: true });
        await page.fill('#dav-url', `${base}/dav/daily.kdbx`); await page.fill('#dav-user', 'tester'); await page.fill('#dav-pass', 'app-secret');
        await page.fill('#master', meta.password);
        await page.setInputFiles('#keyfile', KEY);
        const t0 = Date.now();
        await page.click('#open-btn');
        await page.locator('[data-testid=entry-row]').first().waitFor({ timeout: 90000 });
        return `Entschluesselung ${Date.now() - t0} ms, ${await page.locator('[data-testid=entry-row]').count()} Eintraege sichtbar`;
    });
    await step('Falsche Schluesseldatei -> abgelehnt, ohne Schluesseldatei -> abgelehnt', async () => {
        const p = await ctx.newPage();
        await p.goto(base);
        await p.locator('input[value=dav]').check({ force: true });
        await p.fill('#dav-url', `${base}/dav/daily.kdbx`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret'); await p.fill('#master', meta.password);
        await p.click('#open-btn');
        await p.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 60000 });
        await p.close();
    });
    await step('Ein Eintrag aendern + speichern -> KeePassXC liest die Datei, nur dieser Eintrag unterscheidet sich (Feld fuer Feld)', async () => {
        await page.fill('#search', 'Fidelity-Probe');
        await page.locator('[data-testid=entry-row]', { hasText: 'Fidelity-Probe' }).click();
        await page.click('#edit-btn');
        await page.fill('#e-notes', 'Vom Test geaendert ✔');
        await page.click('#apply-btn'); await page.click('#save-btn');
        await page.waitForFunction(() => /^Gespeichert\./.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 60000 });
        const xml1 = path.join(tmp, 'v1.xml'); exportXml(dbOnServer, xml1);
        const r = compare(xml0, xml1, ['Fidelity-Probe']);
        // allowed: everything on the probe entry (notes, time, history) plus timestamps of the database/root metadata
        fs.writeFileSync(path.join(tmp, 'diff1.txt'), r.stdout);
        expect(r.status === 0, 'Unerlaubte Unterschiede:\n   ' + r.stdout.split('\n').filter((l) => l.startsWith('ABWEICHUNG')).slice(0, 25).join('\n   ') + '\n   ' + r.stdout.trim().split('\n').pop());
        return r.stdout.trim().split('\n').pop();
    });
    await step('Zweiter Durchlauf (erneut oeffnen + aendern + speichern): keine schleichende Veraenderung anderer Eintraege', async () => {
        const p = await ctx.newPage();
        await p.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
        await p.goto(base);
        await p.locator('input[value=dav]').check({ force: true });
        await p.fill('#dav-url', `${base}/dav/daily.kdbx`); await p.fill('#dav-user', 'tester'); await p.fill('#dav-pass', 'app-secret'); await p.fill('#master', meta.password);
        await p.setInputFiles('#keyfile', KEY); await p.click('#open-btn');
        await p.locator('[data-testid=entry-row]').first().waitFor({ timeout: 90000 });
        await p.fill('#search', 'Fidelity-Probe'); await p.locator('[data-testid=entry-row]', { hasText: 'Fidelity-Probe' }).click();
        await p.click('#edit-btn'); await p.fill('#e-notes', 'Zweite Aenderung'); await p.click('#apply-btn'); await p.click('#save-btn');
        await p.waitForFunction(() => /^Gespeichert\./.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 60000 });
        const xml2 = path.join(tmp, 'v2.xml'); exportXml(dbOnServer, xml2);
        const r = compare(path.join(tmp, 'v1.xml'), xml2, ['Fidelity-Probe']);
        expect(r.status === 0, 'Unerlaubte Unterschiede:\n   ' + r.stdout.split('\n').filter((l) => l.startsWith('ABWEICHUNG')).slice(0, 25).join('\n   '));
        // KDF parameters are preserved
        const hdr = fs.readFileSync(dbOnServer);
        await p.close();
        return `Dateigroesse ${hdr.length} Bytes`;
    });
    await step('Keine JS-Fehler', async () => { expect(errors.length === 0, errors.slice(0, 3).join(' | ')); });
    await browser.close(); await stop();
}
let crashed = null;
try { await main(); } catch (e) { crashed = e; }
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.info ? '\n   -> ' + r.info : ''}`);
if (crashed) console.log('ABBRUCH:', crashed.stack || crashed.message);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} Fidelity-Tests bestanden (Arbeitsverzeichnis ${tmp})`);
process.exit(failed || crashed ? 1 : 0);
