import sys
from pykeepass import create_database
pw='Test-Passwort-123'
kp=create_database('ref4.kdbx', password=pw)
print('pykeepass version', kp.version, kp.kdf_algorithm if hasattr(kp,'kdf_algorithm') else '')
g1=kp.add_group(kp.root_group,'Web'); g2=kp.add_group(kp.root_group,'Bank')
e=kp.add_entry(g1,'Mail','alice','pw-eins',url='https://example.org',tags='privat;mail',notes='Notiz äöü €')
e.otp='otpauth://totp/Mail?secret=JBSWY3DPEHPK3PXP'
e.set_custom_property('PIN','1234',protect=True)
e2=kp.add_entry(g2,'Konto','bob','pw-zwei')
e2.add_attachment(kp.add_binary(b'anhang-inhalt\n'),'anhang.txt')
kp.save()
