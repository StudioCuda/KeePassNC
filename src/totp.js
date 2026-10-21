// TOTP (RFC 6238) via WebCrypto. Supports otpauth:// URLs (KeePassXC standard) and the older
// KeePass fields "TOTP Seed" / "TOTP Settings" ("30;6").
// Steam Guard: same calculation, but 5 characters from its own alphabet. Detected by "encoder=steam" (otpauth) or "30;S" (old).

/** Error with an i18n key (like VaultError): the UI shows it via errText() in the chosen language. */
export class OtpError extends Error {
    constructor(message, key, vars) { super(message); this.key = key; this.vars = vars; }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM = '23456789BCDFGHJKMNPQRTVWXY';

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

export function parseOtpConfig(otpField, seedField, settingsField) {
    if (otpField && /^otpauth:\/\//i.test(otpField.trim())) {
        const u = new URL(otpField.trim());
        const p = u.searchParams;
        if (u.hostname.toLowerCase() !== 'totp') throw new OtpError('Only TOTP is supported', 'e.otp.type');
        const secret = p.get('secret');
        if (!secret) throw new OtpError('otpauth URL without a secret', 'e.otp.secret');
        const steam = (p.get('encoder') || '').toLowerCase() === 'steam';
        return {
            secret: base32Decode(secret),
            period: parseInt(p.get('period') || '30', 10),
            digits: steam ? 5 : parseInt(p.get('digits') || '6', 10),
            algorithm: (p.get('algorithm') || 'SHA1').toUpperCase(),
            steam
        };
    }
    if (seedField) {
        const [period, digits] = (settingsField || '30;6').split(';');
        const steam = (digits || '').trim().toUpperCase() === 'S';
        return {
            secret: base32Decode(seedField),
            period: parseInt(period || '30', 10),
            digits: steam ? 5 : parseInt(digits || '6', 10),
            algorithm: 'SHA1',
            steam
        };
    }
    return null;
}

/** 31-bit value from the RFC 4226 truncation -> 5 characters, lowest "digit" first. */
export function steamCode(bin) {
    let s = '';
    for (let i = 0; i < 5; i++) { s += STEAM[bin % STEAM.length]; bin = Math.floor(bin / STEAM.length); }
    return s;
}

export async function totp(config, nowMs = Date.now()) {
    const algo = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[config.algorithm];
    if (!algo) throw new OtpError('Unsupported TOTP algorithm: ' + config.algorithm, 'e.otp.algo', { algo: config.algorithm });
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
