import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The shipped .htaccess files and docs/HOSTING.md describe the same headers; this keeps them from drifting apart.
const root = path.resolve(import.meta.dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const headers = (s) => new Map([...s.matchAll(/^Header always set (\S+) "([^"]*)"$/gm)].map((m) => [m[1], m[2]]));
const hosting = read('docs/HOSTING.md');
const docBlock = (label) => {
    const m = hosting.match(new RegExp('```apache\\n# ' + label.replace(/[/()]/g, '\\$&') + '[^\\n]*\\n([\\s\\S]*?)```'));
    assert.ok(m, `HOSTING.md has no block for ${label}`);
    return headers(m[1]);
};

for (const [folder, label] of [['web', 'web/'], ['web-generator', 'web-generator/']]) {
    test(`${folder}/.htaccess sends the headers HOSTING.md documents`, () => {
        const shipped = headers(read(`${folder}/.htaccess`));
        assert.deepEqual(shipped, docBlock(label));
    });
    test(`${folder}/.htaccess: HTTPS for good (HSTS without includeSubDomains), no sniffing, no referrer, no framing`, () => {
        const h = headers(read(`${folder}/.htaccess`));
        const hsts = h.get('Strict-Transport-Security') || '';
        assert.match(hsts, /^max-age=(\d+)$/);
        assert.ok(Number(hsts.split('=')[1]) >= 31536000, 'at least a year');
        assert.equal(h.get('X-Content-Type-Options'), 'nosniff');
        assert.equal(h.get('Referrer-Policy'), 'no-referrer');
        assert.match(h.get('Content-Security-Policy') || '', /frame-ancestors 'none'/);
    });
}
