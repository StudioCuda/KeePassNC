// Datenbank-Einstellungen. "Allgemein": Name, Beschreibung, Standard-Benutzername, Papierkorb, Verlaufsgrenzen (Metadaten).
// "Sicherheit": Format, Verschluesselung, Schluesselableitung (Dateikopf). Nur browser-taugliche Werte, mit Ampel fuer den Speicher,
// Rueckfrage vor allem, was schwaecher macht, und einem Probelauf auf diesem Geraet, bevor etwas uebernommen wird.
import { t } from '../i18n.js';
import { ctx, setStatus } from './ctx.js';
import { h, modal, confirmDialog } from './dom.js';
import { changed } from './session.js';
import { argon2 } from '../argon2.js';
import { isOutOfMemory } from '../core/util.js';
import { CIPHER_LABEL } from '../vault.js';
import { MEMORY_PRESETS_MIB, PARALLELISM_OPTIONS, MAX_ITERATIONS, SLOW_MS, memoryLevel, isWeaker, suggestIterations } from '../core/kdf-policy.js';

const MiB = 1024 * 1024;

/** Eine Argon2-Ableitung mit Zufallswerten und diesen Parametern, wie beim Entsperren (im Worker); liefert die Dauer in ms. */
async function trialRun(s, iterations = s.iterations) {
    const rnd = () => crypto.getRandomValues(new Uint8Array(32));
    const t0 = performance.now();
    await argon2({ type: s.kdf === 'argon2id' ? 'id' : 'd', password: rnd(), salt: rnd(), parallelism: s.parallelism, iterations, memoryKiB: s.memoryKiB, hashLength: 32 });
    return performance.now() - t0;
}
const secs = (ms) => (Math.round(ms / 100) / 10).toLocaleString(document.documentElement.lang || undefined);

export function openDbSettings({ onApplied } = {}) {
    const v = ctx.state.vault;
    const cur = v.generalSettings();
    const sec = v.securitySettings();
    const select = (id, values, value, labelOf) => h('select', { id }, ...values.map((x) => h('option', { value: String(x), selected: String(x) === String(value), text: labelOf(x) })));
    const withCurrent = (list, value) => (value === null || list.includes(value) ? list : [...list, value].sort((a, b) => a - b));
    const isArgon = sec.kdf !== 'aes';
    const i = {
        name: h('input', { id: 'db-name', value: cur.name, autocomplete: 'off' }),
        desc: h('textarea', { id: 'db-desc', rows: 3 }),
        user: h('input', { id: 'db-user', value: cur.defaultUser, autocomplete: 'off', spellcheck: 'false' }),
        bin: h('input', { id: 'db-bin', type: 'checkbox', checked: cur.recycleBin }),
        itemsOn: h('input', { id: 'db-hist-items-on', type: 'checkbox', checked: cur.historyMaxItems >= 0 }),
        items: h('input', { id: 'db-hist-items', type: 'number', class: 'num', min: 0, max: 999, step: 1, value: cur.historyMaxItems >= 0 ? cur.historyMaxItems : 10, 'aria-label': t('dbset.hist.items.post') }),
        sizeOn: h('input', { id: 'db-hist-size-on', type: 'checkbox', checked: cur.historyMaxSize >= 0 }),
        size: h('input', { id: 'db-hist-size', type: 'number', class: 'num', min: 1, max: 1024, step: 1, value: cur.historyMaxSize >= 0 ? Math.max(1, Math.round(cur.historyMaxSize / MiB)) : 6, 'aria-label': t('dbset.hist.size.post') }),
        // Sicherheit
        upgrade: sec.version < 4 ? h('input', { id: 'db-upgrade', type: 'checkbox' }) : null,
        cipher: select('db-cipher', Object.keys(CIPHER_LABEL), sec.cipher ?? 'aes', (c) => CIPHER_LABEL[c]),
        // AES-KDF nur, wenn die Datei sie schon nutzt: neu waehlen soll sie niemand mehr
        kdf: select('db-kdf', isArgon ? ['argon2id', 'argon2d'] : ['argon2id', 'argon2d', 'aes'], sec.kdf, (k) => t('dbsec.kdf.' + k)),
        memory: select('db-memory', withCurrent(MEMORY_PRESETS_MIB, isArgon ? sec.memoryKiB / 1024 : null), isArgon ? sec.memoryKiB / 1024 : 64,
            (mb) => (mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GiB` : `${mb} MiB`) + (isArgon && mb === sec.memoryKiB / 1024 ? ' ' + t('dbsec.current') : '')),
        iterations: h('input', { id: 'db-iterations', type: 'number', class: 'num', min: 1, max: MAX_ITERATIONS, step: 1, value: isArgon ? sec.iterations : 10 }),
        parallelism: select('db-parallelism', withCurrent(PARALLELISM_OPTIONS, isArgon ? sec.parallelism : null), isArgon ? sec.parallelism : 2, String),
        rounds: h('input', { id: 'db-rounds', type: 'number', min: 1, step: 1, value: sec.rounds ?? '' }),
        bench: h('button', { type: 'button', class: 'small', id: 'db-bench', text: t('dbsec.bench') })
    };
    i.desc.value = cur.desc;
    const level = h('p', { class: 'level-note', id: 'db-level', 'aria-live': 'polite' });
    const benchNote = h('small', { class: 'hint', id: 'db-bench-note', 'aria-live': 'polite' });
    const error = h('p', { class: 'error', id: 'db-error', role: 'alert' });
    const argonRows = h('div', { class: 'stack tight' },
        h('div', { class: 'grid2' },
            h('label', {}, h('span', { text: t('dbsec.memory') }), i.memory),
            h('label', {}, h('span', { text: t('dbsec.parallelism') }), i.parallelism)),
        h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('dbsec.iterations') }),
            h('div', { class: 'input-group' }, i.iterations, i.bench)), benchNote, level);
    const aesRows = h('label', {}, h('span', { text: t('dbsec.rounds') }), i.rounds);

    const clamp = (el, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(el.value)) || 0));
    const secNext = () => {
        const kdf = i.kdf.value;
        return kdf === 'aes' ? { kdf, cipher: i.cipher.value, rounds: clamp(i.rounds, 1, Number.MAX_SAFE_INTEGER) }
            : { kdf, cipher: i.cipher.value, memoryKiB: Number(i.memory.value) * 1024, iterations: clamp(i.iterations, 1, MAX_ITERATIONS), parallelism: Number(i.parallelism.value) };
    };
    const secChanged = (n) => n.kdf !== sec.kdf || n.cipher !== (sec.cipher ?? 'aes') || !!i.upgrade?.checked
        || (n.kdf === 'aes' ? n.rounds !== sec.rounds : n.memoryKiB !== sec.memoryKiB || n.iterations !== sec.iterations || n.parallelism !== sec.parallelism);
    const sync = () => {
        i.items.disabled = !i.itemsOn.checked; i.size.disabled = !i.sizeOn.checked;
        const argon = i.kdf.value !== 'aes';
        argonRows.hidden = !argon; aesRows.hidden = argon;
        if (i.upgrade) { // Argon2 und ChaCha20 gibt es nur in KDBX 4
            const needs4 = argon || i.cipher.value === 'chacha20';
            if (needs4) i.upgrade.checked = true;
            i.upgrade.disabled = needs4;
        }
        const lv = memoryLevel(Number(i.memory.value));
        level.className = 'level-note ' + lv;
        level.textContent = t('dbsec.level.' + lv);
    };
    for (const el of [i.itemsOn, i.sizeOn, i.kdf, i.cipher, i.memory]) el.addEventListener('change', sync);
    sync();

    i.bench.addEventListener('click', async () => {
        const n = secNext();
        error.textContent = ''; i.bench.disabled = true; benchNote.textContent = t('dbsec.bench.running');
        try {
            const ms = await trialRun(n, 1);
            const it = suggestIterations(ms, sec, n.memoryKiB);
            i.iterations.value = it;
            benchNote.textContent = t('dbsec.bench.done', { s: secs(ms * it) });
        } catch (e) {
            benchNote.textContent = '';
            error.textContent = isOutOfMemory(e) ? t('dbsec.oom', { mb: n.memoryKiB / 1024 }) : String(e.message || e);
        } finally { i.bench.disabled = false; }
    });

    async function apply(e) {
        e.preventDefault();
        error.textContent = '';
        const next = {
            name: i.name.value.trim(), desc: i.desc.value, defaultUser: i.user.value.trim(), recycleBin: i.bin.checked,
            historyMaxItems: i.itemsOn.checked ? clamp(i.items, 0, 999) : -1,
            historyMaxSize: i.sizeOn.checked ? clamp(i.size, 1, 1024) * MiB : -1
        };
        const sn = secNext(), changeSec = secChanged(sn);
        const ask = (title, message, danger = false, ok = t('apply')) => confirmDialog({ title, message, confirmLabel: ok, cancelLabel: t('cancel'), danger });
        if (changeSec) {
            if (isWeaker(sn, sec) && !(await ask(t('dbsec.weaker.title'), t('dbsec.weaker.msg'), true, t('dbsec.weaker.ok')))) return;
            if (sn.kdf !== 'aes' && memoryLevel(sn.memoryKiB / 1024) === 'bad' && sn.memoryKiB !== sec.memoryKiB && !(await ask(t('dbsec.big.title'), t('dbsec.big.msg', { mb: sn.memoryKiB / 1024 }), true))) return;
            if (sn.kdf !== 'aes') { // Probelauf: klappt die Ableitung hier ueberhaupt, und wie lange dauert sie?
                const btn = body.querySelector('#db-apply');
                btn.disabled = true; benchNote.textContent = t('dbsec.testing');
                let ms;
                try { ms = await trialRun(sn); } catch (err) {
                    benchNote.textContent = '';
                    error.textContent = isOutOfMemory(err) ? t('dbsec.oom', { mb: sn.memoryKiB / 1024 }) : String(err.message || err);
                    return;
                } finally { btn.disabled = false; }
                benchNote.textContent = t('dbsec.bench.done', { s: secs(ms) });
                if (ms > SLOW_MS && !(await ask(t('dbsec.slow.title'), t('dbsec.slow.msg', { s: secs(ms) })))) return;
            }
        }
        const n = v.historyTrimCount(next);
        if (n && !(await confirmDialog({ title: t('dbset.trim.title'), message: t('dbset.trim.msg', { n }), confirmLabel: t('dbset.trim.ok'), cancelLabel: t('cancel'), danger: true }))) return;
        v.updateGeneralSettings(next);
        if (changeSec) v.updateSecuritySettings({ ...sn, upgrade: !!i.upgrade?.checked });
        if (!v.binEnabled && ctx.state.filter.type === 'bin') ctx.state.filter = { type: 'all' };
        m.close();
        changed();
        setStatus(ctx.settings.autosync === 'change' && ctx.state.source.type === 'dav' ? t('applied.auto') : t('applied'));
        onApplied?.();
    }

    const section = (title, ...rows) => h('section', { class: 'card stack' }, h('h3', { text: title }), ...rows);
    const body = h('form', { class: 'stack', id: 'db-settings', onsubmit: apply },
        section(t('dbset.general'),
            h('label', {}, h('span', { text: t('dbset.name') }), i.name),
            h('label', {}, h('span', { text: t('dbset.desc') }), i.desc),
            h('label', {}, h('span', { text: t('dbset.user') }), i.user, h('small', { class: 'hint', text: t('dbset.user.hint') })),
            h('label', { class: 'check' }, i.bin, h('span', {}, t('dbset.bin'), h('small', { class: 'muted', text: ' ' + t('dbset.bin.hint') }))),
            h('div', { class: 'stack tight' }, h('span', { class: 'group-title', text: t('dbset.hist') }),
                h('label', { class: 'check' }, i.itemsOn, h('span', { text: t('dbset.hist.items.pre') }), i.items, h('span', { text: t('dbset.hist.items.post') })),
                h('label', { class: 'check' }, i.sizeOn, h('span', { text: t('dbset.hist.size.pre') }), i.size, h('span', { text: t('dbset.hist.size.post') })),
                h('small', { class: 'hint', text: t('dbset.hist.hint') }))),
        section(t('dbsec.title'),
            i.upgrade ? h('label', { class: 'check' }, i.upgrade, h('span', {}, t('dbsec.upgrade'), h('small', { class: 'muted', text: ' ' + t('dbsec.upgrade.hint') }))) : null,
            h('div', { class: 'grid2' },
                h('label', {}, h('span', { text: t('dbsec.cipher') }), i.cipher),
                h('label', {}, h('span', { text: t('dbsec.kdf') }), i.kdf)),
            argonRows, aesRows,
            h('small', { class: 'hint', text: t('dbsec.note') })),
        error,
        h('div', { class: 'modal-actions inline' }, h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), h('button', { type: 'submit', class: 'primary', id: 'db-apply', text: t('apply') })));
    const m = modal({ title: t('dbset.title'), body, size: 'md' });
    return m;
}
