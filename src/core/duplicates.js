// Files that hold the same entry or group UUID twice. kdbxweb's merge used to leave an entry the other device had moved in both
// places (fixed in #248); once saved and opened again, that is two objects with one UUID, and every later merge stops (e.merge.dup).
// The repair keeps one object per UUID and loses nothing on the way:
// - its place is the copy that was moved last (newest locationChanged), the way a merge picks the place; for a group that sits inside
//   its own copy, the outer one (anything else would hang the tree from itself);
// - its content is the copy changed last (newest lastModTime). The other copy's state goes into the entry's history when it differs,
//   both histories are kept;
// - a group's children all move to the copy that stays, so their own duplicates meet there and are repaired the same way.
// No tombstones: the UUID lives on. KeePassXC folds the copies into one object as well (the copy read last wins, silently); here the
// newer one wins and the user is told.
import { valueText } from './util.js';

const KINDS = ['groups', 'entries'];

/** Every listing in the tree, groups first: [{item, parent, kind}]; an object listed twice shows up twice. */
function listings(root) {
    const out = [];
    const walk = (group) => {
        for (const kind of KINDS) for (const item of group[kind]) out.push({ item, parent: group, kind });
        for (const g of group.groups) walk(g);
    };
    walk(root);
    return out;
}

/** How many extra copies the tree holds: {entries, groups} (0 and 0 for a healthy file). */
export function findDuplicates(root) {
    const seen = { groups: new Set(), entries: new Set() };
    const extra = { groups: 0, entries: 0 };
    for (const { item, kind } of listings(root)) {
        if (seen[kind].has(item.uuid.id)) extra[kind]++;
        else seen[kind].add(item.uuid.id);
    }
    return extra;
}

const binaryKey = (b) => (b && typeof b === 'object' && 'hash' in b ? `h:${b.hash}` : b && typeof b === 'object' && 'ref' in b ? `r:${b.ref}` : `n:${b?.byteLength ?? String(b)}`);

/** Everything a user can see or change on an entry, as one string: two copies with the same one are the same state. */
function entryState(e) {
    return JSON.stringify({
        fields: [...e.fields].map(([k, v]) => [k, valueText(v)]).sort(),
        binaries: [...e.binaries].map(([k, v]) => [k, binaryKey(v)]).sort(),
        tags: [...e.tags].sort(),
        icon: e.icon, customIcon: e.customIcon?.id, fg: e.fgColor, bg: e.bgColor, overrideUrl: e.overrideUrl,
        autoType: e.autoType, customData: e.customData ? [...e.customData].sort() : null, quality: e.qualityCheck,
        expires: !!e.times.expires, expiry: e.times.expiryTime?.getTime() ?? null
    });
}

const groupState = (g) => JSON.stringify([g.name, g.notes, g.icon, g.customIcon?.id, [...g.tags].sort()]);

/** A history item holding the state of entry e (with its own times), added like pushHistory does it. */
function addToHistory(entry, state) {
    const h = new entry.constructor();
    h.copyFrom(state);
    h.history = [];
    entry.history.push(h);
    if (h.times.lastModTime) entry.addHistoryTombstone?.(true, h.times.lastModTime);
}

/** Content of `from` onto `to`, while `to` keeps its place and its move time. */
function takeContent(to, from, { group }) {
    const { locationChanged } = to.times;
    const { previousParentGroup } = to;
    to.copyFrom(from);
    if (group) {
        to.tags = from.tags.slice();
        to.customData = from.customData ? new Map([...from.customData].map(([k, v]) => [k, { ...v }])) : undefined;
    }
    to.times.locationChanged = locationChanged;
    to.previousParentGroup = previousParentGroup;
}

const isAncestor = (a, b) => { for (let g = b.parentGroup; g; g = g.parentGroup) if (g === a) return true; return false; };
const remove = (list, x) => { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); };

/** Folds `other` into `keep` (two entries with one UUID); returns true if a state went into the history. */
function foldEntry(keep, other) {
    let history = false;
    const known = new Set(keep.history.map((h) => `${h.lastModTime}|${entryState(h)}`));
    for (const h of other.history) {
        const key = `${h.lastModTime}|${entryState(h)}`;
        if (!known.has(key)) { known.add(key); addToHistory(keep, h); history = true; }
    }
    if (entryState(keep) !== entryState(other)) {
        const [older, newer] = other.lastModTime > keep.lastModTime ? [keep, other] : [other, keep];
        if (!known.has(`${older.lastModTime}|${entryState(older)}`)) { addToHistory(keep, older); history = true; }
        if (newer === other) takeContent(keep, other, { group: false });
    }
    keep.history.sort((x, y) => x.lastModTime - y.lastModTime);
    return history;
}

/**
 * Repairs the tree under root in place. Returns what it did: {entries, groups} (copies folded away), history (entries whose other
 * copy's state went into their history), names (titles and group names, for the message), renamed (groups whose copies had
 * different names or notes: the newer ones stay, the older are listed here, since groups have no history).
 */
export function repairDuplicates(root) {
    const done = { entries: 0, groups: 0, history: 0, names: [], renamed: [] };
    for (;;) {
        const seen = { groups: new Map(), entries: new Map() };
        let pair = null;
        for (const l of listings(root)) {
            const first = seen[l.kind].get(l.item.uuid.id);
            if (first) { pair = [first, l]; break; }
            seen[l.kind].set(l.item.uuid.id, l);
        }
        if (!pair) return done;
        const [a, b] = pair;
        const kind = a.kind;
        if (a.item === b.item) {
            // One object listed twice (in memory only, see dropStaleListings in vault.js): only the listing in its own group stays
            const stale = b.parent !== a.item.parentGroup ? b : a;
            remove(stale.parent[kind], stale.item);
            continue;
        }
        const name = kind === 'entries' ? valueText(a.item.fields.get('Title')) : a.item.name || '';
        if (!done.names.includes(name)) done.names.push(name);
        let keep, other;
        if (kind === 'groups' && isAncestor(a.item, b.item)) [keep, other] = [a, b];
        else if (kind === 'groups' && isAncestor(b.item, a.item)) [keep, other] = [b, a];
        else [keep, other] = b.item.locationChanged > a.item.locationChanged ? [b, a] : [a, b];
        remove(other.parent[kind], other.item);
        if (kind === 'entries') {
            if (foldEntry(keep.item, other.item)) done.history++;
            done.entries++;
            continue;
        }
        const g = keep.item, o = other.item;
        if (groupState(g) !== groupState(o)) {
            const older = o.lastModTime > g.lastModTime ? g : o;
            done.renamed.push({ name: older.name || '', notes: older.notes || '' });
            if (older === g) takeContent(g, o, { group: true });
        }
        for (const k of KINDS) {
            for (const child of o[k]) { child.parentGroup = g; g[k].push(child); }
            o[k] = [];
        }
        done.groups++;
    }
}
