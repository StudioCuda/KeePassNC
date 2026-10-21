// Password/passphrase generator as a dialog (from the editor with "Use", otherwise copy only; there a click on the password copies it).
import { t } from '../i18n.js';
import { pref, copy } from './ctx.js';
import { h, modal } from './dom.js';
import { createGenerator } from './generator-panel.js';

export function openGenerator({ onUse } = {}) {
    const g = createGenerator({ pref, copy, copyOnClick: !onUse, onUse: onUse && ((pw, bits) => { onUse(pw, bits); m.close(); }) });
    const m = modal({ title: t('generator'), body: g.body, size: 'md', cls: 'gen-modal', actions: onUse ? [h('button', { type: 'button', text: t('cancel'), onclick: () => m.close() }), g.copyBtn, g.useBtn] : [g.copyBtn, h('button', { type: 'button', class: 'primary', text: t('close'), onclick: () => m.close() })] });
    g.start();
    return m;
}
