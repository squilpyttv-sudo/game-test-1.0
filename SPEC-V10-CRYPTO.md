# CS2 PRO SIMULATOR — V10: CRYPTO MARKET (CONTRACT)

Last of the three approved mid-game systems (`SPEC-V7-BACKLOG.md`).
Sponsorships shipped in `SPEC-V8-SPONSORS.md`, social media in
`SPEC-V9-SOCIAL.md`.

All earlier hard constraints apply: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860 portrait.

---

## THE ONE RULE THIS SYSTEM LIVES OR DIES BY

**A pure random walk is a slot machine with extra steps.** If prices are
unpredictable noise, the player never feels clever and this becomes a second
casino sitting next to the case roulette.

News headlines must give a **real but unreliable edge**: reading them must beat
ignoring them over time, without ever being a sure thing. Every design decision
below serves that.

**NO LEVERAGE. No margin, no liquidation.** This is the owner's explicit
decision, reversing an earlier proposal, and the reasoning must not be
re-litigated: leverage plus readable headlines is trivially exploitable — read
one headline, go all-in at 10x, print money. Spot-only keeps this an investment
decision instead of a one-shot exploit.

---

## 0. OWNERSHIP

| Package | Owns |
|---|---|
| **C1 — rules & data** | `js/data.js`, `js/state.js` |
| **C2 — UI** | `js/crypto.js` (new), `js/career.js`, `css/teams.css` |

C1 lands first and is frozen; C2 follows. The lead pre-wires `index.html`,
`#screen-crypto` and a `js/crypto.js` stub before C2 starts.

---

## 1. The coins

**Four coins** with clearly different volatility, so the choice of *what* to
hold matters as much as *when*. Names should be recognisable-but-fake, in the
same spirit as the scrambled team names:

| Coin | Character | Daily volatility |
|---|---|---|
| **BITCOYN** | blue chip, slow | ±2% |
| **ETHERIUM** | mid-cap | ±5% |
| **SOLANO** | high beta | ±10% |
| **DOGEBORK** | memecoin, absurd | ±22% |

Start prices should differ by orders of magnitude (e.g. $40,000 / $2,500 / $150
/ $0.12) so the portfolio reads like a real exchange.

---

## 2. Price movement

- Prices tick **several times per in-game day** (suggest ~6), so a position can
  be opened and closed within a single day rather than only at wake.
- Base movement is a **random walk with mild mean reversion** so nothing runs to
  zero or infinity over a long save. Clamp to a sane floor.
- **News events add a drift on top** (see §4) — they bias the walk, they do not
  replace it. A correct read should still sometimes lose.

---

## 3. Trading

- **Buy and sell any amount, at any time.** Spot only.
- Holdings are per-coin, fractional allowed.
- Show the player's **cost basis and unrealised P/L** per coin — without it
  there is no way to make an informed sell decision.
- A small **transaction fee** (~0.5%) discourages pure noise-trading.

---

## 4. News headlines — the heart of it

Each headline names a coin and telegraphs a direction. Examples in the owner's
voice:

- *"US crypto regulation expected to ease over the coming days"* → up
- *"Major exchange announces surprise delisting review"* → down
- *"Institutional fund reveals large position"* → up

Four properties keep it skilful rather than exploitable:

1. **Imperfect reliability — a headline points the right way ~68% of the time.**
   Not always. The player must be able to lose on a correct read.
2. **Unknown magnitude.** Direction is hinted; size is not. A "good" headline
   might move a coin 3% or 30%.
3. **Fake-outs.** ~15% of headlines move the price the *opposite* way first
   before resolving, or reverse entirely.
4. **Staggered resolution over 2–4 days.** The move plays out gradually, so the
   player must also decide **when to exit** — not just when to enter. This is
   the property that stops the whole system from being a single decision.

Headlines arrive on a feed with timestamps, a few per week, and remain visible
while active.

---

## 5. Scale it to the late game

This exists to give a mid/late-game player something to do with money. Position
sizes should be meaningful against late-game income (tens of thousands of
dollars), while remaining usable at Tier 3.

**It is a store of money, not a sink** — it does not remove cash from the
economy. That is fine and expected; the real sinks are the penthouse ($600k),
the private island ($3M), and staff upkeep.

---

## 6. Do NOT connect it to the core loop

Deliberate design constraint: crypto must **not** cost energy, gate any career
progression, or interact with sponsors, scrims or streams. It is the one system
the player engages with *between* decisions, not instead of them. Keeping it
orthogonal is why it was scheduled last.

---

## 7. Save-schema warning

`normalizeSave()` only copies keys present in `defaultData()`. **Every new
persisted field must be added there** — coin prices, price history, holdings,
cost basis, active news events and their resolution state — or it is silently
dropped on load. This has bitten the project five times.

Note prices must persist: a player who reloads must not find a fresh market.

---

## Package C1 — API additions

Everything below is live in `js/data.js` and `js/state.js`. C2 should never
need to open `state.js` — read prices/holdings/news through
`State.cryptoStatus()`, and act through `buyCrypto`/`sellCrypto`/
`sellAllCrypto`/`tickCrypto`. All existing `Game.State.*`/`Game.Data.*` names
are untouched — this is purely additive.

Internally, a "day" always means `Data.crypto.ticksPerDay` consecutive price
ticks (~6) — an internal market-pacing unit, **decoupled from `d.day`**
(which only advances on sleep). Crypto ticks are wall-clock paced
(`Data.crypto.tickIntervalMs`, default 20s) so the market keeps moving
through a long uninterrupted session without requiring the player to sleep.

### Data.cryptoCoins

```js
Game.Data.cryptoCoins = [
  { id: 'BITCOYN',  name: 'Bitcoyn',  symbol: 'BCN',  startPrice: 40000, dailyVol: 0.02 },
  { id: 'ETHERIUM', name: 'Etherium', symbol: 'ETM',  startPrice: 2500,  dailyVol: 0.05 },
  { id: 'SOLANO',   name: 'Solano',   symbol: 'SLO',  startPrice: 150,   dailyVol: 0.10 },
  { id: 'DOGEBORK', name: 'Dogebork', symbol: 'BORK', startPrice: 0.12,  dailyVol: 0.22 }
];
```
`dailyVol` is the coin's ± daily volatility band (informational for the UI —
e.g. show a risk badge). 4 fixed coins; iterate this array rather than
hardcoding ids so a future 5th coin needs no UI change.

### Data.crypto (market config)

```js
Game.Data.crypto = {
  ticksPerDay: 6, tickIntervalMs: 20000, feeRate: 0.005,
  reversionStrength: 0.03, floorFactor: 0.02, ceilingFactor: 50,
  historyMaxLen: 120,
  news: {
    reliability: 0.68, fakeoutRate: 0.15,
    magnitudeMin: 0.03, magnitudeMax: 0.30, fakeoutTickFraction: 0.3,
    resolveDaysMin: 2, resolveDaysMax: 4,
    minGapTicks: 18, maxGapTicks: 40, maxActive: 4,
    headlines: [ { direction: 'up'|'down', text: '...{COIN}...' }, ... ]
  }
};
```
`feeRate` (0.005 = 0.5%) is authoritative — also echoed back on
`State.cryptoStatus().feeRate` so the UI never needs to import `data.js`
itself.

### State.data.crypto (persisted shape)

Already wired into `defaultData()`/`normalizeSave()` — every field below
round-trips through save/reload. C2 should read via `State.cryptoStatus()`
below rather than touching this directly, but the raw shape is:

```js
State.data.crypto = {
  prices:  { BITCOYN: 41998.87, ... },        // current price per coin
  history: { BITCOYN: [40000, 40120, ...] },  // capped at Data.crypto.historyMaxLen, oldest first
  holdings: {
    BITCOYN: { qty: 0.238, costBasis: 10000, realizedPnl: 0 }, // costBasis = total cash EVER put in (incl. fees), weighted down on sell
    ...
  },
  news: [ /* active, unresolved events — internal shape, see below */ ],
  newsHistory: [ /* capped at 300, resolved events log */ ],
  tickCount: 12345,       // total price ticks processed, ever
  lastTickAt: 1735999999, // epoch ms, real-time anchor for tickCrypto()
  nextNewsAtTick: 12360   // tickCount at/after which another headline may spawn
};
```

### State.tickCrypto()

`State.tickCrypto()` → `{ ticked: number }`

Call on an interval (same pattern as `State.tickEnergy()` — e.g. from a
`requestAnimationFrame`/`setInterval` poll while the app is open). Safe to
call as often as desired; only accounts for real elapsed time since the last
call, so calling it every frame is fine. Advances prices + news by however
many `Data.crypto.tickIntervalMs`-sized steps have elapsed (capped at 200
catch-up steps after a long gap — excess backlog is dropped, not queued).
Only saves when at least one tick actually happened.

**C2 must call this periodically for the market to move at all** — there is
no other driver of price ticks in normal play.

### State.cryptoStatus()

`State.cryptoStatus()` → read-only snapshot, the one call C2 needs for the
whole screen:

```js
{
  feeRate: 0.005,
  coins: [
    {
      id: 'BITCOYN', name: 'Bitcoyn', symbol: 'BCN', dailyVol: 0.02,
      price: 41998.87,
      history: [40000, 40120, ...],      // for the sparkline, oldest first
      qty: 0.238, costBasis: 10000, avgCost: 42016.8,
      value: 9995.72,                     // qty * price
      unrealizedPnl: -4.28,               // value - costBasis
      realizedPnl: 0                      // cumulative from past sells
    },
    ... one entry per coin, in Data.cryptoCoins order
  ],
  news: [
    {
      id: 'i...', coinId: 'SOLANO', text: 'Institutional fund reveals large Solano position',
      direction: 'up',        // TELEGRAPHED direction only — reliability/fakeout stay hidden until resolved
      createdAt: 1735999999,  // epoch ms, for the feed's timestamp
      totalDays: 3,            // resolution window length (2-4)
      progress: 0.4,           // 0..1, how far through resolution
      ticksRemaining: 11
    }, ...
  ],
  newsHistory: [               // last 30 resolved events — a visible track record
    { id, coinId, text, telegraphDir: 'up'|'down', actualDir: 'up'|'down', correct: bool, fakeout: bool, resolvedAtTick },
    ...
  ],
  portfolio: {
    cash: 9500, holdingsValue: 9995.72, costBasis: 10000,
    unrealizedPnl: -4.28, realizedPnl: 0, totalValue: 19495.72 // holdingsValue + cash
  }
}
```

### Trading

`State.buyCrypto(coinId, usdAmount)` → spends `usdAmount` of cash (fee
already included in that outlay — never more cash leaves the wallet than
`usdAmount`). Fractional qty. Rejects with `{ ok:false, reason }` for
`unknown-coin` / `invalid-amount` / `insufficient-cash` / `dead`. No
leverage: `usdAmount` can never exceed `d.cash`, enforced server-side (i.e.
here), not just in the UI.
→ on success: `{ ok:true, coinId, qty, price, fee, spent, cash, holding }`

`State.sellCrypto(coinId, qty)` → sells `qty` at current price, fee taken
from proceeds, cost basis reduced proportionally (weighted-average method),
`realizedPnl` accumulated on the holding. Rejects `unknown-coin` /
`invalid-qty` / `insufficient-holdings` / `dead`.
→ on success: `{ ok:true, coinId, qty, price, fee, proceeds, realized, cash, holding }`

`State.sellAllCrypto(coinId)` → convenience wrapper, sells the full current
holding. `{ ok:false, reason:'insufficient-holdings' }` if 0 held.

### Debug/tooling (not needed for normal play)

`State.cryptoSimulateTicks(n)` — synchronously fast-forwards `n` price
ticks, bypassing real-time pacing. `State.cryptoDebugSpawnNews([coinId])` —
forces an immediate headline, bypassing the normal spawn cooldown/cap. Both
exist for testing; C2 has no reason to call either in the shipped UI.

### What C1 left to the UI (Package C2)

- All rendering: coin list, sparkline chart from `history`, buy/sell forms,
  news feed cards, portfolio summary.
- Deciding how often to call `State.tickCrypto()` (a poll loop; a `~1s`
  interval is plenty smooth given `tickIntervalMs` defaults to 20s per
  actual price step).
- `index.html`'s `#screen-crypto` and its nav entry, and swapping
  `js/crypto.js`'s stub for the real screen controller.
- Any UI-side amount input affordances (e.g. "buy $X" vs "buy Y coins" —
  the API takes USD for buys and qty for sells, matching how a real spot
  exchange quotes fractional crypto).

### Verification

A headless Node smoke test (`vm`-sandboxed `data.js`+`state.js`, no
localStorage) covered: 20,000 simulated price ticks with no coin hitting
zero/negative/infinity and all staying within their floor/ceiling clamp;
buy/sell with exact fee (0.5%) and cost-basis/unrealized-P&L arithmetic;
rejection of oversells and of buys beyond available cash (no leverage);
resolution genuinely spanning multiple ticks (12-24, i.e. 2-4 ×
`ticksPerDay`) rather than resolving instantly; and a genuine cross-realm
save→reload round trip (two separate `vm` sandboxes sharing one
`localStorage` shim) proving prices, holdings, cost basis, and active news
all survive.

**Measured news reliability over 300 resolved headlines (rolling log cap):
69.3% resolved in the telegraphed direction** (target ~68%), with a
**measured fake-out rate of 15.3%** (target ~15%) — both comfortably away
from 100%/0%, confirming a correct read can still lose and headlines are a
real-but-unreliable edge rather than a guarantee.
