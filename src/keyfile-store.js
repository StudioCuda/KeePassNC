// "Remember key file" (optional, off by default): stores the key file encrypted on this device so it doesn't have to be picked again on
// every login.
//
// Security design (details: docs/KEYFILE-MEMORY.md):
//  * The decryption key is derived from the MASTER PASSWORD (Argon2id). The cost per password guess is AT LEAST as high as for the database
//    KDF (work = memory x iterations; if memory is capped, iterations are raised),
//    at least 64 MiB / 3 iterations. For AES-KDF (not comparable) a fixed 64 MiB / 16.
//    There is NO device-bound key that would work without the master password (a non-exportable WebCrypto key doesn't protect
//    against scripts from the same origin or against a copied browser profile file).
//  * Encryption: AES-256-GCM, random 96-bit IV, random 128-bit salt (=> separate key per record), AAD = format + file ID.
//  * Only stored: ID, display name, timestamp, KDF parameters, salt, IV, ciphertext. Never: master password, derived key, plaintext.
//  * Residual risk (deliberate, documented): anyone with a copy of the browser profile (or a same-origin script that gets to read the record)
//    can guess the master password OFFLINE and checks each guess against the GCM tag - WITHOUT needing the key file as a second factor.
//    For this device the key file is then no longer a second factor; the master password has to carry that alone.
import { argon2 } from './argon2.js';

// min*: lower bounds when creating. max*: upper bounds when creating AND reading (protection against memory/time bombs from tampered records).
// acceptMin*: lower bounds when reading - deliberately lower than min*, so raising the lower bounds later doesn't make old records unusable
// (a record with too-weak parameters can't be forged without the master password anyway).
export const limits = {
    minMemoryKiB: 65536, minIterations: 3,
    maxMemoryKiB: 1048576, maxIterations: 64,
    acceptMinMemoryKiB: 8192, acceptMinIterations: 1,
    aesKdf: { memoryKiB: 65536, iterations: 16 },
    maxBytes: 8 * 1024 * 1024
};
const FORMAT = 'kpnc-keyfile-v1'; // only master password (standalone page without a server secret)
const FORMAT2 = 'kpnc-keyfile-v2'; // master password + server secret (Nextcloud); display name authenticated
const PREFIX = 'kf:';

export class KeyfileStoreError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
}

const enc = new TextEncoder();
const aad = (id) => enc.encode(`${FORMAT}\0${id}`);
const aad2 = (id, pepperId, name) => enc.encode(`${FORMAT2}\0${pepperId}\0${id}\0${name}`);

/** pepper = {id, key: Uint8Array(32)} or null. With pepper: AES key = HKDF-SHA256(Argon2id(password), salt = pepper). */
async function deriveKey(password, salt, { memoryKiB, iterations }, pepper = null) {
    const raw = await argon2({ type: 'id', password: enc.encode(password), salt, parallelism: 1, iterations, memoryKiB, hashLength: 32 });
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
 * Argon2id parameters for the record, derived from the database KDF parameters: same or higher work (memory x iterations).
 * db = {kdf: 'Argon2d'|'Argon2id'|'AES-KDF', memoryKiB, iterations} (siehe Vault.kdfParams()).
 */
export function chooseKdfParams(db = {}) {
    const m = Number(db.memoryKiB), t = Number(db.iterations);
    if (db.kdf === 'AES-KDF' || !(m > 0) || !(t > 0)) return { ...limits.aesKdf };
    const memoryKiB = clamp(m, limits.minMemoryKiB, limits.maxMemoryKiB);
    const iterations = clamp(Math.ceil((m * t) / memoryKiB), limits.minIterations, limits.maxIterations);
    return { memoryKiB, iterations };
}
/** true if a record with these parameters costs less work per guess than would be chosen for the database today (-> re-encrypt). */
export function isWeakerThan(recKdf, db) {
    const want = chooseKdfParams(db);
    return !(recKdf?.memoryKiB * recKdf?.iterations >= want.memoryKiB * want.iterations) || !(recKdf.memoryKiB >= Math.min(want.memoryKiB, limits.maxMemoryKiB));
}
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** backend: {get(key), put(key, value), delete(key), keys()} - IndexedDB in the app (cache.js), a Map in tests. */
export function createKeyfileStore(backend) {
    return {
        /**
         * Encrypts and stores. params = {kdf, memoryKiB, iterations} of the database KDF (see chooseKdfParams).
         * pepper = {id, key} from the server (Nextcloud) -> format v2; without -> v1 (master password only).
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
         * null = nothing remembered. Errors (KeyfileStoreError.code): 'wrong' = master password doesn't match (or record tampered with),
         * 'format' = unusable record, 'pepper' = v2 record needs the server secret (pepper missing),
         * 'revoked' = server secret was renewed -> record is invalid on all devices.
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
            // parameters from a tampered record must not be able to cripple the browser
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
        /** scope(id) -> boolean: only matching records (e.g. only those of the signed-in Nextcloud user). */
        async list(scope = () => true) {
            const out = [];
            for (const k of await backend.keys()) if (typeof k === 'string' && k.startsWith(PREFIX) && scope(k.slice(PREFIX.length))) { const r = await backend.get(k); if (r) out.push({ id: r.id, name: r.name, created: r.created, server: r.format === FORMAT2 }); }
            return out.sort((a, b) => b.created - a.created);
        },
        async forgetAll(scope = () => true) { for (const k of await backend.keys()) if (typeof k === 'string' && k.startsWith(PREFIX) && scope(k.slice(PREFIX.length))) await backend.delete(k); }
    };
}
