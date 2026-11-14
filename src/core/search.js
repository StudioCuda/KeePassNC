// Search syntax modelled on KeePassXC:  [modifier][field:]value  - terms separated by spaces (AND), "in quotes" to include spaces.
// Modifiers: - or ! (exclude), + (exact, case-sensitive), * (regular expression). Wildcards without the * modifier: * ? |
// Fields (a prefix is enough): title, username, url, notes, password, tag, group, attribute, attachment, is, has, uuid.
// _Name: is the custom field Name (the whole name, in any case); "quotes" or \ for a name with spaces or colons: _"KPH: Extra URL":x
import { fieldOf, groupPath, entryExpiry, daysUntil, hasTotp, isPasskey } from './util.js';

const FIELDS = ['attachment', 'attribute', 'notes', 'password', 'title', 'username', 'url', 'group', 'tag', 'is', 'has', 'uuid'];

export function tokenize(q) {
    const out = [];
    const re = /(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*")+/g;
    for (const m of q.matchAll(re)) out.push(m[0]);
    return out;
}
// In one pass, so an escaped quote can't pair up with a real one. A regular expression keeps its escapes (\d, \.), everything
// else loses the backslash.
const unquote = (s) => s.replace(/\\(.)|"/gs, (m, c) => c ?? '');
const stripQuotes = (s) => s.replace(/\\.|"/gs, (m) => (m === '"' ? '' : m));
// field:value - a standard field (letters, the start is enough) or _ and a custom field's name: anything up to the first colon
// outside quotes, so KP2A_URL_1, _PIN2 and "Security Question" work too.
const FIELD_RE = /^(?:_((?:[^\s:"\\]|\\.|"(?:[^"\\]|\\.)*")+)|([A-Za-z]+)):(.*)$/s;

// Wildcards run on a small automaton, not on a RegExp: a*a*b as /a.*a.*b/i backtracks for minutes over a big field (a shared
// database can bring one along), this takes field length x pattern length at worst. The meaning is exactly that RegExp's:
// anywhere in the field, case folded like /i, * any run and ? one UTF-16 unit but neither across a line break, | for "or".
const ANY = -1, STAR = -2;
let FOLD = null;
/** Case folding of a RegExp with the i flag (no u): a unit's upper case if that is one unit, but never from beyond ASCII into it.
 *  The whole table at once (5 ms, 128 KB) rather than a cache: that would remember which characters the searched fields hold. */
function foldTable() {
    if (!FOLD) {
        FOLD = new Uint16Array(65536);
        for (let c = 0; c < 65536; c++) { const u = String.fromCharCode(c).toUpperCase(); FOLD[c] = u.length === 1 && (c < 128 || u.charCodeAt(0) >= 128) ? u.charCodeAt(0) : c; }
    }
    return FOLD;
}
const isBreak = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029; // what "." doesn't match

/** One array per alternative: folded code units, ANY for ?, STAR for a run of *. */
function compileGlob(v) {
    const fold = foldTable();
    return v.split('|').map((alt) => {
        const out = [];
        for (let i = 0; i < alt.length; i++) {
            const c = alt.charCodeAt(i), tok = c === 42 ? STAR : c === 63 ? ANY : fold[c];
            if (tok !== STAR || out[out.length - 1] !== STAR) out.push(tok);
        }
        return out;
    });
}

/** Does alternative p occur anywhere in text? on[i]: p up to i matches the text up to here. 0 is always on (not anchored). */
function globFind(p, text) {
    const n = p.length, fold = foldTable();
    let on = new Uint8Array(n + 1), next = new Uint8Array(n + 1);
    const close = (s) => { s[0] = 1; for (let i = 0; i < n; i++) if (s[i] && p[i] === STAR) s[i + 1] = 1; return s[n] === 1; }; // * may match nothing
    if (close(on)) return true;
    for (let k = 0; k < text.length; k++) {
        const c = text.charCodeAt(k), f = fold[c], br = isBreak(c);
        next.fill(0);
        for (let i = 0; i < n; i++) {
            if (!on[i]) continue;
            const tok = p[i];
            if (tok === STAR) { if (!br) next[i] = 1; }
            else if (tok === ANY ? !br : tok === f) next[i + 1] = 1;
        }
        if (close(next)) return true;
        const swap = on; on = next; next = swap;
    }
    return false;
}

export function parseQuery(q) {
    const terms = [];
    for (const raw0 of tokenize(q || '')) {
        let raw = raw0, neg = false, exact = false, regex = false;
        for (;;) {
            if ((raw[0] === '-' || raw[0] === '!') && raw.length > 1) { neg = true; raw = raw.slice(1); }
            else if (raw[0] === '+' && raw.length > 1) { exact = true; raw = raw.slice(1); }
            else if (raw[0] === '*' && raw.length > 1) { regex = true; raw = raw.slice(1); }
            else break;
        }
        let field = null, custom = null;
        const m = FIELD_RE.exec(raw);
        if (m) {
            if (m[1] !== undefined) { field = 'custom'; custom = unquote(m[1]); raw = m[3]; }
            else {
                const f = FIELDS.find((x) => x.startsWith(m[2].toLowerCase()));
                if (f) { field = f; raw = m[3]; }
            }
        }
        const value = regex ? stripQuotes(raw) : unquote(raw);
        let re = null, glob = null, invalid = false;
        if (regex) { try { re = new RegExp(value, exact ? '' : 'i'); } catch { invalid = true; } } // matches nothing, not even an empty field
        else if (!exact && /[*?|]/.test(value)) glob = compileGlob(value);
        terms.push({ neg, exact, field, custom, value, re, glob, invalid, lower: value.toLowerCase() });
    }
    return terms;
}

/** The first regular expression in q that doesn't compile (the list says so instead of just "No matches"), or null. */
export function invalidRegex(q) {
    const bad = parseQuery(q).find((x) => x.invalid);
    return bad ? bad.value : null;
}

function textMatches(t, text) {
    if (t.invalid) return false;
    if (t.re) return t.re.test(text);
    if (t.glob) return t.glob.some((p) => globFind(p, text));
    if (t.exact) return text === t.value;
    return text.toLowerCase().includes(t.lower);
}

/** ctx: {isWeak?: (entry) => boolean, now?: number} */
export function matches(entry, terms, ctx = {}) {
    for (const t of terms) {
        let hit;
        switch (t.field) {
            case null: hit = ['Title', 'UserName', 'URL', 'Notes'].some((k) => textMatches(t, fieldOf(entry, k))) || (entry.tags || []).some((x) => textMatches(t, x)); break;
            case 'title': hit = textMatches(t, fieldOf(entry, 'Title')); break;
            case 'username': hit = textMatches(t, fieldOf(entry, 'UserName')); break;
            case 'url': hit = textMatches(t, fieldOf(entry, 'URL')); break;
            case 'notes': hit = textMatches(t, fieldOf(entry, 'Notes')); break;
            case 'password': hit = textMatches(t, fieldOf(entry, 'Password')); break;
            case 'tag': hit = (entry.tags || []).some((x) => textMatches(t, x)); break;
            case 'group': hit = t.value.includes('/') ? textMatches(t, '/' + groupPath(entry.parentGroup)) || textMatches(t, groupPath(entry.parentGroup)) : textMatches(t, entry.parentGroup?.name || ''); break;
            case 'custom': hit = [...entry.fields].some(([k, v]) => k.toLowerCase() === t.custom.toLowerCase() && textMatches(t, typeof v === 'string' ? v : v.getText())); break;
            case 'attribute': hit = [...entry.fields.keys()].some((k) => textMatches(t, k)); break;
            case 'attachment': hit = [...entry.binaries.keys()].some((k) => textMatches(t, k)); break;
            case 'uuid': hit = textMatches(t, entry.uuid.id) || textMatches(t, entry.uuid.toString?.() || ''); break;
            case 'has': {
                const v = t.lower;
                hit = (v === 'totp' || v === 'otp') ? hasTotp(entry) : (v === 'passkey' || v === 'passkeys') ? isPasskey(entry)
                    : v.startsWith('att') ? entry.binaries.size > 0 : v === 'tags' ? (entry.tags || []).length > 0 : v === 'url' ? !!fieldOf(entry, 'URL')
                    : v === 'notes' ? !!fieldOf(entry, 'Notes') : v === 'history' ? entry.history.length > 0 : false;
                break;
            }
            case 'is': {
                const v = t.lower;
                const exp = entryExpiry(entry);
                const d = exp ? daysUntil(exp, ctx.now) : null;
                const mm = /^expired(?:-(\d+))?$/.exec(v);
                if (mm) hit = d !== null && (mm[1] ? d <= Number(mm[1]) : d <= 0);
                else if (v === 'weak') hit = !!ctx.isWeak?.(entry);
                else hit = false;
                break;
            }
            default: hit = false;
        }
        if (t.neg ? hit : !hit) return false;
    }
    return true;
}
