# CS2 PRO SIMULATOR — V6 PLAYTEST FIXES (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V5.md`. Where they disagree, **V6 wins**. All
earlier hard constraints still apply: vanilla JS, no ES modules, no
dependencies, no external assets, `file://`-safe, tokens-only CSS, 420x860.

---

## 0. FILE OWNERSHIP MAP

| Package | Owns | Items |
|---|---|---|
| **T — core rules & data** | `js/data.js`, `js/state.js` | 1, 2, 3, 4r, 5, 6r, 7r, 8r, 11r, 12r, 13, 14, 15, 17, 20, 21, 23r, 24, 25, 26, 27r |
| **U — hub, room & world** | `js/hub.js`, `js/iso.js`, `js/main.js`, `js/sheep.js`, `css/style.css` | 3u, 4u(button), 9, 10, 12u, 16u, 22, 23u, 28, 29 |
| **V — minigames** | `js/aim.js`, `js/stream.js`, `js/cases.js`, `css/minigames.css` | 2u, 11u, 16v, 18, 30 |
| **W — career, teams, shop** | `js/career.js`, `js/teams.js`, `js/tournaments.js`, `js/shop.js`, `js/locations.js`, `css/teams.css` | 4u, 5u, 6u, 7u, 8u, 15u, 19, 27u, 31 |
| **lead only** | `index.html`, `css/tokens.css`, `js/ui.js`, `js/router.js`, all `.md` | |

**Ordering:** T lands first and is frozen. U, V, W then run in parallel.

---

# PART A — the two items already in flight

## 1. Viewership must start small and grow with the career (T + V)

**Playtest bug:** a brand-new save's *first* stream drew **500 viewers**.

```
streamCap = 230 * streamCountFactor * followerFactor * tierFactor
```

| Factor | Formula |
|---|---|
| base | `230` — a first-ever stream caps at **230** |
| `streamCountFactor` | `(1 + streamsDone / 25) ^ 1.6` — ≈6% growth per stream early, shrinking automatically |
| `followerFactor` | `(1 + followers / 8000) ^ 0.8` — sub-linear |
| `tierFactor` | free `1.0`, T3 `1.5`, T2 `3.0`, T1 `6.0` |

**Sanity targets (smoke-test these):** new save → **230**; ~50 streams, 5k
followers, T3 → ~10k; ~300 streams, 200k followers, T1 → **1–3 million**. The
diminishing-return shape is the requirement — do not linearise it.

**In-stream behaviour (V):** ramp toward the cap, then **hold roughly steady,
drifting slightly down** with small jitter. A good case pull spikes viewers
above the plateau then settles back.

## 2. Whole-number people (T + V)

Followers show decimals. **Store `followers` as an integer**, rounding at the
point of accrual in `applyStreamResult()`. Audit **subscribers** and **peak
viewers** too. Money is exempt — cents are legitimate there.

---

# PART B — the new batch

## 3. Energy drinks become a consumable (T rules, U button)

**Remove the energy drink from the `energy` (max-energy) category entirely.**
It becomes a **consumable**:

- Costs **$20**, buyable repeatedly, stockpiled.
- Drinking one restores **25 energy** instantly.
- **Maximum 4 drinks consumed per day**, reset on wake.

**UI (U):** a button in the **top-right of the playable area** — a **can in a
circle**, with the count owned beneath it. Tap to drink. Disabled (with a clear
reason) at 0 owned, at full energy, or once 4 have been drunk today.

## 4. Offers arrive gradually (T rules, W UI)

**Currently:** two offers land the instant you cross 2,100 ELO.

- Offers appear **randomly over time, one at a time**, every few days — never
  two at once.
- If you don't accept, **another can still arrive**.
- **Maximum 3 open offers** at any moment.
- Below the ELO floor, **show no teams at all** — see §5.

## 5. The offers screen below the ELO floor (W)

Currently it lists random teams the player cannot sign, with RISING/STABLE/
DECLINING **text**. Replace with:

- **Nothing** — no team list at all.
- A styled empty state: *"Your offers will appear here once you reach 2,100
  ELO."* Make it look deliberate, not like a bug.
- When offers *do* appear, their trajectory uses the **fire / snowflake icons**
  from the leaderboard (SPEC-V5 §24), not the text pills.

## 6. Rent and tournaments must not share a day (T rules, W display)

Rent is currently every 7 days on the same cadence as tournaments, so payout and
rent land together.

- On moving in, pick a **random rent day-of-cycle offset** — a player moves in on
  an arbitrary day. Rent then recurs **every 7 days** from that offset.
- Ensure the tournament cycle and the rent cycle **cannot** coincide.
- *(If this already works, leave it and say so.)*

## 7. New daytime energy-regeneration items (T rules, W shop)

A new **`regen`** shop category raising the **daytime** regen rate above the
base 1.0/sec. Suggested ladder — adjust names freely, keep the shape:

| Item | Price | Bonus |
|---|---|---|
| ERGONOMIC FOOTREST | $800 | +0.15/s |
| AIR PURIFIER | $4,000 | +0.25/s |
| STANDING DESK CONVERTER | $15,000 | +0.40/s |
| HYPERBARIC RECOVERY POD | $120,000 | +1.00/s |

Cap the **total** bonus at **+2.0/s** (so 3.0/s absolute). Night regen stays
**0** regardless — these speed up the day, they do not defeat the night rule.

## 8. ELO requirements scale with team rank (T rules, W display)

**Problem:** once signed, ELO stops mattering.

Each team's required ELO is derived from its **leaderboard rank**, interpolated
within its tier's band and **rounded to the nearest 100**:

| Tier | Rank range | Required ELO |
|---|---|---|
| Tier 3 | 100 → 51 | **2,100 → 2,500** |
| Tier 2 | 50 → 21 | **3,200 → 4,000** |
| Tier 1 | 20 → 1 | **5,000 → 7,000** |

So a rank-40 side asks ~3,300 and a rank-30 side ~3,600. Offer cards state the
exact figure ("MINIMUM 3,300 ELO"). This keeps ranked grinding relevant for the
whole game.

**Also (U):** after reaching PRO LEAGUE the ELO number disappeared. Show the
**number first, then the label** — e.g. `3,412 ELO · PRO LEAGUE`.

## 9. Tournaments run across days (T rules, W UI)

All matches currently resolve in one day.

- Play **one match per day**.
- **Win → your next match is the following day.**
- **Lose → you are eliminated**, and the next tournament is in **7 days**.
- Winning the whole event also resets the clock to **7 days**.

## 10. Better monitor and desk art, and monitors need a desk (U)

The monitor and table look bad — redo both so they read properly in isometric.

**A monitor may only be placed on a tile occupied by a desk.** Placing one in
mid-air is not allowed; block it with a clear message.

## 11. Buttons sometimes need several taps (U + V)

Reported on **PLACE** in build mode and **TRAIN**. Find the real cause — likely
pointer/click double-binding, an event landing on a stale element after a
re-render, or a `pointerdown`/`click` mismatch — and fix it properly. Do not
paper over it with a retry.

## 12. Form multiplier is continuous (T rules, V UI)

The aim trainer currently snaps to fixed multipliers per grade (B = 0.45,
A = 0.70…). Make the multiplier a **continuous function of actual performance**
— accuracy, targets hit vs missed, and reaction time — across the full `0…1.0`
range. The **letter grade becomes a display label derived from the multiplier**,
not the source of it.

## 13. Sheep hits speed up waking (T rules, U UI)

Each sheep hit adds **1% of max energy**, on top of the existing form/cash
rewards, so playing the minigame genuinely wakes you sooner.

## 14. You cannot sleep above half energy (T)

Block sleeping while energy is **above 50%** of current max, with a clear reason.

## 15. Sleep length scales with how tired you are (T)

Minimum sleep currently ignores how depleted you were.

- **More energy at bedtime → shorter required sleep.**
- Interpolate: at 50% energy → **~10 seconds**; at 0% → **~30 seconds**.
- **Never below 10 seconds**, so the skip-night ad stays tempting.

## 16. The 4-item energy cap applies to PLACED items (T rules, W shop)

You may **own** any number of max-energy items; only **4 placed in the room**
count toward `energyMax`. Update the shop copy accordingly.

## 17. Streaming locks the rest of the UI (U + V)

Clicking SHOP mid-stream silently ends the stream. **While live, block every
other nav action** — TRAIN, PLAY, CASES, SHOP, CAREER, SLEEP — with a message
telling the player to end the stream first. The on-stream case button is the one
exception.

## 18. Your setup affects team performance (T)

Desk / PC / monitor / chair tiers must feed a **setup quality** score that
contributes to **official match and tournament win chance**, not just solo ELO.
A player on a bad rig should visibly underperform for their team.

## 19. Double the chat lines (V)

Chat repeats too quickly. **Double both the friendly and the toxic pools**, in
the same voice as the existing lines.

## 20. Back-navigation from Leaderboard/Tournaments (W)

From CAREER → LEADERBOARD (or TOURNAMENTS), **BACK** currently jumps to the hub.
It must return to **CAREER**.

## 21. Subscribers pay weekly (T)

Confirm the subscriber payout runs **every 7 days**. *(If it already does,
change nothing and say so.)*

## 22. Coaches and scrims — REPEAT, previously not delivered (T)

This was specified in SPEC-V5 §18 and either was not implemented or does not
work. Verify and fix:

| Coach | Behaviour |
|---|---|
| **L1 ROOKIE** | If you try to sleep before hitting the scrim quota, **warn** first. Fills nothing. |
| **L2 ANALYST** | **Gradually** fills the scrim quota across the day — fully topped up by nightfall. Must be continuous, **not** an instant jump at night. |
| **L3 VETERAN IGL** | Quota **automatically satisfied** each day. |

Give each a short in-fiction line explaining why (the coach drags the team
through practice whether or not you show up).

## 23. Bed pillows are misplaced (U)

Some beds render the pillow off to the side or floating. Fix so every bed tier
reads as a real bed.

## 24. Room-edit pickup logic is broken (T rules, U UI)

You cannot pick up the basic chair to leave only a better one. **Rewrite the
pickup/removal logic properly** rather than patching this case: the rule should
be that a singleton category must end up with **at least one** placed instance,
and any *surplus* instance can always be picked up. Verify across desk, chair,
PC, monitor and bed.

## 25. Scrim misses count across the whole contract (T)

The miss counter currently tracks *consecutive* days. Make it **cumulative for
the entire contract**: **3 total misses → kicked**. Warn at 1 and 2.

## 26. Scrims give 2–4 chemistry (T)

Down from 12.

## 27. No bed, no sleep (T)

Block sleeping entirely when no bed is placed, with a clear message.

## 28. Remove room expansion; bigger locations instead (T rules, W UI)

**Delete the room-expansion purchase entirely.** Grid size comes only from the
location, each one tile larger than the last:

| # | Location | Grid | Move-in | Rent / 7 days | Stream mult |
|---|---|---|---|---|---|
| 0 | PARENTS' BASEMENT | 6x6 | — | $0 | 1.00 |
| 1 | CITY CENTRE APARTMENT | 7x7 | $3,500 | $350 | 1.25 |
| 2 | BEACH VILLA | 8x8 | $25,000 | $1,800 | 1.60 |
| 3 | ESPORTS MANSION | 9x9 | $150,000 | $9,000 | 2.20 |
| 4 | PENTHOUSE SUITE | 10x10 | $600,000 | $30,000 | 3.00 |
| 5 | PRIVATE ISLAND COMPOUND | 11x11 | $3,000,000 | $120,000 | 4.00 |

Existing saves with `expansions > 0` must migrate cleanly.

## 29. Every location needs ground (U)

SPEC-V5 §31 added grass under the parents' basement. **Every other location
still floats.** Add matching ground to each: **pavement/asphalt** for the city,
**sand** for the beach villa, **manicured lawn and gravel drive** for the
mansion, a **rooftop terrace above city haze** for the penthouse, and **sand
meeting water** for the island. All must work across day/sunset/night.

## 30. Edit mode must not squash the play area (U)

Entering EDIT ROOM compresses the whole play area vertically, which looks bad.
The edit tray should **overlay the bottom of the play area** instead — the lower
strip is ground with no functionality, so covering it costs nothing.

---

## Package T — API additions

Everything below lives in `js/data.js` / `js/state.js`. Every existing
`Game.State.*` / `Game.Data.*` name still works — nothing was renamed or
removed, only extended. Packages U/V/W: read this section only, do not
re-derive T's internals.

### Data (js/data.js)

- **`Data.viewerCapBase/viewerCapStreamDivisor/viewerCapStreamExp/
  viewerCapFollowerDivisor/viewerCapFollowerExp`** (§1) — constants behind
  `State.viewerCap()`. `Data.streamViewerCap` (flat 500) is kept but no
  longer the intended source — switch stream.js's `VIEWER_CAP` read to call
  `State.viewerCap()` at the start of each stream instead.
- **`Data.energyDrink`** = `{ price: 20, restoreEnergy: 25, maxPerDay: 4 }` (§3).
- **`Data.dayRegenBase`** (1.0) / **`Data.regenBonusCap`** (2.0) (§7).
- **`Data.eloRequirementForRank(rank)`** (§8) — exact per-rank required ELO,
  rounded to the nearest 100 (T3 100→51: 2100→2500; T2 50→21: 3200→4000; T1
  20→1: 5000→7000). `Data.requirementsForRank(rank, tier).elo` now returns
  this (was the flat `Data.eloFloorForTier(tier)`, which still exists
  unchanged and is still the "any offers at all" floor used by §4/§5).
  Already surfaced on every team via `State.teamById(id).requirements.elo` /
  `State.offers()[i]` — no new call needed for offer-card copy.
- **`Data.aimFormWeights/aimFormVolumeTarget/aimFormReactionBestMs/
  aimFormReactionWorstMs`** (§12) — tunables behind the continuous form
  formula. **`Data.formLabelForMult(mult)`** — returns the `Data.formGrades`
  entry (`{grade, label, mult}`) whose label a given multiplier should show;
  this is now the ONLY correct way to turn a multiplier into a letter.
- **`Data.setupQualityBandValue/setupQualityWinBonus/setupQualityPowerBonus`**
  (§18) — tunables behind `State.setupQuality()`.
- **`Data.locations`** (§28) — now 6 entries, id 0-5, grid 6x6 through 11x11,
  `expandCap`/`baseExpand` are GONE from every entry. New: id 4 PENTHOUSE
  SUITE ($600k/$30k rent/×3.0/10x10), id 5 PRIVATE ISLAND COMPOUND
  ($3M/$120k rent/×4.0/11x11).
- **`Data.shopItems`** category changes: `energy_can` moved from category
  `energy` to a new category **`consumable`** (price $20, `restoreEnergy: 25`,
  never placed — drink via `State.drinkEnergyDrink()`). New category
  **`regen`**: `regen_footrest` (+0.15/s), `regen_purifier` (+0.25/s),
  `regen_standdesk` (+0.40/s), `regen_hyperbaric` (+1.00/s) — daytime-only,
  placed props, total capped at `Data.regenBonusCap`.

### State (js/state.js)

- **`State.viewerCap()`** (§1) → integer. Dynamic viewer ceiling for the
  CURRENT save (streams done, followers, signed tier). Call at the start of
  every stream session instead of reading `Data.streamViewerCap`.
- **`State.applyStreamResult(res)`** (§2) — unchanged signature/shape;
  `followers`/`peakViewers`/`subscribersGained` in both the return value and
  `State.data.followers/peakViewers/subscribers` are now always integers.
- **`State.sleepGateStatus()`** (§14/§27) → `{ canSleep, reason: null|
  'no-bed'|'energy-too-high', message, energyPct }`. Call before offering the
  SLEEP button so the UI can show `message` up front; `State.sleep()` itself
  now also returns `{ ok:false, reason, message }` on the same two new
  reasons.
- **Sleep duration is now TIME-based, not energy-based** (§15):
  `State.sleep()` returns `{ ok:true, sleepRequiredMs }`; `State.canWake()`'s
  shape is unchanged (`allowed/gained/remainingMs/sleepRate`) but
  `remainingMs`/`allowed` now reflect the tiredness-scaled timer
  (10s at 50% energy .. 30s at 0%, never below 10s) instead of "50 energy
  regenerated". Reaching `energyMax` still auto-wakes instantly regardless
  (unchanged) — this is how COUNTING SHEEP hits (§13, now +1% max energy
  each) still "wake you sooner" under the new gate.
- **`State.drinkEnergyDrink()`** (§3) → `{ ok, reason?, energy, owned,
  drinksToday }`. Reasons: `none-owned`/`full-energy`/`daily-limit`.
  **`State.energyDrinkStatus()`** → read-only `{ owned, drinksToday,
  drinksLeftToday, restoreEnergy, canDrink, reason }` for the can-in-a-circle
  button. Stockpile count is `State.data.owned.energy_can` (same pattern as
  every other shop item); `State.data.energyDrinksToday` resets on wake.
- **`State.regenStatus()`** (§7) → `{ bonus, cap, dayRate, nightRate: 0 }`.
- **4-item energy cap now gates PLACEMENT, not ownership** (§16):
  `State.buyItem()` no longer blocks energy-category purchases at all;
  `State.placeItem()` now blocks placing a 5th energy-category item.
  `State.energyItemStatus()` gained `ownedTotal` (additive) — `total`/`cap`/
  `remaining`/`atCap` now describe PLACED count, not owned count.
- **`State.setFormFromPerformance({ accuracy?, hits, misses, reactionMs })`**
  (§12) → same shape as `State.setForm()`'s return
  (`{grade, label, mult, baseMult, day, manual, continuous, perf}`), keeps
  whichever of today's coach/earlier roll is higher, same as `setForm()`.
  This is the new entry point aim.js should move to — `State.setForm(grade)`
  (fixed per-grade snap) still works unchanged for anything not yet moved
  over.
- **`State.setupQuality()`** (§18) → 0..1. Feeds into `State.playMatch()`'s
  win chance (when signed) and tournament `powerFor()` automatically — no
  action needed from W beyond displaying it if desired.
- **`State.offers()`** (§4) — same shape, now fed one at a time every
  `randInt(2,5)` days (was up to 2 instantly), max **3** open (was 5).
  Generates nothing at all below `Data.eloFloorForTier(3)` (2100).
- **Rent/tournament day collision** (§6) — `State.data.rentDayOffset` (1-6,
  rolled fresh on every real move-in via `State.commitMove()`/
  `forceCommitMove()`, backfilled on load for any already-moved-in save that
  predates this field) makes rent's weekly due-day structurally unable to
  land on the same absolute day as the tournament background cycle (always
  multiples of 7 from day 0). No new read API — `State.currentLocation()`
  still reports `rent` as before.
- **Room expansion is DELETED** (§28): `State.expansionCost()` always
  returns `null`; `State.buyExpansion()` always returns
  `{ ok:false, reason:'expansions-removed' }`. `State.currentGrid()` now
  returns the location's raw `gridW`/`gridD` only. `State.data.expansions`
  is kept in the save (round-trips, never crashes a load) but is inert.
- **Tournaments now run one match per day** (§9):
  `State.playTournamentMatch()` returns `{ ok:false, reason:
  'already-played-today' }` if called again the same day after a match was
  already played. A win leaves the bracket advanced internally but not
  playable until `State.data.day` advances (i.e. after a sleep). A loss ends
  the event immediately (unchanged) and — new — schedules the next
  tournament exactly 7 days later via `State.data.nextPlayerTournamentDay`;
  winning the whole event sets the same field the same way. `State.
  nextTournamentInDays()` reads that field now instead of the whole-board
  background cycle. New: **`State.canPlayTournamentMatchToday()`** →
  `{ canPlay, reason }` for a pre-flight check before showing the PLAY
  button as enabled.
- **Scrim misses are now CUMULATIVE for the whole contract** (§25): a day
  where the quota WAS met no longer resets `State.data.
  consecutiveScrimMisses` back to 0 (name kept — it no longer means
  "consecutive"). Reset to 0 only on signing a fresh contract
  (`State.acceptOffer()`/`State.signContract()`). `State.scrimQuotaStatus()`
  gained `contractMisses` (clearer alias of the same value) and
  `warningLevel` (0/1/2) for the UI to flag at 1 and 2 misses; still kicked
  at 3.
- **`State.removePlacedAt(x, y)`** (§24) — REWRITTEN rule: a singleton
  category (`desk`/`pc`/`chair`/`monitor`/`bed`) may lose a placed instance
  as long as at least one instance of that category remains placed — any
  surplus instance (2nd+) is always removable. Was: these 4 categories
  (bed excluded) could never be emptied at all, which is what made a
  surplus starter chair stuck. `State.placeItem()` unchanged otherwise,
  except it now rejects `category:'consumable'` items outright (never a
  room prop) and enforces the new 4-placed energy cap (§16 above).

### Left to the UI (U/V/W)

- Wiring `Data.shopItems` categories `consumable` and `regen` into
  `js/shop.js` (currently only renders `desk/chair/pc/decor/monitor/room/
  bed/energy` — the two new categories are invisible, not broken, until
  added).
- The can-in-a-circle energy-drink button (top-right of the playable area)
  — `State.energyDrinkStatus()`/`State.drinkEnergyDrink()` are ready.
- Showing `State.sleepGateStatus()`'s `message` before/instead of a failed
  `State.sleep()` call, and `State.sleepWarning()`/`State.scrimQuotaStatus()
  .warningLevel` for the coach-quota warnings.
- Tournament UI copy for `'already-played-today'` ("come back tomorrow")
  distinct from `'no-tournament'`, and for the new
  `State.canPlayTournamentMatchToday()` pre-flight check.
- Offer-card copy using `requirements.elo` (exact figure, e.g. "MINIMUM
  3,300 ELO") and the fire/snowflake trajectory icons (§5, unchanged from
  SPEC-V5 §24).
- `js/locations.js`'s expansion card (now permanently "MAXED") should be
  replaced with the two new locations (PENTHOUSE SUITE, PRIVATE ISLAND
  COMPOUND) per the §28 table — `Data.locations` already has both.
- `js/stream.js` switching its `VIEWER_CAP` constant to call
  `State.viewerCap()` per stream instead of reading `Data.streamViewerCap`
  once at module load.
- `js/aim.js` switching from `State.setForm(grade)` to
  `State.setFormFromPerformance({accuracy, hits, misses, reactionMs})` so
  the multiplier is actually continuous end-to-end (T's half of §12 is done
  either way — the old snapped path still works unmodified in the meantime).

### Not done / explicitly deferred

- §5's empty-state copy/fire-snowflake icons, §6a's "MINIMUM X ELO" card
  text, §29's ground art, §23's pillow fix, §10/§11/§17/§19/§20's UI/art/
  input fixes, §30's edit-tray overlay — all out of file-ownership scope for
  T (owned by U/V/W per the file ownership map), data/logic is ready where
  those depend on it (see "Left to the UI" above).
- §6 was confirmed to be a REAL pre-existing collision (not a false alarm)
  and is now fixed — see rentDayOffset above.
- §21 (subscriber payout) needed no change — it already ran every 7 days
  correctly; confirmed and left untouched per the checklist's own
  instruction.
