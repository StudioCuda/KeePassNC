// TOTP formats on real entries (src/vault.js): KeePass 2's TimeOtp-* fields stay as they are on an edit, a TOTP set in the
// editor replaces every older format, the CSV export carries them all, and Bitwarden's steam:// arrives as a Steam TOTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDav, newDb, openDb, entryByTitle, field, ProtectedValue } from './vault-harness.mjs';
import { readImport } from '../../src/core/import.js';
import { parseCsv, toCsv } from '../../src/core/csv.js';
import { parseOtpConfig, totp } from '../../src/totp.js';
import { hasTotp } from '../../src/core/util.js';

const RFC_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 4226/6238 key "12345678901234567890"
const OTP_FIELDS = (e) => [...e.fields.keys()].filter((k) => k === 'otp' || k.startsWith('TOTP ') || k.startsWith('TimeOtp-')).sort();
const codeOf = async (e, t) => (await totp(parseOtpConfig(field(e, 'otp'), field(e, 'TOTP Seed'), field(e, 'TOTP Settings'), (k) => field(e, k)), t)).code;
/** What the editor hands to applyEntry when only the notes change (the TOTP box untouched: no otp key). */
const form = (e, extra = {}) => ({ Title: field(e, 'Title'), UserName: field(e, 'UserName'), Password: field(e, 'Password'), URL: field(e, 'URL'), Notes: field(e, 'Notes'), tags: [...e.tags], custom: [], ...extra });

async function kp2Db() {
    const vault = await newDb(new MemoryDav(), { entries: ['KeePass 2'] });
    const e = entryByTitle(vault, 'KeePass 2');
    e.fields.set('TimeOtp-Secret-Base32', ProtectedValue.fromString(RFC_B32));
    e.fields.set('TimeOtp-Length', '8');
    e.fields.set('TimeOtp-Algorithm', 'HMAC-SHA-1');
    return { vault, e };
}

test('Editing an entry with KeePass 2 TimeOtp-* fields keeps them untouched as long as the TOTP itself stays', async () => {
    const { vault, e } = await kp2Db();
    vault.applyEntry(e, e.parentGroup, form(e, { Notes: 'changed' }));
    assert.equal(field(e, 'Notes'), 'changed');
    assert.deepEqual(OTP_FIELDS(e), ['TimeOtp-Algorithm', 'TimeOtp-Length', 'TimeOtp-Secret-Base32'], 'no "otp" appears, nothing goes');
    assert.equal(e.fields.get('TimeOtp-Secret-Base32') instanceof ProtectedValue, true, 'the secret stays protected');
    assert.equal(await codeOf(e, 59000), '94287082');
    const before = e.history.length;
    vault.applyEntry(e, e.parentGroup, form(e));
    assert.equal(e.history.length, before, 'nothing changed, no history entry');
});

test('A TOTP set in the editor replaces TimeOtp-* and "TOTP Seed"/"TOTP Settings"; the history keeps the old ones', async () => {
    const { vault, e } = await kp2Db();
    e.fields.set('TOTP Seed', ProtectedValue.fromString('JBSWY3DPEHPK3PXP')); e.fields.set('TOTP Settings', '30;6');
    const uri = 'otpauth://totp/KeePass%202?secret=JBSWY3DPEHPK3PXP&period=30&digits=6';
    vault.applyEntry(e, e.parentGroup, form(e, { otp: uri }));
    assert.deepEqual(OTP_FIELDS(e), ['otp'], 'KeePassXC reads "TOTP Settings" before "otp" and KeePass 2 only TimeOtp-*: left there they would keep showing the old code');
    assert.equal(field(e, 'otp'), uri);
    assert.deepEqual(OTP_FIELDS(e.history.at(-1)), ['TOTP Seed', 'TOTP Settings', 'TimeOtp-Algorithm', 'TimeOtp-Length', 'TimeOtp-Secret-Base32']);
});

test('Emptying the TOTP box removes a TOTP that only lives in TimeOtp-* fields', async () => {
    const { vault, e } = await kp2Db();
    vault.applyEntry(e, e.parentGroup, form(e, { otp: '' }));
    assert.deepEqual(OTP_FIELDS(e), []);
    assert.equal(e.history.length, 1, 'the removal is an edit with a history entry');
});

test('The same "otp" again leaves an entry alone, an "otp" next to old fields is tidied up', async () => {
    const vault = await newDb(new MemoryDav(), { entries: ['A'] });
    const e = entryByTitle(vault, 'A');
    e.fields.set('otp', ProtectedValue.fromString('otpauth://totp/A?secret=JBSWY3DPEHPK3PXP'));
    vault.applyEntry(e, e.parentGroup, form(e, { otp: 'otpauth://totp/A?secret=JBSWY3DPEHPK3PXP' }));
    assert.equal(e.history.length, 0);
    e.fields.set('TimeOtp-Secret', ProtectedValue.fromString('x'));
    vault.applyEntry(e, e.parentGroup, form(e, { otp: 'otpauth://totp/A?secret=JBSWY3DPEHPK3PXP' }));
    assert.deepEqual(OTP_FIELDS(e), ['otp']);
});

test('TimeOtp-* survive saving and opening byte for byte, and the CSV export turns them into an otpauth URI', async () => {
    const dav = new MemoryDav();
    const vault = await newDb(dav, { entries: ['KeePass 2', 'Old'] });
    const e = entryByTitle(vault, 'KeePass 2');
    e.fields.set('TimeOtp-Secret-Hex', ProtectedValue.fromString('3132333435363738393031323334353637383930'));
    e.fields.set('TimeOtp-Period', '60'); e.fields.set('TimeOtp-Algorithm', 'HMAC-SHA-256');
    const old = entryByTitle(vault, 'Old');
    old.fields.set('TOTP Seed', ProtectedValue.fromString('JBSWY3DPEHPK3PXP')); // no "TOTP Settings": 30 s, 6 digits
    await vault.save();
    const back = await openDb(dav);
    const e2 = entryByTitle(back, 'KeePass 2');
    assert.deepEqual(OTP_FIELDS(e2), ['TimeOtp-Algorithm', 'TimeOtp-Period', 'TimeOtp-Secret-Hex']);
    assert.equal(e2.fields.get('TimeOtp-Secret-Hex') instanceof ProtectedValue, true);
    const rows = parseCsv(toCsv(back.csvRows()));
    const col = rows[0].indexOf('TOTP');
    const totpOf = (title) => rows.find((r) => r[1] === title)[col];
    assert.equal(totpOf('KeePass 2'), `otpauth://totp/KeePass%202?secret=${RFC_B32}&period=60&digits=6&algorithm=SHA256`);
    assert.equal(totpOf('Old'), 'otpauth://totp/Old?secret=JBSWY3DPEHPK3PXP&period=30&digits=6');
    // the exported URI makes the same code as the fields
    assert.equal((await totp(parseOtpConfig(totpOf('KeePass 2')), 1111111109000)).code, await codeOf(e2, 1111111109000));
});

test('hasTotp (badge, filter, has:totp, quick button): a secret in any of the places counts, settings alone or an empty "otp" do not', async () => {
    const vault = await newDb(new MemoryDav(), { entries: ['x'] });
    const e = entryByTitle(vault, 'x');
    const has = (fields) => { for (const k of [...e.fields.keys()]) if (k.startsWith('TimeOtp-') || k.startsWith('TOTP ') || k === 'otp') e.fields.delete(k); for (const [k, v] of Object.entries(fields)) e.fields.set(k, v); return hasTotp(e); };
    for (const k of ['otp', 'TOTP Seed', 'TimeOtp-Secret', 'TimeOtp-Secret-Hex', 'TimeOtp-Secret-Base32', 'TimeOtp-Secret-Base64']) {
        assert.equal(has({ [k]: ProtectedValue.fromString('3132') }), true, k + ' (protected)');
        assert.equal(has({ [k]: '3132' }), true, k);
    }
    assert.equal(has({ 'TimeOtp-Length': '8', 'TimeOtp-Period': '60', 'TOTP Settings': '30;6' }), false);
    assert.equal(has({ otp: '' }), false);
    assert.equal(has({ otp: ProtectedValue.fromString('') }), false);
    assert.equal(has({ 'TimeOtp-Secret-Base32': '  ' }), false);
});

test('Bitwarden import: steam://SECRET lands in "otp" as a Steam Guard URI with encoder=steam', async () => {
    const vault = await newDb(new MemoryDav());
    const { entries } = readImport(JSON.stringify({ encrypted: false, folders: [], items: [{ type: 1, name: 'Steam', login: { username: 'anna', password: 'pw', totp: `steam://${RFC_B32}` } }] }));
    await vault.importEntries(entries, 'Import');
    const e = entryByTitle(vault, 'Steam');
    assert.equal(field(e, 'otp'), `otpauth://totp/Steam:anna?secret=${RFC_B32}&period=30&digits=5&issuer=Steam&encoder=steam`);
    assert.equal(await codeOf(e, 59000), 'PV9M4');
});
