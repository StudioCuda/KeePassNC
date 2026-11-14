// Create/edit an entry. Fields that aren't shown (passkeys, browser data, Auto-Type ...) stay unchanged in the vault (see Vault.applyEntry).
import { fieldText, isProtected, STANDARD_FIELDS } from '../vault.js';
import { isSystemField, entryExpiry, entryColor, ENTRY_COLORS, splitTags, toOtpUri } from '../core/util.js';
import { excluded, reusedBy } from '../core/audit.js';
import { t, errText } from '../i18n.js';
import { ctx, setStatus } from './ctx.js';
import { h, icon, iconBtn, toast } from './dom.js';
import { changed, isSwapping, refreshDirtyIndicator } from './session.js';
import { strengthBar, binData, sizeLabel } from './detail.js';
import { groupSelect, selectedGroup } from './groups.js';
import { openGenerator } from './generator-dialog.js';
import { allRealEntries } from './common.js';
import { iconSelOf, iconPreview, pickIcon, commitIconSel } from './icon-picker.js';
import { readQr } from '../qr.js';

const { state } = ctx;
const firstGroup = () => state.vault.root.groups.find((x) => x !== state.vault.recycleBin) || state.vault.root;

/**
 * state.editing = {entry|null, group} plus, once the form is built: form, collect() (the form's values), relink(), base (the values it
 * started with) and gone (the entry was deleted meanwhile). While the soft lock hides the view the form is gone and draft holds the values.
 */
export function startEdit(entry, group) {
    if (state.vault.readOnly) { setStatus(errText(state.vault.readOnlyError()), 'warn'); return; }
    if (isSwapping()) { setStatus(t('sync.busy'), 'warn'); return; } // a pull in flight would swap the database under the editor
    const g = entry?.parentGroup || group || (state.filter.type === 'group' && state.filter.group !== state.vault.recycleBin ? state.filter.group : null) || firstGroup();
    state.editing = { entry, group: g };
    state.view = 'detail';
    ctx.ui.refresh();
}
export function cancelEdit() { state.editing = null; ctx.ui.refresh(); }

/** Compares two sets of form values (collect()); attachments by name, a new icon by its picture. */
const draftKey = (d) => JSON.stringify({ ...d, generated: undefined, att: [[...d.att.add.keys()], [...d.att.remove]], iconSel: [d.iconSel.icon, d.iconSel.custom, d.iconSel.add?.url ?? null] });

/** Has anything been typed or picked in the editor that Apply hasn't stored yet? Locking asks for it (session.js doLock). */
export function editorChanged() {
    const ed = state.editing;
    const now = ed && (ed.draft || ed.collect?.());
    return !!now && draftKey(now) !== draftKey(ed.base);
}

/**
 * The soft lock hides the view. What was typed stays in memory only, as plain values like the database itself, not as fields in the page;
 * after unlocking the editor is built again from them. An editor without changes simply closes.
 */
export function parkEditor() {
    const ed = state.editing;
    if (!ed) return;
    if (!editorChanged()) { state.editing = null; return; }
    if (ed.form) ed.draft = ed.collect();
    ed.form = ed.collect = ed.relink = null;
}

/**
 * The entry and group the editor works on, looked up again by UUID: after the database was swapped or merged with the server's version
 * they may be other objects now, or gone. An entry deleted for good (not just into the recycle bin) stays as it was, marked gone:
 * Apply creates it again instead of writing into an object that is no longer part of the database.
 */
function relocate(ed) {
    const v = state.vault;
    if (ed.entry) {
        let found = null;
        for (const e of v.root.allEntries()) if (e.uuid.equals(ed.entry.uuid)) { found = e; break; }
        if (found) ed.entry = found;
        ed.gone = !found;
    }
    ed.group = (ed.group && v.db.getGroup(ed.group.uuid)) || firstGroup();
}

export function renderEditor(host) {
    const ed = state.editing;
    // A redraw (a change elsewhere, Undo, a merge with the server's version) keeps the form and whatever was typed into it
    if (ed.form && host.contains(ed.form)) { ed.relink(); return; }
    if (ed.form) ed.draft = ed.collect(); // the whole page was built anew (other language): the new form starts from what was typed
    relocate(ed);
    const { entry, group } = ed;
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
        expiry: h('input', { id: 'e-expiry', type: 'date', 'aria-label': t('expires') }),
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
    const colorBox = h('div', { class: 'swatches', id: 'e-color', role: 'radiogroup', 'aria-label': t('f.color') }, swatch(''), ...[...new Set([...ENTRY_COLORS, color, ed.draft?.color].filter(Boolean))].map(swatch));
    let generated = null; // {pw, bits} from the generator: exact strength as long as the field is unchanged
    const meter = h('div', { class: 'meter' }, strengthBar(i.Password.value));
    i.Password.addEventListener('input', () => meter.replaceChildren(strengthBar(i.Password.value, generated?.pw === i.Password.value ? generated.bits : undefined)));
    // A quiet note when another entry has the same password (the health report's rule); a pause after typing keeps it from flickering
    const reuse = h('p', { class: 'hint reuse', id: 'e-reuse', role: 'status', hidden: true });
    let reuseTimer = null;
    const SHOWN = 2; // names listed; a password that sits in hundreds of entries stays a short line ("A, B (+198)"), CSS keeps it to two lines
    const checkReuse = () => {
        if (!reuse.isConnected) return; // the editor was closed (or the vault locked) in the meantime
        const names = i.excludeReports.checked ? [] : reusedBy(allRealEntries(), ed.entry, i.Password.value).map((e) => fieldText(e.fields.get('Title')) || t('entry.untitled')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const text = !names.length ? '' : t(names.length > SHOWN ? 'pw.reused.more' : 'pw.reused', { names: names.slice(0, SHOWN).join(', '), n: names.length - SHOWN });
        if (reuse.textContent !== text) reuse.textContent = text;
        reuse.hidden = !text;
    };
    i.Password.addEventListener('input', () => { clearTimeout(reuseTimer); reuseTimer = setTimeout(checkReuse, 250); });
    i.excludeReports.addEventListener('change', checkReuse);
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
            h('input', { placeholder: t('field.name'), value: name, class: 'c-name', 'aria-label': t('field.name'), list: 'field-suggestions', autocomplete: 'off' }),
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

    // Attachments: changes stay in this draft (files added, names removed) and only reach the entry with "Apply", like every other field
    const att = { add: new Map(), remove: new Set() };
    const attRows = h('div', { id: 'e-att-list' });
    const attNames = () => new Set([...(ed.entry?.binaries.keys() || [])].filter((n) => !att.remove.has(n)).concat([...att.add.keys()]));
    const renderAtt = () => {
        const row = (name, size, isNew, onRemove) => h('div', { class: 'att-row' + (isNew ? ' new' : ''), 'data-testid': 'e-att-row' }, icon('clip'), h('span', { class: 'grow', text: name }),
            isNew ? h('span', { class: 'badge', text: t('attachment.new') }) : null, h('span', { class: 'muted', text: sizeLabel(size) }),
            iconBtn('trash', t('attachment.remove'), onRemove, { type: 'button', 'data-testid': 'e-att-remove' }));
        const rows = [];
        for (const [name, bin] of ed.entry?.binaries || []) if (!att.remove.has(name)) rows.push(row(name, binData(bin)?.byteLength ?? 0, false, () => { att.remove.add(name); renderAtt(); }));
        for (const [name, f] of att.add) rows.push(row(name, f.size, true, () => { att.add.delete(name); renderAtt(); }));
        attRows.replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint', text: t('attachments.none') })]));
    };
    const addFiles = (files) => {
        for (const f of files) {
            if (f.size > 64 * 1024 * 1024) { toast(t('attachment.toolarge', { name: f.name }), { kind: 'warn' }); continue; }
            if (attNames().has(f.name)) { toast(t('e.att.exists', { name: f.name }), { kind: 'warn' }); continue; }
            att.add.set(f.name, f);
        }
        renderAtt();
    };
    const attInput = h('input', { type: 'file', id: 'att-input', multiple: true, class: 'sr-only', tabindex: -1, 'aria-label': t('attachment.add'), onchange: () => { addFiles([...attInput.files]); attInput.value = ''; } });
    const dropZone = h('div', { class: 'dropzone', id: 'e-att-drop', role: 'button', tabindex: 0, 'aria-label': t('attachment.add') }, icon('upload'), h('span', { text: t('attachment.drop') }));
    dropZone.addEventListener('click', () => attInput.click());
    dropZone.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); attInput.click(); } });
    for (const type of ['dragenter', 'dragover']) dropZone.addEventListener(type, (ev) => { ev.preventDefault(); dropZone.classList.add('drop'); });
    for (const type of ['dragleave', 'drop']) dropZone.addEventListener(type, () => dropZone.classList.remove('drop'));
    dropZone.addEventListener('drop', (ev) => { ev.preventDefault(); addFiles([...ev.dataTransfer.files]); });
    renderAtt();

    const tagSugg = h('datalist', { id: 'tag-suggestions' });
    const allTags = new Set(); for (const e of allRealEntries()) for (const tg of e.tags || []) allTags.add(tg);
    for (const tg of [...allTags].sort()) tagSugg.append(h('option', { value: tg }));
    const fieldSugg = h('datalist', { id: 'field-suggestions' }); // names of the custom fields already used in this database
    const allFields = new Set(); for (const e of allRealEntries()) for (const k of e.fields.keys()) if (!STANDARD_FIELDS.includes(k) && !isSystemField(k)) allFields.add(k);
    for (const k of [...allFields].sort()) fieldSugg.append(h('option', { value: k }));

    const goneNote = h('p', { class: 'level-note warn', id: 'e-gone', role: 'status', hidden: !ed.gone, text: t('entry.gone') });
    const form = h('form', { class: 'editor', id: 'edit-form', novalidate: true },
        h('header', { class: 'detail-head' },
            iconBtn('chevronLeft', t('back'), cancelEdit, { class: 'back-btn', type: 'button' }),
            h('h2', { text: entry ? t('entry.edit') : t('entry.new') }),
            h('div', { class: 'dh-actions' },
                h('button', { type: 'button', id: 'cancel-btn', onclick: cancelEdit, text: t('cancel') }),
                h('button', { type: 'submit', class: 'primary', id: 'apply-btn' }, icon('check'), h('span', { text: t('apply') })))),
        h('div', { class: 'detail-body' }, goneNote,
            h('section', { class: 'card stack' },
                h('div', { class: 'title-row' }, iconBtnEl, h('label', { class: 'grow' }, h('span', { text: t('f.title') }), i.Title)),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('f.user') }), i.UserName), h('label', {}, h('span', { text: t('group') }), groupSel)),
                h('label', {}, h('span', { text: t('f.password') }), h('div', { class: 'input-group' }, i.Password, showBtn, genBtn)), meter, reuse,
                h('label', { class: 'check' }, i.excludeReports, h('span', { text: t('f.reports') })),
                h('label', {}, h('span', { text: t('f.url') }), i.URL)),
            h('section', { class: 'card stack' },
                h('label', {}, h('span', { text: t('notes') }), i.Notes),
                h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('f.tags') }), i.tags, tagSugg), h('div', { class: 'stack tight' }, h('label', { class: 'check' }, i.expires, h('span', { text: t('expires') })), i.expiry))),
            h('section', { class: 'card stack' }, h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('f.color') }), colorBox)),
            h('section', { class: 'card stack' }, h('label', {}, h('span', { text: t('f.totp') }), h('div', { class: 'input-group' }, i.otp, qrLabel, qrInput)), h('p', { class: 'hint', text: t('f.totp.hint') })),
            h('section', { class: 'card stack' }, h('div', { class: 'flabel', text: t('fields.more') }), customBox,
                h('div', {}, h('button', { type: 'button', class: 'btn small', id: 'add-custom', onclick: () => addCustom().querySelector('.c-name').focus() }, icon('plus'), t('field.add')), fieldSugg)),
            h('section', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('clip'), h('span', { class: 'grow', text: t('attachments') })), attRows, dropZone, attInput)));

    // Everything the form holds, as plain values: to tell whether anything changed, and to build the form again (soft lock, new language)
    const collect = () => ({
        Title: i.Title.value, UserName: i.UserName.value, Password: i.Password.value, URL: i.URL.value, Notes: i.Notes.value, tags: i.tags.value, otp: i.otp.value,
        expires: i.expires.checked, expiry: i.expiry.value, excludeReports: i.excludeReports.checked, group: groupSel.value, color: colorBox.querySelector(':checked')?.value ?? '',
        custom: [...customBox.querySelectorAll('.custom-row')].map((r) => ({ name: r.querySelector('.c-name').value, value: r.customValue(), protect: r.querySelector('.c-protect').checked })),
        iconSel, att: { add: new Map(att.add), remove: new Set(att.remove) }, generated
    });
    const restore = (d) => {
        for (const k of ['Title', 'UserName', 'Password', 'URL', 'Notes', 'tags', 'otp', 'expiry']) i[k].value = d[k];
        i.expires.checked = d.expires; i.expiry.disabled = !d.expires; i.excludeReports.checked = d.excludeReports;
        if ([...groupSel.options].some((o) => o.value === d.group)) groupSel.value = d.group; // a group deleted meanwhile: the entry's own stays chosen
        for (const r of colorBox.querySelectorAll('input')) r.checked = r.value === d.color;
        customBox.replaceChildren(); for (const c of d.custom) addCustom(c.name, c.value, c.protect);
        iconSel = d.iconSel; att.add = new Map(d.att.add); att.remove = new Set(d.att.remove); generated = d.generated;
        showIcon(); renderAtt(); i.Password.dispatchEvent(new Event('input')); // strength meter and the note on reused passwords
    };
    // After a redraw: the same form, but the entry and the groups as the database has them now
    const relink = () => {
        relocate(ed);
        const keep = selectedGroup(groupSel) || ed.group;
        const fresh = groupSelect({ value: keep });
        const value = fresh.value;
        groupSel.replaceChildren(...fresh.options); // groups added or deleted on the other device
        groupSel.value = value;
        renderAtt();
        goneNote.hidden = !ed.gone;
    };
    ed.form = form; ed.collect = collect; ed.relink = relink;
    ed.base ??= collect();
    if (ed.draft) { restore(ed.draft); ed.draft = null; }

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        relocate(ed); // a merge may have come in since the last redraw
        goneNote.hidden = !ed.gone;
        const old = ed.entry, entry = ed.gone ? null : old;
        const added = new Map();
        try {
            // Deleted meanwhile: the entry comes back as a new one, with the attachments the editor still lists (stored again, the merge dropped them)
            if (ed.gone) for (const [name, bin] of old.binaries) if (!att.remove.has(name)) added.set(name, await v.makeBinary(bin?.hash ? bin.value : bin));
            for (const [name, f] of att.add) added.set(name, await v.makeBinary(await f.arrayBuffer()));
        } catch (err) { setStatus(errText(err), 'error'); return; }
        const d = collect();
        const data = {
            Title: d.Title, UserName: d.UserName, Password: d.Password, URL: d.URL, Notes: d.Notes,
            tags: splitTags(d.tags), custom: d.custom,
            expires: d.expires, expiryTime: d.expires && d.expiry ? new Date(d.expiry + 'T23:59:59') : null,
            ...commitIconSel(iconSel),
            excludeReports: d.excludeReports,
            attachments: { remove: [...att.remove], add: added },
            color: d.color
        };
        if (d.expires && old?.times.expires && d.expiry === dateStr(old.times.expiryTime)) data.expiryTime = old.times.expiryTime; // leave the time of day unchanged
        // Only a TOTP that was changed here is written: one that came in with a merge stays (and an entry created again needs its own)
        if (ed.gone ? d.otp.trim() : d.otp.trim() !== ed.base.otp) {
            data.otp = toOtpUri(d.otp, d.Title, d.UserName); // a bare secret is completed like KeePassXC does
        }
        const target = selectedGroup(groupSel) || ed.group;
        const saved = v.applyEntry(entry, entry ? entry.parentGroup : target, data);
        if (entry && target && target !== entry.parentGroup) v.moveEntry(entry, target);
        const recreated = ed.gone;
        state.selEntry = saved;
        state.editing = null;
        changed();
        setStatus(recreated ? t('applied.recreated') : ctx.settings.autosync === 'change' && state.source.type === 'dav' ? t('applied.auto') : t('applied'));
    });
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) form.requestSubmit(); });
    host.replaceChildren(form);
    checkReuse();
    i.Title.focus();
}
