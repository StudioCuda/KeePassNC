import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches } from '../../src/core/search.js';
import { generatePassword, generatePassphrase, generateSimple, CLASSES, LOOKALIKE, SYLLABLE, SYLLABLES, SYLLABLE_SHAPES, SIMPLE_DIGITS, SEPARATORS, migratePasswordOptions, SIMPLE_BLOCK_BITS, badJunction, randomInt } from '../../src/core/generator.js';
import { estimateBits, strengthLabel, cachedBits, clearBitsCache, bitsCacheSize } from '../../src/core/entropy.js';
import { auditEntries, passwordSince, reusedBy } from '../../src/core/audit.js';
import { WORDS } from '../../src/core/wordlist-eff.js';
import { WORDS as WORDS_DE } from '../../src/core/wordlist-de.js';
import { isOutOfMemory, openableUrl, resolveRefs, resolvePlaceholders, uuidHex, previewKind, previewOf, entryColor } from '../../src/core/util.js';

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
        assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && [...p].some((c) => CLASSES.special1.includes(c)) && ![...p].some((c) => CLASSES.special2.includes(c)));
        assert.ok(![...p].some((c) => LOOKALIKE.has(c)), 'Lookalike in ' + p);
        assert.ok(bits > 80);
    }
    assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, special1: false }), /empty/);
    const only = generatePassword({ length: 40, lower: false, upper: false, digits: true, special1: false, exclude: '123' }).password;
    assert.ok(/^[04-9]+$/.test(only.replace(/[168]/g, '')) || /^[0-9]+$/.test(only), only);
    assert.ok(![...only].some((c) => '123'.includes(c)));
});
test('Generator: Gleichverteilung grob (kein Zeichen fehlt bei 20000 Ziehungen)', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) for (const c of generatePassword({ length: 10, lower: false, upper: false, special1: false, lookalike: false }).password) seen.add(c);
    assert.equal(seen.size, 10);
});
test('Passphrase: Wortanzahl, Trenner, Entropie, Schreibweise', () => {
    const { password, bits } = generatePassphrase({ words: 7, separator: ' ', casing: 'title' });
    const w = password.split(' '); assert.equal(w.length, 7); assert.ok(w.every((x) => /^[A-Z]/.test(x)));
    assert.ok(Math.abs(bits - 7 * Math.log2(WORDS.length)) < 1e-9); assert.ok(WORDS.length > 7000);
    assert.ok(generatePassphrase({ words: 4, casing: 'upper', separator: '.' }).password.split('.').every((x) => x === x.toUpperCase()));
});
test('Generator: Sonderzeichen 1 und 2 decken alle ASCII-Sonderzeichen genau einmal ab, alte Einstellungen werden uebernommen', () => {
    const all = [...Array(95).keys()].map((i) => String.fromCharCode(32 + i)).filter((c) => !/[ a-zA-Z0-9]/.test(c));
    const both = [...CLASSES.special1, ...CLASSES.special2];
    assert.equal(both.length, all.length); assert.deepEqual([...both].sort(), all.sort());
    assert.deepEqual([...CLASSES.special1].sort(), [...'!*"-=?$%&@.:;,_+'].sort());
    const p = generatePassword({ length: 60 }).password;
    assert.ok(![...p].some((c) => CLASSES.special2.includes(c)) && [...p].some((c) => CLASSES.special1.includes(c)), p);
    assert.deepEqual(migratePasswordOptions({ length: 30, braces: false, punct: false, quotes: false, dashes: true, math: true, logograms: true, custom: 'x' }), { length: 30, custom: 'x', special1: true, special2: false });
    assert.deepEqual(migratePasswordOptions({ braces: true, punct: false, quotes: false, dashes: false, math: false, logograms: false }), { special1: false, special2: true });
    const fresh = { length: 20, special1: false, special2: true };
    assert.equal(migratePasswordOptions(fresh), fresh); assert.deepEqual(migratePasswordOptions(undefined), {});
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
// Entropy of a block of `syllables` syllables, without forbidden junctions. With P = product of the syllable probabilities and
// Z = sum of all P of the allowed blocks, H = log2(Z) - sum(P * log2 P) / Z. badJunction only depends on the last two
// letters of the leading syllable, so we carry Z and sum(P * log2 P) along per ending.
function simpleBlockEntropy(syllables) {
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
// Splits a syllable block: a new syllable starts before every vowel, together with the consonant in front of it
const splitSyllables = (w) => w.replace(/([^aeiou])(?=[aeiou])/g, ' $1').trim().split(' ');
test('Simpel: Silbenvorrat, eindeutige Zerlegung, Uebergaenge, exakte Entropie', () => {
    const { consonants: C, vowels: V } = SYLLABLE;
    const { open, closed, doubled } = SYLLABLE_SHAPES;
    assert.deepEqual([open.list.length, closed.list.length, doubled.list.length], [70, 980, 910]);
    const all = SYLLABLES.map(({ s }) => s);
    assert.equal(new Set(all).size, all.length); assert.ok(Math.abs(SYLLABLES.reduce((a, { p }) => a + p, 0) - 1) < 1e-12);
    assert.ok(all.every((s) => C.includes(s[0]) && V.includes(s[1]) && (s.length < 4 || (s[2] === s[3] && s[3] !== 'h'))));
    assert.ok(!all.some((s) => /[cjqvwxy]/.test(s)));
    for (let i = 0; i < 20000; i++) {
        const seq = [0, 1, 2].map(() => all[randomInt(all.length)]);
        assert.deepEqual(splitSyllables(seq.join('')), seq);
    }
    // Entropy for two syllables against brute-forcing all pairs
    let z = 0, b = 0;
    for (const x of SYLLABLES) for (const y of SYLLABLES) if (!badJunction(x.s, y.s)) { const p = x.p * y.p; z += p; b += p * Math.log2(p); }
    assert.ok(Math.abs(simpleBlockEntropy(2) - (Math.log2(z) - b / z)) < 1e-9);
    assert.ok(Math.abs(simpleBlockEntropy(1) + SYLLABLES.reduce((a, { p }) => a + p * Math.log2(p), 0)) < 1e-9);
    // Uniformly distributed it would be log2(1960) = 10.94 bits per syllable; the weighting costs only a little
    assert.ok(Math.abs(SIMPLE_BLOCK_BITS - simpleBlockEntropy(3)) < 1e-9, `SIMPLE_BLOCK_BITS muss ${simpleBlockEntropy(3)} sein`);
    assert.ok(SIMPLE_BLOCK_BITS > 31.5 && SIMPLE_BLOCK_BITS < 3 * Math.log2(1960));
});
test('Simpel: Silben, Ziffern, Silben (+ weitere Silbenbloecke), Trennzeichen fest, nur a-z und 2-9, exakte Entropie', () => {
    const syl = new Set(SYLLABLES.map(({ s }) => s));
    assert.ok(![...SIMPLE_DIGITS].some((c) => '01'.includes(c))); assert.deepEqual(SEPARATORS, [' ', '.', '-', ',', '_', '@', '!']);
    const shapes = { 2: 0, 3: 0, 4: 0, n: 0 };
    for (const sep of SEPARATORS) for (const blocks of [1, 2, 3, 6]) {
        for (let i = 0; i < 50; i++) {
            const { password: p, bits } = generateSimple({ blocks, separator: sep, capital: false });
            const parts = p.split(sep);
            assert.equal(parts.length, blocks + 1, p); assert.match(parts[1], /^[2-9]{2}$/, p);
            for (const w of [parts[0], ...parts.slice(2)]) {
                const s = splitSyllables(w);
                assert.equal(s.length, 3, p); assert.ok(s.every((x) => syl.has(x)), p);
                assert.ok(!/(.)\1\1|hh/.test(w), 'dreifach oder hh in ' + p);
                s.forEach((x) => { shapes[x.length]++; shapes.n++; });
            }
            assert.ok(Math.abs(bits - (blocks * SIMPLE_BLOCK_BITS + 2 * Math.log2(8))) < 1e-9);
        }
    }
    // Shares: 15 % open, 60 % closed, 25 % doubled (slightly less, because blocks with a triple letter are redrawn)
    const share = (k) => shapes[k] / shapes.n;
    assert.ok(Math.abs(share(2) - 0.15) < 0.02 && Math.abs(share(3) - 0.6) < 0.025 && share(4) < 0.26 && share(4) > 0.22, JSON.stringify(shapes));
    assert.match(generateSimple().password, /^[A-Z][a-z]{5,11} [2-9]{2} [a-z]{6,12}$/, 'Vorgabe: zwei Bloecke, Leerzeichen, erster Buchstabe gross');
    assert.match(generateSimple({ capital: true, separator: '@' }).password, /^[A-Z][a-z]+@[2-9]{2}@[a-z]+$/);
    assert.match(generateSimple({ blocks: 1, capital: false, separator: '.' }).password, /^[a-z]{6,12}\.[2-9]{2}$/);
    assert.match(generateSimple({ blocks: 0, separator: '/' }).password, /^[A-Z][a-z]+ [2-9]{2}$/, 'mindestens ein Block, nur erlaubte Trenner');
    const seen = new Set();
    for (let i = 0; i < 400; i++) for (const c of generateSimple().password.replace(/[a-zA-Z ]/g, '')) seen.add(c);
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
    const sum = r.items.reduce((s, i) => s + i.score, 0) + 100;
    assert.equal(r.stats.health, Math.round(sum / 4), 'Durchschnitt ueber die 4 geprueften Eintraege, c zaehlt 100');
});
test('Bericht: Gesundheit ist ein Durchschnitt pro Eintrag, nicht Treffer minus verschiedene Passwoerter', () => {
    const strong = () => entry({ Title: 's', Password: generatePassword().password });
    assert.equal(auditEntries([], NOW).stats.health, 100);
    assert.equal(auditEntries([strong(), strong()], NOW).stats.health, 100);
    // Many entries with a few weak passwords: used to be 0 %, because hits (entries) >= distinct passwords
    const many = [...Array(30)].map((_, i) => entry({ Title: 'w' + i, Password: 'Sommer' + (i % 3) + 'x!' })).concat([...Array(10)].map(strong));
    const h = auditEntries(many, NOW).stats.health;
    assert.ok(h > 0 && h < 100, `health ${h}`);
    // A single hit among only strong passwords doesn't round up to 100 %
    const almost = [...Array(300)].map(strong).concat([entry({ Title: 'x', Password: generatePassword().password }, { times: { expires: true, expiryTime: new Date(NOW + 20 * 86400000) } })]);
    assert.equal(auditEntries(almost, NOW).stats.health, 99);
    const gone = entry({ Title: 'g', Password: generatePassword().password }, { times: { expires: true, expiryTime: new Date(NOW - 86400000) } });
    assert.equal(auditEntries([gone], NOW).stats.health, 0, 'alles abgelaufen bleibt ehrlich 0 %');
});

test('Bericht: Passwort-Alter aus der Historie, "Unauffaellig"', () => {
    const day = 86400000, at = (d) => ({ lastModTime: new Date(NOW - d * day) });
    const pw = generatePassword().password;
    const old = entry({ Title: 'old', Password: pw }, { times: at(10) });
    old.history = [{ fields: new Map([['Password', 'alt']]), times: at(900) }, { fields: new Map([['Password', pw]]), times: at(500) }, { fields: new Map([['Password', pw]]), times: at(30) }];
    const changed = entry({ Title: 'neu', Password: generatePassword().password }, { times: at(10) });
    changed.history = [{ fields: new Map([['Password', 'alt']]), times: at(900) }];
    const plain = entry({ Title: 'ohne', Password: generatePassword().password }, { times: at(400) });
    const r = auditEntries([old, changed, plain, entry({ Title: 'w', Password: '123456' })], NOW);
    assert.equal(passwordSince(old).getTime(), NOW - 500 * day, 'aelteste Version am Stueck mit demselben Passwort');
    assert.equal(r.stats.old, 2); assert.equal(r.stats.ok, 3);
    assert.equal(r.stats.health, Math.round((300 + r.items[0].score) / 4), 'Alter zaehlt nicht in die Note');
});

const withUuid = (e, hex) => Object.assign(e, { uuid: { toString: () => Buffer.from(hex, 'hex').toString('base64') } });
test('Feldreferenzen: {REF:…} wie KeePass aufloesen, geschachtelt, Zyklen und Unbekanntes bleiben stehen', () => {
    const A = 'B2D4F6A8C0E1F3A5B7C9D1E3F5A7B9C1', B = '00112233445566778899AABBCCDDEEFF';
    const a = withUuid(entry({ Title: 'Bank', UserName: 'alice', Password: 'Kl4r-und-l4ng!', URL: 'https://bank.example', Konto: 'AT12' }), A);
    const b = withUuid(entry({ Title: 'Bank Zweitlogin', Password: `{REF:P@I:${A}}` }), B);
    const all = [a, b];
    assert.equal(uuidHex(a.uuid), A);
    assert.equal(resolveRefs(`{REF:P@I:${A}}`, all), 'Kl4r-und-l4ng!');
    assert.equal(resolveRefs(`{REF:U@I:${A.toLowerCase()}}`, all), 'alice', 'UUID auch in Kleinbuchstaben');
    assert.equal(resolveRefs('{REF:A@T:bank}/{REF:I@O:at12}', all), `https://bank.example/${A}`, 'Suche im Titel bzw. in eigenen Feldern');
    assert.equal(resolveRefs(`{REF:P@I:${B}}`, all), 'Kl4r-und-l4ng!', 'Referenz auf eine Referenz');
    const loop = withUuid(entry({ Password: `{REF:P@I:${B}}` }), B);
    assert.match(resolveRefs(`{REF:P@I:${B}}`, [loop]), /^\{REF:/, 'Zyklus endet als {REF:…}');
    assert.equal(resolveRefs('{REF:P@I:FFFF}', all), '{REF:P@I:FFFF}');
    assert.equal(resolveRefs('kein Verweis', all), 'kein Verweis');
});
test('Platzhalter: eigene Felder, {S:…}, URL-Teile, gemischt mit {REF:…}, Unbekanntes bleibt stehen', () => {
    const A = 'B2D4F6A8C0E1F3A5B7C9D1E3F5A7B9C1';
    const host = withUuid(entry({ Title: 'NAS', UserName: 'admin', Password: 'pw', URL: 'https://bob:geh%20eim@nas.local:5001/login?x=1', Notes: 'n', 'Server Name': 'nas.local' }), A);
    const all = [host];
    const r = (text, e = host) => resolvePlaceholders(text, e, all);
    assert.equal(r('{USERNAME}@{title} {Password} {NOTES}'), 'admin@NAS pw n', 'Gross-/Kleinschreibung egal');
    assert.equal(r('ssh {S:Server Name} / {s:server name} / {S:Fehlt}'), 'ssh nas.local / nas.local / {S:Fehlt}');
    assert.equal(r('{URL:RMVSCM}'), 'bob:geh%20eim@nas.local:5001/login?x=1');
    assert.equal(r('{URL:SCM}|{URL:HOST}|{URL:PORT}|{URL:PATH}|{URL:QUERY}'), 'https|nas.local|5001|/login|?x=1');
    assert.equal(r('{URL:USERINFO}|{URL:USERNAME}|{URL:PASSWORD}|{URL:WAS}'), 'bob:geh eim|bob|geh eim|{URL:WAS}');
    const other = entry({ Title: 'Zweit', UserName: `{REF:U@I:${A}}`, URL: 'https://{S:Host}/{USERNAME}', Host: 'example.org' });
    assert.equal(r('{URL}', other), 'https://example.org/admin', 'URL mit eigenem Feld und Benutzername aus der Referenz');
    const self = entry({ Title: 'Schleife', Password: '{PASSWORD}' });
    assert.equal(r('{PASSWORD}', self), '{PASSWORD}', 'Selbstbezug endet');
    assert.equal(r('a{b}c {UNBEKANNT} {}'), 'a{b}c {UNBEKANNT} {}');
    assert.equal(resolveRefs('{USERNAME}', all), '{USERNAME}', 'ohne eigenen Eintrag nur {REF:…}');
    assert.equal(r('{URL:RMVSCM}', entry({ URL: 'nas.local/x' })), 'nas.local/x', 'URL ohne Schema');
});
test('Platzhalter mit secrets: false (URL-Feld): Passwoerter und geschuetzte Felder bleiben stehen, der Rest wird aufgeloest', () => {
    const A = 'B2D4F6A8C0E1F3A5B7C9D1E3F5A7B9C1';
    const prot = { getText: () => 'pin-1234' }; // like ProtectedValue: not a string
    const bank = withUuid(entry({ Title: 'Bank', UserName: 'alice', Password: 'Kl4r-und-l4ng!', URL: 'https://bank.example', PIN: prot, Host: 'example.org' }), A);
    const evil = entry({ Title: 'Importiert', UserName: 'eve', Password: 'x', URL: 'https://evil.example/?p={REF:P@T:}&u={REF:U@T:}', Pin: prot, Host: 'evil.example' });
    const all = [bank, evil];
    const safe = (text, e = evil) => resolvePlaceholders(text, e, all, { secrets: false });
    assert.equal(safe('{URL}'), 'https://evil.example/?p={REF:P@T:}&u=alice', 'fremdes Passwort per {REF:P@…} bleibt stehen, Benutzername nicht');
    assert.equal(safe('https://x/?a={PASSWORD}&b={password}&c={S:Pin}&d={S:Host}&e={USERNAME}'), 'https://x/?a={PASSWORD}&b={password}&c={S:Pin}&d=evil.example&e=eve');
    assert.equal(safe(`{REF:A@I:${A}}`), 'https://bank.example', 'ungeschuetzte Felder anderer Eintraege gehen weiter');
    const nested = entry({ UserName: '{PASSWORD}', Password: 'geheim', URL: 'https://x/{USERNAME}' });
    assert.equal(safe('{URL}', nested), 'https://x/{PASSWORD}', 'auch geschachtelt ueber ein ungeschuetztes Feld');
    assert.equal(resolvePlaceholders('{REF:P@T:bank} {S:PIN}', bank, all), 'Kl4r-und-l4ng! pin-1234', 'ohne Option wie bisher (Passwortfeld, Kopieren)');
});
test('Platzhalter mit secrets: own (URL oeffnen/kopieren): eigene Geheimnisse ja, fremde nicht', () => {
    const A = 'B2D4F6A8C0E1F3A5B7C9D1E3F5A7B9C1';
    const prot = { getText: () => 'pin-1234' };
    const bank = withUuid(entry({ Title: 'Bank', UserName: 'alice', Password: 'Kl4r-und-l4ng!', PIN: prot }), A);
    const old = entry({ Title: 'Altes Login', UserName: 'bob', Password: 'pw-alt', PIN: prot, URL: 'https://old.example/?u={USERNAME}&p={PASSWORD}&pin={S:PIN}' });
    const sneaky = entry({ Title: 'Importiert', Password: '{REF:P@T:Bank}', URL: 'https://evil.example/?p={PASSWORD}' });
    const viaUser = entry({ Title: 'Umweg', UserName: '{REF:U@T:Bank}', URL: 'https://evil.example/{USERNAME}' });
    const all = [bank, old, sneaky, viaUser];
    const own = (e) => resolvePlaceholders('{URL}', e, all, { secrets: 'own' });
    assert.equal(own(old), 'https://old.example/?u=bob&p=pw-alt&pin=pin-1234', 'eigenes Passwort und eigenes geschuetztes Feld');
    assert.equal(own(sneaky), 'https://evil.example/?p={REF:P@T:Bank}', 'eigenes Passwort, das auf ein fremdes zeigt, bleibt ein Verweis');
    assert.equal(resolvePlaceholders('{URL}', viaUser, all, { secrets: 'own' }), 'https://evil.example/alice', 'fremder Benutzername geht weiter');
    assert.equal(resolvePlaceholders('?p={REF:P@T:Bank}&q={REF:P@T:Altes}', old, all, { secrets: 'own' }), '?p={REF:P@T:Bank}&q=pw-alt', 'Verweis auf sich selbst ja, auf andere nein');
    const nested = entry({ Title: 'Kette', UserName: '{REF:P@T:Bank}', URL: 'https://x/{USERNAME}' });
    assert.equal(resolvePlaceholders('{URL}', nested, [...all, nested], { secrets: 'own' }), 'https://x/{REF:P@T:Bank}', 'auch geschachtelt ueber ein eigenes Feld');
});
test('Bericht: Referenz-Passwoerter zaehlen mit dem Ziel, aber nicht als Wiederverwendung', () => {
    const A = 'B2D4F6A8C0E1F3A5B7C9D1E3F5A7B9C1';
    const weak = withUuid(entry({ Title: 'alt', Password: 'Sommer2020' }), A);
    const ref = withUuid(entry({ Title: 'ref', Password: `{REF:P@I:${A}}` }), '00112233445566778899AABBCCDDEEFF');
    const dangling = withUuid(entry({ Title: 'weg', Password: '{REF:P@I:0000}' }), '0123456789ABCDEF0123456789ABCDEF');
    const r = auditEntries([weak, ref, dangling], NOW);
    const of = (e) => r.items.find((i) => i.entry === e)?.reasons.map((x) => x.code) || [];
    assert.deepEqual(of(ref), ['weak'], 'schwach wie das Ziel, keine Wiederverwendung');
    assert.deepEqual(of(weak), ['weak']);
    assert.deepEqual(of(dangling), [], 'nicht aufloesbar: keine Aussage');
    assert.equal(r.stats.weak, 2); assert.equal(r.stats.reused, 0);
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

test('Anhang-Vorschau: Bild nach Endung (auch SVG), Text nur als gueltiges UTF-8 ohne Nullbytes, Grenzen fuer die Groesse', () => {
    assert.equal(previewKind('foto.JPG', 1000), 'image');
    assert.equal(previewKind('logo.svg', 10), 'image');
    assert.equal(previewKind('riesig.png', 9 * 1024 * 1024), null);
    assert.equal(previewKind('id_ed25519.pub', 100), 'text');
    assert.equal(previewKind('README', 100), 'text', 'ohne Endung: als Text versuchen');
    assert.equal(previewKind('archiv.zip', 100), null);
    assert.equal(previewKind('log.txt', 2 * 1024 * 1024), null);
    const enc = (x) => new TextEncoder().encode(x);
    assert.deepEqual(previewOf('notiz.txt', enc('Grüße\nzweite Zeile')), { text: 'Grüße\nzweite Zeile' });
    assert.equal(previewOf('kaputt.txt', new Uint8Array([0xff, 0xfe, 0x41])), null);
    assert.equal(previewOf('binaer', new Uint8Array([0x41, 0, 0x42])), null);
    assert.equal(previewOf('a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])).image, 'data:image/png;base64,iVBORw==');
    assert.match(previewOf('b.svg', enc('<svg/>')).image, /^data:image\/svg\+xml;base64,/);
});

test('Eintragsfarbe: nur gueltiges #RRGGBB, in Kleinbuchstaben', () => {
    assert.equal(entryColor({ bgColor: '#FF8000' }), '#ff8000');
    assert.equal(entryColor({ bgColor: '' }), null);
    assert.equal(entryColor({ bgColor: 'red' }), null);
    assert.equal(entryColor({ bgColor: '#fff' }), null);
    assert.equal(entryColor(null), null);
});

test('Tags: splitTags trennt an Komma und Semikolon, editTags fuegt hinzu/entfernt ohne Dubletten und sortiert', async () => {
    const { splitTags, editTags } = await import('../../src/core/util.js');
    assert.deepEqual(splitTags(' a, b;c ,, '), ['a', 'b', 'c']);
    assert.deepEqual(splitTags(''), []);
    assert.deepEqual(splitTags(null), []);
    assert.deepEqual(editTags(['b', 'a'], { add: ['c', 'a'] }), ['a', 'b', 'c']);
    assert.deepEqual(editTags(['b', 'a', 'c'], { remove: ['b', 'x'] }), ['a', 'c']);
    assert.deepEqual(editTags(undefined, { add: [' neu '] }), ['neu']);
    assert.deepEqual(editTags(['a', 'A'], { remove: ['a'] }), ['A'], 'Schreibweise zaehlt');
    assert.deepEqual(editTags(['b', 'a', 'a']), ['a', 'b'], 'ohne Aenderung nur geordnet und ohne Dubletten');
});

test('Wiederverwendung im Editor: gleiche Passwoerter wie im Bericht, ohne Referenzen, ohne ausgenommene Eintraege, ohne sich selbst', () => {
    const a = entry({ Title: 'A', Password: 'Sommer2020' }), b = entry({ Title: 'B', Password: 'Sommer2020' }), c = entry({ Title: 'C', Password: 'anders' });
    const ref = entry({ Title: 'Ref', Password: '{REF:P@I:ABCD}' });
    const left = entry({ Title: 'Aus', Password: 'Sommer2020' }, { qualityCheck: false });
    const all = [a, b, c, ref, left];
    assert.deepEqual(reusedBy(all, a, 'Sommer2020'), [b], 'der andere, nicht der ausgenommene und nicht man selbst');
    assert.deepEqual(reusedBy(all, null, 'Sommer2020'), [a, b], 'neuer Eintrag: alle mit diesem Passwort');
    assert.deepEqual(reusedBy(all, a, 'anders'), [c]);
    assert.deepEqual(reusedBy(all, a, 'gibt es nicht'), []);
    assert.deepEqual(reusedBy(all, a, ''), [], 'leeres Passwort zaehlt nicht');
    assert.deepEqual(reusedBy(all, a, '{REF:P@I:ABCD}'), [], 'eine Referenz ist keine Wiederverwendung');
    assert.deepEqual(reusedBy(all, left, 'Sommer2020'), [], 'ein ausgenommener Eintrag bekommt keinen Hinweis');
});

test('cachedBits keeps ratings and clearBitsCache drops the passwords (locking)', () => {
    clearBitsCache();
    assert.equal(cachedBits('correct horse battery staple'), estimateBits('correct horse battery staple'));
    cachedBits('x9!Qm2#vLp'); cachedBits('x9!Qm2#vLp');
    assert.equal(bitsCacheSize(), 2);
    clearBitsCache();
    assert.equal(bitsCacheSize(), 0);
});
