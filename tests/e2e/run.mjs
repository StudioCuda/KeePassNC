// End-to-End-Test: echter Chromium-Browser gegen die gebaute App + WebDAV-Testserver; KeePassXC (keepassxc-cli) prueft,
// was tatsaechlich auf dem "Server" gelandet ist. Aufruf: npm run test:e2e
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, browserName, knownEngineNoise, webkitCspWatch, plainWebdav } from '../browser.mjs';
import { startServer } from './davserver.mjs';
import { parseCsv } from '../../src/core/csv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PW = 'Test-Passwort-123';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-e2e-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);

// ---------- KeePassXC als Referenz ----------
function xc(args, file, input = PW + '\n') {
    return execFileSync('keepassxc-cli', [args[0], ...args.slice(1)], { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString('utf8');
}
const kdbxVersion = (f) => { const d = fs.readFileSync(f); return `${d.readUInt16LE(10)}.${d.readUInt16LE(8)}`; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- Fixtures ----------
function makeFixtures() {
    // KDBX4 (Argon2, Anhang, TOTP, Tags, geschuetztes Feld) via pykeepass, danach von KeePassXC selbst gespeichert
    execFileSync('python3', ['-I', path.join(root, 'tests/compat/make-pykeepass-ref.py')], { cwd: tmp });
    fs.renameSync(path.join(tmp, 'ref4.kdbx'), path.join(davRoot, 'vault4.kdbx'));
    xc(['edit', '-q', path.join(davRoot, 'vault4.kdbx'), 'Web/Mail', '--notes', 'Notiz äöü € (KeePassXC)'], null);
    // KDBX3.1 (so legt keepassxc-cli 2.7.6 neue Datenbanken an)
    const v3 = path.join(davRoot, 'vault3.kdbx');
    execFileSync('keepassxc-cli', ['db-create', '-p', v3], { input: `${PW}\n${PW}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('keepassxc-cli', ['add', '-p', '-u', 'alice', '--url', 'https://example.org', v3, 'Mail'], { input: `${PW}\npw-v3-eins\n`, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('keepassxc-cli', ['add', '-p', '-u', 'bob', v3, 'Konto'], { input: `${PW}\npw-v3-zwei\n`, stdio: ['pipe', 'pipe', 'pipe'] });
}

// ---------- Mini-Testrahmen ----------
const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 3).join(' | ') }); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function main() {
    makeFixtures();
    const { server, port, log } = await startServer({ webRoot: path.join(root, 'web'), davRoot });
    const base = `http://127.0.0.1:${port}`;
    const browser = await launchBrowser();
    const problems = { external: [], pageErrors: [], consoleErrors: [] };

    async function newPage(query = '') {
        const ctx = await browser.newContext({ locale: 'de-DE', acceptDownloads: true, viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(plainWebdav);
        const page = await ctx.newPage();
        page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.external.push(r.url()); });
        page.on('pageerror', (e) => problems.pageErrors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !knownEngineNoise(m.text())) problems.consoleErrors.push(`${m.text()} [${m.location().url}:${m.location().lineNumber}, Seite ${page.url().replace(/\?.*/, '')}]`); });
        if (browserName === 'webkit') await ctx.addInitScript(webkitCspWatch);
        await ctx.addInitScript(() => { try { if (!localStorage.getItem("kpnc.settings")) localStorage.setItem("kpnc.settings", JSON.stringify({ autosync: "off" })); } catch {} });
        await page.goto(`${base}/${query}`);
        return page;
    }
    async function login(page, file, { master = PW, pass = 'app-secret' } = {}) {
        await page.locator('input[value=dav]').check({ force: true });
        await page.fill('#dav-url', `${base}/dav/${file}`);
        await page.fill('#dav-user', 'tester');
        await page.fill('#dav-pass', pass);
        await page.fill('#master', master);
        await page.click('#open-btn');
    }
    const status = (page) => page.locator('#status').innerText();
    const waitStatus = (page, re, timeout = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout });
    const rows = (page) => page.locator('[data-testid=entry-row]');
    const f4 = path.join(davRoot, 'vault4.kdbx');

    await step('Falsches Master-Passwort -> verstaendliche Fehlermeldung, kein Absturz', async () => {
        const p = await newPage();
        await login(p, 'vault4.kdbx', { master: 'falsch' });
        await p.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#login-error')?.textContent || ''));
        expect(await p.locator('#login-form').count() === 1, 'Login-Formular sollte sichtbar bleiben');
        await p.context().close();
    });

    await step('Argon2 verlangt 4 GiB Arbeitsspeicher (mehr als WebAssembly je gibt) -> verstaendliche Meldung statt "RangeError"', async () => {
        // Kopie von vault4 mit M = 4 GiB (Bytes) im Dateikopf, samt neuem Kopf-Hash. Der Schluessel wird nie fertig berechnet:
        // die Speicheranforderung scheitert in jedem Browser, unabhaengig vom Geraet.
        const d = Buffer.from(fs.readFileSync(f4));
        const pat = Buffer.from([0x05, 1, 0, 0, 0, 0x4d, 8, 0, 0, 0]); // VariantDictionary: UInt64, Name "M", 8 Byte Wert
        const at = d.indexOf(pat); expect(at > 0, 'Argon2-Parameter M nicht im Kopf gefunden');
        d.writeBigUInt64LE(4n * 1024n * 1024n * 1024n, at + pat.length);
        let o = 12; for (;;) { const id = d[o]; o += 5 + d.readUInt32LE(o + 1); if (id === 0) break; } // Kopffelder bis EndOfHeader
        crypto.createHash('sha256').update(d.subarray(0, o)).digest().copy(d, o);
        fs.writeFileSync(path.join(davRoot, 'hungrig.kdbx'), d);
        const p = await newPage();
        await login(p, 'hungrig.kdbx');
        await p.waitForFunction(() => /4096 MB Arbeitsspeicher/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 60000 });
        expect(!/RangeError|Fehler:/.test(await p.locator('#login-error').innerText()), 'Rohe Fehlermeldung statt verstaendlichem Text');
        await p.context().close();
    });

    await step('Argon2 rechnet in einem Web Worker, der danach beendet wird; ohne Worker-Datei rechnet die Seite selbst', async () => {
        const p = await newPage();
        const workers = [];
        p.on('worker', (w) => { const rec = { url: w.url(), closed: false }; workers.push(rec); w.on('close', () => { rec.closed = true; }); });
        await login(p, 'vault4.kdbx');
        await rows(p).first().waitFor();
        expect(workers.length === 1 && /\/keepassnc-argon2\.js$/.test(workers[0].url), 'Worker erwartet: ' + JSON.stringify(workers));
        for (let i = 0; i < 50 && !workers[0].closed; i++) await p.waitForTimeout(100);
        expect(workers[0].closed, 'Worker laeuft nach der Ableitung weiter');
        await p.context().close();
        // Worker-Datei fehlt (z. B. offline, nie geladen): einmal versuchen, dann auf der Seite rechnen
        const q = await newPage();
        let tries = 0;
        await q.route('**/keepassnc-argon2.js', (r) => { tries++; return r.fulfill({ status: 404, body: '' }); });
        await login(q, 'vault4.kdbx');
        await rows(q).first().waitFor();
        await q.click('#lock-btn'); await q.locator('#login-form').waitFor();
        await login(q, 'vault4.kdbx');
        await rows(q).first().waitFor();
        expect(tries === 1, `Worker-Datei ${tries}-mal angefragt, erwartet einmal`);
        await q.context().close();
    });

    await step('Falsches App-Passwort / fehlende Datei -> Fehlermeldung', async () => {
        const p = await newPage();
        await login(p, 'vault4.kdbx', { pass: 'nope' });
        await p.waitForFunction(() => /Zugriff verweigert/.test(document.querySelector('#login-error')?.textContent || ''));
        await p.fill('#dav-pass', 'app-secret'); await p.fill('#dav-url', `${base}/dav/gibtsnicht.kdbx`); await p.fill('#master', PW); await p.click('#open-btn');
        await p.waitForFunction(() => /nicht gefunden/.test(document.querySelector('#login-error')?.textContent || ''));
        await p.context().close();
    });

    // ---- Hauptlauf mit der KDBX4-Datei ----
    const page = await newPage();
    await step('KDBX4 (von KeePassXC gespeichert) oeffnen: Eintraege, Version, Gruppen', async () => {
        await login(page, 'vault4.kdbx');
        await rows(page).first().waitFor();
        expect(await rows(page).count() === 2, `2 Eintraege erwartet, ${await rows(page).count()} gefunden`);
        expect(/KDBX 4/.test(await status(page)), 'Status zeigt KDBX 4: ' + await status(page));
        const groups = await page.locator('#groups').innerText();
        expect(/Web/.test(groups) && /Bank/.test(groups), 'Gruppen fehlen: ' + groups);
        return await status(page);
    });

    await step('Suche filtert (Treffer / kein Treffer / Tags / Gross-Kleinschreibung)', async () => {
        await page.fill('#search', 'MAIL'); expect(await rows(page).count() === 1, 'Suche "MAIL"');
        await page.fill('#search', 'privat'); expect(await rows(page).count() === 1, 'Suche nach Tag "privat"');
        await page.fill('#search', 'zzzz'); expect(await rows(page).count() === 0, 'Suche ohne Treffer');
        await page.fill('#search', ''); expect(await rows(page).count() === 2, 'Suche geleert');
    });

    await step('Detailansicht: Passwort verborgen/anzeigbar, Notiz mit Umlauten, Tags, geschuetztes Zusatzfeld, TOTP', async () => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        expect(/alice/.test(await page.locator('[data-testid=f-user]').innerText()), 'Benutzer');
        expect(!/pw-eins/.test(await page.locator('[data-testid=pw-value]').innerText()), 'Passwort darf nicht offen stehen');
        await page.click('[data-testid=pw-toggle]');
        expect(await page.locator('[data-testid=pw-value]').innerText() === 'pw-eins', 'Passwort nach Anzeigen');
        expect(/äöü € \(KeePassXC\)/.test(await page.locator('#detail').innerText()), 'Notiz mit Umlauten');
        expect(/mail[\s,]+privat|privat[\s,]+mail/.test(await page.locator('[data-testid=f-tags]').innerText()), 'Tags');
        expect(!/1234/.test(await page.locator('[data-testid=custom-PIN]').innerText()), 'geschuetztes Feld darf nicht offen stehen');
        // TOTP gegen KeePassXC vergleichen (bis zu 3 Versuche wegen Fenstergrenze)
        let ok = false, a, b;
        for (let i = 0; i < 3 && !ok; i++) {
            a = (await page.locator('[data-testid=totp-code]').innerText()).trim();
            b = xc(['show', '-t', f4, 'Web/Mail']).trim().split('\n').pop();
            ok = a === b;
            if (!ok) await page.waitForTimeout(1200);
        }
        expect(ok, `TOTP weicht von KeePassXC ab: App ${a} vs. KeePassXC ${b}`);
        return `TOTP ${a}`;
    });

    await step('Steam-TOTP (encoder=steam): 5 Zeichen, identisch mit KeePassXC; Seitenleiste ohne Tags zeigt kein "null"', async () => {
        const fs3 = path.join(davRoot, 'steam.kdbx');
        execFileSync('python3', ['-I', '-c', [
            'from pykeepass import create_database',
            `kp = create_database(${JSON.stringify(fs3)}, password=${JSON.stringify(PW)})`,
            "e = kp.add_entry(kp.root_group, 'Steam', 'anna', 'x')",
            "e.otp = 'otpauth://totp/Steam:anna?secret=JBSWY3DPEHPK3PXP&issuer=Steam&encoder=steam'",
            'kp.save()'].join('\n')]);
        const p = await newPage();
        await login(p, 'steam.kdbx'); await rows(p).first().waitFor();
        // Datei ohne Tags: die Tag-Leiste fehlt, und es darf kein "null" an ihrer Stelle stehen
        const groups = await p.locator('#groups').innerText();
        expect(!/null/.test(groups), 'Seitenleiste zeigt "null": ' + groups);
        expect(await p.locator('#groups [data-testid=tag-chip]').count() === 0, 'Tag-Chips ohne Tags');
        await p.locator('[data-testid=entry-row]', { hasText: 'Steam' }).click();
        let ok = false, a, b;
        for (let i = 0; i < 3 && !ok; i++) { // bis zu 3 Versuche wegen Fenstergrenze
            a = (await p.locator('[data-testid=totp-code]').innerText()).trim();
            b = xc(['show', '-t', fs3, 'Steam']).trim().split('\n').pop();
            ok = a === b;
            if (!ok) await p.waitForTimeout(1200);
        }
        expect(/^[2-9BCDFGHJKMNPQRTVWXY]{5}$/.test(a), 'kein Steam-Code: ' + a);
        expect(ok, `Steam-TOTP weicht von KeePassXC ab: App ${a} vs. KeePassXC ${b}`);
        await p.context().close();
        return `Steam ${a}`;
    });

    await step('Passkey: Duplizieren kopiert ihn nicht mit; "Passkey entfernen" entfernt ihn, alter Stand bleibt im Verlauf (Pruefung mit pykeepass)', async () => {
        const fpk = path.join(davRoot, 'passkey.kdbx');
        const py = (lines) => execFileSync('python3', ['-I', '-c', lines.join('\n')]).toString();
        py(['import base64, os', 'from pykeepass import create_database',
            `kp = create_database(${JSON.stringify(fpk)}, password=${JSON.stringify(PW)})`,
            "e = kp.add_entry(kp.root_group, 'Passkey example.org', 'anna@example.org', 'pw', url='https://example.org')",
            "for k, v, p in [('KPEX_PASSKEY_USERNAME', 'anna@example.org', False), ('KPEX_PASSKEY_CREDENTIAL_ID', base64.urlsafe_b64encode(os.urandom(32)).decode(), True),",
            "                ('KPEX_PASSKEY_PRIVATE_KEY_PEM', '-----BEGIN PRIVATE KEY-----\\nMIGHAgEA\\n-----END PRIVATE KEY-----', True), ('KPEX_PASSKEY_RELYING_PARTY', 'example.org', False),",
            "                ('KPEX_PASSKEY_USER_HANDLE', base64.urlsafe_b64encode(os.urandom(16)).decode(), True)]:",
            '    e.set_custom_property(k, v, protect=p)',
            'kp.save()']);
        const p = await newPage();
        await login(p, 'passkey.kdbx'); await rows(p).first().waitFor();
        const original = () => p.locator('[data-testid=entry-row]', { hasText: /Passkey example\.org(?! - Kopie)/ });
        await original().click();
        await p.click('#entry-more'); await p.getByText('Duplizieren', { exact: true }).click(); await p.click('#dup-ok');
        await p.waitForFunction(() => /- Kopie/.test(document.querySelector('#detail h2')?.textContent || ''));
        expect(await p.locator('[data-testid=passkey-card]').count() === 0, 'Kopie zeigt noch einen Passkey');
        await original().click();
        await p.locator('[data-testid=passkey-card]').waitFor();
        await p.click('[data-testid=passkey-remove]'); await p.click('#confirm-ok');
        await p.waitForFunction(() => !document.querySelector('[data-testid=passkey-card]'));
        await p.click('#save-btn'); await waitStatus(p, /^Gespeichert/, 30000);
        const out = JSON.parse(py(['import json', 'from pykeepass import PyKeePass', `kp = PyKeePass(${JSON.stringify(fpk)}, password=${JSON.stringify(PW)})`,
            "pk = lambda x: sorted(k for k in x.custom_properties if k.startswith('KPEX_PASSKEY_'))",
            'print(json.dumps({e.title: {"now": pk(e), "history": [len(pk(h)) for h in e.history]} for e in kp.entries}))']));
        const o = out['Passkey example.org'], c = out['Passkey example.org - Kopie'];
        expect(o && o.now.length === 0, 'Original hat noch Passkey-Felder: ' + JSON.stringify(o));
        expect(o.history.includes(5), 'alter Stand mit Passkey fehlt im Verlauf: ' + JSON.stringify(o));
        expect(c && c.now.length === 0 && c.history.length === 0, 'Kopie: ' + JSON.stringify(c));
        await p.context().close();
    });

    await step('Anhang herunterladen: Inhalt byte-identisch', async () => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=attachment]')]);
        const got = fs.readFileSync(await dl.path());
        expect(got.toString() === 'anhang-inhalt\n', 'Anhang-Inhalt: ' + JSON.stringify(got.toString()));
    });

    let newPassword;
    await step('Bearbeiten + Passwort erzeugen + Speichern -> KeePassXC liest Ergebnis; Sicherungskopie liegt auf dem Server', async () => {
        await page.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await page.click('#edit-btn');
        await page.click('#gen-btn'); await page.click('#gen-tab-pw');
        await page.click('#gen-use');
        await page.click('#e-show');
        newPassword = await page.inputValue('#e-pass');
        expect(newPassword.length === 24, 'erzeugtes Passwort hat 24 Zeichen, ist: ' + newPassword.length);
        await page.fill('#e-user', 'alice-neu');
        await page.click('#apply-btn');
        expect(/Speichern \*/.test(await page.locator('#save-btn').innerText()), 'Ungespeichert-Markierung');
        await page.click('#save-btn');
        await waitStatus(page, /^Gespeichert\./);
        const show = xc(['show', '-s', f4, 'Web/Mail']);
        expect(show.includes(`Password: ${newPassword}`) && show.includes('UserName: alice-neu'), 'KeePassXC sieht neues Passwort/Benutzer nicht:\n' + show);
        expect(show.includes('Notiz äöü € (KeePassXC)') && /Tags: (mail,privat|privat,mail)/.test(show), 'Notiz/Tags verloren');
        expect(xc(['show', '-s', '-a', 'PIN', f4, 'Web/Mail']).trim().split('\n').pop() === '1234', 'geschuetztes Feld verloren');
        expect(/^\d{6}$/.test(xc(['show', '-t', f4, 'Web/Mail']).trim().split('\n').pop()), 'TOTP verloren');
        const att = path.join(tmp, 'att.bin'); xc(['attachment-export', f4, 'Bank/Konto', 'anhang.txt', att]);
        expect(fs.readFileSync(att, 'utf8') === 'anhang-inhalt\n', 'Anhang verloren');
        const baks = fs.readdirSync(davRoot).filter((n) => /^vault4\.kdbx\..*\.bak$/.test(n));
        expect(baks.length === 1, `genau 1 Sicherungskopie erwartet, gefunden: ${baks}`);
        xc(['ls', '-R', path.join(davRoot, baks[0])]); // Sicherung ist selbst eine gueltige, oeffnbare Datenbank
        return `Version ${kdbxVersion(f4)}, Sicherung ${baks[0]}`;
    });

    await step('Neuer Eintrag mit geschuetztem Zusatzfeld -> KeePassXC sieht ihn; zweiter Speichervorgang legt keine weitere Kopie an', async () => {
        await page.click('#new-btn');
        await page.fill('#e-title', 'Neu E2E'); await page.fill('#e-user', 'dave'); await page.fill('#e-pass', 'pw-neu');
        await page.click('#add-custom');
        await page.fill('.c-name', 'API-Key'); await page.fill('.c-value', 'geheim-123'); await page.check('.c-protect');
        await page.click('#apply-btn'); await page.click('#save-btn'); await waitStatus(page, /^Gespeichert\./);
        const show = xc(['show', '-s', f4, 'Web/Neu E2E']);
        expect(show.includes('UserName: dave') && show.includes('Password: pw-neu'), 'neuer Eintrag:\n' + show);
        expect(xc(['show', '-s', '-a', 'API-Key', f4, 'Web/Neu E2E']).trim().split('\n').pop() === 'geheim-123', 'Zusatzfeld');
        expect(fs.readdirSync(davRoot).filter((n) => /^vault4\.kdbx\..*\.bak$/.test(n)).length === 1, 'es darf nur eine Kopie pro Sitzung entstehen');
    });

    await step('"Nicht in der Passwort-Gesundheit pruefen": KnownBad landet in der Datei, is:weak laesst den Eintrag weg, Abwaehlen nimmt es zurueck', async () => {
        const weakRows = async () => { await page.fill('#search', 'is:weak'); await page.waitForTimeout(300); return page.locator('[data-testid=entry-row]', { hasText: 'Neu E2E' }).count(); };
        // KeePassXC liest KnownBad, gibt es im XML-Export aber nicht aus: deshalb pykeepass als zweite Meinung
        const knownBad = () => execFileSync('python3', ['-I', '-c', ['from pykeepass import PyKeePass', `kp = PyKeePass(${JSON.stringify(f4)}, password=${JSON.stringify(PW)})`,
            "cd = kp.find_entries(title='Neu E2E', first=True)._element.find('CustomData')",
            "print(any(i.findtext('Key') == 'KnownBad' and i.findtext('Value') == 'True' for i in ([] if cd is None else cd)))"].join('\n')]).toString().trim() === 'True';
        expect(await weakRows() === 1, '"pw-neu" sollte als schwach gelten');
        const toggle = async (on) => {
            await page.fill('#search', ''); await page.locator('[data-testid=entry-row]', { hasText: 'Neu E2E' }).click();
            await page.click('#edit-btn');
            expect(await page.isChecked('#e-noreport') === !on, 'Haken stimmt vor dem Umschalten nicht');
            await page.setChecked('#e-noreport', on);
            await page.click('#apply-btn'); await page.click('#save-btn'); await waitStatus(page, /^Gespeichert\./);
        };
        await toggle(true);
        expect(knownBad(), 'KnownBad fehlt in der Datei');
        expect(await weakRows() === 0, 'ausgeschlossener Eintrag steht noch unter is:weak');
        await toggle(false);
        expect(!knownBad(), 'KnownBad nach dem Abwaehlen noch da');
        expect(await weakRows() === 1, 'nach dem Abwaehlen wieder schwach');
        await page.fill('#search', '');
    });

    await step('Mehrzeilige Zusatzfelder (offen und geschuetzt): Anzeige mit Umbruechen, Bearbeiten behaelt sie, KeePassXC liest sie', async () => {
        const plain = 'Zeile 1\nZeile 2\n\nZeile 4', secret = 'geheim A\ngeheim B';
        await page.fill('#search', ''); await page.locator('[data-testid=entry-row]', { hasText: 'Neu E2E' }).click();
        await page.click('#edit-btn');
        await page.click('#add-custom'); await page.locator('.c-name').last().fill('Codes'); await page.locator('.c-value').last().fill(plain);
        await page.click('#add-custom'); await page.locator('.c-name').last().fill('Seed'); await page.locator('.c-value').last().fill(secret); await page.locator('.c-protect').last().check();
        expect(await page.locator('.c-value').last().isHidden(), 'geschuetzter Wert muss im Editor verdeckt sein');
        await page.click('#apply-btn');
        expect(await page.locator('[data-testid="custom-Codes"]').innerText() === plain, 'Anzeige ohne Umbrueche: ' + JSON.stringify(await page.locator('[data-testid="custom-Codes"]').innerText()));
        // erneut bearbeiten und unveraendert uebernehmen: Umbrueche bleiben, auch im verdeckten Feld
        await page.click('#edit-btn');
        const seedRow = page.locator('.custom-row').last();
        expect(await seedRow.locator('.c-name').inputValue() === 'Seed', 'Reihenfolge der Zusatzfelder');
        expect(await seedRow.locator('.c-value').isHidden(), 'geschuetzter Wert beim erneuten Bearbeiten offen');
        await seedRow.locator('.c-eye').click();
        expect(await seedRow.locator('.c-value').inputValue() === secret, 'geschuetzter Wert nach "Anzeigen" falsch');
        await page.click('#apply-btn'); await page.click('#save-btn'); await waitStatus(page, /^Gespeichert\./);
        expect(xc(['show', '-s', '-a', 'Codes', f4, 'Web/Neu E2E']).includes(plain), 'KeePassXC: Codes ohne Umbrueche');
        expect(xc(['show', '-s', '-a', 'Seed', f4, 'Web/Neu E2E']).includes(secret), 'KeePassXC: Seed ohne Umbrueche');
    });

    await step('Loeschen verschiebt in den Papierkorb (KeePassXC zeigt "Recycle Bin")', async () => {
        await page.fill('#search', ''); await page.locator('[data-testid=entry-row]', { hasText: 'Neu E2E' }).click();
        await page.click('#del-btn'); await page.click('#save-btn'); await waitStatus(page, /^Gespeichert\./);
        const ls = xc(['ls', '-R', f4]);
        expect(/Recycle Bin\/[\s\S]*Neu E2E/.test(ls) && !/^Web\/[\s\S]*Neu E2E[\s\S]*Bank/m.test(ls.split('Recycle Bin')[0]), 'Papierkorb:\n' + ls);
    });
    await page.context().close();

    await step('Konflikt: anderes Geraet aendert die Datei zwischenzeitlich -> Zusammenfuehrung, beide Aenderungen bleiben, Server-Stand wird gesichert', async () => {
        const p = await newPage();
        await login(p, 'vault4.kdbx'); await rows(p).first().waitFor();
        await p.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', 'bob-aus-App'); await p.click('#apply-btn');
        await p.waitForTimeout(1100);
        xc(['edit', '-q', f4, 'Web/Mail', '--url', 'https://extern.example'], null); // "anderes Geraet"
        await p.click('#save-btn');
        await waitStatus(p, /zusammengef/);
        const k = xc(['show', f4, 'Bank/Konto']), m = xc(['show', f4, 'Web/Mail']);
        expect(k.includes('bob-aus-App'), 'App-Aenderung fehlt:\n' + k);
        expect(m.includes('https://extern.example'), 'externe Aenderung ging verloren:\n' + m);
        expect(fs.readdirSync(davRoot).some((n) => /\.conflict-.*\.bak$/.test(n)), 'conflict-Sicherung fehlt');
        await p.context().close();
    });

    await step('Konflikt, anderes Geraet hat die Schluesselableitung verstaerkt -> sie bleibt nach dem Zusammenfuehren erhalten, beide Aenderungen auch', async () => {
        const py = (lines) => JSON.parse(execFileSync('python3', ['-I', '-c', ['import json', 'from pykeepass import PyKeePass', `kp = PyKeePass(${JSON.stringify(f4)}, password=${JSON.stringify(PW)})`,
            'kdf = kp.kdbx.header.value.dynamic_header.kdf_parameters.data.dict', ...lines].join('\n')]).toString());
        const before = py(['print(json.dumps([kdf.M.value, kdf.I.value]))']);
        const p = await newPage();
        await login(p, 'vault4.kdbx'); await rows(p).first().waitFor();
        await p.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', 'bob-trotz-KDF'); await p.click('#apply-btn');
        // "anderes Geraet": doppelter Speicher, ein Durchlauf mehr, dazu eine Aenderung am Inhalt
        const want = py(['kdf.M.value, kdf.I.value = kdf.M.value * 2, kdf.I.value + 1', "e = kp.find_entries(title='Mail', first=True); e.url = 'https://kdf.example'; e.touch(modify=True)", 'kp.save()',
            'print(json.dumps([kdf.M.value, kdf.I.value]))']);
        expect(want[0] === before[0] * 2, 'Vorbereitung: KDF nicht geaendert ' + JSON.stringify([before, want]));
        await p.click('#save-btn');
        await waitStatus(p, /zusammengef/);
        const after = py(['k = kp.find_entries(title="Konto", first=True); m = kp.find_entries(title="Mail", first=True)',
            'print(json.dumps([kdf.M.value, kdf.I.value, k.username, m.url]))']);
        expect(after[0] === want[0] && after[1] === want[1], `Schluesselableitung zurueckgesetzt: vorher ${before}, anderes Geraet ${want}, jetzt ${after.slice(0, 2)}`);
        expect(after[2] === 'bob-trotz-KDF' && after[3] === 'https://kdf.example', 'Aenderung verloren: ' + JSON.stringify(after.slice(2)));
        expect(xc(['show', f4, 'Bank/Konto']).includes('bob-trotz-KDF'), 'KeePassXC liest das Ergebnis nicht');
        // und ohne Aenderung am Kopf auf dem Server bleibt der eigene (jetzt verstaerkte) Kopf: zweiter Konflikt nur mit Inhalt
        await p.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', 'bob-zweite-Runde'); await p.click('#apply-btn');
        await p.waitForTimeout(1100);
        xc(['edit', '-q', f4, 'Web/Mail', '--url', 'https://zweite.example'], null);
        await p.evaluate(() => { document.querySelector('#status').textContent = ''; }); // Meldung der ersten Runde nicht mitzaehlen
        await p.click('#save-btn');
        await waitStatus(p, /zusammengef/);
        const last = py(['k = kp.find_entries(title="Konto", first=True); m = kp.find_entries(title="Mail", first=True)', 'print(json.dumps([kdf.M.value, kdf.I.value, k.username, m.url]))']);
        expect(last[0] === want[0] && last[1] === want[1], 'Kopf nach zweitem Konflikt: ' + JSON.stringify(last));
        expect(last[2] === 'bob-zweite-Runde' && last[3] === 'https://zweite.example', 'zweite Runde: ' + JSON.stringify(last.slice(2)));
        await p.context().close();
    });

    await step('Auto-Sperre: nach Inaktivitaet verschwinden alle Daten aus dem DOM', async () => {
        const p = await newPage('?autolock=5');
        await login(p, 'vault4.kdbx'); await rows(p).first().waitFor();
        await p.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await p.click('[data-testid=pw-toggle]');
        // Grosse Ansicht offen lassen: der Dialog haengt an <body> und muss mit dem Sperren verschwinden
        await p.click('[data-testid=pw-large]'); await p.locator('[data-testid=large-type]').waitFor();
        await p.waitForFunction(() => /Automatisch gesperrt/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 15000 });
        const html = await p.content();
        expect(!/alice|extern\.example|Notiz/.test(html), 'Nach dem Sperren stehen noch Daten im DOM');
        expect(await p.locator('.backdrop, .modal, [data-testid=large-type]').count() === 0, 'Nach dem Sperren ist noch ein Dialog offen');
        expect(await p.inputValue('#master') === '', 'Master-Passwort-Feld muss leer sein');
        await p.context().close();
    });

    await step('Auto-Sperre mit ungespeicherten Aenderungen (WebDAV): speichert zuerst, dann sperrt sie', async () => {
        const p = await newPage('?autolock=5');
        await login(p, 'vault4.kdbx'); await rows(p).first().waitFor();
        await p.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', 'bob-auto-gespeichert'); await p.click('#apply-btn');
        await p.waitForFunction(() => /Automatisch gesperrt/.test(document.querySelector('#login-error')?.textContent || ''), null, { timeout: 20000 });
        for (let i = 0; i < 20 && !xc(['show', f4, 'Bank/Konto']).includes('bob-auto-gespeichert'); i++) await new Promise((r) => setTimeout(r, 500));
        expect(xc(['show', f4, 'Bank/Konto']).includes('bob-auto-gespeichert'), 'Aenderung ging beim Auto-Sperren verloren');
        await p.context().close();
    });

    await step('KDBX 3.1: oeffnen, aendern, speichern -> bleibt 3.1 und KeePassXC liest es', async () => {
        const f3 = path.join(davRoot, 'vault3.kdbx');
        const p = await newPage();
        await login(p, 'vault3.kdbx'); await rows(p).first().waitFor();
        expect(/KDBX 3\.1/.test(await status(p)), 'Status: ' + await status(p));
        await p.locator('[data-testid=entry-row]', { hasText: 'Mail' }).click();
        await p.click('#edit-btn'); await p.fill('#e-pass', 'pw-v3-neu'); await p.click('#apply-btn'); await p.click('#save-btn');
        await waitStatus(p, /^Gespeichert\./);
        expect(kdbxVersion(f3) === '3.1', 'Version geaendert: ' + kdbxVersion(f3));
        expect(xc(['show', '-s', f3, 'Mail']).includes('Password: pw-v3-neu'), 'Passwort v3');
        expect(xc(['show', '-s', f3, 'Konto']).includes('Password: pw-v3-zwei'), 'anderer Eintrag v3 unveraendert');
        await p.context().close();
    });

    const fUp = path.join(davRoot, 'v3-hoch.kdbx');
    const openDbSettings = async (p) => { await p.click('#reports-btn'); await p.click('#rep-tab-info'); await p.click('#db-settings-btn'); await p.locator('#db-settings').waitFor(); };
    await step('Sicherheit: KDBX 3.1 mit AES-KDF -> KDBX 4, Argon2id 64 MiB / 3, ChaCha20; Probelauf, danach oeffnen KeePassXC und die App die Datei', async () => {
        fs.copyFileSync(path.join(davRoot, 'vault3.kdbx'), fUp);
        const p = await newPage();
        await login(p, 'v3-hoch.kdbx'); await rows(p).first().waitFor();
        await openDbSettings(p);
        const rounds = Number(await p.inputValue('#db-rounds'));
        expect(rounds > 0 && (await p.locator('.report-body').innerText()).includes(String(rounds)), 'KDBX 3.1: AES-KDF-Runden in Info und Dialog: ' + rounds);
        expect(!(await p.isChecked('#db-upgrade')) && !(await p.isDisabled('#db-upgrade')), 'Umstellen auf KDBX 4 sollte frei waehlbar und aus sein');
        expect(await p.locator('#db-cipher option[value=twofish]').count() === 0, 'Twofish steht nur bei Dateien zur Wahl, die es schon nutzen');
        await p.selectOption('#db-kdf', 'argon2id');
        expect(await p.isChecked('#db-upgrade') && await p.isDisabled('#db-upgrade'), 'Argon2 erzwingt KDBX 4');
        await p.selectOption('#db-cipher', 'chacha20');
        await p.selectOption('#db-memory', '64'); await p.fill('#db-iterations', '3'); await p.selectOption('#db-parallelism', '2');
        expect(/Passt für Handy/.test(await p.locator('#db-level').innerText()), 'Ampel gruen bei 64 MiB');
        await p.click('#db-apply');
        await p.waitForFunction(() => !document.querySelector('#db-settings'), null, { timeout: 30000 }); // Probelauf, keine Rueckfrage
        await p.keyboard.press('Escape');
        await p.click('#save-btn'); await waitStatus(p, /^Gespeichert\./, 30000);
        expect(kdbxVersion(fUp) === '4.0', 'Version: ' + kdbxVersion(fUp));
        const dbi = xc(['db-info', fUp]);
        expect(/Cipher: ChaCha20/i.test(dbi) && /KDF: Argon2id/i.test(dbi), 'KeePassXC db-info:\n' + dbi);
        expect(xc(['show', '-s', fUp, 'Konto']).includes('Password: pw-v3-zwei'), 'Eintrag nach dem Umstellen');
        await p.context().close();
        const q = await newPage();
        await login(q, 'v3-hoch.kdbx'); await rows(q).first().waitFor();
        await q.click('#reports-btn'); await q.click('#rep-tab-info');
        const info = await q.locator('.report-body').innerText();
        expect(/KDBX 4/.test(info) && /ChaCha20/.test(info) && /Argon2id/.test(info) && /64 MiB/.test(info), 'Info nach dem Neuladen: ' + info);
        await q.context().close();
        return dbi.split('\n').filter((l) => /^(Cipher|KDF)/.test(l)).join(', ');
    });

    await step('Sicherheit: Twofish-Datei (KDBX 3.1) bleibt Twofish, KeePassXC liest und bearbeitet, die App oeffnet das Ergebnis', async () => {
        const fTf = path.join(davRoot, 'twofish.kdbx');
        fs.copyFileSync(path.join(davRoot, 'vault3.kdbx'), fTf);
        // Die App stellt nicht mehr auf Twofish um, also verschluesselt kdbxweb die Kopie neu
        execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', [
            `const k = require('./vendor/kdbxweb/lib/index'), fs = require('fs'), f = ${JSON.stringify(fTf)};`,
            `k.Kdbx.load(new Uint8Array(fs.readFileSync(f)).buffer, new k.Credentials(k.ProtectedValue.fromString(${JSON.stringify(PW)})))`,
            '    .then((db) => { db.header.dataCipherUuid = new k.KdbxUuid(k.Consts.CipherId.Twofish); return db.save(); })',
            '    .then((b) => fs.writeFileSync(f, Buffer.from(b)), (e) => { console.error(e); process.exit(1); });'].join('\n')], { cwd: root });
        expect(/Cipher: Twofish/i.test(xc(['db-info', fTf])), 'Testdatei ist kein Twofish');
        const p = await newPage();
        await login(p, 'twofish.kdbx'); await rows(p).first().waitFor();
        await openDbSettings(p);
        expect(await p.inputValue('#db-cipher') === 'twofish', 'Twofish sollte vorausgewaehlt sein');
        await p.fill('#db-name', 'Twofish bleibt');
        await p.click('#db-apply');
        await p.waitForFunction(() => !document.querySelector('#db-settings'), null, { timeout: 30000 });
        await p.keyboard.press('Escape');
        await p.click('#save-btn'); await waitStatus(p, /^Gespeichert\./, 30000);
        await p.context().close();
        expect(kdbxVersion(fTf) === '3.1', 'Version: ' + kdbxVersion(fTf));
        expect(/Cipher: Twofish/i.test(xc(['db-info', fTf])), 'KeePassXC db-info:\n' + xc(['db-info', fTf]));
        await new Promise((r) => setTimeout(r, 1100)); // KeePassXC nicht in der Sekunde der letzten Aenderung bearbeiten lassen
        xc(['edit', fTf, 'Konto', '-u', 'von-keepassxc']);
        const q = await newPage();
        await login(q, 'twofish.kdbx'); await rows(q).first().waitFor();
        expect(/von-keepassxc/.test(await q.locator('[data-testid=entry-row]', { hasText: 'Konto' }).innerText()), 'Aenderung von KeePassXC fehlt');
        await q.click('#reports-btn'); await q.click('#rep-tab-info');
        const info = await q.locator('.report-body').innerText();
        expect(/Twofish/.test(info) && /Twofish bleibt/.test(info), 'Info nach dem Neuladen: ' + info);
        await q.context().close();
    });

    await step('Sicherheit: Rueckfrage bei "schwaecher" und bei 1 GiB, Abbrechen aendert nichts; "≈ 1 s" schlaegt nie weniger Arbeit vor', async () => {
        const p = await newPage();
        await login(p, 'v3-hoch.kdbx'); await rows(p).first().waitFor();
        await openDbSettings(p);
        const confirmText = async () => { await p.locator('#confirm-ok').waitFor(); return p.locator('.modal', { has: p.locator('#confirm-ok') }).innerText(); };
        await p.fill('#db-iterations', '2'); await p.click('#db-apply');
        expect(/Schwächer als bisher/.test(await confirmText()), 'Rueckfrage "schwaecher" fehlt');
        await p.click('#confirm-cancel');
        await p.fill('#db-iterations', '3'); await p.selectOption('#db-memory', '1024');
        expect(/Viele Handys/.test(await p.locator('#db-level').innerText()), 'Ampel rot bei 1 GiB');
        await p.click('#db-apply');
        expect(/Sehr viel Speicher/.test(await confirmText()), 'Rueckfrage 1 GiB fehlt');
        await p.click('#confirm-cancel');
        await p.selectOption('#db-memory', '64'); await p.fill('#db-iterations', '1');
        await p.click('#db-bench');
        await p.waitForFunction(() => /\d s/.test(document.querySelector('#db-bench-note')?.textContent || ''), null, { timeout: 30000 });
        const it = Number(await p.inputValue('#db-iterations'));
        expect(it >= 3, 'Vorschlag unter der bisherigen Arbeit: ' + it);
        await p.locator('#db-settings button', { hasText: 'Abbrechen' }).click();
        expect(await p.isDisabled('#save-btn'), 'Abbrechen hat etwas geaendert (Speichern ist aktiv)');
        await p.context().close();
        return `Vorschlag ${it} Durchlaeufe`;
    });

    await step('Zusammenfuehren: Konfliktkopie aus dem Ordner, Kopie mit anderem Passwort vom Geraet, fremde Datenbank wird abgelehnt', async () => {
        const fM = path.join(davRoot, 'merge.kdbx'), fC = path.join(davRoot, 'merge (conflicted copy 2026-10-19 090000).kdbx');
        fs.copyFileSync(path.join(davRoot, 'vault4.kdbx'), fM); fs.copyFileSync(fM, fC);
        xc(['add', '-q', '-u', 'handy', fC, 'Web/Vom Handy']);
        xc(['edit', '-q', fC, 'Bank/Konto', '-u', 'bob-handy']);
        const otherPw = path.join(tmp, 'merge-anderes-pw.kdbx'); // Kopie mit anderem Master-Passwort und einem eigenen Eintrag
        execFileSync('python3', ['-I', '-c', ['from pykeepass import PyKeePass', `kp = PyKeePass(${JSON.stringify(fM)}, password=${JSON.stringify(PW)})`,
            "kp.add_entry(kp.find_groups(name='Web', first=True), 'Vom Laptop', 'carol', 'pw-laptop')", `kp.password = 'anderes-pw'`, 'from datetime import datetime, timezone', 'kp.credchange_date = datetime(2030, 1, 1, tzinfo=timezone.utc)', `kp.save(${JSON.stringify(otherPw)})`].join('\n')]);
        const foreign = path.join(tmp, 'fremd.kdbx');
        execFileSync('keepassxc-cli', ['db-create', '-q', '-p', foreign], { input: `${PW}\n${PW}\n` });
        const p = await newPage();
        await login(p, 'merge.kdbx'); await rows(p).first().waitFor();
        const openMerge = async () => { await p.click('#reports-btn'); await p.click('#rep-tab-info'); await p.click('#merge-btn'); await p.locator('#merge-form').waitFor(); };
        const toastText = () => p.locator('.toast').last().innerText();
        const keyChanged = async () => {
            await p.click('#reports-btn'); await p.click('#rep-tab-info');
            const row = await p.locator('.report-body .kv', { hasText: 'Zugangsdaten geändert' }).innerText().catch(() => '');
            await p.keyboard.press('Escape'); return row;
        };
        const keyChanged0 = await keyChanged();

        await openMerge();
        await p.locator('#merge-form label', { hasText: 'conflicted copy' }).waitFor({ timeout: 5000 }).catch(() => {});
        const others = await p.locator('#merge-form [role=radiogroup] label').allInnerTexts();
        expect(others.some((x) => x.includes('conflicted copy')) && !others.some((x) => /^merge\.kdbx/.test(x)), 'Ordnerliste: ' + others.join(' | '));
        await p.locator('#merge-form label', { hasText: 'conflicted copy' }).click();
        await p.click('#merge-apply');
        await p.locator('#merge-form').waitFor({ state: 'detached' });
        expect(/1 neu, 1 geändert/.test(await toastText()), 'Meldung: ' + await toastText());

        await openMerge();
        await p.setInputFiles('#merge-file', foreign); await p.click('#merge-apply'); // gleiches Passwort, aber eine andere Datenbank
        await p.waitForFunction(() => /andere Datenbank/.test(document.querySelector('#merge-error')?.textContent || ''));
        await p.locator('#merge-form button', { hasText: 'Abbrechen' }).click();

        await openMerge();
        await p.setInputFiles('#merge-file', otherPw); await p.click('#merge-apply');
        await p.locator('#merge-pw').waitFor();
        await p.fill('#merge-pw', 'falsch'); await p.click('#merge-apply');
        await p.waitForFunction(() => /Falsches Master-Passwort/.test(document.querySelector('#merge-error')?.textContent || ''));
        await p.fill('#merge-pw', 'anderes-pw'); await p.click('#merge-apply');
        await p.locator('#merge-form').waitFor({ state: 'detached' });
        expect(/1 neu/.test(await toastText()), 'Meldung: ' + await toastText());

        expect(await keyChanged() === keyChanged0, `Datum der Zugangsdaten kam aus der Kopie mit: ${keyChanged0} -> ${await keyChanged()}`);
        await p.click('#save-btn'); await waitStatus(p, /^Gespeichert\./);
        await p.context().close();
        const ls = xc(['ls', '-R', fM]);
        expect(ls.includes('Vom Handy') && ls.includes('Vom Laptop'), 'Eintraege fehlen:\n' + ls);
        expect(xc(['show', '-s', fM, 'Bank/Konto']).includes('UserName: bob-handy'), 'Aenderung aus der Konfliktkopie fehlt');
        expect(xc(['show', '-s', fM, 'Web/Vom Laptop']).includes('Password: pw-laptop'), 'Eintrag von der Kopie mit anderem Passwort');
    });

    await step('Platzhalter: {S:…} und {USERNAME} in Benutzername und URL werden angezeigt und verlinkt, der Editor behaelt sie', async () => {
        fs.copyFileSync(path.join(davRoot, 'vault4.kdbx'), path.join(davRoot, 'platzhalter.kdbx'));
        const p = await newPage();
        await login(p, 'platzhalter.kdbx'); await rows(p).first().waitFor();
        await p.click('#new-btn');
        await p.fill('#e-title', 'Platzhalter'); await p.fill('#e-user', '{S:Login}'); await p.fill('#e-url', 'https://{S:Host}/{USERNAME}');
        await p.click('#add-custom'); await p.locator('.c-name').last().fill('Login'); await p.locator('.c-value').last().fill('carol');
        await p.click('#add-custom'); await p.locator('.c-name').last().fill('Host'); await p.locator('.c-value').last().fill('example.org');
        await p.click('#apply-btn');
        expect(await p.locator('[data-testid=f-user]').innerText() === 'carol', 'Benutzername: ' + await p.locator('[data-testid=f-user]').innerText());
        const link = p.locator('[data-testid=f-url]');
        expect(await link.innerText() === 'https://example.org/carol' && await link.getAttribute('href') === 'https://example.org/carol', 'URL: ' + await link.innerText());
        expect(/carol/.test(await rows(p).filter({ hasText: 'Platzhalter' }).innerText()), 'Liste zeigt den Platzhalter statt carol');
        await p.click('#edit-btn');
        expect(await p.inputValue('#e-user') === '{S:Login}' && await p.inputValue('#e-url') === 'https://{S:Host}/{USERNAME}', 'Editor muss die Platzhalter zeigen');
        await p.click('#cancel-btn');
        // Ein (z. B. importierter) Eintrag, dessen URL das Passwort eines anderen Eintrags einsetzen wuerde: Link, Anzeige, Liste und
        // "URL kopieren" behalten den Platzhalter, der Benutzername daneben wird weiter aufgeloest
        const mailField = (a) => xc(['show', '-s', '-a', a, path.join(davRoot, 'platzhalter.kdbx'), 'Web/Mail']).trim().split('\n').pop();
        const mailPw = mailField('Password'), mailUser = mailField('UserName');
        await p.click('#new-btn');
        await p.fill('#e-title', 'Fremd'); await p.fill('#e-url', 'https://evil.example/?p={REF:P@T:Mail}&u={REF:U@T:Mail}');
        await p.click('#apply-btn');
        const evil = p.locator('[data-testid=f-url]');
        const want = `https://evil.example/?p={REF:P@T:Mail}&u=${mailUser}`;
        expect(await evil.innerText() === want && await evil.getAttribute('href') === want, 'URL mit fremdem Passwort: ' + await evil.getAttribute('href'));
        expect(!(await p.content()).includes(mailPw), 'Passwort von Mail steht im DOM');
        await p.context().close();
    });

    await step('Kleinigkeiten: Vorschau fuer Text- und Bild-Anhang, Farbe des Eintrags (KeePassXC sieht sie), TOTP aus einem QR-Code-Bild', async () => {
        const fX = path.join(davRoot, 'extras.kdbx');
        fs.copyFileSync(path.join(davRoot, 'vault4.kdbx'), fX);
        const p = await newPage();
        await login(p, 'extras.kdbx'); await rows(p).first().waitFor();
        await rows(p).filter({ hasText: 'Konto' }).click();
        const png = fs.readFileSync(path.join(root, 'tests/fixtures/totp-qr.png'));
        await p.setInputFiles('#att-input', { name: 'bild.png', mimeType: 'image/png', buffer: png });
        await p.locator('.att-row', { hasText: 'anhang.txt' }).locator('[data-testid=attachment-preview]').click();
        expect(/anhang-inhalt/.test(await p.locator('.att-preview-text').innerText()), 'Text-Vorschau');
        await p.keyboard.press('Escape');
        await p.locator('.att-row', { hasText: 'bild.png' }).locator('[data-testid=attachment-preview]').click();
        expect((await p.locator('img.att-preview').getAttribute('src')).startsWith('data:image/png;base64,'), 'Bild-Vorschau');
        expect(await p.locator('img.att-preview').evaluate((img) => img.decode().then(() => img.naturalWidth)) === 270, 'Bild wird angezeigt');
        await p.keyboard.press('Escape');

        await p.click('#edit-btn');
        await p.locator('#e-color input[value="#43a047"]').check();
        await p.setInputFiles('#e-qr', { name: 'qr.png', mimeType: 'image/png', buffer: png });
        await p.waitForFunction(() => /^otpauth:/.test(document.querySelector('#e-otp')?.value || ''));
        expect(await p.inputValue('#e-otp') === 'otpauth://totp/Beispiel:carol?secret=JBSWY3DPEHPK3PXP&issuer=Beispiel', 'QR: ' + await p.inputValue('#e-otp'));
        await p.click('#apply-btn');
        expect(/\btinted\b/.test(await rows(p).filter({ hasText: 'Konto' }).getAttribute('class')), 'Liste zeigt die Farbe nicht');
        await p.click('#save-btn'); await waitStatus(p, /^Gespeichert\./);
        await p.context().close();
        expect(/<BackgroundColor>#43a047<\/BackgroundColor>/i.test(xc(['export', '-f', 'xml', fX])), 'KeePassXC sieht die Farbe nicht');
        expect(/^\d{6}$/.test(xc(['show', '-t', fX, 'Bank/Konto']).trim().split('\n').pop()), 'TOTP aus dem QR-Code');
        const att = path.join(tmp, 'bild.png'); xc(['attachment-export', fX, 'Bank/Konto', 'bild.png', att]);
        expect(fs.readFileSync(att).equals(png), 'Bild-Anhang');
    });

    await step('CSV: Bitwarden-Export landet in eigener Gruppe (KeePassXC sieht ihn), Export entspricht dem von KeePassXC und laesst sich wieder einlesen', async () => {
        const fCsv = path.join(davRoot, 'csv.kdbx');
        fs.copyFileSync(path.join(davRoot, 'vault4.kdbx'), fCsv);
        const bitwarden = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n'
            + 'Arbeit/Server,,login,NAS,"zwei\nZeilen",,0,https://nas.local,admin,"ge,heim""1",JBSWY3DPEHPK3PXP\n,,login,Forum,,,0,forum.example,eve,pw-forum,\n';
        const p = await newPage();
        await login(p, 'csv.kdbx'); await rows(p).first().waitFor();
        const openCsv = async () => { await p.click('#reports-btn'); await p.click('#rep-tab-info'); await p.click('#csv-btn'); await p.locator('#csv-file').waitFor({ state: 'attached' }); };
        await openCsv();
        await p.setInputFiles('#csv-file', { name: 'bitwarden.csv', mimeType: 'text/csv', buffer: Buffer.from(bitwarden) });
        await p.waitForFunction(() => /Gefundene Einträge: 2/.test(document.querySelector('#csv-summary')?.textContent || ''));
        expect(/favorite|type|reprompt/.test(await p.locator('#csv-summary').innerText()) === true, 'ignorierte Spalten fehlen: ' + await p.locator('#csv-summary').innerText());
        await p.click('#csv-import');
        expect(await rows(p).count() === 2, 'Liste zeigt nicht die neue Gruppe');
        await p.click('#save-btn'); await waitStatus(p, /^Gespeichert\./);
        const nas = xc(['show', '-s', fCsv, 'Import bitwarden/Arbeit/Server/NAS']);
        expect(nas.includes('UserName: admin') && nas.includes('Password: ge,heim"1') && nas.includes('zwei\nZeilen'), 'NAS in KeePassXC:\n' + nas);
        expect(/^\d{6}$/.test(xc(['show', '-t', fCsv, 'Import bitwarden/Arbeit/Server/NAS']).trim().split('\n').pop()), 'TOTP aus dem Bitwarden-Export');
        expect(xc(['show', '-s', fCsv, 'Import bitwarden/Forum']).includes('Password: pw-forum'), 'Forum fehlt');

        await openCsv();
        expect(await p.isDisabled('#csv-export'), 'Export ohne Bestaetigung moeglich');
        await p.check('#csv-sure');
        const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csv-export')]);
        const ours = fs.readFileSync(await dl.path(), 'utf8');
        // Vergleich mit KeePassXC: ohne Icon und Zeiten, TOTP nur das Geheimnis (KeePassXC schreibt die URI neu auf), ohne Papierkorb (lassen wir bewusst weg)
        const cut = (csv) => parseCsv(csv).filter((r) => !r[0].includes('Recycle Bin'))
            .map((r) => [...r.slice(0, 6), r[6].match(/secret=([A-Z2-7]+)/)?.[1] || r[6]].join('|')).sort();
        const theirs = xc(['export', '-f', 'csv', fCsv]);
        expect(JSON.stringify(cut(ours)) === JSON.stringify(cut(theirs)), 'Export weicht von KeePassXC ab:\n' + ours + '\n---\n' + theirs);
        await openCsv();
        await p.setInputFiles('#csv-file', { name: 'zurueck.csv', mimeType: 'text/csv', buffer: Buffer.from(ours) });
        await p.click('#csv-import');
        expect(await rows(p).count() === parseCsv(ours).length - 1, 'Wiedereingelesener Export: ' + await rows(p).count());
        await p.context().close();
    });

    await step('Lokale Datei: oeffnen, aendern, "Speichern" liefert Download, der in KeePassXC oeffnet', async () => {
        const p = await newPage();
        await p.locator('input[value=file]').check({ force: true });
        await p.setInputFiles('#local-file', path.join(davRoot, 'vault3.kdbx'));
        await p.fill('#master', PW); await p.click('#open-btn'); await rows(p).first().waitFor();
        await p.locator('[data-testid=entry-row]', { hasText: 'Konto' }).click();
        await p.click('#edit-btn'); await p.fill('#e-user', 'bob-lokal'); await p.click('#apply-btn');
        const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#save-btn')]);
        const out = path.join(tmp, 'download.kdbx'); fs.copyFileSync(await dl.path(), out);
        expect(xc(['show', out, 'Konto']).includes('bob-lokal'), 'Download enthaelt die Aenderung nicht');
        await p.context().close();
    });

    await step('Datenschutz/Sicherheit: keine externen Anfragen, keine JS-Fehler, CSP gesetzt, Server sah nie Klartext', async () => {
        expect(problems.external.length === 0, 'Externe Anfragen: ' + problems.external.join(', '));
        expect(problems.pageErrors.length === 0, 'Seitenfehler: ' + problems.pageErrors.join(' | '));
        expect(problems.consoleErrors.length === 0, 'Konsolenfehler: ' + [...new Set(problems.consoleErrors)].join(' | '));
        const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
        expect(/Content-Security-Policy/.test(html) && /default-src 'none'/.test(html), 'CSP fehlt');
        expect(!/unsafe-inline|unsafe-eval(?!')/.test(html.replace("'wasm-unsafe-eval'", '')), 'unsafe-inline/eval in CSP');
        // Der Testserver hat nur verschluesselte Dateien gesehen; als Stichprobe darf der Master-Passwort-Text nirgends in den Server-Dateien stehen
        for (const n of fs.readdirSync(davRoot)) expect(!fs.readFileSync(path.join(davRoot, n)).includes(Buffer.from(PW)), `Master-Passwort im Klartext in ${n}`);
        expect(!fs.readFileSync(path.join(davRoot, 'vault4.kdbx')).includes(Buffer.from('alice-neu')), 'Eintragsdaten im Klartext auf dem Server');
        expect(!log.some((l) => /innerHTML/.test(l)), 'n/a');
    });

    await browser.close(); server.close();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} E2E-Tests bestanden (Arbeitsverzeichnis: ${tmp})`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
