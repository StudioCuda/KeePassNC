// Gemeinsamer Zustand der Oberflaeche. Module registrieren ihre Zeichenfunktionen in ctx.ui (vermeidet zyklische Importe).
import { loadSettings } from '../settings.js';
import { createKeyfileStore } from '../keyfile-store.js';
import { keyfileBackend } from '../cache.js';
import { t } from '../i18n.js';
import { ncThemeFrom, themeVars, THEME_VARS } from '../theme.js';
import { $ } from './dom.js';
import { toast } from './dom.js';

export const kfStore = createKeyfileStore(keyfileBackend);
/** Kennung einer gemerkten Schluesseldatei fuer eine lokal gewaehlte Datei (in Nextcloud zusaetzlich je Benutzer getrennt). */
export const kfFileId = (name) => (ctx.NC ? `nc-file:${ctx.NC.user}:${name}` : `file:${name}`);
/** Welche gemerkten Datensaetze die Einstellungen zeigen/loeschen: in Nextcloud nur die des angemeldeten Benutzers. */
export const kfScope = (id) => (ctx.NC ? id.startsWith(`nc:${ctx.NC.user}:`) || id.startsWith(`nc-file:${ctx.NC.user}:`) : !id.startsWith('nc:') && !id.startsWith('nc-file:'));
export const params = new URLSearchParams(location.search);
export const SW_CACHE = 'kpnc-app-v1';
export const SYNC_RETRY_MS = (parseFloat(params.get('syncretry')) || 30) * 1000; // ungesyncte Offline-Staende werden alle 30 s erneut versucht

export const ctx = {
    params,
    settings: loadSettings(),
    NC: null,
    app: null,
    ui: {}, // renderAll, renderSidebar, renderList, renderDetail, ...
    state: {
        vault: null,
        source: null, // {type: 'dav'|'file', name}
        filter: { type: 'all' }, // all | group | bin | expiring | weak | totp | passkey | tag
        selEntry: null,
        editing: null, // {entry|null, group}
        query: '',
        lastActivity: Date.now(),
        offlineMode: false,
        lastSyncFailed: false,
        hiddenSince: 0,
        view: 'list', // mobil: groups | list | detail
        collapsed: new Set()
    }
};

export function pref(key, value) {
    try {
        if (value === undefined) return localStorage.getItem('kpnc.' + key) || '';
        localStorage.setItem('kpnc.' + key, value);
    } catch { /* Speicher nicht verfuegbar - kein Problem */ }
    return '';
}

/** Statuszeile unten; Warnungen/Fehler zusaetzlich als Hinweis (Toast). */
export function setStatus(msg, kind = 'info') {
    const el = $('#status');
    if (el) { el.textContent = msg; el.dataset.kind = kind; }
    if (kind === 'error' || kind === 'warn') toast(msg, { kind, timeout: kind === 'error' ? 8000 : 6000 });
}

let clipboardTimer = null;
export async function copy(text, label) {
    try {
        await navigator.clipboard.writeText(text);
        setStatus(t('copied', { what: label, s: ctx.settings.clipboard }));
        toast(t('copied.short', { what: label }), { timeout: 1800 });
        clearTimeout(clipboardTimer);
        clipboardTimer = setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, ctx.settings.clipboard * 1000);
    } catch {
        setStatus(t('copy.failed'), 'error');
    }
}

export function download(name, data, type = 'application/octet-stream') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Hell/dunkel, Dichte und (in Nextcloud) Instanzfarbe. Die eigene Wahl in der App geht vor; "wie Nextcloud" folgt der Person. */
export function applyTheme() {
    const root = document.documentElement;
    const nc = ncThemeFrom(ctx.NC?.themes);
    const th = ctx.settings.theme === 'nextcloud' ? (ctx.NC ? nc.theme : 'auto') : ctx.settings.theme;
    if (th === 'light' || th === 'dark') root.dataset.theme = th; else delete root.dataset.theme;
    root.dataset.density = ctx.settings.compact ? 'compact' : 'comfortable';
    if (ctx.NC && nc.contrast) root.dataset.contrast = 'more'; else delete root.dataset.contrast;
    for (const name of THEME_VARS) root.style.removeProperty(name);
    const { vars, accent } = themeVars(ctx.NC?.color, { useAccent: ctx.settings.ncAccent, highContrast: !!(ctx.NC && nc.contrast) });
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v); // CSSOM: faellt nicht unter style-src (kein style-Attribut im Markup)
    if (accent) root.dataset.accent = 'nc'; else delete root.dataset.accent;
}
