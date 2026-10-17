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
