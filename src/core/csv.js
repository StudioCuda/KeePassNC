// Read and write CSV (RFC 4180: commas, quotes, line breaks inside fields) and map the columns of the usual
// password managers to KeePass fields. Export uses the KeePassXC format, which KeePass, Bitwarden & co. can read.

/** Text -> rows of fields. Empty rows are dropped; so is a leading BOM. */
export function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const s = text.replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quoted) {
            if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some((f) => f !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
}

/** Rows -> CSV, every field quoted (like KeePassXC), CRLF line endings. */
export const toCsv = (rows) => rows.map((r) => r.map((f) => `"${String(f ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';

// Column names of the known exports (lower case): KeePassXC, KeePass 2, Bitwarden, 1Password, Chrome/Edge/Brave, Firefox, LastPass, Proton Pass
const COLUMNS = {
    group: ['group', 'folder', 'grouping', 'vault'],
    title: ['title', 'name', 'account'],
    user: ['username', 'login_username', 'login name', 'user', 'login'],
    email: ['email'], // only used when there is no user name (Proton Pass)
    password: ['password', 'login_password'],
    url: ['url', 'login_uri', 'web site', 'website', 'uri'],
    notes: ['notes', 'note', 'comments', 'extra'],
    totp: ['totp', 'login_totp', 'otpauth', 'otp'],
    tags: ['tags']
};

/**
 * Maps the header row and returns {entries, ignored, refs}. entries: [{path: string[], title, user, password, url, notes, totp, tags: string[]}],
 * ignored: columns that fit nowhere. With KeePassXC the root group name leads the path; it is dropped.
 * refs: entries with a {REF:…} to another entry. A file from elsewhere has no business pointing at your other entries (it could
 * pull their password into a login form), so the reference is broken up to plain text; KeePassXC's own export resolves them anyway.
 * Without a title (Firefox), the hostname of the URL is used.
 */
export function mapRows([head = [], ...rows]) {
    const names = head.map((x) => x.trim().toLowerCase());
    const col = {};
    for (const [field, aliases] of Object.entries(COLUMNS)) {
        const i = aliases.map((a) => names.indexOf(a)).find((n) => n >= 0);
        if (i !== undefined) col[field] = i;
    }
    const ignored = head.filter((_, i) => !Object.values(col).includes(i) && rows.some((r) => (r[i] || '').trim()));
    const keepassxc = names[col.group] === 'group';
    let refs = 0;
    const entries = rows.map((r) => {
        let hit = false;
        const get = (f) => {
            const v = col[f] === undefined ? '' : r[col[f]] ?? '';
            if (!/\{REF:/i.test(v)) return v;
            hit = true;
            return v.replace(/\{REF:/gi, '{ REF:');
        };
        const path = get('group').split('/').map((p) => p.trim()).filter(Boolean);
        if (keepassxc) path.shift();
        const url = get('url').trim();
        let title = get('title').trim();
        if (!title && url) try { title = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname; } catch { title = url; }
        const entry = { path, title, user: get('user') || get('email'), password: get('password'), url, notes: get('notes'), totp: get('totp').trim(), tags: get('tags').split(/[,;]/).map((x) => x.trim()).filter(Boolean) };
        if (hit) refs++;
        return entry;
    });
    return { entries, ignored, refs };
}

/** otpauth URI of an entry: the "otp" field, or built from the old "TOTP Seed"/"TOTP Settings" fields; otherwise ''. */
export function otpUri(title, otp, seed, settings) {
    if (otp) return otp;
    if (!seed) return '';
    const [period = '30', digits = '6'] = (settings || '').split(';');
    const steam = digits.trim().toUpperCase() === 'S';
    return `otpauth://totp/${encodeURIComponent(title || 'KeePass')}?secret=${seed.replace(/\s/g, '')}&period=${period.trim()}&digits=${steam ? 5 : digits.trim()}${steam ? '&encoder=steam' : ''}`;
}

export const EXPORT_HEAD = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'TOTP', 'Icon', 'Last Modified', 'Created'];
