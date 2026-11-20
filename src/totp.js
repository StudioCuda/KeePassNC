// TOTP (RFC 6238) via WebCrypto. Reads every place KeePass apps keep one: the "otp" field (otpauth:// URL, the KeePassXC standard;
// also the KeeOtp plugin's "key=…&step=…", a bare Base32 secret or Bitwarden's steam://), the older KeePass fields "TOTP Seed" /
// "TOTP Settings" ("30;6"), and KeePass 2's own TimeOtp-* fields (since KeePass 2.47).
// Steam Guard: same calculation, but 5 characters from its own alphabet. Detected by "encoder=steam" (otpauth) or "30;S" (old).

/** Error with an i18n key (like VaultError): the UI shows it via errText() in the chosen language. */
export class OtpError extends Error {
    constructor(message, key, vars) { super(message); this.key = key; this.vars = vars; }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM = '23456789BCDFGHJKMNPQRTVWXY';
const HMAC = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }; // WebCrypto's names for the spellings normalizeAlgorithm settles on

export function base32Decode(str) {
    const s = str.replace(/[\s=-]/g, '').toUpperCase();
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of s) {
        const idx = B32.indexOf(ch);
        if (idx < 0) throw new OtpError('Invalid Base32 character in the TOTP secret', 'e.otp.base32');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}

/** Bytes -> Base32 without padding, as otpauth URIs carry the secret. */
export function base32Encode(bytes) {
    let bits = 0, value = 0, out = '';
    for (const b of bytes) {
        value = ((value << 8) | b) & 0xfff; // only the bits not yet written are needed
        bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    return bits ? out + B32[(value << (5 - bits)) & 31] : out;
}

function hexDecode(str) {
    const s = str.replace(/\s/g, '');
    if (!/^([0-9a-f]{2})*$/i.test(s)) throw new OtpError('Invalid hex in the TOTP secret', 'e.otp.hex');
    return Uint8Array.from(s.match(/../g) || [], (b) => parseInt(b, 16));
}

function base64Decode(str) {
    let bin;
    try { bin = atob(str.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')); } catch { throw new OtpError('Invalid Base64 in the TOTP secret', 'e.otp.base64'); }
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** WebCrypto refuses an empty HMAC key; better a clear message now than an error on every tick of the code. */
function secretOf(bytes) {
    if (!bytes.length) throw new OtpError('The TOTP secret is empty', 'e.otp.empty');
    return bytes;
}

/**
 * Hash name as it is written in the wild -> SHA1 | SHA256 | SHA512: otpauth's "SHA256" (also in lower case or as "SHA-256"),
 * KeePass 2's "HMAC-SHA-256", Java's "HmacSHA256", KeeOtp's "Sha256". Anything else throws: a wrong code is worse than none.
 */
export function normalizeAlgorithm(name) {
    const n = String(name || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^HMAC/, '');
    if (!HMAC[n]) throw new OtpError('Unsupported TOTP algorithm: ' + name, 'e.otp.algo', { algo: name });
    return n;
}

/**
 * The fields that hold a KeePass 2 TOTP secret, in the order KeePass 2 reads them: text (UTF-8), hex, Base32, Base64.
 * KeePassXC (2.7) only knows the Base32 one.
 */
export const TIME_OTP_SECRET_FIELDS = ['TimeOtp-Secret', 'TimeOtp-Secret-Hex', 'TimeOtp-Secret-Base32', 'TimeOtp-Secret-Base64'];
const TIME_OTP_DECODE = [(s) => new TextEncoder().encode(s), hexDecode, base32Decode, base64Decode];

/**
 * TOTP settings from KeePass 2's fields (get(name) gives the field's text): the secret (see above), TimeOtp-Length (digits, 6),
 * TimeOtp-Period (seconds, 30) and TimeOtp-Algorithm (HMAC-SHA-1, HMAC-SHA-256 or HMAC-SHA-512). null without a secret.
 */
export function timeOtpConfig(get) {
    const i = TIME_OTP_SECRET_FIELDS.findIndex((k) => (get(k) || '').trim());
    if (i < 0) return null;
    return {
        secret: secretOf(TIME_OTP_DECODE[i](get(TIME_OTP_SECRET_FIELDS[i]))),
        period: parseInt(get('TimeOtp-Period') || '30', 10),
        digits: parseInt(get('TimeOtp-Length') || '6', 10),
        algorithm: normalizeAlgorithm(get('TimeOtp-Algorithm')),
        steam: false
    };
}

/** The "otp" field in its other forms; null if it is none of them. */
function otherOtpForms(otp) {
    const plain = (secret, steam = false) => ({ secret: secretOf(base32Decode(secret)), period: 30, digits: steam ? 5 : 6, algorithm: 'SHA1', steam });
    if (/^steam:\/\//i.test(otp)) return plain(otp.slice(8), true); // Bitwarden's Steam Guard form
    if (/(^|&)key=/i.test(otp)) { // KeeOtp plugin: key=BASE32&step=30&size=6&otpHashMode=Sha256, which KeePassXC reads too
        const p = new URLSearchParams(otp);
        if ((p.get('type') || 'totp').toLowerCase() !== 'totp') throw new OtpError('Only TOTP is supported', 'e.otp.type');
        return { secret: secretOf(base32Decode(p.get('key'))), period: parseInt(p.get('step') || '30', 10), digits: parseInt(p.get('size') || '6', 10), algorithm: normalizeAlgorithm(p.get('otpHashMode')), steam: false };
    }
    if (/^[A-Z2-7=\s-]+$/i.test(otp)) return plain(otp); // a bare secret, read the way the editor completes one (toOtpUri)
    return null;
}

/**
 * TOTP settings of an entry: the "otp" field first, then the old "TOTP Seed"/"TOTP Settings", then KeePass 2's TimeOtp-* fields
 * (timeOtp: get(name) -> field text). KeePassXC also reads "otp" before TimeOtp-*; once the TOTP is edited in KeePassNC only "otp"
 * is left (Vault.applyEntry). null without any; throws an OtpError when the settings can't make a code.
 */
export function parseOtpConfig(otpField, seedField, settingsField, timeOtp) {
    const otp = (otpField || '').trim();
    if (/^otpauth:\/\//i.test(otp)) {
        let u;
        try { u = new URL(otp); } catch { throw new OtpError('Unreadable otpauth URL', 'e.otp.format'); }
        const p = u.searchParams;
        if (u.hostname.toLowerCase() !== 'totp') throw new OtpError('Only TOTP is supported', 'e.otp.type');
        const secret = p.get('secret');
        if (!secret) throw new OtpError('otpauth URL without a secret', 'e.otp.secret');
        const steam = (p.get('encoder') || '').toLowerCase() === 'steam';
        return {
            secret: secretOf(base32Decode(secret)),
            period: parseInt(p.get('period') || '30', 10),
            digits: steam ? 5 : parseInt(p.get('digits') || '6', 10),
            algorithm: normalizeAlgorithm(p.get('algorithm')),
            steam
        };
    }
    const other = otp ? otherOtpForms(otp) : null;
    if (other) return other;
    if (seedField) {
        const [period, digits] = (settingsField || '30;6').split(';');
        const steam = (digits || '').trim().toUpperCase() === 'S';
        return {
            secret: secretOf(base32Decode(seedField)),
            period: parseInt(period || '30', 10),
            digits: steam ? 5 : parseInt(digits || '6', 10),
            algorithm: 'SHA1',
            steam
        };
    }
    const kp2 = timeOtp ? timeOtpConfig(timeOtp) : null;
    if (kp2) return kp2;
    if (otp) throw new OtpError('Unknown TOTP format', 'e.otp.format');
    return null;
}

/** otpauth URI for settings, in KeePassXC's form: Base32 secret, period, digits, the algorithm unless SHA-1, encoder=steam. */
export function otpauthUri(cfg, label) {
    const algo = cfg.algorithm === 'SHA1' ? '' : '&algorithm=' + cfg.algorithm;
    return `otpauth://totp/${encodeURIComponent(label || 'KeePass')}?secret=${base32Encode(cfg.secret)}&period=${cfg.period}&digits=${cfg.steam ? 5 : cfg.digits}${algo}${cfg.steam ? '&encoder=steam' : ''}`;
}

/** 31-bit value from the RFC 4226 truncation -> 5 characters, lowest "digit" first. */
export function steamCode(bin) {
    let s = '';
    for (let i = 0; i < 5; i++) { s += STEAM[bin % STEAM.length]; bin = Math.floor(bin / STEAM.length); }
    return s;
}

export async function totp(config, nowMs = Date.now()) {
    const algo = HMAC[normalizeAlgorithm(config.algorithm)];
    const counter = Math.floor(nowMs / 1000 / config.period);
    const msg = new ArrayBuffer(8);
    const dv = new DataView(msg);
    dv.setUint32(0, Math.floor(counter / 0x100000000));
    dv.setUint32(4, counter >>> 0);
    const key = await crypto.subtle.importKey('raw', config.secret, { name: 'HMAC', hash: algo }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const off = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    const code = config.steam ? steamCode(bin) : String(bin % 10 ** config.digits).padStart(config.digits, '0');
    const remaining = config.period - (Math.floor(nowMs / 1000) % config.period);
    return { code, remaining };
}
