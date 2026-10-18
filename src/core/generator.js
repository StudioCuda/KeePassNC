// Passwort- und Passphrasen-Generator (Verhalten angelehnt an KeePassXC: Zeichenklassen, aehnlich aussehende Zeichen ausschliessen,
// mindestens ein Zeichen je gewaehlter Klasse, gleichverteilt per Rejection Sampling).
import { WORDS as WORDS_EN } from './wordlist-eff.js';
import { WORDS as WORDS_DE } from './wordlist-de.js';

export const WORDLISTS = { en: WORDS_EN, de: WORDS_DE };

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

export const DEFAULT_PASSPHRASE_OPTIONS = { words: 6, separator: '-', casing: 'lower', list: 'en', digit: false };
/** list: 'en' (EFF Large Wordlist) oder 'de' (dys2p de-7776); beide 7776 Woerter, also ca. 12,9 Bit je Wort. digit: eine Ziffer
 * 0-9 hinter einem zufaelligen Wort, fuer Dienste, die eine Zahl verlangen (die Woerter enthalten keine Ziffern, die Bits sind exakt). */
export function generatePassphrase(opts = {}) {
    const o = { ...DEFAULT_PASSPHRASE_OPTIONS, ...opts };
    const words = WORDLISTS[o.list] || WORDS_EN;
    const n = Math.max(1, Math.min(32, o.words));
    let list = Array.from({ length: n }, () => words[randomInt(words.length)]);
    if (o.casing === 'upper') list = list.map((w) => w.toUpperCase());
    else if (o.casing === 'title') list = list.map((w) => w[0].toUpperCase() + w.slice(1));
    else if (o.casing === 'mixed') { const i = randomInt(n); list[i] = list[i].toUpperCase(); }
    let bits = n * Math.log2(words.length);
    if (o.digit) { const i = randomInt(n); list[i] += CLASSES.digits[randomInt(10)]; bits += Math.log2(n * 10); }
    return { password: list.join(o.separator), bits };
}

// Simpel: fuer Geraete mit Bildschirmtastatur (TV-Fernbedienung, Konsole). Nur Kleinbuchstaben, Ziffern und ein Trennzeichen, das
// auf der ersten Seite der Fire-TV-Tastatur liegt; Grossbuchstaben und andere Zeichen kosten je Taste einen Seitenwechsel.
// Aufbau: Silben, Ziffern und je weiterem Block noch einmal Silben, z. B. "bodfuspim.47" oder "bodfuspim.47.katnoriz.lupmesgad". Ein Block sind drei
// Silben Konsonant-Vokal-Konsonant, jede gleichverteilt (anders als FIPS 181/pwgen, deren Silben ungleich haeufig sind und deren
// Staerke deshalb ueberschaetzt wird). Ohne Buchstaben, die man beim Buchstabieren leicht verwechselt (c/k, v/f/w, j/y, q, x), und
// ohne 0/1 (sehen aus wie o/l). Das Trennzeichen ist fest gewaehlt und bringt keine Bits.
export const SYLLABLE = { consonants: 'bdfghklmnprstz', vowels: 'aeiou' };
export const SIMPLE_DIGITS = '23456789';
export const SIMPLE_SEPARATORS = ['.', ',', ' ', '@'];
export const DEFAULT_SIMPLE_OPTIONS = { blocks: 2, separator: '.', capital: false };
export const SYLLABLE_BITS = Math.log2(SYLLABLE.consonants.length ** 2 * SYLLABLE.vowels.length);
export const SIMPLE_BLOCK_BITS = 3 * SYLLABLE_BITS;
export const SIMPLE_DIGITS_BITS = 2 * Math.log2(SIMPLE_DIGITS.length);

/** Liefert {password, bits}. blocks: Silbenbloecke (1-8, die Ziffern stehen immer nach dem ersten). separator: eines aus
 * SIMPLE_SEPARATORS. capital: erster Buchstabe gross (bringt keine Bits, erfuellt aber "mindestens ein Grossbuchstabe"). */
export function generateSimple(opts = {}) {
    const o = { ...DEFAULT_SIMPLE_OPTIONS, ...opts };
    const n = Math.max(1, Math.min(8, o.blocks));
    const sep = SIMPLE_SEPARATORS.includes(o.separator) ? o.separator : DEFAULT_SIMPLE_OPTIONS.separator;
    const { consonants: C, vowels: V } = SYLLABLE;
    const pick = (s) => s[randomInt(s.length)];
    const syl = () => pick(C) + pick(V) + pick(C);
    const block = () => syl() + syl() + syl();
    const parts = [block(), pick(SIMPLE_DIGITS) + pick(SIMPLE_DIGITS)];
    for (let i = 1; i < n; i++) parts.push(block());
    let pw = parts.join(sep);
    if (o.capital) pw = pw[0].toUpperCase() + pw.slice(1);
    return { password: pw, bits: n * SIMPLE_BLOCK_BITS + SIMPLE_DIGITS_BITS };
}
