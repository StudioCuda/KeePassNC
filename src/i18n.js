// Multilingual (de/en/zh-CN). t(key, {name: value}) replaces {name}. Missing keys fall back to English, then German.
// A unit test makes sure all dictionaries have the same keys and that all keys used in the code exist.
import de from './i18n-de.js';
import en from './i18n-en.js';
import zhCN from './i18n-zh-CN.js';

const DICTS = { de, en, 'zh-CN': zhCN };
export const LANGS = ['de', 'en', 'zh-CN'];
let lang = 'de';

export function detectLang(pref, htmlLang = '', navLang = '') {
    if (pref && DICTS[pref]) return pref;
    const l = String(htmlLang || navLang || '').toLowerCase();
    // Nextcloud says "zh" (or zh_CN), browsers say "zh-CN" - both mean Chinese.
    if (l.startsWith('zh')) return 'zh-CN';
    return l.startsWith('de') ? 'de' : l ? 'en' : 'de';
}
export function setLang(l) { lang = DICTS[l] ? l : 'de'; if (typeof document !== 'undefined') document.documentElement.lang = lang; }
export const getLang = () => lang;
export const locale = () => (lang === 'de' ? 'de-AT' : lang === 'zh-CN' ? 'zh-CN' : 'en-GB');

export function t(key, vars) {
    let s = DICTS[lang][key] ?? DICTS.en[key] ?? de[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
}
/** Error text in the UI language (errors carry key/vars; otherwise their message). */
export const errText = (e) => (e && e.key ? t(e.key, e.vars) : (e && e.message) || String(e));
export const fmtDate = (d, withTime = false) => (d ? new Date(d).toLocaleString(locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '');
