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
import { loginHero } from './login.js';
import { openSettings } from './settings-dialog.js';

const { state } = ctx;
const withExt = (s) => (/\.kdbx$/i.test(s) ? s : s + '.kdbx');
const baseName = (p) => p.split('/').pop().replace(/\.kdbx$/i, '');

/** Ohne Ordner (bzw. in Nextcloud ohne ?new=) landet die Datei im Benutzerverzeichnis. */
export function showCreate() {
    const NC = ctx.NC;
    const mode = pref('mode');
    const defName = t('new.file.default');
    const pathInput = h('input', { id: 'new-path', type: 'text', value: NC?.newFile || `/${defName}`, autocomplete: 'off', spellcheck: 'false' });
    const urlInput = h('input', { id: 'new-url', type: 'url', placeholder: `https://cloud.example.org/remote.php/dav/files/NAME/${defName}`, value: '', autocomplete: 'off' });
    const userInput = h('input', { id: 'new-user', type: 'text', value: pref('user'), autocomplete: 'username' });
    const passInput = h('input', { id: 'new-pass', type: 'password', autocomplete: 'current-password' });
    const nameInput = h('input', { id: 'new-filename', type: 'text', value: defName, autocomplete: 'off', spellcheck: 'false' });
    const davBox = NC
        ? h('div', { class: 'stack' }, h('label', {}, h('span', { text: t('new.nc.path') }), pathInput))
        : h('div', { class: 'stack' },
            h('label', {}, h('span', { text: t('new.dav.url') }), urlInput),
            h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('login.dav.user') }), userInput), h('label', {}, h('span', { text: t('login.dav.pass') }), passInput)),
            h('p', { class: 'hint', text: t('login.dav.hint') }));
    const fileBox = h('div', { class: 'stack' }, h('label', {}, h('span', { text: t('new.file.name') }), nameInput), h('p', { class: 'hint', text: t('new.file.hint') }));
    let where = mode === 'file' ? 'file' : 'dav';
    /** Wo die Datei hinkommt (Pfad, Adresse oder Dateiname), fuer Datenbank- und Schluesseldatei-Namen. */
    const target = () => (where === 'file' ? nameInput.value : NC ? pathInput.value : urlInput.value.split(/[?#]/)[0]).trim();
    const seg = (value, label, ic) => h('label', { class: 'seg' }, h('input', { type: 'radio', name: 'new-src', value, checked: value === where, onchange: () => { where = value; davBox.hidden = value !== 'dav'; fileBox.hidden = value !== 'file'; kf.relabel(); } }), h('span', {}, icon(ic), label));
    davBox.hidden = where !== 'dav'; fileBox.hidden = where !== 'file';

    const pwf = newPasswordFields('new');
    const kfPick = h('input', { id: 'new-kf-pick', type: 'file' });
    const kfPickName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    kfPick.addEventListener('change', () => { kfPickName.textContent = kfPick.files[0]?.name || t('login.keyfile.none'); });
    const pickBox = h('div', { class: 'filepick cred-sub', hidden: true }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), kfPickName, kfPick);
    const kf = newKeyfileFlow('new', () => (baseName(target()) || baseName(defName)) + '.keyx');
    for (const el of [pathInput, urlInput, nameInput]) el.addEventListener('input', () => kf.relabel());
    let kfMode = 'none';
    const option = (value, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'new-kf', value, checked: value === 'none', onchange: () => {
        kfMode = value; pickBox.hidden = value !== 'pick'; kf.box.hidden = value !== 'new';
    } }), h('span', { text: label }));

    const err = h('p', { class: 'error', id: 'new-error', role: 'alert' });
    const btn = h('button', { type: 'submit', id: 'new-btn', class: 'primary big' }, icon('plus'), h('span', { class: 'label', text: t('new.create') }));
    const form = h('form', { class: 'login-form stack', id: 'new-form' },
        h('div', { class: 'seg-group', role: 'radiogroup' }, seg('dav', NC ? t('login.src.nc') : t('login.src.dav'), 'cloud'), seg('file', t('login.src.file'), 'file')),
        davBox, fileBox,
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
            if (src === 'file') {
                name = withExt(nameInput.value.trim());
                if (!nameInput.value.trim() || /[/\\]/.test(name)) throw new VaultError(t('new.file.bad'));
            } else if (NC) {
                userPath = normalizeUserPath(pathInput.value);
                if (!userPath || userPath.endsWith('/')) throw new VaultError(t('err.nc.path'));
                userPath = withExt(userPath);
                dav = new DavFile({ url: davUrlFor(NC, userPath), auth: nextcloudAuth(NC) });
                name = userPath.split('/').pop();
            } else {
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
            } else { pref('url', url); pref('user', userInput.value); }
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
    ctx.app.replaceChildren(h('div', { class: 'login' }, loginHero(), card));
    /** Zurueck zur Anmeldung; kam die Seite aus "+ Neu" in Dateien, auch ohne ?new= in der Adresse (sonst kaeme beim Neuladen wieder diese Maske). */
    function back() {
        if (NC?.newFile) { NC.newFile = ''; history.replaceState(null, '', location.pathname + (NC.file ? `?open=${encodeURIComponent(NC.file)}` : '')); }
        ctx.ui.showLogin();
    }
    (where === 'file' ? nameInput : NC ? pathInput : urlInput).focus();
}
