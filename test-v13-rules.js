/* Headless Node smoke test for SPEC-V13-PLAYTEST (Package A2's state.js
   half: §5A scrim, §8A crypto news dot, §9A cash ad, §7B/§7C/§7D team
   trajectory, §3A workstation grouping, §4A/§4B exactly-one core item).
   Loads js/data.js + js/state.js verbatim against a minimal `window` +
   `localStorage` shim, mirroring test-v12-footprints.js's harness.
   Run: node test-v13-rules.js  (from the repo root, or anywhere)
*/
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var ROOT = __dirname;

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
/* Energy: distinct energyAdd values (§2), summed while placed, clamped.  */
check('4 placed IV drips = energyMax exactly 200', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.placed = [];
  State.data.owned = { energy_ivdrip: 4 };
  assert.strictEqual(State.placeItem('energy_ivdrip', 0, 0, 0).ok, true);
  assert.strictEqual(State.placeItem('energy_ivdrip', 1, 0, 0).ok, true);
  assert.strictEqual(State.placeItem('energy_ivdrip', 2, 0, 0).ok, true);
  assert.strictEqual(State.placeItem('energy_ivdrip', 3, 0, 0).ok, true);
  assert.strictEqual(State.energyMax(), 200);
});

check('one minifridge = energyMax exactly 115', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.placed = [];
  State.data.owned = { energy_minifridge: 1 };
  assert.strictEqual(State.placeItem('energy_minifridge', 0, 0, 0).ok, true);
  assert.strictEqual(State.energyMax(), 115);
});

check('minifridge + fridge + ivdrip = energyMax exactly 160', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.placed = [];
  State.data.owned = { energy_minifridge: 1, energy_fridge: 1, energy_ivdrip: 1 };
  assert.strictEqual(State.placeItem('energy_minifridge', 0, 0, 0).ok, true);
  assert.strictEqual(State.placeItem('energy_fridge', 1, 0, 0).ok, true);
  assert.strictEqual(State.placeItem('energy_ivdrip', 2, 0, 0).ok, true);
  assert.strictEqual(State.energyMax(), 160);
});

/* ================================================================ 2 ==== */
/* §5A: State.scrim() reports the REAL chemistry gain. */
check('State.scrim() returns chemistry in 2..4 and moves chemistry by exactly that', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.dead = false;
  State.data.contract = 't1';
  State.data.chemistry = 10;
  State.data.energy = State.data.energyMax;
  var before = State.data.chemistry;
  var res = State.scrim();
  assert.strictEqual(res.ok, true);
  assert.ok(res.chemistry >= 2 && res.chemistry <= 4, 'chemistry gain must be 2-4, got ' + res.chemistry);
  assert.strictEqual(State.data.chemistry, before + res.chemistry, 'chemistry must move by exactly the reported amount');
});

check('State.scrim() refuses with real reasons: dead / no-team / energy', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.dead = true;
  assert.strictEqual(State.scrim().reason, 'dead');
  State.data.dead = false;
  State.data.contract = 'free';
  assert.strictEqual(State.scrim().reason, 'no-team');
  State.data.contract = 't1';
  State.data.energy = 0;
  assert.strictEqual(State.scrim().reason, 'energy');
});

/* ================================================================ 3 ==== */
/* Save -> reload round trip via the REAL save path — proves the three new
   persisted fields are not silently dropped by normalizeSave(). */
check('save/reload round trip preserves lastCashAdAt, crypto.lastSeenNewsTick, teams[].traj/trajUntil', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  StateA.data.lastCashAdAt = 1234567;
  StateA.data.crypto.lastSeenNewsTick = 7;
  StateA.leaderboard(); // forces ensureTeams()/ensureTeamTrajectories() to seed d.teams
  var team0Before = StateA.data.teams[0];
  var id0 = team0Before.id, traj0 = team0Before.traj, trajUntil0 = team0Before.trajUntil;
  assert.strictEqual(typeof traj0, 'string');
  assert.strictEqual(typeof trajUntil0, 'number');
  StateA.save(); // real persistence path -> localStorage

  // Simulate a genuine reload: a BRAND NEW module instance reading the SAME
  // underlying localStorage store (not just re-reading the in-memory object).
  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.strictEqual(StateB.data.lastCashAdAt, 1234567, 'd.lastCashAdAt must survive save/reload');
  assert.strictEqual(StateB.data.crypto.lastSeenNewsTick, 7, 'd.crypto.lastSeenNewsTick must survive save/reload');
  var reloadedTeam = StateB.data.teams.filter(function (t) { return t.id === id0; })[0];
  assert.ok(reloadedTeam, 'team must still exist after reload');
  assert.strictEqual(reloadedTeam.traj, traj0, 'd.teams[].traj must survive save/reload');
  assert.strictEqual(reloadedTeam.trajUntil, trajUntil0, 'd.teams[].trajUntil must survive save/reload');
});

/* ================================================================ 4 ==== */
/* §9A: State.cashAdReward() bands, sampled (pure function, no mutation). */
check('cashAdReward: <1500 ELO always in 50..100 (200 samples)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.elo = 1000;
  for (var i = 0; i < 200; i++) {
    var v = State.cashAdReward();
    assert.ok(v >= 50 && v <= 100, 'got ' + v);
  }
});

check('cashAdReward: 1500-2499 ELO always in 200..600 (200 samples)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.elo = 2000;
  for (var i = 0; i < 200; i++) {
    var v = State.cashAdReward();
    assert.ok(v >= 200 && v <= 600, 'got ' + v);
  }
});

check('cashAdReward: exactly 2500 ELO always >= 600 (no cliff at the boundary, 200 samples)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.elo = 2500;
  State.data.teamSalary = 0;
  State.data.subscribers = 0;
  State.data.followers = 0;
  for (var i = 0; i < 200; i++) {
    var v = State.cashAdReward();
    assert.ok(v >= 600, 'got ' + v + ' -- must never dip below the 200-600 band\'s own ceiling');
    assert.ok(v <= 25000, 'got ' + v);
  }
});

check('cashAdReward: pure — never mutates state', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.elo = 3000;
  var before = JSON.stringify(State.data);
  State.cashAdReward();
  State.cashAdReward();
  assert.strictEqual(JSON.stringify(State.data), before);
});

/* ================================================================ 5 ==== */
/* §7B/§7C: trajectory cycles over time; trajUntil never drifts >14 days out. */
check('trajectory cycling: advancing 30 days changes many teams\' traj at least once; trajUntil never >14 days out', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.dead = false;
  State.data.energy = State.data.energyMax;
  State.leaderboard(); // seed d.teams
  var before = {};
  State.data.teams.forEach(function (t) { before[t.id] = t.traj; });

  for (var day = 0; day < 30; day++) {
    State.data.energy = State.data.energyMax; // avoid incidental gates
    State.endDay();
    // Invariant must hold after EVERY day advance, not just at the end.
    State.data.teams.forEach(function (t) {
      assert.ok(t.trajUntil - State.data.day <= 14, 'team ' + t.id + ' trajUntil is more than 14 days out');
    });
  }

  var changedCount = 0;
  State.data.teams.forEach(function (t) { if (t.traj !== before[t.id]) changedCount++; });
  assert.ok(changedCount > 10, 'expected many teams to have changed heat over 30 days, only ' + changedCount + ' did');
});

/* ================================================================ 6 ==== */
/* §3A: workstation grouping. */
// V22 (owner item 4) restored the desk+pc+monitor workstation group; item 1
// changed the starting desk to desk_plywood.
check('groupIndicesFor on the default desk+pc+monitor tile returns all three', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win); // V22 item 2: a fresh room is empty; apply the canonical layout
  var deskIdx = State.data.placed.findIndex(function (p) { return p.id === 'desk_plywood'; });
  var group = State.groupIndicesFor(deskIdx).slice().sort(function (a, b) { return a - b; });
  var expectIdxs = [];
  State.data.placed.forEach(function (p, i) {
    if (p.id === 'desk_plywood' || p.id === 'pc_budget' || p.id === 'monitor_basic') expectIdxs.push(i);
  });
  assert.deepStrictEqual(group, expectIdxs.sort(function (a, b) { return a - b; }));
  assert.strictEqual(group.length, 3);
});

check('groupIndicesFor on a standalone pc (not on a desk tile) returns just itself', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  // pc is itself a core singleton (§4A) — there is only ever ONE placed pc,
  // so "a standalone floor tower" means MOVING the one pc off the desk's
  // tile, not placing a second one (which would swap, not add).
  var idx = State.data.placed.findIndex(function (p) { return p.id === 'pc_budget'; });
  // SPEC-V16 §1: the basement is 4x4 now (was 6x6), so the old (4,4) target
  // is off the grid entirely. (3,1) is the same thing this test always meant:
  // an empty floor tile with no desk on it, and not the reserved bed corner.
  var moveRes = State.moveItem(idx, 3, 1, 0); // empty tile, no desk there
  assert.strictEqual(moveRes.ok, true, JSON.stringify(moveRes));
  assert.deepStrictEqual(State.groupIndicesFor(idx), [idx]);
});

check('moveGroup moves the whole desk+pc+monitor workstation together', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var deskIdx = State.data.placed.findIndex(function (p) { return p.id === 'desk_plywood'; });
  var group = State.groupIndicesFor(deskIdx);
  assert.strictEqual(group.length, 3); // V22 item 4: desk+pc+monitor share a tile again
  // SPEC-V16 §1: at 4x4, (3,3) is the grid's bottom-right corner — reserved
  // for the bed and physically covered by it — so the old target is no longer
  // a plain empty tile. (2,2) is: free, in bounds, not the corner.
  var res = State.moveGroup(group, 2, 2, 0);
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  group.forEach(function (idx) {
    assert.strictEqual(State.data.placed[idx].x, 2);
    assert.strictEqual(State.data.placed[idx].y, 2);
  });
  // chair and bed must be untouched
  var chair = State.data.placed.filter(function (p) { return p.id === 'chair_wooden'; })[0];
  assert.strictEqual(chair.x, 1);
  assert.strictEqual(chair.y, 2);
});

check('moveGroup onto an occupied (non-group) tile refuses and moves NOTHING', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var deskIdx = State.data.placed.findIndex(function (p) { return p.id === 'desk_plywood'; });
  var group = State.groupIndicesFor(deskIdx);
  var chairEntry = State.data.placed.filter(function (p) { return p.id === 'chair_wooden'; })[0];
  var before = group.map(function (idx) {
    var p = State.data.placed[idx];
    return { x: p.x, y: p.y, rot: p.rot };
  });
  var res = State.moveGroup(group, chairEntry.x, chairEntry.y, 0); // chair's tile — occupied, not in the group
  assert.strictEqual(res.ok, false);
  assert.ok(res.reason && res.reason.length > 0);
  group.forEach(function (idx, i) {
    var p = State.data.placed[idx];
    assert.strictEqual(p.x, before[i].x, 'nothing may move on a refused group move');
    assert.strictEqual(p.y, before[i].y, 'nothing may move on a refused group move');
  });
});

/* ================================================================ 7 ==== */
/* §4A/§4B: exactly-one core item — swap in place + migration. */
check('placing a second chair swaps IN PLACE at the incumbent\'s exact x/y/rot', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var oldChair = State.data.placed.filter(function (p) { return p.id === 'chair_wooden'; })[0];
  var oldX = oldChair.x, oldY = oldChair.y, oldRot = oldChair.rot;
  State.data.owned.chair_gaming = 1;
  var res = State.placeItem('chair_gaming', 5, 5, 2); // requested tile must be IGNORED
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.replaced, 'WOODEN CHAIR');
  var chairs = State.data.placed.filter(function (p) {
    var def = win.Game.Data.shopItems.filter(function (d) { return d.id === p.id; })[0];
    return def && def.category === 'chair';
  });
  assert.strictEqual(chairs.length, 1, 'exactly one chair must be placed');
  assert.strictEqual(chairs[0].id, 'chair_gaming');
  assert.strictEqual(chairs[0].x, oldX);
  assert.strictEqual(chairs[0].y, oldY);
  assert.strictEqual(chairs[0].rot, oldRot);
  assert.strictEqual(State.data.owned.chair_wooden, 1, 'old chair must remain OWNED');
});

check('migrateCoreSingletons keeps the higher-priced of two placed desks and leaves owned untouched', function () {
  var sharedStore = {};
  var win = freshGame(sharedStore);
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{
      v: 1, locationId: 0,
      owned: { desk_ikea: 1, desk_gaming: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1 },
      placed: [
        { id: 'desk_ikea', x: 0, y: 0, rot: 0 },
        { id: 'desk_gaming', x: 2, y: 0, rot: 0 },
        { id: 'chair_wooden', x: 0, y: 2, rot: 0 },
        { id: 'bed_mattress', x: 4, y: 5, rot: 0 }
      ]
    }, null, null],
    lastSlot: 0
  }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  var desks = normalized.placed.filter(function (p) { return p.id === 'desk_ikea' || p.id === 'desk_gaming'; });
  assert.strictEqual(desks.length, 1, 'exactly one desk must remain placed');
  assert.strictEqual(desks[0].id, 'desk_gaming', 'the higher-priced desk (desk_gaming, 1800 > desk_ikea 220) must be kept');
  assert.strictEqual(normalized.owned.desk_ikea, 1, 'ownership of the demoted desk must be untouched');
  assert.strictEqual(normalized.owned.desk_gaming, 1, 'ownership of the kept desk must be untouched');
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
