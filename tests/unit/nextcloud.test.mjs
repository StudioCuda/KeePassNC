import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserPath, davUrlFor, readNextcloudContext } from '../../src/nextcloud.js';

const ctx = { davBase: 'https://c.example/remote.php/dav/files/anna/' };
test('Pfade werden normalisiert', () => {
    assert.equal(normalizeUserPath('Docs//a.kdbx'), '/Docs/a.kdbx');
    assert.equal(normalizeUserPath('\\Docs\\a.kdbx'), '/Docs/a.kdbx');
    assert.equal(normalizeUserPath('  '), '');
});
test('DAV-URL kodiert jedes Segment einzeln (Leerzeichen, Umlaute, # ?)', () => {
    assert.equal(davUrlFor(ctx, '/Passwörter privat/a#b?.kdbx'), 'https://c.example/remote.php/dav/files/anna/Passw%C3%B6rter%20privat/a%23b%3F.kdbx');
});
test('Pfad-Traversal wird abgelehnt', () => {
    assert.throws(() => davUrlFor(ctx, '/a/../../b.kdbx'));
    assert.throws(() => davUrlFor(ctx, './b.kdbx'));
});
test('Kontext nur im Nextcloud-Modus', () => {
    assert.equal(readNextcloudContext({ dataset: {} }), null);
    assert.equal(readNextcloudContext(null), null);
    assert.equal(readNextcloudContext({ dataset: { mode: 'nextcloud', davBase: 'x', csrfUrl: 'y' } }).davBase, 'x');
});
