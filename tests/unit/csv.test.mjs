import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, mapRows, otpUri, defangRefs, titleOrHost } from '../../src/core/csv.js';
import { toOtpUri } from '../../src/core/util.js';

test('parseCsv: Anfuehrungszeichen, Kommas und Zeilenumbrueche in Feldern, CRLF, BOM, leere Zeilen', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","sagt ""hallo""","zwei\nZeilen"\r\n\r\n,,ende');
    assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'sagt "hallo"', 'zwei\nZeilen'], ['', '', 'ende']]);
});

test('toCsv -> parseCsv ergibt dasselbe', () => {
    const rows = [['Group', 'Title'], ['Root/Web', 'Mail "privat", alt\nzweite Zeile'], ['', '']];
    assert.deepEqual(parseCsv(toCsv(rows)), rows.slice(0, 2)); // a completely empty line is dropped when reading
    assert.equal(toCsv([['a"b']]), '"a""b"\r\n');
});

const one = (csv) => mapRows(parseCsv(csv)).entries[0];

test('mapRows: KeePassXC (Wurzelgruppe faellt weg, Unterordner bleiben)', () => {
    const csv = '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n"Passwords/Web/Mail","GMX","bob","pw","https://gmx.net","n","otpauth://totp/x?secret=ABC","0","",""';
    assert.deepEqual(one(csv), { path: ['Web', 'Mail'], title: 'GMX', user: 'bob', password: 'pw', url: 'https://gmx.net', notes: 'n', totp: 'otpauth://totp/x?secret=ABC', tags: [] });
    assert.deepEqual(mapRows(parseCsv(csv)).ignored, ['Icon']);
});

test('mapRows: Bitwarden, Chrome, Firefox (Titel aus der URL), 1Password, KeePass 2', () => {
    const bw = one('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nArbeit/Server,,login,NAS,,,0,https://nas.local,admin,geheim,JBSWY3DP');
    assert.deepEqual([bw.path, bw.title, bw.user, bw.password, bw.url, bw.totp], [['Arbeit', 'Server'], 'NAS', 'admin', 'geheim', 'https://nas.local', 'JBSWY3DP']);
    const chrome = one('name,url,username,password,note\nexample.org,https://example.org/login,alice,pw1,Notiz');
    assert.deepEqual([chrome.title, chrome.notes, chrome.path], ['example.org', 'Notiz', []]);
    const ff = one('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://www.mozilla.org","carol","pw2",,"https://www.mozilla.org","{1}","1","2","3"');
    assert.deepEqual([ff.title, ff.user, ff.password], ['www.mozilla.org', 'carol', 'pw2']);
    const op = one('Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nBank,bank.example,dave,pw3,,false,false,"geld;wichtig",');
    assert.deepEqual([op.title, op.url, op.tags], ['Bank', 'bank.example', ['geld', 'wichtig']]);
    const kp2 = one('"Account","Login Name","Password","Web Site","Comments"\n"Forum","eve","pw4","forum.example","alt"');
    assert.deepEqual([kp2.title, kp2.user, kp2.password, kp2.url, kp2.notes], ['Forum', 'eve', 'pw4', 'forum.example', 'alt']);
});

test('mapRows: Proton Pass (Tresor als Gruppe, E-Mail nur wenn der Benutzername fehlt)', () => {
    const { entries } = mapRows(parseCsv('type,name,url,email,username,password,note,totp,vault\nlogin,A,https://a.example,a@x.org,,pw,,,Privat\nlogin,B,https://b.example,b@x.org,bob,pw,,,Privat'));
    assert.deepEqual(entries.map((e) => [e.path, e.user]), [[['Privat'], 'a@x.org'], [['Privat'], 'bob']]);
});

test('mapRows: {REF:...} aus fremden Dateien wird zu Text und gezaehlt', () => {
    const { entries, refs } = mapRows(parseCsv('Title,Username,Password,URL,Notes\nX,u,{REF:P@T:Bank},https://e.example/?p={ref:P@T:Bank},n\nY,u,pw,,'));
    assert.equal(refs, 1);
    assert.deepEqual([entries[0].password, entries[0].url], ['{ REF:P@T:Bank}', 'https://e.example/?p={ REF:P@T:Bank}']);
    assert.equal(entries[1].password, 'pw');
});

test('otpUri: Feld "otp" geht vor, alte Felder (auch Steam) werden zur otpauth-URI', () => {
    assert.equal(otpUri('A', 'otpauth://totp/A?secret=X', 'Y', ''), 'otpauth://totp/A?secret=X');
    assert.equal(otpUri('Mein Konto', '', 'JBSW Y3DP', '60;8'), 'otpauth://totp/Mein%20Konto?secret=JBSWY3DP&period=60&digits=8');
    assert.equal(otpUri('S', '', 'ABC', '30;S'), 'otpauth://totp/S?secret=ABC&period=30&digits=5&encoder=steam');
    assert.equal(otpUri('A', '', '', ''), '');
});

test('defangRefs and titleOrHost: shared by every importer', () => {
    assert.equal(defangRefs('{REF:P@T:Bank} and {ref:U@T:Bank}'), '{ REF:P@T:Bank} and { REF:U@T:Bank}');
    assert.equal(defangRefs('plain'), 'plain');
    assert.deepEqual([titleOrHost('Own title', 'https://a.example'), titleOrHost('', 'https://www.a.example/x'), titleOrHost('', 'a.example/login'), titleOrHost('', ''), titleOrHost('', 'http://')], ['Own title', 'www.a.example', 'a.example', '', 'http://']);
});

test('toOtpUri: a full URI stays, a bare secret is completed like KeePassXC does', () => {
    assert.equal(toOtpUri('otpauth://totp/A?secret=X', 'A', 'u'), 'otpauth://totp/A?secret=X');
    assert.equal(toOtpUri(' jbsw y3dp-epHK ', 'Mail', 'anna@x.org'), 'otpauth://totp/Mail:anna%40x.org?secret=JBSWY3DPEPHK&period=30&digits=6&issuer=Mail');
    assert.equal(toOtpUri('JBSWY3DP', '', ''), 'otpauth://totp/KeePassNC?secret=JBSWY3DP&period=30&digits=6&issuer=KeePassNC');
    assert.equal(toOtpUri('  ', 'A', ''), '');
});
