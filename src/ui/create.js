// Neue Datenbank anlegen, in einer Maske statt eines Assistenten: wo sie liegen soll, Master-Passwort, optional Schluesseldatei.
// Verschluesselung ohne Fragen (NEW_DB in core/kdf-policy.js, Durchlaeufe aus einem Probelauf), aendern geht spaeter in den
// Datenbank-Einstellungen. Eine vorhandene Datei wird nie ueberschrieben (DavFile.create); danach ist die Datenbank gleich offen.
import { Vault, VaultError } from '../vault.js';
import { DavFile, DavError, NetworkError } from '../webdav.js';
import { nextcloudAuth, davUrlFor, normalizeUserPath } from '../nextcloud.js';
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { NEW_DB, newDbIterations } from '../core/kdf-policy.js';
import { isOutOfMemory } from '../core/util.js';
import { t, errText } from '../i18n.js';
import { ctx, pref, setStatus, download, kfFileId } from './ctx.js';
import { h, icon, iconBtn, confirmDialog } from './dom.js';
import { startTimers, ensureOfflineApp, refreshDirtyIndicator } from './session.js';
import { newPasswordFields, newKeyfileFlow, readFile } from './new-credentials.js';
import { trialRun } from './db-settings.js';
import { pickFolder, folderLabel, joinPath, splitPath } from './folder-picker.js';
import { loginShell } from './login.js';
import { remoteFields } from './remote.js';
import { openSettings } from './settings-dialog.js';

const { state } = ctx;
const withExt = (s) => (/\.kdbx$/i.test(s) ? s : s + '.kdbx');
const baseName = (p) => p.split('/').pop().replace(/\.kdbx$/i, '');

/**
 * In Nextcloud nur Name und Ordner: der Ordner kommt aus "+ Neu" in Dateien (?new=), sonst aus der zuletzt geoeffneten Datenbank,
 * sonst das Hauptverzeichnis; [Aendern] oeffnet den Ordner-Browser. Ist der Name dort schon vergeben, sagt die Maske das gleich
 * (und schlaegt selbst einen freien vor, solange niemand etwas eingetippt hat). Ohne Nextcloud-App: die WebDAV-Adresse der Datei.
 */
export function showCreate() {
    const NC = ctx.NC;
    const mode = pref('mode');
    const defName = t('new.file.default');
    const defBase = baseName(defName);
    let folder = '/', startName = defBase, touched = false;
    if (NC?.newFile) { const x = splitPath(normalizeUserPath(NC.newFile)); folder = x.folder; startName = baseName(x.name) || defBase; touched = true; }
    else if (NC && pref('ncfile')) folder = splitPath(normalizeUserPath(pref('ncfile'))).folder;
    const auth = NC ? nextcloudAuth(NC) : null;
    // Ohne Nextcloud-App: Nextcloud-Adresse + Name und Ordner wie in der App, oder ueber den Link die WebDAV-Adresse wie bisher
    const remote = NC ? null : remoteFields('new', { urlPlaceholder: `https://cloud.example.org/remote.php/dav/files/NAME/${defName}`, urlLabel: 'new.dav.url', onMode: () => show() });
    if (remote?.legacy) folder = splitPath(remote.legacy.path).folder; // neben der zuletzt geoeffneten Datenbank
    const urlInput = remote?.url || h('input'), userInput = remote?.user || h('input'), passInput = remote?.pass || h('input');
    /** Name + Ordner statt einer Adresse: in Nextcloud und mit Nextcloud-Adresse. */
    const ncLike = () => !!NC || remote.mode() === 'nc';
    /** Wo der Ordner-Browser und die Namenspruefung lesen: { loc, auth }; null, solange Zugangsdaten fehlen. */
    const davLoc = async () => (NC ? { loc: NC, auth } : remote.ready() ? { loc: { davBase: await remote.davBase() }, auth: remote.auth() } : null);
    const nameInput = h('input', { id: 'new-name', type: 'text', value: startName, autocomplete: 'off', spellcheck: 'false' });
    const nameNote = h('p', { class: 'level-note warn', id: 'new-name-note', 'aria-live': 'polite', hidden: true });
    const folderText = h('span', { class: 'grow', id: 'new-folder', text: folderLabel(folder) });
    const folderRow = h('div', { class: 'folder-row' }, h('span', { class: 'muted', text: t('new.folder') }), icon('folder'), folderText,
        h('button', { type: 'button', class: 'link', id: 'new-folder-btn', text: t('new.folder.change'), onclick: async () => {
            err.textContent = '';
            let at;
            try { at = await davLoc(); } catch (e) { err.textContent = errText(e); return; }
            if (!at) { err.textContent = t('err.nc.creds'); return; }
            const picked = await pickFolder({ NC: at.loc, auth: at.auth, start: folder });
            if (picked === null) return;
            folder = picked; folderText.textContent = folderLabel(folder); check();
        } }));
    const nameBox = h('div', { class: 'stack tight' },
        h('label', {}, h('span', { text: t('new.name') }), h('div', { class: 'input-group' }, nameInput, h('span', { class: 'input-suffix', text: '.kdbx' }))),
        folderRow, nameNote);
    const urlBox = h('div', { class: 'stack' }, remote?.serverBox, remote?.urlBox, remote?.creds);
    const urlFoot = remote?.foot || h('div');
    const fileHint = h('p', { class: 'hint', text: t('new.file.hint') });
    let where = mode === 'file' ? 'file' : 'dav';
    const show = () => {
        nameBox.hidden = !ncLike() && where === 'dav'; folderRow.hidden = !ncLike() || where !== 'dav';
        urlBox.hidden = urlFoot.hidden = !!NC || where !== 'dav'; fileHint.hidden = where !== 'file';
        kf.relabel(); check();
    };
    /** Eingegebener Name ohne .kdbx; '' wenn leer oder ungueltig (Schraegstriche, "." und ".."). */
    const nameValue = () => { const n = nameInput.value.trim().replace(/\.kdbx$/i, ''); return !n || /[/\\]/.test(n) || n === '.' || n === '..' ? '' : n; };
    /** Wo die Datei hinkommt, fuer Datenbank- und Schluesseldatei-Namen. */
    const target = () => (ncLike() || where === 'file' ? nameValue() : urlInput.value.split(/[?#]/)[0].trim());
    const seg = (value, label, ic) => h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'new-src', value, checked: value === where, onchange: () => { where = value; show(); } }), h('span', {}, icon(ic), label));

    // --- Name schon vergeben? Ordnerinhalt einmal je Ordner holen; Fehler beim Listen stoeren nicht, das Anlegen prueft ohnehin.
    const listings = new Map();
    let checkTimer = null;
    function check() {
        clearTimeout(checkTimer);
        if (!ncLike() || where !== 'dav') { nameNote.hidden = true; return; }
        checkTimer = setTimeout(async () => {
            const f = folder;
            const at = await davLoc().catch(() => null); // ohne Zugangsdaten keine Pruefung (und keine Anfrage beim Tippen des Passworts)
            if (!at) { nameNote.hidden = true; return; }
            const k = at.loc.davBase + '\n' + f;
            if (!listings.has(k)) listings.set(k, new DavFile({ url: davUrlFor(at.loc, f), auth: at.auth }).list().then((l) => new Set(l.map((x) => x.name.toLowerCase())), () => null));
            const names = await listings.get(k);
            if (f !== folder || !names) return;
            const taken = (n) => names.has((n + '.kdbx').toLowerCase());
            if (!touched && taken(nameValue())) {
                let i = 2; while (taken(`${defBase} (${i})`)) i++;
                nameInput.value = `${defBase} (${i})`; kf.relabel();
            }
            nameNote.hidden = !taken(nameValue());
            nameNote.textContent = t('new.name.taken', { name: nameValue() + '.kdbx' });
        }, 250);
    }
    nameInput.addEventListener('input', () => { touched = true; check(); });

    const pwf = newPasswordFields('new');
    const kfPick = h('input', { id: 'new-kf-pick', type: 'file' });
    const kfPickName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    kfPick.addEventListener('change', () => { kfPickName.textContent = kfPick.files[0]?.name || t('login.keyfile.none'); });
    const pickBox = h('div', { class: 'filepick cred-sub', hidden: true }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), kfPickName, kfPick);
    const kf = newKeyfileFlow('new', () => (baseName(target()) || baseName(defName)) + '.keyx');
    for (const el of [urlInput, nameInput]) el.addEventListener('input', () => kf.relabel());
    let kfMode = 'none';
    const option = (value, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'new-kf', value, checked: value === 'none', onchange: () => {
        kfMode = value; pickBox.hidden = value !== 'pick'; kf.box.hidden = value !== 'new';
    } }), h('span', { text: label }));

    const err = h('p', { class: 'error', id: 'new-error', role: 'alert' });
    const btn = h('button', { type: 'submit', id: 'new-btn', class: 'primary big' }, icon('plus'), h('span', { class: 'label', text: t('new.create') }));
    const form = h('form', { class: 'login-form stack', id: 'new-form' },
        h('div', { class: 'seg-group', role: 'radiogroup' }, seg('dav', NC ? t('login.src.nc') : t('login.src.dav'), 'cloud'), seg('file', t('login.src.file'), 'file')),
        urlBox, nameBox, urlFoot, fileHint,
        h('label', {}, h('span', { text: t('login.master') }), pwf.row), pwf.meter,
        h('label', {}, h('span', { text: t('new.repeat') }), pwf.repeat),
        h('div', { class: 'stack tight', role: 'radiogroup', 'aria-label': t('login.keyfile') },
            h('span', { class: 'group-title', text: t('login.keyfile') }),
            option('none', t('cred.kf.nokeep')),
            option('pick', t('new.kf.pick')), pickBox,
            option('new', t('cred.kf.new')), kf.box),
        h('p', { class: 'hint', id: 'new-crypto', text: t('new.crypto') }),
        err, btn);

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        if (btn.disabled) return;
        btn.disabled = true;
        const label = btn.querySelector('.label');
        let keyfile = null;
        try {
            const src = where; // Auswahl jetzt festhalten: sie kann sich waehrend Probelauf und Netz noch aendern
            const password = pwf.next.value;
            if (password !== pwf.repeat.value) throw new VaultError(t('cred.mismatch'));
            if (kfMode === 'pick') {
                keyfile = await readFile(kfPick);
                if (!keyfile) throw new VaultError(t('cred.kf.pick.none'));
            } else if (kfMode === 'new') {
                const k = kf.keyfile();
                if (k === 'download') throw new VaultError(t('cred.kf.download.none'));
                if (k === 'verify') throw new VaultError(t('cred.kf.verify.none'));
                keyfile = k;
            }
            if (!password && !keyfile) throw new VaultError(t('new.pw.none'));
            let dav = null, name, userPath = '', url = '';
            if (src === 'file' || (src === 'dav' && ncLike())) {
                const n = nameValue();
                if (!n) throw new VaultError(t('new.file.bad'));
                name = n + '.kdbx';
            }
            if (src === 'dav' && NC) {
                userPath = joinPath(folder, name);
                dav = new DavFile({ url: davUrlFor(NC, userPath), auth });
            } else if (src === 'dav' && remote.mode() === 'nc') {
                if (!remote.root()) throw new VaultError(t('err.nc.server'));
                const user = userInput.value, pass = passInput.value;
                userPath = joinPath(folder, name);
                url = remote.fileUrl(await remote.davBase(), userPath);
                dav = new DavFile({ url, user, pass });
            } else if (src === 'dav') {
                url = urlInput.value.trim();
                if (!url) throw new VaultError(t('err.dav.url'));
                url = withExt(url);
                dav = new DavFile({ url, user: userInput.value, pass: passInput.value });
                name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop());
            }
            const ask = (title, message) => confirmDialog({ title, message, confirmLabel: t('new.create'), cancelLabel: t('cancel'), danger: true });
            if (!password && !(await ask(t('new.nopw.title'), t('new.nopw.msg')))) return;
            if (password && ['bad', 'poor'].includes(strengthLabel(estimateBits(password))) && !(await ask(t('cred.weak.title'), t('cred.weak.msg')))) return;

            label.textContent = t('new.creating');
            await new Promise((r) => setTimeout(r, 30)); // Text vor dem Probelauf anzeigen
            let ms;
            try { ms = await trialRun(NEW_DB, 1); } catch (e) { if (isOutOfMemory(e)) throw new VaultError(t('new.oom', { mb: NEW_DB.memoryKiB / 1024 })); throw e; }
            const security = { ...NEW_DB, iterations: newDbIterations(ms) };
            const cache = dav && ctx.settings.offline ? { key: NC ? `nc:${NC.user}:${userPath}` : `dav:${url}`, name } : null;
            listings.clear();
            const { vault, bytes } = await Vault.create({ name: name.replace(/\.kdbx$/i, ''), password, keyfile: keyfile || undefined, security, dav, cache });
            vault.backupKeep = ctx.settings.backupKeep;
            pwf.next.value = pwf.repeat.value = ''; passInput.value = '';
            kf.wipe();
            pref('mode', src);
            if (src === 'file') download(name, bytes);
            else if (NC) {
                // Wie nach einem Klick in "Dateien": Neu laden und Sperren zeigen genau diese Datei
                pref('ncfile', userPath); NC.file = userPath; NC.newFile = '';
                history.replaceState(null, '', `${location.pathname}?open=${encodeURIComponent(userPath)}`);
            } else { pref('url', url); pref('user', userInput.value); pref('davmode', remote.mode()); }
            state.vault = vault;
            state.source = { type: src, name, kfId: src === 'file' ? kfFileId(name) : NC ? `nc:${NC.user}:${userPath}` : `dav:${url}`, readOnly: false };
            state.filter = { type: 'all' }; state.lastActivity = Date.now(); state.offlineMode = false; state.lastSyncFailed = false;
            ctx.ui.showMain();
            setStatus(t(src === 'file' ? 'new.done.file' : 'new.done', { name }));
            refreshDirtyIndicator(); startTimers(); ensureOfflineApp();
        } catch (e) {
            const known = e instanceof VaultError || e instanceof DavError || e instanceof NetworkError;
            err.textContent = known ? errText(e) : t('err.generic', { msg: e.message || e });
            if (!known) console.error(e);
        } finally {
            keyfile?.fill(0);
            btn.disabled = false;
            label.textContent = t('new.create');
        }
    });

    const card = h('main', { class: 'login-card' },
        h('div', { class: 'login-top' },
            h('h2', { text: t('new.title') }),
            h('div', { class: 'row-gap' },
                h('button', { type: 'button', id: 'new-back', class: 'link', text: '← ' + t('new.back'), onclick: () => { kf.wipe(); back(); } }),
                iconBtn('settings', t('settings'), () => openSettings({ loginMode: true }), { id: 'login-settings' }))),
        form,
        h('footer', { class: 'login-foot' }, h('span', {}), h('span', { class: 'muted', text: 'v' + __VERSION__ })));
    ctx.app.replaceChildren(loginShell(card));
    /** Zurueck zur Anmeldung; kam die Seite aus "+ Neu" in Dateien, auch ohne ?new= in der Adresse (sonst kaeme beim Neuladen wieder diese Maske). */
    function back() {
        if (NC?.newFile) { NC.newFile = ''; history.replaceState(null, '', location.pathname + (NC.file ? `?open=${encodeURIComponent(NC.file)}` : '')); }
        ctx.ui.showLogin();
    }
    if (remote) remote.setMode(remote.mode()); else show();
    (NC || where === 'file' ? nameInput : remote.mode() === 'url' ? urlInput : remote.server.value ? nameInput : remote.server).focus();
}
