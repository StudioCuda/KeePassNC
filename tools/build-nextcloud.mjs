// Baut die Nextcloud-App: nextcloud-app/keepassnc/{js,css} aus den Web-Dateien plus der Dateien-Aktion.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'nextcloud-app/keepassnc');
fs.mkdirSync(path.join(app, 'js'), { recursive: true });
fs.mkdirSync(path.join(app, 'css'), { recursive: true });

// Hauptanwendung: identisch zur eigenstaendigen Seite (web/), laeuft im Nextcloud-Modus per data-Attribut.
fs.copyFileSync(path.join(root, 'web/keepassnc.js'), path.join(app, 'js/keepassnc.js'));
fs.copyFileSync(path.join(root, 'web/sw.js'), path.join(app, 'js/sw.js'));
fs.copyFileSync(path.join(root, 'web/keepassnc.css'), path.join(app, 'css/keepassnc.css'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(app, 'COPYING')); // der App Store erwartet die Lizenz im App-Ordner

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
