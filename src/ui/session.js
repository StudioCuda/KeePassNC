// Session: save, sync (interval/reconnect), lock, timers, offline app (service worker).
import { isOffline } from '../webdav.js';
import { ARGON2_WORKER_URL } from '../argon2.js';
import { t, errText } from '../i18n.js';
import { ctx, setStatus, download, SW_CACHE, SYNC_RETRY_MS, LOCK_WAIT_MS, params } from './ctx.js';
import { $, confirmDialog } from './dom.js';
import { setNcHeaderOffline } from './ncheader.js';
import { fmtDate } from '../i18n.js';

const { state } = ctx;
let autoSaveTimer = null, syncing = false, pulls = 0; // pulls: running saves that may pull (overlapping Ctrl+S)
// The server version no longer opens with this session's credentials: ask for the new ones (credentials-dialog.js)
const REMOTE_CREDS = new Set(['e.merge.pw', 'e.pull.pw']);

/** Call after every change to the vault: refresh the view, show the save state, schedule auto-save if needed. */
export function changed() {
    ctx.ui.refresh?.();
    refreshDirtyIndicator();
    scheduleAutoSave();
}

/** In "on every change" mode wait briefly (batching several clicks), then save. */
export function scheduleAutoSave() {
    if (state.source?.type !== 'dav' || ctx.settings.autosync !== 'change' || state.vault?.readOnly) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { if (state.vault?.dirty && !state.editing) doSave({ auto: true }); }, 800);
}

export function refreshDirtyIndicator() {
    const b = $('#save-btn');
    const v = state.vault;
    if (!b || !v) return;
    const pending = v.dirty || v.unsynced;
    const isDav = state.source?.type === 'dav';
    b.dataset.pending = pending ? '1' : '0';
    $('.label', b).textContent = v.dirty ? t('save.dirty') : v.unsynced ? t('save.upload') : t('save');
    b.disabled = isDav ? !pending : !v.dirty;
    refreshSyncState();
    refreshReadOnly();
}

/**
 * Banner (never goes away on its own) and the dimmed actions: a share that only allows reading, a server that refused to save, or a
 * server file that can't be merged with our changes. "Save a copy" is there whenever changes exist that live only in this tab.
 */
export function refreshReadOnly() {
    const v = state.vault;
    const ro = !!v?.readOnly;
    const pending = !!v && (v.dirty || v.unsynced);
    const blocked = !ro && !!v?.mergeBlocked && pending;
    document.body.classList.toggle('readonly', ro);
    const banner = $('#readonly-banner');
    if (!banner) return;
    banner.hidden = !(ro || blocked);
    if (banner.hidden) return;
    $('#ro-text', banner).textContent = t(blocked ? (v.mergeBlocked === 'etag' ? 'merge.banner.etag' : 'merge.banner') : pending ? 'ro.banner.dirty' : 'ro.banner');
    $('#ro-copy', banner).hidden = !pending;
}

/** From now on the session only reads. Changes made so far stay in memory (and can be saved as a copy). */
export function enterReadOnly() {
    const v = state.vault;
    if (!v || v.readOnly) return;
    v.readOnly = true;
    state.source.readOnly = true;
    clearTimeout(autoSaveTimer);
    refreshDirtyIndicator();
}

function refused() {
    enterReadOnly();
    setStatus(t('ro.refused'), 'warn');
}

/** The current state as a download of its own, next to the shared file that can't be written. */
export async function saveCopy() {
    const v = state.vault;
    if (!v) return;
    try {
        const name = state.source.name.replace(/\.kdbx$/i, '') + '-copy.kdbx';
        download(name, await v.copyBytes());
        setStatus(t('ro.copy.saved', { name }));
    } catch (e) {
        if (!e?.key) console.error(e);
        setStatus(t('save.failed', { msg: errText(e) }), 'error');
    }
}

export function refreshSyncState() {
    const el = $('#sync-state');
    const v = state.vault;
    if (!el || !v) return;
    let text = '', kind = '';
    if (state.source?.type === 'dav') {
        if (v.dirty) { text = t('sync.dirty'); kind = 'dirty'; }
        else if (v.unsynced) { text = state.offlineMode || state.lastSyncFailed ? t('sync.local') : t('sync.pending'); kind = 'unsynced'; }
        else if (state.offlineMode) { text = t('sync.offline'); kind = 'offline'; }
        else { text = t('sync.ok'); kind = 'synced'; }
    } else if (v.dirty) { text = t('sync.dirty'); kind = 'dirty'; }
    el.textContent = text;
    el.dataset.state = kind;
    if (state.source?.type === 'dav') setNcHeaderOffline(state.offlineMode || state.lastSyncFailed);
}

export function rebind() {
    // After the database was swapped (changes from other devices), selection references point to old objects: re-resolve them via UUID.
    const v = state.vault;
    const f = state.filter;
    if (f.group) { const g = v.db.getGroup(f.group.uuid); if (g) f.group = g; else state.filter = { type: 'all' }; }
    const eid = state.selEntry?.uuid;
    state.selEntry = null;
    if (eid) for (const e of v.root.allEntries()) if (e.uuid.equals(eid)) { state.selEntry = e; break; }
    const ids = new Set([...state.marked].map((e) => e.uuid.id));
    state.marked.clear();
    if (ids.size) for (const e of v.root.allEntries()) if (ids.has(e.uuid.id)) state.marked.add(e);
}

/** The database was replaced or merged with the server's: the views must point at its objects, not the old ones. */
function redrawAfterSwap() {
    rebind();
    ctx.ui.refresh?.();
}

/** Is a sync running that may replace the database (pull)? Then no editor may open: it would keep the old entry and group objects. */
export const isSwapping = () => syncing || pulls > 0;

export async function doSave({ auto = false } = {}) {
    const v = state.vault;
    if (!v) return;
    if (auto && v.mergeBlocked) return; // the server file can't be merged: only an explicit save tries again
    // Read-only: nothing goes to the server, Ctrl+S / the button hand out a copy instead (not on its own in the auto-lock)
    if (v.readOnly && (v.dirty || v.unsynced)) { if (!auto) await saveCopy(); return; }
    // Ctrl+S and the palette don't look at the button state. A local file has nothing to hand out without changes (no empty
    // download), and a pull or a merge would swap the database under an open editor and drop what was typed there (syncNow keeps out of it, too).
    if (!v.dirty && state.source.type === 'file') { setStatus(t('save.nothing')); return; }
    if (state.editing && !auto) { setStatus(t('save.editing')); return; }
    const btn = $('#save-btn');
    if (btn) btn.disabled = true;
    const statusEl = $('#status');
    const before = statusEl && [statusEl.textContent, statusEl.dataset.kind];
    const busyText = auto ? t('saving.auto') : t('saving');
    setStatus(busyText);
    const mayPull = !v.dirty; // without changes of our own, sync() may pull and swap the database
    if (mayPull) pulls++;
    try {
        const res = await (v.dirty ? v.save({ auto }) : v.sync({ background: auto }));
        if (res.skipped) { // queued behind a save that failed to merge: nothing happened, the status stays as it was
            if (before && statusEl.textContent === busyText) { statusEl.textContent = before[0]; statusEl.dataset.kind = before[1]; } // not over the outcome of that save
            return;
        }
        state.lastSyncFailed = !!res.offline;
        if (state.source.type === 'file') {
            download(state.source.name, res.bytes);
            setStatus(t('saved.download', { name: state.source.name }));
        } else if (res.offline) {
            setStatus(t('saved.offline'), 'warn');
        } else if (res.pulled) {
            // Changes from another device: the selection and the open views still point at the objects of the old database
            redrawAfterSwap();
            state.offlineMode = false;
            setStatus(t('sync.pulled'));
        } else if (res.merged) {
            redrawAfterSwap();
            setStatus(t(res.noBackup ? 'saved.merged.nobackup' : 'saved.merged'), 'warn');
            state.offlineMode = false;
        } else {
            state.offlineMode = false;
            if (res.noBackup) setStatus(t('saved.nobackup'), 'warn'); else setStatus(t('saved'));
        }
    } catch (e) {
        if (!e?.key) console.error(e); // explained errors (with translation) show in the status, only unexpected ones go to the console
        state.lastSyncFailed = isOffline(e);
        if (e?.key === 'e.dav.readonly') refused(); // the server says no: keep the changes, stop trying
        else setStatus(t('save.failed', { msg: errText(e) }), 'error');
        if (REMOTE_CREDS.has(e?.key)) ctx.ui.askRemoteCredentials?.();
    } finally {
        if (mayPull) pulls--;
        refreshDirtyIndicator();
    }
}

/** Background sync (interval, reconnect, tab visible): pushes local changes up or pulls changes from others. */
export async function syncNow({ announce = false } = {}) {
    const v = state.vault;
    if (!v || state.source?.type !== 'dav' || syncing || state.editing || state.softLocked || (v.mergeBlocked && !announce) || (v.readOnly && (v.dirty || v.unsynced))) return;
    syncing = true;
    $('#sync-state')?.classList.add('busy');
    try {
        const res = await (v.dirty ? v.save() : v.sync({ background: !announce }));
        state.lastSyncFailed = !!res.offline;
        if (res.offline) {
            if (announce) setStatus(t('sync.failed.offline'), 'warn');
        } else {
            const wasOffline = state.offlineMode;
            state.offlineMode = false;
            if (res.pulled) { redrawAfterSwap(); setStatus(t('sync.pulled')); }
            else if (res.merged) { redrawAfterSwap(); setStatus(t(res.noBackup ? 'saved.merged.nobackup' : 'sync.merged'), 'warn'); }
            else if (res.noBackup) setStatus(t('saved.nobackup'), 'warn');
            else if (wasOffline || announce) setStatus(t('sync.done'));
        }
    } catch (e) {
        if (!e?.key) console.error(e); // explained errors (with translation) show in the status, only unexpected ones go to the console
        state.lastSyncFailed = isOffline(e);
        if (e?.key === 'e.dav.readonly') refused();
        else if (announce || !isOffline(e)) setStatus(t('sync.failed', { msg: errText(e) }), 'error');
        if (REMOTE_CREDS.has(e?.key)) ctx.ui.askRemoteCredentials?.();
    } finally {
        syncing = false;
        $('#sync-state')?.classList.remove('busy');
        refreshDirtyIndicator();
    }
}

/** "Unsaved changes will be lost. Lock anyway?" */
export function confirmDiscard() {
    return confirmDialog({ title: t('lock'), message: t('lock.unsaved'), confirmLabel: t('lock.anyway'), cancelLabel: t('cancel'), danger: true });
}

let locking = null;

/** Did the saves and syncs started so far end within ms? */
async function settledWithin(vault, ms) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
    try { return await Promise.race([vault.settled().then(() => true), timeout]); } finally { clearTimeout(timer); }
}

/** The idle timer asks every second: while a lock is under way (waiting for a save, a dialog) the later calls join it. */
export function lock(message) {
    return locking ||= doLock(message).finally(() => { locking = null; });
}

async function doLock(message) {
    const auto = state.autoLockRequest === true;
    // A save or sync in flight has already cleared the dirty flag: wait for its outcome, it decides what is still unsaved.
    // A request that never answers must not keep the entries on screen: after LOCK_WAIT_MS we treat the changes as unsaved.
    const stuck = state.vault ? !(await settledWithin(state.vault, LOCK_WAIT_MS)) : false;
    const v = state.vault;
    if (v && (v.dirty || v.unsynced || stuck) && state.source.type === 'dav') {
        // WebDAV: save first. Locally saved (offline) versions may stay, unlocking transfers them later.
        if (v.dirty && !stuck) await doSave({ auto: true });
        if (stuck || state.vault?.dirty) {
            if (auto) { softLock(message); return; }
            if (!(await confirmDiscard())) return;
        }
    } else if (v?.dirty || stuck) {
        if (auto) { softLock(message); return; }
        if (!(await confirmDiscard())) return;
    }
    clearTimeout(autoSaveTimer);
    ctx.ui.showLogin(message ?? t('locked'));
}

/**
 * Auto-lock with changes that couldn't be saved (local file, or the server isn't there): locking for real would throw them away.
 * The view goes, the database stays in memory until the master password comes back (softlock.js).
 */
function softLock(message) {
    clearTimeout(autoSaveTimer);
    state.softLocked = true;
    ctx.ui.showSoftLock(message ?? t('locked'));
    lockOnceSaved(state.vault, message);
}

/**
 * A save that was still running when the soft lock came up may end well after all: then nothing is unsaved anymore, the note
 * on the lock screen is wrong, and the entries would stay decrypted for no reason. Once the last save or sync is over and
 * nothing is dirty or unsynced, the soft lock becomes the real one.
 */
async function lockOnceSaved(v, message) {
    let chain;
    do { chain = v.settled(); await chain; } while (chain !== v.settled()); // a save queued meanwhile counts, too
    if (!state.softLocked || state.vault !== v || v.dirty || v.unsynced) return;
    clearTimeout(autoSaveTimer);
    ctx.ui.showLogin(message ?? t('locked'));
}

/** The idle timer and the hidden tab lock without asking: with changes that can't be saved that means the soft lock (doLock). */
function autoLock(message) {
    state.autoLockRequest = true;
    lock(message).finally(() => { state.autoLockRequest = false; });
}

export function startTimers() {
    stopTimers();
    state.idleTimer = setInterval(() => {
        if (!state.vault || state.softLocked) return;
        if (Date.now() - state.lastActivity > ctx.settings.autolockSeconds * 1000) autoLock(t('locked.auto'));
        else if (ctx.settings.lockOnHide && document.hidden && state.hiddenSince && Date.now() - state.hiddenSince > 60000) autoLock(t('locked.hidden'));
    }, 1000);
    if (state.source?.type === 'dav') {
        state.retryTimer = setInterval(() => { if (state.vault?.unsynced) syncNow(); }, SYNC_RETRY_MS);
        const minutes = parseInt(ctx.settings.autosync, 10);
        if (minutes > 0) state.syncTimer = setInterval(() => syncNow(), params.has('syncinterval') ? parseFloat(params.get('syncinterval')) * 1000 : minutes * 60000);
    }
}
export function stopTimers() {
    for (const k of ['idleTimer', 'retryTimer', 'syncTimer']) { clearInterval(state[k]); state[k] = null; }
}

export function installGlobalListeners() {
    // Every change goes through the Vault, which refuses it in a read-only session. Whatever button or shortcut tried it, say why nothing happened.
    const readOnlyNote = (ev) => { const err = ev.reason ?? ev.error; if (err?.key === 'e.dav.readonly') { ev.preventDefault(); setStatus(errText(err), 'warn'); } };
    addEventListener('unhandledrejection', readOnlyNote);
    addEventListener('error', readOnlyNote);
    for (const ev of ['mousemove', 'keydown', 'click', 'touchstart']) addEventListener(ev, () => { state.lastActivity = Date.now(); }, { passive: true });
    addEventListener('beforeunload', (e) => { if (state.vault?.dirty) { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('online', () => { if (state.vault?.unsynced || state.offlineMode) syncNow({ announce: true }); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { state.hiddenSince = Date.now(); return; }
        state.hiddenSince = 0;
        if (state.vault && ctx.settings.autosync !== 'off') syncNow();
    });
}

// ---------------------------------------------------------------- Keep the app page available offline (service worker)
export async function ensureOfflineApp() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
        if (!ctx.settings.offline) {
            for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
            if (typeof caches !== 'undefined') await caches.delete(SW_CACHE);
            return;
        }
        const swUrl = ctx.NC ? ctx.NC.swUrl : 'sw.js';
        if (!swUrl) return;
        await navigator.serviceWorker.register(swUrl);
        await navigator.serviceWorker.ready;
        const cache = await caches.open(SW_CACHE);
        const shell = location.origin + location.pathname;
        const assets = [...document.querySelectorAll('script[src], link[rel=stylesheet][href]')].map((n) => n.src || n.href);
        const wanted = new Set([shell, ...assets, ...(ARGON2_WORKER_URL ? [ARGON2_WORKER_URL] : [])]); // the worker isn't in the DOM
        // Like cache.add(), but without its console error when the server is returning 503 (maintenance mode).
        const refresh = async (u) => {
            try {
                const res = await fetch(new Request(u, { cache: 'reload', credentials: 'same-origin' }));
                if (res.ok) await cache.put(u, res);
            } catch { /* server unreachable: old version stays */ }
        };
        await Promise.all([...wanted].map(refresh));
        for (const k of await cache.keys()) if (!wanted.has(k.url)) await cache.delete(k); // remove old versions
        document.documentElement.dataset.offlineReady = '1';
    } catch (e) {
        console.warn('Offline app unavailable', e);
    }
}
export { fmtDate };
