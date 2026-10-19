// Master-Passwort und Schluesseldatei aendern. Bestaetigt wird mit dem aktuellen Passwort (nur Hash-Vergleich, keine KDF). Eine neue
// Schluesseldatei gilt erst, wenn sie heruntergeladen UND zur Kontrolle wieder ausgewaehlt wurde: sonst sperrt man sich aus.
// Danach wird sofort gespeichert, die gemerkte Schluesseldatei dieses Geraets nachgezogen und auf Wunsch die Sicherungskopien
// geloescht (die oeffnen weiter mit den alten Zugangsdaten).
import { t, errText } from '../i18n.js';
import { ctx, setStatus, download, kfStore } from './ctx.js';
import { h, icon, modal, confirmDialog, toast } from './dom.js';
import { rebind, refreshDirtyIndicator } from './session.js';
import { newPasswordFields, newKeyfileFlow, readFile } from './new-credentials.js';
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { sameKeyfile } from '../vault.js';
import { nextcloudAuth, fetchPepper } from '../nextcloud.js';

const { state } = ctx;

export function openCredentials() {
    const v = state.vault, isDav = state.source.type === 'dav';
    if (isDav && state.source.readOnly) { toast(t('cred.readonly'), { kind: 'warn' }); return; }
    // Ein noch nicht hochgeladener Stand liegt mit den alten Zugangsdaten auf dem Server: erst abgleichen
    if (isDav && (state.offlineMode || v.unsynced)) { toast(t('cred.unsynced'), { kind: 'warn' }); return; }
    const current = h('input', { id: 'cred-current', type: 'password', autocomplete: 'current-password', spellcheck: 'false', autocapitalize: 'off' });
    const pwf = newPasswordFields('cred');
    const i = { current, next: pwf.next, repeat: pwf.repeat };

    // --- Schluesseldatei: beibehalten (bzw. keine), andere waehlen, neue erzeugen, entfernen
    const had = v.hasKeyfile;
    let mode = 'keep';
    const pickInput = h('input', { id: 'cred-kf-pick', type: 'file' });
    const pickName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    pickInput.addEventListener('change', () => { pickName.textContent = pickInput.files[0]?.name || t('login.keyfile.none'); });
    const pickBox = h('div', { class: 'filepick cred-sub', hidden: true }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), pickName, pickInput);

    const freshName = state.source.name.replace(/\.kdbx$/i, '') + '.keyx';
    const fresh = newKeyfileFlow('cred', () => freshName);
    const newBox = fresh.box;

    const option = (value, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'cred-kf', value, checked: value === 'keep', onchange: () => {
        mode = value; pickBox.hidden = mode !== 'pick'; newBox.hidden = mode !== 'new';
    } }), h('span', { text: label }));
    const kfGroup = h('div', { class: 'stack tight', role: 'radiogroup', 'aria-label': t('login.keyfile') },
        option('keep', t(had ? 'cred.kf.keep' : 'cred.kf.nokeep')),
        option('pick', t(had ? 'cred.kf.pick' : 'cred.kf.add')), pickBox,
        option('new', t('cred.kf.new')), newBox,
        had ? option('none', t('cred.kf.none')) : null);

    const delBackups = isDav ? h('input', { id: 'cred-del-backups', type: 'checkbox' }) : null;
    const error = h('p', { class: 'error', id: 'cred-error', role: 'alert' });
    const applyBtn = h('button', { type: 'submit', class: 'primary', id: 'cred-apply', text: t('cred.apply') });
    const fail = (key) => { error.textContent = t(key); return null; };

    /** Was sich aendern soll ({password, keyfile} wie Vault.changeCredentials) oder null (Fehler steht im Dialog). */
    async function collect() {
        if (!i.current.value && v.hasPassword) return fail('cred.current.none');
        if (!(await v.checkPassword(i.current.value))) return fail('cred.current.wrong');
        if (i.next.value !== i.repeat.value) return fail('cred.mismatch');
        const password = i.next.value && i.next.value !== i.current.value ? i.next.value : undefined;
        let keyfile, name;
        if (mode === 'pick') {
            keyfile = await readFile(pickInput);
            if (!keyfile) return fail('cred.kf.pick.none');
            name = pickInput.files[0].name;
            const cur = v.keyfileCopy();
            if (cur && await sameKeyfile(keyfile, cur).catch(() => false)) { keyfile.fill(0); keyfile = undefined; }
            cur?.fill(0);
        } else if (mode === 'new') {
            keyfile = fresh.keyfile();
            if (keyfile === 'download') return fail('cred.kf.download.none');
            if (keyfile === 'verify') return fail('cred.kf.verify.none');
            name = freshName;
        } else if (mode === 'none') keyfile = null;
        if (password === undefined && keyfile === undefined) return fail('cred.nothing');
        if (keyfile === null && password === undefined && !v.hasPassword) return fail('e.cred.empty');
        return { password, keyfile, name };
    }

    async function apply(e) {
        e.preventDefault();
        error.textContent = '';
        if (applyBtn.disabled) return;
        applyBtn.disabled = true;
        let change = null;
        try {
            change = await collect();
            if (!change) return;
            const ask = (title, message) => confirmDialog({ title, message, confirmLabel: t('cred.apply'), cancelLabel: t('cancel'), danger: true });
            if (change.password !== undefined && ['bad', 'poor'].includes(strengthLabel(estimateBits(change.password))) && !(await ask(t('cred.weak.title'), t('cred.weak.msg')))) return;
            if (change.keyfile === null && !(await ask(t('cred.kf.none.title'), t('cred.kf.none.msg')))) return;
            setStatus(t('cred.saving'));
            await state.kfBusy; // ein Neu-Verschluesseln vom Anmelden darf den Datensatz nicht danach mit dem alten Passwort ueberschreiben
            let res;
            try {
                res = await v.changeCredentials({ password: change.password, keyfile: change.keyfile });
            } catch (err) {
                if (!err?.key) console.error(err);
                error.textContent = t('cred.failed', { msg: errText(err) });
                setStatus(t('cred.failed', { msg: errText(err) }), 'error');
                return;
            } finally { refreshDirtyIndicator(); }
            const password = change.password ?? i.current.value;
            m.close();
            const notes = [];
            if (state.source.type === 'file') download(state.source.name, res.bytes);
            if (res.merged) { rebind(); ctx.ui.refresh?.(); }
            const kfNote = await updateRemembered(change, password);
            if (kfNote) notes.push(kfNote);
            if (delBackups?.checked && !res.offline) {
                try { notes.push(t('cred.backups.done', { n: (await v.deleteBackups()).length })); } catch (err) { notes.push(t('cred.backups.failed', { msg: errText(err) })); }
            }
            const main = res.offline ? 'cred.done.offline' : state.source.type === 'file' ? 'cred.done.file' : 'cred.done';
            setStatus([t(main, { name: state.source.name }), ...notes].join(' '), res.offline || res.merged ? 'warn' : 'info');
        } finally {
            if (change?.keyfile) change.keyfile.fill(0);
            applyBtn.disabled = false;
        }
    }

    const isFile = state.source.type === 'file';
    const body = h('form', { class: 'stack', id: 'cred-form', onsubmit: apply },
        v.hasPassword ? h('label', {}, h('span', { text: t('cred.current') }), i.current) : h('p', { class: 'hint', text: t('cred.current.nopw') }),
        h('section', { class: 'card stack' }, h('h3', { text: t('login.master') }),
            h('label', {}, h('span', { text: t('cred.new') }), pwf.row), pwf.meter,
            h('label', {}, h('span', { text: t('cred.repeat') }), i.repeat),
            h('small', { class: 'hint', text: t(v.hasPassword ? 'cred.new.hint' : 'cred.new.hint.nopw') })),
        h('section', { class: 'card stack' }, h('h3', { text: t('login.keyfile') }), kfGroup),
        isDav ? h('section', { class: 'stack tight' },
            h('label', { class: 'check' }, delBackups, h('span', { text: t('cred.backups') })),
            h('small', { class: 'hint', text: t(ctx.NC ? 'cred.backups.hint.nc' : 'cred.backups.hint') })) : null,
        isFile ? h('p', { class: 'hint', text: t('cred.file.note') }) : null,
        error,
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), applyBtn));
    const m = modal({ title: t('cred.title'), body, size: 'md', onClose: () => fresh.wipe() });
    (v.hasPassword ? i.current : i.next).focus();
    return m;
}

/**
 * Gemerkte Schluesseldatei dieses Geraets (keyfile-store.js) an die neuen Zugangsdaten anpassen: mit dem neuen Passwort und der
 * aktuellen Schluesseldatei neu verschluesseln, ohne Schluesseldatei vergessen. Geht das nicht (Server-Geheimwert fehlt), wird der
 * Datensatz vergessen, er passt ohnehin nicht mehr. Liefert einen Hinweis fuer die Statuszeile oder ''.
 */
async function updateRemembered(change, password) {
    const v = state.vault, id = state.source.kfId;
    const rec = id ? await kfStore.info(id).catch(() => null) : null;
    if (!rec) return '';
    if (!v.hasKeyfile || !password) { await kfStore.forget(id).catch(() => {}); return t('cred.kf.forgotten'); } // gemerkt wird nur mit Passwort
    const keyfile = v.keyfileCopy();
    try {
        const pepper = ctx.NC?.pepperUrl ? await fetchPepper(ctx.NC, nextcloudAuth(ctx.NC)) : null;
        await kfStore.remember({ id, name: change.keyfile ? change.name : rec.name, keyfile, password, params: v.kdfParams(), pepper });
        return t('cred.kf.updated');
    } catch {
        await kfStore.forget(id).catch(() => {});
        return t('cred.kf.lost');
    } finally { keyfile.fill(0); }
}

let askingRemote = false;
/**
 * Die Datei auf dem Server oeffnet nicht mehr mit den Zugangsdaten dieser Sitzung (auf einem anderen Geraet geaendert): nach den neuen
 * fragen, statt nur "bitte neu anmelden" zu sagen. Mit ihnen werden lokale Aenderungen zusammengefuehrt und gespeichert, sonst wird
 * einfach der neue Stand geholt. "Spaeter" laesst alles, wie es ist; die naechste Speicherung oder der naechste Abgleich fragt wieder.
 */
export function askRemoteCredentials() {
    const v = state.vault;
    if (askingRemote || !v?.dav) return;
    askingRemote = true;
    const pwInput = h('input', { id: 'rcred-pw', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
    const kfInput = h('input', { id: 'rcred-kf', type: 'file' });
    const kfName = h('span', { class: 'muted', text: v.hasKeyfile ? t('rcred.kf.same') : t('login.keyfile.none') });
    kfInput.addEventListener('change', () => { kfName.textContent = kfInput.files[0]?.name || (v.hasKeyfile ? t('rcred.kf.same') : t('login.keyfile.none')); });
    const error = h('p', { class: 'error', id: 'rcred-error', role: 'alert' });
    const okBtn = h('button', { type: 'submit', class: 'primary', id: 'rcred-ok', text: t('rcred.ok') });
    async function submit(e) {
        e.preventDefault();
        if (okBtn.disabled) return;
        error.textContent = ''; okBtn.disabled = true;
        const picked = await readFile(kfInput);
        const keyfile = picked || v.keyfileCopy(); // ohne Auswahl: die bisherige Schluesseldatei
        if (!pwInput.value && !keyfile) { okBtn.disabled = false; error.textContent = t('err.login.empty'); return; }
        try {
            const res = await v.adoptCredentials({ password: pwInput.value, keyfile: keyfile || undefined });
            m.close();
            rebind(); ctx.ui.refresh?.();
            const kfNote = await updateRemembered({ keyfile: picked, name: kfInput.files[0]?.name }, pwInput.value);
            setStatus([t(res.merged ? 'rcred.done.merged' : 'rcred.done'), kfNote].filter(Boolean).join(' '), res.offline ? 'warn' : 'info');
        } catch (err) {
            if (!err?.key) console.error(err);
            error.textContent = errText(err);
        } finally {
            keyfile?.fill(0);
            okBtn.disabled = false;
            refreshDirtyIndicator();
        }
    }
    const body = h('form', { class: 'stack', id: 'rcred-form', onsubmit: submit },
        h('p', { text: t(v.dirty || v.unsynced ? 'rcred.msg.local' : 'rcred.msg') }),
        h('label', {}, h('span', { text: t('cred.new') }), pwInput),
        h('label', {}, h('span', { text: t('login.keyfile') }), h('div', { class: 'filepick' }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), kfName, kfInput)),
        error,
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', id: 'rcred-later', text: t('rcred.later'), onclick: () => m.close() }), okBtn));
    const m = modal({ title: t('rcred.title'), body, size: 'sm', onClose: () => { askingRemote = false; } });
    pwInput.focus();
}
