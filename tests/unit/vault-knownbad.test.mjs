import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle } from './vault-harness.mjs';
import { excluded } from '../../src/core/audit.js';

// "Exclude from reports": KeePassXC only honours the CustomData item KnownBad = "true" (compared exactly), KeePass 2 QualityCheck = False.
const knownBad = (e) => e.customData?.get('KnownBad')?.value;
const edit = (v, e, data) => v.applyEntry(e, e.parentGroup, { Title: 'a', UserName: '', Password: 'x', URL: '', Notes: '', ...data });

test('excluding an entry writes KnownBad = "true" (lowercase) and QualityCheck = False, and survives a save', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['a'] });
    edit(v, entryByTitle(v, 'a'), { excludeReports: true });
    assert.equal(entryByTitle(v, 'a').qualityCheck, false); // only stored in KDBX 4.1 files; in 4.0 KnownBad carries it alone
    await v.save();
    const e = entryByTitle(await openDb(dav), 'a');
    assert.equal(knownBad(e), 'true');
    assert.ok(excluded(e));
});

test('KeePassNC 1.2.0 wrote "True": still counts as excluded, and the next real edit switches it to "true"', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['a'] });
    const e = entryByTitle(v, 'a');
    edit(v, e, {});
    e.customData = new Map([['KnownBad', { value: 'True' }]]);
    assert.ok(excluded(e));
    edit(v, e, { excludeReports: true }); // nothing changed: the entry stays untouched
    assert.equal(knownBad(e), 'True');
    edit(v, e, { excludeReports: true, Notes: 'changed' });
    assert.equal(knownBad(e), 'true');
    assert.ok(excluded(e));
    edit(v, e, { excludeReports: false, Notes: 'changed' });
    assert.equal(knownBad(e), undefined);
    assert.ok(!excluded(e));
});

test('other KnownBad values and QualityCheck', () => {
    const entry = (value, qualityCheck) => ({ qualityCheck, customData: value === undefined ? undefined : new Map([['KnownBad', { value }]]) });
    assert.ok(excluded(entry('true')));
    assert.ok(excluded(entry('TRUE')));
    assert.ok(!excluded(entry('false')));
    assert.ok(!excluded(entry('')));
    assert.ok(!excluded(entry(undefined)));
    assert.ok(excluded(entry(undefined, false)));
    assert.ok(!excluded(entry(undefined, true)));
});
