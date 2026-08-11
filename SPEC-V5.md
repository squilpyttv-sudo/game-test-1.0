# CS2 PRO SIMULATOR — V5 PLAYTEST FIXES (CONTRACT)

Addendum to `SPEC.md`, `SPEC-V2.md`, `SPEC-V3.md`, `SPEC-V4.md`. Where they
disagree, **V5 wins**. All earlier hard constraints still apply: vanilla JS, no
ES modules, no dependencies, no external assets, `file://`-safe, tokens-only
CSS, 420x860 portrait.

These are all **fixes found in a real playtest**. Numbering matches the owner's
list.

---

## 0. FILE OWNERSHIP MAP

| Package | Owns | Items |
|---|---|---|
| **P — core rules & data** | `js/data.js`, `js/state.js` | 1, 5r, 6r, 11, 12, 13r, 14, 16, 17, 18r, 19, 22r, 23, 25, 26, 27r, 28, 29, 30 |
| **Q — hub, room & world** | `js/hub.js`, `js/iso.js`, `js/main.js`, `js/sheep.js`, `js/ui.js`, `css/style.css` | 2, 5u, 7, 8, 9, 15, 21, 31 |
| **R — minigames** | `js/aim.js`, `js/stream.js`, `js/cases.js`, `css/minigames.css` | 3, 4, 13u |
| **S — career, teams, shop** | `js/career.js`, `js/teams.js`, `js/tournaments.js`, `js/shop.js`, `css/teams.css` | 6u, 12u, 20, 22u, 24, 27u, 30u |
| **lead only** | `index.html`, `css/tokens.css`, `js/router.js`, all `.md` | |

*(r = rules, u = UI.)* **Ordering:** P lands first and is then frozen. Q, R and
S run in parallel against P's published API.

**Item 10 (the word "sleeps") applies to every package** — each fixes the
wording in the files it owns. See §10.

If you need a file outside your list, **stop and report it**.

---

## 1. Team names must all be distinct (Package P)

Playtest found dozens of generated teams sharing the same suffix — twenty
different "…Titans", plus repeated Knights / Phantoms / Reapers. It reads as
obviously generated and looks bad.

**Every one of the 100 team names must be unique and structurally varied.**
Delete the suffix-pool generator entirely. Do not build names by combining a
prefix list with a small noun list.

- Keep the ~25 scrambled real orgs (NAWY, EAZE, J2, VYTALITY, ASTRALIX,
  KLOWD9, LIQVID, MOUS, HEROWIC, SPYRIT, FALKONS, ENSE, FNATIK, VIRTUS.BRO,
  FURYA, PAYN, KOMPLEXITY, GAMERLEGEND, THE MONGULZ, BAD NEWS BEAGLES, TYL00,
  GREYHOND, IMPERIUL, 9X, APEXS).
- **Hand-author the remaining ~75** as a flat literal list of distinct names.
  This is the one place a literal list is correct — generation is what caused
  the bug.
- Vary the *shape*, not just the word: single words (VANTAGE, OBSIDIAN, MERIDIAN),
  two-word names (IRON LOTUS, PALE HORSE), abbreviations (BKX, TRV, OM9),
  numerics (UNIT 77, ROOM 402), and place/culture-flavoured names (KOPRI,
  SUNDOWN CO, NORDVIK). **No noun may repeat across the whole roster** — no two
  teams may share any word.

Add an assertion in the data layer that all 100 names are unique, and that no
single word appears in more than one name.

---

## 2. The sheep minigame needs a thought bubble (Package Q)

The current sheep are drawn directly over the room and are barely visible.

Replace with a **thought bubble** floating above the sleeping player: a rounded
cartoon bubble with two or three small trailing circles leading down to the bed.
Inside the bubble, draw a **simple bright green lawn** with a **fence in the
middle**, and the sheep hop over that fence. Everything about the minigame — the
sheep, the fence, the taps — lives **inside** the bubble.

The bubble needs enough contrast against the night room that it reads instantly.
Keep the interior deliberately simple and flat: green ground, a light sky
inside the bubble, a dark fence, white sheep. The hit-test must match the
bubble's interior coordinates.

---

## 3. Case winnings must pay out when the wheel STOPS (Package R)

Right now the value is credited before the roulette finishes, which kills the
tension.

- **Charge the $7 the moment the player clicks to open.**
- **Credit the item's value only when the spin has fully stopped** and the item
  is revealed.
- This applies to opening a case **both off-stream and on-stream**.

Package P exposes the roll result up-front; hold the credit until reveal. Do not
change the odds, the values, or the energy costs.

---

## 4. Aim trainer is 10 seconds (Package R)

Was 15. Everything else about grading is unchanged.

---

## 5. Room editing: rotation, movable core props, and a minimum room

### 5r — rules (Package P)
Define a **minimum viable room**: a **bed**, a **desk**, a **chair**, a **PC**
and a **monitor**. Expose a check for whether the room is complete and which
pieces are missing.

While the room is incomplete, **block** PLAY, TRAIN, STREAM, CASES and CAREER
(including signing anything). The player may still enter the SHOP, edit the
room, and sleep. This makes an empty room a recoverable state, not a soft-lock.

### 5u — UI (Package Q)
- **The chair, PC and monitor cannot currently be moved at all.** Fix: they must
  be **movable** in EDIT ROOM. They must **not** be collectable/removable to
  inventory (they are core props) — moving only.
- **Add rotation.** Props support 4 orientations (0°/90°/180°/270°) and need
  **new visuals for the rotated states** so they read correctly in isometric.
- **New placement flow** (replaces instant drop): drag an item onto a tile and
  it becomes a **ghost preview** rather than being placed. Two buttons appear,
  one either side of the ghost: **↻ ROTATE** (90° per tap) and **✓ PLACE**
  (commits). The player can keep rotating and moving before committing.
- Show a clear banner while the room is incomplete listing what is missing and
  what is blocked.

---

## 6. Max-energy items are capped at 4 total

### 6r — rules (Package P)
The **sum of all energy-category item quantities may never exceed 4** — e.g. 4
energy drinks, or 2 drinks + 2 IV drips. Quantities above 1 per item are now
allowed, but the total is hard-capped at 4.

### 6u — UI (Package S)
Before the player buys their **second or later** energy item, show a
confirmation explaining the 4-item total cap and how many they have left.

---

## 7. The settings button is too small (Package Q)

Make it a proper, obviously tappable control — a clear cog icon at a usable
size, or a labelled `SETTINGS` button. It is currently easy to miss entirely.

---

## 8. The cash balance flickers (Package Q)

**Bug:** the balance rapidly cycles through values (observed jittering between
$65.90 and $66.27), especially the cents.

**Root cause to fix:** `Game.UI.countUp` is being started repeatedly on the same
element before the previous animation finishes, so multiple animations fight
over the same node. **Cancel any in-flight count-up on an element before
starting a new one** (track the animation handle per element).

Additionally, make the money display **stable**: it must read as one clear
number at all times, and on income it should settle to the new total rather than
oscillating.

---

## 9. Remove "EARNINGS" from the match result card (Package Q)

Solo matches pay $0 either way (SPEC-V3 §2), so the line is noise. Remove it
from the post-match reward card. Keep ELO change and the scoreline.

---

## 10. Say "days", not "sleeps" (ALL packages)

The UI says "sleeps" in many places — e.g. `12-SLEEP CONTRACT` in the offers
inbox. A sleep *is* a day, and "days" is what a player expects.

**Every package must sweep the files it owns** and replace player-facing
"sleep/sleeps" wording with "day/days". Grep for `SLEEP` and `sleeps` in strings
and template output.

**Exception:** the SLEEP *button* and the act of sleeping keep their name — that
is the verb, not the unit. Internal identifiers (`rentDueInSleeps`,
`contractSleeps`) may keep their names; only **player-visible text** changes.

---

## 11. Leaving a team early forfeits the signing bonus (Package P)

In addition to the existing hype penalty, leaving before the contract expires
**takes back the signing bonus** the player received on joining, and applies a
**reputation** hit (see §12). If the player cannot cover it, the balance may go
negative (the §5 debt rules of SPEC-V3 then apply as normal).

Make the cost explicit in the confirmation before the player commits.

---

## 12. Reputation (NEW system)

### 12r — rules (Package P)
A second standing metric alongside hype. Unlike hype it is **signed**: it runs
from **-100 (toxic) through 0 (neutral, the starting value) to +100 (respected)**.

| Event | Reputation |
|---|---|
| Win a tournament | **+6** (a Major: **+18**) |
| Complete a full contract | **+15** |
| Win an official team match | **+0.5** |
| Leave a team early | **-25** |
| Miss the daily scrim quota | **-3 per day** |
| Kicked off a team (§26) | **-40** |

Bands, and what they gate:

| Band | Range | Effect |
|---|---|---|
| RESPECTED | +40 … +100 | All tiers scout you |
| NEUTRAL | 0 … +39 | Normal |
| QUESTIONABLE | -39 … -1 | **Tier 1 will not offer** |
| TOXIC | -100 … -40 | **Only Tier 3 will offer** |

So a player with the ELO for Tier 2 but a wrecked reputation gets only Tier 3
interest, and must rebuild by signing, **completing a full contract**, and not
missing scrims. Keep it simple — this is a gate on offers, not a second economy.

### 12u — UI (Package S)
Show reputation on the career screen with its band name and what it is currently
gating, and surface the change whenever it moves.

---

## 13. Streaming: stop whenever you like

### 13r — rules (Package P)
- **Minimum stream length 10 seconds**, then the player may stop at any time.
- **No fixed 45s session.** Cash accrues **per second** streamed.
- **Cap the viewer count** so a multi-minute stream does not spiral. Viewers
  ramp toward a ceiling and plateau; earnings keep accruing per second, but at
  the plateau rate rather than compounding.

### 13u — UI (Package R)
Replace the countdown with an elapsed timer, a **STOP STREAM** button that is
locked for the first 10 seconds (with a countdown), and a live readout of cash
earned so far. Everything else about chat, tilt, hype and moderators is
unchanged.

---

## 14. Viewers scale with career progress (Package P)

Audience should grow with your career even if you stream irregularly. Apply a
tier multiplier to base viewers:

| Status | Viewer multiplier |
|---|---|
| Free agent | ×1.0 |
| Tier 3 | ×1.5 |
| Tier 2 | ×3.0 |
| Tier 1 | ×6.0 |

Per-viewer donation value should also rise with tier (more viewers *and* richer
viewers), so promotion is felt immediately in stream income. Keep the existing
follower- and prestige-based contributions on top.

---

## 15. Rank display above 2,100 ELO (Package Q)

Once ELO passes **2,100**:
- The progress label currently reading `X / MAX` must read **`PRO LEAGUE`**.
- The rank chip currently reading `PRO` must read **`SIGNED`** or **`UNSIGNED`**
  depending on whether the player is on a team.

---

## 16. A day lasts 90 seconds (Package P)

Replaces SPEC-V3 §2's 300s/360s. New windows: **DAY 0–75s**, **SUNSET 75–90s**,
**NIGHT 90s+**. Night still persists until the player sleeps.

---

## 17. Buying a better desk must replace the old one (Package P)

Chairs swap correctly; **desks do not**. The singleton auto-replace works for
some categories and not others. Fix so every singleton category (desk, chair,
PC, monitor, bed) replaces its predecessor in the room immediately on purchase.

---

## 18. Coaches also handle scrims (Package P rules)

**Remove the level-4 coach entirely** (LEGENDARY COACH) — the gap between it and
level 3 was negligible. **Level 3 (VETERAN IGL) is now the best coach available.**

All coaches still set daily form. In addition:

| Coach | Scrim behaviour |
|---|---|
| **L1 ROOKIE COACH** | **Reminds** you: if you try to sleep before hitting the team's scrim quota, a prompt warns you first. Does not fill anything. |
| **L2 TEAM ANALYST** | **Gradually fills** the scrim bar across the day — fully topped up by nightfall. Framing: *"runs film sessions and drills in the background while you grind."* |
| **L3 VETERAN IGL** | Scrim quota is **automatically satisfied** each day. Framing: *"schedules and runs the whole practice block — the team trains whether or not you show up early."* |

---

## 19. Cheaper moderators (Package P)

TRIAL MOD **$3,000 → $2,000**. VETERAN MOD **$12,000 → $8,000**. Upkeep and
auto-ban percentages unchanged.

---

## 20. Shop becomes one scrolling list (Package S)

Remove the **ALL** tab and the category-tab row entirely. The shop opens as a
**single continuous scroll** through every section in order, with sticky section
headers: **DESK → PC → MONITOR → CHAIR → BED → ENERGY → DECOR → STAFF**.

---

## 21. Notification dots and a tournament gate (Package Q)

- When a tournament is live/pending, show a **red notification dot** on the
  **CAREER** and **TOURNAMENTS** entry points, styled like an app badge.
- **Block SLEEP entirely while a tournament is pending** — the player must play
  it out first. Explain why on tap.
- Each morning, if the scrim quota is not met, show the same **red dot on
  CAREER**. It clears the moment the quota is satisfied.

---

## 22. Realistic CS2 scorelines (Package P rules, Package S display)

Match scores must be legal CS2 (MR12) results:
- **Regulation:** winner reaches **13**, loser **0–11**. Winner must be ahead by
  at least 2.
- **Overtime:** if both reach **12–12**, play continues to **16**; winner
  reaches 16 with the loser on **12–14** (e.g. `16-14`, `12-16`).

No `4-13`-style results where the winner has fewer than 13. Show the opposing
teams' completed match scores in the bracket before the player plays their own.

---

## 23. Tournaments are tier-locked (Package P)

Only teams of the **same tier** may enter a tournament of that tier. A Tier 1 or
Tier 2 team must never appear in a Tier 3 event. This **overrides SPEC-V4 §6a's**
"plus a couple of seeded higher-ranked sides".

---

## 24. Trajectory icons and rank-change arrows (Package S)

Replace the `RISING` / `STABLE` / `DECLINING` text pills on the leaderboard:
- **Rising → a fire icon.**
- **Declining → a snowflake icon.**
- **Stable → no icon.**

Additionally show **recent rank movement**: a **green up arrow** with the number
of places gained, or a **red down arrow** with places lost, since the last
event. Draw them as simple CSS/inline SVG shapes — no image assets.

The offer cards keep their plain-language trajectory banners (that trade-off
still needs spelling out); this change is for the **leaderboard**.

---

## 25. Tournaments every 7 days (Package P)

Was 14. Note this now shares a cadence with rent — that is fine and intentional,
but make sure both fire correctly on the same day.

---

## 26. Repeatedly missing scrims gets you kicked (Package P)

Track consecutive days where the scrim quota is missed. At **3 consecutive
misses**, the team **terminates the contract**: the player becomes a free agent,
loses hype, and takes the **-40 reputation** hit from §12. Warn clearly at the
first and second miss so it never feels arbitrary.

---

## 27. Salary rises when your team is promoted

### 27r — rules (Package P)
A contract's salary is currently frozen at signing. It must **follow the team's
tier**: if the team moves up (or down) a tier, recompute the player's salary
from the team's new band on the next wake.

### 27u — UI (Package S)
On waking after a tier change, show a **banner**: the team's new tier and rank,
the old and new salary, and any other stat that moved. A promotion should feel
like an event.

---

## 28. Tournament matches move ELO 3x (Package P)

Winning or losing a tournament match affects the player's ELO by **≈3x** a
regular match. These are the high-stakes games.

---

## 29. Trajectory drives tournament results (Package P)

AI team results must reflect their trajectory:
- **Rising** teams win about **70%** of their tournament matches.
- **Declining** teams win about **35%**.
- **Stable** teams sit near 50%, adjusted by strength as now.

Blend this with the existing strength-based `winChance` rather than replacing it,
so a rising minnow still loses to a strong side more often than not.

---

## 30. Shorter contracts, with extension offers (Package P rules, S UI)

- Contract length now ranges **8–16 days** (was up to 31).
- **On expiry the team offers an extension** designed to tempt the player to
  stay: better terms than the original — e.g. **+20–35% salary** and a **fresh
  signing bonus**. A team that has been promoted should offer notably more.
- The player may accept the extension or become a free agent and shop around.

---

## 31. The suburban backdrop needs ground (Package Q)

At the first location the distant houses float with no ground beneath them.
Add a **textured green grass plane** filling the space below the houses —
subtle tonal variation and a few darker tufts, not a flat fill. It must still
work across the day/sunset/night gradient (grass goes deep blue-green at night).

---

## Package P — API additions

Package P (`js/data.js` + `js/state.js`) is now frozen. Every existing
`Game.State.*` / `Game.Data.*` name still works unchanged — everything below
is **additive**. Headless smoke test: 61 assertions, all passing (team-name
uniqueness, energy 4-cap, reputation bands/gating, kick-after-3-misses,
contract extension, salary-follows-tier, legal scorelines over 100+ sampled
matches, case payout timing, full save-schema round trip).

### 1. Team names (§1)
`Data.teams` is unchanged in shape. The suffix-pool generator is gone; the
75 non-seed names are now a literal `FICTIONAL_TEAM_NAMES` list inside
`js/data.js`. A self-check runs at module load and **throws** if any of the
100 names collide or any word repeats — if you ever add/edit a name, check
it against the full list first.

### 2. Minimum viable room (§5r)
```
Game.State.roomCompleteness()
  -> { complete: boolean, missing: ['bed'|'desk'|'chair'|'pc'|'monitor', ...] }
```
Checked against `placed` (physically in the room), not `owned`. A new
`monitor` shop category exists now (`monitor_basic` / `monitor_144hz` /
`monitor_240oled`), a singleton like desk/pc/chair/bed — buying one
auto-replaces the previous one in the room (`State.buyItem`), and it can't
be removed to inventory, only moved (`State.removePlacedAt` blocks it, same
as desk/pc/chair). `Data.defaultOwned`/`Data.defaultPlaced` now include a
starter `monitor_basic`, so a **fresh** save's room is already complete.

**Hard-gated in state.js** (return `{ ok: false, reason: 'room-incomplete',
missing: [...] }`, or `null` for `setForm`) while incomplete:
`State.playMatch()`, `State.setForm()`, `State.openCase()`,
`State.acceptOffer()`, `State.signContract()`, `State.acceptContractExtension()`.
SHOP (`buyItem`/`placeItem`/`removePlacedAt`) and sleep
(`sleep`/`wake`/`endDay`) are intentionally **not** gated.

**Left to UI:** the missing-pieces banner text/listing (Q), and — important —
**STREAM is not gated from state.js** because session start lives entirely in
`js/stream.js` (Package R owns it; state.js has no "start stream" entry
point). Package R's `startSession()` **must** call
`Game.State.roomCompleteness().complete` itself before allowing GO LIVE.

### 3. Energy 4-item cap (§6r)
```
Game.State.energyItemStatus() -> { total, cap, remaining, atCap }
```
`State.buyItem(id)` now blocks (`return false`) an energy-category purchase
once the **summed quantity across every energy item** would exceed
`Data.energyItemCap` (4). Per-item quantity above 1 is now allowed.
`d.energyMax` is recomputed as `base + sum(energyAdd * qty)`, still clamped
to `Data.energyMaxCap` (200). **Left to UI (§6u):** the confirmation dialog
before a 2nd+ purchase, using `energyItemStatus()`.

### 4. Reputation (§12r)
```
Game.State.reputationStatus() -> { value, band, bandLabel, gating }
// band: 'respected' | 'neutral' | 'questionable' | 'toxic'
```
Persisted at `d.reputation` (signed, -100..0..+100, starts 0). Event values
exactly per spec (win tournament +6/+18 Major, complete contract +15, win
official match +0.5, leave early -25, miss scrim -3/day, kicked -40). Bands
gate `tryGenerateOffers` internally — toxic only yields tier-3 candidates,
questionable excludes tier-1 — no UI wiring needed for the gate itself, only
for displaying `reputationStatus()`.

### 5. Scrims + coach behaviour (§18/§26)
```
Game.State.scrimQuotaStatus()
  -> { quota, progress, met, coachBehavior: 'remind'|'gradual'|'auto'|null, consecutiveMisses }
Game.State.sleepWarning() -> { warn: boolean, quota, progress }
```
`Data.staffCoaches` now has 3 entries (LEGENDARY COACH deleted); each has
`scrimBehavior` and `scrimFraming` (the in-fiction line from the spec).
`sleepWarning()` is `true` only for the L1 ROOKIE COACH ('remind') when the
quota isn't met yet — **call this before `State.sleep()`** to show the
confirm prompt; it does not block sleep itself. 3 consecutive missed days
(tracked at `d.consecutiveScrimMisses`, visible via `scrimQuotaStatus()`)
auto-terminates the contract inside `resolveNewDay` — surfaced on the
`wake()`/`endDay()`/`skipNightAd()` result as `res.scrimMiss = { count, kicked }`
and, when it fires, `res.kicked = { reason: 'missed-scrims', teamId }`.

### 6. Leaving early (§11)
```
Game.State.leaveTeamCost(opts?) -> { signingBonusForfeit, hypePenalty, reputationPenalty } | null
```
Call before showing the confirm dialog. `State.leaveTeam(opts)` now also
subtracts the full signing bonus from cash (may go negative — §5 debt rules
apply as normal) and applies the reputation hit; its result now includes
`signingBonusForfeit` and `reputation`.

### 7. Contracts: length + extension (§30)
Contract length is now 8-16 days. On natural expiry, `resolveNewDay` (via
`wake()`/`endDay()`/`skipNightAd()`) sets `d.contractExtensionOffer` and
returns it on the summary as `res.contractExtensionOffer`:
```
{ teamId, teamName, oldSalary, newSalary, signingBonus, contractSleeps, promoted, bumpPct }
```
```
Game.State.contractExtensionOffer() -> offer | null
Game.State.acceptContractExtension() -> { ok, team, salary, signingBonus, contractSleeps }
Game.State.declineContractExtension() -> boolean
```
`newSalary` is +20-35% over the old salary (more if the team was promoted
since signing). Accepting re-signs to the **same** team at the new terms.

### 8. Salary follows tier (§27r)
No new function — `resolveNewDay` now detects a tier change on the signed
team every wake and recomputes `d.teamSalary`. Surfaced on the
`wake()`/`endDay()`/`skipNightAd()` result:
```
res.tierChange = { oldTier, newTier, oldSalary, newSalary, rank, promoted }
```
(only present the wake a change is detected). **Left to UI (§27u):** the
promotion/relegation banner.

### 9. Streaming (§13r/§14)
No changes to `State.applyStreamResult(res)`'s input shape
(`{cash, followers, peakViewers}`) — it now also applies a **tier**
multiplier on top of the existing location/prestige ones, and its return
gains `tierViewerMult`/`tierDonationMult`. New constants for Package R's
session rewrite to consume:
```
Data.streamMinSeconds      // 10 — minimum stream length before STOP unlocks
Data.streamViewerCap       // 500 — viewers ramp toward this and plateau
Data.streamTierViewerMult  // { free: 1.0, t3: 1.5, t2: 3.0, t1: 6.0 }
Data.streamTierDonationMult// { free: 1.0, t3: 1.3, t2: 1.8, t1: 2.5 }
```
**Left to UI/R:** the actual min-10s/stop-anytime/per-second/plateau session
mechanics in `js/stream.js`, and the room-completeness gate on GO LIVE (see
§2 above).

### 10. Case payout timing (§3/§21)
`State.openCase(opts)` **charges the $7 immediately** but no longer credits
the pulled value. Its return shape changed:
```
{ ok, pendingId, item, rarity, odds, sold: false, credited: false,
  value, cost, net, onStream, energySpent }
```
```
Game.State.creditCaseReveal(pendingId) -> { ok, value, cash } | { ok:false, reason:'not-found' }
Game.State.discardPendingCaseReveal() -> boolean
```
Package R's wheel (`js/cases.js`, `js/stream.js`'s on-stream open) must call
`creditCaseReveal(pendingId)` exactly once, when the wheel visually stops.
Cash/`stats.bestPull` are untouched until then. This is a **breaking change**
for the current unmodified `cases.js`/`stream.js` — they'll display the
correct value but the cash won't land until Package R wires this in.

### 11. Tournaments (§22r/§23/§25/§28/§29)
- Every 7 days (`Data.tournamentIntervalSleeps`), same modulus rent uses —
  both fire on the same sleep by construction.
- Tier-locked: `rollTournamentField` only draws from the signed team's own
  tier. `Data.tournamentTiers[...].seedExtra` still exists (value `0`) for
  shape compatibility but is unused.
- All match scores (`match.scoreA`/`scoreB`) are now legal CS2 results:
  13-to-(0..11), or (both hit 12-12 conceptually) 16-to-(12..14). Never a
  winner below 13.
- AI results blend strength (65%) with a trajectory bias (35%) —
  `Data.trajectoryWinBias = { rising: 0.20, stable: 0, declining: -0.15 }`.
- Tournament matches involving the player move ELO by
  `Data.tournamentEloMultiplier` (3x); each resolved match object gains
  `match.eloDelta` when it's the player's own match.

### 12. Mods / day length / coaches (§19/§16)
`mod_trial` $2,000, `mod_vet` $8,000. Day 0-75s, sunset 75-90s, night 90s+
(`js/state.js`'s internal `DAY_END_MS`/`NIGHT_START_MS` — no new API, existing
`State.dayPhase()`/`State.tickEnergy()` shapes unchanged).

### New persisted fields (defaultData(), all additive)
`reputation`, `consecutiveScrimMisses`, `lastSigningBonus`,
`contractSignedTierAtSign`, `lastKnownTeamTier`, `contractExtensionOffer`,
`pendingCaseReveal`. All round-trip through save/load per the smoke test.

### Not done / explicitly left to other packages
- Room rotation, ghost-preview placement, and **rendering a `monitor` prop**
  in isometric (Q owns `iso.js`) — the data/state layer is ready, art isn't.
- All UI copy/banners/confirmations referenced above (Q/R/S, per file
  ownership).
- Item 10 (sleep -> day wording): audited both owned files — no
  player-facing "sleep(s)" strings existed in `data.js`/`state.js` to begin
  with (only internal identifiers like `contractSleeps`, `rentDueInSleeps`,
  and one unrelated flavor line — "STREAM CAT BED... sleeps here" — which is
  about the cat, not a day unit, and was left as-is).
