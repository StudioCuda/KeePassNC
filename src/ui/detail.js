// Detail view of an entry: fields, password (strength, large view), TOTP ring, passkey info, attachments, history.
import { fieldText, isProtected, STANDARD_FIELDS } from '../vault.js';
import { parseOtpConfig, totp } from '../totp.js';
import { entryExpiry, daysUntil, domainOf, openableUrl, isSystemField, isPasskey, groupPath, fieldOf, previewKind, previewOf } from '../core/util.js';
import { t, fmtDate, errText } from '../i18n.js';
import { ctx, copy, download, setStatus, pref } from './ctx.js';
import { h, icon, iconBtn, modal, toast, confirmDialog, popupMenu } from './dom.js';
import { avatar, expiryBadge, resolvedField } from './common.js';
import { colorizedPassword, strengthBar } from './pwview.js';
import { changed } from './session.js';
import { setFilter, groupSelect, selectedGroup } from './groups.js';
import { startEdit } from './editor.js';

const { state } = ctx;
let totpTimer = null;
export function stopDetailTimers() { clearInterval(totpTimer); totpTimer = null; }

const DOTS = '•'.repeat(12);
export const binData = (bin) => { let d = bin?.value ?? bin; if (d && typeof d.getBinary === 'function') d = d.getBinary(); return d; };

export { colorizedPassword, strengthBar };

function field(label, valueNode, actions = [], cls = '') {
    return h('div', { class: 'field ' + cls }, h('div', { class: 'flabel', text: label }), h('div', { class: 'fvalue' }, h('div', { class: 'fv-main' }, valueNode), h('div', { class: 'fv-actions' }, ...actions)));
}
const linkOrText = (text, href, attrs = {}) => href ? h('a', { ...attrs, href, target: '_blank', rel: 'noopener noreferrer', text, title: domainOf(href) }) : h('span', { ...attrs, text });
const copyBtn = (text, label, extra = {}) => iconBtn('copy', t('copy') + ': ' + label, () => copy(typeof text === 'function' ? text() : text, label), extra);

export function renderDetail(host) {
    stopDetailTimers();
    if (state.editing) return ctx.ui.renderEditor(host);
    const e = state.selEntry;
    if (!e) {
        host.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, icon('shield')), h('h3', { text: t('detail.empty.title') }), h('p', { class: 'muted', text: t('detail.empty.text') }),
            h('button', { type: 'button', class: 'primary', onclick: () => startEdit(null), text: t('entry.new') })));
        return;
    }
    const v = state.vault;
    const inBin = v.isInRecycleBin(e), forever = v.deletesForever(e);
    const pwText = resolvedField(e, 'Password');
    const title = fieldText(e.fields.get('Title')) || t('entry.untitled');

    // --- Header
    const head = h('header', { class: 'detail-head' },
        iconBtn('chevronLeft', t('back'), () => { state.view = 'list'; ctx.ui.applyView(); }, { class: 'back-btn' }),
        avatar(e, { size: 'lg' }),
        h('div', { class: 'dh-text' }, h('h2', { 'data-testid': 'f-title', text: title }), h('div', { class: 'muted crumbs' }, icon('folder'), h('span', { text: groupPath(e.parentGroup) || t('group.root') })), expiryBadge(e)),
        h('div', { class: 'dh-actions' },
            h('button', { id: 'edit-btn', type: 'button', class: 'primary', onclick: () => startEdit(e) }, icon('edit'), h('span', { text: t('edit') })),
            inBin ? h('button', { id: 'restore-btn', type: 'button', onclick: () => restoreEntry(e) }, icon('restore'), h('span', { text: t('restore') })) : null,
            iconBtn('more', t('more'), (ev) => entryMenu(ev.currentTarget, e), { id: 'entry-more' }),
            h('button', { id: 'del-btn', type: 'button', class: 'danger-ghost', onclick: () => deleteEntry(e), title: forever ? t('delete.forever') : t('delete') }, icon('trash'), h('span', { class: 'sr-or-wide', text: forever ? t('delete.forever') : t('delete') }))));

    // --- Fields
    const cards = [];
    const user = resolvedField(e, 'UserName');
    const url = resolvedField(e, 'URL');
    const main = [];
    main.push(field(t('f.user'), h('span', { 'data-testid': 'f-user', text: user }), [copyBtn(user, t('f.user'), { 'data-testid': 'user-copy' })]));

    const pwSpan = h('span', { class: 'secret', 'data-testid': 'pw-value', text: pwText ? DOTS : '' });
    let shown = false;
    const toggle = iconBtn('eye', t('show'), () => {
        shown = !shown;
        pwSpan.replaceChildren(...(shown ? [colorizedPassword(pwText)] : [DOTS]));
        toggle.replaceChildren(icon(shown ? 'eyeOff' : 'eye')); toggle.title = toggle.ariaLabel = shown ? t('hide') : t('show');
    }, { 'data-testid': 'pw-toggle' });
    main.push(field(t('f.password'), h('div', {}, pwSpan, pwText && !pwText.includes('{REF:') ? strengthBar(pwText) : null), [toggle,
        iconBtn('search', t('pw.large'), () => largeType(pwText, title), { 'data-testid': 'pw-large' }), copyBtn(pwText, t('f.password'), { 'data-testid': 'pw-copy' })], 'pw'));

    if (url) {
        main.push(field(t('f.url'), linkOrText(url, openableUrl(url), { 'data-testid': 'f-url' }), [copyBtn(url, t('f.url'))]));
    }

    // TOTP
    let otpCfg = null;
    try { otpCfg = parseOtpConfig(fieldText(e.fields.get('otp')), fieldText(e.fields.get('TOTP Seed')), fieldText(e.fields.get('TOTP Settings'))); } catch (err) { main.push(field('TOTP', h('span', { class: 'error', text: err.message }))); }
    if (otpCfg) {
        const codeEl = h('span', { class: 'totp', 'data-testid': 'totp-code', text: '------' });
        const NSs = 'http://www.w3.org/2000/svg';
        const ring = document.createElementNS(NSs, 'svg'); ring.setAttribute('viewBox', '0 0 36 36'); ring.setAttribute('class', 'ring');
        const bg = document.createElementNS(NSs, 'circle'), fg = document.createElementNS(NSs, 'circle');
        for (const c of [bg, fg]) { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', '15'); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '3'); }
        bg.setAttribute('class', 'ring-bg'); fg.setAttribute('class', 'ring-fg'); fg.setAttribute('stroke-dasharray', '94.25'); fg.setAttribute('stroke-linecap', 'round');
        ring.append(bg, fg);
        const remEl = h('span', { class: 'ring-num' });
        const tick = async () => {
            const r = await totp(otpCfg);
            codeEl.textContent = r.code;
            remEl.textContent = String(r.remaining);
            fg.setAttribute('stroke-dashoffset', String(94.25 * (1 - r.remaining / (otpCfg.period || 30))));
            ring.classList.toggle('low', r.remaining <= 5);
        };
        tick(); totpTimer = setInterval(tick, 1000);
        main.push(field('TOTP', h('div', { class: 'totp-box' }, codeEl, h('span', { class: 'ring-wrap' }, ring, remEl)), [copyBtn(async () => (await totp(otpCfg)).code, 'TOTP', { 'data-testid': 'totp-copy' })], 'totp'));
        // copyBtn with async: own behaviour
        main[main.length - 1].querySelector('[data-testid=totp-copy]').onclick = async () => copy((await totp(otpCfg)).code, 'TOTP');
    }
    cards.push(h('section', { class: 'card' }, ...main));

    const notes = fieldText(e.fields.get('Notes'));
    if (notes) cards.push(h('section', { class: 'card' }, field(t('notes'), h('pre', { class: 'notes', text: notes }), [copyBtn(notes, t('notes'))])));

    const custom = [];
    for (const [k, val] of e.fields) {
        if (STANDARD_FIELDS.includes(k) || isSystemField(k)) continue;
        const text = fieldText(val);
        // unprotected extra fields with an http(s) address (or URL in the name, e.g. KP2A_URL_1) are links like the URL field
        const href = isProtected(val) ? null : openableUrl(text, { bare: /url/i.test(k) });
        const span = href ? linkOrText(text, href, { 'data-testid': 'custom-' + k }) : h('span', { 'data-testid': 'custom-' + k, class: 'multiline', text: isProtected(val) ? DOTS : text });
        const actions = isProtected(val) ? [iconBtn('eye', t('show'), (ev) => { const on = span.dataset.on !== '1'; span.dataset.on = on ? '1' : '0'; span.textContent = on ? text : DOTS; ev.currentTarget.replaceChildren(icon(on ? 'eyeOff' : 'eye')); })] : [];
        custom.push(field(k, span, [...actions, copyBtn(text, k)]));
    }
    if (custom.length) cards.push(h('section', { class: 'card' }, ...custom));

    if (e.tags?.length) cards.push(h('section', { class: 'card tags-card' }, h('div', { class: 'flabel', text: t('f.tags') }),
        h('div', { class: 'chips', 'data-testid': 'f-tags' }, ...e.tags.map((tg) => h('button', { type: 'button', class: 'chip', onclick: () => setFilter({ type: 'tag', tag: tg }), text: tg })))));

    if (isPasskey(e)) {
        const rp = fieldOf(e, 'KPEX_PASSKEY_RELYING_PARTY'), pu = fieldOf(e, 'KPEX_PASSKEY_USERNAME'), cid = fieldOf(e, 'KPEX_PASSKEY_CREDENTIAL_ID');
        cards.push(h('section', { class: 'card passkey-card', 'data-testid': 'passkey-card' }, h('div', { class: 'card-title' }, icon('passkey'), h('span', { text: t('passkey') })),
            rp ? field(t('passkey.rp'), h('span', { text: rp })) : null, pu ? field(t('passkey.user'), h('span', { text: pu })) : null,
            cid ? field(t('passkey.id'), h('span', { class: 'mono', text: cid.length > 24 ? cid.slice(0, 12) + '…' + cid.slice(-8) : cid })) : null,
            h('p', { class: 'hint', text: t('passkey.note') }),
            h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'small danger-ghost', 'data-testid': 'passkey-remove', text: t('passkey.remove'), onclick: async () => {
                if (await confirmDialog({ title: t('passkey.remove'), message: t('passkey.remove.msg', { rp: rp || fieldOf(e, 'Title') }), confirmLabel: t('passkey.remove'), cancelLabel: t('cancel'), danger: true })) {
                    v.removePasskey(e); changed(); toast(t('passkey.removed'));
                }
            } }))));
    }

    cards.push(attachmentsCard(e));
    if (e.history?.length) cards.push(historyCard(e));
    cards.push(h('section', { class: 'card meta' },
        h('span', {}, `${t('meta.created')}: ${fmtDate(e.times.creationTime, true)}`), h('span', {}, `${t('meta.modified')}: ${fmtDate(e.times.lastModTime, true)}`),
        entryExpiry(e) ? h('span', {}, `${t('meta.expires')}: ${fmtDate(entryExpiry(e))}`) : null));
    host.replaceChildren(head, h('div', { class: 'detail-body' }, ...cards));
}

function attachmentsCard(e) {
    const v = state.vault;
    const rows = [];
    for (const [name, bin] of e.binaries || []) {
        const data = binData(bin);
        rows.push(h('div', { class: 'att-row' }, icon('clip'), h('span', { class: 'grow', text: name }), h('span', { class: 'muted', text: sizeLabel(data?.byteLength ?? 0) }),
            data && previewKind(name, data.byteLength) ? iconBtn('eye', t('preview'), () => showPreview(name, data), { 'data-testid': 'attachment-preview' }) : null,
            h('button', { type: 'button', class: 'small', 'data-testid': 'attachment', onclick: () => download(name, data) }, icon('download'), h('span', { text: t('download') })),
            iconBtn('trash', t('remove'), async () => { if (await confirmDialog({ title: t('attachment.remove'), message: t('attachment.remove.msg', { name }), confirmLabel: t('remove'), cancelLabel: t('cancel'), danger: true })) { v.removeAttachment(e, name); changed(); } }, { 'data-testid': 'attachment-remove' })));
    }
    const input = h('input', { type: 'file', id: 'att-input', multiple: true, class: 'sr-only', onchange: async () => {
        for (const f of input.files) {
            try {
                if (f.size > 64 * 1024 * 1024) { setStatus(t('attachment.toolarge', { name: f.name }), 'error'); continue; }
                await v.addAttachment(e, f.name, await f.arrayBuffer());
            } catch (err) { setStatus(errText(err), 'error'); }
        }
        input.value = '';
        changed();
    } });
    return h('section', { class: 'card' }, h('div', { class: 'card-title' }, icon('clip'), h('span', { class: 'grow', text: t('attachments') }),
        h('label', { class: 'btn small', for: 'att-input' }, icon('upload'), t('attachment.add')), input), rows.length ? h('div', {}, ...rows) : h('p', { class: 'hint', text: t('attachments.none') }));
}
function showPreview(name, data) {
    const p = previewOf(name, new Uint8Array(data));
    if (!p) { toast(t('preview.none', { name }), { kind: 'warn' }); return; }
    modal({ title: name, size: 'lg', body: p.image ? h('img', { class: 'att-preview', src: p.image, alt: name }) : h('pre', { class: 'att-preview-text', text: p.text }) });
}
export const sizeLabel = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1048576).toFixed(1)} MiB`);

function historyCard(e) {
    const v = state.vault;
    const wrap = h('details', { class: 'card history', 'data-testid': 'history' }, h('summary', { class: 'card-title' }, icon('history'), h('span', { class: 'grow', text: t('history', { n: e.history.length }) })));
    const list = h('div', {});
    e.history.map((hh, i) => [hh, i]).reverse().forEach(([hh, i]) => {
        list.append(h('div', { class: 'hist-row', 'data-testid': 'history-row' },
            h('span', { class: 'grow' }, h('strong', { text: fmtDate(hh.times.lastModTime, true) }), h('span', { class: 'muted', text: ' · ' + changedFields(e, i) })),
            h('button', { type: 'button', class: 'small', onclick: () => viewHistory(hh) }, icon('eye'), t('view')),
            h('button', { type: 'button', class: 'small', 'data-testid': 'history-restore', onclick: () => { v.restoreHistory(e, i); changed(); toast(t('history.restored')); } }, icon('restore'), t('restore')),
            iconBtn('trash', t('delete'), () => { v.deleteHistory(e, i); changed(); })));
    });
    list.append(h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'small danger-ghost', onclick: async () => { if (await confirmDialog({ title: t('history.clear'), message: t('history.clear.msg'), confirmLabel: t('history.clear'), cancelLabel: t('cancel'), danger: true })) { v.clearHistory(e); changed(); } }, text: t('history.clear') })));
    wrap.append(list);
    return wrap;
}
function changedFields(e, i) {
    const a = e.history[i], b = i + 1 < e.history.length ? e.history[i + 1] : e;
    const names = [];
    for (const k of new Set([...a.fields.keys(), ...b.fields.keys()])) if (fieldText(a.fields.get(k)) !== fieldText(b.fields.get(k))) names.push(k === 'UserName' ? t('f.user') : k === 'Password' ? t('f.password') : k === 'Title' ? t('f.title') : k === 'Notes' ? t('notes') : k);
    if (a.binaries.size !== b.binaries.size) names.push(t('attachments'));
    return names.join(', ') || t('history.nochange');
}
function viewHistory(hh) {
    const rows = [];
    for (const [k, val] of hh.fields) {
        const text = fieldText(val);
        const prot = k === 'Password' || isProtected(val);
        const span = h('span', { class: 'mono', text: prot ? DOTS : text });
        rows.push(field(k, span, prot ? [iconBtn('eye', t('show'), (ev) => { const on = span.dataset.on !== '1'; span.dataset.on = on ? '1' : '0'; span.textContent = on ? text : DOTS; ev.currentTarget.replaceChildren(icon(on ? 'eyeOff' : 'eye')); })] : []));
    }
    modal({ title: t('history.version', { date: fmtDate(hh.times.lastModTime, true) }), body: h('div', { class: 'card flat' }, ...rows), size: 'md' });
}

function largeType(pw, title) {
    if (!pw) return;
    const out = h('div', { class: 'large-type', 'data-testid': 'large-type' });
    [...pw].forEach((ch, i) => out.append(h('span', { class: 'lt-ch ' + (/[0-9]/.test(ch) ? 'c-digit' : /[A-Za-z]/.test(ch) ? '' : 'c-sym') }, h('b', { text: ch }), h('i', { text: String(i + 1) }))));
    modal({ title, body: out, size: 'lg' });
}

export function deleteEntry(e) {
    const v = state.vault;
    if (v.deletesForever(e)) {
        return confirmDialog({ title: t('delete.forever'), message: t('entry.delete.forever.msg', { name: fieldOf(e, 'Title') }), confirmLabel: t('delete.forever'), cancelLabel: t('cancel'), danger: true }).then((ok) => {
            if (!ok) return;
            v.removeEntry(e); state.selEntry = null; changed(); setStatus(t('deleted.forever'));
        });
    }
    const prev = e.parentGroup;
    v.removeEntry(e);
    state.selEntry = null; state.view = 'list';
    changed();
    setStatus(t('deleted.bin'));
    toast(t('deleted.bin'), { action: { label: t('undo'), run: () => { v.moveEntry(e, prev); state.selEntry = e; changed(); } }, timeout: 7000 });
}
export function restoreEntry(e) {
    const v = state.vault;
    const target = e.previousParentGroup ? v.db.getGroup(e.previousParentGroup) : null;
    v.moveEntry(e, target || v.root.groups.find((g) => g !== v.recycleBin) || v.root);
    changed();
    toast(t('restored'));
}

function entryMenu(anchor, e) {
    const v = state.vault;
    popupMenu(anchor, [
        { label: t('duplicate'), icon: 'duplicate', onclick: () => (v.isInRecycleBin(e) ? duplicate(e) : duplicateDialog(e)) },
        { label: t('move'), icon: 'moveTo', onclick: () => moveEntryDialog(e) },
        { label: t('entry.copy.user'), icon: 'user', hint: 'Ctrl+B', onclick: () => copy(resolvedField(e, 'UserName'), t('f.user')) },
        { label: t('entry.copy.url'), icon: 'link', onclick: () => copy(resolvedField(e, 'URL'), t('f.url')) }
    ], { align: 'end' });
}
function duplicate(e, linked = false) {
    const c = state.vault.duplicateEntry(e, t('duplicate.suffix'), { linked });
    state.selEntry = c; changed(); toast(t(isPasskey(e) ? 'duplicated.nopasskey' : 'duplicated'));
}
/** Duplicating with the choice to link username and password to the original (field references); the choice is remembered. */
function duplicateDialog(e) {
    const link = h('input', { id: 'dup-link', type: 'checkbox', checked: pref('dupLinked') === '1' });
    const ok = h('button', { type: 'submit', class: 'primary', id: 'dup-ok', text: t('duplicate') });
    const m = modal({ title: t('duplicate'), size: 'sm', body: h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); pref('dupLinked', link.checked ? '1' : '0'); m.close(); duplicate(e, link.checked); } },
        h('label', { class: 'check' }, link, h('span', { text: t('duplicate.link') })), h('small', { class: 'hint', text: t('duplicate.link.hint') }),
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), ok)) });
    ok.focus();
}
export function moveEntryDialog(e) {
    const v = state.vault;
    const sel = groupSelect({ value: e.parentGroup });
    const m = modal({ title: t('move'), size: 'sm', body: h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); v.moveEntry(e, selectedGroup(sel)); m.close(); changed(); } },
        h('label', {}, h('span', { text: t('group') }), sel), h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), h('button', { type: 'submit', class: 'primary', text: t('move') }))) });
}
