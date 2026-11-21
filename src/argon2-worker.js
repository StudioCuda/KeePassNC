// Web worker for key derivation (see argon2.js). Computes exactly one derivation; the page ends it afterwards.
import { argon2Here } from './argon2.js';
import { isOutOfMemory } from './core/util.js';

self.onmessage = async ({ data }) => {
    try {
        const hash = await argon2Here(data);
        self.postMessage({ ok: true, hash }, [hash.buffer]);
    } catch (e) {
        self.postMessage({ ok: false, oom: isOutOfMemory(e), message: String(e?.message || e) });
    } finally {
        data.password?.fill?.(0); // the copy postMessage made (composite key or master password): the worker ends right after, but its memory isn't zeroed on the way out
    }
};
