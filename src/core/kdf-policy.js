// Rules for key derivation in the database settings (DOM-free, unit tests).
// s = {kdf: 'argon2d'|'argon2id'|'aes', memoryKiB, iterations, parallelism, rounds} like Vault.securitySettings().

/** Memory choices (MiB). We do not offer more than 1 GiB: WebAssembly and phones hit their limits before that. */
export const MEMORY_PRESETS_MIB = [64, 128, 256, 512, 1024];
export const PARALLELISM_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
export const MAX_ITERATIONS = 1000;
/**
 * AES-KDF rounds we still open without asking. Measured in Chromium on a 2019 desktop (AES-NI): about 35 million rounds per second,
 * so this is a few seconds there; a phone needs several times that. KeePass's "one second" setting stays well below it.
 */
export const MAX_AES_ROUNDS = 100_000_000;
/** Above this the library refuses (vendor/kdbxweb key-encryptor-aes.ts) and so do we, without asking: a confirmation must not buy unlimited work. */
export const REFUSE_AES_ROUNDS = 1_000_000_000;
/** From this measured duration (ms) we point out that phones often need considerably longer. */
export const SLOW_MS = 3000;

/** Traffic light for memory: up to 256 MiB fine, 512 MiB warning, above that an explicit confirmation. */
export function memoryLevel(memoryMiB) {
    return memoryMiB <= 256 ? 'ok' : memoryMiB <= 512 ? 'warn' : 'bad';
}

/**
 * Is a file we are about to open asking for more than this app would ever write itself (the presets above, MAX_ITERATIONS)?
 * Then deriving the key can take minutes or kill the tab, and a file nobody expected to be that heavy deserves a question first.
 * s like Vault.securitySettings(); returns the offending values ({memoryMiB, iterations, parallelism}, or {rounds} for AES-KDF) or null.
 */
export function heavyDemand(s) {
    if (!s) return null;
    if (!isArgon(s)) return s.rounds > MAX_AES_ROUNDS ? { rounds: s.rounds } : null;
    const memoryMiB = Math.round(s.memoryKiB / 1024);
    if (memoryMiB <= MEMORY_PRESETS_MIB.at(-1) && s.iterations <= MAX_ITERATIONS && s.parallelism <= PARALLELISM_OPTIONS.at(-1)) return null;
    return { memoryMiB, iterations: s.iterations, parallelism: s.parallelism };
}

/** Would opening this file mean more AES-KDF rounds than we ever do? Then it is refused, not asked about. */
export const refusedDemand = (s) => (s && !isArgon(s) && s.rounds > REFUSE_AES_ROUNDS ? { rounds: s.rounds } : null);

const isArgon = (s) => s.kdf === 'argon2d' || s.kdf === 'argon2id';

/** Does next make guessing the master password cheaper than cur? Moving away from Argon2, less memory or less work (memory x iterations). */
export function isWeaker(next, cur) {
    if (isArgon(cur) && !isArgon(next)) return true;
    if (!isArgon(cur) && isArgon(next)) return false;
    if (!isArgon(next)) return next.rounds < cur.rounds;
    return next.memoryKiB < cur.memoryKiB || next.memoryKiB * next.iterations < cur.memoryKiB * cur.iterations;
}

/** At least as many iterations as it takes for the work at this memory not to fall below the previous one (Argon2 -> Argon2 only). */
export function minIterations(cur, memoryKiB) {
    return isArgon(cur) ? Math.max(1, Math.ceil((cur.memoryKiB * cur.iterations) / memoryKiB)) : 1;
}

/**
 * Suggestion for "about targetMs on this device": msPerIteration from a trial run with one iteration. Never below minIterations,
 * so a slow device does not silently weaken the database.
 */
export function suggestIterations(msPerIteration, cur, memoryKiB, targetMs = 1000) {
    const bench = Math.floor(targetMs / Math.max(1, msPerIteration));
    return Math.min(MAX_ITERATIONS, Math.max(1, bench, minIterations(cur, memoryKiB)));
}

/**
 * Defaults for a new database: KDBX 4, AES-256 (like KeePass 2 and KeePassXC; native in the browser via WebCrypto) and Argon2id
 * with 64 MiB like KeePassXC. Two threads instead of as many as cores: hash-wasm runs them one after the other, more only costs time here.
 * The iterations come from a trial run (newDbIterations); iterations is the lower bound. The kdbxweb values (Argon2d with
 * 1 MiB) are far too weak for a real database.
 */
export const NEW_DB = Object.freeze({ cipher: 'aes', kdf: 'argon2id', memoryKiB: 64 * 1024, iterations: 2, parallelism: 2 });

/** Iterations for a new database: about targetMs on this device, never below NEW_DB.iterations. */
export function newDbIterations(msPerIteration, targetMs = 1000) {
    return suggestIterations(msPerIteration, NEW_DB, NEW_DB.memoryKiB, targetMs);
}
