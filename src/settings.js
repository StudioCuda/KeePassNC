// Einstellungen (nur Komfortwerte, keine Geheimnisse) in localStorage. URL-Parameter ueberschreiben fuer Tests/Verknuepfungen.
export const AUTOSYNC_OPTIONS = [['change', 'Bei jeder Aenderung'], ['1', 'Alle 1 Minute'], ['2', 'Alle 2 Minuten'], ['5', 'Alle 5 Minuten'], ['10', 'Alle 10 Minuten'], ['off', 'Nur manuell']];
export const AUTOLOCK_OPTIONS = [[1, '1 Minute'], [2, '2 Minuten'], [5, '5 Minuten'], [15, '15 Minuten'], [30, '30 Minuten'], [60, '60 Minuten']];
export const CLIPBOARD_OPTIONS = [[10, '10 Sekunden'], [20, '20 Sekunden'], [30, '30 Sekunden'], [60, '60 Sekunden'], [120, '2 Minuten']];

export const DEFAULTS = {
    autosync: 'change', // 'change' | '1' | '2' | '5' | '10' | 'off'
    autolock: 5, // Minuten
    clipboard: 20, // Sekunden
    lockOnHide: false, // Sperren, wenn der Tab laenger als 60 s im Hintergrund ist
    offline: false // verschluesselte Kopie + App-Seite in diesem Browser vorhalten
};

const KEY = 'kpnc.settings';
const oneOf = (list, v, d) => (list.some(([k]) => String(k) === String(v)) ? v : d);

export function loadSettings(search = location.search) {
    let s = { ...DEFAULTS };
    try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* defekter Eintrag: Standardwerte */ }
    s.autosync = String(oneOf(AUTOSYNC_OPTIONS, s.autosync, DEFAULTS.autosync));
    s.autolock = Number(oneOf(AUTOLOCK_OPTIONS, s.autolock, DEFAULTS.autolock));
    s.clipboard = Number(oneOf(CLIPBOARD_OPTIONS, s.clipboard, DEFAULTS.clipboard));
    s.lockOnHide = !!s.lockOnHide;
    s.offline = !!s.offline;
    const p = new URLSearchParams(search);
    if (p.has('autosave')) s.autosync = String(oneOf(AUTOSYNC_OPTIONS, p.get('autosave'), s.autosync));
    s.autolockSeconds = p.has('autolock') ? Math.max(5, parseInt(p.get('autolock'), 10) || s.autolock * 60) : s.autolock * 60;
    return s;
}

export function saveSettings(s) {
    const { autolockSeconds, ...persist } = s; // abgeleiteter Wert wird nicht gespeichert
    try { localStorage.setItem(KEY, JSON.stringify(persist)); } catch { /* Speicher nicht verfuegbar */ }
}
