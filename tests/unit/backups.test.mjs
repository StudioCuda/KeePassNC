import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { startServer } from '../e2e/davserver.mjs';
import { DavFile } from '../../src/webdav.js';

globalThis.DOMParser = DOMParser;

test('Aufraeumen behaelt die neuesten Kopien je Art und beruehrt nichts anderes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-bak-'));
    const srv = await startServer({ webRoot: dir, davRoot: dir });
    try {
        const mk = (n) => fs.writeFileSync(path.join(dir, n), 'x');
        mk('daily.kdbx');
        const normal = ['20260101-100000', '20260102-100000', '20260103-100000', '20260104-100000', '20260105-100000'];
        for (const s of normal) mk(`daily.kdbx.${s}.bak`);
        const conf = ['20260101-110000', '20260102-110000', '20260103-110000'];
        for (const s of conf) mk(`daily.kdbx.conflict-${s}.bak`);
        // Fremde Dateien, die dem Muster nicht exakt entsprechen, muessen bleiben
        const keepers = ['other.kdbx.20260101-100000.bak', 'daily.kdbx.20260101-100000.bak.txt', 'daily.kdbx.manual.bak', 'daily.kdbx.2026.bak', 'daily.kdbxX.20260101-100000.bak', 'notes.txt'];
        for (const k of keepers) mk(k);
        const dav = new DavFile({ url: `http://127.0.0.1:${srv.port}/dav/daily.kdbx`, user: srv.user, pass: srv.pass });
        assert.deepEqual(await dav.pruneBackups(0), []);
        const removed = await dav.pruneBackups(2);
        assert.equal(removed.length, 4);
        const left = fs.readdirSync(dir).sort();
        assert.ok(left.includes('daily.kdbx'));
        for (const k of keepers) assert.ok(left.includes(k), k);
        assert.deepEqual(left.filter((f) => /^daily\.kdbx\.\d{8}-\d{6}\.bak$/.test(f)), ['daily.kdbx.20260104-100000.bak', 'daily.kdbx.20260105-100000.bak']);
        assert.deepEqual(left.filter((f) => f.includes('conflict')), ['daily.kdbx.conflict-20260102-110000.bak', 'daily.kdbx.conflict-20260103-110000.bak']);
    } finally { await srv.stop(); }
});
