# Practise Organiser

A single-user season diary for a basketball coach. Not a product, not multi-tenant,
not a team tool — one coach, one iPad, and an archive that outlives any one club.

## What it is for

Six pillars, in Dusan's own framing:

1. **Practice sheets** — court diagrams drawn by Apple Pencil, with text beside them.
2. **Schedule** — weekly and monthly planning across a season.
3. **Tactics** — the current team's complete tactical package and how each option is executed.
4. **Roster** — a profile per player: physical, tactical, technical, psychological;
   individual workout plans and their progress.
5. **Print / export** — practices and schedules out to paper or PDF.
6. **Archive** — nothing is deleted at season end. The whole thing is a personal,
   transferable knowledge book that travels from team to team, season to season.

## Decisions made, and why

### Ink is a picture; data is a fact (2026-08-20)

Handwriting cannot be counted, searched, or charted — it is strokes, not text.
"Export data so it can be analyzed" and "write everything with the Pencil" therefore
pull against each other. This was raised with Dusan explicitly rather than decided quietly.

**His call: draw the courts, type the facts.** Court diagrams and margin notes stay as
real handwriting. Drill names, durations, dates, focus tags, and player ratings are typed
or tapped from a list. Those typed fields are the only things that can later answer
"show me every pick-and-roll drill I ran in November" or chart a player's progress.

Consequence for the data model: every practice has a **structured spine** (typed, queryable)
and an **ink layer** (strokes, rendered). Never let a fact live only in ink.

### Platform: prove the Pencil before committing (2026-08-20)

The whole app hinges on whether web-based Apple Pencil input feels good enough. Rather than
assert it does, the first build is a throwaway-able spike: `pencil-test.html`, one court,
nothing else. Dusan draws on it on his own iPad and we choose from real feel.

- **If it feels right** → web app (PWA), added to the iPad Home Screen. No Apple Developer
  account, no $99/year, no Xcode, and changes are testable seconds after they are made.
- **If it does not** → native iPadOS with SwiftUI + PencilKit. Better ink, but a build-and-
  install step before Dusan can see anything, which badly slows a non-coder's feedback loop.

*Status (2026-08-20): Dusan tried it and called the ink "good enough". Web is the working
assumption. One thing outstanding — he uses an **Apple Pencil Pro**, which was not known when
the spike was written. See below.*

### Apple Pencil Pro (2026-08-20, open)

Pencil Pro adds squeeze, barrel roll, haptics and hover over Pencil 2. Safari exposes far less
of this than a native app does:

| Feature | Web | Native |
|---|---|---|
| Hover | yes — `pointermove` with `buttons === 0` | yes |
| Barrel roll | **no** — `twist` never fires (tested on device) | yes, `UIPencilInteraction` |
| Squeeze | **no** — `buttons` only ever 0 and 1 (tested on device) | yes |
| Haptics | no — Safari on iPad has no vibration support | yes |

**Settled on device.** Dusan probed his own Pencil Pro: barrel roll never reported, buttons only
ever 0 and 1. Safari exposes none of the Pencil Pro extras. Since the only gains were two
shortcut gestures, native could not justify $99/year plus a build step. **Web app confirmed.**

Hover was built and then **removed at his request** — "it's only noise on the board. If I don't
like where the line started, I will erase it and draw a new one." He is right: a marker chasing
the nib across a diagram meant to be read is clutter. Do not reintroduce it.

**If squeeze turns out to matter to him**, the escape hatch is Capacitor: keep the entire web app
and wrap it in a thin native shell whose plugin forwards squeeze and double-tap into the page.
That buys the gestures without a Swift rewrite — but it still needs the Apple Developer account
and an Xcode build step, which is the actual cost being avoided.

### The drill library inverts the model (2026-08-20) — Dusan's call

Dusan redirected mid-conversation, and he was right. The original plan had drills written
*inside* a practice. He proposed the opposite: **a drill is a thing that exists on its own,
and a practice is a list of which drills were run.** He described his real workflow — "we don't
use 100 drills, we have maybe 20 and we combine them" — and logging a practice as "just several
taps" after the session.

Three reasons this is better, and the third is the important one:

1. Each drill is drawn once, ever, then reused all season.
2. Logging a practice becomes taps, not drawing — which means it actually gets done.
3. **It is what makes the analysis trustworthy.** A drill name typed fresh into 34 practices is
   34 unrelated strings and one typo away from being 35. The same drill *referenced* 34 times is
   a countable fact. The export Dusan asked for only works because of this change.

The drill library is also the literal form of the transferable knowledge book — that is the thing
that moves to a new club; practices are just the record of which nights it was used.

**Open questions, deliberately deferred to the practice-sheet stage** (they do not block the
library, so they were not asked prematurely):

- *Drill editing.* If a drill is redrawn in March, do October's practices show the old or new
  version? Planned answer: one living drill, everything shows current; when editing a drill that
  has already been used, offer "update everywhere" or "save as a new variation".
- *Per-session variation.* A drill run on a given night may need its own note or a scribble on
  top of the stored diagram. Optional, never required — the normal path stays taps-only.

## Stage 1: the drill library (`index.html`)

Built 2026-08-20. Create a drill; name it; set focus tag, group format, typical minutes,
intensity (1-5) and coaching points; draw as many court diagrams as it needs (Dusan's point that
5:0 wants a *sequence*, not one picture), each independently half/full court and S/M/L.

### Storage: why the artifact sandbox could not be the home (2026-08-20)

First attempt used `localStorage` inside the published artifact. Dusan tested it and reported the
drill was gone after quitting and reopening — the preview sandbox does not keep storage between
sessions. This is not fixable from inside the sandbox, and `artifact.publish()` is no answer
either: it reloads the whole page on every save and carries a size ceiling. **An app written into
daily for years needs its own origin.**

Current design:

- **IndexedDB** as the store, one record per drill, so saving a drill does not rewrite the whole
  library. Falls back to `localStorage`, then to memory.
- `navigator.storage.persist()` is requested at boot, asking Safari not to evict the data.
- A **service worker** caches the app shell so it opens in a gym with no signal. Coaching data
  needs no caching — IndexedDB is offline by nature.
- The library page **always states the truth** about whether work is being kept: a banner for
  preview / fallback / not-saving-at-all, and silence only in the good case. After losing work
  once, silence has to mean "genuinely saved".
- Export / import of a JSON backup via the `downloads` capability, always available.

Deployment is **GitHub Pages from the root of `main`** — live at
<https://coachdusan.github.io/practise-organiser/>. Push is the deploy; there is no separate step.
**Bump `VERSION` in `sw.js` on every deploy** or iPads keep serving the cached old shell.

The app files sit at the **repo root**, not in a `site/` subfolder (2026-08-22). Pages only offers
the root or `/docs` as a publish source, and with the app one level down the short, memorable URL
served the README through Jekyll instead of the app. Moving the files up made the link Dusan
already had be the app, with no GitHub settings for him to touch. `.nojekyll` at the root stops
Pages treating the app as a blog. Every path inside the app is relative, so nothing broke — and
Safari scopes IndexedDB per *origin*, so the drills saved under the old `/site/` address were
still there at the new one.

Measured: ~590 KB for 20 drills x 2 diagrams. IndexedDB has room for far more than the stated ~20.

### Stroke compression (verified, not assumed)

Two stages, because a season of ink adds up:

1. **Ramer-Douglas-Peucker** simplification on commit, epsilon 0.0018. Measured: 5x reduction on
   a scribble, 300x on a straight line, with a worst-case deviation of **2.6 cm on a 15 m court**
   (0.17% - invisible). Chunked at 400 points so deep recursion cannot blow the stack.
2. **Delta-packed integers** on save. Coordinates to 1/10000 of the court, pressure to two
   places, each point stored as a delta from the last. Measured **5.8x smaller** than the raw
   objects, round-tripping with a worst error of **0.073 cm** and a stable re-serialisation.

### Bug worth remembering: the recursive `touch()`

Migrating call sites to a `touch(drill)` helper with a regex also rewrote the line *inside*
`touch()` itself, so it called itself forever — the app would have blown its stack on the first
keystroke. It parsed fine; only running it caught it. The storage layer is now covered by a
headless test (fake IndexedDB under JavaScriptCore) that adds a drill, simulates quitting, and
asserts the drill and its ink come back. Run it before shipping any storage change.

### Finger scrolling vs Pencil drawing

`touch-action: pan-y` on a canvas looked like the tidy way to let a finger scroll while the
Pencil draws, but the browser may begin a pan before `preventDefault()` is honoured — meaning a
downward pen stroke could scroll the page instead of drawing. Not worth gambling a first
impression on. The canvases are `touch-action: none`, and a finger drag over a court is turned
into a `window.scrollTo` by hand. Deterministic, both behaviours controlled.

## Stage 2: the practice log (2026-08-22)

The library had no consumer: drills were drawn and then sat there. A practice is
a dated list of which drills were run — the thing Dusan's inversion was for.

### Plan and fact are the same record, separated by a status — Dusan's call

Two of his requirements pulled against each other. Logging is *"a few taps after
the session"*, but a practice sheet is also something you **print and carry into the
gym**, which means it exists before the session. Presented as a choice; he took the
one that keeps both without letting the archive lie.

A practice carries `status: "planned" | "done"`. It can be built at any time. Nothing
counts until he marks it done, and the screen says so in as many words while it is
still a plan. The review step is not a modal — the drill list is already on screen, so
"take out what you did not get to, then mark it done" needs no extra machinery.

**The rule this enforces: an intention is never reported as a fact.** Plan six drills,
run four, and the archive says four.

### What a practice holds

`{ id, date, status, items: [{ id, drillId, name, minutes }], note }`

- **No ink of its own.** The diagram lives once, in the drill.
- `drillId` is the fact; `name` is a label to fall back on. Counting always goes
  through the id, never the string — that is the whole point of the library.
- The name snapshot exists so a session from October still reads sensibly after the
  drill is deleted in March. Deleting a used drill now says how many practices it is
  in before it goes.
- `minutes` is per-item and defaults from the drill, because the same drill runs 10
  minutes one night and 20 the next.

### The first countable fact

Drill cards now read **"Run in 7 practices"** — completed sessions only, counted once
per session even if the drill appears twice in one. It is the smallest possible proof
that the library model works, and the shape every later export takes.

### Storage: database version 1 → 2

A second object store, `practices`. The upgrade only creates what is missing, so a
library written under version 1 is carried across untouched. One save queue serves
both kinds of record: `dirty` maps a record id to the store it belongs in.

Dates are parsed by hand rather than through `new Date(string)` — `"2026-08-25"` fed
to the Date constructor is read as UTC and comes back as the 24th in a western
timezone, which would file a session on the wrong day.

### The test now exists, and is committed

`test/run.sh` — headless, under JavaScriptCore, with IndexedDB, localStorage and a
slice of the DOM faked. It seeds a **version 1** database with drills and packed ink,
upgrades it, quits, reopens, and checks everything came back; it checks that planned
practices are not counted; that pre-practices backups still import; that the
localStorage fallback round-trips; and it renders every screen, which is the class of
bug that parses fine and only appears when the thing is run. 36 checks.
**Run it before shipping any storage change.**

### Still deferred, still not blocking

Drill versioning (redraw in March: what does October show?) and a per-session
scribble on top of a stored diagram. The practice log works without either, and
neither should be guessed at before Dusan has run real sessions through this.

## The ink engine (first proved in `pencil-test.html`)

Worth keeping whichever platform wins, because the reasoning carries over.

- **Two canvas layers.** `#base` holds finished strokes; `#live` holds only the stroke in
  progress. Finished work is never repainted mid-stroke.
- **Three tools, three render strategies** — this is the non-obvious part:
  - *Pen* is opaque, so overlapping paths are invisible and only the newest segment needs
    drawing as it arrives. Lowest latency.
  - *Marker* is semi-transparent, so drawing it segment-by-segment would darken every overlap
    and the stroke would come out blotchy. It is drawn as **one path** at constant width,
    repainted whole on the live layer. Verified: 1 `stroke()` call regardless of length.
  - *Eraser* has to cut into finished work, so it writes to the base layer directly.
- **`getCoalescedEvents()`** returns every Pencil sample rather than one per frame. This is
  the single biggest factor in whether the line keeps up with the nib.
- **Palm rejection** is `pointerType === "pen"`; touch is ignored unless "Finger draws" is on.
  Mouse always draws, so the thing can be checked on a laptop.
- **Points are stored normalised (0..1)**, not in pixels, so strokes survive rotation, resize,
  and switching between half and full court.
- **Pressure → width**, `0.35 + 0.85 × pressure`. Roughly a 3× taper from light to hard.

## Court geometry

FIBA, in centimetres. Verified against spec, not eyeballed:

- Court 2800 × 1500; half court 1500 × 1400.
- Key 490 wide × 580 long. Free-throw circle r=180, dashed inside the key.
- Three-point arc r=675 from the basket centre (750, 157.5), with corner straights at
  x=90 / x=1410 running from the baseline to y=299 — the exact point the arc meets them.
- No-charge semicircle r=125. Backboard 180 wide at y=120. Rim r=22.5.

The full court reuses the half-court marks through two SVG matrices:
`matrix(0 1 1 0 0 0)` for the left end, `matrix(0 1 -1 0 2800 0)` for the right. A half court
is left-right symmetric, so the transpose costs nothing and saves duplicating every path.

## Working notes

- Build in stages and ship each one. Dusan reacts to real things, not descriptions.
- Verify by actually running it. The court geometry above was checked by rasterising the SVG
  and looking at it; the ink pipeline by unit-testing the render calls under JavaScriptCore.
- Before proposing a new field or a migration, check whether the data is already recorded
  and simply not shown.
