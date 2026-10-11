// Service Worker: haelt die App-Seite (HTML, JS, CSS) vor, damit KeePassNC auch bei Ausfall des Servers startet.
// Er beruehrt keine Anfragen an WebDAV oder die Anmeldung; die Dateien selbst liegen verschluesselt in IndexedDB (cache.js).
const CACHE = 'kpnc-app-v1';
const ASSET = /\.(?:js|css|svg|png|wasm)$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    const scopePath = new URL(self.registration.scope).pathname;
    const isNav = req.mode === 'navigate' && url.pathname.startsWith(scopePath);
    const isAsset = ASSET.test(url.pathname) && url.pathname.includes('keepassnc');
    if (!isNav && !isAsset) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const key = isNav ? new Request(url.origin + url.pathname) : req; // Seite ohne Query ablegen (kein ?open= im Offline-Rahmen)
        try {
            const res = await withTimeout(fetch(req), isNav ? 4000 : 8000);
            if (res.ok && !res.redirected) {
                // Nur die neutrale Seite (ohne Query) und Assets merken; Weiterleitungen (z. B. Login-Seite) nie.
                if (!isNav || url.search === '') cache.put(key, res.clone()).catch(() => {});
                return res;
            }
            if (res.status < 500 && res.status !== 0) return res; // 3xx/4xx sind echte Antworten des Servers
        } catch { /* Server nicht erreichbar -> Cache */ }
        const hit = await cache.match(key);
        if (hit) return hit;
        return fetch(req); // nichts im Cache: normales Verhalten (Fehler/Antwort durchreichen)
    })());
});
