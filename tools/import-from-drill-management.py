#!/usr/bin/env python3
"""Turn a drill-management backup into a Practise Organiser import file.

    tools/import-from-drill-management.py \
        ~/Documents/GitHub/drill-management/private/drill-library.json \
        private/drills-import.json

The two apps describe a drill differently, and the differences are decisions,
not plumbing:

  intensity   Carried across untouched on its own 1-10 scale, decimals and all.
              36 of the 43 are real club measurements; rounding them into the
              old 1-5 pips would have thrown that measurement work away.
  load        court / situation / rhythm / contact / measured are kept on the
              drill even though no screen shows them yet. They are facts that
              were expensive to gather, and losing them in a format conversion
              would be the one thing that cannot be undone.
  court size  A full-court drill gets a full-court blank diagram, a half-court
              one gets a half. Read from the source data, not guessed.
  format      Left blank. Only half the names map onto the app's list, and a
              half-filled field reads as a bug.
  id          The source id is kept, so importing the same file twice updates
              the drills instead of duplicating them.

The club's measured values are private data. Write the output somewhere
gitignored, and never commit it.
"""

import json
import sys
from datetime import datetime

TAGS = {
    "Transition":       "Transition",
    "Offense":          "Offence",
    "Defense":          "Defence",
    "Shooting":         "Shooting",
    "Conditioning":     "Conditioning",
    "Live / scrimmage": "Live / scrimmage",
}

# drill-management court levels: 5 full, 4 three-quarter, 3 half, 2-1 smaller.
def court_for(level):
    return "full" if (level or 0) >= 4 else "half"


def epoch_ms(iso, fallback):
    if not iso:
        return fallback
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return fallback


def convert(src_path):
    src = json.load(open(src_path))
    drills = src.get("data", {}).get("drills", [])
    out = []
    unmapped = set()
    now = int(datetime.now().timestamp() * 1000)

    for i, d in enumerate(drills):
        if d.get("archived"):
            continue
        cat = d.get("category")
        if cat and cat not in TAGS:
            unmapped.add(cat)
        made = epoch_ms(d.get("createdAt"), now)
        level = d.get("court")
        kind = court_for(level)
        out.append({
            "id": d["id"],
            "name": d.get("name", ""),
            "tag": TAGS.get(cat, cat or ""),
            "format": "",
            "minutes": d.get("typicalMinutes") or 0,
            "intensity": d.get("intensity"),
            "points": (d.get("notes") or "").strip(),
            "diagrams": [{
                "id": d["id"] + "-g1",
                "court": kind,
                "size": "L" if kind == "full" else "M",
                "caption": "",
                "strokes": [],
            }],
            "load": {
                "mode": d.get("intensityMode"),
                "court": level,
                "situation": d.get("situation"),
                "rhythm": d.get("rhythm"),
                "contact": d.get("contact"),
                "measured": d.get("measured"),
            },
            "createdAt": made,
            "updatedAt": made,
        })

    if unmapped:
        print("categories with no tag mapping: " + ", ".join(sorted(unmapped)), file=sys.stderr)

    return {"version": 2, "updatedAt": now, "drills": out, "practices": []}


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    result = convert(sys.argv[1])
    with open(sys.argv[2], "w") as f:
        json.dump(result, f, indent=1)

    drills = result["drills"]
    measured = sum(1 for d in drills if d["load"]["mode"] == "measured")
    full = sum(1 for d in drills if d["diagrams"][0]["court"] == "full")
    print("%d drills written to %s" % (len(drills), sys.argv[2]))
    print("  %d with a measured intensity, %d from the grid" % (measured, len(drills) - measured))
    print("  %d full-court blanks, %d half-court" % (full, len(drills) - full))
    tags = {}
    for d in drills:
        tags[d["tag"]] = tags.get(d["tag"], 0) + 1
    for t, n in sorted(tags.items(), key=lambda x: -x[1]):
        print("  %-18s %d" % (t, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
