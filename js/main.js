/* ==========================================================================
   CS2 PRO SIMULATOR — js/main.js
   Bootstrap: builds the persistent top bar + bottom nav, loads the save,
   and hands off to the router. Boots cleanly even if the minigame modules
   (Game.Aim / Game.Stream / Game.Cases) have not landed yet.
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------ ICONS
  // SPEC-V16 §3.2: the five bottom-nav glyphs (plus the lock that overlays
  // them) are AUTHORED PIXEL ART — every edge is drawn as an axis-aligned
  // rectangle on a strict 16x16 grid, no strokes-as-linework, no emoji, no
  // Unicode glyph anywhere in the nav.
  //
  // The 1px black outline is NOT hand-drawn per icon. Each shape carries
  // class="po" and css/style.css gives that class a 2-unit stroke under the
  // fill via paint-order:stroke, so exactly 1 unit shows outside the
  // silhouette — one rule, every icon outlined, and the outline automatically
  // follows the shape when a glyph is edited. class="pi" is internal line art
  // (a seam, an awning stripe), drawn on top in the same black.
  //
  // Every path stays inside x/y 1..15 so the outline that grows 1 unit
  // outward still lands inside the 16x16 viewBox and cannot spill past the
  // icon's recessed window.
  var ICONS = {
    // crosshair — four chunky arms around an open centre
    play: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M6 1h4v5H6zM6 10h4v5H6zM1 6h5v4H1zM10 6h5v4h-5z"/></svg>',
    // dumbbell — outer plate / inner plate / bar, symmetrical
    train: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M2 5h2v6H2zM4 3h2v10H4zM6 7h4v2H6zM10 3h2v10h-2zM12 5h2v6h-2z"/></svg>',
    // camcorder — body plus a stair-stepped lens wedge (2 across, 1 down)
    stream: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M1 4h10v9H1zM11 6h1v5h-1zM12 5h1v7h-1zM13 4h2v9h-2z"/><path class="pi" d="M3 6h3v1H3z"/></svg>',
    // weapon case — lid seam across the middle with a clasp straddling it
    cases: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M1 3h14v11H1z"/><path class="pi" d="M1 6h14v1H1z"/><path class="po" d="M6 5h4v4H6z"/></svg>',
    // storefront — striped awning over a shopfront with a doorway
    shop: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M1 3h14v3H1zM2 6h12v9H2z"/><path class="pi" d="M4 3h2v3H4zM8 3h2v3H8zM12 3h2v3h-2zM6 9h4v6H6z"/></svg>',
    lock: '<svg class="pixicon navbtn__lock" viewBox="0 0 16 16"><path class="po" d="M5 1h6v2H5zM4 2h2v5H4zM10 2h2v5h-2zM3 6h10v9H3z"/></svg>',
    // V18 §2 / header brief: the four smooth 24x24 STROKE icons that used to
    // live here (gear, cash, followers, subscribers — plus the eye, deleted
    // with the Max Views stat) were the last non-pixel art in the chrome. A
    // 1.6px round-capped stroke cannot carry the 1px black outline the brief
    // requires, and it read as a different icon system from the nav glyphs
    // sitting 700px below it. All four are re-authored on the same strict
    // 16x16 grid / class="po" outline contract as the nav icons above, so the
    // header and the nav are visibly one set. Every rect stays inside
    // x/y 1..15 so the 1-unit outline cannot spill outside the viewBox.
    //
    // gear — an octagonal body with four short teeth and a PUNCHED HUB. The
    // hub is the load-bearing detail, not the teeth: the first pass gave this
    // a small body, long teeth and a 2-unit hole, and at 15px it read as the
    // PLAY crosshair sitting in the bottom nav. A large body with a 4-unit
    // hole punched through it cannot be mistaken for a solid crosshair.
    gear: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M4 3h8v10H4zM3 4h10v8H3zM6 1h4v2H6zM6 13h4v2H6zM1 6h2v4H1zM13 6h2v4h-2z"/><path class="pi" d="M6 6h4v4H6z"/></svg>',
    // cash — a chunky coin (a stepped octagonal disc) with a $ punched
    // through it. A COIN and not a banknote for one measured reason: every
    // stroke of the $ is 2 grid units thick, and a banknote frame only leaves
    // 8 of the 16 rows for the glyph. At the 15px the header renders these at,
    // one grid unit is 0.94 CSS px, so a 1-unit stroke greys out into the fill
    // instead of reading as a glyph. The disc gives the $ the full height.
    cash: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M6 1h4v14H6zM4 2h8v12H4zM2 4h12v8H2zM1 6h14v4H1z"/><path class="pi" d="M5 3h6v2H5zM5 5h2v2H5zM5 7h6v2H5zM9 9h2v2H9zM5 11h6v2H5z"/></svg>',
    // followers — a chunky bust. The head is separated from the shoulders by
    // a 2-unit gap, NOT butted against them: the two 1-unit outlines meet
    // inside that gap and draw a solid black neck line. Butted together (the
    // first pass) the whole glyph flooded into one pink blob at 15px and read
    // as a bottle.
    // The head is an OCTAGON (corners cut by the second rect), not a square:
    // a rectangular head over a wider slab body read as a corked bottle at
    // 15px whatever the proportions were, because the only round thing in a
    // bust silhouette is the head. Shoulders flare 6 -> 10 below a 2-unit
    // neck gap, whose two outlines meet to draw the neck as one black line.
    followers: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M6 1h4v5H6zM5 2h6v3H5zM5 8h6v2H5zM3 10h10v4H3z"/></svg>',
    // SPEC-V3 §13: real tracked subscriber resource — a heart, so it reads
    // apart from the followers bust sitting directly above it.
    subscribers: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M4 4h3v1H4zM9 4h3v1H9zM3 5h10v3H3zM4 8h8v1H4zM5 9h6v1H5zM6 10h4v1H6zM7 11h2v1H7z"/></svg>',
    // rankBadge — the pixel-art shield that REPLACED the flat rank-name box in
    // the header's left module. Tapering shield silhouette with a stepped
    // chevron cut into it; the fill is currentColor, which js/main.js paints
    // with the tier's own rank.color, so one authored glyph covers every rank.
    // The chevron is a CONTINUOUS stepped V, not three separate blocks: three
    // blocks with gaps between them read as two eyes and a nose at 22px, which
    // turned the shield into a skull. Each arm is a staircase of overlapping
    // 2x2 cells, so the union is one unbroken diagonal.
    // SPEC-V20 §6: the header SLEEP button (and its glyph) is deleted
    // outright — sleeping is now a tap on the bed in the room (js/hub.js).
    rankBadge: '<svg class="pixicon" viewBox="0 0 16 16"><path class="po" d="M3 2h10v5H3zM4 7h8v2H4zM5 9h6v2H5zM6 11h4v2H6zM7 13h2v1H7z"/><path class="pi" d="M5 4h2v2H5zM6 5h2v2H6zM7 6h2v2H7zM8 5h2v2H8zM9 4h2v2H9z"/></svg>'
  };

  // GRADE_COLORS (SPEC-V4 §2): once TRAIN has been used today, the nav
  // button stops being an action and shows today's grade letter in the
  // grade's own colour — same palette js/aim.js already uses for its own
  // result card, duplicated here rather than imported since aim.js isn't
  // ours to touch and this is presentation only.
  var GRADE_COLORS = {
    S: 'var(--gold)', A: 'var(--cash)', B: 'var(--views)',
    C: 'var(--energy)', D: 'var(--elo)', F: 'var(--danger)'
  };

  // SPEC-V16 §3.1: the bottom nav gets its OWN five-hue palette
  // (--nav-play/train/stream/cases/shop) rather than reusing the resource
  // colours. The resource hues have to stay legible as MEANING elsewhere —
  // --cash is money, --subs is followers — and reusing them here made the nav
  // read as five status readouts instead of five destinations. Every one of
  // these five measures 5.3-12.8:1 against the --ink-on-fill label they carry.
  var NAV_BUTTONS = [
    { id: 'play', label: 'PLAY', screen: null, cost: 'play', color: 'var(--nav-play)' },
    { id: 'train', label: 'TRAIN', screen: 'aim', module: 'Aim', cost: 'train', color: 'var(--nav-train)' },
    { id: 'stream', label: 'STREAM', screen: 'stream', module: 'Stream', cost: 'stream', color: 'var(--nav-stream)' },
    // SPEC-V3 §12: opening a case off-stream now costs 1 energy (0 on
    // stream — that's a per-spin choice made inside the cases/stream
    // screens, not something the nav label can show), so this must read
    // Data.energyCosts.case rather than falling back to FREE.
    { id: 'cases', label: 'CASES', screen: 'cases', module: 'Cases', cost: 'case', color: 'var(--nav-cases)' },
    { id: 'shop', label: 'SHOP', screen: 'shop', cost: null, color: 'var(--nav-shop)' }
  ];

  var els = {};

  /* ------------------------------------------------------------------ topbar */
  function buildTopbar() {
    var bar = document.getElementById('topbar');
    bar.innerHTML =
      // V18 header §LEFT — rank & progression, wrapped in ONE inset well
      // (--slot-fill + a 1px light-blue inner highlight) so it reads as a
      // module recessed into the banner instead of three loose elements
      // floating on it. The flat rank-name chip is gone: the tier is now the
      // authored pixel shield, painted with rank.color from refreshTopbar().
      // The old `.rank-chip` CLASS is deliberately not reused here — js/stats.js
      // and js/title.js both build text chips with it and neither is ours.
      '<div class="topbar__rank" id="tb-rank">' +
        '<span class="rank-badge" id="tb-rank-badge">' + ICONS.rankBadge + '</span>' +
        '<div class="topbar__rank-text">' +
          '<span class="topbar__rank-elo" id="tb-rank-elo">0 ELO</span>' +
          '<span class="topbar__rank-name" id="tb-rank-name">SILVER</span>' +
        '</div>' +
        '<div class="rank-progress"><div class="rank-progress__fill" id="tb-rank-fill"></div></div>' +
      '</div>' +
      // V18 header §CENTRE — economy, a distinct framed sub-panel. The MAX
      // VIEWS (eye) stat is REMOVED per the owner's brief, which is why this
      // is a 3-row stack rather than the old 2x2 grid: three rows read as a
      // list at 420px where a 2x2 read as a number soup, and the row form is
      // what §2.5 asks of every other list in the app.
      '<div class="topbar__resources" id="tb-resources" role="button" tabindex="0" aria-label="Money, followers and subscribers — tap to see what each stat means and watch an ad for cash">' +
        '<span class="res res--cash"><span class="res-icon">' + ICONS.cash + '</span><span id="tb-cash">$0</span></span>' +
        '<span class="res res--subs"><span class="res-icon">' + ICONS.followers + '</span><span id="tb-followers">0</span></span>' +
        '<span class="res res--subscribers"><span class="res-icon">' + ICONS.subscribers + '</span><span id="tb-subs">0</span></span>' +
      '</div>' +
      // V18 header §RIGHT — vitals + time. SETTINGS left .topbar__day-top and
      // became a direct child of #topbar, absolutely positioned in the top-
      // right corner exactly as the brief asks; #topbar is already
      // position:relative, so no new containing block is introduced.
      '<button class="topbar__settings" id="tb-settings" aria-label="Settings">' + ICONS.gear + '</button>' +
      '<div class="topbar__day">' +
        '<span class="topbar__day-label">DAY <span id="tb-day">1</span></span>' +
        // SPEC-V20 §6: SLEEP is no longer a header control at all — it moved
        // to a short tap on the bed, in the room (js/hub.js). The V17/V18
        // .tb-sleep key that used to sit here is deleted outright (markup,
        // binding, refresh + CSS together), not hidden — see onHeaderSleep()
        // below for the surviving logic, now exposed via window.Game.Main
        // for js/hub.js to call instead of a header button click.
        '<div class="topbar__energy-row">' +
          '<button class="energy-bar" id="tb-energy-bar" aria-label="Energy — tap to watch an ad for a full refill" title="TAP FOR A FULL-ENERGY AD">' +
            '<div class="energy-bar__fill" id="tb-energy-fill"></div>' +
          '</button>' +
        '</div>' +
      '</div>';

    els.rank = document.getElementById('tb-rank');
    els.rankBadge = document.getElementById('tb-rank-badge');
    els.rankName = document.getElementById('tb-rank-name');
    els.rankFill = document.getElementById('tb-rank-fill');
    els.rankElo = document.getElementById('tb-rank-elo');
    els.cash = document.getElementById('tb-cash');
    els.followers = document.getElementById('tb-followers');
    els.subs = document.getElementById('tb-subs');
    els.day = document.getElementById('tb-day');
    els.energyBar = document.getElementById('tb-energy-bar');
    els.energyFill = document.getElementById('tb-energy-fill');
    els.resources = document.getElementById('tb-resources');

    document.getElementById('tb-settings').addEventListener('click', function () {
      window.Game.UI.beep('click');
      openSettings();
    });
    els.energyBar.addEventListener('click', function () {
      window.Game.UI.beep('click');
      openEnergyModal();
    });
    // §9: the whole 2x2 resources block is one tap target with ONE handler,
    // bound here in the build function (which runs exactly once) and never
    // re-bound/rebuilt from refreshTopbar() (which ticks every second) — see
    // HANDOFF §9.5: replacing/rebinding a node under an active touch is the
    // documented root cause of this project's multi-tap bug.
    els.resources.addEventListener('click', function () {
      window.Game.UI.beep('click');
      openResourcesModal();
    });
    els.resources.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        window.Game.UI.beep('click');
        openResourcesModal();
      }
    });
  }

  /* -------------------------------------------------------------- SLEEP (§3)
     The single most important action in the game: it advances the day and
     banks every overnight payout. It used to live in the hub's bottom control
     row (deleted in V17 §1), then in the header's .tb-sleep key (deleted in
     V20 §6). This is the SAME code path, not a second one — SPEC-V20 §6
     requires the bed-tap gesture in js/hub.js to route through this exact
     function via window.Game.Main.sleepFromBed() rather than re-implementing
     the refusals/toasts a third time.

     Deliberately NOT re-deriving the "energy must be <= 50%" rule: the only
     authority is State.sleepGateStatus(), which is what State.sleep() itself
     consults. Four user-visible bugs in this project came from a second copy
     of a single rule, so this reads the gate and mirrors it. */
  function onHeaderSleep() {
    var State = window.Game.State;
    var UI = window.Game.UI;
    if (!State || !State.data) return; // defensive: topbar outlives a loaded save

    if (State.data.dead) { UI.beep('miss'); UI.toast('CAREER OVER', 'bad'); return; }
    if (State.data.asleep) { UI.beep('miss'); UI.toast('YOU’RE ALREADY ASLEEP', 'bad'); return; }
    if (State.data.moving) { UI.beep('miss'); UI.toast('FINISH MOVING OUT FIRST', 'bad'); return; }

    // SPEC-V5 §21: a pending tournament blocks SLEEP outright. The hub button
    // asked js/hub.js's tournamentPending() wrapper; that wrapper is one line
    // over State.tournamentMatchAvailableToday(), so call State directly
    // rather than reaching into a file this package does not own.
    if (State.tournamentMatchAvailableToday && State.tournamentMatchAvailableToday()) {
      UI.beep('miss');
      UI.toast('A TOURNAMENT IS PENDING — PLAY IT OUT BEFORE YOU SLEEP', 'bad');
      return;
    }

    // The ASLEEP panel, the WAKE UP button and the COUNTING SHEEP minigame all
    // live on the hub screen. SLEEP is now reachable from every screen, so send
    // the player home FIRST — otherwise they end up asleep on the shop with no
    // visible way to wake up.
    var R = window.Game.Router;
    if (R && R.go && R.current() !== 'hub') R.go('hub');

    var res = State.sleep();
    if (!res.ok) {
      // SPEC-V7 §9: every refusal explains itself. Never a silent no-op —
      // same copy the deleted hub button used, so the wording the player has
      // been trained on does not change underneath them.
      UI.beep('miss');
      if (res.reason === 'dead') UI.toast('CAREER OVER', 'bad');
      else if (res.reason === 'energy-too-high') {
        UI.toast((res.message || 'TOO WIRED TO SLEEP — ENERGY MUST BE AT OR BELOW 50%.') +
          ' BURN SOME ENERGY FIRST (PLAY / TRAIN / STREAM).', 'bad');
      }
      else if (res.message) UI.toast(res.message, 'bad');
      else if (res.reason === 'already-asleep') UI.toast('YOU’RE ALREADY ASLEEP', 'bad');
      else UI.toast('CANNOT SLEEP RIGHT NOW', 'bad');
      return;
    }
    UI.beep('click');
    // SPEC-V4 §7: COUNTING SHEEP runs for the whole sleep. js/hub.js starts it
    // on its own screen-enter path, but a sleep triggered from the header is
    // not a screen-enter, so kick it off here exactly as the old button did.
    if (window.Game.Sheep && window.Game.Sheep.start) window.Game.Sheep.start();
  }

  function refreshTopbar(data) {
    var rank = window.Game.State.rank();
    // SPEC-V5 §15: above 2,100 ELO the ladder tops out into the top rank
    // band ("PRO", no next tier) — at that point "X / MAX" reads as
    // PRO LEAGUE, and the chip that would otherwise say "PRO" instead says
    // whether the player is actually signed to a team.
    // V18 header §LEFT. textContent + inline colour ONLY — this runs on the
    // 1s tick and must never rebuild a node (HANDOFF §9.5). The shield is one
    // authored glyph whose paths fill with currentColor, so a tier change is a
    // single `color` write rather than new markup.
    if (rank.name === 'PRO') {
      var signed = data.contract !== 'free' && !!data.myTeamId;
      els.rankName.textContent = signed ? 'PRO · SIGNED' : 'PRO LEAGUE';
    } else {
      els.rankName.textContent = rank.name;
    }
    els.rankBadge.style.color = rank.color;
    // scaleX, not width (SPEC §6 hazard 1): this runs on the 1s tick, and a
    // width transition on a bar inside the fixed header band reflows the whole
    // band for 0.4s out of every second. See the .rank-progress__fill /
    // .energy-bar__fill notes in css/style.css.
    els.rankFill.style.transform = 'scaleX(' + rank.progress.toFixed(4) + ')';
    // §8: at the top of the ladder (rank.next is null) the ELO number used to
    // vanish entirely. It is now always the same shape — "3,412 ELO" — with
    // the tier name on its own line beside it, per the header brief. The next
    // threshold is not lost: it moves to the module's tooltip, since the bar
    // beside it is already the visual answer to "how far to the next rank".
    els.rankElo.textContent = Math.round(rank.elo).toLocaleString('en-US') + ' ELO';
    els.rank.title = rank.next ?
      (Math.round(rank.elo) + ' / ' + rank.next.min + ' ELO TO ' + rank.next.name) :
      'TOP OF THE LADDER';

    window.Game.UI.countUp(els.cash, data.cash, { fmt: window.Game.UI.money });
    window.Game.UI.countUp(els.followers, data.followers, { fmt: window.Game.UI.compact });
    window.Game.UI.countUp(els.subs, data.subscribers || 0, { fmt: window.Game.UI.compact });
    window.Game.UI.countUp(els.day, data.day, { fmt: Math.round });

    // energyMax (SPEC-V3 §10) is a computed value (base + owned energy-category
    // props, capped at 200) — never the flat 100 constant.
    var pct = Math.max(0, Math.min(100, (data.energy / data.energyMax) * 100));
    els.energyFill.style.transform = 'scaleX(' + (pct / 100).toFixed(4) + ')';
    els.energyBar.classList.toggle('energy-bar--night', window.Game.State.dayPhase().phase === 'night');
  }

  /* ---------------------------------------------------------------- ENERGY
     Real-time energy (SPEC-V3 §1): a global tick keeps State.data.energy /
     the day-night phase correct on every screen, not just the hub (which
     also ticks every rAF frame on its own for smooth backdrop animation —
     this interval is what covers every OTHER screen, plus backgrounded-tab
     correctness via the visibilitychange listener below). Tapping the
     energy bar opens the WATCH AD -> FULL ENERGY control. */
  var ENERGY_TICK_MS = 1000;
  var energyTickTimer = null;
  function startEnergyTick() {
    stopEnergyTick();
    window.Game.State.tickEnergy();
    energyTickTimer = setInterval(function () {
      window.Game.State.tickEnergy();
    }, ENERGY_TICK_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  function stopEnergyTick() {
    if (energyTickTimer) { clearInterval(energyTickTimer); energyTickTimer = null; }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  function onVisibilityChange() {
    if (!document.hidden && window.Game.State.data) window.Game.State.tickEnergy();
  }

  function formatCooldown(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return s + 's';
  }

  // openEnergyModal: current energy readout + WATCH AD — FULL ENERGY,
  // respecting/showing State's 60s cooldown (SPEC-V3 §1).
  function openEnergyModal() {
    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var card = document.createElement('div');
    card.className = 'reward-card panel confirm-card energy-modal';
    card.style.setProperty('--reward-accent', 'var(--energy)');

    var title = document.createElement('div');
    title.className = 'reward-card__title';
    title.textContent = 'ENERGY';
    card.appendChild(title);

    var readout = document.createElement('div');
    readout.className = 'energy-modal__readout';
    card.appendChild(readout);

    var adBtn = document.createElement('button');
    adBtn.className = 'btn btn--primary energy-modal__ad-btn';
    card.appendChild(adBtn);

    // One dismiss path (V18 §3): the CLOSE button and the close disc both call
    // it. The MutationObserver below stops the 250ms poll off the layer's
    // class change, so either route tears the modal down identically.
    function dismiss() { window.Game.UI.closeModal(); }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn energy-modal__close-btn';
    closeBtn.textContent = 'CLOSE';
    closeBtn.addEventListener('click', dismiss);
    card.appendChild(closeBtn);

    window.Game.UI.modalChrome(card, title, dismiss);

    function refresh() {
      var d = window.Game.State.data;
      if (!d) return;
      readout.textContent = Math.round(d.energy) + ' / ' + Math.round(d.energyMax) + ' ENERGY';
      var remaining = window.Game.State.adCooldownRemaining();
      if (remaining > 0) {
        adBtn.textContent = 'AD READY IN ' + formatCooldown(remaining);
        window.Game.UI.setDisabled(adBtn, true);
      } else {
        adBtn.textContent = 'WATCH AD — FULL ENERGY';
        window.Game.UI.setDisabled(adBtn, false);
      }
    }
    refresh();
    var refreshTimer = setInterval(refresh, 250);

    adBtn.addEventListener('click', function () {
      if (window.Game.State.adCooldownRemaining() > 0) return;
      clearInterval(refreshTimer);
      window.Game.UI.closeModal();
      playAdOverlay(function () {
        var res = window.Game.State.watchAdRefill();
        if (res.ok) {
          window.Game.UI.beep('cash');
          window.Game.UI.toast('FULL ENERGY!', 'good');
        } else if (res.reason === 'cooldown') {
          window.Game.UI.toast('AD NOT READY YET', 'bad');
        } else {
          window.Game.UI.toast('CAREER OVER', 'bad');
        }
      });
    });

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    requestAnimationFrame(function () { card.classList.add('reward-card--in'); });

    // Stop polling if the modal is dismissed some other way (CLOSE button
    // already clears it; this also covers a future backdrop-click-to-close).
    var observer = new MutationObserver(function () {
      if (!layer.classList.contains('modal-layer--open')) {
        clearInterval(refreshTimer);
        observer.disconnect();
      }
    });
    observer.observe(layer, { attributes: true, attributeFilter: ['class'] });
  }

  // RESOURCES_INFO (§9): the top-bar stats explained in plain language, in the
  // same top-to-bottom order they appear in the header's centre module.
  //
  // V18 header brief: PEAK VIEWERS was dropped here at the same time the eye
  // stat was dropped from the header, and for the same reason — this modal
  // opens BY TAPPING that module, so a fourth row would explain a number the
  // player can no longer see anywhere in the header. peakViewers is still
  // tracked in js/state.js and still read by the stream/career screens; only
  // this explainer row and the header readout are gone.
  var RESOURCES_INFO = [
    {
      icon: 'cash', color: 'var(--acc-green)', label: 'MONEY',
      value: function (d) { return window.Game.UI.money(d.cash); },
      text: 'Everything you own. Earned from streaming, cases, prize money, your salary, subscribers and sponsors. Rent comes out of it every 7 days — go negative twice and your career is over.'
    },
    {
      icon: 'followers', color: 'var(--subs)', label: 'FOLLOWERS',
      value: function (d) { return window.Game.UI.compact(d.followers); },
      text: 'People who follow your stream. More followers raises the viewer ceiling every time you go live, and more of them convert into paying subscribers.'
    },
    {
      icon: 'subscribers', color: 'var(--num-warm)', label: 'SUBSCRIBERS',
      value: function (d) { return window.Game.UI.compact(d.subscribers || 0); },
      text: 'Paying supporters converted from your stream followers. Each one pays $2.50 every 7 days, and they are paid out before rent is charged.'
    }
  ];

  // openResourcesModal (§9): tapping the topbar resources block opens this —
  // same modal-layer/backdrop/`reward-card panel confirm-card` construction
  // and refresh()-closure pattern as openEnergyModal() above, so the two
  // modals share one idiom rather than inventing a second. Explains the four
  // stats, then offers the separate cash-ad cooldown (Data.cashAdCooldownMs,
  // 5 min — deliberately independent of the energy ad's 60s cooldown so the
  // two never compete).
  function openResourcesModal() {
    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var card = document.createElement('div');
    card.className = 'reward-card panel confirm-card resources-modal';
    card.style.setProperty('--reward-accent', 'var(--cash)');

    var title = document.createElement('div');
    title.className = 'reward-card__title';
    title.textContent = 'YOUR STATS';
    card.appendChild(title);

    var list = document.createElement('div');
    list.className = 'resources-modal__list';
    card.appendChild(list);

    var rowValues = [];
    RESOURCES_INFO.forEach(function (info) {
      var row = document.createElement('div');
      row.className = 'resources-modal__row';
      row.style.setProperty('--row-accent', info.color);

      var head = document.createElement('div');
      head.className = 'resources-modal__row-head';
      var icon = document.createElement('span');
      icon.className = 'resources-modal__icon';
      icon.innerHTML = ICONS[info.icon];
      var name = document.createElement('span');
      name.className = 'resources-modal__name';
      name.textContent = info.label;
      var value = document.createElement('span');
      value.className = 'resources-modal__value';
      head.appendChild(icon);
      head.appendChild(name);
      head.appendChild(value);
      row.appendChild(head);

      var desc = document.createElement('div');
      desc.className = 'resources-modal__desc';
      desc.textContent = info.text;
      row.appendChild(desc);

      list.appendChild(row);
      rowValues.push({ info: info, el: value });
    });

    var adBtn = document.createElement('button');
    adBtn.className = 'btn btn--primary resources-modal__ad-btn';
    card.appendChild(adBtn);

    function dismiss() { window.Game.UI.closeModal(); }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn energy-modal__close-btn';
    closeBtn.textContent = 'CLOSE';
    closeBtn.addEventListener('click', dismiss);
    card.appendChild(closeBtn);

    window.Game.UI.modalChrome(card, title, dismiss);

    function refresh() {
      var d = window.Game.State.data;
      if (!d) return;
      rowValues.forEach(function (rv) { rv.el.textContent = rv.info.value(d); });
      // The amount is revealed AFTER the ad, never promised on the button —
      // cashAdReward() exists for tests, not for a pre-ad preview here.
      var remaining = window.Game.State.cashAdCooldownRemaining();
      if (remaining > 0) {
        adBtn.textContent = 'AD READY IN ' + formatCooldown(remaining);
        window.Game.UI.setDisabled(adBtn, true);
      } else {
        adBtn.textContent = 'WATCH AN AD — GET CASH';
        window.Game.UI.setDisabled(adBtn, false);
      }
    }
    refresh();
    var refreshTimer = setInterval(refresh, 250);

    adBtn.addEventListener('click', function () {
      if (window.Game.State.cashAdCooldownRemaining() > 0) return;
      clearInterval(refreshTimer);
      window.Game.UI.closeModal();
      playAdOverlay(function () {
        // playAdOverlay runs ~3 real seconds during which the player may
        // navigate away (e.g. back to the title screen) — re-check
        // State.data still exists before touching it, same guard js/hub.js
        // added for the skip-night ad.
        var d = window.Game.State.data;
        if (!d) return;
        var res = window.Game.State.watchAdCash();
        if (res.ok) {
          window.Game.UI.beep('cash');
          window.Game.UI.rewardCard({
            title: 'CASH AD',
            subtitle: '+' + window.Game.UI.money(res.amount),
            color: 'var(--cash)',
            lines: [{ label: 'NEW BALANCE', value: window.Game.UI.money(d.cash) }],
            buttonText: 'NICE'
          });
        } else if (res.reason === 'cooldown') {
          window.Game.UI.toast('AD NOT READY YET', 'bad');
        } else {
          window.Game.UI.toast('CAREER OVER', 'bad');
        }
      });
    });

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    requestAnimationFrame(function () { card.classList.add('reward-card--in'); });

    var observer = new MutationObserver(function () {
      if (!layer.classList.contains('modal-layer--open')) {
        clearInterval(refreshTimer);
        observer.disconnect();
      }
    });
    observer.observe(layer, { attributes: true, attributeFilter: ['class'] });
  }

  // playAdOverlay: ~3s non-skippable "AD PLAYING…" placeholder (SPEC-V3 §1 —
  // there's no real ad SDK here) with a countdown, then invokes onDone().
  function playAdOverlay(onDone) {
    var layer = document.getElementById('modal-layer');
    if (!layer) { onDone(); return; }
    layer.innerHTML = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var card = document.createElement('div');
    card.className = 'reward-card panel ad-overlay__card';
    var title = document.createElement('div');
    title.className = 'reward-card__title';
    title.textContent = 'AD PLAYING…';
    card.appendChild(title);
    var count = document.createElement('div');
    count.className = 'ad-overlay__count';
    card.appendChild(count);
    var hint = document.createElement('div');
    hint.className = 'ad-overlay__hint';
    hint.textContent = 'PLEASE WAIT';
    card.appendChild(hint);

    // Docked header tab, but DELIBERATELY NO CLOSE DISC (V18 §3): the ad
    // overlay is the one genuinely modal-blocking card in these two files —
    // it is non-skippable by design and its only exit is the 3s timer, which
    // is what then invokes onDone() and pays the reward out. An X here would
    // be a second teardown route that skips the payout entirely.
    window.Game.UI.modalChrome(card, title, null);

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    requestAnimationFrame(function () { card.classList.add('reward-card--in'); });

    var remaining = 3;
    count.textContent = remaining;
    var timer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        window.Game.UI.closeModal();
        onDone();
      } else {
        count.textContent = remaining;
      }
    }, 1000);
  }

  /* ---------------------------------------------------------------- bottomnav */
  function buildBottomNav() {
    var nav = document.getElementById('bottomnav');
    nav.innerHTML = '';
    NAV_BUTTONS.forEach(function (cfg) {
      var btn = document.createElement('button');
      btn.className = 'navbtn';
      btn.id = 'nav-' + cfg.id;
      btn.style.setProperty('--navbtn-color', cfg.color);
      // A zero-energy action (TRAIN, since V2) reads FREE, not "-0".
      var costVal = cfg.cost ? window.Game.Data.energyCosts[cfg.cost] : 0;
      var costLabel = costVal > 0 ? '-' + costVal : 'FREE';
      btn.innerHTML =
        '<span class="navbtn__icon">' + ICONS[cfg.id] + '</span>' +
        '<span class="navbtn__label">' + cfg.label + '</span>' +
        '<span class="navbtn__cost">' + costLabel + '</span>';
      btn.addEventListener('click', function () { onNavClick(cfg); });
      nav.appendChild(btn);
      cfg.el = btn;
    });
  }

  function moduleReady(cfg) {
    return !cfg.module || !!window.Game[cfg.module];
  }

  // streamNavLockReason (§17): while a stream is live (Game.Stream.isLive(),
  // Package V's hook — see js/stream.js's onExit()/isLive() comments), EVERY
  // bottom-nav button — including re-clicking STREAM itself — must be
  // blocked, not just "the ones that would obviously end it". Router.go()
  // calls the target screen's onEnter() even when you're already on it
  // (current === name skips onExit but NOT onEnter), and stream.js's
  // onEnter() unconditionally resets running/sess — so even re-entering the
  // SAME 'stream' route via the nav button would silently wipe the live
  // session with no settlement, same failure shape as clicking SHOP used to
  // have. Blocking uniformly here is what keeps that from being a hole.
  function streamNavLockReason() {
    if (window.Game.Stream && window.Game.Stream.isLive && window.Game.Stream.isLive()) {
      return 'YOU’RE LIVE — END THE STREAM FIRST';
    }
    return null;
  }

  // lockReason: while packing for a move (§8) or asleep (§3), every bottom-
  // nav button is locked regardless of energy/module state, with a tap
  // explaining why — SPEC-V3 §8's exact wording for the move-out case.
  function lockReason(data) {
    if (data.moving) return 'FINISH MOVING OUT FIRST';
    if (data.asleep) return 'YOU’RE ASLEEP — WAKE UP FIRST';
    var streamReason = streamNavLockReason();
    if (streamReason) return streamReason;
    return null;
  }

  // roomLocksNav (SPEC-V5 §5r): PLAY/TRAIN/STREAM/CASES are blocked while
  // the room is missing one of its 5 minimum-viable pieces — SHOP is
  // deliberately exempt ("the player may still enter the SHOP" per spec, and
  // it's how they fix the problem). state.js already hard-gates the actual
  // State.playMatch()/setForm()/openCase() calls (and STREAM's session start
  // is Package R's own responsibility to gate) — this is the earlier,
  // clearer UI-level block so a tap explains the real reason up front
  // instead of the player walking into a minigame that fails at the end.
  function roomLocksNav(cfg) {
    if (cfg.id === 'shop') return false;
    var rc = window.Game.State.roomCompleteness ? window.Game.State.roomCompleteness() : null;
    return !!(rc && !rc.complete);
  }
  var ROOM_PIECE_NAMES = { bed: 'BED', desk: 'DESK', chair: 'CHAIR', pc: 'PC', monitor: 'MONITOR' };
  function roomIncompleteMessage() {
    var rc = window.Game.State.roomCompleteness ? window.Game.State.roomCompleteness() : null;
    var missing = ((rc && rc.missing) || []).map(function (k) { return ROOM_PIECE_NAMES[k] || String(k).toUpperCase(); }).join(', ');
    return 'ROOM INCOMPLETE — MISSING ' + missing + '. FURNISH IT VIA EDIT ROOM FIRST.';
  }

  // renderTrainButton (SPEC-V4 §2): TRAIN is once-per-day; once trained,
  // the button stops being an action and instead reports today's result —
  // the grade letter (in the grade's colour) with the form multiplier as
  // its sub-label, replacing the energy-cost sub-label. Still visually
  // locked (grey lock icon) if the whole nav is locked (moving/asleep).
  function renderTrainButton(cfg, status, locked) {
    var el = cfg.el;
    var trained = !!(status && status.trained);
    el.classList.toggle('navbtn--trained', trained);
    // §11 multi-tap fix: this used to rebuild el.innerHTML unconditionally on
    // EVERY call, and refreshBottomNav() runs off the global 1s energy tick
    // (main.js's startEnergyTick) as well as every State 'change' — i.e.
    // several times a second in the worst case. Rewriting a button's child
    // nodes while a finger is mid-tap on it (touchstart already fired,
    // touchend hasn't) removes the very node the touch is tracking, which is
    // exactly the "moving/replaced element under an active touch" pattern
    // that makes mobile browsers drop the synthesized click — this is why
    // TRAIN specifically needed multiple taps (it's the only nav button that
    // ever did a full innerHTML replace; the others only patch classList/the
    // lock icon, which already skip the no-op case below). Fix: only touch
    // the DOM when the rendered content would actually change.
    var costVal = window.Game.Data.energyCosts.train;
    var costLabel = costVal > 0 ? '-' + costVal : 'FREE';
    var sig = trained ? ('trained:' + status.grade + ':' + status.mult.toFixed(2)) : ('idle:' + costLabel);
    if (el._trainSig !== sig) {
      el._trainSig = sig;
      if (trained) {
        el.innerHTML =
          '<span class="navbtn__icon navbtn__icon--grade">' + status.grade + '</span>' +
          '<span class="navbtn__label">TRAIN</span>' +
          '<span class="navbtn__cost">x' + status.mult.toFixed(2) + '</span>';
      } else {
        el.innerHTML =
          '<span class="navbtn__icon">' + ICONS.train + '</span>' +
          '<span class="navbtn__label">TRAIN</span>' +
          '<span class="navbtn__cost">' + costLabel + '</span>';
      }
    }
    var color = trained ? (GRADE_COLORS[status.grade] || 'var(--views)') : cfg.color;
    el.style.setProperty('--navbtn-color', color);
    window.Game.UI.setDisabled(el, locked, 'navbtn--disabled');
    el.classList.remove('navbtn--soon');
    var lock = el.querySelector('.navbtn__lock');
    if (locked && !lock) {
      el.insertAdjacentHTML('beforeend', ICONS.lock);
    } else if (!locked && lock) {
      lock.parentNode.removeChild(lock);
    }
  }

  function refreshBottomNav(data) {
    var locked = !!lockReason(data);
    var trainStatus = window.Game.State.trainingStatus ? window.Game.State.trainingStatus() : null;
    NAV_BUTTONS.forEach(function (cfg) {
      var roomLocked = locked || roomLocksNav(cfg);
      if (cfg.id === 'train') { renderTrainButton(cfg, trainStatus, roomLocked); return; }
      var costVal = cfg.cost ? window.Game.Data.energyCosts[cfg.cost] : 0;
      var enoughEnergy = data.energy >= costVal;
      var ready = moduleReady(cfg);
      var disabled = roomLocked || !enoughEnergy || !ready;
      window.Game.UI.setDisabled(cfg.el, disabled, 'navbtn--disabled');
      cfg.el.classList.toggle('navbtn--soon', !ready);
      var lock = cfg.el.querySelector('.navbtn__lock');
      if (disabled && !lock) {
        cfg.el.insertAdjacentHTML('beforeend', ICONS.lock);
      } else if (!disabled && lock) {
        lock.parentNode.removeChild(lock);
      }
    });
  }

  function onNavClick(cfg) {
    var data = window.Game.State.data;
    var reason = lockReason(data);
    if (reason) {
      window.Game.UI.toast(reason, 'bad');
      window.Game.UI.beep('miss');
      return;
    }
    if (roomLocksNav(cfg)) {
      window.Game.UI.toast(roomIncompleteMessage(), 'bad');
      window.Game.UI.beep('miss');
      return;
    }
    // TRAIN, once used today, is display-only (SPEC-V4 §2) — tapping it
    // explains itself instead of re-entering the aim trainer.
    if (cfg.id === 'train') {
      var trainStatus = window.Game.State.trainingStatus ? window.Game.State.trainingStatus() : null;
      if (trainStatus && trainStatus.trained) {
        window.Game.UI.beep('miss');
        window.Game.UI.toast('ALREADY TRAINED TODAY — SLEEP TO TRAIN AGAIN', 'info');
        return;
      }
    }
    var costVal = cfg.cost ? window.Game.Data.energyCosts[cfg.cost] : 0;
    if (data.energy < costVal) {
      window.Game.UI.toast('NOT ENOUGH ENERGY', 'bad');
      window.Game.UI.beep('miss');
      return;
    }
    if (!moduleReady(cfg)) {
      window.Game.UI.toast(cfg.label + ' IS STILL WARMING UP — CHECK BACK SOON', 'info');
      return;
    }
    window.Game.UI.beep('click');
    if (cfg.id === 'play') {
      doPlayMatch();
      return;
    }
    window.Game.Router.go(cfg.screen);
  }

  /* -------------------------------------------------------------------- PLAY */
  /* V22d — PLAY is now a 15-SECOND ACTIVE MATCH.

     The ELO is rolled UP FRONT, before the overlay opens, and the card is
     shown after. That ordering is deliberate and load-bearing:

       - Energy is charged and the result decided while the player is still on
         a button they chose to press. Rolling it afterwards would mean a
         player could finish a minigame and only then be told "NOT ENOUGH
         ENERGY", having already done the work.
       - The minigame therefore cannot change whether the match is won. It
         controls PACE, not outcome — which keeps a core progression loop off
         a dexterity gate, and keeps the whole overlay honest theatre.

     Game.MatchGames.run() calls back however the match ends: minigame won,
     QUIT, or the 15s master timer running out. Every path lands here. */
  function doPlayMatch() {
    var res = window.Game.State.playMatch();
    if (!res.ok) {
      // SPEC-V5 §5r: onNavClick already blocks this before it's reachable,
      // but State.playMatch() can also fail for the ordinary energy reason —
      // keep both messages accurate rather than always blaming energy.
      window.Game.UI.toast(
        res.reason === 'room-incomplete' ? roomIncompleteMessage() : 'NOT ENOUGH ENERGY', 'bad');
      window.Game.UI.beep('miss');
      return;
    }
    if (window.Game.MatchGames && window.Game.MatchGames.run) {
      window.Game.MatchGames.run(function () { showMatchResult(res); });
      return;
    }
    // Defensive: matchgames.js absent (an older build) — resolve immediately
    // rather than swallowing the match the player already paid energy for.
    showMatchResult(res);
  }

  function showMatchResult(res) {
    if (res.nudge) {
      window.Game.UI.toast('TRAIN FIRST TO SET YOUR DAILY FORM', 'info');
    }
    window.Game.UI.beep(res.win ? 'cash' : 'miss');
    if (res.win) window.Game.UI.confetti(document.getElementById('nav-play'), 'var(--cash)');
    window.Game.UI.rewardCard({
      title: res.win ? 'VICTORY' : 'DEFEAT',
      subtitle: res.score.you + ' : ' + res.score.opp,
      color: res.win ? 'var(--cash)' : 'var(--danger)',
      lines: [
        { label: 'ELO', value: (res.eloDelta >= 0 ? '+' : '') + Math.round(res.eloDelta), color: res.eloDelta >= 0 ? 'var(--cash)' : 'var(--danger)' },
        { label: 'RANK ELO', value: Math.round(res.elo) }
      ],
      buttonText: 'NICE'
    });
  }

  /* ---------------------------------------------------------------- settings */
  // Settings UI content itself is built by Game.Title.buildSettingsPanel
  // (js/title.js) so the in-game modal and the title-screen settings view
  // stay in sync (music/sound sliders, replay tutorial, reset all saves).
  // This wrapper just supplies the modal chrome + a "back to title" exit.
  function openSettings() {
    var layer = document.getElementById('modal-layer');
    layer.innerHTML = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var card = document.createElement('div');
    card.className = 'reward-card panel confirm-card';

    var title = document.createElement('div');
    title.className = 'reward-card__title';
    title.textContent = 'SETTINGS';
    card.appendChild(title);

    var host = document.createElement('div');
    card.appendChild(host);

    if (window.Game.Title && typeof window.Game.Title.buildSettingsPanel === 'function') {
      window.Game.Title.buildSettingsPanel(host, {
        onClose: window.Game.UI.closeModal,
        onBackToTitle: goToTitleScreen,
        confirmFn: window.Game.UI.confirmModal
      });
    }

    // The settings panel's own exit is UI.closeModal (handed to
    // buildSettingsPanel as onClose above); the disc reuses that same
    // function rather than introducing a second one.
    window.Game.UI.modalChrome(card, title, window.Game.UI.closeModal);

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    requestAnimationFrame(function () { card.classList.add('reward-card--in'); });
  }

  // Returns to the title screen from inside a running game (reachable via
  // the settings modal). Saves progress first so nothing is lost.
  function goToTitleScreen() {
    window.Game.UI.closeModal();
    stopPlaytimeTracking();
    stopEnergyTick();
    window.Game.State.saveCurrent();
    window.Game.Router.go('hub');
    window.Game.Title.show({ onEnterGame: enterGame });
  }

  /* ------------------------------------------------------------ playtime --- */
  // State.data.playtimeMs accumulates only while a game is actually running
  // (i.e. not while sitting on the title screen). Persisted via
  // State.saveCurrent() (no 'change' event — avoids re-rendering the whole
  // UI every tick) roughly every few seconds, and once more on any manual
  // return to the title screen.
  var PLAYTIME_TICK_MS = 5000;
  var playtimeTimer = null;
  function startPlaytimeTracking() {
    stopPlaytimeTracking();
    playtimeTimer = setInterval(function () {
      var data = window.Game.State.data;
      if (!data) return;
      data.playtimeMs = (data.playtimeMs || 0) + PLAYTIME_TICK_MS;
      window.Game.State.saveCurrent();
    }, PLAYTIME_TICK_MS);
  }
  function stopPlaytimeTracking() {
    if (playtimeTimer) { clearInterval(playtimeTimer); playtimeTimer = null; }
  }

  /* -------------------------------------------------------------------- boot */
  var changeListenerBound = false;

  function enterGame() {
    if (!changeListenerBound) {
      changeListenerBound = true;
      window.Game.State.on('change', function (data) {
        refreshTopbar(data);
        refreshBottomNav(data);
      });
    }
    refreshTopbar(window.Game.State.data);
    refreshBottomNav(window.Game.State.data);
    window.Game.Router.go('hub');
    startPlaytimeTracking();
    startEnergyTick();
  }

  function boot() {
    buildTopbar();
    buildBottomNav();
    window.Game.Title.show({ onEnterGame: enterGame });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Exposed so js/hub.js can reuse the exact same ~3s "AD PLAYING…" overlay
  // for SKIP NIGHT — WATCH A SHORT AD (SPEC-V4 §1) instead of building a
  // second copy of the same modal.
  //
  // sleepFromBed (SPEC-V20 §6): the header's .tb-sleep button is gone —
  // tapping the bed in js/hub.js is now the only entry point — but the sleep
  // logic itself (every refusal/toast, the router hop home, kicking off
  // COUNTING SHEEP) is unchanged and stays right here as onHeaderSleep(), the
  // one sleep path this project has. Renaming it would touch nothing but
  // this comment, so it is left as-is and just exposed under a name that
  // describes who calls it now.
  window.Game.Main = { playAdOverlay: playAdOverlay, sleepFromBed: onHeaderSleep };
})();
