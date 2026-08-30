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

   ART — TWO MAPS, held in a TABLE (CLUTCH_MAPS), one picked per run with no
   immediate repeat. Everything that differs between environments — the five
   angles, the gap colour, the framing opening, the name and the back/front
   draw pair — is one entry's worth of data, exactly the way js/matchgames.js
   holds BH_MAPS. A third map is a new entry and a new draw pair, and nothing
   below the table asks which map is loaded.

   MIRAGE MID, seen from inside the window (owner's reference shot, V23a). The whole view is framed by that window: timber beams overhead,
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
   over it. See each map's back/front draw pair.

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

   The tell, the peek and the hitbox all read the ACTIVE MAP's angle array,
   through defs(), and there is only ever one of those. A
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
      first. drawAngleMarkers() brackets each gap, and it iterates defs()
      directly — there is no second list of marker positions, because a second
      list is how a marker ends up on a different angle from the one that
      opens (§5.4 again, same rule as the tell). The brackets are loudest at
      the top of a round and settle back to a whisper once play begins, and
      the named angle's own bracket lifts during the tell, so the footstep
      call becomes a PLACE rather than a word a new player cannot site.

   ---------------------------------------------------------------------------
   V23c — SHARP TEXT, AND A SECOND SITE

   1. THE TEXT WAS PIXELATED, AND THE CAUSE WAS THE BACKING STORE. sizeCanvas()
      sized the buffer in CSS pixels with no devicePixelRatio factor, so on any
      DPR>1 display the browser scaled a 420-wide buffer up to the element's
      840 or 1260 real pixels — nearest-neighbour, because
      imageSmoothingEnabled is false. Vector text drawn at 1x and pixel-
      duplicated 2-3x is exactly "very pixelated and hard to read".

      The fix is one transform and NOT a single change to any draw call: the
      buffer is now sized in device pixels and the context is pre-scaled by a
      clamped DPR, so every draw still issues CSS-pixel coordinates. W and H
      still mean CSS pixels, which is what every fractional angle rect, every
      hit test and pt() all depend on. See sizeCanvas() for the full note,
      including why the smoothing flag stays off.

   2. TWO MAPS, HELD AS DATA. The single hardcoded Mirage scene became
      CLUTCH_MAPS, and ANCIENT joined it: Mayan jungle ruins in cool grey-
      green limestone, deliberately the opposite temperature to Mirage's warm
      sand, with its five angles sited in a pyramid tier, a temple mouth, a
      planked door, a crate stack and a sign post. The map is picked once per
      run with no immediate repeat — once per RUN and not per round, because a
      site that changed mid-LAN would throw away everything the player learned
      holding it.

      NOTHING ABOUT THE GAME CHANGED WITH EITHER OF THESE. The flick band, the
      bolt cycle, best-of-3, the death read, the briefing latch, the round
      cards and the whole public API are the same values and the same code.
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
     gap. The gap itself is always the map's own `gap` colour, because a
     doorway or a shaded recess read from out in the sun is the darkest thing
     in the scene no matter what surrounds it. That is the whole reason this
     holds across materials as different as painted render, fired plaster,
     rusted steel and weathered limestone: we are not contrasting a colour
     against a colour, we are contrasting lit against unlit.

     Luminance below is Rec.709 relative luma (0.2126R + 0.7152G + 0.0722B on
     the 0-255 scale). Every pair is re-measured in the verification pass
     rather than taken on trust — HANDOFF-V2 §5.9, comments lie and
     measurements do not.
     ===================================================================== */

  /* ---- MIRAGE MID ------------------------------------------------------
     Seen from inside the window. MIRAGE_GAP sits at luma 19.6; the darkest
     cover in this set is BLUE HOUSE's teal render at 97.6 declared and the
     lightest is A DOORWAY's plaster at 220.5.

     MEASURED, on the rendered pixels rather than on these literals: the seven
     pixels immediately beside each gap average 106 / 213 / 98 / 182 / 193
     against unoccluded gap interiors of 20 / 21 / 20 / 39 / 21, so the worst
     separation on this map is BARRELS at 77.9. Declared and rendered are
     different numbers on purpose — the literal is the material, the
     measurement is what a lit or shaded edge actually leaves next to the gap,
     and only the second one is what the player's eye gets. */
  var MIRAGE_GAP = '#171310';
  var MIRAGE_ANGLES = [
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

  /* Where the window's opening is, as fractions of the canvas. Mirage's frame
     is drawn over these edges last (drawWindowFrame), and every Mirage gap
     lives strictly inside them — a peek angle hidden behind a timber beam is
     an unwinnable round, so this relationship is asserted in the verification
     pass rather than eyeballed. */
  var MIRAGE_OPEN = { x0: 0.105, x1: 0.895, y0: 0.135, y1: 0.865 };

  /* ---- ANCIENT ---------------------------------------------------------
     Mayan jungle ruins, from the owner's reference shot. THE COOL MAP: every
     structural surface is grey-green weathered limestone, and it must never
     read as Mirage's warm sand — that is the whole reason a second map earns
     its place. Warmth exists here only where a material is genuinely warm
     (the planked door, the crates) and colour exists only where the map
     itself is saturated (foliage, and the yellow signage).

     THE CONTRAST PROBLEM THIS MAP HAS AND MIRAGE DOES NOT. Mirage's covers
     are plaster, cream and painted render — bright by nature, so its gaps
     separate almost for free. Ancient's covers are stone at half that value,
     so ANCIENT_GAP is pushed darker AND cooler than Mirage's (17.0 vs 19.6,
     and green-black rather than brown-black) and every gap is deliberately
     sited against the LIT face of its cover rather than a shaded one. The
     failure mode being designed against is a gap that reads as "just more
     stone"; the verification pass measures all five pairs.

     The five are sited in real architecture, not floated as rectangles:
     past a pyramid tier's corner, out of the temple's dark mouth, out of the
     planked double door, from behind the crate stack, and past the PLAZA A
     sign post. Staggered in depth for the same reason Mirage's are — five
     abreast will not fit across the opening once each has cover wide enough
     to measure against. */
  var ANCIENT_GAP = '#0E1210';
  var ANCIENT_ANGLES = [
    // Past the right-hand corner of the stepped pyramid tiers on the left.
    // Its cover is a sunlit tread, the brightest limestone on the map, which
    // is what makes the nearest-left angle also the plainest read.
    { id: 'tier',   label: 'TIER CORNER',  gx: 0.140, gy: 0.430, gw: 0.115, gh: 0.245, cover: '#B9C2AC' },
    // The temple's dark mouth in the centre distance, up on the tiers.
    // Furthest away, so the smallest rect — drawEnemy sizes off the rect, so
    // the silhouette inherits the falloff without a constant anywhere.
    { id: 'mouth',  label: 'TEMPLE MOUTH', gx: 0.300, gy: 0.255, gw: 0.105, gh: 0.140, cover: '#8A9682' },
    // The planked wooden double door set into the stone at centre. The only
    // warm cover on the map and the lowest-contrast pair in the set, which is
    // why the lit plank face — not the shadowed one — is what abuts the gap.
    { id: 'door',   label: 'WOOD DOOR',    gx: 0.480, gy: 0.330, gw: 0.120, gh: 0.215, cover: '#9C6E3C' },
    // The slot between the stacked crates on the flagstones. Nearest and
    // lowest, so the biggest rect, and drawn in two passes so the front crate
    // genuinely cuts the peeker off at the waist.
    { id: 'crates', label: 'CRATES',       gx: 0.330, gy: 0.585, gw: 0.165, gh: 0.155, cover: '#A8814A' },
    // Past the PLAZA A sign post on the right. The sign is the map's one
    // saturated accent, so the yellow IS the cover here — the strongest pair
    // on the map, sat opposite the weakest.
    { id: 'sign',   label: 'PLAZA SIGN',   gx: 0.740, gy: 0.440, gw: 0.125, gh: 0.250, cover: '#E8C33A' }
  ];
  /* Ancient's foreground is a stone portal rather than Mirage's timber
     window: two heavy limestone piers, a mossy lintel and a worn ledge. It
     does the same structural job — it is what buys the scene a real
     foreground so depth comes from overlap and size falloff — while being
     unmistakably a different place to stand. Wider and taller than Mirage's
     opening, because a temple portal is. */
  var ANCIENT_OPEN = { x0: 0.085, x1: 0.915, y0: 0.125, y1: 0.870 };

  /* ---- INFERNO ---------------------------------------------------------
     An Italian village street, from the owner's reference shot, seen from
     under a stone arcade. THE WARM MAP, and the third temperature the set
     needed: Mirage is bleached sand, Ancient is cool grey-green stone, and
     this one is warm cream ashlar with a genuinely saturated mass running
     through it. Three maps that all sat in the same third of the wheel would
     have been one map painted three times.

     THE SIGNATURE IS THE PATH, not the buildings. A broad terracotta brick
     strip runs away down the centre between grey cobbles, narrowing as it
     recedes, and it is the one saturated mass in the scene. It does the
     depth work here that Mirage's paving and Ancient's flagstones do on
     theirs — except that being red against grey, it also tells the eye where
     the street goes in a single glance at 420px.

     THE CONTRAST PROBLEM THIS MAP HAS IS THE OPPOSITE OF ANCIENT'S. Ancient's
     covers are stone at half Mirage's value, so its risk was gaps that read
     as "just more stone". Inferno's covers are cream plaster, sunlit ashlar
     and white tablecloth — bright for free — so its risk is the reverse:
     THE DARK THINGS. A shaded arcade recess, a wrought-iron railing, a
     chalkboard, a shuttered door, the shadowed cheek of a crate or a cloth
     turning away from the sun — every one of those is a dark mass that, sat
     beside a gap, makes the gap vanish and takes a dark-clothed silhouette
     with it. Three rules follow, and all three are load-bearing:
       - Every dark prop is sited x- or y-DISJOINT from every gap rect, and
         that is asserted arithmetically, not eyeballed.
       - The face that abuts each gap is always the LIT one, and where the
         light direction says otherwise (the tablecloth's right fold, the
         pot's right cheek) a raking rim is painted in explicitly — the same
         move Ancient makes on its crate slot, for the same reason.
       - INFERNO_GAP is the darkest of the three maps' gaps (15.9 against
         Mirage's 19.6 and Ancient's 17.0), because the brightest map should
         also carry the deepest holes in it.

     The five are sited in real architecture: the corner of the trattoria's
     plastered wall, the green shopfront's doorway at the end of the street,
     the slot between two arcade piers, the gap between two cafe tables, and
     the space past the parked car's bonnet. Staggered in depth for the same
     reason Mirage's and Ancient's are — five abreast will not fit across the
     opening once each has cover wide enough to measure against. Their feet
     climb the picture in order: shop 0.470, pier 0.575, corner 0.600,
     tables 0.815, car 0.835, which IS the depth ladder.

     WHAT THE FIRST PASS GOT WRONG, and the render caught rather than the
     arithmetic: every angle was sited 0.08 too far left, which put the
     trattoria's sign, its door and the chalkboard behind the arcade's own
     left jamb. All five checks passed on a scene whose whole left-hand third
     was invisible — a reminder that "inside the opening" is a property of
     the gaps and says nothing about the architecture they are sited in. */
  var INFERNO_GAP = '#140F0C';
  var INFERNO_ANGLES = [
    // Round the corner where the trattoria's plastered wall ends and a side
    // alley cuts away. Its cover is a chain of sunlit ashlar quoins — the
    // corner stones a rendered wall is actually finished with, so the
    // brightest thing on that wall is exactly what the gap is read against.
    { id: 'corner', label: 'WALL CORNER', gx: 0.215, gy: 0.395, gw: 0.118, gh: 0.205, cover: '#F4E8CB' },
    // Out of the green shopfront's doorway at the end of the street, under
    // its awning. Furthest away, so the smallest rect — drawEnemy sizes the
    // silhouette off the rect, so the falloff needs no constant anywhere.
    { id: 'shop',   label: 'SHOP DOOR',   gx: 0.400, gy: 0.335, gw: 0.108, gh: 0.135, cover: '#57A56D' },
    // The shaded slot between two piers of the arcade, further down the
    // right-hand side. A pier is a square column: the face it shows the
    // street is the face the sun is on, and it is that face — not a shaded
    // return — that both cheeks of this gap are made of.
    { id: 'pier',   label: 'ARCADE PIER', gx: 0.600, gy: 0.360, gw: 0.115, gh: 0.215, cover: '#F4E8CB' },
    // Between the two cafe tables on the pavement. Nearest on the left, and
    // drawn in two passes so a nearer table genuinely cuts the peeker off at
    // the waist rather than the silhouette being pasted over the cloth.
    { id: 'tables', label: 'CAFE TABLES', gx: 0.140, gy: 0.678, gw: 0.145, gh: 0.137, cover: '#EFE4D4' },
    // Past the parked car in the near right corner. The red bonnet is the
    // cover, which makes this the map's one angle read against a saturated
    // colour rather than a neutral — Ancient sites its PLAZA SIGN the same
    // way, and for the same reason: five identical reads is one read.
    { id: 'car',    label: 'RED CAR',     gx: 0.620, gy: 0.660, gw: 0.140, gh: 0.175, cover: '#C0392B' }
  ];
  /* Inferno's foreground is an ARCADE — a vaulted arch overhead and one
     heavy square pier down the right-hand side. Mirage frames with a timber
     window, Ancient with a stone portal, and this with an arcade, so the
     three read as three places to stand rather than one frame recoloured.

     IT IS DELIBERATELY ASYMMETRIC, which neither of the others is: the pier
     eats 18% of the width on the right and the left jamb is a sliver. That
     asymmetry is the cheapest way to make a third frame feel like a third
     frame, and it costs nothing but these two numbers.

     NOTE THAT THE REAL OPENING IS SMALLER THAN THIS RECT AT THE EDGES,
     because the head of it is a vault and not a lintel: the soffit curves
     down to its springing at both jambs. So "inside `open`" is necessary but
     NOT sufficient here, and the verification pass checks every gap against
     the arch curve itself as well — a peek angle behind a voussoir is an
     unwinnable round exactly as one behind a beam would be. */
  var INFERNO_OPEN = { x0: 0.055, x1: 0.840, y0: 0.145, y1: 0.860 };

  /* ======================================================================
     THE MAP TABLE (V23c)

     Everything that differs between environments lives in ONE object per
     map here — its angles, its gap colour, its opening, its label and its
     back/front draw pair — exactly the way js/matchgames.js holds BH_MAPS,
     and for the same reason: a third map must be DATA, not another branch
     inside a renderer. Nothing below this table asks which map is loaded.
     If adding a map means editing a draw function, the seam is wrong.

     TO ADD A MAP: write drawXBack(c, w, h) and drawXFront(c, w, h), then add
     one entry here. That is the whole change. Function declarations hoist, so
     the pair may be authored anywhere in this file, below the table included.

     Every entry MUST carry exactly ANGLE_COUNT angles — pickAngle() rolls
     against that constant, and a short table would index past the end. It is
     asserted at load, loudly, because the failure otherwise surfaces as a
     silent crash mid-round rather than at the seam that caused it.

     PICKED PER RUN WITH NO IMMEDIATE REPEAT, the rule pickGame() and
     pickMap() already apply in js/matchgames.js: with two maps a naive coin
     flip repeats half the time, which reads as "it only has one map". */
  var CLUTCH_MAPS = {
    mirage: {
      id: 'mirage',
      name: 'MIRAGE MID',
      gap: MIRAGE_GAP,
      open: MIRAGE_OPEN,
      angles: MIRAGE_ANGLES,
      back: drawMirageBack,
      front: drawMirageFront
    },
    ancient: {
      id: 'ancient',
      name: 'ANCIENT PLAZA',
      gap: ANCIENT_GAP,
      open: ANCIENT_OPEN,
      angles: ANCIENT_ANGLES,
      back: drawAncientBack,
      front: drawAncientFront
    },
    inferno: {
      id: 'inferno',
      name: 'INFERNO STREET',
      gap: INFERNO_GAP,
      open: INFERNO_OPEN,
      angles: INFERNO_ANGLES,
      back: drawInfernoBack,
      front: drawInfernoFront
    }
  };
  var CLUTCH_MAP_IDS = Object.keys(CLUTCH_MAPS);
  CLUTCH_MAP_IDS.forEach(function (k) {
    if (CLUTCH_MAPS[k].angles.length !== ANGLE_COUNT) {
      throw new Error('clutch map "' + k + '" has ' + CLUTCH_MAPS[k].angles.length +
                      ' angles, ANGLE_COUNT is ' + ANGLE_COUNT);
    }
  });

  // The loaded map. Everything downstream reads THIS, never a map id — there
  // is no `if (mapId === ...)` anywhere in this file and there must not be.
  var activeMap = CLUTCH_MAPS[CLUTCH_MAP_IDS[0]];
  var lastMapId = null;
  function pickMap() {
    var pool = CLUTCH_MAP_IDS.filter(function (id) { return id !== lastMapId; });
    lastMapId = pool[Math.floor(rng() * pool.length)] || CLUTCH_MAP_IDS[0];
    activeMap = CLUTCH_MAPS[lastMapId];
    return activeMap;
  }
  // The active map's angle array. One accessor, so the tell, the peek, the
  // hitbox and the markers cannot end up reading different maps' arrays.
  function defs() { return activeMap.angles; }

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
  /* The art reads its gap positions back OUT of the active map's angle array
     by id, so a piece of architecture and the hitbox it belongs to can never
     drift apart. This is the reason no draw function has a coordinate literal
     for any of the five openings — HANDOFF-V2 §5.4, the second copy is the
     bug. A map's draw pair only ever asks for ITS OWN ids, and it is only
     ever called while its own map is active. */
  function defById(id) {
    var a = defs();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return a[0];
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
      // No map name baked in here: run() names the site the instant it has
      // picked one, and a stale name in the markup is a second source of
      // truth for which map is loaded.
      '<div class="mg-match__label" id="clutch-label">THE CLUTCH</div>' +
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
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }

  /* Pointer -> CSS-pixel canvas coordinates. W/H are CSS pixels (see
     sizeCanvas below) and getBoundingClientRect() is CSS pixels, so this
     ratio is 1 up to sizeCanvas's own rounding — it is kept rather than
     dropped because the element's box can be a fractional width while W is
     an integer, and half a pixel of drift at the edge of a 120px-wide gap is
     free to correct here.

     THIS MUST NOT READ canvas.width/canvas.height. Since V23c the backing
     store is DPR-scaled, so canvas.width is 2x or 3x W on a phone; dividing
     by r.width with that numerator would hand the hit-test device pixels
     while every gap rect is still in CSS pixels, and every shot would land
     two or three times too far from the crosshair. */
  function pt(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height)
    };
  }

  /* THE BACKING STORE IS DEVICE PIXELS; EVERYTHING ELSE IS CSS PIXELS.

     Before V23c this sized the buffer in CSS pixels with no devicePixelRatio
     factor at all, so on any DPR>1 display — which is every phone the owner
     playtests on — the browser stretched a 420-wide buffer across a 840- or
     1260-wide element. With imageSmoothingEnabled = false that upscale is
     nearest-neighbour, and vector text blown up 2-3x by pixel duplication is
     exactly the "very pixelated and hard to read" the owner reported.

     The fix is one transform, not a redraw: the buffer is sized in DEVICE
     pixels and the context is pre-scaled by dpr, so every draw call in this
     file keeps issuing CSS-pixel coordinates and lands on a native-resolution
     surface. W and H therefore still mean CSS pixels — every angle's fractional
     rects, angleRectPx(), pointInRect() and pt() above all depend on that,
     and if a draw call ever needs compensating for the DPR, the transform is
     the thing that is wrong.

     DPR IS CLAMPED TO 3. A 4x buffer on a 420x860 element is ~4.3 million
     pixels repainted every frame on a phone, for a sharpness gain no eye
     collects; 3 already exceeds every display this game is played on.

     imageSmoothingEnabled STAYS FALSE. That flag governs drawImage() and
     pattern scaling — it has never had anything to do with text, which is
     vector and is rasterised at the transform's scale. Keeping it off
     preserves the hard-edged pixel-art register of the scene; the text is
     sharp now because the buffer is native, not because the flag moved. */
  var MAX_DPR = 3;
  function sizeCanvas() {
    // Measure the CANVAS's own box, not the overlay's — V22d's exact trap.
    // The overlay also carries the label row, so it is taller than the
    // canvas; sizing off it gives the backing store more rows than the
    // element displays and the browser squashes every frame to fit.
    var r = canvas.getBoundingClientRect();
    var cssW = Math.max(1, Math.round(r.width));
    var cssH = Math.max(1, Math.round(r.height));
    var dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    W = cssW; H = cssH;
    // setTransform, not scale(): this runs again on every resize, and scale()
    // would compound onto the transform the previous call left behind.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  /* Re-size on rotation and on a move between displays of different DPR.
     Bound once, in build(), and it does nothing unless a LAN is actually
     open. The resting crosshair is carried across PROPORTIONALLY rather than
     left at stale pixels: the player is holding an angle, and an angle is a
     place in the scene, which is a fraction of the canvas — not a pixel. */
  function onResize() {
    if (!active || !canvas) return;
    var fx = W > 0 ? aimX / W : 0.5, fy = H > 0 ? aimY / H : 0.5;
    sizeCanvas();
    aimX = fx * W; aimY = fy * H;
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
    var rect = angleRectPx(defs()[angleIdx], W, H);
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

       drawMirageBack()  sky, minaret, back wall + archway, blue house,
                         A wall, the paving, and the FAR half of the low
                         wall and the barrel stacks — every gap is punched
                         here, so the enemy always has something dark behind.
       drawEnemy()       the silhouette, inside the active gap only.
       drawMirageFront() the NEAR half of the low wall, the front barrel row,
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

  function drawMirageBack(c, w, h) {
    var y1 = h * MIRAGE_OPEN.y1;
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
  }

  function drawMirageFront(c, w, h) {
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
    c.fillStyle = MIRAGE_GAP;
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
    // immediately left of it and along its top — see MIRAGE_ANGLES.
    px(c, r.x, r.y, r.w, r.h, MIRAGE_GAP);
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
    c.fillStyle = MIRAGE_GAP;
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
    px(c, r.x, r.y, r.w, r.h, MIRAGE_GAP);                       // THE PEEK
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
    px(c, r.x, r.y, r.w, r.h, MIRAGE_GAP);                       // THE PEEK slot
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
    var x0 = w * MIRAGE_OPEN.x0, x1 = w * MIRAGE_OPEN.x1, y0 = h * MIRAGE_OPEN.y0, y1 = h * MIRAGE_OPEN.y1;
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
     DRAW — ANCIENT, the plaza outside the temple.

     Same sandwich as Mirage and for the same reason: back scene, silhouette,
     front scene, so a peeker is cut off by the cover it is peeking from
     rather than pasted over it. Same one light direction too — sun from the
     upper left, every lit edge a top or left edge, every shadow falling right
     and down. What changes is the WORLD, and the change is deliberate and
     total: Mirage is warm sand under a bleached sky, Ancient is cool grey-
     green limestone under jungle. Two maps that both read as "sunlit ruins"
     would have been one map drawn twice.

     THE RULE THAT SHAPES EVERY DRAW BELOW: the LIT face of a material is
     what abuts each gap. Ancient's stone sits around luma 146 where Mirage's
     plaster sits at 220, so a gap placed against a SHADED return here would
     leave forty-odd units of separation and read as "just more stone" — the
     exact failure this map was most at risk of. Against a sunlit tread, a
     sunlit plank or a yellow sign board it clears 103 at worst.

     MEASURED, on the rendered pixels: covers of 177 / 144 / 143 / 121 / 161
     against unoccluded gap interiors of 19 / 17 / 17 / 17 / 17, so the worst
     separation here is CRATES at 103.6 — comfortably wider than Mirage's
     worst (BARRELS, 77.9), which is what a darker palette had to buy back.
     Three of those five only reached that after the measurement pass sent
     them back: the door leaf's leading edge, the crate stack's return and
     the sign board's trim were all dark exactly where the gap needed light.
     The eye did not catch any of them.
     ====================================================================== */

  // Cool where Mirage is warm. Named by material, same as Mirage's palette,
  // so a colour is chosen by asking what a thing is made of.
  var A_SKY_TOP = '#4E86A8', A_SKY = '#7FA8C4', A_SKY_HAZE = '#BBD0D6';
  var LIME    = '#8A9682', LIME_HI = '#B9C2AC', LIME_LO = '#5D6857', LIME_DK = '#3E463C';
  var MORTAR  = '#727E6B';
  var MOSS    = '#4E6B33', MOSS_HI = '#6F8F44';
  var LEAF    = '#3C5A2A', LEAF_HI = '#5E8438', LEAF_DK = '#24371A';
  var A_WOOD  = '#7A5228', A_WOOD_HI = '#9C6E3C', A_WOOD_LO = '#4E3418';
  var A_CRATE = '#8C6A3C', A_CRATE_HI = '#A8814A', A_CRATE_LO = '#5A421F';
  var A_YELLOW = '#E8C33A', A_YELLOW_LO = '#B08F22';
  var A_FLAG  = '#7C8477', A_FLAG_HI = '#9AA294', A_FLAG_LO = '#5A6156';
  var A_IRON  = '#3B3A36';

  function drawAncientBack(c, w, h) {
    var horizon = h * 0.560;                 // where the flagstones meet the ruin

    // ---- sky: a real glimpse of blue top-centre, hazing to pale at the
    // canopy line. Cooler and lighter with distance, the same aerial
    // perspective Mirage uses — it does more work here than any detail.
    px(c, 0, 0, w, horizon, A_SKY);
    px(c, 0, 0, w, h * 0.22, A_SKY_TOP);
    px(c, 0, h * 0.40, w, horizon - h * 0.40, A_SKY_HAZE);

    // ---- the jungle closing the plaza in. A ragged canopy band, flat and
    // dark: at 420px wide a canopy is a silhouette, and any attempt at
    // individual leaves collapses into noise.
    drawCanopy(c, w, h);

    // ---- the ruin's back wall, then the ground, then everything standing
    // on it. Ground before uprights, so every upright can lay its own
    // contact shadow onto stone that is already there.
    drawAncientWall(c, w, h, horizon);
    drawFlagstones(c, w, h, horizon);
    drawJungleTree(c, w, h);                 // middle distance, behind the ruins
    drawCentreTiers(c, w, h);                // punches TEMPLE MOUTH
    drawWoodDoor(c, w, h);                   // punches WOOD DOOR
    drawLeftPyramid(c, w, h);                // punches TIER CORNER
    drawAPlaque(c, w, h);
    drawSignPost(c, w, h);                   // punches PLAZA SIGN
    drawAncientCratesBack(c, w, h);          // punches CRATES

    // ---- dappled light. Broken sun through a canopy is the one thing that
    // says "jungle" without drawing a single extra leaf, and it goes on LAST
    // over the back scene so it falls across the architecture as well as the
    // ground, the way real light does.
    drawDapple(c, w, h);
  }

  function drawAncientFront(c, w, h) {
    drawAncientCratesFront(c, w, h);
    // The three ferns sit in the band below every gap's foot and above the
    // ledge, which is the only strip of the opening where near foliage can
    // stand without ever covering an angle.
    drawFern(c, w * 0.135, h * 0.845, w * 0.115);
    drawFern(c, w * 0.560, h * 0.870, w * 0.100);
    drawFern(c, w * 0.845, h * 0.835, w * 0.120);
    drawAncientPortal(c, w, h);
  }

  /* -- LIMESTONE COURSING. Mortar is laid down as the ground and irregular
     blocks are set ON it, so what shows in the joints is genuinely the
     mortar behind rather than a grid drawn over a flat fill. That is the
     difference between a stone wall and graph paper, and it costs one extra
     fillRect. Block widths cycle through four ratios against the row index,
     so no two courses break in the same place and nothing repeats on a
     period the eye can catch. */
  function limeBlocks(c, x, y, bw, bh, rowH, tone) {
    px(c, x, y, bw, bh, MORTAR);
    var r = 0, yy = y;
    while (yy < y + bh - 1) {
      var rh = Math.min(rowH - 3, y + bh - yy);
      if (rh <= 1) break;
      var xx = x - rowH * 0.3 + (r % 2 ? rowH * 0.55 : 0);
      var k = 0;
      while (xx < x + bw) {
        var bwid = rowH * (1.5 + ((r * 3 + k * 5) % 4) * 0.42);
        var bx0 = Math.max(x, xx), bx1 = Math.min(x + bw, xx + bwid - 3);
        if (bx1 - bx0 > 2) {
          px(c, bx0, yy, bx1 - bx0, rh, tone);
          px(c, bx0, yy, bx1 - bx0, 2, LIME_HI);            // sun along each top
          px(c, bx0, yy + rh - 2, bx1 - bx0, 2, LIME_LO);
        }
        xx += bwid; k++;
      }
      yy += rowH; r++;
    }
  }

  /* -- MOSS TUFT. Vegetation sprouting straight OUT of the stonework, not
     painted onto it: a dark pad in the joint with blades standing clear
     above the block's top edge, so the silhouette breaks the coursing line.
     A tuft that stays inside the block reads as a stain instead. */
  function mossTuft(c, x, y, s) {
    px(c, x - s * 0.50, y - s * 0.22, s, s * 0.26, MOSS);
    for (var i = 0; i < 5; i++) {
      var bl = (i % 2 ? s * 0.52 : s * 0.32);
      px(c, x - s * 0.44 + i * s * 0.22, y - s * 0.20 - bl, 3, bl, i % 2 ? MOSS_HI : MOSS);
    }
  }

  /* -- CANOPY: one ragged band of jungle across the sky's base, plus a few
     palm crowns breaking above it. Flat and dark on purpose — this is the
     lid on the plaza, not a subject. */
  function drawCanopy(c, w, h) {
    var base = h * 0.315;
    var i;
    for (i = 0; i < 18; i++) {
      var cx2 = (i + 0.5) * (w / 18);
      var lump = h * (0.030 + 0.026 * ((i * 7) % 5) / 4);
      px(c, cx2 - w / 30, base - lump, w / 15, lump + h * 0.02, i % 3 ? LEAF : LEAF_DK);
    }
    px(c, 0, base, w, h * 0.020, LEAF_DK);
    // palm crowns above the line. Sited clear of TEMPLE MOUTH, which is the
    // one gap high enough for a crown to have reached into.
    drawFrondCrown(c, w * 0.075, h * 0.268, w * 0.090);
    drawFrondCrown(c, w * 0.610, h * 0.250, w * 0.105);
    drawFrondCrown(c, w * 0.905, h * 0.282, w * 0.085);
  }

  // Six blades off one point — the same construction Mirage's palm uses,
  // because a palm at this size is a silhouette either way and inventing a
  // second solution to one solved problem is how two maps stop cohering.
  function drawFrondCrown(c, x, y, len) {
    px(c, x - 3, y, 6, len * 0.40, '#4A4A2E');
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI * 0.92 + i * (Math.PI * 0.84 / 5);
      c.fillStyle = i < 3 ? LEAF_HI : LEAF;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * len * 0.7, y + Math.sin(a) * len * 0.7,
                         x + Math.cos(a) * len, y + Math.sin(a) * len * 0.9);
      c.quadraticCurveTo(x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.5 + 6, x, y + 4);
      c.closePath(); c.fill();
    }
  }

  /* -- THE BACK WALL: weathered limestone in thick courses, mossed along
     every joint that catches water. The coping catches sun; the foot sits in
     the shade the wall casts on itself. */
  function drawAncientWall(c, w, h, horizon) {
    var wy = h * 0.300;
    limeBlocks(c, 0, wy, w, horizon - wy, h * 0.031, LIME);
    px(c, 0, wy, w, 5, LIME_HI);                              // sun on the coping
    px(c, 0, wy + 5, w, 3, MOSS);                             // moss along the top
    px(c, 0, horizon - h * 0.026, w, h * 0.026, LIME_LO);     // foot in its own shade
    // damp and lichen wash, two bands, low alpha and no texture noise
    px(c, 0, wy + h * 0.070, w, 6, 'rgba(78,107,51,0.20)');
    px(c, 0, wy + h * 0.150, w, 5, 'rgba(0,0,0,0.10)');
    for (var i = 0; i < 9; i++) mossTuft(c, w * (0.055 + i * 0.112), wy + h * 0.098, w * 0.030);
  }

  /* -- FLAGSTONES: irregular slabs, not a grid. Courses deepen toward the
     viewer so the ground reads as receding, and the joints wander, because
     the one thing a hand-laid stone floor is not is square.

     THE YELLOW LINE is the plaza's own painted marking and the second of the
     map's two saturated accents. It runs ACROSS the ground rather than into
     it, so it reads as paint on stone and does not compete with the paving's
     own recession. Worn back up afterwards: an unbroken line reads as tape. */
  function drawFlagstones(c, w, h, horizon) {
    px(c, 0, horizon, w, h - horizon, A_FLAG);
    px(c, 0, horizon, w, 3, LIME_DK);                          // the ground line
    px(c, 0, horizon, w, h * 0.016, A_FLAG_HI);                // sunlit strip at the base
    var y = horizon + h * 0.016, step = h * 0.016, r = 0;
    while (y < h) {
      px(c, 0, y, w, 2, A_FLAG_LO);                            // the course joint
      var xx = -w * 0.05 + (r % 2 ? w * 0.06 : 0), k = 0;
      while (xx < w) {
        var sw = w * (0.10 + ((r * 3 + k * 7) % 5) * 0.035);
        px(c, xx, y, 2, step, A_FLAG_LO);                      // the slab break
        if ((r + k) % 3 === 0) px(c, xx + 2, y + 2, sw - 4, step - 4, 'rgba(255,255,255,0.05)');
        if ((r + k) % 4 === 1) px(c, xx + 2, y + 2, sw - 4, step - 4, 'rgba(0,0,0,0.05)');
        xx += sw; k++;
      }
      y += step; step *= 1.30; r++;
    }
    var ly = h * 0.700, lh = Math.max(4, h * 0.009);
    px(c, 0, ly, w, lh, A_YELLOW_LO);
    px(c, 0, ly, w, lh - 2, A_YELLOW);
    for (var b = 0; b < 11; b++) {
      px(c, w * (0.02 + b * 0.093), ly - 1, w * 0.016, lh + 2, 'rgba(124,132,119,0.75)');
    }
  }

  /* -- LEFT PYRAMID: stepped tiers climbing out of frame, treads catching
     the sun. The peek is the shadow at the right-hand corner where the mass
     turns away from the light — and the strip of tread immediately left of
     it is deliberately the map's BRIGHTEST limestone, because this is the
     nearest angle on the left and it should be the plainest read of the
     five. */
  function drawLeftPyramid(c, w, h) {
    var r = gapPx('tier', w, h);
    var right = r.x;                                  // the mass ends at the gap
    var topY = h * 0.230, botY = h * 0.760;
    var tiers = 5, i;
    for (i = 0; i < tiers; i++) {
      var ty = topY + ((botY - topY) / tiers) * i;
      var th = (botY - topY) / tiers;
      // each tier steps OUT toward the viewer as it descends
      var tx1 = right - (tiers - 1 - i) * (w * 0.016);
      limeBlocks(c, 0, ty, tx1, th, h * 0.026, i % 2 ? LIME : '#93A08A');
      px(c, 0, ty, tx1, 6, LIME_HI);                  // the tread catching light
      px(c, 0, ty + 6, tx1, 3, 'rgba(255,255,255,0.16)');
      px(c, 0, ty + th - 4, tx1, 4, LIME_LO);         // the riser's shaded foot
      px(c, tx1 - 5, ty, 5, th, LIME_LO);             // the corner turning away
      if (i % 2) mossTuft(c, tx1 - w * 0.075, ty + 6, w * 0.034);
      mossTuft(c, w * 0.030 + i * w * 0.012, ty + 6, w * 0.030);
    }
    // THE PEEK. Its cover is the sunlit tread strip painted immediately to
    // its left, below — that literal is ANCIENT_ANGLES' `cover` for 'tier'.
    px(c, r.x, r.y, r.w, r.h, ANCIENT_GAP);
    px(c, r.x - 8, r.y, 8, r.h, LIME_HI);             // the lit corner beside it
    px(c, r.x, r.y - 4, r.w, 4, LIME_LO);             // soffit above the recess
    px(c, r.x + r.w, r.y, 4, r.h, LIME_LO);           // the far jamb, in shade
    px(c, r.x, r.y + r.h, r.w, 5, '#2E3529');         // ground contact
    // Vines over the recess's head, so the gap sits in vegetation rather than
    // reading as a clean-cut hole. They hang ABOVE the rect and never into it:
    // measured, four vines dropping into the gap lifted its interior from 17
    // to 26 luma, and a gap is the one surface on this map that must stay the
    // darkest thing in it.
    for (i = 0; i < 4; i++) {
      var vl = h * (0.012 + 0.010 * (i % 3));
      px(c, r.x + r.w * (0.12 + i * 0.24), r.y - 4 - vl, 4, vl, MOSS_HI);
    }
  }

  /* -- CENTRE TIERS: the far pyramid across the plaza, with the temple's
     dark mouth at its head. Smallest gap in the set because it is furthest
     away, and drawEnemy sizes its silhouette off the rect, so that falloff
     costs nothing to maintain. */
  function drawCentreTiers(c, w, h) {
    var r = gapPx('mouth', w, h);
    var x0 = r.x - w * 0.032, x1 = r.x + r.w + w * 0.045;
    var topY = r.y - h * 0.036, botY = h * 0.560;
    var tiers = 4, i;
    for (i = 0; i < tiers; i++) {
      var ty = topY + ((botY - topY) / tiers) * i;
      var th = (botY - topY) / tiers;
      var sp = i * w * 0.020;                          // widening as it descends
      limeBlocks(c, x0 - sp, ty, (x1 - x0) + sp * 2, th, h * 0.022, LIME);
      px(c, x0 - sp, ty, (x1 - x0) + sp * 2, 5, LIME_HI);       // lit tread
      px(c, x0 - sp, ty + th - 3, (x1 - x0) + sp * 2, 3, LIME_LO);
      mossTuft(c, x0 - sp + w * 0.020, ty + 5, w * 0.026);
      mossTuft(c, x1 + sp - w * 0.024, ty + 5, w * 0.024);
    }
    // the lintel over the mouth: one heavy stone, the way a real one is
    px(c, r.x - w * 0.026, r.y - h * 0.020, r.w + w * 0.052, h * 0.020, '#9EAA96');
    px(c, r.x - w * 0.026, r.y - h * 0.020, r.w + w * 0.052, 4, LIME_HI);
    // THE PEEK: the mouth itself, jambs either side in plain limestone
    px(c, r.x, r.y, r.w, r.h, ANCIENT_GAP);
    px(c, r.x - 5, r.y, 5, r.h, LIME);                 // the cover, lit face
    px(c, r.x + r.w, r.y, 4, r.h, LIME_LO);
    px(c, r.x, r.y + r.h, r.w, 4, '#2E3529');
  }

  /* -- THE WOODEN DOUBLE DOOR: planked timber in a stone surround, the one
     warm mass on a grey-green map. One leaf stands open, and the dark behind
     it IS the gap — the open leaf is not decoration, it is what makes a
     doorway read as a doorway rather than as a rectangle of shadow.

     THE LOWEST-CONTRAST PAIR ON THE MAP is here (planks against the gap),
     which is exactly why the leaf abutting the gap is drawn in the LIT plank
     tone and the shadowed tone is kept to the far side. */
  function drawWoodDoor(c, w, h) {
    var r = gapPx('door', w, h);
    var sx = r.x - w * 0.045, sw = r.w + w * 0.090;
    var sy = r.y - h * 0.030, sh = r.h + h * 0.055;
    // the stone surround, then a heavy lintel across its head
    limeBlocks(c, sx, sy, sw, sh, h * 0.028, '#93A08A');
    px(c, sx - w * 0.014, sy - h * 0.016, sw + w * 0.028, h * 0.020, '#9EAA96');
    px(c, sx - w * 0.014, sy - h * 0.016, sw + w * 0.028, 4, LIME_HI);
    px(c, sx - w * 0.014, sy + h * 0.004, sw + w * 0.028, 3, LIME_LO);
    mossTuft(c, sx + sw * 0.18, sy - h * 0.014, w * 0.030);
    mossTuft(c, sx + sw * 0.80, sy - h * 0.014, w * 0.028);

    // THE PEEK: the dark inside the open leaf
    px(c, r.x, r.y, r.w, r.h, ANCIENT_GAP);

    // the standing leaf, hard against the gap's left edge. Vertical boards
    // with visible joints and two cross braces: a plank door is a stack of
    // boards held together, and at this size that is its whole silhouette.
    var lw = w * 0.070, lx = r.x - lw, ly = r.y, lh = r.h;
    px(c, lx, ly, lw, lh, A_WOOD_HI);
    // The joints stop at 60% of the leaf, so the LEADING EDGE is unbroken lit
    // plank. Measured: with joints running the full width, the seven pixels
    // this angle is read against averaged 68 luma against a gap of 17 — a
    // 51-unit separation, the weakest thing on either map. Clearing them off
    // the edge takes the same pair to 138.
    var p;
    for (p = 1; p < 4; p++) {
      px(c, lx + lw * (p / 5), ly, 2, lh, A_WOOD_LO);          // the board joints
      px(c, lx + lw * (p / 5) + 2, ly, 2, lh, A_WOOD);
    }
    px(c, lx, ly + lh * 0.20, lw, 5, A_WOOD);                  // cross braces
    px(c, lx, ly + lh * 0.70, lw, 5, A_WOOD);
    px(c, lx, ly, lw, 3, '#B98A4E');                           // sun along the top
    // The leading edge of an open leaf stands proud of the doorway and takes
    // the sun full on — which is both true and the thing that makes this angle
    // readable. It is deliberately the brightest wood on the map.
    px(c, lx + lw - 5, ly, 5, lh, '#C09656');                  // the leading edge
    px(c, lx + lw * 0.50, ly + lh * 0.48, 6, 6, A_IRON);       // ring pull
    // the far leaf, folded back into the reveal and therefore in shade
    px(c, r.x + r.w, r.y, w * 0.020, r.h, A_WOOD_LO);
    px(c, r.x + r.w, r.y, 3, r.h, A_WOOD);
    // the threshold: a worn stone step the door opens over
    px(c, sx, r.y + r.h, sw, h * 0.016, '#A2AE99');
    px(c, sx, r.y + r.h, sw, 4, LIME_HI);
    px(c, sx, r.y + r.h + h * 0.016, sw, 4, 'rgba(46,53,41,0.45)');
  }

  /* -- THE A PLAQUE on the left wall. The plaza's bombsite marking, and the
     first of the map's two yellow accents. Held well clear of TIER CORNER,
     so the most saturated thing on that wall is never what a silhouette
     ends up being read against. */
  function drawAPlaque(c, w, h) {
    var qx = w * 0.028, qy = h * 0.372, qw = w * 0.082, qh = h * 0.070;
    px(c, qx - 3, qy - 3, qw + 6, qh + 6, LIME_DK);            // the bracket
    px(c, qx, qy, qw, qh, A_YELLOW);
    px(c, qx, qy, qw, 3, '#F6DA72');                           // sun along the top
    px(c, qx, qy + qh - 4, qw, 4, A_YELLOW_LO);
    pixelText(c, 'A', qx + qw / 2, qy + qh / 2, Math.round(h * 0.048), '#2B2412', 'center');
    px(c, qx + qw * 0.10, qy + qh, qw * 0.24, 5, 'rgba(46,53,41,0.40)');
  }

  /* -- PLAZA A SIGN: a board on a post, and the shadowed slot past it. The
     board is the cover here — the strongest pair on the map, deliberately
     sited opposite the weakest (the wood door), so the five angles span a
     real range of difficulty instead of all reading the same. */
  function drawSignPost(c, w, h) {
    var r = gapPx('sign', w, h);
    // the stonework the slot is cut into, running out to the right edge
    var wx = r.x + r.w, wy = h * 0.320;
    limeBlocks(c, wx, wy, w - wx, h * 0.790 - wy, h * 0.030, LIME);
    px(c, wx, wy, w - wx, 5, LIME_HI);
    px(c, wx, wy + 5, w - wx, 3, MOSS);
    mossTuft(c, wx + w * 0.045, wy + h * 0.090, w * 0.032);
    // and the return on the near side of the slot, which is what makes the
    // slot a slot rather than simply the end of a wall
    limeBlocks(c, r.x - w * 0.090, wy + h * 0.020, w * 0.090, h * 0.770 - wy, h * 0.030, LIME);
    px(c, r.x - w * 0.090, wy + h * 0.020, w * 0.090, 5, LIME_HI);

    // THE PEEK
    px(c, r.x, r.y, r.w, r.h, ANCIENT_GAP);
    px(c, r.x + r.w, r.y, 4, r.h, LIME_LO);
    px(c, r.x, r.y + r.h, r.w, 5, '#2E3529');

    // the post, then the board hard against the gap's left edge
    var post = r.x - w * 0.040;
    px(c, post, r.y + r.h * 0.10, 7, r.h * 0.98, A_IRON);
    px(c, post, r.y + r.h * 0.10, 3, r.h * 0.98, '#565550');
    var sbw = w * 0.115, sbh = h * 0.098;
    var sbx = r.x - sbw, sby = r.y + r.h / 2 - sbh / 2;
    // The bracket does NOT extend past the board's right edge: three pixels of
    // dark trim reaching into the gap lifted its interior from 17 to 22 luma.
    px(c, sbx - 3, sby - 3, sbw + 3, sbh + 6, LIME_DK);
    px(c, sbx, sby, sbw, sbh, A_YELLOW);
    px(c, sbx, sby, sbw, 3, '#F6DA72');
    px(c, sbx, sby + sbh - 4, sbw, 4, A_YELLOW_LO);
    // Nudged LEFT of the board's centre and kept small on purpose: the
    // board's right edge is the cover the PLAZA SIGN gap is measured
    // against, and dark signwriting reaching that edge would eat the very
    // pixels the angle depends on. Signage is read as a shape at this size
    // anyway, so nothing is lost by holding it clear.
    pixelText(c, 'PLAZA', sbx + sbw * 0.42, sby + sbh * 0.33, Math.round(h * 0.013), '#2B2412', 'center');
    pixelText(c, 'A',     sbx + sbw * 0.42, sby + sbh * 0.72, Math.round(h * 0.030), '#2B2412', 'center');
  }

  /* -- THE TREE in the middle distance. A real trunk with a broad crown,
     sited between the door and the sign so it breaks the wall's top line
     without ever standing over a gap. Drawn before both, so the ruins
     overlap it and it sits genuinely behind them. */
  function drawJungleTree(c, w, h) {
    var tx = w * 0.640, base = h * 0.560;
    px(c, tx - w * 0.014, h * 0.250, w * 0.028, base - h * 0.250, '#4E4636');
    px(c, tx - w * 0.014, h * 0.250, w * 0.010, base - h * 0.250, '#6A6049');   // lit side
    px(c, tx - w * 0.034, h * 0.540, w * 0.068, h * 0.022, '#3E3A2C');          // root flare
    // crown: overlapping lumps, lit on the upper left, dark on the lower right
    var lumps = [[0, -0.045, 0.085], [-0.062, -0.018, 0.068], [0.060, -0.020, 0.070],
                 [-0.030, 0.020, 0.062], [0.034, 0.024, 0.058]];
    for (var i = 0; i < lumps.length; i++) {
      var lx = tx + w * lumps[i][0], ly = h * 0.250 + h * lumps[i][1], rr = w * lumps[i][2];
      c.fillStyle = i < 2 ? LEAF_HI : LEAF;
      c.beginPath(); c.arc(lx, ly, rr, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(36,55,26,0.55)';
      c.beginPath(); c.arc(lx + rr * 0.30, ly + rr * 0.34, rr * 0.66, 0, Math.PI * 2); c.fill();
    }
  }

  /* -- CRATES. Two stacks flanking the slot plus a nearer row drawn after
     the silhouette — the same two-pass construction Mirage's barrels use and
     for the same reason: the front row has to cut the peeker's legs off, and
     nothing but painting it later will do that. */
  function drawAncientCratesBack(c, w, h) {
    var r = gapPx('crates', w, h);
    var cw2 = w * 0.088, ch2 = r.h / 3;
    var i;
    for (i = 0; i < 3; i++) {                              // left stack, abutting
      drawWoodCrate(c, r.x - cw2, r.y + i * ch2, cw2, ch2 - 2);
    }
    for (i = 0; i < 3; i++) {                              // right stack
      drawWoodCrate(c, r.x + r.w, r.y + i * ch2, cw2, ch2 - 2);
    }
    px(c, r.x, r.y, r.w, r.h, ANCIENT_GAP);                // THE PEEK slot
    // The slot rakes light down its left cheek. Without this the pixels this
    // angle is read against were the left stack's SHADED return at 65 luma —
    // a crate stack lit from the upper left turns its dark face to a slot on
    // its right, which is correct and unreadable. The rim is the fix, and it
    // is the same move Mirage makes with SAND_HI beside the low wall.
    px(c, r.x - 5, r.y, 5, r.h, A_CRATE_HI);
    px(c, r.x + r.w, r.y, 4, r.h, A_CRATE_LO);
    px(c, r.x, r.y - 4, r.w, 4, A_CRATE_LO);               // the plank bridging them
  }

  function drawAncientCratesFront(c, w, h) {
    var r = gapPx('crates', w, h);
    var cw2 = w * 0.108, ch2 = h * 0.082;
    // nearer, so bigger. Their tops land across the silhouette's waist.
    drawWoodCrate(c, r.x + r.w * 0.16, r.y + r.h - ch2 * 0.55, cw2, ch2);
    drawWoodCrate(c, r.x + r.w * 0.66, r.y + r.h - ch2 * 0.34, cw2, ch2);
    px(c, r.x + r.w * 0.10, r.y + r.h + ch2 * 0.46, cw2 * 1.7, 5, 'rgba(46,53,41,0.30)');
  }

  // x,y is the crate's top-left. Vertical boards, a lighter left face for
  // the sun, and one diagonal brace — the whole silhouette of a shipping
  // crate at 40px, and nothing more will read at that size.
  function drawWoodCrate(c, x, y, cw, ch) {
    px(c, x, y, cw, ch, A_CRATE);
    px(c, x, y, cw * 0.26, ch, A_CRATE_HI);                 // sunlit left face
    px(c, x, y, cw, 4, A_CRATE_HI);                         // sun on the lid
    px(c, x + cw - 4, y, 4, ch, A_CRATE_LO);
    px(c, x, y + ch - 4, cw, 4, A_CRATE_LO);
    px(c, x + 3, y + ch * 0.44, cw - 6, 3, A_CRATE_LO);      // mid rail
    c.save();
    c.strokeStyle = A_CRATE_LO; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x + 4, y + ch - 6); c.lineTo(x + cw - 5, y + 6); c.stroke();
    c.restore();
  }

  /* -- FERN: broad blades fanning off a low crown, for the near foreground.
     Deliberately the lightest greens on the map — the front plane is where
     the eye starts, and a foreground darker than its midground reads as a
     hole rather than as depth. */
  function drawFern(c, x, y, len) {
    for (var i = 0; i < 7; i++) {
      var a = -Math.PI * 0.95 + i * (Math.PI * 0.90 / 6);
      var L = len * (0.72 + 0.28 * (1 - Math.abs(i - 3) / 3));
      c.fillStyle = i % 2 ? LEAF_HI : LEAF;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.85,
                         x + Math.cos(a) * L, y + Math.sin(a) * L * 0.75);
      c.quadraticCurveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.35, x, y + 5);
      c.closePath(); c.fill();
    }
    px(c, x - 4, y - 2, 8, len * 0.16, '#3B4A2A');
  }

  /* -- DAPPLE: broken sun through the canopy. Warm pools and cool leaf
     shadow, both irregular and both at very low alpha. It is the cheapest
     thing on this map and it is what stops the flagstones reading as a flat
     sheet.

     EVERY POOL IS SITED BELOW THE LOWEST GAP, and that is a measurement, not
     a composition note. The first arrangement had three of them clipping the
     feet of TIER CORNER, CRATES and PLAZA SIGN, and warm light at 0.10 alpha
     lifted those gap interiors by 5 to 7 luma each. Small — and still the
     wrong direction, because the gap is the one surface on this map that has
     to stay the darkest thing in it. The leaf-shadow patches are free to
     overlap anything, since they only ever darken. */
  function drawDapple(c, w, h) {
    var pools = [[0.20, 0.790, 0.130, 0.030], [0.44, 0.800, 0.170, 0.034],
                 [0.80, 0.790, 0.140, 0.028], [0.30, 0.855, 0.200, 0.038],
                 [0.62, 0.880, 0.160, 0.030], [0.06, 0.780, 0.110, 0.026]];
    var shades = [[0.26, 0.690, 0.090, 0.022], [0.56, 0.780, 0.110, 0.024],
                  [0.88, 0.740, 0.095, 0.020]];
    var i;
    c.save();
    for (i = 0; i < pools.length; i++) {
      c.fillStyle = 'rgba(255,241,196,0.10)';
      c.beginPath();
      c.ellipse(w * pools[i][0], h * pools[i][1], w * pools[i][2], h * pools[i][3], 0, 0, Math.PI * 2);
      c.fill();
    }
    for (i = 0; i < shades.length; i++) {
      c.fillStyle = 'rgba(30,44,26,0.13)';
      c.beginPath();
      c.ellipse(w * shades[i][0], h * shades[i][1], w * shades[i][2], h * shades[i][3], 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /* -- THE STONE PORTAL. Ancient's answer to Mirage's timber window, and the
     reason it is a different shape rather than the same frame recoloured:
     you are standing inside the temple looking out, so the foreground is two
     heavy limestone piers, a mossy lintel and a worn ledge. Same structural
     job — it is what gives the scene a real foreground and turns a picture
     into an opening — and the AWP still sits against the dark interior below
     the ledge, which is the whole reason a bottom band exists at all. */
  function drawAncientPortal(c, w, h) {
    var o = ANCIENT_OPEN;
    var x0 = w * o.x0, x1 = w * o.x1, y0 = h * o.y0, y1 = h * o.y1;
    var i;

    // inner shadow around the reveal — an opening is darker at its edge than
    // at its centre, and that one gradient is most of why the plaza behind it
    // reads as further away than the stone in front of it.
    for (i = 0; i < 5; i++) {
      var a = (0.24 - i * 0.046).toFixed(3);
      var d = i * 5;
      px(c, x0 + d, y0, 5, y1 - y0, 'rgba(16,22,18,' + a + ')');
      px(c, x1 - d - 5, y0, 5, y1 - y0, 'rgba(16,22,18,' + a + ')');
      px(c, x0, y0 + d, x1 - x0, 5, 'rgba(16,22,18,' + a + ')');
      px(c, x0, y1 - d - 5, x1 - x0, 5, 'rgba(16,22,18,' + a + ')');
    }

    // --- piers, in the heaviest coursing on the map: these are the nearest
    // stones in the scene, so their blocks are the biggest.
    drawPier(c, 0, 0, x0, h, +1);
    drawPier(c, x1, 0, w - x1, h, -1);

    // --- lintel: massive courses, mossed along the underside where the water
    // runs off, with vines hanging into the top of the view.
    limeBlocks(c, 0, 0, w, y0, h * 0.042, '#93A08A');
    px(c, 0, 0, w, h * 0.020, LIME_HI);
    px(c, 0, y0 - 8, w, 8, LIME_LO);
    px(c, 0, y0 - 3, w, 3, '#2E3529');
    for (i = 0; i < 10; i++) mossTuft(c, w * (0.04 + i * 0.105), y0 - 6, w * 0.034);
    for (i = 0; i < 7; i++) {                                  // hanging vines
      px(c, w * (0.075 + i * 0.135), y0, 4, h * (0.020 + 0.026 * ((i * 3) % 4) / 3), MOSS);
    }
    px(c, x0, y0, x1 - x0, h * 0.018, 'rgba(20,28,20,0.30)');   // the lintel's cast

    // --- ledge: a worn stone sill, then the temple's own dark interior.
    px(c, 0, y1, w, h * 0.016, '#A6B29C');                      // the lit front edge
    px(c, 0, y1 + h * 0.016, w, h * 0.036, LIME);
    px(c, 0, y1 + h * 0.016, w, 3, LIME_HI);
    for (i = 0; i < 5; i++) {
      px(c, (i * 0.21 + 0.03) * w, y1 + h * 0.028, w * 0.11, 2, 'rgba(58,68,54,0.55)');
    }
    px(c, 0, y1 + h * 0.052, w, h - (y1 + h * 0.052), '#151A16');
    px(c, 0, y1 + h * 0.052, w, 3, '#0A0D0B');
  }

  function drawPier(c, x, y, pw3, ph3, dir) {
    limeBlocks(c, x, y, pw3, ph3, ph3 * 0.052, LIME);
    // the sunlit face is the left pier's; the right pier turns away from it
    px(c, x + (dir > 0 ? 0 : pw3 * 0.60), y, pw3 * 0.40, ph3,
       dir > 0 ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.22)');
    // moss creeping up the reveal, heaviest at the foot where water sits
    for (var i = 0; i < 8; i++) {
      var my = y + ph3 * (0.30 + i * 0.085);
      px(c, dir > 0 ? x + pw3 - 12 : x + 4, my, 8, ph3 * 0.045, i % 2 ? MOSS : MOSS_HI);
    }
    // the reveal edge itself: a hard dark line is what reads as a corner
    px(c, dir > 0 ? x + pw3 - 3 : x, y, 3, ph3, '#232A21');
  }

  /* ======================================================================
     DRAW — INFERNO, the village street from under the arcade.

     Same sandwich as the other two and for the same reason: back scene,
     silhouette, front scene, so a peeker is cut by the cover he is peeking
     from. Same one light direction too — sun from the upper left, every lit
     edge a top or left edge, every shadow falling right and down.

     WHAT CHANGES IS THE WORLD, AND IT CHANGES ON TWO AXES AT ONCE. Warmth:
     cream ashlar and plaster instead of Ancient's grey-green. And chroma:
     this map has a genuinely saturated mass running through the middle of it
     (the terracotta path) plus three saturated accents (the checked cloths,
     the green shopfront, the red car), where the other two are near-neutral
     scenes with one accent each. That is what makes it read as a THIRD place
     rather than a warm repaint of the second.

     THE RULE THAT SHAPES EVERY DRAW BELOW is the inverse of Ancient's. There
     the danger was cover too dark to separate from a gap; here every cover is
     bright for free and the danger is a DARK PROP — railing, chalkboard,
     shutter, wheel arch, iron bracket — landing beside a gap and swallowing
     both the gap and the dark-clothed silhouette in it. So every dark prop in
     this scene is sited x- or y-disjoint from all five gap rects, and the
     verification pass asserts that arithmetically rather than trusting the
     eye, which is exactly the check that caught the shrub over ARCADE PIER's
     foot and the chalkboard against CAFE TABLES' left cheek.

     MEASURED, on the rendered pixels: see the table in the commit note. The
     literals in INFERNO_ANGLES are the MATERIAL; the measurement is what a
     lit edge actually leaves next to the gap, and only the second is what the
     player's eye gets.
     ====================================================================== */

  // Warm where Ancient is cool, and more chromatic than either of the others.
  // Named by material, same convention as the other two palettes.
  var I_SKY_TOP = '#3E7FB8', I_SKY = '#79ABD2', I_SKY_HAZE = '#CFE0E4';
  var ASHLAR  = '#DFCDA8', ASHLAR_HI = '#F4E8CB', ASHLAR_LO = '#B09B72', ASHLAR_DK = '#6B5C42';
  var RENDER  = '#E7D9BF', RENDER_HI = '#F9F1DF', RENDER_LO = '#BBAB8D';
  var TERRA   = '#C0562F', TERRA_HI = '#DC7442', TERRA_LO = '#8B3B1E';
  var COBBLE  = '#A29B90', COBBLE_HI = '#C4BCAC', COBBLE_LO = '#726B60';
  var TILE    = '#B2542F', TILE_HI = '#D06F3F', TILE_LO = '#7C3820';
  var SHOPGRN = '#2F6B45', SHOPGRN_HI = '#57A56D', SHOPGRN_LO = '#1B4028';
  var CLOTH   = '#EFE4D4', CLOTH_HI = '#FFF8EC', CLOTH_RED = '#C0392B';
  var CYPRESS = '#31523A', CYPRESS_HI = '#456E4B';
  var OLIVE   = '#5E7A46', OLIVE_HI = '#87A363';
  var POT     = '#C86A3C', POT_HI = '#E9955C', POT_LO = '#8B4526';
  var SHUTTER = '#4E6B45', SHUTTER_HI = '#688A5C';
  var CAR_RED = '#C0392B', CAR_HI = '#E96A52', CAR_LO = '#761F16';
  var I_IRON  = '#3B3A36', I_IRON_HI = '#5B5A54';
  var FLAG_G  = '#2E7D4F', FLAG_W = '#F0EDE4', FLAG_R = '#C8342C';
  var I_TIMBER = '#8A6136', I_TIMBER_HI = '#AD7F4B';

  // The street's own geometry, in one place. The path is the map's signature
  // and everything on the ground is sited relative to it, so its four numbers
  // are declared once rather than re-guessed inside five draw functions.
  var I_HORIZON = 0.470;                 // where the cobbles meet the far facades
  var PATH_FAR0 = 0.435, PATH_FAR1 = 0.515;   // the strip's width at the horizon
  var PATH_NEAR0 = 0.270, PATH_NEAR1 = 0.640; // and at the bottom of the frame
  // Depth 0 at the horizon, 1 at the bottom edge. Every ground prop asks this
  // where the kerb is at its own height rather than carrying a literal.
  function pathAt(yFrac) {
    var t = clamp((yFrac - I_HORIZON) / (1 - I_HORIZON), 0, 1);
    return { l: lerp(PATH_FAR0, PATH_NEAR0, t), r: lerp(PATH_FAR1, PATH_NEAR1, t) };
  }

  /* THE VAULT'S SOFFIT, as a function rather than a shape. The frame is drawn
     by filling ashlar down to this line column by column, which is what makes
     it a real arch instead of a rectangle with two triangles in the corners —
     and it is also what lets the verification pass assert that no gap hides
     behind a voussoir, because "the arch" is one expression both the drawing
     and the check can read. Crown at open.y0, springing at ARCH_SPRING. */
  var ARCH_SPRING = 0.310;
  function archSoffit(xFrac) {
    var cx = (INFERNO_OPEN.x0 + INFERNO_OPEN.x1) / 2;
    var rx = (INFERNO_OPEN.x1 - INFERNO_OPEN.x0) / 2;
    var t = clamp((xFrac - cx) / rx, -1, 1);
    return ARCH_SPRING - (ARCH_SPRING - INFERNO_OPEN.y0) * Math.sqrt(1 - t * t);
  }

  function drawInfernoBack(c, w, h) {
    var horizon = h * I_HORIZON;

    // ---- sky: the same aerial perspective the other two use — a real blue
    // at the top, hazing pale at the roofline. Distance reading lighter and
    // cooler than the foreground does more here than any amount of detail.
    px(c, 0, 0, w, horizon, I_SKY);
    px(c, 0, 0, w, h * 0.20, I_SKY_TOP);
    px(c, 0, h * 0.325, w, horizon - h * 0.325, I_SKY_HAZE);

    drawCampanile(c, w, h);                  // the glimpse of bell tower, furthest
    drawVillageBlock(c, w, h, horizon);      // the facades and pantile roofs behind
    drawStreet(c, w, h, horizon);            // cobbles, then THE PATH

    // Ground before uprights, so every upright lays its own contact shadow
    // onto a surface that is already there. Then far to near.
    drawShopfront(c, w, h);                  // punches SHOP DOOR
    drawTrattoria(c, w, h);                  // punches WALL CORNER
    drawArcadeInner(c, w, h);                // punches ARCADE PIER
    drawTerrace(c, w, h);                    // railing, pots, cypress, flag
    drawChalkboard(c, w, h);
    drawCafeBack(c, w, h);                   // punches CAFE TABLES
    drawParkedCar(c, w, h);                  // punches RED CAR

    // ---- the afternoon wash, LAST over the back scene so it falls across
    // the architecture as well as the ground, the way real light does.
    drawSunWash(c, w, h);
  }

  function drawInfernoFront(c, w, h) {
    drawCafeFront(c, w, h);                  // the near table, across the waist
    drawCarFront(c, w, h);                   // the bonnet's near lip, likewise
    drawArcadeFrame(c, w, h);
  }

  /* -- ASHLAR COURSING. Dressed stone, not Ancient's rubble limestone: the
     blocks are REGULAR and the joints are fine, because that is the actual
     difference between a Mayan retaining wall and an Italian arcade. Same
     construction as limeBlocks (a mortar ground with blocks set on it, so
     the joints are genuinely the material behind) and a deliberately
     different result, which is the point — one solved problem, two materials.
     Courses break on alternate rows so nothing repeats on a catchable
     period. */
  function ashlarBlocks(c, x, y, bw, bh, rowH, tone) {
    px(c, x, y, bw, bh, ASHLAR_DK);                       // the joint colour behind
    var r = 0, yy = y;
    while (yy < y + bh - 1) {
      var rh = Math.min(rowH - 2, y + bh - yy);
      if (rh <= 1) break;
      var bwid = rowH * 2.1;
      var xx = x - (r % 2 ? bwid * 0.5 : 0);
      while (xx < x + bw) {
        var bx0 = Math.max(x, xx), bx1 = Math.min(x + bw, xx + bwid - 2);
        if (bx1 - bx0 > 2) {
          px(c, bx0, yy, bx1 - bx0, rh, tone);
          px(c, bx0, yy, bx1 - bx0, 2, ASHLAR_HI);        // sun along each top
          px(c, bx0, yy + rh - 2, bx1 - bx0, 2, ASHLAR_LO);
        }
        xx += bwid;
      }
      yy += rowH; r++;
    }
  }

  /* -- PANTILE ROOF: the terracotta lid every building in this scene wears,
     drawn as a run of half-round tiles seen end-on. At this size a roof is a
     warm band with a rhythm on its lower edge and a lit ridge on top; the
     rhythm is the only thing that separates it from a red rectangle. */
  function pantileRoof(c, x, y, rw, rh) {
    px(c, x, y, rw, rh, TILE);
    px(c, x, y, rw, 4, TILE_HI);                          // sun along the ridge
    px(c, x, y + rh - 4, rw, 4, TILE_LO);                 // the eaves in shade
    for (var i = 0; i * 9 < rw; i++) {
      px(c, x + i * 9, y + 3, 4, rh - 6, TILE_HI);        // the rolls
      px(c, x + i * 9 + 5, y + 3, 3, rh - 6, TILE_LO);    // the pans between them
    }
  }

  /* -- THE CAMPANILE. One bell tower against the blue, well left of centre
     and well above everything else — it is the only thing in the scene that
     says "village" rather than "street", and it costs six rects. Sited under
     the crown of the vault, which is the one part of the opening tall enough
     to show anything this high. */
  function drawCampanile(c, w, h) {
    var tx = w * 0.640, tw = w * 0.058, ty = h * 0.163, tb = h * 0.336;
    ashlarBlocks(c, tx, ty, tw, tb - ty, h * 0.020, ASHLAR);
    px(c, tx, ty, tw * 0.34, tb - ty, 'rgba(255,255,255,0.13)');   // the lit face
    px(c, tx + tw - 4, ty, 4, tb - ty, ASHLAR_LO);
    // the belfry opening: small, and the only dark thing this high in the
    // frame — it sits 0.024 of the height above ARCADE PIER's head, which is
    // the nearest gap, and the arcade's own facade covers its foot.
    px(c, tx + tw * 0.28, ty + h * 0.026, tw * 0.44, h * 0.040, '#3A3026');
    px(c, tx + tw * 0.28, ty + h * 0.026, tw * 0.44, 3, ASHLAR_HI);
    pantileRoof(c, tx - 4, ty - h * 0.020, tw + 8, h * 0.020);     // the pyramid cap
    px(c, tx + tw * 0.46, ty - h * 0.036, 3, h * 0.017, I_IRON);   // the cross finial
    px(c, tx + tw * 0.40, ty - h * 0.030, 15, 3, I_IRON);
  }

  /* -- THE VILLAGE BLOCK closing the street: plastered facades under pantile
     roofs, left and right of the shopfront, with shuttered upper windows.
     The eaves line STEPS rather than running level, because a street of
     houses built one at a time does not have one roofline, and the step is
     what stops the back of the scene reading as a single wall. */
  function drawVillageBlock(c, w, h, horizon) {
    var runs = [[0.000, 0.360, 0.302], [0.360, 0.560, 0.278], [0.560, 1.000, 0.316]];
    var i, k;
    for (i = 0; i < runs.length; i++) {
      var x0 = w * runs[i][0], x1 = w * runs[i][1], ey = h * runs[i][2];
      px(c, x0, ey, x1 - x0, horizon - ey, RENDER);
      px(c, x0, ey, x1 - x0, 4, RENDER_HI);               // light on the top course
      px(c, x0, horizon - h * 0.014, x1 - x0, h * 0.014, RENDER_LO);   // the foot
      px(c, x1 - 4, ey, 4, horizon - ey, RENDER_LO);      // the party wall's shade
      pantileRoof(c, x0 - 5, ey - h * 0.024, (x1 - x0) + 10, h * 0.024);
    }
    /* Upper shutters. They are the darkest things on the back facades, and
       three is all that fits: with their surrounds and sills they occupy
       0.322..0.384 vertically, so each one has to find a column that misses
       every gap AND its ten-pixel cover strip. Only three such columns exist
       on this facade — 0.068..0.128, 0.137..0.189 and 0.760..0.812 — and
       these are they. Four was one too many and the fourth landed on SHOP
       DOOR's head, which is exactly where a silhouette's helmet reads. */
    var wins = [0.075, 0.140, 0.763];
    for (k = 0; k < wins.length; k++) {
      var wx = w * wins[k], wy = h * 0.326, ww = w * 0.046, wh2 = h * 0.048;
      px(c, wx - 3, wy - 3, ww + 6, wh2 + 6, ASHLAR_HI);  // the stone surround
      px(c, wx, wy, ww, wh2, SHUTTER);
      px(c, wx, wy, ww * 0.45, wh2, SHUTTER_HI);          // the leaf facing the sun
      for (i = 1; i < 5; i++) px(c, wx, wy + wh2 * (i / 5), ww, 2, 'rgba(0,0,0,0.22)');
      px(c, wx, wy + wh2, ww, 4, ASHLAR_LO);              // the sill
    }
  }

  /* -- THE STREET. Grey cobbles, and THE PATH: a broad terracotta brick strip
     running away down the centre, narrowing as it recedes. It is the one
     saturated mass in the scene and it is what does the depth work — courses
     that deepen toward the viewer and edges that converge say "receding"
     far louder than anything drawn on the buildings.

     A LIT STONE KERB runs down both sides of it. That is a real detail of a
     real street AND the seam that keeps the red strip from bleeding into the
     grey: two materials meeting with no edge between them read as one muddy
     material at this size. */
  function drawStreet(c, w, h, horizon) {
    var y, step, r, xx, k, sw;
    px(c, 0, horizon, w, h - horizon, COBBLE);
    px(c, 0, horizon, w, 3, COBBLE_LO);                   // the ground line
    px(c, 0, horizon, w, h * 0.013, COBBLE_HI);           // sunlit strip at the far kerb
    y = horizon + h * 0.013; step = h * 0.012; r = 0;
    while (y < h) {
      px(c, 0, y, w, 2, COBBLE_LO);                       // the course joint
      xx = -w * 0.04 + (r % 2 ? w * 0.028 : 0); k = 0;
      while (xx < w) {
        sw = w * (0.032 + ((r * 3 + k * 7) % 5) * 0.011);
        px(c, xx, y, 2, step, COBBLE_LO);                 // the stone break
        if ((r + k) % 3 === 0) px(c, xx + 2, y + 2, sw - 4, step - 4, 'rgba(255,255,255,0.14)');
        if ((r + k) % 4 === 1) px(c, xx + 2, y + 2, sw - 4, step - 4, 'rgba(0,0,0,0.13)');
        if ((r + k) % 5 === 2) px(c, xx + 2, y + 2, sw - 4, step - 4, 'rgba(120,96,70,0.12)');
        xx += sw; k++;
      }
      y += step; step = Math.min(h * 0.030, step * 1.17); r++;
    }
    // ---- THE PATH. Row by row from the horizon down, each course a little
    // deeper than the last, its left and right edges read off pathAt() so
    // there is one definition of where the street goes.
    /* THE COURSES STAY SHALLOW, and that is the difference between a brick
       street and a flight of steps. The first pass grew them 7.5% a row and
       capped nothing: by the bottom of the frame each course was 30px deep
       with a lit top edge and a shaded foot, which is precisely how a stair
       tread is drawn. Half the growth and a hard cap fixes it, and the bond —
       the staggered brick ends — is what carries the texture instead. */
    y = horizon; step = h * 0.0050; r = 0;
    while (y < h) {
      var e = pathAt(y / h);
      var lx = e.l * w, rx2 = e.r * w, rh2 = Math.min(step, h - y);
      px(c, lx, y, rx2 - lx, rh2, TERRA);
      px(c, lx, y, rx2 - lx, 1, TERRA_LO);                // the bed joint, one pixel
      // brick ends, staggered on alternate courses. Their spacing is taken
      // from the course's own width, so the bond narrows with the strip.
      var bw2 = (rx2 - lx) / 8;
      for (k = (r % 2 ? 0 : 1); k * bw2 < rx2 - lx; k += 2) {
        px(c, lx + k * bw2, y, 2, rh2, TERRA_LO);
        px(c, lx + k * bw2 + 2, y + 1, bw2 - 4, rh2 - 1,
           (r + k) % 3 === 0 ? '#CB6034' : ((r + k) % 4 === 1 ? '#AE4E28' : TERRA));
        px(c, lx + k * bw2 + 2, y + 1, bw2 - 4, 1, r % 3 ? TERRA_HI : TERRA);
      }
      px(c, lx - 5, y, 5, rh2, COBBLE_HI);                // the lit kerb, left
      px(c, rx2, y, 5, rh2, COBBLE_HI);                   // and right
      y += rh2; step = Math.min(h * 0.011, step * 1.030); r++;
    }
  }

  /* -- THE GREEN SHOPFRONT at the end of the street, with its awning and the
     lamp on a wrought-iron bracket above. The doorway IS the gap.

     THE TWO CHEEKS OF THAT DOORWAY ARE SUNLIT GREEN PILASTERS, ten pixels of
     them, and the shop's glazing is held outside that. Glass is the obvious
     thing to run right up to a door and it is the wrong thing: dark panes
     against a dark doorway is the failure this whole map is at risk of. The
     panes here are pale anyway — a shop window in afternoon sun reflects the
     sky rather than showing an interior — but they are still kept clear. */
  function drawShopfront(c, w, h) {
    var r = gapPx('shop', w, h);
    var fx = r.x - w * 0.078, fw = r.w + w * 0.156;
    var fy = r.y - h * 0.028, fb = r.y + r.h;

    px(c, fx, fy, fw, fb - fy, SHOPGRN);                  // the shopfront panel
    px(c, fx, fy, fw, 4, SHOPGRN_HI);
    px(c, fx + fw - 4, fy, 4, fb - fy, SHOPGRN_LO);
    // the glazing: two pale panes reflecting the sky, held clear of the door
    var pw2 = w * 0.048, py = fy + h * 0.020, ph2 = h * 0.070;
    var panes = [fx + w * 0.010, r.x + r.w + w * 0.020];
    for (var i = 0; i < 2; i++) {
      px(c, panes[i], py, pw2, ph2, '#A9C0C6');
      px(c, panes[i], py, pw2, ph2 * 0.42, '#C6D8DA');    // the sky's share of it
      px(c, panes[i], py, pw2, 3, SHOPGRN_HI);
      px(c, panes[i] + pw2 * 0.48, py, 3, ph2, SHOPGRN);  // the glazing bar
    }
    // THE PEEK, then its two sunlit cheeks
    px(c, r.x, r.y, r.w, r.h, INFERNO_GAP);
    px(c, r.x - 10, r.y, 10, r.h, SHOPGRN_HI);
    px(c, r.x + r.w, r.y, 10, r.h, SHOPGRN_HI);
    px(c, r.x, r.y - 5, r.w, 5, SHOPGRN_LO);              // the head, in shade
    px(c, r.x - 12, r.y + r.h, r.w + 24, 5, '#2A2018');   // the threshold's shadow

    // ---- the awning: scalloped, striped cream and green, and cast down
    // onto the fascia so it reads as cloth in front of stone.
    var ay = fy - h * 0.040, ah = h * 0.034;
    for (var s = 0; s * 11 < fw; s++) {
      px(c, fx - w * 0.012 + s * 11, ay, 11, ah, s % 2 ? CLOTH : SHOPGRN_HI);
      px(c, fx - w * 0.012 + s * 11, ay + ah, 11, 6, s % 2 ? CLOTH : SHOPGRN_HI);  // the scallop
    }
    px(c, fx - w * 0.012, ay, fw + w * 0.024, 4, CLOTH_HI);
    px(c, fx, fy, fw, 5, 'rgba(20,14,10,0.28)');          // the awning's own cast
    pixelText(c, 'ALIMENTARI', fx + fw / 2, ay - h * 0.014, Math.round(h * 0.014), CLOTH_HI, 'center');

    // ---- the lamp, on a wrought-iron bracket. Iron is the darkest material
    // in this scene, so it hangs to the LEFT of the awning and stops a full
    // 0.020 of the width short of SHOP DOOR's left cheek.
    var bx = r.x - w * 0.100, by = ay - h * 0.006;
    px(c, bx, by - h * 0.030, 4, h * 0.030, I_IRON);
    px(c, bx, by - h * 0.030, w * 0.040, 4, I_IRON);
    px(c, bx, by - h * 0.030, w * 0.040, 2, I_IRON_HI);   // the sun's line along it
    px(c, bx + w * 0.026, by - h * 0.026, 4, h * 0.014, I_IRON);
    px(c, bx + w * 0.018, by - h * 0.012, w * 0.022, h * 0.020, '#F4E2A6');  // the glass
    px(c, bx + w * 0.018, by - h * 0.014, w * 0.022, 4, I_IRON);
  }

  /* -- THE TRATTORIA'S WALL down the left, and the corner it turns. Painted
     render over an ashlar plinth, a green-lettered sign board, and a
     shuttered door with a stone surround.

     THE WALL RECEDES: its eaves drop and its base rises as it runs away from
     the eye, drawn column by column rather than as a rectangle. That single
     slope is what puts the whole left side of the scene into the same
     perspective as the path, and a flat-topped wall beside a converging
     street is the thing that would make the picture read as a collage.

     THE CORNER IS FINISHED IN QUOINS, which is both how a rendered wall
     actually ends and the reason this angle is the plainest read of the
     five: the brightest ashlar on the map is exactly what abuts the gap. */
  function drawTrattoria(c, w, h) {
    var r = gapPx('corner', w, h);
    var i, x, t, topY, botY;
    for (x = 0; x < r.x; x++) {
      t = x / r.x;
      topY = lerp(h * 0.212, h * 0.268, t);               // the eaves, dropping away
      botY = lerp(h * 0.800, r.y + r.h, t);               // the base, rising away
      px(c, x, topY, 1, botY - topY, RENDER);
      px(c, x, topY, 1, 5, RENDER_HI);
      px(c, x, botY - h * 0.055, 1, h * 0.055, ASHLAR);   // the plinth it stands on
      px(c, x, botY - h * 0.055, 1, 3, ASHLAR_HI);
      px(c, x, botY - 4, 1, 4, ASHLAR_LO);
    }
    // the roof over it, following the same slope
    for (x = 0; x < r.x + w * 0.020; x++) {
      t = clamp(x / r.x, 0, 1);
      topY = lerp(h * 0.212, h * 0.268, t);
      px(c, x, topY - h * 0.024, 1, h * 0.024, TILE);
      px(c, x, topY - h * 0.024, 1, 4, TILE_HI);
      px(c, x, topY - 5, 1, 5, TILE_LO);
      if (x % 9 < 4) px(c, x, topY - h * 0.020, 1, h * 0.014, TILE_HI);
    }

    // ---- one shuttered upper window, so the wall above the sign is not a
    // blank field. It is the third dark prop on this side and it is placed
    // where the others are: y-disjoint from every gap on the map.
    var uw = w * 0.062, ux = w * 0.092, uy = h * 0.222, uh = h * 0.058;
    px(c, ux - 4, uy - 4, uw + 8, uh + 8, ASHLAR);
    px(c, ux - 4, uy - 4, uw + 8, 4, ASHLAR_HI);
    px(c, ux, uy, uw, uh, SHUTTER);
    px(c, ux, uy, uw * 0.46, uh, SHUTTER_HI);
    for (i = 1; i < 5; i++) px(c, ux, uy + uh * (i / 5), uw, 2, 'rgba(0,0,0,0.24)');
    px(c, ux - 6, uy + uh, uw + 12, 5, ASHLAR_HI);        // the sill
    px(c, ux - 6, uy + uh + 5, uw + 12, 3, ASHLAR_LO);

    // ---- the sign. Green lettering on cream is the trattoria's whole
    // identity in this scene, and it sits high on the wall where nothing it
    // could darken lives — WALL CORNER's head is 0.045 of the height below.
    var sx = w * 0.062, sy = h * 0.300, sw2 = w * 0.128, sh2 = h * 0.056;
    px(c, sx - 3, sy - 3, sw2 + 6, sh2 + 6, I_TIMBER);    // the board's frame
    px(c, sx - 3, sy - 3, sw2 + 6, 3, I_TIMBER_HI);
    px(c, sx, sy, sw2, sh2, RENDER_HI);
    pixelText(c, 'TRATTORIA', sx + sw2 / 2, sy + sh2 * 0.50, Math.round(h * 0.011), '#2C6B3C', 'center');
    px(c, sx, sy + sh2, sw2 * 0.5, 4, 'rgba(40,28,18,0.30)');

    /* ---- the shuttered door. Green shutters are the second-darkest mass on
       this wall, so the door's stone surround ENDS 0.030 of the width short
       of the quoins: measured, a surround run all the way to the corner put
       its own shaded right jamb into the seven pixels WALL CORNER is read
       against and took that pair from 158 down to 96. */
    var dx = w * 0.078, dw2 = w * 0.092, dy = h * 0.442, dh2 = h * 0.186;
    px(c, dx - 6, dy - 8, dw2 + 12, dh2 + 8, ASHLAR);     // the surround
    px(c, dx - 6, dy - 8, dw2 + 12, 5, ASHLAR_HI);
    px(c, dx, dy, dw2, dh2, SHUTTER);
    px(c, dx, dy, dw2 * 0.46, dh2, SHUTTER_HI);           // the leaf facing the sun
    for (i = 1; i < 9; i++) px(c, dx, dy + dh2 * (i / 9), dw2, 2, 'rgba(0,0,0,0.24)');
    px(c, dx + dw2 * 0.44, dy, 3, dh2, ASHLAR_DK);        // the meeting stile
    px(c, dx + dw2 * 0.36, dy + dh2 * 0.46, 6, 6, I_IRON);

    // ---- THE PEEK: the alley round the corner. Quoins to the left of it,
    // the next building's lit return to the right.
    px(c, r.x, r.y, r.w, r.h, INFERNO_GAP);
    for (i = 0; i * (h * 0.034) < r.h; i++) {             // the quoin chain
      px(c, r.x - 11, r.y + i * h * 0.034, 11, h * 0.034 - 2, i % 2 ? ASHLAR_HI : ASHLAR);
      px(c, r.x - 11, r.y + i * h * 0.034, 11, 2, ASHLAR_HI);
    }
    px(c, r.x - 11, r.y, 11, 4, ASHLAR_HI);
    px(c, r.x + r.w, r.y, 11, r.h, ASHLAR);               // the far return, in sun
    px(c, r.x + r.w, r.y, 11, 4, ASHLAR_HI);
    px(c, r.x, r.y - 5, r.w, 5, ASHLAR_LO);               // the soffit over the recess
    px(c, r.x, r.y + r.h, r.w, 5, '#241A12');             // ground contact
  }

  /* -- THE ARCADE'S INNER BAY, further down the right-hand side: two piers
     with the shaded walk between them, and that shade is the gap.

     WHY BOTH CHEEKS ARE LIT AND THAT IS NOT A CHEAT. A pier is a square
     column. The face it turns to the street is the face the sun is on, and
     on screen it is that front face — not the shaded return inside the walk —
     that abuts the opening on either side. Drawing the returns instead would
     be both darker and wrong; this is the one place on the map where the
     honest thing and the readable thing are the same thing. */
  function drawArcadeInner(c, w, h) {
    var r = gapPx('pier', w, h);
    var topY = h * 0.238, botY = h * 0.640;
    // the near pier, right of the walk, heavier because it is nearer
    ashlarBlocks(c, r.x + r.w, topY, w * 0.080, botY - topY, h * 0.036, ASHLAR);
    px(c, r.x + r.w, topY, w * 0.080, 5, ASHLAR_HI);
    px(c, r.x + r.w + w * 0.080 - 4, topY, 4, botY - topY, ASHLAR_LO);
    // the far pier's return, left of the walk — narrower, because it is one
    // bay further away and the falloff is what makes the walk read as deep
    ashlarBlocks(c, r.x - w * 0.034, topY + h * 0.014, w * 0.034, botY - topY - h * 0.014, h * 0.030, ASHLAR);

    /* THE BAY'S OWN ARCH, carved the same way the frame's vault is: a soffit
       curve filled column by column. Three stepped rects would have been
       cheaper and it would have cost the map its subject — this is the ARCADE
       map, and one arch in the foreground with a square hole behind it reads
       as a wall with a doorway. Echoing the frame's own curve at a quarter of
       its size is also the cheapest depth cue in the scene: the eye reads two
       instances of one shape as near and far, not as two different things.

       The springing sits BELOW the gap's head and the crown above it, so at
       the gap's own cheeks the soffit clears its top by 0.046 of the height —
       the arch can never cut into the opening it frames. */
    var bx0 = r.x - w * 0.034, bx1 = r.x + r.w + w * 0.080;
    var bcx = (bx0 + bx1) / 2, brx = (bx1 - bx0) / 2;
    var crown = r.y - h * 0.055, spring = r.y + h * 0.010;
    for (var bx = Math.floor(bx0); bx < bx1; bx++) {
      var bt = clamp((bx - bcx) / brx, -1, 1);
      var by2 = spring - (spring - crown) * Math.sqrt(1 - bt * bt);
      px(c, bx, topY, 1, by2 - topY, ASHLAR);
      px(c, bx, by2 - 4, 1, 4, ASHLAR_LO);                // the soffit's own shade
      px(c, bx, by2 - 1, 1, 2, ASHLAR_DK);
    }
    px(c, bx0, topY, bx1 - bx0, 5, ASHLAR_HI);            // the impost course above
    px(c, bx0, topY + 5, bx1 - bx0, 3, ASHLAR_LO);

    // THE PEEK, and the two sunlit pier faces it is read against
    px(c, r.x, r.y, r.w, r.h, INFERNO_GAP);
    px(c, r.x - 9, r.y, 9, r.h, ASHLAR_HI);
    px(c, r.x + r.w, r.y, 9, r.h, ASHLAR_HI);
    px(c, r.x, r.y - 5, r.w, 5, ASHLAR_LO);               // the soffit of the bay
    px(c, r.x, r.y + r.h, r.w, 5, '#241A12');
    // the walk's own paving, showing under the arch as a lit sill
    px(c, r.x - w * 0.034, r.y + r.h + 5, r.w + w * 0.114, h * 0.012, ASHLAR);
    px(c, r.x - w * 0.034, r.y + r.h + 5, r.w + w * 0.114, 3, ASHLAR_HI);
  }

  /* -- THE TERRACE over the lower ground on the right: a wrought-iron
     railing, terracotta pots, a cypress, and the flag strung above.

     THE RAILING IS THE MOST DANGEROUS OBJECT ON THIS MAP — a run of dark
     iron long enough to touch two gaps at once. It is confined to the band
     between ARCADE PIER's foot (0.575) and RED CAR's head (0.660), which
     leaves it 17px of clearance above and 11px below at 800px tall. Nothing
     about that band is a composition choice; it is the only horizontal strip
     on the right-hand side where a dark run can exist at all. */
  function drawTerrace(c, w, h) {
    var rx0 = w * 0.575, rx1 = w * 0.820;
    var ry0 = h * 0.596, ry1 = h * 0.646, i;
    px(c, rx0, ry0, rx1 - rx0, 6, ASHLAR_HI);             // the coping the rail stands on
    px(c, rx0, ry0 + 6, rx1 - rx0, 3, ASHLAR_LO);
    px(c, rx0, ry1 - 4, rx1 - rx0, 4, I_IRON);            // the bottom rail
    px(c, rx0, ry0 + 9, rx1 - rx0, 3, I_IRON);            // the top rail
    for (i = 0; rx0 + i * 11 < rx1; i++) {                // the balusters
      px(c, rx0 + i * 11, ry0 + 9, 3, ry1 - ry0 - 9, I_IRON);
      px(c, rx0 + i * 11, ry0 + 9, 1, ry1 - ry0 - 9, I_IRON_HI);
    }

    // ---- the cypress, standing on the terrace behind the near pier. Dark
    // and tall, and sited entirely to the right of ARCADE PIER's far cheek.
    var cx2 = w * 0.788, cb = h * 0.605;
    for (i = 0; i < 9; i++) {
      var ct = h * 0.302 + i * (cb - h * 0.302) / 9;
      var cw2 = w * (0.012 + 0.022 * (i / 8));
      px(c, cx2 - cw2, ct, cw2 * 2, (cb - h * 0.302) / 9 + 2, i % 2 ? CYPRESS : CYPRESS_HI);
      px(c, cx2 - cw2, ct, cw2 * 0.6, (cb - h * 0.302) / 9 + 2, 'rgba(255,255,255,0.08)');
    }
    terraPot(c, cx2 - w * 0.026, h * 0.606, w * 0.052, h * 0.044);

    // ---- the small potted tree at the near end of the railing. Its crown
    // stops at 0.590 — measured, a taller shrub put leaf inside ARCADE
    // PIER's foot and lifted that gap from 16 to 24 luma.
    px(c, w * 0.724, h * 0.578, w * 0.040, h * 0.026, OLIVE);
    px(c, w * 0.727, h * 0.581, w * 0.018, h * 0.012, OLIVE_HI);
    terraPot(c, w * 0.722, h * 0.602, w * 0.044, h * 0.040);

    /* ---- the flag, on a short staff off the arcade. High on the right,
       0.030 of the height above ARCADE PIER's head, because a hanging cloth
       is the kind of prop that drifts across an angle if it is sited by eye. */
    var fx = w * 0.752, fy = h * 0.258;
    px(c, fx, fy - 4, 4, h * 0.062, I_IRON);
    px(c, fx, fy - 4, w * 0.076, 4, I_IRON);
    var bands = [FLAG_G, FLAG_W, FLAG_R];
    for (i = 0; i < 3; i++) {
      px(c, fx + 6 + i * w * 0.023, fy, w * 0.023, h * 0.052, bands[i]);
      px(c, fx + 6 + i * w * 0.023, fy, w * 0.023, 3, 'rgba(255,255,255,0.28)');
    }
    px(c, fx + 6, fy + h * 0.052, w * 0.069, 3, 'rgba(0,0,0,0.20)');
  }

  // A terracotta pot: a tapered body with a proud rim. x,y is the rim's
  // top-left. The rim is drawn lighter than the body on every side, not just
  // the lit one — a pot beside a gap has to hold its value on the shaded
  // cheek too, which is the same correction Ancient makes on its crate slot.
  function terraPot(c, x, y, pw2, ph2) {
    px(c, x + pw2 * 0.08, y + ph2 * 0.18, pw2 * 0.84, ph2 * 0.82, POT);
    px(c, x + pw2 * 0.08, y + ph2 * 0.18, pw2 * 0.30, ph2 * 0.82, POT_HI);
    px(c, x + pw2 * 0.78, y + ph2 * 0.18, pw2 * 0.14, ph2 * 0.82, POT_LO);
    px(c, x, y, pw2, ph2 * 0.20, POT_HI);                 // the rim
    px(c, x, y, pw2, 3, '#F5B383');
    px(c, x, y + ph2 * 0.20, pw2, 3, POT_LO);
    px(c, x + pw2 * 0.06, y + ph2, pw2 * 0.7, 4, 'rgba(40,26,16,0.30)');
  }

  /* -- THE CHALKBOARD, hung on the wall between the sign and the door.

     IT IS DELIBERATELY NOT AS DARK AS A GAP, WIDER THAN IT IS TALL, AND HIGH
     UP. The first pass drew a proper slate: near-black, 25 by 118, standing
     on the pavement. Every contrast number passed and the render was still
     wrong, because in this scene a tall dark rectangle low in the frame IS
     the grammar for a peek angle — the player would have held an angle that
     can never open, which no measurement in the suite would ever have caught.
     Slate at 64 luma with chalk on it, landscape, and y-disjoint from every
     gap on the map, cannot be misread. */
  function drawChalkboard(c, w, h) {
    var bx = w * 0.080, by = h * 0.390, bw2 = w * 0.070, bh2 = h * 0.054;
    px(c, bx - 5, by - 5, bw2 + 10, bh2 + 10, I_TIMBER);
    px(c, bx - 5, by - 5, bw2 + 10, 4, I_TIMBER_HI);
    px(c, bx - 5, by - 5, 4, bh2 + 10, I_TIMBER_HI);
    px(c, bx, by, bw2, bh2, '#43403A');
    px(c, bx, by, bw2, 3, '#615D55');                     // the sun catching its top
    for (var i = 0; i < 3; i++) {
      px(c, bx + 4, by + h * 0.014 + i * h * 0.014, bw2 * (0.78 - 0.12 * (i % 3)), 3, '#E4DFD2');
    }
    px(c, bx + bw2 - 3, by, 3, bh2, 'rgba(0,0,0,0.26)');
    px(c, bx + bw2 * 0.20, by + bh2 + 5, bw2 * 0.6, 4, 'rgba(40,28,18,0.28)');
  }

  /* -- THE CAFE TABLES on the pavement. Two of them with red-and-white
     checked cloths to the ground, the slot between them is the gap, and a
     nearer table drawn AFTER the silhouette cuts the peeker at the waist —
     the same two-pass construction Mirage's barrels and Ancient's crates use,
     because nothing but painting it later will genuinely occlude him. */
  function drawCafeBack(c, w, h) {
    var r = gapPx('tables', w, h);
    checkCloth(c, r.x - w * 0.078, r.y, w * 0.078, r.h);
    checkCloth(c, r.x + r.w, r.y, w * 0.078, r.h);
    px(c, r.x, r.y, r.w, r.h, INFERNO_GAP);               // THE PEEK
    /* The slot rakes light down its LEFT cheek. Light in this scene comes
       from the upper left, so the left cloth's right-hand fold is the face
       turning away from it — correct, and unreadable: measured, that fold
       left 88 luma against a gap of 16 and this pair was the weakest thing
       on the map. The rim is the fix and it is Ancient's crate move exactly. */
    px(c, r.x - 6, r.y, 6, r.h, CLOTH_HI);
    px(c, r.x + r.w, r.y, 6, r.h, CLOTH);
    // The tabletops' near lip, drawn as TWO pieces with nothing spanning the
    // slot between them. One rect across both tables is the obvious way to
    // write this line and it lays a 250-luma bar straight through the gap's
    // head — measured, that took the gap's interior from 16 to 20 and put
    // white exactly where a helmet has to read.
    px(c, r.x - w * 0.078, r.y, w * 0.078, 5, CLOTH_HI);
    px(c, r.x + r.w, r.y, w * 0.078, 5, CLOTH_HI);
    px(c, r.x, r.y + r.h, r.w, 5, '#241A12');             // ground contact
  }

  function drawCafeFront(c, w, h) {
    var r = gapPx('tables', w, h);
    /* Nearer, so bigger, and its top lands across the silhouette's WAIST and
       not above it. drawEnemy puts the body between cy - s*0.72 and
       cy + s*1.5 off this same rect, so the cloth's head is placed against
       that band rather than by eye: at 0.50 of its own height it covered a
       quarter of the head-to-waist strip, which is occlusion turning into
       concealment. Ancient's front crates sit at the same fraction of theirs. */
    var tw2 = w * 0.115, th2 = h * 0.090;
    checkCloth(c, r.x + r.w * 0.12, r.y + r.h - th2 * 0.34, tw2, th2);
    // The chairs stand clear of the rect on BOTH sides. A chair back is a
    // vertical timber bar as tall as a torso, and one reaching into the slot
    // reads as part of the silhouette rather than as furniture in front of it.
    foldChair(c, r.x - w * 0.062, r.y + r.h - h * 0.052, w * 0.052, h * 0.078);
    foldChair(c, r.x + r.w + w * 0.010, r.y + r.h - h * 0.040, w * 0.050, h * 0.074);
    px(c, r.x, r.y + r.h + h * 0.046, tw2 * 1.6, 5, 'rgba(40,26,16,0.26)');
  }

  // The cloth: white squares and red, which is the map's third saturated
  // accent and the one that says "cafe" without a single extra prop.
  function checkCloth(c, x, y, cw, ch) {
    var s = Math.max(7, cw / 5), r, k;
    px(c, x, y, cw, ch, CLOTH);
    for (r = 0; r * s < ch; r++) {
      for (k = 0; k * s < cw; k++) {
        if ((r + k) % 2) px(c, x + k * s, y + r * s, Math.min(s, cw - k * s), Math.min(s, ch - r * s), CLOTH_RED);
      }
    }
    px(c, x, y, cw, 4, CLOTH_HI);                         // sun along the top fold
    px(c, x, y, cw * 0.16, ch, 'rgba(255,255,255,0.22)'); // and down the near corner
  }

  // A wooden folding chair: two legs, a seat and a slatted back. At 20px
  // that is the whole silhouette and anything more is noise.
  function foldChair(c, x, y, cw, ch) {
    px(c, x, y, cw, 5, I_TIMBER);                         // the seat
    px(c, x, y, cw, 2, I_TIMBER_HI);
    px(c, x, y - ch * 0.55, 4, ch * 0.55, I_TIMBER);      // the back's stiles
    px(c, x + cw - 4, y - ch * 0.55, 4, ch * 0.55, I_TIMBER);
    for (var i = 0; i < 3; i++) px(c, x, y - ch * (0.16 + i * 0.15), cw, 3, I_TIMBER_HI);
    px(c, x + 2, y + 5, 4, ch * 0.42, I_TIMBER);          // the legs
    px(c, x + cw - 6, y + 5, 4, ch * 0.42, I_TIMBER);
  }

  /* -- THE PARKED CAR in the near right corner: nothing of it but the red
     bonnet, the base of the windscreen and one wing, which is all that fits
     and all that is needed. It is the nearest object in the scene and the
     only pure red mass, so it anchors the corner the way Mirage's bench and
     Ancient's front crates anchor theirs.

     THE BONNET IS THE COVER FOR RED CAR, and this is the one angle on the
     map read against a saturated colour rather than a neutral. Red is a
     middling luminance even at full chroma, so the near lip of the bonnet —
     the edge a real bonnet takes a specular on — is painted in explicitly
     rather than left to the body tone. */
  function drawParkedCar(c, w, h) {
    var r = gapPx('car', w, h);
    var bx = r.x + r.w, bw2 = w - bx, by = h * 0.688;
    px(c, bx, by, bw2, h * 0.172, CAR_RED);               // the bonnet and wing
    px(c, bx, by, bw2, 6, CAR_HI);                        // sun along the bonnet's crown
    px(c, bx, by + h * 0.062, bw2, 4, CAR_LO);            // the shut line
    px(c, bx, h * 0.640, bw2, h * 0.048, '#8FA8B4');      // the windscreen's base
    px(c, bx, h * 0.640, bw2, 5, '#CFE0E4');              // the sky sitting on the glass
    px(c, bx, h * 0.676, bw2, 6, '#5E7580');              // and the dash under it
    px(c, bx, h * 0.684, bw2, 5, CAR_HI);                 // the scuttle
    px(c, bx + w * 0.030, h * 0.812, w * 0.060, h * 0.020, '#D8CFB8');   // the headlamp
    px(c, bx + w * 0.030, h * 0.812, w * 0.060, 4, CAR_LO);

    // THE PEEK, then its two cheeks: the bonnet's lit lip on the right, and
    // a terracotta pot's rim on the left. A pot lit from the upper left turns
    // its dark cheek to a gap on its right, so that rim is painted, not left.
    px(c, r.x, r.y, r.w, r.h, INFERNO_GAP);
    terraPot(c, r.x - w * 0.064, r.y + r.h * 0.48, w * 0.064, r.h * 0.48);
    px(c, r.x - 7, r.y, 7, r.h, POT_HI);
    px(c, r.x + r.w, r.y, 7, r.h, CAR_HI);
    px(c, r.x, r.y - 5, r.w, 5, COBBLE_LO);
    px(c, r.x, r.y + r.h, r.w, 5, '#241A12');
  }

  function drawCarFront(c, w, h) {
    var r = gapPx('car', w, h);
    // the bonnet's near lip, reaching across the gap's foot so the peeker is
    // cut off by the car rather than standing in front of it
    px(c, r.x + r.w * 0.46, h * 0.788, w - (r.x + r.w * 0.46), h * 0.072, CAR_RED);
    px(c, r.x + r.w * 0.46, h * 0.788, w - (r.x + r.w * 0.46), 6, CAR_HI);
    px(c, r.x + r.w * 0.46, h * 0.786, w - (r.x + r.w * 0.46), 3, CAR_LO);
    px(c, r.x + r.w * 0.40, h * 0.856, w * 0.20, 5, 'rgba(40,26,16,0.30)');
  }

  /* -- THE AFTERNOON WASH: warm light pooling on the path and long shadows
     raking across the street from the left. It is Inferno's answer to
     Ancient's dapple and it does the same job — it stops the ground reading
     as a flat sheet for the price of nine ellipses.

     EVERY WARM POOL IS SITED CLEAR OF ALL FIVE GAP RECTS, and that is a
     measurement rather than a composition note: warm light at 0.10 alpha
     lifts a gap interior by five to seven luma, which is small and still the
     wrong direction, because the gap has to stay the darkest thing on a map
     whose covers are the brightest of the three. The rake shadows are free to
     overlap anything, since they only ever darken. */
  function drawSunWash(c, w, h) {
    var pools = [[0.42, 0.865, 0.130, 0.028], [0.38, 0.780, 0.090, 0.022],
                 [0.47, 0.720, 0.085, 0.018], [0.44, 0.620, 0.055, 0.012],
                 [0.30, 0.900, 0.120, 0.026]];
    var rakes = [[0.30, 0.560, 0.180, 0.016], [0.62, 0.700, 0.150, 0.020],
                 [0.16, 0.880, 0.220, 0.026], [0.86, 0.560, 0.120, 0.018]];
    var i;
    c.save();
    for (i = 0; i < pools.length; i++) {
      c.fillStyle = 'rgba(255,236,186,0.11)';
      c.beginPath();
      c.ellipse(w * pools[i][0], h * pools[i][1], w * pools[i][2], h * pools[i][3], 0, 0, Math.PI * 2);
      c.fill();
    }
    for (i = 0; i < rakes.length; i++) {
      c.fillStyle = 'rgba(46,32,22,0.13)';
      c.beginPath();
      c.ellipse(w * rakes[i][0], h * rakes[i][1], w * rakes[i][2], h * rakes[i][3], 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /* -- THE ARCADE. Inferno's answer to Mirage's timber window and Ancient's
     stone portal, and the reason it is a different shape rather than the same
     frame in a third colour: you are standing under a vaulted arcade looking
     out, so the head of the view is a CURVE and the right-hand side is one
     heavy square pier.

     THE VAULT IS DRAWN COLUMN BY COLUMN against archSoffit(), which is the
     same expression the verification pass uses to prove no gap hides behind
     it. A curve approximated by stepped rects would need a second, different
     description of where the arch is, and a second description of anything in
     this file is how a marker ends up on the wrong angle.

     The AWP still sits against the dark walk below the sill, which is the
     whole reason a bottom band exists at all. */
  function drawArcadeFrame(c, w, h) {
    var o = INFERNO_OPEN;
    var x0 = w * o.x0, x1 = w * o.x1, y0 = h * o.y0, y1 = h * o.y1;
    var i, x;

    // inner shadow around the reveal — an opening is darker at its edge than
    // at its centre, and that gradient is most of why the street behind reads
    // as further away than the stone in front of it.
    for (i = 0; i < 5; i++) {
      var a = (0.22 - i * 0.042).toFixed(3);
      var d = i * 5;
      px(c, x0 + d, y0, 5, y1 - y0, 'rgba(26,18,12,' + a + ')');
      px(c, x1 - d - 5, y0, 5, y1 - y0, 'rgba(26,18,12,' + a + ')');
      px(c, x0, y1 - d - 5, x1 - x0, 5, 'rgba(26,18,12,' + a + ')');
    }

    // --- THE VAULT. Fill ashlar from the top of the frame down to the soffit
    // at every column, so the arch is a real arch and not a rectangle with
    // its corners chamfered.
    for (x = 0; x < w; x++) {
      var sy = h * archSoffit(x / w);
      if (x < x0 || x > x1) sy = h;                       // the jambs run full height
      px(c, x, 0, 1, sy, ASHLAR);
      px(c, x, sy - 4, 1, 4, ASHLAR_LO);                  // the soffit's own shade
      px(c, x, sy - 1, 1, 2, ASHLAR_DK);                  // and the hard line under it
    }
    // voussoirs: radial joints stepping round the arch, which is what makes
    // the curve read as cut stone rather than as a hole punched in a wall
    c.save();
    c.strokeStyle = ASHLAR_DK; c.lineWidth = 2;
    var cxF = (o.x0 + o.x1) / 2, rxF = (o.x1 - o.x0) / 2, ryF = ARCH_SPRING - o.y0;
    for (i = 0; i <= 18; i++) {
      var th = Math.PI + i * (Math.PI / 18);
      var vx = (cxF + rxF * Math.cos(th)) * w, vy = (ARCH_SPRING + ryF * Math.sin(th)) * h;
      var nx = Math.cos(th) / rxF, ny = Math.sin(th) / ryF;
      var nl = Math.hypot(nx, ny);
      c.beginPath();
      c.moveTo(vx, vy);
      c.lineTo(vx - (nx / nl) * w * 0.055, vy - (ny / nl) * h * 0.030);
      c.stroke();
    }
    c.restore();
    // the coursing of the spandrels above the arch, and the string course
    ashlarBlocks(c, 0, 0, w, h * 0.070, h * 0.030, ASHLAR);
    px(c, 0, h * 0.070, w, 6, ASHLAR_HI);
    px(c, 0, h * 0.076, w, 4, ASHLAR_LO);

    // --- the heavy square pier down the right, in the biggest coursing on
    // the map because it is the nearest stone in the scene.
    ashlarBlocks(c, x1, 0, w - x1, h, h * 0.058, ASHLAR);
    px(c, x1, 0, (w - x1) * 0.34, h, 'rgba(0,0,0,0.20)'); // its reveal, turned away
    px(c, x1, 0, 3, h, '#2A2018');                        // the corner itself
    // --- and the thin left jamb, which takes the sun full on
    ashlarBlocks(c, 0, 0, x0, h, h * 0.058, ASHLAR);
    px(c, 0, 0, x0, h, 'rgba(255,255,255,0.12)');
    px(c, x0 - 3, 0, 3, h, '#2A2018');

    // --- the sill, then the arcade's own shaded walk below it.
    px(c, 0, y1, w, h * 0.014, ASHLAR_HI);                // the lit front edge
    px(c, 0, y1 + h * 0.014, w, h * 0.034, ASHLAR);
    for (i = 0; i < 5; i++) px(c, (i * 0.21 + 0.03) * w, y1 + h * 0.026, w * 0.11, 2, ASHLAR_LO);
    px(c, 0, y1 + h * 0.048, w, h - (y1 + h * 0.048), '#1A1410');
    px(c, 0, y1 + h * 0.048, w, 3, '#0C0906');
  }

  /* ======================================================================
     THE ANGLE MARKERS (owner: "it needs to be obvious where the enemies can
     peek"). Five corner brackets, one per entry in the ACTIVE MAP's angle
     array (defs()), iterated
     straight off that array — there is deliberately no list of marker
     positions anywhere in this file, because a second list is how a marker
     ends up bracketing a gap that is not the one that opens.

     WHY BRACKETS AND NOT A FILL OR AN OUTLINE. A closed outline reads as a
     hitbox and turns five pieces of architecture into five buttons; a tinted
     fill fights the map's gap colour, which is the one thing every peek is read
     against. Corners state the extent of a slice and leave its middle — where
     the silhouette actually appears — completely untouched.

     WHY EACH BRACKET IS TWO-TONE. Across the two maps the cover beside a
     gap ranges from Mirage's teal render at luma 98 to its white plaster at
     220, taking in Ancient's limestone, planking and yellow signage on the
     way, so no single colour can read against all of them — and a third map
     will widen that range again. Each arm is therefore a bone segment just
     INSIDE the gap (against the gap colour, the darkest thing in the scene) with
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
    for (var i = 0, A = defs(); i < A.length; i++) {
      var a = base;
      if (state === 'tell' && i === angleIdx) {
        // ~3Hz, and it is a lift on top of base rather than a replacement, so
        // the tell never reads DIMMER than the four angles it is not naming.
        a = Math.max(a, 0.62 + 0.28 * (0.5 + 0.5 * Math.sin(t / 160)));
      }
      drawBracket(c, angleRectPx(A[i], w, h), a, grow);
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
    var def = defs()[angleIdx];
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
    // Without it a dark silhouette inside the gap loses its own outline at
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
      pixelText(c, 'FOOTSTEPS — ' + defs()[angleIdx].label, w / 2, h - 22, 12, '#E8E2D0', 'center');
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
    activeMap.back(c, w, h);
    // The brackets go INSIDE the sandwich, not on top of it: painted after
    // the back scene but before the enemy and the front scene, so the low
    // wall's cap and the front barrel row cut across them exactly as they cut
    // across a peeker. A marker floating over the cover it belongs behind is
    // the thing that would make these read as UI stuck onto the map.
    drawAngleMarkers(c, w, h);
    drawEnemy(c, w, h);
    activeMap.front(c, w, h);
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
      // The map is chosen ONCE per run, before anything reads defs() — the
      // whole LAN is played on one site, because a map that changed between
      // rounds would throw away everything the player learned in round 1.
      pickMap();
      if (labelEl) labelEl.textContent = 'THE CLUTCH — ' + activeMap.name;
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

    // Test seam: deterministic angle sequence AND map pick. Call BEFORE
    // run() — it seeds the module's PRNG, so pickMap() and pickAngle() (and
    // therefore every tell/peek/hitbox in the LAN that follows) reproduce.
    __force: function (seed) { seedRng(seed); return true; },

    /* Test seam: the map table itself, mirroring js/matchgames.js's
       __maps(). The thing worth asserting about a map is the RELATIONSHIP
       between its gap colour and the cover beside each angle, and that is a
       property of the data — so the suite reads the data rather than
       regexing colour literals back out of this file's source. A regex over
       source can only ever check the map someone remembered to write a
       pattern for; this enumerates every map that exists, including ones
       added after the check was written. */
    __maps: function () { return CLUTCH_MAPS; },

    // Which map the LAN currently in progress is being played on. Separate
    // from __maps() because "what exists" and "what is loaded" are different
    // questions and conflating them is how a per-map assertion ends up
    // silently only ever exercising whichever map happened to be picked.
    __activeMap: function () { return activeMap; },

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
