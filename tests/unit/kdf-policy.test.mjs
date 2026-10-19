import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryLevel, isWeaker, minIterations, suggestIterations, newDbIterations, NEW_DB, MAX_ITERATIONS } from '../../src/core/kdf-policy.js';

const a = (memoryMiB, iterations, kdf = 'argon2id') => ({ kdf, memoryKiB: memoryMiB * 1024, iterations, parallelism: 2 });
const aes = (rounds) => ({ kdf: 'aes', rounds });

test('Ampel: bis 256 MiB gruen, 512 gelb, 1024 rot', () => {
    assert.deepEqual([64, 128, 256, 512, 1024].map(memoryLevel), ['ok', 'ok', 'ok', 'warn', 'bad']);
});

test('schwaecher: weniger Speicher, weniger Arbeit, weg von Argon2', () => {
    assert.equal(isWeaker(a(128, 4), a(256, 4)), true, 'weniger Speicher');
    assert.equal(isWeaker(a(128, 10), a(256, 4)), true, 'weniger Speicher, auch bei mehr Arbeit');
    assert.equal(isWeaker(a(256, 3), a(256, 4)), true, 'weniger Durchlaeufe');
    assert.equal(isWeaker(aes(1e6), a(64, 3)), true, 'Argon2 -> AES-KDF');
    assert.equal(isWeaker(aes(1e5), aes(2e5)), true, 'weniger AES-Runden');
});

test('nicht schwaecher: mehr von allem, Argon2d <-> Argon2id, AES-KDF -> Argon2', () => {
    assert.equal(isWeaker(a(512, 4), a(256, 4)), false);
    assert.equal(isWeaker(a(256, 4, 'argon2d'), a(256, 4, 'argon2id')), false);
    assert.equal(isWeaker(a(64, 2), aes(6e6)), false);
    assert.equal(isWeaker(aes(2e5), aes(2e5)), false);
});

test('Untergrenze der Durchlaeufe haelt die Arbeit (Speicher x Durchlaeufe)', () => {
    assert.equal(minIterations(a(64, 10), 128 * 1024), 5);
    assert.equal(minIterations(a(64, 10), 256 * 1024), 3); // 2,5 -> aufrunden
    assert.equal(minIterations(a(256, 4), 64 * 1024), 16);
    assert.equal(minIterations(aes(6e6), 64 * 1024), 1);
});

test('Vorschlag "etwa 1 s": aus dem Probelauf, nie unter der Untergrenze, gedeckelt', () => {
    assert.equal(suggestIterations(100, a(64, 2), 64 * 1024), 10);
    assert.equal(suggestIterations(400, a(64, 10), 64 * 1024), 10, 'langsames Geraet senkt nicht');
    assert.equal(suggestIterations(5000, aes(6e6), 1024 * 1024), 1);
    assert.equal(suggestIterations(0.01, a(64, 2), 64 * 1024), MAX_ITERATIONS);
});

test('Neue Datenbank: AES-256, Argon2id mit 64 MiB, Durchlaeufe aus dem Probelauf, nie unter 2', () => {
    assert.deepEqual({ ...NEW_DB }, { cipher: 'aes', kdf: 'argon2id', memoryKiB: 64 * 1024, iterations: 2, parallelism: 2 });
    assert.equal(newDbIterations(100), 10);
    assert.equal(newDbIterations(250), 4);
    assert.equal(newDbIterations(2000), 2, 'langsames Geraet: Untergrenze');
    assert.equal(newDbIterations(0.01), MAX_ITERATIONS);
});
