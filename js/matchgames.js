/* ==========================================================================
   CS2 PRO SIMULATOR — js/matchgames.js
   Game.MatchGames — the 15-second ACTIVE MATCH that PLAY now runs.

   THE FLOW (V22d, owner spec):
     PLAY  -> a 15s master timer starts and one of three CS-themed minigames
              opens over the room.
     WIN   -> the match bar snaps to 100%, holds 1.5s so the player sees it,
              the overlay closes and the ELO win/loss card appears.
     FAIL  -> TRY AGAIN (only while time remains) / QUIT.
     TIME  -> if the master timer hits zero at any point, the overlay
              force-closes and the ELO card appears anyway.

   The minigame decides HOW FAST the match resolves, never WHETHER it is won.
   State.playMatch() has already rolled the ELO result before the overlay
   opens (see js/main.js) — this module is pacing and theatre, and must never
   be able to change a result the player has effectively already earned.
   Keeping it that way is also what stops it becoming a difficulty gate on a
   core progression loop.

   THREE GAMES, THREE INPUT VERBS, on purpose. A rotation of three things that
   all wanted the same gesture would read as one game with reskins:
     awp   — a single reaction TAP
     spray — one continuous DRAG
     bhop  — alternating rhythmic TAPS
   pickGame() also refuses to repeat the last one; with three games a naive
   random pick self-repeats about a third of the time, which reads as broken
   (the same rule js/audio.js's shuffle needs, for the same reason).

   All art is drawn here on canvas in flat rectangles — no image assets
   (HANDOFF-V2 §2), and no emoji or glyph icons (ART-DIRECTION §2.5).
   Colour literals are correct in this file for the same reason they are in
   js/iso.js: canvas cannot read CSS variables.
   ========================================================================== */
(function (G) {
  'use strict';

  var MATCH_MS = 15000;      // the master timer, owner-specified
  var WIN_HOLD_MS = 1500;    // satisfaction beat after a win, before the card

  var root = null, canvas = null, ctx = null, barFill = null, barLabel = null;
  var buttonRow = null, bannerEl = null;
  var rafId = null, lastTs = 0;
  var startedAt = 0, frozenElapsed = null;
  var active = false, resolved = false;
  var game = null, lastGameId = null;
  var onDone = null;
  var W = 0, H = 0;

  function now() { return Date.now(); }
  function beep(k) { if (G.UI && G.UI.beep) G.UI.beep(k); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function elapsed() {
    if (frozenElapsed !== null) return frozenElapsed;
    return now() - startedAt;
  }
  function remaining() { return Math.max(0, MATCH_MS - elapsed()); }

  /* ---------------------------------------------------------------- shell */
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'mg-match';
    root.id = 'match-overlay';
    root.innerHTML =
      '<div class="mg-match__bar"><div class="mg-match__bar-fill" id="mg-match-fill"></div></div>' +
      '<div class="mg-match__label" id="mg-match-label">MATCH IN PROGRESS</div>' +
      '<canvas class="mg-match__canvas" id="mg-match-canvas"></canvas>' +
      '<div class="mg-match__banner" id="mg-match-banner"></div>' +
      '<div class="mg-match__buttons" id="mg-match-buttons"></div>';
    var host = document.getElementById('app') || document.body;
    host.appendChild(root);

    canvas = document.getElementById('mg-match-canvas');
    ctx = canvas.getContext('2d');
    barFill = document.getElementById('mg-match-fill');
    barLabel = document.getElementById('mg-match-label');
    buttonRow = document.getElementById('mg-match-buttons');
    bannerEl = document.getElementById('mg-match-banner');

    // Pointer events go to the canvas only; the buttons sit above it.
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (game && game.down) game.down(pt(e));
    });
    canvas.addEventListener('pointermove', function (e) {
      e.preventDefault();
      if (game && game.move) game.move(pt(e));
    });
    canvas.addEventListener('pointerup', function (e) {
      e.preventDefault();
      if (game && game.up) game.up(pt(e));
    });
    canvas.addEventListener('pointercancel', function () { if (game && game.up) game.up(null); });
  }

  function pt(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  function sizeCanvas() {
    // The CANVAS's own box, not the overlay's: the canvas sits under the timer
    // bar and the label, so it is ~30px shorter than the overlay. Measuring
    // the overlay gave the backing store more rows than the element displays,
    // and the browser then squashed every frame vertically to fit.
    var r = canvas.getBoundingClientRect();
    // Backing store at CSS size: this art is chunky flat rectangles, so a
    // DPR-scaled buffer buys nothing but fill cost on a phone.
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

  function clearButtons() { buttonRow.innerHTML = ''; buttonRow.classList.remove('mg-match__buttons--show'); }

  function showFailButtons() {
    clearButtons();
    buttonRow.classList.add('mg-match__buttons--show');
    // TRY AGAIN only exists while there is still time to try in — offering a
    // button that would immediately time out is worse than not offering it.
    if (remaining() > 900) {
      var again = document.createElement('button');
      again.className = 'btn btn--primary mg-match__btn';
      again.textContent = 'TRY AGAIN';
      again.addEventListener('click', function () {
        beep('click');
        clearButtons(); setBanner('');
        startGame(lastGameId);      // same game, fresh attempt
      });
      buttonRow.appendChild(again);
    }
    var quit = document.createElement('button');
    quit.className = 'btn mg-match__btn';
    quit.textContent = 'QUIT';
    quit.addEventListener('click', function () { beep('click'); finish(false); });
    buttonRow.appendChild(quit);
  }

  /* ---- outcome ---------------------------------------------------------
     win(): freeze the bar full, hold, then hand back. The freeze matters —
     without it the bar keeps draining behind the 1.5s hold and the player
     watches their "100%" tick away while they wait. */
  function win() {
    if (resolved) return;
    resolved = true;
    frozenElapsed = MATCH_MS;
    renderBar();
    barLabel.textContent = 'MATCH WON';
    if (game && game.destroy) game.destroy();
    game = null;
    setTimeout(function () { finish(true); }, WIN_HOLD_MS);
  }

  function fail() {
    if (resolved) return;
    if (game && game.destroy) game.destroy();
    game = null;
    showFailButtons();
  }

  function timeUp() {
    if (resolved) return;
    resolved = true;
    if (game && game.destroy) game.destroy();
    game = null;
    finish(false);
  }

  function finish(wonMinigame) {
    active = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (root) root.classList.remove('mg-match--open');
    clearButtons(); setBanner('');
    var cb = onDone; onDone = null;
    // Let the close transition start before the reward card lands on top.
    setTimeout(function () { if (cb) cb({ won: !!wonMinigame }); }, 160);
  }

  function renderBar() {
    var pct = clamp(elapsed() / MATCH_MS, 0, 1) * 100;
    barFill.style.width = pct.toFixed(1) + '%';
  }

  function loop(ts) {
    if (!active) return;
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    renderBar();
    if (!resolved && remaining() <= 0) { timeUp(); return; }
    if (game) {
      if (game.update) game.update(dt);
      if (game.draw) game.draw(ctx, W, H);
    }
    rafId = requestAnimationFrame(loop);
  }

  /* -------------------------------------------------------------- helpers */
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
     MINIGAME 1 — AWP REACTION TEST
     Holding an angle on Dust 2. An enemy crosses the gap after a random
     delay; you have 300ms. Tapping before the peek is an early-shot loss,
     which is what stops "hold the finger down and win" — the whole game is
     the wait.

     TWO ANGLES, picked per run out of AWP_ANGLES. The peek window, the 300ms
     reaction window, the scoring and the master timer are IDENTICAL on both —
     the only things that differ are the picture and WHICH WAY HE CROSSES.
     Mid doors peeks left-to-right; A site seen from window peeks
     right-to-left. That mirror is the whole point of the variation: a player
     who has learned to flick one way earns nothing for it, because the next
     run is as likely to be the other. Anything that changed the timings
     instead would turn a variation into a second, differently-tuned game.

     Everything angle-specific is DATA in that array — the way BH_MAPS holds
     the bhop maps — so a third angle is one more entry, never another branch.
     ====================================================================== */

  /* Scope geometry, derived ONCE from the centre of the lens and handed to
     whichever angle was drawn. The gap the enemy crosses, the vignette and
     the reticle all fall out of the same two numbers, so a new angle
     physically cannot put the crosshair anywhere but on the slice of world
     the player is holding. Hard-coding a second set of offsets per angle is
     exactly how those two drift apart. */
  function awpScene(w, h) {
    var gapW = Math.round(w * 0.12);
    var gapX = Math.round(w / 2 - gapW / 2);
    var cxs = w / 2, cys = h * 0.46, R = w * 0.495;
    return { gapW: gapW, gapX: gapX, cxs: cxs, cys: cys, R: R };
  }

  /* The enemy silhouette, shared by every angle. `dir` is his direction of
     travel; the trailing arm and the rifle mirror with it, so he is never
     walking backwards holding the gun behind him. The BODY IS THE SAME SIZE
     on both angles on purpose — a smaller target on one of them would make
     the two angles different tests, and the reaction window is meant to be
     the only difficulty in this game. Only the palette changes. */
  var AWP_CT_BODY = ['#3D4038', '#2B2E28', '#4B4D43', '#33352E',
                     '#35382F', '#1D1E1B', '#2A2C25', '#191A17'];
  // Backlit against a bright site, he reads almost as a cut-out — which is
  // what the owner's window reference actually shows.
  var AWP_T_BODY = ['#2A2621', '#1A1815', '#372F26', '#201C17',
                    '#252119', '#131211', '#1E1B17', '#100F0E'];

  function awpEnemy(c, x, y, dir, pal) {
    var ax = dir > 0 ? x - 7 : x + 24;      // near arm, mirrored about the torso
    var gx = dir > 0 ? x - 14 : x + 20;     // ...and the rifle with it
    px(c, x, y + 16, 26, 46, pal[0]);       // torso / vest
    px(c, x + 2, y + 22, 22, 12, pal[1]);   // chest rig
    px(c, x + 6, y, 15, 17, pal[2]);        // head
    px(c, x + 4, y - 4, 19, 7, pal[3]);     // helmet
    px(c, ax, y + 24, 9, 22, pal[4]);       // near arm
    px(c, gx, y + 30, 20, 5, pal[5]);       // rifle
    px(c, x + 3, y + 62, 10, 24, pal[6]);   // legs
    px(c, x + 15, y + 62, 10, 24, pal[6]);
    px(c, x + 1, y + 86, 26, 5, pal[7]);    // contact shadow
  }

  /* The scope itself: the black vignette with its circular cut, the lens
     shading, and the reticle. Drawn over whatever world the angle painted,
     from S alone — so both angles get the identical optic and the crosshair
     lands on the gap on both. */
  function awpDrawScope(c, w, h, S) {
    var i, cxs = S.cxs, cys = S.cys, R = S.R;
    c.save();
    c.beginPath();
    c.rect(0, 0, w, h);
    c.arc(cxs, cys, R, 0, Math.PI * 2, true);
    c.fillStyle = '#000000';
    c.fill('evenodd');
    c.restore();
    // lens shading just inside the rim, so the glass has depth
    c.save();
    c.globalAlpha = 0.22;
    for (i = 0; i < 5; i++) {
      c.strokeStyle = '#000000'; c.lineWidth = 4;
      c.beginPath(); c.arc(cxs, cys, R - 2 - i * 4, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    px(c, 0, cys - 1, w, 2, '#000000');                 // scope crosshair
    px(c, cxs - 1, 0, 2, h, '#000000');
    for (i = 1; i <= 3; i++) {                          // mil-dots
      px(c, cxs - 2, cys + i * 18, 4, 2, '#000000');
      px(c, cxs + i * 18, cys - 1, 2, 4, '#000000');
    }
  }

  var AWP_ANGLES = [

    /* ------------------------------------------------------- MID DOORS */
    {
      id: 'middoors',
      name: 'MID DOORS',
      hint: 'HOLD MID DOORS',
      peekDir: 1,                    // he crosses LEFT to RIGHT
      /* The composition is the owner's first reference shot: mid doors on
         Dust 2 down an AWP scope. Arched double doors filling the top, a
         narrow bright gap between them, sunlit stone slabs in the bottom
         third. Everything is flat rects on a 6-12px grid so it stays pixel
         art. `t` is his crossing, 0..1, or -1 when he is not on screen. */
      drawWorld: function (c, w, h, S, t) {
        var gapW = S.gapW, gapX = S.gapX;
        var doorBottom = h * 0.52;                          // doors meet floor
        var i, x;

        /* ---- the doors, drawn SOLID across the whole frame ----
           An earlier pass punched the gap by skipping plank columns, but
           planks are 12px and the gap is 50, so the opening snapped out to
           whatever the column grid allowed — 72px, half again too wide. The
           doors are now continuous and the view through them is clipped to an
           exact rect below, which also means the gap width is a real number
           rather than a consequence of the plank pitch. */
        for (x = 0; x < w; x += 12) {
          var lit = ((x / 12) | 0) % 3 === 0;
          px(c, x, 0, 12, doorBottom, lit ? '#8B7150' : '#7A6244');
          px(c, x + 10, 0, 2, doorBottom, '#584630');       // plank seam
        }
        // Iron bands, placed inside the scope's window rather than spread over
        // the whole door — anything above ~0.55 of the door is outside the
        // circle on a portrait screen and would simply never be seen.
        var bandYs = [doorBottom * 0.62, doorBottom * 0.80, doorBottom * 0.96];
        for (i = 0; i < bandYs.length; i++) {
          var by = bandYs[i] | 0;
          for (x = 0; x < w; x += 12) {
            px(c, x, by, 12, 12, '#463A2A');
            px(c, x + 4, by + 4, 4, 4, '#2B2319');         // bolt
          }
        }

        // ---- what is BEYOND the doors, seen only through the gap ----
        c.save();
        c.beginPath();
        c.rect(gapX, 0, gapW, doorBottom);
        c.clip();
        px(c, gapX, 0, gapW, doorBottom, '#B9A27B');        // far sandstone wall
        px(c, gapX, doorBottom * 0.30, gapW, 5, '#93805E'); // block courses
        px(c, gapX, doorBottom * 0.55, gapW, 5, '#93805E');
        px(c, gapX, doorBottom * 0.74, gapW, doorBottom * 0.26, '#7E6F52');  // ground
        px(c, gapX, doorBottom * 0.74, gapW, 4, '#5F5440');
        // The CT, stepping out across the gap. Inside the clip, so the door
        // edges cut him off — he emerges from behind timber rather than
        // appearing on top of it.
        if (t >= 0) awpEnemy(c, gapX - 14 + t * gapW, doorBottom - 108, 1, AWP_CT_BODY);
        c.restore();

        // the two door edges facing the gap: bright rim, then shadow
        px(c, gapX - 6, 0, 6, doorBottom, '#A88B5C');
        px(c, gapX - 10, 0, 4, doorBottom, '#4E4030');
        px(c, gapX + gapW, 0, 6, doorBottom, '#3E3323');
        px(c, gapX + gapW + 6, 0, 4, doorBottom, '#9C8154');

        /* ---- the arch above the doors, stepped 6px so it reads as pixels ----
           Tuned so the crown lands just inside the TOP of the scope circle.
           Geometry that peaks above the circle is invisible: everything
           outside the lens is painted flat black by awpDrawScope(). */
        var archCx = w / 2, archCy = h * 0.62, archR = w * 0.75;
        for (x = 0; x < w; x += 6) {
          var ax = x + 3 - archCx;
          var inner = archR * archR - ax * ax;
          var top = inner > 0 ? archCy - Math.sqrt(inner) : doorBottom;
          if (top > 0) px(c, x, 0, 6, top, '#221E19');      // stone above the arch
        }

        // ---- the near floor: sunlit stone slabs, in front of the doors ----
        px(c, 0, doorBottom, w, h - doorBottom, '#9E998C');  // slabs in shadow
        // The lit patch starts high: the scope only shows down to ~0.71h, so a
        // light line set at 30% of the floor left barely a sliver of sun in it.
        var lightY = doorBottom + (h - doorBottom) * 0.10;
        px(c, 0, lightY, w, h - lightY, '#C7C0AD');          // the sunlit patch
        px(c, 0, lightY - 4, w, 4, '#8A8578');               // shadow edge
        for (var sy = doorBottom + 14; sy < h; sy += 34) {   // slab seams
          px(c, 0, sy, w, 3, sy < lightY ? '#8A8578' : '#ADA694');
          var stagger = ((sy / 34) | 0) % 2 ? 40 : 0;
          for (x = stagger; x < w; x += 84) px(c, x, sy, 3, 34, sy < lightY ? '#8A8578' : '#ADA694');
        }
      }
    },

    /* --------------------------------------------- A SITE, FROM WINDOW */
    {
      id: 'awindow',
      name: 'A SITE — WINDOW',
      hint: 'HOLD A FROM WINDOW',
      /* THE OTHER DIRECTION, deliberately: he comes out of the doorway on the
         right and walks LEFT across the reticle. See the block comment on
         AWP_ANGLES — this mirror is the reason the second angle exists. */
      peekDir: -1,
      /* The owner's second reference shot: Dust 2 seen from A-site window.
         Bright sky over a stepped cream skyline, a coursed stone wall down the
         left with crates and a barrel against it, wide shallow steps falling
         away across the lower left, pale flagstone paving, and the dark
         arched doorway just right of centre that he steps out of. */
      drawWorld: function (c, w, h, S, t) {
        var gapW = S.gapW, gapX = S.gapX, cys = S.cys, R = S.R;
        /* Every anchor comes off the LENS, not off the frame. Outside the
           circle awpDrawScope() paints flat black, so art composed against the
           canvas edge is art nobody ever sees — the same lesson the mid-doors
           iron bands and arch crown both had to learn. */
        var skyB = Math.round(cys - R * 0.46);    // roofline, and the sky's base
        var farB = Math.round(cys - R * 0.05);    // far wall meets the paving
        var wallT = Math.round(cys - R * 0.36);   // top of the near stone wall
        var wallB = farB + Math.round(R * 0.26);  // ...and where it meets ground
        /* The near stone corner he peeks from — declared up here because the
           doorway below is sited off it too, and one number placed twice is
           how the two would drift apart. Its INNER FACE is exactly the gap's
           right edge; it never reaches into the gap. See the block that draws
           it, further down, for why it exists at all. */
        var pierW = Math.round(gapW * 0.92);
        var pierX = gapX + gapW;
        var i, x, y, bl;

        // ---- sky, banded rather than graded so it stays flat pixel art ----
        px(c, 0, 0, w, skyB, '#4E9BD6');
        px(c, 0, skyB - 74, w, 74, '#6FB4E4');
        px(c, 0, skyB - 32, w, 32, '#9CCFEE');
        px(c, 0, skyB - 11, w, 11, '#C6E4F5');                // haze on the horizon

        /* ---- the far side of the site. Pale cream and sandstone blocks with
           a STEPPED skyline, so the roofline bites into the sky instead of
           ruling one flat line across it. Fractions of w and R, so the
           composition holds at any canvas size.
           [x, width, rise above the roofline, face, sunlit cap] */
        var BLOCKS = [
          [-0.06, 0.31, 0.30, '#D9C8A2', '#EFE0BC'],
          [0.20, 0.19, 0.13, '#C6B58D', '#E2D2AC'],
          [0.35, 0.31, 0.42, '#E0D0AB', '#F2E6C6'],
          [0.62, 0.21, 0.19, '#CBB994', '#E6D6B0'],
          [0.79, 0.29, 0.34, '#D2C199', '#ECDCB6']
        ];
        for (i = 0; i < BLOCKS.length; i++) {
          bl = BLOCKS[i];
          var fx = Math.round(bl[0] * w), fw = Math.round(bl[1] * w);
          var ft = Math.round(skyB - bl[2] * R);
          px(c, fx, ft, fw, farB - ft, bl[3]);
          px(c, fx, ft, fw, 7, bl[4]);                        // sunlit parapet cap
          px(c, fx, ft + 7, fw, 3, '#A08C68');                // and its shadow
          px(c, fx + fw - 6, ft, 6, farB - ft, '#A8926B');    // shaded right return
          // small dark shuttered windows, on a grid inside the block face
          for (x = fx + 16; x < fx + fw - 24; x += 40) {
            for (y = ft + 28; y < farB - 34; y += 56) {
              px(c, x - 3, y - 3, 24, 32, '#9A8560');         // reveal
              px(c, x, y, 18, 26, '#2E2519');                 // the opening
              px(c, x, y, 18, 5, '#221B12');                  // lintel shadow
              px(c, x + 8, y, 2, 26, '#4A3D28');              // the shutter split
            }
          }
        }
        // one balcony, on the tall centre block — the detail the reference
        // shot leads with, and the only thing on that wall with depth
        var balX = Math.round(0.37 * w), balW = Math.round(0.17 * w);
        var balY = Math.round(farB - R * 0.26);
        px(c, balX, balY - 17, balW, 3, '#A38E64');           // rail
        for (x = balX + 3; x < balX + balW - 3; x += 9)
          px(c, x, balY - 14, 3, 14, '#8E7A54');              // balusters
        px(c, balX, balY, balW, 9, '#B8A176');                // slab
        px(c, balX, balY, balW, 3, '#DCC79A');

        /* ---- the doorway he came through, and the corner of shade beside it.
           Sited entirely BEYOND the near corner (pierX + pierW), so no dark
           opening ever crosses the slice the scope holds. An earlier pass put
           it half on the gap, which was worse than useless here: he is an
           almost-black backlit cut-out (AWP_T_BODY, #2A2621 at its lightest)
           and this interior is #241D14, so any frame that walked him across it
           would have hidden him in shade instead of merely popping him into
           existence. Cover for this angle has to be SUNLIT — see the near
           corner below. Still derived from gapX/gapW like everything else. */
        var dwX = pierX + pierW + 4, dwW = gapW + 30;
        var dwT = Math.round(farB - R * 0.40);
        px(c, dwX - 7, dwT - 27, dwW + 14, farB - dwT + 27, '#A08A62');  // surround
        px(c, dwX - 7, dwT - 27, dwW + 14, 5, '#D6C094');                // lintel course
        for (x = 0; x < dwW; x += 4) {                        // the arched opening
          var av = (x + 2 - dwW / 2) / (dwW / 2);
          var arcT = dwT - Math.round(Math.sqrt(Math.max(0, 1 - av * av)) * 19);
          px(c, dwX + x, arcT, 4, farB - arcT, '#241D14');
        }
        px(c, dwX + dwW + 7, dwT - 12, 13, farB - dwT + 12, '#6E5C41');  // the corner beside it

        /* ---- the paving. Pale flagstone, warmer where the sun lands. Drawn
           before the near wall so the wall sits on top of it, which is the
           only order that gets the wall's own shadow to fall the right way. */
        px(c, 0, farB, w, h - farB, '#C7BB9A');
        px(c, 0, farB, w, 5, '#9E9070');                      // far wall's shadow
        var sunY = farB + Math.round(R * 0.13);
        px(c, 0, sunY, w, h - sunY, '#DCD1AF');               // the sunlit half
        px(c, 0, sunY - 4, w, 4, '#A89A79');
        for (y = farB + 24; y < h; y += 30) {                 // flagstone courses
          px(c, 0, y, w, 3, y < sunY ? '#A89A79' : '#C4B896');
          var st = (((y - farB) / 30) | 0) % 2 ? 44 : 0;
          for (x = st; x < w; x += 88) px(c, x, y, 3, 30, y < sunY ? '#A89A79' : '#C4B896');
        }
        // Loose grit, from bhHash rather than Math.random: a scatter re-rolled
        // every frame boils, and this function runs at 60fps.
        for (i = 0; i < 30; i++) {
          var g1 = bhHash(i * 13 + 1, 7), g2 = bhHash(i * 5 + 3, 29);
          px(c, g1 * w, farB + 10 + g2 * R * 0.95, 3 + (g1 > 0.72 ? 2 : 0), 3,
             g2 > 0.5 ? '#B0A281' : '#9C8F70');
        }

        /* ---- the wide shallow steps falling away across the LOWER LEFT.
           Each tread is a little shorter than the one above it, which is what
           makes them descend toward the camera instead of stacking. */
        for (i = 0; i < 4; i++) {
          var ty = wallB - 6 + i * 22, tw = Math.round(w * (0.66 - i * 0.055));
          px(c, 0, ty, tw, 22, '#D2C6A4');                    // tread
          px(c, 0, ty, tw, 5, '#EFE6C6');                     // lit nosing
          px(c, 0, ty + 17, tw, 5, '#A59774');                // riser, in shade
          px(c, tw - 5, ty, 5, 22, '#A59774');                // the open end
        }

        /* ---- the coursed stone wall down the LEFT, with real thickness ---- */
        var wR = Math.round(w * 0.27);
        px(c, 0, wallT, wR, wallB - wallT, '#B39C71');        // the face
        for (y = wallT + 12; y < wallB; y += 20) {            // block courses
          px(c, 0, y, wR, 3, '#96805A');
          var cst = (((y - wallT) / 20) | 0) % 2 ? 34 : 0;
          for (x = cst; x < wR; x += 68) px(c, x, y, 3, 20, '#96805A');
        }
        px(c, 0, wallT, wR, 9, '#DCC79A');                    // sunlit cap
        px(c, 0, wallT + 9, wR, 4, '#8A7550');                // and its shade
        px(c, wR - 8, wallT, 8, wallB - wallT, '#8E7853');    // the shaded return
        px(c, 0, wallB - 4, wR + 22, 4, '#8A7C5E');           // where it meets ground

        /* Stacked wooden crates and a barrel against the wall — the map's own
           furniture, not invented set dressing. Both are held clear of gapX:
           a first pass put the barrel at x 185, dead on the gap, where it
           stood in the middle of the slice the player is holding and he
           walked out from behind it. Anything in this scene that reaches
           gapX is in the way of the game. */
        var kx = wR - 26;                                     // crates: 87..157 at 420 wide
        px(c, kx, wallB - 76, 70, 76, '#6B4E2B');
        px(c, kx + 3, wallB - 73, 64, 70, '#B08551');
        px(c, kx + 3, wallB - 73, 64, 6, '#C89C63');
        for (i = 1; i < 4; i++) px(c, kx + 3, wallB - 73 + i * 17, 64, 3, '#8E6C40');
        px(c, kx + 8, wallB - 120, 54, 46, '#6B4E2B');        // the smaller one on top
        px(c, kx + 11, wallB - 117, 48, 40, '#BC9159');
        px(c, kx + 11, wallB - 117, 48, 5, '#D2A66C');
        var brx = Math.round(w * 0.10);                       // barrel, further left again
        px(c, brx, wallB - 54, 34, 54, '#5E3A22');            // the barrel
        px(c, brx + 3, wallB - 54, 28, 54, '#A6612F');
        px(c, brx + 3, wallB - 54, 28, 5, '#C67C42');
        px(c, brx + 3, wallB - 38, 28, 4, '#7E4722');
        px(c, brx + 3, wallB - 20, 28, 4, '#7E4722');

        /* ---- THE NEAR CORNER — the cover, and the whole point of this block.

           THE BUG IT KILLS: this angle used to draw its enemy with no clip and
           nothing standing beside him, on open paving. A whole body switched on
           mid-frame — the owner's "the enemy appears out of thin air". Mid doors
           never had it, because its CT is drawn inside a clip and the door
           reveal eats him; this is the mirror of that, and nothing else.

           IT FRAMES THE GAP, IT DOES NOT SIT IN IT. Its inner face is exactly
           gapX + gapW — the same convention mid doors uses for its right door
           edge — so not one pixel of masonry lands on the slice the player is
           holding, and the older lesson on this angle (anything that reaches
           gapX is in the way of the game) still stands. What occludes him is
           the STRUCTURE beside the gap; the OPENING is the gap itself.

           RIGHT of the gap, because he travels right-to-left (peekDir -1). He
           starts behind stone and walks out of it, so occlusion only ever
           decreases: he is roughly a third visible at t=0 and completely in the
           open well before the end of his travel.

           SUNLIT, not a dark archway — see the doorway comment above. Drawn
           here, after the paving and the steps, because it is nearer than both
           and every one of them paints full width. */
        var pierT = Math.round(farB - R * 0.52);
        var pierB = wallB - 6;                                // stands on the top tread
        px(c, pierX, pierT, pierW, pierB - pierT, '#C6B58D'); // the face
        px(c, pierX, pierT, 3, pierB - pierT, '#F4E9CC');     // the lit arris he emerges past
        px(c, pierX + 3, pierT, 3, pierB - pierT, '#DCC79A');
        for (y = pierT + 14; y < pierB; y += 20)              // block courses
          px(c, pierX, y, pierW, 3, '#A8926B');
        px(c, pierX + pierW - 8, pierT, 8, pierB - pierT, '#8E7853');  // the shaded return
        px(c, pierX, pierT - 9, pierW + 8, 9, '#E6D6B0');     // coping
        px(c, pierX, pierT - 9, pierW + 8, 3, '#F4E9CC');
        px(c, pierX, pierT, pierW + 8, 3, '#A08C68');         // and its shadow
        // Sun comes from the left everywhere in this scene (lit caps up top,
        // shaded right returns), so the corner throws its shadow to the RIGHT.
        px(c, pierX + pierW, farB, 15, pierB - farB, '#A89A79');
        px(c, pierX, pierB - 4, pierW + 15, 4, '#8A7C5E');    // where it meets the ground

        /* ---- him, walking RIGHT to LEFT out from behind that corner. His path
           and his timings are untouched: still the exact mirror of mid doors'
           about the gap centre, still on the scope's own centre line so his
           chest sits under the reticle on both angles. The ONLY change is the
           clip, whose right edge is the corner's inner face — the direct
           counterpart of mid doors' `c.rect(gapX, 0, gapW, doorBottom)`. Left
           of it is deliberately open to the frame: clipping him on BOTH sides
           would cut him again at the end of his travel, and he has to finish
           completely clear for the peek to read as emerging from cover. */
        if (t >= 0) {
          c.save();
          c.beginPath();
          c.rect(0, 0, pierX, h);
          c.clip();
          awpEnemy(c, gapX + gapW - 26 - (-14 + t * gapW), cys - 58, -1, AWP_T_BODY);
          c.restore();
        }
      }
    }
  ];

  function makeAwp() {
    var STATE_WAIT = 0, STATE_PEEK = 1, STATE_OVER = 2;
    var state = STATE_WAIT;
    var peekAt = now() + 1500 + Math.random() * 2000;   // owner spec: 1.5–3.5s
    var peekedAt = 0;
    var flashUntil = 0;
    var killfeedUntil = 0;
    var reactionMs = 0;
    /* The 50/50 the owner asked for, expressed as an index over the array
       rather than a coin flip, so a third angle is picked automatically the
       moment it is added instead of being unreachable. */
    var A = AWP_ANGLES[Math.floor(Math.random() * AWP_ANGLES.length)];

    function shoot() {
      if (state === STATE_WAIT) {          // fired before he peeked
        state = STATE_OVER;
        beep('dink');
        flashUntil = now() + 220;
        setBanner('TOO EARLY', 'bad');
        setTimeout(fail, 420);
        return;
      }
      if (state === STATE_PEEK) {
        reactionMs = now() - peekedAt;
        state = STATE_OVER;
        if (reactionMs <= 300) {
          beep('awp');
          killfeedUntil = now() + 3000;
          setBanner(reactionMs + 'MS', 'good');
          setTimeout(win, 380);
        } else {
          beep('dink');
          flashUntil = now() + 220;
          setBanner('TOO SLOW — ' + reactionMs + 'MS', 'bad');
          setTimeout(fail, 420);
        }
      }
    }

    return {
      id: 'awp',
      probe: function () {
        return { state: state, sincePeek: state >= STATE_PEEK ? now() - peekedAt : -1,
                 reactionMs: reactionMs, angle: A.id, peekDir: A.peekDir };
      },
      down: function () { shoot(); },
      update: function () {
        if (state === STATE_WAIT && now() >= peekAt) { state = STATE_PEEK; peekedAt = now(); }
        // Missed the window entirely — he crossed and you never fired.
        if (state === STATE_PEEK && now() - peekedAt > 300) {
          state = STATE_OVER;
          beep('dink');
          flashUntil = now() + 220;
          setBanner('HE CROSSED — TOO SLOW', 'bad');
          setTimeout(fail, 420);
        }
      },
      draw: function (c, w, h) {
        var S = awpScene(w, h);
        /* His crossing, 0..1, or -1 when he is not on screen. Computed HERE
           rather than inside an angle, so both angles animate off the one
           clock and neither can quietly invent its own peek timing. */
        var showHim = (state === STATE_PEEK || (state === STATE_OVER && killfeedUntil > now()));
        var t = showHim ? clamp((now() - peekedAt) / 900, 0, 1) : -1;

        A.drawWorld(c, w, h, S, t);
        awpDrawScope(c, w, h, S);

        if (now() < flashUntil) px(c, 0, 0, w, h, 'rgba(255,60,60,0.42)');

        // ---- round score, top-centre, on the black ----
        px(c, w / 2 - 46, 12, 92, 22, '#12141A');
        pixelText(c, '0', w / 2 - 26, 23, 13, '#8CC4FF', 'center');
        pixelText(c, '0', w / 2 + 26, 23, 13, '#E0B36A', 'center');
        px(c, w / 2 - 1, 16, 2, 14, '#3A3F4A');

        // ---- killfeed, below the score so the two never collide ----
        if (now() < killfeedUntil) {
          var kw = 186, kh = 22, kx = w - kw - 8, ky = 44;
          px(c, kx, ky, kw, kh, '#1A1A1A');
          px(c, kx, ky, kw, 2, '#000000');
          px(c, kx, ky + kh - 2, kw, 2, '#000000');
          pixelText(c, 'YOU', kx + 8, ky + kh / 2, 11, '#8CC4FF');
          pixelText(c, 'AWP', kx + kw / 2 - 12, ky + kh / 2, 11, '#E8E8E8');
          pixelText(c, 'ENEMY', kx + kw - 8, ky + kh / 2, 11, '#FF8C8C', 'right');
        }

        // Naming the angle while he waits is the same courtesy the bhop map
        // card pays: with two of them, which one you drew is worth knowing.
        if (state === STATE_WAIT) {
          pixelText(c, A.hint, w / 2, h - 26, 12, '#E8E2D0', 'center');
        }
      }
    };
  }

  /* ======================================================================
     MINIGAME 2 — AK-47 SPRAY CONTROL

     TWO ZONES, and the split is the whole point. The top 60% is the VISUAL
     zone: the range, the dummy, the rifle, the crosshair — everything you need
     to watch. The bottom 40% is the CONTROL PAD, and the compensation line
     lives entirely inside it. The earlier version drew that line across the
     dummy, so the player's own hand covered the thing they were aiming at.

     The player holds and drags to keep up with a pacing node that runs the
     line over three seconds. Their finger's error against that node is the
     only input: on the node, the crosshair sits on the dummy's head and rounds
     land in a tight cluster; off it, the crosshair kicks and rounds go into the
     wall. 80% on the head wins, per the owner spec.
     ====================================================================== */
  var AK_ROUNDS = 30;
  var AK_SHOT_MS = 100;                   // 600 rpm — 30 rounds in exactly 3s
  var AK_RUN_MS = AK_ROUNDS * AK_SHOT_MS; // ...which is the pacing node's trip
  var AK_TOL = 46;                        // px of slack before rounds start missing

  /* The compensation path, in CONTROL-PAD fractions (0..1 across, 0..1 down).
     Pull straight down, curve left, then swoop back right — the inverse of the
     AK's climb, which is what your hand actually does. One array feeds the
     dotted guide, the pacing node AND the scoring, so the guide can never
     describe a different test from the one being run. */
  var AK_PATH = (function () {
    var pts = [], i, t, x, y, u;
    for (i = 0; i < AK_ROUNDS; i++) {
      t = i / (AK_ROUNDS - 1);
      if (t < 0.34) {                       // straight down
        x = 0.50;
        y = 0.10 + (t / 0.34) * 0.34;
      } else if (t < 0.68) {                // then out to the left
        u = (t - 0.34) / 0.34;
        x = 0.50 - 0.32 * Math.sin(u * Math.PI / 2);
        y = 0.44 + u * 0.26;
      } else {                              // and swooping back right
        u = (t - 0.68) / 0.32;
        x = 0.18 + 0.60 * u * u;
        y = 0.70 + u * 0.18;
      }
      pts.push([x, y]);
    }
    return pts;
  })();

  function makeSpray() {
    var firing = false, done = false;
    var shot = 0, hits = 0, fireStartedAt = 0;
    var curX = 0, curY = 0;               // the finger, in canvas px
    var holes = [];                        // {x, y, head} decals
    var results = [];                      // per-round hit/miss, for the mag bar
    var flashUntil = 0, redUntil = 0;
    var kickX = 0, kickY = 0;              // live crosshair displacement
    var padTop = 0, padX = 0, padY = 0, padW = 0, padH = 0;
    var headX = 0, headY = 0;

    /* Zone geometry. Called at construction as well as from draw(), because
       update() and the pointer handlers read it — leaving it to the first
       draw would let a touch land while the pad's bounds were still zero. */
    function layout(w, h) {
      padTop = Math.round(h * 0.60);
      padX = 0; padY = padTop + 4; padW = w; padH = h - padY;
      // Centre of the head block, which is what the crosshair locks to.
      headX = w / 2; headY = padTop * 0.30 + 17;
    }
    layout(W || 420, H || 833);

    function nodeAt(t) {                   // pacing node, in canvas px
      var i = clamp(t, 0, 1) * (AK_ROUNDS - 1);
      var a = AK_PATH[Math.floor(i)], b = AK_PATH[Math.min(AK_ROUNDS - 1, Math.ceil(i))];
      var f = i - Math.floor(i);
      return {
        x: padX + (a[0] + (b[0] - a[0]) * f) * padW,
        y: padY + (a[1] + (b[1] - a[1]) * f) * padH
      };
    }
    function progress() {
      if (!firing) return 0;
      return clamp((now() - fireStartedAt) / AK_RUN_MS, 0, 1);
    }
    // 0 = dead on the node, 1 = hopelessly off. Drives BOTH the scoring and
    // how far the crosshair is thrown, so what you see is what you are graded on.
    function drift() {
      var n = nodeAt(progress());
      var dx = curX - n.x, dy = curY - n.y;
      return Math.sqrt(dx * dx + dy * dy) / AK_TOL;
    }

    function endSpray() {
      if (done) return;
      done = true;
      firing = false;
      if (hits / AK_ROUNDS >= 0.80) {
        setBanner('SPRAY CONTROLLED!', 'good');
        beep('cash');
        win();                             // win() itself holds 1.5s
      } else {
        redUntil = now() + 380;
        beep('miss');
        setTimeout(fail, 520);
      }
    }

    return {
      id: 'spray',
      probe: function () {
        return { firing: firing, shot: shot, hits: hits, done: done,
                 rounds: AK_ROUNDS, drift: firing ? +drift().toFixed(2) : -1 };
      },
      down: function (p) {
        if (done || firing) return;
        if (p.y < padTop) return;          // the pad is the control, not the scene
        firing = true;
        curX = p.x; curY = p.y;
        fireStartedAt = now();
      },
      move: function (p) { if (firing) { curX = p.x; curY = p.y; } },
      // Lifting off does NOT end the run early: the magazine empties on its own
      // clock, and a player who lets go simply misses the rest.
      up: function () { },
      update: function () {
        if (!firing || done) return;
        /* Rounds are due on the WALL CLOCK, not on accumulated frame deltas.
           A dt-accumulator with a per-frame cap time-dilates the moment the
           frame rate drops — a backgrounded tab or a slow phone would stretch
           a 3s spray into something much longer, and the pacing node would
           drift out of step with the rounds it is supposed to pace. */
        var due = Math.floor((now() - fireStartedAt) / AK_SHOT_MS) + 1;
        while (shot < due && shot < AK_ROUNDS && !done) {
          var d = drift();
          var hit = d <= 1;
          if (hit) hits++;
          results.push(hit);
          // On target: a tight cluster on the head. Off it: into the wall,
          // thrown in the direction the crosshair was kicked.
          if (hit) {
            holes.push({ x: headX + (Math.random() - 0.5) * 15,
                         y: headY + (Math.random() - 0.5) * 15, head: true });
          } else {
            holes.push({ x: headX + kickX + (Math.random() - 0.5) * 60,
                         y: headY + kickY + (Math.random() - 0.5) * 60, head: false });
          }
          if (holes.length > AK_ROUNDS) holes.shift();
          flashUntil = now() + 55;
          beep('ak');
          shot++;
          if (shot >= AK_ROUNDS) endSpray();
        }
        // The kick follows the drift, with a little noise so a bad hold reads
        // as the rifle fighting you rather than as a smooth offset.
        var k = clamp(drift() - 1, 0, 3);
        kickX = k * 34 * Math.cos(now() / 40) + (curX - nodeAt(progress()).x) * 0.55;
        kickY = k * 26 * Math.sin(now() / 33) + (curY - nodeAt(progress()).y) * 0.35;
      },
      draw: function (c, w, h) {
        var i, hx;
        layout(w, h);
        var dummyX = w / 2, dummyTop = padTop * 0.30;

        /* ---------- VISUAL ZONE: the range ---------- */
        px(c, 0, 0, w, padTop, '#6A5B4E');                 // brick mortar bed
        for (var by = 0; by < padTop; by += 22) {          // 16-bit brick courses
          var stagger = ((by / 22) | 0) % 2 ? 34 : 0;
          for (var bx = -68; bx < w; bx += 68) {
            px(c, bx + stagger + 2, by + 2, 64, 18, '#8A6A55');
            px(c, bx + stagger + 2, by + 2, 64, 4, '#9C7A62');   // lit top edge
            px(c, bx + stagger + 2, by + 16, 64, 4, '#6E5443');  // shadowed base
          }
        }
        px(c, 0, padTop * 0.80, w, 5, '#4E4237');          // range floor line
        px(c, 0, padTop * 0.80, w, padTop * 0.20, '#5A4C40');

        /* ---- wooden target dummy ----
           The head is its OWN block above the shoulders, not a plate painted on
           the chest: the crosshair locks to it and rounds cluster on it, so it
           has to be unmistakable which part of the target that is. */
        var tw = 76, tTop = dummyTop + 44;
        px(c, dummyX - 24, dummyTop - 3, 48, 40, '#3A2C20');                   // head outline
        px(c, dummyX - 21, dummyTop, 42, 34, '#C49A60');                       // head
        px(c, dummyX - 21, dummyTop, 42, 5, '#DDB176');                        // lit top
        px(c, dummyX - 21, dummyTop + 29, 42, 5, '#A57F4A');                   // shadow
        px(c, dummyX - 8, dummyTop + 34, 16, 12, '#8A6A3E');                   // neck
        px(c, dummyX - tw / 2 - 3, tTop - 3, tw + 6, 82, '#3A2C20');           // torso outline
        px(c, dummyX - tw / 2, tTop, tw, 76, '#B08A55');                       // torso
        for (i = 0; i < 5; i++)                                                 // plank grain
          px(c, dummyX - tw / 2 + 5 + i * 14, tTop + 4, 3, 68, '#9A7645');
        px(c, dummyX - tw / 2 - 17, tTop + 8, 17, 48, '#9A7645');              // arms
        px(c, dummyX + tw / 2, tTop + 8, 17, 48, '#9A7645');
        px(c, dummyX - 8, tTop + 76, 16, 30, '#6E5436');                       // post
        px(c, dummyX - 32, tTop + 106, 64, 9, '#5A4530');                      // base

        // ---- bullet holes ----
        for (i = 0; i < holes.length; i++) {
          var H = holes[i];
          px(c, H.x - 3, H.y - 3, 6, 6, '#1A1410');
          px(c, H.x - 4, H.y - 4, 3, 3, H.head ? '#6A5030' : '#4E4034');
        }

        /* ---- first-person AK-47, held at the bottom-right of the visual zone.
           Built as a real profile — stock, receiver, curved magazine, wooden
           handguard, gas tube, barrel, front sight — and canted so the muzzle
           rides up toward the target. The cant costs a little edge crispness
           and buys the only thing that makes it read as a rifle rather than a
           pile of boxes. */
        c.save();
        // POSITIVE rotation: the barrel runs toward -x, and rotate(-t) would
        // swing that end downward, burying the muzzle in the control pad.
        c.translate(w - 10, padTop - 14);
        c.rotate(0.30);
        // Held small and cornered. At full size the receiver ran clean across
        // the dummy, hiding the one thing the player is meant to be watching.
        c.scale(0.60, 0.60);
        px(c, 4, -24, 62, 26, '#4A3728');                    // stock
        px(c, 8, -20, 52, 6, '#5E4732');                     // stock highlight
        px(c, -62, -28, 70, 28, '#33261B');                  // receiver
        px(c, -60, -26, 64, 6, '#4A3728');                   // dust cover
        px(c, -8, 0, 22, 32, '#3E2E20');                     // pistol grip
        px(c, -42, 0, 28, 17, '#2E2419');                    // magazine, curving
        px(c, -47, 15, 28, 17, '#2E2419');                   // forward and down
        px(c, -54, 29, 26, 15, '#2E2419');
        px(c, -128, -25, 68, 22, '#7A5836');                 // wooden handguard
        px(c, -128, -25, 68, 5, '#8E6A44');
        px(c, -126, -32, 60, 8, '#4E4238');                  // gas tube
        px(c, -180, -23, 54, 11, '#8E9296');                 // barrel
        px(c, -188, -34, 12, 16, '#6E7276');                 // front sight block
        px(c, -196, -26, 16, 17, '#6E7276');                 // muzzle brake
        if (now() < flashUntil) {                             // muzzle flash
          px(c, -232, -30, 36, 26, '#FFE9A0');
          px(c, -250, -25, 20, 16, '#FFB03A');
          px(c, -224, -48, 13, 46, '#FFD060');
          px(c, -214, -20, 46, 12, '#FFF3C8');
        }
        c.restore();

        // ---- the crosshair: classic green, tied to the finger ----
        var cxh = headX + (firing ? kickX : 0), cyh = headY + (firing ? kickY : 0);
        var gap = 5, len = 11;
        c.save();
        c.shadowColor = '#00FF66'; c.shadowBlur = 4;
        px(c, cxh - gap - len, cyh - 1, len, 3, '#3CFF8A');
        px(c, cxh + gap, cyh - 1, len, 3, '#3CFF8A');
        px(c, cxh - 1, cyh - gap - len, 3, len, '#3CFF8A');
        px(c, cxh - 1, cyh + gap, 3, len, '#3CFF8A');
        c.restore();

        /* ---------- the 2px black seam between the zones ---------- */
        px(c, 0, padTop, w, 4, '#000000');

        /* ---------- CONTROL PAD ---------- */
        px(c, 0, padY, w, h - padY, '#232B33');            // dark slate
        for (i = 0; i < w; i += 8) px(c, i, padY, 4, 1, '#2B343D');   // faint tooling
        px(c, 0, h - 3, w, 3, '#161C22');

        // ---- the compensation line, drawn ONLY in the pad ----
        var pn = progress();
        c.save();
        c.shadowColor = '#34D3FF'; c.shadowBlur = 7;
        for (i = 0; i < AK_ROUNDS; i++) {
          var gp = nodeAt(i / (AK_ROUNDS - 1));
          px(c, gp.x - 2, gp.y - 2, 5, 5, i < shot ? '#2F6E7E' : '#34D3FF');
        }
        c.restore();
        px(c, nodeAt(0).x - 8, nodeAt(0).y - 8, 17, 17, '#0E3A44');   // start pad
        px(c, nodeAt(0).x - 5, nodeAt(0).y - 5, 11, 11, '#34D3FF');

        // ---- the pacing node, and the player's finger ----
        if (firing) {
          var nd = nodeAt(pn), off = drift();
          c.save();
          c.shadowColor = off <= 1 ? '#7FE3B0' : '#FF6A5A';
          c.shadowBlur = 12;
          px(c, nd.x - 7, nd.y - 7, 15, 15, off <= 1 ? '#7FE3B0' : '#FF6A5A');
          px(c, nd.x - 4, nd.y - 4, 9, 9, '#FFFFFF');
          c.restore();
          // a leash from the node to the finger, so the error is legible
          c.strokeStyle = off <= 1 ? 'rgba(127,227,176,0.8)' : 'rgba(255,106,90,0.9)';
          c.lineWidth = 2;
          c.beginPath(); c.moveTo(nd.x, nd.y); c.lineTo(curX, curY); c.stroke();
          px(c, curX - 9, curY - 2, 19, 4, '#FFD54A');
          px(c, curX - 2, curY - 9, 4, 19, '#FFD54A');
        }

        /* ---------- 16-bit magazine bar, top of screen ---------- */
        var mw = w - 24, mx = 12, my = 8, mh = 14;
        px(c, mx - 2, my - 2, mw + 4, mh + 4, '#000000');
        px(c, mx, my, mw, mh, '#1A2028');
        for (i = 0; i < AK_ROUNDS; i++) {
          hx = mx + 2 + i * ((mw - 4) / AK_ROUNDS);
          // Per-ROUND result, not a running count: colouring the first `hits`
          // cells green would show a clean streak the player never shot.
          px(c, hx, my + 2, (mw - 4) / AK_ROUNDS - 1.5, mh - 4,
            i < shot ? (results[i] ? '#7FE3B0' : '#C0483C') : '#46525F');
        }

        if (!firing && !done) {
          pixelText(c, 'HOLD THE NODE AND FOLLOW THE LINE', w / 2, padY + padH - 14, 10,
            '#E8E2D0', 'center');
        }
        if (now() < redUntil) px(c, 0, 0, w, h, 'rgba(255,60,60,0.40)');
      }
    };
  }

  /* ======================================================================
     MINIGAME 3 — TOP-DOWN BHOP RUN, ON NUKE OR DUST 2
     Alternate left/right taps in time with the rhythm stick. On-beat and
     alternating builds speed 250 -> 450+; anything else drops you to 250.
     Perfect rhythm reaches the finish in about nine and a half seconds.

     TWO MAPS, picked per run with no immediate repeat (see BH_MAPS). Both
     routes are tuned to within 6 units of the same track length, so ONE set
     of speed and beat constants governs both — reshape either route without
     re-checking that and it silently becomes free or impossible.
     ====================================================================== */
  var BH_MIN_SPEED = 250, BH_MAX_SPEED = 470;
  /* The rhythm SWEEPS: the marker runs left, then back right, then left again,
     and each traverse is one strafe. That is why there is no separate
     "which side is next" state any more — the direction the marker is
     travelling IS the side to tap, so the two can never disagree.
     The period scales with speed: roomy while you are slow, tightening as you
     actually get going, which is what makes going faster feel earned rather
     than just a bigger number. */
  var BH_BEAT_SLOW_MS = 760;  // one traverse at base speed
  var BH_BEAT_FAST_MS = 430;  // ...and at top speed
  var BH_GREEN = 0.16;        // half-width of the green zone, as traverse fraction
  /* Speed lost per traverse you let pass without jumping. Deliberately SMALLER
     than the +26 a good jump gains: at 40 the penalty outweighed the reward, so
     anything under about 61% accuracy could never climb at all and the ramp was
     unreachable for an ordinary player. At 18 a scrappy run still creeps
     upward and a clean one is simply much faster. */
  var BH_COAST_DROP = 18;
  var BH_SCALE = 0.55;        // map units -> screen px

  /* ==== THE MAPS ==========================================================
     A run picks one map at random with no immediate repeat — the same rule
     pickGame() needs, for the same reason: with two maps a naive coin flip
     repeats half the time, which reads as "it only has one map".

     EVERYTHING that differs between routes lives in one object here, so a
     third map is data rather than another branch inside the renderer.

     Both are authored so the player runs toward -y (UP the screen), the only
     layout that works on a 420-wide portrait phone. They reach that
     differently, and the difference is deliberate:

       NUKE  is ROTATED 90 degrees from its real radar. Real map north
             therefore points screen-LEFT, which is why MAIN sits left of the
             route and T RED right — that is where they really are relative to
             the run, not an invented layout.
       DUST 2 is UNROTATED. Its Long route already runs bottom-to-top on the
             real radar, so screen-up is genuinely map-north here and every
             callout sits where a player expects it.

     Do not "make them consistent". Each is in whichever orientation keeps its
     own callouts truthful. Baking the rotation into the DATA (rather than
     yawing the camera each frame) keeps every rect axis-aligned, so the art
     stays pixel-crisp and the labels stay upright for free.

     Rects are [x, y, w, h, surface], where surface indexes theme.surf.
     Anything NOT covered by a rect is structure. That inversion — negative
     space as architecture — is what makes these read as places rather than as
     radars, and it is why the structure colour must stay clearly separated in
     luminance from every walkable surface (a test asserts it per map).
  */

  var BH_MAPS = {

    /* ---------------------------------------------------------------- NUKE */
    nuke: {
      id: 'nuke',
      name: 'NUKE',
      leg: 'T SPAWN — OUTSIDE',
      finishBanner: 'OUTSIDE — GG',
      // surfaces: 0 asphalt yard (oil-stained loading area), 1 outdoor
      // concrete, 2 building interior (neighbours passed but never entered)
      theme: {
        mass: '#5E6266',                                   // structure mass
        seam: '#535759',
        kerb: '#A2A69E',
        surf: ['#42433E', '#8E9289', '#A9ADA4'],
        route: '#D8AC33',                                  // painted plant arrows
        detail: 'nuke',
        backdrop: 'cedar'
      },
      rooms: [
        // T SPAWN — a wide yard that necks down into the exit. The back wall
        // sits well behind the spawn point (y 3596 vs a start of 3470) so the
        // camera has something to show, rather than void, at the first frame.
        [88, 2496, 544, 1100, 0], [192, 2240, 336, 256, 0], [240, 1960, 240, 280, 0],
        // the connector: a staircase of rects carrying the route right and up
        [240, 1760, 300, 240, 1], [240, 1600, 448, 160, 1],
        [480, 1440, 352, 160, 1], [608, 1280, 288, 176, 1],
        // OUTSIDE — the open concrete the run ends on
        [528, 100, 472, 1360, 1],
        // neighbours, so the plant feels like a place rather than a tube
        [130, 260, 360, 640, 2],     // MAIN
        [130, 940, 250, 200, 2],     // SQUEEKY
        [1040, 1120, 160, 210, 2]    // T RED
      ],
      // Callouts are held off the running lane on purpose — a label centred on
      // the route ends up permanently underneath the player sprite.
      labels: [
        ['T SPAWN', 185, 3150, 14], ['SILO', 585, 920, 11],   // sits ON the tank
        ['OUTSIDE', 640, 300, 14], ['MINI', 900, 620, 11],
        ['MAIN', 400, 620, 12], ['SQUEEKY', 250, 1040, 10], ['T RED', 1120, 1230, 10]
      ],
      // the ribbed steel tank, straddling the west wall as it does live
      feature: { kind: 'silo', x: 585, y: 920, r: 92 },
      /* Set dressing, all lifted from the two reference shots of the real
         Outside: rust-orange shipping containers, the red delivery truck in T
         Spawn, yellow hazard hatching and parking bays, silver pipe runs.
         Everything sits clear of the running lane so nothing hides the player. */
      props: [
        // --- T Spawn yard ---
        { t: 'hatch', x: 100, y: 3400, w: 220, h: 170 },
        { t: 'truck', x: 420, y: 3130, w: 120, h: 190 },
        { t: 'cont', x: 108, y: 2880, w: 132, h: 62 },
        { t: 'cont', x: 108, y: 2960, w: 132, h: 62 },
        { t: 'cont', x: 470, y: 2620, w: 62, h: 132 },
        { t: 'bay', x: 430, y: 2860, w: 190, h: 240 },
        // --- the connector ---
        { t: 'pipe', x: 258, y: 1610, w: 34, h: 380 },
        { t: 'curb', x: 620, y: 1450, w: 200, h: 14 },
        // Was x:700 w:130, which put a solid steel container flat ON the lane
        // at the top of the bend — measured clearance 0.0, i.e. the player ran
        // straight through it every single run. Shifted right, into the same
        // room, where it clears by 41 units.
        { t: 'cont', x: 800, y: 1300, w: 96, h: 60 },
        // --- Outside ---
        { t: 'bay', x: 830, y: 1000, w: 160, h: 300 },
        { t: 'cont', x: 858, y: 1080, w: 130, h: 60 },
        { t: 'cont', x: 858, y: 1160, w: 130, h: 60 },
        { t: 'hatch', x: 545, y: 1150, w: 150, h: 150 },
        { t: 'pipe', x: 962, y: 300, w: 34, h: 420 },
        { t: 'cont', x: 560, y: 380, w: 128, h: 60 },
        { t: 'curb', x: 545, y: 640, w: 170, h: 14 }
      ],
      path: [[330, 3470], [330, 1990], [760, 1290], [760, 100]],
      finishSpan: [528, 1000]
    },

    /* -------------------------------------------------------------- DUST 2 */
    /* T SPAWN -> OUTSIDE LONG -> LONG DOUBLE DOORS -> LONG A -> A SITE, the
       iconic long run, traced off the owner's radar shots. Its track length is
       3486.5 units against Nuke's 3491.5 — within 5 — so ONE set of speed/beat
       constants keeps both routes at the same "clean run ~9.4s, mashing loses"
       tuning. Reshaping either route without re-checking that is how a map
       silently becomes free; the suite asserts both ends for every map.

       The V23 art pass rebuilt everything this map DRAWS — the roofscape, the
       ground, the wall thickness, the prop vocabulary — and deliberately did
       not touch `path` by a single unit, because the path IS the track length
       and the whole tuning hangs off it. Art is free; geometry is not. */
    dust2: {
      id: 'dust2',
      name: 'DUST 2',
      leg: 'T SPAWN — A SITE',
      finishBanner: 'A SITE — GG',
      /* Dust 2 is the hard case for the structure/surface rule: on the real
         map the walls are the SAME sandstone as the ground, so a literal
         palette would make the route vanish. The radar itself solves this by
         darkening everything unwalkable, and so do we — structure is a
         deliberately darker, cooler ochre, and every walkable surface is
         lighter and warmer. Measured separation is 53–104 units of luminance,
         comfortably past the 24 the suite demands, and the ground TEXTURE
         tones below stay inside that same band on purpose. */
      theme: {
        mass: '#6B5B42',                                   // structure mass
        seam: '#5A4B36',
        kerb: '#E0CFA8',
        // The wall's own depth. A kerb alone is a painted outline; this is the
        // dark lip that falls off its far side and gives it thickness. Nuke
        // has no `shadow` key and is therefore rendered exactly as before.
        shadow: '#463A28',
        // 0 packed sand, 1 paved stone (the site platform, doubles), 2 shade
        surf: ['#C4A87A', '#D6C49B', '#A88F66'],
        // Which ground-texture pass to run over the surfaces. Flat fills are
        // what made this map read as tan rectangles: the real thing is
        // flagstone, cobble and blown sand, and none of that survives as one
        // colour. Keyed rather than boolean so Nuke's asphalt stays untouched
        // and a third map can bring its own.
        ground: 'sand',
        route: '#E8DCC0',        // chalk scuff, not paint — yellow on sand reads wrong
        detail: 'dust2',
        backdrop: 'dome'
      },
      rooms: [
        // T SPAWN — the wide sandy yard the run starts in
        [120, 3280, 480, 460, 0],
        // out of spawn, angling right toward Outside Long
        [240, 2900, 420, 400, 0],
        [380, 2600, 340, 320, 0],
        // OUTSIDE LONG — open sand, the well sits here
        [400, 2240, 360, 380, 0],
        // LONG DOUBLE DOORS — the choke, paved and shaded
        [480, 2040, 180, 220, 1],
        // the dogleg into Long A
        [520, 1720, 280, 340, 0],
        // LONG A — the long straight
        [590, 840, 240, 900, 0],
        // A SITE — the paved platform the run ends on
        [430, 140, 450, 720, 1],
        // --- neighbours, never entered ---
        [880, 1240, 190, 280, 2],   // the pit
        [900, 240, 170, 320, 0],    // the car park
        [150, 220, 250, 330, 2],    // CT side
        [60, 1360, 210, 520, 2],    // catwalk / mid
        [60, 2700, 180, 300, 2],    // T ramp
        /* Three shaded alcoves cut off the route. They exist so the floor
           union has a broken, courtyard-ish silhouette instead of a chain of
           rectangles — the outline of the walkable area is most of what sells
           this as a town from above. Each one touches a room it opens off, or
           it would float as an island of floor in the middle of a building. */
        [300, 2380, 110, 220, 2],   // alcove west of Outside Long
        [760, 2180, 140, 150, 2],   // ...and east
        [830, 700, 140, 200, 2]     // the corner between Long and the cars
      ],
      /* TWO callouts, down from eleven. The owner's note was blunt: the start
         and the destination earn their labels and everything else is clutter
         you read once and then run over for the rest of the game. The intro
         card already names the leg, so the map does not need to narrate
         itself a third time. */
      labels: [
        ['T SPAWN', 200, 3520, 13],
        ['A SITE', 500, 400, 14]
      ],
      // the stone well in Outside Long — Dust 2's answer to the silo, and the
      // one round landmark on the route
      feature: { kind: 'well', x: 450, y: 2380, r: 62 },
      /* Set dressing from the owner's reference shots, and all of it the same
         vocabulary the real map is built from: stacked wooden crates, rust and
         blue barrels, tarped pallets, the beige cars, loose rubble — plus the
         three the V23 pass added, which are the things that make a courtyard
         read as architecture rather than as a yard: doorway ARCHES through the
         walls, cloth AWNINGS over them, and the STEPS up onto the A platform.
         Every solid one is held clear of the running lane; the flat ones
         (rubble) are paint the player is meant to run straight over. */
      props: [
        // --- T Spawn ---
        { t: 'crate', x: 140, y: 3540, w: 92, h: 92 },
        { t: 'crate', x: 146, y: 3450, w: 74, h: 74 },
        { t: 'crate', x: 168, y: 3660, w: 70, h: 70 },
        { t: 'barrel', x: 496, y: 3592, w: 46, h: 46, v: 0 },
        { t: 'barrel', x: 538, y: 3616, w: 46, h: 46, v: 1 },
        { t: 'rubble', x: 200, y: 3300, w: 130, h: 80 },
        { t: 'rubble', x: 330, y: 3420, w: 100, h: 60 },
        { t: 'steps', x: 140, y: 3286, w: 150, h: 40 },
        // --- out of spawn ---
        { t: 'crate', x: 268, y: 3170, w: 80, h: 80 },
        { t: 'pallet', x: 596, y: 3000, w: 92, h: 62 },
        { t: 'barrel', x: 408, y: 2700, w: 44, h: 44, v: 1 },
        { t: 'barrel', x: 448, y: 2676, w: 44, h: 44, v: 0 },
        { t: 'crate', x: 648, y: 2820, w: 70, h: 70 },
        { t: 'awning', x: 76, y: 2760, w: 84, h: 38 },
        // --- Outside Long ---
        { t: 'crate', x: 688, y: 2300, w: 66, h: 66 },
        { t: 'rubble', x: 618, y: 2500, w: 100, h: 70 },
        { t: 'rubble', x: 670, y: 2540, w: 85, h: 60 },
        { t: 'barrel', x: 320, y: 2440, w: 42, h: 42, v: 0 },
        { t: 'awning', x: 786, y: 2200, w: 80, h: 36 },
        /* --- Doubles. Both barrels sit LEFT of the lane: the room is only 180
           units wide and the route cuts it diagonally, so the strip right of
           the lane is too narrow to hold a barrel without either clipping on
           the floor edge or standing in the player's path. */
        { t: 'barrel', x: 486, y: 2196, w: 42, h: 42, v: 0 },
        { t: 'barrel', x: 514, y: 2040, w: 42, h: 42, v: 1 },
        { t: 'arch', x: 482, y: 2044, w: 56, h: 26 },
        // --- the dogleg ---
        { t: 'crate', x: 738, y: 1900, w: 62, h: 62 },
        { t: 'pallet', x: 528, y: 1780, w: 84, h: 56 },
        { t: 'arch', x: 594, y: 1744, w: 56, h: 26 },
        // --- Long A, lining both sides of the straight ---
        { t: 'barrel', x: 612, y: 1700, w: 42, h: 42, v: 1 },
        { t: 'crate', x: 598, y: 1600, w: 58, h: 58 },
        { t: 'crate', x: 598, y: 1524, w: 58, h: 58 },
        { t: 'barrel', x: 782, y: 1452, w: 44, h: 44, v: 1 },
        { t: 'barrel', x: 782, y: 1400, w: 44, h: 44, v: 0 },
        { t: 'crate', x: 770, y: 1300, w: 54, h: 54 },
        { t: 'rubble', x: 594, y: 1180, w: 62, h: 120 },
        { t: 'crate', x: 776, y: 1046, w: 52, h: 52 },
        { t: 'barrel', x: 604, y: 946, w: 44, h: 44, v: 0 },
        { t: 'awning', x: 96, y: 1470, w: 84, h: 38 },
        { t: 'crate', x: 900, y: 1280, w: 60, h: 60 },
        { t: 'crate', x: 852, y: 760, w: 56, h: 56 },
        // --- A site ---
        { t: 'steps', x: 440, y: 790, w: 200, h: 44 },
        { t: 'pallet', x: 796, y: 700, w: 90, h: 60 },
        { t: 'barrel', x: 516, y: 616, w: 44, h: 44, v: 1 },
        { t: 'barrel', x: 556, y: 640, w: 44, h: 44, v: 0 },
        { t: 'awning', x: 444, y: 560, w: 80, h: 36 },
        { t: 'rubble', x: 470, y: 500, w: 110, h: 70 },
        { t: 'car', x: 756, y: 396, w: 112, h: 192 },
        { t: 'crate', x: 466, y: 300, w: 84, h: 84 },
        { t: 'crate', x: 472, y: 224, w: 66, h: 66 },
        // --- the neighbours ---
        { t: 'car', x: 926, y: 300, w: 104, h: 180 },
        { t: 'barrel', x: 936, y: 500, w: 44, h: 44, v: 1 },
        { t: 'pallet', x: 300, y: 220, w: 88, h: 58 }
      ],
      path: [[300, 3600], [560, 2760], [560, 2180], [700, 1760], [700, 900], [620, 180]],
      finishSpan: [430, 880]
    }
  };

  /* Segments and total track length, derived per map. The route's own length
     IS the track — one source of truth, so a map can be reshaped without the
     win condition silently drifting away from it. */
  function bhBuildSegs(map) {
    var segs = [], i;
    for (i = 0; i < map.path.length - 1; i++) {
      var a = map.path[i], b = map.path[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], len: Math.sqrt(dx * dx + dy * dy) });
    }
    map.segs = segs;
    map.track = segs.reduce(function (t, s) { return t + s.len; }, 0);
    return map;
  }
  var BH_IDS = Object.keys(BH_MAPS);
  BH_IDS.forEach(function (k) { bhBuildSegs(BH_MAPS[k]); });

  var lastMapId = null;
  function pickMap() {
    var pool = BH_IDS.filter(function (id) { return id !== lastMapId; });
    lastMapId = pool[Math.floor(Math.random() * pool.length)] || BH_IDS[0];
    return BH_MAPS[lastMapId];
  }

  /* ---- the player, as a real top-down operator ---------------------------
     Authored as a BITMAP, not a stack of rects. The sprite this replaces was
     four nested squares plus a stick, and read as exactly that: a box with a
     pistol taped to the front. A grid is also the only sane way to keep a
     silhouette this small editable.

     Facing -y (up the screen), the direction of travel on both maps. 16x16 at
     2px a cell = a 32px sprite. Read top to bottom it is: muzzle, barrel,
     both gloves on the handguard, the receiver and its furniture, arms
     opening out to the shoulders, the head seen from directly above, and the
     pack on his back.
  */
  var BH_SPRITE = [
    '.......##.......',
    '.......MM.......',
    '......#MM#......',
    '......#MM#......',
    '.....##MM##.....',
    '....#GGMMGG#....',
    '....#GGMMGG#....',
    '...##SSMMSS##...',
    '..#SSSSWWSSSS#..',
    '.#SSVVVVVVVVSS#.',
    '.#SVVVHHHHVVVS#.',
    '.#SVVHHHHHHVVS#.',
    '.#SVVHHHHHHVVS#.',
    '.#SVVVHHHHVVVS#.',
    '..#BBBBBBBBBB#..',
    '...##########...'
  ];
  var BH_SPRITE_COLS = {
    '#': '#14161B',   // outline
    'M': '#2E323A',   // gun metal
    'W': '#6B5434',   // furniture
    'G': '#3A3128',   // glove
    'S': '#C2A06A',   // sleeve
    'V': '#8A7048',   // vest / torso
    'H': '#4A3E2C',   // head from above
    'B': '#5E4C31'    // pack
  };
  /* A dark outline ALONE vanishes on Nuke's near-black asphalt; a light one
     alone washes out on Dust 2's pale stone. The sprite therefore carries
     both: a one-cell cream halo dilated out of its own silhouette, painted
     first, then the sprite with its dark outline on top. That reads on every
     surface either map has.
     Precomputed once — dilating 256 cells every frame for a shape that never
     changes would be pure waste. */
  var BH_SPRITE_HALO = (function () {
    var rows = BH_SPRITE.length, cols = BH_SPRITE[0].length, out = [], y, x;
    function solid(px2, py) {
      return py >= 0 && py < rows && px2 >= 0 && px2 < cols && BH_SPRITE[py].charAt(px2) !== '.';
    }
    for (y = 0; y < rows; y++) {
      out.push([]);
      for (x = 0; x < cols; x++) {
        out[y][x] = !solid(x, y) && (
          solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1) ||
          solid(x - 1, y - 1) || solid(x + 1, y - 1) ||
          solid(x - 1, y + 1) || solid(x + 1, y + 1));
      }
    }
    return out;
  })();
  var BH_SPRITE_CELL = 2;
  // Row 11.5 is the middle of the torso. The sprite pivots THERE, not on the
  // grid centre, so the strafe tilt swings the body rather than the muzzle.
  var BH_SPRITE_PIVOT_ROW = 11.5;

  function bhDrawPlayer(c) {
    var cell = BH_SPRITE_CELL, rows = BH_SPRITE.length, cols = BH_SPRITE[0].length;
    var ox = -cols * cell / 2, oy = -BH_SPRITE_PIVOT_ROW * cell, x, y, ch;
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        if (BH_SPRITE_HALO[y][x]) px(c, ox + x * cell, oy + y * cell, cell, cell, '#F4F1E8');
      }
    }
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        ch = BH_SPRITE[y].charAt(x);
        if (ch !== '.') px(c, ox + x * cell, oy + y * cell, cell, cell, BH_SPRITE_COLS[ch]);
      }
    }
  }

  /* Deterministic per-cell noise for the roof dressing. It must be a pure
     function of the world cell, never of frame count or Math.random — vents
     that re-roll each frame would boil, and vents held in an array would need
     the array to cover ground the camera may never visit. */
  function bhHash(a, b) {
    var n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  // Where on the route a given distance lands. Used by the camera, the player
  // sprite and the guide chevrons alike.
  function bhPathAt(map, d) {
    var rem = clamp(d, 0, map.track), i;
    for (i = 0; i < map.segs.length; i++) {
      var s = map.segs[i];
      if (rem <= s.len || i === map.segs.length - 1) {
        var t = s.len ? clamp(rem / s.len, 0, 1) : 0;
        return { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t,
                 ang: Math.atan2(s.y1 - s.y0, s.x1 - s.x0) };
      }
      rem -= s.len;
    }
    return { x: map.path[0][0], y: map.path[0][1], ang: -Math.PI / 2 };
  }

  function makeBhop() {
    var map = pickMap();
    var dist = 0, speed = BH_MIN_SPEED;
    var camX = map.path[0][0]; // lags the player through the bend, so the turn
                              // sweeps instead of snapping
    var tilt = 0;
    var trail = [];
    var introUntil = now() + 1300;
    var done = false;
    var lastHitGood = false;

    /* phase runs 0..2: 0..1 is the marker travelling RIGHT, 1..2 travelling
       back LEFT. It is accumulated from the wall clock rather than derived by
       modulo, because the period changes with speed — a modulo of a moving
       divisor makes the marker teleport every time the player gains a step. */
    var phase = 0, phaseAt = 0;
    var scoredHalf = -1;       // the half-sweep already credited, so mashing fails
    var lastHalf = 0;

    function beatMs() {
      var t = clamp((speed - BH_MIN_SPEED) / (BH_MAX_SPEED - BH_MIN_SPEED), 0, 1);
      return BH_BEAT_SLOW_MS + (BH_BEAT_FAST_MS - BH_BEAT_SLOW_MS) * t;
    }
    // Idempotent, and called from the pointer handler as well as update(): a
    // tap judged against a phase that is one throttled frame stale would be
    // judged against a marker the player is not looking at.
    function advance() {
      var t = now();
      if (!phaseAt) { phaseAt = t; return; }
      phase = (phase + (t - phaseAt) / beatMs()) % 2;
      phaseAt = t;
    }
    function markerPos() { return phase <= 1 ? phase : 2 - phase; }  // 0..1, ping-pong
    function sweepDir() { return phase <= 1 ? 1 : -1; }              // +1 right, -1 left
    function half() { return phase <= 1 ? 0 : 1; }

    function tap(side) {
      if (done) return;
      if (now() < introUntil) return;      // ignore taps during the intro card
      advance();
      var offBeat = Math.abs(markerPos() - 0.5) > BH_GREEN;
      var wrongSide = (side !== sweepDir());
      var alreadyJumped = (half() === scoredHalf);
      if (offBeat || wrongSide || alreadyJumped) {
        speed = BH_MIN_SPEED;
        lastHitGood = false;
        beep('miss');
      } else {
        speed = Math.min(BH_MAX_SPEED, speed + 26);
        lastHitGood = true;
        scoredHalf = half();
        tilt = side * 20;
        beep('bhop');
      }
    }

    return {
      id: 'bhop',
      probe: function () {
        // advance() first: the phase is only stepped by update(), so reading it
        // raw would report wherever the last frame left it rather than where
        // the marker actually is now.
        if (now() >= introUntil) advance();
        return { dist: dist, speed: speed, beatT: markerPos(), nextSide: sweepDir(),
                 beatMs: Math.round(beatMs()), intro: now() < introUntil,
                 track: map.track, mapId: map.id };
      },
      down: function (p) { tap(p.x < W / 2 ? -1 : 1); },
      update: function (dt) {
        if (done) return;
        if (now() < introUntil) { phaseAt = now(); return; }
        advance();
        // Let a whole traverse go by without jumping and you bleed speed, the
        // way landing without hopping bleeds it in the real thing.
        if (half() !== lastHalf) {
          if (scoredHalf !== lastHalf) {
            speed = Math.max(BH_MIN_SPEED, speed - BH_COAST_DROP);
            lastHitGood = false;
          }
          lastHalf = half();
        }
        dist += speed * dt;
        camX += (bhPathAt(map, dist).x - camX) * Math.min(1, dt * 3.2);
        tilt *= 0.88;
        if (speed > 350) {
          trail.push({ d: dist, t: now() });
          if (trail.length > 14) trail.shift();
        }
        if (dist >= map.track) {
          done = true;
          setBanner(map.finishBanner, 'good');
          beep('cash');
          setTimeout(win, 420);
        }
      },
      draw: function (c, w, h) {
        var S = BH_SCALE, i, r;
        var T = map.theme;
        var me = bhPathAt(map, dist);
        var playerY = h * 0.66;              // sit low so the run reads forward
        // World -> screen. Rounded, because a half-pixel wall edge on flat
        // radar art is exactly the blur this style cannot afford.
        function sx(wx) { return Math.round(w / 2 + (wx - camX) * S); }
        function sy(wy) { return Math.round(playerY + (wy - me.y) * S); }

        /* ---- the structure: the negative space the route is cut out of.
           Deliberately darker than every walkable surface. Nuke's first pass
           made the roof deck and the outdoor concrete near-identical greys and
           the route stopped reading as a route at all — and Dust 2 would hit
           that harder still, since its real walls and floors are the same
           sandstone (see the theme comment on the map). */
        px(c, 0, 0, w, h, T.mass);                          // structure mass
        var CELL = 130;                                     // roof detail grid
        var wx0 = camX - (w / 2) / S, wy0 = me.y - (playerY) / S;
        var gi0 = Math.floor(wx0 / CELL), gj0 = Math.floor(wy0 / CELL);
        var cols = Math.ceil(w / S / CELL) + 2, rows = Math.ceil(h / S / CELL) + 2;
        for (var gi = 0; gi < cols; gi++) {
          for (var gj = 0; gj < rows; gj++) {
            var ci = gi0 + gi, cj = gj0 + gj;
            var bx = sx(ci * CELL), by = sy(cj * CELL), cs = CELL * S;
            px(c, bx, by, cs, 2, T.seam);                  // slab seams
            px(c, bx, by, 2, cs, T.seam);
            var rnd = bhHash(ci, cj);
            if (T.detail === 'nuke') {
              /* Cedar Creek's roofs are covered in round silver ventilation
                 cowls, with the odd plant room between them. */
              if (rnd > 0.72) {                            // ventilation cowl
                var vx = bx + 18 + (rnd * 100 % 30), vy = by + 16 + (rnd * 313 % 34);
                px(c, vx, vy, 26, 20, '#A8ACAE');
                px(c, vx + 2, vy + 2, 22, 12, '#C6CACC');
                px(c, vx + 4, vy + 14, 18, 4, '#6E7274');
              } else if (rnd < 0.10) {                     // roof plant / duct
                px(c, bx + 22, by + 26, 44, 22, '#9CA09A');
                px(c, bx + 22, by + 26, 44, 4, '#B6BAB4');
              }
            } else {
              /* Dust 2 from above is a flat-roofed sandstone TOWN, and the
                 old pass drew it as one flat ochre field with the odd blob
                 dropped on it — which is most of why the owner said the map
                 looked awful. Every cell is now a BUILDING BLOCK in its own
                 right: its own ochre out of three, a parapet catching the sun
                 on the north-west edges and dropping shade on the south-east
                 ones, and only then the courtyard / awning / dome / beams on
                 top. The seam drawn just above survives as the 2px alley
                 between blocks, so the roofscape reads as separate buildings
                 rather than as texture on one slab. */
              var rHash = bhHash(ci + 31, cj + 17);
              px(c, bx + 2, by + 2, cs - 4, cs - 4,
                 rHash < 0.30 ? '#77654B' : rHash < 0.62 ? '#6B5B42' : '#5F513B');
              px(c, bx + 4, by + 4, cs - 8, 3, '#83704F');       // sunlit parapet
              px(c, bx + 4, by + 4, 3, cs - 8, '#83704F');
              px(c, bx + 4, by + cs - 10, cs - 8, 5, '#4C4030');  // parapet in shade
              px(c, bx + cs - 10, by + 4, 5, cs - 8, '#4C4030');
              if (rnd > 0.80) {                            // small dome
                var dcx = bx + 24 + (rnd * 100 % 24), dcy = by + 24 + (rnd * 313 % 28);
                c.beginPath(); c.arc(dcx, dcy, 15, 0, Math.PI * 2);
                c.fillStyle = '#3E4C5E'; c.fill();
                c.beginPath(); c.arc(dcx, dcy, 11, 0, Math.PI * 2);
                c.fillStyle = '#55708C'; c.fill();
                c.beginPath(); c.arc(dcx, dcy, 4, 0, Math.PI * 2);
                c.fillStyle = '#C9A648'; c.fill();
              } else if (rnd < 0.16) {                     // courtyard cut into the block
                px(c, bx + 18, by + 22, 54, 42, '#3F361F');       // the shaft, in shadow
                px(c, bx + 21, by + 25, 48, 36, '#86734F');       // its floor, in a light well
                px(c, bx + 21, by + 25, 48, 6, '#5A4B36');        // north wall's shadow
                px(c, bx + 18, by + 22, 54, 3, '#907C5B');        // the lit lip
              } else if (rnd > 0.44 && rnd < 0.54) {       // cloth awning over the street
                px(c, bx + 24, by + 32, 44, 5, '#3F3524');        // what it casts
                px(c, bx + 24, by + 28, 44, 16, '#A85B36');
                px(c, bx + 24, by + 28, 44, 4, '#C87A4E');
                px(c, bx + 33, by + 28, 8, 16, '#E0C49A');        // the cream stripe
                px(c, bx + 52, by + 28, 8, 16, '#E0C49A');
              } else if (rnd > 0.62 && rnd < 0.70) {       // exposed roof beams
                for (var jb = 0; jb < 4; jb++)
                  px(c, bx + 20, by + 26 + jb * 11, 46, 5, '#8A6C42');
                px(c, bx + 18, by + 24, 4, 48, '#5E4A2C');
              } else if (rnd > 0.24 && rnd < 0.31) {       // rubble on a broken roof
                for (var db = 0; db < 9; db++) {
                  var d1 = bhHash(ci * 13 + db, cj * 7), d2 = bhHash(cj * 11 + db, ci * 5);
                  px(c, bx + 18 + d1 * 44, by + 22 + d2 * 44, 4 + (d1 > 0.7 ? 3 : 0), 4,
                     d2 > 0.5 ? '#7E6C4E' : '#544732');
                }
              }
            }
          }
        }
        /* The landmark beyond the finish, so arriving somewhere LOOKS like
           arriving somewhere. Both sit past the last waypoint and come into
           view only on the final approach. Nuke's was first placed west of the
           route, where MAIN's floor paints straight over it, and it never
           appeared once — keep these beyond the finish, not beside it. */
        if (T.backdrop === 'cedar') {
          // the Cedar Creek plant: pale facade, blue service band
          var bandX = sx(380), bandW = 780 * S;
          px(c, bandX, sy(4), bandW, 86 * S, '#E4E8EA');
          px(c, bandX, sy(38), bandW, 32 * S, '#3D8FC4');
          px(c, bandX, sy(66), bandW, 7 * S, '#2A6C99');
          px(c, bandX, sy(86), bandW, 5 * S, '#9DA1A3');
        } else {
          /* The great blue-and-gold dome from the reference shots, seen from
             directly above as concentric rings. It sits behind A site, so it
             rises over the site wall exactly as the player takes the last
             stretch of Long. */
          var domeX = sx(650), domeY = sy(-90), domeR = 230 * S;
          if (domeY > -domeR - 60) {
            var ring = [[1.00, '#2E3A48'], [0.94, '#6E7A66'], [0.86, '#2F4A66'],
                        [0.62, '#3E628A'], [0.34, '#5A82AC'], [0.12, '#C9A648']];
            for (i = 0; i < ring.length; i++) {
              c.beginPath();
              c.arc(domeX, domeY, domeR * ring[i][0], 0, Math.PI * 2);
              c.fillStyle = ring[i][1]; c.fill();
            }
            // the gold ribs that run down the dome, foreshortened to spokes
            c.strokeStyle = '#C9A648'; c.lineWidth = 2;
            for (var rib = 0; rib < 16; rib++) {
              var ra = rib / 16 * Math.PI * 2;
              c.beginPath();
              c.moveTo(domeX + Math.cos(ra) * domeR * 0.14, domeY + Math.sin(ra) * domeR * 0.14);
              c.lineTo(domeX + Math.cos(ra) * domeR * 0.84, domeY + Math.sin(ra) * domeR * 0.84);
              c.stroke();
            }
          }
        }

        /* ---- floors. Drawn twice: a dark lip inflated by the wall thickness,
           then the exact surface on top. The second pass buries every shared
           internal edge, so a pile of overlapping rects comes out with one
           clean kerb around their union — no polygon union maths needed. */
        var WALL = 8;
        var SURF = T.surf;
        /* Wall THICKNESS, for any map that asks for it. The kerb on its own is
           a painted outline: it tells you where the floor stops but the walls
           have no mass. This pass lays the same inflated rect down first,
           offset south-east by the light direction the roofscape parapets
           already use, so a dark lip survives on the far side of every kerb
           and the buildings sit ON the ground instead of being cut out of it.
           Whole pass runs before ANY kerb, or one room's shadow would fall
           across its neighbour's wall. Nuke declares no T.shadow and comes out
           byte-identical to before. */
        if (T.shadow) {
          for (i = 0; i < map.rooms.length; i++) {
            r = map.rooms[i];
            px(c, sx(r[0]) - WALL + 5, sy(r[1]) - WALL + 6,
               r[2] * S + WALL * 2, r[3] * S + WALL * 2, T.shadow);
          }
        }
        for (i = 0; i < map.rooms.length; i++) {
          r = map.rooms[i];
          // Kerb lighter than the mass: it reads as a low wall catching the sun,
          // and gives the walkable area a continuous edge at any speed.
          px(c, sx(r[0]) - WALL, sy(r[1]) - WALL,
             r[2] * S + WALL * 2, r[3] * S + WALL * 2, T.kerb);
        }
        for (i = 0; i < map.rooms.length; i++) {
          r = map.rooms[i];
          px(c, sx(r[0]), sy(r[1]), r[2] * S, r[3] * S, SURF[r[4]]);
        }

        /* Everything below is painted ON the ground, so it is clipped to the
           floor union — otherwise hatching and crates spill onto roofs. */
        c.save();
        c.beginPath();
        for (i = 0; i < map.rooms.length; i++) {
          r = map.rooms[i];
          c.rect(sx(r[0]), sy(r[1]), r[2] * S, r[3] * S);
        }
        c.clip();

        /* ---- GROUND TEXTURE ------------------------------------------------
           The single biggest reason Dust 2 read as "flat tan rectangles": the
           surfaces were one flat fill each, and the real map is flagstone,
           cobble and blown sand. Painted per ROOM, so each surface gets the
           treatment that belongs to it, and each room clips its own grid —
           without that, an edge tile of paving spills into the sand room next
           door and the two surfaces stop being distinguishable at all.

           Every tone here is deliberately inside the same luminance band as
           the surf[] colour it sits on (measured 141–201 against a structure
           mass of 92.6), so the texture cannot quietly undo the structure /
           surface separation the suite asserts.

           Driven by bhHash, NEVER Math.random: this runs at 60fps, and a
           scatter re-rolled per frame boils. Only the tiles the camera can
           actually see are stepped, so cost is bounded by the viewport rather
           than by the size of the map. */
        if (T.ground === 'sand') {
          var vx0 = camX - (w / 2) / S, vx1 = camX + (w / 2) / S;
          var vy0 = me.y - playerY / S, vy1 = me.y + (h - playerY) / S;
          for (i = 0; i < map.rooms.length; i++) {
            r = map.rooms[i];
            var rx0 = Math.max(r[0], vx0), rx1 = Math.min(r[0] + r[2], vx1);
            var ry0 = Math.max(r[1], vy0), ry1 = Math.min(r[1] + r[3], vy1);
            if (rx1 <= rx0 || ry1 <= ry0) continue;
            // 0 sand drift, 1 flagstone, 2 cobble — coarse to fine, which is
            // also how a real yard, a laid platform and a shaded alley differ.
            var kind = r[4], pitch = kind === 1 ? 46 : kind === 2 ? 30 : 92;
            c.save();
            c.beginPath();
            c.rect(sx(r[0]), sy(r[1]), r[2] * S, r[3] * S);
            c.clip();
            var tI0 = Math.floor(rx0 / pitch), tI1 = Math.floor(rx1 / pitch);
            var tJ0 = Math.floor(ry0 / pitch), tJ1 = Math.floor(ry1 / pitch);
            for (var tI = tI0; tI <= tI1; tI++) {
              for (var tJ = tJ0; tJ <= tJ1; tJ++) {
                var tH = bhHash(tI + kind * 97, tJ - kind * 53);
                var gX = sx(tI * pitch), gY = sy(tJ * pitch), gS = pitch * S;
                if (kind === 1) {
                  // laid flagstone: three near-tones so no two neighbours
                  // match, and a seam on TWO edges only — a full grid of seams
                  // reads as graph paper, not as stone
                  px(c, gX, gY, gS, gS,
                     tH < 0.34 ? '#D2BF93' : tH < 0.70 ? '#DCCBA3' : '#CBB88C');
                  px(c, gX, gY, gS, 2, '#B29F77');
                  px(c, gX, gY, 2, gS, '#B29F77');
                  if (tH > 0.94) px(c, gX + gS * 0.34, gY + gS * 0.18, 2, gS * 0.62, '#B29F77');
                } else if (kind === 2) {
                  // cobble in the shade, mortar showing between the stones
                  px(c, gX + 1, gY + 1, gS - 2, gS - 2, tH < 0.5 ? '#B0966C' : '#A68D64');
                  px(c, gX + 1, gY + 1, gS - 2, 2, '#B79D71');
                } else {
                  /* Blown sand. The broad patch comes FIRST and covers most of
                     the cell: measured on the finished frame, drifts alone left
                     the raw surf[0] fill holding 34% of the screen as one flat
                     tone, which is the exact "flat tan rectangle" the owner
                     called out. The patch breaks that field up; the drift and
                     the grit are the detail on top of it. */
                  px(c, gX, gY, gS * 0.86, gS * 0.9,
                     tH < 0.33 ? '#C8AC7E' : tH < 0.66 ? '#BFA375' : '#CBB083');
                  var dX = gX + gS * bhHash(tJ, tI) * 0.42;
                  var dY = gY + gS * bhHash(tI + 7, tJ + 3) * 0.70;
                  px(c, dX, dY, gS * (0.46 + tH * 0.46), gS * (0.11 + tH * 0.15),
                     tH > 0.5 ? '#CFB489' : '#BCA073');
                  px(c, dX, dY, gS * (0.46 + tH * 0.46), 2, '#D9C099');
                  px(c, gX + gS * bhHash(tI * 3, tJ * 5), gY + gS * bhHash(tJ * 3, tI * 5),
                     3, 3, '#AE9668');
                }
              }
            }
            c.restore();
          }
        }

        // ---- ground props ----
        for (i = 0; i < map.props.length; i++) {
          var P = map.props[i];
          var ax = sx(P.x), ay = sy(P.y), aw = P.w * S, ah = P.h * S;
          if (ay > h + 80 || ay + ah < -80) continue;      // off-camera
          if (P.t === 'hatch') {                            // yellow hazard hatching
            for (var k = 0; k < aw + ah; k += 16) {
              c.save(); c.beginPath(); c.rect(ax, ay, aw, ah); c.clip();
              c.strokeStyle = '#D8AC33'; c.lineWidth = 5;
              c.beginPath(); c.moveTo(ax + k, ay); c.lineTo(ax + k - ah, ay + ah); c.stroke();
              c.restore();
            }
          } else if (P.t === 'bay') {                       // painted parking bay
            px(c, ax, ay, aw, 4, '#D8AC33');
            px(c, ax, ay + ah - 4, aw, 4, '#D8AC33');
            px(c, ax, ay, 4, ah, '#D8AC33');
            px(c, ax + aw - 4, ay, 4, ah, '#D8AC33');
          } else if (P.t === 'curb') {                      // kerb stripe
            px(c, ax, ay, aw, ah * S > 2 ? ah : 5, '#D8AC33');
          } else if (P.t === 'cont') {                      // shipping container
            px(c, ax, ay, aw, ah, '#A64F2B');
            px(c, ax, ay, aw, 4, '#C8683C');                // lit top edge
            px(c, ax, ay + ah - 5, aw, 5, '#7B3720');       // shadow side
            for (var rb = 6; rb < aw - 4; rb += 9) px(c, ax + rb, ay + 5, 3, ah - 11, '#8F4324');
          } else if (P.t === 'truck') {                     // the red delivery truck
            px(c, ax, ay, aw, ah, '#B8352E');
            px(c, ax, ay + ah * 0.62, aw, ah * 0.38, '#E4E6E4');   // white cab
            px(c, ax + 3, ay + 6, aw - 6, ah * 0.5, '#8E2622');
            px(c, ax - 4, ay + 10, 5, 16, '#22242A');              // wheels
            px(c, ax + aw - 1, ay + 10, 5, 16, '#22242A');
            px(c, ax - 4, ay + ah - 30, 5, 16, '#22242A');
            px(c, ax + aw - 1, ay + ah - 30, 5, 16, '#22242A');
          } else if (P.t === 'pipe') {                      // silver pipe run
            px(c, ax, ay, aw, ah, '#9AA0A4');
            px(c, ax + aw * 0.18, ay, aw * 0.34, ah, '#D2D7DA');   // specular
            px(c, ax, ay, 3, ah, '#6E7478');
            for (var jt = 0; jt < ah; jt += 46) px(c, ax - 3, ay + jt, aw + 6, 7, '#B4BABE');
          } else if (P.t === 'crate') {                     // Dust 2 wooden crate
            px(c, ax, ay, aw, ah, '#3A2E1C');               // dark rim
            px(c, ax + 2, ay + 2, aw - 4, ah - 4, '#A87B44');
            px(c, ax + 2, ay + 2, aw - 4, 4, '#C2924F');    // lit top edge
            px(c, ax + 2, ay + ah - 7, aw - 4, 5, '#7E5A31');
            // plank seams, and the diagonal brace the real crates carry
            for (var pk = 10; pk < ah - 6; pk += 13) px(c, ax + 3, ay + pk, aw - 6, 2, '#8A6436');
            c.save(); c.beginPath(); c.rect(ax + 3, ay + 3, aw - 6, ah - 6); c.clip();
            c.strokeStyle = '#8A6436'; c.lineWidth = 3;
            c.beginPath(); c.moveTo(ax, ay + ah); c.lineTo(ax + aw, ay); c.stroke();
            c.restore();
          } else if (P.t === 'barrel') {                    // oil drum, from above
            var br = aw / 2, bcx = ax + br, bcy = ay + br;
            var bcol = P.v ? '#2E5F8A' : '#A85A2E';         // blue / rust, both on site
            var blit = P.v ? '#4C82AE' : '#C87A44';
            c.beginPath(); c.arc(bcx, bcy, br, 0, Math.PI * 2);
            c.fillStyle = '#2A2118'; c.fill();
            c.beginPath(); c.arc(bcx, bcy, br - 2, 0, Math.PI * 2);
            c.fillStyle = bcol; c.fill();
            c.beginPath(); c.arc(bcx, bcy, br * 0.62, 0, Math.PI * 2);
            c.fillStyle = blit; c.fill();                   // the lid, catching light
            c.beginPath(); c.arc(bcx, bcy, br * 0.22, 0, Math.PI * 2);
            c.fillStyle = '#241C14'; c.fill();              // bung
          } else if (P.t === 'car') {                       // the beige car at A
            px(c, ax, ay, aw, ah, '#2A2620');               // shadow / tyres
            px(c, ax + 3, ay + 6, aw - 6, ah - 12, '#C9BC96');
            px(c, ax + 3, ay + 6, aw - 6, 4, '#DCD0AC');    // lit edge
            px(c, ax + 7, ay + ah * 0.20, aw - 14, ah * 0.16, '#3E4A52');  // windscreen
            px(c, ax + 7, ay + ah * 0.62, aw - 14, ah * 0.15, '#3E4A52');  // rear glass
            px(c, ax + 8, ay + ah * 0.38, aw - 16, ah * 0.22, '#B3A783');  // roof
            px(c, ax - 2, ay + ah * 0.16, 6, 16, '#1E1A16');               // wheels
            px(c, ax + aw - 4, ay + ah * 0.16, 6, 16, '#1E1A16');
            px(c, ax - 2, ay + ah * 0.70, 6, 16, '#1E1A16');
            px(c, ax + aw - 4, ay + ah * 0.70, 6, 16, '#1E1A16');
          } else if (P.t === 'pallet') {                    // tarp over a pallet
            px(c, ax, ay, aw, ah, '#4A443A');
            px(c, ax + 2, ay + 2, aw - 4, ah - 4, '#8A8C86');
            px(c, ax + 2, ay + 2, aw - 4, 4, '#A2A49E');
            for (var pl = 8; pl < aw - 4; pl += 12) px(c, ax + pl, ay + 3, 3, ah - 7, '#767871');
          } else if (P.t === 'rubble') {                    // loose stone scatter
            for (var rr = 0; rr < 18; rr++) {
              var h1 = bhHash(P.x + rr * 7, P.y + rr * 13);
              var h2 = bhHash(P.y + rr * 5, P.x + rr * 11);
              var rw = 3 + Math.floor(h1 * 6);
              // A third tone, and a 1px dark side on the bigger pieces: a
              // two-tone scatter of identical squares reads as static.
              px(c, ax + h1 * (aw - rw), ay + h2 * (ah - rw) + 1, rw, rw, '#6E5C3E');
              px(c, ax + h1 * (aw - rw), ay + h2 * (ah - rw), rw, rw,
                 h2 > 0.66 ? '#C0AB80' : h2 > 0.33 ? '#A98F62' : '#8C7750');
            }
          } else if (P.t === 'arch') {
            /* A doorway punched through a wall, seen from directly above: the
               dark throat of the opening, a stone jamb either side of it, and
               the threshold you would step over. Clipped to the floor union
               like every prop, so only the part standing inside the room
               survives — which is exactly the part this camera can see. */
            px(c, ax, ay, aw, ah, '#4A3D2B');               // the opening
            px(c, ax, ay, aw, 4, '#33291C');                // its far lip, in shadow
            px(c, ax, ay + ah - 6, aw, 6, '#6E5F44');       // the threshold stone
            px(c, ax, ay, 11, ah, '#C4AC7C');               // sunlit jamb
            px(c, ax, ay, 11, 4, '#DCC79A');
            px(c, ax + aw - 11, ay, 11, ah, '#9A855C');     // shaded jamb
          } else if (P.t === 'awning') {
            /* Cloth stretched over a doorway, striped the way the map's own
               are. The cast shadow underneath is what stops it looking like a
               sticker lying flat on the sand. */
            px(c, ax + 5, ay + ah - 3, aw - 6, 11, '#7A6845');
            px(c, ax, ay, aw, ah, '#7E3E28');               // the shaded underside
            px(c, ax, ay, aw, ah - 7, '#C06A42');
            for (var awS = 4; awS < aw - 8; awS += 15) px(c, ax + awS, ay, 7, ah - 7, '#E0C49A');
            px(c, ax, ay, aw, 4, '#D88A5E');                // the lit ridge
            for (var awD = 4; awD < aw - 8; awD += 15) px(c, ax + awD, ay + ah - 7, 7, 7, '#5E3020');
          } else if (P.t === 'steps') {
            /* Shallow stone steps. Five treads with a lit nosing on each —
               the nosings are the whole read at this scale, since from
               straight above a step is otherwise indistinguishable from a
               painted line. */
            var stN = 5, stH = ah / stN;
            for (var stI = 0; stI < stN; stI++) {
              var stY = ay + stI * stH;
              px(c, ax, stY, aw, stH, stI % 2 ? '#CDBA8E' : '#D8C69C');
              px(c, ax, stY, aw, 3, '#EFE0BC');             // nosing, catching the sun
              px(c, ax, stY + stH - 4, aw, 4, '#9E8A64');   // riser, in its own shade
            }
            px(c, ax, ay, 4, ah, '#8E7A54');                // the open ends
            px(c, ax + aw - 4, ay, 4, ah, '#8E7A54');
          }
        }

        // ---- the round landmark: Nuke's steel tank, Dust 2's stone well ----
        var F = map.feature;
        var sxo = sx(F.x), syo = sy(F.y), sr = F.r * S;
        if (syo > -sr - 40 && syo < h + sr + 40) {
          if (F.kind === 'silo') {
            c.beginPath(); c.arc(sxo, syo, sr, 0, Math.PI * 2); c.fillStyle = '#7E8386'; c.fill();
            c.beginPath(); c.arc(sxo, syo, sr - 3, 0, Math.PI * 2); c.fillStyle = '#BFC4C7'; c.fill();
            for (var ri = 0; ri < 24; ri++) {              // vertical ribs, from above
              var a2 = ri / 24 * Math.PI * 2;
              c.strokeStyle = '#9DA3A7'; c.lineWidth = 2;
              c.beginPath();
              c.moveTo(sxo + Math.cos(a2) * (sr - 4), syo + Math.sin(a2) * (sr - 4));
              c.lineTo(sxo + Math.cos(a2) * (sr * 0.55), syo + Math.sin(a2) * (sr * 0.55));
              c.stroke();
            }
            c.beginPath(); c.arc(sxo, syo, sr * 0.55, 0, Math.PI * 2); c.fillStyle = '#D4D9DC'; c.fill();
            c.beginPath(); c.arc(sxo, syo, sr * 0.18, 0, Math.PI * 2); c.fillStyle = '#8E9498'; c.fill();
          } else {
            // sandstone rim, laid course by course, around dark standing water
            c.beginPath(); c.arc(sxo, syo, sr, 0, Math.PI * 2); c.fillStyle = '#6E5C3E'; c.fill();
            c.beginPath(); c.arc(sxo, syo, sr - 3, 0, Math.PI * 2); c.fillStyle = '#C6AE7E'; c.fill();
            c.strokeStyle = '#9A8256'; c.lineWidth = 2;
            for (var bi = 0; bi < 18; bi++) {              // the courses of the rim
              var ba = bi / 18 * Math.PI * 2;
              c.beginPath();
              c.moveTo(sxo + Math.cos(ba) * (sr - 4), syo + Math.sin(ba) * (sr - 4));
              c.lineTo(sxo + Math.cos(ba) * (sr * 0.66), syo + Math.sin(ba) * (sr * 0.66));
              c.stroke();
            }
            c.beginPath(); c.arc(sxo, syo, sr * 0.66, 0, Math.PI * 2); c.fillStyle = '#8A7450'; c.fill();
            c.beginPath(); c.arc(sxo, syo, sr * 0.52, 0, Math.PI * 2); c.fillStyle = '#2E3A38'; c.fill();
            c.beginPath(); c.arc(sxo - sr * 0.16, syo - sr * 0.16, sr * 0.14, 0, Math.PI * 2);
            c.fillStyle = '#47585A'; c.fill();             // one glint on the water
          }
        }

        // ---- the route, scuffed along the ground as chevrons ----
        var step = 150;
        for (var d = Math.floor(dist / step) * step; d < dist + 1400; d += step) {
          if (d <= dist + 120 || d > map.track - 60) continue;   // clear the sprite
          var q = bhPathAt(map, d);
          c.save();
          c.translate(sx(q.x), sy(q.y));
          c.rotate(q.ang + Math.PI / 2);       // chevrons point along the route
          c.globalAlpha = 0.9;
          px(c, -2, -9, 5, 20, T.route);
          px(c, -11, -3, 9, 5, T.route);
          px(c, 3, -3, 9, 5, T.route);
          c.globalAlpha = 1;
          c.restore();
        }

        // ---- the finish line, across the last room ----
        var fy = sy(map.path[map.path.length - 1][1] + 40);
        if (fy > -20 && fy < h + 20) {
          for (var fx = sx(map.finishSpan[0]); fx < sx(map.finishSpan[1]); fx += 26) {
            px(c, fx, fy - 6, 13, 12, '#E8E8E4');
            px(c, fx + 13, fy - 6, 13, 12, '#22242A');
          }
        }
        c.restore();

        // ---- callouts, as the chips the game itself draws over the world ----
        for (i = 0; i < map.labels.length; i++) {
          var L = map.labels[i];
          var lx = sx(L[1]), ly = sy(L[2]);
          if (ly < -20 || ly > h + 20) continue;
          var lw = L[0].length * L[3] * 0.62 + 16;
          c.globalAlpha = 0.55;
          px(c, lx - lw / 2, ly - L[3] * 0.85, lw, L[3] * 1.7, '#15181C');
          c.globalAlpha = 1;
          pixelText(c, L[0], lx, ly, L[3], '#FFFFFF', 'center');
        }

        // ---- motion trails above 350 u/s ----
        for (i = 0; i < trail.length; i++) {
          var q2 = bhPathAt(map, trail[i].d);
          c.globalAlpha = (i / trail.length) * 0.34;
          px(c, sx(q2.x) - 7, sy(q2.y) - 7, 14, 14, '#7FA8C9');
          c.globalAlpha = 1;
        }

        // ---- the player: the top-down operator sprite, tilted by the strafe.
        // The tilt pivots on his torso (BH_SPRITE_PIVOT_ROW), not on the grid
        // centre, so a strafe swings the body instead of waving the muzzle.
        c.save();
        c.translate(sx(me.x), sy(me.y));
        c.rotate(tilt * Math.PI / 180);
        bhDrawPlayer(c);
        c.restore();

        // ---- speedometer, top-centre ----
        var sw = 132, sx = (w - sw) / 2;
        px(c, sx, 8, sw, 26, '#141820');
        px(c, sx, 8, sw, 2, '#000000');
        var fast = speed > 350;
        pixelText(c, Math.round(speed) + ' u/s', sx + sw / 2, 21, 14,
          fast ? '#7FE3B0' : (speed > 260 ? '#FFD54A' : '#E8E8E8'), 'center');

        // ---- rhythm bar: the marker sweeps across and back, never wraps ----
        var rbW = w * 0.76, rbX = (w - rbW) / 2, rbY = h - 54, rbH = 18;
        px(c, rbX - 2, rbY - 2, rbW + 4, rbH + 4, '#000000');
        px(c, rbX, rbY, rbW, rbH, '#141820');
        var gW = rbW * BH_GREEN * 2;
        px(c, rbX + rbW / 2 - gW / 2, rbY, gW, rbH, '#2E6E4A');
        px(c, rbX + rbW / 2 - 1, rbY, 2, rbH, '#7FE3B0');
        // travel arrows either side of the marker, so the direction of the
        // sweep — which IS the side to tap — is readable at a glance
        var mkX = rbX + markerPos() * rbW, dirR = sweepDir() > 0;
        px(c, mkX - 3, rbY - 5, 6, rbH + 10, lastHitGood ? '#FFFFFF' : '#FFD54A');
        var arrX = mkX + (dirR ? 10 : -16);
        px(c, arrX, rbY + rbH / 2 - 2, 6, 4, '#FFD54A');
        px(c, arrX + (dirR ? 5 : 1), rbY + rbH / 2 - 5, 3, 10, '#FFD54A');
        pixelText(c, dirR ? 'TAP RIGHT' : 'TAP LEFT', w / 2, rbY - 18, 11, '#E8E2D0', 'center');

        // ---- intro: the map name, then the big translucent A / D ----
        if (now() < introUntil) {
          px(c, 0, 0, w, h, 'rgba(10,12,18,0.55)');
          // Which map you drew is the first thing worth knowing, and with two
          // routes it is no longer obvious from the first frame alone.
          pixelText(c, map.name, w / 2, h * 0.26, 26, '#FFFFFF', 'center');
          pixelText(c, map.leg, w / 2, h * 0.32, 12, '#E8C87A', 'center');
          var blink = (Math.floor(now() / 180) % 2) === 0;
          c.globalAlpha = blink ? 0.95 : 0.45;
          pixelText(c, 'A', w * 0.25, h * 0.47, 92, '#FFFFFF', 'center');
          pixelText(c, 'D', w * 0.75, h * 0.47, 92, '#FFFFFF', 'center');
          c.globalAlpha = 1;
          pixelText(c, 'ALTERNATE TAPS ON THE BEAT', w / 2, h * 0.63, 12, '#E8E2D0', 'center');
        }
      }
    };
  }

  /* ---------------------------------------------------------------- rotation */
  var BUILDERS = { awp: makeAwp, spray: makeSpray, bhop: makeBhop };
  var IDS = ['awp', 'spray', 'bhop'];

  function pickGame() {
    var pool = IDS.filter(function (id) { return id !== lastGameId; });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startGame(id) {
    lastGameId = id;
    game = BUILDERS[id]();
    barLabel.textContent = 'MATCH IN PROGRESS';
  }

  /* ------------------------------------------------------------------ API */
  G.MatchGames = {
    MATCH_MS: MATCH_MS,

    /* run(cb) — opens the overlay and calls cb({won}) once the match resolves,
       whether by a win, a QUIT, or the master timer running out. The caller
       (js/main.js) already holds the ELO result and simply shows it after. */
    run: function (cb) {
      build();
      onDone = cb || null;
      resolved = false;
      frozenElapsed = null;
      active = true;
      startedAt = now();
      lastTs = 0;
      clearButtons(); setBanner('');
      root.classList.add('mg-match--open');
      sizeCanvas();
      startGame(pickGame());
      renderBar();
      rafId = requestAnimationFrame(loop);
    },

    isOpen: function () { return active; },

    // Measurable handle for verification — which game is up, and the clock.
    __probe: function () {
      return {
        open: active, resolved: resolved, gameId: lastGameId,
        elapsedMs: active ? elapsed() : 0, remainingMs: active ? remaining() : 0,
        hasButtons: !!(buttonRow && buttonRow.children.length),
        game: (game && game.probe) ? game.probe() : null
      };
    },

    // Test seam: force a specific game rather than the random pick.
    __force: function (id) { if (BUILDERS[id]) { startGame(id); return true; } return false; },

    /* Test seam: the bhop map table itself, with each route's derived segments
       and track length. The suite asserts the tuning holds for EVERY map
       rather than regexing one hard-coded route out of the source, so adding a
       third map is covered the moment it is added. */
    __maps: function () { return BH_MAPS; },

    /* Test seam: the AWP angle table plus the two helpers every angle is
       composed against. Same reasoning as __maps — the thing worth asserting
       about an angle is that its enemy is actually OCCLUDED at the start of
       his peek, and that can only be measured by rendering the angle into a
       recording context, never by regexing the source. A third angle is
       covered the day it is added. */
    __awp: function () {
      return { angles: AWP_ANGLES, scene: awpScene, enemy: awpEnemy };
    },

    __win: win,
    __fail: fail
  };
})(window.Game = window.Game || {});
