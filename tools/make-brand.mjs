#!/usr/bin/env node
// Generates the brand files (tools/brand-geometry.mjs traces the paths into src/brand-paths.js, which feeds src/brand.js): img/app.svg (Nextcloud app icon, white), the favicon (SVG) and the touch icon (PNG).
//   node tools/make-brand.mjs         write the SVG files
//   node tools/make-brand.mjs --png   also render the touch icon (180 px); needs Chromium (CHROMIUM=/path/to/chrome)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsModule } from './brand-geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = path.join(root, 'nextcloud-app/keepassnc/img');
const web = path.join(root, 'web');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

write(path.join(root, 'src/brand-paths.js'), pathsModule());
const { markSvg, tileSvg } = await import('../src/brand.js'); // load only now: the paths are fresh

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
