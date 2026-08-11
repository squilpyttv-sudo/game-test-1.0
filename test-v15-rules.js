/* Headless Node smoke test for SPEC-V15-BATCH-A.md (Package A1's js/data.js +
   js/state.js half). Loads js/data.js + js/state.js verbatim against a
   minimal `window` + `localStorage` shim, mirroring test-v13-rules.js /
   test-v14-phone.js's harness.
   Run: node test-v15-rules.js  (from the repo root, or anywhere)
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
// onboarding. Tests that need a FURNISHED room (signing, CASES and TRAIN are
// all gated on room completeness, SPEC-V5 5r) apply the canonical layout.
function furnish(win) {
  win.Game.State.data.placed = JSON.parse(JSON.stringify(win.Game.Data.starterLayout));
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
/* §6 sheep 3%: each hit restores 3% of max energy, form/cash unchanged. */
check('sheep hit restores 3% of max energy (Data.sheepReward.energyPerHit)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  assert.strictEqual(win.Game.Data.sheepReward.energyPerHit, 0.03);
  d.asleep = true;
  d.energyMax = 100;
  d.energy = 0;
  var res = State.sheepHit();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(d.energy, 3, 'one hit must restore exactly 3% of a 100 max-energy pool');
});

check('sheep form/cash rewards unchanged (formPerBonus 0.01/formCap 0.10, cashMin/Max 1-3/cap 50)', function () {
  var win = freshGame();
  var r = win.Game.Data.sheepReward;
  assert.strictEqual(r.formPerBonus, 0.01);
  assert.strictEqual(r.formCap, 0.10);
  assert.strictEqual(r.cashMin, 1);
  assert.strictEqual(r.cashMax, 3);
  assert.strictEqual(r.cashCapPerSleep, 50);
  assert.strictEqual(r.hitsPerBonus, 5);
});

/* ================================================================ 2 ==== */
/* §9 item renames: ids unchanged, names updated, prices/regenAdd untouched,
   regen_hyperbaric gains a 2x1 footprint. */
check('item renames: ids unchanged, names updated, prices/stats/regenAdd untouched', function () {
  var win = freshGame();
  var Data = win.Game.Data;
  function item(id) { return Data.shopItems.filter(function (i) { return i.id === id; })[0]; }
  var footrest = item('regen_footrest');
  assert.strictEqual(footrest.name, 'CIRCULATION FAN');
  assert.strictEqual(footrest.price, 800);
  assert.strictEqual(footrest.regenAdd, 0.15);

  var standdesk = item('regen_standdesk');
  assert.strictEqual(standdesk.name, 'WATER COOLER');
  assert.strictEqual(standdesk.price, 15000);
  assert.strictEqual(standdesk.regenAdd, 0.40);

  var hyperbaric = item('regen_hyperbaric');
  assert.strictEqual(hyperbaric.name, 'RECOVERY POD');
  assert.strictEqual(hyperbaric.price, 120000);
  assert.strictEqual(hyperbaric.regenAdd, 1.00);
  assert.deepStrictEqual(hyperbaric.footprint, { w: 2, d: 1 }, 'RECOVERY POD must gain a 2x1 footprint');

  var succulent = item('plant_succulent');
  assert.strictEqual(succulent.name, 'CACTUS');
  assert.strictEqual(succulent.price, 30);

  var stack = item('energy_drink_stack');
  assert.strictEqual(stack.name, 'PIZZA BOX TOWER');
  assert.strictEqual(stack.price, 90);

  var purifier = item('regen_purifier');
  assert.strictEqual(purifier.name, 'AIR PURIFIER', 'unchanged per spec');
});

check('regen_hyperbaric footprint migration: a legacy 1x1-placed pod with a neighbour never deletes either item', function () {
  var win = freshGame();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({
    slots: [{
      v: 1, day: 1, cash: 250, followers: 0,
      owned: { regen_hyperbaric: 1, plant_succulent: 1 },
      placed: [
        { id: 'regen_hyperbaric', x: 0, y: 0, rot: 0 },
        { id: 'plant_succulent', x: 1, y: 0, rot: 0 } // sits exactly where the pod's new 2nd tile now lands
      ]
    }, null, null],
    lastSlot: 0
  }));
  var State = win.Game.State;
  var normalized = State.loadSlot(0);
  assert.ok((normalized.owned.regen_hyperbaric || 0) >= 1, 'the pod must never be deleted from owned');
  assert.ok((normalized.owned.plant_succulent || 0) >= 1, 'the cactus must never be deleted from owned');
  // No two placed items' footprints may overlap after migration.
  var placed = normalized.placed;
  var allTiles = [];
  for (var i = 0; i < placed.length; i++) {
    var def = State.findShopItem(placed[i].id);
    if (!def) continue;
    var tiles = State.footprintTiles(def, placed[i].x, placed[i].y, placed[i].rot || 0);
    for (var j = 0; j < tiles.length; j++) {
      for (var k = 0; k < allTiles.length; k++) {
        assert.ok(!(allTiles[k].x === tiles[j].x && allTiles[k].y === tiles[j].y), 'no two placed footprints may overlap after migration');
      }
      allTiles.push(tiles[j]);
    }
  }
});

/* ================================================================ 3 ==== */
/* §5 social managers post per DAY, guaranteed, still 0 energy. */
check('social managers: catalog rates are 1/2/3 posts PER DAY (postsPerDay, not postsPerWeek)', function () {
  var win = freshGame();
  var mgrs = win.Game.Data.socialManagers;
  function mgr(id) { return mgrs.filter(function (m) { return m.id === id; })[0]; }
  assert.strictEqual(mgr('social_intern').postsPerDay, 1);
  assert.strictEqual(mgr('content_editor').postsPerDay, 2);
  assert.strictEqual(mgr('creative_director').postsPerDay, 3);
  assert.strictEqual(mgr('social_intern').postsPerWeek, undefined, 'the old weekly field must be gone, not left half-wired');
});

check('hired manager guarantees postsPerDay auto-posts EVERY day (deterministic, not a weekly chance)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.cash = 100000;
  var hireRes = State.hireSocialManager('creative_director'); // postsPerDay: 3
  assert.strictEqual(hireRes.ok, true, JSON.stringify(hireRes));
  for (var i = 0; i < 10; i++) {
    d.energy = d.energyMax;
    var summary = State.endDay();
    // Read straight off the day's summary (applyManagerAutoPosts' own
    // report) rather than the postsThisWeek counter, which can be reset to
    // 0 on the SAME tick by applySocialAdRevenue on a payout day and would
    // otherwise give a false negative.
    assert.strictEqual(summary.socialAutoPosts.length, 3, 'expected exactly 3 manager auto-posts this day (day ' + d.day + ')');
  }
});

check('social manager auto-posts still cost the player ZERO energy', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.cash = 100000;
  State.hireSocialManager('creative_director');
  d.energy = d.energyMax;
  var energyBefore = d.energy;
  State.endDay(); // endDay() itself refills energy to max as the FIRST step (legacy behaviour)
  // Re-check on a day where energy is deliberately left NOT full beforehand
  // by immediately re-measuring against energyMax (endDay always resets to
  // max at the top) -- the real assertion is that nothing UNDER energyMax
  // gets consumed for the manager's own posts specifically, which we verify
  // by comparing to a day with the manager fired.
  var d2cash = 100000;
  var win2 = freshGame();
  var State2 = win2.Game.State;
  State2.load();
  State2.data.cash = d2cash;
  State2.data.energy = State2.data.energyMax;
  State2.endDay(); // no manager hired
  assert.strictEqual(d.energy, State2.data.energy, 'a hired manager\'s free auto-posts must not consume any extra energy vs no manager at all');
});

/* ================================================================ 4 ==== */
/* §4 sponsor pay: new catalog values + progress-scaling formula + $350 floor
   + frozen-at-generation (never drifts once held). */
check('sponsor catalog pay values match the SPEC-V15 table exactly', function () {
  var win = freshGame();
  var sponsors = win.Game.Data.sponsors;
  function sp(id) { return sponsors.filter(function (s) { return s.id === id; })[0]; }
  var expect = {
    sp_pixelsnacks: 350, sp_clipfeed: 420, sp_fiberline: 500, sp_grindcoffee: 700,
    sp_voltenergy: 1200, sp_streamgear: 1400, sp_apexperiph: 1600, sp_nitroburst: 2400,
    sp_specterhw: 3200, sp_voltagemedia: 3600, sp_titanchipset: 4500
  };
  Object.keys(expect).forEach(function (id) {
    assert.strictEqual(sp(id).pay, expect[id], id + ' catalog pay');
  });
});

check('Data.sponsorPayFor(): $350 floor is absolute, and pay scales upward with ELO and signed tier', function () {
  var win = freshGame();
  var Data = win.Game.Data;
  // Even a tiny catalog pay at 0 ELO must floor at $350.
  assert.strictEqual(Data.sponsorPayFor(30, 0, null), 350);
  assert.strictEqual(Data.sponsorPayFor(30, 1500, null), 350);
  // Monotonic increase with ELO for a fixed catalog pay.
  var low = Data.sponsorPayFor(1200, 1600, null);
  var mid = Data.sponsorPayFor(1200, 3000, null);
  var high = Data.sponsorPayFor(1200, 5000, null);
  assert.ok(low <= mid && mid <= high, 'pay must scale upward with ELO: ' + low + ' / ' + mid + ' / ' + high);
  assert.ok(high > low, 'high-ELO pay must exceed low-ELO pay for the same catalog entry');
  // Monotonic increase with a better (numerically lower) signed tier.
  var t3 = Data.sponsorPayFor(1200, 5000, 3);
  var t2 = Data.sponsorPayFor(1200, 5000, 2);
  var t1 = Data.sponsorPayFor(1200, 5000, 1);
  assert.ok(t1 >= t2 && t2 >= t3, 'a better signed tier must pay the same or more: t1=' + t1 + ' t2=' + t2 + ' t3=' + t3);
  // Every result, across a wide sweep, is >= 350.
  for (var elo = 0; elo <= 6000; elo += 250) {
    for (var tier = 0; tier <= 3; tier++) {
      var t = tier === 0 ? null : tier;
      var pay = Data.sponsorPayFor(30, elo, t);
      assert.ok(pay >= 350, 'pay ' + pay + ' fell below the $350 floor at elo=' + elo + ' tier=' + t);
    }
  }
});

check('a generated sponsor offer\'s pay is FROZEN at generation and never drifts once held, even as ELO changes', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.dead = false;
  // V22 (owner item 5): the sponsor-offer track is gated on the SPONSORS APP
  // (d.sponsorsAppUnlocked — earned by signing a team), not on the old
  // d.phoneUnlocked handset latch, which now gates nothing. Setting the old
  // flag here left the track shut and no offer was ever generated.
  d.sponsorsAppUnlocked = true;
  d.socialAppUnlocked = true;
  d.followers = 200000; d.subscribers = 10000; d.elo = 5000; // qualify for everything
  var offer = null;
  for (var i = 0; i < 60 && !offer; i++) {
    d.energy = d.energyMax;
    State.endDay();
    var offers = State.sponsorOffers();
    if (offers.length) { offer = offers[0]; break; }
  }
  assert.ok(offer, 'expected at least one sponsor offer to be generated within 60 days');
  assert.ok(offer.pay >= 350, 'offer pay must respect the $350 floor');
  var acc = State.acceptSponsorOffer(offer.id);
  assert.strictEqual(acc.ok, true, JSON.stringify(acc));
  var frozenPay = acc.sponsor.pay;
  assert.strictEqual(frozenPay, offer.pay, 'accepted pay must equal the offer\'s frozen pay, not a re-roll');
  // Crash ELO to 0 -- a held sponsor's pay must NOT change.
  d.elo = 0;
  var status = State.sponsorsStatus();
  var held = status.held.filter(function (s) { return s.id === acc.sponsor.id; })[0];
  assert.ok(held, 'the accepted sponsor must still be held');
  assert.strictEqual(held.pay, frozenPay, 'held sponsor pay must never drift once frozen, regardless of live ELO');
});

/* ================================================================ 5 ==== */
/* §12/§1 contract extension bug: never pays less than current salary across
   a declining->rising trajectory swing; re-signs decay via reSignCount. */
check('extension NEVER pays less than current salary -- the exact declining->rising swing that caused the bug', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  State.scoutBoard({ limit: 200 }); // forces ensureTeams(d) to populate d.teams
  assert.ok(d.teams && d.teams.length, 'expected a populated team list');
  var teamEntry = d.teams[0];
  var teamId = teamEntry.id;

  // Sign at a `declining` trajectory (pays MORE per the ×1.35 multiplier).
  teamEntry.traj = 'declining';
  teamEntry.trajUntil = d.day + 9999; // pin so it can't re-roll mid-test
  teamEntry.trajCycleLen = 9999;
  var pubAtSign = State.teamById(teamId);
  d.dead = false;
  d.myTeamId = teamId;
  d.contract = pubAtSign.tier === 1 ? 't1' : (pubAtSign.tier === 2 ? 't2' : 't3');
  d.teamSalary = pubAtSign.salary; // the LOCKED salary the player actually holds
  d.contractSignedTierAtSign = pubAtSign.tier;
  d.lastKnownTeamTier = pubAtSign.tier;
  d.lastSigningBonus = pubAtSign.signingBonus;
  d.contractSleeps = 1;
  d.contractLength = 1;
  d.reSignCount = 0;
  var lockedSalary = d.teamSalary;
  assert.ok(lockedSalary > 0, 'sanity: locked salary must be positive');

  // Now force the SAME team to `rising` (pays LESS per the ×0.65 multiplier)
  // before the contract runs out -- the exact SPEC-V13 §7 scenario that
  // caused the bug (bump applied to the LIVE, now-lower, recomputed salary).
  teamEntry.traj = 'rising';
  teamEntry.trajUntil = d.day + 9999;
  teamEntry.trajCycleLen = 9999;
  var liveNow = State.teamById(teamId);
  assert.ok(liveNow.salary < lockedSalary, 'sanity: the live rising-trajectory salary must now be LOWER than the locked salary, or this test does not exercise the bug');

  d.energy = d.energyMax;
  State.endDay(); // contractSleeps hits 0 this wake -> extension offer generated
  var ext = d.contractExtensionOffer;
  assert.ok(ext, 'expected a contract extension offer to be generated on natural expiry');
  assert.strictEqual(ext.oldSalary, lockedSalary);
  assert.ok(ext.newSalary >= lockedSalary, 'newSalary (' + ext.newSalary + ') must NEVER be less than the locked salary (' + lockedSalary + ')');
  // bumpPct must reflect the REAL delta vs d.teamSalary, not the raw roll.
  var expectedBumpPct = Math.round((ext.newSalary / lockedSalary - 1) * 100);
  assert.strictEqual(ext.bumpPct, expectedBumpPct, 'bumpPct must be the real delta vs teamSalary');
});

check('repeated re-signs of the SAME team flatten the extension bump via reSignCount', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  State.scoutBoard({ limit: 200 });
  var teamEntry = d.teams[0];
  var teamId = teamEntry.id;
  teamEntry.traj = 'stable';
  teamEntry.trajUntil = d.day + 99999;
  teamEntry.trajCycleLen = 99999;

  d.dead = false;
  var bumpPcts = [];
  for (var round = 0; round < 5; round++) {
    var pub = State.teamById(teamId);
    d.myTeamId = teamId;
    d.contract = pub.tier === 1 ? 't1' : (pub.tier === 2 ? 't2' : 't3');
    d.teamSalary = round === 0 ? pub.salary : d.teamSalary; // first sign at live salary, later rounds keep whatever they were extended to
    d.contractSignedTierAtSign = pub.tier;
    d.lastKnownTeamTier = pub.tier;
    d.lastSigningBonus = pub.signingBonus;
    d.contractSleeps = 1;
    d.contractLength = 1;
    d.energy = d.energyMax;
    // Not under test here: acceptContractExtension() (unlike acceptOffer())
    // does not reset d.consecutiveScrimMisses, so an unrelated scrim-quota
    // kick could otherwise fire a few rounds in and mask the reSignCount
    // behaviour this check exists to prove. Neutralize it each round.
    d.consecutiveScrimMisses = 0;
    State.endDay();
    var ext = d.contractExtensionOffer;
    assert.ok(ext, 'expected an extension offer on round ' + round);
    bumpPcts.push(ext.bumpPct);
    var acceptRes = State.acceptContractExtension();
    assert.strictEqual(acceptRes.ok, true, JSON.stringify(acceptRes));
  }
  // reSignCount must have incremented every round (same team each time).
  assert.strictEqual(d.reSignCount, 5, 'reSignCount must increment on every same-team acceptContractExtension()');
  // The bump must trend DOWN (decay = max(0, 1 - 0.10*reSignCount)) --
  // not strictly monotonic every single round since it is still randomized
  // within a shrinking envelope, but the LAST round's max possible bump is
  // provably smaller than the FIRST round's max possible bump.
  assert.ok(bumpPcts[4] <= bumpPcts[0] + 1, 'bump on the 5th re-sign (' + bumpPcts[4] + '%) should not exceed the 1st (' + bumpPcts[0] + '%) by more than rounding noise, given decay');
});

check('reSignCount resets to 0 when the player signs a DIFFERENT team via the normal offers flow', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.reSignCount = 7;
  d.reSignTeamId = 'some-old-team';
  d.dead = false;
  d.contract = 'free';
  d.myTeamId = null;
  State.scoutBoard({ limit: 200 });
  var teamEntry = d.teams.filter(function (t) { return t.id !== 'some-old-team'; })[0];
  var pub = State.teamById(teamEntry.id);
  // Fabricate an open offer for this team directly (bypassing the random
  // trickle-in timing) and accept it via the real API.
  d.offers = [{
    id: 'test-offer-1', teamId: teamEntry.id, createdDay: d.day, expiresAtDay: d.day + 5,
    salary: pub.salary, signingBonus: pub.signingBonus, contractSleeps: 10,
    rank: pub.rank, tier: pub.tier, trajectory: pub.trajectory, trajectoryTag: pub.trajectoryTag
  }];
  var res = State.acceptOffer('test-offer-1');
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(d.reSignCount, 0, 'signing a different team must reset reSignCount to 0');
});

/* ================================================================ 6 ==== */
/* §20a / §2 Tier 1 tier gate: unreachable from a T3-only career; reachable
   after a completed T2 contract; scout board surfaces the requirement. */
check('a T3-only career (bestContractTier never set) NEVER receives a Tier 1 offer over 300 simulated days', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.dead = false;
  d.contract = 'free';
  d.myTeamId = null;
  d.bestContractTier = null; // never completed anything
  d.reputation = 0; // neutral -- does not itself block T1
  // Make the player trivially eligible on EVERY stat gate so the ONLY thing
  // that could still block a Tier 1 offer is the new hasEarnedTier1() gate.
  d.elo = 8000;
  d.hype = 100;
  d.chemistry = 100;
  d.followers = 500000;
  d.stats = d.stats || {};
  d.stats.matches = 100;
  d.stats.wins = 100;

  for (var i = 0; i < 300; i++) {
    d.energy = d.energyMax;
    State.endDay();
    var offers = State.offers();
    offers.forEach(function (o) {
      assert.notStrictEqual(o.tier, 1, 'a T3-only career must never receive a Tier 1 offer (day ' + d.day + ')');
    });
    d.offers = []; // keep retrying every eligible day instead of stalling once the inbox is full
  }
});

check('Tier 1 becomes reachable once d.bestContractTier is 2 or better (completed a Tier 2 contract)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.dead = false;
  d.contract = 'free';
  d.myTeamId = null;
  d.bestContractTier = 2; // simulates having COMPLETED a T2 contract
  d.reputation = 0;
  d.elo = 8000;
  d.hype = 100;
  d.chemistry = 100;
  d.followers = 500000;
  d.stats = d.stats || {};
  d.stats.matches = 100;
  d.stats.wins = 100;

  var sawTier1 = false;
  for (var i = 0; i < 300 && !sawTier1; i++) {
    d.energy = d.energyMax;
    State.endDay();
    var offers = State.offers();
    offers.forEach(function (o) { if (o.tier === 1) sawTier1 = true; });
    d.offers = [];
  }
  assert.ok(sawTier1, 'a Tier 1 offer must become reachable within 300 days once bestContractTier is 2');
});

check('bestContractTier is set on natural contract COMPLETION, never on leaveTeam() (walking out early must not count)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.dead = false;
  State.scoutBoard({ limit: 200 });
  var t2team = null;
  for (var i = 0; i < d.teams.length; i++) {
    var pub = State.teamById(d.teams[i].id);
    if (pub.tier === 2) { t2team = pub; break; }
  }
  assert.ok(t2team, 'expected at least one Tier 2 team in the catalog');
  d.myTeamId = t2team.id;
  d.contract = 't2';
  d.teamSalary = t2team.salary;
  d.contractSignedTierAtSign = 2;
  d.lastKnownTeamTier = 2;
  d.lastSigningBonus = t2team.signingBonus;
  d.contractSleeps = 5;
  d.contractLength = 5;
  d.bestContractTier = null;
  var leave = State.leaveTeam();
  assert.strictEqual(leave.ok, true, JSON.stringify(leave));
  assert.strictEqual(d.bestContractTier, null, 'leaving a team early must NEVER set/advance bestContractTier');
});

check('State.teamObjectives()/State.scoutBoard() surface "COMPLETE A TIER 2 CONTRACT" for an unearned Tier 1 team', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.bestContractTier = null;
  State.scoutBoard({ limit: 200 });
  var t1teamId = null;
  for (var i = 0; i < d.teams.length; i++) {
    var pub = State.teamById(d.teams[i].id);
    if (pub.tier === 1) { t1teamId = pub.id; break; }
  }
  assert.ok(t1teamId, 'expected at least one Tier 1 team in the catalog');
  var objectives = State.teamObjectives(t1teamId);
  var gate = objectives.filter(function (o) { return o.id === 'tier1Gate'; })[0];
  assert.ok(gate, 'expected a tier1Gate objective entry for a Tier 1 team');
  assert.strictEqual(gate.label, 'COMPLETE A TIER 2 CONTRACT');
  assert.strictEqual(gate.done, false);

  d.bestContractTier = 2;
  var objectives2 = State.teamObjectives(t1teamId);
  var gate2 = objectives2.filter(function (o) { return o.id === 'tier1Gate'; })[0];
  assert.strictEqual(gate2.done, true, 'the gate objective must read done once bestContractTier qualifies');
});

/* ================================================================ 7 ==== */
/* §18/§3 crypto pre-seed: fresh save has non-flat prices + populated
   history + resolved news, without accruing ticks while offline. */
check('a fresh save\'s crypto has non-flat prices and a populated history buffer (pre-seeded ~200 real ticks)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var c = State.data.crypto;
  assert.ok(c.tickCount >= 200, 'expected the pre-seed to have run at least 200 ticks, got ' + c.tickCount);
  var coins = win.Game.Data.cryptoCoins;
  coins.forEach(function (coin) {
    var hist = c.history[coin.id];
    assert.ok(hist.length > 1, coin.id + ' history must have more than the single starting point');
    var allFlat = hist.every(function (p) { return p === hist[0]; });
    assert.strictEqual(allFlat, false, coin.id + ' price history must not be perfectly flat on a fresh save');
  });
});

check('a fresh save\'s crypto TRACK RECORD (newsHistory) is populated, not empty', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var c = State.data.crypto;
  assert.ok(c.newsHistory.length >= 2, 'expected at least 2 already-resolved news entries, got ' + c.newsHistory.length);
});

check('crypto pre-seed survives a real save -> reload round trip', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  var beforePrices = JSON.parse(JSON.stringify(StateA.data.crypto.prices));
  var beforeNewsHistoryLen = StateA.data.crypto.newsHistory.length;
  StateA.save();

  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.deepStrictEqual(StateB.data.crypto.prices, beforePrices, 'pre-seeded prices must survive save/reload exactly');
  assert.strictEqual(StateB.data.crypto.newsHistory.length, beforeNewsHistoryLen, 'newsHistory must survive save/reload');
});

check('crypto ticks do NOT accrue while offline (deliberate V10 decision, unchanged)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var tickBefore = State.data.crypto.tickCount;
  // lastTickAt stays 0 (not-yet-anchored) straight out of defaultCrypto();
  // State.tickCrypto()'s first call must anchor to "now" and tick ZERO times,
  // never catch up on any elapsed wall-clock time.
  var res = State.tickCrypto();
  assert.strictEqual(res.ticked, 0, 'the very first tickCrypto() call must anchor, not catch up');
  assert.strictEqual(State.data.crypto.tickCount, tickBefore, 'tickCount must not advance from the anchor call itself');
});

/* ================================================================ 8 ==== */
/* §10/§7 case tiers: PRIME $50 / ELITE $200, same odds, hidden gold split,
   caseSelection API, EV measured over >=200k opens. */
check('Data.caseTiers: PRIME $50 and ELITE $200 exist alongside the unchanged $7 standard case', function () {
  var win = freshGame();
  var tiers = win.Game.Data.caseTiers;
  function t(id) { return tiers.filter(function (x) { return x.id === id; })[0]; }
  assert.ok(t('case_standard'));
  assert.strictEqual(t('case_standard').cost, 7.00);
  assert.ok(t('case_prime'));
  assert.strictEqual(t('case_prime').cost, 50.00);
  assert.ok(t('case_elite'));
  assert.strictEqual(t('case_elite').cost, 200.00);
});

check('every case tier keeps the SAME odds (65/25/6.5/2.5/1) and gold stays hidden ("?" -- never exposes the two-tier split)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var tiers = State.caseTiers();
  tiers.forEach(function (tier) {
    var chances = tier.odds.map(function (o) { return o.chance; });
    assert.deepStrictEqual(chances, [0.650, 0.250, 0.065, 0.025, 0.010], tier.id + ' odds must be unchanged');
    var gold = tier.odds.filter(function (o) { return o.id === 'rare'; })[0];
    assert.strictEqual(gold.hidden, true);
    assert.strictEqual(gold.min, null);
    assert.strictEqual(gold.max, null);
  });
});

check('d.caseSelection defaults both solo and stream to the $7 case, survives save->reload, and State.setCaseSelection() works', function () {
  var sharedStore = {};
  var winA = freshGame(sharedStore);
  var StateA = winA.Game.State;
  StateA.load();
  var sel = StateA.caseSelection();
  assert.deepStrictEqual(sel, { solo: 'case_standard', stream: 'case_standard' });

  var setRes = StateA.setCaseSelection('stream', 'case_elite');
  assert.strictEqual(setRes.ok, true, JSON.stringify(setRes));
  assert.strictEqual(StateA.data.caseSelection.stream, 'case_elite');
  assert.strictEqual(StateA.data.caseSelection.solo, 'case_standard', 'solo selection must be independent of stream');
  StateA.save();

  var winB = freshGame(sharedStore);
  var StateB = winB.Game.State;
  StateB.load();
  assert.deepStrictEqual(StateB.caseSelection(), { solo: 'case_standard', stream: 'case_elite' }, 'caseSelection must survive save/reload');

  var badRes = StateB.setCaseSelection('solo', 'not-a-real-case');
  assert.strictEqual(badRes.ok, false, 'an invalid case id must be rejected');
});

check('State.openCase() uses d.caseSelection per context (solo vs stream) and energy cost stays 1 off-stream / 0 on-stream at every tier', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var d = State.data;
  d.cash = 1000000;
  State.setCaseSelection('solo', 'case_elite');
  State.setCaseSelection('stream', 'case_prime');
  var energyBefore = d.energy;
  var soloRes = State.openCase({ onStream: false });
  assert.strictEqual(soloRes.ok, true, JSON.stringify(soloRes));
  assert.strictEqual(soloRes.caseId, 'case_elite');
  assert.strictEqual(soloRes.cost, 200.00);
  assert.strictEqual(energyBefore - d.energy, 1, 'off-stream case opening must cost exactly 1 energy regardless of tier');

  var energyBefore2 = d.energy;
  var streamRes = State.openCase({ onStream: true });
  assert.strictEqual(streamRes.ok, true, JSON.stringify(streamRes));
  assert.strictEqual(streamRes.caseId, 'case_prime');
  assert.strictEqual(streamRes.cost, 50.00);
  assert.strictEqual(d.energy, energyBefore2, 'on-stream case opening must cost 0 energy regardless of tier');
});

check('New case EVs measured over >=200,000 simulated opens land within +3%..+6% of cost (PRIME + ELITE)', function () {
  var win = freshGame();
  var State = win.Game.State;
  State.load();
  furnish(win);
  var Data = win.Game.Data;
  // SPEC-V15 §7 requires >=200,000 opens; the 1%-chance, high-variance gold
  // tier makes a bare 200k sample noisy enough to occasionally wander past
  // the 6% ceiling by chance alone even when the true underlying ratio is
  // ~4.4-4.8% (confirmed by repeated manual runs at 500k+). Sampling more
  // (well above the required floor, never below it) keeps this an accurate
  // regression check instead of a flaky one.
  var N = 1000000;
  var tierIds = ['case_prime', 'case_elite'];
  var report = {};
  tierIds.forEach(function (id) {
    var tier = Data.caseTiers.filter(function (t) { return t.id === id; })[0];
    var total = 0;
    State.data.cash = 1e12;
    for (var i = 0; i < N; i++) {
      var res = State.openCase({ onStream: true, caseId: id });
      assert.strictEqual(res.ok, true, JSON.stringify(res));
      total += res.value;
      State.creditCaseReveal(res.pendingId);
      if (State.data.cash < 1e7) State.data.cash = 1e12;
    }
    var ev = total / N;
    var pctOverCost = (ev / tier.cost - 1) * 100;
    report[id] = { cost: tier.cost, measuredEV: Math.round(ev * 100) / 100, pctOverCost: Math.round(pctOverCost * 100) / 100 };
    assert.ok(pctOverCost >= 3 && pctOverCost <= 6,
      id + ': measured EV $' + ev.toFixed(2) + ' on a $' + tier.cost + ' cost is ' + pctOverCost.toFixed(2) + '% over cost -- outside the required +3%..+6% band');
  });
  console.log('    measured case EVs: ' + JSON.stringify(report));
});

/* ---- report ---- */
var pass = results.filter(function (r) { return r.ok; }).length;
var fail = results.length - pass;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n       -- ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
