// Builds the generator page web-generator/: the password generator alone (without kdbxweb, Argon2, WebDAV). Stylesheet, brand and icons come
// unchanged from src/ and web/, so the page looks just like the app.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web-generator');

await build({
    entryPoints: [path.join(root, 'src/pass-main.js')],
    outfile: path.join(out, 'keepassnc-pass.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'info'
});
fs.copyFileSync(path.join(root, 'src/keepassnc.css'), path.join(out, 'keepassnc.css'));
fs.copyFileSync(path.join(root, 'src/pass.css'), path.join(out, 'pass.css'));
for (const f of ['icon.svg', 'apple-touch-icon.png']) fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
