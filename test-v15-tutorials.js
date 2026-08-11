/* Headless Node smoke test for SPEC-V15-BATCH-C.md §1 (Package C1's
   data.js/state.js half: the contextual tutorial system — d.tutorialsSeen,
   State.tutorialPending()/markTutorialSeen()/tutorialSeen(), the nine
   triggers, priority order, and the suppression rules). Loads js/data.js +
   js/state.js verbatim against a minimal `window` + `localStorage` shim,
   mirroring test-v14-phone.js's harness exactly.
   Run: node test-v15-tutorials.js  (from the repo root, or anywhere)
*/
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var ROOT = __dirname;

var ALL_IDS = [
  'elo_climb', 'career_open', 'first_stream', 'aim_stat', 'phone_unlock',
  'first_case', 'first_rent', 'first_scrim', 'sponsor_conflict'
];

function makeWindow(sharedStore) {
  var store = sharedStore || {};
  var win = {
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    _store: store
  };
  win.Game = {};
  return win;
}

function loadInto(win, file) {
  var code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // eslint-disable-next-line no-new-func
  var fn = new Function('window', 'localStorage', 'Date', 'Math', 'JSON', 'console', code);
  fn(win, win.localStorage, Date, Math, JSON, console);
}

function freshGame(sharedStore) {
  var win = makeWindow(sharedStore);
  loadInto(win, 'js/data.js');
  loadInto(win, 'js/state.js');
  return win;
}

// freshReadyGame: a loaded save with the ORIGINAL 8-step onboarding already
// marked done (tutorialDone = true), since State.tutorialPending() suppresses
// everything while that's false — every trigger test below needs it out of
// the way to isolate what it's actually testing.
function freshReadyGame(sharedStore) {
  var win = freshGame(sharedStore);
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.tutorialDone = true;
  return win;
}

function markAllExcept(State, exceptId) {
  ALL_IDS.forEach(function (id) {
    if (id !== exceptId) State.markTutorialSeen(id);
  });
}


// V22 (owner item 2): a fresh save now starts with an EMPTY room — the five
// core props sit in the inventory and the player places them during
// onboarding. Tests that need a FURNISHED room to assert against apply the
// canonical Data.starterLayout instead of relying on the default.
function furnish(win) {
  var S = win.Game.State;
  S.data.placed = JSON.parse(JSON.stringify(win.Game.Data.starterLayout));
  return win;
}

var results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
  } catch (e) {
    results.push({ name: name, ok: false, err: (e && e.stack) || (e && e.message) || String(e) });
  }
}

/* ================================================================ 1 ==== */
/* d.tutorialsSeen: defaults, and must not be silently dropped on load. */
check('fresh save: d.tutorialsSeen defaults to an empty object, all three API fns work read-only', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  assert.deepStrictEqual(State.data.tutorialsSeen, {});
  ALL_IDS.forEach(function (id) { assert.strictEqual(State.tutorialSeen(id), false, id); });
  assert.strictEqual(State.tutorialPending(), null, 'onboarding not done yet -- must be null');
});

check('save -> reload round trip (REAL save path) preserves d.tutorialsSeen after marking several ids seen', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  StateA.markTutorialSeen('elo_climb');
  StateA.markTutorialSeen('first_case');
  StateA.markTutorialSeen('sponsor_conflict');
  assert.strictEqual(StateA.tutorialSeen('elo_climb'), true);
  assert.strictEqual(StateA.tutorialSeen('career_open'), false);

  // Brand new module instance reading the SAME underlying localStorage store
  // -- a genuine reload through normalizeSave(), not an in-memory check.
  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.strictEqual(StateB.tutorialSeen('elo_climb'), true, 'must survive save/reload');
  assert.strictEqual(StateB.tutorialSeen('first_case'), true, 'must survive save/reload');
  assert.strictEqual(StateB.tutorialSeen('sponsor_conflict'), true, 'must survive save/reload');
  assert.strictEqual(StateB.tutorialSeen('career_open'), false, 'unseen ids must stay unseen');
  assert.strictEqual(StateB.tutorialSeen('first_rent'), false);
});

check('save -> reload round trip: an entirely fresh (never-touched) tutorialsSeen also survives as {}', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  winA.Game.State.load();
  winA.Game.State.save();
  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.deepStrictEqual(StateB.data.tutorialsSeen, {});
});

check('loadSlot() (old-save-shaped raw object with no tutorialsSeen key at all) defaults to {}, no throw', function () {
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{ v: 1, day: 1, cash: 250, elo: 3000 }, null, null],
    lastSlot: 0
  }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  assert.deepStrictEqual(normalized.tutorialsSeen, {});
});

/* ================================================================ 2 ==== */
/* Each trigger fires at its correct moment and NOT before. Isolated via
   markAllExcept so only the one id under test can ever be returned. */
check('elo_climb: not triggered below Gold Nova (250), triggers at exactly 250', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'elo_climb');
  State.data.elo = 249;
  assert.strictEqual(State.tutorialPending(), null, 'must not fire before 250 ELO');
  State.data.elo = 250;
  assert.strictEqual(State.tutorialPending(), 'elo_climb', 'must fire at exactly 250 ELO (Gold Nova)');
});

check('career_open: not triggered below 2100 ELO, triggers at exactly 2100', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'career_open');
  State.data.elo = 2099;
  assert.strictEqual(State.tutorialPending(), null, 'must not fire before 2100 ELO');
  State.data.elo = 2100;
  assert.strictEqual(State.tutorialPending(), 'career_open', 'must fire at exactly 2100 ELO');
});

check('aim_stat: starter gear alone does NOT trigger it; buying a new aim item does', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'aim_stat');
  // fresh save already OWNS desk_ikea/pc_budget/chair_wooden/monitor_basic,
  // every one of which carries an `aim` stat -- must not read as "bought".
  assert.strictEqual(State.tutorialPending(), null, 'starter gear must not count as a purchase');
  State.data.cash = 10000;
  var bought = State.buyItem('chair_gaming'); // stats.aim: 3, not part of defaultOwned
  assert.strictEqual(bought, true);
  assert.strictEqual(State.tutorialPending(), 'aim_stat', 'must fire the moment an aim item is actually bought');
});

check('aim_stat: buying a SECOND copy of a starter aim item also counts', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'aim_stat');
  State.data.cash = 10000;
  assert.strictEqual(State.tutorialPending(), null);
  State.buyItem('desk_ikea'); // already owned by default -- buying a 2nd is still a real purchase
  assert.strictEqual(State.tutorialPending(), 'aim_stat');
});

// V22 (owner item 5): the card is now "SOCIAL MEDIA UNLOCKED" and fires when
// the SOCIAL app installs at 500 followers. The id stays `phone_unlock`
// because it is a d.tutorialsSeen save key — renaming it would re-show the
// card to everyone who already dismissed it.
check('phone_unlock: not triggered below 500 followers, triggers once socialAppUnlocked latches at 500', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'phone_unlock');
  State.data.followers = 300;
  State.tickEnergy();
  assert.strictEqual(State.tutorialPending(), null, 'the old 300 threshold must no longer fire it');
  State.data.followers = 499;
  State.tickEnergy();
  assert.strictEqual(State.tutorialPending(), null, 'must not fire below 500 followers');
  State.data.followers = 500;
  State.tickEnergy();
  assert.strictEqual(State.tutorialPending(), 'phone_unlock', 'must fire once socialAppUnlocked latches true');
});

check('first_case: not triggered before any case is opened, triggers right after the first one', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'first_case');
  assert.strictEqual(State.tutorialPending(), null);
  State.data.cash = 10000;
  State.data.energy = State.data.energyMax;
  var res = State.openCase({ onStream: false });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(State.tutorialPending(), 'first_case', 'must fire the instant the case is opened, not on reveal');
});

check('first_rent: not triggered before rent is ever charged, triggers the first time it is', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'first_rent');
  State.data.locationId = 1; // a paying location
  State.data.cash = 1000000; // stay well clear of missed-rent/dead complications
  assert.strictEqual(State.tutorialPending(), null, 'must not fire before ever moving into a paying location / a rent cycle');
  var fired = false;
  for (var i = 0; i < 10 && !fired; i++) {
    State.endDay();
    if (State.tutorialPending() === 'first_rent') fired = true;
  }
  assert.strictEqual(fired, true, 'must fire within one full 7-day rent cycle');
});

check('first_scrim: not triggered before any scrim, triggers right after the first successful one', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'first_scrim');
  assert.strictEqual(State.tutorialPending(), null);
  State.data.contract = 't3'; // signed -- scrims are only legal once signed
  State.data.energy = State.data.energyMax;
  var res = State.scrim();
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(State.tutorialPending(), 'first_scrim');
});

check('first_scrim: does NOT fire for an unsigned player (scrim() itself refuses)', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'first_scrim');
  State.data.contract = 'free';
  State.data.energy = State.data.energyMax;
  var res = State.scrim();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(State.tutorialPending(), null);
});

check('sponsor_conflict: needs BOTH a held sponsor AND a coach; neither alone triggers it', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'sponsor_conflict');
  assert.strictEqual(State.tutorialPending(), null);
  State.data.staff.coachId = 'coach_rookie';
  assert.strictEqual(State.tutorialPending(), null, 'coach alone must not trigger it');
  State.data.staff.coachId = null;
  State.data.sponsors = [{ id: 's1', sponsorId: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 30, obligation: { type: 'stream_days', amount: 2 }, progress: 0, warned: false, acquiredDay: 1 }];
  assert.strictEqual(State.tutorialPending(), null, 'sponsor alone must not trigger it');
  State.data.staff.coachId = 'coach_rookie';
  assert.strictEqual(State.tutorialPending(), 'sponsor_conflict', 'both together must trigger it');
});

/* ================================================================ 3 ==== */
/* first_stream: reachable via tutorialSeen/markTutorialSeen (for Package
   C3), but tutorialPending() must NEVER hand it back -- C3 renders it
   interactively and owns the moment entirely; a generic card must never
   appear for it, and it must never block lower-priority ids either. */
check('first_stream: tutorialSeen/markTutorialSeen work directly', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  assert.strictEqual(State.tutorialSeen('first_stream'), false);
  State.markTutorialSeen('first_stream');
  assert.strictEqual(State.tutorialSeen('first_stream'), true);
});

check('first_stream: tutorialPending() never returns it, even when triggered (streamed) and unseen, and it does not block aim_stat behind it', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'aim_stat'); // first_stream stays UNSEEN and will become triggered below
  State.data.stats.streams = 1; // "first stream session started" is now true
  assert.notStrictEqual(State.tutorialPending(), 'first_stream', 'must never be handed to the card UI');
  // aim_stat (lower priority than first_stream in the table) must still be
  // reachable -- first_stream must not occupy/block the queue.
  State.data.cash = 10000;
  State.buyItem('chair_gaming');
  assert.strictEqual(State.tutorialPending(), 'aim_stat', 'first_stream must never block a lower-priority id');
});

/* ================================================================ 4 ==== */
/* Fires once only -- never again after markTutorialSeen, including across
   a save/reload. */
check('once seen, an id never comes back from tutorialPending(), even though its condition still holds', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'elo_climb');
  State.data.elo = 5000; // deep into Gold Nova+ territory
  assert.strictEqual(State.tutorialPending(), 'elo_climb');
  State.markTutorialSeen('elo_climb');
  assert.strictEqual(State.tutorialPending(), null, 'must never return an already-seen id again');
  assert.strictEqual(State.tutorialSeen('elo_climb'), true);
});

check('once-only survives a save/reload round trip', function () {
  var sharedStore = {};
  var winA = freshReadyGame(sharedStore);
  var StateA = winA.Game.State;
  markAllExcept(StateA, 'career_open');
  StateA.data.elo = 3000;
  assert.strictEqual(StateA.tutorialPending(), 'career_open');
  StateA.markTutorialSeen('career_open');
  assert.strictEqual(StateA.tutorialPending(), null);

  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  StateB.data.tutorialDone = true;
  assert.strictEqual(StateB.tutorialSeen('career_open'), true);
  assert.strictEqual(StateB.tutorialPending(), null, 'must stay suppressed after reload -- condition still holds but it is seen');
});

/* ================================================================ 5 ==== */
/* Suppression rules. */
// RETARGETED after an owner playtest report ("reached gold nova, the popup did
// not appear; reopened the save and only then it popped up").
//
// This check used to assert the OPPOSITE: that tutorialPending() returns null
// while `!d.tutorialDone`. That gate asked "has the 8-step onboarding ever been
// COMPLETED?" when the only real concern is "is that overlay on screen right
// now?" — and since GOLD NOVA is just 250 ELO, players routinely crossed it
// before finishing the onboarding, so `elo_climb` was silently swallowed and
// only surfaced after a reload flipped the flag.
//
// The on-screen collision is a presentation concern and now lives in
// js/tutorial.js's own `active` guard (DOM-only, so not reachable from this
// headless harness). The RULE layer must no longer suppress on tutorialDone.
check('a milestone crossed BEFORE the 8-step onboarding finishes is NOT swallowed', function () {
  var win = freshGame(); // freshGame(), NOT freshReadyGame() -- tutorialDone stays false
  var State = win.Game.State;
  State.load();
  furnish(win);
  markAllExcept(State, 'elo_climb');
  State.data.elo = 5000;
  assert.strictEqual(State.data.tutorialDone, false, 'precondition: onboarding not finished');
  assert.strictEqual(State.tutorialPending(), 'elo_climb',
    'the milestone must still be pending even though the onboarding has not been completed');
  // ...and it must survive until it is actually shown, not expire.
  State.data.tutorialDone = true;
  assert.strictEqual(State.tutorialPending(), 'elo_climb', 'still pending once the onboarding finishes');
  State.markTutorialSeen('elo_climb');
  assert.strictEqual(State.tutorialPending(), null, 'and clears only once actually seen');
});

check('tutorialPending() is null while asleep', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'elo_climb');
  State.data.elo = 5000;
  assert.strictEqual(State.tutorialPending(), 'elo_climb');
  State.data.asleep = true;
  assert.strictEqual(State.tutorialPending(), null, 'must be null while asleep');
  State.data.asleep = false;
  assert.strictEqual(State.tutorialPending(), 'elo_climb', 'unblocks again once awake');
});

check('tutorialPending() is null while d.moving is set (move-out packing flow)', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'elo_climb');
  State.data.elo = 5000;
  assert.strictEqual(State.tutorialPending(), 'elo_climb');
  State.data.moving = { targetLocationId: 1, packed: [] };
  assert.strictEqual(State.tutorialPending(), null, 'must be null while moving');
  State.data.moving = null;
  assert.strictEqual(State.tutorialPending(), 'elo_climb');
});

check('tutorialPending() is null during a live stream (d.streaming)', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'elo_climb');
  State.data.elo = 5000;
  assert.strictEqual(State.tutorialPending(), 'elo_climb');
  State.data.streaming = true;
  assert.strictEqual(State.tutorialPending(), null, 'must be null during a live stream');
  State.data.streaming = false;
  assert.strictEqual(State.tutorialPending(), 'elo_climb');
});

check('tutorialPending() never returns two at once -- exactly one or null, sampled across many random states', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  for (var i = 0; i < 50; i++) {
    State.data.elo = Math.random() < 0.5 ? randIntLocal(0, 3000) : 0;
    State.data.followers = Math.random() < 0.5 ? 300 : 0;
    State.tickEnergy();
    var p = State.tutorialPending();
    assert.ok(p === null || typeof p === 'string', 'must be a single id or null, got ' + JSON.stringify(p));
  }
  function randIntLocal(a, b) { return a + Math.floor(Math.random() * (b - a)); }
});

/* ================================================================ 6 ==== */
/* Priority: with two (or more) triggered simultaneously, the higher-
   priority id (earlier in the table) is returned. */
check('priority: elo_climb beats career_open when both are triggered and unseen', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'elo_climb'); // marks everything except elo_climb, including career_open
  delete State.data.tutorialsSeen.career_open; // re-open career_open as unseen too for this test
  State.data.elo = 5000; // triggers BOTH elo_climb (>=250) and career_open (>=2100)
  assert.strictEqual(State.tutorialPending(), 'elo_climb', 'elo_climb is higher priority (earlier in the table)');
  State.markTutorialSeen('elo_climb');
  assert.strictEqual(State.tutorialPending(), 'career_open', 'falls through to career_open once elo_climb is seen');
});

check('priority: aim_stat beats phone_unlock when both are triggered and unseen', function () {
  var win = freshReadyGame();
  var State = win.Game.State;
  markAllExcept(State, 'aim_stat');
  delete State.data.tutorialsSeen.phone_unlock; // leave phone_unlock unseen too
  State.data.cash = 10000;
  State.buyItem('chair_gaming'); // triggers aim_stat
  State.data.followers = 500; // V22: phone_unlock now fires with the SOCIAL app at 500
  State.tickEnergy(); // triggers phone_unlock
  assert.strictEqual(State.tutorialPending(), 'aim_stat', 'aim_stat is higher priority than phone_unlock');
  State.markTutorialSeen('aim_stat');
  assert.strictEqual(State.tutorialPending(), 'phone_unlock');
});

/* ================================================================ 7 ==== */
/* Copy content: every id in the table has non-empty title + lines. */
check('Data.tutorials has an entry for every id in the table, each with a non-empty title and 2-4 non-empty lines', function () {
  var win = freshGame();
  var Data = win.Game.Data;
  ALL_IDS.forEach(function (id) {
    var entry = Data.tutorials[id];
    assert.ok(entry, 'missing Data.tutorials entry for ' + id);
    assert.strictEqual(typeof entry.title, 'string');
    assert.ok(entry.title.trim().length > 0, id + ' has an empty title');
    assert.ok(Array.isArray(entry.lines), id + ' lines must be an array');
    assert.ok(entry.lines.length >= 2 && entry.lines.length <= 4, id + ' must have 2-4 lines, has ' + entry.lines.length);
    entry.lines.forEach(function (line, idx) {
      assert.strictEqual(typeof line, 'string', id + ' line ' + idx + ' must be a string');
      assert.ok(line.trim().length > 0, id + ' line ' + idx + ' must not be empty');
    });
  });
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
