/* Headless Node smoke test for SPEC-V15-BATCH-B.md §1 (Package B1's
   data.js/state.js wall-mount rules for poster_team/window_blinds). Loads
   js/data.js + js/state.js verbatim against a minimal `window` +
   `localStorage` shim, mirroring test-v14-phone.js's harness.
   Run: node test-v15-banners.js  (from the repo root, or anywhere)
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

function freshGame() {
  var win = makeWindow();
  loadInto(win, 'js/data.js');
  loadInto(win, 'js/state.js');
  var State = win.Game.State;
  State.load();
  furnish(win);
  return win;
}

// own(win, itemId, qty): grants ownership directly (bypasses cash/buyItem —
// these tests are about placement rules, not the shop).
function own(win, itemId, qty) {
  win.Game.State.data.owned[itemId] = (win.Game.State.data.owned[itemId] || 0) + (qty || 1);
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
/* data.js: mount flag present on both items, absent elsewhere-typical item */
check('poster_team and window_blinds declare mount: "wall"', function () {
  var win = freshGame();
  var pt = win.Game.State.findShopItem('poster_team');
  var wb = win.Game.State.findShopItem('window_blinds');
  assert.strictEqual(pt.mount, 'wall');
  assert.strictEqual(wb.mount, 'wall');
  var desk = win.Game.State.findShopItem('desk_plywood');
  assert.notStrictEqual(desk.mount, 'wall', 'an ordinary floor item must not carry mount: wall');
});

/* ================================================================ 2 ==== */
/* Can place on a wall tile (x===0 or y===0), cannot on an interior tile. */
check('a banner CAN be placed on an x===0 wall tile', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  var grid = win.Game.State.currentGrid();
  var res = win.Game.State.placeItem('poster_team', 0, 2, 0);
  assert.strictEqual(res.ok, true, 'expected ok, got: ' + JSON.stringify(res));
  assert.ok(grid.d > 2, 'sanity: grid must be tall enough for y=2 to be interior-ish');
});

check('a banner CAN be placed on a y===0 wall tile', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  var res = win.Game.State.placeItem('poster_team', 3, 0, 0);
  assert.strictEqual(res.ok, true, 'expected ok, got: ' + JSON.stringify(res));
});

check('a banner CANNOT be placed on an interior tile (x>0 and y>0), and toasts the exact refusal reason', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  var grid = win.Game.State.currentGrid();
  assert.ok(grid.w > 1 && grid.d > 1, 'sanity: room must have an interior tile');
  var res = win.Game.State.placeItem('poster_team', 1, 1, 0);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'BANNERS MOUNT ON WALLS ONLY');
});

/* ================================================================ 3 ==== */
/* Rotation is derived, never chosen; corner defaults to the y===0 wall. */
check('auto-rotation: y===0 wall tile derives rot 0 regardless of requested rot', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  // SPEC-V16 §1: x=4 is off the now-4x4 basement grid; (2,0) is the same
  // y===0 back-wall slot this test is actually about.
  var res = win.Game.State.placeItem('poster_team', 2, 0, 3); // request rot 3 — must be ignored
  assert.strictEqual(res.ok, true);
  var entry = win.Game.State.data.placed[win.Game.State.data.placed.length - 1];
  assert.strictEqual(entry.rot, 0, 'y===0 wall must derive rot 0 (WALL_ROT_BACK)');
});

check('auto-rotation: x===0 wall tile (y>0) derives rot 1 regardless of requested rot', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  var res = win.Game.State.placeItem('poster_team', 0, 3, 2); // request rot 2 — must be ignored
  assert.strictEqual(res.ok, true);
  var entry = win.Game.State.data.placed[win.Game.State.data.placed.length - 1];
  assert.strictEqual(entry.rot, 1, 'x===0 wall (y>0) must derive rot 1 (WALL_ROT_SIDE)');
});

check('auto-rotation: the (0,0) corner defaults to the y===0/back wall facing (rot 0)', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  var res = win.Game.State.placeItem('poster_team', 0, 0, 0);
  assert.strictEqual(res.ok, true);
  var entry = win.Game.State.data.placed[win.Game.State.data.placed.length - 1];
  assert.strictEqual(entry.rot, 0, 'corner tile must default to the y===0 wall facing');
});

check('State.wallRotForTile is exported and matches placeItem\'s derivation', function () {
  var win = freshGame();
  assert.strictEqual(typeof win.Game.State.wallRotForTile, 'function');
  assert.strictEqual(win.Game.State.wallRotForTile(0, 0), 0);
  assert.strictEqual(win.Game.State.wallRotForTile(5, 0), 0);
  assert.strictEqual(win.Game.State.wallRotForTile(0, 5), 1);
});

/* ================================================================ 4 ==== */
/* Wall items don't consume floor occupancy: a desk may share the tile. */
check('a desk CAN be placed on the same tile as an already-placed wall banner', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  own(win, 'desk_plywood', 1);
  var res1 = win.Game.State.placeItem('poster_team', 2, 0, 0);
  assert.strictEqual(res1.ok, true);
  // desk_plywood is a SINGLETON_ROOM_CATEGORIES category, so it SWAPS the
  // starting desk in place at (0, gridD-... ) rather than landing at an
  // arbitrary requested tile — move it onto the banner's tile explicitly via
  // moveItem after the swap to prove co-tenancy, not just that a fresh
  // singleton placement happened to succeed elsewhere.
  var placed = win.Game.State.data.placed;
  var deskIdx = -1;
  for (var i = 0; i < placed.length; i++) {
    var d = win.Game.State.findShopItem(placed[i].id);
    if (d && d.category === 'desk') { deskIdx = i; break; }
  }
  assert.notStrictEqual(deskIdx, -1, 'a starting desk must already be placed');
  var moveRes = win.Game.State.moveItem(deskIdx, 2, 0, 0);
  assert.strictEqual(moveRes.ok, true, 'desk must be able to share the banner\'s tile: ' + JSON.stringify(moveRes));
});

check('a banner CAN be placed on a tile that already holds a desk (order reversed)', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  var placed = win.Game.State.data.placed;
  var desk = null;
  for (var i = 0; i < placed.length; i++) {
    var d = win.Game.State.findShopItem(placed[i].id);
    if (d && d.category === 'desk') { desk = placed[i]; break; }
  }
  assert.ok(desk, 'sanity: starting desk must exist');
  // Move the desk onto a wall tile first, then place a banner on top of it.
  var deskIdx = placed.indexOf(desk);
  // SPEC-V16 §1: y=4 is off the now-4x4 basement grid; (0,3) is the same
  // thing this test needs — a free x===0 wall tile the desk can sit on.
  var moveRes = win.Game.State.moveItem(deskIdx, 0, 3, 0);
  assert.strictEqual(moveRes.ok, true);
  var res = win.Game.State.placeItem('poster_team', 0, 3, 0);
  assert.strictEqual(res.ok, true, 'banner must be placeable on a desk\'s tile: ' + JSON.stringify(res));
});

/* ================================================================ 5 ==== */
/* Two wall items may not share the same wall slot. */
check('two banners CANNOT share the same wall slot', function () {
  var win = freshGame();
  own(win, 'poster_team', 2);
  var res1 = win.Game.State.placeItem('poster_team', 0, 2, 0);
  assert.strictEqual(res1.ok, true);
  var res2 = win.Game.State.placeItem('poster_team', 0, 2, 0);
  assert.strictEqual(res2.ok, false);
  assert.ok(res2.reason, 'refusal must carry a reason');
});

check('a banner and blinds CAN occupy two DIFFERENT wall slots', function () {
  var win = freshGame();
  own(win, 'poster_team', 1);
  own(win, 'window_blinds', 1);
  var res1 = win.Game.State.placeItem('poster_team', 0, 2, 0);
  var res2 = win.Game.State.placeItem('window_blinds', 3, 0, 0);
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res2.ok, true);
});

/* ================================================================ 6 ==== */
/* canPlaceFootprint is the single exported source of truth hub.js derives. */
check('State.canPlaceFootprint reports the wall-only refusal directly (what hub.js\'s tileCheck relays)', function () {
  var win = freshGame();
  var def = win.Game.State.findShopItem('poster_team');
  var check1 = win.Game.State.canPlaceFootprint(def, 2, 2, 0, -1);
  assert.strictEqual(check1.ok, false);
  assert.strictEqual(check1.reason, 'BANNERS MOUNT ON WALLS ONLY');
  var check2 = win.Game.State.canPlaceFootprint(def, 0, 2, 0, -1);
  assert.strictEqual(check2.ok, true);
});

/* ================================================================ 7 ==== */
/* Migration: a legacy interior-tile banner relocates without ever being
   removed from `owned`. Goes through the REAL public load path
   (State.loadSlot -> internal normalizeSave -> migrateWallMounts) by
   seeding localStorage directly, same pattern test-v12-footprints.js uses
   for migrateBedFootprints. */
function seedSlot0(raw) {
  var freshWin = makeWindow();
  loadInto(freshWin, 'js/data.js');
  loadInto(freshWin, 'js/state.js');
  freshWin.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [raw, null, null], lastSlot: 0 }));
  return freshWin.Game.State;
}

check('migration relocates a legacy interior-tile banner to a free wall slot, never touching owned', function () {
  // Simulate a pre-V15 save: a banner OWNED and PLACED on an interior tile
  // (illegal today, since mount:'wall' didn't exist when it was saved).
  var MState = seedSlot0({
    v: 1, locationId: 0,
    owned: { poster_team: 1, desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 },
    placed: [
      { id: 'poster_team', x: 2, y: 2, rot: 0 },
      { id: 'desk_ikea', x: 3, y: 3, rot: 0 },
      { id: 'pc_budget', x: 3, y: 3, rot: 0 },
      { id: 'chair_wooden', x: 4, y: 3, rot: 0 },
      { id: 'bed_mattress', x: 5, y: 5, rot: 0 },
      { id: 'monitor_basic', x: 3, y: 3, rot: 0 }
    ]
  });
  var normalized = MState.loadSlot(0);
  assert.strictEqual(normalized.owned.poster_team, 1, 'ownership must never be deleted by migration');
  var banner = normalized.placed.filter(function (p) { return p.id === 'poster_team'; })[0];
  assert.ok(banner, 'the banner must still be placed (a free wall slot exists in a fresh 6x6 room)');
  assert.ok(banner.x === 0 || banner.y === 0, 'relocated banner must land on an actual wall slot, got (' + banner.x + ',' + banner.y + ')');
  var expectedRot = banner.y === 0 ? 0 : 1;
  assert.strictEqual(banner.rot, expectedRot, 'migrated banner rotation must match the wall it landed on');
});

check('migration leaves a banner OWNED-BUT-UNPLACED (never deleted) when every wall slot is already full', function () {
  var gridW = 6, gridD = 6; // basement default grid (locationId 0)
  var wallTiles = [];
  for (var y = 0; y < gridD; y++) for (var x = 0; x < gridW; x++) if (x === 0 || y === 0) wallTiles.push({ x: x, y: y });
  var placed = [
    { id: 'desk_ikea', x: 3, y: 3, rot: 0 },
    { id: 'pc_budget', x: 3, y: 3, rot: 0 },
    { id: 'chair_wooden', x: 4, y: 3, rot: 0 },
    { id: 'bed_mattress', x: 5, y: 5, rot: 0 },
    { id: 'monitor_basic', x: 3, y: 3, rot: 0 },
    // the legacy misplaced banner that needs relocating
    { id: 'poster_team', x: 2, y: 2, rot: 0 }
  ];
  // Fill EVERY wall slot with a window_blinds (also wall-mount) so no free
  // slot remains anywhere for the interior banner to relocate to.
  wallTiles.forEach(function (t) { placed.push({ id: 'window_blinds', x: t.x, y: t.y, rot: 0 }); });
  var MState = seedSlot0({
    v: 1, locationId: 0,
    owned: { poster_team: 1, window_blinds: wallTiles.length, desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 },
    placed: placed
  });
  var normalized = MState.loadSlot(0);
  assert.strictEqual(normalized.owned.poster_team, 1, 'ownership must NEVER be deleted, even when unplaceable');
  var stillPlaced = normalized.placed.some(function (p) { return p.id === 'poster_team'; });
  assert.strictEqual(stillPlaced, false, 'with every wall slot full, the banner must be dropped from placed (owned-but-unplaced), not left illegally on the floor');
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
