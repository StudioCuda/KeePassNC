// Local offline copy: stores the ENCRYPTED KDBX (exactly the bytes that also sit on the server) in IndexedDB.
// Entry: {bytes: ArrayBuffer, etag, modified: boolean, name, syncDate}. "modified" = local changes the server doesn't have yet.
// Plaintext, master password and key file are never stored here.
const DB_NAME = 'keepassnc';
const STORE = 'files';

let dbPromise = null;
function db() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB nicht verfuegbar'));
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }).catch((e) => { dbPromise = null; throw e; });
    }
    return dbPromise;
}

function tx(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaktion abgebrochen'));
    }));
}

export const cacheGet = (key) => tx('readonly', (s) => s.get(key));
export const cachePut = (key, rec) => tx('readwrite', (s) => s.put(rec, key));
export const cacheDelete = (key) => tx('readwrite', (s) => s.delete(key));
export const cacheClear = () => tx('readwrite', (s) => s.clear());
export const cacheKeys = () => tx('readonly', (s) => s.getAllKeys());

/** Removes everything this app stored locally (offline copies, page cache, service worker, settings). */
export async function wipeLocalData() {
    try { await cacheClear(); } catch { /* nothing to delete */ }
    try {
        if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (k.startsWith('kpnc-')) await caches.delete(k);
    } catch { /* ignore */ }
    try {
        if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    } catch { /* ignore */ }
    try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('kpnc.')) localStorage.removeItem(k);
    } catch { /* ignore */ }
}

/** Key file marker (encrypted, see keyfile-store.js) lives in the same storage and is wiped along with it by wipeLocalData. */
export const keyfileBackend = { get: cacheGet, put: cachePut, delete: cacheDelete, keys: cacheKeys };
