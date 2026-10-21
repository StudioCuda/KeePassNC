#!/usr/bin/env node
// Draws the brand mark (shield with keyhole, 24x24) as filled contours and writes them to src/brand-paths.js.
//   node tools/brand-geometry.mjs
// Why contours instead of a stroke: with a stroke the outer radius of a corner is always the inner radius plus the stroke width.
// Here every corner has its own radius, fine on the outside, as soft on the inside as the shield needs.
// Structure: a centre line (shield, key), from it the outer and inner contour by offsetting, each corner rounded with its own radius.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const outN = (t) => [t[1], -t[0]]; // outward normal for clockwise winding (y points down)

// Primitives: line, circular arc (angle in radians, increasing = clockwise), cubic
const L = (p0, p1) => ({ k: 'L', p0, p1 });
const A = (c, r, a0, a1) => ({ k: 'A', c, r, a0, a1 });
const C = (p) => ({ k: 'C', p });

/** Point and tangent at u in 0..1; extended in a straight line beyond that (the rounding needs intersection points past the ends). */
function at(s, u) {
    if (s.k === 'L') return { p: lerp(s.p0, s.p1, u), t: norm(sub(s.p1, s.p0)) };
    if (s.k === 'A') { const a = s.a0 + (s.a1 - s.a0) * u, sg = Math.sign(s.a1 - s.a0); return { p: [s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)], t: [-sg * Math.sin(a), sg * Math.cos(a)] }; }
    const [p0, p1, p2, p3] = s.p;
    if (u >= 0 && u <= 1) {
        const m = 1 - u, p = [0, 1].map((i) => m ** 3 * p0[i] + 3 * m * m * u * p1[i] + 3 * m * u * u * p2[i] + u ** 3 * p3[i]);
        return { p, t: norm([0, 1].map((i) => 3 * m * m * (p1[i] - p0[i]) + 6 * m * u * (p2[i] - p1[i]) + 3 * u * u * (p3[i] - p2[i]))) };
    }
    const e = u < 0 ? { b: p0, d: sub(p1, p0) } : { b: p3, d: sub(p3, p2) };
    return { p: add(e.b, mul(e.d, 3 * (u < 0 ? u : u - 1))), t: norm(e.d) };
}
const splitAt = (P, u) => { const [p0, p1, p2, p3] = P, a = lerp(p0, p1, u), b = lerp(p1, p2, u), c = lerp(p2, p3, u), d = lerp(a, b, u), e = lerp(b, c, u), g = lerp(d, e, u); return [[p0, a, d, g], [g, e, c, p3]]; };
const piece = (P, u0, u1) => { const r = splitAt(P, u1)[0]; return u0 <= 0 ? r : splitAt(r, u0 / u1)[1]; };
const meet = (p, d, q, e) => add(p, mul(d, cross(sub(q, p), e) / cross(d, e)));

/** Offset of a primitive by d (positive = outward). Cubic per Tiller-Hanson: accurate to a hundredth on the shield's flat curve. */
function offset(s, d) {
    if (s.k === 'L') { const n = mul(outN(norm(sub(s.p1, s.p0))), d); return L(add(s.p0, n), add(s.p1, n)); }
    if (s.k === 'A') return A(s.c, s.r + d, s.a0, s.a1);
    const P = s.p, e = [sub(P[1], P[0]), sub(P[2], P[1]), sub(P[3], P[2])], n = e.map((v) => mul(outN(norm(v)), d));
    return C([add(P[0], n[0]), meet(add(P[0], n[0]), e[0], add(P[1], n[1]), e[1]), meet(add(P[1], n[1]), e[1], add(P[2], n[2]), e[2]), add(P[3], n[2])]);
}

/** Rounding of the corner between a (ends there) and b (starts there): circle of radius r touching both. r = 0: sharp corner (intersection point). */
function corner(a, b, r) {
    const ta = at(a, 1).t, tb = at(b, 0).t, sg = Math.sign(cross(ta, tb)), nrm = (t) => mul([-t[1], t[0]], sg * r);
    const phi = Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1])));
    const len = (s) => s.k === 'L' ? Math.hypot(...sub(s.p1, s.p0)) : s.k === 'A' ? Math.abs(s.a1 - s.a0) * s.r : Math.hypot(...sub(s.p[3], s.p[0]));
    let x = [1 - r * Math.tan(phi / 2) / len(a), r * Math.tan(phi / 2) / len(b)];
    const F = (x) => { const ea = at(a, x[0]), eb = at(b, x[1]); return sub(add(ea.p, nrm(ea.t)), add(eb.p, nrm(eb.t))); };
    for (let i = 0; i < 60; i++) { // Newton on (ua, ub)
        const f0 = F(x), h = 1e-6, fa = F([x[0] + h, x[1]]), fb = F([x[0], x[1] + h]);
        const J = [[(fa[0] - f0[0]) / h, (fb[0] - f0[0]) / h], [(fa[1] - f0[1]) / h, (fb[1] - f0[1]) / h]], det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        const dx = [(J[1][1] * f0[0] - J[0][1] * f0[1]) / det, (-J[1][0] * f0[0] + J[0][0] * f0[1]) / det];
        x = [x[0] - dx[0], x[1] - dx[1]];
        if (Math.hypot(...dx) < 1e-11) break;
    }
    if (!x.every(Number.isFinite)) throw new Error(`Ecke mit Radius ${r} passt nicht`);
    return { ua: x[0], ub: x[1], pb: at(b, x[1]).p, r, sweep: sg > 0 ? 1 : 0 };
}

/** Closed contour (clockwise) as a command list. radii[i]: radius of the corner between primitive i and i+1, null = smooth. */
function contour(prims, radii) {
    const n = prims.length, us = prims.map(() => 0), ue = prims.map(() => 1), fl = [];
    radii.forEach((r, i) => { if (r == null) return; const j = (i + 1) % n, q = corner(prims[i], prims[j], r); ue[i] = q.ua; us[j] = q.ub; fl[i] = q; });
    const cmds = [['M', ...at(prims[0], us[0]).p]];
    prims.forEach((s, i) => {
        const a = us[i], b = ue[i], u0 = Math.max(a, 0), u1 = Math.min(b, 1);
        if (a < 0) cmds.push(['L', ...at(s, 0).p]);
        if (u1 > u0) {
            if (s.k === 'L') cmds.push(['L', ...at(s, u1).p]);
            else if (s.k === 'A') cmds.push(['A', s.r, s.r, 0, Math.abs((s.a1 - s.a0) * (u1 - u0)) > Math.PI ? 1 : 0, s.a1 > s.a0 ? 1 : 0, ...at(s, u1).p]);
            else cmds.push(['C', ...piece(s.p, u0, u1).slice(1).flat()]);
        }
        if (b > 1) cmds.push(['L', ...at(s, b).p]);
        if (fl[i] && fl[i].r > 0) cmds.push(['A', fl[i].r, fl[i].r, 0, 0, fl[i].sweep, ...fl[i].pb]);
    });
    return [...cmds, ['Z']];
}

/** Command lists as compact path text: relative commands, h/v for horizontals and verticals, no repeated command letter, no superfluous separators.
 *  Calculation is in whole hundredths on the rounded point, so no rounding error accumulates. */
function serialize(lists, prec = 2) {
    const k = 10 ** prec, rnd = (v) => Math.round(v * k);
    let out = '', lastCmd = '', lastNum = '', cx = 0, cy = 0, sx = 0, sy = 0;
    const num = (i) => { // whole hundredths -> shortest notation
        let s = String(Math.abs(i) / k).replace(/^0\./, '.'); if (i < 0) s = '-' + s;
        if (!lastNum || s[0] === '-' || (s[0] === '.' && lastNum.includes('.'))) out += s; else out += ' ' + s;
        lastNum = s;
    };
    const raw = (v) => { const s = String(v); out += lastNum ? ' ' + s : s; lastNum = s; }; // angles and flags: unscaled
    const cmd = (c) => { if (c !== lastCmd) { out += c; lastCmd = c; lastNum = ''; } };
    for (const list of lists) for (const c of list) {
        const [name, ...v] = c;
        if (name === 'M') { cmd('M'); cx = sx = rnd(v[0]); cy = sy = rnd(v[1]); num(cx); num(cy); lastCmd = 'M'; }
        else if (name === 'Z') { out += 'z'; lastCmd = 'z'; lastNum = ''; cx = sx; cy = sy; }
        else if (name === 'L') {
            const x = rnd(v[0]), y = rnd(v[1]), dx = x - cx, dy = y - cy;
            if (!dx && !dy) continue;
            if (!dx) { cmd('v'); num(dy); } else if (!dy) { cmd('h'); num(dx); } else { cmd('l'); num(dx); num(dy); }
            cx = x; cy = y;
        } else if (name === 'A') {
            const x = rnd(v[5]), y = rnd(v[6]);
            cmd('a'); num(rnd(v[0])); num(rnd(v[1])); raw(v[2]); raw(v[3]); raw(v[4]); num(x - cx); num(y - cy); cx = x; cy = y;
        } else {
            const p = [rnd(v[0]), rnd(v[1]), rnd(v[2]), rnd(v[3]), rnd(v[4]), rnd(v[5])];
            cmd('c'); for (let i = 0; i < 6; i += 2) { num(p[i] - cx); num(p[i + 1] - cy); } cx = p[4]; cy = p[5];
        }
    }
    return out;
}

// Centre line of the shield, clockwise; the shoulders are sharp corners here (their radius comes from the contours).
const shieldLine = () => [L([12, 2.2], [19.4, 4.9]), L([19.4, 4.9], [19.4, 11.2]), C([[19.4, 11.2], [19.4, 15.9], [16, 19.5], [12, 21.8]]), C([[12, 21.8], [8, 19.5], [4.6, 15.9], [4.6, 11.2]]), L([4.6, 11.2], [4.6, 4.9]), L([4.6, 4.9], [12, 2.2])];
// Keyhole: circle on top, below it a shaft that ends in the same curve as the shield tip
const keyLine = () => {
    const cy = 11.607 - Math.sqrt(2.4 ** 2 - 1.15 ** 2), a0 = Math.atan2(11.607 - cy, -1.15), a1 = Math.atan2(11.607 - cy, 1.15) + 2 * Math.PI;
    return [A([12, cy], 2.4, a0, a1), L([13.15, 11.607], [13.15, 14.85]), C([[13.15, 14.85], [13.15, 15.58], [12.622, 16.14], [12, 16.497]]), C([[12, 16.497], [11.378, 16.14], [10.85, 15.58], [10.85, 14.85]]), L([10.85, 14.85], [10.85, 11.607])];
};
// The corner radius of the mark: apex and tip of the shield, key neck and key tip, inside and out. Only the inner tip in the keyhole is finer.
const R = 0.6, R_KEY_INNER = 0.12;
// Corner order: shield [right shoulder, smooth, tip, smooth, left shoulder, apex]; key [right neck, smooth, tip, smooth, left neck]
const shieldCorners = (shoulder, tip) => [shoulder, null, tip, null, shoulder, tip];
const keyCorners = (neck, tip) => [neck, null, tip, null, neck];

/** The mark for a stroke width w. Shield: ring of outer and inner contour. Key: ring (then as a line, for the fine watermark) or filled (small icons). */
export function mark({ w, filledKey }) {
    const d = w / 2, S = shieldLine(), K = keyLine();
    const parts = [
        contour(S.map((s) => offset(s, d)), shieldCorners(1 + d, R)), // outer: shoulders like a radius-1 arc in the centre line, tips fine
        contour(S.map((s) => offset(s, -d)), shieldCorners(R, R)) // inner: R throughout
    ];
    if (filledKey) parts.push(contour(K, keyCorners(R, R))); // filled: R everywhere
    else parts.push(contour(K.map((s) => offset(s, d)), keyCorners(R, R)), contour(K.map((s) => offset(s, -d)), keyCorners(R, R_KEY_INNER)));
    return serialize(parts);
}

/** The contents of src/brand-paths.js. */
export function pathsModule() {
    return `// Generated by tools/brand-geometry.mjs (node tools/make-brand.mjs calls it); don't edit by hand.
// BOLD: the brand for icons (shield with a 2.1 thick border, keyhole filled). FINE: for the large watermark (border 1.3, keyhole as a line).
export const BOLD = '${mark({ w: 2.1, filledKey: true })}';
export const FINE = '${mark({ w: 1.3, filledKey: false })}';
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/brand-paths.js');
    fs.writeFileSync(file, pathsModule());
    console.log('geschrieben:', file);
}
