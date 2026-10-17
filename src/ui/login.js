// Anmeldung: Quelle waehlen (Nextcloud/WebDAV oder lokale Datei), Master-Passwort + optionale Schluesseldatei, Entschluesseln im Browser.
import { Vault, VaultError, KDF_LABEL } from '../vault.js';
import { DavFile, DavError, NetworkError, isOffline } from '../webdav.js';
import { cacheGet, wipeLocalData } from '../cache.js';
import { loadSettings, saveSettings } from '../settings.js';
import { nextcloudAuth, davUrlFor, normalizeUserPath, fetchPepper } from '../nextcloud.js';
import { t, fmtDate, errText } from '../i18n.js';
import { ctx, params, pref, setStatus, applyTheme, kfStore, kfFileId } from './ctx.js';
import { KeyfileStoreError, isWeakerThan } from '../keyfile-store.js';
import { h, icon, iconBtn, toast } from './dom.js';
import { stopTimers, startTimers, ensureOfflineApp, syncNow, refreshDirtyIndicator } from './session.js';
import { openSettings } from './settings-dialog.js';

const { state } = ctx;

export function showLogin(message) {
    stopTimers();
    state.vault = null; state.selEntry = null; state.editing = null; state.query = '';
    document.body.classList.remove('in-vault');
    const NC = ctx.NC;
    const mode = pref('mode') || 'dav';
    const urlInput = h('input', { id: 'dav-url', type: 'url', placeholder: 'https://cloud.example.org/remote.php/dav/files/NAME/Passwoerter.kdbx', value: params.get('url') || pref('url'), autocomplete: 'off' });
    const userInput = h('input', { id: 'dav-user', type: 'text', value: params.get('user') || pref('user'), autocomplete: 'username' });
    const passInput = h('input', { id: 'dav-pass', type: 'password', autocomplete: 'current-password' });
    const fileInput = h('input', { id: 'local-file', type: 'file', accept: '.kdbx' });
    const masterInput = h('input', { id: 'master', type: 'password', autocomplete: 'off', required: true, spellcheck: 'false', autocapitalize: 'off' });
    const keyInput = h('input', { id: 'keyfile', type: 'file' });
    const keyName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    keyInput.addEventListener('change', () => { keyName.textContent = keyInput.files[0]?.name || t('login.keyfile.none'); });
    const kfRemember = h('input', { type: 'checkbox', id: 'kf-remember' });
    const kfRememberRow = h('label', { class: 'check small', hidden: true }, kfRemember, h('span', {}, t('login.kf.remember'), h('small', { class: 'muted', text: ' ' + t(NC?.pepperUrl ? 'login.kf.remember.hint.nc' : 'login.kf.remember.hint') })));
    const kfUse = h('input', { type: 'checkbox', id: 'kf-use', checked: true });
    const kfUseName = h('span', {});
    const kfForget = h('button', { type: 'button', class: 'link', id: 'kf-forget', text: t('login.kf.forget') });
    const kfUseRow = h('div', { class: 'kf-used', id: 'kf-remembered', hidden: true }, h('label', { class: 'check small' }, kfUse, kfUseName), kfForget);
    const ncPathInput = h('input', { id: 'nc-path', type: 'text', placeholder: '/Dokumente/Passwoerter.kdbx', value: NC?.file || pref('ncfile'), autocomplete: 'off', readonly: !!NC?.file });
    const davBox = NC
        ? h('div', { id: 'dav-box', class: 'stack' },
            h('label', {}, h('span', { text: NC.file ? t('login.nc.file') : t('login.nc.path') }), ncPathInput),
            NC.file ? null : h('p', { class: 'hint', text: t('login.nc.tip') }))
        : h('div', { id: 'dav-box', class: 'stack' },
            h('label', {}, h('span', { text: t('login.dav.url') }), urlInput),
            h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('login.dav.user') }), userInput), h('label', {}, h('span', { text: t('login.dav.pass') }), passInput)),
            h('p', { class: 'hint', text: t('login.dav.hint') }));
    const fileBox = h('div', { id: 'file-box', class: 'stack', hidden: true }, h('label', {}, h('span', { text: t('login.file') }), fileInput));
    const seg = (value, label, ic) => h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'src', value, checked: mode === value, onchange: () => { davBox.hidden = value !== 'dav'; fileBox.hidden = value !== 'file'; } }), h('span', {}, icon(ic), label));
    davBox.hidden = mode !== 'dav'; fileBox.hidden = mode !== 'file';
    const offlineBox = h('input', { type: 'checkbox', id: 'offline-opt', checked: ctx.settings.offline });
    let wipeArmed = false;
    const wipeBtn = h('button', { type: 'button', id: 'wipe-btn', class: 'link danger-text', text: t('login.wipe'), onclick: async () => {
        if (!wipeArmed) { wipeArmed = true; wipeBtn.textContent = t('login.wipe.confirm'); return; }
        await wipeLocalData();
        ctx.settings = loadSettings(); applyTheme();
        showLogin(t('login.wiped'));
    } });
    const err = h('p', { class: 'error', id: 'login-error', role: 'alert', text: message || '' });
    const btn = h('button', { type: 'submit', id: 'open-btn', class: 'primary big' }, icon('unlock'), h('span', { class: 'label', text: t('login.open') }));
    const showPw = iconBtn('eye', t('show'), () => { const on = masterInput.type === 'password'; masterInput.type = on ? 'text' : 'password'; showPw.replaceChildren(icon(on ? 'eyeOff' : 'eye')); }, { type: 'button' });
    const form = h('form', { class: 'login-form stack', id: 'login-form' },
        h('div', { class: 'seg-group', role: 'radiogroup' }, seg('dav', NC ? t('login.src.nc') : t('login.src.dav'), 'cloud'), seg('file', t('login.src.file'), 'file')),
        davBox, fileBox,
        h('label', {}, h('span', { text: t('login.master') }), h('div', { class: 'input-group' }, masterInput, showPw)),
        h('label', {}, h('span', { text: t('login.keyfile') }), h('div', { class: 'filepick' }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), keyName, keyInput)),
        kfRememberRow, kfUseRow,
        h('label', { class: 'check' }, offlineBox, h('span', { text: t('login.offline') })),
        err, btn);
    // --- gemerkte Schluesseldatei (siehe keyfile-store.js / docs/KEYFILE-MEMORY.md)
    const currentSrc = () => form.querySelector('input[name=src]:checked').value;
    const kfIdNow = () => {
        if (currentSrc() === 'file') return fileInput.files[0] ? kfFileId(fileInput.files[0].name) : null;
        if (NC) { const pth = normalizeUserPath(ncPathInput.value); return pth && !pth.endsWith('/') ? `nc:${NC.user}:${pth}` : null; }
        return urlInput.value.trim() ? `dav:${urlInput.value.trim()}` : null;
    };
    let kfInfo = null;
    const refreshKf = async () => {
        const id = kfIdNow();
        kfInfo = id ? await kfStore.info(id).catch(() => null) : null;
        const chosen = !!keyInput.files[0];
        kfRememberRow.hidden = !chosen;
        kfUseRow.hidden = !kfInfo || chosen;
        if (kfInfo) kfUseName.textContent = t('login.kf.use', { name: kfInfo.name || t('login.keyfile') });
    };
    kfForget.addEventListener('click', async () => { const id = kfIdNow(); if (id) await kfStore.forget(id); toast(t('login.kf.forgotten')); refreshKf(); });
    for (const el of [keyInput, fileInput]) el.addEventListener('change', refreshKf);
    for (const el of [urlInput, ncPathInput, userInput]) el.addEventListener('input', () => { clearTimeout(refreshKf.t); refreshKf.t = setTimeout(refreshKf, 200); });
    form.addEventListener('change', (e) => { if (e.target.name === 'src') refreshKf(); });
    refreshKf();
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        if (btn.disabled) return; // laufender Versuch
        btn.disabled = true;
        let keyfile, kfId;
        btn.querySelector('.label').textContent = t('login.decrypting');
        try {
            const src = form.querySelector('input[name=src]:checked').value;
            pref('mode', src);
            // Kennung, Schluesseldatei und Merk-Wunsch JETZT festhalten: Eingaben koennen sich waehrend Netz/KDF noch aendern
            kfId = kfIdNow();
            const kfPicked = keyInput.files[0] || null;
            const wantRemember = !!kfPicked && kfRemember.checked;
            const wantRecall = !kfPicked && kfUse.checked;
            // Nextcloud: gemerkte Schluesseldateien zusaetzlich an einen Geheimwert auf dem Server gebunden (Format v2, siehe keyfile-store.js)
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
                    pref('ncfile', userPath); // merken: der Offline-Start der App-Seite kennt den ?open=-Parameter nicht
                    dav = new DavFile({ url: davUrlFor(NC, userPath), auth: ncAuth });
                } else {
                    if (!urlInput.value.trim()) throw new VaultError(t('err.dav.url'));
                    pref('url', urlInput.value.trim()); pref('user', userInput.value);
                    dav = new DavFile({ url: urlInput.value.trim(), user: userInput.value, pass: passInput.value });
                }
                name = decodeURIComponent(new URL(dav.url, location.href).pathname.split('/').pop());
                if (ctx.settings.offline) cacheInfo = { key: NC ? `nc:${NC.user}:${normalizeUserPath(ncPathInput.value)}` : `dav:${urlInput.value.trim()}`, name };
                const cached = cacheInfo ? await cacheGet(cacheInfo.key).catch(() => null) : null;
                let got = null;
                try {
                    got = await dav.get();
                } catch (e) {
                    if (!isOffline(e)) throw e;
                    if (!cached) throw new VaultError(cacheInfo ? t('err.offline.nocopy') : t('err.offline.nooption'));
                }
                if (!got) { buf = cached.bytes; etag = cached.etag; unsynced = !!cached.modified; fromCache = true; offlineOpen = true; cachedAt = cached.syncDate; }
                else if (cached?.modified) { buf = cached.bytes; etag = cached.etag; unsynced = true; fromCache = true; remoteBuf = got.buf; }
                else { buf = got.buf; etag = got.etag; }
            } else {
                const f = fileInput.files[0];
                if (!f) throw new VaultError(t('err.file.none'));
                buf = await f.arrayBuffer(); name = f.name;
            }
            if (kfPicked) keyfile = new Uint8Array(await kfPicked.arrayBuffer()); // File-Objekt ist unveraenderlich, auch wenn die Auswahl wechselt
            await new Promise((r) => setTimeout(r, 30)); // UI-Text vor der KDF-Berechnung anzeigen
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
                throw e;
            }
            vault.backupKeep = ctx.settings.backupKeep;
            // Nextcloud nennt die Rechte (Freigabe nur zum Lesen?); andere WebDAV-Server nicht, dann entscheidet erst das Speichern
            const perms = NC && dav && !offlineOpen ? await dav.permissions() : null;
            const readOnly = perms !== null && !perms.includes('W');
            let kfNote = '';
            const dbKdf = () => { const k = vault.securitySettings(); return { kdf: KDF_LABEL[k.kdf], memoryKiB: k.memoryKiB ?? 0, iterations: k.iterations ?? k.rounds }; };
            if (usedRemembered && (isWeakerThan(kfRec.kdf, dbKdf()) || (usePepper && !kfRec.server))) {
                // Aelterer/schwaecherer Datensatz (v0.4.0, Datenbank-KDF inzwischen erhoeht, in Nextcloud noch ohne Server-Geheimwert):
                // im Hintergrund mit aktuellen Parametern neu verschluesseln. Klappt das nicht (Server weg), bleibt der alte Datensatz.
                const copy = keyfile.slice(), pw = masterInput.value, params = dbKdf();
                (async () => {
                    const pepper = usePepper ? await getPepper() : null;
                    await kfStore.remember({ id: kfId, name: kfRec.name, keyfile: copy, password: pw, params, pepper });
                })().catch(() => {}).finally(() => copy.fill(0));
            }
            if (wantRemember && kfId) {
                try {
                    let pepper = null;
                    if (usePepper) {
                        try { pepper = await getPepper(); } catch (e) { throw Object.assign(new Error(t('err.kf.save.server', { msg: errText(e) })), { shown: true }); }
                    }
                    await kfStore.remember({ id: kfId, name: kfPicked.name, keyfile, password: masterInput.value, params: dbKdf(), pepper });
                    kfNote = ' ' + t('login.kf.saved');
                } catch (e) {
                    toast(e.shown ? e.message : e instanceof KeyfileStoreError && e.code === 'toolarge' ? t('err.kf.toolarge') : t('err.kf.save', { msg: e.message }), { kind: 'warn' });
                }
            }
            masterInput.value = ''; passInput.value = '';
            state.vault = vault; state.source = { type: src, name };
            state.filter = { type: 'all' }; state.lastActivity = Date.now(); state.offlineMode = offlineOpen; state.lastSyncFailed = false;
            ctx.ui.showMain();
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
            keyfile?.fill(0); keyfile = undefined; // Vault.open arbeitet mit einer eigenen Kopie
            btn.disabled = false;
            btn.querySelector('.label').textContent = t('login.open');
        }
    });
    const hero = h('aside', { class: 'login-hero' },
        h('div', { class: 'brand-mark' }, icon('shield')),
        h('h1', { text: 'KeePassNC' }),
        h('p', { class: 'tagline', text: t('login.tagline') }),
        h('ul', { class: 'trust' },
            h('li', {}, icon('lock'), h('span', { text: t('login.trust.1') })),
            h('li', {}, icon('cloudOff'), h('span', { text: t('login.trust.2') })),
            h('li', {}, icon('file'), h('span', { text: t('login.trust.3') }))));
    const card = h('main', { class: 'login-card' },
        h('div', { class: 'login-top' },
            h('h2', { text: t('login.title') }),
            h('div', { class: 'row-gap' },
                NC?.filesUrl ? h('a', { href: NC.filesUrl, id: 'back-link', class: 'link', text: '← ' + t('login.back') }) : null,
                iconBtn('settings', t('settings'), () => openSettings({ loginMode: true }), { id: 'login-settings' }))),
        form,
        h('footer', { class: 'login-foot' }, wipeBtn, h('span', { class: 'muted', text: 'v' + __VERSION__ })));
    ctx.app.replaceChildren(h('div', { class: 'login' }, hero, card));
    masterInput.focus();
}
