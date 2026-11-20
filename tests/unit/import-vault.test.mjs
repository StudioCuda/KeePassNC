import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, field } from './vault-harness.mjs';
import { readImport } from '../../src/core/import.js';

const bytes = (bin) => { let d = bin?.value ?? bin; if (d && typeof d.getBinary === 'function') d = d.getBinary(); return Buffer.from(d); };
const entry = (title, attachments) => ({ path: [], title, user: '', password: '', url: '', notes: '', totp: '', tags: [], attachments });

test('importEntries: an attachment that is a view into a bigger buffer keeps exactly its own bytes', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav);
    const big = Uint8Array.from([0xde, 0xad, 1, 2, 3, 0xbe, 0xef]);
    await vault.importEntries([entry('View', [{ name: 'part.bin', data: big.subarray(2, 5) }, { name: 'empty.bin', data: big.subarray(7) }])], 'Import x');
    const e = entryByTitle(vault, 'View');
    assert.deepEqual([...bytes(e.binaries.get('part.bin'))], [1, 2, 3], 'not the whole underlying buffer');
    assert.equal(bytes(e.binaries.get('empty.bin')).length, 0);
    assert.deepEqual([...big], [0xde, 0xad, 1, 2, 3, 0xbe, 0xef], 'the caller\'s buffer stays as it was');
    await vault.save();
    const again = await openDb(dav);
    assert.deepEqual([...bytes(entryByTitle(again, 'View').binaries.get('part.bin'))], [1, 2, 3], 'and so it is in the saved file');
});

test('importEntries: a Bitwarden SSH key lands as key file attachment plus public key and fingerprint fields', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav);
    const priv = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----\n';
    const { entries } = readImport(JSON.stringify({ encrypted: false, items: [{ type: 5, name: 'Server', sshKey: { privateKey: priv, publicKey: 'ssh-ed25519 AAAAC3 me@host', keyFingerprint: 'SHA256:abc' } }] }));
    await vault.importEntries(entries, 'Import bw');
    await vault.save();
    const e = entryByTitle(await openDb(dav), 'Server');
    assert.equal(bytes(e.binaries.get('id_ed25519')).toString(), priv);
    assert.deepEqual([field(e, 'SSH public key'), field(e, 'SSH fingerprint'), field(e, 'Password')], ['ssh-ed25519 AAAAC3 me@host', 'SHA256:abc', '']);
});
