// Search syntax (src/core/search.js): regular expressions keep their backslashes, a broken one matches nothing, custom field names
// with digits, underscores or spaces, and wildcards that mean what they always meant but stay fast on a huge field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches, invalidRegex } from '../../src/core/search.js';

function entry(fields, extra = {}) {
    const g = { name: extra.group || 'Web', parentGroup: { name: 'Root', parentGroup: null } };
    return { fields: new Map(Object.entries(fields)), tags: extra.tags || [], binaries: new Map(), history: [], parentGroup: g, uuid: { id: 'abc', toString: () => 'abc' }, times: {} };
}
const m = (q, e) => matches(e, parseQuery(q));
const mail = entry({ Title: 'Mail', UserName: 'alice', URL: 'https://example.org', Notes: 'Privat', Password: 'x' }, { tags: ['privat', 'mail'] });
const empty = entry({ Title: '', UserName: '', URL: '', Notes: '', Password: '' });

test('regular expressions keep their backslashes', () => {
    assert.equal(parseQuery('*title:\\d+')[0].re.source, '\\d+');
    const konto = entry({ Title: 'Konto 42', URL: 'https://bank.example.org' }), dd = entry({ Title: 'dd' });
    assert.ok(m('*title:\\d+', konto)); assert.ok(!m('*title:\\d+', dd), '\\d is a digit, not a d');
    assert.ok(m('*title:"^konto \\d+$"', konto), 'quotes are still stripped, the backslash stays');
    assert.ok(m('*url:\\.org$', konto)); assert.ok(!m('*url:\\.org$', entry({ URL: 'https://bank.exampleXorg' })));
    assert.ok(m('*title:^Konto\\s\\d\\d$', konto)); assert.ok(!m('*+title:^konto\\s\\d+$', konto), '+ keeps a regular expression case-sensitive');
    assert.ok(m('*"a\\"b"', entry({ Title: 'a"b' })), 'an escaped quote inside a quoted expression');
    assert.ok(m('*title:a\\ b', entry({ Title: 'a b' })), 'an escaped space');
    // plain terms still drop the backslash of an escape
    assert.equal(parseQuery('title:a\\ b')[0].value, 'a b'); assert.equal(parseQuery('"a\\"b"')[0].value, 'a"b'); assert.equal(parseQuery('a\\\\b')[0].value, 'a\\b');
    assert.equal(parseQuery('\\"ab"cd"')[0].value, '"abcd', 'an escaped quote in front of a quoted part');
    assert.ok(m('+title:a\\"b', entry({ Title: 'a"b' })));
});

test('a broken regular expression matches nothing, not every empty field', () => {
    for (const q of ['*title:(', '*(', '*url:[', '*_PIN:+', '*+notes:)']) {
        assert.ok(!m(q, empty), q); assert.ok(!m(q, mail), q);
        assert.ok(m('-' + q, empty), '-' + q + ' excludes nothing');
    }
    assert.ok(!m('mail *title:(', mail), 'AND with a broken expression');
    assert.equal(invalidRegex('mail *title:( x'), '('); assert.equal(invalidRegex('*title:\\d+'), null); assert.equal(invalidRegex('title:( x)'), null);
    assert.equal(invalidRegex('*"a[b"'), 'a[b'); assert.equal(invalidRegex(''), null);
});

test('custom fields with digits, underscores, spaces or colons in the name', () => {
    const kp2a = entry({ Title: 'Shop', KP2A_URL_1: 'https://second.example', PIN2: '1234', _hidden: 'secret', 'Security Question': 'Blue whale', 'KPH: Extra URL': 'https://alt.example', 'Größe': '42' });
    assert.ok(m('_KP2A_URL_1:second', kp2a)); assert.ok(!m('_KP2A_URL_1:other', kp2a)); assert.ok(m('_kp2a_url_1:SECOND', kp2a), 'the name ignores case');
    assert.ok(m('_PIN2:1234', kp2a)); assert.ok(!m('_PIN:1234', kp2a), 'the whole name, not a prefix');
    assert.ok(m('__hidden:secret', kp2a), 'a name that starts with an underscore');
    assert.ok(m('_"Security Question":blue', kp2a)); assert.ok(m('_Security\\ Question:"blue whale"', kp2a));
    assert.ok(m('_"KPH: Extra URL":alt', kp2a)); assert.ok(m('_Größe:42', kp2a));
    assert.ok(!m('-_PIN2:1234', kp2a)); assert.ok(m('*_PIN2:^\\d{4}$', kp2a)); assert.ok(m('+_PIN2:1234', kp2a)); assert.ok(m('_PIN2:1*4', kp2a));
    assert.deepEqual(parseQuery('_KP2A_URL_1:a:b').map((x) => [x.field, x.custom, x.value]), [['custom', 'KP2A_URL_1', 'a:b']]);
    // standard prefixes are unchanged, anything else stays a plain word
    assert.deepEqual(['t:x', 'user:x', 'pass:x', 'attr:x', 'att:x', 'u:x', 'title2:x', 'http://x', '_:x', 'foo:x'].map((q) => parseQuery(q)[0].field),
        ['title', 'username', 'password', 'attribute', 'attachment', 'username', null, null, null, null]);
    assert.ok(m('https://example', mail), 'a URL is a plain word');
});

test('existing syntax keeps working: AND, quotes, negation, field prefixes, exact, alternatives', () => {
    assert.ok(m('mail', mail)); assert.ok(m('ALICE example', mail)); assert.ok(!m('mail bob', mail)); assert.ok(m('', mail));
    assert.ok(m('t:mail', mail)); assert.ok(!m('title:alice', mail)); assert.ok(m('-title:bob', mail)); assert.ok(!m('!title:mail', mail)); assert.ok(m('tag:privat', mail));
    assert.ok(m('+title:Mail', mail)); assert.ok(!m('+title:mail', mail)); assert.ok(!m('+title:Ma*', mail), '+ turns wildcards off'); assert.ok(m('+title:Ma*', entry({ Title: 'Ma*' })));
    assert.ok(m('title:xx|mail', mail)); assert.ok(!m('title:xx|yy', mail)); assert.ok(m('"mein konto"', entry({ Title: 'Mein Konto' }))); assert.ok(!m('"mein  konto"', entry({ Title: 'Mein Konto' })));
    const shop = { ...entry({ Title: 'Shop' }), parentGroup: { name: 'Shop', parentGroup: { name: 'Web', parentGroup: { name: 'Root', parentGroup: null } } } };
    assert.ok(m('group:web/shop', shop)); assert.ok(m('group:/web/s*', shop)); assert.ok(!m('group:shop/web', shop)); assert.ok(m('group:w?b', mail)); assert.ok(!m('group:w?b', shop));
});

test('wildcards: case-insensitive, anywhere in the field, * and ? stop at line breaks, other characters are literal', () => {
    assert.ok(m('title:ma*', mail)); assert.ok(m('title:MA*', mail)); assert.ok(m('title:m?il', mail)); assert.ok(!m('title:m?l', mail)); assert.ok(m('title:a?l', mail), 'not anchored');
    assert.ok(!m('title:mail?', mail), '? needs a character'); assert.ok(m('title:mail*', mail), '* may be empty');
    assert.ok(m('title:*', empty)); assert.ok(m('title:zz|', mail), 'an empty alternative matches, as before'); assert.ok(!m('title:?', empty));
    const lines = entry({ Notes: 'foo\nbar\r\nbaz qux' });
    assert.ok(!m('notes:foo*bar', lines)); assert.ok(!m('notes:foo?bar', lines)); assert.ok(m('notes:ba*', lines)); assert.ok(m('notes:b?z', lines)); assert.ok(!m('notes:baz?qux', lines));
    assert.ok(!m('title:a.c*', entry({ Title: 'abc' }))); assert.ok(m('title:a.c*', entry({ Title: 'a.cd' }))); assert.ok(m('title:(x*', entry({ Title: '(xy' })));
    assert.ok(m('title:$^*', entry({ Title: 'x$^' }))); assert.ok(m('title:\\\\*', entry({ Title: 'a\\b' })), 'a literal backslash');
    assert.ok(m('title:straße*', entry({ Title: 'STRASSE straße' }))); assert.ok(!m('title:strasse*', entry({ Title: 'Straße' })));
    assert.ok(m('title:k*', entry({ Title: 'K' }))); assert.ok(!m('title:k*', entry({ Title: 'K' })), 'the Kelvin sign is no k, as with /i');
    assert.ok(m('title:??', entry({ Title: '🔐' })), 'like ".", ? is one UTF-16 unit');
});

// The wildcard RegExp search.js used before: the reference for what the patterns mean.
function oldWildcardRegex(v) {
    const parts = v.split('|').map((p) => p.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));
    return new RegExp(parts.join('|'), 'i');
}
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }; }

test('wildcards: same answer as the old RegExp for thousands of random patterns and texts', () => {
    const rnd = rng(20261112);
    const pick = (chars, max) => { let s = ''; const n = Math.floor(rnd() * (max + 1)); for (let i = 0; i < n; i++) s += chars[Math.floor(rnd() * chars.length)]; return s; };
    const PAT = ['a', 'A', 'b', '*', '*', '?', '?', '|', '.', '\\', '(', 'ß', 'k', 'K', 'ſ', 's', 'İ', 'i', '\n'], TXT = ['a', 'A', 'b', 'B', '.', '\\', '(', 'ß', 'k', 'K', 'ſ', 'S', 's', 'İ', 'i', 'ı', '\n', '\r', ' ', '\uD83D', '\uDD10', ' '];
    let n = 0;
    for (let i = 0; i < 30000; i++) {
        const p = pick(PAT, 7), text = pick(TXT, 12);
        if (!/[*?|]/.test(p)) continue;
        n++;
        const q = 'title:"' + p.replace(/[\\"]/g, '\\$&') + '"';
        assert.equal(parseQuery(q)[0].value, p);
        assert.equal(m(q, entry({ Title: text })), oldWildcardRegex(p).test(text), JSON.stringify({ p, text }));
    }
    assert.ok(n > 10000, String(n));
});

test('wildcards stay fast on a huge field (no backtracking)', () => {
    const big = 'a'.repeat(100000), e = entry({ Title: 'big', Notes: big }), hit = entry({ Title: 'big', Notes: big + 'b' });
    for (const q of ['notes:a*a*b', 'notes:a*b', 'a*a*a*a*b', 'notes:*a*?*a*b|a?a?a?b', 'notes:a*a*a*a*a*a*a*a*b']) {
        const t0 = performance.now();
        assert.ok(!m(q, e), q); assert.ok(m(q, hit), q);
        const ms = performance.now() - t0;
        assert.ok(ms < 200, `${q}: ${ms.toFixed(0)} ms`);
    }
});
