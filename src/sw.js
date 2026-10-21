// Service worker: keeps the app page (HTML, JS, CSS) available so KeePassNC also starts when the server is down.
// It doesn't touch requests to WebDAV or the login; the files themselves live encrypted in IndexedDB (cache.js).
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
        const key = isNav ? new Request(url.origin + url.pathname) : req; // store the page without a query (no ?open= in the offline frame)
        try {
            const res = await withTimeout(fetch(req), isNav ? 4000 : 8000);
            if (res.ok && !res.redirected) {
                // Only remember the neutral page (without a query) and assets; never redirects (e.g. login page).
                if (!isNav || url.search === '') cache.put(key, res.clone()).catch(() => {});
                return res;
            }
            if (res.status < 500 && res.status !== 0) return res; // 3xx/4xx are real answers from the server
        } catch { /* server unreachable -> cache */ }
        const hit = await cache.match(key);
        if (hit) return hit;
        return fetch(req); // nothing in the cache: normal behaviour (pass the error/response through)
    })());
});
