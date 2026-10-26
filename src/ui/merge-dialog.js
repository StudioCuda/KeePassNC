// Merge with another copy: other .kdbx files in the same Nextcloud folder (e.g. "(conflicted copy)") or a file
// from this device. Try the own credentials first; they are only asked for if the copy has different ones.
import { t, errText, fmtDate } from '../i18n.js';
import { ctx } from './ctx.js';
import { h, modal, toast } from './dom.js';
import { filePicker } from './file-picker.js';
import { changed } from './session.js';
import { confirmHeavyKdf } from './kdf-guard.js';

const { state } = ctx;

/** `onBack`: called when the dialog is closed without merging (cancel, x, Esc), so the caller can reopen where it came from. */
export function openMerge({ onBack } = {}) {
    const v = state.vault;
    let finished = false;
    let pick = null; // {name, read: () => Promise<ArrayBuffer>}
    const list = h('div', { class: 'stack tight', role: 'radiogroup', 'aria-label': t('merge.folder') });
    const choose = (name, read) => { pick = { name, read }; error.textContent = ''; };
    const option = (name, note, read) => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'merge-src', onchange: () => choose(name, read) }), h('span', { text: name }), note ? h('small', { class: 'muted', text: note }) : null);

    const localInput = h('input', { id: 'merge-file', type: 'file', accept: '.kdbx' });
    localInput.addEventListener('change', () => {
        const f = localInput.files[0];
        for (const r of list.querySelectorAll('input[type=radio]')) r.checked = false;
        if (f) choose(f.name, () => f.arrayBuffer());
    });

    const credBox = h('div', { class: 'stack tight', hidden: true });
    const pw = h('input', { id: 'merge-pw', type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const kfInput = h('input', { id: 'merge-kf', type: 'file' });
    credBox.append(h('p', { class: 'hint', text: t('merge.creds') }),
        h('label', {}, h('span', { text: t('login.master') }), pw),
        filePicker(kfInput, { icon: 'key', button: t('login.keyfile.choose') }));

    const error = h('p', { class: 'error', id: 'merge-error', role: 'alert' });
    const mergeBtn = h('button', { type: 'submit', class: 'primary', id: 'merge-apply', text: t('merge.apply') });

    async function apply(e) {
        e.preventDefault();
        if (!pick) { error.textContent = t('merge.none'); return; }
        mergeBtn.disabled = true; error.textContent = '';
        let kf = null;
        try {
            kf = kfInput.files[0] ? new Uint8Array(await kfInput.files[0].arrayBuffer()) : null;
            const creds = credBox.hidden ? undefined : { password: pw.value, keyfile: kf };
            const other = await pick.read();
            if (!(await confirmHeavyKdf(other))) return;
            const n = await v.mergeFrom(other, creds);
            finished = true;
            m.close();
            changed();
            toast(n.added || n.changed || n.removed ? t('merge.done', { name: pick.name, ...n }) : t('merge.nothing', { name: pick.name }));
        } catch (err) {
            if (err.key === 'e.badkey' && credBox.hidden) { credBox.hidden = false; pw.focus(); } // the copy has different credentials
            else error.textContent = errText(err);
        } finally {
            kf?.fill(0);
            mergeBtn.disabled = false;
        }
    }

    const body = h('form', { class: 'stack', id: 'merge-form', onsubmit: apply },
        h('p', { class: 'hint', text: t('merge.hint') }),
        state.source.type === 'dav' ? h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('merge.folder') }), list) : null,
        h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('merge.device') }),
            filePicker(localInput, { icon: 'upload', button: t('merge.choose') })),
        credBox, error,
        h('div', { class: 'modal-actions' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), mergeBtn));
    const m = modal({ title: t('merge.title'), body, size: 'md', onClose: () => { if (!finished) onBack?.(); } });

    if (state.source.type === 'dav') {
        list.append(h('small', { class: 'muted', text: t('merge.loading') }));
        v.dav.siblings().then((files) => {
            list.replaceChildren(...(files.length ? files.map((f) => option(f.name, f.modified.getTime() ? fmtDate(f.modified, true) : '', async () => (await f.file.get()).buf))
                : [h('small', { class: 'muted', text: t('merge.folder.none') })]));
        }).catch(() => list.replaceChildren(h('small', { class: 'muted', text: t('merge.folder.none') })));
    }
}
