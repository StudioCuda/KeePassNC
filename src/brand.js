// Die Marke: Schild mit Schluesselloch (24x24). Einzige Quelle fuer img/app.svg, die Favicons und das Symbol in der Oberflaeche (ui/dom.js).
// Die Pfade zeichnet tools/brand-geometry.mjs nach src/brand-paths.js; die Dateien erzeugt `node tools/make-brand.mjs`; tests/unit/brand.test.mjs prueft, dass sie nicht davon abweichen.
import { BOLD, FINE } from './brand-paths.js';
export const MARK = { bold: BOLD, fine: FINE };

/** Die Marke als SVG-Text, einfarbig. */
export function markSvg(color = 'currentColor', { size = 24 } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" fill-rule="evenodd"><path d="${MARK.bold}"/></svg>\n`;
}

/** Symbol fuer Browser-Tab und Startbildschirm: weisse Marke auf Nachtblau (die Hero-Farbe); abgerundet, oder randlos fuer iOS (rundet selbst). */
export function tileSvg({ rounded = true } = {}) {
    const rx = rounded ? ' rx="7"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32"${rx} fill="#0b1f3b"/><path transform="translate(5.2 5.2) scale(.9)" fill="#fff" fill-rule="evenodd" d="${MARK.bold}"/></svg>\n`;
}
