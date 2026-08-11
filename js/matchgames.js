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
     Holding mid doors on Dust 2. A CT crosses the gap after a random delay;
     you have 300ms. Tapping before the peek is an early-shot loss, which is
     what stops "hold the finger down and win" — the whole game is the wait.
     ====================================================================== */
  function makeAwp() {
    var STATE_WAIT = 0, STATE_PEEK = 1, STATE_OVER = 2;
    var state = STATE_WAIT;
    var peekAt = now() + 1500 + Math.random() * 2000;   // owner spec: 1.5–3.5s
    var peekedAt = 0;
    var flashUntil = 0;
    var killfeedUntil = 0;
    var reactionMs = 0;

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
      probe: function () { return { state: state, sincePeek: state >= STATE_PEEK ? now() - peekedAt : -1, reactionMs: reactionMs }; },
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
      /* The composition is the owner's reference shot: mid doors on Dust 2 down
         an AWP scope. Arched double doors filling the top, a narrow bright gap
         between them, sunlit stone slabs in the bottom third, and the whole
         thing behind a big black scope vignette with thin crosshair lines.
         Everything is flat rects on a 6-12px grid so it stays pixel art. */
      draw: function (c, w, h) {
        var doorBottom = h * 0.52;                          // doors meet floor
        // The gap is centred on the scope, so the crosshair sits exactly on the
        // slice of light the CT walks through. You are holding that angle —
        // the reticle belongs on it, not off to one side of it.
        var gapW = Math.round(w * 0.12);
        var gapX = Math.round(w / 2 - gapW / 2);

        var i, x;

        /* ---- the doors, drawn SOLID across the whole frame ----
           An earlier pass punched the gap by skipping plank columns, but planks
           are 12px and the gap is 50, so the opening snapped out to whatever
           the column grid allowed — 72px, half again too wide. The doors are
           now continuous and the view through them is clipped to an exact
           rect below, which also means the gap width is a real number rather
           than a consequence of the plank pitch. */
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
        if (state === STATE_PEEK || (state === STATE_OVER && killfeedUntil > now())) {
          var t = clamp((now() - peekedAt) / 900, 0, 1);
          var cx = gapX - 14 + t * gapW;
          var cy = doorBottom - 108;
          px(c, cx, cy + 16, 26, 46, '#3D4038');            // torso / vest
          px(c, cx + 2, cy + 22, 22, 12, '#2B2E28');        // chest rig
          px(c, cx + 6, cy, 15, 17, '#4B4D43');             // head
          px(c, cx + 4, cy - 4, 19, 7, '#33352E');          // helmet
          px(c, cx - 7, cy + 24, 9, 22, '#35382F');         // near arm
          px(c, cx - 14, cy + 30, 20, 5, '#1D1E1B');        // rifle
          px(c, cx + 3, cy + 62, 10, 24, '#2A2C25');        // legs
          px(c, cx + 15, cy + 62, 10, 24, '#2A2C25');
          px(c, cx + 1, cy + 86, 26, 5, '#191A17');         // contact shadow
        }
        c.restore();

        // the two door edges facing the gap: bright rim, then shadow
        px(c, gapX - 6, 0, 6, doorBottom, '#A88B5C');
        px(c, gapX - 10, 0, 4, doorBottom, '#4E4030');
        px(c, gapX + gapW, 0, 6, doorBottom, '#3E3323');
        px(c, gapX + gapW + 6, 0, 4, doorBottom, '#9C8154');

        /* ---- the arch above the doors, stepped 6px so it reads as pixels ----
           Tuned so the crown lands just inside the TOP of the scope circle.
           Geometry that peaks above the circle is invisible: everything
           outside the lens is painted flat black a few lines further down. */
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

        // ---- scope: black vignette with a circular cut, then the reticle ----
        var cxs = w / 2, cys = h * 0.46, R = w * 0.495;
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

        if (state === STATE_WAIT) {
          pixelText(c, 'HOLD THE ANGLE', w / 2, h - 26, 12, '#E8E2D0', 'center');
        }
      }
    };
  }

  /* ======================================================================
     MINIGAME 2 — AK-47 SPRAY CONTROL
     Hold to fire 30 rounds; drag along the dotted guide to cancel the recoil.
     A shot counts as a hit when the player's drag is close to the INVERSE of
     the recoil at that round — i.e. they are pulling against it. 80% hits
     wins, per the owner spec.
     ====================================================================== */
  // The classic AK-47 pattern, normalised: up hard, then right, then a left
  // sweep. Stored as the muzzle's climb so the guide and the scoring share
  // one source — a second copy is how a guide ends up lying about the test.
  var AK_PATTERN = [
    [0, 0], [0, -22], [0, -44], [1, -66], [3, -86], [6, -104], [10, -119], [14, -131],
    [18, -140], [22, -147], [24, -152], [20, -156], [12, -159], [2, -161], [-9, -163],
    [-20, -164], [-30, -165], [-38, -166], [-42, -167], [-40, -168], [-33, -169],
    [-23, -170], [-11, -171], [1, -172], [13, -173], [24, -174], [32, -175],
    [37, -176], [39, -177], [38, -178]
  ];
  var AK_ROUNDS = AK_PATTERN.length;      // 30
  var AK_SHOT_MS = 95;                    // ~630 rpm

  function makeSpray() {
    var firing = false, done = false;
    var shot = 0, hits = 0, fireStartedAt = 0;
    var originX = 0, originY = 0;         // where the finger went down
    var curX = 0, curY = 0;               // where it is now
    var marks = [];                        // {x,y,hit} bullet holes on the dummy
    var scale = 1;

    function endSpray() {
      if (done) return;
      done = true;
      firing = false;
      var pct = hits / AK_ROUNDS;
      if (pct >= 0.80) {
        setBanner('SPRAY CONTROLLED!', 'good');
        beep('cash');
        setTimeout(win, 500);
      } else {
        setBanner('SPRAY LOST — ' + Math.round(pct * 100) + '%', 'bad');
        beep('dink');
        setTimeout(fail, 520);
      }
    }

    return {
      id: 'spray',
      probe: function () { return { firing: firing, shot: shot, hits: hits, done: done, rounds: AK_ROUNDS }; },
      down: function (p) {
        if (done || firing) return;
        firing = true;
        originX = p.x; originY = p.y;
        curX = p.x; curY = p.y;
        fireStartedAt = now();
      },
      move: function (p) { if (firing) { curX = p.x; curY = p.y; } },
      up: function () { if (firing && !done) endSpray(); },
      update: function () {
        if (!firing || done) return;
        /* Rounds are due on the WALL CLOCK, not on accumulated frame deltas.
           A dt-accumulator with a per-frame cap time-dilates the moment the
           frame rate drops — a backgrounded tab or a slow phone would stretch
           a 2.8s spray into something much longer, and the guide would drift
           out of step with the rounds it is supposed to describe. */
        var due = Math.floor((now() - fireStartedAt) / AK_SHOT_MS) + 1;
        while (shot < due && shot < AK_ROUNDS && !done) {
          var recoil = AK_PATTERN[shot];
          // Ideal compensation is the inverse of the muzzle climb.
          var wantX = -recoil[0] * scale, wantY = -recoil[1] * scale;
          var gotX = curX - originX, gotY = curY - originY;
          var dist = Math.sqrt((gotX - wantX) * (gotX - wantX) + (gotY - wantY) * (gotY - wantY));
          // Tolerance grows a little as the pattern gets wilder, so the last
          // rounds are not effectively impossible on a small screen.
          var tol = 26 + shot * 0.9;
          var hit = dist <= tol * scale;
          if (hit) hits++;
          marks.push({ x: (dist <= tol * scale ? 0 : (gotX - wantX) * 0.25), y: shot, hit: hit });
          beep(hit ? 'bhop' : 'miss');
          shot++;
          if (shot >= AK_ROUNDS) endSpray();
        }
      },
      draw: function (c, w, h) {
        scale = Math.min(1, w / 380);
        px(c, 0, 0, w, h, '#2A3038');                       // range wall
        px(c, 0, h * 0.72, w, h * 0.28, '#3A4250');         // floor
        px(c, 0, h * 0.72, w, 4, '#1E242C');

        // ---- target dummy ----
        var dx = w / 2, dy = h * 0.34;
        px(c, dx - 34, dy - 10, 68, 96, '#8A6A45');          // torso
        px(c, dx - 16, dy - 52, 32, 42, '#8A6A45');          // head
        px(c, dx - 34, dy + 86, 20, 60, '#6E5436');          // legs
        px(c, dx + 14, dy + 86, 20, 60, '#6E5436');
        // scoring rings
        c.strokeStyle = '#C64B4B'; c.lineWidth = 2;
        c.beginPath(); c.arc(dx, dy + 34, 30, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(dx, dy + 34, 16, 0, Math.PI * 2); c.stroke();

        // ---- the recoil guide: glowing dotted line ----
        c.save();
        c.shadowColor = '#34D3FF'; c.shadowBlur = 8;
        for (var i = 0; i < AK_ROUNDS; i++) {
          var r = AK_PATTERN[i];
          // The guide shows where the player must DRAG (down/opposite), which
          // is the inverse of the climb — the same value scoring uses.
          var gx2 = dx - r[0] * scale * 0.9;
          var gy2 = h * 0.60 - r[1] * scale * 0.9 * -1;
          px(c, gx2 - 2, gy2 - 2, 4, 4, i <= shot ? '#7FE3B0' : '#34D3FF');
        }
        c.restore();

        // ---- the player's live drag ----
        if (firing) {
          var pxp = dx + (curX - originX), pyp = h * 0.60 + (curY - originY);
          c.strokeStyle = '#FFD54A'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(dx, h * 0.60); c.lineTo(pxp, pyp); c.stroke();
          px(c, pxp - 5, pyp - 1, 10, 2, '#FFFFFF');
          px(c, pxp - 1, pyp - 5, 2, 10, '#FFFFFF');
        }

        // ---- HUD ----
        px(c, 10, 10, 120, 20, '#141820');
        pixelText(c, 'HITS ' + hits + '/' + AK_ROUNDS, 18, 20, 11, hits >= AK_ROUNDS * 0.8 ? '#7FE3B0' : '#E8E8E8');
        // ammo counter
        pixelText(c, (AK_ROUNDS - shot) + ' / 30', w - 14, 20, 12, '#FFD54A', 'right');
        if (!firing && !done) {
          pixelText(c, 'HOLD AND DRAG DOWN THE LINE', w / 2, h - 26, 11, '#E8E2D0', 'center');
        }
      }
    };
  }

  /* ======================================================================
     MINIGAME 3 — TOP-DOWN NUKE BHOP RUN
     Alternate left/right taps in time with the rhythm stick. On-beat and
     alternating builds speed 250 -> 450+; anything else drops you to 250.
     Perfect rhythm reaches Outside in about five seconds.
     ====================================================================== */
  var BH_MIN_SPEED = 250, BH_MAX_SPEED = 470;
  var BH_BEAT_MS = 340;       // one strafe per beat
  var BH_GREEN = 0.30;        // half-width of the green zone, as beat fraction
  var BH_SCALE = 0.55;        // map units -> screen px

  /* ---- NUKE, T SPAWN to OUTSIDE, in CS2 radar style -------------------
     Authored in a frame ROTATED 90 degrees from the real radar: the player
     always runs toward -y (up the screen), which is the only layout that
     works on a 420-wide portrait phone. Real map north therefore points
     screen-LEFT, which is why MAIN sits left of the route and T RED right —
     that is where they are relative to the run, not an invented layout.
     Baking the rotation into the data (rather than rotating the camera each
     frame) keeps every rect axis-aligned, so the art stays pixel-crisp and
     the callout labels stay upright for free. */
  /* Rects are [x, y, w, h, surface]:
       0 asphalt yard (T Spawn's loading area — dark, painted, oil-stained)
       1 outdoor concrete (the connector and Outside)
       2 building interior (the neighbours you pass but never enter)
     Anything NOT covered by a rect is plant structure: roof decks, vents and
     the Cedar Creek buildings. Inverting it that way is what makes this read
     as Nuke rather than as a radar — the negative space is architecture. */
  var BH_ROOMS = [
    // T SPAWN — a wide yard that necks down into the exit. The back wall sits
    // well behind the spawn point (y 3596 vs a start of 3470) so the camera has
    // something to show, rather than void, the moment the run begins.
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
  ];
  // Callouts are held off the running lane on purpose — a label centred on the
  // route ends up permanently underneath the player sprite.
  var BH_LABELS = [
    ['T SPAWN', 185, 3150, 14], ['SILO', 585, 920, 11],   // sits ON the tank
    ['OUTSIDE', 640, 300, 14], ['MINI', 900, 620, 11],
    ['MAIN', 400, 620, 12], ['SQUEEKY', 250, 1040, 10], ['T RED', 1120, 1230, 10]
  ];
  var BH_SILO = [585, 920, 92];   // the tank, straddling the west wall as it does live

  /* Set dressing, all lifted from the two reference shots of the real Outside:
     rust-orange shipping containers, the red delivery truck parked in T Spawn,
     yellow hazard hatching and parking bays, and the big silver pipe runs.
     Everything is placed clear of the running lane so nothing ever hides the
     player. */
  var BH_PROPS = [
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
    { t: 'cont', x: 700, y: 1300, w: 130, h: 60 },
    // --- Outside ---
    { t: 'bay', x: 830, y: 1000, w: 160, h: 300 },
    { t: 'cont', x: 858, y: 1080, w: 130, h: 60 },
    { t: 'cont', x: 858, y: 1160, w: 130, h: 60 },
    { t: 'hatch', x: 545, y: 1150, w: 150, h: 150 },
    { t: 'pipe', x: 962, y: 300, w: 34, h: 420 },
    { t: 'cont', x: 560, y: 380, w: 128, h: 60 },
    { t: 'curb', x: 545, y: 640, w: 170, h: 14 }
  ];

  // The route itself. Its total length IS the track: one source of truth, so
  // the map can be reshaped without the win condition silently drifting.
  var BH_PATH = [[330, 3470], [330, 1990], [760, 1290], [760, 100]];
  var BH_SEGS = (function () {
    var segs = [], i;
    for (i = 0; i < BH_PATH.length - 1; i++) {
      var a = BH_PATH[i], b = BH_PATH[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], len: Math.sqrt(dx * dx + dy * dy) });
    }
    return segs;
  })();
  var BH_TRACK = BH_SEGS.reduce(function (t, s) { return t + s.len; }, 0);

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
  function bhPathAt(d) {
    var rem = clamp(d, 0, BH_TRACK), i;
    for (i = 0; i < BH_SEGS.length; i++) {
      var s = BH_SEGS[i];
      if (rem <= s.len || i === BH_SEGS.length - 1) {
        var t = s.len ? clamp(rem / s.len, 0, 1) : 0;
        return { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t,
                 ang: Math.atan2(s.y1 - s.y0, s.x1 - s.x0) };
      }
      rem -= s.len;
    }
    return { x: BH_PATH[0][0], y: BH_PATH[0][1], ang: -Math.PI / 2 };
  }

  function makeBhop() {
    var dist = 0, speed = BH_MIN_SPEED;
    var camX = BH_PATH[0][0]; // lags the player through the bend, so the turn
                              // sweeps instead of snapping
    var beatStartedAt = 0;     // wall clock anchor for the beat
    var nextSide = -1;         // -1 left, +1 right — must alternate
    var tilt = 0;
    var trail = [];
    var introUntil = now() + 1300;
    var done = false;
    var lastHitGood = false;
    // 0..1 through the current beat, read from the clock so the stick on screen
    // and the window the tap is judged against can never disagree.
    function beatPhase() {
      var e = (now() - beatStartedAt) % BH_BEAT_MS;
      return e / BH_BEAT_MS;
    }

    function tap(side) {
      if (done) return;
      if (now() < introUntil) return;      // ignore taps during the intro card
      // The stick sweeps 0..1; green is the middle band.
      var beatT = beatPhase();
      var offBeat = Math.abs(beatT - 0.5) > BH_GREEN;
      var wrongSide = (side !== nextSide);
      if (offBeat || wrongSide) {
        speed = BH_MIN_SPEED;
        lastHitGood = false;
        beep('miss');
      } else {
        speed = Math.min(BH_MAX_SPEED, speed + 26);
        lastHitGood = true;
        nextSide = -nextSide;
        tilt = side * 20;
        beep('bhop');
      }
    }

    return {
      id: 'bhop',
      probe: function () { return { dist: dist, speed: speed, beatT: beatPhase(), nextSide: nextSide, intro: now() < introUntil, track: BH_TRACK }; },
      down: function (p) { tap(p.x < W / 2 ? -1 : 1); },
      update: function (dt) {
        if (done) return;
        if (now() < introUntil) { beatStartedAt = now(); return; }
        dist += speed * dt;
        camX += (bhPathAt(dist).x - camX) * Math.min(1, dt * 3.2);
        tilt *= 0.88;
        if (speed > 350) {
          trail.push({ d: dist, t: now() });
          if (trail.length > 14) trail.shift();
        }
        if (dist >= BH_TRACK) {
          done = true;
          setBanner('OUTSIDE — GG', 'good');
          beep('cash');
          setTimeout(win, 420);
        }
      },
      draw: function (c, w, h) {
        var S = BH_SCALE, i, r;
        var me = bhPathAt(dist);
        var playerY = h * 0.66;              // sit low so the run reads forward
        // World -> screen. Rounded, because a half-pixel wall edge on flat
        // radar art is exactly the blur this style cannot afford.
        function sx(wx) { return Math.round(w / 2 + (wx - camX) * S); }
        function sy(wy) { return Math.round(playerY + (wy - me.y) * S); }

        /* ---- the plant itself: roof decks, the negative space of the route.
           Cedar Creek's buildings are pale concrete with a blue service band,
           and their roofs are covered in round silver ventilation cowls. */
        // Deliberately darker and cooler than any walkable surface. The first
        // pass made the roof deck and the outdoor concrete near-identical
        // greys, and the route stopped reading as a route at all.
        px(c, 0, 0, w, h, '#5E6266');                      // structure mass
        var CELL = 130;                                     // roof detail grid
        var wx0 = camX - (w / 2) / S, wy0 = me.y - (playerY) / S;
        var gi0 = Math.floor(wx0 / CELL), gj0 = Math.floor(wy0 / CELL);
        var cols = Math.ceil(w / S / CELL) + 2, rows = Math.ceil(h / S / CELL) + 2;
        for (var gi = 0; gi < cols; gi++) {
          for (var gj = 0; gj < rows; gj++) {
            var ci = gi0 + gi, cj = gj0 + gj;
            var bx = sx(ci * CELL), by = sy(cj * CELL), cs = CELL * S;
            px(c, bx, by, cs, 2, '#535759');               // roof slab seams
            px(c, bx, by, 2, cs, '#535759');
            var rnd = bhHash(ci, cj);
            if (rnd > 0.72) {                              // ventilation cowl
              var vx = bx + 18 + (rnd * 100 % 30), vy = by + 16 + (rnd * 313 % 34);
              px(c, vx, vy, 26, 20, '#A8ACAE');
              px(c, vx + 2, vy + 2, 22, 12, '#C6CACC');
              px(c, vx + 4, vy + 14, 18, 4, '#6E7274');
            } else if (rnd < 0.10) {                       // roof plant / duct
              px(c, bx + 22, by + 26, 44, 22, '#9CA09A');
              px(c, bx + 22, by + 26, 44, 4, '#B6BAB4');
            }
          }
        }
        /* The Cedar Creek building, sitting beyond the finish so it comes into
           view as the player closes on Outside. It was first placed west of the
           route, where MAIN's floor is drawn over the top of it and it never
           appeared once. */
        var bandX = sx(380), bandW = 780 * S;
        px(c, bandX, sy(4), bandW, 86 * S, '#E4E8EA');     // pale plant facade
        px(c, bandX, sy(38), bandW, 32 * S, '#3D8FC4');    // blue service band
        px(c, bandX, sy(66), bandW, 7 * S, '#2A6C99');
        px(c, bandX, sy(86), bandW, 5 * S, '#9DA1A3');

        /* ---- floors. Drawn twice: a dark lip inflated by the wall thickness,
           then the exact surface on top. The second pass buries every shared
           internal edge, so a pile of overlapping rects comes out with one
           clean kerb around their union — no polygon union maths needed. */
        var WALL = 8;
        var SURF = ['#42433E', '#8E9289', '#A9ADA4'];      // asphalt, concrete, interior
        for (i = 0; i < BH_ROOMS.length; i++) {
          r = BH_ROOMS[i];
          // Kerb lighter than the mass: it reads as a low wall catching the sun,
          // and gives the walkable area a continuous edge at any speed.
          px(c, sx(r[0]) - WALL, sy(r[1]) - WALL,
             r[2] * S + WALL * 2, r[3] * S + WALL * 2, '#A2A69E');
        }
        for (i = 0; i < BH_ROOMS.length; i++) {
          r = BH_ROOMS[i];
          px(c, sx(r[0]), sy(r[1]), r[2] * S, r[3] * S, SURF[r[4]]);
        }

        /* Everything below is painted ON the ground, so it is clipped to the
           floor union — otherwise hatching and containers spill onto roofs. */
        c.save();
        c.beginPath();
        for (i = 0; i < BH_ROOMS.length; i++) {
          r = BH_ROOMS[i];
          c.rect(sx(r[0]), sy(r[1]), r[2] * S, r[3] * S);
        }
        c.clip();

        // ---- ground props ----
        for (i = 0; i < BH_PROPS.length; i++) {
          var P = BH_PROPS[i];
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
          }
        }

        // ---- SILO: the ribbed steel tank, seen from directly above ----
        var sxo = sx(BH_SILO[0]), syo = sy(BH_SILO[1]), sr = BH_SILO[2] * S;
        if (syo > -sr - 40 && syo < h + sr + 40) {
          c.beginPath(); c.arc(sxo, syo, sr, 0, Math.PI * 2); c.fillStyle = '#7E8386'; c.fill();
          c.beginPath(); c.arc(sxo, syo, sr - 3, 0, Math.PI * 2); c.fillStyle = '#BFC4C7'; c.fill();
          for (var ri = 0; ri < 24; ri++) {                // vertical ribs, from above
            var a2 = ri / 24 * Math.PI * 2;
            c.strokeStyle = '#9DA3A7'; c.lineWidth = 2;
            c.beginPath();
            c.moveTo(sxo + Math.cos(a2) * (sr - 4), syo + Math.sin(a2) * (sr - 4));
            c.lineTo(sxo + Math.cos(a2) * (sr * 0.55), syo + Math.sin(a2) * (sr * 0.55));
            c.stroke();
          }
          c.beginPath(); c.arc(sxo, syo, sr * 0.55, 0, Math.PI * 2); c.fillStyle = '#D4D9DC'; c.fill();
          c.beginPath(); c.arc(sxo, syo, sr * 0.18, 0, Math.PI * 2); c.fillStyle = '#8E9498'; c.fill();
        }

        // ---- the route, painted on the tarmac as yellow plant arrows ----
        var step = 150;
        for (var d = Math.floor(dist / step) * step; d < dist + 1400; d += step) {
          if (d <= dist + 120 || d > BH_TRACK - 60) continue;   // clear the sprite
          var q = bhPathAt(d);
          c.save();
          c.translate(sx(q.x), sy(q.y));
          c.rotate(q.ang + Math.PI / 2);       // chevrons point along the route
          c.globalAlpha = 0.9;
          px(c, -2, -9, 5, 20, '#D8AC33');
          px(c, -11, -3, 9, 5, '#D8AC33');
          px(c, 3, -3, 9, 5, '#D8AC33');
          c.globalAlpha = 1;
          c.restore();
        }

        // ---- the finish line, across Outside ----
        var fy = sy(BH_PATH[BH_PATH.length - 1][1] + 40);
        if (fy > -20 && fy < h + 20) {
          for (var fx = sx(528); fx < sx(1000); fx += 26) {
            px(c, fx, fy - 6, 13, 12, '#E8E8E4');
            px(c, fx + 13, fy - 6, 13, 12, '#22242A');
          }
        }
        c.restore();

        // ---- callouts, as the chips the game itself draws over the world ----
        for (i = 0; i < BH_LABELS.length; i++) {
          var L = BH_LABELS[i];
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
          var q2 = bhPathAt(trail[i].d);
          c.globalAlpha = (i / trail.length) * 0.34;
          px(c, sx(q2.x) - 7, sy(q2.y) - 7, 14, 14, '#7FA8C9');
          c.globalAlpha = 1;
        }

        // ---- the player: a top-down T-side dot, tilted by the strafe ----
        c.save();
        c.translate(sx(me.x), sy(me.y));
        c.rotate(tilt * Math.PI / 180);
        // Bright ring, not a dark one: the run crosses both black asphalt and
        // pale concrete, and only a light outline survives both.
        px(c, -13, -13, 26, 26, '#F2EFE6');
        px(c, -10, -10, 20, 20, '#C89B54');                // shoulders
        px(c, -7, -13, 14, 5, '#B0863F');
        px(c, -6, -6, 12, 12, '#6E5636');                  // head from above
        px(c, -2, -22, 4, 14, '#22242A');                  // rifle
        c.restore();

        // ---- speedometer, top-centre ----
        var sw = 132, sx = (w - sw) / 2;
        px(c, sx, 8, sw, 26, '#141820');
        px(c, sx, 8, sw, 2, '#000000');
        var fast = speed > 350;
        pixelText(c, Math.round(speed) + ' u/s', sx + sw / 2, 21, 14,
          fast ? '#7FE3B0' : (speed > 260 ? '#FFD54A' : '#E8E8E8'), 'center');

        // ---- rhythm bar: green middle, sliding stick ----
        var rbW = w * 0.76, rbX = (w - rbW) / 2, rbY = h - 54, rbH = 16;
        px(c, rbX, rbY, rbW, rbH, '#141820');
        px(c, rbX, rbY, rbW, 2, '#000000');
        var gW = rbW * BH_GREEN * 2;
        px(c, rbX + rbW / 2 - gW / 2, rbY, gW, rbH, '#2E6E4A');
        px(c, rbX + rbW / 2 - 1, rbY, 2, rbH, '#7FE3B0');
        var stickX = rbX + beatPhase() * rbW;
        px(c, stickX - 2, rbY - 4, 4, rbH + 8, lastHitGood ? '#FFFFFF' : '#FFD54A');
        // which side is next
        pixelText(c, nextSide < 0 ? 'TAP LEFT' : 'TAP RIGHT', w / 2, rbY - 16, 11, '#E8E2D0', 'center');

        // ---- intro: big translucent A / D ----
        if (now() < introUntil) {
          px(c, 0, 0, w, h, 'rgba(10,12,18,0.55)');
          var blink = (Math.floor(now() / 180) % 2) === 0;
          c.globalAlpha = blink ? 0.95 : 0.45;
          pixelText(c, 'A', w * 0.25, h * 0.45, 92, '#FFFFFF', 'center');
          pixelText(c, 'D', w * 0.75, h * 0.45, 92, '#FFFFFF', 'center');
          c.globalAlpha = 1;
          pixelText(c, 'ALTERNATE TAPS ON THE BEAT', w / 2, h * 0.62, 12, '#E8E2D0', 'center');
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
    __win: win,
    __fail: fail
  };
})(window.Game = window.Game || {});
