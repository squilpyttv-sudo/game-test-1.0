/* ==========================================================================
   CS2 PRO SIMULATOR — js/stats.js
   Game.Stats — the STATS screen (SPEC-V3 §7): every buff with its current
   numeric effect, plus career and lifetime figures. A PURE RENDERER over
   Game.State.statsSummary() — no economy math happens here.

   Also owns the two SPEC-V3 §5 fail-state presentations (Package F computes
   the rules, guards every mutating action, and sets `debtStrikes`/`dead` —
   this file just watches for the transition and shows the UI for it):
     - the first debt strike: a full-screen, unmissable warning overlay.
     - the second (career-ending) strike: a full-screen GAME OVER card with
       final stats, leading back to the title screen.

   Public API (consumed by js/title.js for its read-only "VIEW STATS" view
   on a dead save):
     Game.Stats.renderInto(container, summary) — builds the three stat
       groups (room buffs / career / lifetime) from a Game.State.statsSummary()
       shaped object into `container`. Stateless, side-effect free.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};
  var refreshTimer = null;

  /* ---- tiny DOM helper (mirrors js/title.js's) ---------------------------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function fmtPlaytime(ms) {
    ms = ms || 0;
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) return h + 'H ' + m + 'M';
    return m + 'M';
  }

  /* ==========================================================================
     ROOM BUFFS — every buff's current numeric effect comes straight from
     State.statsSummary().buffs; the "which props contribute" breakdown below
     is purely presentational bookkeeping over already-known catalog values
     (State.data.owned + State.findShopItem(id).stats), never a recomputation
     of the buff's actual magnitude.
     ========================================================================== */
  var BUFF_META = [
    { key: 'aim',           name: 'AIM BONUS' },
    { key: 'streamMult',    name: 'STREAM MULTIPLIER' },
    { key: 'subConversion', name: 'SUB CONVERSION' },
    { key: 'prestige',      name: 'PRESTIGE' },
    { key: 'luck',          name: 'LUCK' },
    { key: 'sleepRate',     name: 'SLEEP RATE' },
    { key: 'energyRegen',   name: 'ENERGY REGEN' },
    { key: 'energyMax',     name: 'MAX ENERGY' }
  ];

  // buff key -> the raw gearBonus()/shop-item `stats` field it's sourced from.
  // 'income' (SPEC-V3 §13): no longer idle income (removed) — repurposed into
  // subConversion, the subscriber-conversion-rate buff, so the stat is never
  // orphaned (§7).
  var GEAR_STAT_KEY = { aim: 'aim', streamMult: 'stream', subConversion: 'income', prestige: 'prestige', luck: 'luck' };

  function contributorsFor(buffKey, statKey) {
    var data = G.State.data;
    var list = [];
    var owned = data.owned || {};
    for (var id in owned) {
      var qty = owned[id];
      if (!qty) continue;
      var def = G.State.findShopItem(id);
      if (!def || !def.stats || !def.stats[statKey]) continue;
      list.push({ name: def.name, qty: qty, total: def.stats[statKey] * qty });
    }
    // the display case's flat +3 prestige/item (State.gearBonus()) is a
    // synthetic contributor, not a shop item — surfaced the same way.
    if (buffKey === 'prestige' && data.displayCase && data.displayCase.items && data.displayCase.items.length) {
      var n = data.displayCase.items.length;
      list.push({ name: 'DISPLAY CASE ITEMS', qty: n, total: n * 3 });
    }
    list.sort(function (a, b) { return b.total - a.total; });
    return list;
  }

  function energyMaxContributors() {
    var data = G.State.data;
    var list = [];
    var items = G.Data.shopItems;
    for (var i = 0; i < items.length; i++) {
      var def = items[i];
      if (def.category === 'energy' && (data.owned[def.id] || 0) > 0) {
        list.push({ name: def.name, total: def.energyAdd });
      }
    }
    return list;
  }

  // Formats one contributor's raw per-item total in the SAME units
  // State.statsSummary() uses for that buff's headline value (matches the
  // exact transforms in State.statsSummary(): streamMult/luck are *100,
  // prestige is *2, subConversion is *(subscriberConversionPerPoint*100)
  // (SPEC-V3 §13), aim is shown raw).
  function fmtContribValue(buffKey, raw) {
    if (buffKey === 'aim') return '+' + Math.round(raw) + ' ELO';
    if (buffKey === 'subConversion') return '+' + Math.round(raw * (G.Data.subscriberConversionPerPoint * 100)) + '%';
    if (buffKey === 'streamMult') return '+' + Math.round(raw * 100) + '%';
    if (buffKey === 'luck') return '+' + (raw * 100).toFixed(1) + '%';
    if (buffKey === 'prestige') return '+' + Math.round(raw * 2) + '%';
    return '+' + raw;
  }

  function buildSourceText(key) {
    if (GEAR_STAT_KEY[key]) {
      var list = contributorsFor(key, GEAR_STAT_KEY[key]);
      if (!list.length) return { text: 'NOTHING EQUIPPED YET', empty: true };
      return {
        text: 'FROM: ' + list.map(function (c) {
          return c.name + (c.qty > 1 ? ' x' + c.qty : '') + ' (' + fmtContribValue(key, c.total) + ')';
        }).join(',  '),
        empty: false
      };
    }
    if (key === 'sleepRate') {
      var bed = G.State.currentBed();
      return { text: 'FROM: ' + (bed ? bed.name : 'FLOOR MATTRESS') + ' (the bed placed in your room)', empty: false };
    }
    if (key === 'energyRegen') {
      var phase = G.State.dayPhase().phase;
      return {
        text: '1.0/SEC BY DAY, 0/SEC AT NIGHT — CURRENTLY ' + phase.toUpperCase() + '. ONLY SLEEPING RESTORES ENERGY AT NIGHT.',
        empty: false
      };
    }
    if (key === 'energyMax') {
      var list2 = energyMaxContributors();
      var base = 'BASE ' + (G.Data.energyMax || 100);
      if (!list2.length) return { text: base + ' — NO UPGRADES OWNED YET', empty: false };
      return {
        text: base + ' + ' + list2.map(function (c) { return c.name + ' (+' + c.total + ')'; }).join(',  '),
        empty: false
      };
    }
    return { text: '', empty: true };
  }

  function buildBuffRow(key, name, buff) {
    var row = el('div', 'stats-buff panel');
    var head = el('div', 'stats-buff__head');
    head.appendChild(el('span', 'stats-buff__name', name));
    head.appendChild(el('span', 'stats-buff__value', buff.label));
    row.appendChild(head);
    var src = buildSourceText(key);
    row.appendChild(el('div', 'stats-buff__source' + (src.empty ? ' stats-buff__source--empty' : ''), src.text));
    return row;
  }

  function buildBuffsSection(summary) {
    var sec = el('div', 'stats__section');
    sec.appendChild(el('div', 'stats__section-title', 'ROOM BUFFS'));
    sec.appendChild(el('div', 'stats__section-hint', 'WHAT YOUR ROOM SETUP IS ACTUALLY DOING FOR YOU'));
    BUFF_META.forEach(function (m) {
      var buff = summary.buffs[m.key];
      if (!buff) return;
      sec.appendChild(buildBuffRow(m.key, m.name, buff));
    });
    return sec;
  }

  /* ==========================================================================
     CAREER / LIFETIME — flat key-value read-outs of statsSummary(); no math.
     ========================================================================== */
  function kvRow(label, value, tone) {
    var row = el('div', 'stats-kv');
    row.appendChild(el('span', 'stats-kv__label', label));
    row.appendChild(el('span', 'stats-kv__value' + (tone ? ' stats-kv__value--' + tone : ''), String(value)));
    return row;
  }

  function buildCareerSection(summary) {
    var c = summary.career;
    var sec = el('div', 'stats__section');
    sec.appendChild(el('div', 'stats__section-title', 'CAREER'));

    if (c.dead) {
      var deadBanner = el('div', 'stats-deadbanner panel');
      deadBanner.appendChild(el('div', 'stats-deadbanner__title', 'CAREER LOST'));
      if (c.deadReason) deadBanner.appendChild(el('div', 'stats-deadbanner__reason', c.deadReason));
      sec.appendChild(deadBanner);
    } else if (c.debtStrikes > 0) {
      var warnBanner = el('div', 'stats-deadbanner panel');
      warnBanner.appendChild(el('div', 'stats-deadbanner__title', 'IN DEBT — ' + c.debtStrikes + '/2 STRIKES'));
      warnBanner.appendChild(el('div', 'stats-deadbanner__reason', 'MISS RENT AGAIN AND YOUR CAREER IS OVER.'));
      sec.appendChild(warnBanner);
    }

    var grid = el('div', 'stats-kv-grid');

    var rankRow = el('div', 'stats-kv');
    rankRow.appendChild(el('span', 'stats-kv__label', 'RANK'));
    var rankChip = el('span', 'rank-chip', c.rank);
    rankChip.style.background = c.rankColor;
    rankChip.style.color = '#0b0f24';
    rankRow.appendChild(rankChip);
    grid.appendChild(rankRow);

    grid.appendChild(kvRow('ELO', Math.round(c.elo)));
    grid.appendChild(kvRow('CONTRACT', (G.Data.contracts[c.contract] || {}).name || c.contract));
    grid.appendChild(kvRow('SALARY', c.salary > 0 ? (G.UI.money(c.salary) + ' /MO') : 'NONE (FREE AGENT)'));
    grid.appendChild(kvRow('CHEMISTRY', Math.round(c.chemistry) + '%'));
    grid.appendChild(kvRow('SCOUT HYPE', Math.round(c.scoutHype) + '%'));
    grid.appendChild(kvRow('DAY', c.day));
    grid.appendChild(kvRow('LOCATION', c.location));
    grid.appendChild(kvRow('GRID SIZE', c.gridSize));

    var rentText, rentWarn = false;
    if (c.rentDueInSleeps === null) {
      rentText = 'RENT FREE';
    } else if (c.rentDueInSleeps === 0) {
      rentText = 'DUE TOMORROW';
      rentWarn = true;
    } else {
      rentText = 'IN ' + c.rentDueInSleeps + ' DAY' + (c.rentDueInSleeps === 1 ? '' : 'S');
      rentWarn = c.rentDueInSleeps === 1;
    }
    grid.appendChild(kvRow('RENT DUE', rentText, rentWarn ? 'warn' : null));

    sec.appendChild(grid);
    return sec;
  }

  function buildLifetimeSection(summary) {
    var l = summary.lifetime;
    var sec = el('div', 'stats__section');
    sec.appendChild(el('div', 'stats__section-title', 'LIFETIME'));
    var grid = el('div', 'stats-kv-grid');
    grid.appendChild(kvRow('MATCHES', l.matches));
    grid.appendChild(kvRow('WINS', l.wins));
    grid.appendChild(kvRow('WIN RATE', (l.winRate * 100).toFixed(1) + '%'));
    grid.appendChild(kvRow('STREAMS', l.streams));
    grid.appendChild(kvRow('CASES OPENED', l.casesOpened));
    grid.appendChild(kvRow('BEST PULL', G.UI.money(l.bestPull)));
    grid.appendChild(kvRow('PLAYTIME', fmtPlaytime(l.playtimeMs)));
    sec.appendChild(grid);
    return sec;
  }

  // Public: pure renderer, reused by js/title.js's read-only dead-slot view
  // and by this file's own GAME OVER card.
  function renderInto(container, summary) {
    container.innerHTML = '';
    container.appendChild(buildBuffsSection(summary));
    container.appendChild(buildCareerSection(summary));
    container.appendChild(buildLifetimeSection(summary));
  }

  /* ==========================================================================
     THE STATS SCREEN (live game) — registered on Game.Router.
     ========================================================================== */
  function buildDom() {
    var root = G.Router.root('stats');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">STATS</span><button class="btn screen-header__back" id="stats-back">BACK</button></div>' +
      '<div class="stats" id="stats-body"></div>';
    els.body = document.getElementById('stats-body');
    document.getElementById('stats-back').addEventListener('click', function () {
      G.UI.beep('click');
      G.Router.back();
    });
    built = true;
  }

  function renderScreen() {
    if (!G.State.data) return;
    G.State.tickEnergy(); // reconcile real-time energy so the numbers shown are fresh (SPEC-V3 §1)
    renderInto(els.body, G.State.statsSummary());
  }

  G.Router = G.Router || {};
  G.Router.register('stats', {
    onEnter: function () {
      if (!built) buildDom();
      renderScreen();
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(renderScreen, 2000);
    },
    onExit: function () {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }
  });

  /* ==========================================================================
     FAIL-STATE OVERLAYS (SPEC-V3 §5) — a full-screen warning on the first
     debt strike, and a full-screen GAME OVER card on the second (career-
     ending) strike. Package F already guards every mutating action on a dead
     save and persists dead/deadReason/debtStrikes; this is purely a watcher
     that reacts to the transition, wherever in the app it happens (it can
     fire from inside State.tickEnergy()'s auto-wake path just as easily as
     from an explicit State.wake()), via State's permanent 'change' event —
     no changes to any other package's files required. ------------------- */
  function showFailOverlay(builder, cls) {
    var appRoot = document.getElementById('app') || document.body;
    var back = el('div', 'fail-overlay' + (cls ? ' ' + cls : ''));
    var card = el('div', 'fail-overlay__card panel');
    builder(card);
    back.appendChild(card);
    appRoot.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('fail-overlay--in'); });
    return back;
  }

  function showDebtWarning() {
    showFailOverlay(function (card) {
      card.appendChild(el('div', 'fail-overlay__title', 'YOU ARE IN DEBT'));
      card.appendChild(el('div', 'fail-overlay__warntext', 'MISS RENT AGAIN AND YOUR CAREER IS OVER.'));
      card.appendChild(el('div', 'fail-overlay__subtitle', 'Climb back above $0 before your next rent payment to stay in the game.'));
      var btn = el('button', 'btn btn--danger fail-overlay__btn', 'I UNDERSTAND');
      btn.addEventListener('click', function () {
        G.UI.beep('click');
        var overlay = card.parentNode;
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      });
      card.appendChild(btn);
    }, 'fail-overlay--warn');
    G.UI.beep('miss');
  }

  function showGameOverCard() {
    var summary = G.State.statsSummary();
    showFailOverlay(function (card) {
      card.appendChild(el('div', 'fail-overlay__title', 'GAME OVER'));
      card.appendChild(el('div', 'fail-overlay__subtitle', summary.career.deadReason || 'Your career has ended — you went broke.'));
      var statsBody = el('div', 'fail-overlay__stats');
      renderInto(statsBody, summary);
      card.appendChild(statsBody);
      var btn = el('button', 'btn btn--primary fail-overlay__btn', 'RETURN TO TITLE');
      btn.addEventListener('click', function () {
        G.UI.beep('click');
        // The dead state is already persisted (State's rent handling saves
        // before this overlay ever appears). js/main.js owns the real
        // "enter game" wiring (topbar refresh + playtime-tracking closures
        // aren't exposed to other packages), so a reload is the safe, always-
        // correct way back to a clean title-screen boot.
        window.location.reload();
      });
      card.appendChild(btn);
    }, 'fail-overlay--dead');
    G.UI.beep('ban');
  }

  var watch = { ref: null, debtStrikes: 0, dead: false };
  function onStateChange(d) {
    if (!d) return;
    if (watch.ref !== d) {
      // A different save just became State.data (fresh load/create/reset,
      // or js/title.js peeking at a dead slot for VIEW STATS) — resync the
      // baseline silently. This is what stops a merely-loaded dead save from
      // popping the GAME OVER card; it only fires on a live TRANSITION.
      watch.ref = d;
      watch.debtStrikes = d.debtStrikes || 0;
      watch.dead = !!d.dead;
      return;
    }
    if (!watch.dead && d.dead) {
      watch.dead = true;
      showGameOverCard();
      return;
    }
    var ds = d.debtStrikes || 0;
    if (!d.dead && ds > watch.debtStrikes && ds === 1) {
      showDebtWarning();
    }
    watch.debtStrikes = ds;
  }
  if (G.State && typeof G.State.on === 'function') {
    G.State.on('change', onStateChange);
  }

  G.Stats = {
    ready: true,
    renderInto: renderInto
  };
})(window.Game = window.Game || {});
