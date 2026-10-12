// "Schluesseldatei merken" (optional, standardmaessig AUS): legt die Schluesseldatei verschluesselt auf diesem Geraet ab, damit sie nicht bei
// jeder Anmeldung neu gewaehlt werden muss.
//
// Sicherheitsentwurf (ausfuehrlich: docs/KEYFILE-MEMORY.md):
//  * Der Schluessel zum Entschluesseln wird aus dem MASTER-PASSWORT abgeleitet (Argon2id). Die Kosten je Passwort-Tipp sind MINDESTENS so hoch
//    wie bei der Datenbank-KDF (Arbeit = Speicher x Durchlaeufe; ist der Speicher nach oben begrenzt, werden die Durchlaeufe erhoeht),
//    mindestens 64 MiB / 3 Durchlaeufe. Bei AES-KDF (nicht vergleichbar) fest 64 MiB / 16.
//    Es gibt KEINEN geraetegebundenen Schluessel, der ohne Master-Passwort nutzbar waere (ein nicht-exportierbarer WebCrypto-Schluessel schuetzt
//    nicht vor Skripten derselben Herkunft und nicht vor einer kopierten Browser-Profil-Datei).
//  * Verschluesselung: AES-256-GCM, zufaelliger 96-Bit-IV, zufaelliges 128-Bit-Salz (=> je Datensatz eigener Schluessel), AAD = Format + Datei-Kennung.
//  * Gespeichert werden nur: Kennung, Anzeigename, Zeitstempel, KDF-Parameter, Salz, IV, Chiffrat. Nie: Master-Passwort, abgeleiteter Schluessel, Klartext.
//  * Restrisiko (bewusst, dokumentiert): Wer eine Kopie des Browser-Profils hat (oder ein Skript derselben Herkunft den Datensatz auslesen laesst),
//    kann das Master-Passwort OFFLINE raten und prueft jeden Tipp am GCM-Tag - OHNE dass die Schluesseldatei als zweiter Faktor noetig waere.
//    Fuer dieses Geraet ist die Schluesseldatei dann kein zweiter Faktor mehr; das Master-Passwort muss das allein tragen.
import { argon2id } from 'hash-wasm';

// min*: Untergrenzen beim Anlegen. max*: Obergrenzen beim Anlegen UND Lesen (Schutz vor Speicher-/Zeitbomben aus manipulierten Datensaetzen).
// acceptMin*: Untergrenzen beim Lesen - bewusst niedriger als min*, damit ein spaeteres Anheben der Untergrenzen alte Datensaetze nicht unbrauchbar macht
// (ein Datensatz mit zu schwachen Parametern laesst sich ohne Master-Passwort ohnehin nicht gueltig erzeugen).
export const limits = {
    minMemoryKiB: 65536, minIterations: 3,
    maxMemoryKiB: 1048576, maxIterations: 64,
    acceptMinMemoryKiB: 8192, acceptMinIterations: 1,
    aesKdf: { memoryKiB: 65536, iterations: 16 },
    maxBytes: 8 * 1024 * 1024
};
const FORMAT = 'kpnc-keyfile-v1'; // nur Master-Passwort (eigenstaendige Seite ohne Server-Geheimwert)
const FORMAT2 = 'kpnc-keyfile-v2'; // Master-Passwort + Server-Geheimwert (Nextcloud); Anzeigename authentisiert
const PREFIX = 'kf:';

export class KeyfileStoreError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
}

const enc = new TextEncoder();
const aad = (id) => enc.encode(`${FORMAT}\0${id}`);
const aad2 = (id, pepperId, name) => enc.encode(`${FORMAT2}\0${pepperId}\0${id}\0${name}`);

/** pepper = {id, key: Uint8Array(32)} oder null. Mit Pepper: AES-Schluessel = HKDF-SHA256(Argon2id(Passwort), salt = Pepper). */
async function deriveKey(password, salt, { memoryKiB, iterations }, pepper = null) {
    const raw = await argon2id({ password: enc.encode(password), salt, parallelism: 1, iterations, memorySize: memoryKiB, hashLength: 32, outputType: 'binary' });
    try {
        if (!pepper) return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        const ikm = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
        return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: pepper.key, info: enc.encode(FORMAT2) }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } finally {
        raw.fill(0);
    }
}
const validPepper = (p) => p && /^[0-9a-f]{32}$/.test(String(p.id)) && p.key?.byteLength === 32;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? Math.round(v) : lo));

/**
 * Argon2id-Parameter fuer den Datensatz aus den Parametern der Datenbank-KDF: gleiche oder hoehere Arbeit (Speicher x Durchlaeufe).
 * db = {kdf: 'Argon2d'|'Argon2id'|'AES-KDF', memoryKiB, iterations} (wie Vault.info(), Speicher in KiB).
 */
export function chooseKdfParams(db = {}) {
    const m = Number(db.memoryKiB), t = Number(db.iterations);
    if (db.kdf === 'AES-KDF' || !(m > 0) || !(t > 0)) return { ...limits.aesKdf };
    const memoryKiB = clamp(m, limits.minMemoryKiB, limits.maxMemoryKiB);
    const iterations = clamp(Math.ceil((m * t) / memoryKiB), limits.minIterations, limits.maxIterations);
    return { memoryKiB, iterations };
}
/** true, wenn ein Datensatz mit diesen Parametern weniger Arbeit je Tipp kostet als heute fuer die Datenbank gewaehlt wuerde (-> neu verschluesseln). */
export function isWeakerThan(recKdf, db) {
    const want = chooseKdfParams(db);
    return !(recKdf?.memoryKiB * recKdf?.iterations >= want.memoryKiB * want.iterations) || !(recKdf.memoryKiB >= Math.min(want.memoryKiB, limits.maxMemoryKiB));
}
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** backend: {get(key), put(key, value), delete(key), keys()} - in der App IndexedDB (cache.js), im Test eine Map. */
export function createKeyfileStore(backend) {
    return {
        /**
         * Verschluesselt und speichert. params = {kdf, memoryKiB, iterations} der Datenbank-KDF (siehe chooseKdfParams).
         * pepper = {id, key} vom Server (Nextcloud) -> Format v2; ohne -> v1 (nur Master-Passwort).
         */
        async remember({ id, name, keyfile, password, params = {}, pepper = null }) {
            if (!id) throw new KeyfileStoreError('id');
            if (!password) throw new KeyfileStoreError('password');
            if (!keyfile || keyfile.byteLength === 0) throw new KeyfileStoreError('empty');
            if (keyfile.byteLength > limits.maxBytes) throw new KeyfileStoreError('toolarge');
            if (pepper && !validPepper(pepper)) throw new KeyfileStoreError('pepper');
            const kdf = { alg: 'argon2id', ...chooseKdfParams(params), salt: crypto.getRandomValues(new Uint8Array(16)) };
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const nm = String(name || '');
            const key = await deriveKey(password, kdf.salt, kdf, pepper);
            const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: pepper ? aad2(id, pepper.id, nm) : aad(id) }, key, keyfile);
            await backend.put(PREFIX + id, { format: pepper ? FORMAT2 : FORMAT, id, name: nm, created: Date.now(), kdf, iv, ct, ...(pepper ? { pepperId: pepper.id } : {}) });
        },
        /**
         * null = nichts gemerkt. Fehler (KeyfileStoreError.code): 'wrong' = Master-Passwort passt nicht (oder Datensatz verfaelscht),
         * 'format' = unbrauchbarer Datensatz, 'pepper' = v2-Datensatz braucht den Server-Geheimwert (pepper fehlt),
         * 'revoked' = Server-Geheimwert wurde erneuert -> Datensatz ist auf allen Geraeten ungueltig.
         */
        async recall({ id, password, pepper = null }) {
            const rec = await backend.get(PREFIX + id);
            if (!rec) return null;
            const v2 = rec.format === FORMAT2;
            if ((rec.format !== FORMAT && !v2) || rec.kdf?.alg !== 'argon2id' || rec.id !== id) throw new KeyfileStoreError('format');
            if (v2 && !/^[0-9a-f]{32}$/.test(String(rec.pepperId))) throw new KeyfileStoreError('format');
            if (v2 && !pepper) throw new KeyfileStoreError('pepper');
            if (v2 && !validPepper(pepper)) throw new KeyfileStoreError('pepper');
            if (v2 && pepper.id !== rec.pepperId) throw new KeyfileStoreError('revoked');
            // Parameter aus einem manipulierten Datensatz duerfen den Browser nicht lahmlegen
            const kdf = { memoryKiB: rec.kdf.memoryKiB, iterations: rec.kdf.iterations };
            if (!inRange(kdf.memoryKiB, limits.acceptMinMemoryKiB, limits.maxMemoryKiB) || !inRange(kdf.iterations, limits.acceptMinIterations, limits.maxIterations)) throw new KeyfileStoreError('format');
            if (!(rec.kdf.salt?.byteLength >= 16) || rec.iv?.byteLength !== 12) throw new KeyfileStoreError('format');
            const key = await deriveKey(password, new Uint8Array(rec.kdf.salt), kdf, v2 ? pepper : null);
            try {
                return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(rec.iv), additionalData: v2 ? aad2(id, rec.pepperId, String(rec.name ?? '')) : aad(id) }, key, rec.ct));
            } catch {
                throw new KeyfileStoreError('wrong');
            }
        },
        async info(id) {
            const rec = await backend.get(PREFIX + id);
            return rec ? { id, name: rec.name, created: rec.created, format: rec.format, server: rec.format === FORMAT2, pepperId: rec.pepperId || null, kdf: { memoryKiB: rec.kdf?.memoryKiB, iterations: rec.kdf?.iterations } } : null;
        },
        forget: (id) => backend.delete(PREFIX + id),
        /** scope(id) -> boolean: nur passende Datensaetze (z. B. nur die des angemeldeten Nextcloud-Benutzers). */
        async list(scope = () => true) {
            const out = [];
            for (const k of await backend.keys()) if (typeof k === 'string' && k.startsWith(PREFIX) && scope(k.slice(PREFIX.length))) { const r = await backend.get(k); if (r) out.push({ id: r.id, name: r.name, created: r.created, server: r.format === FORMAT2 }); }
            return out.sort((a, b) => b.created - a.created);
        },
        async forgetAll(scope = () => true) { for (const k of await backend.keys()) if (typeof k === 'string' && k.startsWith(PREFIX) && scope(k.slice(PREFIX.length))) await backend.delete(k); }
    };
}
