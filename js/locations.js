/* ==========================================================================
   CS2 PRO SIMULATOR — js/locations.js
   Locations screen: browse/move between the six locations, surface rent
   status. The actual packing/travel minigame lives in js/hub.js (State.
   startMove/packPropAt/movingProgress/commitMove drive it) — this screen is
   where a move is *initiated* and where you keep an eye on rent.
   SPEC-V6 §28: room expansion is DELETED — grid size is fixed per location
   (6x6 through 11x11) and is the whole progression hook now, alongside the
   stream multiplier. There is no more expansion card/UI here at all.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};

  function buildDom() {
    var root = G.Router.root('locations');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">LOCATIONS</span><button class="btn screen-header__back" id="loc-back">BACK</button></div>' +
      '<div class="locations" id="locations-list"></div>';

    els.list = document.getElementById('locations-list');
    document.getElementById('loc-back').addEventListener('click', function () {
      G.UI.beep('click');
      G.Router.back();
    });
    built = true;
  }

  // rentStatus: { text, warn } describing when rent is next due at the
  // CURRENT location. Rent now counts sleeps, not END DAY presses (SPEC-V3
  // §4) — one sleep = one day, due every 7th. Sourced from
  // State.statsSummary().career (Package F's authoritative rentDueInSleeps/
  // debtStrikes/dead figures) rather than recomputed here, so this is a pure
  // read, not a second copy of the rent schedule. The V2 "evicted at 2
  // misses" rule is gone (SPEC-V3 §5, REPLACES V2 eviction) — going into
  // debt now risks the career outright rather than a forced move.
  function rentStatus() {
    var d = G.State.data;
    var c = G.State.statsSummary().career; // debtStrikes/dead only, see note below
    if (d.locationId <= 0) return { text: 'RENT FREE', warn: false };
    // §6 — statsSummary().career.rentDueInSleeps is NOT offset-aware (it's
    // `day % 7`, ignoring d.rentDayOffset), so once a save has a non-zero
    // offset that field drifts from the day rent is actually charged on
    // (js/state.js's applyRent(), which IS offset-aware). Recompute the
    // same cadence directly from the raw fields rather than trust it.
    var offset = d.rentDayOffset || 0;
    var dayMod = ((d.day - offset) % 7 + 7) % 7;
    var rentDueInSleeps = dayMod === 0 ? 0 : 7 - dayMod;
    var text;
    if (rentDueInSleeps === 0) text = 'RENT DUE TOMORROW';
    else if (rentDueInSleeps === 1) text = 'RENT DUE IN 1 DAY';
    else text = 'RENT DUE IN ' + rentDueInSleeps + ' DAYS';
    var warn = rentDueInSleeps <= 1;
    if (c.dead) {
      text = 'CAREER OVER — WENT BROKE ON RENT';
      warn = true;
    } else if (c.debtStrikes > 0) {
      text += ' — IN DEBT (' + c.debtStrikes + '/2 STRIKES, CAREER ENDS AT 2)';
      warn = true;
    }
    return { text: text, warn: warn };
  }

  // subsPayoutStatus: SPEC-V3 §13 — subscribers pay out every
  // Data.subscriberPayoutInterval sleeps (same tick as rent, but paid
  // BEFORE it — State.applySubscriberPayout). Pure read over
  // State.statsSummary().subscribers, same pattern as rentStatus() above:
  // "N SUBS -> $X IN Y SLEEPS" so a player can see rent day is covered.
  function subsPayoutStatus() {
    var s = G.State.statsSummary().subscribers;
    var when = s.dueInSleeps === 0 ? 'TOMORROW'
      : s.dueInSleeps === 1 ? 'IN 1 DAY'
      : 'IN ' + s.dueInSleeps + ' DAYS';
    return { text: s.count + ' SUBS → ' + G.UI.money(s.nextPayout) + ' ' + when, count: s.count };
  }

  function buildMovingBanner(data) {
    var moving = data.moving;
    if (!moving) return null;
    var target = G.Data.locations[moving.targetLocationId];
    var progress = G.State.movingProgress();
    var card = document.createElement('div');
    card.className = 'loc-moving-banner panel';
    var title = document.createElement('div');
    title.className = 'loc-moving-banner__title';
    title.textContent = 'MOVE IN PROGRESS — ' + target.name;
    var desc = document.createElement('div');
    desc.className = 'loc-moving-banner__desc';
    desc.textContent = 'PACK UP ' + progress.packed + ' / ' + progress.total + ' PROPS IN THE HUB, THEN TAP MOVE OUT.';
    var btn = document.createElement('button');
    btn.className = 'btn btn--primary';
    btn.textContent = 'RESUME PACKING';
    btn.addEventListener('click', function () {
      G.UI.beep('click');
      G.Router.go('hub');
    });
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(btn);
    return card;
  }

  // §28 — CURRENT LOCATION summary card. Room expansion is gone, so what
  // used to be the "ROOM EXPANSION" card is now just rent/subs status plus
  // this location's fixed grid + stream multiplier — the two axes the
  // location list below lets you progress along.
  function buildCurrentStatusCard(data) {
    var loc = G.State.currentLocation();
    var grid = G.State.currentGrid();

    var card = document.createElement('div');
    card.className = 'loc-expand panel';

    var title = document.createElement('div');
    title.className = 'loc-expand__title';
    title.textContent = 'CURRENT HOME — ' + loc.name;
    card.appendChild(title);

    var rs = rentStatus();
    var rentRow = document.createElement('div');
    rentRow.className = 'loc-expand__rent' + (rs.warn ? ' loc-expand__rent--warn' : '');
    rentRow.textContent = rs.text;
    card.appendChild(rentRow);

    var ss = subsPayoutStatus();
    var subsRow = document.createElement('div');
    subsRow.className = 'loc-expand__subs';
    subsRow.textContent = ss.text;
    card.appendChild(subsRow);

    var row = document.createElement('div');
    row.className = 'loc-expand__row';
    var gridSpan = document.createElement('span');
    gridSpan.className = 'loc-expand__grid loc-expand__grid--after';
    gridSpan.textContent = grid.w + 'x' + grid.d;
    row.appendChild(gridSpan);
    card.appendChild(row);

    var meta = document.createElement('div');
    meta.className = 'loc-expand__meta';
    meta.textContent = 'STREAM MULT x' + loc.streamMult.toFixed(2) + ' — MOVE TO A BIGGER PLACE BELOW TO GROW EITHER';
    card.appendChild(meta);

    return card;
  }

  function buildLocationCard(loc, data, currentLoc) {
    var isCurrent = data.locationId === loc.id;
    var card = document.createElement('div');
    card.className = 'loc-card panel' + (isCurrent ? ' loc-card--current' : '');

    var head = document.createElement('div');
    head.className = 'loc-card__head';
    var name = document.createElement('div');
    name.className = 'loc-card__name';
    name.textContent = loc.name;
    head.appendChild(name);
    if (isCurrent) {
      var tag = document.createElement('span');
      tag.className = 'loc-card__tag';
      tag.textContent = 'CURRENT';
      head.appendChild(tag);
    }
    card.appendChild(head);

    var stats = document.createElement('div');
    stats.className = 'loc-card__stats';
    stats.innerHTML =
      '<span class="loc-stat">GRID <b>' + loc.gridW + 'x' + loc.gridD + '</b></span>' +
      '<span class="loc-stat">MOVE-IN <b>' + (loc.moveInCost ? G.UI.money(loc.moveInCost) : 'FREE') + '</b></span>' +
      '<span class="loc-stat">RENT/7D <b>' + (loc.rent ? G.UI.money(loc.rent) : 'FREE') + '</b></span>' +
      '<span class="loc-stat loc-stat--mult">STREAM <b>x' + loc.streamMult.toFixed(2) + '</b></span>';
    card.appendChild(stats);

    // §28 — grid size + stream multiplier are the whole progression hook
    // now that expansion is gone, so spell out the step-up over your
    // CURRENT location on every card that's actually a step up.
    if (!isCurrent && currentLoc && (loc.gridW > currentLoc.gridW || loc.streamMult > currentLoc.streamMult)) {
      var step = document.createElement('div');
      step.className = 'loc-card__stepup';
      step.textContent = '+' + (loc.gridW - currentLoc.gridW) + ' TILES/SIDE  ·  +' +
        (loc.streamMult - currentLoc.streamMult).toFixed(2) + 'x STREAM OVER YOUR CURRENT PLACE';
      card.appendChild(step);
    }

    if (isCurrent) {
      var rs = rentStatus();
      var rentEl = document.createElement('div');
      rentEl.className = 'loc-card__rentstatus' + (rs.warn ? ' loc-card__rentstatus--warn' : '');
      rentEl.textContent = rs.text;
      card.appendChild(rentEl);

      var ss = subsPayoutStatus();
      var subsEl = document.createElement('div');
      subsEl.className = 'loc-card__subsstatus';
      subsEl.textContent = ss.text;
      card.appendChild(subsEl);
    } else {
      var cannotAfford = data.cash < loc.moveInCost;
      var alreadyMoving = !!data.moving;
      var btn = document.createElement('button');
      btn.className = 'btn btn--primary loc-card__movebtn';
      btn.textContent = 'MOVE HERE — ' + G.UI.money(loc.moveInCost);
      window.Game.UI.setDisabled(btn, cannotAfford || alreadyMoving);
      btn.addEventListener('click', function () {
        if (alreadyMoving) {
          G.UI.beep('miss');
          G.UI.toast('FINISH YOUR CURRENT MOVE FIRST', 'bad');
          return;
        }
        if (cannotAfford) {
          G.UI.beep('miss');
          G.UI.toast('NOT ENOUGH CASH', 'bad');
          return;
        }
        G.UI.confirmModal({
          title: 'MOVE TO ' + loc.name + '?',
          text: 'Pay the move-in cost now, then pack up every prop in your current room before you can move out.',
          color: 'var(--cash)',
          lines: [
            { label: 'MOVE-IN COST', value: G.UI.money(loc.moveInCost), color: 'var(--cash)' },
            { label: 'NEW GRID', value: loc.gridW + 'x' + loc.gridD, color: 'var(--views)' },
            { label: 'STREAM MULT', value: 'x' + loc.streamMult.toFixed(2), color: 'var(--subs)' }
          ],
          yesText: 'PAY & START PACKING',
          noText: 'NOT YET',
          onYes: function () {
            var res = G.State.startMove(loc.id);
            if (res.ok) {
              G.UI.beep('cash');
              G.UI.toast('PACK UP EVERY PROP IN THE HUB TO MOVE OUT', 'good');
              G.Router.go('hub');
            } else {
              G.UI.beep('miss');
              G.UI.toast('CANNOT START MOVE', 'bad');
            }
          }
        });
      });
      card.appendChild(btn);
    }
    return card;
  }

  function render() {
    var data = G.State.data;
    els.list.innerHTML = '';

    var banner = buildMovingBanner(data);
    if (banner) els.list.appendChild(banner);

    els.list.appendChild(buildCurrentStatusCard(data));

    var header = document.createElement('div');
    header.className = 'locations__section-header';
    header.textContent = 'ALL LOCATIONS';
    els.list.appendChild(header);

    // §28 — all six locations, id order IS the progression order (each is
    // exactly one grid size up from the last): PARENTS' BASEMENT (6x6) ->
    // CITY CENTRE APARTMENT (7x7) -> BEACH VILLA (8x8) -> ESPORTS MANSION
    // (9x9) -> PENTHOUSE SUITE (10x10) -> PRIVATE ISLAND COMPOUND (11x11).
    var currentLoc = G.State.currentLocation();
    G.Data.locations.forEach(function (loc) {
      els.list.appendChild(buildLocationCard(loc, data, currentLoc));
    });
  }

  G.Router = G.Router || {};
  G.Router.register('locations', {
    onEnter: function () {
      if (!built) buildDom();
      render();
    },
    onExit: function () {}
  });

  G.Locations = { ready: true };
})(window.Game = window.Game || {});
