// Shared browser launch for the Playwright tests.
// BROWSER=chromium (default) | firefox | webkit. CHROMIUM can point Chromium at a fixed executable.
import { chromium, firefox, webkit } from 'playwright-core';

export const browserName = process.env.BROWSER || 'chromium';

// Known quirk of WebKit (Playwright build): every <select> triggers a "style-src-attr" violation, even on an empty page
// without our code. The console message doesn't name the element; that's why webkitCspWatch still reports every violation outside <select>
// itself. Only use together: knownEngineNoise (hide) + webkitCspWatch (cross-check).
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
    if (!(e.target instanceof HTMLSelectElement)) console.error(`CSP-Verstoss ausserhalb von <select>: ${e.violatedDirective} ${e.blockedURI} ${String((e.target && e.target.outerHTML) || e.target).slice(0, 120)}`);
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
 * Waits until the database is open (.shell). If that fails, the error says where the login stood: button text
 * ("Entschlüssele …" = still stuck in network/KDF), error message, status and the latest console messages. A timeout alone
 * doesn't tell whether the app hangs or failed silently.
 */
export async function waitOpened(page, timeout) {
    const tail = consoleTail(page);
    try {
        await page.locator('.shell').waitFor({ timeout });
    } catch (e) {
        const state = await page.evaluate(() => ({
            button: document.querySelector('#open-btn')?.textContent?.trim(),
            error: document.querySelector('#login-error')?.textContent?.trim(),
            status: document.querySelector('#status')?.textContent?.trim()
        })).catch((x) => ({ unreadable: String(x).split('\n')[0] }));
        throw new Error([`${String(e.message).split('\n')[0]}`, `Anmeldung: ${JSON.stringify(state)}`, ...tail.map((t) => `Konsole ${t}`)].join('\n'));
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
