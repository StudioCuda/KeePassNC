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

/** Server nicht erreichbar (Netz, DNS, Verbindung abgelehnt, Zeitueberschreitung). */
export class NetworkError extends Error {
    constructor(cause) {
        super('Server nicht erreichbar.');
        this.name = 'NetworkError';
        this.cause = cause;
    }
}

/** true, wenn der Fehler "Server gerade nicht verfuegbar" bedeutet (Ausfall, Wartungsmodus, Gateway-Fehler) - dann darf der lokale Cache einspringen. */
export function isOffline(e) {
    return e instanceof NetworkError || (e instanceof DavError && (e.status >= 500 || e.status === 0));
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
        if (res.status === 401 || res.status === 403) throw new DavError(res.status, 'Zugriff verweigert - Anmeldung bzw. Zugangsdaten pruefen.');
        if (res.status === 404) throw new DavError(404, 'Datei nicht gefunden - Pfad pruefen.');
        if (!res.ok) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`);
        return { buf: await res.arrayBuffer(), etag: etagOf(res) };
    }

    async head() {
        const res = await this._fetch(this.url, { method: 'HEAD' });
        if (!res.ok) throw new DavError(res.status, `HEAD fehlgeschlagen (${res.status}).`);
        return etagOf(res);
    }

    /** Ueberschreibt die Datei nur, wenn sie noch dem erwarteten ETag entspricht. Liefert den neuen ETag. */
    async put(buf, ifMatch) {
        const headers = { 'Content-Type': 'application/octet-stream' };
        if (ifMatch) headers['If-Match'] = ifMatch;
        const res = await this._fetch(this.url, { method: 'PUT', headers, body: buf });
        if (res.status === 412) throw new ConflictError();
        if (!res.ok) throw new DavError(res.status, `Speichern fehlgeschlagen (Status ${res.status}).`);
        return etagOf(res) || (await this.head());
    }

    /** Legt eine Sicherungskopie unter neuem Namen an (schlaegt nicht fehl, falls der Name schon existiert). */
    async putCopy(buf, suffix) {
        const url = `${this.url}.${suffix}.bak`;
        const res = await this._fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: buf });
        if (!res.ok && res.status !== 412) throw new DavError(res.status, `Sicherungskopie fehlgeschlagen (Status ${res.status}).`);
        return url;
    }
}
