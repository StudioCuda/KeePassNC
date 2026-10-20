// Generator-Seite (web-generator/): erzeugt Passwoerter, folgt der Browsersprache, laesst sich umschalten, kopiert, und die strenge CSP
// (connect-src 'none') haelt: keine Anfrage ausser den eigenen Dateien, keine CSP-Verstoesse, keine Seitenfehler.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { launchBrowser, knownEngineNoise, uncaughtWatch, webkitCspWatch } from '../browser.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web-generator');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const f = path.join(dir, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
async function step(name, fn) {
    try { results.push({ name, ok: true, info: (await fn()) || '' }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 8).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

const browser = await launchBrowser();
const problems = [];
async function open(locale, { init } = {}) {
    const ctx = await browser.newContext({ locale, permissions: ['clipboard-read', 'clipboard-write'].filter(() => browser.browserType().name() === 'chromium') });
    if (init) await ctx.addInitScript(init);
    await ctx.addInitScript(uncaughtWatch);
    await ctx.addInitScript(webkitCspWatch);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !knownEngineNoise(m.text())) problems.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) problems.push(`Anfrage nach aussen: ${r.url()}`); });
    await page.goto(base);
    await page.locator('#gen-preview').waitFor();
    return { ctx, page };
}
const preview = (page) => page.locator('#gen-preview').innerText();

await step('English browser: English page, a passphrase appears', async () => {
    const { ctx, page } = await open('en-GB');
    expect(await page.locator('h1').innerText() === 'Password generator', 'Titel nicht englisch');
    expect(await page.locator('html').getAttribute('lang') === 'en', 'lang nicht en');
    const words = (await preview(page)).trim().split(/\s+/);
    expect(words.length === 6, `6 Woerter erwartet: ${words}`);
    expect(await page.locator('.pass-foot').innerText().then((x) => /powered by KeePassNC – the easygoing KDBX password manager for Nextcloud and Web\./.test(x)), 'Fusszeile fehlt');
    expect(await page.locator('.pass-foot a').getAttribute('href') === 'https://github.com/StudioCuda/KeePassNC', 'Link falsch');
    await ctx.close();
});
await step('German browser: German page; switch to English sticks after reload', async () => {
    const { ctx, page } = await open('de-AT');
    expect(await page.locator('h1').innerText() === 'Passwort-Generator', 'Titel nicht deutsch');
    expect(await page.locator('html').getAttribute('lang') === 'de', 'lang nicht de');
    await page.locator('#pass-lang').click();
    expect(await page.locator('h1').innerText() === 'Password generator', 'Umschalten auf Englisch hat nicht gewirkt');
    expect(await page.locator('#pass-lang').innerText() === 'Deutsch', 'Umschalter zeigt nicht die andere Sprache');
    await page.reload(); await page.locator('#gen-preview').waitFor();
    expect(await page.locator('h1').innerText() === 'Password generator', 'Wahl nicht gemerkt');
    await ctx.close();
});
await step('Other languages fall back to English', async () => {
    const { ctx, page } = await open('fr-FR');
    expect(await page.locator('h1').innerText() === 'Password generator', 'kein Englisch');
    await ctx.close();
});
await step('Password tab: length, groups, regenerate', async () => {
    const { ctx, page } = await open('en-GB');
    await page.locator('#gen-tab-pw').click();
    const a = (await preview(page)).trim();
    expect(a.length === 24, `24 Zeichen erwartet: ${a.length}`);
    await page.locator('#gen-length').fill('40'); await page.locator('#gen-length').dispatchEvent('change');
    const b = (await preview(page)).trim();
    expect(b.length === 40, `40 Zeichen erwartet: ${b.length}`);
    await page.locator('#gen-regen').click();
    expect((await preview(page)).trim() !== b, 'Neu erzeugen aendert nichts');
    expect(/^[a-z]+$/i.test(await page.locator('.strength-label').innerText().then((x) => x.split(' ')[0])), 'Staerke fehlt');
    await ctx.close();
});
await step('Copy puts the shown password on the clipboard', async () => {
    if (browser.browserType().name() !== 'chromium') return 'nur Chromium (Zwischenablage-Rechte)';
    const { ctx, page } = await open('en-GB');
    const shown = (await preview(page)).trim();
    await page.locator('#gen-copy').click();
    await page.locator('.toast').waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText()) === shown, 'Zwischenablage != Anzeige');
    await ctx.close();
});
await step('Options are remembered in this browser', async () => {
    const { ctx, page } = await open('en-GB');
    await page.locator('#gen-words').fill('9'); await page.locator('#gen-words').dispatchEvent('change');
    await page.reload(); await page.locator('#gen-preview').waitFor();
    expect((await preview(page)).trim().split(/\s+/).length === 9, 'Wortzahl nicht gemerkt');
    await ctx.close();
});
await step('Works without storage', async () => {
    const { ctx, page } = await open('en-GB', { init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); } });
    expect((await preview(page)).trim().length > 0, 'ohne Speicher keine Anzeige');
    await ctx.close();
});
await step('No requests to the outside, no CSP violations, no page errors', async () => {
    expect(problems.length === 0, problems.join('\n   '));
});

await browser.close(); server.close();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info ? ' - ' + r.info : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
