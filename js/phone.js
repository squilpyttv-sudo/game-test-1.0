/* ==========================================================================
   CS2 PRO SIMULATOR — js/phone.js
   Game.Phone — the in-hub phone (SPEC-V14 §3 + phone half of §5,
   expanded by SPEC-V17 §5 into the game's main menu surface).

   A diegetic handset anchored bottom-right of the hub. Peek state shows its
   top ~36px always (once unlocked); one tap slides it into a home screen
   with SPONSORS / SOCIAL MEDIA / CRYPTO TRADING / CAREER / STATS /
   INVENTORY tiles. The battery IS d.energy/d.energyMax, the clock IS d.day —
   both read straight from State, nothing re-derived here except via the
   single source of truth, State.phoneStatus().

   V17: the hub's bottom control row (EDIT ROOM / CAREER / STATS / SLEEP) and
   the horizontal edit tray are deleted by other packages. CAREER and STATS
   become phone apps that route to their existing screens; the tray's job
   becomes the INVENTORY app, an in-phone 3x3 grid of stashed props derived
   live from owned-minus-placed. CAREER inherits the notification dot the
   deleted #hub-career-badge used to carry (pending tournament OR unmet
   scrim quota) so that signal is not lost with the row.

   Built ONCE (js/hub.js calls G.Phone.init() from its own buildDom(), which
   itself only ever runs once), then only ever updated on state-change edges
   via G.Phone.refresh() — never rebuilt, never repositioned outside the one
   authored open/close transition. See HANDOFF §9.5: rewriting a live tap
   target's position every frame is the documented cause of this project's
   multi-tap bug; this file diffs before writing and never touches layout
   properties from refresh(). The inventory grid follows the same rule: it
   is rebuilt only when its own content signature (page + id:qty list)
   actually changes, never on every refresh().
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var isOpenState = false;
  var els = {};
  var tileEls = {};      // app id -> tile <button>
  var staggerEls = [];   // [tile x6, homebar] — animated in on open()
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 'home' | 'inventory' — which page of the handset is showing. INVENTORY
  // lives INSIDE the phone rather than behind G.Router: it is a phone app,
  // not a game screen, and registering a screen would mean touching files
  // this package does not own.
  var page = 'home';
  var invPage = 0;
  // Set when a placement is launched from the inventory app, so js/hub.js can
  // hand the player back to that grid when the placement settles. See
  // onSlotTap()/afterPlacement().
  var returnToInventoryAfterPlace = false;
  var invSig = null;     // last-rendered inventory signature; the rebuild diff
  var INV_PAGE_SIZE = 9; // a 3x3 grid — anything beyond it paginates (§5.1)

  // last-rendered snapshot, so refresh() (called on every 'change' — see
  // js/hub.js's syncHubChrome()) only touches the DOM when something the
  // player can actually see has changed.
  var last = { day: null, battPct: null, battLow: null, hidden: null, peekDot: null, locked: null };

  /* ---------------------------------------------------------------- icons
     Authored SVG only (SPEC-V14 §0 craft floor, ART-DIRECTION §2.5) — one
     stroke weight (2px), 24x24 viewBox, currentColor, in the style of
     js/main.js's ICONS map. No emoji, no unicode glyphs, anywhere in this
     file. */
  var ICON_SIGNAL =
    '<svg viewBox="0 0 24 24" class="phone__signal-icon" aria-hidden="true">' +
      '<rect x="1" y="14" width="4" height="7" rx="0.5" fill="currentColor"/>' +
      '<rect x="10" y="9" width="4" height="12" rx="0.5" fill="currentColor"/>' +
      '<rect x="19" y="4" width="4" height="17" rx="0.5" fill="currentColor"/>' +
    '</svg>';

  var ICON_LOCK =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="5" y="11" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="12" cy="15.5" r="1.3" fill="currentColor"/>' +
    '</svg>';

  // SPONSORS — a price tag (a brand deal, signed and attached).
  var ICON_SPONSORS =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M11.6 3H20a1 1 0 011 1v8.4a1 1 0 01-.3.7l-8.8 8.8a1 1 0 01-1.4 0l-7.1-7.1a1 1 0 010-1.4l8.8-8.8a1 1 0 01.4-.6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="16" cy="8" r="1.6" fill="currentColor"/>' +
    '</svg>';

  // SOCIAL MEDIA — a chat bubble (posts, feed, engagement).
  var ICON_SOCIAL =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 5.5h16a1 1 0 011 1V16a1 1 0 01-1 1H9.5L5 21v-4H4a1 1 0 01-1-1V6.5a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="8.2" cy="11" r="1.15" fill="currentColor"/>' +
      '<circle cx="12" cy="11" r="1.15" fill="currentColor"/>' +
      '<circle cx="15.8" cy="11" r="1.15" fill="currentColor"/>' +
    '</svg>';

  // CRYPTO TRADING — a coin with a trend line (holdings + the market).
  var ICON_CRYPTO =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M7 14l3.2-3.2L12.7 13.3 17 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M13.4 9H17v3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // CAREER (SPEC-V17 §5) — a briefcase: the contract, the team, the job.
  // Chunky and symmetrical so it still reads as a silhouette at 26px.
  var ICON_CAREER =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="2.5" y="7.5" width="19" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M9 7.5V6a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 6v1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M2.5 13.2h19" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="10.2" y="11.4" width="3.6" height="3.6" rx="0.6" fill="currentColor"/>' +
    '</svg>';

  // STATS (SPEC-V17 §5) — axes plus a rising trend line with its arrow head.
  var ICON_STATS =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3.5 3v16a1.5 1.5 0 001.5 1.5h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M7.5 15.2l3.4-3.9 2.9 2.4 5-5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M15.1 8h3.7v3.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // INVENTORY (SPEC-V17 §5) — a cardboard box with its flaps folded open and
  // a tape strip down the seam. On a cardboard-brown tile the icon IS the
  // app: the box is the whole read, the way a real phone's app art is.
  var ICON_BOX =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 9h18v10.5a1 1 0 01-1 1H4a1 1 0 01-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M3 9l2.2-5h13.6L21 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M12 4v5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="9.6" y="11.4" width="4.8" height="3.2" rx="0.4" fill="currentColor"/>' +
    '</svg>';

  // Small chrome glyphs for the INVENTORY app's own bar / pager. Same rules.
  var ICON_CHEV_L =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M15 4.5L7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  var ICON_CHEV_R =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M9 4.5L16.5 12 9 19.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  var APP_ICON = {
    sponsors: ICON_SPONSORS, social: ICON_SOCIAL, crypto: ICON_CRYPTO,
    career: ICON_CAREER, stats: ICON_STATS, inventory: ICON_BOX
  };

  /* Tile base colours. css/phone.css is TOKENS-ONLY / zero raw hex, and
     css/tokens.css is not owned by this package, so the three V17 colours
     SPEC-V17 §5 names — CAREER #F58A2B, STATS #63C7EB, INVENTORY cardboard
     brown — are carried HERE as literals and written onto the tile as the
     same `--tile-color` inline custom property the existing three already
     use. No stylesheet gains a hex; the pattern the file already had (a
     `--tile-color` set from JS) simply takes a literal instead of a
     var(). If/when tokens land for these, only this map changes. */
  var APP_COLOR = {
    sponsors: 'var(--cash)',
    social: 'var(--subs)',
    crypto: 'var(--gold)',
    career: '#F58A2B',
    stats: '#63C7EB',
    inventory: '#B07A45'   // cardboard brown
  };

  // SPEC-V17 §5 asks for WHITE icons on CAREER / STATS; INVENTORY's box
  // joins them so the three V17 tiles read as one addition. The house's
  // --ink is the white; a 1px --outline drop shadow (the same treatment
  // .phone__lock-icon already uses) keeps a white 2px stroke legible on the
  // lighter #63C7EB fill rather than letting it wash out.
  var APP_LIGHT_ICON = { career: true, stats: true, inventory: true };

  var APP_ORDER = ['sponsors', 'social', 'crypto', 'career', 'stats', 'inventory'];

  // Apps that hand off to a real G.Router screen. INVENTORY is not here —
  // it is a page of the handset (see openInventory()).
  var APP_ROUTE = { sponsors: 'sponsors', social: 'social', crypto: 'crypto', career: 'career', stats: 'stats' };

  function fmtCount(n) { return Math.round(n).toLocaleString('en-US'); }

  // pixel battery — outline + nub as static chrome, the fill rect's width is
  // the one thing refresh() ever touches (via a CSS custom property, not by
  // rewriting the SVG), so this markup is built exactly once.
  var BATTERY_MAX_FILL = 17; // px, matches the fill rect's track width below
  var BATTERY_SVG =
    '<svg viewBox="0 0 26 13" class="phone__batt" aria-hidden="true">' +
      '<rect x="1" y="1" width="21" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<rect x="23.2" y="4.2" width="2.2" height="4.6" rx="1" fill="currentColor"/>' +
      '<rect class="phone__batt-fill" x="3.5" y="3.5" width="17" height="6" rx="0.5"/>' +
    '</svg>';

  function clamp01(n) { return n < 0 ? 0 : (n > 1 ? 1 : n); }

  function beep(kind) { if (G.UI && G.UI.beep) G.UI.beep(kind); }
  function toast(msg, kind) { if (G.UI && G.UI.toast) G.UI.toast(msg, kind); }

  /* ------------------------------------------------------------------ DOM */
  function rootHtml() {
    return '' +
      '<div class="phone" id="phone-root">' +
        '<div class="phone__scrim" id="phone-scrim"></div>' +
        '<div class="phone__hit" id="phone-hit" role="button" tabindex="0" aria-label="Open phone"></div>' +
        '<div class="phone__handset" id="phone-handset">' +
          '<span class="badge-dot phone__peek-badge" id="phone-peek-badge" aria-hidden="true"></span>' +
          '<div class="phone__body" id="phone-body">' +
            '<div class="phone__speaker"></div>' +
            '<div class="phone__status">' +
              '<span class="phone__status-net">PRO-NET' + ICON_SIGNAL + '</span>' +
              '<span class="phone__status-right">DAY <span id="phone-day">1</span>' + BATTERY_SVG + '</span>' +
            '</div>' +
            '<div class="phone__grid" id="phone-grid"></div>' +
            '<div class="phone__app" id="phone-inv">' +
              '<div class="phone__app-bar">' +
                '<button class="phone__app-back" id="phone-inv-back" aria-label="Back to home screen">' + ICON_CHEV_L + '</button>' +
                '<span class="phone__app-title">INVENTORY</span>' +
                '<span class="phone__app-count" id="phone-inv-count"></span>' +
              '</div>' +
              '<div class="phone__inv-grid" id="phone-inv-grid"></div>' +
              '<div class="phone__inv-empty" id="phone-inv-empty">NOTHING STASHED. BUY PROPS IN THE SHOP, OR HOLD A PROP IN THE ROOM AND STASH IT.</div>' +
              '<div class="phone__inv-pager" id="phone-inv-pager">' +
                '<button class="phone__pager-btn" id="phone-inv-prev" aria-label="Previous page">' + ICON_CHEV_L + '</button>' +
                '<span class="phone__pager-label" id="phone-inv-page">1 / 1</span>' +
                '<button class="phone__pager-btn" id="phone-inv-next" aria-label="Next page">' + ICON_CHEV_R + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="phone__lock" id="phone-lock">' +
              '<span class="phone__lock-icon">' + ICON_LOCK + '</span>' +
              '<div class="phone__lock-progress" id="phone-lock-progress">0 / 0</div>' +
              '<div class="phone__lock-meter"><span class="phone__lock-meter-fill" id="phone-lock-meter-fill"></span></div>' +
              '<div class="phone__lock-text" id="phone-lock-text"></div>' +
            '</div>' +
            '<button class="phone__homebar" id="phone-homebar" aria-label="Close phone"></button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function tileHtml(id) {
    return '' +
      '<button class="phone__tile' + (APP_LIGHT_ICON[id] ? ' phone__tile--light-icon' : '') + '"' +
        ' id="phone-tile-' + id + '" data-app="' + id + '"' +
        ' style="--tile-color: ' + APP_COLOR[id] + '">' +
        '<span class="badge-dot phone__tile-dot" aria-hidden="true"></span>' +
        '<span class="phone__tile-icon"></span>' +
        '<span class="phone__tile-label"></span>' +
        '<span class="phone__tile-meter"><span class="phone__tile-meter-fill"></span></span>' +
      '</button>';
  }

  function buildTiles() {
    var html = APP_ORDER.map(tileHtml).join('');
    els.grid.innerHTML = html;
    staggerEls = [];
    APP_ORDER.forEach(function (id) {
      var t = document.getElementById('phone-tile-' + id);
      tileEls[id] = {
        btn: t,
        icon: t.querySelector('.phone__tile-icon'),
        label: t.querySelector('.phone__tile-label'),
        dot: t.querySelector('.phone__tile-dot'),
        meterWrap: t.querySelector('.phone__tile-meter'),
        meterFill: t.querySelector('.phone__tile-meter-fill'),
        lastLocked: null // force first paint
      };
      t.addEventListener('click', function (e) {
        e.stopPropagation();
        onTileTap(id);
      });
      staggerEls.push(t);
    });
    staggerEls.push(els.homebar);
  }

  /* -------------------------------------------------------------- the apps
     State.phoneStatus() is the single source of truth for the three apps it
     knows about, and js/state.js is FROZEN for V17 — so the three new apps
     get their descriptors built here, in the SAME shape, and the two lists
     are simply concatenated. Nothing about the sponsors/social/crypto rules
     is re-derived locally. */
  function extraApps() {
    var State = G.State;

    // SPEC-V17 §5 / §1: the dot the deleted #hub-career-badge carried. This
    // is js/hub.js's refreshNotifications() condition, reproduced exactly —
    // a pending tournament OR an unmet scrim quota — so deleting the hub row
    // does not delete the signal.
    var pending = false;
    try { pending = !!(State.tournamentMatchAvailableToday && State.tournamentMatchAvailableToday()); } catch (e) { pending = false; }
    var scrimStatus = State.scrimQuotaStatus ? State.scrimQuotaStatus() : null;
    var scrimUnmet = !!(scrimStatus && !scrimStatus.met);

    return [
      {
        id: 'career', name: 'CAREER', unlocked: true, unlockLabel: null,
        notifCount: (pending || scrimUnmet) ? 1 : 0, progress: null
      },
      {
        id: 'stats', name: 'STATS', unlocked: true, unlockLabel: null,
        notifCount: 0, progress: null
      },
      {
        id: 'inventory', name: 'INVENTORY', unlocked: true, unlockLabel: null,
        notifCount: 0, progress: null
      }
    ];
  }

  function allApps(status) {
    return status.apps.concat(extraApps());
  }

  function findApp(id) {
    var State = G.State;
    if (!State || !State.data || !State.phoneStatus) return null;
    var list = allApps(State.phoneStatus());
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }

  function onTileTap(id) {
    var State = G.State;
    if (!State || !State.data || !State.phoneStatus) return;
    var app = findApp(id);
    if (!app) return;
    if (!app.unlocked) {
      beep('miss');
      toast(app.unlockLabel, 'bad');
      return;
    }

    // INVENTORY is a page of the handset, not a screen — no navigation, the
    // phone stays open.
    if (id === 'inventory') {
      beep('click');
      openInventory();
      return;
    }

    // SPEC-V5 §5r, inherited verbatim from the deleted hub CAREER button:
    // CAREER (including signing anything inside it) is blocked while the
    // room is incomplete, and says so on tap rather than letting the player
    // walk in and only find out once they try to sign.
    if (id === 'career') {
      var rc = State.roomCompleteness ? State.roomCompleteness() : null;
      if (rc && !rc.complete) {
        beep('miss');
        toast('ROOM INCOMPLETE — FURNISH IT FIRST', 'bad');
        return;
      }
    }

    var route = APP_ROUTE[id];
    if (!route) return;
    if (G.Router && G.Router.isRegistered && !G.Router.isRegistered(route)) {
      beep('miss');
      toast(app.name + ' IS NOT AVAILABLE IN THIS BUILD', 'bad');
      return;
    }

    beep('click');
    closePhoneInstant();
    if (G.Router && G.Router.go) G.Router.go(route);
    // js/career.js and js/stats.js return via G.Router.back() -> go('hub'),
    // which lands on the hub with the phone merely peeking, unlike
    // js/sponsors.js which explicitly reopens it. Those are files this
    // package does not own, so the proper one-line fix is REPORTED, not
    // made; this is the phone-side safety net so the app still behaves like
    // every other app in the meantime. It is a bounded one-shot watcher,
    // not a render loop, and it never touches a tap target's position.
    if (id === 'career' || id === 'stats') armReturnToPhone(route);
  }

  /* ------------------------------------------- return-to-phone safety net */
  var returnTimer = null;
  function cancelReturnWatch() {
    if (returnTimer) { clearInterval(returnTimer); returnTimer = null; }
  }
  function armReturnToPhone(route) {
    cancelReturnWatch();
    var tries = 0;
    returnTimer = setInterval(function () {
      tries++;
      var cur = (G.Router && G.Router.current) ? G.Router.current() : null;
      if (cur === 'hub') {
        cancelReturnWatch();
        if (built && !els.root.classList.contains('phone--hidden')) openPhone();
        return;
      }
      // The player navigated somewhere else entirely — drop the intent
      // rather than ambushing them with an open phone much later.
      if (tries > 120 || (cur !== route && cur !== null)) cancelReturnWatch();
    }, 100);
  }

  /* -------------------------------------------------------- INVENTORY app
     Inventory = owned MINUS placed, derived live every time it is asked for.
     No new persisted field, no state mutation (SPEC-V17 §5.1). Consumables
     (energy drinks) and the `room` category are EXCLUDED — exactly the
     filter the deleted edit tray used, because they are not room props:
     energy cans are a stockpile drunk from the hub button (SPEC-V7 §7,
     and data.js's normalizeSave() strips any stray placed energy_can). */
  function inventoryStacks() {
    var State = G.State;
    if (!State || !State.data) return [];
    var d = State.data;
    var defs = (G.Data && G.Data.shopItems) ? G.Data.shopItems : [];
    var placedCount = {};
    (d.placed || []).forEach(function (p) { placedCount[p.id] = (placedCount[p.id] || 0) + 1; });
    var out = [];
    defs.forEach(function (def) {
      if (def.category === 'room' || def.category === 'consumable') return;
      var owned = (d.owned && d.owned[def.id]) || 0;
      if (!owned) return;
      var remaining = owned - (placedCount[def.id] || 0);
      if (remaining > 0) out.push({ id: def.id, name: def.name || def.id, qty: remaining });
    });
    return out;
  }

  // The name is a VISIBLE label, not just the title/aria text it used to be
  // (owner playtest, V19 item 8: you could not tell two same-family stacks
  // apart). `title` never appears on a touch device and aria-label is only
  // spoken, so on the actual target hardware the tile was an unlabelled
  // sprite. The full name stays on both attributes for screen readers and
  // for the case where the visible label is clamped to two lines.
  function slotHtml() {
    return '' +
      '<button class="phone__slot" type="button">' +
        '<canvas class="phone__slot-icon" width="44" height="44"></canvas>' +
        '<span class="phone__slot-name"></span>' +
        '<span class="phone__slot-qty"></span>' +
      '</button>';
  }

  // Rebuilds the 3x3 grid — but ONLY when renderInventory() has decided the
  // signature changed. Never called from a loop, never mid-tap.
  function buildInventoryGrid(stacks) {
    var totalPages = Math.max(1, Math.ceil(stacks.length / INV_PAGE_SIZE));
    if (invPage > totalPages - 1) invPage = totalPages - 1;
    if (invPage < 0) invPage = 0;
    var start = invPage * INV_PAGE_SIZE;
    var pageItems = stacks.slice(start, start + INV_PAGE_SIZE);

    els.invGrid.innerHTML = '';
    for (var i = 0; i < INV_PAGE_SIZE; i++) {
      var stack = pageItems[i];
      if (!stack) {
        var empty = document.createElement('div');
        empty.className = 'phone__slot phone__slot--empty';
        empty.setAttribute('aria-hidden', 'true');
        els.invGrid.appendChild(empty);
        continue;
      }
      var wrap = document.createElement('div');
      wrap.innerHTML = slotHtml();
      var btn = wrap.firstChild;
      var canvas = btn.querySelector('.phone__slot-icon');
      var qty = btn.querySelector('.phone__slot-qty');
      var nameEl = btn.querySelector('.phone__slot-name');
      qty.textContent = 'x' + stack.qty;
      nameEl.textContent = stack.name;
      btn.setAttribute('aria-label', stack.name + ' — ' + stack.qty + ' in storage — tap to place');
      btn.setAttribute('title', stack.name);
      (function (id) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); onSlotTap(id); });
      })(stack.id);
      els.invGrid.appendChild(btn);
      // Same handshake the shop and the old tray used: renderPropIcon takes
      // the CANVAS, and is deferred a frame so the element is laid out
      // (and has a real backing store) before it is drawn into.
      (function (c, id) {
        requestAnimationFrame(function () {
          if (G.Iso && G.Iso.renderPropIcon) {
            try { G.Iso.renderPropIcon(c, id); } catch (e) { /* a missing prop map must not break the grid */ }
          }
        });
      })(canvas, stack.id);
    }

    var many = stacks.length > INV_PAGE_SIZE;
    els.invPager.classList.toggle('phone__inv-pager--show', many);
    els.invPage.textContent = (invPage + 1) + ' / ' + totalPages;
    els.invPrev.disabled = invPage <= 0;
    els.invNext.disabled = invPage >= totalPages - 1;
    els.invEmpty.classList.toggle('phone__inv-empty--show', stacks.length === 0);
    els.invCount.textContent = stacks.length ? (stacks.length + (stacks.length === 1 ? ' STACK' : ' STACKS')) : '';
  }

  // The diff. `sig` is page + the exact id:qty list; identical signature
  // means the DOM already says the truth, so nothing is rebuilt. This is
  // what keeps a state 'change' tick from swapping a slot out from under a
  // finger (HANDOFF §9.5).
  function renderInventory(force) {
    if (!built) return;
    var stacks = inventoryStacks();
    var sig = invPage + '|' + stacks.map(function (s) { return s.id + ':' + s.qty; }).join(',');
    if (!force && sig === invSig) return;
    invSig = sig;
    buildInventoryGrid(stacks);
    // buildInventoryGrid may have clamped invPage (last page emptied out);
    // keep the signature honest so the next diff compares like for like.
    invSig = invPage + '|' + stacks.map(function (s) { return s.id + ':' + s.qty; }).join(',');
  }

  function onSlotTap(itemId) {
    beep('click');
    // SPEC-V17 §5.1: close the phone FIRST — the prop is about to appear
    // centre-screen in the Moving state and the handset would sit on top of
    // the room it has to be dragged around in.
    closePhoneInstant();
    setPage('home');

    var hub = G.Hub;
    var fn = hub && hub.spawnIntoMoveState;
    if (!fn) {
      // P1's half of the cross-package API is not present in this build.
      // Say so honestly rather than eating the tap.
      beep('miss');
      toast('PLACING FROM INVENTORY IS UNAVAILABLE IN THIS BUILD', 'bad');
      return;
    }
    var ok = false;
    try { ok = !!fn.call(hub, itemId); } catch (e) { ok = false; }
    if (!ok) {
      beep('miss');
      toast('NO ROOM TO DROP THAT — CLEAR SOME FLOOR FIRST', 'bad');
      return;
    }
    // The placement that is now in flight started HERE, in the inventory app.
    // js/hub.js calls back through Phone.afterPlacement() once it settles so
    // the player lands back on this grid instead of the bare room — placing
    // five things in a row otherwise means five trips back through the phone.
    returnToInventoryAfterPlace = true;
  }

  /* afterPlacement — js/hub.js calls this when a placement started from the
     inventory app finishes. `committed` is true if the prop was actually
     placed, false if the draft was discarded.

     The flag is cleared either way: a placement begun from the inventory is a
     one-shot intent, and leaving it set would reopen the phone after some
     LATER, unrelated placement the player started by holding a prop in the
     room. That is the "suppression flag written by nobody" failure in
     HANDOFF-V2 §5 wearing a different hat — the flag has exactly one writer
     that sets it and one place that clears it. */
  function afterPlacement(committed) {
    if (!returnToInventoryAfterPlace) return false;
    returnToInventoryAfterPlace = false;
    if (!committed) return false;
    openPhone();
    openInventory();
    return true;
  }

  function openInventory() {
    setPage('inventory');
    invPage = 0;
    renderInventory(true);
  }

  function setPage(next) {
    if (page === next) return;
    page = next;
    els.root.classList.toggle('phone--app-inventory', page === 'inventory');
  }

  /* --------------------------------------------------------------- motion */
  function playOpenStagger() {
    var delayStep = reduceMotion ? 0 : 20;
    staggerEls.forEach(function (el, i) {
      el.classList.add('phone__stagger--reset');
      el.style.transitionDelay = (i * delayStep) + 'ms';
    });
    // force reflow so the reset (opacity:0 / translateY) paints before we
    // flip back to the animated-in state — otherwise the browser coalesces
    // both class changes into one frame and nothing appears to move.
    void els.grid.offsetWidth;
    requestAnimationFrame(function () {
      staggerEls.forEach(function (el) { el.classList.remove('phone__stagger--reset'); });
    });
  }

  function resetStaggerInstant() {
    staggerEls.forEach(function (el) {
      el.classList.add('phone__stagger--noanim');
      el.classList.add('phone__stagger--reset');
      el.style.transitionDelay = '0ms';
    });
    void els.grid.offsetWidth;
    staggerEls.forEach(function (el) { el.classList.remove('phone__stagger--noanim'); });
  }

  /* ------------------------------------------------------------ open/close */
  function openPhone() {
    if (!built || isOpenState) return;
    if (els.root.classList.contains('phone--hidden')) return; // asleep/moving — nothing to open
    isOpenState = true;
    els.root.classList.add('phone--open');
    playOpenStagger();
  }

  function closePhone() {
    if (!isOpenState) return;
    isOpenState = false;
    els.root.classList.remove('phone--open');
    setPage('home'); // reopening always lands on the home screen, like a real handset
    resetStaggerInstant(); // SPEC-V14 §3.4: close reverses with NO stagger
  }

  function closePhoneInstant() {
    // Used when navigating away entirely (tile tap, hub onExit) — no reason
    // to play any transition for a screen the player is about to leave.
    var hadTransition = els.handset.style.transition;
    els.handset.style.transition = 'none';
    closePhone();
    // restore next frame so the normal transition rules apply again
    requestAnimationFrame(function () { els.handset.style.transition = hadTransition; });
  }

  /* ------------------------------------------------------------- refresh */
  function updateTile(app) {
    var t = tileEls[app.id];
    if (!t) return;
    var locked = !app.unlocked;
    if (t.lastLocked !== locked) {
      t.btn.classList.toggle('phone__tile--locked', locked);
      t.icon.innerHTML = locked ? ICON_LOCK : APP_ICON[app.id];
      t.lastLocked = locked;
    }
    var labelText = locked ? app.unlockLabel : app.name;
    if (t.label.textContent !== labelText) t.label.textContent = labelText;
    var showDot = !locked && app.notifCount > 0;
    t.dot.classList.toggle('badge-dot--show', showDot);
    if (locked) {
      var pct = Math.round((app.progress ? app.progress.pct : 0) * 100);
      t.meterFill.style.width = pct + '%';
    }
    t.btn.setAttribute('aria-label', locked ? (app.name + ' — locked — ' + app.unlockLabel) : app.name);
  }

  function refresh() {
    if (!built) return;
    var State = G.State;
    if (!State || !State.data || !State.phoneStatus) { setHidden(true); return; }
    var d = State.data;
    var status = State.phoneStatus();

    // SPEC-V15-BATCH-C §2.2 (owner item §13): the peek renders even below
    // the 300-follower threshold — only asleep / moving out hide it
    // outright. Being locked is its own visible state, handled below.
    //
    // There used to be a third condition here: the EDIT ROOM tray slid up
    // over exactly this corner, so an open tray hid the phone. SPEC-V17 §1
    // deletes #hub-tray and its .hub__edit-tray--open class outright (the
    // tray's job is this file's INVENTORY app now) and §2 removes edit mode
    // altogether — the room is always editable by holding a prop. There is
    // nothing left to check for, so the check is gone rather than left
    // dormant against an element that no longer exists.
    var hidden = !!d.asleep || !!d.moving;
    setHidden(hidden);
    if (hidden) return;

    var locked = !status.unlocked;
    if (last.locked !== locked) {
      els.root.classList.toggle('phone--locked', locked);
      last.locked = locked;
    }

    if (locked) {
      // No app grid while locked (SPEC-V15-BATCH-C §2.2) — real progress
      // and the unlock condition ARE the content. status.followers/.needed
      // come straight from State.phoneStatus(); the 300 threshold is never
      // recomputed here.
      setPage('home');
      var needed = status.needed || 1;
      els.lockProgress.textContent = fmtCount(Math.min(status.followers, needed)) + ' / ' + fmtCount(needed);
      els.lockMeterFill.style.width = (clamp01(status.followers / needed) * 100).toFixed(1) + '%';
      els.lockText.textContent = 'Unlocks at ' + fmtCount(needed) + ' stream followers.';
      if (last.peekDot !== false) { els.peekBadge.classList.remove('badge-dot--show'); last.peekDot = false; }
      return;
    }

    // SIGNATURE DETAIL (§0): clock = d.day, battery = d.energy/d.energyMax.
    var dayText = String(d.day || 1);
    if (last.day !== dayText) { els.day.textContent = dayText; last.day = dayText; }
    // The fill rect's WIDTH is written directly. A `transform: scaleX()` on
    // this rect was tried instead (composited, and what the generic
    // "don't animate width" guidance asks for) and MEASURED NOT TO WORK: the
    // inline style applies and transform-box resolves to fill-box, but the
    // computed transform stays matrix(1,0,0,1,0,0) and the rect never scales
    // — CSS transforms are not honoured on SVG child elements in the target
    // engine. Width is the approach that actually renders, so it stays.
    var pct = d.energyMax ? clamp01(d.energy / d.energyMax) : 0;
    if (last.battPct !== pct) {
      els.battFill.setAttribute('width', (pct * BATTERY_MAX_FILL).toFixed(2));
      last.battPct = pct;
    }
    var low = pct < 0.2;
    if (last.battLow !== low) { els.battFill.classList.toggle('phone__batt-fill--low', low); last.battLow = low; }

    var anyDot = false;
    allApps(status).forEach(function (app) { updateTile(app); if (app.notifCount > 0) anyDot = true; });
    if (last.peekDot !== anyDot) { els.peekBadge.classList.toggle('badge-dot--show', anyDot); last.peekDot = anyDot; }

    // Only while the app is actually on screen, and only through the diff —
    // a no-op when nothing about the stash changed.
    if (page === 'inventory' && isOpenState) renderInventory(false);
  }

  function setHidden(hidden) {
    if (last.hidden === hidden) return;
    last.hidden = hidden;
    if (hidden) {
      if (isOpenState) closePhoneInstant();
      els.root.classList.add('phone--hidden');
    } else {
      els.root.classList.remove('phone--hidden');
    }
  }

  /* --------------------------------------------------------------- public */
  G.Phone = {
    ready: true,

    // Called by js/hub.js when a placement settles (commit or cancel). Returns
    // true if the phone was reopened on the inventory grid. Safe to call for
    // every placement — it no-ops unless this app started the one that ended.
    afterPlacement: afterPlacement,

    // Called once by js/hub.js's buildDom() — canvasWrapEl is
    // .hub__canvas-wrap.
    init: function (canvasWrapEl) {
      if (built || !canvasWrapEl) return;
      canvasWrapEl.insertAdjacentHTML('beforeend', rootHtml());
      els.root = document.getElementById('phone-root');
      els.scrim = document.getElementById('phone-scrim');
      els.hit = document.getElementById('phone-hit');
      els.handset = document.getElementById('phone-handset');
      els.body = document.getElementById('phone-body');
      els.peekBadge = document.getElementById('phone-peek-badge');
      els.day = document.getElementById('phone-day');
      els.battFill = els.handset.querySelector('.phone__batt-fill');
      els.grid = document.getElementById('phone-grid');
      els.lockProgress = document.getElementById('phone-lock-progress');
      els.lockMeterFill = document.getElementById('phone-lock-meter-fill');
      els.lockText = document.getElementById('phone-lock-text');
      els.homebar = document.getElementById('phone-homebar');
      els.invBack = document.getElementById('phone-inv-back');
      els.invGrid = document.getElementById('phone-inv-grid');
      els.invEmpty = document.getElementById('phone-inv-empty');
      els.invPager = document.getElementById('phone-inv-pager');
      els.invPrev = document.getElementById('phone-inv-prev');
      els.invNext = document.getElementById('phone-inv-next');
      els.invPage = document.getElementById('phone-inv-page');
      els.invCount = document.getElementById('phone-inv-count');

      buildTiles();

      els.hit.addEventListener('click', openPhone);
      els.hit.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPhone(); }
      });
      // Tapping the bezel/status area of an already-open phone does nothing;
      // tapping it while peeking (closed) opens — the only place this can
      // be reached is the visible sliver, since the rest is clipped by #app.
      els.body.addEventListener('click', function (e) {
        if (!isOpenState) openPhone();
      });
      els.homebar.addEventListener('click', function (e) {
        e.stopPropagation();
        closePhone();
      });
      els.scrim.addEventListener('click', closePhone);

      els.invBack.addEventListener('click', function (e) {
        e.stopPropagation();
        beep('click');
        setPage('home');
      });
      els.invPrev.addEventListener('click', function (e) {
        e.stopPropagation();
        if (invPage <= 0) return;
        beep('click');
        invPage--;
        renderInventory(true);
      });
      els.invNext.addEventListener('click', function (e) {
        e.stopPropagation();
        beep('click');
        invPage++;
        renderInventory(true);
      });

      els.root.classList.add('phone--hidden');
      last.hidden = true;
      built = true;
    },

    refresh: refresh,
    open: openPhone,
    close: closePhone,
    isOpen: function () { return isOpenState; },

    // Internal — js/hub.js calls this from the hub screen's onExit() so the
    // phone never lingers open (mid-transition or otherwise) over whatever
    // screen comes next.
    reset: function () {
      if (!built) return;
      if (isOpenState) closePhoneInstant();
      setPage('home');
    }
  };
})(window.Game = window.Game || {});
