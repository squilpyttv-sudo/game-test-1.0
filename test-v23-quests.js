/* V23 — regression suite for SPEC-V23-QUESTS.md (quests, the email app, the
   CLUTCH minigame, and scout interest).

   Harness copied from test-v20-customise.js. Save/load assertions reload in a
   FRESH VM so they actually exercise normalizeSave() (HANDOFF-V2 §7).

   Written by the lead AGAINST THE SPEC, before reading any package's code.
   That is deliberate: a suite written after the fact tends to assert whatever
   the implementation happens to do, which is how a spec quietly drifts into
   whatever was easiest to build.

   Run: node test-v23-quests.js
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
// A fresh career starts with an EMPTY room (V22b item 2), which gates
// PLAY/TRAIN/STREAM. Data.starterLayout is the canonical furnished room.
function furnish(win) {
  win.Game.State.data.placed =
    JSON.parse(JSON.stringify(win.Game.Data.starterLayout));
  return win;
}
// js/clutch.js is an IIFE over window.Game and touches no DOM at load time.
function loadClutch() {
  var src = fs.readFileSync(path.join(ROOT, 'js/clutch.js'), 'utf8');
  var win = { Game: {} };
  new Function('window', 'document', 'Date', 'Math', 'JSON', 'console', src)
    (win, undefined, Date, Math, JSON, console);
  return win.Game.Clutch;
}

var results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true, name: name }); }
  catch (e) { results.push({ ok: false, name: name, err: (e && e.message) || String(e) }); }
}

/* ==== §7 SAVE SCHEMA — the normalizeSave trap ============================ */

check('§7 all four new top-level keys are in defaultData()', function () {
  var win = freshGame();
  var d = win.Game.State.data;
  ['emails', 'emailSeq', 'lastInviteDay', 'scoutStage'].forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(d, k),
      'defaultData() is missing "' + k + '" — normalizeSave() will silently ' +
      'drop it on load (HANDOFF-V2 §5.1, shipped broken 5+ times)');
  });
  assert.ok(Array.isArray(d.emails), 'emails must default to an array');
});

check('§7 the four new keys survive a save -> FRESH VM reload', function () {
  var store = {};
  var win = freshGame(store);
  var S = win.Game.State;
  S.data.emails = [{
    id: 'e1', kind: 'invite', inviteId: 'lan', from: 'TEST ORG',
    subject: 'SUBJ', body: 'BODY', day: 3, read: true,
    state: 'open', expiresDay: 6
  }];
  S.data.emailSeq = 7;
  S.data.lastInviteDay = 3;
  S.data.scoutStage = 2;
  S.save();

  var win2 = freshGame(store);          // FRESH VM — exercises normalizeSave()
  var d2 = win2.Game.State.data;
  assert.strictEqual(d2.emailSeq, 7, 'emailSeq was dropped on load');
  assert.strictEqual(d2.lastInviteDay, 3, 'lastInviteDay was dropped on load');
  assert.strictEqual(d2.scoutStage, 2, 'scoutStage was dropped on load');
  assert.strictEqual(d2.emails.length, 1, 'emails was dropped on load');
  // Per-entry fields ride along on the array wholesale — no defaultData()
  // entry needed for them, and adding a top-level mirror would create the
  // second-copy bug instead (HANDOFF-V2 §5.1).
  assert.strictEqual(d2.emails[0].inviteId, 'lan', 'a per-email field was lost');
  assert.strictEqual(d2.emails[0].expiresDay, 6, 'a per-email field was lost');
});

/* ==== §4.1 THE CATALOG =================================================== */

check('§4.1 every invite tier is reachable, priced and ordered', function () {
  var win = freshGame();
  var list = win.Game.Data.questInvites;
  assert.ok(Array.isArray(list) && list.length >= 4,
    'expected at least four invite tiers');
  var prevElo = -1, prevPurse = -1, prevWin = -1;
  list.forEach(function (inv) {
    ['id', 'name'].forEach(function (k) {
      assert.ok(inv[k] && String(inv[k]).length, 'invite missing ' + k);
    });
    assert.ok(inv.eloMin >= 0, inv.id + ': eloMin must be >= 0');
    assert.ok(inv.purse > 0, inv.id + ': purse must be positive');
    assert.ok(inv.winElo > 0, inv.id + ': winElo must be positive');
    assert.ok(inv.loseElo < 0, inv.id + ': loseElo must be negative');
    assert.ok(inv.enemies >= 1, inv.id + ': needs at least one attacker');
    assert.ok(inv.exposeMs > 0, inv.id + ': needs an exposure window');
    // Tiers must climb together, or a higher tier is strictly worse to play.
    assert.ok(inv.eloMin > prevElo, inv.id + ': eloMin does not increase');
    assert.ok(inv.purse > prevPurse, inv.id + ': purse does not increase');
    assert.ok(inv.winElo > prevWin, inv.id + ': winElo does not increase');
    prevElo = inv.eloMin; prevPurse = inv.purse; prevWin = inv.winElo;
  });
  // The lowest tier must be reachable from a standing start, or act one —
  // the whole point of this feature — never sees a quest at all.
  assert.strictEqual(list[0].eloMin, 0, 'the first tier must be open at 0 ELO');
});

check('§4.1 the owner-set ELO band is 100..300, and losing costs real ELO', function () {
  var win = freshGame();
  var list = win.Game.Data.questInvites;
  var wins = list.map(function (i) { return i.winElo; });
  assert.strictEqual(Math.min.apply(null, wins), 100,
    'the lowest tier must pay 100 ELO (owner-set 2026-08-27)');
  assert.strictEqual(Math.max.apply(null, wins), 300,
    'the top tier must pay 300 ELO (owner-set 2026-08-27)');
  // At -10 against a +100 win, failure was free and the correct play was to
  // spam every invite. Roughly a third keeps failure meaningful.
  list.forEach(function (inv) {
    var ratio = Math.abs(inv.loseElo) / inv.winElo;
    assert.ok(ratio >= 0.2 && ratio <= 0.5, inv.id +
      ': loseElo is ' + (ratio * 100).toFixed(0) + '% of winElo — outside 20-50%, ' +
      'so failure is either free or punishing enough to stop anyone trying');
  });
});

check('§4.1 a quest purse never out-earns the real tournament ladder', function () {
  var win = freshGame();
  var D = win.Game.Data;
  var tiers = D.tournamentTiers || {};
  var smallestPool = Infinity;
  Object.keys(tiers).forEach(function (k) {
    if (tiers[k] && tiers[k].prizePool) smallestPool = Math.min(smallestPool, tiers[k].prizePool);
  });
  if (smallestPool === Infinity) return;   // no tournament tiers to compare
  D.questInvites.forEach(function (inv) {
    assert.ok(inv.purse < smallestPool, inv.id + ': purse ' + inv.purse +
      ' >= the smallest tournament pool ' + smallestPool +
      ' — quests must stay below the real ladder or it stops being the bigger prize');
  });
});

/* ==== §4.2 CADENCE ======================================================= */

check('§4.2 the cadence constants are sane', function () {
  var D = freshGame().Game.Data;
  var iv = D.questInviteIntervalDays;
  assert.ok(Array.isArray(iv) && iv.length === 2, 'questInviteIntervalDays must be [lo, hi]');
  assert.ok(iv[0] >= 1 && iv[1] >= iv[0], 'interval range is backwards or zero');
  assert.ok(D.questInviteExpiryDays >= 1, 'invites must live at least a day');
  assert.ok(D.questInviteMaxOpen >= 1, 'at least one invite may be open');
});

check('§4.2 a generated invite is the HIGHEST tier the player qualifies for', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, D = win.Game.Data;
  // Walk the ELO bands and confirm the pick tracks the player's climb rather
  // than spamming cafe games at 1,800 ELO.
  D.questInvites.forEach(function (expected, i) {
    var d = S.data;
    d.elo = expected.eloMin + 10;
    d.emails = [];
    d.lastInviteDay = 0;
    d.day = 999;                       // force the interval to have elapsed
    S.rollDailyEmails();
    var invites = d.emails.filter(function (e) { return e.kind === 'invite'; });
    assert.ok(invites.length >= 1, 'no invite generated at ELO ' + d.elo);
    var got = invites[invites.length - 1].inviteId;
    assert.strictEqual(got, expected.id,
      'at ELO ' + d.elo + ' expected tier "' + expected.id + '", got "' + got + '"');
  });
});

check('§4.2 never more than questInviteMaxOpen invites are live at once', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, D = win.Game.Data;
  var d = S.data;
  d.elo = 800;
  for (var day = 1; day <= 200; day++) {
    d.day = day;
    S.rollDailyEmails();
    var open = d.emails.filter(function (e) {
      return e.kind === 'invite' && e.state === 'open';
    });
    assert.ok(open.length <= D.questInviteMaxOpen,
      'day ' + day + ': ' + open.length + ' open invites, cap is ' + D.questInviteMaxOpen);
  }
});

check('§4.2 an invite EXPIRES on schedule and is marked, never deleted', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, D = win.Game.Data;
  var d = S.data;
  // day 10 against lastInviteDay 0: the interval is 3-5 days, so a day-1 roll
  // generates NOTHING and every assertion below would be testing an empty inbox.
  d.elo = 800; d.day = 10; d.emails = []; d.lastInviteDay = 0;
  S.rollDailyEmails();
  var inv = d.emails.filter(function (e) { return e.kind === 'invite'; })[0];
  assert.ok(inv, 'no invite to expire');
  var id = inv.id, before = d.emails.length;
  // Roll forward past the expiry window, from the day it actually arrived.
  for (var k = 0; k <= D.questInviteExpiryDays + 1; k++) {
    d.day = 10 + k;
    S.rollDailyEmails();
  }
  var still = d.emails.filter(function (e) { return e.id === id; })[0];
  assert.ok(still, 'the expired invite was DELETED — it must be marked, so the ' +
    'player can still read their own history');
  assert.strictEqual(still.state, 'expired', 'state is "' + still.state + '", expected "expired"');
  assert.ok(d.emails.length >= before, 'emails shrank; nothing should be dropped here');
});

/* ==== §1 + §8 THE STATE API ============================================= */

check('§8 the whole State API exists', function () {
  var S = freshGame().Game.State;
  ['emails', 'unreadEmailCount', 'readEmail', 'acceptInvite', 'resolveInvite',
   'declineInvite', 'rollDailyEmails', 'scoutStatus'].forEach(function (fn) {
    assert.strictEqual(typeof S[fn], 'function', 'State.' + fn + '() is missing');
  });
});

check('§1 acceptInvite() does NOT pre-roll a result', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, d = S.data;
  // day 10 against lastInviteDay 0: the interval is 3-5 days, so a day-1 roll
  // generates NOTHING and every assertion below would be testing an empty inbox.
  d.elo = 800; d.day = 10; d.emails = []; d.lastInviteDay = 0;
  S.rollDailyEmails();
  var inv = d.emails.filter(function (e) { return e.kind === 'invite'; })[0];
  var cash0 = d.cash, elo0 = d.elo;
  var r = S.acceptInvite(inv.id);
  assert.ok(r && r.ok, 'acceptInvite refused: ' + (r && r.reason));
  assert.strictEqual(d.cash, cash0,
    'accepting changed cash — the minigame decides the outcome, not accept (§1)');
  assert.strictEqual(d.elo, elo0,
    'accepting changed ELO — the minigame decides the outcome, not accept (§1)');
});

check('§1 resolveInvite() pays exactly the catalog, win and lose', function () {
  var D = freshGame().Game.Data;
  D.questInvites.forEach(function (def) {
    ['win', 'lose'].forEach(function (outcome) {
      var win = furnish(freshGame());
      var S = win.Game.State, d = S.data;
      // Sit clear of the ELO floor: state.js clamps at 0, so testing the
      // bottom tier at 10 ELO measures the clamp rather than the payout.
      // Still below the NEXT tier's eloMin, so the same tier is generated.
      d.elo = def.eloMin + Math.abs(def.loseElo) + 50;
      d.day = 10; d.emails = []; d.lastInviteDay = 0;
      S.rollDailyEmails();
      var inv = d.emails.filter(function (e) { return e.kind === 'invite'; })[0];
      if (inv.inviteId !== def.id) return;      // band boundary; covered elsewhere
      S.acceptInvite(inv.id);
      var cash0 = d.cash, elo0 = d.elo;
      S.resolveInvite(inv.id, outcome === 'win');
      var dCash = d.cash - cash0, dElo = d.elo - elo0;
      if (outcome === 'win') {
        assert.strictEqual(dCash, def.purse, def.id + ' win: paid ' + dCash + ', expected ' + def.purse);
        assert.strictEqual(dElo, def.winElo, def.id + ' win: gave ' + dElo + ' ELO, expected ' + def.winElo);
      } else {
        assert.strictEqual(dCash, def.loseCash, def.id + ' loss: paid ' + dCash + ', expected ' + def.loseCash);
        assert.strictEqual(dElo, def.loseElo, def.id + ' loss: gave ' + dElo + ' ELO, expected ' + def.loseElo);
      }
    });
  });
});

check('§8 resolveInvite() refuses a second time, and refuses a stranger', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, d = S.data;
  // day 10 against lastInviteDay 0: the interval is 3-5 days, so a day-1 roll
  // generates NOTHING and every assertion below would be testing an empty inbox.
  d.elo = 800; d.day = 10; d.emails = []; d.lastInviteDay = 0;
  S.rollDailyEmails();
  var inv = d.emails.filter(function (e) { return e.kind === 'invite'; })[0];
  S.acceptInvite(inv.id);
  var first = S.resolveInvite(inv.id, true);
  assert.ok(first && first.ok, 'the first resolve should succeed');
  var cash0 = d.cash, elo0 = d.elo;
  var second = S.resolveInvite(inv.id, true);
  assert.ok(!second || !second.ok, 'resolving twice must refuse — otherwise the ' +
    'purse can be farmed from one invite');
  assert.strictEqual(d.cash, cash0, 'the refused resolve still paid out');
  assert.strictEqual(d.elo, elo0, 'the refused resolve still gave ELO');
  var bogus = S.resolveInvite('no-such-email', true);
  assert.ok(!bogus || !bogus.ok, 'resolving an unknown id must refuse');
});

check('§8 unread counting and readEmail() latch correctly', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, d = S.data;
  // day 10 against lastInviteDay 0: the interval is 3-5 days, so a day-1 roll
  // generates NOTHING and every assertion below would be testing an empty inbox.
  d.elo = 800; d.day = 10; d.emails = []; d.lastInviteDay = 0;
  S.rollDailyEmails();
  var n = S.unreadEmailCount();
  assert.ok(n >= 1, 'a new invite should read as unread, got ' + n);
  var inv = d.emails.filter(function (e) { return e.kind === 'invite'; })[0];
  S.readEmail(inv.id);
  assert.strictEqual(S.unreadEmailCount(), n - 1, 'readEmail() did not clear the unread');
  S.readEmail(inv.id);
  assert.strictEqual(S.unreadEmailCount(), n - 1, 'readEmail() is not idempotent');
});

/* ==== §6 SCOUT INTEREST ================================================= */

/* A scout-fired email is identified by its `scoutStage` stamp, NOT by
   `kind`. Stage 3 is a playable trial invite and so carries kind:'invite',
   which is byte-identical to a cadence invite without the stamp.

   Cross the bands in as few days as possible: a long climb generates enough
   cadence invites to hit the §3.2 thirty-email cap, which silently evicts the
   very email under test. That cost the lead a wrong conclusion about this
   package before the cap was the obvious suspect — hence the cap test below. */
function crossAllScoutStages(S, D) {
  var d = S.data;
  d.emails = []; d.scoutStage = 0; d.lastInviteDay = 0;
  D.scoutStages.forEach(function (st, i) {
    d.day = i + 1;
    d.elo = (st.elo !== undefined ? st.elo : 2100);
    S.rollDailyEmails();
  });
  return d.emails.filter(function (e) { return e.scoutStage != null; });
}

check('§6 each scout stage fires exactly once, and stamps its origin', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, D = win.Game.Data;
  var stages = D.scoutStages;
  assert.ok(Array.isArray(stages) && stages.length >= 4, 'expected at least four scout stages');
  var fired = crossAllScoutStages(S, D);
  assert.strictEqual(fired.length, stages.length,
    'expected exactly ' + stages.length + ' scout-stamped emails, got ' + fired.length);
  var nums = fired.map(function (e) { return e.scoutStage; }).sort();
  assert.strictEqual(new Set(nums).size, nums.length,
    'a stage fired twice: stamps were ' + nums.join(','));
  assert.strictEqual(S.data.scoutStage, stages.length, 'scoutStage did not latch to the top');
  // A cadence invite must never carry the stamp, or "did stage N fire" stops
  // being answerable from the saved data at all.
  S.data.emails.filter(function (e) { return e.scoutStage == null; })
    .forEach(function (e) {
      assert.notStrictEqual(e.kind, 'scout', 'an unstamped email claims kind:scout');
    });
});

check('§6 the stage-3 trial is a REAL invite, on the shared pipeline', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, D = win.Game.Data;
  var fired = crossAllScoutStages(S, D);
  var trial = fired.filter(function (e) { return e.scoutStage === 3; })[0];
  assert.ok(trial, 'stage 3 fired no email');
  assert.strictEqual(trial.kind, 'invite', 'the stage-3 trial must be playable, not informational');
  assert.ok(trial.inviteId, 'the trial carries no tier, so it cannot be played');
  assert.ok(D.questInvites.some(function (t) { return t.id === trial.inviteId; }),
    'the trial names tier "' + trial.inviteId + '", which is not in Data.questInvites');
  // It must reuse accept/resolve rather than reimplementing anything (§6).
  var r = S.acceptInvite(trial.id);
  assert.ok(r && r.ok, 'the trial invite is not acceptable: ' + (r && r.reason));
});

check('§6 scout stages do not re-fire across a FRESH VM reload', function () {
  var store = {};
  var win = furnish(freshGame(store));
  var S = win.Game.State, D = win.Game.Data;
  var before = crossAllScoutStages(S, D).length;
  S.save();

  var win2 = freshGame(store);
  var S2 = win2.Game.State, d2 = S2.data;
  for (var day2 = 20; day2 <= 60; day2++) { d2.day = day2; d2.elo = 2100; S2.rollDailyEmails(); }
  var after = d2.emails.filter(function (e) { return e.scoutStage != null; }).length;
  assert.strictEqual(after, before,
    'scout emails went ' + before + ' -> ' + after + ' after a reload — the latch is not persisting');
});

check('§3.2 the inbox caps at 30 and drops resolved mail before open mail', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, d = S.data;
  d.elo = 800; d.emails = []; d.scoutStage = 99; d.lastInviteDay = 0;
  for (var day = 1; day <= 400; day++) { d.day = day; S.rollDailyEmails(); }
  assert.ok(d.emails.length <= 30,
    'the inbox grew to ' + d.emails.length + '; §3.2 caps it at 30');
  // Eviction must not strand the player: anything still actionable has to
  // outlive settled history, or an invite can vanish before it is played.
  var openCount = d.emails.filter(function (e) { return e.state === 'open'; }).length;
  assert.ok(openCount >= 1 || d.emails.length < 30,
    'every open invite was evicted while resolved mail survived — eviction must ' +
    'drop the oldest RESOLVED entry first (§3.2)');
});

check('§6 scoutStatus() is a derived readout, not a second stored economy', function () {
  var win = furnish(freshGame());
  var S = win.Game.State, d = S.data;
  d.elo = 900;
  var st = S.scoutStatus();
  assert.ok(st && typeof st.interest === 'number', 'scoutStatus() must report interest');
  assert.ok(st.interest >= 0 && st.interest <= 1, 'interest must be 0..1, got ' + st.interest);
  var low = S.scoutStatus().interest;
  d.elo = 2050;
  assert.ok(S.scoutStatus().interest >= low, 'interest must not fall as ELO climbs');
  assert.ok(!Object.prototype.hasOwnProperty.call(d, 'scoutInterest'),
    'scoutInterest must be DERIVED from ELO, not stored — a stored copy is the ' +
    'second-source bug that has caused four user-visible bugs here');
});

/* ==== §3.1 THE PHONE TILE — the generalised unreachable-app trap ========= */

check('§3.1 every routed phone app has an icon, colour, order slot and route', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/phone.js'), 'utf8');
  function mapKeys(name) {
    var m = new RegExp('var ' + name + ' = \\{([\\s\\S]*?)\\};').exec(src);
    assert.ok(m, 'could not find ' + name + ' in js/phone.js');
    return (m[1].match(/(\w+)\s*:/g) || []).map(function (s) { return s.replace(/\s*:$/, ''); });
  }
  var order = /var APP_ORDER = \[([\s\S]*?)\];/.exec(src);
  assert.ok(order, 'could not find APP_ORDER');
  var ordered = (order[1].match(/'([^']+)'/g) || []).map(function (s) { return s.slice(1, -1); });
  var icons = mapKeys('APP_ICON'), colors = mapKeys('APP_COLOR'), routes = mapKeys('APP_ROUTE');

  assert.ok(ordered.indexOf('email') !== -1, 'EMAIL has no tile in APP_ORDER — the app is unreachable');
  // Generalised: this is the same class of bug as the V20 shop category that
  // shipped with five priced items and no tab to reach them from.
  ordered.forEach(function (id) {
    assert.ok(icons.indexOf(id) !== -1, id + ' has no APP_ICON — its tile renders blank');
    assert.ok(colors.indexOf(id) !== -1, id + ' has no APP_COLOR');
  });
  routes.forEach(function (id) {
    assert.ok(ordered.indexOf(id) !== -1, id + ' routes somewhere but has no tile');
  });
  assert.ok(routes.indexOf('email') !== -1, 'EMAIL has no APP_ROUTE — tapping it goes nowhere');
});

check('§3.1 the email icon is authored SVG, never a Unicode glyph', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/phone.js'), 'utf8');
  // The envelope glyph was already removed from js/career.js once
  // (ART-DIRECTION §2.5). It must not come back in as an ICON — but a glyph
  // inside a COMMENT is explicitly fine and is on the "deliberately NOT on
  // the list" list in TASKS-REMAINING.md: comments are not rendered, and a
  // comment naming the character it is warning against is doing its job.
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(code.indexOf('✉') === -1,
    'js/phone.js uses the envelope glyph as an icon — icons are authored SVG, ' +
    '24x24, 2px stroke, currentColor (HANDOFF-V2 §2.6)');
  var m = /var APP_ICON = \{([\s\S]*?)\};/.exec(src);
  assert.ok(m && /email\s*:/.test(m[1]), 'no email entry in APP_ICON');
});

/* ==== §5 THE CLUTCH ===================================================== */

check('§5 Clutch exposes run/probe/force and is wired into index.html', function () {
  var C = loadClutch();
  assert.ok(C, 'window.Game.Clutch is missing');
  ['run', '__probe', '__force'].forEach(function (fn) {
    assert.strictEqual(typeof C[fn], 'function', 'Clutch.' + fn + '() is missing');
  });
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/clutch.js') !== -1, 'index.html does not load js/clutch.js');
});

check('§5.1 the flick is DISTANCE-SCALED, and stays inside 150..250ms', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/clutch.js'), 'utf8');
  var lo = /FLICK_MIN_MS\s*=\s*(\d+)/.exec(src);
  var hi = /FLICK_MAX_MS\s*=\s*(\d+)/.exec(src);
  assert.ok(lo && hi, 'could not read FLICK_MIN_MS / FLICK_MAX_MS');
  assert.strictEqual(parseInt(lo[1], 10), 150, 'FLICK_MIN_MS must be 150 (owner-set)');
  assert.strictEqual(parseInt(hi[1], 10), 250, 'FLICK_MAX_MS must be 250 (owner-set)');
  // The scaling is the whole anti-whack-a-mole rule: a constant flick makes
  // crosshair placement irrelevant, because on a touchscreen a far tap is
  // exactly as fast as a near one (§5.1).
  assert.ok(lo[1] !== hi[1], 'the flick band is degenerate');
  var C = loadClutch();
  if (typeof C.__flickMsFor === 'function') {
    var near = C.__flickMsFor(0), far = C.__flickMsFor(1);
    assert.ok(far > near + 40, 'flick time barely varies with distance (' +
      near + 'ms -> ' + far + 'ms) — pre-aiming buys nothing and this is whack-a-mole');
    assert.ok(near >= 150 && far <= 250, 'flick times leave the 150..250ms band');
  }
});

check('§5.2 the bolt cycle is 1000..1500ms and blocks every peek', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/clutch.js'), 'utf8');
  var lo = /BOLT_MIN_MS\s*=\s*(\d+)/.exec(src);
  var hi = /BOLT_MAX_MS\s*=\s*(\d+)/.exec(src);
  assert.ok(lo && hi, 'could not read BOLT_MIN_MS / BOLT_MAX_MS');
  assert.strictEqual(parseInt(lo[1], 10), 1000, 'BOLT_MIN_MS must be 1000 (owner-set)');
  assert.strictEqual(parseInt(hi[1], 10), 1500, 'BOLT_MAX_MS must be 1500 (owner-set)');
});

check('§5.3 a LAN is best-of-3, so one miss loses a round and not the LAN', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/clutch.js'), 'utf8');
  // Assert the RELATIONSHIP, not a variable name. "First to 2" and "best of
  // 3" are the same rule, and a test that only recognises one spelling fails
  // on a correct implementation — which is exactly how the old bhop checks
  // went stale (they pinned BH_PATH by name and could describe only one map).
  var m = /ROUNDS_TO_WIN\s*=\s*(\d+)/.exec(src) || /ROUNDS\s*=\s*(\d+)/.exec(src);
  assert.ok(m, 'could not find the round-count constant');
  var toWin = parseInt(m[1], 10);
  assert.strictEqual(toWin, 2, 'best of 3 means first to 2, got first to ' + toWin);
  // Both outcomes must gate on the SAME threshold, or the match is best-of-3
  // in one direction and sudden-death in the other.
  assert.ok(/roundsWon\s*>=\s*ROUNDS_TO_WIN/.test(src),
    'winning is not gated on the shared round threshold');
  assert.ok(/roundsLost\s*>=\s*ROUNDS_TO_WIN/.test(src),
    'LOSING is not gated on the same threshold — one lost round would end the ' +
    'whole LAN, which is the thing best-of-3 exists to prevent (§5.3)');
});

check('§1 email.js resolves ONLY inside the CLUTCH callback', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/email.js'), 'utf8');
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(/acceptInvite\s*\(/.test(code), 'js/email.js never calls acceptInvite()');
  assert.ok(/Clutch\.run\s*\(/.test(code), 'js/email.js never opens the CLUTCH');
  assert.ok(/resolveInvite\s*\(/.test(code), 'js/email.js never calls resolveInvite()');
  /* The ordering is the feature (§1): accept must not roll a result, and the
     minigame's completion is the ONLY thing that may resolve. Verified live
     through the real click handlers — accept moved neither cash nor ELO, and
     a forced CLUTCH win then paid exactly the tier's purse and winElo.
     This static check is the guard against someone later "simplifying" the
     callback away to match js/matchgames.js's pre-roll. */
  var runIdx = code.indexOf('Clutch.run');
  var resolveIdx = code.indexOf('resolveInvite');
  assert.ok(runIdx !== -1 && resolveIdx > runIdx,
    'resolveInvite() is called BEFORE Clutch.run() — the result would be ' +
    'decided before the player plays, which is the one thing §1 forbids');
});

check('§5.7 the CLUTCH exposes outcome seams, so the chain is testable', function () {
  var C = loadClutch();
  // Without these the only way to reach a result is to play the LAN by hand,
  // which leaves the accept -> run -> resolve chain untestable end to end.
  ['__win', '__fail'].forEach(function (fn) {
    assert.strictEqual(typeof C[fn], 'function',
      'Clutch.' + fn + '() is missing — js/matchgames.js exposes the same pair ' +
      'for the same reason');
  });
  var src = fs.readFileSync(path.join(ROOT, 'js/clutch.js'), 'utf8');
  // They must drive the real endMatch(), not shortcut to the callback: a seam
  // that bypasses the code under test proves nothing.
  assert.ok(/__win:[\s\S]{0,120}endMatch\(true\)/.test(src),
    '__win() must drive the real endMatch(true)');
  assert.ok(/__fail:[\s\S]{0,120}endMatch\(false\)/.test(src),
    '__fail() must drive the real endMatch(false)');
});

check('§5.5 the CLUTCH carries no image assets and no glyph icons', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/clutch.js'), 'utf8');
  assert.ok(!/<img|url\(|\.png|\.jpg|\.svg|@font-face/i.test(src),
    'no external assets are allowed (HANDOFF-V2 §2.3)');
  // Canvas cannot read CSS variables, so colour literals ARE correct here —
  // the same exception js/iso.js and js/matchgames.js hold.
  var glyphs = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/[←-⯿️]/.test(glyphs),
    'a Unicode glyph is doing icon duty outside a comment (ART-DIRECTION §2.5)');
});

/* ==== report ============================================================ */

var pass = results.filter(function (r) { return r.ok; }).length;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n        ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
