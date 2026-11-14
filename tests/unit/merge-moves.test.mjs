// Merging two versions (conflict on save, "Merge database") after entries or groups were moved: every object ends up in exactly one
// group, the one it was moved to last (on either device), and keeps the time of that move. Devices a and b (and c) share one file on
// MemoryDav; the clock is mocked so every step gets its own minute (KDBX stores whole seconds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, groupByName, field, title, kdbxweb, ProtectedValue, PW } from './vault-harness.mjs';

const START = Date.UTC(2026, 0, 1, 12);
const MIN = 60000;

/** Mocked Date for this test; returns tick(ms = one minute). */
function clock(t) {
    t.mock.timers.enable({ apis: ['Date'], now: START });
    return (ms = MIN) => t.mock.timers.tick(ms);
}

/**
 * The ways two versions meet: saving into a conflict (the server copy is merged in, then uploaded), "Merge database" with the server
 * copy (the save after it merges the same copy once more, which must not change anything), and kdbxweb's merge on its own: the vault
 * takes an object out of a group it doesn't belong to after merging (see dropStaleListings), which would hide a library that puts
 * it in two groups.
 */
const WAYS = {
    'conflict on save': async (vault) => assert.equal((await vault.save()).merged, true),
    'Merge database': async (vault, dav) => { await vault.mergeFrom(dav.bytes('/db.kdbx')); },
    'kdbxweb merge': async (vault, dav) => {
        vault.db.merge(await kdbxweb.Kdbx.load(dav.bytes('/db.kdbx'), new kdbxweb.Credentials(ProtectedValue.fromString(PW))));
        vault.dirty = true;
    }
};
function ways(name, fn, only = Object.keys(WAYS)) {
    for (const way of only) test(`${name} (${way})`, (t) => fn(t, WAYS[way]));
}

/** Changes fields of an entry like the editor does (applyEntry replaces the standard fields, so pass the others along). */
function edit(vault, t, changes) {
    const e = entryByTitle(vault, t);
    assert.ok(e, `entry ${t}`);
    return vault.applyEntry(e, e.parentGroup, { Title: title(e), UserName: field(e, 'UserName'), Password: field(e, 'Password'), URL: field(e, 'URL'),
        Notes: field(e, 'Notes'), tags: e.tags, ...changes });
}

/** Names of the groups that list the object with this id; more than one means the object sits in two places at once. */
const places = (vault, id) => [...vault.root.allGroups()].filter((g) => [...g.groups, ...g.entries].some((x) => x.uuid.id === id)).map((g) => g.name);
/** No id twice anywhere in the tree (a duplicated group repeats everything in it, too). */
function once(vault) {
    const ids = [...vault.root.allGroupsAndEntries()].map((x) => x.uuid.id);
    assert.equal(ids.length, new Set(ids).size, 'an entry or group sits in two places');
}
const id = (vault, name) => (entryByTitle(vault, name) ?? groupByName(vault, name)).uuid.id;
const moved = (item) => item.times.locationChanged.getTime();

/** root: Web (with Sub), Bank (with Ordner/Tief), Shop; Mail in Web, Konto in Bank, Brief in Ordner, Akte in Tief. b opens the result. */
async function setup() {
    const dav = new MemoryDav();
    const a = await newDb(dav);
    const web = a.createGroup(a.root, 'Web');
    a.createGroup(web, 'Sub');
    const bank = a.createGroup(a.root, 'Bank');
    const ordner = a.createGroup(bank, 'Ordner');
    const tief = a.createGroup(ordner, 'Tief');
    a.createGroup(a.root, 'Shop');
    for (const [t, g] of [['Mail', web], ['Konto', bank], ['Brief', ordner], ['Akte', tief]]) a.applyEntry(null, g, { Title: t });
    await a.save();
    return { dav, a, b: await openDb(dav) };
}

/** Moves an entry or group like the UI does; touched: changes its modification time too, as keepassxc-cli mv does. */
function move(vault, name, target, touched = false) {
    const item = entryByTitle(vault, name) ?? groupByName(vault, name);
    const to = target ? groupByName(vault, target) : vault.root;
    if (item.fields) vault.moveEntry(item, to); else assert.ok(vault.moveGroup(item, to));
    if (touched) item.times.update();
    return Date.now();
}

const TARGETS = { 'an earlier group': 'Web', 'a later group': 'Shop', 'a subgroup of an earlier group': 'Sub', 'the root group': null };

for (const [where, target] of Object.entries(TARGETS)) {
    for (const touched of [false, true]) {
        ways(`an entry the other device moved to ${where}${touched ? ', touching it like keepassxc-cli mv,' : ''} sits only there`, async (t, merge) => {
            const tick = clock(t);
            const { dav, a, b } = await setup();
            const konto = id(a, 'Konto');
            tick();
            const at = move(b, 'Konto', target, touched);
            await b.save();
            tick();
            edit(a, 'Mail', { Notes: 'from a' });
            await merge(a, dav);
            const check = (vault) => {
                const name = target ?? vault.root.name;
                assert.deepEqual(places(vault, konto), [name]);
                assert.equal(entryByTitle(vault, 'Konto').parentGroup.name, name);
                assert.equal(moved(entryByTitle(vault, 'Konto')), at);
                assert.equal(field(entryByTitle(vault, 'Mail'), 'Notes'), 'from a');
                once(vault);
            };
            check(a);
            await a.save();
            check(await openDb(dav));
        });

        ways(`a group the other device moved to ${where}${touched ? ', touching it,' : ''} sits only there, with everything in it once`, async (t, merge) => {
            const tick = clock(t);
            const { dav, a, b } = await setup();
            const ids = Object.fromEntries(['Ordner', 'Tief', 'Brief', 'Akte'].map((n) => [n, id(a, n)]));
            tick();
            const at = move(b, 'Ordner', target, touched);
            await b.save();
            tick();
            edit(a, 'Akte', { UserName: 'from a' });
            await merge(a, dav);
            const check = (vault) => {
                const name = target ?? vault.root.name;
                assert.deepEqual(places(vault, ids.Ordner), [name]);
                assert.equal(groupByName(vault, 'Ordner').parentGroup.name, name);
                assert.equal(moved(groupByName(vault, 'Ordner')), at);
                assert.deepEqual([places(vault, ids.Tief), places(vault, ids.Brief), places(vault, ids.Akte)], [['Ordner'], ['Ordner'], ['Tief']]);
                assert.equal(field(entryByTitle(vault, 'Akte'), 'UserName'), 'from a');
                once(vault);
            };
            check(a);
            await a.save();
            check(await openDb(dav));
        });
    }
}

ways('a move on one device and a later edit on the other: the entry sits where it was moved, with the edit, whichever device merges', async (t, merge) => {
    const tick = clock(t);
    for (const merger of ['editor', 'mover']) {
        const { dav, a, b } = await setup();
        const konto = id(a, 'Konto');
        tick();
        const at = move(b, 'Konto', 'Web', true);
        tick();
        edit(a, 'Konto', { UserName: 'edited later' });
        const [first, second] = merger === 'editor' ? [b, a] : [a, b];
        await first.save();
        await merge(second, dav);
        const check = (vault) => {
            assert.deepEqual(places(vault, konto), ['Web'], merger);
            assert.equal(field(entryByTitle(vault, 'Konto'), 'UserName'), 'edited later');
            assert.equal(moved(entryByTitle(vault, 'Konto')), at, `${merger}: the time of the move that won`);
            once(vault);
        };
        check(second);
        await second.save();
        check(await openDb(dav));
    }
});

ways('the merged entry keeps the time of the move that won, so a third device with an older move does not pull it back', async (t, merge) => {
    const tick = clock(t);
    const { dav, a, b } = await setup();
    const c = await openDb(dav);
    tick();
    move(c, 'Konto', 'Shop'); // the oldest move, merged last
    tick();
    const at = move(a, 'Konto', 'Web');
    tick();
    edit(b, 'Konto', { UserName: 'from b' }); // newer content, old place
    await b.save();
    await merge(a, dav); // Konto stays in Web with b's change: the merged entry must keep a's move time, not b's older one
    await a.save();
    await merge(c, dav);
    await c.save();
    for (const vault of [a, c, await openDb(dav)]) {
        assert.deepEqual(places(vault, id(vault, 'Konto')), ['Web']);
        assert.equal(field(entryByTitle(vault, 'Konto'), 'UserName'), 'from b');
        assert.equal(moved(entryByTitle(vault, 'Konto')), at);
        once(vault);
    }
});

ways('both devices moved the entry: the later move wins, whichever device merges', async (t, merge) => {
    const tick = clock(t);
    for (const merger of ['earlier mover', 'later mover']) {
        const { dav, a, b } = await setup();
        tick();
        move(a, 'Konto', 'Shop', true);
        tick();
        const at = move(b, 'Konto', 'Web', true);
        const [first, second] = merger === 'earlier mover' ? [b, a] : [a, b];
        await first.save();
        await merge(second, dav);
        await second.save();
        for (const vault of [second, await openDb(dav)]) {
            assert.deepEqual(places(vault, id(vault, 'Konto')), ['Web'], merger);
            assert.equal(moved(entryByTitle(vault, 'Konto')), at);
            once(vault);
        }
    }
});

ways('an entry in a group only one device has: a later move on the other takes it out, a later edit gets merged', async (t, merge) => {
    const tick = clock(t);
    for (const later of ['move', 'edit']) {
        for (const merger of ['creator', 'other']) {
            const { dav, a, b } = await setup();
            const konto = id(a, 'Konto');
            tick();
            const created = a.createGroup(a.root, 'Neu');
            const movedIn = move(a, 'Konto', 'Neu');
            tick();
            const movedOut = later === 'move' ? move(b, 'Konto', 'Shop') : (edit(b, 'Konto', { UserName: 'from b' }), null);
            const [first, second] = merger === 'creator' ? [b, a] : [a, b];
            await first.save();
            await merge(second, dav);
            await second.save();
            for (const vault of [second, await openDb(dav)]) {
                const label = `${later}, merged by the ${merger}`;
                assert.deepEqual(places(vault, konto), [later === 'move' ? 'Shop' : 'Neu'], label);
                assert.equal(moved(entryByTitle(vault, 'Konto')), movedOut ?? movedIn, label);
                if (later === 'edit') assert.equal(field(entryByTitle(vault, 'Konto'), 'UserName'), 'from b', label);
                assert.ok(places(vault, created.uuid.id).length === 1, label);
                once(vault);
            }
        }
    }
});

ways('groups moved into each other on both devices: nothing gets lost, the later move wins, whichever device merges', async (t, merge) => {
    const tick = clock(t);
    for (const later of ['a', 'b']) {
        for (const merger of ['a', 'b']) {
            const dav = new MemoryDav();
            const a = await newDb(dav);
            for (const n of ['X', 'R']) a.applyEntry(null, a.createGroup(a.root, n), { Title: `in ${n}` });
            await a.save();
            const b = await openDb(dav);
            // a puts R into X, b puts X into R; together they would be a loop that nothing reaches from the root
            const steps = [() => move(a, 'R', 'X'), () => move(b, 'X', 'R')];
            if (later === 'a') steps.reverse();
            tick(); steps[0]();
            tick(); steps[1]();
            const [first, second] = merger === 'a' ? [b, a] : [a, b];
            await first.save();
            await merge(second, dav);
            await second.save();
            const [outer, inner] = later === 'a' ? ['X', 'R'] : ['R', 'X'];
            for (const vault of [second, await openDb(dav)]) {
                const label = `later move on ${later}, merged on ${merger}`;
                assert.deepEqual(places(vault, id(vault, outer)), [vault.root.name], label);
                assert.deepEqual(places(vault, id(vault, inner)), [outer], label);
                assert.deepEqual([...vault.root.allEntries()].map((e) => `${title(e)}@${e.parentGroup.name}`).sort(), ['in R@R', 'in X@X'], label);
                once(vault);
            }
        }
    }
});

ways('three groups moved into a loop across two devices: the oldest of the moves gives way, both devices agree', async (t, merge) => {
    const tick = clock(t);
    for (const merger of ['a', 'b']) {
        const dav = new MemoryDav();
        const a = await newDb(dav);
        for (const n of ['X', 'Y', 'Z']) a.applyEntry(null, a.createGroup(a.root, n), { Title: `in ${n}` });
        await a.save();
        const b = await openDb(dav);
        tick(); move(a, 'Y', 'X'); // the oldest move
        tick(); move(b, 'Z', 'Y');
        tick(); move(b, 'X', 'Z'); // together: X in Z in Y in X
        const [first, second] = merger === 'a' ? [b, a] : [a, b];
        await first.save();
        await merge(second, dav);
        await second.save();
        for (const vault of [second, await openDb(dav)]) {
            assert.deepEqual(['Y', 'Z', 'X'].map((n) => places(vault, id(vault, n))), [[vault.root.name], ['Y'], ['Z']], `merged on ${merger}`);
            assert.deepEqual([...vault.root.allEntries()].map((e) => `${title(e)}@${e.parentGroup.name}`).sort(), ['in X@X', 'in Y@Y', 'in Z@Z']);
            once(vault);
        }
    }
});

ways('an entry moved into a group the other device deleted for good keeps the group, and only what changed since', async (t, merge) => {
    const tick = clock(t);
    for (const merger of ['deleter', 'mover']) {
        const { dav, a, b } = await setup();
        tick();
        a.removeGroup(groupByName(a, 'Ordner')); // into the bin, then out of it for good
        a.removeGroup(groupByName(a, 'Ordner'));
        assert.equal(groupByName(a, 'Ordner'), undefined);
        tick();
        const at = move(b, 'Konto', 'Ordner');
        const [first, second] = merger === 'deleter' ? [b, a] : [a, b];
        await first.save();
        await merge(second, dav);
        await second.save();
        for (const vault of [second, await openDb(dav)]) {
            assert.deepEqual(places(vault, id(vault, 'Konto')), ['Ordner'], merger);
            assert.equal(moved(entryByTitle(vault, 'Konto')), at);
            assert.deepEqual(groupByName(vault, 'Ordner').entries.map(title), ['Konto'], merger); // Brief and Tief (with Akte) stay deleted
            assert.equal(groupByName(vault, 'Tief'), undefined);
            assert.deepEqual([...vault.root.allEntries()].filter((e) => !vault.isInRecycleBin(e)).map(title).sort(), ['Konto', 'Mail']);
            once(vault);
        }
    }
});

test('the vault takes an object out of a group it was left in by mistake, before anything is saved', async (t) => {
    const tick = clock(t);
    for (const way of ['conflict on save', 'Merge database']) {
        const { dav, a, b } = await setup();
        tick();
        edit(b, 'Mail', { Notes: 'from b' });
        await b.save();
        tick();
        edit(a, 'Konto', { Notes: 'from a' });
        // a merge like the old one: Konto and Ordner stay in Bank and also turn up in Shop
        const merge = a.db.merge.bind(a.db);
        a.db.merge = (remote) => {
            merge(remote);
            groupByName(a, 'Shop').entries.push(entryByTitle(a, 'Konto'));
            groupByName(a, 'Shop').groups.push(groupByName(a, 'Ordner'));
        };
        await WAYS[way](a, dav);
        delete a.db.merge;
        const check = (vault) => {
            assert.deepEqual(places(vault, id(vault, 'Konto')), ['Bank'], way);
            assert.deepEqual(places(vault, id(vault, 'Ordner')), ['Bank'], way);
            assert.equal(field(entryByTitle(vault, 'Mail'), 'Notes'), 'from b', way);
            assert.equal(field(entryByTitle(vault, 'Konto'), 'Notes'), 'from a', way);
            once(vault);
        };
        check(a);
        await a.save();
        check(await openDb(dav));
    }
});

test('a server file that holds an entry twice stops the merge with e.merge.dup, and nothing is uploaded', async () => {
    const dav = new MemoryDav();
    const a = await newDb(dav, { entries: ['X', 'Y'] });
    const b = await openDb(dav);
    entryByTitle(b, 'Y').uuid = entryByTitle(b, 'X').uuid; // as an older merge left it behind
    edit(b, 'Y', { Notes: 'b' });
    await b.save();
    const server = dav.bytes('/db.kdbx');
    edit(a, 'X', { Notes: 'a' });
    await assert.rejects(a.save(), { key: 'e.merge.dup' });
    assert.equal(a.mergeBlocked, true);
    assert.deepEqual(new Uint8Array(dav.bytes('/db.kdbx')), new Uint8Array(server));
});
