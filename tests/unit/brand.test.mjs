// Die Marke hat eine Quelle (src/brand.js); die Dateien daraus (node tools/make-brand.mjs) duerfen nicht davon abweichen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK, STROKE, markSvg, tileSvg } from '../../src/brand.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const img = 'nextcloud-app/keepassnc/img/';

test('app.svg is the mark in white, generated from src/brand.js', () => {
    assert.equal(read(img + 'app.svg'), markSvg('#fff'));
});

test('favicon and web icon are the same tile, generated from src/brand.js', () => {
    assert.equal(read('web/icon.svg'), tileSvg());
    assert.equal(read(img + 'favicon.svg'), tileSvg());
});

test('touch icon is a 180 px PNG and identical in web/ and the Nextcloud app', () => {
    const a = fs.readFileSync(path.join(root, 'web/apple-touch-icon.png')), b = fs.readFileSync(path.join(root, img + 'apple-touch-icon.png'));
    assert.deepEqual(a, b);
    assert.equal(a.readUInt32BE(16), 180); assert.equal(a.readUInt32BE(20), 180); // IHDR: Breite, Hoehe
});

test('the mark draws the same in every use: no inline colours, one stroke weight', () => {
    for (const svg of [markSvg('#fff'), tileSvg()]) {
        assert.ok(svg.includes(MARK.line) && svg.includes(MARK.inner) && svg.includes(MARK.key));
        assert.ok(svg.includes(`stroke-width="${STROKE}"`));
    }
});

test('both pages link the icons', () => {
    assert.match(read('web/index.html'), /rel="icon" type="image\/svg\+xml" href="icon\.svg"/);
    assert.match(read('web/index.html'), /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
    const page = read('nextcloud-app/keepassnc/templates/page.html');
    assert.match(page, /rel="icon" type="image\/svg\+xml" href="__ICON__"/);
    assert.match(page, /rel="apple-touch-icon" href="__TOUCH__"/);
});
