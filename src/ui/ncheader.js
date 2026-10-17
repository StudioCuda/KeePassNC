// Kopfleiste im Stil von Nextcloud 34/35: Logo, 9-Punkte-Knopf + aktuelle App (beide oeffnen das App-Menue), Benutzermenue.
// Bewusst ohne Nextcloud-JavaScript: Die Eintraege kommen geprueft vom Server (INavigationManager), es laeuft nur unser Code auf
// der Seite. Unified Search, Benachrichtigungen und Kontaktmenue fehlen deshalb (brauchen Nextcloud-JavaScript, siehe SECURITY.md).
import { t } from '../i18n.js';
import { nextcloudAuth } from '../nextcloud.js';
import { headerText } from '../theme.js';
import { ctx } from './ctx.js';
import { $$, h, toast } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
function dots() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
    for (const y of [5, 12, 19]) for (const x of [5, 12, 19]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '1.9');
        svg.append(c);
    }
    return svg;
}

/** App-Symbol als Maske in Schriftfarbe (wie Nextcloud); ohne Symbol der Anfangsbuchstabe. Nur CSSOM, kein style-Attribut. */
function glyph(app) {
    const g = h('span', { class: 'nch-glyph', 'aria-hidden': 'true' });
    if (app.icon) { g.classList.add('has-icon'); g.style.setProperty('--nch-icon', `url("${app.icon}")`); } else g.textContent = app.name.slice(0, 1).toUpperCase();
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
function openPop(pop, triggers, from, cols = 1) {
    if (open?.pop === pop) { closePop(); return; }
    closePop();
    pop.hidden = false;
    for (const b of triggers) b.setAttribute('aria-expanded', 'true');
    const items = () => $$('a[role=menuitem]', pop);
    const off = (e) => { if (!pop.contains(e.target) && !triggers.some((b) => b.contains(e.target))) closePop(); };
    const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closePop(); from.focus(); return; }
        const list = items(), i = list.indexOf(document.activeElement);
        if (i < 0) return;
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
        if (step) { e.preventDefault(); list[Math.max(0, Math.min(list.length - 1, i + step))].focus(); }
        else if (e.key === 'Tab') closePop();
    };
    open = { pop, triggers, off, key };
    document.addEventListener('mousedown', off, true);
    document.addEventListener('keydown', key, true);
    (items().find((a) => a.getAttribute('aria-current') === 'page') || items()[0])?.focus();
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

export function renderNcHeader(NC) {
    const nav = NC?.nav;
    if (!nav) return null;
    const current = nav.apps.find((a) => a.active) || { id: 'keepassnc', name: 'KeePassNC', icon: '' };
    const more = nav.moreApps ? { href: nav.moreApps } : null;
    const tile = (app, extra = {}) => h('a', { href: app.href, role: 'menuitem', class: 'nch-tile' + (extra.more ? ' more' : ''), 'aria-current': app.active ? 'page' : null },
        h('span', { class: 'nch-tile-icon' }, extra.more ? h('span', { class: 'nch-glyph', 'aria-hidden': 'true', text: '+' }) : glyph(app)), h('span', { class: 'nch-tile-name', text: app.name }));
    const appsPop = h('div', { class: 'nch-pop nch-apps-pop', role: 'menu', 'aria-label': t('nch.apps'), id: 'nch-apps-pop', hidden: true },
        ...nav.apps.map((a) => tile(a)), more ? tile({ ...more, name: t('nch.more') }, { more: true }) : null);
    const waffle = h('button', { type: 'button', class: 'nch-btn nch-waffle', id: 'nch-waffle', 'aria-label': t('nch.apps.open'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'nch-apps-pop' }, dots());
    const cur = h('button', { type: 'button', class: 'nch-btn nch-current', id: 'nch-current', 'aria-label': t('nch.apps.current', { app: current.name }), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'nch-apps-pop' },
        glyph(current), h('span', { class: 'nch-current-name', text: current.name }));
    const appsNav = h('nav', { class: 'nch-apps', 'aria-label': t('nch.apps') }, waffle, cur, appsPop);
    for (const b of [waffle, cur]) b.addEventListener('click', () => { openPop(appsPop, [waffle, cur], b, 3); appsNav.classList.toggle('open', !appsPop.hidden); });

    const initial = h('span', { class: 'nch-initial', 'aria-hidden': 'true', text: (nav.name || NC.user || '?').slice(0, 1).toUpperCase() });
    const avatar = () => (nav.avatar ? h('img', { class: 'nch-avatar', src: nav.avatar, alt: '', onerror: (e) => e.target.replaceWith(initial.cloneNode(true)) }) : initial.cloneNode(true));
    const profile = nav.settings.find((s) => s.id === 'profile');
    const entries = nav.settings.filter((s) => s.id !== 'profile');
    const userPop = h('div', { class: 'nch-pop nch-user-pop', role: 'menu', 'aria-label': t('nch.user'), id: 'nch-user-pop', hidden: true },
        h('div', { class: 'nch-user-head' }, h('span', { class: 'nch-user-pic' }, avatar()),
            h('span', { class: 'nch-user-text' }, h('strong', { text: nav.name || NC.user }), profile ? h('a', { href: profile.href, role: 'menuitem', class: 'nch-profile', text: profile.name }) : null)),
        ...entries.map((s) => h('a', { href: s.href, role: 'menuitem', class: 'nch-item', 'data-id': s.id, text: s.name, onclick: s.csrf ? (e) => logout(e, s.href) : null })));
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
