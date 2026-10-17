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
    && /^(?:TypeError: )?Fetch API cannot load [^ ]*:? ?\/[^ ]*\/dav\/\S+ due to access control checks\.?$/.test(text);
export const uncaughtWatch = () => {
    addEventListener('unhandledrejection', (e) => console.error(`UNCAUGHT: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
    addEventListener('error', (e) => console.error(`UNCAUGHT: ${e.message}`));
};
export const webkitCspWatch = () => document.addEventListener('securitypolicyviolation', (e) => {
    if (!(e.target instanceof HTMLSelectElement)) console.error(`CSP-Verstoss ausserhalb von <select>: ${e.violatedDirective} ${e.blockedURI} ${String((e.target && e.target.outerHTML) || e.target).slice(0, 120)}`);
}, true);

export async function launchBrowser() {
    if (browserName === 'chromium') {
        // ohne CHROMIUM: das von Playwright installierte Chromium (npx playwright-core install chromium)
        return chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
    }
    const engine = { firefox, webkit }[browserName];
    if (!engine) throw new Error(`BROWSER="${browserName}" unbekannt (chromium, firefox oder webkit)`);
    return engine.launch();
}
