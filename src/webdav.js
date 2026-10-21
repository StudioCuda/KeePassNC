// Minimal WebDAV client for exactly one file. Writes always go out with If-Match (ETag), so changes made by
// other devices in the meantime are never silently overwritten.

export class ConflictError extends Error {
    constructor() {
        super('Die Datei wurde zwischenzeitlich auf dem Server geaendert.');
        this.name = 'ConflictError';
        this.key = 'e.conflict';
    }
}

/** message: German fallback text; key/vars: translation key (see errText in i18n.js). */
export class DavError extends Error {
    constructor(status, message, key, vars) {
        super(message);
        this.name = 'DavError';
        this.status = status;
        this.key = key;
        this.vars = vars;
    }
}

/**
 * Server not reachable (network, DNS, connection refused, timeout). host: target on a different origin than the
 * page. Then it may just as well be CORS (the browser does not say which of the two), so the message names both.
 */
export class NetworkError extends Error {
    constructor(cause, host = '') {
        super('Server nicht erreichbar.');
        this.name = 'NetworkError';
        this.key = host ? 'e.network.cors' : 'e.network';
        this.vars = host ? { host } : undefined;
        this.cause = cause;
    }
}

/** Host of the address if it lives on a different origin than the page; otherwise ''. */
function foreignHost(url) {
    if (typeof location === 'undefined') return '';
    try { const u = new URL(url, location.href); return u.origin !== location.origin ? u.host : ''; } catch { return ''; }
}

/** true if the error means "server currently unavailable" (outage, maintenance mode, gateway error) - then the local cache may step in. */
export function isOffline(e) {
    return e instanceof NetworkError || (e instanceof DavError && (e.status >= 500 || e.status === 0));
}

/**
 * Message for when the server is down and no offline copy steps in. A 5xx names its status: maintenance mode, gateway error
 * and a hanging storage backend (503) are something different from a server the browser cannot reach at all (issue #50).
 * cacheOn: offline copy is switched on (but none exists for this file yet).
 */
export function offlineFailKey(e, cacheOn) {
    if (e instanceof DavError && e.status >= 500) return cacheOn ? 'err.offline.status.nocopy' : 'err.offline.status.nooption';
    if (e instanceof NetworkError && e.vars?.host) return e.key; // foreign origin: CORS is just as likely as an outage
    return cacheOn ? 'err.offline.nocopy' : 'err.offline.nooption';
}

function etagOf(res) {
    return res.headers.get('etag') || res.headers.get('oc-etag') || null;
}

/** Sign-in via HTTP Basic (user + app password), e.g. for the standalone page. */
export function basicAuth(user, pass) {
    return {
        credentials: 'omit',
        async headers() {
            if (!user) return {};
            const bytes = new TextEncoder().encode(`${user}:${pass ?? ''}`);
            let bin = '';
            for (const b of bytes) bin += String.fromCharCode(b);
            return { Authorization: 'Basic ' + btoa(bin) };
        }
    };
}

export class DavFile {
    /**
     * @param {{url: string, user?: string, pass?: string, auth?: {credentials: RequestCredentials, headers: () => Promise<Record<string,string>>, refresh?: () => Promise<void>}}} opts
     * auth: optionally a custom provider (e.g. Nextcloud session); otherwise Basic with user/pass.
     */
    constructor({ url, user, pass, auth }) {
        this.url = url;
        this.auth = auth || basicAuth(user, pass);
    }

    async _fetch(url, init = {}) {
        for (let attempt = 0; ; attempt++) {
            const headers = { ...(await this.auth.headers()), ...(init.headers || {}) };
            let res;
            try {
                res = await fetch(url, { ...init, headers, cache: 'no-store', credentials: this.auth.credentials });
            } catch (e) {
                // The UI only says "not reachable"; the actual cause (mixed content, CSP, DNS ...) is recorded here
                console.warn('WebDAV request failed', init.method || 'GET', url, e);
                throw new NetworkError(e, foreignHost(url));
            }
            // Expired session token (Nextcloud): refresh once and retry
            if (res.status === 401 && this.auth.refresh && attempt === 0) {
                await this.auth.refresh();
                continue;
            }
            return res;
        }
    }

    async get() {
        const res = await this._fetch(this.url);
        if (res.status === 401 || res.status === 403) throw new DavError(res.status, 'Zugriff verweigert - Anmeldung oder Zugangsdaten pruefen.', 'e.dav.denied');
        if (res.status === 404) throw new DavError(404, 'Datei nicht gefunden - Pfad pruefen.', 'e.dav.notfound');
        if (!res.ok) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`, 'e.dav.status', { status: res.status });
        return { buf: await res.arrayBuffer(), etag: etagOf(res) };
    }

    async head() {
        const res = await this._fetch(this.url, { method: 'HEAD' });
        if (!res.ok) throw new DavError(res.status, `HEAD fehlgeschlagen (${res.status}).`, 'e.dav.head', { status: res.status });
        return etagOf(res);
    }

    /** Overwrites the file only if it still matches the expected ETag. Returns the new ETag. */
    async put(buf, ifMatch) {
        const headers = { 'Content-Type': 'application/octet-stream' };
        if (ifMatch) headers['If-Match'] = ifMatch;
        const res = await this._fetch(this.url, { method: 'PUT', headers, body: buf });
        if (res.status === 412) throw new ConflictError();
        if (res.status === 403) throw new DavError(403, 'Keine Schreibberechtigung fuer diese Datei (z. B. Freigabe nur zum Lesen).', 'e.dav.readonly');
        if (!res.ok) throw new DavError(res.status, `Speichern fehlgeschlagen (Status ${res.status}).`, 'e.dav.save', { status: res.status });
        return etagOf(res) || (await this.head());
    }

    /**
     * Creates the file (new database) but never overwrites an existing one: PUT with If-None-Match: *. Returns the ETag.
     * 412: it already exists; 403: no permission to create in the folder; 404/409: the folder does not exist.
     */
    async create(buf) {
        const res = await this._fetch(this.url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: buf });
        if (res.status === 412) throw new DavError(412, 'Diese Datei gibt es schon - bitte einen anderen Namen waehlen.', 'e.dav.exists');
        if (res.status === 401) throw new DavError(401, 'Zugriff verweigert - Anmeldung bzw. Zugangsdaten pruefen.', 'e.dav.denied');
        if (res.status === 403) throw new DavError(403, 'Keine Berechtigung, hier eine Datei anzulegen.', 'e.dav.nocreate');
        if (res.status === 404 || res.status === 409) throw new DavError(res.status, 'Diesen Ordner gibt es nicht - Pfad pruefen.', 'e.dav.nofolder');
        if (!res.ok) throw new DavError(res.status, `Anlegen fehlgeschlagen (Status ${res.status}).`, 'e.dav.save', { status: res.status });
        return etagOf(res) || (await this.head());
    }

    /**
     * Nextcloud permissions of the file (oc:permissions, e.g. "SRGDNVW"; "W" = change content). null if the server does not report them
     * (other WebDAV servers) or the query fails - the file then counts as writable and saving has the final say.
     */
    async permissions() {
        try {
            const res = await this._fetch(this.url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:permissions/></d:prop></d:propfind>' });
            if (res.status !== 207) return null;
            const el = new DOMParser().parseFromString(await res.text(), 'application/xml').getElementsByTagNameNS('http://owncloud.org/ns', 'permissions')[0];
            return (el?.textContent || '').trim() || null; // empty = unknown (e.g. propstat 404), not "no permissions"
        } catch {
            return null;
        }
    }

    /**
     * Account behind the credentials (current-user-principal), e.g. "/remote.php/dav/principals/users/anna/"; null if the server
     * reports none. If there is no WebDAV at the address: e.dav.nodav.
     */
    async principal() {
        const res = await this._fetch(this.url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
        if (res.status === 401 || res.status === 403) throw new DavError(res.status, 'Zugriff verweigert - Anmeldung bzw. Zugangsdaten pruefen.', 'e.dav.denied');
        if (res.status >= 500) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`, 'e.dav.status', { status: res.status });
        if (res.status !== 207) throw new DavError(res.status, 'Unter dieser Adresse antwortet keine Nextcloud - Adresse pruefen.', 'e.dav.nodav');
        const el = new DOMParser().parseFromString(await res.text(), 'application/xml').getElementsByTagNameNS('DAV:', 'current-user-principal')[0];
        return el?.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent.trim() || null;
    }

    /** Creates a backup under a new name (does not fail if the name already exists). */
    async putCopy(buf, suffix) {
        const url = `${this.url}.${suffix}.bak`;
        const res = await this._fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: buf });
        if (!res.ok && res.status !== 412) throw new DavError(res.status, `Sicherungskopie fehlgeschlagen (Status ${res.status}).`, 'e.dav.backup', { status: res.status });
        return url;
    }

    /**
     * Cleans up old backups: keeps the newest `keep` of each kind (normal / conflict).
     * Only touches files that exactly match the pattern "<filename>.[conflict-]YYYYMMDD-HHMMSS.bak".
     * keep <= 0 means: delete nothing. Returns the names of the deleted files.
     */
    async pruneBackups(keep) {
        if (!(keep > 0)) return [];
        return this._deleteBackups(keep);
    }

    /** Deletes all backups of this file (same pattern as pruneBackups). Returns the names of the deleted files. */
    deleteBackups() { return this._deleteBackups(0); }

    /**
     * Contents of the folder at this.url (with or without trailing "/"): [{name, dir, modified}], without the folder itself.
     * Folder missing: DavError 404 (e.dav.nofolder); no permission: 401/403; a server that does not list (no 207): [].
     */
    async list() {
        const url = this.url.replace(/\/?$/, '/');
        const res = await this._fetch(url, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/></d:prop></d:propfind>' });
        if (res.status === 404) throw new DavError(404, 'Diesen Ordner gibt es nicht - Pfad pruefen.', 'e.dav.nofolder');
        if (res.status === 401 || res.status === 403) throw new DavError(res.status, 'Zugriff verweigert - Anmeldung bzw. Zugangsdaten pruefen.', 'e.dav.denied');
        if (res.status !== 207) return [];
        const abs = new URL(url, typeof location !== 'undefined' ? location.href : undefined); // Nextcloud: relative address
        const self = decodeURIComponent(abs.pathname).replace(/\/+$/, '');
        const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
        const out = [];
        for (const r of Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))) {
            const href = r.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent || '';
            const p = decodeURIComponent(new URL(href, abs).pathname).replace(/\/+$/, '');
            if (p === self) continue;
            out.push({
                name: p.split('/').pop() || '',
                dir: r.getElementsByTagNameNS('DAV:', 'collection').length > 0,
                modified: new Date(r.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent || NaN)
            });
        }
        return out;
    }

    /** Creates the folder at this.url. Already exists: e.dav.exists; no permission: e.dav.nocreate; parent folder missing: e.dav.nofolder. */
    async mkdir() {
        const res = await this._fetch(this.url.replace(/\/+$/, ''), { method: 'MKCOL' });
        if (res.status === 405) throw new DavError(405, 'Diesen Ordner gibt es schon.', 'e.dav.exists');
        if (res.status === 401 || res.status === 403) throw new DavError(res.status, 'Keine Berechtigung, hier etwas anzulegen.', 'e.dav.nocreate');
        if (res.status === 409) throw new DavError(409, 'Diesen Ordner gibt es nicht - Pfad pruefen.', 'e.dav.nofolder');
        if (!res.ok) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`, 'e.dav.status', { status: res.status });
    }

    /** The file's folder: address (with trailing "/"), own file name and all entries [{name, dir, modified}] (empty if the server does not list). */
    async _listDir() {
        const u = new URL(this.url, typeof location !== 'undefined' ? location.href : undefined);
        const slash = u.pathname.lastIndexOf('/');
        const dir = u.origin + u.pathname.slice(0, slash + 1);
        const base = decodeURIComponent(u.pathname.slice(slash + 1));
        let files;
        try { files = await new DavFile({ url: dir, auth: this.auth }).list(); } catch (e) { if (!(e instanceof DavError)) throw e; files = []; }
        return { dir, base, files };
    }

    /** Other .kdbx files in the same folder (e.g. "(conflicted copy)" from the Nextcloud clients), newest first, each as DavFile. */
    async siblings() {
        const { dir, base, files } = await this._listDir();
        return files.filter((f) => !f.dir && /\.kdbx$/i.test(f.name) && f.name !== base)
            .sort((a, b) => (b.modified.getTime() || 0) - (a.modified.getTime() || 0))
            .map((f) => ({ name: f.name, modified: f.modified, file: new DavFile({ url: dir + encodeURIComponent(f.name), auth: this.auth }) }));
    }

    async _deleteBackups(keep) {
        const { dir, base, files } = await this._listDir();
        const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.(conflict-)?(\\d{8}-\\d{6})\\.bak$');
        const groups = { normal: [], conflict: [] };
        for (const { name } of files) {
            const m = re.exec(name);
            if (m) groups[m[1] ? 'conflict' : 'normal'].push({ name, stamp: m[2] });
        }
        const removed = [];
        for (const list of Object.values(groups)) {
            list.sort((a, b) => b.stamp.localeCompare(a.stamp) || b.name.localeCompare(a.name));
            for (const f of list.slice(keep)) {
                const r = await this._fetch(dir + encodeURIComponent(f.name), { method: 'DELETE' });
                if (r.ok || r.status === 404) removed.push(f.name);
            }
        }
        return removed;
    }
}
