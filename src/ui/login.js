// Login: pick a source (Nextcloud/WebDAV or local file), master password + optional key file, decrypt in the browser.
import { Vault, VaultError } from '../vault.js';
import { DavFile, DavError, NetworkError, isOffline, offlineFailKey } from '../webdav.js';
import { cacheGet } from '../cache.js';
import { loadSettings, saveSettings } from '../settings.js';
import { nextcloudAuth, warmNextcloudAuth, davUrlFor, normalizeUserPath, fetchPepper } from '../nextcloud.js';
import { t, fmtDate, errText } from '../i18n.js';
import { ctx, params, pref, setStatus, applyTheme, kfStore, kfFileId, clearMarks } from './ctx.js';
import { KeyfileStoreError, isWeakerThan } from '../keyfile-store.js';
import { h, icon, iconBtn, toast, closeAllDialogs } from './dom.js';
import { filePicker } from './file-picker.js';
import { stopTimers, startTimers, ensureOfflineApp, syncNow, refreshDirtyIndicator } from './session.js';
import { stopDetailTimers } from './detail.js';
import { openSettings } from './settings-dialog.js';
import { pickFolder, splitPath } from './folder-picker.js';
import { remoteFields } from './remote.js';

const { state } = ctx;

export function showLogin(message) {
    stopTimers();
    // Before clearing: open dialogs (attached to <body>, not #app) and the TOTP ticker (holds the secret) must not survive locking
    closeAllDialogs();
    stopDetailTimers();
    state.vault = null; state.selEntry = null; state.editing = null; state.query = ''; clearMarks();
    document.body.classList.remove('in-vault');
    const NC = ctx.NC;
    warmNextcloudAuth(NC);
    // Standalone page: with no previous choice (and no ?url=) start with a local file, that needs no server
    const mode = pref('mode') || (NC || params.get('url') ? 'dav' : 'file');
    // Without the Nextcloud app: Nextcloud address + path (or the WebDAV address via the link, as before)
    const remote = NC ? null : remoteFields('dav', { urlValue: params.get('url') || pref('url'), urlPlaceholder: t('login.dav.url.ph'),
        onMode: (m) => { pathBox.hidden = m !== 'nc'; refreshKf(); }, onFound: () => refreshKf() });
    const urlInput = remote?.url || h('input'), userInput = remote?.user || h('input'), passInput = remote?.pass || h('input');
    const fileInput = h('input', { id: 'local-file', type: 'file', accept: '.kdbx', 'aria-label': t('login.file') });
    const fileGroup = filePicker(fileInput, { icon: 'folderOpen', button: t('login.nc.browse') });
    const masterInput = h('input', { id: 'master', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: t('login.master'), 'aria-label': t('login.master') }); // empty: database with key file only
    const keyInput = h('input', { id: 'keyfile', type: 'file', 'aria-label': t('login.keyfile') });
    const keyGroup = filePicker(keyInput, { icon: 'key', button: t('login.keyfile.choose'), placeholder: t('login.keyfile') });
    keyInput.addEventListener('change', () => { if (keyInput.files[0]) more.open = true; });
    const kfRemember = h('input', { type: 'checkbox', id: 'kf-remember' });
    const kfRememberRow = h('label', { class: 'check small', hidden: true }, kfRemember, h('span', {}, t('login.kf.remember'), h('small', { class: 'muted hint', text: t(NC?.pepperUrl ? 'login.kf.remember.hint.nc' : 'login.kf.remember.hint') })));
    const kfUseName = h('span', {});
    const kfForget = h('button', { type: 'button', class: 'link', id: 'kf-forget', text: t('login.kf.forget') });
    const kfUseRow = h('div', { class: 'kf-used', id: 'kf-remembered', hidden: true }, kfUseName, kfForget);
    const ncPathInput = h('input', { id: NC ? 'nc-path' : 'dav-path', type: 'text', placeholder: t('login.nc.path.ph'), value: NC ? NC.file || pref('ncfile') : remote.legacy?.path || '',
        autocomplete: 'off', readonly: !!NC?.file, 'aria-label': NC?.file ? t('login.nc.file') : t('login.nc.path') });
    // [Browse]: pick a file in your own Nextcloud instead of typing the path; starts in the folder of the path in the field
    const browseBtn = !NC?.file ? h('button', { type: 'button', id: NC ? 'nc-browse' : 'dav-browse', class: 'btn' }, icon('folderOpen'), h('span', { text: t('login.nc.browse') })) : null;
    browseBtn?.addEventListener('click', async () => {
        err.textContent = '';
        let loc = NC, auth;
        if (NC) auth = nextcloudAuth(NC);
        else {
            if (!remote.ready()) { err.textContent = t('err.nc.creds'); return; }
            auth = remote.auth();
            try { loc = { davBase: await remote.davBase() }; } catch (e) { err.textContent = errText(e); return; }
        }
        const cur = normalizeUserPath(ncPathInput.value);
        const bad = cur.split('/').some((x) => x === '.' || x === '..');
        const { folder, name } = !cur || bad ? { folder: '/', name: '' } : cur.endsWith('/') ? { folder: cur.replace(/\/+$/, '') || '/', name: '' } : splitPath(cur);
        const picked = await pickFolder({ NC: loc, auth, start: folder, mode: 'file', select: name });
        if (picked === null) return;
        ncPathInput.value = picked;
        refreshKf();
        masterInput.focus();
    });
    // Hint as a tooltip on label and field instead of its own line
    const pathBox = h('label', NC && !NC.file ? { title: t('login.nc.tip') } : {}, browseBtn ? h('div', { class: 'input-group' }, ncPathInput, browseBtn) : ncPathInput);
    const davBox = NC
        ? h('div', { id: 'dav-box', class: 'stack' }, NC.file ? fileChip(NC.file) : null, pathBox)
        : h('div', { id: 'dav-box', class: 'stack' }, remote.serverBox, remote.urlBox, remote.creds, pathBox, remote.foot);
    pathBox.hidden = !!NC?.file; // opened from Files: the file shows up as a card, the read-only field only stays for the logic
    const fileBox = h('div', { id: 'file-box', class: 'stack', hidden: true }, fileGroup);
    const seg = (value, label, ic) => h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'src', value, checked: mode === value, onchange: () => { davBox.hidden = value !== 'dav'; fileBox.hidden = value !== 'file'; pref('mode', value); } }), h('span', {}, icon(ic), label));
    davBox.hidden = mode !== 'dav'; fileBox.hidden = mode !== 'file';
    const offlineBox = h('input', { type: 'checkbox', id: 'offline-opt', checked: ctx.settings.offline });
    const err = h('p', { class: 'error', id: 'login-error', role: 'alert', text: message || '' });
    const btn = h('button', { type: 'submit', id: 'open-btn', class: 'primary big', title: t('login.trust.short'), 'aria-description': t('login.trust.short') }, icon('lock'), h('span', { class: 'label', text: t('login.open') }));
    const showPw = iconBtn('eye', t('show'), () => { const on = masterInput.type === 'password'; masterInput.type = on ? 'text' : 'password'; showPw.setAttribute('aria-pressed', String(on)); showPw.replaceChildren(icon(on ? 'eyeOff' : 'eye')); }, { type: 'button', 'aria-pressed': 'false' });
    // Only those who need a key file and offline copy see them: always collapsed, even when the offline copy is on
    const more = h('details', { class: 'login-more', id: 'login-more' },
        h('summary', { text: t('login.more') }),
        h('div', { class: 'stack' },
            keyGroup,
            kfRememberRow,
            h('label', { class: 'check' }, offlineBox, h('span', { text: t('login.offline') }))));
    const form = h('form', { class: 'login-form stack', id: 'login-form' },
        h('div', { class: 'seg-group', role: 'radiogroup', hidden: !!NC?.file }, seg('dav', NC ? t('login.src.nc') : t('login.src.dav'), 'cloud'), seg('file', t('login.src.file'), 'file')),
        davBox, fileBox,
        h('div', { class: 'pw-row' }, h('div', { class: 'pw-field' }, masterInput, showPw)),
        kfUseRow, more,
        err, btn);
    // --- remembered key file (see keyfile-store.js / docs/KEYFILE-MEMORY.md)
    const currentSrc = () => form.querySelector('input[name=src]:checked').value;
    const kfIdNow = () => {
        if (currentSrc() === 'file') return fileInput.files[0] ? kfFileId(fileInput.files[0].name) : null;
        if (NC) { const pth = normalizeUserPath(ncPathInput.value); return pth && !pth.endsWith('/') ? `nc:${NC.user}:${pth}` : null; }
        if (remote.mode() === 'nc') {
            const pth = normalizeUserPath(ncPathInput.value), base = remote.guess();
            try { return base && pth && !pth.endsWith('/') ? `dav:${remote.fileUrl(base, pth)}` : null; } catch { return null; } // ".." in the path
        }
        return urlInput.value.trim() ? `dav:${urlInput.value.trim()}` : null;
    };
    let kfInfo = null;
    const refreshKf = async () => {
        const id = kfIdNow();
        kfInfo = id ? await kfStore.info(id).catch(() => null) : null;
        const chosen = !!keyInput.files[0];
        kfRememberRow.hidden = !chosen;
        kfUseRow.hidden = !kfInfo || chosen;
        if (kfInfo) kfUseName.title = kfUseName.textContent = t('login.kf.use', { name: kfInfo.name || t('login.keyfile') });
    };
    kfForget.addEventListener('click', async () => { const id = kfIdNow(); if (id) await kfStore.forget(id); toast(t('login.kf.forgotten')); refreshKf(); });
    for (const el of [keyInput, fileInput]) el.addEventListener('change', refreshKf);
    for (const el of [urlInput, ncPathInput, userInput, remote?.server].filter(Boolean)) el.addEventListener('input', () => { clearTimeout(refreshKf.t); refreshKf.t = setTimeout(refreshKf, 200); });
    form.addEventListener('change', (e) => { if (e.target.name === 'src') refreshKf(); });
    if (remote) remote.setMode(remote.mode()); else refreshKf();
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        if (btn.disabled) return; // attempt in progress
        btn.disabled = true; btn.classList.add('busy');
        let keyfile, kfId;
        btn.querySelector('.label').textContent = t('login.decrypting');
        try {
            const src = form.querySelector('input[name=src]:checked').value;
            pref('mode', src);
            // Capture id, key file and remember choice NOW: inputs can still change during network/KDF
            kfId = kfIdNow();
            const kfPicked = keyInput.files[0] || null;
            const wantRemember = !!kfPicked && kfRemember.checked;
            const wantRecall = !kfPicked; // a remembered key file is always used unless one is picked by hand
            // Without a password a picked key file is required; a remembered one is only decrypted by the master password
            if (!masterInput.value && !kfPicked) throw new VaultError(t('err.login.empty'));
            // Nextcloud: remembered key files are additionally bound to a secret on the server (format v2, see keyfile-store.js)
            const ncAuth = NC ? nextcloudAuth(NC) : null;
            const usePepper = !!(NC && NC.pepperUrl);
            let pepperP = null;
            const getPepper = () => (pepperP ||= fetchPepper(NC, ncAuth));
            let buf, dav = null, etag = null, name, cacheInfo = null, unsynced = false, remoteBuf, fromCache = false, offlineOpen = false, cachedAt = null;
            ctx.settings.offline = offlineBox.checked && src === 'dav';
            if (offlineBox.checked !== loadSettings().offline) saveSettings({ ...loadSettings(), offline: offlineBox.checked });
            if (src === 'dav') {
                if (NC) {
                    const userPath = normalizeUserPath(ncPathInput.value);
                    if (!userPath || userPath.endsWith('/')) throw new VaultError(t('err.nc.path'));
                    pref('ncfile', userPath); // remember it: the offline start of the app page doesn't know the ?open= parameter
                    dav = new DavFile({ url: davUrlFor(NC, userPath), auth: ncAuth });
                } else {
                    const user = userInput.value, pass = passInput.value, davMode = remote.mode();
                    let url = urlInput.value.trim();
                    if (davMode === 'nc') {
                        const userPath = normalizeUserPath(ncPathInput.value);
                        if (!remote.root()) throw new VaultError(t('err.nc.server'));
                        if (!userPath || userPath.endsWith('/')) throw new VaultError(t('err.nc.path'));
                        url = remote.fileUrl(await remote.davBase({ offline: true }), userPath);
                        kfId = `dav:${url}`; // same id as with the WebDAV address; the base may only have come from the server just now
                    } else if (!url) throw new VaultError(t('err.dav.url'));
                    pref('url', url); pref('user', user); pref('davmode', davMode);
                    dav = new DavFile({ url, user, pass });
                }
                name = decodeURIComponent(new URL(dav.url, location.href).pathname.split('/').pop());
                if (ctx.settings.offline) cacheInfo = { key: NC ? `nc:${NC.user}:${normalizeUserPath(ncPathInput.value)}` : `dav:${dav.url}`, name };
                const cached = cacheInfo ? await cacheGet(cacheInfo.key).catch(() => null) : null;
                let got = null;
                try {
                    got = await dav.get();
                } catch (e) {
                    if (!isOffline(e)) throw e;
                    if (!cached) throw new VaultError(t(offlineFailKey(e, !!cacheInfo), { status: e.status, ...e.vars }));
                }
                if (!got) { buf = cached.bytes; etag = cached.etag; unsynced = !!cached.modified; fromCache = true; offlineOpen = true; cachedAt = cached.syncDate; }
                else if (cached?.modified) { buf = cached.bytes; etag = cached.etag; unsynced = true; fromCache = true; remoteBuf = got.buf; }
                else { buf = got.buf; etag = got.etag; }
            } else {
                const f = fileInput.files[0];
                if (!f) throw new VaultError(t('err.file.none'));
                buf = await f.arrayBuffer(); name = f.name;
            }
            if (kfPicked) keyfile = new Uint8Array(await kfPicked.arrayBuffer()); // the File object is immutable, even if the selection changes
            await new Promise((r) => setTimeout(r, 30)); // show the UI text before the KDF computation
            let usedRemembered = false;
            const kfRec = wantRecall && kfId ? await kfStore.info(kfId).catch(() => null) : null;
            if (kfRec) {
                let pepper = null;
                if (kfRec.server) {
                    try { pepper = await getPepper(); } catch (e) { if (isOffline(e)) throw new VaultError(t('err.kf.server')); throw e; }
                }
                try { keyfile = (await kfStore.recall({ id: kfId, password: masterInput.value, pepper })) || undefined; usedRemembered = !!keyfile; }
                catch (e) {
                    if (!(e instanceof KeyfileStoreError)) throw e;
                    if (e.code === 'revoked') { await kfStore.forget(kfId).catch(() => {}); refreshKf(); throw new VaultError(t('err.kf.revoked')); }
                    if (e.code === 'pepper') throw new VaultError(t('err.kf.server'));
                    throw new VaultError(t(e.code === 'wrong' ? (src === 'file' ? 'err.kf.wrong.file' : 'err.kf.wrong') : 'err.kf.format'));
                }
            }
            let vault;
            try {
                vault = await Vault.open({ buf, password: masterInput.value, keyfile, dav, etag, cache: cacheInfo, unsynced, remoteBuf, fromCache });
            } catch (e) {
                if (usedRemembered && e instanceof VaultError) throw new VaultError(t('err.kf.mismatch'));
                // Unsynced local copy (old credentials) while new ones were set elsewhere: the way in goes through the old ones
                if (unsynced && e instanceof VaultError && e.key === 'e.badkey') throw new VaultError(t('err.cache.oldcreds'));
                throw e;
            }
            vault.backupKeep = ctx.settings.backupKeep;
            // Nextcloud reports the permissions (share read-only?); other WebDAV servers don't, then saving decides
            const perms = NC && dav && !offlineOpen ? await dav.permissions() : null;
            const readOnly = perms !== null && !perms.includes('W');
            let kfNote = '';
            if (usedRemembered && (isWeakerThan(kfRec.kdf, vault.kdfParams()) || (usePepper && !kfRec.server))) {
                // Older/weaker record (v0.4.0, database KDF raised since, in Nextcloud still without server secret):
                // re-encrypt in the background with current parameters. If that fails (server gone), the old record stays.
                const copy = keyfile.slice(), pw = masterInput.value, params = vault.kdfParams();
                state.kfBusy = (async () => {
                    const pepper = usePepper ? await getPepper() : null;
                    await kfStore.remember({ id: kfId, name: kfRec.name, keyfile: copy, password: pw, params, pepper });
                })().catch(() => {}).finally(() => copy.fill(0));
            }
            if (wantRemember && kfId && !vault.hasPassword) toast(t('err.kf.nopw'), { kind: 'warn' }); // without a password the record would be unprotected
            else if (wantRemember && kfId) {
                try {
                    let pepper = null;
                    if (usePepper) {
                        try { pepper = await getPepper(); } catch (e) { throw Object.assign(new Error(t('err.kf.save.server', { msg: errText(e) })), { shown: true }); }
                    }
                    await kfStore.remember({ id: kfId, name: kfPicked.name, keyfile, password: masterInput.value, params: vault.kdfParams(), pepper });
                    kfNote = ' ' + t('login.kf.saved');
                } catch (e) {
                    toast(e.shown ? e.message : e instanceof KeyfileStoreError && e.code === 'toolarge' ? t('err.kf.toolarge') : t('err.kf.save', { msg: e.message }), { kind: 'warn' });
                }
            }
            masterInput.value = ''; passInput.value = '';
            state.vault = vault; state.source = { type: src, name, kfId, readOnly };
            state.filter = { type: 'all' }; state.lastActivity = Date.now(); state.offlineMode = offlineOpen; state.lastSyncFailed = false;
            // Lock pops open, a short breather, then the vault fades in (immediately if motion is reduced)
            const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!calm) { btn.classList.replace('busy', 'done'); btn.querySelector('.icon').replaceWith(icon('unlock')); await new Promise((r) => setTimeout(r, 260)); }
            ctx.ui.showMain();
            if (!calm) document.querySelector('.shell')?.classList.add('enter');
            if (offlineOpen) setStatus(t('open.offline', { name, version: vault.versionLabel, date: fmtDate(cachedAt, true), extra: unsynced ? t('open.offline.unsynced') : '' }), 'warn');
            else if (readOnly) setStatus(t('open.ok', { name, version: vault.versionLabel }) + ' ' + t('open.readonly') + kfNote, 'warn');
            else setStatus(t('open.ok', { name, version: vault.versionLabel }) + (unsynced ? ' ' + t('open.merging') : '') + kfNote);
            refreshDirtyIndicator(); startTimers(); ensureOfflineApp();
            if (unsynced && !offlineOpen) syncNow({ announce: true });
        } catch (e) {
            const known = e instanceof VaultError || e instanceof DavError || e instanceof NetworkError;
            err.textContent = known ? errText(e) : t('err.generic', { msg: e.message || e });
            if (!known) console.error(e);
        } finally {
            keyfile?.fill(0); keyfile = undefined; // Vault.open works on its own copy
            btn.disabled = false; btn.classList.remove('busy', 'done');
            btn.querySelector('.label').textContent = t('login.open');
        }
    });
    const card = h('main', { class: 'login-card' },
        NC?.filesUrl ? h('div', { class: 'back-line' }, h('a', { href: NC.filesUrl, id: 'back-link', class: 'link', text: '‹ ' + t('login.back') })) : null,
        h('div', { class: 'login-top' },
            h('h2', { text: t('login.title') }),
            h('div', { class: 'row-gap' },
                iconBtn('settings', t('settings'), () => openSettings({ loginMode: true }), { id: 'login-settings' }))),
        form,
        h('p', { class: 'login-alt' },
            h('span', {}, h('span', { class: 'muted', text: t('login.new.q') }), ' ',
                h('button', { type: 'button', id: 'new-db-link', class: 'link', text: t('login.new'), onclick: () => ctx.ui.showCreate() })),
            h('span', { class: 'muted', text: 'v' + __VERSION__ })));
    ctx.app.replaceChildren(loginShell(card));
    (remote?.mode() === 'nc' && !remote.server.value ? remote.server : masterInput).focus();
}

/** The file that came from "Files": name large, folder small below it. */
function fileChip(path) {
    const i = path.lastIndexOf('/');
    return h('div', { class: 'file-chip', id: 'nc-file-chip' }, icon('file'),
        h('span', {}, h('strong', { text: path.slice(i + 1) }), h('small', { class: 'muted', text: path.slice(0, i) || '/' })));
}

/** Frame of the login (also "New database"): in Nextcloud just the card under the header bar, standalone with the hero area next to it. */
export function loginShell(card) {
    if (!ctx.NC) return h('div', { class: 'login' }, loginHero(), card);
    const title = card.querySelector('.login-top h2');
    const row = h('div', { class: 'row-gap' });
    title.replaceWith(row);
    row.append(h('div', { class: 'login-seal', 'aria-hidden': 'true' }, icon('shield')), title);
    return h('div', { class: 'login solo' }, h('div', { class: 'login-mark', 'aria-hidden': 'true' }, icon('shield-fine')), card);
}

/** Left half of the login (also when creating a new database). */
export function loginHero() {
    return h('aside', { class: 'login-hero' },
        h('div', { class: 'login-mark', 'aria-hidden': 'true' }, icon('shield-fine')),
        h('div', { class: 'brand-mark' }, icon('shield')),
        h('h1', { text: 'KeePassNC' }),
        h('p', { class: 'tagline', text: t('login.tagline') }),
        h('ul', { class: 'trust' },
            h('li', {}, icon('lock'), h('span', { text: t('login.trust.1') })),
            h('li', {}, icon('cloudOff'), h('span', { text: t('login.trust.2') })),
            h('li', {}, icon('file'), h('span', { text: t('login.trust.3') }))));
}
