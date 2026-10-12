// Gemeinsamer Browser-Start fuer die Playwright-Tests.
// BROWSER=chromium (Standard) | firefox | webkit. Chromium kann ueber CHROMIUM auf eine feste Programmdatei zeigen.
import fs from 'node:fs';
import { chromium, firefox, webkit } from 'playwright-core';

export const browserName = process.env.BROWSER || 'chromium';

export async function launchBrowser() {
    if (browserName === 'chromium') {
        const exe = process.env.CHROMIUM || fs.readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
        return chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    }
    const engine = { firefox, webkit }[browserName];
    if (!engine) throw new Error(`BROWSER="${browserName}" unbekannt (chromium, firefox oder webkit)`);
    return engine.launch();
}
