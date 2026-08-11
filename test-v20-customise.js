/* Headless Node smoke test for SPEC-V20-CUSTOMISE.md §1-§5/§8 (Package R's
   data.js/state.js: windows, LEDs (noCollide), blinds, banner/neon
   merchandise buff, FLOOR LED SCREEN rename). Loads js/data.js + js/state.js
   verbatim against a minimal `window` + `localStorage` shim, mirroring
   test-v15-banners.js's harness.
   Run: node test-v20-customise.js  (from the repo root, or anywhere)
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
  win.Game.State.load();
  return win;
}

// own(win, itemId, qty): grants ownership directly (bypasses cash/buyItem —
// these tests are about placement/rule logic, not the shop).
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
/* Persisted fields survive a REAL save -> reload round trip. The only
   genuinely NEW per-save field this package introduces is a placed blind's
   `closed` flag — everything else (window/blind ownership & placement) rides
   on the pre-existing owned/placed shape, which normalizeSave() already
   copies whole. */
check('a closed blind survives save -> reload through the REAL save path', function () {
  var store = {};
  var win = freshGame(store);
  var State = win.Game.State;
  own(win, 'window_small_black', 1);
  own(win, 'blind_slat', 1);
  var wres = State.placeItem('window_small_black', 1, 0, 0);
  assert.strictEqual(wres.ok, true, 'window placement failed: ' + JSON.stringify(wres));
  var bres = State.placeItem('blind_slat', 1, 0, 0);
  assert.strictEqual(bres.ok, true, 'blind placement failed: ' + JSON.stringify(bres));
  var placed = State.data.placed;
  var blindIdx = -1;
  for (var i = 0; i < placed.length; i++) if (placed[i].id === 'blind_slat') blindIdx = i;
  assert.notStrictEqual(blindIdx, -1);
  assert.strictEqual(placed[blindIdx].closed, false, 'a freshly placed blind must start OPEN (closed: false)');
  var toggleRes = State.toggleBlind(blindIdx);
  assert.strictEqual(toggleRes.ok, true);
  assert.strictEqual(toggleRes.closed, true);
  assert.strictEqual(State.data.placed[blindIdx].closed, true);
  State.save();

  // Reload in a BRAND NEW window/State instance sharing the same
  // localStorage-backed store — this is the real load path, not a shortcut.
  var win2 = freshGame(store);
  var State2 = win2.Game.State;
  var reloadedBlind = State2.data.placed.filter(function (p) { return p.id === 'blind_slat'; })[0];
  assert.ok(reloadedBlind, 'blind must still be placed after reload');
  assert.strictEqual(reloadedBlind.closed, true, 'closed:true must survive save -> reload');
  assert.strictEqual(State2.data.owned.window_small_black, 1);
  assert.strictEqual(State2.data.owned.blind_slat, 1);
});

/* ================================================================ 2 ==== */
/* §1: windows are wall-mounted exactly like banners; wide windows need TWO
   adjacent wall slots. */
check('data.js: all 4 window items exist, are mount:wall, category:window; wide ones carry footprint {w:2,d:1}', function () {
  var win = freshGame();
  var S = win.Game.State;
  ['window_small_black', 'window_small_wood', 'window_wide_black', 'window_wide_wood'].forEach(function (id) {
    var def = S.findShopItem(id);
    assert.ok(def, id + ' must exist');
    assert.strictEqual(def.mount, 'wall', id + ' must be mount:wall');
    assert.strictEqual(def.category, 'window', id + ' must be category:window');
  });
  assert.strictEqual(S.findShopItem('window_small_black').price, 900);
  assert.strictEqual(S.findShopItem('window_wide_black').price, 3200);
  var wide = S.findShopItem('window_wide_black');
  assert.deepStrictEqual(S.itemFootprint(wide), { w: 2, d: 1 });
  var small = S.findShopItem('window_small_black');
  assert.deepStrictEqual(S.itemFootprint(small), { w: 1, d: 1 });
});

check('a small window CAN be placed on a wall tile, CANNOT on an interior tile', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_small_black', 2);
  var okRes = State.placeItem('window_small_black', 2, 0, 0);
  assert.strictEqual(okRes.ok, true, JSON.stringify(okRes));
  var badRes = State.placeItem('window_small_black', 1, 1, 0);
  assert.strictEqual(badRes.ok, false);
  assert.strictEqual(badRes.reason, 'BANNERS MOUNT ON WALLS ONLY');
});

check('a wide window needs TWO adjacent free wall slots; fits when both are free', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_wide_black', 1);
  // (0,4x4 grid) back wall (y=0): x=1 and x=2 both free.
  var res = State.placeItem('window_wide_black', 1, 0, 0);
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  var entry = State.data.placed[State.data.placed.length - 1];
  var tiles = State.wallFootprintTiles(entry.x, entry.y, State.findShopItem('window_wide_black'));
  assert.strictEqual(tiles.length, 2);
  assert.deepStrictEqual(tiles, [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
});

check('a wide window refuses when only ONE of its two wall slots is free', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_wide_black', 1);
  own(win, 'poster_team', 1);
  // Occupy (2,0) with a banner so the wide window's second tile is blocked.
  var bannerRes = State.placeItem('poster_team', 2, 0, 0);
  assert.strictEqual(bannerRes.ok, true);
  var res = State.placeItem('window_wide_black', 1, 0, 0);
  assert.strictEqual(res.ok, false, 'must refuse: only tile (1,0) is free, (2,0) is taken');
  assert.ok(res.reason);
});

check('a wide window off the edge of the grid (only one tile in bounds) refuses', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_wide_black', 1);
  var grid = State.currentGrid(); // 4x4 basement
  var res = State.placeItem('window_wide_black', grid.w - 1, 0, 0); // last column -> +1 tile is OOB
  assert.strictEqual(res.ok, false);
});

check('State.isWindowTile reports true for every wall tile a placed window covers, false elsewhere', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_wide_black', 1);
  State.placeItem('window_wide_black', 1, 0, 0);
  assert.strictEqual(State.isWindowTile(1, 0), true);
  assert.strictEqual(State.isWindowTile(2, 0), true);
  assert.strictEqual(State.isWindowTile(3, 0), false);
  assert.strictEqual(State.isWindowTile(1, 1), false);
});

/* ================================================================ 3 ==== */
/* §2: LEDs (rgb_strip, neon_sign) ignore tile collision. */
check('data.js: rgb_strip and neon_sign both carry noCollide: true', function () {
  var win = freshGame();
  var S = win.Game.State;
  assert.strictEqual(S.findShopItem('rgb_strip').noCollide, true);
  assert.strictEqual(S.findShopItem('neon_sign').noCollide, true);
  assert.notStrictEqual(S.findShopItem('desk_plywood').noCollide, true, 'an ordinary item must not carry noCollide');
});

check('an RGB strip CAN be placed on a tile that already holds a desk/pc/monitor (green/ok over an occupied tile)', function () {
  var win = freshGame();
  var State = win.Game.State;
  furnish(win); // V22 item 2: a fresh room is EMPTY now — apply the canonical layout
  own(win, 'rgb_strip', 1);
  // The starter layout stacks desk+pc+monitor at (1,1).
  var occBefore = State.tileOccupantsAt(1, 1);
  assert.ok(occBefore.length >= 2, 'sanity: (1,1) must already be occupied by the starting desk/pc/monitor');
  var res = State.placeItem('rgb_strip', 1, 1, 0);
  assert.strictEqual(res.ok, true, 'noCollide item must place on an occupied tile: ' + JSON.stringify(res));
});

check('placing an RGB strip on an occupied tile does NOT block the tile for a later ordinary item move', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'rgb_strip', 1);
  own(win, 'trophy_shelf', 1);
  State.placeItem('rgb_strip', 2, 2, 0);
  var res = State.placeItem('trophy_shelf', 2, 2, 0);
  assert.strictEqual(res.ok, true, 'an ordinary item must still be placeable where an LED already sits: ' + JSON.stringify(res));
});

check('two LEDs (rgb_strip + neon_sign) CANNOT share the exact same tile', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'rgb_strip', 1);
  own(win, 'neon_sign', 1);
  var res1 = State.placeItem('rgb_strip', 3, 3, 0);
  assert.strictEqual(res1.ok, true);
  var res2 = State.placeItem('neon_sign', 3, 3, 0);
  assert.strictEqual(res2.ok, false, 'a second noCollide item must not stack on the exact same tile as another');
  assert.ok(res2.reason);
});

check('canPlaceFootprint reports ok for a noCollide item at an occupied tile directly (what hub.js derives from)', function () {
  var win = freshGame();
  var State = win.Game.State;
  var def = State.findShopItem('neon_sign');
  var res = State.canPlaceFootprint(def, 1, 1, 0, -1); // (1,1) already holds desk/pc/monitor
  assert.strictEqual(res.ok, true, JSON.stringify(res));
});

/* ================================================================ 4 ==== */
/* §3: blinds snap to window tiles only; small=1, wide=2. */
check('a blind CANNOT be placed on a wall tile with no window, with the exact spec reason', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'blind_slat', 1);
  var res = State.placeItem('blind_slat', 0, 2, 0);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'BLINDS GO ON WINDOWS');
});

check('a blind CANNOT be placed on an interior (non-wall) tile either', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'blind_slat', 1);
  var res = State.placeItem('blind_slat', 2, 2, 0);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'BLINDS GO ON WINDOWS');
});

check('a small window needs exactly 1 blind: the 1 tile takes a blind, a 2nd blind on the same tile refuses', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_small_black', 1);
  own(win, 'blind_slat', 2);
  State.placeItem('window_small_black', 1, 0, 0);
  var res1 = State.placeItem('blind_slat', 1, 0, 0);
  assert.strictEqual(res1.ok, true, JSON.stringify(res1));
  var res2 = State.placeItem('blind_slat', 1, 0, 0);
  assert.strictEqual(res2.ok, false, 'a second blind must not stack on the same window tile');
});

check('a wide window needs exactly 2 blinds: one on each of its two wall tiles', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_wide_black', 1);
  own(win, 'blind_slat', 2);
  State.placeItem('window_wide_black', 1, 0, 0); // tiles (1,0) and (2,0)
  var res1 = State.placeItem('blind_slat', 1, 0, 0);
  var res2 = State.placeItem('blind_slat', 2, 0, 0);
  assert.strictEqual(res1.ok, true, JSON.stringify(res1));
  assert.strictEqual(res2.ok, true, JSON.stringify(res2));
});

check('State.isBlind identifies blind_slat and rejects an ordinary item', function () {
  var win = freshGame();
  var State = win.Game.State;
  assert.strictEqual(State.isBlind('blind_slat'), true);
  assert.strictEqual(State.isBlind('poster_team'), false);
});

/* ================================================================ 5 ==== */
/* §3: +15% sleep-energy-regen buff — on only when every window is covered
   by CLOSED blinds, off with zero windows, non-stacking. */
check('sleep bonus is OFF on a fresh save (zero windows owned)', function () {
  var win = freshGame();
  var State = win.Game.State;
  assert.strictEqual(State.blindsBonusActive(), false);
  var bed = State.currentBed();
  assert.strictEqual(State.effectiveSleepRate(), bed.sleepRate, 'no bonus applied with zero windows');
});

check('sleep bonus is OFF while a window is owned but not covered (or not placed)', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_small_black', 1);
  assert.strictEqual(State.blindsBonusActive(), false, 'owned-but-unplaced window must not grant the bonus');
  State.placeItem('window_small_black', 1, 0, 0);
  assert.strictEqual(State.blindsBonusActive(), false, 'placed but uncovered window must not grant the bonus');
});

check('sleep bonus turns ON at exactly +15% once every window is covered by CLOSED blinds', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_small_black', 1);
  own(win, 'blind_slat', 1);
  State.placeItem('window_small_black', 1, 0, 0);
  var res = State.placeItem('blind_slat', 1, 0, 0);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(State.blindsBonusActive(), false, 'must stay off while the blind is still OPEN');
  var idx = State.data.placed.length - 1;
  State.toggleBlind(idx);
  assert.strictEqual(State.blindsBonusActive(), true, 'must turn on once the blind is CLOSED');
  var bed = State.currentBed();
  var expected = bed.sleepRate * 1.15;
  assert.ok(Math.abs(State.effectiveSleepRate() - expected) < 1e-9,
    'expected ' + expected + ', got ' + State.effectiveSleepRate());
});

check('sleep bonus does NOT stack: two fully-covered windows still give exactly +15%, not +30%', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_small_black', 2);
  own(win, 'blind_slat', 2);
  State.placeItem('window_small_black', 1, 0, 0);
  State.placeItem('window_small_black', 0, 1, 0);
  State.placeItem('blind_slat', 1, 0, 0);
  State.placeItem('blind_slat', 0, 1, 0);
  var placed = State.data.placed;
  for (var i = 0; i < placed.length; i++) if (placed[i].id === 'blind_slat') State.toggleBlind(i);
  assert.strictEqual(State.blindsBonusActive(), true);
  var bed = State.currentBed();
  var expected = bed.sleepRate * 1.15;
  assert.ok(Math.abs(State.effectiveSleepRate() - expected) < 1e-9,
    'must be flat +15%, not stacked: expected ' + expected + ', got ' + State.effectiveSleepRate());
});

check('sleep bonus turns back OFF if any one covered window\'s blind is re-opened', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_wide_black', 1);
  own(win, 'blind_slat', 2);
  State.placeItem('window_wide_black', 1, 0, 0);
  State.placeItem('blind_slat', 1, 0, 0);
  State.placeItem('blind_slat', 2, 0, 0);
  var placed = State.data.placed;
  var blindIdxs = [];
  for (var i = 0; i < placed.length; i++) if (placed[i].id === 'blind_slat') blindIdxs.push(i);
  blindIdxs.forEach(function (idx) { State.toggleBlind(idx); });
  assert.strictEqual(State.blindsBonusActive(), true, 'both blinds closed on the wide window -> on');
  State.toggleBlind(blindIdxs[0]); // re-open one
  assert.strictEqual(State.blindsBonusActive(), false, 'one open blind on a wide window must drop the bonus');
});

check('doTick actually applies the boosted rate while asleep', function () {
  var win = freshGame();
  var State = win.Game.State;
  furnish(win); // needs a placed BED to sleep at all (V22 item 2: empty by default)
  own(win, 'window_small_black', 1);
  own(win, 'blind_slat', 1);
  State.placeItem('window_small_black', 1, 0, 0);
  State.placeItem('blind_slat', 1, 0, 0);
  var idx = State.data.placed.length - 1;
  State.toggleBlind(idx);
  State.data.energy = 10;
  var sleepRes = State.sleep();
  assert.strictEqual(sleepRes.ok, true, JSON.stringify(sleepRes));
  var before = State.data.energy;
  State.data.lastEnergyTickAt = Date.now() - 1000; // simulate 1 real second asleep
  State.tickEnergy();
  var gained = State.data.energy - before;
  var bed = State.currentBed();
  var expectedGain = bed.sleepRate * 1.15 * 1; // 1 second
  assert.ok(Math.abs(gained - expectedGain) < 0.05,
    'expected ~' + expectedGain + ' energy gained in 1s asleep, got ' + gained);
});

/* ================================================================ 6 ==== */
/* §4: banner/neon merchandise buff — flat +5%, non-stacking. */
check('data.js: poster_team and neon_sign both carry merchBonus: true', function () {
  var win = freshGame();
  var S = win.Game.State;
  assert.strictEqual(S.findShopItem('poster_team').merchBonus, true);
  assert.strictEqual(S.findShopItem('neon_sign').merchBonus, true);
});

check('merchandiseBonusPct is 0 with nothing placed, and off while a banner is owned-but-unplaced', function () {
  var win = freshGame();
  var State = win.Game.State;
  assert.strictEqual(State.merchandiseBonusPct(), 0);
  own(win, 'poster_team', 1);
  assert.strictEqual(State.merchandiseBonusPct(), 0, 'owned-but-unplaced must not grant the bonus');
});

check('exactly +5% with ONE banner placed', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  State.placeItem('poster_team', 0, 1, 0);
  assert.strictEqual(State.merchandiseBonusPct(), 0.05);
});

check('still exactly +5% with THREE banners placed (non-stacking)', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 3);
  State.placeItem('poster_team', 0, 1, 0);
  State.placeItem('poster_team', 0, 2, 0);
  State.placeItem('poster_team', 0, 3, 0);
  assert.strictEqual(State.merchandiseBonusPct(), 0.05, 'three placed banners must still be exactly +5%');
});

check('a banner + a neon sign together still give exactly +5% total, not +10%', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  own(win, 'neon_sign', 1);
  State.placeItem('poster_team', 0, 1, 0);
  State.placeItem('neon_sign', 2, 2, 0); // neon is a normal floor decor placement
  assert.strictEqual(State.merchandiseBonusPct(), 0.05);
});

check('applyStreamResult scales followers/peakViewers by exactly the merch multiplier', function () {
  // Ownership (and therefore the banner's OWN prestige stat / viewerMult,
  // an existing SPEC-V3 §7 mechanic unrelated to this buff) is held CONSTANT
  // across both calls — only placement changes — so the only thing that can
  // move between the two results is the merch bonus itself.
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  var baseResult = State.applyStreamResult({ cash: 0, followers: 1000, peakViewers: 500 }); // owned, not placed -> merch off
  State.placeItem('poster_team', 0, 1, 0); // now placed -> merch on; ownership/prestige unchanged
  var bonusResult = State.applyStreamResult({ cash: 0, followers: 1000, peakViewers: 500 });

  assert.strictEqual(baseResult.merchBonusPct, 0);
  assert.strictEqual(bonusResult.merchBonusPct, 0.05);
  var expectedFollowers = Math.round(baseResult.followers * 1.05);
  assert.strictEqual(bonusResult.followers, expectedFollowers,
    'followers must scale by exactly +5%: expected ' + expectedFollowers + ', got ' + bonusResult.followers);
  assert.strictEqual(bonusResult.peakViewers, Math.round(baseResult.peakViewers * 1.05));
});

/* ================================================================ 7 ==== */
/* §5: lucky_mousepad -> FLOOR LED SCREEN, id kept, stats stripped. */
check('lucky_mousepad keeps its id, is renamed, and has NO stat effects', function () {
  var win = freshGame();
  var S = win.Game.State;
  var def = S.findShopItem('lucky_mousepad');
  assert.ok(def, 'id must be kept so old saves still resolve');
  assert.strictEqual(def.name, 'FLOOR LED SCREEN');
  assert.deepStrictEqual(def.stats || {}, {});
});

check('gearBonus() reports zero luck/no crash for a player owning lucky_mousepad (stats stripped)', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'lucky_mousepad', 1);
  var gear = State.gearBonus();
  assert.strictEqual(gear.luck, 0, 'luck must be 0 now that lucky_mousepad no longer grants it');
  assert.strictEqual(typeof gear.prestige, 'number');
});

check('an existing save owning+placing a lucky_mousepad loads cleanly with no dangling buff', function () {
  var store = {};
  var seedWin = makeWindow(store);
  loadInto(seedWin, 'js/data.js');
  loadInto(seedWin, 'js/state.js');
  seedWin.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{
      v: 1, locationId: 0,
      owned: { lucky_mousepad: 1, desk_ikea: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 },
      placed: [
        { id: 'lucky_mousepad', x: 2, y: 2, rot: 0 },
        { id: 'desk_ikea', x: 1, y: 1, rot: 0 },
        { id: 'pc_budget', x: 1, y: 1, rot: 0 },
        { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
        { id: 'bed_mattress', x: 2, y: 3, rot: 0 },
        { id: 'monitor_basic', x: 1, y: 1, rot: 0 }
      ]
    }, null, null],
    lastSlot: 0
  }));
  var State = seedWin.Game.State;
  var normalized = State.loadSlot(0);
  assert.strictEqual(normalized.owned.lucky_mousepad, 1);
  var placedScreen = normalized.placed.filter(function (p) { return p.id === 'lucky_mousepad'; })[0];
  assert.ok(placedScreen, 'must still be placed after load');
  var gear = State.gearBonus();
  assert.strictEqual(gear.luck, 0, 'no dangling luck buff from the old stat block');
  // statsSummary must not throw despite the item's stats having changed shape
  assert.doesNotThrow(function () { State.statsSummary(); });
});

check('data.js: lucky_mousepad/poster_team/neon_sign/rgb_strip/blind_slat all carry customisable: true where spec\'d', function () {
  var win = freshGame();
  var State = win.Game.State;
  ['lucky_mousepad', 'poster_team', 'neon_sign', 'rgb_strip'].forEach(function (id) {
    assert.strictEqual(State.isCustomisable(id), true, id + ' must be customisable');
  });
  assert.strictEqual(State.isCustomisable('desk_plywood'), false);
});

/* Regression guard for the second V20 shipping bug: a window and its blind
   share one tile BY DESIGN, but two load-time migrations did not know that.
   migrateBedFootprints() visits every item whose footprint area is >1 —
   which now includes wide windows — and measured it with FLOOR geometry,
   seeing the blinds as collisions; migrateWallMounts() treated any two wall
   items on one tile as a conflict and ignored wall spans entirely. Either
   one relocated the window on load, separating the pair and silently
   switching off the +15% sleep buff the player had earned. Asserted through
   a real save/load round-trip in a FRESH VM, because that is the only thing
   that exercises normalizeSave()'s migration chain. */
function roundTrip(setup) {
  var store = {};
  var win = freshGame(store);
  setup(win.Game.State, win.Game.State.data);
  var before = {
    buff: win.Game.State.blindsBonusActive(),
    rate: win.Game.State.effectiveSleepRate(),
    placed: JSON.stringify(win.Game.State.data.placed.filter(function (p) { return /window|blind/.test(p.id); }))
  };
  win.Game.State.saveCurrent();
  var win2 = freshGame(store);
  var after = {
    buff: win2.Game.State.blindsBonusActive(),
    rate: win2.Game.State.effectiveSleepRate(),
    placed: JSON.stringify(win2.Game.State.data.placed.filter(function (p) { return /window|blind/.test(p.id); }))
  };
  return { before: before, after: after };
}

check('windows+blinds survive a save/load round-trip without being separated', function () {
  // small window, one closed blind on it -> buff ON, and still ON after load
  var r = roundTrip(function (S, d) {
    d.owned.window_small_black = 1; d.owned.blind_slat = 1;
    d.placed.push({ id: 'window_small_black', x: 0, y: 0, rot: S.wallRotForTile(0, 0) });
    d.placed.push({ id: 'blind_slat', x: 0, y: 0, rot: S.wallRotForTile(0, 0), closed: true });
  });
  assert.strictEqual(r.before.buff, true, 'buff must be earned before saving');
  assert.strictEqual(r.after.buff, true, 'buff must SURVIVE the load — this is the bug');
  assert.strictEqual(r.after.placed, r.before.placed, 'the window/blind pair must not be moved apart');
  assert.strictEqual(r.after.rate, r.before.rate, 'sleep rate must not change across a load');
});

check('a WIDE window keeps both of its blinds across a load', function () {
  var r = roundTrip(function (S, d) {
    d.owned.window_wide_black = 1; d.owned.blind_slat = 2;
    d.placed.push({ id: 'window_wide_black', x: 1, y: 0, rot: S.wallRotForTile(1, 0) });
    d.placed.push({ id: 'blind_slat', x: 1, y: 0, rot: S.wallRotForTile(1, 0), closed: true });
    d.placed.push({ id: 'blind_slat', x: 2, y: 0, rot: S.wallRotForTile(2, 0), closed: true });
  });
  assert.strictEqual(r.before.buff, true, 'a fully covered wide window earns the buff');
  assert.strictEqual(r.after.buff, true, 'and keeps it after a load');
  assert.strictEqual(r.after.placed, r.before.placed, 'the wide window must not slide along the wall');
});

check('a partly covered wide window does NOT earn the buff, before or after load', function () {
  var r = roundTrip(function (S, d) {
    d.owned.window_wide_black = 1; d.owned.blind_slat = 1;
    d.placed.push({ id: 'window_wide_black', x: 1, y: 0, rot: S.wallRotForTile(1, 0) });
    d.placed.push({ id: 'blind_slat', x: 1, y: 0, rot: S.wallRotForTile(1, 0), closed: true });
  });
  assert.strictEqual(r.before.buff, false, 'one blind cannot cover two panes');
  assert.strictEqual(r.after.buff, false, 'and a load must not accidentally grant it');
});

check('an OPEN blind never earns the buff across a load', function () {
  var r = roundTrip(function (S, d) {
    d.owned.window_small_black = 1; d.owned.blind_slat = 1;
    d.placed.push({ id: 'window_small_black', x: 0, y: 0, rot: S.wallRotForTile(0, 0) });
    d.placed.push({ id: 'blind_slat', x: 0, y: 0, rot: S.wallRotForTile(0, 0), closed: false });
  });
  assert.strictEqual(r.before.buff, false);
  assert.strictEqual(r.after.buff, false);
  assert.ok(/"closed":false/.test(r.after.placed), 'the open/closed flag itself must round-trip');
});

/* Regression guard for the V20 shipping bug: js/data.js gained the `window`
   and `blind` categories, but js/shop.js's CATEGORY_ORDER is a hand-written
   array and nobody added them to it — so the items existed, priced and
   specced, with no tab to reach them from. Unbuyable. This asserts the
   relationship rather than the two names, so ANY future category added to
   Data.shopItems without a shop tab fails here instead of in a playtest.
   shop.js can't be loaded into this harness (it touches document at parse
   time), so the array is read out of the source text. */
check('shop.js: every Data.shopItems category has a tab in CATEGORY_ORDER', function () {
  var win = freshGame();
  var src = fs.readFileSync(path.join(ROOT, 'js/shop.js'), 'utf8');
  var m = src.match(/var CATEGORY_ORDER = (\[[^\]]*\])/);
  assert.ok(m, 'CATEGORY_ORDER array not found in js/shop.js');
  var order = JSON.parse(m[1].replace(/'/g, '"'));
  // 'room' is deliberately retired (legacy roomTier leases, filtered out of
  // every shop view by categoryItems()), so it is the one exemption.
  var cats = {};
  win.Game.Data.shopItems.forEach(function (d) {
    if (d.category !== 'room') cats[d.category] = true;
  });
  Object.keys(cats).forEach(function (c) {
    assert.ok(order.indexOf(c) !== -1,
      'category "' + c + '" has items but no shop tab — it is unreachable');
  });
  // A tab with no label or icon renders as a blank tile, so check those too.
  var labels = src.match(/var CATEGORY_LABEL = \{[\s\S]*?\};/)[0];
  var icons = src.match(/var CATEGORY_ICON = \{[\s\S]*?\n  \};/)[0];
  order.forEach(function (c) {
    assert.ok(new RegExp('\\b' + c + ':').test(labels), c + ' missing from CATEGORY_LABEL');
    assert.ok(new RegExp('\\b' + c + ':').test(icons), c + ' missing from CATEGORY_ICON');
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
