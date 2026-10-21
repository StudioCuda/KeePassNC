// Password health report (rules modelled on KeePassXC): strength, reuse, expiry, short/missing passwords.
import { estimateBits, strengthLabel } from './entropy.js';
import { fieldOf, entryExpiry, daysUntil, hasTotp, isPasskey, groupPath, resolvePlaceholders } from './util.js';

/** "Exclude from reports": KeePass 2 writes QualityCheck = False (KDBX 4.1), KeePassXC the CustomData item KnownBad. */
export const excluded = (e) => e.qualityCheck === false || e.customData?.get?.('KnownBad')?.value === 'True';

/**
 * entries: only "real" entries (without recycle bin). Returns {items, stats}; items are sorted by score, ascending.
 * A password with a field reference ({REF:P@I:…}) is rated like the password it points to (as in KeePassXC 2.8), but doesn't count
 * as reuse: it is the same account, after all. If the reference can't be resolved, there is no statement about strength.
 * stats.old: passwords that have been the same for over a year (only counted, no effect on the grade); stats.ok: no findings.
 * stats.health: average of the entry scores in percent (entries without findings count as 100).
 */
/**
 * Since when the password has been unchanged: the oldest stretch of versions (history + current state) with this password. Without
 * history the entry's last change counts; that rather underestimates the age than raising a false alarm.
 */
export function passwordSince(e) {
    const pw = fieldOf(e, 'Password');
    let since = e.times?.lastModTime || null;
    for (let i = (e.history || []).length - 1; i >= 0; i--) {
        const h = e.history[i];
        if (fieldOf(h, 'Password') !== pw) break;
        since = h.times?.lastModTime || since;
    }
    return since;
}
const YEAR = 365 * 86400000;

export function auditEntries(entries, now = Date.now()) {
    const byPw = new Map();
    for (const e of entries) {
        const pw = fieldOf(e, 'Password');
        if (!pw || pw.includes('{REF:') || excluded(e)) continue;
        if (!byPw.has(pw)) byPw.set(pw, []);
        byPw.get(pw).push(e);
    }
    const items = [];
    const stats = { entries: entries.length, expired: 0, expiring: 0, weak: 0, short: 0, reused: 0, unique: 0, noPassword: 0, excluded: 0, totp: 0, passkeys: 0, attachments: 0, avgLength: 0, old: 0, ok: 0, health: 100 };
    let lenSum = 0, lenCount = 0, checked = 0, scoreSum = 0;
    for (const e of entries) {
        if (hasTotp(e)) stats.totp++;
        if (isPasskey(e)) stats.passkeys++;
        if (e.binaries.size) stats.attachments++;
        const raw = fieldOf(e, 'Password'), pw = resolvePlaceholders(raw, e, entries);
        if (excluded(e)) { stats.excluded++; continue; }
        const reasons = [];
        let score = 100;
        const exp = entryExpiry(e);
        const d = exp ? daysUntil(exp, now) : null;
        if (!pw) { stats.noPassword++; continue; }
        checked++;
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
        const since = passwordSince(e);
        if (since && now - since.getTime() > YEAR) stats.old++;
        if (!reasons.length) stats.ok++;
        if (reasons.length) items.push({ entry: e, score: Math.max(0, score), reasons, path: groupPath(e.parentGroup) });
        scoreSum += reasons.length ? Math.max(0, score) : 100;
    }
    stats.unique = byPw.size;
    stats.avgLength = lenCount ? Math.round((lenSum / lenCount) * 10) / 10 : 0;
    // Rounded, but never 0 % while there are any points and never 100 % while there are findings
    if (checked) stats.health = Math.min(items.length ? 99 : 100, Math.max(scoreSum ? 1 : 0, Math.round(scoreSum / checked)));
    items.sort((a, b) => a.score - b.score || fieldOf(a.entry, 'Title').localeCompare(fieldOf(b.entry, 'Title')));
    return { items, stats };
}

