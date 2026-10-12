// KDBX-Kompatibilitaetstests: kdbxweb (Git-Stand 2.2.0) gegen KeePassXC (keepassxc-cli) als Referenz.
// Aufruf: KDBXWEB=/pfad/zu/kdbxweb node -r ts-node/register/transpile-only run.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { argon2d, argon2id } from 'hash-wasm';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const kdbxweb = require(path.join(process.env.KDBXWEB || '../../vendor/kdbxweb', 'lib/index'));
const { Consts, Credentials, ProtectedValue, Kdbx, VarDictionary, Int64 } = kdbxweb;

const PW = 'Test-Passwort-123';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kdbxtest-'));

kdbxweb.CryptoEngine.setArgon2Impl(async (password: ArrayBuffer, salt: ArrayBuffer, memory: number,
    iterations: number, length: number, parallelism: number, type: number) => {
    const fn = type === 2 ? argon2id : argon2d;
    const out = await fn({ password: new Uint8Array(password), salt: new Uint8Array(salt), parallelism,
        iterations, memorySize: memory, hashLength: length, outputType: 'binary' } as any);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
});
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// ---------- KeePassXC als Referenz ----------
function exportAttachment(file: string, entry: string, name: string, keyfile?: string): Buffer {
    const out = path.join(TMP, `att-${crypto.randomBytes(4).toString('hex')}.bin`);
    xc(['attachment-export', file, entry, name, out], file, keyfile);
    const b = fs.readFileSync(out); fs.unlinkSync(out); return b;
}
function xc(args: string[], file: string, keyfile?: string, binary = false): string | Buffer {
    const a = [args[0], ...(keyfile ? ['-k', keyfile] : []), ...args.slice(1)];
    const run = () => execFileSync('keepassxc-cli', a, { input: PW + '\n', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    let out: Buffer;
    try { out = run(); } catch (e: any) {
        // keepassxc-cli 2.7 scheitert gelegentlich beim Schreiben ("Writing the database failed ... Cannot process 0 length data").
        // Nur genau dann einmal wiederholen; jeder andere Fehler bleibt ein Fehler.
        if (!/Writing the database failed|Cannot process 0 length data/.test(String(e.stderr || e.message))) throw e;
        out = run();
    }
    return binary ? out : out.toString('utf8');
}
const kdbxVersion = (f: string) => { const d = fs.readFileSync(f); return `${d.readUInt16LE(10)}.${d.readUInt16LE(8)}`; };

// ---------- Testdaten ----------
const SECRET_ATTACH = crypto.randomBytes(2048);
async function populate(db: any, bigAttach?: Buffer) {
    const root = db.getDefaultGroup();
    const web = db.createGroup(root, 'Web äöü');
    const sub = db.createGroup(web, 'Unter–Gruppe');
    const e = db.createEntry(web);
    e.fields.set('Title', 'Mail'); e.fields.set('UserName', 'alice');
    e.fields.set('Password', ProtectedValue.fromString('pw-eins €'));
    e.fields.set('URL', 'https://example.org'); e.fields.set('Notes', 'Notiz äöü €\nzweite Zeile');
    e.fields.set('PIN', ProtectedValue.fromString('1234'));
    e.fields.set('otp', 'otpauth://totp/Mail?secret=JBSWY3DPEHPK3PXP&period=30&digits=6');
    e.tags = ['privat', 'mail'];
    e.pushHistory(); e.fields.set('Password', ProtectedValue.fromString('pw-eins-v2')); e.times.update();
    const b = await db.binaries.add(ab(SECRET_ATTACH));
    e.binaries.set('geheim.bin', b);
    const e2 = db.createEntry(sub);
    e2.fields.set('Title', 'Konto'); e2.fields.set('UserName', 'bob');
    e2.fields.set('Password', ProtectedValue.fromString('pw-zwei'));
    if (bigAttach) e2.binaries.set('gross.bin', await db.binaries.add(ab(bigAttach)));
}

async function makeDb(opts: { version: 3 | 4; minor?: number; cipher: string; kdf: string; keyfile?: Uint8Array }) {
    const cred = new Credentials(ProtectedValue.fromString(PW), opts.keyfile ? ab(Buffer.from(opts.keyfile)) : undefined);
    const db = Kdbx.create(cred, 'Test');
    if (opts.version === 4) db.upgrade(); else db.setVersion(3);
    if (opts.version === 4) {
        db.setKdf(opts.kdf);
        const kp = db.header.kdfParameters;
        if (opts.kdf !== Consts.KdfId.Aes) { // kleine Argon2-Parameter fuer schnelle Tests
            kp.set('M', 5 /* UInt64 */, new Int64(8 * 1024)); kp.set('I', 5, new Int64(2));
        } else { kp.set('R', 5, new Int64(20000)); }
        db.header.dataCipherUuid = new kdbxweb.KdbxUuid(opts.cipher);
        if (opts.minor !== undefined) db.header.versionMinor = opts.minor;
    }
    return { db, cred };
}

async function save(db: any, file: string) { fs.writeFileSync(file, Buffer.from(await db.save())); }

function verify(file: string, keyfile: string | undefined, label: string, expectPw: string) {
    const ls = xc(['ls', '-R', file], file, keyfile) as string;
    if (!ls.includes('Mail') || !ls.includes('Konto')) throw new Error(`${label}: Eintraege fehlen in ls:\n${ls}`);
    const show = xc(['show', '-s', file, 'Web äöü/Mail'], file, keyfile) as string;
    for (const needle of [`Password: ${expectPw}`, 'UserName: alice', 'Notiz äöü €', 'Tags: mail,privat'])
        if (!show.includes(needle)) throw new Error(`${label}: "${needle}" fehlt in:\n${show}`);
    const pin = (xc(['show', '-s', '-a', 'PIN', file, 'Web \u00e4\u00f6\u00fc/Mail'], file, keyfile) as string).trim().split('\n').pop();
    if (pin !== '1234') throw new Error(`${label}: geschuetztes Zusatzfeld PIN = ${pin}`);
    const att = exportAttachment(file, 'Web äöü/Mail', 'geheim.bin', keyfile);
    if (!att.equals(SECRET_ATTACH)) throw new Error(`${label}: Anhang stimmt nicht (${att.length} Bytes)`);
    const totp = (xc(['show', '-t', file, 'Web äöü/Mail'], file, keyfile) as string).trim().split('\n').pop()!;
    if (!/^\d{6}$/.test(totp)) throw new Error(`${label}: TOTP unplausibel: ${totp}`);
}

// ---------- Test-Runner ----------
const results: { name: string; ok: boolean; info: string; known?: boolean }[] = [];
async function t(name: string, fn: () => Promise<string | void>, known = false) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e: any) { results.push({ name, ok: false, known, info: String(e.message || e).split('\n').slice(0, 4).join(' | ') }); }
}

async function main() {
    const keyfileBytes = await Credentials.createRandomKeyFile();
    const kfPath = path.join(TMP, 'test.keyx'); fs.writeFileSync(kfPath, Buffer.from(keyfileBytes));

    // 1) Schreib-Matrix: Cipher x KDF x Schluesseldatei, danach 5 Re-Saves
    for (const [cn, cipher] of Object.entries({ AES: Consts.CipherId.Aes, ChaCha20: Consts.CipherId.ChaCha20 }))
      for (const [kn, kdf] of Object.entries({ Argon2d: Consts.KdfId.Argon2d, Argon2id: Consts.KdfId.Argon2id, AES_KDF: Consts.KdfId.Aes }))
        for (const useKey of [false, true]) {
            const name = `KDBX4 ${cn}/${kn}${useKey ? '+Keyfile' : ''}: schreiben, KeePassXC liest, 5x Re-Save`;
            await t(name, async () => {
                const file = path.join(TMP, `m-${cn}-${kn}-${useKey}.kdbx`);
                const { db, cred } = await makeDb({ version: 4, cipher, kdf, keyfile: useKey ? keyfileBytes : undefined });
                await populate(db); await save(db, file);
                verify(file, useKey ? kfPath : undefined, 'erster Save', 'pw-eins-v2');
                let cur = db;
                for (let i = 1; i <= 5; i++) {
                    const c2 = new Credentials(ProtectedValue.fromString(PW), useKey ? ab(Buffer.from(keyfileBytes)) : undefined);
                    cur = await Kdbx.load(ab(fs.readFileSync(file)), c2);
                    const m = [...cur.getDefaultGroup().allEntries()].find((x: any) => x.fields.get('Title') === 'Mail');
                    m.pushHistory(); m.fields.set('Password', ProtectedValue.fromString(`pw-resave-${i}`)); m.times.update();
                    await save(cur, file);
                }
                verify(file, useKey ? kfPath : undefined, 'nach Re-Saves', 'pw-resave-5');
                return `v${kdbxVersion(file)}`;
            });
        }

    // 2) KDBX 3.1
    for (const useKey of [false, true])
        await t(`KDBX3 AES-KDF${useKey ? '+Keyfile' : ''}: schreiben, KeePassXC liest`, async () => {
            const file = path.join(TMP, `v3-${useKey}.kdbx`);
            const { db } = await makeDb({ version: 3, cipher: Consts.CipherId.Aes, kdf: Consts.KdfId.Aes, keyfile: useKey ? keyfileBytes : undefined });
            await populate(db); await save(db, file);
            verify(file, useKey ? kfPath : undefined, 'v3', 'pw-eins-v2'); return `v${kdbxVersion(file)}`;
        });

    // 3) Grosser Anhang
    await t('Grosser Anhang (8 MB) bleibt byte-identisch', async () => {
        const file = path.join(TMP, 'big.kdbx'); const big = crypto.randomBytes(8 * 1024 * 1024);
        const { db } = await makeDb({ version: 4, cipher: Consts.CipherId.ChaCha20, kdf: Consts.KdfId.Argon2id });
        await populate(db, big); await save(db, file);
        const back = exportAttachment(file, 'Web äöü/Unter–Gruppe/Konto', 'gross.bin');
        if (!back.equals(big)) throw new Error('8-MB-Anhang weicht ab'); return `${(fs.statSync(file).size / 1e6).toFixed(1)} MB Datei`;
    });

    // 4) KDBX 4.1-Funktionen (Gruppen-Tags, PreviousParentGroup)
    await t('KDBX 4.1: Gruppen-Tags + PreviousParentGroup, KeePassXC liest und kdbxweb liest zurueck', async () => {
        const file = path.join(TMP, 'k41.kdbx');
        const { db } = await makeDb({ version: 4, minor: 1, cipher: Consts.CipherId.ChaCha20, kdf: Consts.KdfId.Argon2d });
        await populate(db);
        const g = [...db.getDefaultGroup().allGroups()].find((x: any) => x.name === 'Unter–Gruppe'); g.tags = ['gt1', 'gt2'];
        await save(db, file);
        if (kdbxVersion(file) !== '4.1') throw new Error('Header meldet nicht 4.1: ' + kdbxVersion(file));
        verify(file, undefined, '4.1', 'pw-eins-v2');
        const back = await Kdbx.load(ab(fs.readFileSync(file)), new Credentials(ProtectedValue.fromString(PW)));
        const g2 = [...back.getDefaultGroup().allGroups()].find((x: any) => x.name === 'Unter–Gruppe');
        if (g2.tags.join() !== 'gt1,gt2') throw new Error('Gruppen-Tags gingen verloren: ' + g2.tags);
        return 'v4.1';
    });

    // 5) Wechselseitiges Bearbeiten: kdbxweb -> KeePassXC (edit) -> kdbxweb
    await t('Wechselseitig: kdbxweb schreibt, KeePassXC bearbeitet+speichert, kdbxweb liest und speichert erneut', async () => {
        const file = path.join(TMP, 'cross.kdbx');
        const { db } = await makeDb({ version: 4, cipher: Consts.CipherId.ChaCha20, kdf: Consts.KdfId.Argon2id });
        await populate(db); await save(db, file);
        xc(['edit', file, 'Web äöü/Mail', '--notes', 'von KeePassXC geändert'], file);
        const back = await Kdbx.load(ab(fs.readFileSync(file)), new Credentials(ProtectedValue.fromString(PW)));
        const m = [...back.getDefaultGroup().allEntries()].find((x: any) => x.fields.get('Title') === 'Mail');
        if (m.fields.get('Notes') !== 'von KeePassXC geändert') throw new Error('Notiz nach KeePassXC-Edit: ' + m.fields.get('Notes'));
        await save(back, file);
        const show = xc(['show', file, 'Web äöü/Mail'], file) as string;
        if (!show.includes('von KeePassXC geändert')) throw new Error('Notiz fehlt nach erneutem kdbxweb-Save');
    });

    // 6) Merge: zwei divergierende Kopien
    await t('Merge: Aenderung in kdbxweb-Kopie A + Aenderung in KeePassXC-Kopie B werden zusammengefuehrt', async () => {
        const base = path.join(TMP, 'base.kdbx'), fa = path.join(TMP, 'A.kdbx'), fb = path.join(TMP, 'B.kdbx');
        const { db } = await makeDb({ version: 4, cipher: Consts.CipherId.ChaCha20, kdf: Consts.KdfId.Argon2id });
        await populate(db); await save(db, base); fs.copyFileSync(base, fa); fs.copyFileSync(base, fb);
        const A = await Kdbx.load(ab(fs.readFileSync(fa)), new Credentials(ProtectedValue.fromString(PW)));
        const ka = [...A.getDefaultGroup().allEntries()].find((x: any) => x.fields.get('Title') === 'Konto');
        ka.pushHistory(); ka.fields.set('UserName', 'bob-aus-A'); ka.times.update(); await save(A, fa);
        await new Promise(r => setTimeout(r, 1100));
        xc(['edit', fb, 'Web äöü/Mail', '--url', 'https://aus-B.example'], fb);
        const A2 = await Kdbx.load(ab(fs.readFileSync(fa)), new Credentials(ProtectedValue.fromString(PW)));
        const B = await Kdbx.load(ab(fs.readFileSync(fb)), new Credentials(ProtectedValue.fromString(PW)));
        A2.merge(B); await save(A2, fa);
        const s1 = xc(['show', fa, 'Web äöü/Unter–Gruppe/Konto'], fa) as string, s2 = xc(['show', fa, 'Web äöü/Mail'], fa) as string;
        if (!s1.includes('bob-aus-A') || !s2.includes('aus-B.example')) throw new Error('Merge unvollstaendig:\n' + s1 + s2);
    });

    // 7) Bekannter Randfall: Datei ohne EnableSearching-Felder (z.B. von pykeepass)
    await t('Randfall: Gruppen ohne EnableSearching/EnableAutoType (pykeepass-Datei) -> KeePassXC liest Ergebnis', async () => {
        const src = path.join(TMP, 'py.kdbx');
        execFileSync('python3', ['-I', path.join(__dirname, 'make-pykeepass-ref.py')], { cwd: TMP });
        fs.copyFileSync(path.join(TMP, 'ref4.kdbx'), src);
        const db = await Kdbx.load(ab(fs.readFileSync(src)), new Credentials(ProtectedValue.fromString(PW)));
        await save(db, path.join(TMP, 'py-out.kdbx'));
        xc(['ls', '-R', path.join(TMP, 'py-out.kdbx')], path.join(TMP, 'py-out.kdbx'));
    }, true);

    // 5) Schluesseldatei-Formate, wie sie KeePassXC/KeePass in der Praxis erzeugen: DB von KeePassXC angelegt, von kdbxweb gelesen
    const kfVariants: Record<string, Buffer> = {
        'XML v1 (Base64)': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<KeyFile><Meta><Version>1.00</Version></Meta><Key><Data>${crypto.randomBytes(32).toString('base64')}</Data></Key></KeyFile>\n`),
        '32 Rohbytes': crypto.randomBytes(32),
        '64 Hex-Zeichen': Buffer.from(crypto.randomBytes(32).toString('hex') + '\n'),
        'beliebige Datei (z. B. Bild, Hash ueber alles)': Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n'), crypto.randomBytes(5000)]),
        'leere Zeilen/Windows-Zeilenenden in XML v2': Buffer.alloc(0)
    };
    // XML v2 von KeePassXC selbst erzeugen lassen und mit Windows-Zeilenenden umschreiben (Datei auf Windows bearbeitet)
    const v2Path = path.join(TMP, 'gen.keyx');
    execFileSync('keepassxc-cli', ['db-create', '-q', '-p', '--set-key-file', v2Path, '-t', '100', path.join(TMP, 'gen.kdbx')], { input: PW + '\n' + PW + '\n' });
    kfVariants['leere Zeilen/Windows-Zeilenenden in XML v2'] = Buffer.from(fs.readFileSync(v2Path, 'utf8').replace(/\n/g, '\r\n'));
    for (const [label, bytes] of Object.entries(kfVariants)) {
        await t(`Schluesseldatei ${label}: KeePassXC legt DB an, kdbxweb liest sie`, async () => {
            const kf = path.join(TMP, `kf-${crypto.randomBytes(3).toString('hex')}.bin`); fs.writeFileSync(kf, bytes);
            const dbf = path.join(TMP, `kfdb-${crypto.randomBytes(3).toString('hex')}.kdbx`);
            execFileSync('keepassxc-cli', ['db-create', '-q', '-p', '--set-key-file', kf, '-t', '100', dbf], { input: PW + '\n' + PW + '\n' });
            execFileSync('keepassxc-cli', ['add', '-q', '-k', kf, '-u', 'u', dbf, 'Eintrag'], { input: PW + '\n' });
            const db = await Kdbx.load(ab(fs.readFileSync(dbf)), new Credentials(ProtectedValue.fromString(PW), ab(bytes)));
            const titles = [...db.getDefaultGroup().allEntries()].map((e: any) => e.fields.get('Title'));
            if (titles.join() !== 'Eintrag') throw new Error('Eintraege: ' + titles.join());
            // und umgekehrt: kdbxweb speichert, KeePassXC liest mit derselben Datei
            const out = path.join(TMP, 'kfout.kdbx'); fs.writeFileSync(out, Buffer.from(await db.save()));
            xc(['ls', out], out, kf);
        });
    }
    await t('Master-Passwort mit Sonderzeichen/NFD/Emoji: KeePassXC <-> kdbxweb in beide Richtungen', async () => {
        const hard = 'Zähl-Ünï§ "Q\'uote" \\ €uro 日本語 🔐🗝️  e\u0301 0O1lI| ;&$`{}';
        const dbf = path.join(TMP, 'hardpw.kdbx');
        execFileSync('keepassxc-cli', ['db-create', '-q', '-p', '-t', '100', dbf], { input: hard + '\n' + hard + '\n' });
        const db = await Kdbx.load(ab(fs.readFileSync(dbf)), new Credentials(ProtectedValue.fromString(hard)));
        const out = path.join(TMP, 'hardpw2.kdbx'); fs.writeFileSync(out, Buffer.from(await db.save()));
        execFileSync('keepassxc-cli', ['ls', '-q', out], { input: hard + '\n' });
        // NFC statt NFD darf NICHT oeffnen (KeePass normalisiert nicht) - sonst waeren Passwoerter zwischen Geraeten nicht eindeutig
        let opened = true;
        try { await Kdbx.load(ab(fs.readFileSync(dbf)), new Credentials(ProtectedValue.fromString(hard.normalize('NFC')))); } catch { opened = false; }
        if (opened) throw new Error('NFC-Variante oeffnet - unerwartet');
    });

    // Bericht
    const w = Math.max(...results.map(r => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : r.known ? 'KNWN' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.info}`);
    const failed = results.filter(r => !r.ok && !r.known).length;
    console.log(`\n${results.filter(r => r.ok).length}/${results.length} Tests bestanden, ${results.filter(r => !r.ok && r.known).length} bekannte(r) Fehler, ${failed} unerwartet fehlgeschlagen; Arbeitsverzeichnis: ${TMP}`);
    process.exit(failed ? 1 : 0);
}
main();
