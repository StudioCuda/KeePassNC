// Bildschirmfotos der Oberflaeche (Desktop/Mobil, hell/dunkel) mit der synthetischen Alltags-Datei. Aufruf: node tools/shots.mjs <daily-dir> <out-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../tests/browser.mjs';
import { startServer } from '../tests/e2e/davserver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dailyDir, outDir] = [process.argv[2], process.argv[3]];
fs.mkdirSync(outDir, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(dailyDir, 'daily.json'), 'utf8'));
const davRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-shots-'));
fs.copyFileSync(path.join(dailyDir, 'daily.kdbx'), path.join(davRoot, 'daily.kdbx'));
const { server, port } = await startServer({ webRoot: path.join(root, 'web'), davRoot });
const browser = await launchBrowser();
const base = `http://127.0.0.1:${port}`;

async function session(name, viewport, { scheme = 'light', lang = 'de' } = {}) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, locale: lang });
    await ctx.addInitScript(() => { try { localStorage.setItem('kpnc.settings', JSON.stringify({ autosync: 'off' })); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', name, e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', name, m.text()); });
    await page.goto(`${base}/index.html?url=${encodeURIComponent(base + '/dav/daily.kdbx')}&user=tester&autosave=off`);
    await page.screenshot({ path: path.join(outDir, `${name}-login.png`) });
    await page.fill('#dav-pass', 'app-secret');
    await page.fill('#master', meta.password);
    await page.setInputFiles('#keyfile', path.join(dailyDir, 'daily.keyx'));
    await page.click('#open-btn');
    await page.waitForSelector('.shell', { timeout: 60000 });
    await page.waitForTimeout(400);
    return page;
}

const d = await session('desktop', { width: 1600, height: 1000 });
await d.screenshot({ path: path.join(outDir, 'desktop-list.png') });
await d.locator('[data-testid=entry-row]').nth(3).click();
await d.waitForTimeout(300);
await d.screenshot({ path: path.join(outDir, 'desktop-detail.png') });
await d.click('#edit-btn');
await d.screenshot({ path: path.join(outDir, 'desktop-editor.png') });
await d.click('#gen-btn'); await d.waitForTimeout(300);
await d.screenshot({ path: path.join(outDir, 'desktop-generator.png') });
await d.keyboard.press('Escape'); await d.click('#cancel-btn');
await d.click('#reports-btn'); await d.waitForTimeout(300);
await d.screenshot({ path: path.join(outDir, 'desktop-reports.png') });
await d.keyboard.press('Escape');
await d.keyboard.press('Control+k'); await d.waitForTimeout(300);
await d.screenshot({ path: path.join(outDir, 'desktop-palette.png') });
await d.keyboard.press('Escape');

const dd = await session('dark', { width: 1600, height: 1000 }, { scheme: 'dark' });
await dd.locator('[data-testid=entry-row]').nth(5).click();
await dd.screenshot({ path: path.join(outDir, 'dark-detail.png') });

const m = await session('mobile', { width: 390, height: 844 });
await m.screenshot({ path: path.join(outDir, 'mobile-list.png') });
await m.locator('[data-testid=entry-row]').nth(2).click();
await m.waitForTimeout(300);
await m.screenshot({ path: path.join(outDir, 'mobile-detail.png') });
await m.click('.back-btn');
await m.click('.menu-btn.in-list');
await m.waitForTimeout(300);
await m.screenshot({ path: path.join(outDir, 'mobile-drawer.png') });

const t = await session('tablet', { width: 1024, height: 768 }, { lang: 'en' });
await t.screenshot({ path: path.join(outDir, 'tablet-en.png') });
await browser.close(); server.close();
console.log('ok');
