// Bausteine fuer neue Zugangsdaten, gemeinsam fuer "Master-Passwort aendern" und "Neue Datenbank": neues Passwort mit Wiederholung,
// Staerkeanzeige und Generator; neue Schluesseldatei, die erst gilt, wenn sie heruntergeladen UND zur Kontrolle wieder ausgewaehlt wurde.
import { t } from '../i18n.js';
import { download } from './ctx.js';
import { h, icon, iconBtn } from './dom.js';
import { strengthBar } from './detail.js';
import { openGenerator } from './generator-dialog.js';
import { createKeyfile, sameKeyfile } from '../vault.js';

export const readFile = async (input) => (input.files[0] ? new Uint8Array(await input.files[0].arrayBuffer()) : null);

/** Felder #<p>-new und #<p>-repeat mit Anzeigen-Knopf (#<p>-show), Generator (#<p>-gen) und Staerkeanzeige. */
export function newPasswordFields(p) {
    const pw = (id) => h('input', { id, type: 'password', autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'off' });
    const next = pw(`${p}-new`), repeat = pw(`${p}-repeat`);
    const meter = h('div', { class: 'meter' }, strengthBar(''));
    let generated = null;
    const updateMeter = () => meter.replaceChildren(strengthBar(next.value, generated?.pw === next.value ? generated.bits : undefined));
    next.addEventListener('input', updateMeter);
    const showBtn = iconBtn('eye', t('show'), () => {
        const on = next.type === 'password';
        next.type = repeat.type = on ? 'text' : 'password';
        showBtn.replaceChildren(icon(on ? 'eyeOff' : 'eye'));
    }, { id: `${p}-show`, type: 'button' });
    const genBtn = h('button', { type: 'button', id: `${p}-gen`, class: 'btn', onclick: () => openGenerator({ onUse: (x, bits) => { generated = { pw: x, bits }; next.value = repeat.value = x; updateMeter(); } }) }, icon('dice'), h('span', { text: t('generator') }));
    return { next, repeat, meter, row: h('div', { class: 'input-group' }, next, showBtn, genBtn) };
}

/**
 * Neue Schluesseldatei (.keyx): Knopf #<p>-kf-download, danach Kontrolle ueber #<p>-kf-verify (Ergebnis in #<p>-kf-check).
 * fileName(): Name der Datei beim Herunterladen. keyfile(): die Bytes, sobald kontrolliert, sonst 'download' bzw. 'verify' (was fehlt).
 */
export function newKeyfileFlow(p, fileName) {
    let fresh = null, verified = false, name = '';
    const verifyInput = h('input', { id: `${p}-kf-verify`, type: 'file' });
    const verifyName = h('span', { class: 'muted', text: t('login.keyfile.none') });
    const verifyNote = h('p', { class: 'level-note', id: `${p}-kf-check`, 'aria-live': 'polite', hidden: true });
    const verifyBox = h('div', { class: 'stack tight', hidden: true },
        h('span', { class: 'group-title', text: t('cred.kf.verify') }),
        h('div', { class: 'filepick' }, h('span', { class: 'btn' }, icon('key'), t('login.keyfile.choose')), verifyName, verifyInput), verifyNote);
    const label = h('span', { text: t('cred.kf.download', { name: fileName() }) });
    const downloadBtn = h('button', { type: 'button', class: 'small', id: `${p}-kf-download` }, icon('download'), label);
    downloadBtn.addEventListener('click', async () => {
        fresh ||= await createKeyfile();
        name = fileName();
        download(name, fresh);
        verifyBox.hidden = false;
    });
    verifyInput.addEventListener('change', async () => {
        verifyName.textContent = verifyInput.files[0]?.name || t('login.keyfile.none');
        const bytes = await readFile(verifyInput);
        verified = !!(bytes && fresh) && await sameKeyfile(bytes, fresh).catch(() => false);
        bytes?.fill(0);
        verifyNote.hidden = !bytes;
        verifyNote.className = 'level-note ' + (verified ? 'ok' : 'bad');
        verifyNote.textContent = t(verified ? 'cred.kf.verify.ok' : 'cred.kf.verify.bad');
    });
    return {
        box: h('div', { class: 'stack tight cred-sub', hidden: true }, h('small', { class: 'hint', text: t('cred.kf.new.hint') }), h('div', {}, downloadBtn), verifyBox),
        /** Beschriftung des Knopfs nachziehen, solange noch nichts heruntergeladen ist (der Dateiname aendert sich). */
        relabel() { if (!fresh) label.textContent = t('cred.kf.download', { name: fileName() }); },
        keyfile: () => (!fresh ? 'download' : !verified ? 'verify' : fresh.slice()),
        get name() { return name; },
        wipe() { fresh?.fill(0); }
    };
}
