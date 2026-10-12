"""Builds a showcase database for the README screenshots: English, made-up services, no real data.
Usage: python3 -I tools/make-showcase.py OUTDIR  ->  OUTDIR/showcase.kdbx + OUTDIR/showcase.json (password + what to click)."""
import base64, json, os, random, sys
from datetime import datetime, timedelta, timezone
from pykeepass import create_database

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
db_path = os.path.join(out, 'showcase.kdbx')
if os.path.exists(db_path):
    os.remove(db_path)
PASSWORD = 'correct horse battery staple'
random.seed(7)
kp = create_database(db_path, password=PASSWORD)
root = kp.root_group
now = datetime.now(timezone.utc)

def strong(n=20):
    chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#%&*+-=?@'
    return ''.join(random.choice(chars) for _ in range(n))

def group(parent, name):
    return kp.add_group(parent, name)

def entry(g, title, user, url, pw=None, notes=None, tags=None, otp=None, expires_in=None):
    e = kp.add_entry(g, title, user, pw or strong(), url=url, notes=notes, tags=tags or [], force_creation=True)
    if otp:
        e.otp = otp
    if expires_in is not None:
        e.expires = True
        e.expiry_time = now + timedelta(days=expires_in)
    return e

personal = group(root, 'Personal')
finance = group(root, 'Finance')
work = group(root, 'Work')
servers = group(work, 'Servers')
clients = group(work, 'Clients')
home = group(root, 'Home & Devices')
travel = group(root, 'Travel')

entry(personal, 'Pebble Mail', 'sam.rivers@example.com', 'https://mail.example.com',
      notes='Recovery codes are printed and in the drawer. Not on the fridge.', tags=['mail', 'important'],
      otp='otpauth://totp/Pebble%20Mail:sam.rivers?secret=JBSWY3DPEHPK3PXP&issuer=Pebble%20Mail')
entry(personal, 'Kite Social', 'samrivers', 'https://kite.example.org', tags=['social'])
entry(personal, 'Sprout Groceries', 'sam.rivers@example.com', 'https://sprout.example.net', tags=['shopping'])
entry(personal, 'Lumen Cloud', 'sam.rivers@example.com', 'https://lumen.example.com', tags=['backup'],
      otp='otpauth://totp/Lumen:sam?secret=GEZDGNBVGY3TQOJQ&issuer=Lumen')
entry(personal, 'Old forum account', 'sammy99', 'https://forum.example.org', pw='sunshine', tags=['legacy'])
entry(personal, 'Book club', 'sam', 'https://books.example.org', pw='sunshine')
pk = entry(personal, 'Juniper Health', 'sam.rivers@example.com', 'https://juniper.example.com', tags=['health'])
for k, v, prot in [('KPEX_PASSKEY_USERNAME', 'sam.rivers@example.com', False),
                   ('KPEX_PASSKEY_CREDENTIAL_ID', base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='), True),
                   ('KPEX_PASSKEY_PRIVATE_KEY_PEM', '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----', True),
                   ('KPEX_PASSKEY_RELYING_PARTY', 'juniper.example.com', False),
                   ('KPEX_PASSKEY_USER_HANDLE', base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip('='), True)]:
    pk.set_custom_property(k, v, protect=prot)

entry(finance, 'Northwind Bank', 'SR-4471-2290', 'https://northwind-bank.example.com',
      notes='Online banking. The PIN letter is in the drawer, not in here.', tags=['bank', 'important'],
      otp='otpauth://totp/Northwind:SR-4471?secret=KRUGS4ZANFZSAYJA&issuer=Northwind&digits=8')
entry(finance, 'Credit card', 'Sam Rivers', 'https://cards.example.com', tags=['bank'], expires_in=-12,
      notes='Card replaced in spring. Update this entry.')
entry(finance, 'Tax portal', 'sam.rivers', 'https://tax.example.gov', expires_in=9, tags=['yearly'])

entry(servers, 'Production database', 'postgres', 'ssh://db.prod.example.net', tags=['prod'],
      notes='Port 5432 only via the bastion host.')
entry(servers, 'Bastion host', 'ops', 'ssh://bastion.example.net', tags=['prod'])
entry(servers, 'Staging', 'deploy', 'https://staging.example.net', tags=['staging'])
entry(work, 'Forge Git', 'srivers', 'https://forge.example.dev', tags=['dev'],
      otp='otpauth://totp/Forge:srivers?secret=MFRGGZDFMZTWQ2LK&issuer=Forge')
entry(work, 'Team chat', 'sam.rivers@work.example', 'https://chat.work.example')
entry(clients, 'Acme Corp portal', 'sam@agency.example', 'https://portal.acme.example')
entry(clients, 'Globex extranet', 'srivers', 'https://extranet.globex.example', expires_in=30)

entry(home, 'Cobalt router', 'admin', 'http://192.168.1.1', notes='Firmware auto-update is on.', tags=['network'])
entry(home, 'Home Wi-Fi', 'Rivers-5G', '', notes='Guest network: Rivers-Guest', tags=['network'])
entry(home, 'Printer', 'admin', 'http://192.168.1.20', pw='admin1', tags=['network'])
entry(home, 'Orbit VPN', 'sam.rivers@example.com', 'https://orbit-vpn.example.com', tags=['network'])

entry(travel, 'Atlas Airlines', 'SR123456', 'https://atlas-air.example.com', notes='Frequent flyer: Silver', tags=['travel'])
entry(travel, 'Harbor Hotels', 'sam.rivers@example.com', 'https://harbor-hotels.example.com', tags=['travel'])

kp.save()
json.dump({'password': PASSWORD, 'picks': {'detail': 'Pebble Mail', 'dark': 'Northwind Bank', 'mobile': 'Juniper Health'}},
          open(os.path.join(out, 'showcase.json'), 'w'))
print(f'{db_path}: {len(kp.entries)} entries')
