# CS2 PRO SIMULATOR — V7 FIX BATCH (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V6.md`. Where they disagree, **this wins**. All
earlier hard constraints still apply: vanilla JS, no ES modules, no
dependencies, no external assets, `file://`-safe, tokens-only CSS.

These are playtest fixes that must land **before** the V7 sponsorship work in
`SPEC-V7-BACKLOG.md`.

---

## 0. FILE OWNERSHIP MAP

| Package | Owns | Items |
|---|---|---|
| **X — core rules & data** | `js/data.js`, `js/state.js` | 3r, 5r, 10 |
| **Y — viewport, room & zoom** | `js/hub.js`, `js/iso.js`, `js/main.js`, `css/style.css`, `css/tokens.css`, `index.html` | 1, 2, 4, 7, 9 |
| **Z — career & shop** | `js/career.js`, `js/shop.js`, `js/tournaments.js`, `css/teams.css` | 3u, 5u, 6, 8 |

**Ordering:** X first, then Y and Z in parallel.

---

## 1. Must work on tall iPhones with a notch (Y)

Target up to a **19.5:9** aspect ratio with a **top notch / dynamic island** and
a bottom home indicator.

- `index.html` already sets `viewport-fit=cover`; now actually **use the safe
  area**: pad the top bar with `env(safe-area-inset-top)` and the bottom nav
  with `env(safe-area-inset-bottom)`, with sane fallbacks for browsers that
  report zero.
- **No stat may be hidden or clipped** behind the notch or the home indicator —
  cash, followers, subscribers, viewers, day, energy, rank.
- The 420x860 frame must scale gracefully to taller ratios rather than
  overflowing or letterboxing badly. Verify at **375x812**, **390x844** and
  **430x932**.

---

## 2. The edit tray hides too much of the room (Y)

The edit menu currently covers about a third of the room.

- Show **only a single row** of items when the tray is open, scrolled
  horizontally, so it occupies a thin strip instead of a panel.
- **Bigger rooms zoom out more.** The default camera must always frame the
  **whole** room — as the grid grows 6x6 → 11x11 the view scales down to keep
  everything visible.

---

## 3. Energy drinks need a fridge to store (X rules, Z shop)

Energy drinks are currently buyable with no prerequisite.

- **Locked until the player owns a fridge.**
- **MINI FRIDGE → holds up to 4** energy drinks.
- **FULL FRIDGE → holds up to 12.**
- The existing **4-per-day** consumption limit is unchanged.
- Buying beyond your storage capacity is blocked, with the reason stated.
- Make the fridges purchasable items in the shop (they may reuse the existing
  `energy`/decor prop families visually).

---

## 4. Pinch and scroll to zoom the room (Y)

- **Mouse wheel** zooms **toward the cursor position**.
- **Two-finger pinch** zooms on touch.
- Motion must be **smooth**, not stepped.
- **Maximum zoom-out = the whole room visible** (i.e. today's default framing).
  You may not zoom out past that.
- Pick a sensible max zoom-in and clamp panning so the room cannot be dragged
  off-screen.

---

## 5. BIG BUG — sleep is deadlocked during a tournament (X rules, Z copy)

**Reported:** signed to a Tier 3 team, played and **won** today's tournament
match, and now cannot sleep at all. The game says a tournament is pending.

**Root cause (already traced — do not re-diagnose):** SPEC-V5 §21 added "block
SLEEP entirely while a tournament is pending", where `tournamentPending()` in
`js/hub.js` is simply *"a bracket exists and is not done"*. SPEC-V6 §9 then made
tournaments run **one match per day**, so after winning, the bracket is still
not done — but the next match only becomes available **after sleeping**. The two
rules deadlock the save.

**Fix:** sleep must be blocked **only when there is a match the player can
actually play right now**. Once today's match is done, sleeping is the intended
next action and must be allowed. Expose this as a single state-level predicate
(e.g. "is there an unplayed match available today") and have the hub use it
instead of the bracket-not-done test.

**Copy fix (Z):** the tournament screen currently says *"Come back after your
next sleep."* Change to **"NEXT MATCH TOMORROW"** — the player thinks in days.

---

## 6. Coaches DO fill the scrim quota — the CAREER SCREEN is lying (Z)

**Reported three times now.** Previous agents checked the state layer, found it
correct, and reported it working. They were right about the state and wrong
about the bug.

**Actual defect (already traced — do not re-diagnose):**
`js/career.js` lines ~413–415 read the **raw counter**:

```js
var pct = quota > 0 ? Math.min(100, (data.scrimsToday / quota) * 100) : 100;
els.quotaVal.textContent = data.scrimsToday + ' / ' + quota;
```

`js/career.js` calls `State.scrimQuotaStatus()` **zero times**. The coach's
contribution lives in `effectiveScrimQuota()` inside `state.js`, which
`scrimQuotaStatus()` wraps — and the end-of-day miss/penalty check *does* use it
correctly, so the player is not actually being penalised. But the career screen
shows `0 / 60` and reads as broken.

**Fix:** career.js must render from `State.scrimQuotaStatus()` (`progress`,
`quota`, `met`), never from `data.scrimsToday`. **Audit every other UI file for
the same raw read.**

### The coach's contribution must be VISIBLE, not just correct

Fixing the read is not enough — the owner wants to *watch it happen*:

- **L2 TEAM ANALYST (`gradual`)** — the quota bar must **visibly fill across the
  day**, ending full by nightfall. Note `effectiveScrimQuota()` derives this
  from `wakeElapsedMs`, which advances continuously **without emitting a
  `change` event every tick**. So a screen that only re-renders on `change`
  will look frozen. **The career screen must refresh on its own interval while
  open** (and cancel that interval on exit) so the bar actually moves.
- **L3 VETERAN IGL (`auto`)** — the bar must read **full immediately on
  waking**, with no player action.
- **L1 ROOKIE COACH (`remind`)** — no fill; it only warns at bedtime. The bar
  reflects the player's own scrims.

In every coached case, **say who is doing it** — e.g. *"VETERAN IGL is running
practice for you"* or *"TEAM ANALYST is drilling the team through the day"* —
so the fill never looks like a bug.

---

## 7. Energy drinks must not appear in the edit-room tray (Y)

Owning drinks currently puts them in the room-editing inventory. They are a
consumable, not a placeable prop. The **only** place the count appears is the
energy-drink button.

---

## 8. Offer cards: icon only, and bigger (Z)

Offer cards still show text like *"PAYS LESS NOW"*.

- Remove the trajectory **text** entirely from offer cards.
- Show **only the icon**: 🔥 rising, ❄ declining, nothing for stable — the same
  icons the leaderboard uses.
- Make the icon **noticeably larger** than the leaderboard's.

---

## 9. Explain why you cannot sleep on full energy (Y)

SPEC-V6 §14 blocks sleeping above 50% energy, but tapping SLEEP currently does
nothing at all. Show a clear message explaining the rule and what to do instead
(spend energy, or use the skip-night ad).

Audit the other sleep blocks (no bed, tournament match available) and make sure
each one explains itself on tap rather than silently failing.

---

## 10. The rookie coach must be worth hiring (X)

- **ROOKIE COACH auto-form: 0.25 → 0.35.**
- **More important:** the owner reports losing far more than winning *while
  coached*. A coach must never leave the player worse off than no coach.

**Requirement:** with the **rookie** coach's auto-form and no other bonuses, the
match win chance must be **at least 52%** — a coached player should win more
than they lose. Currently `winChance = 0.30 + 0.35 * form + …`, which at
form 0.35 gives ~0.42, i.e. a losing record. Retune the base constant and/or the
form coefficient so the floor holds, and **verify the higher coaches remain
strictly better** than the rookie.

Sanity-check the whole curve after retuning: an uncoached, untrained player
should still be clearly *bad*, and a fully-geared S-form player should still be
strong. Do not simply inflate every win chance.

---

## Package X — API additions

Implemented in `js/data.js` + `js/state.js` only. Every existing `Game.State.*`
/ `Game.Data.*` name still works unchanged — everything below is additive.

### §5 — sleep deadlock (the highest-priority fix)

`State.canPlayTournamentMatchToday()` **already existed** (added by the V6
day-gate package) and was already semantically correct — it was just never
wired into the hub's SLEEP gate, which instead used the too-broad
`tournamentPending()` (bracket exists && not done). A new boolean wrapper is
added for a direct drop-in:

```js
// boolean convenience wrapper — TRUE only when there is an unplayed
// tournament match the player can resolve right now.
State.tournamentMatchAvailableToday() -> boolean
```

Equivalent to `State.canPlayTournamentMatchToday().canPlay`. Behavior across
the four cases (all covered by the smoke test):
- no bracket / bracket already finished (win or loss) -> `false`
- bracket live, today's match already resolved (win that continues the
  bracket, or the day's attempt already spent) -> `false`
- bracket live, a new day has begun, today's match not yet played -> `true`

**Y action required:** in `js/hub.js`, replace the body of the local
`tournamentPending()` function (used by both `refreshNotifications()` and
`onSleep()`'s SLEEP block) with
`return window.Game.State.tournamentMatchAvailableToday();` — this is the
exact fix; the predicate needs no further changes from X.

### §10 — rookie coach win-chance retune

- `Data.staffCoaches` (`coach_rookie`).`formMult`: `0.25` -> `0.35`.
- `State.playMatch()`'s win-chance formula: form coefficient `0.35` -> `0.65`
  (base `0.30` unchanged): `winChance = clamp(0.30 + 0.65*form + gear.aim/120
  + chemBonus + earlyWin + setupBonus, 0.05, 0.92)`.

Numbers (all other bonus terms held at zero — free agent, no gear, elo at the
early-game-bonus zero point):

| form source | form mult | BEFORE (old formula, old mult) | AFTER (new formula, new mult) |
|---|---|---|---|
| uncoached / untrained | 0.00 | 30.00% | 30.00% |
| ROOKIE COACH | 0.25 -> 0.35 | 38.75% | **52.75%** |
| TEAM ANALYST | 0.45 | 45.75% | 59.25% |
| VETERAN IGL | 0.70 | 54.50% | 75.50% |
| S-form (manual/max) | 1.00 | 65.00% | 92.00% (clamp) |

Floor requirement met (52.75% >= 52%), tier ordering strictly increasing,
uncoached endpoint unchanged (still clearly bad), S-form endpoint hits the
existing 0.92 clamp (still strong, not inflated further).

### §3 — fridges gate energy drinks

Two new `Data.shopItems` entries, category `'fridge'` (new category — not a
`MIN_ROOM_CATEGORIES` / `SINGLETON_ROOM_CATEGORIES` member, never
auto-placed; placeable via the existing generic room-editor path like any
other decor item, but **capacity is ownership-based, not placement-based**,
matching how the drinks themselves are a stockpile rather than a room prop):

```js
{ id: 'fridge_mini', name: 'MINI FRIDGE', category: 'fridge', price: 250,  drinkCapacity: 4  }
{ id: 'fridge_full', name: 'FULL FRIDGE', category: 'fridge', price: 3000, drinkCapacity: 12 }
```

`energy_can` gained `requiresFridge: true`. Capacity is "best fridge owned"
(buying FULL FRIDGE after MINI FRIDGE raises capacity to 12; old fridges stay
in `owned`, same pattern as bed/desk upgrades — nothing is lost).

```js
State.fridgeStatus() -> {
  hasFridge: boolean,      // true iff any fridge-category item is owned
  capacity: number,        // 0, 4, or 12 — best owned fridge's drinkCapacity
  stock: number,           // current owned.energy_can count
  remaining: number,       // capacity - stock, floored at 0
  canBuyDrink: boolean,    // false if locked OR at capacity
  reason: null | 'no-fridge' | 'fridge-full'
}
```

`State.buyItem('energy_can')` now returns `false` (no cash spent, no stock
added) whenever `State.fridgeStatus().canBuyDrink` is false — checked via the
item def's new `requiresFridge` flag, so the gate is generic for any future
fridge-gated consumable, not hardcoded to `energy_can`'s id.

The existing 4-per-day **consumption** limit
(`State.drinkEnergyDrink()`/`State.energyDrinkStatus()`, `Data.energyDrink.maxPerDay`)
is completely unchanged — fridges gate the *stockpile size*, not how many
you can drink in a day.

**Z action required:** `js/shop.js`'s `SECTION_ORDER` does not include
`'fridge'` yet — the two fridge items exist in `Data.shopItems` but won't
render in the shop until Z adds a `'fridge'` section (suggest placing it
right before `'consumable'`, i.e. buy the fridge, then the drinks). The shop
should call `State.fridgeStatus()` before attempting a `buyItem('energy_can')`
call to show *why* it's blocked (`reason`), rather than relying on
`buyItem`'s bare `false` (which today's `shop.js` — before Z's changes —
would misreport as "NOT ENOUGH CASH").

### Smoke test

`node smoke-v7-packagex.js` (headless, loads `data.js`+`state.js` via `vm` with
a minimal `window`/`localStorage` shim) — covers all of the above: the four
tournament-predicate cases, the rookie floor + full tier ordering, and fridge
capacity gating (lock, mini cap, upgrade to full, over-capacity block, 4/day
consumption limit unaffected, save/load round-trip). All assertions pass.
