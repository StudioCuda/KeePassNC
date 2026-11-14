import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, Vault, FAST, PW, titles } from './vault-harness.mjs';

// A key file of exactly 32 bytes is used as the key itself. kdbxweb masks the very buffer it gets for such a file (and keeps it), so
// the vault must never hand it its own copy: a second Credentials from that copy masked it again, and the next save encrypted the
// file with a key nobody can derive. Every case ends by opening the server file with a fresh copy of the right credentials.
const KEY = crypto.getRandomValues(new Uint8Array(32));
const key = () => KEY.slice();
const P = '/db.kdbx';
const opensWith = async (dav, password = PW, keyfile = key()) => Vault.open({ buf: dav.bytes(P), password, keyfile });
const device = (dav) => Vault.open({ buf: dav.bytes(P), password: PW, keyfile: key(), dav: dav.file(P), etag: dav._tag(P) });

async function start(entries = ['one']) {
    const dav = new MemoryDav();
    const { vault } = await Vault.create({ name: 'db', password: PW, keyfile: key(), security: FAST, dav: dav.file(P) });
    for (const t of entries) vault.applyEntry(null, vault.root, { Title: t });
    await vault.save();
    return { dav, vault };
}

test('32-byte key file: the soft-lock check keeps working and the next save still opens', async () => {
    const { dav } = await start();
    const v = await device(dav);
    assert.equal(await v.matchesCredentials(PW, key()), true);
    assert.equal(await v.matchesCredentials(PW, key()), true, 'and a second time');
    assert.equal(await v.matchesCredentials(PW, crypto.getRandomValues(new Uint8Array(32))), false, 'a different key is still refused');
    v.applyEntry(null, v.root, { Title: 'two' });
    await v.save();
    assert.deepEqual(titles(await opensWith(dav)), ['one', 'two']);
});

test('32-byte key file: pulling another device\'s changes, twice, then saving', async () => {
    const { dav } = await start();
    const a = await device(dav);
    for (const t of ['from-b-1', 'from-b-2']) {
        const b = await device(dav);
        b.applyEntry(null, b.root, { Title: t });
        await b.save();
        assert.equal((await a.sync()).pulled, true);
    }
    a.applyEntry(null, a.root, { Title: 'from-a' });
    await a.save();
    assert.deepEqual(titles(await opensWith(dav)), ['from-a', 'from-b-1', 'from-b-2', 'one']);
});

test('32-byte key file: a conflict merge, then another save', async () => {
    const { dav } = await start();
    const a = await device(dav), b = await device(dav);
    b.applyEntry(null, b.root, { Title: 'b' }); await b.save();
    a.applyEntry(null, a.root, { Title: 'a' });
    assert.equal((await a.save()).merged, true);
    a.applyEntry(null, a.root, { Title: 'a2' }); await a.save();
    assert.deepEqual(titles(await opensWith(dav)), ['a', 'a2', 'b', 'one']);
});

test('32-byte key file: changing only the password keeps the key file working', async () => {
    const { dav } = await start();
    const v = await device(dav);
    await v.changeCredentials({ password: 'pw2' });
    assert.deepEqual(titles(await opensWith(dav, 'pw2')), ['one']);
    v.applyEntry(null, v.root, { Title: 'two' }); await v.save();
    assert.deepEqual(titles(await opensWith(dav, 'pw2')), ['one', 'two']);
    await assert.rejects(opensWith(dav), (e) => e.key === 'e.badkey', 'the old password no longer opens it');
});

test('32-byte key file: merging a copy of the database in ("Merge database") with the session\'s credentials', async () => {
    const { dav } = await start();
    const other = await device(dav);
    other.applyEntry(null, other.root, { Title: 'copy' });
    const copy = await other.copyBytes();
    const v = await device(dav);
    await v.mergeFrom(copy);
    await v.save();
    assert.deepEqual(titles(await opensWith(dav)), ['copy', 'one']);
});

test('32-byte key file: the caller\'s bytes stay as they were, and the remembered copy is the key', async () => {
    const dav = new MemoryDav();
    const mine = key();
    const { vault } = await Vault.create({ name: 'db', password: PW, keyfile: mine, security: FAST, dav: dav.file(P) });
    assert.deepEqual(mine, KEY, 'create');
    const again = key();
    const v = await Vault.open({ buf: dav.bytes(P), password: PW, keyfile: again, dav: dav.file(P), etag: dav._tag(P) });
    assert.deepEqual(again, KEY, 'open');
    await v.matchesCredentials(PW, key());
    assert.deepEqual(v.keyfileCopy(), KEY, 'keyfileCopy after the soft-lock check');
    void vault;
});
