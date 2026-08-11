/* ==========================================================================
   CS2 PRO SIMULATOR — js/sponsors.js
   Game.Sponsors — the SPONSORS app screen (SPEC-V14 §4.2). Extracted
   wholesale out of js/career.js (SPEC-V8 A2), where it used to live as a
   panel rather than its own screen. This is a RELOCATION, not a redesign:
   behaviour, copy and every V8 state (atRisk/warned/miss-this-week) survive
   unchanged. Pure renderer over State.sponsorsStatus()/sponsorOffers() —
   every rule (progress, warn/drop, payout, the 3-slot cap) already lives in
   js/state.js; this file only has to make the tradeoff LEGIBLE: the coach
   wants scrims, the sponsor wants stream time / match wins, and the daily
   energy budget can't do both.

   No interval here — unlike the scrim quota (which the coach fills
   continuously off wakeElapsedMs with no 'change' event), sponsor progress
   only moves on discrete events (stream ends, match won, a new day ticks)
   and this screen re-renders on entry, which is enough to stay current.

   BACK returns to the phone home screen (SPEC-V14 §4.3), not to CAREER —
   sponsors are a phone app now.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var OBLIGATION_LABEL = {
    stream_days: function (o) { return 'GO LIVE ' + o.amount + ' DAY' + (o.amount === 1 ? '' : 'S') + ' THIS WEEK'; },
    // SECONDS — the `stream_minutes` id is a legacy save key, not a unit. See
    // Data.sponsorObligationTypes in js/data.js for why it kept the old name.
    stream_minutes: function (o) { return 'STREAM ' + o.amount + ' SECONDS THIS WEEK'; },
    match_wins: function (o) { return 'WIN ' + o.amount + ' OFFICIAL MATCH' + (o.amount === 1 ? '' : 'ES') + ' THIS WEEK'; },
    // SPEC-V9 B1's 4th obligation type — progress advances on every social
    // post (js/social.js), player-made or manager auto-post alike.
    content_posts: function (o) { return 'PUBLISH ' + o.amount + ' SOCIAL POST' + (o.amount === 1 ? '' : 'S') + ' THIS WEEK'; }
  };
  // What advances each obligation type, spelled out so the scrim-vs-stream
  // conflict is explicit right on the card, not something the player has to
  // infer or forget.
  var OBLIGATION_HINT = {
    stream_days: 'ADVANCED BY STREAMING — NOT BY SCRIMMING.',
    stream_minutes: 'ADVANCED BY STREAM TIME — NOT BY SCRIMMING.',
    match_wins: 'ADVANCED BY WINNING OFFICIAL MATCHES.',
    content_posts: 'ADVANCED BY ANY SOCIAL POST — YOURS OR YOUR MANAGER\'S AUTO-POSTS.'
  };
  function obligationLabel(o) {
    var fn = OBLIGATION_LABEL[o.type];
    if (fn) return fn(o);
    return 'MEET THE ' + o.type.toUpperCase().replace(/_/g, ' ') + ' TARGET (' + o.amount + ')';
  }
  function obligationHint(o) {
    return OBLIGATION_HINT[o.type] || '';
  }

  function buildHeldSponsorCard(s) {
    var atRisk = !!s.atRisk;
    var card = el('div', 'panel sponsor-card' + (atRisk ? ' sponsor-card--risk' : ''));
    card.style.setProperty('--sponsor-accent', atRisk ? 'var(--danger)' : 'var(--cash)');

    var head = el('div', 'sponsor-card__head');
    head.appendChild(el('div', 'sponsor-card__name', s.name));
    head.appendChild(el('div', 'sponsor-card__pay', G.UI.money(s.pay) + ' / WK'));
    card.appendChild(head);

    // Prominent, not a footnote: warned/at-risk state gets its own colored
    // banner above the obligation line, not just a tint on the progress bar.
    if (s.warned) {
      card.appendChild(el('div', 'sponsor-card__flag sponsor-card__flag--warned',
        'WARNED — ONE MORE MISSED WEEK DROPS THIS SPONSOR (-10 REPUTATION)'));
    } else if (atRisk) {
      card.appendChild(el('div', 'sponsor-card__flag sponsor-card__flag--risk',
        'AT RISK — ' + s.daysLeftInWeek + ' DAY' + (s.daysLeftInWeek === 1 ? '' : 'S') + ' LEFT, OBLIGATION NOT YET MET'));
    }

    card.appendChild(el('div', 'sponsor-card__obligation', obligationLabel(s.obligation)));
    card.appendChild(el('div', 'sponsor-card__hint', obligationHint(s.obligation)));

    var meter = el('div', 'meter sponsor-card__meter');
    var fillCls = 'meter__fill ' + (s.obligation.met ? 'meter__fill--cash' : (atRisk ? 'meter__fill--danger' : 'meter__fill--views'));
    var fill = el('div', fillCls);
    fill.style.width = Math.round((s.obligation.pct || 0) * 100) + '%';
    meter.appendChild(fill);
    card.appendChild(meter);

    var progRow = el('div', 'sponsor-card__progress-row');
    progRow.appendChild(el('span', 'sponsor-card__progress-val',
      Math.round(s.obligation.progress) + ' / ' + s.obligation.amount + (s.obligation.met ? ' — MET' : '')));
    progRow.appendChild(el('span', 'sponsor-card__days',
      s.daysLeftInWeek === 0 ? 'RESOLVES TONIGHT' : s.daysLeftInWeek + ' DAY' + (s.daysLeftInWeek === 1 ? '' : 'S') + ' LEFT'));
    card.appendChild(progRow);

    // Never let this read as "warned still pays" — spell out the $0 outcome.
    if (!s.obligation.met) {
      card.appendChild(el('div', 'sponsor-card__miss-note',
        'MISS THIS WEEK -> $0 PAID' + (s.warned ? ', SPONSOR DROPPED' : ' (WARNING ONLY, THIS TIME)')));
    }

    return card;
  }

  function buildSponsorOfferCard(offer, data, status, onChanged) {
    var card = el('div', 'panel offer-card sponsor-offer-card');
    card.style.setProperty('--offer-accent', 'var(--subs)');

    card.appendChild(el('div', 'offer-card__name', offer.name));
    var moneyRow = el('div', 'offer-card__money-row');
    moneyRow.appendChild(el('div', 'offer-card__money', G.UI.money(offer.pay) + ' / WK'));
    card.appendChild(moneyRow);

    card.appendChild(el('div', 'offer-card__meta', obligationLabel(offer.obligation)));
    card.appendChild(el('div', 'sponsor-card__hint', obligationHint(offer.obligation)));
    if (offer.desc) card.appendChild(el('div', 'sponsor-offer-card__desc', offer.desc));

    var expiresIn = Math.max(0, offer.expiresAtDay - data.day);
    card.appendChild(el('span', 'offer-card__meta offer-card__meta--warn',
      'EXPIRES IN ' + expiresIn + ' DAY' + (expiresIn === 1 ? '' : 'S')));

    var full = status.slotsUsed >= status.slotsMax;
    var btnRow = el('div', 'ext-btn-row');
    var acceptBtn = el('button', 'btn btn--primary ext-btn-row__accept', full ? 'SLOTS FULL' : 'ACCEPT');
    G.UI.setDisabled(acceptBtn, full);
    var declineBtn = el('button', 'btn ext-btn-row__decline', 'DECLINE');

    acceptBtn.addEventListener('click', function () {
      if (full) return;
      var res = G.State.acceptSponsorOffer(offer.id);
      if (!res || !res.ok) {
        G.UI.beep('miss');
        var reason = res && res.reason;
        var msg = reason === 'sponsor-slots-full' ? 'SPONSOR SLOTS FULL' :
          reason === 'expired' ? 'OFFER EXPIRED' : 'COULD NOT ACCEPT OFFER';
        G.UI.toast(msg, 'bad');
        onChanged();
        return;
      }
      G.UI.beep('cash');
      G.UI.confetti(card, 'var(--cash)');
      G.UI.toast(res.sponsor.name + ' SIGNED', 'good');
      onChanged();
    });
    declineBtn.addEventListener('click', function () {
      G.State.declineSponsorOffer(offer.id);
      G.UI.beep('click');
      onChanged();
    });

    btnRow.appendChild(acceptBtn);
    btnRow.appendChild(declineBtn);
    card.appendChild(btnRow);
    return card;
  }

  function renderSponsors(data) {
    if (!els.sponsorsSection || !els.sponsorOffersSection) return;
    var S = G.State;
    if (typeof S.sponsorsStatus !== 'function') { els.sponsorsSection.innerHTML = ''; els.sponsorOffersSection.innerHTML = ''; return; }

    var status = S.sponsorsStatus();

    els.sponsorsSection.innerHTML = '';
    var head = el('div', 'sponsors__head');
    head.appendChild(el('div', 'sponsors__title', 'SPONSORS'));
    var riskCount = status.held.filter(function (s) { return s.atRisk; }).length;
    var slotsEl = el('span', 'sponsors__slots' + (status.slotsUsed >= status.slotsMax ? ' sponsors__slots--full' : ''),
      status.slotsUsed + ' / ' + status.slotsMax + ' SLOTS');
    head.appendChild(slotsEl);
    els.sponsorsSection.appendChild(head);

    var weekLine = el('div', 'sponsors__week-line',
      (status.daysLeftInWeek === 0 ? 'PAYOUT RESOLVES TONIGHT' :
        status.daysLeftInWeek + ' DAY' + (status.daysLeftInWeek === 1 ? '' : 'S') + ' LEFT THIS WEEK') +
      '  ·  NEXT PAYOUT DAY ' + status.nextPayoutDay + '  ·  MISSED WEEKS PAY $0');
    els.sponsorsSection.appendChild(weekLine);

    if (riskCount > 0) {
      els.sponsorsSection.appendChild(el('div', 'sponsors__risk-banner',
        riskCount + ' SPONSOR' + (riskCount === 1 ? '' : 'S') + ' AT RISK THIS WEEK — CHECK BELOW BEFORE YOU SLEEP'));
    }

    if (!status.held.length) {
      els.sponsorsSection.appendChild(el('div', 'sponsors__empty',
        'NO SPONSORS YET — OFFERS ARRIVE GRADUALLY AS YOUR FOLLOWERS, SUBSCRIBERS AND RANK GROW.'));
    } else {
      var list = el('div', 'sponsors__held-list');
      status.held.forEach(function (s) { list.appendChild(buildHeldSponsorCard(s)); });
      els.sponsorsSection.appendChild(list);
    }

    els.sponsorOffersSection.innerHTML = '';
    var offers = typeof S.sponsorOffers === 'function' ? S.sponsorOffers() : [];
    if (offers.length) {
      els.sponsorOffersSection.appendChild(el('div', 'career__section-header', 'SPONSOR OFFERS'));
      if (status.slotsUsed >= status.slotsMax) {
        els.sponsorOffersSection.appendChild(el('div', 'career__section-sub sponsors__full-note',
          'SPONSOR SLOTS FULL (' + status.slotsMax + ' / ' + status.slotsMax + ') — DECLINE OR LOSE A HELD SPONSOR TO FREE A SLOT.'));
      }
      offers.slice().sort(function (a, b) { return a.expiresAtDay - b.expiresAtDay; }).forEach(function (o) {
        els.sponsorOffersSection.appendChild(buildSponsorOfferCard(o, data, status, render));
      });
    }
  }

  function buildDom() {
    var root = G.Router.root('sponsors');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">SPONSORS</span><button class="btn screen-header__back" id="sponsors-back">BACK</button></div>' +
      '<div class="sponsors-screen">' +
        '<div class="panel career__sponsors" id="career-sponsors-section"></div>' +
        '<div id="career-sponsor-offers-section"></div>' +
      '</div>';

    els.sponsorsSection = document.getElementById('career-sponsors-section');
    els.sponsorOffersSection = document.getElementById('career-sponsor-offers-section');

    document.getElementById('sponsors-back').addEventListener('click', function () {
      G.UI.beep('click');
      // SPEC-V14 §4.3 — SPONSORS is a phone app: BACK returns to the hub
      // with the phone open, not to CAREER. Same wrong-back-target bug
      // already fixed three times elsewhere (teams.js, tournaments.js,
      // social.js) — get it right the first time here.
      G.Router.go('hub');
      if (G.Phone && G.Phone.open) G.Phone.open();
    });

    built = true;
  }

  function render() {
    var data = G.State.data;
    if (!data) return;
    renderSponsors(data);
  }

  G.Router = G.Router || {};
  G.Router.register('sponsors', {
    onEnter: function () {
      if (!built) buildDom();
      render();
    },
    onExit: function () {}
  });

  G.Sponsors = { ready: true };
})(window.Game = window.Game || {});
