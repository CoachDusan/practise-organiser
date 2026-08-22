# Practise Organiser

A season diary for a basketball coach: a reusable drill library, practice sheets,
tactics, roster, and an archive that carries from club to club.

## Running it

The app is plain static files — no build step, no dependencies.

    python3 -m http.server 8777

Then open <http://127.0.0.1:8777>.

## Deploying

GitHub Pages serves the repo root of `main`. Commit and push, and the live app at
<https://coachdusan.github.io/practise-organiser/> updates within a minute or two.

After changing any app file, bump `VERSION` in `sw.js` before pushing, or iPads
will keep serving the cached old copy.

## Layout

    index.html                the app: UI, ink engine, storage
    sw.js                     offline shell cache
    manifest.webmanifest      Home Screen install
    icon.svg                  app icon
    .nojekyll                 stops GitHub Pages processing the app as a blog
    tools/
      import-from-drill-management.py   converts the other app's library
    private/                  club data — gitignored, never committed
    test/
      run.sh                  storage tests — run before shipping storage changes
      storage-test.js         headless, under JavaScriptCore
    archive/
      pencil-test.html        the Apple Pencil spike that chose the platform
    CLAUDE.md                 decisions and the reasoning behind them

## Copyright

© Dusan Markovic. All rights reserved.

No licence is granted. The source being publicly readable does not permit anyone to
use, copy, modify or distribute it. This is the default under copyright law and is
stated here only so the position is explicit.
