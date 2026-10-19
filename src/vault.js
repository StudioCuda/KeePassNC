// Tresor-Logik ohne DOM: Laden, Aendern, Speichern (inkl. Sicherungskopie und Merge bei Konflikt).
// Alles Kryptografische passiert hier im Browser; der Server sieht nur die verschluesselte Datei.
import * as kdbxweb from '../vendor/kdbxweb/lib/index';
import { argon2 } from './argon2.js';
import { ConflictError, DavError, isOffline } from './webdav.js';
import { cachePut } from './cache.js';
import { excluded } from './core/audit.js';
import { isOutOfMemory, isPasskeyField, isSystemField, uuidHex, valueText } from './core/util.js';

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
        // Reicht der Arbeitsspeicher (Handy, Browser-Grenze) nicht, verstaendlich melden statt "RangeError ..."
        if (isOutOfMemory(e)) throw new VaultError('Nicht genug Arbeitsspeicher fuer die Schluesselableitung (Argon2).', 'e.argonmem', { mb: Math.ceil(memory / 1024) });
        throw e;
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
});

/**
 * Verschluesselungs-Einstellungen aus dem Dateikopf als vergleichbarer Text: Format, Chiffre, Kompression, KDF samt Parametern.
 * Salze, IVs und Startwerte bleiben aussen vor, die sind bei jedem Speichern neu. header: KdbxHeader oder die Bytes einer Datei
 * (der Kopf ist unverschluesselt, dafuer braucht es kein Passwort).
 */
export function cryptoSettings(header) {
    const bytes = ArrayBuffer.isView(header) ? header.buffer.slice(header.byteOffset, header.byteOffset + header.byteLength) : header;
    const h = bytes instanceof ArrayBuffer ? KdbxHeader.read(new BinaryStream(bytes), null) : header;
    const val = (v) => (v instanceof ArrayBuffer ? btoa(String.fromCharCode(...new Uint8Array(v))) : typeof v?.hi === 'number' ? `${v.hi}:${v.lo}` : v);
    const kdf = h.kdfParameters ? h.kdfParameters.keys().filter((k) => k !== 'S').sort().map((k) => [k, val(h.kdfParameters.get(k))]) : null;
    return JSON.stringify([h.versionMajor, h.versionMinor, h.dataCipherUuid?.toString() ?? null, h.compression ?? null, h.keyEncryptionRounds ?? null, kdf]);
}

/** Anzeigenamen zu Vault.securitySettings(); KDF_LABEL ist auch das Format, das keyfile-store.js erwartet. */
export const KDF_LABEL = { argon2d: 'Argon2d', argon2id: 'Argon2id', aes: 'AES-KDF' };
export const CIPHER_LABEL = { aes: 'AES-256', chacha20: 'ChaCha20', twofish: 'Twofish' };
const CIPHER_ID = { aes: Consts.CipherId.Aes, chacha20: Consts.CipherId.ChaCha20, twofish: Consts.CipherId.Twofish };

/** Neue Schluesseldatei im XML-Format 2.0 (wie KeePassXC, .keyx), Schluessel: 256 Bit aus crypto.getRandomValues. */
export async function createKeyfile() {
    const key = crypto.getRandomValues(new Uint8Array(32));
    try { return await Credentials.createKeyFileWithHash(key.buffer, 2); } finally { key.fill(0); }
}

/**
 * Dieselbe Schluesseldatei? Verglichen wird der Schluessel, den KeePass aus ihr liest, nicht die Bytes: eine unter Windows
 * gespeicherte Kopie mit anderen Zeilenenden zaehlt als gleich. Eine unlesbare Datei (XML mit falscher Pruefsumme) wirft.
 */
export async function sameKeyfile(a, b) {
    const hash = async (x) => { const c = new Credentials(null, x); await c.ready; return c.keyFileHash.getBinary(); };
    const [x, y] = await Promise.all([hash(a), hash(b)]);
    try { return sameBytes(x, y); } finally { x.fill(0); y.fill(0); }
}

export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

/** message: deutscher Ersatztext; key/vars: Schluessel der Uebersetzung (siehe errText in i18n.js). */
export class VaultError extends Error {
    constructor(message, key, vars) { super(message); this.name = 'VaultError'; this.key = key; this.vars = vars; }
}

export const fieldText = valueText;

export function isProtected(v) {
    return v instanceof ProtectedValue;
}

/** data:-URL fuer Bilddaten (PNG, JPEG, GIF, sonst als PNG versucht); SVG nie, das koennte Skripte enthalten. */
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

/**
 * Laedt buf mit Passwort und Schluesseldatei. Leeres Feld mit Schluesseldatei: wie KeePassXC erst ganz ohne Passwort (Datenbank nur mit
 * Schluesseldatei), dann mit leerem. Das sind zwei verschiedene Schluessel: "kein Passwort" laesst den Passwort-Anteil weg, "" steuert
 * den Hash von "" bei. Liefert {db, pw} (pw: das passende ProtectedValue oder null); Fehler als VaultError (e.badkey, e.badfile).
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
        if (e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) {
            throw new VaultError('Falsches Master-Passwort oder falsche Schluesseldatei.', 'e.badkey');
        }
        if (e instanceof KdbxError && [Consts.ErrorCodes.BadSignature, Consts.ErrorCodes.InvalidVersion, Consts.ErrorCodes.Unsupported].includes(e.code)) {
            throw new VaultError('Das ist keine gueltige KDBX-Datei (oder eine nicht unterstuetzte Version).', 'e.badfile');
        }
        throw e;
    }
}

export class Vault {
    /**
     * @param {{buf: ArrayBuffer, password: string, keyfile?: Uint8Array|ArrayBuffer, dav?: import('./webdav.js').DavFile, etag?: string|null,
     *   cache?: {key: string, name: string}, unsynced?: boolean, remoteBuf?: ArrayBuffer, fromCache?: boolean}} o
     * cache: Schluessel der lokalen Offline-Kopie; unsynced: buf enthaelt lokale Aenderungen, die der Server noch nicht hat (etag = Basisstand);
     * remoteBuf: aktueller Server-Stand (fuer die Sicherungskopie); fromCache: buf stammt aus dem Cache (nicht erneut dorthin schreiben).
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
     * Neue Datenbank: name (Datenbank-Name und Wurzelgruppe), password (leer mit keyfile: nur Schluesseldatei, wie KeePassXC),
     * security wie updateSecuritySettings (siehe NEW_DB in core/kdf-policy.js). Mit dav wird die Datei angelegt, aber nie eine
     * vorhandene ueberschrieben (DavFile.create); sonst liegen die Bytes nur in bytes (lokale Datei: herunterladen).
     * Danach ist die Datenbank offen wie nach open(). Liefert {vault, bytes}.
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
        v._backedUp = true; // eine Sicherungskopie der leeren Datenbank braucht niemand
        if (dav) v.etag = await dav.create(bytes);
        await v._cacheWrite(bytes, false);
        return { vault: v, bytes };
    }

    constructor(db, pw, kf, dav, etag, remoteBytes, cache) {
        this.db = db;
        this._pw = pw;
        this._kf = kf;
        this._base = { pw, kf }; // Zugangsdaten des letzten bekannten Server-Stands (weichen nach changeCredentials bis zum Hochladen ab)
        this.dav = dav || null;
        this.etag = etag;
        this._remoteBytes = remoteBytes;
        this._backedUp = false;
        this.backupKeep = 10; // Anzahl behaltener Sicherungskopien je Art (0 = nie loeschen)
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

    /** Zum Lesen des Server-Stands (Zusammenfuehren, Abholen): dessen Zugangsdaten, nicht unbedingt die eigenen. */
    _baseCredentials() {
        return new Credentials(this._base.pw, this._base.kf);
    }

    /** Stimmt pw mit dem Master-Passwort dieser Datenbank ueberein? Vergleicht nur Hashes, ohne Schluesselableitung. Ohne Passwort: nur "". */
    async checkPassword(pw) {
        if (!this._pw) return pw === '';
        const [a, b] = await Promise.all([ProtectedValue.fromString(pw).getHash(), this._pw.getHash()]);
        return sameBytes(a, b);
    }

    get hasKeyfile() { return !!this._kf; }
    /** false: Datenbank nur mit Schluesseldatei (kein Passwort-Anteil, auch kein leeres Passwort). */
    get hasPassword() { return !!this._pw; }
    /** Kopie der Schluesseldatei (zum Neu-Merken nach changeCredentials) oder null; der Aufrufer ueberschreibt sie danach mit Nullen. */
    keyfileCopy() { return this._kf ? new Uint8Array(this._kf.slice(0)) : null; }

    /**
     * Neues Master-Passwort und/oder neue Schluesseldatei, und gleich speichern. password: neuer Text oder undefined (bleibt);
     * keyfile: undefined (bleibt), null (entfaellt) oder die Bytes der neuen Datei. Bis zum ersten erfolgreichen Hochladen liest die
     * Vault den Server weiter mit den alten Zugangsdaten (Konflikt mit einem anderen Geraet -> Zusammenfuehren klappt).
     * Scheitert das Speichern, gelten wieder die alten Zugangsdaten; Aenderungen bleiben ungespeichert bzw. werden mit den alten
     * Zugangsdaten lokal abgelegt. Ergebnis wie save().
     */
    changeCredentials({ password, keyfile }) {
        return this._exclusive(async () => {
            const pw = password === undefined ? this._pw : ProtectedValue.fromString(password);
            const kf = keyfile === undefined ? this._kf : keyfile ? (keyfile instanceof ArrayBuffer ? keyfile.slice(0) : toArrayBuffer(keyfile)) : undefined;
            if (!pw && !kf) throw new VaultError('Ohne Passwort und Schluesseldatei liesse sich die Datenbank von jedem oeffnen.', 'e.cred.empty');
            const creds = new Credentials(pw, kf);
            // unlesbare Schluesseldatei (z. B. XML mit falscher Pruefsumme) jetzt melden, nicht erst beim Speichern
            try { await creds.ready; } catch { throw new VaultError('Diese Schluesseldatei ist unlesbar.', 'e.keyfile.bad'); }
            const prev = { pw: this._pw, kf: this._kf, creds: this.db.credentials, keyChanged: this.db.meta.keyChanged };
            this._pw = pw; this._kf = kf; this.db.credentials = creds;
            this.db.meta.keyChanged = new Date();
            try {
                return await this._save();
            } catch (e) {
                this._pw = prev.pw; this._kf = prev.kf; this.db.credentials = prev.creds; this.db.meta.keyChanged = prev.keyChanged;
                if (this._pending) { // lokal schon mit den neuen Zugangsdaten abgelegt: mit den alten neu ablegen, Hochladen folgt spaeter
                    try { this._pending = await this.db.save(); await this._cacheWrite(this._pending, true); } catch { this.dirty = true; }
                } else this.dirty = true;
                throw e;
            }
        });
    }

    /**
     * Der Server-Stand oeffnet nicht mehr mit den bekannten Zugangsdaten, weil sie auf einem anderen Geraet geaendert wurden
     * (e.merge.pw, e.pull.pw): mit den neuen pruefen, sie uebernehmen und gleich abgleichen. Lokale Aenderungen werden dabei wie
     * sonst zusammengefuehrt und mit den neuen Zugangsdaten gespeichert. Passen sie nicht: VaultError e.badkey, nichts geaendert.
     * Ergebnis wie save() bzw. sync().
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
            this.db = remoteDb; // nichts Lokales: der Server-Stand gilt (wie _pull)
            this.etag = remote.etag;
            this._remoteBytes = remote.buf;
            await this._cacheWrite(remote.buf, false);
            return { pulled: true };
        });
    }

    /**
     * Loescht alle Sicherungskopien dieser Datei auf dem Server (nach changeCredentials: die oeffnen mit den alten Zugangsdaten).
     * Nur sinnvoll, wenn der neue Stand hochgeladen ist. Liefert die Namen der geloeschten Dateien.
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
     * data: {Title, UserName, Password, URL, Notes, tags: string[], custom: [{name, value, protect}], expires?: boolean, expiryTime?: Date|null, otp?: string,
     *   icon?: number, customIcon?: string|null, excludeReports?: boolean} (Symbol: siehe _setIcon)
     * Unveraendert bleibt alles, was der Editor nicht anzeigt (Passkey-Felder, Browser-Daten, Farben, Auto-Type ...). Ohne tatsaechliche Aenderung
     * entsteht kein Verlaufseintrag (wie in KeePassXC).
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
        this._setIcon(entry, data);
        if (data.excludeReports !== undefined && data.excludeReports !== excluded(entry)) { // beide Schreibweisen, damit KeePass 2 und KeePassXC es sehen
            entry.qualityCheck = data.excludeReports ? false : undefined;
            if (data.excludeReports) (entry.customData ??= new Map()).set('KnownBad', { value: 'True' });
            else entry.customData?.delete('KnownBad');
        }
        entry.times.update();
        this.dirty = true;
        return entry;
    }

    /** true, wenn die Formularwerte vom gespeicherten Eintrag abweichen. */
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
        return this._iconDiffers(entry, data) || (data.excludeReports !== undefined && data.excludeReports !== excluded(entry));
    }

    /** Verlaufseintrag anlegen und gemaess Datenbank-Einstellungen kuerzen (Standard 10 Staende / 6 MiB, aelteste zuerst). */
    _pushHistory(entry) {
        entry.pushHistory();
        this._trimHistory(entry);
    }

    /**
     * Kuerzt den Verlauf eines Eintrags auf die Grenzen der Datenbank (oder die uebergebenen), aelteste Staende zuerst.
     * Grenzen wie in KDBX: -1 = unbegrenzt, 0 Staende = kein Verlauf; die Groessengrenze laesst den neuesten Stand immer stehen.
     * dryRun: nur zaehlen. Liefert die Zahl der (zu) entfernenden Staende.
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

    // ---------------------------------------------------------------- Sicherheits-Einstellungen (Dateikopf)
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

    /** Schluesselableitung im Format, das keyfile-store.js erwartet (siehe chooseKdfParams). */
    kdfParams() {
        const k = this.securitySettings();
        return { kdf: KDF_LABEL[k.kdf], memoryKiB: k.memoryKiB ?? 0, iterations: k.iterations ?? k.rounds };
    }

    /**
     * Aendert Format, Verschluesselung und Schluesselableitung. Argon2 und ChaCha20 gibt es erst ab KDBX 4: eine KDBX-3.1-Datei wird dafuer
     * umgestellt (ein Zurueck gibt es nicht). Neue Salze und IVs erzeugt kdbxweb beim Speichern ohnehin. "Einstellungen geaendert" wird
     * gesetzt, damit das Zusammenfuehren mit einem anderen Geraet (Vault._mergedHeader) den neueren Kopf erkennt.
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

    // ---------------------------------------------------------------- Datenbank-Einstellungen (Metadaten, nicht der Dateikopf)
    get binEnabled() { return this.db.meta.recycleBinEnabled !== false; }

    /** Loeschen ist hier endgueltig: Element liegt schon im Papierkorb, oder die Datenbank hat keinen. */
    deletesForever(item) { return !this.binEnabled || this.isInRecycleBin(item); }

    generalSettings() {
        const m = this.db.meta;
        return { name: m.name || '', desc: m.desc || '', defaultUser: m.defaultUser || '', recycleBin: this.binEnabled,
            historyMaxItems: m.historyMaxItems ?? 10, historyMaxSize: m.historyMaxSize ?? 6 * 1024 * 1024 };
    }

    /** So viele Verlaufsstaende fielen mit diesen Grenzen weg (fuer die Rueckfrage vor dem Uebernehmen). */
    historyTrimCount(limits) {
        let n = 0;
        for (const e of this.root.allEntries()) n += this._trimHistory(e, limits, true);
        return n;
    }

    /**
     * Uebernimmt die allgemeinen Einstellungen. Ueber die Setter von kdbxweb, damit die Aenderungszeiten stimmen und das Zusammenfuehren
     * mit einem anderen Geraet sie richtig zuordnet. Neue Verlaufsgrenzen gelten sofort fuer alle Eintraege (wie in KeePassXC).
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
        if (this.isInRecycleBin(entry)) this.db.move(entry, null); // endgueltig loeschen
        else this.db.remove(entry);
        this.dirty = true;
    }

    /**
     * Kopie mit neuer UUID, neuen Zeitstempeln und ohne Verlauf, in derselben Gruppe. Ein Passkey wird NICHT mitkopiert:
     * zwei Eintraege mit demselben privaten Schluessel und derselben Credential-ID verwirren die Browser-Erweiterung.
     * linked: Benutzername und Passwort zeigen per Feldreferenz ({REF:U@I:…}, {REF:P@I:…}) auf das Original, wie "Klonen" in KeePassXC.
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

    // ---------------------------------------------------------------- Gruppen
    allGroups() {
        const out = [];
        const walk = (g, depth) => { out.push({ group: g, depth }); for (const c of g.groups) walk(c, depth + 1); };
        walk(this.root, 0);
        return out;
    }
    createGroup(parent, name) { const g = this.db.createGroup(parent, name.trim() || 'Neue Gruppe'); this.dirty = true; return g; }
    /**
     * icon/customIcon: Symbol wie bei applyEntry. iconScope gibt es wie in KeePassXC: 'groups' (alle Untergruppen), 'entries' (Eintraege
     * direkt in der Gruppe) oder 'all' (alles darunter) bekommen dasselbe Symbol, ohne Verlaufseintrag.
     */
    updateGroup(group, { name, notes, icon, customIcon, iconScope }) {
        if (name !== undefined) group.name = name.trim() || group.name;
        if (notes !== undefined) group.notes = notes;
        this._setIcon(group, { icon, customIcon });
        group.times.update();
        if (iconScope && iconScope !== 'self') {
            const sel = { icon: group.icon, customIcon: group.customIcon?.id ?? null };
            const inBin = (g) => g === this.recycleBin || this.isInRecycleBin(g); // der Papierkorb unter der Wurzel bleibt, wie er ist
            const groups = iconScope === 'entries' ? [] : [...group.allGroups()].filter((g) => g !== group && (inBin(group) || !inBin(g)));
            const entries = iconScope === 'groups' ? [] : iconScope === 'entries' ? group.entries : [group, ...groups].flatMap((g) => g.entries);
            for (const item of [...groups, ...entries]) if (this._iconDiffers(item, sel)) { this._setIcon(item, sel); item.times.update(); }
        }
        this.dirty = true;
    }
    /** Papierkorb ist aktiv -> Gruppe wandert hinein; sonst endgueltig. */
    removeGroup(group) {
        if (group === this.root) throw new VaultError('Die Wurzelgruppe kann nicht geloescht werden.', 'e.root.delete');
        if (group === this.recycleBin) throw new VaultError('Der Papierkorb kann nicht geloescht werden - nur leeren.', 'e.bin.delete');
        if (this.isInRecycleBin(group)) this.db.move(group, null); else this.db.remove(group);
        this.dirty = true;
    }
    canMoveGroup(group, target) {
        if (group === this.root || !target || group === target || group.parentGroup === target) return false;
        for (let g = target; g; g = g.parentGroup) if (g === group) return false; // nicht in sich selbst/Nachkommen
        return true;
    }
    moveGroup(group, target) {
        if (!this.canMoveGroup(group, target)) return false;
        this.db.move(group, target);
        this.dirty = true;
        return true;
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

    // ---------------------------------------------------------------- Verlauf
    /** Stellt einen frueheren Stand wieder her; der aktuelle Stand wird dabei selbst zum Verlaufseintrag. */
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

    // ---------------------------------------------------------------- Anhaenge
    async addAttachment(entry, name, buffer) {
        if (!name || entry.binaries.has(name)) throw new VaultError(`Ein Anhang namens "${name}" existiert bereits.`, 'e.att.exists', { name });
        const bin = await this.db.createBinary(buffer);
        this._pushHistory(entry);
        entry.binaries.set(name, bin);
        entry.times.update();
        this.dirty = true;
    }
    /** Passkey aus dem Eintrag entfernen; der Stand davor bleibt im Verlauf (zurueckholbar, bis der Verlauf geleert wird). */
    removePasskey(entry) {
        const keys = [...entry.fields.keys()].filter(isPasskeyField);
        if (!keys.length) return false;
        this._pushHistory(entry);
        for (const k of keys) entry.fields.delete(k);
        entry.times.update();
        this.dirty = true;
        return true;
    }
    removeAttachment(entry, name) {
        if (!entry.binaries.has(name)) return;
        this._pushHistory(entry);
        entry.binaries.delete(name);
        entry.times.update();
        this.dirty = true;
    }

    // ---------------------------------------------------------------- Symbole
    // Wie KeePass/KeePassXC: jedes Element hat ein Standard-Symbol (IconID 0-68) und optional ein eigenes (UUID in meta.customIcons), das in
    // der Anzeige gewinnt. Wer ein eigenes waehlt, behaelt die IconID als Rueckfall fuer Programme ohne eigene Symbole.
    /** sel: {icon?: number, customIcon?: string|null}; undefined laesst den jeweiligen Teil unveraendert. */
    _setIcon(item, { icon, customIcon }) {
        if (Number.isInteger(icon) && icon >= 0 && icon < 69) item.icon = icon;
        if (customIcon === null) item.customIcon = undefined;
        else if (customIcon !== undefined && customIcon !== item.customIcon?.id) item.customIcon = this.db.meta.customIcons.has(customIcon) ? new KdbxUuid(customIcon) : undefined;
    }
    _iconDiffers(item, { icon, customIcon }) {
        if (customIcon !== undefined && (customIcon || null) !== (item.customIcon?.id ?? null)) return true;
        return icon !== undefined && icon !== (item.icon ?? (item instanceof kdbxweb.KdbxGroup ? 48 : 0));
    }

    /** Alle eigenen Symbole der Datei: [{id, name, url}] (url null, wenn das Format nicht angezeigt wird). */
    customIcons() {
        return [...this.db.meta.customIcons].map(([id, ic]) => ({ id, name: ic.name || '', url: this.iconUrl(id) }));
    }
    /**
     * Neues eigenes Symbol (PNG-Bytes, schon verkleinert). Gibt es dieselben Bytes schon, wird das vorhandene benutzt (wie KeePassXC).
     * @returns {string} UUID des Symbols
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
    /** UUID des eigenen Symbols mit genau diesen Bytes (oder null). */
    findCustomIcon(bytes) {
        const u8 = new Uint8Array(bytes);
        for (const [id, ic] of this.db.meta.customIcons) {
            const o = new Uint8Array(ic.data);
            if (o.length === u8.length && o.every((b, i) => b === u8[i])) return id;
        }
        return null;
    }
    /** Wie viele Eintraege und Gruppen (ohne Verlauf) das Symbol benutzen. */
    customIconUsage(id) {
        let n = 0;
        for (const item of this.root.allGroupsAndEntries()) if (item.customIcon?.id === id) n++;
        return n;
    }
    /**
     * Symbol aus der Datei entfernen; wer es benutzt, zeigt wieder sein Standard-Symbol (auch im Verlauf). Der Loeschvermerk verhindert,
     * dass es beim Zusammenfuehren mit einem anderen Stand zurueckkommt (wie kdbxweb beim Aufraeumen).
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

    /** data:-URL eines eigenen Icons (oder null). */
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

    /** Eckdaten der Datei fuer die Info-Ansicht (Kopfdaten aus securitySettings, als Anzeigetext). */
    info() {
        const s = this.securitySettings(), argon = s.kdf !== 'aes';
        return {
            version: this.versionLabel, name: this.db.meta.name || '',
            cipher: CIPHER_LABEL[s.cipher] || this.db.header.dataCipherUuid?.toString?.() || '?', kdf: KDF_LABEL[s.kdf],
            memoryMiB: argon ? Math.round(s.memoryKiB / 1024) : null, iterations: argon ? s.iterations : s.rounds, parallelism: argon ? s.parallelism : null
        };
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

    /**
     * Sicherungskopie neben der Datei. Darf man im Ordner keine neuen Dateien anlegen (Nextcloud-Freigabe "Bearbeiten" ohne
     * "Erstellen", 403), wird ohne Kopie weitergespeichert und das gemeldet (noBackup), statt das Speichern ganz zu blockieren.
     */
    async _backup(buf, suffix) {
        try {
            await this.dav.putCopy(buf, suffix);
        } catch (e) {
            if (!(e instanceof DavError && e.status === 403)) throw e;
            this.noBackup = true;
        }
    }

    /** Alte Sicherungskopien aufraeumen; Fehler hier duerfen nie das Speichern stoeren. */
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
                this.etag = await this.dav.put(out, this.etag);
                this._remoteBytes = out;
                this._base = { pw: this._pw, kf: this._kf };
                this.unsynced = false;
                this._pending = null;
                await this._cacheWrite(out, false);
                return { merged, noBackup: this.noBackup };
            } catch (e) {
                if (!(e instanceof ConflictError)) throw e;
                if (attempt >= 3) throw new VaultError('Die Datei wird gerade von einem anderen Geraet laufend geaendert - bitte spaeter erneut speichern. Ihre Aenderungen sind lokal gesichert.', 'e.busy');
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
     * Welcher Dateikopf (Format, Verschluesselung, Schluesselableitung) nach dem Zusammenfuehren gilt. merge() von kdbxweb uebernimmt
     * nur Inhalt und Metadaten; ohne diese Wahl wuerde ein Speichern hier eine auf einem anderen Geraet geaenderte, z. B. verstaerkte
     * Schluesselableitung still auf den alten Stand zuruecksetzen. Verglichen wird mit dem letzten gemeinsamen Server-Stand:
     * Hat nur der Server ihn geaendert, gilt seiner; nur lokal: der lokale; beide: der mit dem neueren "Einstellungen geaendert".
     */
    _mergedHeader(remoteDb) {
        const local = this.db.header, remote = remoteDb.header;
        const remoteSet = cryptoSettings(remote);
        if (remoteSet === cryptoSettings(local)) return local;
        let base = null;
        try { base = cryptoSettings(this._remoteBytes); } catch { /* unlesbarer Basisstand: wie "beide geaendert" behandeln */ }
        if (remoteSet === base) return local;
        if (cryptoSettings(local) === base) return remote;
        return (this.db.meta.settingsChanged?.getTime() ?? 0) > (remoteDb.meta.settingsChanged?.getTime() ?? 0) ? local : remote;
    }

    async _pull() {
        const etag = await this.dav.head();
        if (etag && etag === this.etag) return { pulled: false };
        const remote = await this.dav.get();
        if (this.dirty || this.unsynced) return { pulled: false }; // waehrenddessen lokal geaendert: Zusammenfuehrung beim naechsten Speichern
        if (remote.etag && remote.etag === this.etag) return { pulled: false };
        let remoteDb;
        try {
            remoteDb = await Kdbx.load(remote.buf, this._baseCredentials());
        } catch (e) {
            if (e instanceof KdbxError && e.code === Consts.ErrorCodes.InvalidKey) {
                throw new VaultError('Die Zugangsdaten wurden auf einem anderen Geraet geaendert.', 'e.pull.pw');
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
