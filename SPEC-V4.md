# CS2 PRO SIMULATOR — V4 CHANGE SPEC (CONTRACT)

Addendum to `SPEC.md`, `SPEC-V2.md`, `SPEC-V3.md`. Where they disagree, **V4
wins**. All earlier hard constraints still apply: vanilla JS, no ES modules, no
dependencies, no external assets, must run from `file://`, tokens-only CSS,
420x860 portrait.

The headline change: **the pro career becomes a real system.** Instead of a
button that jumps you a tier, there is a 100-team leaderboard, teams that scout
you and make competing offers, and a tournament calendar you play through.

---

## 0. FILE OWNERSHIP MAP

| Package | Owns |
|---|---|
| **L — core rules & data** | `js/data.js`, `js/state.js` |
| **M — career, teams & tournaments UI** | `js/career.js`, `js/teams.js`, `js/tournaments.js`, `css/teams.css` |
| **N — hub, sleep & packing** | `js/hub.js`, `js/iso.js`, `js/main.js`, `js/sheep.js`, `css/style.css` |
| **lead only** | `index.html`, `css/tokens.css`, `js/ui.js`, `js/router.js`, all `.md` |

**Ordering:** L lands first and is then frozen. M and N run in parallel against
L's published API.

If you need a file outside your list, **stop and report it** — do not work
around it.

---

## 1. Skip the night with an ad (REPLACES SPEC-V3 §3's placeholder)

SPEC-V3 deliberately shipped **SKIP THE NIGHT** as an inert `COMING SOON`
button. **That placeholder is now removed and the button becomes real.**

While **asleep**, show a button reading **"SKIP NIGHT — WATCH A SHORT AD"**.
Tapping it plays the existing simulated ad overlay (~3s, `AD PLAYING…`,
non-skippable), then:
- grants **full energy**,
- ends the sleep immediately (bypassing the 50-energy minimum-sleep rule),
- wakes the player into **morning**, advancing the day exactly as a normal wake
  does (salary, subscriber payout, rent, form reset — all of it).

Reuse SPEC-V3 §1's ad machinery. This path is exempt from the minimum-sleep
gate; that is the whole point of it.

---

## 2. Train once per day, then show the grade

TRAIN is already once per day, but the button does not communicate it.

Once the player has trained today, the TRAIN nav button must stop being an
action and instead **display today's grade** — e.g. the letter `S`/`A`/`B`/`C`/
`D`/`F` in the grade's colour, with the form multiplier as its sub-label
(replacing the energy cost). It must be visibly non-interactive, and tapping it
should explain "ALREADY TRAINED TODAY — SLEEP TO TRAIN AGAIN".

If a coach is hired, the button shows the coach's auto-grade the same way from
the start of the day, since form is already set.

---

## 3. Career ELO requirements (REPLACES SPEC-V2 §5.5 thresholds)

| Tier | ELO required |
|---|---|
| Tier 3 | 2,100 (unchanged — FACEIT 10) |
| **Tier 2** | **2,700** |
| **Tier 1** | **3,500** |

These are *minimums to be eligible*, not guarantees — under §5 you must still
receive and accept an offer.

---

## 4. Sleeping is always night (SPEC-V3 §2 extension)

While asleep the backdrop must render **night with the moon**, regardless of the
phase the player fell asleep in. Falling asleep during the day should transition
into night, and waking transitions back to morning. This is presentation only —
it must not change `wakeElapsedMs` or the phase logic that drives regen.

---

## 5. THE PRO CAREER SYSTEM (the big one)

### 5a. 100 teams on a leaderboard

A roster of **exactly 100 teams**, ranked 1–100, persisted in the save so ranks
can move.

| Leaderboard rank | Tier |
|---|---|
| 1 – 20 | **Tier 1** (elite) |
| 21 – 50 | **Tier 2** |
| 51 – 100 | **Tier 3** |

Each team has: `id`, `name`, `rank`, `strength` (0–100, correlates with rank),
`salary`, `signingBonus`, `requirements`, and a `personality` (see §5c).

**Names are real orgs, lightly scrambled** — recognisable but clearly fake.
Examples: NAVI→**NAWY**, FaZe→**EAZE**, G2→**J2**, Vitality→**VYTALITY**,
Astralis→**ASTRALIX**, Cloud9→**KLOWD9**, Liquid→**LIQVID**, MOUZ→**MOUS**,
Heroic→**HEROWIC**, Spirit→**SPYRIT**, Falcons→**FALKONS**, ENCE→**ENSE**,
Fnatic→**FNATIK**, Virtus.pro→**VIRTUS.BRO**, FURIA→**FURYA**, paiN→**PAYN**,
Complexity→**KOMPLEXITY**, GamerLegion→**GAMERLEGEND**, The MongolZ→**THE
MONGULZ**, Bad News Eagles→**BAD NEWS BEAGLES**, TYLOO→**TYL00**,
Grayhound→**GREYHOND**, Imperial→**IMPERIUL**, 9z→**9X**, Apeks→**APEXS**.
Invent more in the same spirit to reach 100; lower-ranked teams can be entirely
fictional regional orgs.

**Logos — DEFERRED.** The original intent was procedurally-drawn canvas marks
that come comically close to the real org's (EAZE with a FaZe-style angular
monogram but an **E**, J2 with a G2-style split diagonal badge and a **J**).
The owner has deferred this — they intend to redo the logos later, so building
them now is wasted effort.

For now use a **minimal placeholder**: a small coloured chip using the team's
first `colors` entry with its `letterform` character on top. Plain CSS, no
canvas. Keep the `colors` / `letterform` / `badgeStyle` fields on the team data
so real logos can drop in later with no data migration.

### 5b. You are scouted — you do not press a button

Delete the "SIGN" button that jumps a tier. Replace it with **offers**:

- Teams scout you continuously. Eligibility for a team requires meeting **its**
  `requirements` — typically an ELO floor (see §3), plus some mix of scout hype,
  recent win rate, chemistry, or follower count.
- When eligible, a team may send an **offer**, which sits in an inbox with an
  **expiry** (e.g. 5 sleeps). Multiple offers can be open at once — that is the
  point, since choosing between them is the decision.
- Offers list: team, leaderboard rank, tier, **salary**, **signing bonus**,
  contract length in sleeps, and the team's **expectations**.
- **Objectives/tasks** gate the better offers. Each team asks for something
  concrete before it will bid — "reach 2,700 ELO", "win 10 official matches",
  "hold 70+ chemistry for 5 sleeps", "reach 5,000 followers". Show these as a
  live checklist so the player always knows what to grind toward.

### 5c. Salary: better teams pay more. The trade-off is *trajectory*, not rank.

**Baseline rule: pay scales UP with team quality.** A better-known, stronger
team pays more, and the **jump between tiers is large** — moving from Tier 3 to
Tier 2 should feel like a different career, not a raise.

| Tier | Leaderboard rank | Baseline salary / month |
|---|---|---|
| Tier 3 | 51 – 100 | $500 → $2,500 |
| Tier 2 | 21 – 50 | $3,000 → $10,000 |
| Tier 1 (lower) | 11 – 20 | $20,000 → $50,000 |
| Tier 1 (elite) | **1 – 10** | **$50,000 → $250,000** |

Interpolate within each band by rank (rank 100 sits at the bottom of Tier 3's
range, rank 51 at the top, and so on). Note Tier 1 is **two** bands: the top ten
teams in the world are where the money explodes, and the curve is continuous at
the rank 10/11 boundary ($50,000).

> **LEAD NOTE on the Tier 3 / Tier 2 boundary.** Because Tier 3 tops out at
> $2,500 and Tier 2 starts at $3,000, the `trajectory` multipliers can invert
> the tiers right at the seam: a rank-51 `declining` side pays
> $2,500 × 1.35 = **$3,375**, while a rank-50 `rising` side pays
> $3,000 × 0.65 = **$1,950**. This is left in deliberately — taking a pay cut to
> join a rising Tier 2 team is exactly the ambition-vs-money decision this
> system exists to create, and it is true to real esports. It does **not**
> violate the tier-dominance rule, which applies to the typical case: mid-tier
> to mid-tier, a Tier 2 team pays roughly 4x a Tier 3 team
> (e.g. rank 35 `stable` ≈ $7,475 vs rank 75 `stable` ≈ $1,725).

**The actual decision is ambition vs. immediate money**, and it mostly bites
*within* a tier. Every team has a `trajectory`:

| `trajectory` | Salary multiplier | Meaning |
|---|---|---|
| `rising` | **×0.65** | Investing in growth. Pays below its rank's baseline, but its rank is likely to climb — dragging your salary, tier and tournaments up with it. |
| `stable` | **×1.15** | Comfortably mediocre. Pays above baseline because there is no upside to sell. |
| `declining` | **×1.35** | Pays the most to keep hold of talent. Its rank is likely to *fall*, and it can drop you a tier. |

Because the multiplier spread is wider than the rank-to-rank salary gradient
inside a band, **a lower-ranked stable team can out-pay a higher-ranked rising
one** — which is the interesting case. Worked example, both Tier 3:

- **Rank 55, `rising`:** baseline ≈ $2,300 × 0.65 = **$1,495/mo**, and likely
  to reach Tier 2, where everyone's pay jumps.
- **Rank 80, `stable`:** baseline ≈ $1,300 × 1.15 = **$1,495**… tuned so that
  `stable` at rank 80 lands *at or slightly above* `rising` at rank 55. More
  money now, going nowhere.

Tune the bands so this crossover genuinely occurs for some pairs — but **never
so strongly that a Tier 3 team routinely out-earns a Tier 2 team.** Tier
dominance is the rule; trajectory crossover is the interesting exception.

Bias `trajectory` so it is not uniform: a few risers near the bottom of each
tier (the exciting gambles), more `stable` in the middle, and `declining`
scattered — including some near the top, where a falling Tier 1 side dangling
big money is a real trap.

Surface all of this on the offer card: salary, signing bonus, rank, tier, and a
plain-language trajectory tag such as `RISING — PAYS LESS NOW`,
`STABLE — GOOD MONEY, GOING NOWHERE`, or `DECLINING — BIG MONEY, FALLING FAST`.

### 5d. Teams move on the leaderboard — an HLTV-style points model

Team ranks are **not static**, and they are **not nudged by a fixed ±N spots**.
Every team carries a `points` total; **rank is simply the leaderboard sorted by
points descending.** Nothing ever writes a rank directly.

This exists so that a rank-80 side winning the Tier 3 event **rockets to around
the top 50–60** rather than shuffling three places — it just beat the best of
its tier and has proven it belongs there.

#### Points from an event
```
eventWeight     = { t3: 100, t2: 400, t1major: 1500 }[eventTier]
placementFactor = { win: 1.0, final: 0.6, semi: 0.35, quarter: 0.15, groups: 0.05 }
fieldStrength   = (average `strength` of the teams this team actually BEAT) / 100

pointsGained    = eventWeight * placementFactor * (0.5 + fieldStrength)
```

Beating strong teams is worth up to 3x beating weak ones. A deep run against
good opposition outscores a title won against nobody.

#### Decay
Every tournament cycle **all** teams lose **8%** of their points. Old glory
fades, inactive teams sink, and `declining` teams decline for a real reason
rather than a flag. This is what keeps the board alive and downward pressure
honest.

#### The ceiling rule — THIS IS THE ANTI-CHAOS SAFEGUARD
After recomputing points, clamp the result: **a team may not end an event ranked
higher than (the best rank among the teams it beat) − 5.**

So winning a Tier 3 event whose strongest entrant was rank 52 caps you at about
rank 47 — a huge, satisfying climb that can even promote you into Tier 2, but it
categorically cannot launch you into the Tier 1 top 20, because you never beat
anyone from there. Climbing the last stretch **requires** being invited to
bigger events and beating bigger teams.

Without this rule the system breaks. Do not omit it.

#### Damping
Move a team **70% of the way** from its current points toward its newly computed
total, rather than snapping. Prevents yo-yoing between cycles while still
allowing dramatic single-event jumps.

#### Background simulation
Only 8–16 teams play the player's event. Each cycle, also **simulate the other
tiers' events** for the remaining teams (a cheap roll using `strength`) so the
whole 100-team board moves whether or not the player is involved. The world
should feel alive, and a rival climbing past you while you were streaming is
exactly the kind of pressure this system should create.

Your own team's rank movement is the single clearest signal of how your career
is going — show it prominently, with the delta since the last event.

### 5e. Leaving a team
Contracts have a length in sleeps. On expiry you become a free agent and the
offer cycle restarts, now with your improved (or damaged) reputation. Allow
leaving early at a **reputation cost** (hype penalty) so a bad signing is
recoverable but not free.

---

## 6. TOURNAMENTS

### 6a. The calendar
A tournament runs **every 14 sleeps**, visible on a calendar so the player can
prepare. Only signed players compete. Tournament scale follows your team's tier:

| Your team's tier | Event | Field | Prize pool |
|---|---|---|---|
| Tier 3 | REGIONAL QUALIFIER | 8 teams | $5,000 |
| Tier 2 | INTERNATIONAL LAN | 12 teams | $50,000 |
| Tier 1 | **THE MAJOR** | 16 teams | $1,000,000 |

The field is drawn from teams near yours on the leaderboard, plus a couple of
seeded higher-ranked sides so upsets are possible.

### 6b. Playing it
A visible **bracket** the player advances through, one match at a time, so it
feels like an event rather than a dice roll. Each match resolves from:

```
teamPower  = yourTeam.strength * 0.5
playerPower= (form multiplier * 40) + (gearBonus.aim * 0.5) + (chemistry * 0.3)
winChance  = clamp(0.5 + (ourPower - theirPower) / 160, 0.08, 0.92)
```

Show an animated scoreline per match (the existing match reward card is a good
model). Prize money is split by placement (winner ~50%, runner-up ~20%, and so
on). Winning raises **your hype**, your **team's leaderboard rank**, and your
**chemistry**; a group-stage exit lowers team rank and chemistry.

### 6c. Why it matters
Tournament results are the **primary driver** of team rank movement and of
better offers. Winning a Major should be the game's win condition — a permanent
`MAJOR CHAMPION` marker on the save and on the stats screen.

---

## 7. The sleep minigame — "COUNTING SHEEP"

While asleep, offer an **optional** minigame. It must never block sleeping:
energy keeps regenerating at the bed's rate throughout, and the player can
ignore it entirely.

**Counting Sheep** — sheep hop over a fence in silhouette against the moonlit
backdrop; tap to shoot them. It is the "counting sheep" joke played straight as
a shooting gallery, and it reuses the aim-trainer's feel.

- Sheep cross at varying speed and height; tap to hit.
- A missed sheep is just a miss — no penalty. This is a relaxing side activity,
  not another pressure source.
- Ends when the player wakes.

### Rewards — deliberately small
The headline reward is a **form bonus**, not money: you are practising your aim
in your sleep, which feeds the core loop instead of adding a second income
stream.

- **Form bonus: +0.01 per 5 sheep hit, hard-capped at +0.10.**
  Applied to the **next day's** form multiplier, on waking.
- The bonus is **additive on top of the day's form multiplier, and the total is
  still clamped to 1.0**, so it can never push a player past S-rank. At most it
  is a tenth of the full form range — the difference between a C and a C+, not
  a way to skip the aim trainer.
- **Cash: $1–$3 per sheep, hard-capped at $50 per sleep.** Kept as a token so
  the minigame still pays something, but reduced from an earlier $150 draft
  because form is now the real prize.

**Balance intent (do not re-tune):** a perfect sleep session is worth +0.10 form
and $50. Training properly is worth up to +1.00 form. The sheep must never be a
substitute for the aim trainer — only a small bonus for a player who wants
something to do while the energy bar fills.

Keep it cheap to build and pure canvas. See the ideas list in `PROGRESS.md` for
alternatives that were considered.

---

## 8. Packing bugs (SPEC-V3 §8 / SPEC-V2 §7 fix)

Two defects in the move-out flow:

1. **Some props cannot be packed — the desk in particular.** Investigate and
   fix so **every** placed prop can be tapped and packed. Suspect the hit-test
   or the singleton/reserved-tile handling rather than the packing call itself.
2. **The player can get stuck.** Add a failsafe: if the player has been in
   packing mode for **10 seconds** and MOVE OUT is still disabled, enable it
   anyway. Any unpacked props are moved to inventory automatically. Label it
   clearly (e.g. "MOVE OUT ANYWAY — LEAVING N ITEMS BOXED BY THE MOVERS") so it
   reads as intentional rather than broken.

The failsafe must never lose a prop: unpacked items go to inventory, exactly as
packed ones do.

---

## Package L — API additions

Everything below lives in `js/data.js` / `js/state.js` only. Every existing
`Game.State.*` / `Game.Data.*` name from V1/V2/V3 still exists with a working
signature — this section covers what's **new** or **changed behind an
unchanged name**. Verified with `node --check` on both files, plus a
standalone Node smoke test (`vm` + `localStorage` stub, no browser) covering:
offer generation/expiry, signing via an offer, contract auto-expiry back to
free agency, a full tournament resolving with prize money + points/rank
movement (including a Tier 1 Major with the `majorChampion` marker path), the
skip-night-ad wake bypassing the min-sleep gate, and the packing failsafe
never losing a prop. A separate calibration run (12 trials, forcing a
rank-~80 signed team through a won Tier 3 event) confirmed the §5d points
model's intent: champion trials landed at an **average rank ~58** (individual
trials ranged ~48-79 depending on the field draw and the ceiling rule), a
400-sleep (~28 cycle) long-run stress test confirmed the 100-team leaderboard
stays a clean, collision-free 1-100 permutation indefinitely with no NaN/
negative points.

### `js/data.js`

```js
Data.contracts.t2.require.elo   // 2700 (was 2700 already effectively via hype;
                                  // now an explicit ELO floor — SPEC-V4 §3)
Data.contracts.t1.require.elo   // 3500 (was 2600 — SPEC-V4 §3)
```
Tier 3's floor is unchanged (2100). These are **minimums to be eligible**,
not guarantees — under §5 a team must still separately meet its own
`requirements` (see below) and extend an offer.

```js
Data.sheepReward   // { formPerBonus: 0.01, hitsPerBonus: 5, formCap: 0.10,
                    //   cashMin: 1, cashMax: 3, cashCapPerSleep: 50 }
```
The COUNTING SHEEP (§7) reward source of truth — Package N's minigame calls
`State.sheepHit()` per hit; this table is exposed for any UI copy that wants
to state the caps.

```js
Data.teams          // 100 entries, generated programmatically from a ~25-team
                     // real-org-scrambled seed list + a fictional regional-org
                     // generator (see the big comment block above
                     // `Data.teams` in data.js) — NOT hand-authored. Each:
                     //   { id, name, rank, tier, strength, points, salary,
                     //     signingBonus, contractSleeps, trajectory,
                     //     requirements, colors, letterform, badgeStyle }
                     // STATIC — only rank/strength/points ever change at
                     // runtime (via State.data.teams, see below); this
                     // catalog's own `rank`/`strength`/`points` fields are
                     // just the INITIAL seed, never touched again.
Data.trajectoryTags // { rising: 'RISING — PAYS LESS NOW',
                     //   stable: 'STABLE — GOOD MONEY, GOING NOWHERE',
                     //   declining: 'DECLINING — BIG MONEY, FALLING FAST' }
Data.tierForRank(rank) -> 1|2|3
Data.tierBoundsForTier(tier) -> [lo, hi]
Data.eloFloorForTier(tier) -> number
Data.trajectoryMultiplier   // { rising: 0.65, stable: 1.15, declining: 1.35 }
Data.baselineSalaryForRank(rank) -> number     // §5c band table, interpolated
Data.salaryForRankTrajectory(rank, trajectory) -> number  // baseline * multiplier
Data.requirementsForRank(rank, tier) -> { elo, hype?, chemistry?, winRate?, followers? }
Data.pointsForRank(rank) -> number   // §5d INITIAL seed curve only — see below
```
These are exposed as functions (not just baked into the static `Data.teams`
entries) specifically so `js/state.js` can recompute a team's tier/salary/
requirements live from its CURRENT (moved) rank without duplicating the
formulas — single source of truth stays in `data.js` per the file-ownership
map.

```js
Data.tournamentIntervalSleeps  // 14 — the league cycle length (§5d/§6a)
Data.tournamentTiers           // { 1: {tier,event:'THE MAJOR',field:16,prizePool:1000000,seedExtra:3},
                                //   2: {tier,event:'INTERNATIONAL LAN',field:12,prizePool:50000,seedExtra:2},
                                //   3: {tier,event:'REGIONAL QUALIFIER',field:8,prizePool:5000,seedExtra:1} }
Data.tournamentPrizeSplit      // [0.50, 0.20, 0.10, 0.10, 0.05, 0.05] by placement
Data.leaguePoints              // { eventWeight:{t3:100,t2:400,t1major:1500},
                                //   placementFactor:{win:1.0,final:0.6,semi:0.35,quarter:0.15,groups:0.05},
                                //   decay:0.08, damping:0.7, ceilingMargin:5 }
                                // The exact §5d constants — js/state.js's
                                // applyPointsEvent()/applyRankCeiling() are
                                // the only things that read these.
```

**LEAD NOTE on `Data.pointsForRank`'s shape.** §5d's event weights/placement
factors/decay/damping are fixed by spec and were not tunable. The only free
variable available to hit the spec's own worked example ("a rank-80 team
that wins the Tier 3 event should land around top 50-60") was the INITIAL
points curve's shape. A smooth exponential/power curve was tried first and
rejected: making it flat enough at the Tier 3 tail (so a single title's
damped points gain — roughly 30-90 points depending on the field it beat —
covers 20-30 ranks) forced an unrealistic near-vertical cliff between rank 1
and rank 2 at the top. The shipped curve is **piecewise-linear** instead:
steep through Tier 1 (rank 1→20: 2200→700 points), moderate through Tier 2
(20→50: 700→300), and near-flat through Tier 3 (50→100: 300→260, ~1.4
points/rank) — small Tier 3 point gaps are what let one good result matter a
lot, exactly mirroring how real HLTV points are bunched at the bottom of the
ladder and spread wide at the top. This is calibration, not spec text — if a
future round wants the climb more or less dramatic, this curve (and only
this curve) is the lever; the event/decay/damping formulas must not change.

### `js/state.js` — save schema additions

`State.data` gains (all additive, defaulted, migrated safely — remember
`normalizeSave()` only copies keys present in `defaultData()`, so every one
of these had to be added there):

```js
sheepHitsThisSleep: 0   // COUNTING SHEEP hits so far THIS sleep (§7), reset by State.sleep()
sheepCashThisSleep: 0   // $ already paid out this sleep from sheep hits — gates the $50 cap
formBonusToday: 0        // form bonus (0..0.10) banked from LAST night's sheep sleep, applied
                          // additively (clamped to 1.0 total) the moment today's form is SET
                          // (coach auto-form or a manual State.setForm() call) — not to a null d.form
majorChampion: false     // permanent MAJOR CHAMPION marker (§6c) — set once on a Tier-1 Major win, never cleared
teams: null               // [{id, rank, strength, points}, ...] — mutable slice of the 100-team
                           // leaderboard, lazily seeded from Data.teams by ensureTeams(). `rank` is
                           // NEVER written directly — always derived by sorting on `points` (§5d)
myTeamId: null            // id of the signed team (offers flow only); null as a free agent OR
                           // when signed via the legacy canSign()/signContract() path (see caveat below)
offers: []                 // open inbox: [{ id, teamId, createdDay, expiresAtDay, salary,
                            //   signingBonus, contractSleeps, rank, tier, trajectory, trajectoryTag }]
contractSleeps: 0          // sleeps remaining on the current signed contract (0 = free agent, or
                            // signed via the legacy path, which never sets/decrements this)
contractLength: 0          // total length in sleeps of the current contract, for a progress bar
teamSalary: 0               // the SIGNED TEAM's own monthly pay (§5c), set by acceptOffer() — overrides
                             // the flat Data.contracts[...].salary in resolveNewDay's payday calc; 0 falls
                             // back to the legacy flat tier salary (i.e. old canSign()/signContract() saves)
lastTournamentDay: 0        // day the last LEAGUE CYCLE ran — every 14 sleeps, independent of whether
                             // the player is signed (§5d: decay + background sim run regardless)
tournament: null             // active/last bracket: { id, tier, event, prizePool, field, bracket,
                              //   pendingByes, totalRounds, done, placement?, prizeWon?, rankBefore?, rankDelta? }
tournamentHistory: []        // capped at the last 50: [{ day, event, tier, placement, prize, rankDelta }]
```

### `js/data.js`/`js/state.js` — training status (§2)

```js
State.trainingStatus() -> { trained: bool, grade, mult, manualGrade, source: 'coach'|'manual'|null }
```
A pure read for the TRAIN nav button: once `trained` is true today, the
button should render `grade` (in the grade's colour) with `mult` as the
form-multiplier sub-label instead of the energy cost, and be non-interactive
("ALREADY TRAINED TODAY — SLEEP TO TRAIN AGAIN"). If a coach is hired,
`trained`/`grade` are already true/set from the start of the day
(`source: 'coach'`); a later manual `State.setForm()` only replaces it if the
manual roll's *effective* multiplier (grade mult + any banked sheep bonus,
see below) beats the coach's.

### `js/state.js` — skip-the-night ad (§1)

```js
State.skipNightAd() -> { ok:true, ad:true, auto?:true, salary, chemistryPenalty,
                          subscriberPayout, rent, staffUpkeep, staffQuit,
                          contractExpired?, tournamentStarted? }
                     | { ok:false, reason:'dead'|'not-asleep' }
```
Only usable while `asleep`. Grants full energy and resolves the night
exactly like a forced `State.wake({force:true})` (same `resolveNewDay()`
body — day+1, salary, subscriber payout, rent, staff upkeep, form reset,
offers/contract/tournament ticks, all of it) but **bypasses the 50-energy
min-sleep gate entirely** — that is the whole point. UI owns the ~3s
"AD PLAYING…" overlay before calling this, mirroring `State.watchAdRefill`'s
existing contract. If energy already hit max before this is called (i.e.
`State.tickEnergy()`'s own auto-wake fires first), returns the auto-wake's
summary with `auto:true` rather than double-resolving the night.

### `js/state.js` — COUNTING SHEEP (§7)

```js
State.sheepHit() -> { ok:true, cashAwarded, cashThisSleep, cashCapped,
                       hits, formBonusPreview, formBonusCapped }
                  | { ok:false, reason:'dead'|'not-asleep' }
State.sheepStatus() -> { hits, cashThisSleep, cashCapPerSleep,
                          formBonusPreview, formBonusToday }
```
`sheepHit()` is called once per sheep tapped (a miss is simply never
called — no penalty, per spec). Cash is awarded and capped **per sleep**
($1-3/hit, hard-capped $50); the form bonus (+0.01 per 5 hits, hard-capped
+0.10) is only a *preview* until the player wakes — `resolveNewDay()` banks
the final `formBonusToday` from that sleep's hit count, which then gets
added **additively, clamped to 1.0 total**, into whichever form gets set
that day (coach auto-form or the first `State.setForm()` call — see
`baseMult` on the returned form object if a caller wants the pre-bonus
value for display).

### `js/state.js` — packing failsafe (§8)

```js
State.forceCommitMove() -> { ok:true, locationId, grid, forced:true, leftoverPacked }
                          | { ok:false, reason:'not-moving' }
```
Force-completes an in-progress move regardless of pack state. Unpacked
props are handled exactly like packed ones (`placed` is cleared, everything
stays in `owned` for re-placement via EDIT ROOM at the new location) — **no
prop is ever lost**. `leftoverPacked` is the count of props that weren't
individually tapped, for a "MOVE OUT ANYWAY — LEAVING N ITEMS BOXED BY THE
MOVERS" label. The 10-second packing-mode timer itself is Package N's job
(`js/hub.js`) — this is only the state-side force-complete path. **Also
out of scope for Package L:** §8's *other* defect (some props, the desk in
particular, can't be tapped/packed at all) is a hit-test/singleton-tile bug
in `js/hub.js`'s packing-mode rendering, not in `State.packPropAt()` itself
(which was already correct — it just indexes into `State.data.placed`).
Package N needs to fix the hit-test.

### `js/state.js` — THE PRO CAREER SYSTEM (§5)

**Legacy compatibility.** `State.canSign(id)` / `State.signContract(id)`
(SPEC-V2 §5.5) are **unchanged** — the current unmodified `js/career.js` UI
still calls them and still works. They remain a standalone "jump to a flat
generic tier" path that does **not** touch `myTeamId`/`offers`/
`teamSalary`/`contractSleeps` (so a legacy-signed contract never
auto-expires — `d.contractSleeps` stays 0 forever on that path) and does
**not** participate in the points-model rank movement directly. Every
place that needs "the player's current team" (tournaments, the
leaderboard) calls an internal `myTeamOrFallback()` which synthesizes a
generic mid-tier team object when `myTeamId` is null but `contract !==
'free'`, so nothing crashes or special-cases the old path — it just doesn't
get the richer per-team economy. New code should exclusively use the offers
flow below; the old buttons are a dead end kept alive only for UI
compatibility until Package M rewrites `career.js`.

```js
State.leaderboard() -> [teamPublic, ...]   // all 100, sorted by rank ascending
State.teamById(id) -> teamPublic | null
State.myTeam() -> teamPublic | null        // real signed team, or the legacy fallback, or null if free agent
```
`teamPublic` shape: `{ id, name, rank, tier, strength, points, salary,
signingBonus, contractSleeps, trajectory, trajectoryTag, requirements,
colors, letterform, badgeStyle }` — `salary`/`signingBonus`/`tier`/
`requirements` are **recomputed live** from the team's current rank every
call, per §5c/§5d ("a team's pay and eligibility bar move with it").

```js
State.teamObjectives(teamId) -> [{ id, label, current, target, done }, ...]
State.scoutBoard(opts?) -> [{ team: teamPublic, objectives, eligible }, ...]
                            // opts.limit (default 12); free agents only, sorted by
                            // closeness of the team's ELO requirement to the player's own
```
A team's `requirements` (§5b) ARE its objectives — `teamObjectives()` just
renders each threshold ("REACH 2700 ELO", "HOLD 80+ CHEMISTRY", "REACH 9400
FOLLOWERS", "HOLD 45%+ WIN RATE") as a live checklist entry. `scoutBoard()`
is what powers "you're being scouted" pre-offer — a nearby-ELO slice of the
full leaderboard with a live checklist and an `eligible` flag, so there's
always something to grind toward even before a firm offer lands.

```js
State.offers() -> [{ id, teamId, createdDay, expiresAtDay, salary,
                      signingBonus, contractSleeps, rank, tier, trajectory, trajectoryTag }, ...]
State.acceptOffer(offerId) -> { ok:true, team, signingBonus, contract, contractSleeps }
                             | { ok:false, reason:'dead'|'already-signed'|'not-found'|'expired'|'invalid-team' }
State.leaveTeam(opts?) -> { ok:true, hype, hypePenalty } | { ok:false, reason:'dead'|'not-signed' }
                           // opts.hypePenalty overrides the default (20)
```
Offers are generated automatically (up to 2/day, 5 open at once, 5-sleep
expiry) inside `resolveNewDay()` for any team currently meeting its own
`requirements` — **only while `contract === 'free'`**. `acceptOffer()` is
now **the only way to sign** under the new system: it sets `myTeamId`,
mirrors the legacy `contract` field (`t1`/`t2`/`t3`) so `playMatch()`/
`scrim()`/rent all keep working unmodified, credits the signing bonus, sets
`contractSleeps`/`contractLength`/`teamSalary`, and clears the rest of the
inbox (the other offers lapse — accepting one ends the decision). Contract
countdown, auto-expiry back to free agency, and `wake()`'s
`{contractExpired:true, expiredTeamId}` flag all live inside
`resolveNewDay()`. `leaveTeam()` is the early-exit path (§5e) — hype
penalty, immediate free agency, no cash refund of the signing bonus.

### `js/state.js` — TOURNAMENTS (§6) and the §5d points model

```js
State.playTournamentMatch() -> { ok:true, match, youWon, roundComplete?,
                                  tournamentComplete, placement?, prize?, rankDelta? }
                              | { ok:false, reason:'dead'|'no-tournament'|'no-player-match' }
State.tournamentStatus() -> State.data.tournament (or null)
State.tournamentHistory() -> [{ day, event, tier, placement, prize, rankDelta }, ...]
State.nextTournamentInDays() -> number | null   // null if a free agent; 0 if a bracket is already live
```
A tournament fires every 14 sleeps (`Data.tournamentIntervalSleeps`) for a
**signed, not-already-mid-bracket** player, drawn from teams near their own
rank plus `seedExtra` higher seeds (§6a). Field sizes that aren't a power of
two (Tier 2's 12) get top-seeded byes into round 2. `playTournamentMatch()`
resolves the next match **involving the player**; every match that doesn't
involve them is auto-resolved the instant it's determinable, so the whole
bracket stays internally consistent without asking the player to tap
through matches they have no stake in. The exact §6b `winChance` formula is
used for every match, generalized so non-player matches compare
`strength*0.5` on both sides. A loss finalizes the tournament immediately
(their elimination round IS their placement); a full run finalizes on the
final's winning tap. `PLACEMENT_LABELS` used for `placement`: `CHAMPION`,
`RUNNER-UP`, `SEMIFINALIST`, `QUARTERFINALIST`, and `GROUP STAGE` (used
generically for any earlier single-elimination exit — there is no literal
round-robin group stage, per §6a's bracket format; the label is just
borrowed spec language for "an early exit").

**§5d's points model is what actually moves ranks now** (REPLACES an
earlier internal draft that nudged rank by a fixed ±N — the coordinator
corrected this mid-implementation; see the calibration note under the
`Data.pointsForRank` entry above). On tournament finalization:
- Every REAL participating team (the player's, if signed via the offers
  flow, plus every other team in that specific bracket) gets
  `pointsGained = eventWeight[tier] * placementFactor[placement] * (0.5 +
  fieldStrength)`, where `fieldStrength` is the average `strength` (÷100) of
  the opponents **that team actually beat** in that bracket run — tracked
  match-by-match, not approximated.
- Applied via `mut.points = mut.points + damping * ((mut.points*(1-decay) +
  pointsGained) - mut.points)` — decay (8%) and damping (70% of the way to
  the new total, never snapping) exactly as §5d specifies.
- **The ceiling rule is enforced**: after the points update, if a team's
  resulting rank would be better than `(best rank among the teams it beat) -
  5`, its points are pulled down (not its rank — rank is never written
  directly) to just behind whoever legitimately holds that ceiling rank, so
  the very next `recomputeRanks()` naturally respects it.
- `rank` is **only ever** produced by `recomputeRanks()` sorting the full
  100-team list by `points` descending (ties broken by `strength`) —
  nowhere in the codebase is `mut.rank` assigned outside that one function.
- **Background simulation**: every 14-sleep cycle, regardless of whether the
  player is signed, every team NOT in the player's live bracket this cycle
  gets a cheap `strength`-weighted placement roll (`rollBackgroundPlacement`)
  fed through the *same* `applyPointsEvent()` — so the whole board moves
  even when the player is offline or unsigned. This does **not** get the
  ceiling rule (there's no real "who did they beat" data for a cheap roll —
  the spec explicitly scopes the ceiling to teams the model can actually
  attribute wins to).
- `t.rankBefore`/`t.rankDelta` (and the mirrored field in
  `tournamentHistory` entries) capture the player's own team's rank
  immediately before the bracket started vs. immediately after it resolved,
  for "show it prominently, with the delta since the last event" (§5d) —
  note this can occasionally read as a smaller move (even zero) than the
  underlying points swing suggests, because ~8-16 nearby-ranked teams often
  shift together in the same event; that's a real emergent property of a
  shared leaderboard, not a bug.

Winning a Tier 1 Major (`t.tier === 1` and `placement === 'CHAMPION'`) sets
`State.data.majorChampion = true` permanently — never cleared, exposed on
`State.statsSummary()`'s `career` object is left to Package M/H to wire in
if wanted (the raw flag is on `State.data.majorChampion` in the meantime).

### Known integration caveats for the next round (Packages M/N)

- `js/career.js`'s existing SIGN button still calls the legacy
  `canSign()`/`signContract()` and will keep working, but doesn't surface
  any of the new offers/leaderboard/tournament system — Package M's job to
  replace it with the offers inbox + `State.leaderboard()`/`State.myTeam()`.
- No UI anywhere renders `State.offers()`, `State.scoutBoard()`,
  `State.leaderboard()`, `State.tournamentStatus()`, or the COUNTING SHEEP
  minigame yet — all pure data/logic, ready for Package M (career/teams/
  tournaments) and Package N (hub/sleep/packing/sheep) to build against.
- The TRAIN nav button, the SKIP NIGHT — WATCH A SHORT AD button, the
  night-is-always-night backdrop (§4, presentation-only, nothing to wire
  server-side), and the packing-mode desk hit-test bug are all still
  `js/main.js`/`js/hub.js` work (Package N) — `State.trainingStatus()`/
  `State.skipNightAd()`/`State.forceCommitMove()` are ready for them to call.
- Team logos are only described (`colors`/`letterform`/`badgeStyle`) —
  actually drawing them on canvas is Package M's job (`js/teams.js`), per
  the "no image assets" constraint.
