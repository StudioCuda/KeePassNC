// Recycle bin edge cases that used to lose data: a group that holds the bin (KeePass 2 lets any group be the bin), files without
// <RecycleBinEnabled> or without a bin group yet, and kdbxweb moving a group into itself. Checked after saving and reopening, and with keepassxc-cli.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryDav, newDb, openDb, titles, entryByTitle, groupByName, PW, kdbxweb } from './vault-harness.mjs';

/** Group path below the root ("Recycle Bin/Work"), "" directly in the root. */
const pathOf = (item) => { const p = []; for (let g = item.parentGroup; g?.parentGroup; g = g.parentGroup) p.unshift(g.name); return p.join('/'); };

/** Runs keepassxc-cli on the server version of /db.kdbx, e.g. xc(dav, 'ls', '-R', '-f'). */
function xc(dav, cmd, ...args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-bin-'));
    try {
        const file = path.join(dir, 'db.kdbx');
        fs.writeFileSync(file, Buffer.from(dav.bytes('/db.kdbx')));
        return execFileSync('keepassxc-cli', [cmd, '-q', ...args, file], { input: PW + '\n', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** Everything KeePassXC sees in the file, one sorted line per entry and group ("Recycle Bin/Work/Mail"). */
const xcTree = (dav) => xc(dav, 'ls', '-R', '-f').split('\n').filter(Boolean).sort();
/** The recycle bin setting as KeePassXC reads it ("True"/"False"). */
const xcBinSetting = (dav) => /<RecycleBinEnabled>([^<]*)<\/RecycleBinEnabled>/.exec(xc(dav, 'export', '-f', 'xml'))?.[1];

/**
 * A database as another program may have written it, on the server at /db.kdbx and opened from there: saved without the given <Meta>
 * elements (kdbxweb itself always writes them). prepare(db) runs on the database before saving.
 */
async function foreignDb(dav, { entries = [], strip = [], prepare = () => {} } = {}) {
    const base = await newDb(dav, { entries });
    prepare(base.db);
    const { write } = kdbxweb.KdbxMeta.prototype;
    kdbxweb.KdbxMeta.prototype.write = function (parent, ctx) {
        write.call(this, parent, ctx);
        const meta = parent.lastChild;
        for (const n of Array.from(meta.childNodes)) if (strip.includes(n.nodeName)) meta.removeChild(n); // xmldom's NodeList isn't iterable
    };
    try { dav.write('/db.kdbx', await base.db.save()); } finally { kdbxweb.KdbxMeta.prototype.write = write; }
    return openDb(dav);
}

/** Root entry "Old" already in the recycle bin, group Work (with Mail) or Work/Projects holding the bin, saved. */
async function binInsideGroup(dav, { nested = false } = {}) {
    const vault = await newDb(dav, { entries: ['Old', 'Keep'] });
    const work = vault.createGroup(vault.root, 'Work');
    vault.applyEntry(null, work, { Title: 'Mail' });
    const holder = nested ? vault.createGroup(work, 'Projects') : work;
    vault.removeEntry(entryByTitle(vault, 'Old'));
    // what KeePass 2 allows: pick a group inside "Work" as the recycle bin (here: move the bin there)
    assert.equal(vault.moveGroup(vault.recycleBin, holder), true);
    await vault.save();
    return openDb(dav);
}

test('Deleting a group that holds the recycle bin moves the bin up to the root first: the group goes into it, nothing is lost', async () => {
    const dav = new MemoryDav();
    const vault = await binInsideGroup(dav);
    const bin = vault.recycleBin;
    assert.equal(pathOf(bin), 'Work');
    const work = groupByName(vault, 'Work');
    assert.equal(vault.deletesForever(work), false);
    vault.removeGroup(work);
    assert.equal(vault.recycleBin, bin, 'still the same recycle bin');
    assert.equal(bin.parentGroup, vault.root, 'the bin now sits in the root');
    assert.equal(work.parentGroup, bin, 'the group is in the bin');
    assert.ok(vault.root.groups.includes(bin) && !vault.root.groups.includes(work));
    assert.deepEqual(titles(vault), ['Keep']);
    await vault.save();
    const again = await openDb(dav);
    assert.deepEqual(titles(again), ['Keep']);
    assert.equal(pathOf(entryByTitle(again, 'Mail')), 'Recycle Bin/Work');
    assert.equal(pathOf(entryByTitle(again, 'Old')), 'Recycle Bin');
    assert.equal(again.db.deletedObjects.length, 0, 'nothing deleted for good');
    assert.deepEqual(xcTree(dav), ['Keep', 'Recycle Bin/', 'Recycle Bin/Old', 'Recycle Bin/Work/', 'Recycle Bin/Work/Mail']);
});

test('Deleting a group with the recycle bin further down (Work/Projects/bin) keeps the bin and the subgroups', async () => {
    const dav = new MemoryDav();
    const vault = await binInsideGroup(dav, { nested: true });
    assert.equal(pathOf(vault.recycleBin), 'Work/Projects');
    vault.removeGroup(groupByName(vault, 'Work'));
    await vault.save();
    const again = await openDb(dav);
    assert.equal(pathOf(again.recycleBin), '');
    assert.equal(pathOf(groupByName(again, 'Projects')), 'Recycle Bin/Work');
    assert.deepEqual(titles(again), ['Keep']);
    assert.equal(again.db.deletedObjects.length, 0);
    assert.deepEqual(xcTree(dav), ['Keep', 'Recycle Bin/', 'Recycle Bin/Old', 'Recycle Bin/Work/', 'Recycle Bin/Work/Mail', 'Recycle Bin/Work/Projects/', 'Recycle Bin/Work/Projects/[empty]']);
});

test('With the recycle bin switched off, deleting a group that holds the old bin group deletes it all for good, with tombstones', async () => {
    const dav = new MemoryDav();
    const vault = await binInsideGroup(dav);
    vault.updateGeneralSettings({ recycleBin: false });
    const work = groupByName(vault, 'Work');
    assert.equal(vault.deletesForever(work), true);
    const ids = [...work.allGroupsAndEntries()].map((x) => x.uuid.id).sort();
    vault.removeGroup(work);
    await vault.save();
    const again = await openDb(dav);
    assert.deepEqual(titles(again), ['Keep']);
    assert.deepEqual(again.db.deletedObjects.map((d) => d.uuid.id).sort(), ids);
    assert.deepEqual(xcTree(dav), ['Keep']);
});

test('A file without <RecycleBinEnabled>: deleting moves into the bin as the page says, Undo works, and the file says True afterwards', async () => {
    const dav = new MemoryDav();
    const vault = await foreignDb(dav, { entries: ['Mail', 'Bank'], strip: ['RecycleBinEnabled'] });
    assert.equal(vault.db.meta.recycleBinEnabled, undefined);
    assert.equal(vault.binEnabled, true, 'KeePass 2 reads a missing setting as "on", so does the page');
    const mail = entryByTitle(vault, 'Mail');
    const from = mail.parentGroup;
    assert.equal(vault.deletesForever(mail), false);
    vault.removeEntry(mail);
    assert.equal(mail.parentGroup, vault.recycleBin, 'in the bin, not gone');
    vault.moveEntry(mail, from); // Undo
    assert.equal(mail.parentGroup, from);
    vault.removeEntry(mail);
    const g = vault.createGroup(vault.root, 'Old stuff');
    vault.removeGroup(g);
    assert.equal(g.parentGroup, vault.recycleBin);
    assert.equal(vault.db.deletedObjects.length, 0);
    await vault.save();
    const again = await openDb(dav);
    assert.equal(again.db.meta.recycleBinEnabled, true);
    assert.deepEqual(titles(again), ['Bank']);
    assert.equal(pathOf(entryByTitle(again, 'Mail')), 'Recycle Bin');
    assert.equal(again.db.deletedObjects.length, 0);
    assert.deepEqual(xcTree(dav), ['Bank', 'Recycle Bin/', 'Recycle Bin/Mail', 'Recycle Bin/Old stuff/', 'Recycle Bin/Old stuff/[empty]']);
    assert.equal(xcBinSetting(dav), 'True');
});

test('A file without <RecycleBinEnabled> that is only edited is saved with an explicit True, so KeePassXC keeps the bin on too', async () => {
    const dav = new MemoryDav();
    const vault = await foreignDb(dav, { entries: ['Mail'], strip: ['RecycleBinEnabled'] });
    assert.equal(xcBinSetting(dav), 'True', 'KeePassXC reads the missing setting as "on" as well');
    vault.createGroup(vault.root, 'New');
    await vault.save();
    // an empty <RecycleBinEnabled/> (what kdbxweb wrote for the missing setting) is "off" for KeePassXC
    assert.equal(xcBinSetting(dav), 'True');
    assert.equal((await openDb(dav)).binEnabled, true);
});

test('A file with the bin on but no bin group yet (no <RecycleBinUUID>): deleting creates the bin instead of deleting for good', async () => {
    const dav = new MemoryDav();
    const dropBin = (db) => { const rb = db.getGroup(db.meta.recycleBinUuid); rb.parentGroup.groups.splice(rb.parentGroup.groups.indexOf(rb), 1); };
    const vault = await foreignDb(dav, { entries: ['Mail', 'Bank'], strip: ['RecycleBinUUID'], prepare: dropBin });
    assert.equal(vault.db.meta.recycleBinUuid, undefined);
    assert.equal(vault.recycleBin, undefined);
    const mail = entryByTitle(vault, 'Mail');
    assert.equal(vault.deletesForever(mail), false);
    vault.removeEntry(mail);
    assert.ok(vault.recycleBin, 'a bin was created');
    assert.equal(mail.parentGroup, vault.recycleBin);
    await vault.save();
    const again = await openDb(dav);
    assert.deepEqual(titles(again), ['Bank']);
    assert.equal(pathOf(entryByTitle(again, 'Mail')), 'Recycle Bin');
    assert.equal(again.db.deletedObjects.length, 0);
});

test('kdbxweb never moves a group into itself or below itself (that cut it off from the tree, and it vanished on saving)', async () => {
    const vault = await newDb(new MemoryDav());
    const a = vault.createGroup(vault.root, 'A'), b = vault.createGroup(a, 'B');
    assert.throws(() => vault.db.move(a, a), /itself/);
    assert.throws(() => vault.db.move(a, b), /itself/);
    assert.equal(a.parentGroup, vault.root);
    assert.ok(vault.root.groups.includes(a) && a.groups.includes(b));
    // kdbxweb's own remove() with the bin inside the group: refused as well instead of losing the group
    vault.moveGroup(vault.recycleBin, b);
    assert.throws(() => vault.db.remove(a), /itself/);
    assert.ok(vault.root.groups.includes(a));
    assert.equal(vault.moveGroup(a, b), false, 'the page asks first and says no');
});
