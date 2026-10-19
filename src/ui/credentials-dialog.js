// Master-Passwort und Schluesseldatei aendern. Bestaetigt wird mit dem aktuellen Passwort (nur Hash-Vergleich, keine KDF). Eine neue
// Schluesseldatei gilt erst, wenn sie heruntergeladen UND zur Kontrolle wieder ausgewaehlt wurde: sonst sperrt man sich aus.
// Danach wird sofort gespeichert, die gemerkte Schluesseldatei dieses Geraets nachgezogen und auf Wunsch die Sicherungskopien
// geloescht (die oeffnen weiter mit den alten Zugangsdaten).
import { t, errText } from '../i18n.js';
import { ctx, setStatus, download, kfStore } from './ctx.js';
import { h, icon, iconBtn, modal, confirmDialog, toast } from './dom.js';
import { rebind, refreshDirtyIndicator } from './session.js';
import { strengthBar } from './detail.js';
import { openGenerator } from './generator-dialog.js';
import { estimateBits, strengthLabel } from '../core/entropy.js';
import { createKeyfile, sameKeyfile } from '../vault.js';
import { nextcloudAuth, fetchPepper } from '../nextcloud.js';

const { state } = ctx;
const readFile = async (input) => (input.files[0] ? new Uint8Array(await input.files[0].arrayBuffer()) : null);

export function openCredentials() {
    const v = state.vault, isDav = state.source.type === 'dav';
    if (isDav && state.source.readOnly) { toast(t('cred.readonly'), { kind: 'warn' }); return; }
    // Ein noch nicht hochgeladener Stand liegt mit den alten Zugangsdaten auf dem Server: erst abgleichen
    if (isDav && (state.offlineMode || v.unsynced)) { toast(t('cred.unsynced'), { kind: 'warn' }); return; }
    const pw = (id, autocomplete = 'new-password') => h('input', { id, type: 'password', autocomplete, spellcheck: 'false', autocapitalize: 'off' });
    const i = { current: pw('cred-current', 'current-password'), next: pw('cred-new'), repeat: pw('cred-repeat') };
    const meter = h('div', { class: 'meter' }, strengthBar(''));
    let generated = null;
    const updateMeter = () => meter.replaceChildren(strengthBar(i.next.value, generated?.pw === i.next.value ? generated.bits : undefined));
    i.next.addEventListener('input', updateMeter);
    const showBtn = iconBtn('eye', t('show'), () => {
        const on = i.next.type === 'password';
        i.next.type = i.repeat.type = on ? 'text' : 'password';
        showBtn.replaceChildren(icon(on ? 'eyeOff' : 'eye'));
    }, { id: 'cred-show', type: 'button' });
    const genBtn = h('button', { type: 'button', id: 'cred-gen', class: 'btn', onclick: () => openGenerator({ onUse: (p, bits) => { generated = { pw: p, bits }; i.next.value = i.repeat.value = p; updateMeter(); } }) }, icon('dice'), h('span', { text: t('generator') }));

    // --- Schluesseldatei: beibehalten (bzw. keine), andere waehlen, neue erzeugen, entfernen
    const had = v.hasKeyfile;
    let mode = 'keep';
    const pickInput = h('input', { id: 'cred-kf-pick', type: 'file' });
    const pickName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    pickInput.addEventListener('change', () => { pickName.textContent = pickInput.files[0]?.name || t('login.keyfile.none'); });
    const pickBox = h('div', { class: 'filepick cred-sub', hidden: true }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), pickName, pickInput);

    const freshName = state.source.name.replace(/\.kdbx$/i, '') + '.keyx';
    let fresh = null, verified = false;
    const verifyInput = h('input', { id: 'cred-kf-verify', type: 'file' });
    const verifyName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    const verifyNote = h('p', { class: 'level-note', id: 'cred-kf-check', 'aria-live': 'polite', hidden: true });
    const verifyBox = h('div', { class: 'stack tight', hidden: true },
        h('span', { class: 'group-title', text: t('cred.kf.verify') }),
        h('div', { class: 'filepick' }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), verifyName, verifyInput), verifyNote);
    const downloadBtn = h('button', { type: 'button', class: 'small', id: 'cred-kf-download' }, icon('download'), h('span', { text: t('cred.kf.download', { name: freshName }) }));
    downloadBtn.addEventListener('click', async () => {
        fresh ||= await createKeyfile();
        download(freshName, fresh);
        verifyBox.hidden = false;
    });
    verifyInput.addEventListener('change', async () => {
        verifyName.textContent = verifyInput.files[0]?.name || t('login.keyfile.none');
        const bytes = await readFile(verifyInput);
        verified = !!(bytes && fresh) && await sameKeyfile(bytes, fresh).catch(() => false);
        bytes?.fill(0);
        verifyNote.hidden = !bytes;
        verifyNote.className = 'level-note ' + (verified ? 'ok' : 'bad');
        verifyNote.textContent = t(verified ? 'cred.kf.verify.ok' : 'cred.kf.verify.bad');
    });
    const newBox = h('div', { class: 'stack tight cred-sub', hidden: true }, h('small', { class: 'hint', text: t('cred.kf.new.hint') }), h('div', {}, downloadBtn), verifyBox);

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
            if (!fresh) return fail('cred.kf.download.none');
            if (!verified) return fail('cred.kf.verify.none');
            keyfile = fresh.slice(); name = freshName;
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
            h('label', {}, h('span', { text: t('cred.new') }), h('div', { class: 'input-group' }, i.next, showBtn, genBtn)), meter,
            h('label', {}, h('span', { text: t('cred.repeat') }), i.repeat),
            h('small', { class: 'hint', text: t(v.hasPassword ? 'cred.new.hint' : 'cred.new.hint.nopw') })),
        h('section', { class: 'card stack' }, h('h3', { text: t('login.keyfile') }), kfGroup),
        isDav ? h('section', { class: 'stack tight' },
            h('label', { class: 'check' }, delBackups, h('span', { text: t('cred.backups') })),
            h('small', { class: 'hint', text: t(ctx.NC ? 'cred.backups.hint.nc' : 'cred.backups.hint') })) : null,
        isFile ? h('p', { class: 'hint', text: t('cred.file.note') }) : null,
        error,
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), applyBtn));
    const m = modal({ title: t('cred.title'), body, size: 'md', onClose: () => { fresh?.fill(0); } });
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
