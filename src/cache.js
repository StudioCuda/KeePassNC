// Lokale Offline-Kopie: legt die VERSCHLUESSELTE KDBX (exakt die Bytes, die auch auf dem Server liegen) in IndexedDB ab.
// Eintrag: {bytes: ArrayBuffer, etag, modified: boolean, name, syncDate}. "modified" = lokale Aenderungen, die der Server noch nicht hat.
// Klartext, Master-Passwort und Schluesseldatei werden hier nie gespeichert.
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

/** Entfernt alles, was diese App lokal abgelegt hat (Offline-Kopien, Seiten-Cache, Service Worker, Einstellungen). */
export async function wipeLocalData() {
    try { await cacheClear(); } catch { /* nichts zu loeschen */ }
    try {
        if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (k.startsWith('kpnc-')) await caches.delete(k);
    } catch { /* ignorieren */ }
    try {
        if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    } catch { /* ignorieren */ }
    try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('kpnc.')) localStorage.removeItem(k);
    } catch { /* ignorieren */ }
}
