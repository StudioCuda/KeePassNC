#!/usr/bin/env node
// Zeichnet die Marke (Schild mit Schluesselloch, 24x24) als gefuellte Konturen und schreibt sie nach src/brand-paths.js.
//   node tools/brand-geometry.mjs
// Warum Konturen statt Strich: Mit einem Strich ist der Aussenradius einer Ecke immer der Innenradius plus Strichstaerke.
// Hier hat jede Ecke ihren eigenen Radius, aussen fein, innen so weich, wie das Schild es braucht.
// Aufbau: eine Mittellinie (Schild, Schluessel), daraus per Versatz die Aussen- und Innenkontur, jede Ecke mit eigenem Radius gerundet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const outN = (t) => [t[1], -t[0]]; // Normale nach aussen bei Umlauf im Uhrzeigersinn (y zeigt nach unten)

// Primitive: Gerade, Kreisbogen (Winkel im Bogenmass, wachsend = im Uhrzeigersinn), Kubik
const L = (p0, p1) => ({ k: 'L', p0, p1 });
const A = (c, r, a0, a1) => ({ k: 'A', c, r, a0, a1 });
const C = (p) => ({ k: 'C', p });

/** Punkt und Tangente bei u in 0..1; ausserhalb gerade verlaengert (die Rundung braucht Schnittpunkte jenseits der Enden). */
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

/** Versatz einer Primitive um d (positiv nach aussen). Kubik nach Tiller-Hanson: bei der flachen Kurve des Schilds auf Hundertstel genau. */
function offset(s, d) {
    if (s.k === 'L') { const n = mul(outN(norm(sub(s.p1, s.p0))), d); return L(add(s.p0, n), add(s.p1, n)); }
    if (s.k === 'A') return A(s.c, s.r + d, s.a0, s.a1);
    const P = s.p, e = [sub(P[1], P[0]), sub(P[2], P[1]), sub(P[3], P[2])], n = e.map((v) => mul(outN(norm(v)), d));
    return C([add(P[0], n[0]), meet(add(P[0], n[0]), e[0], add(P[1], n[1]), e[1]), meet(add(P[1], n[1]), e[1], add(P[2], n[2]), e[2]), add(P[3], n[2])]);
}

/** Rundung der Ecke zwischen a (endet dort) und b (beginnt dort): Kreis vom Radius r, der beide beruehrt. r = 0: scharfe Ecke (Schnittpunkt). */
function corner(a, b, r) {
    const ta = at(a, 1).t, tb = at(b, 0).t, sg = Math.sign(cross(ta, tb)), nrm = (t) => mul([-t[1], t[0]], sg * r);
    const phi = Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1])));
    const len = (s) => s.k === 'L' ? Math.hypot(...sub(s.p1, s.p0)) : s.k === 'A' ? Math.abs(s.a1 - s.a0) * s.r : Math.hypot(...sub(s.p[3], s.p[0]));
    let x = [1 - r * Math.tan(phi / 2) / len(a), r * Math.tan(phi / 2) / len(b)];
    const F = (x) => { const ea = at(a, x[0]), eb = at(b, x[1]); return sub(add(ea.p, nrm(ea.t)), add(eb.p, nrm(eb.t))); };
    for (let i = 0; i < 60; i++) { // Newton auf (ua, ub)
        const f0 = F(x), h = 1e-6, fa = F([x[0] + h, x[1]]), fb = F([x[0], x[1] + h]);
        const J = [[(fa[0] - f0[0]) / h, (fb[0] - f0[0]) / h], [(fa[1] - f0[1]) / h, (fb[1] - f0[1]) / h]], det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        const dx = [(J[1][1] * f0[0] - J[0][1] * f0[1]) / det, (-J[1][0] * f0[0] + J[0][0] * f0[1]) / det];
        x = [x[0] - dx[0], x[1] - dx[1]];
        if (Math.hypot(...dx) < 1e-11) break;
    }
    if (!x.every(Number.isFinite)) throw new Error(`Ecke mit Radius ${r} passt nicht`);
    return { ua: x[0], ub: x[1], pb: at(b, x[1]).p, r, sweep: sg > 0 ? 1 : 0 };
}

/** Geschlossene Kontur (Uhrzeigersinn) als Befehlsliste. radii[i]: Radius der Ecke zwischen Primitive i und i+1, null = glatt. */
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

/** Befehlslisten als kurzer Pfadtext: relative Befehle, h/v fuer Waagerechte und Senkrechte, kein Befehlsbuchstabe doppelt, keine ueberfluessigen Trenner.
 *  Gerechnet wird in ganzen Hundertsteln auf dem gerundeten Punkt, so summiert sich kein Rundungsfehler auf. */
function serialize(lists, prec = 2) {
    const k = 10 ** prec, R = (v) => Math.round(v * k);
    let out = '', lastCmd = '', lastNum = '', cx = 0, cy = 0, sx = 0, sy = 0;
    const num = (i) => { // ganze Hundertstel -> kuerzeste Schreibweise
        let s = String(Math.abs(i) / k).replace(/^0\./, '.'); if (i < 0) s = '-' + s;
        if (!lastNum || s[0] === '-' || (s[0] === '.' && lastNum.includes('.'))) out += s; else out += ' ' + s;
        lastNum = s;
    };
    const raw = (v) => { const s = String(v); out += lastNum ? ' ' + s : s; lastNum = s; }; // Winkel und Flags: unskaliert
    const cmd = (c) => { if (c !== lastCmd) { out += c; lastCmd = c; lastNum = ''; } };
    for (const list of lists) for (const c of list) {
        const [name, ...v] = c;
        if (name === 'M') { cmd('M'); cx = sx = R(v[0]); cy = sy = R(v[1]); num(cx); num(cy); lastCmd = 'M'; }
        else if (name === 'Z') { out += 'z'; lastCmd = 'z'; lastNum = ''; cx = sx; cy = sy; }
        else if (name === 'L') {
            const x = R(v[0]), y = R(v[1]), dx = x - cx, dy = y - cy;
            if (!dx && !dy) continue;
            if (!dx) { cmd('v'); num(dy); } else if (!dy) { cmd('h'); num(dx); } else { cmd('l'); num(dx); num(dy); }
            cx = x; cy = y;
        } else if (name === 'A') {
            const x = R(v[5]), y = R(v[6]);
            cmd('a'); num(R(v[0])); num(R(v[1])); raw(v[2]); raw(v[3]); raw(v[4]); num(x - cx); num(y - cy); cx = x; cy = y;
        } else {
            const p = [R(v[0]), R(v[1]), R(v[2]), R(v[3]), R(v[4]), R(v[5])];
            cmd('c'); for (let i = 0; i < 6; i += 2) { num(p[i] - cx); num(p[i + 1] - cy); } cx = p[4]; cy = p[5];
        }
    }
    return out;
}

// Mittellinie des Schilds im Uhrzeigersinn; die Schultern sind hier scharfe Ecken (ihr Radius kommt von den Konturen).
const shieldLine = () => [L([12, 2.2], [19.4, 4.9]), L([19.4, 4.9], [19.4, 11.2]), C([[19.4, 11.2], [19.4, 15.9], [16, 19.5], [12, 21.8]]), C([[12, 21.8], [8, 19.5], [4.6, 15.9], [4.6, 11.2]]), L([4.6, 11.2], [4.6, 4.9]), L([4.6, 4.9], [12, 2.2])];
// Schluesselloch: Kreis oben, darunter ein Schaft, der in dieselbe Kurve ausmuendet wie die Schildspitze
const keyLine = () => {
    const cy = 11.607 - Math.sqrt(2.4 ** 2 - 1.15 ** 2), a0 = Math.atan2(11.607 - cy, -1.15), a1 = Math.atan2(11.607 - cy, 1.15) + 2 * Math.PI;
    return [A([12, cy], 2.4, a0, a1), L([13.15, 11.607], [13.15, 14.85]), C([[13.15, 14.85], [13.15, 15.58], [12.622, 16.14], [12, 16.497]]), C([[12, 16.497], [11.378, 16.14], [10.85, 15.58], [10.85, 14.85]]), L([10.85, 14.85], [10.85, 11.607])];
};
// Eckenfolge: Schild [Schulter rechts, glatt, Spitze, glatt, Schulter links, Scheitel]; Schluessel [Hals rechts, glatt, Spitze, glatt, Hals links]
const shieldCorners = (shoulder, tip) => [shoulder, null, tip, null, shoulder, tip];
const keyCorners = (neck, tip) => [neck, null, tip, null, neck];

/** Die Marke fuer eine Strichstaerke w. Schild: Ring aus Aussen- und Innenkontur. Schluessel: Ring (dann als Linie, fuers feine Wasserzeichen) oder gefuellt (kleine Symbole). */
export function mark({ w, filledKey }) {
    const d = w / 2, S = shieldLine(), K = keyLine();
    const parts = [
        contour(S.map((s) => offset(s, d)), shieldCorners(1 + d, 0.6)), // aussen: Schultern wie ein Radius-1-Bogen in der Mittellinie, Spitzen fein
        contour(S.map((s) => offset(s, -d)), shieldCorners(0.6, 0.6)) // innen: durchgehend 0,6
    ];
    if (filledKey) parts.push(contour(K, keyCorners(0.65, 0.6)));
    else parts.push(contour(K.map((s) => offset(s, d)), keyCorners(0.65, 0.6)), contour(K.map((s) => offset(s, -d)), keyCorners(0.65, 0.12)));
    return serialize(parts);
}

/** Der Inhalt von src/brand-paths.js. */
export function pathsModule() {
    return `// Erzeugt von tools/brand-geometry.mjs (node tools/make-brand.mjs ruft es auf); nicht von Hand aendern.
// BOLD: die Marke fuer Symbole (Schild mit 2,1 starkem Rand, Schluesselloch gefuellt). FINE: fuers grosse Wasserzeichen (Rand 1,3, Schluesselloch als Linie).
export const BOLD = '${mark({ w: 2.1, filledKey: true })}';
export const FINE = '${mark({ w: 1.3, filledKey: false })}';
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/brand-paths.js');
    fs.writeFileSync(file, pathsModule());
    console.log('geschrieben:', file);
}
