// Password display without a dependency on the app (the generator page uses it too): coloured characters and strength bar.
import { guessBits, strengthLabel } from '../core/entropy.js';
import { simpleBits } from '../core/generator.js';
import { t } from '../i18n.js';
import { h } from './dom.js';

/** Password with coloured digits/special characters (easy to read); textContent stays the plain cleartext. */
export function colorizedPassword(pw) {
    const out = h('span', { class: 'pw-colored' });
    for (const ch of pw) out.append(h('span', { class: /[0-9]/.test(ch) ? 'c-digit' : /[A-Za-z]/.test(ch) ? '' : /\s/.test(ch) ? '' : 'c-sym', text: ch }));
    return out;
}

/** bits: exact value if known (generator); otherwise an estimate from the text, shown with a "≈" (a "Simple" password is recognised and exact). */
export function strengthBar(pw, bits) {
    if (bits === undefined) bits = simpleBits(pw);
    const guess = bits === null && !!pw;
    if (bits === null) bits = guessBits(pw);
    const shown = (guess ? '≈ ' : '') + Math.round(bits);
    const label = strengthLabel(bits);
    const lvl = { bad: 1, poor: 1, weak: 2, good: 3, excellent: 4 }[label] || 0;
    return h('div', { class: `strength s${lvl}`, 'data-level': label, title: guess ? `${shown} bit - ${t('strength.estimate')}` : `${shown} bit` },
        h('span', { class: 'bars' }, h('i'), h('i'), h('i'), h('i')), h('span', { class: 'strength-label' }, pw ? t('strength.' + label) : '', pw ? h('span', { class: 'strength-bits', text: ` · ${shown} bit` }) : null));
}
