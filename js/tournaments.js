/* ==========================================================================
   CS2 PRO SIMULATOR — js/tournaments.js
   Game.Tournaments — the tournament calendar + bracket (SPEC-V4 §6, timing
   REWORKED SPEC-V6 §9: one match per real day, next event 7 days after a
   loss or a win). PURE RENDERER over Game.State.tournamentStatus()/
   playTournamentMatch()/canPlayTournamentMatchToday()/tournamentHistory()/
   nextTournamentInDays() — no bracket/points/day-gating math here.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};

  var TIER_COLOR = { 1: 'var(--gold)', 2: 'var(--views)', 3: 'var(--cash)' };
  var PLACEMENT_COLOR = {
    CHAMPION: 'var(--gold)', 'RUNNER-UP': 'var(--views)',
    SEMIFINALIST: 'var(--cash)', QUARTERFINALIST: 'var(--ink-dim)', 'GROUP STAGE': 'var(--ink-dim)'
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- icons
     Authored SVG only (ART-DIRECTION §2.5) — 24x24 viewBox, currentColor,
     the house set js/phone.js established. No emoji, no Unicode glyph doing
     icon duty anywhere in this file.

     Rendered at 10px next to a 700-weight number, so this pair is a FILLED
     silhouette rather than a 2px outline — the same call js/teams.js makes
     for its 9px rank arrows, and for the same reason: 2/24 of 10px is 0.83
     device pixels and vanishes. Sized by attribute; .tourn__delta-val's
     rules live in css/teams.css, which this package does not own.

     Colour is not the only channel separating them. Beyond the obvious
     apex-up vs apex-down flip, the shaft hangs BELOW the head on the riser
     and sits ABOVE it on the faller, so the two are distinguishable as
     black shapes with the green and red taken away. */
  var ICON_RANK_UP =
    '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">' +
      '<path d="M12 2.6l8.2 9h-4.6V21H8.4v-9.4H3.8z" fill="currentColor"/>' +
    '</svg>';
  var ICON_RANK_DOWN =
    '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">' +
      '<path d="M12 21.4l-8.2-9h4.6V3h7.2v9.4h4.6z" fill="currentColor"/>' +
    '</svg>';

  /* The ↑/↓ these replace were the only thing telling a screen reader which
     way a team moved — "3" alone is not a direction, and the green/red tint
     is not spoken. So the SVG is aria-hidden and the word rides along in a
     .sr-only span (css/style.css), giving "up 3" / "down 3".

     Visually-hidden text rather than aria-label or role="img" + <title>:
     naming an <svg> is still unevenly honoured across screen readers, a
     hidden span is spoken by all of them, and the icon markup stays
     byte-identical to the house set in js/phone.js. */
  function rankDelta(cls, up, places) {
    var e = el('span', 'icon-inline icon-inline--end ' + cls);
    e.innerHTML = up ? ICON_RANK_UP : ICON_RANK_DOWN;
    e.appendChild(el('span', 'sr-only', up ? ' up ' : ' down '));
    e.appendChild(document.createTextNode(String(places)));
    return e;
  }

  function logoForEntry(entry) {
    if (!entry) return null;
    if (entry.isYou) return G.State.myTeam() || entry;
    return G.State.teamById(entry.id) || entry;
  }

  function roundLabel(t, r) {
    var fromFinal = t.totalRounds - 1 - r;
    if (fromFinal <= 0) return 'FINAL';
    if (fromFinal === 1) return 'SEMIFINAL';
    if (fromFinal === 2) return 'QUARTERFINAL';
    return 'ROUND ' + (r + 1);
  }

  /* ======================================================================
     §6 — MATCH ANIMATION: pure sequence/timing logic, no DOM. State has
     ALREADY decided (yourScore, oppScore) via State.playTournamentMatch();
     everything below only synthesises a plausible round-by-round path to
     that fixed final score for display. It never feeds back into state.
     ====================================================================== */
  var FLAVOUR_LINES = [
    'ECO WIN', 'CLUTCH 1v3', 'ACE', 'FORCE BUY HELD', 'PISTOL ROUND',
    'RETAKE', '4K', 'NINJA DEFUSE', 'ENTRY FRAG', 'DOUBLE KILL',
    'SAVE ROUND', 'ANTI-ECO'
  ];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // shuffledRun: `aN` copies of aTag and `bN` of bTag in random order.
  function shuffledRun(aTag, aN, bTag, bN) {
    var pool = [];
    var i;
    for (i = 0; i < aN; i++) pool.push(aTag);
    for (i = 0; i < bN; i++) pool.push(bTag);
    for (i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool;
  }

  // MR12, the same rules state.js's rollMatchScore() generates against.
  var REG_WIN = 13;   // regulation ends the instant someone reaches this
  var REG_TIE = 12;   // ...unless BOTH reach this, which is the only road to OT

  /* buildRoundSequence: from the REAL final (yourScore, oppScore), returns an
     array of 'you'/'opp' tags, one per round, length === yourScore+oppScore.
     The array also carries `.overtimeAt` — the index where overtime begins, or
     -1 for a regulation match.

     Guarantees: (a) the final tally equals the real score exactly, (b) the
     last entry is the winner, and (c) EVERY PREFIX IS A SCORELINE THAT COULD
     ACTUALLY OCCUR IN MR12.

     (c) is the fix. This used to shuffle all rounds together in one pool,
     which meant an overtime match could animate the loser reaching 13 while
     the winner sat on 10 — a scoreline that ends the match two rounds
     earlier in real CS2. A playtester reported seeing "10-13" and then the
     match carrying on to 16, which read as the game deciding to go to
     overtime out of nowhere. It was never the stored score that was wrong;
     state.js only ever produces legal finals. It was this display path
     inventing an impossible route to them.

     So the two phases are built SEPARATELY: regulation can only be shuffled
     up to 12-12 (or up to 12 vs the loser's sub-13 total), and overtime rounds
     are appended after it. */
  function buildRoundSequence(yourScore, oppScore) {
    var winnerIsYou = yourScore >= oppScore;
    var winnerTag = winnerIsYou ? 'you' : 'opp';
    var loserTag = winnerIsYou ? 'opp' : 'you';
    var winnerFinal = winnerIsYou ? yourScore : oppScore;
    var loserFinal = winnerIsYou ? oppScore : yourScore;
    var seq, overtimeAt = -1;

    if (winnerFinal > REG_WIN) {
      // Overtime. Regulation MUST have finished exactly 12-12 — there is no
      // other way for a match to continue past 13.
      seq = shuffledRun(winnerTag, REG_TIE, loserTag, REG_TIE);
      overtimeAt = seq.length;
      // Then the OT rounds only, winner's clincher held back to the end.
      seq = seq.concat(shuffledRun(
        winnerTag, (winnerFinal - REG_TIE) - 1,
        loserTag, loserFinal - REG_TIE
      ));
    } else {
      // Regulation: the winner's last round is the one that reaches 13, so it
      // is held back; the loser can never exceed 11 here, which is what keeps
      // every prefix legal without any extra checking.
      seq = shuffledRun(winnerTag, winnerFinal - 1, loserTag, loserFinal);
    }
    seq.push(winnerTag);
    seq.overtimeAt = overtimeAt;
    return seq;
  }

  // computeTiming: perRound = clamp(6500/totalRounds, 170, 400)ms, plus
  // fixed intro/halftime/matchpoint/outro beats and a slowed final round.
  // If the sum would exceed the 10s hard budget, perRound is scaled down
  // until it fits (measured, not assumed — see the test harness output).
  function computeTiming(totalRounds) {
    var perRound = clamp(6500 / totalRounds, 170, 400);
    var introDur = 700, outroDur = 600, matchPointDur = 600, halftimeDur = 700;
    var hasHalftime = totalRounds > 12;
    function finalDurFor(pr) { return Math.min(pr * 2, pr + 400); }
    var finalRoundDur = finalDurFor(perRound);
    var fixed = introDur + outroDur + matchPointDur + (hasHalftime ? halftimeDur : 0);
    var total = fixed + perRound * (totalRounds - 1) + finalRoundDur;

    if (total > 10000) {
      var budget = 10000 - fixed;
      var pr = budget / (totalRounds - 1 + 2); // final round weighted ~2x
      perRound = Math.max(60, pr);
      finalRoundDur = finalDurFor(perRound);
      total = fixed + perRound * (totalRounds - 1) + finalRoundDur;
      var guard = 0;
      while (total > 10000 && perRound > 40 && guard < 200) {
        perRound -= 5;
        finalRoundDur = finalDurFor(perRound);
        total = fixed + perRound * (totalRounds - 1) + finalRoundDur;
        guard++;
      }
    }
    return {
      perRound: perRound, finalRoundDur: finalRoundDur,
      introDur: introDur, outroDur: outroDur, matchPointDur: matchPointDur,
      halftimeDur: hasHalftime ? halftimeDur : 0, hasHalftime: hasHalftime,
      total: total
    };
  }

  // buildSchedule: turns the round sequence into an ordered, timestamped
  // list of beats (intro / round / halftime / matchpoint / outro), each
  // carrying its own duration. A single driver later walks this list
  // against elapsed wall-clock time — see startMatchAnimation().
  function buildSchedule(sequence, timing, winnerTag, winnerFinal) {
    var steps = [];
    var t = 0;
    function push(type, dur, payload) {
      var step = { type: type, t: t, dur: dur };
      if (payload) for (var k in payload) step[k] = payload[k];
      steps.push(step);
      t += dur;
    }
    push('intro', timing.introDur);

    var runningWinner = 0;
    var matchPointShown = false;
    var lastFlavourIdx = -99;
    var streakSide = null, streakLen = 0;

    for (var i = 0; i < sequence.length; i++) {
      var side = sequence[i];
      var isLast = (i === sequence.length - 1);
      var dur = isLast ? timing.finalRoundDur : timing.perRound;

      if (side === streakSide) streakLen++; else { streakSide = side; streakLen = 1; }
      var streak = streakLen >= 3 ? { side: side, len: streakLen } : null;

      var flavour = null;
      if (!streak && (i - lastFlavourIdx) > 1 && Math.random() < 0.28) {
        flavour = FLAVOUR_LINES[Math.floor(Math.random() * FLAVOUR_LINES.length)];
        lastFlavourIdx = i;
      }

      push('round', dur, { index: i, side: side, flavour: flavour, streak: streak, isLast: isLast });

      if (side === winnerTag) runningWinner++;
      if (!matchPointShown && runningWinner === winnerFinal - 1 && !isLast) {
        push('matchpoint', timing.matchPointDur);
        matchPointShown = true;
      }
      if (i === 11 && timing.hasHalftime) {
        push('halftime', timing.halftimeDur);
      }
      // Regulation just ended 12-12. Announce it, because otherwise the score
      // simply carries on past 13 with no explanation — which is what made the
      // old broken sequences read as the game inventing overtime at random.
      // sequence.overtimeAt is -1 for a regulation match, so this never fires
      // there; buildRoundSequence owns that value.
      if (sequence.overtimeAt > 0 && i === sequence.overtimeAt - 1) {
        push('overtime', timing.halftimeDur);
      }
    }
    push('outro', timing.outroDur);
    return steps;
  }

  /* -------------------------------------------------------------- DOM shell */
  function buildDom() {
    var root = G.Router.root('tournaments');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">TOURNAMENTS</span><button class="btn screen-header__back" id="tourn-back">BACK</button></div>' +
      '<div class="tourn" id="tourn-body"></div>';
    els.body = document.getElementById('tourn-body');
    document.getElementById('tourn-back').addEventListener('click', function () {
      G.UI.beep('click');
      // §20 — only career.js routes here, so BACK should return to CAREER,
      // not fall through to Router.back()'s hard-coded hub.
      G.Router.go('career');
    });
    built = true;
  }

  /* ======================================================================
     §6 — MATCH ANIMATION overlay DOM. Built ONCE, lazily, and appended to
     #app (same containing block as #modal-layer, so `position:absolute;
     inset:0` bounds correctly both in the phone-frame preview and on a
     real 420x860 device). Every subsequent match reuses this same DOM —
     only text/classes are updated per run. The SKIP button in particular
     is created exactly once here and never rebuilt or repositioned again,
     per the project's documented multi-tap bug (a button whose DOM node
     was rebuilt/repositioned mid-touch).
     ====================================================================== */
  var matchOverlayBuilt = false;
  var matchEls = {};

  function buildMatchOverlayDom() {
    if (matchOverlayBuilt) return;
    var appRoot = document.getElementById('app') || document.body;

    var overlay = el('div', 'tourn-match-overlay');
    var panel = el('div', 'tourn-match');
    overlay.appendChild(panel);

    panel.appendChild(el('div', 'tourn-match__event'));

    var board = el('div', 'tourn-match__scoreboard');
    var sideYou = el('div', 'tourn-match__side');
    var logoYou = el('div', 'tourn-match__logo-slot');
    var nameYou = el('div', 'tourn-match__name');
    sideYou.appendChild(logoYou);
    sideYou.appendChild(nameYou);

    var scoreWrap = el('div', 'tourn-match__score');
    var scoreYouNum = el('span', 'tourn-match__score-num', '0');
    var scoreSep = el('span', 'tourn-match__score-sep', ':');
    var scoreOppNum = el('span', 'tourn-match__score-num', '0');
    scoreWrap.appendChild(scoreYouNum);
    scoreWrap.appendChild(scoreSep);
    scoreWrap.appendChild(scoreOppNum);

    var sideOpp = el('div', 'tourn-match__side');
    var logoOpp = el('div', 'tourn-match__logo-slot');
    var nameOpp = el('div', 'tourn-match__name');
    sideOpp.appendChild(logoOpp);
    sideOpp.appendChild(nameOpp);

    board.appendChild(sideYou);
    board.appendChild(scoreWrap);
    board.appendChild(sideOpp);
    panel.appendChild(board);

    var pips = el('div', 'tourn-match__pips');
    panel.appendChild(pips);

    var beat = el('div', 'tourn-match__beat');
    panel.appendChild(beat);

    var banner = el('div', 'tourn-match__banner');
    panel.appendChild(banner);

    // Built once. Never rebuilt, never repositioned. onClick set exactly
    // here, exactly once.
    var skipBtn = el('button', 'btn tourn-match__skip', 'SKIP');
    skipBtn.type = 'button';
    skipBtn.addEventListener('click', function () {
      G.UI.beep('click');
      skipMatchAnimation();
    });
    panel.appendChild(skipBtn);

    appRoot.appendChild(overlay);

    matchEls = {
      overlay: overlay, event: overlay.querySelector('.tourn-match__event') || panel.firstChild,
      logoYou: logoYou, nameYou: nameYou, logoOpp: logoOpp, nameOpp: nameOpp,
      scoreYou: scoreYouNum, scoreOpp: scoreOppNum,
      pips: pips, beat: beat, banner: banner, skip: skipBtn
    };
    matchOverlayBuilt = true;
  }

  /* --------------------------------------------------------- free-agent state */
  function renderFreeAgent() {
    // §9 — was hardcoded "every 14 days"; the real cadence is
    // Data.tournamentIntervalSleeps (7, since one match/day replaced the
    // old same-day full-bracket resolution) and one match is played per
    // day rather than the whole event resolving instantly.
    var interval = G.Data.tournamentIntervalSleeps || 7;
    var wrap = el('div', 'panel tourn__empty');
    wrap.appendChild(el('div', 'tourn__calendar-title', 'NO TEAM, NO BRACKET'));
    wrap.appendChild(el('div', 'tourn__empty-text', 'Sign with a team to enter the tournament calendar. Every signed team plays a real event every ' + interval + ' days, one match per day — win it, and your team’s rank moves with the result.'));
    var btn = el('button', 'btn btn--primary', 'GO TO CAREER');
    btn.addEventListener('click', function () { G.UI.beep('click'); G.Router.go('career'); });
    wrap.appendChild(btn);
    els.body.appendChild(wrap);
  }

  /* ------------------------------------------------------------- calendar */
  function renderCalendar(myTeam, live, daysLeft) {
    var cfg = (G.Data.tournamentTiers || {})[myTeam.tier];
    var interval = G.Data.tournamentIntervalSleeps || 7;
    var panel = el('div', 'panel tourn__calendar');
    panel.appendChild(el('div', 'tourn__calendar-title', cfg ? cfg.event : 'NEXT EVENT'));
    if (live) {
      // §9 — one match per real day: distinguish "go play it" from
      // "already played today, sleep to unlock the next one".
      var gate = G.State.canPlayTournamentMatchToday();
      panel.appendChild(el('div', 'tourn__calendar-live', gate.canPlay
        ? 'EVENT LIVE — PLAY IT OUT BELOW'
        : 'EVENT LIVE — NEXT MATCH UNLOCKS TOMORROW'));
    } else {
      var elapsed = interval - daysLeft;
      var pct = Math.max(0, Math.min(100, (elapsed / interval) * 100));
      panel.appendChild(el('div', 'tourn__calendar-sub',
        (cfg ? (cfg.field + '-TEAM FIELD · ' + G.UI.money(cfg.prizePool) + ' PRIZE POOL · ') : '') +
        'NEXT EVENT IN ' + daysLeft + ' DAY' + (daysLeft === 1 ? '' : 'S')));
      var strip = el('div', 'tourn__strip');
      var tick = el('div', 'tourn__strip-tick');
      var fill = el('div', 'tourn__strip-tick-fill');
      fill.style.width = pct + '%';
      tick.appendChild(fill);
      strip.appendChild(tick);
      panel.appendChild(strip);
      panel.appendChild(el('div', 'tourn__calendar-sub', 'ONE EVENT EVERY ' + interval + ' DAYS — USE THE TIME TO TRAIN AND SCRIM.'));
    }
    els.body.appendChild(panel);
  }

  /* --------------------------------------------------------- next-match card */
  function findPlayerMatch(t) {
    var round = t.bracket[t.bracket.length - 1];
    for (var i = 0; i < round.length; i++) {
      var m = round[i];
      if (!m.done && ((m.a && m.a.isYou) || (m.b && m.b.isYou))) return m;
    }
    return null;
  }

  function buildMatchSide(entry) {
    var side = el('div', 'tourn__nextmatch-side');
    var team = logoForEntry(entry);
    side.appendChild(G.Teams.renderLogo(team, 'lg'));
    side.appendChild(el('div', 'tourn__nextmatch-name', entry.isYou ? 'YOU' : entry.name));
    side.appendChild(el('div', 'tourn__nextmatch-rank', '#' + entry.rank));
    return side;
  }

  // §9 — one match per real day: a win advances the bracket internally
  // right away, but the new match isn't playable until State.data.day
  // moves (i.e. after a sleep). Gate the button on the same pre-flight
  // check State.playTournamentMatch() itself uses, so the UI never shows
  // an enabled PLAY that's about to fail with 'already-played-today'.
  function renderNextMatch(t) {
    var match = findPlayerMatch(t);
    if (!match) return;
    var gate = G.State.canPlayTournamentMatchToday();
    var panel = el('div', 'panel tourn__nextmatch');
    els.nextMatchPanel = panel;
    panel.appendChild(el('div', 'tourn__nextmatch-event', t.event + ' — ' + roundLabel(t, t.bracket.length - 1)));
    var vs = el('div', 'tourn__nextmatch-vs');
    vs.appendChild(buildMatchSide(match.a));
    vs.appendChild(el('div', 'tourn__nextmatch-x', 'VS'));
    vs.appendChild(buildMatchSide(match.b));
    panel.appendChild(vs);
    if (gate.canPlay) {
      var playBtn = el('button', 'btn btn--primary tourn__playbtn', 'PLAY MATCH');
      playBtn.addEventListener('click', onPlayMatch);
      panel.appendChild(playBtn);
    } else {
      var playedEl = el('div', 'tourn__playbtn tourn__playbtn--locked', 'MATCH PLAYED FOR TODAY');
      G.UI.setDisabled(playedEl, true);
      panel.appendChild(playedEl);
      panel.appendChild(el('div', 'tourn__nextmatch-lockedsub', 'NEXT MATCH TOMORROW'));
    }
    els.body.appendChild(panel);
  }

  /* ------------------------------------------------------------- bracket ---- */
  function matchSideEl(entry, match) {
    var cls = 'tourn__match-side';
    if (match.done) {
      cls += (match.winner === entry) ? ' tourn__match-side--winner' : ' tourn__match-side--loser';
    }
    var wrap = el('div', cls);
    if (entry) {
      wrap.appendChild(G.Teams.renderLogo(logoForEntry(entry), 'sm'));
      wrap.appendChild(el('span', 'tourn__match-name', entry.isYou ? 'YOU' : entry.name));
    } else {
      wrap.appendChild(el('span', 'tourn__match-name', 'TBD'));
    }
    return wrap;
  }

  function renderBracket(t) {
    var header = el('div', 'tourn__section-header', 'BRACKET');
    els.body.appendChild(header);
    var wrap = el('div', 'tourn__bracket');
    t.bracket.forEach(function (round, r) {
      var roundEl = el('div', 'tourn__round');
      roundEl.appendChild(el('div', 'tourn__round-label', roundLabel(t, r)));
      round.forEach(function (m) {
        var involvesYou = (m.a && m.a.isYou) || (m.b && m.b.isYou);
        var cls = 'tourn__match' + (involvesYou ? ' tourn__match--you' : '') + (!m.done ? ' tourn__match--pending' : '');
        var mEl = el('div', cls);
        mEl.appendChild(matchSideEl(m.a, m));
        // A finished Bo3 shows the SERIES (2:1), not the last map's rounds —
        // "16 : 13" in a bracket cell would read as the whole final.
        var cellScore = 'VS';
        if (m.done) {
          cellScore = ((m.bestOf || 1) > 1)
            ? (m.mapsA + ' : ' + m.mapsB)
            : (m.scoreA + ' : ' + m.scoreB);
        }
        mEl.appendChild(el('div', 'tourn__match-score', cellScore));
        mEl.appendChild(matchSideEl(m.b, m));
        roundEl.appendChild(mEl);
      });
      wrap.appendChild(roundEl);
    });
    els.body.appendChild(wrap);
  }

  /* ------------------------------------------------------- result + deltas -- */
  function renderResult(t) {
    var panel = el('div', 'panel tourn__result');
    panel.style.setProperty('--reward-accent', PLACEMENT_COLOR[t.placement] || 'var(--ink)');
    panel.appendChild(el('div', 'tourn__calendar-sub', t.event));
    var place = el('div', 'tourn__result-placement', t.placement);
    place.style.color = PLACEMENT_COLOR[t.placement] || 'var(--ink)';
    panel.appendChild(place);
    panel.appendChild(el('div', 'tourn__result-prize', 'PRIZE ' + G.UI.money(t.prizeWon)));
    if (t.rankDelta != null) {
      var dTxt = t.rankDelta === 0 ? 'RANK UNCHANGED' : (t.rankDelta < 0 ? ('YOUR TEAM CLIMBED ' + Math.abs(t.rankDelta) + ' RANKS') : ('YOUR TEAM SLID ' + t.rankDelta + ' RANKS'));
      var dColor = t.rankDelta === 0 ? 'var(--ink-dim)' : (t.rankDelta < 0 ? 'var(--cash)' : 'var(--danger)');
      var dEl = el('div', 'tourn__calendar-sub', dTxt);
      dEl.style.color = dColor;
      dEl.style.fontWeight = '700';
      panel.appendChild(dEl);
    }
    els.body.appendChild(panel);

    // rank delta for every OTHER team in that bracket that actually moved —
    // t.field carries each entry's rank as of the moment the bracket rolled,
    // so that's a clean "before" snapshot with no extra state needed here.
    var rows = [];
    (t.field || []).forEach(function (entry) {
      if (entry.isYou || !entry.id) return;
      var now = G.State.teamById(entry.id);
      if (!now) return;
      var delta = now.rank - entry.rank;
      if (delta === 0) return;
      rows.push({ name: entry.name, delta: delta });
    });
    if (rows.length) {
      rows.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
      els.body.appendChild(el('div', 'tourn__section-header', 'OTHER TEAMS THAT MOVED'));
      var list = el('div', 'panel tourn__delta-list');
      rows.slice(0, 12).forEach(function (row) {
        var r = el('div', 'tourn__delta-row');
        r.appendChild(el('span', 'tourn__delta-name', row.name));
        var up = row.delta < 0;   // rank NUMBER falling is the team RISING
        var cls = up ? 'tourn__delta-val--up' : 'tourn__delta-val--down';
        r.appendChild(rankDelta('tourn__delta-val ' + cls, up, Math.abs(row.delta)));
        list.appendChild(r);
      });
      els.body.appendChild(list);
    }
  }

  function renderHistory() {
    var hist = G.State.tournamentHistory().slice().reverse().slice(0, 8);
    if (!hist.length) return;
    els.body.appendChild(el('div', 'tourn__section-header', 'RECENT RESULTS'));
    var panel = el('div', 'panel');
    hist.forEach(function (h) {
      var row = el('div', 'tourn__history-row');
      var ev = el('div', 'tourn__history-event');
      ev.appendChild(el('span', 'tourn__history-event-name', h.event));
      ev.appendChild(el('span', 'tourn__history-day', 'DAY ' + h.day));
      row.appendChild(ev);
      var place = el('div', 'tourn__history-placement', h.placement);
      place.style.color = PLACEMENT_COLOR[h.placement] || 'var(--ink)';
      row.appendChild(place);
      panel.appendChild(row);
    });
    els.body.appendChild(panel);
  }

  /* ======================================================================
     §6 — MATCH ANIMATION driver. ONE setInterval (never a setTimeout chain,
     never rAF — rAF throttles to 0fps in a backgrounded tab and would
     freeze the animation mid-match). It walks the pre-built `schedule`
     against elapsed wall-clock time (Date.now()), so the pacing is exact
     regardless of how often the interval actually fires.
     ====================================================================== */
  var matchAnim = null; // non-null while an animation is running

  function pulseScoreNode(node) {
    node.classList.remove('tourn-match__score-num--pulse');
    void node.offsetWidth; // force reflow so the animation retriggers
    node.classList.add('tourn-match__score-num--pulse');
  }

  /* A pip is CREATED when its round resolves, already coloured — the strip
     grows as the match goes rather than sitting there pre-filled with blanks.

     The overlay used to render all `sequence.length` pips empty up front, and
     that number is the total round count, which is the final score. At 4-0
     with ten empty pips left there is exactly one scoreline that fits (13-1),
     so the match was decided in the player's head before the animation had
     said anything. Now the total is unknowable until the last round lands. */
  function appendPip(side) {
    matchEls.pips.appendChild(el('div', 'tourn-match__pip tourn-match__pip--' + side));
  }

  // Used by the skip path, which jumps straight to the finished strip.
  function renderAllPips(sequence) {
    matchEls.pips.innerHTML = '';
    for (var i = 0; i < sequence.length; i++) appendPip(sequence[i]);
  }

  function showBanner(text, extraCls) {
    matchEls.banner.textContent = text;
    matchEls.banner.className = 'tourn-match__banner tourn-match__banner--show' + (extraCls ? ' ' + extraCls : '');
  }
  function hideBanner() {
    matchEls.banner.className = 'tourn-match__banner';
  }

  // No totalRounds parameter any more, deliberately: this function used to
  // take it purely to pre-render that many empty pips, which leaked the final
  // score (see appendPip above). It now starts the strip empty.
  function resetMatchOverlay(eventName, youTeam, oppTeam, oppEntry) {
    matchEls.event.textContent = eventName || '';
    matchEls.logoYou.innerHTML = '';
    matchEls.logoYou.appendChild(G.Teams.renderLogo(youTeam, 'lg'));
    matchEls.nameYou.textContent = 'YOU';
    matchEls.logoOpp.innerHTML = '';
    matchEls.logoOpp.appendChild(G.Teams.renderLogo(oppTeam, 'lg'));
    matchEls.nameOpp.textContent = (oppEntry && oppEntry.name) || 'OPPONENT';
    matchEls.scoreYou.textContent = '0';
    matchEls.scoreOpp.textContent = '0';
    matchEls.beat.textContent = '';
    hideBanner();
    matchEls.pips.innerHTML = '';
  }

  function applyStep(step, anim) {
    switch (step.type) {
      case 'intro':
        matchEls.overlay.classList.add('tourn-match-overlay--in');
        break;
      case 'round':
        hideBanner();
        if (step.side === 'you') {
          anim.scoreYou++;
          matchEls.scoreYou.textContent = anim.scoreYou;
          pulseScoreNode(matchEls.scoreYou);
        } else {
          anim.scoreOpp++;
          matchEls.scoreOpp.textContent = anim.scoreOpp;
          pulseScoreNode(matchEls.scoreOpp);
        }
        appendPip(step.side);
        if (step.streak) {
          matchEls.beat.textContent = (step.streak.side === 'you' ? 'YOU' : matchEls.nameOpp.textContent) +
            ' ON A ' + step.streak.len + '-ROUND STREAK';
        } else if (step.flavour) {
          matchEls.beat.textContent = (step.side === 'you' ? 'YOU: ' : matchEls.nameOpp.textContent + ': ') + step.flavour;
        } else {
          matchEls.beat.textContent = '';
        }
        break;
      case 'halftime':
        matchEls.beat.textContent = '';
        showBanner('HALFTIME — SIDES SWAP', 'tourn-match__banner--halftime');
        break;
      case 'matchpoint':
        matchEls.beat.textContent = '';
        showBanner('MATCH POINT', 'tourn-match__banner--matchpoint');
        break;
      case 'overtime':
        matchEls.beat.textContent = '';
        // Reuses the halftime banner styling — same role (a break in play the
        // player did not trigger), and inventing a third banner treatment for
        // one more beat would be exactly the kind of drift ART-DIRECTION warns
        // about. The wording carries the difference.
        showBanner('12-12 — OVERTIME', 'tourn-match__banner--halftime');
        break;
      case 'outro':
        hideBanner();
        matchEls.beat.textContent = '';
        break;
    }
  }

  function stopMatchInterval() {
    if (matchAnim && matchAnim.intervalId != null) {
      clearInterval(matchAnim.intervalId);
      matchAnim.intervalId = null;
    }
  }

  function hideMatchOverlay() {
    if (matchEls.overlay) matchEls.overlay.classList.remove('tourn-match-overlay--open', 'tourn-match-overlay--in');
  }

  function tickMatchAnimation() {
    if (!matchAnim) return;
    var elapsed = Date.now() - matchAnim.startTime;
    while (matchAnim.idx < matchAnim.schedule.length && matchAnim.schedule[matchAnim.idx].t <= elapsed) {
      applyStep(matchAnim.schedule[matchAnim.idx], matchAnim);
      matchAnim.idx++;
    }
    if (matchAnim.idx >= matchAnim.schedule.length) completeMatchAnimation();
  }

  function completeMatchAnimation() {
    stopMatchInterval();
    var cb = matchAnim && matchAnim.onComplete;
    matchAnim = null;
    hideMatchOverlay();
    if (typeof cb === 'function') cb();
  }

  // SKIP — non-negotiable per the brief. Jumps straight to the real final
  // score (already decided by State) and proceeds exactly like a natural
  // finish would.
  function skipMatchAnimation() {
    if (!matchAnim) return;
    stopMatchInterval();
    matchEls.scoreYou.textContent = matchAnim.finalYou;
    matchEls.scoreOpp.textContent = matchAnim.finalOpp;
    renderAllPips(matchAnim.sequence);
    hideBanner();
    matchEls.beat.textContent = '';
    var cb = matchAnim.onComplete;
    matchAnim = null;
    hideMatchOverlay();
    if (typeof cb === 'function') cb();
  }

  // Defensive cleanup for onExit / a fresh start — clears any interval
  // left running without firing the completion callback.
  function cancelMatchAnimation() {
    stopMatchInterval();
    matchAnim = null;
    hideMatchOverlay();
  }

  function startMatchAnimation(opts) {
    buildMatchOverlayDom();
    cancelMatchAnimation(); // defensively clear before starting a new one

    var sequence = buildRoundSequence(opts.yourScore, opts.oppScore);
    var winnerTag = opts.yourScore >= opts.oppScore ? 'you' : 'opp';
    var winnerFinal = winnerTag === 'you' ? opts.yourScore : opts.oppScore;
    var timing = computeTiming(sequence.length);
    var schedule = buildSchedule(sequence, timing, winnerTag, winnerFinal);

    resetMatchOverlay(opts.eventName, opts.youTeam, opts.oppTeam, opts.oppEntry);
    matchEls.overlay.classList.add('tourn-match-overlay--open');

    matchAnim = {
      schedule: schedule, idx: 0, startTime: Date.now(),
      scoreYou: 0, scoreOpp: 0,
      finalYou: opts.yourScore, finalOpp: opts.oppScore,
      sequence: sequence, onComplete: opts.onComplete,
      intervalId: null
    };
    matchAnim.intervalId = setInterval(tickMatchAnimation, 40);
  }

  /* -------------------------------------------------------------- playing --- */
  // §9 — distinct copy for 'already-played-today' ("come back tomorrow")
  // vs. every other not-ok reason, per the checklist.
  var PLAY_FAIL_MSG = {
    'already-played-today': 'ALREADY PLAYED TODAY — COME BACK TOMORROW',
    'no-tournament': 'NO TOURNAMENT RUNNING RIGHT NOW',
    'no-player-match': 'NO MATCH TO PLAY RIGHT NOW'
  };
  // Guards a rapid double-tap of PLAY MATCH: true for the entire span from
  // the tap through the animation through the reward-card flow closing.
  var matchInFlight = false;

  function onPlayMatch() {
    if (matchInFlight || matchAnim) return;
    matchInFlight = true;

    var res = G.State.playTournamentMatch();
    if (!res.ok) {
      matchInFlight = false;
      G.UI.beep('miss');
      G.UI.toast(PLAY_FAIL_MSG[res.reason] || 'NO MATCH TO PLAY RIGHT NOW', 'bad');
      render();
      return;
    }
    var match = res.match;
    var side = match.a.isYou ? 'a' : 'b';
    var you = match[side];
    var opp = match[side === 'a' ? 'b' : 'a'];
    var yourScore = side === 'a' ? match.scoreA : match.scoreB;
    var oppScore = side === 'a' ? match.scoreB : match.scoreA;
    var t = G.State.tournamentStatus();

    startMatchAnimation({
      eventName: t ? t.event : '',
      youTeam: logoForEntry(you),
      oppTeam: logoForEntry(opp),
      oppEntry: opp,
      yourScore: yourScore,
      oppScore: oppScore,
      onComplete: function () {
        finishPlayMatch(res, opp, yourScore, oppScore);
      }
    });
  }

  function finishPlayMatch(res, opp, yourScore, oppScore) {
    // A Bo3 final (SPEC: tier 1/2) is stepped one MAP per day, so `res` can
    // describe a map inside a series that is still live. Distinguish the two:
    // "MATCH WON" over a 1-0 series would claim a final the player has not
    // actually won yet.
    var isSeries = (res.bestOf || 1) > 1;
    var seriesLive = !!res.seriesLive;
    var wonThis = seriesLive ? !!res.youWonMap : !!res.youWon;

    G.UI.beep(wonThis ? 'cash' : 'miss');
    // Confetti is for taking the SERIES, not for going 1-0 up in one.
    if (res.youWon && !seriesLive && els.nextMatchPanel) G.UI.confetti(els.nextMatchPanel, 'var(--cash)');

    var lines = [{
      label: isSeries ? 'MAP SCORE' : 'SCORE',
      value: yourScore + ' : ' + oppScore,
      color: wonThis ? 'var(--cash)' : 'var(--danger)'
    }];
    if (isSeries) {
      lines.push({
        label: 'SERIES (BO' + res.bestOf + ')',
        value: res.yourMaps + ' : ' + res.oppMaps,
        color: (res.yourMaps > res.oppMaps) ? 'var(--cash)' : (res.yourMaps < res.oppMaps ? 'var(--danger)' : 'var(--ink)')
      });
    }
    if (res.tournamentComplete) {
      lines.push({ label: 'PLACEMENT', value: res.placement, color: PLACEMENT_COLOR[res.placement] || 'var(--ink)' });
      lines.push({ label: 'PRIZE', value: G.UI.money(res.prize), color: 'var(--cash)' });
    }

    var title;
    if (seriesLive) title = wonThis ? 'MAP WON' : 'MAP LOST';
    else if (isSeries) title = res.youWon ? 'SERIES WON' : 'SERIES LOST';
    else title = res.youWon ? 'MATCH WON' : 'MATCH LOST';

    G.UI.rewardCard({
      title: title,
      subtitle: 'vs ' + opp.name,
      color: wonThis ? 'var(--cash)' : 'var(--danger)',
      lines: lines,
      buttonText: res.tournamentComplete ? 'SEE RESULT' : (seriesLive ? 'NEXT MAP' : 'NEXT MATCH'),
      onClose: function () {
        matchInFlight = false;
        var t = G.State.tournamentStatus();
        if (res.tournamentComplete && res.placement === 'CHAMPION' && t && t.tier === 1) {
          celebrateMajor(t);
        } else {
          render();
        }
      }
    });
  }

  function celebrateMajor(t) {
    G.UI.beep('rare');
    G.UI.confetti(document.body, 'var(--gold)');
    G.UI.rewardCard({
      title: 'MAJOR CHAMPION',
      subtitle: t.event,
      color: 'var(--gold)',
      lines: [
        { label: 'PRIZE', value: G.UI.money(t.prizeWon), color: 'var(--cash)' },
        { label: 'STATUS', value: 'PERMANENT MAJOR CHAMPION', color: 'var(--gold)' }
      ],
      buttonText: 'ETERNAL GLORY',
      onClose: function () { render(); }
    });
  }

  /* ------------------------------------------------------------------ main -- */
  function render() {
    if (!G.State.data) return;
    els.body.innerHTML = '';
    els.nextMatchPanel = null;

    if (G.State.data.majorChampion) {
      els.body.appendChild(el('div', 'tourn__major-champion', 'MAJOR CHAMPION — PERMANENT'));
    }

    if (G.State.data.contract === 'free') {
      renderFreeAgent();
      return;
    }

    var myTeam = G.State.myTeam();
    var t = G.State.tournamentStatus();
    var live = !!(t && !t.done);
    var daysLeft = G.State.nextTournamentInDays();

    if (myTeam) renderCalendar(myTeam, live, daysLeft || 0);

    if (live) {
      renderNextMatch(t);
      renderBracket(t);
    } else if (t && t.done) {
      renderResult(t);
    }

    renderHistory();
  }

  G.Router = G.Router || {};
  G.Router.register('tournaments', {
    onEnter: function () {
      if (!built) buildDom();
      render();
    },
    // §6 — clear any running match-animation interval defensively on the
    // way out, so nothing keeps ticking against a torn-down screen.
    //
    // matchInFlight MUST be released here too. It is otherwise only cleared
    // by the reward card's onClose, which never runs if the player navigates
    // away mid-animation — leaving the flag latched true forever and turning
    // PLAY MATCH into a permanent silent no-op for the rest of the session
    // (HANDOFF §9.6: a tap that does nothing reads as broken). The match
    // itself is already resolved and committed by State.playTournamentMatch()
    // before the animation ever starts, so nothing is lost by leaving early —
    // the bracket shows the real score on re-entry.
    //
    // Released HERE rather than inside cancelMatchAnimation(), because
    // startMatchAnimation() calls that helper defensively one line after
    // matchInFlight is set — resetting it in there would clear the
    // double-tap guard at the exact moment it is needed.
    onExit: function () {
      cancelMatchAnimation();
      matchInFlight = false;
    }
  });

  G.Tournaments = { ready: true };
})(window.Game = window.Game || {});
