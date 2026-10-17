// Sitzung: Speichern, Abgleichen (Intervall/Wiederverbinden), Sperren, Zeitgeber, Offline-App (Service Worker).
import { isOffline } from '../webdav.js';
import { t, errText } from '../i18n.js';
import { ctx, setStatus, download, SW_CACHE, SYNC_RETRY_MS, params } from './ctx.js';
import { $, confirmDialog } from './dom.js';
import { setNcHeaderOffline } from './ncheader.js';
import { fmtDate } from '../i18n.js';

const { state } = ctx;
let autoSaveTimer = null, syncing = false;

/** Nach jeder Aenderung am Tresor aufrufen: Ansicht aktualisieren, Speicherzustand anzeigen, ggf. Auto-Speichern planen. */
export function changed() {
    ctx.ui.refresh?.();
    refreshDirtyIndicator();
    scheduleAutoSave();
}

/** Im Modus "Bei jeder Aenderung" kurz warten (mehrere Klicks zusammenfassen), dann speichern. */
export function scheduleAutoSave() {
    if (state.source?.type !== 'dav' || ctx.settings.autosync !== 'change') return;
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

function rebind() {
    // Nach einem Austausch der Datenbank (Aenderungen anderer Geraete) zeigen Auswahl-Verweise auf alte Objekte: ueber UUID neu aufloesen.
    const v = state.vault;
    const f = state.filter;
    if (f.group) { const g = v.db.getGroup(f.group.uuid); if (g) f.group = g; else state.filter = { type: 'all' }; }
    const eid = state.selEntry?.uuid;
    state.selEntry = null;
    if (eid) for (const e of v.root.allEntries()) if (e.uuid.equals(eid)) { state.selEntry = e; break; }
}

export async function doSave({ auto = false } = {}) {
    const v = state.vault;
    if (!v) return;
    const btn = $('#save-btn');
    if (btn) btn.disabled = true;
    setStatus(auto ? t('saving.auto') : t('saving'));
    try {
        const res = await (v.dirty ? v.save() : v.sync());
        state.lastSyncFailed = !!res.offline;
        if (state.source.type === 'file') {
            download(state.source.name, res.bytes);
            setStatus(t('saved.download', { name: state.source.name }));
        } else if (res.offline) {
            setStatus(t('saved.offline'), 'warn');
        } else if (res.merged) {
            rebind(); ctx.ui.refresh?.();
            setStatus(t(res.noBackup ? 'saved.merged.nobackup' : 'saved.merged'), 'warn');
            state.offlineMode = false;
        } else {
            state.offlineMode = false;
            if (res.noBackup) setStatus(t('saved.nobackup'), 'warn'); else setStatus(t('saved'));
        }
    } catch (e) {
        if (!e?.key) console.error(e); // erklaerte Fehler (mit Uebersetzung) stehen im Status, nur Unerwartetes in die Konsole
        state.lastSyncFailed = isOffline(e);
        setStatus(t('save.failed', { msg: errText(e) }), 'error');
    } finally {
        refreshDirtyIndicator();
    }
}

/** Hintergrund-Abgleich (Intervall, Wiederverbinden, Tab sichtbar): schiebt Lokales hoch oder holt Fremdaenderungen. */
export async function syncNow({ announce = false } = {}) {
    const v = state.vault;
    if (!v || state.source?.type !== 'dav' || syncing || state.editing) return;
    syncing = true;
    $('#sync-state')?.classList.add('busy');
    try {
        const res = await (v.dirty ? v.save() : v.sync());
        state.lastSyncFailed = !!res.offline;
        if (res.offline) {
            if (announce) setStatus(t('sync.failed.offline'), 'warn');
        } else {
            const wasOffline = state.offlineMode;
            state.offlineMode = false;
            if (res.pulled) { rebind(); ctx.ui.refresh?.(); setStatus(t('sync.pulled')); }
            else if (res.merged) { rebind(); ctx.ui.refresh?.(); setStatus(t(res.noBackup ? 'saved.merged.nobackup' : 'sync.merged'), 'warn'); }
            else if (res.noBackup) setStatus(t('saved.nobackup'), 'warn');
            else if (wasOffline || announce) setStatus(t('sync.done'));
        }
    } catch (e) {
        if (!e?.key) console.error(e); // erklaerte Fehler (mit Uebersetzung) stehen im Status, nur Unerwartetes in die Konsole
        state.lastSyncFailed = isOffline(e);
        if (announce || !isOffline(e)) setStatus(t('sync.failed', { msg: errText(e) }), 'error');
    } finally {
        syncing = false;
        $('#sync-state')?.classList.remove('busy');
        refreshDirtyIndicator();
    }
}

export async function lock(message) {
    const auto = state.autoLockRequest === true;
    const v = state.vault;
    if (v && (v.dirty || v.unsynced) && state.source.type === 'dav') {
        // WebDAV: erst sichern. Lokal gesicherte (offline) Staende duerfen bleiben, das Entsperren uebertraegt sie spaeter.
        if (v.dirty) await doSave({ auto: true });
        if (state.vault?.dirty) {
            if (auto) { setStatus(t('lock.blocked'), 'warn'); return; }
            if (!(await confirmDialog({ title: t('lock'), message: t('lock.unsaved'), confirmLabel: t('lock.anyway'), cancelLabel: t('cancel'), danger: true }))) return;
        }
    } else if (v?.dirty) {
        if (auto) { setStatus(t('lock.blocked'), 'warn'); return; }
        if (!(await confirmDialog({ title: t('lock'), message: t('lock.unsaved'), confirmLabel: t('lock.anyway'), cancelLabel: t('cancel'), danger: true }))) return;
    }
    clearTimeout(autoSaveTimer);
    ctx.ui.showLogin(message ?? t('locked'));
}

export function startTimers() {
    stopTimers();
    state.idleTimer = setInterval(() => {
        if (!state.vault) return;
        if (Date.now() - state.lastActivity > ctx.settings.autolockSeconds * 1000) { state.autoLockRequest = true; lock(t('locked.auto')).finally(() => { state.autoLockRequest = false; }); }
        else if (ctx.settings.lockOnHide && document.hidden && state.hiddenSince && Date.now() - state.hiddenSince > 60000) { state.autoLockRequest = true; lock(t('locked.hidden')).finally(() => { state.autoLockRequest = false; }); }
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
    for (const ev of ['mousemove', 'keydown', 'click', 'touchstart']) addEventListener(ev, () => { state.lastActivity = Date.now(); }, { passive: true });
    addEventListener('beforeunload', (e) => { if (state.vault?.dirty) { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('online', () => { if (state.vault?.unsynced || state.offlineMode) syncNow({ announce: true }); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { state.hiddenSince = Date.now(); return; }
        state.hiddenSince = 0;
        if (state.vault && ctx.settings.autosync !== 'off') syncNow();
    });
}

// ---------------------------------------------------------------- App-Seite offline vorhalten (Service Worker)
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
        const wanted = new Set([shell, ...assets]);
        // Wie cache.add(), nur ohne dessen Konsolenfehler, wenn der Server gerade 503 liefert (Wartungsmodus).
        const refresh = async (u) => {
            try {
                const res = await fetch(new Request(u, { cache: 'reload', credentials: 'same-origin' }));
                if (res.ok) await cache.put(u, res);
            } catch { /* Server nicht erreichbar: alter Stand bleibt */ }
        };
        await Promise.all([...wanted].map(refresh));
        for (const k of await cache.keys()) if (!wanted.has(k.url)) await cache.delete(k); // alte Versionen entfernen
        document.documentElement.dataset.offlineReady = '1';
    } catch (e) {
        console.warn('Offline-App nicht verfuegbar', e);
    }
}
export { fmtDate };
