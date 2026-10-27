import test from 'node:test';
import assert from 'node:assert/strict';
import { DavError, NetworkError, offlineFailKey, isOffline, cleanEtag } from '../../src/webdav.js';

test('Server-Ausfall ohne Offline-Kopie: ein 5xx nennt seinen Status (Issue #50)', () => {
    const e503 = new DavError(503, 'x', 'e.dav.status', { status: 503 });
    assert.ok(isOffline(e503)); // the offline copy may step in
    assert.equal(offlineFailKey(e503, false), 'err.offline.status.nooption');
    assert.equal(offlineFailKey(e503, true), 'err.offline.status.nocopy');
});
test('Server-Ausfall ohne Offline-Kopie: echtes "nicht erreichbar" bleibt dabei', () => {
    const net = new NetworkError(new TypeError('Failed to fetch'));
    assert.equal(offlineFailKey(net, false), 'err.offline.nooption');
    assert.equal(offlineFailKey(net, true), 'err.offline.nocopy');
});
test('ETag: Kompressions-Zusaetze des Vorsatzes werden entfernt, ein normaler bleibt', () => {
    assert.equal(cleanEtag('"abc123"'), '"abc123"');
    assert.equal(cleanEtag('"abc123-gzip"'), '"abc123"');
    assert.equal(cleanEtag('"abc123-br"'), '"abc123"');
    assert.equal(cleanEtag('W/"abc123"'), '"abc123"');
    assert.equal(cleanEtag('abc-gzip'), 'abc');
    assert.equal(cleanEtag('"gzip-abc"'), '"gzip-abc"');
    assert.equal(cleanEtag(''), null);
    assert.equal(cleanEtag(null), null);
});
