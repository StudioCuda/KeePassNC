// Password/passphrase generator as a building block: preview, strength, tabs and options. Knows neither the dialog nor the app state; storage and
// copying come from outside (generator-dialog.js in the app, pass-main.js on the generator page).
import { generatePassword, generatePassphrase, generateSimple, DEFAULT_PASSWORD_OPTIONS, DEFAULT_PASSPHRASE_OPTIONS, DEFAULT_SIMPLE_OPTIONS, SEPARATORS, CLASSES, migratePasswordOptions } from '../core/generator.js';
import { t, getLang } from '../i18n.js';
import { h, icon } from './dom.js';
import { colorizedPassword, strengthBar } from './pwview.js';

const CLASS_KEYS = ['lower', 'upper', 'digits', 'special1', 'special2'];
const SEP_KEYS = { ' ': 'space', '.': 'dot', '-': 'dash', ',': 'comma', '_': 'underscore', '@': 'at', '!': 'excl' };

// Version of the saved settings; from 2 on, a saved "-" is a deliberate choice
const PREFS_VERSION = 2;

/** pref(key, value?) reads/writes a convenience value, copy(text, label) copies. With onUse there is a "Use" button (the caller closes afterwards).
 * Returns body and the two buttons; only call start() once body is in the document (the height measurement needs that). */
export function createGenerator({ pref, copy, onUse, copyOnClick = false } = {}) {
    let saved;
    try { saved = JSON.parse(pref('gen') || '{}'); } catch { saved = {}; }
    const pwOpts = { ...DEFAULT_PASSWORD_OPTIONS, ...migratePasswordOptions(saved.pw) };
    // Without a saved choice, the word list matches the UI language
    const phOpts = { ...DEFAULT_PASSPHRASE_OPTIONS, list: getLang() === 'de' ? 'de' : 'en', ...(saved.ph || {}) };
    // Since 0.15 the capitalization is just "capitalize first letter", on or off
    if (phOpts.casing !== 'title') phOpts.casing = 'lower';
    const siOpts = { ...DEFAULT_SIMPLE_OPTIONS, ...(saved.si || {}) };
    // Free-form separators from earlier versions that are no longer offered
    for (const o of [phOpts, siOpts]) if (!SEPARATORS.includes(o.separator)) o.separator = SEPARATORS[0];
    // Up to 0.9 "-" was the default and got saved on every open, so mostly not a deliberate choice: switch once to the new
    // default.
    if (!(saved.v >= PREFS_VERSION) && phOpts.separator === '-') phOpts.separator = DEFAULT_PASSPHRASE_OPTIONS.separator;
    // 'pr' was "Pronounceable" up to 0.9, which became "Simple"
    let mode = saved.mode === 'pr' ? 'si' : ['pw', 'si'].includes(saved.mode) ? saved.mode : 'ph';
    let current = '';
    let currentBits = 0;
    const preview = h('div', { class: 'gen-preview', id: 'gen-preview', 'data-testid': 'gen-preview', role: 'status' });
    const meter = h('div', {});
    const optsBox = h('div', { class: 'stack' });
    const tabs = h('div', { class: 'seg-group', role: 'tablist' });

    // Passphrases only wrap between words (CSS .gen-preview.phrase). After spaces and "-" the browser may do that anyway,
    // after the other separators it may not, so those get a break opportunity.
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
    // Explanations (word list, bits per block) are a tooltip on the label instead of a line in the dialog
    const tip = (node, text) => { node.title = text; node.classList.add('has-tip'); return node; };
    const num = (id, label, min, max, o, key, hint) => {
        const range = h('input', { type: 'range', min, max, value: o[key], 'aria-label': label });
        const number = h('input', { type: 'number', min, max, value: o[key], id, class: 'num' });
        const set = (v) => { const n = Math.max(min, Math.min(max, parseInt(v, 10) || min)); o[key] = n; range.value = n; number.value = n; generate(); };
        range.addEventListener('input', () => set(range.value)); number.addEventListener('change', () => set(number.value));
        const lab = h('span', { class: 'slider-label', text: label });
        if (hint) tip(lab, hint);
        return h('div', { class: 'slider-row' }, lab, range, number);
    };
    const sepSelect = (id, o) => h('select', { id, onchange: (e) => { o.separator = e.target.value; generate(); } }, ...SEPARATORS.map((c) => h('option', { value: c, selected: o.separator === c, text: t('gen.sep.' + SEP_KEYS[c]) })));
    const chk = (id, label, o, key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: !!o[key], onchange: (e) => { o[key] = e.target.checked; generate(); } }), h('span', { text: label }));

    const tab = (m, label) => h('button', { type: 'button', role: 'tab', class: 'seg-btn' + (mode === m ? ' active' : ''), id: 'gen-tab-' + m, onclick: () => { mode = m; renderOpts(); generate(); fitPasswordPreview(); }, text: label });

    function phraseOpts() {
        const sep = sepSelect('gen-sep', phOpts);
        const words = num('gen-words', t('gen.words'), 3, 20, phOpts, 'words', t('gen.wordlist.' + phOpts.list));
        const listLabel = tip(h('span', { text: t('gen.list') }), t('gen.wordlist.' + phOpts.list));
        const setHint = () => { for (const el of [words.querySelector('.slider-label'), listLabel]) el.title = t('gen.wordlist.' + phOpts.list); };
        const list = h('select', { id: 'gen-list', onchange: (e) => { phOpts.list = e.target.value; setHint(); generate(); } }, ...['de', 'en'].map((l) => h('option', { value: l, selected: phOpts.list === l, text: t('gen.list.' + l) })));
        const capital = h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'gen-ph-capital', checked: phOpts.casing === 'title', onchange: (e) => { phOpts.casing = e.target.checked ? 'title' : 'lower'; generate(); } }), h('span', { text: t('gen.capital') }));
        return [words,
            h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('gen.separator') }), sep), h('label', {}, listLabel, list)),
            h('div', { class: 'grid2' }, h('div', { class: 'gen-side' }, chk('gen-digit', t('gen.digit'), phOpts, 'digit')), h('div', { class: 'gen-side' }, capital))];
    }
    // The passphrase options are built only once and hidden: that way the password preview can be measured without
    // rebuilding <select> elements (WebKit reports CSP violations when doing so, see tests/browser.mjs).
    const phBox = h('div', { class: 'stack' }, ...phraseOpts());
    // In password mode the preview is tall enough that the dialog is exactly as tall as in passphrase mode: to get that, briefly
    // show the passphrase options and measure (synchronous, so no visible flicker).
    function fitPasswordPreview() {
        if (mode !== 'pw' || !body.isConnected) return;
        preview.classList.replace('pw', 'ph'); phBox.hidden = false; optsBox.hidden = true;
        const target = body.offsetHeight;
        preview.classList.replace('ph', 'pw'); phBox.hidden = true; optsBox.hidden = false;
        preview.style.setProperty('--gen-pw-h', Math.max(0, target - (body.offsetHeight - preview.offsetHeight)) + 'px'); // CSSOM, no style attribute (CSP)
    }

    function renderOpts() {
        preview.classList.remove('pw', 'ph', 'si'); preview.classList.add(mode);
        phBox.hidden = mode !== 'ph'; optsBox.hidden = mode === 'ph';
        tabs.replaceChildren(tab('ph', t('gen.passphrase')), tab('pw', t('gen.password')), tab('si', t('gen.simple')));
        if (mode === 'pw') {
            const classChk = (k) => {
                const c = chk('gen-' + k, t('gen.class.' + k), pwOpts, k);
                // Special characters spaced out so they can be told apart; the two groups each get their own row
                if (k.startsWith('special')) { c.classList.add('wide'); c.append(h('span', { class: 'gen-chars', text: [...CLASSES[k]].join(' ') })); }
                return c;
            };
            // Rarely needed, hence under "More"; open as soon as something is set there, so nothing takes effect invisibly
            const moreUsed = pwOpts.extended || pwOpts.custom || pwOpts.exclude;
            optsBox.replaceChildren(
                num('gen-length', t('gen.length'), 4, 128, pwOpts, 'length'),
                h('div', { class: 'check-grid gen-cls' }, ...CLASS_KEYS.map(classChk)),
                h('div', { class: 'check-grid' }, chk('gen-lookalike', t('gen.lookalike'), pwOpts, 'lookalike'), chk('gen-every', t('gen.every'), pwOpts, 'everyGroup')),
                h('details', { class: 'gen-more', id: 'gen-more', open: !!moreUsed, ontoggle: fitPasswordPreview }, h('summary', { text: t('gen.more') }),
                    h('div', { class: 'stack' },
                        h('div', { class: 'check-grid' }, chk('gen-extended', t('gen.class.extended'), pwOpts, 'extended')),
                        h('div', { class: 'grid2' },
                            h('label', {}, h('span', { text: t('gen.custom') }), h('input', { id: 'gen-custom', value: pwOpts.custom, oninput: (e) => { pwOpts.custom = e.target.value; generate(); }, autocomplete: 'off', spellcheck: 'false' })),
                            h('label', {}, h('span', { text: t('gen.exclude') }), h('input', { id: 'gen-exclude', value: pwOpts.exclude, oninput: (e) => { pwOpts.exclude = e.target.value; generate(); }, autocomplete: 'off', spellcheck: 'false' }))))));
        } else if (mode === 'si') {
            const sep = sepSelect('gen-si-sep', siOpts);
            optsBox.replaceChildren(num('gen-blocks', t('gen.blocks'), 1, 6, siOpts, 'blocks', t('gen.simple.hint')),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('gen.separator') }), sep), h('div', { class: 'gen-side' }, chk('gen-capital', t('gen.capital'), siOpts, 'capital'))));
        } else {
            optsBox.replaceChildren();
        }
    }
    const useBtn = h('button', { type: 'button', class: 'primary', id: 'gen-use', onclick: () => onUse?.(current, currentBits), text: t('gen.use') });
    const copyBtn = h('button', { type: 'button', id: 'gen-copy', onclick: () => copy(current, t('f.password')) }, icon('copy'), h('span', { text: t('copy') }));
    const regen = h('button', { type: 'button', id: 'gen-regen', class: 'icon-btn', title: t('gen.regenerate'), 'aria-label': t('gen.regenerate'), onclick: generate }, icon('refresh'));
    const body = h('div', { class: 'stack gen' }, preview, h('div', { class: 'gen-meter' }, meter, regen), tabs, phBox, optsBox);
    if (!onUse) useBtn.hidden = true;
    if (copyOnClick) {
        // A click on the preview copies (not if text was just selected); the button remains the route for the keyboard
        preview.classList.add('click-copy'); preview.title = t('gen.click.copy');
        preview.addEventListener('click', () => {
            if (!current || String(getSelection()).length) return;
            copy(current, t('f.password'));
            preview.classList.add('copied'); clearTimeout(preview.copiedTimer); preview.copiedTimer = setTimeout(() => preview.classList.remove('copied'), 900);
        });
    }
    const start = () => { renderOpts(); generate(); requestAnimationFrame(fitPasswordPreview); };
    return { body, copyBtn, useBtn, start };
}
