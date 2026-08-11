/* Headless Node smoke test for SPEC-V12 (tile occupancy & footprints).
   Loads js/data.js + js/state.js verbatim (no DOM/canvas needed — that
   logic lives entirely in iso.js/hub.js, not exercised here) against a
   minimal `window` + `localStorage` shim, then exercises:
     1. the co-tenancy rule (desk+pc+monitor share, everything else exclusive)
     2. footprint occupancy in both bed orientations (0/180 vs 90/270)
     3. rotation refusal when there isn't room, via State.canMoveItem
     4. the pre-V12 bed-footprint save migration (Task 5)
   Run: node test-v12-footprints.js  (from the repo root, or anywhere)
*/
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var ROOT = __dirname;

function makeWindow() {
  var store = {};
  var win = {
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
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

var results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
  } catch (e) {
    results.push({ name: name, ok: false, err: e && e.message });
  }
}

var win = makeWindow();
loadInto(win, 'js/data.js');
loadInto(win, 'js/state.js');
var State = win.Game.State;
var Data = win.Game.Data;

function freshState() {
  State.load(); // boots default save into State.data
  return State.data;
}

/* ---------------------------------------------------------------- 1 ---- */
// V22 (owner item 4) REVERSED item 15: the trio shares a tile again. The real
// complaint was the tower OVERLAPPING the desk art, which is now fixed in
// js/iso.js by putting the PC in the tile's back half and sorting it behind
// the desk and monitor — not by giving it a separate square.
check('desk+pc+monitor may share one tile', function () {
  freshState();
  State.data.placed = [];
  State.data.owned = { desk_ikea: 1, pc_budget: 1, monitor_basic: 1, chair_wooden: 1, bed_mattress: 1 };
  assert.strictEqual(State.placeItem('desk_ikea', 2, 2, 0).ok, true, 'desk should place on empty tile');
  assert.strictEqual(State.placeItem('monitor_basic', 2, 2, 0).ok, true, 'monitor should stack onto the desk tile');
  assert.strictEqual(State.placeItem('pc_budget', 2, 2, 0).ok, true, 'pc should stack onto the desk tile');
  assert.strictEqual(State.data.placed.length, 3);
});

check('monitor refuses a deskless tile', function () {
  freshState();
  State.data.placed = [];
  State.data.owned = { monitor_basic: 1 };
  var res = State.placeItem('monitor_basic', 3, 3, 0);
  assert.strictEqual(res.ok, false, 'monitor must not place without a desk on the tile');
});

// SPEC-V13 §4 RETARGETED THIS CHECK. It used to assert that placing a second
// desk onto the first desk's tile REFUSES. `desk` is a core singleton, and
// V13 makes core categories exactly-one-placed with placing performing a
// SWAP IN PLACE — so a second desk can no longer coexist at all, and the old
// expectation is obsolete by design rather than broken.
//
// The underlying V12 rule ("no tile ever holds two props of the same
// category") is still real and still needs coverage, so it is asserted here
// directly at the rule layer via canPlaceFootprint(), where placeItem's swap
// behaviour cannot mask it.
check('two of the SAME shared-group category cannot share a tile', function () {
  freshState();
  State.data.placed = [];
  State.data.owned = { desk_ikea: 2 };
  assert.strictEqual(State.placeItem('desk_ikea', 2, 2, 0).ok, true);

  var deskDef = Data.shopItems.filter(function (d) { return d.id === 'desk_ikea'; })[0];
  var rule = State.canPlaceFootprint(deskDef, 2, 2, 0, -1);
  assert.strictEqual(rule.ok, false, 'the occupancy rule must still refuse a second desk on the desk tile');

  // And the V13 swap contract: placing it anyway replaces in place, never stacks.
  var res = State.placeItem('desk_ikea', 2, 2, 0);
  assert.strictEqual(res.ok, true, 'a second desk swaps in place under V13 §4');
  var desks = State.data.placed.filter(function (p) { return p.id === 'desk_ikea'; });
  assert.strictEqual(desks.length, 1, 'exactly one desk stays placed after the swap');
});

check('a plant (exclusive category) cannot be placed on an occupied tile', function () {
  freshState();
  State.data.placed = [];
  State.data.owned = { desk_ikea: 1, plant_succulent: 1 };
  assert.strictEqual(State.placeItem('desk_ikea', 2, 2, 0).ok, true);
  var res = State.placeItem('plant_succulent', 2, 2, 0);
  assert.strictEqual(res.ok, false, 'decor must not stack onto the desk tile');
});

check('nothing can be placed on either bed tile', function () {
  freshState();
  State.data.placed = [{ id: 'bed_mattress', x: 2, y: 2, rot: 0 }]; // covers (2,2) and (3,2)
  State.data.owned = { bed_mattress: 1, plant_succulent: 1 };
  var okAnchor = State.placeItem('plant_succulent', 2, 2, 0);
  var okSecond = State.placeItem('plant_succulent', 3, 2, 0);
  assert.strictEqual(okAnchor.ok, false, 'must not place on the bed anchor tile');
  assert.strictEqual(okSecond.ok, false, 'must not place on the bed SECOND tile either');
});

/* ---------------------------------------------------------------- 2 ---- */
check('bed footprint at rot 0/180 spans (x,y) and (x+1,y)', function () {
  var def = Data.shopItems.filter(function (d) { return d.id === 'bed_mattress'; })[0];
  var tiles0 = State.footprintTiles(def, 2, 2, 0);
  var tiles2 = State.footprintTiles(def, 2, 2, 2);
  assert.deepStrictEqual(tiles0, [{ x: 2, y: 2 }, { x: 3, y: 2 }]);
  assert.deepStrictEqual(tiles2, [{ x: 2, y: 2 }, { x: 3, y: 2 }]);
});

check('bed footprint at rot 90/270 spans (x,y) and (x,y+1)', function () {
  var def = Data.shopItems.filter(function (d) { return d.id === 'bed_mattress'; })[0];
  var tiles1 = State.footprintTiles(def, 2, 2, 1);
  var tiles3 = State.footprintTiles(def, 2, 2, 3);
  assert.deepStrictEqual(tiles1, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
  assert.deepStrictEqual(tiles3, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
});

check('bed cannot be placed if EITHER footprint tile is occupied', function () {
  freshState();
  State.data.placed = [{ id: 'plant_succulent', x: 3, y: 2, rot: 0 }]; // sits on the bed's would-be 2nd tile
  State.data.owned = { plant_succulent: 1, bed_single: 1 };
  var ok = State.placeItem('bed_single', 2, 2, 0);
  assert.strictEqual(ok.ok, false, 'bed must not place when its 2nd footprint tile is occupied');
});

check('bed cannot be placed out of bounds', function () {
  freshState();
  State.data.locationId = 0; // basement, 6x6 per Data.locations
  State.data.placed = [];
  State.data.owned = { bed_single: 1 };
  var grid = State.currentGrid();
  var ok = State.placeItem('bed_single', grid.w - 1, grid.d - 1, 0); // 2nd tile would be x=grid.w, OOB
  assert.strictEqual(ok.ok, false, 'bed anchored at the true corner must refuse (2nd tile OOB)');
});

/* ---------------------------------------------------------------- 3 ---- */
check('rotating a bed in place refuses with a reason when blocked', function () {
  freshState();
  // Bed at (2,2) rot 0 covers (2,2)+(3,2). Block (2,3) so rotating to
  // vertical (needs (2,2)+(2,3)) has nowhere to go.
  State.data.placed = [
    { id: 'bed_mattress', x: 2, y: 2, rot: 0 },
    { id: 'plant_succulent', x: 2, y: 3, rot: 0 }
  ];
  var res = State.canMoveItem(0, 2, 2, 1); // rotate bed (idx 0) to rot 1 in place
  assert.strictEqual(res.ok, false, 'rotation into an occupied 2nd tile must be refused');
  assert.ok(res.reason && res.reason.length > 0, 'refusal must carry a reason for the toast');
});

check('rotating a bed in place succeeds when there IS room', function () {
  freshState();
  State.data.placed = [{ id: 'bed_mattress', x: 2, y: 2, rot: 0 }];
  var res = State.canMoveItem(0, 2, 2, 1);
  assert.strictEqual(res.ok, true, 'rotation with free space must be allowed');
});

check('moving a chair onto the desk tile is refused (regression check)', function () {
  freshState();
  State.data.placed = [
    { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
    { id: 'chair_wooden', x: 4, y: 4, rot: 0 }
  ];
  var chairIdx = 1;
  var res = State.canMoveItem(chairIdx, 1, 1, 0);
  assert.strictEqual(res.ok, false, 'chair is not in the shared trio — must not be movable onto the desk tile');
});

check('moving desk/pc/monitor onto each other (the shared trio) still works', function () {
  freshState();
  State.data.placed = [
    { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
    { id: 'pc_budget', x: 4, y: 4, rot: 0 },
    { id: 'monitor_basic', x: 3, y: 3, rot: 0 }
  ];
  // V22 (owner item 4) restored the trio — both must be movable onto the desk.
  assert.strictEqual(State.canMoveItem(1, 1, 1, 0).ok, true, 'pc must be movable onto the desk tile');
  assert.strictEqual(State.canMoveItem(2, 1, 1, 0).ok, true, 'monitor must be movable onto the desk tile');
});

check('moving the bed back onto its own tile is allowed (self-exclusion)', function () {
  freshState();
  State.data.placed = [{ id: 'bed_mattress', x: 2, y: 2, rot: 0 }];
  var res = State.canMoveItem(0, 2, 2, 0);
  assert.strictEqual(res.ok, true, 'a bed must be movable back onto its own current tiles');
});

/* ---------------------------------------------------------------- 4 ---- */
// These go through the REAL public load path (State.loadSlot -> internal
// normalizeSave -> migrateBedFootprints) by seeding localStorage directly,
// rather than reaching into a private function — exercises exactly what a
// real old save hitting State.loadSlot()/State.load() would do. Each
// migration check gets its own freshly-loaded module instance (state.js
// caches its parsed save root in a module-private closure variable on
// first read, so re-seeding the SAME instance's localStorage after that
// point would silently be ignored — a fresh win+require sidesteps that
// entirely rather than depending on internal cache-invalidation behavior).
function seedSlot0(raw) {
  var freshWin = makeWindow();
  loadInto(freshWin, 'js/data.js');
  loadInto(freshWin, 'js/state.js');
  freshWin.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [raw, null, null], lastSlot: 0 }));
  return freshWin.Game.State;
}

check('save migration relocates a bed that overlaps a legacy 1x1 conflict', function () {
  // Simulate a pre-V12 save: bed stored as if 1x1 at (2,2), with something
  // else saved sitting on what is now the bed's real 2nd tile (3,2).
  var MState = seedSlot0({
    v: 1, locationId: 0,
    owned: { bed_mattress: 1, plant_succulent: 1 },
    placed: [
      { id: 'bed_mattress', x: 2, y: 2, rot: 0 },
      { id: 'plant_succulent', x: 3, y: 2, rot: 0 }
    ]
  });
  var normalized = MState.loadSlot(0);
  var bed = normalized.placed.filter(function (p) { return p.id === 'bed_mattress'; })[0];
  var plant = normalized.placed.filter(function (p) { return p.id === 'plant_succulent'; })[0];
  assert.ok(bed, 'bed must still exist in placed');
  var bedTiles = State.footprintTiles(Data.shopItems.filter(function (d) { return d.id === 'bed_mattress'; })[0], bed.x, bed.y, bed.rot || 0);
  var plantStillConflicts = plant && bedTiles.some(function (t) { return t.x === plant.x && t.y === plant.y; });
  assert.ok(!plantStillConflicts, 'bed and plant must no longer overlap after migration');
  // Never delete a player's item: plant_succulent must still be owned.
  assert.strictEqual(normalized.owned.plant_succulent, 1, 'conflicting prop must remain OWNED, never deleted');
});

check('save migration on a genuinely full room drops the conflict from placed, not owned', function () {
  // 2x1 grid-ish scenario forced by filling the whole basement (6x6) solid
  // with 1x1 exclusive props except two tiles reserved for a 1x1-recorded
  // legacy bed, so there is truly nowhere to relocate anything.
  var placed = [];
  var owned = { bed_mattress: 1 };
  var gridW = 6, gridD = 6;
  var idSeq = ['plant_succulent', 'poster_team', 'rug_pixel', 'window_blinds'];
  var n = 0;
  for (var y = 0; y < gridD; y++) {
    for (var x = 0; x < gridW; x++) {
      if (x === 0 && y === 0) continue; // leave (0,0) for the legacy 1x1 bed anchor
      if (x === 1 && y === 0) continue; // this is the bed's real 2nd tile — put a conflict here
      var id = idSeq[n % idSeq.length]; n++;
      owned[id] = (owned[id] || 0) + 1;
      placed.push({ id: id, x: x, y: y, rot: 0 });
    }
  }
  var conflictId = 'plant_succulent';
  owned[conflictId] = (owned[conflictId] || 0) + 1;
  placed.push({ id: conflictId, x: 1, y: 0, rot: 0 }); // sits on the bed's real 2nd tile
  placed.push({ id: 'bed_mattress', x: 0, y: 0, rot: 0 });
  var beforeOwnedQty = owned[conflictId];
  var MState = seedSlot0({ v: 1, locationId: 0, owned: owned, placed: placed });
  var normalized = MState.loadSlot(0);
  var stillPlacedConflict = normalized.placed.filter(function (p) { return p.id === conflictId && p.x === 1 && p.y === 0; });
  // Either it got relocated (fine) or dropped from placed (also fine) — the
  // one thing that must NEVER happen is losing it from owned.
  assert.strictEqual(normalized.owned[conflictId], beforeOwnedQty, 'ownership count must be untouched — never delete a player\'s item');
  var bed = normalized.placed.filter(function (p) { return p.id === 'bed_mattress'; })[0];
  var bedTiles = State.footprintTiles(Data.shopItems.filter(function (d) { return d.id === 'bed_mattress'; })[0], bed.x, bed.y, bed.rot || 0);
  normalized.placed.forEach(function (p) {
    if (p.id === 'bed_mattress') return;
    var pdef = Data.shopItems.filter(function (d) { return d.id === p.id; })[0];
    // SPEC-V15-BATCH-B §1: poster_team/window_blinds are now mount:'wall' —
    // they hang on the wall plane, not the floor, so they NEVER consume
    // floor occupancy and are explicitly allowed to share a tile with the
    // bed (or anything else on the floor). This overlap check is a
    // floor-occupancy invariant; wall items are exempt from it by design.
    if (pdef && pdef.mount === 'wall') return;
    var pTiles = State.footprintTiles(pdef, p.x, p.y, p.rot || 0);
    pTiles.forEach(function (pt) {
      bedTiles.forEach(function (bt) {
        assert.ok(!(pt.x === bt.x && pt.y === bt.y), 'no placed prop may overlap the bed after migration: ' + p.id);
      });
    });
  });
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : ' -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
