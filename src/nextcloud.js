// Nextcloud-Modus: Die Seite wird von der Nextcloud-App ausgeliefert (gleiche Herkunft). Anmeldung laeuft ueber die
// bestehende Browser-Sitzung; fuer Schreibzugriffe auf WebDAV wird das CSRF-Token (requesttoken) benoetigt.
// Es wird bewusst nur auf stabile, oeffentliche Schnittstellen zugegriffen: WebDAV unter /remote.php/dav und /csrftoken.

/** Liest die vom PHP-Teil gesetzten data-Attribute; null, wenn die Seite nicht von der Nextcloud-App stammt. */
import { DavError, NetworkError } from './webdav.js';

export function readNextcloudContext(root) {
    if (!root || root.dataset.mode !== 'nextcloud') return null;
    return {
        davBase: root.dataset.davBase, // z. B. https://cloud.example.org/remote.php/dav/files/NAME
        csrfUrl: root.dataset.csrfUrl,
        filesUrl: root.dataset.filesUrl,
        swUrl: root.dataset.swUrl || '',
        pepperUrl: root.dataset.pepperUrl || '', // Server-Geheimwert fuer gemerkte Schluesseldateien (leer = nicht verfuegbar)
        user: root.dataset.user || '',
        file: root.dataset.file || '' // z. B. /Dokumente/Passwoerter.kdbx (relativ zum Benutzerverzeichnis)
    };
}

export function normalizeUserPath(p) {
    let s = String(p || '').trim().replace(/\\/g, '/');
    if (!s) return '';
    if (!s.startsWith('/')) s = '/' + s;
    return s.replace(/\/{2,}/g, '/');
}

export function davUrlFor(ctx, userPath) {
    const segments = normalizeUserPath(userPath).split('/').filter(Boolean);
    if (segments.some((s) => s === '..' || s === '.')) throw new Error('Ungueltiger Pfad');
    return ctx.davBase.replace(/\/+$/, '') + '/' + segments.map(encodeURIComponent).join('/');
}

export function nextcloudAuth(ctx) {
    let token = null;
    const refresh = async () => {
        let res;
        try {
            res = await fetch(ctx.csrfUrl, { credentials: 'same-origin', headers: { 'OCS-APIREQUEST': 'true' }, cache: 'no-store' });
        } catch (e) {
            throw new NetworkError(e);
        }
        if (res.status >= 500) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`, 'e.dav.status', { status: res.status });
        if (!res.ok) throw new DavError(res.status, 'Sitzung abgelaufen - bitte die Seite neu laden und erneut anmelden.', 'e.nc.session');
        token = (await res.json()).token;
    };
    return {
        credentials: 'same-origin',
        async headers() {
            if (!token) await refresh();
            return { requesttoken: token, 'OCS-APIREQUEST': 'true' };
        },
        refresh
    };
}

/**
 * Holt (oder erneuert mit rotate=true) den Server-Geheimwert fuer gemerkte Schluesseldateien.
 * @returns {Promise<{id: string, key: Uint8Array}>} wirft NetworkError/DavError bei Ausfall bzw. abgelaufener Sitzung
 */
export async function fetchPepper(ctx, auth, { rotate = false } = {}) {
    if (!ctx?.pepperUrl) throw new DavError(0, 'Kein Server-Geheimwert verfuegbar.', 'e.kf.nopepper');
    const url = rotate ? ctx.pepperUrl.replace(/\/?$/, '/rotate') : ctx.pepperUrl;
    const send = async () => {
        try {
            return await fetch(url, { method: rotate ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { ...(await auth.headers()), Accept: 'application/json' } });
        } catch (e) {
            throw e instanceof DavError || e instanceof NetworkError ? e : new NetworkError(e);
        }
    };
    let res = await send();
    if ((res.status === 412 || res.status === 401 || res.status === 403) && auth.refresh) { await auth.refresh(); res = await send(); } // CSRF-Token abgelaufen
    if (res.status >= 500) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`, 'e.dav.status', { status: res.status });
    if (!res.ok) throw new DavError(res.status, 'Sitzung abgelaufen - bitte die Seite neu laden und erneut anmelden.', 'e.nc.session');
    const d = await res.json();
    const key = Uint8Array.from(atob(String(d.pepper || '')), (c) => c.charCodeAt(0));
    if (!/^[0-9a-f]{32}$/.test(String(d.id)) || key.length !== 32) throw new DavError(res.status, 'Ungueltige Antwort des Servers.', 'e.dav.status', { status: res.status });
    return { id: d.id, key };
}
