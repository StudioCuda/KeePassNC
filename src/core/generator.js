// Passwort- und Passphrasen-Generator (Verhalten angelehnt an KeePassXC: Zeichenklassen, aehnlich aussehende Zeichen ausschliessen,
// mindestens ein Zeichen je gewaehlter Klasse, gleichverteilt per Rejection Sampling).
import { WORDS as WORDS_EN } from './wordlist-eff.js';
import { WORDS as WORDS_DE } from './wordlist-de.js';

export const WORDLISTS = { en: WORDS_EN, de: WORDS_DE };

export const CLASSES = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    // Sonderzeichen 1: auf Handy- und TV-Tastaturen meist schnell erreichbar; Sonderzeichen 2: der Rest der ASCII-Zeichen
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

// Bis 0.9 gab es sechs kleinere Zeichengruppen. Klammern lagen nur in der heutigen Gruppe 2, alle anderen zum Teil in Gruppe 1.
const OLD_CLASSES = ['braces', 'punct', 'quotes', 'dashes', 'math', 'logograms'];
export function migratePasswordOptions(o = {}) {
    if (!OLD_CLASSES.some((k) => k in o) || 'special1' in o) return o;
    const { braces, punct, quotes, dashes, math, logograms, ...rest } = o;
    return { ...rest, special1: !!(punct || quotes || dashes || math || logograms), special2: !!braces };
}

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

// Trennzeichen fuer Passphrase und Simpel, das erste ist die Vorgabe. Leerzeichen, Punkt, Komma und @ liegen bei Fire TV auf der
// ersten Tastaturseite.
export const SEPARATORS = [' ', '.', '-', ',', '_', '@', '!'];
export const DEFAULT_PASSPHRASE_OPTIONS = { words: 6, separator: ' ', casing: 'lower', list: 'en', digit: false };
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

// Simpel: fuer Geraete mit Bildschirmtastatur (TV-Fernbedienung, Konsole). Nur Kleinbuchstaben, Ziffern und ein Trennzeichen;
// Grossbuchstaben und die meisten Zeichen kosten je Taste einen Seitenwechsel.
// Aufbau: Silben, Ziffern und je weiterem Block noch einmal Silben, z. B. "Bodfussim 47" oder "Bodfussim 47 katnoriz lupmesgad".
// Ein Block sind drei Silben: offen (ba), geschlossen (bal) oder mit verdoppeltem Endkonsonanten (ball). Jede Silbe beginnt mit genau
// einem Konsonanten und einem Vokal, deshalb laesst sich jedes Ergebnis nur auf eine Weise in Silben zerlegen (vor jedem Vokal beginnt
// mit dem Konsonanten davor eine neue Silbe). Ohne Buchstaben, die man beim Buchstabieren leicht verwechselt (c/k, v/f/w, j/y, q, x),
// ohne hh und ohne 0/1 (sehen aus wie o/l). Das Trennzeichen ist fest gewaehlt und bringt keine Bits.
//
// Gleichverteilt waeren fast die Haelfte der Silben verdoppelt und nur 4 % offen. Deshalb wird erst die Form gezogen (Gewichte in
// Zwanzigsteln: 3 offen, 12 geschlossen, 5 verdoppelt), dann die Silbe gleichverteilt innerhalb der Form. Ein Block mit dreifachem
// Buchstaben ("tupp" + "pup") oder hh ("huh" + "hak") an einer Silbengrenze wird neu gezogen. Weil die Bloecke damit nicht mehr
// gleich wahrscheinlich sind, zaehlen wir nicht, sondern rechnen die Entropie der tatsaechlichen Verteilung exakt aus (anders als
// FIPS 181/pwgen, deren ungleich haeufige Silben die Staerke ueberschaetzen lassen).
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
/** Alle Silben mit ihrer Wahrscheinlichkeit. */
export const SYLLABLES = Object.values(SYLLABLE_SHAPES).flatMap(({ weight, list }) => list.map((s) => ({ s, p: weight / SHAPE_TOTAL / list.length })));
export const SIMPLE_DIGITS = '23456789';
export const DEFAULT_SIMPLE_OPTIONS = { blocks: 2, separator: ' ', capital: true };
export const badJunction = (a, b) => (a.length === 4 && a[3] === b[0]) || (a.endsWith('h') && b[0] === 'h');
// Entropie eines Blocks aus `syllables` Silben, ohne verbotene Uebergaenge. Mit P = Produkt der Silben-Wahrscheinlichkeiten und
// Z = Summe aller P der erlaubten Bloecke ist H = log2(Z) - Summe(P * log2 P) / Z. badJunction haengt nur von den letzten zwei
// Buchstaben der vorderen Silbe ab, also fuehren wir Z und Summe(P * log2 P) je Endung mit.
export function simpleBlockEntropy(syllables = 3) {
    const end = (s) => s.slice(-2);
    const add = (m, s, z, b) => { const e = m.get(end(s)) || { z: 0, b: 0, s }; e.z += z; e.b += b; m.set(end(s), e); };
    let f = new Map();
    for (const { s, p } of SYLLABLES) add(f, s, p, p * Math.log2(p));
    for (let i = 1; i < syllables; i++) {
        const g = new Map();
        for (const { z, b, s: prev } of f.values()) for (const { s, p } of SYLLABLES) if (!badJunction(prev, s)) add(g, s, z * p, b * p + z * p * Math.log2(p));
        f = g;
    }
    const all = [...f.values()].reduce((a, { z, b }) => ({ z: a.z + z, b: a.b + b }), { z: 0, b: 0 });
    return Math.log2(all.z) - all.b / all.z;
}
export const SIMPLE_BLOCK_BITS = simpleBlockEntropy(3);
export const SIMPLE_DIGITS_BITS = 2 * Math.log2(SIMPLE_DIGITS.length);

function pickSyllable() {
    let r = randomInt(SHAPE_TOTAL);
    for (const { weight, list } of Object.values(SYLLABLE_SHAPES)) {
        if (r < weight) return list[randomInt(list.length)];
        r -= weight;
    }
}

/** Liefert {password, bits}. blocks: Silbenbloecke (1-8, die Ziffern stehen immer nach dem ersten). separator: eines aus
 * SEPARATORS. capital: erster Buchstabe gross (bringt keine Bits, erfuellt aber "mindestens ein Grossbuchstabe"). */
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
