// Search syntax modelled on KeePassXC:  [modifier][field:]value  - terms separated by spaces (AND), "in quotes" to include spaces.
// Modifiers: - or ! (exclude), + (exact, case-sensitive), * (regular expression). Wildcards without the * modifier: * ? |
// Fields (a prefix is enough): title, username, url, notes, password, tag, group, attribute/_name, attachment, is, has, uuid.
import { fieldOf, groupPath, entryExpiry, daysUntil, hasTotp, isPasskey } from './util.js';

const FIELDS = ['attachment', 'attribute', 'notes', 'password', 'title', 'username', 'url', 'group', 'tag', 'is', 'has', 'uuid'];

export function tokenize(q) {
    const out = [];
    const re = /(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*")+/g;
    for (const m of q.matchAll(re)) out.push(m[0]);
    return out;
}
const unquote = (s) => s.replace(/"((?:[^"\\]|\\.)*)"/g, '$1').replace(/\\(.)/g, '$1');

function wildcardToRegex(v) {
    const parts = v.split('|').map((p) => p.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));
    return new RegExp(parts.join('|'), 'i');
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
        const m = /^(_?[A-Za-z]+):(.*)$/s.exec(raw);
        if (m) {
            if (m[1][0] === '_') { field = 'custom'; custom = m[1].slice(1); raw = m[2]; }
            else {
                const f = FIELDS.find((x) => x.startsWith(m[1].toLowerCase()));
                if (f) { field = f; raw = m[2]; }
            }
        }
        const value = unquote(raw);
        let re = null;
        if (regex) { try { re = new RegExp(value, exact ? '' : 'i'); } catch { re = /$^/; } }
        else if (!exact && /[*?|]/.test(value)) re = wildcardToRegex(value);
        terms.push({ neg, exact, field, custom, value, re, lower: value.toLowerCase() });
    }
    return terms;
}

function textMatches(t, text) {
    if (t.re) return t.re.test(text);
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
