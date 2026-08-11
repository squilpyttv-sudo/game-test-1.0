/* ==========================================================================
   CS2 PRO SIMULATOR — js/title.js
   Game.Title — front page / save-slot browser / settings.

   Renders into the existing #title-layer (see index.html). Covers the full
   app viewport while shown (CSS in css/title.css), so nothing underneath
   (topbar / screen-stack / bottomnav / toasts / modals) needs to be hidden
   or altered — it simply sits on top until the player picks a save.

   Public API (consumed by js/main.js):
     Game.Title.show({ onEnterGame: fn })  — render + display the title screen.
                                              fn() is called once a slot has
                                              been loaded/created and the
                                              title screen has hidden itself.
     Game.Title.hide()                     — hide the title screen.
     Game.Title.buildSettingsPanel(host, opts)
                                            — shared settings UI, reused by
                                              js/main.js for the in-game
                                              settings modal. opts:
                                                onClose(): required
                                                onBackToTitle(): optional —
                                                  when provided a "TITLE
                                                  SCREEN" button is shown
                                                confirmFn(opts): required —
                                                  {title,text,color,yesText,
                                                  noText,onYes,onNo}
   ========================================================================== */
(function (G) {
  'use strict';

  G.Title = G.Title || {};

  var rootEl = null;
  var starCanvas = null;
  var contentEl = null;
  var view = 'main';          // 'main' | 'saves' | 'settings' | 'deadstats'
  var enterCb = function () {};
  var gestureBound = false;
  var visible = false;

  /* ---- tiny DOM helper ---------------------------------------------------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- icons
     Authored SVG only (ART-DIRECTION §2.5) — 24x24 viewBox, 2px stroke,
     currentColor, the house set js/phone.js established. No emoji, no
     Unicode glyph doing icon duty anywhere in this file.

     Stroke is 2.6 rather than 2 because .title-back is 10px type and the
     icon renders at 11px: 2/24 of 11px is 0.9 device pixels, thinner than
     the 700-weight label beside it. 2.6 lands at ~1.2 and matches the same
     compensation js/phone.js already makes on its 13px chevrons. Sized by
     attribute — .title-back's rules live in css/title.css, not owned here.

     aria-hidden with no accessible name: the button's own label is the word
     BACK, immediately to the right. Naming the chevron too would make every
     one of these three buttons announce "back back". */
  var ICON_ARROW_LEFT =
    '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path d="M20.5 12h-16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M10.6 5.8L4.2 12l6.4 6.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  /* The saves browser, the settings view and the dead-career stats view each
     built their own '← BACK' string. One helper now owns the icon, the
     label and the handler for all three, so the arrow exists once. */
  function backButton(onClick) {
    var b = el('button', 'btn icon-inline title-back');
    b.innerHTML = ICON_ARROW_LEFT;
    b.appendChild(document.createTextNode('BACK'));
    b.addEventListener('click', onClick);
    return b;
  }

  function fmtPlaytime(ms) {
    ms = ms || 0;
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) return h + 'H ' + m + 'M';
    return m + 'M';
  }

  /* ---- starfield background ------------------------------------------------ */
  var stars = [];
  var starRaf = null;
  var starColor = null;
  function getStarColor() {
    if (starColor) return starColor;
    try {
      starColor = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#eaf0ff';
    } catch (e) { starColor = '#eaf0ff'; }
    return starColor;
  }
  function initStars(canvas) {
    var w = canvas.width, h = canvas.height;
    stars = [];
    var count = Math.round((w * h) / 2200);
    for (var i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() < 0.15 ? 2 : 1,
        speed: 6 + Math.random() * 18,
        phase: Math.random() * Math.PI * 2,
        twSpeed: 0.6 + Math.random() * 1.6
      });
    }
  }
  function resizeStarCanvas() {
    if (!starCanvas || !rootEl) return;
    var rect = rootEl.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (starCanvas.width !== w || starCanvas.height !== h) {
      starCanvas.width = w;
      starCanvas.height = h;
      initStars(starCanvas);
    }
  }
  var lastStarTs = 0;
  function drawStars(ts) {
    if (!visible) { starRaf = null; return; }
    if (!lastStarTs) lastStarTs = ts;
    var dt = Math.min(0.05, (ts - lastStarTs) / 1000);
    lastStarTs = ts;
    var ctx = starCanvas.getContext('2d');
    var w = starCanvas.width, h = starCanvas.height;
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += s.speed * dt;
      if (s.y > h) { s.y = -2; s.x = Math.random() * w; }
      s.phase += s.twSpeed * dt;
      var a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = getStarColor();
      ctx.fillRect(s.x | 0, s.y | 0, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    starRaf = requestAnimationFrame(drawStars);
  }
  function startStarfield() {
    resizeStarCanvas();
    lastStarTs = 0;
    if (!starRaf) starRaf = requestAnimationFrame(drawStars);
  }
  function stopStarfield() {
    if (starRaf) { cancelAnimationFrame(starRaf); starRaf = null; }
  }

  /* ---- first-gesture audio kick-off ---------------------------------------- */
  function bindFirstGesture() {
    if (gestureBound || !rootEl) return;
    gestureBound = true;
    var kick = function () {
      if (G.Audio && typeof G.Audio.start === 'function') G.Audio.start();
    };
    rootEl.addEventListener('pointerdown', kick, { once: true });
    rootEl.addEventListener('keydown', kick, { once: true });
  }

  /* ---- lightweight overlay dialogs (self-contained — title screen sits
     above #modal-layer, so it cannot rely on Game.UI's modal chrome) -------- */
  function showOverlay(builder) {
    var back = el('div', 'title-overlay');
    var card = el('div', 'title-overlay__card panel');
    builder(card, close);
    back.appendChild(card);
    rootEl.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('title-overlay--in'); });
    function close() {
      if (back.parentNode) back.parentNode.removeChild(back);
    }
    return close;
  }

  function confirmDialog(opts) {
    opts = opts || {};
    showOverlay(function (card, close) {
      card.appendChild(el('div', 'reward-card__title', opts.title || 'ARE YOU SURE?'));
      if (opts.text) card.appendChild(el('div', 'confirm-card__text', opts.text));
      var actions = el('div', 'confirm-card__actions');
      var no = el('button', 'btn', opts.noText || 'CANCEL');
      no.addEventListener('click', function () { close(); if (opts.onNo) opts.onNo(); });
      var yes = el('button', 'btn btn--danger', opts.yesText || 'CONFIRM');
      yes.addEventListener('click', function () { close(); if (opts.onYes) opts.onYes(); });
      actions.appendChild(no);
      actions.appendChild(yes);
      card.appendChild(actions);
    });
  }

  function promptDialog(opts) {
    opts = opts || {};
    showOverlay(function (card, close) {
      card.appendChild(el('div', 'reward-card__title', opts.title || 'NAME'));
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'title-input';
      input.maxLength = 18;
      input.value = opts.defaultValue || '';
      input.placeholder = opts.placeholder || '';
      card.appendChild(input);
      var actions = el('div', 'confirm-card__actions');
      var cancel = el('button', 'btn', 'CANCEL');
      cancel.addEventListener('click', function () { close(); if (opts.onCancel) opts.onCancel(); });
      var ok = el('button', 'btn btn--primary', opts.confirmText || 'CONFIRM');
      function submit() {
        var v = input.value.trim();
        if (!v) { input.classList.add('title-input--err'); return; }
        close();
        if (opts.onConfirm) opts.onConfirm(v);
      }
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submit();
      });
      actions.appendChild(cancel);
      actions.appendChild(ok);
      card.appendChild(actions);
      requestAnimationFrame(function () { input.focus(); });
    });
  }

  /* ---- render: main menu ---------------------------------------------------- */
  function renderMain() {
    contentEl.innerHTML = '';
    var wrap = el('div', 'title-main');

    var logo = el('div', 'title-logo');
    var l1 = el('div', 'title-logo__line1', 'CS2 PRO');
    var l2 = el('div', 'title-logo__line2', 'SIMULATOR');
    logo.appendChild(l1);
    logo.appendChild(l2);
    wrap.appendChild(logo);
    wrap.appendChild(el('div', 'title-tagline', 'GRIND. STREAM. GO PRO.'));

    var btns = el('div', 'title-buttons');

    var slots = G.State.listSlots();
    // CONTINUE must skip dead saves (SPEC-V3 §5) — State.continueSlot() is
    // the most-recently-played slot that is NOT dead (-1 if none), unlike
    // State.lastSlot()/activeSlot() which just report the raw active index
    // regardless of death.
    var continueIdx = G.State.continueSlot();
    var continueInfo = continueIdx >= 0 ? slots[continueIdx] : null;

    if (continueInfo && continueInfo.exists) {
      var cont = el('button', 'btn btn--title btn--title-primary');
      cont.textContent = 'CONTINUE — ' + continueInfo.name;
      cont.addEventListener('click', function () { enterSlot(continueIdx); });
      btns.appendChild(cont);
    }

    var savesBtn = el('button', 'btn btn--title', 'SAVES');
    savesBtn.addEventListener('click', function () { view = 'saves'; renderView(); });
    btns.appendChild(savesBtn);

    var settingsBtn = el('button', 'btn btn--title', 'SETTINGS');
    settingsBtn.addEventListener('click', function () { view = 'settings'; renderView(); });
    btns.appendChild(settingsBtn);

    wrap.appendChild(btns);
    contentEl.appendChild(wrap);
  }

  /* ---- render: saves browser ------------------------------------------------ */
  function renderSaves() {
    contentEl.innerHTML = '';
    var wrap = el('div', 'title-view');

    var head = el('div', 'title-view__head');
    head.appendChild(backButton(function () { view = 'main'; renderView(); }));
    head.appendChild(el('div', 'title-view__title', 'SAVE SLOTS'));
    wrap.appendChild(head);

    var list = el('div', 'title-slot-list');
    var slots = G.State.listSlots();
    slots.forEach(function (s) {
      list.appendChild(buildSlotCard(s));
    });
    wrap.appendChild(list);
    contentEl.appendChild(wrap);
  }

  function buildSlotCard(s) {
    // V18 (lead): the dead-save modifier goes on the CARD, not only on the
    // chip. `.title-slot-card--dead` has existed in css/title.css since it was
    // authored but nothing ever added it here, so that whole treatment has
    // never once rendered in the browser — a dead career looked like a live
    // one apart from its chip. Found during the V18 sweep, which had to reach
    // it via `:has(.title-slot-card__chip--dead)`; with this line that
    // fallback selector is no longer load-bearing.
    var card = el('div', 'panel title-slot-card' + (s.dead ? ' title-slot-card--dead' : ''));
    if (!s.exists) {
      card.classList.add('title-slot-card--empty');
      card.appendChild(el('div', 'title-slot-card__empty-label', 'EMPTY — NEW CAREER'));
      var newBtn = el('button', 'btn btn--title-primary', 'START CAREER');
      newBtn.addEventListener('click', function () {
        promptDialog({
          title: 'NAME YOUR CAREER',
          placeholder: 'PLAYER NAME',
          confirmText: 'START',
          onConfirm: function (name) {
            G.State.createSlot(s.index, name.toUpperCase());
            beginGame();
          }
        });
      });
      card.appendChild(newBtn);
      return card;
    }

    var head = el('div', 'title-slot-card__head');
    head.appendChild(el('div', 'title-slot-card__name', s.name));
    var chip = el('span', 'rank-chip title-slot-card__chip' + (s.dead ? ' title-slot-card__chip--dead' : ''), s.dead ? 'CAREER LOST' : s.rankName);
    // Both branches paint a SATURATED fill, so both take the dark label —
    // that is the project's brightness strategy (tokens.css): light lives in
    // a bounded outlined shape carrying dark text, never as glowing type.
    //
    // The dead branch used to set --ink (near-white) on the --danger fill,
    // which measured 2.6:1 at 9.5px — under the 4.5:1 floor. css/title.css
    // was forced to override it with `!important`, the only way CSS beats an
    // inline style; fixing it here means that override can go.
    //
    // The live branch used a raw hex. JS may carry literals, but a token
    // already existed for exactly this value, and a hardcoded copy drifts the
    // moment the palette moves.
    if (s.dead) {
      chip.style.background = 'var(--danger)';
      chip.style.color = 'var(--ink-on-fill)';
    } else {
      chip.style.background = s.rankColor;
      chip.style.color = 'var(--ink-on-fill)';
    }
    head.appendChild(chip);
    card.appendChild(head);

    // A dead save (SPEC-V3 §5 — REPLACES V2 eviction) is view-only: no PLAY,
    // no RENAME — just VIEW STATS (read-only, via js/stats.js's shared
    // renderer) and DELETE. It must never be loadable into play.
    if (s.dead) {
      if (s.deadReason) card.appendChild(el('div', 'title-slot-card__deadreason', s.deadReason));
      var deadStats = el('div', 'title-slot-card__stats');
      deadStats.appendChild(el('span', null, 'DAY ' + s.day));
      deadStats.appendChild(el('span', null, '$' + Math.round(s.cash)));
      deadStats.appendChild(el('span', null, fmtPlaytime(s.playtimeMs)));
      card.appendChild(deadStats);

      var deadActions = el('div', 'title-slot-card__actions');
      var viewStatsBtn = el('button', 'btn btn--title-primary', 'VIEW STATS');
      viewStatsBtn.addEventListener('click', function () { viewDeadStats(s.index); });
      var deadDeleteBtn = el('button', 'btn btn--danger', 'DELETE');
      deadDeleteBtn.addEventListener('click', function () {
        confirmDialog({
          title: 'DELETE SAVE?',
          text: 'This permanently deletes "' + s.name + '". This cannot be undone.',
          yesText: 'DELETE',
          noText: 'CANCEL',
          onYes: function () {
            G.State.deleteSlot(s.index);
            renderView();
          }
        });
      });
      deadActions.appendChild(viewStatsBtn);
      deadActions.appendChild(deadDeleteBtn);
      card.appendChild(deadActions);
      return card;
    }

    var stats = el('div', 'title-slot-card__stats');
    stats.appendChild(el('span', null, 'DAY ' + s.day));
    stats.appendChild(el('span', null, '$' + Math.round(s.cash)));
    stats.appendChild(el('span', null, fmtPlaytime(s.playtimeMs)));
    card.appendChild(stats);

    var actions = el('div', 'title-slot-card__actions');
    var playBtn = el('button', 'btn btn--title-primary', 'PLAY');
    playBtn.addEventListener('click', function () { enterSlot(s.index); });
    var renameBtn = el('button', 'btn', 'RENAME');
    renameBtn.addEventListener('click', function () {
      promptDialog({
        title: 'RENAME CAREER',
        defaultValue: s.name,
        confirmText: 'SAVE',
        onConfirm: function (name) {
          G.State.renameSlot(s.index, name.toUpperCase());
          renderView();
        }
      });
    });
    var deleteBtn = el('button', 'btn btn--danger', 'DELETE');
    deleteBtn.addEventListener('click', function () {
      confirmDialog({
        title: 'DELETE SAVE?',
        text: 'This permanently deletes "' + s.name + '". This cannot be undone.',
        yesText: 'DELETE',
        noText: 'CANCEL',
        onYes: function () {
          G.State.deleteSlot(s.index);
          renderView();
        }
      });
    });
    actions.appendChild(playBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
    return card;
  }

  /* ---- SPEC-V3 §5: read-only "VIEW STATS" for a dead save ------------------
     Loads the dead slot's full data into State.data (safe — every mutating
     action is guarded dead-safe by Package F) purely so State.statsSummary()
     can compute it, then renders it with js/stats.js's shared renderer
     WITHOUT ever leaving the title screen (no Router/hub involved) — the
     player views final stats and can only go back to the save list or
     delete it, never into play. */
  function viewDeadStats(index) {
    G.State.loadSlot(index);
    view = 'deadstats';
    renderView();
  }

  function renderDeadStats() {
    contentEl.innerHTML = '';
    var wrap = el('div', 'title-view');

    var head = el('div', 'title-view__head');
    head.appendChild(backButton(function () { view = 'saves'; renderView(); }));
    head.appendChild(el('div', 'title-view__title', 'CAREER LOST — FINAL STATS'));
    wrap.appendChild(head);

    var body = el('div', 'title-stats-body');
    wrap.appendChild(body);
    contentEl.appendChild(wrap);

    if (G.Stats && typeof G.Stats.renderInto === 'function' && G.State.data) {
      G.Stats.renderInto(body, G.State.statsSummary());
    }
  }

  /* ---- render: settings ------------------------------------------------------ */
  function renderSettings() {
    contentEl.innerHTML = '';
    var wrap = el('div', 'title-view');

    var head = el('div', 'title-view__head');
    head.appendChild(backButton(function () { view = 'main'; renderView(); }));
    head.appendChild(el('div', 'title-view__title', 'SETTINGS'));
    wrap.appendChild(head);

    var panelHost = el('div', 'panel title-settings-host');
    wrap.appendChild(panelHost);
    contentEl.appendChild(wrap);

    G.Title.buildSettingsPanel(panelHost, {
      onClose: function () { view = 'main'; renderView(); },
      onBackToTitle: null,
      confirmFn: confirmDialog
    });
  }

  /* ---- shared settings panel builder (also used by js/main.js in-game) ------ */
  G.Title.buildSettingsPanel = function (host, opts) {
    opts = opts || {};
    host.innerHTML = '';

    var musicRow = el('div', 'title-setting-row');
    musicRow.appendChild(el('div', 'title-setting-row__label', 'MUSIC VOLUME'));
    var musicSlider = document.createElement('input');
    musicSlider.type = 'range';
    musicSlider.min = 0; musicSlider.max = 100; musicSlider.className = 'title-slider';
    musicSlider.value = (G.Audio && G.Audio.musicVolume) ? G.Audio.musicVolume() : 30;
    var musicVal = el('span', 'title-setting-row__val', musicSlider.value);
    musicSlider.addEventListener('input', function () {
      musicVal.textContent = musicSlider.value;
      if (G.Audio && G.Audio.setMusicVolume) G.Audio.setMusicVolume(musicSlider.value);
    });
    var musicWrap = el('div', 'title-setting-row__control');
    musicWrap.appendChild(musicSlider);
    musicWrap.appendChild(musicVal);
    musicRow.appendChild(musicWrap);
    host.appendChild(musicRow);

    var soundRow = el('div', 'title-setting-row');
    soundRow.appendChild(el('div', 'title-setting-row__label', 'SOUND VOLUME'));
    var soundSlider = document.createElement('input');
    soundSlider.type = 'range';
    soundSlider.min = 0; soundSlider.max = 100; soundSlider.className = 'title-slider';
    soundSlider.value = (G.Audio && G.Audio.soundVolume) ? G.Audio.soundVolume() : 70;
    var soundVal = el('span', 'title-setting-row__val', soundSlider.value);
    soundSlider.addEventListener('input', function () {
      soundVal.textContent = soundSlider.value;
      if (G.Audio && G.Audio.setSoundVolume) G.Audio.setSoundVolume(soundSlider.value);
      if (G.UI && G.UI.beep) G.UI.beep('click');
    });
    var soundWrap = el('div', 'title-setting-row__control');
    soundWrap.appendChild(soundSlider);
    soundWrap.appendChild(soundVal);
    soundRow.appendChild(soundWrap);
    host.appendChild(soundRow);

    var actions = el('div', 'title-settings-actions');

    var tutorialBtn = el('button', 'btn', 'REPLAY TUTORIAL');
    tutorialBtn.addEventListener('click', function () {
      if (G.Tutorial && typeof G.Tutorial.start === 'function') {
        G.Tutorial.start();
        if (opts.onClose) opts.onClose();
      } else {
        if (G.UI && G.UI.toast) G.UI.toast('TUTORIAL IS STILL WARMING UP', 'info');
      }
    });
    actions.appendChild(tutorialBtn);

    if (opts.onBackToTitle) {
      var titleBtn = el('button', 'btn', 'TITLE SCREEN');
      titleBtn.addEventListener('click', function () { opts.onBackToTitle(); });
      actions.appendChild(titleBtn);
    }

    var resetBtn = el('button', 'btn btn--danger', 'RESET ALL SAVES');
    resetBtn.addEventListener('click', function () {
      var confirmFn = opts.confirmFn || (G.UI && G.UI.confirmModal);
      if (!confirmFn) return;
      confirmFn({
        title: 'RESET ALL SAVES?',
        text: 'This permanently deletes all 3 save slots. This cannot be undone.',
        color: 'var(--danger)',
        yesText: 'DELETE ALL',
        noText: 'CANCEL',
        onYes: function () {
          for (var i = 0; i < 3; i++) G.State.deleteSlot(i);
          if (G.UI && G.UI.toast) G.UI.toast('ALL SAVES RESET', 'info');
          if (opts.onBackToTitle) opts.onBackToTitle();
          else if (opts.onClose) opts.onClose();
        }
      });
    });
    actions.appendChild(resetBtn);

    var closeBtn = el('button', 'btn btn--primary', 'CLOSE');
    closeBtn.addEventListener('click', function () { if (opts.onClose) opts.onClose(); });
    actions.appendChild(closeBtn);

    host.appendChild(actions);
  };

  /* ---- flow control ----------------------------------------------------------- */
  function renderView() {
    if (view === 'saves') renderSaves();
    else if (view === 'settings') renderSettings();
    else if (view === 'deadstats') renderDeadStats();
    else renderMain();
  }

  function enterSlot(index) {
    G.State.loadSlot(index);
    beginGame();
  }

  function beginGame() {
    if (G.Audio && typeof G.Audio.start === 'function') G.Audio.start();
    G.Title.hide();
    enterCb();
  }

  /* ---- public API --------------------------------------------------------------- */
  G.Title.ready = true;

  G.Title.show = function (opts) {
    opts = opts || {};
    enterCb = typeof opts.onEnterGame === 'function' ? opts.onEnterGame : function () {};
    rootEl = document.getElementById('title-layer');
    if (!rootEl) return;
    if (!starCanvas) {
      rootEl.innerHTML = '';
      starCanvas = document.createElement('canvas');
      starCanvas.className = 'title-starfield';
      rootEl.appendChild(starCanvas);
      contentEl = document.createElement('div');
      contentEl.className = 'title-content';
      rootEl.appendChild(contentEl);
      window.addEventListener('resize', resizeStarCanvas);
    }
    view = 'main';
    rootEl.style.display = 'flex';
    visible = true;
    bindFirstGesture();
    startStarfield();
    renderView();
  };

  G.Title.hide = function () {
    if (!rootEl) return;
    rootEl.style.display = 'none';
    visible = false;
    stopStarfield();
  };

})(window.Game = window.Game || {});
