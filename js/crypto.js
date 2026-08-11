/* ==========================================================================
   CS2 PRO SIMULATOR — js/crypto.js
   The CRYPTO screen (SPEC-V10 Package C2): four coins, spot buy/sell, and
   the news feed. Pure renderer over State.cryptoStatus() — every rule
   (price walk, fees, cost basis, news reliability/fakeouts/resolution)
   already lives in js/state.js (Package C1); this file's only job is to
   make a headline readable as a real-but-unreliable edge (never a
   guarantee) and to make an informed sell possible (cost basis + P/L always
   visible, never buried).

   Deliberately orthogonal to the core loop (§6 of the spec): no energy
   cost, no gating, no wiring into scrims/streams/sponsors. Reached only via
   CAREER's nav row, same pattern as LEADERBOARD/TOURNAMENTS/SOCIAL.

   Tick pacing: State.tickCrypto() is wall-clock/catch-up based — it anchors
   on d.crypto.lastTickAt (epoch ms) and reconciles however many
   tickIntervalMs-sized steps have elapsed since the last call (capped at
   200 catch-up steps). That means the market keeps moving while the player
   is on any other screen with NO global loop required — this file only
   needs to call it on entry (to catch up immediately) and on a modest
   interval while the screen is open, exactly like career.js's scrim-quota
   ticker.
   ========================================================================== */
(function (G) {
  'use strict';

  var built = false;
  var els = {};
  var coinCards = {}; // coinId -> { root, priceEl, changeEl, canvas, holdRow, buyInput, sellRow, sellInput, lastQty }
  var tickTimer = null;

  var ERR_MSG = {
    'unknown-coin': 'UNKNOWN COIN',
    'invalid-amount': 'ENTER A VALID USD AMOUNT',
    'invalid-qty': 'ENTER A VALID QUANTITY',
    'insufficient-cash': 'NOT ENOUGH CASH',
    'insufficient-holdings': 'NOT ENOUGH HOLDINGS',
    'dead': 'MARKET UNAVAILABLE',
    'no-data': 'MARKET UNAVAILABLE'
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- icons
     Authored SVG only (ART-DIRECTION §2.5) — 24x24 viewBox, currentColor,
     the house set js/phone.js established. No emoji, no Unicode glyph doing
     icon duty anywhere in this file.

     These four render at 9-10px, beside 8-9px text. A 2px stroke on a 24
     viewBox would land at 0.75 device pixels there and disappear, so at this
     size the house register becomes the FILLED silhouette js/teams.js
     already uses for its 9px rank arrows — same viewBox, same currentColor,
     weight carried by area instead of by stroke. Sized by attribute because
     the rules for these elements live in css/teams.css, which this package
     does not own.

     Colour is not the only channel. The card and chip already tint
     green/red, so each pair is drawn to differ in SILHOUETTE first: an apex
     up vs an apex down, a two-stroke tick vs a four-armed X. Read them with
     the colour removed and they still separate. */
  var ICON_TREND_UP =
    '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true">' +
      '<path d="M12 4L21 18.6H3z" fill="currentColor"/>' +
    '</svg>';
  var ICON_TREND_DOWN =
    '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true">' +
      '<path d="M12 20L3 5.4h18z" fill="currentColor"/>' +
    '</svg>';

  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true">' +
      '<path d="M9.4 18.9L2.6 12.1l2.8-2.8 4 4L18.6 4.1l2.8 2.8z" fill="currentColor"/>' +
    '</svg>';
  var ICON_CROSS =
    '<svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true">' +
      '<path d="M6.2 3.4L12 9.2l5.8-5.8 2.8 2.8L14.8 12l5.8 5.8-2.8 2.8L12 14.8l-5.8 5.8-2.8-2.8L9.2 12 3.4 6.2z" fill="currentColor"/>' +
    '</svg>';

  /* The ✓/✗ these replace were the ONLY thing separating a right call from
     a wrong one for a screen reader — chip colour is not spoken. So each
     marker is aria-hidden SVG plus a .sr-only word (css/style.css).

     Visually-hidden text rather than aria-label or role="img" + <title>:
     naming an <svg> is still unevenly honoured across screen readers,
     whereas a hidden span is spoken by every one of them, and it leaves the
     icon markup byte-identical to the house set in js/phone.js.

     The ▲/▼ pair needs no such word — it is followed by the literal text
     "BULLISH" / "BEARISH", and repeating that would only stutter. */
  function marker(cls, svg, spokenWord) {
    var e = el('span', 'icon-inline ' + cls);
    e.innerHTML = svg;
    if (spokenWord) e.appendChild(el('span', 'sr-only', ' ' + spokenWord + ' '));
    return e;
  }

  function coinDef(coinId) {
    var list = G.Data.cryptoCoins || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === coinId) return list[i];
    return null;
  }

  function cssVar(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
    catch (e) { return '#888'; }
  }

  /* ---- formatting -------------------------------------------------------- */
  function fmtPrice(p) {
    if (!isFinite(p)) return '$0';
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return '$' + p.toFixed(2);
    return '$' + p.toFixed(4);
  }
  function fmtQty(q) {
    if (!isFinite(q) || q === 0) return '0';
    var decimals = Math.abs(q) >= 1 ? 4 : 6;
    var s = q.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function fmtMoneySigned(v) { return (v >= 0 ? '+' : '') + G.UI.money(v); }
  function relTime(ms) {
    var diff = Math.max(0, Date.now() - ms);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'JUST NOW';
    if (mins < 60) return mins + 'M AGO';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'H AGO';
    return Math.floor(hrs / 24) + 'D AGO';
  }

  /* ---- sparkline (canvas, drawn straight from the history array) -------- */
  function drawSparkline(canvas, history, color) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!history || history.length < 2) return;
    var min = history[0], max = history[0];
    for (var i = 1; i < history.length; i++) {
      if (history[i] < min) min = history[i];
      if (history[i] > max) max = history[i];
    }
    var range = (max - min) || (Math.abs(max) * 0.01) || 1;
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    for (var j = 0; j < history.length; j++) {
      var x = (j / (history.length - 1)) * (w - 4) + 2;
      var y = h - 3 - ((history[j] - min) / range) * (h - 6);
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function findCoinStatus(status, coinId) {
    for (var i = 0; i < status.coins.length; i++) if (status.coins[i].id === coinId) return status.coins[i];
    return null;
  }

  /* ---- DOM build (once) --------------------------------------------------- */
  function buildDom() {
    var root = G.Router.root('crypto');
    root.innerHTML =
      '<div class="screen-header"><span class="screen-header__title">CRYPTO</span><button class="btn screen-header__back" id="crypto-back">BACK</button></div>' +
      '<div class="crypto">' +
        '<div class="panel crypto-portfolio">' +
          '<div class="crypto-portfolio__head">' +
            '<span class="h-label">PORTFOLIO</span>' +
            '<span class="crypto-portfolio__total" id="crypto-total"></span>' +
          '</div>' +
          '<div class="crypto-portfolio__row">' +
            '<span class="crypto-portfolio__label">CASH</span><span class="crypto-portfolio__val" id="crypto-cash"></span>' +
          '</div>' +
          '<div class="crypto-portfolio__row">' +
            '<span class="crypto-portfolio__label">HOLDINGS VALUE</span><span class="crypto-portfolio__val" id="crypto-holdings-val"></span>' +
          '</div>' +
          '<div class="crypto-portfolio__row">' +
            '<span class="crypto-portfolio__label">UNREALIZED P/L</span><span class="crypto-portfolio__val" id="crypto-unrealized"></span>' +
          '</div>' +
          '<div class="crypto-portfolio__row">' +
            '<span class="crypto-portfolio__label">TOTAL P/L (INCL. REALIZED)</span><span class="crypto-portfolio__val" id="crypto-pnl"></span>' +
          '</div>' +
          '<div class="crypto-portfolio__fee" id="crypto-fee-note"></div>' +
        '</div>' +
        '<div class="panel crypto-news">' +
          '<div class="crypto-news__head">' +
            '<span class="h-label">NEWS FEED</span>' +
          '</div>' +
          '<div class="crypto-news__disclaimer">A headline gives you an edge, not a guarantee — it names a coin and a direction, but it can still resolve the wrong way, and even a right call plays out over days.</div>' +
          '<div class="crypto-news__list" id="crypto-news-list"></div>' +
          '<div class="crypto-news__track" id="crypto-news-track"></div>' +
        '</div>' +
        '<div class="crypto-coins" id="crypto-coins"></div>' +
      '</div>';

    els.total = document.getElementById('crypto-total');
    els.cash = document.getElementById('crypto-cash');
    els.holdingsVal = document.getElementById('crypto-holdings-val');
    els.unrealized = document.getElementById('crypto-unrealized');
    els.pnl = document.getElementById('crypto-pnl');
    els.feeNote = document.getElementById('crypto-fee-note');
    els.newsList = document.getElementById('crypto-news-list');
    els.newsTrack = document.getElementById('crypto-news-track');
    els.coinsWrap = document.getElementById('crypto-coins');

    document.getElementById('crypto-back').addEventListener('click', function () {
      G.UI.beep('click');
      // SPEC-V14 §4.3 — CRYPTO is a phone app now: BACK returns to the hub
      // with the phone open, not to CAREER (the old destination before the
      // phone existed). Same wrong-back-target bug already fixed three
      // times for teams.js/social.js/tournaments.js — go straight to the
      // correct target rather than Router.back().
      G.Router.go('hub');
      if (G.Phone && G.Phone.open) G.Phone.open();
    });

    var coins = G.Data.cryptoCoins || [];
    coins.forEach(function (coin) {
      els.coinsWrap.appendChild(buildCoinCard(coin));
    });

    built = true;
  }

  function buildCoinCard(coin) {
    var card = el('div', 'panel coin-card');
    card.id = 'crypto-coin-' + coin.id;

    var head = el('div', 'coin-card__head');
    var nameWrap = el('div', 'coin-card__name-wrap');
    nameWrap.appendChild(el('div', 'coin-card__name', coin.name + ' (' + coin.symbol + ')'));
    nameWrap.appendChild(el('span', 'coin-card__risk', 'RISK ±' + Math.round(coin.dailyVol * 100) + '%'));
    head.appendChild(nameWrap);
    var priceWrap = el('div', 'coin-card__price-wrap');
    var priceEl = el('div', 'coin-card__price', fmtPrice(coin.startPrice));
    var changeEl = el('div', 'coin-card__change', '');
    priceWrap.appendChild(priceEl);
    priceWrap.appendChild(changeEl);
    head.appendChild(priceWrap);
    card.appendChild(head);

    var canvas = document.createElement('canvas');
    canvas.width = 340; canvas.height = 46;
    canvas.className = 'coin-card__spark';
    card.appendChild(canvas);

    var holdRow = el('div', 'coin-card__holdings');
    card.appendChild(holdRow);

    var tradeWrap = el('div', 'coin-card__trade');

    var buyRow = el('div', 'coin-card__trade-row');
    var buyInput = document.createElement('input');
    buyInput.type = 'number'; buyInput.min = '0'; buyInput.step = 'any';
    buyInput.className = 'coin-card__input';
    buyInput.placeholder = 'USD TO SPEND';
    var buyMaxBtn = el('button', 'btn coin-card__quick-btn', 'MAX');
    var buyBtn = el('button', 'btn btn--primary coin-card__trade-btn', 'BUY');
    buyRow.appendChild(buyInput);
    buyRow.appendChild(buyMaxBtn);
    buyRow.appendChild(buyBtn);
    tradeWrap.appendChild(buyRow);

    var sellRow = el('div', 'coin-card__trade-row');
    var sellInput = document.createElement('input');
    sellInput.type = 'number'; sellInput.min = '0'; sellInput.step = 'any';
    sellInput.className = 'coin-card__input';
    sellInput.placeholder = 'QTY TO SELL';
    var sellMaxBtn = el('button', 'btn coin-card__quick-btn', 'MAX');
    var sellBtn = el('button', 'btn coin-card__trade-btn coin-card__trade-btn--sell', 'SELL');
    var sellAllBtn = el('button', 'btn coin-card__sell-all', 'SELL ALL');
    sellRow.appendChild(sellInput);
    sellRow.appendChild(sellMaxBtn);
    sellRow.appendChild(sellBtn);
    sellRow.appendChild(sellAllBtn);
    tradeWrap.appendChild(sellRow);

    card.appendChild(tradeWrap);

    buyMaxBtn.addEventListener('click', function () {
      var status = G.State.cryptoStatus();
      if (status) buyInput.value = Math.max(0, Math.floor(status.portfolio.cash));
    });
    buyBtn.addEventListener('click', function () { handleBuy(coin.id, buyInput); });
    sellMaxBtn.addEventListener('click', function () {
      var c = coinCards[coin.id];
      if (c) sellInput.value = c.lastQty || 0;
    });
    sellBtn.addEventListener('click', function () { handleSell(coin.id, sellInput); });
    sellAllBtn.addEventListener('click', function () { handleSellAll(coin.id); });

    coinCards[coin.id] = {
      root: card, priceEl: priceEl, changeEl: changeEl, canvas: canvas,
      holdRow: holdRow, sellRow: sellRow, buyInput: buyInput, sellInput: sellInput,
      lastQty: 0
    };
    return card;
  }

  /* ---- trading actions ---------------------------------------------------- */
  function handleBuy(coinId, input) {
    var coin = coinDef(coinId);
    var status = G.State.cryptoStatus();
    if (!coin || !status) return;
    var amt = parseFloat(input.value);
    if (!(amt > 0) || !isFinite(amt)) { G.UI.beep('miss'); G.UI.toast('ENTER A VALID USD AMOUNT', 'bad'); return; }
    if (amt > status.portfolio.cash + 1e-6) { G.UI.beep('miss'); G.UI.toast('NOT ENOUGH CASH', 'bad'); return; }
    var coinStat = findCoinStatus(status, coinId);
    var fee = amt * status.feeRate;
    var estQty = coinStat && coinStat.price > 0 ? (amt - fee) / coinStat.price : 0;

    G.UI.confirmModal({
      title: 'BUY ' + coin.symbol,
      text: 'Spot buy at the current market price, filled immediately. No leverage, no margin.',
      color: 'var(--cash)',
      lines: [
        { label: 'AMOUNT', value: G.UI.money(amt) },
        { label: 'FEE (' + (status.feeRate * 100).toFixed(1) + '%)', value: '-' + G.UI.money(fee), color: 'var(--danger)' },
        { label: 'EST. QTY', value: fmtQty(estQty) + ' ' + coin.symbol }
      ],
      yesText: 'CONFIRM BUY',
      noText: 'CANCEL',
      onYes: function () {
        var res = G.State.buyCrypto(coinId, amt);
        if (!res.ok) { G.UI.beep('miss'); G.UI.toast(ERR_MSG[res.reason] || 'COULD NOT BUY', 'bad'); return; }
        G.UI.beep('cash');
        G.UI.toast('BOUGHT ' + fmtQty(res.qty) + ' ' + coin.symbol, 'good');
        input.value = '';
        render();
      }
    });
  }

  function sellConfirm(coin, status, coinStat, qty, isAll) {
    var fee = qty * coinStat.price * status.feeRate;
    var proceeds = qty * coinStat.price - fee;
    G.UI.confirmModal({
      title: (isAll ? 'SELL ALL ' : 'SELL ') + coin.symbol,
      text: 'Spot sell at the current market price, filled immediately.',
      color: 'var(--danger)',
      lines: [
        { label: 'QTY', value: fmtQty(qty) + ' ' + coin.symbol },
        { label: 'FEE (' + (status.feeRate * 100).toFixed(1) + '%)', value: '-' + G.UI.money(fee), color: 'var(--danger)' },
        { label: 'EST. PROCEEDS', value: G.UI.money(proceeds), color: 'var(--cash)' }
      ],
      yesText: isAll ? 'CONFIRM SELL ALL' : 'CONFIRM SELL',
      noText: 'CANCEL',
      onYes: function () {
        var res = G.State.sellCrypto(coin.id, qty);
        if (!res.ok) { G.UI.beep('miss'); G.UI.toast(ERR_MSG[res.reason] || 'COULD NOT SELL', 'bad'); return; }
        G.UI.beep('cash');
        var realizedTxt = res.realized >= 0 ? ' (+' + G.UI.money(res.realized) + ')' : ' (' + G.UI.money(res.realized) + ')';
        G.UI.toast('SOLD ' + fmtQty(res.qty) + ' ' + coin.symbol + realizedTxt, res.realized >= 0 ? 'good' : 'bad');
        render();
      }
    });
  }

  function handleSell(coinId, input) {
    var coin = coinDef(coinId);
    var status = G.State.cryptoStatus();
    if (!coin || !status) return;
    var coinStat = findCoinStatus(status, coinId);
    var qty = parseFloat(input.value);
    if (!(qty > 0) || !isFinite(qty)) { G.UI.beep('miss'); G.UI.toast('ENTER A VALID QUANTITY', 'bad'); return; }
    if (!coinStat || qty > coinStat.qty + 1e-6) { G.UI.beep('miss'); G.UI.toast('NOT ENOUGH HOLDINGS', 'bad'); return; }
    sellConfirm(coin, status, coinStat, qty, false);
    input.value = '';
  }

  function handleSellAll(coinId) {
    var coin = coinDef(coinId);
    var status = G.State.cryptoStatus();
    if (!coin || !status) return;
    var coinStat = findCoinStatus(status, coinId);
    if (!coinStat || !(coinStat.qty > 0)) { G.UI.beep('miss'); G.UI.toast('NO HOLDINGS TO SELL', 'bad'); return; }
    sellConfirm(coin, status, coinStat, coinStat.qty, true);
  }

  /* ---- news feed ------------------------------------------------------- */
  function buildNewsCard(ev) {
    var coin = coinDef(ev.coinId);
    var card = el('div', 'panel news-card news-card--' + ev.direction);
    var head = el('div', 'news-card__head');
    head.appendChild(el('span', 'news-card__coin', coin ? coin.symbol : ev.coinId));
    var up = ev.direction === 'up';
    var dir = marker('news-card__dir news-card__dir--' + ev.direction, up ? ICON_TREND_UP : ICON_TREND_DOWN, null);
    dir.appendChild(document.createTextNode(up ? 'BULLISH' : 'BEARISH'));
    head.appendChild(dir);
    head.appendChild(el('span', 'news-card__time', relTime(ev.createdAt)));
    card.appendChild(head);
    card.appendChild(el('div', 'news-card__text', ev.text));

    var ticksPerDay = (G.Data.crypto && G.Data.crypto.ticksPerDay) || 6;
    var daysLeft = Math.max(0, Math.ceil(ev.ticksRemaining / ticksPerDay));
    var meter = el('div', 'meter news-card__meter');
    var fill = el('div', 'meter__fill news-card__meter-fill');
    fill.style.width = Math.round(Math.max(0, Math.min(1, ev.progress)) * 100) + '%';
    meter.appendChild(fill);
    card.appendChild(meter);
    card.appendChild(el('div', 'news-card__meta',
      'RESOLVING OVER ' + ev.totalDays + ' DAYS · ~' + daysLeft + ' DAY' + (daysLeft === 1 ? '' : 'S') + ' LEFT'));
    return card;
  }

  function buildTrackRecord(status) {
    var hist = status.newsHistory || [];
    var wrap = el('div', 'news-track');
    if (!hist.length) {
      wrap.appendChild(el('div', 'news-track__empty', 'NO RESOLVED HEADLINES YET — CHECK BACK AS ACTIVE ONES PLAY OUT.'));
      return wrap;
    }
    var correct = 0, fakeouts = 0;
    for (var i = 0; i < hist.length; i++) {
      if (hist[i].correct) correct++;
      if (hist[i].fakeout) fakeouts++;
    }
    wrap.appendChild(el('div', 'news-track__stat',
      'TRACK RECORD — ' + correct + ' / ' + hist.length + ' CALLED IT RIGHT (' +
      Math.round((correct / hist.length) * 100) + '%) · ' + fakeouts + ' FAKE-OUT' + (fakeouts === 1 ? '' : 'S')));
    var strip = el('div', 'news-track__strip');
    var recent = hist.slice(-8).reverse();
    recent.forEach(function (h) {
      var coin = coinDef(h.coinId);
      var chip = el('span', 'icon-inline news-track__chip' + (h.correct ? ' news-track__chip--right' : ' news-track__chip--wrong'));
      chip.appendChild(document.createTextNode(coin ? coin.symbol : h.coinId));
      chip.appendChild(marker('', h.correct ? ICON_CHECK : ICON_CROSS, h.correct ? 'called right' : 'called wrong'));
      if (h.fakeout) chip.appendChild(document.createTextNode('• FAKE-OUT'));
      strip.appendChild(chip);
    });
    wrap.appendChild(strip);
    return wrap;
  }

  /* ---- render ------------------------------------------------------------ */
  function renderCoinCard(coinStat) {
    var c = coinCards[coinStat.id];
    if (!c) return;
    c.priceEl.textContent = fmtPrice(coinStat.price);

    var hist = coinStat.history || [];
    var first = hist.length ? hist[0] : coinStat.price;
    var changePct = first ? ((coinStat.price - first) / first) * 100 : 0;
    c.changeEl.textContent = fmtPct(changePct);
    c.changeEl.className = 'coin-card__change ' + (changePct >= 0 ? 'coin-card__change--pos' : 'coin-card__change--neg');
    drawSparkline(c.canvas, hist, changePct >= 0 ? cssVar('--cash') : cssVar('--danger'));

    c.lastQty = coinStat.qty;
    c.holdRow.innerHTML = '';
    if (coinStat.qty > 1e-9) {
      c.holdRow.appendChild(el('div', 'coin-card__hold-line',
        'QTY ' + fmtQty(coinStat.qty) + '  ·  AVG COST ' + fmtPrice(coinStat.avgCost) +
        '  ·  COST BASIS ' + G.UI.money(coinStat.costBasis)));
      var pnlLine = el('div', 'coin-card__pnl' + (coinStat.unrealizedPnl >= 0 ? ' coin-card__pnl--pos' : ' coin-card__pnl--neg'),
        'UNREALIZED P/L ' + fmtMoneySigned(coinStat.unrealizedPnl));
      c.holdRow.appendChild(pnlLine);
      if (Math.abs(coinStat.realizedPnl) > 0.005) {
        c.holdRow.appendChild(el('div', 'coin-card__realized', 'REALIZED ' + fmtMoneySigned(coinStat.realizedPnl)));
      }
      c.sellRow.style.display = '';
    } else {
      c.holdRow.appendChild(el('div', 'coin-card__hold-line coin-card__hold-line--empty', 'NO HOLDINGS'));
      c.sellRow.style.display = 'none';
    }
  }

  function render() {
    var status = G.State.cryptoStatus();
    if (!status) return;
    var p = status.portfolio;

    els.total.textContent = G.UI.money(p.totalValue);
    els.cash.textContent = G.UI.money(p.cash);
    els.holdingsVal.textContent = G.UI.money(p.holdingsValue);
    els.unrealized.textContent = fmtMoneySigned(p.unrealizedPnl);
    els.unrealized.className = 'crypto-portfolio__val ' + (p.unrealizedPnl >= 0 ? 'crypto-portfolio__val--pos' : 'crypto-portfolio__val--neg');
    var totalPnl = p.unrealizedPnl + p.realizedPnl;
    els.pnl.textContent = fmtMoneySigned(totalPnl);
    els.pnl.className = 'crypto-portfolio__val ' + (totalPnl >= 0 ? 'crypto-portfolio__val--pos' : 'crypto-portfolio__val--neg');
    els.feeNote.textContent = 'SPOT ONLY · NO LEVERAGE · ' + (status.feeRate * 100).toFixed(1) + '% FEE PER TRADE';

    status.coins.forEach(renderCoinCard);

    els.newsList.innerHTML = '';
    if (!status.news.length) {
      els.newsList.appendChild(el('div', 'news-empty', 'NO ACTIVE HEADLINES RIGHT NOW — CHECK BACK SOON.'));
    } else {
      status.news.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (ev) {
        els.newsList.appendChild(buildNewsCard(ev));
      });
    }
    els.newsTrack.innerHTML = '';
    els.newsTrack.appendChild(buildTrackRecord(status));
  }

  /* ---- tick loop -----------------------------------------------------------
     tickCrypto() is catch-up based (see file header) — this just needs to
     call it periodically while the screen is open so price/news updates are
     visible without the player having to leave and return. Cancelled on
     exit, same pattern as career.js's quotaTickTimer. */
  function startTicker() {
    stopTicker();
    tickTimer = setInterval(function () {
      G.State.tickCrypto();
      // SPEC-V13 §8C: headlines read live while the screen stays open must
      // not still be flagged unseen when the player leaves.
      G.State.markCryptoNewsSeen();
      render();
    }, 1000);
  }
  function stopTicker() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  window.Game = window.Game || {};
  window.Game.Router = window.Game.Router || {};
  window.Game.Router.register('crypto', {
    onEnter: function () {
      if (!built) buildDom();
      G.State.tickCrypto(); // catch up immediately on entry
      G.State.markCryptoNewsSeen(); // SPEC-V13 §8C
      render();
      startTicker();
    },
    onExit: function () {
      stopTicker();
    }
  });

  window.Game.Crypto = { ready: true };
})(window.Game = window.Game || {});
