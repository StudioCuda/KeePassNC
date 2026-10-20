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
 * Loest Platzhalter auf wie KeePass und KeePassXC, auch geschachtelt (bis Tiefe 10, Zyklen enden dort):
 * - {REF:<Feld>@<Suchfeld>:<Text>}: Feld eines anderen Eintrags. Feld: T U P A N oder I (UUID); Suchfeld zusaetzlich O (eigene Felder).
 *   @I sucht die UUID, sonst gilt der erste Eintrag, dessen Feld den Text enthaelt (ohne Gross-/Kleinschreibung).
 * - {TITLE} {USERNAME} {PASSWORD} {URL} {NOTES} und {S:Name} (eigenes Feld): aus `entry` selbst.
 * - {URL:RMVSCM} {URL:SCM} {URL:HOST} {URL:PORT} {URL:PATH} {URL:QUERY} {URL:USERINFO} {URL:USERNAME} {URL:PASSWORD}: Teile der eigenen URL.
 * Gross-/Kleinschreibung der Namen egal. Was sich nicht aufloesen laesst, bleibt stehen. Ohne entry gelten nur die {REF:…}.
 *
 * secrets: false laesst Platzhalter stehen, die ein Geheimnis einsetzen wuerden (das Passwort oder ein geschuetztes Feld, auch ueber
 * {REF:P@…} aus einem anderen Eintrag). Fuer alles, was eine Adresse anzeigt: Ein importierter oder zusammengefuehrter Eintrag mit der
 * URL "https://evil.example/?p={REF:P@T:}" wuerde sonst einen Link mit fremdem Passwort ergeben.
 * secrets: 'own' setzt nur die Geheimnisse von `entry` selbst ein ({PASSWORD}, {S:PIN}), fuer Oeffnen und Kopieren: Die kennt, wer den
 * Eintrag geschrieben hat. Geheimnisse anderer Eintraege bleiben stehen, auch wenn das eigene Passwort selbst {REF:P@…} ist.
 */
export function resolvePlaceholders(text, entry, entries, { secrets = true } = {}) {
    return resolve(text, entry, entries, secrets, entry, 0);
}
/** Passwort oder geschuetztes Feld (ProtectedValue; ungeschuetzte Felder sind Strings). */
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
/** Nur die {REF:…} (wie resolvePlaceholders ohne eigenen Eintrag). */
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
