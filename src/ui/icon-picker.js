// Symbol waehlen (Eintrag/Gruppe) wie im Symbol-Reiter von KeePassXC: eines der 69 Standard-Symbole von KeePass oder ein eigenes Bild.
// Eigene Bilder kommen nur vom Geraet (kein Favicon-Abruf, nichts geht ins Netz) und werden im Browser auf hoechstens 128 px gebracht
// und als PNG neu geschrieben (auch SVG). In die Datei kommen sie erst mit "Uebernehmen" im Editor bzw. Gruppen-Dialog.
import { imageUrl } from '../vault.js';
import { t } from '../i18n.js';
import { ctx } from './ctx.js';
import { h, icon, pathIcon, modal, toast, confirmDialog } from './dom.js';
import { avatar, groupIcon } from './common.js';
import { KP_ICONS, ENTRY_DEFAULT_ICON, GROUP_DEFAULT_ICON } from './kpicons.js';

export const ICON_MAX = 128;
const MAX_FILE = 16 * 1024 * 1024;

/** Auswahl eines Elements: {icon, custom, add}; add = {data, name, url} ist ein neues Bild, das noch nicht in der Datei liegt. */
export function iconSelOf(item, kind) {
    return { icon: item?.icon ?? (kind === 'group' ? GROUP_DEFAULT_ICON : ENTRY_DEFAULT_ICON), custom: item?.customIcon?.id ?? null, add: null };
}

const view = (sel) => ({ icon: sel.icon, url: sel.add ? sel.add.url : sel.custom ? ctx.state.vault.iconUrl(sel.custom) : null });

/** Vorschau der Auswahl, wie sie spaeter in Liste bzw. Gruppenbaum erscheint. */
export function iconPreview(sel, kind, title = '', size = '') {
    return kind === 'group' ? groupIcon(null, { sel: view(sel) }) : avatar(null, { sel: view(sel), title, size });
}

/** Fuer Vault.applyEntry/updateGroup: ein neues Bild jetzt in der Datei ablegen und {icon, customIcon} liefern. */
export function commitIconSel(sel) {
    const customIcon = sel.add ? ctx.state.vault.addCustomIcon(sel.add.data, sel.add.name) : sel.custom;
    return { icon: sel.icon, customIcon };
}

/**
 * SVG als Bild laden: als <img> von einer data:-URL fuehrt der Browser darin keine Skripte aus und laedt nichts nach. Ohne eigene Groesse
 * (nur viewBox) gilt ICON_MAX x ICON_MAX.
 */
async function loadSvg(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(bin);
    await img.decode();
    return { img, width: img.naturalWidth || ICON_MAX, height: img.naturalHeight || ICON_MAX, vector: true };
}

/**
 * Bilddatei -> PNG mit hoechstens ICON_MAX px an der laengeren Seite. Rasterbilder werden nur verkleinert, SVG wird direkt in dieser
 * Groesse gezeichnet (bleibt scharf); in der Datei landet immer PNG, das zeigen auch KeePass und KeePassXC.
 */
export async function shrinkImage(file) {
    const svg = /svg/i.test(file.type) || /\.svg$/i.test(file.name);
    if (file.size > MAX_FILE || /\.svgz$/i.test(file.name)) throw new Error('format');
    let bmp;
    try { bmp = svg ? await loadSvg(file) : await createImageBitmap(file); } catch { throw new Error('format'); }
    const scale = svg ? ICON_MAX / Math.max(bmp.width, bmp.height) : Math.min(1, ICON_MAX / Math.max(bmp.width, bmp.height));
    const tw = Math.max(1, Math.round(bmp.width * scale)), th = Math.max(1, Math.round(bmp.height * scale));
    const draw = (img, w, hh) => {
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, hh);
        return c;
    };
    // In Halbierungsschritten verkleinern: ein einziger grosser Schritt wird in manchen Browsern koernig
    let src = svg ? bmp.img : bmp, w = bmp.width, hh = bmp.height;
    while (!svg && w / 2 > tw && hh / 2 > th) { w = Math.round(w / 2); hh = Math.round(hh / 2); src = draw(src, w, hh); }
    const out = draw(src, tw, th);
    bmp.close?.();
    let blob;
    try { blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png')); } catch { throw new Error('format'); } // z. B. Safari bei SVG mit foreignObject
    if (!blob) throw new Error('format');
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Dialog. kind: 'entry' | 'group'; sel: aktuelle Auswahl; title: fuer den Anfangsbuchstaben; onRemoved: ein eigenes Symbol wurde aus der
 * Datei geloescht (die Datei hat sich sofort geaendert, wie in KeePassXC).
 * @returns {Promise<object|null>} neue Auswahl oder null (abgebrochen)
 */
export function pickIcon({ kind, sel, title = '', onRemoved }) {
    return new Promise((resolve) => {
        const v = ctx.state.vault;
        let cur = { ...sel };
        let pending = sel.add ? [sel.add] : []; // in diesem Dialog hinzugefuegte Bilder; nur das gewaehlte kommt in die Datei
        const cells = [];
        const cell = (label, content, isActive, choose, extra = {}) => {
            const b = h('button', { type: 'button', class: 'icon-cell', role: 'radio', title: label, 'aria-label': label, onclick: () => { cur = choose(); mark(); }, ondblclick: () => { cur = choose(); m.close(cur); }, ...extra }, content);
            cells.push({ b, isActive });
            return b;
        };
        const mark = () => {
            for (const c of cells) { const on = c.isActive(); c.b.setAttribute('aria-checked', on ? 'true' : 'false'); c.b.tabIndex = on ? 0 : -1; }
            if (!cells.some((c) => c.isActive())) cells[0].b.tabIndex = 0;
            removeBtn.disabled = !(cur.add || cur.custom);
        };
        const letter = ([...(title || '?').trim()][0] || '?').toUpperCase();
        const std = h('div', { class: 'icon-grid', role: 'radiogroup', 'aria-label': t('icon.standard'), id: 'icon-std' },
            KP_ICONS.map((d, n) => {
                const dflt = kind === 'entry' && n === ENTRY_DEFAULT_ICON; // Vorgabe: Anfangsbuchstabe statt Schluessel
                return cell(dflt ? t('icon.default.entry') : t('icon.' + n), dflt ? h('span', { class: 'icon-letter', text: letter }) : pathIcon(d),
                    () => !cur.custom && !cur.add && cur.icon === n, () => ({ icon: n, custom: null, add: null }), { 'data-icon': String(n) });
            }));
        const custom = h('div', { class: 'icon-grid', role: 'radiogroup', 'aria-label': t('icon.custom'), id: 'icon-custom' });
        const renderCustom = () => {
            cells.splice(KP_ICONS.length);
            const list = [...v.customIcons().filter((x) => x.url).map((x) => ({ id: x.id, name: x.name, url: x.url })), ...pending.map((p) => ({ add: p, name: p.name, url: p.url }))];
            custom.replaceChildren(...list.map((x) => cell(x.name || t('icon.custom.one'), h('img', { src: x.url, alt: '' }),
                () => (x.add ? cur.add === x.add : !cur.add && cur.custom === x.id), () => ({ icon: cur.icon, custom: x.id ?? null, add: x.add ?? null }), { 'data-testid': 'icon-custom-cell' })));
            if (!list.length) custom.append(h('p', { class: 'hint', text: t('icon.custom.none') }));
        };
        const addFiles = async (files) => {
            for (const f of files) {
                let data;
                try { data = await shrinkImage(f); } catch { toast(t('icon.badfile', { name: f.name }), { kind: 'warn' }); continue; }
                const known = v.findCustomIcon(data);
                const twin = pending.find((p) => p.data.length === data.length && p.data.every((b, i) => b === data[i]));
                if (known) { cur = { icon: cur.icon, custom: known, add: null }; toast(t('icon.exists')); continue; }
                if (twin) { cur = { icon: cur.icon, custom: null, add: twin }; continue; }
                const p = { data, name: f.name.replace(/\.[^.]*$/, ''), url: imageUrl(data) };
                pending.push(p);
                cur = { icon: cur.icon, custom: null, add: p };
            }
            renderCustom(); mark();
        };
        const input = h('input', { type: 'file', id: 'icon-file', class: 'sr-only', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/x-icon,.ico,image/svg+xml,.svg',
            onchange: async () => { await addFiles([...input.files]); input.value = ''; } });
        const removeBtn = h('button', { type: 'button', class: 'btn small danger-ghost', id: 'icon-remove', onclick: async () => {
            if (cur.add) { pending = pending.filter((p) => p !== cur.add); cur = { icon: cur.icon, custom: null, add: null }; renderCustom(); mark(); return; }
            const id = cur.custom;
            if (!id) return;
            const n = v.customIconUsage(id);
            const ok = await confirmDialog({ title: t('icon.remove'), message: n ? t('icon.remove.used', { n }) : t('icon.remove.msg'), confirmLabel: t('remove'), cancelLabel: t('cancel'), danger: true });
            if (!ok) return;
            v.removeCustomIcon(id);
            if (cur.custom === id) cur = { icon: cur.icon, custom: null, add: null };
            onRemoved?.(id);
            renderCustom(); mark();
        } }, icon('trash'), h('span', { text: t('icon.remove') }));
        const ok = h('button', { type: 'button', class: 'primary', id: 'icon-ok', text: t('apply'), onclick: () => m.close(cur) });
        const body = h('div', { class: 'stack icon-picker' },
            h('div', { class: 'flabel', text: t('icon.standard') }), std,
            h('div', { class: 'icon-custom-head' }, h('div', { class: 'flabel grow', text: t('icon.custom') }),
                h('label', { class: 'btn small', for: 'icon-file' }, icon('upload'), t('icon.add')), input, removeBtn),
            custom);
        const m = modal({ title: t('icon.choose'), body, size: 'lg', actions: [h('button', { type: 'button', text: t('cancel'), onclick: () => m.close(undefined) }), ok],
            onClose: (r) => resolve(r || null) });
        // Pfeiltasten im Raster bewegen den Fokus (Radiogruppe)
        body.addEventListener('keydown', (e) => {
            const grid = e.target.closest?.('.icon-grid');
            if (!grid || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
            const list = [...grid.querySelectorAll('.icon-cell')];
            const i = list.indexOf(e.target), cols = list.filter((x) => x.offsetTop === list[0].offsetTop).length;
            const j = i + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols })[e.key];
            if (list[j]) { e.preventDefault(); list[j].focus(); }
        });
        renderCustom(); mark();
        (cells.find((c) => c.isActive())?.b || ok).focus();
    });
}
