// Create/edit an entry. Fields that aren't shown (passkeys, browser data, Auto-Type ...) stay unchanged in the vault (see Vault.applyEntry).
import { fieldText, isProtected, STANDARD_FIELDS } from '../vault.js';
import { isSystemField, entryExpiry, entryColor, ENTRY_COLORS } from '../core/util.js';
import { excluded } from '../core/audit.js';
import { t } from '../i18n.js';
import { ctx, setStatus } from './ctx.js';
import { h, icon, iconBtn, toast } from './dom.js';
import { changed, refreshDirtyIndicator } from './session.js';
import { strengthBar } from './detail.js';
import { groupSelect, selectedGroup } from './groups.js';
import { openGenerator } from './generator-dialog.js';
import { allRealEntries } from './common.js';
import { iconSelOf, iconPreview, pickIcon, commitIconSel } from './icon-picker.js';
import { readQr } from '../qr.js';

const { state } = ctx;

export function startEdit(entry, group) {
    const g = entry?.parentGroup || group || (state.filter.type === 'group' && state.filter.group !== state.vault.recycleBin ? state.filter.group : null) || state.vault.root.groups.find((x) => x !== state.vault.recycleBin) || state.vault.root;
    state.editing = { entry, group: g };
    state.view = 'detail';
    ctx.ui.refresh();
}
export function cancelEdit() { state.editing = null; ctx.ui.refresh(); }

export function renderEditor(host) {
    const { entry, group } = state.editing;
    const v = state.vault;
    const val = (k) => (entry ? fieldText(entry.fields.get(k)) : '');
    const i = {
        Title: h('input', { id: 'e-title', value: val('Title'), 'data-testid': 'e-title', autocomplete: 'off' }),
        UserName: h('input', { id: 'e-user', value: entry ? val('UserName') : v.db.meta.defaultUser || '', autocomplete: 'off', spellcheck: 'false' }),
        Password: h('input', { id: 'e-pass', type: 'password', value: val('Password'), autocomplete: 'new-password', spellcheck: 'false', class: 'mono' }),
        URL: h('input', { id: 'e-url', value: val('URL'), inputmode: 'url', autocomplete: 'off', spellcheck: 'false' }),
        Notes: h('textarea', { id: 'e-notes', rows: 6 }),
        tags: h('input', { id: 'e-tags', value: (entry?.tags || []).join(', '), autocomplete: 'off', list: 'tag-suggestions' }),
        otp: h('input', { id: 'e-otp', value: val('otp'), placeholder: 'otpauth://totp/…  /  Base32', autocomplete: 'off', spellcheck: 'false', class: 'mono' }),
        expires: h('input', { id: 'e-expires', type: 'checkbox', checked: !!entry?.times.expires }),
        expiry: h('input', { id: 'e-expiry', type: 'date' }),
        excludeReports: h('input', { id: 'e-noreport', type: 'checkbox', checked: !!entry && excluded(entry) })
    };
    i.Notes.value = val('Notes');
    const exp = entryExpiry(entry || {});
    const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    i.expiry.value = exp ? dateStr(exp) : dateStr(new Date(Date.now() + 365 * 86400000));
    i.expiry.disabled = !i.expires.checked;
    i.expires.addEventListener('change', () => { i.expiry.disabled = !i.expires.checked; });
    const groupSel = groupSelect({ value: group, id: 'e-group' });
    // TOTP from a QR code: pick a screenshot of the setup page, only otpauth:// is accepted
    const qrInput = h('input', { type: 'file', id: 'e-qr', accept: 'image/*', class: 'sr-only', onchange: async () => {
        const f = qrInput.files[0]; qrInput.value = '';
        if (!f) return;
        const text = await readQr(f).catch(() => null);
        if (text && /^otpauth:\/\//i.test(text)) { i.otp.value = text; toast(t('qr.ok')); } else toast(t(text ? 'qr.other' : 'qr.none'), { kind: 'warn' });
    } });
    const qrLabel = h('label', { class: 'btn', for: 'e-qr', title: t('qr.read') }, icon('qr'), h('span', { text: t('qr.read') }));
    const color = entryColor(entry) || '';
    const swatch = (c) => {
        const r = h('input', { type: 'radio', name: 'e-color', value: c, checked: c === color, class: 'swatch' + (c ? '' : ' none'), title: c || t('color.none'), 'aria-label': c || t('color.none') });
        if (c) r.style.setProperty('--swatch', c); // CSSOM, no style attribute (CSP)
        return r;
    };
    const colorBox = h('div', { class: 'swatches', id: 'e-color', role: 'radiogroup', 'aria-label': t('f.color') }, swatch(''), ...[...new Set([...ENTRY_COLORS, color].filter(Boolean))].map(swatch));
    let generated = null; // {pw, bits} from the generator: exact strength as long as the field is unchanged
    const meter = h('div', { class: 'meter' }, strengthBar(i.Password.value));
    i.Password.addEventListener('input', () => meter.replaceChildren(strengthBar(i.Password.value, generated?.pw === i.Password.value ? generated.bits : undefined)));
    const showBtn = iconBtn('eye', t('show'), () => { const on = i.Password.type === 'password'; i.Password.type = on ? 'text' : 'password'; showBtn.replaceChildren(icon(on ? 'eyeOff' : 'eye')); }, { id: 'e-show', type: 'button' });
    const genBtn = h('button', { type: 'button', id: 'gen-btn', class: 'btn', onclick: () => openGenerator({ onUse: (pw, bits) => { generated = { pw, bits }; i.Password.value = pw; i.Password.dispatchEvent(new Event('input')); } }) }, icon('dice'), h('span', { text: t('generator') }));

    let iconSel = iconSelOf(entry, 'entry');
    const iconBtnEl = h('button', { type: 'button', class: 'icon-pick', id: 'e-icon', title: t('icon.change'), 'aria-label': t('icon.change'), onclick: async () => {
        const sel = await pickIcon({ kind: 'entry', sel: iconSel, title: i.Title.value, onRemoved: () => { ctx.ui.renderSidebar(); ctx.ui.renderList(); refreshDirtyIndicator(); } });
        if (sel) { iconSel = sel; showIcon(); }
    } });
    const showIcon = () => iconBtnEl.replaceChildren(iconPreview(iconSel, 'entry', i.Title.value, 'lg'));
    i.Title.addEventListener('input', () => { if (!iconSel.add && !iconSel.custom && !iconSel.icon) showIcon(); }); // initial letter
    showIcon();

    const customBox = h('div', { id: 'e-custom', class: 'stack' });
    // Values are multi-line (text area). Protected values sit hidden in a password field (display only) and only become
    // editable after a click on the eye; an <input> would lose line breaks on save.
    const lineCount = (v) => Math.min(12, v.split('\n').length);
    const addCustom = (name = '', value = '', protect = false) => {
        const val = h('textarea', { placeholder: t('field.value'), class: 'c-value', 'aria-label': t('field.value'), rows: lineCount(value), autocomplete: 'off', spellcheck: 'false' });
        val.value = value;
        val.addEventListener('input', () => { val.rows = lineCount(val.value); });
        const mask = h('input', { type: 'password', class: 'c-mask', readonly: true, tabindex: -1, 'aria-hidden': 'true' });
        const eye = iconBtn('eye', t('show'), () => setMasked(!val.hidden), { type: 'button', class: 'c-eye' });
        const setMasked = (on) => {
            val.hidden = on; mask.hidden = !on; mask.value = on ? val.value : '';
            eye.replaceChildren(icon(on ? 'eye' : 'eyeOff'));
        };
        const protectBox = h('input', { type: 'checkbox', class: 'c-protect', checked: protect, onchange: (ev) => { eye.hidden = !ev.target.checked; setMasked(ev.target.checked); } });
        const row = h('div', { class: 'custom-row' },
            h('input', { placeholder: t('field.name'), value: name, class: 'c-name', 'aria-label': t('field.name') }),
            h('div', { class: 'c-value-wrap' }, val, mask, eye),
            h('label', { class: 'check small' }, protectBox, h('span', { text: t('field.protected') })),
            iconBtn('x', t('remove'), () => row.remove(), { type: 'button' }));
        // Windows line endings (KeePass 2) are kept as long as the value hasn't changed (text areas only deliver \n)
        row.customValue = () => (val.value === value.replace(/\r\n?/g, '\n') ? value : val.value);
        eye.hidden = !protect; setMasked(protect);
        customBox.append(row);
        return row;
    };
    if (entry) for (const [k, vv] of entry.fields) if (!STANDARD_FIELDS.includes(k) && !isSystemField(k)) addCustom(k, fieldText(vv), isProtected(vv));

    const tagSugg = h('datalist', { id: 'tag-suggestions' });
    const allTags = new Set(); for (const e of allRealEntries()) for (const tg of e.tags || []) allTags.add(tg);
    for (const tg of [...allTags].sort()) tagSugg.append(h('option', { value: tg }));

    const form = h('form', { class: 'editor', id: 'edit-form', novalidate: true },
        h('header', { class: 'detail-head' },
            iconBtn('chevronLeft', t('back'), cancelEdit, { class: 'back-btn', type: 'button' }),
            h('h2', { text: entry ? t('entry.edit') : t('entry.new') }),
            h('div', { class: 'dh-actions' },
                h('button', { type: 'button', id: 'cancel-btn', onclick: cancelEdit, text: t('cancel') }),
                h('button', { type: 'submit', class: 'primary', id: 'apply-btn' }, icon('check'), h('span', { text: t('apply') })))),
        h('div', { class: 'detail-body' },
            h('section', { class: 'card stack' },
                h('div', { class: 'title-row' }, iconBtnEl, h('label', { class: 'grow' }, h('span', { text: t('f.title') }), i.Title)),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('f.user') }), i.UserName), h('label', {}, h('span', { text: t('group') }), groupSel)),
                h('label', {}, h('span', { text: t('f.password') }), h('div', { class: 'input-group' }, i.Password, showBtn, genBtn)), meter,
                h('label', { class: 'check' }, i.excludeReports, h('span', { text: t('f.reports') })),
                h('label', {}, h('span', { text: t('f.url') }), i.URL)),
            h('section', { class: 'card stack' },
                h('label', {}, h('span', { text: t('notes') }), i.Notes),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('f.tags') }), i.tags, tagSugg), h('div', { class: 'stack tight' }, h('label', { class: 'check' }, i.expires, h('span', { text: t('expires') })), i.expiry))),
            h('section', { class: 'card stack' }, h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('f.color') }), colorBox)),
            h('section', { class: 'card stack' }, h('label', {}, h('span', { text: t('f.totp') }), h('div', { class: 'input-group' }, i.otp, qrLabel, qrInput)), h('p', { class: 'hint', text: t('f.totp.hint') })),
            h('section', { class: 'card stack' }, h('div', { class: 'flabel', text: t('fields.more') }), customBox,
                h('div', {}, h('button', { type: 'button', class: 'btn small', id: 'add-custom', onclick: () => addCustom().querySelector('.c-name').focus() }, icon('plus'), t('field.add'))))));

    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const custom = [...customBox.querySelectorAll('.custom-row')].map((r) => ({ name: r.querySelector('.c-name').value, value: r.customValue(), protect: r.querySelector('.c-protect').checked }));
        const data = {
            Title: i.Title.value, UserName: i.UserName.value, Password: i.Password.value, URL: i.URL.value, Notes: i.Notes.value,
            tags: i.tags.value.split(/[,;]/).map((x) => x.trim()).filter(Boolean), custom,
            expires: i.expires.checked, expiryTime: i.expires.checked && i.expiry.value ? new Date(i.expiry.value + 'T23:59:59') : null,
            ...commitIconSel(iconSel),
            excludeReports: i.excludeReports.checked,
            color: colorBox.querySelector(':checked')?.value ?? ''
        };
        if (i.expires.checked && entry?.times.expires && i.expiry.value === dateStr(entry.times.expiryTime)) data.expiryTime = entry.times.expiryTime; // leave the time of day unchanged
        if (i.otp.value.trim() !== val('otp')) {
            let o = i.otp.value.trim();
            if (o && !/^otpauth:\/\//i.test(o)) { // only the secret was entered: complete it to an otpauth URL like KeePassXC does
                const label = encodeURIComponent(i.Title.value || 'KeePassNC') + (i.UserName.value ? ':' + encodeURIComponent(i.UserName.value) : '');
                o = `otpauth://totp/${label}?secret=${o.replace(/[\s-]/g, '').toUpperCase()}&period=30&digits=6&issuer=${encodeURIComponent(i.Title.value || 'KeePassNC')}`;
            }
            data.otp = o;
        }
        const target = selectedGroup(groupSel) || group;
        const saved = v.applyEntry(entry, entry ? entry.parentGroup : target, data);
        if (entry && target && target !== entry.parentGroup) v.moveEntry(entry, target);
        state.selEntry = saved;
        state.editing = null;
        changed();
        setStatus(ctx.settings.autosync === 'change' && state.source.type === 'dav' ? t('applied.auto') : t('applied'));
    });
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) form.requestSubmit(); });
    host.replaceChildren(form);
    i.Title.focus();
}
