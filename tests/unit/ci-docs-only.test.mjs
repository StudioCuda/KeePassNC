import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// tools/ci-docs-only.sh decides whether a pull request may skip the long test steps. Each case builds a tiny repository.
const script = path.resolve(import.meta.dirname, '../../tools/ci-docs-only.sh');

function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-docs-lane-'));
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
    git('init', '-q');
    for (const f of ['README.md', 'docs/FEATURES.md', 'docs/screenshots/a.png', 'src/main.js']) write(f, 'x\n');
    git('add', '-A'); git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    const commit = () => { git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', 'change'); return git('rev-parse', 'HEAD'); };
    const answer = (head = commit()) => execFileSync('bash', [script, base, head], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { dir, git, write, answer, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('docs lane: text changes skip the tests, code does not', () => {
    const r = repo();
    try {
        r.write('README.md', 'y\n'); r.write('docs/FEATURES.md', 'y\n');
        assert.equal(r.answer(), 'docs_only=true');
        r.write('src/main.js', 'y\n');
        assert.equal(r.answer(), 'docs_only=false');
    } finally { r.done(); }
});

test('docs lane: a changed screenshot is text-only, a deleted or renamed one is not (info.xml may point at it)', () => {
    const r = repo();
    try {
        r.write('docs/screenshots/a.png', 'y\n');
        assert.equal(r.answer(), 'docs_only=true');
        r.git('mv', 'docs/screenshots/a.png', 'docs/screenshots/b.png');
        assert.equal(r.answer(), 'docs_only=false');
    } finally { r.done(); }
    const s = repo();
    try {
        fs.rmSync(path.join(s.dir, 'docs/screenshots/a.png'));
        assert.equal(s.answer(), 'docs_only=false');
    } finally { s.done(); }
});

test('docs lane: deleting other docs stays text-only; without SHAs everything gets tested', () => {
    const r = repo();
    try {
        fs.rmSync(path.join(r.dir, 'docs/FEATURES.md'));
        assert.equal(r.answer(), 'docs_only=true');
        assert.equal(execFileSync('bash', [script, '', ''], { cwd: r.dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 'docs_only=false');
    } finally { r.done(); }
});
