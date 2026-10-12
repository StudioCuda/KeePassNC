// Gemeinsamer Browser-Start fuer die Playwright-Tests.
// BROWSER=chromium (Standard) | firefox | webkit. Chromium kann ueber CHROMIUM auf eine feste Programmdatei zeigen.
import fs from 'node:fs';
import { chromium, firefox, webkit } from 'playwright-core';

export const browserName = process.env.BROWSER || 'chromium';

// Bekannte Eigenart von WebKit (Playwright-Build): Jedes <select> loest ein "style-src-attr"-Verstoss aus, auch auf einer leeren Seite
// ohne unseren Code. Die Konsolenmeldung nennt das Element nicht; deshalb meldet webkitCspWatch jeden Verstoss ausserhalb von <select>
// weiterhin selbst. Nur zusammen verwenden: knownEngineNoise (ausblenden) + webkitCspWatch (Gegenprobe).
export const knownEngineNoise = (text) => browserName === 'webkit'
    && /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/.test(text);
export const webkitCspWatch = () => document.addEventListener('securitypolicyviolation', (e) => {
    if (!(e.target instanceof HTMLSelectElement)) console.error(`CSP-Verstoss ausserhalb von <select>: ${e.violatedDirective} ${e.blockedURI} ${String((e.target && e.target.outerHTML) || e.target).slice(0, 120)}`);
}, true);

export async function launchBrowser() {
    if (browserName === 'chromium') {
        const exe = process.env.CHROMIUM || fs.readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
        return chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    }
    const engine = { firefox, webkit }[browserName];
    if (!engine) throw new Error(`BROWSER="${browserName}" unbekannt (chromium, firefox oder webkit)`);
    return engine.launch();
}
