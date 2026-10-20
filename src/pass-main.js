// Generator-Seite (web-generator/): nur der Passwort-Generator aus KeePassNC, ohne Anmeldung, ohne Netz. Sprache: Browser (de oder en),
// unten umschaltbar. Baut ausschliesslich mit DOM-Methoden; die CSP der Seite verbietet jede Verbindung (connect-src 'none').
import { setLang, detectLang, t } from './i18n.js';
import { themeVars } from './theme.js';
import { h, icon, toast } from './ui/dom.js';
import { createGenerator } from './ui/generator-panel.js';

const REPO = 'https://github.com/StudioCuda/KeePassNC';
const root = document.getElementById('app');

// Akzent wie eine Nextcloud-Instanz mit eigener Farbe (dieselbe Ableitung wie in der App, ui/ctx.js -> applyTheme): Nextcloud-Blau
const ACCENT = '#0082c9';
{
    const { vars, accent } = themeVars(ACCENT);
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); // CSSOM: faellt nicht unter style-src
    if (accent) document.documentElement.dataset.accent = 'nc';
}

// Komfortwerte (Sprache, Generator-Optionen) bleiben in diesem Browser; ohne Speicher geht alles trotzdem
function pref(key, value) {
    try {
        if (value === undefined) return localStorage.getItem('kpnc.' + key) || '';
        localStorage.setItem('kpnc.' + key, value);
    } catch { /* Speicher nicht verfuegbar - kein Problem */ }
    return '';
}
async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(t('copied.short', { what: label }), { timeout: 1800 }); }
    catch { toast(t('copy.failed'), { kind: 'error' }); }
}

function render() {
    const lang = detectLang(pref('lang'), '', navigator.language);
    setLang(lang);
    document.title = `${t('pass.title')} · KeePassNC`;
    const g = createGenerator({ pref, copy, copyOnClick: true });
    const other = lang === 'de' ? 'en' : 'de';
    const switchLang = h('button', { type: 'button', class: 'link', id: 'pass-lang', lang: other, text: t('pass.lang.other'), onclick: () => { pref('lang', other); render(); } });
    // Gleicher Hintergrund wie die Anmeldung in Nextcloud (.login.solo in keepassnc.css): Licht, feines Korn, grosse Marke
    root.replaceChildren(h('div', { class: 'login solo pass-wrap' }, h('div', { class: 'login-mark', 'aria-hidden': 'true' }, icon('shield-fine')), h('main', { class: 'pass' },
        h('header', { class: 'pass-head' },
            h('div', { class: 'pass-title' }, h('span', { class: 'brand-mark small', 'aria-hidden': 'true' }, icon('shield')), h('h1', { text: t('pass.title') })),
            // Jeder Satz in eine eigene Zeile
            h('p', { class: 'muted pass-lead' }, ...t('pass.lead').split(/(?<=\.) /).map((x) => h('span', { text: x })))),
        h('section', { class: 'card pass-card' }, g.body, h('div', { class: 'pass-actions' }, g.copyBtn)),
        h('footer', { class: 'pass-foot' },
            h('p', {}, t('pass.powered').split('{app}')[0], h('a', { href: REPO, rel: 'noopener', text: 'KeePassNC' }), h('br'), t('pass.tagline')),
            switchLang))));
    g.start();
}
render();
