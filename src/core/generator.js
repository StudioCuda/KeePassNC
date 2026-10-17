// Passwort- und Passphrasen-Generator (Verhalten angelehnt an KeePassXC: Zeichenklassen, aehnlich aussehende Zeichen ausschliessen,
// mindestens ein Zeichen je gewaehlter Klasse, gleichverteilt per Rejection Sampling).
import { WORDS } from './wordlist-eff.js';

export const CLASSES = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    braces: '()[]{}',
    punct: '.,:;',
    quotes: '"\'',
    dashes: '-/\\_|',
    math: '!*+<=>?',
    logograms: '#$%&@^`~',
    extended: [...Array(0xff - 0xa1 + 1).keys()].map((i) => String.fromCharCode(0xa1 + i)).filter((c) => c !== '­').join('')
};
export const LOOKALIKE = new Set('lBGIO0168|ù'.split(''));

export function randomInt(n) {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % n;
}
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

export const DEFAULT_PASSWORD_OPTIONS = { length: 24, lower: true, upper: true, digits: true, braces: false, punct: false, quotes: false, dashes: true, math: true, logograms: true, extended: false, lookalike: true, everyGroup: true, custom: '', exclude: '' };

/** Liefert {password, bits}. Wirft Error('empty'), wenn keine Zeichen zur Verfuegung stehen. */
export function generatePassword(opts = {}) {
    const o = { ...DEFAULT_PASSWORD_OPTIONS, ...opts };
    const exclude = new Set([...(o.exclude || '')]);
    const filt = (s) => [...new Set([...s])].filter((c) => !exclude.has(c) && !(o.lookalike && LOOKALIKE.has(c)));
    const groups = [];
    for (const k of Object.keys(CLASSES)) if (o[k]) groups.push(filt(CLASSES[k]));
    if (o.custom) groups.push(filt(o.custom));
    const nonEmpty = groups.filter((g) => g.length);
    if (!nonEmpty.length) throw new Error('empty');
    const pool = [...new Set(nonEmpty.flat())];
    const len = Math.max(o.length, o.everyGroup ? nonEmpty.length : 1);
    const out = o.everyGroup ? nonEmpty.map((g) => g[randomInt(g.length)]) : [];
    while (out.length < len) out.push(pool[randomInt(pool.length)]);
    return { password: shuffle(out).join(''), bits: len * Math.log2(pool.length) };
}

export const DEFAULT_PASSPHRASE_OPTIONS = { words: 6, separator: '-', casing: 'lower' };
export function generatePassphrase(opts = {}) {
    const o = { ...DEFAULT_PASSPHRASE_OPTIONS, ...opts };
    const n = Math.max(1, Math.min(32, o.words));
    let list = Array.from({ length: n }, () => WORDS[randomInt(WORDS.length)]);
    if (o.casing === 'upper') list = list.map((w) => w.toUpperCase());
    else if (o.casing === 'title') list = list.map((w) => w[0].toUpperCase() + w.slice(1));
    else if (o.casing === 'mixed') { const i = randomInt(n); list[i] = list[i].toUpperCase(); }
    return { password: list.join(o.separator), bits: n * Math.log2(WORDS.length) };
}

// Aussprechbar: Silben Konsonant-Vokal-Konsonant, jede Silbe gleichverteilt (anders als FIPS 181/pwgen, deren Silben ungleich
// haeufig sind und deren Staerke deshalb ueberschaetzt wird). Ohne Buchstaben, die man beim Buchstabieren leicht verwechselt
// (c/k, v/f/w, j/y, q, x). Zwischen den Silbengruppen ein zufaelliges Zeichen, ohne Klammern, Schraegstriche und | (diktiert
// verwechselbar) und ohne 0/1 (sehen aus wie o/l).
export const SYLLABLE = { consonants: 'bdfghklmnprstz', vowels: 'aeiou' };
export const PRON_SEPARATORS = { digits: '23456789', symbols: '-+=.!?#%&*@' };
export const DEFAULT_PRONOUNCEABLE_OPTIONS = { syllables: 8, group: 2, separators: 'mixed', casing: 'first' };
export const SYLLABLE_BITS = Math.log2(SYLLABLE.consonants.length ** 2 * SYLLABLE.vowels.length);

/** Liefert {password, bits}. casing: 'first' (erster Buchstabe gross), 'title' (jede Gruppe) oder 'lower'. separators: 'mixed' (Ziffern und Zeichen, ab zwei Trennern mindestens je eines), 'digits', 'symbols' oder 'dash'. */
export function generatePronounceable(opts = {}) {
    const o = { ...DEFAULT_PRONOUNCEABLE_OPTIONS, ...opts };
    const n = Math.max(1, Math.min(32, o.syllables));
    const group = Math.max(1, Math.min(n, o.group));
    const { consonants: C, vowels: V } = SYLLABLE;
    const pick = (s) => s[randomInt(s.length)];
    const groups = [];
    for (let i = 0; i < n; i += group) {
        let g = '';
        for (let j = i; j < Math.min(n, i + group); j++) g += pick(C) + pick(V) + pick(C);
        // Feste Grossschreibung bringt keine Bits, erfuellt aber "mindestens ein Grossbuchstabe"
        groups.push(o.casing === 'title' || (o.casing === 'first' && i === 0) ? g[0].toUpperCase() + g.slice(1) : g);
    }
    const k = groups.length - 1;
    const { digits: D, symbols: S } = PRON_SEPARATORS;
    let seps;
    let sepBits = 0;
    if (o.separators === 'dash') seps = Array(k).fill('-');
    else {
        const pool = o.separators === 'digits' ? D : o.separators === 'symbols' ? S : D + S;
        const both = o.separators === 'mixed' && k >= 2;
        // Rejection Sampling: gleichverteilt ueber alle Folgen mit mindestens einer Ziffer und einem Zeichen
        do seps = Array.from({ length: k }, () => pick(pool));
        while (both && !(seps.some((c) => D.includes(c)) && seps.some((c) => S.includes(c))));
        sepBits = both ? Math.log2(pool.length ** k - D.length ** k - S.length ** k) : k * Math.log2(pool.length);
    }
    return { password: groups.map((g, i) => g + (seps[i] ?? '')).join(''), bits: n * SYLLABLE_BITS + sepBits };
}
