// The brand: shield with keyhole (24x24). Single source for img/app.svg, the favicons and the icon in the UI (ui/dom.js).
// tools/brand-geometry.mjs traces the paths into src/brand-paths.js; `node tools/make-brand.mjs` generates the files; tests/unit/brand.test.mjs checks that they don't drift from it.
import { BOLD, FINE } from './brand-paths.js';
export const MARK = { bold: BOLD, fine: FINE };

/** The brand as SVG text, single colour. */
export function markSvg(color = 'currentColor', { size = 24 } = {}) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" fill-rule="evenodd"><path d="${MARK.bold}"/></svg>\n`;
}

/** Icon for browser tab and home screen: white mark on night blue (the hero colour); rounded, or edge-to-edge for iOS (which rounds itself). */
export function tileSvg({ rounded = true } = {}) {
    const rx = rounded ? ' rx="7"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32"${rx} fill="#0b1f3b"/><path transform="translate(5.2 5.2) scale(.9)" fill="#fff" fill-rule="evenodd" d="${MARK.bold}"/></svg>\n`;
}
