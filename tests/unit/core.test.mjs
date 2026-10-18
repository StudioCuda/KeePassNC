import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches } from '../../src/core/search.js';
import { generatePassword, generatePassphrase, generateSimple, CLASSES, LOOKALIKE, SYLLABLE, SIMPLE_DIGITS, SIMPLE_SEPARATORS, SYLLABLE_BITS, SIMPLE_BLOCK_BITS } from '../../src/core/generator.js';
import { estimateBits, strengthLabel } from '../../src/core/entropy.js';
import { auditEntries } from '../../src/core/audit.js';
import { WORDS } from '../../src/core/wordlist-eff.js';
import { WORDS as WORDS_DE } from '../../src/core/wordlist-de.js';
import { isOutOfMemory, openableUrl } from '../../src/core/util.js';

const NOW = Date.UTC(2026, 9, 11);
function entry(fields, extra = {}) {
    const g = { name: extra.group || 'Web', parentGroup: { name: 'Root', parentGroup: null } };
    return { fields: new Map(Object.entries(fields)), tags: extra.tags || [], binaries: new Map(Object.entries(extra.binaries || {})), history: [], parentGroup: g,
        uuid: { id: 'abc', toString: () => 'abc' }, times: extra.times || {}, qualityCheck: extra.qualityCheck };
}
const mail = entry({ Title: 'Mail', UserName: 'alice', URL: 'https://example.org', Notes: 'Privat', Password: 'x' }, { tags: ['privat', 'mail'] });
const m = (q, e = mail, ctx = {}) => matches(e, parseQuery(q), ctx);

test('Suche: Standardfelder, UND-Verknuepfung, Gross-/Kleinschreibung', () => {
    assert.ok(m('mail')); assert.ok(m('ALICE example')); assert.ok(!m('mail bob')); assert.ok(m('privat')); assert.ok(m(''));
});
test('Suche: Feldpraefixe und Ausschluss', () => {
    assert.ok(m('t:mail')); assert.ok(m('user:alice')); assert.ok(!m('title:alice')); assert.ok(m('-title:bob')); assert.ok(!m('-title:mail')); assert.ok(m('!tag:xyz'));
    assert.ok(m('tag:privat')); assert.ok(m('group:web')); assert.ok(m('url:example'));
});
test('Suche: Platzhalter, Regex, exakt, Anfuehrungszeichen', () => {
    assert.ok(m('title:ma*')); assert.ok(m('title:xx|mail')); assert.ok(m('title:m?il')); assert.ok(!m('title:m?l'));
    assert.ok(m('*title:^Ma.l$')); assert.ok(!m('*title:^Mail!$')); assert.ok(m('+title:Mail')); assert.ok(!m('+title:mail'));
    const e2 = entry({ Title: 'Mein Konto' }); assert.ok(m('"mein konto"', e2)); assert.ok(!m('"mein  konto"', e2));
});
test('Suche: is:/has:', () => {
    const exp = entry({ Title: 'alt', Password: 'p' }, { times: { expires: true, expiryTime: new Date(NOW - 5 * 86400000) } });
    const soon = entry({ Title: 'bald', Password: 'p' }, { times: { expires: true, expiryTime: new Date(NOW + 5 * 86400000) } });
    assert.ok(m('is:expired', exp, { now: NOW })); assert.ok(!m('is:expired', soon, { now: NOW })); assert.ok(m('is:expired-10', soon, { now: NOW }));
    assert.ok(m('has:totp', entry({ Title: 'x', otp: 'otpauth://totp/x?secret=AAAA' }))); assert.ok(!m('has:totp'));
    assert.ok(m('is:weak', mail, { isWeak: () => true })); assert.ok(m('has:attachment', entry({ Title: 'a' }, { binaries: { 'a.txt': 1 } })));
    assert.ok(m('_pin:1234', entry({ Title: 'p', PIN: '1234' })));
});
test('Generator: Laenge, Klassen, keine Lookalikes, mindestens ein Zeichen je Klasse', () => {
    for (let i = 0; i < 200; i++) {
        const { password: p, bits } = generatePassword({ length: 16 });
        assert.equal([...p].length, 16);
        assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[-/\\_|]/.test(p) && /[!*+<=>?]/.test(p) && /[#$%&@^`~]/.test(p));
        assert.ok(![...p].some((c) => LOOKALIKE.has(c)), 'Lookalike in ' + p);
        assert.ok(bits > 80);
    }
    assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, dashes: false, math: false, logograms: false }), /empty/);
    const only = generatePassword({ length: 40, lower: false, upper: false, digits: true, dashes: false, math: false, logograms: false, exclude: '123' }).password;
    assert.ok(/^[04-9]+$/.test(only.replace(/[168]/g, '')) || /^[0-9]+$/.test(only), only);
    assert.ok(![...only].some((c) => '123'.includes(c)));
});
test('Generator: Gleichverteilung grob (kein Zeichen fehlt bei 20000 Ziehungen)', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) for (const c of generatePassword({ length: 10, lower: false, upper: false, dashes: false, math: false, logograms: false, lookalike: false }).password) seen.add(c);
    assert.equal(seen.size, 10);
});
test('Passphrase: Wortanzahl, Trenner, Entropie, Schreibweise', () => {
    const { password, bits } = generatePassphrase({ words: 7, separator: ' ', casing: 'title' });
    const w = password.split(' '); assert.equal(w.length, 7); assert.ok(w.every((x) => /^[A-Z]/.test(x)));
    assert.ok(Math.abs(bits - 7 * Math.log2(WORDS.length)) < 1e-9); assert.ok(WORDS.length > 7000);
    assert.ok(generatePassphrase({ words: 4, casing: 'upper', separator: '.' }).password.split('.').every((x) => x === x.toUpperCase()));
});
test('Passphrase: deutsche Wortliste (7776 eindeutige Woerter, nur a-z), Englisch als Vorgabe', () => {
    assert.equal(WORDS_DE.length, 7776); assert.equal(new Set(WORDS_DE).size, 7776); assert.ok(WORDS_DE.every((w) => /^[a-z]{3,}$/.test(w)));
    const de = new Set(WORDS_DE);
    const { password, bits } = generatePassphrase({ words: 5, separator: ' ', list: 'de' });
    assert.ok(password.split(' ').every((w) => de.has(w)), password); assert.ok(Math.abs(bits - 5 * Math.log2(7776)) < 1e-9);
    const en = new Set(WORDS);
    assert.ok(generatePassphrase({ words: 5, separator: ' ' }).password.split(' ').every((w) => en.has(w)));
});
test('Passphrase: Ziffer hinter einem Wort, exakte Entropie', () => {
    for (let i = 0; i < 200; i++) {
        const { password, bits } = generatePassphrase({ words: 5, separator: '-', list: 'de', digit: true });
        const w = password.split('-'); assert.equal(w.length, 5);
        assert.equal(w.filter((x) => /^[a-z]+[0-9]$/.test(x)).length, 1, password); assert.equal(w.filter((x) => /^[a-z]+$/.test(x)).length, 4, password);
        assert.ok(Math.abs(bits - (5 * Math.log2(7776) + Math.log2(50))) < 1e-9);
    }
});
test('Simpel: Silben, Ziffern, Silben (+ weitere Silbenbloecke), Trennzeichen fest, nur a-z und 2-9, exakte Entropie', () => {
    const C = `[${SYLLABLE.consonants}]`, V = `[${SYLLABLE.vowels}]`, B = `(${C}${V}${C}){3}`, D = `[${SIMPLE_DIGITS}]{2}`;
    assert.ok(![...SIMPLE_DIGITS].some((c) => '01'.includes(c))); assert.deepEqual(SIMPLE_SEPARATORS, ['.', ',', ' ', '@']);
    const esc = (c) => c.replace(/[.]/g, '\\.');
    for (const sep of SIMPLE_SEPARATORS) for (const blocks of [2, 3, 6]) {
        for (let i = 0; i < 50; i++) {
            const { password: p, bits } = generateSimple({ blocks, separator: sep });
            const S = esc(sep);
            assert.match(p, new RegExp(`^${B}${S}${D}${S}${B}(${S}${B}){${blocks - 2}}$`), p);
            assert.ok(Math.abs(bits - (blocks * 3 * SYLLABLE_BITS + 2 * Math.log2(8))) < 1e-9); assert.ok(Math.abs(SIMPLE_BLOCK_BITS - 29.8) < 0.1);
        }
    }
    assert.match(generateSimple().password, /^[a-z]{9}\.[2-9]{2}\.[a-z]{9}$/);
    assert.match(generateSimple({ capital: true, separator: '@' }).password, /^[A-Z][a-z]{8}@[2-9]{2}@[a-z]{9}$/);
    assert.match(generateSimple({ blocks: 1, separator: '/' }).password, /^[a-z]{9}\.[2-9]{2}\.[a-z]{9}$/, 'mindestens zwei Bloecke, nur erlaubte Trenner');
    const seen = new Set();
    for (let i = 0; i < 400; i++) for (const c of generateSimple().password.replace(/[a-z.]/g, '')) seen.add(c);
    assert.equal(seen.size, SIMPLE_DIGITS.length);
});
test('Staerke-Schaetzung: Reihenfolge sinnvoll', () => {
    const b = (p) => estimateBits(p);
    assert.ok(b('123456') < 25 && b('password') < 25 && b('Sommer2020') < 30 && b('qwertyuiop') < 30 && b('aaaaaaaaaaaa') < 30);
    assert.ok(b('Tr0ub4dor&3') < 75 && b('correct horse battery staple') > 75 && b(generatePassword({ length: 24 }).password) > 100);
    assert.equal(b(''), 0); assert.equal(strengthLabel(b('123456')), 'poor'); assert.equal(strengthLabel(120), 'excellent');
});
test('Bericht: schwache, doppelte, abgelaufene Passwoerter; Ausnahmen', () => {
    const a = entry({ Title: 'a', Password: 'Sommer2020' }), b = entry({ Title: 'b', Password: 'Sommer2020' });
    const c = entry({ Title: 'c', Password: generatePassword().password });
    const d = entry({ Title: 'd', Password: generatePassword().password }, { times: { expires: true, expiryTime: new Date(NOW - 86400000) } });
    const e = entry({ Title: 'e', Password: '123456' }, { qualityCheck: false });
    const f = entry({ Title: 'f', Password: '' });
    const r = auditEntries([a, b, c, d, e, f], NOW);
    const titles = r.items.map((i) => i.entry.fields.get('Title'));
    assert.deepEqual(new Set(titles), new Set(['a', 'b', 'd']));
    assert.equal(r.items.find((i) => i.entry === d).score, 0);
    assert.ok(r.items.find((i) => i.entry === a).reasons.some((x) => x.code === 'reused' && x.uses === 2));
    assert.equal(r.stats.excluded, 1); assert.equal(r.stats.noPassword, 1); assert.equal(r.stats.expired, 1);
});

test('Argon2-Speicherfehler werden erkannt (RangeError, WebAssembly-Trap, Textmeldungen), andere Fehler nicht', () => {
    assert.ok(isOutOfMemory(new RangeError('Invalid typed array length: 4294968320')));
    assert.ok(isOutOfMemory(new WebAssembly.RuntimeError('memory access out of bounds')));
    assert.ok(isOutOfMemory(new Error('WebAssembly.Memory(): could not allocate memory')));
    assert.ok(isOutOfMemory(new Error('Out of memory')));
    assert.ok(!isOutOfMemory(new Error('Wrong password')));
    assert.ok(!isOutOfMemory(new TypeError('x is not a function')));
    assert.ok(!isOutOfMemory(null) && !isOutOfMemory(undefined));
});

test('openableUrl: http(s) und nackte Hostnamen werden Links, alles andere bleibt Text', () => {
    assert.equal(openableUrl('https://example.org/a?b=1'), 'https://example.org/a?b=1');
    assert.equal(openableUrl(' HTTP://example.org '), 'HTTP://example.org');
    assert.equal(openableUrl('example.com'), 'https://example.com');
    assert.equal(openableUrl('www.bank.at:8443/login#x'), 'https://www.bank.at:8443/login#x');
    for (const bad of ['', 'javascript:alert(1)', 'cmd://putty.exe', '{REF:U@I:1234}', 'nur text', '1.5', 'alice@example.org', 'https://', 'data:text/html,x', 'example.com/a b'])
        assert.equal(openableUrl(bad), null, bad);
    assert.equal(openableUrl('example.com', { bare: false }), null);
    assert.equal(openableUrl('https://example.com', { bare: false }), 'https://example.com');
});
