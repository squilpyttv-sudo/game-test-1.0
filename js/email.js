/* ==========================================================================
   CS2 PRO SIMULATOR — js/email.js
   Game.Email — the EMAIL app screen (SPEC-V23-QUESTS.md §3.2).

   TWO VIEWS, ONE ROOT. The list and the detail live in the same
   `#screen-email` element and swap purely by a class on the screen root
   (`.email--detail`), exactly the mechanism the phone's own lock screen and
   inventory page already use (css/phone.css). No second overlay, no layout
   written from JS, and BACK out of the detail costs no rebuild.

   This is a PURE RENDERER over the State API. Every rule — the 30-entry cap,
   the expiry sweep, the tier economy, the scout stage latch — already lives
   in js/state.js. This file's whole job is to make two things legible:

     1. TIME IS RUNNING OUT. An open invite carries a days-left countdown
        that turns gold, then red on its last day. That is the pressure the
        feature is built on, so it is the loudest thing in a row.
     2. THE HISTORY STAYS. Resolved mail (won / lost / expired) is NOT
        removed from the list — it drops onto the recessed well value with
        dimmed ink and a settled badge, so the player can read back their own
        run without the settled rows competing with the live one.

   ---------------------------------------------------------------------------
   THE ACCEPT ORDERING IS LOAD-BEARING (spec §1). DO NOT "FIX" IT.

   State.acceptInvite() deliberately does NOT roll a result — it only moves
   the email to 'accepted'. THE CLUTCH decides, and its completion callback
   is the only thing that ever calls State.resolveInvite(). This is the exact
   OPPOSITE of js/matchgames.js, which pre-rolls its outcome before its
   overlay opens ON PURPOSE, because a career match must not hinge on a
   minigame. A quest is opt-in side content off the critical path, so here
   the minigame IS the decider. Someone will eventually notice the two files
   disagree and try to make them match; whichever way they go, one of the two
   features breaks. They disagree deliberately.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};
  var openId = null;      // id of the email shown in the detail view, or null
  var running = false;    // a CLUTCH run is live — guards double-taps

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---- authored SVG icons (ART-DIRECTION §2.5 house style) ---------------
     24x24 viewBox, 2px stroke, currentColor, aria-hidden. No emoji and no
     Unicode glyph doing icon duty — the exact envelope character this app is
     named after was already removed from career.js once. The envelope below
     is the same drawing as js/phone.js's ICON_EMAIL so the tile and the
     screen it opens are one object. */
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      inner + '</svg>';
  }
  var ICON_ENVELOPE = svg('<rect x="2.5" y="5.5" width="19" height="14" rx="1.5"/>' +
    '<path d="M3.5 7.2l8 6.1 8-6.1"/>');
  var ICON_CHEVRON  = svg('<path d="M9.5 5.5L16 12l-6.5 6.5"/>');
  var ICON_BACK     = svg('<path d="M19.5 12h-14"/><path d="M11.5 6l-6 6 6 6"/>');
  var ICON_CHECK    = svg('<path d="M4.5 12.5l5 5 10-11"/>');
  var ICON_CROSS    = svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>');
  var ICON_CLOCK    = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.4 2"/>');
  var ICON_SWORDS   = svg('<path d="M4 4h4l12 12v4h-4L4 8z"/><path d="M20 4h-4l-4 4"/><path d="M8 16l-4 4h4"/>');

  function icon(cls, markup) {
    var s = el('span', cls);
    s.innerHTML = markup;
    return s;
  }

  /* ---- state vocabulary --------------------------------------------------
     One table, so a row badge, a detail badge and a screen-reader label can
     never drift apart. 'accepted' is reachable on a reload mid-CLUTCH (the
     email is written before the overlay opens, on purpose — see resolve()) so
     it is a first-class settled-but-unfinished state here, not an oversight. */
  var STATE_LABEL = {
    open:     'OPEN',
    accepted: 'IN PROGRESS',
    won:      'WON',
    lost:     'LOST',
    expired:  'CLOSED'
  };
  var STATE_ICON = {
    accepted: ICON_SWORDS,
    won:      ICON_CHECK,
    lost:     ICON_CROSS,
    expired:  ICON_CLOCK
  };
  function isLive(e) { return e.state === 'open'; }
  function isSettled(e) { return e.state === 'won' || e.state === 'lost' || e.state === 'expired'; }

  function tierFor(e) {
    var list = (G.Data && G.Data.questInvites) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === e.inviteId) return list[i];
    return null;
  }

  // Days left on anything still open. Scout mail carries expiresDay:null and
  // never expires, so it returns null and gets no countdown — a permanent
  // "0 DAYS LEFT" on informational mail would be a lie.
  function daysLeft(e) {
    var d = G.State.data;
    if (!d || e.state !== 'open' || e.expiresDay == null) return null;
    return Math.max(0, e.expiresDay - d.day);
  }
  function countdownText(n) {
    return n === 0 ? 'LAST DAY' : n + ' DAY' + (n === 1 ? '' : 'S') + ' LEFT';
  }

  /* ---------------------------------------------------------------- LIST */

  function buildRow(e) {
    // A real <button>: keyboard-reachable and activatable for free, and
    // UI.setDisabled() would work on it natively if a row ever needs to die.
    var settled = isSettled(e);
    var row = el('button', 'email-row' +
      (e.read ? '' : ' email-row--unread') +
      (settled ? ' email-row--settled' : ''));
    row.type = 'button';

    var dot = el('span', 'email-row__dot');
    dot.setAttribute('aria-hidden', 'true');
    row.appendChild(dot);

    var main = el('div', 'email-row__main');
    var top = el('div', 'email-row__top');
    top.appendChild(el('span', 'email-row__from', e.from || 'UNKNOWN'));
    top.appendChild(el('span', 'email-row__day', 'DAY ' + e.day));
    main.appendChild(top);
    main.appendChild(el('div', 'email-row__subject', e.subject || ''));

    var n = daysLeft(e);
    var tag = el('div', 'email-row__tags');
    if (n !== null) {
      tag.appendChild(el('span', 'email-badge email-badge--time' +
        (n === 0 ? ' email-badge--urgent' : ''), countdownText(n)));
    } else if (settled || e.state === 'accepted') {
      var badge = el('span', 'email-badge email-badge--' + e.state);
      badge.appendChild(icon('email-badge__icon', STATE_ICON[e.state] || ICON_CLOCK));
      badge.appendChild(el('span', null, STATE_LABEL[e.state]));
      tag.appendChild(badge);
    } else if (e.kind === 'scout') {
      tag.appendChild(el('span', 'email-badge email-badge--scout', 'SCOUTING'));
    }
    if (tag.childNodes.length) main.appendChild(tag);
    row.appendChild(main);

    row.appendChild(icon('email-row__chev', ICON_CHEVRON));

    // The dot is decorative; the unread/settled fact has to reach a screen
    // reader through the label, not through colour alone.
    row.setAttribute('aria-label',
      (e.read ? '' : 'UNREAD. ') + (e.from || 'UNKNOWN') + '. ' + (e.subject || '') + '. ' +
      (n !== null ? countdownText(n) + '.' : (STATE_LABEL[e.state] || '') + '.'));

    row.addEventListener('click', function () {
      G.UI.beep('click');
      openDetail(e.id);
    });
    return row;
  }

  /* Scout interest — spec §6's "the wall made visible". A pure readout off
     State.scoutStatus(); no economy is invented here. It sits above the
     inbox because it is the answer to the question the inbox raises ("why
     is nobody writing to me?"), and it is a strip rather than a card so it
     never outweighs a live invite below it. */
  function renderScout() {
    var host = els.scout;
    host.innerHTML = '';
    if (!G.State || typeof G.State.scoutStatus !== 'function') return;
    var s = G.State.scoutStatus();
    var total = ((G.Data && G.Data.scoutStages) || []).length;
    var done = total > 0 && s.stage >= total;

    var head = el('div', 'email-scout__head');
    head.appendChild(el('span', 'email-scout__title', 'SCOUT INTEREST'));
    head.appendChild(el('span', 'email-scout__pct', Math.round((s.interest || 0) * 100) + '%'));
    host.appendChild(head);

    var meter = el('div', 'email-scout__meter');
    var fill = el('div', 'email-scout__fill' + (done ? ' email-scout__fill--max' : ''));
    fill.style.width = Math.round((s.interest || 0) * 100) + '%';
    meter.appendChild(fill);
    host.appendChild(meter);

    host.appendChild(el('div', 'email-scout__sub', done
      ? 'EVERY DESK IN THE REGION HAS YOUR FILE OPEN.'
      : 'STAGE ' + s.stage + ' OF ' + (total || '?') + ' — CLIMB ELO AND THE NEXT DESK WRITES.'));
  }

  function renderList() {
    renderScout();

    var list = G.State.emails ? G.State.emails() : [];   // already newest-first
    var unread = G.State.unreadEmailCount ? G.State.unreadEmailCount() : 0;
    var live = 0;
    list.forEach(function (e) { if (isLive(e)) live++; });

    els.count.textContent = unread > 0 ? unread + ' NEW' : (list.length ? 'ALL READ' : '');
    els.count.classList.toggle('email__count--hot', unread > 0);

    els.summary.textContent = live > 0
      ? live + ' INVITE' + (live === 1 ? '' : 'S') + ' STILL OPEN — THEY EXPIRE ON THEIR OWN.'
      : 'NOTHING OPEN RIGHT NOW. NEW MAIL ARRIVES WHEN YOU SLEEP.';
    els.summary.classList.toggle('email__summary--live', live > 0);

    els.rows.innerHTML = '';
    if (!list.length) {
      var empty = el('div', 'email-empty');
      empty.appendChild(icon('email-empty__icon', ICON_ENVELOPE));
      empty.appendChild(el('div', 'email-empty__title', 'INBOX EMPTY'));
      empty.appendChild(el('div', 'email-empty__text',
        'ORGS MAIL PLAYERS THEY HAVE SEEN PLAY. KEEP GRINDING AND SLEEP — INVITES LAND OVERNIGHT.'));
      els.rows.appendChild(empty);
      return;
    }
    list.forEach(function (e) { els.rows.appendChild(buildRow(e)); });
  }

  /* -------------------------------------------------------------- DETAIL */

  function findEmail(id) {
    var list = G.State.emails ? G.State.emails() : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function rewardRow(label, value, cls) {
    var r = el('div', 'email-reward__row');
    r.appendChild(el('span', 'email-reward__label', label));
    r.appendChild(el('span', 'email-reward__val' + (cls ? ' ' + cls : ''), value));
    return r;
  }

  function renderDetail() {
    var host = els.detail;
    host.innerHTML = '';
    var e = openId ? findEmail(openId) : null;
    if (!e) { showList(); return; }

    var bar = el('div', 'email-detail__bar');
    // 44x44. A 61x31 back control shipped on this screen once and had to be
    // fixed; the hit box is the button itself, not a padded glyph inside it.
    var back = el('button', 'email-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'BACK TO INBOX');
    back.appendChild(icon('email-back__icon', ICON_BACK));
    back.addEventListener('click', function () {
      if (running) return;
      G.UI.beep('click');
      showList();
    });
    bar.appendChild(back);
    var who = el('div', 'email-detail__who');
    who.appendChild(el('div', 'email-detail__from', e.from || 'UNKNOWN'));
    who.appendChild(el('div', 'email-detail__day', 'RECEIVED DAY ' + e.day));
    bar.appendChild(who);
    host.appendChild(bar);

    var letter = el('div', 'panel email-letter');
    letter.appendChild(el('h2', 'email-letter__subject', e.subject || ''));

    var n = daysLeft(e);
    var status = el('div', 'email-letter__status');
    if (n !== null) {
      status.appendChild(el('span', 'email-badge email-badge--time' +
        (n === 0 ? ' email-badge--urgent' : ''), countdownText(n)));
    } else if (STATE_ICON[e.state]) {
      var b = el('span', 'email-badge email-badge--' + e.state);
      b.appendChild(icon('email-badge__icon', STATE_ICON[e.state]));
      b.appendChild(el('span', null, STATE_LABEL[e.state]));
      status.appendChild(b);
    }
    if (status.childNodes.length) letter.appendChild(status);

    letter.appendChild(el('p', 'email-letter__body', e.body || ''));
    host.appendChild(letter);

    var tier = e.kind === 'invite' ? tierFor(e) : null;

    // The reward line — shown for an OPEN invite (spec §3.2). Kept visible on
    // an in-progress one too: the player is about to be handed back a result
    // and needs the stakes in front of them, not a screen that has quietly
    // dropped them.
    if (tier && (e.state === 'open' || e.state === 'accepted')) {
      var rw = el('div', 'panel email-reward');
      rw.appendChild(el('div', 'email-reward__head', 'STAKES'));
      rw.appendChild(rewardRow('PURSE', G.UI.money(tier.purse), 'email-reward__val--cash'));
      rw.appendChild(rewardRow('WIN', '+' + tier.winElo + ' ELO', 'email-reward__val--good'));
      rw.appendChild(rewardRow('LOSE', tier.loseElo + ' ELO' +
        (tier.loseCash ? ' AND ' + G.UI.money(tier.loseCash) : ''), 'email-reward__val--bad'));
      rw.appendChild(el('div', 'email-reward__note',
        tier.enemies + ' ENEMIES · ' + tier.exposeMs + 'MS EXPOSURE · BEST OF 3 — THE CLUTCH DECIDES THIS, NOT A DICE ROLL.'));
      host.appendChild(rw);
    }

    if (e.state === 'open' && e.kind === 'invite') {
      var actions = el('div', 'email-actions');
      var accept = el('button', 'btn btn--primary email-actions__btn', 'ACCEPT');
      accept.type = 'button';
      var decline = el('button', 'btn email-actions__btn', 'DECLINE');
      decline.type = 'button';
      accept.addEventListener('click', function () { onAccept(e.id, accept, decline); });
      decline.addEventListener('click', function () { onDecline(e.id); });
      actions.appendChild(accept);
      actions.appendChild(decline);
      host.appendChild(actions);
      host.appendChild(el('div', 'email-actions__note',
        'ACCEPTING OPENS THE CLUTCH IMMEDIATELY. DECLINING CLOSES THIS INVITE FOR GOOD.'));
    } else if (e.state === 'accepted' && e.kind === 'invite') {
      // Recovery path: the email is written to 'accepted' before the overlay
      // opens, so a reload mid-match leaves a real, still-playable invite.
      // State.resolveInvite() only accepts an 'accepted' entry, so replaying
      // it here is the same pipeline, not a second one.
      var resume = el('button', 'btn btn--primary email-actions__btn email-actions__btn--wide',
        'PLAY THE CLUTCH');
      resume.type = 'button';
      resume.addEventListener('click', function () { launch(e.id, tier, resume); });
      var wrap = el('div', 'email-actions');
      wrap.appendChild(resume);
      host.appendChild(wrap);
      host.appendChild(el('div', 'email-actions__note',
        'THIS MATCH WAS ACCEPTED BUT NEVER FINISHED. IT IS STILL YOURS TO PLAY.'));
    } else if (e.kind === 'scout' && e.scoutStage === 4) {
      host.appendChild(el('div', 'email-actions__note',
        'REAL OFFERS ARRIVE THROUGH THE CAREER SCREEN — THIS IS THE HEADS-UP, NOT THE CONTRACT.'));
    }
  }

  /* ------------------------------------------------------------- ACTIONS */

  function launch(id, tier, btn) {
    if (running) return;
    if (!G.Clutch || typeof G.Clutch.run !== 'function') {
      G.UI.beep('miss');
      G.UI.toast('THE CLUTCH IS UNAVAILABLE', 'bad');
      return;
    }
    running = true;
    if (btn) G.UI.setDisabled(btn, true);
    G.Clutch.run(
      { enemies: (tier && tier.enemies) || 2, exposeMs: (tier && tier.exposeMs) || 900 },
      function (won) {
        // THE MINIGAME DECIDED THIS. State.resolveInvite() is the only place
        // a quest moves cash or ELO, and it is only ever reached from here.
        var res = G.State.resolveInvite(id, won);
        running = false;
        if (res && res.ok) {
          if (won) {
            G.UI.beep('cash');
            G.UI.toast('CLUTCHED — ' + G.UI.money(res.cash) + ' AND +' + res.elo + ' ELO', 'good');
          } else {
            G.UI.beep('miss');
            G.UI.toast('LOST THE LAN — ' + res.elo + ' ELO', 'bad');
          }
        }
        render();
      }
    );
  }

  function onAccept(id, acceptBtn, declineBtn) {
    if (running) return;
    // ---- SPEC §1 ORDERING. Accept first (it rolls NOTHING), then let THE
    // CLUTCH decide, then resolve with what the player actually achieved.
    // Never pre-compute `won` here. js/matchgames.js pre-rolls on purpose;
    // this module does the opposite on purpose.
    var r = G.State.acceptInvite(id);
    if (!r || !r.ok) {
      G.UI.beep('miss');
      var reason = r && r.reason;
      var msg = reason === 'ELO TOO LOW' ? 'YOUR ELO IS TOO LOW FOR THIS TIER' :
        reason === 'EXPIRED' ? 'THIS INVITE HAS EXPIRED' :
        reason === 'ALREADY RESOLVED' ? 'THIS INVITE IS ALREADY SETTLED' :
        'COULD NOT ACCEPT THIS INVITE';
      G.UI.toast(msg, 'bad');
      render();
      return;
    }
    if (declineBtn) G.UI.setDisabled(declineBtn, true);
    launch(id, r.invite, acceptBtn);
  }

  function onDecline(id) {
    if (running) return;
    var r = G.State.declineInvite(id);
    G.UI.beep('click');
    if (!r || !r.ok) G.UI.toast('COULD NOT DECLINE THIS INVITE', 'bad');
    else G.UI.toast('INVITE DECLINED', 'info');
    render();
  }

  /* ------------------------------------------------------------ VIEW SWAP */

  function showList() {
    openId = null;
    els.root.classList.remove('email--detail');
    render();
    // The phone's notifCount reads State.unreadEmailCount(); a mail marked
    // read in here has to reach the tile dot without waiting for a hub tick.
    if (G.Phone && typeof G.Phone.refresh === 'function') G.Phone.refresh();
  }

  function openDetail(id) {
    openId = id;
    if (G.State.readEmail) G.State.readEmail(id);
    els.root.classList.add('email--detail');
    render();
    if (els.detail && els.detail.scrollTop) els.detail.scrollTop = 0;
  }

  function render() {
    if (!G.State || !G.State.data) return;
    if (openId) renderDetail(); else els.detail.innerHTML = '';
    renderList();
  }

  /* ----------------------------------------------------------------- DOM */

  function buildDom() {
    var root = G.Router.root('email');
    root.innerHTML =
      '<div class="screen-header">' +
        '<span class="screen-header__title">EMAIL</span>' +
        '<span class="email__count" id="email-count"></span>' +
        '<button class="btn screen-header__back email__exit" id="email-back" type="button">BACK</button>' +
      '</div>' +
      '<div class="email-screen">' +
        '<div class="email-list" id="email-list">' +
          '<div class="panel email-scout" id="email-scout"></div>' +
          '<div class="email__summary" id="email-summary"></div>' +
          '<div class="email-rows" id="email-rows"></div>' +
        '</div>' +
        '<div class="email-detail" id="email-detail"></div>' +
      '</div>';

    els.root = root;
    els.count = document.getElementById('email-count');
    els.summary = document.getElementById('email-summary');
    els.scout = document.getElementById('email-scout');
    els.rows = document.getElementById('email-rows');
    els.detail = document.getElementById('email-detail');

    document.getElementById('email-back').addEventListener('click', function () {
      if (running) return;
      G.UI.beep('click');
      // In the detail view this control steps back to the inbox rather than
      // leaving the app — the same wrong-back-target bug fixed four times
      // elsewhere (teams.js, tournaments.js, social.js, sponsors.js).
      if (openId) { showList(); return; }
      // SPEC-V14 §4.3 — EMAIL is a phone app: BACK returns to the hub with
      // the phone open, not to CAREER.
      G.Router.go('hub');
      if (G.Phone && G.Phone.open) G.Phone.open();
    });

    built = true;
  }

  G.Router = G.Router || {};
  G.Router.register('email', {
    onEnter: function () {
      if (!built) buildDom();
      openId = null;
      running = false;
      els.root.classList.remove('email--detail');
      render();
    },
    onExit: function () {
      openId = null;
      if (built) els.root.classList.remove('email--detail');
      if (G.Phone && typeof G.Phone.refresh === 'function') G.Phone.refresh();
    }
  });

  G.Email = { ready: true };
})(window.Game = window.Game || {});
