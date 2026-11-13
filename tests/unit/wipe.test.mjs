// Memory hygiene: once the session drops a vault for good, Vault.wipe() overwrites the key file bytes and credential hashes it holds,
// but only after every save and sync has run (kdbxweb derives the file key from them on each save), and afterwards nothing writes anymore.
// The key derivation overwrites its own temporary copies (vault.js Argon2 adapter, keyfile-store.js deriveKey).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { MemoryDav, Vault, VaultError, FAST, PW, titles, newDb, openDb, kdbxweb } from './vault-harness.mjs';

const zeros = (x) => new Uint8Array(x).every((b) => b === 0);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const isWiped = (e) => e instanceof VaultError && e.key === 'e.wiped';
/** A KeePassXC-style XML key file (format 2.0). */
const keyfile = () => kdbxweb.Credentials.createKeyFileWithHash(crypto.getRandomValues(new Uint8Array(32)).buffer, 2);

/** Database with master password and key file on the server, one entry saved. */
async function keyVault(dav, kf) {
    const { vault } = await Vault.create({ name: 'db', password: PW, keyfile: kf.slice(), security: FAST, dav: dav.file('/db.kdbx') });
    vault.applyEntry(null, vault.root, { Title: 'saved' });
    await vault.save();
    return vault;
}
/** The server version, opened with the original credentials like a second device would. */
const reopen = (dav, kf) => Vault.open({ buf: dav.bytes('/db.kdbx'), password: PW, keyfile: kf.slice(), dav: dav.file('/db.kdbx'), etag: dav._tag('/db.kdbx') });

test('wipe() overwrites the key file bytes and the credential hashes once nothing is running', async () => {
    const dav = new MemoryDav(), kf = await keyfile();
    const vault = await keyVault(dav, kf);
    assert.ok(!zeros(vault._kf) && !zeros(vault.db.credentials.keyFileHash.getBinary()));
    await vault.wipe();
    for (const buf of [vault._kf, vault._base.kf]) assert.ok(zeros(buf), 'raw key file bytes');
    const c = vault.db.credentials;
    for (const pv of [vault._pw, vault._base.pw, c.passwordHash, c.keyFileHash]) assert.ok(zeros(pv.value) && zeros(pv.salt), 'password and hashes');
    assert.deepEqual(titles(await reopen(dav, kf)), ['saved'], 'the file on the server is untouched');
});

test('wipe() overwrites the vault\'s own copy of the key file, never the buffer the caller handed in', async () => {
    const dav = new MemoryDav(), kf = await keyfile();
    await keyVault(dav, kf);
    const mine = kf.slice().buffer;
    const vault = await Vault.open({ buf: dav.bytes('/db.kdbx'), password: PW, keyfile: mine, dav: dav.file('/db.kdbx'), etag: dav._tag('/db.kdbx') });
    await vault.wipe();
    assert.ok(zeros(vault._kf));
    assert.deepEqual(new Uint8Array(mine), kf);
});

test('a merge from another copy that is still opening when the vault is wiped leaves the database alone', async () => {
    const dav = new MemoryDav(), kf = await keyfile();
    const vault = await keyVault(dav, kf);
    const other = await reopen(dav, kf);
    other.applyEntry(null, other.root, { Title: 'copy' });
    const copy = await other.copyBytes(), seen = dav.log.length;
    const merging = vault.mergeFrom(copy, { password: PW, keyfile: kf.slice() }); // runs outside the save queue
    await vault.wipe(); // nothing queued: done long before the copy has gone through its key derivation
    await assert.rejects(merging, isWiped);
    assert.equal(vault.dirty, false);
    assert.deepEqual(titles(vault), ['saved']);
    assert.deepEqual(dav.log.slice(seen), []);
});

test('wipe() copes with a database without key file and with being called twice', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav, { entries: ['a'] });
    await vault.wipe();
    await vault.wipe();
    assert.ok(zeros(vault._pw.value) && zeros(vault.db.credentials.passwordHash.value));
    assert.equal(vault.db.credentials.keyFileHash, undefined);
    assert.deepEqual(titles(await openDb(dav)), ['a']);
});

test('after wipe() nothing writes: saving, syncing and changing credentials refuse with e.wiped', async () => {
    const dav = new MemoryDav(), kf = await keyfile();
    const vault = await keyVault(dav, kf);
    vault.applyEntry(null, vault.root, { Title: 'unsaved' }); // locked with "throw the changes away"
    const before = new Uint8Array(dav.bytes('/db.kdbx')), seen = dav.log.length;
    await vault.wipe();
    const calls = {
        save: () => vault.save(), autoSave: () => vault.save({ auto: true }), sync: () => vault.sync(), backgroundSync: () => vault.sync({ background: true }),
        changeCredentials: () => vault.changeCredentials({ password: 'new' }), adoptCredentials: () => vault.adoptCredentials({ password: PW, keyfile: kf.slice() }),
        copyBytes: () => vault.copyBytes(), deleteBackups: () => vault.deleteBackups(), mergeFrom: () => vault.mergeFrom(before.buffer.slice(0)),
        _save: () => vault._save(), _push: () => vault._push(), _sync: () => vault._sync()
    };
    for (const [name, call] of Object.entries(calls)) await assert.rejects(Promise.resolve().then(call), isWiped, name);
    assert.throws(() => vault.applyEntry(null, vault.root, { Title: 'later' }), isWiped);
    assert.throws(() => vault.keyfileCopy(), isWiped, 'no zeros handed out as the key file (remembered key file)');
    assert.deepEqual(dav.log.slice(seen), [], 'no request at all');
    assert.deepEqual(new Uint8Array(dav.bytes('/db.kdbx')), before);
    assert.deepEqual(titles(await reopen(dav, kf)), ['saved']);
});

test('wipe() waits for a save in flight and one queued meanwhile; the uploaded file opens with the original credentials', async () => {
    const dav = new MemoryDav(), kf = await keyfile();
    const vault = await keyVault(dav, kf);
    const gate = deferred(), putting = deferred();
    dav.hooks.beforePut = async () => { putting.resolve(); await gate.promise; };
    vault.applyEntry(null, vault.root, { Title: 'in flight' });
    const saving = vault.save();
    await putting.promise;
    let wiped = false;
    const wiping = vault.wipe().then(() => { wiped = true; });
    vault.applyEntry(null, vault.root, { Title: 'queued' });
    const queued = vault.save(); // queued after wipe() was asked for: it still runs, with the real credentials
    await tick(30);
    // A request that never answers keeps it this way: nothing is wiped under a running save
    assert.ok(!wiped && !zeros(vault._kf) && !zeros(vault.db.credentials.keyFileHash.getBinary()), 'nothing is wiped while the upload is open');
    gate.resolve();
    await saving; await queued; await wiping;
    assert.ok(zeros(vault._kf));
    assert.deepEqual(titles(await reopen(dav, kf)), ['in flight', 'queued', 'saved']);
});

test('wipe() waits for a save that has to merge with another device first', async () => {
    const dav = new MemoryDav(), kf = await keyfile();
    const vault = await keyVault(dav, kf);
    const other = await reopen(dav, kf);
    other.applyEntry(null, other.root, { Title: 'other device' });
    await other.save();
    vault.applyEntry(null, vault.root, { Title: 'mine' });
    const saving = vault.save(); // conflict: reads the server version with the base credentials, merges, saves again
    await vault.wipe();
    assert.equal((await saving).merged, true);
    assert.ok(zeros(vault._kf) && zeros(vault._base.kf));
    assert.deepEqual(titles(await reopen(dav, kf)), ['mine', 'other device', 'saved']);
});

// vault.js and keyfile-store.js bundled once more, with a spy in place of argon2.js that keeps what it handed out.
// In Node there is no Worker, so the real argon2() computes right here (argon2Here).
const spied = (async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-wipe-'));
    const spy = path.join(dir, 'argon2-spy.mjs');
    fs.writeFileSync(spy, `import { argon2Here } from ${JSON.stringify(path.join(root, 'src/argon2.js'))};
export const ARGON2_WORKER_URL = null;
export const calls = [];
export async function argon2(p) { const out = await argon2Here(p); calls.push({ password: p.password, out }); return out; }
`);
    try {
        await build({
            stdin: { contents: `export * from './src/vault.js'; export { createKeyfileStore, limits } from './src/keyfile-store.js'; export { calls } from ${JSON.stringify(spy)};`, resolveDir: root, loader: 'js' },
            outfile: path.join(dir, 'bundle.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
            plugins: [{ name: 'argon2-spy', setup(b) { b.onResolve({ filter: /^\.\/argon2\.js$/ }, () => ({ path: spy })); } }]
        });
        return await import(pathToFileURL(path.join(dir, 'bundle.mjs')).href);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})();

test('the database key derivation overwrites the Argon2 output once kdbxweb has its own copy', async () => {
    const { Vault: SpiedVault, calls } = await spied;
    const n = calls.length;
    const security = { cipher: 'aes', kdf: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 };
    const { bytes } = await SpiedVault.create({ name: 'db', password: PW, security });
    const v = await SpiedVault.open({ buf: bytes, password: PW }); // opens: the key kdbxweb got was right
    assert.equal(v.securitySettings().kdf, 'argon2id');
    const mine = calls.slice(n);
    assert.equal(mine.length, 2);
    for (const c of mine) assert.ok(zeros(c.out), 'Argon2 output');
});

test('remembering a key file overwrites the encoded master password and the Argon2 output after use', async () => {
    const { createKeyfileStore, limits, calls } = await spied;
    Object.assign(limits, { minMemoryKiB: 64, minIterations: 1, acceptMinMemoryKiB: 8, acceptMinIterations: 1 }); // this bundle's copy only: fast parameters
    const m = new Map();
    const store = createKeyfileStore({ get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] });
    const key = new TextEncoder().encode('<KeyFile/>'), n = calls.length;
    await store.remember({ id: 'x', name: 'k.keyx', keyfile: key, password: 'Pässwort', params: { memoryKiB: 64, iterations: 1 } });
    assert.deepEqual([...await store.recall({ id: 'x', password: 'Pässwort' })], [...key]);
    const mine = calls.slice(n);
    assert.equal(mine.length, 2);
    for (const c of mine) assert.ok(zeros(c.password) && zeros(c.out), 'password bytes and Argon2 output');
});
