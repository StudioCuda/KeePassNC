// CSV import and export. Import: pick a file, see what was recognized, then everything lands in its own new group.
// Export: in KeePassXC's format, only after explicit confirmation, because the file is unencrypted.
import { t, errText } from '../i18n.js';
import { ctx, download } from './ctx.js';
import { h, icon, modal, toast } from './dom.js';
import { filePicker } from './file-picker.js';
import { changed } from './session.js';
import { setFilter } from './groups.js';
import { toCsv } from '../core/csv.js';
import { readImport, FORMAT_NAMES } from '../core/import.js';

const { state } = ctx;

/** `onBack`: called when the dialog is closed without importing or exporting (cancel, x, Esc). */
export function openCsv({ onBack } = {}) {
    const v = state.vault;
    let finished = false;
    let found = null; // {entries, ignored, name}

    const fileInput = h('input', { id: 'csv-file', type: 'file', accept: '.csv,.json,text/csv,application/json' });
    const summary = h('p', { class: 'hint', id: 'csv-summary', 'aria-live': 'polite' });
    const importBtn = h('button', { type: 'button', class: 'primary', id: 'csv-import', text: t('csv.import'), disabled: true });
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files[0];
        found = null; importBtn.disabled = true; summary.textContent = '';
        if (!f) return;
        try {
            const { entries, ignored, refs, files, format } = readImport(await f.text());
            if (!entries.length) { summary.textContent = t('csv.empty'); return; }
            found = { entries, name: f.name.replace(/\.(csv|json)$/i, '') };
            summary.textContent = (format ? t('csv.format', { name: FORMAT_NAMES[format] }) + ' ' : '') + t('csv.found', { n: entries.length }) + (ignored.length ? ' ' + t('csv.ignored', { cols: ignored.join(', ') }) : '')
                + (refs ? ' ' + t('csv.refs', { n: refs }) : '') + (files ? ' ' + t('csv.files', { n: files }) : '');
            importBtn.disabled = false;
        } catch (e) { summary.textContent = errText(e); }
    });
    importBtn.addEventListener('click', async () => {
        importBtn.disabled = true;
        const group = await v.importEntries(found.entries, t('csv.group', { name: found.name }));
        finished = true;
        m.close();
        setFilter({ type: 'group', group }, { refresh: false });
        changed(); // redraws once, with the new filter
        toast(t('csv.imported', { n: found.entries.length, group: group.name }));
    });

    const sure = h('input', { id: 'csv-sure', type: 'checkbox' });
    const exportBtn = h('button', { type: 'button', id: 'csv-export', disabled: true }, icon('download'), h('span', { text: t('csv.export') }));
    sure.addEventListener('change', () => { exportBtn.disabled = !sure.checked; });
    exportBtn.addEventListener('click', () => {
        download(state.source.name.replace(/\.kdbx$/i, '') + '.csv', toCsv(v.csvRows()));
        finished = true;
        m.close();
    });

    const m = modal({ title: t('csv.title'), size: 'md', body: h('div', { class: 'stack' },
        h('section', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('csv.import.title') }),
            h('p', { class: 'hint', text: t('csv.import.hint') }),
            filePicker(fileInput, { icon: 'upload', button: t('csv.choose') }),
            summary, h('div', {}, importBtn)),
        h('section', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('csv.export.title') }),
            h('p', { class: 'level-note bad', text: t('csv.export.warn') }),
            h('label', { class: 'check' }, sure, h('span', { text: t('csv.export.sure') })),
            h('div', {}, exportBtn)),
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', id: 'csv-cancel', text: t('cancel'), onclick: () => m.close() }))),
    onClose: () => { if (!finished) onBack?.(); } });
}
