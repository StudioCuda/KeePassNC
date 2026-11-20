// Files that hold an entry or group UUID twice (left behind by the old merge, see core/duplicates.js): the vault finds them, and
// repairs them only when asked, keeping the copy moved last in its place, the copy changed last as the content and the other state in
// the history. Afterwards saving and merging work again, also with a server version that still holds the duplicates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, groupByName, field, title } from './vault-harness.mjs';

const START = Date.UTC(2026, 0, 1, 12);
const MIN = 60000;

function clock(t) {
    t.mock.timers.enable({ apis: ['Date'], now: START });
    return (ms = MIN) => t.mock.timers.tick(ms);
}

/** A second object with the same UUID as item, listed in group (what the old merge left behind once the file was saved and opened). */
function twin(item, group, kind = 'entries') {
    const c = new item.constructor();
    c.copyFrom(item);
    if (kind === 'entries') c.history = item.history.map((h) => { const x = new h.constructor(); x.copyFrom(h); return x; });
    c.parentGroup = group;
    group[kind].push(c);
    return c;
}

const copies = (vault, id) => [...vault.root.allGroupsAndEntries()].filter((x) => x.uuid.id === id);
const placeOf = (vault, id) => copies(vault, id).map((x) => x.parentGroup.name);
function once(vault) {
    const ids = [...vault.root.allGroupsAndEntries()].map((x) => x.uuid.id);
    assert.equal(ids.length, new Set(ids).size, 'an entry or group is there twice');
}

/** Saves the state with the duplicates and opens it fresh, as the next session would. */
async function reopen(dav, vault) {
    await vault.save();
    return openDb(dav);
}

/** Root with Web (Mail in it) and Bank; Mail edited once so it has a history item. */
async function setup(t) {
    const tick = clock(t);
    const dav = new MemoryDav();
    const v = await newDb(dav);
    const web = v.createGroup(v.root, 'Web');
    v.createGroup(v.root, 'Bank');
    tick();
    v.applyEntry(null, web, { Title: 'Mail', UserName: 'me', Password: 'one' });
    tick();
    const mail = entryByTitle(v, 'Mail');
    v.applyEntry(mail, web, { Title: 'Mail', UserName: 'me', Password: 'two', URL: '', Notes: '', tags: [] });
    await v.save();
    tick();
    return { dav, v, tick };
}

test('a healthy file has no duplicates', async (t) => {
    const { v } = await setup(t);
    assert.deepEqual(v.duplicates(), { entries: 0, groups: 0 });
});

test('the copy moved last keeps its place, the copy changed last its content, the other state goes into the history', async (t) => {
    const { dav, v, tick } = await setup(t);
    const mail = entryByTitle(v, 'Mail');
    const id = mail.uuid.id;
    const moved = twin(mail, groupByName(v, 'Bank'));
    moved.times.locationChanged = new Date(); // the move into Bank ...
    tick();
    mail.fields.set('Password', 'three'); // ... and an edit at the old place afterwards
    mail.times.lastModTime = new Date();
    const vault = await reopen(dav, v);
    assert.deepEqual(vault.duplicates(), { entries: 1, groups: 0 });
    assert.deepEqual(placeOf(vault, id).sort(), ['Bank', 'Web'], 'opening alone changes nothing');

    const done = vault.repairDuplicates();
    assert.equal(done.entries, 1);
    assert.equal(done.history, 1);
    assert.deepEqual(done.names, ['Mail']);
    once(vault);
    const e = entryByTitle(vault, 'Mail');
    assert.equal(e.parentGroup.name, 'Bank');
    assert.equal(field(e, 'Password'), 'three');
    assert.deepEqual(e.history.map((h) => field(h, 'Password')), ['one', 'two'], 'the older copy is in the history, nothing doubled');
    assert.equal(vault.dirty, true);

    await vault.save();
    const after = await openDb(dav);
    once(after);
    assert.deepEqual(after.duplicates(), { entries: 0, groups: 0 });
    assert.equal(field(entryByTitle(after, 'Mail'), 'Password'), 'three');
});

test('identical copies leave no history behind', async (t) => {
    const { dav, v } = await setup(t);
    const mail = entryByTitle(v, 'Mail');
    twin(mail, groupByName(v, 'Bank'));
    const vault = await reopen(dav, v);
    const done = vault.repairDuplicates();
    assert.equal(done.entries, 1);
    assert.equal(done.history, 0);
    assert.equal(entryByTitle(vault, 'Mail').history.length, 1);
    once(vault);
});

test('history items only one copy has are kept', async (t) => {
    const { dav, v, tick } = await setup(t);
    const mail = entryByTitle(v, 'Mail');
    const other = twin(mail, groupByName(v, 'Bank'));
    other.history = [];
    tick();
    other.pushHistory();
    other.fields.set('Password', 'elsewhere');
    other.times.lastModTime = new Date();
    const vault = await reopen(dav, v);
    vault.repairDuplicates();
    once(vault);
    const e = entryByTitle(vault, 'Mail');
    assert.equal(field(e, 'Password'), 'elsewhere');
    assert.deepEqual(e.history.map((h) => field(h, 'Password')), ['one', 'two']);
});

test('a group there twice: one group, every child in it, their duplicates folded too', async (t) => {
    const { dav, v, tick } = await setup(t);
    const web = groupByName(v, 'Web');
    const bank = groupByName(v, 'Bank');
    const copy = twin(web, bank, 'groups');
    for (const e of web.entries) twin(e, copy);
    copy.times.locationChanged = new Date();
    tick();
    v.applyEntry(null, copy, { Title: 'Only here' }); // created in the copy only
    copy.name = 'Web (new name)';
    copy.times.lastModTime = new Date();
    const vault = await reopen(dav, v);
    assert.deepEqual(vault.duplicates(), { entries: 1, groups: 1 });
    const done = vault.repairDuplicates();
    assert.equal(done.groups, 1);
    assert.equal(done.entries, 1);
    assert.deepEqual(done.renamed, [{ name: 'Web', notes: '' }]);
    once(vault);
    const g = groupByName(vault, 'Web (new name)');
    assert.equal(g.parentGroup.name, 'Bank', 'the copy moved last keeps its place');
    assert.deepEqual(g.entries.map(title).sort(), ['Mail', 'Only here']);
});

test('a group inside its own copy: the outer one stays', async (t) => {
    const { dav, v } = await setup(t);
    const web = groupByName(v, 'Web');
    const inner = twin(web, web, 'groups');
    inner.times.locationChanged = new Date(Date.now() + MIN);
    for (const e of web.entries) twin(e, inner);
    const vault = await reopen(dav, v);
    vault.repairDuplicates();
    once(vault);
    const g = groupByName(vault, 'Web');
    assert.equal(g.parentGroup, vault.root);
    assert.deepEqual(g.groups, []);
    assert.deepEqual(g.entries.map(title), ['Mail']);
});

test('a read-only session doesn\'t repair', async (t) => {
    const { dav, v } = await setup(t);
    twin(entryByTitle(v, 'Mail'), groupByName(v, 'Bank'));
    const vault = await reopen(dav, v);
    vault.readOnly = true;
    assert.throws(() => vault.repairDuplicates(), { key: 'e.dav.readonly' });
    assert.deepEqual(vault.duplicates(), { entries: 1, groups: 0 });
});

test('a server version with duplicates stops the merge until the user repairs, then saving merges it', async (t) => {
    const { dav, v, tick } = await setup(t);
    const here = await openDb(dav);
    // another device with the old merge writes the duplicates to the server
    twin(entryByTitle(v, 'Mail'), groupByName(v, 'Bank'));
    await v.save();
    tick();
    here.applyEntry(null, here.root, { Title: 'New here' });
    await assert.rejects(here.save(), { key: 'e.merge.dup' });
    assert.equal(here.mergeBlocked, 'dup');
    assert.deepEqual(here.duplicates(), { entries: 0, groups: 0 }, 'only the server version has them');

    const done = here.repairDuplicates();
    assert.equal(done.entries, 0);
    assert.equal(here.mergeBlocked, false);
    const r = await here.save();
    assert.equal(r.merged, true);
    const after = await openDb(dav);
    once(after);
    assert.deepEqual(after.duplicates(), { entries: 0, groups: 0 });
    assert.ok(entryByTitle(after, 'New here'));
    assert.ok(entryByTitle(after, 'Mail'));
});

