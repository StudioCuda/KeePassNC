// Nextcloud theming without dependencies and without DOM (unit-testable): validate a colour, compute contrasts per WCAG 2.x,
// derive the accent tones for light/dark from the instance colour and translate the user's light/dark choice.
// The surface colours must match the variables at the top of keepassnc.css (checked by tests/unit/theme.test.mjs).

/** Nextcloud's default primary colour (BackgroundService::DEFAULT_COLOR): counts as "no custom instance colour". */
export const NC_DEFAULT_COLOR = '#00679e';

export const SURFACES = {
    light: { bg: '#f4f1ec', surface: '#fffdfa', surface2: '#f9f6f2', surface3: '#ede8e2' },
    dark: { bg: '#0b1422', surface: '#111c2d', surface2: '#152134', surface3: '#1b293e' }
};

/** '#abc' / '#AABBCC' -> '#aabbcc'; anything else -> null. */
export function parseHex(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Mixes a with b; t = share of b (0..1). */
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };

export function luminance(h) {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Black or white, whichever has more contrast on c (at least ~4.58:1). */
export const textOn = (c) => (contrast(c, '#ffffff') >= contrast(c, '#000000') ? '#ffffff' : '#000000');
/** Text colour of the Nextcloud header, chosen the way Nextcloud does (Util::invertTextColor: white only from 4.5:1). */
export const headerText = (c) => (contrast(c, '#ffffff') < 4.5 ? '#000000' : '#ffffff');

/**
 * Accent tones for one mode: the colour is nudged step by step towards black (light) or white (dark) until it reaches
 * at least `min` as text on all surfaces and on --accent-soft (4.5:1, 7:1 with high contrast).
 * @returns {{accent: string, soft: string, on: string}|null} null for an invalid colour
 */
export function deriveAccent(color, mode, { min = 4.5 } = {}) {
    const p = parseHex(color);
    if (!p) return null;
    const s = SURFACES[mode === 'dark' ? 'dark' : 'light'];
    const target = mode === 'dark' ? '#ffffff' : '#000000';
    for (let i = 0; i <= 100; i++) {
        const accent = mix(p, target, i / 100);
        const soft = mix(s.surface, accent, mode === 'dark' ? 0.2 : 0.12);
        if ([s.bg, s.surface, s.surface2, s.surface3, soft].every((f) => contrast(accent, f) >= min)) return { accent, soft, on: textOn(accent) };
    }
    return null;
}

/** Background of the login page (white text, partly slightly transparent): dark enough for 7:1. */
export function deriveHero(color) {
    const p = parseHex(color);
    if (!p) return null;
    for (let i = 0; i <= 100; i++) {
        const hero = mix(p, '#000000', i / 100);
        if (contrast(hero, '#ffffff') >= 7) return { hero, hero2: mix(hero, '#ffffff', 0.12) };
    }
    return null;
}

/**
 * Translates Nextcloud's theme list (user value theming/enabled-themes, a forced theme first) into our terms.
 * 'default' is "system" in Nextcloud, i.e. our 'auto'. Extra themes (font, motion) are skipped.
 * @returns {{theme: 'auto'|'light'|'dark', contrast: boolean}}
 */
export function ncThemeFrom(list) {
    const ids = Array.isArray(list) ? list : String(list || '').split(',');
    for (const raw of ids) {
        const id = String(raw).trim();
        if (id === 'default') return { theme: 'auto', contrast: false };
        if (id === 'light' || id === 'dark') return { theme: id, contrast: false };
        if (id === 'light-highcontrast') return { theme: 'light', contrast: true };
        if (id === 'dark-highcontrast') return { theme: 'dark', contrast: true };
    }
    return { theme: 'auto', contrast: false };
}

export const THEME_VARS = ['--nch-bg', '--nch-fg', '--nc-accent-l', '--nc-accent-soft-l', '--nc-on-accent-l', '--nc-accent-d', '--nc-accent-soft-d', '--nc-on-accent-d', '--nc-hero', '--nc-hero-2'];

/**
 * All CSS variables for the instance colour. The header always follows Nextcloud; the app accent only if wanted and the
 * instance has a custom colour (with Nextcloud's default blue our midnight blue/gold stays).
 * @returns {{vars: Record<string, string>, accent: boolean}} empty for an invalid colour
 */
export function themeVars(color, { useAccent = true, highContrast = false } = {}) {
    const p = parseHex(color);
    if (!p) return { vars: {}, accent: false };
    const vars = { '--nch-bg': p, '--nch-fg': headerText(p) };
    if (!useAccent || p === NC_DEFAULT_COLOR) return { vars, accent: false };
    const min = highContrast ? 7 : 4.5;
    const l = deriveAccent(p, 'light', { min }), d = deriveAccent(p, 'dark', { min }), hero = deriveHero(p);
    if (!l || !d || !hero) return { vars, accent: false };
    Object.assign(vars, {
        '--nc-accent-l': l.accent, '--nc-accent-soft-l': l.soft, '--nc-on-accent-l': l.on,
        '--nc-accent-d': d.accent, '--nc-accent-soft-d': d.soft, '--nc-on-accent-d': d.on,
        '--nc-hero': hero.hero, '--nc-hero-2': hero.hero2
    });
    return { vars, accent: true };
}
