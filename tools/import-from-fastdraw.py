#!/usr/bin/env python3
"""Turn a FastDraw playbook PDF into a Practise Organiser backup file.

Why this works at all
---------------------
FastDraw does not print pictures. It prints vector line art with a live text
layer, and it labels every frame with two lines above the court: the upper is
the play, the lower is the category the play belongs to. That is exactly a set
and its options, which is how this app already stores tactics - so the whole
tree comes out of the file and nothing is retyped. A retyped name is how one
tactic silently becomes two, which is the same argument that made a drill a
referenced record rather than a string.

Font size is the discriminator, and it is stable across a FastDraw export:

    24     the page's section heading (Transition, Set plays, SOB, BOB)
    ~7.3   the play name             ~5.85  the category it sits in
    ~6.9   a caption under a frame   ~3-4   player numbers inside the court

The courts themselves are rendered out of the PDF by tools/fastdraw-crop.swift,
so they are drawn at the resolution asked for rather than resampled from an
image, and land on the diagram as a picture with its own court.

    swiftc -O tools/fastdraw-crop.swift -o /tmp/fastdraw-crop
    python3 tools/import-from-fastdraw.py playbook.pdf private/tactics.json

The output goes in private/ and reaches the iPad by AirDrop. It is the club's
playbook and this repo is public - the same rule as the drills.
"""

import base64, html, json, os, re, subprocess, sys, tempfile, time, zlib

SCALE = 16          # 16x renders a half court at ~950px: sharp at size L on an
                    # iPad, and grayscale line art at that size is smaller than
                    # colour at 12x (3.8 MB against 5.9 MB for a 50-court book).
CROP = os.environ.get("FASTDRAW_CROP", "/tmp/fastdraw-crop")
NUM = r'-?\d+(?:\.\d+)?'

# FastDraw's chapters, mapped onto this app's own sides and categories. Anything
# not listed keeps its FastDraw name as the category, which is better than
# guessing wrong - an unknown category is visible and one tap to fix, where a
# wrong one is invisible.
SECTIONS = {
    "transition": ("Offence", "Early offence"),
    "set plays":  ("Offence", "Half-court sets"),
    "sob":        ("Offence", "SLOB"),
    "slob":       ("Offence", "SLOB"),
    "bob":        ("Offence", "BLOB"),
    "blob":       ("Offence", "BLOB"),
    "press break": ("Offence", "Press break"),
    "zone offence": ("Offence", "Zone offence"),
    "man to man": ("Defence", "Man-to-man"),
    "zone":       ("Defence", "Zone"),
}


# ---------------------------------------------------------------- reading the pdf

def page_streams(data):
    """The five page content streams, in page order."""
    out = []
    for m in re.finditer(rb'stream\r?\n', data):
        end = data.find(b'endstream', m.end())
        try:
            s = zlib.decompress(data[m.end():end])
        except Exception:
            continue
        if b' Tf' in s:
            out.append(s)
    return out


def unescape(b):
    return b.replace(rb'\(', b'(').replace(rb'\)', b')').replace(rb'\\', b'\\').decode('latin-1')


def words(text):
    """Every drawn string with its size and position on the page."""
    out = []
    pat = (r'/F\d+ (' + NUM + r') Tf\s*\n(' + NUM + r') ' + NUM + ' ' + NUM +
           r' ' + NUM + r' (' + NUM + r') (' + NUM + r') Tm(.*?)ET')
    for m in re.finditer(pat, text, re.S):
        size = float(m.group(1)) * float(m.group(2))
        parts = re.findall(r'\((.*?)\)\s*Tj', m.group(5), re.S)
        if parts:
            out.append({'s': round(size, 1), 'x': float(m.group(3)), 'y': float(m.group(4)),
                        't': ''.join(unescape(p.encode('latin-1')) for p in parts)})
    return out


def frames(text):
    """Each frame opens with a clip rectangle around its court."""
    out = []
    pat = ('(' + NUM + r') (' + NUM + r') m\s*\n(' + NUM + r') (' + NUM + r') l\s*\n(' + NUM +
           r') (' + NUM + r') l\s*\n(' + NUM + r') (' + NUM + r') l\s*\n' + NUM + ' ' + NUM +
           r' l\s*\nh\s*\nW\s*\nn')
    for m in re.finditer(pat, text):
        xs = [float(m.group(i)) for i in (1, 3, 5, 7)]
        ys = [float(m.group(i)) for i in (2, 4, 6, 8)]
        if max(xs) - min(xs) > 500:
            continue                                  # the whole-page clip
        out.append({'x0': min(xs), 'x1': max(xs), 'y0': min(ys), 'y1': max(ys)})
    return out


def line(ws):
    return ' '.join(w['t'] for w in sorted(ws, key=lambda w: w['x'])).strip()


def lines(ws):
    out = []
    for y in sorted({round(w['y'], 1) for w in ws}, reverse=True):
        out.append(line([w for w in ws if abs(w['y'] - y) < 0.6]))
    return out


def read_book(path):
    """The playbook as a flat list of frames, in reading order."""
    data = open(path, 'rb').read()
    out = []
    for page, stream in enumerate(page_streams(data), 1):
        text = stream.decode('latin-1')
        W, F = words(text), frames(text)
        section = line([w for w in W if w['s'] > 15])

        rows = {}
        for f in F:
            rows.setdefault(round(f['y0'], 1), []).append(f)

        for y0 in sorted(rows, reverse=True):
            row = sorted(rows[y0], key=lambda f: f['x0'])

            # Two captions in one row share a text baseline, so a caption is not
            # a line of the page - it is a line of its own column. The caption
            # grid is also offset from the frame boxes (same pitch, different
            # origin), so words are bucketed by column index rather than by
            # which box they sit over; wrapped words run past their column's
            # right edge, which is why this floors rather than taking the
            # nearest. Claiming by "inside the frame's x range" put one play's
            # note under its neighbour.
            band = [w for w in W if 6 < w['s'] < 9 and y0 - 26 < w['y'] < y0 - 1]
            caps = {}
            if band:
                pitch = (row[1]['x0'] - row[0]['x0']) if len(row) > 1 else 1e9
                origin = min(w['x'] for w in band)
                base = round((origin - row[0]['x0']) / pitch) if len(row) > 1 else 0
                cols = {}
                for w in band:
                    i = base + int((w['x'] - origin) // pitch)
                    if 0 <= i < len(row):
                        cols.setdefault(i, []).append(w)
                for i, ws in cols.items():
                    caps[id(row[i])] = ' '.join(lines(ws))

            for f in row:
                above = [w for w in W if 5 < w['s'] < 9
                         and f['y1'] < w['y'] < f['y1'] + 14
                         and f['x0'] - 14 < w['x'] < f['x1'] + 14]
                if not above:
                    continue
                ys = sorted({round(w['y'], 1) for w in above})
                out.append({
                    'section': section, 'page': page,
                    'set':    line([w for w in above if abs(w['y'] - ys[0])  < 0.6]),
                    'option': line([w for w in above if abs(w['y'] - ys[-1]) < 0.6]),
                    'caption': caps.get(id(f), ''),
                    'box': [f['x0'], f['y0'], f['x1'], f['y1']],
                })
    return out


# ---------------------------------------------------------------- building records

def uid(seed):
    """Ids derived from the play's own name, so re-importing the same book
       updates the tactics rather than doubling them - the same reason the drill
       import keeps its source ids."""
    h = 0
    for ch in seed:
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return 'fd-' + format(h, '08x')


def render(pdf, frame, tmp):
    out = os.path.join(tmp, 'f.png')
    r = subprocess.run([CROP, pdf, str(frame['page'])] +
                       [str(v) for v in frame['box']] + [str(SCALE), out],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        sys.exit('render failed for %s / %s: %s' % (frame['set'], frame['option'], r.stderr.strip()))
    w, h = (int(v) for v in r.stdout.strip().split(' ')[0].split('x'))
    data = base64.b64encode(open(out, 'rb').read()).decode('ascii')
    os.remove(out)
    return 'data:image/png;base64,' + data, h / w


def build(pdf, book):
    now = int(time.time() * 1000)
    tactics, order = {}, []
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(book, 1):
            side, category = SECTIONS.get(f['section'].strip().lower(),
                                          ("Offence", f['section'].strip()))
            tid = uid('set:' + f['set'])
            if tid not in tactics:
                tactics[tid] = {'id': tid, 'name': f['set'], 'side': side, 'category': category,
                                'note': '', 'options': [], 'createdAt': now, 'updatedAt': now}
                order.append(tid)
            t = tactics[tid]

            oid = uid('opt:' + f['set'] + '/' + f['option'])
            opt = next((o for o in t['options'] if o['id'] == oid), None)
            if opt is None:
                # A play printed in several blocks down the page, with its own
                # branches in between, is one option with its courts in reading
                # order - not three options that happen to share a name.
                opt = {'id': oid, 'name': f['option'], 'points': '', 'diagrams': []}
                t['options'].append(opt)

            image, aspect = render(pdf, f, tmp)
            opt['diagrams'].append({
                'id': uid('dg:%s/%s/%d' % (f['set'], f['option'], len(opt['diagrams']))),
                # A FastDraw full court is drawn portrait and this app's is
                # landscape, so the picture carries its own aspect and `court`
                # only decides how wide the ink is scaled on top of it.
                'court': 'full' if aspect > 1.4 else 'half',
                'size': 'M', 'caption': f['caption'], 'strokes': [],
                'image': image, 'aspect': round(aspect, 4),
            })
            print('  %2d/%d  %-12s %-16s %s' % (i, len(book), f['set'], f['option'],
                                                f['caption'][:40]), file=sys.stderr)
    return [tactics[t] for t in order]


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pdf, out = sys.argv[1], sys.argv[2]
    if not os.path.exists(CROP):
        sys.exit('build the renderer first:\n'
                 '  swiftc -O tools/fastdraw-crop.swift -o %s' % CROP)

    book = read_book(pdf)
    if not book:
        sys.exit('no frames found - is this a FastDraw playbook PDF?')
    print('%d courts across %d pages' % (book and len(book), max(f['page'] for f in book)),
          file=sys.stderr)

    tactics = build(pdf, book)
    # A backup the app already knows how to merge, carrying tactics and nothing
    # else, so importing this cannot touch the drills, the diary or the roster.
    doc = {'version': 6, 'updatedAt': int(time.time() * 1000),
           'drills': [], 'practices': [], 'events': [], 'players': [], 'tactics': tactics}
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out, 'w') as fh:
        json.dump(doc, fh)

    opts = sum(len(t['options']) for t in tactics)
    dias = sum(len(o['diagrams']) for t in tactics for o in t['options'])
    print('\n%d sets, %d options, %d courts -> %s (%.1f MB)'
          % (len(tactics), opts, dias, out, os.path.getsize(out) / 1024 / 1024), file=sys.stderr)
    for t in tactics:
        print('  %-12s %s' % (t['name'], ' · '.join(
            '%s (%d)' % (o['name'] or '—', len(o['diagrams'])) for o in t['options'])), file=sys.stderr)


if __name__ == '__main__':
    main()
