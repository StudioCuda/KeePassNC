"""Erzeugt eine synthetische "Alltags-Datei" (KDBX4, Argon2, hartes Master-Passwort, XML-v2-Schluesseldatei) mit allem, was im Alltag
und bei anderen Clients (KeePassXC, Strongbox, KeePassDX ...) vorkommt. Keine echten Daten. Aufruf: python3 make-daily.py ZIELVERZEICHNIS
Ausgabe: daily.kdbx, daily.keyx, daily.json (Passwort + erwartete Kennzahlen)."""
import base64, hashlib, json, os, random, subprocess, sys, uuid
from datetime import datetime, timedelta, timezone
from lxml import etree
from pykeepass import PyKeePass

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
db, keyfile, meta = (os.path.join(out, n) for n in ('daily.kdbx', 'daily.keyx', 'daily.json'))
for f in (db, keyfile):
    if os.path.exists(f): os.remove(f)

# Hartes Master-Passwort: Umlaute, Sonderzeichen, Anfuehrungszeichen, Backslash, Euro, CJK, Emoji, kombinierendes Zeichen (NFD), doppelte Leerzeichen
PASSWORD = 'Zähl-Ünï§ "Q\'uote" \\ €uro 日本語 🔐🗝️  é 0O1lI| ;&$`{}'
random.seed(20261011)
now = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)

# 1) Schluesseldatei durch KeePassXC erzeugen lassen (Endung .keyx -> XML v2), Datenbank als KDBX4/Argon2 anlegen
tmpdb = db + '.tmp'
subprocess.run(['keepassxc-cli', 'db-create', '-q', '-p', '--set-key-file', keyfile, '-t', '100', tmpdb], input=f'{PASSWORD}\n{PASSWORD}\n', text=True, check=True, capture_output=True)
os.remove(tmpdb)
from pykeepass import create_database
kp = create_database(db, password=PASSWORD, keyfile=keyfile)
# Argon2d wie bei einem sorgfaeltig eingestellten Alltags-Tresor: 256 MiB, 8 Durchgaenge, 4 Threads
kdf = kp.kdbx.header.value.dynamic_header.kdf_parameters.data.dict
kdf.M.value, kdf.I.value, kdf.P.value = 256 * 1024 * 1024, 8, 4

def child(el, tag, text=None):
    c = etree.SubElement(el, tag)
    if text is not None: c.text = text
    return c

# 2) Gruppenbaum
def grp(parent, name, icon=None, notes=None):
    g = kp.add_group(parent, name, icon=icon, notes=notes); return g
privat = grp(kp.root_group, 'Privat', '48')
sub = {n: grp(privat, n) for n in ['Banken & Versicherungen', 'Shopping', 'Social Media', 'E-Mail', 'Behörden', 'Reisen ✈']}
arbeit = grp(kp.root_group, 'Arbeit', '49', notes='Berufliche Zugänge')
server = grp(arbeit, 'Server'); prod = grp(server, 'Prod'); test = grp(server, 'Test')
kunden = grp(arbeit, 'Kunden'); kunden_g = {n: grp(kunden, f'Kunde {n}') for n in 'ABCDE'}
wlan = grp(kp.root_group, 'WLAN & Geräte'); lizenzen = grp(kp.root_group, 'Lizenzen'); notizen = grp(kp.root_group, 'Sichere Notizen', '37')
tiefe = notizen
for i in range(6): tiefe = grp(tiefe, f'Ebene {i + 1}')  # tief verschachtelt

words = 'Haus Baum Wolke Fluss Stern Brücke Garten Mond Feder Anker Pilz Turm Insel Nebel Quelle'.split()
tld = ['example.org', 'example.com', 'beispiel.at', 'test.invalid']
def pw(n=None):
    n = n or random.choice([12, 16, 20, 24, 32])
    return ''.join(random.choice('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*-_+?') for _ in range(n))
def mk(group, title, user, **kw):
    kw.setdefault('password', pw()); kw.setdefault('url', f'https://{title.split()[0].lower()}.{random.choice(tld)}/login')
    return kp.add_entry(group, title, user, kw.pop('password'), force_creation=True, **kw)

entries = []
fixed = {'Privat/E-Mail': ['Posteo', 'Gmail', 'Outlook', 'ProtonMail', 'Fastmail', 'Uni-Mail'],
         'Privat/Shopping': ['Amazon', 'Zalando', 'eBay', 'Otto', 'IKEA', 'MediaMarkt', 'Etsy'],
         'Privat/Social Media': ['Mastodon', 'LinkedIn', 'Xing', 'Reddit', 'Discord', 'Signal', 'Telegram'],
         'Privat/Banken & Versicherungen': ['Hausbank Online', 'Kreditkarte', 'PayPal', 'Krankenkasse', 'KFZ-Versicherung', 'Depot']}
by_path = {'Privat/E-Mail': sub['E-Mail'], 'Privat/Shopping': sub['Shopping'], 'Privat/Social Media': sub['Social Media'], 'Privat/Banken & Versicherungen': sub['Banken & Versicherungen']}
for path, titles in fixed.items():
    for t in titles:
        entries.append(mk(by_path[path], t, random.choice(['anna.beispiel', 'a.muster@example.org', 'anna_92', 'Anna Muster'])))
for g, label in [(prod, 'srv-prod'), (test, 'srv-test')]:
    for i in range(1, 13): entries.append(mk(g, f'{label}-{i:02d}', random.choice(['root', 'admin', 'deploy']), url=f'ssh://{label}-{i:02d}.intern.example.org'))
for n, g in kunden_g.items():
    for i in range(1, 9): entries.append(mk(g, f'Kunde {n} – Portal {i}', f'user{i}@kunde-{n.lower()}.example.com'))
for i in range(1, 25): entries.append(mk(wlan, f'WLAN {random.choice(words)}{i}', 'wlan', url='', notes='SSID und Standort siehe Notiz\nZeile 2'))
for i in range(1, 21): entries.append(mk(lizenzen, f'Lizenz {random.choice(words)} {i}', 'lizenz@example.org', url='', notes=f'Key: {uuid.UUID(int=random.getrandbits(128))}'))
for i in range(1, 18): entries.append(mk(tiefe, f'Notiz {i}', '', password='', url='', notes='Vertraulich ' * random.randint(1, 20)))

# Sonderfaelle -----------------------------------------------------------------------------------------------------------------------
sp = {}
sp['probe'] = mk(sub['Behörden'], 'Fidelity-Probe', 'probe', notes='Wird vom Test geaendert')
sp['langpw'] = mk(sub['Reisen ✈'], 'Sehr langes Passwort', 'lang', password=pw(1000))
sp['unicode'] = mk(sub['Reisen ✈'], 'Unicode', 'üser@exämple.org', password='pä§§wörd €"\'<>&', tags='ünï;日本語;emoji🔐', notes='Zeile1\nZeile2\r\nZeile3\tTab\n' + 'x' * 20000)
sp['unicode'].title = 'Ünïcödé 日本語 🔐 "Titel" <&>'  # nach dem Anlegen setzen (pykeepass-XPath verträgt keine Anführungszeichen)
sp['totp'] = mk(sub['E-Mail'], 'Mit TOTP (otp)', 'totp', url='https://totp.example.org')
sp['totp'].otp = 'otpauth://totp/Beispiel:anna?secret=JBSWY3DPEHPK3PXP&issuer=Beispiel&algorithm=SHA256&digits=8&period=45'
sp['legacy'] = mk(sub['E-Mail'], 'Mit TOTP (alt)', 'legacy'); sp['legacy'].set_custom_property('TOTP Seed', 'JBSWY3DPEHPK3PXP', protect=True); sp['legacy'].set_custom_property('TOTP Settings', '30;6')
sp['custom'] = mk(sub['Banken & Versicherungen'], 'Viele Zusatzfelder', 'felder')
for i in range(30): sp['custom'].set_custom_property(f'Feld {i:02d}', f'Wert {i} äöü', protect=(i % 3 == 0))
# Anhaenge (Text, Binaer 150 KB, gemeinsam genutzt von zwei Eintraegen)
blob = random.Random(7).randbytes(150_000)
b_txt = kp.add_binary(b'Hallo Anhang\nZeile 2\n'); b_big = kp.add_binary(blob)
sp['att1'] = mk(prod, 'Mit Anhaengen', 'att'); sp['att1'].add_attachment(b_txt, 'notiz.txt'); sp['att1'].add_attachment(b_big, 'zufall.bin')
sp['att2'] = mk(prod, 'Teilt Anhang', 'att2'); sp['att2'].add_attachment(b_big, 'zufall-kopie.bin')
# Ablauf
sp['expired'] = mk(sub['Shopping'], 'Abgelaufener Eintrag', 'alt'); sp['expired'].expires = True; sp['expired'].expiry_time = now - timedelta(days=40)
sp['soon'] = mk(sub['Shopping'], 'Laeuft bald ab', 'bald'); sp['soon'].expires = True; sp['soon'].expiry_time = now + timedelta(days=5)
sp['later'] = mk(sub['Shopping'], 'Laeuft in einem Jahr ab', 'spaeter'); sp['later'].expires = True; sp['later'].expiry_time = now + timedelta(days=365)
# Doppelte/schwache Passwoerter fuer den Bericht
for i in range(3): mk(sub['Social Media'], f'Gleiches Passwort {i}', 'dup', password='Sommer2020')
mk(sub['Social Media'], 'Schwach', 'schwach', password='123456')
# Verlauf (5 Staende)
h = mk(sub['Banken & Versicherungen'], 'Mit Verlauf', 'hist', password='v0')
for i in range(1, 6):
    h.save_history(); h.password = f'v{i}-{pw(10)}'; h.notes = f'Stand {i}'
# Passkey-Eintrag (KeePassXC-Attribute)
pk = mk(sub['Social Media'], 'Passkey example.org', 'anna@example.org', url='https://example.org')
for k, v, prot in [('KPEX_PASSKEY_USERNAME', 'anna@example.org', False), ('KPEX_PASSKEY_CREDENTIAL_ID', base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='), True),
                   ('KPEX_PASSKEY_PRIVATE_KEY_PEM', '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----', True),
                   ('KPEX_PASSKEY_RELYING_PARTY', 'example.org', False), ('KPEX_PASSKEY_USER_HANDLE', base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip('='), True),
                   ('KPEX_PASSKEY_FLAG_BE', '1', False), ('KPEX_PASSKEY_FLAG_BS', '1', False)]:
    pk.set_custom_property(k, v, protect=prot)
sp['passkey'] = pk
# Browser-Integration-Attribute (KeePassXC-Browser / KeePassHTTP)
br = mk(sub['Shopping'], 'Browser-Daten', 'br'); br.set_custom_property('KPH: zusaetzliche URL', 'https://alt.example.org'); sp['browser'] = br
# Farben, Icons, CustomData, Auto-Type, QualityCheck, Override-URL (rohes XML)
def el(e): return e._element
for e, fg, bg in [(sp['expired'], '#ffffff', '#cc0000'), (sp['soon'], '#000000', '#ffcc00')]:
    child(el(e), 'ForegroundColor', fg); child(el(e), 'BackgroundColor', bg)
child(el(sp['langpw']), 'OverrideURL', 'cmd://firefox --private-window {URL}')
cd = child(el(sp['totp']), 'CustomData'); it = child(cd, 'Item'); child(it, 'Key', 'KPXC_BROWSER_extra'); child(it, 'Value', 'Wert-1')
at = el(sp['unicode']).find('AutoType')
if at is None: at = child(el(sp['unicode']), 'AutoType')
for c in list(at): at.remove(c)
child(at, 'Enabled', 'True'); child(at, 'DataTransferObfuscation', '0'); child(at, 'DefaultSequence', '{USERNAME}{TAB}{PASSWORD}{ENTER}')
a = child(at, 'Association'); child(a, 'Window', 'Mozilla Firefox*'); child(a, 'KeystrokeSequence', '{PASSWORD}{ENTER}')
# Meta: eigene Icons, CustomData (inkl. gespeicherte Suche), Papierkorb-Eintraege
tree = kp.tree; metael = tree.find('Meta')
ci = metael.find('CustomIcons')
if ci is None: ci = etree.SubElement(metael, 'CustomIcons')
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
icon_uuid = base64.b64encode(os.urandom(16)).decode()
ic = etree.SubElement(ci, 'Icon'); child(ic, 'UUID', icon_uuid); child(ic, 'Data', base64.b64encode(png).decode())
child(el(sp['browser']), 'CustomIconUUID', icon_uuid)
cdm = metael.find('CustomData')
if cdm is None: cdm = etree.SubElement(metael, 'CustomData')
it = etree.SubElement(cdm, 'Item'); child(it, 'Key', 'KPXC_SavedSearch'); child(it, 'Value', json.dumps({'Abgelaufen': 'is:expired'}))
it = etree.SubElement(cdm, 'Item'); child(it, 'Key', '_custom_marker'); child(it, 'Value', 'bleibt erhalten')
rb = kp.find_groups(name='Recycle Bin', first=True) or grp(kp.root_group, 'Recycle Bin', '43')
for i in range(3): mk(rb, f'Geloescht {i}', 'weg')
kp.save()

# 3) Durch KeePassXC schicken (normalisiert das Format wie ein echter KeePassXC-Alltagsstand) und Kennzahlen festhalten
subprocess.run(['keepassxc-cli', 'edit', '-q', '-k', keyfile, db, 'Privat/Behörden/Fidelity-Probe', '--notes', 'Wird vom Test geaendert'], input=PASSWORD + '\n', text=True, check=True, capture_output=True)
lst = subprocess.run(['keepassxc-cli', 'ls', '-R', '-f', '-k', keyfile, db], input=PASSWORD + '\n', text=True, check=True, capture_output=True).stdout.splitlines()
n_entries = sum(1 for l in lst if l and not l.endswith('/'))
json.dump({'password': PASSWORD, 'keyfile': 'daily.keyx', 'entries': n_entries, 'probe_path': 'Privat/Behörden/Fidelity-Probe'}, open(meta, 'w'), ensure_ascii=False, indent=1)
print(f'{db}: {n_entries} Eintraege, {os.path.getsize(db)} Bytes')
