/* Headless Node smoke test for SPEC-V21-CUSTOMISE-MODALS.md §1/§3/§4/§5
   (Package C1's data.js/state.js: the customisation palette, the
   customiseFamily/customisePalette/itemTint/setItemTint rules, and the
   blind_slat/ledCustomise flags). Loads js/data.js + js/state.js verbatim
   against a minimal `window` + `localStorage` shim, mirroring
   test-v20-customise.js's harness exactly.
   Run: node test-v21-customise.js  (from the repo root, or anywhere)
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
// these tests are about the customisation rules, not the shop).
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
/* §1/§4: data.js flags — the blind gains `customisable`, the three LED items
   gain `ledCustomise`, the fabric ones do NOT. */
check('data.js: blind_slat carries customisable: true (was missing)', function () {
  var win = freshGame();
  var S = win.Game.State;
  assert.strictEqual(S.findShopItem('blind_slat').customisable, true);
});

check('data.js: neon_sign/rgb_strip/lucky_mousepad carry ledCustomise: true', function () {
  var win = freshGame();
  var S = win.Game.State;
  ['neon_sign', 'rgb_strip', 'lucky_mousepad'].forEach(function (id) {
    assert.strictEqual(S.findShopItem(id).ledCustomise, true, id + ' must be ledCustomise');
  });
});

check('data.js: poster_team/blind_slat do NOT carry ledCustomise (they are fabric)', function () {
  var win = freshGame();
  var S = win.Game.State;
  ['poster_team', 'blind_slat'].forEach(function (id) {
    assert.notStrictEqual(S.findShopItem(id).ledCustomise, true, id + ' must not be ledCustomise');
  });
});

check('data.js: Data.customisePalettes has exactly 8 fabric + 8 led entries, all unique hex strings', function () {
  var win = freshGame();
  var palettes = win.Game.Data.customisePalettes;
  assert.ok(palettes, 'Data.customisePalettes must exist');
  ['fabric', 'led'].forEach(function (fam) {
    assert.strictEqual(palettes[fam].length, 8, fam + ' must have exactly 8 colours');
    palettes[fam].forEach(function (c) { assert.ok(/^#[0-9A-Fa-f]{6}$/.test(c), c + ' must be a hex string'); });
    var uniq = {};
    palettes[fam].forEach(function (c) { uniq[c] = true; });
    assert.strictEqual(Object.keys(uniq).length, 8, fam + ' must have no duplicate colours');
  });
});

/* ================================================================ 2 ==== */
/* §5.3: State.customiseFamily — the single decider of which editor opens. */
check('customiseFamily resolves correctly for all five customisable items, and null for a non-customisable one', function () {
  var win = freshGame();
  var S = win.Game.State;
  assert.strictEqual(S.customiseFamily('poster_team'), 'fabric');
  assert.strictEqual(S.customiseFamily('blind_slat'), 'fabric');
  assert.strictEqual(S.customiseFamily('neon_sign'), 'led');
  assert.strictEqual(S.customiseFamily('rgb_strip'), 'led');
  assert.strictEqual(S.customiseFamily('lucky_mousepad'), 'led');
  assert.strictEqual(S.customiseFamily('desk_plywood'), null, 'a non-customisable item must resolve to null');
  assert.strictEqual(S.customiseFamily('nonexistent_item_xyz'), null, 'an unknown id must resolve to null, not throw');
});

check('customisePalette returns the right array per family, and [] for a non-customisable item', function () {
  var win = freshGame();
  var S = win.Game.State;
  var palettes = win.Game.Data.customisePalettes;
  assert.deepStrictEqual(S.customisePalette('poster_team'), palettes.fabric);
  assert.deepStrictEqual(S.customisePalette('blind_slat'), palettes.fabric);
  assert.deepStrictEqual(S.customisePalette('neon_sign'), palettes.led);
  assert.deepStrictEqual(S.customisePalette('rgb_strip'), palettes.led);
  assert.deepStrictEqual(S.customisePalette('lucky_mousepad'), palettes.led);
  assert.deepStrictEqual(S.customisePalette('desk_plywood'), []);
});

/* ================================================================ 3 ==== */
/* §5.3: State.itemTint / State.setItemTint — every refusal reason. */
check('itemTint reads null on a freshly placed item with no tint written yet', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  State.placeItem('poster_team', 0, 1, 0);
  var idx = State.data.placed.length - 1;
  assert.strictEqual(State.itemTint(idx), null);
});

check('setItemTint refuses an out-of-range index', function () {
  var win = freshGame();
  var State = win.Game.State;
  var res = State.setItemTint(999, '#C0392B');
  assert.strictEqual(res.ok, false);
  assert.ok(res.reason, 'an out-of-range refusal must carry a reason');
});

check('setItemTint refuses a non-customisable placed item with reason NOT CUSTOMISABLE', function () {
  var win = freshGame();
  var State = win.Game.State;
  // V22 item 1: the starting desk is desk_plywood. V22 item 2: a fresh room is
  // EMPTY, so furnish it first — this test needs a placed, non-customisable prop.
  furnish(win);
  var idx = -1;
  for (var i = 0; i < State.data.placed.length; i++) if (State.data.placed[i].id === 'desk_plywood') idx = i;
  assert.notStrictEqual(idx, -1, 'sanity: a desk must be placed by default');
  var res = State.setItemTint(idx, '#C0392B');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'NOT CUSTOMISABLE');
});

check('setItemTint refuses an unknown colour with reason UNKNOWN COLOUR', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  State.placeItem('poster_team', 0, 1, 0);
  var idx = State.data.placed.length - 1;
  var res = State.setItemTint(idx, '#123456'); // not in either palette
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'UNKNOWN COLOUR');
  assert.strictEqual(State.itemTint(idx), null, 'a refused write must not change the stored tint');
});

check('setItemTint refuses a wrong-family colour: an LED colour on a blind', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'window_small_black', 1);
  own(win, 'blind_slat', 1);
  State.placeItem('window_small_black', 1, 0, 0);
  State.placeItem('blind_slat', 1, 0, 0);
  var idx = State.data.placed.length - 1;
  var ledColour = win.Game.Data.customisePalettes.led[0];
  assert.strictEqual(win.Game.Data.customisePalettes.fabric.indexOf(ledColour), -1, 'sanity: chosen colour must not also be a fabric colour');
  var res = State.setItemTint(idx, ledColour);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'UNKNOWN COLOUR');
  assert.strictEqual(State.itemTint(idx), null);
});

check('setItemTint refuses a wrong-family colour: a fabric colour on an LED item', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'neon_sign', 1);
  State.placeItem('neon_sign', 2, 2, 0);
  var idx = State.data.placed.length - 1;
  var fabricColour = win.Game.Data.customisePalettes.fabric[0];
  var res = State.setItemTint(idx, fabricColour);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'UNKNOWN COLOUR');
});

check('setItemTint accepts a valid same-family colour and itemTint reflects it', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'rgb_strip', 1);
  State.placeItem('rgb_strip', 3, 3, 0);
  var idx = State.data.placed.length - 1;
  var colour = win.Game.Data.customisePalettes.led[3];
  var res = State.setItemTint(idx, colour);
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(State.itemTint(idx), colour);
  assert.strictEqual(State.data.placed[idx].tint, colour);
});

/* ================================================================ 4 ==== */
/* §5.3: null clears the key (delete), never stores the string "null". */
check('setItemTint(idx, null) DELETES the tint key rather than storing the string "null"', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  State.placeItem('poster_team', 0, 1, 0);
  var idx = State.data.placed.length - 1;
  var colour = win.Game.Data.customisePalettes.fabric[2];
  var setRes = State.setItemTint(idx, colour);
  assert.strictEqual(setRes.ok, true);
  assert.strictEqual(State.data.placed[idx].tint, colour);

  var clearRes = State.setItemTint(idx, null);
  assert.strictEqual(clearRes.ok, true, JSON.stringify(clearRes));
  assert.strictEqual(State.itemTint(idx), null);
  assert.ok(!Object.prototype.hasOwnProperty.call(State.data.placed[idx], 'tint'),
    'the tint KEY must be deleted from the placed entry, not set to the string "null"');
  // A factory item must serialise clean: JSON.stringify must not mention "tint" at all.
  var json = JSON.stringify(State.data.placed[idx]);
  assert.ok(json.indexOf('tint') === -1, 'a factory-finish entry must not mention tint in its serialised form: ' + json);
});

check('setItemTint(idx, null) on an already-clean (never-tinted) item is a harmless no-op success', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  State.placeItem('poster_team', 0, 1, 0);
  var idx = State.data.placed.length - 1;
  var res = State.setItemTint(idx, null);
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(State.itemTint(idx), null);
});

/* ================================================================ 5 ==== */
/* §3: tint survives a REAL save -> reload round trip in a FRESH VM, with no
   top-level mirror needed — normalizeSave() copies `placed` wholesale. */
check('a tint survives a save -> reload round trip through the REAL save path, in a fresh VM', function () {
  var store = {};
  var win = freshGame(store);
  var State = win.Game.State;
  own(win, 'rgb_strip', 1);
  var placeRes = State.placeItem('rgb_strip', 2, 2, 0);
  assert.strictEqual(placeRes.ok, true, JSON.stringify(placeRes));
  var idx = State.data.placed.length - 1;
  var colour = win.Game.Data.customisePalettes.led[5];
  var setRes = State.setItemTint(idx, colour);
  assert.strictEqual(setRes.ok, true, JSON.stringify(setRes));
  State.save();

  // Reload in a BRAND NEW window/State instance sharing the same
  // localStorage-backed store — this is the real load path, not a shortcut.
  var win2 = freshGame(store);
  var State2 = win2.Game.State;
  var reloaded = State2.data.placed.filter(function (p) { return p.id === 'rgb_strip'; })[0];
  assert.ok(reloaded, 'the rgb_strip must still be placed after reload');
  assert.strictEqual(reloaded.tint, colour, 'tint must survive save -> reload with no defaultData() change needed');
  var reloadedIdx = State2.data.placed.indexOf(reloaded);
  assert.strictEqual(State2.itemTint(reloadedIdx), colour);
});

check('a cleared (factory) tint stays cleared across a save -> reload round trip', function () {
  var store = {};
  var win = freshGame(store);
  var State = win.Game.State;
  own(win, 'poster_team', 1);
  State.placeItem('poster_team', 0, 1, 0);
  var idx = State.data.placed.length - 1;
  var colour = win.Game.Data.customisePalettes.fabric[1];
  State.setItemTint(idx, colour);
  State.setItemTint(idx, null); // undo before saving
  State.save();

  var win2 = freshGame(store);
  var State2 = win2.Game.State;
  var reloaded = State2.data.placed.filter(function (p) { return p.id === 'poster_team'; })[0];
  assert.ok(reloaded, 'the poster must still be placed after reload');
  assert.ok(!Object.prototype.hasOwnProperty.call(reloaded, 'tint'), 'a factory finish must not resurrect a tint key on load');
  var reloadedIdx = State2.data.placed.indexOf(reloaded);
  assert.strictEqual(State2.itemTint(reloadedIdx), null);
});

check('two different placed instances of the same item hold INDEPENDENT tints (per-entry, not per-def)', function () {
  var win = freshGame();
  var State = win.Game.State;
  own(win, 'neon_sign', 2);
  State.placeItem('neon_sign', 1, 3, 0);
  State.placeItem('neon_sign', 3, 1, 0);
  var idxs = [];
  for (var i = 0; i < State.data.placed.length; i++) if (State.data.placed[i].id === 'neon_sign') idxs.push(i);
  assert.strictEqual(idxs.length, 2);
  var led = win.Game.Data.customisePalettes.led;
  State.setItemTint(idxs[0], led[0]);
  State.setItemTint(idxs[1], led[1]);
  assert.strictEqual(State.itemTint(idxs[0]), led[0]);
  assert.strictEqual(State.itemTint(idxs[1]), led[1]);
  assert.notStrictEqual(State.itemTint(idxs[0]), State.itemTint(idxs[1]));
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
