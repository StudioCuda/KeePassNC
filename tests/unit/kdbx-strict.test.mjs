// Reading KDBX 4 strictly: the HMAC block stream has to end with its authenticated empty block and nothing after it, and a key
// derivation we can't compute (Argon2 1.0) says so instead of looking like a wrong password.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Vault, VaultError, kdbxweb, FAST, PW, entryByTitle, titles } from './vault-harness.mjs';

const { KdbxError, KdbxHeader, BinaryStream, Consts } = kdbxweb;
const MiB = 1024 * 1024;

/** A KDBX 4 file with a 2.5 MiB attachment of random bytes, so the encrypted payload spans three HMAC blocks plus the empty end block. */
async function bigFile(cipher = 'aes') {
    const { vault } = await Vault.create({ name: 'db', password: PW, security: { ...FAST, cipher } });
    const bin = await vault.makeBinary(crypto.randomBytes(2.5 * MiB).buffer);
    vault.applyEntry(null, vault.root, { Title: 'Blob', attachments: { remove: [], add: new Map([['blob.bin', bin]]) } });
    return Buffer.from(await vault.copyBytes());
}

/** The HMAC blocks of a KDBX 4 file: offset of each block's 32-byte HMAC and its length; the last one is the empty end block. */
function hmacBlocks(file) {
    const header = KdbxHeader.read(new BinaryStream(new Uint8Array(file).buffer), null);
    const out = [];
    let at = header.endPos + 32 + 32; // header SHA-256 and header HMAC
    for (;;) {
        const len = file.readUInt32LE(at + 32);
        out.push({ at, len });
        if (len === 0) return out;
        at += 32 + 4 + len;
    }
}

const open = (file) => Vault.open({ buf: new Uint8Array(file).buffer, password: PW });
const corrupt = (e) => {
    assert.ok(e instanceof KdbxError && e.code === Consts.ErrorCodes.FileCorrupt, `expected FileCorrupt, got ${e?.name}: ${e?.key ?? ''} ${e?.message}`);
    return true;
};

for (const cipher of ['aes', 'chacha20']) {
    test(`intact multi-block file opens (${cipher})`, async () => {
        const file = await bigFile(cipher);
        const blocks = hmacBlocks(file);
        assert.deepEqual(blocks.map((b) => b.len > 0), [true, true, true, false], 'three data blocks and the end block');
        assert.equal(blocks.at(-1).at + 36, file.length, 'the end block closes the file');
        const v = await open(file);
        assert.equal(entryByTitle(v, 'Blob').binaries.get('blob.bin').value.byteLength, 2.5 * MiB);
    });

    test(`a forged end block is caught by its HMAC (${cipher})`, async () => {
        const file = await bigFile(cipher);
        const end = hmacBlocks(file).at(-1);
        file[end.at + 7] ^= 0x01;
        await assert.rejects(open(file), corrupt);
    });

    test(`a file cut at a block boundary with the end block put back is corrupt, not a wrong password (${cipher})`, async () => {
        // The end block's HMAC covers its index, so the old one doesn't fit after fewer blocks; without the check AES ended
        // in a padding error ("wrong password") and ChaCha20 in whatever gzip made of the cut data.
        const file = await bigFile(cipher);
        const blocks = hmacBlocks(file), end = blocks.at(-1);
        for (const keep of [1, 2]) {
            const cut = Buffer.concat([file.subarray(0, blocks[keep].at), file.subarray(end.at)]);
            await assert.rejects(open(cut), corrupt, `${keep} block(s) kept`);
        }
    });

    test(`a file cut at a block boundary without an end block is corrupt (${cipher})`, async () => {
        const file = await bigFile(cipher);
        const blocks = hmacBlocks(file);
        for (const b of blocks.slice(1)) await assert.rejects(open(file.subarray(0, b.at)), corrupt, `cut at ${b.at}`);
    });

    test(`a file cut inside a block or inside the end block is corrupt (${cipher})`, async () => {
        const file = await bigFile(cipher);
        const blocks = hmacBlocks(file), end = blocks.at(-1);
        for (const len of [blocks[1].at + 1000, blocks[1].at + 20, end.at + 33, file.length - 1]) {
            await assert.rejects(open(file.subarray(0, len)), corrupt, `cut at ${len} of ${file.length}`);
        }
    });

    test(`bytes after the end block are ignored, like KeePass 2 and KeePassXC do (${cipher})`, async () => {
        const file = await bigFile(cipher);
        const blocks = hmacBlocks(file);
        const plain = titles(await open(file));
        assert.deepEqual(titles(await open(Buffer.concat([file, Buffer.from([0])]))), plain, 'one byte');
        // a complete, correctly authenticated block repeated after the end: never read, not part of the file
        assert.deepEqual(titles(await open(Buffer.concat([file, file.subarray(blocks[0].at, blocks[1].at)]))), plain, 'a whole block');
    });
}

test('the files the app writes still open after saving again (the end block it writes is the one it checks)', async () => {
    const { vault, bytes } = await Vault.create({ name: 'db', password: PW, security: FAST });
    vault.applyEntry(null, vault.root, { Title: 'One' });
    const again = await Vault.open({ buf: await vault.copyBytes(), password: PW });
    assert.ok(entryByTitle(again, 'One'));
    assert.ok(await Vault.open({ buf: bytes, password: PW }));
});

// ---------------------------------------------------------------- Argon2 version

const ARGON = { cipher: 'aes', kdf: 'argon2d', memoryKiB: 1024, iterations: 1, parallelism: 1 };

/** The file with Argon2 parameter V (UInt32) set to version, plus a header hash that fits again. */
function withArgonVersion(file, version) {
    const d = Buffer.from(file);
    const tag = Buffer.from([0x04, 1, 0, 0, 0, 0x56, 4, 0, 0, 0]); // VariantDictionary: UInt32, name "V", 4-byte value
    const at = d.indexOf(tag);
    assert.ok(at > 0, 'Argon2 parameter V not found in the header');
    assert.equal(d.readUInt32LE(at + tag.length), 0x13, 'the app writes Argon2 1.3');
    d.writeUInt32LE(version, at + tag.length);
    const end = KdbxHeader.read(new BinaryStream(new Uint8Array(d).buffer), null).endPos;
    crypto.createHash('sha256').update(d.subarray(0, end)).digest().copy(d, end);
    return d;
}

test('Argon2 1.3 file opens', async () => {
    const { bytes } = await Vault.create({ name: 'db', password: PW, security: ARGON });
    assert.ok(await Vault.open({ buf: bytes, password: PW }));
});

test('Argon2 1.0 file: a clear message instead of "wrong password"', async () => {
    // hash-wasm only does Argon2 1.3. Deriving a 1.0 file's key with it gives a different key, which looked like a wrong password.
    const { bytes } = await Vault.create({ name: 'db', password: PW, security: ARGON });
    const file = withArgonVersion(Buffer.from(bytes), 0x10);
    await assert.rejects(Vault.open({ buf: new Uint8Array(file).buffer, password: PW }), (e) => {
        assert.ok(e instanceof VaultError, `expected a VaultError, got ${e?.name}: ${e?.message}`);
        assert.equal(e.key, 'e.kdf.argon2v10');
        return true;
    });
    // the same with an empty password and a key file, where a wrong key would be tried twice
    await assert.rejects(Vault.open({ buf: new Uint8Array(file).buffer, password: '', keyfile: new Uint8Array(32) }), (e) => e?.key === 'e.kdf.argon2v10');
});
