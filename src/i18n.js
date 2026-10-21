// Multilingual (de/en). t(key, {name: value}) replaces {name}. Missing English keys fall back to German.
// A unit test makes sure both dictionaries have the same keys and that all keys used in the code exist.
import de from './i18n-de.js';
import en from './i18n-en.js';

const DICTS = { de, en };
let lang = 'de';

export function detectLang(pref, htmlLang = '', navLang = '') {
    if (pref === 'de' || pref === 'en') return pref;
    const l = String(htmlLang || navLang || '').toLowerCase();
    return l.startsWith('de') ? 'de' : l ? 'en' : 'de';
}
export function setLang(l) { lang = DICTS[l] ? l : 'de'; if (typeof document !== 'undefined') document.documentElement.lang = lang; }
export const getLang = () => lang;
export const locale = () => (lang === 'de' ? 'de-AT' : 'en-GB');

export function t(key, vars) {
    let s = DICTS[lang][key] ?? de[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
}
/** Error text in the UI language (errors carry key/vars; otherwise their message). */
export const errText = (e) => (e && e.key ? t(e.key, e.vars) : (e && e.message) || String(e));
export const fmtDate = (d, withTime = false) => (d ? new Date(d).toLocaleString(locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : '');
