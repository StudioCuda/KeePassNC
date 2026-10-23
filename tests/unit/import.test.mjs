import test from 'node:test';
import assert from 'node:assert/strict';
import { readImport, ImportError } from '../../src/core/import.js';

const NIL = '00000000-0000-0000-0000-000000000000';
const b64 = (s) => Buffer.from(s).toString('base64');

test('Nextcloud Passwords (Datenbank-Backup): Ordnerpfad ueber die Eltern, Tags ueber die Id, Zusatzfelder, Aenderungsdatum', () => {
    const backup = JSON.stringify({
        version: 2, encrypted: false,
        folders: [{ id: 'f1', label: 'Work', parent: NIL }, { id: 'f2', label: 'Development', parent: 'f1' }],
        tags: [{ id: 't1', label: 'Social', color: '#3498db' }, { id: 't2', label: 'Community' }],
        passwords: [
            { id: 'p1', label: 'GitLab', username: 'anna', password: 'pw1', url: 'https://git.example.org', notes: 'Notiz', folder: 'f2', tags: ['t1', 't2'], favorite: true, edited: 1506026474,
                customFields: [{ label: 'E-Mail', type: 'email', value: 'a@x.org' }, { label: 'PIN', type: 'secret', value: '1234' }, { label: 'Leer', type: 'text', value: '' }] },
            { id: 'p2', label: '', username: '', password: 'pw2', url: 'https://www.example.org/login', notes: '', folder: NIL, tags: [], customFields: [] }
        ]
    });
    const { format, entries, ignored, refs, files } = readImport(backup);
    assert.equal(format, 'passwords-json');
    assert.deepEqual([ignored, refs, files], [[], 0, 0]);
    const [a, b] = entries;
    assert.deepEqual([a.path, a.title, a.user, a.password, a.url, a.notes, a.tags], [['Work', 'Development'], 'GitLab', 'anna', 'pw1', 'https://git.example.org', 'Notiz', ['Social', 'Community']]);
    assert.deepEqual(a.custom, [{ name: 'E-Mail', value: 'a@x.org', protect: false }, { name: 'PIN', value: '1234', protect: true }], 'ein leeres Feld faellt weg, "secret" ist geschuetzt');
    assert.equal(a.modified.toISOString(), '2017-09-21T20:41:14.000Z');
    assert.deepEqual([b.path, b.title], [[], 'www.example.org'], 'oberste Ebene, Titel aus der Adresse');
});

test('Nextcloud Passwords: ein Backup mit Passwort wird abgewiesen, Ordner-Schleifen und fehlende Eltern haengen nichts auf', () => {
    assert.throws(() => readImport(JSON.stringify({ version: 2, encrypted: true, passwords: [] })), (e) => e instanceof ImportError && e.key === 'import.encrypted');
    const loop = readImport(JSON.stringify({ encrypted: false, folders: [{ id: 'a', label: 'A', parent: 'b' }, { id: 'b', label: 'B', parent: 'a' }, { id: 'c', label: 'C', parent: 'gibt-es-nicht' }],
        passwords: [{ id: '1', label: 'x', folder: 'a', password: 'p' }, { id: '2', label: 'y', folder: 'c', password: 'p' }, { id: '3', label: 'z', folder: 'unbekannt', password: 'p' }] }));
    assert.equal(loop.entries.length, 3);
    assert.deepEqual(loop.entries[1].path, ['C']);
    assert.deepEqual(loop.entries[2].path, []);
});

test('Passman (JSON): Tags, Beschreibung, E-Mail, Dateien als Anhang, Papierkorb bleibt draussen, OTP-Geheimnis', () => {
    const passman = JSON.stringify([
        { credential_id: 1, label: 'Facebook', username: 'zuck', email: 'z@x.org', password: 'pw', url: 'https://facebook.com', description: 'Notiz', tags: [{ text: 'Social' }, { text: 'Community' }],
            files: [{ filename: 'bild.png', file_data: 'data:image/png;base64,' + b64('PNGDATA') }, { filename: 'kaputt.bin', file_data: 'kein data-url' }],
            custom_fields: [{ label: 'PIN', value: '4711', secret: true }, { label: 'Datei', value: { file_id: 3 }, secret: false }], otp: { secret: 'JBSWY3DP' }, created: 1520188626, changed: 1520188700, delete_time: 0 },
        { credential_id: 2, label: 'Nur E-Mail', username: '', email: 'n@x.org', password: 'pw2', url: '', description: '', tags: [], files: [], custom_fields: [], otp: {} },
        { credential_id: 3, label: 'Im Papierkorb', username: 'x', password: 'pw3', delete_time: 1520188999, files: [], tags: [] }
    ]);
    const { format, entries, files } = readImport(passman);
    assert.equal(format, 'passman-json');
    assert.equal(entries.length, 2, 'der Eintrag im Passman-Papierkorb kommt nicht mit');
    const [a, b] = entries;
    assert.deepEqual([a.title, a.user, a.notes, a.tags, a.totp], ['Facebook', 'zuck', 'Notiz', ['Social', 'Community'], 'JBSWY3DP']);
    assert.deepEqual(a.custom, [{ name: 'E-Mail', value: 'z@x.org', protect: false }, { name: 'PIN', value: '4711', protect: true }], 'E-Mail nur als Feld, wenn es auch einen Benutzernamen gibt; Datei-Felder fallen weg');
    assert.equal(a.attachments.length, 1);
    assert.deepEqual([a.attachments[0].name, Buffer.from(a.attachments[0].data).toString()], ['bild.png', 'PNGDATA']);
    assert.equal(files, 1, 'ein Anhang ohne lesbare Daten wird gezaehlt');
    assert.equal(a.created.getTime(), 1520188626000);
    assert.deepEqual([b.user, b.custom, b.totp], ['n@x.org', [], ''], 'ohne Benutzernamen dient die E-Mail als Benutzer');
});

test('Bitwarden (JSON): Ordner mit / sind Unterordner, weitere Adressen und Felder werden Zusatzfelder, Karten/Notizen/Identitaeten kommen mit', () => {
    const bw = JSON.stringify({
        encrypted: false, folders: [{ id: 'f1', name: 'Arbeit/Server' }, { id: 'f2', name: 'Privat' }],
        items: [
            { type: 1, folderId: 'f1', name: 'NAS', notes: 'n', favorite: true, fields: [{ name: 'Frage', value: 'Hund', type: 0 }, { name: 'Geheim', value: 'x', type: 1 }, { name: 'Haken', value: 'true', type: 2 }],
                login: { uris: [{ uri: 'https://nas.local' }, { uri: 'https://nas2.local' }], username: 'admin', password: 'pw', totp: 'JBSWY3DP' } },
            { type: 2, folderId: null, name: 'Notiz', notes: 'Text', secureNote: { type: 0 } },
            { type: 3, folderId: 'f2', name: 'Karte', card: { cardholderName: 'Anna', brand: 'Visa', number: '4111', expMonth: '4', expYear: '2030', code: '123' } },
            { type: 4, folderId: null, name: 'Ich', identity: { firstName: 'Anna', ssn: '123', email: null } },
            { type: 1, folderId: null, name: 'Leer', login: { username: null, password: null, totp: null } }
        ]
    });
    const { format, entries } = readImport(bw);
    assert.equal(format, 'bitwarden-json');
    const [nas, note, card, ident, empty] = entries;
    assert.deepEqual([nas.path, nas.title, nas.user, nas.password, nas.url, nas.totp, nas.notes], [['Arbeit', 'Server'], 'NAS', 'admin', 'pw', 'https://nas.local', 'JBSWY3DP', 'n']);
    assert.deepEqual(nas.custom, [{ name: 'URL 2', value: 'https://nas2.local', protect: false }, { name: 'Frage', value: 'Hund', protect: false }, { name: 'Geheim', value: 'x', protect: true }, { name: 'Haken', value: 'true', protect: false }]);
    assert.deepEqual([note.path, note.title, note.notes, note.password], [[], 'Notiz', 'Text', '']);
    assert.deepEqual(card.custom.filter((c) => c.protect).map((c) => c.name), ['number', 'code'], 'Kartennummer und Code sind geschuetzt');
    assert.deepEqual(ident.custom, [{ name: 'firstName', value: 'Anna', protect: false }, { name: 'ssn', value: '123', protect: true }], 'leere Werte fallen weg');
    assert.deepEqual([empty.title, empty.user, empty.password], ['Leer', '', '']);
    assert.throws(() => readImport(JSON.stringify({ encrypted: true, items: [] })), (e) => e.key === 'import.encrypted');
});

test('JSON: {REF:...} aus fremden Dateien wird zu Text und gezaehlt (je Eintrag einmal)', () => {
    const { entries, refs } = readImport(JSON.stringify({ encrypted: false, folders: [], tags: [], passwords: [
        { id: '1', label: 'X', username: 'u', password: '{REF:P@T:Bank}', url: 'https://e.example/?p={ref:P@T:Bank}', notes: '', folder: NIL, tags: [], customFields: [{ label: 'F', type: 'text', value: '{REF:U@T:Bank}' }] },
        { id: '2', label: 'Y', username: 'u', password: 'pw', url: '', notes: '', folder: NIL, tags: [], customFields: [] }] }));
    assert.equal(refs, 1);
    assert.deepEqual([entries[0].password, entries[0].url, entries[0].custom[0].value], ['{ REF:P@T:Bank}', 'https://e.example/?p={ REF:P@T:Bank}', '{ REF:U@T:Bank}']);
    assert.equal(entries[1].password, 'pw');
});

test('JSON: Unlesbares und Unbekanntes bekommt eine verstaendliche Meldung', () => {
    assert.throws(() => readImport('{ das ist kein json'), (e) => e instanceof ImportError && e.key === 'import.badjson');
    assert.throws(() => readImport('{"hallo": "welt"}'), (e) => e.key === 'import.unknownjson');
    assert.throws(() => readImport('[{"a": 1}]'), (e) => e.key === 'import.unknownjson');
    assert.deepEqual(readImport('﻿  [] ').entries, [], 'eine leere Passman-Liste ist leer, kein Fehler (und eine BOM stoert nicht)');
});

test('CSV: Nextcloud Passwords (deutsche Spaltenkoepfe), Ordner als Gruppe, Rest wird als ausgelassen gemeldet', () => {
    const csv = '"Name","Benutzer","Passwort","Notizen","Webseite","Ordner","Tags","Favorit","Bearbeitet am","Id","Version","Ordner Id"\n'
        + '"Facebook","zuck","pw","","https://www.facebook.com","Social Media","Social,Community","nein","Thu Sep 21 2017","c9b1","93d1","2bca"';
    const { entries, ignored, format } = readImport(csv);
    assert.equal(format, undefined);
    assert.deepEqual([entries[0].path, entries[0].title, entries[0].user, entries[0].password, entries[0].url, entries[0].tags], [['Social Media'], 'Facebook', 'zuck', 'pw', 'https://www.facebook.com', ['Social', 'Community']]);
    assert.deepEqual(ignored, ['Favorit', 'Bearbeitet am', 'Id', 'Version', 'Ordner Id']);
});

test('CSV: Passman (label, description, [Tags], "null" als E-Mail, leere Listen sind keine ausgelassenen Spalten)', () => {
    const csv = 'label,username,password,email,description,tags,url,custom_fields,files\nFacebook,zuck,pw,null,Notiz,"[Social,Community]",https://facebook.com,[],[]\nNur Mail,,pw2,n@x.org,,[],,[],[]';
    const { entries, ignored } = readImport(csv);
    assert.deepEqual([entries[0].title, entries[0].user, entries[0].notes, entries[0].tags], ['Facebook', 'zuck', 'Notiz', ['Social', 'Community']]);
    assert.deepEqual([entries[1].user, entries[1].tags], ['n@x.org', []]);
    assert.deepEqual(ignored, []);
});
