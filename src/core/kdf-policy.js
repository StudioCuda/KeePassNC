// Regeln fuer die Schluesselableitung in den Datenbank-Einstellungen (DOM-frei, Unit-Tests).
// s = {kdf: 'argon2d'|'argon2id'|'aes', memoryKiB, iterations, parallelism, rounds} wie Vault.securitySettings().

/** Speicher zur Auswahl (MiB). Mehr als 1 GiB bieten wir nicht an: WebAssembly und Handys stossen vorher an Grenzen. */
export const MEMORY_PRESETS_MIB = [64, 128, 256, 512, 1024];
export const PARALLELISM_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
export const MAX_ITERATIONS = 1000;
/** Ab dieser gemessenen Dauer (ms) weisen wir darauf hin, dass Handys oft deutlich laenger brauchen. */
export const SLOW_MS = 3000;

/** Ampel fuer den Speicher: bis 256 MiB unbedenklich, 512 MiB Hinweis, darueber ausdrueckliche Rueckfrage. */
export function memoryLevel(memoryMiB) {
    return memoryMiB <= 256 ? 'ok' : memoryMiB <= 512 ? 'warn' : 'bad';
}

const isArgon = (s) => s.kdf === 'argon2d' || s.kdf === 'argon2id';

/** Macht next das Raten des Master-Passworts billiger als cur? Weg von Argon2, weniger Speicher oder weniger Arbeit (Speicher x Durchlaeufe). */
export function isWeaker(next, cur) {
    if (isArgon(cur) && !isArgon(next)) return true;
    if (!isArgon(cur) && isArgon(next)) return false;
    if (!isArgon(next)) return next.rounds < cur.rounds;
    return next.memoryKiB < cur.memoryKiB || next.memoryKiB * next.iterations < cur.memoryKiB * cur.iterations;
}

/** Wenigstens so viele Durchlaeufe, damit die Arbeit bei diesem Speicher nicht unter die bisherige faellt (nur Argon2 -> Argon2). */
export function minIterations(cur, memoryKiB) {
    return isArgon(cur) ? Math.max(1, Math.ceil((cur.memoryKiB * cur.iterations) / memoryKiB)) : 1;
}

/**
 * Vorschlag fuer "etwa targetMs auf diesem Geraet": msPerIteration aus einem Probelauf mit einem Durchlauf. Nie unter minIterations,
 * damit ein langsames Geraet die Datenbank nicht still schwaecher macht.
 */
export function suggestIterations(msPerIteration, cur, memoryKiB, targetMs = 1000) {
    const bench = Math.floor(targetMs / Math.max(1, msPerIteration));
    return Math.min(MAX_ITERATIONS, Math.max(1, bench, minIterations(cur, memoryKiB)));
}
