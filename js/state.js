/* ==========================================================================
   CS2 PRO SIMULATOR — js/state.js
   Save data, mutations, and the economy. Sole owner of localStorage.
   ========================================================================== */
(function () {
  'use strict';

  var SAVE_KEY = 'cs2sim.v1';        // legacy V1 flat save — kept, never deleted (migration source)
  var SAVES_KEY = 'cs2sim.saves';    // V2 3-slot save model (SPEC-V2 §4)
  var SLOT_COUNT = 3;
  var listeners = { change: [] };
  var savesRootCache = null;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function genId() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function Data() { return window.Game.Data; }

  function findShopItem(id) {
    var items = Data().shopItems;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function staffCoachDef(id) {
    if (!id) return null;
    var arr = Data().staffCoaches || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function staffModDef(id) {
    if (!id) return null;
    var arr = Data().staffMods || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /* ---- social media lookups (SPEC-V9 §1/§4) --------------------------------- */
  function socialPlatformDef(id) {
    if (!id) return null;
    var arr = Data().socialPlatforms || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function socialManagerDef(id) {
    if (!id) return null;
    var arr = Data().socialManagers || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  // defaultSocial(): builds a fresh d.social from Data().socialPlatforms so a
  // future platform added to the catalog needs no save-shape change here —
  // both defaultData() and normalizeSave()'s merge (below) call this.
  function defaultSocial() {
    var social = { followers: {}, unlocked: {}, postsThisWeek: {}, managerId: null, drips: [] };
    var plats = Data().socialPlatforms || [];
    for (var i = 0; i < plats.length; i++) {
      var p = plats[i];
      social.followers[p.id] = 0;
      social.unlocked[p.id] = p.unlockFollowers <= 0; // CLIPS (unlockFollowers 0) starts unlocked
      social.postsThisWeek[p.id] = 0;
    }
    return social;
  }

  // ensureSocial(d): defensive lazy-fill for any platform present in the
  // CURRENT catalog but missing from an older save's d.social (mirrors the
  // project's "extend the catalog, patch old saves at read time" pattern
  // used elsewhere, e.g. ensureDefaultBed). Cheap no-op once a save is
  // current. Called at the top of every public social-media entry point.
  function ensureSocial(d) {
    if (!d.social) { d.social = defaultSocial(); return; }
    if (!d.social.followers) d.social.followers = {};
    if (!d.social.unlocked) d.social.unlocked = {};
    if (!d.social.postsThisWeek) d.social.postsThisWeek = {};
    if (!Array.isArray(d.social.drips)) d.social.drips = [];
    if (d.social.managerId === undefined) d.social.managerId = null;
    var plats = Data().socialPlatforms || [];
    for (var i = 0; i < plats.length; i++) {
      var p = plats[i];
      if (d.social.followers[p.id] === undefined) d.social.followers[p.id] = 0;
      if (d.social.unlocked[p.id] === undefined) d.social.unlocked[p.id] = p.unlockFollowers <= 0;
      if (d.social.postsThisWeek[p.id] === undefined) d.social.postsThisWeek[p.id] = 0;
    }
  }

  /* ---- crypto market (SPEC-V10) ---------------------------------------------
     defaultCrypto(): builds a fresh d.crypto from Data().cryptoCoins, same
     "build from the catalog" pattern as defaultSocial() above — a future
     coin added to the catalog needs no save-shape change here. Prices seed
     at each coin's startPrice; history seeds with that single point. */
  function defaultCrypto() {
    var c = {
      prices: {}, history: {}, holdings: {},
      news: [],            // active (unresolved) news events
      newsHistory: [],      // capped log of resolved events — {coinId, telegraphDir, actualDir, correct, fakeout, resolvedAt}
      tickCount: 0,         // total price ticks processed, ever — drives news pacing + elapsed-tick bookkeeping
      lastTickAt: 0,         // epoch ms of the last processed tick (0 = not yet anchored) — MUST stay 0 here
                             // (never Date.now()) so State.tickCrypto()'s "not yet anchored" branch still
                             // anchors fresh to "now" on first call, per the SPEC-V10 no-offline-accrual rule.
      nextNewsAtTick: 0,    // tickCount at/after which another news event may spawn
      lastSeenNewsTick: 0    // SPEC-V13 §8A: tickCount as of the last time the player viewed crypto news — drives the career-nav badge dot
    };
    var coins = Data().cryptoCoins || [];
    for (var i = 0; i < coins.length; i++) {
      var coin = coins[i];
      c.prices[coin.id] = coin.startPrice;
      c.history[coin.id] = [coin.startPrice];
      c.holdings[coin.id] = { qty: 0, costBasis: 0, realizedPnl: 0 };
    }
    // SPEC-V15 §3/§18 fix: a brand-new save used to show a completely flat
    // market (never ticked) — dead-looking prices, an empty sparkline, and
    // an empty TRACK RECORD strip. Pre-seed the market as if it had been
    // alive before the player arrived by running the REAL price-walk
    // (cryptoStep, defined below — hoisted, same function the live market
    // uses every tick) forward ~200 ticks against a throwaway `{ crypto: c }`
    // wrapper, BEFORE `c` is ever attached to real save data. This keeps
    // prices, the full history buffer, and any news events cryptoStep
    // naturally spawns/resolves along the way — never a fabricated series,
    // so the sparkline is honest. lastTickAt is deliberately left at 0
    // (untouched) afterward — see the comment on it above; SPEC-V15 §3 is
    // explicit that ticks must NOT accrue while offline, and this pre-seed
    // is a one-time construction step, not a backlog.
    var seedWrap = { crypto: c };
    var PRESEED_TICKS = 200;
    for (var t = 0; t < PRESEED_TICKS; t++) cryptoStep(seedWrap);
    // Safety net: news spawn/resolve timing is randomized, so on a rare
    // unlucky roll fewer than 2 headlines may have resolved in 200 ticks.
    // Keep walking (same real function, still pre-launch) until the TRACK
    // RECORD strip has at least a couple of entries, capped well short of
    // anything that could look like a real-time backlog.
    var EXTRA_CAP = 800;
    while (c.newsHistory.length < 2 && c.tickCount < EXTRA_CAP) cryptoStep(seedWrap);
    return c;
  }

  // ensureCrypto(d): defensive lazy-fill for any coin present in the CURRENT
  // catalog but missing from an older save's d.crypto (mirrors ensureSocial).
  // Cheap no-op once a save is current. Called at the top of every public
  // crypto entry point.
  function ensureCrypto(d) {
    if (!d.crypto) { d.crypto = defaultCrypto(); return; }
    var c = d.crypto;
    if (!c.prices) c.prices = {};
    if (!c.history) c.history = {};
    if (!c.holdings) c.holdings = {};
    if (!Array.isArray(c.news)) c.news = [];
    if (!Array.isArray(c.newsHistory)) c.newsHistory = [];
    if (typeof c.tickCount !== 'number') c.tickCount = 0;
    if (typeof c.lastTickAt !== 'number') c.lastTickAt = 0;
    if (typeof c.nextNewsAtTick !== 'number') c.nextNewsAtTick = 0;
    if (typeof c.lastSeenNewsTick !== 'number') c.lastSeenNewsTick = 0;
    var coins = Data().cryptoCoins || [];
    for (var i = 0; i < coins.length; i++) {
      var coin = coins[i];
      if (typeof c.prices[coin.id] !== 'number') c.prices[coin.id] = coin.startPrice;
      if (!Array.isArray(c.history[coin.id])) c.history[coin.id] = [c.prices[coin.id]];
      if (!c.holdings[coin.id]) c.holdings[coin.id] = { qty: 0, costBasis: 0, realizedPnl: 0 };
    }
  }

  function cryptoCoinDef(id) {
    var arr = Data().cryptoCoins || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function cryptoCfg() { return Data().crypto; }

  function locationDef(id) {
    var arr = Data().locations || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return arr[0] || null;
  }

  /* ---- beds (SPEC-V3 §3) ---------------------------------------------------
     The "current" bed is whichever bed-category item is actually placed in
     the room (singleton, like desk/pc/chair) — not just owned, since old
     beds stay in `owned` after an upgrade (autoPlaceSingleton only swaps
     `placed`). Falls back to bed_mattress (always owned) if somehow nothing
     bed-shaped is placed (e.g. mid-move, when `placed` is empty). --------- */
  var BED_IDS = ['bed_mattress', 'bed_single', 'bed_memoryfoam', 'bed_kingsize', 'bed_cryopod'];
  function currentBedDef() {
    var placed = (State.data && State.data.placed) || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.category === 'bed') return def;
    }
    return findShopItem('bed_mattress') || { sleepRate: 2.5 };
  }

  /* ---- fridges (SPEC-V11 §2, UNDOES SPEC-V7 §3) -----------------------------
     There is only ever ONE set of fridges: the `energy` category's
     energy_minifridge/energy_fridge (the standalone `fridge` category is
     deleted). Energy drinks (energy_can, a stockpiled consumable —
     SPEC-V6 §3) are locked entirely until at least one storage-providing
     fridge is PLACED, and the stockpile is capped at the SUM of
     `drinkCapacity` across every PLACED energy-category item — same
     "sum while placed" pattern recomputeEnergyMax() already uses for
     energyAdd, and subject to the same 4-placed energy-item cap
     (SPEC-V6 §16, State.placeItem()). Two placed mini-fridges (drinkCapacity
     4 each) sum to 8. Non-fridge energy items (IV drip) have no
     drinkCapacity field, which reads as 0 and contributes nothing. ------- */
  function currentFridgeCapacity(d) {
    var total = 0;
    var placed = d.placed || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.category === 'energy' && def.drinkCapacity) total += def.drinkCapacity;
    }
    return total;
  }

  // migrateLegacyFridges (SPEC-V11 §2): a save from before this fix may own
  // the now-deleted `fridge` category's fridge_mini/fridge_full. It must not
  // break, and shouldn't lose what it paid for:
  //   1. Ownership converts 1:1 onto the equivalent energy-category fridge
  //      (fridge_mini -> energy_minifridge, fridge_full -> energy_fridge),
  //      so the item still exists in the player's inventory. The legacy
  //      keys are deleted from `owned` afterward.
  //   2. Legacy fridges granted storage just by being OWNED (never placed —
  //      they were never room props). New fridges only grant storage while
  //      PLACED, so to avoid silently re-locking energy drinks out from
  //      under a save that had them unlocked, this also auto-places the
  //      better of the two converted fridges (fridge_full's energy_fridge
  //      wins over fridge_mini's energy_minifridge — mirrors the old "only
  //      the best owned fridge counts" rule) onto the first free tile,
  //      PROVIDED that doing so doesn't breach the 4-placed energy-item cap
  //      (SPEC-V6 §16) and a free tile actually exists. If either check
  //      fails, the item is left owned-but-unplaced — exactly the state a
  //      freshly-bought energy item is in when the room/slots are full — and
  //      the player can place it manually like any other energy item.
  // Must run BEFORE recomputeEnergyMax() so a newly-auto-placed fridge's
  // energyAdd is picked up immediately, and it takes `d` (not State.data —
  // this runs inside normalizeSave(), before State.data is assigned). -----
  function migrateLegacyFridges(d) {
    var owned = d.owned || {};
    var miniQty = owned.fridge_mini || 0;
    var fullQty = owned.fridge_full || 0;
    if (miniQty <= 0 && fullQty <= 0) return;

    if (miniQty > 0) {
      owned.energy_minifridge = (owned.energy_minifridge || 0) + miniQty;
      delete owned.fridge_mini;
    }
    if (fullQty > 0) {
      owned.energy_fridge = (owned.energy_fridge || 0) + fullQty;
      delete owned.fridge_full;
    }

    var placed = d.placed || [];
    var cap = Data().energyItemCap || 4;
    var placedEnergyQty = 0;
    for (var i = 0; i < placed.length; i++) {
      var pdef = findShopItem(placed[i].id);
      if (pdef && pdef.category === 'energy') placedEnergyQty++;
    }
    if (placedEnergyQty >= cap) return; // already at the placed-energy-item cap

    var bestId = fullQty > 0 ? 'energy_fridge' : 'energy_minifridge';
    var loc = locationDef(d.locationId) || { gridW: 6, gridD: 6 };
    var gridW = loc.gridW, gridD = loc.gridD;
    for (var y = 0; y < gridD; y++) {
      for (var x = 0; x < gridW; x++) {
        var occupied = false;
        for (var j = 0; j < placed.length; j++) {
          if (placed[j].x === x && placed[j].y === y) { occupied = true; break; }
        }
        if (!occupied) {
          placed.push({ id: bestId, x: x, y: y, rot: 0 });
          return;
        }
      }
    }
    // no free tile — leave owned-but-unplaced.
  }

  /* ---- minimum viable room (SPEC-V5 §5r) ------------------------------------
     Bed + desk + chair + PC + monitor. Checked against `placed` (physically
     in the room), not just `owned` — the room, not the inventory, is what
     must be complete. While incomplete, PLAY/TRAIN/STREAM/CASES/CAREER
     (including signing) are blocked below; SHOP, room editing and sleeping
     stay allowed so an incomplete room is always recoverable. */
  var MIN_ROOM_CATEGORIES = ['bed', 'desk', 'chair', 'pc', 'monitor'];
  function roomCompletenessFor(d) {
    var placedCats = {};
    var placed = (d && d.placed) || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def) placedCats[def.category] = true;
    }
    var missing = MIN_ROOM_CATEGORIES.filter(function (c) { return !placedCats[c]; });
    return { complete: missing.length === 0, missing: missing };
  }

  // migrateBedArtAnchor (footprint/art alignment fix): props.bed in iso.js
  // used to draw the bed's art starting one tile BEFORE its stored anchor
  // (var ox = gx - 1.0), while this file's footprintTiles() always anchored
  // it forward (x, x+1) — a full-tile mismatch between what the green
  // placement highlight showed and where the bed actually rendered. iso.js
  // now draws forward from the anchor too, so the fix is purely visual —
  // this file's occupancy/footprint model never had the bug and does not
  // change here. But an EXISTING save's stored x/y was chosen by a player
  // looking at the OLD (shifted) art, so leaving it untouched would make
  // every already-placed bed visibly jump one tile toward +x (rot 0) or +y
  // (rot 1) the instant this update loads — rot 2/180 and rot 3/270 already
  // coincided with the corrected art (verified against iso.js's rotateRect
  // transform) and need no shift. Must run BEFORE ensureDefaultBed() below,
  // over the save's own placed array, so a bed injected fresh by
  // ensureDefaultBed (already using the new convention) is never shifted.
  // Runs once per save, gated by bedArtAnchorFixed (see normalizeSave) —
  // then defers to migrateBedFootprints() for any overlap the shift causes,
  // rather than resolving overlaps a second time here.
  function migrateBedArtAnchor(d) {
    var placed = d.placed || [];
    for (var i = 0; i < placed.length; i++) {
      var entry = placed[i];
      var def = findShopItem(entry.id);
      if (!def || def.category !== 'bed') continue;
      var rot = entry.rot || 0;
      if (rot === 0 && entry.x > 0) entry.x -= 1;
      else if (rot === 1 && entry.y > 0) entry.y -= 1;
    }
  }

  function ensureDefaultBed(d) {
    var hasBed = BED_IDS.some(function (id) { return (d.owned[id] || 0) > 0; });
    if (!hasBed) {
      d.owned.bed_mattress = 1;
      var hasPlacedBed = d.placed.some(function (p) { return BED_IDS.indexOf(p.id) !== -1; });
      if (!hasPlacedBed) {
        // SPEC-V12 §2: bed_mattress now has a 2x1 footprint — anchor one
        // tile short of the true corner (gridW-2, not gridW-1) so its far
        // edge, not its near edge, touches the reserved corner tile, same
        // as Data.defaultPlaced (see that comment for why gridW-1 would put
        // the second tile out of bounds).
        var loc = locationDef(d.locationId) || { gridW: 6, gridD: 6 };
        d.placed.push({ id: 'bed_mattress', x: Math.max(0, loc.gridW - 2), y: loc.gridD - 1, rot: 0 });
      }
    }
  }

  // migrateBedFootprints (SPEC-V12 §5, generalized by SPEC-V15 §9): a save
  // from before a footprint change stored the affected item as a single 1x1
  // tile, so its now-real MULTI-tile footprint may overlap whatever else was
  // saved sitting there. Originally bed-only (SPEC-V12 §5); SPEC-V15 §9 gives
  // `regen_hyperbaric` (RECOVERY POD) a 2x1 footprint too, so this now scans
  // ANY placed item whose def declares a footprint bigger than 1x1, not just
  // beds — one migration path, no second copy of the same reconciliation
  // logic for the pod. Resolve without ever deleting an owned item:
  //   1. Try relocating the BED itself (same rotation) to the closest
  //      in-bounds anchor whose full footprint is completely free.
  //   2. If no such spot exists, try relocating the specific prop(s) it
  //      conflicts with instead, so the bed can stay where it was saved.
  //   3. If the room is genuinely full and neither can move, drop the
  //      conflicting prop from `placed` only — it stays in `owned` (never
  //      deleted) and can be re-placed by hand once there's room.
  // A save already footprint-clean (nothing V12-aware ever wrote a bed too
  // close to another prop) is a no-op — the conflict scan below finds
  // nothing to fix. Must run AFTER ensureDefaultBed (every save is
  // guaranteed a placed bed by then) and works on the raw `d` being
  // normalized, not State.data (which doesn't exist yet here).
  function migrateBedFootprints(d) {
    var loc = locationDef(d.locationId) || { gridW: 6, gridD: 6 };
    var gridW = loc.gridW, gridD = loc.gridD;
    var placed = d.placed || [];

    function tilesFor(entry) {
      var def = findShopItem(entry.id);
      if (!def) return [];
      return footprintTiles(def, entry.x, entry.y, entry.rot || 0);
    }
    function inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < gridW && t.y < gridD; }
    function freeFor(skipIdx, tiles) {
      var i, j, k;
      for (i = 0; i < tiles.length; i++) if (!inBounds(tiles[i])) return false;
      for (i = 0; i < placed.length; i++) {
        if (i === skipIdx) continue;
        var otherTiles = tilesFor(placed[i]);
        for (j = 0; j < tiles.length; j++) {
          for (k = 0; k < otherTiles.length; k++) {
            if (tiles[j].x === otherTiles[k].x && tiles[j].y === otherTiles[k].y) return false;
          }
        }
      }
      return true;
    }
    // all grid cells, nearest-to-original-position first, reused as the
    // candidate search order for both the bed and any bumped conflict prop.
    function candidatesNear(ox, oy) {
      var list = [];
      for (var y = 0; y < gridD; y++) for (var x = 0; x < gridW; x++) list.push({ x: x, y: y });
      list.sort(function (a, b) {
        var da = Math.abs(a.x - ox) + Math.abs(a.y - oy);
        var db = Math.abs(b.x - ox) + Math.abs(b.y - oy);
        return da - db;
      });
      return list;
    }

    for (var i = 0; i < placed.length; i++) {
      var entry = placed[i];
      var def = findShopItem(entry.id);
      if (!def || !def.footprint || (def.footprint.w || 1) * (def.footprint.d || 1) <= 1) continue;
      // SPEC-V20 §1 — WALL MOUNTS ARE NOT THIS MIGRATION'S BUSINESS.
      // Until wide windows existed, "footprint area > 1" implied a floor
      // item, so this loop could assume floor rules. A wide window breaks
      // that: its span runs along a WALL (wallFootprintTiles), not through
      // footprintTiles(), and a blind is SUPPOSED to overlap it. Left in
      // scope, this migration measured the window with floor geometry, saw
      // the blinds as collisions, and relocated the window one tile sideways
      // on every load — separating the pair and silently switching off the
      // +15% sleep buff. migrateWallMounts() owns wall items end to end and
      // runs right after this; it is the only place that understands both
      // the wall span and the window/blind pairing.
      if (def.mount === 'wall') continue;
      var tiles = footprintTiles(def, entry.x, entry.y, entry.rot || 0);
      if (freeFor(i, tiles)) continue; // already footprint-clean

      // 1. try relocating the item itself, same rotation, closest tile first.
      var relocated = false;
      var candidates = candidatesNear(entry.x, entry.y);
      for (var c = 0; c < candidates.length; c++) {
        var candTiles = footprintTiles(def, candidates[c].x, candidates[c].y, entry.rot || 0);
        if (freeFor(i, candTiles)) {
          entry.x = candidates[c].x; entry.y = candidates[c].y;
          relocated = true;
          break;
        }
      }
      if (relocated) continue;

      // 2. bed can't move anywhere — find exactly which prop(s) it
      // overlaps at its saved position and try relocating THEM instead.
      var bedTiles = footprintTiles(def, entry.x, entry.y, entry.rot || 0);
      var conflictIdxs = [];
      for (var j = 0; j < placed.length; j++) {
        if (j === i) continue;
        var oTiles = tilesFor(placed[j]);
        var conflicts = false;
        for (var a = 0; a < oTiles.length && !conflicts; a++) {
          for (var b = 0; b < bedTiles.length; b++) {
            if (oTiles[a].x === bedTiles[b].x && oTiles[a].y === bedTiles[b].y) { conflicts = true; break; }
          }
        }
        if (conflicts) conflictIdxs.push(j);
      }
      var toDrop = [];
      for (var ci = 0; ci < conflictIdxs.length; ci++) {
        var pj = conflictIdxs[ci];
        var pdef = findShopItem(placed[pj].id);
        if (!pdef) continue;
        var moved = false;
        var candidates2 = candidatesNear(placed[pj].x, placed[pj].y);
        for (var c2 = 0; c2 < candidates2.length; c2++) {
          var candTiles2 = footprintTiles(pdef, candidates2[c2].x, candidates2[c2].y, placed[pj].rot || 0);
          if (freeFor(pj, candTiles2)) {
            placed[pj].x = candidates2[c2].x; placed[pj].y = candidates2[c2].y;
            moved = true;
            break;
          }
        }
        if (!moved) toDrop.push(pj);
      }
      // 3. genuinely no room anywhere for a conflicting prop: leave it
      // OWNED but drop it from `placed` — never delete a player's item.
      if (toDrop.length) {
        toDrop.sort(function (x, y) { return y - x; }); // splice highest index first
        for (var d2 = 0; d2 < toDrop.length; d2++) placed.splice(toDrop[d2], 1);
      }
    }
  }

  // migrateWallMounts (SPEC-V15-BATCH-B §1): a save from before poster_team/
  // window_blinds became mount:'wall' may have one sitting on an ordinary
  // floor tile, or (post-migration on a later load) on a wall tile another
  // wall item has since claimed. Relocate to the nearest free wall slot
  // (Manhattan-nearest, same candidatesNear() shape as migrateBedFootprints
  // above); if genuinely no wall slot is free, leave it OWNED but drop it
  // from `placed` only — same "never delete a player's item" rule every
  // migration in this file follows. Works on the raw `d` being normalized
  // (State.data/State.currentGrid() don't exist yet here), so it uses local
  // gridW/gridD from locationDef, exactly like migrateBedFootprints does.
  // Must run after ensureDefaultBed/migrateBedFootprints for ordering
  // consistency, though it doesn't actually depend on the bed.
  function migrateWallMounts(d) {
    var loc = locationDef(d.locationId) || { gridW: 6, gridD: 6 };
    var gridW = loc.gridW, gridD = loc.gridD;
    var placed = d.placed || [];

    function isWall(x, y) { return x === 0 || y === 0; }

    /* SPEC-V20 §1/§3 — two corrections to this migration, both of which it
       got wrong the moment windows and blinds existed:

       1. A BLIND IS SUPPOSED TO SHARE A WINDOW'S TILE. That is the entire
          mechanic ("blinds snap to window tiles only"). This function used
          to treat *any* two wall items on one tile as a conflict, so on
          every single load it saw window+blind stacked, declared a
          collision, and relocated the window one tile sideways — silently
          separating them and switching OFF the +15% sleep buff the player
          had legitimately earned. Measured: blindsBonusActive() true before
          save, false after load, from a save the player never touched.
       2. IT ASSUMED EVERY WALL ITEM IS 1x1. A wide window covers two
          adjacent wall slots, so comparing anchor tiles alone let a second
          item overlap the window's far half undetected. wallFootprintTiles()
          is the one source of truth for that span (canPlaceFootprint and
          wallOccupantsAt both already use it) — use it here too rather than
          adding a third notion of what a wall item covers. */
    function wallPairCompatible(a, b) {
      if (!a || !b) return false;
      return (a.category === 'blind' && b.category === 'window') ||
             (a.category === 'window' && b.category === 'blind');
    }
    // Every tile the item would cover is in bounds AND on a wall — a wide
    // window anchored at the end of a run would otherwise hang off the grid.
    function wallSpanLegal(x, y, def) {
      var tiles = wallFootprintTiles(x, y, def);
      for (var t = 0; t < tiles.length; t++) {
        var tx = tiles[t].x, ty = tiles[t].y;
        if (tx < 0 || ty < 0 || tx >= gridW || ty >= gridD) return false;
        if (!isWall(tx, ty)) return false;
      }
      return true;
    }
    function wallSlotFree(skipIdx, x, y, def) {
      var mine = wallFootprintTiles(x, y, def);
      for (var i = 0; i < placed.length; i++) {
        if (i === skipIdx) continue;
        var other = findShopItem(placed[i].id);
        if (!other || other.mount !== 'wall') continue;
        if (wallPairCompatible(def, other)) continue;
        var theirs = wallFootprintTiles(placed[i].x, placed[i].y, other);
        for (var m = 0; m < mine.length; m++) {
          for (var o = 0; o < theirs.length; o++) {
            if (mine[m].x === theirs[o].x && mine[m].y === theirs[o].y) return false;
          }
        }
      }
      return true;
    }
    function wallCandidatesNear(ox, oy) {
      var list = [];
      for (var y = 0; y < gridD; y++) {
        for (var x = 0; x < gridW; x++) {
          if (isWall(x, y)) list.push({ x: x, y: y });
        }
      }
      list.sort(function (a, b) {
        var da = Math.abs(a.x - ox) + Math.abs(a.y - oy);
        var db = Math.abs(b.x - ox) + Math.abs(b.y - oy);
        return da - db;
      });
      return list;
    }

    var toDrop = [];
    for (var i = 0; i < placed.length; i++) {
      var entry = placed[i];
      var def = findShopItem(entry.id);
      if (!def || def.mount !== 'wall') continue;

      if (wallSpanLegal(entry.x, entry.y, def) && wallSlotFree(i, entry.x, entry.y, def)) {
        entry.rot = wallRotForTile(entry.x, entry.y); // keep facing correct even if already legal
        continue;
      }
      var candidates = wallCandidatesNear(entry.x, entry.y);
      var relocated = false;
      for (var c = 0; c < candidates.length; c++) {
        if (wallSpanLegal(candidates[c].x, candidates[c].y, def) &&
            wallSlotFree(i, candidates[c].x, candidates[c].y, def)) {
          entry.x = candidates[c].x; entry.y = candidates[c].y;
          entry.rot = wallRotForTile(entry.x, entry.y);
          relocated = true;
          break;
        }
      }
      if (!relocated) toDrop.push(i); // no free wall slot anywhere — stays owned, un-placed
    }
    if (toDrop.length) {
      toDrop.sort(function (a, b) { return b - a; }); // splice highest index first
      for (var d2 = 0; d2 < toDrop.length; d2++) placed.splice(toDrop[d2], 1);
    }
  }

  // migrateShrunkGrid (SPEC-V16 §1): every location's grid shrank by 2 tiles
  // per side (11x11 -> 9x9 at the top end), so a save written against the old
  // sizes can hold props anchored OUTSIDE the room it now loads into — the
  // first time in this project's history that a grid got SMALLER, which is
  // why no existing migration covers it. migrateBedFootprints() only visits
  // items with a >1x1 footprint, and migrateWallMounts() treats any y===0
  // tile as a wall without bounds-checking it (a banner at (10,0) in a 9-wide
  // room looks legal to it), so 1x1 floor props and out-of-bounds wall items
  // both fall through to here.
  //
  // Relocate each out-of-bounds prop to the closest legal anchor
  // (Manhattan-nearest from its clamped saved position, the same
  // candidatesNear() shape migrateBedFootprints/migrateWallMounts use); if
  // the room is genuinely full, drop it from `placed` ONLY — it stays in
  // `owned` and can be re-placed by hand. `owned` is never touched, the
  // absolute rule every migration in this file follows.
  //
  // Legality is decided by calling canPlaceFootprint() itself rather than a
  // local free-tile scan: it is THE occupancy rule (bounds, the reserved bed
  // corner, wall slots, the desk/pc/monitor share group, "a monitor needs a
  // desk on its tile"), and four user-visible bugs in this project came from
  // a second copy of one of those rules. canPlaceFootprint() reads
  // State.data (which normalizeSave() has not assigned yet), so State.data is
  // pointed at the save being normalized for the duration of the scan and
  // restored in a `finally` — deliberately narrow, and the reason this
  // migration does not repeat migrateBedFootprints()'s local freeFor().
  //
  // Must run AFTER migrateWallMounts()/migrateCoreSingletons() (so surplus
  // core props are already gone and wall items already carry a wall anchor)
  // and BEFORE recomputeEnergyMax() (un-placing an energy prop lowers
  // energyMax — the same ordering rule migrateLegacyFridges() states).

  function migrateShrunkGrid(d) {
    var placed = d.placed || [];
    if (!placed.length) return;
    var loc = locationDef(d.locationId) || { gridW: 6, gridD: 6 };
    var gridW = loc.gridW, gridD = loc.gridD;

    function isOutOfBounds(def, entry) {
      var tiles = footprintTiles(def, entry.x, entry.y, entry.rot || 0);
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        if (t.x < 0 || t.y < 0 || t.x >= gridW || t.y >= gridD) return true;
      }
      return false;
    }
    function candidatesNear(ox, oy) {
      var list = [];
      for (var y = 0; y < gridD; y++) for (var x = 0; x < gridW; x++) list.push({ x: x, y: y });
      list.sort(function (a, b) {
        var da = Math.abs(a.x - ox) + Math.abs(a.y - oy);
        var db = Math.abs(b.x - ox) + Math.abs(b.y - oy);
        return da - db;
      });
      return list;
    }
    // Monitors are relocated LAST: canPlaceFootprint() only accepts a monitor
    // onto a tile that already holds a desk, so the desk must have found its
    // own in-bounds home first or the monitor would be un-placed for a reason
    // that resolves itself one iteration later.
    var order = [];
    for (var i = 0; i < placed.length; i++) order.push(i);
    order.sort(function (a, b) {
      var da = findShopItem(placed[a].id), db = findShopItem(placed[b].id);
      var ma = da && da.category === 'monitor' ? 1 : 0;
      var mb = db && db.category === 'monitor' ? 1 : 0;
      return ma !== mb ? ma - mb : a - b;
    });

    var toDrop = [];
    var prevData = State.data;
    State.data = d;
    try {
      for (var oi = 0; oi < order.length; oi++) {
        var idx = order[oi];
        var entry = placed[idx];
        var def = findShopItem(entry.id);
        if (!def) continue; // unknown id from a future/older build — leave it alone
        if (!isOutOfBounds(def, entry)) continue;
        var cands = candidatesNear(clamp(entry.x, 0, gridW - 1), clamp(entry.y, 0, gridD - 1));
        var moved = false;
        for (var c = 0; c < cands.length; c++) {
          var check = canPlaceFootprint(def, cands[c].x, cands[c].y, entry.rot || 0, idx);
          if (check && check.ok) {
            entry.x = cands[c].x; entry.y = cands[c].y;
            // same derived-rotation rule placeItem/moveItem apply — a wall
            // item's facing comes from the wall it lands on, never from the
            // rot it happened to be saved with.
            if (def.mount === 'wall') entry.rot = wallRotForTile(entry.x, entry.y);
            moved = true;
            break;
          }
        }
        if (!moved) toDrop.push(idx); // no legal tile anywhere — stays OWNED, un-placed
      }
    } finally {
      State.data = prevData;
    }
    if (toDrop.length) {
      toDrop.sort(function (a, b) { return b - a; }); // splice highest index first
      for (var t2 = 0; t2 < toDrop.length; t2++) placed.splice(toDrop[t2], 1);
    }
  }

  /* ---- max-energy upgrades (SPEC-V3 §10, quantity rule REPLACED by SPEC-V5
     §6r, PLACEMENT rule REPLACED by SPEC-V6 §16) ---------------------------
     energyMax = base (Data.energyMax, 100) + energyAdd for every energy-
     category item PLACED in the room (was: owned, regardless of placement)
     — clamped to Data.energyMaxCap (200). You may still OWN any number of
     energy items; only the ones physically placed count, and Data.energyItemCap
     (4) now hard-caps how many may be PLACED at once (enforced by
     State.placeItem(), not State.buyItem() — see totalPlacedEnergyItemQty()).
     Also re-clamps current energy down if a (hypothetical) max reduction
     ever happened. */
  function recomputeEnergyMax(d) {
    var base = Data().energyMax || 100;
    var cap = Data().energyMaxCap || 200;
    var bonus = 0;
    var placed = d.placed || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.category === 'energy' && def.energyAdd) bonus += def.energyAdd;
    }
    d.energyMax = clamp(base + bonus, base, cap);
    d.energy = clamp(d.energy || 0, 0, d.energyMax);
  }

  // totalRegenBonus (SPEC-V6 §7): sum of PLACED `regen`-category items'
  // regenAdd, hard-capped at Data.regenBonusCap (+2.0/s) so the day rate can
  // never exceed Data.dayRegenBase + regenBonusCap. Only ever added to the
  // DAY portion of energy regen (see doTick) — night stays exactly 0/sec
  // regardless of how many regen items are placed.
  function totalRegenBonus(d) {
    var bonus = 0;
    var placed = d.placed || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.category === 'regen' && def.regenAdd) bonus += def.regenAdd;
    }
    var cap = Data().regenBonusCap;
    if (cap == null) cap = 2.0;
    return clamp(bonus, 0, cap);
  }

  function rankFromElo(elo) {
    var ranks = Data().ranks;
    var cur = ranks[0], idx = 0;
    for (var i = 0; i < ranks.length; i++) {
      if (elo >= ranks[i].min) { cur = ranks[i]; idx = i; }
    }
    var next = ranks[idx + 1] || null;
    var progress = next ? clamp((elo - cur.min) / (next.min - cur.min), 0, 1) : 1;
    return {
      name: cur.name, tier: idx, color: cur.color,
      next: next ? { name: next.name, min: next.min } : null,
      progress: progress, elo: elo
    };
  }

  function defaultData() {
    return {
      v: 1,
      day: 1,
      cash: 250,
      elo: 120,
      energy: 100, energyMax: 100,
      followers: 0,
      peakViewers: 0,
      subscribers: 0,      // SPEC-V3 §13 — real tracked/persisted resource, REPLACES idle income.
                            // MUST live here: normalizeSave() only copies keys present in
                            // defaultData(), so a field absent from this object is silently
                            // dropped on load (this has bitten tutorialDone before — see V2 notes).
      // V22c (owner item 1): a career opens on Data.hypeStart, not 0. Hype
      // became a tournament-driven stat, and tournaments need a team, and
      // teams want hype — starting at 0 locked the first door from the inside.
      hype: (Data().hypeStart != null) ? Data().hypeStart : 25,
      chemistry: 0,
      // V22c (owner item 4): epoch ms of the last solo PLAY match, for the
      // anti-farm cooldown. MUST live here — normalizeSave() only copies keys
      // present in defaultData(), so a field missing from this object is
      // silently dropped on load (HANDOFF-V2 §5.1).
      lastMatchAt: 0,
      form: null,
      contract: 'free',
      scrimsToday: 0,
      roomTier: 0,
      owned: deepClone(Data().defaultOwned),
      placed: deepClone(Data().defaultPlaced),
      inventory: [],
      displayCase: { items: [] },
      stats: { matches: 0, wins: 0, streams: 0, casesOpened: 0, bestPull: 0 },
      settings: { sound: true },

      /* ---- SPEC-V2 additions (additive — old fields above are untouched) */
      locationId: 0,       // replaces roomTier entirely (§7); roomTier above is dead data kept only so old saves normalize cleanly
      expansions: 0,       // room expansions bought at the current location (§6)
      rentMissed: 0,       // consecutive missed rent payments; evicted at 2 (§7)
      moving: null,        // { targetLocationId, packed: [placedIndex, ...] } while the moving minigame is in progress (§7)
      staff: { coachId: null, modId: null },  // hired staff (§5)
      name: 'CAREER',       // save slot display name (§4)
      playtimeMs: 0,         // accumulated playtime for this save (§4)
      lastPlayedAt: 0,        // epoch ms, stamped on every State.saveCurrent() — drives State.continueSlot()
      tutorialDone: false,   // set on tutorial completion or skip (§3). MUST live here:
                             // normalizeSave() only copies keys present in defaultData(),
                             // so a field absent from this object is silently dropped on load.

      /* ---- SPEC-V3 additions (additive — everything above is untouched) */
      lastEnergyTickAt: Date.now(),  // epoch ms anchor for real-time energy regen (§1)
      wakeElapsedMs: 0,              // ms elapsed while awake since the last wake; drives day/night phase (§2)
      asleep: false,                 // true while the interactive sleep() state is active (§3)
      sleepGained: 0,                // energy regenerated so far THIS sleep — gates the 50-energy min-sleep rule (§3)
      lastAdAt: 0,                   // epoch ms of the last watch-ad full-energy grant (§1, 60s cooldown)
      lastCashAdAt: 0,               // SPEC-V13 §9A: epoch ms of the last cash-ad grant — separate cooldown
                                      // from lastAdAt so the energy ad and the cash ad never compete
      debtStrikes: 0,                // consecutive rent payments that couldn't be fully covered (§5)
      dead: false,                   // true once debtStrikes reaches 2 — career over, save becomes view-only (§5)
      deadReason: null,

      /* ---- SPEC-V4 additions (additive — everything above is untouched) */
      sheepHitsThisSleep: 0,   // COUNTING SHEEP hits so far THIS sleep (§7), reset by State.sleep()
      sheepCashThisSleep: 0,   // $ already paid out THIS sleep from sheep hits — gates the $50 cap (§7)
      formBonusToday: 0,       // form bonus (0..0.10) earned from LAST night's sheep, applied on top of
                                // today's form multiplier the moment it's set (coach or manual) — §7
      majorChampion: false,    // permanent MAJOR CHAMPION marker (§6c) — never cleared once true
      teams: null,              // [{id,rank,strength,points}, ...] mutable slice of the 100-team leaderboard —
                                 // lazily seeded from Data().teams by ensureTeams() (§5a). `points` drives
                                 // `rank` via recomputeRanks() (§5d, HLTV-style points model) — rank is
                                 // NEVER written directly.
      myTeamId: null,           // id of the team currently signed to (contract !== 'free'); null as free agent
      offers: [],               // open offers inbox: { id, teamId, expiresAtDay, salary, signingBonus,
                                 //   contractSleeps, objectives: [{id,label,done}] } (§5b)
      contractSleeps: 0,        // sleeps remaining on the current signed contract (§5e); 0 = free agent
      contractLength: 0,        // total length in sleeps of the current contract, for UI progress display
      teamSalary: 0,             // the SIGNED TEAM's own monthly salary (§5c, from the accepted offer) —
                                  // overrides Data.contracts[...].salary in resolveNewDay when set via
                                  // the offers flow; 0 falls back to the legacy flat tier salary
      lastTournamentDay: 0,     // day the last LEAGUE CYCLE ran (or 0) — independent of
                                 // whether the player is signed (§5d: decay + background sim run every cycle
                                 // regardless; a signed, not-mid-bracket player also gets a tournament that cycle)
      leagueCycleInterval: 0,   // sleeps until the NEXT league cycle, rolled in 4..7 (Data.tournamentIntervalMin/
                                 // MaxSleeps) each time a cycle fires. Stored rather than rolled per check on
                                 // purpose: maybeRunLeagueCycle() compares against it every single day, so a
                                 // fresh roll per call would make the cycle fire on a different day each time it
                                 // was asked. 0 means "never rolled yet" and falls back to the max.
                                 // MUST live here — HANDOFF-V2 §5.1: a top-level key missing from defaultData()
                                 // is silently dropped by normalizeSave() on load.
      tournament: null,         // active/last tournament bracket state: { id, tier, event, field, bracket,
                                 //   round, prizePool, done } — see ensureTeams()/rollTournamentField() (§6)
      tournamentHistory: [],    // [{ day, event, placement, prize }] — lightweight results log for the UI

      /* ---- SPEC-V5 additions (additive — everything above is untouched) ----
         Every one of these MUST live here — normalizeSave() only copies keys
         present in defaultData(), so a field missing from this object is
         silently dropped on load (see the SPEC-V5 lead note; this has
         bitten the project three times already). */
      reputation: 0,                 // §12r: signed -100 (toxic) .. 0 (neutral, start) .. +100 (respected)
      consecutiveScrimMisses: 0,     // SPEC-V6 §25: CUMULATIVE misses for the whole current contract (was
                                      // consecutive-days, SPEC-V5 §26) — kicked at 3; reset to 0 whenever a
                                      // fresh contract is signed (State.acceptOffer()/State.signContract())
      lastSigningBonus: 0,           // §11: the bonus actually paid on the CURRENT contract — forfeited
                                      // in full if the player leaves early (State.leaveTeam)
      contractSignedTierAtSign: null,// §30: the team's tier at the moment this contract was signed —
                                      // used to tell whether an expiry extension counts as "promoted"
      lastKnownTeamTier: null,       // §27r: the signed team's tier as of the last wake — salary is
                                      // recomputed the moment this changes (see resolveNewDay)
      contractExtensionOffer: null,  // §30: { teamId, teamName, oldSalary, newSalary, signingBonus,
                                      //   contractSleeps, promoted, bumpPct } offered on natural contract
                                      //   expiry — State.acceptContractExtension()/declineContractExtension()
      pendingCaseReveal: null,       // §3/§21: { id, value, item, onStream } — the $7 is already charged
                                      //   and the roll already happened, but NOT credited to cash until
                                      //   State.creditCaseReveal(id) fires (when the wheel visually stops)

      /* ---- SPEC-V6 additions (additive — everything above is untouched) ----
         Every one of these MUST live here — normalizeSave() only copies keys
         present in defaultData(), so a field missing from this object is
         silently dropped on load (this has now bitten the project FOUR
         times — see the lead note). */
      // §3: the stockpile count itself is `owned.energy_can` (same pattern as
      // every other shop item) — no separate field needed for that.
      energyDrinksToday: 0,          // §3: drunk so far today, reset to 0 on wake (max 4/day)
      sleepRequiredMs: 0,            // §15: required sleep duration THIS sleep, set at bedtime from energy%,
                                      //   10s (at 50% energy) .. 30s (at 0% energy), never below 10s
      sleepElapsedMs: 0,             // §15: real ms elapsed asleep THIS sleep, reset by State.sleep()
      rentDayOffset: 0,              // §6: random day-of-cycle offset chosen on move-in so rent's weekly
                                      //   cadence can never land on the same day as the tournament cycle
      nextOfferEligibleDay: 0,       // §4: offers trickle in one at a time, every few days — the day the
                                      //   next offer roll is allowed
      nextPlayerTournamentDay: 0,    // §9: the day the player becomes eligible to start a new tournament —
                                      //   reset to (day + 7) whenever their event concludes (win OR lose).
                                      //   (Per-match day-gating lives on d.tournament.lastMatchDay instead —
                                      //   that whole object is already persisted via the `tournament` key.)

      /* ---- SPEC-V8 additions (additive — everything above is untouched) ----
         Every one of these MUST live here — normalizeSave() only copies keys
         present in defaultData(), so a field missing from this object is
         silently dropped on load (this has now bitten the project FIVE
         times — see SPEC-V8-SPONSORS.md §5). */
      sponsors: [],                   // held sponsors (§1, max MAX_HELD_SPONSORS): [{ id, sponsorId, name, pay,
                                       //   obligation: { type, amount }, progress, warned, acquiredDay }, ...]
      sponsorOffers: [],              // open sponsor-offer inbox — separate track from team `offers` (§1):
                                       //   [{ id, sponsorId, createdDay, expiresAtDay }, ...]
      nextSponsorOfferEligibleDay: 0, // §1: sponsor offers trickle in one at a time, every few days — the day
                                       //   the next sponsor-offer roll is allowed (mirrors nextOfferEligibleDay)
      sponsorStreamDaysThisWeek: [],  // distinct `day` values a stream happened on THIS obligation week — drives
                                       //   `stream_days` obligation progress; cleared every weekly sponsor tick
      sponsorWeekStartDay: 0,         // day the current sponsor obligation week began (informational — the
                                       //   week BOUNDARY itself is derived from d.day % subscriberPayoutInterval,
                                       //   the same tick the subscriber payout already uses, so this never drifts)

      /* ---- SPEC-V9 additions (additive — everything above is untouched) ----
         Every one of these MUST live here — normalizeSave() only copies keys
         present in defaultData(), so a field missing from this object is
         silently dropped on load (this has now bitten the project SIX
         times — see SPEC-V9-SOCIAL.md §7). See defaultSocial() above for the
         exact shape: { followers: {platformId: n}, unlocked: {platformId:
         bool}, postsThisWeek: {platformId: n}, managerId, drips: [{platform,
         remaining:[n,...], viral}] }. */
      social: defaultSocial(),

      /* ---- SPEC-V10 additions (additive — everything above is untouched) ----
         Every one of these MUST live here — normalizeSave() only copies keys
         present in defaultData(), so a field missing from this object is
         silently dropped on load (this has now bitten the project SEVEN
         times — see SPEC-V10-CRYPTO.md §7). See defaultCrypto() above for the
         exact shape: { prices: {coinId: n}, history: {coinId: [n,...]},
         holdings: {coinId: {qty, costBasis, realizedPnl}}, news: [...active],
         newsHistory: [...resolved log], tickCount, lastTickAt, nextNewsAtTick }.
         Deliberately NOT wired into energy, career gates, sponsors, scrims or
         streams (SPEC-V10 §6) — orthogonal to the core loop by design. */
      crypto: defaultCrypto(),

      /* ---- footprint/art alignment fix (additive — everything above is
         untouched) — MUST live here: normalizeSave() only copies keys
         present in defaultData(), so a field missing from this object is
         silently dropped on load. */
      bedArtAnchorFixed: true, // true for any save that never needs (or has
                                // already had) migrateBedArtAnchor() run —
                                // a fresh save's bed is placed under the
                                // current anchor-forward art convention
                                // already, so it starts "fixed". A genuinely
                                // old save loaded via normalizeSave() won't
                                // have this key in its raw JSON at all, which
                                // is exactly what triggers the one-time shift
                                // (see normalizeSave()/migrateBedArtAnchor()).

      /* ---- SPEC-V14 additions (additive — everything above is untouched) ----
         Both MUST live here — normalizeSave() only copies keys present in
         defaultData(), so a field missing from this object is silently
         dropped on load (this has now bitten the project EIGHT times — see
         SPEC-V14-PHONE.md §2). Both are STICKY: once true, permanently true,
         latched (never re-locked) by applyPhoneUnlocks() below regardless of
         whether the underlying number later falls. */
      // V22 (owner item 5): the HANDSET IS NO LONGER GATED — the player has a
      // phone from the first minute and the individual APPS carry the locks.
      // `phoneUnlocked` therefore no longer gates the phone; it is kept only
      // as the legacy latch old saves already carry (and as the grandfather
      // signal in applyPhoneUnlocks below). Nothing should read it as "can the
      // player open the phone" — State.phoneStatus().unlocked is now always
      // true. Removing the key outright would drop it from every existing
      // save on load, which is the §5.1 trap, so it stays.
      phoneUnlocked: false,      // LEGACY — see socialAppUnlocked below
      socialAppUnlocked: false,  // V22: true once d.followers has ever reached
                                  // SOCIAL_UNLOCK_FOLLOWERS (500). Sticky.
      sponsorsAppUnlocked: false, // V22: true once the player has ever signed a
                                  // team, ANY tier (tier 3 counts). Sticky, so
                                  // leaving a team never hides sponsors the
                                  // player may already be holding.
      cryptoAppUnlocked: false,  // §2: true once d.cash has ever reached
                                  // CRYPTO_APP_UNLOCK_CASH (20000). Sticky so
                                  // a player holding coins can never be
                                  // soft-locked out of selling them.

      /* ---- SPEC-V15 BATCH A additions (additive — everything above is
         untouched) ---- ALL FOUR MUST live here — normalizeSave() only
         copies keys present in defaultData(), so a field missing from this
         object is silently dropped on load (this has now shipped broken
         FIVE times — see SPEC-V15-BATCH-A.md §0). */
      reSignCount: 0,            // §1/§12: consecutive re-signs of the SAME
                                  // team via State.acceptContractExtension()
                                  // — decays the extension bump toward flat.
                                  // Reset to 0 by State.acceptOffer() when
                                  // the signed team differs from reSignTeamId.
      reSignTeamId: null,        // §1/§12: which team d.reSignCount is
                                  // currently counting for — bookkeeping only,
                                  // never read outside acceptOffer/
                                  // acceptContractExtension, but persisted so
                                  // a reload can't forget mid-streak and
                                  // silently reset the count to 0.
      bestContractTier: null,    // §2/§20a: best (lowest-numbered) contract
                                  // tier ever COMPLETED (contract ran out
                                  // naturally) — NEVER via State.leaveTeam()
                                  // (walking out early must not count). null
                                  // = never completed one. Gates Tier 1 offers.
      caseSelection: {           // §7/§10: which case TIER to open solo vs on
                                  // stream, independently — defaults both to
                                  // Data.caseTiers[0] (the $7 base case).
                                  // ensureCaseSelection() below defensively
                                  // re-fills either half if ever missing
                                  // (old save, bad merge), same lazy-init
                                  // pattern as ensureSocial()/ensureTeams().
        solo: (Data().caseTiers && Data().caseTiers[0]) ? Data().caseTiers[0].id : 'case_standard',
        stream: (Data().caseTiers && Data().caseTiers[0]) ? Data().caseTiers[0].id : 'case_standard'
      },

      /* ---- SPEC-V15 BATCH C additions (additive — everything above is
         untouched) ---- ALL FIVE MUST live here — normalizeSave() only
         copies keys present in defaultData(), so a field missing from this
         object is silently dropped on load (this has now shipped broken
         FIVE times — see SPEC-V15-BATCH-C.md §0). This is the SECOND, always-
         separate tutorial mechanism (contextual single-card lessons fired by
         a milestone, shown once ever) — completely independent of the
         existing 8-step onboarding, whose own single flag (`tutorialDone`
         above) is untouched and still means what it always meant. */
      tutorialsSeen: {},         // §1: { [tutorialId]: true } once State.markTutorialSeen(id) has fired for
                                  // it — presence of a truthy key means "never show again". Never an array
                                  // (id lookup must be O(1), and dedup is automatic by construction).
      streaming: false,          // §1 suppression rule ("no tutorial during a live stream"): Package C3
                                  // OWNS this flag — it MUST set State.data.streaming = true the moment a
                                  // stream session actually starts, and back to false the moment it ends
                                  // (win, loss, or snipe), same way it already mutates d.stats.streams /
                                  // d.followers directly in its fallback path. State.tutorialPending() below
                                  // reads it but never writes it — C1 has no other way to observe "a stream
                                  // is live right now" (stream.js's session state is otherwise private to
                                  // its own closure).
      rentEverCharged: false,    // §1 `first_rent` trigger: true the first time applyRent() ever actually
                                  // runs a charge (paid OR missed) — d.rentMissed only counts MISSES, so a
                                  // player who has always paid on time would never trip a miss-based check.
                                  // Latched (never re-locked) by applyRent(), exactly like applyPhoneUnlocks.
      scrimEverCompleted: false, // §1 `first_scrim` trigger: true the first time State.scrim() ever
                                  // succeeds — d.scrimsToday resets to 0 every wake, so it cannot answer
                                  // "has the player EVER completed one". Latched by State.scrim() below.

      /* ---- SPEC-V23 additions (additive — everything above is untouched) ----
         ALL FOUR MUST live here — normalizeSave() only copies keys present in
         defaultData(), so a field missing from this object is silently
         dropped on load (this has now shipped broken NINE times — see
         SPEC-V23-QUESTS.md §7). Do NOT also add a top-level mirror of
         anything stored PER EMAIL (e.g. an entry's `read`/`state`) — `emails`
         is copied wholesale by the generic normalizeSave() loop below, so
         per-entry fields already round-trip with no extra code, exactly like
         `placed[i]`'s `tint`/`designId`/`closed` do (HANDOFF-V2 §5.1). A
         top-level mirror would be the second-copy bug instead. */
      emails: [],          // the inbox — newest LAST (State.emails() reverses to newest-first, §8).
                            // Capped at 30, oldest RESOLVED entry dropped first (§3.2).
      emailSeq: 0,          // monotonic id counter for email ids (genId() is per-category, not
                            // guaranteed unique across categories — this is the email inbox's own counter)
      lastInviteDay: 0,     // day the last quest invite was generated — drives the §4.2 cadence roll
      scoutStage: 0         // highest scout stage already fired (latched, never re-fired — §6)
    };
  }

  var State = {
    data: null
  };

  // migrateCoreSingletons (SPEC-V13 §4B): "at least one" of each core
  // category (desk/pc/chair/monitor/bed — SINGLETON_ROOM_CATEGORIES, defined
  // further down) became "exactly one" — a save from before that change may
  // still have 2+ placed instances of one category. For each such category,
  // keep only the placed instance whose shop item has the highest `price`
  // (the best thing the player owns and had placed), ties broken by the
  // lower placed index; every OTHER instance is dropped from `placed` only.
  // `owned` is never touched here — a player's item is never deleted, only
  // un-placed, exactly like every other migration in this file. Must run
  // BEFORE recomputeEnergyMax() (mirrors migrateBedFootprints()'s ordering
  // rule directly above) — swap-in-place logic (State.placeItem) can then
  // assume "at most one placed per core category" is already an invariant,
  // not something it has to defend against itself.
  function migrateCoreSingletons(d) {
    var placed = d.placed || [];
    // Reads SINGLETON_ROOM_CATEGORIES directly (defined further down this
    // closure, but already assigned by the time normalizeSave() is ever
    // CALLED — see State.load()/State.loadSlot()) rather than a second
    // literal list, per the "never mirror a rule" project rule.
    SINGLETON_ROOM_CATEGORIES.forEach(function (cat) {
      var entries = [];
      for (var i = 0; i < placed.length; i++) {
        var def = findShopItem(placed[i].id);
        if (def && def.category === cat) entries.push({ idx: i, price: def.price || 0 });
      }
      if (entries.length <= 1) return;
      var keep = entries[0];
      for (var j = 1; j < entries.length; j++) {
        if (entries[j].price > keep.price) keep = entries[j];
      }
      var removeIdxs = entries.filter(function (e) { return e.idx !== keep.idx; }).map(function (e) { return e.idx; });
      removeIdxs.sort(function (a, b) { return b - a; }); // splice highest index first so earlier indices stay valid
      removeIdxs.forEach(function (idx) { placed.splice(idx, 1); });
    });
  }

  /* ---- persistence -------------------------------------------------------- */
  function emit(evt) {
    var fns = listeners[evt] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](State.data); } catch (e) { console.error('[State] listener error', e); }
    }
  }
  function commit() { State.save(); emit('change'); }

  State.on = function (evt, fn) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(fn);
  };

  // normalizeSave: shallow+nested merge of a raw (possibly V1 or partial V2)
  // save object onto a fresh defaultData() so older/partial saves never crash
  // newer code, and so new V2 fields always get sane defaults.
  function normalizeSave(raw) {
    var d = defaultData();
    if (raw) {
      for (var k in d) {
        if (raw[k] !== undefined) d[k] = raw[k];
      }
      d.stats = Object.assign({ matches: 0, wins: 0, streams: 0, casesOpened: 0, bestPull: 0 }, raw.stats || {});
      d.settings = Object.assign({ sound: true }, raw.settings || {});
      d.displayCase = raw.displayCase || { items: [] };
      d.staff = Object.assign({ coachId: null, modId: null }, raw.staff || {});
      // SPEC-V15 §10: nested merge (not the flat top-level copy above) so a
      // pre-V15 save (raw.caseSelection undefined) or one saved mid-way
      // through a bad state still gets both halves defaulted to the base
      // case tier, same pattern as `staff`/`settings` above.
      var baseCaseId = (Data().caseTiers && Data().caseTiers[0]) ? Data().caseTiers[0].id : 'case_standard';
      d.caseSelection = Object.assign({ solo: baseCaseId, stream: baseCaseId }, raw.caseSelection || {});
      // SPEC-V9 §7: per-nested-key merge (not a flat Object.assign) so a
      // save from before a NEW platform was added to Data.socialPlatforms
      // still gets that platform's followers/unlocked/postsThisWeek entries
      // defaulted in, exactly like defaultSocial()/ensureSocial() do.
      var rawSocial = raw.social || {};
      var freshSocial = defaultSocial();
      d.social = {
        followers: Object.assign({}, freshSocial.followers, rawSocial.followers || {}),
        unlocked: Object.assign({}, freshSocial.unlocked, rawSocial.unlocked || {}),
        postsThisWeek: Object.assign({}, freshSocial.postsThisWeek, rawSocial.postsThisWeek || {}),
        managerId: rawSocial.managerId || null,
        drips: Array.isArray(rawSocial.drips) ? rawSocial.drips : []
      };
      // SPEC-V10 §7: per-coin nested merge (not a flat Object.assign/raw
      // passthrough) so a save from before a NEW coin was added to
      // Data.cryptoCoins still gets that coin's price/history/holdings
      // entries defaulted in, exactly like defaultCrypto()/ensureCrypto() do.
      // Also re-anchors lastTickAt to "now" on load so a long time offline
      // never grants (or charges) a silent backlog of catch-up price ticks —
      // same reasoning as lastEnergyTickAt above.
      var rawCrypto = raw.crypto || {};
      var freshCrypto = defaultCrypto();
      d.crypto = {
        prices: Object.assign({}, freshCrypto.prices, rawCrypto.prices || {}),
        history: Object.assign({}, freshCrypto.history, rawCrypto.history || {}),
        holdings: Object.assign({}, freshCrypto.holdings, rawCrypto.holdings || {}),
        // SPEC-V15 §3 fix: these four used to hard-default to []/[]/0/0
        // whenever raw.crypto omitted them — which is EVERY brand-new save
        // (raw.crypto is `{}`), silently discarding defaultCrypto()'s whole
        // SPEC-V15 pre-seed (the live-looking prices survived above via the
        // Object.assign fallback, but the news/history/tickCount that made
        // the walk honest did not) the very first time a fresh save round-
        // tripped through save/reload. Now falls back to freshCrypto's
        // pre-seeded values exactly like prices/history/holdings do above —
        // an EXISTING save's real rawCrypto values, when present, are still
        // used untouched, so nothing here changes for anyone but a fresh save.
        news: Array.isArray(rawCrypto.news) ? rawCrypto.news : freshCrypto.news,
        newsHistory: Array.isArray(rawCrypto.newsHistory) ? rawCrypto.newsHistory : freshCrypto.newsHistory,
        tickCount: typeof rawCrypto.tickCount === 'number' ? rawCrypto.tickCount : freshCrypto.tickCount,
        lastTickAt: Date.now(),
        nextNewsAtTick: typeof rawCrypto.nextNewsAtTick === 'number' ? rawCrypto.nextNewsAtTick : freshCrypto.nextNewsAtTick,
        // SPEC-V13 §8A: must be listed here explicitly — this hand-written
        // rebuild does not fall back to defaultCrypto() for unlisted keys,
        // so a field missing from this block is dropped on load even though
        // defaultCrypto() has it. lastSeenNewsTick deliberately stays 0 (not
        // freshCrypto's) even on a fresh save — freshCrypto's pre-seeded news
        // is "unseen" by design, driving the career-nav badge dot on first visit.
        lastSeenNewsTick: typeof rawCrypto.lastSeenNewsTick === 'number' ? rawCrypto.lastSeenNewsTick : 0
      };
      ensureCrypto(d);
      d.moving = raw.moving || null;
      d.name = raw.name || d.name;
      d.playtimeMs = typeof raw.playtimeMs === 'number' ? raw.playtimeMs : (d.playtimeMs || 0);
      // A raw save with no lastEnergyTickAt at all (any pre-V3 save) should
      // anchor to "now" rather than inherit defaultData()'s already-stale
      // Date.now() from module-parse time, so migrating an old save never
      // silently grants a backlog of real-time energy for time that passed
      // before V3 existed.
      d.lastEnergyTickAt = typeof raw.lastEnergyTickAt === 'number' ? raw.lastEnergyTickAt : Date.now();
    }
    // SPEC-V6 §6: a save that already moved into a paying location before
    // rentDayOffset existed (or before this move happened) needs one
    // backfilled now, else it defaults to 0 which WOULD collide with the
    // tournament cycle (both land on multiples of 7 otherwise). New saves
    // still at the free basement (locationId 0, no rent) get one lazily on
    // their first real move-in instead (State.commitMove/forceCommitMove).
    if (d.locationId > 0 && !d.rentDayOffset) d.rentDayOffset = randInt(1, 6);
    // SPEC-V6 §3: energy_can changed category from `energy` (a room prop) to
    // `consumable` (never placed) — strip any stray pre-V6 placed instance
    // so an old save doesn't render an unplaceable item in the room.
    d.placed = (d.placed || []).filter(function (p) {
      var def = findShopItem(p.id);
      return !def || def.category !== 'consumable';
    });
    // SPEC-V11 §2: the standalone `fridge` category (fridge_mini/
    // fridge_full) is deleted — convert any legacy ownership onto the
    // equivalent energy-category fridge before anything below reads
    // `owned`/`placed`/energyMax. See migrateLegacyFridges() for the full
    // rationale.
    migrateLegacyFridges(d);
    // SPEC-V6 §28: room expansion is deleted — `expansions` is kept
    // (untouched) purely so it round-trips on save/load, but currentGrid()
    // no longer reads it; grid size comes only from the location now. No
    // further action needed here for a clean migration.
    // footprint/art alignment fix: checked against `raw`, not the already-
    // merged `d` — d.bedArtAnchorFixed would otherwise silently inherit
    // defaultData()'s `true` default and mask a genuinely old save that
    // never had this key at all. See migrateBedArtAnchor() above.
    if (raw.bedArtAnchorFixed !== true) migrateBedArtAnchor(d);
    d.bedArtAnchorFixed = true;
    // Every save must always have a bed (SPEC-V3 §3) — patches pre-V3 saves
    // that predate Data.defaultOwned including bed_mattress.
    ensureDefaultBed(d);
    // SPEC-V12 §5: a pre-V12 save stored every bed as 1x1 — its now-real
    // second footprint tile may overlap another prop from the same save.
    // Must run AFTER ensureDefaultBed (guarantees a placed bed to check).
    migrateBedFootprints(d);
    // SPEC-V15-BATCH-B §1: a pre-V15 save may have poster_team/window_blinds
    // sitting on an ordinary floor tile (mount:'wall' didn't exist yet) —
    // relocate to the nearest free wall slot, or un-place (never delete) if
    // none exists. Independent of the bed footprint fix above but kept in
    // the same migration neighborhood.
    migrateWallMounts(d);
    // SPEC-V13 §4B: "at least one" per core category became "exactly one" —
    // collapse any pre-existing surplus (kept the priciest, never touches
    // `owned`) before energyMax (or anything else downstream) reads `placed`.
    migrateCoreSingletons(d);
    // SPEC-V16 §1: every location's grid shrank by 2 tiles per side, so a
    // pre-V16 save can hold props anchored outside the room it now loads
    // into. Relocate them (or leave them owned-but-unplaced), never delete.
    // Runs LAST of the placement migrations — after the singleton collapse
    // above, so it never spends a tile on a surplus prop that was about to be
    // un-placed anyway — and before recomputeEnergyMax() below.
    migrateShrunkGrid(d);
    // V22 item 15 added a migratePcOwnTile() call after this one, to re-home
    // towers off the desk tile. Item 4 reversed that rule, so the migration is
    // GONE — a PC sharing the desk's tile is legal again. Nothing replaces it
    // and no reverse migration is needed: a save that already had its tower
    // moved to its own tile is still perfectly legal, it just keeps the tower
    // there until the player drags it back.
    // energyMax is derived from owned energy-category props (SPEC-V3 §10);
    // always recompute rather than trust a stored value, since Data's base/
    // per-item bonuses are the source of truth.
    recomputeEnergyMax(d);
    // SPEC-V14 §2: latch immediately on load — an old save that already
    // qualifies (e.g. followers already >= 300) must not sit locked waiting
    // for the first tick just because the flag didn't exist when it saved.
    applyPhoneUnlocks(d);
    return d;
  }

  function readSavesRootRaw() {
    try {
      var raw = localStorage.getItem(SAVES_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* file:// may block storage */ }
    return null;
  }

  function migrateLegacyV1() {
    var legacy = null;
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) legacy = JSON.parse(raw);
    } catch (e) { /* ignore corrupt legacy save */ }
    if (legacy && legacy.v === 1) {
      var migrated = normalizeSave(legacy);
      if (!legacy.name) migrated.name = 'CAREER 1';
      return migrated;
    }
    return null;
  }

  // loadSavesRoot: returns { slots: [saveObj|null, saveObj|null, saveObj|null],
  // lastSlot }. On first-ever V2 boot (no cs2sim.saves key yet), migrates an
  // existing cs2sim.v1 save into slot 0 and persists the new root — the old
  // key is left untouched (never deleted), per SPEC-V2 §4.
  function loadSavesRoot() {
    if (savesRootCache) return savesRootCache;
    var root = readSavesRootRaw();
    if (root && Array.isArray(root.slots)) {
      while (root.slots.length < SLOT_COUNT) root.slots.push(null);
      if (root.slots.length > SLOT_COUNT) root.slots = root.slots.slice(0, SLOT_COUNT);
      if (typeof root.lastSlot !== 'number' || root.lastSlot < 0 || root.lastSlot >= SLOT_COUNT) root.lastSlot = 0;
    } else {
      root = { slots: [null, null, null], lastSlot: 0 };
      var migrated = migrateLegacyV1();
      if (migrated) {
        root.slots[0] = migrated;
        root.lastSlot = 0;
      }
      persistSavesRoot(root);
    }
    savesRootCache = root;
    return root;
  }

  function persistSavesRoot(root) {
    savesRootCache = root;
    try { localStorage.setItem(SAVES_KEY, JSON.stringify(root)); } catch (e) { /* ignore quota/file:// errors */ }
  }

  // ---- legacy-named entry points (kept working per integration contract) --
  // State.load(): loads the most-recently-played slot (root.lastSlot) into
  // State.data, creating an in-memory default save if that slot is empty.
  // Mirrors V1's zero-config boot so js/main.js's `State.load()` call keeps
  // working unmodified until a title screen wires slot selection in.
  State.load = function () {
    var root = loadSavesRoot();
    var slot = root.slots[root.lastSlot];
    State.data = slot ? normalizeSave(slot) : defaultData();
    if (!slot) { State.data.name = 'CAREER ' + (root.lastSlot + 1); recomputeEnergyMax(State.data); }
    State.tickEnergy(); // reconcile real-time energy across the reload/backgrounded gap (SPEC-V3 §1)
    emit('change');
    return State.data;
  };

  // State.save(): persists State.data into the active slot of cs2sim.saves.
  State.save = function () {
    State.saveCurrent();
  };

  State.reset = function () {
    var keepName = (State.data && State.data.name) || 'CAREER';
    State.data = defaultData();
    State.data.name = keepName;
    recomputeEnergyMax(State.data);
    commit();
  };

  /* ---- V2/V3 slot API (SPEC-V2 §4, SPEC-V3 §5) — for the title-screen agent */
  State.listSlots = function () {
    var root = loadSavesRoot();
    return root.slots.map(function (s, i) {
      if (!s) return { index: i, exists: false };
      var rank = rankFromElo(s.elo || 0);
      return {
        index: i,
        exists: true,
        name: s.name || ('CAREER ' + (i + 1)),
        day: s.day,
        cash: s.cash,
        elo: s.elo,
        rankName: rank.name,
        rankColor: rank.color,
        contract: s.contract,
        playtimeMs: s.playtimeMs || 0,
        dead: !!s.dead,           // SPEC-V3 §5 — title screen must render CAREER LOST / VIEW STATS+DELETE only
        deadReason: s.deadReason || null
      };
    });
  };

  State.lastSlot = function () {
    return loadSavesRoot().lastSlot;
  };

  State.activeSlot = State.lastSlot;

  // State.continueSlot() (SPEC-V3 §5): the slot the title screen's CONTINUE
  // button should resume — the most recently *played* slot (by
  // lastPlayedAt, stamped on every State.saveCurrent()) that is NOT dead.
  // Unlike State.lastSlot()/activeSlot() (which just report the raw
  // "currently active" slot index regardless of death), this is the
  // "most recent playable slot" lookup required to skip CAREER LOST saves
  // so CONTINUE can never resume one. Returns -1 if no slot is playable.
  State.continueSlot = function () {
    var root = loadSavesRoot();
    var best = -1, bestTime = -1;
    for (var i = 0; i < root.slots.length; i++) {
      var s = root.slots[i];
      if (!s || s.dead) continue;
      var t = s.lastPlayedAt || 0;
      if (t > bestTime) { bestTime = t; best = i; }
    }
    return best;
  };

  State.loadSlot = function (index) {
    if (index < 0 || index >= SLOT_COUNT) return null;
    var root = loadSavesRoot();
    var slot = root.slots[index];
    State.data = normalizeSave(slot);
    root.lastSlot = index;
    persistSavesRoot(root);
    State.tickEnergy(); // reconcile real-time energy immediately on load (SPEC-V3 §1)
    emit('change');
    return State.data;
  };

  State.createSlot = function (index, name) {
    if (index < 0 || index >= SLOT_COUNT) return null;
    var root = loadSavesRoot();
    var fresh = defaultData();
    fresh.name = name || ('CAREER ' + (index + 1));
    recomputeEnergyMax(fresh);
    root.slots[index] = fresh;
    root.lastSlot = index;
    persistSavesRoot(root);
    State.data = fresh;
    emit('change');
    return State.data;
  };

  State.renameSlot = function (index, name) {
    if (index < 0 || index >= SLOT_COUNT) return false;
    var root = loadSavesRoot();
    if (!root.slots[index]) return false;
    root.slots[index].name = name;
    if (State.data && index === root.lastSlot) State.data.name = name;
    persistSavesRoot(root);
    if (State.data && index === root.lastSlot) emit('change');
    return true;
  };

  State.deleteSlot = function (index) {
    if (index < 0 || index >= SLOT_COUNT) return false;
    var root = loadSavesRoot();
    root.slots[index] = null;
    persistSavesRoot(root);
    return true;
  };

  State.saveCurrent = function () {
    if (!State.data) return;
    State.data.lastPlayedAt = Date.now(); // drives State.continueSlot() (SPEC-V3 §5)
    var root = loadSavesRoot();
    root.slots[root.lastSlot] = State.data;
    persistSavesRoot(root);
  };

  /* ---- core economy primitives (§3.3) ------------------------------------- */
  State.spend = function (amount) {
    if (State.data.cash < amount) return false;
    State.data.cash -= amount;
    commit();
    return true;
  };

  State.earn = function (amount) {
    State.data.cash += amount;
    commit();
  };

  State.useEnergy = function (n) {
    if (State.data.energy < n) return false;
    State.data.energy -= n;
    commit();
    return true;
  };

  // setupQuality (SPEC-V6 §18): the average band-tier (starter/pro/elite ->
  // 0/0.5/1.0) of the 4 core PLACED singleton props (desk/pc/monitor/chair)
  // — a 0..1 score fed into official-match and tournament win chance
  // specifically (see State.playMatch()/powerFor()), separate from the
  // existing generic gear.aim stat contribution.
  var SETUP_QUALITY_CATEGORIES = ['desk', 'pc', 'monitor', 'chair'];
  function setupQuality(d) {
    var bandValue = Data().setupQualityBandValue || { starter: 0, pro: 0.5, elite: 1.0 };
    var placed = d.placed || [];
    var total = 0, count = 0;
    for (var c = 0; c < SETUP_QUALITY_CATEGORIES.length; c++) {
      var cat = SETUP_QUALITY_CATEGORIES[c];
      for (var i = 0; i < placed.length; i++) {
        var def = findShopItem(placed[i].id);
        if (def && def.category === cat) {
          total += bandValue[def.band] != null ? bandValue[def.band] : 0;
          count++;
          break; // singleton — only one placed instance of this category actually counts
        }
      }
    }
    return count ? total / count : 0;
  }
  State.setupQuality = function () { return setupQuality(State.data); };

  State.gearBonus = function () {
    var total = { aim: 0, stream: 0, income: 0, prestige: 0, luck: 0 };
    var owned = State.data.owned;
    for (var id in owned) {
      var qty = owned[id];
      var def = findShopItem(id);
      if (!def || !qty) continue;
      var s = def.stats || {};
      total.aim += (s.aim || 0) * qty;
      total.stream += (s.stream || 0) * qty;
      total.income += (s.income || 0) * qty;
      total.prestige += (s.prestige || 0) * qty;
      total.luck += (s.luck || 0) * qty;
    }
    if (State.data.displayCase && State.data.displayCase.items) {
      total.prestige += State.data.displayCase.items.length * 3;
    }
    total.luck = clamp(total.luck, 0, 0.5);
    return total;
  };

  /* ---- SPEC-V20 §4: banner/neon merchandise buff ----------------------------
     Flat, non-stacking: true the instant ANY item flagged `merchBonus: true`
     on its Data.shopItems def (poster_team the banner, neon_sign — see
     data.js) is PLACED in the room, false otherwise. Placement (not mere
     ownership) is deliberate — an unhung banner sitting in inventory isn't
     "on stream". THE single source of truth for the on/off check AND the
     magnitude read (Data.streamMerchBonusPct) — State.applyStreamResult()
     below is the only consumer; never duplicate this rule elsewhere. ------- */
  function merchandiseBonusActive(d) {
    var placed = (d || State.data).placed || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.merchBonus) return true;
    }
    return false;
  }
  State.merchandiseBonusActive = function () { return merchandiseBonusActive(State.data); };
  State.merchandiseBonusPct = function () {
    return merchandiseBonusActive(State.data) ? (Data().streamMerchBonusPct || 0) : 0;
  };

  State.rank = function () {
    return rankFromElo(State.data.elo);
  };

  /* ---- real-time energy + day/night cycle + sleep (SPEC-V3 §1 / §2 / §3) ---
     Time only ever advances relative to wall-clock reality via
     State.tickEnergy() — never per animation frame. Every mutator below
     (sleep/wake/watchAdRefill) calls it first so a caller never reads a
     stale energy/phase value no matter how long it's been since the UI's
     own interval last fired. --------------------------------------------- */
  var DAY_END_MS = 75000;      // SPEC-V5 §16: DAY is 0-75s (was 0-300s)
  var NIGHT_START_MS = 90000;  //              SUNSET is 75-90s, NIGHT is 90s+ (was 300-360s)
  var MIN_SLEEP_ENERGY = 50;   // LEGACY (SPEC-V3 §3) — superseded by the time-based gate below (§15),
                                // kept only so nothing that still reads the name breaks.
  var MIN_SLEEP_MS_FLOOR = 10000; // SPEC-V6 §15: required sleep NEVER drops below 10s regardless of energy%
  var AD_COOLDOWN_MS = 60000;  // SPEC-V3 §1: watch-ad refill, once per 60s real time

  // computePhase: phase is derived purely from wakeElapsedMs, which only
  // advances while awake (frozen the instant the player falls asleep) — so
  // it doubles as "what the room looked like right before bed" if ever
  // queried while asleep. sunsetProgress is a continuous 0..1 ramp across
  // the 300-360s SUNSET window specifically for the renderer to interpolate
  // a gradient per frame, per §2 ("never a hard swap").
  function computePhase(d) {
    var e = d.wakeElapsedMs || 0;
    var phase = e < DAY_END_MS ? 'day' : (e < NIGHT_START_MS ? 'sunset' : 'night');
    var sunsetProgress = clamp((e - DAY_END_MS) / (NIGHT_START_MS - DAY_END_MS), 0, 1);
    return { phase: phase, sunsetProgress: sunsetProgress };
  }

  /* ---- reputation (SPEC-V5 §12r) --------------------------------------------
     A second standing metric alongside hype. Signed: -100 (toxic) through 0
     (neutral, the starting value) to +100 (respected). Purely a gate on
     which tiers will make offers (see tryGenerateOffers below) — not a
     second economy. Persisted at d.reputation (defaultData()). */
  function reputationBand(rep) {
    if (rep >= 40) return 'respected';
    if (rep >= 0) return 'neutral';
    if (rep >= -39) return 'questionable';
    return 'toxic';
  }
  function reputationAllowsTier(rep, tier) {
    var band = reputationBand(rep);
    if (band === 'toxic') return tier === 3;        // only Tier 3 will offer
    if (band === 'questionable') return tier !== 1;  // Tier 1 will not offer
    return true;                                      // respected/neutral: all tiers scout you
  }
  function applyReputationChange(d, amount) {
    d.reputation = clamp((d.reputation || 0) + amount, -100, 100);
    return d.reputation;
  }
  var REPUTATION_BAND_LABELS = { respected: 'RESPECTED', neutral: 'NEUTRAL', questionable: 'QUESTIONABLE', toxic: 'TOXIC' };
  var REPUTATION_BAND_GATING = {
    respected: 'All tiers scout you.',
    neutral: 'Normal — no gate.',
    questionable: 'Tier 1 will not offer.',
    toxic: 'Only Tier 3 will offer.'
  };
  State.reputationStatus = function () {
    var d = State.data;
    var rep = d.reputation || 0;
    var band = reputationBand(rep);
    return { value: rep, band: band, bandLabel: REPUTATION_BAND_LABELS[band], gating: REPUTATION_BAND_GATING[band] };
  };

  /* ---- the phone (SPEC-V14 PHONE §2) ----------------------------------------
     Two sticky unlock flags, latched here and nowhere else — every caller
     (sponsors gate below, State.phoneStatus(), the UI packages) reads
     d.phoneUnlocked / d.cryptoAppUnlocked or derives from State.phoneStatus(),
     never re-evaluates the thresholds itself ("never mirror a rule").
     PHONE_UNLOCK_FOLLOWERS / CRYPTO_APP_UNLOCK_CASH are the single source of
     truth for the two numbers §2 fixes — owner-decided, do not re-tune. ---- */
  // V22 (owner item 5): PHONE_UNLOCK_FOLLOWERS no longer gates anything the
  // player can feel — the handset is always available. SOCIAL_UNLOCK_FOLLOWERS
  // is the number that matters now, raised from 300 to 500 by the owner. The
  // old constant is kept because applyPhoneUnlocks() still latches the legacy
  // d.phoneUnlocked flag that old saves carry.
  var PHONE_UNLOCK_FOLLOWERS = 300;      // LEGACY latch only — gates nothing
  var SOCIAL_UNLOCK_FOLLOWERS = 500;     // V22: SOCIAL MEDIA app
  var CRYPTO_APP_UNLOCK_CASH = 20000;    // §2: "cash >= 20000"

  // applyPhoneUnlocks: idempotent OR-latch — once a flag is true it is never
  // written again, so it can never re-lock even if followers/cash falls back
  // below the threshold later (§2: sticky, because crypto holdings persist —
  // losing the app while holding coins would be an unwinnable soft-lock).
  // Called from every path that can move followers or cash: doTick() (so a
  // mid-stream crossing latches immediately, not just at sleep/wake),
  // resolveNewDay() (per-day reconciliation), and normalizeSave() (so a
  // freshly loaded old save that already qualifies latches instantly rather
  // than waiting for the first tick).
  function applyPhoneUnlocks(d) {
    if (!d.phoneUnlocked && (d.followers || 0) >= PHONE_UNLOCK_FOLLOWERS) d.phoneUnlocked = true;
    if (!d.socialAppUnlocked && (d.followers || 0) >= SOCIAL_UNLOCK_FOLLOWERS) d.socialAppUnlocked = true;
    if (!d.cryptoAppUnlocked && (d.cash || 0) >= CRYPTO_APP_UNLOCK_CASH) d.cryptoAppUnlocked = true;

    // V22 (owner item 5): SPONSORS unlocks on signing a team — ANY tier, tier 3
    // counts. Latched rather than live, so leaving a team never hides the app
    // while the player is still holding sponsors they signed through it.
    // `contractSignedTierAtSign` covers a save mid-contract; `bestContractTier`
    // covers one that has already completed a contract and gone free again.
    if (!d.sponsorsAppUnlocked) {
      var signedNow = !!d.myTeamId || (d.contract && d.contract !== 'free');
      var signedBefore = d.contractSignedTierAtSign != null || d.bestContractTier != null;
      if (signedNow || signedBefore) d.sponsorsAppUnlocked = true;
    }
    // A save already holding sponsors must see the app regardless of how it
    // got them — never hide something the player owns.
    if (!d.sponsorsAppUnlocked && (d.sponsors || []).length) d.sponsorsAppUnlocked = true;

    // SPEC-V14 §2 — GRANDFATHER CLAUSE for pre-V14 saves.
    //
    // Gating sponsor OFFERS on d.phoneUnlocked stops any NEW content_posts
    // sponsor arriving before social media exists. It does nothing for a save
    // that ALREADY holds one, and such saves are reachable: `sp_clipfeed`
    // (js/data.js) requires { followers: 0, subscribers: 0, rank: 0 } and
    // carries obligation { type: 'content_posts' }, so a player could sign it
    // at zero followers under the pre-V14 rules.
    //
    // Loading that save after V14 would leave them holding an obligation they
    // physically cannot progress — social media is now behind the phone — so
    // it pays $0, warns on the first weekly tick, and on the second
    // consecutive miss DROPS the sponsor and costs 10 reputation. That is real
    // harm to an existing career, caused entirely by our own new gate.
    //
    // Grandfathering costs nothing and cannot create an unwinnable state: the
    // player demonstrably already earned a content sponsor, so they get the
    // phone that makes it satisfiable. Deliberately chosen over the
    // alternatives — rewriting the obligation would change a sponsor's
    // identity, and dropping the sponsor would take away something paid for,
    // which this project never does.
    // The grandfather clause now targets the SOCIAL app, which is what a
    // content_posts obligation actually needs — V22 moved that gate off the
    // handset (which no longer locks) and onto the app.
    if (!d.socialAppUnlocked) {
      var held = d.sponsors || [];
      for (var i = 0; i < held.length; i++) {
        var ob = held[i] && held[i].obligation;
        if (ob && ob.type === 'content_posts') { d.socialAppUnlocked = true; d.phoneUnlocked = true; break; }
      }
    }
  }

  /* ---- the contextual tutorial system (SPEC-V15-BATCH-C §1) -----------------
     A SECOND, separate mechanism from the existing 8-step onboarding in
     js/tutorial.js (that one stays completely untouched, including its own
     `d.tutorialDone` flag). This one fires short single-card lessons the
     moment a milestone is actually reached, shown once ever, tracked in
     `d.tutorialsSeen`. Consumed by Package C2 (the card UI) and Package C3
     (the interactive first-stream moment) via the three State.* functions
     below — this whole block is their contract; do not change the three
     signatures without re-coordinating both packages.

     Design note: every trigger below is a PURE, LEVEL-CHECK read of current
     `d` state (mirrors applyPhoneUnlocks' own idempotent-latch philosophy)
     rather than edge-detection on a transition — "has the player, right
     now, satisfied this condition" — so State.tutorialPending() is always
     correct the instant it's called (no reconciliation tick has to run
     first for 7 of the 9). Only two conditions (`first_rent`,
     `first_scrim`) cannot be derived purely from currently-live fields (rent
     misses reset, scrimsToday resets nightly) — those latch a small
     dedicated boolean at the exact moment the real event happens
     (applyRent() / State.scrim() below), same pattern as d.phoneUnlocked. */

  // TUTORIAL_PRIORITY: THE single ordered list (SPEC-V15-BATCH-C §1 table).
  // State.tutorialPending() walks this in order and returns the first id
  // that is both unseen and currently triggered — never a second hand-typed
  // copy of this order anywhere else in this file.
  var TUTORIAL_PRIORITY = [
    'elo_climb', 'career_open', 'first_stream', 'aim_stat', 'phone_unlock',
    'first_case', 'first_rent', 'first_scrim', 'sponsor_conflict'
  ];

  // NO_CARD_TUTORIAL_IDS: ids State.tutorialPending() must never hand back
  // to the generic card UI. `first_stream` is spec'd as "Package C3 owns
  // this moment and renders it interactively — do not show a card for it."
  // C3 detects and marks it seen entirely on its own (see js/data.js's
  // Data.tutorials.first_stream comment for the exact contract) — if
  // tutorialPending() ever handed it out, an unseen-but-untriggered-for-a-
  // card id would permanently block every LOWER-priority id behind it the
  // moment it became true, since only one id is ever returned at a time.
  // Skipping it here means it never occupies the queue.
  var NO_CARD_TUTORIAL_IDS = { first_stream: true };

  // goldNovaRankIndex: looks up GOLD NOVA's position in Data().ranks by
  // NAME rather than hardcoding its ELO threshold or tier index a second
  // time — if the rank table is ever retuned, this trigger moves with it
  // automatically ("never mirror a rule").
  function goldNovaRankIndex() {
    var ranks = Data().ranks || [];
    for (var i = 0; i < ranks.length; i++) if (ranks[i].name === 'GOLD NOVA') return i;
    return 1; // defensive fallback if the rank table is ever renamed
  }

  // careerOpenEloThreshold: reuses Data().contracts.t3.require.elo (the
  // ACTUAL lowest-tier signing requirement any org enforces) rather than a
  // second hardcoded "2100" literal — this is also exactly why the copy can
  // honestly say "before any organisation will sign you".
  function careerOpenEloThreshold() {
    var c = Data().contracts;
    return (c && c.t3 && c.t3.require && c.t3.require.elo) || 2100;
  }

  // hasBoughtAimGear: true once the player owns MORE of some aim-stat item
  // than defaultData() started them with — covers both "bought a brand-new
  // aim item" and "bought a second copy of a starter aim item" without a
  // dedicated purchase-event flag, since d.owned quantities only ever grow
  // (State.buyItem never decrements on replace) and Data.defaultOwned is
  // the single source of truth for what a fresh save starts with (every
  // starter item — desk_ikea, pc_budget, chair_wooden, monitor_basic —
  // already carries an `aim` stat, so a raw "owns an aim item" check would
  // incorrectly read true from turn one).
  function hasBoughtAimGear(d) {
    var shop = Data().shopItems || [];
    var defaults = Data().defaultOwned || {};
    var owned = d.owned || {};
    for (var i = 0; i < shop.length; i++) {
      var it = shop[i];
      if (!it.stats || !it.stats.aim) continue;
      if ((owned[it.id] || 0) > (defaults[it.id] || 0)) return true;
    }
    return false;
  }

  // tutorialConditionMet: pure — does NOT read/write d.tutorialsSeen, only
  // "is this milestone true right now". State.tutorialPending() is what
  // combines this with the seen-check and priority order.
  function tutorialConditionMet(id, d) {
    switch (id) {
      case 'elo_climb': return rankFromElo(d.elo || 0).tier >= goldNovaRankIndex();
      case 'career_open': return (d.elo || 0) >= careerOpenEloThreshold();
      case 'first_stream': return (d.stats && d.stats.streams || 0) >= 1; // not returned via NO_CARD_TUTORIAL_IDS, kept for State.tutorialSeen() consumers / tests
      case 'aim_stat': return hasBoughtAimGear(d);
      // V22 (owner item 5): fires on the SOCIAL app installing, not on the
      // handset — which no longer locks. The id stays `phone_unlock` because
      // it is a d.tutorialsSeen save key; see Data.tutorials for the wording.
      case 'phone_unlock': return !!d.socialAppUnlocked;
      case 'first_case': return (d.stats && d.stats.casesOpened || 0) >= 1;
      case 'first_rent': return !!d.rentEverCharged;
      case 'first_scrim': return !!d.scrimEverCompleted;
      case 'sponsor_conflict': return (d.sponsors || []).length > 0 && !!(d.staff && d.staff.coachId);
      default: return false;
    }
  }

  // State.tutorialSeen(id) -> bool. Raw check, NOT subject to the
  // suppression rules below (Package C3 relies on this being unconditional
  // — it decides for itself when to check/mark `first_stream`).
  State.tutorialSeen = function (id) {
    var d = State.data;
    return !!(d && d.tutorialsSeen && d.tutorialsSeen[id]);
  };

  // State.markTutorialSeen(id) -> records it, commits. Idempotent — marking
  // an already-seen id again is a harmless no-op write.
  State.markTutorialSeen = function (id) {
    var d = State.data;
    if (!d) return false;
    if (!d.tutorialsSeen) d.tutorialsSeen = {};
    d.tutorialsSeen[id] = true;
    commit();
    return true;
  };

  // State.tutorialPending() -> the highest-priority unseen TRIGGERED id, or
  // null. Suppressed to null outright (SPEC-V15-BATCH-C §1 "Do not fire a
  // tutorial during") while: the existing 8-step onboarding hasn't finished
  // (`!d.tutorialDone` — see js/tutorial.js's own header comment for how
  // that flag is tracked), asleep, the move-out packing flow, or a live
  // stream (`d.streaming`, set by Package C3 — see its comment in
  // defaultData()). A dead (career-over) save is also suppressed — it's
  // view-only everywhere else in this file, so a tutorial card popping up
  // over it would be a first for that state. Cheap and pure — safe to call
  // every render tick, exactly like State.phoneStatus().
  State.tutorialPending = function () {
    var d = State.data;
    if (!d || d.dead) return null;
    // NOTE (owner playtest): this used to also `return null` while
    // `!d.tutorialDone`. That gate had the WRONG SEMANTICS — it asks "has the
    // 8-step onboarding ever been COMPLETED?", when the only real concern is
    // "is that overlay on screen RIGHT NOW?".
    //
    // The difference is not academic. GOLD NOVA is only 250 ELO (a handful of
    // matches), so a player who has not yet finished or skipped the onboarding
    // reliably crosses that milestone while `tutorialDone` is still false —
    // and `elo_climb` was silently swallowed. Reloading the save later
    // completed the onboarding, flipped the flag, and the (state-derived,
    // still-true) trigger fired then, which is exactly the "it only appeared
    // after I reopened the save" report.
    //
    // The on-screen collision is a PRESENTATION concern and is now handled
    // where the overlay actually lives: js/tutorial.js guards on its own
    // `active` flag before opening a card. state.js has no way to know
    // whether that overlay is currently visible, so it must not pretend to.
    if (d.asleep) return null;
    if (d.moving) return null;
    if (d.streaming) return null;
    for (var i = 0; i < TUTORIAL_PRIORITY.length; i++) {
      var id = TUTORIAL_PRIORITY[i];
      if (NO_CARD_TUTORIAL_IDS[id]) continue;
      if (State.tutorialSeen(id)) continue;
      if (tutorialConditionMet(id, d)) return id;
    }
    return null;
  };

  /* ---- sponsors (SPEC-V8 SPONSORS §1-4) -------------------------------------
     A second master competing with the coach for the player's daily energy:
     the coach wants scrims, the sponsor wants stream time/wins. Offers scout
     the player on a track SEPARATE from team `offers` (§1), gated by
     followers/subscribers/the signed team's leaderboard rank, arriving one
     at a time (never batched) exactly like team offers already do. Up to
     MAX_HELD_SPONSORS may be held at once; each carries exactly one
     obligation (§2), refreshed and paid on the SAME tick as the subscriber
     payout (§3) — deliberately reusing Data().subscriberPayoutInterval
     directly, with NO per-save day offset (that trick belongs to rent
     alone — see applyRent's comment — sponsors are meant to land WITH the
     subscriber payout, not dodge it). Missing an obligation warns once,
     then drops the sponsor and costs reputation (§3, reuses the SPEC-V5
     §12r system). All persisted at d.sponsors/d.sponsorOffers/etc. — see the
     SPEC-V8 defaultData() block for the exact shapes; every field there
     MUST stay in sync with what's read/written below. */
  var MAX_HELD_SPONSORS = 3;                 // §1: "hold up to 3 sponsors at once"
  var MAX_OPEN_SPONSOR_OFFERS = 3;           // inbox cap, mirrors MAX_OPEN_OFFERS for team offers
  var SPONSOR_OFFER_EXPIRY_SLEEPS = 5;       // mirrors OFFER_EXPIRY_SLEEPS for team offers
  var SPONSOR_OFFER_MIN_GAP_DAYS = 2;        // §1: "arrive gradually over days" — mirrors OFFER_MIN/MAX_GAP_DAYS
  var SPONSOR_OFFER_MAX_GAP_DAYS = 5;
  var SPONSOR_DROP_REPUTATION_PENALTY = 10;  // §3: "-10, tune if it feels wrong next to the -25 for leaving a team"
  var SPONSOR_AT_RISK_DAYS_THRESHOLD = 2;    // §4: flag "at risk" this many days out from the payout tick, unmet

  function findSponsorDef(id) {
    var list = Data().sponsors || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // sponsorWeekInfo: single source of truth for "where are we in the shared
  // weekly cycle" — reused by both applySponsorPayout() (the actual tick)
  // and State.sponsorsStatus() (the displayed countdown), so the number
  // shown to the player can never drift from the day it's actually
  // resolved on. Mirrors rentDayMod()/rentDueInSleeps()'s role for rent,
  // MINUS the per-save offset (§3: sponsors ride the subscriber payout's
  // cadence exactly, unlike rent which deliberately avoids it).
  function sponsorWeekInfo(d) {
    var interval = Data().subscriberPayoutInterval || 7;
    var dayMod = d.day % interval;
    var daysLeft = dayMod === 0 ? 0 : interval - dayMod; // sleeps from "now" (pre-sleep) until the next payout tick
    return { interval: interval, dayMod: dayMod, daysLeft: daysLeft, nextPayoutDay: d.day + daysLeft };
  }

  // playerLeaderboardRankForSponsors: sponsors gate on "leaderboard rank"
  // (§1) — the signed team's rank on the 100-team board (SPEC-V4 §5a), same
  // meaning as everywhere else `rank` is used in this file. A free agent
  // has no team rank, so `requires.rank` gates simply never pass for one —
  // consistent with "bigger sponsors want a player already proving
  // themselves on a real roster."
  function playerLeaderboardRankForSponsors(d) {
    if (!d.myTeamId) return null;
    var pub = teamPublic(d, d.myTeamId);
    return pub ? pub.rank : null;
  }

  function sponsorRequirementsMet(d, req) {
    if (!req) return true;
    if (req.followers && (d.followers || 0) < req.followers) return false;
    if (req.subscribers && (d.subscribers || 0) < req.subscribers) return false;
    if (req.rank) {
      var rank = playerLeaderboardRankForSponsors(d);
      if (rank == null || rank > req.rank) return false; // lower rank number is better
    }
    return true;
  }

  // currentTeamTierForSponsor: signed-team tier (1/2/3) for the sponsor pay
  // formula's tierBoost, or null for a free agent. Derives from d.contract
  // (already kept in sync with the signed team's tier at signing/refresh —
  // see acceptContractOffer/refreshMyTeamState) rather than re-deriving a
  // second copy of that mapping.
  function currentTeamTierForSponsor(d) {
    if (d.contract === 't1') return 1;
    if (d.contract === 't2') return 2;
    if (d.contract === 't3') return 3;
    return null;
  }

  // makeSponsorOffer (SPEC-V15 §4): pay is computed ONCE here, when the offer
  // is generated, via Data.sponsorPayFor() (the single source of truth for
  // the progress-scaling formula) and frozen onto the offer. State.accept
  // SponsorOffer() below copies this frozen `pay` straight onto the held
  // sponsor — it is never recomputed again, so a signed sponsor's pay can
  // never silently drift week to week even as ELO/tier keep changing.
  function makeSponsorOffer(d, def) {
    var tier = currentTeamTierForSponsor(d);
    var payFn = Data().sponsorPayFor;
    var pay = payFn ? payFn(def.pay, d.elo || 0, tier) : def.pay;
    return { id: genId(), sponsorId: def.id, pay: pay, createdDay: d.day, expiresAtDay: d.day + SPONSOR_OFFER_EXPIRY_SLEEPS };
  }

  // tryGenerateSponsorOffers: called every resolveNewDay(), same as
  // tryGenerateOffers() for teams — trickles ONE sponsor offer in at a time,
  // every few real days, entirely independent of the team-offer roll (§1:
  // "a separate track from team offers"). Stops rolling once held sponsors
  // are already at the cap, same spirit as tryGenerateOffers() stopping once
  // the inbox is full.
  function tryGenerateSponsorOffers(d) {
    /* Sponsors are reachable only through the SPONSORS app, so an offer
       landing before that app exists would be unreachable — the whole track
       stays shut until it does.

       V22 (owner item 5) re-pointed this from d.phoneUnlocked (the handset,
       which no longer locks at all) to d.sponsorsAppUnlocked (signing a team,
       any tier). That is a STRICTER gate than the old 300-follower one for
       most careers, which is the intent: sponsors turning up before you have
       a team never made sense.

       The second half of the old rule still holds by construction — a
       content_posts obligation only enters play riding an offer from the
       catalog below, so gating offers also gates that obligation. It now
       waits on the social app instead, checked separately just below, because
       signing a team no longer implies the social app is open. */
    if (!d.sponsorsAppUnlocked) return;
    if (!d.sponsors) d.sponsors = [];
    if (!d.sponsorOffers) d.sponsorOffers = [];
    d.sponsorOffers = d.sponsorOffers.filter(function (o) { return o.expiresAtDay >= d.day; });
    if (d.sponsors.length >= MAX_HELD_SPONSORS) return;
    if (d.sponsorOffers.length >= MAX_OPEN_SPONSOR_OFFERS) return;
    if (d.day < (d.nextSponsorOfferEligibleDay || 0)) return;
    var heldIds = {}, openIds = {};
    d.sponsors.forEach(function (s) { heldIds[s.sponsorId] = 1; });
    d.sponsorOffers.forEach(function (o) { openIds[o.sponsorId] = 1; });
    var candidates = [];
    var catalog = Data().sponsors || [];
    for (var i = 0; i < catalog.length; i++) {
      var sp = catalog[i];
      if (heldIds[sp.id] || openIds[sp.id]) continue;
      // V22 (owner item 5): a content_posts sponsor needs the SOCIAL app to be
      // fulfillable at all. Signing a team opens SPONSORS but not SOCIAL, so
      // this is now its own check rather than something the offer gate above
      // implied. Without it a player could sign an obligation they physically
      // cannot progress — exactly the harm the V14 grandfather clause exists
      // to undo, and there is no sense creating fresh instances of it.
      if (sp.obligation && sp.obligation.type === 'content_posts' && !d.socialAppUnlocked) continue;
      if (sponsorRequirementsMet(d, sp.requires)) candidates.push(sp);
    }
    // Always reschedule, win or lose this roll, so a dry spell doesn't retry
    // every single sleep (mirrors tryGenerateOffers()'s own comment/logic).
    d.nextSponsorOfferEligibleDay = d.day + randInt(SPONSOR_OFFER_MIN_GAP_DAYS, SPONSOR_OFFER_MAX_GAP_DAYS);
    if (!candidates.length) return;
    candidates.sort(function () { return Math.random() - 0.5; });
    d.sponsorOffers.push(makeSponsorOffer(d, candidates[0])); // one at a time, never two at once
  }

  State.sponsorOffers = function () {
    var d = State.data;
    d.sponsorOffers = (d.sponsorOffers || []).filter(function (o) { return o.expiresAtDay >= d.day; });
    return d.sponsorOffers.map(function (o) {
      var def = findSponsorDef(o.sponsorId);
      // o.pay is the FROZEN pay computed at generation time (SPEC-V15 §4);
      // only a legacy offer saved before this existed falls back to the
      // live catalog value (normalizeSave backfills these on load anyway).
      var pay = (o.pay != null) ? o.pay : (def ? def.pay : 0);
      return {
        id: o.id, sponsorId: o.sponsorId, name: def ? def.name : '???', pay: pay,
        obligation: def ? def.obligation : null, desc: def ? def.desc : '',
        createdDay: o.createdDay, expiresAtDay: o.expiresAtDay
      };
    });
  };

  // State.acceptSponsorOffer(): moves an open offer into the held roster
  // (§1). Refuses once the 3-sponsor cap is hit — the UI is expected to
  // surface that before the player even tries (owner's note, SPEC-V8 §1:
  // raise the energy ceiling before ever cutting this limit).
  State.acceptSponsorOffer = function (offerId) {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    if (!d.sponsors) d.sponsors = [];
    if (d.sponsors.length >= MAX_HELD_SPONSORS) return { ok: false, reason: 'sponsor-slots-full' };
    var offers = d.sponsorOffers || [];
    var idx = -1;
    for (var i = 0; i < offers.length; i++) if (offers[i].id === offerId) { idx = i; break; }
    if (idx === -1) return { ok: false, reason: 'not-found' };
    var offer = offers[idx];
    if (offer.expiresAtDay < d.day) { offers.splice(idx, 1); commit(); return { ok: false, reason: 'expired' }; }
    var def = findSponsorDef(offer.sponsorId);
    if (!def) { offers.splice(idx, 1); commit(); return { ok: false, reason: 'invalid-sponsor' }; }
    offers.splice(idx, 1);
    // pay carries over from the offer's FROZEN value (SPEC-V15 §4) — never
    // def.pay directly, so accepting later never re-rolls the pay the player
    // was actually shown.
    var pay = (offer.pay != null) ? offer.pay : def.pay;
    // V22 (owner item 1): a sponsor signs for a FIXED TERM and then leaves,
    // freeing the slot for a better one. Rolled per signing so three sponsors
    // accepted the same week don't all expire the same week. Stored as a week
    // COUNT plus the day it was signed rather than an absolute end-day: the
    // weekly tick is derived from d.day % subscriberPayoutInterval, and an
    // absolute day stored here would drift away from that boundary the moment
    // anything touched the payout interval.
    var termWeeks = randInt(
      (Data().sponsorTermWeeksMin || 1),
      (Data().sponsorTermWeeksMax || 3)
    );
    var held = {
      id: genId(), sponsorId: def.id, name: def.name, pay: pay,
      obligation: { type: def.obligation.type, amount: def.obligation.amount },
      progress: 0, warned: false, acquiredDay: d.day,
      termWeeks: termWeeks, weeksServed: 0
    };
    d.sponsors.push(held);
    commit();
    return { ok: true, sponsor: held };
  };

  State.declineSponsorOffer = function (offerId) {
    var d = State.data;
    d.sponsorOffers = (d.sponsorOffers || []).filter(function (o) { return o.id !== offerId; });
    commit();
    return { ok: true };
  };

  // sponsorsAdvanceProgress: the shared bump helper for obligation types
  // that just need "+= amount" (match_wins). stream_days/stream_minutes are
  // driven separately below (recordSponsorStreamSession) since stream_days
  // needs distinct-day dedupe, not a plain increment.
  function sponsorsAdvanceProgress(d, type, amount) {
    var list = d.sponsors || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.obligation && s.obligation.type === type) {
        s.progress = Math.min(s.obligation.amount, (s.progress || 0) + amount);
      }
    }
  }

  // recordSponsorStreamSession: called from State.applyStreamResult() every
  // time a stream session completes. Advances BOTH stream obligation types
  // in one pass: `stream_days` counts distinct calendar days (so 3 streams
  // in one day is still only 1 day of progress — you cannot cheese "3 days"
  // by spamming sessions), `stream_minutes` accumulates real session length.
  //
  // UNIT: SECONDS. The `stream_minutes` obligation id is a legacy save key
  // that no longer describes its unit — it used to demand real wall-clock
  // minutes, up to four hours a week, which is not a thing anyone would sit
  // through. See Data.sponsorObligationTypes in js/data.js. Pass seconds.
  //
  // durationSeconds is OPTIONAL; stream_days progress works without it, since
  // it only needs "a stream happened today," which this is always called with.
  function recordSponsorStreamSession(d, durationSeconds) {
    if (!d.sponsorStreamDaysThisWeek) d.sponsorStreamDaysThisWeek = [];
    if (d.sponsorStreamDaysThisWeek.indexOf(d.day) === -1) d.sponsorStreamDaysThisWeek.push(d.day);
    var daysCount = d.sponsorStreamDaysThisWeek.length;
    var list = d.sponsors || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s.obligation) continue;
      if (s.obligation.type === 'stream_days') {
        s.progress = Math.min(s.obligation.amount, daysCount);
      } else if (s.obligation.type === 'stream_minutes' && durationSeconds > 0) {
        s.progress = Math.min(s.obligation.amount, (s.progress || 0) + durationSeconds);
      }
    }
  }

  // recordSponsorMatchWin: called from State.playMatch() whenever a SIGNED
  // (official, §3) match is won. Free-agent PLAY never counts — matches the
  // module's own existing "PLAY only grants ELO until signed" comment.
  function recordSponsorMatchWin(d) {
    sponsorsAdvanceProgress(d, 'match_wins', 1);
  }

  // recordSponsorContentPost (SPEC-V9 §6): called from createSocialPost()
  // below for EVERY post — player-authored (State.postContent) or manager
  // auto-posted (applyManagerAutoPosts) alike. Counting the manager's output
  // toward this is deliberate: it's the same "pressure valve" role SPEC-V9
  // §4 gives managers for a player who can't personally hit every weekly ask.
  function recordSponsorContentPost(d) {
    sponsorsAdvanceProgress(d, 'content_posts', 1);
  }

  // applySponsorPayout: runs on the SAME tick as applySubscriberPayout (§3),
  // called right after it in resolveNewDay. For each held sponsor: if this
  // week's obligation was met, pay out and reset the week clean; if not,
  // warn the first time (no payout, one more chance) or drop the sponsor
  // the second consecutive time (no payout, reputation hit, slot freed) —
  // exactly the two-stage failure path in §3. A sponsor that succeeds after
  // a warning has its `warned` flag cleared, so the two misses that cause a
  // drop must be consecutive, mirroring how a single good week earns back
  // trust in a real sponsorship.
  function applySponsorPayout(d, summary) {
    summary.sponsorPayout = { due: false, paid: 0, warned: [], dropped: [], expired: [] };
    var info = sponsorWeekInfo(d);
    if (info.dayMod !== 0) return;
    summary.sponsorPayout.due = true;
    if (!d.sponsors) d.sponsors = [];
    var kept = [];
    for (var i = 0; i < d.sponsors.length; i++) {
      var s = d.sponsors[i];
      var met = (s.progress || 0) >= s.obligation.amount;
      if (met) {
        d.cash += s.pay;
        summary.sponsorPayout.paid += s.pay;
        s.progress = 0;
        s.warned = false;
        /* V22 (owner item 1): the term is served in WEEKS COMPLETED, counted
           here — this is the one tick that means "another week finished".

           Counted only on a week the player was PAID, deliberately. A warned
           week is one the sponsor considers unserved; letting it burn down the
           term would let a player park a sponsor they have no intention of
           satisfying and have it quietly expire instead of dropping them, which
           is a strictly better outcome for failing. Miss twice and the drop
           branch below still takes it, reputation hit and all.

           Expiry is checked AFTER the payout is banked, so a sponsor always
           pays for the final week it was owed. Ending a contract must never be
           a way to dodge the last cheque. */
        s.weeksServed = (s.weeksServed || 0) + 1;
        var term = s.termWeeks || 0;
        if (term > 0 && s.weeksServed >= term) {
          summary.sponsorPayout.expired.push({ id: s.id, name: s.name, weeks: term });
          if (window.Game.UI) {
            window.Game.UI.toast(s.name + ' CONTRACT ENDED — THE SLOT IS FREE', 'good');
          }
          continue; // not kept: the slot frees, with no reputation penalty
        }
        kept.push(s);
      } else if (!s.warned) {
        s.warned = true;
        s.progress = 0;
        summary.sponsorPayout.warned.push({ id: s.id, name: s.name });
        if (window.Game.UI) window.Game.UI.toast(s.name + ' IS WARNING YOU — OBLIGATION MISSED. MISS AGAIN AND THEY DROP YOU.', 'bad');
        kept.push(s);
      } else {
        applyReputationChange(d, -SPONSOR_DROP_REPUTATION_PENALTY);
        summary.sponsorPayout.dropped.push({ id: s.id, name: s.name });
        if (window.Game.UI) window.Game.UI.toast(s.name + ' DROPPED YOU FOR MISSING THE OBLIGATION AGAIN', 'bad');
        // not pushed to `kept` — the slot frees automatically (§3)
      }
    }
    d.sponsors = kept;
    d.sponsorStreamDaysThisWeek = []; // fresh week: distinct-day dedupe resets
    d.sponsorWeekStartDay = d.day;
  }

  // State.sponsorsStatus(): everything §4 requires the UI be able to show at
  // a glance — held sponsors with live progress, days left in the week,
  // pay, next payout day, and an at-risk flag that fires BEFORE the payout
  // tick (not after), so the player can still act on it. at-risk is true
  // once a sponsor already carries a warning (one more miss drops it, ANY
  // day left) or once the week is running out (<= SPONSOR_AT_RISK_DAYS_
  // THRESHOLD days left) with the obligation still unmet.
  State.sponsorsStatus = function () {
    var d = State.data;
    var info = sponsorWeekInfo(d);
    var held = (d.sponsors || []).map(function (s) {
      var amount = s.obligation.amount || 0;
      var progress = s.progress || 0;
      var met = progress >= amount;
      var atRisk = !met && (s.warned || info.daysLeft <= SPONSOR_AT_RISK_DAYS_THRESHOLD);
      return {
        id: s.id, sponsorId: s.sponsorId, name: s.name, pay: s.pay,
        obligation: {
          type: s.obligation.type, amount: amount, progress: progress, met: met,
          pct: amount > 0 ? clamp(progress / amount, 0, 1) : 1
        },
        warned: !!s.warned, atRisk: atRisk,
        daysLeftInWeek: info.daysLeft, nextPayoutDay: info.nextPayoutDay,
        // V22 (owner item 1): the fixed term, surfaced so the player can see a
        // slot coming free rather than being surprised by it. A legacy save's
        // sponsors carry no termWeeks — they report null and run forever,
        // exactly as they did before, instead of being retro-expired out from
        // under a career that never agreed to a term.
        termWeeks: s.termWeeks || null,
        weeksServed: s.weeksServed || 0,
        weeksLeft: s.termWeeks ? Math.max(0, s.termWeeks - (s.weeksServed || 0)) : null,
        finalWeek: !!s.termWeeks && (s.termWeeks - (s.weeksServed || 0)) <= 1
      };
    });
    return {
      held: held, slotsUsed: held.length, slotsMax: MAX_HELD_SPONSORS,
      daysLeftInWeek: info.daysLeft, nextPayoutDay: info.nextPayoutDay
    };
  };

  /* ---- social media (SPEC-V9 SOCIAL §1-4) -----------------------------------
     A THIRD master (with the coach/scrims and sponsors/stream-time) for the
     player's daily energy — §5's whole point is that this competition is
     never allowed to become slack. Three platforms (Data.socialPlatforms),
     each with its own follower count; posting is a player action that costs
     energy NOW and pays out FOLLOWERS LATER, spread over Data.socialDripDays
     days (§2) via a per-post "drip" entry applied one slice per wake
     (applySocialDrip, called from resolveNewDay). A hired social manager
     (Data.socialManagers, §4) auto-posts for free at their guaranteed
     per-day rate (SPEC-V15 §5, applyManagerAutoPosts), the exact same
     pressure-valve role moderators
     play for chat. Ad revenue pays out on the EXISTING subscriber-payout
     tick (§3, applySocialAdRevenue) — never a fourth cadence. ------------- */

  function totalSocialFollowers(d) {
    ensureSocial(d);
    var total = 0;
    for (var k in d.social.followers) total += d.social.followers[k] || 0;
    return total;
  }

  // refreshSocialUnlocks: unlocks are permanent once crossed (followers only
  // ever go up) — gates on the SUM across all platforms (§1), not any single
  // platform's own count.
  function refreshSocialUnlocks(d) {
    ensureSocial(d);
    var total = totalSocialFollowers(d);
    var plats = Data().socialPlatforms || [];
    for (var i = 0; i < plats.length; i++) {
      var p = plats[i];
      if (!d.social.unlocked[p.id] && total >= p.unlockFollowers) d.social.unlocked[p.id] = true;
    }
  }

  // distributeDrip: splits `total` into `days` integer daily shares that sum
  // back to EXACTLY `total` (no rounding leakage) — the last day absorbs
  // whatever floor() left behind.
  function distributeDrip(total, days) {
    var arr = [];
    var remaining = total;
    for (var i = 0; i < days; i++) {
      var share = (i === days - 1) ? remaining : Math.floor(total / days);
      remaining -= share;
      arr.push(share);
    }
    return arr;
  }

  // createSocialPost: shared by State.postContent() (player, costs energy)
  // and applyManagerAutoPosts() (manager, free) — §2/§3: rolls this post's
  // total eventual follower gain (scaled by `qualityMult`, 1.0 for the
  // player, a manager's `quality` 0.6/0.8/1.0 otherwise), applies the ~4%
  // virality roll (8-15x), then files it as a fresh drip that starts paying
  // out on the NEXT wake (never this one — posting is an investment, §2).
  // Every post — player or manager — advances any held CONTENT_POSTS
  // sponsor obligation (§6).
  function createSocialPost(d, platformId, qualityMult) {
    ensureSocial(d);
    var pdef = socialPlatformDef(platformId);
    if (!pdef) return null;
    var base = rand(pdef.followerGainMin, pdef.followerGainMax) * (qualityMult || 1);
    var viralChance = Data().socialViralityChance || 0.04;
    var viral = Math.random() < viralChance;
    if (viral) {
      base *= rand(Data().socialViralityMultMin || 8, Data().socialViralityMultMax || 15);
    }
    var total = Math.max(0, Math.round(base));
    var days = Data().socialDripDays || 3;
    d.social.drips.push({ platform: platformId, remaining: distributeDrip(total, days), viral: viral });
    d.social.postsThisWeek[platformId] = (d.social.postsThisWeek[platformId] || 0) + 1;
    recordSponsorContentPost(d);
    return { platform: platformId, totalGain: total, viral: viral, dripDays: days };
  }

  // applySocialDrip: called every resolveNewDay (once per wake, §2) — pays
  // out ONE day's slice from every pending drip (oldest and newest posts
  // alike, one slice each) and drops any drip that's fully paid out. This is
  // the mechanism behind "skipping a day has a delayed cost": a day with no
  // NEW post still receives whatever earlier posts already owe it, so the
  // shortfall is only felt a few days later when the pipeline runs dry.
  function applySocialDrip(d, summary) {
    ensureSocial(d);
    var applied = {};
    var kept = [];
    for (var i = 0; i < d.social.drips.length; i++) {
      var drip = d.social.drips[i];
      var amt = drip.remaining.length ? drip.remaining.shift() : 0;
      if (amt > 0) {
        d.social.followers[drip.platform] = (d.social.followers[drip.platform] || 0) + amt;
        applied[drip.platform] = (applied[drip.platform] || 0) + amt;
      }
      if (drip.remaining.length > 0) kept.push(drip);
    }
    d.social.drips = kept;
    refreshSocialUnlocks(d);
    summary.socialDrip = applied;
  }

  // applyManagerAutoPosts: §4, converted by SPEC-V15 §5 — the hired manager
  // posts to Data.socialManagerPlatformId ('clips', always unlocked from day
  // one) a GUARANTEED `postsPerDay` times EVERY day, costing the player zero
  // energy. No more weekly quota/probabilistic roll: each of the
  // `postsPerDay` posts feeds the same daily drip pipeline a player's own
  // posting would, one at a time.
  function applyManagerAutoPosts(d, summary) {
    ensureSocial(d);
    summary.socialAutoPosts = [];
    var mgrDef = socialManagerDef(d.social.managerId);
    if (!mgrDef) return;
    var platformId = Data().socialManagerPlatformId || 'clips';
    if (!d.social.unlocked[platformId]) return;
    var postsToday = mgrDef.postsPerDay || 0;
    for (var i = 0; i < postsToday; i++) {
      var res = createSocialPost(d, platformId, mgrDef.quality);
      if (res) summary.socialAutoPosts.push(res);
    }
  }

  // applySocialAdRevenue: §3 — pays out on the SAME tick as
  // applySubscriberPayout/applySponsorPayout (Data().subscriberPayoutInterval,
  // never a separate cadence), at Data.socialAdRevenuePerFollower per TOTAL
  // social follower. Also resets the weekly postsThisWeek counters here,
  // same tick sponsors/subscribers already treat as "the start of a new
  // week."
  function applySocialAdRevenue(d, summary) {
    ensureSocial(d);
    summary.socialAdRevenue = { due: false, paid: 0, followers: 0 };
    var interval = Data().subscriberPayoutInterval || 7;
    if (d.day % interval !== 0) return;
    var total = totalSocialFollowers(d);
    var paid = Math.round(total * (Data().socialAdRevenuePerFollower || 0) * 100) / 100;
    d.cash += paid;
    summary.socialAdRevenue = { due: true, paid: paid, followers: total };
    var plats = Data().socialPlatforms || [];
    for (var i = 0; i < plats.length; i++) d.social.postsThisWeek[plats[i].id] = 0;
  }

  // State.postContent(): the player action (§2). Costs the platform's own
  // energyCost NOW; the follower payoff is filed as a drip and arrives over
  // the following Data.socialDripDays wakes, never instantly.
  State.postContent = function (platformId) {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    ensureSocial(d);
    var pdef = socialPlatformDef(platformId);
    if (!pdef) return { ok: false, reason: 'invalid' };
    if (!d.social.unlocked[platformId]) return { ok: false, reason: 'locked' };
    if (!State.useEnergy(pdef.energyCost)) return { ok: false, reason: 'energy' };
    var res = createSocialPost(d, platformId, 1);
    commit();
    return {
      ok: true, platform: platformId, energyCost: pdef.energyCost,
      totalGain: res.totalGain, viral: res.viral, dripDays: res.dripDays
    };
  };

  // State.socialStatus(): everything the UI (Package B2) needs at a glance —
  // per-platform follower counts/unlock state/energy cost/pending drip/this
  // week's post count, the hired manager, and a projected weekly ad revenue
  // figure (computed off CURRENT followers — the actual payout at the next
  // tick will differ slightly as more drip lands between now and then).
  State.socialStatus = function () {
    var d = State.data;
    ensureSocial(d);
    var plats = Data().socialPlatforms || [];
    var platforms = plats.map(function (p) {
      var pendingDrip = 0;
      for (var i = 0; i < d.social.drips.length; i++) {
        var drip = d.social.drips[i];
        if (drip.platform !== p.id) continue;
        for (var j = 0; j < drip.remaining.length; j++) pendingDrip += drip.remaining[j];
      }
      return {
        id: p.id, name: p.name, unlocked: !!d.social.unlocked[p.id],
        unlockFollowers: p.unlockFollowers, followers: d.social.followers[p.id] || 0,
        energyCost: p.energyCost, postsThisWeek: d.social.postsThisWeek[p.id] || 0,
        pendingDrip: pendingDrip
      };
    });
    var mgrDef = socialManagerDef(d.social.managerId);
    var interval = Data().subscriberPayoutInterval || 7;
    var dayMod = d.day % interval;
    var totalFollowers = totalSocialFollowers(d);
    return {
      totalFollowers: totalFollowers,
      platforms: platforms,
      manager: mgrDef ? {
        id: mgrDef.id, name: mgrDef.name, postsPerDay: mgrDef.postsPerDay,
        quality: mgrDef.quality, hire: mgrDef.hire, upkeep: mgrDef.upkeep
      } : null,
      projectedWeeklyAdRevenue: Math.round(totalFollowers * (Data().socialAdRevenuePerFollower || 0) * 100) / 100,
      daysUntilAdPayout: dayMod === 0 ? 0 : interval - dayMod
    };
  };

  /* ---- social media managers (SPEC-V9 §4) — mirrors State.hireCoach/
     hireMod/fireCoach/fireMod exactly: one at a time, hiring a different one
     replaces the current hire outright (no refund), upkeep/auto-quit logic
     lives in applyStaffUpkeep() (extended below), run every resolveNewDay. */
  State.hireSocialManager = function (id) {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    ensureSocial(d);
    var def = socialManagerDef(id);
    if (!def) return { ok: false, reason: 'invalid' };
    if (d.social.managerId === id) return { ok: false, reason: 'already-hired' };
    if (!State.spend(def.hire)) return { ok: false, reason: 'cash' };
    d.social.managerId = id;
    commit();
    return { ok: true, manager: def };
  };

  State.fireSocialManager = function () {
    var d = State.data;
    ensureSocial(d);
    if (!d.social.managerId) return false;
    d.social.managerId = null;
    commit();
    return true;
  };

  State.currentSocialManager = function () {
    ensureSocial(State.data);
    return socialManagerDef(State.data.social.managerId);
  };

  /* ---- scrims quota + coach behaviour (SPEC-V5 §18) -------------------------
     Wraps the raw d.scrimsToday counter with the hired coach's behaviour:
     L1 'remind' adds no credit (State.sleepWarning() below is what surfaces
     the prompt); L2 'gradual' grants credit ramping 0 -> quota across the
     day, fully topped up by nightfall (NIGHT_START_MS); L3 'auto' always
     reports the quota met. No coach hired: raw progress only. */
  function effectiveScrimQuota(d) {
    if (d.contract === 'free') return { quota: 0, progress: 0, met: true, coachBehavior: null };
    var quota = (Data().contracts[d.contract] || {}).quota || 0;
    var coachDef = staffCoachDef(d.staff.coachId);
    var behavior = coachDef ? coachDef.scrimBehavior : null;
    var progress = d.scrimsToday || 0;
    if (behavior === 'auto') {
      progress = quota;
    } else if (behavior === 'gradual') {
      var frac = clamp((d.wakeElapsedMs || 0) / NIGHT_START_MS, 0, 1);
      progress = Math.max(progress, Math.round(quota * frac));
    }
    progress = Math.min(progress, quota);
    return { quota: quota, progress: progress, met: quota <= 0 || progress >= quota, coachBehavior: behavior };
  }
  State.scrimQuotaStatus = function () {
    var d = State.data;
    var eq = effectiveScrimQuota(d);
    // SPEC-V6 §25: misses are now CUMULATIVE for the whole contract (was
    // consecutive-days) — field name kept (extend, don't rename). Exposes
    // a warning level so the UI can flag it at 1 and 2 misses (kicked at 3).
    var misses = d.consecutiveScrimMisses || 0;
    eq.consecutiveMisses = misses; // legacy name kept for compat
    eq.contractMisses = misses;    // clearer new name for the same value
    eq.warningLevel = misses;      // 0 = none, 1 or 2 = warn, 3 would mean already kicked
    return eq;
  };
  // State.sleepWarning(): the L1 ROOKIE COACH reminder — true when the
  // player is signed, has a coach that only reminds (doesn't fill), and
  // hasn't hit the quota yet. UI calls this before State.sleep() to decide
  // whether to prompt "ARE YOU SURE?" first.
  State.sleepWarning = function () {
    var d = State.data;
    if (d.contract === 'free') return { warn: false };
    var eq = effectiveScrimQuota(d);
    return { warn: eq.coachBehavior === 'remind' && !eq.met, quota: eq.quota, progress: eq.progress };
  };

  // resolveNewDay: the shared "a night's sleep just resolved" body — this IS
  // what SPEC-V2's endDay() used to do in full (salary/rent/staff
  // upkeep/day+1/form reset/scrim quota), PLUS the SPEC-V3 §13 subscriber
  // payout (idle income is gone — see applySubscriberPayout below), now also
  // resetting the real-time
  // clock (wakeElapsedMs/asleep/sleepGained) back to a fresh morning (§3
  // step 4). Does NOT touch d.energy — callers decide that (real wake()
  // leaves whatever energy was actually regenerated; the legacy endDay()
  // alias forces it to full to match old V1/V2 behaviour exactly).
  function resolveNewDay(d, summary) {
    // SPEC-V14 §2: per-day reconciliation latch, redundant with doTick()'s
    // per-tick call by design (defense in depth — a day can turn over via
    // more than one path) but idempotent, so calling it twice is harmless.
    applyPhoneUnlocks(d);
    var signed = d.contract !== 'free';
    if (signed) {
      // SPEC-V4 §5c: a team signed via the offers flow pays ITS OWN monthly
      // salary (d.teamSalary, set by acceptOffer), not the flat legacy
      // tier salary — that flat table is only the fallback for a save still
      // on the old canSign()/signContract() jump-a-tier path.
      var monthlySalary = d.teamSalary > 0 ? d.teamSalary : Data().contracts[d.contract].salary;
      summary.salary = monthlySalary / 30;

      // SPEC-V6 §25 (REPLACES SPEC-V5 §18/§26's consecutive-day tracking):
      // misses are now CUMULATIVE for the WHOLE CONTRACT — 3 total misses
      // (not necessarily consecutive) gets you kicked. A day where the
      // quota WAS met no longer resets the counter back to 0 — only signing
      // a fresh contract does (see State.acceptOffer()/State.signContract()).
      var eq = effectiveScrimQuota(d);
      if (!eq.met) {
        d.chemistry = Math.max(0, d.chemistry - 15);
        summary.chemistryPenalty = true;
        d.consecutiveScrimMisses = (d.consecutiveScrimMisses || 0) + 1;
        applyReputationChange(d, -3); // §12r: miss the daily scrim quota
        summary.scrimMiss = { count: d.consecutiveScrimMisses, kicked: false };
        if (d.consecutiveScrimMisses >= 3) {
          var kickedTeamId = d.myTeamId;
          d.hype = clamp(d.hype + (Data().hype.kicked || 0), 0, 100);
          applyReputationChange(d, -40); // §12r: kicked off a team
          d.contract = 'free';
          d.myTeamId = null;
          d.teamSalary = 0;
          d.contractSleeps = 0;
          d.contractLength = 0;
          d.lastSigningBonus = 0;
          d.lastKnownTeamTier = null;
          d.consecutiveScrimMisses = 0; // fresh count for whatever contract comes next
          summary.scrimMiss.kicked = true;
          summary.kicked = { reason: 'missed-scrims', teamId: kickedTeamId };
          if (window.Game.UI) window.Game.UI.toast('KICKED FOR MISSING SCRIMS — YOU ARE A FREE AGENT', 'bad');
        } else if (window.Game.UI) {
          window.Game.UI.toast('SCRIM QUOTA MISSED (' + d.consecutiveScrimMisses + '/3 FOR THIS CONTRACT) — ONE MORE AND YOU ARE OUT', 'bad');
        }
      }
    }
    d.cash += summary.salary;       // idle income is gone (SPEC-V3 §13) — subscribers replace it below

    applySubscriberPayout(d, summary); // SPEC-V3 §13: subscribers pay out every 7 sleeps, BEFORE rent
    applySponsorPayout(d, summary);    // SPEC-V8 §3: sponsors pay out on the SAME tick as subscribers
    // SPEC-V9 §2/§4: pay out existing drips BEFORE any new post this wake
    // creates one (a post never pays out the same wake it was made on —
    // "investment, not payout"), then let the manager auto-post for free,
    // then settle ad revenue on the SAME tick as subscribers/sponsors above.
    applySocialDrip(d, summary);
    applyManagerAutoPosts(d, summary);
    applySocialAdRevenue(d, summary);
    applyRent(d, summary);          // evaluates/advances against the PRE-increment day (every 7th sleep, §4)
    applyStaffUpkeep(d, summary);

    // SPEC-V4 §5e: contract countdown — only ever set (>0) by the new
    // offers flow (State.acceptOffer); a legacy signContract() leaves this
    // at 0 so it never auto-expires that older path. On reaching 0 the
    // player becomes a free agent and the offer cycle restarts (§5e), and
    // (SPEC-V5 §30) the team dangles an extension offer instead of just
    // letting them walk.
    if (d.contract !== 'free' && d.contractSleeps > 0) {
      d.contractSleeps -= 1;
      if (d.contractSleeps <= 0) {
        summary.contractExpired = true;
        summary.expiredTeamId = d.myTeamId;
        applyReputationChange(d, 15); // §12r: complete a full contract
        var pubExpired = d.myTeamId ? teamPublic(d, d.myTeamId) : null;
        // SPEC-V15 §2/§20a: d.bestContractTier tracks the best (lowest-
        // numbered) tier ever COMPLETED via a full contract running out —
        // NEVER via leaveTeam() (walking out early must not count, and
        // leaveTeam() never touches this field). Prefer the team's tier AT
        // COMPLETION (pubExpired.tier — may differ from signing if a
        // promotion/relegation happened mid-contract); fall back to the
        // tier signed at if the team record is somehow gone.
        var completedTier = pubExpired ? pubExpired.tier : d.contractSignedTierAtSign;
        if (completedTier != null) {
          d.bestContractTier = (d.bestContractTier == null) ? completedTier : Math.min(d.bestContractTier, completedTier);
        }
        if (pubExpired) {
          // SPEC-V15 §1 fix (bug root cause located at this line by the
          // lead): the old formula applied `bump` to pubExpired.salary alone
          // — the team's LIVE recomputed salary, which SPEC-V13 §7's mutable
          // trajectory can have drifted well below the player's LOCKED
          // d.teamSalary (e.g. a `declining` team that rerolled to `rising`
          // by contract end pays roughly half). Base off whichever salary is
          // higher, decay the bump toward flat for repeated re-signs of the
          // SAME team (d.reSignCount), and hard-floor the result at the
          // player's current locked salary so an extension can never pay
          // less than what they already make.
          var bump = 0.20 + Math.random() * 0.15; // §30: +20-35% salary
          var promoted = d.contractSignedTierAtSign != null && pubExpired.tier < d.contractSignedTierAtSign;
          if (promoted) bump += 0.15; // a promoted team offers notably more
          var base = Math.max(d.teamSalary, pubExpired.salary);
          var decay = Math.max(0, 1 - 0.10 * (d.reSignCount || 0)); // 4th re-sign onward flattens
          var newSalary = Math.round(base * (1 + bump * decay));
          newSalary = Math.max(newSalary, d.teamSalary); // an extension NEVER pays less than the current salary
          d.contractExtensionOffer = {
            teamId: d.myTeamId, teamName: pubExpired.name,
            oldSalary: d.teamSalary, newSalary: newSalary,
            signingBonus: pubExpired.signingBonus, contractSleeps: pubExpired.contractSleeps,
            promoted: !!promoted,
            // bumpPct: the REAL delta vs d.teamSalary (the player's current
            // locked pay), not the raw roll — decay/floor can make the two
            // diverge substantially.
            bumpPct: d.teamSalary > 0 ? Math.round((newSalary / d.teamSalary - 1) * 100) : Math.round(bump * 100)
          };
          summary.contractExtensionOffer = d.contractExtensionOffer;
        }
        d.contract = 'free';
        d.myTeamId = null;
        d.teamSalary = 0;
        d.contractLength = 0;
        d.lastSigningBonus = 0;
        d.lastKnownTeamTier = null;
      }
    }
    tryGenerateOffers(d); // §5b: scout new offers into the inbox while a free agent
    tryGenerateSponsorOffers(d); // SPEC-V8 §1: separate track — runs regardless of contract status
    // SPEC-V6 §9: starting the PLAYER's own tournament is now decoupled from
    // the whole-board background cycle below — it's driven by
    // d.nextPlayerTournamentDay instead (7 days after their last event
    // concluded, win OR lose — see finalizePlayerOutcome). Called FIRST so
    // a tournament that starts on the exact same day the background cycle
    // also fires gets excluded from that cycle's simulation immediately.
    maybeStartPlayerTournament(d, summary);
    maybeRunLeagueCycle(d, summary); // §5d/§6a: every 7 sleeps (§25), whole board — not just a signed player

    // SPEC-V5 §27r: salary follows the signed team's tier — recomputed from
    // the team's new band the moment a tier change is detected (a promotion
    // or relegation may have just happened via maybeRunLeagueCycle above).
    if (d.contract !== 'free' && d.myTeamId) {
      var pubNow = teamPublic(d, d.myTeamId);
      if (pubNow) {
        if (d.lastKnownTeamTier != null && d.lastKnownTeamTier !== pubNow.tier) {
          var oldSalary = d.teamSalary;
          d.teamSalary = pubNow.salary;
          summary.tierChange = {
            oldTier: d.lastKnownTeamTier, newTier: pubNow.tier,
            oldSalary: oldSalary, newSalary: d.teamSalary,
            rank: pubNow.rank, promoted: pubNow.tier < d.lastKnownTeamTier
          };
        }
        d.lastKnownTeamTier = pubNow.tier;
      }
    }

    // SPEC-V4 §7: COUNTING SHEEP form bonus — +0.01 per 5 sheep hit THIS
    // sleep, hard-capped at +0.10, banked here so it's ready the moment
    // today's form gets set (coach auto-form below, or a later manual
    // State.setForm() — both add it in, additively, clamped to 1.0 total).
    var hits = d.sheepHitsThisSleep || 0;
    var bonusUnits = Math.floor(hits / (Data().sheepReward ? Data().sheepReward.hitsPerBonus : 5));
    var perBonus = Data().sheepReward ? Data().sheepReward.formPerBonus : 0.01;
    var formCap = Data().sheepReward ? Data().sheepReward.formCap : 0.10;
    d.formBonusToday = clamp(bonusUnits * perBonus, 0, formCap);
    d.sheepHitsThisSleep = 0;
    d.sheepCashThisSleep = 0;

    d.day += 1;
    tickTeamTrajectories(d, summary); // SPEC-V13 §7B: once per day advance, after d.day is current
    d.form = null;
    d.scrimsToday = 0;
    applyCoachAutoForm(d);

    d.wakeElapsedMs = 0;             // SPEC-V3 §3 step 4: phase back to morning
    d.asleep = false;
    d.sleepGained = 0;
    d.sleepElapsedMs = 0;            // SPEC-V6 §15: reset the sleep-duration timer for next time
    d.sleepRequiredMs = 0;
    d.energyDrinksToday = 0;         // SPEC-V6 §3: energy-drink daily cap resets on wake
    d.lastEnergyTickAt = Date.now();
    // SPEC-V14 §2: re-latch AFTER salary/subscriber/sponsor payouts above
    // have had their chance to move d.cash — catches a threshold crossed by
    // this very day's income instantly, rather than waiting for next tick.
    applyPhoneUnlocks(d);

    // SPEC-V23 §4.2: quest invites + scout interest are rolled at END DAY,
    // same as every other day-advancing rule above — this fires for every
    // caller of resolveNewDay() (State.endDay() and the interactive
    // sleep/wake flow alike), not just one of them. Placed last so it reads
    // the CURRENT (post-increment) d.day and this day's final d.elo.
    rollDailyEmails(d);
  }

  // doTick: pure mutation of `d` based on elapsed wall-clock time since
  // d.lastEnergyTickAt. Returns { autoWoke: summary|null } — non-null only
  // when energy hit energyMax while asleep, which auto-wakes per §3 step 4.
  function doTick(d) {
    var now = Date.now();
    var last = d.lastEnergyTickAt || now;
    var dtMs = now - last;
    d.lastEnergyTickAt = now;
    // SPEC-V14 §2: run the sticky latch every tick (not just at sleep/wake)
    // so crossing a threshold mid-stream (e.g. a stream pushes followers
    // past 300) unlocks the phone immediately, not the next morning.
    applyPhoneUnlocks(d);
    if (dtMs <= 0 || d.dead) return { autoWoke: null };

    if (d.asleep) {
      var rate = effectiveSleepRate(d);
      var before = d.energy;
      d.energy = clamp(d.energy + rate * (dtMs / 1000), 0, d.energyMax);
      d.sleepGained = (d.sleepGained || 0) + (d.energy - before);
      d.sleepElapsedMs = (d.sleepElapsedMs || 0) + dtMs; // SPEC-V6 §15: real time asleep, gates State.canWake()
      if (d.energy >= d.energyMax) {
        var summary = { salary: 0, chemistryPenalty: false };
        resolveNewDay(d, summary);
        return { autoWoke: summary };
      }
      return { autoWoke: null };
    }

    // Awake: advance wakeElapsedMs and integrate energy regen, splitting the
    // interval across the day/night boundary if this tick spans it (e.g.
    // after the tab was backgrounded for a while) so a long gap is still
    // accounted for correctly rather than naively applying one rate to the
    // whole delta.
    var startE = d.wakeElapsedMs || 0;
    var endE = startE + dtMs;
    var daySec;
    if (startE >= NIGHT_START_MS) daySec = 0;
    else if (endE <= NIGHT_START_MS) daySec = dtMs / 1000;
    else daySec = (NIGHT_START_MS - startE) / 1000;
    // SPEC-V6 §7: daytime-only regen boosters add on top of the base day
    // rate, capped at +2.0/s total (Data.regenBonusCap) — night stays 0/sec
    // regardless (daySec is already 0 for the night portion above).
    var dayRate = (Data().dayRegenBase || 1.0) + totalRegenBonus(d);
    d.energy = clamp(d.energy + daySec * dayRate, 0, d.energyMax); // day (incl. sunset) at dayRate, 0/sec night (§1/§7)
    /* V22b (owner item 2): the day/night clock is FROZEN until the starting
       tutorial is finished or skipped. Onboarding walks a new player through
       furnishing the room and nine steps of reading; letting dusk fall over
       that meant regen stopping dead (§2) before they had done anything, and
       the room going dark behind the very panels teaching them to read it.
       Holding wakeElapsedMs at its start value keeps computePhase() reporting
       day AND keeps daySec above at the full delta, so energy still regens.
       tutorialDone flips on completion OR skip, so the clock starts either way. */
    if (d.tutorialDone) d.wakeElapsedMs = endE; // uncapped — permanent night is the intended pressure (§2)
    return { autoWoke: null };
  }

  // State.tickEnergy(): the tick/reconcile function the UI calls on an
  // interval (SPEC-V3 §1). Safe to call as often as desired — each call
  // only accounts for real elapsed time since the last call. Does not hit
  // localStorage unless an auto-wake actually happened (cheap to poll at
  // animation-frame rate); always emits 'change' so listeners can animate
  // the energy bar / backdrop smoothly.
  State.tickEnergy = function () {
    var d = State.data;
    if (!d) return null;
    var res = doTick(d);
    if (res.autoWoke) { State.save(); }
    emit('change');
    var ph = computePhase(d);
    return {
      energy: d.energy,
      energyMax: d.energyMax,
      asleep: !!d.asleep,
      wakeElapsedMs: d.wakeElapsedMs || 0,
      phase: ph.phase,
      sunsetProgress: ph.sunsetProgress,
      autoWoke: res.autoWoke
    };
  };

  // State.dayPhase(): read-only snapshot of the current phase (does NOT
  // tick — call State.tickEnergy() on an interval to keep this fresh; this
  // just reports whatever State.data currently holds).
  State.dayPhase = function () {
    var d = State.data;
    var ph = computePhase(d);
    return {
      phase: ph.phase,
      sunsetProgress: ph.sunsetProgress,
      wakeElapsedMs: d.wakeElapsedMs || 0,
      asleep: !!d.asleep
    };
  };

  State.energyMax = function () { return State.data.energyMax; };
  // State.regenStatus() (SPEC-V6 §7): read-only — current placed regen
  // bonus vs. its cap, and the resulting absolute day rate, for the shop
  // and the energy bar to display.
  State.regenStatus = function () {
    var bonus = totalRegenBonus(State.data);
    var base = Data().dayRegenBase || 1.0;
    var cap = Data().regenBonusCap;
    if (cap == null) cap = 2.0;
    return { bonus: bonus, cap: cap, dayRate: base + bonus, nightRate: 0 };
  };

  /* ---- energy drinks (SPEC-V6 §3) — a stockpiled consumable, NOT a room
     prop. Bought repeatedly via State.buyItem('energy_can') (adds to
     owned.energy_can, same as any other shop item); drunk on demand here.
     Max Data.energyDrink.maxPerDay (4) per day, resetting on wake
     (resolveNewDay clears d.energyDrinksToday). ---------------------------- */
  State.drinkEnergyDrink = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var cfg = Data().energyDrink || { restoreEnergy: 25, maxPerDay: 4 };
    var owned = d.owned.energy_can || 0;
    if (owned <= 0) return { ok: false, reason: 'none-owned' };
    if (d.energy >= d.energyMax) return { ok: false, reason: 'full-energy' };
    var drunkToday = d.energyDrinksToday || 0;
    if (drunkToday >= (cfg.maxPerDay || 4)) return { ok: false, reason: 'daily-limit' };
    d.owned.energy_can = owned - 1;
    d.energyDrinksToday = drunkToday + 1;
    d.energy = clamp(d.energy + (cfg.restoreEnergy || 25), 0, d.energyMax);
    commit();
    return { ok: true, energy: d.energy, owned: d.owned.energy_can, drinksToday: d.energyDrinksToday };
  };

  // State.energyDrinkStatus(): read-only snapshot for the UI's can-in-a-
  // circle button (owned count, drinks left today, and WHY it's disabled if
  // it is) — mirrors State.sleepGateStatus()'s pattern.
  State.energyDrinkStatus = function () {
    var d = State.data;
    var cfg = Data().energyDrink || { restoreEnergy: 25, maxPerDay: 4 };
    var owned = d.owned.energy_can || 0;
    var drunkToday = d.energyDrinksToday || 0;
    var drinksLeftToday = Math.max(0, (cfg.maxPerDay || 4) - drunkToday);
    var full = d.energy >= d.energyMax;
    var reason = null;
    if (owned <= 0) reason = 'none-owned';
    else if (full) reason = 'full-energy';
    else if (drinksLeftToday <= 0) reason = 'daily-limit';
    return {
      owned: owned, drinksToday: drunkToday, drinksLeftToday: drinksLeftToday,
      restoreEnergy: cfg.restoreEnergy || 25, canDrink: reason === null, reason: reason
    };
  };

  /* ---- CALMING SYRUP (V22c, owner item 5) ---------------------------------
     The energy drink's mirror: it DRAINS 60% of maximum energy so the player
     can sleep on demand. Deliberately built on the same three pieces the can
     uses — a `requiresFridge` catalog entry, a do-it action and a read-only
     status for the UI — rather than a parallel system, so the storage rule,
     the shop gate and the hub button all keep exactly one implementation.

     No daily limit, unlike the can: the can's limit exists to stop energy
     being conjured from nothing, and this spends energy rather than creating
     it. The real cost is the $100 and the fridge slot. -------------------- */
  State.drinkCalmingSyrup = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var def = findShopItem('calming_syrup');
    var owned = d.owned.calming_syrup || 0;
    if (owned <= 0) return { ok: false, reason: 'none-owned' };
    if (d.energy <= 0) return { ok: false, reason: 'no-energy' };
    var pct = (def && def.drainEnergyPct) || 0.60;
    d.owned.calming_syrup = owned - 1;
    // 60% of the MAXIMUM, not of what is left — a fixed, predictable bite, so
    // the button does the same thing at 100 energy as at 70.
    d.energy = clamp(d.energy - d.energyMax * pct, 0, d.energyMax);
    commit();
    return { ok: true, energy: d.energy, owned: d.owned.calming_syrup, drained: d.energyMax * pct };
  };

  State.calmingSyrupStatus = function () {
    var d = State.data;
    var def = findShopItem('calming_syrup');
    var owned = d.owned.calming_syrup || 0;
    var pct = (def && def.drainEnergyPct) || 0.60;
    var reason = null;
    if (owned <= 0) reason = 'none-owned';
    else if (d.energy <= 0) reason = 'no-energy';
    return {
      owned: owned, drainPct: pct, drainAmount: Math.round(d.energyMax * pct),
      canDrink: reason === null, reason: reason
    };
  };

  /* State.matchCooldownRemaining() (V22c item 4) — ms left before PLAY is
     available again, 0 when ready. Read-only; js/main.js shows it and
     State.playMatch() enforces it, so the number has one source. */
  State.matchCooldownRemaining = function () {
    var d = State.data;
    var span = Data().matchCooldownMs || 0;
    if (!span) return 0;
    var since = Date.now() - (d.lastMatchAt || 0);
    return since >= span ? 0 : Math.max(0, span - since);
  };

  // State.fridgeStatus() (SPEC-V7 §3, capacity source REPLACED by
  // SPEC-V11 §2): read-only — whether the player has a storage-providing
  // fridge PLACED, its combined capacity, current energy-drink stock, and
  // (mirroring State.energyDrinkStatus()'s pattern) WHY a purchase would be
  // blocked right now, for the shop to show. `hasFridge`/`capacity`/`stock`
  // are exposed separately from `reason` so the shop UI can render the lock
  // (no fridge placed at all) differently from a full-stockpile block. Name
  // and shape are unchanged so existing callers keep working — only
  // currentFridgeCapacity()'s source (owned -> placed+summed) changed.
  State.fridgeStatus = function () {
    var d = State.data;
    var capacity = currentFridgeCapacity(d);
    var hasFridge = capacity > 0;
    /* V22c (owner item 5): capacity is shared across EVERY fridge-stored
       drink, not just the can — 2 energy drinks + 2 calming syrups fills a
       4-slot mini-fridge exactly. Derived from the `requiresFridge` flag
       rather than a hand-written id list, so a future drink is counted the
       moment it is added to the catalog and nobody has to remember this. */
    var stock = 0;
    var catalog = Data().shopItems || [];
    for (var si = 0; si < catalog.length; si++) {
      if (catalog[si].requiresFridge) stock += (d.owned[catalog[si].id] || 0);
    }
    var remaining = Math.max(0, capacity - stock);
    var reason = null;
    if (!hasFridge) reason = 'no-fridge';
    else if (stock >= capacity) reason = 'fridge-full';
    return {
      hasFridge: hasFridge, capacity: capacity, stock: stock, remaining: remaining,
      canBuyDrink: reason === null, reason: reason
    };
  };

  /* ---- watch-an-ad full energy refill (SPEC-V3 §1) -------------------------- */
  State.watchAdRefill = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    State.tickEnergy();
    var remaining = State.adCooldownRemaining();
    if (remaining > 0) return { ok: false, reason: 'cooldown', remainingMs: remaining };
    d.energy = d.energyMax;
    d.lastAdAt = Date.now();
    commit();
    return { ok: true, energy: d.energy };
  };

  State.adCooldownRemaining = function () {
    var d = State.data;
    var last = d.lastAdAt || 0;
    return Math.max(0, AD_COOLDOWN_MS - (Date.now() - last));
  };

  /* ---- top-bar cash ad (SPEC-V13 §9A) ---------------------------------------
     A SEPARATE cooldown (d.lastCashAdAt / Data().cashAdCooldownMs, 5min) from
     the energy ad's (d.lastAdAt / AD_COOLDOWN_MS, 60s) so the two never
     compete — mirrors State.watchAdRefill()/State.adCooldownRemaining()'s
     shape exactly, just with its own field and its own reward. ------------- */
  State.cashAdCooldownRemaining = function () {
    var d = State.data;
    var last = (d && d.lastCashAdAt) || 0;
    return Math.max(0, (Data().cashAdCooldownMs || 0) - (Date.now() - last));
  };

  // State.cashAdReward(): PURE — no mutation, so it can be sampled by tests
  // without side effects. Reward scales with progress: a flat band for new
  // players, a flat band for mid-ELO players, and a proxy of the player's
  // real monthly income (team salary + subscriber revenue + social ad
  // revenue-ish followers term + raw followers) for anyone past 2500 ELO,
  // clamped so the band never cliffs at the 2500 boundary (floor $600 on
  // both sides of it) and never exceeds $25,000 for a top T1 earner.
  State.cashAdReward = function () {
    var d = State.data;
    var elo = (d && d.elo) || 0;
    if (elo < 1500) return randInt(50, 100);
    if (elo < 2500) return randInt(200, 600);
    var monthlyProxy = (d.teamSalary || 0)
      + (d.subscribers || 0) * 2.50 * (30 / 7)
      + totalSocialFollowers(d) * 0.015 * (30 / 7)
      + (d.followers || 0) * 0.05;
    var base = clamp(Math.round(0.12 * monthlyProxy), 600, 25000);
    var amount = Math.round(base * (0.8 + Math.random() * 0.4) / 10) * 10; // +/-20%, to nearest $10
    return clamp(amount, 600, 25000);
  };

  State.watchAdCash = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var remaining = State.cashAdCooldownRemaining();
    if (remaining > 0) return { ok: false, reason: 'cooldown', remainingMs: remaining };
    var amount = State.cashAdReward();
    d.cash += amount;
    d.lastCashAdAt = Date.now();
    commit();
    return { ok: true, amount: amount };
  };

  /* ---- skip-the-night ad (SPEC-V4 §1 — REPLACES the SPEC-V3 §3 COMING SOON
     placeholder) ---------------------------------------------------------
     Only usable while asleep. Grants full energy and immediately resolves
     the night exactly like State.wake({force:true}) would — day+1, salary,
     subscriber payout, rent, staff upkeep, form reset — but BYPASSES the
     50-energy minimum-sleep gate entirely; that's the whole point of
     watching the ad. Reuses the same resolveNewDay() body every other wake
     path uses, so nothing about wake's side effects is duplicated or can
     drift out of sync. UI owns the ~3s "AD PLAYING..." overlay before
     calling this (mirrors State.watchAdRefill's contract). */
  State.skipNightAd = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var tickRes = State.tickEnergy(); // may itself auto-wake if energy already hit max
    if (tickRes && tickRes.autoWoke) {
      var autoOut = { ok: true, ad: true, auto: true };
      for (var k1 in tickRes.autoWoke) autoOut[k1] = tickRes.autoWoke[k1];
      return autoOut;
    }
    d = State.data;
    if (!d.asleep) return { ok: false, reason: 'not-asleep' };
    d.energy = d.energyMax;
    var summary = { salary: 0, chemistryPenalty: false };
    resolveNewDay(d, summary);
    commit();
    var res = { ok: true, ad: true };
    for (var k in summary) res[k] = summary[k];
    return res;
  };

  // hasBedPlaced/sleepGateStatus (SPEC-V6 §27/§14): read-only checks the UI
  // can call BEFORE attempting State.sleep() to show a reason up front,
  // mirroring State.sleepWarning()'s pattern.
  function hasBedPlaced(d) {
    var placed = (d && d.placed) || [];
    for (var i = 0; i < placed.length; i++) if (BED_IDS.indexOf(placed[i].id) !== -1) return true;
    return false;
  }
  var SLEEP_BLOCK_ENERGY_PCT = 0.5; // §14: cannot sleep above 50% of current max energy
  State.sleepGateStatus = function () {
    var d = State.data;
    var energyPct = d.energyMax > 0 ? d.energy / d.energyMax : 0;
    if (!hasBedPlaced(d)) return { canSleep: false, reason: 'no-bed', message: 'YOU HAVE NO BED — PLACE ONE TO SLEEP.' };
    if (energyPct > SLEEP_BLOCK_ENERGY_PCT) {
      return { canSleep: false, reason: 'energy-too-high', energyPct: energyPct, message: 'TOO WIRED TO SLEEP — ENERGY MUST BE AT OR BELOW 50%.' };
    }
    return { canSleep: true, reason: null, energyPct: energyPct, message: null };
  };

  // requiredSleepMsFor: SPEC-V6 §15 — more energy at bedtime -> shorter
  // required sleep. Linear from 10s at 50% energy down to... no, UP to 30s
  // at 0% energy (the MORE depleted you are, the LONGER the minimum sleep),
  // never below 10s. Bedtime energy is always <=50% (§14 blocks sleep
  // above that), so this only ever needs to cover the 0%..50% range.
  function requiredSleepMsFor(energyPct) {
    var pct = clamp(energyPct, 0, 0.5);
    var ms = 30000 - (pct / 0.5) * 20000; // 30000 at pct=0, 10000 at pct=0.5
    return clamp(ms, 10000, 30000);
  }

  /* ---- sleep (SPEC-V3 §3 — replaces endDay()'s instant-resolve semantics) --
     sleep() puts the player to bed; canWake()/wake() gate + perform the
     actual "new day" resolution once at least the tiredness-scaled minimum
     sleep time has elapsed (§15) — or energy hits max, which auto-wakes via
     tickEnergy() regardless of the timer. SPEC-V6 §27/§14 add two hard
     preconditions: a bed must actually be placed, and energy must be at or
     below 50% of max. State.endDay() below is kept as a synchronous alias
     reproducing the old V1/V2 instant-refill behaviour exactly, for any
     caller that hasn't moved to the interactive flow (it bypasses these
     gates on purpose, same as it always bypassed the old min-sleep rule). */
  State.sleep = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    State.tickEnergy();
    if (d.asleep) return { ok: false, reason: 'already-asleep' };
    var gate = State.sleepGateStatus();
    if (!gate.canSleep) return { ok: false, reason: gate.reason, message: gate.message };
    d.asleep = true;
    d.sleepGained = 0;
    d.sleepElapsedMs = 0;
    d.sleepRequiredMs = requiredSleepMsFor(d.energyMax > 0 ? d.energy / d.energyMax : 0); // §15
    d.sheepHitsThisSleep = 0;   // SPEC-V4 §7: COUNTING SHEEP tally starts fresh each sleep
    d.sheepCashThisSleep = 0;
    d.lastEnergyTickAt = Date.now();
    commit();
    return { ok: true, sleepRequiredMs: d.sleepRequiredMs };
  };

  // State.canWake() (SPEC-V6 §15 — REPLACES the flat 50-energy-gained gate):
  // gated by ELAPSED SLEEP TIME now, scaled at bedtime by how depleted the
  // player was (d.sleepRequiredMs, set in State.sleep()) — NOT by energy
  // regenerated, so a fast bed no longer trivializes the minimum. `gained`
  // is kept (old name/shape) as an informational figure only.
  State.canWake = function () {
    State.tickEnergy();
    var d = State.data;
    var gained = d.sleepGained || 0;
    var rate = effectiveSleepRate(d);
    var required = d.sleepRequiredMs || MIN_SLEEP_MS_FLOOR;
    var elapsed = d.sleepElapsedMs || 0;
    var remainingMs = d.asleep ? Math.max(0, required - elapsed) : 0;
    return { allowed: !!d.asleep && elapsed >= required, gained: gained, remainingMs: remainingMs, sleepRate: rate, requiredMs: required, elapsedMs: elapsed };
  };

  State.wake = function (opts) {
    opts = opts || {};
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var tickRes = State.tickEnergy(); // may itself auto-wake (energy hit max while asleep)
    if (tickRes && tickRes.autoWoke) {
      var out = { ok: true, auto: true };
      for (var k in tickRes.autoWoke) out[k] = tickRes.autoWoke[k];
      return out;
    }
    if (!d.asleep) return { ok: false, reason: 'not-asleep' };
    if (!opts.force) {
      var c = State.canWake();
      if (!c.allowed) return { ok: false, reason: 'min-sleep', remainingMs: c.remainingMs, gained: c.gained };
    }
    var summary = { salary: 0, chemistryPenalty: false };
    resolveNewDay(d, summary);
    commit();
    var res = { ok: true };
    for (var k2 in summary) res[k2] = summary[k2];
    return res;
  };

  // State.currentBed(): the placed bed's shop def (sleepRate etc), for the
  // stats screen and any sleep UI.
  State.currentBed = function () { return currentBedDef(); };

  // State.roomCompleteness(): { complete, missing: [...] } — SPEC-V5 §5r.
  // Q/S own the banner text; PLAY/TRAIN/CASES/signing below already gate on
  // this themselves so an unmodified UI can't slip past it. STREAM's actual
  // session start lives in js/stream.js (Package R) — that module MUST call
  // this before allowing GO LIVE (documented in the SPEC-V5 API addendum),
  // since state.js has no "start stream" entry point of its own to gate.
  State.roomCompleteness = function () { return roomCompletenessFor(State.data); };

  /* ---- COUNTING SHEEP minigame (SPEC-V4 §7) ---------------------------------
     Package N builds the actual shooting-gallery canvas game; this is the
     reward math + caps it calls on every sheep hit. Optional and never
     blocking — energy keeps regenerating at the bed's rate regardless of
     whether this is ever called. A missed sheep is not reported here at all
     (no penalty, per spec — the caller simply doesn't call this on a miss). */
  State.sheepHit = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    if (!d.asleep) return { ok: false, reason: 'not-asleep' };
    var r = Data().sheepReward || { cashMin: 1, cashMax: 3, cashCapPerSleep: 50, hitsPerBonus: 5, formPerBonus: 0.01, formCap: 0.10, energyPerHit: 0.03 };
    d.sheepHitsThisSleep = (d.sheepHitsThisSleep || 0) + 1;
    // SPEC-V6 §13 / SPEC-V15 §6: each sheep hit ALSO adds Data.sheepReward.energyPerHit
    // (3% of max energy) directly, on top of the existing form/cash rewards below —
    // genuinely wakes you sooner, not just a bigger reward once you're already up.
    var energyPerHit = (r.energyPerHit != null) ? r.energyPerHit : 0.03;
    d.energy = clamp(d.energy + energyPerHit * (d.energyMax || 100), 0, d.energyMax);
    d.sleepGained = (d.sleepGained || 0) + energyPerHit * (d.energyMax || 100);
    var already = d.sheepCashThisSleep || 0;
    var roll = randInt(r.cashMin, r.cashMax);
    var cash = Math.max(0, Math.min(roll, r.cashCapPerSleep - already));
    d.sheepCashThisSleep = already + cash;
    if (cash > 0) d.cash += cash;
    var bonusUnits = Math.floor(d.sheepHitsThisSleep / r.hitsPerBonus);
    var formBonusPreview = clamp(bonusUnits * r.formPerBonus, 0, r.formCap);
    commit();
    return {
      ok: true,
      cashAwarded: cash,
      cashThisSleep: d.sheepCashThisSleep,
      cashCapped: d.sheepCashThisSleep >= r.cashCapPerSleep,
      hits: d.sheepHitsThisSleep,
      formBonusPreview: formBonusPreview,   // what tonight's hits would grant if sleep ended now
      formBonusCapped: formBonusPreview >= r.formCap
    };
  };

  // State.sheepStatus(): read-only snapshot for the UI (progress bars etc)
  // without registering a hit.
  State.sheepStatus = function () {
    var d = State.data;
    var r = Data().sheepReward || { cashCapPerSleep: 50, hitsPerBonus: 5, formPerBonus: 0.01, formCap: 0.10 };
    var hits = d.sheepHitsThisSleep || 0;
    var bonusUnits = Math.floor(hits / r.hitsPerBonus);
    return {
      hits: hits,
      cashThisSleep: d.sheepCashThisSleep || 0,
      cashCapPerSleep: r.cashCapPerSleep,
      formBonusPreview: clamp(bonusUnits * r.formPerBonus, 0, r.formCap),
      formBonusToday: d.formBonusToday || 0   // already-banked bonus from LAST sleep, active today
    };
  };

  /* ---- staff helpers (SPEC-V2 §5) ------------------------------------------ */
  function applyCoachAutoForm(d) {
    var coachDef = staffCoachDef(d.staff.coachId);
    if (!coachDef) return;
    // Auto-form applies at day start; a manual TRAIN session (State.setForm)
    // later the same day will keep whichever multiplier is higher (§5a).
    // SPEC-V4 §7: last night's sheep form bonus (already banked into
    // d.formBonusToday by resolveNewDay) is added on top here, additive,
    // clamped so the total can never exceed 1.0 (S-rank).
    var bonus = d.formBonusToday || 0;
    var eff = clamp(coachDef.formMult + bonus, 0, 1);
    d.form = { grade: coachDef.formGrade, mult: eff, baseMult: coachDef.formMult, day: d.day, source: 'coach' };
  }

  function applyStaffUpkeep(d, summary) {
    var active = [];
    var coachDef = staffCoachDef(d.staff.coachId);
    var modDef = staffModDef(d.staff.modId);
    ensureSocial(d);
    var socialDef = socialManagerDef(d.social.managerId); // SPEC-V9 §4: same one-hire/quits-on-cash pattern
    if (coachDef) active.push({ role: 'coach', def: coachDef });
    if (modDef) active.push({ role: 'mod', def: modDef });
    if (socialDef) active.push({ role: 'social', def: socialDef });
    summary.staffUpkeep = 0;
    summary.staffQuit = [];
    if (!active.length) return;
    // highest upkeep first, so the priciest hire is the first to go if cash can't cover them all
    active.sort(function (a, b) { return b.def.upkeep - a.def.upkeep; });
    function totalUpkeep() {
      return active.reduce(function (s, a) { return s + a.def.upkeep; }, 0);
    }
    while (active.length && d.cash - totalUpkeep() < 0) {
      var dropped = active.shift();
      if (dropped.role === 'coach') d.staff.coachId = null;
      else if (dropped.role === 'mod') d.staff.modId = null;
      else d.social.managerId = null;
      summary.staffQuit.push({ role: dropped.role, id: dropped.def.id, name: dropped.def.name });
      if (window.Game.UI) window.Game.UI.toast(dropped.def.name + ' QUIT — COULDN’T COVER UPKEEP', 'bad');
    }
    var total = totalUpkeep();
    d.cash -= total;               // never lets cash go negative from upkeep
    summary.staffUpkeep = total;
  }

  /* ---- subscribers (SPEC-V3 §13 — REPLACES idle income) --------------------
     Subscribers pay out in a lump sum every Data.subscriberPayoutInterval
     (7) sleeps, on the SAME tick as rent but evaluated BEFORE it (called
     first in resolveNewDay), so a strong channel's payout can cover the rent
     it just earned. `dayMod` mirrors applyRent()'s own "against the
     PRE-increment day" evaluation below, so both fire on the same sleep. --- */
  function applySubscriberPayout(d, summary) {
    summary.subscriberPayout = { due: false, paid: 0, count: 0 };
    var interval = Data().subscriberPayoutInterval || 7;
    var dayMod = d.day % interval;
    if (dayMod !== 0) return;
    var count = Math.max(0, Math.round(d.subscribers || 0));
    var paid = Math.round(count * Data().subscriberPrice * 100) / 100;
    d.cash += paid;
    summary.subscriberPayout = { due: true, paid: paid, count: count };
  }

  /* ---- rent (SPEC-V3 §4 / §5 — REPLACES SPEC-V2 §7's eviction rule) --------
     One sleep = one day (§4); rent still falls due every 7th day/sleep,
     evaluated here against d.day BEFORE resolveNewDay() increments it, same
     as the old endDay() ordering. The V2 eviction-at-2-misses rule is GONE:
     rent may now push cash negative. First negative-from-rent sets
     debtStrikes=1 (a warning, still playable). Second sets dead=true — the
     career is over; see State.sleep()/wake()/endDay() and the dead-save
     guards throughout this file. `d.rentMissed` is kept mirroring
     debtStrikes purely so the unmodified hub.js location badge (which reads
     data.rentMissed directly) still displays something sane — it no longer
     drives any eviction logic itself.

     SPEC-V6 §6: rent's weekly cadence is now offset by d.rentDayOffset (a
     random 1-6 chosen on move-in — see State.startMove()/normalizeSave())
     instead of always landing on the same absolute day-of-week the
     tournament cycle uses (maybeRunLeagueCycle fires on multiples of 7 from
     day 0, always). An offset in 1..6 makes the two cycles structurally
     unable to coincide — was: both `d.day % 7 === 0`, guaranteed collision.

     rentDayMod()/rentDueInSleeps() below are the SINGLE source of truth for
     this offset-aware schedule — applyRent() (the actual charge) and
     State.statsSummary() (the displayed countdown) both call through them so
     the number shown to the player can never drift from the day it's
     actually charged on. */
  function rentDayMod(d) {
    var offset = d.rentDayOffset || 0;
    return ((d.day - offset) % 7 + 7) % 7;
  }
  function rentDueInSleeps(d) {
    var dayMod = rentDayMod(d);
    return dayMod === 0 ? 0 : 7 - dayMod;
  }
  function applyRent(d, summary) {
    summary.rent = { due: false, paid: 0, missed: false, debtStrike: 0, dead: false, warning: false };
    if (d.locationId <= 0) return;
    var loc = locationDef(d.locationId);
    var dayMod = rentDayMod(d);
    if (dayMod === 0) {
      summary.rent.due = true;
      d.rentEverCharged = true; // SPEC-V15-BATCH-C §1 `first_rent` trigger latch — a charge happened
                                 // (paid OR missed, both branches below), never re-locked
      if (d.cash >= loc.rent) {
        d.cash -= loc.rent;
        summary.rent.paid = loc.rent;
      } else {
        d.cash -= loc.rent; // rent may push cash negative (§5) — never blocked, never refused
        summary.rent.paid = loc.rent;
        summary.rent.missed = true;
        d.debtStrikes = (d.debtStrikes || 0) + 1;
        d.rentMissed = Math.min(d.debtStrikes, 2);
        summary.rent.debtStrike = d.debtStrikes;
        if (d.debtStrikes === 1) {
          summary.rent.warning = true;
          if (window.Game.UI) window.Game.UI.toast('YOU ARE IN DEBT. MISS RENT AGAIN AND YOUR CAREER IS OVER.', 'bad');
        } else if (d.debtStrikes >= 2 && !d.dead) {
          d.dead = true;
          d.deadReason = 'Missed rent twice at ' + loc.name + ' — went broke and lost the career.';
          summary.rent.dead = true;
          if (window.Game.UI) window.Game.UI.toast('CAREER OVER — YOU WENT BROKE', 'bad');
        }
      }
    } else if (dayMod === 6) {
      summary.rent.warning = true;
      if (window.Game.UI) window.Game.UI.toast('RENT DUE TOMORROW', 'info');
    }
  }

  /* ---- day cycle (SPEC-V3 §3 — REPLACES SPEC-V2's instant endDay()) --------
     State.sleep()/canWake()/wake() above are the real, interactive V3 flow.
     State.endDay() is kept as a synchronous ALIAS reproducing the old
     V1/V2 "tap END DAY, everything resolves instantly, energy refills to
     full" behaviour exactly (same summary shape: salary/
     chemistryPenalty/subscriberPayout/rent/staffUpkeep), so any caller that hasn't moved to
     the interactive sleep flow — including the current unmodified
     js/hub.js's END DAY button — keeps working unmodified. */
  State.endDay = function () {
    var d = State.data;
    var summary = { salary: 0, chemistryPenalty: false };
    if (d.dead) return summary; // dead saves are view-only — no-op rather than throw (§5)
    d.energy = d.energyMax; // legacy instant full refill, matching V1/V2 exactly
    resolveNewDay(d, summary);
    commit();
    return summary;
  };

  /* ---- aim trainer -> form (§5.2, extended by SPEC-V2 §5a) ------------------
     If a coach's auto-form multiplier already beats a manual training roll,
     the coach's (better) multiplier is kept — manual training only ever
     helps, it never overrides a better auto-form with a worse one. --------- */
  State.setForm = function (grade) {
    var d = State.data;
    if (!roomCompletenessFor(d).complete) return null; // SPEC-V5 §5r: TRAIN blocked while the room is incomplete
    var g = null;
    var grades = Data().formGrades;
    for (var i = 0; i < grades.length; i++) if (grades[i].grade === grade) g = grades[i];
    if (!g) return null;
    // SPEC-V4 §7: last night's sheep form bonus applies additively here too,
    // clamped so the effective total can never exceed 1.0 (S-rank).
    var bonus = d.formBonusToday || 0;
    var eff = clamp(g.mult + bonus, 0, 1);
    var existing = (d.form && d.form.day === d.day) ? d.form : null;
    if (existing && existing.mult > eff) {
      d.form = { grade: existing.grade, mult: existing.mult, baseMult: existing.baseMult != null ? existing.baseMult : existing.mult, day: d.day, manual: true, manualGrade: grade, manualMult: eff };
    } else {
      d.form = { grade: g.grade, mult: eff, baseMult: g.mult, day: d.day, manual: true };
    }
    if (grade === 'S') d.hype = clamp(d.hype + (Data().hype.trainS || 0), 0, 100);
    commit();
    return d.form;
  };

  // computeContinuousFormMult (SPEC-V6 §12): the form multiplier as a
  // CONTINUOUS function of actual aim-trainer performance — accuracy, hit
  // volume (hits vs misses, not just their ratio), and reaction time — over
  // the full 0..1.0 range, REPLACING the fixed per-grade snap (B=0.45,
  // A=0.70, ...) that State.setForm(grade) above still uses for any caller
  // that hasn't moved to the new performance-based entry point below.
  function computeContinuousFormMult(perf) {
    perf = perf || {};
    var D = Data();
    var w = D.aimFormWeights || { accuracy: 0.50, volume: 0.30, reaction: 0.20 };
    var hits = perf.hits || 0, misses = perf.misses || 0;
    var accuracy = perf.accuracy != null ? clamp(perf.accuracy, 0, 1) : clamp(hits / Math.max(1, hits + misses), 0, 1);
    var volumeTarget = D.aimFormVolumeTarget || 40;
    var volume = clamp(hits / volumeTarget, 0, 1); // rewards playing (and hitting) more targets, not just being cautious
    var bestMs = D.aimFormReactionBestMs != null ? D.aimFormReactionBestMs : 150;
    var worstMs = D.aimFormReactionWorstMs != null ? D.aimFormReactionWorstMs : 600;
    var reactionMs = perf.reactionMs != null ? perf.reactionMs : (bestMs + worstMs) / 2;
    var reactionScore = clamp(1 - (reactionMs - bestMs) / (worstMs - bestMs), 0, 1);
    return clamp(w.accuracy * accuracy + w.volume * volume + w.reaction * reactionScore, 0, 1);
  }

  // State.setFormFromPerformance() (SPEC-V6 §12): the new continuous entry
  // point — takes raw performance ({ accuracy?, hits, misses, reactionMs })
  // instead of a pre-decided letter grade. The letter grade is derived FROM
  // the resulting multiplier (Data.formLabelForMult) purely as a display
  // label — it is never the source of the multiplier. Mirrors
  // State.setForm()'s "keep whichever is higher than today's coach/earlier
  // roll" behaviour exactly, just fed by a continuous input.
  State.setFormFromPerformance = function (perf) {
    var d = State.data;
    if (!roomCompletenessFor(d).complete) return null; // SPEC-V5 §5r: TRAIN blocked while the room is incomplete
    var rawMult = computeContinuousFormMult(perf);
    var bonus = d.formBonusToday || 0;
    var eff = clamp(rawMult + bonus, 0, 1);
    var label = Data().formLabelForMult(eff);
    var existing = (d.form && d.form.day === d.day) ? d.form : null;
    if (existing && existing.mult > eff) {
      var existingLabel = Data().formLabelForMult(existing.mult);
      d.form = {
        grade: existingLabel.grade, label: existingLabel.label, mult: existing.mult,
        baseMult: existing.baseMult != null ? existing.baseMult : existing.mult, day: d.day,
        manual: true, manualGrade: label.grade, manualMult: eff, continuous: true
      };
    } else {
      d.form = {
        grade: label.grade, label: label.label, mult: eff, baseMult: rawMult, day: d.day,
        manual: true, continuous: true,
        perf: { accuracy: perf && perf.accuracy, hits: perf && perf.hits, misses: perf && perf.misses, reactionMs: perf && perf.reactionMs }
      };
    }
    if (label.grade === 'S') d.hype = clamp(d.hype + (Data().hype.trainS || 0), 0, 100);
    commit();
    return d.form;
  };

  /* ---- training status (SPEC-V4 §2) -----------------------------------------
     TRAIN is already once-per-day (State.setForm can be called any number of
     times but only the FIRST manual roll each day counts as "trained today"
     from the nav button's point of view — a coach's auto-form at day start
     also counts, per §2's "if a coach is hired, the button shows the
     coach's auto-grade from the start of the day"). This is a pure read —
     the nav button renders whichever of these is true; it never mutates. */
  State.trainingStatus = function () {
    var d = State.data;
    var f = (d.form && d.form.day === d.day) ? d.form : null;
    if (!f) return { trained: false, grade: null, mult: null, label: null, source: null };
    var grade = f.manual ? f.manualGrade || f.grade : f.grade;
    var mult = f.manual ? (f.manualMult != null ? f.manualMult : f.mult) : f.mult;
    return {
      trained: true,
      grade: f.grade,          // the grade ACTUALLY IN EFFECT (coach's, if it beat the manual roll)
      mult: f.mult,            // the multiplier actually in effect
      manualGrade: f.manual ? (f.manualGrade || f.grade) : null, // what the player's own roll was, if lower than a coach
      source: f.source === 'coach' ? 'coach' : 'manual'
    };
  };

  /* ---- match / PLAY (SPEC-V2 §2 income + §9 difficulty curve —
     REPLACES V1 §5.3 win/gain/earnings rules) --------------------------------
     Solo (Free Agent) matches pay $0 — PLAY only grants ELO. Once signed,
     PLAY becomes an OFFICIAL MATCH and pays prize money (§2). Early ranks
     climb faster and losses sting less the lower the player's elo (§9). --- */
  State.playMatch = function () {
    if (State.data.dead) return { ok: false, reason: 'dead' };
    var rc = roomCompletenessFor(State.data);
    if (!rc.complete) return { ok: false, reason: 'room-incomplete', missing: rc.missing };
    /* V22c added a 45s cooldown that BLOCKED the button. V22d replaced it
       with the 15-second ACTIVE match (js/matchgames.js): the anti-farm brake
       is now time the player spends PLAYING rather than time they spend
       locked out, so the refusal is gone. State.matchCooldownRemaining() and
       d.lastMatchAt are kept and still stamped below — they cost nothing, the
       save field must stay for normalizeSave() anyway (§5.1), and a future
       rule may want to know when the last match was. */
    if (!State.useEnergy(Data().energyCosts.play)) return { ok: false, reason: 'energy' };
    State.data.lastMatchAt = Date.now();
    var d = State.data;
    var hasForm = d.form && d.form.day === d.day;
    var mForm = hasForm ? d.form.mult : 0;
    var gear = State.gearBonus();
    var signed = d.contract !== 'free';
    var chemBonus = signed ? (d.chemistry - 50) / 300 : 0;

    var earlyMult = clamp(1.6 - (d.elo / 1400) * 0.6, 1.0, 1.6);
    var earlyWin = clamp(0.12 * (1 - d.elo / 1400), 0, 0.12);

    var eloBase = 22 + rand(0, 8);
    var eloBaseTerm = eloBase * (1 + mForm) + gear.aim;
    var dElo = eloBaseTerm * earlyMult;
    // SPEC-V6 §18: setup quality (desk/pc/monitor/chair tiers) contributes
    // to OFFICIAL (signed team) match win chance specifically — a bad rig
    // visibly hurts the team, on top of the existing gear.aim/ELO effects.
    var setupBonus = signed ? setupQuality(d) * (Data().setupQualityWinBonus || 0) : 0;
    // SPEC-V7 §10: form coefficient 0.35 -> 0.65 (base kept at 0.30). Was
    // 0.30 + 0.35*form, which at the ROOKIE COACH's (also-retuned) 0.35
    // auto-form gave ~0.42 — a losing record for a coached player. At 0.65
    // the rookie floor is 0.30 + 0.65*0.35 = 0.5275 (>= the required 52%),
    // an uncoached/untrained player (form 0) is unchanged at a "clearly
    // bad" 0.30, and a maxed S-form (1.00) player hits 0.95 pre-clamp — the
    // 0.92 ceiling below still caps it, same as before.
    var winChance = clamp(0.30 + 0.65 * mForm + gear.aim / 120 + chemBonus + earlyWin + setupBonus, 0.05, 0.92);
    var win = Math.random() < winChance;
    var earnings, eloDelta, oppScore = randInt(2, 10);

    d.stats.matches += 1;
    if (win) {
      eloDelta = dElo;
      d.elo += eloDelta;
      d.hype = clamp(d.hype + (Data().hype.matchWin || 0), 0, 100);
      d.stats.wins += 1;
      // SPEC-V8 §2/§3: `match_wins` sponsor obligations only count OFFICIAL
      // (signed-team) match wins — matches this module's own "PLAY only
      // grants ELO until signed" rule above.
      if (signed) recordSponsorMatchWin(d);
    } else {
      // loss penalty scaled by 1/earlyMult so early losses sting less (§9)
      eloDelta = -(dElo * 0.55 / earlyMult);
      d.elo = Math.max(0, d.elo + eloDelta);
    }

    if (!signed) {
      earnings = 0; // solo matchmaking pays nothing — rank is the only reward (§2)
    } else {
      var tierPrize = Data().matchPrizes[d.contract] || 0;
      var prize = tierPrize * (0.5 + d.chemistry / 100);
      earnings = win ? prize : prize * 0.15;
      if (win) applyReputationChange(d, 0.5); // §12r: win an official team match
    }
    d.cash += earnings;
    commit();

    return {
      ok: true,
      win: win,
      nudge: !hasForm,
      official: signed,
      eloDelta: eloDelta,
      elo: d.elo,
      earnings: earnings,
      score: { you: win ? 13 : oppScore, opp: win ? oppScore : 13 }
    };
  };

  /* ---- THE PRO CAREER SYSTEM (SPEC-V4 §5) -----------------------------------
     Replaces "press a button, jump a tier" with a scouted-offers model over
     the 100-team leaderboard (Data().teams, static). `State.data.teams`
     holds only the MUTABLE slice per team (rank, strength) — everything
     else (name, colours, trajectory, base salary curve) is recomputed live
     from the static catalog + that mutable rank, per the save-schema rule
     that only mutable state persists. ensureTeams() lazily seeds it once
     (old saves normalize with `teams: null` and get seeded on first touch).
     `State.canSign`/`State.signContract` below (SPEC-V2 §5.5) are KEPT
     working unmodified — old name, extend don't rename — for the current
     unmodified career.js UI; the new offers flow is additive alongside it.
     A legacy signContract() leaves `myTeamId` null; `myTeamOrFallback()`
     synthesizes a generic team for that case so tournaments/leaderboard
     code never has to special-case "signed the old way". */
  function ensureTeams(d) {
    if (!d.teams || !d.teams.length) {
      // §5d: `points` is the real mutable score; `rank` is cached on the
      // object purely for convenience/perf but is ALWAYS derived by
      // recomputeRanks() below — nothing ever assigns it directly.
      d.teams = (Data().teams || []).map(function (t) { return { id: t.id, rank: t.rank, strength: t.strength, points: t.points }; });
    }
    ensureTeamTrajectories(d); // SPEC-V13 §7B: seeds traj/trajUntil on a brand-new team list AND
                                // migrates an existing save whose d.teams[] entries predate this field —
                                // one code path, never mirrored between the two cases.
    return d.teams;
  }

  // ensureTeamTrajectories (SPEC-V13 §7B): idempotent. Any mutable team entry
  // missing `traj`/`trajUntil` (a brand-new team list, OR an old save from
  // before trajectory became mutable) gets seeded here — first cycle only,
  // deliberately staggered (`randInt(1, 14)`, not the full 7-14) so all 100
  // teams don't flip on the same day. Later cycles (tickTeamTrajectories)
  // use the full 7-14 range. `trajCycleLen` is NOT one of the two fields the
  // spec calls out as new persisted state (`traj`/`trajUntil`) — it exists
  // solely so teamPublic() can compute an exact `trajectorySince` (the day
  // the CURRENT cycle started, = trajUntil - trajCycleLen) instead of a
  // guess. It rides along for free: d.teams is copied WHOLESALE by
  // normalizeSave() (see §7E), so any property on a team object survives a
  // save without needing its own defaultData()/rebuild-block entry — no risk
  // of the "silently dropped field" bug this batch is otherwise so wary of.
  function ensureTeamTrajectories(d) {
    var list = d.teams || [];
    for (var i = 0; i < list.length; i++) {
      var mut = list[i];
      if (typeof mut.traj !== 'string') {
        var st = teamStaticById(mut.id);
        mut.traj = (st && st.trajectory) || 'stable';
      }
      if (typeof mut.trajUntil !== 'number' || typeof mut.trajCycleLen !== 'number') {
        var len = randInt(1, 14);
        mut.trajCycleLen = len;
        mut.trajUntil = (d.day || 0) + len;
      }
    }
    return list;
  }

  // tickTeamTrajectories (SPEC-V13 §7B): runs ONCE per day advance, from
  // resolveNewDay() right after d.day is incremented. Every team whose cycle
  // has expired re-rolls via Data().rollTrajectory() (mild anti-repeat baked
  // in there) and gets a fresh 7-14 day cycle. If the PLAYER's own signed
  // team's heat actually changes, that's surfaced on the wake summary so
  // career.js can show it.
  function tickTeamTrajectories(d, summary) {
    var list = ensureTeams(d);
    for (var i = 0; i < list.length; i++) {
      var mut = list[i];
      if ((d.day || 0) < mut.trajUntil) continue;
      var from = mut.traj;
      mut.traj = Data().rollTrajectory(mut.traj);
      var len = randInt(7, 14);
      mut.trajCycleLen = len;
      mut.trajUntil = d.day + len;
      if (summary && d.myTeamId && mut.id === d.myTeamId && mut.traj !== from) {
        summary.teamHeatChange = { from: from, to: mut.traj };
      }
    }
  }

  // recomputeRanks: the ONLY thing that ever sets `rank` on a team — always
  // derived by sorting the whole 100-team list by `points` descending
  // (ties broken by strength). Call after any mutation of `points`/
  // `strength` (SPEC-V4 §5d: "Nothing ever writes a rank directly").
  function recomputeRanks(d) {
    var list = ensureTeams(d);
    var sorted = list.slice().sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return b.strength - a.strength;
    });
    sorted.forEach(function (mut, idx) { mut.rank = idx + 1; });
  }

  var teamStaticMap = null;
  function teamStaticById(id) {
    if (!teamStaticMap) {
      teamStaticMap = {};
      var arr = Data().teams || [];
      for (var i = 0; i < arr.length; i++) teamStaticMap[arr[i].id] = arr[i];
    }
    return teamStaticMap[id];
  }

  function teamMutable(d, id) {
    var list = ensureTeams(d);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // teamPublic: the full renderable team object — static catalog fields
  // (name/colours/letterform/badge/trajectory/contractSleeps) merged with
  // the CURRENT mutable rank/strength, with tier/salary/requirements/
  // signingBonus recomputed live from that current rank (§5c/§5d — a team's
  // pay and eligibility bar move with it as it climbs or falls).
  function teamPublic(d, id) {
    var mut = teamMutable(d, id);
    var st = teamStaticById(id);
    if (!mut || !st) return null;
    // SPEC-V13 §7B/§7D: trajectory is now MUTABLE per save and re-rolls on a
    // cycle (tickTeamTrajectories) — `mut.traj` is the live value; `st.trajectory`
    // (the static catalog seed) is only a fallback for a team entry that
    // somehow still lacks it. Salary follows the LIVE trajectory (a team's
    // pay band moves as it heats up or cools down for FUTURE offers/the
    // leaderboard) — an already-signed contract's `d.teamSalary` is locked
    // separately and never repriced by this (§7D, decided, not a bug).
    var traj = mut.traj || st.trajectory;
    var tier = Data().tierForRank(mut.rank);
    var salary = Data().salaryForRankTrajectory(mut.rank, traj);
    var bonusRatio = st.salary ? (st.signingBonus / st.salary) : 1.5;
    var trajectorySince = (typeof mut.trajUntil === 'number' && typeof mut.trajCycleLen === 'number')
      ? mut.trajUntil - mut.trajCycleLen
      : (d.day || 0);
    return {
      id: st.id, name: st.name, rank: mut.rank, tier: tier, strength: mut.strength, points: Math.round(mut.points),
      salary: salary, signingBonus: Math.round(salary * bonusRatio),
      contractSleeps: st.contractSleeps, trajectory: traj,
      trajectorySince: trajectorySince,
      trajectoryTag: (Data().trajectoryTags || {})[traj] || '',
      requirements: Data().requirementsForRank(mut.rank, tier),
      colors: st.colors, letterform: st.letterform, badgeStyle: st.badgeStyle
    };
  }

  // myTeamOrFallback: real signed team if signed via the offers flow
  // (myTeamId set), else a synthetic generic team when signed via the
  // legacy canSign/signContract path (myTeamId stays null there) so
  // tournament/leaderboard code always has something to read.
  function myTeamOrFallback(d) {
    if (d.myTeamId) return teamPublic(d, d.myTeamId);
    if (!d.contract || d.contract === 'free') return null;
    var tier = d.contract === 't1' ? 1 : (d.contract === 't2' ? 2 : 3);
    var rank = tier === 1 ? 10 : (tier === 2 ? 35 : 75);
    var c = Data().contracts[d.contract] || { name: 'SIGNED', salary: 0 };
    return {
      id: null, name: c.name, rank: rank, tier: tier, strength: 50 + (4 - tier) * 10, points: null,
      salary: c.salary, signingBonus: 0, contractSleeps: 0, trajectory: 'stable',
      trajectoryTag: (Data().trajectoryTags || {}).stable || '',
      requirements: Data().requirementsForRank(rank, tier),
      colors: ['#888888', '#222222'], letterform: '?', badgeStyle: 'circle'
    };
  }

  State.leaderboard = function () {
    var d = State.data;
    var list = ensureTeams(d).slice().sort(function (a, b) { return a.rank - b.rank; });
    return list.map(function (t) { return teamPublic(d, t.id); });
  };
  State.teamById = function (id) { return teamPublic(State.data, id); };
  State.myTeam = function () { return myTeamOrFallback(State.data); };

  /* ---- eligibility + the live objectives checklist (§5b) -------------------
     A team's `requirements` ARE the objectives — objectivesForTeam() just
     renders each threshold as a live checklist entry (current value, target,
     done). Used both pre-offer (State.scoutBoard(), "what to grind toward")
     and on an open offer (still live — an offer already met these when
     created, but e.g. ELO can slip back below the bar afterward, which is
     informative to show, not hidden). */
  function meetsRequirements(d, req) {
    if (!req) return true;
    if (req.elo && d.elo < req.elo) return false;
    if (req.hype && d.hype < req.hype) return false;
    if (req.chemistry && d.chemistry < req.chemistry) return false;
    if (req.followers && d.followers < req.followers) return false;
    if (req.winRate) {
      var m = d.stats.matches || 0, w = d.stats.wins || 0;
      if ((m > 0 ? w / m : 0) < req.winRate) return false;
    }
    return true;
  }

  /* hasEarnedTier1 — THE tier gate, and the single source of truth for it, so
     tryGenerateOffers/objectivesForTeam/scoutBoard never re-derive it.

     V22 (owner, item 11): a Tier 1 side now expects ALL THREE of
     Data.tier1Gate — 100/100 hype, 90+ chemistry held right now, and a Tier 2
     contract COMPLETED (d.bestContractTier, set only when a contract runs out
     naturally, never on State.leaveTeam(); walking out early must not count).

     This REPLACES the old rule, which was an OR: complete a T2 contract, or
     place semifinal-or-better at a T2 tournament. Both alternatives are gone
     on purpose — the owner specified three requirements together, and the top
     of the ladder should be the hardest offer in the game to earn.

     hype/chemistry are checked LIVE, so this can go false again after being
     true (both decay). That is intended: it reads as "a Tier 1 side wants you
     at your peak", not "you unlocked a permanent flag".

     Reputation gating (SPEC-V5 §12r) is applied ON TOP by callers, not here. */
  function tier1Gate() {
    var g = Data().tier1Gate || {};
    return { hype: g.hype || 100, chemistry: g.chemistry || 90, completedTier: g.completedTier || 2 };
  }

  function tier1GateParts(d) {
    var g = tier1Gate();
    return {
      hype: (d.hype || 0) >= g.hype,
      chemistry: (d.chemistry || 0) >= g.chemistry,
      contract: (d.bestContractTier != null && d.bestContractTier <= g.completedTier)
    };
  }

  function hasEarnedTier1(d) {
    var p = tier1GateParts(d);
    return p.hype && p.chemistry && p.contract;
  }
  State.hasEarnedTier1 = function () { return hasEarnedTier1(State.data); };
  // Exposed so the UI can say WHICH of the three is missing rather than
  // showing one opaque pass/fail for a three-part requirement.
  State.tier1GateParts = function () { return tier1GateParts(State.data); };

  function objectivesForTeam(d, teamId) {
    var pub = teamPublic(d, teamId);
    if (!pub) return [];
    var req = pub.requirements, list = [];
    if (req.elo) list.push({ id: 'elo', label: 'REACH ' + req.elo + ' ELO', current: Math.round(d.elo), target: req.elo, done: d.elo >= req.elo });
    if (req.hype) list.push({ id: 'hype', label: 'REACH ' + req.hype + ' SCOUT HYPE', current: Math.round(d.hype), target: req.hype, done: d.hype >= req.hype });
    if (req.chemistry) list.push({ id: 'chemistry', label: 'HOLD ' + req.chemistry + '+ CHEMISTRY', current: Math.round(d.chemistry), target: req.chemistry, done: d.chemistry >= req.chemistry });
    if (req.followers) list.push({ id: 'followers', label: 'REACH ' + req.followers + ' FOLLOWERS', current: Math.round(d.followers), target: req.followers, done: d.followers >= req.followers });
    if (req.winRate) {
      var m = d.stats.matches || 0, w = d.stats.wins || 0, wr = m > 0 ? w / m : 0;
      list.push({ id: 'winRate', label: 'HOLD ' + Math.round(req.winRate * 100) + '%+ WIN RATE', current: Math.round(wr * 100), target: Math.round(req.winRate * 100), done: wr >= req.winRate });
    }
    // SPEC-V15 §2/§20a: Tier 1 refusal must be LEGIBLE, not a silent never-
    // offer. V22 (item 11) made the gate three requirements rather than one,
    // so it lists THREE entries — one opaque "you have not earned it" line for
    // a three-part condition tells the player nothing about what to grind.
    // Each is skipped if an identical team requirement already listed it, so a
    // Tier 1 side asking for 90 chemistry in its own `requirements` does not
    // produce the same row twice.
    if (pub.tier === 1) {
      var g = tier1Gate();
      var parts = tier1GateParts(d);
      if (!req.hype) {
        list.push({ id: 'tier1Hype', label: 'REACH ' + g.hype + ' SCOUT HYPE',
          current: Math.round(d.hype), target: g.hype, done: parts.hype });
      }
      if (!req.chemistry) {
        list.push({ id: 'tier1Chem', label: 'HOLD ' + g.chemistry + '+ CHEMISTRY',
          current: Math.round(d.chemistry), target: g.chemistry, done: parts.chemistry });
      }
      list.push({ id: 'tier1Gate', label: 'COMPLETE A TIER ' + g.completedTier + ' CONTRACT',
        current: parts.contract ? 1 : 0, target: 1, done: parts.contract });
    }
    return list;
  }
  State.teamObjectives = function (teamId) { return objectivesForTeam(State.data, teamId); };

  // State.scoutBoard(): teams "currently scouting" the player — the ~12
  // closest to the player's current ELO band, each with a live objectives
  // checklist and an `eligible` flag, so the player always has something to
  // grind toward even before any firm offer lands (§5b). Free agents only.
  State.scoutBoard = function (opts) {
    var d = State.data;
    if (d.contract !== 'free') return [];
    ensureTeams(d);
    var limit = (opts && opts.limit) || 12;
    return d.teams.map(function (mut) { return teamPublic(d, mut.id); })
      .sort(function (a, b) { return Math.abs(a.requirements.elo - d.elo) - Math.abs(b.requirements.elo - d.elo); })
      .slice(0, limit)
      .map(function (pub) {
        // SPEC-V15 §2/§20a: a Tier 1 team is never `eligible` until
        // hasEarnedTier1() passes, on top of the usual stat requirements.
        var eligible = meetsRequirements(d, pub.requirements) && (pub.tier !== 1 || hasEarnedTier1(d));
        return { team: pub, objectives: objectivesForTeam(d, pub.id), eligible: eligible };
      });
  };

  /* ---- offers inbox (§5b) ---------------------------------------------------
     tryGenerateOffers() runs every resolveNewDay() (i.e. every wake, auto-
     wake, or skip-night-ad — anywhere a night actually resolves) while the
     player is a free agent. SPEC-V6 §4 (REPLACES the old "up to 2 land the
     instant you cross the floor" behaviour): offers now trickle in ONE AT A
     TIME, every few real days, up to a smaller open-inbox cap — so multiple
     competing offers can still be open at once, just never as a same-day
     pair. Below the flat ELO floor (Data.eloFloorForTier(3), the lowest
     tier's bar), NO offers are generated at all. */
  var MAX_OPEN_OFFERS = 3;              // §4: was 5
  var OFFER_EXPIRY_SLEEPS = 5;
  var OFFER_MIN_GAP_DAYS = 2;           // §4: "every few days" — random 2-5 day gap between rolls
  var OFFER_MAX_GAP_DAYS = 5;

  function makeOffer(d, teamId) {
    var pub = teamPublic(d, teamId);
    return {
      id: genId(), teamId: teamId, createdDay: d.day, expiresAtDay: d.day + OFFER_EXPIRY_SLEEPS,
      salary: pub.salary, signingBonus: pub.signingBonus, contractSleeps: pub.contractSleeps,
      rank: pub.rank, tier: pub.tier, trajectory: pub.trajectory, trajectoryTag: pub.trajectoryTag
    };
  }

  function tryGenerateOffers(d) {
    if (d.contract !== 'free') return;
    // §4/§5: strictly below the lowest tier's ELO floor, generate NOTHING —
    // not even a background timer roll.
    if ((d.elo || 0) < (Data().eloFloorForTier ? Data().eloFloorForTier(3) : 2100)) return;
    ensureTeams(d);
    if (!d.offers) d.offers = [];
    d.offers = d.offers.filter(function (o) { return o.expiresAtDay >= d.day; });
    if (d.offers.length >= MAX_OPEN_OFFERS) return;
    // §4: offers arrive gradually — only roll once the random gap since the
    // last roll (or since becoming eligible) has actually elapsed.
    if (d.day < (d.nextOfferEligibleDay || 0)) return;
    var openIds = {};
    d.offers.forEach(function (o) { openIds[o.teamId] = 1; });
    var candidates = [];
    for (var i = 0; i < d.teams.length; i++) {
      var mut = d.teams[i];
      if (openIds[mut.id]) continue;
      var tier = Data().tierForRank(mut.rank);
      var req = Data().requirementsForRank(mut.rank, tier);
      // SPEC-V5 §12r: reputation gates which tiers will make offers at all —
      // meeting the ELO/hype/etc requirements isn't enough on its own.
      // SPEC-V15 §2/§20a: Tier 1 ALSO requires hasEarnedTier1(d) — otherwise
      // a T3-only career could jump straight to a Major-contending team the
      // instant ELO/reputation cleared the bar (the exploit this batch fixes).
      // Tier 2 offers are unchanged: T3 -> T2 stays a legal single step.
      if (meetsRequirements(d, req) && reputationAllowsTier(d.reputation || 0, tier) && (tier !== 1 || hasEarnedTier1(d))) candidates.push(mut.id);
    }
    // Always reschedule the next roll, win or lose this time, so a dry
    // spell (no eligible candidates yet) doesn't retry every single sleep.
    d.nextOfferEligibleDay = d.day + randInt(OFFER_MIN_GAP_DAYS, OFFER_MAX_GAP_DAYS);
    if (!candidates.length) return;
    candidates.sort(function () { return Math.random() - 0.5; });
    d.offers.push(makeOffer(d, candidates[0])); // §4: one at a time, never two at once
  }

  State.offers = function () { return (State.data.offers || []).slice(); };

  /* ---- signing (§5b/§5d/§5e — the ONLY way to sign under the new system) ---
     Accepting an offer is the sole path in; the legacy canSign()/
     signContract() button below still works standalone for the current
     unmodified UI, but does not touch `myTeamId`/`offers`/`teamSalary` — see
     myTeamOrFallback() above for how tournament/leaderboard code copes with
     that older path. */
  State.acceptOffer = function (offerId) {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var rc = roomCompletenessFor(d); // SPEC-V5 §5r: CAREER (incl. signing) blocked while the room is incomplete
    if (!rc.complete) return { ok: false, reason: 'room-incomplete', missing: rc.missing };
    if (d.contract !== 'free') return { ok: false, reason: 'already-signed' };
    var offers = d.offers || [];
    var idx = -1;
    for (var i = 0; i < offers.length; i++) if (offers[i].id === offerId) { idx = i; break; }
    if (idx === -1) return { ok: false, reason: 'not-found' };
    var offer = offers[idx];
    if (offer.expiresAtDay < d.day) { offers.splice(idx, 1); commit(); return { ok: false, reason: 'expired' }; }
    var pub = teamPublic(d, offer.teamId);
    if (!pub) return { ok: false, reason: 'invalid-team' };
    d.myTeamId = offer.teamId;
    d.contract = pub.tier === 1 ? 't1' : (pub.tier === 2 ? 't2' : 't3'); // legacy field kept in sync — playMatch()/scrim()/rent all still read it
    d.teamSalary = offer.salary;      // per-team monthly pay (§5c) — overrides the flat Data.contracts salary in resolveNewDay
    d.cash += offer.signingBonus;
    d.lastSigningBonus = offer.signingBonus; // §11: what leaving early would forfeit
    d.contractSleeps = offer.contractSleeps;
    d.contractLength = offer.contractSleeps;
    d.contractSignedTierAtSign = pub.tier; // §30: baseline for "was this extension a promotion"
    d.lastKnownTeamTier = pub.tier;        // §27r: baseline for "did the tier change since last wake"
    // SPEC-V15 §1: signing via the normal offers inbox resets the re-sign
    // streak UNLESS it happens to be the exact same team d.reSignCount was
    // already counting for (e.g. re-signing an old team the normal way
    // after having left/expired out of it once already) — "resets to 0
    // when the player signs a DIFFERENT team."
    if (d.reSignTeamId !== offer.teamId) d.reSignCount = 0;
    d.reSignTeamId = offer.teamId;
    d.offers = []; // accepting clears the inbox — the rest lapse, mirrors ending free agency for real
    d.consecutiveScrimMisses = 0; // SPEC-V6 §25: cumulative miss count is PER CONTRACT — fresh contract, fresh count
    commit();
    return { ok: true, team: pub, signingBonus: offer.signingBonus, contract: d.contract, contractSleeps: d.contractSleeps };
  };

  // State.leaveTeamCost(): the EXACT cost of leaving right now — surfaced so
  // the UI can state it before the player commits (§11). null if not signed.
  State.leaveTeamCost = function (opts) {
    var d = State.data;
    if (d.contract === 'free') return null;
    var penalty = (opts && typeof opts.hypePenalty === 'number') ? opts.hypePenalty : LEAVE_EARLY_HYPE_PENALTY;
    return { signingBonusForfeit: d.lastSigningBonus || 0, hypePenalty: penalty, reputationPenalty: LEAVE_EARLY_REPUTATION_PENALTY };
  };

  // State.leaveTeam(): quit early at a reputation + hype cost (§5e, extended
  // by SPEC-V5 §11/§12r). Default penalty chosen so a bad signing is
  // recoverable but not free. §11: ALSO forfeits the full signing bonus the
  // player received on joining — balance may go negative (the §5 debt rules
  // then apply as normal, same as a missed rent payment). Use
  // State.leaveTeamCost() first to show the exact numbers before committing.
  var LEAVE_EARLY_HYPE_PENALTY = 20;
  var LEAVE_EARLY_REPUTATION_PENALTY = 25; // §12r: "leave a team early: -25"
  State.leaveTeam = function (opts) {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    if (d.contract === 'free') return { ok: false, reason: 'not-signed' };
    var penalty = (opts && typeof opts.hypePenalty === 'number') ? opts.hypePenalty : LEAVE_EARLY_HYPE_PENALTY;
    var signingBonusForfeit = d.lastSigningBonus || 0;
    d.hype = clamp(d.hype - penalty, 0, 100);
    d.cash -= signingBonusForfeit; // §11: may go negative — that's intentional, §5 debt rules apply
    applyReputationChange(d, -LEAVE_EARLY_REPUTATION_PENALTY); // §12r
    d.contract = 'free';
    d.myTeamId = null;
    d.teamSalary = 0;
    d.contractSleeps = 0;
    d.contractLength = 0;
    d.lastSigningBonus = 0;
    d.lastKnownTeamTier = null;
    commit();
    return { ok: true, hype: d.hype, hypePenalty: penalty, signingBonusForfeit: signingBonusForfeit, reputation: d.reputation };
  };

  // State.acceptContractExtension()/declineContractExtension() (§30): the
  // team's better-terms offer generated on natural contract expiry
  // (resolveNewDay). Accepting re-signs to the SAME team at the new terms;
  // declining just clears the offer and leaves the player a free agent to
  // shop around via the normal offers inbox.
  State.acceptContractExtension = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var rc = roomCompletenessFor(d); // SPEC-V5 §5r: CAREER (incl. signing) blocked while the room is incomplete
    if (!rc.complete) return { ok: false, reason: 'room-incomplete', missing: rc.missing };
    var ext = d.contractExtensionOffer;
    if (!ext) return { ok: false, reason: 'none' };
    if (d.contract !== 'free') return { ok: false, reason: 'already-signed' };
    var pub = teamPublic(d, ext.teamId);
    d.myTeamId = ext.teamId;
    d.contract = pub ? (pub.tier === 1 ? 't1' : (pub.tier === 2 ? 't2' : 't3')) : d.contract;
    d.teamSalary = ext.newSalary;
    d.cash += ext.signingBonus;
    d.lastSigningBonus = ext.signingBonus;
    d.contractSleeps = ext.contractSleeps;
    d.contractLength = ext.contractSleeps;
    d.contractSignedTierAtSign = pub ? pub.tier : null;
    d.lastKnownTeamTier = pub ? pub.tier : null;
    d.contractExtensionOffer = null;
    // SPEC-V15 §1: an extension is always the SAME team by definition —
    // increments the re-sign streak (which decays the pay bump), rather
    // than resetting it the way a brand-new offer from a different team does.
    d.reSignCount = (d.reSignCount || 0) + 1;
    d.reSignTeamId = ext.teamId;
    commit();
    return { ok: true, team: pub, salary: d.teamSalary, signingBonus: ext.signingBonus, contractSleeps: d.contractSleeps };
  };
  State.declineContractExtension = function () {
    var d = State.data;
    if (!d.contractExtensionOffer) return false;
    d.contractExtensionOffer = null;
    commit();
    return true;
  };
  State.contractExtensionOffer = function () { return State.data.contractExtensionOffer || null; };

  /* ---- TOURNAMENTS (SPEC-V4 §6) ---------------------------------------------
     A tournament fires every `Data().tournamentIntervalSleeps` (14) sleeps
     for a SIGNED player (checked from resolveNewDay via
     maybeRunLeagueCycle() further below) — field size/prize pool/event name
     follow the signed team's tier (§6a). The player advances the bracket one match
     at a time via State.playTournamentMatch(); every match NOT involving the
     player is auto-resolved instantly the moment it becomes playable (same
     winChance formula, generalised — see powerFor()) so the bracket is
     always internally consistent without asking the player to tap through
     matches they have no stake in. Field sizes that aren't a power of two
     (Tier 2's 12) get top-seeded byes straight into round 2, merged in once
     round 1 finishes. */
  function powerFor(entry, d) {
    if (entry.isYou) {
      var hasForm = d.form && d.form.day === d.day;
      var mForm = hasForm ? d.form.mult : 0;
      var gear = State.gearBonus();
      // SPEC-V6 §18: setup quality also feeds tournament win chance (via
      // this power score), same idea as the playMatch() bonus above.
      var setupBonus = setupQuality(d) * (Data().setupQualityPowerBonus || 0);
      return (mForm * 40) + (gear.aim * 0.5) + (d.chemistry * 0.3) + setupBonus; // §6b exact formula + §18
    }
    return entry.strength * 0.5; // §6b's teamPower, generalised to any non-player side
  }

  // SPEC-V5 §22r: legal CS2 (MR12) scorelines only — regulation winner
  // reaches 13 (loser 0-11, always >=2 ahead since loser tops out at 11);
  // overtime (both reached 12-12) plays to 16 (loser 12-14). No result where
  // the winner has fewer than 13.
  var OVERTIME_CHANCE = 0.15;
  function rollMatchScore() {
    if (Math.random() < OVERTIME_CHANCE) {
      return { winner: 16, loser: randInt(12, 14) };
    }
    return { winner: 13, loser: randInt(0, 11) };
  }

  // SPEC-V5 §29: a team's trajectory nudges its win chance toward its target
  // rate (rising ~70%, declining ~35%, stable ~50%) — blended with (not
  // replacing) the existing strength-based winChance, so a rising minnow
  // still loses to a strong side more often than not.
  function trajBiasFor(traj) { return (Data().trajectoryWinBias || {})[traj] || 0; }

  // SPEC-V5 §28: tournament matches move the player's ELO ~3x a regular
  // match (Data.tournamentEloMultiplier) — mirrors playMatch()'s own ELO
  // formula so tournament and regular-match ELO feel consistent, just
  // higher stakes. Only ever called for the match the PLAYER is actually in.
  function applyTournamentElo(d, win) {
    var hasForm = d.form && d.form.day === d.day;
    var mForm = hasForm ? d.form.mult : 0;
    var gear = State.gearBonus();
    var earlyMult = clamp(1.6 - (d.elo / 1400) * 0.6, 1.0, 1.6);
    var eloBase = 22 + rand(0, 8);
    var eloBaseTerm = eloBase * (1 + mForm) + gear.aim;
    var dElo = eloBaseTerm * earlyMult;
    var mult = Data().tournamentEloMultiplier || 3;
    var delta = win ? (dElo * mult) : -(dElo * 0.55 / earlyMult * mult);
    d.elo = Math.max(0, d.elo + delta);
    return delta;
  }

  /* ensureBestOf — how many maps this match is played over. Derived from the
     round rather than stamped on at bracket-construction time: a round holding
     exactly ONE match is the final, wherever it sits, which also covers a
     two-team field whose round 1 IS the final. Memoised onto the match so it
     survives into the save and can never be re-derived differently mid-series. */
  function ensureBestOf(t, round, match) {
    if (!match.bestOf) {
      match.bestOf = (round && round.length === 1)
        ? ((Data().tournamentFinalBestOf || {})[t.tier] || 1)
        : 1;
    }
    return match.bestOf;
  }

  function mapsNeeded(bestOf) { return Math.floor((bestOf || 1) / 2) + 1; }

  /* resolveMatchMap — resolves ONE map of a match, and closes the match out
     only when a side has taken the series. Bo1 behaves exactly as before: one
     call, match done.

     ELO moves once per MATCH, not once per map (§28). Applying it per map
     would hand a Bo3 final two or three times the ELO swing of every other
     match in the bracket, which is a balance change nobody asked for. */
  function resolveMatchMap(d, match) {
    var powA = powerFor(match.a, d), powB = powerFor(match.b, d);
    var strengthChance = clamp(0.5 + (powA - powB) / 160, 0.08, 0.92); // §6b exact formula
    var trajChance = clamp(0.5 + (trajBiasFor(match.a.trajectory) - trajBiasFor(match.b.trajectory)), 0.08, 0.92);
    var winChance = clamp(strengthChance * 0.65 + trajChance * 0.35, 0.08, 0.92); // §29 blend
    var aWins = Math.random() < winChance;
    var s = rollMatchScore(); // §22r

    match.bestOf = match.bestOf || 1;
    match.mapsA = match.mapsA || 0;
    match.mapsB = match.mapsB || 0;
    match.maps = match.maps || [];

    // scoreA/scoreB always hold the map just played — that is what the match
    // animation renders, and it must be a single map's scoreline, never a
    // series aggregate. The series stands in mapsA/mapsB.
    match.scoreA = aWins ? s.winner : s.loser;
    match.scoreB = aWins ? s.loser : s.winner;
    if (aWins) match.mapsA++; else match.mapsB++;
    match.maps.push({ a: match.scoreA, b: match.scoreB });

    var need = mapsNeeded(match.bestOf);
    if (match.mapsA >= need || match.mapsB >= need) {
      match.done = true;
      match.winner = (match.mapsA > match.mapsB) ? match.a : match.b;
      if (match.a.isYou || match.b.isYou) {
        var youWon = (match.winner === match.a && match.a.isYou) ||
                     (match.winner === match.b && match.b.isYou);
        match.eloDelta = applyTournamentElo(d, youWon); // §28 — once, on the series
      }
    }
    return match;
  }

  // resolveMatch — plays a match out to completion. Used for every match the
  // player is NOT in; the player's own series is stepped one map per day
  // through State.playTournamentMatch().
  function resolveMatch(d, match) {
    var guard = 0;
    while (!match.done && guard < 16) { resolveMatchMap(d, match); guard++; }
    return match;
  }

  function autoResolveNonPlayerMatches(d, round, t) {
    for (var i = 0; i < round.length; i++) {
      var m = round[i];
      if (!m.done && m.a && m.b && !m.a.isYou && !m.b.isYou) {
        if (t) ensureBestOf(t, round, m);
        resolveMatch(d, m);
      }
    }
  }

  function toFieldEntry(t) { return { id: t.id, isYou: false, name: t.name, rank: t.rank, tier: t.tier, strength: t.strength, trajectory: t.trajectory }; }

  function nextPow2(n) { var p = 1; while (p < n) p *= 2; return p; }

  // rollTournamentField: draws the field from teams of the SAME TIER as the
  // signed team (SPEC-V5 §23 — tier-locked, REPLACES SPEC-V4 §6a's "plus a
  // couple of seeded higher-ranked sides" entirely), nearest-rank-first,
  // then builds the round-1 bracket (with byes for non-power-of-2 fields
  // like Tier 2's 12). Each tier always has more same-tier teams than a
  // field needs (T1: 19 candidates for 15 slots, T2: 29 for 11, T3: 49 for
  // 7), so no cross-tier backfill is ever required.
  function rollTournamentField(d) {
    var myTeam = myTeamOrFallback(d);
    if (!myTeam) return null;
    var cfg = Data().tournamentTiers[myTeam.tier];
    if (!cfg) return null;
    ensureTeams(d);
    var allPub = d.teams.map(function (mut) { return teamPublic(d, mut.id); }).filter(function (t) { return t && t.id !== myTeam.id; });
    var sameTier = allPub.filter(function (t) { return t.tier === myTeam.tier; }); // §23: tier-locked
    var myRank = myTeam.rank;
    var pool = sameTier.slice().sort(function (a, b) { return Math.abs(a.rank - myRank) - Math.abs(b.rank - myRank); });
    var field = [{ id: myTeam.id || 'you', isYou: true, name: 'YOU', rank: myTeam.rank, tier: myTeam.tier, strength: myTeam.strength, trajectory: myTeam.trajectory }]
      .concat(pool.slice(0, cfg.field - 1).map(toFieldEntry));
    field = field.slice(0, cfg.field);

    // Seed order: strongest (lowest rank number) first, so byes go to the
    // best sides — then shuffle within that seeding for round-1 pairing.
    field.sort(function (a, b) { return a.rank - b.rank; });
    var pow2 = nextPow2(field.length);
    var byes = pow2 - field.length;
    var byeTeams = field.slice(0, byes);
    var playIn = field.slice(byes);
    // shuffle the play-in half's pairing order (deterministic seeding isn't
    // required by spec — this is runtime randomness, not save-derived data)
    for (var s = playIn.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = playIn[s]; playIn[s] = playIn[j]; playIn[j] = tmp;
    }
    var round0 = [];
    for (var k = 0; k < playIn.length; k += 2) {
      round0.push({ a: playIn[k], b: playIn[k + 1], winner: null, done: false });
    }
    // No `t` to pass yet — the tournament object is the return value below.
    // Safe: ensureBestOf only matters for a round holding exactly one match,
    // and any such round is the final, which the player is always in — so this
    // call skips it (it only auto-resolves matches with no `isYou` side) and
    // State.playTournamentMatch() sets bestOf when the player gets there.
    autoResolveNonPlayerMatches(d, round0);

    return {
      id: genId(), tier: myTeam.tier, event: cfg.event, prizePool: cfg.prizePool,
      field: field, bracket: [round0], pendingByes: byeTeams, done: false,
      startedDay: d.day, totalRounds: Math.round(Math.log(pow2) / Math.LN2)
    };
  }

  /* ---- HLTV-style points model (SPEC-V4 §5d) --------------------------------
     `points` is the only thing ever mutated; `rank` always falls out of
     recomputeRanks() sorting the whole 100-team list by points descending.
     applyPointsEvent() is the one function that touches a team's points —
     used both for the player's own bracket (finalizePlayerOutcome, below)
     and for the background simulation of every other team's event this
     cycle (simulateBackgroundEvents). */
  function placementKeyForRf(isChampion, roundsFromFinal) {
    if (isChampion) return 'win';
    if (roundsFromFinal === 0) return 'final';
    if (roundsFromFinal === 1) return 'semi';
    if (roundsFromFinal === 2) return 'quarter';
    return 'groups';
  }

  // applyPointsEvent: decay (§5d: -8% every cycle, applied here per-team at
  // the moment they're processed for this cycle's event) + this event's
  // gain, damped 70% of the way from the OLD total to that newly computed
  // total (rather than snapping) — the exact §5d formula.
  function applyPointsEvent(mut, tier, placementKey, fieldStrength01) {
    var lp = Data().leaguePoints || { eventWeight: {}, placementFactor: {}, decay: 0.08, damping: 0.7 };
    var weightKey = tier === 1 ? 't1major' : (tier === 2 ? 't2' : 't3');
    var eventWeight = lp.eventWeight[weightKey] || 0;
    var placementFactor = lp.placementFactor[placementKey] || 0;
    var gained = eventWeight * placementFactor * (0.5 + clamp(fieldStrength01, 0, 1));
    var decayed = mut.points * (1 - lp.decay);
    var target = decayed + gained;
    mut.points = Math.max(0, mut.points + lp.damping * (target - mut.points));
    return gained;
  }

  // applyRankCeiling: "a team may not end an event ranked higher than (best
  // rank among the teams it beat) - ceilingMargin" (§5d, the anti-chaos
  // safeguard). Enforced by capping POINTS (never rank directly) — pull the
  // team's points down to just behind whoever legitimately holds the
  // ceiling rank, so recomputeRanks() naturally respects it afterward.
  function applyRankCeiling(d, teamId, bestRankAmongBeaten) {
    if (bestRankAmongBeaten == null) return;
    var margin = (Data().leaguePoints || {}).ceilingMargin;
    if (margin == null) margin = 5;
    var ceilingRank = Math.max(1, bestRankAmongBeaten - margin);
    recomputeRanks(d);
    var mut = teamMutable(d, teamId);
    if (!mut || mut.rank >= ceilingRank) return; // already at/below the ceiling — nothing to do
    var sorted = ensureTeams(d).slice().sort(function (a, b) { return b.points - a.points; });
    var atCeiling = sorted[ceilingRank - 1];
    if (atCeiling && atCeiling.id !== teamId) mut.points = Math.max(0, atCeiling.points - 1);
    recomputeRanks(d);
  }

  // rollBackgroundPlacement: cheap per-team placement roll for teams not in
  // the player's own bracket this cycle (§5d "a cheap roll using strength")
  // — higher strength skews toward better placements, with randomness so
  // upsets happen.
  function rollBackgroundPlacement(strength) {
    var score = (strength || 0) / 100 + (Math.random() - 0.5) * 0.6;
    if (score > 0.95) return 'win';
    if (score > 0.85) return 'final';
    if (score > 0.70) return 'semi';
    if (score > 0.50) return 'quarter';
    return 'groups';
  }

  function simulateBackgroundEvents(d, excludeIds) {
    ensureTeams(d).forEach(function (mut) {
      if (excludeIds[mut.id]) return; // playing in the player's own live bracket this cycle instead
      var tier = Data().tierForRank(mut.rank || 100);
      var placementKey = rollBackgroundPlacement(mut.strength);
      // No real opponents to reference here (cheap roll, not a real bracket)
      // — approximate fieldStrength from the team's own strength, per §5d's
      // explicit allowance for a cheap strength-based roll.
      var fieldStrength01 = clamp((mut.strength / 100) * (0.8 + Math.random() * 0.25), 0, 1);
      applyPointsEvent(mut, tier, placementKey, fieldStrength01);
      var strengthDelta = placementKey === 'win' ? 3 : (placementKey === 'final' ? 1 : (placementKey === 'groups' ? -2 : 0));
      mut.strength = clamp(mut.strength + strengthDelta, 5, 100);
    });
  }

  // maybeRunLeagueCycle: called every resolveNewDay(), every 7 sleeps
  // (§25's interval, reused as the league's background cycle length),
  // REGARDLESS of whether the player is signed — §5d: "the whole 100-team
  // board moves whether or not the player is involved." SPEC-V6 §9: no
  // longer responsible for starting the PLAYER's own tournament (that's
  // maybeStartPlayerTournament() below, on its own independent schedule) —
  // this purely decays/simulates every OTHER team, excluding whichever
  // teams are currently in the player's own live bracket (if any), however
  // long ago that bracket actually started.
  /* rollTournamentInterval — how many sleeps until the next event, picked
     fresh in [tournamentIntervalMinSleeps, tournamentIntervalMaxSleeps]
     (4..7). Exported so the tournament screen can describe the cadence
     honestly instead of hardcoding "every 7 days" a second time.

     Callers must STORE what this returns and count against the stored value.
     Calling it inside a per-day comparison would re-roll the deadline every
     day, which is not "a varying cadence" but "a cadence that never resolves". */
  State.rollTournamentInterval = function () {
    var lo = Data().tournamentIntervalMinSleeps || 4;
    var hi = Data().tournamentIntervalMaxSleeps || Data().tournamentIntervalSleeps || 7;
    if (hi < lo) hi = lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  };

  function maybeRunLeagueCycle(d, summary) {
    // Fall back to the max on a save that predates leagueCycleInterval (or a
    // fresh one), so the first cycle after an upgrade is never SHORTER than
    // the old fixed 7 — an upgrade should not retroactively skip a tournament.
    var interval = d.leagueCycleInterval || Data().tournamentIntervalMaxSleeps || 7;
    if (d.day - (d.lastTournamentDay || 0) < interval) return;
    d.lastTournamentDay = d.day;
    d.leagueCycleInterval = State.rollTournamentInterval();
    ensureTeams(d);
    var excludeIds = {};
    var liveField = (d.tournament && !d.tournament.done) ? d.tournament.field : null;
    if (liveField) liveField.forEach(function (f) { if (f.id) excludeIds[f.id] = 1; });
    simulateBackgroundEvents(d, excludeIds);
    recomputeRanks(d);
  }

  // maybeStartPlayerTournament (SPEC-V6 §9): starts the signed player's own
  // tournament field the moment they're both (a) not already mid-bracket
  // and (b) past d.nextPlayerTournamentDay — set to (day + 7) whenever
  // their previous event concluded, win OR lose (finalizePlayerOutcome).
  // A brand-new signing with nextPlayerTournamentDay still at its default
  // (0) is eligible immediately, same as the old "first cycle after
  // signing" behaviour.
  function maybeStartPlayerTournament(d, summary) {
    if (d.contract === 'free') return;
    if (d.tournament && !d.tournament.done) return; // already mid-bracket — one event at a time
    if (d.day < (d.nextPlayerTournamentDay || 0)) return;
    ensureTeams(d);
    var newTournament = rollTournamentField(d);
    if (!newTournament) return;
    newTournament.rankBefore = myTeamOrFallback(d) ? myTeamOrFallback(d).rank : null;
    newTournament.lastMatchDay = 0; // §9: no match played yet — gates State.playTournamentMatch() to one/day
    d.tournament = newTournament;
    if (summary) summary.tournamentStarted = { event: newTournament.event, tier: newTournament.tier, field: newTournament.field.length };
  }

  function buildNextRound(t, round) {
    var winners = round.map(function (m) { return m.winner; });
    if (t.pendingByes && t.pendingByes.length) {
      winners = winners.concat(t.pendingByes);
      t.pendingByes = [];
    }
    var next = [];
    for (var i = 0; i < winners.length; i += 2) next.push({ a: winners[i], b: winners[i + 1], winner: null, done: false });
    return next;
  }

  var PLACEMENT_LABELS = ['CHAMPION', 'RUNNER-UP', 'SEMIFINALIST', 'QUARTERFINALIST', 'GROUP STAGE', 'GROUP STAGE'];

  // finalizePlayerOutcome: player's fate (win-it-all or eliminated) is
  // known; this (a) works out their placement/prize, (b) applies hype/
  // chemistry/rank effects (§6b/§6c), (c) silently simulates whatever's
  // left of the bracket (matches with no player stake) purely so every
  // PARTICIPATING team's run-length is known for the rank-movement pass.
  function finalizePlayerOutcome(d, t, champion, eliminatedAtRound) {
    var isChampion = !eliminatedAtRound && champion === true;
    var roundsFromFinal = isChampion ? -1 : (t.totalRounds - 1 - eliminatedAtRound);
    var prizeIdx = isChampion ? 0 : clamp(roundsFromFinal + 1, 1, (Data().tournamentPrizeSplit || []).length - 1);
    var split = Data().tournamentPrizeSplit || [0.5, 0.2, 0.1, 0.1, 0.05, 0.05];
    var prize = Math.round(t.prizePool * (split[prizeIdx] || 0));
    var placement = isChampion ? PLACEMENT_LABELS[0] : PLACEMENT_LABELS[clamp(roundsFromFinal + 1, 1, PLACEMENT_LABELS.length - 1)];

    // SPEC-V13 §7C: a strong tournament run can jolt the player's OWN team
    // out of a cold/neutral spell — only rolled when the team is currently
    // 'stable' or 'declining' (a rising team has nothing to gain here), and
    // only for placements Data().trajectoryTournamentBoost actually has an
    // entry for (CHAMPION/RUNNER-UP/SEMIFINALIST — anything worse never
    // rolls). On success the team's heat flips to 'rising' immediately with
    // a fresh 7-14 day cycle, same shape as any other trajectory roll.
    var heatBoost = null;
    if (d.myTeamId) {
      var myMut = teamMutable(d, d.myTeamId);
      if (myMut && (myMut.traj === 'stable' || myMut.traj === 'declining')) {
        var boostChance = (Data().trajectoryTournamentBoost || {})[placement];
        if (boostChance && Math.random() < boostChance) {
          var boostFrom = myMut.traj;
          myMut.traj = 'rising';
          var boostLen = randInt(7, 14);
          myMut.trajCycleLen = boostLen;
          myMut.trajUntil = d.day + boostLen;
          heatBoost = { from: boostFrom, to: 'rising' };
        }
      }
    }

    d.cash += prize;
    if (isChampion) {
      d.hype = clamp(d.hype + (Data().hype.champion || 0), 0, 100);
      d.chemistry = clamp(d.chemistry + 15, 0, 100);
      applyReputationChange(d, t.tier === 1 ? 18 : 6); // §12r: win a tournament (+18 for a Major)
      if (t.tier === 1) d.majorChampion = true; // §6c: permanent marker, never cleared
    } else if (roundsFromFinal === 0) { // runner-up
      d.hype = clamp(d.hype + (Data().hype.runnerUp || 0), 0, 100);
      d.chemistry = clamp(d.chemistry + 8, 0, 100);
    } else if (roundsFromFinal === 1) { // semifinalist — decent showing, mild positive
      d.hype = clamp(d.hype + (Data().hype.semifinalist || 0), 0, 100);
      d.chemistry = clamp(d.chemistry + 2, 0, 100);
    } else { // §6c: "a group-stage exit lowers team rank and chemistry"
      d.hype = clamp(d.hype + (Data().hype.earlyExit || 0), 0, 100);
      d.chemistry = clamp(d.chemistry - 10, 0, 100);
    }

    // Simulate the rest of the bracket (no more player stake in it) so every
    // participating team's furthest round AND who-beat-whom is known for
    // the points pass below (§5d needs both the placement reached and the
    // strength/rank of every opponent actually beaten).
    var exitRoundById = {};
    var beatenById = {}; // teamId -> [{strength, rank}, ...] of opponents actually beaten
    for (var r = 0; r < t.bracket.length; r++) {
      var round = t.bracket[r];
      for (var m = 0; m < round.length; m++) {
        var match = round[m];
        if (!match.done) resolveMatch(d, match);
        var winner = match.winner, loser = winner === match.a ? match.b : match.a;
        var winnerId = winner.isYou ? d.myTeamId : winner.id;
        if (winnerId) {
          beatenById[winnerId] = beatenById[winnerId] || [];
          beatenById[winnerId].push({ strength: loser.strength, rank: loser.rank });
        }
        if (loser && !loser.isYou) exitRoundById[loser.id] = r;
      }
      if (round.length > 1 && r === t.bracket.length - 1) {
        t.bracket.push(buildNextRound(t, round));
      }
    }
    var finalRound = t.bracket[t.bracket.length - 1];
    var champEntry = finalRound[0] && finalRound[0].winner;
    if (champEntry && !champEntry.isYou) exitRoundById[champEntry.id] = t.totalRounds; // champion "exits" having won every round

    // Points/rank movement for every REAL participating team (§5d/§6c) — the
    // player's own team (if signed via the real offers flow) moves the same
    // way any other participant does, using their own eliminatedAtRound.
    if (d.myTeamId) exitRoundById[d.myTeamId] = isChampion ? t.totalRounds : eliminatedAtRound;
    ensureTeams(d);
    for (var id in exitRoundById) {
      var mut = teamMutable(d, id);
      if (!mut) continue;
      var champ = exitRoundById[id] === t.totalRounds;
      var rf = champ ? -1 : (t.totalRounds - 1 - exitRoundById[id]);
      var placementKey = placementKeyForRf(champ, rf);
      var beaten = beatenById[id] || [];
      var fieldStrength01 = beaten.length
        ? beaten.reduce(function (s, o) { return s + o.strength; }, 0) / beaten.length / 100
        : 0;
      applyPointsEvent(mut, t.tier, placementKey, fieldStrength01);
      if (beaten.length) {
        var bestRankBeaten = Math.min.apply(null, beaten.map(function (o) { return o.rank; }));
        applyRankCeiling(d, id, bestRankBeaten); // §5d anti-chaos safeguard — never omit
      }
      var strengthDelta = placementKey === 'win' ? 5 : (placementKey === 'final' ? 2 : (placementKey === 'groups' ? -3 : 0));
      mut.strength = clamp(mut.strength + strengthDelta, 5, 100);
    }
    recomputeRanks(d);

    t.done = true;
    t.placement = placement;
    t.prizeWon = prize;
    var rankAfter = d.myTeamId ? (teamMutable(d, d.myTeamId) || {}).rank : (myTeamOrFallback(d) || {}).rank;
    t.rankDelta = (t.rankBefore != null && rankAfter != null) ? (rankAfter - t.rankBefore) : null; // negative = climbed
    d.tournamentHistory = d.tournamentHistory || [];
    d.tournamentHistory.push({ day: d.day, event: t.event, tier: t.tier, placement: placement, prize: prize, rankDelta: t.rankDelta });
    // Cap so a very long career doesn't bloat the save indefinitely (§ save-schema note).
    if (d.tournamentHistory.length > 50) d.tournamentHistory = d.tournamentHistory.slice(-50);
    // SPEC-V6 §9: the event just concluded — win OR lose, the next tournament
    // is now 4-7 days out rather than exactly 7 (winning the whole thing takes
    // this same line, so both cases stay covered). Rolled ONCE, here, and
    // stored as an absolute day: State.nextTournamentInDays() subtracts from
    // it every frame, so a value re-rolled per read would show the player a
    // countdown that danced around instead of ticking down.
    d.nextPlayerTournamentDay = d.day + State.rollTournamentInterval();
    return { placement: placement, prize: prize, rankDelta: t.rankDelta, heatBoost: heatBoost };
  }

  // State.playTournamentMatch() (SPEC-V6 §9 — REPLACES same-day full-bracket
  // resolution): resolves the next match involving the player in the
  // current round, but only ONE such match per real day — win, and the
  // next one simply isn't playable until d.day advances (i.e. "tomorrow",
  // via sleep). Returns roundComplete/tournamentComplete flags so the UI
  // knows when to reveal the next round or the final result.
  State.playTournamentMatch = function () {
    var d = State.data;
    if (d.dead) return { ok: false, reason: 'dead' };
    var t = d.tournament;
    if (!t || t.done) return { ok: false, reason: 'no-tournament' };
    if (t.lastMatchDay === d.day) return { ok: false, reason: 'already-played-today' }; // §9: one match/day
    var round = t.bracket[t.bracket.length - 1];
    var match = null;
    for (var i = 0; i < round.length; i++) {
      var m = round[i];
      if (!m.done && ((m.a && m.a.isYou) || (m.b && m.b.isYou))) { match = m; break; }
    }
    if (!match) return { ok: false, reason: 'no-player-match' };
    t.lastMatchDay = d.day; // §9: today is spent the moment the player's match is resolved, win or lose
    ensureBestOf(t, round, match);
    resolveMatchMap(d, match);   // ONE map — a Bo3 final is stepped a map a day

    var youAreA = !!(match.a && match.a.isYou);
    var yourMaps = youAreA ? match.mapsA : match.mapsB;
    var oppMaps = youAreA ? match.mapsB : match.mapsA;

    // A Bo3 that is still live: report the map, bank the day, and stop here.
    // Nothing downstream may run, because the round is not complete, the
    // player is NOT eliminated, and the bracket must not advance.
    if (!match.done) {
      var res0 = {
        ok: true, match: match, tournamentComplete: false, roundComplete: false,
        seriesLive: true, bestOf: match.bestOf,
        yourMaps: yourMaps, oppMaps: oppMaps,
        youWonMap: youAreA ? (match.scoreA > match.scoreB) : (match.scoreB > match.scoreA)
      };
      res0.youWon = res0.youWonMap; // per-map, for the animation
      commit();
      return res0;
    }

    var youWon = (match.winner === match.a && match.a.isYou) || (match.winner === match.b && match.b.isYou);

    /* V22 (owner item 6): SCOUT HYPE moves on every tournament MATCH, won or
       lost — this is the change that makes hype a performance stat instead of
       a diligence one. See Data.hype in js/data.js for the full rationale.

       Applied here, once per SERIES, not inside resolveMatchMap(): a Bo3 final
       is one tournament game, and paying per map would make the deepest match
       in the bracket worth triple. Same reasoning as the ELO award above it.

       This stacks with the placement bonus in finalizePlayerOutcome() — a run
       is worth the matches you won plus what the finish was worth, which is
       why those placement numbers were reduced at the same time. */
    var hypeCfg = Data().hype || {};
    d.hype = clamp(d.hype + (youWon ? (hypeCfg.tournamentWin || 0) : (hypeCfg.tournamentLoss || 0)), 0, 100);

    var res = {
      ok: true, match: match, youWon: youWon, tournamentComplete: false,
      bestOf: match.bestOf, yourMaps: yourMaps, oppMaps: oppMaps,
      seriesLive: false, youWonMap: youAreA ? (match.scoreA > match.scoreB) : (match.scoreB > match.scoreA),
      hypeDelta: youWon ? (hypeCfg.tournamentWin || 0) : (hypeCfg.tournamentLoss || 0)
    };

    if (!youWon) {
      var eliminatedAtRound = t.bracket.length - 1;
      var out = finalizePlayerOutcome(d, t, false, eliminatedAtRound);
      res.tournamentComplete = true; res.placement = out.placement; res.prize = out.prize; res.heatBoost = out.heatBoost;
      commit();
      return res;
    }

    autoResolveNonPlayerMatches(d, round, t);
    var roundComplete = round.every(function (rm) { return rm.done; });
    res.roundComplete = roundComplete;
    if (roundComplete) {
      if (round.length === 1) {
        var champOut = finalizePlayerOutcome(d, t, true, null);
        res.tournamentComplete = true; res.placement = champOut.placement; res.prize = champOut.prize; res.heatBoost = champOut.heatBoost;
      } else {
        var next = buildNextRound(t, round);
        autoResolveNonPlayerMatches(d, next, t);
        t.bracket.push(next);
      }
    }
    commit();
    return res;
  };

  State.tournamentStatus = function () { return State.data.tournament; };
  State.tournamentHistory = function () { return (State.data.tournamentHistory || []).slice(); };
  // State.nextTournamentInDays() (SPEC-V6 §9): now driven by
  // d.nextPlayerTournamentDay (set on the player's own event concluding),
  // not the whole-board background cycle.
  State.nextTournamentInDays = function () {
    var d = State.data;
    if (d.contract === 'free') return null;
    if (d.tournament && !d.tournament.done) return 0;
    return Math.max(0, (d.nextPlayerTournamentDay || 0) - d.day);
  };
  // State.canPlayTournamentMatchToday() (SPEC-V6 §9): read-only — whether
  // the player's next tournament match is playable right now, or already
  // spent for today (mirrors State.sleepGateStatus()'s pattern).
  State.canPlayTournamentMatchToday = function () {
    var d = State.data;
    var t = d.tournament;
    if (!t || t.done) return { canPlay: false, reason: 'no-tournament' };
    if (t.lastMatchDay === d.day) return { canPlay: false, reason: 'already-played-today' };
    return { canPlay: true, reason: null };
  };

  // State.tournamentMatchAvailableToday() (SPEC-V7 §5 — the sleep deadlock
  // fix): boolean convenience wrapper around canPlayTournamentMatchToday().
  // THIS is the predicate the hub's SLEEP gate must use — "is there an
  // unplayed tournament match the player can actually play right now" —
  // as distinct from the old (broken) js/hub.js `tournamentPending()`
  // check of "a bracket exists and isn't done". That older check stays
  // true for the rest of the day after the player has already won today's
  // one-match-per-day tournament match (SPEC-V6 §9), since the bracket
  // itself isn't finished yet — but the next match only unlocks tomorrow,
  // so SLEEP (the only way to reach tomorrow) was blocked too: a deadlock.
  // This wrapper is false in exactly that situation (reason
  // 'already-played-today'), so SLEEP correctly stays open. True only when
  // a tournament exists, isn't finished, AND today's match hasn't been
  // played yet. Covers all four cases: no tournament/bracket -> false
  // ('no-tournament'); tournament won or lost and now finished -> false
  // ('no-tournament', since finalizePlayerOutcome sets t.done = true);
  // today's match already resolved (win or loss that continues the
  // bracket) -> false ('already-played-today'); a new day has begun with a
  // live, unfinished bracket and no match played yet today -> true.
  State.tournamentMatchAvailableToday = function () {
    return State.canPlayTournamentMatchToday().canPlay;
  };

  /* ---- contracts & chemistry (§5.5) ----------------------------------------- */
  State.canSign = function (id) {
    var c = Data().contracts[id];
    if (!c || !c.require) return false;
    var d = State.data;
    var req = c.require;
    if (req.contract && d.contract !== req.contract) return false;
    if (req.elo && d.elo < req.elo) return false;
    if (req.hype && d.hype < req.hype) return false;
    if (req.chemistry && d.chemistry < req.chemistry) return false;
    if (id === 't1' && d.chemistry < 30) return false;
    return true;
  };

  State.signContract = function (id) {
    if (!roomCompletenessFor(State.data).complete) return false; // SPEC-V5 §5r
    if (!State.canSign(id)) return false;
    State.data.contract = id;
    State.data.consecutiveScrimMisses = 0; // SPEC-V6 §25: fresh contract, fresh cumulative miss count
    commit();
    return true;
  };

  /* SPEC-V2 §8: scrims are only legal once signed to a team.
     SPEC-V13 §5A: return type is an object, not a bare boolean, so the
     caller (career.js) can report the REAL chemistry gain instead of a
     stale hardcoded number.
     { ok: true,  chemistry: <2-4, the exact amount granted> }
     { ok: false, reason: 'dead' | 'no-team' | 'energy' }
     js/career.js:115 is the only caller. */
  State.scrim = function () {
    if (State.data.dead) return { ok: false, reason: 'dead' };
    if (State.data.contract === 'free') return { ok: false, reason: 'no-team' };
    if (!State.useEnergy(Data().energyCosts.scrim)) return { ok: false, reason: 'energy' };
    // SPEC-V6 §26: 2-4 chemistry per scrim (was a flat 12).
    var gain = randInt(2, 4);
    State.data.chemistry = clamp(State.data.chemistry + gain, 0, 100);
    State.data.scrimsToday += Data().energyCosts.scrim;
    State.data.scrimEverCompleted = true; // SPEC-V15-BATCH-C §1 `first_scrim` trigger latch — d.scrimsToday
                                           // resets nightly, so it can't answer "ever completed one"
    commit();
    return { ok: true, chemistry: gain };
  };

  /* ---- cases (SPEC-V3 §11/§12 — REPLACES SPEC-V2 §12 values + $2.50 cost) --
     The pulled skin is sold immediately; nothing is written to `inventory`
     any more. `sellInventoryItem`/`displayInventoryItem` below are kept
     (and still operate on `inventory`/`displayCase`) purely so any item that
     arrived via a pre-V2 migrated save, or a future caller, doesn't crash —
     but openCase() itself no longer feeds them.

     The gold (RARE SPECIAL) tier's real two-tier value roll is intentionally
     hardcoded here as private constants and NEVER attached to Data.caseOdds
     or the returned `odds`/`rarity` objects — those only ever carry
     min:null/max:null/hidden:true for the gold row (see js/data.js), so
     nothing the UI can read exposes the split, per §11's explicit
     requirement. Do not "helpfully" surface these constants anywhere
     visible. */
  // GOLD_* are the BASE ($7 case) hidden two-tier gold sub-ranges — scaled
  // by the same cost/Data.caseCost multiplier as every other rarity band for
  // any other tier (see caseValueMultiplier()/scaledCaseOdds() below). Still
  // never attached to Data.caseOdds/Data.caseTiers or any returned
  // `odds`/`rarity` object, at any tier — nothing UI-readable exposes the
  // split, per SPEC-V3 §11 (unchanged by SPEC-V15 §7).
  var GOLD_LOW_CHANCE = 2 / 3;   // 2/3 of gold hits
  var GOLD_LOW_MIN = 90, GOLD_LOW_MAX = 150;
  var GOLD_HIGH_MIN = 250, GOLD_HIGH_MAX = 500; // remaining 1/3

  // findCaseTier: STRICT lookup — null if `id` isn't a real tier. Deliberately
  // no silent fallback-to-default here (that would defeat State.setCaseSelection()/
  // State.openCase(opts.caseId)'s ability to reject a bad id); callers that
  // actually want a safe default (ensureCaseSelection below) do so explicitly.
  function findCaseTier(id) {
    var arr = Data().caseTiers || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  State.findCaseTier = findCaseTier;

  // caseValueMultiplier/scaledCaseOdds (SPEC-V15 §7): THE single derivation
  // of a tier's value bands from the $7 case's own Data.caseOdds numbers —
  // never a second hand-written copy of the ranges per tier. Cost scales the
  // multiplier; the chance table (Data.caseOdds's `chance` fields) is IDENTICAL
  // at every tier, exactly per spec ("keep the existing system and odds").
  // Used by BOTH State.openCase() (the real roll) and State.caseTiers() (the
  // UI preview), so what a player is shown can never drift from what they get.
  function caseValueMultiplier(tier) {
    var baseCost = Data().caseCost || 7;
    return tier ? (tier.cost / baseCost) : 1;
  }
  function scaledCaseOdds(tier) {
    var mult = caseValueMultiplier(tier);
    var base = Data().caseOdds || [];
    return base.map(function (o) {
      return {
        id: o.id, label: o.label, chance: o.chance, colorVar: o.colorVar, hidden: !!o.hidden,
        min: (o.min == null) ? null : Math.round(o.min * mult * 100) / 100,
        max: (o.max == null) ? null : Math.round(o.max * mult * 100) / 100
      };
    });
  }

  // ensureCaseSelection (SPEC-V15 §10): defensive lazy-fill, same pattern as
  // ensureSocial()/ensureTeams() — cheap no-op once a save already has both
  // halves set (normalizeSave's nested merge already guarantees this for any
  // save that went through load(), but State.data can be poked directly by
  // tests/tools, so every public entry point below still defends itself).
  function ensureCaseSelection(d) {
    var baseId = (Data().caseTiers && Data().caseTiers[0]) ? Data().caseTiers[0].id : 'case_standard';
    if (!d.caseSelection) d.caseSelection = { solo: baseId, stream: baseId };
    if (!findCaseTier(d.caseSelection.solo)) d.caseSelection.solo = baseId;
    if (!findCaseTier(d.caseSelection.stream)) d.caseSelection.stream = baseId;
  }

  // State.caseTiers(): every case tier the shop/case-opening UI can list,
  // each with its scaled (non-hidden) value bands and an `affordable` flag
  // against the player's CURRENT cash — SPEC-V15 §7's "a case the player
  // can't afford must be selectable but clearly show CAN'T AFFORD, never
  // hidden" is a UI decision, this just supplies the boolean so cases.js/
  // shop.js never re-derive the cash-vs-cost comparison a second way.
  State.caseTiers = function () {
    var d = State.data;
    return (Data().caseTiers || []).map(function (tier) {
      return { id: tier.id, label: tier.label, cost: tier.cost, affordable: (d.cash || 0) >= tier.cost, odds: scaledCaseOdds(tier) };
    });
  };

  // State.caseSelection()/State.setCaseSelection() (SPEC-V15 §10): which
  // case tier opens solo vs on stream, set independently. Energy cost is
  // untouched by tier (still 1 off-stream / 0 on-stream — see State.openCase).
  State.caseSelection = function () {
    var d = State.data;
    ensureCaseSelection(d);
    return { solo: d.caseSelection.solo, stream: d.caseSelection.stream };
  };
  State.setCaseSelection = function (slot, caseId) {
    var d = State.data;
    ensureCaseSelection(d);
    if (slot !== 'solo' && slot !== 'stream') return { ok: false, reason: 'invalid-slot' };
    var tier = findCaseTier(caseId);
    if (!tier) return { ok: false, reason: 'invalid-case' };
    d.caseSelection[slot] = tier.id;
    commit();
    return { ok: true, caseSelection: { solo: d.caseSelection.solo, stream: d.caseSelection.stream } };
  };

  // SPEC-V5 §3/§21: the roll happens (and the case's cost is charged) the
  // moment the player opens a case, but the value is NOT credited yet — only
  // exposed — so Package R's wheel can animate first and credit on reveal via
  // State.creditCaseReveal(pendingId) once it actually stops. Persisted as
  // State.data.pendingCaseReveal so a reload mid-animation doesn't lose or
  // duplicate the pending value (see the save-schema note in defaultData()).
  // SPEC-V15 §7/§10: `opts.caseId` lets a caller open a SPECIFIC tier
  // directly (used by the simulation harness and available to the UI); when
  // omitted, the tier comes from d.caseSelection.solo/.stream depending on
  // `opts.onStream` — the player's standing per-context choice.
  State.openCase = function (opts) {
    opts = opts || {};
    if (State.data.dead) return { ok: false, reason: 'dead' };
    var rc = roomCompletenessFor(State.data);
    if (!rc.complete) return { ok: false, reason: 'room-incomplete', missing: rc.missing };
    var d = State.data;
    ensureCaseSelection(d);
    var onStream = !!opts.onStream; // SPEC-V3 §12: caller says whether this open is happening on stream
    var tierId = opts.caseId || d.caseSelection[onStream ? 'stream' : 'solo'];
    var tier = findCaseTier(tierId);
    if (!tier) return { ok: false, reason: 'invalid-case' };
    var energyCost = onStream ? 0 : (Data().energyCosts.case != null ? Data().energyCosts.case : 1);
    if (State.data.energy < energyCost) return { ok: false, reason: 'energy' };
    if (!State.spend(tier.cost)) return { ok: false, reason: 'cash' };
    if (energyCost > 0) State.useEnergy(energyCost);

    var luck = State.gearBonus().luck; // 0..0.5
    var base = scaledCaseOdds(tier);
    var adjusted = base.map(function (o) {
      return { id: o.id, label: o.label, min: o.min, max: o.max, hidden: !!o.hidden, colorVar: o.colorVar, chance: o.chance };
    });
    var shiftPool = adjusted[0].chance * luck * 0.5;
    var top3Total = adjusted[2].chance + adjusted[3].chance + adjusted[4].chance;
    adjusted[0].chance -= shiftPool;
    for (var i = 2; i < 5; i++) {
      adjusted[i].chance += shiftPool * (base[i].chance / top3Total);
    }
    var roll = Math.random(), cum = 0, picked = adjusted[0];
    for (var j = 0; j < adjusted.length; j++) {
      cum += adjusted[j].chance;
      if (roll <= cum) { picked = adjusted[j]; break; }
    }

    var value;
    if (picked.id === 'rare') {
      // hidden two-tier gold roll (SPEC-V3 §11), scaled to this tier by the
      // SAME multiplier as every other band — see caseValueMultiplier() above.
      var mult = caseValueMultiplier(tier);
      value = (Math.random() < GOLD_LOW_CHANCE)
        ? rand(GOLD_LOW_MIN * mult, GOLD_LOW_MAX * mult)
        : rand(GOLD_HIGH_MIN * mult, GOLD_HIGH_MAX * mult);
    } else {
      value = rand(picked.min, picked.max);
    }
    value = Math.round(value * 100) / 100;

    /* V22 (owner item 2): the pool is PER CASE now — Data.skinsForCase() is
       the single resolver js/cases.js's roulette strip also reads, so the
       items rushing past the wheel are by construction the items this case can
       actually drop. `tier.id` is the case id (case_standard/prime/elite),
       the same value d.caseSelection stores.

       Entries are objects ({ name, sprite }) rather than bare strings; `skin`
       on the item keeps holding the NAME only, because that string is written
       into saved inventory and is what every existing reader expects. The
       sprite is looked up from the name at render time instead of being
       duplicated into the save. */
    var pool = Data().skinsForCase(tier.id, picked.id);
    var entry = pool[Math.floor(Math.random() * pool.length)] || { name: picked.label };
    var name = entry.name;
    var wear = Data().wears[Math.floor(Math.random() * Data().wears.length)];
    var cost = tier.cost;
    var item = { id: genId(), skin: name, rarity: picked.id, wear: wear, value: value, displayed: false };

    // §3/§21: opening is counted now (the cost is already spent above), but
    // the payout itself is held — cash/bestPull are only touched by
    // State.creditCaseReveal() once the wheel actually stops.
    State.data.stats.casesOpened += 1;
    var pendingId = genId();
    State.data.pendingCaseReveal = { id: pendingId, value: value, item: item, onStream: onStream };
    commit();

    return {
      ok: true,
      pendingId: pendingId,
      item: item,
      rarity: picked,
      odds: adjusted,
      sold: false,
      credited: false,      // caller must call State.creditCaseReveal(pendingId) when the wheel stops
      value: value,         // exposed up-front so the wheel/UI knows what to land on
      cost: cost,
      caseId: tier.id,
      caseLabel: tier.label,
      net: value - cost,    // negative = lost money on this pull, for the "SOLD — +$X" vs cost UI
      onStream: onStream,
      energySpent: energyCost
    };
  };

  // State.creditCaseReveal(pendingId): credits the held case value to cash
  // and stats.bestPull — call exactly once, when the wheel visually stops
  // (§3/§21). No-ops safely if pendingId doesn't match (e.g. already
  // credited, or a stale id from a previous load).
  State.creditCaseReveal = function (pendingId) {
    var d = State.data;
    var pending = d.pendingCaseReveal;
    if (!pending || pending.id !== pendingId) return { ok: false, reason: 'not-found' };
    d.cash += pending.value;
    d.stats.bestPull = Math.max(d.stats.bestPull, pending.value);
    d.pendingCaseReveal = null;
    commit();
    return { ok: true, value: pending.value, cash: d.cash };
  };

  // State.discardPendingCaseReveal(): escape hatch if the UI abandons the
  // reveal animation (e.g. navigated away) without crediting — does NOT
  // refund the $7 (mirrors the rest of the app's "no refunds" stance).
  State.discardPendingCaseReveal = function () {
    if (!State.data.pendingCaseReveal) return false;
    State.data.pendingCaseReveal = null;
    commit();
    return true;
  };

  State.sellInventoryItem = function (itemId) {
    var inv = State.data.inventory;
    for (var i = 0; i < inv.length; i++) {
      if (inv[i].id === itemId) {
        var val = inv[i].value;
        inv.splice(i, 1);
        // also drop from display case if it was shown there
        State.data.displayCase.items = State.data.displayCase.items.filter(function (id) { return id !== itemId; });
        State.data.cash += val;
        commit();
        return val;
      }
    }
    return false;
  };

  State.displayInventoryItem = function (itemId) {
    var inv = State.data.inventory;
    var item = null;
    for (var i = 0; i < inv.length; i++) if (inv[i].id === itemId) item = inv[i];
    if (!item) return false;
    if (item.rarity !== 'covert' && item.rarity !== 'rare') return false;
    if (State.data.displayCase.items.indexOf(itemId) !== -1) return false;
    if (State.data.displayCase.items.length >= 6) return false; // display case has 6 slots
    State.data.displayCase.items.push(itemId);
    item.displayed = true;
    commit();
    return true;
  };

  /* ---- stream (SPEC-V3 §7 prestige + §13 subscribers + SPEC-V2 §7 streamMult)
     — session mechanics live in js/stream.js, this just commits the final
     result to the save. Location `streamMult` multiplies cash; prestige
     (§7: +2% base stream viewers per point) multiplies the recorded
     peakViewers/followers — this IS "the stream payout path actually
     consuming it" per spec. §13: 8% of the (post-prestige) follower gain
     converts to subscribers, and each point of the former `income` gear
     stat raises that conversion rate +5% — this IS that stat's new,
     non-orphaned effect. stream.js's own live in-session viewer simulation
     (sess.viewers during the 45s minigame) is untouched this round. ------ */
  /* streamMultipliers — the location/tier factors a stream's payout is scaled
     by, as data rather than as arithmetic buried inside applyStreamResult().

     It is exported because js/stream.js needs the SAME numbers to show a live
     earnings counter that agrees with what actually lands in the wallet. The
     counter used to display the unscaled figure while applyStreamResult()
     credited the scaled one, so a stream that paid ~$25,000 announced $10,000
     — reported by a playtester, and the reason this function exists. Deriving
     the multiplier a second time over in stream.js would be exactly the stale
     second copy HANDOFF-V2 §5.4 warns about, so there is one source and both
     callers read it.

     `d` is optional and defaults to the live save, so a caller can ask about a
     hypothetical state without mutating anything. */
  State.streamMultipliers = function (d) {
    d = d || State.data;
    var loc = locationDef(d.locationId) || Data().locations[0];
    var tier = d.contract || 'free';
    var streamMult = (loc && loc.streamMult) || 1;
    var tierViewerMult = (Data().streamTierViewerMult || {})[tier] || 1;
    var tierDonationMult = (Data().streamTierDonationMult || {})[tier] || 1;
    return {
      streamMult: streamMult,
      tierViewerMult: tierViewerMult,
      tierDonationMult: tierDonationMult,
      // What a raw cash figure must be multiplied by to become the credited
      // amount. Viewer and donation scaling BOTH land on cash (§14: a bigger
      // audience of richer viewers), which is why all three are in this product.
      cash: streamMult * tierViewerMult * tierDonationMult
    };
  };

  State.applyStreamResult = function (res) {
    res = res || {};
    var gear = State.gearBonus();
    var viewerMult = 1 + (gear.prestige || 0) * 0.02; // SPEC-V3 §7: +2% base stream viewers per prestige point
    // SPEC-V5 §14: a tier multiplier on top of everything above — bigger
    // audience (more viewers/followers) AND richer viewers (higher
    // per-viewer donation value) both rise with the player's signed tier.
    // Keeps the existing follower/prestige contributions untouched, just
    // layers this on top.
    var mult = State.streamMultipliers();
    var streamMult = mult.streamMult;
    var tierViewerMult = mult.tierViewerMult;
    var tierDonationMult = mult.tierDonationMult;
    var cash = (res.cash || 0) * mult.cash;
    // SPEC-V20 §4: +5% stream views AND subscriber gain (flat, non-stacking)
    // while a banner or neon sign is placed — see merchandiseBonusActive()
    // above. Applied to followersRaw (subscribersGained below derives from
    // this same boosted value, so it inherits the +5% too) and peakViewers
    // ("views") identically.
    var merchMult = 1 + State.merchandiseBonusPct();
    // SPEC-V6 §2: followers/subscribers/peakViewers are whole people —
    // round AT THE POINT OF ACCRUAL. `followers` below is the raw (possibly
    // fractional) gain from this stream only — subscribersGained is derived
    // from it BEFORE rounding (so a tiny stream doesn't lose its sub
    // contribution to rounding), then the accrual onto State.data.followers
    // itself rounds the running total to an integer.
    var followersRaw = (res.followers || 0) * viewerMult * tierViewerMult * merchMult;
    var peakViewers = Math.round((res.peakViewers || 0) * viewerMult * tierViewerMult * merchMult);
    State.data.cash += cash;
    State.data.followers = Math.round((State.data.followers || 0) + followersRaw);
    if (peakViewers > State.data.peakViewers) {
      State.data.peakViewers = peakViewers;
    }

    // SPEC-V3 §13: subscribers replace idle income. Base 8% of this stream's
    // follower gain converts to subscribers; the former `income` gear stat
    // (Data.subscriberConversionPerPoint per point) raises that rate. Round
    // sensibly, never negative. (§2: subscribers are whole people too.)
    // SPEC-V9 §3: social followers ALSO improve conversion, stacking with
    // the income-gear bonus above — +1% per 1,000 total social followers,
    // capped at +30% (Data.socialSubscriberConversionCap) so it can never
    // dominate the base rate.
    var socialBonus = Math.min(
      Data().socialSubscriberConversionCap || 0,
      (totalSocialFollowers(State.data) / 1000) * (Data().socialSubscriberConversionPerThousand || 0)
    );
    var subRate = Data().subscriberConversionBase + (gear.income || 0) * Data().subscriberConversionPerPoint + socialBonus;
    var subscribersGained = Math.max(0, Math.round(followersRaw * subRate));
    State.data.subscribers = Math.round((State.data.subscribers || 0) + subscribersGained);

    State.data.stats.streams += 1;
    // SPEC-V8 §2: advance `stream_days`/`stream_minutes` sponsor obligations.
    // Seconds, not minutes — see recordSponsorStreamSession's unit note.
    // res.durationMs is OPTIONAL (ms); js/stream.js does pass it. /1000, not
    // /60000 — the obligation counts seconds now.
    recordSponsorStreamSession(State.data, (res.durationMs || 0) / 1000);
    commit();
    return {
      appliedCash: cash, streamMult: streamMult, viewerMult: viewerMult,
      tierViewerMult: tierViewerMult, tierDonationMult: tierDonationMult,
      followers: Math.round(followersRaw), peakViewers: peakViewers, subscribersGained: subscribersGained,
      merchBonusPct: State.merchandiseBonusPct()
    };
  };

  // State.viewerCap() (SPEC-V6 §1): the dynamic viewer ceiling a stream
  // should ramp toward and plateau at — REPLACES the flat Data.streamViewerCap
  // (500) js/stream.js currently reads. streamCap = viewerCapBase *
  // streamCountFactor * followerFactor * tierFactor. Diminishing-returns
  // shape by design — do not linearise. Sanity targets (smoke-tested): a
  // brand-new save -> exactly 230; ~300 streams/200k followers/T1 -> 1-3
  // million.
  State.viewerCap = function () {
    var d = State.data;
    var D = Data();
    var streamsDone = (d.stats && d.stats.streams) || 0;
    var followers = d.followers || 0;
    // SPEC-V9 §3: social followers feed the SAME followerFactor at HALF the
    // weight of real followers — a brand-new save has 0 social followers so
    // this is a no-op there, keeping the existing "-> exactly 230" sanity
    // target intact.
    var effectiveFollowers = followers + totalSocialFollowers(d) * (D.socialViewerCapFollowerWeight || 0.5);
    var tier = d.contract || 'free';
    var tierFactor = (D.streamTierViewerMult || {})[tier] || 1;
    var streamCountFactor = Math.pow(1 + streamsDone / (D.viewerCapStreamDivisor || 25), D.viewerCapStreamExp || 1.6);
    var followerFactor = Math.pow(1 + effectiveFollowers / (D.viewerCapFollowerDivisor || 8000), D.viewerCapFollowerExp || 0.8);
    var cap = (D.viewerCapBase || 230) * streamCountFactor * followerFactor * tierFactor;
    return Math.round(cap);
  };

  /* ---- shop & room placement (§5.8, extended by SPEC-V3 §3/§10) ------------- */
  function autoPlaceSingleton(def) {
    var placed = State.data.placed;
    var oldX = null, oldY = null, oldRot = 0, oldIndex = -1;
    for (var i = 0; i < placed.length; i++) {
      var pdef = findShopItem(placed[i].id);
      if (pdef && pdef.category === def.category) {
        oldIndex = i; oldX = placed[i].x; oldY = placed[i].y; oldRot = placed[i].rot;
        break;
      }
    }
    if (oldIndex >= 0) placed.splice(oldIndex, 1);
    var anchor;
    if (def.category === 'chair') {
      anchor = { x: 1, y: 2 };
    } else if (def.category === 'monitor') {
      // SPEC-V5 §5r/§17: monitor sits on the desk, same tile as desk/pc.
      anchor = { x: 1, y: 1 };
    } else if (def.category === 'bed') {
      // SPEC-V12 §2: every bed now has a 2x1 footprint — anchor one tile
      // short of the true bottom-right corner (w-2, not w-1) so the
      // footprint's far edge, not its near edge, touches the reserved "bed"
      // corner tile canPlaceFootprint() carves out (SPEC-V3 §3). Anchoring
      // AT w-1 would push the second tile out of bounds. Matches
      // Data.defaultPlaced/ensureDefaultBed's same anchor math.
      var g = State.currentGrid();
      anchor = { x: Math.max(0, g.w - 2), y: g.d - 1 };
    } else {
      anchor = { x: 1, y: 1 };
    }
    placed.push({ id: def.id, x: oldX !== null ? oldX : anchor.x, y: oldY !== null ? oldY : anchor.y, rot: oldRot });
  }

  // SPEC-V6 §16: sum of PLACED energy-category items (was: owned, SPEC-V5
  // §6r) — this is what's capped at Data.energyItemCap (4) now. Ownership is
  // unlimited; only placement is capped. (Old name kept — extend, don't
  // rename.)
  function totalEnergyItemQty(d) {
    var total = 0;
    var placed = d.placed || [];
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.category === 'energy') total++;
    }
    return total;
  }
  // State.energyItemStatus(): read-only — how many energy-category items are
  // PLACED vs. the hard cap (SPEC-V6 §16 — was owned-total). `ownedTotal` is
  // additive: how many are owned in the stockpile regardless of placement,
  // for the shop to show "own any number, only 4 count while placed".
  State.energyItemStatus = function () {
    var cap = Data().energyItemCap || 4;
    var total = totalEnergyItemQty(State.data);
    var ownedTotal = 0;
    var items = Data().shopItems;
    for (var i = 0; i < items.length; i++) {
      if (items[i].category === 'energy') ownedTotal += (State.data.owned[items[i].id] || 0);
    }
    return { total: total, cap: cap, remaining: Math.max(0, cap - total), atCap: total >= cap, ownedTotal: ownedTotal };
  };

  State.buyItem = function (itemId) {
    if (State.data.dead) return false;
    var def = findShopItem(itemId);
    if (!def) return false;
    // SPEC-V7 §3 / SPEC-V11 §2: energy drinks are locked until a
    // storage-providing energy fridge is placed, and buying beyond the
    // placed fridges' combined capacity is blocked outright — see
    // State.fridgeStatus()/currentFridgeCapacity(). Package Z's shop UI
    // should check State.fridgeStatus().reason itself to show why BEFORE
    // even attempting the buy (this is the hard backstop either way).
    if (def.requiresFridge && !State.fridgeStatus().canBuyDrink) return false;
    // SPEC-V6 §16: the old "max 4 owned" cap on energy items is GONE — you
    // may own any number; only PLACEMENT is capped (enforced in
    // State.placeItem() below).
    if (!State.spend(def.price)) return false;
    State.data.owned[itemId] = (State.data.owned[itemId] || 0) + 1;
    if (def.category === 'room' && def.roomTier != null && def.roomTier > State.data.roomTier) {
      State.data.roomTier = def.roomTier;
    }
    // SPEC-V5 §17: every singleton category — desk, chair, PC, monitor, bed
    // — replaces its predecessor in the room immediately on purchase.
    if (def.category === 'desk' || def.category === 'pc' || def.category === 'chair' ||
        def.category === 'monitor' || def.category === 'bed') {
      autoPlaceSingleton(def);
    }
    // SPEC-V6 §3: energy drinks are a `consumable` now — buying just grows
    // the stockpile (owned[] above already did that); never placed, never
    // touches energyMax.
    commit();
    return true;
  };

  // SINGLETON_ROOM_CATEGORIES (SPEC-V6 §24): every one of these must always
  // keep AT LEAST ONE placed instance; any instance BEYOND the first for
  // that category is surplus and may always be picked up. This is the one
  // real rule — REPLACES the old "these categories can never be emptied at
  // all" blanket block, which is what made a surplus starter chair
  // impossible to pick up once a better one was also placed.
  var SINGLETON_ROOM_CATEGORIES = ['desk', 'pc', 'chair', 'monitor', 'bed'];

  // Exported (additive) so hub.js can read the live list instead of keeping
  // its own hardcoded mirror — a prior drift between the two (hub.js's copy
  // omitted 'bed') made tapping a placed bed a silent no-op in EDIT ROOM.
  State.SINGLETON_ROOM_CATEGORIES = SINGLETON_ROOM_CATEGORIES;

  // ============================================================ SPEC-V12 ==
  // FOOTPRINT & TILE OCCUPANCY — the ONE place this rule lives (§3). Every
  // caller — this file's own placeItem/moveItem/rotateItem below AND
  // js/hub.js's tileValid()/pendingTileValid()/ghost preview/prop picking —
  // reads or derives from these exports instead of keeping a second copy.
  // Follows the exact pattern SPEC-V11 established for
  // State.SINGLETON_ROOM_CATEGORIES (exported, hub.js falls back to a local
  // literal only if the export is somehow missing).
  //
  // Regression root cause (§1, verified before fixing): js/hub.js's OLD
  // pendingTileValid() had a "moving a core singleton" branch that, once a
  // category was in isCoreSingleton()'s list, returned `true` UNCONDITIONALLY
  // (bounds + bed-corner + a monitor-only desk check aside) — it never
  // checked what else already occupied the destination tile. That branch
  // covered desk/pc/chair/monitor from the start (not just the newly-added
  // bed): moving an already-placed CHAIR onto the desk's own tile, for
  // instance, was already silently allowed before bed was ever added to
  // isCoreSingleton(). Adding 'bed' to that same list just made the same
  // pre-existing hole apply to a 2-tile prop too, which is what turned a
  // narrow desk/pc/monitor convenience into visible "props stacked inside
  // each other". The fix below removes the relaxed branch entirely — MOVING
  // now validates through the exact same canPlaceFootprint() the PLACING
  // path always used, just with the item's own current slot excluded from
  // the occupancy scan so it never blocks against itself.
  // ==========================================================================

  // itemFootprint (§2): every shop item's tile footprint, defaulting to 1x1
  // for anything without an explicit `footprint` on its Data.shopItems entry
  // (currently only the bed_* ids carry one — see js/data.js).
  function itemFootprint(def) {
    var fp = def && def.footprint;
    return { w: (fp && fp.w) || 1, d: (fp && fp.d) || 1 };
  }
  State.itemFootprint = itemFootprint;

  // footprintTiles (§2): every grid tile `def`'s footprint covers, anchored
  // at (x,y), at rotation `rot` (0-3, 90° steps). At rot 0/180 the declared
  // w runs along x and d along y; at rot 90/270 they swap — a 2x1 bed
  // (w:2,d:1) spans (x,y)+(x+1,y) at 0/180 and (x,y)+(x,y+1) at 90/270,
  // exactly the rule SPEC-V12 §2 spells out. This is the ONLY place tile
  // coverage is computed for a placed/pending item — every occupancy check,
  // the ghost preview, and prop-picking all call this rather than assuming
  // 1x1.
  function footprintTiles(def, x, y, rot) {
    var fp = itemFootprint(def);
    var odd = ((rot || 0) % 2) === 1;
    var w = odd ? fp.d : fp.w;
    var d = odd ? fp.w : fp.d;
    var tiles = [];
    for (var dx = 0; dx < w; dx++) {
      for (var dy = 0; dy < d; dy++) tiles.push({ x: x + dx, y: y + dy });
    }
    return tiles;
  }
  State.footprintTiles = footprintTiles;

  /* SHARED_TILE_CATEGORIES (§1): the ONE co-tenancy exception — a desk and a
     monitor may share a tile with each other. Every other category (bed,
     plant, poster, rug, RGB strip, trophy shelf, energy items, fridges, cat,
     all decor) is exclusive in both directions: it can't be placed on an
     occupied tile, and nothing else can be placed on its tile(s). A tile may
     still never hold two props of the SAME category regardless of group (two
     desks, two monitors, two beds — all blocked) — see categoriesMayShareTile().

     HISTORY, because this has now moved twice and the reason matters:
     `pc` was removed from this list (V22 item 15) so a tower would need its own
     square, then RESTORED (V22 item 4) at the owner's request. The removal was
     not the real fix — the actual complaint was that the tower OVERLAPPED the
     desk and monitor at most rotations, and giving it a separate tile only hid
     that by moving it away.

     It is back on the shared tile, but the overlap is now fixed properly, at
     the source, in js/iso.js:
       - props.pc sits in the BACK half of the tile (local y 0.10..0.46) while
         every desk tier occupies the FRONT half (y >= 0.50), so the two
         volumes cannot intersect at any tier;
       - CATEGORY_ORDER puts `pc` BEHIND desk and monitor, so where they do
         visually meet the tower is occluded rather than punching through.
     Because a workstation rotates as a GROUP (moveGroup shares one rot across
     desk/pc/monitor), front-half vs back-half holds at all four rotations.

     This one literal is the whole rule: categoriesMayShareTile(),
     canPlaceFootprint()'s occupancy scan and groupIndicesFor()'s workstation
     grouping all derive from it — no second list to keep in step. */
  var SHARED_TILE_CATEGORIES = ['desk', 'pc', 'monitor'];
  State.SHARED_TILE_CATEGORIES = SHARED_TILE_CATEGORIES;

  // categoriesMayShareTile: true only for two DIFFERENT categories that are
  // both in the shared group. Same category vs. itself is always false (no
  // tile ever holds two of the same category, shared group or not).
  function categoriesMayShareTile(a, b) {
    if (!a || !b || a === b) return false;
    return SHARED_TILE_CATEGORIES.indexOf(a) !== -1 && SHARED_TILE_CATEGORIES.indexOf(b) !== -1;
  }
  State.categoriesMayShareTile = categoriesMayShareTile;

  // tileOccupantsAt: every {idx, def} in `placedArr` whose OWN footprint
  // covers (x,y) — the footprint-aware replacement for the old single-tile
  // "p.x===x && p.y===y" scan. `excludeIdx` (an index into `placedArr`, or
  // -1) is skipped so a MOVING/ROTATING item never blocks against its own
  // current tiles. Takes the array explicitly (not State.data) so the same
  // logic can run over a raw save being normalized, before State.data
  // exists — see migrateBedFootprints() below.
  // SPEC-V13 §3A: excludeIdx now accepts a single index (existing callers,
  // unchanged) OR an array of indices (a whole workstation group excluding
  // itself from its own occupancy scan during a group move).
  function isExcludedIdx(i, excludeIdx) {
    if (excludeIdx == null) return false;
    if (Array.isArray(excludeIdx)) return excludeIdx.indexOf(i) !== -1;
    return i === excludeIdx;
  }
  function tileOccupantsAt(placedArr, x, y, excludeIdx) {
    var out = [];
    for (var i = 0; i < placedArr.length; i++) {
      if (isExcludedIdx(i, excludeIdx)) continue;
      var p = placedArr[i];
      var def = findShopItem(p.id);
      // SPEC-V15-BATCH-B §1: a wall-mounted item (def.mount === 'wall') never
      // occupies FLOOR space — it hangs on the wall plane, not the tile — so
      // it's invisible to every floor-occupancy scan. A desk/chair/etc. may
      // freely share the same tile as a banner. Wall-vs-wall collisions are
      // checked separately by wallOccupantsAt() below, the only place that
      // rule lives.
      if (!def || def.mount === 'wall') continue;
      var tiles = footprintTiles(def, p.x, p.y, p.rot || 0);
      for (var t = 0; t < tiles.length; t++) {
        if (tiles[t].x === x && tiles[t].y === y) { out.push({ idx: i, def: def }); break; }
      }
    }
    return out;
  }
  State.tileOccupantsAt = function (x, y, excludeIdx) {
    return tileOccupantsAt(State.data.placed, x, y, excludeIdx == null ? -1 : excludeIdx);
  };

  // ==================================================== SPEC-V15-BATCH-B ==
  // §1 — WALL MOUNTS: poster_team/window_blinds (def.mount === 'wall') only
  // occupy a WALL SLOT — a tile on the x===0 or y===0 edge — never the
  // floor. THE single source of truth for the whole rule lives here,
  // exported for js/hub.js to derive from (canPlaceFootprint's def.mount
  // branch below, plus placeItem/moveItem's rotation override). Do not add
  // a second wall check anywhere else — see the file-level comment above
  // canPlaceFootprint for why that pattern has repeatedly caused bugs.
  //
  // isWallSlot: is (x,y) a legal wall slot in the CURRENT room? In-bounds
  // AND on the x===0 or y===0 edge (the two visible walls in this isometric
  // view — see js/iso.js's drawWalls).
  function isWallSlot(x, y) {
    var grid = State.currentGrid();
    if (x == null || y == null) return false;
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.d) return false;
    return x === 0 || y === 0;
  }
  State.isWallSlot = isWallSlot;

  // wallRotForTile: rotation is DERIVED, never chosen (owner's report — a
  // ROTATE tap that no-ops is what generated the original bug reports). A
  // wall item auto-orients to whichever wall it's anchored on: the y===0
  // wall gets WALL_ROT_BACK, the x===0 wall gets WALL_ROT_SIDE. The corner
  // tile (0,0) satisfies both — defaults to the y===0/back wall per spec.
  var WALL_ROT_BACK = 0; // y === 0 wall
  var WALL_ROT_SIDE = 1; // x === 0 wall (y > 0, since (0,0) already returned above)
  function wallRotForTile(x, y) {
    return y === 0 ? WALL_ROT_BACK : WALL_ROT_SIDE;
  }
  State.wallRotForTile = wallRotForTile;

  // wallFootprintTiles (SPEC-V20 §1): every wall slot a wall-mounted item
  // anchored at (x,y) occupies — 1 tile for every existing wall item
  // (banner, blinds, neon-as-decor, etc.), 2 ADJACENT wall slots for a WIDE
  // window (`footprint: {w:2,d:1}`), running along whichever wall the anchor
  // sits on (derived via wallRotForTile — never a caller-chosen direction,
  // same "derived not chosen" rule as rotation itself). This is the ONLY
  // place wall-tile coverage is computed for a wall item — canPlaceFootprint
  // and wallOccupantsAt both call this rather than assuming 1x1, exactly
  // mirroring how footprintTiles() is the one source of truth for floor
  // items. A 1x1 wall item's span is 1 regardless of rot.
  function wallFootprintTiles(x, y, def) {
    var fp = itemFootprint(def);
    var span = Math.max(fp.w || 1, fp.d || 1);
    if (span <= 1) return [{ x: x, y: y }];
    var alongX = wallRotForTile(x, y) === WALL_ROT_BACK; // y===0 back wall runs along x; x===0 side wall runs along y
    var tiles = [];
    for (var i = 0; i < span; i++) {
      tiles.push(alongX ? { x: x + i, y: y } : { x: x, y: y + i });
    }
    return tiles;
  }
  State.wallFootprintTiles = wallFootprintTiles;

  // wallOccupantsAt: every OTHER wall-mounted item whose wall FOOTPRINT
  // (wallFootprintTiles — 1 tile, or 2 for a wide window) covers (x,y) — the
  // wall-slot equivalent of tileOccupantsAt's footprint-aware floor scan.
  // SPEC-V20 §1: footprint-aware (not bare p.x===x&&p.y===y) so a wide
  // window's SECOND tile is correctly seen as occupied by anything checking
  // that tile, not just the window's own anchor tile.
  function wallOccupantsAt(placedArr, x, y, excludeIdx) {
    var out = [];
    for (var i = 0; i < placedArr.length; i++) {
      if (isExcludedIdx(i, excludeIdx)) continue;
      var p = placedArr[i];
      var def = findShopItem(p.id);
      if (!def || def.mount !== 'wall') continue;
      var tiles = wallFootprintTiles(p.x, p.y, def);
      for (var t = 0; t < tiles.length; t++) {
        if (tiles[t].x === x && tiles[t].y === y) { out.push({ idx: i, def: def }); break; }
      }
    }
    return out;
  }
  State.wallOccupantsAt = function (x, y, excludeIdx) {
    return wallOccupantsAt(State.data.placed, x, y, excludeIdx == null ? -1 : excludeIdx);
  };

  // isWindowTile (SPEC-V20 §1, exported for other packages): is (x,y)
  // currently covered by a PLACED window's wall footprint? THE single source
  // of truth for "is this a window tile" — derived from the same
  // wallFootprintTiles() every other wall-coverage check uses.
  function isWindowTile(x, y) {
    var placed = State.data.placed;
    for (var i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (!def || def.category !== 'window') continue;
      var tiles = wallFootprintTiles(placed[i].x, placed[i].y, def);
      for (var t = 0; t < tiles.length; t++) {
        if (tiles[t].x === x && tiles[t].y === y) return true;
      }
    }
    return false;
  }
  State.isWindowTile = isWindowTile;

  // windowCoverageComplete (SPEC-V20 §3): true only when the room has at
  // least one PLACED window AND every wall tile every placed window covers
  // also holds a CLOSED blind. Zero placed windows (whether or not any are
  // owned) always returns false — this is what keeps the sleep buff from
  // being earned "by owning nothing" per spec. THE single source of truth —
  // State.blindsBonusActive() and the sleep-rate math in doTick()/canWake()
  // below both call this, never a second copy of the coverage rule.
  function windowCoverageComplete(d) {
    var placed = (d || State.data).placed || [];
    var windows = [];
    var i;
    for (i = 0; i < placed.length; i++) {
      var def = findShopItem(placed[i].id);
      if (def && def.category === 'window') windows.push({ entry: placed[i], def: def });
    }
    if (!windows.length) return false;
    for (var w = 0; w < windows.length; w++) {
      var tiles = wallFootprintTiles(windows[w].entry.x, windows[w].entry.y, windows[w].def);
      for (var t = 0; t < tiles.length; t++) {
        var covered = false;
        for (var j = 0; j < placed.length; j++) {
          var bdef = findShopItem(placed[j].id);
          if (bdef && bdef.category === 'blind' && placed[j].x === tiles[t].x && placed[j].y === tiles[t].y && placed[j].closed) {
            covered = true;
            break;
          }
        }
        if (!covered) return false;
      }
    }
    return true;
  }
  State.blindsBonusActive = function () { return windowCoverageComplete(State.data); };

  // effectiveSleepRate (SPEC-V20 §3): the bed's base sleepRate, boosted by
  // Data.blindsSleepBonusPct (+15%) whenever windowCoverageComplete(d) is
  // true. THE single source of truth for the boosted rate — doTick()'s sleep
  // branch, State.canWake(), and State.statsSummary()'s displayed rate all
  // call this rather than reading bed.sleepRate directly, so the buff can
  // never silently apply in one place and not another.
  function effectiveSleepRate(d) {
    var bed = currentBedDef();
    var rate = (bed && bed.sleepRate) || 2.5;
    if (windowCoverageComplete(d || State.data)) rate *= (1 + (Data().blindsSleepBonusPct || 0));
    return rate;
  }
  State.effectiveSleepRate = function () { return effectiveSleepRate(State.data); };

  // isCustomisable / isBlind (SPEC-V20 §7 + §3, exported for js/hub.js):
  // trivial catalog lookups, but centralized so hub.js never hardcodes the
  // id list of customisable/blind items — the `customisable`/category flags
  // on Data.shopItems (data.js) are the single source of truth.
  State.isCustomisable = function (itemId) {
    var def = findShopItem(itemId);
    return !!(def && def.customisable);
  };
  State.isBlind = function (itemId) {
    var def = findShopItem(itemId);
    return !!(def && def.category === 'blind');
  };

  // ---- SPEC-V21 §5: customisation (paint/colour) rules ---------------------
  //
  // Persistence note (do not "fix" this later): the tint lives ONLY on the
  // placed entry, `State.data.placed[i].tint` — there is no top-level mirror
  // and none should ever be added. normalizeSave() copies `placed` wholesale
  // (`for (var k in d) if (raw[k] !== undefined) d[k] = raw[k]`, see below),
  // so an arbitrary per-entry key already round-trips through save/reload
  // with no defaultData() change, exactly like `entry.closed` on a blind
  // (State.placeItem() above) already does. Verified directly with a fresh-
  // VM save/load in test-v21-customise.js. Adding a second copy of this value
  // anywhere else would be the §9.1 "two sources of truth" bug this project
  // has already shipped four times — don't.

  // customiseFamily: the ONE place that decides 'led' vs 'fabric' vs null for
  // an item id. Derives from the def flags (ledCustomise / customisable) —
  // js/customise.js and js/iso.js call this rather than re-deriving the
  // split themselves, and js/hub.js's own LED_CUSTOMISE_IDS heuristic is
  // retired now that `ledCustomise` exists on the three LED defs (§1).
  State.customiseFamily = function (itemId) {
    var def = findShopItem(itemId);
    if (!def || !def.customisable) return null;
    return def.ledCustomise ? 'led' : 'fabric';
  };

  // customisePalette: the swatch array for an item's family, or [] if the
  // item isn't customisable / the family has no palette. Reads
  // Data.customisePalettes (data.js) — never hardcode a colour list here or
  // anywhere that calls this.
  State.customisePalette = function (itemId) {
    var family = State.customiseFamily(itemId);
    if (!family) return [];
    var palettes = Data().customisePalettes || {};
    return palettes[family] || [];
  };

  // itemTint: the stored tint for a placed entry, or null (factory finish —
  // covers both "field absent" and an explicit null, so callers never need
  // to distinguish undefined from null).
  State.itemTint = function (placedIdx) {
    var entry = State.data.placed[placedIdx];
    return (entry && entry.tint) ? entry.tint : null;
  };

  // setItemTint: the only writer of placed[idx].tint. Validates against the
  // ITEM'S OWN family palette (not "any palette") so an LED colour can never
  // land on a blind or vice versa — the renderer (js/iso.js) must never
  // receive a value its palette doesn't contain. `tint === null` clears the
  // key entirely (delete, not the string "null") so a factory-finish item
  // serialises exactly like it never had a tint at all. Persists via
  // commit() — the same save path every other mutation in this file uses.
  State.setItemTint = function (placedIdx, tint) {
    var entry = State.data.placed[placedIdx];
    if (!entry) return { ok: false, reason: 'OUT OF RANGE' };
    if (!State.customiseFamily(entry.id)) return { ok: false, reason: 'NOT CUSTOMISABLE' };
    if (tint === null) {
      delete entry.tint;
      commit();
      return { ok: true };
    }
    var palette = State.customisePalette(entry.id);
    if (palette.indexOf(tint) === -1) return { ok: false, reason: 'UNKNOWN COLOUR' };
    entry.tint = tint;
    commit();
    return { ok: true };
  };

  // toggleBlind (SPEC-V20 §3): flips a placed blind's open/closed state.
  // Package H wires the actual "tap a placed blind outside a move" gesture —
  // this is the state mutation it calls. `idx` is the item's index into
  // State.data.placed (same indexing moveItem/rotateItem/removePlacedAt use).
  State.toggleBlind = function (idx) {
    var entry = State.data.placed[idx];
    if (!entry) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var def = findShopItem(entry.id);
    if (!def || def.category !== 'blind') return { ok: false, reason: 'NOT A BLIND' };
    entry.closed = !entry.closed;
    commit();
    return { ok: true, closed: entry.closed };
  };

  // canPlaceFootprint (§1/§2/§3 — THE single occupancy rule): can `def` sit
  // at (x,y) rotated `rot` in the CURRENT room? Used identically for a fresh
  // placement, a move, and a rotation — `excludeIdx` is the item's own
  // placed-array slot (null/-1 for a brand new item) so it never blocks
  // against itself. Returns { ok, reason, tiles } — `reason` is always a
  // ready-to-toast UPPERCASE string on failure (SPEC-V12 §4: no silent
  // refusals).
  // footprintBoundsCheck (extracted for §3A so the group-move monitor
  // bypass path below can reuse the exact same bounds/corner rule instead
  // of a second copy) — returns a refusal object, or null when clear.
  function footprintBoundsCheck(def, tiles) {
    var grid = State.currentGrid();
    var multiTile = tiles.length > 1;
    var i, t;
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.x < 0 || t.y < 0 || t.x >= grid.w || t.y >= grid.d) {
        return { ok: false, reason: multiTile ? 'NEEDS TWO FREE TILES' : 'CANNOT PLACE THERE' };
      }
    }
    // REMOVED (owner playtest: "the bottom corner tile is blocked and says the
    // same thing as a tile with an item there would say").
    //
    // SPEC-V3 §3 reserved the grid's true bottom-right corner for the bed, so
    // that back when beds were 1x1 with no footprint system a bed always had a
    // guaranteed home. That guarantee is now provided twice over and the
    // reservation is dead weight:
    //   - SPEC-V12 gave beds real 2x1 footprints validated by this very
    //     function, so a bed's space is checked properly rather than hoarded.
    //   - SPEC-V13 §4 made core categories EXACTLY-ONE-PLACED with
    //     swap-in-place, and removePlacedAt() refuses the last one — so a bed
    //     can never be stashed, duplicated, or left homeless.
    //
    // Keeping it cost a permanently unusable tile in every room (1/16th of the
    // floor at 4x4) AND refused with 'TILE ALREADY OCCUPIED', which is simply
    // untrue when the tile is empty — the player is told a lie about a rule
    // that no longer has a reason to exist.
    //
    // Removing a restriction only ever makes MORE placements legal, so no
    // migration is needed: every save that was valid before is still valid.
    return null;
  }

  function canPlaceFootprint(def, x, y, rot, excludeIdx) {
    if (!def) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var ex = excludeIdx == null ? -1 : excludeIdx;

    // SPEC-V15-BATCH-B §1 (extended by SPEC-V20 §1/§3): wall-mounted items
    // never touch floor occupancy — this branch is a full replacement for
    // the floor rule below, not an addition to it.
    if (def.mount === 'wall') {
      // SPEC-V20 §3: blinds are a dedicated sub-rule — they don't need an
      // EMPTY wall slot, they need a slot that already holds a window (and
      // doesn't already hold a blind). Refuses everywhere else with the
      // exact spec-mandated reason.
      if (def.category === 'blind') {
        if (!isWallSlot(x, y)) return { ok: false, reason: 'BLINDS GO ON WINDOWS' };
        var blindOcc = wallOccupantsAt(State.data.placed, x, y, ex);
        var hasWindow = false, hasBlind = false;
        for (var bo = 0; bo < blindOcc.length; bo++) {
          if (blindOcc[bo].def.category === 'window') hasWindow = true;
          if (blindOcc[bo].def.category === 'blind') hasBlind = true;
        }
        if (!hasWindow) return { ok: false, reason: 'BLINDS GO ON WINDOWS' };
        if (hasBlind) return { ok: false, reason: 'TILE ALREADY OCCUPIED' };
        return { ok: true, reason: null, tiles: [{ x: x, y: y }] };
      }

      // SPEC-V20 §1: a WIDE window (`footprint: {w:2,d:1}`) needs TWO
      // adjacent wall slots — wallFootprintTiles derives them from the
      // anchor + which wall it's on (never a caller-chosen direction).
      // Every other wall item (banner, legacy window_blinds decor, a small
      // window) is still exactly 1 tile, unchanged from before.
      var wTiles = wallFootprintTiles(x, y, def);
      var wMulti = wTiles.length > 1;
      var wi;
      for (wi = 0; wi < wTiles.length; wi++) {
        if (!isWallSlot(wTiles[wi].x, wTiles[wi].y)) {
          return { ok: false, reason: wMulti ? 'NEEDS TWO FREE WALL TILES' : 'BANNERS MOUNT ON WALLS ONLY' };
        }
      }
      for (wi = 0; wi < wTiles.length; wi++) {
        var wOcc = wallOccupantsAt(State.data.placed, wTiles[wi].x, wTiles[wi].y, ex);
        for (var woj = 0; woj < wOcc.length; woj++) {
          // SPEC-V20 §3: a blind never blocks (and is never blocked by) the
          // window it's covering — the one wall-plane co-tenancy exception,
          // the direct counterpart of categoriesMayShareTile() on the floor.
          if (wOcc[woj].def.category === 'blind') continue;
          return { ok: false, reason: wMulti ? 'NEEDS TWO FREE WALL TILES' : 'TILE ALREADY OCCUPIED' };
        }
      }
      return { ok: true, reason: null, tiles: wTiles };
    }

    var tiles = footprintTiles(def, x, y, rot || 0);
    var multiTile = tiles.length > 1;
    var i, t;

    var boundsErr = footprintBoundsCheck(def, tiles);
    if (boundsErr) return boundsErr;

    var placed = State.data.placed;

    /* SPEC-V20 §2: `noCollide` (rgb_strip, neon_sign) skips the occupancy
       scan ENTIRELY — never blocks, never blocked, so the placement indicator
       stays green over an occupied tile. The one exception: two noCollide
       items may not stack on the exact same tile.

       V22 (owner item 12) makes that exception LAYER-AWARE rather than
       absolute. The rug became a floor underlay — noCollide, so it slides
       under the furniture — but a flat rug and a wall-glow LED are not
       competing for the same physical space, and blanket-blocking them would
       have meant "place the rug under anything except the one prop most likely
       to be on that tile". Two items only conflict when they occupy the same
       LAYER: `collideLayer`, defaulting to 'led' so both existing LEDs keep
       their exact V20 behaviour and every V20 test still describes the truth.
       Two rugs still cannot stack, and neither can two LEDs. */
    if (def.noCollide) {
      var myLayer = def.collideLayer || 'led';
      for (i = 0; i < tiles.length; i++) {
        var occNC = tileOccupantsAt(placed, tiles[i].x, tiles[i].y, ex);
        for (var nc = 0; nc < occNC.length; nc++) {
          var od = occNC[nc].def;
          if (od && od.noCollide && (od.collideLayer || 'led') === myLayer) {
            return { ok: false, reason: multiTile ? 'NEEDS TWO FREE TILES' : 'TILE ALREADY OCCUPIED' };
          }
        }
      }
      return { ok: true, reason: null, tiles: tiles };
    }

    if (def.category === 'monitor') {
      // §10 (kept): a monitor is desk furniture, not its own floor prop — it
      // may ONLY sit on a tile that already holds a desk, and not one that
      // already has a monitor on it. This overrides the general occupancy
      // scan below rather than being blocked by it.
      var occ0 = tileOccupantsAt(placed, tiles[0].x, tiles[0].y, ex);
      var hasDesk = false, hasMonitor = false;
      for (var k = 0; k < occ0.length; k++) {
        if (occ0[k].def.category === 'desk') hasDesk = true;
        if (occ0[k].def.category === 'monitor') hasMonitor = true;
      }
      if (!hasDesk) return { ok: false, reason: 'MONITOR NEEDS A DESK ON THAT TILE' };
      if (hasMonitor) return { ok: false, reason: 'THAT DESK ALREADY HAS A MONITOR' };
      return { ok: true, reason: null, tiles: tiles };
    }

    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      var occ = tileOccupantsAt(placed, t.x, t.y, ex);
      for (var j = 0; j < occ.length; j++) {
        // SPEC-V20 §2: a noCollide occupant (rgb_strip/neon_sign) is
        // invisible to every ORDINARY item's occupancy scan too — "never
        // blocks" means an LED already on a tile must never stop a normal
        // prop from landing there, not just that the LED itself can land on
        // an occupied tile. The noCollide branch above already handles the
        // reverse (an LED placing onto an occupied tile); this is the other
        // half of the same rule.
        if (occ[j].def.noCollide) continue;
        if (categoriesMayShareTile(def.category, occ[j].def.category)) continue;
        return { ok: false, reason: multiTile ? 'NEEDS TWO FREE TILES' : 'TILE ALREADY OCCUPIED' };
      }
    }
    return { ok: true, reason: null, tiles: tiles };
  }
  State.canPlaceFootprint = canPlaceFootprint;

  // ============================================================ SPEC-V13 ==
  // §3A — WORKSTATION GROUPING: a desk plus every pc/monitor sharing its
  // tile moves as one unit. Membership is derived entirely from the
  // existing SHARED_TILE_CATEGORIES list (desk/pc/monitor) — no second
  // literal category list. A tile-overlap test (not straight x/y equality)
  // is used so this keeps working if a future desk ever grows past 1x1.
  // ==========================================================================
  function tilesOverlap(a, b) {
    for (var i = 0; i < a.length; i++) {
      for (var j = 0; j < b.length; j++) {
        if (a[i].x === b[j].x && a[i].y === b[j].y) return true;
      }
    }
    return false;
  }

  // groupIndicesFor (§3A): [idx] for anything outside the shared-tile group,
  // or anything not sharing a tile with a desk. For a desk, or a pc/monitor
  // that IS sharing a tile with a desk, returns the desk's index plus every
  // other placed pc/monitor also on that desk's tile(s) — anchored on the
  // desk regardless of which member was tapped.
  State.groupIndicesFor = function (idx) {
    var placed = State.data.placed;
    var entry = placed[idx];
    if (!entry) return [idx];
    var def = findShopItem(entry.id);
    if (!def || SHARED_TILE_CATEGORIES.indexOf(def.category) === -1) return [idx];

    var deskIdx = -1;
    if (def.category === 'desk') {
      deskIdx = idx;
    } else {
      var myTiles = footprintTiles(def, entry.x, entry.y, entry.rot || 0);
      for (var i = 0; i < placed.length; i++) {
        var od = findShopItem(placed[i].id);
        if (!od || od.category !== 'desk') continue;
        var deskTiles = footprintTiles(od, placed[i].x, placed[i].y, placed[i].rot || 0);
        if (tilesOverlap(myTiles, deskTiles)) { deskIdx = i; break; }
      }
    }
    if (deskIdx === -1) return [idx]; // a pc with no desk under it is a standalone floor tower (legit)

    var desk = placed[deskIdx];
    var deskDef = findShopItem(desk.id);
    var deskTiles = footprintTiles(deskDef, desk.x, desk.y, desk.rot || 0);
    var group = [deskIdx];
    for (var j = 0; j < placed.length; j++) {
      if (j === deskIdx) continue;
      var pd = findShopItem(placed[j].id);
      if (!pd || SHARED_TILE_CATEGORIES.indexOf(pd.category) === -1 || pd.category === 'desk') continue;
      var pTiles = footprintTiles(pd, placed[j].x, placed[j].y, placed[j].rot || 0);
      if (tilesOverlap(pTiles, deskTiles)) group.push(j);
    }
    return group;
  };

  // validateGroupMember: same rule canPlaceFootprint applies to a lone item,
  // with ONE override — a monitor's "needs a desk on that tile" requirement
  // is satisfied by the desk being a MEMBER of the moving group, even though
  // the desk (mid-move, not yet committed) can never be seen by a real
  // occupancy scan at the destination tile. Every other monitor rule (no
  // stacking on another monitor, bounds, the reserved bed corner) is
  // unchanged and still derived from the same footprintBoundsCheck()/
  // tileOccupantsAt() canPlaceFootprint itself uses — never a second copy.
  function validateGroupMember(idx, x, y, rot, idxs, deskInGroup) {
    var entry = State.data.placed[idx];
    if (!entry) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var def = findShopItem(entry.id);
    if (!def) return { ok: false, reason: 'CANNOT PLACE THERE' };
    if (def.category === 'monitor' && deskInGroup) {
      var tiles = footprintTiles(def, x, y, rot || 0);
      var boundsErr = footprintBoundsCheck(def, tiles);
      if (boundsErr) return boundsErr;
      var occ = tileOccupantsAt(State.data.placed, tiles[0].x, tiles[0].y, idxs);
      for (var k = 0; k < occ.length; k++) {
        if (occ[k].def.category === 'monitor') return { ok: false, reason: 'THAT DESK ALREADY HAS A MONITOR' };
      }
      return { ok: true, reason: null, tiles: tiles };
    }
    return canPlaceFootprint(def, x, y, rot, idxs);
  }

  // canMoveGroup (§3A, read-only probe): every member lands on the SAME
  // (x, y) tile at the SAME rotation (a workstation is, today, always a
  // group of 1x1 props sharing one tile) with the WHOLE group excluded from
  // every member's own occupancy scan, so the group never blocks against
  // itself. All-or-nothing — the first refusal short-circuits the rest.
  State.canMoveGroup = function (idxs, x, y, rot) {
    if (!idxs || !idxs.length) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var placed = State.data.placed;
    var deskInGroup = idxs.some(function (i) {
      var e = placed[i], d = e && findShopItem(e.id);
      return d && d.category === 'desk';
    });
    for (var i = 0; i < idxs.length; i++) {
      var res = validateGroupMember(idxs[i], x, y, rot, idxs, deskInGroup);
      if (!res.ok) return res;
    }
    return { ok: true, reason: null };
  };

  // moveGroup (§3A): validates via canMoveGroup, then writes x/y/rot to
  // every member and commits ONCE — all-or-nothing, nothing moves on a
  // refusal.
  State.moveGroup = function (idxs, x, y, rot) {
    var check = State.canMoveGroup(idxs, x, y, rot);
    if (!check.ok) return check;
    var placed = State.data.placed;
    var r = rot || 0;
    for (var i = 0; i < idxs.length; i++) {
      var entry = placed[idxs[i]];
      entry.x = x; entry.y = y; entry.rot = r;
    }
    commit();
    return { ok: true, reason: null };
  };

  // State.placeItem (SPEC-V13 §4A — return type changed from a bare boolean
  // to { ok, reason, replaced }): a SINGLETON_ROOM_CATEGORIES category
  // (desk/pc/chair/monitor/bed) now means EXACTLY one placed at a time.
  // Placing into an already-filled slot SWAPS IN PLACE — the incoming item
  // takes the incumbent's exact x/y/rot (the REQUESTED x/y/rot is ignored
  // for this path) and the incumbent is removed from `placed` only, never
  // from `owned`. Same footprint as the incumbent -> no re-validation needed
  // (the incumbent already fit there). Different footprint -> re-validated
  // at the incumbent's anchor with the incumbent excluded; refuses with a
  // toast-ready reason if it doesn't fit. `replaced` is the swapped-out
  // item's display name, or null when nothing was swapped (a fresh
  // placement, or the category's slot was empty). js/hub.js:770 is the only
  // external caller and must stop treating this as a boolean.

  /* deskRotOnTile (V22b, owner item 3) — the rotation of the desk occupying a
     tile, or null if there is none.

     A monitor and a PC are DESK FURNITURE: they only exist on a desk's tile,
     and props.monitor/props.pc draw relative to their OWN rot. Letting the
     player choose that rot independently is what produced a monitor turned
     sideways with its stand hanging off the desk, and a tower standing in
     front of it instead of behind — the owner saw both during onboarding.

     So their rotation is DERIVED, never chosen — exactly the rule wall mounts
     already follow via wallRotForTile() (SPEC-V15-BATCH-B §1). Rotating the
     workstation as a group still works, because moveGroup passes one rot to
     every member and the desk carries it. */
  function deskRotOnTile(x, y) {
    var placed = (State.data && State.data.placed) || [];
    for (var i = 0; i < placed.length; i++) {
      var e = placed[i];
      var def = findShopItem(e.id);
      if (!def || def.category !== 'desk') continue;
      var tiles = footprintTiles(def, e.x, e.y, e.rot || 0);
      for (var t = 0; t < tiles.length; t++) {
        if (tiles[t].x === x && tiles[t].y === y) return e.rot || 0;
      }
    }
    return null;
  }

  // DESK_BOUND_CATEGORIES: the two things that must match the desk they sit on.
  var DESK_BOUND_CATEGORIES = ['monitor', 'pc'];
  function derivedRotFor(def, x, y, fallbackRot) {
    if (def.mount === 'wall') return wallRotForTile(x, y);
    if (DESK_BOUND_CATEGORIES.indexOf(def.category) !== -1) {
      var dr = deskRotOnTile(x, y);
      if (dr !== null) return dr;
    }
    return fallbackRot;
  }

  State.placeItem = function (itemId, x, y, rot) {
    var def = findShopItem(itemId);
    if (!def) return { ok: false, reason: 'CANNOT PLACE THERE', replaced: null };
    if (def.category === 'consumable') return { ok: false, reason: 'CANNOT PLACE THERE', replaced: null }; // §3: consumables are never room props
    // SPEC-V6 §16: at most Data.energyItemCap (4) energy-category items may
    // be PLACED at once (ownership itself is unlimited).
    if (def.category === 'energy' && totalEnergyItemQty(State.data) >= (Data().energyItemCap || 4)) {
      return { ok: false, reason: 'ENERGY ITEM LIMIT REACHED', replaced: null };
    }
    var ownedQty = State.data.owned[itemId] || 0;
    var placedQty = 0;
    for (var i = 0; i < State.data.placed.length; i++) if (State.data.placed[i].id === itemId) placedQty++;
    if (placedQty >= ownedQty) return { ok: false, reason: 'NOTHING LEFT TO PLACE', replaced: null };

    if (SINGLETON_ROOM_CATEGORIES.indexOf(def.category) !== -1) {
      var placedArr = State.data.placed;
      var incumbentIdx = -1;
      for (var k = 0; k < placedArr.length; k++) {
        var pdef = findShopItem(placedArr[k].id);
        if (pdef && pdef.category === def.category) { incumbentIdx = k; break; }
      }
      if (incumbentIdx !== -1) {
        var incumbent = placedArr[incumbentIdx];
        var incumbentDef = findShopItem(incumbent.id);
        var sameFootprint = incumbentDef &&
          itemFootprint(incumbentDef).w === itemFootprint(def).w &&
          itemFootprint(incumbentDef).d === itemFootprint(def).d;
        if (!sameFootprint) {
          var swapCheck = canPlaceFootprint(def, incumbent.x, incumbent.y, incumbent.rot || 0, incumbentIdx);
          if (!swapCheck.ok) return { ok: false, reason: swapCheck.reason, replaced: null };
        }
        var replacedName = (incumbentDef && incumbentDef.name) || incumbent.id;
        placedArr.splice(incumbentIdx, 1);
        placedArr.push({ id: itemId, x: incumbent.x, y: incumbent.y, rot: incumbent.rot || 0 });
        if (def.category === 'energy') recomputeEnergyMax(State.data); // never true for a core category today, kept for symmetry
        commit();
        return { ok: true, reason: null, replaced: replacedName };
      }
      // no incumbent placed yet for this category — falls through to a normal fresh placement below
    }

    var check = canPlaceFootprint(def, x, y, rot || 0, -1);
    if (!check.ok) return { ok: false, reason: check.reason, replaced: null };
    // SPEC-V15-BATCH-B §1: rotation is DERIVED for a wall mount, never the
    // caller's requested rot — wallRotForTile() is the one source of truth,
    // consulted here so it's impossible to land a banner with a mismatched
    // facing regardless of what hub.js happened to pass in.
    var placeRot = derivedRotFor(def, x, y, rot || 0);
    var newEntry = { id: itemId, x: x, y: y, rot: placeRot };
    // SPEC-V20 §3: a freshly placed blind starts OPEN (`closed: false`) —
    // explicit so the field always exists on a placed blind entry rather
    // than relying on `undefined` reading falsy. Persisted for free: `placed`
    // is copied whole (not field-by-field) by normalizeSave(), so this
    // per-instance flag round-trips through save/reload with no defaultData()
    // change needed, same as `x`/`y`/`rot` always have.
    if (def.category === 'blind') newEntry.closed = false;
    State.data.placed.push(newEntry);
    if (def.category === 'energy') recomputeEnergyMax(State.data); // §16 — placing raises energyMax now
    commit();
    return { ok: true, reason: null, replaced: null };
  };

  // State.moveItem/State.rotateItem (§1/§3): the SAME canPlaceFootprint()
  // check placeItem uses above, just with the item's own current placed
  // index excluded — this is what closes the old relaxed move-branch hole:
  // moving (or rotating in place) now validates its destination exactly
  // like placing a brand new item does, every time. Returns { ok, reason }
  // so hub.js always has a toast-ready reason on refusal (§4).
  State.moveItem = function (idx, x, y, rot) {
    var placed = State.data.placed;
    var entry = placed[idx];
    if (!entry) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var def = findShopItem(entry.id);
    if (!def) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var r = rot == null ? (entry.rot || 0) : rot;
    var check = canPlaceFootprint(def, x, y, r, idx);
    if (!check.ok) return { ok: false, reason: check.reason };
    // SPEC-V15-BATCH-B §1: same derived-rotation override as placeItem above
    // — a moved wall item re-derives its facing from its new wall, never
    // keeping (or accepting) a caller-chosen rot.
    var moveRot = derivedRotFor(def, x, y, r);
    entry.x = x; entry.y = y; entry.rot = moveRot;
    commit();
    return { ok: true, reason: null };
  };

  // State.canMoveItem (read-only probe, §4): same validation as moveItem()
  // without mutating — used by hub.js's ghost preview / ROTATE button to
  // decide ok-vs-refuse (and get the reason for a toast) BEFORE the player
  // commits, exactly mirroring canPlaceFootprint's contract for fresh items.
  State.canMoveItem = function (idx, x, y, rot) {
    var placed = State.data.placed;
    var entry = placed[idx];
    if (!entry) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var def = findShopItem(entry.id);
    if (!def) return { ok: false, reason: 'CANNOT PLACE THERE' };
    var r = rot == null ? (entry.rot || 0) : rot;
    return canPlaceFootprint(def, x, y, r, idx);
  };

  // State.removePlacedAt() (SPEC-V6 §24 — REWRITTEN, was a blanket block on
  // desk/pc/chair/monitor): a SINGLETON_ROOM_CATEGORIES item can be picked
  // up as long as at least one OTHER placed instance of that same category
  // remains — i.e. only a surplus instance is removable, never the last
  // one. Every other category (decor/energy/regen/room) was always
  // removable and still is. Verified across desk/chair/pc/monitor/bed.
  State.removePlacedAt = function (x, y) {
    var placed = State.data.placed;
    for (var i = 0; i < placed.length; i++) {
      if (placed[i].x === x && placed[i].y === y) {
        var def = findShopItem(placed[i].id);
        if (def && SINGLETON_ROOM_CATEGORIES.indexOf(def.category) !== -1) {
          var countInCategory = 0;
          for (var j = 0; j < placed.length; j++) {
            var d2 = findShopItem(placed[j].id);
            if (d2 && d2.category === def.category) countInCategory++;
          }
          if (countInCategory <= 1) return false; // last one in its category — must stay placed
        }
        placed.splice(i, 1);
        if (def && def.category === 'energy') recomputeEnergyMax(State.data); // §16 — picking up an energy item can lower energyMax
        commit();
        return true;
      }
    }
    return false;
  };

  State.toggleSound = function () {
    State.data.settings.sound = !State.data.settings.sound;
    commit();
    return State.data.settings.sound;
  };

  /* ---- staff: coaches & moderators (SPEC-V2 §5) -----------------------------
     Only one of each at a time; hiring a different one replaces the current
     hire outright (no refund of the old hire cost). Upkeep + auto-quit logic
     lives in applyStaffUpkeep(), run every endDay(). ----------------------- */
  State.hireCoach = function (id) {
    if (State.data.dead) return { ok: false, reason: 'dead' };
    var def = staffCoachDef(id);
    if (!def) return { ok: false, reason: 'invalid' };
    if (State.data.staff.coachId === id) return { ok: false, reason: 'already-hired' };
    if (!State.spend(def.hire)) return { ok: false, reason: 'cash' };
    State.data.staff.coachId = id;
    commit();
    return { ok: true, coach: def };
  };

  State.hireMod = function (id) {
    if (State.data.dead) return { ok: false, reason: 'dead' };
    var def = staffModDef(id);
    if (!def) return { ok: false, reason: 'invalid' };
    if (State.data.staff.modId === id) return { ok: false, reason: 'already-hired' };
    if (!State.spend(def.hire)) return { ok: false, reason: 'cash' };
    State.data.staff.modId = id;
    commit();
    return { ok: true, mod: def };
  };

  State.fireCoach = function () {
    if (!State.data.staff.coachId) return false;
    State.data.staff.coachId = null;
    commit();
    return true;
  };

  State.fireMod = function () {
    if (!State.data.staff.modId) return false;
    State.data.staff.modId = null;
    commit();
    return true;
  };

  State.currentCoach = function () { return staffCoachDef(State.data.staff.coachId); };
  State.currentMod = function () { return staffModDef(State.data.staff.modId); };

  /* ---- locations (SPEC-V2 §6 / §7, room expansion DELETED by SPEC-V6 §28) --
     Grid size now comes ONLY from the location — 6x6 up through 11x11
     across the six locations (see Data.locations), each exactly one tile
     larger than the last. State.expansionCost()/State.buyExpansion() are
     kept as harmless no-op stubs (old names, extend don't rename) for any
     caller still wired to them; `d.expansions` itself is kept in the save
     schema (untouched, still round-trips) purely so a pre-V6 save with
     expansions > 0 migrates cleanly — it's simply never read for sizing
     any more, so that save's grid quietly reverts to its location's base
     size instead of crashing or losing data. */
  State.currentLocation = function () {
    return locationDef(State.data.locationId);
  };

  State.currentGrid = function () {
    var loc = locationDef(State.data.locationId) || { gridW: 6, gridD: 6 };
    return { w: loc.gridW, d: loc.gridD };
  };

  // LEGACY STUB (SPEC-V6 §28: room expansion is gone) — always "nothing to
  // buy" now, since grid size is fixed per location.
  State.expansionCost = function () {
    return null;
  };

  // LEGACY STUB (SPEC-V6 §28) — always fails now; expansions can no longer
  // be purchased at any location.
  State.buyExpansion = function () {
    return { ok: false, reason: 'expansions-removed' };
  };

  /* ---- the moving minigame (SPEC-V2 §7) -------------------------------------
     1. State.startMove(locationId)  — pays the move-in cost, opens PACKING MODE
     2. State.packPropAt(index)      — player taps each placed prop (by its
                                         index in State.data.placed) to box it
                                         up. Indexed rather than keyed by
                                         (x,y): multiple props can share a
                                         tile (e.g. the starting desk + PC
                                         both sit at the same grid cell), so
                                         tile coordinates are not a reliable
                                         one-prop-per-tap identity.
     3. State.movingProgress()       — { packed, total, ready } drives the
                                         "PACKED 4/11" counter + MOVE OUT button
     4. State.commitMove()           — travel transition finished; swaps
                                         locationId, resets expansions, and
                                         empties `placed` (all props return to
                                         storage — the owned pool is untouched
                                         — for re-placement via EDIT ROOM).
     State.cancelMove() is an escape hatch for an aborted packing phase; it
     does NOT refund the move-in cost already spent in step 1 (the spec does
     not define a refund rule, so this deliberately mirrors an irreversible
     real-world moving deposit rather than inventing one). ------------------ */
  State.startMove = function (locationId) {
    if (State.data.dead) return { ok: false, reason: 'dead' };
    var loc = locationDef(locationId);
    if (!loc) return { ok: false, reason: 'invalid-location' };
    if (locationId === State.data.locationId) return { ok: false, reason: 'already-here' };
    if (State.data.moving) return { ok: false, reason: 'already-moving' };
    if (!State.spend(loc.moveInCost)) return { ok: false, reason: 'cash' };
    State.data.moving = { targetLocationId: locationId, packed: [] };
    commit();
    return { ok: true, moving: State.data.moving };
  };

  State.packPropAt = function (index) {
    var m = State.data.moving;
    if (!m) return false;
    if (index < 0 || index >= State.data.placed.length) return false;
    if (m.packed.indexOf(index) === -1) m.packed.push(index);
    commit();
    return true;
  };

  State.movingProgress = function () {
    var m = State.data.moving;
    if (!m) return null;
    var total = State.data.placed.length;
    var packed = m.packed.length;
    return { packed: packed, total: total, ready: packed >= total };
  };

  State.commitMove = function () {
    var m = State.data.moving;
    if (!m) return { ok: false, reason: 'not-moving' };
    var progress = State.movingProgress();
    if (!progress.ready) return { ok: false, reason: 'not-packed' };
    State.data.locationId = m.targetLocationId;
    State.data.expansions = 0;
    State.data.rentMissed = 0;
    State.data.placed = [];   // everything is in storage now — re-place via EDIT ROOM
    State.data.moving = null;
    // SPEC-V6 §6: pick a fresh random rent day-of-cycle offset on every
    // real move-in — "a player moves in on an arbitrary day". 1-6 only
    // (never 0) so rent's weekly cadence can never land on the same
    // absolute day as the tournament cycle (always multiples of 7 from
    // day 0 — see maybeRunLeagueCycle/applyRent).
    if (State.data.locationId > 0) State.data.rentDayOffset = randInt(1, 6);
    commit();
    return { ok: true, locationId: State.data.locationId, grid: State.currentGrid() };
  };

  State.cancelMove = function () {
    if (!State.data.moving) return false;
    State.data.moving = null;
    commit();
    return true;
  };

  /* ---- packing failsafe (SPEC-V4 §8) ----------------------------------------
     If the player has been stuck in packing mode (UI owns the 10s timer),
     this force-completes the move: any placed prop NOT yet packed is moved
     to storage exactly as a packed one would be (State.data.owned already
     holds the quantities — `placed` just gets emptied, same as
     State.commitMove's normal path) so NOTHING is ever lost, just
     auto-boxed by "the movers". Returns how many props were auto-packed so
     the UI can show "MOVE OUT ANYWAY — LEAVING N ITEMS BOXED BY THE
     MOVERS". Safe to call even if everything was already packed (leftover
     count 0) or if not currently moving at all. */
  State.forceCommitMove = function () {
    var m = State.data.moving;
    if (!m) return { ok: false, reason: 'not-moving' };
    var total = State.data.placed.length;
    var leftover = Math.max(0, total - m.packed.length);
    // No item-by-item transfer needed: `owned` already reflects every prop
    // regardless of pack state (packing never removes from `owned`, only
    // marks an index as boxed) — commitMove's placed=[] is what "moves
    // everything to inventory/storage" really means here, so reuse it
    // verbatim rather than re-deriving the same effect a second way.
    State.data.locationId = m.targetLocationId;
    State.data.expansions = 0;
    State.data.rentMissed = 0;
    State.data.placed = [];
    State.data.moving = null;
    if (State.data.locationId > 0) State.data.rentDayOffset = randInt(1, 6); // §6 — see State.commitMove()
    commit();
    return { ok: true, locationId: State.data.locationId, grid: State.currentGrid(), forced: true, leftoverPacked: leftover };
  };

  /* ---- stats screen aggregation (SPEC-V3 §7 / §13) --------------------------
     One function returning every buff with its CURRENT numeric effect, plus
     career/lifetime/subscriber figures — the stats screen (Package H) should
     be a pure renderer over this, no math of its own. Every buff listed here
     has a real, audited effect (see the Package F API addendum for the full
     audit — prestige was the one found inert and is now wired up via
     State.applyStreamResult's viewerMult; aim/stream/luck were already live.
     `income` was idle income pre-V3 — §13 removed idle income and repurposed
     the stat into `subConversion`, a subscriber-conversion-rate buff, so it
     never went orphaned/dead per §7's "every listed stat must do
     something"). ------------------------------------------------------------ */
  State.statsSummary = function () {
    var d = State.data;
    var gear = State.gearBonus();
    var loc = State.currentLocation();
    var grid = State.currentGrid();
    var phase = computePhase(d);
    var rank = State.rank();
    var interval = Data().subscriberPayoutInterval || 7;
    var dayMod = d.day % interval;
    // §6: rent's countdown MUST go through the same offset-aware helper
    // applyRent() charges against (rentDayMod/rentDueInSleeps above) — do
    // NOT recompute this from the naive d.day % interval dayMod, which
    // ignores d.rentDayOffset and can disagree with the real charge day.
    var rentDueSleeps = (loc && loc.id > 0) ? rentDueInSleeps(d) : null;
    var subscriberDueInSleeps = dayMod === 0 ? 0 : interval - dayMod; // same cadence length as rent, but NOT offset — location-independent (§13)
    var matches = d.stats.matches || 0;
    var wins = d.stats.wins || 0;
    var streamPct = gear.stream * 100;
    var prestigePct = gear.prestige * 2;      // SPEC-V3 §7: +2% viewers per prestige point
    var luckPct = gear.luck * 100;
    var energyRegen = phase.phase === 'night' ? 0 : 1.0;
    var subConvRate = Data().subscriberConversionBase + (gear.income || 0) * Data().subscriberConversionPerPoint;
    var subConvBonusPct = (gear.income || 0) * Data().subscriberConversionPerPoint * 100; // the buff's OWN contribution, above the 8% base
    var subCount = Math.max(0, Math.round(d.subscribers || 0));
    var subNextPayout = Math.round(subCount * Data().subscriberPrice * 100) / 100;
    // SPEC-V20 §3/§4: the two new flat, non-stacking room-decor buffs — see
    // effectiveSleepRate()/merchandiseBonusActive() (both single sources of
    // truth, also consumed by the actual sleep/stream math, never a second
    // copy of either rule here).
    var sleepRateVal = effectiveSleepRate(d);
    var blindsBonusPct = windowCoverageComplete(d) ? (Data().blindsSleepBonusPct || 0) * 100 : 0;
    var merchBonusPct = State.merchandiseBonusPct() * 100;

    return {
      buffs: {
        aim:           { value: gear.aim,       label: '+' + Math.round(gear.aim) + ' ELO PER MATCH' },
        streamMult:    { value: streamPct,      label: '+' + Math.round(streamPct) + '% STREAM CASH' },
        subConversion: { value: subConvBonusPct, label: '+' + Math.round(subConvBonusPct) + '% SUB CONVERSION' },
        prestige:      { value: prestigePct,    label: '+' + Math.round(prestigePct) + '% VIEWERS' },
        luck:          { value: luckPct,        label: '+' + luckPct.toFixed(1) + '% SHIFT TOWARD RARE DROPS' },
        sleepRate:     { value: sleepRateVal,   label: sleepRateVal.toFixed(2) + ' ENERGY/SEC (ASLEEP)' },
        energyRegen:   { value: energyRegen,    label: energyRegen.toFixed(1) + ' ENERGY/SEC (AWAKE)' },
        energyMax:     { value: d.energyMax,    label: d.energyMax + ' MAX ENERGY' },
        blindsBonus:   { value: blindsBonusPct, label: '+' + Math.round(blindsBonusPct) + '% SLEEP FROM CLOSED BLINDS' },
        merchBonus:    { value: merchBonusPct,  label: '+' + Math.round(merchBonusPct) + '% VIEWS/SUBS FROM BANNER OR NEON' }
      },
      career: {
        rank: rank.name, rankColor: rank.color, elo: Math.round(d.elo),
        contract: d.contract, salary: (Data().contracts[d.contract] || {}).salary || 0,
        chemistry: d.chemistry, scoutHype: d.hype, day: d.day,
        location: loc ? loc.name : '—', gridSize: grid.w + 'x' + grid.d,
        rentDueInSleeps: rentDueSleeps,
        debtStrikes: d.debtStrikes || 0, dead: !!d.dead, deadReason: d.deadReason || null
      },
      subscribers: {
        count: subCount,
        rate: subConvRate,                 // total follower->subscriber conversion rate (base + gear)
        price: Data().subscriberPrice,
        nextPayout: subNextPayout,         // $ the next payout will pay out at the CURRENT subscriber count
        dueInSleeps: subscriberDueInSleeps // 0 = pays out at the very next sleep
      },
      lifetime: {
        matches: matches, wins: wins,
        winRate: matches > 0 ? wins / matches : 0,
        streams: d.stats.streams || 0,
        casesOpened: d.stats.casesOpened || 0,
        bestPull: d.stats.bestPull || 0,
        playtimeMs: d.playtimeMs || 0
      }
    };
  };

  /* ==========================================================================
     SPEC-V10: crypto market (Package C1 — rules & data)
     Deliberately orthogonal to the core loop (SPEC-V10-CRYPTO.md §6): costs
     no energy, gates nothing, never touches sponsors/scrims/streams. Spot
     only — NO leverage, margin, or liquidation (§0/owner decision, final).

     "day" throughout this section means Data.crypto.ticksPerDay consecutive
     price ticks, an internal pacing unit for the market — NOT d.day (which
     only advances on sleep). See defaultCrypto()/cryptoCfg() above.
     ========================================================================== */

  // advanceNewsAndGetDrift(d): advances every active news event by one tick,
  // returns { coinId: pctDrift } for this tick, and moves any event that
  // just finished its resolution window into d.crypto.newsHistory (capped).
  // A "fake-out" event spends its first fakeoutTicks moving AGAINST its
  // final actualSign, then the remainder toward it — SPEC-V10 §4.3/§4.4:
  // this is what forces the player to decide when to exit, not just when to
  // enter, since an early read of a fake-out looks wrong before it resolves.
  function advanceNewsAndGetDrift(d) {
    var drift = {};
    var list = d.crypto.news;
    var stillActive = [];
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      var remaining = ev.totalTicks - ev.fakeoutTicks;
      var inFakeoutPhase = ev.elapsedTicks < ev.fakeoutTicks;
      var sign, mag;
      if (inFakeoutPhase) {
        sign = -ev.actualSign;
        mag = ev.magnitudePct / ev.totalTicks;
      } else {
        sign = ev.actualSign;
        mag = remaining > 0 ? (ev.magnitudePct / remaining) : 0;
      }
      drift[ev.coinId] = (drift[ev.coinId] || 0) + sign * mag;
      ev.elapsedTicks++;
      if (ev.elapsedTicks >= ev.totalTicks) {
        d.crypto.newsHistory.push({
          id: ev.id, coinId: ev.coinId, text: ev.text,
          telegraphDir: ev.telegraphDir,
          actualDir: ev.actualSign > 0 ? 'up' : 'down',
          correct: (ev.actualSign > 0) === (ev.telegraphDir === 'up'),
          fakeout: ev.fakeoutTicks > 0,
          resolvedAtTick: d.crypto.tickCount
        });
        if (d.crypto.newsHistory.length > 300) d.crypto.newsHistory.shift();
      } else {
        stillActive.push(ev);
      }
    }
    d.crypto.news = stillActive;
    return drift;
  }

  // spawnNewsEvent(d, forceCoinId): rolls a fresh headline (SPEC-V10 §4).
  // Direction is TELEGRAPHED by the headline; whether that telegraph is
  // actually true is decided right here at spawn (news.reliability, ~68%)
  // and hidden from the player until resolution — advanceNewsAndGetDrift()
  // is what actually biases the walk toward ev.actualSign over the event's
  // lifetime. forceCoinId bypasses random coin pick (used by
  // State.cryptoDebugSpawnNews for testing/tooling — normal play always
  // omits it).
  function spawnNewsEvent(d, forceCoinId) {
    var cfg = cryptoCfg();
    var newsCfg = cfg.news;
    var coins = Data().cryptoCoins || [];
    if (!coins.length) return null;
    var coin = forceCoinId ? cryptoCoinDef(forceCoinId) : coins[randInt(0, coins.length - 1)];
    if (!coin) return null;
    var headline = newsCfg.headlines[randInt(0, newsCfg.headlines.length - 1)];
    var telegraphDir = headline.direction; // 'up' | 'down'
    var telegraphSign = telegraphDir === 'up' ? 1 : -1;
    var correct = Math.random() < newsCfg.reliability;
    var actualSign = correct ? telegraphSign : -telegraphSign;
    var isFakeout = Math.random() < newsCfg.fakeoutRate;
    var totalDays = randInt(newsCfg.resolveDaysMin, newsCfg.resolveDaysMax);
    var totalTicks = Math.max(2, totalDays * (cfg.ticksPerDay || 6));
    var fakeoutTicks = isFakeout ? Math.max(1, Math.round(totalTicks * (newsCfg.fakeoutTickFraction || 0.3))) : 0;
    if (fakeoutTicks >= totalTicks) fakeoutTicks = totalTicks - 1;
    var magnitudePct = rand(newsCfg.magnitudeMin, newsCfg.magnitudeMax);
    var ev = {
      id: genId(), coinId: coin.id,
      text: (headline.text || '').replace(/\{COIN\}/g, coin.name),
      telegraphDir: telegraphDir,
      actualSign: actualSign,
      magnitudePct: magnitudePct,
      fakeoutTicks: fakeoutTicks,
      totalTicks: totalTicks,
      totalDays: totalDays,
      elapsedTicks: 0,
      createdAt: Date.now(),
      createdTick: d.crypto.tickCount
    };
    d.crypto.news.push(ev);
    d.crypto.nextNewsAtTick = d.crypto.tickCount + randInt(newsCfg.minGapTicks, newsCfg.maxGapTicks);
    return ev;
  }

  function maybeSpawnNews(d) {
    var newsCfg = cryptoCfg().news;
    if (d.crypto.news.length >= (newsCfg.maxActive || 4)) return;
    if (d.crypto.tickCount < d.crypto.nextNewsAtTick) return;
    spawnNewsEvent(d);
  }

  // cryptoStep(d): ONE price tick for every coin (SPEC-V10 §2) — a random
  // walk (uniform shock scaled from each coin's daily volatility) with mild
  // mean reversion toward the coin's startPrice (so nothing runs to zero or
  // infinity over a long save), plus whatever drift active news events
  // contribute this tick. Hard floor/ceiling clamp is a belt-and-braces
  // backstop on top of the reversion, not a substitute for it.
  function cryptoStep(d) {
    var cfg = cryptoCfg();
    var ticksPerDay = cfg.ticksPerDay || 6;
    var drift = advanceNewsAndGetDrift(d);
    var coins = Data().cryptoCoins || [];
    for (var i = 0; i < coins.length; i++) {
      var coin = coins[i];
      var price = d.crypto.prices[coin.id];
      var perTickVol = coin.dailyVol / Math.sqrt(ticksPerDay); // random-walk variance scaling
      var shock = (Math.random() * 2 - 1) * perTickVol;
      var reversion = -(cfg.reversionStrength / ticksPerDay) * (price / coin.startPrice - 1);
      var pct = shock + reversion + (drift[coin.id] || 0);
      var next = price * (1 + pct);
      var floor = coin.startPrice * (cfg.floorFactor || 0.02);
      var ceiling = coin.startPrice * (cfg.ceilingFactor || 50);
      next = clamp(next, floor, ceiling);
      d.crypto.prices[coin.id] = next;
      var hist = d.crypto.history[coin.id];
      hist.push(next);
      if (hist.length > (cfg.historyMaxLen || 120)) hist.shift();
    }
    d.crypto.tickCount++;
    maybeSpawnNews(d);
  }

  // State.tickCrypto(): the tick/reconcile function the UI calls on an
  // interval (mirrors State.tickEnergy()'s pattern) — safe to call as often
  // as desired, only accounts for real elapsed time since the last call.
  // Ticks are wall-clock paced (Data.crypto.tickIntervalMs apart), NOT tied
  // to d.day/sleep, so the market keeps moving through a long uninterrupted
  // session. Caps catch-up ticks after a long gap (backgrounded tab) so
  // resuming never triggers a huge synchronous burst; any backlog beyond the
  // cap is dropped, not queued. Only commits (saves) when at least one tick
  // actually happened.
  State.tickCrypto = function () {
    var d = State.data;
    if (!d) return { ticked: 0 };
    ensureCrypto(d);
    var cfg = cryptoCfg();
    var interval = cfg.tickIntervalMs || 20000;
    var now = Date.now();
    if (!d.crypto.lastTickAt) { d.crypto.lastTickAt = now; return { ticked: 0 }; }
    var elapsed = Math.max(0, now - d.crypto.lastTickAt);
    var stepsDue = Math.floor(elapsed / interval);
    if (stepsDue <= 0) return { ticked: 0 };
    var CAP = 200;
    var steps = Math.min(stepsDue, CAP);
    for (var i = 0; i < steps; i++) cryptoStep(d);
    d.crypto.lastTickAt = (stepsDue > CAP) ? now : (d.crypto.lastTickAt + steps * interval);
    commit();
    return { ticked: steps };
  };

  // State.cryptoSimulateTicks(n): synchronously fast-forwards n price ticks,
  // bypassing real-time pacing entirely. Used by automated tests and any
  // future "fast forward" tooling; normal play should use tickCrypto().
  State.cryptoSimulateTicks = function (n) {
    var d = State.data;
    if (!d) return { ticked: 0 };
    ensureCrypto(d);
    n = Math.max(0, Math.floor(n || 0));
    for (var i = 0; i < n; i++) cryptoStep(d);
    d.crypto.lastTickAt = Date.now();
    commit();
    return { ticked: n };
  };

  // State.cryptoDebugSpawnNews([coinId]): forces a news event to spawn
  // immediately, bypassing the normal pacing gate (nextNewsAtTick) and the
  // maxActive cap. For tooling/tests that need to sample the news generator
  // without waiting on natural cadence — normal play never needs this.
  State.cryptoDebugSpawnNews = function (coinId) {
    var d = State.data;
    if (!d) return null;
    ensureCrypto(d);
    var ev = spawnNewsEvent(d, coinId);
    commit();
    return ev ? deepClone(ev) : null;
  };

  // State.buyCrypto(coinId, usdAmount): spend usdAmount of cash (fee
  // included in that outlay) on coinId at the current price. Fractional
  // qty. Cost basis increases by the FULL usdAmount (so unrealized P/L
  // already nets the fee drag — an honest number for the player to sell
  // against). Spot only, no leverage: usdAmount can never exceed d.cash.
  State.buyCrypto = function (coinId, usdAmount) {
    var d = State.data;
    if (!d) return { ok: false, reason: 'no-data' };
    ensureCrypto(d);
    if (d.dead) return { ok: false, reason: 'dead' };
    var coin = cryptoCoinDef(coinId);
    if (!coin) return { ok: false, reason: 'unknown-coin' };
    usdAmount = Number(usdAmount);
    if (!(usdAmount > 0) || !isFinite(usdAmount)) return { ok: false, reason: 'invalid-amount' };
    if (usdAmount > d.cash) return { ok: false, reason: 'insufficient-cash' };
    var cfg = cryptoCfg();
    var feeRate = cfg.feeRate || 0;
    var fee = usdAmount * feeRate;
    var net = usdAmount - fee;
    var price = d.crypto.prices[coinId];
    var qty = net / price;
    d.cash -= usdAmount;
    var h = d.crypto.holdings[coinId];
    h.qty += qty;
    h.costBasis += usdAmount;
    commit();
    return { ok: true, coinId: coinId, qty: qty, price: price, fee: fee, spent: usdAmount, cash: d.cash, holding: deepClone(h) };
  };

  // State.sellCrypto(coinId, qty): sell qty of coinId at the current price,
  // fee taken out of proceeds. Reduces cost basis proportionally (weighted-
  // average method) and accumulates realizedPnl on the holding. qty is
  // clamped to whatever's actually held (floating-point-drift safe) — sells
  // for more than held are rejected rather than silently clamped.
  State.sellCrypto = function (coinId, qty) {
    var d = State.data;
    if (!d) return { ok: false, reason: 'no-data' };
    ensureCrypto(d);
    if (d.dead) return { ok: false, reason: 'dead' };
    var coin = cryptoCoinDef(coinId);
    if (!coin) return { ok: false, reason: 'unknown-coin' };
    qty = Number(qty);
    if (!(qty > 0) || !isFinite(qty)) return { ok: false, reason: 'invalid-qty' };
    var h = d.crypto.holdings[coinId];
    if (!h || qty > h.qty + 1e-6) return { ok: false, reason: 'insufficient-holdings' };
    qty = Math.min(qty, h.qty);
    var cfg = cryptoCfg();
    var feeRate = cfg.feeRate || 0;
    var price = d.crypto.prices[coinId];
    var grossValue = qty * price;
    var fee = grossValue * feeRate;
    var proceeds = grossValue - fee;
    var costRemoved = h.qty > 0 ? h.costBasis * (qty / h.qty) : 0;
    h.qty -= qty;
    h.costBasis -= costRemoved;
    if (h.qty <= 1e-9) { h.qty = 0; h.costBasis = 0; }
    var realized = proceeds - costRemoved;
    h.realizedPnl = (h.realizedPnl || 0) + realized;
    d.cash += proceeds;
    commit();
    return { ok: true, coinId: coinId, qty: qty, price: price, fee: fee, proceeds: proceeds, realized: realized, cash: d.cash, holding: deepClone(h) };
  };

  // State.sellAllCrypto(coinId): convenience wrapper — sells the entire
  // current holding (no-op-safe: returns insufficient-holdings if 0 held).
  State.sellAllCrypto = function (coinId) {
    var d = State.data;
    if (!d) return { ok: false, reason: 'no-data' };
    ensureCrypto(d);
    var h = d.crypto.holdings[coinId];
    var qty = h ? h.qty : 0;
    if (!(qty > 0)) return { ok: false, reason: 'insufficient-holdings' };
    return State.sellCrypto(coinId, qty);
  };

  // State.cryptoStatus(): read-only snapshot for the UI (Package C2) — per-
  // coin price/history/holdings/cost-basis/unrealized-P&L, the active news
  // feed (telegraphed direction only — actualSign/correct/fakeout stay
  // hidden until resolution), a rolling resolved-news log so the player can
  // see whether reading news has actually been paying off, and portfolio
  // totals. Does NOT tick — call State.tickCrypto() on an interval to keep
  // prices moving, same pattern as State.dayPhase()/tickEnergy().
  State.cryptoStatus = function () {
    var d = State.data;
    if (!d) return null;
    ensureCrypto(d);
    var cfg = cryptoCfg();
    var coins = Data().cryptoCoins || [];
    var out = {
      coins: [],
      news: [],
      newsHistory: [],
      feeRate: cfg.feeRate || 0,
      portfolio: { cash: d.cash, holdingsValue: 0, costBasis: 0, unrealizedPnl: 0, realizedPnl: 0, totalValue: 0 }
    };
    for (var i = 0; i < coins.length; i++) {
      var coin = coins[i];
      var price = d.crypto.prices[coin.id];
      var h = d.crypto.holdings[coin.id] || { qty: 0, costBasis: 0, realizedPnl: 0 };
      var value = h.qty * price;
      var unrealized = value - h.costBasis;
      out.coins.push({
        id: coin.id, name: coin.name, symbol: coin.symbol, dailyVol: coin.dailyVol,
        price: price, history: d.crypto.history[coin.id].slice(),
        qty: h.qty, costBasis: h.costBasis,
        avgCost: h.qty > 0 ? h.costBasis / h.qty : 0,
        value: value, unrealizedPnl: unrealized, realizedPnl: h.realizedPnl || 0
      });
      out.portfolio.holdingsValue += value;
      out.portfolio.costBasis += h.costBasis;
      out.portfolio.unrealizedPnl += unrealized;
      out.portfolio.realizedPnl += h.realizedPnl || 0;
    }
    out.portfolio.totalValue = out.portfolio.holdingsValue + d.cash;
    var newsList = d.crypto.news;
    for (var j = 0; j < newsList.length; j++) {
      var ev = newsList[j];
      out.news.push({
        id: ev.id, coinId: ev.coinId, text: ev.text, direction: ev.telegraphDir,
        createdAt: ev.createdAt, totalDays: ev.totalDays,
        progress: ev.totalTicks > 0 ? ev.elapsedTicks / ev.totalTicks : 0,
        ticksRemaining: ev.totalTicks - ev.elapsedTicks
      });
    }
    var hist = d.crypto.newsHistory;
    var start = Math.max(0, hist.length - 30);
    for (var k = start; k < hist.length; k++) out.newsHistory.push(hist[k]);
    return out;
  };

  // SPEC-V13 §8A: badge-dot support for the career nav's CRYPTO button,
  // mirroring the existing TOURNAMENTS dot pattern. "Unseen" = active news
  // events created after the last time the player viewed crypto news.
  State.cryptoUnseenNewsCount = function () {
    var d = State.data;
    if (!d) return 0;
    ensureCrypto(d);
    var seen = d.crypto.lastSeenNewsTick || 0;
    var list = d.crypto.news || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].createdTick > seen) n++;
    }
    return n;
  };

  State.markCryptoNewsSeen = function () {
    var d = State.data;
    if (!d) return;
    ensureCrypto(d);
    d.crypto.lastSeenNewsTick = d.crypto.tickCount;
    commit();
  };

  // fmtPhoneUnlockLabel: ready-to-render UPPERCASE "X TO INSTALL" string for
  // a locked phone-app tile (§3.3's example: '$20,000 TO INSTALL'). `prefix`
  // is prepended to the thousands-separated integer, `suffix` follows it —
  // e.g. fmtPhoneUnlockLabel('$', 20000, '') => '$20,000 TO INSTALL',
  // fmtPhoneUnlockLabel('', 300, ' FOLLOWERS') => '300 FOLLOWERS TO INSTALL'.
  function fmtPhoneUnlockLabel(prefix, n, suffix) {
    return prefix + Math.round(n).toLocaleString('en-US') + suffix + ' TO INSTALL';
  }

  // State.phoneStatus() (SPEC-V14 §2/§3.3/§5): single source of truth for
  // both the phone-package UI (P2, the home-screen tiles + peek badge) and
  // the app-owning package (P3, each screen's own locked state) — neither
  // should re-derive the unlock rule or the notification rule themselves.
  // Shape: { unlocked, followers, needed, apps: [
  //   { id, name, unlocked, unlockLabel, notifCount,
  //     progress: { current, target, pct } }, ... ] }
  // apps are always exactly [sponsors, social, crypto] in that order, even
  // while the phone itself is locked (§3.3: locked apps are SHOWN, never
  // hidden) — `progress` is additive beyond the four fields §2 names, for
  // the locked-tile progress meter §3.3 requires (crypto's cash-vs-$20,000,
  // and the same shape for sponsors/social's followers-vs-300 for symmetry).
  State.phoneStatus = function () {
    var d = State.data;
    var followers = d.followers || 0;
    var cash = d.cash || 0;
    var phoneUnlocked = !!d.phoneUnlocked;
    var cryptoUnlocked = !!d.cryptoAppUnlocked;

    // SPONSORS notif (§5): held sponsors currently atRisk or warned — reuses
    // State.sponsorsStatus() rather than re-reading d.sponsors/d.sponsorStreamDaysThisWeek
    // itself, so the at-risk rule (SPONSOR_AT_RISK_DAYS_THRESHOLD etc.) lives
    // in exactly one place.
    var sponsorsHeld = State.sponsorsStatus().held;
    var sponsorNotif = 0;
    for (var i = 0; i < sponsorsHeld.length; i++) {
      if (sponsorsHeld[i].atRisk || sponsorsHeld[i].warned) sponsorNotif++;
    }

    /* V22 (owner item 5): the HANDSET is never locked — the player has a phone
       from the first minute, and each app carries its own gate. A locked phone
       hid three whole systems behind one number and gave a new player a dead
       object on their desk; a locked APP shows them what is coming and what it
       costs, which is the same information doing useful work. */
    var socialUnlocked = !!d.socialAppUnlocked;
    // `|| held.length` is not redundant with the latch in applyPhoneUnlocks():
    // that only runs on a tick or a load, so anything holding sponsors between
    // those points would briefly report the app as locked. Never hide
    // something the player already owns, whatever order events arrived in.
    var sponsorsUnlocked = !!d.sponsorsAppUnlocked || sponsorsHeld.length > 0;

    var apps = [
      {
        id: 'sponsors', name: 'SPONSORS', unlocked: sponsorsUnlocked,
        // Not a number, so not fmtPhoneUnlockLabel — that helper formats a
        // numeric threshold, and forcing this through it would mean inventing
        // a fake count for "have a team".
        unlockLabel: sponsorsUnlocked ? null : 'SIGN A TEAM TO INSTALL',
        notifCount: sponsorsUnlocked ? sponsorNotif : 0,
        // Binary gate: 0% until signed, 100% after. Reported in the same shape
        // as the other two so the tile renderer needs no special case.
        progress: { current: sponsorsUnlocked ? 1 : 0, target: 1, pct: sponsorsUnlocked ? 1 : 0 }
      },
      {
        id: 'social', name: 'SOCIAL MEDIA', unlocked: socialUnlocked,
        unlockLabel: socialUnlocked ? null : fmtPhoneUnlockLabel('', SOCIAL_UNLOCK_FOLLOWERS, ' FOLLOWERS'),
        // §5: SOCIAL never carries a dot — posts are always available, so a
        // permanent dot would mean nothing. Recorded so it is not "fixed" later.
        notifCount: 0,
        progress: { current: followers, target: SOCIAL_UNLOCK_FOLLOWERS, pct: clamp(followers / SOCIAL_UNLOCK_FOLLOWERS, 0, 1) }
      },
      {
        id: 'crypto', name: 'CRYPTO TRADING', unlocked: cryptoUnlocked,
        unlockLabel: cryptoUnlocked ? null : fmtPhoneUnlockLabel('$', CRYPTO_APP_UNLOCK_CASH, ''),
        notifCount: cryptoUnlocked ? State.cryptoUnseenNewsCount() : 0,
        progress: { current: cash, target: CRYPTO_APP_UNLOCK_CASH, pct: clamp(cash / CRYPTO_APP_UNLOCK_CASH, 0, 1) }
      }
    ];

    return {
      unlocked: true,                 // the handset itself, always
      legacyPhoneUnlocked: phoneUnlocked, // the old latch, for anything still curious
      followers: followers,
      needed: SOCIAL_UNLOCK_FOLLOWERS,
      apps: apps
    };
  };

  /* ---- SPEC-V23: quest invites, the email inbox, and scout interest -------
     Package Q owns js/data.js + js/state.js only — js/email.js (the inbox
     UI) and js/clutch.js (THE CLUTCH minigame) are separate packages reading
     this API. See SPEC-V23-QUESTS.md §§4/6/7/8. */

  // findQuestInvite: the single lookup for a Data.questInvites entry by id —
  // every caller below goes through this rather than re-scanning the array
  // itself (HANDOFF-V2 §5.4).
  function findQuestInvite(id) {
    var list = Data().questInvites || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // pickInviteTierForElo: the highest-tier Data.questInvites entry whose
  // eloMin the given ELO meets (§4.2: "track the player's climb rather than
  // spamming café games at 1,800 ELO"). Single source for BOTH the daily
  // cadence roll AND the scout-stage-3 trial invite (§6) — a future retune
  // of "which tier do I qualify for" then only has one place to change.
  function pickInviteTierForElo(elo) {
    var list = Data().questInvites || [];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      if ((elo || 0) >= list[i].eloMin && (!best || list[i].eloMin > best.eloMin)) best = list[i];
    }
    return best;
  }

  function findEmailIdx(d, id) {
    var list = d.emails || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  // liveInvitesCount: 'open' (not yet accepted) OR 'accepted' (accepted, the
  // minigame hasn't resolved it yet) both count as "live" against
  // Data.questInviteMaxOpen — an accepted-but-unplayed invite still occupies
  // a slot, or the player could accept both open invites, sit on them
  // forever, and the cadence roll would keep generating more regardless.
  function liveInvitesCount(d) {
    var n = 0;
    var list = d.emails || [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.kind === 'invite' && (e.state === 'open' || e.state === 'accepted')) n++;
    }
    return n;
  }

  // capEmails: hold the inbox at 30 (§3.2), dropping the OLDEST *resolved*
  // entry first — `emails` is oldest-first internally (State.emails()
  // reverses it to newest-first on read), so the first non-open/-accepted
  // entry scanning from the front is the oldest settled one. An email still
  // 'open' or 'accepted' is never dropped out from under the player, even if
  // that means briefly exceeding 30 (can't happen in practice: at most
  // Data.questInviteMaxOpen invites are ever live at once, far under 30).
  function capEmails(d) {
    var MAX = 30;
    while ((d.emails || []).length > MAX) {
      var idx = -1;
      for (var i = 0; i < d.emails.length; i++) {
        var st = d.emails[i].state;
        if (st !== 'open' && st !== 'accepted') { idx = i; break; }
      }
      if (idx === -1) break; // everything left is still live — nothing safe to drop
      d.emails.splice(idx, 1);
    }
  }

  // pickTeamName: the ONLY sender-name source for quest/scout mail — reuses
  // the existing 100-team roster (Data.teams) rather than authoring a
  // second name list, which is exactly the second-copy pattern that has
  // caused four user-visible bugs already (HANDOFF-V2 §5.4/spec §3.3).
  function pickTeamName(d) {
    var teams = Data().teams || [];
    if (!teams.length) return 'AN UNKNOWN ORG';
    return teams[randInt(0, teams.length - 1)].name;
  }

  // makeInviteEmail: builds and appends a normal (non-scout) quest-invite
  // email for the given Data.questInvites tier. The email's `state` starts
  // 'open' — accepting/resolving it is entirely State.acceptInvite()/
  // State.resolveInvite()'s job below, never done here. `scoutStage` is
  // deliberately absent here (undefined, not even written) — it exists ONLY
  // to mark an email as scout-originated (see fireScoutStageEmail below), so
  // a cadence-rolled invite must never carry it, or "did stage N fire" stops
  // being answerable from the data.
  function makeInviteEmail(d, tier) {
    var id = 'em' + (d.emailSeq = (d.emailSeq || 0) + 1);
    var from = pickTeamName(d);
    var email = {
      id: id, kind: 'invite', inviteId: tier.id, from: from, subject: tier.name,
      body: from + ' wants you for ' + tier.name + '. Win it and the purse is $' + tier.purse + ', plus ' + tier.winElo + ' ELO. Lose and it costs you ' + Math.abs(tier.loseElo) + ' ELO.',
      day: d.day, read: false, state: 'open', expiresDay: d.day + (Data().questInviteExpiryDays || 3)
    };
    d.emails.push(email);
    capEmails(d);
    return email;
  }

  // fireScoutStageEmail (§6): every email fired here is stamped with
  // `scoutStage: def.stage` (the 1-based stage number) — on the stage-3
  // trial invite AND on the three kind:'scout' informational ones alike.
  // This is a per-entry field on emails[i], so it round-trips through
  // normalizeSave()'s wholesale array copy for free (HANDOFF-V2 §5.1) — no
  // defaultData() change, and specifically NOT a top-level mirror (that is
  // the second-copy bug the same trap warns about). Without it, a
  // scout-originated invite is byte-for-byte indistinguishable from a
  // cadence-rolled one in the saved data, and "did stage 3 fire, exactly
  // once" becomes unanswerable except by hardcoding "3 of the 4 stages
  // happen to be kind:'scout'" — which silently breaks the moment a stage is
  // added or reordered. Stage 3 is special — its email doubles as a
  // real, playable invite (kind: 'invite', reusing the SAME accept/resolve
  // pipeline every other quest invite uses — "a distinct, harder variant" is
  // still open per spec §10 item 3, so this deliberately does NOT reimplement
  // anything). Stages 1/2/4 are informational only (kind: 'scout') — stage 4
  // explicitly hands off to the existing offers flow rather than mirroring
  // it (spec §6: "must not reimplement offers").
  //
  // Deliberately NOT gated on Data.questInviteMaxOpen: that cap belongs to
  // the §4.2 cadence roll (a repeating background system that must be kept
  // from flooding the inbox); a scout stage fires AT MOST ONCE EVER per
  // save (latched by d.scoutStage), so it cannot flood anything, and
  // skipping/deferring it here would break "fires the first time it is
  // crossed" — there would be no later moment to retry from.
  function fireScoutStageEmail(d, def) {
    var id = 'em' + (d.emailSeq = (d.emailSeq || 0) + 1);
    var team = (def.stage === 2 || def.stage === 3) ? pickTeamName(d) : null;
    var body = def.body.replace('{team}', team || '');
    var email;
    if (def.stage === 3) {
      var tier = pickInviteTierForElo(d.elo || 0) || findQuestInvite('cafe');
      email = {
        id: id, kind: 'invite', inviteId: tier ? tier.id : null, scoutStage: def.stage,
        from: team || 'SCOUT', subject: def.subject, body: body,
        day: d.day, read: false, state: 'open', expiresDay: d.day + (Data().questInviteExpiryDays || 3)
      };
    } else {
      var sender = def.stage === 1 ? 'SCOUTING DESK' : (def.stage === 4 ? 'SCOUTING NETWORK' : team);
      email = {
        id: id, kind: 'scout', inviteId: null, scoutStage: def.stage,
        from: sender, subject: def.subject, body: body,
        // Informational mail never expires on its own — only a kind:'invite'
        // entry is swept for expiry below, so this deliberately has no
        // expiresDay to count down.
        day: d.day, read: false, state: 'open', expiresDay: null
      };
    }
    d.emails.push(email);
    capEmails(d);
    return email;
  }

  // rollDailyEmails: the real logic behind State.rollDailyEmails() below —
  // pure mutation of `d`, called from resolveNewDay() so EVERY day-advancing
  // path (State.endDay(), the interactive sleep/wake flow) rolls it, exactly
  // like tryGenerateOffers()/maybeRunLeagueCycle() above (§4.2: "rolled at
  // END DAY"). Order matters: expire stale invites BEFORE generating a new
  // one, so a just-expired slot can immediately be refilled the same day.
  function rollDailyEmails(d) {
    if (!d.emails) d.emails = [];

    // 1) expiry sweep (§4.2) — invites only; marks 'expired', never deletes.
    for (var i = 0; i < d.emails.length; i++) {
      var e = d.emails[i];
      if (e.kind === 'invite' && e.state === 'open' && e.expiresDay != null && d.day > e.expiresDay) {
        e.state = 'expired';
      }
    }

    // 2) quest invite cadence (§4.2): re-rolled fresh each call, matching
    // the spec's literal formula rather than pre-committing to one gap like
    // nextOfferEligibleDay does — the cadence only ever gates WHETHER a
    // roll happens, never WHICH tier, so re-rolling it daily is harmless.
    var gapRange = Data().questInviteIntervalDays || [3, 5];
    var gap = randInt(gapRange[0], gapRange[1]);
    if (d.day - (d.lastInviteDay || 0) >= gap && liveInvitesCount(d) < (Data().questInviteMaxOpen || 2)) {
      var tier = pickInviteTierForElo(d.elo || 0);
      if (tier) {
        makeInviteEmail(d, tier);
        d.lastInviteDay = d.day;
      }
    }

    // 3) scout interest (§6): fire EVERY newly-crossed stage this call, in
    // ascending order, each latching d.scoutStage immediately. A single call
    // could otherwise skip a stage entirely if a big ELO swing (e.g. a won
    // INVITATIONAL, +300) jumps clean over one between two rolls.
    var stages = Data().scoutStages || [];
    var elo = d.elo || 0;
    var crossed = [];
    for (var s = 0; s < stages.length; s++) {
      if (stages[s].stage > (d.scoutStage || 0) && elo >= stages[s].elo) crossed.push(stages[s]);
    }
    crossed.sort(function (a, b) { return a.stage - b.stage; });
    for (var c = 0; c < crossed.length; c++) {
      fireScoutStageEmail(d, crossed[c]);
      d.scoutStage = crossed[c].stage; // latched — never re-fires (§6, §7)
    }
  }

  // State.emails(): newest first, a copy — `emails` is stored oldest-last
  // (§7) so the UI never has to re-sort.
  State.emails = function () {
    return (State.data.emails || []).slice().reverse();
  };

  State.unreadEmailCount = function () {
    var list = State.data.emails || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) if (!list[i].read) n++;
    return n;
  };

  State.readEmail = function (id) {
    var d = State.data;
    var idx = findEmailIdx(d, id);
    if (idx === -1) return { ok: false, reason: 'UNKNOWN EMAIL' };
    d.emails[idx].read = true;
    commit();
    return { ok: true };
  };

  // State.acceptInvite (§1 — THE LOAD-BEARING RULE): this deliberately does
  // the OPPOSITE of State.playMatch(), which pre-rolls its result before its
  // minigame overlay even opens. A quest is opt-in side content off the
  // critical path, so THE CLUTCH minigame itself is the decider — accepting
  // here changes NO cash and NO ELO, only the email's own state. Do not
  // "fix" this to match playMatch()'s ordering; that inversion is the entire
  // point of the feature (see State.resolveInvite() below, which the
  // minigame's completion callback calls with the real outcome).
  State.acceptInvite = function (id) {
    var d = State.data;
    var idx = findEmailIdx(d, id);
    if (idx === -1) return { ok: false, reason: 'UNKNOWN EMAIL' };
    var e = d.emails[idx];
    if (e.kind !== 'invite') return { ok: false, reason: 'NOT AN INVITE' };
    if (e.state === 'expired') return { ok: false, reason: 'EXPIRED' };
    if (e.state !== 'open') return { ok: false, reason: 'ALREADY RESOLVED' };
    var tier = findQuestInvite(e.inviteId);
    if (tier && (d.elo || 0) < tier.eloMin) return { ok: false, reason: 'ELO TOO LOW' };
    e.state = 'accepted';
    e.read = true;
    commit();
    return {
      ok: true,
      invite: tier ? {
        id: tier.id, name: tier.name, purse: tier.purse, winElo: tier.winElo,
        loseElo: tier.loseElo, loseCash: tier.loseCash, enemies: tier.enemies, exposeMs: tier.exposeMs
      } : null
    };
  };

  // State.resolveInvite (§1): called BY THE MINIGAME's completion callback
  // with what the player actually achieved — this file never decides `won`
  // itself. See State.acceptInvite() above for why acceptance never touches
  // cash/ELO: this is the ONLY place either currency moves for a quest.
  State.resolveInvite = function (id, won) {
    var d = State.data;
    var idx = findEmailIdx(d, id);
    if (idx === -1) return { ok: false, reason: 'UNKNOWN EMAIL' };
    var e = d.emails[idx];
    if (e.kind !== 'invite') return { ok: false, reason: 'NOT AN INVITE' };
    if (e.state === 'expired') return { ok: false, reason: 'EXPIRED' };
    if (e.state !== 'accepted') return { ok: false, reason: 'ALREADY RESOLVED' };
    var tier = findQuestInvite(e.inviteId);
    if (!tier) return { ok: false, reason: 'UNKNOWN EMAIL' };
    var cash, elo;
    if (won) {
      cash = tier.purse; elo = tier.winElo; e.state = 'won';
    } else {
      cash = tier.loseCash; elo = tier.loseElo; e.state = 'lost';
    }
    d.cash += cash;
    d.elo = Math.max(0, (d.elo || 0) + elo);
    commit();
    return { ok: true, cash: cash, elo: elo };
  };

  // State.declineInvite: settles an OPEN invite without playing it — no cash,
  // no ELO, either direction. Maps to 'expired' (not a sixth state outside
  // the §7 schema's five) since the visible effect is identical: gone,
  // unplayed, settled in the player's own history.
  State.declineInvite = function (id) {
    var d = State.data;
    var idx = findEmailIdx(d, id);
    if (idx === -1) return { ok: false, reason: 'UNKNOWN EMAIL' };
    var e = d.emails[idx];
    if (e.kind !== 'invite') return { ok: false, reason: 'NOT AN INVITE' };
    if (e.state === 'expired') return { ok: false, reason: 'EXPIRED' };
    if (e.state !== 'open') return { ok: false, reason: 'ALREADY RESOLVED' };
    e.state = 'expired';
    e.read = true;
    commit();
    return { ok: true };
  };

  // State.rollDailyEmails(): the public entry point mirrored by
  // resolveNewDay() (called automatically on every day advance, §4.2) — also
  // exposed directly so the suite (and any future caller) can drive the
  // exact same code path without waiting for a full endDay().
  State.rollDailyEmails = function () {
    var d = State.data;
    rollDailyEmails(d);
    commit();
    return { ok: true };
  };

  // State.scoutStatus (§6): a pure readout derived from d.elo/d.scoutStage
  // against Data.scoutStages — NOT a new stored economy. `interest` is 0..1
  // progress toward the next un-fired stage; 1 once every stage has fired.
  State.scoutStatus = function () {
    var d = State.data;
    var stages = Data().scoutStages || [];
    var stage = d.scoutStage || 0;
    var elo = d.elo || 0;
    var prevElo = 0, next = null;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].stage === stage) prevElo = stages[i].elo;
      if (stages[i].stage === stage + 1) next = stages[i];
    }
    if (!next) {
      return { interest: 1, stage: stage, label: stages.length ? stages[stages.length - 1].subject : 'FULLY SCOUTED' };
    }
    var span = Math.max(1, next.elo - prevElo);
    var interest = clamp((elo - prevElo) / span, 0, 1);
    return { interest: interest, stage: stage, label: next.subject };
  };

  State.findShopItem = findShopItem;
  State.util = { clamp: clamp, rand: rand, randInt: randInt, genId: genId };

  window.Game = window.Game || {};
  window.Game.State = State;
})();
