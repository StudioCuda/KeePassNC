// Changing the master password or key file while the network misbehaves: the vault has to end up in the state the server is in.
// A PUT whose answer got lost may well have arrived, so the vault asks the server before it calls the change done or failed, and a
// change that only reached the offline copy must still merge after a reload of the page (the server version keeps the old credentials).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, titles, Vault, DavError, NetworkError, kdbxweb, ProtectedValue, PW } from './vault-harness.mjs';

const FILE = '/db.kdbx';
const NEW = 'new-secret';

// The offline copy lives in IndexedDB (src/cache.js), which Node doesn't have: a tiny stand-in with the calls cache.js makes.
const idb = new Map();
globalThis.indexedDB = {
    open() {
        const req = {};
        setTimeout(() => {
            req.result = {
                createObjectStore() {},
                transaction() {
                    const t = {};
                    t.objectStore = () => ({
                        get: (k) => ({ result: structuredClone(idb.get(k)) }),
                        put: (v, k) => { idb.set(k, structuredClone(v)); return { result: k }; },
                        delete: (k) => { idb.delete(k); return {}; },
                        clear: () => { idb.clear(); return {}; },
                        getAllKeys: () => ({ result: [...idb.keys()] })
                    });
                    setTimeout(() => t.oncomplete?.());
                    return t;
                }
            };
            req.onupgradeneeded?.();
            req.onsuccess?.();
        });
        return req;
    }
};
let cacheNo = 0;
const newCache = () => ({ key: `test:${++cacheNo}`, name: 'db.kdbx' });

/** The next n uploads arrive on the server, but their answer doesn't come back (connection dropped, proxy gave up waiting). */
function loseAnswers(dav, n = 1, error = () => new NetworkError(new TypeError('Failed to fetch'))) {
    dav.hooks.afterPut = async ({ path }) => { if (path === FILE && n > 0) { n--; throw error(); } };
}
/** The server can't be reached at all: neither upload nor download get through. */
function outage(dav) {
    const down = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    dav.hooks.beforePut = down;
    dav.hooks.beforeGet = down;
}
const back = (dav) => { dav.hooks = {}; };
async function opensWith(dav, password) {
    try { await kdbxweb.Kdbx.load(dav.bytes(FILE), new kdbxweb.Credentials(ProtectedValue.fromString(password))); return true; } catch { return false; }
}
const conflictCopies = (dav) => [...dav.files.keys()].filter((k) => k.includes('.conflict-'));
/** Opens the server version with the offline copy switched on, as the login does. */
async function openCached(dav, cache, password = PW) {
    return Vault.open({ buf: dav.bytes(FILE), password, dav: dav.file(FILE), etag: dav._tag(FILE), cache });
}
/** A reload of the page: the login finds unsynced changes in the offline copy and opens those, with the server version next to them (login.js). */
async function reopen(dav, cache, password, { serverReachable = true } = {}) {
    const rec = idb.get(cache.key);
    assert.ok(rec?.modified, 'the offline copy should hold unsynced changes');
    return Vault.open({ buf: rec.bytes, password, dav: dav.file(FILE), etag: rec.etag, cache, unsynced: true, remoteBuf: serverReachable ? dav.bytes(FILE) : undefined, fromCache: true, newCreds: rec.newCreds });
}
async function rejectsWith(promise, key) {
    await assert.rejects(promise, (e) => { assert.equal(e.key, key, `${e.key}: ${e.message}`); return true; });
}

test('lost answer to the upload of new credentials: the vault asks the server, the change counts and nothing is left to sync', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    loseAnswers(dav);
    const res = await v.changeCredentials({ password: NEW });
    assert.ok(!res.offline, 'the server has the file, so it is not "kept locally"');
    assert.equal(v.unsynced, false);
    assert.equal(v.dirty, false);
    assert.ok(await v.checkPassword(NEW));
    assert.ok(await opensWith(dav, NEW));
    assert.equal(v.etag, dav._tag(FILE));
    // The next save goes straight through: no conflict with ourselves, no question for credentials "changed on another device"
    v.applyEntry(null, v.root, { Title: 'B' });
    const next = await v.save();
    assert.ok(!next.merged);
    assert.deepEqual(conflictCopies(dav), []);
    assert.deepEqual(titles(await openDb(dav, { password: NEW })), ['A', 'B']);
});

test('a gateway timeout (504) after the server stored the new credentials counts as done, too', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    loseAnswers(dav, 1, () => new DavError(504, 'Gateway Timeout', 'e.dav.save', { status: 504 }));
    const res = await v.changeCredentials({ password: NEW });
    assert.ok(!res.offline);
    assert.equal(v.unsynced, false);
    assert.ok(await opensWith(dav, NEW));
});

test('with the offline copy: lost answer -> done, the offline copy is in sync and opens with the new credentials', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    loseAnswers(dav);
    const res = await v.changeCredentials({ password: NEW });
    assert.ok(!res.offline);
    assert.equal(v.unsynced, false);
    const rec = idb.get(cache.key);
    assert.equal(rec.modified, false);
    assert.equal(rec.etag, dav._tag(FILE));
    assert.ok(!rec.newCreds);
    await kdbxweb.Kdbx.load(rec.bytes, new kdbxweb.Credentials(ProtectedValue.fromString(NEW)));
});

test('with the offline copy: answer lost and the server gone for the check -> kept locally, the later sync recognizes its own upload', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    loseAnswers(dav);
    dav.hooks.beforeGet = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    const res = await v.changeCredentials({ password: NEW });
    assert.ok(res.offline, 'nothing confirmed: the change is kept on this device');
    assert.ok(res.unconfirmed, 'and the message may not claim the server still has the old ones');
    assert.ok(v.unsynced);
    assert.ok(await opensWith(dav, NEW), 'test setup: the upload did arrive');
    back(dav);
    const sync = await v.sync();
    assert.ok(!sync.offline && !sync.merged, JSON.stringify(sync));
    assert.equal(v.unsynced, false);
    assert.deepEqual(conflictCopies(dav), []);
    assert.ok(await opensWith(dav, NEW));
    assert.equal(idb.get(cache.key).modified, false);
});

test('with the offline copy: answer lost, server gone, page reloaded -> the reopened copy finds its upload on the server, no merge, no question', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    loseAnswers(dav);
    dav.hooks.beforeGet = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    assert.ok((await v.changeCredentials({ password: NEW })).offline);
    back(dav);
    const v2 = await reopen(dav, cache, NEW);
    const sync = await v2.sync();
    assert.ok(!sync.offline && !sync.merged, JSON.stringify(sync));
    assert.equal(v2.unsynced, false);
    assert.deepEqual(conflictCopies(dav), []);
    assert.ok(await opensWith(dav, NEW));
});

test('without the offline copy: answer lost and no way to check -> not changed, and the next save puts the old credentials back on the server', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    loseAnswers(dav);
    dav.hooks.beforeGet = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    await rejectsWith(v.changeCredentials({ password: NEW }), 'e.cred.unconfirmed');
    assert.ok(await v.checkPassword(PW), 'the old credentials apply in the tab');
    assert.ok(v.dirty);
    assert.ok(await opensWith(dav, NEW), 'test setup: the upload did arrive');
    back(dav);
    v.applyEntry(null, v.root, { Title: 'B' });
    const res = await v.save();
    assert.ok(!res.merged, JSON.stringify(res));
    assert.ok(await opensWith(dav, PW), 'the server is back on the credentials the message promised');
    assert.ok(!(await opensWith(dav, NEW)));
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
    assert.deepEqual(conflictCopies(dav), []);
});

test('the upload never reached the server: the old credentials apply again, as before', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    dav.hooks.beforePut = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    await rejectsWith(v.changeCredentials({ password: NEW }), 'e.network');
    assert.ok(await v.checkPassword(PW));
    assert.ok(await opensWith(dav, PW));
    back(dav);
    v.applyEntry(null, v.root, { Title: 'B' });
    await v.save();
    assert.ok(await opensWith(dav, PW));
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
});

test('a 503 that never stored anything: the check finds the old file, the old credentials apply again', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    dav.hooks.beforePut = async () => { throw new DavError(503, 'Service Unavailable', 'e.dav.save', { status: 503 }); };
    await rejectsWith(v.changeCredentials({ password: NEW }), 'e.dav.save');
    assert.ok(await v.checkPassword(PW));
    assert.ok(await opensWith(dav, PW));
});

test('server down during the change, no offline copy: not changed, without a guess about the server; once it is back, saving keeps the old credentials', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    outage(dav);
    await rejectsWith(v.changeCredentials({ password: NEW }), 'e.cred.unconfirmed');
    assert.ok(await v.checkPassword(PW));
    back(dav);
    v.applyEntry(null, v.root, { Title: 'B' });
    assert.ok(!(await v.save()).merged);
    assert.ok(await opensWith(dav, PW));
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
    // and a second try at the change goes through
    assert.ok(!(await v.changeCredentials({ password: NEW })).offline);
    assert.ok(await opensWith(dav, NEW));
});

test('a lost answer, then the change is tried again: the second try lands on top of the first, no question for credentials', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    loseAnswers(dav);
    dav.hooks.beforeGet = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    await rejectsWith(v.changeCredentials({ password: NEW }), 'e.cred.unconfirmed');
    back(dav);
    const res = await v.changeCredentials({ password: 'newer-secret' });
    assert.ok(!res.offline && !res.merged, JSON.stringify(res));
    assert.ok(await opensWith(dav, 'newer-secret'));
    assert.deepEqual(conflictCopies(dav), []);
});

test('offline change, page reloaded, server unchanged: the reopened copy uploads the new credentials', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    outage(dav);
    assert.ok((await v.changeCredentials({ password: NEW })).offline);
    assert.equal(idb.get(cache.key).newCreds, true, 'the offline copy remembers that the server still has the old credentials');
    const v2 = await reopen(dav, cache, NEW, { serverReachable: false });
    back(dav);
    const res = await v2.sync();
    assert.ok(!res.offline && !res.merged, JSON.stringify(res));
    assert.ok(await opensWith(dav, NEW));
    assert.equal(idb.get(cache.key).newCreds, false);
});

test('offline change, page reloaded, server changed meanwhile: asks once for the previous credentials, merges, keeps the new ones', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    v.applyEntry(null, v.root, { Title: 'Here' });
    outage(dav);
    assert.ok((await v.changeCredentials({ password: NEW })).offline);
    back(dav);
    const phone = await openDb(dav); // another device, still with the old password
    phone.applyEntry(null, phone.root, { Title: 'Phone' });
    await phone.save();
    const v2 = await reopen(dav, cache, NEW);
    await rejectsWith(v2.sync(), 'e.merge.oldpw');
    await rejectsWith(v2.sync(), 'e.merge.oldpw'); // the background retry, while the question is still open
    assert.ok(v2.unsynced);
    assert.deepEqual(conflictCopies(dav), [], 'a version nobody can read yet is not copied again with every retry');
    await rejectsWith(v2.previousCredentials({ password: 'not-it' }), 'e.badkey');
    assert.ok(v2.unsynced && await v2.checkPassword(NEW), 'a wrong answer changes nothing');
    const res = await v2.previousCredentials({ password: PW });
    assert.ok(res.merged, JSON.stringify(res));
    assert.equal(conflictCopies(dav).length, 1, 'the merged server version is kept once');
    assert.equal(v2.unsynced, false);
    assert.ok(await v2.checkPassword(NEW), 'the new credentials stay');
    assert.ok(await opensWith(dav, NEW));
    assert.ok(!(await opensWith(dav, PW)));
    assert.deepEqual(titles(await openDb(dav, { password: NEW })), ['A', 'Here', 'Phone']);
    assert.deepEqual(titles(v2), ['A', 'Here', 'Phone']);
    assert.equal(idb.get(cache.key).newCreds, false);
});

test('offline change of the key file only, page reloaded, server changed: the previous credentials are the password without the new key file', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    const keyfile = new Uint8Array(await kdbxweb.Credentials.createKeyFileWithHash(crypto.getRandomValues(new Uint8Array(32)).buffer, 2));
    outage(dav);
    assert.ok((await v.changeCredentials({ keyfile: keyfile.slice() })).offline);
    back(dav);
    const phone = await openDb(dav);
    phone.applyEntry(null, phone.root, { Title: 'Phone' });
    await phone.save();
    const rec = idb.get(cache.key);
    const v2 = await Vault.open({ buf: rec.bytes, password: PW, keyfile: keyfile.slice(), dav: dav.file(FILE), etag: rec.etag, cache, unsynced: true, remoteBuf: dav.bytes(FILE), fromCache: true, newCreds: rec.newCreds });
    await rejectsWith(v2.sync(), 'e.merge.oldpw');
    const res = await v2.previousCredentials({ password: PW }); // no key file picked: the current one is tried, then none
    assert.ok(res.merged);
    await kdbxweb.Kdbx.load(dav.bytes(FILE), new kdbxweb.Credentials(ProtectedValue.fromString(PW), keyfile.buffer.slice(0)));
    assert.deepEqual(titles(v2), ['A', 'Phone']);
});

test('previous credentials answered, but the server is gone again before the upload: kept locally, the next sync merges without asking', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    outage(dav);
    assert.ok((await v.changeCredentials({ password: NEW })).offline);
    back(dav);
    const phone = await openDb(dav);
    phone.applyEntry(null, phone.root, { Title: 'Phone' });
    await phone.save();
    const v2 = await reopen(dav, cache, NEW);
    await rejectsWith(v2.sync(), 'e.merge.oldpw');
    dav.hooks.beforePut = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    const res = await v2.previousCredentials({ password: PW });
    assert.ok(res.offline, JSON.stringify(res));
    assert.ok(v2.unsynced);
    back(dav);
    const sync = await v2.sync();
    assert.ok(sync.merged, JSON.stringify(sync));
    assert.ok(await opensWith(dav, NEW));
    assert.deepEqual(titles(v2), ['A', 'Phone']);
});

test('previous credentials with nothing left to merge: no request, nothing changed', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    const requests = dav.log.length;
    assert.deepEqual(await v.previousCredentials({ password: 'whatever' }), {});
    assert.equal(dav.log.length, requests);
    v.applyEntry(null, v.root, { Title: 'B' });
    assert.ok(!(await v.save()).merged, 'the base credentials are still the right ones');
});

test('credentials changed on another device while our content changes waited offline: still the question for the new ones', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    v.applyEntry(null, v.root, { Title: 'Here' });
    outage(dav);
    assert.ok((await v.save()).offline); // only content, no credentials changed here
    back(dav);
    const phone = await openDb(dav);
    await phone.changeCredentials({ password: 'phone-secret' });
    const v2 = await reopen(dav, cache, PW);
    await rejectsWith(v2.sync(), 'e.merge.pw');
});

test('a normal save whose answer got lost: the next sync recognizes its own upload instead of merging with itself', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    v.applyEntry(null, v.root, { Title: 'B' });
    loseAnswers(dav);
    assert.ok((await v.save()).offline);
    const res = await v.sync();
    assert.ok(!res.offline && !res.merged, JSON.stringify(res));
    assert.equal(v.unsynced, false);
    assert.deepEqual(conflictCopies(dav), []);
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
});

test('lost answer, then more changes before the next save: the earlier upload becomes the base, the later state goes on top', async () => {
    const dav = new MemoryDav();
    await newDb(dav, { entries: ['A'] });
    const cache = newCache();
    const v = await openCached(dav, cache);
    loseAnswers(dav);
    dav.hooks.beforeGet = async () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    assert.ok((await v.changeCredentials({ password: NEW })).offline);
    back(dav);
    v.applyEntry(null, v.root, { Title: 'B' });
    const res = await v.save();
    assert.ok(!res.offline && !res.merged, JSON.stringify(res));
    assert.deepEqual(conflictCopies(dav), []);
    assert.deepEqual(titles(await openDb(dav, { password: NEW })), ['A', 'B']);
});
