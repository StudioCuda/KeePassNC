// Die Marke: Schild mit Schluesselloch (24x24). Einzige Quelle fuer img/app.svg, die Favicons und das Symbol in der Oberflaeche (ui/dom.js).
// Die Dateien erzeugt `node tools/make-brand.mjs`; tests/unit/brand.test.mjs prueft, dass sie nicht davon abweichen.
export const MARK = {
    // Schildkontur: wird mit Strichstaerke STROKE gezeichnet, Schultern mit Radius 1, die Schildspitze unten ist die Vorlage fuers Schluesselloch
    line: 'M12 2.2 18.743 4.66A1 1 0 0 1 19.4 5.6V11.2c0 4.7-3.4 8.3-7.4 10.6-4-2.3-7.4-5.9-7.4-10.6V5.6A1 1 0 0 1 5.257 4.66Z',
    // Die zwei inneren Schulterecken (Radius 0,8): fuellen, was der Strich innen scharf laesst
    inner: 'M17.824 5.443 18.35 5.635 18.35 6.194A.8.8 0 0 0 17.824 5.443ZM6.176 5.443 5.65 5.635 5.65 6.194A.8.8 0 0 1 6.176 5.443Z',
    // Schluesselloch aus einem Pfad: Kreis oben, darunter ein Schaft, der in dieselbe Kurve auslaeuft wie die Schildspitze
    key: 'M10.85 11.607A2.4 2.4 0 1 1 13.15 11.607V14.85C13.15 15.58 12.622 16.14 12 16.497C11.378 16.14 10.85 15.58 10.85 14.85Z'
};
export const STROKE = 2.1;


/** Die Marke als SVG-Text, einfarbig. */
export function markSvg(color = 'currentColor', { size = 24 } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK.line}" fill="none" stroke="${color}" stroke-width="${STROKE}"/><path d="${MARK.inner}"/><path d="${MARK.key}"/></svg>\n`;
}

/** Symbol fuer Browser-Tab und Startbildschirm: weisse Marke auf Nachtblau (die Hero-Farbe); abgerundet, oder randlos fuer iOS (rundet selbst). */
export function tileSvg({ rounded = true } = {}) {
    const rx = rounded ? ' rx="7"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32"${rx} fill="#0b1f3b"/><g transform="translate(5.2 5.2) scale(.9)" fill="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK.line}" fill="none" stroke="#fff" stroke-width="${STROKE}"/><path d="${MARK.inner}"/><path d="${MARK.key}"/></g></svg>\n`;
}
