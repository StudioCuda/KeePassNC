// Nextcloud-Modus: Die Seite wird von der Nextcloud-App ausgeliefert (gleiche Herkunft). Anmeldung laeuft ueber die
// bestehende Browser-Sitzung; fuer Schreibzugriffe auf WebDAV wird das CSRF-Token (requesttoken) benoetigt.
// Es wird bewusst nur auf stabile, oeffentliche Schnittstellen zugegriffen: WebDAV unter /remote.php/dav und /csrftoken.

/** Liest die vom PHP-Teil gesetzten data-Attribute; null, wenn die Seite nicht von der Nextcloud-App stammt. */
import { DavError, NetworkError } from './webdav.js';
import { parseHex } from './theme.js';

export function readNextcloudContext(root) {
    if (!root || root.dataset.mode !== 'nextcloud') return null;
    return {
        davBase: root.dataset.davBase, // z. B. /remote.php/dav/files/NAME (relativ, gleicher Origin wie die Seite)
        csrfUrl: root.dataset.csrfUrl,
        filesUrl: root.dataset.filesUrl,
        swUrl: root.dataset.swUrl || '',
        pepperUrl: root.dataset.pepperUrl || '', // Server-Geheimwert fuer gemerkte Schluesseldateien (leer = nicht verfuegbar)
        user: root.dataset.user || '',
        file: root.dataset.file || '', // z. B. /Dokumente/Passwoerter.kdbx (relativ zum Benutzerverzeichnis)
        newFile: root.dataset.new || '', // Vorschlag fuer eine neue Datenbank aus "+ Neu" in Dateien, z. B. /Dokumente/Passwoerter.kdbx
        color: parseHex(root.dataset.ncColor) || '', // Primaerfarbe der Instanz (bzw. der Person), leer = unbekannt
        themes: String(root.dataset.ncThemes || ''), // Theme-IDs aus Nextcloud, z. B. "dark,opendyslexic"
        nav: parseNcNav(root.dataset.ncNav, globalThis.location?.origin) // Inhalt der Kopfleiste; null = keine Kopfleiste
    };
}

// Nur Pfade derselben Herkunft ohne Zeichen, die in CSS url("...") oder einem Attribut stoeren koennten.
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&*+,;=:@%/?]*$/;
function sameOriginPath(u, origin) {
    if (!u) return '';
    try {
        const x = new URL(String(u), origin);
        const p = x.pathname + x.search;
        return x.origin === origin && SAFE_PATH.test(p) ? p : '';
    } catch { return ''; }
}
function httpLink(u, origin) {
    try {
        const x = new URL(String(u), origin);
        return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch { return ''; }
}
// Office & Co. liefern ihre Aktions-Symbole als data:-URI (Base64, also ohne Zeichen, die url("...") stoeren); img-src erlaubt data:.
const DATA_ICON = /^data:image\/(?:svg\+xml|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const actionIcon = (u, origin) => (typeof u === 'string' && u.length <= 32768 && DATA_ICON.test(u) ? u : sameOriginPath(u, origin));
const hexColor = (v) => (typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : '');
const label = (v) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80);

/**
 * Prueft die Navigation, die der PHP-Teil aus INavigationManager liefert (JSON). Links muessen http(s) sein, Symbole, Logo und
 * Avatar von derselben Herkunft (sonst blockiert die CSP sie). Der Abmelde-Link kommt ohne requesttoken; das holt der Browser frisch.
 */
export function parseNcNav(json, origin) {
    if (!json || !origin) return null;
    let d;
    try { d = JSON.parse(json); } catch { return null; }
    if (!d || typeof d !== 'object' || !Array.isArray(d.apps)) return null;
    const apps = d.apps.slice(0, 60).map((a) => ({ id: label(a?.id), name: label(a?.name), href: httpLink(a?.href, origin), icon: sameOriginPath(a?.icon, origin), active: a?.active === true }))
        .filter((a) => a.id && a.name && a.href);
    const settings = (Array.isArray(d.settings) ? d.settings : []).slice(0, 30).map((s) => ({ id: label(s?.id), name: label(s?.name), href: httpLink(s?.href, origin), icon: sameOriginPath(s?.icon, origin), csrf: s?.csrf === true }))
        .filter((s) => s.id && s.name && s.href);
    // Navigations-Aktionen (Nextcloud 35, z. B. "Textdokument" von Office): nur echte Links. Aktionen ohne Link erledigt
    // Nextcloud-JavaScript ueber den Event-Bus, das laeuft hier nicht.
    const actions = (Array.isArray(d.actions) ? d.actions : []).slice(0, 20).map((a) => ({ id: label(a?.id), name: label(a?.name), href: httpLink(a?.href, origin), icon: actionIcon(a?.icon, origin), color: hexColor(a?.color) }))
        .filter((a) => a.id && a.name && a.href && !/#$/.test(a.href));
    if (!apps.length) return null;
    return {
        apps, settings, actions,
        home: httpLink(d.home, origin) || origin + '/',
        logo: sameOriginPath(d.logo, origin),
        avatar: sameOriginPath(d.avatar, origin),
        moreApps: d.moreApps ? httpLink(d.moreApps, origin) : '',
        name: label(d.name)
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
            console.warn('CSRF-Token-Abruf fehlgeschlagen', ctx.csrfUrl, e); // wie in webdav.js: die Oberflaeche sagt nur "nicht erreichbar"
            throw new NetworkError(e);
        }
        if (!res.ok) console.warn('CSRF-Token-Abruf: Status', res.status, ctx.csrfUrl);
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
            if (e instanceof DavError || e instanceof NetworkError) throw e; // aus auth.headers(), dort schon gemeldet
            console.warn('Server-Geheimwert-Abruf fehlgeschlagen', url, e);
            throw new NetworkError(e);
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
