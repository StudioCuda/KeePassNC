// Minimaler WebDAV-Client fuer genau eine Datei. Schreibzugriffe laufen immer mit If-Match (ETag), damit
// zwischenzeitliche Aenderungen anderer Geraete nie stillschweigend ueberschrieben werden.

export class ConflictError extends Error {
    constructor() {
        super('Die Datei wurde zwischenzeitlich auf dem Server geaendert.');
        this.name = 'ConflictError';
    }
}

export class DavError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'DavError';
        this.status = status;
    }
}

function etagOf(res) {
    return res.headers.get('etag') || res.headers.get('oc-etag') || null;
}

export class DavFile {
    /** @param {{url: string, user?: string, pass?: string, headers?: () => Record<string,string>}} opts */
    constructor({ url, user, pass, headers }) {
        this.url = url;
        this.user = user;
        this.pass = pass;
        this.extraHeaders = headers;
    }

    _headers(extra = {}) {
        const h = { ...(this.extraHeaders ? this.extraHeaders() : {}), ...extra };
        if (this.user) {
            const bytes = new TextEncoder().encode(`${this.user}:${this.pass ?? ''}`);
            let bin = '';
            for (const b of bytes) bin += String.fromCharCode(b);
            h.Authorization = 'Basic ' + btoa(bin);
        }
        return h;
    }

    async get() {
        const res = await fetch(this.url, { headers: this._headers(), cache: 'no-store', credentials: 'omit' });
        if (res.status === 401 || res.status === 403) throw new DavError(res.status, 'Zugriff verweigert - Benutzer oder App-Passwort pruefen.');
        if (res.status === 404) throw new DavError(404, 'Datei nicht gefunden - URL pruefen.');
        if (!res.ok) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`);
        return { buf: await res.arrayBuffer(), etag: etagOf(res) };
    }

    async head() {
        const res = await fetch(this.url, { method: 'HEAD', headers: this._headers(), cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new DavError(res.status, `HEAD fehlgeschlagen (${res.status}).`);
        return etagOf(res);
    }

    /** Ueberschreibt die Datei nur, wenn sie noch dem erwarteten ETag entspricht. Liefert den neuen ETag. */
    async put(buf, ifMatch) {
        const headers = this._headers({ 'Content-Type': 'application/octet-stream' });
        if (ifMatch) headers['If-Match'] = ifMatch;
        const res = await fetch(this.url, { method: 'PUT', headers, body: buf, credentials: 'omit' });
        if (res.status === 412) throw new ConflictError();
        if (!res.ok) throw new DavError(res.status, `Speichern fehlgeschlagen (Status ${res.status}).`);
        return etagOf(res) || (await this.head());
    }

    /** Legt eine Sicherungskopie unter neuem Namen an (schlaegt fehl, falls der Name schon existiert). */
    async putCopy(buf, suffix) {
        const url = `${this.url}.${suffix}.bak`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: this._headers({ 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }),
            body: buf,
            credentials: 'omit'
        });
        if (!res.ok && res.status !== 412) throw new DavError(res.status, `Sicherungskopie fehlgeschlagen (Status ${res.status}).`);
        return url;
    }
}
