// Vault.applyEntry as the entry editor uses it: an Apply without real changes leaves the entry exactly as it was (field names with
// spaces, Windows line endings, an expiry flag without a date), and a field name never silently replaces another field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, field, VaultError, ProtectedValue } from './vault-harness.mjs';

const STANDARD = ['Title', 'UserName', 'Password', 'URL', 'Notes'];
const SYSTEM = /^(KPEX_PASSKEY_|KPXC_PASSKEY_|KPH: |TimeOtp-)|^(otp|TOTP Seed|TOTP Settings)$/;
const text = (v) => (v == null ? '' : typeof v === 'string' ? v : v.getText());

/** What the editor sends for an entry nobody touched: the visible fields as they are, custom fields by their exact names. */
function untouched(e) {
    const f = (k) => text(e.fields.get(k));
    return {
        Title: f('Title'), UserName: f('UserName'), Password: f('Password'), URL: f('URL'), Notes: f('Notes'), tags: [...e.tags],
        custom: [...e.fields].filter(([k]) => !STANDARD.includes(k) && !SYSTEM.test(k)).map(([name, v]) => ({ name, value: text(v), protect: v instanceof ProtectedValue })),
        expires: !!e.times.expires, expiryTime: e.times.expires ? e.times.expiryTime ?? null : null, excludeReports: false, color: ''
    };
}
/** The file as another program would see it after a save: written, then read back. */
async function roundTrip(dav, vault) {
    await vault.save();
    return openDb(dav);
}
const snapshot = (e) => JSON.stringify([...e.fields].map(([k, v]) => [k, text(v), v instanceof ProtectedValue]));

test('field names with spaces survive an Apply without changes, next to the field with the trimmed name', async () => {
    const dav = new MemoryDav();
    let vault = await newDb(dav);
    const e0 = vault.applyEntry(null, vault.root, { Title: 'Bank' });
    // KeePass allows any name: " PIN " and "PIN" are two fields, "Title " and "otp " are no standard or TOTP fields
    for (const [k, v] of [['PIN', '1234'], [' PIN ', 'old-pin'], ['Title ', 'not the title'], ['otp ', 'not a TOTP']]) e0.fields.set(k, v);
    vault = await roundTrip(dav, vault);
    const e = entryByTitle(vault, 'Bank');
    const before = snapshot(e);
    const same = vault.applyEntry(e, e.parentGroup, untouched(e));
    assert.equal(same, e);
    assert.equal(snapshot(e), before);
    assert.equal(e.history.length, 0, 'no history entry without a change');
    assert.equal(field(e, 'PIN'), '1234');
    assert.equal(field(e, ' PIN '), 'old-pin');
    assert.equal(field(e, 'Title '), 'not the title');
    assert.equal(field(e, 'otp '), 'not a TOTP');
    assert.equal(field(e, 'Title'), 'Bank');
    // a real change elsewhere keeps them just as well
    vault.applyEntry(e, e.parentGroup, { ...untouched(e), UserName: 'anna' });
    assert.equal(e.history.length, 1);
    assert.deepEqual([field(e, 'PIN'), field(e, ' PIN '), field(e, 'Title '), field(e, 'otp '), field(e, 'Title')], ['1234', 'old-pin', 'not the title', 'not a TOTP', 'Bank']);
});

test('a field name that is already taken is refused, and nothing changes', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav);
    const e = vault.applyEntry(null, vault.root, { Title: 'Bank', custom: [{ name: 'PIN', value: '1234' }, { name: 'TAN', value: '42' }] });
    await vault.save();
    const before = snapshot(e);
    // TAN renamed to PIN: two fields with one name, one of them would be gone
    const data = { ...untouched(e), Title: 'Bank (new)', custom: [{ name: 'PIN', value: '1234' }, { name: 'PIN', value: '42' }] };
    assert.throws(() => vault.applyEntry(e, e.parentGroup, data), (err) => err instanceof VaultError && err.key === 'e.field.dup' && err.vars?.name === 'PIN');
    assert.equal(snapshot(e), before);
    assert.equal(e.history.length, 0);
    assert.equal(vault.dirty, false);
    // names of the fields the editor shows on its own (or KeePass keeps for itself) aren't free either
    for (const name of ['Title', 'Notes', 'otp', 'TOTP Seed', 'KPH: settings', 'KPEX_PASSKEY_USERNAME']) {
        assert.throws(() => vault.applyEntry(e, e.parentGroup, { ...untouched(e), custom: [{ name, value: 'x' }] }), (err) => err instanceof VaultError && err.key === 'e.field.reserved' && err.vars?.name === name, name);
    }
    assert.equal(snapshot(e), before);
    // a new entry with such a name isn't created half-way
    const count = [...vault.root.allEntries()].length;
    assert.throws(() => vault.applyEntry(null, vault.root, { Title: 'Twice', custom: [{ name: 'A', value: '1' }, { name: 'A', value: '2' }] }), (err) => err.key === 'e.field.dup');
    assert.equal([...vault.root.allEntries()].length, count);
    assert.equal(vault.dirty, false);
});

test('renaming a field and swapping two names work, empty names are left out', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav);
    const e = vault.applyEntry(null, vault.root, { Title: 'Bank', custom: [{ name: ' PIN ', value: '1234' }, { name: 'A', value: 'a' }, { name: 'B', value: 'b' }] });
    assert.equal(field(e, ' PIN '), '1234', 'the vault stores names exactly as given');
    vault.applyEntry(e, e.parentGroup, { ...untouched(e), custom: [{ name: 'PIN', value: '1234' }, { name: 'B', value: 'a' }, { name: 'A', value: 'b' }, { name: '', value: 'no name' }] });
    assert.deepEqual([...e.fields.keys()].filter((k) => !STANDARD.includes(k)).sort(), ['A', 'B', 'PIN']);
    assert.deepEqual([field(e, 'PIN'), field(e, 'A'), field(e, 'B')], ['1234', 'b', 'a']);
});

test('Windows line endings: an Apply without changes keeps them and makes no history entry', async () => {
    const dav = new MemoryDav();
    let vault = await newDb(dav);
    vault.applyEntry(null, vault.root, { Title: 'Server' }).fields.set('Commands', ProtectedValue.fromString('ssh a\r\nssh b'));
    vault = await roundTrip(dav, vault);
    const e = entryByTitle(vault, 'Server');
    // A protected value keeps \r\n through the file. Plain ones only do where the XML has it as &#13; (KeePass 2, pykeepass) -
    // xmldom here turns a raw one into \n while reading, so they are set after opening, as the browser has them then.
    assert.equal(field(e, 'Commands'), 'ssh a\r\nssh b', 'the file keeps \\r\\n (precondition)');
    e.fields.set('Notes', 'line 1\r\nline 2\r\n\r\nline 4');
    e.fields.set('Old Mac', 'a\rb');
    const before = snapshot(e);
    // a <textarea> only ever hands back \n
    const lf = (s) => s.replace(/\r\n?/g, '\n');
    const form = untouched(e);
    const data = { ...form, Notes: lf(form.Notes), custom: form.custom.map((c) => ({ ...c, value: lf(c.value) })) };
    assert.equal(vault.entryDiffers(e, data), false);
    vault.applyEntry(e, e.parentGroup, data);
    assert.equal(e.history.length, 0, 'no history entry for line endings alone');
    assert.equal(snapshot(e), before);
    assert.equal(vault.dirty, false);
    // another change: the notes stay as they were, byte for byte
    vault.applyEntry(e, e.parentGroup, { ...data, URL: 'https://example.org' });
    assert.equal(e.history.length, 1);
    assert.equal(field(e, 'Notes'), 'line 1\r\nline 2\r\n\r\nline 4');
    assert.equal(field(e, 'Commands'), 'ssh a\r\nssh b');
    assert.equal(field(e, 'Old Mac'), 'a\rb');
    // the notes themselves changed: stored as typed
    vault.applyEntry(e, e.parentGroup, { ...data, URL: 'https://example.org', Notes: 'line 1\nline 2 changed' });
    assert.equal(field(e, 'Notes'), 'line 1\nline 2 changed');
    assert.equal(e.history.length, 2);
});

test('expires without an expiry time: an Apply without changes leaves it alone, another change writes a date a year ahead', async () => {
    const dav = new MemoryDav();
    let vault = await newDb(dav);
    const e0 = vault.applyEntry(null, vault.root, { Title: 'Expiring' });
    e0.times.expires = true; e0.times.expiryTime = undefined; // KeePass files can contain that
    vault = await roundTrip(dav, vault);
    let e = entryByTitle(vault, 'Expiring');
    assert.equal(e.times.expires, true);
    assert.equal(e.times.expiryTime, undefined, 'the file keeps the missing time (precondition)');
    // what the editor sends with the box still ticked and no date picked
    vault.applyEntry(e, e.parentGroup, { ...untouched(e), expires: true, expiryTime: null });
    assert.equal(e.history.length, 0);
    assert.equal(e.times.expiryTime, undefined);
    assert.equal(vault.dirty, false);
    vault.applyEntry(e, e.parentGroup, { ...untouched(e), expires: true, expiryTime: null, UserName: 'anna' });
    const days = (e.times.expiryTime.getTime() - Date.now()) / 86400000;
    assert.ok(days > 364 && days < 366, `expiry ${e.times.expiryTime}`);
    // unticked: no longer expires
    vault = await roundTrip(dav, vault);
    e = entryByTitle(vault, 'Expiring');
    e.times.expiryTime = undefined;
    vault.applyEntry(e, e.parentGroup, { ...untouched(e), expires: false, expiryTime: null });
    assert.equal(e.times.expires, false);
});
