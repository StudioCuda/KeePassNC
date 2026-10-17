// Nextcloud-Theming ohne Abhaengigkeiten und ohne DOM (unit-testbar): Farbe pruefen, Kontraste nach WCAG 2.x rechnen,
// aus der Instanzfarbe die Akzenttoene fuer hell/dunkel ableiten und die Hell/Dunkel-Wahl der Benutzerin uebersetzen.
// Die Flaechenfarben muessen zu den Variablen oben in keepassnc.css passen (prueft tests/unit/theme.test.mjs).

/** Standard-Primaerfarbe von Nextcloud (BackgroundService::DEFAULT_COLOR): gilt als "keine eigene Instanzfarbe". */
export const NC_DEFAULT_COLOR = '#00679e';

export const SURFACES = {
    light: { bg: '#f4f1ec', surface: '#fffdfa', surface2: '#f9f6f2', surface3: '#ede8e2' },
    dark: { bg: '#0b1422', surface: '#111c2d', surface2: '#152134', surface3: '#1b293e' }
};

/** '#abc' / '#AABBCC' -> '#aabbcc'; alles andere -> null. */
export function parseHex(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Mischt a mit b; t = Anteil von b (0..1). */
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };

export function luminance(h) {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Schwarz oder Weiss, je nachdem, was auf c mehr Kontrast hat (mindestens ~4.58:1). */
export const textOn = (c) => (contrast(c, '#ffffff') >= contrast(c, '#000000') ? '#ffffff' : '#000000');
/** Schriftfarbe der Nextcloud-Kopfleiste, wie Nextcloud sie waehlt (Util::invertTextColor: Weiss nur ab 4.5:1). */
export const headerText = (c) => (contrast(c, '#ffffff') < 4.5 ? '#000000' : '#ffffff');

/**
 * Akzenttoene fuer einen Modus: die Farbe wird schrittweise Richtung Schwarz (hell) bzw. Weiss (dunkel) geschoben, bis sie
 * als Schrift auf allen Flaechen und auf --accent-soft mindestens `min` erreicht (4.5:1, bei hohem Kontrast 7:1).
 * @returns {{accent: string, soft: string, on: string}|null} null bei ungueltiger Farbe
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

/** Hintergrund der Anmeldeseite (weisse Schrift, teils leicht transparent): dunkel genug fuer 7:1. */
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
 * Uebersetzt die Theme-Liste von Nextcloud (Benutzerwert theming/enabled-themes, ein erzwungenes Theme vorne) in unsere Begriffe.
 * 'default' ist "System" in Nextcloud, also unser 'auto'. Zusatz-Themes (Schrift, Bewegung) werden uebersprungen.
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
 * Alle CSS-Variablen fuer die Instanzfarbe. Kopfleiste folgt immer Nextcloud; der Akzent der App nur, wenn gewuenscht und die
 * Instanz eine eigene Farbe hat (beim Nextcloud-Standardblau bleibt unser Nachtblau/Gold).
 * @returns {{vars: Record<string, string>, accent: boolean}} leer bei ungueltiger Farbe
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
