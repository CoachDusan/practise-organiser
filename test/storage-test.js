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
  // Every 2d-context call is a no-op; the test is asking whether the editor
  // BUILDS, not what it paints. The ink maths has its own coverage.
  function fakeContext() {
    return new Proxy({}, {
      get: function (target, key) {
        if (key in target) return target[key];
        return function () { return undefined; };
      },
      set: function (target, key, value) { target[key] = value; return true; }
    });
  }

  function Node(tag) {
    var n = {
      tagName: tag, className: "", textContent: "", value: "", type: "",
      children: [], attrs: {}, style: {}, disabled: false,
      width: 0, height: 0, clientWidth: 460,
      getContext: function () { return n._ctx || (n._ctx = fakeContext()); },
      getBoundingClientRect: function () {
        return { left: 0, top: 0, width: 460, height: 400, right: 460, bottom: 400 };
      },
      setPointerCapture: function () {},
      releasePointerCapture: function () {},
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
  ["library", "practices", "schedule", "roster", "tactics"].forEach(function (v) {
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
    "           newEvent: newEvent, touchEvent: touchEvent, findEvent: findEvent,\n" +
    "           removeEvent: removeEvent, seasonRecord: seasonRecord,\n" +
    "           dayItems: dayItems, startOfWeek: startOfWeek, addDays: addDays,\n" +
    "           addMonths: addMonths, gameResult: gameResult,\n" +
    "           openDayMenu: openDayMenu, openEventEditor: openEventEditor,\n" +
    "           newPlayer: newPlayer, touchPlayer: touchPlayer, findPlayer: findPlayer,\n" +
    "           removePlayer: removePlayer, newAssessment: newAssessment,\n" +
    "           attendanceFor: attendanceFor, attendanceTaken: attendanceTaken,\n" +
    "           latestAssessment: latestAssessment, AREAS: AREAS,\n" +
    "           newTactic: newTactic, newOption: newOption, touchTactic: touchTactic,\n" +
    "           findTactic: findTactic, findOption: findOption, removeTactic: removeTactic,\n" +
    "           newTacticItem: newTacticItem, tacticUsage: tacticUsage,\n" +
    "           optionLabel: optionLabel, itemLabel: itemLabel, SIDES: SIDES,\n" +
    "           categoriesFor: categoriesFor,\n" +
    "           parseDMY: parseDMY, formatDMY: formatDMY, ageFrom: ageFrom,\n" +
    "           parseTime: parseTime, spanMinutes: spanMinutes, timeRange: timeRange,\n" +
    "           isOpen: isOpen, setOpen: setOpen, setOpenAll: setOpenAll,\n" +
    "           POSITIONS: POSITIONS,\n" +
    "           practiceMinutes: practiceMinutes, prettyDate: prettyDate,\n" +
    "           openDrillPicker: openDrillPicker, route: route,\n" +
    "           applyImport: applyImport };\n";
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
  globalThis.devicePixelRatio = 2;
  globalThis.addEventListener = function () {};
  globalThis.claude = undefined;
  globalThis.Option = fakeOption;
  globalThis.__po = null;
  eval(SRC);
  return globalThis.__po.boot.then(function () { return globalThis.__po; });
}

// <select> is built with the browser's Option constructor; stand one in.
function fakeOption(text, value) {
  var n = document.createElement("option");
  n.textContent = text;
  n.value = value === undefined ? text : value;
  return n;
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
  eq("database is now at version 5", backing.version, 5);
  ok("the practices store was created", backing.stores.indexOf("practices") >= 0);
  ok("the events store was created", backing.stores.indexOf("events") >= 0);
  ok("the players store was created", backing.stores.indexOf("players") >= 0);
  ok("the tactics store was created", backing.stores.indexOf("tactics") >= 0);
  var shell = po.findDrill("d-shell");
  ok("the drill kept its name", shell && shell.name === "Shell defence");
  ok("its ink was unpacked into points",
     shell && shell.diagrams[0].strokes[0].pts.length === 3,
     shell && JSON.stringify(shell.diagrams[0].strokes[0]).slice(0, 60));
  ok("the first point survived the round trip",
     Math.abs(shell.diagrams[0].strokes[0].pts[0].x - 0.1) < 1e-9,
     shell.diagrams[0].strokes[0].pts[0].x);
  eq("the diary starts empty", po.state.practices.length, 0);
  eq("the calendar starts empty", po.state.events.length, 0);

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
  po.touchPractice(twice);
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
  ["library", "practices", "schedule", "roster", "tactics"].forEach(function (v) {
    try { po.go(v); } catch (e) { errors.push(v + ": " + e); }
  });
  try { po.go("practice", practiceId); } catch (e) { errors.push("practice editor: " + e); }
  try { po.openDrillPicker(po.findPractice(practiceId)); } catch (e) { errors.push("drill picker: " + e); }
  try { po.route.smode = "month"; po.go("schedule"); } catch (e) { errors.push("month view: " + e); }
  try { po.openDayMenu("2026-08-25"); } catch (e) { errors.push("day menu: " + e); }
  po.route.smode = "week";
  ok("every screen built without throwing", errors.length === 0, errors.join(" | "));

  print("\n8. the schedule");
  var g = po.newEvent("game", "2026-08-29");
  g.title = "Partizan"; g.venue = "away"; g.time = "19:00";
  g.scoreUs = 78; g.scoreThem = 81;
  po.state.events.push(g);
  po.touchEvent(g);

  var won = po.newEvent("game", "2026-09-05");
  won.title = "Crvena Zvezda"; won.venue = "home";
  won.scoreUs = 90; won.scoreThem = 71;
  po.state.events.push(won);
  po.touchEvent(won);

  var unplayed = po.newEvent("game", "2026-09-12");
  unplayed.title = "Mega"; unplayed.venue = "home";
  po.state.events.push(unplayed);
  po.touchEvent(unplayed);

  var off = po.newEvent("off", "2026-08-30");
  po.state.events.push(off);
  po.touchEvent(off);

  var rec = po.seasonRecord();
  eq("a win is counted", rec.w, 1);
  eq("a loss is counted", rec.l, 1);
  eq("a game with no score is not counted as a draw", rec.d, 0);
  eq("it is reported as still to play", rec.pending, 1);
  eq("the score reads the right way round", po.gameResult(g), "78\u201381");

  eq("weeks start on Monday", po.startOfWeek("2026-08-29"), "2026-08-24");
  eq("a Monday is its own week start", po.startOfWeek("2026-08-24"), "2026-08-24");
  eq("day arithmetic crosses a month end", po.addDays("2026-08-31", 1), "2026-09-01");
  eq("month arithmetic crosses a year end", po.addMonths("2026-12-15", 1), "2027-01-01");

  var onGameDay = po.dayItems("2026-08-29");
  eq("the game shows on its day", onGameDay.length, 1);
  eq("and it is the game", onGameDay[0].rec.title, "Partizan");

  var drew = [];
  try { po.openEventEditor(g); } catch (e) { drew.push("game editor: " + e); }
  try { po.openEventEditor(off); } catch (e) { drew.push("day-off editor: " + e); }
  try { po.route.anchor = "2026-08-29"; po.go("schedule"); } catch (e) { drew.push("week with events: " + e); }
  try { po.route.smode = "month"; po.go("schedule"); po.route.smode = "week"; }
  catch (e) { drew.push("month with events: " + e); }
  ok("the calendar draws with things on it", drew.length === 0, drew.join(" | "));

  po.flush();
  return Promise.resolve().then(function () { return launch(backing, lsStore); });
})
.then(function (po) {
  eq("the events came back after a restart", po.state.events.length, 4);
  eq("the season record survived", po.seasonRecord().w, 1);
  var back = null;
  po.state.events.forEach(function (e) { if (e.title === "Partizan") back = e; });
  ok("a game kept its venue and time", back && back.venue === "away" && back.time === "19:00");
  eq("and its score", back.scoreUs, 78);
  // one drill was deleted back in section 5
  eq("the surviving drill is still there", po.state.drills.length, 1);
  eq("and all three practices", po.state.practices.length, 3);

  var json = po.serialize(po.state);
  var round = po.deserialize(json);
  eq("events survive export and import", round.events.length, 4);
  var older = po.deserialize(JSON.stringify({ version: 2, drills: [], practices: [] }));
  eq("a backup written before the schedule existed still imports", older.events.length, 0);

  print("\n9. the roster");
  var pl = po.newPlayer();
  pl.name = "Nikola"; pl.number = "7"; pl.position = "1 · Point guard";
  pl.birthYear = 2008; pl.heightCm = 188;
  po.state.players.push(pl);

  var other = po.newPlayer();
  other.name = "Stefan"; other.number = "12";
  po.state.players.push(other);

  var sep = po.newAssessment();
  sep.date = "2026-09-01";
  sep.physical = 5; sep.tactical = 4; sep.technical = 6; sep.psychological = 5;
  var dec = po.newAssessment();
  dec.date = "2026-12-01";
  dec.physical = 7; dec.tactical = 6; dec.technical = 6; dec.psychological = null;
  pl.assessments.push(dec);
  pl.assessments.push(sep);
  pl.assessments.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  po.touchPlayer(pl);
  po.touchPlayer(other);

  eq("assessments are held in date order", po.latestAssessment(pl).date, "2026-12-01");
  ok("a rating that was never given stays null, not zero",
     po.latestAssessment(pl).psychological === null);

  // attendance: three completed practices, one with no register taken
  var done1 = po.state.practices[0];
  var done2 = po.state.practices[1];
  [done1, done2].forEach(function (pr) { pr.status = "done"; });
  done1.attendance[pl.id] = "in";
  done1.attendance[other.id] = "out";
  done2.attendance[pl.id] = "part";
  po.touchPractice(done1);
  po.touchPractice(done2);

  var noRegister = po.state.practices[2];
  noRegister.status = "done";
  po.touchPractice(noRegister);

  ok("a practice with no marks counts as no register", !po.attendanceTaken(noRegister));

  var a1 = po.attendanceFor(pl.id);
  eq("only sessions with a register count", a1.sessions, 2);
  eq("in is worth a full session and partial is worth half", a1.credit, 1.5);
  eq("which reads as a percentage", a1.pct, 75);

  var a2 = po.attendanceFor(other.id);
  eq("being marked out counts as a session attended none of", a2.credit, 0);
  eq("and it is only the one he was marked on", a2.sessions, 1);
  eq("an unmarked player is not counted absent", a2.missed, 1);

  var never = po.newPlayer();
  po.state.players.push(never);
  po.touchPlayer(never);
  eq("a player never marked has no percentage at all", po.attendanceFor(never.id).pct, null);

  // a planned practice must not reach anyone's attendance
  var planned2 = po.newPractice();
  planned2.date = "2026-09-20";
  planned2.attendance[pl.id] = "in";
  po.state.practices.push(planned2);
  po.touchPractice(planned2);
  eq("a planned practice is not counted", po.attendanceFor(pl.id).sessions, 2);

  var drew2 = [];
  try { po.go("roster"); } catch (e) { drew2.push("roster: " + e); }
  try { po.go("player", pl.id); } catch (e) { drew2.push("player with a chart: " + e); }
  try { po.go("player", other.id); } catch (e) { drew2.push("player with no assessments: " + e); }
  var one = po.newPlayer();
  one.name = "Luka";
  var only = po.newAssessment();
  only.physical = 6; only.tactical = 5; only.technical = 7; only.psychological = 6;
  one.assessments.push(only);
  po.state.players.push(one);
  po.touchPlayer(one);
  try { po.go("player", one.id); } catch (e) { drew2.push("player with one assessment: " + e); }
  try { po.go("practice", practiceId); } catch (e) { drew2.push("practice with a register: " + e); }
  ok("every roster screen built without throwing", drew2.length === 0, drew2.join(" | "));

  po.flush();
  return Promise.resolve().then(function () { return launch(backing, lsStore); });
})
.then(function (po) {
  eq("the players came back after a restart", po.state.players.length, 4);
  var nikola = null;
  po.state.players.forEach(function (x) { if (x.name === "Nikola") nikola = x; });
  ok("with their details", nikola && nikola.number === "7" && nikola.heightCm === 188);
  eq("and both assessments", nikola.assessments.length, 2);
  eq("in date order", nikola.assessments[0].date, "2026-09-01");
  eq("the attendance survived", po.attendanceFor(nikola.id).pct, 75);

  var json = po.serialize(po.state);
  var round = po.deserialize(json);
  eq("players survive export and import", round.players.length, 4);
  var older = po.deserialize(JSON.stringify({ version: 3, drills: [], practices: [], events: [] }));
  eq("a backup written before the roster existed still imports", older.players.length, 0);

  print("\n10. tactics");
  var horns = po.newTactic();
  horns.name = "Horns"; horns.side = "Offence"; horns.category = "Half-court sets";
  horns.options[0].name = "Flare";
  horns.options[0].points = "Screener slips if they switch.";
  horns.options[0].diagrams[0].strokes.push({
    tool: "pen", color: "#22201C", size: 7,
    pts: [{ x: 0.2, y: 0.3, p: 0.5 }, { x: 0.5, y: 0.4, p: 0.6 }, { x: 0.8, y: 0.2, p: 0.4 }]
  });
  var down = po.newOption();
  down.name = "Down";
  horns.options.push(down);
  po.state.tactics.unshift(horns);
  po.touchTactic(horns);

  var ice = po.newTactic();
  ice.name = "Ice the side pick & roll";
  ice.side = "Defence"; ice.category = "Defending the pick & roll";
  ice.options[0].name = "Base coverage";
  po.state.tactics.unshift(ice);
  po.touchTactic(ice);

  var last = po.newTactic();
  last.name = "Last shot"; last.side = "Special situations"; last.category = "Last shot";
  po.state.tactics.unshift(last);
  po.touchTactic(last);

  eq("a set starts with one option", last.options.length, 1);
  eq("defence is a side of its own", ice.side, "Defence");
  ok("and it has its own categories",
     po.categoriesFor("Defence").indexOf("Defending the pick & roll") >= 0);
  ok("offence categories are not offered to defence",
     po.categoriesFor("Defence").indexOf("Half-court sets") === -1);
  eq("all three ends of the floor exist", po.SIDES.length, 3);
  eq("an option reads as set then option", po.optionLabel(horns, horns.options[0]), "Horns · Flare");
  eq("a set with an unnamed option reads as just the set",
     po.optionLabel(last, last.options[0]), "Last shot");

  // logging tactics into a practice
  var sess = po.findPractice(practiceId);
  sess.items.push(po.newTacticItem(horns, horns.options[0]));
  sess.items.push(po.newTacticItem(ice, ice.options[0]));
  po.touchPractice(sess);
  eq("a tactic item knows it is a tactic", sess.items[sess.items.length - 1].kind, "tactic");
  eq("and resolves its name live", po.itemLabel(sess.items[sess.items.length - 2]), "Horns · Flare");

  var u = po.tacticUsage();
  eq("the set is counted", u.sets[horns.id], 1);
  eq("and so is the option", u.options[horns.id + "/" + horns.options[0].id], 1);

  var planTac = po.newPractice();
  planTac.items.push(po.newTacticItem(horns, horns.options[0]));
  po.state.practices.push(planTac);
  po.touchPractice(planTac);
  eq("a planned practice does not count a tactic", po.tacticUsage().sets[horns.id], 1);

  // the same set twice in one session is one session
  sess.items.push(po.newTacticItem(horns, down));
  po.touchPractice(sess);
  var u2 = po.tacticUsage();
  eq("two options of one set is still one session for the set", u2.sets[horns.id], 1);
  eq("but each option is counted", u2.options[horns.id + "/" + down.id], 1);

  var drew3 = [];
  try { po.go("tactics"); } catch (e) { drew3.push("tactics list: " + e); }
  try { po.route.side = "Defence"; po.go("tactics"); po.route.side = ""; }
  catch (e) { drew3.push("defence filter: " + e); }
  try { po.go("tactic", horns.id); } catch (e) { drew3.push("set editor with ink: " + e); }
  try { po.go("drill", "d-shell"); } catch (e) { drew3.push("drill editor: " + e); }
  try { po.go("practice", practiceId); } catch (e) { drew3.push("practice with tactics: " + e); }
  ok("the tactics screens built without throwing", drew3.length === 0, drew3.join(" | "));

  po.flush();
  return Promise.resolve().then(function () { return launch(backing, lsStore); });
})
.then(function (po) {
  eq("the tactics came back after a restart", po.state.tactics.length, 3);
  var h = null;
  po.state.tactics.forEach(function (t) { if (t.name === "Horns") h = t; });
  eq("with both options", h.options.length, 2);
  eq("and the execution notes", h.options[0].points, "Screener slips if they switch.");
  eq("the ink on an option survived", h.options[0].diagrams[0].strokes[0].pts.length, 3);
  ok("and round-tripped accurately",
     Math.abs(h.options[0].diagrams[0].strokes[0].pts[0].x - 0.2) < 0.001,
     h.options[0].diagrams[0].strokes[0].pts[0].x);
  eq("the practice still counts the set", po.tacticUsage().sets[h.id], 1);

  var json = po.serialize(po.state);
  var round = po.deserialize(json);
  eq("tactics survive export and import", round.tactics.length, 3);
  var older = po.deserialize(JSON.stringify({
    version: 4, drills: [], practices: [{ id: "old", date: "2026-01-01", status: "done",
      items: [{ id: "i1", drillId: "d-shell", name: "Shell defence", minutes: 10 }] }],
    events: [], players: []
  }));
  eq("a backup written before tactics existed still imports", older.tactics.length, 0);
  eq("and its practice items are read as drills", older.practices[0].items[0].kind, "drill");

  print("\n11. what he types, and how it is read back");
  eq("a padded date parses", po.parseDMY("05.03.2008"), "2008-03-05");
  eq("so does an unpadded one", po.parseDMY("5.3.2008"), "2008-03-05");
  eq("slashes are accepted", po.parseDMY("5/3/2008"), "2008-03-05");
  eq("and dashes", po.parseDMY("5-3-2008"), "2008-03-05");
  eq("a day that does not exist is refused", po.parseDMY("31.02.2008"), null);
  eq("so is the 32nd", po.parseDMY("32.01.2008"), null);
  eq("and a month past twelve", po.parseDMY("01.13.2008"), null);
  eq("and American order is not silently accepted", po.parseDMY("03.25.2008"), null);
  eq("a two-digit year is refused rather than guessed", po.parseDMY("05.03.08"), null);
  eq("it comes back in the same format", po.formatDMY("2008-03-05"), "05.03.2008");
  eq("a date typed and read back is unchanged",
     po.formatDMY(po.parseDMY("5.3.2008")), "05.03.2008");

  eq("a birthday already had this year", po.ageFrom("2008-01-01"), 18);
  eq("one still to come has not counted yet", po.ageFrom("2008-12-31"), 17);
  eq("no date of birth means no age", po.ageFrom(""), null);

  eq("an hour on its own is a time", po.parseTime("18"), "18:00");
  eq("with a colon", po.parseTime("18:30"), "18:30");
  eq("with a dot", po.parseTime("18.30"), "18:30");
  eq("with nothing between", po.parseTime("1830"), "18:30");
  eq("a single digit hour", po.parseTime("9"), "09:00");
  eq("an empty box clears it", po.parseTime(""), "");
  eq("a 25th hour is refused", po.parseTime("25:00"), null);
  eq("so are 61 minutes", po.parseTime("18:61"), null);
  eq("and anything that is not a time", po.parseTime("evening"), null);

  eq("a session length is the gap between the two", po.spanMinutes("18:00", "19:30"), 90);
  eq("an end before the start is not a negative session", po.spanMinutes("19:00", "18:00"), null);
  eq("nor is an end equal to the start", po.spanMinutes("18:00", "18:00"), null);
  eq("one time alone is not a length", po.spanMinutes("18:00", ""), null);
  eq("a start alone still shows", po.timeRange("18:00", ""), "18:00");
  eq("both show as a range", po.timeRange("18:00", "19:30"), "18:00\u201319:30");

  eq("positions are the general three", po.POSITIONS.join(","), "G,F,C");

  print("\n12. categories that open");
  eq("a category starts closed", po.isOpen("drill:Shooting"), false);
  po.setOpen("drill:Shooting", true);
  eq("opening one is remembered", po.isOpen("drill:Shooting"), true);
  po.setOpenAll(["drill:Shooting", "drill:Defence"], true);
  ok("and so is opening several", po.isOpen("drill:Defence"));

  var drew4 = [];
  try { po.go("library"); } catch (e) { drew4.push("library with an open category: " + e); }
  po.setOpenAll(["drill:Shooting", "drill:Defence"], false);
  try { po.go("library"); } catch (e) { drew4.push("library all closed: " + e); }
  try { po.setOpen("tactic:Defence/Defending the pick & roll", true); po.go("tactics"); }
  catch (e) { drew4.push("tactics with an open category: " + e); }
  ok("the library draws open and closed", drew4.length === 0, drew4.join(" | "));

  return launch(backing, lsStore);
})
.then(function (po) {
  ok("an open category is still open after a restart",
     po.isOpen("tactic:Defence/Defending the pick & roll"));
  eq("and a closed one is still closed", po.isOpen("drill:Shooting"), false);

  print("\n13. the drills imported from drill-management");
  var raw = null;
  try { raw = readFile("private/drills-import.json"); } catch (e) { raw = null; }
  if (!raw) {
    print("  --   skipped: private/drills-import.json is not here");
    print("       (club data, never committed — regenerate with tools/import-from-drill-management.py)");
  } else {
    var file = po.deserialize(raw);
    ok("the file is a valid backup", !!file);
    eq("all 43 drills are in it", file.drills.length, 43);

    var fast = null, slow = null;
    file.drills.forEach(function (d) {
      if (d.name === "1 on 1 FC") fast = d;
      if (d.name === "Shooting (spot-up)") slow = d;
    });
    ok("a full-court 1v1 came across", !!fast);
    eq("its measured intensity is exact", fast.intensity, 10);
    eq("and it got a full-court blank to draw on", fast.diagrams[0].court, "full");
    ok("the lightest drill kept its decimals", slow && slow.intensity === 1.62, slow && slow.intensity);
    eq("a half-court drill got a half-court blank", slow.diagrams[0].court, "half");
    ok("the grid inputs rode along", fast.load && fast.load.court === 5 && fast.load.contact === true,
       JSON.stringify(fast && fast.load));
    eq("intensities stay on the 1-10 scale",
       file.drills.filter(function (d) { return d.intensity > 5; }).length > 0, true);
    eq("every drill has a tag", file.drills.filter(function (d) { return !d.tag; }).length, 0);
    eq("no drill claims a format that was not in the data",
       file.drills.filter(function (d) { return d.format; }).length, 0);

    var beforeDrills = po.state.drills.length;
    var beforePractices = po.state.practices.length;
    po.applyImport(po.deserialize(raw), "merge");
    eq("merging adds them without touching what was there", po.state.drills.length, beforeDrills + 43);
    po.applyImport(po.deserialize(raw), "merge");
    eq("importing the same file twice does not duplicate", po.state.drills.length, beforeDrills + 43);
    eq("and the practices already logged are untouched", po.state.practices.length, beforePractices);

    po.flush();
  }

  print("\n14. the smaller store, for a browser that refuses IndexedDB");
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
  globalThis.Option = fakeOption;
  globalThis.__po = null;
  eval(SRC);
  return globalThis.__po.boot.then(function () { return globalThis.__po; });
}
