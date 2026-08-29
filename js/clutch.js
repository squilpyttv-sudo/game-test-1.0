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

   ART — MIRAGE MID, seen from inside the window (owner's reference shot,
   V23a). The whole view is framed by that window: timber beams overhead,
   brick-and-plaster jambs down both sides, a worn sill along the bottom.
   That frame is doing structural work, not decoration — it is what buys the
   scene a real foreground, and with a receding ground plane behind it the
   art finally has foreground / midground / background instead of the flat
   bands the first pass shipped. Depth here comes from OVERLAP, SIZE FALLOFF
   and a cooler, lighter distance, never from extra detail in one plane:
   at 420px wide, detail is noise and silhouette is everything.

   The five peek angles are PLACES IN THAT ARCHITECTURE, not rectangles
   floated on top of it — past the blue house's corner, out of the raised
   archway, behind the barrel stack, over the low dividing wall, out of the
   arched A doorway. Two of them (SHORT WALL, BARRELS) are deliberately
   drawn in two passes with the enemy sandwiched between, so the silhouette
   is genuinely occluded by the cover it is peeking from rather than pasted
   over it. See drawSceneBack() / drawSceneFront().

   The AWP viewmodel sits bottom-right, as js/matchgames.js's spray game
   holds its AK. All flat rects and arcs on canvas, no image assets
   (HANDOFF-V2 §2), no emoji or glyph icons. Colour literals are correct
   here for the same reason they are in js/iso.js and js/matchgames.js:
   canvas cannot read CSS variables.

   NOTHING ABOUT THE GAME CHANGED WITH THE ART. The flick band, the bolt
   cycle, best-of-3, the death read and the whole public API are the same
   values and the same code they were on Dust 2. This was an environment
   swap and a re-siting of five angles, and if a tuning constant ever moves
   in a commit that also moves art, that commit is wrong.

   TIMING — wall-clock (Date.now()) throughout, never frame-accumulated (the
   dt-accumulator trap: a dropped frame rate would stretch the tell out of
   step with the peek it warns about). The one legitimate dt-style integral
   is the flick's on-screen travel, which is computed from elapsed wall time
   against the flick's own start/end timestamps every frame, not summed.

   The tell, the peek and the hitbox all read ANGLE_DEFS — ONE array. A
   second copy is how a tell ends up describing a different angle from the
   one that opens (the exact failure mode the spec calls out in §5.4).

   ---------------------------------------------------------------------------
   V23b — THE THREE THINGS THE OWNER ASKED FOR AFTER PLAYING IT

   1. A BRIEFING ON THE FIRST LAN. Nothing in the game teaches the positional
      tap; §5.1 exists precisely because this verb is not one of the other
      three, so it is the one verb a player cannot arrive already knowing.
      Shown once ever, before round 1, gated on State.tutorialSeen('first_lan')
      and latched on DISMISS (never on show — a reload mid-briefing would
      otherwise burn the only time it ever fires). 'first_lan' is a
      d.tutorialsSeen SAVE KEY: it round-trips through normalizeSave() for
      free and must never be renamed.

   2. A ROUND CARD YOU TAP THROUGH. Rounds used to auto-advance on a 950ms
      timer while a CSS banner faded — the result was gone before it was read
      and the next round started under the player's thumb. Now every round
      ends on a card that states the result, shows the running score out of
      roundResults, and waits. The player sets the pace, which is the point.

      THE STRAY TAP is the real hazard here: the tap that kills the last
      attacker is a pointerdown a few hundred ms before the card exists, and a
      player mid-burst will keep tapping. The card therefore refuses input for
      CARD_LOCK_MS and only draws its TAP bar once it will actually accept
      one — the affordance and the gate are the same fact, so the card never
      invites a tap it is going to swallow.

   3. THE FIVE ANGLES ARE MARKED. They were only ever implied by the
      architecture, which is fine on the tenth LAN and unreadable on the
      first. drawAngleMarkers() brackets each gap, and it iterates ANGLE_DEFS
      directly — there is no second list of marker positions, because a second
      list is how a marker ends up on a different angle from the one that
      opens (§5.4 again, same rule as the tell). The brackets are loudest at
      the top of a round and settle back to a whisper once play begins, and
      the named angle's own bracket lifts during the tell, so the footstep
      call becomes a PLACE rather than a word a new player cannot site.
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

  /* ROUND_PAUSE_MS (950) and MATCH_END_HOLD_MS (950) used to live here. Both
     are DELETED, not renamed: they were auto-advance timers, and after V23b
     nothing about the round beat advances on a clock — the player taps it
     forward. Leaving a constant called "pause" that no longer pauses anything
     is worse than either changing it or removing it.

     What stands in their place is not a pause but an INPUT LOCK. The card is
     up from the instant the round resolves and is readable immediately; it
     simply will not accept a tap for its first CARD_LOCK_MS, which is what
     stops the kill tap from also dismissing it. 350ms is comfortably longer
     than a double-tap interval and far shorter than the time it takes to read
     "ROUND WON", so the gate is invisible to anyone who is not spamming. */
  var CARD_LOCK_MS = 350;

  // Entrance and settle timings for the card and the angle brackets. Neither
  // gates input or gameplay — both are read straight off the wall clock while
  // drawing, so a dropped frame changes nothing but smoothness.
  var CARD_IN_MS   = 170;   // the card's ease-out entrance
  var TAP_IN_MS    = 140;   // the TAP bar's fade, once CARD_LOCK_MS has passed
  var MARK_INTRO_MS = 1400; // angle brackets: loud at round start, then settle

  /* THE FIRST-LAN LATCH. 'first_lan' is a per-entry key on d.tutorialsSeen,
     which defaultData() already ships and normalizeSave() already round-trips,
     so this costs js/state.js exactly nothing and adds no second "have they
     seen it" flag anywhere. IT IS A SAVE KEY AND MUST NEVER BE RENAMED — the
     three ids this project already carries under wrong-but-frozen names
     (stream_minutes, lucky_mousepad, phone_unlock) are what renaming one
     costs.

     Wrapped exactly the way js/stream.js wraps 'first_stream', for the same
     reason: js/clutch.js is loadable without js/state.js (test-v23-quests.js
     does precisely that), so a missing State must degrade to "once per
     session" rather than throw inside run(). */
  var FIRST_LAN_TUTORIAL = 'first_lan';
  var localSeen = {};
  function tutorialSeenSafe(id) {
    if (G.State && typeof G.State.tutorialSeen === 'function') return !!G.State.tutorialSeen(id);
    return !!localSeen[id];
  }
  function markTutorialSeenSafe(id) {
    localSeen[id] = true;   // set FIRST, so a throwing State still latches the session
    if (G.State && typeof G.State.markTutorialSeen === 'function') G.State.markTutorialSeen(id);
  }

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

     `cover` is the material the architecture puts IMMEDIATELY BESIDE each
     gap — the teal render of the blue house, the cream of the back wall, a
     barrel's rusted steel, the sandstone of the low wall, the white plaster
     of the A wall. The gap itself is always GAP_SHADOW, because a doorway or
     a shaded recess read from out in the sun is the darkest thing in the
     scene no matter what surrounds it. That is the whole reason this holds
     across five materials as different as painted render, fired plaster and
     rusted steel: we are not contrasting a colour against a colour, we are
     contrasting lit against unlit.

     Luminance below is Rec.709 relative luma (0.2126R + 0.7152G + 0.0722B on
     the 0-255 scale). GAP_SHADOW sits at 19.6; the smallest gap in the set is
     BLUE HOUSE at 78.0 and the largest is A DOORWAY at 200.9. Every pair is
     re-measured in the verification pass rather than taken on trust — see
     HANDOFF-V2 §5.9, comments lie and measurements do not. */
  var GAP_SHADOW = '#171310';
  var ANGLE_DEFS = [
    // Past the blue house's right-hand corner, in the shadow beside its
    // green door. The one saturated thing in the scene, so the darkest gap
    // in the set is also the easiest to find.
    { id: 'blue',      label: 'BLUE HOUSE', gx: 0.200, gy: 0.420, gw: 0.120, gh: 0.240, cover: '#2E6E7E' },
    // The raised archway in the cream back wall, under the palms. Furthest
    // from the eye, so it is the smallest rect and its silhouette scales
    // down with it (drawEnemy sizes off the rect, not a constant).
    { id: 'arch',      label: 'ARCHWAY',    gx: 0.395, gy: 0.270, gw: 0.115, gh: 0.145, cover: '#D9C79C' },
    // The slot between the two barrel stacks on the open ground. Drawn in
    // two passes so the front row of barrels cuts the legs off.
    { id: 'barrels',   label: 'BARRELS',    gx: 0.530, gy: 0.440, gw: 0.120, gh: 0.170, cover: '#B0703A' },
    // Behind the low dividing wall that splits the space lengthwise. The
    // nearest angle, so the biggest rect — and the most occluded one.
    { id: 'shortwall', label: 'SHORT WALL', gx: 0.345, gy: 0.560, gw: 0.180, gh: 0.150, cover: '#C4AC7C' },
    // Out of the arched doorway under the red painted A, bench at its foot.
    { id: 'adoor',     label: 'A DOORWAY',  gx: 0.735, gy: 0.455, gw: 0.135, gh: 0.260, cover: '#E4DCCB' }
  ];

  /* The five are STAGGERED IN DEPTH, not laid out in a row, and that is a
     hard requirement rather than a composition preference. Five angles side
     by side will not fit across a 332px opening once each one is given cover
     wide enough to be measurably lighter than it. Staggering buys the space:
     the archway sits high and far, the barrels and the A doorway at mid
     height, the low wall lowest and nearest. Two consequences worth knowing
     before moving any number here — the first pass got both wrong and the
     measurement pass, not the eye, is what caught them:
       - Architecture drawn for one angle can drift across ANOTHER angle's
         gap. A three-barrel stack reached up into the archway and put rust
         where a silhouette had to be.
       - No two gap rects may intersect, or a tap resolves against whichever
         happens to be live rather than the one under the finger.
     Both are asserted arithmetically in the verification pass. */

  /* Where the window's opening is, as fractions of the canvas. The frame is
     drawn over these edges last (drawWindowFrame), and every gap above lives
     strictly inside them — a peek angle hidden behind a timber beam is an
     unwinnable round, so this relationship is asserted in the verification
     pass rather than eyeballed. */
  var OPEN_X0 = 0.105, OPEN_X1 = 0.895, OPEN_Y0 = 0.135, OPEN_Y1 = 0.865;

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
  /* The art reads its gap positions back OUT of ANGLE_DEFS by id, so a piece
     of architecture and the hitbox it belongs to can never drift apart. This
     is the reason drawSceneBack() has no coordinate literals for any of the
     five openings — HANDOFF-V2 §5.4, the second copy is the bug. */
  function defById(id) {
    for (var i = 0; i < ANGLE_DEFS.length; i++) if (ANGLE_DEFS[i].id === id) return ANGLE_DEFS[i];
    return ANGLE_DEFS[0];
  }
  function gapPx(id, w, h) { return angleRectPx(defById(id), w, h); }
  function pointInRect(px2, py2, r) {
    return px2 >= r.x && px2 <= r.x + r.w && py2 >= r.y && py2 <= r.y + r.h;
  }

  /* ---------------------------------------------------------------------- shell */
  var root = null, canvas = null, ctx = null, labelEl = null;
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
    /* No .mg-match__banner here any more. Every fixed message this game shows
       — the briefing, ROUND WON/LOST, CLUTCHED/LAN LOST — is now a card the
       player taps through, and a card has to be TAPPABLE: .mg-match__banner
       is `pointer-events: none` and sits outside the canvas, so a DOM banner
       could never own the tap that dismisses it. Drawing the card on the
       canvas puts the message and the tap surface in the same place, and the
       one pointerdown listener below already covers the whole of it. */
    root.innerHTML =
      '<div class="mg-match__label" id="clutch-label">THE CLUTCH — MIRAGE MID</div>' +
      '<canvas class="mg-match__canvas" id="clutch-canvas"></canvas>';
    var host = document.getElementById('app') || document.body;
    host.appendChild(root);

    canvas = document.getElementById('clutch-canvas');
    ctx = canvas.getContext('2d');
    labelEl = document.getElementById('clutch-label');

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

  /* state: 'tell' | 'peek' | 'flicking' | 'bolt' | 'dead'
            | 'briefing'  — the first-LAN card, before round 1 ever starts
            | 'roundCard' — ROUND WON/LOST + the score, waiting for a tap
            | 'matchCard' — CLUTCHED/LAN LOST, waiting for the tap that
                            closes the overlay and fires done(won)
     The last three are the tap-gated ones: nothing about them is on a timer,
     so update() has nothing to do in any of them. */
  var state = 'tell';
  var tellEnd = 0;
  var peekStart = 0, exposeEnd = 0;
  var aimX = 0, aimY = 0;                       // resting crosshair position
  var flickFrom = null, flickTo = null, flickStart = 0, flickEnd = 0;
  var boltStart = 0, boltEnd = 0, boltRoundWon = false;
  var deathStart = 0, deathEnd = 0;
  var killfeedUntil = 0, muzzleFlashUntil = 0;
  var boltThrowT = 0;                            // live, for the bolt-handle animation
  var cardOpenAt = 0;        // wall clock the current card appeared; drives BOTH
                             // its entrance and its CARD_LOCK_MS input gate
  var matchWon = false;      // what the match card is reporting, and what the
                             // tap that dismisses it will pass to done()
  var roundStartAt = 0;      // when the current round began — the angle
                             // brackets' intro reads off this, nothing else

  function resetMatch(opts) {
    enemiesPerRound = (opts && opts.enemies) || 3;
    exposeMs = (opts && opts.exposeMs) || 700;
    currentRound = 1; roundsWon = 0; roundsLost = 0;
    roundResults = [];
    lastAngleIdx = -1;
    killfeedUntil = 0; muzzleFlashUntil = 0;
    aimX = W / 2; aimY = H / 2;
    roundStartAt = now();
    // The briefing is checked ONCE, here, and only ever gates round 1 — a
    // player who has seen it drops straight into the first tell with no extra
    // beat, exactly as before.
    if (!tutorialSeenSafe(FIRST_LAN_TUTORIAL)) { openCard('briefing'); return; }
    startRound();
  }

  function startRound() {
    attackersRemaining = enemiesPerRound;
    aimX = W / 2; aimY = H / 2;
    roundStartAt = now();
    spawnAttacker();
  }

  // Every card enters through here, so the lock clock and the entrance clock
  // can never disagree about when this card appeared.
  function openCard(kind) {
    state = kind;
    cardOpenAt = now();
  }
  // The gate itself. One comparison against the wall clock — see the
  // CARD_LOCK_MS note above for why a time lock and not a pointer-up latch.
  function cardArmed() { return now() - cardOpenAt >= CARD_LOCK_MS; }

  function spawnAttacker() {
    angleIdx = pickAngle(lastAngleIdx);
    lastAngleIdx = angleIdx;
    state = 'tell';
    tellEnd = now() + TELL_MS;
  }

  function onTap(p) {
    if (!active) return;
    /* THE CARD STATES COME FIRST, and every one of them is gated on
       cardArmed(). The tap that killed the last attacker resolves into a card
       ~1s later (the bolt cycle), but a player mid-burst is still tapping, and
       without this gate the round result would flash past unread — which is
       the exact complaint the card exists to answer. */
    if (state === 'briefing') {
      if (!cardArmed()) return;
      // LATCH ON DISMISS, never on show: mark it here and a player who
      // reloads while reading still gets the briefing next time.
      markTutorialSeenSafe(FIRST_LAN_TUTORIAL);
      beep('click');
      startRound();
      return;
    }
    if (state === 'roundCard') {
      if (!cardArmed()) return;
      beep('click');
      currentRound++;
      startRound();
      return;
    }
    if (state === 'matchCard') {
      if (!cardArmed()) return;
      beep('click');
      finish(matchWon);
      return;
    }
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
    // endMatch() sounds the LAN's own beat, so the round beep is skipped when
    // this round is also the match — one card, one sound.
    if (roundsWon >= ROUNDS_TO_WIN) { endMatch(true); return; }
    beep('cash');
    openCard('roundCard');
  }

  function onRoundLost() {
    roundResults.push(false);
    roundsLost++;
    if (roundsLost >= ROUNDS_TO_WIN) { endMatch(false); return; }
    beep('miss');
    openCard('roundCard');
  }

  /* seamSkipsCard — set ONLY by __win/__fail, cleared the instant endMatch
     reads it. Those two seams must still reach done(), because js/email.js's
     whole accept -> play -> resolveInvite chain hangs off that callback and
     the suite drives it through them; a tap gate they cannot get past would
     turn a passing check into a hang. They still run the REAL endMatch() —
     the flag skips the card, not the code under test. It is deliberately not
     an argument to endMatch(): the test asserts the literal `endMatch(true)`
     / `endMatch(false)` call shape, and a second parameter would break it. */
  var seamSkipsCard = false;

  function endMatch(won) {
    matchWon = !!won;
    if (seamSkipsCard) { seamSkipsCard = false; finish(won); return; }
    beep(won ? 'cash' : 'miss');
    openCard('matchCard');
  }

  function finish(won) {
    active = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (root) root.classList.remove('mg-match--open');
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
    }
    /* 'briefing', 'roundCard' and 'matchCard' tick nothing at all — they end
       on a tap and only on a tap. That is the whole change: there is no timer
       left in this function that can advance the match past the player. */
  }

  /* ======================================================================
     DRAW — MIRAGE MID, through the window.

     Painted back-to-front in two calls with the enemy sandwiched between
     them, because occlusion is the cheapest depth cue there is and the only
     one that makes a silhouette read as "peeking" instead of "placed":

       drawSceneBack()   sky, minaret, back wall + archway, blue house,
                         A wall, the paving, and the FAR half of the low
                         wall and the barrel stacks — every gap is punched
                         here, so the enemy always has something dark behind.
       drawEnemy()       the silhouette, inside the active gap only.
       drawSceneFront()  the NEAR half of the low wall, the front barrel row,
                         the bench, then the window frame over everything.

     Sunlight comes from the upper left throughout — every lit edge is a top
     or left edge and every shadow falls right and down. One light direction,
     applied without exception, is what stops a scene drawn out of flat rects
     from looking like a collage of unrelated rects.
     ====================================================================== */

  // The one palette. Named by material, not by role, so a colour is chosen
  // by asking what a thing is MADE of rather than where it happens to sit.
  var SKY_TOP   = '#5F8CAB', SKY_MID = '#8FB0C4', SKY_HAZE = '#C4D2D4';
  var CREAM     = '#D9C79C', CREAM_HI = '#EADCB8', CREAM_LO = '#AE9668';
  var TEAL      = '#2E6E7E', TEAL_HI = '#41909F', TEAL_LO = '#1D4C58';
  var PLASTER   = '#E4DCCB', PLASTER_HI = '#F3EEE2', PLASTER_LO = '#B6AB95';
  var SAND      = '#C4AC7C', SAND_HI = '#DCC79A';
  var STONE     = '#B9A278', STONE_HI = '#CEB88E', STONE_LO = '#94805C';
  var RUST      = '#B0703A', RUST_HI = '#CE8E52', RUST_LO = '#7C4C24';
  var TIMBER    = '#6B5334', TIMBER_HI = '#8F7148', TIMBER_LO = '#3E2F1D';
  var BRICKED   = '#A98A64', BRICK = '#8E6748';
  var PALM      = '#4E6B33', PALM_HI = '#6C8C46';
  var RED_A     = '#B23A2E';
  var IRON      = '#3B3A36';

  function drawSceneBack(c, w, h) {
    var y0 = h * OPEN_Y0, y1 = h * OPEN_Y1;
    var horizon = h * 0.545;          // where the paving meets the far wall

    // ---- sky: three bands, coolest and darkest at the top, hazy at the
    // horizon. Distance reading lighter and cooler than the foreground is
    // aerial perspective, and it is doing more work here than any detail.
    px(c, 0, 0, w, horizon, SKY_MID);
    px(c, 0, 0, w, h * 0.26, SKY_TOP);
    px(c, 0, h * 0.26, w, h * 0.06, '#7AA0B8');
    px(c, 0, h * 0.44, w, horizon - h * 0.44, SKY_HAZE);

    // ---- minaret, rising behind and left of the archway. Drawn in haze-
    // shifted cream so it sits BEHIND the back wall without an outline.
    var mx = w * 0.335, mw = w * 0.058;
    px(c, mx, h * 0.150, mw, h * 0.40, '#CFC0A0');
    px(c, mx, h * 0.150, mw * 0.42, h * 0.40, '#E0D3B4');      // sunlit face
    px(c, mx - w * 0.014, h * 0.196, mw + w * 0.028, h * 0.014, '#BFB093');  // gallery
    px(c, mx + mw * 0.20, h * 0.118, mw * 0.60, h * 0.034, '#D8CBAC');       // cap
    px(c, mx + mw * 0.42, h * 0.100, mw * 0.16, h * 0.020, '#BFB093');       // finial

    // ---- power lines. Two sags across the sky, 2px, no more: they are a
    // silhouette cue for "this is a street", not a subject.
    c.save();
    c.strokeStyle = 'rgba(38,44,50,0.55)'; c.lineWidth = 2;
    for (var L = 0; L < 2; L++) {
      c.beginPath();
      c.moveTo(0, h * (0.205 + L * 0.045));
      c.quadraticCurveTo(w * 0.5, h * (0.245 + L * 0.045), w, h * (0.190 + L * 0.045));
      c.stroke();
    }
    c.restore();

    // ---- the cream back wall, and the raised archway punched into it ----
    px(c, 0, h * 0.255, w, horizon - h * 0.255, CREAM);
    px(c, 0, h * 0.255, w, 5, CREAM_HI);                       // sun on the coping
    px(c, 0, horizon - h * 0.030, w, h * 0.030, CREAM_LO);      // wall foot in shade
    drawArchway(c, w, h);

    // ---- palm fronds over the wall, just left of the arch crown. Six
    // tapered blades off one point; a palm is a silhouette, not a texture.
    drawPalm(c, w * 0.545, h * 0.268, w * 0.115);
    drawPalm(c, w * 0.375, h * 0.276, w * 0.088);

    // ---- the paving. Bands deepen toward the viewer and a handful of
    // joints converge on the arch, which is the only perspective cue the
    // scene needs and the reason the ground reads as receding rather than
    // as a wall lying down.
    drawPaving(c, w, h, horizon);

    // ---- the blue house, left, and its corner recess (BLUE HOUSE) ----
    drawBlueHouse(c, w, h);

    // ---- the A wall, right, and its arched doorway (A DOORWAY) ----
    drawAWall(c, w, h);

    // ---- far halves of the two two-pass angles ----
    drawLowWallBack(c, w, h);
    drawBarrelsBack(c, w, h);

    // A whisper of warm bounce along the very bottom of the opening, so the
    // paving nearest the sill is the warmest thing in the scene and the eye
    // has somewhere to start.
    px(c, 0, y1 - h * 0.05, w, h * 0.05, 'rgba(196,150,80,0.13)');
    if (y0 > 0) { /* the frame covers above y0; nothing to draw there */ }
  }

  function drawSceneFront(c, w, h) {
    drawLowWallFront(c, w, h);
    drawBarrelsFront(c, w, h);
    drawBench(c, w, h);
    drawWindowFrame(c, w, h);
  }

  /* -- ARCHWAY: a raised gateway in the cream wall. The gap rect IS the
     opening; the arch is built around it from the rect, never beside it. */
  function drawArchway(c, w, h) {
    var r = gapPx('arch', w, h);
    var pad = w * 0.040;
    // the raised block the gateway sits in, a shade lighter than the wall
    px(c, r.x - pad, r.y - pad * 1.5, r.w + pad * 2, r.h + pad * 1.5, CREAM_HI);
    px(c, r.x - pad, r.y - pad * 1.5, r.w + pad * 2, 4, '#F5E9C8');
    px(c, r.x - pad * 1.4, r.y - pad * 1.5, r.w + pad * 2.8, h * 0.012, '#C9B78C'); // lintel band
    // the opening: square below, semicircular crown above
    var cxA = r.x + r.w / 2, rad = r.w / 2;
    c.fillStyle = GAP_SHADOW;
    c.beginPath();
    c.moveTo(r.x, r.y + r.h);
    c.lineTo(r.x, r.y + rad);
    c.arc(cxA, r.y + rad, rad, Math.PI, 0);
    c.lineTo(r.x + r.w, r.y + r.h);
    c.closePath();
    c.fill();
    // reveal: the left jamb catches sun, the right one does not
    px(c, r.x - 3, r.y + rad, 3, r.h - rad, CREAM_HI);
    px(c, r.x + r.w, r.y + rad, 3, r.h - rad, CREAM_LO);
    // three steps up to it — this is the "raised" in raised gateway
    for (var s = 0; s < 3; s++) {
      px(c, r.x - pad - s * 5, r.y + r.h + s * 6, r.w + pad * 2 + s * 10, 6, s % 2 ? CREAM : CREAM_HI);
      px(c, r.x - pad - s * 5, r.y + r.h + s * 6 + 5, r.w + pad * 2 + s * 10, 2, CREAM_LO);
    }
  }

  /* -- BLUE HOUSE: the one saturated mass in a sand-toned scene, so it
     anchors the composition and the eye returns to it. Green door, iron
     railing, small balcony; the peek is the shaded corner at its right
     edge, where the render turns away from the sun. */
  function drawBlueHouse(c, w, h) {
    var r = gapPx('blue', w, h);
    var bx = 0, bw = r.x + r.w + w * 0.008;         // wall ends just past the gap
    var by = h * 0.205, bh = h * 0.690 - by;
    px(c, bx, by, bw, bh, TEAL);
    px(c, bx, by, bw, 6, TEAL_HI);                   // sunlit parapet
    px(c, bx + bw - 8, by, 8, bh, TEAL_LO);          // the corner turning away
    px(c, bx, by + bh - h * 0.020, bw, h * 0.020, '#173C46');   // plinth
    // weathering: two horizontal wash bands, low alpha, no texture noise
    px(c, bx, by + bh * 0.34, bw, 5, 'rgba(255,255,255,0.08)');
    px(c, bx, by + bh * 0.62, bw, 4, 'rgba(0,0,0,0.10)');

    // balcony + railing, above the door
    var balY = by + h * 0.115;
    px(c, bx + w * 0.020, balY, bw - w * 0.040, h * 0.012, TEAL_LO);
    px(c, bx + w * 0.020, balY, bw - w * 0.040, 3, TEAL_HI);
    for (var i = 0; i < 7; i++) {
      px(c, bx + w * 0.030 + i * (bw - w * 0.062) / 7, balY - h * 0.038, 3, h * 0.038, IRON);
    }
    px(c, bx + w * 0.024, balY - h * 0.040, bw - w * 0.048, 3, IRON);

    // Green door, to the LEFT of the peek so the two never fight — and held
    // far enough off it that the door's own shadowed frame is not what the
    // silhouette is being read against. Measured: at a 0.014w standoff the
    // cover beside this gap was the frame at 66.9, not the render at 97.6.
    var dw = w * 0.062, dh = h * 0.170;
    var dx = r.x - dw - w * 0.030, dy = r.y + r.h - dh;
    px(c, dx - 3, dy - 3, dw + 6, dh + 3, TEAL_LO);              // frame
    px(c, dx, dy, dw, dh, '#3F6B31');
    px(c, dx, dy, dw * 0.30, dh, '#4F8039');                     // sunlit leaf
    px(c, dx + dw * 0.62, dy + dh * 0.46, 5, 5, '#C9B25A');      // handle

    // THE PEEK: the shaded recess at the corner. Cover (TEAL) is what sits
    // immediately left of it and along its top — see ANGLE_DEFS.
    px(c, r.x, r.y, r.w, r.h, GAP_SHADOW);
    px(c, r.x - 3, r.y, 3, r.h, TEAL_HI);                        // lit inner jamb
    px(c, r.x, r.y - 3, r.w, 3, TEAL_LO);                        // soffit above
    px(c, r.x, r.y + r.h, r.w, 4, '#173C46');                    // ground contact
  }

  /* -- A WALL: white plaster, the red painted A, an arched doorway. The
     brightest cover in the set against the darkest gap, which is why this
     angle is the easiest read of the five and sits opposite the hardest. */
  function drawAWall(c, w, h) {
    var r = gapPx('adoor', w, h);
    var wx = r.x - w * 0.028, ww = w - wx;
    var wy = h * 0.275, wh = h * 0.745 - wy;
    px(c, wx, wy, ww, wh, PLASTER);
    px(c, wx, wy, ww, 6, PLASTER_HI);                            // sun on the top
    px(c, wx, wy, 7, wh, PLASTER_LO);                            // left return in shade
    px(c, wx, wy + wh - h * 0.016, ww, h * 0.016, '#9E9280');     // damp course
    px(c, wx + 8, wy + wh * 0.55, ww - 8, 4, 'rgba(0,0,0,0.07)');

    // the red A, painted high and clear of the doorway rect
    pixelText(c, 'A', wx + ww * 0.52, wy + h * 0.052, Math.round(h * 0.085), RED_A, 'center');

    // THE PEEK: arched doorway, same construction as the gateway so the two
    // openings belong to one building language.
    var cxA = r.x + r.w / 2, rad = r.w / 2;
    c.fillStyle = GAP_SHADOW;
    c.beginPath();
    c.moveTo(r.x, r.y + r.h);
    c.lineTo(r.x, r.y + rad);
    c.arc(cxA, r.y + rad, rad, Math.PI, 0);
    c.lineTo(r.x + r.w, r.y + r.h);
    c.closePath();
    c.fill();
    px(c, r.x - 4, r.y + rad, 4, r.h - rad, PLASTER_HI);
    px(c, r.x + r.w, r.y + rad, 4, r.h - rad, PLASTER_LO);
    // a shallow relieving arch above, in the same plaster
    c.save();
    c.strokeStyle = PLASTER_LO; c.lineWidth = 5;
    c.beginPath(); c.arc(cxA, r.y + rad, rad + 7, Math.PI, 0); c.stroke();
    c.restore();
  }

  /* -- LOW DIVIDING WALL, far half. Runs away from the viewer, so it is
     drawn as a trapezoid: taller and wider at the near end. The peek is the
     shadow pocket beyond it. */
  function drawLowWallBack(c, w, h) {
    var r = gapPx('shortwall', w, h);
    // the sandstone mass the pocket is cut into, extended either side of
    // the rect so SAND is genuinely the material adjacent to the gap
    // Kept clear of the BLUE HOUSE gap on the left (2px) — the mass may
    // extend under the barrels on the right because drawBarrelsBack() runs
    // after this and re-punches its own gap.
    var mx = r.x - w * 0.020, mw = r.w + w * 0.020 + w * 0.110;
    px(c, mx, r.y - h * 0.010, mw, r.h + h * 0.030, SAND);
    px(c, mx, r.y - h * 0.010, mw, 5, SAND_HI);
    for (var cy = r.y + h * 0.030; cy < r.y + r.h; cy += h * 0.038) {
      px(c, mx, cy, mw, 2, 'rgba(0,0,0,0.10)');                  // coursing
    }
    px(c, r.x, r.y, r.w, r.h, GAP_SHADOW);                       // THE PEEK
    px(c, r.x - 3, r.y, 3, r.h, SAND_HI);
    px(c, r.x + r.w, r.y, 3, r.h, '#9C875D');
  }

  function drawLowWallFront(c, w, h) {
    var r = gapPx('shortwall', w, h);
    // The cap lands at 0.62 of the gap's height, which puts it across the
    // silhouette's chest: head, helmet and shoulders clear the wall and the
    // rest does not. That is the shape of a real head peek, and it is the
    // reason this angle needed two passes at all.
    var capY = r.y + r.h * 0.62;
    var nearX0 = r.x - w * 0.145, nearX1 = r.x + r.w + w * 0.145;
    var farX0  = r.x - w * 0.065, farX1  = r.x + r.w + w * 0.065;
    var botY   = h * 0.790;
    c.fillStyle = SAND;
    c.beginPath();
    c.moveTo(farX0, capY); c.lineTo(farX1, capY);
    c.lineTo(nearX1, botY); c.lineTo(nearX0, botY);
    c.closePath(); c.fill();
    // the cap: the top plane catches the sun, so it is the lightest band and
    // the line the silhouette breaks over
    c.fillStyle = SAND_HI;
    c.beginPath();
    c.moveTo(farX0, capY); c.lineTo(farX1, capY);
    c.lineTo(farX1 + (nearX1 - farX1) * 0.16, capY + 7);
    c.lineTo(farX0 + (nearX0 - farX0) * 0.16, capY + 7);
    c.closePath(); c.fill();
    px(c, nearX0, botY - 5, nearX1 - nearX0, 5, '#8E7A52');      // wall foot
    // cast shadow on the paving, falling right and down like every other
    c.fillStyle = 'rgba(60,44,22,0.22)';
    c.beginPath();
    c.moveTo(nearX1, botY); c.lineTo(nearX1 + w * 0.075, botY);
    c.lineTo(farX1 + w * 0.045, capY + 7); c.lineTo(farX1, capY + 7);
    c.closePath(); c.fill();
  }

  /* -- BARREL STACKS. Two stacks flanking the peek slot, plus a front row
     drawn after the enemy. Barrels are cylinders: a body, a lighter left
     third for the sun, two hoops. */
  function drawBarrelsBack(c, w, h) {
    var r = gapPx('barrels', w, h);
    // Both stacks ABUT the slot rather than standing off it, so the steel is
    // genuinely the material beside the gap and the measurement is reading
    // what the eye reads. Height is capped at three: a fourth reaches into
    // the ARCHWAY's gap, which is how this went wrong the first time.
    var bw = w * 0.070, bh = h * 0.075;
    var baseY = r.y + r.h + h * 0.030;
    var i;
    for (i = 0; i < 3; i++) {                                    // left stack
      drawBarrel(c, r.x - bw / 2, baseY - (i + 1) * bh, bw, bh,
                 i === 1 ? '#3E7590' : RUST, i === 1 ? '#5A97B2' : RUST_HI, i === 1 ? '#26526A' : RUST_LO);
    }
    for (i = 0; i < 3; i++) {                                    // right stack
      drawBarrel(c, r.x + r.w + bw / 2, baseY - (i + 1) * bh, bw, bh,
                 i === 2 ? '#3E7590' : RUST, i === 2 ? '#5A97B2' : RUST_HI, i === 2 ? '#26526A' : RUST_LO);
    }
    px(c, r.x, r.y, r.w, r.h, GAP_SHADOW);                       // THE PEEK slot
  }

  function drawBarrelsFront(c, w, h) {
    var r = gapPx('barrels', w, h);
    var bw = w * 0.090, bh = h * 0.095;
    var baseY = r.y + r.h + h * 0.045;
    // Nearer, so bigger — the same barrels one row closer. Their tops land
    // just below the silhouette's waist and cut its legs off.
    drawBarrel(c, r.x + r.w * 0.28, baseY - bh, bw, bh, RUST, RUST_HI, RUST_LO);
    drawBarrel(c, r.x + r.w * 0.88, baseY - bh * 0.90, bw, bh, '#7C7A66', '#9C9A84', '#54523F');
    drawCrate(c, r.x + r.w * 0.14, baseY - h * 0.006, w * 0.070, h * 0.050);
  }

  // x,y is the barrel's CENTRE-TOP; it is drawn downward, so a stack is just
  // the same call at descending y with no per-barrel offset bookkeeping.
  function drawBarrel(c, x, y, bw, bh, col, lit, dark) {
    var x0 = x - bw / 2;
    px(c, x0, y, bw, bh, col);
    px(c, x0, y, bw * 0.30, bh, lit);                            // sunlit side
    px(c, x0 + bw * 0.80, y, bw * 0.20, bh, dark);
    px(c, x0, y, bw, 4, lit);                                    // rim
    px(c, x0, y + bh * 0.28, bw, 3, dark);                       // hoops
    px(c, x0, y + bh * 0.68, bw, 3, dark);
    px(c, x0, y + bh - 3, bw, 3, '#2A2118');
  }

  function drawCrate(c, x, y, cw, ch) {
    px(c, x, y, cw, ch, TIMBER_LO);
    px(c, x + 2, y + 2, cw - 4, ch - 4, '#8A6436');
    px(c, x + 2, y + 2, cw - 4, 3, '#A88044');
    px(c, x + 2, y + ch * 0.46, cw - 4, 3, '#6E5028');
    px(c, x + cw * 0.44, y + 2, 3, ch - 4, '#6E5028');
  }

  /* -- BENCH at the foot of the A wall, from the reference shot. It is in
     the front pass for draw order, not for occlusion: measured, it covers
     0% of the A DOORWAY silhouette, because that doorway is deep and the
     peeker stands well above the seat. Said plainly because the obvious
     assumption ("front layer, so it must clip the peek") is wrong here. */
  function drawBench(c, w, h) {
    var r = gapPx('adoor', w, h);
    var bx = r.x - w * 0.010, bw = r.w + w * 0.030;
    var by = r.y + r.h - h * 0.016;
    px(c, bx, by, bw, h * 0.016, TIMBER);
    px(c, bx, by, bw, 4, TIMBER_HI);                             // sun on the seat
    px(c, bx, by + h * 0.016, bw, 3, TIMBER_LO);
    px(c, bx + w * 0.014, by + h * 0.016, 6, h * 0.030, TIMBER_LO);   // legs
    px(c, bx + bw - w * 0.026, by + h * 0.016, 6, h * 0.030, TIMBER_LO);
    px(c, bx - 4, by + h * 0.048, bw + 12, 4, 'rgba(60,44,22,0.25)'); // contact shadow
  }

  /* -- PAVING: warm cobble bands that deepen toward the viewer, with joints
     converging on the archway. */
  function drawPaving(c, w, h, horizon) {
    px(c, 0, horizon, w, h - horizon, STONE);
    px(c, 0, horizon, w, 3, '#8A7040');                          // the ground line
    var vx = w * 0.4725, vy = horizon;                           // vanishing point: the arch
    // bands: step grows quadratically so rows read as receding, not stacked
    var y = horizon, step = h * 0.010, k = 0;
    while (y < h) {
      px(c, 0, y, w, 2, k % 2 ? '#A38C62' : STONE_LO);
      if (k % 2) px(c, 0, y + 2, w, Math.max(2, step - 4), 'rgba(255,240,200,0.05)');
      y += step; step *= 1.28; k++;
    }
    // converging joints
    c.save();
    c.strokeStyle = 'rgba(120,100,66,0.40)'; c.lineWidth = 2;
    for (var i = -3; i <= 3; i++) {
      c.beginPath();
      c.moveTo(w * 0.5 + i * w * 0.30, h);
      c.lineTo(vx + i * w * 0.020, vy);
      c.stroke();
    }
    c.restore();
    px(c, 0, horizon, w, h * 0.020, STONE_HI);                   // sunlit strip at the base
  }

  /* -- PALM: six blades off one point. Deliberately flat and dark; a palm
     at this size is a silhouette, and any attempt at fronds becomes noise. */
  function drawPalm(c, x, y, len) {
    c.save();
    px(c, x - 3, y, 6, len * 0.34, '#6B5A34');                   // trunk stub
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI * 0.92 + i * (Math.PI * 0.84 / 5);
      c.fillStyle = i < 3 ? PALM_HI : PALM;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * len * 0.7, y + Math.sin(a) * len * 0.7,
                         x + Math.cos(a) * len, y + Math.sin(a) * len * 0.9);
      c.quadraticCurveTo(x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.5 + 6, x, y + 4);
      c.closePath(); c.fill();
    }
    c.restore();
  }

  /* -- THE WINDOW FRAME. Drawn last, over everything, because it is the
     nearest thing in the scene and because it is what turns a picture into
     an opening. The inner shadow is not decoration: an opening is darker at
     its reveal than at its centre, and that single gradient is most of why
     the ground behind it reads as further away. */
  function drawWindowFrame(c, w, h) {
    var x0 = w * OPEN_X0, x1 = w * OPEN_X1, y0 = h * OPEN_Y0, y1 = h * OPEN_Y1;
    var i;

    // inner shadow, four edges, five steps each — cheap, and entirely flat
    for (i = 0; i < 5; i++) {
      var a = (0.22 - i * 0.042).toFixed(3);
      var d = i * 5;
      px(c, x0 + d, y0, 5, y1 - y0, 'rgba(24,18,10,' + a + ')');
      px(c, x1 - d - 5, y0, 5, y1 - y0, 'rgba(24,18,10,' + a + ')');
      px(c, x0, y0 + d, x1 - x0, 5, 'rgba(24,18,10,' + a + ')');
      px(c, x0, y1 - d - 5, x1 - x0, 5, 'rgba(24,18,10,' + a + ')');
    }

    // --- jambs: plaster with the brick courses showing through at the
    // broken inner edge, which is what makes them read as weathered rather
    // than as two grey bars.
    drawJamb(c, 0, 0, x0, h, +1);
    drawJamb(c, x1, 0, w - x1, h, -1);

    // --- head: rough timber beams across the top, plaster above them
    px(c, 0, 0, w, y0, BRICKED);
    px(c, 0, 0, w, h * 0.030, '#BE9E76');
    var beamH = (y0 - h * 0.042) / 2;
    for (i = 0; i < 2; i++) {
      var by = h * 0.042 + i * beamH;
      px(c, 0, by, w, beamH - 2, TIMBER);
      px(c, 0, by, w, 4, TIMBER_HI);                             // sun along the top
      px(c, 0, by + beamH - 6, w, 4, TIMBER_LO);
      // grain: a few long nicks, never a repeating texture
      for (var g = 0; g < 7; g++) {
        var gx = (g * 0.1487 + i * 0.06) % 1;
        px(c, gx * w, by + beamH * (i ? 0.30 : 0.58), w * 0.070, 2, 'rgba(40,28,14,0.45)');
      }
    }
    px(c, 0, y0 - 3, w, 3, TIMBER_LO);
    // the beams cast onto the top of the view
    px(c, x0, y0, x1 - x0, h * 0.020, 'rgba(30,22,12,0.30)');

    // --- sill: a worn wooden shelf, then the room's own dark interior. The
    // AWP sits against that dark, which is the whole reason it is there.
    px(c, 0, y1, w, h * 0.014, '#C6A874');                       // the lit front lip
    px(c, 0, y1 + h * 0.014, w, h * 0.034, TIMBER);
    px(c, 0, y1 + h * 0.014, w, 3, TIMBER_HI);
    for (i = 0; i < 5; i++) {
      px(c, (i * 0.21 + 0.03) * w, y1 + h * 0.024, w * 0.11, 2, 'rgba(40,28,14,0.40)');
    }
    px(c, 0, y1 + h * 0.048, w, h - (y1 + h * 0.048), '#241D14');
    px(c, 0, y1 + h * 0.048, w, 3, '#150F0A');
  }

  function drawJamb(c, x, y, jw, jh, dir) {
    px(c, x, y, jw, jh, BRICKED);
    // the sunlit face is the left jamb's, the right jamb turns away
    px(c, x + (dir > 0 ? 0 : jw * 0.62), y, jw * 0.38, jh, dir > 0 ? '#C0A57E' : '#8B7154');
    // brick courses along the inner edge, offset every other row
    var inner = dir > 0 ? x + jw - jw * 0.42 : x;
    for (var r = 0, ry = y; ry < y + jh; r++, ry += 18) {
      px(c, inner + (r % 2 ? 6 : 0), ry, jw * 0.42 - (r % 2 ? 6 : 0), 15, r % 3 ? BRICK : '#7D5B3E');
      px(c, inner + (r % 2 ? 6 : 0), ry, jw * 0.42 - (r % 2 ? 6 : 0), 2, '#A87F58');
    }
    // the reveal edge itself: a hard 3px dark line is what reads as a corner
    px(c, dir > 0 ? x + jw - 3 : x, y, 3, jh, '#2B2015');
  }

  /* ======================================================================
     THE ANGLE MARKERS (owner: "it needs to be obvious where the enemies can
     peek"). Five corner brackets, one per entry in ANGLE_DEFS, iterated
     straight off that array — there is deliberately no list of marker
     positions anywhere in this file, because a second list is how a marker
     ends up bracketing a gap that is not the one that opens.

     WHY BRACKETS AND NOT A FILL OR AN OUTLINE. A closed outline reads as a
     hitbox and turns five pieces of architecture into five buttons; a tinted
     fill fights GAP_SHADOW, which is the one thing every peek is read
     against. Corners state the extent of a slice and leave its middle — where
     the silhouette actually appears — completely untouched.

     WHY EACH BRACKET IS TWO-TONE. The cover beside these five gaps ranges
     from teal render at luma 78 to white plaster at 201, so no single colour
     can read against all five. Each arm is therefore a bone segment just
     INSIDE the gap (against GAP_SHADOW, the darkest thing in the scene) with
     a near-black segment just OUTSIDE it (against the lit cover). Lit against
     unlit, in both directions at once — the same trick the gaps themselves
     use, and the reason this holds on plaster and on rusted steel alike.

     LOUD, THEN QUIET. At full strength the brackets would compete with the
     peek itself, which is unacceptable — the silhouette must always be the
     loudest thing on screen. So they open a round at 0.92 alpha and ease down
     to 0.30 over MARK_INTRO_MS, which is the one authored motion moment in
     the scene: the frame you get for orienting yourself, spent as you start
     playing. The only lift after that is the ACTIVE angle's own bracket
     during the tell, and that is not competition — it is the tell. "ARCHWAY"
     is a word a first-timer cannot site; the bracket is what makes it a
     place. It drops back to base the instant the enemy is exposed, so nothing
     is glowing while the shot is live. */
  var MARK_LIT = '#E8E2D0', MARK_DARK = '#100C08';

  function drawAngleMarkers(c, w, h) {
    var t = now();
    // Briefing: hold them at full, because the card is explaining exactly
    // this and the player is reading, not shooting.
    var intro = state === 'briefing' ? 0 : clamp((t - roundStartAt) / MARK_INTRO_MS, 0, 1);
    var ease = 1 - Math.pow(1 - intro, 3);          // ease-out, never linear
    var base = lerp(0.92, 0.30, ease);
    var grow = lerp(5, 0, ease);                    // brackets settle inward
    for (var i = 0; i < ANGLE_DEFS.length; i++) {
      var a = base;
      if (state === 'tell' && i === angleIdx) {
        // ~3Hz, and it is a lift on top of base rather than a replacement, so
        // the tell never reads DIMMER than the four angles it is not naming.
        a = Math.max(a, 0.62 + 0.28 * (0.5 + 0.5 * Math.sin(t / 160)));
      }
      drawBracket(c, angleRectPx(ANGLE_DEFS[i], w, h), a, grow);
    }
  }

  // One gap's four corners. Arm length scales off the rect's short side, so
  // the far ARCHWAY gets a smaller bracket than the near SHORT WALL for free
  // and the markers inherit the scene's size falloff instead of flattening it.
  function drawBracket(c, r, alpha, grow) {
    var x0 = r.x - grow, y0 = r.y - grow;
    var x1 = r.x + r.w + grow, y1 = r.y + r.h + grow;
    var L = clamp(Math.min(r.w, r.h) * 0.34, 7, 26);
    c.save();
    c.globalAlpha = clamp(alpha, 0, 1);
    // the dark half, one step further out — this is what carries the bracket
    // across the pale plaster of the A wall and the cream of the back wall
    corner(c, x0 - 2, y0 - 2, x1 + 2, y1 + 2, L, MARK_DARK);
    corner(c, x0, y0, x1, y1, L, MARK_LIT);
    c.restore();
  }

  function corner(c, x0, y0, x1, y1, L, col) {
    px(c, x0, y0, L, 2, col);        px(c, x0, y0, 2, L, col);          // top-left
    px(c, x1 - L, y0, L, 2, col);    px(c, x1 - 2, y0, 2, L, col);      // top-right
    px(c, x0, y1 - 2, L, 2, col);    px(c, x0, y1 - L, 2, L, col);      // bottom-left
    px(c, x1 - L, y1 - 2, L, 2, col); px(c, x1 - 2, y1 - L, 2, L, col); // bottom-right
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
    // Sun rim down the LEFT edge, matching the scene's one light direction.
    // Without it a dark silhouette inside GAP_SHADOW loses its own outline at
    // 420px and the peek reads as the gap simply getting darker.
    px(c, cx - s * 0.44, cy - s * 0.20, 2, s * 1.5, '#8C907F');
    px(c, cx - s * 0.26, cy - s * 0.72, 2, s * 0.60, '#8C907F');
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
  /* The pip strip, centred on cx. Both the HUD and the round card call THIS —
     the card does not re-derive a second reading of roundResults, for exactly
     the reason the pips exist to guard: two readers of one tally is how one of
     them ends up showing a result the other has not shown yet. */
  var PIP_WON = '#7FE3B0', PIP_LOST = '#C0483C', PIP_EMPTY = '#3A3F4A';
  function drawPips(c, cx, y, pw, ph) {
    var gap = 6, i;
    var x0 = cx - (pw * 3 + gap * 2) / 2;
    for (i = 0; i < 3; i++) {
      var col = i < roundResults.length ? (roundResults[i] ? PIP_WON : PIP_LOST) : PIP_EMPTY;
      px(c, x0 + i * (pw + gap), y, pw, ph, '#000000');
      px(c, x0 + i * (pw + gap) + 1, y + 1, pw - 2, ph - 2, col);
    }
  }

  function drawHud(c, w, h) {
    drawPips(c, w / 2, 10, 20, 10);
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

  /* ======================================================================
     THE CARDS — the briefing, the round result, the LAN result.

     One piece of chrome does all three, because they are one thing: a beat
     the game stops on until the player taps. Broadcast register rather than
     Mirage's warm sandstone — this is the UI talking, not the map, and the
     literals below are the app's own tokens (--panel #233863, --panel-lo
     #1B284A, --outline #0b0e1c, --bevel-hi/--bevel-lo, --cash, --danger,
     --ink) so the card belongs to the same world as every other panel in the
     game. Canvas cannot read CSS variables, which is why they are literals
     here for the same reason the map's palette is — if tokens.css moves one
     of these, this list moves with it.

     Anatomy, top to bottom: a 5px result-coloured bar, a recessed header band
     carrying the one word that matters, the running score, the pip strip
     (the SAME drawPips() the HUD uses), and the tap bar.

     THE TAP BAR IS THE GATE MADE VISIBLE. It fades in only once CARD_LOCK_MS
     has elapsed, so the card never shows an affordance it is about to ignore
     — a button that is drawn and dead is worse than the stray tap it was
     guarding against. The whole canvas is the tap target, not just the bar;
     the bar says what a tap will do. */
  var C_PANEL = '#233863', C_PANEL_LO = '#1B284A', C_PANEL_HI = '#38447f';
  var C_OUTLINE = '#0b0e1c', C_BEV_HI = '#6675c4', C_BEV_LO = '#151b3c';
  var C_INK = '#eaf0ff', C_INK_DIM = '#c2cbee', C_INK_HEAD = '#FFFFFF';
  var C_GOOD = '#3ddc84', C_BAD = '#ff4b4b', C_GOLD = '#ffc93c';

  // The briefing, in the game's voice and no longer than it has to be. It
  // teaches the three things nothing else in the game can: the verb, the
  // tell, and why a miss costs a round.
  var BRIEF_LEAD = 'You are the AWPer. This site is yours to hold.';
  var BRIEF_RULES = [
    'TAP where you want to shoot — the AWP flicks there, scopes and fires.',
    'Footsteps name the angle a moment before it opens. Re-aim while you hear them.',
    'After every shot the bolt cycles for over a second and nothing peeks. A miss is usually the round.'
  ];
  var BRIEF_TAIL = 'Best of three rounds. Win two.';

  // Greedy word wrap against the real measured advance, not a characters-per-
  // line guess — the body copy is the one place in this file where a wrong
  // guess would push text through the panel's edge.
  function wrapText(c, text, size, maxW) {
    c.font = '700 ' + size + 'px ui-monospace, Menlo, Consolas, monospace';
    var words = text.split(' '), out = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + ' ' + words[i] : words[i];
      if (line && c.measureText(next).width > maxW) { out.push(line); line = words[i]; }
      else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  // The score the owner asked for, derived from roundResults and nothing
  // else. roundsWon/roundsLost exist for the ROUNDS_TO_WIN threshold; adding
  // a third reading of the same tally is how two of them drift apart.
  function scoreLine() {
    var won = 0, lost = 0;
    for (var i = 0; i < roundResults.length; i++) { if (roundResults[i]) won++; else lost++; }
    return 'YOU ' + won + ' — ' + lost + ' THEM';
  }

  function easeOut(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }

  function drawCard(c, w, h) {
    if (state !== 'briefing' && state !== 'roundCard' && state !== 'matchCard') return;
    var t = now();
    var e = easeOut((t - cardOpenAt) / CARD_IN_MS);

    // The scrim rises with the card rather than snapping — the scene stays
    // legible underneath, so the player keeps their bearings on the site.
    px(c, 0, 0, w, h, 'rgba(10,8,6,' + (0.80 * e).toFixed(3) + ')');

    var u = clamp(w / 420, 0.85, 2);
    var x0 = Math.round(26 * u), x1 = w - Math.round(26 * u), pw2 = x1 - x0;
    var inner = Math.round(16 * u);
    var textW = pw2 - inner * 2;
    var tapH = Math.max(46, Math.round(46 * u));   // 44px floor, with room to spare
    var briefing = state === 'briefing';
    var won = briefing ? false : (state === 'matchCard' ? matchWon
                                 : roundResults[roundResults.length - 1] === true);
    var accent = briefing ? C_GOLD : (won ? C_GOOD : C_BAD);

    // ---- measure, then place. Everything below is laid out from the content
    // out, so a longer briefing line grows the panel instead of overflowing it.
    var accentH = 5;
    var headH = Math.round((briefing ? 34 : 52) * u);
    var lead = [], rules = [], tailRows = [], bodyH = 0, i, j;
    if (briefing) {
      lead = wrapText(c, BRIEF_LEAD, 12, textW);
      for (i = 0; i < BRIEF_RULES.length; i++) {
        rules.push(wrapText(c, BRIEF_RULES[i], 11.5, textW - Math.round(14 * u)));
      }
      tailRows = wrapText(c, BRIEF_TAIL, 12, textW);
      bodyH = 14 + lead.length * 17 + 12;
      for (i = 0; i < rules.length; i++) bodyH += rules[i].length * 16 + 10;
      bodyH += 4 + tailRows.length * 17;
    } else {
      bodyH = 18 + 18 + 14 + 14;                   // score row, gap, pips, gap
    }
    var panelH = accentH + headH + bodyH + 14 + tapH + inner;
    var y0 = Math.round((h - panelH) / 2) + Math.round((1 - e) * 14);

    c.save();
    c.globalAlpha = e;

    // ---- the panel: 2px outline, then the face, then a real bevel (a light
    // inner top edge and a dark inner bottom one), per ART-DIRECTION §2.1/2.4.
    px(c, x0 - 2, y0 - 2, pw2 + 4, panelH + 4, C_OUTLINE);
    px(c, x0, y0, pw2, panelH, C_PANEL);
    px(c, x0, y0, pw2, accentH, accent);                       // the result bar
    px(c, x0, y0 + accentH, pw2, 2, C_BEV_HI);
    px(c, x0, y0 + panelH - 2, pw2, 2, C_BEV_LO);

    // ---- header band, recessed, carrying the one word that matters
    var hy = y0 + accentH + 2;
    px(c, x0, hy, pw2, headH, C_PANEL_LO);
    px(c, x0, hy + headH, pw2, 2, C_OUTLINE);
    var title = briefing ? 'YOUR FIRST LAN'
              : state === 'matchCard' ? (won ? 'CLUTCHED' : 'LAN LOST')
              : (won ? 'ROUND WON' : 'ROUND LOST');
    pixelText(c, title, x0 + pw2 / 2, hy + headH / 2,
              Math.round((briefing ? 15 : 26) * u),
              briefing ? C_INK_HEAD : accent, 'center');

    var y = hy + headH + 2;
    if (briefing) {
      y += 14;
      for (i = 0; i < lead.length; i++) { pixelText(c, lead[i], x0 + inner, y + 8, 12, C_INK); y += 17; }
      y += 12;
      // A drawn 3px gold tick per rule — an authored mark, not a bullet glyph
      // (ART-DIRECTION §2.5: nothing Unicode does icon duty in this game).
      for (i = 0; i < rules.length; i++) {
        px(c, x0 + inner, y + 4, 3, rules[i].length * 16 - 6, C_GOLD);
        for (j = 0; j < rules[i].length; j++) {
          pixelText(c, rules[i][j], x0 + inner + Math.round(14 * u), y + 8, 11.5, C_INK);
          y += 16;
        }
        y += 10;
      }
      y += 4;
      for (i = 0; i < tailRows.length; i++) { pixelText(c, tailRows[i], x0 + inner, y + 8, 12, C_INK_DIM); y += 17; }
    } else {
      y += 18;
      pixelText(c, scoreLine(), x0 + pw2 / 2, y, Math.round(15 * u), C_INK, 'center');
      y += 18;
      drawPips(c, x0 + pw2 / 2, y, Math.round(26 * u), 12);
      y += 14 + 14;
    }

    // ---- the tap bar, and only once the gate is open
    var tapA = easeOut((t - cardOpenAt - CARD_LOCK_MS) / TAP_IN_MS);
    if (tapA > 0) {
      var ty = y0 + panelH - inner - tapH;
      c.globalAlpha = e * tapA;
      px(c, x0 + inner - 2, ty - 2, textW + 4, tapH + 4, C_OUTLINE);
      px(c, x0 + inner, ty, textW, tapH, C_PANEL_HI);
      px(c, x0 + inner, ty, textW, 2, C_BEV_HI);
      px(c, x0 + inner, ty + tapH - 2, textW, 2, C_BEV_LO);
      var tapLabel = briefing ? 'TAP TO HOLD THE ANGLE'
                   : state === 'matchCard' ? 'TAP TO CONTINUE'
                   : 'TAP FOR ROUND ' + (currentRound + 1);
      pixelText(c, tapLabel, x0 + pw2 / 2, ty + tapH / 2, Math.round(12 * u), C_INK_HEAD, 'center');
    }
    c.restore();
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

    // Back scene -> enemy -> front scene. The sandwich is the whole point:
    // the low wall's cap and the front barrel row are painted AFTER the
    // silhouette, so a peeker is cut off by the cover it is peeking from.
    drawSceneBack(c, w, h);
    // The brackets go INSIDE the sandwich, not on top of it: painted after
    // the back scene but before the enemy and the front scene, so the low
    // wall's cap and the front barrel row cut across them exactly as they cut
    // across a peeker. A marker floating over the cover it belongs behind is
    // the thing that would make these read as UI stuck onto the map.
    drawAngleMarkers(c, w, h);
    drawEnemy(c, w, h);
    drawSceneFront(c, w, h);
    if (state !== 'flicking') drawReticle(c);
    drawAwp(c, w, h);
    drawScope(c, w, h);
    if (state === 'dead') {
      var dt2 = clamp((now() - deathStart) / DEATH_MS, 0, 1);
      px(c, 0, 0, w, h, 'rgba(200,20,20,' + (0.55 * dt2).toFixed(2) + ')');
    }
    drawHud(c, w, h);
    drawCard(c, w, h);      // last: the card is the only thing that outranks the gun
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

       These drive the REAL endMatch(), so the done() callback and the teardown
       all run exactly as they do in play. They do not shortcut to the
       callback, because a seam that bypasses the code under test proves
       nothing.

       V23b: they set seamSkipsCard first, so endMatch() resolves straight to
       finish() instead of parking on the match card. A HEADLESS CALLER HAS NO
       WAY TO TAP, so without this the seams would never reach done() and any
       suite driving the accept -> play -> resolve chain would hang rather than
       fail. The gate is the only thing skipped; everything else is the same
       path a played-out LAN takes. */
    __win: function () { if (!active) return false; seamSkipsCard = true; endMatch(true); return true; },
    __fail: function () { if (!active) return false; seamSkipsCard = true; endMatch(false); return true; }
  };
})(window.Game = window.Game || {});
