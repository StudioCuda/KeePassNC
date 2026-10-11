// Tresor-Logik ohne DOM: Laden, Aendern, Speichern (inkl. Sicherungskopie und Merge bei Konflikt).
// Alles Kryptografische passiert hier im Browser; der Server sieht nur die verschluesselte Datei.
import * as kdbxweb from '../vendor/kdbxweb/lib/index';
import { argon2d, argon2id } from 'hash-wasm';
import { ConflictError } from './webdav.js';

const { Kdbx, Credentials, ProtectedValue, KdbxError, Consts } = kdbxweb;

kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    const fn = type === 2 ? argon2id : argon2d;
    const out = await fn({
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        parallelism,
        iterations,
        memorySize: memory, // KiB
        hashLength: length,
        outputType: 'binary'
    });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
});

export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

export class VaultError extends Error {}

export function fieldText(v) {
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : v.getText();
}

export function isProtected(v) {
    return v instanceof ProtectedValue;
}

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export function generatePassword(length = 24) {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+?'];
    const all = sets.join('');
    const pick = (chars) => {
        // Rejection Sampling gegen Modulo-Verzerrung
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

export class Vault {
    /**
     * @param {{buf: ArrayBuffer, password: string, keyfile?: Uint8Array|ArrayBuffer, dav?: import('./webdav.js').DavFile, etag?: string|null}} o
     */
    static async open({ buf, password, keyfile, dav, etag }) {
        const pw = ProtectedValue.fromString(password);
        const kf = keyfile ? (keyfile instanceof ArrayBuffer ? keyfile : toArrayBuffer(keyfile)) : undefined;
        let db;
        try {
            db = await Kdbx.load(buf, new Credentials(pw, kf));
        } catch (e) {
            if (e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) {
                throw new VaultError('Falsches Master-Passwort oder falsche Schluesseldatei.');
            }
            if (e instanceof KdbxError && (e.code === Consts.ErrorCodes.BadSignature || e.code === Consts.ErrorCodes.InvalidVersion)) {
                throw new VaultError('Das ist keine gueltige KDBX-Datei (oder eine nicht unterstuetzte Version).');
            }
            throw e;
        }
        const v = new Vault(db, pw, kf, dav, etag ?? null, buf);
        return v;
    }

    constructor(db, pw, kf, dav, etag, remoteBytes) {
        this.db = db;
        this._pw = pw;
        this._kf = kf;
        this.dav = dav || null;
        this.etag = etag;
        this._remoteBytes = remoteBytes;
        this._backedUp = false;
        this.dirty = false;
    }

    get versionLabel() {
        return `KDBX ${this.db.header.versionMajor}.${this.db.header.versionMinor}`;
    }

    _credentials() {
        return new Credentials(this._pw, this._kf);
    }

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

    /** Alle Eintraege ausser dem Papierkorb, optional gefiltert. */
    search(query) {
        const q = (query || '').trim().toLowerCase();
        const out = [];
        for (const e of this.root.allEntries()) {
            if (this.isInRecycleBin(e)) continue;
            if (!q) { out.push(e); continue; }
            const hay = [fieldText(e.fields.get('Title')), fieldText(e.fields.get('UserName')), fieldText(e.fields.get('URL')),
                fieldText(e.fields.get('Notes')), (e.tags || []).join(' ')].join('\n').toLowerCase();
            if (q.split(/\s+/).every((t) => hay.includes(t))) out.push(e);
        }
        return out.sort((a, b) => fieldText(a.fields.get('Title')).localeCompare(fieldText(b.fields.get('Title')), 'de'));
    }

    /**
     * Wendet Formularwerte auf einen Eintrag an (neuer Eintrag: entry === null -> in group anlegen).
     * data: {Title, UserName, Password, URL, Notes, tags: string[], custom: [{name, value, protect}]}
     */
    applyEntry(entry, group, data) {
        const isNew = !entry;
        if (isNew) entry = this.db.createEntry(group);
        else entry.pushHistory();
        entry.fields.set('Title', data.Title ?? '');
        entry.fields.set('UserName', data.UserName ?? '');
        entry.fields.set('Password', ProtectedValue.fromString(data.Password ?? ''));
        entry.fields.set('URL', data.URL ?? '');
        entry.fields.set('Notes', data.Notes ?? '');
        entry.tags = data.tags || [];
        const wanted = new Set();
        for (const c of data.custom || []) {
            const name = (c.name || '').trim();
            if (!name || STANDARD_FIELDS.includes(name)) continue;
            wanted.add(name);
            entry.fields.set(name, c.protect ? ProtectedValue.fromString(c.value ?? '') : (c.value ?? ''));
        }
        for (const k of [...entry.fields.keys()]) if (!STANDARD_FIELDS.includes(k) && !wanted.has(k)) entry.fields.delete(k);
        entry.times.update();
        this.dirty = true;
        return entry;
    }

    removeEntry(entry) {
        if (this.isInRecycleBin(entry)) this.db.move(entry, null); // endgueltig loeschen
        else this.db.remove(entry);
        this.dirty = true;
    }

    /**
     * Speichert. Mit WebDAV: erst Sicherungskopie des zuletzt gelesenen Standes (einmal pro Sitzung), dann PUT mit
     * If-Match. Bei Konflikt: Server-Stand sichern, laden, mit lokalem Stand zusammenfuehren, erneut speichern.
     * @returns {Promise<{merged: boolean, bytes?: ArrayBuffer}>}
     */
    async save() {
        const out = await this.db.save();
        if (!this.dav) {
            this.dirty = false;
            return { merged: false, bytes: out };
        }
        if (!this._backedUp) {
            await this.dav.putCopy(this._remoteBytes, stamp());
            this._backedUp = true;
        }
        let merged = false;
        try {
            this.etag = await this.dav.put(out, this.etag);
            this._remoteBytes = out;
        } catch (e) {
            if (!(e instanceof ConflictError)) throw e;
            const remote = await this.dav.get();
            await this.dav.putCopy(remote.buf, `conflict-${stamp()}`);
            const remoteDb = await Kdbx.load(remote.buf, this._credentials());
            this.db.merge(remoteDb);
            const out2 = await this.db.save();
            this.etag = await this.dav.put(out2, remote.etag);
            this._remoteBytes = out2;
            merged = true;
        }
        this.dirty = false;
        return { merged };
    }
}
