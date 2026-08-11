/* ==========================================================================
   CS2 PRO SIMULATOR — js/teams.js
   Game.Teams — the 100-team leaderboard (SPEC-V4 §5a/§5d) and the shared
   team-logo chip reused by career.js (offer cards) and tournaments.js
   (bracket rows). PURE RENDERER over Game.State.leaderboard()/myTeam() — no
   economy math happens here.

   NOTE (scope reduction from the lead): real procedurally-drawn canvas
   logos were cut for this round — teams keep their `colors`/`letterform`/
   `badgeStyle` fields untouched in the data so a real renderer can drop in
   later without a save migration, but Game.Teams.renderLogo() below is
   just a small coloured CSS chip with the letterform on top.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};

  var TIER_COLOR = { 1: 'var(--gold)', 2: 'var(--views)', 3: 'var(--cash)' };
  var TIER_LABEL = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' };
  var TRAJ_COLOR = { rising: 'var(--cash)', stable: 'var(--views)', declining: 'var(--danger)' };

  // §24 — leaderboard-only trajectory icons (fire = rising, snowflake =
  // declining, nothing = stable). Offer cards elsewhere keep the plain-
  // language traj-banner untouched; this SVG swap is for lb-row only.
  var TRAJ_ICON_SVG = {
    rising: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2c1.2 3.6-2.4 5-2.4 8.2a2.4 2.4 0 004.8 0c0-.9-.4-1.7-.9-2.5 1.7 1.1 3.3 3.1 3.3 5.9a4.8 4.8 0 01-9.6 0c0-4.4 3.4-6.6 4.8-11.6z"/></svg>',
    declining: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="5" y1="7" x2="19" y2="17"/><line x1="19" y1="7" x2="5" y2="17"/></svg>'
  };
  var TRAJ_ICON_CLASS = { rising: 'lb-row__traj-icon--rising', declining: 'lb-row__traj-icon--declining' };

  // §24 — recent rank movement (green up / red down + places moved). No
  // Package P API tracks per-team rank history, so this file snapshots
  // ranks itself (localStorage) each time the leaderboard is opened and
  // diffs against the previous snapshot — "recent" = since the last visit.
  var RANK_SNAPSHOT_KEY = 'cs2sim_lb_rank_snapshot_v1';
  function loadRankSnapshot() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(RANK_SNAPSHOT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveRankSnapshot(snap) {
    try { window.localStorage && window.localStorage.setItem(RANK_SNAPSHOT_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---- shared logo chip ----------------------------------------------------
     team = { colors:[bg,fg?], letterform, name } — tolerant of the legacy
     fallback team (js/state.js's myTeamOrFallback) and the bracket's "YOU"
     field entry, neither of which carry real colours. */
  function renderLogo(team, size) {
    var chip = el('div', 'team-logo' + (size ? ' team-logo--' + size : ''));
    var colors = (team && team.colors) || ['#5a6494', '#1b2140'];
    var letter = (team && (team.letterform || (team.name || '?').charAt(0))) || '?';
    chip.style.background = colors[0] || '#5a6494';
    chip.style.color = colors[1] || '#111111';
    chip.style.borderColor = colors[1] || 'var(--border)';
    chip.textContent = letter;
    return chip;
  }
  G.Teams = G.Teams || {};
  G.Teams.renderLogo = renderLogo;
  // §5/§8 — career.js's offer/scout cards reuse the same fire/snowflake
  // trajectory icon as the leaderboard rows instead of a text pill.
  G.Teams.trajIcon = trajIcon;

  // trajIcon: fire (rising) / snowflake (declining) / null (stable) — §24.
  function trajIcon(trajectory) {
    var svg = TRAJ_ICON_SVG[trajectory];
    if (!svg) return null;
    var icon = el('span', 'lb-row__traj-icon ' + (TRAJ_ICON_CLASS[trajectory] || ''));
    icon.innerHTML = svg;
    icon.title = trajectory === 'rising' ? 'RISING' : 'DECLINING';
    return icon;
  }

  // rankMoveBadge: green up-arrow + places gained, or red down-arrow +
  // places lost, since the last time this screen was opened. null when
  // there's no prior snapshot yet or rank hasn't moved.
  function rankMoveBadge(prevRank, team) {
    if (prevRank == null) return null;
    var delta = prevRank - team.rank; // positive = climbed (rank number went down)
    if (!delta) return null;
    var up = delta > 0;
    var arrowSvg = up
      ? '<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M12 4l8 11H4z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M12 20L4 9h16z"/></svg>';
    var badge = el('span', 'lb-row__rank-move ' + (up ? 'lb-row__rank-move--up' : 'lb-row__rank-move--down'));
    badge.innerHTML = arrowSvg + '<span>' + Math.abs(delta) + '</span>';
    return badge;
  }

  function buildRow(team, myId, prevSnap) {
    var isMe = !!myId && team.id === myId;
    var row = el('div', 'lb-row panel' + (isMe ? ' lb-row--me' : ''));
    row.id = 'lb-row-' + team.id;
    row.style.setProperty('--lb-accent', TIER_COLOR[team.tier] || 'var(--ink-dim)');

    var rankWrap = el('div', 'lb-row__rank-wrap');
    rankWrap.appendChild(el('div', 'lb-row__rank', '#' + team.rank));
    var move = rankMoveBadge(prevSnap[team.id], team);
    if (move) rankWrap.appendChild(move);
    row.appendChild(rankWrap);

    row.appendChild(renderLogo(team, 'sm'));

    var mid = el('div', 'lb-row__mid');
    var nameLine = el('div', 'lb-row__name-line');
    nameLine.appendChild(el('span', 'lb-row__name', team.name));
    if (isMe) nameLine.appendChild(el('span', 'lb-row__you', 'YOU'));
    var icon = trajIcon(team.trajectory);
    if (icon) nameLine.appendChild(icon);
    mid.appendChild(nameLine);
    row.appendChild(mid);

    var stats = el('div', 'lb-row__stats');
    stats.appendChild(el('div', 'lb-row__stat', 'STR ' + Math.round(team.strength)));
    stats.appendChild(el('div', 'lb-row__stat lb-row__stat--pts', team.points + ' PTS'));
    row.appendChild(stats);

    row.addEventListener('click', function () { showTeamDetail(team, isMe); });
    return row;
  }

  function showTeamDetail(team, isMe) {
    var req = team.requirements || {};
    var lines = [
      { label: 'TIER', value: TIER_LABEL[team.tier], color: TIER_COLOR[team.tier] },
      { label: 'STRENGTH', value: Math.round(team.strength) },
      { label: 'POINTS', value: team.points },
      { label: 'TRAJECTORY', value: (G.Data.trajectoryTags || {})[team.trajectory] || team.trajectory, color: TRAJ_COLOR[team.trajectory] },
      { label: 'SALARY', value: G.UI.money(team.salary) + '/mo', color: 'var(--cash)' }
    ];
    if (req.elo) lines.push({ label: 'REQUIRES', value: req.elo + '+ ELO' });
    G.UI.rewardCard({
      title: team.name,
      subtitle: isMe ? 'YOUR TEAM — RANK #' + team.rank : 'RANK #' + team.rank,
      color: TIER_COLOR[team.tier],
      lines: lines,
      buttonText: 'CLOSE'
    });
  }

  function buildDom() {
    var root = G.Router.root('teams');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">TEAMS</span><button class="btn screen-header__back" id="teams-back">BACK</button></div>' +
      '<div class="lb-toolbar">' +
        '<div class="lb-legend">' +
          '<span class="lb-legend__item" style="color:' + TIER_COLOR[1] + '">T1 1-20</span>' +
          '<span class="lb-legend__item" style="color:' + TIER_COLOR[2] + '">T2 21-50</span>' +
          '<span class="lb-legend__item" style="color:' + TIER_COLOR[3] + '">T3 51-100</span>' +
        '</div>' +
        '<button class="btn btn--primary" id="teams-jump">JUMP TO MY TEAM</button>' +
      '</div>' +
      '<div class="lb-list" id="teams-list"></div>';

    els.list = document.getElementById('teams-list');
    els.jumpBtn = document.getElementById('teams-jump');

    document.getElementById('teams-back').addEventListener('click', function () {
      G.UI.beep('click');
      // §20 — only career.js ever routes here, so BACK should return to
      // CAREER, not fall through to Router.back()'s hard-coded hub.
      G.Router.go('career');
    });
    els.jumpBtn.addEventListener('click', jumpToMyTeam);
    built = true;
  }

  function jumpToMyTeam() {
    var mine = G.State.myTeam();
    if (!mine || !mine.id) {
      G.UI.beep('miss');
      G.UI.toast('NOT SIGNED TO A TRACKED TEAM YET', 'info');
      return;
    }
    var row = document.getElementById('lb-row-' + mine.id);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('lb-row--flash');
    setTimeout(function () { row.classList.remove('lb-row--flash'); }, 1200);
    G.UI.beep('click');
  }

  function render() {
    if (!G.State.data) return;
    var teams = G.State.leaderboard();
    var mine = G.State.myTeam();
    var myId = mine ? mine.id : null;

    els.list.innerHTML = '';
    var prevSnap = loadRankSnapshot();
    var newSnap = {};
    var frag = document.createDocumentFragment();
    var bands = [
      { tier: 1, label: 'TIER 1 — ELITE (1-20)' },
      { tier: 2, label: 'TIER 2 (21-50)' },
      { tier: 3, label: 'TIER 3 (51-100)' }
    ];
    bands.forEach(function (band) {
      var header = el('div', 'lb-tier-header', band.label);
      header.style.color = TIER_COLOR[band.tier];
      header.style.borderColor = TIER_COLOR[band.tier];
      frag.appendChild(header);
      teams.filter(function (t) { return t.tier === band.tier; })
        .forEach(function (t) {
          newSnap[t.id] = t.rank;
          frag.appendChild(buildRow(t, myId, prevSnap));
        });
    });
    els.list.appendChild(frag);
    saveRankSnapshot(newSnap);
  }

  G.Router = G.Router || {};
  G.Router.register('teams', {
    onEnter: function () {
      if (!built) buildDom();
      render();
    },
    onExit: function () {}
  });

  G.Teams.ready = true;
})(window.Game = window.Game || {});
