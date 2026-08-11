/* ==========================================================================
   CS2 PRO SIMULATOR — js/shop.js
   The shop screen. SPEC-V15-BATCH-B §2 reverses SPEC-V5 §20 on purpose:

   >> SPEC-V5 §20 deliberately specified "one continuous scroll through
   >> SECTION_ORDER... No tabs, no category filter — every section renders
   >> every time." That put 10 categories and ~39 items in a 420px column
   >> at once. Playtesters could not find anything. §20 IS REVERSED BY THIS
   >> FILE. Do not restore the single-scroll layout — that was the bug, not
   >> a style choice. If a future pass is tempted to "simplify" this back to
   >> one long list, read SPEC-V15-BATCH-B §2 first.

   The new shape: a horizontally-scrolling category strip (one category
   selected, only that category's items render), a filter/sort row, and a
   2-column card grid. Purchases still place gear in the room (see
   js/state.js buyItem/autoPlace) — none of the underlying purchase rules
   changed, only how they're presented.
   ========================================================================== */
(function () {
  'use strict';

  var built = false;
  var els = {};

  // 'staff' isn't a Data.shopItems category (it's Data.staffCoaches /
  // staffMods / socialManagers) so it's special-cased in renderGrid() below,
  // same as before. Order matches SPEC-V15-BATCH-B §2's list exactly.
  // SPEC-V20 §1/§3 added the `window` and `blind` categories to
  // Data.shopItems. This array is what BUILDS the category strip, so a
  // category missing from it has no tab — and with no tab there is no way to
  // reach its items at all. (That is exactly what happened when V20's rules
  // package landed: the items existed in the catalog, priced and specced,
  // and were unbuyable.) Anything added to Data.shopItems with a new
  // category must be added here, to CATEGORY_LABEL and to CATEGORY_ICON in
  // the same edit. They sit next to `decor` because they are the same kind
  // of purchase — room fabric, not gear — and before `staff`, which stays
  // last because it is the one tab that isn't a Data.shopItems category.
  var CATEGORY_ORDER = ['desk', 'pc', 'monitor', 'chair', 'bed', 'energy', 'regen', 'consumable', 'decor', 'window', 'blind', 'staff'];
  var CATEGORY_LABEL = {
    desk: 'DESK', pc: 'PC', monitor: 'MONITOR', chair: 'CHAIR', bed: 'BED',
    energy: 'ENERGY', regen: 'REGEN', consumable: 'DRINKS', decor: 'DECOR',
    window: 'WINDOWS', blind: 'BLINDS', staff: 'STAFF'
  };

  // SPEC-V3 §13: idle income is gone. The `income` gear stat was repurposed
  // into a subscriber-conversion buff (each point = +5% follower->subscriber
  // conversion, State.applyStreamResult/statsSummary) — relabeled here to
  // match, using the same "SUB CONVERSION" name js/stats.js's buff row uses.
  var STAT_COLOR = {
    aim: 'var(--views)', stream: 'var(--subs)', income: 'var(--energy)',
    prestige: 'var(--gold)', luck: 'var(--elo)'
  };
  var STAT_LABEL = { aim: 'AIM', stream: 'STREAM', income: 'SUB CONVERSION', prestige: 'PRESTIGE', luck: 'LUCK' };

  var BAND_LABEL = { starter: 'STARTER', pro: 'PRO', elite: 'ELITE' };
  var BAND_ORDER = { starter: 0, pro: 1, elite: 2 };

  /* ---------------------------------------------------------------- icons
     Authored SVG only (ART-DIRECTION.md §2.5 / craft floor) — 24x24
     viewBox, 2px stroke, currentColor, the standard js/phone.js set. No
     emoji or Unicode glyphs anywhere in this file. */
  var CATEGORY_ICON = {
    desk:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5.5" width="20" height="3" rx="0.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 8.5v12M19.5 8.5v12M9 12.5h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    pc:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="6.3" r="1" fill="currentColor"/><path d="M9.3 10.5h5.4M9.3 13.5h5.4M9.3 16.5h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    monitor:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="12.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 20.5h6M12 16.5v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    chair:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 2.5v9.5h11V2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6.5 12l-1.7 9.5M17.5 12l1.7 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    bed:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="10.5" width="20" height="7.5" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="7" width="6.5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 18v3.5M21 18v3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    energy:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/></svg>',
    regen:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0113.6-5.7M20 12a8 8 0 01-13.6 5.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 3v4.3h-4.3M7 21v-4.3h4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    consumable:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2.5" width="8" height="2.2" rx="0.6" fill="currentColor"/><path d="M7.2 5.2h9.6l-1.1 15a1.6 1.6 0 01-1.6 1.5H9.9a1.6 1.6 0 01-1.6-1.5l-1.1-15z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7.7 10.4h8.6" stroke="currentColor" stroke-width="1.3"/></svg>',
    decor:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/><path d="M4.5 16l4.5-4.5 3 3 3.5-3.5 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    // A frame with both mullions — reads as a window at 24px in a way a
    // single-cross frame does not (it would read as a 4-pane grid icon).
    window:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="1.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    // Slats plus the pull cord — the cord is what separates it from a
    // generic "list" or "menu" glyph at this size.
    blind:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="1.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 8h15M4.5 12h15M4.5 16h15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M17 20.5v2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    staff:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" class="shop2-icon" aria-hidden="true"><path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_LOCK =
    '<svg viewBox="0 0 24 24" class="shop2-icon" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.3 10.5V8a3.7 3.7 0 017.4 0v2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // -- filter/sort state (in-memory only — resets on re-entering the shop,
  // same lifetime as `built`) ------------------------------------------------
  var activeCategory = CATEGORY_ORDER[0];
  var affordableOnly = false;
  var sortMode = 'price-asc'; // 'price-asc' | 'price-desc' | 'tier'

  function buildDom() {
    var root = window.Game.Router.root('shop');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">SHOP</span><button class="btn screen-header__back" id="shop-back">BACK</button></div>' +
      '<div class="shop2-catstrip" id="shop2-catstrip"></div>' +
      '<div class="shop2-filters" id="shop2-filters">' +
        '<button type="button" class="shop2-toggle" id="shop2-afford-toggle">' + ICON_CHECK + '<span>AFFORDABLE ONLY</span></button>' +
        '<select class="shop2-sort" id="shop2-sort">' +
          '<option value="price-asc">PRICE &uarr;</option>' +
          '<option value="price-desc">PRICE &darr;</option>' +
          '<option value="tier">TIER</option>' +
        '</select>' +
      '</div>' +
      '<div class="shop2-grid" id="shop2-grid"></div>';

    els.catstrip = document.getElementById('shop2-catstrip');
    els.affordToggle = document.getElementById('shop2-afford-toggle');
    els.sortSelect = document.getElementById('shop2-sort');
    els.grid = document.getElementById('shop2-grid');

    document.getElementById('shop-back').addEventListener('click', function () {
      window.Game.UI.beep('click');
      window.Game.Router.back();
    });

    CATEGORY_ORDER.forEach(function (cat) {
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'shop2-cattile';
      tile.dataset.cat = cat;
      tile.innerHTML =
        '<span class="shop2-cattile__icon">' + CATEGORY_ICON[cat] + '</span>' +
        '<span class="shop2-cattile__label">' + CATEGORY_LABEL[cat] + '</span>' +
        '<span class="shop2-cattile__badge" data-badge></span>';
      tile.addEventListener('click', function () {
        if (activeCategory === cat) return;
        activeCategory = cat;
        window.Game.UI.beep('click');
        renderAll();
      });
      els.catstrip.appendChild(tile);
    });

    els.affordToggle.addEventListener('click', function () {
      affordableOnly = !affordableOnly;
      window.Game.UI.beep('click');
      renderAll();
    });
    els.sortSelect.addEventListener('change', function () {
      sortMode = els.sortSelect.value;
      renderAll();
    });

    built = true;
  }

  // ---- per-item state (SPEC-V15-BATCH-B §2: "state, unmistakably — OWNED,
  // PLACED, CAN'T AFFORD, CAP REACHED") -------------------------------------
  function itemState(def, data) {
    var singleton = (def.category === 'desk' || def.category === 'pc' ||
      def.category === 'chair' || def.category === 'monitor' || def.category === 'bed');
    var placed = false, ownedQty = 0;

    if (def.category === 'bed') {
      // Old beds stay in `owned` after an upgrade (autoPlaceSingleton only
      // swaps `placed`), so "owned > 0" alone can't tell EQUIPPED apart from
      // a bed you've since upgraded away from — check against the bed
      // actually placed in the room (State.currentBed()) instead.
      var current = window.Game.State.currentBed();
      placed = !!current && current.id === def.id;
      ownedQty = data.owned[def.id] || 0;
    } else if (singleton) {
      ownedQty = data.owned[def.id] || 0;
      placed = ownedQty > 0;
    } else {
      ownedQty = data.owned[def.id] || 0;
    }

    var affordable = data.cash >= def.price;
    var fridgeGate = (def.requiresFridge && !placed) ? window.Game.State.fridgeStatus() : null;
    var fridgeLocked = !!(fridgeGate && !fridgeGate.canBuyDrink);
    var atEnergyCap = (def.category === 'energy' && !placed && window.Game.State.energyItemStatus().atCap);

    // "Buyable right now" — drives both the BUY button and the category
    // strip's affordable-count badge. Placed/equipped singleton items are
    // never buyable again (there's nothing left to buy); everything else is
    // buyable if affordable and not fridge-locked (cap reached still allows
    // buying — it only stops counting toward max energy, SPEC-V6 §16).
    var buyable = !placed && affordable && !fridgeLocked;

    var tag = null;
    if (placed) {
      tag = singleton ? 'PLACED' : 'OWNED';
    } else if (ownedQty > 0) {
      tag = 'OWNED';
    }

    return {
      singleton: singleton, placed: placed, ownedQty: ownedQty, affordable: affordable,
      fridgeLocked: fridgeLocked, fridgeGate: fridgeGate, atEnergyCap: atEnergyCap,
      buyable: buyable, tag: tag
    };
  }

  // How many items in a category are buyable right now — answers "where can
  // I spend?" from the strip itself (SPEC-V15-BATCH-B §2 point 4).
  function affordableCount(cat, data) {
    if (cat === 'staff') {
      var n = 0;
      var coachId = data.staff.coachId, modId = data.staff.modId;
      var socialId = data.social && data.social.managerId;
      window.Game.Data.staffCoaches.forEach(function (d) { if (d.id !== coachId && data.cash >= d.hire) n++; });
      window.Game.Data.staffMods.forEach(function (d) { if (d.id !== modId && data.cash >= d.hire) n++; });
      window.Game.Data.socialManagers.forEach(function (d) { if (d.id !== socialId && data.cash >= d.hire) n++; });
      return n;
    }
    var items = categoryItems(cat);
    var count = 0;
    items.forEach(function (def) { if (itemState(def, data).buyable) count++; });
    return count;
  }

  function categoryItems(cat) {
    // 'room' items (legacy roomTier leases) are retired — moving now happens
    // through the LOCATIONS screen's buy-a-move-in + packing minigame flow
    // (SPEC-V2 §7), so they're filtered out of every shop view.
    return window.Game.Data.shopItems.filter(function (d) {
      return d.category !== 'room' && d.category === cat;
    });
  }

  function sortItems(items, data) {
    var arr = items.slice();
    if (sortMode === 'price-asc') {
      arr.sort(function (a, b) { return a.price - b.price; });
    } else if (sortMode === 'price-desc') {
      arr.sort(function (a, b) { return b.price - a.price; });
    } else { // 'tier'
      arr.sort(function (a, b) {
        var d = (BAND_ORDER[a.band] || 0) - (BAND_ORDER[b.band] || 0);
        return d !== 0 ? d : a.price - b.price;
      });
    }
    return arr;
  }

  function renderAll() {
    var data = window.Game.State.data;
    renderCatStrip(data);
    els.affordToggle.classList.toggle('shop2-toggle--active', affordableOnly);
    els.sortSelect.value = sortMode;
    renderGrid(data);
  }

  function renderCatStrip(data) {
    var tiles = els.catstrip.children;
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var cat = tile.dataset.cat;
      tile.classList.toggle('shop2-cattile--active', cat === activeCategory);
      tile.style.setProperty('--cat-color', catColor(cat));
      var badge = tile.querySelector('[data-badge]');
      var count = affordableCount(cat, data);
      badge.textContent = count > 0 ? String(count) : '';
      badge.style.display = count > 0 ? '' : 'none';
    }
  }

  // Category owns a hue (ART-DIRECTION.md §5), reusing the existing resource
  // token palette so no new tokens are needed.
  function catColor(cat) {
    switch (cat) {
      case 'desk': case 'pc': case 'monitor': case 'chair': return 'var(--views)';
      case 'bed': return 'var(--subs)';
      case 'energy': case 'regen': case 'consumable': return 'var(--energy)';
      case 'decor': return 'var(--gold)';
      case 'staff': return 'var(--elo)';
      default: return 'var(--ink)';
    }
  }

  function renderGrid(data) {
    els.grid.innerHTML = '';
    els.grid.classList.toggle('shop2-grid--staff', activeCategory === 'staff');

    if (activeCategory === 'staff') {
      renderStaff(data);
      return;
    }

    var summary = buildCategorySummary(activeCategory, data);
    if (summary) els.grid.appendChild(summary);

    var items = sortItems(categoryItems(activeCategory), data);
    if (affordableOnly) {
      // Per SPEC-V15-BATCH-B §2: by DEFAULT unaffordable items stay visible
      // and dimmed, never hidden — that only changes once the player
      // explicitly opts into "AFFORDABLE ONLY". Owned/placed items are kept
      // regardless (there's nothing to afford, they're already yours).
      items = items.filter(function (def) {
        var st = itemState(def, data);
        return st.tag || st.buyable || st.atEnergyCap;
      });
    }

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'shop2-empty';
      empty.textContent = affordableOnly ? 'NOTHING AFFORDABLE HERE YET' : 'NOTHING HERE YET';
      els.grid.appendChild(empty);
      return;
    }

    items.forEach(function (def) {
      els.grid.appendChild(buildCard(def, data));
    });
  }

  // The category-specific status lines the old sticky headers used to carry
  // (max energy, fridge storage, regen cap, drink stockpile) — still shown,
  // once, above the grid rather than per-band.
  function buildCategorySummary(cat, data) {
    var wrap = document.createElement('div');
    wrap.className = 'shop2-summary';

    if (cat === 'energy') {
      var eStatus = window.Game.State.energyItemStatus();
      var fStatus = window.Game.State.fridgeStatus();
      wrap.innerHTML =
        '<div class="shop2-summary__row">MAX ENERGY ' + data.energyMax + ' / ' + window.Game.Data.energyMaxCap + '</div>' +
        '<div class="shop2-summary__row">PLACED ' + eStatus.total + ' / ' + eStatus.cap + (eStatus.atCap ? ' — CAP REACHED' : '') +
          '  ·  OWNED ' + eStatus.ownedTotal + ' (NO LIMIT)</div>' +
        '<div class="shop2-summary__row">' + (fStatus.hasFridge ? 'DRINK STORAGE ' + fStatus.stock + ' / ' + fStatus.capacity + ' CANS' : 'NO FRIDGE PLACED — ENERGY DRINKS ARE LOCKED') + '</div>' +
        '<div class="shop2-summary__note">Buy as many as you like — only 4 PLACED ever count toward max energy; extras stockpile. Fridges also unlock and size drink storage while placed.</div>';
      return wrap;
    }
    if (cat === 'regen') {
      var rStatus = window.Game.State.regenStatus();
      wrap.innerHTML =
        '<div class="shop2-summary__row">DAYTIME REGEN BONUS +' + rStatus.bonus.toFixed(2) + ' / +' + rStatus.cap.toFixed(2) + ' PER SEC</div>' +
        '<div class="shop2-summary__note">Placed props only, and only while the sun\'s up — night regen always drops back to base.</div>';
      return wrap;
    }
    if (cat === 'consumable') {
      var dStatus = window.Game.State.energyDrinkStatus();
      var fridgeForDrinks = window.Game.State.fridgeStatus();
      wrap.innerHTML =
        '<div class="shop2-summary__row">STOCKPILE ' + dStatus.owned + '  ·  ' + dStatus.drinksLeftToday + ' / ' + (window.Game.Data.energyDrink ? window.Game.Data.energyDrink.maxPerDay : 4) + ' DRINKS LEFT TODAY</div>' +
        '<div class="shop2-summary__row">' + (fridgeForDrinks.hasFridge ? 'FRIDGE STORAGE ' + fridgeForDrinks.stock + ' / ' + fridgeForDrinks.capacity + ' (' + fridgeForDrinks.remaining + ' LEFT TO BUY)' : 'NO FRIDGE PLACED — PLACE ONE IN ENERGY TO UNLOCK') + '</div>' +
        '<div class="shop2-summary__note">Buy to stockpile, drink whenever from the energy button — not a room prop.</div>';
      return wrap;
    }
    return null;
  }

  function buildCard(def, data) {
    var st = itemState(def, data);
    var card = document.createElement('div');
    card.className = 'shop2-card panel';
    if (!st.tag && !st.buyable) card.classList.add('shop2-card--dim');
    if (st.tag === 'PLACED') card.classList.add('shop2-card--placed');
    if (st.tag === 'OWNED') card.classList.add('shop2-card--owned');

    var band = document.createElement('div');
    band.className = 'shop2-card__band shop2-card__band--' + def.band;
    band.textContent = BAND_LABEL[def.band] || def.band;
    card.appendChild(band);

    var iconWrap = document.createElement('div');
    iconWrap.className = 'shop2-card__icon-wrap';
    var canvas = document.createElement('canvas');
    canvas.width = 56; canvas.height = 56;
    canvas.className = 'shop2-card__icon';
    iconWrap.appendChild(canvas);
    card.appendChild(iconWrap);
    requestAnimationFrame(function () {
      window.Game.Iso.renderPropIcon(canvas, def.id);
    });

    var name = document.createElement('div');
    name.className = 'shop2-card__name';
    name.textContent = def.name;
    card.appendChild(name);

    var stats = document.createElement('div');
    stats.className = 'shop2-card__stats';
    Object.keys(def.stats || {}).forEach(function (k) {
      var chip = document.createElement('span');
      chip.className = 'stat-chip';
      chip.style.color = STAT_COLOR[k] || 'var(--ink)';
      chip.textContent = (STAT_LABEL[k] || k) + ' +' + def.stats[k];
      stats.appendChild(chip);
    });
    if (def.category === 'bed' && def.sleepRate != null) {
      appendChip(stats, 'SLEEP ' + def.sleepRate.toFixed(1) + '/S', 'var(--energy)');
    }
    if (def.category === 'energy' && def.energyAdd != null) {
      appendChip(stats, '+' + def.energyAdd + ' MAX (PLACED)', 'var(--energy)');
    }
    if (def.category === 'regen' && def.regenAdd != null) {
      appendChip(stats, '+' + def.regenAdd.toFixed(2) + ' E/S (DAY)', 'var(--energy)');
    }
    if (def.category === 'consumable' && def.restoreEnergy != null) {
      appendChip(stats, '+' + def.restoreEnergy + ' ON DRINK', 'var(--energy)');
    }
    // SPEC-V20 §1/§3 — windows and blinds both ship `stats: {}`, so without
    // these two the cards render a visibly empty stat row while every other
    // card in the grid has one, and nothing on screen tells the player that
    // a wide window eats two wall tiles or that a blind is what actually
    // pays out. The blind figure is DERIVED from Data.blindsSleepBonusPct
    // (the same constant State.effectiveSleepRate() multiplies by) rather
    // than typed as "+15%", so it can't drift from the rule it describes.
    if (def.category === 'window') {
      var panes = (def.footprint && def.footprint.w) || 1;
      appendChip(stats, panes + ' WALL TILE' + (panes === 1 ? '' : 'S'), 'var(--ink-dim)');
    }
    if (def.category === 'blind') {
      appendChip(stats, '+' + Math.round((window.Game.Data.blindsSleepBonusPct || 0) * 100) +
        '% SLEEP (CLOSED, ALL WINDOWS)', 'var(--energy)');
    }
    card.appendChild(stats);

    var footer = document.createElement('div');
    footer.className = 'shop2-card__footer';
    var price = document.createElement('div');
    price.className = 'shop2-card__price';
    price.textContent = window.Game.UI.money(def.price);
    footer.appendChild(price);

    if (st.tag) {
      var tagEl = document.createElement('div');
      tagEl.className = 'shop2-card__tag shop2-card__tag--' + st.tag.toLowerCase();
      tagEl.innerHTML = ICON_CHECK + '<span>' + st.tag + (!st.singleton && st.ownedQty > 1 ? ' ×' + st.ownedQty : '') + '</span>';
      footer.appendChild(tagEl);
    } else if (!st.affordable) {
      var cantEl = document.createElement('div');
      cantEl.className = 'shop2-card__tag shop2-card__tag--locked';
      cantEl.innerHTML = ICON_LOCK + "<span>CAN'T AFFORD</span>";
      footer.appendChild(cantEl);
    }
    card.appendChild(footer);

    if (st.atEnergyCap) {
      var capTag = document.createElement('div');
      capTag.className = 'shop2-card__cap';
      capTag.textContent = 'CAP REACHED — GOES TO STOCKPILE';
      card.appendChild(capTag);
    }

    if (!st.placed) {
      var buyBtn = document.createElement('button');
      buyBtn.className = 'btn btn--primary shop2-card__buybtn';
      buyBtn.textContent = st.fridgeLocked
        ? (st.fridgeGate.reason === 'no-fridge' ? 'NEEDS A FRIDGE' : 'FRIDGE FULL')
        : (!st.affordable ? "CAN'T AFFORD" : 'BUY');
      window.Game.UI.setDisabled(buyBtn, !st.buyable);
      buyBtn.addEventListener('click', function () {
        if (st.fridgeLocked) {
          window.Game.UI.beep('miss');
          window.Game.UI.toast(st.fridgeGate.reason === 'no-fridge' ? 'PLACE A FRIDGE FIRST' : 'FRIDGE IS FULL', 'bad');
          return;
        }
        if (!st.affordable) {
          window.Game.UI.beep('miss');
          window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
          return;
        }
        onBuyClick(def, card);
      });
      card.appendChild(buyBtn);

      if (st.fridgeLocked) {
        var fridgeHint = document.createElement('div');
        fridgeHint.className = 'shop2-card__hint';
        fridgeHint.textContent = st.fridgeGate.reason === 'no-fridge'
          ? 'PLACE A FRIDGE (ENERGY) TO UNLOCK'
          : 'STORAGE FULL — ' + st.fridgeGate.stock + ' / ' + st.fridgeGate.capacity;
        card.appendChild(fridgeHint);
      } else if (def.requiresFridge && st.fridgeGate) {
        var storageHint = document.createElement('div');
        storageHint.className = 'shop2-card__hint';
        storageHint.textContent = st.fridgeGate.remaining + ' SLOT' + (st.fridgeGate.remaining === 1 ? '' : 'S') + ' LEFT IN FRIDGE';
        card.appendChild(storageHint);
      }
    }

    return card;
  }

  function appendChip(host, text, color) {
    var chip = document.createElement('span');
    chip.className = 'stat-chip';
    chip.style.color = color;
    chip.textContent = text;
    host.appendChild(chip);
  }

  function onBuyClick(def, cardEl) {
    var data = window.Game.State.data;
    if (data.cash < def.price) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
      return;
    }

    // SPEC-V6 §16: ownership is unlimited — only PLACEMENT is capped at 4.
    // Only worth a confirm once that placed cap is already reached, so the
    // player knows this purchase adds to the stockpile, not to max energy.
    if (def.category === 'energy') {
      var status = window.Game.State.energyItemStatus();
      if (status.atCap) {
        window.Game.UI.confirmModal({
          title: 'ALREADY AT PLACED CAP',
          text: 'You already have ' + status.cap + ' energy items placed — the max that can count toward max energy at once. This purchase adds to your stockpile; it won\'t raise max energy until you swap it in for one that\'s currently placed.',
          color: 'var(--energy)',
          lines: [
            { label: 'PLACED NOW', value: status.total + ' / ' + status.cap },
            { label: 'OWNED NOW', value: status.ownedTotal + ' (NO LIMIT)' }
          ],
          yesText: 'BUY ANYWAY',
          noText: 'CANCEL',
          onYes: function () { proceedToPriceGate(def, cardEl); }
        });
        return;
      }
    }
    proceedToPriceGate(def, cardEl);
  }

  function proceedToPriceGate(def, cardEl) {
    if (def.price >= 1000) {
      window.Game.UI.confirmModal({
        title: 'BUY ' + def.name + '?',
        text: def.desc,
        color: 'var(--cash)',
        lines: [{ label: 'PRICE', value: window.Game.UI.money(def.price), color: 'var(--cash)' }],
        yesText: 'BUY',
        noText: 'CANCEL',
        onYes: function () { doBuy(def, cardEl); }
      });
    } else {
      doBuy(def, cardEl);
    }
  }

  function doBuy(def, cardEl) {
    // §16: buyItem() no longer fails on the energy cap — ownership is
    // unlimited, so a failure here is always a cash problem.
    var ok = window.Game.State.buyItem(def.id);
    if (!ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
      return;
    }
    window.Game.UI.beep('cash');
    window.Game.UI.confetti(cardEl, 'var(--cash)');
    window.Game.UI.toast(def.name + ' PURCHASED', 'good');
    renderAll();
  }

  /* ---- STAFF (SPEC-V2 §5) ---------------------------------------------------
     Coaches auto-set daily form; moderators auto-ban a share of toxic chat.
     One of each at a time — hiring a different one replaces the current hire
     outright (no refund), via State.hireCoach/hireMod (Package A API). ---- */
  function renderStaff(data) {
    var coachHeader = document.createElement('div');
    coachHeader.className = 'shop2-band-header';
    coachHeader.textContent = 'COACHES — AUTOMATE TRAINING';
    els.grid.appendChild(coachHeader);
    window.Game.Data.staffCoaches.forEach(function (def) {
      els.grid.appendChild(buildStaffCard('coach', def, data));
    });

    var modHeader = document.createElement('div');
    modHeader.className = 'shop2-band-header';
    modHeader.textContent = 'MODERATORS — AUTOMATE CHAT BANS';
    els.grid.appendChild(modHeader);
    window.Game.Data.staffMods.forEach(function (def) {
      els.grid.appendChild(buildStaffCard('mod', def, data));
    });

    // SPEC-V9 Package B1/B2 — social managers: same one-at-a-time hire/fire
    // contract as coaches/mods (State.hireSocialManager/fireSocialManager),
    // but the auto-posts they buy cost the player NO energy — that's the
    // entire point of the upkeep, so it gets its own explicit chip below
    // rather than being folded into the generic effect line.
    var socialHeader = document.createElement('div');
    socialHeader.className = 'shop2-band-header';
    socialHeader.textContent = 'SOCIAL MANAGERS — AUTOMATE POSTING';
    els.grid.appendChild(socialHeader);
    window.Game.Data.socialManagers.forEach(function (def) {
      els.grid.appendChild(buildSocialManagerCard(def, data));
    });
  }

  function buildSocialManagerCard(def, data) {
    var currentId = data.social && data.social.managerId;
    var isHired = currentId === def.id;

    var card = document.createElement('div');
    card.className = 'staff-card panel' + (isHired ? ' staff-card--hired' : '');

    var info = document.createElement('div');
    info.className = 'staff-card__info';
    var name = document.createElement('div');
    name.className = 'staff-card__name';
    name.textContent = def.name;
    info.appendChild(name);

    var effect = document.createElement('div');
    effect.className = 'staff-card__effect';
    // postsPerDay, not postsPerWeek: SPEC-V15 §5 replaced the probabilistic
    // weekly model with a guaranteed per-day rate and DELETED the old field,
    // but the three display sites kept reading it — so every manager card in
    // the game advertised "AUTO-POSTS undefined/WK". The unit changed with the
    // field, so the label says /DAY too rather than quietly showing a daily
    // number under a weekly heading.
    effect.textContent = 'AUTO-POSTS ' + def.postsPerDay + '/DAY TO CLIPS AT ' + Math.round(def.quality * 100) +
      '% QUALITY — COSTS YOU ZERO ENERGY';
    info.appendChild(effect);

    var costRow = document.createElement('div');
    costRow.className = 'staff-card__costs';
    appendChip(costRow, 'HIRE ' + window.Game.UI.money(def.hire), 'var(--cash)');
    appendChip(costRow, 'UPKEEP ' + window.Game.UI.money(def.upkeep) + '/DAY', 'var(--danger)');
    appendChip(costRow, '0 ENERGY COST', 'var(--energy)');
    info.appendChild(costRow);
    card.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'staff-card__actions';

    if (isHired) {
      var badge = document.createElement('div');
      badge.className = 'shop-card__owned';
      badge.textContent = 'HIRED';
      actions.appendChild(badge);

      var fireBtn = document.createElement('button');
      fireBtn.className = 'btn staff-card__firebtn';
      fireBtn.textContent = 'FIRE';
      fireBtn.addEventListener('click', function () {
        var ok = window.Game.State.fireSocialManager();
        if (ok) {
          window.Game.UI.beep('click');
          window.Game.UI.toast(def.name + ' LET GO', 'info');
          renderAll();
        }
      });
      actions.appendChild(fireBtn);
    } else {
      var hireBtn = document.createElement('button');
      hireBtn.className = 'btn btn--primary staff-card__hirebtn';
      hireBtn.textContent = currentId ? 'REPLACE' : 'HIRE';
      window.Game.UI.setDisabled(hireBtn, data.cash < def.hire);
      hireBtn.addEventListener('click', function () { onHireSocialManagerClick(def, card); });
      actions.appendChild(hireBtn);
    }
    card.appendChild(actions);
    return card;
  }

  function onHireSocialManagerClick(def, cardEl) {
    var data = window.Game.State.data;
    if (data.cash < def.hire) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
      return;
    }
    var currentId = data.social && data.social.managerId;
    window.Game.UI.confirmModal({
      title: (currentId ? 'REPLACE WITH ' : 'HIRE ') + def.name + '?',
      text: 'Auto-posts to CLIPS on your behalf every week, no energy spent — the exact same follower-drip and virality odds as a post you make yourself.',
      color: 'var(--cash)',
      lines: [
        { label: 'HIRE COST', value: window.Game.UI.money(def.hire), color: 'var(--cash)' },
        { label: 'UPKEEP', value: window.Game.UI.money(def.upkeep) + '/day', color: 'var(--danger)' },
        { label: 'AUTO-POSTS', value: def.postsPerDay + '/day to CLIPS' }
      ],
      yesText: currentId ? 'REPLACE' : 'HIRE',
      noText: 'NOT YET',
      onYes: function () {
        var res = window.Game.State.hireSocialManager(def.id);
        if (res.ok) {
          window.Game.UI.beep('cash');
          window.Game.UI.confetti(cardEl, 'var(--cash)');
          window.Game.UI.toast(def.name + ' HIRED', 'good');
          renderAll();
        } else {
          window.Game.UI.beep('miss');
          window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
        }
      }
    });
  }

  function buildStaffCard(role, def, data) {
    var currentId = role === 'coach' ? data.staff.coachId : data.staff.modId;
    var isHired = currentId === def.id;

    var card = document.createElement('div');
    card.className = 'staff-card panel' + (isHired ? ' staff-card--hired' : '');

    var info = document.createElement('div');
    info.className = 'staff-card__info';
    var name = document.createElement('div');
    name.className = 'staff-card__name';
    name.textContent = def.name;
    info.appendChild(name);

    var effect = document.createElement('div');
    effect.className = 'staff-card__effect';
    effect.textContent = role === 'coach'
      ? 'AUTO-FORM EVERY DAY: ' + def.formLabel
      : 'AUTO-BANS ' + Math.round(def.autoBanPct * 100) + '% OF TOXIC CHAT (half hype)';
    info.appendChild(effect);

    var costRow = document.createElement('div');
    costRow.className = 'staff-card__costs';
    appendChip(costRow, 'HIRE ' + window.Game.UI.money(def.hire), 'var(--cash)');
    appendChip(costRow, 'UPKEEP ' + window.Game.UI.money(def.upkeep) + '/DAY', 'var(--danger)');
    info.appendChild(costRow);
    card.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'staff-card__actions';

    if (isHired) {
      var badge = document.createElement('div');
      badge.className = 'shop-card__owned';
      badge.textContent = 'HIRED';
      actions.appendChild(badge);

      var fireBtn = document.createElement('button');
      fireBtn.className = 'btn staff-card__firebtn';
      fireBtn.textContent = 'FIRE';
      fireBtn.addEventListener('click', function () {
        var ok = role === 'coach' ? window.Game.State.fireCoach() : window.Game.State.fireMod();
        if (ok) {
          window.Game.UI.beep('click');
          window.Game.UI.toast(def.name + ' LET GO', 'info');
          renderAll();
        }
      });
      actions.appendChild(fireBtn);
    } else {
      var hireBtn = document.createElement('button');
      hireBtn.className = 'btn btn--primary staff-card__hirebtn';
      hireBtn.textContent = currentId ? 'REPLACE' : 'HIRE';
      window.Game.UI.setDisabled(hireBtn, data.cash < def.hire);
      hireBtn.addEventListener('click', function () { onHireStaffClick(role, def, card); });
      actions.appendChild(hireBtn);
    }
    card.appendChild(actions);
    return card;
  }

  function onHireStaffClick(role, def, cardEl) {
    var data = window.Game.State.data;
    if (data.cash < def.hire) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
      return;
    }
    var currentId = role === 'coach' ? data.staff.coachId : data.staff.modId;
    window.Game.UI.confirmModal({
      title: (currentId ? 'REPLACE WITH ' : 'HIRE ') + def.name + '?',
      text: role === 'coach'
        ? 'Sets your daily form automatically. Training manually still helps — whichever multiplier is better applies.'
        : 'Auto-bans a share of toxic chat before you ever see it during a stream.',
      color: 'var(--cash)',
      lines: [
        { label: 'HIRE COST', value: window.Game.UI.money(def.hire), color: 'var(--cash)' },
        { label: 'UPKEEP', value: window.Game.UI.money(def.upkeep) + '/day', color: 'var(--danger)' }
      ],
      yesText: currentId ? 'REPLACE' : 'HIRE',
      noText: 'NOT YET',
      onYes: function () {
        var res = role === 'coach' ? window.Game.State.hireCoach(def.id) : window.Game.State.hireMod(def.id);
        if (res.ok) {
          window.Game.UI.beep('cash');
          window.Game.UI.confetti(cardEl, 'var(--cash)');
          window.Game.UI.toast(def.name + ' HIRED', 'good');
          renderAll();
        } else {
          window.Game.UI.beep('miss');
          window.Game.UI.toast('NOT ENOUGH CASH', 'bad');
        }
      }
    });
  }

  window.Game = window.Game || {};
  window.Game.Router = window.Game.Router || {};
  window.Game.Router.register('shop', {
    onEnter: function () {
      if (!built) buildDom();
      renderAll();
    },
    onExit: function () {}
  });

  window.Game.Shop = {};
})();
