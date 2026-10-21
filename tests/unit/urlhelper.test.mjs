import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const helper = path.join(root, 'nextcloud-app/keepassnc/lib/Util/UrlHelper.php');

const hasPhp = (() => {
    try { execFileSync('php', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

// PHP string literal in single quotes: only \ and ' need escaping.
const phpStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function callHelper(method, ...args) {
    const script = `require ${phpStr(helper)}; echo json_encode(\\OCA\\Keepassnc\\Util\\UrlHelper::${method}(${args.map(phpStr).join(', ')}));`;
    return JSON.parse(execFileSync('php', ['-r', script], { encoding: 'utf8' }));
}

const skip = hasPhp ? false : 'php missing';

test('a doubled webroot is removed from the path', { skip }, () => {
    assert.equal(callHelper('withoutDuplicateWebroot', '/nc/nc/apps/keepassnc/js/app.js', '/nc'), '/nc/apps/keepassnc/js/app.js');
    assert.equal(callHelper('withoutDuplicateWebroot', 'https://host/nc/nc/apps/x.js', '/nc'), 'https://host/nc/apps/x.js');
});

test('a single webroot, foreign paths and empty input stay unchanged', { skip }, () => {
    assert.equal(callHelper('withoutDuplicateWebroot', '/nc/apps/keepassnc/js/app.js', '/nc'), '/nc/apps/keepassnc/js/app.js');
    assert.equal(callHelper('withoutDuplicateWebroot', '/nc/nc/nc/apps/x.js', '/nc'), '/nc/nc/apps/x.js');
    assert.equal(callHelper('withoutDuplicateWebroot', '/apps/x.js', '/nc'), '/apps/x.js');
    assert.equal(callHelper('withoutDuplicateWebroot', '', '/nc'), '');
    assert.equal(callHelper('withoutDuplicateWebroot', '/nc/nc/apps/x.js', ''), '/nc/nc/apps/x.js');
});
