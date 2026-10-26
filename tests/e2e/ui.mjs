// UI functional test with the synthetic everyday file (hard password + key file + Argon2 256 MiB):
// groups, duplicate/move/delete/undo, attachments, history, search (KeePassXC syntax), generator, database dialog, command palette,
// recycle bin, expiry, TOTP, passkey preservation, clipboard, mobile layout, language/theme. The result is checked via KeePassXC XML export.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchBrowser, browserName, waitOpened, plainWebdav } from '../browser.mjs';
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
        const ctx = await browser.newContext({ locale: 'de-DE', acceptDownloads: true, viewport, permissions: browserName === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] }); // Firefox/WebKit don't know these permission names
        await ctx.addInitScript(plainWebdav);
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
        await waitOpened(page, 90000);
    }
    const rows = (p) => p.locator('[data-testid=entry-row]');
    const pick = async (p, title) => { await p.click('#nav-all'); await p.fill('#search', `title:"${title}"`); await rows(p).filter({ hasText: title }).first().click(); await p.fill('#search', ''); };
    const menuItem = (p, label) => p.locator('.menu-item', { hasText: label }).first();
    const status = (p) => p.locator('#status').innerText();
    const waitStatus = (p, re, timeout = 30000) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout });
    const count = async (p, id) => Number(await p.locator(`#${id} .count`).innerText());

    const page = await newPage();
    // the entry list, the group tree and the tag chips of the main page
    const rowOf = (title) => rows(page).filter({ has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
    const gcount = async (name) => Number(await page.locator('.tree-row', { hasText: name }).first().locator('.count').first().innerText());
    const group = (name) => page.locator('.tree-row', { hasText: name }).first().locator('.tree-label').click();
    const chip = (txt) => page.locator('[data-testid=tag-chip]', { hasText: txt });
    await step('Alltags-Datei oeffnen; Seitenleiste zaehlt Eintraege, schwache, ablaufende, TOTP, Passkeys', async () => {
        await login(page);
        expect(await count(page, 'nav-all') === meta.entries, `Eintragszahl ${await count(page, 'nav-all')} != ${meta.entries}`);
        const c = { weak: await count(page, 'nav-weak'), exp: await count(page, 'nav-expiring'), totp: await count(page, 'nav-totp'), pk: await count(page, 'nav-passkey') };
        expect(c.weak >= 5 && c.exp === 2 && c.totp === 2 && c.pk === 1, JSON.stringify(c));
        // Order: all entries, groups, (tags), filters; on a wide window the tools only exist at the top right
        const order = await page.evaluate(() => [...document.querySelectorAll('#groups > .nav-section')].map((s) => s.querySelector('#nav-all') ? 'all' : s.querySelector('.tree') ? 'groups' : s.id === 'nav-filters' ? 'filters' : s.classList.contains('nav-tools') ? 'tools' : s.querySelector('#nav-bin') ? 'bin' : 'tags'));
        expect(order.indexOf('all') === 0 && order.indexOf('groups') === 1 && order.indexOf('filters') > order.indexOf('groups') && order.indexOf('filters') < order.indexOf('bin'), 'Reihenfolge ' + order);
        expect(!(await page.locator('#nav-reports').isVisible()) && await page.locator('#reports-btn').isVisible(), 'Werkzeuge in der Seitenleiste nur bei schmalem Fenster');
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
        // Drag entry "Amazon" into the new group
        await page.locator('.tree-row', { hasText: 'Shopping' }).first().locator('.tree-label').click();
        await page.dragAndDrop('.entry-wrap:has-text("Amazon")', '.tree-row:has-text("UI-Gruppe-neu")');
        expect(await row('UI-Gruppe-neu').locator('.count').first().innerText() === '1', 'Drag&Drop: Zaehler');
        // Move subgroup
        await row('Unter-1').hover(); await row('Unter-1').locator('.row-more').click();
        await menuItem(page, 'Gruppe verschieben').click();
        await page.locator('.modal select').selectOption({ label: 'Lizenzen' }); await page.locator('.modal button[type=submit]').click();
        await page.locator('.tree-row', { hasText: 'Lizenzen' }).waitFor();
        // create and delete a second group
        await page.click('#new-group-btn'); await page.fill('#prompt-input', 'Weg-Gruppe'); await page.keyboard.press('Enter');
        await row('Weg-Gruppe').hover(); await row('Weg-Gruppe').locator('.row-more').click(); await menuItem(page, 'Löschen').click(); await page.click('#confirm-ok');
        await page.waitForFunction(() => ![...document.querySelectorAll('.tree-row')].some((r) => /Weg-Gruppe/.test(r.textContent)));
        expect(await count(page, 'nav-bin') >= 1 || /\d+/.test(await page.locator('#nav-bin .count').innerText()), 'Papierkorb-Zaehler');
    });

    await step('Menue: Punkt gewaehlt, bevor das Menue fertig ist -> das naechste Menue reagiert trotzdem auf Klicks', async () => {
        const row = page.locator('.tree-row', { hasText: 'UI-Gruppe-neu' }).first();
        // Open and pick in one task, i.e. before the setTimeout(0) in popupMenu (like on an overloaded CI runner)
        await row.evaluate((r) => {
            r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
            [...document.querySelectorAll('.menu-item')].find((b) => /Gruppe bearbeiten/.test(b.textContent)).click();
        });
        await page.locator('#g-name').waitFor(); await page.keyboard.press('Escape');
        await row.hover(); await row.locator('.row-more').click();
        await menuItem(page, 'Gruppe bearbeiten').click();
        await page.locator('#g-name').waitFor({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });

    await step('Eintrag: duplizieren, verschieben (Dialog), loeschen + Rueckgaengig; Loeschen in den Papierkorb', async () => {
        const total = await count(page, 'nav-all');
        await pick(page, 'Gmail');
        await page.click('#entry-more'); await menuItem(page, 'Duplizieren').click();
        expect(!(await page.isChecked('#dup-link')), 'Verknuepfen ist anfangs aus'); await page.click('#dup-ok');
        await page.waitForFunction(() => /Gmail - Kopie/.test(document.querySelector('#detail h2')?.textContent || ''));
        expect(await count(page, 'nav-all') === total + 1, 'Kopie zaehlt');
        await page.click('#entry-more'); await menuItem(page, 'Verschieben').click();
        await page.locator('.modal select').selectOption({ label: 'Lizenzen' }); await page.locator('.modal button[type=submit]').click();
        await page.waitForFunction(() => /Lizenzen/.test(document.querySelector('.crumbs')?.textContent || ''));
        // Delete with undo
        await pick(page, 'Posteo');
        await page.click('#del-btn');
        expect(await count(page, 'nav-all') === total, 'nach Loeschen');
        await page.locator('.toast-action', { hasText: 'Rückgängig' }).click();
        expect(await count(page, 'nav-all') === total + 1, 'Rueckgaengig stellt wieder her');
        // Posteo stays in the recycle bin; Etsy is deleted and restored
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
        expect(await page.locator('#att-input').count() === 0, 'Ansicht hat kein Hinzufuegen');
        await page.click('#edit-btn');
        await page.setInputFiles('#att-input', { name: 'neu.txt', mimeType: 'text/plain', buffer: Buffer.from('neu-inhalt') });
        await page.locator('#e-att-list .att-row', { hasText: 'neu.txt' }).waitFor();
        await page.locator('#e-att-list .att-row', { hasText: 'zufall.bin' }).locator('[data-testid=e-att-remove]').click();
        await page.click('#cancel-btn'); // Cancel discards both
        expect(await page.locator('[data-testid=attachment]').count() === 2 && await page.locator('.att-row', { hasText: 'zufall.bin' }).count() === 1, 'Abbrechen laesst die Anhaenge unveraendert');
        await page.click('#edit-btn');
        await page.setInputFiles('#att-input', { name: 'neu.txt', mimeType: 'text/plain', buffer: Buffer.from('neu-inhalt') });
        await page.locator('#e-att-list .att-row', { hasText: 'neu.txt' }).waitFor();
        await page.locator('#e-att-list .att-row', { hasText: 'zufall.bin' }).locator('[data-testid=e-att-remove]').click();
        await page.click('#apply-btn');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=attachment]').length === 2);
        expect(await page.locator('.att-row', { hasText: 'neu.txt' }).count() === 1 && await page.locator('.att-row', { hasText: 'zufall.bin' }).count() === 0, 'Uebernehmen setzt Hinzufuegen/Entfernen um');
    });

    await step('Verlauf: Eintrag mit 5 Staenden -> anzeigen, frueheren Stand wiederherstellen (aktueller wird selbst Verlauf)', async () => {
        await pick(page, 'Mit Verlauf');
        const det = page.locator('[data-testid=history]');
        expect(/Verlauf \(5\)/.test(await det.locator('summary').innerText()), await det.locator('summary').innerText());
        await det.locator('summary').click();
        expect(await page.locator('[data-testid=history-row]').count() === 5, 'fuenf Zeilen');
        await page.locator('[data-testid=history-row]').last().locator('[data-testid=history-restore]').click(); // oldest revision "v0"
        await page.click('[data-testid=pw-toggle]');
        expect(await page.locator('[data-testid=pw-value]').innerText() === 'v0', 'Passwort v0 wiederhergestellt: ' + await page.locator('[data-testid=pw-value]').innerText());
        expect(/Verlauf \(6\)/.test(await page.locator('[data-testid=history] summary').innerText()), 'jetzt 6 Staende');
    });

    await step('Editor: Hinweis, wenn ein anderer Eintrag dasselbe Passwort hat (wie im Bericht); verschwindet bei eindeutigem Passwort und bei "aus Berichten ausnehmen"', async () => {
        await page.click('#new-btn');
        const note = page.locator('#e-reuse');
        expect(await note.isHidden(), 'neuer Eintrag ohne Passwort: kein Hinweis');
        await page.fill('#e-pass', 'Sommer2020');
        await note.waitFor({ state: 'visible' });
        const txt = await note.innerText();
        expect(txt === 'Wird auch benutzt in: Gleiches Passwort 0, Gleiches Passwort 1 (+1)', 'drei Eintraege mit Sommer2020, zwei Namen und der Rest als Zahl: ' + txt);
        expect(await note.evaluate((el) => el.getBoundingClientRect().height <= 2 * parseFloat(getComputedStyle(el).lineHeight) + 1), 'hoechstens zwei Zeilen');
        await page.fill('#e-pass', '123456'); await page.waitForFunction(() => /Schwach/.test(document.querySelector('#e-reuse')?.textContent || ''));
        expect((await note.innerText()).includes('Schwach'), 'Hinweis folgt dem Passwort');
        await page.check('#e-noreport'); await note.waitFor({ state: 'hidden' });
        await page.uncheck('#e-noreport'); await note.waitFor({ state: 'visible' });
        await page.fill('#e-pass', 'Ein-ganz-neues-Passwort-4711'); await note.waitFor({ state: 'hidden' });
        await page.fill('#e-pass', 'Sommer2020'); await note.waitFor({ state: 'visible' });
        await page.click('#cancel-btn');
        await pick(page, 'Gleiches Passwort 0'); await page.click('#edit-btn');
        await page.locator('#e-reuse').waitFor({ state: 'visible' });
        expect(/Gleiches Passwort 1/.test(await page.locator('#e-reuse').innerText()) && !/Gleiches Passwort 0/.test(await page.locator('#e-reuse').innerText()), 'beim Bearbeiten sofort da, ohne den Eintrag selbst');
        await page.click('#cancel-btn');
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

    await step('URLs: nackter Hostname wird https-Link, cmd:// bleibt Text, Zusatzfeld mit Adresse ist ein Link', async () => {
        const link = async (sel) => page.locator(sel).evaluate((n) => n.tagName === 'A' ? n.getAttribute('href') : null);
        await page.click('#new-btn');
        await page.fill('#e-title', 'UI Link'); await page.fill('#e-url', 'example.com/login');
        await page.click('#add-custom');
        for (const [name, value] of [['KP2A_URL_1', 'alt.example.org'], ['Server', 'https://srv.example.org'], ['Notiz', 'example.org']]) {
            if (name !== 'KP2A_URL_1') await page.click('#add-custom');
            const row = page.locator('#e-custom .custom-row').last(); await row.locator('.c-name').fill(name); await row.locator('.c-value').fill(value);
        }
        await page.click('#apply-btn');
        await page.waitForFunction(() => (document.querySelector('#detail h2')?.textContent || '').trim() === 'UI Link');
        expect(await link('[data-testid=f-url]') === 'https://example.com/login', 'nackter Hostname');
        expect((await page.locator('[data-testid=f-url]').innerText()).trim() === 'example.com/login', 'Text bleibt wie eingegeben');
        await page.fill('#search', 'title:"UI Link"'); await rowOf('UI Link').first().waitFor(); const n3 = await page.locator('.entry-wrap', { has: rowOf('UI Link') }).locator('.row-actions button').count(); expect(n3 === 3, 'Schnellbuttons der Zeile: URL oeffnen, Benutzer, Passwort'); await page.fill('#search', '');
        expect(await link('[data-testid=custom-KP2A_URL_1]') === 'https://alt.example.org', 'URL-Zusatzfeld');
        expect(await link('[data-testid=custom-Server]') === 'https://srv.example.org', 'Zusatzfeld mit https');
        expect(await link('[data-testid=custom-Notiz]') === null, 'nackter Hostname in einem Nicht-URL-Feld bleibt Text');
        await page.click('#edit-btn');
        const names = await page.locator('#field-suggestions option').evaluateAll((os) => os.map((o) => o.value));
        expect(names.includes('Server') && names.includes('Notiz') && !names.includes('Title'), 'Vorschlaege fuer Feldnamen: ' + names);
        expect(await page.locator('.c-name').first().getAttribute('list') === 'field-suggestions', 'Feldname hat die Vorschlagsliste');
        await page.fill('#e-url', 'cmd://putty.exe'); await page.click('#apply-btn');
        await page.waitForFunction(() => /cmd:/.test(document.querySelector('[data-testid=f-url]')?.textContent || ''));
        expect(await link('[data-testid=f-url]') === null, 'cmd:// darf kein Link sein');
        await page.fill('#search', 'title:"UI Link"'); await rowOf('UI Link').first().waitFor(); const n2 = await page.locator('.entry-wrap', { has: rowOf('UI Link') }).locator('.row-actions button').count(); await page.fill('#search', ''); expect(n2 === 2, 'cmd:// bekommt keinen URL-Schnellbutton');
    });

    await step('TOTP-Ring/-Code fuer otpauth (SHA256, 8 Stellen, 45 s) und alte Felder (TOTP Seed)', async () => {
        await pick(page, 'Mit TOTP (otp)');
        // First wait for the first computed code (before that it shows "------")
        await page.waitForFunction(() => /^\d+$/.test(document.querySelector('[data-testid=totp-code]')?.textContent || ''));
        // Compare against KeePassXC as in tests/e2e/run.mjs: up to 3 tries 1.2 s apart. The app only refreshes the code
        // once a second, and keepassxc-cli itself needs up to a few seconds for the 256 MiB file; at the 45 s boundary
        // both readings can therefore land in different windows.
        let ok = false, a, exp;
        for (let i = 0; i < 3 && !ok; i++) {
            a = (await page.locator('[data-testid=totp-code]').innerText()).trim();
            exp = xc(['show', '-t', dbFile, 'Privat/E-Mail/Mit TOTP (otp)']).trim().split('\n').pop();
            ok = a === exp;
            if (!ok) await page.waitForTimeout(1200);
        }
        expect(/^\d{8}$/.test(a), 'Code 8 Stellen: ' + a);
        expect(ok, `TOTP App ${a} vs KeePassXC ${exp}`);
        await pick(page, 'Mit TOTP (alt)');
        await page.waitForFunction(() => /^\d+$/.test(document.querySelector('[data-testid=totp-code]')?.textContent || ''));
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
        // Saved settings from 0.9: "-" was just the old default and turns into a space once
        await page.evaluate(() => localStorage.setItem('kpnc.gen', JSON.stringify({ mode: 'ph', ph: { words: 6, separator: '-', casing: 'lower' } })));
        await page.click('#tool-gen');
        expect(await page.locator('#gen-tab-ph.active').count() === 1 && await page.inputValue('#gen-list') === 'de' && await page.inputValue('#gen-sep') === ' ', 'Passphrase mit deutscher Wortliste und Leerzeichen vorne');
        await page.click('#gen-tab-pw'); await page.fill('#gen-length', '40'); await page.locator('#gen-length').press('Tab');
        await page.uncheck('#gen-digits');
        let pw = (await page.locator('#gen-preview').innerText()).trim();
        expect([...pw].length === 40 && !/[0-9]/.test(pw), `Passwort ${pw}`);
        await page.click('#gen-tab-ph'); await page.fill('#gen-words', '5'); await page.locator('#gen-words').press('Tab'); await page.selectOption('#gen-sep', '.');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[a-z-]+(\.[a-z-]+){4}$/.test(pw), 'Passphrase ' + pw);
        await page.check('#gen-digit');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[a-z]+(\.[a-z]+){4}$/.test(pw.replace(/[0-9]/, '')) && pw.split('.').filter((w) => /^[a-z]+[0-9]$/.test(w)).length === 1, 'Passphrase mit Ziffer ' + pw);
        await page.uncheck('#gen-digit');
        await page.check('#gen-ph-capital');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[A-Z][a-z-]*(\.[A-Z][a-z-]*){4}$/.test(pw), 'Passphrase mit grossen Anfangsbuchstaben ' + pw);
        await page.uncheck('#gen-ph-capital');
        const dlgH = () => page.locator('.gen-modal').evaluate((d) => Math.round(d.getBoundingClientRect().height));
        const phH = await dlgH(); await page.fill('#gen-words', '3'); await page.locator('#gen-words').press('Tab');
        expect(await dlgH() === phH, 'Passphrase: Dialoghoehe bleibt beim Aendern der Wortzahl');
        await page.click('#gen-tab-pw'); const pwH = await dlgH(); await page.click('#gen-tab-ph');
        expect(pwH === phH, `Passwort-Dialog so hoch wie Passphrase (${pwH} / ${phH})`);
        await page.selectOption('#gen-sep', '-'); await page.keyboard.press('Escape'); await page.click('#tool-gen');
        expect(await page.inputValue('#gen-sep') === '-', 'bewusst gewaehltes "-" bleibt');
        await page.click('#gen-tab-pw');
        expect(!(await page.locator('#gen-more').evaluate((d) => d.open)) && !(await page.locator('#gen-extended').isVisible()), 'seltene Optionen unter "Mehr"');
        expect(await page.locator('#gen-special1').isChecked() && !(await page.locator('#gen-special2').isChecked()), 'Sonderzeichen 1 an, 2 aus');
        await page.uncheck('#gen-special1'); await page.check('#gen-special2');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/['/()[\]{}<>#^~`]/.test(pw) && !/[!?.,:;\-_+=*"$%&@]/.test(pw), 'nur Sonderzeichen 2: ' + pw);
        await page.check('#gen-special1'); await page.uncheck('#gen-special2');
        await page.click('#gen-tab-si'); await page.fill('#gen-blocks', '3'); await page.locator('#gen-blocks').press('Tab');
        expect(await page.locator('#gen-capital').isChecked(), 'Simpel: erster Buchstabe standardmaessig gross');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[BDFGHKLMNPRSTZ][a-z]{5,11} [2-9]{2}( [a-z]{6,12}){2}$/.test(pw) && !/[cjqvwxy]|hh|(.)\1\1/i.test(pw), 'Simpel ' + pw);
        expect(/· 102 bit/.test(await page.locator('.gen .strength-label').innerText()), 'exakte Bitzahl statt Schaetzung');
        await page.selectOption('#gen-si-sep', '@');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[A-Z][a-z]{5,11}@[2-9]{2}@[a-z]{6,12}@[a-z]{6,12}$/.test(pw), 'Simpel mit @ ' + pw);
        await page.fill('#gen-blocks', '1'); await page.locator('#gen-blocks').press('Tab');
        pw = (await page.locator('#gen-preview').innerText()).trim();
        expect(/^[A-Z][a-z]{5,11}@[2-9]{2}$/.test(pw), 'Simpel mit einem Block ' + pw);
        if (browserName === 'chromium') {
            await page.locator('#gen-preview').click(); await page.locator('#gen-preview.copied').waitFor();
            expect(await page.evaluate(() => navigator.clipboard.readText()) === pw, 'Klick auf das Passwort kopiert es');
        }
        await page.keyboard.press('Escape');
        await pick(page, 'UI Ablauf-TOTP'); await page.click('#edit-btn'); await page.click('#gen-btn');
        expect(await page.locator('#gen-preview.click-copy').count() === 0, 'In the editor dialog a click on the password does not copy');
        await page.click('#gen-tab-pw'); await page.click('#gen-use'); await page.click('#e-show');
        const v = await page.inputValue('#e-pass');
        expect(v !== 'Ui-Passwort-123!' && v.length >= 20, 'Editor uebernimmt Passwort');
        await page.click('#cancel-btn');
    });

    await step('Datenbank-Dialog: Gesundheit stimmt mit Seitenleiste ueberein, Treffer oeffnet den Eintrag; Statistik; Einstellungen-Tab mit Infos (Argon2d, 256 MiB)', async () => {
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
        await page.locator('#list .entry.active').focus(); // focus in the list, not in the search field
        await page.keyboard.press('Control+b');
        const user = (await page.locator('[data-testid=f-user]').innerText()).trim();
        if (browserName === 'webkit') return 'Kuerzel ausgeloest; Inhalt der Zwischenablage NICHT geprueft (WebKit verweigert dem Test das Lesen)';
        await page.waitForFunction((u) => navigator.clipboard.readText().then((x) => x === u), user);
        await page.keyboard.press('Control+c');
        await page.click('[data-testid=pw-toggle]'); const pw = (await page.locator('[data-testid=pw-value]').innerText()).trim();
        await page.waitForFunction((x) => navigator.clipboard.readText().then((y) => y === x), pw);
        await page.waitForFunction(() => navigator.clipboard.readText().then((y) => y === ''), null, { timeout: 15000 });
    });

    await step('Zwischenablage: wurde zwischendurch etwas anderes kopiert, leert der Timer es nicht', async () => {
        if (browserName !== 'chromium') return 'nur Chromium: Firefox/WebKit gewaehren das Lesen der Zwischenablage nicht';
        await pick(page, 'Amazon');
        await page.locator('#list .entry.active').focus();
        await page.keyboard.press('Control+c');
        await page.waitForFunction(() => /kopiert/.test(document.querySelector('#status')?.textContent || ''));
        await page.evaluate(() => navigator.clipboard.writeText('fremder Inhalt'));
        await page.waitForTimeout(12000); // clipboard setting of this page: 10 s
        expect(await page.evaluate(() => navigator.clipboard.readText()) === 'fremder Inhalt', 'Der Timer hat fremden Inhalt geleert');
    });

    await step('Verknuepft duplizieren: Kopie zeigt per {REF:U@I:…}/{REF:P@I:…} auf das Original, Detail zeigt und kopiert die echten Werte', async () => {
        const amazon = walk(loadXml()).find((x) => x.title === 'Amazon').entry;
        const hex = Buffer.from(text(kids(amazon, 'UUID')[0]), 'base64').toString('hex').toUpperCase();
        const user = text(strOf(amazon, 'UserName')), pw = text(strOf(amazon, 'Password'));
        await pick(page, 'Amazon');
        await page.click('#entry-more'); await menuItem(page, 'Duplizieren').click();
        await page.check('#dup-link'); await page.click('#dup-ok');
        await page.waitForFunction(() => /Amazon - Kopie/.test(document.querySelector('#detail h2')?.textContent || ''));
        await page.waitForFunction((u) => document.querySelector('[data-testid=f-user]')?.textContent === u, user);
        await page.click('[data-testid=pw-toggle]');
        expect((await page.locator('[data-testid=pw-value]').innerText()).trim() === pw, 'Passwort aufgeloest');
        expect(await page.locator('.field.pw .strength').count() === 1, 'Staerke des Ziel-Passworts');
        await rows(page).filter({ hasText: 'Amazon - Kopie' }).first().focus();
        if (browserName === 'webkit') return 'Anzeige geprueft; Zwischenablage NICHT (WebKit verweigert dem Test das Lesen)';
        await page.keyboard.press('Control+c');
        await page.waitForFunction((x) => navigator.clipboard.readText().then((y) => y === x), pw);
        await page.click('#edit-btn');
        expect(await page.inputValue('#e-pass') === `{REF:P@I:${hex}}` && await page.inputValue('#e-user') === `{REF:U@I:${hex}}`, 'Editor zeigt die Referenzen selbst');
        await page.click('#cancel-btn');
    });

    await step('Symbole: Standard-Symbol, eigenes Bild (verkleinert, doppelt erkannt, entfernt), Gruppe samt Untergruppen', async () => {
        const row = (t) => rows(page).filter({ hasText: t }).first();
        const shot = (width, height) => page.screenshot({ clip: { x: 0, y: 0, width, height } });
        const picker = async (title) => { await pick(page, title); await page.click('#edit-btn'); await page.click('#e-icon'); await page.locator('#icon-std').waitFor(); };
        const customCells = () => page.locator('[data-testid=icon-custom-cell]');
        const logo = await shot(300, 200), small = await shot(90, 60);
        // Default icon 37 (bank): preview in the editor, then in the list
        await picker('Amazon');
        await page.click('#icon-std [data-icon="37"]'); await page.click('#icon-ok');
        expect(await page.locator('#e-icon .avatar.glyph').count() === 1, 'Vorschau im Editor');
        await page.click('#apply-btn');
        expect(await row('Amazon').locator('.avatar.glyph').count() === 1, 'Liste zeigt das Standard-Symbol');
        // Custom image 300x200 -> 128x85
        await picker('Gmail');
        const n0 = await customCells().count();
        await page.setInputFiles('#icon-file', { name: 'logo.png', mimeType: 'image/png', buffer: logo });
        await page.locator('[data-testid=icon-custom-cell][aria-checked=true]').waitFor();
        expect(await customCells().count() === n0 + 1, 'neues Bild in der Liste');
        await page.click('#icon-ok'); await page.click('#apply-btn');
        expect(await row('Gmail').locator('img.avatar').count() === 1, 'Liste zeigt das eigene Bild');
        // Same image again: it is recognised and selected; an SVG and a small image are added, only the selected one ends up in the file and is removed again
        await picker('Etsy');
        const before = await customCells().count();
        await page.setInputFiles('#icon-file', { name: 'logo-again.png', mimeType: 'image/png', buffer: logo });
        await page.locator('.toast', { hasText: 'gibt es schon' }).waitFor();
        expect(await customCells().count() === before && await page.locator('[data-testid=icon-custom-cell][aria-checked=true]').count() === 1, 'Duplikat ausgewaehlt statt neu angelegt');
        // SVG with script and external image: drawn as an image (128x64), the script doesn't run, nothing gets loaded (last step)
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><script>window.__svgRan = 1</script><image href="https://example.org/x.png" width="5" height="5"/><rect width="20" height="10" fill="#c33"/></svg>';
        await page.setInputFiles('#icon-file', { name: 'vektor.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid=icon-custom-cell]').length === n, before + 1);
        const size = await page.locator('[data-testid=icon-custom-cell][aria-checked=true] img').evaluate((img) => img.decode().then(() => [img.naturalWidth, img.naturalHeight, !!window.__svgRan]));
        expect(size[0] === 128 && size[1] === 64 && !size[2], 'SVG als PNG 128x64 ohne Skript: ' + size);
        await page.setInputFiles('#icon-file', { name: 'klein.png', mimeType: 'image/png', buffer: small });
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid=icon-custom-cell]').length === n, before + 2);
        await page.click('#icon-ok'); await page.click('#apply-btn');
        await page.click('#edit-btn'); await page.click('#e-icon');
        await page.click('#icon-remove');
        expect(/^1 Einträge/.test(await page.locator('.modal p').last().innerText()), 'Bestaetigung nennt die Zahl der Nutzer: ' + await page.locator('.modal p').last().innerText());
        await page.click('#confirm-ok');
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid=icon-custom-cell]').length === n, before);
        expect(await page.locator('#icon-std [aria-checked=true]').count() === 1, 'nach dem Entfernen wieder Standard-Symbol');
        await page.click('#icon-ok'); await page.click('#cancel-btn');
        expect(await row('Etsy').locator('img.avatar').count() === 0, 'Etsy zeigt kein eigenes Bild mehr');
        // Group: icon 60 (home) for the group and all subgroups, entries stay
        const g = page.locator('.tree-row', { hasText: 'Lizenzen' }).first();
        await g.hover(); await g.locator('.row-more').click(); await menuItem(page, 'Gruppe bearbeiten').click();
        await page.click('#g-icon'); await page.click('#icon-std [data-icon="60"]'); await page.click('#icon-ok');
        await page.selectOption('#g-icon-scope', 'groups'); await page.click('#g-ok');
        await page.waitForFunction(() => !document.querySelector('.modal'));
    });

    await step('Barrierefreiheit (axe-core): keine Verstoesse auf Liste, Eintrag, Editor, Einstellungen, Datenbank, Generator, Palette; hell, dunkel und auf dem Handy', async () => {
        // The "region" rule (content outside landmarks) stays off: popup menus live in <body> on purpose.
        const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
        await page.emulateMedia({ reducedMotion: 'reduce' }); // no fade-ins: halfway through one, colours are blended and the contrast reads wrong
        const found = [];
        const scan = async (label) => {
            await page.evaluate(axeSource);
            const r = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { region: { enabled: false } } }));
            for (const v of r.violations) found.push(`${label}: ${v.id} [${v.impact}] x${v.nodes.length} ${v.nodes[0].target.join(' ')} - ${(v.nodes[0].any[0] || v.nodes[0].all[0] || v.nodes[0].none[0] || {}).message || v.help}`);
        };
        const dialog = async (label, open) => { await open(); await page.locator('.modal').first().waitFor(); await scan(label); await page.keyboard.press('Escape'); await page.locator('.backdrop').first().waitFor({ state: 'detached' }); };
        const desktop = async (tag) => {
            await page.click('#nav-all'); await rows(page).nth(2).click();
            await scan(`${tag} Liste und Eintrag`);
            await page.click('#sel-start'); await scan(`${tag} Auswahlmodus`); await page.click('#sel-done');
            await page.click('#edit-btn'); await page.locator('#e-title').waitFor(); await scan(`${tag} Editor`); await page.click('#cancel-btn');
            await dialog(`${tag} Einstellungen`, () => page.click('#settings-btn'));
            await dialog(`${tag} Datenbank`, () => page.click('#reports-btn'));
            await dialog(`${tag} Generator`, () => page.click('#tool-gen'));
            await dialog(`${tag} Palette`, () => page.keyboard.press('Control+k'));
        };
        await desktop('hell');
        await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
        await desktop('dunkel');
        await page.evaluate(() => { delete document.documentElement.dataset.theme; });
        await page.setViewportSize({ width: 390, height: 844 });
        try {
            if (await page.locator('.back-btn').first().isVisible()) await page.locator('.back-btn').first().click(); // from the open entry back to the list
            await scan('Handy Liste');
            await rows(page).nth(2).click(); await scan('Handy Eintrag');
        } finally { await page.setViewportSize({ width: 1500, height: 950 }); await page.emulateMedia({ reducedMotion: null }); }
        expect(found.length === 0, 'axe-core:\n   ' + found.join('\n   '));
    });

    await step('Mehrfachauswahl: Strg-/Umschalt-Klick, Auswahlmodus, Alle, Tags, Verschieben, Loeschen + Rueckgaengig, Wiederherstellen, Ziehen nimmt alle mit', async () => {
        const sel = () => page.locator('#sel-count').innerText();
        const marked = () => page.locator('.entry.marked').count();
        await group('Banken');
        const banken = await gcount('Banken'); // six fixed entries plus two special ones that stay where they are
        expect(banken === 8, 'Banken hat acht Eintraege: ' + banken);
        // an open entry plus Ctrl+click: both are ticked; Shift+click extends from the last tick
        await rowOf('Hausbank Online').click();
        await rowOf('Krankenkasse').click({ modifiers: ['Control'] });
        expect(await sel() === '2 ausgewählt', 'Strg-Klick: ' + await sel());
        await rowOf('Kreditkarte').click({ modifiers: ['Shift'] });
        expect(await sel() === '3 ausgewählt' && await marked() === 3, 'Umschalt-Klick: ' + await sel());
        // in select mode a plain click ticks and does not open
        await rowOf('Depot').click(); expect(await sel() === '4 ausgewählt', 'Klick tickt');
        await rowOf('Depot').click(); expect(await sel() === '3 ausgewählt', 'zweiter Klick nimmt zurueck');
        expect(await page.locator('[data-testid=f-title]').innerText() === 'Hausbank Online', 'der offene Eintrag bleibt');
        await page.keyboard.press('Escape');
        expect(await page.locator('[data-testid=sel-bar]').count() === 0 && await marked() === 0, 'Esc beendet die Auswahl');
        // the select button, Ctrl+A in the list, "Done"
        await page.click('#sel-start');
        expect(await sel() === '0 ausgewählt', 'Auswahlmodus ohne Haken');
        await rowOf('Depot').focus(); await page.keyboard.press('Control+a');
        expect(await sel() === '8 ausgewählt' && await page.locator('#sel-all').count() === 0, 'Strg+A: ' + await sel());
        await page.click('#sel-done');
        expect(await page.locator('[data-testid=sel-bar]').count() === 0 && await marked() === 0, 'Fertig beendet die Auswahl');
        // tags: add, then take one off again (the chips show what the selection carries)
        await page.click('#sel-start'); await rowOf('Depot').click(); await rowOf('KFZ-Versicherung').click();
        await page.click('#sel-tags'); await page.fill('#sel-tags-input', 'sammel, test-x'); await page.click('#sel-tags-add');
        await chip('sammel · 2').waitFor(); await chip('test-x · 2').waitFor();
        expect(await sel() === '2 ausgewählt', 'Tags aendern laesst die Auswahl stehen');
        await page.click('#sel-tags'); await page.locator('[data-testid=sel-tags-on] .chip', { hasText: 'test-x' }).click();
        expect(await page.inputValue('#sel-tags-input') === 'test-x', 'Chip uebernimmt das Tag');
        await page.click('#sel-tags-remove');
        await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid=tag-chip]')].some((c) => /test-x/.test(c.textContent)));
        await chip('sammel · 2').waitFor();
        // move
        const lizenzen = await gcount('Lizenzen');
        await page.click('#sel-move'); await page.locator('.modal select').selectOption({ label: 'Lizenzen' }); await page.click('#sel-move-ok');
        await page.waitForFunction((n) => [...document.querySelectorAll('.tree-row')].find((r) => /Lizenzen/.test(r.textContent))?.querySelector('.count')?.textContent === String(n), lizenzen + 2);
        expect(await gcount('Banken') === 6 && await page.locator('[data-testid=sel-bar]').count() === 0, 'verschoben, Auswahl beendet');
        // delete with Undo, then delete and restore from the recycle bin
        const bin = async () => Number(await page.locator('#nav-bin .count').innerText());
        const bin0 = await bin();
        await page.click('#sel-start'); await rowOf('Hausbank Online').click(); await rowOf('Krankenkasse').click(); await page.click('#sel-delete');
        await page.waitForFunction((n) => document.querySelector('#nav-bin .count')?.textContent === String(n), bin0 + 2);
        await page.locator('.toast-action', { hasText: 'Rückgängig' }).click();
        await page.waitForFunction((n) => document.querySelector('#nav-bin .count')?.textContent === String(n), bin0);
        expect(await gcount('Banken') === 6, 'Rueckgaengig bringt beide zurueck');
        await page.click('#sel-start'); await rowOf('Hausbank Online').click(); await rowOf('Krankenkasse').click(); await page.click('#sel-delete');
        await page.waitForFunction((n) => document.querySelector('#nav-bin .count')?.textContent === String(n), bin0 + 2);
        await page.click('#nav-bin');
        expect(await page.evaluate(() => document.querySelector('#sel-start').getBoundingClientRect().right <= document.querySelector('#list').getBoundingClientRect().right), 'der Listenkopf im Papierkorb bleibt in seiner Spalte (sonst liegt der Auswahl-Knopf unter dem Detailfenster)');
        expect(await page.locator('#sel-restore').count() === 0, 'Wiederherstellen gibt es nur im Papierkorb, solange nichts getickt ist');
        await page.click('#sel-start'); await rowOf('Hausbank Online').click(); await rowOf('Krankenkasse').click();
        await page.click('#sel-restore');
        await page.waitForFunction((n) => document.querySelector('#nav-bin .count')?.textContent === String(n), bin0);
        expect(await gcount('Banken') === 6, 'wiederhergestellt in die alte Gruppe');
        // dragging one ticked entry takes the other ticked ones along
        await group('Banken');
        const neu = await gcount('UI-Gruppe-neu');
        await page.click('#sel-start'); await rowOf('Kreditkarte').click(); await rowOf('PayPal').click();
        await page.locator('.entry-wrap', { has: page.locator('.title', { hasText: /^Kreditkarte$/ }) }).dragTo(page.locator('.tree-row', { hasText: 'UI-Gruppe-neu' }).first());
        await page.waitForFunction((n) => [...document.querySelectorAll('.tree-row')].find((r) => /UI-Gruppe-neu/.test(r.textContent))?.querySelector('.count')?.textContent === String(n), neu + 2);
        expect(await gcount('Banken') === 4 && await page.locator('[data-testid=sel-bar]').count() === 0, 'beide gezogen, Auswahl beendet');
    });

    await step('Tags verwalten: Kontextmenue, umbenennen, zusammenfuehren, ungueltiger Name, Eintrag auf Tag ziehen, Entfernen + Rueckgaengig (auch ueber den Listenkopf)', async () => {
        const noChip = (txt) => page.waitForFunction((x) => ![...document.querySelectorAll('[data-testid=tag-chip]')].some((c) => c.textContent.startsWith(x)), txt);
        const tagTwo = async (title, tag) => { await page.click('#sel-start'); await rowOf(title).click(); await page.click('#sel-tags'); await page.fill('#sel-tags-input', tag); await page.click('#sel-tags-add'); await page.click('#sel-done'); };
        await group('Banken');
        await page.click('#sel-start'); await rowOf('Hausbank Online').click(); await rowOf('Krankenkasse').click();
        await page.click('#sel-tags'); await page.fill('#sel-tags-input', 'alt'); await page.click('#sel-tags-add'); await page.click('#sel-done');
        await chip('alt · 2').waitFor();
        // drag an entry onto a tag chip
        await group('Shopping');
        await page.locator('.entry-wrap', { has: page.locator('.title', { hasText: /^Zalando$/ }) }).dragTo(chip('alt'));
        await chip('alt · 3').waitFor();
        // rename through the context menu; the tag chip is the same one in the sidebar afterwards
        await chip('alt · 3').click({ button: 'right' }); await menuItem(page, 'Tag umbenennen').click();
        await page.fill('#prompt-input', 'a,b'); await page.keyboard.press('Enter');
        await page.locator('.toast', { hasText: 'Komma' }).waitFor(); await chip('alt · 3').waitFor();
        await chip('alt · 3').click({ button: 'right' }); await menuItem(page, 'Tag umbenennen').click();
        await page.fill('#prompt-input', 'neu'); await page.keyboard.press('Enter');
        await chip('neu · 3').waitFor(); await noChip('alt');
        // renaming to an existing tag merges them
        await chip('neu · 3').click({ button: 'right' }); await menuItem(page, 'Tag umbenennen').click();
        await page.fill('#prompt-input', 'sammel'); await page.keyboard.press('Enter');
        await chip('sammel · 5').waitFor(); await noChip('neu');
        await page.locator('.toast', { hasText: 'zusammengeführt' }).waitFor();
        // remove via the list header while the tag is the filter; Undo brings it back
        await group('Shopping'); await tagTwo('Zalando', 'weg');
        await chip('weg · 1').click();
        expect(await page.locator('#list h2').first().innerText() === '#weg', 'Listenkopf zeigt das Tag');
        await page.click('#tag-more'); await menuItem(page, 'Tag entfernen').click();
        await noChip('weg');
        expect(await page.locator('#nav-all.active').count() === 1, 'nach dem Entfernen steht die Liste wieder auf "Alle Eintraege"');
        await page.locator('.toast-action', { hasText: 'Rückgängig' }).last().click(); // an older toast may still be around
        await chip('weg · 1').waitFor();
        await chip('weg · 1').click({ button: 'right' }); await menuItem(page, 'Tag entfernen').click();
        await noChip('weg');
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
        const linked = find('Amazon - Kopie')[0].entry, amazonId = Buffer.from(text(kids(find('Amazon')[0].entry, 'UUID')[0]), 'base64').toString('hex').toUpperCase();
        expect(text(strOf(linked, 'Password')) === `{REF:P@I:${amazonId}}` && text(strOf(linked, 'UserName')) === `{REF:U@I:${amazonId}}`, 'Verknuepfte Kopie speichert Referenzen aufs Original');
        expect(strOf(linked, 'Password').getAttribute('ProtectInMemory') === 'True', 'Passwort-Referenz bleibt geschuetzt');
        const linkedPath = [...find('Amazon - Kopie')[0].path.split('/').slice(1), 'Amazon - Kopie'].join('/');
        expect(xc(['show', '-s', dbFile, linkedPath]).includes('Password: ' + text(strOf(find('Amazon')[0].entry, 'Password'))), 'KeePassXC loest die Verknuepfung auf');
        // Mehrfachauswahl
        const tagsOf = (t) => text(kids(find(t)[0].entry, 'Tags')[0]).split(/[,;]/).filter(Boolean).sort().join();
        const hist = (t) => kids(kids(find(t)[0].entry, 'History')[0] || { childNodes: [] }, 'Entry').length;
        expect(find('Depot').length === 1 && /Lizenzen$/.test(find('Depot')[0].path) && /Lizenzen$/.test(find('KFZ-Versicherung')[0].path), 'Mehrfach verschoben: ' + find('Depot')[0].path);
        expect(/UI-Gruppe-neu$/.test(find('Kreditkarte')[0].path) && /UI-Gruppe-neu$/.test(find('PayPal')[0].path), 'Mehrfach gezogen: ' + find('PayPal')[0].path);
        expect(/Banken & Versicherungen$/.test(find('Hausbank Online')[0].path) && /Banken & Versicherungen$/.test(find('Krankenkasse')[0].path), 'Geloescht und wiederhergestellt: ' + find('Krankenkasse')[0].path);
        expect(tagsOf('Depot') === 'sammel' && tagsOf('KFZ-Versicherung') === 'sammel' && tagsOf('PayPal') === '', 'Tags: ' + tagsOf('Depot') + ' / ' + tagsOf('PayPal'));
        expect(tagsOf('Hausbank Online') === 'sammel' && tagsOf('Krankenkasse') === 'sammel' && tagsOf('Zalando') === 'sammel', 'Tags umbenannt, zusammengefuehrt, entfernt: ' + tagsOf('Hausbank Online') + ' / ' + tagsOf('Zalando'));
        expect(hist('Depot') === 2 && hist('PayPal') === 0, 'jede Tag-Aenderung hinterlaesst einen Verlaufseintrag: ' + hist('Depot'));
        expect(es.length >= meta.entries, 'Eintragszahl ' + es.length);
        // Icons
        const iconOf = (el) => text(kids(el, 'IconID')[0]), customOf = (el) => text(kids(el, 'CustomIconUUID')[0]);
        expect(iconOf(find('Amazon')[0].entry) === '37', 'Amazon IconID ' + iconOf(find('Amazon')[0].entry));
        const iconBox = kids(doc.getElementsByTagName('Meta')[0], 'CustomIcons')[0];
        const icons = iconBox ? kids(iconBox, 'Icon') : [];
        expect(icons.length === 2, 'das Symbol der Datei und das neue, das entfernte ist weg: ' + icons.length);
        const mine = icons.find((ic) => text(kids(ic, 'UUID')[0]) === customOf(find('Gmail')[0].entry));
        expect(mine, 'Gmail benutzt das neue Symbol');
        expect(!customOf(find('Etsy')[0].entry), 'Etsy ohne eigenes Symbol');
        const png = Buffer.from(text(kids(mine, 'Data')[0]), 'base64');
        expect(png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 128 && png.readUInt32BE(20) === 85, `PNG 128x85: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
        const groupEl = (name) => Array.from(doc.getElementsByTagName('Group')).find((x) => text(kids(x, 'Name')[0]) === name);
        expect(iconOf(groupEl('Lizenzen')) === '60' && iconOf(groupEl('Unter-1')) === '60', 'Gruppe und Untergruppe mit Symbol 60');
        expect(iconOf(find('Gmail - Kopie')[0].entry) !== '60', 'Eintraege der Gruppe bleiben unveraendert');
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

    await step('Datenbank-Einstellungen: Name, Beschreibung, Standard-Benutzer, Papierkorb aus (Loeschen endgueltig), Verlauf kuerzen nach Rueckfrage -> KeePassXC liest alles', async () => {
        await page.click('#reports-btn'); await page.click('#rep-tab-info'); await page.click('#db-settings-btn');
        await page.fill('#db-name', 'UI-Tresor'); await page.fill('#db-desc', 'Beschreibung äöü\nzweite Zeile'); await page.fill('#db-user', 'standard-user');
        await page.uncheck('#db-bin');
        await page.check('#db-hist-items-on'); await page.fill('#db-hist-items', '2');
        await page.click('#db-apply');
        await page.locator('#confirm-ok').waitFor(); // "With history" has 6 revisions -> confirmation prompt
        expect(/\d+ ältere Stände/.test(await page.locator('.modal', { has: page.locator('#confirm-ok') }).innerText()), 'Rueckfrage nennt die Zahl');
        await page.click('#confirm-ok');
        await page.waitForFunction(() => !document.querySelector('#db-settings'));
        const info = await page.locator('.report-body').innerText();
        expect(/UI-Tresor/.test(info) && /Beschreibung äöü/.test(info), 'Info zeigt Name/Beschreibung: ' + info);
        await page.keyboard.press('Escape');
        expect(await page.locator('#nav-bin').count() === 0, 'Papierkorb-Eintrag in der Seitenleiste sollte fehlen');
        await page.click('#new-btn');
        expect(await page.inputValue('#e-user') === 'standard-user', 'Standard-Benutzer nicht vorausgefuellt');
        await page.click('#cancel-btn');
        await pick(page, 'Otto');
        expect(/Endgültig löschen/.test(await page.locator('#del-btn').innerText()), 'Loeschen-Knopf sollte "Endgueltig" sagen');
        await page.click('#del-btn'); await page.click('#confirm-ok');
        await page.keyboard.press('Control+s');
        await waitStatus(page, /^Gespeichert\./, 60000);
        const doc = loadXml(), m = doc.getElementsByTagName('Meta')[0];
        const metaText = (n) => text(kids(m, n)[0]);
        expect(metaText('DatabaseName') === 'UI-Tresor' && metaText('DatabaseDescription') === 'Beschreibung äöü\nzweite Zeile' && metaText('DefaultUserName') === 'standard-user', 'Meta: ' + ['DatabaseName', 'DatabaseDescription', 'DefaultUserName'].map(metaText).join(' | '));
        expect(metaText('RecycleBinEnabled') === 'False' && metaText('HistoryMaxItems') === '2', 'Papierkorb/Verlauf: ' + metaText('RecycleBinEnabled') + ' ' + metaText('HistoryMaxItems'));
        const es = walk(doc), hist = kids(kids(es.find((e) => e.title === 'Mit Verlauf').entry, 'History')[0], 'Entry').length;
        expect(hist === 2, 'Verlauf gekuerzt auf 2: ' + hist);
        expect(!es.some((e) => e.title === 'Otto'), 'Otto sollte endgueltig weg sein: ' + es.filter((e) => e.title === 'Otto').map((e) => e.path));
    });

    await step('Sprache und Theme: Englisch/Dunkel in den Einstellungen, bleibt nach dem Sperren (Anmeldeseite) erhalten', async () => {
        await page.click('#settings-btn');
        const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
        expect(await page.locator('#app-version').innerText() === 'KeePassNC ' + version, 'Version in den Einstellungen');
        await page.selectOption('#s-lang', 'en');
        await page.locator('#s-theme').waitFor();
        await page.selectOption('#s-theme', 'dark');
        expect(await page.locator('html').getAttribute('data-theme') === 'dark', 'Theme');
        await page.click('#settings-close');
        expect(/Save/.test(await page.locator('#save-btn').innerText()) && await page.locator('html').getAttribute('lang') === 'en', 'Englisch');
        await page.click('#reports-btn');
        expect(/Database/.test(await page.locator('.modal .modal-title').innerText()) && await page.locator('#rep-tab-info').innerText() === 'Settings', 'Dialog "Database" mit Tab "Settings"');
        await page.keyboard.press('Escape');
        await page.click('#lock-btn');
        await page.locator('#login-form').waitFor();
        expect(/Open vault/.test(await page.locator('.login-top h2').innerText()), 'Login englisch');
        expect(await page.inputValue('#master') === '', 'Master-Passwort-Feld leer');
        await page.context().close();
    });

    await step('Login-Seite: "Lokale Datei" ist vorgewaehlt; auf sehr breiten Fenstern ragt das Master-Passwort-Feld ueber das Formular, auf schmalen nicht', async () => {
        const measure = (pg) => pg.evaluate(() => { const m = document.querySelector('#master').getBoundingClientRect(), f = document.querySelector('#login-form').getBoundingClientRect(); return { m: m.width, f: f.width, h: m.height, l: m.left - f.left }; });
        const wctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1800, height: 900 } }); // without plainWebdav: the real default tab
        const w = await wctx.newPage();
        await w.goto(base); await w.locator('#login-form').waitFor();
        expect(await w.locator('input[name=src]:checked').getAttribute('value') === 'file', 'Standard-Tab sollte "Lokale Datei" sein');
        const wide = await measure(w);
        expect(wide.m > wide.f && wide.h >= 70 && wide.l < 0, `breit: Feld ${wide.m}px, Formular ${wide.f}px, Hoehe ${wide.h}px`);
        await w.setViewportSize({ width: 1100, height: 900 });
        const narrow = await measure(w);
        expect(narrow.m <= narrow.f && narrow.h < 60, `schmal: Feld ${narrow.m}px, Formular ${narrow.f}px, Hoehe ${narrow.h}px`);
        // drop a file on the picker: highlight while dragging over it, then the name shows and the input holds the file
        const dt = await w.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'drop.kdbx')); return d; });
        await w.dispatchEvent('#file-box .filepick-group', 'dragover', { dataTransfer: dt });
        expect(await w.locator('#file-box .filepick-group').evaluate((el) => el.classList.contains('drop')), 'Ziel nicht hervorgehoben');
        await w.dispatchEvent('#file-box .filepick-group', 'drop', { dataTransfer: dt });
        expect(await w.locator('#file-box .fp-name').innerText() === 'drop.kdbx' && await w.evaluate(() => document.querySelector('#local-file').files.length) === 1, 'Datei per Drop nicht uebernommen');
        expect(!(await w.locator('#file-box .filepick-group').evaluate((el) => el.classList.contains('drop'))), 'Hervorhebung bleibt');
        await wctx.close();
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

    await step('Soft-Lock (Auto-Sperre, lokale Datei mit Passwort + Schluesseldatei): Passwort allein entsperrt nicht, mit Schluesseldatei sofort; die Aenderung ist noch da', async () => {
        const p = await newPage();
        await p.goto(`${base}/?autolock=5`);
        await p.locator('input[value=file]').check({ force: true });
        await p.setInputFiles('#local-file', dbFile);
        await p.fill('#master', meta.password); await p.setInputFiles('#keyfile', KEY);
        await p.click('#open-btn'); await waitOpened(p, 90000);
        await rows(p).first().waitFor();
        await p.locator('[data-testid=entry-row]', { hasText: 'Amazon' }).first().click();
        await p.click('#edit-btn'); await p.fill('#e-user', 'softlock-nutzer'); await p.click('#apply-btn');
        await p.locator('#softlock-form').waitFor({ timeout: 20000 });
        await p.fill('#sl-master', meta.password); await p.click('#sl-unlock');
        await p.locator('#sl-error', { hasText: 'Falsches Master-Passwort' }).waitFor();
        await p.setInputFiles('#sl-keyfile', KEY);
        await p.fill('#sl-master', 'falsch'); await p.click('#sl-unlock');
        await p.locator('#sl-error', { hasText: 'Falsches Master-Passwort' }).waitFor();
        await p.fill('#sl-master', meta.password); await p.click('#sl-unlock');
        await p.locator('#confirm-cancel').click();
        await pick(p, 'Amazon');
        expect((await p.locator('#detail').innerText()).includes('softlock-nutzer'), 'Aenderung nach dem Entsperren nicht mehr da');
        await p.context().close();
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
