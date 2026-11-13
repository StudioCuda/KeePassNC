// Shared UI state. Modules register their render functions in ctx.ui (avoids circular imports).
import { loadSettings } from '../settings.js';
import { createKeyfileStore } from '../keyfile-store.js';
import { keyfileBackend } from '../cache.js';
import { t } from '../i18n.js';
import { ncThemeFrom, themeVars, THEME_VARS } from '../theme.js';
import { $, toast } from './dom.js';
import { clipboardGuard } from './clipboard.js';

export const kfStore = createKeyfileStore(keyfileBackend);
/** ID of a remembered key file for a locally chosen file (in Nextcloud additionally separated per user). */
export const kfFileId = (name) => (ctx.NC ? `nc-file:${ctx.NC.user}:${name}` : `file:${name}`);
/** Which remembered records the settings show/delete: in Nextcloud only those of the signed-in user. */
export const kfScope = (id) => (ctx.NC ? id.startsWith(`nc:${ctx.NC.user}:`) || id.startsWith(`nc-file:${ctx.NC.user}:`) : !id.startsWith('nc:') && !id.startsWith('nc-file:'));
export const params = new URLSearchParams(location.search);
export const SW_CACHE = 'kpnc-app-v1';
export const LOCK_WAIT_MS = Math.max(1, parseFloat(params.get('lockwait')) || 10) * 1000; // how long the lock waits for a running save (at least 1 s; shorter only for tests)
export const SYNC_RETRY_MS = (parseFloat(params.get('syncretry')) || 30) * 1000; // unsynced offline states are retried every 30 s

export const ctx = {
    params,
    settings: loadSettings(),
    NC: null,
    app: null,
    ui: {}, // renderAll, renderSidebar, renderList, renderDetail, ...
    state: {
        vault: null,
        source: null, // {type: 'dav'|'file', name, kfId (ID for remembered key files), readOnly}
        kfBusy: null, // running re-encryption of a remembered key file (promise)
        filter: { type: 'all' }, // all | group | bin | expiring | weak | totp | passkey | tag
        selEntry: null,
        marked: new Set(), // entries marked for a batch action (Ctrl/Shift+click or the select button)
        selecting: false, // select mode: a click ticks instead of opening
        editing: null, // {entry|null, group}
        softLocked: false, // auto-lock with unsaved changes: view hidden, database still in memory (softlock.js)
        query: '',
        lastActivity: Date.now(),
        offlineMode: false,
        lastSyncFailed: false,
        hiddenSince: 0,
        view: 'list', // mobile: groups | list | detail
        collapsed: new Set()
    }
};

/** Leaves select mode and forgets the marked entries. */
export function clearMarks() {
    ctx.state.marked.clear();
    ctx.state.selecting = false;
}

export function pref(key, value) {
    try {
        if (value === undefined) return localStorage.getItem('kpnc.' + key) || '';
        localStorage.setItem('kpnc.' + key, value);
    } catch { /* storage not available - no problem */ }
    return '';
}

/** Status line at the bottom; warnings/errors additionally as a notice (toast). */
let statusTimer = null;
export function setStatus(msg, kind = 'info') {
    const el = $('#status');
    if (el) {
        el.textContent = msg; el.dataset.kind = kind;
        const bar = el.closest('.statusbar'); // on a phone the bar only shows up for a moment (CSS: [data-idle])
        bar?.removeAttribute('data-idle');
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => bar?.setAttribute('data-idle', ''), kind === 'info' ? 5000 : 9000);
    }
    if (kind === 'error' || kind === 'warn') toast(msg, { kind, timeout: kind === 'error' ? 8000 : 6000 });
}

// The clipboard clears again after the set time, or when the browser lets it (clipboard.js); the status line tells when that waits
const CLIP_NOTES = { pending: ['clipboard.pending', 'info'], failed: ['clipboard.failed', 'error'], cleared: ['clipboard.cleared', 'info'], kept: ['clipboard.kept', 'info'] };
const clipboard = clipboardGuard({
    clipboard: navigator.clipboard, permissions: navigator.permissions, activation: navigator.userActivation, win: window, doc: document,
    onState: (state, what) => {
        const [key, kind] = CLIP_NOTES[state];
        setStatus(t(key, { what }), kind);
        if (kind === 'info' && !$('#status')) toast(t(key, { what })); // locked: no status line, a notice instead
    }
});
export async function copy(text, label) {
    try {
        await clipboard.copy(text, label, ctx.settings.clipboard * 1000);
        setStatus(t('copied', { what: label, s: ctx.settings.clipboard }));
        toast(t('copied.short', { what: label }), { timeout: 1800 });
        return true;
    } catch {
        setStatus(t('copy.failed'), 'error');
        return false;
    }
}
/** Locking: what was copied leaves the clipboard now, or as soon as the browser lets the page. */
export const clearClipboard = () => clipboard.clear();

export function download(name, data, type = 'application/octet-stream') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Light/dark, density and (in Nextcloud) instance colour. The app's own choice wins; "like Nextcloud" follows the person. */
export function applyTheme() {
    const root = document.documentElement;
    const nc = ncThemeFrom(ctx.NC?.themes);
    const th = ctx.settings.theme === 'nextcloud' ? (ctx.NC ? nc.theme : 'auto') : ctx.settings.theme;
    if (th === 'light' || th === 'dark') root.dataset.theme = th; else delete root.dataset.theme;
    root.dataset.density = ctx.settings.compact ? 'compact' : 'comfortable';
    if (ctx.NC && nc.contrast) root.dataset.contrast = 'more'; else delete root.dataset.contrast;
    for (const name of THEME_VARS) root.style.removeProperty(name);
    const { vars, accent } = themeVars(ctx.NC?.color, { useAccent: ctx.settings.ncAccent, highContrast: !!(ctx.NC && nc.contrast) });
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v); // CSSOM: not covered by style-src (no style attribute in the markup)
    if (accent) root.dataset.accent = 'nc'; else delete root.dataset.accent;
}
