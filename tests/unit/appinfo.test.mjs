import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const info = fs.readFileSync(path.join(root, 'nextcloud-app/keepassnc/appinfo/info.xml'), 'utf8');
const ci = fs.readFileSync(path.join(root, '.github/workflows/nextcloud.yml'), 'utf8');

test('info.xml: Versionsspanne passt zu den im CI getesteten Nextcloud-Versionen (min = aelteste, max = neueste + 2)', () => {
    const tested = [...ci.matchAll(/package:\s*latest-(\d+)/g)].map((m) => Number(m[1]));
    assert.ok(tested.length > 0, 'keine getesteten Versionen in nextcloud.yml gefunden');
    const dep = info.match(/<nextcloud min-version="(\d+)" max-version="(\d+)"\s*\/>/);
    assert.ok(dep, 'nextcloud-Abhaengigkeit fehlt');
    assert.equal(Number(dep[1]), Math.min(...tested), 'min-version');
    assert.equal(Number(dep[2]), Math.max(...tested) + 2, 'max-version (neueste getestete + 2, siehe CONTRIBUTING.md)');
});

test('info.xml: Screenshots zeigen auf den Tag der eigenen Version (der App Store cached Bilder pro URL fuer immer)', () => {
    const version = info.match(/<version>([^<]+)<\/version>/)?.[1];
    assert.ok(version, 'version fehlt');
    const shots = [...info.matchAll(/<screenshot>([^<]+)<\/screenshot>/g)].map((m) => m[1]);
    assert.ok(shots.length > 0, 'keine Screenshots in info.xml');
    for (const url of shots) {
        const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/StudioCuda\/KeePassNC\/([^/]+)\/docs\/screenshots\/[^/]+\.png$/);
        assert.ok(m, `unerwartete Screenshot-URL: ${url}`);
        assert.equal(m[1], `v${version}`, `${url} muss auf den Tag v${version} zeigen, nicht auf ${m[1]}`);
        assert.ok(fs.existsSync(path.join(root, 'docs/screenshots', path.basename(url))), `${path.basename(url)} fehlt in docs/screenshots`);
    }
});
