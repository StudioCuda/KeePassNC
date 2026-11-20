// A background pull replaces the whole database with the server's version. Whatever changes here while it downloads and decrypts,
// and whatever entry or group the page still holds from before (an open dialog, an Undo, a drag), must not get lost or end up twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, titles, title, entryByTitle, groupByName, VaultError } from './vault-harness.mjs';

/** UUIDs that occur more than once in the tree: a stale object moved into the new tree shows up here next to its twin. */
function dupes(vault) {
    const seen = new Map();
    for (const item of vault.root.allGroupsAndEntries()) seen.set(item.uuid.id, (seen.get(item.uuid.id) || 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
}
const inBin = (vault, t) => { const e = entryByTitle(vault, t); return !!e && vault.isInRecycleBin(e); };
const groupNames = (vault) => [...vault.root.allGroups()].map((g) => g.name).sort();
/** Edits an entry as if its previous version was saved on day n of 2026: versions a day apart (the file keeps whole seconds only). */
function editOn(vault, t, user, day) {
    const e = entryByTitle(vault, t);
    e.times.lastModTime = new Date(Date.UTC(2026, 0, day));
    return vault.applyEntry(e, null, { Title: t, UserName: user });
}
const gone = (e) => e instanceof VaultError && e.key === 'e.gone';

/** Device a and device b on the same file; b has saved a change ("from-b") that a hasn't seen yet. */
async function twoDevices({ entries = ['one', 'two'], groups = [] } = {}) {
    const dav = new MemoryDav();
    const a = await newDb(dav, { entries });
    for (const n of groups) a.createGroup(a.root, n);
    if (groups.length) await a.save();
    const b = await openDb(dav);
    b.applyEntry(null, b.root, { Title: 'from-b' });
    await b.save();
    return { dav, a, b };
}

/** Starts a background sync of a and runs change() while the pull decrypts the server version (right after the download). */
async function changeDuringPull(dav, a, change) {
    const db = a.db;
    let ran = false, beforeSwap = false, out;
    dav.hooks.afterGet = async () => {
        dav.hooks.afterGet = null;
        setImmediate(() => { ran = true; beforeSwap = a.db === db; out = change(); }); // the next turn of the event loop: Kdbx.load is running
    };
    const res = await a.sync({ background: true });
    assert.ok(ran && beforeSwap, 'the change did not run while the pull decrypted');
    return { res, out: await out };
}

test('a pull without local changes still takes over the server version', async () => {
    const { a } = await twoDevices();
    assert.deepEqual(await a.sync({ background: true }), { pulled: true });
    assert.deepEqual(titles(a), ['from-b', 'one', 'two']);
    assert.equal(a.dirty, false);
});

test('a change while the download is still running makes the pull stand down (as before)', async () => {
    const { dav, a } = await twoDevices();
    dav.hooks.afterGet = async () => { dav.hooks.afterGet = null; a.removeEntry(entryByTitle(a, 'two')); };
    assert.deepEqual(await a.sync({ background: true }), { pulled: false });
    assert.ok(inBin(a, 'two'));
});

test('an entry deleted while the pull decrypts stays deleted, also on the server after the next save', async () => {
    const { dav, a } = await twoDevices();
    const { res } = await changeDuringPull(dav, a, () => a.removeEntry(entryByTitle(a, 'one')));
    assert.deepEqual(res, { pulled: false });
    assert.ok(inBin(a, 'one'), 'the pull undid the deletion');
    assert.equal(a.dirty, true);
    assert.equal((await a.save()).merged, true);
    const s = await openDb(dav);
    assert.deepEqual(titles(s), ['from-b', 'two']);
    assert.ok(inBin(s, 'one'));
});

test('a move while the pull decrypts is kept', async () => {
    const { dav, a } = await twoDevices({ groups: ['Target'] });
    await changeDuringPull(dav, a, () => a.moveEntry(entryByTitle(a, 'one'), groupByName(a, 'Target')));
    assert.equal(entryByTitle(a, 'one').parentGroup.name, 'Target');
    await a.save();
    const s = await openDb(dav);
    assert.equal(entryByTitle(s, 'one').parentGroup.name, 'Target');
    assert.ok(entryByTitle(s, 'from-b'));
});

test('tags edited while the pull decrypts are kept', async () => {
    const { dav, a } = await twoDevices();
    await changeDuringPull(dav, a, () => a.editTags([entryByTitle(a, 'one'), entryByTitle(a, 'two')], { add: ['work'] }));
    await a.save();
    const s = await openDb(dav);
    assert.deepEqual([entryByTitle(s, 'one').tags, entryByTitle(s, 'two').tags], [['work'], ['work']]);
    assert.ok(entryByTitle(s, 'from-b'));
});

test('an edit and a new entry applied while the pull decrypts are kept', async () => {
    const { dav, a } = await twoDevices();
    await changeDuringPull(dav, a, () => {
        a.applyEntry(entryByTitle(a, 'one'), null, { Title: 'one', UserName: 'edited-here' });
        a.applyEntry(null, a.root, { Title: 'new-here' });
    });
    assert.deepEqual(titles(a), ['new-here', 'one', 'two']);
    await a.save();
    const s = await openDb(dav);
    assert.deepEqual(titles(s), ['from-b', 'new-here', 'one', 'two']);
    assert.equal(entryByTitle(s, 'one').fields.get('UserName'), 'edited-here');
});

test('database settings changed while the pull decrypts are kept', async () => {
    const { dav, a } = await twoDevices();
    await changeDuringPull(dav, a, () => a.updateGeneralSettings({ name: 'renamed-here' }));
    assert.equal(a.db.meta.name, 'renamed-here');
    await a.save();
    assert.equal((await openDb(dav)).db.meta.name, 'renamed-here');
});

test('an import started while the pull decrypts waits for it and lands in the current database', async () => {
    const { dav, a } = await twoDevices();
    const rows = ['i1', 'i2', 'i3'].map((t) => ({ title: t, user: '', password: 'p', url: '', notes: '', tags: [], path: ['Sub'], attachments: [{ name: t + '.txt', data: new TextEncoder().encode(t) }] }));
    const { out: group } = await changeDuringPull(dav, a, () => a.importEntries(rows, 'Import'));
    assert.ok([...a.root.allGroups()].includes(group), 'the group it returns is not part of the database');
    assert.deepEqual(group.groups[0].entries.map(title), ['i1', 'i2', 'i3']);
    assert.deepEqual(titles(a), ['from-b', 'i1', 'i2', 'i3', 'one', 'two']);
    assert.deepEqual(dupes(a), []);
    await a.save();
    const s = await openDb(dav);
    assert.deepEqual(titles(s), ['from-b', 'i1', 'i2', 'i3', 'one', 'two']);
    assert.equal(new TextDecoder().decode(entryByTitle(s, 'i2').binaries.get('i2.txt').value), 'i2');
});

test('a merge started while the pull decrypts waits for it, and what it brings in stays', async () => {
    const { dav, a, b } = await twoDevices();
    // the server version takes longer to decrypt than the copy: without the queue the merge would be done first and the pull would drop it
    b.updateSecuritySettings({ cipher: 'aes', kdf: 'aes', rounds: 300000 });
    b.applyEntry(null, b.root, { Title: 'from-b-2' });
    await b.save();
    const copy = await openDb(dav);
    copy.applyEntry(null, copy.root, { Title: 'from-copy' });
    copy.updateSecuritySettings({ cipher: 'aes', kdf: 'aes', rounds: 1000 });
    const copyBytes = await copy.db.save();
    const { out: count } = await changeDuringPull(dav, a, () => a.mergeFrom(copyBytes));
    assert.ok(count.added >= 1, JSON.stringify(count));
    assert.ok(entryByTitle(a, 'from-copy'), 'the merged entry is gone');
    assert.ok(entryByTitle(a, 'from-b-2'));
    assert.deepEqual(dupes(a), []);
    await a.save();
    assert.deepEqual(titles(await openDb(dav)), ['from-b', 'from-b-2', 'from-copy', 'one', 'two']);
});

test('merge and import queue behind a running sync and still refuse in a read-only session', async () => {
    const { a } = await twoDevices();
    a.readOnly = true;
    await assert.rejects(async () => a.mergeFrom(new ArrayBuffer(8)), (e) => e.key === 'e.dav.readonly');
    await assert.rejects(async () => a.importEntries([], 'x'), (e) => e.key === 'e.dav.readonly');
    a.readOnly = false;
    const order = [];
    await Promise.all([
        a.sync({ background: true }).then(() => order.push('sync')),
        a.importEntries([{ title: 'q', user: '', password: '', url: '', notes: '', tags: [], path: [] }], 'Q').then(() => order.push('import'))
    ]);
    assert.deepEqual(order, ['sync', 'import']);
    assert.deepEqual(titles(a), ['from-b', 'one', 'q', 'two']);
});

/**
 * a holds objects from before a pull (an open dialog, an Undo toast); the pull swaps the database (nothing changed here), then the
 * dialog acts on what it holds. prepare(a, b) runs first; afterwards b always saves one more change, so a has something to pull.
 */
async function stale({ prepare } = {}) {
    const { dav, a, b } = await twoDevices({ groups: ['G', 'H'] });
    await prepare?.(a, b);
    await b.sync();
    b.applyEntry(null, b.root, { Title: 'from-b-again' });
    await b.save();
    const held = { one: entryByTitle(a, 'one'), two: entryByTitle(a, 'two'), G: groupByName(a, 'G'), H: groupByName(a, 'H'), root: a.root };
    assert.deepEqual(await a.sync({ background: true }), { pulled: true });
    assert.notEqual(entryByTitle(a, 'two'), held.two, 'the pull should have replaced the objects');
    return { dav, a, held };
}

/** After acting on stale objects: no UUID twice, saving works, and a later conflict with another device still merges. */
async function stillMerges(dav, a) {
    assert.deepEqual(dupes(a), []);
    await a.save();
    const c = await openDb(dav);
    c.applyEntry(null, c.root, { Title: 'from-c' });
    await c.save();
    a.applyEntry(null, a.root, { Title: 'after' });
    assert.equal((await a.save()).merged, true);
    assert.equal(a.mergeBlocked, false);
    assert.deepEqual(dupes(await openDb(dav)), []);
}

test('moving an entry held from before a pull moves the current one instead of adding a twin', async () => {
    const { dav, a, held } = await stale();
    a.moveEntry(held.one, held.G);
    assert.equal(entryByTitle(a, 'one').parentGroup, groupByName(a, 'G'));
    await stillMerges(dav, a);
    assert.equal(entryByTitle(await openDb(dav), 'one').parentGroup.name, 'G');
});

test('every change on entries and groups held from before a pull acts on the current database', async (t) => {
    const prepare = async (a) => {
        await a.sync(); // b's change first: a merge would mix the backdated versions with the original one
        editOn(a, 'one', 'v1', 1); editOn(a, 'one', 'v2', 2); // history: '', 'v1'
        entryByTitle(a, 'two').fields.set('KPEX_PASSKEY_USERNAME', 'me');
        await a.save();
    };
    const ops = {
        removeEntry: (a, h) => { a.removeEntry(h.one); assert.ok(inBin(a, 'one')); },
        moveEntry: (a, h) => { a.moveEntry(h.two, h.H); assert.equal(entryByTitle(a, 'two').parentGroup, groupByName(a, 'H')); },
        editTags: (a, h) => { assert.equal(a.editTags([h.one, h.two], { add: ['x'] }), 2); assert.deepEqual(entryByTitle(a, 'one').tags, ['x']); },
        applyEntryEdit: (a, h) => { const e = a.applyEntry(h.one, null, { Title: 'one', UserName: 'u3' }); assert.equal(e, entryByTitle(a, 'one')); assert.equal(e.fields.get('UserName'), 'u3'); },
        applyEntryNew: (a, h) => { const e = a.applyEntry(null, h.G, { Title: 'fresh' }); assert.equal(e.parentGroup, groupByName(a, 'G')); },
        duplicateEntry: (a, h) => { const c = a.duplicateEntry(h.one, ' copy'); assert.equal(c.parentGroup, a.root); assert.equal(entryByTitle(a, 'one copy'), c); },
        createGroup: (a, h) => { const g = a.createGroup(h.G, 'Sub'); assert.equal(g.parentGroup, groupByName(a, 'G')); },
        updateGroup: (a, h) => { a.updateGroup(h.G, { name: 'G2' }); assert.deepEqual(groupNames(a).filter((n) => n.startsWith('G')), ['G2']); },
        removeGroup: (a, h) => { a.removeGroup(h.H); assert.ok(a.isInRecycleBin(groupByName(a, 'H'))); },
        moveGroup: (a, h) => { assert.equal(a.moveGroup(h.H, h.G), true); assert.equal(groupByName(a, 'H').parentGroup, groupByName(a, 'G')); },
        restoreHistory: (a, h) => { a.restoreHistory(h.one, 1); assert.equal(entryByTitle(a, 'one').fields.get('UserName'), 'v1'); },
        deleteHistory: (a, h) => { a.deleteHistory(h.one, 0); assert.deepEqual(entryByTitle(a, 'one').history.map((x) => x.fields.get('UserName')), ['v1']); },
        clearHistory: (a, h) => { a.clearHistory(h.one); assert.equal(entryByTitle(a, 'one').history.length, 0); },
        removePasskey: (a, h) => { assert.equal(a.removePasskey(h.two), true); assert.equal(entryByTitle(a, 'two').fields.has('KPEX_PASSKEY_USERNAME'), false); }
    };
    for (const [name, op] of Object.entries(ops)) {
        await t.test(name, async () => {
            const { dav, a, held } = await stale({ prepare });
            op(a, held);
            assert.equal(a.dirty, true);
            await stillMerges(dav, a);
        });
    }
});

test('an entry or group that is gone after the pull is refused with e.gone, and nothing changes', async (t) => {
    const prepare = async (a, b) => { // the other device deletes "one" and group H for good (twice: into the bin, then out of it)
        for (let i = 0; i < 2; i++) { b.removeEntry(entryByTitle(b, 'one')); b.removeGroup(groupByName(b, 'H')); }
        await b.save();
    };
    const ops = {
        removeEntry: (a, h) => a.removeEntry(h.one),
        moveEntry: (a, h) => a.moveEntry(h.one, h.G),
        moveEntryIntoGoneGroup: (a, h) => a.moveEntry(h.two, h.H),
        moveEntryToNoGroup: (a, h) => a.moveEntry(h.two, undefined), // a move dialog whose target selectedGroup() no longer finds: not "delete for good"
        editTagsWithOneGone: (a, h) => a.editTags([h.two, h.one], { add: ['x'] }),
        applyEntry: (a, h) => a.applyEntry(h.one, null, { Title: 'one', UserName: 'x' }),
        applyEntryNewInGoneGroup: (a, h) => a.applyEntry(null, h.H, { Title: 'x' }),
        duplicateEntry: (a, h) => a.duplicateEntry(h.one),
        createGroup: (a, h) => a.createGroup(h.H, 'Sub'),
        updateGroup: (a, h) => a.updateGroup(h.H, { name: 'x' }),
        removeGroup: (a, h) => a.removeGroup(h.H),
        moveGroup: (a, h) => a.moveGroup(h.G, h.H),
        clearHistory: (a, h) => a.clearHistory(h.one),
        removePasskey: (a, h) => a.removePasskey(h.one)
    };
    for (const [name, op] of Object.entries(ops)) {
        await t.test(name, async () => {
            const { a, held } = await stale({ prepare });
            const before = JSON.stringify([titles(a), groupNames(a), entryByTitle(a, 'two').tags, entryByTitle(a, 'two').parentGroup.name]);
            assert.throws(() => op(a, held), gone);
            assert.equal(a.dirty, false);
            assert.equal(JSON.stringify([titles(a), groupNames(a), entryByTitle(a, 'two').tags, entryByTitle(a, 'two').parentGroup.name]), before);
            assert.deepEqual(dupes(a), []);
        });
    }
});

test('an entry a merge took out of the tree counts as gone, although it still points at its old group', async () => {
    const dav = new MemoryDav();
    const a = await newDb(dav, { entries: ['one', 'two'] });
    const g = a.createGroup(a.root, 'G');
    await a.save();
    const held = entryByTitle(a, 'one');
    const b = await openDb(dav);
    for (let i = 0; i < 2; i++) b.removeEntry(entryByTitle(b, 'one')); // gone for good on b
    await b.save();
    a.applyEntry(null, a.root, { Title: 'here' });
    assert.equal((await a.save()).merged, true);
    assert.equal(entryByTitle(a, 'one'), undefined);
    assert.equal(held.parentGroup, a.root, 'kdbxweb leaves the parent pointer in place');
    assert.equal(a.find(held), null);
    assert.throws(() => a.moveEntry(held, g), gone);
    assert.equal(a.dirty, false);
});

test('find and deletesForever look at the current database', async () => {
    const { a, held } = await stale({ prepare: async (x, b) => { b.removeEntry(entryByTitle(b, 'one')); await b.save(); } });
    assert.ok(inBin(a, 'one'));
    assert.equal(a.find(held.one), entryByTitle(a, 'one'));
    assert.equal(a.deletesForever(held.one), true, 'it is in the recycle bin now: deleting it again is for good');
    assert.equal(a.deletesForever(held.two), false);
    assert.equal(a.find(held.two), entryByTitle(a, 'two'));
    assert.equal(a.find(entryByTitle(a, 'two')), entryByTitle(a, 'two'));
    assert.equal(a.find(held.G), groupByName(a, 'G'));
    assert.equal(a.find(held.root), a.root);
    assert.equal(a.find(null), null);
});

test('a history version of an entry from before the pull is found by its time, not by its index', async () => {
    const dav = new MemoryDav();
    const a = await newDb(dav, { entries: ['one'] });
    editOn(a, 'one', 'v1', 1); editOn(a, 'one', 'v2', 2);
    await a.save(); // history: '', 'v1' - current 'v2'
    const b = await openDb(dav);
    b.deleteHistory(entryByTitle(b, 'one'), 0); // history: 'v1'
    editOn(b, 'one', 'v3', 3); // history: 'v1', 'v2' - current 'v3'
    await b.save();
    const held = entryByTitle(a, 'one');
    assert.equal((await a.sync({ background: true })).pulled, true);
    a.restoreHistory(held, 1); // 'v1': index 1 in the held entry, index 0 in the current one
    assert.equal(entryByTitle(a, 'one').fields.get('UserName'), 'v1');
    assert.throws(() => a.restoreHistory(held, 0), gone); // the version '' was deleted on b
    assert.throws(() => a.deleteHistory(held, 0), gone);
    a.deleteHistory(held, 1);
    assert.deepEqual(entryByTitle(a, 'one').history.map((x) => x.fields.get('UserName')), ['v2', 'v3']);
});

test('an attachment made before the pull swapped the database is saved with the entry', async () => {
    const { dav, a } = await twoDevices();
    const bin = await a.makeBinary(new TextEncoder().encode('made before the pull').buffer);
    assert.equal((await a.sync({ background: true })).pulled, true);
    a.applyEntry(entryByTitle(a, 'one'), null, { Title: 'one', attachments: { remove: [], add: new Map([['a.txt', bin]]) } });
    await a.save();
    const s = await openDb(dav);
    assert.equal(new TextDecoder().decode(entryByTitle(s, 'one').binaries.get('a.txt')?.value ?? new ArrayBuffer(0)), 'made before the pull');
});
