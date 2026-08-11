# CS2 PRO SIMULATOR — COMPLETE PROJECT HANDOFF

**Purpose of this document.** This is a full context transfer. If the
originating chat is lost, feeding this document to a new session should make it
as knowledgeable about this project as the session that wrote it — the game, its
systems, every balance number, the working method, the owner's decisions and
*why* they were made, the bugs already fixed and the patterns behind them, and
the traps that have repeatedly cost hours.

Read it end to end before touching anything.

**Companion documents in the repo, all still authoritative:**

| File | What it is |
|---|---|
| `SPEC.md` | V1 contract — formulas, APIs, catalogs |
| `SPEC-V2.md` … `SPEC-V11-FIXES.md` | One contract per batch; later always overrides earlier |
| `SPEC-V7-BACKLOG.md` | Design of the three mid-game systems + the owner's decisions with reasoning |
| `PROGRESS.md` | Running trail: what shipped, what was verified, what's outstanding |
| `README.md` | Player-facing description and run instructions |
| `mockups/` | Standalone V1 mockup gallery (**stale** — predates almost everything) |

---

# 1. WHAT THIS IS

A 2D isometric esports-career tycoon, visually inspired by *PewDiePie's Tuber
Simulator*. You start as a Silver-ranked player in your parents' basement and
climb to a Tier 1 Major champion in an esports mansion.

**It runs by opening `index.html` directly.** No build step, no dependencies, no
server, no network calls. All art is drawn procedurally on canvas.

```
start "" "C:\Users\User\Desktop\hujnia\index.html"
```

Target: **mobile portrait, 420x860 logical**, centred in a phone frame on
desktop. Safe-area padding is in place for notched iPhones up to 19.5:9.

---

# 2. HARD CONSTRAINTS — these never change

Every agent brief repeats these. Violating any of them breaks the project's
core premise.

1. **Vanilla JS only.** No ES modules, no `import`/`export`, no bundler, no
   dependencies. Classic `<script>` tags attaching to a global `window.Game`.
2. **Must run from `file://`.** This is why there are no modules — module
   scripts fail on the `file://` protocol.
3. **No external assets.** No images, no fonts, no CDN, no audio files. Art is
   canvas-drawn; music and SFX are synthesised with WebAudio oscillators.
4. **Tokens-only CSS.** Every colour comes from a custom property in
   `css/tokens.css`. **No raw hex** in any other stylesheet. (Canvas drawing
   code in JS may use literal colours — canvas cannot read CSS variables
   directly.)
5. **420x860 portrait.**
6. **`normalizeSave()` only copies keys present in `defaultData()`.** Any new
   persisted field must be added to `defaultData()` or it is **silently dropped
   on load**. *This has bitten the project five separate times.*

---

# 3. FILE MAP

```
index.html          shell — defines DOM ids and script load order (LEAD-OWNED)
css/
  tokens.css        design tokens — the only place raw colour values live
  style.css         core UI: top bar, nav, hub, modals, room chrome
  minigames.css     aim / stream / cases
  teams.css         leaderboard, career, tournaments, shop, sponsors, social, crypto
  title.css         front page, save slots, settings
  stats.css         stats screen + fail-state overlays
  tutorial.css      onboarding overlay
js/
  data.js           ALL static catalogs (very large — never read end to end)
  state.js          save data, economy, every mutation (very large — same)
  ui.js             toasts, number formatting, WebAudio SFX, confetti, modals
  audio.js          procedural background music + volume settings
  iso.js            isometric renderer — shaded cuboids, props, backdrops, camera
  router.js         screen registration/switching
  hub.js            the room: render loop, edit mode, sleep, packing, notifications
  main.js           bootstrap, top bar, bottom nav, energy tick
  title.js          front page, 3 save slots, settings
  tutorial.js       8-step skippable onboarding
  shop.js           single-scroll shop, all sections
  career.js         offers inbox, contracts, reputation, sponsors panel, nav row
  teams.js          100-team leaderboard
  tournaments.js    calendar + bracket
  locations.js      locations, rent, moving minigame
  stats.js          stats screen, debt warning, GAME OVER
  aim.js            aim trainer minigame
  stream.js         stream chat-moderation minigame
  cases.js          case unboxing roulette
  sheep.js          "counting sheep" sleep minigame
  social.js         social media screen
  crypto.js         crypto market screen
```

---

# 4. THE WORKING METHOD — read this before dispatching any agent

The owner's standing instruction: **"you work the brains of the project, sonnet
agents code it for you."** The lead writes specs, decides design, dispatches
agents, and verifies. Agents write code.

## 4.1 Spec-first, always
Every batch gets a `SPEC-Vn.md` written **before** any agent is dispatched. The
spec contains concrete numbers, not vague intent — agents implement what is
written, so ambiguity becomes bugs.

## 4.2 File ownership maps
Each spec opens with a table assigning **every file** to exactly one package.
Packages run in parallel only when their file sets are disjoint.

**This exists because of a real failure.** Early batches split work by *layer*
(data vs UI vs minigames) and froze everything outside each agent's slice — so
any feature crossing a layer left its agent stuck. Splitting by **feature
vertical**, with each package owning every file its feature touches, fixed it.

**The rule given to every agent:** *if you need a file you don't own, stop and
report it — do not work around it.* This has repeatedly produced the project's
best bug reports (see §9).

## 4.3 Incremental writes — the single most important instruction
Multiple agents have lost **entire sessions** by reading specs and planning for
20+ minutes, writing nothing, then hitting a usage limit.

Every brief must say:
- **Make your first file edit within your first 5 tool calls.**
- **Commit each item to disk before starting the next.**
- **Do NOT read `SPEC.md`/older specs or `data.js`/`state.js` end to end** — they
  are huge. Grep instead.
- Order checklists **smallest-first** so a limit banks partial progress.

An agent that writes nothing for 20 minutes is indistinguishable from a hung
one. Check `data.js`/`state.js` mtimes to tell the difference.

## 4.4 Usage limits are frequent — leave a trail
Sessions get cut off constantly. `PROGRESS.md` records, per package, what is
**done** vs **remaining**, so a restart never needs a forensic re-derivation.
When an agent dies, **verify what actually landed by grepping** rather than
trusting its dying message.

## 4.5 Verify, don't trust
Reported-complete is not complete. The lead independently checks with `grep`,
`node --check`, headless Node harnesses, and live browser probes. Several
"working" features were verified broken this way — and one grep match for
"ghost/rotate" turned out to be pre-existing code, nearly causing a real item to
be skipped.

## 4.6 Batch spec corrections
Sending three corrections mid-flight to a running agent contributed to one
stall. Batch changes into a single message where possible.

---

# 5. VERSION HISTORY

## V1 — the original build
Isometric room, aim trainer, stream moderation, case unboxing, career ladder,
shop. Plus a standalone mockup gallery (now stale).

## V2 — economy and structure
Energy costs 0/20/40/20 · solo matches pay **$0** · scrim gated to signed
players · easier early ELO curve · cases auto-sell · odds 65/25/6.5/2.5/1 ·
coaches + moderators · 4 locations with rent + moving minigame · 3 save slots ·
title screen · 8-step tutorial.

## V3 — real-time energy
Day cycle replaced with continuous regen · sleep + beds · day/night cycle ·
stats screen · debt → game over · max-energy upgrades · case price $7 with a
hidden gold split · cases cost energy · **idle income removed and replaced with
subscribers**.

## V4 — the pro career
100-team leaderboard · HLTV-style points model · scouting offers · tournaments ·
counting-sheep sleep minigame · packing failsafe.

## V5 — first playtest pass (31 fixes)
Unique team names · sheep thought bubble · case credit on spin stop · 10s
trainer · room rotation + minimum room · settings button · **cash-flicker fix** ·
"days" not "sleeps" · reputation system · stop-anytime streaming · PRO LEAGUE
display · single-scroll shop · notification dots · tier-locked tournaments ·
fire/snowflake icons · contract extensions · grass ground.

## V6 — second playtest pass (31 fixes)
Viewer cap (first stream **230**, was 500) · integer followers · energy drinks
as a consumable · gradual offers · rent/tournament day separation · regen items ·
**per-rank ELO requirements** · multi-day tournaments · monitor as its own prop ·
multi-tap fix · continuous form multiplier · sleep gating · 6 locations 6x6→11x11
· ground for every location · edit-tray overlay.

## V7 — third playtest pass (10 fixes)
**Sleep deadlock fix** · coach quota display fix · rookie coach retune
(38.8% → 52.8% win rate) · fridges for drink storage · iPhone safe areas ·
pinch/scroll zoom · sleep-block messages · offer-card icons.

## V8 — sponsorships
## V9 — social media
## V10 — crypto market
*(Detailed in §7.)*

## V11 — fourth playtest pass (3 fixes)
- **Rotation extended to every placeable prop.** It had been scoped to a
  whitelist (desk/chair/PC/monitor), so beds and decor silently ignored the
  ROTATE button. `ROTATING_FAMILIES` now covers every family, and `pickProp()`'s
  hit-anchor rotation reads the same list, so art and tap target cannot drift.
  The one genuinely symmetric prop (rug) was wired through anyway rather than
  special-cased, so there is no second whitelist to fall out of sync.
- **Fridge consolidation** — undoing a lead design error. SPEC-V7-FIXES §3 added
  a new `fridge` category for drink storage when `energy_minifridge` /
  `energy_fridge` **already existed** as max-energy items, leaving two competing
  sets of fridges in the shop. The new category is deleted; the existing energy
  fridges now also govern storage (4 and 12 drinks). Capacity comes from
  **placed** fridges and **sums**, consistent with the 4-placed energy cap.
  Legacy saves owning `fridge_mini`/`fridge_full` convert 1:1 and auto-place the
  better one when under the cap, so nothing paid for is lost.
- **Sleep-block copy fix** — the full-energy block told the player to "use SKIP
  NIGHT — WATCH AN AD", which only exists *while asleep*. Now reads "BURN SOME
  ENERGY FIRST (PLAY / TRAIN / STREAM)". All other blocked-action toasts were
  audited for the same class of unreachable advice.
- **Follow-up found during the rotation work, now fixed:** `hub.js`'s
  `isCoreSingleton()` excluded `'bed'` while `state.js`'s
  `SINGLETON_ROOM_CATEGORIES` included it, so **tapping a settled bed did
  nothing** — the owner could never reach the rotate button even after the art
  was fixed. Fixing it also required an exception in `pendingTileValid()`, which
  unconditionally blocked the bed's reserved corner tile and would otherwise
  have made the bed unable to return to its *own* tile.
- **The duplication itself was then closed.** `state.js` now exports
  `State.SINGLETON_ROOM_CATEGORIES` and `hub.js` derives from it (with a
  defensive literal fallback for partial loads). **There is no hardcoded
  singleton list in `hub.js` any more.** This was the fourth instance of §9.1,
  which is why the root cause was removed rather than patched again.

## V12 — tile occupancy & footprints
Two bugs the owner found after V11.

- **Props could be placed inside one another.** The lead assumed this was a V11
  regression from adding `bed` to `isCoreSingleton()`. **It was not** — the
  implementing agent verified that `pendingTileValid()`'s "moving a core
  singleton" branch had **always** returned `true` without checking destination
  occupancy, so moving a chair onto the desk's tile was silently allowed from the
  start. Adding `bed` (a 2-tile prop) merely made the pre-existing hole
  *visible*. **The relaxed branch is now gone entirely** — moving and rotating
  validate through the same `State.canPlaceFootprint()` a fresh placement uses,
  excluding only the item's own slot.
- **Co-tenancy rule:** exactly one group may share a tile — **`desk` + `pc` +
  `monitor`**. A monitor still requires a desk on that tile. No tile may hold two
  props of the same category. Everything else is exclusive in both directions.
- **General footprint system**, not a bed special-case: `footprint: {w, d}` on
  the item definition, default 1x1. **Rotation reorients it** — a 2x1 bed spans
  `(x,y)`+`(x+1,y)` at 0°/180° and `(x,y)`+`(x,y+1)` at 90°/270°. Every tile
  must be in-bounds and free. Honoured in placement validation, the ghost
  preview highlight, `pickProp()` hit-testing, and the packing flow.
- **Rotating in place re-validates** and refuses with "NEEDS TWO FREE TILES"
  when boxed in, rather than silently doing nothing.
- **Single source of truth**, per §9.1: all occupancy logic lives in `state.js`
  and is exported (`footprintTiles`, `SHARED_TILE_CATEGORIES`,
  `categoriesMayShareTile`, `canPlaceFootprint`, `canMoveItem`, `moveItem`,
  `itemFootprint`). `hub.js` and `iso.js` derive; neither re-implements it.
- **Save migration** (`migrateBedFootprints()`): tries relocating the bed, then
  the conflicting prop, and only as a last resort drops the conflict from
  `placed` — **never from `owned`**. A player's item is never deleted.
- Test: `test-v12-footprints.js` at the repo root, 16/16 passing (Node, no DOM).

**Known cosmetic gap:** during the move-out packing minigame, the packed-box
icon draws over only a footprint prop's first tile. Purely visual — `packPropAt`
and picking are index-based and footprint-safe.

---

# 6. CORE SYSTEMS AND NUMBERS

## 6.1 Energy and time
- `energyMax` **100** base, +15/+25/+30/+30 from placed energy items, hard cap
  **200**. **Only 4 placed items count.**
- Regen: **1.0/sec** awake in daytime, **0/sec at night**, bed `sleepRate` while
  asleep. Wall-clock driven, reconciled on load.
- Regen items (`regen` category) add up to **+2.0/sec**, daytime only.
- **A day is 90 seconds**: DAY 0–75s, SUNSET 75–90s, NIGHT 90s+. Night persists
  until you sleep.
- Costs: **PLAY 20 · TRAIN 5 · STREAM 40 · SCRIM 20 · CASE 1** (0 on stream).

## 6.2 Sleep
- **Cannot sleep above 50% energy.** Cannot sleep with no bed.
- Minimum sleep scales with tiredness: ~10s at 50% energy, ~30s at 0%, never
  below 10s.
- Beds: floor mattress 2.5/s → cryo pod 10/s (5 tiers).
- Sheep minigame: **+0.01 form per 5 hits, cap +0.10**; **$1–3 per sheep, cap
  $50**; each hit also adds 1% of max energy.
- **SKIP NIGHT — WATCH AN AD** grants full energy and wakes into morning,
  bypassing the minimum-sleep gate. Only available *while asleep*.

## 6.3 Income — where money comes from
1. **Streaming** (primary)
2. **Case pulls** (variance)
3. **Team salary** (daily, salary/30)
4. **Official team matches** (prize money)
5. **Subscribers** — 8% of stream follower gain converts; **$2.50 each every 7
   days**, paid **before** rent
6. **Sponsors** — weekly, contingent on the obligation
7. **Social ad revenue** — $0.015/follower/week

**Solo matchmaking pays $0.** This is deliberate: ranking up costs time and
earns nothing directly.

## 6.4 Streaming
- Viewer cap: `230 × (1 + streams/25)^1.6 × (1 + followers/8000)^0.8 × tierFactor`
  (free 1.0 / T3 1.5 / T2 3.0 / T1 6.0). A first-ever stream caps at **exactly
  230**.
- Minimum 10 seconds, then stoppable any time. Cash accrues per second.
- Viewers ramp, plateau, then **drift slightly down**. A rare case pull spikes
  them over **3–5 seconds**, not instantly.
- Chat difficulty scales with viewers: ~30 viewers is calm, 300+ needs a
  moderator.

## 6.5 Cases
- **$7.00**, 1 energy off-stream, **0 on-stream**.
- Odds **65 / 25 / 6.5 / 2.5 / 1**.
- Values: blue $0.40–2.40 · purple $3–7.40 · pink $12–28 · red $40–100 · **gold
  is a hidden two-tier roll** (2/3 → $90–150, 1/3 → $250–500), displayed as `?`.
- EV **$7.31** vs $7.00 cost = **+4.4%**, near break-even by design.
- **Money is credited only when the wheel stops.**

## 6.6 Career, teams, tournaments
- **100 teams**, rank 1–100. Tier 1 = 1–20, Tier 2 = 21–50, Tier 3 = 51–100.
- Names are scrambled real orgs (NAWY, EAZE, J2, VYTALITY…) plus ~75
  hand-authored. **No word repeats anywhere in the roster** — asserted in code.
- **ELO requirements scale with team rank**, rounded to hundreds: T3
  2,100→2,500 · T2 3,200→4,000 · T1 5,000→7,000.
- **Salary**: T3 $500–2,500 · T2 $3,000–10,000 · T1 lower (11–20) $20k–50k · T1
  elite (1–10) **$50k–250k**.
- **Trajectory** multiplies salary: `rising` ×0.65, `stable` ×1.15, `declining`
  ×1.35. A declining team pays most and will drop you a tier.
- Offers arrive **one at a time over days**, max **3 open**.
- Contracts **8–16 days**; on expiry the team offers a better extension.
- **HLTV points model**: rank derives from sorted points, never written
  directly. Ceiling rule — a team cannot end an event ranked higher than *(best
  rank it beat) − 5*. 8% decay per cycle, 70% damping.
- Tournaments every **7 days**, **tier-locked**, **one match per day**. Win →
  next match tomorrow; lose → out, 7 days to the next.
- Scorelines are legal CS2: 13 in regulation (loser 0–11), or 12–12 → overtime
  to 16.
- Tournament matches move ELO **3×** a regular match.

## 6.7 Reputation
Signed **−100 … 0 … +100**. Win a tournament +6 (Major +18) · complete a
contract +15 · leave early −25 · miss a scrim quota −3 · kicked −40 · drop a
sponsor −10.

Bands gate **offers**: below 0 Tier 1 stops scouting; at −40 or worse only Tier
3 will offer.

## 6.8 Coaches, moderators, scrims
- **3 coaches** (the level-4 was deleted — the gap to level 3 was negligible):
  ROOKIE **0.35** auto-form, ANALYST 0.45, VETERAN IGL 0.70.
- Scrim behaviour: L1 **warns** at bedtime · L2 **gradually fills** the quota
  across the day (full by nightfall) · L3 **auto-satisfies** it.
- Moderators: TRIAL $2,000 · VETERAN $8,000 · HEAD $40,000 · AUTOMOD $150,000,
  auto-banning 35/60/85/97% of toxic chat.
- Scrims give **2–4 chemistry**. **3 cumulative misses per contract → kicked.**
- Win chance: `0.30 + 0.65 × form + …`. Rookie-coached with no other bonuses =
  **52.8%** — a coach must never leave you worse off than none.

## 6.9 Room and locations
- **6 locations**, each one tile larger: 6x6 basement (free) → 7x7 city
  ($3.5k/$350) → 8x8 beach ($25k/$1.8k) → 9x9 mansion ($150k/$9k) → 10x10
  penthouse ($600k/$30k) → 11x11 island ($3M/$120k). Stream multiplier 1.0 →
  4.0.
- **Room expansion was deleted** — grid comes only from location.
- **Rent every 7 days**, on a **random per-save day offset** so it never
  coincides with tournaments.
- **Minimum room**: bed + desk + chair + PC + monitor. While incomplete,
  PLAY/TRAIN/STREAM/CASES/CAREER are blocked; shop, editing and sleeping stay
  open so it is recoverable.
- A **monitor may only be placed on a desk tile**.
- Editing: drag → ghost preview → **↻ ROTATE / ✓ PLACE**. Singleton categories
  keep ≥1 placed; surplus is always removable.
- Debt: rent may push cash negative. First time warns; **second time ends the
  career** and the save becomes view-only.

---

# 7. THE THREE MID-GAME SYSTEMS

These exist because the mid-game had collapsed into *wake → scrim → sleep*. The
diagnosis was **not enough activities → wrong**; it was **no decisions**.

## 7.1 Sponsorships (V8)
- Up to **3 held**, each with **exactly one** obligation, refreshed weekly:
  stream on N days · stream N minutes · win N officials · **post N pieces of
  content** (added in V9).
- Offers arrive gradually, on a track separate from team offers.
- **Paid weekly on the subscriber-payout tick.** $30 → $750/week, scaling with
  followers/subscribers/rank.
- **Payout is contingent on meeting the obligation** — a missed week pays **$0**,
  not a warning plus a paycheck. This is what makes skipping the sponsor for a
  scrim a real trade-off.
- Warn on first miss → **two consecutive misses drops them**, −10 reputation.

**The design's whole point:** the coach wants scrims, the sponsor wants stream
time, and daily energy cannot serve both.

## 7.2 Social media (V9)
- **3 platforms**, unlocked by *total* social followers: CLIPS (start, 12
  energy) · LONGFORM (2,000, 25 energy) · MICROBLOG (10,000, 6 energy).
- **Posts are an investment**: followers arrive spread over **~3 days**, so
  skipping a day costs you later. Burst-posting is worse than consistency.
- **~4% virality** at 8–15×.
- Ad revenue **$0.015/follower/week** on the subscriber tick.
- Social followers feed the stream viewer cap at **half weight** and improve
  subscriber conversion (capped +30%).
- **3 managers**: INTERN $2.5k/$80 a day/2 posts a week/60% quality · CONTENT
  EDITOR $12k/$300/4/80% · CREATIVE DIRECTOR $50k/$1.2k/7/100%. Their auto-posts
  **cost the player no energy** — that is what is being bought.

**Energy budget, checked not assumed:** scrim + stream + CLIPS = **72/100**;
with LONGFORM = **85/100**. Both fit, with real pressure. If it ever proves too
tight, the owner's standing instruction is **raise the energy ceiling, not cut
the obligations.**

## 7.3 Crypto market (V10)
- **4 coins**: BITCOYN ±2%/$40k · ETHERIUM ±5%/$2.5k · SOLANO ±10%/$150 ·
  DOGEBORK ±22%/$0.12.
- **Spot only. NO LEVERAGE** — owner's explicit decision reversing an earlier
  10× proposal, because leverage plus readable headlines is trivially
  exploitable (read one headline, go all-in, print money).
- Random walk with mild mean reversion, floor/ceiling clamps. **0.5% fee**, per-
  coin cost basis and unrealised P/L.
- **News is the heart of it.** Headlines name a coin and telegraph a direction,
  with four properties that keep it a skill test rather than a slot machine:
  **~68% reliability** (measured 69.3%), **hidden magnitude**, **~15%
  fake-outs** (measured 15.3%), and **resolution staggered over 2–4 days** so
  the player must also decide *when to exit*.
- Ticks are **wall-clock paced and catch-up based**, decoupled from the career
  day (which only advances on sleep), so the market keeps moving.
- **Deliberately orthogonal**: costs no energy, gates nothing, touches no other
  system. This is why it was scheduled last.

---

# 8. THE OWNER'S DECISIONS — do not silently reverse these

Each of these was decided explicitly, sometimes reversing an earlier proposal.
The reasoning is recorded so a future session doesn't "improve" them back.

| Decision | Reasoning |
|---|---|
| **Better teams pay MORE** | The lead initially wrote the inverse as a global rule. Wrong. Pay scales up with team quality; the trade-off is **trajectory**, and it mostly bites *within* a tier. |
| **T3 $500–2,500 / T2 $3k–10k / T1 $20k–50k / top-10 $50k–250k** | Owner-set. Tier 1 is deliberately two bands — the top ten is where money explodes. |
| **No leverage in crypto** | Leverage + readable news = one-shot exploit. |
| **Case price $7** | EV was +83% at $5. Now +4.4%. Note the four common tiers alone are worth $5.26, so ~$5.30 is the price floor regardless of gold. |
| **Sheep pay form, not just cash** | Feeds the core loop instead of adding a second income stream. Capped at +0.10 so it can never replace the aim trainer (+1.00). |
| **3 concurrent sponsors** | Affordable because by then the player has max-energy items, drinks and the ad refill. If too tight, **raise the ceiling, don't cut sponsors.** |
| **Posts pay off over days** | Makes consistency matter rather than burst-posting. |
| **Team logos deferred** | Owner intends to redo them. Currently a coloured chip with the team's letter. `colors`/`letterform`/`badgeStyle` are retained on the data so real logos drop in with no migration. |
| **Social media before crypto** | Lead's call, delegated by the owner: sponsorships are incomplete without social media's content obligation, and both compete for the same energy so they should be balanced together. Crypto is orthogonal and safest last. |
| **One set of fridges** | The lead wrongly created a second `fridge` category when max-energy fridges already existed. Undone in V11. |

---

# 9. BUG PATTERNS THAT KEEP RECURRING

These are the project's real lessons. Check for them first.

## 9.1 Two sources of truth for one rule — **the most expensive pattern**
This has caused a user-visible bug **four separate times**. In each case an
agent verified the authoritative logic, found it correct, reported success, and
the bug persisted — because something *else* held a second, stale copy.

- **Coach scrim quota** (reported **three times** by the owner):
  `effectiveScrimQuota()` was correct and the penalty check used it — but
  `career.js` rendered the **raw `data.scrimsToday` counter** and called
  `scrimQuotaStatus()` zero times. The coach worked; the screen lied.
- **Sleep deadlock**: `canPlayTournamentMatchToday()` existed and was correct;
  `hub.js` simply never called it and used its own weaker test.
- **Rent countdown**: the display recomputed `day % 7` naively while
  `applyRent()` used the offset-aware formula. They agreed only when the random
  offset happened to be 0.
- **Bed singleton**: `state.js` listed `bed` in `SINGLETON_ROOM_CATEGORIES`
  (private, unexported), while `hub.js` kept **two hardcoded mirrors** that
  omitted it — so tapping a settled bed silently did nothing and rotation was
  unreachable.

**Rules:**
1. When a fix is reported working but the player still sees it broken, **check
   the consumer, not the source.**
2. When two places need the same rule, **export it and derive** — never mirror.
   Every mirror in this codebase has eventually drifted.

## 9.2 Rules written a batch apart that combine into a trap
V5 said "block sleep while a tournament is pending" (pending = bracket
unfinished). V6 made tournaments one-match-per-day where the next match unlocks
*after sleeping*. Together: **unwinnable deadlock**. Neither rule was wrong
alone.

**Rule: when adding a gate, check every other gate that touches the same
action.**

## 9.3 Display and logic computing the same thing separately
The rent countdown used a naive `day % 7` while the charging logic used the
offset-aware formula. They agreed only when the offset was 0. Fixed by extracting
one shared helper. **Verified across all 7 offsets × 30 days = 210 combinations.**

## 9.4 Tests that pass by bypassing the broken integration
Sponsor `stream_minutes` obligations tested green because the smoke test passed
`durationMs` directly — while `stream.js` never passed it at all, so the
obligation was permanently stuck at 0 in the real game.

## 9.5 Moving/replaced elements under an active touch
The multi-tap bug had **two** causes: the ghost PLACE button's `style.left/top`
was rewritten every render frame, and TRAIN rebuilt its `innerHTML` on every
refresh (which runs off a 1s tick). Both remove the node the touch is tracking,
so `click` never fires. **Never fix this with a retry or debounce.**

## 9.6 Silent no-ops
A tap that does nothing reads as broken. Rotation ignoring beds/decor, and
`SLEEP` doing nothing above 50% energy, were both reported as bugs.

## 9.7 Impossible advice in error messages
The full-energy sleep block told the player to "use SKIP NIGHT — WATCH AN AD",
which only exists *while asleep*. Audit messages for remedies the player cannot
reach from their current state.

## 9.8 Save fields dropped on load
`normalizeSave()` only copies keys in `defaultData()`. `tutorialDone` was lost
this way. **Five occurrences.**

---

# 10. VERIFICATION TOOLKIT

- **Syntax:** `for f in js/*.js; do node --check "$f"; done`
- **Raw hex check:** `grep -cE '#[0-9a-fA-F]{3,8}\b' css/*.css` (expect 0 outside
  `tokens.css`)
- **Headless harness:** load the real `data.js`/`state.js` in a Node `vm` with a
  `localStorage` shim — the most reliable way to test economy rules.
- **Browser:** a static server on `http://localhost:8123` (a small `serve.js`
  lives in the session scratchpad). **Do not test via `file://` in the browser
  tool** — it renders a static snapshot without executing JS.
- **Critical browser gotcha:** `requestAnimationFrame` is throttled to **0fps in
  a backgrounded tab**. This once produced a completely false "stream chat is too
  sparse" diagnosis. **Foreground the tab before judging anything timing-based.**
- The shared browser `localStorage` accumulates stray saves from concurrent
  agents. **Always create a fresh save when verifying.**

---

# 11. OUTSTANDING WORK

## Tech debt
- **`career.js` wraps `State.wake`/`endDay`/`skipNightAd`/`tickEnergy`** to catch
  tier changes for the promotion banner. Done because the wake button lives in
  `hub.js`, which belonged to another package at the time. Both files are free
  now — **this belongs in `hub.js`.** Same monkey-patch shape that was correctly
  cleaned out of the audio module in V2.

## Known gaps
- `mockups/` reflects the **V1** design and is badly stale.
- Team logos are placeholder chips (deferred by the owner).
- Tournaments resolve as a bracket of single rolls; there is no round-by-round
  simulation of individual maps.
- Real notch hardware and true multi-touch pinch were never tested on a device —
  only simulated via CSS variables and synthetic `PointerEvent`s.
- Audio has never been verified **by ear** (no audio hardware in the dev
  environment). The gain math and wiring are correct.

## Ideas proposed and NOT built
From the mid-game discussion: auto-scrim assistant coach, VOD editor/clip
channel, rival/nemesis system, burnout mechanic, bootcamps, manager/agent taking
a cut, energy-drink consumables beyond the current ones, case-opening bot.

The **rival system** and **burnout** were the two the lead rated highest for
cost-to-impact: a rival is cheap drama per line of code, and burnout makes
"wake, scrim, sleep" actively bad play rather than merely dull.

---

# 12. HOW TO PICK UP FROM HERE

1. Read `PROGRESS.md` for the live state of the current batch.
2. Read the most recent `SPEC-V*.md` for what was last contracted.
3. If a batch was interrupted, **verify by grepping what actually landed** — do
   not trust an agent's dying message.
4. For new work: write a spec with concrete numbers, assign a file-ownership
   map, dispatch Sonnet agents with the incremental-write instructions from §4.3,
   then verify independently.
5. The owner playtests between batches and returns with numbered lists. Treat
   each list as a spec input, decide the ambiguous calls yourself, and **state
   the decisions you made** so they can be corrected.
