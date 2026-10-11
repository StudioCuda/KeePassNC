// Tresor-Logik ohne DOM: Laden, Aendern, Speichern (inkl. Sicherungskopie und Merge bei Konflikt).
// Alles Kryptografische passiert hier im Browser; der Server sieht nur die verschluesselte Datei.
import * as kdbxweb from '../vendor/kdbxweb/lib/index';
import { argon2d, argon2id } from 'hash-wasm';
import { ConflictError, isOffline } from './webdav.js';
import { cachePut } from './cache.js';

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
     * @param {{buf: ArrayBuffer, password: string, keyfile?: Uint8Array|ArrayBuffer, dav?: import('./webdav.js').DavFile, etag?: string|null,
     *   cache?: {key: string, name: string}, unsynced?: boolean, remoteBuf?: ArrayBuffer, fromCache?: boolean}} o
     * cache: Schluessel der lokalen Offline-Kopie; unsynced: buf enthaelt lokale Aenderungen, die der Server noch nicht hat (etag = Basisstand);
     * remoteBuf: aktueller Server-Stand (fuer die Sicherungskopie); fromCache: buf stammt aus dem Cache (nicht erneut dorthin schreiben).
     */
    static async open({ buf, password, keyfile, dav, etag, cache, unsynced, remoteBuf, fromCache }) {
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
        const v = new Vault(db, pw, kf, dav, etag ?? null, remoteBuf || buf, cache);
        if (unsynced) { v.unsynced = true; v._pending = buf; }
        else if (cache && !fromCache) await v._cacheWrite(buf, false);
        return v;
    }

    constructor(db, pw, kf, dav, etag, remoteBytes, cache) {
        this.db = db;
        this._pw = pw;
        this._kf = kf;
        this.dav = dav || null;
        this.etag = etag;
        this._remoteBytes = remoteBytes;
        this._backedUp = false;
        this.dirty = false; // Aenderungen nur im Arbeitsspeicher (noch nicht serialisiert)
        this.cache = cache || null;
        this.unsynced = false; // lokal gesichert (Offline-Kopie), Server hat den Stand noch nicht
        this._pending = null;
        this._chain = Promise.resolve();
    }

    _exclusive(fn) {
        const run = this._chain.then(fn);
        this._chain = run.catch(() => {});
        return run;
    }

    /** Schreibt die Offline-Kopie; liefert true, wenn sie sicher abgelegt wurde. */
    async _cacheWrite(bytes, modified) {
        if (!this.cache) return false;
        try {
            await cachePut(this.cache.key, { bytes, etag: this.etag, modified, name: this.cache.name, syncDate: Date.now() });
            return true;
        } catch (e) {
            console.warn('Offline-Kopie konnte nicht geschrieben werden', e);
            return false;
        }
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
     * Speichert: serialisiert, legt (falls aktiv) die Offline-Kopie an und schiebt den Stand zum Server (Sicherungskopie des zuletzt
     * gelesenen Standes einmal pro Sitzung, PUT mit If-Match, bei Konflikt Server-Stand sichern + zusammenfuehren, max. 3 Versuche).
     * Ist der Server nicht erreichbar und eine Offline-Kopie vorhanden, ist das kein Fehler: {offline: true}, Sync folgt spaeter.
     * @returns {Promise<{merged?: boolean, offline?: boolean, bytes?: ArrayBuffer}>}
     */
    save() { return this._exclusive(() => this._save()); }

    /** Gleicht mit dem Server ab: ungesyncte Staende hochladen, sonst Aenderungen anderer Geraete holen. */
    sync() { return this._exclusive(() => this._sync()); }

    async _save() {
        this.dirty = false; // Aenderungen waehrend des Serialisierens setzen das Merkmal erneut
        let out;
        try { out = await this.db.save(); } catch (e) { this.dirty = true; throw e; }
        if (!this.dav) return { merged: false, bytes: out };
        const stored = await this._cacheWrite(out, true);
        this._pending = out;
        this.unsynced = true;
        try {
            return await this._push();
        } catch (e) {
            if (!stored) { this.unsynced = false; this._pending = null; this.dirty = true; throw e; } // ohne lokale Kopie darf nichts "als gesichert" gelten
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

    async _push() {
        if (!this._backedUp) {
            await this.dav.putCopy(this._remoteBytes, stamp());
            this._backedUp = true;
        }
        let merged = false;
        for (let attempt = 1; ; attempt++) {
            const out = this._pending;
            try {
                this.etag = await this.dav.put(out, this.etag);
                this._remoteBytes = out;
                this.unsynced = false;
                this._pending = null;
                await this._cacheWrite(out, false);
                return { merged };
            } catch (e) {
                if (!(e instanceof ConflictError)) throw e;
                if (attempt >= 3) throw new VaultError('Die Datei wird gerade von einem anderen Geraet laufend geaendert - bitte spaeter erneut speichern. Ihre Aenderungen sind lokal gesichert.');
                const remote = await this.dav.get();
                await this.dav.putCopy(remote.buf, `conflict-${stamp()}`);
                const remoteDb = await Kdbx.load(remote.buf, this._credentials()).catch((err) => {
                    if (err instanceof KdbxError && err.code === Consts.ErrorCodes.InvalidKey) {
                        throw new VaultError('Das Master-Passwort wurde auf einem anderen Geraet geaendert - zusammenfuehren nicht moeglich. Ihre Aenderungen sind lokal gesichert; bitte mit dem neuen Passwort neu anmelden.');
                    }
                    throw err;
                });
                this.db.merge(remoteDb);
                this._pending = await this.db.save();
                this.etag = remote.etag;
                this._remoteBytes = remote.buf;
                await this._cacheWrite(this._pending, true);
                merged = true;
            }
        }
    }

    async _pull() {
        const etag = await this.dav.head();
        if (etag && etag === this.etag) return { pulled: false };
        const remote = await this.dav.get();
        if (this.dirty || this.unsynced) return { pulled: false }; // waehrenddessen lokal geaendert: Zusammenfuehrung beim naechsten Speichern
        if (remote.etag && remote.etag === this.etag) return { pulled: false };
        let remoteDb;
        try {
            remoteDb = await Kdbx.load(remote.buf, this._credentials());
        } catch (e) {
            if (e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) {
                throw new VaultError('Das Master-Passwort wurde auf einem anderen Geraet geaendert - bitte neu anmelden.');
            }
            throw e;
        }
        this.db = remoteDb; // keine lokalen Aenderungen: der Server-Stand ist massgeblich
        this.etag = remote.etag;
        this._remoteBytes = remote.buf;
        await this._cacheWrite(remote.buf, false);
        return { pulled: true };
    }
}
