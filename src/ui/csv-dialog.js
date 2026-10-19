// CSV-Import und -Export. Import: Datei waehlen, sehen was erkannt wurde, dann landet alles in einer eigenen neuen Gruppe.
// Export: im Format von KeePassXC, nur nach ausdruecklicher Bestaetigung, denn die Datei ist unverschluesselt.
import { t, errText } from '../i18n.js';
import { ctx, download } from './ctx.js';
import { h, icon, modal, toast } from './dom.js';
import { changed } from './session.js';
import { setFilter } from './groups.js';
import { parseCsv, toCsv, mapRows } from '../core/csv.js';

const { state } = ctx;

export function openCsv() {
    const v = state.vault;
    let found = null; // {entries, ignored, name}

    const fileInput = h('input', { id: 'csv-file', type: 'file', accept: '.csv,text/csv' });
    const fileName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    const summary = h('p', { class: 'hint', id: 'csv-summary', 'aria-live': 'polite' });
    const importBtn = h('button', { type: 'button', class: 'primary', id: 'csv-import', text: t('csv.import'), disabled: true });
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files[0];
        fileName.textContent = f?.name || t('login.keyfile.none');
        found = null; importBtn.disabled = true; summary.textContent = '';
        if (!f) return;
        try {
            const { entries, ignored } = mapRows(parseCsv(await f.text()));
            if (!entries.length) { summary.textContent = t('csv.empty'); return; }
            found = { entries, name: f.name.replace(/\.csv$/i, '') };
            summary.textContent = t('csv.found', { n: entries.length }) + (ignored.length ? ' ' + t('csv.ignored', { cols: ignored.join(', ') }) : '');
            importBtn.disabled = false;
        } catch (e) { summary.textContent = errText(e); }
    });
    importBtn.addEventListener('click', () => {
        const group = v.importEntries(found.entries, t('csv.group', { name: found.name }));
        m.close();
        setFilter({ type: 'group', group }, { refresh: false });
        changed(); // zeichnet einmal neu, mit dem neuen Filter
        toast(t('csv.imported', { n: found.entries.length, group: group.name }));
    });

    const sure = h('input', { id: 'csv-sure', type: 'checkbox' });
    const exportBtn = h('button', { type: 'button', id: 'csv-export', disabled: true }, icon('download'), h('span', { text: t('csv.export') }));
    sure.addEventListener('change', () => { exportBtn.disabled = !sure.checked; });
    exportBtn.addEventListener('click', () => {
        download(state.source.name.replace(/\.kdbx$/i, '') + '.csv', toCsv(v.csvRows()));
        m.close();
    });

    const m = modal({ title: t('csv.title'), size: 'md', body: h('div', { class: 'stack' },
        h('section', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('csv.import.title') }),
            h('p', { class: 'hint', text: t('csv.import.hint') }),
            h('div', { class: 'filepick' }, h('span', { class: 'btn' }, icon('upload'), t('csv.choose')), fileName, fileInput),
            summary, h('div', {}, importBtn)),
        h('section', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('csv.export.title') }),
            h('p', { class: 'level-note bad', text: t('csv.export.warn') }),
            h('label', { class: 'check' }, sure, h('span', { text: t('csv.export.sure') })),
            h('div', {}, exportBtn))) });
}
