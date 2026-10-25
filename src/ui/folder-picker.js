// Pick a folder or database in your own Nextcloud: breadcrumbs, subfolders, files. Two kinds:
// - 'folder' (new database): "New folder", "Save here"; .kdbx files are shown greyed out so you can see what is there.
// - 'file' (login, [Browse]): .kdbx files are selectable (click selects, double click/Enter opens), "Open" returns the path.
// Reads via WebDAV (DavFile.list), not via Nextcloud's file picker: that needs Vue and the core scripts, which this
// page deliberately doesn't load because of the strict CSP.
import { DavFile } from '../webdav.js';
import { davUrlFor } from '../nextcloud.js';
import { t, errText } from '../i18n.js';
import { h, icon, modal, promptDialog } from './dom.js';

/** Display name of a folder: "All files" or "Documents › Private". */
export const folderLabel = (folder) => (folder === '/' ? t('folder.root') : folder.split('/').filter(Boolean).join(' › '));
export const joinPath = (folder, name) => (folder === '/' ? '' : folder) + '/' + name;
/** "/A/B/x.kdbx" -> { folder: "/A/B", name: "x.kdbx" }; "/x.kdbx" -> { folder: "/", ... }. */
export const splitPath = (p) => { const i = p.lastIndexOf('/'); return { folder: p.slice(0, i) || '/', name: p.slice(i + 1) }; };

// Last listing per folder in sessionStorage (names only, gone with the tab): the dialog shows it at once while the server answers,
// which on a slow Nextcloud or a mobile connection can take seconds.
const CACHE = 'kpnc-dirs:';
function readCache(url) {
    try {
        const v = JSON.parse(sessionStorage.getItem(CACHE + url));
        return Array.isArray(v) ? v.map((x) => ({ name: String(x.name), dir: !!x.dir, modified: new Date(x.modified) })) : null;
    } catch { return null; }
}
function writeCache(url, entries) {
    try { sessionStorage.setItem(CACHE + url, JSON.stringify(entries.map((x) => ({ name: x.name, dir: x.dir, modified: x.modified.getTime() || 0 })))); } catch { /* full or blocked: fine */ }
}

/**
 * mode 'folder': returns the chosen folder ("/" or "/A/B"); mode 'file': the path of the chosen .kdbx file ("/A/x.kdbx"),
 * select preselects a file in the start folder. Cancelled: null.
 */
export function pickFolder({ NC, auth, start = '/', mode = 'folder', select = '' }) {
    const fileMode = mode === 'file';
    return new Promise((resolve) => {
        let cur = start, seq = 0, chosen = '';
        const crumbs = h('nav', { class: 'crumbs folder-crumbs', id: 'folder-crumbs', 'aria-label': t('folder.where') });
        const list = h('div', { class: 'folder-list', id: 'folder-list', role: 'list' });
        const error = h('p', { class: 'error', id: 'folder-error', role: 'alert' });
        const item = (name, ic, extra) => h('button', { type: 'button', class: 'menu-item folder-item', role: 'listitem', 'data-name': name, ...extra }, icon(ic), h('span', { class: 'grow', text: name }));
        const choose = (name) => {
            chosen = name;
            for (const b of list.querySelectorAll('.folder-item.file-item')) b.setAttribute('aria-pressed', String(b.dataset.name === name));
            ok.disabled = fileMode && !chosen;
        };

        async function load(folder) {
            const my = ++seq;
            error.textContent = '';
            choose('');
            const url = davUrlFor(NC, folder);
            const cached = readCache(url);
            if (cached) show(folder, cached); // last known contents right away, the fresh listing replaces them
            else list.replaceChildren(h('p', { class: 'hint', text: t('folder.loading') }));
            let entries;
            try { entries = await new DavFile({ url, auth }).list(); }
            catch (e) {
                if (my !== seq) return;
                if (e?.status === 404 && folder !== '/') return load('/'); // the suggested folder does not exist (any more)
                list.replaceChildren(); error.textContent = errText(e); return;
            }
            if (my !== seq) return; // clicked somewhere else in the meantime
            writeCache(url, entries);
            show(folder, entries);
        }

        function show(folder, entries) {
            const keep = chosen;
            const focused = list.contains(document.activeElement) ? document.activeElement.dataset.name : null; // the refresh must not drop it
            cur = folder;
            const parts = folder.split('/').filter(Boolean);
            crumbs.replaceChildren(...[t('folder.root'), ...parts].flatMap((name, i) => {
                const path = '/' + parts.slice(0, i).join('/');
                const last = i === parts.length;
                const b = h('button', { type: 'button', class: 'link', text: name, disabled: last, 'aria-current': last ? 'location' : null, onclick: () => load(path) });
                return i ? [h('span', { class: 'muted', text: '›' }), b] : [b];
            }));
            const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            const dirs = entries.filter((x) => x.dir && !x.name.startsWith('.')).sort(byName);
            const dbs = entries.filter((x) => !x.dir && /\.kdbx$/i.test(x.name)).sort(byName);
            const fileItem = (f) => (fileMode
                ? item(f.name, 'file', { class: 'menu-item folder-item file-item', 'aria-pressed': 'false', onclick: () => choose(f.name),
                    ondblclick: () => m.close(joinPath(cur, f.name)),
                    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); m.close(joinPath(cur, f.name)); } } }) // space only selects
                : item(f.name, 'file', { disabled: true }));
            const items = [...dirs.map((d) => item(d.name, 'folder', { onclick: () => load(joinPath(folder, d.name)) })), ...dbs.map(fileItem)];
            list.replaceChildren(...(items.length ? items : [h('p', { class: 'hint', text: t(fileMode ? 'folder.empty.file' : 'folder.empty') })]));
            if (keep && dbs.some((f) => f.name === keep)) choose(keep); // a selection made in the cached list survives the refresh
            else if (fileMode && select && folder === start && dbs.some((f) => f.name === select)) {
                choose(select);
                list.querySelector('.file-item[aria-pressed="true"]')?.focus();
            }
            if (focused) [...list.querySelectorAll('.folder-item')].find((b) => b.dataset.name === focused)?.focus(); // keyboard focus survives the refresh
        }

        let newBtn = null;
        if (!fileMode) {
            newBtn = h('button', { type: 'button', id: 'folder-new', class: 'btn' }, icon('plus'), h('span', { text: t('folder.new') }));
            newBtn.addEventListener('click', async () => {
                const name = (await promptDialog({ title: t('folder.new'), label: t('folder.new.name'), confirmLabel: t('create'), cancelLabel: t('cancel') }))?.trim();
                if (!name) return;
                if (/[/\\]/.test(name) || name === '.' || name === '..') { error.textContent = t('folder.new.bad'); return; }
                try { await new DavFile({ url: davUrlFor(NC, joinPath(cur, name)), auth }).mkdir(); await load(joinPath(cur, name)); }
                catch (e) { error.textContent = errText(e); }
            });
        }
        const ok = h('button', { type: 'button', class: 'primary', id: 'folder-ok', text: t(fileMode ? 'folder.open' : 'folder.ok'),
            onclick: () => { if (!fileMode) m.close(cur); else if (chosen) m.close(joinPath(cur, chosen)); } });
        const cancel = h('button', { type: 'button', id: 'folder-cancel', text: t('cancel'), onclick: () => m.close(null) });
        const m = modal({ title: t(fileMode ? 'folder.title.file' : 'folder.title'), body: h('div', { class: 'stack', id: 'folder-picker' }, crumbs, list, error),
            actions: [h('span', { class: 'grow' }, newBtn), cancel, ok], size: 'md', onClose: (r) => resolve(typeof r === 'string' ? r : null) });
        load(start);
    });
}
