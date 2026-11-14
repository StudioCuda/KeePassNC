// Read and write CSV (RFC 4180: commas, quotes, line breaks inside fields; reading also takes semicolons, tabs and pipes) and map the columns of the usual
// password managers to KeePass fields. Export uses the KeePassXC format, which KeePass, Bitwarden & co. can read.
import { splitTags } from './util.js';

// Delimiters a CSV file may use: a German (or most other European) Excel writes semicolons, "Text (tab delimited)" tabs.
// The order breaks ties: the comma first, as in RFC 4180 and every known export.
const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Rows of `s` with delimiter `sep`; stops after `limit` rows. A quote only counts at the start of a field (spaces before it are
 * fine); one in the middle of a field is a plain character, like in Excel and LibreOffice, so `pass"word` can't open a quoted
 * field that swallows the rows after it. A quote that opens a field but is never closed is a character too, and reading goes on
 * right behind it, so the rest of the file doesn't end up in that one field.
 */
function rowsOf(s, sep, limit = Infinity) {
    const rows = [];
    let row = [], field = '', quoted = false, start = true, open = 0, before = '';
    for (let i = 0; ; i++) {
        if (i >= s.length) {
            if (!quoted) break;
            field = before + '"'; i = open; quoted = false; // back to the quote that never closed; the loop goes on right behind it
            continue;
        }
        const c = s[i];
        if (quoted) {
            if (c !== '"') field += c;
            else if (s[i + 1] === '"') { field += '"'; i++; }
            else quoted = false;
        } else if (c === sep) { row.push(field); field = ''; start = true; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = ''; start = true;
            if (row.some((f) => f !== '')) rows.push(row);
            if (rows.length >= limit) return rows;
            row = [];
        } else if (c === '"' && start) { quoted = true; start = false; open = i; before = field; }
        else { field += c; if (c !== ' ' && c !== '\t') start = false; }
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
}

/** The delimiter that splits the header (the first non-empty row) into the most fields, outside quotes; a tie goes to the earlier one. */
function csvDelimiter(s) {
    let best = DELIMITERS[0], most = 0;
    for (const d of DELIMITERS) {
        const n = rowsOf(s, d, 1)[0]?.length ?? 0;
        if (n > most) { best = d; most = n; }
    }
    return best;
}

/** Text -> rows of fields, with the delimiter of the header line (see csvDelimiter). Empty rows are dropped; so is a leading BOM. */
export function parseCsv(text) {
    const s = text.replace(/^﻿/, '');
    return rowsOf(s, csvDelimiter(s));
}

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
/**
 * Rows -> CSV, every field quoted (like KeePassXC), CRLF line endings.
 * neutralize: a spreadsheet would evaluate a cell that starts with = + - @ (or a tab/CR), so it gets a leading apostrophe (OWASP's
 * advice for CSV injection). Off by default: it changes the data, and the app's own import would read the apostrophe back.
 * Plain numbers like -1 stay as they are (keepNumbers).
 */
export const toCsv = (rows, { neutralize = false, keepNumbers = true } = {}) =>
    rows.map((r) => r.map((f) => {
        let s = String(f ?? '');
        if (neutralize && FORMULA.test(s) && !(keepNumbers && NUMBER.test(s))) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
    }).join(',')).join('\r\n') + '\r\n';

// Column names of the known exports (lower case): KeePassXC, KeePass 2, Bitwarden, 1Password, Chrome/Edge/Brave, Firefox, LastPass, Proton Pass,
// Nextcloud Passwords (German headers: its CSV export uses the language of whoever exports) and Passman
const COLUMNS = {
    group: ['group', 'folder', 'grouping', 'vault', 'ordner'],
    title: ['title', 'name', 'account', 'label'],
    user: ['username', 'login_username', 'login name', 'user', 'login', 'benutzer'],
    email: ['email'], // only used when there is no user name (Proton Pass, Passman)
    password: ['password', 'login_password', 'passwort'],
    url: ['url', 'login_uri', 'web site', 'website', 'uri', 'webseite'],
    notes: ['notes', 'note', 'comments', 'extra', 'notizen', 'description'],
    totp: ['totp', 'login_totp', 'otpauth', 'otp'],
    tags: ['tags']
};

const EMPTY = /^(null|\[\]|\{\})$/; // what Passman writes for "nothing"

/**
 * A file from elsewhere has no business pointing at your other entries ({REF:…} would pull their password into a login form),
 * so a reference is broken up to plain text. Shared by all importers, which count the entries where this changed something.
 */
export const defangRefs = (text) => text.replace(/\{REF:/gi, '{ REF:');

/** The title, or the hostname of the URL when there is none (the URL itself if it does not parse). */
export function titleOrHost(title, url) {
    if (title || !url) return title;
    try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname; } catch { return url; }
}

// Columns that make an entry: a header with none of them is some other file (or one we split wrongly), not a password export
const ENTRY_COLUMNS = ['title', 'user', 'email', 'password', 'url', 'totp'];

/**
 * Maps the header row and returns {entries, ignored, refs, known}. entries: [{path: string[], title, user, password, url, notes, totp, tags: string[]}],
 * ignored: columns that fit nowhere. With KeePassXC the root group name leads the path; it is dropped.
 * refs: entries with a {REF:…} to another entry, broken up to plain text (see defangRefs); KeePassXC's own export resolves them anyway.
 * known: the header has at least one column that makes an entry (ENTRY_COLUMNS); without, every entry would be blank.
 * Without a title (Firefox), the hostname of the URL is used.
 */
export function mapRows([head = [], ...rows]) {
    const names = head.map((x) => x.trim().toLowerCase());
    const col = {};
    for (const [field, aliases] of Object.entries(COLUMNS)) {
        const i = aliases.map((a) => names.indexOf(a)).find((n) => n >= 0);
        if (i !== undefined) col[field] = i;
    }
    const ignored = head.filter((_, i) => !Object.values(col).includes(i) && rows.some((r) => { const c = (r[i] || '').trim(); return c && !EMPTY.test(c); }));
    const keepassxc = names[col.group] === 'group';
    let refs = 0;
    const entries = rows.map((r) => {
        let hit = false;
        const get = (f) => {
            const v = col[f] === undefined ? '' : r[col[f]] ?? '';
            if ((f === 'email' || f === 'tags') && EMPTY.test(v.trim())) return '';
            const out = defangRefs(v);
            if (out !== v) hit = true;
            return out;
        };
        const path = get('group').split('/').map((p) => p.trim()).filter(Boolean);
        if (keepassxc) path.shift();
        const url = get('url').trim();
        const title = titleOrHost(get('title').trim(), url);
        const entry = { path, title, user: get('user') || get('email'), password: get('password'), url, notes: get('notes'), totp: get('totp').trim(), tags: splitTags(get('tags').replace(/^\s*\[|\]\s*$/g, '')) };
        if (hit) refs++;
        return entry;
    });
    return { entries, ignored, refs, known: ENTRY_COLUMNS.some((f) => f in col) };
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
