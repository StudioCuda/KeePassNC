import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardGuard, mayPaste, mayPastePointer } from '../../src/ui/clipboard.js';

/**
 * A browser as the guard sees it. The clipboard refuses writes without focus (Chromium) and, with needsActivation, without a fresh
 * click or key press (Firefox, Safari). read: the state of the clipboard-read permission, 'unknown' throws like Firefox/Safari.
 * Writes land in the order they were made, like in a browser; env.writeDelay makes the next ones slow.
 */
function browser({ read = 'denied', needsActivation = false, queryDelay = 0 } = {}) {
    const env = { focused: true, active: false, blocked: false, data: '', selection: '', writes: [], reads: 0, writeDelay: 0 };
    const win = new EventTarget(), doc = new EventTarget();
    Object.assign(doc, { hasFocus: () => env.focused, visibilityState: 'visible', getSelection: () => env.selection, activeElement: null });
    let queue = Promise.resolve();
    const clipboard = {
        writeText(s) {
            if (env.blocked || !env.focused || (needsActivation && !env.active)) return Promise.reject(new DOMException('refused', 'NotAllowedError'));
            const delay = env.writeDelay;
            queue = queue.then(() => delay && tick(delay)).then(() => { env.writes.push(s); env.data = s; });
            return queue;
        },
        async readText() { env.reads++; if (!env.focused) throw new DOMException('Document is not focused.', 'NotAllowedError'); return env.data; }
    };
    const permissions = {
        async query({ name }) {
            if (queryDelay) await tick(queryDelay);
            if (read === 'unknown') throw new TypeError(`'${name}' is not a valid permission name`);
            return { state: read };
        }
    };
    const states = [];
    const guard = clipboardGuard({ clipboard, permissions, activation: { get isActive() { return env.active; } }, win, doc, onState: (s, label) => states.push(`${s}:${label}`) });
    return { env, win, doc, guard, states };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const fire = (target, type, props = {}) => target.dispatchEvent(Object.assign(new Event(type), props));
const pasteOf = (text, types = ['text/plain']) => ({ clipboardData: { getData: (t) => (t === 'text/plain' ? text : ''), types } });

test('the timer clears the clipboard while the page may write, without a word (the copy message promised it)', async () => {
    const b = browser();
    await b.guard.copy('pw', 'Password', 20);
    assert.equal(b.env.data, 'pw');
    await tick(40);
    assert.equal(b.env.data, '');
    assert.deepEqual(b.states, []);
});

test('without focus the timer is refused: it says so and clears on the next click, the tab coming back alone is not enough', async () => {
    const b = browser();
    await b.guard.copy('pw', 'Password', 20);
    b.env.focused = false; // you went to another tab to paste
    await tick(40);
    assert.equal(b.env.data, 'pw');
    assert.deepEqual(b.states, ['pending:Password']);
    b.env.focused = true;
    fire(b.win, 'focus'); await tick();
    assert.equal(b.env.data, 'pw', 'without a look at the clipboard the return alone must not clear: the next thing may be a paste');
    fire(b.doc, 'visibilitychange'); await tick();
    assert.deepEqual(b.states, ['pending:Password', 'pending:Password'], 'back in the tab the note comes again');
    fire(b.win, 'pointerdown', { button: 0 }); await tick();
    assert.equal(b.env.data, '');
    assert.deepEqual(b.states.at(-1), 'cleared:Password');
    fire(b.win, 'pointerdown', { button: 0 }); await tick();
    assert.deepEqual(b.env.writes, ['pw', ''], 'once cleared, later clicks do nothing');
});

test('with the read permission (Chromium) the tab coming back clears at once, but leaves alone what was copied elsewhere', async () => {
    const ours = browser({ read: 'granted' });
    await ours.guard.copy('pw', 'Password', 10);
    ours.env.focused = false;
    await tick(30);
    ours.env.focused = true;
    fire(ours.win, 'focus'); await tick(5);
    assert.equal(ours.env.data, '');
    assert.deepEqual(ours.states, ['pending:Password', 'cleared:Password']);

    const theirs = browser({ read: 'granted' });
    await theirs.guard.copy('pw', 'Password', 10);
    theirs.env.focused = false;
    await tick(30);
    theirs.env.data = 'copied elsewhere';
    theirs.env.focused = true;
    fire(theirs.win, 'focus'); await tick(5);
    assert.equal(theirs.env.data, 'copied elsewhere');
    assert.deepEqual(theirs.states, ['pending:Password', 'kept:Password']);
    fire(theirs.win, 'pointerdown', { button: 0 }); await tick(5);
    assert.equal(theirs.env.data, 'copied elsewhere', 'settled: a click no longer clears');
});

test('the timer also looks first while it may read: something copied meanwhile stays', async () => {
    const b = browser({ read: 'granted' });
    await b.guard.copy('pw', 'Password', 10);
    b.env.data = 'copied elsewhere';
    await tick(30);
    assert.equal(b.env.data, 'copied elsewhere');
    assert.deepEqual(b.env.writes, ['pw']);
});

test('Firefox/Safari: no activation, no clear even with focus; the next key press clears, a lone modifier or Ctrl+V does not', async () => {
    const b = browser({ read: 'unknown', needsActivation: true });
    b.env.active = true; // the click on the copy button
    await b.guard.copy('pw', 'Password', 20);
    b.env.active = false; // 5 s later the activation is gone
    await tick(40);
    assert.deepEqual(b.states, ['pending:Password'], 'refused for lack of activation is not a final no');
    b.env.active = true;
    fire(b.win, 'keydown', { key: 'Control', ctrlKey: true }); await tick();
    fire(b.win, 'keydown', { key: 'v', ctrlKey: true }); await tick();
    fire(b.win, 'keydown', { key: 'Insert', shiftKey: true }); await tick();
    assert.equal(b.env.data, 'pw', 'the start of a paste waits for the paste');
    fire(b.win, 'keydown', { key: 'a' }); await tick();
    assert.equal(b.env.data, '');
    assert.equal(b.states.at(-1), 'cleared:Password');
});

test('a tap counts once the finger lifts: pointerup tries again after a pointerdown without activation', async () => {
    const b = browser({ read: 'unknown', needsActivation: true });
    b.env.active = true;
    await b.guard.copy('pw', 'Password', 10);
    b.env.active = false;
    await tick(30);
    fire(b.win, 'pointerdown', { button: 0 }); await tick();
    assert.equal(b.env.data, 'pw');
    b.env.active = true;
    fire(b.win, 'pointerup', { button: 0 }); await tick();
    assert.equal(b.env.data, '');
});

test('a paste shows the clipboard: something else stays, our own value goes right after the paste', async () => {
    const theirs = browser({ read: 'unknown', needsActivation: true });
    theirs.env.active = true;
    await theirs.guard.copy('pw', 'Password', 10);
    theirs.env.active = false;
    await tick(30);
    theirs.env.data = 'copied elsewhere'; theirs.env.active = true;
    fire(theirs.doc, 'paste', pasteOf('copied elsewhere')); await tick(5);
    fire(theirs.win, 'pointerdown', { button: 0 }); await tick(5);
    assert.equal(theirs.env.data, 'copied elsewhere');
    assert.deepEqual(theirs.states, ['pending:Password', 'kept:Password']);

    const ours = browser({ read: 'unknown', needsActivation: true });
    ours.env.active = true;
    await ours.guard.copy('pw', 'Password', 10);
    ours.env.active = false;
    await tick(30);
    ours.env.active = true;
    fire(ours.doc, 'paste', pasteOf('pw')); await tick(5);
    assert.equal(ours.env.data, '');
    assert.equal(ours.states.at(-1), 'cleared:Password');

    const picture = browser({ read: 'unknown', needsActivation: true });
    picture.env.active = true;
    await picture.guard.copy('pw', 'Password', 10);
    picture.env.active = false;
    await tick(30);
    fire(picture.doc, 'paste', pasteOf('', ['Files'])); await tick(5);
    assert.equal(picture.states.at(-1), 'kept:Password', 'a picture on the clipboard is not ours either');
});

test('a paste while the timer runs: something else on the clipboard calls the clear off', async () => {
    const b = browser();
    await b.guard.copy('pw', 'Password', 20);
    b.env.data = 'copied elsewhere';
    fire(b.doc, 'paste', pasteOf('copied elsewhere'));
    await tick(40);
    assert.equal(b.env.data, 'copied elsewhere');
    assert.deepEqual(b.env.writes, ['pw']);
});

test('a click into a text field or a right click waits for the paste', async () => {
    const field = { closest: (sel) => (sel.includes('input') ? {} : null) };
    const button = { closest: () => null };
    assert.equal(mayPastePointer({ button: 0, target: field }), true);
    assert.equal(mayPastePointer({ button: 2, target: button }), true);
    assert.equal(mayPastePointer({ button: 0, target: button }), false);
    assert.equal(mayPastePointer({ button: 0, target: null }), false);
    const b = browser();
    await b.guard.copy('pw', 'Password', 10);
    b.env.focused = false;
    await tick(30);
    b.env.focused = true;
    fire(b.win, 'pointerdown', { button: 2 }); await tick();
    assert.equal(b.env.data, 'pw');
});

test('mayPaste: modifiers, Ctrl/Cmd+V and Shift+Insert; other keys and shortcuts are not', () => {
    for (const e of [{ key: 'Shift' }, { key: 'Control' }, { key: 'Meta' }, { key: 'Alt' }, { key: 'v', ctrlKey: true }, { key: 'V', metaKey: true }, { key: 'Insert', shiftKey: true }]) assert.equal(mayPaste(e), true, JSON.stringify(e));
    for (const e of [{ key: 'a' }, { key: 'v' }, { key: 'Enter' }, { key: 'c', ctrlKey: true }, { key: 'l', ctrlKey: true }, { key: 'Insert' }]) assert.equal(mayPaste(e), false, JSON.stringify(e));
});

test('a copy in the page puts something else on the clipboard: the timer leaves it alone (unless it copied our value again)', async () => {
    const other = browser();
    await other.guard.copy('pw', 'Password', 20);
    other.env.selection = 'some notes'; other.env.data = 'some notes';
    fire(other.doc, 'copy');
    await tick(40);
    assert.equal(other.env.data, 'some notes');
    assert.deepEqual(other.states, []);

    const noted = browser(); // a note that the password is still there gets taken back
    await noted.guard.copy('pw', 'Password', 10);
    noted.env.focused = false;
    await tick(30);
    noted.env.focused = true; noted.env.selection = 'some notes'; noted.env.data = 'some notes';
    fire(noted.doc, 'cut');
    assert.deepEqual(noted.states, ['pending:Password', 'kept:Password']);

    const same = browser();
    await same.guard.copy('pw', 'Password', 20);
    same.env.selection = 'pw';
    fire(same.doc, 'copy');
    fire(same.doc, 'cut'); // and a copy with nothing selected copies nothing
    same.env.selection = '';
    fire(same.doc, 'copy');
    await tick(40);
    assert.equal(same.env.data, '');
});

test('locking clears right away; refused, it waits like the timer, and the timer does not clear a second time', async () => {
    const now = browser();
    await now.guard.copy('pw', 'Password', 30);
    now.guard.clear(); await tick();
    assert.equal(now.env.data, '');
    await tick(50);
    assert.deepEqual(now.env.writes, ['pw', '']);
    assert.deepEqual(now.states, []);

    const away = browser();
    await away.guard.copy('pw', 'Password', 1000);
    away.env.focused = false; // the auto-lock fires while you are in another tab
    away.guard.clear(); await tick();
    assert.equal(away.env.data, 'pw');
    assert.deepEqual(away.states, ['pending:Password']);
    away.env.focused = true;
    fire(away.win, 'keydown', { key: 'a' }); await tick();
    assert.equal(away.env.data, '');
    assert.deepEqual(away.states, ['pending:Password', 'cleared:Password']);

    const nothing = browser();
    nothing.guard.clear(); await tick();
    assert.deepEqual(nothing.env.writes, []);
});

test('refused although the page had focus and a fresh click: that is reported as failed, a later chance still clears', async () => {
    const b = browser({ needsActivation: true });
    b.env.active = true;
    await b.guard.copy('pw', 'Password', 10);
    b.env.active = false; b.env.blocked = true; // say, the clipboard permission was taken away meanwhile
    await tick(30);
    assert.deepEqual(b.states, ['pending:Password']);
    b.env.active = true;
    fire(b.win, 'pointerdown', { button: 0 }); await tick();
    assert.deepEqual(b.states, ['pending:Password', 'failed:Password']);
    fire(b.win, 'pointerdown', { button: 0 }); await tick();
    assert.deepEqual(b.states, ['pending:Password', 'failed:Password'], 'the same note is not repeated on every click');
    b.env.blocked = false;
    fire(b.win, 'keydown', { key: 'x' }); await tick();
    assert.equal(b.env.data, '');
    assert.equal(b.states.at(-1), 'cleared:Password');
});

test('a new copy replaces the old one: one timer, and the old value is not cleared over the new one', async () => {
    const b = browser();
    await b.guard.copy('user', 'User name', 20);
    await b.guard.copy('pw', 'Password', 60);
    await tick(40);
    assert.equal(b.env.data, 'pw', 'the first timer is gone');
    await tick(50);
    assert.deepEqual(b.env.writes, ['user', 'pw', '']);
});

test('a clear attempt still looking at the clipboard steps back when a new copy comes meanwhile', async () => {
    const b = browser({ read: 'granted', queryDelay: 20 });
    await b.guard.copy('pw', 'Password', 5);
    b.env.focused = false;
    await tick(40); // pending
    b.env.focused = true;
    fire(b.win, 'pointerdown', { button: 0 }); // starts looking (20 ms) ...
    await b.guard.copy('user', 'User name', 1000); // ... and the click was on a copy button
    await tick(60);
    assert.equal(b.env.data, 'user');
});

test('a copy the browser refuses throws and leaves nothing behind', async () => {
    const b = browser();
    b.env.focused = false;
    await assert.rejects(b.guard.copy('pw', 'Password', 10), { name: 'NotAllowedError' });
    b.env.focused = true;
    await tick(30);
    b.guard.clear(); await tick();
    assert.deepEqual(b.env.writes, []);
    assert.deepEqual(b.states, []);
});

test('a refused copy leaves the value from before on the clipboard, and its timer still clears it', async () => {
    const b = browser();
    await b.guard.copy('pw', 'Password', 30);
    b.env.blocked = true;
    await assert.rejects(b.guard.copy('user', 'User name', 1000));
    b.env.blocked = false;
    await tick(50);
    assert.equal(b.env.data, '');
    assert.deepEqual(b.env.writes, ['pw', '']);
});

test('a clear does not land on top of a copy that is still being written', async () => {
    const b = browser();
    await b.guard.copy('pw', 'Password', 5);
    b.env.focused = false;
    await tick(30); // pending
    b.env.focused = true; b.env.writeDelay = 20;
    const copying = b.guard.copy('user', 'User name', 1000); // slow to land ...
    fire(b.win, 'keydown', { key: 'a' }); // ... while a key press tries the old clear
    await copying; await tick(40);
    assert.equal(b.env.data, 'user');
    assert.deepEqual(b.env.writes, ['pw', 'user']);
});
