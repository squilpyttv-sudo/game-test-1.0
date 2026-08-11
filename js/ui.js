/* ==========================================================================
   CS2 PRO SIMULATOR — js/ui.js
   Toasts, number formatting, WebAudio SFX, confetti, reward modal.
   ========================================================================== */
(function () {
  'use strict';

  var UI = {};

  /* ---- number formatting --------------------------------------------------- */
  function compact(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    var neg = n < 0; n = Math.abs(n);
    var units = [{ v: 1e9, s: 'b' }, { v: 1e6, s: 'm' }, { v: 1e3, s: 'k' }];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i].v) {
        var s = (n / units[i].v).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        return (neg ? '-' : '') + s + units[i].s;
      }
    }
    if (Number.isInteger(n)) return (neg ? '-' : '') + n.toString();
    var s2 = n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return (neg ? '-' : '') + s2;
  }
  UI.compact = compact;
  UI.money = function (n) { return '$' + compact(n); };

  /* ---- count-up animation (used everywhere a number changes) --------------
     A single element can have countUp() called on it repeatedly in quick
     succession (e.g. the top-bar cash readout is refreshed on a 250ms
     interval while the animation itself runs ~450ms). Each element tracks
     its own in-flight rAF handle (el.__cuRaf) so a new call always cancels
     any prior animation before starting — never two animations racing on
     the same node. The value shown on screen is also written to data-num
     on every single tick (not just at the start/end), so if a new call
     interrupts mid-flight, the next animation's "from" is the value the
     player actually saw last frame, never a stale earlier number. Without
     that, restarting from the old fixed start point produced a visible
     backward/forward jitter (e.g. $65.90 <-> $66.27) whenever refresh()
     fired before the previous animation had finished. */
  UI.countUp = function (el, toValue, opts) {
    if (!el) return;
    opts = opts || {};
    var fmt = opts.fmt || function (v) { return Math.round(v).toString(); };
    var dur = opts.duration || 450;
    var fromValue = opts.from;
    if (fromValue === undefined) {
      var stored = parseFloat(el.getAttribute('data-num'));
      fromValue = isNaN(stored) ? toValue : stored;
    }
    // Cancel any in-flight count-up on this element before starting a new
    // one — this is the fix: without it, two rAF loops write textContent
    // for the same node on alternating frames.
    if (el.__cuRaf) {
      cancelAnimationFrame(el.__cuRaf);
      el.__cuRaf = null;
    }
    if (Math.abs(toValue - fromValue) < 0.0001) {
      el.textContent = fmt(toValue);
      el.setAttribute('data-num', toValue);
      return;
    }
    var start = performance.now();
    function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      var v = fromValue + (toValue - fromValue) * eased;
      el.textContent = fmt(v);
      el.setAttribute('data-num', v);
      if (t < 1) {
        el.__cuRaf = requestAnimationFrame(tick);
      } else {
        el.textContent = fmt(toValue);
        el.setAttribute('data-num', toValue);
        el.__cuRaf = null;
      }
    }
    el.setAttribute('data-num', fromValue);
    el.__cuRaf = requestAnimationFrame(tick);
  };

  /* ---- toasts ---------------------------------------------------------------- */
  UI.toast = function (text, kind) {
    var layer = document.getElementById('toast-layer');
    if (!layer) return;
    var t = document.createElement('div');
    t.className = 'toast toast--' + (kind || 'info');
    t.textContent = text;
    layer.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('toast--show'); });
    setTimeout(function () {
      t.classList.remove('toast--show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
    }, 2600);
  };

  /* ---- WebAudio beeps ---------------------------------------------------------- */
  var actx = null;
  function getCtx() {
    if (actx) return actx;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    return actx;
  }
  /* SFX loudness is driven by the SOUND slider in settings (see js/audio.js).
     Read it here rather than having audio.js patch AudioParam globally. */
  function sfxVolume() {
    var A = window.Game && window.Game.Audio;
    if (A && typeof A.soundVolume === 'function') {
      var v = A.soundVolume();
      if (typeof v === 'number' && !isNaN(v)) return Math.max(0, Math.min(1, v / 100));
    }
    return 0.7;
  }
  function playTone(ctx, p, delay) {
    delay = delay || 0;
    var vol = sfxVolume();
    if (vol <= 0) return;               // muted: skip entirely (exponential ramps cannot start at 0)
    var t0 = ctx.currentTime + delay;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.freq, t0);
    if (p.sweep) osc.frequency.linearRampToValueAtTime(Math.max(20, p.freq + p.sweep), t0 + p.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(p.gain * vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + p.dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + p.dur + 0.03);
  }
  var PRESETS = {
    hit:   { freq: 880,  type: 'square',   dur: 0.06, gain: 0.16 },
    miss:  { freq: 160,  type: 'sawtooth', dur: 0.14, gain: 0.13 },
    ban:   { freq: 700,  type: 'square',   dur: 0.10, gain: 0.18, sweep: -350 },
    cash:  { freq: 900,  type: 'triangle', dur: 0.09, gain: 0.16, sweep: 500 },
    rare:  { freq: 520,  type: 'square',   dur: 0.32, gain: 0.20, sweep: 900 },
    click: { freq: 440,  type: 'square',   dur: 0.04, gain: 0.10 },
    /* V22d — the match minigames. Added as PRESETS rather than as their own
       audio path so they inherit the SOUND slider (Game.Audio.soundVolume())
       like every other SFX; a second player would need its own volume wiring.
       awp:  a low crack falling fast — the rifle report.
       dink: the high metallic ping of a helmet hit, deliberately the brightest
             sound in the game so a failed reaction is unmistakable.
       bhop: a short tick for an on-beat strafe; quiet, because it fires often. */
    awp:   { freq: 300,  type: 'sawtooth', dur: 0.22, gain: 0.22, sweep: -260 },
    dink:  { freq: 1500, type: 'square',   dur: 0.12, gain: 0.18, sweep: -700 },
    bhop:  { freq: 640,  type: 'square',   dur: 0.03, gain: 0.07 }
  };
  UI.beep = function (kind) {
    var st = window.Game && window.Game.State && window.Game.State.data;
    if (st && st.settings && st.settings.sound === false) return;
    var ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    var p = PRESETS[kind] || PRESETS.click;
    playTone(ctx, p);
    if (kind === 'rare') {
      playTone(ctx, { freq: p.freq * 1.5, type: p.type, dur: p.dur, gain: p.gain * 0.7, sweep: p.sweep }, 0.06);
      playTone(ctx, { freq: p.freq * 2,   type: p.type, dur: p.dur, gain: p.gain * 0.5, sweep: p.sweep }, 0.12);
    }
  };

  /* ---- confetti / fx-layer particle system -------------------------------------- */
  var fxCanvas = null, fxCtx = null, fxParticles = [], fxRunning = false;
  function ensureFx() {
    if (fxCanvas) return;
    fxCanvas = document.getElementById('fx-layer');
    if (!fxCanvas) return;
    fxCtx = fxCanvas.getContext('2d');
    resizeFx();
    window.addEventListener('resize', resizeFx);
  }
  function resizeFx() {
    if (!fxCanvas) return;
    var rect = fxCanvas.parentElement.getBoundingClientRect();
    fxCanvas.width = rect.width;
    fxCanvas.height = rect.height;
  }
  function fxLoop() {
    if (!fxCtx) return;
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    var alive = [];
    for (var i = 0; i < fxParticles.length; i++) {
      var p = fxParticles[i];
      p.vy += 0.18;
      p.x += p.vx; p.y += p.vy; p.life -= 1;
      p.rot += p.vr;
      if (p.life > 0) {
        alive.push(p);
        fxCtx.save();
        fxCtx.globalAlpha = Math.max(0, p.life / p.maxLife);
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.fillStyle = p.color;
        fxCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        fxCtx.restore();
      }
    }
    fxParticles = alive;
    if (fxParticles.length > 0) {
      requestAnimationFrame(fxLoop);
    } else {
      fxRunning = false;
      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    }
  }
  UI.confetti = function (el, color) {
    ensureFx();
    if (!fxCanvas) return;
    var originX = fxCanvas.width / 2, originY = fxCanvas.height / 2;
    if (el && el.getBoundingClientRect) {
      var rect = el.getBoundingClientRect();
      var fxRect = fxCanvas.getBoundingClientRect();
      originX = rect.left + rect.width / 2 - fxRect.left;
      originY = rect.top + rect.height / 2 - fxRect.top;
    }
    var colors = color ? [color] : ['#3ddc84', '#34d3ff', '#ff4d9d', '#ffc93c', '#ffd54a'];
    for (var i = 0; i < 36; i++) {
      var ang = Math.random() * Math.PI * 2;
      var spd = 2 + Math.random() * 5;
      fxParticles.push({
        x: originX, y: originY,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 2,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        size: 4 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 40 + Math.random() * 25, maxLife: 60
      });
    }
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
  };

  /* ---- reward card modal ------------------------------------------------------- */
  UI.closeModal = function () {
    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    layer.classList.remove('modal-layer--open');
  };

  /* ---- V18 §3 — MODAL CHROME (close disc + docked header tab) --------------
     Authored pixel art on the same strict 16x16 grid / class="po" contract as
     js/main.js's ICONS map and js/phone.js's six glyphs — NOT a Unicode
     multiplication sign and NOT an emoji (ART-DIRECTION §2.5: no character
     does icon duty anywhere in this game).

     Two shapes, both class="po", so css/style.css's `.pixicon .po` rule
     (fill:currentColor + a 2-unit stroke painted UNDER the fill) gives each
     one a true 1px black outline that follows the silhouette:

       1. the disc  — a stepped 14px pixel circle, rows sampled off centre
                      (8,8) r7, inheriting color:var(--close-fill);
       2. the X     — seven 2x2 blocks stepped down each diagonal, wrapped in
                      a <g> that re-points currentColor at var(--ink-head), so
                      the same one rule paints it thick white on black.

     Every rect stays inside x/y 1..15 (X inside 4..12) so the 1 unit the
     outline grows outward still lands in the 16x16 box. */
  var CLOSE_ICON =
    '<svg class="pixicon modal-close__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"' +
    ' style="display:block;width:100%;height:100%;color:var(--close-fill)">' +
    '<path class="po" d="M5 1h6v1H5zM4 2h8v1H4zM3 3h10v1H3zM2 4h12v1H2zM1 5h14v6H1z' +
    'M2 11h12v1H2zM3 12h10v1H3zM4 13h8v1H4zM5 14h6v1H5z"/>' +
    '<g style="color:var(--ink-head)"><path class="po" d="M4 4h2v2H4zM5 5h2v2H5zM6 6h2v2H6z' +
    'M7 7h2v2H7zM8 8h2v2H8zM9 9h2v2H9zM10 10h2v2h-2zM10 4h2v2h-2zM9 5h2v2H9zM8 6h2v2H8z' +
    'M6 8h2v2H6zM5 9h2v2H5zM4 10h2v2H4z"/></g></svg>';

  // Geometry lives inline (tokens only, zero raw hex) so the chrome is
  // correct the moment it is built, independent of which stylesheet package
  // lands first; the .modal-close / .modal-headtab classes are the hooks
  // css/style.css uses to dress it further.
  var CLOSE_CSS =
    'position:absolute;top:-13px;right:-13px;width:38px;height:38px;' +
    'padding:0;margin:0;border:0;background:none;box-shadow:none;line-height:0;' +
    'cursor:pointer;z-index:3;-webkit-tap-highlight-color:transparent;' +
    'touch-action:manipulation;';
  /* UI.modalChrome(card, titleEl, onClose)
     - marks `titleEl` as the modal's DOCKED HEADER TAB and guarantees it is
       the card's first child;
     - if `onClose` is given, hangs the red close disc over the top-right
       corner, overlapping the outer border.

     The tab is the existing title element re-declared as a tab in markup, NOT
     a second wrapper around it: css/style.css (package A) already full-bleeds
     `.reward-card__title` to the card's inner highlight ring and gives it the
     tab's fill, bottom rule and stepped top corners. Wrapping it would have
     produced two stacked strips and broken the `align-self: stretch` that
     keeps the tab docked inside centred cards (the ad overlay). The
     `.modal-headtab` class is the markup-side name for that role, so a tab is
     identifiable from the DOM alone; only the padding that keeps the header
     text clear of the disc is set here, because that clearance is geometry
     this function owns — nothing else about the tab's look is touched.

     `onClose` MUST be the modal's OWN existing dismiss path — the X is a
     second affordance for one teardown route, never a second teardown route
     (a modal with two ways to tear down is how state gets left behind).
     The handler is fired at most once; the node is built once and never
     rebuilt, so nothing swaps a tap target out from under a live touch
     (HANDOFF §9.5). */
  UI.modalChrome = function (card, titleEl, onClose) {
    if (!card) return null;
    card.style.position = 'relative';

    var tab = titleEl || null;
    if (tab) {
      tab.classList.add('modal-headtab');
      if (tab.parentNode === card && card.firstChild !== tab) {
        card.insertBefore(tab, card.firstChild);
      }
    }

    if (typeof onClose === 'function') {
      // The disc reaches ~22px in from the card's right edge. Pad BOTH sides
      // by that much so a long header stays optically centred and can never
      // run underneath the X at 420x860.
      if (tab) {
        tab.classList.add('modal-headtab--has-close');
        tab.style.paddingLeft = '28px';
        tab.style.paddingRight = '28px';
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-close';
      btn.setAttribute('aria-label', 'Close');
      btn.style.cssText = CLOSE_CSS;
      btn.innerHTML = CLOSE_ICON;
      var fired = false;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (fired) return;
        fired = true;
        onClose();
      });
      card.appendChild(btn);
    }
    return tab;
  };

  UI.rewardCard = function (opts) {
    opts = opts || {};
    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var card = document.createElement('div');
    card.className = 'reward-card panel';
    if (opts.color) card.style.setProperty('--reward-accent', opts.color);

    var title = document.createElement('div');
    title.className = 'reward-card__title';
    title.textContent = opts.title || '';
    card.appendChild(title);

    if (opts.subtitle) {
      var sub = document.createElement('div');
      sub.className = 'reward-card__subtitle';
      sub.textContent = opts.subtitle;
      card.appendChild(sub);
    }

    var body = document.createElement('div');
    body.className = 'reward-card__body';
    (opts.lines || []).forEach(function (line) {
      var row = document.createElement('div');
      row.className = 'reward-card__line';
      if (typeof line === 'string') {
        row.textContent = line;
      } else {
        var label = document.createElement('span');
        label.className = 'reward-card__label';
        label.textContent = line.label || '';
        var value = document.createElement('span');
        value.className = 'reward-card__value';
        if (line.color) value.style.color = line.color;
        value.textContent = line.value !== undefined ? line.value : '';
        row.appendChild(label);
        row.appendChild(value);
      }
      body.appendChild(row);
    });
    card.appendChild(body);

    // ONE teardown path, shared by the CONTINUE button and the V18 close disc.
    // Many callers (tournaments.js, cases.js, stream.js, career.js, aim.js,
    // hub.js …) chain on opts.onClose — the tournament match animation runs
    // celebrateMajor() from it — so every close route has to run this exact
    // function, and exactly once.
    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      UI.closeModal();
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    var btn = document.createElement('button');
    btn.className = 'btn btn--primary reward-card__close';
    btn.textContent = opts.buttonText || 'CONTINUE';
    btn.addEventListener('click', dismiss);
    card.appendChild(btn);

    UI.modalChrome(card, title, dismiss);

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    requestAnimationFrame(function () { card.classList.add('reward-card--in'); });
  };

  /* ---- lightweight confirm modal (used by shop/career, not part of the
     minigame contract but shares the same modal layer) ----------------------- */
  UI.confirmModal = function (opts) {
    opts = opts || {};
    var layer = document.getElementById('modal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    var card = document.createElement('div');
    card.className = 'reward-card panel confirm-card';
    if (opts.color) card.style.setProperty('--reward-accent', opts.color);

    var title = document.createElement('div');
    title.className = 'reward-card__title';
    title.textContent = opts.title || '';
    card.appendChild(title);

    if (opts.text) {
      var txt = document.createElement('div');
      txt.className = 'confirm-card__text';
      txt.textContent = opts.text;
      card.appendChild(txt);
    }
    (opts.lines || []).forEach(function (line) {
      var row = document.createElement('div');
      row.className = 'reward-card__line';
      var label = document.createElement('span');
      label.className = 'reward-card__label';
      label.textContent = line.label || '';
      var value = document.createElement('span');
      value.className = 'reward-card__value';
      if (line.color) value.style.color = line.color;
      value.textContent = line.value !== undefined ? line.value : '';
      row.appendChild(label); row.appendChild(value);
      card.appendChild(row);
    });

    var row = document.createElement('div');
    row.className = 'confirm-card__actions';
    var yes = document.createElement('button');
    yes.className = 'btn btn--primary';
    yes.textContent = opts.yesText || 'CONFIRM';
    yes.addEventListener('click', function () {
      if (settled) return;
      settled = true;
      UI.closeModal();
      if (typeof opts.onYes === 'function') opts.onYes();
    });
    // The confirm dialog's existing dismiss path IS the CANCEL button — this
    // modal has never been dismissible by tapping outside and still is not.
    // The X reuses cancel() verbatim rather than adding a route, so a confirm
    // can never be closed without its onNo running.
    var settled = false;
    function cancel() {
      if (settled) return;
      settled = true;
      UI.closeModal();
      if (typeof opts.onNo === 'function') opts.onNo();
    }

    var no = document.createElement('button');
    no.className = 'btn';
    no.textContent = opts.noText || 'CANCEL';
    no.addEventListener('click', cancel);
    row.appendChild(no); row.appendChild(yes);
    card.appendChild(row);

    UI.modalChrome(card, title, cancel);

    backdrop.appendChild(card);
    layer.appendChild(backdrop);
    layer.classList.add('modal-layer--open');
    requestAnimationFrame(function () { card.classList.add('reward-card--in'); });
  };

  /* UI.setDisabled(el, disabled, cls) — THE way to disable a control.

     Every disabled control in this game used to be disabled by adding a CSS
     class and nothing else. `css/style.css`'s `.btn--disabled` sets
     `pointer-events: none`, which stops the MOUSE — and only the mouse. The
     element kept no `disabled` attribute, so it stayed in the tab order and
     still fired on Enter/Space: a button that looks dead, refuses a click,
     and activates from the keyboard anyway. 20 call sites across 9 files had
     the class; exactly one (js/stream.js's STOP STREAM) also set the
     attribute, which is how the discrepancy stayed invisible.

     Two kinds of element need two different mechanisms, which is the other
     reason this belongs in one helper rather than at each call site:

       - Real form controls (BUTTON/INPUT/SELECT/TEXTAREA) take the native
         `disabled` property. That removes them from the tab order, blocks
         activation by any input method, and is what assistive tech reads.
       - Everything else (the DIV "buttons" in js/tournaments.js and the nav
         tiles in js/main.js) cannot be `disabled` — the attribute is
         meaningless on a DIV. They get `aria-disabled` plus `tabindex="-1"`,
         and the original tabindex is stashed so re-enabling restores it
         rather than inventing one.

     `cls` defaults to 'btn--disabled' but is passed explicitly by the two
     controls with their own variant class (the nav tiles, the energy-drink
     key), so the visual treatment stays where it already is. */
  UI.setDisabled = function (el, disabled, cls) {
    if (!el) return;
    disabled = !!disabled;
    el.classList.toggle(cls || 'btn--disabled', disabled);

    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      el.disabled = disabled;
      return;
    }
    if (disabled) {
      if (!el.hasAttribute('data-tabindex-was')) {
        el.setAttribute('data-tabindex-was', el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : '');
      }
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('tabindex', '-1');
    } else {
      el.removeAttribute('aria-disabled');
      var was = el.getAttribute('data-tabindex-was');
      if (was === null || was === '') el.removeAttribute('tabindex');
      else el.setAttribute('tabindex', was);
      el.removeAttribute('data-tabindex-was');
    }
  };

  window.Game = window.Game || {};
  window.Game.UI = UI;
})();
