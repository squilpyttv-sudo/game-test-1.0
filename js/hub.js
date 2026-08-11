/* ==========================================================================
   CS2 PRO SIMULATOR — js/hub.js
   The main hub screen: isometric room, idle animation, hold-to-edit direct
   manipulation of placed props, and the moving/sleeping bottom panels.

   SPEC-V17 §1/§2 — WHAT WENT AWAY, AND WHY IT ISN'T COMING BACK
   - The hub control row (EDIT ROOM / CAREER / STATS / SLEEP) is gone. CAREER
     and STATS are phone apps now (P3); SLEEP is a header button (P2); EDIT
     ROOM has no equivalent because there is NO EDIT MODE ANY MORE.
   - The horizontal edit tray is gone. Its job — "here is what you own but
     haven't placed" — is the phone's INVENTORY app, which hands an item back
     here through G.Hub.spawnIntoMoveState() at the bottom of this file.
   - The inspect popover is gone, along with its timer. Tapping a prop used to
     open a description card; that gesture now belongs to hold-to-edit, and a
     dormant popover would have fired mid-drag.
   The room is now ALWAYS editable: hold any placed prop for 600ms and it
   enters the Moving state (see the press/hold state machine below).
   ========================================================================== */
(function () {
  'use strict';

  var built = false;
  var active = false;
  var rafId = null;

  var lastFrameTs = 0;
  var packAnimTimes = {};   // placed-index -> rAF timestamp when it was boxed up
  var transitioning = false;
  var wasAsleep = false;    // edge-detects the asleep -> awake transition each frame (manual or auto wake)

  // Packing failsafe (SPEC-V4 §8): packingStartTs marks when the current
  // State.data.moving session began (rAF-timestamp space); once 10s have
  // elapsed with MOVE OUT still not ready, packingForceReady flips MOVE OUT
  // into a "force it" button that calls State.forceCommitMove() instead of
  // State.commitMove() on the far side of the travel transition. Both reset
  // to their idle state the instant `moving` goes falsy (cancel, force-out,
  // or a normal all-packed move-out).
  var packingStartTs = null;
  var packingForceReady = false;
  var forcedMoveOut = false;

  // pendingPlacement (SPEC-V5 §5u — replaces instant drop): a purely
  // client-side DRAFT. Nothing in State.data changes until ✓ PLACE commits
  // it — dragging a tray item onto a tile, or tapping an already-placed core
  // singleton (desk/chair/pc/monitor) to pick it up, both just populate this
  // and start rendering a translucent ghost + the ROTATE/PLACE buttons.
  // `moveIdx` is null for a brand-new placement (commits via
  // State.placeItem); otherwise it's the prop's index in state.placed being
  // repositioned in place (commits by mutating that entry directly — see
  // commitPendingPlacement()'s big comment on why that's necessary).
  var pendingPlacement = null; // { defId, x, y, rot, moveIdx }

  // ---- hold-to-edit gesture (SPEC-V17 §2.1) --------------------------------
  // ONE press object tracks the current primary pointer over the canvas, for
  // mouse and touch alike (pointer events, so there is no second code path to
  // keep in sync — the game is played on phones and developed with a mouse).
  //
  //   mode 'hold'      no draft open. A 600ms timer is armed on pointerdown;
  //                    if it survives, the prop under the finger enters the
  //                    Moving state and the mode upgrades to 'drag'. Moving
  //                    more than HOLD_SLOP px first disarms it — that was a
  //                    swipe, not a hold — and a release before it fires does
  //                    NOTHING AT ALL (§2.1: "a tap shorter than 600ms does
  //                    nothing"), which is why there is no tap branch here.
  //   mode 'drag'      a draft is open and the press started on the moving
  //                    prop itself: pointermove re-targets its tile live.
  //   mode 'retarget'  a draft is open and the press started elsewhere: a
  //                    release without travel moves the prop to that tile
  //                    (§2.3, "dragging OR tapping another tile").
  var HOLD_MS = 600;
  var HOLD_SLOP = 10;       // px of travel that reclassifies a hold as a pan
  var press = null;         // { pointerId, x0, y0, mode, timer, moved, fired, ring }

  // ---- hold timer ring (SPEC-V18 §1) ---------------------------------------
  // Nothing used to tell the player that HOLDING is the gesture — they pressed
  // a prop, saw nothing, and let go. A thin arc filling clockwise over the
  // same 600ms says "keep holding" without saying anything else: no flood
  // fill, no bounce, no particles. It lives on press.ring and is therefore
  // destroyed by the same endPress()/cancelPress() that already kill the
  // timer, so release-before-600ms and pan-cancel both erase it in the same
  // instruction that disarms the hold — there is no separate teardown to
  // forget. It is drawn on the CANVAS (renderHoldRing, called from loop()):
  // a DOM node would be a live tap target materialising under the finger,
  // which is the documented cause of this project's multi-tap bug
  // (HANDOFF §9.5 / SPEC-V17 §2.5).
  var RING_R = 17;          // canvas px — the canvas is CSS-pixel sized, see resize()
  var RING_W = 2;           // thin. Two pixels is the whole design.
  var RING_Z = 16;          // iso height of the ring's centre: ~mid-prop, not on the floor
  var RING_DELAY_MS = 90;   // a quick tap must never flash a ring before it disappears

  // ---- zoom & pan (SPEC-V7 §4) ----------------------------------------------
  // view.zoom is a multiplier on TOP of Iso.computeCamera()'s own "fit the
  // whole room" scale — 1 = that default framing, which SPEC-V7 §4 makes the
  // hard zoom-OUT floor ("maximum zoom-out = the whole room visible"). Since
  // that fit scale already changes with room size (§2 — "bigger rooms zoom
  // out more", see iso.js's computeCamera), the zoom-out floor tracks room
  // size automatically with zero extra bookkeeping here. view.panX/panY are
  // additional screen-pixel offsets, clamped every single call to getCamera()
  // (not just on the gesture handlers) against the room's projected bounds
  // (also supplied by computeCamera) so the room can never be dragged
  // off-screen — including after a room-size change (moving house) or a
  // canvas resize, neither of which needs its own special-case reset logic.
  /* ZOOM_MIN is the zoom-OUT floor, as a multiplier on Iso.computeCamera()'s
     own "fit the whole room" scale — so 1 means exactly "the whole room
     visible" (SPEC-V7 §4).

     V22 (owner item 5): that floor is too tight in the larger locations. The
     placement/stash discs are anchored ABOVE the prop being edited, so on a
     prop near the back wall of a big room they can sit past the top of the
     canvas with no way to pan further out — the room already fits, so
     getCamera() clamps panY to 0. The player could see the prop and not the
     buttons for it.

     The basement (4x4) keeps a floor of exactly 1: it is small enough that the
     room plus its chrome always fits, and letting it zoom out further would
     just add dead space around a tiny room. Everything larger gets 0.86, which
     is a ~16% wider view — enough to bring the discs back on screen without
     shrinking the room to the point where props stop being tappable. */
  var ZOOM_MIN_BASE = 1;
  var ZOOM_MIN_LARGE = 0.86;
  function zoomMin() {
    var g = window.Game.State && window.Game.State.currentGrid && window.Game.State.currentGrid();
    return (g && g.w > 4) ? ZOOM_MIN_LARGE : ZOOM_MIN_BASE;
  }
  var ZOOM_MAX = 3;
  var view = { zoom: 1, panX: 0, panY: 0 };

  /* ---- bottom sheet inset (TASKS-REMAINING #3) -----------------------------
     How many BACKING-STORE pixels at the bottom of the canvas are currently
     hidden behind a bottom-docked sheet (today: the customise/paint modal).
     getCamera() frames the room into `canvasH - sheetInset.current` instead of
     the full height, so the room lifts clear of the sheet and you can judge a
     colour on the prop you are actually painting.

     WHY AN INSET AND NOT A PAN. The obvious fix — "pan the camera up" — cannot
     work at the default zoom, and that is not a tuning problem. getCamera()
     below FORCES view.panY = 0 whenever the room already fits the canvas
     (`ideal.totalH <= canvasH`), which at ZOOM_MIN is the normal case. Any pan
     written from outside would be clamped straight back to 0 on the very next
     call. Shortening the viewport instead works WITH that clamp: idealFrame()
     re-centres the room into the shorter box, so the lift survives every
     subsequent getCamera() for free, and every hit-test stays correct because
     they all read the same camera.

     It also beats lifting only the edited prop: reframing clears EVERY prop,
     so there is no "did it clear?" arithmetic and no edge case for a prop in
     the corner. That is why no Hub.propScreenRect() was added — nothing needs
     it. bedScreenRect() below already reads getCamera(), so the tutorial's bed
     spotlight follows the lift automatically with no extra code.

     `current` eases toward `target` in loop() so the room glides up alongside
     the sheet's own .22s rise rather than snapping. Both are 0 whenever no
     sheet is up, which makes the whole mechanism inert in every other flow. */
  var sheetInset = { target: 0, current: 0 };
  var pinch = null; // active touch gesture: { pts: {pointerId: {x,y}}, lastDist } — see onCanvasPointerDown below

  var els = {};

  /* ---- context-menu icons (SPEC-V17 §2.4, ART-DIRECTION §2.5) -------------
     Authored SVG, 44x44, each drawing its own base disc so the <button> can
     stay a transparent, unstyled wrapper. The 2px near-black ring is
     ART-DIRECTION §2.1's outline rule; the light-top/dark-bottom pair of arcs
     inside it is §2.4's bevel, so these read as pressable discs and not flat
     circles. Colours are literal here for the same reason iso.js's are: this
     is authored art, not layout, and it must survive without a stylesheet.
     Palette: STASH is cardboard brown (matching the phone's INVENTORY app and
     the packing-crate prop), ROTATE is #4A4E8E, PLACE is #84E070 — §2.4. */
  var OUTLINE = '#0b0e1c';
  function discSvg(base, hi, lo, inner) {
    return '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false">' +
      '<circle cx="22" cy="22" r="20" fill="' + base + '" stroke="' + OUTLINE + '" stroke-width="2"/>' +
      '<path d="M6.6 18.2A16 16 0 0 1 30 8.2" fill="none" stroke="' + hi + '" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M37.4 25.8A16 16 0 0 1 14 35.8" fill="none" stroke="' + lo + '" stroke-width="2.4" stroke-linecap="round"/>' +
      inner + '</svg>';
  }
  // STASH — a cardboard box seen three-quarter on: lid flaps open, tape seam
  // down the front. Reads as "put it back in the box", which is literally
  // what it does (the item stays in `owned`, it just leaves the room).
  var ICON_STASH = discSvg('#A5713F', '#D8A469', '#6E4622',
    '<g stroke="' + OUTLINE + '" stroke-width="1.6" stroke-linejoin="round">' +
      '<path d="M12 20h20v12H12z" fill="#E0B583"/>' +
      '<path d="M12 20l4-5h12l4 5" fill="#C89257"/>' +
      '<path d="M22 15v5" fill="none"/>' +
      '<path d="M20 20h4v5h-4z" fill="#8A5A2E"/>' +
    '</g>');
  // ROTATE — a circular arrow with a solid arrowhead, drawn as a 270° arc so
  // the direction of travel is unmistakable at 44px.
  var ICON_ROTATE = discSvg('#4A4E8E', '#8288D6', '#2B2E58',
    '<g fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round">' +
      '<path d="M30.5 15.5a11 11 0 1 0 2.6 8.2"/>' +
    '</g>' +
    '<path d="M30.5 8.5l1.2 8.4-8.3-1.4z" fill="#FFFFFF"/>');
  // PLACE — a plain thick checkmark. Nothing clever: this is the commit
  // button and it must be readable at a glance mid-drag.
  var ICON_PLACE = discSvg('#84E070', '#C6F5BA', '#3E8A33',
    '<path d="M13 22.5l6 6 12-13" fill="none" stroke="#FFFFFF" stroke-width="4.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>');

  // CUSTOMISE (SPEC-V20 §7) — a 4th disc joining STASH/ROTATE/PLACE, shown
  // only for items State.isCustomisable() (package R, called defensively
  // below — it may not have landed yet) says can be customised: banner,
  // blind, neon sign, floor LED screen, RGB strip. Two authored glyphs, both
  // built from axis-aligned rects (same "16-bit", no-curve-for-curve's-sake
  // construction as main.js's pixicon set) rather than a smooth icon-font
  // shape, and both white per the brief — never an emoji, never a Unicode
  // glyph. Two base colours per the brief: #DE5285 (paint — fabric items,
  // banner/blind) and #00CCFF (LED — light-emitting items, neon/RGB/floor
  // screen). Which icon a given item gets is decided in isLedCustomiseItem()
  // below, next to the button-build code that calls it.
  var ICON_CUSTOMISE_PAINT = discSvg('#DE5285', '#F0A8C4', '#8A2F52',
    '<g stroke="' + OUTLINE + '" stroke-width="1.3" stroke-linejoin="miter">' +
      // bristle tip + ferrule + handle, drawn upright then rotated 45° as one
      // group so the brush reads as "mid-stroke" rather than a static prop.
      '<g transform="rotate(45 22 22)">' +
        '<path d="M18.5 7h7v6h-7z" fill="#FFFFFF"/>' +
        '<path d="M18 13h8v3h-8z" fill="#FFFFFF"/>' +
        '<path d="M19 16h6v13h-6z" fill="#FFFFFF"/>' +
      '</g>' +
      // paint dab dripping off the tip, bottom-left — the one curved touch,
      // there to read as "wet paint" rather than a bare pencil.
      '<path d="M12 30a3 3 0 1 0 4 4z" fill="#FFFFFF"/>' +
    '</g>');
  var ICON_CUSTOMISE_LED = discSvg('#00CCFF', '#A6ECFF', '#0A7FA0',
    '<g stroke="' + OUTLINE + '" stroke-width="1.3" stroke-linejoin="miter" fill="#FFFFFF">' +
      // bulb glass, neck, two base threads, cap — five stacked rects, same
      // "block per part" construction as the paintbrush above.
      '<path d="M16.5 7h11v13h-11z"/>' +
      '<path d="M18.5 20h7v3h-7z"/>' +
      '<path d="M18 23.5h8v2h-8z"/>' +
      '<path d="M18.5 26h7v2h-7z"/>' +
      '<path d="M19 28.5h6v2.5h-6z"/>' +
    '</g>' +
    // filament, a thin white zig-zag inside the glass — the one line-art
    // touch that makes the glyph read as a lit bulb rather than a plain jar.
    '<path d="M19.5 12l2 2.5-2 2.5 2 2.5" fill="none" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>');

  // ctxButtonHtml: the shared wrapper. `title`/`aria-label` carry the meaning
  // the icon implies, so the buttons are not mystery-meat to a screen reader.
  function ctxButtonHtml(id, label, title, icon) {
    return '<button type="button" class="hub__ctx-btn" id="' + id + '" ' +
      'aria-label="' + label + '" title="' + title + '">' + icon + '</button>';
  }

  // styleCtxButton: everything .hub__ctx-btn needs, applied once at build
  // time. Inline rather than in a stylesheet because this package owns no CSS
  // file this batch — see the markup comment in buildDom().
  function styleCtxButton(el) {
    var s = el.style;
    s.position = 'absolute';
    s.top = '0'; s.left = '0';
    s.zIndex = '5';
    s.width = '44px'; s.height = '44px';
    s.padding = '0'; s.margin = '0'; s.border = '0';
    s.background = 'transparent';
    s.lineHeight = '0';
    s.cursor = 'pointer';
    s.opacity = '0';
    s.pointerEvents = 'none';
    s.transform = 'translate(-50%, -50%) scale(.85)';
    s.transition = 'opacity .12s ease, transform .12s ease';
    s.webkitTapHighlightColor = 'transparent';
    s.touchAction = 'manipulation';
  }
  function showCtxButton(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
  }
  function hideCtxButton(el) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.transform = 'translate(-50%, -50%) scale(.85)';
  }

  /* ------------------------------------------------------------------- DOM */
  function buildDom() {
    var root = window.Game.Router.root('hub');
    root.innerHTML =
      '<div class="hub">' +
        '<div class="hub__canvas-wrap">' +
          '<canvas class="hub__canvas" id="hub-canvas"></canvas>' +
          '<canvas class="hub__transition-canvas" id="hub-transition-canvas"></canvas>' +
          '<div class="hub__location-badge" id="hub-location-badge">' +
            '<span class="hub__location-name" id="hub-location-name">LOCATION</span>' +
            '<span class="hub__location-rent" id="hub-location-rent"></span>' +
          '</div>' +
          // §3: energy drink — a can-in-a-circle button, top-right of the
          // playable area (mirrors the location badge sitting top-left), with
          // today's owned count shown BENEATH the circle rather than
          // overlapping it. State.drinkEnergyDrink()/energyDrinkStatus() (T)
          // already carry the full ok/reason contract — this is display +
          // wiring only.
          '<div class="hub__energy-drink" id="hub-energy-drink">' +
            '<button class="hub__energy-drink-btn" id="hub-energy-drink-btn" aria-label="Drink an energy drink" title="ENERGY DRINK">' +
              '<svg viewBox="0 0 24 24" class="hub__energy-drink-icon"><rect x="8" y="2.5" width="8" height="2.2" rx="0.6" fill="currentColor"/><path d="M7.2 5.2h9.6l-1.1 15a1.6 1.6 0 01-1.6 1.5H9.9a1.6 1.6 0 01-1.6-1.5l-1.1-15z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7.7 10.4h8.6" stroke="currentColor" stroke-width="1.3"/></svg>' +
            '</button>' +
            '<span class="hub__energy-drink-count" id="hub-energy-drink-count">0</span>' +
          '</div>' +
          // V22c (owner item 5) — CALMING SYRUP, its own button beside the can.
          // Same anatomy as the energy drink so the two read as one shelf; the
          // bottle silhouette and the purple fill are what tell them apart.
          // Authored SVG, no emoji (ART-DIRECTION §2.5).
          '<div class="hub__syrup" id="hub-syrup">' +
            '<button class="hub__energy-drink-btn hub__syrup-btn" id="hub-syrup-btn" aria-label="Drink calming syrup" title="CALMING SYRUP">' +
              '<svg viewBox="0 0 24 24" class="hub__energy-drink-icon">' +
                '<rect x="10" y="2" width="4" height="3" rx="0.5" fill="currentColor"/>' +
                '<path d="M9 5h6l1.6 3.4v11.4a1.7 1.7 0 01-1.7 1.7H9.1a1.7 1.7 0 01-1.7-1.7V8.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
                '<path d="M8.2 12.5h7.6v7.2a1 1 0 01-1 1H9.2a1 1 0 01-1-1z" fill="currentColor" opacity="0.85"/>' +
              '</svg>' +
            '</button>' +
            '<span class="hub__energy-drink-count" id="hub-syrup-count">0</span>' +
          '</div>' +
          '<div class="hub__sleep-dim" id="hub-sleep-dim">' +
            '<div class="hub__sleep-zzz" id="hub-sleep-zzz"><span>Z</span><span>z</span><span>Z</span></div>' +
          '</div>' +
          // SPEC-V14 §1: NIGHT + ROOM-INCOMPLETE banners moved inside
          // canvas-wrap (was flex siblings of canvas-wrap in the .hub column,
          // stealing height from the room and squashing it — same class of
          // bug §30 fixed for hub__edit-tray). Both share this one slot and
          // stack together since they can show simultaneously. z-index 3:
          // above the canvas, below the location badge/energy drink (4) and
          // ghost buttons (5), which get pushed down below the stack via
          // --hub-top-inset (set from JS in updateTopBannersInset) rather
          // than being covered by it.
          '<div class="hub__top-banners" id="hub-top-banners">' +
            '<div class="hub__room-banner" id="hub-room-banner">' +
              '<span class="hub__room-banner-text" id="hub-room-banner-text"></span>' +
            '</div>' +
            '<div class="hub__night-banner" id="hub-night-banner">' +
              '<span class="hub__night-banner-text">IT’S NIGHT — ENERGY REGEN STOPPED. SLEEP TO SEE MORNING.</span>' +
            '</div>' +
          '</div>' +
          // SPEC-V17 §2.4 — the floating context menu: three ROUND ICON
          // buttons that hover above the prop being moved. Every pixel of
          // their look is authored SVG (ART-DIRECTION §2.5 — no emoji, no
          // Unicode glyph doing icon duty), including the coloured disc each
          // icon sits on, so these need no stylesheet at all. That is
          // deliberate: css/style.css belongs to another package this batch,
          // and a button whose whole identity lives in its own markup cannot
          // be broken by a rule landing (or being deleted) over there.
          // Positioning is set from JS on state-change edges only — see
          // refreshContextMenu() and the §2.5 note on top of it.
          ctxButtonHtml('hub-ctx-stash', 'Stash this item', 'STASH', ICON_STASH) +
          ctxButtonHtml('hub-ctx-rotate', 'Rotate 90 degrees', 'ROTATE', ICON_ROTATE) +
          // CUSTOMISE (SPEC-V20 §7) — built unconditionally like the other
          // three (its icon is swapped between paint/LED on each refresh,
          // see refreshContextMenu()) and hidden by default; shown only for
          // an item State.isCustomisable() says can be customised.
          ctxButtonHtml('hub-ctx-customise', 'Customise this item', 'CUSTOMISE', ICON_CUSTOMISE_PAINT) +
          ctxButtonHtml('hub-ctx-place', 'Place here', 'PLACE', ICON_PLACE) +
        '</div>' +
        '<div class="hub__packing" id="hub-packing">' +
          '<div class="hub__packing-info">' +
            '<span class="hub__packing-title">PACKING MODE — TAP EVERY PROP</span>' +
            '<span class="hub__packing-counter" id="hub-packing-counter">PACKED 0 / 0</span>' +
          '</div>' +
          '<div class="hub__packing-actions">' +
            '<button class="btn" id="hub-packing-cancel">CANCEL MOVE</button>' +
            '<button class="btn btn--primary hub__packing-moveout" id="hub-packing-moveout">MOVE OUT</button>' +
          '</div>' +
        '</div>' +
        '<div class="hub__sleep" id="hub-sleep">' +
          '<div class="hub__sleep-info">' +
            '<span class="hub__sleep-title">ASLEEP</span>' +
            '<span class="hub__sleep-energy" id="hub-sleep-energy-text">0 / 100</span>' +
          '</div>' +
          '<div class="hub__sleep-bar"><div class="hub__sleep-bar-fill" id="hub-sleep-bar-fill"></div></div>' +
          '<div class="hub__sleep-actions">' +
            '<button class="btn hub__skip-night-btn" id="hub-skip-night-btn">SKIP NIGHT — WATCH A SHORT AD</button>' +
            '<button class="btn btn--primary hub__sleep-wake-btn" id="hub-sleep-wake-btn">WAKE UP</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    els.canvas = document.getElementById('hub-canvas');
    els.ctx = els.canvas.getContext('2d');
    els.ctx.imageSmoothingEnabled = false;
    els.transitionCanvas = document.getElementById('hub-transition-canvas');
    els.transitionCtx = els.transitionCanvas.getContext('2d');
    els.transitionCtx.imageSmoothingEnabled = false;
    els.locationBadge = document.getElementById('hub-location-badge');
    els.locationName = document.getElementById('hub-location-name');
    els.locationRent = document.getElementById('hub-location-rent');
    els.energyDrinkWrap = document.getElementById('hub-energy-drink');
    els.energyDrinkBtn = document.getElementById('hub-energy-drink-btn');
    els.syrupWrap = document.getElementById('hub-syrup');
    els.syrupBtn = document.getElementById('hub-syrup-btn');
    els.syrupCount = document.getElementById('hub-syrup-count');
    els.energyDrinkCount = document.getElementById('hub-energy-drink-count');
    els.sleepDim = document.getElementById('hub-sleep-dim');
    els.ctxStashBtn = document.getElementById('hub-ctx-stash');
    els.ctxRotateBtn = document.getElementById('hub-ctx-rotate');
    els.ctxCustomiseBtn = document.getElementById('hub-ctx-customise');
    els.ctxPlaceBtn = document.getElementById('hub-ctx-place');
    els.ctxButtons = [els.ctxStashBtn, els.ctxRotateBtn, els.ctxCustomiseBtn, els.ctxPlaceBtn];
    els.ctxButtons.forEach(styleCtxButton);
    els.canvasWrap = els.canvas.parentElement; // hub__canvas-wrap — see canvasPtToWrapPt above
    els.topBanners = document.getElementById('hub-top-banners');
    els.roomBanner = document.getElementById('hub-room-banner');
    els.roomBannerText = document.getElementById('hub-room-banner-text');
    els.nightBanner = document.getElementById('hub-night-banner');
    els.skipNightBtn = document.getElementById('hub-skip-night-btn');
    els.packing = document.getElementById('hub-packing');
    els.packingCounter = document.getElementById('hub-packing-counter');
    els.packingCancelBtn = document.getElementById('hub-packing-cancel');
    els.packingMoveOutBtn = document.getElementById('hub-packing-moveout');
    els.sleepPanel = document.getElementById('hub-sleep');
    els.sleepEnergyText = document.getElementById('hub-sleep-energy-text');
    els.sleepBarFill = document.getElementById('hub-sleep-bar-fill');
    els.sleepWakeBtn = document.getElementById('hub-sleep-wake-btn');

    els.sleepWakeBtn.addEventListener('click', onWakeUp);
    els.skipNightBtn.addEventListener('click', onSkipNightAd);
    els.canvas.addEventListener('click', onCanvasTap);
    // SPEC-V7 §4: mouse wheel (zooms toward the cursor) + two-finger pinch
    // (touch) on-canvas zoom. Registered once here, alongside every other
    // canvas listener above — the canvas element itself lives for the app's
    // whole session (buildDom() only ever runs once, guarded by `built`), so
    // there's nothing to remove on hub screen exit; the gesture-scoped
    // window listeners these start are added/removed per-gesture instead
    // (see onCanvasPointerDown/onCanvasPointerUp), same pattern as the
    // existing tray-drag onDragMove/onDragEnd above.
    els.canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    els.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    // SPEC-V17 §2 — the hold/drag layer. Separate handler from the pinch
    // tracker above (which is touch-only and only ever cares about the
    // 2-finger case) so mouse and touch share one code path here.
    els.canvas.addEventListener('pointerdown', onPressDown);
    // The room is a direct-manipulation surface now: the browser must not
    // steal a slow press for text selection, a long-press callout or a
    // scroll-start. touch-action is the touch half of that; the rest is
    // handled per-event in onPressDown.
    els.canvas.style.touchAction = 'none';
    els.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    els.locationBadge.addEventListener('click', function () {
      window.Game.UI.beep('click');
      window.Game.Router.go('locations');
    });
    els.energyDrinkBtn.addEventListener('click', onDrinkEnergyDrink);
    els.syrupBtn.addEventListener('click', onDrinkSyrup);
    els.packingCancelBtn.addEventListener('click', onCancelMove);
    els.packingMoveOutBtn.addEventListener('click', onMoveOut);

    // §11 multi-tap fix, still load-bearing (HANDOFF §9.5): these fire on
    // 'pointerdown', not 'click'. On a touch device a click is *synthesized*
    // after touchend by re-hit-testing the original target — so if anything
    // moves the button between touchstart and touchend, the browser cannot
    // confirm the click and the tap is silently dropped. These buttons sit
    // directly above the prop and therefore right under the player's finger
    // mid-drag, which is the worst possible case for that. Two rules keep it
    // safe, and both must stay: (1) refreshContextMenu() runs on state-change
    // edges ONLY, never from loop(); (2) the menu is HIDDEN outright for the
    // duration of a drag and only repositioned once the pointer is released
    // (see onPressMove/endPress), so a live tap target never travels under a
    // finger at all. preventDefault() also suppresses the compatibility
    // mouse/click events touch would otherwise still fire, so a single tap
    // can never double-execute.
    els.ctxStashBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      stashPendingPlacement();
    });
    els.ctxRotateBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      rotatePendingPlacement();
    });
    // CUSTOMISE (SPEC-V20 §7): same pointerdown-not-click, preventDefault +
    // stopPropagation contract as its three siblings above (§11 multi-tap
    // fix comment on STASH explains why). onCustomiseItem() only wires the
    // entry point — see its own comment for the exact hook this is waiting
    // on from the paint/colour-picker package.
    els.ctxCustomiseBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onCustomiseItem();
    });
    els.ctxPlaceBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // §2.4: PLACE is greyed when the tile underneath is red. It is also
      // genuinely inert then — a greyed button that still commits would be
      // worse than no greying at all.
      if (els.ctxPlaceBtn.disabled) {
        window.Game.UI.beep('miss');
        var blocked = pendingPlacement ? pendingTileCheck({
          x: pendingPlacement.x, y: pendingPlacement.y,
          roomVisual: window.Game.Iso.getRoomVisual(window.Game.State.data)
        }) : null;
        window.Game.UI.toast((blocked && blocked.reason) || 'CANNOT PLACE THERE', 'bad');
        return;
      }
      commitPendingPlacement();
    });

    window.Game.State.on('change', function () {
      // Defensive (per Package M's report): a 'change' can in principle fire
      // from a queued/async source (e.g. an ad-overlay callback resolving
      // after the player already backed out to the menu) after State.data
      // has gone back to null. Nothing downstream of syncHubChrome() expects
      // a null data — bail rather than let it throw.
      if (active && window.Game.State.data) syncHubChrome();
    });

    window.addEventListener('resize', resizeCanvas);

    // SPEC-V14 §3: mount the phone inside .hub__canvas-wrap, anchored
    // bottom:0 there — that edge IS the controls row's top edge (its next
    // flex sibling), so "above the SLEEP button" falls out for free with no
    // measurement needed. The open handset (~300-400px tall) still fits
    // entirely within canvas-wrap's own height, rising up over the room
    // canvas without ever needing to escape canvas-wrap's overflow:hidden.
    // Package P2 owns js/phone.js/css/phone.css; this is its one mount
    // point plus the refresh()/reset() hooks below.
    if (window.Game.Phone && window.Game.Phone.init) {
      window.Game.Phone.init(els.canvasWrap);
    }

    built = true;
  }

  // blockIfLocked: shared guard for EDIT ROOM / CAREER / STATS (SLEEP has its
  // own asleep-state guard) — while a move is in progress those four are
  // supposed to be entirely unusable (§8). The move-out packing panel already
  // physically replaces hub__controls while moving, so in practice this is a
  // defensive backstop against any stray click during the swap transition.
  // tournamentPending (SPEC-V5 §21): a bracket exists and hasn't finished —
  // the player must play it out before doing anything else that skips a day.
  function tournamentPending() {
    return window.Game.State.tournamentMatchAvailableToday();
  }

  // SPEC-V17 §1/§5: refreshNotifications() lived here and painted the red dot
  // on the hub's CAREER button plus the locked look on its SLEEP button. Both
  // buttons are gone with the control row, so the function went with them —
  // but the SIGNAL has not been lost, which §1 is explicit about. The phone's
  // CAREER app carries the dot now (P3, §5) and the header SLEEP button
  // carries the locked look (P2, §3); both derive it from the same two
  // sources this used to read, State.tournamentMatchAvailableToday() and
  // State.scrimQuotaStatus(). tournamentPending() above is still used by
  // onSleep() below, which is what actually refuses the tap.

  // SPEC-V5 §5r/§5u: shows a clear banner while the room is missing one of
  // the 5 minimum-viable pieces, naming exactly what's missing and what it
  // blocks — matches State.roomCompleteness()'s own gate list (PLAY/TRAIN/
  // STREAM/CASES/CAREER; SHOP, EDIT ROOM and SLEEP stay open on purpose).
  var ROOM_PIECE_NAMES = { bed: 'BED', desk: 'DESK', chair: 'CHAIR', pc: 'PC', monitor: 'MONITOR' };
  function refreshRoomBanner() {
    if (!els.roomBanner) return;
    var d = window.Game.State.data;
    // Same footing as the NIGHT banner — moving/asleep already replace the
    // whole bottom chrome, no room banner competing for that space then.
    if (!d || d.moving || d.asleep) {
      els.roomBanner.classList.remove('hub__room-banner--show');
      return;
    }
    var rc = window.Game.State.roomCompleteness ? window.Game.State.roomCompleteness() : null;
    if (!rc || rc.complete) {
      els.roomBanner.classList.remove('hub__room-banner--show');
      return;
    }
    var missing = (rc.missing || []).map(function (k) { return ROOM_PIECE_NAMES[k] || String(k).toUpperCase(); }).join(', ');
    els.roomBannerText.textContent = 'ROOM INCOMPLETE — MISSING ' + missing + '. PLAY / TRAIN / STREAM / CASES / CAREER ARE BLOCKED UNTIL YOU FURNISH IT.';
    els.roomBanner.classList.add('hub__room-banner--show');
  }

  // updateTopBannersInset: NIGHT + ROOM banners now overlay the top of
  // hub__canvas-wrap instead of pushing it (see hub__top-banners in
  // style.css) — the canvas never resizes. Instead, the location badge and
  // energy drink button (which used to sit at a hardcoded top: 8px) are
  // shifted down by however tall the visible banner stack is, via the
  // --hub-top-inset custom property read in their `top: calc(...)` rules.
  // Guarded by lastBannerInsetKey so this only touches the DOM (a layout
  // read + a style write) when which banners are showing actually changed —
  // this runs from syncHubChrome(), which itself only fires on real state
  // changes, but the loop() rAF still calls syncHubChrome() on some frames
  // (e.g. the asleep-flip path), so re-measuring unconditionally would still
  // risk thrashing style on those frames. Per §9.5, the location badge and
  // energy drink are live tap targets — repositioning them on every frame
  // (rather than only on the rare nightfall/room-incomplete edge) is exactly
  // the class of bug that breaks touch there, so this must stay diffed.
  var lastBannerInsetKey = null;
  function updateTopBannersInset() {
    if (!els.topBanners || !els.canvasWrap) return;
    var nightShown = els.nightBanner.classList.contains('hub__night-banner--show');
    var roomShown = els.roomBanner.classList.contains('hub__room-banner--show');
    // The ROOM banner wraps (its missing-items list is variable length and
    // must never be truncated — see hub__room-banner-text in style.css), so
    // its HEIGHT can change while it stays visible: furnishing one missing
    // piece can take the list from two lines to one. Keying only on which
    // banners are shown would leave a stale inset in that case, stranding the
    // location badge and energy drink at the taller offset. Include the text
    // itself so the measurement re-runs whenever the rendered content changes.
    var key = (nightShown ? 'N' : '-') + (roomShown ? 'R' : '-') +
              '|' + (roomShown ? (els.roomBannerText.textContent || '').length : 0);
    if (key === lastBannerInsetKey) return;
    lastBannerInsetKey = key;
    var h = (nightShown || roomShown) ? els.topBanners.offsetHeight : 0;
    els.canvasWrap.style.setProperty('--hub-top-inset', h + 'px');
  }

  function blockIfLocked() {
    if (!window.Game.State.data) return true; // defensive — see loop()'s comment
    if (window.Game.State.data.moving) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('FINISH MOVING OUT FIRST', 'bad');
      return true;
    }
    if (window.Game.State.data.asleep) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('YOU’RE ASLEEP', 'bad');
      return true;
    }
    // §17: defensive backstop mirroring main.js's streamNavLockReason() —
    // CAREER/SLEEP (and, harmlessly, EDIT ROOM/STATS too) must refuse while
    // live, same as the bottom nav. The hub screen shouldn't normally even
    // be reachable while Game.Stream.isLive() (the bottom-nav lock is the
    // primary fix — see js/main.js), but this covers any other path back to
    // it (e.g. a future Router.back() call) without duplicating that logic.
    if (window.Game.Stream && window.Game.Stream.isLive && window.Game.Stream.isLive()) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('YOU’RE LIVE — END THE STREAM FIRST', 'bad');
      return true;
    }
    return false;
  }

  // baseCamera: Iso.computeCamera()'s plain "whole room visible" fit camera
  // for the room's CURRENT size — the zoom-out floor and the un-zoomed
  // starting point for every gesture below.
  function baseCamera(canvasW, canvasH) {
    var roomVisual = window.Game.Iso.getRoomVisual(window.Game.State.data);
    return window.Game.Iso.computeCamera(canvasW, canvasH, roomVisual);
  }

  // idealFrame: the ox/oy that would perfectly center/edge-align the room at
  // an arbitrary `scale` (not just baseCamera()'s own fit scale) — the same
  // formula computeCamera() itself uses at scale=fit, generalized. Shared by
  // getCamera() (for clamping) and zoomAt() (for the "keep this screen point
  // fixed" math) so there's exactly one copy of it.
  function idealFrame(base, canvasW, canvasH, scale) {
    var ox = canvasW / 2 - (base.minSx + base.maxSx) / 2 * scale;
    var oy = -base.visualTop * scale;
    var totalH = (base.visualBottom - base.visualTop) * scale;
    if (totalH < canvasH) oy += (canvasH - totalH) / 2;
    return { ox: ox, oy: oy, totalH: totalH };
  }

  // getCamera: the ONE camera hub.js uses for rendering AND every hit-test
  // (tap-to-place, prop pick, ghost preview) — baseCamera() with the current
  // zoom/pan applied and clamped. Clamping happens here, on every call,
  // rather than only inside the gesture handlers, so it self-corrects after
  // anything that changes the base camera underneath it (room-size change,
  // canvas resize) without needing its own change-detection.
  // usableH: the vertical band of the canvas that is actually visible right
  // now — the full height minus anything a bottom-docked sheet is covering.
  // Everything that FRAMES the room (idealFrame's centring, and the pan clamp
  // below) measures against this; `base.scale` deliberately still comes from
  // the full canvas, so lifting the room never resizes it.
  function usableH(canvasH) {
    return Math.max(1, canvasH - sheetInset.current);
  }

  function getCamera(canvasW, canvasH) {
    var base = baseCamera(canvasW, canvasH);
    view.zoom = Math.max(zoomMin(), Math.min(ZOOM_MAX, view.zoom));
    var scale = base.scale * view.zoom;
    var visH = usableH(canvasH);
    var ideal = idealFrame(base, canvasW, visH, scale);

    // Shrink to fit the shorter band, but ONLY while a sheet is up. Lifting
    // alone is not enough: measured at 420x860 in the starting 4x4 room, the
    // room projects taller than the 432px left above the customise sheet, so
    // a prop on the front tile stayed 34px behind it however far the room
    // slid. Fitting the scale is what actually finishes the job the lift
    // starts — every prop clears, not just the ones that were already high.
    //
    // This deliberately overrides view.zoom for as long as the sheet is up. A
    // player who had zoomed in gets the whole room back while they pick a
    // colour, which is what they need to see, and their zoom returns intact
    // the moment the sheet closes because view.zoom itself is never written.
    // It also keeps faith with SPEC-V7 §4's floor — "maximum zoom-out = the
    // whole room visible" — against the viewport that actually exists now.
    if (sheetInset.current > 0 && ideal.totalH > visH) {
      scale *= visH / ideal.totalH;
      ideal = idealFrame(base, canvasW, visH, scale);
    }

    var contentW = (base.maxSx - base.minSx) * scale;
    if (contentW <= canvasW) {
      view.panX = 0;
    } else {
      var loX = canvasW - base.maxSx * scale - ideal.ox;
      var hiX = -base.minSx * scale - ideal.ox;
      view.panX = Math.max(loX, Math.min(hiX, view.panX));
    }

    if (ideal.totalH <= visH) {
      view.panY = 0;
    } else {
      var loY = visH - base.visualBottom * scale - ideal.oy;
      var hiY = -base.visualTop * scale - ideal.oy;
      view.panY = Math.max(loY, Math.min(hiY, view.panY));
    }

    return { ox: ideal.ox + view.panX, oy: ideal.oy + view.panY, scale: scale };
  }

  function resetView() { view.zoom = zoomMin(); view.panX = 0; view.panY = 0; }

  // zoomAt: multiplies the current zoom by `factor` (>1 zooms in, <1 zooms
  // out) while keeping the WORLD point currently under canvas-space (px, py)
  // fixed on screen at (px, py) — i.e. zoom toward that point, not toward
  // the room's center. Used by both the wheel handler (cursor position) and
  // the pinch handler (finger midpoint, called once per touchmove with the
  // ratio since the last frame — which is what makes a 2-finger drag pan at
  // the same time as it zooms: the anchor point tracks the moving midpoint).
  // The resulting pan is only a CANDIDATE — getCamera() clamps it against
  // the room's bounds on its very next call, which is what stops zooming
  // toward a point near the room's edge from dragging the room off-screen.
  function zoomAt(px, py, factor, canvasW, canvasH) {
    var before = getCamera(canvasW, canvasH);
    var worldX = (px - before.ox) / before.scale;
    var worldY = (py - before.oy) / before.scale;

    view.zoom = Math.max(zoomMin(), Math.min(ZOOM_MAX, view.zoom * factor));

    var base = baseCamera(canvasW, canvasH);
    var newScale = base.scale * view.zoom;
    // Same usable-height basis getCamera() frames against, or a zoom performed
    // while a sheet is up would anchor to a box the room is no longer in.
    var ideal = idealFrame(base, canvasW, usableH(canvasH), newScale);
    view.panX = (px - worldX * newScale) - ideal.ox;
    view.panY = (py - worldY * newScale) - ideal.oy;
  }

  // ---- mouse wheel zoom (SPEC-V7 §4) ---------------------------------------
  function onCanvasWheel(e) {
    if (!window.Game.State.data || window.Game.State.data.asleep || window.Game.State.data.moving) return;
    e.preventDefault();
    var canvas = els.canvas;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    var mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    // Exponential (multiplicative) factor per tick -> smooth, continuous
    // motion rather than a fixed step per scroll notch.
    var factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(mx, my, factor, canvas.width, canvas.height);
  }

  // ---- two-finger pinch zoom (SPEC-V7 §4, touch only — mouse uses wheel) --
  // pinch.pts tracks every currently-down TOUCH pointer on the canvas by id;
  // the gesture only actually zooms while exactly 2 are down. Re-using
  // zoomAt() with the finger-midpoint as the anchor, once per move, both
  // zooms by the change in finger spread AND pans with the midpoint if it
  // drifts — a natural two-finger pinch-and-drag.
  function pointDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) || 1; }

  function onCanvasPointerDown(e) {
    if (e.pointerType !== 'touch') return;
    if (!window.Game.State.data || window.Game.State.data.asleep || window.Game.State.data.moving) return;
    // A two-finger pinch and a one-finger hold are mutually exclusive: the
    // moment a second touch point lands, the edit gesture is abandoned so a
    // zoom can never drop a prop somewhere the player didn't intend.
    if (press && Object.keys(pinch ? pinch.pts : {}).length >= 1) cancelPress();
    if (!pinch) {
      pinch = { pts: {} };
      window.addEventListener('pointermove', onCanvasPointerMove);
      window.addEventListener('pointerup', onCanvasPointerUp);
      window.addEventListener('pointercancel', onCanvasPointerUp);
    }
    pinch.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pinch.pts);
    if (ids.length === 2) pinch.lastDist = pointDist(pinch.pts[ids[0]], pinch.pts[ids[1]]);
  }

  function onCanvasPointerMove(e) {
    if (!pinch || !(e.pointerId in pinch.pts)) return;
    pinch.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pinch.pts);
    if (ids.length !== 2) return; // 1 finger, or a stray 3rd — not a pinch
    e.preventDefault();
    var p0 = pinch.pts[ids[0]], p1 = pinch.pts[ids[1]];
    var dist = pointDist(p0, p1);
    var canvas = els.canvas;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    var mx = ((p0.x + p1.x) / 2 - rect.left) * scaleX, my = ((p0.y + p1.y) / 2 - rect.top) * scaleY;
    zoomAt(mx, my, dist / pinch.lastDist, canvas.width, canvas.height);
    pinch.lastDist = dist;
  }

  function onCanvasPointerUp(e) {
    if (!pinch) return;
    delete pinch.pts[e.pointerId];
    if (Object.keys(pinch.pts).length === 0) {
      window.removeEventListener('pointermove', onCanvasPointerMove);
      window.removeEventListener('pointerup', onCanvasPointerUp);
      window.removeEventListener('pointercancel', onCanvasPointerUp);
      pinch = null;
    }
  }

  function resizeCanvas() {
    var wrap = els.canvas.parentElement;
    var rect = wrap.getBoundingClientRect();
    els.canvas.width = Math.max(1, Math.round(rect.width));
    els.canvas.height = Math.max(1, Math.round(rect.height));
    els.transitionCanvas.width = els.canvas.width;
    els.transitionCanvas.height = els.canvas.height;
  }

  /* --------------------------------------------------------------- render */
  function loop(ts) {
    if (!active) return;
    // Defensive (per Package M's report of a null-data race under rapid
    // console hammering of sleep()/wake()): State.data only exists between
    // load() and an explicit return-to-menu, but this rAF loop's lifetime is
    // governed by `active`, not by data being loaded. Skip this frame's work
    // rather than let tickEnergy()/renderRoom() dereference a null State.data.
    if (!window.Game.State.data) { rafId = requestAnimationFrame(loop); return; }
    lastFrameTs = ts;

    // Ease the bottom-sheet lift (TASKS-REMAINING #3). A proportional step
    // rather than a timed tween: it needs no start timestamp, survives a
    // target that changes mid-flight, and settles in ~200ms, which is the
    // sheet's own .22s rise. Snapping the last half-pixel stops the camera
    // from being recomputed forever on a value nobody can see.
    if (sheetInset.current !== sheetInset.target) {
      var d = sheetInset.target - sheetInset.current;
      sheetInset.current = (Math.abs(d) < 0.5) ? sheetInset.target : sheetInset.current + d * 0.18;
      refreshContextMenu();
    }

    // Real-time energy + day/night reconcile (SPEC-V3 §1/§2). Cheap and
    // safe to call every frame per Package F's contract — this is what
    // keeps the backdrop's sunset gradient interpolating smoothly instead
    // of stepping once per UI tick, and what resolves an auto-wake the
    // instant it happens while the player is sitting on the hub screen.
    var tick = window.Game.State.tickEnergy();
    var isAsleep = !!(tick && tick.asleep);
    if (tick && tick.autoWoke) {
      onWakeResolved(Object.assign({ ok: true, auto: true }, tick.autoWoke));
    } else if (wasAsleep && !isAsleep) {
      // Defensive: asleep flipped to false some other way (shouldn't happen
      // outside onWakeUp(), which already syncs chrome itself) — keep chrome
      // in sync regardless of how it happened.
      syncHubChrome();
    }
    wasAsleep = isAsleep;

    // Packing failsafe timer (SPEC-V4 §8) — wall-clock via rAF timestamps,
    // independent of the 'change' event stream so it advances even if the
    // player just sits there not tapping props.
    if (window.Game.State.data.moving) {
      if (packingStartTs === null) packingStartTs = ts;
      if (!packingForceReady && (ts - packingStartTs) >= 10000) {
        packingForceReady = true;
        refreshPackingUI();
      }
    } else if (packingStartTs !== null || packingForceReady) {
      packingStartTs = null;
      packingForceReady = false;
    }
    // canWake() ticks internally (Package F: "it ticks internally each
    // call") and every tick emits 'change' — so it must be called at most
    // once here, OUTSIDE any 'change' listener chain, and its result handed
    // down rather than re-fetched. Calling it again from inside
    // syncHubChrome()/refreshSleepUI() (which run FROM a 'change' listener)
    // would re-enter emit() synchronously and recurse until the stack blows.
    if (isAsleep) updateSleepUI(window.Game.State.canWake());

    var ctx = els.ctx, canvas = els.canvas;
    // §4 — sleeping is always night: State.tickEnergy()'s sunsetProgress is
    // frozen at whatever phase the player fell asleep in (computePhase()
    // reads wakeElapsedMs, which stops advancing the instant asleep=true —
    // that's WAI for energy/day logic, see state.js). Presentation-only
    // override here: force the backdrop to full night (1) while asleep,
    // whatever the frozen value says, so falling asleep at noon still shows
    // the moon. Waking reads the real (unfrozen) value again next frame.
    window.Game.Iso.renderRoom(ctx, canvas.width, canvas.height, window.Game.State.data, {
      time: ts,
      // V17: the old editMode/highlightTile pair fed the tray-drag hover
      // preview, which no longer exists — renderGhost() below owns the whole
      // valid/invalid highlight now, footprint-aware, for the Moving state.
      // renderRoom() still accepts them for any other caller.
      // SPEC-V17 §2.2: while a placed prop is being moved it is drawn by
      // renderGhost() below — lifted, shadowed, at its DRAFT tile. Suppress
      // renderRoom()'s own copy of it at its settled tile, or the player sees
      // the prop in two places at once and cannot tell which one is real.
      hideIdxs: (pendingPlacement && pendingPlacement.groupIdxs) || null,
      packAnimTimes: packAnimTimes,
      sunsetProgress: isAsleep ? 1 : (tick ? tick.sunsetProgress : 0),
      camera: getCamera(canvas.width, canvas.height) // SPEC-V7 §4 — zoom/pan
    });

    // SPEC-V20 §6 — the low-energy "go sleep" nudge: a pulsing yellow
    // outline around every placed bed. Self-gating (draws nothing above 20%
    // energy, asleep, dead or while packing to move out), so no condition
    // here — same convention as the hold-ring below.
    renderBedPulse(ctx, canvas.width, canvas.height, ts);

    // Moving-state preview (SPEC-V17 §2.2) — the lifted prop, its cast
    // shadow and the green/red footprint highlight, on top of the room.
    // No longer gated on an edit mode; a draft being open IS the state.
    if (pendingPlacement) {
      renderGhost(ctx, canvas.width, canvas.height, ts);
    }

    // SPEC-V18 §1 — the hold-timer ring. Self-gating (it draws nothing unless
    // a 'hold' press is armed on a pickable prop), so no condition here.
    renderHoldRing(ctx, canvas.width, canvas.height, ts);

    // COUNTING SHEEP (§7) — drawn on top of the just-rendered room every
    // frame while asleep. This file owns the ONLY rAF loop on this screen
    // (see the onExit cancelAnimationFrame below); js/sheep.js has none of
    // its own, so update()/render() piggyback on this same frame instead of
    // racing a second timer. isAsleep is this frame's freshly-recomputed
    // value (not a stale flag), so a wake — manual, auto, or ad-skipped —
    // stops the minigame the very frame it happens.
    if (isAsleep && window.Game.Sheep && window.Game.Sheep.isActive()) {
      window.Game.Sheep.update(ts);
      window.Game.Sheep.render(ctx, canvas.width, canvas.height, ts, window.Game.State.sheepStatus());
    }
    rafId = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------- tap logic */
  function tileFromClient(clientX, clientY) {
    var canvas = els.canvas;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    var sx = (clientX - rect.left) * scaleX, sy = (clientY - rect.top) * scaleY;
    var roomVisual = window.Game.Iso.getRoomVisual(window.Game.State.data);
    var camera = getCamera(canvas.width, canvas.height);
    var g = window.Game.Iso.screenToGrid(sx, sy, camera);
    return { x: Math.floor(g.x), y: Math.floor(g.y), roomVisual: roomVisual };
  }

  // tileValid/tileCheck (SPEC-V12 §1/§2/§3): thin wrappers deriving from
  // State.canPlaceFootprint() — the SAME footprint/occupancy/co-tenancy rule
  // (bed-corner reservation, desk+pc+monitor co-tenancy, monitor-needs-desk,
  // multi-tile bed footprint) used everywhere else, so hub.js never keeps a
  // second copy of it (§3). `rot` defaults to 0 — a brand new item from the
  // tray always starts unrotated (see beginPendingPlacement's callers).
  // tileCheck returns the full { ok, reason } so callers always have a
  // toast-ready reason (§4); tileValid is the boolean-only convenience used
  // by call sites that don't need the reason text.
  function tileCheck(tile, itemDef, rot) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= tile.roomVisual.gridW || tile.y >= tile.roomVisual.gridD) {
      return { ok: false, reason: 'CANNOT PLACE THERE' };
    }
    return window.Game.State.canPlaceFootprint(itemDef, tile.x, tile.y, rot || 0, -1);
  }
  function tileValid(tile, itemDef, rot) {
    return tileCheck(tile, itemDef, rot).ok;
  }

  // placementFailMessage (§10, extended by SPEC-V12 §4): picks the specific
  // "why not" toast for a rejected drop instead of a blanket "CANNOT PLACE
  // THERE" — now just reads the reason tileCheck()/State.canPlaceFootprint()
  // already computed rather than re-deriving desk/monitor logic locally.
  function placementFailMessage(tile, itemDef, rot) {
    return tileCheck(tile, itemDef, rot).reason || 'CANNOT PLACE THERE';
  }

  // isCoreSingleton (SPEC-V5 §5r/§5u, SPEC-V6 §24): desk/chair/pc/monitor/bed
  // — movable, but never removable to inventory while it's the last placed
  // instance of its category (State.removePlacedAt already blocks that at
  // the data layer). Reads state.js's own exported SINGLETON_ROOM_CATEGORIES
  // (the single source of truth) instead of keeping a separate hardcoded
  // copy — a prior drift between two hardcoded lists here is what made
  // tapping a placed bed a silent no-op (it fell through to removePlacedAt,
  // which correctly refused, but hub.js never routed the tap into the
  // move/rotate draft because its own copy of the list didn't include
  // 'bed'). Falls back to the literal only if the export is missing, so a
  // partial load can never throw.
  var FALLBACK_SINGLETON_ROOM_CATEGORIES = ['desk', 'pc', 'chair', 'monitor', 'bed'];
  function isCoreSingleton(category) {
    var list = (window.Game && window.Game.State && window.Game.State.SINGLETON_ROOM_CATEGORIES) || FALLBACK_SINGLETON_ROOM_CATEGORIES;
    return list.indexOf(category) !== -1;
  }

  // placedCountInCategory (§24): how many currently-PLACED props share this
  // category. Category counting itself isn't singleton-specific, so no list
  // lookup is needed here — see isCoreSingleton() above for the shared
  // source of truth used to decide which categories the count matters for.
  function placedCountInCategory(category) {
    var placed = window.Game.State.data.placed;
    var count = 0;
    for (var i = 0; i < placed.length; i++) {
      var d = window.Game.State.findShopItem(placed[i].id);
      if (d && d.category === category) count++;
    }
    return count;
  }

  // performCoreSwap (SPEC-V13 §4C): tapping a core item you OWN but have NOT
  // placed, when that category's slot is already filled, must swap it in
  // immediately — no ghost draft opens, because there is no tile to choose.
  // State.placeItem() (§4A) always lands a swap on the incumbent's own exact
  // x/y/rot and ignores the requested one, so the (0,0,0) passed here is
  // never actually used except on the defensive fallback below. Only called
  // from a site that has already confirmed an incumbent exists
  // (placedCountInCategory(def.category) >= 1).
  function performCoreSwap(def) {
    var res = window.Game.State.placeItem(def.id, 0, 0, 0);
    if (!res.ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast(res.reason || 'CANNOT PLACE THERE', 'bad');
      return;
    }
    window.Game.UI.beep('cash');
    if (res.replaced) {
      window.Game.UI.toast(def.name + ' SWAPPED IN — ' + res.replaced + ' RETURNED TO STORAGE', 'good');
    } else {
      // Defensive only: the call site already checked an incumbent exists,
      // so this branch should be unreachable, but a refusal or surprise
      // outcome must never be silent (§10 — every action explains itself).
      window.Game.UI.toast(def.name + ' PLACED', 'good');
    }
    notifyInventoryChanged();
  }

  // pendingTileCheck/pendingTileValid (SPEC-V12 §1/§3 — REGRESSION FIX): the
  // draft's own validity check, used to gate the ✓ PLACE button, decide
  // whether re-tapping the canvas moves the ghost, and (via
  // rotatePendingPlacement below) whether a rotation is allowed. The OLD
  // version had a relaxed branch here that returned true unconditionally for
  // any "moving a core singleton" case (bounds + bed-corner aside) — that
  // hole is what let props stack on tiles that should've been exclusive (see
  // the long comment above State.canPlaceFootprint in js/state.js for the
  // full root-cause writeup). There is no relaxed branch any more: a MOVE
  // validates through the exact same State.canPlaceFootprint() a fresh
  // placement does (State.canMoveItem — same function, just with the item's
  // own placed-array slot excluded so it never blocks against itself), so
  // moving validates identically to placing, every time.
  function pendingTileCheck(tile, rotOverride) {
    if (!pendingPlacement) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (!def) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var rot = rotOverride == null ? pendingPlacement.rot : rotOverride;
    if (tile.x < 0 || tile.y < 0 || tile.x >= tile.roomVisual.gridW || tile.y >= tile.roomVisual.gridD) {
      return { ok: false, reason: 'CANNOT PLACE THERE' };
    }
    // SPEC-V13 §3B: a group draft (workstation move, or any single-member
    // group — moveIdx is always core-singleton-only, see
    // beginPendingPlacement's comment) routes through State.canMoveGroup()
    // instead of State.canMoveItem(), so a desk drags its pc/monitor with it
    // through the SAME validation a settled desk+pc+monitor already shares.
    if (pendingPlacement.groupIdxs) {
      return window.Game.State.canMoveGroup(pendingPlacement.groupIdxs, tile.x, tile.y, rot);
    }
    if (pendingPlacement.moveIdx != null) {
      return window.Game.State.canMoveItem(pendingPlacement.moveIdx, tile.x, tile.y, rot);
    }
    return window.Game.State.canPlaceFootprint(def, tile.x, tile.y, rot, -1);
  }
  function pendingTileValid(tile) {
    return pendingTileCheck(tile).ok;
  }

  // beginPendingPlacement: opens (or replaces) the draft. `moveIdx` is null
  // for a fresh tray item; otherwise it's the existing placed-array index
  // being picked up and repositioned. Never touches State.data.
  //
  // SPEC-V13 §3B: `moveIdx` is (today) ONLY ever set from the core-singleton
  // move-draft tap site below — decor/energy/regen items never get a
  // move-draft, they're picked straight back to storage on tap — so every
  // moveIdx is safe to run through State.groupIndicesFor() unconditionally.
  // For a standalone item (not sharing a desk's tile) that just yields
  // [moveIdx] back, identical to today's single-item behaviour. Derived, not
  // reimplemented — see the "second most expensive rule" in SPEC-V13 §0.
  function beginPendingPlacement(def, x, y, rot, moveIdx) {
    var groupIdxs = null;
    if (moveIdx != null) {
      groupIdxs = window.Game.State.groupIndicesFor ?
        window.Game.State.groupIndicesFor(moveIdx) : [moveIdx]; // defensive fallback only, never a reimplementation
    }
    // SPEC-V15-BATCH-B §1: rotation is DERIVED for a wall mount, never the
    // caller's requested rot — State.wallRotForTile() is state.js's one
    // source of truth for this, so hub.js never guesses a facing here, it
    // only asks. State.placeItem/moveItem re-derive it again at commit time
    // regardless, but deriving it up front too keeps the DRAFT's ghost art
    // honest before the player ever taps PLACE.
    var draftRot = (def.mount === 'wall' && window.Game.State.wallRotForTile) ?
      window.Game.State.wallRotForTile(x, y) : (rot || 0);
    pendingPlacement = { defId: def.id, x: x, y: y, rot: draftRot, moveIdx: moveIdx == null ? null : moveIdx, groupIdxs: groupIdxs };
    notifyInventoryChanged();
    refreshContextMenu();
  }

  // notifyInventoryChanged: what renderTray() used to be. The tray is gone
  // (SPEC-V17 §1) and its "owned minus placed" readout now lives in the
  // phone's INVENTORY app, which derives its counts from State.data.owned /
  // .placed on refresh — so every site that used to redraw the tray just
  // pokes the phone instead. Placing and stashing both change those counts,
  // and neither necessarily emits a State 'change' at the moment the DRAFT
  // opens, which is why this is called explicitly rather than left to the
  // 'change' listener.
  function notifyInventoryChanged() {
    if (window.Game.Phone && window.Game.Phone.refresh) window.Game.Phone.refresh();
  }

  // rotatePendingPlacement (SPEC-V12 §2/§4): re-validates the NEW rotation
  // at the draft's current tile before applying it — a footprint prop (bed)
  // lying along x may not have room to rotate along y. A 1x1 prop (desk/pc/
  // chair/monitor) always passes this (its footprint is a single tile it
  // already excludes itself from), so their existing tap-to-rotate behavior
  // is unchanged. A refusal never happens silently (§4) — beep+toast explain
  // why, and the rotation is not applied.
  function rotatePendingPlacement() {
    if (!pendingPlacement) return;
    // SPEC-V15-BATCH-B §1: defensive — the ROTATE button is hidden entirely
    // for a wall mount (refreshContextMenu), so this shouldn't be
    // reachable, but a manual rotation must never fight the derived one.
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (def && def.mount === 'wall') return;
    var newRot = (pendingPlacement.rot + 1) % 4;
    var roomVisual = window.Game.Iso.getRoomVisual(window.Game.State.data);
    var tile = { x: pendingPlacement.x, y: pendingPlacement.y, roomVisual: roomVisual };
    var check = pendingTileCheck(tile, newRot);
    if (!check.ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast(check.reason === 'CANNOT PLACE THERE' ? 'NOT ENOUGH ROOM TO ROTATE' : check.reason, 'bad');
      return;
    }
    window.Game.UI.beep('click');
    pendingPlacement.rot = newRot;
    refreshContextMenu();
  }

  // isCustomisableDef (SPEC-V20 §7): package R's State.isCustomisable() is
  // the actual gate — called DEFENSIVELY here, exactly like js/sponsors.js
  // calls G.Phone.open(), so this file works whether or not R has landed
  // yet. If the API is missing the button simply never shows, rather than
  // this file guessing at the rule (banner/blind/neon/floor-screen/RGB-strip)
  // a second time.
  function isCustomisableDef(def) {
    return !!(def && window.Game.State &&
      typeof window.Game.State.isCustomisable === 'function' &&
      window.Game.State.isCustomisable(def.id));
  }

  // isLedCustomiseItem: which of the two authored glyphs/palettes (§7) a
  // customisable item gets — #00CCFF + lightbulb for the three light-
  // emitting items, #DE5285 + paintbrush for the two fabric ones (banner,
  // blind). data.js carries no explicit flag for this split yet, so it is
  // read off the known LED item ids; a `def.ledCustomise` flag (if package R
  // ever adds one) is honoured first so this heuristic can be dropped later
  // without another hub.js change.
  var LED_CUSTOMISE_IDS = ['neon_sign', 'rgb_strip', 'lucky_mousepad'];
  function isLedCustomiseItem(def) {
    if (!def) return false;
    if (typeof def.ledCustomise === 'boolean') return def.ledCustomise;
    return LED_CUSTOMISE_IDS.indexOf(def.id) !== -1;
  }

  // onCustomiseItem: SPEC-V20 §7 — H only wires this ENTRY POINT. The actual
  // paint/colour-picker modal is a separate, later package, so this calls a
  // clearly-named hook (window.Game.Customise.open) the SAME defensive way
  // isCustomisableDef() above calls State.isCustomisable(), and falls back to
  // an honest toast when that hook hasn't landed yet — never a silent no-op,
  // never a placeholder modal invented here that the real one would have to
  // replace later.
  //
  // EXACT API THIS FILE NEEDS FROM THAT PACKAGE (report this in the
  // hand-off): window.Game.Customise.open(defId, placedIdx) — defId is the
  // shop item id (pendingPlacement.defId), placedIdx is its index into
  // State.data.placed (pendingPlacement.moveIdx, which is what this button is
  // only ever reachable through — a customisable item is always already a
  // placed prop being moved when this menu is up). No return value expected;
  // the modal owns opening/closing itself the same way js/phone.js does.
  function onCustomiseItem() {
    if (!pendingPlacement) return;
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (!isCustomisableDef(def)) return; // defensive: button should already be hidden
    window.Game.UI.beep('click');
    if (window.Game.Customise && typeof window.Game.Customise.open === 'function') {
      window.Game.Customise.open(pendingPlacement.defId, pendingPlacement.moveIdx);
    } else {
      window.Game.UI.toast('CUSTOMISATION IS COMING SOON', 'good');
    }
  }

  // cancelPendingPlacement: discards the draft with no side effects on
  // State.data at all — safe to call any time (leaving EDIT ROOM, moving
  // out, etc.) since a placement is never written until commit.
  /* notePlacementSettled — tells js/phone.js a placement finished, so a
     placement that STARTED in the inventory app can hand the player back to
     that grid (owner item 14: placing five things in a row should not mean
     five trips back through the phone).

     Probed defensively, the same way Customise.open is above: an older
     phone.js without afterPlacement simply keeps the old behaviour. The phone
     owns the "did this come from the inventory?" flag — the hub deliberately
     does not track where a placement was launched from. */
  function notePlacementSettled(committed) {
    var P = window.Game.Phone;
    if (P && typeof P.afterPlacement === 'function') {
      try { P.afterPlacement(committed); } catch (e) { /* never block on the return trip */ }
    }
  }

  function cancelPendingPlacement() {
    pendingPlacement = null;
    refreshContextMenu();
    // false — a discarded draft clears the flag without reopening the phone.
    notePlacementSettled(false);
  }

  function commitPendingPlacement() {
    if (!pendingPlacement) return;
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (!def) { cancelPendingPlacement(); return; }
    var roomVisual = window.Game.Iso.getRoomVisual(window.Game.State.data);
    var tile = { x: pendingPlacement.x, y: pendingPlacement.y, roomVisual: roomVisual };
    var check = pendingTileCheck(tile);
    if (!check.ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast(check.reason || 'CANNOT PLACE THERE', 'bad');
      return;
    }
    if (pendingPlacement.moveIdx != null) {
      // Repositioning an already-placed CORE prop (SPEC-V5 §5u). State.js
      // owns the mutation now too — same validation as above, plus the
      // actual x/y/rot write(s) and save/commit, so this is never a second
      // copy of the validation. Never touches owned/placed COUNTS or
      // inventory, only x/y/rot, which is exactly "moving only, not
      // collectable" per spec.
      //
      // SPEC-V13 §3B: routes through State.moveGroup() with the SAME
      // groupIdxs pendingTileCheck() already validated against, so a desk
      // move commits its pc/monitor together, all-or-nothing, in one
      // commit() — never State.moveItem() alone, which would strand them.
      var placedArr = window.Game.State.data.placed;
      var entry = placedArr[pendingPlacement.moveIdx];
      if (!entry || entry.id !== pendingPlacement.defId) { cancelPendingPlacement(); return; }
      var groupIdxs = pendingPlacement.groupIdxs || [pendingPlacement.moveIdx];
      var moveResult = window.Game.State.moveGroup(groupIdxs, pendingPlacement.x, pendingPlacement.y, pendingPlacement.rot);
      if (!moveResult.ok) {
        window.Game.UI.beep('miss');
        window.Game.UI.toast(moveResult.reason || 'CANNOT PLACE THERE', 'bad');
        return;
      }
      window.Game.UI.beep('cash');
      window.Game.UI.toast(groupIdxs.length > 1 ? 'WORKSTATION MOVED' : (def.name + ' MOVED'), 'good');
    } else {
      // §10: State.placeItem() validates through the same
      // State.canPlaceFootprint() this whole draft already checked, so a
      // monitor dropping onto a desk tile (or a bed's 2nd footprint tile)
      // is handled identically to every other category's placement.
      // SPEC-V13 §4A: placeItem()'s return type changed from a bare boolean
      // to { ok, reason, replaced } — an object is ALWAYS truthy, so the old
      // `if (!ok)` here would have silently swallowed every real failure.
      // `replaced` is set (the swapped-out item's display name) when this
      // placement landed on an already-filled core slot and triggered a
      // SWAP IN PLACE instead of a fresh placement — the incoming item took
      // the incumbent's exact tile, so the draft's own tile is irrelevant to
      // the toast, only to which branch we're in.
      var res = window.Game.State.placeItem(def.id, pendingPlacement.x, pendingPlacement.y, pendingPlacement.rot);
      if (!res.ok) {
        window.Game.UI.beep('miss');
        window.Game.UI.toast(res.reason || 'CANNOT PLACE THERE', 'bad');
        return;
      }
      window.Game.UI.beep('cash');
      if (res.replaced) {
        window.Game.UI.toast(def.name + ' SWAPPED IN — ' + res.replaced + ' RETURNED TO STORAGE', 'good');
      } else {
        window.Game.UI.toast(def.name + ' PLACED', 'good');
      }
    }
    // SPEC-V17 §2.4 — a commit plays a placement particle burst as well as
    // the sound. UI.confetti() anchors on an element's bounding box; the
    // prop is canvas art with no element of its own, so it is handed a
    // synthetic rect at the prop's projected screen position. UI.confetti
    // only ever reads left/top/width/height, so this needs no throwaway DOM
    // node flashing in and out of the page mid-drag.
    placementBurst(pendingPlacement.x, pendingPlacement.y);
    pendingPlacement = null;
    refreshContextMenu();
    notifyInventoryChanged();
    // AFTER notifyInventoryChanged(), so the grid the player is handed back to
    // already reflects the item that just left it.
    notePlacementSettled(true);
  }

  // placementBurst: the §2.4 placement particle, anchored on the tile just
  // committed. Silently does nothing if the fx layer isn't up — a missing
  // flourish must never break a commit that already succeeded.
  function placementBurst(gx, gy) {
    if (!window.Game.UI || !window.Game.UI.confetti) return;
    var canvas = els.canvas;
    var camera = getCamera(canvas.width, canvas.height);
    var p = window.Game.Iso.project(gx + 0.5, gy + 0.5, 14, camera);
    var rect = canvas.getBoundingClientRect();
    var scaleX = rect.width / canvas.width, scaleY = rect.height / canvas.height;
    var cx = rect.left + p.x * scaleX, cy = rect.top + p.y * scaleY;
    window.Game.UI.confetti({
      getBoundingClientRect: function () {
        return { left: cx, top: cy, width: 0, height: 0, right: cx, bottom: cy };
      }
    }, '#84E070');
  }

  /* ---- STASH (SPEC-V17 §2.4) ----------------------------------------------
     Takes the prop being moved out of the room. It stays in `owned`, so the
     phone's INVENTORY count rises on its own with no second bookkeeping
     field — inventory is derived as owned-minus-placed (§5.1).

     The refusal case matters as much as the success case. State.removePlacedAt
     already refuses to remove the LAST placed instance of a core category
     (desk/pc/chair/monitor/bed) — a room without a bed is unplayable. §2.4:
     "never a silent no-op", so the refusal is detected BEFORE the call and
     explained by name. The pre-check reuses this file's existing
     isCoreSingleton() (which reads State.SINGLETON_ROOM_CATEGORIES, the one
     source of truth) plus placedCountInCategory() rather than inventing a
     second copy of the rule; it is needed up front because removePlacedAt()
     addresses props by TILE, and a desk shares its tile with a pc and a
     monitor, so a bare `false` return could not tell us which of the three
     was refused or why. */
  function stashPendingPlacement() {
    if (!pendingPlacement || !window.Game.State.data) return;
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (!def) { cancelPendingPlacement(); return; }

    // A draft for an item that was never placed (spawned from the phone's
    // inventory) is already "in storage" — stashing is just cancelling.
    if (pendingPlacement.moveIdx == null) {
      window.Game.UI.beep('click');
      window.Game.UI.toast(def.name + ' LEFT IN STORAGE', 'info');
      cancelPendingPlacement();
      return;
    }

    var entry = window.Game.State.data.placed[pendingPlacement.moveIdx];
    if (!entry || entry.id !== pendingPlacement.defId) { cancelPendingPlacement(); return; }

    if (isCoreSingleton(def.category) && placedCountInCategory(def.category) <= 1) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('YOUR ONLY ' + (ROOM_PIECE_NAMES[def.category] || String(def.category).toUpperCase()) +
        ' HAS TO STAY IN THE ROOM — BUY A REPLACEMENT FIRST', 'bad');
      return;
    }
    // Removal is addressed at the prop's SETTLED tile, not the draft tile —
    // the draft may have been dragged halfway across the room and nothing
    // has been written to State.data yet.
    var removed = window.Game.State.removePlacedAt(entry.x, entry.y);
    if (!removed) {
      // Defensive: the pre-check above should already have caught every
      // refusal state.js can produce here. Still never silent (§2.4).
      window.Game.UI.beep('miss');
      window.Game.UI.toast('CANNOT STASH ' + def.name + ' RIGHT NOW', 'bad');
      return;
    }
    window.Game.UI.beep('click');
    window.Game.UI.toast(def.name + ' STASHED — FIND IT IN YOUR PHONE’S INVENTORY', 'info');
    pendingPlacement = null;
    refreshContextMenu();
    notifyInventoryChanged();
  }

  // canvasPtToWrapPt: converts a point in CANVAS-PIXEL space (what
  // Iso.project()/tileFromClient() work in) into CSS pixels relative to
  // `.hub__canvas-wrap` — what the absolutely-positioned ghost buttons need.
  // Goes through getBoundingClientRect() on both elements rather than
  // assuming the canvas exactly fills its wrapper 1:1, since the canvas's
  // internal resolution and its on-page CSS size aren't always identical.
  function canvasPtToWrapPt(px, py) {
    var canvas = els.canvas;
    var wrap = canvas.parentElement;
    var canvasRect = canvas.getBoundingClientRect();
    var wrapRect = wrap.getBoundingClientRect();
    var scaleX = canvasRect.width / canvas.width, scaleY = canvasRect.height / canvas.height;
    return {
      x: (canvasRect.left - wrapRect.left) + px * scaleX,
      y: (canvasRect.top - wrapRect.top) + py * scaleY
    };
  }

  /* ---- the floating context menu (SPEC-V17 §2.4) --------------------------
     THE TRAP, spelled out because it has bitten this project before
     (HANDOFF §9.5, SPEC-V17 §2.5): loop() runs at 60fps and MUST NEVER call
     refreshContextMenu(). These three buttons are live tap targets that
     hover directly above the prop, i.e. right under the player's finger
     while they drag. Rewriting a tap target's left/top between a touchstart
     and the click the browser synthesises from it makes the browser fail to
     re-confirm the target and drop the tap silently — that is the documented
     cause of the multi-tap bug. Two defences, both required:
       1. This function is only ever called from a state-change EDGE — a
          draft opening, moving, rotating, committing, cancelling, or a
          drag ending. Never from a frame.
       2. hideContextMenu() is called the moment a drag actually starts, so
          for the whole time the finger is down and travelling there is no
          visible tap target to move at all. It comes back, repositioned
          once, on release.
     If you ever need the menu to track the prop continuously, the answer is
     still not to call this from loop() — it is to leave the menu hidden for
     the duration, exactly as the drag path does. */
  function hideContextMenu() {
    if (!els.ctxButtons) return;
    els.ctxButtons.forEach(hideCtxButton);
  }

  function refreshContextMenu() {
    if (!pendingPlacement || !window.Game.State.data) { hideContextMenu(); return; }
    // TASKS-REMAINING #3, second half: while a bottom sheet is up, the
    // STASH/ROTATE/CUSTOMISE/PLACE discs are already inert (the modal backdrop
    // eats every tap) but stayed drawn over the room behind it, which reads as
    // if they were still live. Hide them for as long as the sheet is up.
    //
    // Driven off sheetInset.target, NOT .current: the discs should go on the
    // frame the sheet is requested, not fade out with the lift, and .target is
    // the value that is always written on both edges. HANDOFF-V2 §5 lists "a
    // suppression flag written by nobody" as a real shipped bug, so this reads
    // the same field setSheetInset() sets rather than a second flag that could
    // drift out of sync with it.
    if (sheetInset.target > 0) { hideContextMenu(); return; }
    var canvas = els.canvas;
    var camera = getCamera(canvas.width, canvas.height);
    // Anchored above the draft tile's centre. z=28 is roughly a tall prop's
    // shoulder height, so the row clears the art it belongs to instead of
    // sitting across its face.
    var anchor = window.Game.Iso.project(pendingPlacement.x + 0.5, pendingPlacement.y + 0.5, 28, camera);
    var pt = canvasPtToWrapPt(anchor.x, anchor.y);

    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    // SPEC-V15-BATCH-B §1 (owner's report, HANDOFF §9.6), carried into V17
    // §2.4: a wall-mounted item's rotation is DERIVED from its wall, never
    // chosen. A ROTATE button that silently no-ops is what generated the
    // original bug reports, so it is hidden entirely rather than shown-but-
    // inert, and the remaining buttons re-centre on the anchor.
    var isWallMount = !!(def && def.mount === 'wall');
    // SPEC-V20 §7: CUSTOMISE only ever shows for an item State.isCustomisable
    // (defensive, see isCustomisableDef() above) actually says yes to.
    var showCustomise = isCustomisableDef(def);
    if (showCustomise) {
      // Icon/palette swap happens here, on this same state-change edge, not
      // from loop() — the button's SVG content changes, not its position, so
      // it cannot cause the multi-tap bug, but it still only belongs on an
      // edge like everything else in this function.
      els.ctxCustomiseBtn.innerHTML = isLedCustomiseItem(def) ? ICON_CUSTOMISE_LED : ICON_CUSTOMISE_PAINT;
    }
    var GAP = 50;

    // PLACE is greyed whenever the tile underneath is red (§2.4). Derived
    // from the same pendingTileCheck() the highlight colour uses, so the
    // button and the tile can never disagree.
    var roomVisual = window.Game.Iso.getRoomVisual(window.Game.State.data);
    var canPlace = pendingTileCheck({ x: pendingPlacement.x, y: pendingPlacement.y, roomVisual: roomVisual }).ok;
    els.ctxPlaceBtn.disabled = !canPlace;
    els.ctxPlaceBtn.style.filter = canPlace ? '' : 'grayscale(1)';
    els.ctxPlaceBtn.style.opacity = canPlace ? '1' : '.45';
    els.ctxPlaceBtn.title = canPlace ? 'PLACE' : 'CANNOT PLACE HERE';

    // Four possible rows, laid out around the same anchor point `pt`, GAP
    // apart. ROTATE and CUSTOMISE independently hide (a wall mount never
    // shows ROTATE; only a customisable def shows CUSTOMISE), so the row
    // re-centres itself for whichever subset is actually visible rather than
    // leaving a gap where a hidden button would have been.
    if (isWallMount) hideCtxButton(els.ctxRotateBtn);
    if (!showCustomise) hideCtxButton(els.ctxCustomiseBtn);

    if (isWallMount && showCustomise) {
      // STASH / CUSTOMISE / PLACE — a banner or blind, ROTATE hidden.
      showCtxButton(els.ctxStashBtn, pt.x - GAP, pt.y);
      showCtxButton(els.ctxCustomiseBtn, pt.x, pt.y);
      showCtxButton(els.ctxPlaceBtn, pt.x + GAP, pt.y);
    } else if (isWallMount) {
      // STASH / PLACE — any other wall mount (e.g. a window).
      showCtxButton(els.ctxStashBtn, pt.x - GAP / 2, pt.y);
      showCtxButton(els.ctxPlaceBtn, pt.x + GAP / 2, pt.y);
    } else if (showCustomise) {
      // STASH / ROTATE / CUSTOMISE / PLACE — a floor-standing customisable
      // item (neon sign, RGB strip, floor LED screen).
      showCtxButton(els.ctxStashBtn, pt.x - GAP * 1.5, pt.y);
      showCtxButton(els.ctxRotateBtn, pt.x - GAP / 2, pt.y);
      showCtxButton(els.ctxCustomiseBtn, pt.x + GAP / 2, pt.y);
      showCtxButton(els.ctxPlaceBtn, pt.x + GAP * 1.5, pt.y);
    } else {
      // STASH / ROTATE / PLACE — the original three, everything else.
      showCtxButton(els.ctxStashBtn, pt.x - GAP, pt.y);
      showCtxButton(els.ctxRotateBtn, pt.x, pt.y);
      showCtxButton(els.ctxPlaceBtn, pt.x + GAP, pt.y);
    }
    // showCtxButton wrote opacity:1 unconditionally — re-apply the disabled
    // dimming after it, so a red tile still reads as a dead PLACE button.
    if (!canPlace) els.ctxPlaceBtn.style.opacity = '.45';
  }

  // renderGhost: drawn every frame from loop(), AFTER the normal room render
  // — a translucent copy of the prop at its draft tile/rotation, sitting on
  // a green/red tile outline matching the existing drag-hover convention.
  // SPEC-V12 §2: the highlight now covers every tile in the item's
  // footprint (State.footprintTiles), not just its anchor tile — a bed's
  // ghost shows BOTH of its tiles red/green, not just the one it's anchored
  // on, so the valid/invalid preview is honest about what it actually needs.
  // SPEC-V13 §3B: a group draft (workstation move) must draw EVERY member's
  // art at the draft tile, not just the tapped one, so the ghost preview
  // shows what State.moveGroup() will actually move together. Drawn in the
  // same desk -> pc -> monitor order iso.js's renderRoom() already draws a
  // settled workstation, via the SAME Iso.CATEGORY_ORDER renderRoom() sorts
  // by (exported for exactly this reuse) — never a second hardcoded order.
  function groupGhostMembers() {
    if (!pendingPlacement.groupIdxs || pendingPlacement.groupIdxs.length <= 1) {
      return [pendingPlacement.defId];
    }
    var placed = window.Game.State.data.placed;
    var order = window.Game.Iso.CATEGORY_ORDER || {};
    var ids = pendingPlacement.groupIdxs
      .map(function (i) { return placed[i] && placed[i].id; })
      .filter(function (id) { return !!id; });
    ids.sort(function (a, b) {
      var da = window.Game.State.findShopItem(a), db = window.Game.State.findShopItem(b);
      var oa = (da && order[da.category]) || 0, ob = (db && order[db.category]) || 0;
      return oa - ob;
    });
    return ids.length ? ids : [pendingPlacement.defId];
  }

  function renderGhost(ctx, canvasW, canvasH, ts) {
    if (!pendingPlacement) return;
    var map = window.Game.Iso.propMap[pendingPlacement.defId];
    if (!map) return;
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    var roomVisual = window.Game.Iso.getRoomVisual(window.Game.State.data);
    var camera = getCamera(canvasW, canvasH);
    var ok = pendingTileValid({ x: pendingPlacement.x, y: pendingPlacement.y, roomVisual: roomVisual });

    var gx = pendingPlacement.x, gy = pendingPlacement.y;
    // SPEC-V17 §2.2 — the highlight covers the FULL footprint, not the
    // anchor tile. State.footprintTiles() is the single source for that
    // (§2.3: no second copy of the occupancy rules lives in this file), so a
    // bed shows both of its tiles green or both red, never one of each.
    var tiles = (def && window.Game.State.footprintTiles) ?
      window.Game.State.footprintTiles(def, gx, gy, pendingPlacement.rot) : [{ x: gx, y: gy }];
    function tileQuad(t, z) {
      return [
        window.Game.Iso.project(t.x, t.y, z, camera),
        window.Game.Iso.project(t.x + 1, t.y, z, camera),
        window.Game.Iso.project(t.x + 1, t.y + 1, z, camera),
        window.Game.Iso.project(t.x, t.y + 1, z, camera)
      ];
    }
    function fillQuad(q, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (var i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    // 1. the valid/invalid tile highlight, flat on the floor.
    tiles.forEach(function (t) { fillQuad(tileQuad(t, 0.5), ok ? '#3ddc84' : '#ff4b4b', 0.38); });

    // 2. the cast shadow — a dark, semi-transparent isometric diamond per
    //    footprint tile, inset a little so it reads as the prop's own shadow
    //    rather than a second tile highlight, and nudged down-right because
    //    the light in this art direction comes from the top-left
    //    (ART-DIRECTION §2.2 — top face is the lit one).
    tiles.forEach(function (t) {
      var q = tileQuad({ x: t.x + 0.12, y: t.y + 0.12 }, 0.7);
      var inset = [
        q[0], { x: q[1].x - 2, y: q[1].y }, { x: q[2].x, y: q[2].y - 1 }, { x: q[3].x + 2, y: q[3].y }
      ];
      fillQuad(inset, '#05070f', 0.42);
    });

    // 3. the prop itself, LIFTED a few screen px straight up. Done as a
    //    canvas translate rather than a world-Z offset on purpose: a Z
    //    offset would also shift it sideways through the isometric
    //    projection and slide it off the tile it is hovering over, which
    //    is the opposite of the "picked up, held above this tile" read.
    //    A slow breathing bob makes it obvious the prop is held and not
    //    merely selected.
    var lift = 5 + Math.round(Math.sin((ts || 0) / 420) * 1.5);
    ctx.save();
    ctx.translate(0, -lift);
    ctx.globalAlpha = 0.92;
    groupGhostMembers().forEach(function (memberId) {
      var memberMap = window.Game.Iso.propMap[memberId];
      if (!memberMap) return;
      window.Game.Iso.drawFamily(ctx, memberMap.family, gx, gy, memberMap.tier, camera, ts, pendingPlacement.rot);
    });
    ctx.restore();
  }

  /* ================================================================= §2
     HOLD-TO-EDIT — the state machine
     ---------------------------------------------------------------------
     There is no edit mode. The room is always editable, and the gesture that
     opens it is a 600ms hold on a placed prop.

     Everything below runs on POINTER events, so a finger and a mouse take the
     identical code path — this game ships on phones and is developed with a
     mouse, and a second, subtly-different touch path is how those two drift
     apart. onCanvasTap ('click') is left in place ONLY for the two modal
     screens that still want a plain tap and have nothing to do with editing:
     the packing minigame and counting sheep.
     ================================================================== */

  function onCanvasTap(e) {
    if (transitioning) return;
    if (!window.Game.State.data) return; // defensive — see loop()'s comment
    var canvas = els.canvas;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    var cx = (e.clientX - rect.left) * scaleX, cy = (e.clientY - rect.top) * scaleY;

    if (window.Game.State.data.moving) { handlePackTap(cx, cy); return; }
    if (window.Game.State.data.asleep) { handleSheepTap(cx, cy); return; } // §3/§7 — COUNTING SHEEP is the only thing to tap while asleep
    // Awake, not moving: a plain click does NOTHING here (§2.1 — "a tap
    // shorter than 600ms does nothing"). Editing is entirely owned by the
    // press/hold handlers below, which fire off pointer events.
  }

  // canEditNow: hold-to-edit is refused outright while a move-out is being
  // packed (the packing minigame owns every prop) or while asleep (the room
  // is dimmed and counting sheep owns the taps). Both are the same states
  // that used to hide the control row.
  function canEditNow() {
    var d = window.Game.State.data;
    return !!(d && !d.moving && !d.asleep && !transitioning);
  }

  // pressPointIsOnDraft: is this screen point on the prop currently being
  // moved? Used to tell "drag the held prop" from "tap a different tile to
  // send it there". Tests the DRAFT footprint via State.footprintTiles (the
  // one footprint source, §2.3) rather than re-deriving a hit box.
  function pressPointIsOnDraft(clientX, clientY) {
    if (!pendingPlacement) return false;
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (!def) return false;
    var tile = tileFromClient(clientX, clientY);
    var tiles = window.Game.State.footprintTiles ?
      window.Game.State.footprintTiles(def, pendingPlacement.x, pendingPlacement.y, pendingPlacement.rot) :
      [{ x: pendingPlacement.x, y: pendingPlacement.y }];
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].x === tile.x && tiles[i].y === tile.y) return true;
    }
    return false;
  }

  function onPressDown(e) {
    if (!canEditNow()) return;
    if (press) return;              // a press is already in flight; ignore extra pointers
    if (e.pointerType === 'touch' && pinch && Object.keys(pinch.pts).length > 1) return; // that's a pinch, not an edit

    press = {
      pointerId: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      moved: false, fired: false, timer: null,
      mode: pendingPlacement ? (pressPointIsOnDraft(e.clientX, e.clientY) ? 'drag' : 'retarget') : 'hold'
    };
    if (press.mode === 'hold') {
      // §2.1 — 600ms, and only 600ms. Anything shorter is not a hold.
      press.timer = setTimeout(onHoldFired, HOLD_MS);
      armHoldRing(e.clientX, e.clientY);
    }
    // Window-level, not canvas-level: a drag that leaves the canvas (or the
    // window) must still end cleanly rather than leaving the prop welded to
    // the pointer. Torn down in endPress().
    window.addEventListener('pointermove', onPressMove);
    window.addEventListener('pointerup', onPressUp);
    window.addEventListener('pointercancel', onPressUp);
  }

  // onHoldFired: 600ms survived. Pick whatever prop is under the original
  // press point and enter the Moving state for it. The finger is still down,
  // so the press upgrades to a drag — the player can hold-and-slide in one
  // continuous gesture, which is the whole point of direct manipulation.
  function onHoldFired() {
    if (!press || !canEditNow()) { cancelPress(); return; }
    press.timer = null;
    press.fired = true;
    var entered = enterMoveStateAt(press.x0, press.y0);
    if (!entered) { cancelPress(); return; }
    press.mode = 'drag';
    // Shown once, here, on this edge — see the trap note above
    // refreshContextMenu(). It is hidden again the instant the finger
    // travels, and repositioned once on release.
    refreshContextMenu();
  }

  // pickPropAtClient: THE hit-test for "is there a prop the hold gesture can
  // pick up under this screen point?". Extracted so the hold-timer ring
  // (§1, renderHoldRing below) is armed by the exact same rule that decides
  // whether the hold will do anything at all — a second, parallel "can this
  // be moved?" test here is how a ring starts spinning over bare floor.
  // Returns { picked, def } or null.
  function pickPropAtClient(clientX, clientY) {
    var canvas = els.canvas;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    var cx = (clientX - rect.left) * scaleX, cy = (clientY - rect.top) * scaleY;
    var picked = window.Game.Iso.pickProp(
      window.Game.State.data, canvas.width, canvas.height, cx, cy,
      getCamera(canvas.width, canvas.height));
    if (!picked) return null; // empty floor
    var def = window.Game.State.findShopItem(picked.id);
    if (!def) return null;
    return { picked: picked, def: def };
  }

  // enterMoveStateAt: hit-test a screen point and open a move draft on
  // whatever placed prop is there. Returns whether it found one.
  function enterMoveStateAt(clientX, clientY) {
    var hit = pickPropAtClient(clientX, clientY);
    if (!hit) return false; // held empty floor / unknown def — silently nothing
    var picked = hit.picked, def = hit.def;
    window.Game.UI.beep('click');
    // Every category goes through the SAME move draft now. This used to be
    // core-singletons-only, with decor being yanked straight back to storage
    // on a single tap; that asymmetry is gone with edit mode. Removal is the
    // STASH button's job (§2.4) and nothing else's, so no gesture can ever
    // remove a prop by accident.
    beginPendingPlacement(def, picked.x, picked.y, picked.rot || 0, picked.idx);
    return true;
  }

  // armHoldRing: attach the progress ring to the press that was just armed.
  // Guarded by pickPropAtClient() — the SAME test enterMoveStateAt() will run
  // when the timer fires — so the ring only ever appears where the hold is
  // actually going to pick something up. t0 is stamped here, next to the
  // setTimeout, and HOLD_MS is the same constant the timeout was given: the
  // ring reads its progress off that one pair, never off an interval of its
  // own, so the arc cannot finish early or late relative to the state change.
  function armHoldRing(clientX, clientY) {
    if (!press) return;
    var hit = pickPropAtClient(clientX, clientY);
    if (!hit) return;
    // Centre on the PROP, not on the finger: for a multi-tile prop (a bed)
    // that means the centroid of its footprint, via the one footprint source
    // (State.footprintTiles, §2.3), not the anchor tile's corner.
    var p = hit.picked;
    var tiles = window.Game.State.footprintTiles ?
      window.Game.State.footprintTiles(hit.def, p.x, p.y, p.rot || 0) : [{ x: p.x, y: p.y }];
    if (!tiles || !tiles.length) tiles = [{ x: p.x, y: p.y }];
    var sx = 0, sy = 0;
    for (var i = 0; i < tiles.length; i++) { sx += tiles[i].x + 0.5; sy += tiles[i].y + 0.5; }
    press.ring = { t0: (window.performance && performance.now) ? performance.now() : Date.now(),
                   gx: sx / tiles.length, gy: sy / tiles.length };
  }

  // renderHoldRing: painted every frame from loop(), on top of the room.
  // Painting in the render loop is fine — it is canvas ink, not DOM layout,
  // so nothing reflows and nothing becomes tappable.
  function renderHoldRing(ctx, canvasW, canvasH, ts) {
    // press.fired / mode !== 'hold' is the "Moving state has begun" edge: the
    // lift, the shadow and the context menu take over on that exact frame and
    // the ring is gone with no fade, which is what makes the handover read as
    // one gesture completing rather than two effects overlapping.
    if (!press || press.mode !== 'hold' || press.fired || !press.ring) return;
    var elapsed = ts - press.ring.t0;
    if (elapsed < RING_DELAY_MS) return;
    var prog = elapsed / HOLD_MS;
    if (prog > 1) prog = 1;
    var c = window.Game.Iso.project(press.ring.gx, press.ring.gy, RING_Z, getCamera(canvasW, canvasH));

    ctx.save();
    ctx.lineWidth = RING_W;
    ctx.lineCap = 'butt';
    // The unfilled track: barely there, just enough to imply the arc has a
    // destination. Literal colours — canvas cannot read CSS custom properties
    // (the existing convention throughout this file's render code).
    ctx.beginPath();
    ctx.arc(c.x, c.y, RING_R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(8,10,14,0.30)';
    ctx.stroke();
    // The fill: clockwise from 12 o'clock, brightening slightly as it closes
    // so the last third feels like arrival without being an animation.
    ctx.beginPath();
    ctx.arc(c.x, c.y, RING_R, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.42 + 0.38 * prog).toFixed(3) + ')';
    ctx.stroke();
    ctx.restore();
  }

  // renderBedPulse (SPEC-V20 §6): every placed bed gets a pulsing yellow
  // outline, straight on the canvas — the room has no DOM node to overlay
  // (same reasoning as renderHoldRing above), so this paints screen-space
  // isometric quads over each of the bed's footprint tiles, exactly like the
  // green/red highlight renderGhost() already draws for a draft.
  //
  // Gates:
  //   - below 20% of energyMax only (not the 50%/15% thresholds the deleted
  //     header key used — SPEC-V20 §6 states this one independently).
  //   - never while asleep/dead/packing to move — none of those are "you
  //     should go sleep now" moments, and packing hides/relocates props on
  //     its own timeline this function has no business fighting.
  //   - a bed currently being dragged (its idx sits in the draft's
  //     groupIdxs, same set hub.js's renderRoom() call already excludes via
  //     hideIdxs) is skipped here too — renderGhost() owns its on-screen
  //     position for the whole gesture, this function only knows settled
  //     placements.
  // Pure alpha oscillation, no layout property, per this file's own hazard
  // notes (renderHoldRing/context-menu comments above).
  // convexHull — monotone chain over screen points. Used to turn the bed's
  // eight projected bounding-box corners into ONE silhouette polygon; stroking
  // the box edge-by-edge instead would draw the hidden back edges straight
  // across the duvet.
  function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    var p = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lower = [], upper = [], i;
    for (i = 0; i < p.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
      lower.push(p[i]);
    }
    for (i = p.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function renderBedPulse(ctx, canvasW, canvasH, ts) {
    var data = window.Game.State.data;
    if (!data || data.asleep || data.dead || data.moving) return;

    // V22 (owner item 13): NIGHT is a trigger in its own right, not just low
    // energy. Regen stops dead at night (SPEC-V3 §2), so "it is night" is
    // exactly as much a "go to bed" moment as "you are nearly out of energy" —
    // and it is the one the player can otherwise miss entirely.
    var lowEnergy = !!data.energyMax && (data.energy / data.energyMax) < 0.2;
    var isNight = false;
    try {
      isNight = window.Game.State.dayPhase().phase === 'night';
    } catch (e) { /* dayPhase is read-only; never let it stop the room drawing */ }
    if (!lowEnergy && !isNight) return;

    var placed = data.placed || [];
    if (!placed.length) return;
    var hideIdxs = (pendingPlacement && pendingPlacement.groupIdxs) || null;
    var camera = getCamera(canvasW, canvasH);
    var alpha = 0.5 + 0.4 * Math.sin((ts || 0) / 260);

    /* V22 (owner item 13): outline the BED, not the two floor tiles it stands
       on. The old version stroked the footprint quads, so what flashed was a
       pair of glowing floor squares with a bed sitting inside them — it read
       as "these tiles are selected", not "tap this object".

       The silhouette is the convex hull of the bed's eight projected
       bounding-box corners (footprint at z=0 and at the mattress top). That is
       the same footprintTiles + Iso.project path bedScreenRect() uses, so the
       outline and the tutorial's bed spotlight can never disagree about where
       the bed is. A true per-pixel outline of the sprite would need an
       offscreen alpha pass every frame, which is not worth it for a shape this
       boxy — the hull hugs the duvet closely enough to read as the object. */
    var BED_TOP_Z = 14;
    var CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 214, 51, ' + alpha.toFixed(3) + ')';
    ctx.shadowColor = 'rgba(255, 214, 51, ' + (alpha * 0.7).toFixed(3) + ')';
    ctx.shadowBlur = 6;
    for (var i = 0; i < placed.length; i++) {
      if (hideIdxs && hideIdxs.indexOf(i) !== -1) continue;
      var p = placed[i];
      var def = window.Game.State.findShopItem(p.id);
      if (!def || def.category !== 'bed') continue;
      var tiles = window.Game.State.footprintTiles ?
        window.Game.State.footprintTiles(def, p.x, p.y, p.rot || 0) : [{ x: p.x, y: p.y }];

      var pts = [];
      for (var t = 0; t < tiles.length; t++) {
        for (var c = 0; c < CORNERS.length; c++) {
          pts.push(window.Game.Iso.project(tiles[t].x + CORNERS[c][0], tiles[t].y + CORNERS[c][1], 0, camera));
          pts.push(window.Game.Iso.project(tiles[t].x + CORNERS[c][0], tiles[t].y + CORNERS[c][1], BED_TOP_Z, camera));
        }
      }
      var hull = convexHull(pts);
      if (hull.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(hull[0].x, hull[0].y);
      for (var h = 1; h < hull.length; h++) ctx.lineTo(hull[h].x, hull[h].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function onPressMove(e) {
    if (!press || e.pointerId !== press.pointerId) return;
    var dx = e.clientX - press.x0, dy = e.clientY - press.y0;
    var travelled = Math.hypot(dx, dy) > HOLD_SLOP;

    if (press.mode === 'hold') {
      // §2.1 — more than ~10px before the timer fires means the player was
      // swiping, not holding. Disarm; do not enter the Moving state.
      if (travelled) cancelPress();
      return;
    }
    if (press.mode !== 'drag') {
      // A 'retarget' press that turns into real travel is treated as a drag
      // of the held prop from wherever the finger now is, which is what a
      // player who grabs slightly off the prop expects.
      if (travelled) { press.mode = 'drag'; press.moved = true; hideContextMenu(); }
      else return;
    }
    if (travelled && !press.moved) { press.moved = true; hideContextMenu(); }
    if (!press.moved) return;
    e.preventDefault();
    dragDraftTo(e.clientX, e.clientY);
  }

  // dragDraftTo: snap the draft to the tile under the pointer. §2.3 — the
  // draft's x/y are the ONLY thing written; validity is re-derived live by
  // renderGhost() and refreshContextMenu() through the existing
  // State.canMoveItem()/State.canMoveGroup(), so an invalid tile still shows
  // the prop over it in red rather than refusing to follow the finger. That
  // matters: a drag that stops tracking your thumb over a bad tile reads as
  // broken input, not as a rule.
  function dragDraftTo(clientX, clientY) {
    if (!pendingPlacement) return;
    var tile = tileFromClient(clientX, clientY);
    var rv = tile.roomVisual;
    if (tile.x < 0 || tile.y < 0 || tile.x >= rv.gridW || tile.y >= rv.gridD) return; // never leave the grid
    if (tile.x === pendingPlacement.x && tile.y === pendingPlacement.y) return;
    pendingPlacement.x = tile.x;
    pendingPlacement.y = tile.y;
    // SPEC-V15-BATCH-B §1: re-derive a wall mount's facing on every step of
    // the drag, not just at the end, so a banner never previews against the
    // wrong wall while it is still being dragged along the wall it will end
    // up on.
    var def = window.Game.State.findShopItem(pendingPlacement.defId);
    if (def && def.mount === 'wall' && window.Game.State.wallRotForTile) {
      pendingPlacement.rot = window.Game.State.wallRotForTile(tile.x, tile.y);
    }
    // NOTE: refreshContextMenu() is deliberately NOT called here. The menu is
    // hidden for the whole drag (see onPressMove) precisely so that no live
    // tap target moves under the finger — SPEC-V17 §2.5 / HANDOFF §9.5.
  }

  function onPressUp(e) {
    if (!press || e.pointerId !== press.pointerId) return;
    var mode = press.mode, moved = press.moved;
    var upX = e.clientX, upY = e.clientY;
    var downX = press.x0, downY = press.y0;
    endPress();

    if (mode === 'hold') {
      // Released before 600ms survived (onPressMove already cancels and
      // tears the whole gesture down the moment the finger travels past
      // HOLD_SLOP, so reaching here with mode still 'hold' means this was a
      // genuine short tap, not an abandoned hold). §2.1 says a short tap on
      // ordinary floor/props still does nothing at all — no popup, no
      // selection, no beep — EXCEPT SPEC-V20 §6: a short tap that lands on
      // the BED sleeps. This routes through the SAME sleep entry point the
      // deleted header button used to call (see js/main.js's onHeaderSleep,
      // now exposed as window.Game.Main.sleepFromBed) so every refusal/toast
      // still comes from that one code path — nothing re-implemented here.
      // Hit-tested with the original press-down point (downX/downY), the
      // exact same pickPropAtClient() the hold-ring/hold-fire logic already
      // uses, so "what did the player press" can never disagree between the
      // sleep tap and the hold-to-move gesture sharing this same pointerdown.
      var tapHit = pickPropAtClient(downX, downY);
      if (tapHit && tapHit.def && tapHit.def.category === 'bed' &&
          window.Game.Main && typeof window.Game.Main.sleepFromBed === 'function') {
        window.Game.Main.sleepFromBed();
      }
      return;
    }
    if (mode === 'retarget' && !moved) {
      // §2.3 — tapping another tile moves the held prop there. Uses
      // pendingTileCheck (not tileCheck) so a MOVE excludes the prop's own
      // current tiles from the occupancy scan; otherwise re-tapping a bed's
      // own footprint while moving it would report the bed as its own
      // obstruction (SPEC-V12 §1/§3).
      var tile = tileFromClient(upX, upY);
      var check = pendingTileCheck(tile);
      if (check.ok) {
        pendingPlacement.x = tile.x;
        pendingPlacement.y = tile.y;
        var def = window.Game.State.findShopItem(pendingPlacement.defId);
        if (def && def.mount === 'wall' && window.Game.State.wallRotForTile) {
          pendingPlacement.rot = window.Game.State.wallRotForTile(tile.x, tile.y);
        }
        window.Game.UI.beep('click');
      } else {
        window.Game.UI.beep('miss');
        window.Game.UI.toast(check.reason || 'CANNOT PLACE THERE', 'bad');
      }
    }
    // Every surviving path ends with the prop parked and the finger lifted:
    // reposition and re-show the menu exactly once, on this edge. Holding and
    // releasing WITHOUT moving lands here too — the prop stays exactly where
    // it was, in the Moving state, with the menu up and PLACE ready to commit
    // it back to its own tile.
    if (pendingPlacement) refreshContextMenu();
  }

  // endPress: tear down the gesture's window listeners and timer, leaving any
  // open draft alone.
  function endPress() {
    if (!press) return;
    if (press.timer) clearTimeout(press.timer);
    press = null;
    window.removeEventListener('pointermove', onPressMove);
    window.removeEventListener('pointerup', onPressUp);
    window.removeEventListener('pointercancel', onPressUp);
  }

  // cancelPress: endPress plus "and whatever this gesture was about to do,
  // don't". Called when a hold is reclassified as a swipe, and from every
  // screen-owning transition (sleep, move-out, leaving the hub).
  function cancelPress() {
    endPress();
  }

  /* ---------------------------------------------------------- PACKING MODE
     SPEC-V2 §7 moving minigame: while State.data.moving is set, every prop
     in state.placed must be tapped once to be "boxed up" before MOVE OUT
     lights up. Tapping is index-based (State.packPropAt), not tile-based,
     since a tile can hold more than one prop (desk + PC share one anchor). */
  function handlePackTap(cx, cy) {
    var canvas = els.canvas;
    var picked = window.Game.Iso.pickProp(window.Game.State.data, canvas.width, canvas.height, cx, cy, getCamera(canvas.width, canvas.height));
    if (!picked) return;
    var moving = window.Game.State.data.moving;
    if (!moving || moving.packed.indexOf(picked.idx) !== -1) {
      window.Game.UI.beep('click');
      return;
    }
    var ok = window.Game.State.packPropAt(picked.idx);
    if (ok) {
      packAnimTimes[picked.idx] = lastFrameTs;
      window.Game.UI.beep('hit');
    }
  }

  /* ------------------------------------------------------- COUNTING SHEEP
     SPEC-V4 §7: entirely optional while asleep. A tap that doesn't land on
     a live sheep is just a miss (no penalty, no toast — this is the one
     relaxing screen, not another pressure source). A landed tap asks
     State.sheepHit() for the actual reward (js/sheep.js never invents its
     own numbers) and hands the payout straight back to sheep.js as a
     cosmetic pop-up anchored at the sheep's own last-drawn position. */
  function handleSheepTap(cx, cy) {
    if (!window.Game.Sheep || !window.Game.Sheep.isActive()) return;
    var canvas = els.canvas;
    var hitAt = window.Game.Sheep.handleTap(cx, cy, canvas.width, canvas.height);
    if (!hitAt) { window.Game.UI.beep('miss'); return; }
    var res = window.Game.State.sheepHit();
    window.Game.UI.beep('hit');
    // §13: every landed hit adds 1% max energy on top of whatever cash/form
    // it paid out (State.sheepHit() always applies this, even once the cash
    // cap is hit) — fold it into the same pop-up so the player feels "this
    // tap woke me up a little sooner" on every single hit, not just via the
    // cumulative HUD counter.
    if (res.ok && res.cashAwarded > 0) {
      window.Game.Sheep.popReward(hitAt.sx, hitAt.sy, '+$' + res.cashAwarded + '  +1% ENERGY', '#3ddc84');
    } else if (res.ok) {
      window.Game.Sheep.popReward(hitAt.sx, hitAt.sy, (res.cashCapped ? 'CASH MAXED' : 'HIT') + '  +1% ENERGY', '#8894c9');
    }
  }

  function onCancelMove() {
    if (!window.Game.State.data) return; // defensive — see loop()'s comment
    window.Game.UI.beep('click');
    window.Game.UI.confirmModal({
      title: 'CANCEL THIS MOVE?',
      text: 'The move-in cost already paid is not refunded. Your room stays exactly as it is.',
      color: 'var(--danger)',
      yesText: 'CANCEL MOVE',
      noText: 'KEEP PACKING',
      onYes: function () {
        window.Game.State.cancelMove();
        packAnimTimes = {};
        window.Game.UI.toast('MOVE CANCELLED', 'info');
        syncHubChrome();
      }
    });
  }

  function onMoveOut() {
    if (transitioning) return;
    if (!window.Game.State.data) return; // defensive — see loop()'s comment
    var progress = window.Game.State.movingProgress();
    if (!progress || !progress.ready) {
      if (!packingForceReady) {
        window.Game.UI.beep('miss');
        window.Game.UI.toast('PACK UP EVERY PROP FIRST', 'bad');
        return;
      }
      // Failsafe path (§8): 10s elapsed, MOVE OUT ANYWAY was tapped —
      // finishMove() will call State.forceCommitMove() instead of
      // State.commitMove() once the travel transition finishes.
      forcedMoveOut = true;
    }
    var moving = window.Game.State.data.moving;
    var fromLoc = window.Game.State.data.locationId;
    var toLoc = moving.targetLocationId;
    window.Game.UI.beep('click');
    startTravelTransition(fromLoc, toLoc);
  }

  function startTravelTransition(fromLocId, toLocId) {
    transitioning = true;
    els.transitionCanvas.classList.add('hub__transition-canvas--active');
    var Data = window.Game.Data;
    var fromBackdrop = (Data.locations[fromLocId] || {}).backdrop || 'suburban_night';
    var toBackdrop = (Data.locations[toLocId] || {}).backdrop || 'suburban_night';
    var duration = 1400;
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      window.Game.Iso.drawTravelTransition(els.transitionCtx, els.transitionCanvas.width, els.transitionCanvas.height, t, fromBackdrop, toBackdrop);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        finishMove();
      }
    }
    requestAnimationFrame(frame);
  }

  function finishMove() {
    var wasForced = forcedMoveOut;
    forcedMoveOut = false;
    els.transitionCanvas.classList.remove('hub__transition-canvas--active');
    transitioning = false;
    packAnimTimes = {};
    packingStartTs = null;
    packingForceReady = false;
    if (!window.Game.State.data) return; // defensive — see loop()'s comment; nothing left to resolve
    // SPEC-V7 §4: the new location's room is a different size (§2), so its
    // "whole room visible" default framing is different too — start the new
    // room at that default rather than carrying over the old room's zoom/pan.
    resetView();
    var res = wasForced ? window.Game.State.forceCommitMove() : window.Game.State.commitMove();
    if (res.ok) {
      var loc = window.Game.State.currentLocation();
      window.Game.UI.beep('cash');
      var msg = wasForced && res.leftoverPacked > 0
        ? 'WELCOME TO ' + loc.name + ' — THE MOVERS BOXED ' + res.leftoverPacked + ' LEFTOVER ITEM' + (res.leftoverPacked === 1 ? '' : 'S') + ', RE-PLACE VIA EDIT ROOM'
        : 'WELCOME TO ' + loc.name + ' — RE-PLACE YOUR GEAR VIA EDIT ROOM';
      window.Game.UI.toast(msg, 'good');
    }
    syncHubChrome();
  }

  /* ---- top-left location badge + packing panel visibility -------------- */
  function updateLocationBadge() {
    if (!els.locationBadge) return;
    var State = window.Game.State, data = State.data;
    if (!data) return; // defensive — see the 'change' listener's comment above
    var loc = State.currentLocation();
    els.locationName.textContent = loc.name;
    var text, warn = false;
    if (loc.id === 0) {
      text = 'RENT FREE';
    } else {
      var mod = data.day % 7;
      if (mod === 0) text = 'RENT DUE TODAY';
      else if (mod === 6) { text = 'RENT DUE TOMORROW'; warn = true; }
      else text = 'RENT IN ' + (7 - mod) + 'D';
      if (data.rentMissed > 0) { text += ' — MISSED ' + data.rentMissed + '/2'; warn = true; }
    }
    els.locationRent.textContent = text;
    els.locationRent.classList.toggle('hub__location-rent--warn', warn);
  }

  // §3: energy drink can-in-a-circle button. Disabled (with a title
  // explaining exactly why) at 0 owned, at full energy, or after 4 already
  // drunk today — State.energyDrinkStatus() already resolves which of those
  // reasons applies, so this is purely a display of that read-only status.
  var ENERGY_DRINK_REASON_TEXT = {
    'none-owned': 'NONE OWNED — BUY SOME IN THE SHOP',
    'full-energy': 'ENERGY IS ALREADY FULL',
    'daily-limit': 'HAD 4 TODAY — MAX FOR THE DAY'
  };
  function refreshEnergyDrinkUI() {
    if (!els.energyDrinkBtn) return;
    var State = window.Game.State;
    if (!State.data || !State.energyDrinkStatus) return;
    // Hidden (not just disabled) while moving/asleep — same "physically
    // un-clickable" treatment refreshPackingUI/refreshSleepUI give
    // EDIT ROOM/CAREER/STATS/SLEEP in those states, rather than leaving a
    // tappable can up that just toasts blockIfLocked's error every time.
    var locked = !!(State.data.moving || State.data.asleep);
    var status = State.energyDrinkStatus();
    /* V22c (owner item 5): the button only exists when you actually own the
       drink. An always-visible can that only ever says "NONE OWNED — BUY SOME
       IN THE SHOP" is a permanent dead control taking up the corner; showing
       it the moment you have one is the same information doing useful work.
       Hidden while moving/asleep for the reason below. */
    els.energyDrinkWrap.style.display = (locked || status.owned <= 0) ? 'none' : '';
    refreshSyrupUI(locked);
    if (locked || status.owned <= 0) return;
    els.energyDrinkCount.textContent = status.owned;
    var disabled = !status.canDrink;
    window.Game.UI.setDisabled(els.energyDrinkBtn, disabled, 'hub__energy-drink-btn--disabled');
    els.energyDrinkBtn.title = disabled ?
      ('ENERGY DRINK — ' + (ENERGY_DRINK_REASON_TEXT[status.reason] || 'UNAVAILABLE')) :
      ('ENERGY DRINK — +' + status.restoreEnergy + ' ENERGY (' + status.drinksLeftToday + ' LEFT TODAY)');
  }

  // V22c (owner item 5) — the syrup's own status/handler pair, mirroring the
  // energy drink's exactly so both buttons behave identically.
  var SYRUP_REASON_TEXT = {
    'none-owned': 'NONE OWNED — BUY SOME IN THE SHOP',
    'no-energy': 'YOUR ENERGY IS ALREADY EMPTY'
  };

  function refreshSyrupUI(locked) {
    if (!els.syrupWrap) return;
    var State = window.Game.State;
    if (!State.data || !State.calmingSyrupStatus) { els.syrupWrap.style.display = 'none'; return; }
    var status = State.calmingSyrupStatus();
    els.syrupWrap.style.display = (locked || status.owned <= 0) ? 'none' : '';
    if (locked || status.owned <= 0) return;
    els.syrupCount.textContent = status.owned;
    var disabled = !status.canDrink;
    window.Game.UI.setDisabled(els.syrupBtn, disabled, 'hub__energy-drink-btn--disabled');
    els.syrupBtn.title = disabled ?
      ('CALMING SYRUP — ' + (SYRUP_REASON_TEXT[status.reason] || 'UNAVAILABLE')) :
      ('CALMING SYRUP — DRAINS ' + status.drainAmount + ' ENERGY SO YOU CAN SLEEP');
  }

  function onDrinkSyrup() {
    if (blockIfLocked()) return;
    var State = window.Game.State;
    var status = State.calmingSyrupStatus ? State.calmingSyrupStatus() : null;
    if (status && !status.canDrink) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('CAN\'T DRINK — ' + (SYRUP_REASON_TEXT[status.reason] || 'UNAVAILABLE'), 'bad');
      return;
    }
    var res = State.drinkCalmingSyrup();
    if (!res.ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('CAN\'T DRINK — ' + (SYRUP_REASON_TEXT[res.reason] || 'UNAVAILABLE'), 'bad');
      return;
    }
    window.Game.UI.beep('click');
    window.Game.UI.toast('CALMING SYRUP — ENERGY DRAINED, GO GET SOME SLEEP', 'good');
    syncHubChrome();
  }

  function onDrinkEnergyDrink() {
    if (blockIfLocked()) return;
    var State = window.Game.State;
    var status = State.energyDrinkStatus ? State.energyDrinkStatus() : null;
    if (status && !status.canDrink) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('CAN\'T DRINK — ' + (ENERGY_DRINK_REASON_TEXT[status.reason] || 'UNAVAILABLE'), 'bad');
      return;
    }
    var res = State.drinkEnergyDrink();
    if (!res.ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('CAN\'T DRINK — ' + (ENERGY_DRINK_REASON_TEXT[res.reason] || 'UNAVAILABLE'), 'bad');
      return;
    }
    window.Game.UI.beep('click');
    window.Game.UI.toast('+' + (window.Game.Data.energyDrink ? window.Game.Data.energyDrink.restoreEnergy : 25) + ' ENERGY', 'good');
    refreshEnergyDrinkUI();
  }

  // refreshPackingUI: while a move is in progress, the packing panel takes
  // over the bottom slot entirely and the sleep panel is hidden. V17: the
  // control row it also used to hide no longer exists, and hold-to-edit is
  // refused outright while `moving` is set (see onPressDown), so the room
  // cannot be rearranged out from under the packing minigame either.
  function refreshPackingUI() {
    var moving = window.Game.State.data.moving;
    if (moving) {
      els.sleepPanel.style.display = 'none';
      els.sleepDim.classList.remove('hub__sleep-dim--show'); // defensive: moving always wins over asleep visuals
      els.nightBanner.classList.remove('hub__night-banner--show');
      els.packing.style.display = 'flex';
      var progress = window.Game.State.movingProgress();
      els.packingCounter.textContent = 'PACKED ' + progress.packed + ' / ' + progress.total;
      if (!progress.ready && packingForceReady) {
        // Stuck-player failsafe (§8): 10s in packing mode with props still
        // unboxed — let them leave anyway. Nothing is lost; forceCommitMove
        // just auto-boxes whatever's left, same as commitMove would for a
        // fully-packed room.
        window.Game.UI.setDisabled(els.packingMoveOutBtn, false);
        els.packingMoveOutBtn.textContent = 'MOVE OUT ANYWAY — THE MOVERS WILL BOX THE REST';
      } else {
        window.Game.UI.setDisabled(els.packingMoveOutBtn, !progress.ready);
        els.packingMoveOutBtn.textContent = 'MOVE OUT';
      }
    } else {
      els.packing.style.display = 'none';
      els.packingMoveOutBtn.textContent = 'MOVE OUT';
    }
    return !!moving;
  }

  // refreshSleepUI: while asleep, the sleep panel takes over the same bottom
  // slot as the packing panel (mutually exclusive with it) and the canvas
  // gets a dim + floating "Zzz" overlay. Not asleep -> the plain room, plus
  // the NIGHT banner (§3's SKIP THE NIGHT placeholder) whenever it's night
  // and the player is awake to see it.
  function refreshSleepUI(movingActive) {
    var d = window.Game.State.data;
    if (movingActive) return; // packing already owns the bottom slot
    if (d.asleep) {
      els.nightBanner.classList.remove('hub__night-banner--show');
      els.sleepPanel.style.display = 'flex';
      els.sleepDim.classList.add('hub__sleep-dim--show');
      // NOT calling updateSleepUI()/canWake() here — this function runs
      // synchronously inside the 'change' listener chain (see the loop()
      // comment above); the next rAF frame (< 16ms away) refreshes the
      // energy readout and WAKE UP lock text via its own single canWake()
      // call. A basic energy readout is set immediately below from data
      // already in hand, with no additional tick, so there's no visible gap.
      els.sleepEnergyText.textContent = Math.round(d.energy) + ' / ' + Math.round(d.energyMax);
      els.sleepBarFill.style.width = Math.max(0, Math.min(100, (d.energy / d.energyMax) * 100)) + '%';
    } else {
      els.sleepPanel.style.display = 'none';
      els.sleepDim.classList.remove('hub__sleep-dim--show');
      var phase = window.Game.State.dayPhase().phase;
      els.nightBanner.classList.toggle('hub__night-banner--show', phase === 'night');
    }
  }

  function syncHubChrome() {
    // Defensive catch-all (per Package M's report) — every caller of this
    // function (the 'change' listener, onSleep/onWakeResolved/finishMove/
    // onCancelMove, the skip-night-ad callback) ultimately reads
    // State.data; a single guard here covers all of them against a data-went-
    // null race instead of scattering the same check at each call site.
    if (!window.Game.State.data) return;
    updateLocationBadge();
    refreshEnergyDrinkUI();
    var movingActive = refreshPackingUI();
    refreshSleepUI(movingActive);
    refreshRoomBanner();
    updateTopBannersInset();
    // SPEC-V14 §3.5: state-change edge only, never the rAF loop directly —
    // this function itself only runs from those edges (the 'change'
    // listener and a handful of explicit callers below), so Phone.refresh()
    // inherits that contract for free. It diffs before writing (see
    // js/phone.js) so being called often here is cheap.
    if (window.Game.Phone) window.Game.Phone.refresh();
  }

  /* ---------------------------------------------------- REMOVED IN V17 §1
     showInspect()/hideInspect() + inspectTimer, toggleEditMode(), the whole
     edit tray (renderTray/selectHeld) and the tray-to-canvas HTML5 drag
     (startGhostDrag/positionGhost/onDragMove/onDragEnd/removeGhost) all
     lived here. They are deleted outright, not disabled:
       - the inspect popover ran on a 3.2s setTimeout and would have fired
         part-way through a hold-to-edit drag;
       - the edit-mode flag gated tap handling, and there is no mode now;
       - the tray is now the phone INVENTORY app, which hands items back
         through G.Hub.spawnIntoMoveState() at the bottom of this file.
     The one behaviour worth keeping from the tray, performCoreSwap() (a
     core item whose slot is already filled swaps in place, SPEC-V13 §4C),
     survives above and is reached from spawnIntoMoveState(). ---------- */


  /* -------------------------------------------------------------------- SLEEP
     SPEC-V20 §6, HAZARD note: this file used to carry its OWN sleep
     implementation here (onSleep(), exposed as Game.Hub.sleep()) from the
     SPEC-V3 era, before SLEEP moved to a header button whose click handler
     was written directly in js/main.js (onHeaderSleep()) instead of calling
     back into this one. That left two parallel, independently-drifting copies
     of the same refusal/toast logic — this one with zero callers anywhere in
     the repo (grepped: nothing calls Game.Hub.sleep or onSleep) — sitting
     right next to the exact "do not write a second sleep route" hazard
     SPEC-V20 §6 calls out for the bed-tap gesture. Removed outright rather
     than left as a trap for the next reader. The bed tap (onPressUp() above)
     and the WAKE UP button below both go through js/main.js's
     window.Game.Main.sleepFromBed() / the existing wake path — one sleep
     entry point, for real this time. */

  function onWakeUp() {
    if (!window.Game.State.data) return; // defensive — see loop()'s comment
    var c = window.Game.State.canWake();
    if (!c.allowed) { window.Game.UI.beep('miss'); return; }
    var res = window.Game.State.wake();
    if (res.ok) onWakeResolved(res);
  }

  // onSkipNightAd (SPEC-V4 §1 — replaces the SPEC-V3 §3 COMING SOON
  // placeholder): only reachable from the ASLEEP panel. Plays the shared
  // ~3s ad overlay (js/main.js's playAdOverlay, also used by the energy-
  // refill ad) then calls State.skipNightAd(), which grants full energy and
  // resolves the night exactly like a normal wake — bypassing the 50-energy
  // minimum-sleep gate. Reuses onWakeResolved() for the "new day" summary
  // card since skipNightAd() returns the same resolveNewDay() shape wake()
  // does.
  function onSkipNightAd() {
    if (!window.Game.State.data || !window.Game.State.data.asleep) return;
    window.Game.UI.beep('click');
    window.Game.Main.playAdOverlay(function () {
      // The ~3s ad is a real delay — guard again on the far side rather than
      // trust anything about game state hasn't moved on in the meantime
      // (career ended, save unloaded, or the player already auto-woke via
      // the loop()'s own tickEnergy() reaching full energy first).
      if (!window.Game.State.data) return;
      if (!window.Game.State.data.asleep) { syncHubChrome(); return; }
      var res = window.Game.State.skipNightAd();
      if (res.ok) {
        onWakeResolved(res);
      } else if (res.reason === 'dead') {
        window.Game.UI.toast('CAREER OVER', 'bad');
      } else {
        syncHubChrome();
      }
    });
  }

  // onWakeResolved: shared tail for both a manual WAKE UP tap and an
  // auto-wake caught in the render loop — syncs chrome back to the normal
  // controls and shows the "new day" summary (same shape State.endDay() used
  // to produce, since State.wake()/resolveNewDay() perform the same
  // salary/subscriberPayout/rent/staffUpkeep resolution — §3 step 4). Idle
  // income is gone (SPEC-V3 §13) — subscribers pay out BEFORE rent, same as
  // the underlying resolveNewDay() ordering, so this line always shows first.
  function onWakeResolved(res) {
    if (window.Game.Sheep) window.Game.Sheep.stop(); // §7 — one shared exit point for every wake path (manual/auto/ad-skip)
    window.Game.UI.beep('cash');
    syncHubChrome();
    var lines = [
      { label: 'SALARY', value: window.Game.UI.money(res.salary || 0), color: 'var(--cash)' }
    ];
    if (res.subscriberPayout && res.subscriberPayout.due) {
      lines.push({
        label: 'SUBSCRIBERS',
        value: '+' + window.Game.UI.money(res.subscriberPayout.paid) + ' (' + res.subscriberPayout.count + ' subs)',
        color: 'var(--cash)'
      });
    }
    if (res.chemistryPenalty) {
      lines.push({ label: 'CHEMISTRY', value: '-15 (missed scrim quota)', color: 'var(--danger)' });
    }
    if (res.rent && res.rent.due && res.rent.paid > 0) {
      lines.push({ label: 'RENT', value: '-' + window.Game.UI.money(res.rent.paid), color: res.rent.missed ? 'var(--danger)' : 'var(--cash)' });
      if (res.rent.warning) lines.push({ label: 'WARNING', value: 'MISSED RENT — CAREER AT RISK', color: 'var(--danger)' });
    }
    if (res.staffUpkeep) {
      lines.push({ label: 'STAFF UPKEEP', value: '-' + window.Game.UI.money(res.staffUpkeep), color: 'var(--danger)' });
    }
    var title = 'GOOD MORNING';
    if (res.auto) title += ' (AUTO-WOKE AT FULL ENERGY)';
    else if (res.ad) title += ' (NIGHT SKIPPED)';
    window.Game.UI.rewardCard({
      title: title,
      subtitle: 'DAY ' + window.Game.State.data.day,
      color: 'var(--cash)',
      lines: lines,
      buttonText: 'LET’S GO'
    });
  }

  // updateSleepUI(c): polled every frame while asleep (from loop()) — energy
  // readout/bar plus the WAKE UP lock + live countdown. `c` is loop()'s own
  // single State.canWake() result for this frame — see the comment there on
  // why this must never call canWake()/tickEnergy() itself.
  function updateSleepUI(c) {
    var d = window.Game.State.data;
    els.sleepEnergyText.textContent = Math.round(d.energy) + ' / ' + Math.round(d.energyMax);
    var pct = Math.max(0, Math.min(100, (d.energy / d.energyMax) * 100));
    els.sleepBarFill.style.width = pct + '%';
    if (c.allowed) {
      window.Game.UI.setDisabled(els.sleepWakeBtn, false);
      els.sleepWakeBtn.textContent = 'WAKE UP';
    } else {
      window.Game.UI.setDisabled(els.sleepWakeBtn, true);
      var secs = Math.max(0, Math.ceil(c.remainingMs / 1000));
      els.sleepWakeBtn.textContent = 'WAKE UP (LOCKED — ' + secs + 's)';
    }
  }

  /* -------------------------------------------------------------------- router */
  window.Game = window.Game || {};
  window.Game.Router = window.Game.Router || {};
  window.Game.Router.register('hub', {
    onEnter: function () {
      if (!built) buildDom();
      active = true;
      transitioning = false;
      wasAsleep = !!(window.Game.State.data && window.Game.State.data.asleep);
      els.transitionCanvas.classList.remove('hub__transition-canvas--active');
      // V17: no edit mode, no tray, no inspect popover to reset. A draft and
      // an armed hold are both per-visit state, cleared on the way in as well
      // as on the way out so a re-entry can never inherit either.
      cancelPress();
      cancelPendingPlacement();
      resizeCanvas();
      window.Game.State.tickEnergy(); // reconcile immediately (e.g. resuming a backgrounded tab) before the first frame
      // §7 — a fresh page load / re-entering the hub while already asleep
      // (in-memory sheep list doesn't survive a reload) needs its own
      // restart; every wake path already calls Sheep.stop() so re-starting
      // here is never redundant with an active session.
      if (window.Game.Sheep) {
        if (wasAsleep) window.Game.Sheep.start(); else window.Game.Sheep.stop();
      }
      syncHubChrome();
      rafId = requestAnimationFrame(loop);
    },
    onExit: function () {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (window.Game.Sheep) window.Game.Sheep.stop();
      // SPEC-V14 §3: never leave the phone open (mid-transition or not)
      // over whatever screen comes next — sponsors/social/crypto navigate
      // here via Router.go(), which runs this before their onEnter().
      if (window.Game.Phone && window.Game.Phone.reset) window.Game.Phone.reset();
      // The phone can be opened mid-draft, and every phone app can navigate
      // away — so discard the draft here rather than let the three context
      // buttons linger, stale and still tappable, over whatever screen comes
      // next. Nothing was ever committed, so this is always safe.
      // cancelPress() goes with it: an armed 600ms timer must not fire into
      // a screen the player has already left.
      cancelPress();
      cancelPendingPlacement();
      // SPEC-V7 §4: a pinch mid-gesture when the player navigates away would
      // otherwise leak its window-level pointermove/up/cancel listeners —
      // same defensive tear-down as cancelPendingPlacement() above.
      if (pinch) {
        window.removeEventListener('pointermove', onCanvasPointerMove);
        window.removeEventListener('pointerup', onCanvasPointerUp);
        window.removeEventListener('pointercancel', onCanvasPointerUp);
        pinch = null;
      }
    }
  });

  /* ============================================ CROSS-PACKAGE API (V17 §0)
     G.Hub.spawnIntoMoveState(itemId) -> boolean

     The one call the phone's INVENTORY app (P3, §5.1) makes into this file.
     P3 closes the phone, then calls it defensively, exactly the way
     js/sponsors.js calls G.Phone.open():

         G.Hub && G.Hub.spawnIntoMoveState && G.Hub.spawnIntoMoveState(id)

     itemId is a shop-item id (the same id used as a key in State.data.owned
     and as `.id` on entries in State.data.placed).

     Returns TRUE when the request was handled — normally meaning the item is
     now sitting centre-screen in the Moving state, ready to drag. The one
     other true case is a core item (desk/pc/chair/monitor/bed) whose slot is
     already filled: State.placeItem() swaps in place there (SPEC-V13 §4C),
     there is no tile for the player to choose, and so no Moving state opens.
     That path is still "handled" — it beeps, toasts and updates the room.

     Returns FALSE when the request was refused, in which case this function
     has ALREADY explained why with a beep + toast. P3 does not need to
     produce a message of its own; the boolean is there so it can decide
     whether to reopen the phone or stay out of the way.
     ==================================================================== */
  function spawnIntoMoveState(itemId) {
    if (!built || !active || !window.Game.State.data) return false;
    if (!canEditNow()) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast(window.Game.State.data.moving ? 'FINISH MOVING OUT FIRST' : 'YOU’RE ASLEEP', 'bad');
      return false;
    }
    var def = window.Game.State.findShopItem(itemId);
    if (!def) return false;

    // Inventory is derived, never stored (§5.1): owned minus placed. Re-derive
    // it here rather than trusting the caller's count, so a stale phone
    // render can't conjure a prop the player doesn't actually have spare.
    var owned = window.Game.State.data.owned[def.id] || 0;
    var placedQty = window.Game.State.data.placed.filter(function (p) { return p.id === def.id; }).length;
    if (owned - placedQty <= 0) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('NONE SPARE — THEY’RE ALL IN THE ROOM ALREADY', 'bad');
      return false;
    }

    // SPEC-V13 §4C: a core category already holding an incumbent SWAPS IN
    // PLACE. There is no tile to pick, so opening a draft would be a lie —
    // PLACE would land it on the incumbent's tile regardless of where the
    // player dragged it. Do the swap outright instead, same as the old tray.
    if (isCoreSingleton(def.category) && placedCountInCategory(def.category) >= 1) {
      performCoreSwap(def);
      return true;
    }

    // Centre-screen: the middle tile of the room, so the prop lands where
    // the player is already looking and within a thumb's reach of the
    // context menu. If that tile is occupied the draft still opens there,
    // just red — the player drags it somewhere legal, which is exactly the
    // interaction §2.3 describes. Refusing to spawn at all would leave the
    // player with an item they can see in their inventory and cannot use.
    var rv = window.Game.Iso.getRoomVisual(window.Game.State.data);
    var cx = Math.floor(rv.gridW / 2), cy = Math.floor(rv.gridD / 2);
    cancelPress();
    window.Game.UI.beep('click');
    beginPendingPlacement(def, cx, cy, 0, null);
    return true;
  }

  /* bedScreenRect (SPEC-V20 §6) — the bed's on-screen box in VIEWPORT
     coordinates, for js/tutorial.js's "tap your bed to sleep" step.

     That step teaches a gesture on a canvas prop, and props have no DOM node
     to anchor to, so it fell back to '#hub-canvas' — spotlighting the ENTIRE
     room and dropping the arrow in the middle of the floor. The one step
     whose whole job is "tap THIS object" pointed at everything.

     It lives here, not in tutorial.js, because the camera does: getCamera()
     is the single source for the zoom/pan-corrected view that rendering and
     every hit-test already share. Projecting tiles in tutorial.js would be a
     second copy of the camera rule, which is precisely how the highlight and
     the thing it highlights drift apart. Same footprintTiles() + Iso.project()
     path the under-20%-energy bed outline above uses. */
  function bedScreenRect() {
    if (!active) return null;
    var State = window.Game.State;
    var d = State && State.data;
    var canvas = els.canvas;
    if (!d || !canvas || !canvas.width || !canvas.height) return null;

    var placed = d.placed || [];
    var entry = null, def = null;
    for (var i = 0; i < placed.length; i++) {
      var dd = State.findShopItem(placed[i].id);
      if (dd && dd.category === 'bed') { entry = placed[i]; def = dd; break; }
    }
    if (!entry) return null;

    var camera = getCamera(canvas.width, canvas.height);
    var tiles = State.footprintTiles ?
      State.footprintTiles(def, entry.x, entry.y, entry.rot || 0) : [{ x: entry.x, y: entry.y }];
    // Corners at z=0 and at the mattress top, so the lit box contains the
    // duvet rather than just the footprint it stands on.
    var BED_TOP_Z = 14;
    var CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var t = 0; t < tiles.length; t++) {
      for (var c = 0; c < CORNERS.length; c++) {
        for (var z = 0; z <= 1; z++) {
          var q = window.Game.Iso.project(
            tiles[t].x + CORNERS[c][0], tiles[t].y + CORNERS[c][1],
            z ? BED_TOP_Z : 0, camera);
          if (q.x < minX) minX = q.x;
          if (q.x > maxX) maxX = q.x;
          if (q.y < minY) minY = q.y;
          if (q.y > maxY) maxY = q.y;
        }
      }
    }
    if (!isFinite(minX) || !isFinite(minY)) return null;

    // Iso.project works in canvas BACKING-STORE pixels; the tutorial overlay
    // is positioned in CSS/viewport pixels, and the two differ whenever the
    // canvas is sized for a device pixel ratio. Convert through the canvas's
    // own measured rect rather than assuming they match.
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    return {
      left: rect.left + minX * sx,
      top: rect.top + minY * sy,
      width: (maxX - minX) * sx,
      height: (maxY - minY) * sy
    };
  }

  /* setSheetTop (TASKS-REMAINING #3) — a bottom-docked modal reports the
     VIEWPORT y of its own top edge; pass null (or omit) when it closes. The
     room then lifts clear of it.

     WHY THE TOP EDGE AND NOT THE SHEET'S HEIGHT. The first cut of this took a
     height, and measurement caught it out: the customise card is 332px tall
     but its bottom runs past the bottom of the canvas, so only 245px of ROOM
     was ever behind it. Passing the height over-lifted the room by the 97px
     of card that hangs below the canvas entirely. How much canvas a sheet
     covers is a fact about the canvas, so the hub works it out — the modal
     only has to know where it starts, which it always does.

     CSS px in, backing-store px stored: Iso.project() and the whole camera
     work in the canvas backing store, which differs from CSS pixels at any
     device-pixel-ratio above 1 — the same conversion bedScreenRect() undoes
     at the other end. Done once here, since the canvas cannot resize while a
     modal is open. */
  function setSheetTop(viewportY) {
    var canvas = els.canvas;
    var px = 0;
    if (viewportY != null && canvas && canvas.height) {
      var rect = canvas.getBoundingClientRect();
      if (rect.height > 0) {
        // Only the overlap counts: a sheet starting below the canvas covers
        // nothing, and one starting above it cannot cover more than all of it.
        var coveredCss = Math.max(0, Math.min(rect.height, rect.bottom - viewportY));
        px = coveredCss * (canvas.height / rect.height);
        // Never surrender the whole viewport: past 70% there is not enough
        // room left to judge anything, so the lift saturates and the sheet
        // simply covers what it covers.
        px = Math.min(px, canvas.height * 0.7);
      }
    }
    sheetInset.target = px;
    if (px === 0) hideContextMenu();
    refreshContextMenu();
  }

  window.Game.Hub = {
    // `camera` is here so a lift/pan change can be verified by PROJECTING a
    // known tile rather than by eyeballing pixels — canvas art has no DOM to
    // measure, and a colour threshold cannot tell a prop from the night sky.
    __probe: function () {
      var cam = null;
      if (els.canvas && els.canvas.width) cam = getCamera(els.canvas.width, els.canvas.height);
      return {
        active: active, transitioning: transitioning,
        press: press && { mode: press.mode, fired: press.fired, ring: press.ring },
        pending: pendingPlacement,
        sheetInset: { target: sheetInset.target, current: sheetInset.current },
        camera: cam,
        canvas: els.canvas ? { w: els.canvas.width, h: els.canvas.height } : null
      };
    },
    spawnIntoMoveState: spawnIntoMoveState,
    bedScreenRect: bedScreenRect,
    setSheetTop: setSheetTop,
    // P2 (§3) binds SLEEP into the header now that the hub's control row is
    // gone. onSleep() carries the tournament gate, the draft teardown and the
    // counting-sheep start, none of which belong in js/main.js — so it is
    // exposed here rather than reimplemented over there.
    sleep: function () {
      if (!active || blockIfLocked()) return false;
      onSleep();
      return true;
    }
  };
})();
