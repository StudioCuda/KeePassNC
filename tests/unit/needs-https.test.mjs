import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoMissing } from '../../src/ui/needs-https.js';

test('cryptoMissing: no WebCrypto (plain HTTP) is detected', () => {
    assert.equal(cryptoMissing({}), true);
    assert.equal(cryptoMissing({ crypto: {} }), true); // getRandomValues alone isn't enough, kdbxweb needs subtle
    assert.equal(cryptoMissing({ crypto: { subtle: {} } }), false);
    assert.equal(cryptoMissing(globalThis), false); // Node has WebCrypto
});
