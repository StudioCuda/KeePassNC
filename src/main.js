// KeePassNC - Oberflaeche. Es wird ausschliesslich mit DOM-Methoden und textContent gearbeitet (kein innerHTML mit Daten).
import { Vault, VaultError, fieldText, isProtected, generatePassword, STANDARD_FIELDS } from './vault.js';
import { DavFile, DavError } from './webdav.js';
import { readNextcloudContext, nextcloudAuth, davUrlFor, normalizeUserPath } from './nextcloud.js';
import { parseOtpConfig, totp } from './totp.js';

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
}

const params = new URLSearchParams(location.search);
const AUTOLOCK_SECONDS = Math.max(5, parseInt(params.get('autolock') || '300', 10) || 300);
const CLIPBOARD_CLEAR_MS = 20000;

const state = {
    vault: null,
    source: null, // {type: 'dav'|'file', name}
    selectedGroup: null, // KdbxGroup | null (= alle)
    selectedEntry: null,
    editing: null, // {entry|null, group}
    query: '',
    lastActivity: Date.now(),
    totpTimer: null
};

const app = $('#app');
const NC = readNextcloudContext(app);
let statusEl;

function setStatus(msg, kind = 'info') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.dataset.kind = kind;
}

// ---------------------------------------------------------------- Anmeldung
function pref(key, value) {
    try {
        if (value === undefined) return localStorage.getItem('kpnc.' + key) || '';
        localStorage.setItem('kpnc.' + key, value);
    } catch { /* Speicher nicht verfuegbar - kein Problem */ }
    return '';
}

function renderLogin(message) {
    stopTimers();
    state.vault = null;
    state.selectedEntry = null;
    state.editing = null;
    const mode = pref('mode') || (params.get('url') ? 'dav' : 'dav');
    const urlInput = h('input', { id: 'dav-url', type: 'url', placeholder: 'https://cloud.example.org/remote.php/dav/files/NAME/Passwoerter.kdbx', value: params.get('url') || pref('url'), autocomplete: 'off' });
    const userInput = h('input', { id: 'dav-user', type: 'text', value: params.get('user') || pref('user'), autocomplete: 'username' });
    const passInput = h('input', { id: 'dav-pass', type: 'password', autocomplete: 'current-password' });
    const fileInput = h('input', { id: 'local-file', type: 'file', accept: '.kdbx' });
    const masterInput = h('input', { id: 'master', type: 'password', autocomplete: 'off', required: true });
    const keyInput = h('input', { id: 'keyfile', type: 'file' });
    const ncPathInput = h('input', { id: 'nc-path', type: 'text', placeholder: '/Dokumente/Passwoerter.kdbx', value: NC?.file || pref('ncfile'), autocomplete: 'off', readonly: !!NC?.file });
    const davBox = NC
        ? h('div', { id: 'dav-box' },
            h('label', {}, NC.file ? 'Datei in Ihrer Nextcloud' : 'Pfad der KDBX-Datei in Ihrer Nextcloud', ncPathInput),
            h('p', { class: 'muted small-note', text: NC.file ? '' : 'Tipp: In "Dateien" eine .kdbx-Datei anklicken, dann wird sie direkt hier geoeffnet.' }))
        : h('div', { id: 'dav-box' },
            h('label', {}, 'WebDAV-Adresse der Datei', urlInput),
            h('label', {}, 'Benutzername', userInput),
            h('label', {}, 'App-Passwort (Nextcloud: Einstellungen > Sicherheit)', passInput));
    const fileBox = h('div', { id: 'file-box', hidden: true }, h('label', {}, 'KDBX-Datei', fileInput));
    const radio = (value, label) => h('label', { class: 'inline' },
        h('input', { type: 'radio', name: 'src', value, checked: mode === value, onchange: () => { davBox.hidden = value !== 'dav'; fileBox.hidden = value !== 'file'; } }), ' ' + label);
    davBox.hidden = mode !== 'dav';
    fileBox.hidden = mode !== 'file';
    const err = h('p', { class: 'error', id: 'login-error', role: 'alert', text: message || '' });
    const btn = h('button', { type: 'submit', id: 'open-btn', class: 'primary', text: 'Oeffnen' });
    const form = h('form', { class: 'card', id: 'login-form' },
        h('h1', { text: 'KeePassNC' }),
        NC?.filesUrl ? h('p', {}, h('a', { href: NC.filesUrl, id: 'back-link', text: '\u2190 Zurueck zu Dateien' })) : null,
        h('p', { class: 'muted', text: 'Die Datenbank wird nur in diesem Browser entschluesselt. Der Server sieht nur die verschluesselte Datei.' }),
        h('div', { class: 'row' }, radio('dav', NC ? 'Nextcloud-Datei' : 'Nextcloud / WebDAV'), radio('file', 'Lokale Datei')),
        davBox, fileBox,
        h('label', {}, 'Master-Passwort', masterInput),
        h('label', {}, 'Schluesseldatei (optional)', keyInput),
        err, btn);
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Entschluessele ...';
        try {
            const src = form.querySelector('input[name=src]:checked').value;
            pref('mode', src);
            let buf, dav = null, etag = null, name;
            if (src === 'dav') {
                if (NC) {
                    const userPath = normalizeUserPath(ncPathInput.value);
                    if (!userPath || userPath.endsWith('/')) throw new VaultError('Bitte den Pfad der KDBX-Datei eintragen.');
                    if (!NC.file) pref('ncfile', userPath);
                    dav = new DavFile({ url: davUrlFor(NC, userPath), auth: nextcloudAuth(NC) });
                } else {
                    if (!urlInput.value.trim()) throw new VaultError('Bitte die WebDAV-Adresse eintragen.');
                    pref('url', urlInput.value.trim());
                    pref('user', userInput.value);
                    dav = new DavFile({ url: urlInput.value.trim(), user: userInput.value, pass: passInput.value });
                }
                const got = await dav.get();
                buf = got.buf; etag = got.etag;
                name = decodeURIComponent(new URL(dav.url, location.href).pathname.split('/').pop());
            } else {
                const f = fileInput.files[0];
                if (!f) throw new VaultError('Bitte eine KDBX-Datei waehlen.');
                buf = await f.arrayBuffer();
                name = f.name;
            }
            const keyfile = keyInput.files[0] ? new Uint8Array(await keyInput.files[0].arrayBuffer()) : undefined;
            await new Promise((r) => setTimeout(r, 0)); // UI-Text vor der KDF-Berechnung anzeigen
            const vault = await Vault.open({ buf, password: masterInput.value, keyfile, dav, etag });
            masterInput.value = ''; if (passInput) passInput.value = '';
            state.vault = vault;
            state.source = { type: src, name };
            state.selectedGroup = null;
            state.lastActivity = Date.now();
            renderMain();
            setStatus(`${name} geoeffnet (${vault.versionLabel})`);
            startTimers();
        } catch (e) {
            err.textContent = e instanceof VaultError || e instanceof DavError ? e.message : `Fehler: ${e.message || e}`;
            if (!(e instanceof VaultError || e instanceof DavError)) console.error(e);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Oeffnen';
        }
    });
    app.replaceChildren(form);
    masterInput.focus();
}

// ---------------------------------------------------------------- Hauptansicht
function groupLabel(g) { return g.name || '(ohne Namen)'; }

function renderMain() {
    const v = state.vault;
    statusEl = h('div', { id: 'status', role: 'status', 'data-testid': 'status' });
    const search = h('input', { id: 'search', type: 'search', placeholder: 'Suchen (Titel, Benutzer, URL, Notizen, Tags)', value: state.query,
        oninput: (e) => { state.query = e.target.value; renderList(); } });
    const saveBtn = h('button', { id: 'save-btn', class: 'primary', onclick: doSave, text: 'Speichern' });
    const bar = h('header', { class: 'bar' },
        h('strong', { class: 'brand', text: 'KeePassNC' }),
        h('span', { class: 'muted', id: 'file-name', text: state.source.name }),
        search,
        h('button', { id: 'new-btn', onclick: () => startEdit(null), text: 'Neuer Eintrag' }),
        saveBtn,
        h('button', { id: 'lock-btn', onclick: () => lock('Gesperrt.'), text: 'Sperren' }),
        NC?.filesUrl ? h('a', { href: NC.filesUrl, id: 'files-link', class: 'muted', text: 'Dateien' }) : null);
    app.replaceChildren(h('div', { class: 'shell' }, bar,
        h('div', { class: 'panes' },
            h('nav', { id: 'groups', 'aria-label': 'Gruppen' }),
            h('section', { id: 'list', 'aria-label': 'Eintraege' }),
            h('section', { id: 'detail', 'aria-label': 'Details' })),
        statusEl));
    renderGroups();
    renderList();
    renderDetail();
    refreshDirtyIndicator();
}

function refreshDirtyIndicator() {
    const b = $('#save-btn');
    if (!b || !state.vault) return;
    b.textContent = state.vault.dirty ? 'Speichern *' : 'Speichern';
    b.disabled = !state.vault.dirty;
}

function renderGroups() {
    const v = state.vault;
    const nav = $('#groups');
    const items = [h('button', { class: 'group' + (state.selectedGroup === null ? ' active' : ''), onclick: () => { state.selectedGroup = null; renderGroups(); renderList(); }, text: 'Alle Eintraege' })];
    const walk = (g, depth) => {
        const btn = h('button', {
            class: 'group' + (state.selectedGroup === g ? ' active' : ''),
            onclick: () => { state.selectedGroup = g; renderGroups(); renderList(); }
        }, (v.isInRecycleBin(g) || g === v.recycleBin ? 'x ' : '') + groupLabel(g));
        btn.style.paddingLeft = `${0.75 + depth * 0.9}rem`; // per CSSOM, damit die CSP ohne 'unsafe-inline' auskommt
        items.push(btn);
        for (const c of g.groups) walk(c, depth + 1);
    };
    for (const g of v.root.groups) walk(g, 0);
    nav.replaceChildren(...items);
}

function visibleEntries() {
    const v = state.vault;
    const q = state.query.trim();
    let entries;
    if (state.selectedGroup && (v.isInRecycleBin(state.selectedGroup) || state.selectedGroup === v.recycleBin)) {
        entries = [...state.selectedGroup.allEntries()];
        if (q) { const set = new Set(v.search(q)); entries = entries.filter((e) => set.has(e)); }
    } else {
        entries = v.search(q);
        if (state.selectedGroup) { const inGroup = new Set(state.selectedGroup.allEntries()); entries = entries.filter((e) => inGroup.has(e)); }
    }
    return entries;
}

function renderList() {
    const list = $('#list');
    const entries = visibleEntries();
    if (!entries.length) {
        list.replaceChildren(h('p', { class: 'muted pad', text: state.query ? 'Keine Treffer.' : 'Keine Eintraege in dieser Gruppe.' }));
        return;
    }
    list.replaceChildren(...entries.map((e) => h('button', {
        class: 'entry' + (state.selectedEntry === e ? ' active' : ''), 'data-testid': 'entry-row',
        onclick: () => { state.selectedEntry = e; state.editing = null; renderList(); renderDetail(); }
    }, h('span', { class: 'title', text: fieldText(e.fields.get('Title')) || '(ohne Titel)' }),
        h('span', { class: 'sub', text: fieldText(e.fields.get('UserName')) }))));
}

// ---------------------------------------------------------------- Details
async function copy(text, label) {
    try {
        await navigator.clipboard.writeText(text);
        setStatus(`${label} kopiert - wird in ${CLIPBOARD_CLEAR_MS / 1000} s aus der Zwischenablage entfernt.`);
        setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, CLIPBOARD_CLEAR_MS);
    } catch {
        setStatus('Kopieren nicht moeglich (Browser-Berechtigung).', 'error');
    }
}

function fieldRow(label, valueNode, actions = []) {
    return h('div', { class: 'field' }, h('div', { class: 'flabel', text: label }), h('div', { class: 'fvalue' }, valueNode, ...actions));
}

function renderDetail() {
    clearInterval(state.totpTimer);
    const box = $('#detail');
    if (state.editing) return renderEditor(box);
    const e = state.selectedEntry;
    if (!e) { box.replaceChildren(h('p', { class: 'muted pad', text: 'Eintrag auswaehlen oder neu anlegen.' })); return; }
    const v = state.vault;
    const pwText = fieldText(e.fields.get('Password'));
    const pwSpan = h('span', { class: 'secret', 'data-testid': 'pw-value', text: '•'.repeat(Math.min(pwText.length, 16)) });
    let shown = false;
    const toggle = h('button', { class: 'small', 'data-testid': 'pw-toggle', text: 'Anzeigen', onclick: () => {
        shown = !shown;
        pwSpan.textContent = shown ? pwText : '•'.repeat(Math.min(pwText.length, 16));
        toggle.textContent = shown ? 'Verbergen' : 'Anzeigen';
    } });
    const rows = [
        fieldRow('Titel', h('span', { 'data-testid': 'f-title', text: fieldText(e.fields.get('Title')) })),
        fieldRow('Benutzer', h('span', { 'data-testid': 'f-user', text: fieldText(e.fields.get('UserName')) }), [h('button', { class: 'small', text: 'Kopieren', onclick: () => copy(fieldText(e.fields.get('UserName')), 'Benutzername') })]),
        fieldRow('Passwort', pwSpan, [toggle, h('button', { class: 'small', 'data-testid': 'pw-copy', text: 'Kopieren', onclick: () => copy(pwText, 'Passwort') })])
    ];
    const url = fieldText(e.fields.get('URL'));
    if (url) {
        const safe = /^https?:\/\//i.test(url);
        rows.push(fieldRow('URL', safe ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }) : h('span', { text: url })));
    }
    const notes = fieldText(e.fields.get('Notes'));
    if (notes) rows.push(fieldRow('Notizen', h('pre', { class: 'notes', text: notes })));
    if (e.tags?.length) rows.push(fieldRow('Tags', h('span', { 'data-testid': 'f-tags', text: e.tags.join(', ') })));

    // TOTP
    let otpCfg = null;
    try { otpCfg = parseOtpConfig(fieldText(e.fields.get('otp')), fieldText(e.fields.get('TOTP Seed')), fieldText(e.fields.get('TOTP Settings'))); } catch (err) { rows.push(fieldRow('TOTP', h('span', { class: 'error', text: err.message }))); }
    if (otpCfg) {
        const codeEl = h('span', { class: 'totp', 'data-testid': 'totp-code', text: '------' });
        const remEl = h('span', { class: 'muted', text: '' });
        const tick = async () => { const r = await totp(otpCfg); codeEl.textContent = r.code; remEl.textContent = ` (${r.remaining} s)`; };
        tick();
        state.totpTimer = setInterval(tick, 1000);
        rows.push(fieldRow('TOTP', h('span', {}, codeEl, remEl), [h('button', { class: 'small', text: 'Kopieren', onclick: async () => copy((await totp(otpCfg)).code, 'TOTP-Code') })]));
    }

    // Weitere Felder
    for (const [k, val] of e.fields) {
        if (STANDARD_FIELDS.includes(k) || ['otp', 'TOTP Seed', 'TOTP Settings'].includes(k)) continue;
        const text = fieldText(val);
        const span = h('span', { 'data-testid': 'custom-' + k, text: isProtected(val) ? '••••••' : text });
        const actions = isProtected(val) ? [h('button', { class: 'small', text: 'Anzeigen', onclick: (ev) => { const on = span.dataset.on !== '1'; span.dataset.on = on ? '1' : '0'; span.textContent = on ? text : '••••••'; ev.target.textContent = on ? 'Verbergen' : 'Anzeigen'; } })] : [];
        rows.push(fieldRow(k, span, [...actions, h('button', { class: 'small', text: 'Kopieren', onclick: () => copy(text, k) })]));
    }

    // Anhaenge
    if (e.binaries?.size) {
        const links = [];
        for (const [name, bin] of e.binaries) {
            let data = bin?.value ?? bin;
            if (data && typeof data.getBinary === 'function') data = data.getBinary();
            links.push(h('button', { class: 'small', 'data-testid': 'attachment', text: `${name} herunterladen`, onclick: () => download(name, data) }));
        }
        rows.push(fieldRow('Anhaenge', h('span', {}, ...links)));
    }
    const inBin = v.isInRecycleBin(e);
    box.replaceChildren(h('div', { class: 'card' }, ...rows,
        h('div', { class: 'row actions' },
            h('button', { id: 'edit-btn', onclick: () => startEdit(e), text: 'Bearbeiten' }),
            h('button', { id: 'del-btn', class: 'danger', onclick: () => { v.removeEntry(e); state.selectedEntry = null; renderGroups(); renderList(); renderDetail(); refreshDirtyIndicator(); setStatus(inBin ? 'Endgueltig geloescht (noch nicht gespeichert).' : 'In den Papierkorb verschoben (noch nicht gespeichert).'); }, text: inBin ? 'Endgueltig loeschen' : 'Loeschen' }))));
}

function download(name, data) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- Bearbeiten
function startEdit(entry) {
    const g = entry?.parentGroup || state.selectedGroup || state.vault.root.groups[0] || state.vault.root;
    state.editing = { entry, group: g };
    renderDetail();
}

function renderEditor(box) {
    const { entry, group } = state.editing;
    const val = (k) => (entry ? fieldText(entry.fields.get(k)) : '');
    const inputs = {
        Title: h('input', { id: 'e-title', value: val('Title'), 'data-testid': 'e-title' }),
        UserName: h('input', { id: 'e-user', value: val('UserName'), autocomplete: 'off' }),
        Password: h('input', { id: 'e-pass', type: 'password', value: val('Password'), autocomplete: 'new-password' }),
        URL: h('input', { id: 'e-url', value: val('URL') }),
        Notes: h('textarea', { id: 'e-notes', rows: 5 }),
        tags: h('input', { id: 'e-tags', value: (entry?.tags || []).join(', ') })
    };
    inputs.Notes.value = val('Notes');
    const showBox = h('input', { type: 'checkbox', id: 'e-show', onchange: (ev) => { inputs.Password.type = ev.target.checked ? 'text' : 'password'; } });
    const customBox = h('div', { id: 'e-custom' });
    const addCustom = (name = '', value = '', protect = false) => {
        const row = h('div', { class: 'row custom-row' },
            h('input', { placeholder: 'Feldname', value: name, class: 'c-name' }),
            h('input', { placeholder: 'Wert', value, class: 'c-value', type: protect ? 'password' : 'text' }),
            h('label', { class: 'inline' }, h('input', { type: 'checkbox', class: 'c-protect', checked: protect, onchange: (ev) => { row.querySelector('.c-value').type = ev.target.checked ? 'password' : 'text'; } }), ' geschuetzt'),
            h('button', { type: 'button', class: 'small', text: 'Entfernen', onclick: () => row.remove() }));
        customBox.append(row);
    };
    if (entry) for (const [k, v] of entry.fields) if (!STANDARD_FIELDS.includes(k)) addCustom(k, fieldText(v), isProtected(v));
    const form = h('form', { class: 'card', id: 'edit-form' },
        h('h2', { text: entry ? 'Eintrag bearbeiten' : `Neuer Eintrag in "${groupLabel(group)}"` }),
        h('label', {}, 'Titel', inputs.Title),
        h('label', {}, 'Benutzername', inputs.UserName),
        h('label', {}, 'Passwort', inputs.Password),
        h('div', { class: 'row' },
            h('label', { class: 'inline' }, showBox, ' anzeigen'),
            h('button', { type: 'button', id: 'gen-btn', class: 'small', text: 'Passwort erzeugen', onclick: () => { inputs.Password.value = generatePassword(24); } })),
        h('label', {}, 'URL', inputs.URL),
        h('label', {}, 'Notizen', inputs.Notes),
        h('label', {}, 'Tags (Komma-getrennt)', inputs.tags),
        h('div', { class: 'flabel', text: 'Weitere Felder' }), customBox,
        h('button', { type: 'button', class: 'small', id: 'add-custom', text: 'Feld hinzufuegen', onclick: () => addCustom() }),
        h('div', { class: 'row actions' },
            h('button', { type: 'submit', class: 'primary', id: 'apply-btn', text: 'Uebernehmen' }),
            h('button', { type: 'button', id: 'cancel-btn', text: 'Abbrechen', onclick: () => { state.editing = null; renderDetail(); } })));
    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const custom = [...customBox.querySelectorAll('.custom-row')].map((r) => ({
            name: r.querySelector('.c-name').value, value: r.querySelector('.c-value').value, protect: r.querySelector('.c-protect').checked
        }));
        const saved = state.vault.applyEntry(entry, group, {
            Title: inputs.Title.value, UserName: inputs.UserName.value, Password: inputs.Password.value,
            URL: inputs.URL.value, Notes: inputs.Notes.value,
            tags: inputs.tags.value.split(',').map((t) => t.trim()).filter(Boolean), custom
        });
        state.selectedEntry = saved;
        state.editing = null;
        renderGroups(); renderList(); renderDetail(); refreshDirtyIndicator();
        setStatus('Uebernommen - zum Sichern "Speichern" klicken.');
    });
    box.replaceChildren(form);
    inputs.Title.focus();
}

// ---------------------------------------------------------------- Speichern / Sperren
async function doSave() {
    const v = state.vault;
    if (!v) return;
    const btn = $('#save-btn');
    btn.disabled = true;
    setStatus('Speichere ...');
    try {
        const res = await v.save();
        if (state.source.type === 'file') {
            download(state.source.name, res.bytes);
            setStatus(`Als Download gespeichert: ${state.source.name}. Bitte die alte Datei damit ersetzen.`);
        } else if (res.merged) {
            renderGroups(); renderList(); renderDetail();
            setStatus('Gespeichert. Aenderungen eines anderen Geraets wurden zusammengefuehrt; beide Staende liegen als .bak-Kopie auf dem Server.', 'warn');
        } else {
            setStatus('Gespeichert.');
        }
    } catch (e) {
        console.error(e);
        setStatus(`Speichern fehlgeschlagen: ${e.message || e}`, 'error');
    } finally {
        refreshDirtyIndicator();
    }
}

async function lock(message) {
    const auto = message === 'Automatisch gesperrt.';
    if (state.vault?.dirty) {
        if (auto) {
            // Unbeaufsichtigt: bei WebDAV zuerst automatisch speichern, damit nichts verloren geht; sonst offen lassen und warnen.
            if (state.source.type === 'dav') await doSave();
            if (state.vault?.dirty) { setStatus('Ungespeicherte Aenderungen - bitte speichern, danach sperrt die Sitzung.', 'warn'); return; }
        } else if (!confirm('Ungespeicherte Aenderungen gehen verloren. Trotzdem sperren?')) {
            return;
        }
    }
    renderLogin(message);
}

function startTimers() {
    stopTimers();
    state.idleTimer = setInterval(() => {
        if (state.vault && Date.now() - state.lastActivity > AUTOLOCK_SECONDS * 1000) lock('Automatisch gesperrt.');
    }, 1000);
}
function stopTimers() { clearInterval(state.idleTimer); clearInterval(state.totpTimer); }
for (const ev of ['mousemove', 'keydown', 'click', 'touchstart']) addEventListener(ev, () => { state.lastActivity = Date.now(); }, { passive: true });
addEventListener('beforeunload', (e) => { if (state.vault?.dirty) { e.preventDefault(); e.returnValue = ''; } });

renderLogin();
