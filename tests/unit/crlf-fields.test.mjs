// Field values with CR LF (files from pykeepass or Windows scripts store notes that way, as &#13; in the XML) keep it through a save.
// The serializer used to write the CR raw, and XML line-end normalization turned every CR LF in the file into LF on the next open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, field } from './vault-harness.mjs';

test('CR LF in a note and a custom field survives saving and opening again, twice; LF stays LF', async () => {
    const dav = new MemoryDav();
    const v = await newDb(dav, { entries: ['a', 'b'] });
    const a = entryByTitle(v, 'a');
    a.fields.set('Notes', 'one\r\ntwo\r\n');
    a.fields.set('Extra', 'x\r\ny');
    entryByTitle(v, 'b').fields.set('Notes', 'three\nfour');
    await v.save();
    for (let round = 1; round <= 2; round++) {
        const w = await openDb(dav);
        assert.equal(field(entryByTitle(w, 'a'), 'Notes'), 'one\r\ntwo\r\n', `round ${round}: note`);
        assert.equal(field(entryByTitle(w, 'a'), 'Extra'), 'x\r\ny', `round ${round}: custom field`);
        assert.equal(field(entryByTitle(w, 'b'), 'Notes'), 'three\nfour', `round ${round}: LF only`);
        // another entry changes and the file is saved again: these stay byte for byte as well
        w.applyEntry(entryByTitle(w, 'b'), entryByTitle(w, 'b').parentGroup, { Title: 'b', UserName: '', Password: `p${round}`, URL: '', Notes: 'three\nfour' });
        await w.save();
    }
});
