// Password and passphrase generator (behaves like KeePassXC: character classes, excluding look-alike characters,
// at least one character from each chosen class, uniformly random via rejection sampling).
import { WORDS as WORDS_EN } from './wordlist-eff.js';
import { WORDS as WORDS_DE } from './wordlist-de.js';

const WORDLISTS = { en: WORDS_EN, de: WORDS_DE };

export const CLASSES = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    // Special 1: usually quick to reach on phone and TV keyboards; special 2: the rest of the ASCII characters
    special1: '!?.,:;-_+=*"$%&@',
    special2: '\'/\\|()[]{}<>#^~`',
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

export const DEFAULT_PASSWORD_OPTIONS = { length: 24, lower: true, upper: true, digits: true, special1: true, special2: false, extended: false, lookalike: true, everyGroup: true, custom: '', exclude: '' };

// Up to 0.9 there were six smaller character groups. Brackets were only in today's group 2, all the others partly in group 1.
const OLD_CLASSES = ['braces', 'punct', 'quotes', 'dashes', 'math', 'logograms'];
export function migratePasswordOptions(o = {}) {
    if (!OLD_CLASSES.some((k) => k in o) || 'special1' in o) return o;
    const { braces, punct, quotes, dashes, math, logograms, ...rest } = o;
    return { ...rest, special1: !!(punct || quotes || dashes || math || logograms), special2: !!braces };
}

/** Returns {password, bits}. Throws Error('empty') if no characters are available. */
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

// Separators for passphrase and simple mode, the first one is the default. Space, period, comma and @ are on the first keyboard
// page on Fire TV.
export const SEPARATORS = [' ', '.', '-', ',', '_', '@', '!'];
export const DEFAULT_PASSPHRASE_OPTIONS = { words: 6, separator: ' ', casing: 'lower', list: 'en', digit: false };
/** list: 'en' (EFF Large Wordlist) or 'de' (dys2p de-7776); both have 7776 words, so about 12.9 bits per word. digit: one digit
 * 0-9 after a random word, for services that demand a number (the words contain no digits, so the bits are exact). */
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

// Simple: for devices with an on-screen keyboard (TV remote, console). Lowercase letters only (optionally the first one capitalised), digits
// and one separator; capitals and most special characters cost a page switch per key.
// Layout: syllables, digits, and for each further block more syllables, e.g. "Bodfussim 47" or "Bodfussim 47 katnoriz lupmesgad".
// A block is three syllables: open (ba), closed (bal) or with a doubled final consonant (ball). Each syllable starts with exactly
// one consonant and one vowel, so every result splits into syllables in only one way (a new syllable starts at every vowel, together
// with the consonant before it). No letters that are easily confused when spelling aloud (c/k, v/f/w, j/y, q, x),
// no hh and no 0/1 (they look like o/l). The separator is fixed and adds no bits.
//
// Uniformly, almost half of the syllables would be doubled and only 4 % open. So the shape is drawn first (weights in
// twentieths: 3 open, 12 closed, 5 doubled), then the syllable uniformly within that shape. A block with a triple
// letter ("tupp" + "pup") or hh ("huh" + "hak") at a syllable boundary is redrawn. Since the blocks are no longer
// equally likely, we don't count but compute the entropy of the actual distribution exactly (unlike
// FIPS 181/pwgen, whose unevenly frequent syllables make the strength look higher than it is).
export const SYLLABLE = { consonants: 'bdfghklmnprstz', vowels: 'aeiou', doubled: 'bdfgklmnprstz' };
export const SYLLABLE_SHAPES = (() => {
    const { consonants: C, vowels: V, doubled: D } = SYLLABLE;
    const shapes = { open: { weight: 3, list: [] }, closed: { weight: 12, list: [] }, doubled: { weight: 5, list: [] } };
    for (const c of C) for (const v of V) {
        shapes.open.list.push(c + v);
        for (const e of C) shapes.closed.list.push(c + v + e);
        for (const e of D) shapes.doubled.list.push(c + v + e + e);
    }
    return shapes;
})();
const SHAPE_TOTAL = Object.values(SYLLABLE_SHAPES).reduce((a, { weight }) => a + weight, 0);
/** All syllables with their probability. */
export const SYLLABLES = Object.values(SYLLABLE_SHAPES).flatMap(({ weight, list }) => list.map((s) => ({ s, p: weight / SHAPE_TOTAL / list.length })));
export const SIMPLE_DIGITS = '23456789';
export const DEFAULT_SIMPLE_OPTIONS = { blocks: 2, separator: ' ', capital: true };
export const badJunction = (a, b) => (a.length === 4 && a[3] === b[0]) || (a.endsWith('h') && b[0] === 'h');
// Exact entropy of a block of three syllables with these weights and without forbidden junctions. Computing it takes about
// 75 ms, so the result sits here; tests/unit/core.test.mjs recomputes it and fails if anything changes.
export const SIMPLE_BLOCK_BITS = 31.972186269066746;
const SIMPLE_DIGITS_BITS = 2 * Math.log2(SIMPLE_DIGITS.length);

function pickSyllable() {
    let r = randomInt(SHAPE_TOTAL);
    for (const { weight, list } of Object.values(SYLLABLE_SHAPES)) {
        if (r < weight) return list[randomInt(list.length)];
        r -= weight;
    }
}

/** Returns {password, bits}. blocks: syllable blocks (1-8, the digits always come after the first). separator: one of
 * SEPARATORS. capital: first letter uppercase (adds no bits, but satisfies "at least one uppercase letter"). */
export function generateSimple(opts = {}) {
    const o = { ...DEFAULT_SIMPLE_OPTIONS, ...opts };
    const n = Math.max(1, Math.min(8, o.blocks));
    const sep = SEPARATORS.includes(o.separator) ? o.separator : DEFAULT_SIMPLE_OPTIONS.separator;
    const pick = (s) => s[randomInt(s.length)];
    const block = () => {
        let a, b, c;
        do { a = pickSyllable(); b = pickSyllable(); c = pickSyllable(); } while (badJunction(a, b) || badJunction(b, c));
        return a + b + c;
    };
    const parts = [block(), pick(SIMPLE_DIGITS) + pick(SIMPLE_DIGITS)];
    for (let i = 1; i < n; i++) parts.push(block());
    let pw = parts.join(sep);
    if (o.capital) pw = pw[0].toUpperCase() + pw.slice(1);
    return { password: pw, bits: n * SIMPLE_BLOCK_BITS + SIMPLE_DIGITS_BITS };
}
