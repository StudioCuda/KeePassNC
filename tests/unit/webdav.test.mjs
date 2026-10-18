import test from 'node:test';
import assert from 'node:assert/strict';
import { DavError, NetworkError, offlineFailKey, isOffline } from '../../src/webdav.js';

test('Server-Ausfall ohne Offline-Kopie: ein 5xx nennt seinen Status (Issue #50)', () => {
    const e503 = new DavError(503, 'x', 'e.dav.status', { status: 503 });
    assert.ok(isOffline(e503)); // die Offline-Kopie darf weiter einspringen
    assert.equal(offlineFailKey(e503, false), 'err.offline.status.nooption');
    assert.equal(offlineFailKey(e503, true), 'err.offline.status.nocopy');
});
test('Server-Ausfall ohne Offline-Kopie: echtes "nicht erreichbar" bleibt dabei', () => {
    const net = new NetworkError(new TypeError('Failed to fetch'));
    assert.equal(offlineFailKey(net, false), 'err.offline.nooption');
    assert.equal(offlineFailKey(net, true), 'err.offline.nocopy');
});
