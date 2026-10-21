// Nextcloud mode: the page is served by the Nextcloud app (same origin). Login goes through the
// existing browser session; write access to WebDAV needs the CSRF token (requesttoken).
// Only stable, public interfaces are used on purpose: WebDAV under /remote.php/dav and /csrftoken.

/** Reads the data attributes set by the PHP part; null if the page doesn't come from the Nextcloud app. */
import { DavError, NetworkError } from './webdav.js';
import { parseHex } from './theme.js';

export function readNextcloudContext(root) {
    if (!root || root.dataset.mode !== 'nextcloud') return null;
    return {
        davBase: root.dataset.davBase, // e.g. /remote.php/dav/files/NAME (relative, same origin as the page)
        csrfUrl: root.dataset.csrfUrl,
        filesUrl: root.dataset.filesUrl,
        swUrl: root.dataset.swUrl || '',
        pepperUrl: root.dataset.pepperUrl || '', // server secret for remembered key files (empty = not available)
        user: root.dataset.user || '',
        file: root.dataset.file || '', // e.g. /Dokumente/Passwoerter.kdbx (relative to the user directory)
        newFile: root.dataset.new || '', // suggestion for a new database from "+ New" in Files, e.g. /Dokumente/Passwoerter.kdbx
        color: parseHex(root.dataset.ncColor) || '', // primary colour of the instance (or the person), empty = unknown
        themes: String(root.dataset.ncThemes || ''), // theme IDs from Nextcloud, e.g. "dark,opendyslexic"
        nav: parseNcNav(root.dataset.ncNav, globalThis.location?.origin) // content of the header bar; null = no header bar
    };
}

// Only same-origin paths without characters that could break CSS url("...") or an attribute.
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
// Office & co. deliver their action icons as data: URIs (Base64, so without characters that break url("...")); img-src allows data:.
const DATA_ICON = /^data:image\/(?:svg\+xml|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const actionIcon = (u, origin) => (typeof u === 'string' && u.length <= 32768 && DATA_ICON.test(u) ? u : sameOriginPath(u, origin));
const hexColor = (v) => (typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : '');
const label = (v) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80);

/**
 * Validates the navigation the PHP part gets from INavigationManager (JSON). Links must be http(s), icons, logo and
 * avatar from the same origin (otherwise the CSP blocks them). The logout link comes without requesttoken; the browser fetches that fresh.
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
    // Navigation actions (Nextcloud 35, e.g. "Text document" from Office): real links only. Actions without a link are handled by
    // Nextcloud JavaScript over the event bus, which doesn't run here.
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
            console.warn('CSRF-Token-Abruf fehlgeschlagen', ctx.csrfUrl, e); // as in webdav.js: the UI only says "not reachable"
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
 * Fetches (or renews with rotate=true) the server secret for remembered key files.
 * @returns {Promise<{id: string, key: Uint8Array}>} throws NetworkError/DavError on outage or expired session
 */
export async function fetchPepper(ctx, auth, { rotate = false } = {}) {
    if (!ctx?.pepperUrl) throw new DavError(0, 'Kein Server-Geheimwert verfuegbar.', 'e.kf.nopepper');
    const url = rotate ? ctx.pepperUrl.replace(/\/?$/, '/rotate') : ctx.pepperUrl;
    const send = async () => {
        try {
            return await fetch(url, { method: rotate ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { ...(await auth.headers()), Accept: 'application/json' } });
        } catch (e) {
            if (e instanceof DavError || e instanceof NetworkError) throw e; // from auth.headers(), already reported there
            console.warn('Server-Geheimwert-Abruf fehlgeschlagen', url, e);
            throw new NetworkError(e);
        }
    };
    let res = await send();
    if ((res.status === 412 || res.status === 401 || res.status === 403) && auth.refresh) { await auth.refresh(); res = await send(); } // CSRF token expired
    if (res.status >= 500) throw new DavError(res.status, `Server antwortete mit Status ${res.status}.`, 'e.dav.status', { status: res.status });
    if (!res.ok) throw new DavError(res.status, 'Sitzung abgelaufen - bitte die Seite neu laden und erneut anmelden.', 'e.nc.session');
    const d = await res.json();
    const key = Uint8Array.from(atob(String(d.pepper || '')), (c) => c.charCodeAt(0));
    if (!/^[0-9a-f]{32}$/.test(String(d.id)) || key.length !== 32) throw new DavError(res.status, 'Ungueltige Antwort des Servers.', 'e.dav.status', { status: res.status });
    return { id: d.id, key };
}
