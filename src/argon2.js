// Argon2 (hash-wasm) in a web worker, so the page stays usable during key derivation.
// A fresh worker per derivation, ended afterwards: its WASM memory (up to 1 GiB, with intermediate values from the password)
// is then freed right away instead of lingering until the page is reloaded.
// If no worker can be started (Node tests, the server's CSP, file missing offline), the page computes it itself as before.
import { argon2d, argon2id } from 'hash-wasm';

const WORKER_FILE = 'keepassnc-argon2.js';

/**
 * Computes in the current thread (in the worker or as a fallback on the page).
 * p = {type: 'd'|'id', password: Uint8Array, salt: Uint8Array, parallelism, iterations, memoryKiB, hashLength} -> Uint8Array
 */
export function argon2Here(p) {
    return (p.type === 'id' ? argon2id : argon2d)({
        password: p.password, salt: p.salt, parallelism: p.parallelism, iterations: p.iterations,
        memorySize: p.memoryKiB, hashLength: p.hashLength, outputType: 'binary'
    });
}

/** Address of a worker next to the app script; keeps its query (?v= of the Nextcloud app) so cache and version match. */
export function workerUrl(scriptSrc, file = WORKER_FILE) {
    const u = new URL(file, scriptSrc);
    u.search = new URL(scriptSrc).search;
    return u.href;
}

// document.currentScript only exists while the app script is running, so read it here at load time.
const scriptSrc = typeof document !== 'undefined' ? document.currentScript?.src : '';
/** Address of the worker (null without worker support); belongs in the app cache for offline start (session.js). */
export const ARGON2_WORKER_URL = scriptSrc && typeof Worker !== 'undefined' ? workerUrl(scriptSrc) : null;
let url = ARGON2_WORKER_URL;

class NoWorker extends Error {}

function inWorker(p) {
    return new Promise((resolve, reject) => {
        let w;
        try { w = new Worker(url); } catch (e) { reject(new NoWorker(String(e))); return; }
        w.onmessage = ({ data }) => {
            w.terminate();
            if (data.ok) resolve(data.hash);
            else if (data.oom) reject(new RangeError(data.message)); // like on the page: isOutOfMemory recognizes it
            else reject(new NoWorker(data.message)); // e.g. WASM blocked by the server's CSP -> try on the page
        };
        // Only load/start errors end up here (the worker catches computation errors itself and reports them by message).
        w.onerror = (e) => { e.preventDefault?.(); w.terminate(); reject(new NoWorker(e.message || 'worker error')); };
        w.postMessage(p); // copies; password and salt stay with the caller (fallback, kdbxweb clears its own buffers)
    });
}

/** Like argon2Here, but computes in the worker as long as that works. */
export async function argon2(p) {
    if (url) {
        try { return await inWorker(p); } catch (e) {
            if (!(e instanceof NoWorker)) throw e;
            url = null; // failed once: compute directly for the rest of the session instead of retrying every time
        }
    }
    return argon2Here(p);
}
