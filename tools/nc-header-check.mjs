#!/usr/bin/env node
// Watches the Nextcloud sources our header and frame copy (src/ui/ncheader.js, the .nch block and the "Nextcloud-Rahmen" block in src/keepassnc.css).
// tools/nc-header.json pins the release we matched and a SHA-256 per file. The check fails when one of those files changed on the
// stable branch, when the @nextcloud/vue version moved, or when a newer stableNN branch exists. Then compare and adapt the header,
// and pin the new state with --update.
//   node tools/nc-header-check.mjs            compare tools/nc-header.json with its stable branch
//   node tools/nc-header-check.mjs --update   pin the current state of the branch (after adapting the header)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const PIN = new URL('nc-header.json', import.meta.url);
const RAW = 'https://raw.githubusercontent.com/nextcloud/server/';
const pin = JSON.parse(readFileSync(PIN, 'utf8'));

async function get(ref, path) {
    const r = await fetch(RAW + ref + '/' + path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${ref}/${path}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}
const sha = (b) => (b ? createHash('sha256').update(b).digest('hex') : 'missing');
const vueVersion = (pkg) => JSON.parse(pkg.toString()).dependencies?.['@nextcloud/vue'] || 'missing';

const files = {};
for (const path of Object.keys(pin.files)) files[path] = sha(await get(pin.branch, path));
const vue = vueVersion(await get(pin.branch, 'package.json'));

if (process.argv.includes('--update')) {
    writeFileSync(PIN, JSON.stringify({ ...pin, files, vue }, null, 2) + '\n');
    console.log(`Pinned ${pin.branch}: ${Object.keys(files).length} files, @nextcloud/vue ${vue}. Set "matched" to the release you compared with.`);
    process.exit(0);
}

const problems = [];
for (const [path, want] of Object.entries(pin.files)) if (files[path] !== want) problems.push(`${path} changed on ${pin.branch}`);
if (vue !== pin.vue) problems.push(`@nextcloud/vue moved from ${pin.vue} to ${vue} (NcHeaderMenu, NcListItem, NcAvatar, NcPopover, NcButton)`);
const next = 'stable' + (Number(pin.branch.replace('stable', '')) + 1);
if (await get(next, 'package.json')) problems.push(`${next} exists: a new Nextcloud is on its way, compare its header`);

if (problems.length) {
    console.error(`The Nextcloud header moved on since ${pin.matched}:\n- ${problems.join('\n- ')}`);
    process.exit(1);
}
console.log(`Header sources on ${pin.branch} unchanged since ${pin.matched}.`);
