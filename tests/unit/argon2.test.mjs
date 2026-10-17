import test from 'node:test';
import assert from 'node:assert/strict';
import { argon2d, argon2id } from 'hash-wasm';
import { argon2, workerUrl } from '../../src/argon2.js';

test('Worker liegt neben dem App-Skript und behaelt dessen ?v=', () => {
    assert.equal(workerUrl('https://cloud.example/custom_apps/keepassnc/js/keepassnc.js?v=0.8.1'), 'https://cloud.example/custom_apps/keepassnc/js/keepassnc-argon2.js?v=0.8.1');
    assert.equal(workerUrl('https://example.org/kp/keepassnc.js'), 'https://example.org/kp/keepassnc-argon2.js');
});

test('ohne Worker (Node): gleiches Ergebnis wie hash-wasm direkt, fuer Argon2d und Argon2id', async () => {
    const password = new TextEncoder().encode('Pässwort'), salt = new Uint8Array(16).fill(7);
    const base = { password, salt, parallelism: 2, iterations: 2, memorySize: 64, hashLength: 32, outputType: 'binary' };
    for (const [type, fn] of [['d', argon2d], ['id', argon2id]]) {
        const got = await argon2({ type, password, salt, parallelism: 2, iterations: 2, memoryKiB: 64, hashLength: 32 });
        assert.deepEqual([...got], [...await fn(base)], type);
    }
});
