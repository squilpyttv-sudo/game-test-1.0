/* ==========================================================================
   CS2 PRO SIMULATOR — js/clutch.js
   Game.Clutch — THE CLUTCH: AWP on Dust 2 B site (SPEC-V23-QUESTS.md §5).

   THE INVERTED RULE (§1 of the spec — read this before touching anything).
   js/matchgames.js's header says its minigames "may NEVER decide whether a
   match is won" — playMatch() has already rolled the ELO result before that
   overlay opens, and the minigame is pure pacing and theatre on top of it.

   THIS MODULE DOES THE EXACT OPPOSITE, ON PURPOSE. A quest is opt-in side
   content off the critical path (State.acceptInvite() must not, and does
   not, pre-roll a result — see js/state.js and js/email.js). THE CLUTCH is
   the decider: whatever the player actually does with the AWP is what
   State.resolveInvite(id, won) gets called with. This is deliberate and is
   the whole point of the feature — quests are the first place in the game
   where mechanical skill pays out directly. Do NOT "fix" this to match
   matchgames.js's ordering.

   THE VERB — a positional TAP, not matchgames.js's reaction tap (awp), drag
   (spray) or alternating taps (bhop). You tap a place on the site; the AWP
   flicks there, scopes, and fires. Sharing one of those three verbs would
   make this read as a reskin (matchgames.js header) — this one is about
   WHERE, not WHEN or HOW FAST you move.

   THE TWO RULES THAT MAKE THE VERB REAL:
     1. Flick time is FLICK_MIN_MS..FLICK_MAX_MS, SCALED BY DISTANCE. A flat
        flick time would make crosshair placement irrelevant on a touchscreen
        (a far tap is exactly as fast as a near one otherwise) and collapse
        this into whack-a-mole. If the flick is ever made constant, that is
        the regression — see §5.1 of the spec.
     2. The bolt cycle (BOLT_MIN_MS..BOLT_MAX_MS) runs after EVERY shot, hit
        or miss, and NO enemy peeks during it. That single rule is the
        owner's requested breather, the reason a miss is lethal (whiff and
        the gun is locked while the next guy who WOULD have peeked is simply
        held off-screen instead), and the thing that stops spam-tapping.
        There is deliberately no separate miss penalty layered on top of it.

   ART — first-person Dust 2 B site from the defender's eye, five peek
   angles anchored to real cover (tunnels, B doors, car, back platform,
   hole), the AWP viewmodel bottom-right as js/matchgames.js's spray game
   holds its AK. All flat rects on canvas, no image assets (HANDOFF-V2 §2),
   no emoji or glyph icons. Colour literals are correct here for the same
   reason they are in js/iso.js and js/matchgames.js: canvas cannot read CSS
   variables.

   TIMING — wall-clock (Date.now()) throughout, never frame-accumulated (the
   dt-accumulator trap: a dropped frame rate would stretch the tell out of
   step with the peek it warns about). The one legitimate dt-style integral
   is the flick's on-screen travel, which is computed from elapsed wall time
   against the flick's own start/end timestamps every frame, not summed.

   The tell, the peek and the hitbox all read ANGLE_DEFS — ONE array. A
   second copy is how a tell ends up describing a different angle from the
   one that opens (the exact failure mode the spec calls out in §5.4).
   ========================================================================== */
(function (G) {
  'use strict';

  /* ---------------------------------------------------------- tuning (owner-set) */
  var FLICK_MIN_MS = 150;   // a tap essentially on the crosshair
  var FLICK_MAX_MS = 250;   // a tap right across the site
  var BOLT_MIN_MS  = 1000;
  var BOLT_MAX_MS  = 1500;
  var TELL_MS      = 600;
  var DEATH_MS     = 450;   // how long dying takes to READ, not a grace period
  var ROUNDS_TO_WIN = 2;    // best of 3
  var ANGLE_COUNT  = 5;

  // Pacing beats that are NOT in the spec's constant list because they carry
  // no gameplay stakes — they only give the fixed banners ("ROUND WON" etc.)
  // a beat to be read before the next thing starts, the same job WIN_HOLD_MS
  // does in js/matchgames.js.
  var ROUND_PAUSE_MS = 950;
  var MATCH_END_HOLD_MS = 950;

  function now() { return Date.now(); }
  function beep(k) { if (G.UI && G.UI.beep) G.UI.beep(k); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------------------------------------------------------- RNG seam
     A tiny deterministic PRNG (mulberry32) so __force(seed) can reproduce an
     exact angle sequence for the suite, without pulling in Math.random's
     unseedable global state. Ordinary play seeds off the wall clock, so
     nothing here changes gameplay feel — only testability. */
  var rngState = (Date.now() ^ 0x9E3779B9) >>> 0;
  function seedRng(seed) { rngState = (seed >>> 0) || 1; }
  function rng() {
    rngState = (rngState + 0x6D2B79F5) | 0;
    var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* =====================================================================
     THE ANGLES — the single source of truth (spec §5.4).
     gx/gy/gw/gh are fractions of the canvas, so the same rect drives the
     footstep tell's label, the peek's silhouette placement AND the shot's
     hitbox. Nothing downstream ever re-derives a second copy of "where this
     angle is".

     `cover` is the wall/architecture tone painted around each gap; the gap
     itself is always GAP_SHADOW — a doorway or window seen from outside is
     the darkest thing on the site regardless of what the wall around it is
     made of, which is what keeps the contrast reliable across five very
     different cover materials (stone, wood, concrete). Luminance is the
     standard NTSC luma (0.299R + 0.587G + 0.114B, 0-255 scale); the gap sits
     at ~19.9 and every cover tone below is measured and reported in the
     verification pass — see the report at the end of this session, and
     test-v23-quests.js item 13. */
  var GAP_SHADOW = '#171310';
  var ANGLE_DEFS = [
    { id: 'tunnels',  label: 'TUNNELS',   gx: 0.035, gy: 0.300, gw: 0.165, gh: 0.300, cover: '#7c6b4a' },
    { id: 'bdoors',   label: 'B DOORS',   gx: 0.290, gy: 0.260, gw: 0.190, gh: 0.460, cover: '#6b4a2e' },
    { id: 'car',      label: 'CAR',       gx: 0.560, gy: 0.400, gw: 0.190, gh: 0.300, cover: '#7a7d78' },
    { id: 'backplat', label: 'BACK PLAT', gx: 0.790, gy: 0.160, gw: 0.180, gh: 0.420, cover: '#8a8f86' },
    { id: 'hole',     label: 'HOLE',      gx: 0.030, gy: 0.660, gw: 0.130, gh: 0.120, cover: '#8f7a52' }
  ];

  function pickAngle(prevIdx) {
    // No immediate repeat — the same rule js/matchgames.js's pickGame() and
    // pickMap() apply, for the same reason: a naive roll self-repeats often
    // enough (1 in ANGLE_COUNT) to read as broken rather than random.
    if (ANGLE_COUNT <= 1) return 0;
    var idx;
    do { idx = Math.floor(rng() * ANGLE_COUNT); } while (idx === prevIdx);
    return idx;
  }

  function angleRectPx(def, w, h) {
    return { x: def.gx * w, y: def.gy * h, w: def.gw * w, h: def.gh * h };
  }
  function pointInRect(px2, py2, r) {
    return px2 >= r.x && px2 <= r.x + r.w && py2 >= r.y && py2 <= r.y + r.h;
  }

  /* ---------------------------------------------------------------------- shell */
  var root = null, canvas = null, ctx = null, labelEl = null, bannerEl = null;
  var rafId = null;
  var W = 0, H = 0;
  var active = false;
  var onDone = null;

  function build() {
    if (root) return;
    root = document.createElement('div');
    // Reuses js/matchgames.js's `.mg-match` chrome (css/minigames.css) — that
    // block is generic full-bleed-overlay-over-#app styling, not owned by
    // matchgames.js's rotation of three games, so borrowing it here costs no
    // CSS and stays inside "js/clutch.js is the only file this package
    // touches" (SPEC-V23-QUESTS.md §2 ownership table has no css/clutch.css).
    root.className = 'mg-match';
    root.id = 'clutch-overlay';
    root.innerHTML =
      '<div class="mg-match__label" id="clutch-label">THE CLUTCH — B SITE</div>' +
      '<canvas class="mg-match__canvas" id="clutch-canvas"></canvas>' +
      '<div class="mg-match__banner" id="clutch-banner"></div>';
    var host = document.getElementById('app') || document.body;
    host.appendChild(root);

    canvas = document.getElementById('clutch-canvas');
    ctx = canvas.getContext('2d');
    labelEl = document.getElementById('clutch-label');
    bannerEl = document.getElementById('clutch-banner');

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      onTap(pt(e));
    });
  }

  function pt(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  function sizeCanvas() {
    // Measure the CANVAS's own box, not the overlay's — V22d's exact trap.
    // The overlay also carries the label row, so it is taller than the
    // canvas; sizing off it gives the backing store more rows than the
    // element displays and the browser squashes every frame to fit.
    var r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width));
    canvas.height = Math.max(1, Math.round(r.height));
    W = canvas.width; H = canvas.height;
    ctx.imageSmoothingEnabled = false;
  }

  function setBanner(text, kind) {
    bannerEl.textContent = text || '';
    bannerEl.className = 'mg-match__banner' + (text ? ' mg-match__banner--show' : '') +
      (kind ? ' mg-match__banner--' + kind : '');
  }

  /* -------------------------------------------------------------- draw helpers */
  function px(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x | 0, y | 0, Math.ceil(w), Math.ceil(h)); }
  function pixelText(c, text, x, y, size, col, align) {
    c.fillStyle = col;
    c.font = '700 ' + size + 'px ui-monospace, Menlo, Consolas, monospace';
    c.textAlign = align || 'left';
    c.textBaseline = 'middle';
    c.fillText(text, x, y);
    c.textAlign = 'left';
  }

  /* ======================================================================
     ROUND / ATTACKER STATE MACHINE

     Per attacker: tell -> peek -> (tap) -> flicking -> hit(bolt) | miss(dead)
     Per round: attackers down one at a time; last one down wins the round.
     Per LAN: best of 3 rounds, first to ROUNDS_TO_WIN takes it.
     ====================================================================== */
  var enemiesPerRound = 3, exposeMs = 700;
  var currentRound = 1, roundsWon = 0, roundsLost = 0;
  var roundResults = [];          // pushed ONLY at the moment a round resolves —
                                   // this is what keeps the pips from leaking a
                                   // result before it is shown (spec §5.5, the
                                   // exact bug js/tournaments.js shipped once).
  var attackersRemaining = 0;
  var lastAngleIdx = -1;
  var angleIdx = -1;

  // state: 'tell' | 'peek' | 'flicking' | 'bolt' | 'dead' | 'roundPause' | 'matchEnd'
  var state = 'tell';
  var tellEnd = 0;
  var peekStart = 0, exposeEnd = 0;
  var aimX = 0, aimY = 0;                       // resting crosshair position
  var flickFrom = null, flickTo = null, flickStart = 0, flickEnd = 0;
  var boltStart = 0, boltEnd = 0, boltRoundWon = false;
  var deathStart = 0, deathEnd = 0;
  var pauseEnd = 0;
  var killfeedUntil = 0, muzzleFlashUntil = 0;
  var boltThrowT = 0;                            // live, for the bolt-handle animation

  function resetMatch(opts) {
    enemiesPerRound = (opts && opts.enemies) || 3;
    exposeMs = (opts && opts.exposeMs) || 700;
    currentRound = 1; roundsWon = 0; roundsLost = 0;
    roundResults = [];
    lastAngleIdx = -1;
    killfeedUntil = 0; muzzleFlashUntil = 0;
    startRound();
  }

  function startRound() {
    attackersRemaining = enemiesPerRound;
    aimX = W / 2; aimY = H / 2;
    setBanner('');
    spawnAttacker();
  }

  function spawnAttacker() {
    angleIdx = pickAngle(lastAngleIdx);
    lastAngleIdx = angleIdx;
    state = 'tell';
    tellEnd = now() + TELL_MS;
  }

  function onTap(p) {
    if (!active) return;
    if (state === 'tell') {
      // "You may re-aim during it" (spec §5.3.1) — a free, instant
      // reposition. No flick timer, no bolt, no consequence: this is
      // preparation, not the shot. The timed flick+fire sequence is
      // reserved for a tap while the enemy is actually exposed, below.
      aimX = p.x; aimY = p.y;
      return;
    }
    if (state !== 'peek') return;   // flicking/bolt/dead/pause: gun is busy
    var from = { x: aimX, y: aimY };
    var dist = Math.hypot(p.x - from.x, p.y - from.y);
    var maxDist = Math.hypot(W, H) || 1;
    var t = clamp(dist / maxDist, 0, 1);
    var ms = FLICK_MIN_MS + t * (FLICK_MAX_MS - FLICK_MIN_MS);
    flickFrom = from;
    flickTo = { x: p.x, y: p.y };
    flickStart = now();
    flickEnd = flickStart + ms;
    state = 'flicking';
  }

  function resolveFlickShot() {
    aimX = flickTo.x; aimY = flickTo.y;
    var rect = angleRectPx(ANGLE_DEFS[angleIdx], W, H);
    var hit = pointInRect(flickTo.x, flickTo.y, rect);
    if (hit) {
      beep('awp');
      muzzleFlashUntil = now() + 90;
      killfeedUntil = now() + 1400;
      attackersRemaining--;
      startBolt(attackersRemaining <= 0);
    } else {
      beep('dink');
      muzzleFlashUntil = now() + 90;
      startDeath();
    }
  }

  function startBolt(isFinalKill) {
    boltStart = now();
    var ms = BOLT_MIN_MS + rng() * (BOLT_MAX_MS - BOLT_MIN_MS);
    boltEnd = boltStart + ms;
    boltRoundWon = isFinalKill;
    state = 'bolt';
  }

  function startDeath() {
    deathStart = now();
    deathEnd = deathStart + DEATH_MS;
    state = 'dead';
  }

  function onRoundWon() {
    roundResults.push(true);
    roundsWon++;
    setBanner('ROUND WON', 'good');
    beep('cash');
    if (roundsWon >= ROUNDS_TO_WIN) { endMatch(true); return; }
    pauseEnd = now() + ROUND_PAUSE_MS;
    state = 'roundPause';
  }

  function onRoundLost() {
    roundResults.push(false);
    roundsLost++;
    setBanner('ROUND LOST', 'bad');
    beep('miss');
    if (roundsLost >= ROUNDS_TO_WIN) { endMatch(false); return; }
    pauseEnd = now() + ROUND_PAUSE_MS;
    state = 'roundPause';
  }

  function endMatch(won) {
    state = 'matchEnd';
    setBanner(won ? 'CLUTCHED' : 'LAN LOST', won ? 'good' : 'bad');
    setTimeout(function () { finish(won); }, MATCH_END_HOLD_MS);
  }

  function finish(won) {
    active = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (root) root.classList.remove('mg-match--open');
    setBanner('');
    var cb = onDone; onDone = null;
    // Same 160ms stagger js/matchgames.js's finish() uses — let the close
    // transition start before whatever reward UI email.js/state.js shows
    // (the ELO/cash card) lands on top of it.
    setTimeout(function () { if (cb) cb(!!won); }, 160);
  }

  function update() {
    var t = now();
    if (state === 'tell') {
      if (t >= tellEnd) { state = 'peek'; peekStart = t; exposeEnd = peekStart + exposeMs; }
    } else if (state === 'peek') {
      if (t >= exposeEnd) { startDeath(); }              // failed to fire in time
    } else if (state === 'flicking') {
      if (t >= flickEnd) { resolveFlickShot(); }
    } else if (state === 'bolt') {
      if (t >= boltEnd) {
        if (boltRoundWon) onRoundWon(); else spawnAttacker();
      }
    } else if (state === 'dead') {
      if (t >= deathEnd) { onRoundLost(); }
    } else if (state === 'roundPause') {
      if (t >= pauseEnd) { currentRound++; startRound(); }
    }
    // 'matchEnd' is driven by the setTimeout in endMatch(); nothing to tick.
  }

  /* ======================================================================
     DRAW — the defender's-eye B site.
     ====================================================================== */
  function drawSite(c, w, h) {
    var i, def, r, cx, cy;

    // ---- ambient wall the covers sit on, and the sunlit floor ----
    px(c, 0, 0, w, h, '#5c4a2e');
    var floorTop = h * 0.80;
    px(c, 0, floorTop, w, h - floorTop, '#b79a68');
    px(c, 0, floorTop, w, 4, '#8a7345');
    for (var fy = floorTop + 18; fy < h; fy += 30) px(c, 0, fy, w, 2, '#a3875c');

    // the painted B, high on the back wall between B doors and Car — clear
    // of every gap rect (all start at gy >= 0.16) so it never eats into the
    // one thing that has to stay dark for the contrast rule.
    px(c, w * 0.30, h * 0.02, w * 0.40, h * 0.11, '#3a2e1c');
    pixelText(c, 'B', w * 0.50, h * 0.075, Math.round(h * 0.075), '#c23b2e', 'center');

    // ---- each angle: cover, then its gap punched dark into the cover ----
    for (i = 0; i < ANGLE_DEFS.length; i++) {
      def = ANGLE_DEFS[i];
      r = angleRectPx(def, w, h);
      var m = Math.max(10, w * 0.025);           // cover margin around the gap
      px(c, r.x - m, r.y - m, r.w + m * 2, r.h + m * 2, def.cover);
      px(c, r.x - m, r.y - m, r.w + m * 2, 4, 'rgba(255,255,255,0.14)');   // lit top edge
      px(c, r.x, r.y, r.w, r.h, GAP_SHADOW);
      // a 3px frame so the gap reads as an opening, not a hole punched out
      px(c, r.x - 3, r.y, 3, r.h, '#2e2416');
      px(c, r.x + r.w, r.y, 3, r.h, '#4a3a24');
    }

    // ---- ground clutter (crates/barrels), clear of every gap's cover box ----
    drawCrate(c, w * 0.395, floorTop - h * 0.16, w * 0.10, w * 0.10);
    drawBarrel(c, w * 0.63, floorTop - h * 0.10, w * 0.075, '#a85a2e', '#c87a44');
    drawBarrel(c, w * 0.70, floorTop - h * 0.08, w * 0.075, '#2e5f8a', '#4c82ae');
    drawCrate(c, w * 0.865, floorTop - h * 0.06, w * 0.085, w * 0.085);
  }

  function drawCrate(c, x, y, w, h) {
    px(c, x, y, w, h, '#3a2e1c');
    px(c, x + 2, y + 2, w - 4, h - 4, '#8a6436');
    px(c, x + 2, y + 2, w - 4, 3, '#a37c46');
    for (var p = 6; p < h - 4; p += 10) px(c, x + 3, y + p, w - 6, 2, '#6e5028');
  }
  function drawBarrel(c, x, y, r, col, lit) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = '#241c14'; c.fill();
    c.beginPath(); c.arc(x, y, r - 2, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    c.beginPath(); c.arc(x, y, r * 0.6, 0, Math.PI * 2); c.fillStyle = lit; c.fill();
  }

  // The peeking attacker, drawn inside the exposed angle's gap only. Same
  // silhouette vocabulary as js/matchgames.js's makeAwp() CT — this game's
  // camera is deliberately the same "you, looking down your gun" language.
  function drawEnemy(c, w, h) {
    if (state !== 'peek' && state !== 'flicking') return;
    var def = ANGLE_DEFS[angleIdx];
    var r = angleRectPx(def, w, h);
    var bob = Math.sin(now() / 220) * 3;         // idle sway, wall-clock driven
    var cx = r.x + r.w / 2, cy = r.y + r.h * 0.62 + bob;
    var s = Math.min(r.w, r.h) * 0.42;
    px(c, cx - s * 0.42, cy - s * 0.20, s * 0.84, s * 1.5, '#3D4038');   // torso/vest
    px(c, cx - s * 0.30, cy - s * 0.05, s * 0.60, s * 0.42, '#2B2E28');  // chest rig
    px(c, cx - s * 0.24, cy - s * 0.62, s * 0.50, s * 0.55, '#4B4D43');  // head
    px(c, cx - s * 0.30, cy - s * 0.72, s * 0.62, s * 0.24, '#33352E');  // helmet
    px(c, cx - s * 0.60, cy - s * 0.02, s * 0.30, s * 0.72, '#35382F');  // near arm
    px(c, cx - s * 0.95, cy + s * 0.10, s * 0.66, s * 0.16, '#1D1E1B');  // rifle held low
    px(c, cx - s * 0.44, cy + s * 1.30, s * 0.92, s * 0.16, '#191A17');  // contact shadow
  }

  // First-person AWP, held bottom-right — the same held-corner composition
  // js/matchgames.js's spray game uses for its AK. The bolt handle physically
  // throws back and forward during the bolt cycle, so the punishment beat
  // (spec §5.2) has an on-screen tell of its own, not just a locked crosshair.
  function drawAwp(c, w, h) {
    c.save();
    c.translate(w - 6, h - 6);
    c.rotate(-0.06);
    c.scale(0.72, 0.72);
    px(c, -30, -230, 60, 60, '#3A4030');                 // scope body
    px(c, -22, -222, 44, 20, '#4E5640');                 // scope highlight band
    c.beginPath(); c.arc(-8, -200, 15, 0, Math.PI * 2); c.fillStyle = '#12140F'; c.fill();  // lens (front)
    px(c, 8, -170, 26, 100, '#3A4030');                  // stock/receiver
    px(c, 10, -168, 8, 96, '#4E5640');
    px(c, -4, -60, 34, 60, '#2E3326');                    // grip
    px(c, -4, -30, 40, 22, '#26291F');                    // magazine
    px(c, -190, -186, 200, 20, '#454C38');                // long barrel
    px(c, -190, -186, 200, 4, '#5A6448');                 // barrel highlight
    px(c, -206, -190, 20, 28, '#2C3123');                 // muzzle brake
    // bolt handle: rides OUT during the bolt cycle then snaps back in,
    // computed from boltThrowT (0 at rest, 1 at full throw), refreshed
    // each frame in draw() below from the wall clock, never accumulated.
    px(c, 34 + boltThrowT * 22, -172, 14, 10, '#20241A');
    if (now() < muzzleFlashUntil) {
      px(c, -232, -200, 34, 28, '#FFE9A0');
      px(c, -250, -194, 18, 16, '#FFB03A');
    }
    c.restore();
  }

  // The quickscope vignette — the signature moment (spec §5.5). It exists
  // ONLY while state === 'flicking' and is driven entirely by the flick's own
  // clock (flickStart/flickEnd), never a timer of its own: it snaps in the
  // instant a tap commits to a flick and snaps out the instant that flick
  // resolves into a shot, exactly matching the travel the player is watching.
  function drawScope(c, w, h) {
    if (state !== 'flicking') return;
    var tt = clamp((now() - flickStart) / Math.max(1, flickEnd - flickStart), 0, 1);
    var sx = lerp(flickFrom.x, flickTo.x, tt);
    var sy = lerp(flickFrom.y, flickTo.y, tt);
    var R = w * 0.46;
    c.save();
    c.beginPath();
    c.rect(0, 0, w, h);
    c.arc(sx, sy, R, 0, Math.PI * 2, true);
    c.fillStyle = '#000000';
    c.fill('evenodd');
    c.restore();
    c.save();
    c.globalAlpha = 0.22;
    for (var i = 0; i < 4; i++) {
      c.strokeStyle = '#000000'; c.lineWidth = 4;
      c.beginPath(); c.arc(sx, sy, R - 2 - i * 4, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    px(c, sx - R, sy - 1, R * 2, 2, '#000000');
    px(c, sx - 1, sy - R, 2, R * 2, '#000000');
    for (i = 1; i <= 3; i++) {
      px(c, sx - 2, sy + i * 16, 4, 2, '#000000');
      px(c, sx + i * 16, sy - 1, 2, 4, '#000000');
    }
  }

  // Resting reticle, shown whenever NOT mid-flick — a thin cross rather than
  // the scope's heavy vignette, so "holding an angle" reads as unscoped aim
  // and the quickscope snap on tap is the visible contrast against it.
  function drawReticle(c) {
    var gap = 5, len = 9;
    c.save();
    c.shadowColor = '#00FF66'; c.shadowBlur = 3;
    px(c, aimX - gap - len, aimY - 1, len, 2, '#3CFF8A');
    px(c, aimX + gap, aimY - 1, len, 2, '#3CFF8A');
    px(c, aimX - 1, aimY - gap - len, 2, len, '#3CFF8A');
    px(c, aimX - 1, aimY + gap, 2, len, '#3CFF8A');
    c.restore();
  }

  // HUD — round pips and attackers remaining. Pips read ONLY roundResults,
  // which is pushed to exclusively at the moment a round resolves (see
  // onRoundWon/onRoundLost above), so the pip strip cannot show an outcome
  // before its banner does — the exact leak js/tournaments.js shipped once
  // (V22 item 10, HANDOFF-V2 §5.9-adjacent).
  function drawHud(c, w, h) {
    var i, pw = 20, ph = 10, gap = 6;
    var totalW = pw * 3 + gap * 2;
    var px0 = w / 2 - totalW / 2, py0 = 10;
    for (i = 0; i < 3; i++) {
      var col = i < roundResults.length ? (roundResults[i] ? '#7FE3B0' : '#C0483C') : '#3A3F4A';
      px(c, px0 + i * (pw + gap), py0, pw, ph, '#000000');
      px(c, px0 + i * (pw + gap) + 1, py0 + 1, pw - 2, ph - 2, col);
    }
    var awLabel = 'ATTACKERS LEFT ' + Math.max(0, attackersRemaining);
    px(c, w - 8 - awLabel.length * 6.4, 8, awLabel.length * 6.4 + 6, 16, 'rgba(10,10,10,0.55)');
    pixelText(c, awLabel, w - 10, 16, 10, '#E8E2D0', 'right');

    if (state === 'tell') {
      pixelText(c, 'FOOTSTEPS — ' + ANGLE_DEFS[angleIdx].label, w / 2, h - 22, 12, '#E8E2D0', 'center');
    } else if (state === 'peek') {
      pixelText(c, 'HOLD THE ANGLE', w / 2, h - 22, 12, '#E8E2D0', 'center');
    }
    if (now() < killfeedUntil) {
      var kw = 176, kh = 20, kx = w - kw - 8, ky = 32;
      px(c, kx, ky, kw, kh, '#1A1A1A');
      pixelText(c, 'YOU', kx + 8, ky + kh / 2, 10, '#8CC4FF');
      pixelText(c, 'AWP', kx + kw / 2 - 10, ky + kh / 2, 10, '#E8E8E8');
      pixelText(c, 'ENEMY', kx + kw - 8, ky + kh / 2, 10, '#FF8C8C', 'right');
    }
  }

  function draw(c, w, h) {
    // Bolt-handle throw: a triangle wave over the bolt cycle's own duration
    // (out on the first half, back on the second), computed fresh from
    // wall-clock progress every frame — never stepped or accumulated.
    if (state === 'bolt') {
      var bt = clamp((now() - boltStart) / Math.max(1, boltEnd - boltStart), 0, 1);
      boltThrowT = bt < 0.5 ? bt * 2 : (1 - bt) * 2;
    } else {
      boltThrowT = 0;
    }

    drawSite(c, w, h);
    drawEnemy(c, w, h);
    if (state !== 'flicking') drawReticle(c);
    drawAwp(c, w, h);
    drawScope(c, w, h);
    if (state === 'dead') {
      var dt2 = clamp((now() - deathStart) / DEATH_MS, 0, 1);
      px(c, 0, 0, w, h, 'rgba(200,20,20,' + (0.55 * dt2).toFixed(2) + ')');
    }
    drawHud(c, w, h);
  }

  function loop() {
    if (!active) return;
    update();
    if (canvas) draw(ctx, W, H);
    rafId = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ API */
  G.Clutch = {
    ready: true,

    /* run(opts, done) — opts: {enemies, exposeMs}. Opens the overlay and
       plays a best-of-3 LAN; done(won) fires once the LAN is decided, by
       2 round wins, 2 round losses, or reaching the terminal state through
       play. See the file header: THIS function decides the outcome — it is
       not shown a pre-rolled result the way js/matchgames.js's run() is. */
    run: function (opts, done) {
      build();
      onDone = done || null;
      active = true;
      root.classList.add('mg-match--open');
      sizeCanvas();
      resetMatch(opts || {});
      rafId = requestAnimationFrame(loop);
    },

    isOpen: function () { return active; },

    // Measurable handle for verification (spec §5.7) — mirrors the shape of
    // js/matchgames.js's __probe(). rAF is throttled to ~1fps whenever the
    // Browser pane is not composited, so the suite pumps a synthetic clock
    // and reads this rather than waiting for real frames.
    __probe: function () {
      return {
        open: active,
        round: currentRound,
        roundsWon: roundsWon,
        alive: state !== 'dead',
        left: attackersRemaining,
        aimX: aimX,
        aimY: aimY,
        bolting: state === 'bolt',
        flicking: state === 'flicking'
      };
    },

    // Test seam: deterministic angle sequence. Call BEFORE run() — it seeds
    // the module's PRNG so pickAngle() (and therefore every tell/peek/hitbox
    // in the LAN that follows) is reproducible.
    __force: function (seed) { seedRng(seed); return true; },

    /* Test seams for the OUTCOME path, mirroring js/matchgames.js's __win /
       __fail. Added by the lead after the fact: SPEC-V23 §5.7 listed only
       __probe and __force, which left the one thing this module exists to do
       — DECIDE a quest's result — reachable solely by playing the LAN by
       hand. That made the accept -> run -> resolveInvite chain in
       js/email.js untestable end to end, which is precisely the chain §1
       says must never be quietly rewired.

       These drive the REAL endMatch(), so the done() callback, the banner and
       the teardown all run exactly as they do in play. They do not shortcut
       to the callback, because a seam that bypasses the code under test
       proves nothing. */
    __win: function () { if (!active) return false; endMatch(true); return true; },
    __fail: function () { if (!active) return false; endMatch(false); return true; }
  };
})(window.Game = window.Game || {});
