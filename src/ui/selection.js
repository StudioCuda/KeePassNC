// Several entries at once: mark them (Ctrl/Shift+click or the select button), then move, tag, delete or restore them together.
// The marked entries live in ctx.state.marked; shell.js draws the marks, this module owns the clicks and the actions.
import { t } from '../i18n.js';
import { splitTags } from '../core/util.js';
import { ctx, clearMarks, setStatus } from './ctx.js';
import { h, iconBtn, modal, confirmDialog, toast } from './dom.js';
import { allRealEntries } from './common.js';
import { changed } from './session.js';
import { groupSelect, selectedGroup } from './groups.js';
import { restoreTarget } from './detail.js';

const { state } = ctx;
let anchor = null; // the entry marked last: where a Shift+click range starts

/** Entries that left the list (filter, search, tags removed) can't stay marked. */
export function pruneMarks(entries) {
    if (!state.marked.size) return;
    const visible = new Set(entries);
    for (const e of state.marked) if (!visible.has(e)) state.marked.delete(e);
}

/**
 * A click on a row. Ctrl/Cmd+click marks, Shift+click marks everything from the last mark (or the open entry), and in select mode every
 * click marks. Returns false for a plain click, which opens the entry as usual.
 */
export function markClick(ev, list, e) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!state.selecting && !mod && !ev.shiftKey) return false;
    const from = state.selecting && anchor ? anchor : state.selEntry;
    if (ev.shiftKey && from && from !== e) {
        const a = list.indexOf(from), b = list.indexOf(e);
        if (a >= 0 && b >= 0) for (const x of list.slice(Math.min(a, b), Math.max(a, b) + 1)) state.marked.add(x);
        else state.marked.add(e);
    } else {
        // the first Ctrl+click next to an open entry marks that one too, like in a file manager
        if (!state.selecting && state.selEntry && state.selEntry !== e && list.includes(state.selEntry)) state.marked.add(state.selEntry);
        if (!state.marked.delete(e)) state.marked.add(e);
    }
    state.selecting = true;
    anchor = e;
    return true;
}

export function selectAll(entries) {
    for (const e of entries) state.marked.add(e);
    state.selecting = true;
    ctx.ui.syncMarks();
}

/** The bar that replaces the list header while marking. */
export function selectionBar(entries) {
    const v = state.vault;
    const n = state.marked.size;
    const inBin = state.filter.type === 'bin';
    const forever = inBin || !v.binEnabled;
    const act = (icon, label, run, extra = {}) => iconBtn(icon, label, () => run([...state.marked]), { disabled: !n, ...extra });
    return h('header', { class: 'list-head sel-bar', 'data-testid': 'sel-bar' },
        iconBtn('x', t('sel.done'), () => { clearMarks(); ctx.ui.syncMarks(); }, { id: 'sel-done' }),
        h('div', { class: 'grow' },
            h('h2', { id: 'sel-count', 'data-testid': 'sel-count', 'aria-live': 'polite', text: t('sel.count', { n }) }),
            n < entries.length ? h('button', { type: 'button', class: 'link', id: 'sel-all', text: t('sel.all'), onclick: () => selectAll(entries) }) : null),
        inBin ? act('restore', t('restore'), restoreEntries, { id: 'sel-restore' }) : null,
        act('moveTo', t('move'), moveEntriesDialog, { id: 'sel-move' }),
        act('tag', t('f.tags'), tagEntriesDialog, { id: 'sel-tags' }),
        act('trash', forever ? t('delete.forever') : t('delete'), deleteEntries, { id: 'sel-delete', class: 'danger-ghost' }));
}

/** After an action on the marked entries: the open entry may be among them, and select mode ends. */
function finish(list) {
    if (list.includes(state.selEntry)) { state.selEntry = null; state.view = 'list'; }
    clearMarks();
    changed();
}

function moveEntriesDialog(list) {
    const v = state.vault;
    const same = list.every((e) => e.parentGroup === list[0].parentGroup);
    const sel = groupSelect({ value: same ? list[0].parentGroup : undefined });
    const m = modal({ title: t('sel.move.title'), size: 'sm', body: h('form', { class: 'stack', onsubmit: (ev) => {
        ev.preventDefault();
        const g = selectedGroup(sel);
        for (const e of list) v.moveEntry(e, g);
        m.close();
        finish([]);
        toast(t('sel.moved', { n: list.length, group: g.name || t('group.root') }), { timeout: 2000 });
    } },
    h('label', {}, h('span', { text: t('group') }), sel),
    h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), h('button', { type: 'submit', class: 'primary', id: 'sel-move-ok', text: t('move') }))) });
}

/** Add tags to, or take tags off, all marked entries. The chips list what the selection already carries and fill the field when clicked. */
function tagEntriesDialog(list) {
    const v = state.vault;
    const input = h('input', { id: 'sel-tags-input', autocomplete: 'off', list: 'sel-tag-suggestions', 'aria-label': t('f.tags') });
    const all = new Set();
    for (const e of allRealEntries()) for (const tg of e.tags || []) all.add(tg);
    const sugg = h('datalist', { id: 'sel-tag-suggestions' }, ...[...all].sort((a, b) => a.localeCompare(b)).map((tg) => h('option', { value: tg })));
    const have = new Map();
    for (const e of list) for (const tg of e.tags || []) have.set(tg, (have.get(tg) || 0) + 1);
    const chips = have.size ? h('div', { class: 'stack tight' }, h('span', { class: 'hint', text: t('sel.tags.on') }),
        h('div', { class: 'chips', 'data-testid': 'sel-tags-on' }, ...[...have].sort((a, b) => a[0].localeCompare(b[0])).map(([tg, c]) => h('button', { type: 'button', class: 'chip',
            onclick: () => { input.value = [...splitTags(input.value), tg].join(', '); input.focus(); }, text: `${tg} · ${c}` })))) : null;
    const run = (mode) => {
        const tags = splitTags(input.value);
        if (!tags.length) { input.focus(); return; }
        const n = v.editTags(list, mode === 'add' ? { add: tags } : { remove: tags });
        m.close();
        if (n) { changed(); toast(t('sel.tags.changed', { n }), { timeout: 2000 }); } else toast(t('sel.tags.same'), { timeout: 2000 });
    };
    const m = modal({ title: t('sel.tags.title'), size: 'sm', body: h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); run('add'); } },
        h('label', {}, h('span', { text: t('f.tags') }), input, sugg), chips,
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }),
            h('button', { type: 'button', id: 'sel-tags-remove', text: t('sel.tags.remove'), onclick: () => run('remove') }), h('button', { type: 'submit', class: 'primary', id: 'sel-tags-add', text: t('sel.tags.add') }))) });
    input.focus();
}

/** Into the recycle bin with an Undo (permanent, after asking, when there is no bin or they are in it already). */
export async function deleteEntries(list) {
    if (!list.length) return;
    const v = state.vault;
    const n = list.length;
    if (list.some((e) => v.deletesForever(e))) { // one of them would go for good: ask
        if (!(await confirmDialog({ title: t('delete.forever'), message: t('sel.delete.forever.msg', { n }), confirmLabel: t('delete.forever'), cancelLabel: t('cancel'), danger: true }))) return;
        for (const e of list) v.removeEntry(e);
        finish(list);
        setStatus(t('sel.deleted.forever', { n }));
        return;
    }
    const prev = list.map((e) => [e, e.parentGroup]);
    for (const e of list) v.removeEntry(e);
    finish(list);
    setStatus(t('sel.deleted.bin', { n }));
    toast(t('sel.deleted.bin', { n }), { action: { label: t('undo'), run: () => { for (const [e, g] of prev) v.moveEntry(e, g); changed(); } }, timeout: 7000 });
}

function restoreEntries(list) {
    const v = state.vault;
    for (const e of list) v.moveEntry(e, restoreTarget(e));
    finish([]);
    toast(t('sel.restored', { n: list.length }));
}
