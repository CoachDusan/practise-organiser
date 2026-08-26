/* Practise Organiser — offline shell.
   The app's own files are cached so it opens in a gym with no signal. Coaching
   data is NOT here: that lives in IndexedDB, which is offline by nature. Bump
   VERSION whenever the shell changes, so old copies are cleared out. */

var VERSION = "po-shell-v22";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

/* THE BUG THAT MADE BUMPING VERSION USELESS (2026-08-24)
   `cache.addAll()` fetches through the browser's ordinary HTTP cache. GitHub
   Pages serves index.html with a ten-minute max-age, so a bump created a brand
   new cache and then filled it with the SAME STALE HTML the browser already
   had. The version changed, the content did not, and because the fetch handler
   below was cache-first with no revalidation, that stale copy was then served
   for good. Dusan reloaded and saw no change, repeatedly.

   Every shell file is now requested with `cache: "reload"`, which bypasses the
   HTTP cache and forces a real network fetch. */
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          return fetch(new Request(u, { cache: "reload" })).then(function (res) {
            if (res && res.ok) return c.put(u, res);
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === VERSION ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  // Google Fonts: serve from cache when present, otherwise fetch and keep a copy.
  if (url.hostname.indexOf("fonts.g") === 0 || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () { return hit; });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* The app itself is network-FIRST: with a signal, a reload always gets the
     current app, and the cache is the fallback for a gym with none. Cache-first
     was wrong for a file that changes every time something is fixed - it meant
     the only way to see a change was a version bump, and the bug above meant
     the bump did not work either.

     Everything else (icon, manifest, fonts) is still cache-first: those change
     almost never and opening should not wait on them. */
  var isDoc = req.mode === "navigate" ||
              (req.headers.get("accept") || "").indexOf("text/html") >= 0;

  if (isDoc) {
    e.respondWith(
      fetch(new Request(req.url, { cache: "reload" })).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put("./index.html", copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("./index.html").then(function (hit) {
          return hit || caches.match("./");
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("./index.html");
      });
    })
  );
});
