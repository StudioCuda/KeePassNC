import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHex, contrast, deriveAccent, deriveHero, ncThemeFrom, themeVars, headerText, textOn, SURFACES, NC_DEFAULT_COLOR, THEME_VARS } from '../../src/theme.js';
import { parseNcNav } from '../../src/nextcloud.js';

test('Farben: nur #rgb/#rrggbb, alles andere wird verworfen', () => {
    assert.equal(parseHex('#ABC'), '#aabbcc');
    assert.equal(parseHex(' #00679E '), '#00679e');
    for (const bad of ['', 'red', '#12345', '#1234567', 'url(x)', '#fff;}', '#ggg', null, undefined, '00679e', 'rgb(0,0,0)']) assert.equal(parseHex(bad), null, String(bad));
});

test('Kontrast nach WCAG 2.x', () => {
    assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21);
    assert.equal(contrast('#777777', '#777777'), 1);
    assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
    assert.equal(textOn('#ffff00'), '#000000');
    assert.equal(textOn('#0b1f3b'), '#ffffff');
    assert.equal(headerText('#00679e'), '#ffffff');
    assert.equal(headerText('#f2c200'), '#000000');
});

const MATRIX = ['#ffffff', '#ffff00', '#f2c200', '#00ff00', '#00ffff', '#777777', '#000000', '#0b1f3b', NC_DEFAULT_COLOR, '#e6007e', '#2e7d4f', '#ff0000', '#c4a664'];
for (const mode of ['light', 'dark']) {
    for (const min of [4.5, 7]) {
        test(`Akzent ${mode}, Ziel ${min}:1: Schrift auf allen Flaechen, Text auf dem Akzent`, () => {
            const s = SURFACES[mode];
            for (const c of MATRIX) {
                const a = deriveAccent(c, mode, { min });
                assert.ok(a, c);
                for (const f of [s.bg, s.surface, s.surface2, s.surface3, a.soft]) assert.ok(contrast(a.accent, f) >= min, `${c} -> ${a.accent} auf ${f}: ${contrast(a.accent, f).toFixed(2)}`);
                assert.ok(contrast(a.on, a.accent) >= 4.5, `${c}: Text auf Akzent ${contrast(a.on, a.accent).toFixed(2)}`);
            }
        });
    }
}

test('Akzent: passende Farben bleiben unveraendert, ungueltige liefern nichts', () => {
    assert.equal(deriveAccent('#0b1f3b', 'light').accent, '#0b1f3b');
    assert.equal(deriveAccent('#c4a664', 'dark').accent, '#c4a664');
    assert.equal(deriveAccent('nope', 'light'), null);
    for (const c of MATRIX) assert.ok(contrast(deriveHero(c).hero, '#ffffff') >= 7, c);
});

test('Flaechenfarben in theme.js passen zu keepassnc.css', () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/keepassnc.css'), 'utf8');
    const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    const val = (b, v) => new RegExp(`${v}:\\s*(#[0-9a-f]{6})`).exec(b)?.[1];
    for (const [mode, b] of [['light', block(':root {')], ['dark', block(':root[data-theme="dark"] {')]]) {
        const s = SURFACES[mode];
        assert.deepEqual([val(b, '--bg'), val(b, '--surface'), val(b, '--surface-2'), val(b, '--surface-3')], [s.bg, s.surface, s.surface2, s.surface3], mode);
    }
});

test('Hell/Dunkel aus Nextcloud: erstes passendes Theme zaehlt, Zusatz-Themes werden uebersprungen', () => {
    assert.deepEqual(ncThemeFrom('default'), { theme: 'auto', contrast: false });
    assert.deepEqual(ncThemeFrom('opendyslexic,dark'), { theme: 'dark', contrast: false });
    assert.deepEqual(ncThemeFrom(['light']), { theme: 'light', contrast: false });
    assert.deepEqual(ncThemeFrom('dark-highcontrast,light'), { theme: 'dark', contrast: true });
    assert.deepEqual(ncThemeFrom('light-highcontrast'), { theme: 'light', contrast: true });
    assert.deepEqual(ncThemeFrom('dark,light'), { theme: 'dark', contrast: false }, 'erzwungenes Theme steht vorne');
    for (const x of ['', null, undefined, 'unbekannt', 'reduced-motion', '{"x":1}']) assert.deepEqual(ncThemeFrom(x), { theme: 'auto', contrast: false }, String(x));
});

test('CSS-Variablen: Kopfleiste immer, Akzent nur mit eigener Instanzfarbe und wenn gewuenscht', () => {
    const g = themeVars('#2e7d4f');
    assert.equal(g.accent, true);
    assert.deepEqual(Object.keys(g.vars).sort(), [...THEME_VARS].sort());
    assert.equal(g.vars['--nch-bg'], '#2e7d4f');
    const stock = themeVars(NC_DEFAULT_COLOR);
    assert.equal(stock.accent, false);
    assert.deepEqual(stock.vars, { '--nch-bg': NC_DEFAULT_COLOR, '--nch-fg': '#ffffff' });
    assert.equal(themeVars('#2e7d4f', { useAccent: false }).accent, false);
    assert.deepEqual(themeVars('kaputt'), { vars: {}, accent: false });
    assert.deepEqual(themeVars(''), { vars: {}, accent: false });
    const hc = themeVars('#f2c200', { highContrast: true });
    assert.ok(contrast(hc.vars['--nc-accent-l'], SURFACES.light.bg) >= 7);
    for (const v of Object.values(g.vars)) assert.match(v, /^#[0-9a-f]{6}$/);
});

const ORIGIN = 'https://cloud.example.org';
const nav = (o = {}) => JSON.stringify({
    home: '/index.php/apps/dashboard/', logo: '/core/img/logo/logo.svg?v=1', avatar: '/index.php/avatar/anna/64', name: 'Anna',
    apps: [{ id: 'files', name: 'Dateien', href: '/index.php/apps/files/', icon: '/apps/files/img/app.svg', active: false },
        { id: 'keepassnc', name: 'KeePassNC', href: '/index.php/apps/keepassnc/', icon: '/apps/keepassnc/img/app.svg', active: true }],
    settings: [{ id: 'settings', name: 'Persönliche Einstellungen', href: '/index.php/settings/user', icon: '/core/img/actions/settings-dark.svg' }, { id: 'logout', name: 'Abmelden', href: '/index.php/logout', csrf: true }],
    ...o
});

test('Navigation: gueltige Daten werden uebernommen', () => {
    const n = parseNcNav(nav(), ORIGIN);
    assert.equal(n.apps.length, 2);
    assert.equal(n.apps[1].active, true);
    assert.equal(n.apps[0].href, ORIGIN + '/index.php/apps/files/');
    assert.equal(n.apps[0].icon, '/apps/files/img/app.svg');
    assert.equal(n.settings[1].csrf, true);
    assert.equal(n.settings[0].icon, '/core/img/actions/settings-dark.svg');
    assert.equal(n.settings[1].icon, '', 'ohne Symbol');
    assert.equal(n.logo, '/core/img/logo/logo.svg?v=1');
    assert.equal(n.name, 'Anna');
    assert.equal(n.moreApps, '');
    assert.equal(parseNcNav(nav({ moreApps: '/index.php/settings/apps' }), ORIGIN).moreApps, ORIGIN + '/index.php/settings/apps');
    assert.equal(parseNcNav(nav({ moreApps: 'javascript:x' }), ORIGIN).moreApps, '');
});

test('Navigation: fremde Herkunft, javascript:-Links und kaputtes JSON werden verworfen', () => {
    assert.equal(parseNcNav('', ORIGIN), null);
    assert.equal(parseNcNav('{kaputt', ORIGIN), null);
    assert.equal(parseNcNav('{"apps":[]}', ORIGIN), null);
    assert.equal(parseNcNav(nav(), undefined), null);
    const n = parseNcNav(nav({
        logo: 'https://evil.example/logo.svg', avatar: '//evil.example/a.png',
        apps: [{ id: 'x', name: 'X', href: 'javascript:alert(1)', icon: '/a.svg' }, { id: 'y', name: 'Y', href: 'https://other.example/', icon: 'https://evil.example/i.svg' },
            { id: 'z', name: 'Z', href: '/z', icon: '/a.svg") , url("x' }, { id: 'd', name: 'D', href: 'data:text/html,1' }]
    }), ORIGIN);
    assert.deepEqual(n.apps.map((a) => a.id), ['y', 'z'], 'nur http(s)-Links');
    assert.equal(n.apps[0].icon, '', 'Symbol fremder Herkunft');
    assert.equal(n.apps[1].icon, '', 'Symbol mit Anfuehrungszeichen/Klammern');
    assert.equal(n.logo, '');
    assert.equal(n.avatar, '');
    const s = parseNcNav(nav({ settings: [{ id: 'a', name: 'A', href: '/a', icon: 'https://evil.example/i.svg' }, { id: 'b', name: 'B', href: '/b', icon: '/b.svg") , url("x' }] }), ORIGIN).settings;
    assert.deepEqual(s.map((x) => x.icon), ['', ''], 'Eintrags-Symbole fremder Herkunft oder mit Anfuehrungszeichen');
    assert.equal(parseNcNav(nav({ name: 'A\u0000\nB' }), ORIGIN).name, 'AB');
});

test('Navigation: Aktionen (Nextcloud 35) nur mit Link, Symbol als eigener Pfad oder Base64-data:, Farbe nur als Hex', () => {
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
    const n = parseNcNav(nav({ actions: [
        { id: 'office-document', name: 'Textdokument', href: '/index.php/apps/office/document', icon: svg, color: '#2B579A' },
        { id: 'b', name: 'B', href: '/b', icon: '/apps/b/img/b.svg', color: 'red;}' },
        { id: 'c', name: 'C', href: '/c', icon: 'data:image/svg+xml;utf8,<svg onload=x>' },
        { id: 'js', name: 'Nur JS', href: '#' }, { id: 'x', name: 'X', href: 'javascript:alert(1)' }
    ] }), ORIGIN);
    assert.deepEqual(n.actions.map((a) => a.id), ['office-document', 'b', 'c']);
    assert.equal(n.actions[0].icon, svg);
    assert.equal(n.actions[0].color, '#2B579A');
    assert.equal(n.actions[1].icon, '/apps/b/img/b.svg');
    assert.equal(n.actions[1].color, '', 'Farbe kein Hex');
    assert.equal(n.actions[2].icon, '', 'data: ohne Base64');
    assert.deepEqual(parseNcNav(nav(), ORIGIN).actions, [], 'Nextcloud 34: keine Aktionen');
});

test('Einstellungen: altes, automatisch gespeichertes "auto" wird einmalig zu "wie Nextcloud"', async () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
    const { loadSettings, saveSettings } = await import('../../src/settings.js');
    try {
        assert.equal(loadSettings('').theme, 'nextcloud', 'Standard');
        assert.equal(loadSettings('').ncAccent, true);
        store['kpnc.settings'] = JSON.stringify({ theme: 'auto', autolock: 20 });
        const s = loadSettings('');
        assert.equal(s.theme, 'nextcloud');
        assert.equal(s.autolock, 20);
        for (const [saved, want] of [[5, 2], [15, 10], [30, 20], [720, 720], [0, 10], ['x', 10]]) {
            store['kpnc.settings'] = JSON.stringify({ autolock: saved });
            assert.equal(loadSettings('').autolock, want, `autolock ${saved}`);
        }
        store['kpnc.settings'] = JSON.stringify({ theme: 'auto', autolock: 20 });
        s.theme = 'auto'; saveSettings(s); // jetzt bewusst gewaehlt: bleibt
        assert.equal(JSON.parse(store['kpnc.settings']).themeV, 2);
        assert.equal(loadSettings('').theme, 'auto');
        store['kpnc.settings'] = JSON.stringify({ theme: 'dark' });
        assert.equal(loadSettings('').theme, 'dark');
        store['kpnc.settings'] = JSON.stringify({ theme: 'lila', ncAccent: false });
        assert.equal(loadSettings('').theme, 'nextcloud');
        assert.equal(loadSettings('').ncAccent, false);
    } finally { delete globalThis.localStorage; }
});
