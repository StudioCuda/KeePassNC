// What a copy button puts on the clipboard leaves it again: after the time from the settings and when the database locks.
// Browsers only let a page write the clipboard while it has the focus (Chromium) or within 5 s of a click or key press in it
// (Firefox, Safari). A timer that fires while you paste in another tab or app has neither, and the clear used to fail without a
// word. Now a refused clear says so in the status line and waits, without polling, for the next moment the browser allows it:
// the tab coming back, the next click or key press in it.
//
// Only what is still ours gets cleared. Chromium shows the clipboard to a page that may read it (permission already granted; we
// never ask, that would be a prompt), a paste into the page shows it in every browser, a copy in the page replaces it. Where we
// can't tell (no permission, Firefox, Safari) it gets cleared anyway: a password left on the clipboard is worse than having to
// copy something again. Just the tab coming back doesn't clear blindly, though: the first thing you do may be pasting what you
// copied elsewhere, and that paste can tell. So a click into a text field, a right click, Ctrl/Cmd+V and Shift+Insert wait too.

const MODIFIERS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'Meta', 'OS', 'Shift']);
const TEXT_FIELDS = 'input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=file], [type=range], [type=color]), textarea, [contenteditable]:not([contenteditable=false])';

/** A key that may start a paste: a lone modifier, Ctrl/Cmd+V or Shift+Insert. */
export const mayPaste = (e) => MODIFIERS.has(e.key) || (!!(e.ctrlKey || e.metaKey) && /^v$/i.test(e.key)) || (!!e.shiftKey && e.key === 'Insert');
/** A pointer that may be about to paste: a right click (context menu) or a click into a text field. */
export const mayPastePointer = (e) => e.button !== 0 || !!e.target?.closest?.(TEXT_FIELDS);

/** What a native copy or cut takes: the selection inside a text field, or else the one in the page. */
function selectedText(doc) {
    const el = doc.activeElement;
    if (typeof el?.selectionStart === 'number' && el.selectionEnd > el.selectionStart) return el.value.slice(el.selectionStart, el.selectionEnd);
    return String(doc.getSelection?.() ?? '');
}

/**
 * clipboard/permissions/activation: navigator.clipboard, navigator.permissions, navigator.userActivation; win/doc: window and
 * document (for the events). onState(state, label) for the status line: 'pending' (refused for now, waits for the page to be
 * used), 'failed' (refused although the page had the focus and a fresh click), and after one of those 'cleared' or 'kept'
 * (something else is on the clipboard now, left alone). A clear on time needs no word: the copy message already promised it.
 */
export function clipboardGuard({ clipboard, permissions, activation, win, doc, onState, timers = globalThis }) {
    let mine = null; // {text, label, timer, watch, waiting, said} of the last copy, until it is cleared or replaced
    let copying = 0; // copies still being written: a clear must not land on top of them

    /** true/false when the page may look (nobody gets asked), null when it can't tell. */
    async function stillOurs(text) {
        try {
            if ((await permissions.query({ name: 'clipboard-read' })).state !== 'granted') return null;
            const now = await clipboard.readText();
            return now === '' || now === text;
        } catch {
            return null; // Firefox and Safari don't know the permission; Chromium without focus can't read either
        }
    }

    function settle(entry, state) {
        if (mine !== entry) return;
        mine = null;
        timers.clearTimeout(entry.timer);
        entry.watch.abort();
        if (state && entry.said) onState(state, entry.label); // takes back the note that it is still there
    }
    function say(entry, state, again = false) {
        if (again || entry.said !== state) { entry.said = state; onState(state, entry.label); }
    }

    /** why: 'timer' | 'lock' | 'focus' | 'visible' (the tab is back) | 'use' (a click or key press) | 'paste'; known: what a paste showed. */
    async function attempt(entry, why, known) {
        const ours = known ?? await stillOurs(entry.text);
        if (mine !== entry) return; // cleared or replaced meanwhile (a copy right after this click, say)
        if (copying) { entry.waiting = true; return; } // a new copy replaces it; should that one be refused, the next click tries again
        if (ours === false) return settle(entry, 'kept');
        if (ours === null && (why === 'focus' || why === 'visible')) { if (why === 'visible') say(entry, entry.said, true); return; } // say it again, you may have missed it
        const could = doc.hasFocus() && (activation?.isActive ?? true); // a refusal then is the browser's final word, not bad timing
        try {
            await clipboard.writeText('');
        } catch {
            if (mine === entry) { entry.waiting = true; say(entry, could ? 'failed' : 'pending'); }
            return;
        }
        settle(entry, 'cleared');
    }

    function watch(entry) {
        const opts = { capture: true, passive: true, signal: entry.watch.signal };
        win.addEventListener('focus', (e) => { if (entry.waiting && e.target === win) attempt(entry, 'focus'); }, opts); // the window, not a field in it
        doc.addEventListener('visibilitychange', () => { if (entry.waiting && doc.visibilityState === 'visible') attempt(entry, 'visible'); }, opts);
        // pointerup as well: a tap only counts as a user activation once the finger lifts
        for (const ev of ['pointerdown', 'pointerup']) win.addEventListener(ev, (e) => { if (entry.waiting && !mayPastePointer(e)) attempt(entry, 'use'); }, opts);
        win.addEventListener('keydown', (e) => { if (entry.waiting && !mayPaste(e)) attempt(entry, 'use'); }, opts);
        doc.addEventListener('paste', (e) => {
            const data = e.clipboardData;
            if (!data) return;
            const ours = data.getData('text/plain') === entry.text || !data.types?.length;
            if (!ours) settle(entry, 'kept');
            else if (entry.waiting) timers.setTimeout(() => attempt(entry, 'paste', true), 0); // after the paste, which already has its data
        }, opts);
        for (const ev of ['copy', 'cut']) doc.addEventListener(ev, () => { const s = selectedText(doc); if (s && s !== entry.text) settle(entry, 'kept'); }, opts);
    }

    return {
        /** Copies text; it leaves the clipboard again after ms. Throws when the browser refuses the copy. */
        async copy(text, label, ms) {
            copying++;
            try {
                await clipboard.writeText(text); // refused: throws, and the value from before keeps its timer
            } finally {
                copying--;
            }
            if (mine) settle(mine, null); // replaced: its timer and its wait end here
            const entry = { text, label, timer: null, watch: new AbortController(), waiting: false, said: null };
            mine = entry;
            entry.timer = timers.setTimeout(() => attempt(entry, 'timer'), ms);
            watch(entry);
        },
        /** Locking: clear right away, or as soon as the browser lets the page. */
        clear() {
            if (!mine) return;
            timers.clearTimeout(mine.timer);
            attempt(mine, 'lock');
        }
    };
}
