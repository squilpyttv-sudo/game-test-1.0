/* Headless Node smoke test for SPEC-V16-REDESIGN.md §1 (Package R1's
   js/data.js + js/state.js half: the 4x4..9x9 location ladder, the re-anchored
   Data.defaultPlaced starter loadout, and normalizeSave()'s new
   migrateShrunkGrid() pass for saves written against the old, larger grids).
   Loads js/data.js + js/state.js verbatim against a minimal `window` +
   `localStorage` shim, mirroring test-v14-phone.js's harness.
   Run: node test-v16-rooms.js  (from the repo root, or anywhere)
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

// Seed a raw (pre-V16) save into slot 0 of a FRESH module instance and hand
// back its State — same pattern as test-v12-footprints.js's seedSlot0(),
// which exists because state.js caches its parsed save root in a private
// closure on first read.
function seedSlot0(raw) {
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [raw, null, null], lastSlot: 0 }));
  return win.Game.State;
}

function itemDef(win, id) {
  var items = win.Game.Data.shopItems;
  for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
  return null;
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
/* §1: the location ladder itself — starts at 4x4, +1 per side, always square. */
check('§1 location ladder is 4x4..9x9, square, exactly +1 per side', function () {
  var win = freshGame();
  var locs = win.Game.Data.locations;
  var expected = [4, 5, 6, 7, 8, 9];
  assert.strictEqual(locs.length, expected.length, 'six locations expected');
  for (var i = 0; i < locs.length; i++) {
    assert.strictEqual(locs[i].id, i, 'location ids must stay 0..5 in order');
    assert.strictEqual(locs[i].gridW, expected[i], locs[i].name + ' gridW');
    assert.strictEqual(locs[i].gridD, expected[i], locs[i].name + ' gridD (must stay square)');
  }
});

check('State.currentGrid() reports 4x4 for a fresh save', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var g = State.currentGrid();
  assert.deepStrictEqual({ w: g.w, d: g.d }, { w: 4, d: 4 });
});

/* ================================================================ 2 ==== */
/* Hazard 1: the starter loadout must be a COMPLETE minimum room at 4x4. */
check('fresh 4x4 save: every default prop is in bounds', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var g = State.currentGrid();
  var placed = State.data.placed;
  assert.ok(placed.length >= 5, 'starter loadout must place at least 5 props');
  placed.forEach(function (p) {
    var def = itemDef(win, p.id);
    assert.ok(def, 'unknown starter item ' + p.id);
    State.footprintTiles(def, p.x, p.y, p.rot || 0).forEach(function (t) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x < g.w && t.y < g.d,
        p.id + ' footprint tile (' + t.x + ',' + t.y + ') is outside the ' + g.w + 'x' + g.d + ' grid');
    });
  });
});

check('fresh 4x4 save: bed+desk+chair+pc+monitor all PLACED — room is complete, no ROOM INCOMPLETE', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var rc = State.roomCompleteness();
  assert.deepStrictEqual(rc.missing, [], 'nothing may be missing from the minimum viable room');
  assert.strictEqual(rc.complete, true, 'a fresh 4x4 save must be a complete minimum room');
  // and the completeness must come from `placed`, not just `owned`
  var cats = {};
  State.data.placed.forEach(function (p) {
    var def = itemDef(win, p.id);
    if (def) cats[def.category] = true;
  });
  ['bed', 'desk', 'chair', 'pc', 'monitor'].forEach(function (c) {
    assert.ok(cats[c], c + ' must be physically PLACED in the fresh room');
  });
});

check('fresh 4x4 save: every default prop passes the real canPlaceFootprint() where it sits', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  State.data.placed.forEach(function (p, idx) {
    var def = itemDef(win, p.id);
    var res = State.canPlaceFootprint(def, p.x, p.y, p.rot || 0, idx);
    assert.ok(res.ok, p.id + ' at (' + p.x + ',' + p.y + ') is illegal in a 4x4 room: ' + res.reason);
  });
});

check('fresh 4x4 save: the bed covers the reserved bottom-right corner tile', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var g = State.currentGrid();
  var bed = State.data.placed.filter(function (p) { return p.id === 'bed_mattress'; })[0];
  assert.ok(bed, 'a bed must be placed');
  assert.deepStrictEqual({ x: bed.x, y: bed.y }, { x: g.w - 2, y: g.d - 1 },
    'bed must anchor at (gridW-2, gridD-1) = (2,3), one short of the corner');
  var tiles = State.footprintTiles(itemDef(win, 'bed_mattress'), bed.x, bed.y, bed.rot || 0);
  var coversCorner = tiles.some(function (t) { return t.x === g.w - 1 && t.y === g.d - 1; });
  assert.ok(coversCorner, "the bed's 2x1 footprint must land on the reserved corner (3,3)");
});

// RETARGETED after an owner playtest ("the bottom corner tile is blocked and
// says the same thing as a tile with an item there would say").
//
// This used to assert that SPEC-V3 §3's bed-corner RESERVATION held. That rule
// is gone: it dated from when beds were 1x1 with no footprint system, and both
// V12 footprints and V13's exactly-one-placed core rule now guarantee a bed's
// home properly. It was costing a permanently dead tile and refusing with
// 'TILE ALREADY OCCUPIED' on an EMPTY tile.
//
// Note this check was passing for the wrong reason even before the removal —
// on a fresh 4x4 the bed's own footprint covers (3,3), so ordinary occupancy
// refused it regardless of the reservation. It now tests the thing that
// actually matters: with the bed moved away, the corner is a normal tile.
check('the bottom-right corner is a NORMAL tile once the bed is not on it', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;

  // occupied by the bed's own footprint -> refused, as any occupied tile is
  var blocked = State.canPlaceFootprint(itemDef(win, 'plant_succulent'), 3, 3, 0, -1);
  assert.strictEqual(blocked.ok, false, 'while the bed covers it, the corner is occupied like any other tile');
  assert.ok(blocked.reason && blocked.reason.length, 'refusal must carry a reason (SPEC-V12 §4)');

  // move the bed away -> the corner must become freely usable
  var bedIdx = d.placed.findIndex(function (p) { return /bed/.test(p.id); });
  assert.strictEqual(State.moveItem(bedIdx, 0, 0, 0).ok, true, 'bed should move to the far corner');
  assert.strictEqual(State.tileOccupantsAt(3, 3, -1).length, 0, 'corner is now genuinely empty');

  d.cash = 1e6;
  State.buyItem('plant_succulent');
  var res = State.placeItem('plant_succulent', 3, 3, 0);
  assert.strictEqual(res.ok, true, 'an empty corner must accept an ordinary prop — no reservation any more');
});

/* ================================================================ 3 ==== */
/* The bed must still be rotatable in a 4x4 room. */
check('the bed still rotates in a 4x4 room', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var g = State.currentGrid();
  var bedIdx = -1;
  State.data.placed.forEach(function (p, i) { if (p.id === 'bed_mattress') bedIdx = i; });
  assert.ok(bedIdx >= 0, 'bed must be placed');

  // Some rot-1 (vertical) anchor must be reachable in a 4x4 room — the bed
  // is not permanently locked to one orientation by the smaller grid.
  var found = null;
  for (var y = 0; y < g.d && !found; y++) {
    for (var x = 0; x < g.w && !found; x++) {
      if (State.canMoveItem(bedIdx, x, y, 1).ok) found = { x: x, y: y };
    }
  }
  assert.ok(found, 'no legal rot-1 bed anchor exists anywhere in a 4x4 room');
  var moved = State.moveItem(bedIdx, found.x, found.y, 1);
  assert.strictEqual(moved.ok, true, 'rotating the bed to ' + JSON.stringify(found) + ' must succeed');
  assert.strictEqual(State.data.placed[bedIdx].rot, 1, 'the rotation must be stored');
  var tiles = State.footprintTiles(itemDef(win, 'bed_mattress'), found.x, found.y, 1);
  tiles.forEach(function (t) {
    assert.ok(t.x >= 0 && t.y >= 0 && t.x < g.w && t.y < g.d, 'rotated bed must stay in bounds');
  });
  // The room must still be complete after rotating (nothing got un-placed).
  assert.strictEqual(State.roomCompleteness().complete, true, 'rotating the bed must not break the room');
});

check('a rotation that would leave the 4x4 grid is refused WITH a reason, never silently', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var bedIdx = -1;
  State.data.placed.forEach(function (p, i) { if (p.id === 'bed_mattress') bedIdx = i; });
  // rot 1 in place at (2,3) would span (2,3)+(2,4) — y=4 is off a 4x4 grid.
  var res = State.canMoveItem(bedIdx, 2, 3, 1);
  assert.strictEqual(res.ok, false, 'rot 1 at (2,3) must not be accepted in a 4x4 room');
  assert.ok(res.reason && typeof res.reason === 'string' && res.reason.length,
    'a boxed-in rotation must refuse with a toast-ready reason');
  // and the refusal must not have mutated anything
  assert.strictEqual(State.data.placed[bedIdx].rot, 0, 'a refused rotation must leave the bed untouched');
});

/* ================================================================ 4 ==== */
/* Hazard 2: saves shrink. Location 5 went 11x11 -> 9x9. */

// Assert the universal post-migration contract: nothing lost from `owned`,
// everything placed is in bounds and legal, anything not placed is still owned.
function assertShrinkContract(win, State, before, after) {
  var g = { w: 0, d: 0 };
  var loc = win.Game.Data.locations.filter(function (l) { return l.id === after.locationId; })[0];
  g.w = loc.gridW; g.d = loc.gridD;

  Object.keys(before.owned).forEach(function (id) {
    assert.strictEqual(after.owned[id], before.owned[id],
      'owned.' + id + ' must survive the shrink migration untouched — items are NEVER deleted');
  });

  after.placed.forEach(function (p, idx) {
    var def = itemDef(win, p.id);
    assert.ok(def, 'placed item ' + p.id + ' must be a real shop item');
    State.footprintTiles(def, p.x, p.y, p.rot || 0).forEach(function (t) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x < g.w && t.y < g.d,
        p.id + ' still sits outside the ' + g.w + 'x' + g.d + ' grid at (' + t.x + ',' + t.y + ')');
    });
    var res = State.canPlaceFootprint(def, p.x, p.y, p.rot || 0, idx);
    assert.ok(res.ok, p.id + ' landed somewhere illegal: ' + res.reason);
  });

  // Anything that could not be re-homed must be owned-but-unplaced, not gone.
  var placedIds = {};
  after.placed.forEach(function (p) { placedIds[p.id] = true; });
  Object.keys(before.owned).forEach(function (id) {
    if (!placedIds[id]) assert.ok((after.owned[id] || 0) > 0, id + ' was un-placed but must remain OWNED');
  });
}

check('shrink migration: an 11x11-era save at location 5 re-homes every out-of-bounds prop, deletes nothing', function () {
  var raw = {
    v: 1, locationId: 5,
    owned: {
      desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1,
      plant_succulent: 1, rug_pixel: 1, neon_sign: 1
    },
    placed: [
      { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
      { id: 'pc_budget', x: 1, y: 1, rot: 0 },
      { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
      { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
      { id: 'bed_mattress', x: 9, y: 10, rot: 0 },   // was legal at 11x11
      { id: 'plant_succulent', x: 10, y: 10, rot: 0 }, // flatly out of bounds at 9x9
      { id: 'rug_pixel', x: 10, y: 3, rot: 0 },
      { id: 'neon_sign', x: 4, y: 10, rot: 0 }
    ]
  };
  var MState = seedSlot0(JSON.parse(JSON.stringify(raw)));
  var normalized = MState.loadSlot(0);
  assert.ok(normalized, 'loadSlot must return a normalized save');
  assert.strictEqual(normalized.locationId, 5);
  // nothing removed from owned
  Object.keys(raw.owned).forEach(function (id) {
    assert.strictEqual(normalized.owned[id], raw.owned[id],
      'owned.' + id + ' must never be removed by the shrink migration');
  });
  // everything placed is inside the new 9x9 grid
  normalized.placed.forEach(function (p) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x < 9 && p.y < 9,
      p.id + ' anchor (' + p.x + ',' + p.y + ') is outside the new 9x9 grid');
  });
  // and every one of the four out-of-bounds props found a home (a 9x9 room
  // with 8 props is nowhere near full)
  ['bed_mattress', 'plant_succulent', 'rug_pixel', 'neon_sign'].forEach(function (id) {
    var hit = normalized.placed.filter(function (p) { return p.id === id; })[0];
    assert.ok(hit, id + ' should have been relocated, not un-placed, in a mostly empty 9x9 room');
  });
});

check('shrink migration: full post-migration contract holds (in bounds + legal + nothing lost)', function () {
  var raw = {
    v: 1, locationId: 5,
    owned: {
      desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1,
      plant_succulent: 1, rug_pixel: 1, cat_bed: 1, trophy_shelf: 1, regen_hyperbaric: 1
    },
    placed: [
      { id: 'desk_ikea', x: 10, y: 10, rot: 0 },
      { id: 'pc_budget', x: 10, y: 10, rot: 0 },
      { id: 'monitor_basic', x: 10, y: 10, rot: 0 },
      { id: 'chair_wooden', x: 10, y: 9, rot: 0 },
      { id: 'bed_mattress', x: 9, y: 10, rot: 0 },
      { id: 'plant_succulent', x: 10, y: 0, rot: 0 },
      { id: 'rug_pixel', x: 0, y: 10, rot: 0 },
      { id: 'cat_bed', x: 5, y: 5, rot: 0 },
      { id: 'trophy_shelf', x: 10, y: 5, rot: 0 },
      { id: 'regen_hyperbaric', x: 9, y: 4, rot: 0 } // 2x1: spans (9,4)+(10,4)
    ]
  };
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [JSON.parse(JSON.stringify(raw)), null, null], lastSlot: 0 }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  assertShrinkContract(win, State, raw, normalized);
  // the workstation must survive intact — a shrink must not cost the player
  // a complete room
  assert.strictEqual(State.roomCompleteness().complete, true,
    'a shrunk room with plenty of free tiles must still be a complete room');
});

check('shrink migration: monitor is re-homed ONTO a desk tile, never onto bare floor', function () {
  var raw = {
    v: 1, locationId: 5,
    owned: { desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 },
    placed: [
      { id: 'monitor_basic', x: 10, y: 10, rot: 0 }, // listed BEFORE the desk on purpose
      { id: 'desk_ikea', x: 10, y: 10, rot: 0 },
      { id: 'pc_budget', x: 10, y: 10, rot: 0 },
      { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
      { id: 'bed_mattress', x: 7, y: 8, rot: 0 }
    ]
  };
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [raw, null, null], lastSlot: 0 }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  var monitor = normalized.placed.filter(function (p) { return p.id === 'monitor_basic'; })[0];
  var desk = normalized.placed.filter(function (p) { return p.id === 'desk_ikea'; })[0];
  assert.ok(monitor, 'the monitor must not be lost');
  assert.ok(desk, 'the desk must not be lost');
  assert.deepStrictEqual({ x: monitor.x, y: monitor.y }, { x: desk.x, y: desk.y },
    'a re-homed monitor must land on the desk tile (canPlaceFootprint enforces it)');
  assert.strictEqual(State.roomCompleteness().complete, true);
});

check('shrink migration: an out-of-bounds WALL item lands on a real in-bounds wall slot', function () {
  var raw = {
    v: 1, locationId: 5,
    owned: { desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1, poster_team: 1 },
    placed: [
      { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
      { id: 'pc_budget', x: 1, y: 1, rot: 0 },
      { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
      { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
      { id: 'bed_mattress', x: 7, y: 8, rot: 0 },
      // y===0 makes this look like a legal wall slot to migrateWallMounts(),
      // but x=10 is off the new 9x9 grid entirely.
      { id: 'poster_team', x: 10, y: 0, rot: 0 }
    ]
  };
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [raw, null, null], lastSlot: 0 }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  var poster = normalized.placed.filter(function (p) { return p.id === 'poster_team'; })[0];
  assert.ok(poster, 'the poster must not be lost');
  assert.ok(poster.x < 9 && poster.y < 9 && poster.x >= 0 && poster.y >= 0, 'poster must be in bounds');
  assert.strictEqual(State.isWallSlot(poster.x, poster.y), true, 'poster must sit on a legal wall slot');
  assert.strictEqual(normalized.owned.poster_team, 1);
});

check('shrink migration: no legal tile anywhere leaves the prop OWNED but UNPLACED (never deleted)', function () {
  // Fill a 9x9 room's every legal floor tile, then add one more prop out of
  // bounds so it has nowhere at all to go.
  var owned = { desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1, plant_succulent: 1 };
  var placed = [
    { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
    { id: 'pc_budget', x: 1, y: 1, rot: 0 },
    { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
    { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
    { id: 'bed_mattress', x: 7, y: 8, rot: 0 }
  ];
  // occupy every remaining in-bounds floor tile with cactuses
  var taken = { '1,1': 1, '1,2': 1, '7,8': 1, '8,8': 1 };
  var filler = 0;
  for (var y = 0; y < 9; y++) {
    for (var x = 0; x < 9; x++) {
      if (taken[x + ',' + y]) continue;
      placed.push({ id: 'plant_succulent', x: x, y: y, rot: 0 });
      filler++;
    }
  }
  // The homeless one, parked outside the new grid.
  // V22 (owner item 12): this used to be `rug_pixel`, which is no longer a
  // valid choice — the rug became a floor UNDERLAY (noCollide + collideLayer
  // 'floor'), so it fits under anything and can never be homeless. The test is
  // about a prop with nowhere legal to go, so it needs a prop that can
  // actually be blocked. STREAM CAT BED is exclusive decor, like the rug was.
  placed.push({ id: 'cat_bed', x: 10, y: 10, rot: 0 });
  owned.plant_succulent = filler;
  owned.cat_bed = 1;

  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{ v: 1, locationId: 5, owned: owned, placed: placed }, null, null], lastSlot: 0
  }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);

  var homeless = normalized.placed.filter(function (p) { return p.id === 'cat_bed'; });
  assert.strictEqual(homeless.length, 0, 'with no legal tile left, the prop must be dropped from `placed`');
  assert.strictEqual(normalized.owned.cat_bed, 1,
    'it must remain OWNED — removing an item from `owned` is never allowed');
  assert.strictEqual(normalized.owned.plant_succulent, filler, 'no cactus may be deleted either');
  // nothing left out of bounds
  normalized.placed.forEach(function (p) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x < 9 && p.y < 9, p.id + ' left out of bounds');
  });
});

check('shrink migration is a no-op for a save that is already in bounds', function () {
  var raw = {
    v: 1, locationId: 0,
    owned: { desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 },
    placed: [
      { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
      { id: 'pc_budget', x: 1, y: 1, rot: 0 },   // legal pre-V22, illegal now
      { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
      { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
      { id: 'bed_mattress', x: 2, y: 3, rot: 0 }
    ],
    bedArtAnchorFixed: true
  };
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [JSON.parse(JSON.stringify(raw)), null, null], lastSlot: 0 }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  // V22 (owner item 4) restored desk+pc+monitor sharing a tile, so this layout
  // is legal again and NOTHING here should move — which is what this test was
  // originally for. (Item 15 briefly made the PC illegal here and item 4
  // reversed it; the migration that re-homed it is gone.)
  raw.placed.forEach(function (p) {
    var hit = normalized.placed.filter(function (q) { return q.id === p.id; })[0];
    assert.ok(hit, p.id + ' must still be placed (never deleted)');
    assert.deepStrictEqual({ x: hit.x, y: hit.y, rot: hit.rot || 0 }, { x: p.x, y: p.y, rot: p.rot },
      p.id + ' must not be moved by a migration that has nothing to fix');
  });
  assert.strictEqual(State.roomCompleteness().complete, true);
});

check('shrink migration re-runs cleanly (idempotent on a second load)', function () {
  var raw = {
    v: 1, locationId: 5,
    owned: { desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1, plant_succulent: 1 },
    placed: [
      { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
      { id: 'pc_budget', x: 1, y: 1, rot: 0 },
      { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
      { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
      { id: 'bed_mattress', x: 9, y: 10, rot: 0 },
      { id: 'plant_succulent', x: 10, y: 10, rot: 0 }
    ]
  };
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [JSON.parse(JSON.stringify(raw)), null, null], lastSlot: 0 }));
  var State = win.Game.State;
  var first = JSON.parse(JSON.stringify(State.loadSlot(0)));
  State.save();
  // second module instance, loading what the first one wrote back out
  var win2 = freshGame();
  win2.localStorage.setItem('cs2sim.saves', win.localStorage.getItem('cs2sim.saves'));
  var second = win2.Game.State.loadSlot(0);
  assert.deepStrictEqual(second.placed, first.placed, 'a migrated save must be stable on reload');
  assert.deepStrictEqual(second.owned, first.owned);
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
