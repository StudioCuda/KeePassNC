// Editing a text attachment in place: the old file goes to the history, BOM and line endings come back as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, binaryBytes } from './vault-harness.mjs';
import { editableText, encodeText } from '../../src/core/util.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test('editableText: plain, BOM and CRLF are remembered; mixed endings, binary and big files are not offered', () => {
    assert.deepEqual(editableText('a.txt', enc('one\ntwo')), { text: 'one\ntwo', bom: false, eol: '\n' });
    assert.deepEqual(editableText('a.txt', enc('one\r\ntwo\r\n')), { text: 'one\ntwo\n', bom: false, eol: '\r\n' });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('hi')]);
    assert.deepEqual(editableText('a.txt', withBom), { text: 'hi', bom: true, eol: '\n' });
    assert.equal(editableText('a.txt', enc('one\r\ntwo\nthree')), null, 'mixed line endings');
    assert.equal(editableText('a.txt', enc('one\rtwo')), null, 'lone CR');
    assert.equal(editableText('a.zip', enc('x')), null);
    assert.equal(editableText('a.txt', new Uint8Array([0xff, 0xfe, 0x41])), null, 'not UTF-8');
    assert.equal(editableText('a.txt', new Uint8Array(1024 * 1024 + 1).fill(65)), null, 'over 1 MiB');
});

test('encodeText gives back exactly what editableText took apart', () => {
    for (const raw of ['one\ntwo', 'one\r\ntwo\r\n', 'Grüße €\n', '']) {
        for (const bom of [false, true]) {
            const bytes = bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...enc(raw)]) : enc(raw);
            const e = editableText('a.txt', bytes);
            if (!e) { assert.equal(raw, ''); continue; }
            assert.deepEqual(encodeText(e.text, e), bytes, JSON.stringify(raw));
        }
    }
    assert.equal(dec(encodeText('a\nb', { eol: '\r\n' })), 'a\r\nb');
    assert.equal(dec(encodeText('a\r\nb')), 'a\nb', 'a textarea hands over LF; stray CRLF is tidied for an LF file');
});

test('replaceAttachment: one history version with the old file, survives a save and reload; same bytes change nothing', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav);
    const added = new Map([['notes.txt', await vault.makeBinary(enc('first').buffer)]]);
    const e0 = vault.applyEntry(null, vault.root, { Title: 'Server', attachments: { add: added } });
    await new Promise((r) => setTimeout(r, 1100)); // KDBX times have a resolution of one second
    assert.equal(await vault.replaceAttachment(e0, 'notes.txt', enc('second')), true);
    const e = entryByTitle(vault, 'Server');
    assert.equal(e.history.length, 1);
    assert.equal(dec(binaryBytes(e.binaries.get('notes.txt'))), 'second');
    assert.equal(dec(binaryBytes(e.history[0].binaries.get('notes.txt'))), 'first');
    assert.equal(await vault.replaceAttachment(e, 'notes.txt', enc('second')), false, 'same bytes: no new version');
    assert.equal(await vault.replaceAttachment(e, 'gone.txt', enc('x')), false, 'unknown name');
    assert.equal(e.history.length, 1);

    await vault.save();
    const again = entryByTitle(await openDb(dav), 'Server');
    assert.equal(dec(binaryBytes(again.binaries.get('notes.txt'))), 'second');
    assert.equal(dec(binaryBytes(again.history[0].binaries.get('notes.txt'))), 'first');
});

test('replaceAttachment is refused on a read-only database', async () => {
    const vault = await newDb(new MemoryDav());
    const e = vault.applyEntry(null, vault.root, { Title: 'X', attachments: { add: new Map([['a.txt', await vault.makeBinary(enc('a').buffer)]]) } });
    vault.readOnly = true;
    await assert.rejects(() => vault.replaceAttachment(e, 'a.txt', enc('b')));
    assert.equal(dec(binaryBytes(e.binaries.get('a.txt'))), 'a');
});
