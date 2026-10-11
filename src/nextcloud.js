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
        if (res.status >= 500) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`);
        if (!res.ok) throw new DavError(res.status, 'Sitzung abgelaufen - bitte die Seite neu laden und erneut anmelden.');
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
