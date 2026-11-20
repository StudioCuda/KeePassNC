import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DavError, DavFile, NetworkError, offlineFailKey, isOffline, cleanEtag, timeouts, writeProblem } from '../../src/webdav.js';
import { startServer } from '../e2e/davserver.mjs';

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

// ---- Requests against a real HTTP server that can be told to misbehave (tests/e2e/davserver.mjs, options.fault)
const BODY = crypto.randomBytes(10 * 1024);

/** A server with db.kdbx in its store, and short timeouts: a hung request costs a fraction of a second here, not a minute. */
async function davServer(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-dav-'));
    fs.writeFileSync(path.join(dir, 'db.kdbx'), BODY);
    const srv = await startServer({ webRoot: dir, davRoot: dir });
    const saved = { ...timeouts };
    timeouts.ms = 400;
    t.after(async () => { Object.assign(timeouts, saved); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
    const file = (name = 'db.kdbx') => new DavFile({ url: `http://127.0.0.1:${srv.port}/dav/${name}`, user: srv.user, pass: srv.pass });
    return { srv, dir, file };
}
const failure = (p) => p.then((v) => assert.fail(`no error, got ${String(v)}`), (e) => e);

test('A request that never answers ends as "not reachable" after the timeout, so the offline copy can step in', async (t) => {
    const { srv, file } = await davServer(t);
    srv.options.fault = () => 'hang';
    for (const [what, run] of [['PUT', () => file().put(new Uint8Array(16), null)], ['GET', () => file().get()], ['HEAD', () => file().head()]]) {
        const t0 = Date.now();
        const e = await failure(run());
        assert.ok(e instanceof NetworkError, `${what}: ${e}`);
        assert.equal(e.key, 'e.network.timeout', what);
        assert.ok(isOffline(e), what);
        assert.ok(Date.now() - t0 < 4000, `${what} took ${Date.now() - t0} ms`);
    }
    srv.options.fault = null;
    assert.deepEqual(Buffer.from((await file().get()).buf), BODY, 'the next request works again');
});

test('An upload gets time for its size: a slow answer to a large PUT is fine, the same wait without a body is not', async (t) => {
    const { srv, file } = await davServer(t);
    timeouts.rate = 10 * 1024; // the 10 KiB body adds a second to the 400 ms
    srv.options.fault = () => ({ delay: 900 });
    assert.ok(await file().put(BODY, null), 'PUT with a slow answer');
    const e = await failure(file().head());
    assert.equal(e.key, 'e.network.timeout');
});

test('A download that keeps coming in is not cut off however long it takes, one that stalls is', async (t) => {
    const { srv, file } = await davServer(t);
    srv.options.fault = (m) => (m === 'GET' ? { trickle: 100 } : undefined); // ten pieces over a second, never 400 ms without a byte
    const t0 = Date.now();
    assert.deepEqual(Buffer.from((await file().get()).buf), BODY);
    assert.ok(Date.now() - t0 > 600, 'the download was not slow at all');
    srv.options.fault = (m) => (m === 'GET' ? { stall: true } : undefined);
    const e = await failure(file().get());
    assert.ok(e instanceof NetworkError && e.key === 'e.network.timeout', String(e));
});

test('No space left (507) and a locked file (423) are clear errors, not an outage, for every kind of write', async (t) => {
    const { srv, file } = await davServer(t);
    for (const [status, key, why] of [[507, 'e.dav.full', 'full'], [423, 'e.dav.locked', 'locked']]) {
        srv.options.fault = (m) => (m === 'PUT' ? status : undefined);
        for (const [what, run] of [['put', () => file().put(BODY, null)], ['create', () => file('new.kdbx').create(BODY)], ['putCopy', () => file().putCopy(BODY, '20260101-000000')]]) {
            const e = await failure(run());
            assert.ok(e instanceof DavError, `${what} ${status}: ${e}`);
            assert.equal(e.key, key, `${what} ${status}`);
            assert.equal(isOffline(e), false, `${what} ${status}`);
            assert.equal(writeProblem(e), why, `${what} ${status}`);
        }
    }
});

test('Writing into a folder that is gone answers 409, and that counts as "gone"', async (t) => {
    const { file } = await davServer(t);
    const e = await failure(file('moved-away/db.kdbx').put(BODY, null));
    assert.equal(e.status, 409);
    assert.equal(writeProblem(e), 'gone');
    assert.equal(writeProblem(new DavError(404, 'x', 'e.dav.notfound')), 'gone');
    assert.equal(writeProblem(new DavError(410, 'x', 'e.dav.save', { status: 410 })), 'gone');
    assert.equal(writeProblem(new NetworkError(new TypeError('Failed to fetch'))), null);
    assert.equal(writeProblem(new DavError(503, 'x', 'e.dav.status', { status: 503 })), null);
});

test('Only outages count as offline: network errors, 500, 502-504, 511 and the like; 501, 505-508 and 510 come back the same every time', () => {
    const dav = (s) => new DavError(s, 'x', 'e.dav.status', { status: s });
    for (const s of [0, 500, 502, 503, 504, 509, 511, 522]) assert.ok(isOffline(dav(s)), String(s));
    for (const s of [400, 404, 409, 412, 423, 501, 505, 506, 507, 508, 510]) assert.ok(!isOffline(dav(s)), String(s));
    assert.ok(isOffline(new NetworkError(new TypeError('Failed to fetch'), 'cloud.example')));
});
