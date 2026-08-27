# SPEC-V23 — QUESTS, THE EMAIL APP, AND SCOUT INTEREST

> Owner-directed, 2026-08-27. Fixes **act one** — the 0 → 2,100 ELO stretch.
>
> Read `HANDOFF-V2.md` first (the rules, the constraints, the traps), then
> `TASKS-REMAINING.md` §V23 (the measured diagnosis this spec answers).
>
> This spec overrides nothing. It is purely additive.

---

## 0. WHY — THE MEASURED PROBLEM

Simulated through the real `State.playMatch()`, all energy on PLAY:

| Daily aim grade | Win rate | Days to 2,100 | Matches |
|---|---|---|---|
| never trains | 36.7% | 331 | 1,655 |
| C-grade (0.35) | 57.5% | 24 | 120 |
| B-grade (0.60) | 81.8% | 11 | 55 |
| perfect S (1.00) | 94.3% | 7 | 35 |

**Length is not the problem.** Emptiness is:

1. There are exactly **three ELO gates in the whole codebase** and all three are
   contract requirements (2100/2700/3500). Nine rank names change colour and
   that is the entire reward structure of act one.
2. Act one pays **nothing in any currency** — solo matches pay `$0`,
   `Data.hype.matchWin` is `0`, and `applyReputationChange` only fires when
   signed. A pre-2100 win moves exactly one number.
3. `earlyMult` decays to 1.0 at 1,400 (`js/state.js:3401`), so the climb gets
   measurably stingier at its midpoint: 0→1,400 is 35 matches, 1,400→2,100 is
   another 43 for half the distance.

This spec adds a second axis to act one (money + events) and makes the wall
visible while you walk toward it.

---

## 1. THE LOAD-BEARING RULE — READ BEFORE WRITING ANY CODE

`js/matchgames.js` may **never** decide whether a match is won. `playMatch()`
rolls the result *before* the overlay opens. That is deliberate and stays.

**This spec does the exact opposite, on purpose.** A quest is opt-in side
content off the critical path, so its minigame **is** the decider:

- `State.acceptInvite()` **must not** pre-roll a result.
- `State.resolveInvite(id, won)` is called by the minigame's completion
  callback with what the player actually achieved.

Do **not** "fix" this to match `playMatch()`'s ordering. It is the entire point
of the feature: quests are the first place in the game where mechanical skill
pays out directly. A comment saying so goes at both call sites.

**Corollary:** because the minigame decides the outcome, difficulty is the only
brake on the reward. The owner has ruled that **quests cost no energy** — see
§4.3 for what carries the stakes instead.

---

## 2. FILE OWNERSHIP MAP

Disjoint, per the dispatch pattern in `HANDOFF-V2.md` §3.

| # | File | Owner | Scope |
|---|---|---|---|
| **Q** | `js/data.js`, `js/state.js` | agent Q | catalog, tuning, save keys, all rules |
| **E** | `js/email.js` *(new)*, `css/email.css` *(new)* | agent E | the inbox screen |
| **C** | `js/clutch.js` *(new)* | agent C | THE CLUTCH minigame |
| **P** | `js/phone.js` | agent P | the new app tile |
| — | `index.html`, stub files | **lead, pre-wired** | so no two agents contend |
| — | `test-v23-quests.js` *(new)* | lead | the suite |

**Agents E and C are design packages** and the owner's standing rule applies
without exception: **they must invoke the `/impeccable` skill BY NAME.**
Embedding craft rules in the brief is not sufficient.

Model policy: Sonnet 5 on **high** for Q and C; Opus 5 on **low** for E.
Order every checklist **smallest-item-first**.

---

## 3. THE EMAIL APP

### 3.1 Placement

A new phone tile routing to a real `G.Router` screen, exactly as SPONSORS /
SOCIAL / CRYPTO do. **Unlocked from day one** — this *is* the act-one content,
so gating it defeats the purpose.

`js/phone.js` needs an entry in **all four** maps or the tile is unreachable —
the same class of bug as the missing shop `CATEGORY_ORDER` tab
(`HANDOFF-V2.md` §5.3):

- `APP_ICON.email` — an **authored SVG** envelope. Not `✉`. That exact glyph
  was already removed from `career.js` once (ART-DIRECTION §2.5). House style:
  24x24 viewBox, 2px stroke, `currentColor`, `aria-hidden="true"`.
- `APP_COLOR.email` — a literal, written as the inline `--tile-color` custom
  property the existing tiles already use. `css/phone.css` stays zero-hex.
- `APP_ORDER` — insert `'email'` **first**. It is the most time-sensitive tile.
- `APP_ROUTE.email = 'email'`.

`index.html` gains `<section class="screen" id="screen-email">`, the
`css/email.css` link, and `<script src="js/email.js">` — **pre-wired by the
lead** before dispatch.

### 3.2 The inbox

Two views in one screen:

**List.** Newest first. Each row: sender, subject, an unread dot, and a
**days-left countdown** on anything still open. Resolved mail (won / lost /
expired) stays in the list, visibly settled, so the player can read their own
history. Cap the stored list at 30 and drop the oldest resolved first.

**Detail.** Sender, subject, body, and — for an open invite — the reward line
and **ACCEPT / DECLINE**. Accepting opens THE CLUTCH immediately.

The phone's existing `notifCount` machinery drives the red dot; feed it
`State.unreadEmailCount()`. Follow `extraApps()` in `js/phone.js` for the shape.

### 3.3 Senders

Reuse the existing 100-team roster and its regional name generation
(`Data.teams`). Do not author a second name list — that is the second-copy
pattern that has caused four user-visible bugs (`HANDOFF-V2.md` §5.4).

---

## 4. INVITES

### 4.1 Catalog (`js/data.js`)

```js
Data.questInvites = [
  { id: 'cafe',   name: 'INTERNET CAFÉ 5v5',  eloMin: 0,    purse: 150,  winElo: 100, loseElo: -30,  loseCash: 0,   enemies: 2, exposeMs: 900 },
  { id: 'lan',    name: 'LOCAL LAN',           eloMin: 600,  purse: 400,  winElo: 160, loseElo: -50,  loseCash: 40,  enemies: 3, exposeMs: 780 },
  { id: 'region', name: 'REGIONAL SHOWMATCH',  eloMin: 1200, purse: 900,  winElo: 230, loseElo: -75,  loseCash: 100, enemies: 4, exposeMs: 650 },
  { id: 'invit',  name: 'INVITATIONAL',        eloMin: 1800, purse: 2000, winElo: 300, loseElo: -100, loseCash: 250, enemies: 5, exposeMs: 520 }
];
Data.questInviteIntervalDays = [3, 5];   // inclusive roll at END DAY
Data.questInviteExpiryDays   = 3;
Data.questInviteMaxOpen      = 2;        // never more than 2 live invites at once
```

**Where the purse numbers come from.** Starter items are $30–220, the pro band
$600–3,000, the elite OLED $20,000, and the Regional Qualifier pool is $5,000
(`Data.tournamentTiers[3]`). So a LAN buys a pro-band item over two or three
wins, and every purse stays below the real tournament ladder so that remains
the bigger prize. **These are the owner's numbers to tune; they live in
`data.js` precisely so tuning never touches logic.**

**The ELO is 100–300 by tier (owner-set, 2026-08-27).** An earlier draft had
30–90, which was pure flavour; at 100–300 a quest is worth **6 to 17 solo
matches** and becomes a real reward.

**Measured effect on the climb** — median days to 2,100 over 21 simulated runs,
driving the real `playMatch()` at the §4.2 cadence:

| daily aim grade | no quests | quests won 70% | quests won 90% |
|---|---|---|---|
| C-grade (0.35) | 23 | **17** | **15** |
| B-grade (0.60) | 12 | **11** | **10** |
| perfect S (1.00) | 7 | **7** | **6** |

**Read that table before retuning anything.** Quests help the *struggling*
player substantially (23 → 15–17 days) and barely move a good one (7 → 6–7).
That is because a B-grade player already earns ~90 ELO/day from matches, so
+160 every four days is a modest top-up, while a C-grade player earns far less
and the same invite is proportionally large. This is a **catch-up and variety
mechanism, not a shortcut for the already-good** — which is the right shape,
but it means quests alone do NOT fix the climb for a strong player. The
*content* is what fixes act one for them; the ELO is a bonus.

Two consequences to hold on to:

- **`loseElo` has to scale with it.** At −10 against a +100 win, failure was
  free and the correct play was to spam every invite. It is set to roughly a
  third of the win, so a botched LAN genuinely costs you.
- **The purse is no longer the only reward**, so the §4.3 note about ELO being
  near-flavour no longer applies. Both currencies matter now.

### 4.2 Cadence

Rolled at **END DAY**, matching the tournament rhythm (4–7 days):

- If `d.day - d.lastInviteDay >= randInt(3, 5)` and open invites <
  `questInviteMaxOpen`, generate one.
- Pick the **highest-tier invite whose `eloMin` the player meets**, so invites
  track the player's climb rather than spamming café games at 1,800 ELO.
- Expires `questInviteExpiryDays` after arrival. Expiry is evaluated at END DAY
  and marks state `'expired'` — it never silently deletes.

### 4.3 What carries the stakes

The owner has ruled quests cost **no energy**. Two things stop that being free
money:

1. **The minigame can be lost.** A lost LAN pays `loseCash` (a travel stipend,
   not a purse) and costs `loseElo`.
2. **The ELO penalty is the real cost of failure** — and with no energy price,
   it is the *only* one. Keep it.

Both currencies now matter (§4.1), so a lost LAN costs real progress. The
difficulty of the CLUTCH is therefore the **only** thing standing between the
player and a large reward — see §5.6. Playtest that before tuning anything else.

---

## 5. THE CLUTCH — AWP ON B (`js/clutch.js`)

**Owner-designed, 2026-08-27.** You are the AWPer holding **Dust 2 B site**.
Enemies peek the angles; you quickscope them or you die.

### 5.1 The verb

The three existing games are a reaction **tap**, a continuous **drag**, and
alternating rhythmic **taps**. A fourth sharing one of those reads as a reskin
(`js/matchgames.js` header). THE CLUTCH's verb is a **positional tap** —
*where*, not *when*. You tap a place on the site; your AWP flicks there, scopes,
and fires.

**Flick time is 150–250ms, scaled by distance.** The owner set the band; the
scaling within it is what stops this becoming whack-a-mole. On a touchscreen a
far tap is exactly as fast as a near one, so a flat flick time would make where
your crosshair already sits irrelevant. Scaling means holding an angle is
mechanically real — the single defining CS skill, and one no other minigame
here touches.

```js
var FLICK_MIN_MS = 150;   // a tap essentially on the crosshair
var FLICK_MAX_MS = 250;   // a tap right across the site
```

If you ever find yourself making the flick a constant, that is the bug being
reintroduced.

### 5.2 The bolt cycle IS the punishment

After every shot — **hit or miss** — the AWP cycles its bolt for
`BOLT_MIN_MS`–`BOLT_MAX_MS`, and **no enemy peeks during it**. That single rule
does three jobs at once:

1. It is the owner's requested 1–1.5s breather between peeks.
2. It makes a miss lethal without a separate "misses kill you" rule: whiff, and
   your gun is locked for over a second while somebody is shooting at you.
3. It stops spam-tapping cold — a wasted shot costs you the whole window.

```js
var BOLT_MIN_MS = 1000;
var BOLT_MAX_MS = 1500;
```

**Do not add a separate miss penalty on top of this.** The lock-out already is
the penalty, and doubling it makes the game unplayable rather than tense.

### 5.3 Rules

A LAN is **best of 3 rounds** (matching the game's existing Bo3 convention for
T1/T2 finals). Win 2 rounds to take the purse.

Each round, you hold the site against `enemies` attackers (2–5 by invite tier,
§4.1), one at a time:

1. A **footstep tell** fires `TELL_MS` before the peek, naming roughly which
   angle. You may re-aim during it.
2. The enemy peeks one of the five angles and is exposed for `exposeMs`
   (§4.1). From the moment they are exposed they are **acquiring you**.
3. Tap → flick (`FLICK_MIN/MAX_MS`) → the shot resolves where the crosshair
   lands. On the enemy's hitbox → **kill**, and the bolt cycle starts.
4. Miss, or fail to fire before `exposeMs` elapses → **they kill you**. Damage
   ramps over `DEATH_MS` so it reads as being shot rather than as an instant
   fail, but it is not survivable: the round is lost.
5. All attackers down → round won.

```js
var TELL_MS   = 600;
var DEATH_MS  = 450;   // how long dying takes to READ, not a grace period
var ROUNDS    = 3;     // win 2
var ANGLES    = 5;
```

**One miss loses the round, not the LAN.** That is deliberate and it is what
makes Bo3 do real work: the moment-to-moment is genuinely lethal, exactly as
the owner asked, while the match around it stays forgiving enough to be worth
attempting.

### 5.4 Timing

**Wall-clock (`Date.now()`), never frame-accumulated.** The spray's rounds, the
bhop's beat and the master timer all read wall-clock for a reason: a dt
accumulator time-dilates the instant the frame rate drops, and the tell would
drift out of step with the peek it warns about. The flick's *travel* is the one
dt integral, exactly as `bhop`'s distance is.

The tell, the peek and the hitbox all read **one** array of angle definitions.
A second copy is how a tell ends up describing a different angle from the one
that opens.

### 5.5 Art — DUST 2 B SITE, from the defender's eye

Drawn from the owner's reference shots. First-person, reusing the spray game's
camera language (both are "you, looking down your gun") while the verb differs
entirely. All flat rectangles on canvas — no image assets (`HANDOFF-V2.md` §2),
no emoji or glyph icons. Colour literals are correct here for the same reason
they are in `js/iso.js`: canvas cannot read CSS variables.

The five angles, and what each is anchored to:

| Angle | Cover |
|---|---|
| `tunnels` | the upper-B tunnel mouth, left |
| `bdoors` | the B doors archway, centre-left |
| `car` | the beige car at B, centre-right |
| `backplat` | the raised back platform, right |
| `hole` | the low window/hole, far left |

- Sandstone walls in warm ochre, the big painted **B** on the back wall, wooden
  crates, orange/rust barrels, the tarp-covered pallet, doorways as deep shadow.
- The player's AWP in the bottom-right, as `spray` does.
- **The quickscope is the signature moment.** On tap, the scope vignette snaps
  in for exactly the flick duration and snaps out as the shot fires — that
  in-and-out *is* the quickscope read. It must be driven by the same clock as
  the flick, never its own timer.
- HUD: round pips, attackers remaining. Round pips **must not leak the result**
  before it is shown — V22 item 10 was exactly this bug in `tournaments.js`.
- **Every peek gap must be measurably distinct in luminance from the cover
  beside it**, or the angles stop reading as angles. This is the same failure
  the bhop map hit when the roof deck and the outdoor concrete used
  near-identical greys; a test asserts it.
- `sizeCanvas()` measures the **canvas**, not the overlay — see V22d.

### 5.6 The difficulty IS the paywall

Quests cost no energy (§4.3) and now pay 100–300 ELO plus a purse (§4.1). The
CLUTCH's difficulty is therefore the **only** thing between the player and a
large reward. Tune `exposeMs` first and playtest it before touching any number
in `Data.questInvites`.

### 5.7 API

```js
Game.Clutch.run(opts, done)  // opts: {enemies, exposeMs}; done(won:boolean)
Game.Clutch.__probe()        // {open, round, roundsWon, alive, left, aimX, aimY, bolting, flicking}
Game.Clutch.__force(seed)    // deterministic angle sequence, for the suite
```

`__probe` / `__force` mirror `js/matchgames.js` — the suite needs a measurable
handle, and rAF is throttled to ~1fps whenever the Browser pane is not being
composited (`TASKS-REMAINING.md` §V22d), so pump a synthetic clock rather than
waiting for the game to get there.

---

## 6. SCOUT INTEREST (the owner's second pick)

The 100-team ladder, the scouting model and `reputationAllowsTier()` all exist
and are **invisible until 2,100**. Make the wall visible while you walk at it.

**It shares the inbox** — one surface, two senders. That convergence is why the
two features are specced together: building the email app once pays for both.

`Data.scoutStages`, staged on ELO, each firing **one** email the first time it
is crossed (latched, never re-fired):

| Stage | ELO | Beat |
|---|---|---|
| 1 | 800 | a Tier 3 org's analyst starts tracking you |
| 2 | 1,200 | "we're watching your matches" — names a real team from the roster |
| 3 | 1,700 | a trial invite: play a scrim-like LAN against the team itself |
| 4 | 2,100 | the offer — hands off to the **existing** offer flow, unchanged |

Stage 4 must **not** reimplement offers. It links to what `State.offers()`
already produces. Deriving, never mirroring (`HANDOFF-V2.md` §5.4).

`State.scoutStatus()` returns `{interest, stage, label}` where `interest` is a
0..1 progress value derived from ELO against the next stage — a readout, not a
new stored economy.

---

## 7. SAVE SCHEMA — THE §5.1 TRAP

**Every one of these must be added to `defaultData()`** or `normalizeSave()`
silently drops it on load. This has shipped broken **five or more times**.

```js
emails: [],          // newest last; capped at 30, oldest RESOLVED dropped first
emailSeq: 0,         // monotonic id counter
lastInviteDay: 0,    // day the last invite was generated
scoutStage: 0        // highest scout stage already fired (latched)
```

**Do not** add a top-level mirror of anything stored per-email. Per-entry keys
on an array element round-trip automatically — `placed[i]`'s `tint`, `designId`
and `closed` all prove it. A top-level mirror creates the *second-copy* bug
instead. Know which case you are in (`HANDOFF-V2.md` §5.1).

Email entry shape:

```js
{ id, kind: 'invite'|'scout', inviteId, from, subject, body,
  day, read: false, state: 'open'|'accepted'|'won'|'lost'|'expired', expiresDay }
```

---

## 8. STATE API (agent Q)

```js
State.emails()              // newest first, a copy
State.unreadEmailCount()
State.readEmail(id)         // latches read: true
State.acceptInvite(id)      // {ok, invite} — NEVER pre-rolls a result (§1)
State.resolveInvite(id, won)// {ok, cash, elo} — called BY the minigame
State.declineInvite(id)
State.rollDailyEmails()     // called from endDay(): expiry sweep, then generate
State.scoutStatus()         // {interest, stage, label}
```

Refusal reasons, as string constants matching the house pattern:
`UNKNOWN EMAIL`, `EXPIRED`, `ALREADY RESOLVED`, `ELO TOO LOW`, `NOT AN INVITE`.

---

## 9. VERIFICATION — `test-v23-quests.js`

Copy the harness shape from `test-v20-customise.js`. **Save/load assertions
must reload in a fresh VM** or they do not exercise `normalizeSave()`.

Must cover, at minimum:

1. All four new save keys survive a save → fresh-VM reload round trip.
2. An invite expires at exactly `questInviteExpiryDays` and is marked
   `'expired'`, not deleted.
3. Never more than `questInviteMaxOpen` open invites exist.
4. The generated invite is the **highest tier** whose `eloMin` is met.
5. `acceptInvite()` changes **no** cash and **no** ELO — proving §1's ordering.
6. `resolveInvite(id, true)` pays exactly `purse` / `winElo`;
   `resolveInvite(id, false)` pays `loseCash` / `loseElo`.
7. `resolveInvite()` on an already-resolved email refuses.
8. Every `Data.questInvites` entry has a reachable `eloMin` and a positive
   purse — a catalog-integrity guard, matching the shop `CATEGORY_ORDER` one.
9. **`js/phone.js` has an entry in all four maps for every routed app** — the
   generalised version of §3.1's trap, so a future app added without a tile
   fails the suite instead of a playtest.
10. Each scout stage fires exactly once and never re-fires across a reload.
11. Clutch: flick time is **distance-scaled**, not constant — a tap across the
    site resolves measurably later than a tap on the crosshair, and both land
    inside `FLICK_MIN_MS`..`FLICK_MAX_MS`. This is the §5.1 anti-whack-a-mole
    rule, asserted numerically.
12. Clutch: **no enemy peeks during a bolt cycle**, hit or miss, and the cycle
    lasts `BOLT_MIN_MS`..`BOLT_MAX_MS` (§5.2).
13. Clutch: every peek gap's luminance differs from adjacent cover by a stated
    margin (§5.5).
14. Clutch: losing a round does not end the LAN while a 2-of-3 is still
    reachable (§5.3).

Expected counts for the existing suites are unchanged — a change in any of them
is a regression until proven otherwise. Current state, all green:

| suite | count |
|---|---|
| `test-v22-fixes.js` | 96 |
| `test-v21-customise.js` | 18 |
| `test-v20-customise.js` | 38 |
| `test-v12-footprints.js` | 16 |
| `test-v13-rules.js` | 17 |
| `test-v14-phone.js` | 20 |
| `test-v15-banners.js` | 15 |
| `test-v15-tutorials.js` | 26 |
| `test-v16-rooms.js` | 16 |
| `test-v15-rules.js` | 26 *(slow — minutes, not hung)* |

Node is installed but **not on the agent tool-shell PATH**. Prefix every
command:

```bash
$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node test-v23-quests.js
```

---

## 10. OPEN — OWNER'S CALL BEFORE DISPATCH

**Settled 2026-08-27:** ELO rewards 100–300 by tier (§4.1); best-of-3 rounds
(§5.3); no energy cost (§4.3); a bespoke AWP-quickscope CLUTCH on Dust 2 B site
rather than a gauntlet of the existing three (§5).

Still open:

1. **The purse column (§4.1)** — the cash half was never ratified, only the
   ELO. Tune in `data.js`; no logic depends on the values.
2. **`loseElo` at roughly a third of the win (§4.1)** — derived, not
   owner-set. It exists so failure is not free now that wins pay 100–300.
3. **The trial invite at scout stage 3 (§6)** — currently specced as a normal
   CLUTCH against a named team. It could instead be a distinct, harder variant.
