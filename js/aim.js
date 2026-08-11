/* ==========================================================================
   CS2 PRO SIMULATOR — js/aim.js
   Aim Trainer minigame. 10s reflex test -> daily form multiplier (SPEC-V5
   §4, continuous multiplier per SPEC-V6 §12). Attaches to window.Game.Aim.
   Registers screen 'aim' with Game.Router.

   Raw performance (accuracy, hits/misses, reaction time) is handed to
   Game.State.setFormFromPerformance(), which computes the 0..1.0 continuous
   multiplier and derives a letter grade from it purely as a display label
   (Data.formLabelForMult) — this module never chooses the grade itself. The
   hype bonus on S-rank and the save/emit('change') cycle stay owned by
   state.js.
   ========================================================================== */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};

  // Fix (SPEC-V2 Package A caveat): train cost is now legally 0 (free), which
  // is falsy — `|| 10` would silently reinstate the old cost. Use a `!= null`
  // check so 0 stays 0.
  var trainCostRaw = G.Data && G.Data.energyCosts ? G.Data.energyCosts.train : null;
  var COST_ENERGY = (trainCostRaw != null) ? trainCostRaw : 10;
  var SESSION_MS       = 10000; // SPEC-V5 §4: was 15s
  var R_MAX             = 32;   // px radius at spawn
  var R_MIN             = 10;   // px radius right before expiry
  var LIFETIME_START    = 1050; // ms a target survives at session start
  var LIFETIME_END      = 650;  // ms a target survives near session end
  var SPAWN_DELAY_MIN   = 140;
  var SPAWN_DELAY_MAX   = 380;

  // SPEC-V6 §12: the form multiplier is now a CONTINUOUS 0..1.0 function of
  // actual performance, computed and persisted by
  // Game.State.setFormFromPerformance() (accuracy / hit volume / reaction
  // time — see js/state.js's computeContinuousFormMult()). The letter grade
  // is only ever a DISPLAY LABEL derived from that multiplier via
  // Data.formLabelForMult() — never the source of it. GRADE_COLORS below is
  // purely this module's own presentation choice (duplicated in js/main.js's
  // nav button for the same reason it can't import this file), not a scoring
  // table.
  var GRADE_COLORS = {
    S: 'var(--gold)', A: 'var(--cash)', B: 'var(--views)',
    C: 'var(--energy)', D: 'var(--elo)', F: 'var(--danger)'
  };
  // score thresholds used ONLY by the defensive local fallback below when
  // Game.State.setFormFromPerformance isn't available (state.js is expected
  // to always own the real formula).
  var GRADE_THRESHOLDS = [
    { g: 'S', min: 0.88 },
    { g: 'A', min: 0.72 },
    { g: 'B', min: 0.55 },
    { g: 'C', min: 0.38 },
    { g: 'D', min: 0.20 },
    { g: 'F', min: 0.00 }
  ];
  var GRADE_FALLBACK_META = {
    S: { label: 'IN THE ZONE', mult: 1.00 },
    A: { label: 'LOCKED IN',   mult: 0.70 },
    B: { label: 'SOLID',       mult: 0.45 },
    C: { label: 'AVERAGE',     mult: 0.25 },
    D: { label: 'SHAKY',       mult: 0.10 },
    F: { label: 'TILTED',      mult: 0.00 }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // -- coach integration (SPEC-V2 §5a) ---------------------------------------
  // A hired coach auto-sets today's form at day start (state.js applies this
  // in endDay()). Training stays optional; the better of {coach, manual}
  // multiplier is what state.js keeps (State.setForm already implements the
  // comparison) — this module only needs to surface what's already true and
  // what a manual run would need to beat.
  function activeCoach() {
    return (G.State && typeof G.State.currentCoach === 'function') ? G.State.currentCoach() : null;
  }

  function todaysForm() {
    var d = G.State && G.State.data;
    if (!d || !d.form) return null;
    return (d.form.day === d.day) ? d.form : null;
  }

  function coachNoteHtml() {
    var coach = activeCoach();
    if (!coach) return '';
    var form = todaysForm();
    var mult = form ? form.mult : coach.formMult;
    return (
      '<div class="aim-coach-note panel">' +
        '<div class="aim-coach-note-title">' + escapeHtml(coach.name) + ' ON STAFF</div>' +
        '<div class="aim-coach-note-body">Today\'s form is already set to <b>' + escapeHtml(coach.formLabel) +
        '</b> (x' + mult.toFixed(2) + '). TRAIN is optional &mdash; only a manual run that beats x' +
        coach.formMult.toFixed(2) + ' will improve on it.</div>' +
      '</div>'
    );
  }

  function gradeFor(score) {
    for (var i = 0; i < GRADE_THRESHOLDS.length; i++) {
      if (score >= GRADE_THRESHOLDS[i].min) return GRADE_THRESHOLDS[i];
    }
    return GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
  }

  function gradeColor(letter) {
    return GRADE_COLORS[letter] || GRADE_COLORS.F;
  }

  // gradeMeta: label lookup only (ready-screen coach note / local fallback
  // below) — never used to pick today's actual grade/mult anymore.
  function gradeMeta(letter) {
    if (G.Data && G.Data.formGrades) {
      for (var i = 0; i < G.Data.formGrades.length; i++) {
        if (G.Data.formGrades[i].grade === letter) return G.Data.formGrades[i];
      }
    }
    var fb = GRADE_FALLBACK_META[letter] || GRADE_FALLBACK_META.F;
    return { grade: letter, label: fb.label, mult: fb.mult };
  }

  // persistForm (SPEC-V6 §12): the multiplier is now derived end-to-end from
  // actual performance via State.setFormFromPerformance({accuracy, hits,
  // misses, reactionMs}) — the letter grade State returns is only a label it
  // derived FROM that multiplier (Data.formLabelForMult), never chosen by
  // this module. The old State.setForm(grade) fixed per-grade snap is no
  // longer called from the play flow.
  function persistForm(perf) {
    if (G.State && typeof G.State.setFormFromPerformance === 'function') {
      return G.State.setFormFromPerformance(perf);
    }
    // defensive fallback only — state.js is expected to own this. Mirrors
    // computeContinuousFormMult()'s weights (accuracy 50% / volume 30%
    // capped at 40 hits / reaction 20% between 150-600ms) so the fallback
    // shape still matches in the unlikely case state.js hasn't loaded.
    if (G.State && G.State.data) {
      var accuracy = clamp(perf.accuracy != null ? perf.accuracy : 0, 0, 1);
      var volume = clamp((perf.hits || 0) / 40, 0, 1);
      var reactionMs = perf.reactionMs != null ? perf.reactionMs : 375;
      var reactionScore = clamp(1 - (reactionMs - 150) / 450, 0, 1);
      var mult = clamp(0.50 * accuracy + 0.30 * volume + 0.20 * reactionScore, 0, 1);
      var thr = gradeFor(mult);
      var meta = gradeMeta(thr.g);
      G.State.data.form = { grade: thr.g, label: meta.label, mult: mult, day: G.State.data.day, continuous: true };
      if (thr.g === 'S') G.State.data.hype = clamp((G.State.data.hype || 0) + 4, 0, 100);
      if (G.State.save) G.State.save();
      return G.State.data.form;
    }
    return null;
  }

  // -- module state (rebuilt every onEnter) --------------------------------
  var root = null;
  var playArea = null;
  var hud = null;
  var rafId = null;
  var running = false;
  var sess = null; // active session tracker

  function onEnter() {
    root = G.Router.root('aim');
    root.innerHTML = '';
    running = false;
    sess = null;
    buildReady();
  }

  function onExit() {
    stopLoop();
    running = false;
    sess = null;
    if (root) root.innerHTML = '';
    root = null;
    playArea = null;
    hud = null;
  }

  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // -- ready screen ---------------------------------------------------------
  function buildReady() {
    var wrap = document.createElement('div');
    wrap.className = 'mg-wrap aim-wrap';
    var costLabel = COST_ENERGY > 0 ? ('-' + COST_ENERGY + ' ENERGY') : 'FREE';
    wrap.innerHTML =
      '<div class="mg-header">' +
        '<button type="button" class="btn mg-back">&larr; BACK</button>' +
        '<div class="mg-title">AIM TRAINER</div>' +
        '<div class="mg-spacer"></div>' +
      '</div>' +
      '<div class="mg-ready panel">' +
        '<div class="mg-ready-icon aim-ready-icon">+</div>' +
        '<div class="mg-ready-title">10 SECOND FLICK TEST</div>' +
        '<div class="mg-ready-copy">Targets spawn and shrink fast. Tap them the instant they appear &mdash; ' +
        'the tighter your reaction and accuracy, the better your grade. ' +
        'Today\'s grade sets today\'s <b>form multiplier</b> for matches.</div>' +
        coachNoteHtml() +
        '<button type="button" class="btn mg-start-btn aim-start-btn">START TRAINING <span class="mg-cost">' + costLabel + '</span></button>' +
      '</div>';
    root.appendChild(wrap);
    wrap.querySelector('.mg-back').addEventListener('click', function () {
      G.UI.beep('click');
      G.Router.back();
    });
    wrap.querySelector('.aim-start-btn').addEventListener('click', startSession);
  }

  // -- play screen ------------------------------------------------------------
  function startSession() {
    var ok = G.State.useEnergy(COST_ENERGY);
    if (!ok) {
      G.UI.toast('NOT ENOUGH ENERGY', 'bad');
      return;
    }
    G.UI.beep('click');
    buildPlay();
    beginLoop();
  }

  function buildPlay() {
    root.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'mg-wrap aim-wrap';
    wrap.innerHTML =
      '<div class="aim-hud">' +
        '<div class="aim-stat"><span class="h-label">TIME</span><span class="aim-val" data-k="time">10.0</span></div>' +
        '<div class="aim-stat"><span class="h-label">HITS</span><span class="aim-val" data-k="hits">0</span></div>' +
        '<div class="aim-stat"><span class="h-label">ACC</span><span class="aim-val" data-k="acc">100%</span></div>' +
        '<div class="aim-stat"><span class="h-label">RT</span><span class="aim-val" data-k="rt">&mdash;</span></div>' +
      '</div>' +
      '<div class="aim-field"></div>';
    root.appendChild(wrap);
    playArea = wrap.querySelector('.aim-field');
    hud = {
      time: wrap.querySelector('[data-k="time"]'),
      hits: wrap.querySelector('[data-k="hits"]'),
      acc:  wrap.querySelector('[data-k="acc"]'),
      rt:   wrap.querySelector('[data-k="rt"]')
    };
    playArea.addEventListener('pointerdown', onPointerDown);
  }

  function beginLoop() {
    sess = {
      startTime: performance.now(),
      hits: 0,
      whiffs: 0,
      spawned: 0,
      reactions: [],
      target: null,
      nextSpawnAt: 0
    };
    running = true;
    spawnTarget();
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!running || !sess) return;
    var elapsed = now - sess.startTime;
    var remaining = Math.max(0, SESSION_MS - elapsed);
    if (hud) hud.time.textContent = (remaining / 1000).toFixed(1);

    if (sess.target) {
      var age = now - sess.target.spawnTime;
      var t = age / sess.target.lifetime;
      if (t >= 1) {
        removeTarget();
        scheduleSpawn(now);
      } else {
        var r = R_MAX - (R_MAX - R_MIN) * t;
        var tgt = sess.target;
        tgt.r = r;
        var d = r * 2;
        tgt.el.style.width = d + 'px';
        tgt.el.style.height = d + 'px';
        tgt.el.style.left = (tgt.cx - r) + 'px';
        tgt.el.style.top = (tgt.cy - r) + 'px';
        tgt.el.style.opacity = String(0.5 + 0.5 * (1 - t));
      }
    } else if (sess.nextSpawnAt && now >= sess.nextSpawnAt) {
      spawnTarget();
    }

    if (elapsed >= SESSION_MS) {
      endSession();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function spawnTarget() {
    if (!playArea || !sess) return;
    var rect = playArea.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    var progress = clamp((performance.now() - sess.startTime) / SESSION_MS, 0, 1);
    var lifetime = LIFETIME_START - (LIFETIME_START - LIFETIME_END) * progress;
    var r = R_MAX;
    var pad = R_MAX + 4;
    var cx = pad + Math.random() * Math.max(1, (w - pad * 2));
    var cy = pad + Math.random() * Math.max(1, (h - pad * 2));
    var el = document.createElement('div');
    el.className = 'aim-target';
    el.style.width = (r * 2) + 'px';
    el.style.height = (r * 2) + 'px';
    el.style.left = (cx - r) + 'px';
    el.style.top = (cy - r) + 'px';
    playArea.appendChild(el);
    sess.target = { el: el, cx: cx, cy: cy, r: r, spawnTime: performance.now(), lifetime: lifetime };
    sess.spawned++;
  }

  function removeTarget() {
    if (!sess || !sess.target) return;
    var el = sess.target.el;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    sess.target = null;
  }

  function scheduleSpawn(now) {
    if (!sess) return;
    sess.nextSpawnAt = now + SPAWN_DELAY_MIN + Math.random() * (SPAWN_DELAY_MAX - SPAWN_DELAY_MIN);
  }

  function spawnFx(cls, x, y) {
    if (!playArea) return;
    var fx = document.createElement('div');
    fx.className = cls;
    fx.style.left = x + 'px';
    fx.style.top = y + 'px';
    playArea.appendChild(fx);
    fx.addEventListener('animationend', function () {
      if (fx.parentNode) fx.parentNode.removeChild(fx);
    });
  }

  function onPointerDown(e) {
    if (!running || !sess || !playArea) return;
    var rect = playArea.getBoundingClientRect();
    var cx = (typeof e.clientX === 'number') ? e.clientX : 0;
    var cy = (typeof e.clientY === 'number') ? e.clientY : 0;
    var x = cx - rect.left;
    var y = cy - rect.top;
    var tgt = sess.target;
    var hit = false;
    if (tgt) {
      var dx = x - tgt.cx, dy = y - tgt.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= tgt.r) hit = true;
    }
    if (hit) {
      var rt = performance.now() - tgt.spawnTime;
      sess.reactions.push(rt);
      sess.hits++;
      spawnFx('aim-fx-hit', tgt.cx, tgt.cy);
      G.UI.beep('hit');
      removeTarget();
      scheduleSpawn(performance.now());
    } else {
      sess.whiffs++;
      spawnFx('aim-fx-miss', x, y);
      G.UI.beep('miss');
    }
    updateHud();
  }

  function updateHud() {
    if (!hud || !sess) return;
    hud.hits.textContent = String(sess.hits);
    var taps = sess.hits + sess.whiffs;
    var acc = taps > 0 ? Math.round(100 * sess.hits / taps) : 100;
    hud.acc.textContent = acc + '%';
    if (sess.reactions.length) {
      var avg = sess.reactions.reduce(function (a, b) { return a + b; }, 0) / sess.reactions.length;
      hud.rt.textContent = Math.round(avg) + 'ms';
    } else {
      hud.rt.textContent = '—';
    }
  }

  function endSession() {
    running = false;
    stopLoop();
    if (!sess) return;
    if (sess.target) removeTarget();

    var taps = sess.hits + sess.whiffs;
    var accuracy = taps > 0 ? sess.hits / taps : 0;
    var hasReactions = sess.reactions.length > 0;
    var avgReaction = hasReactions
      ? sess.reactions.reduce(function (a, b) { return a + b; }, 0) / sess.reactions.length
      : null;

    // SPEC-V6 §12: hand the raw performance straight to State — the
    // multiplier (and, from it, the letter grade) is computed there by
    // State.setFormFromPerformance/computeContinuousFormMult, continuous
    // across 0..1.0. This module no longer buckets a score into a grade
    // itself; gradeFor()/GRADE_THRESHOLDS above only back the defensive
    // fallback inside persistForm() for when State isn't available at all.
    var formResult = persistForm({ accuracy: accuracy, hits: sess.hits, misses: sess.whiffs, reactionMs: avgReaction });
    var grade = formResult ? formResult.grade : 'F';
    var mult = formResult ? formResult.mult : 0;
    var label = formResult ? formResult.label : gradeMeta(grade).label;
    // formResult.manualGrade is only set when today's pre-existing form
    // (e.g. a coach's auto-form) beat this manual run — see
    // State.setFormFromPerformance in state.js (SPEC-V2 §5a: "the better of
    // the two multipliers applies", now compared as continuous multipliers).
    var coachKept = !!(formResult && formResult.manualGrade);
    var coach = activeCoach();

    showResult(
      { g: grade, label: label, mult: mult, color: gradeColor(grade), coachKept: coachKept, coach: coach },
      { accuracy: accuracy, hits: sess.hits, spawned: sess.spawned, avgReaction: avgReaction }
    );

    sess = null;
  }

  function showResult(grade, stats) {
    if (root) root.innerHTML = '';

    // SPEC-V6 §12: the multiplier is the headline number — the letter grade
    // is shown as a derived label next to it, not the other way around.
    var lines = [
      'ACCURACY: ' + Math.round(stats.accuracy * 100) + '%',
      'TARGETS HIT: ' + stats.hits + '/' + stats.spawned,
      'AVG REACTION: ' + (stats.avgReaction !== null ? Math.round(stats.avgReaction) + 'ms' : '—'),
      'GRADE: ' + grade.g + ' (' + grade.label + ')'
    ];
    if (grade.g === 'S') lines.push('+4 HYPE — SCOUTS ARE WATCHING');
    if (grade.coach) {
      lines.push(grade.coachKept
        ? (grade.coach.name + '\'S FORM WAS BETTER — KEPT')
        : 'YOU OUT-TRAINED THE COACH!');
    }

    G.UI.beep(grade.g === 'S' ? 'rare' : (grade.g === 'F' ? 'miss' : 'click'));

    // Title leads with the real multiplier (the actual source of truth per
    // SPEC-V6 §12); the letter grade + label is shown as a derived subtitle.
    G.UI.rewardCard({
      title: 'x' + grade.mult.toFixed(2) + ' FORM MULTIPLIER',
      subtitle: grade.g + ' — ' + grade.label,
      lines: lines,
      color: grade.color,
      onClose: function () { G.Router.back(); }
    });

    if (grade.g === 'S' || grade.g === 'A') {
      var anchor = document.getElementById('modal-layer') || root;
      if (anchor && G.UI.confetti) G.UI.confetti(anchor, grade.color);
    }
  }

  if (G.Router && G.Router.register) {
    G.Router.register('aim', { onEnter: onEnter, onExit: onExit });
  }

  G.Aim = {
    COST_ENERGY: COST_ENERGY,
    SESSION_MS: SESSION_MS
  };
})();
