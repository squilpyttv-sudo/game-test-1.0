/* ==========================================================================
   CS2 PRO SIMULATOR — js/career.js
   The PRO CAREER screen (SPEC-V4 §5b/§5c/§5e): the offers inbox is the only
   way to sign a team. Also still hosts chemistry/hype status + the SCRIM
   action (§5.5, unchanged) and links out to TEAMS / TOURNAMENTS.
   ========================================================================== */
(function () {
  'use strict';

  var built = false;
  var els = {};

  var TRAJ_COLOR = { rising: 'var(--cash)', stable: 'var(--views)', declining: 'var(--danger)' };
  // §12u — reputation band colors (respected/neutral/questionable/toxic).
  var REP_BAND_COLOR = { respected: 'var(--cash)', neutral: 'var(--views)', questionable: 'var(--gold)', toxic: 'var(--danger)' };

  // §12u "surface the change whenever it moves" — reputationStatus() has no
  // history of its own (Package P's API is a snapshot only), so this file
  // remembers the last-seen value itself (localStorage, same pattern
  // js/teams.js uses for rank movement) and toasts the delta on render.
  var LAST_REP_KEY = 'cs2sim_last_reputation_v1';
  function loadLastReputation() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(LAST_REP_KEY);
      return raw === null ? null : parseFloat(raw);
    } catch (e) { return null; }
  }
  function saveLastReputation(v) {
    try { window.localStorage && window.localStorage.setItem(LAST_REP_KEY, String(v)); } catch (e) {}
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- icons
     Authored SVG only (ART-DIRECTION §2.5) — 24x24 viewBox, currentColor,
     in the house style js/phone.js set. No emoji, no Unicode glyph doing
     icon duty anywhere in this file.

     Every icon here is drawn at a size that reads next to 12-13px text, so
     they keep the 2px outline register rather than dropping to a filled
     silhouette. Stroke is nudged up on the two 15px arrows because 2/24 of
     15px is 1.25 device pixels — visibly thinner than the 700-weight
     numbers they sit between. Sized by attribute, never by stylesheet: the
     rules for these three elements live in css/teams.css, which this
     package does not own.

     Accessibility: every SVG here is aria-hidden, and the word it used to
     imply is restored as a .sr-only span beside it wherever the glyph was
     genuinely load-bearing. Chosen over aria-label/role="img"+<title>
     because support for a name ON an <svg> is uneven across screen readers,
     while a visually-hidden span is spoken by all of them, keeps the icon
     markup byte-identical to the house set in js/phone.js, and puts the
     spoken text in plain sight in the source. Two of the three need no such
     text: the envelope sits directly above the words "NO OFFERS YET", and
     the .ext-compare arrow sits between columns already labelled OLD SALARY
     and NEW SALARY. A name on either would only add noise. */
  var ICON_ENVELOPE =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
      '<rect x="2.5" y="5" width="19" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M3.2 6.1L12 12.4l8.8-6.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  var ICON_ARROW_RIGHT =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
      '<path d="M3.5 12h16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M13.4 5.8L19.8 12l-6.4 6.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  // an element whose whole content is one authored icon (plus, optionally,
  // screen-reader-only text). .icon-inline (css/style.css) kills the inline
  // baseline gap the raw <svg> would otherwise carry.
  function iconEl(tag, cls, svg) {
    var e = el(tag, 'icon-inline ' + cls);
    e.innerHTML = svg;
    return e;
  }

  function buildDom() {
    var root = window.Game.Router.root('career');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">CAREER</span><button class="btn screen-header__back" id="career-back">BACK</button></div>' +
      '<div class="career__nav-row">' +
        '<button class="btn career__nav-btn" id="career-nav-teams">LEADERBOARD</button>' +
        '<button class="btn career__nav-btn" id="career-nav-tournaments">TOURNAMENTS' +
          '<span class="badge-dot" id="career-tournaments-badge" aria-hidden="true"></span>' +
        '</button>' +
      '</div>' +
      '<div class="career">' +
        '<div class="career__status panel">' +
          '<div class="career__contract-name" id="career-contract-name">FREE AGENT</div>' +
          '<div class="career__row"><span class="h-label">HYPE</span><div class="meter"><div class="meter__fill meter__fill--subs" id="career-hype-fill"></div></div><span id="career-hype-val">0</span></div>' +
          '<div class="career__row"><span class="h-label">CHEMISTRY</span><div class="meter"><div class="meter__fill meter__fill--cash" id="career-chem-fill"></div></div><span id="career-chem-val">0</span></div>' +
          '<div class="career__row" id="career-quota-row"><span class="h-label">SCRIM QUOTA</span><div class="meter"><div class="meter__fill meter__fill--views" id="career-quota-fill"></div></div><span id="career-quota-val">0/0</span></div>' +
          '<div class="career__quota-coach" id="career-quota-coach"></div>' +
          '<div class="career__rep-block">' +
            '<div class="career__rep-head"><span class="h-label">REPUTATION</span><span class="career__rep-band" id="career-rep-band"></span></div>' +
            '<div class="meter career__rep-meter"><div class="career__rep-meter-mid"></div><div class="meter__fill career__rep-meter-fill" id="career-rep-fill"></div></div>' +
            '<div class="career__rep-gating" id="career-rep-gating"></div>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn--primary career__scrim-btn" id="career-scrim-btn">SCRIM (-20 ENERGY, + CHEMISTRY)</button>' +
        '<div id="career-team-section"></div>' +
        '<div id="career-offers-section"></div>' +
      '</div>';

    els.contractName = document.getElementById('career-contract-name');
    els.hypeFill = document.getElementById('career-hype-fill');
    els.hypeVal = document.getElementById('career-hype-val');
    els.chemFill = document.getElementById('career-chem-fill');
    els.chemVal = document.getElementById('career-chem-val');
    els.quotaRow = document.getElementById('career-quota-row');
    els.quotaFill = document.getElementById('career-quota-fill');
    els.quotaVal = document.getElementById('career-quota-val');
    els.quotaCoach = document.getElementById('career-quota-coach');
    els.scrimBtn = document.getElementById('career-scrim-btn');
    els.repBand = document.getElementById('career-rep-band');
    els.repFill = document.getElementById('career-rep-fill');
    els.repGating = document.getElementById('career-rep-gating');
    els.teamSection = document.getElementById('career-team-section');
    els.offersSection = document.getElementById('career-offers-section');
    els.tournamentsBadge = document.getElementById('career-tournaments-badge');

    document.getElementById('career-back').addEventListener('click', function () {
      window.Game.UI.beep('click');
      window.Game.Router.back();
    });
    document.getElementById('career-nav-teams').addEventListener('click', function () {
      window.Game.UI.beep('click');
      window.Game.Router.go('teams');
    });
    document.getElementById('career-nav-tournaments').addEventListener('click', function () {
      window.Game.UI.beep('click');
      window.Game.Router.go('tournaments');
    });
    els.scrimBtn.addEventListener('click', onScrim);
    built = true;
  }

  var SCRIM_FAIL_TOAST = {
    energy: 'NOT ENOUGH ENERGY',
    'no-team': 'SIGN WITH A TEAM BEFORE SCRIMMING',
    dead: 'YOUR CAREER IS OVER'
  };
  function onScrim() {
    var res = window.Game.State.scrim();
    if (!res || !res.ok) {
      window.Game.UI.beep('miss');
      window.Game.UI.toast((res && SCRIM_FAIL_TOAST[res.reason]) || 'COULD NOT SCRIM', 'bad');
      return;
    }
    window.Game.UI.beep('hit');
    window.Game.UI.toast('SCRIM COMPLETE — CHEMISTRY +' + res.chemistry, 'good');
    render();
  }

  /* ---- objectives checklist (shared by the signed-team card, offer cards,
     and the free-agent scout board) ------------------------------------- */
  function buildObjectives(list) {
    var wrap = el('div', 'obj-list');
    if (!list.length) {
      wrap.appendChild(el('div', 'obj-row obj-row--done', 'NO REQUIREMENTS — OPEN ELIGIBILITY'));
      return wrap;
    }
    list.forEach(function (o) {
      var row = el('div', 'obj-row' + (o.done ? ' obj-row--done' : ''));
      row.appendChild(el('span', 'obj-row__check', o.done ? 'OK' : '—'));
      row.appendChild(el('span', 'obj-row__label', o.label + ' (' + o.current + ' / ' + o.target + ')'));
      wrap.appendChild(row);
    });
    return wrap;
  }

  // SPEC-V13 §1B — offer-card trajectory indicator: a line of scout-intel
  // prose (Data.scoutLineFor), replacing the old icon-only banner. All three
  // trajectories (including stable, which previously got nothing) render a
  // line — Data.trajectoryScoutLines.stable exists specifically for this.
  // Deterministic on (teamId, trajectory, trajectorySince) so the line never
  // flickers across the frequent re-renders this screen does.
  function trajBanner(team) {
    var seed = team.trajectorySince || 0; // defensive: undefined on a save mid-migration
    var line = window.Game.Data.scoutLineFor(team.id, team.trajectory, seed);
    if (!line) return null;
    var b = el('div', 'traj-banner traj-banner--text', line);
    b.style.color = TRAJ_COLOR[team.trajectory] || 'var(--ink-dim)';
    b.style.borderColor = TRAJ_COLOR[team.trajectory] || 'var(--border)';
    return b;
  }
  function appendTrajBanner(card, team) {
    var b = trajBanner(team);
    if (b) card.appendChild(b);
  }

  function teamHeaderRow(team, rankPrefix) {
    var row = el('div', 'offer-card__logo-row');
    row.appendChild(window.Game.Teams.renderLogo(team, 'lg'));
    var info = el('div', 'offer-card__logo-info');
    info.appendChild(el('div', 'offer-card__name', team.name));
    info.appendChild(el('div', 'offer-card__rank', (rankPrefix || '#') + team.rank + '  ·  TIER ' + team.tier));
    row.appendChild(info);
    return row;
  }

  /* ---- YOUR TEAM card (signed) ----------------------------------------- */
  function buildMyTeamCard(data) {
    var mine = window.Game.State.myTeam();
    var card = el('div', 'panel myteam-card');
    if (!mine) {
      card.appendChild(el('div', 'offer-card__salary', 'SIGNED, BUT THIS TEAM ISN’T TRACKED ON THE LEADERBOARD.'));
      return card;
    }
    card.appendChild(teamHeaderRow(mine, 'RANK #'));
    appendTrajBanner(card, mine);

    var moneyRow = el('div', 'offer-card__money-row');
    moneyRow.appendChild(el('div', 'offer-card__money', window.Game.UI.money(data.teamSalary || mine.salary) + ' / MO'));
    moneyRow.appendChild(el('div', 'offer-card__money offer-card__money--dim', 'STR ' + Math.round(mine.strength)));
    card.appendChild(moneyRow);

    if (data.contractLength > 0) {
      var remain = data.contractSleeps;
      var total = data.contractLength;
      var pct = total > 0 ? Math.max(0, Math.min(100, (remain / total) * 100)) : 0;
      var progWrap = el('div', 'contract-progress');
      progWrap.appendChild(el('div', 'contract-progress__label', 'CONTRACT — ' + remain + ' / ' + total + ' DAYS LEFT'));
      var meter = el('div', 'meter');
      var fill = el('div', 'meter__fill meter__fill--views');
      fill.style.width = pct + '%';
      meter.appendChild(fill);
      progWrap.appendChild(meter);
      card.appendChild(progWrap);
    } else {
      card.appendChild(el('div', 'offer-card__salary', 'LEGACY CONTRACT — NO EXPIRY TRACKED.'));
    }

    var leaveBtn = el('button', 'btn offer-card__leave', 'LEAVE TEAM EARLY');
    leaveBtn.addEventListener('click', function () {
      window.Game.UI.confirmModal({
        title: 'LEAVE ' + mine.name + '?',
        text: 'Walking out early tanks your hype and forfeits this contract immediately — no refund of the signing bonus. You go straight back to free agency.',
        color: 'var(--danger)',
        yesText: 'LEAVE NOW',
        noText: 'STAY',
        onYes: function () {
          var res = window.Game.State.leaveTeam();
          if (!res.ok) {
            window.Game.UI.beep('miss');
            window.Game.UI.toast('COULD NOT LEAVE', 'bad');
            return;
          }
          window.Game.UI.beep('ban');
          window.Game.UI.toast('BACK TO FREE AGENCY — HYPE -' + res.hypePenalty, 'bad');
          render();
        }
      });
    });
    card.appendChild(leaveBtn);
    return card;
  }

  /* ---- offer card (free agent, has an open offer) ----------------------- */
  function buildOfferCard(offer, data) {
    var team = window.Game.State.teamById(offer.teamId);
    if (!team) return null;
    var card = el('div', 'panel offer-card');
    card.style.setProperty('--offer-accent', TRAJ_COLOR[offer.trajectory] || 'var(--ink)');

    card.appendChild(teamHeaderRow(team, '#'));
    appendTrajBanner(card, team);

    var moneyRow = el('div', 'offer-card__money-row');
    moneyRow.appendChild(el('div', 'offer-card__money', window.Game.UI.money(offer.salary) + ' / MO'));
    moneyRow.appendChild(el('div', 'offer-card__money offer-card__money--bonus', '+' + window.Game.UI.money(offer.signingBonus) + ' BONUS'));
    card.appendChild(moneyRow);

    var expiresIn = Math.max(0, offer.expiresAtDay - data.day);
    var meta = el('div', 'offer-card__meta-row');
    meta.appendChild(el('span', 'offer-card__meta', offer.contractSleeps + '-DAY CONTRACT'));
    meta.appendChild(el('span', 'offer-card__meta offer-card__meta--warn', 'EXPIRES IN ' + expiresIn + ' DAY' + (expiresIn === 1 ? '' : 'S')));
    card.appendChild(meta);

    // §8 — exact per-team ELO requirement (Data.eloRequirementForRank via
    // team.requirements.elo, already interpolated/rounded by Package T).
    if (team.requirements && team.requirements.elo) {
      card.appendChild(el('div', 'offer-card__elo-req', 'MINIMUM ' + team.requirements.elo.toLocaleString('en-US') + ' ELO'));
    }

    card.appendChild(el('div', 'offer-card__section-label', 'EXPECTATIONS'));
    card.appendChild(buildObjectives(window.Game.State.teamObjectives(offer.teamId)));

    var acceptBtn = el('button', 'btn btn--primary offer-card__sign', 'ACCEPT OFFER');
    acceptBtn.addEventListener('click', function () {
      window.Game.UI.confirmModal({
        title: 'SIGN ' + team.name + '?',
        text: 'Accepting locks in this contract and clears every other open offer — the rest lapse the moment you sign.',
        color: TRAJ_COLOR[offer.trajectory],
        lines: [
          { label: 'SALARY', value: window.Game.UI.money(offer.salary) + '/mo', color: 'var(--cash)' },
          { label: 'SIGNING BONUS', value: window.Game.UI.money(offer.signingBonus), color: 'var(--cash)' },
          { label: 'LENGTH', value: offer.contractSleeps + ' days' }
        ],
        yesText: 'SIGN CONTRACT',
        noText: 'NOT YET',
        onYes: function () {
          var res = window.Game.State.acceptOffer(offer.id);
          if (!res.ok) {
            window.Game.UI.beep('miss');
            window.Game.UI.toast('OFFER NO LONGER AVAILABLE', 'bad');
            render();
            return;
          }
          window.Game.UI.beep('cash');
          window.Game.UI.confetti(card, TRAJ_COLOR[offer.trajectory]);
          window.Game.UI.rewardCard({
            title: 'CONTRACT SIGNED',
            subtitle: res.team.name + ' — RANK #' + res.team.rank,
            color: TRAJ_COLOR[offer.trajectory],
            lines: [
              { label: 'SIGNING BONUS', value: window.Game.UI.money(res.signingBonus), color: 'var(--cash)' },
              { label: 'CONTRACT', value: res.contractSleeps + ' days' }
            ],
            buttonText: 'LET’S GO'
          });
          render();
        }
      });
    });
    card.appendChild(acceptBtn);
    return card;
  }

  /* ---- §5 — offers-inbox empty state (below the lowest tier's ELO floor) */
  function buildOffersEmptyState(data) {
    var floor = window.Game.Data.eloFloorForTier(3);
    var wrap = el('div', 'panel career__offers-empty');
    wrap.appendChild(iconEl('div', 'career__offers-empty-icon icon-inline--center', ICON_ENVELOPE));
    wrap.appendChild(el('div', 'career__offers-empty-title', 'NO OFFERS YET'));
    wrap.appendChild(el('div', 'career__offers-empty-text',
      'Your offers will appear here once you reach ' + floor.toLocaleString('en-US') + ' ELO.'));
    var pct = Math.max(0, Math.min(100, ((data.elo || 0) / floor) * 100));
    var meter = el('div', 'meter career__offers-empty-meter');
    var fill = el('div', 'meter__fill meter__fill--views');
    fill.style.width = pct + '%';
    meter.appendChild(fill);
    wrap.appendChild(meter);
    wrap.appendChild(el('div', 'career__offers-empty-sub', Math.round(data.elo || 0).toLocaleString('en-US') + ' / ' + floor.toLocaleString('en-US') + ' ELO'));
    return wrap;
  }

  /* ---- scout board card (free agent, no offers yet) ---------------------- */
  function buildScoutCard(entry) {
    var team = entry.team;
    var card = el('div', 'panel offer-card offer-card--scout');
    card.style.setProperty('--offer-accent', entry.eligible ? 'var(--cash)' : 'var(--ink-dim)');
    card.appendChild(teamHeaderRow(team, '#'));
    appendTrajBanner(card, team);
    var status = el('div', 'offer-card__scout-status' + (entry.eligible ? ' offer-card__scout-status--ready' : ''),
      entry.eligible ? 'REQUIREMENTS MET — EXPECT AN OFFER SOON' : 'NOT SCOUTING YOU YET');
    card.appendChild(status);
    card.appendChild(el('div', 'offer-card__section-label', 'WHAT THEY WANT'));
    card.appendChild(buildObjectives(entry.objectives));
    return card;
  }

  /* ---- §30u — contract extension offer (on natural expiry) --------------
     Package P's resolveNewDay() sets d.contractExtensionOffer the wake a
     contract runs out, with better terms than the original (State.
     contractExtensionOffer()/acceptContractExtension()/
     declineContractExtension()). Shown above the normal offers/scout board
     so the player can either take the improved deal or shop around. */
  function extCompareCol(label, value, cls) {
    var col = el('div', 'ext-compare__col');
    col.appendChild(el('div', 'ext-compare__label', label));
    col.appendChild(el('div', 'ext-compare__value ' + cls, value));
    return col;
  }

  function buildExtensionCard(offer) {
    var team = window.Game.State.teamById(offer.teamId);
    var card = el('div', 'panel offer-card offer-card--extension');
    card.style.setProperty('--offer-accent', 'var(--gold)');

    card.appendChild(el('div', 'career__section-header', (offer.promoted ? 'PROMOTED — ' : '') + 'CONTRACT EXTENSION OFFERED'));
    if (team) card.appendChild(teamHeaderRow(team, '#'));
    else card.appendChild(el('div', 'offer-card__name', offer.teamName));

    var compareRow = el('div', 'ext-compare');
    compareRow.appendChild(extCompareCol('OLD SALARY', window.Game.UI.money(offer.oldSalary) + '/mo', 'ext-compare__value--old'));
    compareRow.appendChild(iconEl('div', 'ext-compare__arrow', ICON_ARROW_RIGHT));
    compareRow.appendChild(extCompareCol('NEW SALARY', window.Game.UI.money(offer.newSalary) + '/mo', 'ext-compare__value--new'));
    card.appendChild(compareRow);

    card.appendChild(el('div', 'ext-bump', '+' + offer.bumpPct + '% RAISE' + (offer.promoted ? ' — TEAM WAS PROMOTED SINCE YOU SIGNED' : ' OVER YOUR OLD DEAL')));
    card.appendChild(el('div', 'offer-card__meta', '+' + window.Game.UI.money(offer.signingBonus) + ' FRESH SIGNING BONUS  ·  ' + offer.contractSleeps + '-DAY CONTRACT'));

    var btnRow = el('div', 'ext-btn-row');
    var acceptBtn = el('button', 'btn btn--primary ext-btn-row__accept', 'ACCEPT EXTENSION');
    var declineBtn = el('button', 'btn ext-btn-row__decline', 'BECOME FREE AGENT');
    acceptBtn.addEventListener('click', function () {
      var res = window.Game.State.acceptContractExtension();
      if (!res.ok) {
        window.Game.UI.beep('miss');
        window.Game.UI.toast(res.reason === 'room-incomplete' ? 'FINISH YOUR ROOM SETUP FIRST' : 'COULD NOT ACCEPT', 'bad');
        return;
      }
      window.Game.UI.beep('cash');
      window.Game.UI.confetti(card, 'var(--gold)');
      window.Game.UI.toast('EXTENSION SIGNED — ' + res.team.name, 'good');
      render();
    });
    declineBtn.addEventListener('click', function () {
      window.Game.UI.confirmModal({
        title: 'DECLINE EXTENSION?',
        text: 'You will stay a free agent and shop the open offers board instead of re-signing with ' + offer.teamName + ' on the improved terms above.',
        color: 'var(--danger)',
        yesText: 'DECLINE',
        noText: 'GO BACK',
        onYes: function () {
          window.Game.State.declineContractExtension();
          window.Game.UI.beep('click');
          render();
        }
      });
    });
    btnRow.appendChild(acceptBtn);
    btnRow.appendChild(declineBtn);
    card.appendChild(btnRow);
    return card;
  }

  // tournamentPending (SPEC-V5 §21): mirrors js/hub.js's private helper of
  // the same name — a bracket exists and hasn't finished yet. Duplicated
  // here (rather than reaching into hub.js) since hub.js is out of scope
  // for this package and its helper isn't exposed on window.Game.
  function tournamentPending() {
    var d = window.Game.State.data;
    var t = d && (window.Game.State.tournamentStatus ? window.Game.State.tournamentStatus() : d.tournament);
    return !!(t && !t.done);
  }

  // §6 — coach attribution: name who's running practice so a self-filling
  // bar (L2/L3) never reads as a bug. coachFraming reuses Data.staffCoaches'
  // own scrimFraming copy where it fits; the fill behaviour itself is
  // summarized fresh here since scrimFraming doesn't mention the mechanic.
  var COACH_QUOTA_MESSAGE = {
    remind: function (coach) { return coach.name + ' — reminds you at bedtime if you\'re short. Does not fill the bar.'; },
    gradual: function (coach) { return coach.name + ' is running practice for you — fills gradually across the day, full by nightfall.'; },
    auto: function (coach) { return coach.name + ' is running practice for you — already full the moment you wake up.'; }
  };
  function renderQuotaCoachLine(qStatus) {
    if (!els.quotaCoach) return;
    var coach = window.Game.State.currentCoach && window.Game.State.currentCoach();
    var text;
    if (!coach) {
      text = 'NO COACH HIRED — scrim quota is on you alone.';
    } else {
      var fn = COACH_QUOTA_MESSAGE[qStatus.coachBehavior];
      text = fn ? fn(coach) : coach.name + ' is hired.';
    }
    els.quotaCoach.textContent = text;
  }

  // §6 — quota bar is its own render path, separate from the full render(),
  // so the interval below (started on career onEnter, stopped on onExit)
  // can cheaply re-paint just the bar/label/coach line every tick without
  // rebuilding the offers/team sections. Needed because effectiveScrimQuota()
  // derives the L2 'gradual' fill from wakeElapsedMs, which advances
  // continuously with NO 'change' event — a screen that only re-renders on
  // State changes (offer accepted, scrim played, etc.) will look frozen
  // even though the coach IS filling it.
  // SPEC-V14 §4.1/§5 — the crypto notification dot that used to toggle here
  // moved to the phone (js/phone.js, Package P2) along with the CRYPTO nav
  // button itself; this ticker's only remaining job is the scrim quota bar.
  function renderQuota() {
    var data = window.Game.State.data;
    if (!data || !els.quotaRow) return;
    if (data.contract === 'free') {
      els.quotaRow.style.display = 'none';
      if (els.quotaCoach) els.quotaCoach.style.display = 'none';
      return;
    }
    els.quotaRow.style.display = '';
    if (els.quotaCoach) els.quotaCoach.style.display = '';
    // NEVER read data.scrimsToday directly here — that's the raw player-only
    // counter. State.scrimQuotaStatus() folds in the hired coach's
    // contribution (effectiveScrimQuota() in js/state.js); reading the raw
    // field is the exact bug reported three times over.
    var qStatus = window.Game.State.scrimQuotaStatus();
    var quota = qStatus.quota;
    var pct = quota > 0 ? Math.min(100, (qStatus.progress / quota) * 100) : 100;
    els.quotaFill.style.width = pct + '%';
    els.quotaVal.textContent = Math.round(qStatus.progress) + ' / ' + quota;
    renderQuotaCoachLine(qStatus);
  }

  var quotaTickTimer = null;
  function startQuotaTicker() {
    stopQuotaTicker();
    quotaTickTimer = setInterval(renderQuota, 1000);
  }
  function stopQuotaTicker() {
    if (quotaTickTimer) { clearInterval(quotaTickTimer); quotaTickTimer = null; }
  }

  // SPEC-V14 §4.2 — the sponsorship panel that used to live here (SPEC-V8
  // A2) has moved wholesale to js/sponsors.js as its own phone-app screen.
  // See that file for buildHeldSponsorCard/buildSponsorOfferCard/
  // renderSponsors and the OBLIGATION_LABEL/OBLIGATION_HINT tables — moved
  // unchanged, not redesigned.

  function render() {
    var data = window.Game.State.data;
    if (!data) return;
    var currentDef = window.Game.Data.contracts[data.contract];

    if (els.tournamentsBadge) els.tournamentsBadge.classList.toggle('badge-dot--show', tournamentPending());

    els.contractName.textContent = currentDef.name;
    window.Game.UI.countUp(els.hypeVal, data.hype, { fmt: function (v) { return Math.round(v) + ' / 100'; } });
    els.hypeFill.style.width = data.hype + '%';
    window.Game.UI.countUp(els.chemVal, data.chemistry, { fmt: function (v) { return Math.round(v) + ' / 100'; } });
    els.chemFill.style.width = data.chemistry + '%';

    els.scrimBtn.style.display = data.contract === 'free' ? 'none' : '';
    renderQuota();

    // §12u — reputation band + what it currently gates, and surface the
    // change (toast) whenever the value has moved since it was last shown.
    var rep = window.Game.State.reputationStatus();
    if (rep) {
      var repColor = REP_BAND_COLOR[rep.band] || 'var(--ink-dim)';
      var repPct = Math.max(0, Math.min(100, ((rep.value + 100) / 200) * 100)); // -100..100 -> 0..100
      els.repFill.style.width = repPct + '%';
      els.repFill.style.background = repColor;
      els.repBand.textContent = rep.bandLabel + ' (' + (rep.value > 0 ? '+' : '') + Math.round(rep.value) + ')';
      els.repBand.style.color = repColor;
      els.repGating.textContent = rep.bandLabel + ' — ' + rep.gating;
      els.repGating.style.color = repColor;

      var lastRep = loadLastReputation();
      if (lastRep !== null && Math.round(lastRep) !== Math.round(rep.value)) {
        var repDiff = Math.round(rep.value - lastRep);
        if (repDiff !== 0) {
          window.Game.UI.toast('REPUTATION ' + (repDiff > 0 ? '+' : '') + repDiff + ' — NOW ' + rep.bandLabel, repDiff > 0 ? 'good' : 'bad');
        }
      }
      saveLastReputation(rep.value);
    }

    els.teamSection.innerHTML = '';
    els.offersSection.innerHTML = '';

    if (data.contract !== 'free') {
      els.teamSection.appendChild(buildMyTeamCard(data));
      return;
    }

    var extOffer = window.Game.State.contractExtensionOffer();
    if (extOffer) {
      els.offersSection.appendChild(buildExtensionCard(extOffer));
    }

    // §4 — offers now trickle in one at a time (random 2-5 day gap), max 3
    // open at once (was up to 2 landing instantly, cap 5) — the header and
    // sub-copy need to read naturally at every count from 1 to 3 and hint
    // that more are still coming while under the cap.
    var MAX_OPEN_OFFERS = 3;
    var offers = window.Game.State.offers();
    if (offers.length) {
      var offerHeaderTxt = offers.length + ' OFFER' + (offers.length === 1 ? '' : 'S') + ' OPEN  ·  ' + offers.length + ' / ' + MAX_OPEN_OFFERS;
      els.offersSection.appendChild(el('div', 'career__section-header', offerHeaderTxt));
      if (offers.length < MAX_OPEN_OFFERS) {
        els.offersSection.appendChild(el('div', 'career__section-sub', 'More offers trickle in every few days while you\'re a free agent, up to ' + MAX_OPEN_OFFERS + ' open at once.'));
      }
      offers.slice().sort(function (a, b) { return a.expiresAtDay - b.expiresAtDay; }).forEach(function (o) {
        var c = buildOfferCard(o, data);
        if (c) els.offersSection.appendChild(c);
      });
    } else if ((data.elo || 0) < window.Game.Data.eloFloorForTier(3)) {
      // §5 — strictly below the lowest tier's floor, State.offers()/
      // scoutBoard() aren't generating anything meaningful yet (scoutBoard
      // just returns the nearest-by-elo teams regardless of reachability,
      // which read as a broken/random unsignable list down here). Show a
      // deliberate empty state instead of a team list.
      els.offersSection.appendChild(buildOffersEmptyState(data));
    } else {
      els.offersSection.appendChild(el('div', 'career__section-header', 'NO OFFERS YET'));
      els.offersSection.appendChild(el('div', 'career__section-sub', 'Teams scout free agents who already meet their bar. Get close on ELO, hype, chemistry or win rate and an offer will land within a few days.'));
      var scout = window.Game.State.scoutBoard({ limit: 6 });
      scout.forEach(function (entry) {
        els.offersSection.appendChild(buildScoutCard(entry));
      });
    }
  }

  /* ---- §27u — promotion/relegation banner --------------------------------
     Package P's resolveNewDay() (js/state.js) surfaces a one-shot
     `res.tierChange` on State.wake()/endDay()/skipNightAd() (and via
     State.tickEnergy()'s `autoWoke` on the auto-wake-at-full-energy path)
     the moment a signed team's tier moves. The wake BUTTON/loop itself
     lives in js/hub.js (Package Q, out of scope here), and it already pops
     its own "GOOD MORNING" reward-card right after — calling
     UI.rewardCard again from here would just clobber that (the modal has
     no queue; the last call wins). So rather than touching hub.js, this
     wraps the shared State entry points to catch tierChange the instant it
     happens and renders an independent, non-modal banner straight onto
     document.body (see .promo-banner in css/teams.css) instead of reusing
     the reward-card modal. */
  var TIER_NAME = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' };

  function showTierChangeBanner(tc) {
    var old = document.getElementById('promo-banner');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var banner = el('div', 'promo-banner' + (tc.promoted ? ' promo-banner--up' : ' promo-banner--down'));
    banner.id = 'promo-banner';
    banner.appendChild(el('div', 'promo-banner__title', tc.promoted ? 'PROMOTED!' : 'RELEGATED'));
    banner.appendChild(el('div', 'promo-banner__sub',
      (TIER_NAME[tc.oldTier] || ('TIER ' + tc.oldTier)) + ' → ' + (TIER_NAME[tc.newTier] || ('TIER ' + tc.newTier)) +
      '  ·  RANK #' + tc.rank));
    var row = el('div', 'promo-banner__row');
    row.appendChild(el('span', 'promo-banner__salary-old', window.Game.UI.money(tc.oldSalary) + '/mo'));
    // the two salaries either side of this arrow carry no labels of their
    // own — the old one is distinguished only by a line-through and the new
    // one only by colour, neither of which a screen reader reliably speaks.
    // So this arrow, unlike the labelled .ext-compare one, keeps a word.
    var arrow = iconEl('span', 'promo-banner__arrow', ICON_ARROW_RIGHT);
    arrow.appendChild(el('span', 'sr-only', ' becomes '));
    row.appendChild(arrow);
    row.appendChild(el('span', 'promo-banner__salary-new', window.Game.UI.money(tc.newSalary) + '/mo'));
    banner.appendChild(row);
    var closeBtn = el('button', 'promo-banner__close', 'GOT IT');
    banner.appendChild(closeBtn);

    function dismiss() {
      banner.classList.remove('promo-banner--in');
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 250);
    }
    closeBtn.addEventListener('click', dismiss);
    document.body.appendChild(banner);
    requestAnimationFrame(function () { banner.classList.add('promo-banner--in'); });
    setTimeout(dismiss, 7000);
  }

  function installTierChangeHook() {
    var S = window.Game.State;
    if (!S || S.__careerTierHookInstalled) return;
    S.__careerTierHookInstalled = true;

    function reactToSummary(summary) {
      if (summary && summary.tierChange) showTierChangeBanner(summary.tierChange);
    }

    // NOTE: wake()/skipNightAd() return { ok, ...summary }, but the legacy
    // endDay() alias returns the summary object directly with NO `ok` field
    // at all — so gating on res.ok here would silently skip endDay() every
    // time. reactToSummary() already no-ops safely when tierChange is
    // absent (e.g. a failed wake with reason:'min-sleep'), so no ok-check
    // is needed here.
    ['wake', 'endDay', 'skipNightAd'].forEach(function (name) {
      var orig = S[name];
      if (typeof orig !== 'function') return;
      S[name] = function () {
        var res = orig.apply(S, arguments);
        reactToSummary(res);
        return res;
      };
    });

    var origTick = S.tickEnergy;
    if (typeof origTick === 'function') {
      S.tickEnergy = function () {
        var res = origTick.apply(S, arguments);
        if (res && res.autoWoke) reactToSummary(res.autoWoke);
        return res;
      };
    }
  }

  window.Game = window.Game || {};
  window.Game.Router = window.Game.Router || {};
  window.Game.Router.register('career', {
    onEnter: function () {
      if (!built) buildDom();
      render();
      startQuotaTicker();
    },
    onExit: function () {
      stopQuotaTicker();
    }
  });

  installTierChangeHook();

  window.Game.Career = {};
})();
