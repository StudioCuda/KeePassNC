// Kleine, DOM-freie Hilfen (auch in Node-Tests verwendbar).
export function valueText(v) {
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : v.getText();
}
export const fieldOf = (entry, name) => valueText(entry.fields.get(name));

export function domainOf(url) {
    try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Link-Ziel fuer einen URL-Feldwert: http(s) wie eingegeben, ein nackter Hostname wie "example.com/login" mit https://;
 *  alles andere (cmd://, javascript:, {REF:…}, freier Text) bleibt Text. bare=false nimmt nur Werte mit http(s)-Schema. */
export function openableUrl(text, { bare = true } = {}) {
    const s = String(text ?? '').trim();
    if (!s || /\s/.test(s)) return null;
    const href = /^https?:\/\//i.test(s) ? s : bare && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*(:\d{1,5})?([/?#]\S*)?$/i.test(s) ? 'https://' + s : null;
    if (!href) return null;
    try { return new URL(href).hostname ? href : null; } catch { return null; }
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
const REF_FIELDS = { T: 'Title', U: 'UserName', P: 'Password', A: 'URL', N: 'Notes' };
const STANDARD_FIELDS = new Set(Object.values(REF_FIELDS));
/** UUID eines Eintrags als Hex in Grossbuchstaben, wie sie in Feldreferenzen steht. */
export const uuidHex = (uuid) => [...atob(String(uuid))].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
/**
 * Loest Feldreferenzen {REF:<Feld>@<Suchfeld>:<Text>} auf wie KeePass, auch geschachtelt (bis Tiefe 10, Zyklen enden dort).
 * Feld: T U P A N oder I (UUID); Suchfeld zusaetzlich O (eigene Felder). @I sucht die UUID, sonst gilt der erste Eintrag, dessen
 * Feld den Text enthaelt (ohne Gross-/Kleinschreibung). Was sich nicht aufloesen laesst, bleibt als {REF:…} stehen.
 */
export function resolveRefs(text, entries, depth = 0) {
    if (!text.includes('{REF:') || depth >= 10) return text;
    return text.replace(/\{REF:([TUPANI])@([TUPANIO]):([^}]*)\}/g, (ref, want, by, needle) => {
        const hit = findRefTarget(entries, by, needle);
        if (!hit) return ref;
        return want === 'I' ? uuidHex(hit.uuid) : resolveRefs(fieldOf(hit, REF_FIELDS[want]), entries, depth + 1);
    });
}
function findRefTarget(entries, by, needle) {
    if (by === 'I' && !/^[0-9a-f]{32}$/i.test(needle)) return null;
    const id = by === 'I' ? btoa(needle.match(/../g).map((x) => String.fromCharCode(parseInt(x, 16))).join('')) : null; // KdbxUuid.id ist Base64
    const n = needle.toLowerCase(), has = (v) => valueText(v).toLowerCase().includes(n);
    for (const e of entries) {
        if (id ? String(e.uuid) === id
            : by === 'O' ? [...e.fields].some(([k, v]) => !STANDARD_FIELDS.has(k) && has(v)) : has(e.fields.get(REF_FIELDS[by]))) return e;
    }
    return null;
}
export const isSystemField =(name) => /^(KPEX_PASSKEY_|KPXC_PASSKEY_|KPH: |TimeOtp-)/.test(name) || ['otp', 'TOTP Seed', 'TOTP Settings'].includes(name);

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
const TEXT_FILE = /\.(txt|md|log|csv|tsv|json|xml|ya?ml|ini|conf|cfg|toml|pem|crt|cer|key|pub|asc|ovpn|env|sh)$/i;
/** Welche Vorschau ein Anhang bekommt: 'image', 'text' oder null (zu gross oder unbekannte Art). Nur nach Name und Groesse. */
export function previewKind(name, size) {
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (IMAGE_TYPES[ext]) return size <= 8 * 1024 * 1024 ? 'image' : null;
    return (TEXT_FILE.test(name) || !ext) && size <= 1024 * 1024 ? 'text' : null;
}
/**
 * Inhalt fuer die Vorschau: {image: data:-URL} oder {text}; null, wenn ein "Text" doch keiner ist (kein gueltiges UTF-8, Nullbytes).
 * SVG landet nur in einem <img>, wo es keine Skripte ausfuehrt.
 */
export function previewOf(name, bytes) {
    const kind = previewKind(name, bytes.byteLength);
    if (kind === 'image') {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { image: `data:${IMAGE_TYPES[name.split('.').pop().toLowerCase()]};base64,${btoa(bin)}` };
    }
    if (kind === 'text') {
        try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return text.includes('\0') ? null : { text };
        } catch { return null; }
    }
    return null;
}

/** Hintergrundfarbe eines Eintrags (KeePass: "#RRGGBB" in BackgroundColor) in Kleinbuchstaben, sonst null. */
export const entryColor = (entry) => (/^#[0-9a-f]{6}$/i.test(entry?.bgColor || '') ? entry.bgColor.toLowerCase() : null);
/** Farben zur Auswahl im Editor; eine andere, schon gesetzte Farbe bleibt zusaetzlich waehlbar. */
export const ENTRY_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
