/* Headless test for the storage layer, run under JavaScriptCore.
 *
 *   test/run.sh
 *
 * There is no browser here: IndexedDB, localStorage and a small slice of the
 * DOM are faked below, and the app's own <script> is pulled straight out of
 * index.html so the code under test is the code that ships.
 *
 * What it is guarding, in order of how much it would hurt to get wrong:
 *
 *   1. The version 1 -> 2 upgrade. A library written before practices existed
 *      must survive the day practices arrive, ink and all.
 *   2. Quit and reopen. Everything typed into a practice has to still be there.
 *   3. Only completed practices are counted, so the archive cannot report a
 *      plan as a fact.
 *   4. Backups from before practices existed still import.
 *   5. The screens render without throwing — the class of bug that parses fine
 *      and only shows up when the thing is actually run.
 */

var failures = 0, checks = 0;

function ok(label, cond, detail) {
  checks++;
  if (cond) { print("  ok   " + label); return; }
  failures++;
  print("  FAIL " + label + (detail != null ? "   (" + detail + ")" : ""));
}
function eq(label, got, want) { ok(label, got === want, "got " + got + ", wanted " + want); }

/* ============================ fake IndexedDB ============================
   Enough of the API for the app's DB wrapper: versioned open with an upgrade
   callback, a transaction that reports completion, and the four operations.
   The backing data lives outside any one app instance, which is what lets the
   test simulate quitting and reopening. */

function makeIndexedDB(backing) {
  function soon(fn) { Promise.resolve().then(fn); }

  function Store(name) {
    var rows = backing.data[name];
    return {
      getAll: function () { var r = { result: Object.keys(rows).map(function (k) { return rows[k]; }) }; return r; },
      put:    function (v) { rows[v.id] = JSON.parse(JSON.stringify(v)); return { result: v.id }; },
      "delete": function (id) { delete rows[id]; return { result: undefined }; },
      clear:  function () { backing.data[name] = {}; return { result: undefined }; }
    };
  }

  function DBHandle() {
    return {
      objectStoreNames: { contains: function (n) { return backing.stores.indexOf(n) >= 0; } },
      createObjectStore: function (n) {
        backing.stores.push(n);
        if (!backing.data[n]) backing.data[n] = {};
        return Store(n);
      },
      transaction: function (name, mode) {
        var t = { oncomplete: null, onerror: null, onabort: null };
        var store = Store(name);
        t.objectStore = function () { return store; };
        soon(function () { if (t.oncomplete) t.oncomplete(); });
        return t;
      }
    };
  }

  return {
    open: function (name, version) {
      var req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: null };
      soon(function () {
        req.result = DBHandle();
        if (version > backing.version) {
          backing.version = version;
          if (req.onupgradeneeded) req.onupgradeneeded();
        }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };
}

/* ============================== fake DOM ==============================
   Only what the views actually touch. It is not a browser; it exists so that
   render() runs for real and a typo in a view is a failing test, not a blank
   screen on an iPad in a gym. */

function makeDom() {
  function Node(tag) {
    var n = {
      tagName: tag, className: "", textContent: "", value: "", type: "",
      children: [], attrs: {}, style: {}, disabled: false,
      appendChild: function (c) { n.children.push(c); c.parentNode = n; return c; },
      removeChild: function (c) {
        var i = n.children.indexOf(c);
        if (i >= 0) n.children.splice(i, 1);
        return c;
      },
      remove: function () { if (n.parentNode) n.parentNode.removeChild(n); },
      setAttribute: function (k, v) { n.attrs[k] = String(v); },
      getAttribute: function (k) { return k in n.attrs ? n.attrs[k] : null; },
      addEventListener: function () {},
      removeEventListener: function () {},
      click: function () { if (n.onclick) n.onclick({ target: n }); },
      querySelector: function (sel) { return find(n, sel)[0] || null; },
      querySelectorAll: function (sel) { return find(n, sel); },
      focus: function () {}
    };
    Object.defineProperty(n, "innerHTML", {
      get: function () { return n._html || ""; },
      set: function (v) { n._html = v; if (v === "") n.children = []; }
    });
    return n;
  }

  function find(root, sel) {
    var out = [];
    var wantClass = sel.charAt(0) === "." ? sel.slice(1) : null;
    (function walk(n) {
      n.children.forEach(function (c) {
        if (wantClass && String(c.className).split(/\s+/).indexOf(wantClass) >= 0) out.push(c);
        walk(c);
      });
    })(root);
    return out;
  }

  var byId = {};
  ["saveChip", "app", "crumb", "tabs", "exportBtn", "importBtn", "importFile"].forEach(function (id) {
    byId[id] = Node("div");
  });
  // the two nav buttons the chrome iterates over
  ["library", "practices"].forEach(function (v) {
    var b = Node("button");
    b.setAttribute("data-view", v);
    byId.tabs.appendChild(b);
  });

  return {
    head: Node("head"),
    body: Node("body"),
    createElement: Node,
    getElementById: function (id) { return byId[id] || null; },
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: function () { return null; },
    _byId: byId
  };
}

/* ======================= load the app under test ======================= */

function appSource() {
  var html = readFile("index.html");
  var start = html.indexOf("<script>");
  var end = html.lastIndexOf("</script>");
  if (start < 0 || end < 0) throw new Error("could not find the app <script> in index.html");
  var src = html.slice(start + "<script>".length, end);

  // Reach inside the IIFE: name it, capture the boot promise, and hand back the
  // internals the test needs. The app file itself stays free of test scaffolding.
  var head = "(function () {";
  if (src.indexOf(head) < 0) throw new Error("app is not the expected IIFE");
  src = src.replace(head, "globalThis.__po = (function () {");

  var bootLine = "  initStore().then(function () {";
  if (src.indexOf(bootLine) < 0) throw new Error("boot call not found");
  src = src.replace(bootLine, "  var __boot = initStore().then(function () {");

  var tail = "})();";
  var at = src.lastIndexOf(tail);
  if (at < 0) throw new Error("IIFE tail not found");
  var exported =
    "\n  return { boot: __boot, state: state, Store: Store, go: go, render: render,\n" +
    "           newDrill: newDrill, newPractice: newPractice, newItem: newItem,\n" +
    "           touch: touch, touchPractice: touchPractice, flush: flush,\n" +
    "           removeDrill: removeDrill, removePractice: removePractice,\n" +
    "           usageMap: usageMap, findDrill: findDrill, findPractice: findPractice,\n" +
    "           serialize: serialize, deserialize: deserialize,\n" +
    "           practiceMinutes: practiceMinutes, prettyDate: prettyDate,\n" +
    "           openDrillPicker: openDrillPicker, route: route };\n";
  return src.slice(0, at) + exported + src.slice(at);
}

var SRC = appSource();

// Start the app against a given backing store, as if the iPad had just opened it.
function launch(backing, storage) {
  globalThis.document = makeDom();
  globalThis.indexedDB = makeIndexedDB(backing);
  globalThis.localStorage = storage;
  globalThis.navigator = { storage: { persist: function () { return Promise.resolve(true); } } };
  globalThis.setTimeout = function (fn) { return 0; };      // saves are flushed by hand
  globalThis.clearTimeout = function () {};
  globalThis.window = globalThis;
  globalThis.confirm = function () { return true; };
  globalThis.alert = function () {};
  globalThis.scrollTo = function () {};
  globalThis.print_ = function () {};
  globalThis.addEventListener = function () {};
  globalThis.claude = undefined;
  globalThis.__po = null;
  eval(SRC);
  return globalThis.__po.boot.then(function () { return globalThis.__po; });
}

/* ================================ the run ================================ */

var backing = { version: 1, stores: ["drills"], data: { drills: {} } };
var lsStore = (function () {
  var m = {};
  return {
    setItem: function (k, v) { m[k] = String(v); },
    getItem: function (k) { return k in m ? m[k] : null; },
    removeItem: function (k) { delete m[k]; }
  };
})();

// A library as it existed under database version 1: drills only, ink packed.
backing.data.drills["d-shell"] = {
  id: "d-shell", name: "Shell defence", tag: "Defence", format: "4v4",
  minutes: 15, intensity: 4, points: "Jump to the ball.",
  createdAt: 1, updatedAt: 1,
  diagrams: [{ id: "g1", court: "half", size: "M", caption: "Rotation",
               strokes: [{ t: "p", c: "#22201C", w: 7, d: [1000, 2000, 50, 500, 0, 2, -250, 300, -4] }] }]
};
backing.data.drills["d-pnr"] = {
  id: "d-pnr", name: "P&R read", tag: "Pick & roll", format: "Pairs",
  minutes: 20, intensity: 3, points: "", createdAt: 2, updatedAt: 2,
  diagrams: [{ id: "g2", court: "full", size: "L", caption: "", strokes: [] }]
};

var practiceId = null;

print("\n1. a version 1 library survives the upgrade to version 2");
launch(backing, lsStore).then(function (po) {
  eq("storage is IndexedDB", po.Store.kind, "idb");
  eq("both drills came back", po.state.drills.length, 2);
  eq("database is now at version 2", backing.version, 2);
  ok("the practices store was created", backing.stores.indexOf("practices") >= 0);
  var shell = po.findDrill("d-shell");
  ok("the drill kept its name", shell && shell.name === "Shell defence");
  ok("its ink was unpacked into points",
     shell && shell.diagrams[0].strokes[0].pts.length === 3,
     shell && JSON.stringify(shell.diagrams[0].strokes[0]).slice(0, 60));
  ok("the first point survived the round trip",
     Math.abs(shell.diagrams[0].strokes[0].pts[0].x - 0.1) < 1e-9,
     shell.diagrams[0].strokes[0].pts[0].x);
  eq("the diary starts empty", po.state.practices.length, 0);

  print("\n2. logging a practice");
  var p = po.newPractice();
  p.date = "2026-08-25";
  p.note = "Legs were heavy.";
  po.state.practices.unshift(p);
  practiceId = p.id;
  p.items.push(po.newItem(po.findDrill("d-shell")));
  p.items.push(po.newItem(po.findDrill("d-pnr")));
  p.items[0].minutes = 12;
  po.touchPractice(p);
  eq("total minutes add up", po.practiceMinutes(p), 32);
  eq("it starts as a plan", p.status, "planned");
  eq("a plan is not counted", po.usageMap()["d-shell"] || 0, 0);

  p.status = "done";
  po.touchPractice(p);
  eq("a completed session is counted", po.usageMap()["d-shell"], 1);

  po.flush();
  return Promise.resolve().then(function () { return po; });
})
.then(function (po) {

  print("\n3. quit the app and open it again");
  return launch(backing, lsStore);
})
.then(function (po) {
  eq("the drills are still there", po.state.drills.length, 2);
  eq("the practice came back", po.state.practices.length, 1);
  var p = po.findPractice(practiceId);
  ok("it kept its date", p && p.date === "2026-08-25", p && p.date);
  ok("it kept its note", p && p.note === "Legs were heavy.", p && p.note);
  eq("it kept both drills", p.items.length, 2);
  eq("it kept the edited minutes", p.items[0].minutes, 12);
  eq("it kept its status", p.status, "done");
  ok("the item still points at the drill by id", p.items[0].drillId === "d-shell");
  eq("the count survived the restart", po.usageMap()["d-shell"], 1);

  print("\n4. only completed sessions are counted");
  var plan = po.newPractice();
  plan.date = "2026-08-27";
  plan.items.push(po.newItem(po.findDrill("d-shell")));
  po.state.practices.unshift(plan);
  po.touchPractice(plan);
  eq("planning another one does not move the count", po.usageMap()["d-shell"], 1);
  plan.status = "done";
  eq("marking it done does", po.usageMap()["d-shell"], 2);

  var twice = po.newPractice();
  twice.status = "done";
  twice.items.push(po.newItem(po.findDrill("d-pnr")));
  twice.items.push(po.newItem(po.findDrill("d-pnr")));
  po.state.practices.unshift(twice);
  eq("the same drill twice in one session counts once", po.usageMap()["d-pnr"], 2);

  print("\n5. deleting a drill leaves the history readable");
  po.removeDrill("d-pnr");
  var p = po.findPractice(practiceId);
  eq("the practice still lists it by name", p.items[1].name, "P&R read");
  ok("the library no longer holds it", po.findDrill("d-pnr") === null);
  // The tally is keyed by drill id, so it survives the drill being deleted.
  // Nothing shows it any more — there is no card left to put it on — but the
  // history stays honest rather than silently rewriting itself.
  eq("past sessions still point at it", po.usageMap()["d-pnr"], 2);

  print("\n6. backups");
  var json = po.serialize(po.state);
  var round = po.deserialize(json);
  eq("drills survive export and import", round.drills.length, 1);
  eq("practices survive export and import", round.practices.length, 3);
  ok("ink survives export and import",
     round.drills[0].diagrams[0].strokes[0].pts.length === 3);

  var old = JSON.stringify({ version: 1, drills: [], updatedAt: 1 });
  var legacy = po.deserialize(old);
  ok("a backup written before practices existed still imports", !!legacy);
  eq("and restores an empty diary", legacy.practices.length, 0);

  print("\n7. the screens render");
  var errors = [];
  ["library", "practices"].forEach(function (v) {
    try { po.go(v); } catch (e) { errors.push(v + ": " + e); }
  });
  try { po.go("practice", practiceId); } catch (e) { errors.push("practice editor: " + e); }
  try { po.openDrillPicker(po.findPractice(practiceId)); } catch (e) { errors.push("drill picker: " + e); }
  ok("every screen built without throwing", errors.length === 0, errors.join(" | "));

  print("\n8. the smaller store, for a browser that refuses IndexedDB");
  var fresh = { version: 0, stores: [], data: {} };
  var lsOnly = lsStore;
  globalThis.__forceLocal = true;
  return launchLocal(fresh, lsOnly);
})
.then(function (po) {
  eq("it fell back to localStorage", po.Store.kind, "local");
  var p = po.newPractice();
  p.date = "2026-09-01";
  p.items.push(po.newItem({ id: "x", name: "Warm-up", minutes: 10 }));
  po.state.practices.unshift(p);
  po.touchPractice(p);
  po.flush();
  return Promise.resolve().then(function () {
    return launchLocal(null, lsStore);
  });
})
.then(function (po) {
  eq("the practice came back from localStorage", po.state.practices.length, 1);
  eq("with its drill", po.state.practices[0].items.length, 1);

  print("");
  print(failures ? "FAILED " + failures + " of " + checks + " checks"
                 : "all " + checks + " checks passed");
})
.catch(function (e) {
  print("");
  print("ERROR: " + (e && e.stack ? e.stack : e));
  print("FAILED");
});

// Same as launch(), but with IndexedDB missing entirely.
function launchLocal(_ignored, storage) {
  globalThis.document = makeDom();
  globalThis.indexedDB = null;
  globalThis.localStorage = storage;
  globalThis.navigator = { storage: { persist: function () { return Promise.resolve(true); } } };
  globalThis.setTimeout = function () { return 0; };
  globalThis.clearTimeout = function () {};
  globalThis.window = globalThis;
  globalThis.confirm = function () { return true; };
  globalThis.alert = function () {};
  globalThis.scrollTo = function () {};
  globalThis.addEventListener = function () {};
  globalThis.claude = undefined;
  globalThis.__po = null;
  eval(SRC);
  return globalThis.__po.boot.then(function () { return globalThis.__po; });
}
