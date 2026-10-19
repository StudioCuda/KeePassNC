// Seitenleiste: Bibliotheks-Filter, Gruppenbaum (auf-/zuklappen, Kontextmenue, Drag&Drop), Tags, Papierkorb.
import { VaultError } from '../vault.js';
import { t, errText } from '../i18n.js';
import { ctx, setStatus } from './ctx.js';
import { h, append, icon, iconBtn, popupMenu, modal, promptDialog, confirmDialog, toast } from './dom.js';
import { allRealEntries, isWeak, groupIcon } from './common.js';
import { hasTotp, isPasskey, entryExpiry, daysUntil, fieldOf } from '../core/util.js';
import { changed, refreshDirtyIndicator } from './session.js';
import { iconSelOf, iconPreview, pickIcon, commitIconSel } from './icon-picker.js';
import { openReports } from './reports.js';
import { openGenerator } from './generator-dialog.js';
import { openSettings } from './settings-dialog.js';

const { state } = ctx;
let dragging = null; // {kind: 'entry'|'group', item}

export function startEntryDrag(ev, entry) {
    dragging = { kind: 'entry', item: entry };
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', fieldOf(entry, 'Title'));
    document.body.classList.add('dragging');
    ev.target.addEventListener('dragend', () => { dragging = null; document.body.classList.remove('dragging'); }, { once: true });
}

/** refresh: false, wenn gleich danach ohnehin neu gezeichnet wird (z. B. changed()). */
export function setFilter(f, { refresh = true } = {}) {
    state.filter = f;
    state.query = '';
    const s = document.getElementById('search');
    if (s) s.value = '';
    state.view = 'list';
    if (refresh) ctx.ui.refresh();
}

/** <select> mit allen Gruppen (eingerueckt); exclude: Gruppe samt Nachkommen ausblenden. */
export function groupSelect({ value, exclude, includeRoot = true, id }) {
    const v = state.vault;
    const sel = h('select', { id });
    for (const { group, depth } of v.allGroups()) {
        if (group === v.recycleBin || v.isInRecycleBin(group)) continue;
        if (group === v.root && !includeRoot) continue;
        if (exclude) { let bad = false; for (let g = group; g; g = g.parentGroup) if (g === exclude) bad = true; if (bad) continue; }
        const opt = h('option', { value: group.uuid.id, text: ' '.repeat(Math.max(0, depth - 1)) + (group === v.root ? t('group.root') : group.name || t('group.unnamed')) });
        if (group === value) opt.selected = true;
        sel.append(opt);
    }
    return sel;
}
export const selectedGroup = (sel) => state.vault.allGroups().map((x) => x.group).find((g) => g.uuid.id === sel.value);

export async function newGroup(parent) {
    const v = state.vault;
    const name = await promptDialog({ title: t('group.new'), label: t('group.name'), confirmLabel: t('create'), cancelLabel: t('cancel') });
    if (name === null) return;
    const g = v.createGroup(parent || v.root, name || t('group.new.default'));
    state.collapsed.delete(parent?.uuid.id);
    state.filter = { type: 'group', group: g };
    changed();
}

export async function editGroup(g) {
    const v = state.vault;
    const name = h('input', { id: 'g-name', value: g.name || '', autocomplete: 'off' });
    const notes = h('textarea', { id: 'g-notes', rows: 3 }); notes.value = g.notes || '';
    const ok = h('button', { type: 'submit', class: 'primary', id: 'g-ok', text: t('apply') });
    let iconSel = iconSelOf(g, 'group');
    const iconEl = h('button', { type: 'button', class: 'icon-pick group', id: 'g-icon', title: t('icon.change'), 'aria-label': t('icon.change'), onclick: async () => {
        const sel = await pickIcon({ kind: 'group', sel: iconSel, onRemoved: () => { ctx.ui.renderSidebar(); ctx.ui.renderList(); refreshDirtyIndicator(); } });
        if (sel) { iconSel = sel; iconEl.replaceChildren(iconPreview(iconSel, 'group')); }
    } }, iconPreview(iconSel, 'group'));
    // Wie "Symbol anwenden auf ..." in KeePassXC
    const scope = h('select', { id: 'g-icon-scope' }, ['self', 'groups', 'entries', 'all'].map((k) => h('option', { value: k, text: t('icon.scope.' + k) })));
    const m = modal({ title: t('group.edit'), size: 'sm', body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); v.updateGroup(g, { name: name.value, notes: notes.value, ...commitIconSel(iconSel), iconScope: scope.value }); m.close(); changed(); } },
        h('div', { class: 'title-row' }, iconEl, h('label', { class: 'grow' }, h('span', { text: t('group.name') }), name)),
        h('label', {}, h('span', { text: t('icon.scope') }), scope),
        h('label', {}, h('span', { text: t('notes') }), notes),
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), ok)) });
}

export function moveGroupDialog(g) {
    const v = state.vault;
    const sel = groupSelect({ value: g.parentGroup, exclude: g });
    const m = modal({ title: t('group.move'), size: 'sm', body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); const target = v.allGroups().map((x) => x.group).find((x) => x.uuid.id === sel.value); if (v.moveGroup(g, target)) { m.close(); changed(); } else toast(t('group.move.invalid'), { kind: 'warn' }); } },
        h('label', {}, h('span', { text: t('group.move.to') }), sel), h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), h('button', { type: 'submit', class: 'primary', text: t('move') }))) });
}

export async function deleteGroup(g) {
    const v = state.vault;
    const inBin = v.deletesForever(g);
    const n = [...g.allEntries()].length;
    const ok = await confirmDialog({ title: inBin ? t('delete.forever') : t('group.delete'), message: inBin ? t('group.delete.forever.msg', { name: g.name, n }) : t('group.delete.msg', { name: g.name, n }), confirmLabel: inBin ? t('delete.forever') : t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!ok) return;
    try { v.removeGroup(g); } catch (e) { if (e instanceof VaultError) { setStatus(errText(e), 'error'); return; } throw e; }
    if (state.filter.group === g) state.filter = { type: 'all' };
    state.selEntry = null;
    changed();
}

export async function emptyBin() {
    const v = state.vault;
    const n = v.recycleBin ? [...v.recycleBin.allEntries()].length : 0;
    if (!n) { toast(t('bin.empty.already')); return; }
    if (!(await confirmDialog({ title: t('bin.empty'), message: t('bin.empty.msg', { n }), confirmLabel: t('bin.empty'), cancelLabel: t('cancel'), danger: true }))) return;
    v.emptyRecycleBin();
    state.selEntry = null;
    changed();
}

function groupMenu(anchor, g, pt) {
    const v = state.vault;
    const isBin = g === v.recycleBin;
    const items = isBin
        ? [{ label: t('bin.empty'), icon: 'broom', onclick: emptyBin }]
        : [{ label: t('group.new.sub'), icon: 'plus', onclick: () => newGroup(g) },
            { label: t('group.edit'), icon: 'edit', onclick: () => editGroup(g) },
            { label: t('group.move'), icon: 'moveTo', onclick: () => moveGroupDialog(g), disabled: g === v.root },
            'sep',
            { label: v.isInRecycleBin(g) ? t('delete.forever') : t('delete'), icon: 'trash', danger: true, onclick: () => deleteGroup(g) }];
    popupMenu(anchor, items, pt ? { x: pt.x, y: pt.y } : { align: 'end' });
}

function navItem(id, ic, label, count, f, active) {
    return h('button', { type: 'button', class: 'nav-item' + (active ? ' active' : ''), id: 'nav-' + id, onclick: () => setFilter(f) },
        icon(ic), h('span', { class: 'grow', text: label }), count !== undefined ? h('span', { class: 'count', text: String(count) }) : null);
}

export function renderSidebar(host) {
    const v = state.vault;
    const f = state.filter;
    const entries = allRealEntries();
    const exp = entries.filter((e) => { const x = entryExpiry(e); return x && daysUntil(x) <= 30; }).length;
    const lib = h('div', { class: 'nav-section' }, navItem('all', 'list', t('nav.all'), entries.length, { type: 'all' }, f.type === 'all' && !state.query));
    // Filter unter Gruppen und Tags: die Gruppen sind der Hauptweg, die Filter ein Nebenweg (auch ueber "Datenbank" und Strg+K erreichbar)
    const filters = h('div', { class: 'nav-section', id: 'nav-filters' }, h('div', { class: 'nav-head' }, h('span', { text: t('nav.filters') })),
        navItem('expiring', 'clock', t('nav.expiring'), exp, { type: 'expiring' }, f.type === 'expiring'),
        navItem('weak', 'alert', t('nav.weak'), entries.filter(isWeak).length, { type: 'weak' }, f.type === 'weak'),
        navItem('totp', 'totp', t('nav.totp'), entries.filter(hasTotp).length, { type: 'totp' }, f.type === 'totp'),
        navItem('passkey', 'passkey', t('nav.passkey'), entries.filter(isPasskey).length, { type: 'passkey' }, f.type === 'passkey'));

    const tree = h('div', { class: 'tree', role: 'tree' });
    const walk = (g, depth) => {
        const kids = g.groups.filter((c) => c !== v.recycleBin);
        const collapsed = state.collapsed.has(g.uuid.id);
        const active = f.type === 'group' && f.group === g;
        const row = h('div', { class: 'tree-row' + (active ? ' active' : ''), role: 'treeitem', 'data-depth': String(Math.min(depth, 6)), draggable: 'true' },
            kids.length ? h('button', { type: 'button', class: 'twisty', 'aria-label': collapsed ? t('expand') : t('collapse'), onclick: (e) => { e.stopPropagation(); collapsed ? state.collapsed.delete(g.uuid.id) : state.collapsed.add(g.uuid.id); ctx.ui.renderSidebar(); } }, icon(collapsed ? 'chevronRight' : 'chevronDown')) : h('span', { class: 'twisty' }),
            h('button', { type: 'button', class: 'tree-label', 'data-testid': 'group-item', onclick: () => setFilter({ type: 'group', group: g }) }, groupIcon(g), h('span', { class: 'grow', text: g.name || t('group.unnamed') }), h('span', { class: 'count', text: String([...g.allEntries()].length) })),
            iconBtn('more', t('more'), (e) => { e.stopPropagation(); groupMenu(e.currentTarget, g); }, { class: 'row-more' }));
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); groupMenu(null, g, { x: e.clientX, y: e.clientY }); });
        row.addEventListener('dragstart', (e) => { dragging = { kind: 'group', item: g }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.name || ''); document.body.classList.add('dragging'); row.addEventListener('dragend', () => { dragging = null; document.body.classList.remove('dragging'); }, { once: true }); e.stopPropagation(); });
        row.addEventListener('dragover', (e) => {
            if (!dragging) return;
            const ok = dragging.kind === 'entry' ? dragging.item.parentGroup !== g : v.canMoveGroup(dragging.item, g);
            if (ok) { e.preventDefault(); row.classList.add('drop'); }
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop'));
        row.addEventListener('drop', (e) => {
            row.classList.remove('drop');
            if (!dragging) return;
            e.preventDefault();
            if (dragging.kind === 'entry') { v.moveEntry(dragging.item, g); toast(t('entry.moved', { group: g.name }), { timeout: 2000 }); }
            else if (!v.moveGroup(dragging.item, g)) return;
            dragging = null;
            changed();
        });
        tree.append(row);
        if (!collapsed) for (const c of kids) walk(c, depth + 1);
    };
    for (const g of v.root.groups) if (g !== v.recycleBin) walk(g, 0);

    const tags = new Map();
    for (const e of entries) for (const tg of e.tags || []) tags.set(tg, (tags.get(tg) || 0) + 1);
    const tagBox = tags.size ? h('div', { class: 'nav-section' }, h('div', { class: 'nav-head' }, h('span', { text: t('nav.tags') })),
        h('div', { class: 'chips' }, ...[...tags].sort((a, b) => a[0].localeCompare(b[0])).map(([tg, n]) => h('button', { type: 'button', class: 'chip' + (f.type === 'tag' && f.tag === tg ? ' active' : ''), 'data-testid': 'tag-chip', onclick: () => setFilter({ type: 'tag', tag: tg }), text: `${tg} · ${n}` })))) : null;

    const rb = v.recycleBin;
    const binCount = rb ? [...rb.allEntries()].length : 0;
    // Ohne Papierkorb (Datenbank-Einstellung) kein Eintrag dafuer; eine alte Papierkorb-Gruppe erscheint dann als normale Gruppe.
    const bin = !v.binEnabled ? null : h('div', { class: 'nav-section' }, h('div', { class: 'tree-row bin' + (f.type === 'bin' ? ' active' : '') },
        h('span', { class: 'twisty' }),
        h('button', { type: 'button', class: 'tree-label', id: 'nav-bin', onclick: () => setFilter({ type: 'bin' }) }, icon('trash'), h('span', { class: 'grow', text: t('nav.bin') }), h('span', { class: 'count', text: String(binCount) })),
        rb ? iconBtn('more', t('more'), (e) => { e.stopPropagation(); groupMenu(e.currentTarget, rb); }, { class: 'row-more' }) : null));
    if (rb && bin) {
        bin.firstChild.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); bin.firstChild.classList.add('drop'); } });
        bin.firstChild.addEventListener('dragleave', () => bin.firstChild.classList.remove('drop'));
        bin.firstChild.addEventListener('drop', (e) => { e.preventDefault(); bin.firstChild.classList.remove('drop'); if (!dragging) return; if (dragging.kind === 'entry') v.removeEntry(dragging.item); else v.removeGroup(dragging.item); dragging = null; changed(); });
    }

    const tools = h('div', { class: 'nav-section nav-tools' }, h('div', { class: 'nav-head' }, h('span', { text: t('tools') })),
        h('button', { type: 'button', class: 'nav-item', id: 'nav-reports', onclick: () => { document.querySelector('.shell').dataset.drawer = '0'; openReports(); } }, icon('database'), h('span', { class: 'grow', text: t('database') })),
        h('button', { type: 'button', class: 'nav-item', id: 'nav-gen', onclick: () => { document.querySelector('.shell').dataset.drawer = '0'; openGenerator(); } }, icon('dice'), h('span', { class: 'grow', text: t('generator') })),
        h('button', { type: 'button', class: 'nav-item', id: 'nav-settings', onclick: () => { document.querySelector('.shell').dataset.drawer = '0'; openSettings(); } }, icon('settings'), h('span', { class: 'grow', text: t('settings') })),
        ctx.NC?.filesUrl ? h('a', { class: 'nav-item', href: ctx.NC.filesUrl }, icon('folderOpen'), h('span', { class: 'grow', text: t('files') })) : null);
    // append() statt replaceChildren(..., tagBox, ...): ohne Tags ist tagBox null, und replaceChildren macht daraus den Text "null"
    host.replaceChildren();
    append(host, [lib,
        h('div', { class: 'nav-section grow-section' }, h('div', { class: 'nav-head' }, h('span', { text: t('nav.groups') }), iconBtn('plus', t('group.new'), () => newGroup(null), { id: 'new-group-btn', class: 'small' })), tree),
        tagBox, filters, bin, tools]);
}
