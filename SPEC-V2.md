# CS2 PRO SIMULATOR — V2 CHANGE SPEC (CONTRACT)

Addendum to `SPEC.md`. Where the two disagree, **V2 wins**.
All V1 hard constraints still apply: vanilla JS, no ES modules, no dependencies,
no external assets, must run from `file://`, tokens-only CSS, 420x860 portrait.

---

## 1. Energy costs (REPLACES SPEC §5.1)

| Action | Energy | Notes |
|---|---|---|
| TRAIN | **0** | Free. Still once per day — it sets that day's form. |
| PLAY | **20** | |
| STREAM | **40** | |
| SCRIM | **20** | **Only available when signed to a team** (see §8) |

`energyMax` stays 100. A full day is therefore ~2 streams + 1 match, or 5
matches, etc. Buttons that cost more energy than the player has stay disabled.

---

## 2. Income sources (REPLACES all match-earning rules)

**Solo matchmaking pays nothing.** A Free Agent earns $0 from PLAY, win or lose.
PLAY grants ELO only. This is the core economic tension: ranking up costs you
time and earns you nothing directly.

Money comes from exactly four places:

1. **Streaming** — the primary income.
2. **Case pulls** — variance income (auto-sold, see §10).
3. **Team salary** — paid daily as `salary / 30` once signed.
4. **Official team matches** — once signed, PLAY becomes an **OFFICIAL MATCH**
   and pays prize money on a win:
   `prize = tierPrize * (0.5 + chemistry/100)` where `tierPrize` is
   t3: $120, t2: $700, t1: $4,000. A loss pays `prize * 0.15`.

Idle income from room props is unchanged and still pays on `endDay()`.

---

## 3. Tutorial (NEW)

Fires **automatically on a brand-new save**, never on an existing one. Must be
**skippable at any time** via an always-visible `SKIP` control, and must not
block input — it coaches, it does not gate.

Exactly **7 steps**, each a small panel anchored near the relevant control with
a pointer/arrow and a dimmed-but-clickable backdrop:

1. **YOUR ROOM** — "Everything you buy shows up here. Every item makes you better."
2. **TRAIN FIRST** — "Free, once a day. Your grade sets today's form — it directly raises your chance to win matches. Never queue without it."
3. **PLAY** — "20 energy. Climbs your rank. Solo matches pay no money — rank is the goal."
4. **STREAM** — "40 energy. This is how you actually make money. Ban the red toxic messages before they reach the top."
5. **CASES** — "Gamble your cash. Skins sell instantly. Open one live on stream and a rare pull explodes your viewer count."
6. **SHOP** — "Spend on gear. It appears in your room and permanently buffs your stats."
7. **END DAY** — "Refills energy, pays your salary and idle income. Rent comes due every 7 days once you move out."

Persist `data.tutorialDone = true` on completion or skip. Add a
**REPLAY TUTORIAL** entry in settings.

---

## 4. Front page / title screen (NEW)

The app now boots to a **title screen**, not the hub. Big pixel logo, animated
starfield, three primary buttons:

- **CONTINUE — <save name>** — resumes the most recently played save. Hidden
  entirely if no saves exist.
- **SAVES** — slot browser, **3 slots**. Each slot shows name, rank chip, day,
  cash, and playtime, or `EMPTY — NEW CAREER`. Actions per slot: PLAY, RENAME,
  DELETE (delete needs a confirm). Creating a new save asks for a player name.
- **SETTINGS** — **music volume** and **sound volume** as separate 0–100
  sliders, plus REPLAY TUTORIAL and a global RESET ALL SAVES (confirmed).

### Storage change
Move from the single V1 key to:
- `cs2sim.saves` — `{ slots: [saveObj|null, saveObj|null, saveObj|null], lastSlot: 0 }`
- Migrate an existing `cs2sim.v1` save into slot 0 on first V2 boot, then leave
  the old key alone (do not delete it).

Every save object gains `name` (string) and `playtimeMs` (number).

### Music
There are no audio files and none may be added. Implement a short **procedural
WebAudio loop** (a few oscillators, gentle arpeggio, low-pass filtered) as
background music, wired to the music-volume slider. Sound volume controls the
existing `Game.UI.beep` SFX. Both persist globally (not per-save) and default to
music 30, sound 70.

---

## 5. Automation — Coaches & Moderators (NEW)

Both are hired from a new **STAFF** section in the shop. Each has a **one-time
hire cost** and a **daily upkeep** deducted in `endDay()`. If cash goes negative
at upkeep time, staff quit (highest upkeep first) with a toast.

### 5a. Coaches — automate the aim trainer
While a coach is hired, form is set automatically at the start of each day and
TRAIN becomes optional. If the player trains manually anyway, **the better of
the two multipliers applies** — so a great player can still out-perform a cheap
coach, which keeps the minigame meaningful.

| id | Name | Hire | Upkeep/day | Auto form |
|---|---|---|---|---|
| coach_rookie | ROOKIE COACH | $2,000 | $40 | 0.25 (C) |
| coach_analyst | TEAM ANALYST | $8,000 | $150 | 0.45 (B) |
| coach_igl | VETERAN IGL | $25,000 | $450 | 0.70 (A) |
| coach_legend | LEGENDARY COACH | $120,000 | $1,800 | 0.90 (S-) |

Only one coach at a time; hiring a better one replaces the old.

### 5b. Moderators — automate chat banning
While a mod is hired, they auto-ban a share of toxic messages during the stream
minigame (visibly — the line flashes and vanishes with a `MOD BAN` tag), so the
player handles fewer. This is what makes high-viewer streams survivable.

| id | Name | Hire | Upkeep/day | Auto-bans |
|---|---|---|---|---|
| mod_trial | TRIAL MOD | $3,000 | $60 | 35% of toxic |
| mod_vet | VETERAN MOD | $12,000 | $220 | 60% |
| mod_head | HEAD MOD | $40,000 | $700 | 85% |
| mod_ai | AUTOMOD AI | $150,000 | $2,400 | 97% |

Auto-banned lines award **half** the normal hype (the player still benefits, but
manual bans are better). Only one mod at a time.

---

## 6. Room expansion (NEW)

Within the current location the player can buy **expansions** that grow the
floor grid by 1 tile per side, up to that location's cap. Cost:
`expandCost = baseExpand * (1.8 ^ expansionsBought)`, `baseExpand` per location
in §7. Expanding must visibly enlarge the room and keep all placed props valid.

---

## 7. Locations, moving, and rent (NEW — REPLACES `roomTier`)

`roomTier` is replaced by `locationId` + `expansions`. Four locations:

| id | Name | Grid | Move-in cost | Rent / 7 days | Stream mult | Expand cap | baseExpand | Backdrop |
|---|---|---|---|---|---|---|---|---|
| 0 | PARENTS' BASEMENT | 6x6 | — | **$0 (rent free)** | 1.00 | +2 | $600 | suburban street, night |
| 1 | CITY CENTRE APARTMENT | 8x8 | $3,500 | $350 | 1.25 | +2 | $2,200 | neon city skyline |
| 2 | BEACH VILLA | 10x10 | $25,000 | $1,800 | 1.60 | +3 | $9,000 | ocean, palms, sunset |
| 3 | ESPORTS MANSION | 12x12 | $150,000 | $9,000 | 2.20 | +3 | $40,000 | hills, gated drive |

- **Stream mult** multiplies all streaming cash — a nicer room means viewers
  "like it more". Surface this in the UI so the trade-off is legible.
- **Rent** is deducted automatically in `endDay()` every 7th day
  (`day % 7 === 0`) for locations 1–3. Show a rent-due warning on day 6.
- **Missed rent:** if cash < rent, mark `rentMissed++` and toast a warning.
  At `rentMissed >= 2` the player is **evicted back to location 0** (props go to
  inventory, `rentMissed` resets). Do not let cash go negative from rent.

### The moving minigame
Moving to a new location is a small interactive sequence, not a menu click:

1. Player buys the move from the LOCATIONS screen (pays move-in cost).
2. The hub enters **PACKING MODE**: every placed prop must be **tapped** to be
   boxed up (prop animates into a cardboard box, counter shows `PACKED 4 / 11`).
3. Once the room is empty, a **MOVE OUT** button lights up.
4. Tapping it plays a short travel transition (van drives across, backdrop
   swaps), then drops the player into the new, larger, empty room with all props
   in inventory to re-place via the existing EDIT ROOM flow.

Each location needs a **distinct procedurally-drawn backdrop** behind the room
(replacing the plain starfield at location 0+), so the move feels like a real
change of scene.

---

## 8. Scrims require a team

Remove SCRIM entirely for Free Agents — the button must not appear (not merely
be disabled). It becomes available only when `contract !== 'free'`.

---

## 9. Difficulty curve (REPLACES SPEC §5.3 win/gain rules)

Early ranks should climb fast to hook the player; difficulty returns to the V1
level by the time Tier 3 is in reach.

```
earlyMult  = clamp(1.6 - (elo / 1400) * 0.6, 1.0, 1.6)
earlyWin   = clamp(0.12 * (1 - elo / 1400), 0, 0.12)

dELO       = (ELO_base * (1 + M_form) + B_gear.aim) * earlyMult
winChance  = clamp(0.30 + 0.35*M_form + B_gear.aim/120 + chemBonus + earlyWin, 0.05, 0.92)
```

So at Silver (elo 0) gains are 1.6x and win chance is +12%; by elo 1400 both
have decayed to exactly the V1 values, and everything from there up is unchanged.
Loss penalty is also scaled by `1 / earlyMult` so early losses sting less.

---

## 10. Cases auto-sell (REPLACES the sell/display flow)

On reveal, the pulled skin is **immediately sold** and its value added to cash.
Show it in the result as `SOLD — +$X` with the rarity colour and the net result
vs. the $2.50 cost. **Remove the DISPLAY mechanic and the inventory list**
entirely. Keep `stats.bestPull`. Display-case shop props remain purchasable
decor but are no longer tied to pulls.

---

## 11. Stream difficulty scales with viewers (REPLACES SPEC §5.7 pacing)

Difficulty must be driven by live viewer count, so growth creates the pressure
that makes hiring a moderator necessary.

Interpolate on `v = clamp(viewers, 30, 400)`, `t = (v - 30) / 370`:

```
spawnDelayMs   = lerp(900, 170, t)      // 30 viewers = calm, 400 = flood
toxicChance    = lerp(0.10, 0.24, t)
msgLifetimeMs  = lerp(6500, 2800, t)    // time to reach the top and tilt you
```

At ~30 viewers this must be genuinely relaxed — a new player should comfortably
clear every toxic line. At 300+ it should be unmanageable without a moderator.
Moderator auto-bans (§5b) are applied **before** the player sees the line, which
is what brings a big stream back under control.

Keep the existing tilt/hype/combo/hype-train reward numbers unchanged.

---

## 12. Case odds (REPLACES SPEC §5.6 table)

| Rarity | Chance | Value range | Colour token |
|---|---|---|---|
| Mil-Spec (blue) | **65%** | $0.10 – $3 | --r-milspec |
| Restricted (purple) | **25%** | $2 – $12 | --r-restricted |
| Classified (pink) | **6.5%** | $10 – $60 | --r-classified |
| Covert (red) | **2.5%** | $40 – $300 | --r-covert |
| Rare Special (gold) | **1%** | $300 – $5,000 | --r-rare |

Sums to 100%. The `luck` gear stat still shifts mass out of Mil-Spec into the
top three tiers using the existing rule. Update the DROP ODDS panel to match.

---

## Package A — API additions

Everything below lives in `js/data.js` / `js/state.js` only. Every V1 name
(`Game.State.*`, `Game.Data.*`) still exists with its original signature and
return shape — this section covers what's **new** or **changed behind an
unchanged name**. Verified with `node --check` on both files plus a
standalone Node smoke test exercising every function below (fresh boot,
solo-vs-signed match earnings, scrim gating, coach/mod hire+upkeep+quit,
coach-vs-manual form, cases auto-sell, room expansion, the full move flow,
rent due/warning/missed/eviction, and V1→V2 save migration).

### `js/data.js`

```js
Data.energyCosts        // { train: 0, play: 20, stream: 40, scrim: 20 }  (was 10/25/20/20)
Data.matchPrizes        // { t3: 120, t2: 700, t1: 4000 } — tierPrize for official matches (§2)
Data.caseOdds           // same shape as V1, values now 0.65/0.25/0.065/0.025/0.01 (§12)

Data.locations          // NEW — array of 4, index === id:
                         // { id, name, gridW, gridD, moveInCost, rent, streamMult,
                         //   expandCap, baseExpand, backdrop }
                         // NOTE: Data.roomTiers (V1, 3 entries) is UNTOUCHED and still
                         // what iso.js/hub.js/shop.js render/read this round via
                         // State.data.roomTier. Data.locations + State.data.locationId
                         // is the new parallel system; wiring the renderer/shop/hub to
                         // it (and retiring roomTier) is next round's job.

Data.staffCoaches       // NEW — array of 4:
                         // { id, name, hire, upkeep, formGrade, formLabel, formMult }
Data.staffMods          // NEW — array of 4:
                         // { id, name, hire, upkeep, autoBanPct }
```

### `js/state.js` — save schema additions

`State.data` gains (all additive, defaulted, migrated safely from old saves):

```js
locationId: 0        // int, index into Data.locations — parallel to legacy roomTier
expansions: 0         // int, expansions bought at the current location
rentMissed: 0         // consecutive missed rent payments (evicted at 2)
moving: null          // { targetLocationId, packed: [placedIndex, ...] } | null
staff: { coachId: null, modId: null }
name: 'CAREER'         // save slot display name
playtimeMs: 0          // accumulated playtime; nothing currently increments this —
                        // whichever module owns the boot loop should call
                        // State.data.playtimeMs += dt and State.save() periodically
```

### `js/state.js` — new functions

**Staff (§5)**
```js
State.hireCoach(id) -> { ok, coach } | { ok:false, reason:'invalid'|'already-hired'|'cash' }
State.hireMod(id)   -> { ok, mod }   | { ok:false, reason: ... }   // same shape
State.fireCoach() -> bool
State.fireMod() -> bool
State.currentCoach() -> Data.staffCoaches entry | null
State.currentMod()   -> Data.staffMods entry | null
```
Only one coach + one mod at a time; hiring a different one replaces the
current one outright (no refund). `State.endDay()` deducts upkeep for both
and auto-quits the highest-upkeep one(s) first if cash can't cover it —
cash is never left negative by upkeep. Coach auto-form is applied at the
start of every day (`State.endDay()` internally calls `applyCoachAutoForm`);
`State.setForm(grade)` (unchanged name/signature) now keeps whichever of
{existing day's form, this manual roll} has the higher `mult`.

**Locations, expansion, moving (§6 / §7)**
```js
State.currentLocation() -> Data.locations entry
State.currentGrid() -> { w, d }   // base grid + expansions, per side
State.expansionCost() -> number | null   // null = already at expandCap
State.buyExpansion() -> { ok, expansions, cost, grid } | { ok:false, reason:'no-location'|'max'|'cash' }

State.startMove(locationId) -> { ok, moving } | { ok:false, reason:'invalid-location'|'already-here'|'already-moving'|'cash' }
State.packPropAt(index) -> bool   // index into State.data.placed (NOT x,y — tiles can hold >1 prop, e.g. the starting desk+PC share one tile)
State.movingProgress() -> { packed, total, ready } | null   // null when not moving
State.commitMove() -> { ok, locationId, grid } | { ok:false, reason:'not-moving'|'not-packed' }
State.cancelMove() -> bool   // aborts packing; does NOT refund the move-in cost already spent
```
`State.applyStreamResult(res)` (unchanged name/signature/call site) now
multiplies `res.cash` by the current location's `streamMult` before adding
it to cash — stream.js does not need to know about locations.

**Save slots (§4)** — for the title-screen agent:
```js
State.listSlots() -> [ { index, exists:false } | { index, exists:true, name, day, cash, elo, rankName, rankColor, contract, playtimeMs }, ... ]  // length 3
State.lastSlot() / State.activeSlot() -> number   // current slot index (aliases, same fn)
State.loadSlot(index) -> State.data    // loads slot (creates a fresh default in-memory if empty), sets it active
State.createSlot(index, name) -> State.data   // overwrites slot with a brand-new save, sets it active
State.renameSlot(index, name) -> bool
State.deleteSlot(index) -> bool        // sets slot to null (does not touch other slots)
State.saveCurrent() -> void            // persists State.data into the active slot
```
`State.load()` / `State.save()` / `State.reset()` keep their V1 no-arg
signatures and now operate through the slot system (`State.load()` = load
`lastSlot`, creating an in-memory default if empty; `State.save()` = write
into the active slot). Storage key `cs2sim.saves` = `{ slots: [obj|null,
obj|null, obj|null], lastSlot }`. On first V2 boot, an existing `cs2sim.v1`
save is migrated into slot 0 and **`cs2sim.v1` is left in localStorage,
untouched**.

**Cases (§10)** — `State.openCase()` keeps its name/ok/item/rarity/odds
shape and adds:
```js
{ ..., sold: true, value: number, cost: number, net: value - cost }
```
The item is no longer pushed into `State.data.inventory` (auto-sell — value
is already added to cash before the function returns). `sellInventoryItem`/
`displayInventoryItem` are kept working (for any item that survived a
migrated pre-V2 save) but `openCase()` no longer feeds them, so in the
current (unmodified) `js/cases.js` the SELL/DISPLAY buttons on the reveal
card will just silently no-op — removing that UI is next round's job.

**Match (§2 / §9)** — `State.playMatch()` keeps its `ok/win/nudge/eloDelta/
elo/earnings/score` shape and adds `official: boolean` (true once signed).
Free-agent earnings are always `0`; signed earnings follow the prize-tier
formula in §2. ELO gain/loss now follows the `earlyMult`/`earlyWin` curve in
§9 exactly, including scaling the loss penalty by `1/earlyMult`.

### Known integration caveats for the next round

- **`js/aim.js` line 16**: `COST_ENERGY = (G.Data.energyCosts.train) || 10`.
  Since `Data.energyCosts.train` is now `0` (a legal falsy value), this
  fallback silently reinstates the old cost of **10** for both the displayed
  "-10 ENERGY" label and the actual `G.State.useEnergy()` call — TRAIN is
  not actually free in-game yet. Fix by changing the fallback to a
  `!= null` check when `aim.js` is next touched.
- **`js/career.js`**: the SCRIM button is unconditionally rendered/enabled;
  `State.scrim()` now returns `false` for free agents (§8), so tapping it
  shows the (slightly wrong) "NOT ENOUGH ENERGY" toast instead of a
  free-agent-specific message, and the button never disappears as §8
  requires. Needs the button hidden/relabeled when `contract === 'free'`.
- **Room rendering**: `State.data.roomTier` + `Data.roomTiers` (V1, 3 tiers)
  and `State.data.locationId`/`expansions` + `Data.locations` (V2, 4
  locations) are two parallel, unreconciled systems this round. The legacy
  path still drives everything `iso.js`/`hub.js`/`shop.js` render. Whoever
  owns those files next should replace `roomTier` reads with
  `locationId`/`expansions`/`State.currentGrid()`.
- `playtimeMs` accumulates only if something calls it — no timer is wired
  up yet (out of scope for state/data).
