/* ==========================================================================
   CS2 PRO SIMULATOR — js/sheep.js
   COUNTING SHEEP (SPEC-V4 §7, reworked per SPEC-V5 §2, rebuilt V19-C,
   finished V20-S): a purely optional shooting-gallery minigame that runs for
   the whole time the player is ASLEEP. It is drawn inside a cartoon THOUGHT
   BUBBLE floating above the sleeping player, with 3 small trailing circles
   leading down to the bed's projected screen position. Everything about the
   minigame (the night meadow, the fence, the sheep, the tap hit-test) lives
   inside that bubble; tapping a sheep calls back out to State.sheepHit() via
   hub.js (Package L owns all the reward math — this file only decides WHERE
   a sheep is on screen and WHETHER a tap landed on one, never how much it
   pays out).

   Ownership split with js/hub.js, on purpose:
   - hub.js's own rAF loop (in loop()) is the ONLY animation-frame owner on
     this screen. It calls Sheep.update(ts) + Sheep.render(ctx, w, h, ts,
     status) once asleep each frame, and routes canvas taps into
     Sheep.handleTap() while asleep. This file registers no timers or rAF
     loops of its own — nothing to leak, nothing to double-cancel.
   - Sheep.start()/stop() just resets/clears in-memory state; they do NOT
     touch State.data (sheepHitsThisSleep/sheepCashThisSleep already reset
     inside State.sleep() — see state.js — so this file never re-derives or
     duplicates that bookkeeping, only the on-screen sheep positions).

   Never blocks sleeping: energy keeps regenerating at the bed's rate via
   hub.js's own tickEnergy() call regardless of whether this file is even
   loaded — this is presentation + a thin State.sheepHit() trigger, nothing
   in the wake-gate path depends on it. A missed sheep (never tapped, walks
   off the far edge) is simply removed — no penalty is ever applied, per
   spec ("a missed sheep is just a miss"); a missed TAP only leaves a small
   dust puff where the finger landed, which is feedback, not punishment.

   ART: follows ART-DIRECTION.md, not generic canvas habit — the sheep is a
   real pixel-art sprite (cell grid, 1-cell near-black outline, 3-tone wool
   ramp), shadows are hard and unblurred, and the night scene is built from
   flat colour bands rather than soft gradient mush. Motion is the life:
   proper hop arcs with squash-and-stretch, bending legs that plant on the
   drawn ground line, a wagging tail, kicked-up dust on every landing, wool
   bursts on a hit, drifting mist and parallax hills behind. Ambient motion
   (mist, parallax, star twinkle, shooting stars) honours
   prefers-reduced-motion; the sheep themselves are the game and always move.
   ========================================================================== */
(function (G) {
  'use strict';

  /* ---- palette (canvas cannot read CSS variables — literals are correct
     convention here; these mirror ART-DIRECTION.md's world) ---------------- */
  var K = '#05070f';        // the 1-cell outline every sprite carries
  var SKY_TOP = '#0a0e28';
  var SKY_MID = '#182047';
  var SKY_LOW = '#2c3566';
  var HILL_FAR = '#1b2245';
  var HILL_NEAR = '#141a36';
  var GRASS_TOP = '#2f6b3c';
  var GRASS_MID = '#26592f';
  var GRASS_LOW = '#1c4526';
  var PATH_HI = '#5c5334';
  var PATH_LO = '#3e3722';
  var FENCE_TOP = '#a5794a';
  var FENCE_MID = '#7a5632';
  var FENCE_DARK = '#4a3320';

  var active = false;
  var sheep = [];           // live sheep — see spawn() for the shape
  var rewards = [];         // floating "+$N" pop-ups: { sx, sy, text, color, spawnTs }
  var puffs = [];           // wool motes / hoof dust
  var sparks = [];          // hit starburst rays
  var rings = [];           // hit shockwave / miss dust ring
  var stars = [];           // normalised star field, seeded once per sleep
  var tufts = [];           // normalised foreground grass tufts

  var lastTs = 0;
  var lastSpawnTs = 0;
  var nextSpawnGapMs = 1400;
  var lastSide = 0;         // anti-repeat bias so sides genuinely alternate-ish
  var streak = 0;
  var lastHitTs = 0;
  var ramp = 0;             // THE difficulty dial, 0..1 — see update()
  var geom = null;          // last-computed bubble geometry (render() writes it, handleTap() reads it)

  var RAMP_MS = 105000;     // ~1m45s of ENGAGED tapping from "gentle" to "busy"
  var STREAK_WINDOW = 2200; // ms between hits before the streak resets
  var ENGAGED_MS = 7000;    // a hit inside this window still counts as "playing"
  var HIT_ANIM_MS = 320;    // how long a struck sheep stays on screen reacting

  var reduceMQ = null;
  function reduced() {
    if (reduceMQ === null) {
      reduceMQ = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')) || false;
    }
    return !!(reduceMQ && reduceMQ.matches);
  }

  function rand(min, max) { return min + Math.random() * (max - min); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---- sheep variants ------------------------------------------------------
     Each must be readable AT A GLANCE — a variant the player cannot see
     coming is noise, not difficulty. So every one of them changes the wool
     ramp (colour) AND carries a silhouette tell, not just numbers:
       plain  white wool, ordinary rhythm
       swift  amber wool + speed lines streaming behind it
       high   ice-blue wool + a tall tuft standing off its head
       trick  charcoal wool + a pale face; it visibly STALLS (with a "!"
              above it and a skid of dust) before it bolts. */
  var VARIANTS = {
    plain: {
      L: '#f7f8ff', M: '#ced5ee', D: '#9aa3c6',
      face: '#2b3252', faceD: '#161b30', muzzle: '#5b6489', leg: '#2b3252',
      eye: '#ffffff', pupil: K, speed: 1.00, hop: 1.00, tuft: 0
    },
    swift: {
      L: '#ffe3a6', M: '#f0b955', D: '#b17f28',
      face: '#4a2f10', faceD: '#281705', muzzle: '#8a5c22', leg: '#4a2f10',
      eye: '#ffe9b8', pupil: K, speed: 1.85, hop: 0.70, tuft: 0
    },
    high: {
      L: '#dcefff', M: '#95c6f6', D: '#5487bf',
      face: '#1b3a63', faceD: '#0d2240', muzzle: '#3d6a9e', leg: '#1b3a63',
      eye: '#ffffff', pupil: K, speed: 0.80, hop: 1.90, tuft: 1
    },
    trick: {
      L: '#8189a6', M: '#4a5170', D: '#2b3049',
      face: '#e8ecff', faceD: '#a7b0d0', muzzle: '#b7bfdc', leg: '#c9d0ea',
      eye: '#2b3049', pupil: '#ffffff', speed: 1.00, hop: 1.10, tuft: 0
    }
  };

  /* ---- the sprite ----------------------------------------------------------
     A real pixel grid, drawn cell-by-cell, facing RIGHT (flipped for sheep
     travelling left). Legend:
       K outline · L/M/D the 3-tone wool ramp · F face · H ear + far-cheek
       shadow · N muzzle · E eye white · P pupil

     THE HEAD IS PART OF THE SAME MASS. Rows 6-8 run wool (col 17) straight
     into face (col 18) with NO outline column between them, and the head sits
     three rows BELOW the shoulder line with the fleece draping over its top —
     that is what stops it reading as a detached wedge floating alongside the
     body. The head's own outline only exists where it actually meets sky.

     Legs and tail are NOT in the grid — they are drawn procedurally so they
     can bend, swing and tuck through the hop arc. */
  var SPRITE = [
    '....KK....KK............',  //  0  wool curls on the crown
    '...KLLK.KLLK............',  //  1
    '..KLLLLKLLLLKKK.........',  //  2  body top
    '.KLLLLLLLLLLLLLK........',  //  3
    'KLLLLLLLLLLLLLLLK.......',  //  4
    'KLLLLLLLLLLLLLLLLKKKKK..',  //  5  skull's top outline, tucked under the fleece
    'KLLLLLLLLLLLLLLLLLHHFFK.',  //  6  <- col17 wool MEETS col18 ear: the join
    'KLLLLLLMLLLLLLLLLLFEPFFK',  //  7  <- eye, forward-looking
    'KLMMMMMMMMMMMMMMMLFFFFHK',  //  8  <- cheek, shaded on the far side
    'KMMMMMMMMMMMMMMMMMKFFNNK',  //  9  <- jaw line, then the muzzle begins
    'KMDDDDDDDDDDDDDDMK.KNNNK',  // 10  throat gap under the jaw + the nose
    '.KDDDDDDDDDDDDDDK..KKKKK',  // 11  belly / chin outline
    '..KKKKKKKKKKKKKK........'   // 12  belly outline; legs hang from here
  ];
  var SPRITE_W = 24, SPRITE_H = SPRITE.length;

  /* Foot anchoring, stated once so it cannot drift again:
     drawSheepSprite() is translated to (x, y) where **y IS THE GROUND LINE**.
     The body is lifted STAND_CELLS above it and the legs exactly bridge that
     gap, so a grounded sheep's hooves finish at local y = 0 — on the drawn
     path, never sunk through it. Squash-and-stretch scales about that same
     origin, so it can never push the hooves under the line either. */
  var STAND_CELLS = 4.0;    // body-bottom clearance above the ground line
  var LEG_TOP_CELLS = 1.2;  // how far the legs start up INSIDE the belly
  var LEG_FULL = STAND_CELLS + LEG_TOP_CELLS; // grounded leg length, in cells

  function start() {
    active = true;
    sheep = [];
    rewards = [];
    puffs = [];
    sparks = [];
    rings = [];
    lastTs = 0;
    lastSpawnTs = 0;
    lastSide = 0;
    streak = 0;
    lastHitTs = 0;
    ramp = 0;
    geom = null;
    nextSpawnGapMs = rand(450, 1000); // first sheep arrives quickly, not instantly

    stars = [];
    for (var i = 0; i < 34; i++) {
      stars.push({ x: Math.random(), y: Math.random() * 0.52, r: Math.random() < 0.78 ? 1 : 2, ph: rand(0, Math.PI * 2), sp: rand(0.6, 1.8) });
    }
    tufts = [];
    for (var j = 0; j < 14; j++) {
      tufts.push({ x: Math.random(), y: rand(0.62, 1.0), h: rand(0.6, 1.3) });
    }
  }

  function stop() {
    active = false;
    sheep = [];
    rewards = [];
    puffs = [];
    sparks = [];
    rings = [];
    geom = null;
  }

  function isActive() { return active; }

  /* ---- difficulty ----------------------------------------------------------
     One 0..1 dial. It advances with time but MUCH faster while the player is
     actually engaged (a hit inside the last ENGAGED_MS), which is what the
     brief asks for: "difficulty ramping the longer the player stays tapping",
     not merely the longer they lie there. Everything that gets harder reads
     off this one number, so the ramp is a single tunable curve rather than
     four drifting ones. */
  function difficulty() { return ramp; }

  function pickVariant(L) {
    // Weighted, and each variant only unlocks once the ramp has climbed far
    // enough — the player learns one silhouette at a time.
    var w = [['plain', 1.0]];
    if (L > 0.12) w.push(['swift', 0.10 + L * 0.35]);
    if (L > 0.28) w.push(['high', 0.10 + L * 0.30]);
    if (L > 0.50) w.push(['trick', 0.08 + L * 0.26]);
    var tot = 0, i;
    for (i = 0; i < w.length; i++) tot += w[i][1];
    var r = Math.random() * tot;
    for (i = 0; i < w.length; i++) { r -= w[i][1]; if (r <= 0) return w[i][0]; }
    return 'plain';
  }

  function spawn(ts, L, forceDir) {
    // Side: honest coin-flip, nudged away from whichever side went last so
    // the player cannot camp one edge, but never a strict alternation (that
    // would be its own memorisable rhythm). BOTH sides, always.
    var dir;
    if (forceDir) dir = forceDir;
    else if (lastSide === 0) dir = Math.random() < 0.5 ? 1 : -1;
    else dir = Math.random() < 0.62 ? -lastSide : lastSide;
    lastSide = dir;

    var vkey = pickVariant(L);
    var v = VARIANTS[vkey];
    var baseCross = lerp(4700, 2500, L) * rand(0.82, 1.24);
    sheep.push({
      dir: dir,
      variant: vkey,
      p: 0,
      crossMs: baseCross / v.speed,
      hopMs: lerp(560, 430, L) * rand(0.86, 1.18) / Math.sqrt(v.speed),
      hopT: rand(0, 400),
      hopMul: v.hop * rand(0.88, 1.15),
      lastPhase: null,
      stalled: false,
      hit: false,
      hitAt: 0,
      sx: 0, sy: 0, sr: 0
    });
    return sheep[sheep.length - 1];
  }

  /* ---- bubble geometry -----------------------------------------------------
     bedAnchor(): finds the player's actual bed prop (category 'bed', always
     exactly one placed — desk/chair/PC/monitor/bed are singletons) and
     projects it to screen space via js/iso.js's own camera math, so the
     bubble's trailing circles genuinely lead down to wherever the bed is in
     THIS room/location, not a hardcoded guess. Falls back to a fixed point
     if state/iso aren't ready for any reason — never lets a missing bed
     break the minigame. */
  function bedAnchor(w, h) {
    var Iso = G.Iso, State = G.State;
    if (Iso && State && State.data) {
      try {
        var placed = State.data.placed || [];
        var bed = null;
        for (var i = 0; i < placed.length; i++) {
          var def = State.findShopItem ? State.findShopItem(placed[i].id) : null;
          if (def && def.category === 'bed') { bed = placed[i]; break; }
        }
        if (bed) {
          var roomVisual = Iso.getRoomVisual(State.data);
          var camera = Iso.computeCamera(w, h, roomVisual);
          return Iso.project(bed.x + 0.5, bed.y + 0.3, 30, camera);
        }
      } catch (e) { /* fall through to the default anchor below */ }
    }
    return { x: w * 0.58, y: h * 0.62 };
  }

  // computeGeom: bubble body + interior play area + fence line + 3 tail
  // circles trailing down to the bed anchor. Recomputed every render() frame
  // (cheap — a handful of arithmetic ops plus one Iso.project call, same
  // cost class as what hub.js's own loop already does every frame) so a
  // window resize or a differently-located bed always stays correct.
  function computeGeom(w, h) {
    var anchor = bedAnchor(w, h);
    var bw = clampNum(w * 0.78, 180, 306);
    var bh = bw * 0.66;
    var tailGap = clampNum(h * 0.075, 26, 50);
    var cx = clampNum(anchor.x, bw / 2 + 8, w - bw / 2 - 8);
    var bottomY = clampNum(anchor.y - tailGap, bh / 2 + 14, h * 0.58);
    var cy = bottomY - bh / 2;
    var pad = 7; // outline thickness allowance before the interior clip
    var interior = { x: cx - bw / 2 + pad, y: cy - bh / 2 + pad, w: bw - pad * 2, h: bh - pad * 2 };
    var scale = clampNum(interior.w / 210, 0.55, 1.45);
    var tailStart = { x: lerp(cx, anchor.x, 0.18), y: bottomY };
    var tails = [0.32, 0.60, 0.85].map(function (t, i) {
      return { x: lerp(tailStart.x, anchor.x, t), y: lerp(tailStart.y, anchor.y, t), r: [10, 7, 4.4][i] * clampNum(scale, 0.55, 1.1) };
    });
    return {
      bubble: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, r: bh * 0.38 },
      interior: interior,
      fenceY: interior.y + interior.h * 0.54,   // top rail of the fence
      groundY: interior.y + interior.h * 0.78,  // THE ground line — hooves land exactly here
      horizonY: interior.y + interior.h * 0.46,
      scale: scale,
      cell: Math.max(1, Math.round(interior.w / 150)),
      tails: tails
    };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /* ======================================================================
     UPDATE — hub.js's rAF loop drives this; no loop of our own.
     ====================================================================== */
  function update(ts) {
    if (!active) return;
    if (!lastTs) { lastTs = ts; lastSpawnTs = ts; }
    var dt = clampNum(ts - lastTs, 0, 120); // a backgrounded tab must not teleport the flock
    lastTs = ts;

    // ---- the ramp: engagement-weighted, so a player who keeps tapping gets
    // a genuinely busier meadow roughly twice as fast as one who just watches.
    var engaged = lastHitTs && (ts - lastHitTs) < ENGAGED_MS;
    ramp = clampNum(ramp + (dt / RAMP_MS) * (engaged ? 1.7 : 0.5), 0, 1);
    var L = ramp;

    if (streak && ts - lastHitTs > STREAK_WINDOW) streak = 0;

    // ---- spawning: gap shrinks and the flock gets denser as the ramp climbs
    var maxConcurrent = 3 + Math.round(L * 3);
    if (ts - lastSpawnTs >= nextSpawnGapMs) {
      lastSpawnTs = ts;
      nextSpawnGapMs = lerp(1500, 430, L) * rand(0.66, 1.42);
      var liveCount = 0;
      for (var i = 0; i < sheep.length; i++) if (!sheep[i].hit) liveCount++;
      if (liveCount < maxConcurrent) {
        var first = spawn(ts, L);
        // At high difficulty a spawn occasionally comes in PAIRS from opposite
        // sides — the moment the player has to actually split attention.
        if (L > 0.45 && Math.random() < 0.14 + L * 0.20 && liveCount + 2 <= maxConcurrent) {
          spawn(ts, L, -first.dir);
        }
      }
    }

    // ---- movement
    for (var s, n = 0; n < sheep.length; n++) {
      s = sheep[n];
      if (s.hit) continue;
      var mul = 1;
      if (s.variant === 'trick') {
        // The fake-out: cruises, visibly STALLS around a third of the way in,
        // then bolts. Charcoal wool, a pale face and a "!" over its head
        // announce it before it does either — readable, not random.
        mul = s.p < 0.32 ? 1 : (s.p < 0.50 ? 0.18 : 2.05);
      }
      s.p += (dt / s.crossMs) * mul;
      s.hopT += dt;
    }

    sheep = sheep.filter(function (s) {
      if (s.hit) return ts - s.hitAt < HIT_ANIM_MS;
      return s.p < 1.06;
    });

    // ---- particles
    var i2;
    for (i2 = puffs.length - 1; i2 >= 0; i2--) {
      var pf = puffs[i2];
      pf.life -= dt;
      if (pf.life <= 0) { puffs.splice(i2, 1); continue; }
      pf.x += pf.vx * dt; pf.y += pf.vy * dt;
      pf.vy += 0.00016 * dt; // gentle gravity so wool settles instead of flying forever
      pf.vx *= 0.995;
    }
    for (i2 = sparks.length - 1; i2 >= 0; i2--) {
      sparks[i2].life -= dt;
      if (sparks[i2].life <= 0) sparks.splice(i2, 1);
    }
    for (i2 = rings.length - 1; i2 >= 0; i2--) {
      rings[i2].life -= dt;
      if (rings[i2].life <= 0) rings.splice(i2, 1);
    }
    rewards = rewards.filter(function (r) { return ts - r.spawnTs < 950; });
  }

  /* ======================================================================
     SCENE
     ====================================================================== */

  function drawSky(ctx, ix, iy, iw, ih, horizonY, ts) {
    // Flat bands, not a smooth gradient — the committed world is banded and
    // hard-edged, and banding keeps the sheep silhouette readable on top.
    var bands = [SKY_TOP, SKY_MID, SKY_LOW];
    var top = iy - 6, bottom = horizonY;
    for (var b = 0; b < bands.length; b++) {
      ctx.fillStyle = bands[b];
      var y0 = lerp(top, bottom, b / bands.length);
      var y1 = lerp(top, bottom, (b + 1) / bands.length);
      ctx.fillRect(ix - 6, y0, iw + 12, (y1 - y0) + 1);
    }

    // stars — twinkle only when motion is welcome
    var still = reduced();
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var a = still ? 0.7 : 0.42 + 0.48 * (0.5 + 0.5 * Math.sin(ts * 0.0016 * st.sp + st.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#eef3ff';
      ctx.fillRect(Math.round(ix + st.x * iw), Math.round(iy + st.y * ih), st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // a shooting star every ~9s — one small event that rewards just looking
    if (!still) {
      var CYC = 9000, t = (ts % CYC) / CYC;
      if (t < 0.10) {
        var idx = Math.floor(ts / CYC);
        var seed = ((idx * 9301 + 49297) % 233280) / 233280;
        var k = t / 0.10;
        var sx0 = ix + iw * (0.15 + seed * 0.55) + k * iw * 0.42;
        var sy0 = iy + ih * (0.05 + seed * 0.22) + k * ih * 0.18;
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx0 - iw * 0.09, sy0 - ih * 0.04);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawMoon(ctx, ix, iy, iw, scale) {
    var mx = Math.round(ix + iw * 0.80);
    var my = Math.round(iy + 20 * scale);
    var r = Math.max(8, 12 * scale);
    if (G.Iso && G.Iso.glow) G.Iso.glow(ctx, mx, my, r * 3.4, '#fff6cf', 0.16);
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f6f0cd'; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2 * scale); ctx.strokeStyle = K; ctx.stroke();
    // craters, on the shaded side — 3-tone, same ramp logic as every prop
    ctx.fillStyle = '#d9d0a4';
    ctx.beginPath(); ctx.arc(mx + r * 0.30, my + r * 0.22, r * 0.30, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx - r * 0.34, my + r * 0.40, r * 0.19, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + r * 0.06, my - r * 0.44, r * 0.15, 0, Math.PI * 2); ctx.fill();
  }

  // Two silhouette hill layers that drift at different rates — the parallax
  // that turns one flat plane into a world with depth.
  function drawHills(ctx, ix, iy, iw, horizonY, ts, scale) {
    var still = reduced();
    var layers = [
      { col: HILL_FAR, amp: 9 * scale, base: horizonY - 12 * scale, freq: 2.1, sp: still ? 0 : 0.0035, ph: 0 },
      { col: HILL_NEAR, amp: 13 * scale, base: horizonY - 3 * scale, freq: 1.4, sp: still ? 0 : 0.0075, ph: 1.7 }
    ];
    for (var l = 0; l < layers.length; l++) {
      var L2 = layers[l];
      var off = ts * L2.sp;
      ctx.beginPath();
      ctx.moveTo(ix - 6, horizonY + 40);
      for (var x = -6; x <= iw + 6; x += 3) {
        var u = (x + off) / iw;
        var y = L2.base - Math.sin(u * Math.PI * 2 * L2.freq + L2.ph) * L2.amp
                        - Math.sin(u * Math.PI * 2 * L2.freq * 2.7 + L2.ph) * L2.amp * 0.35;
        ctx.lineTo(ix + x, y);
      }
      ctx.lineTo(ix + iw + 6, horizonY + 40);
      ctx.closePath();
      ctx.fillStyle = L2.col;
      ctx.fill();
    }
  }

  // drawGround: flat grass bands, plus THE PATH — a trodden dirt track whose
  // top edge is literally groundY. Without a drawn line there is nothing for
  // the eye to check the hooves against, which is exactly how "the feet sink"
  // became arguable last time. Now it is visible and falsifiable.
  function drawGround(ctx, ix, iw, horizonY, groundY, bottom, scale) {
    var h = bottom - horizonY;
    ctx.fillStyle = GRASS_TOP; ctx.fillRect(ix - 6, horizonY, iw + 12, h * 0.34 + 1);
    ctx.fillStyle = GRASS_MID; ctx.fillRect(ix - 6, horizonY + h * 0.34, iw + 12, h * 0.30 + 1);
    ctx.fillStyle = GRASS_LOW; ctx.fillRect(ix - 6, horizonY + h * 0.64, iw + 12, h * 0.36 + 2);
    // the horizon edge itself gets the outline treatment, like every other edge
    ctx.fillStyle = K; ctx.fillRect(ix - 6, horizonY - 1, iw + 12, 1.5);

    var pathH = Math.max(4, 6 * scale);
    ctx.fillStyle = K; ctx.fillRect(ix - 6, Math.round(groundY) - 1, iw + 12, 1);
    ctx.fillStyle = PATH_HI; ctx.fillRect(ix - 6, Math.round(groundY), iw + 12, Math.max(1, pathH * 0.4));
    ctx.fillStyle = PATH_LO; ctx.fillRect(ix - 6, Math.round(groundY) + pathH * 0.4, iw + 12, pathH * 0.6);
    ctx.fillStyle = K; ctx.fillRect(ix - 6, Math.round(groundY) + pathH, iw + 12, 1);
  }

  // Mist: soft lobed banks sliding at different speeds. Pure ambience —
  // frozen under prefers-reduced-motion. Kept off the ground line itself so
  // it never hides where the hooves land.
  function drawMist(ctx, ix, iw, groundY, ts, scale, front) {
    var still = reduced();
    var bands = front
      ? [{ y: groundY + 22 * scale, h: 8 * scale, sp: 0.024, a: 0.13 }]
      : [{ y: groundY - 30 * scale, h: 7 * scale, sp: 0.011, a: 0.09 },
         { y: groundY - 14 * scale, h: 9 * scale, sp: -0.016, a: 0.12 }];
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var span = iw + 160;
      var off = still ? i * 53 : ((ts * b.sp) % span + span) % span;
      ctx.globalAlpha = b.a;
      ctx.fillStyle = '#e6edff';
      for (var k = -1; k <= 1; k++) {
        var x0 = ix - 80 + off + k * span;
        for (var lobe = 0; lobe < 7; lobe++) {
          var lx = x0 + lobe * (span / 7);
          var lw = (span / 7) * (0.55 + 0.35 * Math.sin(lobe * 2.3 + i));
          var lh = b.h * (0.6 + 0.5 * Math.sin(lobe * 1.7 + i * 2));
          ctx.beginPath();
          ctx.ellipse(lx, b.y + Math.sin(lobe * 1.1 + i) * b.h * 0.4, lw, lh, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // drawFence: real posts with a 3-tone ramp and a near-black outline, plus a
  // hard unblurred shadow cast onto the grass — depth, not two grey lines.
  function drawFence(ctx, ix, iw, fenceY, groundY, scale) {
    var railH = Math.max(3, 4 * scale);
    var postGap = Math.max(22, 34 * scale);
    var postW = Math.max(4, 6 * scale);
    var postTop = fenceY;
    var postBot = groundY - 2 * scale; // the fence stands BEHIND the path, not on it

    // hard shadow strip on the grass, offset like every other shadow in the game
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#0d2415';
    ctx.fillRect(ix - 6, postBot + 1, iw + 12, 3 * scale);
    ctx.globalAlpha = 1;

    function rail(y) {
      ctx.fillStyle = K; ctx.fillRect(ix - 6, y - 1, iw + 12, railH + 2);
      ctx.fillStyle = FENCE_TOP; ctx.fillRect(ix - 6, y, iw + 12, Math.max(1, railH * 0.4));
      ctx.fillStyle = FENCE_MID; ctx.fillRect(ix - 6, y + railH * 0.4, iw + 12, railH * 0.6);
    }
    rail(postTop + 2 * scale);
    rail(lerp(postTop, postBot, 0.58));

    for (var x = ix + postGap * 0.4; x < ix + iw; x += postGap) {
      var px = Math.round(x);
      ctx.fillStyle = K; ctx.fillRect(px - 1, postTop - 1, postW + 2, (postBot - postTop) + 2);
      ctx.fillStyle = FENCE_MID; ctx.fillRect(px, postTop, postW, postBot - postTop);
      ctx.fillStyle = FENCE_TOP; ctx.fillRect(px, postTop, Math.max(1, postW * 0.45), postBot - postTop);
      ctx.fillStyle = FENCE_DARK; ctx.fillRect(px + postW * 0.7, postTop, Math.max(1, postW * 0.3), postBot - postTop);
    }
  }

  function drawTufts(ctx, ix, iw, groundY, bottom, scale) {
    ctx.fillStyle = '#173b20';
    for (var i = 0; i < tufts.length; i++) {
      var t = tufts[i];
      var x = Math.round(ix + t.x * iw);
      var y = Math.round(lerp(groundY + 12 * scale, bottom, t.y));
      var hh = Math.max(2, 5 * scale * t.h);
      ctx.fillRect(x, y - hh, Math.max(1, scale), hh);
      ctx.fillRect(x - Math.max(1, 2 * scale), y - hh * 0.6, Math.max(1, scale), hh * 0.6);
      ctx.fillRect(x + Math.max(1, 2 * scale), y - hh * 0.7, Math.max(1, scale), hh * 0.7);
    }
  }

  /* ======================================================================
     THE SHEEP
     ====================================================================== */

  // drawSheepSprite: cell-by-cell pixel art with the committed 1-cell
  // near-black outline and 3-tone wool ramp. (x, y) is the GROUND CONTACT
  // POINT. `phase` is 0..1 through the current hop; it drives the
  // squash-and-stretch on the body, the four bending legs (which tuck at the
  // apex and reach out for the landing) and the tail.
  function drawSheepSprite(ctx, x, y, dir, v, cell, phase, flash) {
    var w = SPRITE_W * cell, hh = SPRITE_H * cell;

    // squash & stretch: stretch tall off the ground, compress on impact
    var sx = 1, sy = 1;
    if (phase < 0.14) { var kk = 1 - phase / 0.14; sy = 1 + 0.24 * kk; sx = 1 - 0.17 * kk; }
    else if (phase > 0.86) { var k2 = (phase - 0.86) / 0.14; sy = 1 - 0.28 * k2; sx = 1 + 0.22 * k2; }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir < 0 ? -1 : 1, 1);
    ctx.scale(sx, sy);

    var ox = -w / 2;
    var oy = -hh - STAND_CELLS * cell;   // body bottom sits STAND_CELLS above the line

    var air = Math.sin(Math.PI * clampNum(phase, 0, 1));   // 0 grounded, 1 at apex
    var tuck = air * air;                                   // legs fold hard at the top
    var swing = Math.sin(Math.PI * 2 * phase);

    // ---- tail, behind everything, flicking with the gait
    var tailY = oy + cell * 7 + swing * cell * 0.8;
    ctx.fillStyle = K;
    ctx.fillRect(Math.round(ox - cell * 1.6), Math.round(tailY), Math.round(cell * 3), Math.round(cell * 4));
    ctx.fillStyle = flash ? '#ffffff' : v.M;
    ctx.fillRect(Math.round(ox - cell * 1.1), Math.round(tailY + cell * 0.6), Math.round(cell * 2), Math.round(cell * 2.8));

    // ---- legs, drawn before the body so the belly overlaps their tops.
    // Four stacked segments per leg give a real stepped bend at the knee
    // rather than a rigid stick with a displaced hoof.
    var legLen = cell * (LEG_FULL - (LEG_FULL - 1.4) * tuck);
    var legTop = oy + hh - LEG_TOP_CELLS * cell;   // == -(STAND_CELLS+LEG_TOP_CELLS)*cell
    var legW = Math.max(2, Math.round(cell * 2));
    var legs = [
      { bx: ox + cell * 3.0, fwd: -1 }, { bx: ox + cell * 5.4, fwd: -1 },
      { bx: ox + cell * 10.6, fwd: 1 }, { bx: ox + cell * 13.0, fwd: 1 }
    ];
    var SEG = 4;
    for (var li = 0; li < legs.length; li++) {
      var lg = legs[li];
      var reach = (1 - tuck) * (lg.fwd * cell * 1.9 + swing * cell * 1.3 * lg.fwd);
      for (var sg = 0; sg < SEG; sg++) {
        var tt = sg / (SEG - 1);
        var dx = reach * tt * tt;                       // the bend lives at the bottom
        var y0 = Math.round(legTop + (legLen / SEG) * sg);
        var y1 = Math.round(legTop + (legLen / SEG) * (sg + 1)) + 1;
        var lx = Math.round(lg.bx + dx);
        ctx.fillStyle = K;
        ctx.fillRect(lx, y0, legW, y1 - y0);
        ctx.fillStyle = flash ? '#ffe9a8' : v.leg;
        ctx.fillRect(lx + Math.max(1, Math.round(cell * 0.6)), y0, Math.max(1, legW - Math.round(cell * 0.6)), y1 - y0);
      }
      // hoof — a hard black block that finishes EXACTLY on the ground line
      ctx.fillStyle = K;
      ctx.fillRect(Math.round(lg.bx + reach - cell * 0.5), Math.round(legTop + legLen - cell),
                   Math.round(legW + cell), Math.max(1, Math.round(cell)));
    }

    // ---- body grid
    var cols = {
      K: K, L: v.L, M: v.M, D: v.D,
      F: v.face, H: v.faceD, N: v.muzzle,
      E: v.eye || '#ffffff', P: v.pupil || K
    };
    if (flash) {
      cols.L = '#ffffff'; cols.M = '#fff2c4'; cols.D = '#ffd54a';
      cols.F = '#ffffff'; cols.H = '#ffd54a'; cols.N = '#fff2c4';
    }
    for (var r = 0; r < SPRITE.length; r++) {
      var row = SPRITE[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[c];
        if (ch === '.') continue;
        var col = cols[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(ox + c * cell), Math.round(oy + r * cell), cell + 0.5, cell + 0.5);
      }
    }

    // high jumper wears a tall tuft so you can call it before it launches
    if (v.tuft) {
      ctx.fillStyle = K;
      ctx.fillRect(Math.round(ox + cell * 6), Math.round(oy - cell * 3), Math.max(1, cell), cell * 3);
      ctx.fillStyle = flash ? '#ffffff' : v.L;
      ctx.fillRect(Math.round(ox + cell * 5), Math.round(oy - cell * 4), cell * 3, cell * 2);
      ctx.fillStyle = K;
      ctx.fillRect(Math.round(ox + cell * 5), Math.round(oy - cell * 5), cell * 3, Math.max(1, cell));
    }
    ctx.restore();
  }

  // Hard, unblurred contact shadow that shrinks as the sheep climbs — the
  // single cheapest cue that tells the eye how high something is. It sits ON
  // the path, a hair below the ground line, so a grounded sheep visibly
  // stands in its own shadow rather than above it.
  function drawSheepShadow(ctx, x, groundY, air, cell) {
    var w = cell * (9 - 4.2 * air);
    ctx.globalAlpha = 0.36 * (1 - air * 0.55);
    ctx.fillStyle = '#231d10';
    ctx.beginPath();
    ctx.ellipse(x, groundY + cell * 0.9, Math.max(2, w), Math.max(1, cell * 0.9), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawSpeedLines(ctx, x, y, dir, cell) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffd98a';
    for (var i = 0; i < 3; i++) {
      var len = cell * (5 + i * 3);
      ctx.fillRect(x - dir * (cell * 13 + len), y - cell * (3 + i * 2.6), len, Math.max(1, cell));
    }
    ctx.globalAlpha = 1;
  }

  // The trick sheep's tell: a chunky outlined "!" bobbing above it while it
  // stalls, in the same amber the HUD uses for "pay attention".
  function drawAlert(ctx, x, y, cell, ts) {
    var bob = Math.sin(ts * 0.011) * cell * 0.6;
    var bx = Math.round(x - cell * 1.5), by = Math.round(y + bob);
    ctx.fillStyle = K;
    ctx.fillRect(bx - 1, by - 1, cell * 3 + 2, cell * 8 + 2);
    ctx.fillStyle = '#ffd54a';
    ctx.fillRect(bx, by, cell * 3, cell * 5);
    ctx.fillRect(bx, by + cell * 6, cell * 3, cell * 2);
  }

  /* ---- hit feedback --------------------------------------------------------
     Every tap that lands gets four simultaneous cues: a hard shockwave ring,
     a yellow starburst, a spray of wool motes in the sheep's own ramp
     colours, and — the one that was missing — THE SHEEP ITSELF REACTING:
     it flashes white, pops upward, spins off and fades out over HIT_ANIM_MS
     instead of blinking out of existence. */
  function burst(x, y, v, scale, big) {
    var i;
    rings.push({ x: x, y: y, life: 320, max: 320, r0: 4 * scale, r1: (big ? 30 : 22) * scale, col: '#ffd54a', w: Math.max(2, 2.4 * scale) });
    for (i = 0; i < (big ? 9 : 7); i++) {
      sparks.push({ x: x, y: y, a: (i / (big ? 9 : 7)) * Math.PI * 2 + rand(-0.2, 0.2), life: 260, max: 260, len: rand(8, 18) * scale, scale: scale });
    }
    var cols = [v.L, v.M, v.D, v.L];
    for (i = 0; i < (big ? 16 : 12); i++) {
      var a = rand(0, Math.PI * 2), sp = rand(0.02, 0.12) * scale;
      puffs.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.03 * scale,
        r: rand(1.2, 3.4) * scale, life: rand(420, 780), max: 780,
        col: cols[i % cols.length]
      });
    }
  }

  // Hoof dust: two or three motes kicked off the path each time a sheep
  // takes off. Costs nothing and is most of why the meadow feels physical.
  function kickDust(x, groundY, dir, scale) {
    for (var d = 0; d < 3; d++) {
      var a = rand(-2.5, -0.7);
      puffs.push({
        x: x + rand(-6, 6) * scale, y: groundY,
        vx: Math.cos(a) * rand(0.012, 0.045) * -dir, vy: Math.sin(a) * rand(0.012, 0.04),
        r: rand(0.9, 1.9) * scale, life: rand(180, 340), max: 340,
        col: '#8c8058', soft: true
      });
    }
  }

  function drawPuffs(ctx) {
    for (var i = 0; i < puffs.length; i++) {
      var p = puffs[i];
      ctx.globalAlpha = clampNum(p.life / Math.min(p.max, 420), 0, 1);
      if (!p.soft) {
        ctx.fillStyle = K;
        ctx.fillRect(Math.round(p.x - p.r - 1), Math.round(p.y - p.r - 1), Math.round(p.r * 2 + 2), Math.round(p.r * 2 + 2));
      }
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x - p.r), Math.round(p.y - p.r), Math.max(1, Math.round(p.r * 2)), Math.max(1, Math.round(p.r * 2)));
    }
    ctx.globalAlpha = 1;
  }

  function drawSparks(ctx) {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      var t = 1 - s.life / s.max;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#ffe37a';
      ctx.lineWidth = Math.max(1, 2 * s.scale);
      var r0 = s.len * 0.35 + t * s.len, r1 = r0 + s.len * 0.55 * (1 - t);
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(s.a) * r0, s.y + Math.sin(s.a) * r0);
      ctx.lineTo(s.x + Math.cos(s.a) * r1, s.y + Math.sin(s.a) * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawRings(ctx) {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      var t = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.col;
      ctx.lineWidth = r.w * (1 - t * 0.6);
      if (r.dash) ctx.setLineDash([3, 4]); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, t), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /* ======================================================================
     RENDER
     ====================================================================== */
  function render(ctx, w, h, ts, status) {
    if (!active) return;
    var g = computeGeom(w, h);
    geom = g;

    // ---- thought-bubble tail: 3 small circles trailing down to the bed
    ctx.save();
    for (var i = g.tails.length - 1; i >= 0; i--) {
      var tc = g.tails[i];
      ctx.beginPath();
      ctx.arc(tc.x, tc.y, tc.r, 0, Math.PI * 2);
      ctx.fillStyle = '#eef2ff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#141a34';
      ctx.stroke();
    }
    ctx.restore();

    // ---- main bubble shell: soft glow first (contrast against the night
    // room), then the rounded cartoon body with a thick dark outline so it
    // reads instantly over the darkest part of the backdrop.
    if (G.Iso && G.Iso.glow) {
      G.Iso.glow(ctx, g.bubble.x + g.bubble.w / 2, g.bubble.y + g.bubble.h / 2, g.bubble.w * 0.62, '#9fb6ff', 0.12);
    }
    ctx.save();
    roundRectPath(ctx, g.bubble.x, g.bubble.y, g.bubble.w, g.bubble.h, g.bubble.r);
    ctx.fillStyle = '#eef2ff';
    ctx.fill();
    ctx.restore();

    // ---- interior: the whole night meadow lives inside this clip
    ctx.save();
    roundRectPath(ctx, g.bubble.x + 4, g.bubble.y + 4, g.bubble.w - 8, g.bubble.h - 8, Math.max(4, g.bubble.r - 4));
    ctx.clip();

    var ix = g.interior.x, iy = g.interior.y, iw = g.interior.w, ih = g.interior.h;
    var bottom = iy + ih + 6;
    var scale = clampNum(g.scale, 0.6, 1.35);

    drawSky(ctx, ix, iy, iw, ih, g.horizonY, ts);
    drawMoon(ctx, ix, iy, iw, scale);
    drawHills(ctx, ix, iy, iw, g.horizonY, ts, scale);
    drawGround(ctx, ix, iw, g.horizonY, g.groundY, bottom, scale);
    drawMist(ctx, ix, iw, g.groundY, ts, scale, false);
    drawFence(ctx, ix, iw, g.fenceY, g.groundY, g.scale);

    // ---- the flock
    var hopH = ih * 0.34;
    var still = reduced();
    sheep.forEach(function (s) {
      var v = VARIANTS[s.variant] || VARIANTS.plain;
      var cell = g.cell;
      var padX = SPRITE_W * cell * 0.75;
      var x = s.dir > 0 ? lerp(ix - padX, ix + iw + padX, s.p) : lerp(ix + iw + padX, ix - padX, s.p);
      var phase = (s.hopT % s.hopMs) / s.hopMs;
      var air = Math.sin(Math.PI * phase);
      // Clamp the arc so even the high jumper stays inside the bubble rather
      // than being sliced off by the clip at the top of its hop.
      var headroom = Math.max(12, g.groundY - (iy + 4) - (SPRITE_H + STAND_CELLS + 5) * cell);
      var rise = Math.min(hopH * s.hopMul, headroom);
      var y = g.groundY - air * rise;

      // sx/sy/sr are what handleTap() hit-tests against, and they are written
      // from EXACTLY the coordinates this frame draws at — a tap can only ever
      // land on where the player actually saw the sheep. Radius covers the
      // whole 24x13-cell sprite: at the shipped cell size that is a 56px
      // target, comfortably past the 47px the stream chat had to settle on.
      s.sx = x;
      s.sy = y - cell * 10;
      s.sr = Math.max(26, cell * 14);

      if (s.hit) {
        // THE SHEEP REACTS: flash, pop, spin off, fade. It does not blink out.
        var ht = clampNum((ts - s.hitAt) / HIT_ANIM_MS, 0, 1);
        ctx.save();
        ctx.globalAlpha = 1 - ht * ht;
        ctx.translate(x, y - ht * 30 * scale);
        ctx.rotate(-s.dir * ht * 1.0);
        ctx.scale(1 + ht * 0.25, 1 - ht * 0.1);
        drawSheepSprite(ctx, 0, 0, s.dir, v, cell, 0.5, ht < 0.5);
        ctx.restore();
        return;
      }

      // hoof dust each time the hop wraps — i.e. every take-off
      if (!still && s.lastPhase !== null && phase < s.lastPhase) kickDust(x, g.groundY, s.dir, scale);
      s.lastPhase = phase;

      drawSheepShadow(ctx, x, g.groundY, air, cell);
      if (s.variant === 'swift') drawSpeedLines(ctx, x, y - cell * 10, s.dir, cell);
      drawSheepSprite(ctx, x, y, s.dir, v, cell, phase, false);
      if (s.variant === 'trick' && s.p > 0.28 && s.p < 0.52) {
        if (!s.stalled) { s.stalled = true; kickDust(x, g.groundY, s.dir, scale); }
        drawAlert(ctx, x, y - cell * (SPRITE_H + STAND_CELLS + 9), cell, ts);
      }
    });

    drawMist(ctx, ix, iw, g.groundY, ts, scale, true);
    drawTufts(ctx, ix, iw, g.groundY, bottom, scale);

    drawRings(ctx);
    drawSparks(ctx);
    drawPuffs(ctx);

    rewards.forEach(function (r) {
      var t = (ts - r.spawnTs) / 950;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.font = '700 ' + Math.max(9, Math.round(11 * scale)) + 'px monospace';
      ctx.textAlign = 'center';
      var yy = r.sy - 14 - Math.pow(t, 0.6) * 22;
      ctx.lineWidth = 3; ctx.strokeStyle = K; ctx.strokeText(r.text, r.sx, yy);
      ctx.fillStyle = r.color; ctx.fillText(r.text, r.sx, yy);
      ctx.restore();
    });

    // streak badge, inside the bubble, purely cosmetic (rewards are frozen)
    if (streak >= 3 && ts - lastHitTs < STREAK_WINDOW) {
      ctx.save();
      ctx.font = '700 ' + Math.max(10, Math.round(13 * scale)) + 'px monospace';
      ctx.textAlign = 'left';
      var sTxt = 'x' + streak;
      ctx.lineWidth = 3; ctx.strokeStyle = K; ctx.strokeText(sTxt, ix + 6, iy + 16 * scale);
      ctx.fillStyle = streak >= 8 ? '#ff7b4a' : '#ffd54a';
      ctx.fillText(sTxt, ix + 6, iy + 16 * scale);
      ctx.restore();
    }

    ctx.restore(); // end interior clip

    // Re-stroke the shell ON TOP of the clipped scene so the bubble keeps one
    // crisp unbroken edge instead of the meadow bleeding into the outline.
    ctx.save();
    roundRectPath(ctx, g.bubble.x, g.bubble.y, g.bubble.w, g.bubble.h, g.bubble.r);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#141a34';
    ctx.stroke();
    ctx.restore();

    // HUD — hits + both caps, so the player always knows when they've maxed
    // out and can stop paying attention to this entirely (§7: "show the caps
    // so the player knows when they have maxed out"). Deliberately OUTSIDE
    // the bubble (top-right of the whole canvas) — it's a status readout, not
    // part of "the sheep, the fence, the taps" the spec puts inside the
    // bubble, and anchoring it there means it never fights the bubble for
    // space regardless of where the bed puts the bubble this session.
    // formCap/energyPerHit are read straight from Package L's
    // Data.sheepReward table — the same source of truth state.js clamps
    // against — rather than hard-coded here.
    if (status) {
      var reward = (G.Data && G.Data.sheepReward) || { formCap: 0.10, energyPerHit: 0.03 };
      var cashMaxed = status.cashThisSleep >= status.cashCapPerSleep;
      var formMaxed = status.formBonusPreview >= reward.formCap;
      var energyPct = Math.min(Math.round(status.hits * (reward.energyPerHit || 0.03) * 100), 100);
      var boxW = 176, boxH = 66, boxX = w - boxW - 6;
      ctx.save();
      ctx.font = '700 9px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = K;
      ctx.fillRect(boxX - 1, 5, boxW + 2, boxH + 2);
      ctx.fillStyle = 'rgba(10,14,34,0.78)';
      ctx.fillRect(boxX, 6, boxW, boxH);
      ctx.fillStyle = 'rgba(255,213,74,0.55)';
      ctx.fillRect(boxX, 6, boxW, 1);
      ctx.fillStyle = '#ffd54a';
      ctx.fillText('COUNTING SHEEP — ' + status.hits + ' HIT', boxX + 6, 19);
      ctx.fillStyle = cashMaxed ? '#3ddc84' : '#eaf0ff';
      ctx.fillText('$' + status.cashThisSleep + '/' + status.cashCapPerSleep + (cashMaxed ? ' MAXED' : ''), boxX + 6, 31);
      ctx.fillStyle = formMaxed ? '#3ddc84' : '#eaf0ff';
      ctx.fillText('FORM +' + status.formBonusPreview.toFixed(2) + '/' + reward.formCap.toFixed(2) + (formMaxed ? ' MAXED' : ''), boxX + 6, 43);
      ctx.fillStyle = '#34d3ff';
      ctx.fillText('ENERGY +' + energyPct + '% — WAKES YOU SOONER', boxX + 6, 55);
      // difficulty ramp readout — the flock genuinely gets busier over a sleep
      var barW = boxW - 12, fill = Math.round(barW * ramp);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(boxX + 6, 60, barW, 3);
      ctx.fillStyle = ramp > 0.66 ? '#ff7b4a' : (ramp > 0.33 ? '#ffd54a' : '#3ddc84');
      ctx.fillRect(boxX + 6, 60, fill, 3);
      ctx.restore();
    }
  }

  /* ======================================================================
     INPUT
     ====================================================================== */
  // handleTap: cx/cy already in canvas pixel space (same space hub.js's
  // onCanvasTap converts pointer events into for every other hit-test on
  // this screen). Sheep sx/sy/sr are recorded by render() every frame from
  // the exact coordinates that frame drew, so comparing directly against them
  // is what guarantees a hit registers against WHERE THE PLAYER SAW THE SHEEP
  // at press time, not where it has since moved to. Radius floor is 26px
  // (a 52px target) — the stream chat's shipped 47px lesson applies double to
  // a moving target.
  // Returns the hit sheep's last-drawn {sx, sy} so the caller can anchor a
  // reward pop-up, or null on a miss — the caller decides what a miss pays
  // (nothing), this file only owns whether the tap geometrically landed.
  function handleTap(cx, cy, w, h) {
    if (!active) return null;
    var g = geom || computeGeom(w, h);
    var best = null, bestDist = Infinity;
    sheep.forEach(function (s) {
      if (s.hit) return;
      var radius = Math.max(26, s.sr || 26);
      var dist = Math.hypot(s.sx - cx, s.sy - cy);
      if (dist < radius && dist < bestDist) { bestDist = dist; best = s; }
    });

    var ts = now();
    if (!best) {
      // A miss must FEEL like a miss without punishing anyone: a small grey
      // dust ring where the finger landed, and the streak lapses. No cash,
      // form, energy or time is ever taken away.
      var inBubble = cx > g.interior.x - 8 && cx < g.interior.x + g.interior.w + 8 &&
                     cy > g.interior.y - 8 && cy < g.interior.y + g.interior.h + 8;
      if (inBubble) {
        rings.push({ x: cx, y: cy, life: 260, max: 260, r0: 3, r1: 18 * g.scale, col: 'rgba(190,200,230,0.9)', w: 2, dash: true });
        for (var d = 0; d < 4; d++) {
          var a = rand(0, Math.PI * 2);
          puffs.push({ x: cx, y: cy, vx: Math.cos(a) * 0.03, vy: Math.sin(a) * 0.03, r: 1.4 * g.scale, life: 280, max: 280, col: '#b9c2e0' });
        }
        streak = 0;
      }
      return null;
    }

    best.hit = true;
    best.hitAt = ts;
    // hitAt lines up with the `ts` space render()/update() use (rAF
    // timestamps); performance.now() is the same clock rAF timestamps are
    // drawn from in every browser this game targets.
    streak = (ts - lastHitTs < STREAK_WINDOW) ? streak + 1 : 1;
    lastHitTs = ts;
    burst(best.sx, best.sy, VARIANTS[best.variant] || VARIANTS.plain, geom ? geom.scale : 1, streak >= 3);
    return { sx: best.sx, sy: best.sy };
  }

  // popReward: purely cosmetic — hub.js calls this right after a successful
  // State.sheepHit(), passing back exactly what that call paid out, so nothing
  // about the reward AMOUNT is ever decided in this file. The one thing we do
  // touch is the energy PERCENTAGE inside that string: hub.js still writes a
  // literal "+1% ENERGY" while Data.sheepReward.energyPerHit moved to 0.03
  // (SPEC-V15 §6), so the label is re-derived from the data table here rather
  // than shipping a number the game no longer pays.
  function popReward(sx, sy, text, color) {
    var reward = (G.Data && G.Data.sheepReward) || { energyPerHit: 0.03 };
    var pct = Math.round((reward.energyPerHit || 0.03) * 100);
    var t = String(text == null ? '' : text).replace(/\+\d+(\.\d+)?%\s*ENERGY/i, '+' + pct + '% ENERGY');
    rewards.push({ sx: sx, sy: sy, text: t, color: color || '#3ddc84', spawnTs: now() });
  }

  G.Sheep = {
    ready: true,
    start: start,
    stop: stop,
    isActive: isActive,
    update: update,
    render: render,
    handleTap: handleTap,
    popReward: popReward,
    // test seam only — lets a harness inspect the difficulty dial without
    // reaching into the closure. Nothing in the game reads it.
    _debug: function () { return { ramp: ramp, live: sheep.length, streak: streak }; }
  };
})(window.Game = window.Game || {});
