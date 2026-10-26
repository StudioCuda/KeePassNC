// Soft lock: the auto-lock found changes it couldn't save, and locking for real would throw them away. The view is gone
// (list, detail, timers, dialogs), the database stays in memory until the master password comes back. No key derivation needed:
// the answer comes from comparing with the credentials the session already holds.
import { t } from '../i18n.js';
import { ctx } from './ctx.js';
import { h, icon, iconBtn, closeAllDialogs, confirmDialog } from './dom.js';
import { filePicker } from './file-picker.js';
import { loginShell } from './login.js';
import { stopDetailTimers } from './detail.js';
import { confirmDiscard, doSave, refreshDirtyIndicator } from './session.js';

const { state } = ctx;
let lastMessage = '';

export function showSoftLock(message) {
    if (message !== undefined) lastMessage = message;
    const v = state.vault;
    closeAllDialogs();
    stopDetailTimers();
    state.editing = null; state.selEntry = null; state.query = '';
    document.body.classList.remove('in-vault');
    const pwInput = h('input', { id: 'sl-master', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: t('login.master'), 'aria-label': t('login.master') });
    const showPw = iconBtn('eye', t('show'), () => { const on = pwInput.type === 'password'; pwInput.type = on ? 'text' : 'password'; showPw.setAttribute('aria-pressed', String(on)); showPw.replaceChildren(icon(on ? 'eyeOff' : 'eye')); }, { type: 'button', 'aria-pressed': 'false' });
    const keyInput = h('input', { id: 'sl-keyfile', type: 'file', 'aria-label': t('softlock.keyfile') });
    const err = h('p', { class: 'error', id: 'sl-error', role: 'alert' });
    const btn = h('button', { type: 'submit', id: 'sl-unlock', class: 'primary big' }, icon('lock'), h('span', { class: 'label', text: t('softlock.unlock') }));
    const discard = h('button', { type: 'button', id: 'sl-discard', class: 'link', text: t('softlock.discard') });
    const form = h('form', { class: 'login-form stack', id: 'softlock-form' },
        v.hasPassword ? h('div', { class: 'pw-row' }, h('div', { class: 'pw-field' }, pwInput, showPw)) : null,
        v.hasKeyfile ? filePicker(keyInput, { icon: 'key', button: t('softlock.keyfile'), placeholder: t('login.keyfile.none') }) : null,
        err, btn, h('div', { class: 'softlock-more' }, discard));
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        try {
            const file = keyInput.files[0];
            const keyfile = v.hasKeyfile && file ? await file.arrayBuffer() : null;
            let ok = false;
            try { ok = await v.matchesCredentials(pwInput.value, keyfile); } catch { /* unreadable key file: counts as wrong */ }
            if (!ok) { err.textContent = t('softlock.wrong'); pwInput.select(); return; }
            pwInput.value = '';
            unlock();
        } finally {
            btn.disabled = false;
        }
    });
    discard.addEventListener('click', async () => {
        if (await confirmDiscard()) ctx.ui.showLogin(t('locked'));
    });
    const card = h('main', { class: 'login-card' },
        h('div', { class: 'login-top' }, h('h2', { text: t('softlock.title') })),
        lastMessage ? h('p', { class: 'muted', text: lastMessage }) : null,
        h('p', { class: 'softlock-note', id: 'softlock-note', text: t('softlock.note') }),
        form);
    ctx.app.replaceChildren(loginShell(card));
    (v.hasPassword ? pwInput : discard).focus();
}

async function unlock() {
    state.softLocked = false;
    state.lastActivity = Date.now(); state.hiddenSince = 0;
    ctx.ui.showMain();
    refreshDirtyIndicator();
    if (!state.vault?.dirty) return;
    // The changes are still only here: offer to put them somewhere safe right away (download for a local file, upload for WebDAV)
    if (await confirmDialog({ title: t('softlock.save.title'), message: t('softlock.save.msg'), confirmLabel: t('softlock.save.now'), cancelLabel: t('softlock.later') })) doSave();
}
