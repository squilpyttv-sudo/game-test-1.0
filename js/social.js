/* ==========================================================================
   CS2 PRO SIMULATOR — js/social.js
   The SOCIAL screen (SPEC-V9 Package B2): CLIPS/LONGFORM/MICROBLOG posting,
   the multi-day follower drip, weekly ad revenue, and the hired manager.
   Pure renderer over State.postContent()/State.socialStatus() — every rule
   (unlocks, drip math, virality roll, ad revenue) already lives in
   js/state.js (Package B1); this file's only job is to make posting read as
   a real choice against the day's energy budget, and to make the drip
   visible so a post reads as an investment, not an instant payout.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};
  var tickTimer = null;

  var PLATFORM_COLOR = { clips: 'var(--views)', longform: 'var(--subs)', microblog: 'var(--gold)' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function buildDom() {
    var root = G.Router.root('social');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">SOCIAL</span><button class="btn screen-header__back" id="social-back">BACK</button></div>' +
      '<div class="social">' +
        '<div class="panel social__summary" id="social-summary"></div>' +
        '<div class="social__platform-list" id="social-platforms"></div>' +
        '<div class="panel social__manager" id="social-manager"></div>' +
      '</div>';

    els.summary = document.getElementById('social-summary');
    els.platforms = document.getElementById('social-platforms');
    els.manager = document.getElementById('social-manager');

    document.getElementById('social-back').addEventListener('click', function () {
      G.UI.beep('click');
      // SPEC-V14 §4.3 — SOCIAL is a phone app now: BACK returns to the hub
      // with the phone open, not to CAREER (the old destination before the
      // phone existed). Same wrong-back-target bug this project has fixed
      // three times already (teams.js, tournaments.js, social.js) — go
      // straight to the correct target rather than Router.back().
      G.Router.go('hub');
      if (G.Phone && G.Phone.open) G.Phone.open();
    });
    built = true;
  }

  function fmtFollowers(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function buildPlatformCard(p, energy) {
    var card = el('div', 'panel social-card' + (p.unlocked ? '' : ' social-card--locked'));
    card.style.setProperty('--social-accent', PLATFORM_COLOR[p.id] || 'var(--views)');

    var head = el('div', 'social-card__head');
    head.appendChild(el('div', 'social-card__name', p.name));
    if (p.unlocked) {
      head.appendChild(el('div', 'social-card__followers', fmtFollowers(p.followers) + ' FOLLOWERS'));
    } else {
      head.appendChild(el('div', 'social-card__followers social-card__followers--locked', 'LOCKED'));
    }
    card.appendChild(head);

    if (!p.unlocked) {
      var need = Math.max(0, p.unlockFollowers - totalFollowersCache);
      var pct = p.unlockFollowers > 0 ? Math.max(0, Math.min(100, (totalFollowersCache / p.unlockFollowers) * 100)) : 100;
      card.appendChild(el('div', 'social-card__unlock-text',
        'UNLOCKS AT ' + fmtFollowers(p.unlockFollowers) + ' TOTAL FOLLOWERS'));
      var meter = el('div', 'meter social-card__meter');
      var fill = el('div', 'meter__fill meter__fill--views');
      fill.style.width = pct + '%';
      meter.appendChild(fill);
      card.appendChild(meter);
      card.appendChild(el('div', 'social-card__unlock-sub',
        fmtFollowers(totalFollowersCache) + ' / ' + fmtFollowers(p.unlockFollowers) +
        (need > 0 ? '  ·  ' + fmtFollowers(need) + ' TO GO' : '')));
      return card;
    }

    var statsRow = el('div', 'social-card__stats');
    var costChip = el('span', 'stat-chip', 'COST -' + p.energyCost + ' ENERGY');
    costChip.style.color = 'var(--energy)';
    statsRow.appendChild(costChip);
    var weekChip = el('span', 'stat-chip', p.postsThisWeek + ' POST' + (p.postsThisWeek === 1 ? '' : 'S') + ' THIS WEEK');
    weekChip.style.color = 'var(--ink-dim)';
    statsRow.appendChild(weekChip);
    card.appendChild(statsRow);

    // §5 — the heart of the design: make the drip visible so posting reads
    // as an investment, not an instant payout. pendingDrip is the sum of
    // every not-yet-paid slice across every open post on this platform.
    if (p.pendingDrip > 0) {
      var drip = el('div', 'social-card__drip');
      drip.appendChild(el('span', 'social-card__drip-icon', '~'));
      drip.appendChild(el('span', 'social-card__drip-text',
        '+' + fmtFollowers(p.pendingDrip) + ' FOLLOWERS STILL INCOMING — arriving over the next few days'));
      card.appendChild(drip);
    }

    var canAfford = energy >= p.energyCost;
    var postBtn = el('button', 'btn btn--primary social-card__postbtn',
      'POST' + (canAfford ? '' : ' (NOT ENOUGH ENERGY)'));
    window.Game.UI.setDisabled(postBtn, !canAfford);
    postBtn.addEventListener('click', function () { onPost(p.id, card); });
    card.appendChild(postBtn);

    return card;
  }

  var totalFollowersCache = 0;

  function onPost(platformId, cardEl) {
    var res = G.State.postContent(platformId);
    if (!res.ok) {
      G.UI.beep('miss');
      var msg = res.reason === 'energy' ? 'NOT ENOUGH ENERGY' :
        res.reason === 'locked' ? 'PLATFORM LOCKED' : 'COULD NOT POST';
      G.UI.toast(msg, 'bad');
      return;
    }

    if (res.viral) {
      // §11 — the rare on-stream case pull is the reference for how a viral
      // moment should feel: the 'rare' sfx (a 3-note chord sweep, see
      // js/ui.js), a burst of confetti anchored on the card that was
      // clicked, and its own reward-card modal rather than a plain toast.
      G.UI.beep('rare');
      G.UI.confetti(cardEl, PLATFORM_COLOR[res.platform] || 'var(--gold)');
      G.UI.rewardCard({
        title: 'POST WENT VIRAL!',
        subtitle: (G.Data.socialPlatforms.filter(function (d) { return d.id === res.platform; })[0] || {}).name || res.platform,
        color: PLATFORM_COLOR[res.platform] || 'var(--gold)',
        lines: [
          { label: 'TOTAL GAIN', value: '+' + fmtFollowers(res.totalGain) + ' FOLLOWERS', color: 'var(--cash)' },
          { label: 'ARRIVING OVER', value: res.dripDays + ' DAYS' },
          { label: 'ENERGY SPENT', value: '-' + res.energyCost }
        ],
        buttonText: 'LET\'S GO'
      });
    } else {
      G.UI.beep('hit');
      G.UI.toast('POSTED — +' + fmtFollowers(res.totalGain) + ' FOLLOWERS OVER ' + res.dripDays + ' DAYS', 'good');
    }
    render();
  }

  function renderSummary(status) {
    els.summary.innerHTML = '';
    var head = el('div', 'social-summary__head');
    head.appendChild(el('div', 'social-summary__total', fmtFollowers(status.totalFollowers) + ' TOTAL FOLLOWERS'));
    els.summary.appendChild(head);

    var revRow = el('div', 'social-summary__row');
    revRow.appendChild(el('span', 'h-label', 'WEEKLY AD REVENUE'));
    var revVal = el('span', 'social-summary__val social-summary__val--cash',
      G.UI.money(status.projectedWeeklyAdRevenue) + ' / WK');
    revRow.appendChild(revVal);
    els.summary.appendChild(revRow);

    var payoutRow = el('div', 'social-summary__row');
    payoutRow.appendChild(el('span', 'h-label', 'NEXT PAYOUT'));
    payoutRow.appendChild(el('span', 'social-summary__val',
      status.daysUntilAdPayout === 0 ? 'TONIGHT' : 'IN ' + status.daysUntilAdPayout + ' DAY' + (status.daysUntilAdPayout === 1 ? '' : 'S')));
    els.summary.appendChild(payoutRow);

    els.summary.appendChild(el('div', 'social-summary__note',
      'AD REVENUE RIDES THE SAME WEEKLY TICK AS YOUR SUBSCRIBER PAYOUT.'));
  }

  function renderManager(status) {
    els.manager.innerHTML = '';
    els.manager.appendChild(el('div', 'social-manager__title', 'SOCIAL MANAGER'));
    if (!status.manager) {
      els.manager.appendChild(el('div', 'social-manager__empty',
        'NO MANAGER HIRED — every post costs you energy. Hire one from the SHOP to get free auto-posts.'));
      var hireBtn = el('button', 'btn social-manager__gobtn', 'GO TO SHOP');
      hireBtn.addEventListener('click', function () {
        G.UI.beep('click');
        G.Router.go('shop');
      });
      els.manager.appendChild(hireBtn);
      return;
    }
    var m = status.manager;
    els.manager.appendChild(el('div', 'social-manager__name', m.name));
    var row = el('div', 'social-manager__stats');
    // postsPerDay — see the comment in js/shop.js's staff card. `m` here is
    // state.js's hiredManager() payload, which exposes postsPerDay; the old
    // postsPerWeek field was deleted from data.js in SPEC-V15 §5.
    row.appendChild(el('span', 'stat-chip', 'AUTO-POSTS ' + m.postsPerDay + '/DAY TO CLIPS'));
    row.appendChild(el('span', 'stat-chip', 'QUALITY ' + Math.round(m.quality * 100) + '%'));
    var upkeepChip = el('span', 'stat-chip', 'UPKEEP ' + G.UI.money(m.upkeep) + '/DAY');
    upkeepChip.style.color = 'var(--danger)';
    row.appendChild(upkeepChip);
    els.manager.appendChild(row);
    els.manager.appendChild(el('div', 'social-manager__note',
      m.name + '\'S AUTO-POSTS COST YOU ZERO ENERGY — that\'s exactly what the upkeep buys.'));
  }

  function render() {
    var data = G.State.data;
    if (!data || typeof G.State.socialStatus !== 'function') return;
    var status = G.State.socialStatus();
    totalFollowersCache = status.totalFollowers;

    renderSummary(status);

    els.platforms.innerHTML = '';
    status.platforms.forEach(function (p) {
      els.platforms.appendChild(buildPlatformCard(p, data.energy));
    });

    renderManager(status);
  }

  var lastEnergyPaint = -1;
  function tick() {
    var data = G.State.data;
    if (!data) return;
    // Re-paint POST-button affordability (and pendingDrip/postsThisWeek, in
    // case energy auto-ticked a new day mid-visit) as energy drains through
    // the day — same 1s-interval pattern career.js's scrim-quota ticker
    // uses. Only re-render when the rounded energy value actually changed,
    // to avoid needless DOM churn; the platform list is small (<=3 cards)
    // so a full render() here is cheap.
    var rounded = Math.round(data.energy);
    if (rounded === lastEnergyPaint) return;
    lastEnergyPaint = rounded;
    render();
  }

  window.Game = window.Game || {};
  window.Game.Router = window.Game.Router || {};
  window.Game.Router.register('social', {
    onEnter: function () {
      if (!built) buildDom();
      render();
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(tick, 1000);
    },
    onExit: function () {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }
  });

  window.Game.Social = { ready: true };
})(window.Game = window.Game || {});
