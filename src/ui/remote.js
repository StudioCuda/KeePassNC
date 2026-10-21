// Standalone page (without the Nextcloud app): fields for your own Nextcloud (address, username, app password) and, via
// "Own WebDAV address", the previous field for other WebDAV servers. Shared by login and "New database".
// A saved address (pref 'url') stays the identifier of the file: if it points into a Nextcloud, it prefills address and path
// and is reused unchanged as long as it's the same file (remembered key file, offline copy).
import { basicAuth, isOffline } from '../webdav.js';
import { ncRoot, parseNcUrl, findDavBase, ncFileUrl } from '../nc-remote.js';
import { VaultError } from '../vault.js';
import { t } from '../i18n.js';
import { h } from './dom.js';
import { params, pref } from './ctx.js';

/**
 * prefix: "dav" (login) or "new"; urlValue/urlPlaceholder/urlLabel for the WebDAV field; onMode(mode) after every switch
 * ('nc' | 'url'); onFound() when the WebDAV base comes from the server for the first time (the identifier can change with it).
 */
export function remoteFields(prefix, { urlValue = '', urlPlaceholder = '', urlLabel = 'login.dav.url', onMode, onFound } = {}) {
    const start = params.get('url') || pref('url');
    const legacy = parseNcUrl(start);
    const legacyUser = params.get('user') || pref('user');
    let mode = params.get('url') ? (legacy ? 'nc' : 'url') : pref('davmode') || (start && !legacy ? 'url' : 'nc');
    const server = h('input', { id: `${prefix}-server`, type: 'text', inputmode: 'url', placeholder: 'cloud.example.org', value: legacy ? legacy.root.replace(/^https:\/\//, '') : '',
        autocomplete: 'url', spellcheck: 'false', autocapitalize: 'off' });
    const url = h('input', { id: `${prefix}-url`, type: 'url', placeholder: urlPlaceholder, value: urlValue, autocomplete: 'off' });
    const user = h('input', { id: `${prefix}-user`, type: 'text', value: legacyUser, autocomplete: 'username', autocapitalize: 'off' });
    const pass = h('input', { id: `${prefix}-pass`, type: 'password', autocomplete: 'current-password' });
    const serverBox = h('label', {}, h('span', { text: t('login.nc.server') }), server);
    const urlBox = h('label', {}, h('span', { text: t(urlLabel) }), url);
    const creds = h('div', { class: 'grid2' }, h('label', {}, h('span', { text: t('login.dav.user') }), user), h('label', {}, h('span', { text: t('login.dav.pass') }), pass));
    const toggle = h('button', { type: 'button', class: 'link', id: `${prefix}-davmode`, onclick: () => { setMode(mode === 'nc' ? 'url' : 'nc'); (mode === 'nc' ? server : url).focus(); } });
    const foot = h('div', { class: 'stack tight' }, h('p', { class: 'hint', text: t('login.dav.hint') }), h('p', { class: 'hint' }, toggle));
    function setMode(m) {
        mode = m;
        serverBox.hidden = m !== 'nc'; urlBox.hidden = m !== 'url';
        toggle.textContent = t(m === 'nc' ? 'login.dav.custom' : 'login.dav.ncaddr');
        onMode?.(m);
    }

    const root = () => ncRoot(server.value);
    const key = (...a) => a.join('\n');
    const fromLegacy = (r, u) => (legacy && legacy.root === r && legacyUser === u ? legacy.davBase : '');
    const found = new Map(), bases = new Map();
    const guessFor = (r, u) => fromLegacy(r, u) || bases.get(key(r, u)) || `${r}/remote.php/dav/files/${encodeURIComponent(u)}`;
    return {
        server, url, user, pass, serverBox, urlBox, creds, foot, legacy,
        mode: () => mode, setMode, root,
        /** Address, username and app password entered. */
        ready: () => !!(root() && user.value && pass.value),
        auth: () => basicAuth(user.value, pass.value),
        /** WebDAV base without network (for the identifier while typing): saved address, already found, otherwise derived from the username. */
        guess() { const r = root(); return r && user.value ? guessFor(r, user.value) : ''; },
        /**
         * WebDAV base from the server (once per address and credentials). offline: if the server is unreachable, the estimate applies;
         * then only the actual fetch fails, and an offline copy can step in (only useful when opening).
         */
        async davBase({ offline = false } = {}) {
            const r = root(), u = user.value, p = pass.value;
            if (!r) throw new VaultError(t('err.nc.server'));
            if (fromLegacy(r, u)) return fromLegacy(r, u);
            const k = key(r, u, p);
            if (!found.has(k)) {
                found.set(k, findDavBase(r, u, basicAuth(u, p)).then((b) => {
                    const changed = bases.get(key(r, u)) !== b;
                    bases.set(key(r, u), b);
                    if (changed) onFound?.();
                    return b;
                }, (e) => { found.delete(k); throw e; }));
            }
            try { return await found.get(k); } catch (e) { if (offline && isOffline(e)) return guessFor(r, u); throw e; }
        },
        fileUrl: (base, path) => ncFileUrl(base, path, legacy)
    };
}
