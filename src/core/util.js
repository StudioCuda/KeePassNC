// Small DOM-free helpers (also usable in Node tests).
export function valueText(v) {
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : v.getText();
}
export const fieldOf = (entry, name) => valueText(entry.fields.get(name));

export function domainOf(url) {
    try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Link target for a URL field value: http(s) as entered, a bare hostname like "example.com/login" with https://;
 *  everything else (cmd://, javascript:, {REF:…}, free text) stays text. bare=false only accepts values with an http(s) scheme. */
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
/** Fields that make up a passkey (KeePassXC: KPEX_PASSKEY_*; KPXC_PASSKEY_* carried along as in isSystemField). */
export const isPasskeyField = (name) => /^(KPEX|KPXC)_PASSKEY_/.test(name);
export const isPasskey = (entry) => entry.fields.has('KPEX_PASSKEY_CREDENTIAL_ID') || entry.fields.has('KPEX_PASSKEY_PRIVATE_KEY_PEM');
export const hasTotp = (entry) => entry.fields.has('otp') || entry.fields.has('TOTP Seed') || [...entry.fields.keys()].some((k) => k.startsWith('TimeOtp-'));
/** Fields the editor doesn't show as free extra fields (own display or program data); they are kept unchanged when editing. */
/** Detects "not enough memory" from WebAssembly/Argon2; browsers report it inconsistently (RangeError, RuntimeError, text messages). */
export const isOutOfMemory = (e) => !!e && (e instanceof RangeError
    || (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError)
    || /out of memory|could not allocate|allocation failed|maximum memory|memory.*(grow|alloc)/i.test(String(e.message || e)));
const REF_FIELDS = { T: 'Title', U: 'UserName', P: 'Password', A: 'URL', N: 'Notes' };
const STANDARD_FIELDS = new Set(Object.values(REF_FIELDS));
/** UUID of an entry as uppercase hex, as it appears in field references. */
export const uuidHex = (uuid) => [...atob(String(uuid))].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
/**
 * Resolves placeholders like KeePass and KeePassXC, also nested (up to depth 10, cycles end there):
 * - {REF:<field>@<search field>:<text>}: field of another entry. Field: T U P A N or I (UUID); search field additionally O (custom fields).
 *   @I looks up the UUID, otherwise the first entry whose field contains the text applies (case-insensitive).
 * - {TITLE} {USERNAME} {PASSWORD} {URL} {NOTES} and {S:Name} (custom field): from `entry` itself.
 * - {URL:RMVSCM} {URL:SCM} {URL:HOST} {URL:PORT} {URL:PATH} {URL:QUERY} {URL:USERINFO} {URL:USERNAME} {URL:PASSWORD}: parts of the entry's own URL.
 * Names are case-insensitive. Whatever can't be resolved stays as it is. Without entry only the {REF:…} apply.
 *
 * secrets: false leaves placeholders that would insert a secret (the password or a protected field, also via {REF:P@…} from another
 * entry) as they are. For everything that shows a URL: an imported or merged entry with the URL "https://evil.example/?p={REF:P@T:}"
 * would otherwise produce a link with another entry's password in it.
 * secrets: 'own' inserts only the secrets of `entry` itself ({PASSWORD}, {S:PIN}), for opening and copying: whoever wrote the entry
 * knows them. Other entries' secrets stay as they are, also when the own password is itself a {REF:P@…}.
 */
export function resolvePlaceholders(text, entry, entries, { secrets = true } = {}) {
    return resolve(text, entry, entries, secrets, entry, 0);
}
/** Password or protected field (ProtectedValue; unprotected fields are strings). */
const isSecretField = (e, name) => name === 'Password' || (e.fields.get(name) != null && typeof e.fields.get(name) !== 'string');
function resolve(text, entry, entries, secrets, owner, depth) {
    if (!text.includes('{') || depth >= 10) return text;
    const allowed = (e, name) => secrets === true || !isSecretField(e, name) || (secrets === 'own' && e === owner);
    const field = (e, name, all) => (allowed(e, name) ? resolve(fieldOf(e, name), e, entries, secrets, owner, depth + 1) : all);
    return text.replace(/\{([^{}]+)\}/g, (all, inner) => {
        const ref = /^REF:([TUPANI])@([TUPANIO]):(.*)$/i.exec(inner);
        if (ref) {
            const hit = findRefTarget(entries, ref[2].toUpperCase(), ref[3]);
            if (!hit) return all;
            const want = ref[1].toUpperCase();
            return want === 'I' ? uuidHex(hit.uuid) : field(hit, REF_FIELDS[want], all);
        }
        if (!entry) return all;
        const key = inner.toUpperCase();
        if (OWN_FIELDS[key]) return field(entry, OWN_FIELDS[key], all);
        if (key.startsWith('S:')) {
            const name = inner.slice(2), lower = name.toLowerCase();
            const hit = entry.fields.has(name) ? name : [...entry.fields.keys()].find((k) => k.toLowerCase() === lower);
            return hit === undefined ? all : field(entry, hit, all);
        }
        if (key.startsWith('URL:')) {
            const part = urlPart(field(entry, 'URL', ''), key.slice(4));
            return part === null ? all : part;
        }
        return all;
    });
}
/** Only the {REF:…} (like resolvePlaceholders without an own entry). */
export const resolveRefs = (text, entries) => resolvePlaceholders(text, null, entries);
const OWN_FIELDS = { TITLE: 'Title', USERNAME: 'UserName', PASSWORD: 'Password', URL: 'URL', NOTES: 'Notes' };
function urlPart(url, part) {
    let u;
    try { u = new URL(url); } catch { return part === 'RMVSCM' ? url.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '') : null; }
    const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password);
    const parts = {
        RMVSCM: url.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, ''), SCM: u.protocol.replace(/:$/, ''), HOST: u.hostname, PORT: u.port,
        PATH: u.pathname, QUERY: u.search, USERINFO: user + (pass ? ':' + pass : ''), USERNAME: user, PASSWORD: pass
    };
    return parts[part] ?? null;
}
function findRefTarget(entries, by, needle) {
    if (by === 'I' && !/^[0-9a-f]{32}$/i.test(needle)) return null;
    const id = by === 'I' ? btoa(needle.match(/../g).map((x) => String.fromCharCode(parseInt(x, 16))).join('')) : null; // KdbxUuid.id is Base64
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
/** Which preview an attachment gets: 'image', 'text' or null (too large or unknown kind). Based on name and size only. */
export function previewKind(name, size) {
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (IMAGE_TYPES[ext]) return size <= 8 * 1024 * 1024 ? 'image' : null;
    return (TEXT_FILE.test(name) || !ext) && size <= 1024 * 1024 ? 'text' : null;
}
/**
 * Content for the preview: {image: data: URL} or {text}; null if a "text" turns out not to be one (invalid UTF-8, null bytes).
 * SVG only ends up in an <img>, where it doesn't run scripts.
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

/** Tags typed into a field: separated by comma or semicolon, trimmed, empty ones dropped. */
export const splitTags = (text) => String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
/** Tags after adding and removing some (exact spelling), without duplicates and sorted like the editor saves them. */
export function editTags(tags, { add = [], remove = [] } = {}) {
    const drop = new Set(remove);
    return [...new Set([...(tags || []), ...add].map((x) => x.trim()).filter((x) => x && !drop.has(x)))].sort((a, b) => a.localeCompare(b));
}

/** Background colour of an entry (KeePass: "#RRGGBB" in BackgroundColor) in lowercase, otherwise null. */
export const entryColor = (entry) => (/^#[0-9a-f]{6}$/i.test(entry?.bgColor || '') ? entry.bgColor.toLowerCase() : null);
/** Colours to choose from in the editor; another colour that is already set stays selectable as well. */
export const ENTRY_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
