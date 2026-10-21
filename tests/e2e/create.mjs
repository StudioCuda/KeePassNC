// Test "New database": checks in the form, never overwrite an existing file, creating via WebDAV, only with a new
// key file and as a local file; in Nextcloud mode (mock of the app page) only name and folder, with folder browser,
// and the same browser when opening ([Browse] next to the path field).
// Each result is cross-checked with keepassxc-cli (opens, AES-256, Argon2id with 64 MiB).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, waitOpened, plainWebdav } from '../browser.mjs';
import { startServer } from './davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-new-'));
const davRoot = path.join(tmp, 'dav'); fs.mkdirSync(davRoot);
const PW = 'Neues-Passwort-Kolibri-2357!', OTHER = 'Anderes-Passwort-Igel-1113?';
const dav = (name) => path.join(davRoot, name);
execFileSync('keepassxc-cli', ['db-create', '-q', '-p', '-t', '100', dav('da.kdbx')], { input: OTHER + '\n' + OTHER + '\n', stdio: 'pipe' });
const before = fs.readFileSync(dav('da.kdbx'));

/** Does KeePassXC open the file? With the entry list if so. pw === null: without password (key file only). */
const xcLs = (file, pw, keyfile) => {
    const r = spawnSync('keepassxc-cli', ['ls', '-q', '-R', ...(pw === null ? ['--no-password'] : []), ...(keyfile ? ['-k', keyfile] : []), file], { input: (pw ?? '') + '\n' });
    return r.status === 0 ? r.stdout.toString('utf8') : null;
};
const xcInfo = (file, pw, keyfile) => {
    const r = spawnSync('keepassxc-cli', ['db-info', '-q', ...(pw === null ? ['--no-password'] : []), ...(keyfile ? ['-k', keyfile] : []), file], { input: (pw ?? '') + '\n' });
    return r.status === 0 ? r.stdout.toString('utf8') : null;
};
/** Encryption as intended? Reads the unencrypted file header itself, independent of the keepassxc-cli output. */
const expectDefaults = (file) => {
    const b = fs.readFileSync(file);
    expect(b.readUInt16LE(10) === 4, 'KDBX 4 erwartet, nicht ' + b.readUInt16LE(10));
    const hex = b.toString('hex');
    expect(hex.includes('31c1f2e6bf714350be5805216afc5aff'), 'AES-256 erwartet');
    expect(hex.includes('9e298b1956db4773b23dfc3ec6f0a1e6'), 'Argon2id erwartet');
    const mem = Buffer.alloc(18); mem.writeUInt8(0x05, 0); mem.writeInt32LE(1, 1); mem.write('M', 5); mem.writeInt32LE(8, 6); mem.writeBigUInt64LE(64n * 1024n * 1024n, 10);
    expect(b.includes(mem), 'Argon2 mit 64 MiB erwartet'); // VarDictionary entry: type UInt64, key "M", 8 bytes value
};

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 10).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

async function main() {
    const { stop, port } = await startServer({ webRoot: path.join(root, 'web'), davRoot, nc: { template: path.join(root, 'nextcloud-app/keepassnc/templates/page.html') } });
    const base = `http://127.0.0.1:${port}`;
    const browser = await launchBrowser();
    const errors = [];
    const newPage = async () => {
        const c = await browser.newContext({ locale: 'de-DE', acceptDownloads: true, viewport: { width: 1400, height: 950 }, serviceWorkers: 'block' });
        await c.addInitScript(plainWebdav);
        await c.addInitScript(() => { try { if (!localStorage.getItem('kpnc.settings')) localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
        const p = await c.newPage();
        p.on('pageerror', (e) => errors.push(String(e)));
        return p;
    };
    const openNew = async (p) => { await p.goto(base); await p.click('#new-db-link'); await p.locator('#new-form').waitFor(); };
    const fillDav = async (p, file) => {
        await p.locator('input[name=new-src][value=dav]').check({ force: true });
        await p.fill('#new-url', `${base}/dav/${file}`); await p.fill('#new-user', 'tester'); await p.fill('#new-pass', 'app-secret');
    };
    const fillPw = async (p, pw, repeat = pw) => { await p.fill('#new-new', pw); await p.fill('#new-repeat', repeat); };
    const newError = async (p, re) => {
        await p.click('#new-btn');
        try { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#new-error')?.textContent || ''), re.source, { timeout: 30000 }); }
        catch (e) { throw new Error(`Fehler ${re}: "${await p.locator('#new-error').innerText().catch(() => '?')}"`); }
    };
    const waitStatus = async (p, re, timeout = 60000) => {
        try { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status')?.textContent || ''), re.source, { timeout }); }
        catch (e) { throw new Error(`Status ${re}: "${await p.locator('#status').innerText().catch(() => '?')}" (${String(e.message).split('\n')[0]})`); }
    };

    const p1 = await newPage();
    await step('Maske prueft: Wiederholung, ohne Passwort und Schluesseldatei, schwaches Passwort fragt nach, Zurueck', async () => {
        await openNew(p1);
        await fillDav(p1, 'neu.kdbx');
        await fillPw(p1, PW, PW + 'x'); await newError(p1, /nicht gleich/);
        await fillPw(p1, ''); await newError(p1, /Master-Passwort eintragen oder eine Schlüsseldatei/);
        await fillPw(p1, 'hallo123'); await p1.click('#new-btn');
        await p1.locator('#confirm-cancel').click();
        expect(await p1.locator('#new-form').isVisible(), 'Maske soll nach Abbruch offen bleiben');
        expect(!fs.existsSync(dav('neu.kdbx')), 'nichts angelegt');
        await p1.click('#new-back'); await p1.locator('#login-form').waitFor();
    });

    await step('Vorhandene Datei wird nie ueberschrieben', async () => {
        await openNew(p1);
        await fillDav(p1, 'da.kdbx'); await fillPw(p1, PW);
        await newError(p1, /gibt es schon/);
        expect(fs.readFileSync(dav('da.kdbx')).equals(before), 'vorhandene Datei veraendert');
    });

    await step('Anlegen ueber WebDAV (ohne .kdbx im Namen): offen, KeePassXC oeffnet, AES-256 + Argon2id 64 MiB; Aenderung speichern, neu anmelden', async () => {
        await fillDav(p1, 'Tresor'); await fillPw(p1, PW);
        await p1.click('#new-btn'); await waitOpened(p1, 60000);
        await waitStatus(p1, /„Tresor\.kdbx“ angelegt und geöffnet/);
        expect(xcLs(dav('Tresor.kdbx'), PW) !== null, 'KeePassXC oeffnet die neue Datei nicht');
        expectDefaults(dav('Tresor.kdbx'));
        const info = xcInfo(dav('Tresor.kdbx'), PW) || '';
        expect(/Name: Tresor/.test(info), 'Datenbank-Name: ' + info);
        expect(fs.readdirSync(davRoot).filter((f) => f.endsWith('.bak')).length === 0, 'keine Sicherungskopie der leeren Datenbank');
        await p1.click('#new-group-btn'); await p1.fill('#prompt-input', 'Privat'); await p1.keyboard.press('Enter');
        await p1.click('#save-btn'); await waitStatus(p1, /^Gespeichert/);
        expect(xcLs(dav('Tresor.kdbx'), PW)?.includes('Privat/'), 'Gruppe fehlt bei KeePassXC');
        await p1.click('#lock-btn'); await p1.locator('#login-form').waitFor();
        expect((await p1.inputValue('#dav-url')).endsWith('/dav/Tresor.kdbx'), 'Anmeldung soll die neue Datei vorschlagen');
        await p1.fill('#dav-pass', 'app-secret'); await p1.fill('#master', PW); await p1.click('#open-btn'); await waitOpened(p1, 60000);
        await p1.context().close();
    });

    const p2 = await newPage();
    const key = path.join(tmp, 'nur.keyx');
    await step('Nur mit neuer Schluesseldatei: erst Download und Kontrolle, Rueckfrage ohne Passwort, KeePassXC oeffnet mit --no-password', async () => {
        await openNew(p2);
        await fillDav(p2, 'nur-datei.kdbx');
        await p2.locator('#new-form input[name=new-kf][value=new]').check();
        await newError(p2, /zuerst herunterladen/);
        const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('#new-kf-download')]);
        expect(dl.suggestedFilename() === 'nur-datei.keyx', 'Dateiname ' + dl.suggestedFilename());
        await dl.saveAs(key);
        await newError(p2, /zur Kontrolle/);
        await p2.setInputFiles('#new-kf-verify', key);
        await p2.waitForFunction(() => /^Passt/.test(document.querySelector('#new-kf-check')?.textContent || ''));
        await p2.click('#new-btn');
        await p2.click('#confirm-ok');
        await waitOpened(p2, 60000);
        expect(xcLs(dav('nur-datei.kdbx'), null, key) !== null, 'KeePassXC oeffnet nicht nur mit der Schluesseldatei');
        expectDefaults(dav('nur-datei.kdbx'));
        await p2.context().close();
    });

    const p3 = await newPage();
    await step('Passwort und vorhandene Schluesseldatei', async () => {
        await openNew(p3);
        await fillDav(p3, 'beides.kdbx'); await fillPw(p3, PW);
        await p3.locator('#new-form input[name=new-kf][value=pick]').check();
        await newError(p3, /Bitte eine Schlüsseldatei wählen/);
        await p3.setInputFiles('#new-kf-pick', key);
        await p3.click('#new-btn'); await waitOpened(p3, 60000);
        expect(xcLs(dav('beides.kdbx'), PW, key) !== null, 'KeePassXC oeffnet nicht mit Passwort + Schluesseldatei');
        expect(xcLs(dav('beides.kdbx'), PW) === null, 'darf ohne Schluesseldatei nicht aufgehen');
        await p3.context().close();
    });

    const p4 = await newPage();
    await step('Ordner ohne Recht zum Anlegen (403): verstaendlicher Fehler, Maske bleibt', async () => {
        await p4.route((u) => u.pathname === '/dav/verboten.kdbx', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 403 }) : r.continue()));
        await openNew(p4);
        await fillDav(p4, 'verboten.kdbx'); await fillPw(p4, PW);
        await newError(p4, /keine Dateien anlegen/);
        expect(await p4.locator('#new-form').isVisible(), 'Maske soll offen bleiben');
        await p4.context().close();
    });

    const p5 = await newPage();
    await step('Lokale Datei: wird heruntergeladen und geht in KeePassXC auf; Speichern laedt sie neu herunter', async () => {
        await openNew(p5);
        await p5.locator('input[name=new-src][value=file]').check({ force: true });
        await p5.fill('#new-name', 'lokal'); await fillPw(p5, PW);
        const [dl] = await Promise.all([p5.waitForEvent('download'), p5.click('#new-btn')]);
        expect(dl.suggestedFilename() === 'lokal.kdbx', 'Dateiname ' + dl.suggestedFilename());
        const out = path.join(tmp, 'lokal.kdbx'); await dl.saveAs(out);
        await waitOpened(p5, 60000);
        await waitStatus(p5, /angelegt und heruntergeladen/);
        expect(xcLs(out, PW) !== null, 'KeePassXC oeffnet die lokale Datei nicht');
        expectDefaults(out);
        await p5.click('#new-group-btn'); await p5.fill('#prompt-input', 'Lokal-Gruppe'); await p5.keyboard.press('Enter');
        const [dl2] = await Promise.all([p5.waitForEvent('download'), p5.click('#save-btn')]);
        const out2 = path.join(tmp, 'lokal2.kdbx'); await dl2.saveAs(out2);
        expect(xcLs(out2, PW)?.includes('Lokal-Gruppe/'), 'gespeicherte Datei ohne neue Gruppe');
        await p5.context().close();
    });

    // ---------- Nextcloud mode: name + folder instead of path
    const ncApp = `${base}/index.php/apps/keepassnc/`;
    fs.mkdirSync(dav('Privat/Alt'), { recursive: true });
    fs.copyFileSync(dav('da.kdbx'), dav('Privat/Passwörter.kdbx'));
    const ncWait = async (p, re) => {
        try { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#new-name-note')?.hidden === false ? document.querySelector('#new-name-note').textContent : ''), re.source, { timeout: 15000 }); }
        catch { throw new Error(`Hinweis ${re}: "${await p.locator('#new-name-note').innerText().catch(() => '?')}"`); }
    };
    const p6 = await newPage();
    await step('Nextcloud, aus "+ Neu": Name und Ordner vorbelegt, kein Pfadfeld; vergebener Name wird sofort gemeldet', async () => {
        await p6.goto(`${ncApp}?new=${encodeURIComponent('/Privat/Tresor.kdbx')}`);
        await p6.locator('#new-form').waitFor();
        expect(await p6.inputValue('#new-name') === 'Tresor', 'Name: ' + await p6.inputValue('#new-name'));
        expect(await p6.locator('#new-folder').innerText() === 'Privat', 'Ordner: ' + await p6.locator('#new-folder').innerText());
        expect(await p6.locator('#new-path, #new-url').count() === 0 || !(await p6.locator('#new-url').isVisible()), 'kein Pfad- oder Adressfeld');
        await p6.fill('#new-name', 'Passwörter.kdbx');
        await ncWait(p6, /gibt es in diesem Ordner schon/);
        await p6.fill('#new-name', 'Tresor');
        await p6.waitForFunction(() => document.querySelector('#new-name-note').hidden);
    });

    await step('Ordner-Browser: Brotkrumen, Unterordner, neuer Ordner, "Hier speichern"; angelegt dort, Adresse wird ?open=', async () => {
        await p6.click('#new-folder-btn');
        await p6.locator('#folder-picker').waitFor();
        await p6.locator('.folder-item[data-name="Alt"]').waitFor();
        expect(await p6.locator('.folder-item[data-name="Passwörter.kdbx"]').isDisabled(), '.kdbx soll ausgegraut dabeistehen');
        await p6.locator('#folder-crumbs button', { hasText: 'Alle Dateien' }).click();
        await p6.locator('.folder-item[data-name="Privat"]').waitFor();
        await p6.locator('.folder-item[data-name="Privat"]').click();
        await p6.click('#folder-new'); await p6.fill('#prompt-input', 'Neu 2026'); await p6.click('#prompt-ok');
        await p6.waitForFunction(() => /Neu 2026/.test(document.querySelector('#folder-crumbs')?.textContent || ''));
        expect(fs.statSync(dav('Privat/Neu 2026')).isDirectory(), 'Ordner nicht angelegt');
        await p6.click('#folder-ok');
        expect(await p6.locator('#new-folder').innerText() === 'Privat › Neu 2026', 'Ordner: ' + await p6.locator('#new-folder').innerText());
        await fillPw(p6, PW);
        await p6.click('#new-btn'); await waitOpened(p6, 60000);
        expect(xcLs(dav('Privat/Neu 2026/Tresor.kdbx'), PW) !== null, 'KeePassXC oeffnet die neue Datei nicht');
        expect(new URL(p6.url()).searchParams.get('open') === '/Privat/Neu 2026/Tresor.kdbx', 'Adresse: ' + p6.url());
        await p6.context().close();
    });

    const p7 = await newPage();
    await step('Nextcloud, von der Anmeldung: Ordner der zuletzt geoeffneten Datei, freier Name statt eines vergebenen', async () => {
        await p7.goto(ncApp);
        await p7.evaluate(() => localStorage.setItem('kpnc.ncfile', '/Privat/Passwörter.kdbx'));
        await p7.goto(ncApp);
        await p7.click('#new-db-link'); await p7.locator('#new-form').waitFor();
        expect(await p7.locator('#new-folder').innerText() === 'Privat', 'Ordner: ' + await p7.locator('#new-folder').innerText());
        await p7.waitForFunction(() => document.querySelector('#new-name')?.value === 'Passwörter (2)', null, { timeout: 15000 })
            .catch(async () => { throw new Error('Name: ' + await p7.inputValue('#new-name')); });
        await p7.context().close();
    });

    // ---------- Nextcloud mode, sign-in: [Browse] instead of typing the path (same browser, in file mode)
    const p8 = await newPage();
    const pressed = (p, name) => p.locator(`.folder-item[data-name="${name}"]`).getAttribute('aria-pressed');
    await step('Anmeldung mit ?open=: Feld schreibgeschuetzt, kein [Durchsuchen]', async () => {
        await p8.goto(`${ncApp}?open=${encodeURIComponent('/Privat/Passwörter.kdbx')}`);
        await p8.locator('#login-form').waitFor();
        expect(await p8.locator('#nc-path').getAttribute('readonly') !== null, 'Feld soll schreibgeschuetzt sein');
        expect(await p8.locator('#nc-browse').count() === 0, '[Durchsuchen] soll fehlen');
    });

    await step('[Durchsuchen] mit leerem Feld: startet in "Alle Dateien", .kdbx waehlbar, "Oeffnen" erst nach Auswahl; Pfad landet im Feld, entsperrt', async () => {
        await p8.goto(ncApp); await p8.locator('#login-form').waitFor();
        expect(await p8.inputValue('#nc-path') === '', 'Feld soll leer sein');
        await p8.click('#nc-browse');
        await p8.locator('#folder-picker').waitFor();
        expect(await p8.locator('.modal-title').innerText() === 'Datenbank wählen', 'Titel: ' + await p8.locator('.modal-title').innerText());
        await p8.locator('.folder-item[data-name="Privat"]').waitFor();
        expect(await p8.locator('#folder-crumbs [aria-current]').innerText() === 'Alle Dateien', 'Startordner');
        expect(await p8.locator('#folder-new').count() === 0, 'kein "Neuer Ordner" beim Oeffnen');
        expect(await p8.locator('#folder-ok').isDisabled(), '"Öffnen" ohne Auswahl soll aus sein');
        await p8.locator('.folder-item[data-name="Privat"]').click();
        await p8.locator('.folder-item[data-name="Passwörter.kdbx"]').waitFor();
        expect(!(await p8.locator('.folder-item[data-name="Passwörter.kdbx"]').isDisabled()), '.kdbx soll waehlbar sein');
        await p8.locator('.folder-item[data-name="Passwörter.kdbx"]').click();
        expect(await pressed(p8, 'Passwörter.kdbx') === 'true' && !(await p8.locator('#folder-ok').isDisabled()), 'Auswahl');
        await p8.locator('.folder-item[data-name="Alt"]').click(); // changing folder clears the selection
        await p8.waitForFunction(() => /keine Datenbank/.test(document.querySelector('#folder-list')?.textContent || ''));
        expect(await p8.locator('#folder-ok').isDisabled(), 'Auswahl soll nach Ordnerwechsel weg sein');
        await p8.locator('#folder-crumbs button', { hasText: 'Privat' }).click();
        await p8.locator('.folder-item[data-name="Passwörter.kdbx"]').click();
        await p8.click('#folder-ok');
        expect(await p8.locator('#folder-picker').count() === 0, 'Dialog soll zu sein');
        expect(await p8.inputValue('#nc-path') === '/Privat/Passwörter.kdbx', 'Pfad: ' + await p8.inputValue('#nc-path'));
        expect(await p8.evaluate(() => document.activeElement?.id) === 'master', 'Fokus soll aufs Master-Passwort');
        await p8.fill('#master', OTHER); await p8.click('#open-btn'); await waitOpened(p8, 60000);
    });

    await step('[Durchsuchen] mit Pfad im Feld: startet in dessen Ordner, Datei vormarkiert; Abbrechen laesst das Feld; fehlender Ordner -> "Alle Dateien", Enter oeffnet', async () => {
        await p8.click('#lock-btn'); await p8.locator('#login-form').waitFor();
        expect(await p8.inputValue('#nc-path') === '/Privat/Passwörter.kdbx', 'gemerkter Pfad: ' + await p8.inputValue('#nc-path'));
        await p8.click('#nc-browse');
        await p8.locator('.folder-item[data-name="Passwörter.kdbx"]').waitFor();
        expect(await p8.locator('#folder-crumbs [aria-current]').innerText() === 'Privat', 'Startordner: ' + await p8.locator('#folder-crumbs [aria-current]').innerText());
        expect(await pressed(p8, 'Passwörter.kdbx') === 'true', 'Datei aus dem Feld soll vormarkiert sein');
        await p8.click('#folder-cancel');
        expect(await p8.inputValue('#nc-path') === '/Privat/Passwörter.kdbx', 'Abbrechen hat das Feld geaendert');
        await p8.fill('#nc-path', '/Gibts/nicht.kdbx');
        await p8.click('#nc-browse');
        await p8.locator('.folder-item[data-name="Privat"]').waitFor();
        expect(await p8.locator('#folder-crumbs [aria-current]').innerText() === 'Alle Dateien', 'Rueckfall auf "Alle Dateien"');
        await p8.locator('.folder-item[data-name="Privat"]').click();
        await p8.locator('.folder-item[data-name="Passwörter.kdbx"]').focus();
        await p8.keyboard.press('Enter');
        expect(await p8.inputValue('#nc-path') === '/Privat/Passwörter.kdbx', 'Enter: ' + await p8.inputValue('#nc-path'));
        await p8.context().close();
    });

    await step('Keine JS-Fehler', async () => { expect(errors.length === 0, errors.join(' | ')); });

    await browser.close(); await stop();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} Tests "Neue Datenbank" bestanden`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
