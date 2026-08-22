# Practise Organiser

A season diary for a basketball coach: a reusable drill library, practice sheets,
tactics, roster, and an archive that carries from club to club.

## Running it

The app is plain static files — no build step, no dependencies.

    cd site && python3 -m http.server 8777

Then open <http://127.0.0.1:8777>.

## Deploying

Drag the **`site`** folder onto <https://app.netlify.com/drop>.

After changing anything in `site/`, bump `VERSION` in `site/sw.js` before
redeploying, or iPads will keep serving the cached old copy.

## Layout

    site/                     the app
      index.html              everything: UI, ink engine, storage
      sw.js                   offline shell cache
      manifest.webmanifest    Home Screen install
      icon.svg                app icon
    archive/
      pencil-test.html        the Apple Pencil spike that chose the platform
    CLAUDE.md                 decisions and the reasoning behind them

## Copyright

© Dusan Markovic. All rights reserved.

No licence is granted. The source being publicly readable does not permit anyone to
use, copy, modify or distribute it. This is the default under copyright law and is
stated here only so the position is explicit.
