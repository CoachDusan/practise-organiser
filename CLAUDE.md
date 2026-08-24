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

## Importing the 43 drills from `drill-management` (2026-08-22)

Dusan's other app, `~/Documents/GitHub/drill-management`, already held his real library:
43 drills, 36 of them with **club-measured** intensity values, 7 derived from that app's
validated grid. Converted by `tools/import-from-drill-management.py`.

### The club's data is private, and this repo is public

`drill-management/.gitignore` says of `private/`: *"The club's own data. Never committed,
never published."* Practise Organiser is served from a **public** GitHub Pages repo, so
committing the drills here would publish the measured values on the open internet.

`private/` is therefore gitignored here too, and the import file is written into it. The
file reaches the iPad by AirDrop, not by the web. **Consequence to remember: Export backup
now produces a file containing club-measured values — it is club data, not a scratch file.**

### Intensity widened from 1-5 to 1-10 — Dusan's call

The two apps disagreed about the scale. Practise Organiser had five pips, chosen quickly in
stage 1 and used by nothing. `drill-management` has 1-10, anchored to Borg CR-10, fitted to
27 club measurements at R-squared 0.93. Squashing 8.59 into "4" would have destroyed the only
part of either app that was measured rather than assumed.

Presented as a choice; he took the wider scale. Measured values keep their decimals. The pips
mark the **nearest whole number** and the exact figure is printed beside them with the word
*measured* while it is untouched, so tapping a pip is always a deliberate change and never a
silent rounding. Any drill created here before this change keeps its old 1-5 number, so the
handful made while testing stage 1 are worth re-checking.

### What else came across, and what deliberately did not

| Source | Here | Why |
|---|---|---|
| `intensity` (1-10) | `intensity` | Untouched, decimals kept. |
| `court` / `situation` / `rhythm` / `contact` / `measured` | `load` on the drill | Kept although no screen shows them. They were expensive to gather and a format conversion is the wrong place to lose them. |
| `category` | `tag` | Mapped; `Offence` and `Live / scrimmage` added to `TAGS`, spellings normalised to `Defence`. |
| `court` level | the blank diagram's half/full | Read from the data, not guessed: level 4-5 gets a full court to draw on, 3 and below a half. |
| `typicalMinutes`, `notes`, `id` | `minutes`, `points`, `id` | Direct. Keeping the source id means re-importing updates rather than duplicates. |
| — | `format` | **Left blank, deliberately.** Only 21 of 43 names map onto the app's list; the rest are compound ("5 on 0 & 3 on 2 & 2 on 1") or uneven ("3 on 2"). Half-filled reads as a bug, and the name already says it. Dusan's call. |
| — | diagrams | Every drill gets one empty court. None of these drills has ever been drawn; that is now the work. |

### Import is no longer replace-only

Handing a coach a 43-drill file when the only import mode wipes the app was a footgun. Import
now asks: **add to what is here**, or **replace everything** (with a second confirmation naming
what would be destroyed). Merging matches on drill id, so the same file can be imported twice
without doubling the library.

## Stage 3: the schedule (2026-08-22)

Offered load tracking, the schedule, the roster and tactics. Dusan took the schedule.

### It carries the whole season, not only the nights he coaches — his call

Asked what belonged on it: practices only, practices and games, or everything that eats a
week. He took **everything**: games, tournaments, travel, days off, gym unavailable, and
free notes. His reasoning holds — a calendar showing only practices is empty on the days
that decide what the practices should be.

The cost is honest and was stated: a calendar only helps if it is kept current, and this
is the version that asks the most of him.

### One record type with a `kind`, not six

`{ id, date, time, kind, title, venue, scoreUs, scoreThem, note }`. Six near-identical
record types would have meant six editors and six migrations. `kind` drives what the sheet
shows: a game gets opponent, home/away/neutral and a score; everything else gets a title
and a note.

Practices gained an optional `time` at the same time, because a practice sitting next to a
19:00 game on a calendar needs to say when it is.

### The season record only says what the data supports

`seasonRecord()` counts wins and losses from games that have **both** scores filled in. A
game with no score is reported as *still to play* — never as a draw, and never quietly
dropped. The event sheet says so in as many words, because an empty score box is otherwise
exactly the kind of thing that turns into a wrong number.

### Week is the working view, month is the overview

The week is seven day rows, each with everything on it in time order — it is where a coach
decides what Thursday looks like given Saturday's game. The month is a six-row grid, always
six so it does not jump height between months; tapping a day drops into that week.

Weeks start **Monday**. A basketball week runs to the weekend game.

Colour is carried on the left edge of each chip so a week reads at a glance without a legend.

### Storage: database version 2 → 3

A third object store, `events`. Same upgrade rule as before: create only what is missing,
so an existing library and diary come across untouched. Verified in `test/run.sh` — now 72
checks, including that a backup written before the schedule existed still imports.

### Two changes that were not asked for, and can be reversed

The tabs are now **Schedule · Practices · Drills**, and the app **opens on the week** rather
than the drill library. A season diary's front page is what is happening, not the reference
book. Both are one line to change back if he prefers.

## Stage 4: roster and attendance (2026-08-22)

Chosen over session load for one reason, stated to Dusan before he chose: **load can wait
at no cost, attendance cannot.** Load is computed from intensity and minutes, both already
stored, so building it in November would still cover every practice back to today. Who was
in the gym is only knowable on the night.

### Assessments are dated snapshots, not a rating you overwrite — Dusan's call

A player holds facts that rarely change (name, number, position, born, height) and a list
of **assessments**, each with a date and a 1-10 rating for physical, tactical, technical and
psychological. Rating in place would have meant every update erased what he thought before,
leaving a present state and no progress. He took the snapshot version.

`null` means *not rated*, which is not a low rating. It is drawn as a gap in the line and
never as a zero.

Ratings are 1-10 — the same scale as drill intensity, so the app has one number scale rather
than two.

### Attendance is per practice, three states — Dusan's call

`in` (1), `part` (0.5), `out` (0), matching the participation scale `drill-management`
already used, but taken once per session rather than per drill. Offered per-drill accuracy;
he took per-practice, on the same reasoning that made practice logging taps-only: attendance
that does not get recorded is worth nothing.

**The honesty rule, and it matters more than the arithmetic:** a player with no mark is *not
recorded*, which is not the same as absent. They are excluded from the calculation entirely.
A practice where nobody was marked counts towards nobody's attendance, and a **planned**
practice never counts at all. The screen says both of these in as many words.

### The progress chart

Four series over time. Built against the `dataviz` skill's procedure rather than by eye:

- Palette is the reference categorical theme's dark steps, slots 1-4
  (`#3987e5 #d95926 #199e70 #c98500`), **validated by running the skill's checker** against
  this app's own panel surface `#24221D` under JavaScriptCore, since there is no node here.
  All five computable checks pass: lightness band, chroma floor, CVD separation
  (worst adjacent ΔE 8.4), normal-vision floor (19.8), contrast (all ≥ 3:1).
- **The y axis is pinned to the full 1-10 scale.** Auto-scaling to the data would turn a
  one-point drift into a cliff — exactly the lie a coach would act on.
- **x is real elapsed time**, not one step per assessment, so two ratings a week apart sit a
  week apart and three months of nothing looks like three months of nothing.
- A null rating **breaks the line** rather than interpolating through it.
- Series names are direct-labelled at the line ends in text ink with a coloured dot beside
  them, never in the series colour; a legend is present as well.
- The assessment rows below the chart carry every number, so nothing is readable only as a
  colour — that is the table view.
- **One assessment is not a trend.** With a single assessment the chart is replaced by four
  bars showing current values, and a line only appears from the second assessment on.

### Storage: database version 3 → 4

A `players` store; attendance lives on the practice as `{ playerId: mark }` rather than in a
store of its own, because it is a property of that session. Same upgrade rule as ever.

`test/run.sh` is now **92 checks**. It caught a real bug on the way: `newPractice()` did not
create the attendance object, so the first practice made after this change would have thrown
when the register tried to render. It parsed fine. Only running it found it — the second time
that has been true in this project.

## Stage 5: tactics (2026-08-22)

### A set holds its options — Dusan's call

"Horns" is the set; Flare, Down and Slip are how it is actually run. Three options typed as
three separate entries would be three strings that happen to start with the same word. Held
as options of one set, they are one thing with three ways out of it — which is how it gets
explained to a player, and the same argument that made a drill a referenced record rather
than a retyped name.

A set always has at least one option. A set whose single option is unnamed reads as just
the set name ("Last shot"), so a one-thing tactic does not look half-filled.

### Defence is a side, not a category — Dusan's correction

The first category sketch led with offence and left defence looking like an afterthought.
He pushed back, and he was right. A tactic now carries a **side** — Offence, Defence, or
Special situations — and the category list is filtered by it, so defence has its own seven
categories rather than borrowing offence's. `categoriesFor("Defence")` does not contain
"Half-court sets", and there is a test that says so.

| Side | Categories |
|---|---|
| Offence | Half-court sets · Early offence · Zone offence · Press break · BLOB · SLOB · Delay |
| Defence | Man-to-man · Zone · Full-court press · Half-court trap · Transition defence · Defending out of bounds · Defending the pick & roll |
| Special situations | Last shot · End of quarter · Free-throw situations · Fouling and clock · Jump ball |

The list groups by side, then by category, so the package reads as a package.

### Tactics are loggable in a practice — Dusan's call

A practice item now carries a `kind`. Items written before tactics existed have no `kind`
and are read as drills, so nothing needed migrating. The picker gained a Drills / Tactics
toggle rather than a second button, because from the coach's side both are the same act:
this is what the session was spent on.

Chosen on the same reasoning as attendance — the drills he runs are being recorded from
tonight, and tactics not recorded alongside them would be a hole that cannot be filled in
later. Counted once per session, planned practices excluded, exactly like the drill tallies.
A set worked through two of its options in one night counts once for the set and once for
each option.

### The diagram editor stopped belonging to drills

`buildDiagram` took a `drill` and called `touch(drill)`. It now takes the diagram, the list
it lives in, and a save function, so drills and tactic options share one editor. Both ink
editors are rendered in `test/run.sh` against a stubbed canvas — the refactor is the kind
that parses perfectly and breaks one of two callers.

### Storage: database version 4 → 5

A `tactics` store. Options hold diagrams, so tactics deflate and inflate their strokes the
same way drills do — verified by round-tripping real ink through a restart.

`test/run.sh` is now **117 checks**.

## Changes after Dusan used it (2026-08-23)

Four things, all from actually holding the iPad. Every one is a case of the app asking him
to work its way instead of his.

### Typed, not scrolled

A wheel picker costs seconds per field and he already knows the number. Date of birth and
both practice times are now plain text boxes that parse what he types:

- **Date of birth: `DD.MM.YYYY`**, and it is forgiving — `5.3.2008`, `05.03.2008`, `5/3/2008`
  and `5-3-2008` all land on the same day. Age is shown beside it, computed from the full
  date rather than guessed from a year.
- **Times: `18`, `18:00`, `18.00`, `1830`** all normalise to `18:00`.

Validation happens on blur. A typo turns the box red and **is not saved over the last good
value** — the field never silently keeps something wrong. Refusals are deliberate:
`31.02.2008` is not a day, `03.25.2008` is not quietly read as American order, and `05.03.08`
is refused rather than guessing a century.

`birthYear` was what the roster held for a day. It is **never deleted**: until a full date is
typed, the old year is shown beside the field.

### Positions are G / F / C

`1 · Point guard` through `5 · Centre` was more precision than he wanted. The picker still
offers "Add new…", so anything more specific is one tap away.

### Practice time is from–to

A session now has a start and an end, and the app shows the length between them — but only
when both are real and the end is after the start. It never reports a negative or guessed
session length. The schedule shows `18:00–19:30` on the day.

The same typed control replaced the time picker on schedule events, since it was the same
widget and the same complaint.

### Categories open and close

*"Not just to see everything, and to have option to choose what I want to see."*

The drill library is now grouped by focus tag, and tactics by category within each side.
Every heading is a section that opens, with its count on the right, and a **Close all /
Open all** control above.

- **Closed is the default**, so forty-three drills open as six headings rather than a wall.
- The body of a closed section is **not built at all**, so nothing is drawn to show a heading.
- Which sections are open is remembered across restarts. It lives in `localStorage` under
  `practise-organiser/ui`, not in IndexedDB and **not in a backup** — it is a preference of
  this iPad, not part of the season's record. Every access is guarded, and storage being
  refused falls back to "closed" rather than breaking a screen.

The tag filter chips went with this: with the tag as the section heading, filtering to one
tag and collapsing the rest were the same act done twice.

`test/run.sh` is now **153 checks**, including every accepted and refused spelling of a date
and a time above, and that an open category is still open after a restart.

### The iPad clock was sitting on the menu (2026-08-23)

Reported from the device with a screenshot: the status bar was drawn over the top bar, so
the tabs could only be tapped on their lower half.

Cause: the app installs with `apple-mobile-web-app-status-bar-style: black-translucent`,
which is what makes it look full-screen — iPadOS then draws the clock and battery **over**
the page. `viewport-fit=cover` was already set; nothing ever padded for the inset.

The top bar and every page now pad by `env(safe-area-inset-top / left / right)`, and the ink
rail's sticky offset is `calc(49px + safe-top)` instead of a hardcoded 49. There is also a
**22px floor under the top inset while in standalone mode** — belt and braces, because if
`env()` ever reports 0 on an installed app the clock lands back on the menu, and in a browser
tab the media query does not apply at all.

### Why the date box looked like a different control (2026-08-23)

Also from a screenshot: date of birth sat higher and shorter than Number and Height beside it.

Nothing was wrong with the box. `.field` is a grid, and its rows stretched: the date field
carries a hint line under it ("17 years old", or the error), which made the row taller, so
the *other* fields stretched their inputs to match. The neighbours were wrong, not the date.

`.field { align-content: start; }` — contents keep their natural height and every box in a
row now lines up at the top. Same fix covers the practice From/To boxes.

### The assessment screen now explains itself (2026-08-23)

Dusan asked what "Assessments" meant and what to write in it. Fair question, and the answer
being only in a conversation was the actual bug — in six months the conversation is gone and
the boxes are still there.

Each area now carries its own one-line description **on the record**, shown in a
"What these mean, and how to score" block at the top of the section, and as a hover title on
the label in each row:

| Area | What it covers |
|---|---|
| Physical | Speed, strength, jumping, conditioning, size for his position |
| Tactical | Reading the game: spacing, decisions, running the sets, defensive rotations |
| Technical | The skills: shooting, handling, passing, footwork, finishing |
| Psychological | Competitiveness, coachability, composure late in a close game, consistency |

The block also states the three things that decide whether the numbers are worth anything,
and they are the honest ones:

- **The scale is his own.** There is no standard behind a 6. It only means something beside
  another number he gave — the same rule as the load AU in `drill-management`. Recommended
  anchor: the best player he would expect *at this level*, because that survives players
  coming and going, where scoring against the current squad does not.
- **Three or four times a season.** The value is in having September's number to hold
  December's against. Weekly ratings record mood, not development.
- **An empty box is "not rated", not a low score** — a gap in the line, never a drop.

The block starts **open** and stays closed once closed. That needed `ui.open` to store an
explicit 1 or 0 rather than "present means open", so a section with a default can still be
dismissed for good.

## The iPad was fighting the Pencil (2026-08-24)

Three reports from using it, and the first two turned out to be one cause.

### Load tracking is off the table — Dusan's call

*"I don't want to track Load at all. That's the job of S&C coach."* Session load was the
last deferred item from stage 4 and it is now closed, not parked. The intensity values are
still worth keeping — they are what `drill-management` measured, and they describe the drill
— but the app does not compute a load number from them and should not start.

### Scribble was turning ink into text

Drawing along the **top** of a court kept arriving as typed text in the box above it.

Cause: **Apple Scribble**. iPadOS converts Pencil handwriting into text in any *editable*
field near the nib, and its catch area reaches well past the box — the diagram's name input
sat 10px above the court, which is nothing. `preventDefault()` cannot help, because the
system decides before the page sees a pointer event.

There is no web API to switch Scribble off. But it only ever targets a field that **can be
typed into**, so the fix works on the mechanism: on the two ink screens every text box is
`readOnly` until it is deliberately tapped or tabbed into, and goes back to readonly on the
way out (`penSafe` / `armPenSafe`).

- `readOnly` is cleared on **pointerdown**, not on focus alone — iOS will not raise the
  keyboard for a field that was readonly at the moment it was tapped.
- `focus` clears it too, so a hardware keyboard can still tab in.
- Typing is unchanged: the box is already editable by the time the tap becomes focus.
- The gap under `.diagram-head` went 10px → 16px as well. Belt and braces, same as the
  status-bar inset floor.

### Circling a play was a text-selection gesture

Drawing a circle on a court turned the whole card blue. Same family of problem: iPadOS read
the Pencil loop as "select this text". `user-select: none` on `.editor`, given back to
`input` and `textarea` only, plus `-webkit-touch-callout: none` on the court.

Scoped to `.editor` deliberately rather than to `body` — courts only exist on the drill and
tactic editors, and everywhere else selecting text to copy is still worth having.

### The practice time boxes, and why `align-content` was not enough

Same complaint as the date of birth, different cause. `align-content: start` stopped rows
*stretching*, but the practice header still mixes a native `input[type=date]` with typed
From/To text boxes, and **iOS gives the native date control its own intrinsic height**. The
boxes were genuinely different sizes, not stretched.

`.field > input, .field > select { height: 40px; line-height: 20px; }` — 40 less 18px
padding less 2px border is exactly the 20px line box, so every control in a field row is the
same size on the device. `.adate` in an assessment row is deliberately outside this: it is a
compact row with its own smaller padding.

**Still inconsistent, not fixed:** practice date, event date and assessment date are still
native `input[type=date]` wheel pickers, while date of birth is typed. Worth raising, not
guessed at.

### The test harness was passing vacuously

`penSafe` calls `querySelectorAll("input[type=text], …")`. The fake DOM's selector engine
only understood `.class`, so it matched nothing and the new code "passed" without ever
running. It now understands comma-separated lists of `.class`, `tag` and `tag[attr=value]`,
and nodes record their listeners so a test can fire a real pointerdown and blur.

**Worth remembering: a green test against a stub proves nothing until the stub is checked.**
That is the third time in this project that something parsed fine and only running it found
the truth. `test/run.sh` is now **165 checks**, including that the boxes found are non-zero —
the assertion that would have caught this.

## Two more from using it (2026-08-24)

### He types the numbers; the box types the punctuation

*"I don't need to insert . and : — you know the format."* Right: on an iPad number
pad the punctuation is extra taps, and it is never in doubt. `05032008` now becomes
`05.03.2008` and `1830` becomes `18:30` as he types.

**The mask is read from the placeholder, not declared beside it.** `"DD.MM.YYYY"` and
`"18:00"` already state the format; writing it a second time is two things that drift
apart. Any alphanumeric in the placeholder is a slot, anything else is punctuation the
box supplies (`maskFrom`).

Two details that decide whether it feels right:

- **The separator arrives with the digit after it**, never dangling. `05` stays `05`;
  the dot appears when the third digit does. A trailing `05.` would make backspace
  ambiguous and look like the box is waiting for something.
- **Backspace always removes one thing.** Deleting a dot on its own would put it
  straight back on the next reformat, so a press would appear to do nothing; the digit
  it was guarding goes with it.

`maskFrom` refuses any placeholder containing a space. `"Who you play"` is a prompt,
not a pattern — the first version happily turned it into a mask, and the test that
caught it is in the suite.

Parsing is unchanged and still happens on blur: the mask only decides what the box
*looks* like, `parseDMY` / `parseTime` still decide what is true. `31.02.2008` is still
refused after being punctuated for him.

### Planning from the month left the schedule on the week

*"Every time I input practice in month view and I am done, it sends me to week view.
I want to stay in month view."*

Cause: tapping a day in the month grid did `route.smode = "week"` and stayed there.
It was documented as "tapping a day drops into that week", and as navigation it was
fine — but it silently and **permanently** changed his chosen view, so every later
visit to the schedule opened on the week.

Two changes, and the principle is that a mode should change because he asked, not as
a side effect of doing something else:

- **A day in the month opens that day's menu**, the same one the week's `+` opens, so
  a session can be planned from the month without leaving it. Going to the week is now
  an explicit **"Open this week"** option on that menu.
- **Items drawn on a month day are tappable**, so an existing practice or game opens
  directly rather than only through the week.

### A practice belongs to wherever it was opened from

The practice editor's crumb always said "‹ Practices", whatever screen he arrived
from. `go(view, id, from)` now carries the origin: opened from the schedule, the crumb
says "‹ Schedule" and goes back to the day, the week or the month he was planning in.
Deleting from there returns to the same place.

### The stub was hiding a whole code path

Adding a real blur to a typed field threw immediately: the fake DOM had no
`classList`, so `commit()` — the function that decides whether a typed date is
accepted or refused — **had never once run under test**, in either direction. It has
one now, and the suite exercises accept and refuse.

That is the second harness gap found in two days, and the same lesson as the vacuous
`querySelectorAll`: **the stub is part of the test, and a green run says nothing about
code the stub cannot reach.**

`test/run.sh` is now **192 checks**.

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
