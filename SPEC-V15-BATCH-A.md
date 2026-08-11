# CS2 PRO SIMULATOR — V15 BATCH A: BUGS + BALANCE (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V14-PHONE.md`. Where they disagree, **this wins**.
All hard constraints apply: vanilla JS, no ES modules, no dependencies, no
external assets, `file://`-safe, tokens-only CSS, 420x860.

Owner playtest list, items 1/4/8/10/12/15/16/17/18/19 + the §20 tier gate.
Tutorials (2/3/5/7/11/14), shop redesign (6) and the phone lock screen (13) are
**Batch B/C — not in this contract.**

**Art rule for this batch:** only items we are already touching get the new
`ART-DIRECTION.md` look. No global restyle.

---

## 0. FILE OWNERSHIP

| File | Package |
|---|---|
| `js/data.js`, `js/state.js` | **A1** |
| `js/iso.js` | **A2** |
| `js/hub.js`, `js/cases.js`, `js/shop.js`, `css/minigames.css` | **A3** |

A1 first and alone. A2 + A3 in parallel after.

### New persisted fields — the rule that has shipped broken FIVE times
`normalizeSave()` only copies keys present in `defaultData()`. Add these there
or they are silently dropped on load:
- `d.reSignCount` (§12)
- `d.bestContractTier` (§20a)
- `d.caseSelection` (§10)

---

## 1. §12 — CONTRACT EXTENSIONS PAY LESS THAN THE CURRENT SALARY (BUG)

**Root cause, already located by the lead — do not re-derive.**
`js/state.js:1854`:
```js
var newSalary = Math.round(pubExpired.salary * (1 + bump));
```
The +20–35% bump is applied to **`pubExpired.salary`** — the team's *live*
recomputed salary — while the offer card shows `oldSalary: d.teamSalary`, the
player's **locked** salary. Those are different numbers.

**Why it got severe:** SPEC-V13 §7 made trajectory *mutable*, and trajectory
multiplies salary (`rising ×0.65`, `stable ×1.15`, `declining ×1.35`). Sign a
`declining` team, have it re-roll to `rising` by contract end, and the live
salary is ~half what you are paid. +35% of half is still a pay cut. **We caused
this in V13.**

### The fix
```
base      = max(d.teamSalary, pubExpired.salary)
bump      = 0.20 + rnd*0.15           (+0.15 if promoted — unchanged)
decay     = max(0, 1 - 0.10 * d.reSignCount)   // 4th re-sign onward flattens
newSalary = round(base * (1 + bump * decay))
newSalary = max(newSalary, d.teamSalary)       // an extension NEVER pays less
```
- `d.reSignCount` increments on `acceptContractExtension()`, resets to 0 when
  the player signs a **different** team.
- The owner's intent, exactly: extensions normally raise pay; re-signing the
  same team repeatedly flattens out.
- The card's `bumpPct` must show the **real** delta vs `d.teamSalary`, not the
  raw roll.

---

## 2. §20a — TIER 1 MUST NOT SIGN A TIER 3 PLAYER

A playtester went T3 → T1 → Major champion in under an hour. The jump is the
exploit.

**Rule:** a Tier 1 team may only offer if the player has *earned the step*:
- their **best completed contract tier** is 2 or better, **or**
- they reached a **semifinal or better** in a Tier 2 tournament.

Track `d.bestContractTier` (lowest tier number ever *completed*, not signed —
walking out early must not count). Tier 2 offers are unchanged: T3 → T2 stays
a legal single step.

Reputation gating (SPEC-V5 §12r) still applies on top of this.

**Refusal must be legible:** the free-agent scout board already lists
objectives — add "COMPLETE A TIER 2 CONTRACT" as a visible requirement rather
than silently never offering.

---

## 3. §18 — CRYPTO PRICES FROZEN ON A FRESH SAVE

Opening the crypto app for the first time shows flat starting prices and an
empty sparkline: the market looks dead because it has never ticked.

Root cause: `tickCrypto()` only runs while the crypto screen is open, and
`normalizeSave()` deliberately re-anchors `lastTickAt` to `Date.now()` on load
so no silent backlog accrues.

**Fix:** pre-seed the market so it looks like it was alive before the player
arrived. In `defaultCrypto()`, run the **real walk function** forward ~200 ticks
from the base prices, keeping the resulting price and the full history buffer.
Do not fabricate a fake-looking series — use the same generator the live market
uses, so the sparkline is honest.

Also seed a couple of already-resolved entries into `newsHistory` so the TRACK
RECORD strip is not empty on first view.

**Do not** make ticks accrue while offline — that was a deliberate V10 decision
and stays.

---

## 4. §15 — SPONSOR PAY IS FAR TOO LOW

The phone unlocks at 300 followers, by which point the player sees thousands of
dollars. A $30/week sponsor is an insult.

### New catalog pay (replaces the current values exactly)
| id | old | **new** |
|---|---|---|
| `sp_pixelsnacks` | 30 | **350** |
| `sp_clipfeed` | 40 | **420** |
| `sp_fiberline` | 45 | **500** |
| `sp_grindcoffee` | 65 | **700** |
| `sp_voltenergy` | 130 | **1200** |
| `sp_streamgear` | 150 | **1400** |
| `sp_apexperiph` | 190 | **1600** |
| `sp_nitroburst` | 320 | **2400** |
| `sp_specterhw` | 480 | **3200** |
| `sp_voltagemedia` | 550 | **3600** |
| `sp_titanchipset` | 750 | **4500** |

### Progress scaling (the owner's "look at how far the player has progressed")
```
progress = clamp01( (elo - 1500) / 3500 )        // 1500 -> 5000 ELO
tierBoost = signed ? (tier === 1 ? 0.35 : tier === 2 ? 0.20 : 0.10) : 0
payMult  = 1.0 + progress * 1.15 + tierBoost      // 1.0 .. ~2.5
pay      = max(350, round(catalogPay * payMult / 10) * 10)
```
- **$350/week floor is absolute** — never pay less, whatever the maths says.
- Applied when an offer is **generated** and frozen onto the held sponsor, so a
  signed sponsor's pay does not silently drift week to week.

---

## 5. §19 — SOCIAL MANAGERS POST PER DAY, NOT PER WEEK

| Manager | old | **new** |
|---|---|---|
| INTERN | 2 / week | **1 / day** |
| CONTENT EDITOR | 4 / week | **2 / day** |
| CREATIVE DIRECTOR | 7 / week | **3 / day** |

Their auto-posts still cost the player **0 energy** — that is what is being
bought (SPEC-V9). Upkeep and quality percentages are unchanged.

---

## 6. §4 — SHEEP GIVE 3% ENERGY PER HIT

`Data.sheepReward` — each sheep hit restores **3% of max energy** (was 1%).
Form and cash rewards are **unchanged** (+0.01 form per 5 hits, cap +0.10;
$1–3 per sheep, cap $50/sleep). Do not re-tune those.

---

## 7. §10 — TWO NEW CASE TIERS + A CASE SELECTOR

Keep the existing system and odds (**65 / 25 / 6.5 / 2.5 / 1**) and the
near-break-even design (current: $7 cost, $7.31 EV, **+4.4%**).

Add two tiers with the **same odds** and matching ROI:

| Case | Cost | Target EV | Value bands (blue / purple / pink / red / gold-low / gold-high) |
|---|---|---|---|
| existing | $7 | $7.31 | 0.40–2.40 / 3–7.40 / 12–28 / 40–100 / 90–150 / 250–500 |
| **PRIME** | **$50** | **~$52** | scale existing bands ×7.14 |
| **ELITE** | **$200** | **~$208** | scale existing bands ×28.6 |

**A1 must MEASURE the EV of each new tier over ≥200k simulated opens** and tune
the bands until each lands within **+3% to +6%** of cost. Do not ship computed-
by-hand numbers — the $7 case took three iterations to land.

Gold stays a **hidden two-tier roll** displayed as `?` — never expose the split
(SPEC-V3 §11).

### Case selection (A1 rules + A3 UI)
- `d.caseSelection = { solo: <caseId>, stream: <caseId> }`, defaulting to the
  $7 case for both.
- The player picks which case to open **solo** and which **on stream**,
  independently — that is the owner's ask.
- Energy cost stays 1 off-stream / 0 on-stream regardless of tier.
- A case the player cannot afford must be selectable but clearly show
  "CAN'T AFFORD" rather than being hidden.

---

## 8. §1 — BANNERS MOUNT ON WALLS, NOT FLOOR TILES

Currently `poster_team` and `window_blinds` are floor props that can sit
anywhere and appear to float.

- Add `mount: 'wall'` to those item definitions.
- A wall-mounted item may **only** be placed on a tile adjacent to one of the
  two visible walls (the `x === 0` and `y === 0` edges).
- **Rotation is derived, never chosen:** the item auto-orients to the wall it
  is mounted on. The ROTATE button is hidden for wall items.
- Wall items do **not** consume floor occupancy — a desk may still sit on the
  same tile. They are on the wall, not the floor. They *do* block another wall
  item on the same wall slot.
- Refusal toast: `BANNERS MOUNT ON WALLS ONLY`.
- All occupancy logic lives in `state.js` and is exported (SPEC-V12 §3);
  `hub.js` derives. **Do not add a second copy of the wall rule.**

---

## 9. §8/§16/§17 — ITEM REDESIGNS (function unchanged, identity changed)

The owner's note on §8 is a design point, not a bug report: *a footrest on the
far side of the room cannot plausibly speed up recovery.* All regen items
become **room-scale amenities**.

| id | old | **new name** | change |
|---|---|---|---|
| `regen_footrest` | ERGONOMIC FOOTREST | **CIRCULATION FAN** | Also fixes the bug: it currently renders invisible when placed. Must be a clearly visible floor prop. |
| `regen_standdesk` | STANDING DESK CONVERTER | **WATER COOLER** | Room-scale, iconic silhouette. |
| `regen_hyperbaric` | HYPERBARIC RECOVERY POD | **RECOVERY POD** | **Footprint becomes 2x1** like a bed (`footprint: { w: 2, d: 1 }`). |
| `regen_purifier` | AIR PURIFIER | *(unchanged)* | Already room-scale. |
| `plant_succulent` | SUCCULENT | **CACTUS** | §16. |
| `energy_drink_stack` | ENERGY DRINK STACK | **PIZZA BOX TOWER** | §17 — the game already has three energy-drink items; this needed its own identity. |

**Keep every `id` unchanged** so existing saves keep what they paid for. Prices,
stats and `regenAdd` values are **unchanged**. Only `name`, `desc`, art and
(for `regen_hyperbaric`) `footprint` change.

`regen_hyperbaric` gaining a 2x1 footprint needs the same migration care as
SPEC-V12 §5: an existing save with one placed may now overlap a neighbour.
Reuse `migrateBedFootprints()`'s approach — relocate, else leave owned but
unplaced. **Never delete a player's item.**

---

## 10. ART FOR THE NEW/CHANGED ITEMS (A2)

These are the batch's first taste of `ART-DIRECTION.md`. Read §2 of that file
before drawing. Apply to the six items in §9 only:

- **2px near-black outline** (`#0b0e1c`) on every shape.
- **The fixed isometric ramp**: top ×1.30, left ×1.00, right ×0.70,
  outline ×0.35. Build it as **one shared helper in `iso.js`** that later work
  can adopt for every other prop — do not inline the multipliers per item.
- Readable silhouette at 420x860 **without zooming**. Verify at real scale.
- `regen_footrest`'s invisibility bug must be gone: confirm the new
  CIRCULATION FAN renders at every rotation.

---

## 11. DEFINITION OF DONE
1. `node --check` clean on every touched file; zero raw hex in touched CSS.
2. All three new persisted fields survive save → reload, proven by test.
3. New case EVs measured over ≥200k opens and inside +3%..+6%.
4. Extension salary proven to never pay less than the current salary, across
   trajectory swings — the exact scenario that caused the bug.
5. T1 offers proven unreachable from a T3-only career, and reachable after a
   completed T2 contract.
6. Verified live over HTTP on a fresh save — never `file://` in a browser tool.
