// Bildschirmfotos der Oberflaeche (Desktop/Mobil, hell/dunkel). Datenbank: <name>.kdbx + <name>.json (Passwort, optional "picks"),
// optional <name>.keyx als Schluesseldatei. README-Bilder:
//   python3 -I tools/make-showcase.py <dir> && npm run build && SHOTS_DB=showcase SHOTS_LANG=en node tools/shots.mjs <dir> <out-dir>
// Mit der Test-Alltagsdatei: python3 -I tests/fixtures/make-daily.py <dir> && node tools/shots.mjs <dir> <out-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../tests/browser.mjs';
import { startServer } from '../tests/e2e/davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dbDir, outDir] = [process.argv[2], process.argv[3]];
const LANG = process.env.SHOTS_LANG || 'de';
const NAME = process.env.SHOTS_DB || 'daily';
fs.mkdirSync(outDir, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(dbDir, `${NAME}.json`), 'utf8'));
const keyfile = path.join(dbDir, `${NAME}.keyx`);
const davRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-shots-'));
fs.copyFileSync(path.join(dbDir, `${NAME}.kdbx`), path.join(davRoot, `${NAME}.kdbx`));
const { server, port } = await startServer({ webRoot: path.join(root, 'web'), davRoot });
const browser = await launchBrowser();
const base = `http://127.0.0.1:${port}`;
const shot = (page, file) => page.screenshot({ path: path.join(outDir, file) });

async function session(name, viewport, { scheme = 'light', lang = LANG } = {}) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, locale: lang });
    await ctx.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', name, e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('CONSOLE', name, m.text()); });
    await page.goto(`${base}/index.html?url=${encodeURIComponent(`${base}/dav/${NAME}.kdbx`)}&user=tester&autosave=off`);
    await shot(page, `${name}-login.png`);
    await page.fill('#dav-pass', 'app-secret');
    await page.fill('#master', meta.password);
    if (fs.existsSync(keyfile)) await page.setInputFiles('#keyfile', keyfile);
    await page.click('#open-btn');
    await page.waitForSelector('.shell', { timeout: 60000 });
    await page.waitForTimeout(400);
    return page;
}
// Eintrag nach Titel (meta.picks) oder sonst nach Position in der Liste anklicken
const pick = async (page, key, nth) => {
    const title = meta.picks?.[key];
    const row = title ? page.locator('[data-testid=entry-row]', { hasText: title }).first() : page.locator('[data-testid=entry-row]').nth(nth);
    await row.click(); await page.waitForTimeout(300);
};

const d = await session('desktop', { width: 1600, height: 1000 });
await shot(d, 'desktop-list.png');
await pick(d, 'detail', 3);
await shot(d, 'desktop-detail.png');
await d.click('#edit-btn');
await shot(d, 'desktop-editor.png');
await d.click('#gen-btn'); await d.waitForTimeout(300);
await shot(d, 'desktop-generator.png');
await d.keyboard.press('Escape'); await d.click('#cancel-btn');
await d.click('#reports-btn'); await d.waitForTimeout(300);
await shot(d, 'desktop-reports.png');
await d.keyboard.press('Escape');
await d.keyboard.press('Control+k'); await d.waitForTimeout(300);
await shot(d, 'desktop-palette.png');
await d.keyboard.press('Escape');

const dd = await session('dark', { width: 1600, height: 1000 }, { scheme: 'dark' });
await pick(dd, 'dark', 5);
await shot(dd, 'dark-detail.png');

const m = await session('mobile', { width: 390, height: 844 });
await shot(m, 'mobile-list.png');
await pick(m, 'mobile', 2);
await shot(m, 'mobile-detail.png');
await m.click('.back-btn');
await m.click('.menu-btn.in-list');
await m.waitForTimeout(300);
await shot(m, 'mobile-drawer.png');

const other = LANG === 'de' ? 'en' : 'de'; // Tablet in der jeweils anderen Sprache
const t = await session('tablet', { width: 1024, height: 768 }, { lang: other });
await shot(t, `tablet-${other}.png`);
await browser.close(); server.close();
console.log('ok');
