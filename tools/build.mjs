// Baut web/keepassnc.js: kdbxweb (vendored, TypeScript) + hash-wasm (Argon2) + App-Code zu einer einzigen Datei.
// Keine externen Skripte zur Laufzeit; alles wird vom eigenen Server ausgeliefert.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// kdbxweb referenziert Node-Module nur in Zweigen, die im Browser nie laufen (WebCrypto ist immer vorhanden).
const stubNodeModules = {
    name: 'stub-node-modules',
    setup(b) {
        b.onResolve({ filter: /^(crypto|@xmldom\/xmldom)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
    }
};

await build({
    entryPoints: [path.join(root, 'src/main.js')],
    outfile: path.join(root, 'web/keepassnc.js'),
    bundle: true,
    minify: true,
    sourcemap: false,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    define: { global: 'globalThis', __VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version) },
    plugins: [stubNodeModules],
    legalComments: 'none',
    logLevel: 'info'
});

// Service Worker und Stylesheet unveraendert nach web/ (Nextcloud-App: siehe build-nextcloud.mjs)
fs.copyFileSync(path.join(root, 'src/sw.js'), path.join(root, 'web/sw.js'));
fs.copyFileSync(path.join(root, 'src/keepassnc.css'), path.join(root, 'web/keepassnc.css'));
