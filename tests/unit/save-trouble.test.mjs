// Saving while the server misbehaves: no space left, a locked file, a file that was moved or deleted, an upload that takes its time.
// Whatever happens, changes may never be lost silently: they stay dirty, or sit in the offline copy, and Vault.unsaved says which.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, titles, DavError, NetworkError } from './vault-harness.mjs';

/** Pretends the offline copy is on and works (Node has no IndexedDB): every write to it succeeds. */
function withOfflineCopy(v) {
    v.cache = { key: 'test', name: 'db.kdbx' };
    v._cacheWrite = async () => true;
    return v;
}
const add = (v, title) => v.applyEntry(null, v.root, { Title: title });
const fail = (status, key) => () => { throw new DavError(status, key, key); };
async function until(cond) {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(cond(), 'gave up waiting');
}

test('While an upload is under way without an offline copy, the changes count as unsaved (dirty is already false)', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    add(v, 'B');
    let release;
    dav.hooks.beforePut = () => new Promise((r) => { release = r; }); // the answer takes its time
    const saving = v.save();
    await until(() => release);
    assert.equal(v.dirty, false);
    assert.equal(v.unsaved, true, 'closing the tab now would lose B');
    release();
    await saving;
    assert.equal(v.unsaved, false);
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
});

test('With the offline copy holding the version, an upload under way or an outage loses nothing', async () => {
    const dav = new MemoryDav();
    const v = withOfflineCopy(await newDb(dav, { entries: ['A'] }));
    add(v, 'B');
    let release;
    dav.hooks.beforePut = () => new Promise((r) => { release = r; });
    const saving = v.save();
    await until(() => release);
    assert.equal(v.unsaved, false, 'the offline copy has B');
    release();
    await saving;
    add(v, 'C');
    dav.hooks.beforePut = () => { throw new NetworkError(new TypeError('Failed to fetch')); };
    assert.deepEqual(await v.save(), { offline: true });
    assert.equal(v.unsynced, true);
    assert.equal(v.unsaved, false);
    assert.equal(v.writeBlocked, null, 'an outage is no reason for the banner');
});

test('No space left on the server (507) with the offline copy: an error, not "saved offline", and the next upload after that goes through', async () => {
    const dav = new MemoryDav();
    const v = withOfflineCopy(await newDb(dav, { entries: ['A'] }));
    add(v, 'B');
    dav.hooks.beforePut = fail(507, 'e.dav.full');
    await assert.rejects(v.save(), (e) => e.key === 'e.dav.full');
    assert.equal(v.writeBlocked, 'full');
    assert.equal(v.unsynced, true, 'B waits in the offline copy');
    assert.equal(v.unsaved, false);
    assert.notDeepEqual(await v.save({ auto: true }).catch((e) => e.key), { skipped: true }, 'background saves keep trying: space may come back');
    delete dav.hooks.beforePut; // space again
    await v.sync({ background: true });
    assert.equal(v.writeBlocked, null);
    assert.equal(v.unsynced, false);
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
});

test('No space left (507) without the offline copy: the error comes through and the changes stay dirty', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    add(v, 'B');
    dav.hooks.beforePut = fail(507, 'e.dav.full');
    await assert.rejects(v.save(), (e) => e.key === 'e.dav.full');
    assert.equal(v.writeBlocked, 'full');
    assert.equal(v.dirty, true);
    assert.equal(v.unsaved, true);
});

test('A locked file (423) is said as such, and the block ends with the next upload that works', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    add(v, 'B');
    dav.hooks.beforePut = fail(423, 'e.dav.locked');
    await assert.rejects(v.save(), (e) => e.key === 'e.dav.locked');
    assert.equal(v.writeBlocked, 'locked');
    assert.equal(v.dirty, true);
    delete dav.hooks.beforePut;
    await v.save();
    assert.equal(v.writeBlocked, null);
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
});

test('A file deleted on the server: saving says so instead of "check the path", keeps the changes, and never creates the file by itself', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    add(v, 'B');
    dav.files.delete('/db.kdbx');
    await assert.rejects(v.save(), (e) => e.key === 'e.gone');
    assert.equal(v.writeBlocked, 'gone');
    assert.equal(v.dirty, true);
    assert.equal(v.unsaved, true);
    assert.equal(dav.files.has('/db.kdbx'), false);
    assert.deepEqual(await v.save({ auto: true }), { skipped: true }, 'retrying in the background changes nothing');
    assert.deepEqual(await v.sync({ background: true }), { skipped: true });
    // Putting it back is the user's call
    const res = await v.recreate();
    assert.equal(res.recreated, true);
    assert.equal(v.writeBlocked, null);
    assert.equal(v.dirty, false);
    assert.equal(v.unsynced, false);
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B']);
    add(v, 'C'); // from now on it saves the normal way, against the new ETag
    await v.save();
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B', 'C']);
});

test('Putting the file back never overwrites: if another device put one there in the meantime, the two are merged', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    const other = await openDb(dav);
    add(v, 'B');
    dav.files.delete('/db.kdbx');
    await assert.rejects(v.save(), (e) => e.key === 'e.gone');
    add(other, 'X');
    dav.write('/db.kdbx', await other.copyBytes()); // restored from the trash on another device, with a change of its own
    const res = await v.recreate();
    assert.equal(res.merged, true);
    assert.deepEqual(titles(await openDb(dav)), ['A', 'B', 'X']);
    assert.ok([...dav.files.keys()].some((k) => k.startsWith('/db.kdbx.conflict-')), 'the other version is kept as a conflict backup');
});

test('Putting the file back when its folder is gone, too: that is what the message says, and the changes stay', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    add(v, 'B');
    dav.files.delete('/db.kdbx');
    await assert.rejects(v.save(), (e) => e.key === 'e.gone');
    v.dav.create = async () => { throw new DavError(409, 'no folder', 'e.dav.nofolder'); }; // as DavFile.create answers then
    await assert.rejects(v.recreate(), (e) => e.key === 'e.dav.nofolder');
    assert.equal(v.writeBlocked, 'gone');
    assert.equal(v.dirty, true);
});

test('A file that is gone while nothing changed here: the sync says so, background syncs stand down', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['A'] });
    dav.files.delete('/db.kdbx');
    await assert.rejects(v.sync(), (e) => e.key === 'e.gone');
    assert.equal(v.writeBlocked, 'gone');
    assert.equal(v.unsaved, false, 'nothing changed here');
    assert.deepEqual(await v.sync({ background: true }), { skipped: true });
});

test('Gone while the version sits only in the offline copy counts as unsaved: opening goes through the server, which has no file', async () => {
    const dav = new MemoryDav();
    const v = withOfflineCopy(await newDb(dav, { entries: ['A'] }));
    add(v, 'B');
    dav.files.delete('/db.kdbx');
    await assert.rejects(v.save(), (e) => e.key === 'e.gone');
    assert.equal(v.dirty, false);
    assert.equal(v.unsynced, true);
    assert.equal(v.unsaved, true);
});
