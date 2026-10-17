// Datenbank-Einstellungen, Teil "Allgemein": Name, Beschreibung, Standard-Benutzername, Papierkorb, Verlaufsgrenzen.
// Das sind Metadaten in der verschluesselten Datei; Format und Schluesselableitung (Dateikopf) kommen spaeter dazu.
import { t } from '../i18n.js';
import { ctx, setStatus } from './ctx.js';
import { h, modal, confirmDialog } from './dom.js';
import { changed } from './session.js';

const MiB = 1024 * 1024;

export function openDbSettings({ onApplied } = {}) {
    const v = ctx.state.vault;
    const cur = v.generalSettings();
    const i = {
        name: h('input', { id: 'db-name', value: cur.name, autocomplete: 'off' }),
        desc: h('textarea', { id: 'db-desc', rows: 3 }),
        user: h('input', { id: 'db-user', value: cur.defaultUser, autocomplete: 'off', spellcheck: 'false' }),
        bin: h('input', { id: 'db-bin', type: 'checkbox', checked: cur.recycleBin }),
        itemsOn: h('input', { id: 'db-hist-items-on', type: 'checkbox', checked: cur.historyMaxItems >= 0 }),
        items: h('input', { id: 'db-hist-items', type: 'number', class: 'num', min: 0, max: 999, step: 1, value: cur.historyMaxItems >= 0 ? cur.historyMaxItems : 10, 'aria-label': t('dbset.hist.items.post') }),
        sizeOn: h('input', { id: 'db-hist-size-on', type: 'checkbox', checked: cur.historyMaxSize >= 0 }),
        size: h('input', { id: 'db-hist-size', type: 'number', class: 'num', min: 1, max: 1024, step: 1, value: cur.historyMaxSize >= 0 ? Math.max(1, Math.round(cur.historyMaxSize / MiB)) : 6, 'aria-label': t('dbset.hist.size.post') })
    };
    i.desc.value = cur.desc;
    const sync = () => { i.items.disabled = !i.itemsOn.checked; i.size.disabled = !i.sizeOn.checked; };
    i.itemsOn.addEventListener('change', sync); i.sizeOn.addEventListener('change', sync); sync();
    const clamp = (el, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(el.value)) || 0));

    async function apply(e) {
        e.preventDefault();
        const next = {
            name: i.name.value.trim(), desc: i.desc.value, defaultUser: i.user.value.trim(), recycleBin: i.bin.checked,
            historyMaxItems: i.itemsOn.checked ? clamp(i.items, 0, 999) : -1,
            historyMaxSize: i.sizeOn.checked ? clamp(i.size, 1, 1024) * MiB : -1
        };
        const n = v.historyTrimCount(next);
        if (n && !(await confirmDialog({ title: t('dbset.trim.title'), message: t('dbset.trim.msg', { n }), confirmLabel: t('dbset.trim.ok'), cancelLabel: t('cancel'), danger: true }))) return;
        v.updateGeneralSettings(next);
        if (!v.binEnabled && ctx.state.filter.type === 'bin') ctx.state.filter = { type: 'all' };
        m.close();
        changed();
        setStatus(ctx.settings.autosync === 'change' && ctx.state.source.type === 'dav' ? t('applied.auto') : t('applied'));
        onApplied?.();
    }

    const body = h('form', { class: 'stack', id: 'db-settings', onsubmit: apply },
        h('label', {}, h('span', { text: t('dbset.name') }), i.name),
        h('label', {}, h('span', { text: t('dbset.desc') }), i.desc),
        h('label', {}, h('span', { text: t('dbset.user') }), i.user, h('small', { class: 'hint', text: t('dbset.user.hint') })),
        h('label', { class: 'check' }, i.bin, h('span', {}, t('dbset.bin'), h('small', { class: 'muted', text: ' ' + t('dbset.bin.hint') }))),
        h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('dbset.hist') }),
            h('label', { class: 'check' }, i.itemsOn, h('span', { text: t('dbset.hist.items.pre') }), i.items, h('span', { text: t('dbset.hist.items.post') })),
            h('label', { class: 'check' }, i.sizeOn, h('span', { text: t('dbset.hist.size.pre') }), i.size, h('span', { text: t('dbset.hist.size.post') })),
            h('small', { class: 'hint', text: t('dbset.hist.hint') })),
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), h('button', { type: 'submit', class: 'primary', id: 'db-apply', text: t('apply') })));
    const m = modal({ title: t('dbset.title'), body, size: 'md' });
    return m;
}
