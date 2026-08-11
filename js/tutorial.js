/* ==========================================================================
   CS2 PRO SIMULATOR — js/tutorial.js
   Game.Tutorial — 8-step skippable onboarding (SPEC-V2 §3, updated for
   SPEC-V3 final behaviour — Package J runs last, see SPEC-V3 §0/§9). One
   step was added over V2's original 7 (real-time ENERGY & NIGHT) since
   real-time energy regen is the single biggest V3 change and has no honest
   home inside an existing step; every other step is a copy fix in place,
   not a new anchor.

   Renders into the existing #tutorial-layer (see index.html). Non-blocking:
   the dim/spotlight backdrop is pointer-events:none, so the real game
   underneath stays fully clickable at every step — this coaches, it does
   not gate.

   Auto-fire rule: fires once, automatically, the moment a brand-new save
   enters the hub — never for a save loaded from an existing slot. Since
   js/state.js and js/title.js are frozen and neither exposes a "this is a
   fresh save entering the game" hook, this module detects the moment
   itself by lightly wrapping three already-public entry points at load
   time: Game.State.createSlot (new career -> definitely fresh),
   Game.State.loadSlot/.load (existing career -> never auto-fire), and
   Game.Router.go (fires the moment the 'hub' screen is actually reached,
   and re-anchors the current step on every screen change so steps survive
   navigation). Game.Title.show is also wrapped so returning to the title
   screen quietly pauses any tutorial in progress. These wraps are installed
   once, are additive (call straight through to the original function), and
   never touch the frozen files on disk.

   Completion/skip persists `State.data.tutorialDone = true` through
   State's own save path (State.saveCurrent) — no separate storage.
   ========================================================================== */
(function (G) {
  'use strict';

  var STEPS = [
    {
      selector: '#hub-canvas',
      title: 'YOUR ROOM',
      text: 'Everything you buy shows up here — every item buffs your stats. Check STATS anytime to see exactly what’s working for you.'
    },
    {
      /* V22 (owner item 2) — THE FURNISH STEP.

         A new career now starts with an EMPTY room and all five core props in
         the phone's inventory (Data.defaultPlaced is []), and this is the step
         that hands them over. It sits second on purpose: the room has to be
         complete before TRAIN/PLAY/STREAM/CASES are even unblocked
         (SPEC-V5 §5r), so teaching those first would be describing buttons
         that refuse to work.

         `waitFor` holds NEXT until the room is actually furnished, which is
         what makes this a thing the player DOES rather than reads. The
         backdrop is pointer-events:none, so the phone and the room are fully
         live underneath this card the whole time. */
      selector: '#phone-root',
      title: 'FURNISH YOUR ROOM',
      text: function () {
        var missing = [];
        try {
          var rc = G.State.roomCompleteness();
          missing = (rc && rc.missing) || [];
        } catch (e) { /* fall through to the generic wording */ }
        var base = 'Your gear is in your phone. Pull it down, open INVENTORY, ' +
          'and tap an item to drop it into the room — then drag it wherever you like. ' +
          'Hold any prop later to move, rotate or stash it.';
        if (!missing.length) return base + ' Your room is complete — nice.';
        return base + ' Still to place: ' + missing.join(', ').toUpperCase() + '.';
      },
      waitFor: function () {
        try { return !!G.State.roomCompleteness().complete; } catch (e) { return true; }
      },
      waitLabel: 'PLACE YOUR GEAR'
    },
    {
      selector: '#tb-energy-bar',
      title: 'ENERGY & NIGHT',
      text: 'Energy refills itself — 1 per second while it’s day. A few minutes after you wake it turns to night and regen stops dead until you sleep. Stuck? Tap this bar to watch an ad for a full refill.'
    },
    {
      selector: '#nav-train',
      title: 'TRAIN FIRST',
      text: 'Costs 5 energy, once a day. Your grade sets today’s form — it directly raises your chance to win matches. Never queue without it.'
    },
    {
      selector: '#nav-play',
      title: 'PLAY',
      text: '20 energy. Climbs your rank. Solo matches pay no money — rank is the goal.'
    },
    {
      selector: '#nav-stream',
      title: 'STREAM',
      text: '40 energy. This is how you actually make money — and grows your subscribers, who pay out every 7 days. Ban the red toxic messages before they reach the top.'
    },
    {
      selector: '#nav-cases',
      title: 'CASES',
      text: '$7 and 1 energy per open (free energy on stream). Skins sell instantly for cash. Pull a rare one live and your viewer count explodes.'
    },
    {
      selector: '#nav-shop',
      title: 'SHOP',
      text: 'Spend on gear, beds and energy upgrades — everything appears in your room and permanently buffs your stats. See STATS for the full breakdown.'
    },
    {
      // V22 (owner item 5): the phone is no longer gated behind 300 followers
      // — the player has it from the first minute — so onboarding has to
      // actually introduce it. It peeks at the top of the room and is a real
      // DOM node, so unlike the bed step below it anchors on a plain selector.
      selector: '#phone-root',
      title: 'THE REST OF YOUR PHONE',
      // A function, not a string: these thresholds live in js/state.js and are
      // read at display time (see renderStep) so this can never drift from the
      // real gates. State.phoneStatus() is the single source of truth for both
      // the numbers and the wording of a locked app.
      text: function () {
        var apps = [];
        try {
          var st = G.State.phoneStatus();
          for (var i = 0; i < st.apps.length; i++) {
            if (!st.apps[i].unlocked) apps.push(st.apps[i].name + ' — ' + st.apps[i].unlockLabel);
          }
        } catch (e) { /* fall through to the generic line below */ }
        var base = 'CAREER and STATS live in there too, next to the INVENTORY you just used.';
        if (!apps.length) return base + ' Every app is already unlocked.';
        return base + ' The rest unlock as you go: ' + apps.join('; ') + '.';
      }
    },
    {
      // SPEC-V20 §6: SLEEP has no DOM node of its own to anchor to — it's a
      // tap gesture on the bed prop, which lives entirely on the canvas (no
      // element per-prop, same as every other room item). '#hub-sleep-btn'
      // pointed at a button deleted back in V17; the header key that
      // replaced it (#tb-sleep) is now ALSO deleted (V20 §6 replaces it with
      // this bed tap).
      //
      // Spotlighting '#hub-canvas' therefore lit the WHOLE ROOM and put the
      // arrow in the middle of the floor: the one step whose entire job is
      // "tap THIS object" pointed at everything. `rect` fixes that — it asks
      // js/hub.js (which owns the zoom/pan camera) where the bed actually is
      // on screen, and reposition() prefers it over the selector whenever it
      // returns a box. The selector stays as the fallback for the cases the
      // rect can't answer: hub not mounted yet, or a save with no bed placed.
      selector: '#hub-canvas',
      rect: function () {
        var H = G.Hub;
        return (H && typeof H.bedScreenRect === 'function') ? H.bedScreenRect() : null;
      },
      title: 'SLEEP',
      text: 'Tap your bed to sleep — energy fills fast at your bed’s rate, with at least half a bar needed before you can wake (or it happens automatically at full). Waking pays your salary and subscriber income; rent comes due every 7 days.'
    }
  ];

  /* V18 §5.2 layout constants for the anchored bubble. GAP has to clear the
     spotlight's 6px bleed + the arrow (9px + its 4px hop) + the bubble's own
     stepped tail (13px), or the three overlap into mush. */
  var SPOT_PAD = 6;   // how far the lit cutout extends past the target
  var ARROW_H = 9;    // .tut-arrow height in css/tutorial.css
  var ARROW_W = 18;
  var BUBBLE_GAP = 34;

  var root = null, spotlight = null, panel = null, tail = null, arrow = null;
  var stepLabelEl = null, titleEl = null, textEl = null, dotsEl = null, nextBtn = null, skipBtn = null;

  var built = false;
  var active = false;
  var stepIndex = 0;
  var hooksInstalled = false;
  var resizeBound = false;
  var pendingAutoStart = false;

  /* ------------------------------------------------------------------ dom */
  function buildDom() {
    root = document.getElementById('tutorial-layer');
    if (!root) return;
    root.innerHTML =
      '<div class="tut-spotlight" id="tut-spotlight"></div>' +
      '<div class="tut-arrow" id="tut-arrow"></div>' +
      '<div class="tut-panel panel" id="tut-panel">' +
        '<div class="tut-tail" id="tut-tail"></div>' +
        '<div class="tut-panel__head">' +
          '<span class="tut-panel__step" id="tut-step-label">STEP 1 / 8</span>' +
          '<button class="btn tut-skip" id="tut-skip" type="button">SKIP</button>' +
        '</div>' +
        '<div class="tut-panel__title" id="tut-title"></div>' +
        '<div class="tut-panel__text" id="tut-text"></div>' +
        '<div class="tut-panel__dots" id="tut-dots"></div>' +
        '<div class="tut-panel__actions">' +
          '<button class="btn btn--primary tut-next" id="tut-next" type="button">NEXT</button>' +
        '</div>' +
      '</div>';

    spotlight = document.getElementById('tut-spotlight');
    arrow = document.getElementById('tut-arrow');
    panel = document.getElementById('tut-panel');
    tail = document.getElementById('tut-tail');
    stepLabelEl = document.getElementById('tut-step-label');
    titleEl = document.getElementById('tut-title');
    textEl = document.getElementById('tut-text');
    dotsEl = document.getElementById('tut-dots');
    nextBtn = document.getElementById('tut-next');
    skipBtn = document.getElementById('tut-skip');

    skipBtn.addEventListener('click', onSkip);
    nextBtn.addEventListener('click', onNext);

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', function () { if (active) reposition(); });
    }
    built = true;
  }

  function qs(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function isVisible(el) {
    if (!el) return false;
    return el.getClientRects().length > 0 && (el.offsetWidth > 0 || el.offsetHeight > 0);
  }

  /* -------------------------------------------------------------- render */
  function renderDots() {
    dotsEl.innerHTML = '';
    for (var i = 0; i < STEPS.length; i++) {
      var d = document.createElement('span');
      d.className = 'tut-dot' + (i === stepIndex ? ' tut-dot--active' : (i < stepIndex ? ' tut-dot--done' : ''));
      dotsEl.appendChild(d);
    }
  }

  function renderStep() {
    var step = STEPS[stepIndex];
    stepLabelEl.textContent = 'STEP ' + (stepIndex + 1) + ' / ' + STEPS.length;
    titleEl.textContent = step.title;
    // `text` may be a FUNCTION, resolved per render — same escape hatch `rect`
    // already uses below. A step that quotes a live threshold (the phone step's
    // unlock numbers) reads it from State at display time rather than baking a
    // copy into this array, so retuning the rule can never leave the tutorial
    // teaching a number the game no longer uses.
    textEl.textContent = (typeof step.text === 'function') ? step.text() : step.text;
    syncGate();
    renderDots();
    reposition();
  }

  /* ---- the gated step (V22, owner item 2) ---------------------------------
     A step may declare `waitFor()`. While that returns false, NEXT is disabled
     and the button says what is still owed — so a step can ask the player to
     actually DO something (place their gear) instead of just reading about it.

     This works because the tutorial backdrop is pointer-events:none (see the
     file header): the real game is live underneath the whole time, so the
     player can open the phone and drag props while the card sits there.

     UI.setDisabled(), never a CSS-only fade — HANDOFF-V2 §5.5: a
     pointer-events:none "disabled" control is still tab-focusable and still
     fires on Enter, which here would skip the step the gate exists to hold.

     Polled rather than event-driven on purpose: placement completes through
     several different paths (hub commit, phone inventory tap, a swap on
     purchase) and subscribing to all of them would be a second copy of "what
     counts as furnished". Asking the one authority, State.roomCompleteness(),
     four times a second is cheaper than keeping that list correct. */
  var gateTimer = null;

  function stopGate() {
    if (gateTimer) { clearInterval(gateTimer); gateTimer = null; }
  }

  function syncGate() {
    var step = STEPS[stepIndex];
    var gated = !!(step && typeof step.waitFor === 'function' && !step.waitFor());
    if (G.UI && typeof G.UI.setDisabled === 'function') G.UI.setDisabled(nextBtn, gated);
    nextBtn.textContent = gated
      ? (step.waitLabel || 'NOT YET')
      : ((stepIndex === STEPS.length - 1) ? 'GOT IT' : 'NEXT');

    if (gated && !gateTimer) {
      gateTimer = setInterval(function () {
        if (!active) { stopGate(); return; }
        syncGate();
      }, 250);
    } else if (!gated) {
      stopGate();
    }
  }

  function reposition() {
    if (!active || !root || !panel) return;
    var step = STEPS[stepIndex];
    var target = step ? qs(step.selector) : null;
    var rootRect = root.getBoundingClientRect();
    // A step may supply its own rect for something that has no element of its
    // own — a canvas prop (see step 5's `rect`). It wins over the selector
    // when it returns a real box, and falls back to it when it returns null.
    var customRect = null;
    if (step && typeof step.rect === 'function') {
      try { customRect = step.rect(); } catch (e) { customRect = null; }
      if (customRect && !(customRect.width > 0 && customRect.height > 0)) customRect = null;
    }
    var visible = customRect ? true : isVisible(target);

    /* THE spotlight rect — measured ONCE and then reused by the cutout, the
       V18 §5.2 arrow and the bubble alike. This block used to call
       getBoundingClientRect() a second time further down to place the panel;
       two independent reads of the same target is exactly how a highlight and
       the thing it highlights drift apart. There is now one source. */
    var spot = null;
    if (visible) {
      var r = customRect || target.getBoundingClientRect();
      spot = {
        left: r.left - rootRect.left - SPOT_PAD,
        top: r.top - rootRect.top - SPOT_PAD,
        w: r.width + SPOT_PAD * 2,
        h: r.height + SPOT_PAD * 2
      };
      spotlight.style.display = 'block';
      spotlight.style.left = spot.left + 'px';
      spotlight.style.top = spot.top + 'px';
      spotlight.style.width = spot.w + 'px';
      spotlight.style.height = spot.h + 'px';
    } else {
      spotlight.style.display = 'none';
    }

    var pw = panel.offsetWidth, ph = panel.offsetHeight;
    var left, top;

    if (spot) {
      var cx = spot.left + spot.w / 2;
      left = cx - pw / 2;
      left = Math.max(10, Math.min(rootRect.width - pw - 10, left));

      var lowerHalf = (spot.top + spot.h / 2) > rootRect.height / 2;
      if (lowerHalf) {
        /* bubble above the target: its tail hangs down, and the arrow sits in
           the gap between them pointing down into the lit rect. */
        top = spot.top - ph - BUBBLE_GAP;
        tail.className = 'tut-tail tut-tail--down';
        arrow.className = 'tut-arrow tut-arrow--down';
        arrow.style.top = (spot.top - 2 - ARROW_H) + 'px';
      } else {
        top = spot.top + spot.h + BUBBLE_GAP;
        tail.className = 'tut-tail tut-tail--up';
        arrow.className = 'tut-arrow tut-arrow--up';
        arrow.style.top = (spot.top + spot.h + 2) + 'px';
      }
      top = Math.max(10, Math.min(rootRect.height - ph - 10, top));

      var tailLeft = cx - left;
      tailLeft = Math.max(16, Math.min(pw - 16, tailLeft));
      tail.style.left = tailLeft + 'px';
      tail.style.display = 'block';

      arrow.style.left = (cx - ARROW_W / 2) + 'px';
      arrow.style.display = 'block';
    } else {
      left = (rootRect.width - pw) / 2;
      top = (rootRect.height - ph) / 2;
      tail.style.display = 'none';
      arrow.style.display = 'none';
    }

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  /* --------------------------------------------------------------- flow */
  function onNext() {
    if (G.UI && G.UI.beep) G.UI.beep('click');
    if (stepIndex >= STEPS.length - 1) { finish(); return; }
    stepIndex++;
    renderStep();
  }

  function onSkip() {
    if (G.UI && G.UI.beep) G.UI.beep('click');
    finish();
  }

  function finish() {
    stop();
    try {
      if (G.State && G.State.data) {
        G.State.data.tutorialDone = true;
        if (typeof G.State.saveCurrent === 'function') G.State.saveCurrent();
        else if (typeof G.State.save === 'function') G.State.save();
      }
    } catch (e) { /* non-fatal: tutorial still closes even if persistence fails */ }
  }

  function start() {
    if (!built) buildDom();
    if (!root || !panel) return;
    stepIndex = 0;
    active = true;
    root.classList.add('tutorial-layer--active');
    renderStep();
  }

  function stop() {
    active = false;
    stopGate();   // the poll must never outlive the overlay
    if (root) root.classList.remove('tutorial-layer--active');
  }

  /* --------------------------------------------------- auto-fire hooks --
     Installed once. Purely additive wraps around already-public functions
     on frozen modules — never edits those files. */
  function installHooks() {
    if (hooksInstalled) return;
    if (!G.State || !G.Router) return;
    hooksInstalled = true;

    try {
      var origCreateSlot = G.State.createSlot;
      if (typeof origCreateSlot === 'function') {
        G.State.createSlot = function () {
          var r = origCreateSlot.apply(G.State, arguments);
          pendingAutoStart = true; // brand-new career -> arm the auto-fire
          return r;
        };
      }

      var origLoadSlot = G.State.loadSlot;
      if (typeof origLoadSlot === 'function') {
        G.State.loadSlot = function () {
          var r = origLoadSlot.apply(G.State, arguments);
          pendingAutoStart = false; // loading an existing slot -> never auto-fire
          return r;
        };
      }

      var origLoad = G.State.load;
      if (typeof origLoad === 'function') {
        G.State.load = function () {
          var r = origLoad.apply(G.State, arguments);
          pendingAutoStart = false;
          return r;
        };
      }
    } catch (e) { /* leave State usable even if wrapping fails */ }

    try {
      var origRouterGo = G.Router.go;
      if (typeof origRouterGo === 'function') {
        G.Router.go = function (name) {
          var r = origRouterGo.apply(G.Router, arguments);
          if (r && name === 'hub' && pendingAutoStart) {
            pendingAutoStart = false;
            if (G.State && G.State.data && !G.State.data.tutorialDone) start();
          }
          if (active) reposition();
          return r;
        };
      }
    } catch (e) { /* leave Router usable even if wrapping fails */ }

    try {
      if (G.Title && typeof G.Title.show === 'function') {
        var origTitleShow = G.Title.show;
        G.Title.show = function () {
          stop(); // heading back to the title screen pauses any tutorial in progress
          return origTitleShow.apply(G.Title, arguments);
        };
      }
    } catch (e) { /* leave Title usable even if wrapping fails */ }
  }

  /* ====================================================================
     CONTEXTUAL TUTORIAL CARD (SPEC-V15-BATCH-C §2.1) — a SECOND, separate
     mechanism from the 8-step onboarding above. A single compact card, not
     the spotlight overlay: title + 2-4 lines straight out of Data.tutorials
     (never a second hand-typed copy of that text — see the module header),
     one GOT IT button. Dismiss -> State.markTutorialSeen(id) -> gone for
     good, proven by test-v15-tutorials.js.

     Rendered into the EXISTING #modal-layer, following the exact shape
     js/main.js's openEnergyModal() uses (manual backdrop + card, no second
     overlay system) — never into #tutorial-layer, which belongs to the
     8-step overlay above and is non-blocking/pointer-events:none by design.

     Driven by Game.State's 'change' event (see js/main.js's own top-level
     'change' listener for the same pattern) — never a render-loop poll.
     State.tutorialPending() already encodes every suppression rule (live
     stream, packing, sleep, mid-onboarding) — this file trusts it and does
     not re-check any of those conditions itself.
     ==================================================================== */

  // TUTCARD_ICON: one small authored SVG (24x24, 2px stroke, currentColor —
  // SPEC-V15-BATCH-C §2.1 "no emoji or Unicode glyphs as icons"), reused for
  // every tutorial id rather than one drawing per id.
  var TUTCARD_ICON =
    '<svg viewBox="0 0 24 24" class="tutcard__icon" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="12" cy="7.5" r="1.3" fill="currentColor"/>' +
    '</svg>';

  var cardOpenId = null; // the tutorial id currently showing in #modal-layer, or null
  var cardEl = null;     // the card's own backdrop node, so we can tell if it was stomped
  var pendingCheck = null; // deferred maybeShowPendingTutorial timer, if any

  function showTutorialCard(id) {
    var entry = (G.Data && G.Data.tutorials) ? G.Data.tutorials[id] : null;
    if (!entry) return; // contract: test-v15-tutorials.js asserts every id has a non-empty entry
    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';

    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    var card = document.createElement('div');
    card.className = 'tutcard';

    var head = document.createElement('div');
    head.className = 'tutcard__head';
    head.innerHTML = TUTCARD_ICON;
    var title = document.createElement('div');
    title.className = 'tutcard__title';
    title.textContent = entry.title;
    head.appendChild(title);
    card.appendChild(head);

    var body = document.createElement('div');
    body.className = 'tutcard__body';
    (entry.lines || []).forEach(function (line) {
      var row = document.createElement('div');
      row.className = 'tutcard__line';
      row.textContent = line;
      body.appendChild(row);
    });
    card.appendChild(body);

    var btn = document.createElement('button');
    btn.className = 'btn btn--primary tutcard__btn';
    btn.type = 'button';
    btn.textContent = 'GOT IT';
    btn.addEventListener('click', function () { dismissTutorialCard(id); });
    card.appendChild(btn);

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    cardOpenId = id;
    cardEl = backdrop;
    requestAnimationFrame(function () { card.classList.add('tutcard--in'); });
  }

  function dismissTutorialCard(id) {
    if (G.UI && G.UI.beep) G.UI.beep('click');
    if (G.State && G.State.markTutorialSeen) G.State.markTutorialSeen(id);
    if (G.UI && G.UI.closeModal) G.UI.closeModal();
    cardOpenId = null;
    cardEl = null;
    // A second milestone can in principle have been crossed on the same
    // tick that fired this one (State.tutorialPending() only ever hands
    // back one id at a time) — re-check right away instead of waiting for
    // the next 'change' so back-to-back cards don't feel like a missed tap.
    maybeShowPendingTutorial();
  }

  // maybeShowPendingTutorial: the only entry point that can open a card.
  // Never trap the player (SPEC-V15-BATCH-C §2.1): skips outright if a card
  // is already open, or if #modal-layer is already hosting some OTHER modal
  // (energy, a reward card, a confirm dialog, ...) — this file never steals
  // that layer out from under another owner. It simply tries again on the
  // next 'change' event, which fires at least every render tick, so nothing
  // gets stuck once the other modal closes.
  /* maybeShowPendingTutorial — OWNER PLAYTEST BUG FIX ("completed the 8-step
     tutorial, trained and played to Gold Nova, nothing happened; reopening the
     save showed it").

     ROOT CAUSE: this was called synchronously from the 'change' event, and
     several callers emit 'change' and THEN open their own modal. js/main.js's
     doPlayMatch() is the exact case: State.playMatch() commits (-> 'change'),
     we opened the tutorial card into an empty #modal-layer, and then
     doPlayMatch() called UI.rewardCard(), whose first line is
     `layer.innerHTML = ''` — destroying the card milliseconds after it was
     created. `cardOpenId` stayed set, so every later attempt returned early,
     and markTutorialSeen() was never reached, so it stayed unseen forever.
     Reloading reset the module variable, which is why it appeared "only after
     reopening the save".

     TWO FIXES, because either alone would leave a hole:
     1. DEFER the open to a macrotask. The emitter finishes its own work —
        including opening its reward card — before we look at the layer, so the
        "is another modal already up?" check below sees the truth instead of a
        half-built frame. The card then opens on a later 'change' once that
        modal is gone.
     2. SELF-HEAL a stomped card. If cardOpenId is set but our node is no
        longer in the document, some other modal cleared the layer out from
        under us; treat the card as closed rather than staying latched forever.
        A stuck flag must never be able to permanently disable all tutorials. */
  function maybeShowPendingTutorial() {
    if (pendingCheck) return;
    pendingCheck = setTimeout(function () {
      pendingCheck = null;
      runPendingTutorialCheck();
    }, 0);
  }

  function runPendingTutorialCheck() {
    // (2) our card was wiped by another modal's innerHTML reset — unlatch.
    if (cardOpenId && cardEl && !cardEl.isConnected) {
      cardOpenId = null;
      cardEl = null;
    }
    if (cardOpenId) return;
    // The 8-step onboarding overlay owns the screen while it is up, so a
    // milestone card must not stack on top of it. This is the guard that
    // REPLACED state.js's old `!d.tutorialDone` check: that one suppressed
    // cards until the onboarding had ever been *completed*, which silently
    // swallowed any milestone crossed beforehand (GOLD NOVA is only 250 ELO,
    // so this happened routinely — see the note in State.tutorialPending()).
    // `active` is true only while the overlay is genuinely on screen, so a
    // deferred card now fires the moment it closes rather than being lost.
    if (active) return;
    if (!G.State || typeof G.State.tutorialPending !== 'function') return;
    var id = G.State.tutorialPending();
    if (!id) return;
    var layer = document.getElementById('modal-layer');
    if (!layer || layer.classList.contains('modal-layer--open')) return;
    showTutorialCard(id);
  }

  /* -------------------------------------------------------------- public */
  G.Tutorial = {
    ready: true,
    start: function () {
      installHooks();
      start();
    },
    stop: stop
  };

  installHooks();

  // Contextual-card polling hook — bound once, on state-change edges only
  // (see the module docblock above). js/state.js loads before this file in
  // index.html, so Game.State.on already exists at this point.
  if (G.State && typeof G.State.on === 'function') {
    G.State.on('change', maybeShowPendingTutorial);
  }
})(window.Game = window.Game || {});
