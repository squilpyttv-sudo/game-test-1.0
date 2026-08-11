/* ==========================================================================
   CS2 PRO SIMULATOR — js/router.js
   Minimal screen switcher. Screens live in #screen-stack; exactly one has
   the `is-active` class at any time.
   ========================================================================== */
(function () {
  'use strict';

  var screens = {};   // name -> { onEnter(params), onExit() }
  var current = null;

  var Router = {};

  Router.register = function (name, def) {
    screens[name] = def || {};
  };

  Router.root = function (name) {
    return document.getElementById('screen-' + name);
  };

  Router.go = function (name, params) {
    if (!screens[name]) {
      console.warn('[Router] no screen registered for "' + name + '"');
      return false;
    }
    var root = Router.root(name);
    if (!root) {
      console.warn('[Router] missing DOM root #screen-' + name);
      return false;
    }
    if (current && current !== name && screens[current] && typeof screens[current].onExit === 'function') {
      try { screens[current].onExit(); } catch (e) { console.error('[Router] onExit error for ' + current, e); }
    }
    var allScreens = document.querySelectorAll('#screen-stack .screen');
    for (var i = 0; i < allScreens.length; i++) allScreens[i].classList.remove('is-active');
    root.classList.add('is-active');
    current = name;
    if (typeof screens[name].onEnter === 'function') {
      try { screens[name].onEnter(params || {}); } catch (e) { console.error('[Router] onEnter error for ' + name, e); }
    }
    return true;
  };

  Router.back = function () {
    Router.go('hub');
  };

  Router.current = function () { return current; };
  Router.isRegistered = function (name) { return !!screens[name]; };

  window.Game = window.Game || {};
  window.Game.Router = Router;
})();
