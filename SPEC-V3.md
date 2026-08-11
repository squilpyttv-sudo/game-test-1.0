# CS2 PRO SIMULATOR — V3 CHANGE SPEC (CONTRACT)

Addendum to `SPEC.md` and `SPEC-V2.md`. Where they disagree, **V3 wins**.
All earlier hard constraints still apply: vanilla JS, no ES modules, no
dependencies, no external assets, must run from `file://`, tokens-only CSS,
420x860 portrait.

The headline change: **the discrete day cycle is gone.** Energy now regenerates
in real time and the player sleeps to reset the day. `endDay()` is replaced by
`sleep()`.

---

## 0. FILE OWNERSHIP MAP (read this before touching anything)

Packages are split by **feature vertical**, and each package owns **every file
its feature touches** — so no agent should ever find itself blocked by a file it
needs but doesn't own. If you believe you need to edit a file outside your list,
**stop and report it** rather than working around it; that means this map is
wrong and the lead needs to fix it.

| Package | Owns |
|---|---|
| **F — core rules & data** | `js/data.js`, `js/state.js` |
| **G — hub, world & shell** | `js/iso.js`, `js/hub.js`, `js/main.js`, `css/style.css` |
| **H — screens** | `js/stats.js`, `js/shop.js`, `js/locations.js`, `js/title.js`, `css/title.css`, `css/stats.css` |
| **I — minigames** | `js/aim.js`, `js/cases.js`, `js/stream.js`, `css/minigames.css` |
| **K — subscribers** (§13) | `js/data.js`, `js/state.js`, `js/hub.js`, `js/iso.js`, `js/stats.js`, `js/shop.js`, `js/main.js`, `js/stream.js`, `js/locations.js` |
| **J — tutorial** | `js/tutorial.js`, `css/tutorial.css` |
| **lead only** | `index.html`, `css/tokens.css`, `js/ui.js`, `js/router.js`, `js/career.js`, all `.md`, `mockups/` |

**Ordering:**
1. **F** lands first, then frozen.
2. **G, H, I** run in parallel against F's published API.
3. **K** runs after G/H/I are all done. It is cross-cutting by nature (it
   removes a mechanic that touches data, state, the hub, the shop and the stats
   screen), so it takes ownership of those files *after* the parallel packages
   have released them. It must never run concurrently with G/H/I.
4. **J** runs last of all. The owner asked for the tutorial to be touched only
   once everything else is finished, so its copy reflects final behaviour rather
   than a moving target.

Cross-package calls are fine and expected (e.g. G's STATS button routes to the
screen H registers). Only *file edits* are restricted.

---

## 1. Real-time energy

`energyMax` stays **100**. Energy regenerates continuously off wall-clock time,
not per-frame, so it must be correct across tab-blur and reloads: persist
`lastEnergyTickAt` (epoch ms) and reconcile on load.

| Situation | Regen |
|---|---|
| Awake, daytime | **1.0 / sec** |
| Awake, **night** | **0.0 / sec** — energy does not regenerate at night |
| Asleep | the current bed's `sleepRate` (default **2.5 / sec**) |

Energy never exceeds `energyMax`. Regen must keep running while the player sits
on any screen, and while the app is backgrounded (reconcile on return).

### Watch-an-ad refill
A **WATCH AD — FULL ENERGY** control refills energy to full. There is no ad SDK
here, so simulate it: a short (≈3s) non-skippable placeholder overlay reading
`AD PLAYING…` with a countdown, then grant full energy. Rate-limit it to once
per 60s of real time and show the cooldown.

---

## 2. Day / night cycle

Time advances only while the player is **awake**. Track `wakeElapsedMs`.

| Phase | Window | Behaviour |
|---|---|---|
| DAY | 0 – 300s | normal |
| SUNSET | 300 – 360s | 60-second gradient transition |
| NIGHT | 360s+ | energy regen stops; stays night indefinitely |

**Only sleeping returns it to morning.** There is no automatic sunrise — a
player who refuses to sleep stays in permanent night with zero regen. That is
the intended pressure.

Rationale for 300/360s: at 1 energy/sec a full bar is 100s, so a day affords
roughly three full bars of activity before night — long enough to feel like a
session, short enough that sleep matters.

### The visual
This is a **visible background change**, not a UI label. The backdrop behind the
isometric room must animate through the cycle with a **smooth sunset gradient**:
daylight blue → warm orange/pink/violet sunset → deep night. Stars fade in
across sunset; any sun/moon element moves. All four location backdrops must
support it. The transition must be interpolated per-frame, never a hard swap.

Ambient light on the room itself should shift with the phase (cooler and dimmer
at night) so the room reads as part of the scene.

---

## 3. Sleep

The **END DAY** button is renamed **SLEEP** (§ see also §6). Sleeping is an
interactive state, not an instant button:

1. Tapping SLEEP puts the player to bed (the avatar/room shows it; screen dims).
2. Energy fills at the bed's `sleepRate`.
3. **Minimum sleep:** the player cannot wake until they have regenerated at
   least **50 energy** (half of `energyMax`). At the default bed that is 20s.
   Show the WAKE UP button as locked with a countdown until then.
4. Waking (or hitting full energy, which auto-wakes) sets the phase back to
   **morning**, resets `wakeElapsedMs`, and advances the day counter by 1.

### Beds — a new `bed` shop category
The better the bed, the faster the sleep regen. `bed_mattress` is owned by
default and must always exist.

| id | Name | Price | sleepRate |
|---|---|---|---|
| bed_mattress | FLOOR MATTRESS | — (default) | 2.5 /s |
| bed_single | SINGLE BED | $400 | 3.5 /s |
| bed_memoryfoam | MEMORY FOAM BED | $2,500 | 5.0 /s |
| bed_kingsize | KING SIZE BED | $12,000 | 7.0 /s |
| bed_cryopod | CRYO SLEEP POD | $90,000 | 10.0 /s |

Beds are singleton props like desks — buying a better one replaces the old one
in the room and must be visually distinguishable.

### Skip-the-night button
During NIGHT, show a **SKIP THE NIGHT** button. **It intentionally does nothing
for now** — it is a placeholder for a future rewarded ad that will refill
energy. Render it visibly disabled/greyed with a `COMING SOON` hint. Do not wire
it to any energy grant.

---

## 4. Rent now counts sleeps

Rent no longer keys off a `day` counter advanced by END DAY. **One sleep = one
day.** Rent falls due every 7th sleep, and the day counter advances only on
waking. Everything else about rent amounts and locations is unchanged.

---

## 5. Going broke — the fail state (REPLACES V2 eviction)

The V2 rule (`rentMissed >= 2` → evicted back to location 0) is **removed**.
Rent may now push the balance **negative**.

1. **First time** rent drives cash below $0: a prominent, unmissable warning —
   "YOU ARE IN DEBT. MISS RENT AGAIN AND YOUR CAREER IS OVER." Set
   `debtStrikes = 1`. The player keeps playing and can climb out by earning
   back above $0.
2. **Second time** cash goes below $0 from rent: **the career is lost.** Set
   `dead = true` on the save with a `deadReason`. Show a full-screen GAME OVER
   card with final stats.

A dead save is **view-only**: on the title screen its slot shows `CAREER LOST`,
offers **VIEW STATS** and **DELETE** only, and must not be loadable into play.
`CONTINUE` must skip dead saves.

---

## 6. Hub buttons

The hub's control row becomes **four** buttons:

**[ EDIT ROOM ] [ CAREER ] [ STATS ] [ SLEEP ]**

`SLEEP` replaces `END DAY` (same slot, same prominence).

---

## 7. Stats screen (NEW)

A new `stats` screen reachable from the hub, listing everything that affects the
game with its **current numeric effect**, grouped:

**Room buffs** (aggregated from placed props — the whole point of this screen)
- Aim bonus → `+X ELO per match`
- Stream multiplier → `+X% stream cash`
- Idle income → `$X per day`
- Prestige → `+X% viewers`
- Luck → `+X% shift toward rare case drops`
- Sleep rate → `X energy/sec` (from the current bed)
- Energy regen → `X /sec` awake

**Career:** rank, ELO, contract, salary, chemistry, scout hype, day, location,
grid size, rent due in N sleeps.

**Lifetime:** matches, wins, win rate, streams, cases opened, best pull,
playtime.

### Every listed stat must actually do something
This is an explicit requirement. Audit each buff and wire up any that is
currently inert. In particular **`prestige` must have a real effect**: define it
as **+2% base stream viewers per prestige point** and implement it. If any other
stat turns out to be decorative, either give it a real effect or remove it from
the catalog — do not display a stat that does nothing.

---

## 8. Move-out lockout

While a move is in progress (packing mode), the player may do **nothing except
tap their items to pack them and then move out**.

- All five bottom-nav buttons (PLAY / TRAIN / STREAM / CASES / SHOP) disabled.
- EDIT ROOM, CAREER, STATS and SLEEP disabled.
- Only prop-tapping and the MOVE OUT button remain live.
- Disabled controls must look disabled and explain why on tap
  ("FINISH MOVING OUT FIRST").

---

## 10. Max-energy upgrades (NEW)

A new shop category, `energy`. These are **placeable room props** that each add
to `energyMax`. They **stack**, and the full set caps energy at exactly **200**.

| id | Name | Price | +Max energy | Running total |
|---|---|---|---|---|
| energy_can | ENERGY DRINK | $250 | +15 | 115 |
| energy_minifridge | ENERGY DRINK MINIFRIDGE | $2,000 | +25 | 140 |
| energy_fridge | ENERGY DRINK FRIDGE | $15,000 | +30 | 170 |
| energy_ivdrip | ENERGY IV DRIP | $80,000 | +30 | 200 |

Each must be a **visually distinct** prop in the isometric room: a can on the
desk, a minifridge, a full-height fridge, and an IV drip stand. `energyMax` is
therefore no longer the constant 100 — every place that assumes 100 must read
the computed value instead.

---

## 11. Case economy (REPLACES SPEC-V2 §12 values and the $2.50 price)

**Cost per case: $7.00** (was $2.50 in V2, briefly specced at $5.00).

Drop **chances are unchanged** (65 / 25 / 6.5 / 2.5 / 1). Only the **values**
change:

| Rarity | Chance | Value range |
|---|---|---|
| Mil-Spec (blue) | 65% | $0.40 – $2.40 |
| Restricted (purple) | 25% | $3.00 – $7.40 |
| Classified (pink) | 6.5% | $12 – $28 |
| Covert (red) | 2.5% | $40 – $100 |
| Rare Special (gold) | 1% | **split, see below** |

### The gold tier is a hidden two-tier roll
The gold chance stays **1%**. When gold hits, roll again:
- **2/3 of the time** → value **$90 – $150**
- **1/3 of the time** → value **$250 – $500**

**The player must never see this split.** In the DROP ODDS panel the gold row
shows its 1% chance but its value column renders as **`?`** — a deliberate
mystery. Do not leak the ranges in any tooltip, label, or comment visible in the
UI.

---

## 12. Cases cost energy

- Opening a case **off stream** costs **1 energy** per spin (plus the $5).
- Opening a case **during a stream** costs **0 energy** — but still costs the
  $5, and any profit still lands in the player's balance immediately, exactly as
  an off-stream pull does.

The existing on-stream synergy (a red or gold pull spikes viewers 10x) is
unchanged.

> **LEAD NOTE — flagged, implement as specified anyway.** Expected value per
> case at the current numbers:
>
> | Rarity | Chance | Mid value | Contribution |
> |---|---|---|---|
> | Blue | 65% | $1.40 | $0.910 |
> | Purple | 25% | $5.20 | $1.300 |
> | Pink | 6.5% | $20.00 | $1.300 |
> | Red | 2.5% | $70.00 | $1.750 |
> | **non-gold subtotal** | | | **$5.260** |
> | Gold | 1% | $205 blended | $2.050 |
> | **EV** | | | **$7.310** |
>
> Against the **$7.00** cost that is **+4.4% return** — near break-even, which
> is the right shape for a gamble: the house edge is essentially nil, the
> variance is enormous, and a gold pull still feels like a jackpot.
>
> History, so nobody "fixes" this back: at $5.00 with the original gold ranges
> the EV was $9.16 (+83%). Lowering gold brought it to $7.31 (+46%). Raising
> the price to $7.00 closed the rest. Note the four common tiers alone are
> worth $5.26, so the price floor for a fair case is ~$5.30 no matter what
> gold does. **These numbers are deliberate — do not adjust them.**

---

## 13. Subscribers replace idle income (Package K — runs after G/H/I)

**Remove idle income entirely.** It is both unrealistic (rooms do not generate
money) and currently *broken*: the hub floats `+$N` numbers off the PC
continuously, but the money is only credited inside `endDay()`/`sleep()`. The
floating numbers are lying about when income arrives, and at a glance look like
they never pay out at all.

Delete: the floating `+$` particles, the idle-income payout, and the idle-income
row on the stats screen.

### What replaces it: streaming subscribers

`subscribers` becomes a real tracked resource.

- **Gained from streaming.** **8% of each stream's follower gain** converts to
  subscribers. Round sensibly; never negative.
- **They pay every 7 sleeps**, on the same tick as rent, at **$2.50 per
  subscriber** (deliberately mirroring a real Twitch sub after the platform's
  cut). Pay subscribers **before** rent is charged, so a good channel can cover
  the rent it earned.
- Show subscribers in the top bar / stats alongside followers, and show the
  next payout as `N subs → $X in Y sleeps`.

### Why these numbers
The curve is designed to scale into the rent tiers rather than trivialise them:

| Followers | Subs | Per 7 sleeps | Covers |
|---|---|---|---|
| 100 | 8 | $20 | pocket money |
| 2,000 | 160 | $400 | city apartment ($350) |
| 20,000 | 1,600 | $4,000 | beach villa ($1,800) |
| 100,000 | 8,000 | $20,000 | esports mansion ($9,000) |

Subscriber income should feel like the reward for building an audience, and it
should arrive as a lump sum that makes rent day survivable — not as a trickle.

### Repurpose the `income` gear stat — do not orphan it
Several shop props currently carry an `income` stat. With idle income gone that
stat would be dead, and SPEC-V3 §7 forbids displaying a stat that does nothing.

Convert it: **each point of the former `income` stat now grants +5% subscriber
conversion** (i.e. it raises the 8% follower→sub rate). Relabel it in the shop
and on the stats screen as a subscriber-conversion buff. No shop item loses its
value, and the buff still thematically means "a nicer setup grows the channel".

TRAIN now costs **5 energy** (was 0 in V2). Update:
- `Data.energyCosts.train = 5`
- the nav button label (it must no longer read `FREE`)
- **the tutorial copy for step 2.** It currently reads *"Free, once a day…"*,
  which is now simply wrong. New copy: *"Costs 5 energy, once a day. Your grade
  sets today's form — it directly raises your chance to win matches. Never queue
  without it."*

  This copy fix belongs to **Package J, which runs last** (see §0). Do not
  make it from any other package — the owner wants the tutorial written against
  final behaviour, and the aim screen's own energy-cost label (Package I) must
  land first so the two agree.

---

## Package F — API additions

Everything below lives in `js/data.js` / `js/state.js` only. Every existing
`Game.State.*` / `Game.Data.*` name from V1/V2 still exists with a working
signature — this section covers what's **new** or **changed behind an
unchanged name**. Verified with `node --check` on both files plus a
standalone Node smoke test (loads the real files via `vm`, stubs
`localStorage`/`window`) exercising every function below: fresh boot,
real-time energy regen across a tick (day, sunset, night, a tick that spans
the day/night boundary), sleep → min-sleep gate → wake, auto-wake at full
energy, the `endDay()` legacy alias, beds (default + upgrade + singleton
swap), max-energy props (stacking to exactly 200, duplicate-purchase safe),
watch-ad refill + 60s cooldown, case cost/energy/hidden-gold-split (sampled
40+ gold pulls to confirm every value lands in the hidden bands and never
leaks via `Data.caseOdds`), prestige's new viewer effect, `statsSummary()`
shape, the full debt-strike → death fail state, dead-save action guards,
`continueSlot()` skipping a dead save, and V1→V3 save migration.

**A note on case economy numbers:** these were rebalanced twice by the owner
while this package was in flight. The numbers implemented match the final
`SPEC-V3.md §11/§12` as of this writing: **cost $7.00**, gold hidden split
**2/3 → $90–150, 1/3 → $250–500**. Do not further adjust them.

### `js/data.js`

```js
Data.energyMax           // 100 — BASE max energy before energy-category upgrades (§10).
                          // The player's actual current cap is State.data.energyMax
                          // (computed, see below) — every place that assumed a flat
                          // 100 must read that instead of this constant.
Data.energyMaxCap        // 200 — hard ceiling State.data.energyMax is clamped to.
Data.energyCosts         // { train: 5, play: 20, stream: 40, scrim: 20, case: 1 }
                          // (train was 0 in V2, §9; case is new, §12)
Data.caseCost             // 7.00 (was 2.50 in V2, briefly 5.00 mid-spec — §11)
Data.caseOdds             // same shape as V2, values updated per §11. The gold
                          // ('rare') entry now has min:null, max:null, hidden:true
                          // — render '?' for it, do not compute a range from it.
                          // Chances (0.65/0.25/0.065/0.025/0.01) are unchanged.
                          // The REAL hidden two-tier gold value roll is NOT in this
                          // catalog or anywhere else Data-side — it's private
                          // constants inside State.openCase() in state.js, by design
                          // (§11: "must never see this split").

Data.shopItems            // extended with two new categories, same shape as existing
                          // entries (id/name/category/band/price/stats/desc), plus
                          // one extra field each (mirrors how `room` items carry
                          // `roomTier` outside `stats`):
                          //   category: 'bed'    — bed_mattress/bed_single/
                          //     bed_memoryfoam/bed_kingsize/bed_cryopod, each with
                          //     a `sleepRate` (energy/sec while asleep). Singleton
                          //     like desk/pc/chair — buying a better bed replaces
                          //     the placed one (State.buyItem -> autoPlaceSingleton).
                          //   category: 'energy' — energy_can/energy_minifridge/
                          //     energy_fridge/energy_ivdrip, each with an
                          //     `energyAdd` (+15/+25/+30/+30). NOT singleton — they
                          //     stack (own all four -> +100, exactly base 100 -> 200
                          //     cap). Placed via the normal EDIT ROOM tray flow, not
                          //     auto-placed.
Data.defaultOwned         // now includes bed_mattress: 1
Data.defaultPlaced        // now includes { id: 'bed_mattress', x: 5, y: 5, rot: 0 }
                          // — the grid's bottom-right corner, matching the "bed"
                          // tile js/hub.js's (unmodified) tileValid() already
                          // reserves at (gridW-1, gridD-1).
```

### `js/state.js` — save schema additions

`State.data` gains (all additive, defaulted, migrated safely from any older
save — including genuinely pre-V2 `cs2sim.v1` saves):

```js
lastEnergyTickAt: <epoch ms>  // real-time energy regen anchor (§1). A save that
                               // predates this field anchors to "now" on migration
                               // rather than granting a backlog of retroactive energy.
wakeElapsedMs: 0               // ms elapsed while awake since the last wake; only
                                // advances while awake (frozen the instant asleep).
                                // Drives day/night phase (§2).
asleep: false                  // true while the interactive sleep() state is active (§3).
sleepGained: 0                 // energy regenerated so far THIS sleep — gates the
                                // 50-energy minimum-sleep rule (§3).
lastAdAt: 0                    // epoch ms of the last watch-ad full-energy grant,
                                // 60s cooldown (§1).
debtStrikes: 0                 // consecutive rent payments that couldn't be fully
                                // covered (§5). 1 = warning, 2 = dead.
dead: false                    // true once debtStrikes reaches 2 — career over (§5).
deadReason: null                // string once dead.
lastPlayedAt: 0                 // epoch ms, stamped on every State.saveCurrent() —
                                 // this is what State.continueSlot() sorts by.
```

`State.data.energyMax` is no longer a static 100 — it's recomputed by
`recomputeEnergyMax()` (internal) as `Data.energyMax + one energyAdd per
DISTINCT energy-category item owned` (duplicate purchases of the same item
don't stack further — this is what guarantees the 200 cap can never be
exceeded), clamped to `Data.energyMaxCap`. Recomputed on save load/migration
and on every `buyItem()` of an `energy`-category item. `State.data.rentMissed`
is still updated (mirrors `min(debtStrikes, 2)`) purely so the current
(unmodified) `js/hub.js` location badge — which reads it directly — still
shows a sane number; it no longer drives any eviction logic (there is none).

### `js/state.js` — new functions

**Real-time energy + day/night phase (§1 / §2)**
```js
State.tickEnergy() -> {
  energy, energyMax, asleep, wakeElapsedMs, phase: 'day'|'sunset'|'night',
  sunsetProgress,   // continuous 0..1 ramp across the 300-360s SUNSET window,
                     // 0 before it starts, 1 once NIGHT begins — for a
                     // per-frame-interpolated gradient, never a hard swap (§2)
  autoWoke: <wake summary>|null   // non-null exactly when energy hit energyMax
                                    // while asleep and auto-wake resolved a new
                                    // day (§3 step 4) as a side effect of this tick
}
```
**This is the tick/reconcile function the UI must call on an interval** (§1) —
it accounts for real elapsed wall-clock time since the last call (whatever
that gap was, including a backgrounded tab or a page reload), splitting the
regen calculation across the day/night boundary if a long gap spans it.
Cheap to call every animation frame: it only touches `localStorage` when an
auto-wake actually resolves a new day, but it does `emit('change')` every
call so listeners can animate smoothly. `State.load()`/`loadSlot()` already
call it once internally so energy is correct immediately on boot/resume —
the UI's own interval is what keeps it correct while the app sits open.

```js
State.dayPhase() -> { phase, sunsetProgress, wakeElapsedMs, asleep }
```
Read-only snapshot of whatever `State.data` currently holds (does **not**
tick) — call `State.tickEnergy()` on your interval to keep this fresh.

```js
State.energyMax() -> number        // convenience read of State.data.energyMax
State.currentBed() -> Data.shopItems entry (category:'bed')  // never null —
                                     // falls back to bed_mattress
```

**Watch-an-ad refill (§1)**
```js
State.watchAdRefill() -> { ok:true, energy } | { ok:false, reason:'cooldown', remainingMs } | { ok:false, reason:'dead' }
State.adCooldownRemaining() -> number   // ms remaining, 0 if ready now
```
Grants full energy instantly and stamps `lastAdAt`; UI owns the ~3s
`AD PLAYING…` overlay/countdown before calling this.

**Sleep (§3 — replaces `endDay()`'s old instant-resolve semantics)**
```js
State.sleep() -> { ok:true } | { ok:false, reason:'already-asleep'|'dead' }
State.canWake() -> { allowed, gained, remainingMs, sleepRate }
State.wake(opts?) -> { ok:true, auto?:true, salary, idle, chemistryPenalty, rent, staffUpkeep, staffQuit }
                   | { ok:false, reason:'not-asleep'|'min-sleep'|'dead', remainingMs?, gained? }
```
`sleep()` puts the player to bed. `canWake()` reports whether the 50-energy
minimum has been regenerated yet this sleep, and if not, how many ms remain
at the current bed's `sleepRate` (poll it for a live countdown — it ticks
internally each call). `wake()` performs everything `endDay()` used to do —
salary, idle income, rent (evaluated against the pre-increment day, so "every
7th sleep" still lines up, §4), staff upkeep, day+1, form reset, scrim quota
reset — **plus** resets `wakeElapsedMs`/`asleep`/`sleepGained` (phase back to
morning, §3 step 4). It refuses (`min-sleep`) until `canWake().allowed` is
true, unless `energy` already hit `energyMax` first — that auto-wakes
transparently the next time anything calls `tickEnergy()` (including from
inside `sleep()`/`canWake()`/`wake()` themselves, which all tick first), or
pass `{ force: true }` to bypass the gate outright.

```js
State.endDay() -> { salary, idle, chemistryPenalty, rent, staffUpkeep, staffQuit }
```
Kept as a **synchronous alias** reproducing the exact old V1/V2 instant
behaviour (energy → full, everything resolves immediately, same summary
shape) — this is what the current *unmodified* `js/hub.js` END DAY button
still calls, and it keeps working exactly as before. No-ops (returns a
zeroed summary) on a dead save rather than throwing.

**Stats screen aggregation (§7)**
```js
State.statsSummary() -> {
  buffs: {
    aim:         { value, label },  // gear.aim, "+X ELO PER MATCH"
    streamMult:  { value, label },  // gear.stream*100, "+X% STREAM CASH"
    idleIncome:  { value, label },  // gear.income, "$X PER DAY"
    prestige:    { value, label },  // gear.prestige*2, "+X% VIEWERS" (§7 — now real, see below)
    luck:        { value, label },  // gear.luck*100, "+X% SHIFT TOWARD RARE DROPS"
    sleepRate:   { value, label },  // current bed's sleepRate, "X ENERGY/SEC (ASLEEP)"
    energyRegen: { value, label },  // 1.0 awake-day, 0 awake-night, "X ENERGY/SEC (AWAKE)"
    energyMax:   { value, label }   // State.data.energyMax, "X MAX ENERGY"
  },
  career: { rank, rankColor, elo, contract, salary, chemistry, scoutHype, day,
            location, gridSize, rentDueInSleeps, debtStrikes, dead, deadReason },
  lifetime: { matches, wins, winRate, streams, casesOpened, bestPull, playtimeMs }
}
```
A pure read — the stats screen (Package H) should be a renderer over this
with no math of its own.

**Save slots — dead-save handling (§5)**
```js
State.listSlots()     // unchanged shape, each entry gains: dead, deadReason
State.continueSlot()  // NEW — the slot index CONTINUE should resume: the most
                       // recently played (by lastPlayedAt) slot that is NOT
                       // dead, or -1 if none. Use this instead of
                       // lastSlot()/activeSlot() for the CONTINUE button —
                       // those two still just report the raw "currently
                       // active" slot regardless of death, unchanged from V2.
```

**Case economy (§11 / §12)**
```js
State.openCase(opts?) -> {
  ok, item, rarity, odds, sold:true, value, cost, net, onStream, energySpent
} | { ok:false, reason:'cash'|'energy'|'dead' }
```
`opts.onStream` (default `false`) is **how a caller says "this open is
happening on stream"** (§12) — `false`/omitted costs 1 energy, `true` costs
0; the $7.00 cash cost and profit-credit path are identical either way.
`rarity`/`odds` entries for the gold tier always carry `min:null, max:null,
hidden:true` — the real hidden-tier value ($90–150 2/3, $250–500 1/3) is
rolled from private constants inside this function and never attached to
anything returned or to `Data.caseOdds`, so nothing UI-readable can leak the
split (§11).

**Stream payout — prestige (§7)**
```js
State.applyStreamResult(res) -> { appliedCash, streamMult, viewerMult, followers, peakViewers }
```
Same call signature as before (`res.cash`/`followers`/`peakViewers`).
`viewerMult = 1 + gearBonus().prestige * 0.02` (§7's "+2% base stream viewers
per point") now multiplies the recorded `followers`/`peakViewers` before
they're added to the save — this **is** "the stream payout path actually
consuming" prestige. `streamMult` (location bonus) still multiplies cash,
unchanged from V2.

**Beds / max-energy props (§3 / §10)**
`State.buyItem()` (unchanged name/signature) now also auto-places `bed`
category purchases as a singleton (anchored to the current grid's
bottom-right corner, matching `js/hub.js`'s existing reserved bed tile) and
recomputes `energyMax` after an `energy` category purchase. Both categories
work through the existing `State.placeItem`/`removePlacedAt`/EDIT ROOM tray
flow otherwise — nothing else changed there.

### Stat audit (§7 "every listed stat must do something")

| Stat | Was it live before V3? | What drives it |
|---|---|---|
| `aim` | Yes | `State.playMatch()` — added into the ELO-gain term and win chance |
| `stream` | Yes | `stream.js`'s payout calc — `cash *= (1 + gear.stream)` |
| `income` | Yes | `resolveNewDay()`/`endDay()`/`wake()` — idle income added to cash each day |
| `luck` | Yes | `State.openCase()` — shifts odds mass from Mil-Spec into the top 3 tiers |
| **`prestige`** | **No — inert.** | **Now wired: `State.applyStreamResult()`'s `viewerMult` (§7, +2%/point).** |

`prestige` was the only inert stat found. It had a value (gear items granted
it, the display-case bonus added to it) but nothing ever read it. It's now
real per spec.

### Known integration caveats for the next round

- **`js/stream.js`'s `openCaseOnStream()`** currently calls
  `G.State.openCase()` with no arguments. Since `State.openCase()` now
  defaults `onStream` to `false`, an on-stream case pull will incorrectly
  cost 1 energy (instead of 0) until Package I updates that call site to
  `G.State.openCase({ onStream: true })`.
- **`js/shop.js`'s `TABS`** array doesn't list `bed` or `energy` yet. Both
  new categories are still fully purchasable — they fall into the `ALL` tab
  filter (only `category !== 'room'` is excluded) — but there's no dedicated
  tab, and `ownedStatus()` doesn't treat `bed` as a singleton "EQUIPPED"
  slot the way desk/pc/chair are (it'll show "OWNED x1" and still offer a
  BUY button that's harmless but pointless to click again). Package H's job.
- **`js/title.js`** doesn't check `dead`/`deadReason` yet — a PLAY tap on a
  dead slot's card still calls `loadSlot()` and enters the hub (every
  mutating action is guarded server-side and returns `ok:false`/`reason:
  'dead'`/a no-op summary, so nothing breaks, but the player isn't blocked
  from trying). Package H should gate slot cards on `listSlots()[i].dead`
  (CAREER LOST / VIEW STATS + DELETE only, §5) and use
  `State.continueSlot()` instead of `lastSlot()` for the CONTINUE button.
- **`js/hub.js`'s END DAY button** still says "END DAY" and calls the
  synchronous `State.endDay()` alias rather than the new interactive
  `State.sleep()` → `State.canWake()` → `State.wake()` flow, and there's no
  SLEEP/SKIP-THE-NIGHT UI, ad overlay, or day/night backdrop rendering yet.
  All of that reads `State.tickEnergy()`/`State.dayPhase()`/`State.sleep()`
  etc. — Package G's job (§2/§3/§6).
- `js/aim.js`'s displayed `-5 ENERGY` label and `useEnergy()` call already
  pick up `Data.energyCosts.train = 5` correctly (its existing `!= null`
  fallback guard from the V2 caveat handles this cleanly — no change needed
  there). `js/main.js`'s bottom-nav TRAIN cost label is also already dynamic
  and will now show `-5` instead of `FREE` automatically. The tutorial
  step-2 copy itself (owned by Package J per §9) still needs updating.
