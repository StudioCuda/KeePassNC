// Phone navigation: the Back key and swipes walk the panes (groups drawer < list < entry) instead of leaving the app.
import { ctx } from './ctx.js';
import { $ } from './dom.js';

const { state } = ctx;
const phone = () => matchMedia('(max-width: 760px)').matches;
const drawerMode = () => matchMedia('(max-width: 1180px)').matches;

/** One step deeper than the list: an entry on a phone, or the open groups drawer. */
function deep() {
    const s = $('.shell');
    if (!s) return false;
    return (phone() && s.dataset.view === 'detail') || (drawerMode() && s.dataset.drawer === '1');
}

/** One step out: closes the drawer, or goes from the entry back to the list. Returns false when there is nothing to step out of. */
function stepOut() {
    const s = $('.shell');
    if (!s || !deep()) return false;
    if (s.dataset.drawer === '1') s.dataset.drawer = '0';
    else { state.view = 'list'; ctx.ui.applyView(); }
    return true;
}

/** Keeps one history entry while we are deeper than the list, so the Back key lands in the list. */
function syncHistory() {
    const mine = history.state?.kpncDeep === 1;
    try {
        if (deep() && !mine) history.pushState({ kpncDeep: 1 }, '');
        else if (!deep() && mine) history.back();
    } catch { /* no history here (sandboxed frame): the buttons still work */ }
}

let installed = false;
/** Called once the main view exists; the observer follows the shell's data-view / data-drawer, whoever sets them. */
export function installMobileNav() {
    const shell = $('.shell');
    if (!shell) return;
    new MutationObserver(syncHistory).observe(shell, { attributes: true, attributeFilter: ['data-view', 'data-drawer'] });
    syncHistory();
    if (installed) return;
    installed = true;

    addEventListener('popstate', () => {
        if (!$('.shell') || !state.vault) return;
        if (state.editing && deep()) { history.pushState({ kpncDeep: 1 }, ''); return; } // Back never throws away an edit
        stepOut();
    });

    // Swipe right = one step out, swipe left closes the drawer. Mostly sideways, quick, and not inside a field or a dialog.
    let from = null;
    addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        from = e.touches.length === 1 && t.clientX > 16 && !e.target.closest?.('input, textarea, select, .modal, .menu, .backdrop, [role=slider], pre') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null; // the first pixels belong to the system's own Back gesture
    }, { passive: true });
    addEventListener('touchend', (e) => {
        if (!from || !state.vault || state.editing || document.querySelector('.backdrop')) { from = null; return; }
        const t = e.changedTouches[0], dx = t.clientX - from.x, dy = t.clientY - from.y, quick = Date.now() - from.at < 700;
        from = null;
        if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
        const s = $('.shell');
        if (dx > 0) {
            if (stepOut()) return;
            if (drawerMode() && s.dataset.view !== 'detail') s.dataset.drawer = '1'; // from the list, one more step out is the groups
        } else if (s.dataset.drawer === '1') s.dataset.drawer = '0';
    }, { passive: true });
}
