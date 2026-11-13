// RFC 6238 test vectors (appendix B) for src/totp.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOtpConfig, totp, base32Decode, base32Encode, steamCode, otpauthUri, OtpError } from '../../src/totp.js';

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
// Steam Guard: RFC 4226 appendix D gives the truncated value 1094287082 for this key at counter 1 (t=59).
// With the Steam alphabet that yields "PV9M4" (independently recomputed in Python).
test('Steam Guard: encoder=steam (otpauth) und "30;S" (alt) liefern 5 Zeichen', async () => {
    assert.equal(steamCode(1094287082), 'PV9M4');
    const cfg = parseOtpConfig(`otpauth://totp/Steam:anna?secret=${b32(seed('1234567890', 20))}&issuer=Steam&encoder=steam`);
    assert.equal(cfg.steam, true); assert.equal(cfg.digits, 5);
    assert.equal((await totp(cfg, 59000)).code, 'PV9M4');
    const legacy = parseOtpConfig('', b32(seed('1234567890', 20)), '30;S');
    assert.equal(legacy.steam, true);
    assert.equal((await totp(legacy, 59000)).code, 'PV9M4');
    assert.equal(parseOtpConfig('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP').steam, false); // normale Codes bleiben Ziffern
});
test('Ungueltige Eingaben werfen Fehler', () => {
    assert.throws(() => parseOtpConfig('otpauth://hotp/x?secret=AAAA'));
    assert.throws(() => parseOtpConfig('otpauth://totp/x'));
    assert.throws(() => base32Decode('abc!'));
    assert.equal(parseOtpConfig('', '', ''), null);
});

// KeePass 2 (2.47+) keeps its TOTP in TimeOtp-* fields. get(name) stands in for the entry's field texts.
const fieldsOf = (obj) => (k) => obj[k] ?? '';
const RFC_KEY = { SHA1: seed('1234567890', 20), SHA256: seed('1234567890', 32), SHA512: seed('1234567890', 64) };
const hex = (b) => Buffer.from(b).toString('hex');
const b64 = (b) => Buffer.from(b).toString('base64');
const errKey = (fn) => { try { fn(); } catch (e) { return e instanceof OtpError ? e.key : 'not an OtpError: ' + e; } return 'no error'; };

test('KeePass 2 TimeOtp-*: every secret encoding and algorithm gives the RFC 6238 codes', async () => {
    for (const [alg, kp2] of [['SHA1', 'HMAC-SHA-1'], ['SHA256', 'HMAC-SHA-256'], ['SHA512', 'HMAC-SHA-512']]) {
        const key = RFC_KEY[alg];
        const encodings = { 'TimeOtp-Secret': Buffer.from(key).toString('utf8'), 'TimeOtp-Secret-Hex': hex(key), 'TimeOtp-Secret-Base32': b32(key), 'TimeOtp-Secret-Base64': b64(key) };
        for (const [name, value] of Object.entries(encodings)) {
            const cfg = parseOtpConfig('', '', '', fieldsOf({ [name]: value, 'TimeOtp-Length': '8', 'TimeOtp-Algorithm': kp2 }));
            assert.equal(cfg.algorithm, alg);
            for (const [a, , t, expected] of vectors.filter((v) => v[0] === alg)) assert.equal((await totp(cfg, t * 1000)).code, expected, `${a} ${name} t=${t}`);
        }
    }
});
test('KeePass 2 TimeOtp-*: 6 digits, 30 s and HMAC-SHA-1 unless the entry says otherwise', async () => {
    for (const extra of [{}, { 'TimeOtp-Length': '', 'TimeOtp-Period': '', 'TimeOtp-Algorithm': '' }]) {
        const cfg = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret': '12345678901234567890', ...extra }));
        assert.deepEqual([cfg.digits, cfg.period, cfg.algorithm, cfg.steam], [6, 30, 'SHA1', false]);
        assert.equal((await totp(cfg, 59000)).code, '287082'); // RFC 4226 appendix D, counter 1
    }
    const slow = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret-Hex': hex(RFC_KEY.SHA1), 'TimeOtp-Period': '60', 'TimeOtp-Length': '8' }));
    assert.equal((await totp(slow, 119000)).code, '94287082', 'counter 1 at 60 s per step');
    assert.equal((await totp(slow, 119000)).remaining, 1);
    assert.equal(parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Length': '8', 'TimeOtp-Period': '60' })), null, 'settings without a secret are no TOTP');
});
test('KeePass 2 TimeOtp-*: the secret is read in KeePass 2 order (text, hex, Base32, Base64); spaces and lower case are fine', async () => {
    const other = seed('abcdefghij', 20);
    const cfg = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret-Base64': b64(other), 'TimeOtp-Secret-Base32': b32(other), 'TimeOtp-Secret-Hex': hex(RFC_KEY.SHA1), 'TimeOtp-Length': '8' }));
    assert.equal((await totp(cfg, 59000)).code, '94287082', 'hex before Base32 and Base64');
    const text = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret': '12345678901234567890', 'TimeOtp-Secret-Hex': hex(other), 'TimeOtp-Length': '8' }));
    assert.equal((await totp(text, 59000)).code, '94287082', 'the plain secret first');
    const loose = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret-Hex': hex(RFC_KEY.SHA1).toUpperCase().replace(/(.{8})/g, '$1 '), 'TimeOtp-Length': '8' }));
    assert.equal((await totp(loose, 59000)).code, '94287082', 'upper-case hex in blocks');
    const b32loose = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret-Base32': b32(RFC_KEY.SHA1).toLowerCase().replace(/(.{4})/g, '$1 '), 'TimeOtp-Length': '8' }));
    assert.equal((await totp(b32loose, 59000)).code, '94287082', 'lower-case Base32 in blocks');
});
test('Priority: KeePassXC\'s "otp" first, then "TOTP Seed"/"TOTP Settings", then KeePass 2\'s TimeOtp-* (as KeePassXC reads "otp" before TimeOtp-*)', async () => {
    const kp2 = fieldsOf({ 'TimeOtp-Secret-Hex': hex(RFC_KEY.SHA256), 'TimeOtp-Algorithm': 'HMAC-SHA-256', 'TimeOtp-Length': '8' });
    const viaOtp = parseOtpConfig(`otpauth://totp/x?secret=${b32(RFC_KEY.SHA1)}&digits=8`, '', '', kp2);
    assert.equal((await totp(viaOtp, 59000)).code, '94287082');
    const viaSeed = parseOtpConfig('', b32(RFC_KEY.SHA1), '30;8', kp2);
    assert.equal((await totp(viaSeed, 59000)).code, '94287082');
    assert.equal((await totp(parseOtpConfig('', '', '', kp2), 59000)).code, '46119246');
});
test('Algorithm spellings from the wild: SHA256, sha256, SHA-256, HMAC-SHA-256, HmacSHA256 and friends', async () => {
    const spellings = { SHA1: ['SHA1', 'sha1', 'SHA-1', 'HMAC-SHA-1', 'HmacSHA1', ''], SHA256: ['SHA256', 'sha256', 'SHA-256', 'sha-256', 'HMAC-SHA-256', 'HmacSHA256', 'SHA_256'], SHA512: ['SHA512', 'Sha512', 'SHA-512', 'HMAC-SHA-512'] };
    const expected = { SHA1: '94287082', SHA256: '46119246', SHA512: '90693936' };
    for (const [alg, names] of Object.entries(spellings)) {
        for (const name of names) {
            const cfg = parseOtpConfig(`otpauth://totp/x?secret=${b32(RFC_KEY[alg])}&digits=8&algorithm=${encodeURIComponent(name)}`);
            assert.equal(cfg.algorithm, alg, name);
            assert.equal((await totp(cfg, 59000)).code, expected[alg], name);
        }
    }
    assert.equal((await totp({ secret: RFC_KEY.SHA256, period: 30, digits: 8, algorithm: 'SHA-256' }, 59000)).code, '46119246', 'totp() itself takes the spellings too');
});
test('"otp" field: the KeeOtp plugin format, a bare Base32 secret and Bitwarden\'s steam:// also make codes', async () => {
    const keeOtp = parseOtpConfig(`key=${b32(RFC_KEY.SHA256)}&size=8&step=30&otpHashMode=Sha256`);
    assert.equal((await totp(keeOtp, 59000)).code, '46119246');
    assert.deepEqual([parseOtpConfig(`key=${b32(RFC_KEY.SHA1)}`).digits, parseOtpConfig(`key=${b32(RFC_KEY.SHA1)}`).period], [6, 30]);
    const bare = parseOtpConfig(' jbsw y3dp-ehpk 3pxp ');
    assert.deepEqual([[...bare.secret], bare.digits, bare.period, bare.algorithm], [[...base32Decode('JBSWY3DPEHPK3PXP')], 6, 30, 'SHA1']);
    const steam = parseOtpConfig(`steam://${b32(RFC_KEY.SHA1)}`);
    assert.equal(steam.steam, true);
    assert.equal((await totp(steam, 59000)).code, 'PV9M4');
});
test('Broken TOTP settings throw an OtpError with a text for the UI before totp() ever runs', () => {
    const kp2 = (o) => () => parseOtpConfig('', '', '', fieldsOf(o));
    assert.equal(errKey(kp2({ 'TimeOtp-Secret-Hex': 'xyz' })), 'e.otp.hex');
    assert.equal(errKey(kp2({ 'TimeOtp-Secret-Hex': '313' })), 'e.otp.hex', 'odd number of hex digits');
    assert.equal(errKey(kp2({ 'TimeOtp-Secret-Base64': 'a*b?' })), 'e.otp.base64');
    assert.equal(errKey(kp2({ 'TimeOtp-Secret-Base32': '1890' })), 'e.otp.base32');
    assert.equal(errKey(kp2({ 'TimeOtp-Secret-Base32': '====' })), 'e.otp.empty');
    assert.equal(errKey(kp2({ 'TimeOtp-Secret': 'x', 'TimeOtp-Algorithm': 'HMAC-MD5' })), 'e.otp.algo');
    assert.equal(errKey(() => parseOtpConfig('otpauth://totp/x?secret=JBSWY3DP&algorithm=MD5')), 'e.otp.algo');
    assert.equal(errKey(() => parseOtpConfig('otpauth://totp/x?secret=====')), 'e.otp.empty');
    assert.equal(errKey(() => parseOtpConfig('', '====', '30;6')), 'e.otp.empty');
    assert.equal(errKey(() => parseOtpConfig('otpauth://[broken')), 'e.otp.format');
    assert.equal(errKey(() => parseOtpConfig('hello world!')), 'e.otp.format', 'an "otp" nobody can read');
    assert.equal(errKey(() => parseOtpConfig('key=JBSWY3DP&type=hotp')), 'e.otp.type');
    assert.equal(parseOtpConfig('hello world!', 'JBSWY3DP', '30;6').digits, 6, 'an unreadable "otp" leaves the old fields in charge, as before');
});
test('otpauthUri: KeePassXC\'s form (Base32 secret, period, digits, algorithm unless SHA-1, encoder=steam)', () => {
    const cfg = parseOtpConfig('', '', '', fieldsOf({ 'TimeOtp-Secret-Hex': hex(RFC_KEY.SHA256), 'TimeOtp-Algorithm': 'HMAC-SHA-256', 'TimeOtp-Length': '8', 'TimeOtp-Period': '60' }));
    assert.equal(otpauthUri(cfg, 'Mein Konto'), `otpauth://totp/Mein%20Konto?secret=${b32(RFC_KEY.SHA256)}&period=60&digits=8&algorithm=SHA256`);
    assert.equal(otpauthUri(parseOtpConfig('steam://JBSWY3DPEHPK3PXP'), ''), 'otpauth://totp/KeePass?secret=JBSWY3DPEHPK3PXP&period=30&digits=5&encoder=steam');
    assert.equal(base32Encode(base32Decode('JBSWY3DPEHPK3PXP')), 'JBSWY3DPEHPK3PXP');
});
