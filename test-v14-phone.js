/* Headless Node smoke test for SPEC-V14-PHONE.md (Package P1's state.js/
   data.js half: §2 unlock rules for d.phoneUnlocked / d.cryptoAppUnlocked,
   the sticky latch, State.phoneStatus(), and the two sponsor-track
   consequences). Loads js/data.js + js/state.js verbatim against a minimal
   `window` + `localStorage` shim, mirroring test-v13-rules.js's harness.
   Run: node test-v14-phone.js  (from the repo root, or anywhere)
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
/* Fresh save defaults + threshold boundary (§2: followers >= 300). */
// V22 (owner item 5): the HANDSET is no longer gated — the player has a phone
// from the first minute and the APPS carry the locks. The app flags still
// default false on a fresh save; what changed is that the phone itself opens.
check('fresh save: the phone is available, but its gated apps are not', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  assert.strictEqual(State.data.socialAppUnlocked, false);
  assert.strictEqual(State.data.sponsorsAppUnlocked, false);
  assert.strictEqual(State.data.cryptoAppUnlocked, false);
  var status = State.phoneStatus();
  assert.strictEqual(status.unlocked, true, 'the handset must be usable from the start');
  assert.strictEqual(status.needed, 500, 'SOCIAL now unlocks at 500 followers, not 300');
});

check('SOCIAL stays locked at 499 followers, unlocks at exactly 500 (latched via State.tickEnergy)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.followers = 499;
  State.tickEnergy();
  assert.strictEqual(State.data.socialAppUnlocked, false, 'must stay locked at 499 followers');
  assert.strictEqual(State.phoneStatus().apps[1].unlocked, false);
  // the handset is open the whole time
  assert.strictEqual(State.phoneStatus().unlocked, true);

  State.data.followers = 500;
  State.tickEnergy();
  assert.strictEqual(State.data.socialAppUnlocked, true, 'must unlock at exactly 500 followers');
  assert.strictEqual(State.phoneStatus().apps[1].unlocked, true);
});

check('SPONSORS unlocks on signing a team — tier 3 counts — and stays unlocked after leaving', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  assert.strictEqual(State.phoneStatus().apps[0].unlocked, false, 'locked before any team');
  State.data.contract = 't3';           // the lowest tier still counts
  State.tickEnergy();
  assert.strictEqual(State.data.sponsorsAppUnlocked, true, 'signing a T3 team must unlock SPONSORS');
  State.data.contract = 'free';         // walk away again
  State.data.myTeamId = null;
  State.tickEnergy();
  assert.strictEqual(State.phoneStatus().apps[0].unlocked, true, 'sticky — never re-locks');
});

check('crypto app stays locked at $19,999, unlocks at exactly $20,000', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.cash = 19999;
  State.tickEnergy();
  assert.strictEqual(State.data.cryptoAppUnlocked, false, 'must stay locked at $19,999');

  State.data.cash = 20000;
  State.tickEnergy();
  assert.strictEqual(State.data.cryptoAppUnlocked, true, 'must unlock at exactly $20,000');
});

/* ================================================================ 2 ==== */
/* Stickiness (§2): once true, never re-locks, even if the number falls. */
check('phone stickiness: unlock then drop followers to 0 -- still unlocked', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.followers = 300;
  State.tickEnergy();
  assert.strictEqual(State.data.phoneUnlocked, true);

  State.data.followers = 0;
  State.tickEnergy();
  assert.strictEqual(State.data.phoneUnlocked, true, 'must stay unlocked once followers drop back to 0');
  assert.strictEqual(State.phoneStatus().unlocked, true);
  // idempotent -- ticking again with the number still at 0 changes nothing
  State.tickEnergy();
  assert.strictEqual(State.data.phoneUnlocked, true);
});

check('crypto stickiness: unlock at $20,000, drop cash to $0 -- still unlocked, and held coins can still be sold', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.cash = 20000;
  State.tickEnergy();
  assert.strictEqual(State.data.cryptoAppUnlocked, true);

  var buy = State.buyCrypto('DOGEBORK', 500);
  assert.strictEqual(buy.ok, true, JSON.stringify(buy));
  assert.ok(buy.qty > 0);

  State.data.cash = 0; // crash cash back below the $20,000 threshold
  State.tickEnergy();
  assert.strictEqual(State.data.cryptoAppUnlocked, true, 'must stay unlocked once cash drops back to $0');
  assert.strictEqual(State.phoneStatus().apps[2].unlocked, true, 'crypto tile must still read unlocked');

  var held = State.data.crypto.holdings.DOGEBORK;
  assert.ok(held && held.qty > 0, 'coins bought earlier must still be held');
  var sell = State.sellCrypto('DOGEBORK', held.qty);
  assert.strictEqual(sell.ok, true, 'a player holding coins must still be able to sell them -- ' + JSON.stringify(sell));
});

/* ================================================================ 3 ==== */
/* Save -> reload round trip via the REAL save path (the check that has
   failed five times in this project per the lead note). */
check('save -> reload round trip preserves BOTH flags when unlocked', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  StateA.data.followers = 300;
  StateA.data.cash = 20000;
  StateA.tickEnergy();
  assert.strictEqual(StateA.data.phoneUnlocked, true);
  assert.strictEqual(StateA.data.cryptoAppUnlocked, true);
  StateA.save();

  // Brand new module instance reading the SAME underlying localStorage
  // store -- a genuine reload, not just re-reading the in-memory object.
  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.strictEqual(StateB.data.phoneUnlocked, true, 'd.phoneUnlocked must survive save/reload');
  assert.strictEqual(StateB.data.cryptoAppUnlocked, true, 'd.cryptoAppUnlocked must survive save/reload');
});

check('save -> reload round trip: flags stay false on a save that never unlocked', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  StateA.save();
  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.strictEqual(StateB.data.phoneUnlocked, false);
  assert.strictEqual(StateB.data.cryptoAppUnlocked, false);
});

check('save -> reload round trip: sticky flags survive even after the underlying numbers fell BEFORE saving', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  StateA.data.followers = 300;
  StateA.data.cash = 20000;
  StateA.tickEnergy();
  StateA.data.followers = 0;
  StateA.data.cash = 0;
  StateA.tickEnergy();
  assert.strictEqual(StateA.data.phoneUnlocked, true);
  assert.strictEqual(StateA.data.cryptoAppUnlocked, true);
  StateA.save();

  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.strictEqual(StateB.data.followers, 0);
  assert.strictEqual(StateB.data.cash, 0);
  assert.strictEqual(StateB.data.phoneUnlocked, true, 'must remain unlocked after reload despite followers=0');
  assert.strictEqual(StateB.data.cryptoAppUnlocked, true, 'must remain unlocked after reload despite cash=0');
});

check('loadSlot() (old-save-shaped raw object with no phone keys at all) defaults both flags false, no throw', function () {
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{ v: 1, day: 1, cash: 250, followers: 0 }, null, null],
    lastSlot: 0
  }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  assert.strictEqual(normalized.phoneUnlocked, false);
  assert.strictEqual(normalized.cryptoAppUnlocked, false);
});

check('loadSlot() (old-save-shaped raw object that already qualifies but predates the flags) latches instantly on load', function () {
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{ v: 1, day: 1, cash: 25000, followers: 500 }, null, null],
    lastSlot: 0
  }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  assert.strictEqual(normalized.phoneUnlocked, true, 'an old save that already qualifies must not sit locked waiting for a tick');
  assert.strictEqual(normalized.cryptoAppUnlocked, true);
});

/* ================================================================ 4 ==== */
/* State.phoneStatus() exact shape, locked and unlocked. */
check('phoneStatus() shape: locked state', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.followers = 50;
  State.data.cash = 250;
  var status = State.phoneStatus();
  assert.strictEqual(status.unlocked, true, 'V22: the handset is never locked');
  assert.strictEqual(status.followers, 50);
  assert.strictEqual(status.needed, 500);
  assert.strictEqual(status.apps.length, 3);
  assert.deepStrictEqual(status.apps.map(function (a) { return a.id; }), ['sponsors', 'social', 'crypto']);

  var sponsors = status.apps[0], social = status.apps[1], crypto = status.apps[2];
  assert.strictEqual(sponsors.name, 'SPONSORS');
  assert.strictEqual(social.name, 'SOCIAL MEDIA');
  assert.strictEqual(crypto.name, 'CRYPTO TRADING');

  assert.strictEqual(sponsors.unlocked, false);
  assert.strictEqual(social.unlocked, false);
  assert.strictEqual(crypto.unlocked, false);

  assert.strictEqual(typeof sponsors.unlockLabel, 'string');
  assert.strictEqual(typeof social.unlockLabel, 'string');
  assert.strictEqual(crypto.unlockLabel, '$20,000 TO INSTALL', 'exact string given by SPEC-V14 §4');
  assert.strictEqual(crypto.unlockLabel, crypto.unlockLabel.toUpperCase(), 'unlockLabel must be ready-to-render UPPERCASE');

  assert.strictEqual(sponsors.notifCount, 0);
  assert.strictEqual(social.notifCount, 0);
  assert.strictEqual(crypto.notifCount, 0);
});

check('phoneStatus() shape: unlocked state -- unlockLabel null, sponsors/social/crypto all unlocked', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.followers = 500;   // V22: SOCIAL threshold
  State.data.cash = 20000;
  State.data.contract = 't3';   // V22: SPONSORS needs a team, any tier
  State.tickEnergy();
  var status = State.phoneStatus();
  assert.strictEqual(status.unlocked, true);
  var sponsors = status.apps[0], social = status.apps[1], crypto = status.apps[2];
  assert.strictEqual(sponsors.unlocked, true);
  assert.strictEqual(social.unlocked, true);
  assert.strictEqual(crypto.unlocked, true);
  assert.strictEqual(sponsors.unlockLabel, null);
  assert.strictEqual(social.unlockLabel, null);
  assert.strictEqual(crypto.unlockLabel, null);
  assert.strictEqual(social.notifCount, 0, 'social must NEVER carry a dot, per §5');
});

check('phoneStatus(): sponsors notifCount counts only held sponsors that are atRisk or warned', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.sponsorsAppUnlocked = true;   // V22: the app, not the handset
  State.data.sponsors = [
    { id: 's1', sponsorId: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 30,
      obligation: { type: 'stream_days', amount: 2 }, progress: 0, warned: true, acquiredDay: 1 },
    { id: 's2', sponsorId: 'sp_grindcoffee', name: 'GRIND COFFEE CO', pay: 65,
      obligation: { type: 'stream_days', amount: 3 }, progress: 3, warned: false, acquiredDay: 1 }
  ];
  var status = State.phoneStatus();
  var expected = State.sponsorsStatus().held.filter(function (s) { return s.atRisk || s.warned; }).length;
  assert.strictEqual(status.apps[0].notifCount, expected);
  assert.strictEqual(status.apps[0].notifCount, 1, 'exactly one of the two held sponsors is warned/atRisk');
});

check('phoneStatus(): crypto notifCount mirrors State.cryptoUnseenNewsCount() exactly (never a second copy of the rule)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.cryptoAppUnlocked = true;
  State.data.crypto.tickCount = 10;
  State.data.crypto.lastSeenNewsTick = 5;
  // SPEC-V15 §3/§18: a fresh save's crypto.news is no longer empty (the
  // market is pre-seeded with ~200 real ticks so it looks alive on first
  // visit) -- clear it here so this check isolates the ONE thing it's
  // actually testing (notifCount mirrors cryptoUnseenNewsCount() exactly)
  // from that unrelated pre-seeded baseline.
  State.data.crypto.news = [];
  State.data.crypto.news.push({ id: 'n1', createdTick: 8, coinId: 'BITCOYN' });
  State.data.crypto.news.push({ id: 'n2', createdTick: 2, coinId: 'ETHERIUM' }); // before lastSeenNewsTick -- not unseen
  var expected = State.cryptoUnseenNewsCount();
  assert.strictEqual(expected, 1);
  var status = State.phoneStatus();
  assert.strictEqual(status.apps[2].notifCount, expected);
});

/* ================================================================ 5 ==== */
/* §2 consequence 1: no sponsor offers may ever arrive while the phone is
   locked. Simulated over many days, asserting zero every single day. */
check('no sponsor offer is ever generated while the phone is locked (200 simulated days)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.dead = false;
  State.data.followers = 0; // never crosses 300 -- stays locked for the whole run

  for (var i = 0; i < 200; i++) {
    State.data.energy = State.data.energyMax;
    State.endDay();
    assert.strictEqual(State.data.phoneUnlocked, false, 'sanity: must remain locked when followers never crosses 300');
    assert.strictEqual((State.data.sponsorOffers || []).length, 0, 'no open sponsor offers may exist while phone locked (day ' + State.data.day + ')');
    assert.strictEqual((State.data.sponsors || []).length, 0, 'no held sponsors may exist while phone locked (day ' + State.data.day + ')');
    assert.strictEqual(State.sponsorOffers().length, 0);
  }
});

/* ================================================================ 6 ==== */
/* §2 consequence 2: no content_posts obligation may ever be rolled while
   the phone is locked; it CAN appear once unlocked. */
check('no content_posts sponsor obligation is ever rolled while the phone is locked (200 simulated days, offers force-cleared to keep the track rolling)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.dead = false;
  State.data.followers = 0; // stays locked

  for (var i = 0; i < 200; i++) {
    State.data.energy = State.data.energyMax;
    State.endDay();
    var offers = State.sponsorOffers();
    offers.forEach(function (o) {
      assert.notStrictEqual(o.obligation && o.obligation.type, 'content_posts', 'a content_posts obligation must never roll while the phone is locked (day ' + State.data.day + ')');
    });
    // clear the inbox/held roster so the track keeps trying every eligible day
    // instead of stalling once MAX_OPEN_SPONSOR_OFFERS is hit
    State.data.sponsorOffers = [];
    State.data.sponsors = [];
  }
});

// V22 (owner item 5): a content_posts sponsor needs BOTH gates — a team (so
// sponsor offers roll at all) and the SOCIAL app (so the obligation can
// actually be progressed).
check('content_posts sponsor obligation CAN appear once SPONSORS and SOCIAL are both open', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  State.data.dead = false;
  State.data.followers = 500;   // SOCIAL
  State.data.contract = 't3';   // SPONSORS
  State.tickEnergy();
  assert.strictEqual(State.data.socialAppUnlocked, true);
  assert.strictEqual(State.data.sponsorsAppUnlocked, true);

  var sawContentPosts = false;
  for (var i = 0; i < 300 && !sawContentPosts; i++) {
    State.data.energy = State.data.energyMax;
    State.endDay();
    var offers = State.sponsorOffers();
    offers.forEach(function (o) {
      if (o.obligation && o.obligation.type === 'content_posts') sawContentPosts = true;
    });
    // keep the inbox from saturating so the roll keeps happening every eligible day
    State.data.sponsorOffers = [];
    State.data.sponsors = [];
  }
  assert.ok(sawContentPosts, 'a content_posts obligation sponsor must be reachable once the phone is unlocked');
});

/* ---- SPEC-V14 §2 grandfather clause (lead-added after P1) -----------------
   Gating sponsor OFFERS stops NEW content_posts sponsors arriving pre-phone,
   but does nothing for a save that ALREADY holds one — and those are
   reachable, because `sp_clipfeed` requires 0 followers and carries a
   content_posts obligation. Such a save would otherwise load into an
   unwinnable obligation: $0, a warning, then dropped at -10 reputation. */
check('a legacy save holding a content_posts sponsor is grandfathered onto the phone', function () {
  var win = makeWindow();
  loadInto(win, 'js/data.js');
  loadInto(win, 'js/state.js');
  var State = win.Game.State;
  State.load();
  var d = State.data;
  d.followers = 0;                 // nowhere near the 300 gate
  d.phoneUnlocked = false;
  d.sponsors = [{
    id: 'held_legacy', sponsorId: 'sp_clipfeed', name: 'CLIPFEED', pay: 40,
    obligation: { type: 'content_posts', amount: 2 }, progress: 0,
    warned: false, acquiredDay: 1
  }];
  State.tickEnergy();
  assert.strictEqual(d.phoneUnlocked, true,
    'holding a content_posts sponsor must unlock the phone, or the obligation is unwinnable');
  assert.strictEqual(d.sponsors.length, 1, 'the sponsor itself must never be taken away');
});

check('a legacy save with only a reachable obligation is NOT grandfathered', function () {
  var win = makeWindow();
  loadInto(win, 'js/data.js');
  loadInto(win, 'js/state.js');
  var State = win.Game.State;
  State.load();
  var d = State.data;
  d.followers = 10;
  d.phoneUnlocked = false;
  d.sponsors = [{
    id: 'held_legacy2', sponsorId: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 30,
    obligation: { type: 'stream_days', amount: 2 }, progress: 0,
    warned: false, acquiredDay: 1
  }];
  State.tickEnergy();
  assert.strictEqual(d.phoneUnlocked, false,
    'a stream_days obligation is satisfiable without the phone — the 300-follower gate must still hold');
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
