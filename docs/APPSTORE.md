# Publishing in the Nextcloud App Store

The app id is `keepassnc`. The archive has exactly one top folder `keepassnc`, no `.git`, and `COPYING` inside (the build copies `LICENSE`).

The private key (`keepassnc.key`) stays on the owner's machine. It never goes into the repository, the CI or a chat. Back it up
(for example as an attachment in your own KeePass database): if it's lost, the app has to be registered all over again.

## Once (done)

1. **Certificate.** Create key and request (done for this app, request: nextcloud/app-certificate-requests#1334):
   ```
   mkdir -p ~/.nextcloud/certificates && cd ~/.nextcloud/certificates
   openssl req -nodes -newkey rsa:4096 -keyout keepassnc.key -out keepassnc.csr -subj "/CN=keepassnc"
   ```
   The request goes in as a pull request to `github.com/nextcloud/app-certificate-requests` (file `keepassnc/keepassnc.csr`, link to
   this repo in the description). Keep that repo's PR template, including the AI disclosure, and sign the commit off
   (`git commit -s`), or the DCO check stays red. The signed `keepassnc.crt` comes back in that pull request; put it next to the key.
   Check that the two belong together, both lines must print the same hash:
   ```
   openssl pkey -in keepassnc.key -pubout | openssl sha256
   openssl x509 -in keepassnc.crt -noout -pubkey | openssl sha256
   ```
2. **Register the app** on `apps.nextcloud.com/developer/apps/new` with the certificate and this signature of the app id:
   ```
   echo -n "keepassnc" | openssl dgst -sha512 -sign ~/.nextcloud/certificates/keepassnc.key | openssl base64
   ```

## Every release

1. Raise the version in `package.json`, `package-lock.json` and `nextcloud-app/keepassnc/appinfo/info.xml`, move the `Unreleased`
   part of `nextcloud-app/keepassnc/CHANGELOG.md` under the new version. CI has to be green.
2. Tag the merged `main`: `git tag -a vX.Y.Z -m "KeePassNC X.Y.Z" && git push origin vX.Y.Z`. The release workflow then attaches
   the unsigned archive `keepassnc-X.Y.Z-unsigned.tar.gz` to a GitHub release, for manual installs.
3. Sign and pack. `occ integrity:sign-app` needs a Nextcloud folder with `occ`; it doesn't have to be installed. On Windows this runs
   in WSL (Ubuntu with PHP 8.3, Node 22 and an unpacked release package in `/opt/nc-sign/nextcloud`). Use a fresh clone in the
   WSL home, not a checkout on a Windows drive: `npm ci` fails there with `EPERM ... chmod`, and leftovers would end up in the archive.
   ```
   git clone https://github.com/StudioCuda/KeePassNC.git ~/keepassnc-release && cd ~/keepassnc-release && npm ci
   NC_DIR=/opt/nc-sign/nextcloud KEY=~/.nextcloud/certificates/keepassnc.key CRT=~/.nextcloud/certificates/keepassnc.crt tools/sign-release.sh
   ```
   That writes `keepassnc-<version>.tar.gz` and prints the archive signature for the upload form. If the key lives in the Windows
   user folder, `KEY`/`CRT` point to `/mnt/c/Users/<you>/.nextcloud/certificates/…` instead. The script stops if `occ` didn't sign:
   "Cannot write into config directory" means `/opt/nc-sign/nextcloud` belongs to root, `sudo chown -R $USER /opt/nc-sign/nextcloud`
   fixes it once and for all. Signing again makes a new archive with a new signature; only the latest pair belongs together.
4. Attach that signed archive to the same GitHub release. Not the automatic "Source code" download, its folder name is wrong.
5. On `apps.nextcloud.com/developer/apps/releases/new` enter the download URL of the asset and the signature.

No file in the archive may change after signing.
