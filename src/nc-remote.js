// Eigenstaendige Seite (web/) gegen eine Nextcloud: aus "cloud.example.org", Benutzername und App-Passwort die WebDAV-Adressen
// bauen, damit niemand /remote.php/dav/files/NAME/... tippen muss. Die Kennung einer Datei (gemerkte Schluesseldatei "dav:<url>",
// Offline-Kopie) bleibt ihre volle WebDAV-Adresse wie bisher; eine schon gespeicherte Adresse wird dafuer unveraendert weiterverwendet.
import { DavFile } from './webdav.js';
import { davUrlFor, normalizeUserPath } from './nextcloud.js';

/**
 * Basisadresse der Nextcloud aus einer Eingabe: "cloud.example.org" -> "https://cloud.example.org"; eine hineinkopierte Adresse
 * wird bis vor /remote.php, /index.php, /apps, /login gekuerzt ("https://x.org/nc/index.php/apps/files" -> "https://x.org/nc").
 * Ohne Schema gilt https, ausser es ist der Host der Seite selbst (dann deren Schema). '' = keine brauchbare Adresse.
 */
export function ncRoot(input, here = typeof location !== 'undefined' ? location : null) {
    let s = String(input || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (here && s.split(/[/?#]/)[0].toLowerCase() === here.host.toLowerCase() ? here.protocol : 'https:') + '//' + s;
    let u;
    try { u = new URL(s); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return '';
    return u.origin + u.pathname.replace(/\/(?:remote\.php|index\.php|apps|login)(?:\/.*)?$/, '').replace(/\/+$/, '');
}

/**
 * Zerlegt die WebDAV-Adresse einer Datei in einer Nextcloud (.../remote.php/dav/files/NAME/... oder das alte .../remote.php/webdav/...):
 * { root, davBase, path, url }; null bei anderen WebDAV-Servern. url ist die Eingabe unveraendert (sie ist die Kennung).
 */
export function parseNcUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || u.search || u.hash) return null;
    const m = /^(.*?)\/remote\.php\/(dav\/files\/[^/]+|webdav)(\/.*)?$/.exec(u.pathname);
    if (!m) return null;
    let path;
    try { path = normalizeUserPath(decodeURIComponent(m[3] || '/')); } catch { return null; }
    return { root: u.origin + m[1], davBase: u.origin + m[1] + '/remote.php/' + m[2], path, url: String(url) };
}

/**
 * WebDAV-Basis der Dateien (".../remote.php/dav/files/ID"). Die ID ist nicht immer der Anmeldename (Anmeldung per E-Mail, LDAP),
 * deshalb fragt das den Server nach dem Konto; nennt er keines, gilt der Benutzername.
 */
export async function findDavBase(root, user, auth) {
    const href = await new DavFile({ url: root + '/remote.php/dav/', auth }).principal();
    const id = /\/principals\/users\/([^/]+)\/?$/.exec(href || '')?.[1];
    return `${root}/remote.php/dav/files/${id || encodeURIComponent(user)}`;
}

/** Adresse der Datei path unter davBase; legacy (parseNcUrl einer gespeicherten Adresse) gewinnt, wenn es dieselbe Datei ist. */
export function ncFileUrl(davBase, path, legacy = null) {
    const p = normalizeUserPath(path);
    return legacy && legacy.davBase === davBase && legacy.path === p ? legacy.url : davUrlFor({ davBase }, p);
}
