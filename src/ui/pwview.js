// Passwort-Anzeige ohne Abhaengigkeit von der App (auch die Generator-Seite nutzt sie): farbige Zeichen und Staerke-Balken.
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { t } from '../i18n.js';
import { h } from './dom.js';

/** Passwort mit farbigen Ziffern/Sonderzeichen (gut lesbar); textContent bleibt der reine Klartext. */
export function colorizedPassword(pw) {
    const out = h('span', { class: 'pw-colored' });
    for (const ch of pw) out.append(h('span', { class: /[0-9]/.test(ch) ? 'c-digit' : /[A-Za-z]/.test(ch) ? '' : /\s/.test(ch) ? '' : 'c-sym', text: ch }));
    return out;
}

/** bits: exakter Wert, wenn bekannt (Generator); sonst Schaetzung aus dem Text. */
export function strengthBar(pw, bits) {
    if (bits === undefined) bits = pw ? estimateBits(pw) : 0;
    const label = strengthLabel(bits);
    const lvl = { bad: 1, poor: 1, weak: 2, good: 3, excellent: 4 }[label] || 0;
    return h('div', { class: `strength s${lvl}`, 'data-level': label, title: `${Math.round(bits)} bit` },
        h('span', { class: 'bars' }, h('i'), h('i'), h('i'), h('i')), h('span', { class: 'strength-label', text: pw ? `${t('strength.' + label)} · ${Math.round(bits)} bit` : '' }));
}
