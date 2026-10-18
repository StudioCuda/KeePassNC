// Kopfleiste im Stil von Nextcloud 35: Logo, 9-Punkte-Knopf + aktuelle App (ein gemeinsamer Hover, beide oeffnen das App-Menue), Benutzermenue.
// Bewusst ohne Nextcloud-JavaScript: Die Eintraege kommen geprueft vom Server (INavigationManager), es laeuft nur unser Code auf
// der Seite. Unified Search, Benachrichtigungen und Kontaktmenue fehlen deshalb (brauchen Nextcloud-JavaScript, siehe SECURITY.md).
import { t } from '../i18n.js';
import { nextcloudAuth } from '../nextcloud.js';
import { headerText } from '../theme.js';
import { ctx } from './ctx.js';
import { $$, h, toast } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
/** Material-Design-Symbol als Pfad (9 Punkte, Plus fuer "Weitere Apps" und den Aktions-Hinweis, drei Punkte fuer "Mehr"). */
function mdi(d, cls = 'icon') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', cls);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
}
// DotsGrid aus vue-material-design-icons, wie der 9-Punkte-Knopf von Nextcloud: Punkte mit Radius 2 bei 6/12/18.
const DOTS_GRID = 'M12 16C13.1 16 14 16.9 14 18S13.1 20 12 20 10 19.1 10 18 10.9 16 12 16M12 10C13.1 10 14 10.9 14 12S13.1 14 12 14 10 13.1 10 12 10.9 10 12 10M12 4C13.1 4 14 4.9 14 6S13.1 8 12 8 10 7.1 10 6 10.9 4 12 4M6 16C7.1 16 8 16.9 8 18S7.1 20 6 20 4 19.1 4 18 4.9 16 6 16M6 10C7.1 10 8 10.9 8 12S7.1 14 6 14 4 13.1 4 12 4.9 10 6 10M6 4C7.1 4 8 4.9 8 6S7.1 8 6 8 4 7.1 4 6 4.9 4 6 4M18 16C19.1 16 20 16.9 20 18S19.1 20 18 20 16 19.1 16 18 16.9 16 18 16M18 10C19.1 10 20 10.9 20 12S19.1 14 18 14 16 13.1 16 12 16.9 10 18 10M18 4C19.1 4 20 4.9 20 6S19.1 8 18 8 16 7.1 16 6 16.9 4 18 4Z';
const dots = () => mdi(DOTS_GRID);
const PLUS = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z';
const DOTS_H = 'M16,12A2,2 0 0,1 18,10A2,2 0 0,1 20,12A2,2 0 0,1 18,14A2,2 0 0,1 16,12M10,12A2,2 0 0,1 12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12M4,12A2,2 0 0,1 6,10A2,2 0 0,1 8,12A2,2 0 0,1 6,14A2,2 0 0,1 4,12Z';

/** App-Symbol als Maske in Schriftfarbe (wie Nextcloud); ohne Symbol der Anfangsbuchstabe. Nur CSSOM, kein style-Attribut. */
function glyph(app) {
    const g = h('span', { class: 'nch-glyph', 'aria-hidden': 'true' });
    if (app.icon) { g.classList.add('has-icon'); g.style.setProperty('--nch-icon', `url("${app.icon}")`); } else g.textContent = app.name.slice(0, 1).toUpperCase();
    return g;
}

/** Symbol eines Kontomenue-Eintrags; ohne Symbol bleibt der Platz frei, damit die Namen buendig stehen. */
function entryIcon(s) {
    const g = h('span', { class: 'nch-glyph', 'aria-hidden': 'true' });
    if (s.icon) { g.classList.add('has-icon'); g.style.setProperty('--nch-icon', `url("${s.icon}")`); }
    return g;
}

let open = null;
function closePop() {
    if (!open) return;
    const { pop, triggers } = open;
    pop.hidden = true;
    for (const b of triggers) b.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', open.off, true);
    document.removeEventListener('keydown', open.key, true);
    open = null;
}
function openPop(pop, triggers, from, cols = 1, focus = true) {
    if (open?.pop === pop) { closePop(); return; }
    closePop();
    pop.hidden = false;
    for (const b of triggers) b.setAttribute('aria-expanded', 'true');
    // Pfeiltasten bleiben in ihrer Gruppe (App-Raster, Aktionszeile, "Mehr"-Liste), Tab springt zur naechsten Gruppe wie in Nextcloud.
    const groups = () => $$('[data-rove]', pop).filter((g) => !g.closest('[hidden]'));
    const items = (g) => $$('[role=menuitem]', g || pop);
    const off = (e) => { if (!pop.contains(e.target) && !triggers.some((b) => b.contains(e.target))) closePop(); };
    const key = (e) => {
        const a = document.activeElement, list = a?.closest('.nch-more-list');
        if (e.key === 'Escape' && list) { e.preventDefault(); list.hidden = true; closeMore(pop); pop.querySelector('.nch-action[aria-haspopup]')?.focus(); return; }
        if (e.key === 'Escape') { e.preventDefault(); closePop(); from.focus(); return; }
        if (!pop.contains(a)) return;
        const g = a.closest('[data-rove]'), gs = groups();
        if (e.key === 'Tab') {
            const next = gs[gs.indexOf(g) + (e.shiftKey ? -1 : 1)];
            if (g && next) { e.preventDefault(); items(next)[0]?.focus(); } else closePop();
            return;
        }
        const cur = items(g), i = cur.indexOf(a);
        if (i < 0) return;
        const c = g?.dataset.rove === 'list' ? 1 : cols;
        const step = { ArrowRight: c > 1 ? 1 : 0, ArrowLeft: c > 1 ? -1 : 0, ArrowDown: c, ArrowUp: -c, Home: -i, End: cur.length }[e.key];
        if (step !== undefined) { e.preventDefault(); cur[Math.max(0, Math.min(cur.length - 1, i + step))].focus(); }
    };
    open = { pop, triggers, off, key };
    document.addEventListener('mousedown', off, true);
    document.addEventListener('keydown', key, true);
    if (!focus) return; // per Hover geoeffnet: Fokus bleibt, wo er ist (Nextcloud: noFocusTrap)
    const first = items(groups()[0]);
    (first.find((x) => x.getAttribute('aria-current') === 'page') || first[0])?.focus();
}

/** Abmelden braucht ein frisches CSRF-Token (steht bewusst nicht in der Seite und damit nicht im Offline-Cache). */
async function logout(e, href) {
    e.preventDefault();
    try {
        const { requesttoken } = await nextcloudAuth(ctx.NC).headers();
        location.href = href + (href.includes('?') ? '&' : '?') + 'requesttoken=' + encodeURIComponent(requesttoken);
    } catch {
        toast(t('nch.offline'), { kind: 'warn' });
    }
}

/** Navigations-Aktionen unter dem App-Raster wie AppMenuActions in Nextcloud 35: eine Zeile mit vier Feldern, der Rest unter "Mehr". */
function actionsRow(actions) {
    if (!actions.length) return null;
    const PER_ROW = 4;
    const item = (a, compact = false) => h('a', { href: a.href, role: 'menuitem', title: a.name, class: 'nch-tile nch-action' + (compact ? ' compact' : '') },
        h('span', { class: 'nch-action-icon' }, actionGlyph(a), a.color ? indicator(a.color) : null), h('span', { class: 'nch-tile-name', text: a.name }));
    const over = actions.length > PER_ROW;
    const row = over ? actions.slice(0, PER_ROW - 1) : actions;
    const rest = over ? actions.slice(PER_ROW - 1) : [];
    const list = over ? h('div', { class: 'nch-more-list', role: 'menu', 'aria-label': t('nch.more.actions'), 'data-rove': 'list', hidden: true }, ...rest.map((a) => item(a, true))) : null;
    const moreBtn = over ? h('a', { href: '#', role: 'menuitem', class: 'nch-tile nch-action', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
        h('span', { class: 'nch-action-icon' }, mdi(DOTS_H, 'nch-action-svg')), h('span', { class: 'nch-tile-name', text: t('nch.more.actions') })) : null;
    moreBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const show = list.hidden;
        list.hidden = !show; moreBtn.setAttribute('aria-expanded', String(show));
        if (show) list.querySelector('a')?.focus();
    });
    return h('div', { class: 'nch-actions-wrap' }, h('div', { class: 'nch-actions', role: 'group', 'aria-label': t('nch.actions'), 'data-rove': 'grid' }, ...row.map((a) => item(a)), moreBtn), list);
}
/** Aktions-Symbole bleiben in ihren eigenen Farben (wie AppActionIcon), werden also nicht maskiert. */
function actionGlyph(a) {
    const g = h('span', { class: 'nch-action-img', 'aria-hidden': 'true' });
    if (a.icon) g.style.setProperty('--nch-icon', `url("${a.icon}")`); else { g.classList.add('letter'); g.textContent = a.name.slice(0, 1).toUpperCase(); }
    return g;
}
function indicator(color) {
    const d = h('span', { class: 'nch-indicator', 'aria-hidden': 'true' }, mdi(PLUS, 'nch-indicator-svg'));
    d.style.setProperty('--nch-indicator', color);
    return d;
}
function closeMore(pop) {
    const list = pop.querySelector('.nch-more-list');
    if (!list) return;
    list.hidden = true;
    pop.querySelector('.nch-action[aria-haspopup]')?.setAttribute('aria-expanded', 'false');
}
/** Wie Nextcloud: hoechstens sechs Reihen sichtbar, die siebte schaut ein Stueck hervor. */
function capGrid(grid) {
    const cells = grid.children;
    grid.style.removeProperty('max-height');
    if (cells.length <= 24) return;
    const rows = cells[24].getBoundingClientRect().top - cells[0].getBoundingClientRect().top;
    grid.style.setProperty('max-height', `${rows + 24}px`);
}
/**
 * Oeffnen beim Darueberfahren wie in Nextcloud 35: 300 ms Verzoegerung (die Knoepfe liegen in der Ecke, Mauswege kreuzen sie),
 * Schliessen 180 ms nach dem Verlassen, und ein Klick kurz nach dem Hover-Oeffnen schliesst nicht gleich wieder. Nur mit echter Maus.
 */
function hoverOpen(trigger, pop, toggle, ...buttons) {
    let openT = null, closeT = null, grace = false, graceT = null;
    const clear = () => { clearTimeout(openT); clearTimeout(closeT); openT = closeT = null; };
    const canHover = () => (globalThis.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches ?? true) && document.hasFocus();
    const scheduleClose = () => { clearTimeout(openT); openT = null; clearTimeout(closeT); closeT = setTimeout(() => { closeT = null; if (!pop.hidden) closePop(); }, 180); };
    trigger.addEventListener('mouseenter', () => {
        if (!canHover()) return;
        clearTimeout(closeT); closeT = null;
        if (!pop.hidden) return;
        clearTimeout(openT);
        openT = setTimeout(() => {
            openT = null;
            if (!pop.hidden) return;
            toggle(buttons[0], true);
            grace = true; clearTimeout(graceT); graceT = setTimeout(() => { grace = false; }, 500);
        }, 300);
    });
    trigger.addEventListener('mouseleave', scheduleClose);
    pop.addEventListener('mouseenter', () => { clearTimeout(closeT); closeT = null; });
    pop.addEventListener('mouseleave', scheduleClose);
    for (const b of buttons) b.addEventListener('click', () => { clear(); if (!pop.hidden && grace) return; grace = false; toggle(b); });
}

export function renderNcHeader(NC) {
    const nav = NC?.nav;
    if (!nav) return null;
    const current = nav.apps.find((a) => a.active) || { id: 'keepassnc', name: 'KeePassNC', icon: '' };
    // Kachel wie AppMenuItem in Nextcloud 35: runder, heller Kreis mit dem Symbol in der Instanzfarbe; "Weitere Apps" nur umrandet.
    const tile = (app, { outlined = false, icon = null } = {}) => h('a', { href: app.href, role: 'menuitem', title: app.name, class: 'nch-tile' + (outlined ? ' outlined' : ''), 'aria-current': app.active ? 'page' : null },
        icon || h('span', { class: 'nch-tile-icon' }, outlined ? mdi(PLUS, 'nch-tile-svg') : glyph(app)), h('span', { class: 'nch-tile-name', text: app.name }));
    const grid = h('div', { class: 'nch-grid', 'data-rove': 'grid' },
        ...nav.apps.map((a) => tile(a)), nav.moreApps ? tile({ href: nav.moreApps, name: t('nch.more') }, { outlined: true }) : null);
    const appsPop = h('div', { class: 'nch-pop nch-apps-pop', role: 'menu', 'aria-label': t('nch.apps'), id: 'nch-apps-pop', hidden: true }, grid, actionsRow(nav.actions || []));
    const waffle = h('button', { type: 'button', class: 'nch-btn nch-waffle', id: 'nch-waffle', 'aria-label': t('nch.apps.open'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'nch-apps-pop' }, dots());
    const cur = h('button', { type: 'button', class: 'nch-btn nch-current', id: 'nch-current', 'aria-label': t('nch.apps.current', { app: current.name }), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'nch-apps-pop' },
        glyph(current), h('span', { class: 'nch-current-name', text: current.name }));
    const trigger = h('div', { class: 'nch-trigger' }, waffle, cur);
    const appsNav = h('nav', { class: 'nch-apps', 'aria-label': t('nch.apps') }, trigger, appsPop);
    const toggle = (b, hover = false) => { closeMore(appsPop); openPop(appsPop, [waffle, cur], b, 4, !hover); if (!appsPop.hidden) capGrid(grid); };
    hoverOpen(trigger, appsPop, toggle, waffle, cur);

    const initial = h('span', { class: 'nch-initial', 'aria-hidden': 'true', text: (nav.name || NC.user || '?').slice(0, 1).toUpperCase() });
    const avatar = () => (nav.avatar ? h('img', { class: 'nch-avatar', src: nav.avatar, alt: '', onerror: (e) => e.target.replaceWith(initial.cloneNode(true)) }) : initial.cloneNode(true));
    const profile = nav.settings.find((s) => s.id === 'profile');
    const entries = nav.settings.filter((s) => s.id !== 'profile');
    // Wie das Kontomenue von Nextcloud: oben Name + "Profil anzeigen" als eine Zeile, darunter die Eintraege mit Symbol.
    const me = [h('span', { class: 'nch-item-name', text: nav.name || NC.user }), profile ? h('span', { class: 'nch-item-sub', text: profile.name }) : null];
    const userPop = h('div', { class: 'nch-pop nch-user-pop', role: 'menu', 'aria-label': t('nch.user'), id: 'nch-user-pop', hidden: true },
        profile ? h('a', { href: profile.href, role: 'menuitem', class: 'nch-item nch-profile' }, ...me) : h('div', { class: 'nch-item nch-profile' }, ...me),
        ...entries.map((s) => h('a', { href: s.href, role: 'menuitem', class: 'nch-item', 'data-id': s.id, onclick: s.csrf ? (e) => logout(e, s.href) : null },
            entryIcon(s), h('span', { class: 'nch-item-name', text: s.name }))));
    const userBtn = h('button', { type: 'button', class: 'nch-btn nch-user', id: 'nch-user', 'aria-label': t('nch.user'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'nch-user-pop' }, avatar());
    userBtn.addEventListener('click', () => openPop(userPop, [userBtn], userBtn));

    const logo = h('a', { href: nav.home, class: 'nch-logo', 'aria-label': t('nch.home') },
        nav.logo ? h('img', { src: nav.logo, alt: '', class: /\/core\/img\/logo\//.test(nav.logo) ? 'stock' : '' }) : h('span', { class: 'nch-glyph', 'aria-hidden': 'true' }, dots()));
    const offline = h('span', { class: 'nch-offline', id: 'nch-offline', role: 'status', hidden: true, text: t('nch.offline') });
    const header = h('header', { class: 'nch', id: 'nc-header', 'data-fg': NC.color && headerText(NC.color) === '#000000' ? 'dark' : 'light' }, logo, appsNav, h('div', { class: 'spacer' }), offline, h('div', { class: 'nch-user-wrap' }, userBtn, userPop));
    const sync = () => setNcHeaderOffline(navigator.onLine === false || ctx.state.offlineMode || ctx.state.lastSyncFailed);
    addEventListener('online', sync); addEventListener('offline', sync);
    return header;
}

/** Ohne Server: Kopfleiste abgedimmt mit Hinweis, Links fuehren sonst ins Leere. */
export function setNcHeaderOffline(off) {
    const header = document.getElementById('nc-header');
    if (!header) return;
    header.dataset.offline = off ? '1' : '0';
    document.getElementById('nch-offline').hidden = !off;
}
