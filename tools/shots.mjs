// Screenshots of the UI (desktop/mobile, light/dark). Database: <name>.kdbx + <name>.json (password, optional "picks"),
// optional <name>.keyx as key file. README images:
//   python3 -I tools/make-showcase.py <dir> && npm run build && SHOTS_DB=showcase SHOTS_LANG=en node tools/shots.mjs <dir> <out-dir>
// With the test daily-use file: python3 -I tests/fixtures/make-daily.py <dir> && node tools/shots.mjs <dir> <out-dir>
// Nextcloud mode (header bar and theming of the instance): set SHOTS_NC=http://127.0.0.1:18080 SHOTS_NC_USER=… SHOTS_NC_PASS=… before the call.
// The file is uploaded via WebDAV to /KeePassNC/<name>.kdbx; the app must be enabled in that Nextcloud.
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
const NC = process.env.SHOTS_NC ? { base: process.env.SHOTS_NC.replace(/\/+$/, ''), user: process.env.SHOTS_NC_USER, pass: process.env.SHOTS_NC_PASS } : null;
let server, base;
if (NC) {
    const dav = (p, init = {}) => fetch(`${NC.base}/remote.php/dav/files/${encodeURIComponent(NC.user)}${p}`, { ...init, headers: { Authorization: 'Basic ' + Buffer.from(`${NC.user}:${NC.pass}`).toString('base64') } });
    await dav('/KeePassNC', { method: 'MKCOL' });
    const up = await dav(`/KeePassNC/${NAME}.kdbx`, { method: 'PUT', body: fs.readFileSync(path.join(dbDir, `${NAME}.kdbx`)) });
    if (!up.ok) throw new Error('Hochladen per WebDAV: ' + up.status);
} else {
    const davRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-shots-'));
    fs.copyFileSync(path.join(dbDir, `${NAME}.kdbx`), path.join(davRoot, `${NAME}.kdbx`));
    ({ server } = await startServer({ webRoot: path.join(root, 'web'), davRoot }));
    base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await launchBrowser();
const shot = (page, file) => page.screenshot({ path: path.join(outDir, file) });

async function session(name, viewport, { scheme = 'light', lang = LANG } = {}) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, locale: lang });
    await ctx.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', name, e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('CONSOLE', name, m.text()); });
    if (NC) {
        await page.goto(`${NC.base}/login`);
        await page.fill('input[name=user]', NC.user); await page.fill('input[name=password]', NC.pass);
        await page.click('button[type=submit]');
        await page.waitForURL(/\/apps\//, { timeout: 60000, waitUntil: 'domcontentloaded' });
        await page.goto(`${NC.base}/index.php/apps/keepassnc/?open=${encodeURIComponent(`/KeePassNC/${NAME}.kdbx`)}&lang=${lang}&autosave=off`);
        await page.locator('#login-form').waitFor();
        await shot(page, `${name}-login.png`);
    } else {
        await page.goto(`${base}/index.html?url=${encodeURIComponent(`${base}/dav/${NAME}.kdbx`)}&user=tester&autosave=off`);
        await shot(page, `${name}-login.png`);
        await page.fill('#dav-pass', 'app-secret');
    }
    await page.fill('#master', meta.password);
    if (fs.existsSync(keyfile)) await page.setInputFiles('#keyfile', keyfile);
    await page.click('#open-btn');
    await page.waitForSelector('.shell', { timeout: 60000 });
    await page.waitForTimeout(400);
    return page;
}
// Click an entry by title (meta.picks) or otherwise by position in the list
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

const other = LANG === 'de' ? 'en' : 'de'; // tablet in the other language respectively
const t = await session('tablet', { width: 1024, height: 768 }, { lang: other });
await shot(t, `tablet-${other}.png`);
await browser.close(); server?.close();
console.log('ok');
