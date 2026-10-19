// CSV lesen und schreiben (RFC 4180: Kommas, Anfuehrungszeichen, Zeilenumbrueche in Feldern) und die Spalten der ueblichen
// Passwort-Manager auf KeePass-Felder abbilden. Exportiert wird im Format von KeePassXC, das KeePass, Bitwarden & Co. lesen.

/** Text -> Zeilen aus Feldern. Leere Zeilen fallen weg; ein BOM am Anfang auch. */
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

/** Zeilen -> CSV, jedes Feld in Anfuehrungszeichen (wie KeePassXC), Zeilenende CRLF. */
export const toCsv = (rows) => rows.map((r) => r.map((f) => `"${String(f ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';

// Spaltennamen der bekannten Exporte (klein geschrieben): KeePassXC, KeePass 2, Bitwarden, 1Password, Chrome/Edge/Brave, Firefox, LastPass
const COLUMNS = {
    group: ['group', 'folder', 'grouping'],
    title: ['title', 'name', 'account'],
    user: ['username', 'login_username', 'login name', 'user', 'login'],
    password: ['password', 'login_password'],
    url: ['url', 'login_uri', 'web site', 'website', 'uri'],
    notes: ['notes', 'note', 'comments', 'extra'],
    totp: ['totp', 'login_totp', 'otpauth', 'otp'],
    tags: ['tags']
};

/**
 * Ordnet die Kopfzeile zu und liefert {entries, ignored}. entries: [{path: string[], title, user, password, url, notes, totp, tags: string[]}],
 * ignored: Spalten, die nirgends hinpassen. Bei KeePassXC steht der Name der Wurzelgruppe vorn im Pfad; der faellt weg.
 * Ohne Titel (Firefox) gilt der Rechnername der URL.
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
    const entries = rows.map((r) => {
        const get = (f) => (col[f] === undefined ? '' : r[col[f]] ?? '');
        const path = get('group').split('/').map((p) => p.trim()).filter(Boolean);
        if (keepassxc) path.shift();
        const url = get('url').trim();
        let title = get('title').trim();
        if (!title && url) try { title = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname; } catch { title = url; }
        return { path, title, user: get('user'), password: get('password'), url, notes: get('notes'), totp: get('totp').trim(), tags: get('tags').split(/[,;]/).map((x) => x.trim()).filter(Boolean) };
    });
    return { entries, ignored };
}

/** otpauth-URI eines Eintrags: das Feld "otp" oder aus den alten Feldern "TOTP Seed"/"TOTP Settings" gebaut; sonst ''. */
export function otpUri(title, otp, seed, settings) {
    if (otp) return otp;
    if (!seed) return '';
    const [period = '30', digits = '6'] = (settings || '').split(';');
    const steam = digits.trim().toUpperCase() === 'S';
    return `otpauth://totp/${encodeURIComponent(title || 'KeePass')}?secret=${seed.replace(/\s/g, '')}&period=${period.trim()}&digits=${steam ? 5 : digits.trim()}${steam ? '&encoder=steam' : ''}`;
}

export const EXPORT_HEAD = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'TOTP', 'Icon', 'Last Modified', 'Created'];
