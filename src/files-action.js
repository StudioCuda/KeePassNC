// Wird in der Nextcloud-Dateien-App geladen: oeffnet .kdbx-Dateien per Klick mit KeePassNC.
// Erkennung ueber die Dateiendung (nicht ueber den MIME-Typ), damit keine Datenbank- oder Konfigurationsaenderungen noetig sind.
import { registerFileAction, Permission, DefaultType } from '@nextcloud/files';
import { generateUrl } from '@nextcloud/router';

const KEEPASS_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5zm0 4.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm-1 6.3h2l.7 5h-3.4z"/></svg>';

const isKdbx = (node) => /\.kdbx$/i.test(node.basename || node.path || '');

registerFileAction({
    id: 'keepassnc-open',
    order: -10,
    default: DefaultType.DEFAULT,
    displayName: () => (typeof window.t === 'function' ? window.t('keepassnc', 'Mit KeePassNC öffnen') : 'Mit KeePassNC öffnen'),
    iconSvgInline: () => KEEPASS_ICON,
    enabled: ({ nodes }) => nodes.length === 1 && isKdbx(nodes[0]) && (nodes[0].permissions & Permission.READ) !== 0,
    async exec({ nodes }) {
        window.location.href = generateUrl('/apps/keepassnc/?open={path}', { path: nodes[0].path });
        return null;
    }
});
