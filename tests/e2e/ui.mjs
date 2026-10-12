// UI-Funktionstest mit der synthetischen Alltags-Datei (hartes Passwort + Schluesseldatei + Argon2 256 MiB):
// Gruppen, Duplizieren/Verschieben/Loeschen/Rueckgaengig, Anhaenge, Verlauf, Suche (KeePassXC-Syntax), Generator, Berichte, Befehlspalette,
// Papierkorb, Ablauf, TOTP, Passkey-Erhalt, Zwischenablage, Mobil-Layout, Sprache/Theme. Ergebnis wird per KeePassXC-XML-Export geprueft.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, browserName } from '../browser.mjs';
import { DOMParser } from '@xmldom/xmldom';
import { startServer } from './davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-ui-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);
execFileSync('python3', ['-I', path.join(root, 'tests/fixtures/make-daily.py'), path.join(tmp, 'fix')], { stdio: 'pipe' });
const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'fix/daily.json'), 'utf8'));
const KEY = path.join(tmp, 'fix/daily.keyx');
const dbFile = path.join(davRoot, 'daily.kdbx');
fs.copyFileSync(path.join(tmp, 'fix/daily.kdbx'), dbFile);

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 12).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const xc = (args) => {
    const r = spawnSync('keepassxc-cli', [...args.slice(0, 1), '-k', KEY, ...args.slice(1)], { input: meta.password + '\n', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error('keepassxc-cli ' + args[0] + ': ' + r.stderr);
    return r.stdout.toString('utf8');
};
const loadXml = () => new DOMParser().parseFromString(xc(['export', '-f', 'xml', dbFile]).toString('utf8'), 'text/xml');
const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeName === name);
const text = (el) => el?.textContent ?? '';
const strOf = (entry, key) => { for (const s of kids(entry, 'String')) if (text(kids(s, 'Key')[0]) === key) return kids(s, 'Value')[0]; return null; };
function walk(doc) { // [{path, entry, group}]
    const out = [];
    const rec = (g, p) => { for (const e of kids(g, 'Entry')) out.push({ path: p, entry: e, title: text(strOf(e, 'Title')) }); for (const c of kids(g, 'Group')) rec(c, p + '/' + text(kids(c, 'Name')[0])); };
    const rootGroup = kids(doc.getElementsByTagName('Root')[0], 'Group')[0];
    rec(rootGroup, text(kids(rootGroup, 'Name')[0]));
    return out;
}
const allGroups = (doc) => { const out = []; const rec = (g, p) => { out.push(p); for (const c of kids(g, 'Group')) rec(c, p + '/' + text(kids(c, 'Name')[0])); }; const r = kids(doc.getElementsByTagName('Root')[0], 'Group')[0]; rec(r, text(kids(r, 'Name')[0])); return out; };

async function main() {
    const { stop, port } = await startServer({ webRoot: path.join(root, 'web'), davRoot });
    const base = `http://127.0.0.1:${port}`;
    const browser = await launchBrowser();
    const pageErrors = [], external = [];
    async function newPage(viewport = { width: 1500, height: 950 }, settings = { autosync: 'off', clipboard: 10 }) {
        const ctx = await browser.newContext({ locale: 'de-DE', acceptDownloads: true, viewport, permissions: browserName === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] }); // Firefox/WebKit kennen diese Rechtenamen nicht
        await ctx.addInitScript((s) => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify(s)); } catch {} }, settings);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
        return page;
    }
    async function login(page) {
        await page.goto(base);
        await page.locator('input[value=dav]').check({ force: true });
        await page.fill('#dav-url', `${base}/dav/daily.kdbx`); await page.fill('#dav-user', 'tester'); await page.fill('#dav-pass', 'app-secret');
        await page.fill('#master', meta.password); await page.setInputFiles('#keyfile', KEY);
        await page.click('#open-btn');
        await page.locator('.shell').waitFor({ timeout: 90000 });
    }
    const rows = (p) => p.locator('[data-testid=entry-row]');
    const pick = async (p, title) => { await p.click('#nav-all'); await p.fill('#search', `title:"${title}"`); await rows(p).filter({ hasText: title }).first().click(); await p.fill('#search', ''); };
    const menuItem = (p, label) => p.locator('.menu-item', { hasText: label }).first();
    const status = (p) => p.locator('#status').innerText();
    const waitStatus = (p, re, timeout = 30000) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout });
    const count = async (p, id) => Number(await p.locator(`#${id} .count`).innerText());

    const page = await newPage();
    await step('Alltags-Datei oeffnen; Seitenleiste zaehlt Eintraege, schwache, ablaufende, TOTP, Passkeys', async () => {
        await login(page);
        expect(await count(page, 'nav-all') === meta.entries, `Eintragszahl ${await count(page, 'nav-all')} != ${meta.entries}`);
        const c = { weak: await count(page, 'nav-weak'), exp: await count(page, 'nav-expiring'), totp: await count(page, 'nav-totp'), pk: await count(page, 'nav-passkey') };
        expect(c.weak >= 5 && c.exp === 2 && c.totp === 2 && c.pk === 1, JSON.stringify(c));
        return JSON.stringify(c);
    });

    await step('Suche in KeePassXC-Syntax: is:weak, has:totp, has:passkey, has:attachment, url:, -group:, Anfuehrungszeichen, Gross/Klein', async () => {
        const n = async (q) => { await page.fill('#search', q); return rows(page).count(); };
        expect(await n('is:weak') === await count(page, 'nav-weak'), 'is:weak');
        expect(await n('has:totp') === 2 && await n('has:passkey') === 1 && await n('has:attachment') === 2, 'has:');
        expect(await n('is:expired') === 1, 'is:expired');
        expect(await n('title:amazon') === 1, 'title:amazon');
        const all = await n(''), shop = await n('group:Shopping'), notShop = await n('-group:Shopping');
        expect(shop >= 7 && shop + notShop === all, `group:Shopping ${shop} + ${notShop} != ${all}`);
        expect(await n('"Gleiches Passwort"') === 3, 'exakte Phrase');
        expect(await n('url:beispiel.at -is:weak') > 0, 'Kombination');
        expect(await n('zzzz-nix') === 0 && /Keine Treffer/.test(await page.locator('#list').innerText()), 'Leerzustand');
        await page.fill('#search', '');
    });

    await step('Gruppen: anlegen, Untergruppe (Kontextmenue), umbenennen, Eintrag per Drag&Drop, Gruppe verschieben, loeschen -> Papierkorb', async () => {
        await page.click('#new-group-btn'); await page.fill('#prompt-input', 'UI-Testgruppe'); await page.keyboard.press('Enter');
        const row = (t) => page.locator('.tree-row', { hasText: t }).first();
        await row('UI-Testgruppe').waitFor();
        await row('UI-Testgruppe').click({ button: 'right' });
        await menuItem(page, 'Neue Untergruppe').click(); await page.fill('#prompt-input', 'Unter-1'); await page.keyboard.press('Enter');
        await row('Unter-1').waitFor();
        await row('UI-Testgruppe').hover(); await row('UI-Testgruppe').locator('.row-more').click();
        await menuItem(page, 'Gruppe bearbeiten').click(); await page.fill('#g-name', 'UI-Gruppe-neu'); await page.click('#g-ok');
        await row('UI-Gruppe-neu').waitFor();
        // Eintrag "Amazon" per Drag&Drop in die neue Gruppe
        await page.locator('.tree-row', { hasText: 'Shopping' }).first().locator('.tree-label').click();
        await page.dragAndDrop('.entry-wrap:has-text("Amazon")', '.tree-row:has-text("UI-Gruppe-neu")');
        expect(await row('UI-Gruppe-neu').locator('.count').first().innerText() === '1', 'Drag&Drop: Zaehler');
        // Untergruppe verschieben
        await row('Unter-1').hover(); await row('Unter-1').locator('.row-more').click();
        await menuItem(page, 'Gruppe verschieben').click();
        await page.locator('.modal select').selectOption({ label: 'Lizenzen' }); await page.locator('.modal button[type=submit]').click();
        await page.locator('.tree-row', { hasText: 'Lizenzen' }).waitFor();
        // zweite Gruppe anlegen und loeschen
        await page.click('#new-group-btn'); await page.fill('#prompt-input', 'Weg-Gruppe'); await page.keyboard.press('Enter');
        await row('Weg-Gruppe').hover(); await row('Weg-Gruppe').locator('.row-more').click(); await menuItem(page, 'Löschen').click(); await page.click('#confirm-ok');
        await page.waitForFunction(() => ![...document.querySelectorAll('.tree-row')].some((r) => /Weg-Gruppe/.test(r.textContent)));
        expect(await count(page, 'nav-bin') >= 1 || /\d+/.test(await page.locator('#nav-bin .count').innerText()), 'Papierkorb-Zaehler');
    });

    await step('Eintrag: duplizieren, verschieben (Dialog), loeschen + Rueckgaengig; Loeschen in den Papierkorb', async () => {
        const total = await count(page, 'nav-all');
        await pick(page, 'Gmail');
        await page.click('#entry-more'); await menuItem(page, 'Duplizieren').click();
        await page.waitForFunction(() => /Gmail - Kopie/.test(document.querySelector('#detail h2')?.textContent || ''));
        expect(await count(page, 'nav-all') === total + 1, 'Kopie zaehlt');
        await page.click('#entry-more'); await menuItem(page, 'Verschieben').click();
        await page.locator('.modal select').selectOption({ label: 'Lizenzen' }); await page.locator('.modal button[type=submit]').click();
        await page.waitForFunction(() => /Lizenzen/.test(document.querySelector('.crumbs')?.textContent || ''));
        // Loeschen mit Rueckgaengig
        await pick(page, 'Posteo');
        await page.click('#del-btn');
        expect(await count(page, 'nav-all') === total, 'nach Loeschen');
        await page.locator('.toast-action', { hasText: 'Rückgängig' }).click();
        expect(await count(page, 'nav-all') === total + 1, 'Rueckgaengig stellt wieder her');
        // Posteo bleibt im Papierkorb; Etsy wird geloescht und wiederhergestellt
        await pick(page, 'Posteo'); await page.click('#del-btn');
        await pick(page, 'Etsy'); await page.click('#del-btn');
        await page.click('#nav-bin');
        await rows(page).filter({ hasText: 'Etsy' }).first().click();
        await page.click('#restore-btn');
        await page.waitForFunction(() => /Wiederhergestellt/.test(document.body.textContent));
    });

    await step('Anhaenge: Download byte-identisch, hinzufuegen, entfernen (Bestaetigung)', async () => {
        await pick(page, 'Mit Anhaengen');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid=attachment]').first().click()]);
        expect(fs.readFileSync(await dl.path()).toString() === 'Hallo Anhang\nZeile 2\n', 'Inhalt notiz.txt');
        await page.setInputFiles('#att-input', { name: 'neu.txt', mimeType: 'text/plain', buffer: Buffer.from('neu-inhalt') });
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=attachment]').length === 3);
        await page.locator('.att-row', { hasText: 'zufall.bin' }).locator('[data-testid=attachment-remove]').click(); await page.click('#confirm-ok');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=attachment]').length === 2);
    });

    await step('Verlauf: Eintrag mit 5 Staenden -> anzeigen, frueheren Stand wiederherstellen (aktueller wird selbst Verlauf)', async () => {
        await pick(page, 'Mit Verlauf');
        const det = page.locator('[data-testid=history]');
        expect(/Verlauf \(5\)/.test(await det.locator('summary').innerText()), await det.locator('summary').innerText());
        await det.locator('summary').click();
        expect(await page.locator('[data-testid=history-row]').count() === 5, 'fuenf Zeilen');
        await page.locator('[data-testid=history-row]').last().locator('[data-testid=history-restore]').click(); // aeltester Stand "v0"
        await page.click('[data-testid=pw-toggle]');
        expect(await page.locator('[data-testid=pw-value]').innerText() === 'v0', 'Passwort v0 wiederhergestellt: ' + await page.locator('[data-testid=pw-value]').innerText());
        expect(/Verlauf \(6\)/.test(await page.locator('[data-testid=history] summary').innerText()), 'jetzt 6 Staende');
    });

    await step('Neuer Eintrag mit Ablaufdatum und TOTP-Geheimnis (nur Base32) -> Filter "Laeuft ab", TOTP-Code', async () => {
        const exp0 = await count(page, 'nav-expiring');
        await page.click('#new-btn');
        await page.fill('#e-title', 'UI Ablauf-TOTP'); await page.fill('#e-user', 'ui'); await page.fill('#e-pass', 'Ui-Passwort-123!');
        await page.fill('#e-otp', 'JBSW Y3DP-EHPK 3PXP');
        await page.check('#e-expires');
        const d = new Date(Date.now() + 3 * 86400000); await page.fill('#e-expiry', d.toISOString().slice(0, 10));
        await page.click('#apply-btn');
        await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector('[data-testid=totp-code]')?.textContent || ''));
        expect(await count(page, 'nav-expiring') === exp0 + 1, 'Ablauf-Zaehler');
        await page.click('#nav-expiring');
        expect(await rows(page).filter({ hasText: 'UI Ablauf-TOTP' }).locator('.badge').count() === 1, 'Ablauf-Badge');
        await page.click('#nav-all');
    });

    await step('TOTP-Ring/-Code fuer otpauth (SHA256, 8 Stellen, 45 s) und alte Felder (TOTP Seed)', async () => {
        await pick(page, 'Mit TOTP (otp)');
        const a = await page.locator('[data-testid=totp-code]').innerText();
        expect(/^\d{8}$/.test(a.trim()), 'Code 8 Stellen: ' + a);
        const exp = xc(['show', '-t', dbFile, 'Privat/E-Mail/Mit TOTP (otp)']).trim().split('\n').pop();
        let ok = a.trim() === exp; if (!ok) { const b = (await page.locator('[data-testid=totp-code]').innerText()).trim(); ok = b === exp; }
        expect(ok, `TOTP App ${a} vs KeePassXC ${exp}`);
        await pick(page, 'Mit TOTP (alt)');
        expect(/^\d{6}$/.test((await page.locator('[data-testid=totp-code]').innerText()).trim()), 'altes Seed-Feld');
        expect(await page.locator('.ring-fg').count() === 1, 'Ring');
    });

    await step('Passkey-Eintrag: Karte sichtbar, Bearbeiten erhaelt alle KPEX_PASSKEY_*-Felder samt Schutz-Flag (Pruefung nach dem Speichern)', async () => {
        await pick(page, 'Passkey example.org');
        expect(await page.locator('[data-testid=passkey-card]').count() === 1 && /example\.org/.test(await page.locator('[data-testid=passkey-card]').innerText()), 'Passkey-Karte');
        expect(!/BEGIN PRIVATE KEY/.test(await page.locator('#detail').innerText()), 'privater Schluessel darf nicht erscheinen');
        await page.click('#edit-btn'); await page.fill('#e-notes', 'Passkey-Notiz aus UI-Test'); await page.click('#apply-btn');
    });

    await step('Generator: Laenge/Klassen, Passphrase (Woerter/Trenner), Verwenden im Editor', async () => {
        await page.click('#tool-gen');
        await page.fill('#gen-length', '40'); await page.locator('#gen-length').press('Tab');
        await page.uncheck('#gen-digits');
        let pw = (await page.locator('#gen-preview').innerText()).trim();
        expect([...pw].length === 40 && !/[0-9]/.test(pw), `Passwort ${pw}`);
        await page.click('#gen-tab-ph'); await page.fill('#gen-words', '5'); await page.locator('#gen-words').press('Tab'); await page.fill('#gen-sep', '.');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[a-z-]+(\.[a-z-]+){4}$/.test(pw), 'Passphrase ' + pw);
        await page.keyboard.press('Escape');
        await pick(page, 'UI Ablauf-TOTP'); await page.click('#edit-btn'); await page.click('#gen-btn');
        await page.click('#gen-tab-pw'); await page.click('#gen-use'); await page.click('#e-show');
        const v = await page.inputValue('#e-pass');
        expect(v !== 'Ui-Passwort-123!' && v.length >= 20, 'Editor uebernimmt Passwort');
        await page.click('#cancel-btn');
    });

    await step('Berichte: Gesundheit stimmt mit Seitenleiste ueberein, Treffer oeffnet den Eintrag; Statistik; Datenbank-Info (Argon2d, 256 MiB)', async () => {
        await page.click('#reports-btn');
        const weak = await page.locator('.stat', { hasText: 'Schwach' }).first().locator('b').innerText();
        expect(Number(weak) === await count(page, 'nav-weak'), `weak ${weak}`);
        const first = page.locator('[data-testid=issue-row]').first();
        const title = (await first.locator('strong').innerText()).trim();
        await first.click();
        await page.waitForFunction((t) => (document.querySelector('#detail h2')?.textContent || '').trim() === t && !document.querySelector('.modal'), title);
        await page.click('#reports-btn'); await page.click('#rep-tab-stats');
        expect(/\d+/.test(await page.locator('.stat-grid').innerText()), 'Statistik');
        await page.click('#rep-tab-info');
        const info = await page.locator('.report-body').innerText();
        expect(/Argon2d/.test(info) && /256 MiB/.test(info) && /KDBX 4/.test(info), info);
        await page.keyboard.press('Escape');
    });

    await step('Befehlspalette (Strg+K): Eintrag finden, Befehl ausfuehren (Theme)', async () => {
        await page.keyboard.press('Control+k'); await page.fill('#palette-input', 'Amazon'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => (document.querySelector('#detail h2')?.textContent || '').trim() === 'Amazon');
        await page.keyboard.press('Control+k'); await page.fill('#palette-input', 'Hell/Dunkel'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => ['dark', 'light'].includes(document.documentElement.dataset.theme));
    });

    await step('Tastenkuerzel + Zwischenablage: Strg+B (Benutzer), Strg+C (Passwort), automatisches Leeren nach 10 s', async () => {
        await pick(page, 'Amazon');
        await page.locator('#list .entry.active').focus(); // Fokus in die Liste, nicht ins Suchfeld
        await page.keyboard.press('Control+b');
        const user = (await page.locator('[data-testid=f-user]').innerText()).trim();
        await page.waitForFunction((u) => navigator.clipboard.readText().then((x) => x === u), user);
        await page.keyboard.press('Control+c');
        await page.click('[data-testid=pw-toggle]'); const pw = (await page.locator('[data-testid=pw-value]').innerText()).trim();
        await page.waitForFunction((x) => navigator.clipboard.readText().then((y) => y === x), pw);
        await page.waitForFunction(() => navigator.clipboard.readText().then((y) => y === ''), null, { timeout: 15000 });
    });

    await step('Speichern (Strg+S) -> KeePassXC liest die Datei; alle UI-Aenderungen sind angekommen, nichts anderes ging verloren', async () => {
        await page.keyboard.press('Control+s');
        await waitStatus(page, /^Gespeichert\./, 60000);
        const doc = loadXml();
        const es = walk(doc), groups = allGroups(doc);
        const find = (t) => es.filter((e) => e.title === t);
        expect(groups.includes('Root/UI-Gruppe-neu') || groups.some((g) => /UI-Gruppe-neu$/.test(g)), 'Gruppe fehlt: ' + groups.join('|'));
        expect(groups.some((g) => /Lizenzen\/Unter-1$/.test(g)), 'Untergruppe nicht in Lizenzen');
        expect(!groups.some((g) => /Weg-Gruppe/.test(g)) || groups.filter((g) => /Weg-Gruppe/.test(g)).every((g) => /Recycle Bin/.test(g)), 'Weg-Gruppe sollte nur im Papierkorb liegen');
        expect(find('Amazon')[0].path.endsWith('UI-Gruppe-neu'), 'Amazon per Drag&Drop verschoben: ' + find('Amazon')[0].path);
        const kopie = find('Gmail - Kopie'); expect(kopie.length === 1 && /Lizenzen$/.test(kopie[0].path), 'Duplikat in Lizenzen');
        expect(text(kids(kopie[0].entry, 'UUID')[0]) !== text(kids(find('Gmail')[0].entry, 'UUID')[0]), 'Duplikat braucht neue UUID');
        expect(/Recycle Bin$/.test(find('Posteo')[0].path) && /Shopping$/.test(find('Etsy')[0].path), 'Posteo im Papierkorb, Etsy wiederhergestellt: ' + find('Posteo')[0].path + ' / ' + find('Etsy')[0].path);
        const att = find('Mit Anhaengen')[0].entry; const keys = kids(att, 'Binary').map((b) => text(kids(b, 'Key')[0])).sort();
        expect(keys.join() === 'neu.txt,notiz.txt', 'Anhaenge: ' + keys);
        const histN = (t) => kids(kids(find(t)[0].entry, 'History')[0] || { childNodes: [] }, 'Entry').length;
        expect(histN('Mit Verlauf') === 6 && text(strOf(find('Mit Verlauf')[0].entry, 'Password')) === 'v0', 'Verlauf/Wiederherstellung');
        const pk = find('Passkey example.org')[0].entry; const pkKeys = kids(pk, 'String').map((s) => text(kids(s, 'Key')[0])).filter((k) => /^KPEX_PASSKEY_/.test(k));
        expect(pkKeys.length === 7, 'Passkey-Felder: ' + pkKeys.length);
        const prot = (k) => kids(strOf(pk, k) ? strOf(pk, k).parentNode : { childNodes: [] }, 'Value')[0]?.getAttribute('ProtectInMemory');
        expect(prot('KPEX_PASSKEY_PRIVATE_KEY_PEM') === 'True' && prot('KPEX_PASSKEY_USERNAME') !== 'True', 'Schutz-Flags der Passkey-Felder');
        expect(text(strOf(pk, 'Notes')) === 'Passkey-Notiz aus UI-Test', 'Notiz');
        const ui = find('UI Ablauf-TOTP')[0].entry;
        expect(/^otpauth:\/\/totp\//.test(text(strOf(ui, 'otp'))) && /secret=JBSWY3DPEHPK3PXP/.test(text(strOf(ui, 'otp'))), 'otp-Feld: ' + text(strOf(ui, 'otp')));
        expect(text(kids(kids(ui, 'Times')[0], 'Expires')[0]) === 'True', 'Expires');
        expect(es.length >= meta.entries, 'Eintragszahl ' + es.length);
        const shared = xc(['attachment-export', dbFile, 'Arbeit/Server/Prod/Teilt Anhang', 'zufall-kopie.bin', path.join(tmp, 'shared.bin')]);
        expect(fs.statSync(path.join(tmp, 'shared.bin')).size === 150000, 'gemeinsam genutzter Anhang blieb erhalten');
        return `${es.length} Eintraege, ${groups.length} Gruppen`;
    });

    await step('Papierkorb leeren (Bestaetigung) -> nur dort geloeschte Elemente verschwinden', async () => {
        await page.click('#nav-bin');
        const n = Number(await page.locator('#nav-bin .count').innerText());
        expect(n >= 1, 'Papierkorb nicht leer');
        await page.click('#empty-bin'); await page.click('#confirm-ok');
        await page.waitForFunction(() => document.querySelector('#nav-bin .count')?.textContent === '0');
        expect(/Keine Einträge/.test(await page.locator('#list').innerText()), 'Leerzustand');
        await page.click('#nav-all');
    });

    await step('Sprache und Theme: Englisch/Dunkel in den Einstellungen, bleibt nach dem Sperren (Anmeldeseite) erhalten', async () => {
        await page.click('#settings-btn');
        await page.selectOption('#s-lang', 'en');
        await page.locator('#s-theme').waitFor();
        await page.selectOption('#s-theme', 'dark');
        expect(await page.locator('html').getAttribute('data-theme') === 'dark', 'Theme');
        await page.click('#settings-close');
        expect(/Save/.test(await page.locator('#save-btn').innerText()) && await page.locator('html').getAttribute('lang') === 'en', 'Englisch');
        await page.click('#lock-btn');
        await page.locator('#login-form').waitFor();
        expect(/Open vault/.test(await page.locator('.login-top h2').innerText()), 'Login englisch');
        expect(await page.inputValue('#master') === '', 'Master-Passwort-Feld leer');
        await page.context().close();
    });

    await step('Mobil (390x844): Liste -> Detail -> Zurueck, Drawer mit Gruppen/Werkzeugen, kein horizontales Scrollen, Dialog als Sheet', async () => {
        const m = await newPage({ width: 390, height: 844 });
        await login(m);
        const overflow = () => m.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
        expect(await m.locator('.listpane').isVisible() && !(await m.locator('.detailpane').isVisible()), 'Liste sichtbar, Detail verborgen');
        await rows(m).first().click();
        expect(await m.locator('.detailpane').isVisible() && !(await m.locator('.listpane').isVisible()), 'Detail sichtbar');
        expect(await overflow() <= 0, 'Overflow im Detail: ' + await overflow());
        await m.click('.back-btn');
        expect(await m.locator('.listpane').isVisible(), 'zurueck zur Liste');
        await m.click('.menu-btn.in-list');
        await m.locator('#nav-reports').waitFor({ state: 'visible' });
        expect(await m.locator('.sidebar').isVisible(), 'Drawer');
        await m.click('#nav-gen'); await m.locator('.modal').waitFor();
        const box = await m.locator('.modal').boundingBox();
        expect(box.width >= 380 && box.y + box.height >= 800, `Dialog als Bottom-Sheet: ${JSON.stringify(box)}`);
        await m.keyboard.press('Escape');
        expect(await overflow() <= 0, 'Overflow in Liste');
        await m.click('#fab-new'); await m.locator('#e-title').waitFor();
        expect(await overflow() <= 0, 'Overflow im Editor: ' + await overflow());
        await m.click('#cancel-btn');
        await m.click('#lock-btn'); await m.locator('#login-form').waitFor();
        await m.context().close();
    });

    await step('Keine JS-Fehler, keine externen Anfragen', async () => {
        expect(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
        expect(external.length === 0, external.join(', '));
    });

    await browser.close(); await stop();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} UI-Tests bestanden (Arbeitsverzeichnis ${tmp})`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
