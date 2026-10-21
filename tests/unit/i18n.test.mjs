import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import de from '../../src/i18n-de.js';
import en from '../../src/i18n-en.js';
import zhCN from '../../src/i18n-zh-CN.js';
import { detectLang } from '../../src/i18n.js';

const DICTS = { de, en, 'zh-CN': zhCN };

const root = path.resolve(import.meta.dirname, '../../src');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name) && !/i18n-/.test(f.name)) files.push(p); } })(root);

test('alle Woerterbuecher haben dieselben Schluessel', () => {
    for (const [name, d] of Object.entries(DICTS)) assert.deepEqual(Object.keys(d).sort(), Object.keys(de).sort(), name);
});
test('Platzhalter stimmen ueberein', () => {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    for (const [name, d] of Object.entries(DICTS)) {
        for (const k of Object.keys(de)) assert.equal(ph(d[k]), ph(de[k]), `${name}: ${k}`);
    }
});
test('alle im Code benutzten Schluessel existieren', () => {
    const keys = new Set(Object.keys(de));
    const missing = [];
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'(?!\s*\+)/g)) if (!keys.has(m[1]) && !/^(keepassnc|schluessel)$/.test(m[1])) missing.push(`${path.basename(f)}: ${m[1]}`);
        for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+\.)' \+/g)) if (![...keys].some((k) => k.startsWith(m[1]))) missing.push(`${path.basename(f)}: ${m[1]}*`);
    }
    assert.deepEqual(missing, []);
});
test('Sprache: Nextcloud sagt "zh", der Browser "zh-CN" - beides ist Chinesisch', () => {
    assert.equal(detectLang('auto', 'zh', ''), 'zh-CN');
    assert.equal(detectLang('auto', 'zh_CN', ''), 'zh-CN');
    assert.equal(detectLang('auto', '', 'zh-CN'), 'zh-CN');
    assert.equal(detectLang('zh-CN', '', ''), 'zh-CN');
    assert.equal(detectLang('auto', 'de', ''), 'de');
    assert.equal(detectLang('auto', 'en-US', ''), 'en');
    assert.equal(detectLang('auto', '', ''), 'de');
});
test('keine toten Schluessel (ungenutzt)', () => {
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(de).filter((k) => !all.includes(`'${k}'`) && !all.includes(`'${k.replace(/[^.]*$/, '')}' +`));
    assert.deepEqual(unused, []);
});
