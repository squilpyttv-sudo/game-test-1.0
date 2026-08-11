/* ==========================================================================
   CS2 PRO SIMULATOR — js/audio.js
   Game.Audio — background music playlist + global volume control.

   MUSIC IS NOW REAL AUDIO FILES (V22b, owner's own tracks, in music/).
   This reverses the original "no audio files, none may be added" rule and
   HANDOFF-V2 §2's "all music and SFX are synthesised" line — the owner wrote
   three tracks for the game. SFX are still fully synthesised; nothing else
   about the no-external-assets rule changed (no images, no fonts, no CDN).

   WHY <audio> AND NOT WebAudio decodeAudioData: §2 also requires the game to
   run by opening index.html straight off the disk, and on file:// the fetch/
   XHR that decodeAudioData needs is blocked by the browser. HTMLAudioElement
   loads a relative path fine there, so the playlist uses one element and
   swaps its `src`. That also keeps only ONE track buffered at a time, which
   matters on mobile data — the three files are ~5.5MB together.

   ONE element, reused, on purpose: iOS unlocks audio per-ELEMENT on the first
   gesture-initiated play(). Reusing that same unlocked element for every
   later track is what lets track 2 start on its own when track 1 ends.

   Music volume and sound (SFX) volume are separate 0-100 sliders, persisted
   GLOBALLY (not per save-slot), and default to music 30 / sound 70
   (SPEC-V2 §4). 30 is deliberately modest — clearly audible, never loud —
   and the SETTINGS slider (js/title.js) moves it live.

   Division of responsibility for the SOUND slider: this module owns the
   value, js/ui.js applies it. `UI.playTone()` reads `Game.Audio.soundVolume()`
   and scales its own gain envelope. Nothing here touches the SFX path.
   ========================================================================== */
(function (G) {
  'use strict';

  var STORE_KEY = 'cs2sim.audio';
  var DEFAULT_MUSIC = 30;
  var DEFAULT_SOUND = 70;

  var musicVol = DEFAULT_MUSIC;
  var soundVol = DEFAULT_SOUND;
  var prefsLoaded = false;

  function clamp01to100(v) {
    v = Math.round(Number(v));
    if (isNaN(v)) return 0;
    return Math.max(0, Math.min(100, v));
  }

  function loadPrefs() {
    if (prefsLoaded) return;
    prefsLoaded = true;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj.music === 'number') musicVol = clamp01to100(obj.music);
        if (obj && typeof obj.sound === 'number') soundVol = clamp01to100(obj.sound);
      }
    } catch (e) { /* file:// or corrupt prefs — keep defaults */ }
  }

  function persistPrefs() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ music: musicVol, sound: soundVol })); } catch (e) { /* ignore */ }
  }

  loadPrefs();

  /* ------------------------------------------------------------------------
     SFX volume is applied by js/ui.js, which reads Game.Audio.soundVolume()
     inside its own playTone(). This module only owns the value.
     ------------------------------------------------------------------------ */

  /* ---- the playlist ------------------------------------------------------
     Three tracks, shuffled. TRACKS holds paths relative to index.html;
     encodeURI() is applied at assignment because the filenames contain
     spaces and parentheses, which are not legal raw in a URL. */
  var TRACKS = [
    'music/music (1).mp3',
    'music/music (2).mp3',
    'music/music (3).mp3'
  ];

  var el = null;        // the ONE reused <audio> element (see the header note)
  var order = [];       // shuffled play order
  var orderPos = 0;
  var running = false;

  function musicGainValue() {
    // Straight 0..1 mapping: the slider default of 30 lands on 0.30, which is
    // present but never loud. The old synth scaled by 0.11 because an
    // oscillator drone had to sit under everything; real music does not.
    return musicVol / 100;
  }

  /* reshuffle — Fisher-Yates, with one extra rule: the first track of a new
     cycle may not repeat the last track of the previous one. Without that,
     a 3-track shuffle plays the same song twice in a row about 1 time in 3,
     which is exactly often enough to read as "the shuffle is broken". */
  function reshuffle() {
    var last = order.length ? order[order.length - 1] : -1;
    var next = TRACKS.map(function (_, i) { return i; });
    for (var i = next.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = next[i]; next[i] = next[j]; next[j] = t;
    }
    if (next.length > 1 && next[0] === last) {
      var swap = 1 + Math.floor(Math.random() * (next.length - 1));
      var tmp = next[0]; next[0] = next[swap]; next[swap] = tmp;
    }
    order = next;
    orderPos = 0;
  }

  function ensureEl() {
    if (el) return el;
    try { el = new window.Audio(); } catch (e) { el = null; return null; }
    el.preload = 'none';   // never pre-buffer tracks the player may not reach
    el.loop = false;        // the playlist advances; a single track never loops
    el.volume = musicGainValue();
    // Advance on natural end AND on error — a track that fails to decode must
    // not silently end the music for the rest of the session.
    el.addEventListener('ended', function () { advance(); });
    el.addEventListener('error', function () { if (running) advance(); });
    return el;
  }

  function playCurrent() {
    var a = ensureEl();
    if (!a || !order.length) return;
    a.src = encodeURI(TRACKS[order[orderPos]]);
    var p = null;
    try { p = a.play(); } catch (e) { return; }
    // play() rejects when autoplay is blocked (no gesture yet). Swallow it:
    // Audio.start() is called again from the title screen's own tap handlers,
    // and an unhandled rejection in the console helps nobody.
    if (p && typeof p.catch === 'function') p.catch(function () {});
  }

  function advance() {
    if (!running) return;
    orderPos++;
    if (orderPos >= order.length) reshuffle();
    playCurrent();
  }

  var Audio = {};

  Audio.start = function () {
    if (running) {
      // Already going — but a tab-switch or an iOS interruption can leave the
      // element paused. Nudge it rather than restarting the track.
      if (el && el.paused) { var r = el.play(); if (r && r.catch) r.catch(function () {}); }
      return;
    }
    running = true;
    if (!order.length) reshuffle();
    playCurrent();
  };

  Audio.stop = function () {
    running = false;
    if (el) { try { el.pause(); } catch (e) { /* ignore */ } }
  };

  Audio.setMusicVolume = function (v) {
    musicVol = clamp01to100(v);
    persistPrefs();
    if (el) el.volume = musicGainValue();
  };

  // Exposed for verification: which track is playing and what the order is.
  Audio.__probe = function () {
    return {
      running: running, tracks: TRACKS.length,
      order: order.slice(), pos: orderPos,
      current: order.length ? TRACKS[order[orderPos]] : null,
      volume: el ? el.volume : null,
      paused: el ? el.paused : null,
      time: el ? el.currentTime : null,
      duration: el ? el.duration : null,
      // The element itself, so a verification pass can seek it and confirm the
      // playlist really advances on 'ended' rather than trusting the handler.
      element: el
    };
  };

  Audio.setSoundVolume = function (v) {
    soundVol = clamp01to100(v);
    persistPrefs();
  };

  Audio.musicVolume = function () { return musicVol; };
  Audio.soundVolume = function () { return soundVol; };

  G.Audio = Audio;
})(window.Game = window.Game || {});
