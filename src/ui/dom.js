// DOM building blocks without innerHTML (data is never interpreted as HTML) and without inline styles/handlers (strict CSP).
import { MARK } from '../brand.js';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'readonly' || k === 'required') { if (v) el.setAttribute(k, ''); }
        else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, children);
    return el;
}
export function append(el, children) {
    for (const c of children.flat(Infinity)) if (c !== undefined && c !== null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
}

// ---------------------------------------------------------------- Icons (our own plain line icons, 24x24)
export const P = {
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    save: 'M5 4h11l3 3v13H5ZM8 4v5h7V4M8 20v-6h8v6',
    lock: 'M6 11h12v9H6ZM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    unlock: 'M6 11h12v9H6ZM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
    key: 'M8.2 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12.7 12h10M19.7 12v3M16.7 12v3M8.2 12h.01',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
    folderOpen: 'M3 8V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1M3 19l2.5-9h15.5l-2.5 9Z',
    tag: 'M4 4h8l8 8-8 8-8-8ZM8.5 8.5h.01',
    clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 8v4.5l3 1.5',
    copy: 'M8 8h11v12H8ZM5 16V4h11',
    eye: 'M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    eyeOff: 'M4 4l16 16M10 6a9 9 0 0 1 2-.5C18 5.500 21.500 12 21.500 12a17 17 0 0 1-3 4M6.500 7.500A17 17 0 0 0 2.500 12S6 18.500 12 18.500a9 9 0 0 0 3.500-.7M10 10a3 3 0 0 0 4 4',
    edit: 'M4 20h4L19 9l-4-4L4 16ZM13.500 6.500l4 4',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
    link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
    user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 20a8 8 0 0 1 16 0',
    clip: 'M20 11l-8.500 8.500a5 5 0 0 1-7-7L13 4a3.500 3.500 0 0 1 5 5l-8.500 8.500a2 2 0 0 1-3-3L14 7',
    history: 'M4 12a8 8 0 1 0 2.500-5.800M4 4v4h4M12 8v4.500l3 1.500',
    settings: 'M9.84 5.34L10.19 2.67A9.5 9.5 0 0 1 13.81 2.67L14.16 5.34A7 7 0 0 1 16.68 6.8L19.17 5.77A9.5 9.5 0 0 1 20.98 8.91L18.85 10.54A7 7 0 0 1 18.85 13.46L20.98 15.09A9.5 9.5 0 0 1 19.17 18.23L16.68 17.2A7 7 0 0 1 14.16 18.66L13.81 21.33A9.5 9.5 0 0 1 10.19 21.33L9.84 18.66A7 7 0 0 1 7.32 17.2L4.83 18.23A9.5 9.5 0 0 1 3.02 15.09L5.15 13.46A7 7 0 0 1 5.15 10.54L3.02 8.91A9.5 9.5 0 0 1 4.83 5.77L7.32 6.8A7 7 0 0 1 9.84 5.34ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    menu: 'M4 7h16M4 12h16M4 17h16',
    chevronRight: 'M9 6l6 6-6 6',
    chevronDown: 'M6 9l6 6 6-6',
    chevronLeft: 'M15 6l-6 6 6 6',
    x: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12.500l4.500 4.500L19 7',
    checkSquare: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 12.500l3 3 5-6',
    refresh: 'M20 12a8 8 0 1 1-2.500-5.800M20 4v5h-5',
    cloud: 'M7 18a4.500 4.500 0 0 1-.5-9A6 6 0 0 1 18 10a4 4 0 0 1-.5 8Z',
    cloudOff: 'M3 3l18 18M7 18a4.500 4.500 0 0 1-.9-8.900M10 6.200A6 6 0 0 1 18 10a4 4 0 0 1 1.500 7.700M13 18H7',
    alert: 'M12 4l9 16H3ZM12 10v4M12 17h.01',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM7.9 8.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0M14.9 8.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0M11.4 12a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0M7.9 15.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0M14.9 15.5a.6.6 0 1 0 1.2 0a.6.6 0 1 0-1.2 0',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400',
    moon: 'M20 14.500A8 8 0 0 1 9.500 4 8 8 0 1 0 20 14.500Z',
    download: 'M12 4v11M7.500 11L12 15.500 16.500 11M5 20h14',
    upload: 'M12 16V5M7.500 9L12 4.500 16.500 9M5 20h14',
    restore: 'M4 12a8 8 0 1 0 2.500-5.800M4 4v4h4',
    duplicate: 'M9 9h11v11H9ZM15 9V4H4v11h5',
    passkey: 'M9 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM2.500 20a6.500 6.500 0 0 1 9.500-5.700M17 13a2.500 2.500 0 1 0 0 5M17 18l3 2.500M19 20.500l-1.500 1.500',
    totp: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 8v4l2.500 2.500',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2M18 14h2v2',
    star: 'M12 4l2.400 5 5.600.8-4 3.900 1 5.500-5-2.700-5 2.700 1-5.500-4-3.900 5.600-.8Z',
    list: 'M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01',
    database: 'M12 3c4.400 0 8 1.300 8 3s-3.600 3-8 3-8-1.300-8-3 3.600-3 8-3ZM4 6v12c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12c0 1.700 3.600 3 8 3s8-1.300 8-3',
    info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 11v5M12 8h.01',
    command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    moveTo: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 13h7M13 10l3 3-3 3',
    broom: 'M4 20l5-5M14 4l6 6-8 8-6-6ZM9 15l2 2',
    keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
    file: 'M6 3h8l5 5v13H6ZM14 3v5h5',
    wifi: 'M3 9a14 14 0 0 1 18 0M6 12.500a9 9 0 0 1 12 0M9 16a4.500 4.500 0 0 1 6 0M12 19.500h.01'
};
const NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = '') { return name === 'shield' ? markIcon(MARK.bold, cls) : name === 'shield-fine' ? markIcon(MARK.fine, cls) : pathIcon(P[name] || P.file, cls); }
/** The brand mark (brand.js): a filled path; "shield" for icons, "shield-fine" with a thinner edge for the large watermark. */
function markIcon(d, cls) {
    const svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'currentColor'); svg.setAttribute('fill-rule', 'evenodd');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', ('icon mark ' + cls).trim());
    path.setAttribute('d', d); svg.append(path);
    return svg;
}
/** Line icon from a path (for the KeePass standard icons in kpicons.js). */
export function pathIcon(d, cls = '') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', ('icon ' + cls).trim());
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
}

/** Icon button with tooltip/label (screen reader). */
export function iconBtn(name, label, onclick, extra = {}) {
    return h('button', { type: 'button', class: 'icon-btn ' + (extra.class || ''), title: label, 'aria-label': label, onclick, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'class')) }, icon(name));
}

// ---------------------------------------------------------------- Notices (toast)
let toastHost;
export function toast(message, { kind = 'info', action, timeout = 4500 } = {}) {
    if (!toastHost) { toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastHost); }
    const el = h('div', { class: `toast ${kind}`, role: 'status' }, h('span', { text: message }));
    if (action) el.append(h('button', { type: 'button', class: 'toast-action', text: action.label, onclick: () => { action.run(); el.remove(); } }));
    toastHost.append(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
    return el;
}

// ---------------------------------------------------------------- Dialogs (replace window.confirm/prompt)
let modalDepth = 0;
const openModals = new Set(); // close functions of all open dialogs (for closeAllDialogs on lock)
export function modal({ title, body, actions = [], size = 'md', onClose, labelledBy = true, cls = '' }) {
    const previouslyFocused = document.activeElement;
    const backdrop = h('div', { class: 'backdrop' });
    const closeBtn = iconBtn('x', 'Schliessen', () => close(undefined), { class: 'modal-close' });
    const titleEl = h('h2', { class: 'modal-title', id: 'mt' + (++modalDepth), text: title || '' });
    const footer = h('div', { class: 'modal-actions' }, ...actions);
    const dlg = h('div', { class: `modal ${size} ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy ? titleEl.id : null },
        h('div', { class: 'modal-head' }, titleEl, closeBtn), h('div', { class: 'modal-body' }, body), actions.length ? footer : null);
    backdrop.append(dlg);
    let done = false;
    function close(result) {
        if (done) return; done = true;
        openModals.delete(close);
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        previouslyFocused?.focus?.();
        onClose?.(result);
    }
    function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(undefined); }
        else if (e.key === 'Tab') { // keep focus inside the dialog
            const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dlg).filter((x) => !x.disabled && x.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    }
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(undefined); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    openModals.add(close);
    (dlg.querySelector('[autofocus]') || dlg.querySelector('input, select, textarea, .modal-actions .primary') || closeBtn).focus();
    return { close, el: dlg };
}

/** Closes all open dialogs and menus like "Cancel". Dialogs hang off <body>, not #app: without this they would stay on top of the login
 *  screen after locking, plaintext included (large view, history, generator, attachment preview). */
export function closeAllDialogs() {
    closingAll = true;
    try { for (const close of [...openModals].reverse()) close(undefined); } finally { closingAll = false; }
    closeMenus();
}
let closingAll = false;
/** True while closeAllDialogs() runs (locking): an onClose handler must not open a follow-up dialog then. */
export const isClosingAll = () => closingAll;

export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
    return new Promise((resolve) => {
        const ok = h('button', { type: 'button', class: danger ? 'danger solid' : 'primary', id: 'confirm-ok', text: confirmLabel, onclick: () => m.close(true) });
        const cancel = h('button', { type: 'button', id: 'confirm-cancel', text: cancelLabel, onclick: () => m.close(false) });
        const m = modal({ title, body: h('p', { text: message }), actions: [cancel, ok], size: 'sm', onClose: (r) => resolve(r === true) });
        ok.focus();
    });
}

export function promptDialog({ title, label, value = '', multiline = false, confirmLabel, cancelLabel, placeholder = '' }) {
    return new Promise((resolve) => {
        const input = multiline ? h('textarea', { rows: 3, id: 'prompt-input', placeholder }) : h('input', { type: 'text', id: 'prompt-input', placeholder, autocomplete: 'off', autofocus: true });
        input.value = value;
        const ok = h('button', { type: 'submit', class: 'primary', id: 'prompt-ok', text: confirmLabel });
        const form = h('form', { onsubmit: (e) => { e.preventDefault(); m.close(input.value); } }, h('label', {}, label, input), h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: cancelLabel, onclick: () => m.close(null) }), ok));
        const m = modal({ title, body: form, size: 'sm', onClose: (r) => resolve(r === undefined ? null : r) });
        input.focus(); input.select?.();
    });
}

/** Small context menu at an anchor. items: [{label, icon?, onclick, danger?, disabled?} | 'sep'] */
export function popupMenu(anchor, items, { align = 'start', x, y } = {}) {
    closeMenus();
    const menu = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
        if (it === 'sep') { menu.append(h('div', { class: 'menu-sep' })); continue; }
        menu.append(h('button', { type: 'button', role: 'menuitem', class: 'menu-item' + (it.danger ? ' danger' : ''), disabled: it.disabled, onclick: () => { closeMenus(); it.onclick(); } },
            it.icon ? icon(it.icon) : h('span', { class: 'icon' }), h('span', { class: 'grow', text: it.label }), it.hint ? h('kbd', { text: it.hint }) : null));
    }
    document.body.append(menu);
    const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = align === 'end' ? r.right - mw : r.left;
    let top = r.bottom + 4;
    if (top + mh > innerHeight - 8) top = Math.max(8, (anchor ? r.top : y) - mh - 4);
    left = Math.max(8, Math.min(left, innerWidth - mw - 8));
    menu.style.setProperty('--x', left + 'px'); menu.style.setProperty('--y', top + 'px');
    menu.dataset.placed = '1';
    const off = (e) => { if (!menu.contains(e.target)) closeMenus(); };
    const key = (e) => { if (e.key === 'Escape') closeMenus(); };
    // Only listen after the opening event. If the menu is closed before that (click on an item while the timer
    // is still waiting), the timer must not fire anymore: otherwise an "off" lingers for a dissolved menu that closes
    // all menus on every later mousedown, even the one just clicked, before its click arrives.
    const arm = setTimeout(() => { document.addEventListener('mousedown', off, true); document.addEventListener('keydown', key, true); }, 0);
    menu._cleanup = () => { clearTimeout(arm); document.removeEventListener('mousedown', off, true); document.removeEventListener('keydown', key, true); };
    menu.querySelector('.menu-item:not(:disabled)')?.focus();
    return menu;
}
export function closeMenus() { for (const m of $$('.menu')) { m._cleanup?.(); m.remove(); } }
