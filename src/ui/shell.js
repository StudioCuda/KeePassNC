// Hauptansicht: Kopfzeile, drei Spalten (Seitenleiste | Liste | Details), Mobil-Navigation, Tastenkuerzel, Befehlspalette.
import { t } from '../i18n.js';
import { fieldOf, domainOf, openableUrl, hasTotp, isPasskey } from '../core/util.js';
import { SORTS } from './common.js';
import { ctx, copy, setStatus, applyTheme } from './ctx.js';
import { $, h, icon, iconBtn, modal, popupMenu, toast } from './dom.js';
import { visibleEntries, filterTitle, avatar, expiryBadge, resolvedField } from './common.js';
import { renderSidebar, newGroup, setFilter, startEntryDrag, emptyBin } from './groups.js';
import { renderDetail, deleteEntry, stopDetailTimers } from './detail.js';
import { renderEditor, startEdit, cancelEdit } from './editor.js';
import { openGenerator } from './generator-dialog.js';
import { openReports } from './reports.js';
import { openSettings } from './settings-dialog.js';
import { doSave, lock, refreshDirtyIndicator, syncNow } from './session.js';
import { saveSettings } from '../settings.js';

const { state } = ctx;
const LIMIT = 200;
let shown = LIMIT;

export function showMain() {
    document.body.classList.add('in-vault');
    const NC = ctx.NC;
    const search = h('input', { id: 'search', type: 'search', placeholder: t('search.placeholder'), value: state.query, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('search'),
        oninput: (e) => { state.query = e.target.value; shown = LIMIT; state.view = 'list'; renderList(); renderSidebar($('#groups')); applyView(); },
        onkeydown: (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); $('#list .entry')?.focus(); } if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderList(); } } });
    const saveBtn = h('button', { id: 'save-btn', type: 'button', class: 'btn save', onclick: () => doSave() }, icon('save'), h('span', { class: 'label', text: t('save') }));
    const bar = h('header', { class: 'topbar' },
        iconBtn('menu', t('nav.groups'), () => { const s = $('.shell'); s.dataset.drawer = s.dataset.drawer === '1' ? '0' : '1'; }, { class: 'menu-btn', id: 'menu-btn' }),
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark small' }, icon('shield')), h('strong', { text: 'KeePassNC' })),
        h('span', { class: 'file-name', id: 'file-name', title: state.source.name }, icon('file'), h('span', { text: state.source.name })),
        h('label', { class: 'searchbox' }, icon('search'), search, h('kbd', { text: 'Ctrl K' })),
        h('div', { class: 'spacer' }),
        h('span', { id: 'sync-state', class: 'pill', 'data-testid': 'sync-state', role: 'status' }),
        h('button', { id: 'new-btn', type: 'button', class: 'btn primary', onclick: () => startEdit(null) }, icon('plus'), h('span', { class: 'label', text: t('entry.new.short') })),
        saveBtn,
        iconBtn('dice', t('generator'), () => openGenerator(), { id: 'tool-gen', class: 'hide-narrow' }),
        iconBtn('database', t('database'), () => openReports(), { id: 'reports-btn', class: 'hide-narrow' }),
        iconBtn('settings', t('settings'), () => openSettings(), { id: 'settings-btn' }),
        NC?.filesUrl && !NC.nav ? h('a', { href: NC.filesUrl, id: 'files-link', class: 'icon-btn hide-narrow', title: t('files'), 'aria-label': t('files') }, icon('folderOpen')) : null,
        iconBtn('lock', t('lock'), () => lock(t('locked')), { id: 'lock-btn' }));
    const shell = h('div', { class: 'shell', 'data-view': state.view, 'data-drawer': '0' }, bar,
        h('div', { class: 'panes' },
            h('div', { class: 'scrim', onclick: () => { $('.shell').dataset.drawer = '0'; } }),
            h('nav', { id: 'groups', class: 'sidebar', 'aria-label': t('nav.groups') }),
            h('section', { id: 'list', class: 'listpane', 'aria-label': t('list.label') }),
            h('section', { id: 'detail', class: 'detailpane', 'aria-label': t('detail.label') })),
        h('button', { type: 'button', class: 'fab', id: 'fab-new', 'aria-label': t('entry.new'), onclick: () => startEdit(null) }, icon('plus')),
        h('footer', { class: 'statusbar' }, h('span', { id: 'status', role: 'status', 'data-testid': 'status' }), h('span', { class: 'muted', id: 'status-right' })));
    ctx.app.replaceChildren(shell);
    refresh();
}

export function applyView() {
    const s = $('.shell');
    if (!s) return;
    s.dataset.view = state.editing || state.selEntry ? state.view : state.view === 'detail' ? 'list' : state.view;
    s.dataset.drawer = '0';
}

export function refresh() {
    if (!state.vault || !$('.shell')) return;
    const entries = visibleEntries();
    if (state.selEntry && !entries.includes(state.selEntry) && !state.editing && !state.query) {
        // Auswahl verlaesst die aktuelle Ansicht (z. B. nach Verschieben): Ansicht beibehalten, Auswahl nur loesen, wenn der Eintrag nicht mehr existiert
        if (![...state.vault.root.allEntries()].includes(state.selEntry)) state.selEntry = null;
    }
    renderSidebar($('#groups'));
    renderList(entries);
    stopDetailTimers();
    renderDetail($('#detail'));
    applyView();
    refreshDirtyIndicator();
    const n = [...state.vault.root.allEntries()].length;
    const sr = $('#status-right');
    if (sr) sr.textContent = `${state.vault.versionLabel} · ${t('n.entries', { n })}`;
}
ctx.ui.renderSidebar = () => renderSidebar($('#groups'));
ctx.ui.renderList = () => renderList();

export function selectEntry(e) {
    const v = state.vault;
    state.editing = null;
    state.query = ''; const s = $('#search'); if (s) s.value = '';
    state.filter = v.isInRecycleBin(e) ? { type: 'bin' } : { type: 'group', group: e.parentGroup };
    state.selEntry = e; state.view = 'detail';
    refresh();
    $('#list .entry.active')?.scrollIntoView({ block: 'nearest' });
}

export function renderList(entries = visibleEntries()) {
    const host = $('#list');
    if (!host) return;
    const v = state.vault;
    const head = h('header', { class: 'list-head' },
        iconBtn('menu', t('nav.groups'), () => { $('.shell').dataset.drawer = '1'; }, { class: 'menu-btn in-list' }),
        h('div', { class: 'grow' }, h('h2', { text: filterTitle() }), h('span', { class: 'muted', id: 'list-count', text: t('n.entries', { n: entries.length }) })),
        state.filter.type === 'bin' && !state.query ? h('button', { type: 'button', class: 'btn small danger-ghost', id: 'empty-bin', onclick: emptyBin }, icon('broom'), t('bin.empty')) : null,
        h('select', { id: 'sort', 'aria-label': t('sort'), onchange: (e) => { ctx.settings.sort = e.target.value; saveSettings(ctx.settings); renderList(); } }, ...SORTS.map((s) => h('option', { value: s, selected: ctx.settings.sort === s, text: t('sort.' + s) }))));
    const body = h('div', { class: 'entries', role: 'listbox' });
    if (!entries.length) {
        body.append(h('div', { class: 'empty small' }, icon(state.query ? 'search' : 'folderOpen'), h('p', { class: 'muted', text: state.query ? t('list.nomatch') : t('list.empty') }),
            !state.query && state.filter.type === 'group' ? h('button', { type: 'button', class: 'btn', onclick: () => startEdit(null) }, icon('plus'), t('entry.new')) : null));
    }
    for (const e of entries.slice(0, shown)) {
        const user = resolvedField(e, 'UserName'), dom = domainOf(resolvedField(e, 'URL'));
        const main = h('button', { type: 'button', class: 'entry' + (state.selEntry === e ? ' active' : ''), role: 'option', 'aria-selected': state.selEntry === e ? 'true' : 'false', 'data-testid': 'entry-row',
            onclick: () => { state.selEntry = e; state.editing = null; state.view = 'detail'; for (const x of host.querySelectorAll('.entry.active')) { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); } main.classList.add('active'); main.setAttribute('aria-selected', 'true'); stopDetailTimers(); renderDetail($('#detail')); applyView(); },
            onkeydown: (ev) => listKeys(ev) },
            avatar(e), h('span', { class: 'et' }, h('span', { class: 'title', text: fieldOf(e, 'Title') || t('entry.untitled') }), h('span', { class: 'sub', text: [user, dom].filter(Boolean).join(' · ') })),
            h('span', { class: 'badges' }, expiryBadge(e), hasTotp(e) ? h('span', { class: 'mini', title: 'TOTP' }, icon('totp')) : null, isPasskey(e) ? h('span', { class: 'mini', title: t('passkey') }, icon('passkey')) : null, e.binaries?.size ? h('span', { class: 'mini', title: t('attachments') }, icon('clip')) : null));
        const wrap = h('div', { class: 'entry-wrap', draggable: 'true' }, main,
            h('div', { class: 'row-actions' }, iconBtn('user', t('copy') + ': ' + t('f.user'), () => copy(user, t('f.user')), { tabindex: '-1' }), iconBtn('key', t('copy') + ': ' + t('f.password'), () => copy(resolvedField(e, 'Password'), t('f.password')), { tabindex: '-1' })));
        wrap.addEventListener('dragstart', (ev) => startEntryDrag(ev, e));
        body.append(wrap);
    }
    if (entries.length > shown) body.append(h('button', { type: 'button', class: 'btn more', onclick: () => { shown += LIMIT; renderList(); }, text: t('list.more', { n: entries.length - shown }) }));
    host.replaceChildren(head, body);
}

function listKeys(ev) {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...document.querySelectorAll('#list .entry')];
    const i = all.indexOf(ev.target);
    const next = all[i + (ev.key === 'ArrowDown' ? 1 : -1)];
    if (next) { next.focus(); next.click(); }
    else if (ev.key === 'ArrowUp') $('#search')?.focus();
}

// ---------------------------------------------------------------- Befehlspalette
export function openPalette() {
    const v = state.vault;
    const input = h('input', { id: 'palette-input', type: 'search', placeholder: t('palette.placeholder'), autocomplete: 'off', spellcheck: 'false', autofocus: true });
    const list = h('div', { class: 'palette-list', role: 'listbox' });
    const cmds = [
        ['plus', t('entry.new'), 'Ctrl+N', () => startEdit(null)], ['folder', t('group.new'), '', () => newGroup(null)], ['save', t('save'), 'Ctrl+S', () => doSave()],
        ['dice', t('generator'), '', () => openGenerator()], ['database', t('database'), '', () => openReports()], ['settings', t('settings'), '', () => openSettings()],
        ['refresh', t('sync.now'), '', () => syncNow({ announce: true })],
        ['moon', t('palette.theme'), '', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; ctx.settings.theme = next; saveSettings(ctx.settings); applyTheme(); }],
        ['alert', t('nav.weak'), '', () => setFilter({ type: 'weak' })], ['clock', t('nav.expiring'), '', () => setFilter({ type: 'expiring' })], ['trash', t('nav.bin'), '', () => setFilter({ type: 'bin' })],
        ['lock', t('lock'), 'Ctrl+L', () => lock(t('locked'))]
    ];
    let items = [], sel = 0;
    const draw = () => {
        const q = input.value.trim().toLowerCase();
        items = [];
        if (q) for (const e of [...v.root.allEntries()].filter((x) => !v.isInRecycleBin(x))) { if ((fieldOf(e, 'Title') + ' ' + fieldOf(e, 'UserName') + ' ' + fieldOf(e, 'URL')).toLowerCase().includes(q)) { items.push({ kind: 'entry', e }); if (items.length >= 8) break; } }
        for (const c of cmds) if (!q || c[1].toLowerCase().includes(q)) items.push({ kind: 'cmd', c });
        sel = Math.min(sel, Math.max(0, items.length - 1));
        list.replaceChildren(...items.map((it, i) => h('button', { type: 'button', role: 'option', class: 'palette-item' + (i === sel ? ' active' : ''), onclick: () => run(it), onmousemove: () => { if (sel !== i) { sel = i; draw(); } } },
            it.kind === 'entry' ? [avatar(it.e), h('span', { class: 'grow', text: fieldOf(it.e, 'Title') }), h('span', { class: 'muted', text: fieldOf(it.e, 'UserName') })] : [icon(it.c[0]), h('span', { class: 'grow', text: it.c[1] }), it.c[2] ? h('kbd', { text: it.c[2] }) : null])));
        list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    const run = (it) => { m.close(); setTimeout(() => (it.kind === 'entry' ? selectEntry(it.e) : it.c[3]()), 0); };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
        else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); run(items[sel]); }
    });
    const m = modal({ title: t('palette'), body: h('div', { class: 'palette' }, input, list), size: 'md', cls: 'palette-modal' });
    draw();
}

// ---------------------------------------------------------------- Tastenkuerzel
export function installShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!state.vault || document.querySelector('.backdrop')) return;
        const mod = e.ctrlKey || e.metaKey;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
        const key = e.key.toLowerCase();
        if (mod && key === 'k') { e.preventDefault(); openPalette(); }
        else if (mod && key === 'f') { e.preventDefault(); $('#search')?.focus(); $('#search')?.select(); }
        else if (mod && key === 'n') { e.preventDefault(); startEdit(null); }
        else if (mod && key === 's') { e.preventDefault(); doSave(); }
        else if (mod && key === 'l') { e.preventDefault(); lock(t('locked')); }
        else if (mod && key === 'b' && state.selEntry && !typing) { e.preventDefault(); copy(resolvedField(state.selEntry, 'UserName'), t('f.user')); }
        else if (mod && e.shiftKey && key === 'u' && state.selEntry) { e.preventDefault(); const u = openableUrl(resolvedField(state.selEntry, 'URL')); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }
        else if (mod && key === 'c' && state.selEntry && !typing && !getSelection().toString()) { e.preventDefault(); copy(resolvedField(state.selEntry, 'Password'), t('f.password')); }
        else if (e.key === 'Delete' && state.selEntry && !typing && !state.editing) { e.preventDefault(); deleteEntry(state.selEntry); }
        else if (e.key === 'Escape' && state.editing && !typing) cancelEdit();
    });
}

ctx.ui.refresh = refresh;
ctx.ui.renderEditor = renderEditor;
ctx.ui.applyView = applyView;
ctx.ui.selectEntry = selectEntry;
ctx.ui.showMain = showMain;
