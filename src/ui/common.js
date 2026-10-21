// Shared UI helpers: avatars, filtering/sorting of the entry list, strength cache.
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { parseQuery, matches } from '../core/search.js';
import { fieldOf, entryExpiry, daysUntil, hasTotp, isPasskey, groupPath, resolvePlaceholders, openableUrl } from '../core/util.js';
import { excluded } from '../core/audit.js';
import { t } from '../i18n.js';
import { ctx } from './ctx.js';
import { h, icon, pathIcon } from './dom.js';
import { KP_ICONS, GROUP_DEFAULT_ICON } from './kpicons.js';

const bitsCache = new Map();
export function bitsOf(pw) {
    let b = bitsCache.get(pw);
    if (b === undefined) { b = estimateBits(pw); if (bitsCache.size > 5000) bitsCache.clear(); bitsCache.set(pw, b); }
    return b;
}
/**
 * Field value with resolved placeholders ({REF:P@I:…} to other entries, {USERNAME}, {S:Field}, {URL:HOST} …), as display,
 * copying and rating need it; unresolvable ones stay as they are. The editor keeps working with the raw value so they are preserved.
 */
export const resolvedField = (e, name) => { const v = fieldOf(e, name); return v.includes('{') ? resolvePlaceholders(v, e, allRealEntries()) : v; };
/**
 * URL for display: placeholders for passwords and protected fields stay as they are (see resolvePlaceholders).
 * own: true (opening, copying) inserts the entry's own secrets, but not those of other entries.
 */
export const resolvedUrl = (e, { own = false } = {}) => { const v = fieldOf(e, 'URL'); return v.includes('{') ? resolvePlaceholders(v, e, allRealEntries(), { secrets: own ? 'own' : false }) : v; };
/** Opens an entry's URL in a new tab, with its own secrets (link click, Ctrl+Shift+U). */
export const openEntryUrl = (e) => { const u = openableUrl(resolvedUrl(e, { own: true })); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
export const isWeak = (e) => { const pw = resolvedField(e, 'Password'); return !!pw && !pw.includes('{REF:') && !excluded(e) && bitsOf(pw) < 75; };
export { strengthLabel };

const hueOf = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 12; };
/**
 * Round icon of an entry: custom icon (bitmap), otherwise the chosen standard icon on a coloured background. Standard icon 0
 * (key, KeePass's default) shows the initial letter. sel ({icon, url}) replaces the entry's icon (preview in the editor).
 */
export function avatar(item, { size = '', sel, title } = {}) {
    const url = sel ? sel.url : ctx.state.vault.customIconUrl(item);
    if (url) { const img = h('img', { class: 'avatar img ' + size, src: url, alt: '' }); return img; }
    title ??= item.name !== undefined ? item.name : fieldOf(item, 'Title');
    const std = KP_ICONS[sel ? sel.icon : item.icon];
    if (std && (sel ? sel.icon : item.icon)) return h('span', { class: `avatar glyph hue-${hueOf(title || '')} ${size}`, 'aria-hidden': 'true' }, pathIcon(std));
    const ch = ([...(title || '?').trim()][0] || '?').toUpperCase();
    return h('span', { class: `avatar hue-${hueOf(title || '')} ${size}`, 'aria-hidden': 'true', text: ch });
}

/** Icon of a group: recycle bin, custom icon, chosen standard icon or folder. sel as for avatar. */
export function groupIcon(g, { sel } = {}) {
    const v = ctx.state.vault;
    if (g === v.recycleBin && !sel) return icon('trash');
    const url = sel ? sel.url : v.customIconUrl(g);
    if (url) return h('img', { class: 'icon img', src: url, alt: '' });
    return pathIcon(KP_ICONS[sel ? sel.icon : g.icon ?? GROUP_DEFAULT_ICON] || KP_ICONS[GROUP_DEFAULT_ICON]);
}

export function allRealEntries() {
    const v = ctx.state.vault;
    const out = [];
    for (const e of v.root.allEntries()) if (!v.isInRecycleBin(e)) out.push(e);
    return out;
}

const sorters = {
    title: (a, b) => fieldOf(a, 'Title').localeCompare(fieldOf(b, 'Title'), undefined, { numeric: true, sensitivity: 'base' }),
    modified: (a, b) => (b.times.lastModTime?.getTime() || 0) - (a.times.lastModTime?.getTime() || 0),
    created: (a, b) => (b.times.creationTime?.getTime() || 0) - (a.times.creationTime?.getTime() || 0),
    username: (a, b) => fieldOf(a, 'UserName').localeCompare(fieldOf(b, 'UserName'), undefined, { sensitivity: 'base' }),
    group: (a, b) => groupPath(a.parentGroup).localeCompare(groupPath(b.parentGroup)) || sorters.title(a, b)
};
export const SORTS = Object.keys(sorters);

/** Entries for the current view. A search always covers the whole database (without recycle bin), like in KeePassXC. */
export function visibleEntries() {
    const { state } = ctx;
    const v = state.vault;
    const q = state.query.trim();
    let list;
    const f = state.filter;
    if (q) {
        const terms = parseQuery(q);
        list = allRealEntries().filter((e) => matches(e, terms, { isWeak }));
        if (f.type === 'bin') list = [...(v.recycleBin?.allEntries() || [])].filter((e) => matches(e, terms, { isWeak }));
    } else if (f.type === 'bin') list = [...(v.recycleBin?.allEntries() || [])];
    else if (f.type === 'group') list = [...f.group.allEntries()].filter((e) => f.group === v.recycleBin || !v.isInRecycleBin(e) || v.isInRecycleBin(f.group));
    else {
        list = allRealEntries();
        if (f.type === 'expiring') list = list.filter((e) => { const x = entryExpiry(e); return x && daysUntil(x) <= 30; });
        else if (f.type === 'weak') list = list.filter(isWeak);
        else if (f.type === 'totp') list = list.filter(hasTotp);
        else if (f.type === 'passkey') list = list.filter(isPasskey);
        else if (f.type === 'tag') list = list.filter((e) => (e.tags || []).includes(f.tag));
        else if (f.type === 'attachment') list = list.filter((e) => e.binaries.size > 0);
    }
    return list.sort(sorters[ctx.settings.sort] || sorters.title);
}

export function filterTitle() {
    const { state } = ctx;
    const f = state.filter;
    if (state.query.trim()) return t('list.search');
    switch (f.type) {
        case 'group': return f.group.name || t('group.unnamed');
        case 'bin': return t('nav.bin');
        case 'tag': return '#' + f.tag;
        default: return t('nav.' + f.type);
    }
}

export function expiryBadge(e) {
    const x = entryExpiry(e);
    if (!x) return null;
    const d = daysUntil(x);
    if (d <= 0) return h('span', { class: 'badge bad', title: t('expired') }, icon('clock'), t('expired'));
    if (d <= 30) return h('span', { class: 'badge warn', title: t('expires.in', { n: d }) }, icon('clock'), t('days.short', { n: d }));
    return null;
}
