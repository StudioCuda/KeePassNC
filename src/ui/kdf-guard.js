// Before a file is opened: ask if its key derivation is far heavier than anything this app would write (core/kdf-policy.js, heavyDemand).
import { t } from '../i18n.js';
import { kdfDemand, VaultError } from '../vault.js';
import { heavyDemand, refusedDemand } from '../core/kdf-policy.js';
import { confirmDialog } from './dom.js';

/** buf: the encrypted file. Resolves false if the user backs out; throws e.kdf.rounds for a file nobody may ask to open. */
export async function confirmHeavyKdf(buf) {
    const demand = kdfDemand(buf);
    if (refusedDemand(demand)) throw new VaultError('Die Datei verlangt unsinnig viele Durchlaeufe der Schluesselableitung und wird nicht geoeffnet.', 'e.kdf.rounds');
    const heavy = heavyDemand(demand);
    if (!heavy) return true;
    return confirmDialog({ title: t('kdfheavy.title'), message: t(heavy.rounds != null ? 'kdfheavy.aes.msg' : 'kdfheavy.msg', heavy), confirmLabel: t('kdfheavy.go'), cancelLabel: t('cancel'), danger: true });
}
