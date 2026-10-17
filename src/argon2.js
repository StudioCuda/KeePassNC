// Argon2 (hash-wasm) in einem Web Worker, damit die Seite waehrend der Schluesselableitung bedienbar bleibt.
// Je Ableitung ein frischer Worker, der danach beendet wird: Sein WASM-Speicher (bis zu 1 GiB, mit Zwischenwerten aus dem Passwort)
// ist damit sofort wieder frei, statt bis zum Neuladen der Seite liegen zu bleiben.
// Laesst sich kein Worker starten (Node-Tests, CSP des Servers, Datei fehlt offline), rechnet die Seite selbst wie bisher.
import { argon2d, argon2id } from 'hash-wasm';

const WORKER_FILE = 'keepassnc-argon2.js';

/**
 * Rechnet im aktuellen Thread (im Worker oder als Rueckfall auf der Seite).
 * p = {type: 'd'|'id', password: Uint8Array, salt: Uint8Array, parallelism, iterations, memoryKiB, hashLength} -> Uint8Array
 */
export function argon2Here(p) {
    return (p.type === 'id' ? argon2id : argon2d)({
        password: p.password, salt: p.salt, parallelism: p.parallelism, iterations: p.iterations,
        memorySize: p.memoryKiB, hashLength: p.hashLength, outputType: 'binary'
    });
}

/** Adresse des Workers neben dem App-Skript; behaelt dessen Query (?v= der Nextcloud-App), damit Cache und Version zusammenpassen. */
export function workerUrl(scriptSrc) {
    const u = new URL(WORKER_FILE, scriptSrc);
    u.search = new URL(scriptSrc).search;
    return u.href;
}

// document.currentScript gibt es nur, solange das App-Skript laeuft, also hier beim Laden lesen.
const scriptSrc = typeof document !== 'undefined' ? document.currentScript?.src : '';
let url = scriptSrc && typeof Worker !== 'undefined' ? workerUrl(scriptSrc) : null;

class NoWorker extends Error {}

function inWorker(p) {
    return new Promise((resolve, reject) => {
        let w;
        try { w = new Worker(url); } catch (e) { reject(new NoWorker(String(e))); return; }
        w.onmessage = ({ data }) => {
            w.terminate();
            if (data.ok) resolve(data.hash);
            else if (data.oom) reject(new RangeError(data.message)); // wie auf der Seite: isOutOfMemory erkennt es
            else reject(new NoWorker(data.message)); // z. B. WASM per CSP des Servers gesperrt -> auf der Seite versuchen
        };
        // Nur Lade-/Startfehler landen hier (der Worker faengt Rechenfehler selbst ab und meldet sie per Nachricht).
        w.onerror = (e) => { e.preventDefault?.(); w.terminate(); reject(new NoWorker(e.message || 'worker error')); };
        w.postMessage(p); // kopiert; Passwort und Salz bleiben dem Aufrufer erhalten (Rueckfall, kdbxweb raeumt seine Puffer selbst)
    });
}

/** Wie argon2Here, rechnet aber im Worker, solange das klappt. */
export async function argon2(p) {
    if (url) {
        try { return await inWorker(p); } catch (e) {
            if (!(e instanceof NoWorker)) throw e;
            url = null; // einmal gescheitert: fuer den Rest der Sitzung direkt rechnen statt jedes Mal erneut zu probieren
        }
    }
    return argon2Here(p);
}
