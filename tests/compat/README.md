# Compatibility tests

The vendored kdbxweb against KeePassXC (`keepassxc-cli`) as the reference: every file kdbxweb writes has to open cleanly in
KeePassXC with the right content, and files KeePassXC writes have to survive kdbxweb.

    npm run test:compat

Covers KDBX 3.1 / 4.0 / 4.1, AES and ChaCha20 x Argon2d / Argon2id / AES-KDF, key files in the formats KeePassXC and KeePass
create, attachments up to 8 MB, repeated saves with history, editing back and forth, merging two diverged copies, and master
passwords with special characters, NFD and emoji. `make-pykeepass-ref.py` builds the reference database with pykeepass.

Note: `keepassxc-cli attachment-export --stdout` mangles binary data, so the tests export to files.
