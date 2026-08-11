/* ==========================================================================
   CS2 PRO SIMULATOR — js/stream.js
   Stream Chat Moderation minigame (SPEC §5.7). Attaches to window.Game.Stream.
   Registers screen 'stream' with Game.Router.

   Session mechanics (chat spawn/aging, tilt/hype/combo, hype train, the
   case-on-stream synergy) live here. Persisting the final payout goes
   through Game.State.applyStreamResult so cash/followers/peakViewers and
   stats.streams stay owned by state.js and the top bar reacts correctly.
   The live "open case on stream" button reuses Game.State.openCase (same
   economy as the Cases screen) plus Game.Cases.playRoulette for the visual.
   ========================================================================== */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};

  var COST_ENERGY  = (G.Data && G.Data.energyCosts && G.Data.energyCosts.stream) || 20;
  // SPEC-V5 §13: no more fixed 45s session. The stream runs until the player
  // taps STOP, which is locked for the first Data.streamMinSeconds (10s) —
  // Package T owns that constant, we just consume it. Viewers ramp toward
  // a per-session cap and plateau there (see updateViewers below) so a long
  // stream can't spiral peakViewers/followerGain unboundedly.
  var STREAM_MIN_MS = ((G.Data && G.Data.streamMinSeconds) || 10) * 1000;
  // SPEC-V6 §1: the flat Data.streamViewerCap (500) is no longer the real
  // ceiling — State.viewerCap() (a dynamic, diminishing-returns formula
  // read fresh at the start of EVERY stream in beginLoop(), stored as
  // sess.viewerCap) is. VIEWER_CAP here is now only the defensive fallback
  // for the rare case State.viewerCap isn't available, plus the module's
  // legacy export.
  var VIEWER_CAP    = (G.Data && G.Data.streamViewerCap) || 500;
  var TILT_TOXIC_TAP_BAN    = 8;   // hype gained on correct ban
  var TILT_FALSE_BAN        = 6;   // tilt gained on wrongly banning a normal viewer
  var TILT_UNHANDLED_TOXIC  = 12;  // tilt gained when a toxic line ages out untapped
  var MOD_BAN_HYPE          = TILT_TOXIC_TAP_BAN / 2; // half hype on a moderator auto-ban (SPEC-V2 §5b)
  var MOD_BAN_FLASH_MS      = 420; // how long an auto-banned line stays visible before it vanishes
  var HYPE_TRAIN_MS = 8000;
  var HYPE_TRAIN_EARN_MULT = 3;
  var MAX_CHAT_LINES = 70;

  // -- viewer-scaled difficulty (SPEC-V2 §11) --------------------------------
  // v = clamp(viewers, 30, 400), t = (v - 30) / 370. At ~30 viewers the pace
  // must be genuinely relaxed; at 300+ it should be unmanageable without a
  // moderator (§5b). Recomputed continuously off the live viewer count —
  // never sampled once at session start. Tilt/hype/combo/hype-train reward
  // numbers above are untouched.
  var VIEWER_DIFF_MIN = 30;
  var VIEWER_DIFF_MAX = 400;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function diffFor(viewers) {
    var v = clamp(viewers || VIEWER_DIFF_MIN, VIEWER_DIFF_MIN, VIEWER_DIFF_MAX);
    var t = (v - VIEWER_DIFF_MIN) / (VIEWER_DIFF_MAX - VIEWER_DIFF_MIN);
    return {
      spawnDelayMs:  lerp(900, 170, t),
      toxicChance:   lerp(0.10, 0.24, t),
      msgLifetimeMs: lerp(6500, 2800, t)
    };
  }

  var USERNAME_PARTS_A = ['xX', 'Toxic', 'Silver', 'EZ', 'Rush', 'Clutch', 'Baiter', 'Peek',
    'Whiff', 'Faze', 'Astral', 'Ninja', 'Ghost', 'Zeus', 'Rekt', 'Frag', 'Prime',
    'Cracked', 'Sleepy', 'Doom', 'Vertigo', 'Nova', 'Jett'];
  var USERNAME_PARTS_B = ['Sniper69', 'Gamer', 'Enjoyer', 'Main', 'God', 'King', 'TTV', 'Fan',
    '_CS2', 'Watcher', 'Fragger', 'Bhop', 'OG', 'Legend', 'Peeker', 'Rifler', 'x1000', 'Clips'];

  var ROLES = ['viewer', 'viewer', 'viewer', 'sub', 'sub', 'vip', 'mod'];

  // this module's own flavor lines, merged with Data.chatNormal / Data.chatToxic
  // (the data agent's authored copy) for variety.
  // SPEC-V6 §19: chat repeated too quickly — both pools doubled below (the
  // original ~14/34 line sets felt like they looped fast on a long stream).
  // New lines match the existing voice: short, lowercase, CS2-stream slang.
  var NORMAL_LINES_LOCAL = [
    'pog', 'lets gooo', 'ez clap', 'nice ace', 'throw the smoke', 'eco round lol',
    'clutch or kick', 'awp goated', 'rotate B', 'gg', 'W game', '1v3 lets go',
    'spray control insane', 'who is coaching this team', 'peek wide', 'save save save',
    'no way he missed that', 'insane flick', 'mid or feed', 'rip headshot', '5Head play',
    'CS2 running good today', 'that was scripted', 'crosshair placement class',
    'wallbang!!', 'ninja defuse???', 'this map is so good', 'bind smokes already',
    'need a timeout', 'coach draw something up', 'insane retake', 'clean 1v1',
    'that AWP flick tho', 'run it back', 'faceit vibes fr', 'chat is this real',
    'built different fr', 'held angle like a god', 'baiting never looked this good',
    'stream snipers stay mad', 'this lobby is not ready', 'igl brain activated',
    'trade frag king', 'zoning that smoke perfectly', 'utility usage top tier',
    'that was a free kill lol', 'reads the opponent like a book', 'flashbang timing immaculate',
    'one tap city', 'deagle demon fr', 'clutch gene confirmed', 'never doubted for a second',
    'that rotate saved the round', 'op is diff', 'quad kill lets gooo', 'that peek was violent',
    'gamer moment right there', 'stream is heating up', 'donation incoming just watch',
    'grinding faceit levels today?', 'that spray transfer was clean', 'silent but deadly',
    'this is why we watch', 'insta lock awp legend', 'no crosshair placement issues here',
    'holding the site solo, respect', 'boosted teammate carried by you tonight',
    'nice bait into the trade', 'that fake defuse was crazy', 'zero hesitation on that peek',
    'chat go feral', 'that ace was inevitable', 'save the clip', 'rating up not ratioed',
    'gonna need a montage for this', 'this is the content we needed', 'coach is taking notes',
    'top frag every round today', 'that timing was perfect', 'the grind is showing',
    'W rotation W read W everything', 'that dink was so satisfying', 'econ round win, respect',
    'refuse to believe that was luck', 'this stream is criminally underrated',
    'that fake nade bought so much time', 'setup crew cooking today'
  ];
  var TOXIC_LINES_LOCAL = [
    'you are actually washed', 'worst awper ive ever seen', 'ratio + you fell off',
    'bot lobby confirmed', 'coach should be fired', 'L take, L stream',
    'mute this guy hes trash', 'imagine missing that', 'hardstuck forever lol',
    'your aim is actual garbage', 'yikes that was bad', 'delete the game',
    'zero iq rotation', 'washed up ngl', 'cringe stream honestly', 'go touch grass',
    'reported for throwing', 'this is embarrassing to watch', 'refund the stream',
    'nerf this guy to bronze', 'aim botted confirmed', 'thats a paid actor teammate',
    'L rotation L igl L everything', 'stream should end here honestly', 'that was actually pathetic',
    'zero brain cells detected', 'unwatchable gameplay ngl', 'hardstuck silver energy',
    'this content is dead on arrival', 'imagine paying for this coach', 'clown behavior fr',
    'thats an npc teammate', 'washed take from a washed player', 'get off twitch already',
    'literally throwing rounds', 'sit down chat is embarrassed', 'faceit would never',
    'bro peeked with no plan again', 'this rank is generous', 'mute the mic already',
    'quit while you can', 'this setup is carrying harder than you', 'coach is asleep at the wheel',
    'the real mvp is the mute button', 'ratio speedrun world record'
  ];
  var NORMAL_LINES = ((G.Data && G.Data.chatNormal) || []).concat(NORMAL_LINES_LOCAL);
  var TOXIC_LINES = ((G.Data && G.Data.chatToxic) || []).concat(TOXIC_LINES_LOCAL);

  var EMOTES = ['PogU', 'OMEGALUL', 'KEKW', 'monkaS', 'Sadge', 'Clap', 'EZ', 'POGGERS', '5Head', 'Pepega'];
  var HYPE_FLOOD_LINES = ['POGGERS', 'CASE GOD', 'LETS GOOO', 'NO WAY', 'INSANE PULL',
    'W STREAMER', 'HOLY PULL', 'CLIP IT'];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function makeUsername() {
    return pick(USERNAME_PARTS_A) + pick(USERNAME_PARTS_B) + (Math.random() < 0.4 ? Math.floor(Math.random() * 99) : '');
  }

  // -- module state ----------------------------------------------------------
  var root = null;
  var chatEl = null;
  var hud = null;
  var rafId = null;
  var running = false;
  var sess = null;

  /* SPEC-V15-BATCH-C §1 — INTEGRATION FIX (lead).
     js/state.js's tutorialPending() suppresses contextual tutorial cards
     while a stream is live by reading `d.streaming` (state.js:1530). That
     field was added by the rules package AFTER this file's package had
     already finished, so nothing ever set it — the suppression was dead
     code and a tutorial card could have popped over a live stream, on top
     of the very minigame the player is trying to click.

     Stream session state is private to this closure, so `d.streaming` is
     the only channel state.js has. setRunning() is the ONLY thing that
     assigns `running`, so the mirror cannot drift out of sync with it —
     the alternative (writing d.streaming at each of the five call sites)
     is exactly the duplicated-rule shape that has caused four user-visible
     bugs in this project.

     It deliberately covers the first-stream tutorial gate too: during the
     frozen-chat lesson `running` is true while `sess` is still null, and a
     second tutorial card appearing over the first would be the worst case
     of all. It is also cleared by onExit()/onEnter()'s backstops, so the
     flag can never latch true and silently suppress every future tutorial. */
  function setRunning(v) {
    running = !!v;
    var d = G.State && G.State.data;
    if (d) d.streaming = running;
  }

  // SPEC-V15-BATCH-C §3.1 / HANDOFF §9.5: "never reposition or rebuild a
  // message element while a touch may be on it." fadeAndRemove()'s CSS
  // animation is transform/opacity-only now (see css/minigames.css), so the
  // ONLY moment a removal can shift other messages is the instant the node
  // actually leaves the DOM. chatPointerActive tracks whether any pointer is
  // currently down anywhere in the chat; while true, finished fades queue in
  // pendingRemovals instead of mutating the DOM, and get flushed the moment
  // the pointer lifts (or cancels) — so a tap in flight can never have its
  // target, or its neighbours, move under it.
  var chatPointerActive = false;
  var pendingRemovals = [];
  var onWindowPointerEnd = null;

  // SPEC-V15-BATCH-C §3.2: the first-ever-stream tutorial gate. Non-null
  // while active. `el` is the single toxic .chat-line the player must tap;
  // everything else (including the normal onChatPointerDown flow, which
  // requires `sess`) is inert until it resolves.
  var tutorialGate = null;
  // Fallback store for "seen" state when State.tutorialSeen/markTutorialSeen
  // (Package C1's API) hasn't landed yet — resets on reload, i.e. "once per
  // session," exactly as SPEC-V15-BATCH-C §"API for step 5" prescribes.
  var sessionTutorialFlags = {};

  // SPEC-V6 §17: Router.go(name) still calls onEnter() even when you're
  // already ON 'stream' (current === name skips onExit but never onEnter —
  // see Package U's streamNavLockReason() comment in main.js for the exact
  // hole this closes). Re-entering while a session is genuinely live must
  // settle it the same way onExit()'s backstop does, not silently reset
  // running/sess out from under an active stream with zero payout.
  function onEnter() {
    if (running && sess) {
      endSession('interrupted');
    }
    root = G.Router.root('stream');
    root.innerHTML = '';
    setRunning(false);
    sess = null;
    tutorialGate = null;
    chatPointerActive = false;
    pendingRemovals.length = 0;
    buildReady();
  }

  // SPEC-V6 §17: streaming must never silently end just because the player
  // navigated away. Package U blocks the bottom-nav (TRAIN/PLAY/CASES/SHOP/
  // CAREER) and hub SLEEP button while G.Stream.isLive() is true (see the
  // export at the bottom of this file) — the on-stream CASE button is the
  // one exception and never routes through here since it doesn't navigate.
  // This onExit() is the backstop for any path U's block doesn't catch (a
  // future regression, a browser back button, etc.): if a session is
  // genuinely live when the screen tears down, settle it for whatever was
  // actually earned — same payout math as a normal STOP — instead of
  // discarding the run to nothing.
  function onExit() {
    if (running && sess) {
      endSession('interrupted');
    } else {
      stopLoop();
    }
    setRunning(false);
    if (sess && sess.caseHandle) { sess.caseHandle.cancel(); sess.caseHandle = null; }
    sess = null;
    tutorialGate = null;
    chatPointerActive = false;
    pendingRemovals.length = 0;
    if (onWindowPointerEnd) {
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      onWindowPointerEnd = null;
    }
    if (root) root.innerHTML = '';
    root = null;
    chatEl = null;
    hud = null;
  }

  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // SPEC-V5 §5r: STREAM is one of the screens hard-blocked while the room is
  // incomplete. state.js has no "start stream" entry point of its own (session
  // start lives entirely here), so this module is responsible for calling
  // State.roomCompleteness() itself before GO LIVE is allowed.
  var MISSING_LABELS = { bed: 'BED', desk: 'DESK', chair: 'CHAIR', pc: 'PC', monitor: 'MONITOR' };
  function missingListText(missing) {
    return (missing || []).map(function (c) { return MISSING_LABELS[c] || String(c).toUpperCase(); }).join(', ');
  }
  function roomCompleteness() {
    if (G.State && typeof G.State.roomCompleteness === 'function') return G.State.roomCompleteness();
    return { complete: true, missing: [] };
  }

  // -- first-stream tutorial gate (SPEC-V15-BATCH-C §3.2) --------------------
  // Package C1 is building State.tutorialSeen/markTutorialSeen in parallel.
  // Called defensively, exactly like js/sponsors.js does with G.Phone.open():
  // typeof-guarded, with a same-session-only fallback so this module works
  // whether or not C1 has landed yet, and never throws either way.
  function tutorialSeenSafe(id) {
    if (G.State && typeof G.State.tutorialSeen === 'function') return !!G.State.tutorialSeen(id);
    return !!sessionTutorialFlags[id];
  }
  function markTutorialSeenSafe(id) {
    if (G.State && typeof G.State.markTutorialSeen === 'function') {
      G.State.markTutorialSeen(id);
    } else {
      sessionTutorialFlags[id] = true;
    }
  }

  function cheapestModCost() {
    var mods = (G.Data && G.Data.staffMods) || [];
    var min = Infinity;
    for (var i = 0; i < mods.length; i++) {
      if (typeof mods[i].hire === 'number' && mods[i].hire < min) min = mods[i].hire;
    }
    return min;
  }

  // Fires on the player's first ever stream, only while they can't yet
  // afford any moderator (a hired mod already auto-bans a chunk of toxic
  // chat, so the manual-ban lesson is moot for them) and only once ever.
  function firstStreamTutorialEligible() {
    var d = G.State && G.State.data;
    if (!d) return false;
    if (tutorialSeenSafe('first_stream')) return false;
    var streamsDone = (d.stats && d.stats.streams) || 0;
    if (streamsDone > 0) return false;
    var hasMod = !!(G.State && typeof G.State.currentMod === 'function' && G.State.currentMod());
    if (hasMod) return false;
    var cash = d.cash || 0;
    if (cash >= cheapestModCost()) return false;
    return true;
  }

  // Spawns one toxic line and freezes everything — no sess exists yet, so
  // there is no rAF loop, no spawn timer, no viewer/cash accrual and no
  // scrolling. The real, uncosted session only begins (beginLoop(), which
  // stamps sess.startTime = now) once the player successfully taps the
  // target line, per SPEC-V15-BATCH-C §3.2 point 5: "the freeze must not
  // cost the player anything."
  function startFirstStreamTutorial() {
    setRunning(true); // isLive() reports true, so nav is blocked same as a live stream
    sess = null;

    var el = document.createElement('div');
    var username = makeUsername();
    var text = pick(TOXIC_LINES);
    el.className = 'chat-line role-viewer chat-toxic chat-tutorial-target';
    el.innerHTML = '<span class="chat-user">' + escapeHtml(username) + ':</span> <span class="chat-text">' + escapeHtml(text) + '</span>';
    chatEl.appendChild(el);

    var overlay = document.createElement('div');
    overlay.className = 'stream-tutorial-overlay panel';
    overlay.innerHTML =
      '<div class="stream-tutorial-title">CHAT MODERATION</div>' +
      '<div class="stream-tutorial-body">Red messages are toxic chat. Left alone they tilt you and scare off viewers — ' +
      'ban them by tapping. Once you can afford a moderator, this happens for you automatically.</div>' +
      '<div class="stream-tutorial-cta">TAP THE RED MESSAGE TO BAN IT</div>';
    var wrap = root.querySelector('.stream-wrap');
    var chatNode = wrap.querySelector('.stream-chat');
    wrap.insertBefore(overlay, chatNode);

    tutorialGate = { active: true, el: el, overlayEl: overlay };
  }

  function resolveTutorialTap() {
    if (!tutorialGate || !tutorialGate.active) return;
    tutorialGate.active = false;
    var el = tutorialGate.el;
    var overlayEl = tutorialGate.overlayEl;

    G.UI.beep('ban');
    el.classList.add('chat-banned');
    el.classList.remove('chat-tutorial-target');
    popLabel(el, 'BANNED', 'var(--danger)');
    fadeAndRemove(el);

    if (overlayEl) {
      overlayEl.classList.add('stream-tutorial-overlay-gone');
      window.setTimeout(function () {
        if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      }, 260);
    }

    markTutorialSeenSafe('first_stream');
    G.UI.toast('BANNED — A MODERATOR WILL DO THIS FOR YOU LATER', 'good');

    tutorialGate = null;
    beginLoop(); // the real, zero-cost-until-now session starts here
  }

  // -- ready screen ------------------------------------------------------------
  function buildReady() {
    var wrap = document.createElement('div');
    wrap.className = 'mg-wrap stream-wrap';
    var rc = roomCompleteness();
    var blockedHtml = rc.complete ? '' :
      '<div class="mg-blocked-banner panel">' +
        '<div class="mg-blocked-banner-title">ROOM INCOMPLETE</div>' +
        '<div class="mg-blocked-banner-body">Missing: ' + escapeHtml(missingListText(rc.missing)) +
        '. Finish your room before you can go live.</div>' +
      '</div>';
    wrap.innerHTML =
      '<div class="mg-header">' +
        '<button type="button" class="btn mg-back">&larr; BACK</button>' +
        '<div class="mg-title">GO LIVE</div>' +
        '<div class="mg-spacer"></div>' +
      '</div>' +
      '<div class="mg-ready panel">' +
        '<div class="mg-ready-icon stream-ready-icon">&#9679;</div>' +
        '<div class="mg-ready-title">STREAM UNTIL YOU STOP</div>' +
        '<div class="mg-ready-copy">Chat is scrolling. Tap the <span class="stream-toxic-hl">RED TOXIC</span> lines to ban them ' +
        'and pump the hype meter. Miss a toxic line and it tilts you. Ban a normal viewer by mistake ' +
        'and that tilts you too. Fill the hype meter for a SUB HYPE TRAIN. Cash accrues every second live &mdash; ' +
        'STOP STREAM unlocks after ' + Math.round(STREAM_MIN_MS / 1000) + 's and you can end it whenever you like after that.</div>' +
        blockedHtml +
        '<button type="button" class="btn mg-start-btn stream-start-btn"' + (rc.complete ? '' : ' disabled') + '>GO LIVE <span class="mg-cost">-' + COST_ENERGY + ' ENERGY</span></button>' +
      '</div>';
    root.appendChild(wrap);
    wrap.querySelector('.mg-back').addEventListener('click', function () {
      G.UI.beep('click');
      G.Router.back();
    });
    wrap.querySelector('.stream-start-btn').addEventListener('click', startSession);
  }

  // -- play screen ---------------------------------------------------------------
  function startSession() {
    var rc = roomCompleteness();
    if (!rc.complete) {
      G.UI.toast('ROOM INCOMPLETE: NEED ' + missingListText(rc.missing), 'bad');
      return;
    }
    var ok = G.State.useEnergy(COST_ENERGY);
    if (!ok) {
      G.UI.toast('NOT ENOUGH ENERGY', 'bad');
      return;
    }
    G.UI.beep('click');
    buildPlay();
    if (firstStreamTutorialEligible()) {
      startFirstStreamTutorial();
    } else {
      beginLoop();
    }
  }

  function buildPlay() {
    root.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'mg-wrap stream-wrap';
    // The case button label carries no price: the player picks the stream tier
    // independently (d.caseSelection.stream), so any baked-in cost string goes
    // stale the moment they switch to PRIME/ELITE. No string, no staleness.
    var modDef = (G.State && typeof G.State.currentMod === 'function') ? G.State.currentMod() : null;
    var modBadgeHtml = modDef
      ? ('<div class="stream-mod-badge">MOD ON DUTY: ' + escapeHtml(modDef.name) + ' &mdash; AUTO-BANS ' +
         Math.round(modDef.autoBanPct * 100) + '% OF TOXIC CHAT</div>')
      : '';
    wrap.innerHTML =
      '<div class="stream-hud">' +
        '<div class="stream-hud-row">' +
          '<div class="aim-stat"><span class="h-label">TIME</span><span class="aim-val" data-k="time">0:00</span></div>' +
          '<div class="aim-stat"><span class="h-label">VIEWERS</span><span class="aim-val stream-viewers-val" data-k="viewers">0</span></div>' +
          '<div class="aim-stat"><span class="h-label">EARNED</span><span class="aim-val stream-earned-val" data-k="earned">$0</span></div>' +
          '<div class="aim-stat"><span class="h-label">COMBO</span><span class="aim-val" data-k="combo">0</span></div>' +
        '</div>' +
        '<div class="stream-meter-row">' +
          '<div class="stream-meter"><span class="h-label">HYPE</span><div class="stream-meter-track"><div class="stream-meter-fill stream-meter-hype" data-k="hypeFill"></div></div></div>' +
          '<div class="stream-meter"><span class="h-label">TILT</span><div class="stream-meter-track"><div class="stream-meter-fill stream-meter-tilt" data-k="tiltFill"></div></div></div>' +
        '</div>' +
        modBadgeHtml +
      '</div>' +
      '<div class="stream-case-slot"></div>' +
      '<div class="stream-chat"></div>' +
      '<div class="stream-actions">' +
        '<button type="button" class="btn stream-case-btn">OPEN A CASE</button>' +
        '<button type="button" class="btn btn--disabled stream-stop-btn" disabled>STOP STREAM (' + Math.ceil(STREAM_MIN_MS / 1000) + 's)</button>' +
      '</div>';
    root.appendChild(wrap);

    chatEl = wrap.querySelector('.stream-chat');
    hud = {
      time: wrap.querySelector('[data-k="time"]'),
      viewers: wrap.querySelector('[data-k="viewers"]'),
      earned: wrap.querySelector('[data-k="earned"]'),
      combo: wrap.querySelector('[data-k="combo"]'),
      hypeFill: wrap.querySelector('[data-k="hypeFill"]'),
      tiltFill: wrap.querySelector('[data-k="tiltFill"]'),
      caseBtn: wrap.querySelector('.stream-case-btn'),
      caseSlot: wrap.querySelector('.stream-case-slot'),
      stopBtn: wrap.querySelector('.stream-stop-btn')
    };

    chatEl.addEventListener('pointerdown', onChatPointerDown);
    // Track "is a finger/pointer down anywhere in the chat" purely for the
    // deferred-removal guard in removeChatEl() — this listener never resolves
    // taps itself, onChatPointerDown above (and the tutorial-gate branch in
    // it) does that.
    chatEl.addEventListener('pointerdown', function () { chatPointerActive = true; });
    onWindowPointerEnd = function () { chatPointerActive = false; flushPendingRemovals(); };
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    hud.caseBtn.addEventListener('click', openCaseOnStream);
    hud.stopBtn.addEventListener('click', onStopClicked);
  }

  function onStopClicked() {
    if (!running || !sess) return;
    if (!sess.stopUnlocked) return; // still locked — button is `disabled` anyway, this is a belt-and-braces guard
    G.UI.beep('click');
    endSession('stopped');
  }

  function formatElapsed(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function beginLoop() {
    var d = G.State.data;
    var startViewers = 14 + (d.followers || 0) * 0.01 + rand(0, 10);
    var gear = (G.State.gearBonus && G.State.gearBonus()) || { stream: 0 };
    // SPEC-V6 §1: the viewer ceiling is now the dynamic, diminishing-returns
    // State.viewerCap() (a brand-new save caps at exactly 230, not the old
    // flat 500) — read fresh at the start of THIS stream, not once at
    // module load, so it reflects streams-done/followers/tier as they were
    // the moment the player went live.
    var cap = (G.State && typeof G.State.viewerCap === 'function') ? G.State.viewerCap() : VIEWER_CAP;
    sess = {
      startTime: performance.now(),
      lastFrame: performance.now(),
      rawSeconds: 0,
      effectiveSeconds: 0,
      // SPEC-V5 §13r: cash accrues per second, no fixed session length. The
      // rate is captured once at session start (followers/gear don't change
      // mid-session) — cashPerEffectiveSecond * sess.effectiveSeconds gives
      // the exact same total the old fixed-duration formula produced,
      // just readable continuously instead of only at the end.
      cashPerEffectiveSecond: (8 + (d.followers || 0) * 0.02) * (1 + (gear.stream || 0)) / 10,
      cashEarned: 0,
      // DISPLAY ONLY. sess.cashEarned stays raw because that is what gets
      // handed to State.applyStreamResult(), which does the scaling itself —
      // baking the multiplier into cashEarned would scale it twice. The live
      // HUD counter has to show the scaled figure though, or it spends the
      // whole stream contradicting the payout the player is about to get.
      // Read from state.js rather than recomputed here (HANDOFF-V2 §5.4);
      // captured once because location and contract tier cannot change
      // mid-session, exactly like cashPerEffectiveSecond above.
      cashDisplayMult: (G.State.streamMultipliers ? G.State.streamMultipliers().cash : 1),
      stopUnlocked: false,
      hype: 0,
      tilt: 0,
      combo: 0,
      viewers: startViewers,
      viewerCap: cap,
      viewerBoost: 1,
      viewerSpike: null, // {startAt, peakAt, endAt, amount} — SPEC-V6 §1 case-pull spike, see updateViewers()
      peakViewers: startViewers,
      viewerSampleSum: 0,
      viewerSampleCount: 0,
      synergyMult: 1,
      hypeTrainActive: false,
      hypeTrainEndsAt: 0,
      nextMsgAt: 0,
      nextViewerTickAt: 0,
      messages: [],
      modBanQueue: [],
      caseHandle: null,
      caseBusy: false
    };
    setRunning(true);
    spawnMessage(performance.now());
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!running || !sess) return;
    var dt = clamp((now - sess.lastFrame) / 1000, 0, 0.25);
    sess.lastFrame = now;
    sess.rawSeconds += dt;
    sess.effectiveSeconds += dt * (sess.hypeTrainActive ? HYPE_TRAIN_EARN_MULT : 1);
    sess.cashEarned = sess.cashPerEffectiveSecond * sess.effectiveSeconds;

    var elapsed = now - sess.startTime;
    if (hud) {
      hud.time.textContent = formatElapsed(elapsed);
      hud.earned.textContent = G.UI.money(sess.cashEarned * sess.cashDisplayMult);
    }

    // SPEC-V5 §13u: STOP STREAM is locked for the first streamMinSeconds,
    // with a visible countdown, then live for the rest of the (open-ended)
    // session.
    if (!sess.stopUnlocked) {
      var lockRemain = STREAM_MIN_MS - elapsed;
      if (lockRemain <= 0) {
        sess.stopUnlocked = true;
        if (hud && hud.stopBtn) {
          hud.stopBtn.disabled = false;
          window.Game.UI.setDisabled(hud.stopBtn, false);
          hud.stopBtn.textContent = 'STOP STREAM';
        }
      } else if (hud && hud.stopBtn) {
        hud.stopBtn.textContent = 'STOP STREAM (' + Math.ceil(lockRemain / 1000) + 's)';
      }
    }

    if (sess.hypeTrainActive && now >= sess.hypeTrainEndsAt) {
      endHypeTrain();
    }

    updateViewers(now, dt);

    if (now >= sess.nextMsgAt) {
      spawnMessage(now);
    }

    ageMessages(now);
    processModBans(now);
    updateHud();

    if (sess.tilt >= 100) {
      endSession('sniped');
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }

  // SPEC-V6 §1 (in-stream shape, consuming State.viewerCap() computed once
  // per session in beginLoop as sess.viewerCap):
  //  - ramp toward the cap early (proportional approach — fast while far
  //    below it, naturally slowing as it nears the ceiling);
  //  - once plateaued, hold roughly steady, DRIFTING SLIGHTLY DOWN with
  //    small jitter — a long stream sheds a trickle of viewers rather than
  //    sitting pinned at the ceiling or compounding upward forever;
  //  - a good on-stream case pull (onCaseResolved's isRare branch) sets
  //    sess.viewerSpike, which THIS function animates as an additive layer
  //    on top of the organic plateau — ramping up, holding, then settling
  //    back over a few seconds, never an instant single-frame jump. The
  //    organic sess.viewers value underneath is untouched by the spike, so
  //    "settles back" means back to wherever the plateau actually is.
  function updateViewers(now, dt) {
    var cap = sess.viewerCap || VIEWER_CAP;
    var targetBoost = sess.hypeTrainActive ? 2.4 : 1;
    sess.viewerBoost += (targetBoost - sess.viewerBoost) * clamp(dt * 2, 0, 1);

    if (now >= sess.nextViewerTickAt) {
      sess.nextViewerTickAt = now + rand(600, 1000);
      var plateauFloor = cap * 0.93;
      if (sess.viewers < plateauFloor) {
        // still climbing toward the ceiling — bigger steps the further
        // below it, shrinking automatically as it closes in.
        var remaining = cap - sess.viewers;
        var climb = remaining * rand(0.05, 0.12) + sess.combo * 0.15;
        sess.viewers = clamp(sess.viewers + climb, 3, cap * 0.995);
      } else {
        // plateaued: net-negative jitter (a trickle of churn), never
        // pinned dead flat and never allowed to compound back past the cap.
        var drift = rand(-2.4, 0.5) + sess.combo * 0.04;
        sess.viewers = clamp(sess.viewers + drift, cap * 0.7, cap * 0.995);
      }
    }

    // -- case-pull spike animation --------------------------------------
    var spikeAdd = 0;
    if (sess.viewerSpike) {
      var sp = sess.viewerSpike;
      if (now < sp.peakAt) {
        spikeAdd = sp.amount * easeOutCubic(clamp((now - sp.startAt) / (sp.peakAt - sp.startAt), 0, 1));
      } else if (now < sp.endAt) {
        spikeAdd = sp.amount * (1 - easeInCubic(clamp((now - sp.peakAt) / (sp.endAt - sp.peakAt), 0, 1)));
      } else {
        sess.viewerSpike = null;
      }
    }

    // The hype-train boost still tops out at the plateau (cap) like before;
    // only the case-pull spike is allowed to push display viewers above it.
    var boosted = Math.min(sess.viewers * sess.viewerBoost, cap);
    var displayViewers = Math.max(3, boosted + spikeAdd);
    sess.peakViewers = Math.max(sess.peakViewers, displayViewers);
    sess.viewerSampleSum += displayViewers;
    sess.viewerSampleCount++;
    sess.lastDisplayViewers = displayViewers;
  }

  // Chat should read as "genuinely flowing" (SPEC §5.7: "scrolls rapidly"),
  // and the pace/toxicity/lifetime all scale continuously off the live
  // viewer count per SPEC-V2 §11 (diffFor above). A ±15% jitter around the
  // exact lerp'd spawnDelayMs keeps the cadence organic while still centered
  // on the spec numbers. Tilt/hype/combo/hype-train math is untouched below.
  function currentViewers() {
    return (sess && (sess.lastDisplayViewers || sess.viewers)) || 14;
  }

  function spawnMessage(now) {
    if (!chatEl || !sess) return;
    var floodMode = sess.hypeTrainActive;
    var diff = diffFor(currentViewers());
    var baseDelay = floodMode ? [55, 120] : [diff.spawnDelayMs * 0.85, diff.spawnDelayMs * 1.15];
    sess.nextMsgAt = now + rand(baseDelay[0], baseDelay[1]);

    var toxic = !floodMode && Math.random() < diff.toxicChance;
    var role = pick(ROLES);
    var username = makeUsername();
    var text;
    if (toxic) {
      text = pick(TOXIC_LINES);
    } else if (floodMode) {
      text = pick(HYPE_FLOOD_LINES) + ' ' + pick(EMOTES);
    } else if (Math.random() < 0.22) {
      var e1 = pick(EMOTES);
      text = (e1 + ' ').repeat(2 + Math.floor(Math.random() * 3)).trim();
    } else {
      text = pick(NORMAL_LINES);
    }

    // Moderator auto-ban (SPEC-V2 §5b): a hired mod removes a share of toxic
    // lines BEFORE the player can interact with them, flashing a MOD BAN tag
    // and awarding half the normal ban hype.
    var modDef = (toxic && G.State && typeof G.State.currentMod === 'function') ? G.State.currentMod() : null;
    var autoBanned = !!(modDef && Math.random() < modDef.autoBanPct);

    var el = document.createElement('div');
    el.className = 'chat-line role-' + role + (toxic ? ' chat-toxic' : '') + (floodMode ? ' chat-hype' : '') +
      (autoBanned ? ' chat-modbanned' : '');
    el.innerHTML = '<span class="chat-user">' + escapeHtml(username) + ':</span> <span class="chat-text">' + escapeHtml(text) + '</span>';
    chatEl.appendChild(el);
    chatEl.scrollTop = chatEl.scrollHeight;

    if (autoBanned) {
      sess.hype = clamp(sess.hype + MOD_BAN_HYPE, 0, 100);
      popLabel(el, 'MOD BAN', 'var(--views)');
      sess.modBanQueue.push({ el: el, createdAt: now });
      if (sess.hype >= 100 && !sess.hypeTrainActive) startHypeTrain();
      updateHud();
      return; // never added to sess.messages — not interactive, ages out on its own
    }

    var msg = { el: el, toxic: toxic, createdAt: now };
    sess.messages.push(msg);

    while (sess.messages.length > MAX_CHAT_LINES) {
      var oldest = sess.messages.shift();
      fadeAndRemove(oldest.el);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ageMessages(now) {
    if (!sess) return;
    // msgLifetimeMs is recomputed off the live viewer count every call, so a
    // mid-session viewer spike (e.g. a hype train) shortens how long lines
    // already on screen have left, per SPEC-V2 §11's "recompute continuously".
    var lifetime = diffFor(currentViewers()).msgLifetimeMs;
    for (var i = sess.messages.length - 1; i >= 0; i--) {
      var m = sess.messages[i];
      if (now - m.createdAt >= lifetime) {
        sess.messages.splice(i, 1);
        if (m.toxic) {
          sess.tilt = clamp(sess.tilt + TILT_UNHANDLED_TOXIC, 0, 100);
        }
        fadeAndRemove(m.el);
      }
    }
  }

  function processModBans(now) {
    if (!sess) return;
    for (var i = sess.modBanQueue.length - 1; i >= 0; i--) {
      var mb = sess.modBanQueue[i];
      if (now - mb.createdAt >= MOD_BAN_FLASH_MS) {
        sess.modBanQueue.splice(i, 1);
        fadeAndRemove(mb.el);
      }
    }
  }

  function fadeAndRemove(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('chat-line-gone');
    el.addEventListener('animationend', function onEnd() {
      el.removeEventListener('animationend', onEnd);
      removeChatEl(el);
    });
  }

  // SPEC-V15-BATCH-C §3.1 / HANDOFF §9.5: this is the only line of code that
  // actually mutates the DOM list (the fade itself is transform/opacity only
  // and leaves the element occupying its full in-flow slot the whole time —
  // see the .chat-line-gone comment in css/minigames.css). If a pointer is
  // currently down anywhere in the chat, queue the removal instead of
  // shifting the layout under a possible in-flight tap; it flushes the
  // instant the pointer lifts.
  function removeChatEl(el) {
    if (!el || !el.parentNode) return;
    if (chatPointerActive) {
      pendingRemovals.push(el);
      return;
    }
    el.parentNode.removeChild(el);
  }

  function flushPendingRemovals() {
    if (chatPointerActive) return;
    while (pendingRemovals.length) {
      var el = pendingRemovals.shift();
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  function onChatPointerDown(e) {
    var lineEl = e.target && e.target.closest ? e.target.closest('.chat-line') : null;
    // SPEC-V15-BATCH-C §3.2: while the first-stream tutorial gate is active,
    // ONLY a tap that lands on its one target message does anything. Every
    // other tap (empty space, elsewhere in the wrap) is swallowed here —
    // silently, no toast, no penalty — because sess is still null so the
    // fallthrough below would no-op anyway, but the gate must intercept
    // first so a hit on its target doesn't fall through to the (currently
    // nonexistent) session logic.
    if (tutorialGate && tutorialGate.active) {
      if (lineEl && lineEl === tutorialGate.el) resolveTutorialTap();
      return;
    }
    if (!running || !sess) return;
    if (!lineEl) return;
    var msg = null;
    for (var i = 0; i < sess.messages.length; i++) {
      if (sess.messages[i].el === lineEl) { msg = sess.messages[i]; sess.messages.splice(i, 1); break; }
    }
    if (!msg) return; // already resolved (aged out / pruned) between event queue and now

    if (msg.toxic) {
      sess.hype = clamp(sess.hype + TILT_TOXIC_TAP_BAN, 0, 100);
      sess.combo++;
      G.UI.beep('ban');
      lineEl.classList.add('chat-banned');
      popLabel(lineEl, 'BANNED', 'var(--danger)');
      if (sess.hype >= 100 && !sess.hypeTrainActive) startHypeTrain();
    } else {
      sess.tilt = clamp(sess.tilt + TILT_FALSE_BAN, 0, 100);
      sess.combo = 0;
      G.UI.beep('miss');
      lineEl.classList.add('chat-falseban');
      popLabel(lineEl, 'FALSE BAN', 'var(--elo)');
    }
    fadeAndRemove(lineEl);
    updateHud();
  }

  function popLabel(anchorEl, text, color) {
    if (!chatEl) return;
    var rect = anchorEl.getBoundingClientRect();
    var chatRect = chatEl.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.className = 'stream-pop';
    pop.style.color = color;
    pop.style.left = (rect.left - chatRect.left + rect.width / 2) + 'px';
    pop.style.top = (rect.top - chatRect.top) + 'px';
    pop.textContent = text;
    chatEl.appendChild(pop);
    pop.addEventListener('animationend', function () {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
    });
  }

  function startHypeTrain() {
    sess.hypeTrainActive = true;
    sess.hypeTrainEndsAt = performance.now() + HYPE_TRAIN_MS;
    G.UI.beep('cash');
    if (root && G.UI.confetti) G.UI.confetti(root, 'var(--subs)');
    var banner = document.createElement('div');
    banner.className = 'stream-hypetrain-banner';
    banner.textContent = 'SUB HYPE TRAIN!';
    root.appendChild(banner);
    banner.addEventListener('animationend', function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    });
    G.UI.toast('SUB HYPE TRAIN — 3x CASH!', 'good');
    spawnCashRain();
  }

  function spawnCashRain() {
    if (!sess || !sess.hypeTrainActive || !root) return;
    var drop = document.createElement('div');
    drop.className = 'stream-cash-drop';
    drop.textContent = '$';
    drop.style.left = rand(5, 95) + '%';
    drop.style.animationDuration = rand(0.9, 1.6) + 's';
    root.appendChild(drop);
    drop.addEventListener('animationend', function () {
      if (drop.parentNode) drop.parentNode.removeChild(drop);
      if (sess && sess.hypeTrainActive) spawnCashRain();
    });
  }

  function endHypeTrain() {
    sess.hypeTrainActive = false;
    sess.hype = 0;
  }

  function updateHud() {
    if (!hud || !sess) return;
    hud.viewers.textContent = Math.round(sess.lastDisplayViewers || sess.viewers).toString();
    hud.combo.textContent = String(sess.combo);
    hud.hypeFill.style.width = sess.hype + '%';
    hud.tiltFill.style.width = sess.tilt + '%';
  }

  // -- case-on-stream synergy -----------------------------------------------
  function openCaseOnStream() {
    if (!sess || sess.caseBusy || !G.State || typeof G.State.openCase !== 'function') return;
    // SPEC-V3 §12: an on-stream open must cost 0 energy (still the $7 cash).
    // State.openCase() defaults onStream to false, which would incorrectly
    // charge 1 energy here if omitted — must pass { onStream: true }.
    var res = G.State.openCase({ onStream: true });
    if (!res.ok) {
      var msg = res.reason === 'energy' ? 'NOT ENOUGH ENERGY' :
        res.reason === 'dead' ? 'CAREER OVER' :
        res.reason === 'room-incomplete' ? 'ROOM INCOMPLETE' : 'NOT ENOUGH CASH';
      G.UI.toast(msg, 'bad');
      return;
    }
    sess.caseBusy = true;
    hud.caseBtn.disabled = true;
    var item = res.item;

    // SPEC-V5 §3: State.openCase() above already charged the $7 but withheld
    // the payout — credit it only once the wheel has fully stopped and the
    // item is revealed, exactly like the off-stream Cases screen does. Before
    // this fix nothing on the on-stream path ever called creditCaseReveal, so
    // opening a case live never paid out at all.
    function creditAndResolve() {
      sess.caseHandle = null;
      if (res.pendingId && G.State.creditCaseReveal) G.State.creditCaseReveal(res.pendingId);
      onCaseResolved(item);
    }

    if (G.Cases && G.Cases.playRoulette) {
      sess.caseHandle = G.Cases.playRoulette(hud.caseSlot, item, {
        tileWidth: 44,
        tileCount: 40,
        // V22 (owner item 2): each case has its own item pool, and the
        // on-stream opener uses d.caseSelection.stream — a DIFFERENT tier from
        // the solo one. Without this the wheel would fill with the solo case's
        // items while the player opened the stream case.
        onStream: true,
        onDone: creditAndResolve
      });
    } else {
      creditAndResolve();
    }
  }

  function onCaseResolved(item) {
    if (!sess) return;
    if (hud.caseSlot) hud.caseSlot.innerHTML = '';
    sess.caseBusy = false;
    if (hud.caseBtn) hud.caseBtn.disabled = false;

    var isRare = item.rarity === 'covert' || item.rarity === 'rare';
    G.UI.toast('PULLED ' + item.skin + ' LIVE!', isRare ? 'good' : 'info');

    if (isRare) {
      sess.synergyMult = 10;
      // SPEC-V6 §1: a good on-stream pull SPIKES viewers above the plateau
      // and settles back, played out over 3-5s (updateViewers() animates
      // this via sess.viewerSpike) — no longer an instant single-frame
      // jump. Same magnitude as before (up to 3x or +400, whichever is
      // smaller) but now allowed to land above the plateau (cap*1.3) since
      // that's the whole point of the spike, and the underlying organic
      // sess.viewers plateau tracker is left untouched so viewers genuinely
      // settle back to wherever the stream actually was.
      var cap = sess.viewerCap || VIEWER_CAP;
      var spikeTarget = Math.min(sess.viewers * 3, sess.viewers + 400, cap * 1.3);
      var spikeAmount = Math.max(0, spikeTarget - sess.viewers);
      var spikeNow = performance.now();
      var spikeTotalMs = rand(3000, 5000);
      var spikeRampMs = spikeTotalMs * rand(0.28, 0.38);
      sess.viewerSpike = { startAt: spikeNow, peakAt: spikeNow + spikeRampMs, endAt: spikeNow + spikeTotalMs, amount: spikeAmount };
      if (root && G.UI.confetti) {
        var color = (G.Cases && G.Cases.rarityColor) ? G.Cases.rarityColor(item.rarity) : 'var(--gold)';
        G.UI.confetti(root, color);
      }
      G.UI.beep('rare');
      floodHypeChat();
    }
  }

  function floodHypeChat() {
    if (!sess) return;
    var now = performance.now();
    for (var i = 0; i < 4; i++) {
      sess.nextMsgAt = now;
      spawnMessage(now);
    }
  }

  // -- session end -----------------------------------------------------------
  function endSession(reason) {
    setRunning(false);
    stopLoop();
    if (!sess) return;
    if (sess.caseHandle) { sess.caseHandle.cancel(); sess.caseHandle = null; }

    var d = G.State.data;
    // SPEC-V5 §13r: cash was already accruing live every tick (sess.cashEarned,
    // driven by sess.cashPerEffectiveSecond captured in beginLoop) — reuse that
    // running total instead of re-deriving it, so the final payout always
    // matches what the player watched tick up on screen. Only the "sniped"
    // (tilt maxed out) penalty is applied here, same as before.
    var cash = sess.cashEarned;
    if (reason === 'sniped') cash *= 0.5;
    cash = Math.max(0, cash);

    var avgViewers = sess.viewerSampleCount > 0 ? (sess.viewerSampleSum / sess.viewerSampleCount) : sess.viewers;
    var followerGain = avgViewers * 0.05 * sess.synergyMult;
    var peakViewers = Math.round(sess.peakViewers);
    var combo = sess.combo;
    var subscribersGained = 0;

    // SPEC-V8 A2 fix: pass the session's real elapsed wall-clock time so
    // State.applyStreamResult() can advance `stream_minutes` sponsor
    // obligations. Reuse the same `now - sess.startTime` the count-up timer
    // (hud.time, see tick()) already computes each frame — don't re-derive
    // elapsed time a second way.
    var durationMs = performance.now() - sess.startTime;

    if (G.State.applyStreamResult) {
      var applied = G.State.applyStreamResult({ cash: cash, followers: followerGain, peakViewers: peakViewers, durationMs: durationMs });
      subscribersGained = (applied && applied.subscribersGained) || 0;
      // Report what was actually CREDITED, not what was sent in. state.js
      // scales all three of these by the location/tier multipliers (and
      // followers/views by the merch bonus on top), so the raw values passed
      // above are not what the player received. Showing them made a stream
      // that paid ~$25,000 announce $10,000 — a playtester caught it, and it
      // understated followers and peak viewers by the same mechanism.
      // applyStreamResult() has always returned the real figures; nobody read
      // them. Guarded so the defensive fallback path below still behaves.
      if (applied) {
        cash = applied.appliedCash;
        followerGain = applied.followers;
        peakViewers = applied.peakViewers;
      }
    } else {
      // defensive fallback — state.js is expected to own this.
      G.State.earn(cash);
      d.followers = (d.followers || 0) + followerGain;
      d.peakViewers = Math.max(d.peakViewers || 0, peakViewers);
      if (!d.stats) d.stats = { matches: 0, wins: 0, streams: 0, casesOpened: 0, bestPull: 0 };
      d.stats.streams = (d.stats.streams || 0) + 1;
      if (G.State.save) G.State.save();
    }

    if (reason === 'sniped') G.UI.toast('STREAM SNIPED', 'bad');

    sess = null;
    showResult({ cash: cash, followerGain: followerGain, peakViewers: peakViewers, subscribersGained: subscribersGained, combo: combo, reason: reason });
  }

  function showResult(result) {
    if (root) root.innerHTML = '';
    // SPEC-V6 §17: 'interrupted' is the onExit() backstop settling a session
    // that was live when the screen tore down (see onExit() above) — the
    // player is already mid-navigation to wherever they tapped, so this
    // must NOT call Router.back() on close (that would yank them off the
    // screen they were headed to) and skips the sniped/normal styling.
    var interrupted = result.reason === 'interrupted';
    var title = result.reason === 'sniped' ? 'STREAM SNIPED' : (interrupted ? 'STREAM ENDED EARLY' : 'STREAM ENDED');
    var color = result.reason === 'sniped' ? 'var(--danger)' : (interrupted ? 'var(--elo)' : 'var(--subs)');
    var lines = [
      'EARNED: ' + G.UI.money(result.cash),
      'NEW FOLLOWERS: +' + G.UI.compact(Math.round(result.followerGain)),
      'NEW SUBSCRIBERS: +' + G.UI.compact(Math.round(result.subscribersGained || 0)),
      'PEAK VIEWERS: ' + G.UI.compact(Math.round(result.peakViewers)),
      'BEST BAN COMBO: ' + result.combo
    ];
    if (result.reason === 'sniped') lines.push('TILT MAXED OUT — PAYOUT HALVED');
    if (interrupted) lines.push('PAID OUT FOR TIME ACTUALLY LIVE');

    G.UI.beep(result.reason === 'sniped' ? 'miss' : 'cash');

    G.UI.rewardCard({
      title: title,
      lines: lines,
      color: color,
      onClose: function () { if (!interrupted) G.Router.back(); }
    });

    if (result.reason !== 'sniped' && !interrupted) {
      var anchor = document.getElementById('modal-layer') || root;
      if (anchor && G.UI.confetti) G.UI.confetti(anchor, color);
    }
  }

  if (G.Router && G.Router.register) {
    G.Router.register('stream', { onEnter: onEnter, onExit: onExit });
  }

  G.Stream = {
    COST_ENERGY: COST_ENERGY,
    STREAM_MIN_MS: STREAM_MIN_MS,
    VIEWER_CAP: VIEWER_CAP,
    // SPEC-V6 §17: the hook Package U's nav lock reads (bottom nav + hub
    // SLEEP/CAREER) to block every screen-leaving action with a "end the
    // stream first" message while a session is live. The on-stream CASE
    // button is the one exception and doesn't navigate, so it never needs
    // to check this.
    // SPEC-V15-BATCH-C §3.2: `running` alone (not `running && sess`) so this
    // also reports live during the first-stream tutorial gate, where `sess`
    // is intentionally still null — the player already spent the energy to
    // go live and shouldn't be able to dodge the mandatory tap via the
    // bottom nav / back button. Every other path that sets running=true
    // (beginLoop()) still assigns sess in the same breath, so this is a
    // strict superset of the old check, not a behavior change for normal
    // sessions.
    isLive: function () { return !!running; }
  };
})();
