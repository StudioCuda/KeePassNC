// Passwort-Gesundheitsbericht (Regeln angelehnt an KeePassXC): Staerke, Wiederverwendung, Ablauf, kurze/fehlende Passwoerter.
import { estimateBits, strengthLabel } from './entropy.js';
import { fieldOf, entryExpiry, daysUntil, hasTotp, isPasskey, groupPath, resolveRefs } from './util.js';

const excluded = (e) => e.qualityCheck === false || (e.customData && e.customData.get?.('KnownBad')?.value === 'True');

/**
 * entries: nur "echte" Eintraege (ohne Papierkorb). Liefert {items, stats}; items sind nach Score aufsteigend sortiert.
 * Ein Passwort mit Feldreferenz ({REF:P@I:…}) wird wie das Passwort bewertet, auf das es zeigt (wie KeePassXC 2.8), zaehlt aber nicht
 * als Wiederverwendung: es ist ja dasselbe Konto. Laesst sich die Referenz nicht aufloesen, gibt es keine Aussage zur Staerke.
 */
export function auditEntries(entries, now = Date.now()) {
    const byPw = new Map();
    for (const e of entries) {
        const pw = fieldOf(e, 'Password');
        if (!pw || pw.includes('{REF:') || excluded(e)) continue;
        if (!byPw.has(pw)) byPw.set(pw, []);
        byPw.get(pw).push(e);
    }
    const items = [];
    const stats = { entries: entries.length, expired: 0, expiring: 0, weak: 0, short: 0, reused: 0, unique: 0, noPassword: 0, excluded: 0, totp: 0, passkeys: 0, attachments: 0, avgLength: 0 };
    let lenSum = 0, lenCount = 0;
    for (const e of entries) {
        if (hasTotp(e)) stats.totp++;
        if (isPasskey(e)) stats.passkeys++;
        if (e.binaries.size) stats.attachments++;
        const raw = fieldOf(e, 'Password'), pw = resolveRefs(raw, entries);
        if (excluded(e)) { stats.excluded++; continue; }
        const reasons = [];
        let score = 100;
        const exp = entryExpiry(e);
        const d = exp ? daysUntil(exp, now) : null;
        if (!pw) { stats.noPassword++; continue; }
        if (!pw.includes('{REF:')) {
            lenSum += [...pw].length; lenCount++;
            const bits = estimateBits(pw);
            score = Math.min(100, Math.round(bits));
            if (strengthLabel(bits) === 'bad' || strengthLabel(bits) === 'poor' || strengthLabel(bits) === 'weak') { reasons.push({ code: 'weak', bits: Math.round(bits) }); stats.weak++; }
            if ([...pw].length <= 8) { reasons.push({ code: 'short', length: [...pw].length }); stats.short++; }
            const uses = raw === pw ? byPw.get(pw)?.length || 1 : 1;
            if (uses > 1) { reasons.push({ code: 'reused', uses }); score = Math.min(score - 15 * (uses - 1), 74); stats.reused++; }
        }
        if (d !== null && d <= 0) { reasons.push({ code: 'expired', days: -d }); score = 0; stats.expired++; }
        else if (d !== null && d <= 30) { reasons.push({ code: 'expiring', days: d }); score = Math.min(score, 70 - 2 * (30 - d)); stats.expiring++; }
        if (reasons.length) items.push({ entry: e, score: Math.max(0, score), reasons, path: groupPath(e.parentGroup) });
    }
    stats.unique = byPw.size;
    stats.avgLength = lenCount ? Math.round((lenSum / lenCount) * 10) / 10 : 0;
    items.sort((a, b) => a.score - b.score || fieldOf(a.entry, 'Title').localeCompare(fieldOf(b.entry, 'Title')));
    return { items, stats };
}

