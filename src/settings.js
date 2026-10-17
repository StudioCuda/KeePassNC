// Einstellungen (nur Komfortwerte, keine Geheimnisse) in localStorage. URL-Parameter ueberschreiben fuer Tests/Verknuepfungen.
// Beschriftungen der Auswahllisten stehen in der Uebersetzung (autosync.<wert>, autolock.<wert>, clip.<wert>).
export const AUTOSYNC_OPTIONS = ['change', '1', '2', '5', '10', 'off'];
export const AUTOLOCK_OPTIONS = [1, 2, 5, 15, 30, 60];
export const CLIPBOARD_OPTIONS = [10, 20, 30, 60, 120];
export const THEME_OPTIONS = ['nextcloud', 'auto', 'light', 'dark']; // 'nextcloud' nur in Nextcloud; eigenstaendig wirkt es wie 'auto'
export const BACKUPKEEP_OPTIONS = [3, 10, 30, 0];
export const LANG_OPTIONS = ['auto', 'de', 'en'];

export const DEFAULTS = {
    autosync: 'change', // 'change' | '1' | '2' | '5' | '10' | 'off'
    autolock: 5, // Minuten
    clipboard: 20, // Sekunden
    lockOnHide: false, // Sperren, wenn der Tab laenger als 60 s im Hintergrund ist
    offline: false, // verschluesselte Kopie + App-Seite in diesem Browser vorhalten
    backupKeep: 10, // Sicherungskopien auf dem Server (0 = alle behalten)
    theme: 'nextcloud', // wie die Hell/Dunkel-Wahl in Nextcloud
    themeV: 2, // 2 = 'nextcloud' gibt es (alte, automatisch gespeicherte 'auto' werden einmalig umgestellt)
    ncAccent: true, // Akzentfarbe der Instanz uebernehmen (nur in Nextcloud)
    lang: 'auto',
    sort: 'title',
    compact: false, // dichtere Eintragsliste
    showPasswordsInList: false
};

const KEY = 'kpnc.settings';
const oneOf = (list, v, d) => (list.some((k) => String(k) === String(v)) ? v : d);

export function loadSettings(search = location.search) {
    let s = { ...DEFAULTS };
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        // Bis 0.7 war 'auto' der Standard und wurde mit allen Werten gespeichert: einmalig auf 'wie Nextcloud' umstellen.
        // Fuer alle, die in Nextcloud "System" haben (Standard), sieht das genauso aus wie vorher.
        if (saved && saved.themeV !== 2 && saved.theme === 'auto') saved.theme = 'nextcloud';
        Object.assign(s, saved, { themeV: 2 });
    } catch { /* defekter Eintrag: Standardwerte */ }
    s.autosync = String(oneOf(AUTOSYNC_OPTIONS, s.autosync, DEFAULTS.autosync));
    s.autolock = Number(oneOf(AUTOLOCK_OPTIONS, s.autolock, DEFAULTS.autolock));
    s.clipboard = Number(oneOf(CLIPBOARD_OPTIONS, s.clipboard, DEFAULTS.clipboard));
    s.backupKeep = Number(oneOf(BACKUPKEEP_OPTIONS, s.backupKeep, DEFAULTS.backupKeep));
    s.theme = oneOf(THEME_OPTIONS, s.theme, DEFAULTS.theme);
    s.lang = oneOf(LANG_OPTIONS, s.lang, 'auto');
    s.sort = ['title', 'modified', 'created', 'username', 'group'].includes(s.sort) ? s.sort : 'title';
    s.lockOnHide = !!s.lockOnHide;
    s.offline = !!s.offline;
    s.compact = !!s.compact;
    s.ncAccent = s.ncAccent !== false;
    const p = new URLSearchParams(search);
    if (p.has('autosave')) s.autosync = String(oneOf(AUTOSYNC_OPTIONS, p.get('autosave'), s.autosync));
    if (p.has('lang')) s.lang = oneOf(LANG_OPTIONS, p.get('lang'), s.lang);
    s.autolockSeconds = p.has('autolock') ? Math.max(5, parseInt(p.get('autolock'), 10) || s.autolock * 60) : s.autolock * 60;
    return s;
}

export function saveSettings(s) {
    const { autolockSeconds, ...persist } = s; // abgeleiteter Wert wird nicht gespeichert
    try { localStorage.setItem(KEY, JSON.stringify(persist)); } catch { /* Speicher nicht verfuegbar */ }
}
