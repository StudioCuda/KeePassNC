// Ordner oder Datenbank in der eigenen Nextcloud waehlen: Brotkrumen, Unterordner, Dateien. Zwei Arten:
// - 'folder' (neue Datenbank): "Neuer Ordner", "Hier speichern"; .kdbx-Dateien stehen ausgegraut dabei, damit man sieht, was da ist.
// - 'file' (Anmeldung, [Durchsuchen]): .kdbx-Dateien waehlbar (Klick markiert, Doppelklick/Enter oeffnet), "Oeffnen" liefert den Pfad.
// Liest ueber WebDAV (DavFile.list), nicht ueber den Datei-Picker von Nextcloud: der braucht Vue und die Core-Skripte, die diese
// Seite wegen der strengen CSP bewusst nicht laedt.
import { DavFile } from '../webdav.js';
import { davUrlFor } from '../nextcloud.js';
import { t, errText } from '../i18n.js';
import { h, icon, modal, promptDialog } from './dom.js';

/** Anzeigename eines Ordners: "Alle Dateien" bzw. "Dokumente › Privat". */
export const folderLabel = (folder) => (folder === '/' ? t('folder.root') : folder.split('/').filter(Boolean).join(' › '));
export const joinPath = (folder, name) => (folder === '/' ? '' : folder) + '/' + name;
/** "/A/B/x.kdbx" -> { folder: "/A/B", name: "x.kdbx" }; "/x.kdbx" -> { folder: "/", ... }. */
export const splitPath = (p) => { const i = p.lastIndexOf('/'); return { folder: p.slice(0, i) || '/', name: p.slice(i + 1) }; };

/**
 * mode 'folder': liefert den gewaehlten Ordner ("/" oder "/A/B"); mode 'file': den Pfad der gewaehlten .kdbx-Datei ("/A/x.kdbx"),
 * select markiert eine Datei im Startordner vor. Abgebrochen: null.
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
            list.replaceChildren(h('p', { class: 'hint', text: t('folder.loading') }));
            let entries;
            try { entries = await new DavFile({ url: davUrlFor(NC, folder), auth }).list(); }
            catch (e) {
                if (my !== seq) return;
                if (e?.status === 404 && folder !== '/') return load('/'); // vorgeschlagener Ordner gibt es nicht (mehr)
                list.replaceChildren(); error.textContent = errText(e); return;
            }
            if (my !== seq) return; // inzwischen woanders hingeklickt
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
                    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); m.close(joinPath(cur, f.name)); } } }) // Leertaste markiert nur
                : item(f.name, 'file', { disabled: true }));
            const items = [...dirs.map((d) => item(d.name, 'folder', { onclick: () => load(joinPath(folder, d.name)) })), ...dbs.map(fileItem)];
            list.replaceChildren(...(items.length ? items : [h('p', { class: 'hint', text: t(fileMode ? 'folder.empty.file' : 'folder.empty') })]));
            if (fileMode && select && folder === start && dbs.some((f) => f.name === select)) {
                choose(select);
                list.querySelector('.file-item[aria-pressed="true"]')?.focus();
            }
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
