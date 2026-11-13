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

test('toCsv entschaerft Formeln, wenn gewuenscht', () => {
    // The default stays byte for byte what it was (round trip with our own import, same as KeePassXC)
    assert.equal(toCsv([['=1+1']]), '"=1+1"\r\n');
    const out = toCsv([['=cmd|\' /c calc\'!A1', '+49 30 1234', '-1', '@SUM(A1)', '\tx', '\rx', 'ok', '']], { neutralize: true });
    assert.equal(out, '"\'=cmd|\' /c calc\'!A1","\'+49 30 1234","-1","\'@SUM(A1)","\'\tx","\'\rx","ok",""\r\n');
    assert.equal(toCsv([['-1']], { neutralize: true, keepNumbers: false }), '"\'-1"\r\n');
    assert.equal(toCsv([['-1,5', '-1a']], { neutralize: true }), '"-1,5","\'-1a"\r\n');
});

test('parseCsv: the delimiter comes from the header line (comma, semicolon, tab, pipe), outside quotes only', () => {
    // German Excel ("CSV UTF-8"): BOM, semicolons, CRLF, quotes only where needed, line breaks inside a cell are LF
    const excel = '﻿Group;Title;Username;Password;URL;Notes\r\nPasswords/Bank;Sparkasse Köln;jürgen;"pa;ss""wört";https://sparkasse.de;"Zwei\nZeilen, mit Komma"\r\nPasswords;Müller & Söhne;anna;€uro,1;;Grüße\r\n';
    assert.deepEqual(parseCsv(excel), [['Group', 'Title', 'Username', 'Password', 'URL', 'Notes'],
        ['Passwords/Bank', 'Sparkasse Köln', 'jürgen', 'pa;ss"wört', 'https://sparkasse.de', 'Zwei\nZeilen, mit Komma'], ['Passwords', 'Müller & Söhne', 'anna', '€uro,1', '', 'Grüße']]);
    assert.deepEqual(parseCsv('Title\tUsername\tPassword\nGMX\tbob\tpw,1;2\n"Tab\tin quotes"\t"x"\t'), [['Title', 'Username', 'Password'], ['GMX', 'bob', 'pw,1;2'], ['Tab\tin quotes', 'x', '']]);
    assert.deepEqual(parseCsv('Title|Password\nA|p,w;1'), [['Title', 'Password'], ['A', 'p,w;1']]);
    assert.deepEqual(parseCsv('"Title;a;b","Notes"\nA;B,C'), [['Title;a;b', 'Notes'], ['A;B', 'C']], 'semicolons inside quotes do not count');
    assert.deepEqual(parseCsv('"Title,a,b";"Notes"\nA,B;C'), [['Title,a,b', 'Notes'], ['A,B', 'C']], 'commas inside quotes do not count');
    assert.deepEqual(parseCsv('\r\n\r\nTitle;Password\nA;b'), [['Title', 'Password'], ['A', 'b']], 'leading empty lines are skipped before looking');
    assert.deepEqual(parseCsv('Title,Notes\nA,"x;y;z"\nB,1;2;3'), [['Title', 'Notes'], ['A', 'x;y;z'], ['B', '1;2;3']], 'only the header decides, semicolons in the data do not');
});

test('parseCsv: a tie goes to the comma, a header without any delimiter is one comma column', () => {
    assert.deepEqual(parseCsv('a,b;c\n1,2;3'), [['a', 'b;c'], ['1', '2;3']]);
    assert.deepEqual(parseCsv('a;b\tc|d,e\n1;2\t3|4,5'), [['a;b\tc|d', 'e'], ['1;2\t3|4', '5']]);
    assert.deepEqual(parseCsv('url\nhttps://a.example/?x=1,2'), [['url'], ['https://a.example/?x=1', '2']]);
    assert.deepEqual(parseCsv(''), []);
});

test('parseCsv: a quote inside an unquoted field is a plain character and swallows nothing (like Excel and LibreOffice)', () => {
    const rows = parseCsv('Title,Username,Password,URL\nGMX,bob,pass"word,https://gmx.net\nWeb,eve,pw2,https://web.de\nDisk,carol,5" floppy,\nEnd,dave,pw"","x"');
    assert.deepEqual(rows, [['Title', 'Username', 'Password', 'URL'], ['GMX', 'bob', 'pass"word', 'https://gmx.net'], ['Web', 'eve', 'pw2', 'https://web.de'], ['Disk', 'carol', '5" floppy', ''], ['End', 'dave', 'pw""', 'x']]);
    assert.deepEqual(parseCsv('a;b\nx"y;"q;""r"""\n1;2'), [['a', 'b'], ['x"y', 'q;"r"'], ['1', '2']], 'the same with semicolons');
});

test('parseCsv: a quote that opens a field but never closes is a plain character, the rows after it stay rows', () => {
    assert.deepEqual(parseCsv('Title,Password\nA,"pw\nB,pw2\n'), [['Title', 'Password'], ['A', '"pw'], ['B', 'pw2']]);
    assert.deepEqual(parseCsv('Title,Password\nA,"'), [['Title', 'Password'], ['A', '"']]);
});

test('parseCsv: comma files read exactly as before (quotes after spaces, text after a closing quote, a lone CR)', () => {
    assert.deepEqual(parseCsv('a, "b, c" ,d\n"x"y,z'), [['a', ' b, c ', 'd'], ['xy', 'z']]);
    assert.deepEqual(parseCsv('"a"\r"b"\r\n"c""d"'), [['a'], ['b'], ['c"d']]);
});
