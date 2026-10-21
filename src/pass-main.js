// Generator page (web-generator/): just the password generator from KeePassNC, no login, no network. Language: browser (de or en),
// switchable at the bottom. Builds with DOM methods only; the page's CSP forbids any connection (connect-src 'none').
import { setLang, detectLang, t } from './i18n.js';
import { themeVars } from './theme.js';
import { h, icon, toast } from './ui/dom.js';
import { createGenerator } from './ui/generator-panel.js';

const REPO = 'https://github.com/StudioCuda/KeePassNC';
const root = document.getElementById('app');

// Accent like a Nextcloud instance with its own colour (same derivation as in the app, ui/ctx.js -> applyTheme): Nextcloud blue
const ACCENT = '#0082c9';
{
    const { vars, accent } = themeVars(ACCENT);
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); // CSSOM: not covered by style-src
    if (accent) document.documentElement.dataset.accent = 'nc';
}

// Convenience values (language, generator options) stay in this browser; everything still works without storage
function pref(key, value) {
    try {
        if (value === undefined) return localStorage.getItem('kpnc.' + key) || '';
        localStorage.setItem('kpnc.' + key, value);
    } catch { /* storage unavailable - no problem */ }
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
    g.copyBtn.classList.add('primary', 'big'); // the page's main action: full width, accent colour
    const other = lang === 'de' ? 'en' : 'de';
    const switchLang = h('button', { type: 'button', class: 'link', id: 'pass-lang', lang: other, text: t('pass.lang.other'), onclick: () => { pref('lang', other); render(); } });
    // Same background as the login in Nextcloud (.login.solo in keepassnc.css): light, fine grain, big logo
    root.replaceChildren(h('div', { class: 'login solo pass-wrap' }, h('div', { class: 'login-mark', 'aria-hidden': 'true' }, icon('shield-fine')), h('main', { class: 'pass' },
        h('header', { class: 'pass-head' },
            h('div', { class: 'pass-title' }, h('span', { class: 'brand-mark small', 'aria-hidden': 'true' }, icon('shield')), h('h1', { text: t('pass.title') })),
            // Each sentence on its own line
            h('p', { class: 'muted pass-lead' }, ...t('pass.lead').split(/(?<=\.) /).map((x) => h('span', { text: x })))),
        h('section', { class: 'card pass-card' }, g.body, g.copyBtn),
        h('footer', { class: 'pass-foot' },
            h('p', {}, t('pass.powered').split('{app}')[0], h('a', { href: REPO, rel: 'noopener', text: 'KeePassNC' }), h('br'), t('pass.tagline')),
            switchLang))));
    g.start();
}
render();
