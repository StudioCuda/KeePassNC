// Einstellungen als Dialog (auch schon vor der Anmeldung erreichbar: nur Darstellung/Sprache).
import { saveSettings, AUTOSYNC_OPTIONS, BACKUPKEEP_OPTIONS, AUTOLOCK_OPTIONS, CLIPBOARD_OPTIONS, THEME_OPTIONS, LANG_OPTIONS } from '../settings.js';
import { t, setLang, detectLang, fmtDate, errText } from '../i18n.js';
import { ctx, applyTheme, kfStore, kfScope } from './ctx.js';
import { h, modal, toast, confirmDialog } from './dom.js';
import { fetchPepper, nextcloudAuth } from '../nextcloud.js';
import { startTimers, ensureOfflineApp } from './session.js';

export function langNow() { return detectLang(ctx.settings.lang, document.documentElement.dataset.ncLang || ctx.app?.dataset.lang || '', navigator.language); }

export function openSettings({ loginMode = false } = {}) {
    const isDav = ctx.state.source?.type === 'dav';
    const select = (id, values, value, labelOf, onchange) => h('select', { id, onchange: (e) => onchange(e.target.value) },
        ...values.map((v) => h('option', { value: String(v), selected: String(v) === String(value), text: labelOf(v) })));
    const update = (patch, { relang = false } = {}) => {
        ctx.settings = { ...ctx.settings, ...patch };
        saveSettings(ctx.settings);
        applyTheme();
        if (ctx.state.vault) ctx.state.vault.backupKeep = ctx.settings.backupKeep;
        if (patch.lang !== undefined) setLang(langNow());
        if (!loginMode) { startTimers(); ensureOfflineApp(); }
        if (relang) { m.close(); ctx.ui.rerender?.(); if (!loginMode) openSettings(); }
        else ctx.ui.refresh?.();
    };
    const sec = (title, ...rows) => h('section', { class: 'card stack' }, h('h3', { text: title }), ...rows);
    const check = (id, label, key, hint) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id, checked: !!ctx.settings[key], onchange: (e) => update({ [key]: e.target.checked }) }), h('span', {}, label, hint ? h('small', { class: 'muted', text: ' ' + hint }) : null));
    // "Wie Nextcloud" gibt es nur in Nextcloud; eigenstaendig wirkt der Wert wie "Automatisch".
    const themeOptions = ctx.NC ? THEME_OPTIONS : THEME_OPTIONS.filter((v) => v !== 'nextcloud');
    const themeValue = !ctx.NC && ctx.settings.theme === 'nextcloud' ? 'auto' : ctx.settings.theme;
    const kfBox = h('div', { class: 'stack tight', id: 'kf-list' });
    const fillKf = async () => {
        const list = await kfStore.list(kfScope).catch(() => []);
        kfBox.replaceChildren(...(list.length ? [...list.map((k) => h('div', { class: 'kv' }, h('span', {}, h('strong', { text: k.name || '?' }), h('span', { class: 'muted', text: ' · ' + k.id + ' · ' + fmtDate(k.created) + (k.server ? ' · ' + t('set.kf.server') : '') })),
            h('button', { type: 'button', class: 'small', 'data-testid': 'kf-forget', onclick: async () => { await kfStore.forget(k.id); fillKf(); }, text: t('login.kf.forget') }))),
            h('div', {}, h('button', { type: 'button', class: 'small danger-ghost', id: 'kf-forget-all', onclick: async () => { await kfStore.forgetAll(kfScope); fillKf(); }, text: t('set.kf.forget.all') }))] : [h('p', { class: 'hint', text: t('set.kf.none') })]));
    };
    fillKf();
    const body = h('div', { class: 'stack settings', id: 'settings' },
        sec(t('set.appearance'),
            h('div', { class: 'grid2' },
                h('label', {}, h('span', { text: t('set.theme') }), select('s-theme', themeOptions, themeValue, (v) => t('theme.' + v), (v) => update({ theme: v }))),
                h('label', {}, h('span', { text: t('set.lang') }), select('s-lang', LANG_OPTIONS, ctx.settings.lang, (v) => (v === 'auto' ? t('lang.auto') : v === 'de' ? 'Deutsch' : 'English'), (v) => update({ lang: v }, { relang: true })))),
            check('s-compact', t('set.compact'), 'compact'),
            ctx.NC ? check('s-ncaccent', t('set.ncAccent'), 'ncAccent') : null),
        loginMode ? null : sec(t('set.sync'),
            isDav ? h('label', {}, h('span', { text: t('set.autosync') }), select('s-autosync', AUTOSYNC_OPTIONS, ctx.settings.autosync, (v) => t('autosync.' + v), (v) => update({ autosync: v }))) : h('p', { class: 'hint', text: t('set.file.note') }),
            isDav ? h('label', {}, h('span', { text: t('set.backupkeep') }), select('s-backupkeep', BACKUPKEEP_OPTIONS, ctx.settings.backupKeep, (v) => t('backupkeep.' + v), (v) => update({ backupKeep: Number(v) })), h('small', { class: 'hint', text: t('set.backupkeep.hint') })) : null,
            isDav ? check('s-offline', t('set.offline'), 'offline', t('set.offline.hint')) : null,
            isDav ? h('p', { class: 'hint', text: t('set.offline.note') }) : null),
        loginMode ? null : sec(t('set.security'),
            h('div', { class: 'grid2' },
                h('label', {}, h('span', { text: t('set.autolock') }), select('s-autolock', AUTOLOCK_OPTIONS, ctx.settings.autolock, (v) => t('autolock.' + v), (v) => update({ autolock: Number(v), autolockSeconds: Number(v) * 60 }))),
                h('label', {}, h('span', { text: t('set.clipboard') }), select('s-clipboard', CLIPBOARD_OPTIONS, ctx.settings.clipboard, (v) => t('clip.' + v), (v) => update({ clipboard: Number(v) })))),
            check('s-lockhide', t('set.lockhide'), 'lockOnHide')),
        sec(t('set.kf'), kfBox, h('p', { class: 'hint', text: t(ctx.NC?.pepperUrl ? 'set.kf.note.nc' : 'set.kf.note') }),
            ctx.NC?.pepperUrl ? h('div', { class: 'stack tight' },
                h('div', {}, h('button', { type: 'button', class: 'small danger-ghost', id: 'kf-revoke', text: t('set.kf.revoke'), onclick: async () => {
                    if (!(await confirmDialog({ title: t('set.kf.revoke'), message: t('set.kf.revoke.msg'), confirmLabel: t('set.kf.revoke'), cancelLabel: t('cancel'), danger: true }))) return;
                    try {
                        await fetchPepper(ctx.NC, nextcloudAuth(ctx.NC), { rotate: true });
                        await kfStore.forgetAll(kfScope).catch(() => {});
                        toast(t('set.kf.revoked')); fillKf();
                    } catch (e) { toast(t('set.kf.revoke.failed', { msg: errText(e) }), { kind: 'error' }); }
                } })),
                h('small', { class: 'hint', text: t('set.kf.revoke.hint') })) : null),
        h('p', { class: 'hint', id: 'app-version', text: 'KeePassNC ' + __VERSION__ }));
    const m = modal({ title: t('settings'), body, size: 'md', cls: 'settings-modal', actions: [h('button', { type: 'button', class: 'primary', id: 'settings-close', text: t('done'), onclick: () => m.close() })] });
    return m;
}
