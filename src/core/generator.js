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
