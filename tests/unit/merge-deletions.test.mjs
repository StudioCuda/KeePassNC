// Merging two versions (conflict on save, "Merge database"): a permanent deletion only wins over changes made before it, and merging
// never throws away custom icons nobody deleted. Devices a and b (and c) share one file on MemoryDav; the clock is mocked so every
// step gets its own minute (KDBX stores whole seconds, the merge compares whole seconds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, groupByName, field, title } from './vault-harness.mjs';

const START = Date.UTC(2026, 0, 1, 12);
const MIN = 60000;
const PNG = (n) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]);

/** Mocked Date for this test; returns tick(ms = one minute). */
function clock(t) {
    t.mock.timers.enable({ apis: ['Date'], now: START });
    return (ms = MIN) => t.mock.timers.tick(ms);
}

/**
 * Both ways two versions meet: saving into a conflict (the server copy is merged in, then uploaded), and "Merge database" with
 * the server copy (in memory only; the save after it merges the same copy once more, which must not change anything).
 */
const WAYS = {
    'conflict on save': async (vault) => assert.equal((await vault.save()).merged, true),
    'Merge database': async (vault, dav) => { await vault.mergeFrom(dav.bytes('/db.kdbx')); }
};
function both(name, fn) {
    for (const [way, merge] of Object.entries(WAYS)) test(`${name} (${way})`, (t) => fn(t, merge));
}

/** Changes fields of an entry like the editor does (applyEntry replaces the standard fields, so pass the others along). */
function edit(vault, t, changes) {
    const e = entryByTitle(vault, t);
    assert.ok(e, `entry ${t}`);
    return vault.applyEntry(e, e.parentGroup, { Title: title(e), UserName: field(e, 'UserName'), Password: field(e, 'Password'), URL: field(e, 'URL'),
        Notes: field(e, 'Notes'), tags: e.tags, ...changes });
}

/** Deletes for good the way a user does it: into the recycle bin, then out of it again. */
function deleteForGood(vault, item) {
    const remove = (x) => (x.entries ? vault.removeGroup(x) : vault.removeEntry(x));
    if (!vault.deletesForever(item)) remove(item);
    assert.ok(vault.deletesForever(item));
    remove(item);
}

const tombstones = (vault) => new Map(vault.db.deletedObjects.map((d) => [d.uuid.id, d.deletionTime.getTime()]));
/** Titles of all entries, recycle bin included. */
const all = (vault) => [...vault.root.allEntries()].map(title).sort();

async function twoDevices(entries = ['X', 'Y']) {
    const dav = new MemoryDav();
    const a = await newDb(dav, { entries });
    const b = await openDb(dav);
    return { dav, a, b };
}

both('an entry deleted for good on one device but changed later on the other stays, with the change', async (t, merge) => {
    const tick = clock(t);
    const { dav, a, b } = await twoDevices(['X', 'Y', 'Z']);
    const ids = [entryByTitle(a, 'X').uuid.id, entryByTitle(a, 'Z').uuid.id];
    tick();
    deleteForGood(a, entryByTitle(a, 'X')); // emptied out of the recycle bin
    a.updateGeneralSettings({ recycleBin: false });
    a.removeEntry(entryByTitle(a, 'Z')); // no bin: gone right away
    await a.save();
    tick();
    edit(b, 'X', { Password: 'newer' });
    edit(b, 'Z', { UserName: 'newer' });
    await merge(b, dav);
    const check = (vault) => {
        assert.deepEqual(all(vault), ['X', 'Y', 'Z']);
        assert.equal(field(entryByTitle(vault, 'X'), 'Password'), 'newer');
        assert.equal(field(entryByTitle(vault, 'Z'), 'UserName'), 'newer');
        assert.deepEqual(ids.map((id) => tombstones(vault).has(id)), [false, false]);
    };
    check(b);
    // on disk: the entries are there and their stale tombstones are gone, so the next merge doesn't delete them after all
    await b.save();
    check(await openDb(dav));
    // device a still holds its own tombstones in memory: merging from its side keeps the entries as well
    tick();
    edit(a, 'Y', { Notes: 'from a' });
    await merge(a, dav);
    check(a);
    await a.save();
    const again = await openDb(dav);
    check(again);
    assert.equal(field(entryByTitle(again, 'Y'), 'Notes'), 'from a');
});

both('an entry changed before the other device deleted it stays deleted, whichever device saves first', async (t, merge) => {
    const tick = clock(t);
    // b changes first but merges last
    {
        const { dav, a, b } = await twoDevices();
        const id = entryByTitle(a, 'X').uuid.id;
        tick();
        edit(b, 'X', { Password: 'older' });
        tick();
        a.updateGeneralSettings({ recycleBin: false }); // deleting is permanent right away
        a.removeEntry(entryByTitle(a, 'X'));
        await a.save();
        await merge(b, dav);
        assert.deepEqual(all(b), ['Y']);
        await b.save();
        const disk = await openDb(dav);
        assert.deepEqual(all(disk), ['Y']);
        assert.equal(tombstones(disk).get(id), START + 2 * MIN);
    }
    // b changes and saves first, a deletes the version it knows later and merges
    {
        const { dav, a, b } = await twoDevices();
        tick();
        edit(b, 'X', { Password: 'older' });
        await b.save();
        tick();
        deleteForGood(a, entryByTitle(a, 'X'));
        await merge(a, dav);
        assert.deepEqual(all(a), ['Y']);
        await a.save();
        assert.deepEqual(all(await openDb(dav)), ['Y']);
    }
});

both('a change in the same second as the deletion does not bring the entry back', async (t, merge) => {
    const tick = clock(t);
    const { dav, a, b } = await twoDevices();
    tick();
    deleteForGood(a, entryByTitle(a, 'X'));
    await a.save();
    tick(700); // still the same second
    edit(b, 'X', { Password: 'same second' });
    await merge(b, dav);
    assert.deepEqual(all(b), ['Y']);
});

both('a group deleted for good keeps the entries changed later elsewhere, and only those', async (t, merge) => {
    const tick = clock(t);
    const dav = new MemoryDav();
    const a = await newDb(dav);
    const g = a.createGroup(a.root, 'G');
    const sub = a.createGroup(g, 'Sub');
    for (const [name, group] of [['E1', g], ['E2', g], ['E3', sub], ['Top', a.root]]) a.applyEntry(null, group, { Title: name });
    await a.save();
    const b = await openDb(dav);
    const ids = Object.fromEntries([...a.root.allGroupsAndEntries()].map((x) => [x.name ?? title(x), x.uuid.id]));
    tick();
    deleteForGood(a, groupByName(a, 'G'));
    await a.save();
    assert.deepEqual(all(a), ['Top']);
    tick();
    edit(b, 'E1', { UserName: 'later' });
    await merge(b, dav);
    // like KeePass 2: the changed entry stays, and with it the group that still holds it; untouched entries and the emptied subgroup go
    const check = (vault) => {
        assert.deepEqual(all(vault), ['E1', 'Top']);
        const group = groupByName(vault, 'G');
        assert.ok(group && group.parentGroup === vault.root && !vault.isInRecycleBin(group));
        assert.deepEqual(group.entries.map(title), ['E1']);
        assert.equal(field(entryByTitle(vault, 'E1'), 'UserName'), 'later');
        assert.equal(groupByName(vault, 'Sub'), undefined);
        const tomb = tombstones(vault);
        assert.deepEqual([ids.G, ids.E1].map((id) => tomb.has(id)), [false, false]);
        assert.deepEqual([ids.E2, ids.Sub, ids.E3].map((id) => tomb.has(id)), [true, true, true]);
    };
    check(b);
    await b.save();
    check(await openDb(dav));
});

both('a group renamed after its deletion stays, but its untouched entries go', async (t, merge) => {
    const tick = clock(t);
    const dav = new MemoryDav();
    const a = await newDb(dav);
    a.applyEntry(null, a.createGroup(a.root, 'G'), { Title: 'E1' });
    await a.save();
    const b = await openDb(dav);
    tick();
    deleteForGood(a, groupByName(a, 'G'));
    await a.save();
    tick();
    b.updateGroup(groupByName(b, 'G'), { name: 'G renamed' });
    await merge(b, dav);
    await b.save();
    const disk = await openDb(dav);
    assert.equal(groupByName(disk, 'G renamed')?.entries.length, 0);
    assert.deepEqual(all(disk), []);
});

both('tombstones from both sides: one per object, the later deletion counts', async (t, merge) => {
    const tick = clock(t);
    const dav = new MemoryDav();
    const a = await newDb(dav, { entries: ['Z', 'A only', 'B only', 'W'] });
    const b = await openDb(dav);
    const c = await openDb(dav);
    const id = (t) => entryByTitle(a, t).uuid.id;
    const ids = { Z: id('Z'), A: id('A only'), B: id('B only') };
    tick();
    deleteForGood(b, entryByTitle(b, 'Z'));
    deleteForGood(b, entryByTitle(b, 'B only'));
    tick();
    edit(c, 'Z', { Notes: 'between the two deletions' }); // merged last
    tick();
    deleteForGood(a, entryByTitle(a, 'Z'));
    deleteForGood(a, entryByTitle(a, 'A only'));
    await a.save();
    await merge(b, dav); // b's own tombstone for Z is the older one
    await b.save();
    let disk = await openDb(dav);
    assert.deepEqual(all(disk), ['W']);
    assert.equal(disk.db.deletedObjects.filter((d) => d.uuid.id === ids.Z).length, 1);
    assert.equal(tombstones(disk).get(ids.Z), START + 3 * MIN);
    assert.ok(tombstones(disk).has(ids.A) && tombstones(disk).has(ids.B));
    // c's change came after b's deletion but before a's: the later deletion wins
    await merge(c, dav);
    assert.deepEqual(all(c), ['W']);
    await c.save();
    disk = await openDb(dav);
    assert.deepEqual(all(disk), ['W']);
    assert.equal(disk.db.deletedObjects.length, new Set(disk.db.deletedObjects.map((d) => d.uuid.id)).size);
});

both('moving to the recycle bin is no deletion: a later change on the other device lands in the bin', async (t, merge) => {
    const tick = clock(t);
    const { dav, a, b } = await twoDevices();
    tick();
    a.removeEntry(entryByTitle(a, 'X'));
    await a.save();
    tick();
    edit(b, 'X', { Password: 'in the bin' });
    await merge(b, dav);
    await b.save();
    const disk = await openDb(dav);
    const x = entryByTitle(disk, 'X');
    assert.ok(disk.isInRecycleBin(x));
    assert.equal(field(x, 'Password'), 'in the bin');
    assert.equal(disk.db.deletedObjects.length, 0);
});

both('emptying the bin deletes what nobody touched since, but an entry restored later on the other device stays', async (t, merge) => {
    const tick = clock(t);
    const { dav, a, b } = await twoDevices(['X', 'Y', 'Z']);
    a.removeEntry(entryByTitle(a, 'X'));
    a.removeEntry(entryByTitle(a, 'Z'));
    await a.save();
    await b.sync();
    assert.ok(b.isInRecycleBin(entryByTitle(b, 'X')));
    tick();
    assert.equal(a.emptyRecycleBin(), 2);
    await a.save();
    tick();
    b.moveEntry(entryByTitle(b, 'X'), b.root); // restore: only the location changes
    await merge(b, dav);
    await b.save();
    for (const vault of [b, await openDb(dav)]) {
        assert.deepEqual(all(vault), ['X', 'Y']);
        assert.equal(entryByTitle(vault, 'X').parentGroup, vault.root);
    }
});

test('"Merge database" counts the entry that came back, and merging the same copy again changes nothing', async (t) => {
    const tick = clock(t);
    const { dav, a, b } = await twoDevices(['X', 'Y']);
    tick();
    deleteForGood(b, entryByTitle(b, 'X'));
    deleteForGood(b, entryByTitle(b, 'Y'));
    tick();
    edit(a, 'X', { Password: 'after the deletion' });
    await a.save();
    const other = dav.bytes('/db.kdbx');
    assert.deepEqual(await b.mergeFrom(other), { added: 1, changed: 0, removed: 0 });
    assert.deepEqual(all(b), ['X']);
    assert.equal(field(entryByTitle(b, 'X'), 'Password'), 'after the deletion');
    assert.deepEqual(await b.mergeFrom(other), { added: 0, changed: 0, removed: 0 });
    await b.save();
    const disk = await openDb(dav);
    assert.deepEqual(all(disk), ['X']);
    assert.deepEqual([...tombstones(disk).keys()], [entryByTitle(a, 'Y').uuid.id]);
});

both('merging keeps custom icons nobody uses (yet), from both sides', async (t, merge) => {
    const tick = clock(t);
    const { dav, a, b } = await twoDevices();
    tick();
    const ia = a.addCustomIcon(PNG(1), 'from a');
    const x = entryByTitle(a, 'X');
    a.applyEntry(x, x.parentGroup, { Title: 'X', customIcon: ia });
    a.applyEntry(x, x.parentGroup, { Title: 'X', customIcon: null }); // now only the history uses it
    const unused = a.addCustomIcon(PNG(2), 'library');
    await a.save();
    tick();
    const ib = b.addCustomIcon(PNG(3), 'from b');
    edit(b, 'Y', { Notes: 'b' });
    await merge(b, dav);
    assert.deepEqual(b.customIcons().map((i) => i.id).sort(), [ia, unused, ib].sort());
    await b.save();
    for (const vault of [b, await openDb(dav)]) {
        assert.deepEqual(vault.customIcons().map((i) => i.id).sort(), [ia, unused, ib].sort());
        assert.equal(vault.db.deletedObjects.length, 0);
    }
});

both('a removed custom icon stays removed when the other device merges, everywhere it was used', async (t, merge) => {
    const tick = clock(t);
    const { dav, a } = await twoDevices();
    const icon = a.addCustomIcon(PNG(4), 'old');
    const x = entryByTitle(a, 'X');
    a.applyEntry(x, x.parentGroup, { Title: 'X', customIcon: icon });
    a.updateGroup(a.root, { customIcon: icon });
    await a.save();
    const b = await openDb(dav);
    tick();
    a.removeCustomIcon(icon);
    await a.save();
    tick();
    edit(b, 'Y', { Notes: 'b' });
    await merge(b, dav);
    await b.save();
    for (const vault of [b, await openDb(dav)]) {
        assert.deepEqual(vault.customIcons(), []);
        const refs = [...vault.root.allGroupsAndEntries()].flatMap((item) => [item, ...(item.history || [])]).filter((item) => item.customIcon);
        assert.deepEqual(refs, []);
        assert.ok(tombstones(vault).has(icon));
    }
});

both('a removed custom icon stays when the other device gave it to an entry afterwards', async (t, merge) => {
    const tick = clock(t);
    const { dav, a } = await twoDevices();
    const icon = a.addCustomIcon(PNG(5), 'picked later');
    await a.save();
    const b = await openDb(dav);
    tick();
    a.removeCustomIcon(icon);
    await a.save();
    tick();
    const y = entryByTitle(b, 'Y');
    b.applyEntry(y, y.parentGroup, { Title: 'Y', customIcon: icon });
    await merge(b, dav);
    await b.save();
    for (const vault of [b, await openDb(dav)]) {
        assert.deepEqual(vault.customIcons().map((i) => i.id), [icon]);
        assert.equal(entryByTitle(vault, 'Y').customIcon?.id, icon);
        assert.equal(tombstones(vault).has(icon), false);
    }
});

both('a removed custom icon stays when the other side changed the icon itself afterwards', async (t, merge) => {
    const tick = clock(t);
    const { dav, a } = await twoDevices();
    const icon = a.addCustomIcon(PNG(6), 'old name');
    await a.save();
    const b = await openDb(dav);
    tick();
    a.removeCustomIcon(icon);
    await a.save();
    tick();
    // KDBX 4.1 keeps a time per icon (KeePass 2 sets it when an icon is renamed); this app writes 4.0, so set it by hand
    b.db.meta.customIcons.set(icon, { ...b.db.meta.customIcons.get(icon), name: 'new name', lastModified: new Date() });
    await merge(b, dav);
    assert.deepEqual(b.customIcons().map((i) => i.name), ['new name']);
    assert.equal(tombstones(b).has(icon), false);
});
