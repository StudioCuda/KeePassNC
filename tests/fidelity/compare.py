"""Vergleicht zwei KeePassXC-XML-Exporte (vorher/nachher) feldgenau. Aufruf: compare.py vorher.xml nachher.xml [erlaubt-Praefix ...]
Gibt jede Abweichung als "pfad: vorher -> nachher" aus (Exit 1, wenn es unerlaubte gibt). Eintraege/Gruppen werden ueber die UUID zugeordnet,
Anhaenge ueber ihren Inhalt (SHA-256). Zeitstempel zaehlen NICHT als ignoriert - jede ungewollte Aenderung faellt auf."""
import base64, hashlib, sys
from lxml import etree

KEYED = {'Entry': 'UUID', 'Group': 'UUID', 'Icon': 'UUID', 'DeletedObject': 'UUID', 'Item': 'Key', 'String': 'Key', 'Binary': 'Key'}

def load(path):
    root = etree.parse(path).getroot()
    bins = {}
    for b in root.findall('./Meta/Binaries/Binary'):
        raw = base64.b64decode(b.text or '')
        if b.get('Compressed') == 'True':
            import gzip; raw = gzip.decompress(raw)
        bins[b.get('ID')] = hashlib.sha256(raw).hexdigest()
    return root, bins

def flat(el, path, out, bins):
    tag = el.tag
    attrs = {k: v for k, v in el.attrib.items() if k not in ('ID',)}
    if tag == 'Value' and 'Ref' in el.attrib:
        out[path + '/@content'] = bins.get(el.get('Ref'), '?' + el.get('Ref'))
        attrs.pop('Ref', None)
    for k, v in sorted(attrs.items()): out[f'{path}/@{k}'] = v
    kids = list(el)
    if not kids:
        out[path] = (el.text or '').strip()
        return
    counts = {}
    for c in kids:
        if c.tag == 'Binaries': continue  # Binaerdaten laufen ueber Inhalts-Hash
        key = None
        if c.tag in KEYED:
            k = c.find(KEYED[c.tag])
            if k is not None: key = (k.text or '').strip()
        if c.tag == 'History': pass
        counts[c.tag] = counts.get(c.tag, 0) + 1
        label = f'{c.tag}[{key}]' if key is not None else (f'{c.tag}#{counts[c.tag]}' if sum(1 for x in kids if x.tag == c.tag) > 1 else c.tag)
        flat(c, f'{path}/{label}', out, bins)

def main(a, b, opts):
    import re
    ra, ba = load(a); rb, bb = load(b)
    fa, fb = {}, {}
    flat(ra, 'R', fa, ba); flat(rb, 'R', fb, bb)
    allow = [re.compile(x) for x in opts['allow']]
    for title in opts['entry']:  # erwartete Aenderungen an diesem Eintrag (inkl. Verlauf)
        for e in ra.iter('Entry'):
            t = [s.findtext('Value') for s in e.findall('String') if s.findtext('Key') == 'Title']
            if t and t[0] == title:
                allow.append(re.compile(r'Entry\[' + re.escape(e.findtext('UUID')) + r'\]'))
    drop = [re.compile(x) for x in opts['empty_drop']]
    diffs = []
    for k in sorted(set(fa) | set(fb)):
        if fa.get(k) != fb.get(k): diffs.append((k, fa.get(k), fb.get(k)))
    def ok(k, x, y):
        if any(r.search(k) for r in allow): return True
        return x == '' and y is None and any(r.search(k) for r in drop)
    bad = [d for d in diffs if not ok(*d)]
    for k, x, y in diffs:
        tag = 'erlaubt' if (k, x, y) not in bad else 'ABWEICHUNG'
        sx = (str(x)[:70] + '...') if x is not None and len(str(x)) > 70 else x
        sy = (str(y)[:70] + '...') if y is not None and len(str(y)) > 70 else y
        print(f'{tag}: {k}: {sx!r} -> {sy!r}')
    print(f'{len(fa)} Felder vorher, {len(fb)} nachher, {len(diffs)} Unterschiede, davon {len(bad)} unerlaubt')
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    args = sys.argv[1:]
    opts = {'allow': [], 'entry': [], 'empty_drop': []}
    files = []
    it = iter(args)
    for x in it:
        if x == '--allow': opts['allow'].append(next(it))
        elif x == '--entry': opts['entry'].append(next(it))
        elif x == '--empty-drop': opts['empty_drop'].append(next(it))
        else: files.append(x)
    main(files[0], files[1], opts)
