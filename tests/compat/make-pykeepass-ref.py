import os, sys
from pykeepass import create_database
pw='Test-Passwort-123'
kp=create_database('ref4.kdbx', password=pw)
if os.environ.get('KPNC_CHEAP_KDF'):
    # The e2e suite opens this file about 65 times in the browser and 120 times through keepassxc-cli. Its key derivation is
    # not what those steps test, so they use a cheap one (the steps about Argon2 build their own files).
    kdf = kp.kdbx.header.value.dynamic_header.kdf_parameters.data.dict
    kdf['I'].value = 2
    kdf['M'].value = 8 << 20
print('pykeepass version', kp.version, kp.kdf_algorithm if hasattr(kp,'kdf_algorithm') else '')
g1=kp.add_group(kp.root_group,'Web'); g2=kp.add_group(kp.root_group,'Bank')
e=kp.add_entry(g1,'Mail','alice','pw-eins',url='https://example.org',tags='privat;mail',notes='Notiz äöü €')
e.otp='otpauth://totp/Mail?secret=JBSWY3DPEHPK3PXP'
e.set_custom_property('PIN','1234',protect=True)
e2=kp.add_entry(g2,'Konto','bob','pw-zwei')
e2.add_attachment(kp.add_binary(b'anhang-inhalt\n'),'anhang.txt')
kp.save()
