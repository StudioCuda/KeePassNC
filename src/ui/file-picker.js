// Field with the name of the picked file plus a button, in the look of the path field of the sign-in page.
// The real file input lies invisibly over the whole group, so a click anywhere opens the picker; files can also be dropped on it.
import { t } from '../i18n.js';
import { h, icon } from './dom.js';

const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');

/** input: the <input type=file> (stays the source of truth, `change` fires as usual). Returns the element to put into the page. */
export function filePicker(input, { icon: iconName, button, placeholder = t('login.keyfile.none') }) {
    if (!input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) input.setAttribute('aria-label', button); // the invisible input is what a screen reader finds: name it like the visible button
    const name = h('span', { class: 'fp-name ph', text: placeholder });
    input.addEventListener('change', () => { const n = input.files[0]?.name; name.textContent = n || placeholder; name.classList.toggle('ph', !n); });
    const box = h('div', { class: 'input-group filepick-group' }, h('div', { class: 'fp-field' }, name), h('span', { class: 'btn' }, icon(iconName), h('span', { text: button })), input);
    for (const type of ['dragenter', 'dragover']) box.addEventListener(type, (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); box.classList.add('drop'); });
    box.addEventListener('dragleave', (ev) => { if (!box.contains(ev.relatedTarget)) box.classList.remove('drop'); });
    box.addEventListener('drop', (ev) => {
        ev.preventDefault();
        box.classList.remove('drop');
        const files = ev.dataTransfer?.files;
        if (!files?.length) return;
        const dt = new DataTransfer();
        for (const f of input.multiple ? files : [files[0]]) dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return box;
}
