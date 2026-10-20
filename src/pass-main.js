// Generator-Seite (web-generator/): nur der Passwort-Generator aus KeePassNC, ohne Anmeldung, ohne Netz. Sprache: Browser (de oder en),
// unten umschaltbar. Baut ausschliesslich mit DOM-Methoden; die CSP der Seite verbietet jede Verbindung (connect-src 'none').
import { setLang, detectLang, t } from './i18n.js';
import { h, icon, toast } from './ui/dom.js';
import { createGenerator } from './ui/generator-panel.js';

const REPO = 'https://github.com/StudioCuda/KeePassNC';
const root = document.getElementById('app');

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
    const g = createGenerator({ pref, copy });
    const other = lang === 'de' ? 'en' : 'de';
    const [before, after] = t('pass.powered').split('{app}');
    const switchLang = h('button', { type: 'button', class: 'link', id: 'pass-lang', lang: other, text: t('pass.lang.other'), onclick: () => { pref('lang', other); render(); } });
    root.replaceChildren(h('main', { class: 'pass' },
        h('header', { class: 'pass-head' },
            h('span', { class: 'brand-mark small', 'aria-hidden': 'true' }, icon('shield')),
            h('div', {}, h('h1', { text: t('pass.title') }), h('p', { class: 'muted', text: t('pass.lead') }))),
        h('section', { class: 'card pass-card' }, g.body, h('div', { class: 'pass-actions' }, g.copyBtn)),
        h('footer', { class: 'pass-foot' },
            h('p', {}, before, h('a', { href: REPO, rel: 'noopener', text: 'KeePassNC' }), after),
            switchLang)));
    g.start();
}
render();
