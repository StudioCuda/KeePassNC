// Gemeinsame Hilfen der Oberflaeche: Avatare, Filter/Sortierung der Eintragsliste, Staerke-Cache.
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { parseQuery, matches } from '../core/search.js';
import { fieldOf, entryExpiry, daysUntil, hasTotp, isPasskey, groupPath } from '../core/util.js';
import { t } from '../i18n.js';
import { ctx } from './ctx.js';
import { h, icon } from './dom.js';

const bitsCache = new Map();
export function bitsOf(pw) {
    let b = bitsCache.get(pw);
    if (b === undefined) { b = estimateBits(pw); if (bitsCache.size > 5000) bitsCache.clear(); bitsCache.set(pw, b); }
    return b;
}
export const isWeak = (e) => { const pw = fieldOf(e, 'Password'); return !!pw && !pw.startsWith('{REF:') && bitsOf(pw) < 75; };
export { strengthLabel };

const hueOf = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 12; };
/** Rundes Symbol: eigenes Icon (Raster), sonst Anfangsbuchstabe auf farbigem Grund. */
export function avatar(item, { size = '' } = {}) {
    const url = ctx.state.vault.customIconUrl(item);
    if (url) { const img = h('img', { class: 'avatar img ' + size, src: url, alt: '' }); return img; }
    const title = item.name !== undefined ? item.name : fieldOf(item, 'Title');
    const ch = ([...(title || '?').trim()][0] || '?').toUpperCase();
    return h('span', { class: `avatar hue-${hueOf(title || '')} ${size}`, 'aria-hidden': 'true', text: ch });
}

export function groupIcon(g) {
    const v = ctx.state.vault;
    if (g === v.recycleBin) return icon('trash');
    const url = v.customIconUrl(g);
    if (url) return h('img', { class: 'icon img', src: url, alt: '' });
    return icon('folder');
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

/** Eintraege fuer die aktuelle Ansicht. Eine Suche gilt immer fuer die ganze Datenbank (ohne Papierkorb), wie in KeePassXC. */
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
