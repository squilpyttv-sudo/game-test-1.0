/* ==========================================================================
   CS2 PRO SIMULATOR — js/cases.js
   Case Unboxing minigame (SPEC §5.6) + the SPEC-V15 §10 case-tier SELECTOR
   (owner item §10, UI half). Attaches to window.Game.Cases.
   Registers screen 'cases' and exposes a reusable roulette API that
   js/stream.js consumes for the "open a case live on stream" synergy.

   The actual roll, odds/luck math, and auto-sell (SPEC-V2 §10 — the pulled
   skin is sold immediately, value added to cash) are owned by Game.State
   (State.openCase) — this module is purely the presentation layer: the
   tier selector, the accelerate-then-ease-out roulette strip, tick sounds,
   rare-pull FX, and the "SOLD — +$X" / net-vs-cost reveal.

   SPEC-V15 §7/§10 (NEW this pass): three case tiers exist now
   (Data.caseTiers — case_standard $7 / case_prime $50 / case_elite $200),
   each with its own scaled value bands (State.caseTiers()) computed
   server-side so this file never hand-derives a range. Which tier opens
   SOLO (this screen's OPEN CASE button) and which opens ON STREAM
   (js/stream.js's separate live button) are two INDEPENDENT choices
   (d.caseSelection.solo / .stream, State.setCaseSelection()) — the tier
   card below always shows both, with two separate pick buttons, so it's
   never a single toggle the player has to infer. The gold (RARE SPECIAL)
   split stays a hidden '?' at every tier — see SPEC-V3 §11, unchanged.
   ========================================================================== */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};

  var RARITY_ORDER = ['milspec', 'restricted', 'classified', 'covert', 'rare'];
  var RARITY_FALLBACK = {
    milspec:    { label: 'MIL-SPEC',      colorVar: '--r-milspec',    chance: 65.0 },
    restricted: { label: 'RESTRICTED',    colorVar: '--r-restricted', chance: 25.0 },
    classified: { label: 'CLASSIFIED',    colorVar: '--r-classified', chance: 6.5 },
    covert:     { label: 'COVERT',        colorVar: '--r-covert',     chance: 2.5 },
    rare:       { label: 'RARE SPECIAL',  colorVar: '--r-rare',       chance: 1.0 }
  };
  var FALLBACK_CASE_COST = 7.00;
  var FALLBACK_CASE_ENERGY = 1;
  // Defensive fallback only — mirrors Data.caseTiers so this screen never
  // hard-crashes if State/Data aren't ready yet. Real numbers always come
  // from State.caseTiers()/State.caseSelection() below.
  var FALLBACK_TIERS = [
    { id: 'case_standard', label: 'STANDARD CASE', cost: 7.00, affordable: true, odds: [] },
    { id: 'case_prime',    label: 'PRIME CASE',     cost: 50.00, affordable: false, odds: [] },
    { id: 'case_elite',    label: 'ELITE CASE',     cost: 200.00, affordable: false, odds: [] }
  ];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function caseOddsEntry(rarityId) {
    if (G.Data && G.Data.caseOdds) {
      for (var i = 0; i < G.Data.caseOdds.length; i++) {
        if (G.Data.caseOdds[i].id === rarityId) return G.Data.caseOdds[i];
      }
    }
    return null;
  }

  function rarityLabel(rarityId) {
    var e = caseOddsEntry(rarityId);
    if (e) return e.label;
    return (RARITY_FALLBACK[rarityId] || {}).label || rarityId.toUpperCase();
  }

  function rarityColor(rarityId) {
    var e = caseOddsEntry(rarityId);
    var colorVar = e ? e.colorVar : ((RARITY_FALLBACK[rarityId] || {}).colorVar || '--r-milspec');
    return 'var(' + colorVar + ')';
  }

  function baseChancePercent(rarityId) {
    var e = caseOddsEntry(rarityId);
    if (e) return e.chance * 100; // Data.caseOdds stores chance as a 0..1 fraction
    return (RARITY_FALLBACK[rarityId] || {}).chance || 0;
  }

  // caseCost(): UNCHANGED signature/behaviour — js/stream.js calls this with
  // no arguments for its live-open HUD label, and that label has always
  // meant "the base $7 case cost" historically. Do not repurpose it for a
  // tier lookup; use tierCost(tierId) below for that instead, so the one
  // existing external caller can't silently start reading a different case.
  function caseCost() {
    return (G.Data && G.Data.caseCost) || FALLBACK_CASE_COST;
  }

  function caseEnergyCost() {
    var raw = (G.Data && G.Data.energyCosts) ? G.Data.energyCosts.case : null;
    return (raw != null) ? raw : FALLBACK_CASE_ENERGY;
  }

  // -- SPEC-V15 §7/§10: tier + selection reads --------------------------------
  function getTiers() {
    if (G.State && typeof G.State.caseTiers === 'function') return G.State.caseTiers();
    return FALLBACK_TIERS;
  }
  function findTier(tiers, id) {
    for (var i = 0; i < tiers.length; i++) if (tiers[i].id === id) return tiers[i];
    return tiers[0];
  }
  function getSelection() {
    if (G.State && typeof G.State.caseSelection === 'function') return G.State.caseSelection();
    return { solo: 'case_standard', stream: 'case_standard' };
  }
  function tierCost(tierId) {
    var t = findTier(getTiers(), tierId);
    return t ? t.cost : caseCost();
  }
  // Overall headline value range for a tier card: lowest non-hidden min to
  // highest non-hidden max across its rarities. The gold (RARE SPECIAL) row
  // is always excluded — SPEC-V3 §11 — so this can never leak the hidden
  // two-tier split even indirectly.
  function tierRangeText(tier) {
    var lo = null, hi = null;
    (tier.odds || []).forEach(function (o) {
      if (o.hidden || o.min == null || o.max == null) return;
      if (lo === null || o.min < lo) lo = o.min;
      if (hi === null || o.max > hi) hi = o.max;
    });
    if (lo === null) return '$? – $?';
    return G.UI.money(lo) + ' – ' + G.UI.money(hi) + '  +RARE ?';
  }

  function weightedFillerRarity() {
    var total = 0;
    var chances = RARITY_ORDER.map(function (id) {
      var c = baseChancePercent(id);
      total += c;
      return c;
    });
    var roll = Math.random() * total;
    var acc = 0;
    for (var i = 0; i < RARITY_ORDER.length; i++) {
      acc += chances[i];
      if (roll <= acc) return RARITY_ORDER[i];
    }
    return 'milspec';
  }

  /* ==========================================================================
     SKIN SPRITES (V22, owner item 2)

     Every skin on the wheel gets a 16x16 pixel tile. Two tables, multiplied:

       GUN_SHAPES   — the silhouette, one per WEAPON CLASS. Flat rectangles on
                      a 16x16 grid, exactly the authored pixel-art system
                      js/main.js already uses for the nav glyphs (§3.2) — not a
                      second art pipeline, and no external assets (a hard
                      project constraint).
       FINISHES     — four colours per finish: body, accent, outline, highlight.

     A skin names one of each. That is how CS skins genuinely work — an AK is
     an AK whatever the finish — and it is why 58 distinct tiles need 9 drawn
     shapes and not 58. Adding a skin is one data line, never new art.

     Rect format: [x, y, w, h, slot] where slot indexes the finish palette
     1..4. Painted in array order, so later rects overprint earlier ones.
     ========================================================================== */
  var GUN_SHAPES = {
    rifle: [
      [1, 5, 3, 3, 3], [4, 4, 9, 1, 3], [4, 5, 9, 3, 1], [5, 6, 6, 1, 2],
      [13, 6, 3, 1, 3], [5, 8, 2, 3, 3], [8, 8, 2, 4, 1], [8, 8, 2, 1, 3],
      [4, 5, 9, 1, 4]
    ],
    pistol: [
      [5, 4, 6, 1, 3], [5, 5, 6, 2, 1], [6, 5, 3, 1, 2], [11, 5, 2, 1, 3],
      [5, 7, 3, 5, 3], [6, 8, 1, 3, 1], [5, 5, 6, 1, 4]
    ],
    sniper: [
      [6, 2, 4, 1, 3], [6, 3, 4, 1, 1], [7, 3, 2, 1, 4],
      [1, 5, 14, 1, 3], [1, 6, 14, 2, 1], [3, 7, 8, 1, 2],
      [5, 8, 2, 4, 3], [8, 8, 2, 3, 1], [1, 6, 14, 1, 4]
    ],
    smg: [
      [5, 4, 7, 1, 3], [5, 5, 7, 2, 1], [6, 6, 4, 1, 2], [12, 5, 2, 1, 3],
      [5, 7, 2, 4, 3], [7, 7, 2, 4, 1], [5, 5, 7, 1, 4]
    ],
    shotgun: [
      [2, 4, 12, 1, 3], [2, 5, 12, 3, 1], [4, 6, 7, 1, 2], [14, 6, 2, 1, 3],
      [5, 8, 2, 4, 3], [7, 8, 3, 2, 3], [2, 5, 12, 1, 4]
    ],
    lmg: [
      [3, 3, 10, 1, 3], [3, 4, 10, 3, 1], [5, 5, 5, 1, 2], [13, 5, 3, 1, 3],
      [4, 7, 6, 3, 1], [4, 7, 6, 1, 3], [5, 10, 2, 2, 3], [3, 4, 10, 1, 4]
    ],
    duals: [
      [2, 4, 5, 1, 3], [2, 5, 5, 2, 1], [3, 5, 2, 1, 2], [2, 7, 2, 3, 3],
      [9, 4, 5, 1, 3], [9, 5, 5, 2, 1], [10, 5, 2, 1, 2], [9, 7, 2, 3, 3]
    ],
    knife: [
      [11, 3, 3, 1, 1], [10, 4, 3, 1, 1], [9, 5, 3, 1, 1], [8, 6, 3, 1, 1],
      [7, 7, 3, 1, 1], [6, 8, 3, 1, 1],
      [12, 3, 2, 1, 4], [11, 4, 2, 1, 4], [10, 5, 2, 1, 4],
      [4, 9, 3, 2, 3], [3, 10, 2, 2, 3], [4, 9, 3, 1, 2]
    ],
    gloves: [
      [4, 3, 8, 1, 3], [3, 4, 10, 6, 1], [4, 5, 8, 1, 2],
      [3, 10, 10, 2, 1], [4, 12, 8, 1, 3],
      [2, 5, 1, 4, 1], [12, 4, 1, 3, 1], [3, 4, 10, 1, 4]
    ]
  };

  // [body, accent, outline, highlight]. Literal hex is correct here for the
  // same reason js/iso.js's is: this is authored ART drawn to a canvas, which
  // cannot read CSS variables — the tokens-only rule covers stylesheets.
  var FINISHES = {
    tape:       ['#C8B48A', '#8A7A55', '#241E14', '#E8DCC0'],
    circuit:    ['#2E6E5A', '#7FE3B0', '#0E2620', '#A9F5D0'],
    rust:       ['#8A4A2A', '#D2793C', '#2A1409', '#E8A46A'],
    fault:      ['#4A4E6E', '#C9CCE8', '#161826', '#E8EAF6'],
    rift:       ['#3B2E6B', '#9B7FE8', '#140F26', '#C7B4F5'],
    pearl:      ['#D8D4E0', '#9A94AC', '#2A2830', '#FFFFFF'],
    glass:      ['#7FA8C9', '#CFE6F5', '#1A2732', '#FFFFFF'],
    howl:       ['#8C2A1E', '#E8622E', '#250905', '#F5A05A'],
    crimson:    ['#8E1F32', '#D94A63', '#220509', '#F08098'],
    toxic:      ['#5E8A1E', '#B6E84A', '#161F06', '#D8F58A'],
    vogue:      ['#B0407A', '#F0A0C8', '#2A0A1C', '#FFD0E6'],
    tomb:       ['#5A5448', '#9E9682', '#1A1712', '#C8C0AC'],
    printstream:['#E6E6EA', '#2A2A32', '#0A0A0E', '#FFFFFF'],
    anubis:     ['#2A4E6E', '#D8B04A', '#0A1420', '#F0D882'],
    bone:       ['#D8CFB8', '#8E8570', '#241F16', '#F5EEDC'],
    cirrus:     ['#5A7EA8', '#BBD4EC', '#141E2A', '#E2EEFA'],
    iron:       ['#6E6E74', '#A8A8B0', '#1C1C20', '#D0D0D8'],
    sand:       ['#B89A62', '#7A6238', '#241C10', '#DCC694'],
    stitch:     ['#7A5A3E', '#C09A6E', '#20140C', '#DCBE96'],
    leather:    ['#5A3A28', '#8E5E40', '#180E08', '#B08262'],
    cyrex:      ['#D8D8DC', '#D9432E', '#20080A', '#FFFFFF'],
    flash:      ['#4A6E9E', '#E8E24A', '#101A28', '#F5F0A0'],
    royal:      ['#3A2A6E', '#D8B04A', '#100A20', '#F0D882'],
    mecha:      ['#4E5A6E', '#7FD4E8', '#141820', '#B0ECF5'],
    waste:      ['#7A6E4A', '#C0A860', '#201C10', '#DCC894'],
    dragon:     ['#8E2A1E', '#F0A030', '#220806', '#F5C870'],
    buzz:       ['#C85A1E', '#F0C030', '#281006', '#F5DC80'],
    snake:      ['#3E5A2E', '#8EC04A', '#101806', '#BCE088'],
    mint:       ['#3E8A72', '#A0E8CC', '#0E2018', '#D0F5E6'],
    hedge:      ['#2E5A2E', '#6EA84A', '#0A1806', '#A0D080'],
    violet:     ['#5A2E8A', '#B47FE8', '#160A22', '#DCC0F5'],
    deep:       ['#1E3A5A', '#4A8EC0', '#060E18', '#8CC0E8'],
    tempered:   ['#4A6E8E', '#C89A3E', '#0E1620', '#E8C070'],
    hypno:      ['#6E2E8A', '#E84AC0', '#180A20', '#F58CDC'],
    thunder:    ['#2A3A6E', '#F0E84A', '#0A0E20', '#F5F0A0'],
    marble:     ['#D8D4E0', '#C83A5A', '#2A2830', '#FFFFFF'],
    doppler:    ['#2E2A6E', '#4AC8E8', '#0A0820', '#8CE8F5'],
    sapphire:   ['#1E2A8A', '#4A7FE8', '#060A22', '#8CB0F5']
  };

  var SPRITE_PX = 16;

  // Name -> sprite descriptor, built once from Data.caseSkins so the lookup is
  // by the SAME string State.openCase writes into the save. The save stores the
  // name only (never a duplicated sprite), so this index is what turns a saved
  // skin back into art.
  var spriteIndex = null;
  function skinSpriteFor(name) {
    if (!spriteIndex) {
      spriteIndex = {};
      var all = (G.Data && G.Data.caseSkins) || {};
      for (var caseId in all) {
        for (var rarity in all[caseId]) {
          var list = all[caseId][rarity];
          for (var i = 0; i < list.length; i++) spriteIndex[list[i].name] = list[i].sprite;
        }
      }
    }
    return spriteIndex[name] || null;
  }

  // Draws a skin's 16x16 tile into `canvas` at whatever size it is, nearest
  // neighbour (no smoothing) so the pixels stay hard-edged like the rest of
  // the game's art.
  function drawSkinSprite(canvas, name) {
    var spec = skinSpriteFor(name);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!spec) return false;
    var shape = GUN_SHAPES[spec.gun];
    var pal = FINISHES[spec.finish];
    if (!shape || !pal) return false;
    var s = canvas.width / SPRITE_PX;
    ctx.imageSmoothingEnabled = false;
    for (var i = 0; i < shape.length; i++) {
      var r = shape[i];
      ctx.fillStyle = pal[r[4] - 1];
      ctx.fillRect(Math.round(r[0] * s), Math.round(r[1] * s), Math.ceil(r[2] * s), Math.ceil(r[3] * s));
    }
    return true;
  }

  // Exposed so the lead can verify sprite coverage by measurement rather than
  // by eye — see test-v22-fixes.js.
  G.CaseSprites = {
    shapes: GUN_SHAPES, finishes: FINISHES,
    spriteFor: skinSpriteFor, draw: drawSkinSprite
  };

  /* randomSkinName — a filler tile for the strip. Reads the CURRENT case's
     pool through Data.skinsForCase(), the same resolver State.openCase() rolls
     against, so the wheel can never advertise an item this case cannot drop.
     Before V22 both sides read one shared table, which is exactly why all
     three cases looked identical. */
  // State.caseSelection() is { solo, stream } — TWO independent choices (§10),
  // so which one is live depends on where the wheel is being spun. js/cases.js
  // spins the solo one; js/stream.js passes onStream.
  function currentCaseId(onStream) {
    try {
      var sel = getSelection();
      var id = onStream ? sel.stream : sel.solo;
      if (id) return id;
    } catch (e) { /* fall through */ }
    return 'case_standard';
  }

  function randomSkinEntry(rarityKey, caseId) {
    var arr = (G.Data && G.Data.skinsForCase)
      ? G.Data.skinsForCase(caseId || currentCaseId(), rarityKey) : [];
    if (!arr.length) return { name: rarityLabel(rarityKey), sprite: null };
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randomSkinName(rarityKey, caseId) {
    return randomSkinEntry(rarityKey, caseId).name;
  }

  function splitSkinName(full) {
    var idx = full.indexOf('|');
    if (idx === -1) return { weapon: full, skin: '' };
    return { weapon: full.slice(0, idx).trim(), skin: full.slice(idx + 1).trim() };
  }

  // Each tile shows a real weapon/skin name + a rarity-colored accent bar so
  // the strip reads as authentic CS inventory rushing past, not blank swatches.
  function buildTileEl(rarityKey, tileWidth, isWinner, forcedName, caseId) {
    var el = document.createElement('div');
    el.className = 'case-tile case-tile-' + rarityKey + (isWinner ? ' case-tile-winner' : '');
    el.style.width = tileWidth + 'px';
    el.style.minWidth = tileWidth + 'px';
    var color = rarityColor(rarityKey);
    el.style.setProperty('--tile-accent', color);
    var fullName = forcedName || randomSkinName(rarityKey, caseId);
    var parts = splitSkinName(fullName);
    el.innerHTML =
      '<canvas class="case-tile-sprite" width="48" height="48"></canvas>' +
      '<div class="case-tile-weapon">' + escapeHtml(parts.weapon) + '</div>' +
      (parts.skin ? '<div class="case-tile-skin">' + escapeHtml(parts.skin) + '</div>' : '') +
      '<div class="case-tile-bar"></div>';
    // 48 = 16 * 3, an exact integer multiple of the sprite grid so every pixel
    // lands on a whole number of device pixels and nothing blurs.
    var cvs = el.querySelector('.case-tile-sprite');
    if (cvs && !drawSkinSprite(cvs, fullName)) {
      // No sprite for this name (a legacy save's skin, or a name that outlived
      // its table entry). Drop the canvas rather than leave a blank hole — the
      // tile falls back to the text-only layout it had before V22.
      cvs.parentNode.removeChild(cvs);
    }
    return el;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

  // -- reusable roulette strip animation ------------------------------------
  // Returns a handle { cancel() } so any caller (this screen, or stream.js)
  // can abort the rAF loop cleanly if the player navigates away mid-spin.
  function playRoulette(containerEl, resultItem, opts) {
    opts = opts || {};
    var tileWidth = opts.tileWidth || 84;
    var tileCount = opts.tileCount || 60;
    var isRare = resultItem.rarity === 'covert' || resultItem.rarity === 'rare';
    var duration = opts.duration || (isRare ? 5200 : 3600);
    var ease = isRare ? easeOutQuint : easeOutCubic;
    var winIndex = opts.winIndex || Math.floor(tileCount * 0.72);

    containerEl.innerHTML = '';
    var viewport = document.createElement('div');
    viewport.className = 'case-roulette';
    var strip = document.createElement('div');
    strip.className = 'case-strip';
    viewport.appendChild(strip);
    var marker = document.createElement('div');
    marker.className = 'case-marker';
    viewport.appendChild(marker);
    containerEl.appendChild(viewport);

    // Which case's pool the filler tiles come from. Callers may state it
    // outright (opts.caseId); otherwise it is the player's live selection for
    // this context — js/stream.js spins with onStream, this screen without.
    var stripCaseId = opts.caseId || currentCaseId(!!opts.onStream);

    for (var i = 0; i < tileCount; i++) {
      var rk = (i === winIndex) ? resultItem.rarity : weightedFillerRarity();
      var forcedName = (i === winIndex) ? resultItem.skin : null;
      strip.appendChild(buildTileEl(rk, tileWidth, i === winIndex, forcedName, stripCaseId));
    }

    var viewportW = viewport.clientWidth || (opts.viewportWidth || 340);
    var distance = winIndex * tileWidth + tileWidth / 2 - viewportW / 2;

    var raf = null;
    var start = null;
    var lastIdx = -1;
    var cancelled = false;
    var flashed = false;

    function onTick(idx) {
      if (idx === lastIdx) return;
      lastIdx = idx;
      if (G.UI && G.UI.beep) G.UI.beep('click');
    }

    function frame(now) {
      if (cancelled) return;
      if (start === null) start = now;
      var t = clamp((now - start) / duration, 0, 1);
      var eased = ease(t);
      var x = -distance * eased;
      strip.style.transform = 'translateX(' + x + 'px)';
      var idx = Math.floor((distance * eased) / tileWidth);
      onTick(idx);

      if (isRare && !flashed && t > 0.85) {
        flashed = true;
        flashScreen(rarityColor(resultItem.rarity));
      }

      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        strip.classList.add('case-strip-done');
        if (typeof opts.onDone === 'function') opts.onDone(resultItem);
      }
    }

    raf = requestAnimationFrame(frame);

    return {
      cancel: function () {
        cancelled = true;
        if (raf !== null) cancelAnimationFrame(raf);
      }
    };
  }

  function flashScreen(color) {
    var flash = document.createElement('div');
    flash.className = 'case-flash';
    flash.style.background = color;
    document.body.appendChild(flash);
    flash.addEventListener('animationend', function () {
      if (flash.parentNode) flash.parentNode.removeChild(flash);
    });
  }

  /* ---------------------------------------------------------------- icons
     Authored SVG only (ART-DIRECTION.md §2.5 / craft floor) — one stroke
     weight (2px), currentColor, same convention js/phone.js established.
     Replaces the old Unicode diamond (&#9670;) case emblem. */
  var ICON_CRATE =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 8l9-5 9 5-9 5-9-5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M3 8v9l9 5 9-5V8M12 13v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';
  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" class="case-tier__pick-icon" aria-hidden="true">' +
      '<path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // -- screen: standalone Cases minigame ------------------------------------
  var root = null;
  var activeHandle = null;
  var busy = false;
  var wrapEl = null;

  function onEnter() {
    root = G.Router.root('cases');
    root.innerHTML = '';
    busy = false;
    activeHandle = null;
    buildIdle();
  }

  function onExit() {
    if (activeHandle) { activeHandle.cancel(); activeHandle = null; }
    busy = false;
    if (root) root.innerHTML = '';
    root = null;
    wrapEl = null;
  }

  function statLine() {
    var d = G.State && G.State.data;
    var stats = (d && d.stats) || { casesOpened: 0, bestPull: 0 };
    return 'OPENED: ' + (stats.casesOpened || 0) + '   BEST PULL: ' + G.UI.money(stats.bestPull || 0);
  }

  function buildIdle() {
    root.innerHTML = '';
    var wrap = document.createElement('div');
    wrapEl = wrap;
    wrap.className = 'mg-wrap cases-wrap';
    wrap.innerHTML =
      '<div class="mg-header">' +
        '<button type="button" class="btn mg-back">&larr; BACK</button>' +
        '<div class="mg-title">CASE OPENING</div>' +
        '<div class="mg-spacer"></div>' +
      '</div>' +
      // Owner playtest: "make it so the case spin happens on the top of the
      // case opening page, and you can select the case you wanna open solo and
      // on stream in the bottom of the page." The spin (case-art +
      // case-strip-slot) leads; the tier PICKER moves to the bottom, since
      // choosing a tier is a once-in-a-while decision while the spin is the
      // thing you actually came to watch. See .cases-wrap in css/minigames.css
      // for the scroll fix that makes the lower half reachable at all.
      '<div class="cases-stats h-label">' + statLine() + '</div>' +
      '<div class="case-art panel" id="case-art"></div>' +
      '<div class="case-strip-slot"></div>' +
      '<div class="case-result-slot"></div>' +
      '<button type="button" class="btn mg-start-btn case-open-btn">OPEN CASE</button>' +
      '<div class="case-odds panel" id="case-odds"></div>' +
      '<div class="case-tier-list" id="case-tier-list"></div>';
    root.appendChild(wrap);
    wrap.querySelector('.mg-back').addEventListener('click', function () {
      G.UI.beep('click');
      G.Router.back();
    });
    wrap.querySelector('.case-open-btn').addEventListener('click', function () {
      openCase(wrap);
    });

    renderTierList();
    renderCaseArt();
    renderOdds();
  }

  // SPEC-V15 §10 — the tier selector: three case cards, cost + value range
  // + CAN'T AFFORD tag (never hidden), and two independent SOLO/STREAM pick
  // buttons so the player always sees which tier is set for which context.
  function renderTierList() {
    if (!wrapEl) return;
    var host = wrapEl.querySelector('#case-tier-list');
    if (!host) return;
    host.innerHTML = '';
    var tiers = getTiers();
    var sel = getSelection();
    tiers.forEach(function (tier) {
      host.appendChild(buildTierCard(tier, sel));
    });
  }

  function buildTierCard(tier, sel) {
    var isSolo = sel.solo === tier.id;
    var isStream = sel.stream === tier.id;
    var card = document.createElement('div');
    card.className = 'case-tier panel' +
      (tier.affordable === false ? ' case-tier--locked' : '') +
      (isSolo ? ' case-tier--solo' : '') +
      (isStream ? ' case-tier--stream' : '');

    var head = document.createElement('div');
    head.className = 'case-tier__head';
    var label = document.createElement('div');
    label.className = 'case-tier__label';
    label.textContent = tier.label;
    var cost = document.createElement('div');
    cost.className = 'case-tier__cost';
    cost.textContent = G.UI.money(tier.cost);
    head.appendChild(label);
    head.appendChild(cost);
    card.appendChild(head);

    var range = document.createElement('div');
    range.className = 'case-tier__range';
    range.textContent = tierRangeText(tier);
    card.appendChild(range);

    if (tier.affordable === false) {
      var lockTag = document.createElement('div');
      lockTag.className = 'case-tier__lock';
      lockTag.textContent = "CAN'T AFFORD";
      card.appendChild(lockTag);
    }

    var picks = document.createElement('div');
    picks.className = 'case-tier__picks';
    picks.appendChild(buildPickBtn('OPEN SOLO', isSolo, function () { onPick('solo', tier); }));
    picks.appendChild(buildPickBtn('ON STREAM', isStream, function () { onPick('stream', tier); }));
    card.appendChild(picks);

    return card;
  }

  function buildPickBtn(text, active, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'case-tier__pick' + (active ? ' case-tier__pick--active' : '');
    b.innerHTML = (active ? ICON_CHECK : '') + '<span>' + text + '</span>';
    b.addEventListener('click', function () {
      if (busy) return;
      onClick();
    });
    return b;
  }

  function onPick(slot, tier) {
    if (!G.State || typeof G.State.setCaseSelection !== 'function') return;
    var res = G.State.setCaseSelection(slot, tier.id);
    if (!res || !res.ok) return;
    G.UI.beep('click');
    G.UI.toast((slot === 'solo' ? 'SOLO' : 'ON STREAM') + ' SET TO ' + tier.label, 'info');
    renderTierList();
    renderCaseArt();
    renderOdds();
  }

  // The case-art panel + OPEN CASE button always act on the SOLO selection —
  // the ON STREAM slot is opened from js/stream.js's own live button, never
  // from here (SPEC-V15 §10: two independent contexts, one screen each).
  function renderCaseArt() {
    if (!wrapEl) return;
    var host = wrapEl.querySelector('#case-art');
    if (!host) return;
    var tiers = getTiers();
    var sel = getSelection();
    var soloTier = findTier(tiers, sel.solo);
    var streamTier = findTier(tiers, sel.stream);
    host.innerHTML =
      '<div class="case-art-box">' + ICON_CRATE + '</div>' +
      '<div class="case-art-name">' + escapeHtml(soloTier.label) + '</div>' +
      '<div class="case-art-price">' + G.UI.money(soloTier.cost) + '</div>' +
      '<div class="case-art-energy">-' + caseEnergyCost() + ' ENERGY PER OPEN (SOLO)</div>' +
      '<div class="case-art-stream">ON STREAM OPENS: ' + escapeHtml(streamTier.label) + '</div>';
  }

  // SPEC-V3 §11: the gold (RARE SPECIAL) row is a deliberate mystery — Data
  // publishes min:null/max:null/hidden:true for it and the real hidden
  // two-tier roll lives only in state.js's private constants. Never compute
  // or display a range for it here; render '?' and nothing else, in no
  // attribute (title/data-*) either. Shown for the SOLO-selected tier, since
  // that's what OPEN CASE on this screen actually rolls.
  function renderOdds() {
    if (!wrapEl) return;
    var host = wrapEl.querySelector('#case-odds');
    if (!host) return;
    var sel = getSelection();
    var tier = findTier(getTiers(), sel.solo);
    host.innerHTML =
      '<div class="case-odds-title h-label">DROP ODDS &mdash; ' + escapeHtml(tier.label) + '</div>' +
      oddsRowsHtml(tier);
  }

  function oddsRowsHtml(tier) {
    var entries = (tier && tier.odds && tier.odds.length) ? tier.odds : ((G.Data && G.Data.caseOdds) || []);
    return entries.map(function (o) {
      var color = 'var(' + o.colorVar + ')';
      var pct = (o.chance * 100);
      var pctStr = pct.toFixed(2);
      var isHidden = !!o.hidden || o.min == null || o.max == null;
      var rangeStr = isHidden ? '?' : (G.UI.money(o.min) + ' - ' + G.UI.money(o.max));
      return (
        '<div class="case-odds-row">' +
          '<span class="case-odds-swatch" style="background:' + color + '"></span>' +
          '<span class="case-odds-label" style="color:' + color + '">' + o.label + '</span>' +
          '<span class="case-odds-range' + (isHidden ? ' case-odds-range-hidden' : '') + '">' + rangeStr + '</span>' +
          '<span class="case-odds-pct">' + pctStr + '%</span>' +
        '</div>'
      );
    }).join('');
  }

  function openCase(wrap) {
    if (busy) return;
    // Off-stream open (SPEC-V3 §12): onStream defaults to false, which costs
    // 1 energy plus cash. State.openCase() with no options picks the tier
    // from d.caseSelection.solo (SPEC-V15 §10) — the live "open on stream"
    // path is a separate button owned by stream.js and passes
    // { onStream: true }, which reads d.caseSelection.stream instead.
    var res = G.State.openCase();
    if (!res.ok) {
      var msg = res.reason === 'energy' ? 'NOT ENOUGH ENERGY' :
        res.reason === 'dead' ? 'CAREER OVER' : 'NOT ENOUGH CASH';
      G.UI.toast(msg, 'bad');
      return;
    }
    busy = true;
    var openBtn = wrap.querySelector('.case-open-btn');
    var resultSlot = wrap.querySelector('.case-result-slot');
    var stripSlot = wrap.querySelector('.case-strip-slot');
    openBtn.disabled = true;
    resultSlot.innerHTML = '';
    G.UI.beep('click');

    var item = res.item;
    activeHandle = playRoulette(stripSlot, item, {
      tileWidth: 84,
      onDone: function () {
        activeHandle = null;
        // SPEC-V5 §3: the cost was already charged on click (State.openCase()
        // above); the value is only credited now, once the wheel has fully
        // stopped and the item is revealed. Holding this until here is the
        // whole point of the fix — it restores the reveal tension.
        if (res.pendingId) G.State.creditCaseReveal(res.pendingId);
        showReveal(wrap, res);
      }
    });
  }

  // SPEC-V5 §3: State.openCase() charges the cost up front but no longer
  // credits the pulled value — creditCaseReveal() (called on wheel-stop,
  // above) applies it to cash. No DISPLAY/SELL decision or inventory list —
  // just show what it sold for and the net vs the cost, then let the
  // player open another right away.
  function showReveal(wrap, res) {
    var resultSlot = wrap.querySelector('.case-result-slot');
    var openBtn = wrap.querySelector('.case-open-btn');
    var item = res.item;
    var isRare = item.rarity === 'covert' || item.rarity === 'rare';
    var color = rarityColor(item.rarity);
    var net = res.net;
    var netClass = net >= 0 ? 'case-net-pos' : 'case-net-neg';
    var netStr = (net >= 0 ? '+' : '−') + G.UI.money(Math.abs(net));

    G.UI.beep(isRare ? 'rare' : 'cash');
    if (isRare) {
      var anchor = document.getElementById('modal-layer') || wrap;
      if (G.UI.confetti) G.UI.confetti(anchor, color);
    }

    resultSlot.innerHTML =
      '<div class="case-reveal panel" style="border-color:' + color + '">' +
        '<div class="case-reveal-rarity" style="color:' + color + '">' + rarityLabel(item.rarity) + '</div>' +
        '<div class="case-reveal-name">' + escapeHtml(item.skin) + '</div>' +
        '<div class="case-reveal-meta">' + item.wear + '</div>' +
        '<div class="case-reveal-sold" style="color:' + color + '">SOLD &mdash; +' + G.UI.money(res.value) + '</div>' +
        '<div class="case-reveal-net ' + netClass + '">NET ' + netStr + ' vs ' + G.UI.money(res.cost) + ' COST</div>' +
      '</div>';

    busy = false;
    openBtn.disabled = false;
    openBtn.textContent = 'OPEN ANOTHER';
    wrap.querySelector('.cases-stats').textContent = statLine();
    // Cash just moved (cost spent, value credited) — every tier's
    // affordability and the odds panel's tier label can now be stale.
    renderTierList();
    renderCaseArt();
    renderOdds();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (G.Router && G.Router.register) {
    G.Router.register('cases', { onEnter: onEnter, onExit: onExit });
  }

  G.Cases = {
    caseCost: caseCost,
    tierCost: tierCost,
    rarityLabel: rarityLabel,
    rarityColor: rarityColor,
    playRoulette: playRoulette
  };
})();
