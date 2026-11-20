// Shared browser launch for the Playwright tests.
// BROWSER=chromium (default) | firefox | webkit. CHROMIUM can point Chromium at a fixed executable.
import { chromium, firefox, webkit } from 'playwright-core';

export const browserName = process.env.BROWSER || 'chromium';

// Known quirk of WebKit (Playwright build): every <select> triggers a "style-src-attr" violation, even on an empty page
// without our code. The console message doesn't name the element; that's why webkitCspWatch still reports every violation outside <select>
// itself. Only use together: knownEngineNoise (hide) + webkitCspWatch (cross-check).
// Same quirk, second shape: when the <select> is already gone again (a dialog closes quickly) or was never attached, WebKit reports
// the violation on the document instead of the select, always as style-src-attr / inline. A real inline style on an element that
// is in the page names that element and still fails the test.
export const knownEngineNoise = (text) => browserName === 'webkit'
    && /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/.test(text);
// Second quirk of WebKit: if a request aborts because the server goes away during the request, WebKit sometimes reports it as a
// page error "Fetch API cannot load <URL> due to access control checks", although the app catches the error. Hide it only for WebDAV URLs
// and only use together with uncaughtWatch: that still reports real, uncaught errors.
export const knownFetchNoise = (text) => browserName === 'webkit'
    && /^(?:TypeError: )?Fetch API cannot load [^ ]*:? ?\/[^ ]*\/dav\/\S* due to access control checks\.?$/.test(text);
export const uncaughtWatch = () => {
    addEventListener('unhandledrejection', (e) => console.error(`UNCAUGHT: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
    addEventListener('error', (e) => console.error(`UNCAUGHT: ${e.message}`));
};
export const webkitCspWatch = () => document.addEventListener('securitypolicyviolation', (e) => {
    const selectQuirk = e.target instanceof HTMLSelectElement
        || (e.target instanceof Document && e.violatedDirective === 'style-src-attr' && e.blockedURI === 'inline');
    if (!selectQuirk) console.error(`CSP-Verstoss ausserhalb von <select>: ${e.violatedDirective} ${e.blockedURI} ${String((e.target && e.target.outerHTML) || e.target).slice(0, 120)}`);
}, true);

// The test servers offer WebDAV at /dav/, not at a Nextcloud address: set login and "New database" of the standalone
// page to "Custom WebDAV address" (and the source to WebDAV: without a choice it starts with "Local file") (as for someone who already uses it that way). As an init script of a browser context.
export const plainWebdav = () => { try { if (!localStorage.getItem('kpnc.davmode')) localStorage.setItem('kpnc.davmode', 'url'); if (!localStorage.getItem('kpnc.mode')) localStorage.setItem('kpnc.mode', 'dav'); } catch {} };

// Latest console messages per page, for waitOpened. Attached on the first call; whatever came before is missing.
const consoleTails = new WeakMap();
function consoleTail(page) {
    let tail = consoleTails.get(page);
    if (!tail) {
        tail = [];
        consoleTails.set(page, tail);
        page.on('console', (m) => { tail.push(`${m.type()}: ${m.text()}`.slice(0, 300)); if (tail.length > 5) tail.shift(); });
    }
    return tail;
}

/**
 * Init script for a browser context: notes the steps of opening a database (WebDAV download finished, key file read, Argon2
 * worker started/answered/failed/ended) in window.__kpncTrace, so waitOpened can say which step never finished when the login
 * hangs. It only watches: the app gets the same Worker, Blob and promises as without it. Paths and file names only, no contents.
 */
export const openTrace = () => {
    // ms since the page started; resource timing arrives a little late, so it brings its own time
    const log = (s, at = performance.now()) => { const l = (window.__kpncTrace ||= []); l.push(`${s} @${Math.round(at)}ms`); if (l.length > 16) l.shift(); };
    try {
        new PerformanceObserver((list) => { for (const e of list.getEntries()) if (/\/dav\//.test(e.name) && /fetch|xmlhttprequest/.test(e.initiatorType)) log(`fetch done ${new URL(e.name).pathname.split('/').pop()}`, e.responseEnd); }).observe({ type: 'resource' });
    } catch { /* no resource timing: the other steps still show */ }
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
        const name = this.name || 'blob', p = read.call(this);
        if (this instanceof File) { log(`read ${name}`); p.then((b) => log(`read ${name} done ${b.byteLength} B`), (e) => log(`read ${name} failed ${e}`)); }
        return p;
    };
    const Base = window.Worker; let n = 0;
    if (!Base) return;
    window.Worker = class extends Base {
        constructor(url, opts) {
            super(url, opts);
            const id = `worker#${++n} ${String(url).split('/').pop().split('?')[0]}`;
            log(`${id} new`);
            this.addEventListener('message', (e) => log(`${id} message${e.data && typeof e.data === 'object' ? ` ok=${e.data.ok}` : ''}`));
            this.addEventListener('messageerror', () => log(`${id} messageerror`));
            this.addEventListener('error', (e) => log(`${id} error ${e.message || ''}`));
            const end = this.terminate.bind(this);
            this.terminate = () => { log(`${id} terminate`); end(); };
        }
    };
};

/**
 * Waits until the database is open (.shell). If that fails, the error says where the login stood: button text
 * ("Entschlüssele …" = still stuck in network/KDF), error message, status, the steps of opening (with openTrace in the
 * context) and the latest console messages. A timeout alone doesn't tell whether the app hangs or failed silently.
 */
export async function waitOpened(page, timeout) {
    const tail = consoleTail(page);
    try {
        await page.locator('.shell').waitFor({ timeout });
    } catch (e) {
        const state = await page.evaluate(() => ({
            button: document.querySelector('#open-btn')?.textContent?.trim(),
            error: document.querySelector('#login-error')?.textContent?.trim(),
            status: document.querySelector('#status')?.textContent?.trim(),
            trace: window.__kpncTrace
        })).catch((x) => ({ unreadable: String(x).split('\n')[0] }));
        const { trace, ...login } = state;
        throw new Error([`${String(e.message).split('\n')[0]}`, `Anmeldung: ${JSON.stringify(login)}`,
            ...(trace ? [`Ablauf: ${trace.join(' > ') || '(nichts)'}`] : []), ...tail.map((t) => `Konsole ${t}`)].join('\n'));
    }
}

export async function launchBrowser() {
    if (browserName === 'chromium') {
        // without CHROMIUM: the Chromium installed by Playwright (npx playwright-core install chromium)
        return chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
    }
    const engine = { firefox, webkit }[browserName];
    if (!engine) throw new Error(`BROWSER="${browserName}" unbekannt (chromium, firefox oder webkit)`);
    return engine.launch();
}
