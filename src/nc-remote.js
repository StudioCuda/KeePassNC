// Standalone page (web/) against a Nextcloud: build the WebDAV addresses from "cloud.example.org", username and app password,
// so nobody has to type /remote.php/dav/files/NAME/... The identifier of a file (remembered key file "dav:<url>",
// offline copy) stays its full WebDAV address as before; an already stored address is kept unchanged for that.
import { DavFile } from './webdav.js';
import { davUrlFor, normalizeUserPath } from './nextcloud.js';

/**
 * Base address of the Nextcloud from an input: "cloud.example.org" -> "https://cloud.example.org"; a pasted-in address
 * is cut off before /remote.php, /index.php, /apps, /login ("https://x.org/nc/index.php/apps/files" -> "https://x.org/nc").
 * Without a scheme https applies, unless it is the page's own host (then its scheme). '' = no usable address.
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
 * Splits the WebDAV address of a file in a Nextcloud (.../remote.php/dav/files/NAME/... or the old .../remote.php/webdav/...):
 * { root, davBase, path, url }; null for other WebDAV servers. url is the input unchanged (it is the identifier).
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
 * WebDAV base of the files (".../remote.php/dav/files/ID"). The ID isn't always the login name (login by email, LDAP),
 * so this asks the server for the account; if it names none, the username applies.
 */
export async function findDavBase(root, user, auth) {
    const href = await new DavFile({ url: root + '/remote.php/dav/', auth }).principal();
    const id = /\/principals\/users\/([^/]+)\/?$/.exec(href || '')?.[1];
    return `${root}/remote.php/dav/files/${id || encodeURIComponent(user)}`;
}

/** Address of the file path under davBase; legacy (parseNcUrl of a stored address) wins if it is the same file. */
export function ncFileUrl(davBase, path, legacy = null) {
    const p = normalizeUserPath(path);
    return legacy && legacy.davBase === davBase && legacy.path === p ? legacy.url : davUrlFor({ davBase }, p);
}
