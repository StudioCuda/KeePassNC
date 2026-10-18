// Passwort-/Passphrasen-Generator als Dialog (aus dem Editor mit "Verwenden", sonst nur Kopieren).
import { generatePassword, generatePassphrase, generateSimple, DEFAULT_PASSWORD_OPTIONS, DEFAULT_PASSPHRASE_OPTIONS, DEFAULT_SIMPLE_OPTIONS, SEPARATORS, CLASSES, migratePasswordOptions } from '../core/generator.js';
import { t, getLang } from '../i18n.js';
import { pref, copy } from './ctx.js';
import { h, icon, modal } from './dom.js';
import { colorizedPassword, strengthBar } from './detail.js';

const CLASS_KEYS = ['lower', 'upper', 'digits', 'special1', 'special2'];
const SEP_KEYS = { ' ': 'space', '.': 'dot', '-': 'dash', ',': 'comma', '_': 'underscore', '@': 'at', '!': 'excl' };

// Version der gespeicherten Einstellungen; ab 2 ist ein gespeichertes "-" eine bewusste Wahl
const PREFS_VERSION = 2;

function loadOpts() {
    try { return JSON.parse(pref('gen') || '{}'); } catch { return {}; }
}

export function openGenerator({ onUse } = {}) {
    const saved = loadOpts();
    const pwOpts = { ...DEFAULT_PASSWORD_OPTIONS, ...migratePasswordOptions(saved.pw) };
    // Ohne gespeicherte Wahl passt die Wortliste zur Oberflaechensprache
    const phOpts = { ...DEFAULT_PASSPHRASE_OPTIONS, list: getLang() === 'de' ? 'de' : 'en', ...(saved.ph || {}) };
    const siOpts = { ...DEFAULT_SIMPLE_OPTIONS, ...(saved.si || {}) };
    // Frei eingegebene Trennzeichen von frueher, die nicht mehr zur Auswahl stehen
    for (const o of [phOpts, siOpts]) if (!SEPARATORS.includes(o.separator)) o.separator = SEPARATORS[0];
    // Bis 0.9 war "-" die Vorgabe und wurde bei jedem Oeffnen mitgespeichert, also meist keine bewusste Wahl: einmalig auf die neue
    // Vorgabe umstellen.
    if (!(saved.v >= PREFS_VERSION) && phOpts.separator === '-') phOpts.separator = DEFAULT_PASSPHRASE_OPTIONS.separator;
    // 'pr' war bis 0.9 "Aussprechbar", daraus wurde "Simpel"
    let mode = saved.mode === 'pr' ? 'si' : ['pw', 'si'].includes(saved.mode) ? saved.mode : 'ph';
    let current = '';
    let currentBits = 0;
    const preview = h('div', { class: 'gen-preview', id: 'gen-preview', 'data-testid': 'gen-preview', role: 'status' });
    const meter = h('div', {});
    const optsBox = h('div', { class: 'stack' });
    const tabs = h('div', { class: 'seg-group', role: 'tablist' });

    // Passphrasen brechen nur zwischen den Woertern um (CSS .gen-preview.phrase). Nach Leerzeichen und "-" darf der Browser das
    // ohnehin, nach den anderen Trennzeichen nicht, also bekommen die eine Bruchstelle.
    function phraseNode(pw, sep) {
        const node = colorizedPassword(pw);
        if (sep !== ' ') for (const c of [...node.children]) if (c.textContent === sep) c.after(h('wbr'));
        return node;
    }
    function persist() { pref('gen', JSON.stringify({ v: PREFS_VERSION, mode, pw: pwOpts, ph: phOpts, si: siOpts })); }
    function generate() {
        try {
            const r = mode === 'pw' ? generatePassword(pwOpts) : mode === 'ph' ? generatePassphrase(phOpts) : generateSimple(siOpts);
            current = r.password; currentBits = r.bits;
            preview.replaceChildren(mode === 'ph' ? phraseNode(current, phOpts.separator) : colorizedPassword(current));
            preview.classList.toggle('phrase', mode === 'ph');
            meter.replaceChildren(strengthBar(current, currentBits));
            preview.classList.remove('error');
        } catch (e) {
            current = ''; preview.textContent = t('gen.empty'); preview.classList.add('error'); meter.replaceChildren();
        }
        useBtn.disabled = !current; copyBtn.disabled = !current;
        persist();
    }
    const num = (id, label, min, max, o, key) => {
        const range = h('input', { type: 'range', min, max, value: o[key], 'aria-label': label });
        const number = h('input', { type: 'number', min, max, value: o[key], id, class: 'num' });
        const set = (v) => { const n = Math.max(min, Math.min(max, parseInt(v, 10) || min)); o[key] = n; range.value = n; number.value = n; generate(); };
        range.addEventListener('input', () => set(range.value)); number.addEventListener('change', () => set(number.value));
        return h('div', { class: 'slider-row' }, h('span', { class: 'slider-label', text: label }), range, number);
    };
    const sepSelect = (id, o) => h('select', { id, onchange: (e) => { o.separator = e.target.value; generate(); } }, ...SEPARATORS.map((c) => h('option', { value: c, selected: o.separator === c, text: t('gen.sep.' + SEP_KEYS[c]) })));
    const chk = (id, label, o, key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: !!o[key], onchange: (e) => { o[key] = e.target.checked; generate(); } }), h('span', { text: label }));

    const tab = (m, label) => h('button', { type: 'button', role: 'tab', class: 'seg-btn' + (mode === m ? ' active' : ''), id: 'gen-tab-' + m, onclick: () => { mode = m; renderOpts(); generate(); }, text: label });

    function renderOpts() {
        tabs.replaceChildren(tab('ph', t('gen.passphrase')), tab('pw', t('gen.password')), tab('si', t('gen.simple')));
        if (mode === 'pw') {
            const classChk = (k) => {
                const c = chk('gen-' + k, t('gen.class.' + k), pwOpts, k);
                // Sonderzeichen mit Abstand, damit man sie einzeln erkennt; die beiden Gruppen bekommen je eine eigene Zeile
                if (k.startsWith('special')) { c.classList.add('wide'); c.append(h('span', { class: 'gen-chars', text: [...CLASSES[k]].join(' ') })); }
                return c;
            };
            // Selten gebraucht, deshalb unter "Mehr"; offen, sobald dort etwas eingestellt ist, damit nichts unsichtbar mitwirkt
            const moreUsed = pwOpts.extended || pwOpts.custom || pwOpts.exclude;
            optsBox.replaceChildren(
                num('gen-length', t('gen.length'), 4, 128, pwOpts, 'length'),
                h('div', { class: 'check-grid gen-cls' }, ...CLASS_KEYS.map(classChk)),
                h('div', { class: 'check-grid' }, chk('gen-lookalike', t('gen.lookalike'), pwOpts, 'lookalike'), chk('gen-every', t('gen.every'), pwOpts, 'everyGroup')),
                h('details', { class: 'gen-more', id: 'gen-more', open: !!moreUsed }, h('summary', { text: t('gen.more') }),
                    h('div', { class: 'stack' },
                        h('div', { class: 'check-grid' }, chk('gen-extended', t('gen.class.extended'), pwOpts, 'extended')),
                        h('div', { class: 'grid2' },
                            h('label', {}, h('span', { text: t('gen.custom') }), h('input', { id: 'gen-custom', value: pwOpts.custom, oninput: (e) => { pwOpts.custom = e.target.value; generate(); }, autocomplete: 'off', spellcheck: 'false' })),
                            h('label', {}, h('span', { text: t('gen.exclude') }), h('input', { id: 'gen-exclude', value: pwOpts.exclude, oninput: (e) => { pwOpts.exclude = e.target.value; generate(); }, autocomplete: 'off', spellcheck: 'false' }))))));
        } else if (mode === 'si') {
            const sep = sepSelect('gen-si-sep', siOpts);
            optsBox.replaceChildren(num('gen-blocks', t('gen.blocks'), 1, 6, siOpts, 'blocks'),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('gen.separator') }), sep), h('div', { class: 'gen-side' }, chk('gen-capital', t('gen.capital'), siOpts, 'capital'))),
                h('p', { class: 'hint', text: t('gen.simple.hint') }));
        } else {
            const sep = sepSelect('gen-sep', phOpts);
            const casing = h('select', { id: 'gen-casing', onchange: (e) => { phOpts.casing = e.target.value; generate(); } }, ...['lower', 'upper', 'title', 'mixed'].map((c) => h('option', { value: c, selected: phOpts.casing === c, text: t('gen.case.' + c) })));
            const hint = h('p', { class: 'hint', text: t('gen.wordlist.' + phOpts.list) });
            const list = h('select', { id: 'gen-list', onchange: (e) => { phOpts.list = e.target.value; hint.textContent = t('gen.wordlist.' + phOpts.list); generate(); } }, ...['de', 'en'].map((l) => h('option', { value: l, selected: phOpts.list === l, text: t('gen.list.' + l) })));
            optsBox.replaceChildren(num('gen-words', t('gen.words'), 3, 20, phOpts, 'words'),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('gen.separator') }), sep), h('label', {}, h('span', { text: t('gen.casing') }), casing)),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('gen.list') }), list), h('div', { class: 'gen-side' }, chk('gen-digit', t('gen.digit'), phOpts, 'digit'))),
                hint);
        }
    }
    const useBtn = h('button', { type: 'button', class: 'primary', id: 'gen-use', onclick: () => { onUse?.(current, currentBits); m.close(); }, text: t('gen.use') });
    const copyBtn = h('button', { type: 'button', id: 'gen-copy', onclick: () => copy(current, t('f.password')) }, icon('copy'), h('span', { text: t('copy') }));
    const regen = h('button', { type: 'button', id: 'gen-regen', class: 'icon-btn', title: t('gen.regenerate'), 'aria-label': t('gen.regenerate'), onclick: generate }, icon('refresh'));
    const body = h('div', { class: 'stack gen' }, h('div', { class: 'gen-top' }, preview, regen), meter, tabs, optsBox);
    const m = modal({ title: t('generator'), body, size: 'md', cls: 'gen-modal', actions: onUse ? [h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), copyBtn, useBtn] : [copyBtn, h('button', { type: 'button', class: 'primary', text: t('close'), onclick: () => m.close() })] });
    renderOpts(); generate();
    if (!onUse) useBtn.hidden = true;
    return m;
}
