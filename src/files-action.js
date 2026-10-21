// Wird in der Nextcloud-Dateien-App geladen: oeffnet .kdbx-Dateien per Klick mit KeePassNC und legt ueber "+ Neu" neue an.
// Erkennung ueber die Dateiendung (nicht ueber den MIME-Typ), damit keine Datenbank- oder Konfigurationsaenderungen noetig sind.
import { registerFileAction, addNewFileMenuEntry, Permission, DefaultType } from '@nextcloud/files';
import { generateUrl } from '@nextcloud/router';

const KEEPASS_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5zm0 4.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm-1 6.3h2l.7 5h-3.4z"/></svg>';

const isKdbx = (node) => /\.kdbx$/i.test(node.basename || node.path || '');

const de = /^de\b/i.test(document.documentElement.lang || '');

registerFileAction({
    id: 'keepassnc-open',
    order: -10,
    default: DefaultType.DEFAULT,
    displayName: () => (de ? 'Mit KeePassNC öffnen' : 'Open with KeePassNC'),
    iconSvgInline: () => KEEPASS_ICON,
    enabled: ({ nodes }) => nodes.length === 1 && isKdbx(nodes[0]) && (nodes[0].permissions & Permission.READ) !== 0,
    async exec({ nodes }) {
        window.location.href = generateUrl('/apps/keepassnc/?open={path}', { path: nodes[0].path });
        return null;
    }
});

// "+ Neu" -> "KeePass-Datenbank": die Datei entsteht erst in KeePassNC, wenn das Master-Passwort feststeht (eine leere .kdbx waere
// kaputt). Hier nur ein freier Name im aktuellen Ordner; die App fragt nach den Zugangsdaten und ueberschreibt nie eine vorhandene Datei.
const NEW_NAME = de ? 'Passwörter' : 'Passwords';
addNewFileMenuEntry({
    id: 'keepassnc-new',
    displayName: de ? 'KeePass-Datenbank' : 'KeePass database',
    iconSvgInline: KEEPASS_ICON,
    order: 50,
    enabled: (folder) => (folder.permissions & Permission.CREATE) !== 0,
    handler(folder, content) {
        const taken = new Set(content.map((n) => (n.basename || '').toLowerCase()));
        let name = `${NEW_NAME}.kdbx`;
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${NEW_NAME} (${i}).kdbx`;
        window.location.href = generateUrl('/apps/keepassnc/?new={path}', { path: `${folder.path.replace(/\/+$/, '')}/${name}` });
    }
});
