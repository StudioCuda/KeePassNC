// Settings (convenience values only, no secrets) in localStorage. URL parameters override them for tests/shortcuts.
// Labels of the select lists live in the translations (autosync.<value>, autolock.<value>, clip.<value>).
export const AUTOSYNC_OPTIONS = ['change', '1', '2', '5', '10', 'off'];
export const AUTOLOCK_OPTIONS = [1, 2, 10, 20, 60, 120, 480, 720];
export const CLIPBOARD_OPTIONS = [10, 20, 30, 60, 120];
export const THEME_OPTIONS = ['nextcloud', 'auto', 'light', 'dark']; // 'nextcloud' only in Nextcloud; standalone it behaves like 'auto'
export const BACKUPKEEP_OPTIONS = [3, 10, 30, 0];
export const LANG_OPTIONS = ['auto', 'de', 'en', 'zh-CN'];

export const DEFAULTS = {
    autosync: 'change', // 'change' | '1' | '2' | '5' | '10' | 'off'
    autolock: 10, // minutes
    clipboard: 20, // seconds
    lockOnHide: false, // lock when the tab has been in the background for more than 60 s
    offline: false, // keep an encrypted copy + app page in this browser
    backupKeep: 10, // backups on the server (0 = keep all)
    theme: 'nextcloud', // like the light/dark choice in Nextcloud
    themeV: 2, // 2 = 'nextcloud' exists (old, automatically saved 'auto' values are migrated once)
    ncAccent: true, // take over the instance's accent colour (Nextcloud only)
    lang: 'auto',
    sort: 'title',
    compact: false, // denser entry list
    showPasswordsInList: false
};

const KEY = 'kpnc.settings';
const oneOf = (list, v, d) => (list.some((k) => String(k) === String(v)) ? v : d);

export function loadSettings(search = location.search) {
    let s = { ...DEFAULTS };
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        // Up to 0.7 'auto' was the default and got saved with all values: switch once to 'like Nextcloud'.
        // For everyone with "System" in Nextcloud (the default), that looks exactly the same as before.
        if (saved && saved.themeV !== 2 && saved.theme === 'auto') saved.theme = 'nextcloud';
        Object.assign(s, saved, { themeV: 2 });
    } catch { /* broken entry: defaults */ }
    s.autosync = String(oneOf(AUTOSYNC_OPTIONS, s.autosync, DEFAULTS.autosync));
    // 5, 15 and 30 minutes were options up to 1.0.2: a saved value that is gone moves to the next shorter one, never to a longer one
    const al = Number(s.autolock);
    s.autolock = AUTOLOCK_OPTIONS.includes(al) ? al : (AUTOLOCK_OPTIONS.filter((k) => k < al).pop() ?? DEFAULTS.autolock);
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
    const { autolockSeconds, ...persist } = s; // derived value is not saved
    try { localStorage.setItem(KEY, JSON.stringify(persist)); } catch { /* storage not available */ }
}
