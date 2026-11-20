import test from 'node:test';
import assert from 'node:assert/strict';
import { everyGroupBits, generatePassword } from '../../src/core/generator.js';

// "Every group" draws one character per group, fills up from the whole pool and shuffles. For small alphabets every possible draw can
// be counted: that gives the exact distribution of the passwords and its Shannon entropy, which everyGroupBits has to match.
function exactBits(groups, len) {
    const pool = [...new Set(groups.flat())];
    const rest = len - groups.length;
    const counts = new Map();
    let total = 0;
    const perms = (n) => (n === 0 ? [[]] : perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])));
    const orders = perms(len);
    const picks = (lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((c) => [...a, c])), [[]]);
    for (const firsts of picks(groups)) {
        for (const tail of picks(Array.from({ length: rest }, () => pool))) {
            const drawn = [...firsts, ...tail];
            for (const order of orders) {
                const pw = order.map((i) => drawn[i]).join('');
                counts.set(pw, (counts.get(pw) || 0) + 1);
                total++;
            }
        }
    }
    let h = 0;
    for (const n of counts.values()) h -= (n / total) * Math.log2(n / total);
    return { h, outcomes: counts.size };
}

for (const [groups, len] of [[[['a', 'b'], ['C']], 3], [[['a', 'b'], ['C']], 5], [[['a'], ['B'], ['3']], 4], [[['a', 'b', 'c'], ['D', 'E'], ['5']], 4], [[['a', 'b', 'c', 'd']], 4]]) {
    test(`every-group bits are the exact entropy: groups ${groups.map((g) => g.join('')).join('/')}, length ${len}`, () => {
        const { h, outcomes } = exactBits(groups, len);
        const bits = everyGroupBits(groups.map((g) => g.length), new Set(groups.flat()).size, len);
        assert.ok(Math.abs(bits - h) < 1e-9, `formula ${bits}, counted ${h}`);
        assert.ok(bits <= Math.log2(outcomes) + 1e-9, 'never more than log2 of the number of possible passwords');
    });
}

test('overlapping groups: the reported bits stay below the exact entropy', () => {
    for (const [groups, len] of [[[['a', 'b', 'c'], ['b', 'c']], 3], [[['a', 'b', 'c'], ['c']], 4]]) {
        const { h } = exactBits(groups, len);
        assert.ok(everyGroupBits(groups.map((g) => g.length), new Set(groups.flat()).size, len) <= h + 1e-9);
    }
});

test('generatePassword reports these bits; without "every group" it is length x log2(pool); long passwords stay finite', () => {
    const plain = generatePassword({ length: 24, everyGroup: false });
    assert.ok(Math.abs(plain.bits - 24 * Math.log2(69)) < 1e-9); // default classes without look-alikes: 25 + 22 + 6 + 16
    const every = generatePassword({ length: 24 });
    assert.ok(Math.abs(every.bits - everyGroupBits([25, 22, 6, 16], 69, 24)) < 1e-9);
    assert.ok(every.bits < plain.bits && every.bits > plain.bits - 2, `${every.bits} vs ${plain.bits}`);
    const short = generatePassword({ length: 4 });
    assert.ok(short.bits < 4 * Math.log2(69) - 3, 'four characters from four groups are far from uniform: ' + short.bits);
    const long = generatePassword({ length: 128, extended: true, special2: true });
    assert.ok(Number.isFinite(long.bits) && long.bits > 800, String(long.bits));
});
