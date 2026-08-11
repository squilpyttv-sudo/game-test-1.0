/* ==========================================================================
   CS2 PRO SIMULATOR — js/customise.js
   Game.Customise — the PAINT / LED COLOUR modal (SPEC-V21 §6).

   The contract js/hub.js calls (hub.js is FROZEN — do not change it):

     window.Game.Customise.open(defId, placedIdx)

       defId     — the shop item id (pendingPlacement.defId)
       placedIdx — its index into State.data.placed (pendingPlacement.moveIdx)

   No return value; this file owns its own open/close lifecycle the same way
   js/phone.js does.

   ---- WHY `open` IS CONDITIONALLY EXPORTED -------------------------------
   The stub shipped exporting nothing because hub.js probes for
   `window.Game.Customise.open` and falls back to an honest
   "CUSTOMISATION IS COMING SOON" toast when it is absent — a half-built
   `open` would make hub.js raise a modal that cannot do anything. This file
   keeps that property instead of dropping it: `open` is attached ONLY when
   every SPEC-V21 §5 export it depends on is present on Game.State
   (customiseFamily / customisePalette / itemTint / setItemTint). js/state.js
   loads before this file in index.html, so the check is decided at eval time.
   If the rules package were ever rolled back, hub.js degrades to its toast
   again with no edit anywhere. `Game.Customise.__probe()` reports which of
   the four is missing.

   ---- WHAT THIS FILE DELIBERATELY DOES NOT DO ----------------------------
   - No colour list. The swatches come from State.customisePalette(defId),
     which reads Data.customisePalettes. A second copy here is the
     "two sources of truth" bug (HANDOFF §9.1).
   - No family heuristic. State.customiseFamily(defId) decides led vs fabric;
     this file only picks the wording.
   - No validation of its own. State.setItemTint() is the single writer and
     the single validator; a refusal is surfaced as its own reason string.
   - No room re-render call. js/hub.js runs a continuous rAF loop, so a
     committed tint is on screen the next frame. Reaching into hub.js for a
     redraw would be a second render path.
   ========================================================================== */
(function (G) {
  'use strict';

  /* ---- the SPEC-V21 §5 surface this modal is built on -------------------- */
  var NEEDS = ['customiseFamily', 'customisePalette', 'itemTint', 'setItemTint'];

  function missingApi() {
    var gaps = [];
    for (var i = 0; i < NEEDS.length; i++) {
      if (!G.State || typeof G.State[NEEDS[i]] !== 'function') gaps.push(NEEDS[i]);
    }
    return gaps;
  }

  function beep(kind) { if (G.UI && G.UI.beep) G.UI.beep(kind); }
  function toast(msg, kind) { if (G.UI && G.UI.toast) G.UI.toast(msg, kind); }

  /* ---- the selection mark ------------------------------------------------
     Authored SVG (ART-DIRECTION §2.5 — no emoji, no Unicode glyph does icon
     duty in this game), 24x24 viewBox, in the stroke language of js/phone.js.

     It is drawn TWICE from the same path data, and that is the whole point.
     A one-colour tick cannot survive a palette that runs from #FFFFFF to
     #2C3E50: whatever colour it is, some swatch sits next to it. Two tones
     cannot fail, because for any background luminance L the white core and
     the black halo have contrasts whose PRODUCT is exactly 21 — so the
     better of the two is never below sqrt(21) = 4.58:1, on every colour that
     exists. The halo is the heavier stroke painted first; the core is the
     house 2px-family weight painted on top and left on `currentColor` so it
     still follows the element's colour like every other icon here. */
  var MARK_PATH = 'M4.6 12.4l4.7 4.7L19.4 6.8';
  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" class="cust__mark-svg" aria-hidden="true" focusable="false">' +
      '<path class="cust__mark-halo" d="' + MARK_PATH + '" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>' +
      '<path class="cust__mark-core" d="' + MARK_PATH + '" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>' +
    '</svg>';

  /* Family wording. The only thing the led/fabric split changes in this file:
     a light source is not painted and cloth does not glow, so the verbs
     differ. Everything structural is shared. */
  var COPY = {
    fabric: { hint: 'TAP A COLOUR TO PAINT IT. IT APPLIES STRAIGHT AWAY.', factorySub: 'NO PAINT' },
    led:    { hint: 'TAP A COLOUR TO RELIGHT IT. IT APPLIES STRAIGHT AWAY.', factorySub: 'NO COLOUR' }
  };

  // The live modal, or null. One at a time — open() replaces any predecessor
  // through the same close() every other dismissal uses.
  var session = null;

  /* ---- build -------------------------------------------------------------
     Every node is built once, here. Choosing a colour only toggles classes
     and aria-checked on nodes that already exist — nothing under the finger
     is ever rebuilt or repositioned (HANDOFF §9.5). */
  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function buildOption(parent, cls, label) {
    var btn = el('button', 'cust__opt ' + cls, parent);
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-label', label);
    btn.tabIndex = -1;
    return btn;
  }

  function buildSwatch(parent, hex, i, total) {
    var btn = buildOption(parent, 'cust__opt--swatch', 'Colour ' + (i + 1) + ' of ' + total + ', ' + hex);
    var chip = el('span', 'cust__chip', btn);
    // The ONE place a palette value touches the DOM: an inline background on
    // the chip. css/customise.css stays at zero raw hex, and the chip's own
    // ::before/::after strips derive the isometric ramp (top x1.30, bottom
    // x0.70 — ART-DIRECTION §2.2) from `background: inherit` + filter, so the
    // swatch is shaded by the same rule the prop it paints is shaded by, with
    // no second colour ever named.
    chip.style.background = hex;
    var mark = el('span', 'cust__mark', btn);
    mark.innerHTML = ICON_CHECK;
    return btn;
  }

  function buildFactory(parent, defId, family) {
    var btn = buildOption(parent, 'cust__opt--factory', 'Factory finish, remove the colour');
    var chip = el('span', 'cust__chip cust__chip--factory', btn);

    // FACTORY shows the item's REAL untinted sprite — the same
    // Iso.renderPropIcon(canvas, id) the phone's inventory well uses (it
    // takes a CANVAS, not a ctx). "Factory finish" and "the original art"
    // are the same sentence, so the option shows it rather than describing
    // it. If the renderer is unavailable the checkerboard ground behind it
    // still reads as "nothing applied".
    var cvs = el('canvas', 'cust__factory-sprite', chip);
    cvs.width = 44; cvs.height = 44;
    try {
      if (G.Iso && typeof G.Iso.renderPropIcon === 'function') G.Iso.renderPropIcon(cvs, defId);
    } catch (e) { /* the checker ground is the fallback; never block the modal */ }

    var text = el('span', 'cust__factory-text', btn);
    el('span', 'cust__factory-name', text).textContent = 'FACTORY';
    el('span', 'cust__factory-sub', text).textContent = COPY[family].factorySub;

    var mark = el('span', 'cust__mark', btn);
    mark.innerHTML = ICON_CHECK;
    return btn;
  }

  /* ---- selection ---------------------------------------------------------
     The current value is resolved from State.itemTint() on open, so the
     applied colour is already marked the moment the grid appears — a picker
     that opens with nothing selected makes the player remember what they
     chose last time. */
  function sync() {
    if (!session) return;
    var cur = session.current;
    for (var i = 0; i < session.opts.length; i++) {
      var o = session.opts[i];
      var on = (o.value === cur);
      o.btn.classList.toggle('is-selected', on);
      o.btn.setAttribute('aria-checked', on ? 'true' : 'false');
      o.btn.tabIndex = on ? 0 : -1;
      if (on) session.focusIndex = i;
    }
    // Nothing is selected only if the save holds a tint the palette no longer
    // contains; keep the group reachable by Tab regardless.
    if (session.opts.length && session.opts[session.focusIndex] &&
        session.opts[session.focusIndex].btn.tabIndex !== 0) {
      session.opts[session.focusIndex].btn.tabIndex = 0;
    }
  }

  function choose(i) {
    if (!session) return;
    var opt = session.opts[i];
    if (!opt) return;
    if (opt.value === session.current) { beep('click'); return; }

    var res = G.State.setItemTint(session.placedIdx, opt.value);
    if (!res || !res.ok) {
      // The reason string is state.js's, verbatim — this file does not invent
      // a friendlier wording for a rule it does not own.
      toast((res && res.reason) || 'CANNOT CUSTOMISE THAT', 'bad');
      return;
    }
    session.current = opt.value;
    beep('click');
    sync();
    // No redraw call: js/hub.js's render loop is already running and picks
    // the committed tint up on its next frame.
  }

  /* ---- lifecycle ---------------------------------------------------------
     ONE teardown route. The close disc, a tap outside the card and Escape all
     run close(); a modal with two ways to tear down is how state gets left
     behind. The key listener hangs on the backdrop, not on document, so it
     cannot outlive the node even if something else clears #modal-layer. */
  /* liftRoom (TASKS-REMAINING #3) — tell js/hub.js how much of the room this
     sheet is covering so the camera can lift the prop clear of it. Probed the
     same defensive way Customise.open itself is probed by hub.js: an older
     hub.js without setSheetInset simply keeps the old behaviour rather than
     throwing. Called with the measured height on open and with 0 on EVERY
     teardown — close() is the single teardown route, which is what makes one
     call site enough to guarantee it is always cleared. */
  function liftRoom(viewportTop) {
    var H = G.Hub;
    if (H && typeof H.setSheetTop === 'function') {
      try { H.setSheetTop(viewportTop); } catch (e) { /* never block the modal on a lift */ }
    }
  }

  function close() {
    if (!session) return;
    // null, NEVER 0. Zero is a legitimate viewport y meaning "this sheet's top
    // edge is at the very top of the screen", i.e. it covers everything — so
    // passing 0 to mean "no sheet" left the room fully lifted after close.
    // Measured on the way in: it set the inset to 487 instead of 0.
    liftRoom(null);
    var prev = session.returnFocus;
    session = null;
    if (G.UI && typeof G.UI.closeModal === 'function') G.UI.closeModal();
    else {
      var layer = document.getElementById('modal-layer');
      if (layer) { layer.innerHTML = ''; layer.classList.remove('modal-layer--open'); }
    }
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      try { prev.focus(); } catch (e) { /* the element went away with the menu */ }
    }
  }

  function onKey(e) {
    if (!session) return;
    var k = e.key;
    if (k === 'Escape' || k === 'Esc') { e.preventDefault(); close(); return; }
    var step = 0;
    if (k === 'ArrowRight' || k === 'ArrowDown') step = 1;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') step = -1;
    if (!step) return;
    e.preventDefault();
    var n = session.opts.length;
    var next = (session.focusIndex + step + n) % n;
    session.focusIndex = next;
    for (var i = 0; i < n; i++) session.opts[i].btn.tabIndex = (i === next ? 0 : -1);
    session.opts[next].btn.focus();
  }

  function open(defId, placedIdx) {
    // Re-entrancy: hub.js can only reach this from a live context menu, but
    // an open modal is torn down through the same close() rather than being
    // orphaned behind a second card.
    if (session) close();

    var family = G.State.customiseFamily(defId);
    var palette = G.State.customisePalette(defId);
    if (!family || !palette || !palette.length) { toast('NOT CUSTOMISABLE', 'bad'); return; }

    var placed = (G.State.data && G.State.data.placed) || [];
    var entry = placed[placedIdx];
    if (!entry || entry.id !== defId) { toast('CANNOT CUSTOMISE THAT', 'bad'); return; }

    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    layer.classList.add('modal-layer--open');

    var def = (typeof G.State.findShopItem === 'function') ? G.State.findShopItem(defId) : null;
    var name = (def && def.name) || 'ITEM';

    // .modal-backdrop is css/style.css's own class, reused for its scroll and
    // sizing behaviour; .cust__backdrop overrides only the two things this
    // modal decides differently (see the stylesheet: bottom-docked, no veil).
    var backdrop = el('div', 'modal-backdrop cust__backdrop', layer);
    backdrop.tabIndex = -1;

    var card = el('div', 'cust__card', backdrop);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', name + ' colour');

    var title = el('div', 'cust__title', card);
    title.textContent = name;

    var hint = el('p', 'cust__hint', card);
    hint.textContent = COPY[family].hint;

    var group = el('div', 'cust__group', card);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', name + ' colour');

    var grid = el('div', 'cust__grid', group);
    var opts = [];
    var i;
    for (i = 0; i < palette.length; i++) {
      opts.push({ value: palette[i], btn: buildSwatch(grid, palette[i], i, palette.length) });
    }
    opts.push({ value: null, btn: buildFactory(group, defId, family) });

    session = {
      defId: defId,
      placedIdx: placedIdx,
      opts: opts,
      current: G.State.itemTint(placedIdx),
      focusIndex: 0,
      returnFocus: document.activeElement
    };

    for (i = 0; i < opts.length; i++) {
      (function (idx) {
        opts[idx].btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          choose(idx);
        });
      })(i);
    }

    // Tapping the clear area outside the card closes. The card stops the
    // bubble so a tap that lands on padding inside it does not.
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    backdrop.addEventListener('keydown', onKey);

    // The V18 close disc + docked header tab, from the same UI.modalChrome
    // every other modal uses, wired to this modal's OWN close() — the X is a
    // second affordance for one teardown route, not a second route.
    if (G.UI && typeof G.UI.modalChrome === 'function') G.UI.modalChrome(card, title, close);

    sync();

    // Lift the room clear of this sheet (TASKS-REMAINING #3). Measured from
    // the built card rather than hardcoded: the card's height depends on the
    // palette length and on the item name's wrapping, so the one number that
    // is always right is the one the layout just produced.
    //
    // js/hub.js wants the top EDGE, so it can work out how much of ITS canvas
    // is behind this sheet. Handing it a height instead over-lifts the room by
    // however much of the card hangs below the canvas — measured at 97px of a
    // 332px card, which is the bug this comment exists to stop coming back.
    //
    // Derived from the BACKDROP, not from card.getBoundingClientRect(): that
    // rect applies transforms, and cust-rise starts at translateY(18px) with
    // fill-mode `both`, so reading the card's own rect on this frame reports
    // it 18px lower than where it settles. The backdrop is never animated, and
    // offsetHeight/marginBottom are layout values a transform cannot touch, so
    // this is the settled top edge on the very first frame. The margin is read
    // from the computed style rather than repeating .cust__card's 10px here,
    // which would be a second copy of a number the stylesheet owns.
    var bdBottom = backdrop.getBoundingClientRect().bottom;
    var cardMb = parseFloat(getComputedStyle(card).marginBottom) || 0;
    liftRoom(bdBottom - cardMb - card.offsetHeight);

    // Focus the group rather than the first swatch: landing on a swatch would
    // read as if it were the chosen one.
    try { backdrop.focus(); } catch (e) { /* focus is a nicety, never a blocker */ }
  }

  var gaps = missingApi();

  G.Customise = {
    // Measurable handle for the lead's re-verification: ready === true means
    // hub.js's CUSTOMISE button opens this modal rather than toasting.
    __probe: function () {
      return {
        ready: gaps.length === 0,
        missing: gaps.slice(),
        openSession: session ? { defId: session.defId, placedIdx: session.placedIdx, current: session.current } : null
      };
    }
  };

  if (gaps.length === 0) {
    G.Customise.open = open;
    G.Customise.close = close;
  }
})(window.Game = window.Game || {});
