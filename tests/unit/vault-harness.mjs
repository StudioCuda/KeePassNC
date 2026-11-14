// Loads src/vault.js in Node for the unit tests. kdbxweb is TypeScript, so esbuild bundles vault.js (with kdbxweb and the
// WebDAV error classes) once into a temporary module; @xmldom/xmldom stands in for the browser's DOMParser and XMLSerializer.
// MemoryDav is a WebDAV server in memory with ETags and the DavFile interface, plus hooks to step in between requests:
// another device saving, a response that never arrives, a download that is still running while the page changes something.
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const xmldom = createRequire(path.join(root, 'package.json'))('@xmldom/xmldom');
globalThis.DOMParser ??= xmldom.DOMParser;
globalThis.XMLSerializer ??= xmldom.XMLSerializer;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpnc-vault-'));
const outfile = path.join(dir, 'vault.mjs');
try {
    await build({
        stdin: {
            contents: "export * from './src/vault.js'; export { ConflictError, DavError, NetworkError } from './src/webdav.js'; export * as kdbxweb from './vendor/kdbxweb/lib/index';",
            resolveDir: root, loader: 'js'
        },
        outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'
    });
} catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
}
const mod = await import(pathToFileURL(outfile).href);
fs.rmSync(dir, { recursive: true, force: true });

export const { Vault, VaultError, ConflictError, DavError, NetworkError, kdbxweb } = mod;
export const { ProtectedValue } = kdbxweb;

/** Fast settings for test databases: AES-KDF with few rounds (Argon2 would take seconds per open). */
export const FAST = { cipher: 'aes', kdf: 'aes', rounds: 1000 };
export const PW = 'pw';

const text = (v) => (v == null ? '' : typeof v === 'string' ? v : v.getText());
export const title = (e) => text(e.fields.get('Title'));
export const field = (e, name) => text(e.fields.get(name));
/** Titles of all entries outside the recycle bin, sorted. */
export const titles = (vault) => [...vault.root.allEntries()].filter((e) => !vault.isInRecycleBin(e)).map(title).sort();
export const entryByTitle = (vault, t) => [...vault.root.allEntries()].find((e) => title(e) === t);
export const groupByName = (vault, n) => [...vault.root.allGroups()].find((g) => g.name === n);

/**
 * WebDAV in memory. file(path) returns an object with the DavFile interface that Vault uses. ETags change with every write
 * ("1", "2", ...); with noEtag the server never reports one (like some WebDAV servers behind a proxy).
 * hooks: async functions called with {path, method, buf} - beforeGet/afterGet/beforePut/afterPut; throwing in one makes the request fail.
 */
export class MemoryDav {
    constructor({ noEtag = false } = {}) {
        this.files = new Map();
        this.n = 0;
        this.noEtag = noEtag;
        this.hooks = {};
        this.log = [];
    }

    _tag(p) { return this.noEtag ? null : this.files.get(p)?.etag ?? null; }

    _store(p, buf) { this.files.set(p, { buf: buf.slice(0), etag: `"${++this.n}"` }); }

    /** Bytes of a file as a fresh ArrayBuffer (undefined if it doesn't exist). */
    bytes(p) { return this.files.get(p)?.buf.slice(0); }

    /** Another device writes the file (bypasses hooks and If-Match). */
    write(p, buf) { this._store(p, buf); }

    file(p) {
        const srv = this;
        const hook = async (name, extra = {}) => { if (srv.hooks[name]) await srv.hooks[name]({ path: p, ...extra }); };
        return {
            url: `https://dav.test${p}`,
            async get() {
                srv.log.push(`GET ${p}`);
                await hook('beforeGet', { method: 'GET' });
                const f = srv.files.get(p);
                if (!f) throw new DavError(404, 'not found', 'e.dav.notfound');
                const out = { buf: f.buf.slice(0), etag: srv._tag(p) };
                await hook('afterGet', { method: 'GET', buf: out.buf });
                return out;
            },
            async head() {
                srv.log.push(`HEAD ${p}`);
                if (!srv.files.has(p)) throw new DavError(404, 'not found', 'e.dav.head', { status: 404 });
                return srv._tag(p);
            },
            async put(buf, ifMatch) {
                srv.log.push(`PUT ${p}`);
                await hook('beforePut', { method: 'PUT', buf });
                const f = srv.files.get(p);
                if (ifMatch && (!f || f.etag !== ifMatch)) throw new ConflictError();
                srv._store(p, buf);
                const etag = srv._tag(p);
                await hook('afterPut', { method: 'PUT', buf });
                return etag;
            },
            async create(buf) {
                srv.log.push(`CREATE ${p}`);
                if (srv.files.has(p)) throw new DavError(412, 'exists', 'e.dav.exists');
                srv._store(p, buf);
                return srv._tag(p);
            },
            async putCopy(buf, suffix) {
                const copy = `${p}.${suffix}.bak`;
                srv.log.push(`COPY ${copy}`);
                srv._store(copy, buf);
                return copy;
            },
            async pruneBackups() { return []; },
            async deleteBackups() {
                const gone = [...srv.files.keys()].filter((k) => k.startsWith(`${p}.`) && k.endsWith('.bak'));
                for (const k of gone) srv.files.delete(k);
                return gone;
            },
            async permissions() { return null; }
        };
    }
}

/** A new database on the server at path (default /db.kdbx) with the given entry titles in the root group. */
export async function newDb(dav, { path: p = '/db.kdbx', entries = [], password = PW } = {}) {
    const { vault } = await Vault.create({ name: 'db', password, security: FAST, dav: dav.file(p) });
    for (const t of entries) vault.applyEntry(null, vault.root, { Title: t });
    if (entries.length) await vault.save();
    return vault;
}

/** Opens the current server version at path as a second device would. */
export async function openDb(dav, { path: p = '/db.kdbx', password = PW } = {}) {
    const f = dav.files.get(p);
    return Vault.open({ buf: f.buf.slice(0), password, dav: dav.file(p), etag: dav._tag(p) });
}
