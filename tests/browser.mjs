// Gemeinsamer Browser-Start fuer die Playwright-Tests.
// BROWSER=chromium (Standard) | firefox | webkit. Chromium kann ueber CHROMIUM auf eine feste Programmdatei zeigen.
import { chromium, firefox, webkit } from 'playwright-core';

export const browserName = process.env.BROWSER || 'chromium';

// Bekannte Eigenart von WebKit (Playwright-Build): Jedes <select> loest ein "style-src-attr"-Verstoss aus, auch auf einer leeren Seite
// ohne unseren Code. Die Konsolenmeldung nennt das Element nicht; deshalb meldet webkitCspWatch jeden Verstoss ausserhalb von <select>
// weiterhin selbst. Nur zusammen verwenden: knownEngineNoise (ausblenden) + webkitCspWatch (Gegenprobe).
export const knownEngineNoise = (text) => browserName === 'webkit'
    && /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/.test(text);
// Zweite Eigenart von WebKit: Bricht eine Anfrage ab, weil der Server waehrend der Anfrage wegfaellt, meldet WebKit das manchmal als
// Seitenfehler "Fetch API cannot load <URL> due to access control checks", obwohl die App den Fehler abfaengt. Nur fuer WebDAV-URLs
// ausblenden und nur zusammen mit uncaughtWatch verwenden: das meldet echte, nicht abgefangene Fehler weiterhin.
export const knownFetchNoise = (text) => browserName === 'webkit'
    && /^(?:TypeError: )?Fetch API cannot load [^ ]*:? ?\/[^ ]*\/dav\/\S* due to access control checks\.?$/.test(text);
export const uncaughtWatch = () => {
    addEventListener('unhandledrejection', (e) => console.error(`UNCAUGHT: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
    addEventListener('error', (e) => console.error(`UNCAUGHT: ${e.message}`));
};
export const webkitCspWatch = () => document.addEventListener('securitypolicyviolation', (e) => {
    if (!(e.target instanceof HTMLSelectElement)) console.error(`CSP-Verstoss ausserhalb von <select>: ${e.violatedDirective} ${e.blockedURI} ${String((e.target && e.target.outerHTML) || e.target).slice(0, 120)}`);
}, true);

// Die Testserver bieten WebDAV unter /dav/ an, nicht unter einer Nextcloud-Adresse: Anmeldung und "Neue Datenbank" der eigenstaendigen
// Seite auf "Eigene WebDAV-Adresse" stellen (und die Quelle auf WebDAV: ohne Wahl startet sie mit "Lokale Datei") (wie fuer jemanden, der das schon so benutzt). Als Init-Skript eines Browser-Kontexts.
export const plainWebdav = () => { try { if (!localStorage.getItem('kpnc.davmode')) localStorage.setItem('kpnc.davmode', 'url'); if (!localStorage.getItem('kpnc.mode')) localStorage.setItem('kpnc.mode', 'dav'); } catch {} };

// Letzte Konsolenmeldungen je Seite, fuer waitOpened. Wird beim ersten Aufruf angehaengt; was davor kam, fehlt.
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
 * Wartet, bis die Datenbank offen ist (.shell). Klappt das nicht, sagt der Fehler, wo die Anmeldung stand: Knopf-Text
 * ("Entschlüssele …" = haengt noch in Netz/KDF), Fehlermeldung, Status und die letzten Konsolenmeldungen. Ein Timeout allein
 * verraet nicht, ob die App haengt oder still gescheitert ist.
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
        // ohne CHROMIUM: das von Playwright installierte Chromium (npx playwright-core install chromium)
        return chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
    }
    const engine = { firefox, webkit }[browserName];
    if (!engine) throw new Error(`BROWSER="${browserName}" unbekannt (chromium, firefox oder webkit)`);
    return engine.launch();
}
