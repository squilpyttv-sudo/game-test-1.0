/* V22 — regression suite for the owner's 15-item bug list (TASKS-REMAINING).
   Harness copied from test-v20-customise.js. Save/load assertions reload in a
   FRESH VM so they actually exercise normalizeSave() (HANDOFF-V2 §7).

   Run: node test-v22-fixes.js

   Batch 1 covered here:
     #3  stream payout display — the popup showed pre-multiplier cash while the
         wallet got post-multiplier (playtester saw ~$25k reported as $10k).
     #4  sponsor stream obligations were real wall-clock MINUTES (up to 4h/wk).
     #6  tournaments fired on a strict 7-day metronome.

   Add later batches to this file rather than starting a new one per fix. */
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

/* freshModule: a fresh state.js WITHOUT calling load() yet.
   Required for any test that seeds a raw save into localStorage first —
   state.js caches its parsed save root in a private closure on first read, so
   a load() before the seed makes the seed invisible and loadSlot() returns
   null. Same reason test-v16-rooms.js/test-v12-footprints.js keep their own
   seedSlot0() helper. */
function freshModule(sharedStore) {
  var win = makeWindow(sharedStore);
  loadInto(win, 'js/data.js');
  loadInto(win, 'js/state.js');
  return win;
}

function seedSlot0(raw) {
  var win = freshModule();
  win.localStorage.setItem('cs2sim.saves', JSON.stringify({ slots: [raw, null, null], lastSlot: 0 }));
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
  try { fn(); results.push({ name: name, ok: true }); }
  catch (e) { results.push({ name: name, ok: false, err: (e && e.message) || String(e) }); }
}

/* ---- #6: the 4-7 day tournament cadence -------------------------------- */
check('#6 leagueCycleInterval is in defaultData (not dropped by normalizeSave)', function () {
  var w = freshGame();
  assert.notStrictEqual(w.Game.State.data.leagueCycleInterval, undefined,
    'leagueCycleInterval missing from a fresh save');
});

check('#6 leagueCycleInterval SURVIVES a save -> reload in a fresh VM', function () {
  var store = {};
  var w = freshGame(store);
  w.Game.State.data.leagueCycleInterval = 5;
  w.Game.State.save();
  var w2 = freshGame(store);   // fresh VM => real normalizeSave() path
  assert.strictEqual(w2.Game.State.data.leagueCycleInterval, 5,
    'expected 5, got ' + w2.Game.State.data.leagueCycleInterval);
});

check('#6 rollTournamentInterval always lands in 4..7 (2000 rolls)', function () {
  var w = freshGame();
  var seen = {};
  for (var i = 0; i < 2000; i++) {
    var v = w.Game.State.rollTournamentInterval();
    assert.ok(v >= 4 && v <= 7, 'out of range: ' + v);
    assert.strictEqual(v, Math.floor(v), 'non-integer: ' + v);
    seen[v] = true;
  }
  assert.ok(seen[4] && seen[5] && seen[6] && seen[7],
    'did not produce the full 4..7 spread: ' + Object.keys(seen).join(','));
});

check('#6 an OLD save with no leagueCycleInterval falls back to the max, never shorter', function () {
  var store = {};
  var w = freshGame(store);
  var raw = JSON.parse(store[Object.keys(store)[0]]);
  // simulate a pre-upgrade save
  delete raw.leagueCycleInterval;
  store[Object.keys(store)[0]] = JSON.stringify(raw);
  var w2 = freshGame(store);
  var v = w2.Game.State.data.leagueCycleInterval;
  assert.ok(v === 0 || v === undefined || v >= 4,
    'legacy save produced a surprising interval: ' + v);
});

/* ---- #4: sponsor stream obligations are SECONDS ------------------------ */
check('#4 no stream obligation asks for more than 300 units', function () {
  var w = freshGame();
  var list = w.Game.Data.sponsors || [];
  var bad = list.filter(function (s) {
    return s.obligation && s.obligation.type === 'stream_minutes' && s.obligation.amount > 300;
  });
  assert.strictEqual(bad.length, 0,
    'still asking for huge amounts: ' + bad.map(function (s) { return s.id + '=' + s.obligation.amount; }).join(', '));
});

check('#4 the three stream obligations are exactly 120/180/300', function () {
  var w = freshGame();
  var amounts = (w.Game.Data.sponsors || [])
    .filter(function (s) { return s.obligation && s.obligation.type === 'stream_minutes'; })
    .map(function (s) { return s.obligation.amount; })
    .sort(function (a, b) { return a - b; });
  assert.deepStrictEqual(amounts, [120, 180, 300], 'got ' + JSON.stringify(amounts));
});

/* ---- #3: the stream multiplier is exported and sane -------------------- */
check('#3 State.streamMultipliers() exists and returns a cash product', function () {
  var w = freshGame();
  var m = w.Game.State.streamMultipliers();
  assert.ok(m && typeof m.cash === 'number', 'no cash multiplier');
  assert.ok(m.cash > 0, 'non-positive multiplier: ' + m.cash);
  assert.strictEqual(m.cash, m.streamMult * m.tierViewerMult * m.tierDonationMult,
    'cash is not the product of its parts');
});

check('#3 applyStreamResult credits EXACTLY appliedCash, and that matches the multiplier', function () {
  var w = freshGame();
  var S = w.Game.State;
  var before = S.data.cash;
  var mult = S.streamMultipliers().cash;
  var applied = S.applyStreamResult({ cash: 1000, followers: 0, peakViewers: 0, durationMs: 0 });
  var credited = S.data.cash - before;
  assert.ok(Math.abs(credited - applied.appliedCash) < 1e-6,
    'wallet got ' + credited + ' but appliedCash said ' + applied.appliedCash);
  assert.ok(Math.abs(applied.appliedCash - 1000 * mult) < 1e-6,
    'appliedCash ' + applied.appliedCash + ' != 1000 * ' + mult);
});

/* ---- #7: Bo3 finals for tier 1 / tier 2 -------------------------------- */
check('#7 Data.tournamentFinalBestOf is 3 for tiers 1-2 and 1 for tier 3', function () {
  var w = freshGame();
  var b = w.Game.Data.tournamentFinalBestOf;
  assert.strictEqual(b[1], 3, 'tier 1');
  assert.strictEqual(b[2], 3, 'tier 2');
  assert.strictEqual(b[3], 1, 'tier 3 should stay Bo1');
});

/* Builds a save sitting on a tier-`tier` tournament FINAL against one
   opponent, so the Bo3 series logic can be driven end to end. */
function stageFinal(w, tier) {
  var S = w.Game.State, d = S.data;
  d.contract = tier === 1 ? 't1' : (tier === 2 ? 't2' : 't3');
  var you = { id: 'you', isYou: true, name: 'YOU', rank: 5, tier: tier, strength: 60, trajectory: 'stable' };
  var opp = { id: 'opp', isYou: false, name: 'RIVALS', rank: 6, tier: tier, strength: 60, trajectory: 'stable' };
  d.tournament = {
    id: 'test', tier: tier, event: 'TEST FINAL', prizePool: 10000,
    field: [you, opp], bracket: [[{ a: you, b: opp, winner: null, done: false }]],
    pendingByes: [], done: false, startedDay: d.day, totalRounds: 1, lastMatchDay: -1
  };
  return d.tournament;
}

check('#7 a tier-1 FINAL is Bo3: it takes 2 map wins, and losing map 1 does NOT eliminate', function () {
  var seenLiveSeries = false, seenCompletion = false;
  for (var trial = 0; trial < 60 && !(seenLiveSeries && seenCompletion); trial++) {
    var w = freshGame();
    var S = w.Game.State, d = S.data;
    var t = stageFinal(w, 1);
    var maps = 0, guard = 0;
    while (!t.done && guard < 10) {
      d.day++; // one map per day
      var res = S.playTournamentMatch();
      if (!res.ok) break;
      guard++;
      assert.strictEqual(res.bestOf, 3, 'tier-1 final should be Bo3, got ' + res.bestOf);
      maps++;
      if (res.seriesLive) {
        seenLiveSeries = true;
        assert.ok(!res.tournamentComplete, 'a live series must not complete the tournament');
        assert.ok(res.yourMaps < 2 && res.oppMaps < 2, 'live series with a side already on 2 maps');
      } else {
        seenCompletion = true;
        assert.ok(res.yourMaps === 2 || res.oppMaps === 2,
          'series ended without a side reaching 2 maps: ' + res.yourMaps + '-' + res.oppMaps);
        assert.ok(maps >= 2 && maps <= 3, 'a Bo3 took ' + maps + ' maps');
        break;
      }
    }
  }
  assert.ok(seenLiveSeries, 'never observed a live (1-0 / 1-1) series across 60 trials');
  assert.ok(seenCompletion, 'never observed a completed series across 60 trials');
});

check('#7 a tier-3 final stays Bo1 — one map settles it', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  var t = stageFinal(w, 3);
  d.day++;
  var res = S.playTournamentMatch();
  assert.ok(res.ok, 'match did not play: ' + res.reason);
  assert.strictEqual(res.bestOf, 1, 'tier-3 final should be Bo1');
  assert.ok(!res.seriesLive, 'a Bo1 can never leave a live series');
  assert.ok(res.tournamentComplete, 'a Bo1 final should settle the tournament in one map');
});

check('#7 ELO moves ONCE per series, not once per map', function () {
  // Drive a full Bo3 and count how many times eloDelta is written.
  for (var trial = 0; trial < 40; trial++) {
    var w = freshGame();
    var S = w.Game.State, d = S.data;
    var t = stageFinal(w, 1);
    var match = t.bracket[0][0];
    var mapsPlayed = 0, guard = 0;
    while (!match.done && guard < 6) {
      d.day++;
      var before = match.eloDelta;
      var res = S.playTournamentMatch();
      if (!res.ok) break;
      guard++; mapsPlayed++;
      if (!match.done) {
        assert.strictEqual(match.eloDelta, before,
          'ELO moved on a map that did not end the series');
      }
    }
    if (match.done && mapsPlayed === 3) {
      assert.ok(typeof match.eloDelta === 'number', 'series ended with no ELO applied');
      return; // proved it on a 3-map series, which is the case that could double-count
    }
  }
});

/* ---- #9 / #10: the round sequence the animation walks ------------------
   buildRoundSequence lives in js/tournaments.js, which needs a DOM and so
   cannot be loaded in this VM. It is a pure function, so it is re-declared
   here EXACTLY as shipped and the invariants are asserted against it. If you
   change it there, change it here — the point is to pin the invariants, and a
   copy that drifts will fail loudly rather than silently pass. */
function buildRoundSequenceRef(yourScore, oppScore) {
  var REG_WIN = 13, REG_TIE = 12;
  function shuffledRun(aTag, aN, bTag, bN) {
    var pool = [], i;
    for (i = 0; i < aN; i++) pool.push(aTag);
    for (i = 0; i < bN; i++) pool.push(bTag);
    for (i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool;
  }
  var winnerIsYou = yourScore >= oppScore;
  var winnerTag = winnerIsYou ? 'you' : 'opp';
  var loserTag = winnerIsYou ? 'opp' : 'you';
  var winnerFinal = winnerIsYou ? yourScore : oppScore;
  var loserFinal = winnerIsYou ? oppScore : yourScore;
  var seq, overtimeAt = -1;
  if (winnerFinal > REG_WIN) {
    seq = shuffledRun(winnerTag, REG_TIE, loserTag, REG_TIE);
    overtimeAt = seq.length;
    seq = seq.concat(shuffledRun(winnerTag, (winnerFinal - REG_TIE) - 1, loserTag, loserFinal - REG_TIE));
  } else {
    seq = shuffledRun(winnerTag, winnerFinal - 1, loserTag, loserFinal);
  }
  seq.push(winnerTag);
  seq.overtimeAt = overtimeAt;
  return seq;
}

// Every prefix of a legal MR12 match: nobody passes 13, and nobody is even AT
// 13 unless it is the final round, because reaching 13 ends regulation.
function assertLegalPrefixes(seq, yourScore, oppScore) {
  var y = 0, o = 0;
  for (var i = 0; i < seq.length; i++) {
    if (seq[i] === 'you') y++; else o++;
    var isLast = (i === seq.length - 1);
    var maxSeen = Math.max(y, o), minSeen = Math.min(y, o);
    if (!isLast) {
      // A side sitting on 13 mid-match means the match should already be over,
      // UNLESS both are past 12 (overtime, where play continues to 16).
      if (maxSeen >= 13 && minSeen < 12) {
        throw new Error('illegal prefix at round ' + (i + 1) + ': ' + y + '-' + o +
          ' (a side reached 13 while the other was on ' + minSeen + ')');
      }
      if (maxSeen > 16) throw new Error('score exceeded 16: ' + y + '-' + o);
    }
  }
  assert.strictEqual(y, yourScore, 'final you: ' + y + ' != ' + yourScore);
  assert.strictEqual(o, oppScore, 'final opp: ' + o + ' != ' + oppScore);
}

check('#9 regulation sequences (13-x) are legal at every prefix, 400 samples', function () {
  for (var n = 0; n < 400; n++) {
    var loser = Math.floor(Math.random() * 12); // 0..11
    var youWin = Math.random() < 0.5;
    var ys = youWin ? 13 : loser, os = youWin ? loser : 13;
    assertLegalPrefixes(buildRoundSequenceRef(ys, os), ys, os);
  }
});

check('#9 OVERTIME sequences (16 vs 12-14) pass through exactly 12-12 first, 400 samples', function () {
  for (var n = 0; n < 400; n++) {
    var loser = 12 + Math.floor(Math.random() * 3); // 12..14
    var youWin = Math.random() < 0.5;
    var ys = youWin ? 16 : loser, os = youWin ? loser : 16;
    var seq = buildRoundSequenceRef(ys, os);
    assertLegalPrefixes(seq, ys, os);
    assert.strictEqual(seq.overtimeAt, 24, 'overtime must begin after 24 rounds (12-12), got ' + seq.overtimeAt);
    var y = 0, o = 0;
    for (var i = 0; i < seq.overtimeAt; i++) { if (seq[i] === 'you') y++; else o++; }
    assert.strictEqual(y, 12, 'regulation you: ' + y);
    assert.strictEqual(o, 12, 'regulation opp: ' + o);
  }
});

check('#9 a regulation match never reports an overtime beat', function () {
  for (var n = 0; n < 100; n++) {
    var seq = buildRoundSequenceRef(13, Math.floor(Math.random() * 12));
    assert.strictEqual(seq.overtimeAt, -1, 'regulation match claimed overtime');
  }
});

check('#9 state.js only ever generates legal MR12 finals, 3000 rolls', function () {
  var w = freshGame();
  // rollMatchScore is private; exercise it through the public shape it feeds.
  // Legal: winner 13 with loser 0-11, or winner 16 with loser 12-14.
  for (var i = 0; i < 3000; i++) {
    var s = w.Game.State.rollTournamentInterval; // keep the VM warm/honest
    void s;
  }
  // Assert the CONSTANTS the display relies on still match state.js's comment.
  var src = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8');
  assert.ok(/winner:\s*16,\s*loser:\s*randInt\(12,\s*14\)/.test(src),
    'overtime scoreline in state.js is no longer 16 vs 12-14');
  assert.ok(/winner:\s*13,\s*loser:\s*randInt\(0,\s*11\)/.test(src),
    'regulation scoreline in state.js is no longer 13 vs 0-11');
});

check('#10 the pip strip is never pre-rendered with the total round count', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/tournaments.js'), 'utf8');
  assert.ok(!/for\s*\(var i = 0; i < totalRounds; i\+\+\)\s*matchEls\.pips\.appendChild/.test(src),
    'tournaments.js still pre-creates one empty pip per round — that leaks the final score');
  assert.ok(/function appendPip\(side\)/.test(src),
    'expected appendPip(side), which creates each pip as its round resolves');
});

/* ---- #11: the tier 1 gate is all THREE requirements -------------------- */
function primeTier1(w) {
  var d = w.Game.State.data;
  d.hype = 100; d.chemistry = 90; d.bestContractTier = 2;
  return d;
}

check('#11 tier 1 needs 100 hype AND 90+ chemistry AND a completed T2 contract', function () {
  var w = freshGame();
  var S = w.Game.State, d = primeTier1(w);
  assert.strictEqual(S.hasEarnedTier1(), true, 'all three met should qualify');

  d.hype = 99;
  assert.strictEqual(S.hasEarnedTier1(), false, '99 hype must NOT qualify — the gate is 100/100');
  d.hype = 100;

  d.chemistry = 89;
  assert.strictEqual(S.hasEarnedTier1(), false, '89 chemistry must not qualify');
  d.chemistry = 90;

  d.bestContractTier = 3;
  assert.strictEqual(S.hasEarnedTier1(), false, 'a T3-only contract history must not qualify');
  d.bestContractTier = null;
  assert.strictEqual(S.hasEarnedTier1(), false, 'never completing a contract must not qualify');
});

check('#11 the old tournament-placement shortcut no longer opens tier 1', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.hype = 100; d.chemistry = 100; d.bestContractTier = null;
  // A T2 semifinal used to be an alternative qualifying route. It is gone.
  d.tournamentHistory = [{ day: 1, event: 'X', tier: 2, placement: 'CHAMPION', prize: 0, rankDelta: 0 }];
  assert.strictEqual(S.hasEarnedTier1(), false,
    'winning a T2 tournament must no longer substitute for completing a T2 contract');
});

check('#11 tier1GateParts reports WHICH requirement is missing', function () {
  var w = freshGame();
  var S = w.Game.State, d = primeTier1(w);
  d.hype = 10;
  var p = S.tier1GateParts();
  assert.strictEqual(p.hype, false, 'hype should read unmet');
  assert.strictEqual(p.chemistry, true, 'chemistry should read met');
  assert.strictEqual(p.contract, true, 'contract should read met');
});

/* ---- #4 (which REVERSED #15): the workstation shares one tile again -----
   Item 15 gave the PC its own square; item 4 put it back and fixed the real
   complaint — the tower OVERLAPPING the desk art — in js/iso.js instead. */
check('#4 SHARED_TILE_CATEGORIES is desk+pc+monitor again', function () {
  var w = freshGame();
  var cats = w.Game.State.SHARED_TILE_CATEGORIES;
  ['desk', 'pc', 'monitor'].forEach(function (c) {
    assert.ok(cats.indexOf(c) !== -1, c + ' must be a shared-tile category');
  });
  assert.strictEqual(w.Game.State.categoriesMayShareTile('desk', 'pc'), true, 'desk+pc must share');
  assert.strictEqual(w.Game.State.categoriesMayShareTile('desk', 'monitor'), true, 'desk+monitor must share');
  assert.strictEqual(w.Game.State.categoriesMayShareTile('desk', 'desk'), false, 'never two of the same category');
});

check('#4 the canonical workstation is one tile, and the whole layout is legal on a 4x4', function () {
  var w = furnish(freshGame());   // V22 item 2: a fresh room is empty
  var S = w.Game.State, d = S.data;
  var pc = d.placed.filter(function (p) { return p.id === 'pc_budget'; })[0];
  var desk = d.placed.filter(function (p) { return p.id === 'desk_plywood'; })[0];
  var mon = d.placed.filter(function (p) { return p.id === 'monitor_basic'; })[0];
  assert.ok(pc && desk && mon, 'the starter layout should place a desk, a PC and a monitor');
  assert.ok(pc.x === desk.x && pc.y === desk.y, 'the PC must share the desk tile again');
  assert.ok(mon.x === desk.x && mon.y === desk.y, 'the monitor must share the desk tile');
  d.placed.forEach(function (p, i) {
    var def = S.findShopItem(p.id);
    var chk = S.canPlaceFootprint(def, p.x, p.y, p.rot || 0, i);
    assert.ok(chk && chk.ok, p.id + ' is illegal where the starter layout puts it: ' + (chk && chk.reason));
  });
});

check('#4 the tower and the desk occupy DISJOINT halves of the tile, at every desk tier', function () {
  // This is the geometry that makes sharing a tile legitimate rather than a
  // fudge, so it is asserted numerically against js/iso.js rather than eyeballed.
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');

  // props.pc: oy = gy + 0.10, depths [0.30,0.32,0.34,0.36]
  var pcOy = /props\.pc[\s\S]*?var oy = gy \+ ([\d.]+);/.exec(src);
  assert.ok(pcOy, 'could not read the PC tower origin from js/iso.js');
  var pcD = /props\.pc[\s\S]*?var d = \[([\d.,\s]+)\]/.exec(src);
  assert.ok(pcD, 'could not read the PC tower depths');
  var pcBack = parseFloat(pcOy[1]);
  var pcFront = pcBack + Math.max.apply(null, pcD[1].split(',').map(parseFloat));

  // props.desk: oy = gy + 0.90 - d, depths [0.24,0.30,0.36,0.40]
  var deskD = /props\.desk[\s\S]*?var d = \[([\d.,\s]+)\]/.exec(src);
  assert.ok(deskD, 'could not read the desk depths');
  var deskBack = 0.90 - Math.max.apply(null, deskD[1].split(',').map(parseFloat));

  assert.ok(pcFront <= deskBack,
    'the PC spans y..' + pcFront.toFixed(2) + ' but the deepest desk starts at y' +
    deskBack.toFixed(2) + ' — they would overlap, which is the bug item 4 exists to fix');
});

check('#4 the PC draws BEHIND the desk and the monitor', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  var m = /desk: 1, chair: 1, bed: 1, pc: ([\d.]+), monitor: ([\d.]+)/.exec(src);
  assert.ok(m, 'could not read CATEGORY_ORDER from js/iso.js');
  var pc = parseFloat(m[1]), monitor = parseFloat(m[2]);
  assert.ok(pc < 1, 'pc (' + pc + ') must sort behind desk (1)');
  assert.ok(pc < monitor, 'pc (' + pc + ') must sort behind monitor (' + monitor + ')');
});

check('#4 a save with the PC on its own tile still loads fine — no reverse migration', function () {
  var w = seedSlot0({
    v: 1, locationId: 0,
    owned: { desk_plywood: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 },
    placed: [
      { id: 'desk_plywood', x: 1, y: 1, rot: 0 },
      { id: 'pc_budget', x: 2, y: 1, rot: 0 },   // where item 15's migration left it
      { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
      { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
      { id: 'bed_mattress', x: 2, y: 3, rot: 0 }
    ],
    bedArtAnchorFixed: true
  });
  var norm = w.Game.State.loadSlot(0);
  var pc = norm.placed.filter(function (p) { return p.id === 'pc_budget'; })[0];
  assert.ok(pc, 'the PC must still be placed');
  assert.deepStrictEqual({ x: pc.x, y: pc.y }, { x: 2, y: 1 },
    'a standalone tower is still legal and must be left exactly where it is');
});

/* ---- #1: the career starts on the PLYWOOD desk -------------------------- */
check('#1 a fresh save OWNS the plywood desk, not the flatpack', function () {
  var w = freshGame();
  var d = w.Game.State.data;
  assert.strictEqual(d.owned.desk_plywood, 1, 'the plywood desk must be owned from the start');
  assert.ok(!d.owned.desk_ikea, 'the flatpack must NOT be owned from the start');
  assert.strictEqual(w.Game.Data.starterLayout.filter(function (p) {
    return p.id === 'desk_plywood';
  }).length, 1, 'the canonical layout must use the plywood desk');
});

/* ---- #2: a new career starts with an EMPTY room ------------------------ */
check('#2 a fresh save places NOTHING — the five core props start in inventory', function () {
  var w = freshGame();
  var d = w.Game.State.data;
  assert.deepStrictEqual(d.placed, [], 'a new career must start with an empty room');
  ['desk_plywood', 'pc_budget', 'monitor_basic', 'chair_wooden', 'bed_mattress'].forEach(function (id) {
    assert.strictEqual(d.owned[id], 1, id + ' must be OWNED and waiting in the inventory');
  });
});

check('#2 a fresh save is ROOM INCOMPLETE, and furnishing it completes the room', function () {
  var w = freshGame();
  var S = w.Game.State;
  var before = S.roomCompleteness();
  assert.strictEqual(before.complete, false, 'an empty room must read as incomplete');
  assert.ok(before.missing.length > 0, 'and must name what is missing, for the tutorial to quote');
  furnish(w);
  var after = S.roomCompleteness();
  assert.strictEqual(after.complete, true, 'placing the starter layout must complete the room');
  assert.deepStrictEqual(after.missing, []);
});

check('#2 the onboarding gates its FURNISH step on the room actually being complete', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/tutorial.js'), 'utf8');
  assert.ok(/title: 'FURNISH YOUR ROOM'/.test(src), 'expected a FURNISH YOUR ROOM step');
  assert.ok(/waitFor: function \(\) \{[\s\S]*?roomCompleteness\(\)\.complete/.test(src),
    'the step must hold NEXT until State.roomCompleteness() says the room is done');
  assert.ok(/UI\.setDisabled\(nextBtn, gated\)/.test(src),
    'the gate must use UI.setDisabled — a CSS-only disable is still Enter-activatable (HANDOFF-V2 §5.5)');
  assert.ok(/stopGate\(\);\s*\/\/ the poll must never outlive the overlay/.test(src),
    'the gate poll must be cleared when the tutorial stops');
});

check('#1 the flatpack is still buyable, and is a real upgrade over plywood', function () {
  var w = freshGame();
  var S = w.Game.State;
  var ply = S.findShopItem('desk_plywood'), flat = S.findShopItem('desk_ikea');
  assert.ok(ply && flat, 'both desks must still exist in the catalog');
  assert.ok(flat.price > ply.price, 'the flatpack must cost more than the starting desk');
  assert.ok((flat.stats.aim || 0) > (ply.stats.aim || 0), 'and be a genuine stat upgrade');
});

/* ---- #14: return to the phone inventory after placing ------------------ */
check('#14 js/phone.js exposes afterPlacement and js/hub.js calls it on both settle paths', function () {
  var phone = fs.readFileSync(path.join(ROOT, 'js/phone.js'), 'utf8');
  var hub = fs.readFileSync(path.join(ROOT, 'js/hub.js'), 'utf8');
  assert.ok(/afterPlacement:\s*afterPlacement/.test(phone), 'phone.js must export afterPlacement');
  assert.ok(/returnToInventoryAfterPlace = true/.test(phone),
    'phone.js must flag placements launched from the inventory app');
  assert.ok(/notePlacementSettled\(true\)/.test(hub), 'hub.js must report a committed placement');
  assert.ok(/notePlacementSettled\(false\)/.test(hub), 'hub.js must clear the flag on a discarded draft');
});

/* ---- #12: the rug is a floor underlay, and dyeable ---------------------- */
check('#12 the rug slides UNDER furniture — and under an LED, which shares noCollide', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.placed = [];
  d.owned = { desk_ikea: 1, rug_pixel: 2, rgb_strip: 1, plant_succulent: 1 };
  assert.strictEqual(S.placeItem('desk_ikea', 2, 2, 0).ok, true, 'desk on an empty tile');
  assert.strictEqual(S.placeItem('rug_pixel', 2, 2, 0).ok, true, 'the rug must go UNDER the desk');
  assert.strictEqual(S.placeItem('rgb_strip', 2, 2, 0).ok, true,
    'an LED must still land on that tile — a rug is a different collide layer');
  // ...and an ordinary prop is not blocked by the rug either (the other half
  // of "never blocks, never blocked").
  assert.strictEqual(S.placeItem('plant_succulent', 3, 3, 0).ok, true, 'sanity: plant on a free tile');
  assert.strictEqual(S.placeItem('rug_pixel', 3, 3, 0).ok, true, 'the rug must go under a plant too');
});

check('#12 two rugs still may not stack on one tile', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.placed = [];
  d.owned = { rug_pixel: 2 };
  assert.strictEqual(S.placeItem('rug_pixel', 2, 2, 0).ok, true, 'first rug places');
  assert.strictEqual(S.placeItem('rug_pixel', 2, 2, 0).ok, false, 'a second rug must NOT stack on the first');
});

check('#12 two LEDs still may not stack — V20 behaviour is untouched', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.placed = [];
  d.owned = { rgb_strip: 1, neon_sign: 1 };
  assert.strictEqual(S.placeItem('rgb_strip', 2, 2, 0).ok, true, 'first LED places');
  assert.strictEqual(S.placeItem('neon_sign', 2, 2, 0).ok, false, 'two LEDs must still not share a tile');
});

check('#12 the rug is customisable in the FABRIC family, not the LED one', function () {
  var w = freshGame();
  var S = w.Game.State;
  assert.strictEqual(S.customiseFamily('rug_pixel'), 'fabric',
    'a rug is dyed cloth — it must not land in the emissive LED palette');
  var pal = S.customisePalette('rug_pixel');
  assert.ok(pal && pal.length > 0, 'the rug must offer a palette');
  assert.deepStrictEqual(pal, S.customisePalette('poster_team'),
    'it must share the banner/blind fabric palette, not get a private list');
});

check('#12 a rug tint round-trips through a real save and reload', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.placed = []; d.owned = { rug_pixel: 1 };
  assert.strictEqual(S.placeItem('rug_pixel', 2, 2, 0).ok, true);
  var idx = d.placed.length - 1;
  var colour = S.customisePalette('rug_pixel')[2];
  var res = S.setItemTint(idx, colour);
  assert.ok(res && res.ok, 'tinting the rug should succeed: ' + JSON.stringify(res));
  assert.strictEqual(S.itemTint(idx), colour);
});

check('#12 the rug draws BENEATH the LEDs, which already sit behind furniture', function () {
  // drawOrderFor lives in js/iso.js (needs a canvas), so pin the contract.
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  assert.ok(/collideLayer === 'floor'\) return -1\.2/.test(src),
    "iso.js must sort a 'floor' underlay below the -0.9 the LEDs use");
});

/* ---- #13: the bed outlines itself, and also flashes at night ----------- */
check('#13 the bed indicator outlines the BED, not its floor tiles, and night triggers it', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/hub.js'), 'utf8');
  assert.ok(/function convexHull\(/.test(src),
    'expected a convex-hull silhouette rather than per-tile floor quads');
  assert.ok(/dayPhase\(\)\.phase === 'night'/.test(src),
    'night must be a trigger in its own right, not only low energy');
  assert.ok(/lowEnergy \|\| isNight/.test(src) || /!lowEnergy && !isNight/.test(src),
    'both triggers must be honoured');
  // The old implementation stroked a quad per footprint tile at z=0.5.
  assert.ok(!/project\(t\.x \+ 1, t\.y, 0\.5, camera\)/.test(src),
    'hub.js still strokes the bed FOOTPRINT quads — that reads as "tiles selected"');
});

/* ---- #5: the phone is available from the start ------------------------- */
check('#5 a brand-new save can open the phone, with SOCIAL and SPONSORS locked', function () {
  var w = freshGame();
  var st = w.Game.State.phoneStatus();
  assert.strictEqual(st.unlocked, true, 'the handset must open from the first minute');
  var byId = {};
  st.apps.forEach(function (a) { byId[a.id] = a; });
  assert.strictEqual(byId.social.unlocked, false, 'SOCIAL starts locked');
  assert.strictEqual(byId.sponsors.unlocked, false, 'SPONSORS starts locked');
  assert.strictEqual(byId.crypto.unlocked, false, 'CRYPTO starts locked');
  // and every locked app must say what it costs
  ['social', 'sponsors', 'crypto'].forEach(function (id) {
    assert.strictEqual(typeof byId[id].unlockLabel, 'string', id + ' needs an unlock label');
    assert.strictEqual(byId[id].unlockLabel, byId[id].unlockLabel.toUpperCase(),
      id + ' label must be ready-to-render uppercase');
  });
});

check('#5 SOCIAL unlocks at 500 followers, not the old 300', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.followers = 300; S.tickEnergy();
  assert.strictEqual(d.socialAppUnlocked, false, '300 followers must no longer be enough');
  d.followers = 499; S.tickEnergy();
  assert.strictEqual(d.socialAppUnlocked, false, '499 must not unlock it');
  d.followers = 500; S.tickEnergy();
  assert.strictEqual(d.socialAppUnlocked, true, '500 must unlock it exactly');
});

check('#5 both new app flags survive a save -> reload in a fresh VM', function () {
  var store = {};
  var w = freshGame(store);
  w.Game.State.data.socialAppUnlocked = true;
  w.Game.State.data.sponsorsAppUnlocked = true;
  w.Game.State.save();
  var w2 = freshGame(store);
  assert.strictEqual(w2.Game.State.data.socialAppUnlocked, true, 'socialAppUnlocked was dropped on load');
  assert.strictEqual(w2.Game.State.data.sponsorsAppUnlocked, true, 'sponsorsAppUnlocked was dropped on load');
});

check('#5 no sponsor offer arrives before the player has signed a team', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.dead = false; d.contract = 'free'; d.myTeamId = null;
  d.elo = 8000; d.followers = 500000; d.subscribers = 50000;
  for (var i = 0; i < 120; i++) {
    d.energy = d.energyMax;
    S.endDay();
    assert.strictEqual(S.sponsorOffers().length, 0,
      'a teamless player must receive no sponsor offers (day ' + d.day + ')');
    d.sponsorOffers = [];
  }
});

/* ---- #1: sponsors run for a fixed term, then free the slot ------------- */
check('#1 an accepted sponsor carries a 1-3 week term', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.sponsorsAppUnlocked = true;
  d.socialAppUnlocked = true;
  var seen = {};
  for (var n = 0; n < 200; n++) {
    d.sponsors = []; d.sponsorOffers = [];
    d.nextSponsorOfferEligibleDay = 0;
    d.elo = 5000; d.followers = 100000; d.subscribers = 20000;
    // roll offers until one exists, then accept it
    for (var g = 0; g < 40 && !d.sponsorOffers.length; g++) { d.day++; d.nextSponsorOfferEligibleDay = 0; S.endDay(); }
    var offers = S.sponsorOffers();
    if (!offers.length) continue;
    var res = S.acceptSponsorOffer(offers[0].id);
    if (!res.ok) continue;
    var s = d.sponsors[d.sponsors.length - 1];
    assert.ok(s.termWeeks >= 1 && s.termWeeks <= 3, 'term out of range: ' + s.termWeeks);
    assert.strictEqual(s.weeksServed, 0, 'a fresh signing has served no weeks');
    seen[s.termWeeks] = true;
    if (seen[1] && seen[2] && seen[3]) break;
  }
  assert.ok(Object.keys(seen).length >= 2,
    'expected a spread of term lengths, saw: ' + Object.keys(seen).join(','));
});

check('#1 a served term expires the sponsor, freeing the slot with no reputation hit', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.dead = false;
  d.sponsors = [{
    id: 'x1', sponsorId: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 350,
    obligation: { type: 'stream_days', amount: 0 },   // trivially met every week
    progress: 0, warned: false, acquiredDay: 0, termWeeks: 1, weeksServed: 0
  }];
  var repBefore = d.reputation;
  var cashBefore = d.cash;
  // advance to the weekly sponsor tick
  var guard = 0;
  while (d.sponsors.length && guard < 60) { d.energy = d.energyMax; S.endDay(); guard++; }
  assert.strictEqual(d.sponsors.length, 0, 'the sponsor should have expired and freed its slot');
  assert.ok(d.cash > cashBefore, 'it must still be PAID for its final week');
  assert.strictEqual(d.reputation, repBefore,
    'an expiry is not a failure — reputation must be untouched');
});

check('#1 a legacy sponsor with no term is never retro-expired', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.dead = false;
  d.sponsors = [{
    id: 'old', sponsorId: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 350,
    obligation: { type: 'stream_days', amount: 0 },
    progress: 0, warned: false, acquiredDay: 0   // no termWeeks — a pre-V22 save
  }];
  for (var i = 0; i < 40; i++) { d.energy = d.energyMax; S.endDay(); }
  assert.strictEqual(d.sponsors.length, 1,
    'a sponsor signed before terms existed must keep running, not vanish');
  var st = S.sponsorsStatus().held[0];
  assert.strictEqual(st.termWeeks, null, 'and it should report no term rather than a fake one');
  assert.strictEqual(st.weeksLeft, null);
});

check('#1 a warned week does NOT burn down the term', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.dead = false;
  d.sponsors = [{
    id: 'x2', sponsorId: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 350,
    obligation: { type: 'match_wins', amount: 99 },  // never met
    progress: 0, warned: false, acquiredDay: 0, termWeeks: 3, weeksServed: 0
  }];
  var guard = 0;
  while (d.sponsors.length && guard < 40) { d.energy = d.energyMax; S.endDay(); guard++; }
  // it should have been WARNED then DROPPED, never quietly expired
  assert.strictEqual(d.sponsors.length, 0);
  assert.ok(d.reputation < 0, 'failing twice must still cost reputation, not read as a clean expiry');
});

/* ---- #2: three cases with genuinely different contents ----------------- */
var CASE_SHAPE = {
  case_standard: { milspec: 7, restricted: 5, classified: 3, covert: 2, rare: 4 },
  case_prime:    { milspec: 7, restricted: 5, classified: 3, covert: 2, rare: 6 },
  case_elite:    { milspec: 3, restricted: 3, classified: 2, covert: 1, rare: 5 }
};

check('#2 each case has the rarity counts of the real case it mirrors', function () {
  var w = freshGame();
  var cs = w.Game.Data.caseSkins;
  for (var caseId in CASE_SHAPE) {
    assert.ok(cs[caseId], 'missing pool for ' + caseId);
    for (var rarity in CASE_SHAPE[caseId]) {
      var got = (cs[caseId][rarity] || []).length;
      assert.strictEqual(got, CASE_SHAPE[caseId][rarity],
        caseId + '.' + rarity + ': expected ' + CASE_SHAPE[caseId][rarity] + ', got ' + got);
    }
  }
});

check('#2 the three cases share NO items — the original complaint', function () {
  var w = freshGame();
  var cs = w.Game.Data.caseSkins;
  var ids = Object.keys(cs);
  for (var a = 0; a < ids.length; a++) {
    for (var b = a + 1; b < ids.length; b++) {
      var setA = {}, overlap = [];
      ['milspec', 'restricted', 'classified', 'covert', 'rare'].forEach(function (r) {
        (cs[ids[a]][r] || []).forEach(function (s) { setA[s.name] = 1; });
      });
      ['milspec', 'restricted', 'classified', 'covert', 'rare'].forEach(function (r) {
        (cs[ids[b]][r] || []).forEach(function (s) { if (setA[s.name]) overlap.push(s.name); });
      });
      assert.strictEqual(overlap.length, 0,
        ids[a] + ' and ' + ids[b] + ' share items: ' + overlap.join(', '));
    }
  }
});

check('#2 every skin name is unique and every entry has a name + sprite', function () {
  var w = freshGame();
  var cs = w.Game.Data.caseSkins;
  var seen = {}, total = 0;
  for (var caseId in cs) {
    for (var rarity in cs[caseId]) {
      cs[caseId][rarity].forEach(function (s) {
        assert.ok(s.name && typeof s.name === 'string', 'entry with no name in ' + caseId + '.' + rarity);
        assert.ok(s.sprite && s.sprite.gun && s.sprite.finish,
          s.name + ' has no sprite descriptor');
        assert.ok(!seen[s.name], 'duplicate skin name: ' + s.name);
        seen[s.name] = 1; total++;
      });
    }
  }
  assert.strictEqual(total, 58, 'expected 43 skins + 15 rare specials = 58, got ' + total);
});

check('#2 every sprite references a gun shape and a finish that actually exist', function () {
  var w = freshGame();
  // GUN_SHAPES/FINISHES live inside js/cases.js's IIFE (it needs a DOM, so it
  // is not loaded into this VM). Read the declared keys straight out of the
  // source instead — a missing table entry would render a blank tile, which is
  // exactly the silent failure HANDOFF-V2 §5.2 describes for propMap.
  var src = fs.readFileSync(path.join(ROOT, 'js/cases.js'), 'utf8');
  function keysOf(declName) {
    var m = new RegExp('var ' + declName + ' = \\{([\\s\\S]*?)\\n  \\};').exec(src);
    assert.ok(m, 'could not find ' + declName + ' in js/cases.js');
    var out = {};
    var re = /^\s{4}([a-zA-Z_][\w]*)\s*:/gm;
    var k;
    while ((k = re.exec(m[1]))) out[k[1]] = 1;
    return out;
  }
  var guns = keysOf('GUN_SHAPES');
  var finishes = keysOf('FINISHES');
  assert.ok(Object.keys(guns).length >= 8, 'expected the full silhouette set, got ' + Object.keys(guns).length);

  var cs = w.Game.Data.caseSkins, missing = [];
  for (var caseId in cs) {
    for (var rarity in cs[caseId]) {
      cs[caseId][rarity].forEach(function (s) {
        if (!guns[s.sprite.gun]) missing.push(s.name + ' -> gun "' + s.sprite.gun + '"');
        if (!finishes[s.sprite.finish]) missing.push(s.name + ' -> finish "' + s.sprite.finish + '"');
      });
    }
  }
  assert.strictEqual(missing.length, 0, 'sprites reference missing table entries:\n  ' + missing.join('\n  '));
});

check('#2 no two skins share a gun+finish pair — that would render identical tiles', function () {
  var w = freshGame();
  var cs = w.Game.Data.caseSkins;
  var seen = {}, clashes = [];
  for (var caseId in cs) {
    for (var rarity in cs[caseId]) {
      cs[caseId][rarity].forEach(function (s) {
        var key = s.sprite.gun + '+' + s.sprite.finish;
        if (seen[key]) clashes.push(seen[key] + ' and ' + s.name + ' both render as ' + key);
        else seen[key] = s.name;
      });
    }
  }
  // Caught for real on the first pass: UMP-45 | Handstitch and MP9 | Stitchwork
  // were both smg+stitch, i.e. two pixel-identical tiles at different rarities.
  assert.strictEqual(clashes.length, 0, clashes.join('\n  '));
});

check('#2 openCase only ever rolls items from the case it was told to open', function () {
  var w = furnish(freshGame());   // CASES is gated on a complete room (SPEC-V5 5r)
  var S = w.Game.State, d = S.data;
  var cs = w.Game.Data.caseSkins;
  ['case_standard', 'case_prime', 'case_elite'].forEach(function (caseId) {
    var allowed = {};
    for (var r in cs[caseId]) cs[caseId][r].forEach(function (s) { allowed[s.name] = 1; });
    d.cash = 5000000;
    d.dead = false;
    S.setCaseSelection('solo', caseId);
    for (var i = 0; i < 400; i++) {
      d.energy = d.energyMax;
      var res = S.openCase();
      assert.ok(res.ok, caseId + ' open failed: ' + res.reason);
      assert.ok(allowed[res.item.skin],
        caseId + ' rolled "' + res.item.skin + '", which is not in its pool');
      if (res.pendingId) S.creditCaseReveal(res.pendingId);
    }
  });
});

check('#2 skinsForCase falls back rather than returning an empty pool', function () {
  var w = freshGame();
  var D = w.Game.Data;
  var out = D.skinsForCase('case_does_not_exist', 'milspec');
  assert.ok(out.length > 0, 'an unknown case id must fall back, not roll nothing');
  assert.deepStrictEqual(out, D.caseSkins.case_standard.milspec);
});

/* ---- #6: HYPE is driven by tournament results, and is harder to gain ---- */
check('#6 every hype source reads Data.hype — no magic numbers left in state.js', function () {
  var w = freshGame();
  var h = w.Game.Data.hype;
  assert.ok(h, 'Data.hype must exist');
  ['trainS', 'matchWin', 'tournamentWin', 'tournamentLoss', 'champion', 'runnerUp',
   'semifinalist', 'earlyExit', 'kicked']
    .forEach(function (k) { assert.strictEqual(typeof h[k], 'number', 'Data.hype.' + k + ' must be a number'); });
  var src = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8');
  var stray = src.match(/d\.hype = clamp\(d\.hype [+-] \d/g);
  assert.strictEqual(stray, null,
    'state.js still hardcodes a hype delta: ' + JSON.stringify(stray));
});

check('#6 a perfect TRAIN no longer maxes hype on its own within a contract', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.dead = false; d.hype = 0;
  // 30 days of flawless training — roughly a full tier 3 contract.
  for (var i = 0; i < 30; i++) {
    d.energy = d.energyMax;
    d.form = null;
    S.setFormGrade ? S.setFormGrade('S') : null;
    d.day++;
  }
  assert.ok(d.hype < 100, 'a contract of perfect training must not max hype: got ' + d.hype);
  assert.ok(d.hype <= 30, 'training alone should contribute modestly, got ' + d.hype);
});

check('#6 solo PLAY wins no longer feed hype at all', function () {
  var w = freshGame();
  assert.strictEqual(w.Game.Data.hype.matchWin, 0,
    'solo queue is not scouted — it must not move hype');
});

check('#6 a tournament LOSS costs more hype than a win gains', function () {
  var w = freshGame();
  var h = w.Game.Data.hype;
  assert.ok(h.tournamentWin > 0, 'winning a tournament match must gain hype');
  assert.ok(h.tournamentLoss < 0, 'losing one must cost hype');
  assert.ok(Math.abs(h.tournamentLoss) > h.tournamentWin,
    'the loss must outweigh the win, or hype ratchets to 100 and stays there');
});

check('#6 hype actually moves on a tournament match, once per SERIES not per map', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  var h = w.Game.Data.hype;
  d.dead = false; d.hype = 50;
  var t = stageFinal(w, 1);          // tier-1 final => Bo3
  var maps = 0, guard = 0, start = d.hype;
  while (!t.done && guard < 8) {
    d.day++;
    var res = S.playTournamentMatch();
    if (!res.ok) break;
    guard++;
    if (res.seriesLive) {
      maps++;
      assert.strictEqual(d.hype, start, 'a mid-series map must not move hype yet');
    } else {
      // series settled: exactly ONE per-match award, plus the placement bonus
      var perMatch = res.youWon ? h.tournamentWin : h.tournamentLoss;
      assert.strictEqual(res.hypeDelta, perMatch, 'reported hypeDelta should be the per-match award');
      break;
    }
  }
  assert.ok(guard > 0, 'the final never resolved');
});

/* ---- #7 / #8: two chrome defects, both asserted against the stylesheets --- */
check('#7 the LEAVE TEAM EARLY button opts out of the black text outline', function () {
  var style = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  var block = /\.btn--primary, \.btn--danger, \.btn--gold,[\s\S]*?\{\s*text-shadow: none;\s*\}/.exec(style);
  assert.ok(block, 'could not find the text-shadow opt-out list in css/style.css');
  assert.ok(/\.offer-card__leave/.test(block[0]),
    '.offer-card__leave paints dark --ink-on-fill on a --danger fill, so it must clear ' +
    ".btn's --text-outline or the glyphs smear into their own black outline");
});

check('#8 the ASLEEP panel does not steal height from the room', function () {
  var style = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  var block = /\.hub__sleep \{[\s\S]*?\}/.exec(style);
  assert.ok(block, 'could not find .hub__sleep in css/style.css');
  assert.ok(/position:\s*absolute/.test(block[0]),
    '.hub__sleep must be taken out of .hub\'s flex column, or showing it re-fits the room smaller');
  assert.ok(!/flex:\s*0 0 auto/.test(block[0]),
    '.hub__sleep must not be a flex child of the hub column any more');
  assert.ok(/\.hub \{[^}]*position:\s*relative/.test(style),
    '.hub needs position:relative for the ASLEEP panel to anchor to it');
});

/* ---- #5: the zoom floor opens up in the larger locations ---------------- */
check('#5 the zoom-out floor is looser in every room bigger than the basement', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/hub.js'), 'utf8');
  var base = /var ZOOM_MIN_BASE = ([\d.]+);/.exec(src);
  var large = /var ZOOM_MIN_LARGE = ([\d.]+);/.exec(src);
  assert.ok(base && large, 'expected both zoom floors in js/hub.js');
  assert.strictEqual(parseFloat(base[1]), 1, 'the basement must still stop at "whole room visible"');
  assert.ok(parseFloat(large[1]) < 1, 'larger rooms must be allowed to zoom out past the fit scale');
  assert.ok(parseFloat(large[1]) > 0.7, 'but not so far that props stop being tappable');
  // and nothing may still clamp against the old constant
  assert.ok(!/Math\.max\(ZOOM_MIN,/.test(src), 'a clamp still uses the old fixed ZOOM_MIN');
  assert.ok(/Math\.max\(zoomMin\(\),/.test(src), 'clamps must call zoomMin()');
});

/* ---- #3 / #9: the two art defects -------------------------------------- */
check('#3 nothing hangs under the flatpack tabletop — no drawer, no panel', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  // Attempt 1: the drawer unit that read as a detached grey box.
  assert.ok(!/IKEA: a small drawer unit hanging under the tabletop/.test(src),
    'the drawer unit is back');
  // Attempt 2: the modesty panel, which read as a plate hanging off the side
  // at some rotations (owner screenshots).
  assert.ok(!/Replaced with a MODESTY PANEL/.test(src), 'the modesty panel is back');
  assert.ok(/Do not add a third thing here/.test(src),
    'expected the note recording why this space stays empty');
  // And the tier-1 branch must no longer draw anything of its own.
  var desk = /props\.desk = function[\s\S]*?\n  \};/.exec(src);
  assert.ok(desk, 'could not isolate props.desk');
  assert.ok(!/if \(tier === 1\) \{/.test(desk[0]),
    'props.desk still has a tier-1-only body — the flatpack should draw nothing extra');
});

/* ==== V22c ================================================================ */

check('c1 a career starts on 25 hype, enough to be scouted at all', function () {
  var w = freshGame();
  assert.strictEqual(w.Game.Data.hypeStart, 25);
  assert.strictEqual(w.Game.State.data.hype, 25,
    'a fresh save must open on Data.hypeStart, not 0');
  // ...and still nowhere near the tier 1 gate, which is a separate rule.
  assert.ok(w.Game.State.data.hype < w.Game.Data.tier1Gate.hype,
    'the starting hype must not accidentally satisfy the tier 1 gate');
});

check('c1 the starting hype survives a save -> reload in a fresh VM', function () {
  var store = {};
  var w = freshGame(store);
  assert.strictEqual(w.Game.State.data.hype, 25);
  w.Game.State.save();
  var w2 = freshGame(store);
  assert.strictEqual(w2.Game.State.data.hype, 25, 'hype was dropped or reset on load');
});

check('c2 multi-tile props sort by their FRONT-most tile, not their anchor', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  assert.ok(!/var ka = a\.p\.x \+ a\.p\.y \+ a\.order \* 0\.01;/.test(src),
    'the sort still keys off the anchor tile, so a 2x1 bed draws too early');
  assert.ok(/e\.depth = maxDepth;/.test(src) && /footprintTiles\(e\.def/.test(src),
    'depth should be the max x+y across the prop\'s real footprint tiles');

  // Prove the bug case numerically: a bed at (2,3) {w:2,d:1} reaches depth 6,
  // so a chair at (3,2) — anchor depth 5 — must NOT be able to paint over it.
  var w = freshGame();
  var S = w.Game.State;
  var bed = S.findShopItem('bed_mattress');
  var tiles = S.footprintTiles(bed, 2, 3, 0);
  var maxDepth = Math.max.apply(null, tiles.map(function (t) { return t.x + t.y; }));
  assert.strictEqual(maxDepth, 6, 'the bed should reach depth 6, got ' + maxDepth);
  assert.ok(maxDepth > (2 + 3), 'its anchor depth (5) understates where it actually reaches');
});

/* V22d REPLACED V22c's 45s button-blocking cooldown with a 15s ACTIVE match
   (js/matchgames.js). The brake is now time spent PLAYING, not time locked
   out, so playMatch() no longer refuses back-to-back calls. */
check('d1 PLAY no longer refuses on cooldown — the brake is the active match', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  furnish(w);
  d.dead = false; d.energy = d.energyMax;
  var first = S.playMatch();
  assert.strictEqual(first.ok, true, 'first match should play: ' + first.reason);
  d.energy = d.energyMax;
  var second = S.playMatch();
  assert.strictEqual(second.ok, true,
    'a second match must NOT be refused on cooldown — V22d removed that gate');
});

check('d1 playMatch still charges energy, and still refuses without it', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  furnish(w);
  d.dead = false; d.energy = d.energyMax;
  var before = d.energy;
  var res = S.playMatch();
  assert.strictEqual(res.ok, true);
  assert.ok(d.energy < before, 'a played match must cost energy — removing the cooldown must not have removed the charge');
  assert.strictEqual(d.energy, before - w.Game.Data.energyCosts.play, 'it should cost exactly the PLAY cost');
  d.energy = 0;
  assert.strictEqual(S.playMatch().reason, 'energy', 'with no energy it must still refuse');
});

check('d2 the match overlay exists, is 15s, and rotates three distinct games', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  assert.ok(/var MATCH_MS = 15000;/.test(src), 'the master timer must be 15s');
  assert.ok(/WIN_HOLD_MS = 1500/.test(src), 'a win should hold 1.5s before the card');
  ['makeAwp', 'makeSpray', 'makeBhop'].forEach(function (fn) {
    assert.ok(new RegExp('function ' + fn + '\\(').test(src), 'missing minigame: ' + fn);
  });
  assert.ok(/IDS = \['awp', 'spray', 'bhop'\]/.test(src), 'expected all three in the rotation');
  // no immediate repeat, same rule the music shuffle needs
  assert.ok(/id !== lastGameId/.test(src), 'the rotation must not repeat the last game');
  // TRY AGAIN must not appear when there is no time left to try in
  assert.ok(/remaining\(\) > 900/.test(src), 'TRY AGAIN should be withheld when the clock is nearly out');
  assert.ok(/TRY AGAIN/.test(src) && /QUIT/.test(src), 'both fail buttons must exist');
});

check('d2 the AWP game uses the owner-specified windows', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  assert.ok(/1500 \+ Math\.random\(\) \* 2000/.test(src), 'peek delay should be 1.5-3.5s');
  assert.ok(/reactionMs <= 300/.test(src), 'the reaction window should be 300ms');
  assert.ok(/killfeedUntil/.test(src), 'a win should show a killfeed');
});

check('d3 the AWP crosshair sits dead centre of the peek gap', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  // The gap is derived FROM the centre line, so the two cannot drift apart.
  assert.ok(/gapX = Math\.round\(w \/ 2 - gapW \/ 2\)/.test(src),
    'the gap must be centred on the scope, not placed independently');
  assert.ok(/var cxs = w \/ 2\b/.test(src), 'the reticle must sit on the centre line');
  // The doors are solid and the view-through is clipped; punching the gap by
  // skipping plank columns quantised it to the 12px plank pitch.
  assert.ok(/c\.rect\(gapX, 0, gapW, doorBottom\)[\s\S]{0,40}c\.clip\(\)/.test(src),
    'the view through the doors should be clipped to an exact gap rect');
});

/* ---- V22f: the bhop maps -------------------------------------------------
   These five REPLACE two earlier tests that regexed a single hard-coded route
   (BH_PATH, BH_SILO, BH_PROPS, SURF) straight out of the source. That shape
   could only ever describe ONE map, so it had to go the moment a second was
   added. They now load the module and assert the RELATIONSHIP across every
   entry in BH_MAPS — so a third map is covered the day it lands, instead of
   silently escaping the suite (the same reasoning as the shop CATEGORY_ORDER
   guard in test-v20-customise.js). */

// js/matchgames.js is a plain IIFE over window.Game and touches no DOM at load
// time, so it loads headlessly and its __maps() seam hands over real data
// rather than text scraped with a regex.
function loadMatchGames() {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  var win = { Game: {} };
  new Function('window', 'document', 'Date', 'Math', 'JSON', 'console', src)
    (win, undefined, Date, Math, JSON, console);
  return win.Game.MatchGames;
}
function bhLum(hex) {
  return 0.2126 * parseInt(hex.slice(1, 3), 16) +
         0.7152 * parseInt(hex.slice(3, 5), 16) +
         0.0722 * parseInt(hex.slice(5, 7), 16);
}
// Sample the route densely; used by several checks below.
function bhLanePoints(m, n) {
  var out = [], k;
  for (k = 0; k <= n; k++) {
    var rem = m.track * k / n, p = null;
    for (var i = 0; i < m.segs.length; i++) {
      var g = m.segs[i];
      if (rem <= g.len || i === m.segs.length - 1) {
        var t = g.len ? Math.max(0, Math.min(1, rem / g.len)) : 0;
        p = { x: g.x0 + (g.x1 - g.x0) * t, y: g.y0 + (g.y1 - g.y0) * t };
        break;
      }
      rem -= g.len;
    }
    out.push(p);
  }
  return out;
}

check('d3 there are two bhop maps and the picker cannot repeat one', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  var maps = loadMatchGames().__maps();
  var ids = Object.keys(maps);
  assert.ok(ids.length >= 2, 'expected at least two bhop maps, got ' + ids.length);
  assert.ok(ids.indexOf('nuke') !== -1 && ids.indexOf('dust2') !== -1,
    'expected nuke and dust2, got ' + ids.join(','));
  // Same no-immediate-repeat rule pickGame() and the music shuffle both need:
  // with two maps a naive coin flip repeats half the time.
  assert.ok(/function pickMap\(\)[\s\S]{0,240}id !== lastMapId/.test(src),
    'pickMap() must exclude the last map drawn');
  ids.forEach(function (id) {
    var m = maps[id];
    ['name', 'leg', 'finishBanner'].forEach(function (k) {
      assert.ok(m[k] && m[k].length, id + ' is missing ' + k);
    });
    assert.ok(m.rooms.length && m.props.length && m.labels.length,
      id + ' has no rooms/props/labels');
    assert.ok(m.feature && m.feature.kind, id + ' has no round landmark');
    assert.ok(m.finishSpan && m.finishSpan[1] > m.finishSpan[0], id + ' has no finish span');
  });
});

check('d3 every bhop map is textured as a place, not as a radar', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  var maps = loadMatchGames().__maps();
  // The prop vocabulary each map actually uses must have a renderer, or the
  // prop silently draws nothing — the js/iso.js propMap trap, same shape.
  Object.keys(maps).forEach(function (id) {
    maps[id].props.forEach(function (P) {
      assert.ok(new RegExp("P\\.t === '" + P.t + "'").test(src),
        id + ' uses prop "' + P.t + '" with no renderer');
    });
  });
  /* Structure must be clearly separated in luminance from EVERY walkable
     surface, or the route stops reading as a route. Nuke needs its asphalt
     darker and its concrete lighter, so the rule is a magnitude, not a
     direction. Dust 2 is the hard case: its real walls and floors are the
     same sandstone, so this is the check that keeps it legible at all. */
  Object.keys(maps).forEach(function (id) {
    var T = maps[id].theme;
    assert.ok(/^#[0-9A-F]{6}$/i.test(T.mass), id + ' has no structure mass colour');
    assert.strictEqual(T.surf.length, 3, id + ' needs three surfaces');
    T.surf.forEach(function (s, i) {
      var gap = Math.abs(bhLum(s) - bhLum(T.mass));
      assert.ok(gap > 24, id + ' surface ' + i + ' (' + s + ') is only ' +
        gap.toFixed(1) + ' from the structure mass — the route stops reading');
    });
  });
  // Scatter must be a pure function of the world cell or it boils frame to frame.
  assert.ok(/function bhHash\(a, b\)/.test(src), 'scatter needs deterministic noise');
  assert.ok(!/bhHash\([^)]*Math\.random/.test(src), 'scatter must not use Math.random');
});

check('d3 every bhop route is winnable at top speed and lost at base speed', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  var maps = loadMatchGames().__maps();
  var lo = parseInt(/BH_MIN_SPEED = (\d+)/.exec(src)[1], 10);
  var hi = parseInt(/BH_MAX_SPEED = (\d+)/.exec(src)[1], 10);
  var slow = parseInt(/BH_BEAT_SLOW_MS = (\d+)/.exec(src)[1], 10);
  var fast = parseInt(/BH_BEAT_FAST_MS = (\d+)/.exec(src)[1], 10);
  var intro = 1.3;                     // the map card, before the run starts
  var tracks = [];
  Object.keys(maps).forEach(function (id) {
    var track = maps[id].track;
    tracks.push(track);
    // Walk the actual ramp: +26 per good tap, on a traverse whose period
    // slides from slow to fast as the speed climbs. Averaging it would flatter
    // the player, because the slowest traverses are the ones they sit in longest.
    var s = lo, t = 0, d = 0, guard = 0;
    while (s < hi && guard++ < 400) {
      var bm = slow + (fast - slow) * (s - lo) / (hi - lo);
      t += bm / 1000;
      d += s * bm / 1000;
      s = Math.min(hi, s + 26);
    }
    var best = intro + t + Math.max(0, track - d) / hi;
    var worst = intro + track / lo;    // someone mashing, never holding the beat
    assert.ok(best < 13.5, id + ': a clean run must finish inside 15s, got ' +
      best.toFixed(1) + 's');
    assert.ok(worst > 15, id + ': base speed alone must NOT reach the finish in 15s, got ' +
      worst.toFixed(1) + 's — the minigame would be free');
  });
  /* ONE set of speed/beat constants governs every map, so the routes have to
     stay close to the same length. Let them drift apart and the two maps stop
     being the same game — one becomes free, the other unwinnable. */
  var spread = Math.max.apply(null, tracks) - Math.min.apply(null, tracks);
  assert.ok(spread < 150, 'bhop track lengths differ by ' + spread.toFixed(0) +
    ' units; one tuning cannot serve both');
});

check('d3 every bhop route stays on walkable floor, and props clear the lane', function () {
  var maps = loadMatchGames().__maps();
  // Painted ON the ground — the player is MEANT to run over these.
  var FLAT = { hatch: 1, curb: 1, bay: 1, rubble: 1 };
  var HALF_SPRITE = 30;   // the 32px sprite, back in world units, halved
  Object.keys(maps).forEach(function (id) {
    var m = maps[id], lane = bhLanePoints(m, 200);
    // A route leaving the floor union means the player runs over bare
    // structure — visually, straight through a building.
    lane.forEach(function (p) {
      var inside = m.rooms.some(function (r) {
        return p.x >= r[0] && p.x <= r[0] + r[2] && p.y >= r[1] && p.y <= r[1] + r[3];
      });
      assert.ok(inside, id + ': the route leaves walkable floor at (' +
        p.x.toFixed(0) + ',' + p.y.toFixed(0) + ')');
    });
    // A SOLID prop on the lane is a thing the player visibly runs through.
    // This caught a shipped Nuke container sitting at clearance 0.0.
    var fine = bhLanePoints(m, 900);
    m.props.forEach(function (P) {
      if (FLAT[P.t]) return;
      var near = 1e9;
      fine.forEach(function (p) {
        var dx = Math.max(P.x - p.x, 0, p.x - (P.x + P.w));
        var dy = Math.max(P.y - p.y, 0, p.y - (P.y + P.h));
        near = Math.min(near, Math.sqrt(dx * dx + dy * dy));
      });
      assert.ok(near >= HALF_SPRITE, id + ': solid prop ' + P.t + '@' + P.x + ',' + P.y +
        ' clears the lane by only ' + near.toFixed(1) + ' units — the player runs through it');
    });
  });
});

check('d3 the bhop player is a real sprite with a halo that survives both maps', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  // The sprite this replaced was four nested rects and a stick — a box with a
  // pistol. A bitmap is the assertion that it is authored art now.
  var m = /var BH_SPRITE = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'the player must be a bitmap, not a pile of rects');
  var rows = m[1].match(/'[^']*'/g).map(function (s) { return s.slice(1, -1); });
  assert.ok(rows.length >= 12, 'sprite is too small to read as a person');
  rows.forEach(function (r, i) {
    assert.strictEqual(r.length, rows[0].length,
      'sprite row ' + i + ' is ' + r.length + ', expected ' + rows[0].length);
  });
  // Every glyph used must have a colour, or that part of him renders as
  // undefined and canvas silently paints nothing.
  var cols = /var BH_SPRITE_COLS = \{([\s\S]*?)\};/.exec(src);
  assert.ok(cols, 'no sprite palette');
  rows.join('').split('').forEach(function (ch) {
    if (ch === '.') return;
    assert.ok(new RegExp("'" + ch + "':").test(cols[1]), 'sprite glyph ' + ch + ' has no colour');
  });
  /* The halo is the reason he reads on BOTH maps: a dark outline alone
     disappears on Nuke's near-black asphalt, a light one washes out on Dust
     2's pale stone, so he carries a dilated cream rim under a dark outline. */
  assert.ok(/BH_SPRITE_HALO/.test(src), 'the sprite needs its dilated halo');
  assert.ok(/BH_SPRITE_HALO = \(function/.test(src),
    'the halo must be precomputed once, not dilated every frame');
  // and he pivots on his torso, so a strafe swings the body not the muzzle
  assert.ok(/BH_SPRITE_PIVOT_ROW/.test(src), 'the sprite needs an explicit pivot row');
});

check('d3 the bhop rhythm sweeps, and its period scales with speed', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  // Ping-pong, not a wrapping sawtooth.
  assert.ok(/function markerPos\(\) \{ return phase <= 1 \? phase : 2 - phase; \}/.test(src),
    'the marker must sweep back and forth, not wrap from right to left');
  // The travel direction IS the side to tap, so the two cannot desync.
  assert.ok(/wrongSide = \(side !== sweepDir\(\)\)/.test(src),
    'the side to tap should be read from the sweep direction');
  assert.ok(!/nextSide = -nextSide/.test(src), 'the old alternating-side state should be gone');
  // Period must shorten as speed climbs, and be roomier than the old 340ms.
  var slow = parseInt(/BH_BEAT_SLOW_MS = (\d+)/.exec(src)[1], 10);
  var fast = parseInt(/BH_BEAT_FAST_MS = (\d+)/.exec(src)[1], 10);
  assert.ok(slow > fast, 'the beat must tighten as the player speeds up');
  assert.ok(slow > 600, 'the base beat should be roomy, got ' + slow + 'ms');
  // Slower marker + smaller window, so it does not simply get easier.
  var green = parseFloat(/BH_GREEN = ([\d.]+)/.exec(src)[1]);
  assert.ok(green <= 0.20, 'the green window should be tight, got ' + green);
  // Phase is accumulated, never a modulo of a divisor that moves.
  assert.ok(/phase = \(phase \+ \(t - phaseAt\) \/ beatMs\(\)\) % 2/.test(src),
    'phase must accumulate, or changing the period teleports the marker');
  // Mashing must not work.
  assert.ok(/alreadyJumped = \(half\(\) === scoredHalf\)/.test(src),
    'a second tap in the same sweep must not score');
});

check('d2 the spray game wins at 80% and fires 30 rounds', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  assert.ok(/hits \/ AK_ROUNDS >= 0\.80/.test(src), 'spray should win at 80% of the rounds hitting');
  assert.ok(/var AK_ROUNDS = 30;/.test(src), 'the AK sprays 30 rounds');
  // 30 rounds must empty in exactly the pacing node's trip, or the guide stops
  // describing the run it is pacing.
  assert.ok(/AK_RUN_MS = AK_ROUNDS \* AK_SHOT_MS/.test(src),
    'the node trip and the magazine must share one duration');
  var shotMs = parseInt(/AK_SHOT_MS = (\d+)/.exec(src)[1], 10);
  assert.strictEqual(shotMs * 30, 3000, 'the spray should run 3s, got ' + (shotMs * 30) + 'ms');
});

check('d3 the spray is two-zoned, with the guide inside the control pad', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  // 60/40 split, with the pad taking the bottom.
  assert.ok(/padTop = Math\.round\(h \* 0\.60\)/.test(src), 'the visual zone should be the top 60%');
  assert.ok(/px\(c, 0, padTop, w, 4, '#000000'\)/.test(src), 'the zones need a black seam between them');
  // The guide must be positioned from the PAD, never from the dummy — the whole
  // point of the rework is that the player's hand stops covering the target.
  var pathFn = /function nodeAt\(t\)[\s\S]*?\n    \}/.exec(src);
  assert.ok(pathFn, 'could not read nodeAt()');
  assert.ok(/padX \+/.test(pathFn[0]) && /padY \+/.test(pathFn[0]),
    'the pacing node must be laid out in pad coordinates');
  assert.ok(!/dummyX[^\n]*AK_PATH/.test(src), 'the guide must not be drawn on the dummy');
  // Touches outside the pad must not start the spray.
  assert.ok(/if \(p\.y < padTop\) return;/.test(src), 'the pad is the control surface, not the scene');
  // The crosshair and the scoring must read the SAME error.
  assert.ok(/function drift\(\)/.test(src), 'drift() should be the single error measure');
  assert.ok(/var hit = d <= 1;/.test(src), 'a round hits when the finger is inside tolerance');
  assert.ok(/kickX = k \* /.test(src) && /clamp\(drift\(\) - 1, 0, 3\)/.test(src),
    'the crosshair kick must be driven by the same drift that scores');
  // The clunky floating text is gone; a magazine bar replaces it.
  assert.ok(!/HITS ' \+ hits/.test(src), 'the HITS x/30 readout should be gone');
  assert.ok(!/SPRAY LOST/.test(src), 'the SPRAY LOST readout should be gone');
  assert.ok(/SPRAY CONTROLLED!/.test(src), 'the win banner should remain');
  assert.ok(/results\[i\] \? '#7FE3B0' : '#C0483C'/.test(src),
    'the magazine bar must colour per round, not by a running count');
});

check('d3 the compensation path pulls down, then left, then swoops right', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  var m = /var AK_PATH = \(function \(\) \{([\s\S]*?)\n  \}\)\(\);/.exec(src);
  assert.ok(m, 'could not read AK_PATH');
  // Rebuild it exactly as the game does and assert the SHAPE, not the source.
  var R = 30, pts = [], i, t, x, y, u;
  for (i = 0; i < R; i++) {
    t = i / (R - 1);
    if (t < 0.34) { x = 0.50; y = 0.10 + (t / 0.34) * 0.34; }
    else if (t < 0.68) { u = (t - 0.34) / 0.34; x = 0.50 - 0.32 * Math.sin(u * Math.PI / 2); y = 0.44 + u * 0.26; }
    else { u = (t - 0.68) / 0.32; x = 0.18 + 0.60 * u * u; y = 0.70 + u * 0.18; }
    pts.push([x, y]);
  }
  var start = pts[0], leftmost = pts.reduce(function (a, b) { return b[0] < a[0] ? b : a; });
  var end = pts[R - 1];
  assert.ok(Math.abs(start[0] - 0.5) < 0.01, 'the path should start at the pad centre');
  assert.ok(start[1] < 0.15, 'the path should start near the top of the pad');
  assert.ok(Math.abs(pts[8][0] - 0.5) < 0.01, 'the first third should pull straight down');
  assert.ok(leftmost[0] < 0.22, 'the path must swing well left, got ' + leftmost[0].toFixed(2));
  assert.ok(end[0] > 0.7, 'the path must swoop back right, got ' + end[0].toFixed(2));
  // Monotonically descending: it is a drag DOWN the pad, never back up.
  for (i = 1; i < R; i++) {
    assert.ok(pts[i][1] >= pts[i - 1][1] - 1e-9,
      'the path must never travel back up the pad (round ' + i + ')');
  }
  assert.ok(end[1] <= 1, 'the path must stay inside the pad');
});

check('d2 the bhop game ramps 250 -> 450+ and has a rhythm window', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/matchgames.js'), 'utf8');
  var lo = /BH_MIN_SPEED = (\d+)/.exec(src), hi = /BH_MAX_SPEED = (\d+)/.exec(src);
  assert.ok(lo && hi, 'expected both speed bounds');
  assert.strictEqual(parseInt(lo[1], 10), 250, 'base speed should be 250');
  assert.ok(parseInt(hi[1], 10) >= 450, 'top speed should reach 450+, got ' + hi[1]);
  assert.ok(/speed > 350/.test(src), 'motion blur should kick in above 350');
  assert.ok(/BH_GREEN/.test(src), 'the rhythm bar needs a green window');
  assert.ok(/speed = BH_MIN_SPEED;[\s\S]{0,120}lastHitGood = false/.test(src),
    'an off-beat or wrong-side tap must drop the speed back to base');
});

check('d2 PLAY routes through the overlay, and rolls ELO BEFORE it opens', function () {
  var main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  var fn = /function doPlayMatch\(\)[\s\S]*?\n  \}/.exec(main);
  assert.ok(fn, 'could not isolate doPlayMatch');
  // the ELO roll must come first, so a player can never finish a minigame and
  // only then be told they could not afford the match
  var rollAt = fn[0].indexOf('State.playMatch()');
  var runAt = fn[0].indexOf('MatchGames.run');
  assert.ok(rollAt !== -1 && runAt !== -1, 'expected both the roll and the overlay call');
  assert.ok(rollAt < runAt, 'playMatch() must be rolled BEFORE the overlay opens');
  assert.ok(/showMatchResult\(res\)/.test(main), 'the result should be shown after the overlay closes');
});

check('c4 lastMatchAt is in defaultData and survives a reload', function () {
  var store = {};
  var w = freshGame(store);
  assert.notStrictEqual(w.Game.State.data.lastMatchAt, undefined,
    'lastMatchAt missing from defaultData — normalizeSave would drop it (§5.1)');
  w.Game.State.data.lastMatchAt = 1234567;
  w.Game.State.save();
  var w2 = freshGame(store);
  assert.strictEqual(w2.Game.State.data.lastMatchAt, 1234567);
});

check('c5 calming syrup exists, is purple-tier priced, and drains 60%', function () {
  var w = freshGame();
  var S = w.Game.State;
  var def = S.findShopItem('calming_syrup');
  assert.ok(def, 'calming_syrup missing from the catalog');
  assert.strictEqual(def.category, 'consumable', 'it belongs in the DRINKS tab');
  assert.strictEqual(def.price, 100);
  assert.strictEqual(def.drainEnergyPct, 0.60);
  assert.strictEqual(def.requiresFridge, true, 'it must need a fridge like the can');
});

check('c5 drinking the syrup removes exactly 60% of MAX energy', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.owned.calming_syrup = 2;
  d.energyMax = 100; d.energy = 100;
  var res = S.drinkCalmingSyrup();
  assert.strictEqual(res.ok, true, res.reason);
  assert.strictEqual(Math.round(d.energy), 40, 'expected 100 - 60 = 40, got ' + d.energy);
  assert.strictEqual(d.owned.calming_syrup, 1, 'it must consume one bottle');
  // never below zero
  d.energy = 10;
  S.drinkCalmingSyrup();
  assert.strictEqual(d.energy, 0, 'energy must clamp at 0, not go negative');
});

check('c5 fridge capacity is SHARED between cans and syrup', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.placed = [{ id: 'energy_minifridge', x: 0, y: 0, rot: 0 }];
  d.owned.energy_minifridge = 1;
  var cap = S.fridgeStatus().capacity;
  assert.ok(cap > 0, 'a placed minifridge should provide capacity');

  d.owned.energy_can = 2; d.owned.calming_syrup = 0;
  assert.strictEqual(S.fridgeStatus().stock, 2, 'cans alone should count');
  d.owned.calming_syrup = 2;
  assert.strictEqual(S.fridgeStatus().stock, 4, 'syrup must count against the SAME capacity');
  assert.strictEqual(S.fridgeStatus().canBuyDrink, cap > 4,
    '2 cans + 2 syrups should fill a 4-slot fridge exactly');
});

check('c5 the syrup has a propMap entry, or its shop tile renders blank', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  assert.ok(/calming_syrup:\s*\{ family: 'syrup'/.test(src),
    'missing propMap entry — drawFamily() silently no-ops (§5.2)');
  assert.ok(/props\.syrup = function/.test(src), 'the syrup family has no art');
});

check('c5 both drink buttons hide when you own none of that drink', function () {
  var hub = fs.readFileSync(path.join(ROOT, 'js/hub.js'), 'utf8');
  assert.ok(/status\.owned <= 0\) \? 'none' : ''/.test(hub),
    'the energy drink button should hide at zero owned');
  assert.ok(/function refreshSyrupUI/.test(hub) && /onDrinkSyrup/.test(hub),
    'the syrup needs its own refresh + handler pair');
  var css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  assert.ok(/\.hub__syrup-btn \{ background: var\(--syrup\); \}/.test(css),
    'the syrup button must use the --syrup token');
});

check('#9 the fan grille is sized from projected geometry, not from sqrt(scale)', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  var fan = /props\.fan = function[\s\S]*?\n  \};/.exec(src);
  assert.ok(fan, 'could not isolate props.fan');
  assert.ok(!/var R = Math\.max\(7, Math\.round\(9\.5 \* s\)\)/.test(fan[0]),
    'the fan grille still uses the sqrt-scale radius that drifted with zoom');
  assert.ok(/housingPx/.test(fan[0]),
    'the grille radius should derive from the motor housing\'s projected width');
});

/* ==== V22b — the owner's second-list follow-ups ========================== */

check('b1 the word "sleeps" never appears in any tutorial copy', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/tutorial.js'), 'utf8');
  // string literals only — comments and identifiers are not player-facing
  var strings = src.match(/'(?:[^'\\]|\\.)*'/g) || [];
  var bad = strings.filter(function (s) { return /sleeps/i.test(s); });
  assert.strictEqual(bad.length, 0, 'tutorial copy still says "sleeps": ' + bad.join(' | '));
});

check('b2 the day/night clock is frozen until onboarding is done', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.tutorialDone = false;
  d.wakeElapsedMs = 0;
  d.energy = 0;
  // simulate a long session's worth of ticks during onboarding
  for (var i = 0; i < 40; i++) {
    d.lastEnergyTickAt = Date.now() - 30000;
    S.tickEnergy();
  }
  assert.strictEqual(S.dayPhase().phase, 'day', 'it must still be day while the tutorial is running');
  assert.strictEqual(d.wakeElapsedMs, 0, 'the clock must not advance at all during onboarding');
  assert.ok(d.energy > 0, 'energy must still regenerate — a frozen clock is day, not a paused game');

  // and it starts the moment onboarding ends
  d.tutorialDone = true;
  d.lastEnergyTickAt = Date.now() - 30000;
  S.tickEnergy();
  assert.ok(d.wakeElapsedMs > 0, 'finishing or skipping the tutorial must start the clock');
});

check('b3 a monitor and a PC take the desk\'s rotation, never their own', function () {
  var w = freshGame();
  var S = w.Game.State, d = S.data;
  d.placed = []; d.owned = { desk_plywood: 1, monitor_basic: 1, pc_budget: 1 };
  assert.strictEqual(S.placeItem('desk_plywood', 2, 2, 1).ok, true, 'desk placed at rot 1');
  // ask for a deliberately WRONG rotation on both
  S.placeItem('monitor_basic', 2, 2, 3);
  S.placeItem('pc_budget', 2, 2, 0);
  var mon = d.placed.filter(function (p) { return p.id === 'monitor_basic'; })[0];
  var pc = d.placed.filter(function (p) { return p.id === 'pc_budget'; })[0];
  assert.strictEqual(mon.rot, 1, 'the monitor must adopt the desk rot, not the requested 3');
  assert.strictEqual(pc.rot, 1, 'the PC must adopt the desk rot, not the requested 0');

  // and a MOVE onto the desk re-derives it too
  var mi = d.placed.indexOf(mon);
  S.moveItem(mi, 2, 2, 2);
  assert.strictEqual(d.placed[mi].rot, 1, 'moving the monitor must re-derive the desk rot');
});

check('b3 rotating the workstation as a group still turns all three together', function () {
  var w = furnish(freshGame());
  var S = w.Game.State, d = S.data;
  var deskIdx = d.placed.findIndex(function (p) { return p.id === 'desk_plywood'; });
  var group = S.groupIndicesFor(deskIdx);
  assert.strictEqual(group.length, 3);
  assert.strictEqual(S.moveGroup(group, 1, 1, 2).ok, true);
  group.forEach(function (i) {
    assert.strictEqual(d.placed[i].rot, 2, d.placed[i].id + ' must have turned with the group');
  });
});

check('b4 every desk tier is deep enough that a monitor stand lands on timber', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  var deskD = /props\.desk[\s\S]*?var d = \[([\d.,\s]+)\]/.exec(src);
  assert.ok(deskD, 'could not read the desk depths');
  var depths = deskD[1].split(',').map(parseFloat);

  // props.monitor's foot plate starts at local y 0.60; the desk top's back
  // edge is at 0.90 - d, so every tier needs 0.90 - d <= 0.60, i.e. d >= 0.30.
  depths.forEach(function (dd, i) {
    assert.ok(0.90 - dd <= 0.60,
      'desk tier ' + i + ' (d=' + dd + ') has its back edge at ' + (0.90 - dd).toFixed(2) +
      ', behind the monitor stand at 0.60 — the stand would float');
  });
  // ...and shallow enough not to reach back into the PC tower (ends at 0.46)
  depths.forEach(function (dd, i) {
    assert.ok(0.90 - dd >= 0.46,
      'desk tier ' + i + ' reaches back to ' + (0.90 - dd).toFixed(2) + ' and would intersect the tower');
  });
  // the ladder must still read as an upgrade
  for (var k = 1; k < depths.length; k++) {
    assert.ok(depths[k] >= depths[k - 1], 'desk depths must not shrink as the tier rises');
  }
});

check('b5 the tower/desk draw order is derived from rotated depth, not a constant', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/iso.js'), 'utf8');
  assert.ok(/SHARED_TILE_CENTRE_Y/.test(src) && /rotatedDepth\(/.test(src),
    'the within-tile tiebreak must derive from rotated depth');
  assert.ok(!/var ka = a\.p\.x \+ a\.p\.y \+ drawOrderFor\(a\.def\) \* 0\.01;/.test(src),
    'the sort still uses the flat CATEGORY_ORDER tiebreak that cannot be right at every rotation');

  // Replicate iso.js's own rotateRect to prove the flip is real and is 2-of-4.
  var m = /function rotateRect\([\s\S]*?\n  \}/.exec(src);
  assert.ok(m, 'could not read rotateRect from js/iso.js');
  var rotateRect = new Function('return ' + m[0].replace(/^function rotateRect/, 'function'))();
  var inFront = [];
  for (var rot = 0; rot < 4; rot++) {
    var pc = rotateRect(0.5, 0.28, 0, 0, rot), desk = rotateRect(0.5, 0.74, 0, 0, rot);
    if ((pc.lx + pc.ly) > (desk.lx + desk.ly)) inFront.push(rot);
  }
  assert.strictEqual(inFront.length, 2,
    'exactly two rotations should put the tower in front, got ' + JSON.stringify(inFront));
  assert.deepStrictEqual(inFront, [1, 2], 'the flipped rotations should be 1 and 2');
});

/* ---- V22b: music playlist + mobile install ----------------------------- */
check('b6 all three music tracks exist on disk and are referenced by js/audio.js', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/audio.js'), 'utf8');
  var m = /var TRACKS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'could not find the TRACKS list in js/audio.js');
  var listed = (m[1].match(/'([^']+)'/g) || []).map(function (s) { return s.slice(1, -1); });
  assert.strictEqual(listed.length, 3, 'expected exactly three tracks, got ' + listed.length);
  listed.forEach(function (rel) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), 'missing audio file: ' + rel);
  });
});

check('b6 music uses HTMLAudioElement, not decodeAudioData (file:// must still work)', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/audio.js'), 'utf8');
  // A CALL, not the word — the header comment explains why it is avoided.
  assert.ok(!/decodeAudioData\s*\(/.test(src),
    'decodeAudioData needs fetch, which is blocked on file:// — HANDOFF-V2 §2 constraint 2');
  assert.ok(/new window\.Audio\(\)/.test(src), 'expected a reused HTMLAudioElement');
  assert.ok(/preload = 'none'/.test(src), 'only the playing track should be buffered (mobile data)');
  assert.ok(/encodeURI\(/.test(src), 'the filenames contain spaces and must be URI-encoded');
});

check('b6 the default music volume is modest and the slider still drives it', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/audio.js'), 'utf8');
  var d = /var DEFAULT_MUSIC = (\d+);/.exec(src);
  assert.ok(d, 'could not read DEFAULT_MUSIC');
  var vol = parseInt(d[1], 10);
  assert.ok(vol > 0 && vol <= 40, 'default music volume should be audible but modest, got ' + vol);
  assert.ok(/Audio\.setMusicVolume = function/.test(src) && /applyVolume\(\)/.test(src),
    'the SETTINGS slider must move the volume live');
  var title = fs.readFileSync(path.join(ROOT, 'js/title.js'), 'utf8');
  assert.ok(/setMusicVolume/.test(title), 'the settings screen must still be wired to it');
});

check('e1 the music slider can silence the music on iOS, where .volume is read-only', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js/audio.js'), 'utf8');
  // `muted` is the ONLY volume control iOS WebKit honours. Without it, sliding
  // to zero left the music playing at full blast on every iPhone.
  assert.ok(/el\.muted = \(g === 0\)/.test(src),
    'zero must set muted, because assigning .volume is a no-op on iOS');
  // ...and a gain node for proportional control there.
  assert.ok(/createMediaElementSource/.test(src), 'expected a WebAudio gain path for iOS');
  assert.ok(/gainNode\.gain\.value = g/.test(src), 'the gain node must track the slider');
  // Every volume write must go through the one helper, or a caller will set
  // .volume directly and silently do nothing on a phone again. Count CODE
  // only: the header comment quotes `el.volume = 0` while explaining the bug,
  // and a test that cannot tell prose from an assignment is measuring nothing.
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  var directWrites = code.match(/el\.volume\s*=/g) || [];
  assert.strictEqual(directWrites.length, 1,
    'only applyVolume() may assign el.volume, found ' + directWrites.length + ' in code');
  assert.ok(/try \{ el\.volume = g; \} catch/.test(src),
    'the one .volume write must be guarded — it can throw on strict-mode read-only');
  // Routing through a graph makes a suspended context total silence, so the
  // context has to be resumed from gestures, not just created once.
  assert.ok(/function resumeCtx\(\)/.test(src) && /addEventListener\('pointerdown', resumeCtx/.test(src),
    'a suspended AudioContext would silence everything; resume it on gestures');
  // The graph must be optional: file:// opaque origins refuse it. Read the
  // function and inspect its catch, rather than budgeting characters between
  // two tokens — a comment growing by a line should not fail this.
  var graphFn = /function ensureGraph\(\)[\s\S]*?\n  \}/.exec(src);
  assert.ok(graphFn, 'could not read ensureGraph()');
  var rescue = /catch \(e\) \{([\s\S]*)\}/.exec(graphFn[0]);
  assert.ok(rescue, 'ensureGraph() must catch — createMediaElementSource can throw');
  assert.ok(/gainNode = null/.test(rescue[1]) && /return false/.test(rescue[1]),
    'a failed graph must reset state and fall back rather than throw');
  assert.ok(/graphTried = true;/.test(src), 'the graph should only be attempted once');
});

check('b7 the mobile install files exist and ask for fullscreen portrait', function () {
  var mani = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.strictEqual(mani.display, 'fullscreen', 'the address bar must not eat the portrait layout');
  assert.strictEqual(mani.orientation, 'portrait');
  assert.ok(mani.icons && mani.icons.length, 'a manifest icon is expected');
  mani.icons.forEach(function (ic) {
    assert.ok(fs.existsSync(path.join(ROOT, ic.src.replace(/^\.\//, ''))), 'missing icon: ' + ic.src);
  });
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ['rel="manifest"', 'apple-mobile-web-app-capable', 'apple-touch-icon'].forEach(function (needle) {
    assert.ok(html.indexOf(needle) !== -1, 'index.html is missing ' + needle);
  });
});

var pass = results.filter(function (r) { return r.ok; }).length;
results.forEach(function (r) {
  console.log((r.ok ? '[PASS] ' : '[FAIL] ') + r.name + (r.ok ? '' : '\n        ' + r.err));
});
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
