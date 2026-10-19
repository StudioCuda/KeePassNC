// Dialog "Datenbank": alles, was in der Datei steht. Passwort-Gesundheit (angelehnt an KeePassXC), Statistik, Infos mit Zugang zu den
// Datenbank-Einstellungen. Was nur die App auf diesem Geraet betrifft, steht in den Einstellungen (settings-dialog.js).
import { auditEntries } from '../core/audit.js';
import { fieldOf } from '../core/util.js';
import { t, fmtDate } from '../i18n.js';
import { ctx } from './ctx.js';
import { h, icon, modal } from './dom.js';
import { allRealEntries, avatar } from './common.js';
import { openDbSettings } from './db-settings.js';
import { openCredentials } from './credentials-dialog.js';
import { openMerge } from './merge-dialog.js';
import { openCsv } from './csv-dialog.js';

const { state } = ctx;

function reasonChip(r) {
    const text = { weak: t('rep.weak', { bits: r.bits }), short: t('rep.short', { n: r.length }), reused: t('rep.reused', { n: r.uses }), expired: t('rep.expired', { n: r.days }), expiring: t('rep.expiring', { n: r.days }) }[r.code];
    return h('span', { class: `badge ${r.code === 'expiring' ? 'warn' : 'bad'}`, text });
}

export function openReports(initialTab = 'health') {
    const entries = allRealEntries();
    const { items, stats } = auditEntries(entries);
    let tab = initialTab;
    const content = h('div', { class: 'report-body' });
    const tabs = h('div', { class: 'seg-group', role: 'tablist' });
    const stat = (label, value, cls = '', onclick) => h(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: 'stat ' + cls, onclick }, h('b', { text: String(value) }), h('span', { text: label }));

    function render() {
        tabs.replaceChildren(...[['health', t('rep.health')], ['stats', t('rep.stats')], ['info', t('rep.settings')]].map(([k, l]) =>
            h('button', { type: 'button', role: 'tab', class: 'seg-btn' + (tab === k ? ' active' : ''), id: 'rep-tab-' + k, onclick: () => { tab = k; render(); }, text: l })));
        if (tab === 'health') {
            const score = stats.health;
            content.replaceChildren(
                h('div', { class: 'stat-grid' }, stat(t('rep.score'), score + '%', score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad'), stat(t('rep.weak.n'), stats.weak, stats.weak ? 'bad' : 'ok'), stat(t('rep.reused.n'), stats.reused, stats.reused ? 'bad' : 'ok'),
                    stat(t('rep.expired.n'), stats.expired, stats.expired ? 'bad' : 'ok'), stat(t('rep.expiring.n'), stats.expiring, stats.expiring ? 'warn' : 'ok'), stat(t('rep.short.n'), stats.short, stats.short ? 'warn' : 'ok')),
                items.length ? h('div', { class: 'issue-list' }, ...items.map((it) => h('button', { type: 'button', class: 'issue', 'data-testid': 'issue-row', onclick: () => { m.close(); ctx.ui.selectEntry(it.entry); } },
                    avatar(it.entry), h('span', { class: 'grow' }, h('strong', { text: fieldOf(it.entry, 'Title') || t('entry.untitled') }), h('span', { class: 'muted', text: ' · ' + (it.path || t('group.root')) })), h('span', { class: 'chips-inline' }, ...it.reasons.map(reasonChip))))) : h('p', { class: 'empty-note', text: t('rep.none') }),
                h('p', { class: 'hint report-note' }, h('span', { text: t('rep.note') }), h('span', { text: t('rep.note.private') })));
        } else if (tab === 'stats') {
            content.replaceChildren(h('div', { class: 'stat-grid' },
                stat(t('rep.entries'), stats.entries), stat(t('rep.groups'), state.vault.allGroups().length - 1), stat(t('rep.unique'), stats.unique), stat(t('rep.avglen'), stats.avgLength),
                stat(t('rep.totp'), stats.totp), stat(t('rep.passkeys'), stats.passkeys), stat(t('rep.attachments'), stats.attachments), stat(t('rep.nopw'), stats.noPassword)));
        } else {
            const i = state.vault.info();
            const row = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted', text: k }), h('span', { class: 'mono', text: String(v) }));
            content.replaceChildren(h('div', { class: 'stack tight' }, h('div', { class: 'card flat' },
                row(t('info.name'), i.name || state.source.name), state.vault.db.meta.desc ? row(t('info.desc'), state.vault.db.meta.desc) : null, row(t('info.format'), i.version), row(t('info.cipher'), i.cipher), row(t('info.kdf'), i.kdf),
                i.memoryMiB !== null ? row(t('info.memory'), i.memoryMiB + ' MiB') : null, row(t('info.iterations'), i.iterations), i.parallelism !== null ? row(t('info.parallelism'), i.parallelism) : null,
                row(t('info.modified'), fmtDate(state.vault.db.meta.settingsChanged || state.vault.db.meta.dbNameChanged, true)),
                state.vault.db.meta.keyChanged ? row(t('info.keychanged'), fmtDate(state.vault.db.meta.keyChanged, true)) : null),
                h('div', { class: 'row-gap' },
                    h('button', { type: 'button', class: 'small', id: 'db-settings-btn', text: t('dbset.edit'), onclick: () => openDbSettings({ onApplied: render }) }),
                    h('button', { type: 'button', class: 'small', id: 'cred-btn', text: t('cred.edit'), onclick: () => { m.close(); openCredentials(); } }),
                    h('button', { type: 'button', class: 'small', id: 'merge-btn', text: t('merge.title'), onclick: () => { m.close(); openMerge(); } }),
                    h('button', { type: 'button', class: 'small', id: 'csv-btn', text: t('csv.title'), onclick: () => { m.close(); openCsv(); } }))));
        }
    }
    const m = modal({ title: t('database'), body: h('div', { class: 'stack' }, tabs, content), size: 'lg', cls: 'reports-modal' });
    render();
}
