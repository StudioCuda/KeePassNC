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

## Once, on your machine (for publishing)

`tools/publish-release.sh` does the signing and the upload in one go. It needs, in WSL:

- Node 22, PHP 8.3, `openssl`, `curl` and the GitHub CLI (`sudo apt install gh`, then `gh auth login` once).
- A Nextcloud folder with `occ` in `/opt/nc-sign/nextcloud` (an unpacked release package, it doesn't have to be installed) that
  belongs to you: `sudo chown -R $USER /opt/nc-sign/nextcloud`. Otherwise `occ` says "Cannot write into config directory".
- Key and certificate in `~/.nextcloud/certificates/` or in the Windows user folder (`C:\Users\<you>\.nextcloud\certificates\`);
  the script looks in both.
- Next to them an App Store API token in a file `keepassnc.appstore-token`. Get it from
  [apps.nextcloud.com/account/token](https://apps.nextcloud.com/account/token). It allows uploading releases, so treat it like the key:
  never in the repository, the CI or a chat.

## Every release

1. **Release pull request.** Raise the version in `package.json`, `package-lock.json` and
   `nextcloud-app/keepassnc/appinfo/info.xml`, move the `Unreleased` part of `nextcloud-app/keepassnc/CHANGELOG.md` under
   `## [X.Y.Z] - YYYY-MM-DD`. If a new Nextcloud major version came out, add it to the CI matrix in
   `.github/workflows/nextcloud.yml` and raise `max-version` in `info.xml` to that version plus two. Merge it.
2. **Tag and GitHub release happen by themselves.** Once the tests on `main` are green, the release workflow tags `vX.Y.Z` and
   creates the GitHub release with the changelog section as text and an unsigned archive, so there's something to download until
   the signed one is there. It refuses if `package.json` and `info.xml` disagree or the changelog section isn't dated. (A tag
   pushed by hand works too.)
3. **Publish.** On Windows double-click `tools\publish-release.cmd`, or in WSL run `tools/publish-release.sh` (optionally with a
   version, e.g. `tools/publish-release.sh 0.7.1`). It checks everything first, clones the tag fresh into the WSL home (not onto a
   Windows drive: `npm ci` fails there with `EPERM ... chmod`), builds, signs, verifies the signature, attaches
   `keepassnc-X.Y.Z.tar.gz` to the GitHub release, checks that GitHub serves exactly that file, removes the unsigned archive and
   registers the release with the App Store API. Nextcloud servers pick the update up after a while.

   Skipping a version in the App Store (say, because the next one is right around the corner)? `tools/sign-github-release.sh`
   (or `tools\sign-github-release.cmd`) does everything above except the App Store part, and needs no token. The GitHub release
   still ends up with the signed archive.

Doing it by hand still works: `tools/sign-release.sh` signs and prints the signature, then attach the archive to the release and
enter its download URL and the signature on `apps.nextcloud.com/developer/apps/releases/new`. Not the automatic "Source code"
download, its folder name is wrong. Then delete the unsigned archive from the release. Signing again makes a new archive with a
new signature; only the latest pair belongs together.

No file in the archive may change after signing.
