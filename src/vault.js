// Vault logic without DOM: load, change, save (incl. backup copy and merge on conflict).
// All the cryptography happens here in the browser; the server only ever sees the encrypted file.
import * as kdbxweb from '../vendor/kdbxweb/lib/index';
import { argon2 } from './argon2.js';
import { ConflictError, DavError, isOffline } from './webdav.js';
import { cachePut } from './cache.js';
import { excluded } from './core/audit.js';
import { editTags, entryColor, groupPath, isOutOfMemory, isPasskeyField, isSystemField, resolvePlaceholders, toOtpUri, uuidHex, valueText } from './core/util.js';
import { EXPORT_HEAD, otpUri } from './core/csv.js';

const { Kdbx, Credentials, ProtectedValue, KdbxError, Consts, KdbxUuid, KdbxHeader, BinaryStream, Int64, VarDictionary } = kdbxweb;

kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    let out;
    try {
        out = await argon2({
            type: type === 2 ? 'id' : 'd',
            password: new Uint8Array(password),
            salt: new Uint8Array(salt),
            parallelism,
            iterations,
            memoryKiB: memory,
            hashLength: length
        });
    } catch (e) {
        // If memory runs out (phone, browser limit), report it in plain words instead of "RangeError ..."
        if (isOutOfMemory(e)) throw new VaultError('Nicht genug Arbeitsspeicher fuer die Schluesselableitung (Argon2).', 'e.argonmem', { mb: Math.ceil(memory / 1024) });
        throw e;
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
});

/**
 * Encryption settings from the file header as comparable text: format, cipher, compression, KDF with its parameters.
 * Salts, IVs and seeds are left out, they change on every save. header: KdbxHeader or the bytes of a file
 * (the header is unencrypted, so no password is needed).
 */
export function cryptoSettings(header) {
    const bytes = ArrayBuffer.isView(header) ? header.buffer.slice(header.byteOffset, header.byteOffset + header.byteLength) : header;
    const h = bytes instanceof ArrayBuffer ? KdbxHeader.read(new BinaryStream(bytes), null) : header;
    const val = (v) => (v instanceof ArrayBuffer ? btoa(String.fromCharCode(...new Uint8Array(v))) : typeof v?.hi === 'number' ? `${v.hi}:${v.lo}` : v);
    const kdf = h.kdfParameters ? h.kdfParameters.keys().filter((k) => k !== 'S').sort().map((k) => [k, val(h.kdfParameters.get(k))]) : null;
    return JSON.stringify([h.versionMajor, h.versionMinor, h.dataCipherUuid?.toString() ?? null, h.compression ?? null, h.keyEncryptionRounds ?? null, kdf]);
}

/** Display names for Vault.securitySettings(); KDF_LABEL is also the format keyfile-store.js expects. */
export const KDF_LABEL = { argon2d: 'Argon2d', argon2id: 'Argon2id', aes: 'AES-KDF' };
export const CIPHER_LABEL = { aes: 'AES-256', chacha20: 'ChaCha20', twofish: 'Twofish' };
const CIPHER_ID = { aes: Consts.CipherId.Aes, chacha20: Consts.CipherId.ChaCha20, twofish: Consts.CipherId.Twofish };

/** New key file in XML format 2.0 (like KeePassXC, .keyx), key: 256 bits from crypto.getRandomValues. */
export async function createKeyfile() {
    const key = crypto.getRandomValues(new Uint8Array(32));
    try { return await Credentials.createKeyFileWithHash(key.buffer, 2); } finally { key.fill(0); }
}

/**
 * Same key file? This compares the key KeePass reads from it, not the bytes: a copy saved on Windows with different line endings
 * counts as the same. An unreadable file (XML with a wrong checksum) throws.
 */
export async function sameKeyfile(a, b) {
    const hash = async (x) => { const c = new Credentials(null, x); await c.ready; return c.keyFileHash.getBinary(); };
    const [x, y] = await Promise.all([hash(a), hash(b)]);
    try { return sameBytes(x, y); } finally { x.fill(0); y.fill(0); }
}

export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

/** message: German fallback text; key/vars: translation key (see errText in i18n.js). */
export class VaultError extends Error {
    constructor(message, key, vars) { super(message); this.name = 'VaultError'; this.key = key; this.vars = vars; }
}

export const fieldText = valueText;

export function isProtected(v) {
    return v instanceof ProtectedValue;
}

/** data: URL for image data (PNG, JPEG, GIF, otherwise tried as PNG); never SVG, it could contain scripts. */
export function imageUrl(data) {
    const bytes = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    const mime = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x47 ? 'image/gif' : bytes[0] === 0x3c ? null : 'image/png';
    if (!mime) return null;
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return `data:${mime};base64,${btoa(bin)}`;
}

const sameBytes = (a, b) => {
    const x = new Uint8Array(a), y = new Uint8Array(b);
    let d = x.length ^ y.length;
    for (let i = 0; i < Math.min(x.length, y.length); i++) d |= x[i] ^ y[i];
    return d === 0;
};
const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export function generatePassword(length = 24) {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+?'];
    const all = sets.join('');
    const pick = (chars) => {
        // Rejection sampling against modulo bias
        const limit = Math.floor(0x100000000 / chars.length) * chars.length;
        const buf = new Uint32Array(1);
        do crypto.getRandomValues(buf); while (buf[0] >= limit);
        return chars[buf[0] % chars.length];
    };
    const out = sets.map(pick);
    while (out.length < length) out.push(pick(all));
    for (let i = out.length - 1; i > 0; i--) {
        const j = (() => { const b = new Uint32Array(1); const lim = Math.floor(0x100000000 / (i + 1)) * (i + 1); do crypto.getRandomValues(b); while (b[0] >= lim); return b[0] % (i + 1); })();
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join('');
}

/**
 * Loads buf with password and key file. Empty field with a key file: like KeePassXC, first without any password (database with key
 * file only), then with an empty one. These are two different keys: "no password" leaves the password part out, "" contributes
 * the hash of "". Returns {db, pw} (pw: the matching ProtectedValue or null); errors as VaultError (e.badkey, e.badfile).
 */
async function loadWith(buf, password, kf) {
    const tries = password === '' && kf ? [null, ProtectedValue.fromString('')] : [ProtectedValue.fromString(password)];
    try {
        for (const [n, pw] of tries.entries()) {
            try {
                return { db: await Kdbx.load(buf, new Credentials(pw, kf)), pw };
            } catch (e) {
                if (!(e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) || n === tries.length - 1) throw e;
            }
        }
    } catch (e) {
        throw loadError(e);
    }
}

/** Errors from Kdbx.load as understandable VaultErrors (wrong credentials, no/unknown KDBX file), otherwise unchanged. */
function loadError(e) {
    if (e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) {
        return new VaultError('Falsches Master-Passwort oder falsche Schluesseldatei.', 'e.badkey');
    }
    if (e instanceof KdbxError && [Consts.ErrorCodes.BadSignature, Consts.ErrorCodes.InvalidVersion, Consts.ErrorCodes.Unsupported].includes(e.code)) {
        return new VaultError('Das ist keine gueltige KDBX-Datei (oder eine nicht unterstuetzte Version).', 'e.badfile');
    }
    return e;
}

export class Vault {
    /**
     * @param {{buf: ArrayBuffer, password: string, keyfile?: Uint8Array|ArrayBuffer, dav?: import('./webdav.js').DavFile, etag?: string|null,
     *   cache?: {key: string, name: string}, unsynced?: boolean, remoteBuf?: ArrayBuffer, fromCache?: boolean}} o
     * cache: key of the local offline copy; unsynced: buf holds local changes the server doesn't have yet (etag = base version);
     * remoteBuf: current server version (for the backup copy); fromCache: buf came from the cache (don't write it back there).
     */
    static async open({ buf, password, keyfile, dav, etag, cache, unsynced, remoteBuf, fromCache }) {
        const kf = keyfile ? (keyfile instanceof ArrayBuffer ? keyfile : toArrayBuffer(keyfile)) : undefined;
        const { db, pw } = await loadWith(buf, password, kf);
        const v = new Vault(db, pw, kf, dav, etag ?? null, remoteBuf || buf, cache);
        if (unsynced) { v.unsynced = true; v._pending = buf; }
        else if (cache && !fromCache) await v._cacheWrite(buf, false);
        return v;
    }

    /**
     * New database: name (database name and root group), password (empty with keyfile: key file only, like KeePassXC),
     * security like updateSecuritySettings (see NEW_DB in core/kdf-policy.js). With dav the file is created, but an existing one
     * is never overwritten (DavFile.create); otherwise the bytes only live in bytes (local file: download).
     * Afterwards the database is open as after open(). Returns {vault, bytes}.
     */
    static async create({ name, password, keyfile, security, dav, cache }) {
        const kf = keyfile ? (keyfile instanceof ArrayBuffer ? keyfile.slice(0) : toArrayBuffer(keyfile)) : undefined;
        const pw = password ? ProtectedValue.fromString(password) : null;
        if (!pw && !kf) throw new VaultError('Ohne Passwort und Schluesseldatei liesse sich die Datenbank von jedem oeffnen.', 'e.cred.empty');
        const creds = new Credentials(pw, kf);
        try { await creds.ready; } catch { throw new VaultError('Diese Schluesseldatei ist unlesbar.', 'e.keyfile.bad'); }
        const db = Kdbx.create(creds, name);
        const v = new Vault(db, pw, kf, dav, null, null, cache);
        v.updateSecuritySettings({ ...security, upgrade: true });
        const bytes = await db.save();
        v.dirty = false;
        v._remoteBytes = bytes;
        v._backedUp = true; // nobody needs a backup copy of the empty database
        if (dav) v.etag = await dav.create(bytes);
        await v._cacheWrite(bytes, false);
        return { vault: v, bytes };
    }

    constructor(db, pw, kf, dav, etag, remoteBytes, cache) {
        this.db = db;
        this._pw = pw;
        this._kf = kf;
        this._base = { pw, kf }; // credentials of the last known server version (differ after changeCredentials until the upload)
        this.dav = dav || null;
        this.etag = etag;
        this._remoteBytes = remoteBytes;
        this._backedUp = false;
        this.backupKeep = 10; // number of backup copies kept per kind (0 = never delete)
        this.dirty = false; // changes in memory only (not serialized yet)
        this.cache = cache || null;
        this.unsynced = false; // saved locally (offline copy), the server doesn't have this version yet
        this._pending = null;
        this._chain = Promise.resolve();
    }

    _exclusive(fn) {
        const run = this._chain.then(fn);
        this._chain = run.catch(() => {});
        return run;
    }

    /** Writes the offline copy; returns true if it was stored safely. */
    async _cacheWrite(bytes, modified) {
        if (!this.cache) return false;
        try {
            await cachePut(this.cache.key, { bytes, etag: this.etag, modified, name: this.cache.name, syncDate: Date.now() });
            return true;
        } catch (e) {
            console.warn('Could not write the offline copy', e);
            return false;
        }
    }

    get versionLabel() {
        return `KDBX ${this.db.header.versionMajor}.${this.db.header.versionMinor}`;
    }

    /** For reading the server version (merging, pulling): its credentials, not necessarily our own. */
    _baseCredentials() {
        return new Credentials(this._base.pw, this._base.kf);
    }

    /** Does pw match this database's master password? Compares hashes only, no key derivation. Without a password: only "". */
    async checkPassword(pw) {
        if (!this._pw) return pw === '';
        const [a, b] = await Promise.all([ProtectedValue.fromString(pw).getHash(), this._pw.getHash()]);
        return sameBytes(a, b);
    }

    get hasKeyfile() { return !!this._kf; }
    /** false: database with key file only (no password part, not even an empty password). */
    get hasPassword() { return !!this._pw; }
    /** Copy of the key file (to remember it again after changeCredentials) or null; the caller overwrites it with zeros afterwards. */
    keyfileCopy() { return this._kf ? new Uint8Array(this._kf.slice(0)) : null; }

    /**
     * New master password and/or new key file, saved right away. password: new text or undefined (stays);
     * keyfile: undefined (stays), null (dropped) or the bytes of the new file. Until the first successful upload the
     * vault keeps reading the server with the old credentials (conflict with another device -> merging works).
     * If saving fails, the old credentials apply again; changes stay unsaved or are stored locally with the old
     * credentials. Result like save().
     */
    changeCredentials({ password, keyfile }) {
        return this._exclusive(async () => {
            const pw = password === undefined ? this._pw : ProtectedValue.fromString(password);
            const kf = keyfile === undefined ? this._kf : keyfile ? (keyfile instanceof ArrayBuffer ? keyfile.slice(0) : toArrayBuffer(keyfile)) : undefined;
            if (!pw && !kf) throw new VaultError('Ohne Passwort und Schluesseldatei liesse sich die Datenbank von jedem oeffnen.', 'e.cred.empty');
            const creds = new Credentials(pw, kf);
            // report an unreadable key file (e.g. XML with a wrong checksum) now, not only on save
            try { await creds.ready; } catch { throw new VaultError('Diese Schluesseldatei ist unlesbar.', 'e.keyfile.bad'); }
            const prev = { pw: this._pw, kf: this._kf, creds: this.db.credentials, keyChanged: this.db.meta.keyChanged };
            this._pw = pw; this._kf = kf; this.db.credentials = creds;
            this.db.meta.keyChanged = new Date();
            try {
                return await this._save();
            } catch (e) {
                this._pw = prev.pw; this._kf = prev.kf; this.db.credentials = prev.creds; this.db.meta.keyChanged = prev.keyChanged;
                if (this._pending) { // already stored locally with the new credentials: store again with the old ones, upload follows later
                    try { this._pending = await this.db.save(); await this._cacheWrite(this._pending, true); } catch { this.dirty = true; }
                } else this.dirty = true;
                throw e;
            }
        });
    }

    /**
     * The server version no longer opens with the known credentials because they were changed on another device
     * (e.merge.pw, e.pull.pw): check with the new ones, adopt them and sync right away. Local changes are merged as usual
     * and saved with the new credentials. If they don't fit: VaultError e.badkey, nothing changed.
     * Result like save() or sync().
     */
    adoptCredentials({ password, keyfile }) {
        return this._exclusive(async () => {
            const kf = keyfile ? (keyfile instanceof ArrayBuffer ? keyfile.slice(0) : toArrayBuffer(keyfile)) : undefined;
            const remote = await this.dav.get();
            const { db: remoteDb, pw } = await loadWith(remote.buf, password, kf);
            this._pw = pw; this._kf = kf; this._base = { pw, kf };
            this.db.credentials = new Credentials(pw, kf);
            if (this.dirty) return this._save();
            if (this.unsynced) return this._push();
            this.db = remoteDb; // nothing local: the server version wins (like _pull)
            this.etag = remote.etag;
            this._remoteBytes = remote.buf;
            await this._cacheWrite(remote.buf, false);
            return { pulled: true };
        });
    }

    /**
     * Pulls in another copy of this database (e.g. a "(conflicted copy)" from the Nextcloud clients or a copy from the phone), like
     * "Merge database" in KeePassXC: per entry the newer version wins, the older one goes to the history; deletions
     * come along. File header and credentials stay our own. creds missing: it is opened with our own credentials.
     * Returns {added, changed, removed} (entries). Errors: e.badkey, e.badfile, e.merge.other (different database).
     */
    async mergeFrom(buf, creds) {
        let other;
        try {
            other = creds ? (await loadWith(buf, creds.password, creds.keyfile ? toArrayBuffer(creds.keyfile) : undefined)).db
                : await Kdbx.load(buf, new Credentials(this._pw, this._kf));
        } catch (e) { throw loadError(e); }
        const snapshot = (items) => new Map([...items].map((x) => [x.uuid.id, `${x.times.lastModTime?.getTime()}|${x.parentGroup?.uuid.id}`]));
        const diff = (before, after) => ({
            added: [...after.keys()].filter((id) => !before.has(id)).length,
            changed: [...after].filter(([id, s]) => before.has(id) && before.get(id) !== s).length,
            removed: [...before.keys()].filter((id) => !after.has(id)).length
        });
        const entries = snapshot(this.root.allEntries()), groups = snapshot(this.root.allGroups());
        const { keyChanged, settingsChanged } = this.db.meta; // credentials and file header stay our own, so do their timestamps
        try {
            this.db.merge(other);
            Object.assign(this.db.meta, { keyChanged, settingsChanged });
        } catch (e) {
            if (e instanceof KdbxError && e.code === Consts.ErrorCodes.MergeError) throw new VaultError('Das ist eine andere Datenbank, keine Kopie dieser.', 'e.merge.other');
            throw e;
        }
        const count = diff(entries, snapshot(this.root.allEntries())); // the message counts entries; groups usually only change along with
        if (Object.values(count).some(Boolean) || Object.values(diff(groups, snapshot(this.root.allGroups()))).some(Boolean)) this.dirty = true;
        return count;
    }

    /**
     * Deletes all backup copies of this file on the server (after changeCredentials: they open with the old credentials).
     * Only makes sense once the new version is uploaded. Returns the names of the deleted files.
     */
    deleteBackups() { return this._exclusive(() => (this.dav && !this.unsynced ? this.dav.deleteBackups() : [])); }

    get root() {
        return this.db.getDefaultGroup();
    }

    get recycleBin() {
        const id = this.db.meta.recycleBinUuid;
        return id && this.db.meta.recycleBinEnabled !== false ? this.db.getGroup(id) : undefined;
    }

    isInRecycleBin(item) {
        const rb = this.recycleBin;
        for (let g = item.parentGroup; g && rb; g = g.parentGroup) if (g === rb) return true;
        return false;
    }

    /** All entries except the recycle bin, optionally filtered. */
    search(query) {
        const q = (query || '').trim().toLowerCase();
        const out = [];
        for (const e of this.root.allEntries()) {
            if (this.isInRecycleBin(e)) continue;
            if (!q) { out.push(e); continue; }
            const hay = [fieldText(e.fields.get('Title')), fieldText(e.fields.get('UserName')), fieldText(e.fields.get('URL')),
                fieldText(e.fields.get('Notes')), (e.tags || []).join(' '), groupPath(e.parentGroup)].join('\n').toLowerCase();
            if (q.split(/\s+/).every((t) => hay.includes(t))) out.push(e);
        }
        return out.sort((a, b) => fieldText(a.fields.get('Title')).localeCompare(fieldText(b.fields.get('Title')), 'de'));
    }

    /**
     * Applies form values to an entry (new entry: entry === null -> create in group).
     * data: {Title, UserName, Password, URL, Notes, tags: string[], custom: [{name, value, protect}], expires?: boolean, expiryTime?: Date|null, otp?: string,
     *   icon?: number, customIcon?: string|null, excludeReports?: boolean, color?: string, attachments?: {remove: string[], add: Map<name, binary from makeBinary>}}
     *   (icon: see _setIcon; color: "#rrggbb" or ""; attachments: removals first, then additions, so a name can be replaced)
     * Everything the editor doesn't show stays unchanged (passkey fields, browser data, colors, auto-type ...). Without an actual change
     * no history entry is created (like in KeePassXC).
     */
    applyEntry(entry, group, data) {
        const isNew = !entry;
        if (isNew) entry = this.db.createEntry(group);
        else if (!this.entryDiffers(entry, data)) return entry;
        else this._pushHistory(entry);
        const set = (k, v) => entry.fields.set(k, v);
        set('Title', data.Title ?? '');
        set('UserName', data.UserName ?? '');
        set('Password', ProtectedValue.fromString(data.Password ?? ''));
        set('URL', data.URL ?? '');
        set('Notes', data.Notes ?? '');
        entry.tags = [...new Set((data.tags || []).map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const wanted = new Set();
        for (const c of data.custom || []) {
            const name = (c.name || '').trim();
            if (!name || STANDARD_FIELDS.includes(name) || isSystemField(name)) continue;
            wanted.add(name);
            const old = entry.fields.get(name);
            const same = old !== undefined && valueText(old) === (c.value ?? '') && isProtected(old) === !!c.protect;
            if (!same) entry.fields.set(name, c.protect ? ProtectedValue.fromString(c.value ?? '') : (c.value ?? ''));
        }
        for (const k of [...entry.fields.keys()]) if (!STANDARD_FIELDS.includes(k) && !isSystemField(k) && !wanted.has(k)) entry.fields.delete(k);
        if (data.otp !== undefined) {
            if (data.otp) entry.fields.set('otp', ProtectedValue.fromString(data.otp));
            else for (const k of ['otp', 'TOTP Seed', 'TOTP Settings']) entry.fields.delete(k);
        }
        if (data.expires !== undefined) {
            entry.times.expires = !!data.expires;
            if (data.expires) entry.times.expiryTime = data.expiryTime || new Date(Date.now() + 365 * 86400000);
        }
        for (const name of data.attachments?.remove || []) entry.binaries.delete(name);
        for (const [name, bin] of data.attachments?.add || []) entry.binaries.set(name, bin);
        this._setIcon(entry, data);
        if (data.color !== undefined && data.color !== (entryColor(entry) || '')) entry.bgColor = data.color || undefined;
        if (data.excludeReports !== undefined && data.excludeReports !== excluded(entry)) { // both spellings, so KeePass 2 and KeePassXC see it
            entry.qualityCheck = data.excludeReports ? false : undefined;
            if (data.excludeReports) (entry.customData ??= new Map()).set('KnownBad', { value: 'True' });
            else entry.customData?.delete('KnownBad');
        }
        entry.times.update();
        this.dirty = true;
        return entry;
    }

    /** Adds and/or removes tags on several entries. Every entry that really changes gets a history entry, like an edit. Returns how many changed. */
    editTags(entries, { add = [], remove = [] }) {
        let n = 0;
        for (const e of entries) {
            const next = editTags(e.tags, { add, remove });
            if (next.join('\n') === editTags(e.tags).join('\n')) continue;
            this._pushHistory(e);
            e.tags = next;
            e.times.update();
            n++;
        }
        if (n) this.dirty = true;
        return n;
    }

    /** true if the form values differ from the stored entry. */
    entryDiffers(entry, data) {
        const same = (k, v) => valueText(entry.fields.get(k)) === (v ?? '');
        if (!(same('Title', data.Title) && same('UserName', data.UserName) && same('Password', data.Password) && same('URL', data.URL) && same('Notes', data.Notes))) return true;
        const tags = [...new Set((data.tags || []).map((t) => t.trim()).filter(Boolean))].sort().join('\n');
        if (tags !== [...entry.tags].sort().join('\n')) return true;
        const custom = (data.custom || []).filter((c) => (c.name || '').trim() && !STANDARD_FIELDS.includes(c.name.trim()) && !isSystemField(c.name.trim()));
        const existing = [...entry.fields].filter(([k]) => !STANDARD_FIELDS.includes(k) && !isSystemField(k));
        if (custom.length !== existing.length) return true;
        for (const c of custom) { const o = entry.fields.get(c.name.trim()); if (o === undefined || valueText(o) !== (c.value ?? '') || isProtected(o) !== !!c.protect) return true; }
        if (data.otp !== undefined) { const cur = valueText(entry.fields.get('otp')); if ((data.otp || '') !== cur && !(data.otp === '' && !entry.fields.has('otp') && !entry.fields.has('TOTP Seed'))) return true; }
        if (data.expires !== undefined) {
            if (!!data.expires !== !!entry.times.expires) return true;
            if (data.expires && (data.expiryTime?.getTime() ?? 0) !== (entry.times.expiryTime?.getTime() ?? 0)) return true;
        }
        if (data.attachments?.add?.size || (data.attachments?.remove || []).some((n) => entry.binaries.has(n))) return true;
        return this._iconDiffers(entry, data) || (data.excludeReports !== undefined && data.excludeReports !== excluded(entry))
            || (data.color !== undefined && data.color !== (entryColor(entry) || ''));
    }

    /** Create a history entry and trim it per the database settings (default 10 versions / 6 MiB, oldest first). */
    _pushHistory(entry) {
        entry.pushHistory();
        this._trimHistory(entry);
    }

    /**
     * Trims an entry's history to the database limits (or the given ones), oldest versions first.
     * Limits as in KDBX: -1 = unlimited, 0 versions = no history; the size limit always keeps the newest version.
     * dryRun: only count. Returns the number of versions to be (or that were) removed.
     */
    _trimHistory(entry, limits = {}, dryRun = false) {
        const maxItems = limits.historyMaxItems ?? this.db.meta.historyMaxItems ?? 10;
        const maxSize = limits.historyMaxSize ?? this.db.meta.historyMaxSize ?? 6 * 1024 * 1024;
        const hist = entry.history;
        let k = 0;
        if (maxItems === 0) k = hist.length;
        else {
            if (maxItems > 0) k = Math.max(0, hist.length - maxItems);
            if (maxSize > 0) {
                const size = (h) => [...h.fields].reduce((m, [key, v]) => m + key.length + valueText(v).length * 2, 0) + [...h.binaries.values()].reduce((m, b) => m + (b.value?.byteLength ?? b.byteLength ?? 0), 0);
                let total = hist.slice(k).reduce((m, h) => m + size(h), 0);
                while (hist.length - k > 1 && total > maxSize) total -= size(hist[k++]);
            }
        }
        if (k && !dryRun) entry.removeHistory(0, k);
        return k;
    }

    // ---------------------------------------------------------------- Security settings (file header)
    /** {version, cipher: 'aes'|'chacha20'|'twofish'|null, kdf: 'argon2d'|'argon2id'|'aes', memoryKiB, iterations, parallelism, rounds} */
    securitySettings() {
        const h = this.db.header, kp = h.kdfParameters;
        const cipher = Object.keys(CIPHER_ID).find((c) => CIPHER_ID[c] === h.dataCipherUuid?.toString()) ?? null;
        const out = { version: h.versionMajor, cipher, kdf: 'aes', memoryKiB: null, iterations: null, parallelism: null, rounds: null };
        if (!kp) { out.rounds = Number(h.keyEncryptionRounds ?? 0); return out; }
        const id = kp.get('$UUID'), b64 = id ? btoa(String.fromCharCode(...new Uint8Array(id))) : '';
        if (b64 === Consts.KdfId.Argon2d || b64 === Consts.KdfId.Argon2id) {
            out.kdf = b64 === Consts.KdfId.Argon2id ? 'argon2id' : 'argon2d';
            out.memoryKiB = Math.round(Number(kp.get('M')) / 1024);
            out.iterations = Number(kp.get('I'));
            out.parallelism = Number(kp.get('P'));
        } else out.rounds = Number(kp.get('R'));
        return out;
    }

    /** Key derivation in the format keyfile-store.js expects (see chooseKdfParams). */
    kdfParams() {
        const k = this.securitySettings();
        return { kdf: KDF_LABEL[k.kdf], memoryKiB: k.memoryKiB ?? 0, iterations: k.iterations ?? k.rounds };
    }

    /**
     * Changes format, encryption and key derivation. Argon2 and ChaCha20 only exist from KDBX 4: a KDBX 3.1 file is converted
     * for that (there is no way back). kdbxweb generates new salts and IVs on save anyway. "Settings changed" is set so that
     * merging with another device (Vault._mergedHeader) recognizes the newer header.
     */
    updateSecuritySettings({ cipher, kdf, memoryKiB, iterations, parallelism, rounds, upgrade = false }) {
        const cur = this.securitySettings();
        const needs4 = upgrade || kdf !== 'aes' || cipher === 'chacha20';
        if (needs4 && cur.version < 4) this.db.upgrade();
        const h = this.db.header;
        if (cipher && cipher !== cur.cipher) h.dataCipherUuid = new KdbxUuid(CIPHER_ID[cipher]);
        if (h.versionMajor >= 4) {
            const want = kdf === 'argon2id' ? Consts.KdfId.Argon2id : kdf === 'argon2d' ? Consts.KdfId.Argon2d : Consts.KdfId.Aes;
            if (kdf !== this.securitySettings().kdf) this.db.setKdf(want);
            const kp = h.kdfParameters, T = VarDictionary.ValueType;
            if (kdf === 'aes') kp.set('R', T.UInt64, Int64.from(rounds));
            else {
                kp.set('M', T.UInt64, Int64.from(memoryKiB * 1024));
                kp.set('I', T.UInt64, Int64.from(iterations));
                kp.set('P', T.UInt32, parallelism);
            }
        } else h.keyEncryptionRounds = rounds;
        this.db.meta.settingsChanged = new Date();
        this.db.meta.headerHash = undefined;
        this.dirty = true;
    }

    // ---------------------------------------------------------------- Database settings (metadata, not the file header)
    get binEnabled() { return this.db.meta.recycleBinEnabled !== false; }

    /** Deleting is permanent here: the item is already in the recycle bin, or the database has none. */
    deletesForever(item) { return !this.binEnabled || this.isInRecycleBin(item); }

    generalSettings() {
        const m = this.db.meta;
        return { name: m.name || '', desc: m.desc || '', defaultUser: m.defaultUser || '', recycleBin: this.binEnabled,
            historyMaxItems: m.historyMaxItems ?? 10, historyMaxSize: m.historyMaxSize ?? 6 * 1024 * 1024 };
    }

    /** This many history versions would be dropped with these limits (for the confirmation before applying). */
    historyTrimCount(limits) {
        let n = 0;
        for (const e of this.root.allEntries()) n += this._trimHistory(e, limits, true);
        return n;
    }

    /**
     * Applies the general settings. Via the kdbxweb setters, so the change times are right and merging with another device assigns
     * them correctly. New history limits apply immediately to all entries (like in KeePassXC).
     */
    updateGeneralSettings({ name, desc, defaultUser, recycleBin, historyMaxItems, historyMaxSize }) {
        const m = this.db.meta;
        if (name !== undefined) m.name = name;
        if (desc !== undefined) m.desc = desc;
        if (defaultUser !== undefined) m.defaultUser = defaultUser;
        if (recycleBin !== undefined && recycleBin !== this.binEnabled) m.recycleBinEnabled = recycleBin;
        let trimmed = 0;
        if ((historyMaxItems !== undefined && historyMaxItems !== m.historyMaxItems) || (historyMaxSize !== undefined && historyMaxSize !== m.historyMaxSize)) {
            if (historyMaxItems !== undefined) m.historyMaxItems = historyMaxItems;
            if (historyMaxSize !== undefined) m.historyMaxSize = historyMaxSize;
            for (const e of this.root.allEntries()) trimmed += this._trimHistory(e);
        }
        this.dirty = true;
        return trimmed;
    }

    removeEntry(entry) {
        if (this.isInRecycleBin(entry)) this.db.move(entry, null); // delete permanently
        else this.db.remove(entry);
        this.dirty = true;
    }

    /**
     * Copy with a new UUID, new timestamps and no history, in the same group. A passkey is NOT copied:
     * two entries with the same private key and the same credential ID confuse the browser extension.
     * linked: username and password point to the original via field references ({REF:U@I:…}, {REF:P@I:…}), like "Clone" in KeePassXC.
     */
    duplicateEntry(entry, suffix = ' - Kopie', { linked = false } = {}) {
        const copy = this.db.createEntry(entry.parentGroup);
        copy.copyFrom(entry);
        for (const k of [...copy.fields.keys()]) if (isPasskeyField(k)) copy.fields.delete(k);
        copy.uuid = KdbxUuid.random();
        copy.history = [];
        copy.previousParentGroup = undefined;
        copy.times = entry.times.clone();
        const now = new Date();
        copy.times.creationTime = now; copy.times.lastModTime = now; copy.times.lastAccessTime = now; copy.times.locationChanged = now; copy.times.usageCount = 0;
        copy.fields.set('Title', valueText(entry.fields.get('Title')) + suffix);
        if (linked) {
            const id = uuidHex(entry.uuid);
            copy.fields.set('UserName', `{REF:U@I:${id}}`);
            copy.fields.set('Password', ProtectedValue.fromString(`{REF:P@I:${id}}`));
        }
        this.dirty = true;
        return copy;
    }

    moveEntry(entry, group) {
        if (entry.parentGroup === group) return;
        this.db.move(entry, group);
        this.dirty = true;
    }

    // ---------------------------------------------------------------- Groups
    allGroups() {
        const out = [];
        const walk = (g, depth) => { out.push({ group: g, depth }); for (const c of g.groups) walk(c, depth + 1); };
        walk(this.root, 0);
        return out;
    }
    createGroup(parent, name) { const g = this.db.createGroup(parent, name.trim() || 'Neue Gruppe'); this.dirty = true; return g; }
    /**
     * icon/customIcon: icon as with applyEntry. iconScope exists like in KeePassXC: 'groups' (all subgroups), 'entries' (entries
     * directly in the group) or 'all' (everything below) get the same icon, without a history entry.
     */
    updateGroup(group, { name, notes, icon, customIcon, iconScope }) {
        if (name !== undefined) group.name = name.trim() || group.name;
        if (notes !== undefined) group.notes = notes;
        this._setIcon(group, { icon, customIcon });
        group.times.update();
        if (iconScope && iconScope !== 'self') {
            const sel = { icon: group.icon, customIcon: group.customIcon?.id ?? null };
            const inBin = (g) => g === this.recycleBin || this.isInRecycleBin(g); // the recycle bin under the root stays as it is
            const groups = iconScope === 'entries' ? [] : [...group.allGroups()].filter((g) => g !== group && (inBin(group) || !inBin(g)));
            const entries = iconScope === 'groups' ? [] : iconScope === 'entries' ? group.entries : [group, ...groups].flatMap((g) => g.entries);
            for (const item of [...groups, ...entries]) if (this._iconDiffers(item, sel)) { this._setIcon(item, sel); item.times.update(); }
        }
        this.dirty = true;
    }
    /** Recycle bin is active -> group moves into it; otherwise permanent. */
    removeGroup(group) {
        if (group === this.root) throw new VaultError('Die Wurzelgruppe kann nicht geloescht werden.', 'e.root.delete');
        if (group === this.recycleBin) throw new VaultError('Der Papierkorb kann nicht geloescht werden - nur leeren.', 'e.bin.delete');
        if (this.isInRecycleBin(group)) this.db.move(group, null); else this.db.remove(group);
        this.dirty = true;
    }
    canMoveGroup(group, target) {
        if (group === this.root || !target || group === target || group.parentGroup === target) return false;
        for (let g = target; g; g = g.parentGroup) if (g === group) return false; // not into itself/descendants
        return true;
    }
    moveGroup(group, target) {
        if (!this.canMoveGroup(group, target)) return false;
        this.db.move(group, target);
        this.dirty = true;
        return true;
    }
    // ---------------------------------------------------------------- CSV
    /**
     * Creates entries from an import (core/import.js readImport) in a new group `name` under the root, subfolders as
     * subgroups. This keeps the import together and lets you get rid of it again with one click. Returns the new group.
     */
    async importEntries(entries, name) {
        const top = this.db.createGroup(this.root, name);
        const sub = (parent, part) => parent.groups.find((g) => g.name === part) || this.db.createGroup(parent, part);
        const free = (n, taken) => { let k = 2, out = n; while (taken(out)) out = `${n} (${k++})`; return out; }; // "name", "name (2)", ...
        for (const r of entries) {
            const e = this.db.createEntry(r.path.reduce(sub, top));
            e.fields.set('Title', r.title); e.fields.set('UserName', r.user); e.fields.set('Password', ProtectedValue.fromString(r.password));
            e.fields.set('URL', r.url); e.fields.set('Notes', r.notes);
            if (r.totp) e.fields.set('otp', ProtectedValue.fromString(toOtpUri(r.totp, r.title, r.user)));
            e.tags = r.tags;
            // extra fields (never over a standard or system field) and attachments, when the source has them (see core/import.js)
            for (const c of r.custom || []) e.fields.set(free(c.name, (n) => STANDARD_FIELDS.includes(n) || isSystemField(n) || e.fields.has(n)), c.protect ? ProtectedValue.fromString(c.value) : c.value);
            for (const a of r.attachments || []) e.binaries.set(free(a.name, (n) => e.binaries.has(n)), await this.makeBinary(a.data.buffer));
            if (r.created) e.times.creationTime = r.created;
            if (r.modified) e.times.lastModTime = r.modified;
        }
        this.dirty = true;
        return top;
    }

    /** All entries except the recycle bin as CSV rows in KeePassXC's format; placeholders and field references resolved so other programs understand them. */
    csvRows() {
        const all = [...this.root.allEntries()].filter((e) => !this.isInRecycleBin(e));
        const val = (e, k) => resolvePlaceholders(fieldText(e.fields.get(k)), e, all);
        const time = (d) => (d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : '');
        return [EXPORT_HEAD, ...all.map((e) => [[this.root.name, groupPath(e.parentGroup)].filter(Boolean).join('/'),
            val(e, 'Title'), val(e, 'UserName'), val(e, 'Password'), val(e, 'URL'), val(e, 'Notes'),
            otpUri(val(e, 'Title'), val(e, 'otp'), val(e, 'TOTP Seed'), val(e, 'TOTP Settings')), String(e.icon ?? 0), time(e.times.lastModTime), time(e.times.creationTime)])];
    }

    emptyRecycleBin() {
        const rb = this.recycleBin;
        if (!rb) return 0;
        let n = 0;
        for (const e of [...rb.entries]) { this.db.move(e, null); n++; }
        for (const g of [...rb.groups]) { this.db.move(g, null); n++; }
        if (n) this.dirty = true;
        return n;
    }

    // ---------------------------------------------------------------- History
    /** Restores an earlier version; the current version itself becomes a history entry. */
    restoreHistory(entry, index) {
        const old = entry.history[index];
        if (!old) return;
        const created = entry.times.creationTime, keep = entry.history, uuid = entry.uuid, parent = entry.parentGroup, prev = entry.previousParentGroup, loc = entry.times.locationChanged, usage = entry.times.usageCount;
        this._pushHistory(entry);
        const hist = entry.history;
        entry.copyFrom(old);
        entry.uuid = uuid; entry.history = hist; entry.parentGroup = parent; entry.previousParentGroup = prev;
        entry.times.creationTime = created; entry.times.locationChanged = loc; entry.times.usageCount = usage;
        entry.times.update();
        this.dirty = true;
    }
    deleteHistory(entry, index) { entry.removeHistory(index, 1); entry.times.update(); this.dirty = true; }
    clearHistory(entry) { entry.removeHistory(0, entry.history.length); this.dirty = true; }

    // ---------------------------------------------------------------- Attachments
    /** Stores file contents in the database for applyEntry's `attachments.add` (nothing is attached until the entry is applied). */
    makeBinary(buffer) { return this.db.createBinary(buffer); }
    /** Remove the passkey from the entry; the previous version stays in the history (recoverable until the history is cleared). */
    removePasskey(entry) {
        const keys = [...entry.fields.keys()].filter(isPasskeyField);
        if (!keys.length) return false;
        this._pushHistory(entry);
        for (const k of keys) entry.fields.delete(k);
        entry.times.update();
        this.dirty = true;
        return true;
    }

    // ---------------------------------------------------------------- Icons
    // Like KeePass/KeePassXC: every item has a standard icon (IconID 0-68) and optionally a custom one (UUID in meta.customIcons), which wins in
    // the display. Whoever picks a custom one keeps the IconID as a fallback for programs without custom icons.
    /** sel: {icon?: number, customIcon?: string|null}; undefined leaves the respective part unchanged. */
    _setIcon(item, { icon, customIcon }) {
        if (Number.isInteger(icon) && icon >= 0 && icon < 69) item.icon = icon;
        if (customIcon === null) item.customIcon = undefined;
        else if (customIcon !== undefined && customIcon !== item.customIcon?.id) item.customIcon = this.db.meta.customIcons.has(customIcon) ? new KdbxUuid(customIcon) : undefined;
    }
    _iconDiffers(item, { icon, customIcon }) {
        if (customIcon !== undefined && (customIcon || null) !== (item.customIcon?.id ?? null)) return true;
        return icon !== undefined && icon !== (item.icon ?? (item instanceof kdbxweb.KdbxGroup ? 48 : 0));
    }

    /** All custom icons of the file: [{id, name, url}] (url null if the format isn't displayed). */
    customIcons() {
        return [...this.db.meta.customIcons].map(([id, ic]) => ({ id, name: ic.name || '', url: this.iconUrl(id) }));
    }
    /**
     * New custom icon (PNG bytes, already scaled down). If the same bytes exist already, the existing one is used (like KeePassXC).
     * @returns {string} UUID of the icon
     */
    addCustomIcon(bytes, name = '') {
        const u8 = new Uint8Array(bytes);
        const known = this.findCustomIcon(u8);
        if (known) return known;
        const id = KdbxUuid.random().id;
        this.db.meta.customIcons.set(id, { data: toArrayBuffer(u8), name: name.slice(0, 64) || undefined, lastModified: new Date() });
        this.dirty = true;
        return id;
    }
    /** UUID of the custom icon with exactly these bytes (or null). */
    findCustomIcon(bytes) {
        const u8 = new Uint8Array(bytes);
        for (const [id, ic] of this.db.meta.customIcons) {
            const o = new Uint8Array(ic.data);
            if (o.length === u8.length && o.every((b, i) => b === u8[i])) return id;
        }
        return null;
    }
    /** How many entries and groups (without history) use the icon. */
    customIconUsage(id) {
        let n = 0;
        for (const item of this.root.allGroupsAndEntries()) if (item.customIcon?.id === id) n++;
        return n;
    }
    /**
     * Remove an icon from the file; whatever used it shows its standard icon again (also in the history). The deletion marker prevents
     * it from coming back when merging with another version (like kdbxweb when cleaning up).
     */
    removeCustomIcon(id) {
        if (!this.db.meta.customIcons.has(id)) return;
        for (const item of this.root.allGroupsAndEntries()) {
            if (item.customIcon?.id === id) { item.customIcon = undefined; item.times.update(); }
            for (const old of item.history || []) if (old.customIcon?.id === id) old.customIcon = undefined;
        }
        this.db.meta.customIcons.delete(id);
        this.db.addDeletedObject(new KdbxUuid(id), new Date());
        this._iconCache?.delete(id);
        this.dirty = true;
    }

    /** data: URL of a custom icon (or null). */
    customIconUrl(entryOrGroup) {
        const id = entryOrGroup.customIcon?.id;
        return id ? this.iconUrl(id) : null;
    }
    iconUrl(id) {
        const ic = this.db.meta.customIcons.get(id);
        if (!ic) return null;
        this._iconCache ||= new Map();
        if (!this._iconCache.has(id)) this._iconCache.set(id, imageUrl(ic.data));
        return this._iconCache.get(id);
    }

    /** Key facts of the file for the info view (header data from securitySettings, as display text). */
    info() {
        const s = this.securitySettings(), argon = s.kdf !== 'aes';
        return {
            version: this.versionLabel, name: this.db.meta.name || '',
            cipher: CIPHER_LABEL[s.cipher] || this.db.header.dataCipherUuid?.toString?.() || '?', kdf: KDF_LABEL[s.kdf],
            memoryMiB: argon ? Math.round(s.memoryKiB / 1024) : null, iterations: argon ? s.iterations : s.rounds, parallelism: argon ? s.parallelism : null
        };
    }

    /**
     * Saves: serializes, writes the offline copy (if active) and pushes the version to the server (backup copy of the last
     * read version once per session, PUT with If-Match, on conflict back up the server version + merge, max. 3 attempts).
     * If the server is unreachable and an offline copy exists, that's no error: {offline: true}, sync follows later.
     * @returns {Promise<{merged?: boolean, offline?: boolean, bytes?: ArrayBuffer}>}
     */
    save() { return this._exclusive(() => this._save()); }

    /** Syncs with the server: upload unsynced versions, otherwise pull changes from other devices. */
    sync() { return this._exclusive(() => this._sync()); }

    async _save() {
        this.dirty = false; // changes during serialization set the flag again
        let out;
        try { out = await this.db.save(); } catch (e) { this.dirty = true; throw e; }
        if (!this.dav) return { merged: false, bytes: out };
        const stored = await this._cacheWrite(out, true);
        this._pending = out;
        this.unsynced = true;
        try {
            return await this._push();
        } catch (e) {
            if (!stored) { this.unsynced = false; this._pending = null; this.dirty = true; throw e; } // without a local copy nothing may count as "saved"
            if (isOffline(e)) return { offline: true };
            throw e;
        }
    }

    async _sync() {
        if (!this.dav) return {};
        if (this.dirty) return this._save();
        try {
            return this.unsynced ? await this._push() : await this._pull();
        } catch (e) {
            if (isOffline(e)) return { offline: true };
            throw e;
        }
    }

    /**
     * Backup copy next to the file. If new files can't be created in the folder (Nextcloud share "Edit" without
     * "Create", 403), saving continues without a copy and reports that (noBackup) instead of blocking the save entirely.
     */
    async _backup(buf, suffix) {
        try {
            await this.dav.putCopy(buf, suffix);
        } catch (e) {
            if (!(e instanceof DavError && e.status === 403)) throw e;
            this.noBackup = true;
        }
    }

    /** Clean up old backup copies; errors here must never disturb saving. */
    async _prune() {
        try { await this.dav.pruneBackups(this.backupKeep); } catch { /* best effort */ }
    }

    async _push() {
        if (!this._backedUp) {
            await this._backup(this._remoteBytes, stamp());
            this._backedUp = true;
            await this._prune();
        }
        let merged = false;
        for (let attempt = 1; ; attempt++) {
            const out = this._pending;
            try {
                // A server that sends no ETag (or a CORS setup that hides it) can't check If-Match. Then compare with what we last read,
                // right before writing; a difference takes the usual conflict path (backup of the other version, merge, retry).
                if (!this.etag && !(await this._serverUnchanged())) throw new ConflictError();
                this.etag = await this.dav.put(out, this.etag);
                this._remoteBytes = out;
                this._base = { pw: this._pw, kf: this._kf };
                this.unsynced = false;
                this._pending = null;
                await this._cacheWrite(out, false);
                return { merged, noBackup: this.noBackup };
            } catch (e) {
                if (!(e instanceof ConflictError)) throw e;
                if (attempt >= 3) throw new VaultError('Die Datei wird gerade von einem anderen Geraet laufend geaendert - bitte spaeter erneut speichern. Deine Aenderungen sind lokal gesichert.', 'e.busy');
                const remote = await this.dav.get();
                await this._backup(remote.buf, `conflict-${stamp()}`);
                await this._prune();
                const remoteDb = await Kdbx.load(remote.buf, this._baseCredentials()).catch((err) => {
                    if (err instanceof KdbxError && err.code === Consts.ErrorCodes.InvalidKey) {
                        throw new VaultError('Die Zugangsdaten wurden auf einem anderen Geraet geaendert. Die Aenderungen sind noch da: mit den neuen Zugangsdaten werden sie zusammengefuehrt.', 'e.merge.pw');
                    }
                    throw err;
                });
                const header = this._mergedHeader(remoteDb);
                this.db.merge(remoteDb);
                if (header !== this.db.header) { this.db.header = header; this.db.meta.headerHash = undefined; }
                this._pending = await this.db.save();
                this.etag = remote.etag;
                this._remoteBytes = remote.buf;
                await this._cacheWrite(this._pending, true);
                merged = true;
            }
        }
    }

    /**
     * Which file header (format, encryption, key derivation) applies after merging. kdbxweb's merge() only takes over
     * content and metadata; without this choice, saving here would silently reset a header changed on another device, e.g. a strengthened
     * key derivation, to the old version. The comparison is against the last common server version:
     * If only the server changed it, its header applies; only local: the local one; both: the one with the newer "settings changed".
     */
    _mergedHeader(remoteDb) {
        const local = this.db.header, remote = remoteDb.header;
        const remoteSet = cryptoSettings(remote);
        if (remoteSet === cryptoSettings(local)) return local;
        let base = null;
        try { base = cryptoSettings(this._remoteBytes); } catch { /* unreadable base version: treat like "both changed" */ }
        if (remoteSet === base) return local;
        if (cryptoSettings(local) === base) return remote;
        return (this.db.meta.settingsChanged?.getTime() ?? 0) > (remoteDb.meta.settingsChanged?.getTime() ?? 0) ? local : remote;
    }

    /** Is the file on the server still the version we read last? Only for servers without ETag, see _push. */
    async _serverUnchanged() {
        const remote = await this.dav.get();
        return !!this._remoteBytes && sameBytes(remote.buf, this._remoteBytes);
    }

    async _pull() {
        const etag = await this.dav.head();
        if (etag && etag === this.etag) return { pulled: false };
        const remote = await this.dav.get();
        if (this.dirty || this.unsynced) return { pulled: false }; // changed locally in the meantime: merge on the next save
        if (remote.etag && remote.etag === this.etag) return { pulled: false };
        if (!remote.etag && this._remoteBytes && sameBytes(remote.buf, this._remoteBytes)) return { pulled: false }; // no ETag to compare: same bytes, nothing new
        let remoteDb;
        try {
            remoteDb = await Kdbx.load(remote.buf, this._baseCredentials());
        } catch (e) {
            if (e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) {
                throw new VaultError('Die Zugangsdaten wurden auf einem anderen Geraet geaendert.', 'e.pull.pw');
            }
            throw e;
        }
        this.db = remoteDb; // no local changes: the server version is authoritative
        this.etag = remote.etag;
        this._remoteBytes = remote.buf;
        await this._cacheWrite(remote.buf, false);
        return { pulled: true };
    }
}
