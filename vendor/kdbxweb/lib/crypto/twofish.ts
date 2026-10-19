// Twofish-256 im CBC-Modus mit PKCS#7-Padding, wie KeePass und KeePassXC es fuer KDBX nutzen.
// Eigene Umsetzung nach der Spezifikation (Schneier et al., "Twofish: A 128-Bit Block Cipher", 1998), nur 256-Bit-Schluessel.

import { KdbxError } from '../errors/kdbx-error';
import { ErrorCodes } from '../defs/consts';

// q0 und q1 aus je vier 4-Bit-Tabellen (Spezifikation 4.3.5)
const Q_TABLES = [
    ['817D6F320B59ECA4', 'ECB81235F4A6709D', 'BA5E6D90C8F32471', 'D7F4126E9B3085CA'],
    ['28BDF76E31940AC5', '1E2B4C376DA5F908', '4C75169A0ED82B3F', 'B951C3DE647F208A']
];
const ror4 = (x: number) => ((x >> 1) | (x << 3)) & 15;
const Q = Q_TABLES.map((tables) => {
    const t = tables.map((s) => [...s].map((c) => parseInt(c, 16)));
    const q = new Uint8Array(256);
    for (let x = 0; x < 256; x++) {
        let a = x >> 4, b = x & 15;
        for (let i = 0; i < 4; i += 2) {
            const a1 = a ^ b, b1 = (a ^ ror4(b) ^ (a << 3)) & 15;
            a = t[i][a1];
            b = t[i + 1][b1];
        }
        q[x] = (b << 4) | a;
    }
    return q;
});

// Multiplikation in GF(2^8) modulo poly
function gfMul(a: number, b: number, poly: number): number {
    let r = 0;
    for (; b; b >>= 1, a = a & 0x80 ? (a << 1) ^ poly : a << 1) if (b & 1) r ^= a;
    return r;
}

const MDS = [
    [0x01, 0xef, 0x5b, 0x5b],
    [0x5b, 0xef, 0xef, 0x01],
    [0xef, 0x5b, 0x01, 0xef],
    [0xef, 0x01, 0xef, 0x5b]
];
const RS = [
    [0x01, 0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e],
    [0xa4, 0x56, 0x82, 0xf3, 0x1e, 0xc6, 0x68, 0xe5],
    [0x02, 0xa1, 0xfc, 0xc1, 0x47, 0xae, 0x3d, 0x19],
    [0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e, 0x03]
];
// Welche q-Permutation in welcher Stufe der Funktion h (k = 4) auf Byte j wirkt, von innen nach aussen
const H_STEPS = [
    [1, 0, 0, 1],
    [1, 1, 0, 0],
    [0, 1, 0, 1],
    [0, 0, 1, 1],
    [1, 0, 1, 0]
];

const byte = (w: number, j: number) => (w >>> (8 * j)) & 0xff;
const rol = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

// Byte j der S-Box von h: abwechselnd q-Permutation und XOR mit Byte j der Schluesselwoerter l[3], l[2], l[1], l[0]
function sbox(j: number, x: number, l: number[]): number {
    for (let i = 0; i < 4; i++) x = Q[H_STEPS[i][j]][x] ^ byte(l[3 - i], j);
    return Q[H_STEPS[4][j]][x];
}

// Spalte j der MDS-Matrix mal y, als Wort
const mdsColumn = (j: number, y: number) =>
    MDS.reduce((w, row, i) => w | (gfMul(row[j], y, 0x169) << (8 * i)), 0) >>> 0;

function h(x: number, l: number[]): number {
    let z = 0;
    for (let j = 0; j < 4; j++) z ^= mdsColumn(j, sbox(j, byte(x, j), l));
    return z >>> 0;
}

export class Twofish {
    private readonly k = new Uint32Array(40);
    // g als vier Tabellen: g(X) = s[0][X0] ^ s[1][X1] ^ s[2][X2] ^ s[3][X3]
    private readonly s = [0, 1, 2, 3].map(() => new Uint32Array(256));

    constructor(key: Uint8Array) {
        if (key.length !== 32) throw new KdbxError(ErrorCodes.InvalidArg, 'Twofish key must be 32 bytes');
        const words = new DataView(key.buffer, key.byteOffset, 32);
        const m = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => words.getUint32(4 * i, true));
        const even = [m[0], m[2], m[4], m[6]], odd = [m[1], m[3], m[5], m[7]];
        // S-Schluessel per RS-Code, in umgekehrter Reihenfolge (S3, S2, S1, S0)
        const sk = [0, 1, 2, 3]
            .map((i) => RS.reduce((w, row, r) => w | (row.reduce((acc, c, n) => acc ^ gfMul(c, key[8 * i + n], 0x14d), 0) << (8 * r)), 0) >>> 0)
            .reverse();
        for (let i = 0; i < 20; i++) {
            const a = h(0x02020202 * i, even), b = rol(h(0x02020202 * i + 0x01010101, odd), 8);
            this.k[2 * i] = a + b;
            this.k[2 * i + 1] = rol((a + 2 * b) >>> 0, 9);
        }
        for (let j = 0; j < 4; j++) for (let x = 0; x < 256; x++) this.s[j][x] = mdsColumn(j, sbox(j, x, sk));
    }

    private g(x: number): number {
        const s = this.s;
        return (s[0][x & 0xff] ^ s[1][(x >>> 8) & 0xff] ^ s[2][(x >>> 16) & 0xff] ^ s[3][x >>> 24]) >>> 0;
    }

    /** Verschluesselt einen Block (4 Woerter, little-endian) an Ort und Stelle. */
    encryptBlock(b: Uint32Array): void {
        const k = this.k;
        let r0 = b[0] ^ k[0], r1 = b[1] ^ k[1], r2 = b[2] ^ k[2], r3 = b[3] ^ k[3];
        for (let r = 0; r < 16; r++) {
            const t0 = this.g(r0), t1 = this.g(rol(r1, 8));
            const f0 = t0 + t1 + k[2 * r + 8], f1 = t0 + 2 * t1 + k[2 * r + 9];
            const n2 = r0, n3 = r1;
            r0 = rol((r2 ^ f0) >>> 0, 31);
            r1 = (rol(r3, 1) ^ f1) >>> 0;
            r2 = n2;
            r3 = n3;
        }
        b[0] = r2 ^ k[4]; b[1] = r3 ^ k[5]; b[2] = r0 ^ k[6]; b[3] = r1 ^ k[7];
    }

    /** Entschluesselt einen Block an Ort und Stelle: die Runden von encryptBlock rueckwaerts. */
    decryptBlock(b: Uint32Array): void {
        const k = this.k;
        let r2 = b[0] ^ k[4], r3 = b[1] ^ k[5], r0 = b[2] ^ k[6], r1 = b[3] ^ k[7];
        for (let r = 15; r >= 0; r--) {
            const t0 = this.g(r2), t1 = this.g(rol(r3, 8));
            const f0 = t0 + t1 + k[2 * r + 8], f1 = t0 + 2 * t1 + k[2 * r + 9];
            const n0 = r2, n1 = r3;
            r2 = (rol(r0, 1) ^ f0) >>> 0;
            r3 = rol((r1 ^ f1) >>> 0, 31);
            r0 = n0;
            r1 = n1;
        }
        b[0] = r0 ^ k[0]; b[1] = r1 ^ k[1]; b[2] = r2 ^ k[2]; b[3] = r3 ^ k[3];
    }
}

// encryptionIV kann ein Uint8Array sein (frisch erzeugt) oder ein ArrayBuffer (aus der Datei)
const view = (x: ArrayBuffer | Uint8Array) => (x instanceof Uint8Array ? new DataView(x.buffer, x.byteOffset, x.byteLength) : new DataView(x));
const readBlock = (v: DataView, o: number, b: Uint32Array) => { for (let i = 0; i < 4; i++) b[i] = v.getUint32(o + 4 * i, true); };
const writeBlock = (v: DataView, o: number, b: Uint32Array) => { for (let i = 0; i < 4; i++) v.setUint32(o + 4 * i, b[i], true); };

/** Twofish-256-CBC mit PKCS#7. Falsches Padding beim Entschluesseln heisst (wie bei AES) falscher Schluessel. */
export function twofishCbc(data: ArrayBuffer, key: ArrayBuffer, iv: ArrayBuffer | Uint8Array, encrypt: boolean): ArrayBuffer {
    const tf = new Twofish(new Uint8Array(key));
    const chain = new Uint32Array(4), b = new Uint32Array(4), c = new Uint32Array(4);
    readBlock(view(iv), 0, chain);
    if (encrypt) {
        const pad = 16 - (data.byteLength % 16);
        const out = new Uint8Array(data.byteLength + pad);
        out.set(new Uint8Array(data));
        out.fill(pad, data.byteLength);
        const v = new DataView(out.buffer);
        for (let o = 0; o < out.length; o += 16) {
            readBlock(v, o, b);
            for (let i = 0; i < 4; i++) b[i] ^= chain[i];
            tf.encryptBlock(b);
            writeBlock(v, o, b);
            chain.set(b);
        }
        return out.buffer;
    }
    if (!data.byteLength || data.byteLength % 16) throw new KdbxError(ErrorCodes.InvalidKey, 'invalid key');
    const out = new Uint8Array(data.byteLength);
    const src = view(data), dst = new DataView(out.buffer);
    for (let o = 0; o < out.length; o += 16) {
        readBlock(src, o, c);
        b.set(c);
        tf.decryptBlock(b);
        for (let i = 0; i < 4; i++) b[i] ^= chain[i];
        writeBlock(dst, o, b);
        chain.set(c);
    }
    const pad = out[out.length - 1];
    if (pad < 1 || pad > 16 || out.subarray(out.length - pad).some((x) => x !== pad)) {
        throw new KdbxError(ErrorCodes.InvalidKey, 'invalid key');
    }
    return out.buffer.slice(0, out.length - pad);
}
