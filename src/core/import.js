// Import files of other password managers -> the entries the vault creates (see Vault.importEntries).
// JSON is recognised by its shape, CSV by its header (core/csv.js). Formats: Nextcloud Passwords (database backup), Passman, Bitwarden;
// the CSV flavours of these go through mapRows. Shapes follow the sample exports of the Passwords project; fields they don't have a
// place for (favourites, tag colours, card layouts ...) are dropped, what fits no KeePass field becomes an extra field.
import { parseCsv, mapRows, defangRefs, titleOrHost } from './csv.js';

/** Thrown with a translation key (src/i18n-*.js), like VaultError. */
export class ImportError extends Error {
    constructor(key, vars) { super(key); this.key = key; this.vars = vars; }
}

export const FORMAT_NAMES = { 'passwords-json': 'Nextcloud Passwords (backup)', 'passman-json': 'Passman (JSON)', 'bitwarden-json': 'Bitwarden (JSON)' };

/** Text of a field with {REF:…} broken up (see defangRefs); `count()` is the number of entries where that happened, like in the CSV import. */
function sanitizer() {
    const seen = new Set();
    const clean = (value, entry) => {
        const s = value === undefined || value === null ? '' : String(value);
        const out = defangRefs(s);
        if (out !== s) seen.add(entry);
        return out;
    };
    return { clean, count: () => seen.size };
}
const text = (v) => (typeof v === 'string' ? v : '');
const date = (secs) => (Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000) : undefined);

/** Path of a folder from its parents; the nil UUID (or a missing parent) is the top. A loop in the data can't hang it. */
function folderPaths(folders, nameOf, parentOf, isTop) {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const cache = new Map();
    const path = (id) => {
        if (cache.has(id)) return cache.get(id);
        const out = [];
        for (let f = byId.get(id), guard = 0; f && guard < 64; f = byId.get(parentOf(f)), guard++) {
            out.unshift(nameOf(f));
            if (isTop(parentOf(f))) break;
        }
        const clean = out.map((p) => String(p ?? '').trim()).filter(Boolean);
        cache.set(id, clean);
        return clean;
    };
    return path;
}

const NIL = '00000000-0000-0000-0000-000000000000';

/** Nextcloud Passwords: Backup or export -> "Database backup" (JSON). A backup with a password can't be read here. */
function fromPasswords(d) {
    if (d.encrypted) throw new ImportError('import.encrypted');
    const s = sanitizer();
    const tagName = new Map((d.tags || []).map((x) => [x.id, text(x.label).trim()]));
    const path = folderPaths(d.folders || [], (f) => f.label, (f) => f.parent, (id) => !id || id === NIL);
    const entries = (d.passwords || []).map((p, i) => {
        const url = s.clean(p.url, i).trim();
        return {
            path: path(p.folder), title: titleOrHost(s.clean(p.label, i).trim(), url), user: s.clean(p.username, i), password: s.clean(p.password, i), url, notes: s.clean(p.notes, i), totp: '',
            tags: (p.tags || []).map((id) => tagName.get(id)).filter(Boolean),
            custom: (p.customFields || []).filter((c) => c && text(c.label).trim() && text(c.value)).map((c) => ({ name: s.clean(c.label, i).trim(), value: s.clean(c.value, i), protect: c.type === 'secret' })),
            modified: date(p.edited)
        };
    });
    return { format: 'passwords-json', entries, ignored: [], refs: s.count(), files: 0 };
}

/** Passman: Settings -> Export credentials -> JSON. Files come along as attachments (the export carries their data). */
function fromPassman(list) {
    const s = sanitizer();
    let files = 0;
    const entries = list.filter((p) => !(Number(p.delete_time) > 0)).map((p, i) => {
        const url = s.clean(p.url, i).trim();
        const attachments = [];
        for (const f of Array.isArray(p.files) ? p.files : []) {
            const m = /^data:[^,]*;base64,(.*)$/s.exec(text(f?.file_data));
            if (!m || !text(f.filename)) { files++; continue; }
            try { attachments.push({ name: f.filename, data: Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)) }); } catch { files++; }
        }
        const mail = s.clean(text(p.email), i);
        const custom = (Array.isArray(p.custom_fields) ? p.custom_fields : []).filter((c) => c && text(c.label).trim() && typeof c.value === 'string' && c.value)
            .map((c) => ({ name: s.clean(c.label, i).trim(), value: s.clean(c.value, i), protect: !!c.secret }));
        return {
            path: [], title: titleOrHost(s.clean(p.label, i).trim(), url), user: s.clean(p.username, i) || mail, password: s.clean(p.password, i), url, notes: s.clean(p.description, i),
            totp: typeof p.otp?.secret === 'string' ? p.otp.secret.trim() : '',
            tags: (Array.isArray(p.tags) ? p.tags : []).map((x) => text(x?.text).trim()).filter(Boolean),
            custom: mail && text(p.username) ? [{ name: 'E-Mail', value: mail, protect: false }, ...custom] : custom,
            attachments, created: date(p.created), modified: date(p.changed)
        };
    });
    return { format: 'passman-json', entries, ignored: [], refs: s.count(), files };
}

/** Bitwarden: Tools -> Export vault -> .json. Logins, notes, cards and identities; a second web address becomes an extra field. */
function fromBitwarden(d) {
    if (d.encrypted) throw new ImportError('import.encrypted');
    const s = sanitizer();
    const folder = folderPaths(d.folders || [], (f) => f.name, () => null, () => true);
    const path = (id) => folder(id).flatMap((x) => x.split('/')).map((x) => x.trim()).filter(Boolean); // "Work/Servers" is a subfolder
    const entries = (d.items || []).map((it, i) => {
        const custom = [];
        const add = (name, value, protect = false) => { const v = s.clean(value, i); if (v) custom.push({ name, value: v, protect }); };
        const login = it.login || {};
        const uris = (login.uris || []).map((u) => s.clean(u?.uri, i).trim()).filter(Boolean);
        uris.slice(1).forEach((u, n) => add(`URL ${n + 2}`, u));
        for (const f of it.fields || []) if (f && text(f.name).trim()) add(s.clean(f.name, i).trim(), f.value, f.type === 1);
        for (const [k, v] of Object.entries(it.card || {})) add(k, v, k === 'number' || k === 'code');
        for (const [k, v] of Object.entries(it.identity || {})) add(k, v, k === 'ssn' || k === 'passportNumber' || k === 'licenseNumber');
        return {
            path: it.folderId ? path(it.folderId) : [], title: titleOrHost(s.clean(it.name, i).trim(), uris[0] || ''), user: s.clean(login.username, i), password: s.clean(login.password, i),
            url: uris[0] || '', notes: s.clean(it.notes, i), totp: text(login.totp).trim(), tags: [], custom
        };
    });
    return { format: 'bitwarden-json', entries, ignored: [], refs: s.count(), files: (d.items || []).filter((it) => it?.attachments?.length).length };
}

/**
 * Text of an import file -> {entries, ignored, refs, files, format?}. files: entries whose attachments could not be taken along.
 * entries: [{path, title, user, password, url, notes, totp, tags, custom?: [{name, value, protect}], attachments?: [{name, data}], created?, modified?}]
 */
export function readImport(raw) {
    const body = String(raw).replace(/^﻿/, '').trimStart();
    if (body[0] === '{' || body[0] === '[') {
        let d;
        try { d = JSON.parse(body); } catch { throw new ImportError('import.badjson'); }
        if (d && !Array.isArray(d) && Array.isArray(d.passwords)) return fromPasswords(d);
        if (d && !Array.isArray(d) && Array.isArray(d.items)) return fromBitwarden(d);
        if (Array.isArray(d) && (d.length === 0 || d.every((x) => x && typeof x === 'object' && 'label' in x && 'credential_id' in x))) return fromPassman(d);
        throw new ImportError('import.unknownjson');
    }
    return { ...mapRows(parseCsv(body)), files: 0 };
}
