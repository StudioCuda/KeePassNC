import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserPath, davUrlFor, readNextcloudContext } from '../../src/nextcloud.js';
import { ncRoot, parseNcUrl, ncFileUrl } from '../../src/nc-remote.js';

const ctx = { davBase: 'https://c.example/remote.php/dav/files/anna/' };
test('Pfade werden normalisiert', () => {
    assert.equal(normalizeUserPath('Docs//a.kdbx'), '/Docs/a.kdbx');
    assert.equal(normalizeUserPath('\\Docs\\a.kdbx'), '/Docs/a.kdbx');
    assert.equal(normalizeUserPath('  '), '');
});
test('DAV-URL kodiert jedes Segment einzeln (Leerzeichen, Umlaute, # ?)', () => {
    assert.equal(davUrlFor(ctx, '/Passwörter privat/a#b?.kdbx'), 'https://c.example/remote.php/dav/files/anna/Passw%C3%B6rter%20privat/a%23b%3F.kdbx');
});
test('Pfad-Traversal wird abgelehnt', () => {
    assert.throws(() => davUrlFor(ctx, '/a/../../b.kdbx'));
    assert.throws(() => davUrlFor(ctx, './b.kdbx'));
});
test('Kontext nur im Nextcloud-Modus', () => {
    assert.equal(readNextcloudContext({ dataset: {} }), null);
    assert.equal(readNextcloudContext(null), null);
    assert.equal(readNextcloudContext({ dataset: { mode: 'nextcloud', davBase: 'x', csrfUrl: 'y' } }).davBase, 'x');
});

test('Nextcloud-Adresse: Host genuegt, hineinkopierte Adressen werden gekuerzt', () => {
    const here = { host: 'pw.example.org', protocol: 'https:' };
    assert.equal(ncRoot('cloud.example.org', here), 'https://cloud.example.org');
    assert.equal(ncRoot(' https://cloud.example.org/ ', here), 'https://cloud.example.org');
    assert.equal(ncRoot('https://x.org/nc/index.php/apps/files/?dir=/', here), 'https://x.org/nc');
    assert.equal(ncRoot('x.org/nc/remote.php/dav/files/anna/a.kdbx', here), 'https://x.org/nc');
    assert.equal(ncRoot('http://localhost:8080/login', here), 'http://localhost:8080');
    assert.equal(ncRoot('127.0.0.1:9000', { host: '127.0.0.1:9000', protocol: 'http:' }), 'http://127.0.0.1:9000');
    assert.equal(ncRoot('ftp://x.org', here), '');
    assert.equal(ncRoot('https://anna:pw@x.org', here), '');
    assert.equal(ncRoot('', here), '');
});
test('Gespeicherte Adresse: Nextcloud erkannt, Pfad dekodiert, andere WebDAV-Server nicht', () => {
    const a = parseNcUrl('https://x.org/nc/remote.php/dav/files/anna%40x.org/Passw%C3%B6rter%20privat/a.kdbx');
    assert.deepEqual(a, { root: 'https://x.org/nc', davBase: 'https://x.org/nc/remote.php/dav/files/anna%40x.org', path: '/Passwörter privat/a.kdbx',
        url: 'https://x.org/nc/remote.php/dav/files/anna%40x.org/Passw%C3%B6rter%20privat/a.kdbx' });
    assert.equal(parseNcUrl('https://x.org/remote.php/webdav/a.kdbx').davBase, 'https://x.org/remote.php/webdav');
    assert.equal(parseNcUrl('https://dav.example.org/files/a.kdbx'), null);
    assert.equal(parseNcUrl('https://x.org/remote.php/dav/files/anna/a.kdbx?x=1'), null);
    assert.equal(parseNcUrl(''), null);
});
test('Datei-Adresse: eine gespeicherte bleibt Zeichen fuer Zeichen gleich (Kennung), sonst neu gebaut', () => {
    const typed = 'https://x.org/remote.php/dav/files/anna/Passwörter/a b.kdbx'; // as typed by hand, unencoded
    const legacy = parseNcUrl(typed);
    assert.equal(ncFileUrl('https://x.org/remote.php/dav/files/anna', '/Passwörter/a b.kdbx', legacy), typed);
    assert.equal(ncFileUrl('https://x.org/remote.php/dav/files/anna', 'Passwörter//a b.kdbx', legacy), typed);
    assert.equal(ncFileUrl('https://x.org/remote.php/dav/files/anna', '/Passwörter/c.kdbx', legacy), 'https://x.org/remote.php/dav/files/anna/Passw%C3%B6rter/c.kdbx');
    assert.equal(ncFileUrl('https://x.org/remote.php/dav/files/bob', '/Passwörter/a b.kdbx', legacy), 'https://x.org/remote.php/dav/files/bob/Passw%C3%B6rter/a%20b.kdbx');
});
