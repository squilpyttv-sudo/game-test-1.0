# CS2 PRO SIMULATOR — V13: FIFTH PLAYTEST PASS (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V12-FOOTPRINTS.md`. Where they disagree, **this
wins**. All hard constraints still apply: vanilla JS, no ES modules, no
dependencies, no external assets, `file://`-safe, tokens-only CSS, 420x860.

Nine owner-reported items. Every number below is decided — implement what is
written, do not re-tune.

---

## 0. FILE OWNERSHIP MAP

| File | Package |
|---|---|
| `js/data.js` | **A** |
| `js/state.js` | **A** |
| `js/hub.js` | **B** |
| `js/iso.js` | **B** |
| `js/career.js` | **C** |
| `js/tournaments.js` | **C** |
| `js/crypto.js` | **C** |
| `js/teams.js` | **C** |
| `css/teams.css` | **C** |
| `js/main.js` | **D** |
| `js/shop.js` | **D** |
| `js/stats.js` | **D** |
| `js/tutorial.js` | **D** |
| `css/style.css` | **D** |
| `index.html`, `css/tokens.css`, `js/ui.js`, `js/router.js`, docs | **LEAD** |

**A runs first and alone.** B, C, D run in parallel only after A has landed.
If you need a file you do not own, **stop and report it** — do not work around
it.

### THE RULE THAT HAS COST THIS PROJECT THE MOST
`normalizeSave()` only copies keys present in `defaultData()`. **Every new
persisted field below must be added to `defaultData()` (or the relevant
default-builder) or it is silently dropped on load.** This has bitten the
project five times. New persisted fields in this batch:

- `d.lastCashAdAt` (§9)
- `d.crypto.lastSeenNewsTick` (§8)
- `d.teams[].traj` and `d.teams[].trajUntil` (§7)

Each one must survive a save → reload round trip, **proven by test**, not
assumed.

### The second most expensive rule
When two places need the same rule, **export it from `state.js` and derive** —
never mirror. Four user-visible bugs came from a second stale copy.

---

## 1. OFFER CARDS: SCOUT INTEL TEXT REPLACES THE LONE EMOJI

**Owner report:** the bare 🔥 in its own bordered box on an offer card looks
bad.

`js/career.js`'s `trajBanner()` currently renders an **icon only** (SPEC-V7
§8). Replace the icon with a **line of scout intel prose** whose sentiment
matches the team's trajectory.

### A. Data (Package A — `js/data.js`)

Add `Data.trajectoryScoutLines`, three pools:

```js
Data.trajectoryScoutLines = {
  rising: [
    'Analysts indicate the team has some untapped potential.',
    'Scouts say their young rifler is about to break out.',
    'They have quietly won three straight scrims against better sides.',
    'The roster finally clicked after their IGL swap.',
    'Insiders expect them to punch well above their seed this season.',
    'Their new coach has completely rebuilt the map pool.',
    'Bookmakers have started shortening their odds every week.',
    'Word is a Tier 1 org already tried to buy the roster out.',
    'They have been bootcamping non-stop and it is starting to show.',
    'Their last three demos have the whole scene talking.',
    'A rebuild nobody rated is starting to look very smart.',
    'The momentum is real — they are winning the close ones now.'
  ],
  stable: [
    'A steady side with no drama and no surprises.',
    'They win what they should and lose what they should.',
    'Analysts call them the most predictable team in the tier.',
    'The roster has been unchanged for months, for better or worse.',
    'Solid, professional, and going precisely nowhere.',
    'No red flags here, but no breakout signs either.',
    'A comfortable mid-table side, and they know it.',
    'Scouts describe them as a safe, unspectacular home.',
    'Their results chart is a flat line, month after month.',
    'A stable org that pays on time and asks few questions.'
  ],
  declining: [
    'According to insiders the team is facing problems with their coach.',
    'Two starters are reportedly already listed for transfer.',
    'Their last four series all ended in the group stage.',
    'Sources say salaries have been paid late twice this month.',
    'The roster has looked disinterested since the shuffle.',
    'Analysts think their star player is well past his peak.',
    'Their main sponsor pulled out and the org has gone quiet.',
    'Practice attendance has reportedly become a real problem.',
    'Rivals have solved their default and they have not adapted.',
    'The org is rumoured to be considering a full rebuild.',
    'Their IGL is reportedly close to stepping down.',
    'Bookmakers have drifted their odds every single week.'
  ]
};
```

Add a **deterministic** selector so the line does not re-roll on every render
(`render()` runs often — a line that changes on every repaint reads as a bug):

```js
// Data.scoutLineFor(teamId, trajectory, seed) -> string
// Deterministic: same (teamId, trajectory, seed) always yields the same line.
// `seed` is the trajectory period start day (§7) so the line changes exactly
// when the team's heat changes, and never in between.
```

Implement with a simple string hash of `teamId + '|' + trajectory + '|' + seed`
modulo the pool length. No `Math.random()` anywhere in this function.

### B. UI (Package C — `js/career.js`, `css/teams.css`)

- `trajBanner(team)` now returns a banner containing the **text line**, not the
  icon. Keep the existing per-trajectory accent colour (`TRAJ_COLOR`) on the
  border and text.
- **Stable teams now get a banner too** (they previously got none). Owner asked
  for "more than a few so it doesn't seem repeated" and a neutral read is more
  informative than a blank space.
- The line must be readable at 420px wide: wrap to 2–3 lines, sentence case,
  smaller than the salary line, no truncation with an ellipsis.
- Read the seed from `team.trajectorySince` (Package A exposes it on
  `teamPublic()` — see §7).
- `js/teams.js`'s compact leaderboard rows **keep the fire/snowflake icons**
  unchanged. Only the offer/team **cards** in `career.js` get prose.

---

## 2. ENERGY ITEMS MUST HAVE DISTINCT MAX-ENERGY VALUES

**Owner report:** owning an energy drink fridge and an energy IV drip makes no
difference. Correct — `energy_fridge` and `energy_ivdrip` both carry
`energyAdd: 30`.

### New values (Package A — `js/data.js`), exact:

| id | old `energyAdd` | **new `energyAdd`** |
|---|---|---|
| `energy_minifridge` | 25 | **15** |
| `energy_fridge` | 30 | **20** |
| `energy_ivdrip` | 30 | **25** |

- Update each item's `desc` string so the parenthesised "(+N MAX ENERGY…)" text
  matches its new number. A stale desc is a lie to the player.
- `drinkCapacity` is **unchanged** (4 / 12 / none).
- Prices are **unchanged**.
- The comment above the block currently claims the cap is "100 base +
  15+25+30+30" — that describes **four** items, one of which no longer exists.
  Rewrite it to state the truth: three energy items, at most
  `Data.energyItemCap` (4) placed at once, summed, clamped to
  `Data.energyMaxCap` (200). Four placed IV drips = 100 bonus = exactly the 200
  ceiling.

### Everywhere else (all packages) — verify, do not assume
`energyAdd` is consumed generically in four places. Each must be **checked in
the running game**, not eyeballed:

1. `js/state.js` `recomputeEnergyMax()` — sums `energyAdd` across **placed**
   energy items (Package A: confirm it still clamps correctly at the new
   values).
2. `js/shop.js:~247` — renders the `+N MAX ENERGY (PLACED)` chip from
   `def.energyAdd` (Package D: confirm the chip reads 15/20/25).
3. `js/stats.js:~96` — the stats "FROM:" breakdown (Package D: confirm).
4. `js/tutorial.js` — grep for any hardcoded energy number (Package D).

**Package D must also grep the entire repo** for the literal strings `+25 MAX`,
`+30 MAX`, `25 MAX ENERGY`, `30 MAX ENERGY` and any other hardcoded copy of
these numbers, and report anything found outside `data.js`.

---

## 3. DESK + PC + MONITOR MOVE AS ONE UNIT

**Owner report:** moving the table leaves the monitor floating in mid-air.

Root cause: `desk`, `pc` and `monitor` are three independent placed entries
that merely *may* share a tile (`SHARED_TILE_CATEGORIES`, SPEC-V12 §1). Moving
the desk moves only the desk.

### The rule
**A workstation is the desk plus every `pc` and `monitor` whose placed tile is
the desk's tile.** Moving or rotating any member moves the whole workstation,
together, in one action.

- A `pc` that is **not** on a desk tile is a standalone floor tower and keeps
  moving independently. That is legitimate and must keep working.
- A `monitor` can never be off-desk (SPEC-V12 §1 already enforces "a monitor
  may only be placed on a tile that already holds a desk"), so after this
  change a floating monitor is structurally impossible.

### A. `js/state.js` (Package A) — the logic lives here, exported

Add, deriving the member categories from the existing
`SHARED_TILE_CATEGORIES` (do **not** write a second literal list):

```js
State.groupIndicesFor(idx)        // -> [idx, ...] placed indices moving together.
                                  //    Returns [idx] for anything that is not
                                  //    part of a workstation.
State.canMoveGroup(idxs, x, y, rot) // -> { ok, reason }   read-only probe
State.moveGroup(idxs, x, y, rot)    // -> { ok, reason }   validates then commits
```

`groupIndicesFor(idx)`:
- If the item at `idx` is a `desk` → that index plus every `pc`/`monitor`
  currently placed on the desk's tile.
- If it is a `pc` or `monitor` sitting on a tile that holds a desk → the
  **desk's** index plus its co-tenants (i.e. tapping the monitor selects the
  whole workstation, anchored on the desk).
- Otherwise → `[idx]`.

`canMoveGroup` / `moveGroup` validation, generalised (not special-cased to
three 1x1 props):
1. Extend `canPlaceFootprint()`'s `excludeIdx` parameter to accept **a number
   or an array of indices**, keeping the existing single-number call sites
   working unchanged. Every group member is excluded from the occupancy scan so
   the group never blocks against itself.
2. For each member, validate its footprint at the destination with the **whole
   group** excluded.
3. The `monitor` "needs a desk on that tile" requirement is satisfied when a
   `desk` is a member of the moving group. A **non-group** monitor already on
   the destination tile still blocks (no tile ever holds two monitors).
4. Bounds and the reserved bed corner behave exactly as they do today.
5. `moveGroup` writes `x`/`y`/`rot` to every member and calls `commit()`
   **once**.

`moveGroup` must be all-or-nothing: if any member fails validation, **nothing
moves** and a reason is returned.

### B. `js/hub.js` (Package B) — derive, never re-implement

- Tapping any workstation member in EDIT ROOM opens a **group draft**:
  `pendingPlacement.groupIdxs = State.groupIndicesFor(picked.idx)`.
- `pendingTileCheck()` routes a group draft through `State.canMoveGroup()`.
- `commitPendingPlacement()` routes it through `State.moveGroup()`.
- `renderGhost()` draws **every member's** art at the draft tile (desk, then
  pc, then monitor — same draw order `iso.js` already uses for a settled
  workstation) so the preview shows what will actually move.
- Toast on success: `WORKSTATION MOVED` when the group has more than one
  member, otherwise the existing `<ITEM NAME> MOVED`.
- Rotation applies to every member.

**Do not add a second copy of the grouping rule in `hub.js`.** Call
`State.groupIndicesFor()`. If the export is missing, fall back to `[idx]` (a
defensive single-item draft), never to a re-implementation.

---

## 4. EXACTLY ONE CORE ITEM MAY BE PLACED PER CATEGORY

**Owner report:** you should only ever have one bed, one monitor, one PC, one
desk (and one chair) placed in the room.

Today `SINGLETON_ROOM_CATEGORIES = ['desk','pc','chair','monitor','bed']` means
**"at least one"** — surplus instances are allowed and removable. It now means
**"exactly one"**.

### A. `js/state.js` (Package A)

**Placing a core item when that category's slot is already filled performs a
SWAP IN PLACE.** The incoming item takes the incumbent's exact `x`, `y` and
`rot`; the incumbent returns to storage (removed from `placed`, **left
untouched in `owned`**). The requested tile is ignored for this path.

This is the decision that removes every edge case:
- a new desk cannot strand a monitor, because it lands on the old desk's tile;
- a new bed's 2-tile footprint is guaranteed to fit, because the old bed
  already fit there;
- no validation can fail on a swap for same-footprint items.

Guard anyway: **if the incoming item's footprint differs from the incumbent's**,
re-validate at the incumbent's anchor with the incumbent excluded, and refuse
with a toast-ready reason if it does not fit.

- `State.placeItem()` changes return type from `boolean` to
  `{ ok, reason, replaced }`, where `replaced` is the swapped-out item's **name**
  (or `null`). **`js/hub.js:770` is the only external caller** — Package B
  updates it. Do not leave a boolean-shaped `if (!ok)` behind anywhere.
- `State.removePlacedAt()` keeps its existing "never remove the last placed
  instance of a core category" guard. With exactly-one enforced, core items are
  simply never removable — that is correct and intended, and swapping is the
  upgrade path.
- Non-core categories (decor, energy, regen) are **unaffected**: they still
  stack freely up to their own caps.

### B. Migration — `migrateCoreSingletons(d)`

A save may already have two chairs (or two of anything core) placed. On load:

- For each core category with more than one placed entry, **keep the one whose
  shop item has the highest `price`** (the best thing the player owns and had
  placed; ties → the lowest placed index). Remove the others from `placed`.
- **Never remove anything from `owned`.** A player's item is never deleted.
- Run it inside `normalizeSave()`, **before** `recomputeEnergyMax()`, alongside
  the existing `migrateBedFootprints()` / `migrateLegacyFridges()`.
- Document the choice in a comment, as V12's migration did.

### C. `js/hub.js` (Package B)

- The tap branch at `~915` splits on `placedCountInCategory(cat) <= 1`. With
  exactly-one enforced the `else if` surplus-removal branch is **dead code** —
  delete it. Every core tap now opens the move/group draft.
- Placing a core item from the edit tray must **not** open a ghost draft when
  that category's slot is already filled. It swaps immediately, with
  `beep('cash')` and a toast: `<NEW NAME> SWAPPED IN — <OLD NAME> RETURNED TO
  STORAGE`.
- A core item you own but have not placed must still be visible and tappable in
  the edit tray (that is how you swap).

### D. `js/shop.js` (Package D)
Audit the placed-vs-owned cap copy for core categories. If it implies you may
place more than one, fix the copy. Report what you changed.

---

## 5. SCRIM MUST REPORT THE CHEMISTRY IT ACTUALLY GIVES

**Owner report:** the button says `+12 CHEMISTRY` and the toast says
`CHEMISTRY +12`, but the real gain is small.

Root cause: SPEC-V6 §26 changed the gain to `randInt(2, 4)` in
`State.scrim()`; both display strings are hardcoded leftovers from the old flat
12. **This is the project's most expensive bug pattern — correct state, stale
consumer.**

### A. `js/state.js` (Package A)
`State.scrim()` returns an object instead of a bare boolean:

```js
{ ok: true,  chemistry: <the exact amount granted, 2-4> }
{ ok: false, reason: 'dead' | 'no-team' | 'energy' }
```

`js/career.js:115` is the **only** caller. Grep to confirm before changing.

### B. `js/career.js` (Package C)
- Button text: `SCRIM (-20 ENERGY, + CHEMISTRY)` — **no number**, per the
  owner.
- Success toast: `SCRIM COMPLETE — CHEMISTRY +N` with the real `res.chemistry`.
- Failure toasts must name the real reason (SPEC-V12 §4 / HANDOFF §9.7 — no
  impossible advice):
  - `energy` → `NOT ENOUGH ENERGY`
  - `no-team` → `SIGN WITH A TEAM BEFORE SCRIMMING`
  - `dead` → `YOUR CAREER IS OVER`

---

## 6. TOURNAMENT MATCHES PLAY OUT ROUND BY ROUND

**Owner report:** a match is just a popup saying won or lost. Make the round
count-up visually interesting, from 0-0, **5–10 seconds total** depending on
round count.

Package C only — `js/tournaments.js` + `css/teams.css`. **No state/rules
change:** `State.playTournamentMatch()` already returns the final score, and it
stays the authority. The animation is a *presentation* of a result that has
already been decided.

### The round sequence
From the real final `(yourScore, oppScore)`, synthesise a CS2-legal path:

- Total rounds = `yourScore + oppScore`.
- Build an array of `(winnerScore - 1)` winner-rounds and `loserScore`
  loser-rounds, shuffle it, then **append one final winner-round**. This
  guarantees the match ends exactly on the winning round and the loser never
  exceeds their real score at any point.
- Regulation is MR12: at round 12 show a **HALFTIME — SIDES SWAP** beat.
  Scorelines of 12-12 go to overtime (to 16) — those simply have more rounds;
  no separate code path is needed.

### Presentation (your design latitude — make it good)
Required elements:
- Both teams' logos (`G.Teams.renderLogo`) and names either side of a large
  `0 : 0` scoreboard that counts up.
- A strip of **round pips**, one per round, filling left→right in the colour of
  whichever side won that round.
- The winning side's score pulses/flashes on each round it takes.
- Occasional flavour lines (~25% of rounds, **never two in a row**) from a pool
  in `tournaments.js` — e.g. `ECO WIN`, `CLUTCH 1v3`, `ACE`, `FORCE BUY HELD`,
  `PISTOL ROUND`, `RETAKE`, `4K`, `NINJA DEFUSE`.
- A streak label when either side takes 3+ in a row.
- `MATCH POINT` beat when the leader reaches `finalScore - 1`, with the last
  round slowed for tension.
- A **SKIP** button that jumps straight to the final score and goes on to the
  reward card. Non-negotiable — nobody wants to sit through this every match.

### Timing — hard budget
```
perRound = clamp(6500 / totalRounds, 170, 400) ms
intro ~700ms · halftime beat ~700ms · match-point beat ~600ms · outro ~600ms
```
The **total must never exceed 10s**: after computing the above, if the total
would exceed 10,000ms, scale `perRound` down until it fits. A 13-round match
lands near 7s; a 30-round overtime near 9s. Verify both ends by measuring, not
by estimating.

### Mechanics that will bite you
- Drive the sequence with a **single `setInterval`**, not a chain of
  `setTimeout`s and not `requestAnimationFrame`. `rAF` is throttled to **0fps in
  a backgrounded tab** and would freeze the animation mid-match (this has
  produced a false diagnosis in this project before).
- Clear the interval in `onExit`, on SKIP, on completion, and defensively
  before starting a new one. Instrument and prove **exactly one interval open
  while running, zero after**.
- Guard against a double-start (rapid double-tap of PLAY MATCH).
- The existing `UI.rewardCard` result flow runs **after** the animation,
  unchanged — including `celebrateMajor()`.
- `css/teams.css`: **zero raw hex**, tokens only.

---

## 7. TEAM HEAT (🔥/❄) CHANGES EVERY 7–14 DAYS

**Owner report:** teams almost never change their hot/cold streak.

Root cause: `trajectory` is a **static, immutable** field baked into
`Data.teams[i]` at boot from a fixed seed (`trajectoryForRank()`), read through
`teamStaticById(id).trajectory`. It can never change for the life of a save.

### The rule
A team's trajectory is now **mutable per save** and re-rolls on a **7–14 day**
cycle, independently per team.

### A. `js/data.js` (Package A)
```js
Data.trajectoryCycleDays = { min: 7, max: 14 };
Data.trajectoryRollWeights = { rising: 0.30, stable: 0.40, declining: 0.30 };
// Chance the PLAYER's team flips to 'rising' after a good tournament run,
// when it is currently 'stable' or 'declining' (§7C).
Data.trajectoryTournamentBoost = {
  CHAMPION: 0.65, 'RUNNER-UP': 0.45, SEMIFINALIST: 0.25
};
Data.rollTrajectory = function (prevTraj) { /* weighted pick, mild anti-repeat */ };
```
`rollTrajectory` must include a **mild anti-repeat**: if the weighted pick
equals `prevTraj`, re-roll once (and accept whatever the second roll gives).
Without it a 40%-weighted `stable` team looks static to the player, which is the
exact complaint.

### B. `js/state.js` (Package A)
- The **mutable** team slice (`d.teams[i]`, seeded by `ensureTeams()`) gains
  `traj` (string) and `trajUntil` (day number).
- `ensureTeams()` seeds `traj` from the static catalog value, and
  `trajUntil = d.day + randInt(1, 14)` — deliberately **staggered on the first
  cycle only**, so all 100 teams do not flip on the same day. Later cycles use
  the full `randInt(7, 14)`.
- `ensureTeamTrajectories(d)` migrates an existing save whose `d.teams[]`
  entries have no `traj`/`trajUntil`. Must be idempotent.
- `tickTeamTrajectories(d, summary)` runs **once per day advance** inside
  `resolveNewDay()`: every team with `d.day >= trajUntil` gets
  `traj = Data.rollTrajectory(traj)` and `trajUntil = d.day + randInt(7, 14)`.
- `teamPublic()` reads `mut.traj || st.trajectory` (never the static field
  alone) and additionally exposes:
  - `trajectorySince` = `trajUntil - <that cycle's length>`, i.e. the day the
    current heat started. §1's deterministic line selector seeds off this, so
    the scout line changes exactly when the heat does.
- If the **player's own team** changes heat, put
  `summary.teamHeatChange = { from, to }` on the wake summary.

### C. Tournament boost
In `finalizePlayerOutcome()`, once `placement` is known: if the player's team's
current `traj` is `'stable'` or `'declining'`, roll
`Data.trajectoryTournamentBoost[placement]`. On success set `traj = 'rising'`
and `trajUntil = d.day + randInt(7, 14)`, and surface it on the tournament
result object so Package C can show a line like `YOUR TEAM IS ON A HOT RUN`.

### D. Consequences — decided, do not "fix" them back
- **Salary follows live trajectory** for offers and the leaderboard, because
  `teamPublic()` recomputes it via `Data.salaryForRankTrajectory()`.
- **A signed contract is NOT repriced.** `d.teamSalary` is locked at signing and
  only moves on a tier change (existing SPEC-V5 §27r behaviour). A team going
  cold must not silently cut the player's agreed pay.
- `Data.trajectoryWinBias` already feeds the match simulation, so a team's heat
  now genuinely changes how it performs. That is the point.
- `Data.teams[i].trajectory` stays as the **seed** for a fresh save. Nothing may
  read it for live display any more.

### E. Persistence
`d.teams` is an array of plain objects copied wholesale by `normalizeSave()`.
**Prove** `traj` and `trajUntil` survive a save → reload round trip with a test.
Do not assume the array copy is deep enough.

---

## 8. CRYPTO NEWS RAISES A NOTIFICATION DOT

**Owner report:** a new crypto headline should raise a red dot on the CRYPTO
button in the career nav, exactly like TOURNAMENTS does.

### A. `js/state.js` (Package A)
- New persisted field `d.crypto.lastSeenNewsTick` (default `0`). **It must be
  added to `defaultCrypto()` AND to the explicit `d.crypto = {...}` rebuild in
  `normalizeSave()` (~line 715)** — that block lists every crypto key by hand,
  so a field missing from it is dropped on load even if `defaultCrypto()` has
  it. This is §0's rule in its nastiest form.
- `State.cryptoUnseenNewsCount()` → count of **active** news with
  `createdTick > lastSeenNewsTick`.
- `State.markCryptoNewsSeen()` → sets `lastSeenNewsTick = d.crypto.tickCount`,
  commits.

### B. `js/career.js` (Package C)
- Add `<span class="badge-dot" id="career-crypto-badge" aria-hidden="true">`
  inside the CRYPTO nav button, mirroring the TOURNAMENTS one exactly.
- Toggle `badge-dot--show` from `State.cryptoUnseenNewsCount() > 0` in
  `render()`, **and** on the existing 1s `quotaTickTimer` interval
  (`career.js:464`) so the dot appears while the screen is already open. Do not
  add a second interval.

### C. `js/crypto.js` (Package C)
Call `State.markCryptoNewsSeen()` on `onEnter` (after the catch-up tick) and
again on each 1s tick while the screen is open, so headlines seen live are not
still flagged on exit.

### D. Decided: the dot does NOT propagate to the hub's CAREER badge
`hub.js:297` lights the hub CAREER dot for a pending tournament or an unmet
scrim quota. Crypto headlines spawn continuously, so folding them in would leave
that dot permanently lit and destroy its meaning. The owner asked for the dot
"in the career section", which is exactly the career nav row. **Package B makes
no change for §8.**

---

## 9. TAP THE TOP-BAR STATS FOR AN EXPLAINER + A CASH AD

**Owner report:** tapping the four numbers in the top bar should open a popup
explaining what each one means, and offer "watch an ad for money" scaled to
progress.

### A. `js/state.js` + `js/data.js` (Package A)

```js
Data.cashAdCooldownMs = 300000;   // 5 minutes — deliberately longer than the
                                  // energy ad's 60s; see the note below.
```

New persisted field **`d.lastCashAdAt` (default 0) — add it to `defaultData()`**.
It must be a **separate** cooldown from the energy ad's, so the two never
compete.

```js
State.cashAdCooldownRemaining()   // -> ms, mirrors State.adCooldownRemaining()
State.cashAdReward()              // -> integer $, PURE (no mutation), for tests
State.watchAdCash()               // -> { ok, amount, reason }
```

**Reward formula — exact:**

```
elo = d.elo
if (elo < 1500)  -> randInt(50, 100)
if (elo < 2500)  -> randInt(200, 600)
otherwise:
  monthlyProxy = (d.teamSalary || 0)
               + (d.subscribers || 0)      * 2.50  * (30/7)
               + (totalSocialFollowers)    * 0.015 * (30/7)
               + (d.followers || 0)        * 0.05
  base   = clamp(round(0.12 * monthlyProxy), 600, 25000)
  amount = round(base * (0.8 + random*0.4) / 10) * 10     // ±20%, to nearest $10
  amount = clamp(amount, 600, 25000)
```

Sanity checks the owner's brief implies, which you must **measure**:
- Silver player (< 1500 ELO): $50–100. ✓ by construction.
- 1500–2500 ELO: $200–600. ✓ by construction.
- A Tier 3 pro earning ~$5,000/month total → `0.12 × 5000 = $600`, ±20% ⇒
  **$480–720**, clamped up to **$600–720**. Matches the owner's "$500–800"
  example.
- Continuous at the 2500 boundary: the band tops out at $600 and the formula
  floor is $600 — **no cliff**. Assert this.
- A top-10 T1 player on $250k/month clamps at **$25,000**.

`totalSocialFollowers` must come from the existing social API, not a new
computation — grep for how `js/social.js`/`statsSummary()` already reads it.

**Cooldown rationale (recorded so it is not "improved" back):** 5 minutes ≈ 3.3
in-game days. At the $600 T3 tier that is roughly one day's salary every three
days — a real but non-dominant income. It is a tunable constant; the owner
should be told the number so they can retune it after a playtest.

### B. `js/main.js` + `css/style.css` (Package D)

- Make the `.topbar__resources` block tappable. It contains four `<span
  class="res">` children; give the **container** the click handler plus
  `role="button"`, `tabindex="0"` and an `aria-label`, and a visible pressed
  state. Do not attach four separate handlers.
- **Do not rebuild `innerHTML` on the topbar refresh path.** `refreshTopbar()`
  runs off a 1s tick; replacing nodes under an active touch is the documented
  root cause of this project's multi-tap bug (HANDOFF §9.5). Add the handler
  **once**, in the build function.
- `openResourcesModal()` — same construction pattern as the existing
  `openEnergyModal()` (modal layer, backdrop, `reward-card panel confirm-card`,
  a `refresh()` closure, a CLOSE button). Four rows, each with the stat's own
  icon, its name, its **current value**, and one line of plain explanation:

| Stat | Explanation |
|---|---|
| **CASH** | Everything you own. Earned from streaming, cases, prize money, your salary, subscribers and sponsors. Rent comes out of it every 7 days — go negative twice and your career is over. |
| **FOLLOWERS** | People who follow your stream. More followers raises the viewer ceiling every time you go live, and more of them convert into paying subscribers. |
| **SUBSCRIBERS** | Paying supporters converted from your stream followers. Each one pays $2.50 every 7 days, and they are paid out before rent is charged. |
| **PEAK VIEWERS** | The most people who ever watched a single stream. It is your record — teams and sponsors read it as proof of reach. |

- Then the ad control, mirroring the energy modal's shape:
  - ready → `WATCH AN AD — GET CASH`
  - on cooldown → `AD READY IN Ns` + `btn--disabled`
  - on tap → `window.Game.Main.playAdOverlay(...)` (already exported,
    `main.js:597`), then `State.watchAdCash()`, then a `UI.rewardCard` (or
    equivalent) showing the amount won, `beep('cash')`.
  - The amount is **revealed after the ad**, not promised before it.
- `css/style.css`: **tokens only, zero raw hex.**

---

## 10. DEFINITION OF DONE (every package)

1. `node --check` clean on every file you touched.
2. `grep -cE '#[0-9a-fA-F]{3,8}\b'` returns **0** for any stylesheet you touched.
3. Every new persisted field proven to survive save → reload (§0).
4. No new hardcoded mirror of a rule that `state.js` exports (§0).
5. Every refused action toasts a reason a player can act on (SPEC-V12 §4).
6. Report anything you found but did not own, rather than working around it.
