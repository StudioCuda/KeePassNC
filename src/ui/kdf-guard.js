// Before a file is opened: ask if its key derivation is far heavier than anything this app would write (core/kdf-policy.js, heavyDemand).
import { t } from '../i18n.js';
import { kdfDemand } from '../vault.js';
import { heavyDemand } from '../core/kdf-policy.js';
import { confirmDialog } from './dom.js';

/** buf: the encrypted file. Resolves false if the user backs out. */
export async function confirmHeavyKdf(buf) {
    const heavy = heavyDemand(kdfDemand(buf));
    if (!heavy) return true;
    return confirmDialog({ title: t('kdfheavy.title'), message: t('kdfheavy.msg', heavy), confirmLabel: t('kdfheavy.go'), cancelLabel: t('cancel'), danger: true });
}
