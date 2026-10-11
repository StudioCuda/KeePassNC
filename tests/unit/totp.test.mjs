// RFC-6238-Testvektoren (Anhang B) fuer src/totp.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOtpConfig, totp, base32Decode } from '../../src/totp.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits) out += B32[(val << (5 - bits)) & 31];
    return out;
}
const seed = (s, n) => new TextEncoder().encode(s.repeat(Math.ceil(n / s.length)).slice(0, n));
const vectors = [
    ['SHA1', seed('1234567890', 20), 59, '94287082'], ['SHA1', seed('1234567890', 20), 1111111109, '07081804'], ['SHA1', seed('1234567890', 20), 20000000000, '65353130'],
    ['SHA256', seed('1234567890', 32), 59, '46119246'], ['SHA256', seed('1234567890', 32), 1111111109, '68084774'],
    ['SHA512', seed('1234567890', 64), 59, '90693936'], ['SHA512', seed('1234567890', 64), 1111111109, '25091201']
];
for (const [alg, secret, t, expected] of vectors) {
    test(`RFC 6238 ${alg} t=${t}`, async () => {
        const cfg = parseOtpConfig(`otpauth://totp/x?secret=${b32(secret)}&digits=8&algorithm=${alg}&period=30`);
        assert.equal((await totp(cfg, t * 1000)).code, expected);
    });
}
test('Base32 Rundreise und Standardwerte', async () => {
    assert.deepEqual([...base32Decode('JBSWY3DPEHPK3PXP')], [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]);
    const cfg = parseOtpConfig('otpauth://totp/Mail?secret=JBSWY3DPEHPK3PXP');
    assert.equal(cfg.digits, 6); assert.equal(cfg.period, 30); assert.equal(cfg.algorithm, 'SHA1');
    const r = await totp(cfg, 59000); assert.match(r.code, /^\d{6}$/); assert.equal(r.remaining, 1);
});
test('Altes KeePass-Format (TOTP Seed/Settings)', async () => {
    const cfg = parseOtpConfig('', 'JBSWY3DPEHPK3PXP', '60;8');
    assert.equal(cfg.period, 60); assert.equal(cfg.digits, 8);
});
test('Ungueltige Eingaben werfen Fehler', () => {
    assert.throws(() => parseOtpConfig('otpauth://hotp/x?secret=AAAA'));
    assert.throws(() => parseOtpConfig('otpauth://totp/x'));
    assert.throws(() => base32Decode('abc!'));
    assert.equal(parseOtpConfig('', '', ''), null);
});
