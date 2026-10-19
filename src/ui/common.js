// Gemeinsame Hilfen der Oberflaeche: Avatare, Filter/Sortierung der Eintragsliste, Staerke-Cache.
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { parseQuery, matches } from '../core/search.js';
import { fieldOf, entryExpiry, daysUntil, hasTotp, isPasskey, groupPath, resolvePlaceholders } from '../core/util.js';
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
 * Feldwert mit aufgeloesten Platzhaltern ({REF:P@I:…} auf andere Eintraege, {USERNAME}, {S:Feld}, {URL:HOST} …), wie ihn Anzeige,
 * Kopieren und Bewertung brauchen; nicht aufloesbare bleiben stehen. Der Editor arbeitet weiter mit dem Rohwert, damit sie erhalten bleiben.
 */
export const resolvedField = (e, name) => { const v = fieldOf(e, name); return v.includes('{') ? resolvePlaceholders(v, e, allRealEntries()) : v; };
export const isWeak = (e) => { const pw = resolvedField(e, 'Password'); return !!pw && !pw.includes('{REF:') && !excluded(e) && bitsOf(pw) < 75; };
export { strengthLabel };

const hueOf = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 12; };
/**
 * Rundes Symbol eines Eintrags: eigenes Icon (Raster), sonst das gewaehlte Standard-Symbol auf farbigem Grund. Das Standard-Symbol 0
 * (Schluessel, die Vorgabe von KeePass) zeigt den Anfangsbuchstaben. sel ({icon, url}) ersetzt das Symbol des Eintrags (Vorschau im Editor).
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

/** Symbol einer Gruppe: Papierkorb, eigenes Icon, gewaehltes Standard-Symbol oder Ordner. sel wie bei avatar. */
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
