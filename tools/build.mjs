// Builds web/keepassnc.js (+ web/keepassnc-argon2.js, the Argon2 worker): kdbxweb (vendored, TypeScript) + hash-wasm (Argon2) + app code into a single file.
// No external scripts at runtime; everything is served from the own server.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// kdbxweb references Node modules only in branches that never run in the browser (WebCrypto is always available).
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

// Web worker for Argon2 (src/argon2.js): own file next to keepassnc.js, so the strict CSP doesn't need a blob: worker
await build({
    entryPoints: [path.join(root, 'src/argon2-worker.js')],
    outfile: path.join(root, 'web/keepassnc-argon2.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'info'
});

// Web worker for QR codes (src/qr.js): own file, so jsQR is only loaded when someone reads an image
await build({
    entryPoints: [path.join(root, 'src/qr-worker.js')],
    outfile: path.join(root, 'web/keepassnc-qr.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'info'
});

// Service worker and stylesheet unchanged to web/ (Nextcloud app: see build-nextcloud.mjs)
fs.copyFileSync(path.join(root, 'src/sw.js'), path.join(root, 'web/sw.js'));
fs.copyFileSync(path.join(root, 'src/keepassnc.css'), path.join(root, 'web/keepassnc.css'));
