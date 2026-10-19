#!/usr/bin/env node
// Erzeugt aus src/brand.js die Dateien der Marke: img/app.svg (Nextcloud-App-Symbol, weiss), das Favicon (SVG) und das Touch-Icon (PNG).
//   node tools/make-brand.mjs         SVG-Dateien schreiben
//   node tools/make-brand.mjs --png   zusaetzlich das Touch-Icon (180 px) rendern; braucht Chromium (CHROMIUM=/pfad/zu/chrome)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markSvg, tileSvg } from '../src/brand.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = path.join(root, 'nextcloud-app/keepassnc/img');
const web = path.join(root, 'web');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

write(path.join(img, 'app.svg'), markSvg('#fff'));
write(path.join(web, 'icon.svg'), tileSvg());
write(path.join(img, 'favicon.svg'), tileSvg());

if (process.argv.includes('--png')) {
    const { launchBrowser } = await import('../tests/browser.mjs');
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0">${tileSvg({ rounded: false }).replace('width="32" height="32"', 'width="180" height="180"')}</body>`);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 180, height: 180 } });
    await browser.close();
    write(path.join(web, 'apple-touch-icon.png'), png);
    write(path.join(img, 'apple-touch-icon.png'), png);
}
