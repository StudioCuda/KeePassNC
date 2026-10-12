// Kleine, DOM-freie Hilfen (auch in Node-Tests verwendbar).
export function valueText(v) {
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : v.getText();
}
export const fieldOf = (entry, name) => valueText(entry.fields.get(name));

export function domainOf(url) {
    try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const DAY = 86400000;
export function daysUntil(date, now = Date.now()) { return date ? Math.ceil((date.getTime() - now) / DAY) : null; }

export function entryExpiry(entry) {
    return entry.times?.expires && entry.times.expiryTime ? entry.times.expiryTime : null;
}
export function groupPath(group) {
    const parts = [];
    for (let g = group; g && g.parentGroup; g = g.parentGroup) parts.unshift(g.name || '');
    return parts.join('/');
}
/** Felder, aus denen ein Passkey besteht (KeePassXC: KPEX_PASSKEY_*; KPXC_PASSKEY_* wie in isSystemField mitgefuehrt). */
export const isPasskeyField = (name) => /^(KPEX|KPXC)_PASSKEY_/.test(name);
export const isPasskey = (entry) => entry.fields.has('KPEX_PASSKEY_CREDENTIAL_ID') || entry.fields.has('KPEX_PASSKEY_PRIVATE_KEY_PEM');
export const hasTotp = (entry) => entry.fields.has('otp') || entry.fields.has('TOTP Seed') || [...entry.fields.keys()].some((k) => k.startsWith('TimeOtp-'));
/** Felder, die der Editor nicht als freie Zusatzfelder zeigt (eigene Darstellung bzw. Programmdaten); sie bleiben beim Bearbeiten unveraendert erhalten. */
/** Erkennt "Arbeitsspeicher reicht nicht" aus WebAssembly/Argon2; die Browser melden das uneinheitlich (RangeError, RuntimeError, Textmeldungen). */
export const isOutOfMemory = (e) => !!e && (e instanceof RangeError
    || (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError)
    || /out of memory|could not allocate|allocation failed|maximum memory|memory.*(grow|alloc)/i.test(String(e.message || e)));
export const isSystemField =(name) => /^(KPEX_PASSKEY_|KPXC_PASSKEY_|KPH: |TimeOtp-)/.test(name) || ['otp', 'TOTP Seed', 'TOTP Settings'].includes(name);
