import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyfileStore, chooseKdfParams, isWeakerThan, limits, KeyfileStoreError } from '../../src/keyfile-store.js';

const REAL = structuredClone(limits);
limits.minMemoryKiB = 64; limits.minIterations = 1; limits.acceptMinMemoryKiB = 8; limits.acceptMinIterations = 1; // nur fuer die Tests: schnelle Parameter
const mem = () => { const m = new Map(); return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, structuredClone(v)); }, delete: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] }; };
const KEY = new TextEncoder().encode('<?xml version="1.0"?><KeyFile><Key><Data>ABCDEF</Data></Key></KeyFile>');
const P = { memoryKiB: 64, iterations: 1 };

test('Round-Trip: richtiges Master-Passwort liefert die Schluesseldatei byte-identisch', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'nc:anna:/a.kdbx', name: 'a.keyx', keyfile: KEY, password: 'Hä!rtes Pässwort 🔑', params: P });
    assert.deepEqual([...await s.recall({ id: 'nc:anna:/a.kdbx', password: 'Hä!rtes Pässwort 🔑' })], [...KEY]);
});
test('falsches Master-Passwort -> Fehler "wrong"; nichts gemerkt -> null', async () => {
    const s = createKeyfileStore(mem());
    assert.equal(await s.recall({ id: 'x', password: 'egal' }), null);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'richtig', params: P });
    await assert.rejects(s.recall({ id: 'x', password: 'falsch' }), (e) => e instanceof KeyfileStoreError && e.code === 'wrong');
    await assert.rejects(s.recall({ id: 'x', password: 'richtig ' }), (e) => e.code === 'wrong'); // schon ein Leerzeichen genuegt
});
test('im Speicher liegt weder Klartext noch Passwort noch abgeleiteter Schluessel', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k.keyx', keyfile: KEY, password: 'Geheim-Passwort', params: P });
    const rec = b.m.get('kf:x');
    const dump = JSON.stringify(rec, (k, v) => (v instanceof ArrayBuffer ? [...new Uint8Array(v)] : ArrayBuffer.isView(v) ? [...v] : v));
    assert.ok(!dump.includes('Geheim-Passwort') && !dump.includes('ABCDEF'));
    const bytes = new Uint8Array(rec.ct);
    assert.ok(bytes.length === KEY.length + 16, 'AES-GCM: Chiffrat = Klartext + 16 Byte Tag');
    assert.deepEqual(Object.keys(rec).sort(), ['created', 'ct', 'format', 'id', 'iv', 'kdf', 'name']);
    assert.deepEqual(Object.keys(rec.kdf).sort(), ['alg', 'iterations', 'memoryKiB', 'salt']);
});
test('jede Speicherung nutzt neues Salz und neuen IV (gleiche Eingabe -> anderes Chiffrat)', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: P }); const a = structuredClone(b.m.get('kf:x'));
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: P }); const c = b.m.get('kf:x');
    assert.notDeepEqual([...a.kdf.salt], [...c.kdf.salt]); assert.notDeepEqual([...a.iv], [...c.iv]); assert.notDeepEqual([...new Uint8Array(a.ct)], [...new Uint8Array(c.ct)]);
});
test('Datensatz ist an die Datei-Kennung gebunden (Umhaengen auf andere Datei schlaegt fehl)', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'datei-A', name: 'k', keyfile: KEY, password: 'p', params: P });
    const rec = structuredClone(b.m.get('kf:datei-A')); rec.id = 'datei-B'; b.m.set('kf:datei-B', rec);
    await assert.rejects(s.recall({ id: 'datei-B', password: 'p' }), (e) => e.code === 'wrong');
});
test('Manipulation (Chiffrat/IV/Salz veraendert) wird erkannt', async () => {
    for (const field of ['ct', 'iv', 'salt']) {
        const b = mem(), s = createKeyfileStore(b);
        await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: P });
        const rec = b.m.get('kf:x');
        const tgt = field === 'salt' ? rec.kdf.salt : field === 'iv' ? rec.iv : new Uint8Array(rec.ct);
        tgt[0] ^= 1; if (field === 'ct') rec.ct = tgt.buffer;
        await assert.rejects(s.recall({ id: 'x', password: 'p' }), (e) => e.code === 'wrong', field);
    }
});
test('manipulierte KDF-Parameter (Ressourcen-Angriff) werden abgelehnt, bevor gerechnet wird', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: P });
    b.m.get('kf:x').kdf.memoryKiB = 4 * 1024 * 1024;
    await assert.rejects(s.recall({ id: 'x', password: 'p' }), (e) => e.code === 'format');
    b.m.get('kf:x').kdf.memoryKiB = 64; b.m.get('kf:x').kdf.iterations = 100000;
    await assert.rejects(s.recall({ id: 'x', password: 'p' }), (e) => e.code === 'format');
});
test('Grenzen: leere/zu grosse Datei, leeres Passwort; KDF-Parameter werden auf Mindestwerte angehoben', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await assert.rejects(s.remember({ id: 'x', name: 'k', keyfile: new Uint8Array(0), password: 'p' }), (e) => e.code === 'empty');
    await assert.rejects(s.remember({ id: 'x', name: 'k', keyfile: new Uint8Array(limits.maxBytes + 1), password: 'p' }), (e) => e.code === 'toolarge');
    await assert.rejects(s.remember({ id: 'x', name: 'k', keyfile: KEY, password: '' }), (e) => e.code === 'password');
    const saved = { ...limits }; limits.minMemoryKiB = 128; limits.minIterations = 2;
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: { memoryKiB: 8, iterations: 1 } });
    assert.equal(b.m.get('kf:x').kdf.memoryKiB, 128); assert.equal(b.m.get('kf:x').kdf.iterations, 2);
    Object.assign(limits, saved);
});
test('list/forget/forgetAll beruehren nur Schluesseldatei-Datensaetze', async () => {
    const b = mem(), s = createKeyfileStore(b);
    b.m.set('nc:anna:/a.kdbx', { bytes: 'offline-kopie' });
    await s.remember({ id: 'a', name: 'A', keyfile: KEY, password: 'p', params: P }); await s.remember({ id: 'b', name: 'B', keyfile: KEY, password: 'p', params: P });
    assert.deepEqual((await s.list()).map((x) => x.id).sort(), ['a', 'b']);
    await s.forget('a'); assert.equal(await s.recall({ id: 'a', password: 'p' }), null);
    await s.forgetAll(); assert.deepEqual(await s.list(), []); assert.ok(b.m.has('nc:anna:/a.kdbx'), 'Offline-Kopie bleibt unberuehrt');
});

test('Kosten je Tipp nie unter der Datenbank-KDF: Speicher begrenzt -> Durchlaeufe steigen (Arbeit = Speicher x Durchlaeufe)', () => {
    const saved = structuredClone(limits); Object.assign(limits, structuredClone(REAL));
    const work = (p) => p.memoryKiB * p.iterations;
    for (const [mMiB, it] of [[64, 40], [256, 8], [512, 20], [1024, 5], [2048, 10], [4096, 3]]) {
        const p = chooseKdfParams({ kdf: 'Argon2id', memoryKiB: mMiB * 1024, iterations: it });
        assert.ok(work(p) >= mMiB * 1024 * it, `${mMiB} MiB / ${it}: ${p.memoryKiB / 1024} MiB / ${p.iterations}`);
        assert.ok(p.memoryKiB <= limits.maxMemoryKiB && p.iterations <= limits.maxIterations);
    }
    assert.deepEqual(chooseKdfParams({ kdf: 'Argon2d', memoryKiB: 1024, iterations: 2 }), { memoryKiB: 65536, iterations: 3 }, 'Untergrenze 64 MiB / 3');
    assert.deepEqual(chooseKdfParams({ kdf: 'AES-KDF', memoryKiB: 0, iterations: 60000 }), limits.aesKdf, 'AES-KDF: feste Argon2id-Parameter, Runden werden nicht als Durchlaeufe missdeutet');
    assert.deepEqual(chooseKdfParams({}), limits.aesKdf);
    assert.deepEqual(chooseKdfParams({ kdf: 'Argon2id', memoryKiB: NaN, iterations: 'x' }), limits.aesKdf);
    Object.assign(limits, saved);
});
test('spaeter angehobene Untergrenze macht alte Datensaetze nicht unbrauchbar; Werte ausserhalb der Lese-Grenzen -> "format"', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: P });
    const saved = { ...limits }; limits.minMemoryKiB = 128; limits.minIterations = 2;
    assert.deepEqual([...await s.recall({ id: 'x', password: 'p' })], [...KEY]);
    Object.assign(limits, saved);
    for (const bad of [{ memoryKiB: 4 }, { iterations: 0 }, { memoryKiB: 64.5 }, { iterations: '3' }, { memoryKiB: limits.maxMemoryKiB + 1 }]) {
        const rec = structuredClone(b.m.get('kf:x')); Object.assign(rec.kdf, bad); b.m.set('kf:y', { ...rec, id: 'y' });
        await assert.rejects(s.recall({ id: 'y', password: 'p' }), (e) => e.code === 'format', JSON.stringify(bad));
    }
    const rec = structuredClone(b.m.get('kf:x')); rec.iv = rec.iv.slice(0, 8); b.m.set('kf:x', rec);
    await assert.rejects(s.recall({ id: 'x', password: 'p' }), (e) => e.code === 'format', 'IV-Laenge');
});
test('Datensatz unter fremder Kennung / falsches Format / falsche Kennung im Datensatz -> abgelehnt', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'nc:anna:/a.kdbx', name: 'k', keyfile: KEY, password: 'p', params: P });
    const rec = structuredClone(b.m.get('kf:nc:anna:/a.kdbx'));
    b.m.set('kf:nc:bert:/a.kdbx', rec); // unveraendert umkopiert (rec.id zeigt noch auf anna)
    await assert.rejects(s.recall({ id: 'nc:bert:/a.kdbx', password: 'p' }), (e) => e.code === 'format');
    b.m.set('kf:z', { ...rec, id: 'z', format: 'kpnc-keyfile-v0' });
    await assert.rejects(s.recall({ id: 'z', password: 'p' }), (e) => e.code === 'format');
});
test('Unicode: NFC und NFD des gleichen Passworts sind verschiedene Passwoerter (wie bei KeePass/kdbxweb: keine Normalisierung)', async () => {
    const b = mem(), s = createKeyfileStore(b);
    const nfc = 'Käse-é'.normalize('NFC'), nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);
    await s.remember({ id: 'u', name: 'k', keyfile: KEY, password: nfc, params: P });
    assert.deepEqual([...await s.recall({ id: 'u', password: nfc })], [...KEY]);
    await assert.rejects(s.recall({ id: 'u', password: nfd }), (e) => e.code === 'wrong');
});
test('Bereich (scope): Auflisten/Alle vergessen nur fuer passende Kennungen (z. B. nur eigener Nextcloud-Benutzer)', async () => {
    const b = mem(), s = createKeyfileStore(b);
    for (const id of ['nc:anna:/a.kdbx', 'nc-file:anna:x.kdbx', 'nc:bert:/b.kdbx']) await s.remember({ id, name: id, keyfile: KEY, password: 'p', params: P });
    const anna = (id) => id.startsWith('nc:anna:') || id.startsWith('nc-file:anna:');
    assert.deepEqual((await s.list(anna)).map((x) => x.id).sort(), ['nc-file:anna:x.kdbx', 'nc:anna:/a.kdbx']);
    await s.forgetAll(anna);
    assert.deepEqual((await s.list()).map((x) => x.id), ['nc:bert:/b.kdbx'], 'Datensatz von bert bleibt');
});
test('remember ueberschreibt den alten Datensatz (z. B. nach Aenderung des Master-Passworts); altes Passwort passt dann nicht mehr', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'alt', params: P });
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'neu', params: P });
    await assert.rejects(s.recall({ id: 'x', password: 'alt' }), (e) => e.code === 'wrong');
    assert.deepEqual([...await s.recall({ id: 'x', password: 'neu' })], [...KEY]);
    assert.equal((await s.list()).length, 1);
});
test('isWeakerThan erkennt zu schwache (alte) Datensaetze, info() liefert die Parameter', async () => {
    const saved = structuredClone(limits); Object.assign(limits, structuredClone(REAL));
    const db = { kdf: 'Argon2d', memoryKiB: 64 * 1024, iterations: 40 };
    assert.equal(isWeakerThan({ memoryKiB: 64 * 1024, iterations: 16 }, db), true, 'v0.4.0: 64 MiB / 16 statt / 40');
    assert.equal(isWeakerThan({ memoryKiB: 64 * 1024, iterations: 40 }, db), false);
    assert.equal(isWeakerThan({ memoryKiB: 256 * 1024, iterations: 5 }, { kdf: 'Argon2id', memoryKiB: 1024 * 1024, iterations: 5 }), true, 'v0.4.0: 256 MiB statt 1 GiB');
    assert.equal(isWeakerThan(undefined, db), true);
    assert.equal(isWeakerThan(limits.aesKdf, { kdf: 'AES-KDF', iterations: 60000 }), false);
    Object.assign(limits, saved);
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'p', params: P });
    assert.deepEqual((await s.info('x')).kdf, { memoryKiB: 64, iterations: 1 });
});
test('v2 (Server-Geheimwert): Round-Trip; ohne/anderer/falscher Geheimwert; Anzeigename authentisiert', async () => {
    const pep = { id: 'a'.repeat(32), key: crypto.getRandomValues(new Uint8Array(32)) };
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'nc:anna:/a.kdbx', name: 'a.keyx', keyfile: KEY, password: 'pw', params: P, pepper: pep });
    const rec = b.m.get('kf:nc:anna:/a.kdbx');
    assert.equal(rec.format, 'kpnc-keyfile-v2'); assert.equal(rec.pepperId, pep.id);
    assert.ok(!JSON.stringify(rec, (k, v) => (ArrayBuffer.isView(v) ? [...v] : v)).includes(JSON.stringify([...pep.key]).slice(1, -1)), 'Geheimwert nicht im Datensatz');
    assert.deepEqual({ ...(await s.info('nc:anna:/a.kdbx')), created: 0 }, { id: 'nc:anna:/a.kdbx', name: 'a.keyx', created: 0, format: 'kpnc-keyfile-v2', server: true, pepperId: pep.id, kdf: { memoryKiB: 64, iterations: 1 } });
    assert.deepEqual([...await s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw', pepper: pep })], [...KEY]);
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw' }), (e) => e.code === 'pepper', 'ohne Geheimwert');
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw', pepper: { id: 'b'.repeat(32), key: pep.key } }), (e) => e.code === 'revoked', 'erneuert');
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw', pepper: { id: pep.id, key: new Uint8Array(32) } }), (e) => e.code === 'wrong', 'falscher Wert, gleiche Kennung');
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'falsch', pepper: pep }), (e) => e.code === 'wrong');
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw', pepper: { id: pep.id, key: new Uint8Array(16) } }), (e) => e.code === 'pepper', 'kaputter Geheimwert');
    b.m.get('kf:nc:anna:/a.kdbx').name = 'gefaelscht.keyx';
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw', pepper: pep }), (e) => e.code === 'wrong', 'Anzeigename ist im AAD');
    b.m.get('kf:nc:anna:/a.kdbx').name = 'a.keyx'; b.m.get('kf:nc:anna:/a.kdbx').pepperId = 'xyz';
    await assert.rejects(s.recall({ id: 'nc:anna:/a.kdbx', password: 'pw', pepper: pep }), (e) => e.code === 'format');
    await assert.rejects(s.remember({ id: 'y', name: 'k', keyfile: KEY, password: 'pw', params: P, pepper: { id: 'kurz', key: pep.key } }), (e) => e.code === 'pepper');
    assert.deepEqual((await s.list()).map((x) => x.server), [true]);
});
test('v1-Datensatz bleibt mit oder ohne angebotenen Geheimwert lesbar (Umstellung erst nach erfolgreichem Oeffnen)', async () => {
    const b = mem(), s = createKeyfileStore(b);
    await s.remember({ id: 'x', name: 'k', keyfile: KEY, password: 'pw', params: P });
    assert.equal((await s.info('x')).server, false);
    assert.deepEqual([...await s.recall({ id: 'x', password: 'pw', pepper: { id: 'a'.repeat(32), key: new Uint8Array(32) } })], [...KEY]);
});
