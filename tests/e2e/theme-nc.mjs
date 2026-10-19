// Theming und Kopfleiste im Nextcloud-Modus gegen eine NACHBILDUNG der App-Seite (templates/page.html mit derselben strengen CSP wie
// der PHP-Controller): Instanzfarbe, Hell/Dunkel aus Nextcloud, Vorrang der App-Einstellung, Fallback, App- und Benutzermenue.
// Der echte Controller (OCP\Defaults, INavigationManager) wird in tests/nextcloud/run.mjs gegen eine echte Nextcloud geprueft.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { launchBrowser, browserName } from '../browser.mjs';
import { deriveAccent, contrast, NC_DEFAULT_COLOR } from '../../src/theme.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.join(root, 'nextcloud-app/keepassnc');
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const NAV = {
    home: '/index.php/apps/dashboard/', logo: '/core/img/logo/logo.svg?v=1', avatar: '/index.php/avatar/anna/64', name: 'Anna Beispiel',
    apps: [
        { id: 'dashboard', name: 'Dashboard', href: '/index.php/apps/dashboard/', icon: '/apps/dashboard/img/app.svg', active: false },
        { id: 'files', name: 'Dateien', href: '/index.php/apps/files/', icon: '/apps/files/img/app.svg', active: false },
        { id: 'keepassnc', name: 'KeePassNC', href: '/index.php/apps/keepassnc/', icon: '/apps/keepassnc/img/app.svg', active: true },
        { id: 'evil', name: 'Fremd', href: 'javascript:alert(1)', icon: 'https://evil.example/x.svg', active: false }
    ],
    moreApps: '/index.php/settings/apps',
    actions: [{ id: 'office-document', name: 'Textdokument', href: '/index.php/apps/office/document', icon: '/apps/office/img/document.svg', color: '#2b579a' }],
    settings: [
        { id: 'profile', name: 'Profil anzeigen', href: '/index.php/u/anna', csrf: false },
        { id: 'settings', name: 'Persönliche Einstellungen', href: '/index.php/settings/user', icon: '/core/img/actions/settings-dark.svg', csrf: false },
        { id: 'logout', name: 'Abmelden', href: '/index.php/logout', icon: 'https://evil.example/logout.svg', csrf: true }
    ]
};
const srv = { color: '#2e7d4f', themes: 'default', nav: NAV, log: [] };

function start() {
    const server = http.createServer((req, res) => {
        const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        srv.log.push(`${req.method} ${req.url}`);
        if (p === '/index.php/apps/keepassnc/') {
            const vars = { __SW_URL__: '', __PEPPER_URL__: '', __DAV_BASE__: '/remote.php/dav/files/anna', __CSRF_URL__: '/index.php/csrftoken', __FILES_URL__: '/index.php/apps/files/',
                __USER__: 'anna', __FILE__: '', __NEW__: '', __CSS__: '/apps/keepassnc/css/keepassnc.css', __JS__: '/apps/keepassnc/js/keepassnc.js', __LANG__: 'de',
                __NC_COLOR__: srv.color, __NC_THEMES__: srv.themes, __NC_NAV__: srv.nav ? JSON.stringify(srv.nav) : '' };
            let html = fs.readFileSync(path.join(app, 'templates/page.html'), 'utf8');
            for (const [k, v] of Object.entries(vars)) html = html.split(k).join(esc(v));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }).end(html);
            return;
        }
        if (p === '/index.php/csrftoken') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'tok-anna' })); return; }
        if (/\.svg$/.test(p) || p.startsWith('/index.php/avatar/')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(SVG); return; }
        if (p.startsWith('/apps/keepassnc/')) {
            const f = path.join(app, p.slice('/apps/keepassnc/'.length));
            if (!f.startsWith(app) || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/css' }).end(fs.readFileSync(f));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }).end('<!doctype html><title>Nextcloud</title><p>andere Seite</p>');
    });
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const results = [];
async function step(name, fn) {
    const t0 = Date.now();
    try { const info = (await fn()) || ''; results.push({ name, ok: true, info: `${info} (${Date.now() - t0} ms)`.trim() }); }
    catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n').slice(0, 10).join('\n   ') }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const toHex = (s) => '#' + (s.match(/\d+/g) || []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');

async function main() {
    const { server, port } = await start();
    const base = `http://127.0.0.1:${port}`;
    const appUrl = `${base}/index.php/apps/keepassnc/`;
    const browser = await launchBrowser();
    const errors = [], csp = [];
    const newPage = async ({ settings = {}, colorScheme = 'light', viewport = { width: 1440, height: 900 } } = {}) => {
        const c = await browser.newContext({ locale: 'de-DE', colorScheme, viewport });
        await c.addInitScript((s) => {
            try { localStorage.setItem('kpnc.settings', JSON.stringify({ themeV: 2, ...s })); } catch {}
            // WebKit meldet jedes <select> als style-src-attr-Verstoss (tests/browser.mjs); alles andere zaehlt.
            document.addEventListener('securitypolicyviolation', (e) => { if (!(e.target instanceof HTMLSelectElement) && !window.__expectViolation) console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`); }, true);
        }, settings);
        const p = await c.newPage();
        p.on('pageerror', (e) => errors.push(String(e)));
        p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && /^CSP: /.test(t)) csp.push(t); });
        await p.goto(appUrl);
        await p.locator('#login-form').waitFor();
        return { p, close: () => c.close() };
    };
    const look = (p) => p.evaluate(() => {
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        const hdr = document.querySelector('#nc-header');
        return {
            accent: cs('#open-btn').backgroundColor, onAccent: cs('#open-btn').color, theme: document.documentElement.dataset.theme || '',
            accentMode: document.documentElement.dataset.accent || '', contrast: document.documentElement.dataset.contrast || '',
            header: hdr ? { bg: getComputedStyle(hdr).backgroundColor, fg: getComputedStyle(hdr).color } : null,
            frame: { bg: getComputedStyle(document.body).backgroundColor, image: getComputedStyle(document.body).backgroundImage }
        };
    });

    await step('Instanzfarbe (hell): Akzent aus der Farbe abgeleitet, Kopfleiste in Instanzfarbe, Text auf Akzent lesbar', async () => {
        srv.color = '#2e7d4f'; srv.themes = 'default';
        const { p, close } = await newPage();
        const l = await look(p), want = deriveAccent('#2e7d4f', 'light');
        expect(l.accentMode === 'nc', 'data-accent fehlt');
        expect(l.accent === rgb(want.accent), `Akzent ${l.accent}, erwartet ${rgb(want.accent)}`);
        expect(contrast(toHex(l.onAccent), toHex(l.accent)) >= 4.5, `Text auf Akzent ${l.onAccent} / ${l.accent}`);
        expect(l.header?.bg === rgb('#2e7d4f') && l.header.fg === rgb('#ffffff'), 'Kopfleiste ' + JSON.stringify(l.header));
        expect(l.frame.bg === l.header.bg && l.frame.image === 'none', 'Rahmen hinter dem Panel einfarbig wie die Kopfleiste (keine Naht) ' + JSON.stringify(l.frame));
        expect(await p.locator('.login.solo').count() === 1 && await p.locator('.login-hero').count() === 0, 'in Nextcloud keine Hero-Flaeche (kein Nachtblau)');
        await close();
        return `${want.accent} / ${toHex(l.onAccent)}`;
    });

    await step('Hell/Dunkel wie Nextcloud: "dark" -> dunkel mit abgeleitetem Akzent; App-Einstellung "hell" hat Vorrang', async () => {
        srv.color = '#2e7d4f'; srv.themes = 'opendyslexic,dark';
        let { p, close } = await newPage();
        let l = await look(p);
        expect(l.theme === 'dark', 'data-theme ' + l.theme);
        expect(l.accent === rgb(deriveAccent('#2e7d4f', 'dark').accent), 'Akzent dunkel ' + l.accent);
        await close();
        ({ p, close } = await newPage({ settings: { theme: 'light' } }));
        l = await look(p);
        expect(l.theme === 'light' && l.accent === rgb(deriveAccent('#2e7d4f', 'light').accent), 'App-Einstellung ignoriert: ' + JSON.stringify(l));
        await close();
        srv.themes = 'default';
        ({ p, close } = await newPage({ colorScheme: 'dark' }));
        l = await look(p);
        expect(l.theme === '' && l.accent === rgb(deriveAccent('#2e7d4f', 'dark').accent), '"System" + dunkles Betriebssystem: ' + JSON.stringify(l));
        await close();
    });

    await step('Grelles Gelb: schwarze Schrift in der Kopfleiste, Akzent so weit abgedunkelt, dass Text >= 4.5:1 bleibt', async () => {
        srv.color = '#f2c200'; srv.themes = 'default';
        const { p, close } = await newPage();
        const l = await look(p);
        expect(l.header.fg === rgb('#000000'), 'Kopfleiste Schrift ' + l.header.fg);
        expect(contrast(toHex(l.accent), '#f4f1ec') >= 4.5 && contrast(toHex(l.onAccent), toHex(l.accent)) >= 4.5, 'Kontrast ' + JSON.stringify(l));
        await close();
    });

    await step('Hoher Kontrast aus Nextcloud: data-contrast=more, Akzent mit 7:1', async () => {
        srv.color = '#2e7d4f'; srv.themes = 'light-highcontrast';
        const { p, close } = await newPage();
        const l = await look(p);
        expect(l.contrast === 'more' && l.theme === 'light' && contrast(toHex(l.accent), '#f4f1ec') >= 7, JSON.stringify(l));
        await close();
    });

    await step('Fallback: Standardblau, ungueltige Farbe, Akzent abgeschaltet -> unser Nachtblau', async () => {
        srv.themes = 'default';
        const out = [];
        for (const [color, settings, headerBg] of [[NC_DEFAULT_COLOR, {}, NC_DEFAULT_COLOR], ['rot;}', {}, '#0b1f3b'], ['', {}, '#0b1f3b'], ['#2e7d4f', { ncAccent: false }, '#2e7d4f']]) {
            srv.color = color;
            const { p, close } = await newPage({ settings });
            const l = await look(p);
            expect(l.accentMode === '' && l.accent === rgb('#0b1f3b'), `${color}: Akzent ${l.accent}`);
            expect(l.header.bg === rgb(headerBg), `${color}: Kopfleiste ${l.header.bg}`);
            out.push(color || '(leer)');
            await close();
        }
        srv.color = '#2e7d4f';
        return out.join(', ');
    });

    await step('App-Menue: 9-Punkte-Knopf und aktuelle App oeffnen dasselbe Menue; KeePassNC aktiv, "Weitere Apps", fremde Links verworfen', async () => {
        srv.color = '#2e7d4f'; srv.themes = 'default';
        const { p, close } = await newPage();
        expect(await p.locator('#nch-current').innerText() === 'KeePassNC', 'aktuelle App');
        await p.click('#nch-waffle');
        await p.locator('#nch-apps-pop').waitFor();
        const tiles = await p.locator('#nch-apps-pop .nch-grid .nch-tile').evaluateAll((as) => as.map((a) => [a.querySelector('.nch-tile-name').textContent, a.getAttribute('href'), a.getAttribute('aria-current')]));
        expect(JSON.stringify(tiles.map((t) => t[0])) === JSON.stringify(['Dashboard', 'Dateien', 'KeePassNC', 'Weitere Apps']), 'Kacheln ' + JSON.stringify(tiles));
        expect(tiles[2][2] === 'page' && tiles[3][1].endsWith('/index.php/settings/apps'), 'aktiv/Weitere Apps');
        expect(await p.locator('#nch-waffle').getAttribute('aria-expanded') === 'true', 'aria-expanded');
        expect(await p.evaluate(() => document.activeElement?.textContent) === 'KeePassNC', 'Fokus auf aktiver App');
        expect(await p.locator('#nch-apps-pop .nch-glyph.has-icon').count() === 3, 'Symbole als Maske');
        expect(await p.locator('#nch-apps-pop .nch-actions .nch-action').evaluateAll((as) => as.map((a) => a.textContent + ' ' + new URL(a.href).pathname).join()) === 'Textdokument /index.php/apps/office/document'
            && await p.locator('#nch-apps-pop .nch-indicator').count() === 1, 'Aktionszeile');
        await p.keyboard.press('Tab');
        expect(await p.evaluate(() => document.activeElement?.textContent) === 'Textdokument', 'Tab springt in die Aktionszeile');
        await p.keyboard.press('Escape');
        expect(await p.locator('#nch-apps-pop').isHidden(), 'Escape schliesst nicht');
        await p.click('#nch-current');
        await p.locator('#nch-apps-pop').waitFor();
        await Promise.all([p.waitForURL(/\/apps\/files\/$/), p.click('#nch-apps-pop .nch-tile >> text=Dateien')]);
        await close();
        return tiles.length + ' Kacheln';
    });

    await step('Benutzermenue: Name, Profil, Eintraege; Abmelden holt ein frisches CSRF-Token', async () => {
        const { p, close } = await newPage();
        await p.click('#nch-user');
        await p.locator('#nch-user-pop').waitFor();
        const text = await p.locator('#nch-user-pop').innerText();
        expect(/Anna Beispiel/.test(text) && /Profil anzeigen/.test(text) && /Persönliche Einstellungen/.test(text) && /Abmelden/.test(text), text);
        expect(!(await p.locator('#nch-user-pop').innerHTML()).includes('requesttoken'), 'Token im Markup');
        expect(await p.locator('#nch-user-pop a[data-id=settings] .nch-glyph.has-icon').count() === 1 && await p.locator('#nch-user-pop a[data-id=logout] .nch-glyph.has-icon').count() === 0, 'Eintrags-Symbole');
        await Promise.all([p.waitForURL(/\/index\.php\/logout\?requesttoken=tok-anna$/), p.click('#nch-user-pop >> text=Abmelden')]);
        await close();
    });

    await step('Ohne Navigation keine Kopfleiste; schmaler Bildschirm: nur 9-Punkte-Knopf; offline: abgedimmt mit Hinweis', async () => {
        srv.nav = null;
        let { p, close } = await newPage();
        expect(await p.locator('#nc-header').count() === 0, 'Kopfleiste ohne Daten');
        await close();
        srv.nav = NAV;
        ({ p, close } = await newPage({ viewport: { width: 390, height: 844 } }));
        expect(await p.locator('#nch-waffle').isVisible() && await p.locator('#nch-current').isHidden(), 'Mobil');
        expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'waagrechtes Scrollen');
        await p.click('#nch-waffle');
        const box = await p.locator('#nch-apps-pop').boundingBox();
        expect(box.x >= 0 && box.x + box.width <= 390, 'App-Menue ragt aus dem Bild: ' + JSON.stringify(box));
        await p.keyboard.press('Escape');
        await p.context().setOffline(true);
        await p.waitForFunction(() => document.querySelector('#nc-header')?.dataset.offline === '1');
        await p.context().setOffline(false);
        await p.waitForFunction(() => document.querySelector('#nc-header')?.dataset.offline === '0');
        await close();
    });

    await step('Einstellungen: "Wie Nextcloud" ist Standard, Akzent-Schalter wirkt sofort', async () => {
        srv.color = '#2e7d4f';
        const { p, close } = await newPage();
        await p.click('#login-settings');
        await p.locator('#s-theme').waitFor();
        expect(await p.locator('#s-theme').inputValue() === 'nextcloud', 'Standard ' + await p.locator('#s-theme').inputValue());
        await p.uncheck('#s-ncaccent');
        expect(await p.evaluate(() => document.documentElement.dataset.accent || '') === '', 'Akzent noch aktiv');
        await p.check('#s-ncaccent');
        expect(await p.evaluate(() => document.documentElement.dataset.accent) === 'nc', 'Akzent nicht zurueck');
        await close();
    });

    await step('CSP: CSSOM (style.setProperty) ist erlaubt, style-Attribut wird blockiert (Gegenprobe), keine Verstoesse', async () => {
        const { p, close } = await newPage();
        const r = await p.evaluate(async () => {
            window.__expectViolation = true;
            const seen = [];
            document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
            const probe = document.createElement('div'); document.body.append(probe);
            probe.setAttribute('style', 'color: rgb(1, 2, 3)');
            const viaAttr = getComputedStyle(probe).color;
            probe.removeAttribute('style');
            probe.style.setProperty('color', 'rgb(4, 5, 6)');
            const viaCssom = getComputedStyle(probe).color;
            await new Promise((res) => setTimeout(res, 300));
            window.__expectViolation = false;
            return { viaAttr, viaCssom, seen, rootVars: document.documentElement.style.getPropertyValue('--nc-accent-l') };
        });
        expect(r.viaAttr !== 'rgb(1, 2, 3)' && r.seen.some((d) => /style-src/.test(d)), 'style-Attribut nicht blockiert: ' + JSON.stringify(r));
        expect(r.viaCssom === 'rgb(4, 5, 6)' && r.rootVars, 'CSSOM blockiert: ' + JSON.stringify(r));
        await close();
        expect(csp.length === 0, 'CSP-Verstoesse: ' + csp.slice(0, 5).join(' | '));
        expect(errors.length === 0, 'JS-Fehler: ' + errors.join(' | '));
        return `${browserName}: ${r.seen.join(', ')}`;
    });

    await browser.close(); server.close(); server.closeAllConnections?.();
    const w = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(w)}\n   -> ${r.info}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} Theming-Tests (Nextcloud-Modus, Nachbildung) bestanden`);
    process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
