// Passwort-/Passphrasen-Generator als Dialog (aus dem Editor mit "Verwenden", sonst nur Kopieren).
import { generatePassword, generatePassphrase, generatePronounceable, DEFAULT_PASSWORD_OPTIONS, DEFAULT_PASSPHRASE_OPTIONS, DEFAULT_PRONOUNCEABLE_OPTIONS, CLASSES } from '../core/generator.js';
import { t } from '../i18n.js';
import { ctx, pref, copy } from './ctx.js';
import { h, icon, iconBtn, modal } from './dom.js';
import { colorizedPassword, strengthBar } from './detail.js';

const CLASS_KEYS = ['lower', 'upper', 'digits', 'dashes', 'math', 'logograms', 'braces', 'punct', 'quotes', 'extended'];

function loadOpts() {
    try { return JSON.parse(pref('gen') || '{}'); } catch { return {}; }
}

export function openGenerator({ onUse } = {}) {
    const saved = loadOpts();
    const pwOpts = { ...DEFAULT_PASSWORD_OPTIONS, ...(saved.pw || {}) };
    const phOpts = { ...DEFAULT_PASSPHRASE_OPTIONS, ...(saved.ph || {}) };
    const prOpts = { ...DEFAULT_PRONOUNCEABLE_OPTIONS, ...(saved.pr || {}) };
    let mode = ['ph', 'pr'].includes(saved.mode) ? saved.mode : 'pw';
    let current = '';
    let currentBits = 0;
    const preview = h('div', { class: 'gen-preview', id: 'gen-preview', 'data-testid': 'gen-preview', role: 'status' });
    const meter = h('div', {});
    const optsBox = h('div', { class: 'stack' });
    const tabs = h('div', { class: 'seg-group', role: 'tablist' });

    function persist() { pref('gen', JSON.stringify({ mode, pw: pwOpts, ph: phOpts, pr: prOpts })); }
    function generate() {
        try {
            const r = mode === 'pw' ? generatePassword(pwOpts) : mode === 'ph' ? generatePassphrase(phOpts) : generatePronounceable(prOpts);
            current = r.password; currentBits = r.bits;
            preview.replaceChildren(colorizedPassword(current));
            meter.replaceChildren(strengthBar(current, currentBits));
            preview.classList.remove('error');
        } catch (e) {
            current = ''; preview.textContent = t('gen.empty'); preview.classList.add('error'); meter.replaceChildren();
        }
        useBtn.disabled = !current; copyBtn.disabled = !current;
        persist();
    }
    const num = (id, label, min, max, o, key, after) => {
        const range = h('input', { type: 'range', min, max, value: o[key], 'aria-label': label });
        const number = h('input', { type: 'number', min, max, value: o[key], id, class: 'num' });
        const set = (v) => { const n = Math.max(min, Math.min(max, parseInt(v, 10) || min)); o[key] = n; range.value = n; number.value = n; generate(); after?.(); };
        range.addEventListener('input', () => set(range.value)); number.addEventListener('change', () => set(number.value));
        return h('div', { class: 'slider-row' }, h('span', { class: 'slider-label', text: label }), range, number);
    };
    const chk = (id, label, o, key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: !!o[key], onchange: (e) => { o[key] = e.target.checked; generate(); } }), h('span', { text: label }));

    const select = (id, o, key, options) => h('select', { id, onchange: (e) => { o[key] = e.target.value; generate(); } }, ...options.map(([v, label]) => h('option', { value: v, selected: o[key] === v, text: label })));
    const tab = (m, label) => h('button', { type: 'button', role: 'tab', class: 'seg-btn' + (mode === m ? ' active' : ''), id: 'gen-tab-' + m, onclick: () => { mode = m; renderOpts(); generate(); }, text: label });

    function renderOpts() {
        tabs.replaceChildren(tab('pw', t('gen.password')), tab('ph', t('gen.passphrase')), tab('pr', t('gen.pronounceable')));
        if (mode === 'pw') {
            optsBox.replaceChildren(
                num('gen-length', t('gen.length'), 4, 128, pwOpts, 'length'),
                h('div', { class: 'check-grid' }, ...CLASS_KEYS.map((k) => chk('gen-' + k, t('gen.class.' + k) + (k === 'extended' ? '' : ` ${previewChars(k)}`), pwOpts, k))),
                h('div', { class: 'check-grid' }, chk('gen-lookalike', t('gen.lookalike'), pwOpts, 'lookalike'), chk('gen-every', t('gen.every'), pwOpts, 'everyGroup')),
                h('div', { class: 'grid2' },
                    h('label', {}, h('span', { text: t('gen.custom') }), h('input', { id: 'gen-custom', value: pwOpts.custom, oninput: (e) => { pwOpts.custom = e.target.value; generate(); }, autocomplete: 'off', spellcheck: 'false' })),
                    h('label', {}, h('span', { text: t('gen.exclude') }), h('input', { id: 'gen-exclude', value: pwOpts.exclude, oninput: (e) => { pwOpts.exclude = e.target.value; generate(); }, autocomplete: 'off', spellcheck: 'false' }))));
        } else if (mode === 'pr') {
            // Gruppengroesse hoechstens so gross wie die Silbenzahl
            const mkGroup = () => { prOpts.group = Math.min(prOpts.group, prOpts.syllables); return num('gen-group', t('gen.group'), 1, prOpts.syllables, prOpts, 'group'); };
            let groupRow = mkGroup();
            const syl = num('gen-syllables', t('gen.syllables'), 2, 20, prOpts, 'syllables', () => { const g = mkGroup(); groupRow.replaceWith(g); groupRow = g; });
            optsBox.replaceChildren(syl, groupRow,
                h('div', { class: 'grid2' },
                    h('label', {}, h('span', { text: t('gen.separator') }), select('gen-pr-sep', prOpts, 'separators', [['mixed', t('gen.sep.mixed')], ['digits', t('gen.sep.digits')], ['symbols', t('gen.sep.symbols')], ['dash', t('gen.sep.dash')]])),
                    h('label', {}, h('span', { text: t('gen.casing') }), select('gen-pr-casing', prOpts, 'casing', [['lower', t('gen.case.lower')], ['title', t('gen.case.groups')]]))),
                h('p', { class: 'hint', text: t('gen.syllablehint') }));
        } else {
            const sep = h('input', { id: 'gen-sep', value: phOpts.separator, maxlength: 4, oninput: (e) => { phOpts.separator = e.target.value; generate(); }, autocomplete: 'off' });
            const casing = h('select', { id: 'gen-casing', onchange: (e) => { phOpts.casing = e.target.value; generate(); } }, ...['lower', 'upper', 'title', 'mixed'].map((c) => h('option', { value: c, selected: phOpts.casing === c, text: t('gen.case.' + c) })));
            optsBox.replaceChildren(num('gen-words', t('gen.words'), 3, 20, phOpts, 'words'),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('gen.separator') }), sep), h('label', {}, h('span', { text: t('gen.casing') }), casing)),
                h('p', { class: 'hint', text: t('gen.wordlist') }));
        }
    }
    const previewChars = (k) => (CLASSES[k].length <= 12 ? `(${CLASSES[k]})` : '');
    const useBtn = h('button', { type: 'button', class: 'primary', id: 'gen-use', onclick: () => { onUse?.(current, currentBits); m.close(); }, text: t('gen.use') });
    const copyBtn = h('button', { type: 'button', id: 'gen-copy', onclick: () => copy(current, t('f.password')) }, icon('copy'), h('span', { text: t('copy') }));
    const regen = h('button', { type: 'button', id: 'gen-regen', class: 'icon-btn', title: t('gen.regenerate'), 'aria-label': t('gen.regenerate'), onclick: generate }, icon('refresh'));
    const body = h('div', { class: 'stack gen' }, h('div', { class: 'gen-top' }, preview, regen), meter, tabs, optsBox);
    const m = modal({ title: t('generator'), body, size: 'md', cls: 'gen-modal', actions: onUse ? [h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), copyBtn, useBtn] : [copyBtn, h('button', { type: 'button', class: 'primary', text: t('close'), onclick: () => m.close() })] });
    renderOpts(); generate();
    if (!onUse) useBtn.hidden = true;
    return m;
}
