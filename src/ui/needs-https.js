// Plain HTTP (anything but HTTPS or localhost) is no secure context: the browser then hides WebCrypto (crypto.subtle), and without it
// there is nothing to decrypt with. We say so instead of letting kdbxweb fail with a cryptic "randomBytes is not a function".
import { h } from './dom.js';
import { t } from '../i18n.js';

export const cryptoMissing = (g = globalThis) => !g.crypto?.subtle;

export function showNeedsHttps(app) {
    app.replaceChildren(h('main', { class: 'needs-https' },
        h('div', { class: 'card', role: 'alert' },
            h('h1', { class: 'card-title', text: t('https.title') }),
            h('p', { text: t('https.text') }))));
}
