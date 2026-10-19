// Minimaler WebDAV-Client fuer genau eine Datei. Schreibzugriffe laufen immer mit If-Match (ETag), damit
// zwischenzeitliche Aenderungen anderer Geraete nie stillschweigend ueberschrieben werden.

export class ConflictError extends Error {
    constructor() {
        super('Die Datei wurde zwischenzeitlich auf dem Server geaendert.');
        this.name = 'ConflictError';
        this.key = 'e.conflict';
    }
}

/** message: deutscher Ersatztext; key/vars: Schluessel der Uebersetzung (siehe errText in i18n.js). */
export class DavError extends Error {
    constructor(status, message, key, vars) {
        super(message);
        this.name = 'DavError';
        this.status = status;
        this.key = key;
        this.vars = vars;
    }
}

/** Server nicht erreichbar (Netz, DNS, Verbindung abgelehnt, Zeitueberschreitung). */
export class NetworkError extends Error {
    constructor(cause) {
        super('Server nicht erreichbar.');
        this.name = 'NetworkError';
        this.key = 'e.network';
        this.cause = cause;
    }
}

/** true, wenn der Fehler "Server gerade nicht verfuegbar" bedeutet (Ausfall, Wartungsmodus, Gateway-Fehler) - dann darf der lokale Cache einspringen. */
export function isOffline(e) {
    return e instanceof NetworkError || (e instanceof DavError && (e.status >= 500 || e.status === 0));
}

/**
 * Meldung, wenn der Server ausfaellt und keine Offline-Kopie einspringt. Ein 5xx nennt seinen Status: Wartungsmodus, Gateway-Fehler
 * und eine haengende Speicherquelle (503) sind etwas anderes als ein Server, den der Browser gar nicht erreicht (Issue #50).
 * cacheOn: Offline-Kopie eingeschaltet (aber fuer diese Datei noch keine vorhanden).
 */
export function offlineFailKey(e, cacheOn) {
    if (e instanceof DavError && e.status >= 500) return cacheOn ? 'err.offline.status.nocopy' : 'err.offline.status.nooption';
    return cacheOn ? 'err.offline.nocopy' : 'err.offline.nooption';
}

function etagOf(res) {
    return res.headers.get('etag') || res.headers.get('oc-etag') || null;
}

/** Anmeldung per HTTP-Basic (Benutzer + App-Passwort), z. B. fuer die eigenstaendige Webseite. */
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
     * auth: wahlweise eigener Anbieter (z. B. Nextcloud-Sitzung); sonst Basic mit user/pass.
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
                // Die Oberflaeche sagt nur "nicht erreichbar"; die eigentliche Ursache (Mixed Content, CSP, DNS ...) steht hier
                console.warn('WebDAV-Abruf fehlgeschlagen', init.method || 'GET', url, e);
                throw new NetworkError(e);
            }
            // Abgelaufenes Sitzungs-Token (Nextcloud): einmal erneuern und wiederholen
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

    /** Ueberschreibt die Datei nur, wenn sie noch dem erwarteten ETag entspricht. Liefert den neuen ETag. */
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
     * Nextcloud-Rechte der Datei (oc:permissions, z. B. "SRGDNVW"; "W" = Inhalt aendern). null, wenn der Server sie nicht nennt
     * (andere WebDAV-Server) oder die Abfrage scheitert - dann gilt die Datei als beschreibbar und erst das Speichern entscheidet.
     */
    async permissions() {
        try {
            const res = await this._fetch(this.url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:permissions/></d:prop></d:propfind>' });
            if (res.status !== 207) return null;
            const el = new DOMParser().parseFromString(await res.text(), 'application/xml').getElementsByTagNameNS('http://owncloud.org/ns', 'permissions')[0];
            return (el?.textContent || '').trim() || null; // leer = unbekannt (z. B. propstat 404), nicht "keine Rechte"
        } catch {
            return null;
        }
    }

    /** Legt eine Sicherungskopie unter neuem Namen an (schlaegt nicht fehl, falls der Name schon existiert). */
    async putCopy(buf, suffix) {
        const url = `${this.url}.${suffix}.bak`;
        const res = await this._fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: buf });
        if (!res.ok && res.status !== 412) throw new DavError(res.status, `Sicherungskopie fehlgeschlagen (Status ${res.status}).`, 'e.dav.backup', { status: res.status });
        return url;
    }

    /**
     * Raeumt alte Sicherungskopien auf: behaelt je Art (normal / conflict) die neuesten `keep` Stueck.
     * Beruehrt ausschliesslich Dateien, die exakt dem Muster "<Dateiname>.[conflict-]JJJJMMTT-HHMMSS.bak" entsprechen.
     * keep <= 0 bedeutet: nichts loeschen. Liefert die Namen der geloeschten Dateien.
     */
    async pruneBackups(keep) {
        if (!(keep > 0)) return [];
        return this._deleteBackups(keep);
    }

    /** Loescht alle Sicherungskopien dieser Datei (gleiches Muster wie pruneBackups). Liefert die Namen der geloeschten Dateien. */
    deleteBackups() { return this._deleteBackups(0); }

    /** Der Ordner der Datei: Adresse (mit "/" am Ende), eigener Dateiname und alle Eintraege [{name, modified}] (leer, wenn der Server nicht listet). */
    async _listDir() {
        const u = new URL(this.url, typeof location !== 'undefined' ? location.href : undefined);
        const slash = u.pathname.lastIndexOf('/');
        const dir = u.origin + u.pathname.slice(0, slash + 1);
        const base = decodeURIComponent(u.pathname.slice(slash + 1));
        const res = await this._fetch(dir, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/></d:prop></d:propfind>' });
        if (res.status !== 207) return { dir, base, files: [] };
        const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
        const files = Array.from(doc.getElementsByTagNameNS('DAV:', 'response')).map((r) => ({
            name: decodeURIComponent((r.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent || '').replace(/\/+$/, '').split('/').pop() || ''),
            modified: new Date(r.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent || NaN)
        }));
        return { dir, base, files };
    }

    /** Andere .kdbx-Dateien im selben Ordner (z. B. "(conflicted copy)" der Nextcloud-Clients), neueste zuerst, je als DavFile. */
    async siblings() {
        const { dir, base, files } = await this._listDir();
        return files.filter((f) => /\.kdbx$/i.test(f.name) && f.name !== base)
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
