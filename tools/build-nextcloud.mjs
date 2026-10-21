// Builds the Nextcloud app: nextcloud-app/keepassnc/{js,css} from the web files plus the Files action.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'nextcloud-app/keepassnc');
fs.mkdirSync(path.join(app, 'js'), { recursive: true });
fs.mkdirSync(path.join(app, 'css'), { recursive: true });

// Main application: identical to the standalone page (web/), runs in Nextcloud mode via a data attribute.
fs.copyFileSync(path.join(root, 'web/keepassnc.js'), path.join(app, 'js/keepassnc.js'));
fs.copyFileSync(path.join(root, 'web/keepassnc-argon2.js'), path.join(app, 'js/keepassnc-argon2.js'));
fs.copyFileSync(path.join(root, 'web/keepassnc-qr.js'), path.join(app, 'js/keepassnc-qr.js'));
fs.copyFileSync(path.join(root, 'web/sw.js'), path.join(app, 'js/sw.js'));
fs.copyFileSync(path.join(root, 'web/keepassnc.css'), path.join(app, 'css/keepassnc.css'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(app, 'COPYING')); // the App Store expects the license in the app folder

await build({
    entryPoints: [path.join(root, 'src/files-action.js')],
    outfile: path.join(app, 'js/files-action.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'info'
});
