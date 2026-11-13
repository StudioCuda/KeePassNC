// The encrypted offline copy when the same database is open in two tabs (one IndexedDB record for both), and the backup copy
// before the first upload of a database that was opened offline from that copy.
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * IndexedDB in memory, just as much as src/cache.js uses. Every transaction runs in one go (its requests and their callbacks), one
 * after the other: like the readwrite transactions of two tabs on the same store, nothing gets in between. All Vaults of this
 * process share it, the way two tabs of one browser profile share the real one.
 */
const idb = (() => {
    const data = new Map();
    const db = {
        createObjectStore() {},
        transaction() {
            const t = {}, reqs = [];
            const op = (fn) => { const r = {}; reqs.push(() => { r.result = fn(); r.onsuccess?.({ target: r }); }); return r; };
            const store = {
                get: (k) => op(() => structuredClone(data.get(k))),
                put: (v, k) => op(() => { data.set(k, structuredClone(v)); return k; }),
                delete: (k) => op(() => { data.delete(k); }),
                clear: () => op(() => data.clear()),
                getAllKeys: () => op(() => [...data.keys()])
            };
            t.objectStore = () => store;
            setTimeout(() => { while (reqs.length) reqs.shift()(); t.oncomplete?.(); });
            return t;
        }
    };
    return { data, open() { const req = {}; setTimeout(() => { req.result = db; req.onupgradeneeded?.(); req.onsuccess?.(); }); return req; } };
})();
globalThis.indexedDB = idb;

const { Vault, MemoryDav, NetworkError, kdbxweb, newDb, entryByTitle, field, PW, FAST } = await import('./vault-harness.mjs');

const P = '/db.kdbx';
const CACHE = { key: `dav:https://dav.test${P}`, name: 'db.kdbx' };

/** The server as one tab sees it: net.down makes every request fail like a server that can't be reached. */
function tabFile(dav, net) {
    const f = dav.file(P);
    const out = { url: f.url };
    for (const [k, fn] of Object.entries(f)) {
        if (typeof fn === 'function') out[k] = async (...args) => { if (net.down) throw new NetworkError(new TypeError('Failed to fetch')); return fn.apply(f, args); };
    }
    return out;
}

/** Opens the database the way login.js does: the server version, or the offline copy if it holds changes the server doesn't have yet or the server is down. */
async function openTab(dav, net) {
    const f = tabFile(dav, net);
    const cached = structuredClone(idb.data.get(CACHE.key));
    let got = null;
    try { got = await f.get(); } catch (e) { if (!(e instanceof NetworkError)) throw e; }
    const common = { password: PW, dav: f, cache: CACHE, cacheRev: cached?.rev };
    if (!got) return Vault.open({ ...common, buf: cached.bytes, etag: cached.etag, unsynced: !!cached.modified, fromCache: true });
    if (cached?.modified) return Vault.open({ ...common, buf: cached.bytes, etag: cached.etag, unsynced: true, fromCache: true, remoteBuf: got.buf });
    return Vault.open({ ...common, buf: got.buf, etag: got.etag });
}

// KDBX keeps times in whole seconds and merging goes by them: every edit gets its own second, as edits by hand have
let clock = Date.now();
const setUser = (v, title, user) => {
    const e = entryByTitle(v, title);
    v.applyEntry(e, e.parentGroup, { Title: title, UserName: user });
    e.times.lastModTime = new Date(clock += 2000);
};
const users = async (buf, pw = PW) => {
    const db = await kdbxweb.Kdbx.load(buf, new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(pw)));
    return Object.fromEntries([...db.getDefaultGroup().allEntries()].map((e) => [field(e, 'Title'), field(e, 'UserName')]));
};
const serverUsers = (dav, pw) => users(dav.bytes(P), pw);
const cachedUsers = (pw) => users(idb.data.get(CACHE.key).bytes, pw);

async function setup(titles = ['Mail', 'Bank', 'Shop']) {
    idb.data.clear();
    const dav = new MemoryDav();
    await newDb(dav, { path: P, entries: titles });
    return dav;
}

test('two tabs offline: the second save keeps what the first one stored, so closing the first one loses nothing', async () => {
    const dav = await setup();
    const net = { down: false };
    const a = await openTab(dav, net), b = await openTab(dav, net);
    net.down = true;
    setUser(a, 'Mail', 'tab-a');
    assert.equal((await a.save()).offline, true);
    setUser(b, 'Bank', 'tab-b');
    const res = await b.save();
    assert.equal(res.offline, true);
    assert.equal(res.tabMerged, true, 'the second tab must say that it merged the first one\'s changes');
    assert.equal(field(entryByTitle(b, 'Mail'), 'UserName'), 'tab-a', 'the first tab\'s change must show in the second one');
    const local = await cachedUsers();
    assert.equal(local.Mail, 'tab-a'); assert.equal(local.Bank, 'tab-b');
    // tab a is closed before the server is back; tab b uploads
    net.down = false;
    await b.sync();
    assert.equal(b.unsynced, false);
    const srv = await serverUsers(dav);
    assert.equal(srv.Mail, 'tab-a', 'the change of the closed tab is missing on the server');
    assert.equal(srv.Bank, 'tab-b');
    assert.equal(idb.data.get(CACHE.key).modified, false);
});

test('a tab that saves again after merging still keeps the other tab\'s newest changes, and the remaining tab uploads all of them', async () => {
    const dav = await setup();
    const net = { down: false };
    const a = await openTab(dav, net), b = await openTab(dav, net);
    net.down = true;
    setUser(b, 'Bank', 'tab-b');
    await b.save();
    setUser(a, 'Mail', 'tab-a');
    await a.save(); // merges b's version
    setUser(a, 'Shop', 'tab-a-2');
    await a.save();
    // a is closed; b only holds its own change and the copy a left behind
    net.down = false;
    const res = await b.sync();
    assert.equal(res.tabMerged, true);
    const srv = await serverUsers(dav);
    assert.deepEqual([srv.Mail, srv.Bank, srv.Shop], ['tab-a', 'tab-b', 'tab-a-2']);
    assert.equal(b.unsynced, false);
    assert.equal(b.dirty, false);
    assert.equal(idb.data.get(CACHE.key).modified, false);
    assert.equal(field(entryByTitle(b, 'Shop'), 'UserName'), 'tab-a-2');
});

test('a tab pulling a new server version doesn\'t overwrite changes another tab stored offline', async () => {
    const dav = await setup();
    const netA = { down: false }, netB = { down: false };
    const a = await openTab(dav, netA), b = await openTab(dav, netB);
    netA.down = true; // tab a's upload failed (the connection dropped just then)
    setUser(a, 'Mail', 'tab-a');
    assert.equal((await a.save()).offline, true);
    // another device changes the server, tab b (nothing of its own) pulls that
    const other = await Vault.open({ buf: dav.bytes(P), password: PW, dav: dav.file(P), etag: dav.files.get(P).etag });
    setUser(other, 'Shop', 'device');
    await other.save();
    const res = await b.sync();
    assert.equal(res.pulled, true);
    assert.equal(res.tabMerged, true);
    // tab a is closed before it could upload
    const srv = await serverUsers(dav);
    assert.equal(srv.Mail, 'tab-a', 'the other tab\'s change must reach the server');
    assert.equal(srv.Shop, 'device');
    assert.equal(b.unsynced, false);
    assert.equal(field(entryByTitle(b, 'Mail'), 'UserName'), 'tab-a');
});

test('a new master password in one tab: the other tab\'s offline changes (old password) are merged in and uploaded with the new one', async () => {
    const dav = await setup();
    const netA = { down: false };
    const a = await openTab(dav, netA), b = await openTab(dav, { down: false });
    netA.down = true;
    setUser(a, 'Mail', 'tab-a');
    assert.equal((await a.save()).offline, true);
    // tab a is closed; tab b (online, nothing unsynced) sets a new master password
    const res = await b.changeCredentials({ password: 'new-pw' });
    assert.equal(res.tabMerged, true);
    assert.equal((await serverUsers(dav, 'new-pw')).Mail, 'tab-a');
    assert.equal((await cachedUsers('new-pw')).Mail, 'tab-a');
    assert.equal(idb.data.get(CACHE.key).modified, false);
});

test('a single tab doesn\'t merge its own offline copy over and over', async () => {
    const dav = await setup();
    const net = { down: true };
    const a = await openTab(dav, { down: false });
    a.dav = tabFile(dav, net);
    setUser(a, 'Mail', 'one');
    assert.equal((await a.save()).tabMerged, undefined);
    setUser(a, 'Bank', 'two');
    assert.equal((await a.save()).tabMerged, undefined);
    net.down = false;
    const res = await a.sync();
    assert.equal(res.tabMerged, undefined);
    assert.equal(res.merged, false);
    const srv = await serverUsers(dav);
    assert.deepEqual([srv.Mail, srv.Bank], ['one', 'two']);
});

test('opened offline from the offline copy: the backup before the first upload is the server\'s version, not the local one', async () => {
    const dav = await setup();
    const net = { down: false };
    const a = await openTab(dav, net);
    net.down = true;
    setUser(a, 'Mail', 'offline');
    await a.save();
    // the page is reloaded while the server is still down: it opens the offline copy with the unsynced change
    const c = await openTab(dav, net);
    assert.equal(c.unsynced, true);
    const onServer = dav.bytes(P);
    net.down = false;
    await c.sync();
    const backups = [...dav.files.keys()].filter((k) => k.startsWith(`${P}.`) && k.endsWith('.bak') && !k.includes('conflict'));
    assert.equal(backups.length, 1, backups.join(', '));
    assert.deepEqual(new Uint8Array(dav.bytes(backups[0])), new Uint8Array(onServer), 'the backup must be what the server held before the upload');
    assert.equal((await serverUsers(dav)).Mail, 'offline');
});

test('a version in the offline copy that can\'t be merged stays untouched, and the save doesn\'t pretend to be stored', async () => {
    const dav = await setup();
    const net = { down: false };
    const b = await openTab(dav, net);
    // another tab left a different database (same password) with unsynced changes under this key
    const { vault: foreign, bytes } = await Vault.create({ name: 'other', password: PW, security: FAST });
    assert.ok(foreign);
    idb.data.set(CACHE.key, { bytes, etag: '"x"', modified: true, name: CACHE.name, syncDate: Date.now(), rev: 'foreign' });
    net.down = true;
    const warned = [], warn = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
        setUser(b, 'Bank', 'tab-b');
        await assert.rejects(b.save(), (e) => e instanceof NetworkError);
        assert.equal(b.dirty, true, 'the change must stay unsaved');
        await assert.rejects(b.save(), (e) => e instanceof NetworkError); // the same foreign version: not unlocked and merged again
    } finally { console.warn = warn; }
    assert.equal(warned.filter((w) => /another tab/.test(w)).length, 1, warned.join(' | '));
    assert.equal(b.dirty, true);
    assert.equal(idb.data.get(CACHE.key).rev, 'foreign');
    assert.deepEqual(new Uint8Array(idb.data.get(CACHE.key).bytes), new Uint8Array(bytes));
    // online the upload still works, and the foreign version stays where it is
    net.down = false;
    await b.save();
    assert.equal((await serverUsers(dav)).Bank, 'tab-b');
    assert.equal(idb.data.get(CACHE.key).rev, 'foreign');
});
