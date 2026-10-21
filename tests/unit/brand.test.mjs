// The brand mark has one source (src/brand.js, drawn by tools/brand-geometry.mjs); the files derived from it (node tools/make-brand.mjs) must not deviate from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK, markSvg, tileSvg } from '../../src/brand.js';
import { mark, pathsModule } from '../../tools/brand-geometry.mjs';

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
    assert.equal(a.readUInt32BE(16), 180); assert.equal(a.readUInt32BE(20), 180); // IHDR: width, height
});

test('brand-paths.js is what tools/brand-geometry.mjs draws', () => {
    assert.equal(read('src/brand-paths.js'), pathsModule());
});

test('the mark draws the same in every use: one filled path, no inline colours', () => {
    for (const svg of [markSvg('#fff'), tileSvg()]) {
        assert.ok(svg.includes(`d="${MARK.bold}"`));
        assert.ok(svg.includes('fill-rule="evenodd"'));
        assert.ok(!/stroke|style=/.test(svg));
    }
});

test('the paths are sound: closed contours, finite numbers, only the commands we write', () => {
    for (const [name, d] of Object.entries(MARK)) {
        assert.ok(d.startsWith('M') && d.endsWith('z'), name);
        assert.match(d.replace(/[-\d. ]/g, ''), /^[Mlhvcaz]+$/, name); // otherwise only numbers: no NaN, no exponent
        assert.ok(d.length < 1000, `${name} should stay small (${d.length} bytes)`);
    }
    // Contours (one per M): fine = shield edge outer/inner + key ring outer/inner, bold = shield edge outer/inner + filled key
    assert.equal(MARK.fine.split('M').length - 1, 4);
    assert.equal(MARK.bold.split('M').length - 1, 3);
});

test('the corners are soft where they should be: the tips are arcs, not points', () => {
    // Apex and tip of the shield, outer tip of the key: one arc each with radius .6 (inner and outer), no sharp tip anywhere
    for (const d of Object.values(MARK)) assert.ok((d.match(/a\.6\.6 0 0 1/g) || []).length >= 6);
    assert.ok(mark({ w: 1.3, filledKey: false }) === MARK.fine && mark({ w: 2.1, filledKey: true }) === MARK.bold);
});

test('both pages link the icons', () => {
    assert.match(read('web/index.html'), /rel="icon" type="image\/svg\+xml" href="icon\.svg"/);
    assert.match(read('web/index.html'), /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
    const page = read('nextcloud-app/keepassnc/templates/page.html');
    assert.match(page, /rel="icon" type="image\/svg\+xml" href="__ICON__"/);
    assert.match(page, /rel="apple-touch-icon" href="__TOUCH__"/);
});
