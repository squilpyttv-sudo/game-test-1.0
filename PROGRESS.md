# PROGRESS TRAIL

> **START HERE: `HANDOFF.md`** is a complete context-transfer document — the
> game, every balance number, the working method, the owner's decisions with
> their reasoning, the recurring bug patterns, the verification toolkit, and
> outstanding work. Read it before this file.

## V19 — OWNER FIX LIST — PARTIAL (2 of 3 packages killed by a session limit)

Build INTACT: all JS syntax-clean · zero raw hex outside `tokens.css` ·
suites 16/17/19/15/26/16 all green.

### DONE
- **Corner tile (lead).** Owner: "the bottom corner tile is blocked and says
  the same thing as a tile with an item there would say." **Not a bug — an
  obsolete rule.** SPEC-V3 §3 reserved the bottom-right tile for the bed, from
  when beds were 1x1 with no footprint system. V12 footprints + V13's
  exactly-one-placed / un-stashable bed provide that guarantee twice over, so
  the reservation only cost a permanently dead tile (1/16th of a 4x4 floor)
  and refused with `TILE ALREADY OCCUPIED` **on an empty tile**. Removed;
  verified a cactus now places there once the bed moves off.
  - The test asserting it was **passing for the wrong reason** — on a fresh 4x4
    the bed's own footprint covers that corner, so ordinary occupancy refused
    it regardless of the reservation. Retargeted to test the real behaviour.
- **A — prop art (`js/iso.js`), all four defects.** Fan oscillation removed and
  redrawn; trophy rack legs depth-sorted in rotated space and drawn BEFORE the
  slab (two root causes: draw order AND only 2 legs, both on one edge); chair
  armrest see-through fixed via conditional draw order (the *occlusion* half of
  SPEC-V17 §4's mechanism, which chairs were never put on) — measured
  distinct-colour drops of 25-35 on exactly the two back-facing rotations;
  PC towers were **literally fridge-sized** (`h: 23–33` = 115–165cm against a
  75cm desk) → now `h: 9–13.5` (45–68cm) with all four tiers still distinct;
  desk cable tray was floating 0.4 tiles off the desk body; monitor gained a
  real rear instead of a blank slab.
- **B item 1** — the on-stream case button no longer hardcodes `$7`; reads
  `OPEN A CASE` (`js/stream.js:443`).
- **Item 4 (roulette spoiler) — ALREADY FIXED in V18**, not this batch. The
  winner ring is scoped to `.case-strip-done`, which `js/cases.js:234` adds
  only at `t >= 1`. The V18 comment documents the exact reported symptom. Both
  entry points share that one function. No work needed.

### PARTIAL
- **C — sheep minigame.** Died mid sprite-rebuild ("head reads as a detached
  wedge, hooves sink below the ground line"). **Verified NOT broken:** `hub.js`
  calls 7 `Sheep.*` functions and `sheep.js` still exports all 7, so the API
  contract holds and the sleep loop works. The remaining problem is cosmetic.
- **B item 3** — the GO LIVE button redesign never started.

### STILL QUEUED (owner list)
| # | Item |
|---|---|
| new 2 | Sleep by tapping the bed; **remove the header sleep button** (an intentional replacement of V17/V18 work); tutorial must teach it; bed gains a pulsing yellow outline under 20% energy |
| new 5 | Sheep minigame — finish the remake |
| new 7 | NEON SIGN gets banner-style drawing + the same buff |
| new 8 | Inventory app: show item NAMES above sprites |
| new 9 | `lucky_mousepad` → **FLOOR LED SCREEN**, customisable, decorative only (strip its stat effects) |
| new 10 | GO LIVE button — match the footer keycaps |
| old 2 | Tutorial arrows point nowhere (rent step should aim at the location badge) |
| old 4 | Windows become purchasable items, semi-transparent, react to day/night |
| old 5 | LED lights ignore tile collision; z-sorted behind furniture; glow spills |
| old 6 | LED colour picker (4th Customize button in the move menu) |
| old 7 | Banner/blind painting modal; blinds snap to windows, toggle, +15% sleep regen when ALL covered; banners +5% stream |
| old 8 | Blinds scale with window size (small = 1, large = 2) |

**Note:** old 5–8 are new MECHANICS, not fixes — they need a spec with concrete
numbers before dispatch, unlike the rest of this list.

---

## V18 — HOLD TIMER + 16-BIT UI OVERHAUL (spec: `SPEC-V18-PIXEL-UI.md`)
### PARTIAL — 4 of 5 packages killed by a session limit

Build is INTACT: all JS syntax-clean, zero raw hex outside `tokens.css`, suites
16/16 · 19/19 · 26/26 · 16/16. Lead added every V18 token to `tokens.css`
FIRST, so all five packages coded against one vocabulary with no ordering
dependency — that is why the partial state is still coherent.

**DONE:**
- **E — hold timer ring** (`js/hub.js:74`, `:744`). Canvas-drawn, self-gating,
  hooked into V17's existing 600ms hold timer rather than a second timer.
- **B — modal chrome** (`js/ui.js`, `js/main.js`). `UI.modalChrome()` adds an
  authored-SVG red close disc + docked header tab to **5 modals**. Every X
  routes through the modal's *pre-existing* dismiss function — no second
  teardown path — and `onClose` was proven to still fire on the X path,
  including the chained `tournaments.js → celebrateMajor()` case.
  `playAdOverlay` deliberately has **no X**: its 3s timer is what pays the
  reward out, so an X would be a route that skips the payout.
- **C — `stats.css` (4 markers), `minigames.css` (11)**.
- **D — `tutorial.css` (4)**.

**PARTIAL / NOT STARTED — resume here:**
| File | State |
|---|---|
| `css/style.css` | **partial** (4 markers) — A died mid-way through the core primitives |
| `css/teams.css` | **NOT STARTED** (0 markers) — the biggest stylesheet, 298 selectors: offer/sponsor cards, shop, tournaments, social, crypto |
| `css/title.css` | **partial** (1) — C died here |
| `css/phone.css` | **partial** (1) — D died before the inventory/app grid slots |

**Cross-package note worth keeping:** B's first pass wrapped modal titles in a
NEW `.modal-headtab` element, which double-stacked against the docked tab A had
already built in CSS. B rewrote it to *declare the existing title element* as
the tab and own only the padding the close disc needs. Two packages, one
feature — the fix was to divide the geometry, not duplicate the element.

### QUEUED — owner list, not yet specced or dispatched
1. **Header redesign** — deliberately held: it needs `js/main.js` + `css/style.css`,
   both of which were in flight. Three modules (rank/progression, economy,
   vitals+settings). Removes the Max Views (eye) stat — **the resources modal
   explains that stat and must drop it too**. Sleep button changes from V17's
   round disc to a square purple tactile button.
2. **Tutorial arrows point nowhere** for some steps (e.g. rent) — should aim at
   the location badge that shows rent timing.
3. **PC / monitor / chair rigs render badly** — cases are fridge-sized dark
   boxes; racer chair armrests show *through* the seat back. Needs slim sleek
   rigs + a face-culling pass on chairs, plus delicate monitor/desk work.
4. **Windows become purchasable items** (currently baked into the room and
   always dark). Several sizes/frame styles, semi-transparent, must react to
   day/night.
5. **LED lights ignore tile collision** — shareable with any furniture, green
   footprint over occupied tiles, z-sorted behind the furniture, glow spills
   onto adjacent tiles.
6. **LED colour picker** — a 4th "Customize" button in the move context menu,
   swatch grid, sprite emission + ambient room glow.
7. **Banner/blind painting** — a 4th Customize button opening a pixel paint
   modal; blinds snap to window tiles, toggle open/closed, darken the room,
   +15% sleep regen when ALL windows covered (non-stacking); banners hang
   anywhere, +5% stream views/subs.
8. **Blinds must scale with window size** — small window 1 blind, large 2.

---

## V17 — HUD PURGE, PHONE OS, HOLD-TO-EDIT (spec: `SPEC-V17-HUD-EDIT.md`)
### SUBSTANTIALLY COMPLETE — needs a visual pass

Four packages on disjoint files, run in parallel. **Three of the four were
killed by a session limit**, but the lead established by grepping — not from
their dying messages — that all four had substantially finished. The dying
messages were misleading early snapshots: P3 reported "hub.js is mid-edit and
throwing", and P4 reported "now my first edits", yet the game boots clean and
all five of P4's stylesheets have edit timestamps.

**Verified working after the kills:**
- All JS syntax-clean · zero raw hex outside `tokens.css` · suites 16/16,
  17/17, 19/19, 15/15, 26/26, 16/16.
- Game boots, routes to hub, **all 24 modules load**.
- **P1**: control row, edit tray and inspect popover all gone (only
  documentation comments remain); `G.Hub.spawnIntoMoveState()` exists and
  returns true without placing (correct — it enters Moving state); the
  context menu exists as `#hub-ctx-stash` / `-rotate` / `-place`; the §4
  face-culling fix landed at `js/iso.js:1506`.
- **P2**: header sleep button present and fully verified (see its own entry).
- **P3**: **all six phone apps** present — sponsors, social, crypto, career,
  stats, inventory — with a full inventory implementation
  (`phone__inv-grid`, `phone__slot`, `phone__slot-qty`, `phone__slot--empty`,
  **plus `phone__inv-pager`** so >9 stacks stay reachable).
- **P4**: all five stylesheets edited.

**Rotation transparency (owner bug) — strong evidence, not yet eyeballed.**
Distinct opaque colour counts per rotation: mini fridge **195 / 106 / 156 /
168**, full fridge **255 / 134 / 227 / 175**. The variation is the point — at
rot 1 the detailed door faces away and roughly half the colours disappear. If
details were still bleeding through back faces, every rotation would read
about the same. Opaque pixel counts stay tight (584-595, 1000-1022), so the
silhouettes are solid.

### Lead fixes on top
- **Sleep pulse vs disabled conflict.** SPEC §3's two conditions can both be
  true (night, energy >50%), so the button was greyed AND pulsing — the pulse
  says ACT NOW while the grey says YOU CANNOT. Disabled now wins; the pulse
  returns by itself once sleeping is legal.
- **Removed the orphaned `.tray-item` CSS family.** P2 correctly left it in
  case the new INVENTORY app reused it; it did not (phone uses its own
  `.phone__slot`), and a repo-wide grep found zero JS consumers.

### STILL TO DO
1. **Visual pass** — screenshots could not be captured (browser pane not
   compositing). Needs eyes on: hold-to-edit (lift + shadow + green/red tile +
   the 3 round buttons), the rotated fridge, the phone's 6 apps, the inventory
   grid, and P4's redesigned menus.
2. **Live gesture test** — 600ms hold, drag-to-move, and that the hold does not
   fight the room canvas's existing pinch/pan zoom.
3. **CAREER/STATS back-nav** — as phone apps their BACK should return to the
   phone; that wiring lives in `js/career.js` / `js/stats.js`, which no V17
   package owned.
4. **Unicode glyphs as icons** still in `hub.js`, `career.js`, `crypto.js`,
   `tournaments.js`, `locations.js`, `title.js`.
5. Two stale comments in `js/locations.js` describing the old 6x6-11x11 ladder.

---

## V16 — ROOM SIZES + PIXEL-ART REDESIGN (spec: `SPEC-V16-REDESIGN.md`) — IN PROGRESS

Three packages on fully disjoint files, run in PARALLEL: R1 (`data.js`+
`state.js`), R2 (`iso.js`), R3 (`tokens.css`+`style.css`+`main.js`).

- **R1 — room sizes: DONE + lead-verified.** Ladder is now **4x4 → 9x9**, one
  tile per upgrade. `test-v16-rooms.js` **16/16**; V12/V13/V14/V15-banners/
  V15-tutorials all still green.
  - **Two hazards the lead flagged pre-dispatch, both real:** `defaultPlaced`
    anchored the bed at **(4,5)** — flatly off a 4x4 grid — now **(2,3)**,
    spanning into the reserved corner; and every existing save shrinks (island
    11x11 → 9x9), so `migrateShrunkGrid()` relocates orphaned props and only
    ever splices from `placed`, **never `owned`**.
  - Four existing tests were edited. **Lead checked these rather than trusting
    "the test was wrong"** — each had hardcoded a coordinate that only exists
    in a 6x6 room (e.g. moving a pc to `(4,4)`). **Assertions unchanged**, only
    coordinates, each with a comment. Legitimate.
  - **Latent bug it found in existing code:** `migrateWallMounts()` treats any
    `y===0` tile as a wall **without a bounds check**, so a banner at (10,0)
    looked legal in a 9-wide room. Now covered by tests.
  - **A claim the lead disproved:** R1 reported `test-v15-rules.js` "does not
    terminate". It does — **26/26**, verified. It runs 200,000-open case-EV
    simulations and takes minutes; the agent killed it at 70-90s. Recorded so
    nobody "fixes" a hang that does not exist.

### Known-slow test
`test-v15-rules.js` legitimately takes several minutes (200k simulated case
opens per tier). Run it with a generous timeout or in the background. It is
not hung.

---

## V15 BATCH C — TUTORIALS, PHONE LOCK, PC ICONS — COMPLETE
(spec: `SPEC-V15-BATCH-C.md`) — owner items 2/3/5/7/11/13/14 + the PC defect

- **C1 (tutorial rules): DONE.** `d.tutorialsSeen` + 9 triggers +
  `tutorialPending()`/`markTutorialSeen()`/`tutorialSeen()`, copy in
  `Data.tutorials`. `test-v15-tutorials.js` **26/26**. Triggers derive from
  existing rules rather than new literals (Gold Nova via `rankFromElo`, 2,100
  via `Data.contracts.t3.require.elo`).
- **C2 (tutorial card + phone lock screen): DONE + lead-verified.** Card renders
  `Data.tutorials` copy into the existing `#modal-layer`, wired to the `change`
  event (never a render loop). Phone now **visible-but-locked** below 300
  followers — lead measured `"182 / 300 — Unlocks at 300 stream followers."`
  with the app grid at `display:none`, still hidden while asleep/moving/editing,
  and live-unlocking at 300 restores the grid.
- **C3 (stream): DONE + lead-verified.** Tap target **26.8px → 47px** measured.
  Root cause of the jumping: the fade keyframe animated **`max-height`**, a
  layout property, reflowing the list for 220ms on every removal — now
  `transform`/`opacity` only. DOM removals additionally queue while a pointer
  is down (§9.5), proven by a neighbour's rect being byte-identical across 5
  live taps. First-stream frozen-chat gate costs the player nothing.
- **C4 (PC icons): DONE + lead-verified.** Root cause: `props.pc` drew a
  0.13x0.15-unit sliver and only the accent **colour** varied per tier — never
  geometry — so four items spanning $150–$40,000 rendered as the same 57px.
  Lead re-measured: **57 → 245 / 291 / 389 / 478**, all distinct, ascending by
  tier, every control prop byte-identical.

### THE INTEGRATION BUG THE LEAD CAUGHT (worth remembering)
C1 added `d.streaming` and documented "Package C3 must set this" — but **C3 had
already finished**, and its brief never mentioned the field because it did not
exist when C3 was dispatched. So `state.js:1530` read a flag **nothing ever
wrote**: the "no tutorial during a live stream" suppression was dead code, and a
card could have popped over the live chat minigame.

Fixed by the lead in `js/stream.js` with a single `setRunning()` setter that
mirrors `running` onto `d.streaming` — deliberately ONE setter rather than
writes at all five lifecycle sites, which is the duplicated-rule shape behind
four previous user-visible bugs. Proven live: pending `phone_unlock` →
suppressed while live → **restored after navigating away mid-stream** (that
second half matters: a latched flag would have silently killed every future
tutorial).

**This is the parallel-package seam to watch: a package that finishes BEFORE a
dependency is invented never learns about it.**

### Lead harness errors this session — all caught before reporting
Four times a "bug" turned out to be the probe, not the code: `openCase(id)` vs
`openCase({caseId})` (looked like −96% ROI), `wake()` while awake (looked like
zero trajectory changes), `renderPropIcon(ctx)` vs `(canvas)`, and a stale page
that had not been reloaded after the agent wrote (looked like the lock screen
was missing). **Verify the probe before reporting the bug.**

---

## V15 BATCH A — BUGS + BALANCE (spec: `SPEC-V15-BATCH-A.md`) — IN PROGRESS

Owner playtest list items 1/4/8/10/12/15/16/17/18/19 + the §20 tier gate.
Tutorials (2/3/5/7/11/14), shop redesign (6) and the phone lock screen (13) are
Batch B/C. Art is confined to items already being touched — no global restyle.

- **A1 (rules + balance): DONE + lead-verified.** `test-v15-rules.js` **26/26**,
  and V12/V13/V14 all still green (16/17/19). Sheep 3%; the six item renames
  with **ids unchanged** so nothing paid for is lost; social managers per-DAY
  (1/2/3); sponsor catalog rescaled to $350–$4,500 with an absolute $350 floor
  and progress scaling, frozen at offer generation so held pay never drifts;
  crypto pre-seeded with ~200 real ticks so a first-time visitor sees a live
  market; PRIME/ELITE cases; the §12 extension fix; the §20a tier gate.
  - **§12 root cause (lead-located, `state.js:1854`):** the +20–35% bump was
    applied to the team's **live** salary while the card compared it against
    `d.teamSalary`, the player's **locked** salary. **SPEC-V13 §7 made
    trajectory mutable**, and trajectory multiplies salary (rising ×0.65 →
    declining ×1.35), so a team could be paying ~half what it did at signing
    and +35% of half is still a pay cut. **We caused the severity in V13.**
    Fixed by bumping from `max(locked, live)` with a hard floor at the current
    salary, plus `reSignCount` decay. The test constructs that exact
    declining→rising swing.
  - **§20a** proven: a T3-only career gets **zero** T1 offers over 300
    simulated days; `bestContractTier` is set on genuine completion and **not**
    on walking out early.
  - **Lead measured the case EVs independently** rather than trusting the
    agent, which stopped before ever reporting them. Over 200k opens each:
    standard **+5.36%**, PRIME **+4.42%**, ELITE **+4.22%** — all inside the
    +3..+6% target. Bands scale by `cost / baseCost`, which makes EV/cost
    invariant; the lead specifically checked that the **hidden gold roll**
    (hardcoded in `state.js`) scales too, since if it had not, the $200 case
    would have been a trap.
  - **A false alarm the lead raised and then disproved:** an initial probe
    showed PRIME/ELITE at −85%/−96% ROI. That was the probe calling
    `openCase(id)` instead of `openCase({caseId})`, so every call fell through
    to the default standard case. Implementation was correct. **Third harness
    error this session — verify the probe before reporting the bug.**
- **A2 (item art — first taste of `ART-DIRECTION.md`): DONE + lead-verified.**
  Shared `Iso.rampShade(hex)` / `Iso.boxRamp(...)` helper implementing the
  §2.2 ramp (top ×1.30 / left ×1.00 / right ×0.70 / outline ×0.35-or-`#0b0e1c`),
  built as ONE helper so the later full art pass inherits it. The old `box()`
  was deliberately left untouched so the ~30 not-yet-restyled props are
  unaffected.
  - **The §8 bug was bigger than reported.** The owner said the footrest was
    invisible when placed. Root cause: **`Iso.propMap` had no entry for ANY of
    the four regen items**, so `drawFamily` silently no-op'd — *all four* were
    invisible, not just the footrest. All four now have real entries.
  - Verified live at 420x860 on a fresh save: all six placed and visible,
    CIRCULATION FAN renders at every rotation, RECOVERY POD occupies two tiles.
  - Agent's own honest note, worth keeping: PIZZA BOX TOWER is the weakest of
    the six and can still read as generic stacked crates; AIR PURIFIER is
    adequate but generic-appliance.
- **NOT LANDED — still open in Batch A:** §8 banner wall-mounting (skipped
  entirely by A1; spans data/state rules + hub UI + iso art) and the §7
  case-selector UI.

---

## V14 — THE PHONE (spec: `SPEC-V14-PHONE.md`) — IN PROGRESS

Two owner requests: reposition the night banner, and move SOCIAL / SPONSORS /
CRYPTO off the career page onto a GTA-style in-game phone.

**Owner decisions (confirmed before any work started):** phone + social unlock
at **300 stream followers** · social **fully gated** until then · crypto app
unlocks at **$20,000 cash** · both banners move and stack. The `/impeccable`
skill was used for the phone's design; §0 of the spec carries the resulting
direction contract and craft floor.

- **Banners: DONE + lead-verified live.** Root cause was the same one SPEC-V6
  §30 already fixed for the edit tray: both banners were flex siblings with
  `flex: 0 0 auto`, so showing one **stole height from the canvas**. They are
  now an absolutely-positioned `.hub__top-banners` overlay inside
  `.hub__canvas-wrap`, with `--hub-top-inset` (measured, not hardcoded)
  shifting the location badge and energy drink down. Measured at 420x860:
  canvas height **644px identical** with no banner, night only, and both
  banners — the room never resizes, you just see less sky. 8px clearance, both
  corner buttons confirmed still clickable after the shift.
  - **Lead overrode one agent decision.** It made the ROOM INCOMPLETE banner
    `text-overflow: ellipsis`, reasoning that wrapping would break the inset
    measurement. **That reasoning was wrong** — the inset is measured from
    `offsetHeight`, so a taller banner measures correctly, and as an overlay a
    taller banner no longer squashes anything. Truncating hid the
    missing-items list, which is the only actionable thing that banner says.
    It now wraps and shows the full list (verified `truncated: false` with all
    five items missing).
  - That fix required a second one: the inset was only recomputed on
    visibility change, so furnishing one item could shorten the list without
    re-measuring and strand the corner controls. The diff key now includes the
    banner text.
- **P1 (rules): DONE + lead-verified.** `d.phoneUnlocked` / `d.cryptoAppUnlocked`
  in `defaultData()`, sticky latches, `State.phoneStatus()`, sponsor-offer gate.
  `test-v14-phone.js` **19/19**.
  - **Lead found and closed a real trap.** Gating sponsor OFFERS stops new
    content sponsors pre-phone but does nothing for a save that **already
    holds one** — and `sp_clipfeed` requires `followers: 0` while carrying a
    `content_posts` obligation. A pre-V14 save could hold it under 300
    followers; after the gate that obligation is unwinnable → $0 → warned →
    dropped at −10 reputation. Existing careers punished by our own change.
    Now **grandfathered**: holding a `content_posts` sponsor unlocks the phone.
    Chosen over rewriting the obligation (changes a sponsor's identity) and
    dropping the sponsor (takes away something paid for, which this project
    never does). Both the grandfather case and the don't-over-grant case are
    covered by tests.
- **P3 (extraction): DONE + lead-verified.** Sponsors moved wholesale out of
  `career.js` into `js/sponsors.js` as its own screen — a relocation, not a
  redesign; every V8 state (atRisk / warned / "MISS THIS WEEK → $0 PAID" /
  3-slot cap) survives. Career nav is now exactly LEADERBOARD + TOURNAMENTS.
  BACK from sponsors/social/crypto all return to the hub + phone. Verified: no
  `career-crypto-badge`, no social/crypto nav buttons, and the only remaining
  `sponsor` text in `career.js` is one explanatory comment — **no dead code**.
- **P2 (the phone object): DONE + lead-verified live.** Peek above SLEEP,
  handset with status strip / 2-col app grid / home bar, authored SVG icons
  only (6 of them — signal, padlock, price tag, chat bubble, coin+trend,
  battery), slide-up + tile stagger, `prefers-reduced-motion` fallback.
  Mounted inside `.hub__canvas-wrap` so "above SLEEP" falls out of the layout
  with zero JS measurement.
  - **Lead-verified live at 420x860, zero console errors:** absent at 0
    followers · peek at 300 with a 44px hit target sitting above SLEEP ·
    all three tiles render with correct labels · locked crypto shows
    `$20,000 TO INSTALL` and **toasts** on tap (no silent no-op) · unlocks at
    $20k and **stays unlocked when cash drops to $0** · crypto news lights the
    tile dot AND the peek dot, social never does, and **the hub CAREER badge
    stays untouched** · SOCIAL tap → social screen → BACK → hub with the phone
    reopened (P2+P3 integration end to end) · peek hidden in EDIT ROOM and
    while asleep, restored after · no label overflow or clipping, no
    horizontal page scroll.
  - **`/impeccable` detector: clean** (`detect.mjs` over `phone.js` +
    `phone.css` returns `[]`).
  - **A lead "fix" that broke it, caught by measuring.** The detector flagged
    `transition: width` on the battery fill. The lead rewrote it as
    `transform: scaleX()` — composited, textbook-correct — and it **silently
    stopped rendering**: the inline style applies and `transform-box` resolves
    to `fill-box`, but the computed transform stays `matrix(1,0,0,1,0,0)`
    because **CSS transforms are not honoured on SVG child elements in the
    target engine**. Reverted to writing the rect's `width` (measured working:
    62% energy renders at exactly 0.62 of full, red under 20%) and dropped the
    *transition* instead — energy ticks once a second, so the tween ran
    continuously at a granularity nobody can perceive. Detector clean either
    way. **A generic lint rule is not evidence the replacement works.**
  - False alarm from the agent, checked and dismissed: it reported a "stray
    backslash" at `js/main.js:21`. That line is a normal comment; it misread
    the `§` character.

### Still open at this point
- `js/career.js:~296` uses `'✉'` as an icon (team-offers empty state) and
  `js/crypto.js` uses `▲▼✓✗` — both pre-existing, both violate the V14 craft
  floor's "no Unicode glyphs as icons". Flagged by P3, deliberately not fixed
  inside an extraction. Worth a cleanup pass.

---

## V13 — FIFTH PLAYTEST PASS (spec: `SPEC-V13-PLAYTEST.md`) — IN PROGRESS

Nine owner-reported items. Lead decisions on the ambiguous calls are recorded in
the spec itself (§1 stable teams get a line too, §3 the workstation is the desk
plus whatever shares its tile, §4 swap-in-place, §7D a signed contract is never
repriced, §8D the dot does not reach the hub badge, §9 5-minute cooldown).

**Package map:** A (`data.js`+`state.js`) first and alone → then B
(`hub.js`+`iso.js`), C2 (`career.js`+`crypto.js`+`teams.js`), D
(`main.js`+`shop.js`+`stats.js`+`tutorial.js`+`style.css`). C1
(`tournaments.js`+`css/teams.css`) was split out and runs early, since §6 is
pure presentation over an already-decided result and depends on nothing A builds.

- **A — data.js half: DONE.** Verified by the lead by grep + `node --check`
  after the agent was killed mid-batch by a process shutdown:
  §2 energy values now distinct and ascending (minifridge 25→**15**, fridge
  30→**20**, IV drip 30→**25**) with matching `desc` strings; the block comment
  claiming "100 base + 15+25+30+30" described **four** items when only three
  exist, and was rewritten — four placed IV drips now land on the 200 ceiling
  exactly. §1A `Data.trajectoryScoutLines` (12 rising / 10 stable / 12
  declining) + `Data.scoutLineFor()` at `data.js:1048`, a string hash with **no
  `Math.random()`** so the banner cannot reshuffle on every render. §7A
  `trajectoryCycleDays` / `trajectoryRollWeights` / `trajectoryTournamentBoost`
  / `rollTrajectory()` with the mild anti-repeat. §9A `cashAdCooldownMs`.
  **`data.js` is now frozen for this batch.**
- **A2 — state.js half: DONE.** §5A `State.scrim()` now returns
  `{ok, chemistry}`; §8A `d.crypto.lastSeenNewsTick` +
  `cryptoUnseenNewsCount()`/`markCryptoNewsSeen()`; §9A `d.lastCashAdAt` +
  `cashAdCooldownRemaining()`/`cashAdReward()`/`watchAdCash()`; §7B/§7C mutable
  `traj`/`trajUntil`/`trajCycleLen` per team, re-rolled in `resolveNewDay()`,
  with `trajectorySince` exposed on `teamPublic()` and a tournament heat boost;
  §3A `groupIndicesFor()`/`canMoveGroup()`/`moveGroup()` with
  `canPlaceFootprint()`'s `excludeIdx` generalised to accept an array; §4A/§4B
  swap-in-place `placeItem()` returning `{ok, reason, replaced}` plus
  `migrateCoreSingletons()`. New suite `test-v13-rules.js` — **17/17**,
  re-run by the lead.
- **C1 — §6 match animation: DONE.** Round sequence proven legal over 650
  trials across 26 scorelines; measured 8.2s for 13 rounds, 9.3s for a 30-round
  overtime, both inside the 10s cap; SKIP present; one `setInterval` (never
  rAF, which is throttled to 0fps in a background tab), zero leaked.
  - **Lead found and fixed a real bug it shipped:** `matchInFlight` gates PLAY
    MATCH but was only released by the reward card's `onClose`. Navigating away
    mid-animation left it latched, making PLAY MATCH a **permanent silent
    no-op** for the rest of the session (HANDOFF §9.6). Released in `onExit`
    — deliberately NOT inside `cancelMatchAnimation()`, which
    `startMatchAnimation()` calls one line after the flag is set.
- **D — topbar/shell: DONE.** §9 resources modal (four explainer rows + the
  cash ad) with the handler bound **once** in the build function, never on the
  1s refresh path — the documented cause of this project's multi-tap bug.
  Verified live across 5 taps spanning the refresh tick. §2 needed **no code
  changes**: every consumer reads `def.energyAdd` generically, confirmed live
  reading 15/20/25 in both the shop chip and the stats breakdown, with a
  repo-wide grep finding no stale hardcoded literals.
- **Lead re-verification of §9's payout**, because D reported seeing **+$600**
  on what should have been a fresh low-ELO save: `watchAdCash()` calls
  `cashAdReward()` (one formula, no mirror), and on a genuinely fresh save
  (elo 120) 40 consecutive grants all landed in **50-100 with zero
  violations**, cash delta always equalling the reported amount, cooldown
  engaging at 300000ms. The $600 was a **save contaminated by the concurrent
  package agents sharing one browser origin** — the exact hazard PROGRESS.md
  already warns about — not a wiring bug. An elo-3000 player on a $5k/month
  team gets **$660**, matching the owner's "$500-800" example.

- **B — hub/room: CODE COMPLETE, LIVE VERIFICATION NOT DONE.** Stopped by the
  owner at end of session, during its wrap-up rather than mid-edit. The lead
  established what landed **by grepping, not from its dying message**: all four
  checklist items are present in `js/hub.js` / `js/iso.js`, both files
  syntax-clean.
  - §4A contract: `hub.js:832` now reads `res.ok` and toasts `res.reason`
    (the old `if (!ok)` would have silently swallowed every failure, since an
    object is always truthy).
  - §4C dead branch: the unreachable `else if` surplus-pickup path is deleted,
    with a comment at `hub.js:1005-1016` recording why.
  - §4C tray swap: `hub.js:666-672` swaps in place with no ghost draft;
    `hub.js:1398` gates the tray on `placedCountInCategory(cat) >= 1`.
  - §3B group draft: `groupIdxs` threaded through `pendingTileCheck`
    (`:716`), `beginPendingPlacement` (`:740-745`), `commitPendingPlacement`
    → `State.moveGroup` (`:804-818`) with the `WORKSTATION MOVED` toast, and
    the multi-member ghost preview (`:904-909`).

---

## V13 LIVE VERIFICATION — DONE (lead, in-browser)

Served over `http://localhost:8123` (a minimal static server in the session
scratchpad — the `npx serve` entry in `.claude/launch.json` never came up).
**Fresh save `V13LIVE`** created through the real title-screen flow, driven by
real clicks on the canvas, not by calling internals. **Zero console errors**
across hub, edit mode, leaderboard.

- **§3 workstation group — VERIFIED THROUGH THE UI.** `groupIndicesFor` returns
  `[0,1,2]` from the desk, the pc **and the monitor**, while chair `[3]` and bed
  `[4]` stay solo. Tapping the **monitor** on the canvas opened a group draft
  (ghost drew desk+monitor together), and ✓ PLACE moved all three from
  `(1,1)` → `(3,1)`. **No floating monitor.** Chair and bed untouched.
  A group move onto the chair's tile refused with `TILE ALREADY OCCUPIED` and
  **moved nothing** (verified by diffing the whole placed array), while a legal
  move immediately after still relocated all three — so it refuses the right
  thing, not everything.
- **§4 exactly-one core — VERIFIED.** Buying `chair_gaming` swapped it in at
  `(1,2)`, the wooden chair's **exact** tile/rotation; `chair_wooden` stayed in
  `owned`. Buying `bed_kingsize` — the **2-tile footprint** case — swapped in at
  `(4,5)` with the footprint preserved and `bed_mattress` still owned. Final
  state: exactly **1 each** of desk/pc/chair/monitor/bed placed, room still
  complete.
- **§7 team heat — VERIFIED over 30 in-game days.** **99/100 teams changed heat
  at least once.** Changes are spread across every single day (3-15 per day),
  never clumped — the first-cycle stagger (`day + randInt(1,14)`, observed
  spread 1-14) works. `trajUntil` never sat more than **14** days ahead. Final
  distribution 41 stable / 30 rising / 29 declining, matching the 30/40/30
  weights. Leaderboard visibly renders a live mix of 🔥 and ❄.
  - *Method note:* the first attempt used `State.wake({force:true})`, which
    returns `{ok:false, reason:'not-asleep'}` when the player is awake — it
    advanced nothing and showed 0 changes. That was **the probe being wrong,
    not the feature**; re-run through `State.endDay()` it advanced day 1 → 31
    correctly. Recorded so the same false negative isn't re-derived later.
- **§1 + §7 interaction — VERIFIED.** `scoutLineFor` returned an identical line
  across **50 consecutive calls** (so it cannot flicker on re-render), and the
  line changed exactly when a team's heat changed — declining *"Their main
  sponsor pulled out and the org has gone quiet."* → rising *"They have quietly
  won three straight scrims against better sides."* Pools are 12 / 10 / 12.

**V13 IS COMPLETE. All nine owner-reported items shipped and verified.**

### Two constants the owner should retune after a playtest
- `Data.cashAdCooldownMs` = **300000** (5 min) — the §9 cash-ad cadence.
- `Data.trajectoryCycleDays` = **{min:7, max:14}** — the §7 heat window.

### Still open (pre-existing, not V13)
- The packed-box icon during move-out draws over only a footprint prop's first
  tile (cosmetic, inherited from V12 — the group work did not touch it).
- `career.js` still monkey-patches `State.wake`/`endDay`/`skipNightAd`/
  `tickEnergy` for the promotion banner; both files are free now, so it belongs
  in `hub.js`.
- `mockups/` is still V1-era and badly stale.

---

### V12 suite: 7/16 red after A2, and it was NOT a regression
Every failure was `placeItem()` returning `{ok:...}` where the old test
asserted a bare boolean. Two failed with `ok:true` where `false` was expected,
which would have meant props stacking inside one another again — so this was
checked rather than assumed. Both aborted on their **first** assertion, so the
real rule was never exercised. One expectation ("a second desk must not stack")
is now genuinely obsolete by design: under §4 a second desk **swaps in place**.
That check was retargeted to assert the new swap contract AND to re-assert the
underlying "no tile holds two of the same category" rule via
`canPlaceFootprint()`, where `placeItem`'s swap cannot mask it. **Back to
16/16.**

### The shutdown, and why it cost almost nothing
Package A was killed after finishing `data.js` and before touching `state.js`.
The brief ordered its checklist **smallest-first specifically so a kill banks
real progress**, and it did: `data.js` was complete and correct, `state.js` had
an unchanged mtime. The continuation was scoped to exactly the remainder with
`data.js` declared frozen. **Verified by grepping what actually landed**, per
HANDOFF §4.4 — there was no dying message to trust in the first place.

---

## V11 — COMPLETE (spec: `SPEC-V11-FIXES.md`) — 3 playtest fixes

1. **Rotation for every placeable prop.** Was whitelisted to desk/chair/PC/
   monitor, so beds and decor silently ignored ROTATE. All families now rotate;
   `pickProp()`'s hit-anchor reads the **same** list so art and tap target
   cannot desync. The one symmetric prop (rug) was wired through anyway rather
   than special-cased, so no second whitelist exists to drift. Verified by
   pixel-checksumming all four rotations of a bed and four decor props.
2. **Fridge consolidation** — undid a lead design error (SPEC-V7-FIXES §3 added
   a `fridge` category when max-energy fridges already existed). One set now:
   `energy_minifridge` = 4 drinks, `energy_fridge` = 12, capacity from **placed**
   fridges and summing. Legacy `fridge_mini`/`fridge_full` saves convert 1:1 and
   auto-place the better one when under the 4-placed cap. 47 assertions.
3. **Sleep-block copy** — no longer advises the SKIP NIGHT ad, which only exists
   while asleep. All other blocked-action toasts audited for the same class of
   unreachable advice.

### Two follow-ups found and fixed during the batch
- **Tapping a settled bed did nothing**, so rotation was unreachable even once
  the art worked — `hub.js` and `state.js` disagreed on whether `bed` is a
  singleton. Fixing it also needed a `pendingTileValid()` exception, or the bed
  could never return to its own reserved corner tile.
- **The duplication was then removed at the root:** `state.js` exports
  `State.SINGLETON_ROOM_CATEGORIES`; `hub.js` derives from it. No hardcoded
  singleton list remains in `hub.js`.

**Final verification:** all JS syntax-clean · zero raw hex across `style.css` /
`teams.css` / `minigames.css` / `stats.css` · no dead `fridge` category (only a
comment documenting its removal) · sleep copy clean · all five singleton
categories verified tappable, rotatable and placeable in-browser, with surplus
removal and last-instance refusal both confirmed at the state layer.

## V6 — COMPLETE (spec: `SPEC-V6.md`) — 31 playtest fixes

**Lead verification of the integrated build:** all JS syntax-clean; zero raw hex
in the three owned CSS files; all 7 screens render with **zero console errors**
on a fresh save. Measured: **first-stream viewer cap = exactly 230** (was 500),
followers stored as an integer, 6 locations at 6x6→11x11, energy drink moved to
`consumable`, 4 `regen` items, 10 ground-drawing functions covering every
location.

**Root-cause fixes, both closed:**
1. **Rent countdown** — display used a naive `day % 7` borrowed from the
   subscriber-payout cadence while `applyRent()` used the offset-aware formula;
   they agreed only when `offset === 0`. Now share one helper. Verified across
   7 offsets × 30 days = **210 combinations, 0 mismatches**.
2. **Monitor-on-desk placement** — `State.placeItem()` had a blanket "tile
   occupied" check rejecting the legitimate stack, so the hub had bypassed
   `placeItem()` entirely for monitors and hand-written to `State.data.placed`,
   duplicating the owned/placed accounting. Fixed with an explicit
   `ALLOWED_STACK_ON = { monitor: 'desk' }` table; **the hub workaround was
   removed** and monitors now go through the same `placeItem()` path as every
   other category. Verified against a full matrix (monitor on empty tile, on a
   desk, on a non-desk prop, second monitor on an occupied desk, and other
   categories attempting to stack). The agent also caught its own first attempt
   allowing a monitor onto a fully empty tile, and fixed it before reporting.

**V6 is done. The game is ready to playtest.**

---

## V7 FIX BATCH — IN PROGRESS (spec: `SPEC-V7-FIXES.md`)

Ten playtest fixes that must land **before** the sponsorship work.

- **X (core rules): DONE.** 42-assertion smoke test.
  - **§5 sleep deadlock** — `State.canPlayTournamentMatchToday()` already
    existed and was already correct; `hub.js` simply never used it. Added
    `State.tournamentMatchAvailableToday()` as a clean drop-in for Package Y.
  - **§10 coach win rate** — rookie auto-form 0.25→0.35 and the win-chance form
    coefficient 0.35→0.65 (base unchanged at 0.30). Measured: uncoached
    **30.0%** (unchanged), rookie **38.8% → 52.8%**, analyst 45.8% → 59.3%,
    IGL 54.5% → 75.5%. Floor met, tiers strictly ordered, endpoints sane.
  - **§3 fridges** — `fridge_mini` (cap 4) / `fridge_full` (cap 12) under a new
    `'fridge'` category; energy drinks marked `requiresFridge`. Flagged that
    `shop.js`'s `SECTION_ORDER` has no `'fridge'` entry, so the items exist but
    will not render until Package Z wires it up.
- **Z (career/shop): DONE.** §5 copy → "NEXT MATCH TOMORROW"; §8 offer cards now
  icon-only at 2x the leaderboard size (measured, not eyeballed); §3u fridge
  section wired into `SECTION_ORDER` with the energy-drink BUY gated on
  `fridgeStatus().canBuyDrink` and "NEEDS A FRIDGE" / "FRIDGE FULL" states;
  §6 quota now rendered exclusively from `State.scrimQuotaStatus()` with a
  coach-attribution line and a 1s interval started on enter / cleared on exit.
  - **Verified the L2 bar actually climbing live** (0→13→27→29→30/30 without
    re-entering the screen) — the exact check that would have caught a frozen
    bar. L3 read 30/30 at `wakeElapsedMs: 0`; L1 showed the bedtime reminder.
    Instrumented `setInterval`/`clearInterval` across 3 enter/exit cycles:
    exactly 1 interval open, 0 after exit.
  - **Flagged but deliberately out of scope:** `tournaments.js:86` still reads
    "EVENT LIVE — NEXT MATCH UNLOCKS AFTER YOUR NEXT SLEEP" — same wording
    problem as §5, not covered by the ticket's literal quote. **Lead to fold
    into final cleanup.**
- **Y (viewport/room/zoom): DONE.** §5 sleep gate swapped to
  `State.tournamentMatchAvailableToday()` (**deadlock gone**); §9 every sleep
  failure path now toasts a reason; §7 consumables excluded from the edit tray;
  §1 `--safe-top`/`--safe-bottom` from `env(safe-area-inset-*)` with topbar/nav
  on `min-height`, verified by DOM measurement at 375x812, 390x844 and 430x932
  with simulated notch insets — no stat clips; §2 tray now a fixed-height
  horizontally-scrolling single row; §4 zoom/pan controller with cursor-anchored
  wheel zoom, two-finger pinch, 3x max zoom-in, and a zoom-out floor pinned to
  the room-fit camera so it auto-tracks room size.
  - **Bug it found:** `iso.js`'s `computeCamera()` had a hard floor of
    `scale = Math.max(1.6, …)` that overrode the fit computation, so 11x11
    rooms overflowed the screen. Floor lowered to 0.35 so the real fit scale
    wins. That would have shipped as "the biggest location is broken".
  - Honest caveat: real notch hardware and true touch pinch could not be
    tested — verified via CSS-variable simulation + DOM measurement and
    synthetic `PointerEvent` dispatch respectively.

**V7 fix batch: all 10 items complete.**

---

## V8 — SPONSORSHIPS (spec: `SPEC-V8-SPONSORS.md`) — IN PROGRESS

First of the three approved mid-game systems. Content-posting obligations
deliberately **excluded** until the social-media system exists (enum left
extensible so no migration is needed).

- **A1 (rules & data): DONE.** 8 sponsors $30→$750/week gated on followers /
  subscribers / team rank; offers arrive one at a time every 2–5 days on a track
  separate from team offers, capped at 3 held; three obligation types
  (`stream_days`, `stream_minutes`, `match_wins`) tracked weekly; payout on the
  **subscriber-payout tick** (deliberately reusing that cadence rather than
  inventing a third, and avoiding rent's per-save offset); warn → drop with
  −10 reputation. `State.sponsorsStatus()` exposes live progress, days left,
  next payout and an `atRisk` flag. Smoke-tested including a save/reload round
  trip proving `normalizeSave()` keeps every new field.
  - **Tuning decision worth keeping:** payout is **contingent on the obligation
    being met** — a missed week pays $0, not a warning plus a free paycheck.
    That is what makes "I skipped the sponsor's ask to make a scrim" a real
    trade-off. The two misses that trigger a drop must be **consecutive**.
  - **Integration gap it flagged in a file it did not own:**
    `State.applyStreamResult()` reads an optional `res.durationMs` to advance
    `stream_minutes` obligations, but `js/stream.js` never passes it — so those
    obligations would sit at 0 forever in the live game while passing in tests.
    **Handed to A2**, which now owns `stream.js` for that one wiring change.
- **A2 (UI): DONE.** SPONSORS panel sits directly under the SCRIM button — same
  glance, same energy-budget tension. Held cards show pay, obligation, live
  progress bar, and an explicit "ADVANCED BY STREAMING — NOT BY SCRIMMING" hint
  so the coach-vs-sponsor conflict is legible. `atRisk` gets both a per-card and
  a section-level red callout; `warned` gets its own banner naming the −10
  reputation cost; every unmet obligation states "MISS THIS WEEK → $0 PAID" so a
  missed week never reads as still paying. Offers show slot count and disable
  Accept at 3/3.
  - **Fixed the `durationMs` gap** in `js/stream.js` by reusing the count-up
    timer's own elapsed value rather than recomputing it. Verified live: a real
    ~19s stream moved a `stream_minutes` obligation 0 → 0.31 — it would
    otherwise have sat at 0 forever while passing tests.
  - Verified the whole failure path live: unmet-first-miss → `warned`,
    already-warned → dropped, reputation −10 exactly, slot freed 3/3 → 2/3.

**V8 SPONSORSHIPS: COMPLETE.**

---

## V9 — SOCIAL MEDIA (spec: `SPEC-V9-SOCIAL.md`) — IN PROGRESS

Second of the three systems. Lead pre-wired `#screen-social`, the
`js/social.js` script tag and a no-op stub so B2 never contends over
`index.html`.

- **B1 (rules & data): DONE.** 45-assertion smoke test. Three platforms with
  unlock thresholds gating on *total* social followers; posts drip their gain
  over 3 days (sum-exact, not instant); ~4% virality at 8–15x verified over
  20k samples; weekly ad revenue on the **existing subscriber tick** (no fourth
  cadence invented); social followers fold into `viewerCap()` at half weight and
  into subscriber conversion (capped +30%); three social managers folded into
  the existing staff upkeep/quit loop; the fourth sponsor obligation type
  (`content_posts`) added with three sponsors using it. Forward-migrates a
  pre-V9 save with no `social` key at all.
  - **Energy-budget check (the design's main risk), done properly:**
    scrim + stream + CLIPS = **72/100**; scrim + stream + LONGFORM = **85/100**.
    All three masters fit in a day with real pressure — **no ceiling raise
    needed**, so the competing-demands tension survives intact.
  - Ordering detail it got right unprompted: drips pay out *before* the
    manager's daily auto-post roll creates a new one.
- **B2 (UI): DONE.** Three platform cards with locked ones showing their unlock
  threshold and a progress meter rather than being hidden; **pending drip is the
  loudest element on each card** ("+N FOLLOWERS STILL INCOMING") so posting
  reads as an investment; viral posts get the rare-pull treatment (rare sfx +
  confetti + reward card); weekly ad revenue and next payout; SOCIAL added to
  the career nav row with BACK returning to career (the bug `teams.js` and
  `tournaments.js` both had); social managers in the shop with an explicit
  "0 ENERGY COST" chip; `content_posts` given a proper label rather than falling
  through to generic copy.
  - Verified live: post took energy **100 → 88**; after a day followers went
    **0 → 32 with 66 still pending** across two open posts (drip confirmed
    gradual, not instant); hiring an intern then advancing a day auto-posted
    while **player energy stayed at 100**.

**V9 SOCIAL MEDIA: COMPLETE.** Sponsorships now have all four obligation types.

---

## V10 — CRYPTO MARKET (spec: `SPEC-V10-CRYPTO.md`) — IN PROGRESS

Last of the three systems. Lead pre-wired `#screen-crypto`, the `js/crypto.js`
script tag and a no-op stub.

**The rule it lives or dies by:** a pure random walk is a slot machine with
extra steps. News must give a **real but unreliable edge** — ~68% reliability,
hidden magnitude, ~15% fake-outs, and resolution staggered over 2–4 days so the
player must decide *when to exit*, not just when to enter. That last property is
what stops the system collapsing into a single decision.

**NO LEVERAGE** — owner's explicit decision reversing an earlier proposal.
Leverage plus readable headlines is trivially exploitable. Recorded so it is not
re-added.

**Deliberately orthogonal:** crypto must not cost energy, gate progression, or
touch sponsors/scrims/streams. It is what the player does *between* decisions.
That is why it was scheduled last.

- **C1 (rules & data): DONE.** Four coins (BITCOYN ±2%/$40k, ETHERIUM ±5%/$2.5k,
  SOLANO ±10%/$150, DOGEBORK ±22%/$0.12); random walk with mild mean reversion
  plus floor/ceiling clamps; 0.5% fee with per-coin cost basis and unrealised
  P/L; 20-headline pool; buys hard-capped at cash so leverage is structurally
  impossible.
  - **The properties that matter were MEASURED, not asserted:** news reliability
    **69.3%** over 300 resolved headlines (target ~68%) and a **15.3%** fake-out
    rate (target ~15%). 20,000 simulated ticks stayed bounded — no coin hit
    zero or infinity. Resolution genuinely spans 12–24 ticks (2–4 crypto days).
    Save/reload verified across two separate VM sandboxes sharing one
    localStorage shim, so prices, holdings, cost basis and active news all
    survive a reload — a player does not return to a fresh market.
  - **Design decision worth keeping:** a crypto "day" is an internal unit of
    `ticksPerDay` wall-clock-paced ticks, **decoupled from `d.day`** (which only
    advances on sleep). Necessary so the market keeps moving through a long
    uninterrupted session rather than freezing until the player sleeps.
- **C2 (UI): DONE.** Portfolio panel (total, cash, holdings value, unrealised
  and total P/L, live fee rate); news feed built first and most prominent, with
  a coin badge, direction, relative timestamp, resolution progress bar and a
  **TRACK RECORD** strip derived from the rolling log — deliberately exposing no
  hardcoded 68%/15% constants, only what play reveals; four coin cards iterating
  `Data.cryptoCoins` with canvas sparklines, risk badges, and cost basis / P/L
  kept prominent above the trade controls; buy/sell with the exact fee shown
  before confirming, plus SELL ALL.
  - **`tickCrypto()` confirmed catch-up based** (anchors on
    `d.crypto.lastTickAt`, reconciles elapsed steps, capped at 200) — so calling
    it on entry plus a 1s interval while open is sufficient and **no global loop
    in `main.js` was needed**. Verified prices stay flat off-screen (no leaked
    interval) and resume on re-entry.
  - Verified live end to end: buy → cash down by exactly the amount with the fee
    shown pre-confirm and cost basis correct; a real tick moved price, sparkline
    and unrealised P/L; partial sell reduced cost basis proportionally and
    surfaced realised P/L; SELL ALL cleared and hid the sell row; headlines
    appeared with correct coin attribution and resolved into the track record.
  - Guarded against the recurring bug: BACK returns to CAREER, not the hub —
    the same fault already fixed three times in this codebase.

**V10 CRYPTO: COMPLETE. All three mid-game systems shipped.**

---

## FULL-BUILD VERIFICATION (lead, after all three systems)

Fresh save, fresh load: **9/9 screens render, zero console errors**, all JS
syntax-clean, **zero raw hex** across `style.css` / `teams.css` /
`minigames.css` / `stats.css`. Confirmed live: 3 sponsor slots, 3 social
platforms, 4 crypto coins, and a first-stream viewer cap of exactly **230**
(the V6 fix still holding after three further systems landed on top of it).

**Build order finalised as sponsorships → social media → crypto** (see
`SPEC-V7-BACKLOG.md` for the reasoning). The owner offered the choice; social
media went second because sponsorships are *incomplete without it* (they shipped
with 3 of 4 obligation types), because both draw on the same daily energy and
should be balanced together, and because crypto is orthogonal and therefore the
safest thing to land last.

**Wording sweep: DONE.** All four remaining player-facing unit-of-time strings
now read "TOMORROW" (`tournaments.js:86`, `locations.js:52`/`:73`,
`stats.js:223`). Everything still matching "sleeps" in the codebase is a
comment or an internal identifier (`OFFER_EXPIRY_SLEEPS`,
`tournamentIntervalSleeps`, `dueInSleeps`), which the rule explicitly permits.

### Attempt log
- V8 A1 attempt 1: killed by a session limit **before writing anything** —
  verified `data.js`/`state.js` had zero sponsor markers and no API section.
  Restarted clean, with an explicit "bank the catalog first" ordering so a
  future limit cannot wipe the whole package again.

### Two bugs of the same shape, worth remembering
Both the sleep deadlock and the coach-quota complaint had **correct state and a
wrong consumer**. In each case the logic was right and an earlier agent verified
it, reported success, and the bug persisted because nobody checked what the UI
actually read. When a fix is reported working but the player still sees it
broken, **check the consumer, not the source.**

---

## V7 SPONSORSHIPS ETC — APPROVED, NOT STARTED (design: `SPEC-V7-BACKLOG.md`)

Sponsorships → social media → crypto market (spot-only, no leverage, with
deliberately unreliable news headlines). All three approved by the owner.
Deliberately **not dispatched yet** — see the note there on why they should
follow a playtest rather than stack onto V6.

- **T (core rules & data): DONE.** All 21 rules items, verified by a **59-check**
  headless smoke test. Notably it *confirmed three items were already correct*
  (subscriber weekly payout, coach L1/L2/L3 scrim behaviour, and the §26 check)
  rather than rewriting them — the owner had flagged the coach one as a repeat,
  so this was the right call to verify rather than assume.
  Highlights: viewer cap (new save = exactly 230, 300 streams/200k followers/T1
  ≈ 1.13M), integer followers/subs/peak viewers, energy drinks moved to a
  `consumable` category, new `regen` category capped at +2.0/s (night stays 0),
  per-rank ELO requirements, gradual offers (max 3), multi-day tournaments,
  continuous form multiplier, cumulative scrim misses, singleton-pickup rewrite,
  expansion deleted with 6 locations 6x6→11x11 and clean migration.
- **W (career/teams/shop/locations): DONE.** Back-nav to CAREER, styled
  empty-offers state, exact "MINIMUM X,XXX ELO" on offer cards, offer inbox
  copy for 0–3 open, `consumable` + `regen` shop sections, placed-vs-owned cap
  copy, tournament day-gating UI (also killed a stale hardcoded "every 14 days"
  fallback — real cadence is 7), and the full locations rework with expansion UI
  removed.
  - **Found a root-cause bug it did not own:** `State.statsSummary().career.`
    `rentDueInSleeps` ignores the new `rentDayOffset`, so the countdown shown
    disagreed with when rent is actually charged (showed 6 when the real charge
    was 5 days out). It worked around it locally in `locations.js` and flagged
    the source.
- **Rent-countdown root cause: FIXED.** The display used a naive `day % 7`
  borrowed from the *subscriber payout* cadence, while `applyRent()` used
  `((day - offset) % 7 + 7) % 7`. They agreed only when `offset === 0` — i.e.
  almost never, since V6 randomises it. Fixed by extracting `rentDayMod(d)` /
  `rentDueInSleeps(d)` so the charge decision and the countdown derive from
  **one helper and cannot drift apart again**. Brute-force verified across all
  7 offsets × 30 days = **210 combinations, 0 mismatches**. `stats.js` needed no
  change (it renders the value with no arithmetic of its own).
- **V (minigames): DONE.** Chat pools doubled (friendly 51→102, toxic 26→55);
  aim trainer switched to `setFormFromPerformance()` with the letter grade now a
  derived label and the card leading with the real multiplier; viewer cap
  consumed fresh per session (**new save = 230**, verified) with a proper curve —
  ramp, then plateau with net-negative jitter, and rare pulls animating a spike
  over ~3.9s instead of one frame; streams no longer silently die on navigation
  (they settle with a full "PAID OUT FOR TIME ACTUALLY LIVE" payout), and it
  added `G.Stream.isLive()` for the nav lock plus closed a second hole where
  re-entering the STREAM nav button while live re-triggered `onEnter()`.
  - **§11 multi-tap — diagnosed, not fixed (correctly).** It audited every
    button in its own three files, found none repositioned per frame and could
    not reproduce a dropped tap there, then identified the real cause in
    **Package U's `hub.js`**: the ghost PLACE button is a real `<button>` whose
    `style.left`/`top` is rewritten **every render frame** while tracking the
    drag preview — the textbook "moving element under an active touch" bug, so
    the element shifts between `pointerdown` and `pointerup` and `click` never
    fires. It reported rather than fabricating a fix. Relayed to Package U.
- **U (hub/room/world): PARTIAL** — killed by a session limit. State established
  by inspection, continuation dispatched.
  - **DONE:** §8 ELO number before the PRO LEAGUE label; §23 bed pillows (they
    were hardcoded to a bright accent cyan and drawn at the wrong height);
    §13 sheep-hit energy surfaced in the HUD; §3 energy-drink can button;
    §17 stream nav lock in `main.js`.
  - **REMAINING:** §11 multi-tap (**confirmed still present** — `hub.js` ~564-567
    still assigns `style.left`/`top` to both ghost buttons inside the render
    path, which is exactly the diagnosed cause); §24 pickup UI; §10 monitor/desk
    art + monitor-needs-desk; §29 ground for the other five locations (only
    `drawGrassGround` exists); §30 edit-mode overlay.

### Note: shared test environment
The browser/localStorage instance is shared across concurrent agents. Package V
saw an unexpected `TEST` save slot and unattributed clicks. When verifying,
**create a fresh save** rather than trusting existing slots.


## V5 — COMPLETE (spec: `SPEC-V5.md`) — all 31 playtest fixes

**Lead verification of the integrated build:** all JS syntax-clean; zero raw hex
in `style.css`/`teams.css`/`minigames.css`; all 7 screens render with **zero
console errors** on a fresh save; **100 teams with zero duplicate names and zero
repeated words** (the owner's #1 complaint, measured not assumed); sheep thought
bubble and grass plane both confirmed visually; nav reads TRAIN -5 / CASES -1.

**Outstanding tech debt to address next round:** `career.js` wraps
`State.wake`/`endDay`/`skipNightAd`/`tickEnergy` to catch `tierChange` for the
promotion banner, because the wake button lives in `hub.js` and that file
belonged to a different package mid-flight. Both files are free now — this
logic belongs in `hub.js`. Same monkey-patch shape that was cleaned out of the
audio module in V2; worth folding in before it settles.

---

### V5 detail

**Packages:** P (`data.js`+`state.js`) first, then Q, R, S in parallel.
- Q = `hub.js`, `iso.js`, `main.js`, `sheep.js`, `ui.js`, `css/style.css`
  → items 2 (sheep thought bubble), 5u (rotation + movable core props),
    7 (settings button), 8 (balance flicker), 9 (remove EARNINGS),
    15 (PRO LEAGUE / SIGNED), 21 (notification dots + sleep gate), 31 (grass)
- R = `aim.js`, `stream.js`, `cases.js`, `css/minigames.css`
  → 3 (credit on spin stop), 4 (10s trainer), 13u (stop-anytime stream)
- S = `career.js`, `teams.js`, `tournaments.js`, `shop.js`, `css/teams.css`
  → 6u (cap warning), 12u (reputation UI), 20 (single-scroll shop),
    22u (show opponent scores), 24 (fire/snowflake + rank arrows),
    27u (promotion banner), 30u (extension offers)
- **Item 10 ("sleeps" → "days") applies to every package** for its own files.

### Key V5 decisions made by the lead
- **Reputation** is signed −100…0…+100 (starts 0), gating which tiers will
  offer: QUESTIONABLE (<0) locks out Tier 1, TOXIC (≤−40) leaves only Tier 3.
  Rebuilt by completing full contracts and not missing scrims.
- **Team names**: the suffix-pool generator is deleted (it caused the repeated
  Titans/Knights/Phantoms). ~25 scrambled real orgs + **~75 hand-authored**
  literals, with an assertion that no word repeats across the roster.
- **Day = 90s** (DAY 0–75, SUNSET 75–90, NIGHT 90+).
- **Minimum room** = bed + desk + chair + PC + monitor; while incomplete, PLAY /
  TRAIN / STREAM / CASES / CAREER are blocked but SHOP, editing and sleeping
  stay open, so an empty room is recoverable rather than a soft-lock.
- **Level-4 coach deleted**; L3 VETERAN IGL is now the best.
- **Tournaments are tier-locked**, overriding SPEC-V4 §6a's higher seeds.

### V5 package status
- **P (core rules & data): DONE.** All 21 checklist items, verified by a
  headless smoke test with **61 passing assertions** (team-name uniqueness,
  reputation bands + offer gating, kick-after-3-misses, contract extensions,
  salary-follows-tier, 100+ sampled legal scorelines, energy 4-cap, case payout
  timing, save/reload round trip). Lead re-verified: L4 coach gone, mod prices
  $2k/$8k, monitor category present, all JS syntax-clean.
  - **Two consequences for the next round:**
    1. A **new `monitor` shop category** (3 tiers) now exists as a genuine 5th
       singleton. It never existed before — monitors were drawn as part of the
       PC prop — so **`iso.js` must render it** and the shop must list it.
    2. `openCase()` is a **deliberate breaking change**: it charges $7 and
       returns an *uncredited* result with a `pendingId`; the value only lands
       via `State.creditCaseReveal(pendingId)`. **Case opening pays nothing
       until Package R wires this up.**
  - STREAM's room gate could not be enforced from `state.js` (session start
    lives in `stream.js`) — handed to Package R.
- **Q, R, S: PARTIAL** — all three killed by the same session limit. Exact
  state established by inspection, and continuations dispatched:
  - **Q — DONE:** §9 EARNINGS line removed from the match card, §7 settings
    button enlarged, §8 cash-flicker fixed (`countUp` now cancels any in-flight
    animation per element via `el.__cuRaf` — the root cause was several rAF
    loops writing the same node on alternating frames).
    Then finished by a continuation: §15 PRO LEAGUE / SIGNED-UNSIGNED,
    §31 textured grass plane, §21 CAREER badge + SLEEP blocked during a pending
    tournament, §2 sheep thought bubble anchored to the bed's projected screen
    position, §5u the full room-editing rework — chair/PC/monitor movable but
    not removable, monitor rendering as its own prop family for the first time,
    4-way rotation via an exact geometric transform of each prop's box
    footprints, and the ghost-preview + ↻ROTATE / ✓PLACE flow.
    - **Bug it found:** rotating a non-rotating prop (e.g. a rug) still rotated
      its tap hit-anchor, desyncing the tap target from the art. Fixed by
      scoping hit-anchor rotation to the same set of families that actually
      redraw rotated.
    - **Gap it flagged rather than cross-editing:** the TOURNAMENTS badge lives
      in `career.js` (another package's file at the time). Closed separately
      afterwards.
  - **R — DONE** (finished by a continuation). §4 aim trainer 10s; §3
    credit-on-spin-stop in **both** `cases.js` and `stream.js` (the on-stream
    half was missing entirely — opening a case live paid nothing); §5r stream
    room gate with a "Missing: MONITOR"-style banner and a disabled GO LIVE,
    enforced defensively in `startSession()` too; §13u stop-anytime stream
    (count-up timer, STOP locked 10s with countdown, live EARNED readout,
    viewers clamped to `Data.streamViewerCap` so long sessions can't spiral
    peak viewers/follower gain). §10 needed no changes in these files.
    - Caught two bugs while rewriting: a dead `G.Stream.SESSION_MS` export
      referencing a removed variable (**would have thrown at load**), and a
      stale `followersBefore` reference in the defensive fallback branch.
  - **S — DONE** (finished by a continuation; the first attempt died while
    still reading `data.js` having written nothing). §10 wording, §24 fire/
    snowflake icons + green/red rank arrows, §6u energy 4-cap confirm +
    "CAP REACHED" tags, §12u reputation meter/band/gating with change toasts,
    §30u contract-extension card (old→new salary, raise %, promoted flag),
    §27u promotion banner, §20 single-scroll shop across all 8 sections
    including the new MONITOR category.
    - **§22u needed no code** — Package P already auto-resolves every
      non-player match when the bracket rolls, and the existing renderer
      already showed those scores. Verified visually rather than assumed.
    - **Bug it found and fixed:** its first version guarded on `if (res.ok)`,
      which silently skipped the legacy `endDay()` alias — that returns its
      summary with **no `ok` field at all**, unlike `wake()`/`skipNightAd()`.
    - **Architectural note:** `career.js` now **wraps** `State.wake`/`endDay`/
      `skipNightAd`/`tickEnergy` to catch `tierChange` for the promotion
      banner, because the wake button lives in `hub.js` (Package Q's file) and
      a second `UI.rewardCard` would clobber hub's own morning card. It renders
      an independent fixed-position banner instead. Package Q was told these
      wrappers exist so it does not add a second one or bypass them.
    - **Testing-save warning:** the shared "V4TEST" save in the browser profile
      was heavily hand-tampered during testing and is no longer in its original
      state. Use a fresh save when verifying.


## V4 — IN PROGRESS (spec: `SPEC-V4.md`)

| # | Change | Package | Status |
|---|---|---|---|
| 1 | Skip the night by watching an ad (while asleep) | L + N | L in progress |
| 2 | Train once/day; button shows today's grade | L + N | not started |
| 3 | Career ELO floors: T2 2,700 / T1 3,500 | L | in progress |
| 4 | "Counting Sheep" sleep minigame | L + N | not started |
| 5 | Sleeping always renders night + moon | N | not started |
| 6 | Packing: desk can't be packed + 10s move-out failsafe | L + N | not started |
| 7 | 100-team leaderboard, scouting offers, tournaments | L + M | in progress |

**Ordering:** L (`data.js`+`state.js`) first, then M and N in parallel.
- M = `career.js`, `teams.js`, `tournaments.js`, `css/teams.css`
- N = `hub.js`, `iso.js`, `main.js`, `sheep.js`, `css/style.css`

### V4 package status
- **L (core rules & data): DONE.** ELO floors 2700/3500, `skipNightAd()`,
  `trainingStatus()`, `sheepHit()`/`sheepStatus()`, `forceCommitMove()`, the
  100-team roster generated from a seed list, offers/signing/contracts, and the
  HLTV points model. Calibrated + verified: a rank-80 team winning Tier 3 lands
  at avg rank ~58, and a 400-sleep stress test keeps the board a clean 1–100
  permutation. Verified live in-browser by the lead.
- **M (teams UI): DONE** (finished by a continuation run after the first was
  killed by a session limit). `js/teams.js` leaderboard; `js/career.js`
  rewritten as the offers inbox with the legacy `canSign()`/`signContract()`
  "jump a tier" UI deleted — scout board with live objectives when there are no
  offers, offer cards with a colour-coded trajectory banner, contract progress
  and leave-early; `js/tournaments.js` built from the stub with the 14-sleep
  calendar, a playable round-by-round bracket, placement/prize/rank-delta
  results, Major-champion celebration and a results history.
- **N (hub/sleep): DONE** (finished by a continuation run after the first was
  killed by a session limit). TRAIN button reads `trainingStatus()`; 10s packing
  failsafe ("MOVE OUT ANYWAY — THE MOVERS WILL BOX THE REST", verified nothing
  is lost); skip-night ad replacing the COMING SOON placeholder; sleeping always
  renders night+moon (presentation-only, `wakeElapsedMs` untouched); COUNTING
  SHEEP built with **no rAF loop of its own** — hub's existing loop drives it,
  so there is nothing to leak.
  - **Desk packing bug root cause:** coincident singleton props (desk + PC on
    the same tile) shadowed each other in the hit-test. Fixed by `HIT_ANCHORS`
    in `js/iso.js` giving each prop family its own hit-test offset.
  - **Fixed Package M's reported null-data race:** `State.data` is null until a
    save loads, and ~8 `hub.js` call sites read it unguarded. Guards added at
    each, plus a re-check in the skip-night post-ad callback (the ~3s ad is real
    async time during which the player may have woken).

### V4 lead verification (all packages integrated)
Fresh tab, fresh save: all 7 screens render, **zero console errors**, all JS
syntax-clean, no raw hex in `style.css`/`teams.css`, legacy `signContract`/
`canSign` fully removed from `career.js`. Sleep verified live — night backdrop
with moon after falling asleep in daylight, sheep minigame running with both
caps shown, `SKIP NIGHT — WATCH A SHORT AD` present, `WAKE UP (LOCKED — 20S)`
enforcing the 50-energy min-sleep gate, and nav costs reading TRAIN -5 /
CASES -1.

### Logos — DEFERRED by the owner
Real procedurally-drawn canvas logos were cut; teams render as a coloured chip
with their letterform. `colors`/`letterform`/`badgeStyle` are retained on the
team data so real logos drop in later with no save migration.

Lead pre-wired `index.html` with `#screen-teams`, `#screen-tournaments`, the
`teams.js`/`tournaments.js`/`sheep.js` tags and `css/teams.css`, plus no-op
stubs, so packages never contend over it.

### Sleep-minigame (§7) — settled
**Counting Sheep**: tap to shoot sheep hopping a fence. Rejected alternatives:
dream deathmatch (too close to the aim trainer), swipe-to-herd (no shooting
fantasy). Owner chose the **form-bonus** reward over cash:
**+0.01 form per 5 sheep, hard cap +0.10**, applied to the next day and clamped
so the total never exceeds S-rank. Token cash reduced $150 → **$50/sleep** cap.
Intent: never a substitute for the aim trainer (which is worth up to +1.00).

### Salary model (§5c) — CORRECTED after a lead error
The lead initially wrote the trade-off as a global inverse rule ("lower-ranked
teams overpay, top teams underpay"). **That was wrong.** The owner clarified:
better teams pay **more**, and the tier-to-tier jump is large. The real decision
is *trajectory*, mostly within a tier:
- Baselines (owner-set, revised twice — these are final):
  T3 (51–100) $500–2,500 / T2 (21–50) $3,000–10,000 /
  T1 lower (11–20) $20,000–50,000 / **T1 elite (1–10) $50,000–250,000**.
  Tier 1 is two bands; the top ten is where money explodes.
- Known, deliberate: T3 tops at $2,500 and T2 starts at $3,000, so at the seam
  a rank-51 `declining` ($3,375) out-pays a rank-50 `rising` ($1,950). Left in —
  taking a pay cut to join a rising T2 side is the intended decision.
- `rising` ×0.65 (pays less now, rank likely climbs),
  `stable` ×1.15 (good money, going nowhere),
  `declining` ×1.35 (most money, rank likely falls — a trap).
- The crossover (a rank-80 `stable` out-paying a rank-55 `rising`) must actually
  occur, but a Tier 3 team must never routinely out-earn a Tier 2 team.

---

## V3 — COMPLETE (spec: `SPEC-V3.md`)

| # | Change | Package | Status |
|---|---|---|---|
| 1 | Real-time energy regen + sleep/beds + ad refill + day/night cycle | F (rules) + G (visuals) | F in progress |
| 2 | Lock all actions while moving out | G | not started |
| 3 | Rename END DAY → SLEEP | G | not started |
| 4 | STATS button + screen; every buff must really work | F (data) + H (screen) | not started |
| 5 | Debt warning, then game over; dead saves view-only | F (rules) + H (title) | not started |
| 6 | Train costs 5 energy; update tutorial copy | F + I | not started |
| 7 | Max-energy upgrades (drink → IV drip, caps at 200) | F + H + G | not started |
| 8 | Cases cost $5; new value ranges; hidden gold split shown as `?` | F + I | not started |
| 9 | Cases cost 1 energy off-stream, 0 on-stream | F + I | not started |
| 10 | Case price $7 (settled — see balance note below) | F | DONE |
| 11 | Remove idle income; add subscribers paying every 7 sleeps | K | queued after G/H/I |

**Packages** are now split by feature vertical, with each owning **every file it
touches** — see `SPEC-V3.md` §0 for the authoritative map. This was changed
after agents reported being blocked by files they needed but didn't own.

F = `data.js`+`state.js` (first, then frozen). Then in parallel:
G = `iso.js`/`hub.js`/`main.js`/`style.css`;
H = `stats.js`/`shop.js`/`locations.js`/`title.js`/`title.css`/`stats.css`;
I = `aim.js`/`cases.js`/`stream.js`/`minigames.css`.
Then **last**: J = `tutorial.js`/`tutorial.css` — the owner asked for the
tutorial to be touched only after everything else is finished, so its copy
describes final behaviour.
Lead keeps `index.html`, `tokens.css`, `ui.js`, `router.js`, `career.js`, docs.

### Case balance — settled, do not re-tune
Cost **$7.00**; chances 65/25/6.5/2.5/1 unchanged; values blue $0.40–2.40,
purple $3–7.40, pink $12–28, red $40–100, gold hidden split (2/3 → $90–150,
1/3 → $250–500) displayed as `?`. EV $7.31 vs $7.00 cost = **+4.4%**, near
break-even by design. Earlier iterations were +83% then +46%; the four common
tiers alone are worth $5.26, which sets a ~$5.30 price floor regardless of gold.

`index.html` was pre-wired by the lead with `#screen-stats`, the `stats.js` tag
and `stats.css` link, plus no-op stubs, so packages never contend over it.

### Package status (V3)
- **F (core rules & data): DONE.** Real-time energy, day/night phase, sleep +
  5 beds, rent-by-sleep, debt→death fail state, stats aggregation, max-energy
  upgrades, case economy ($7, hidden gold split), train 5 energy. Audit result:
  **`prestige` was the only inert stat** — now wired to stream viewers
  (+2%/point). `aim`, `stream`, `income`, `luck` were already live.
- **I (minigames): DONE.** Case cost $7, `-1 ENERGY PER OPEN`, gold row renders
  `?`, new value ranges. Fixed the real bug F flagged: `openCaseOnStream()` was
  calling `openCase()` with no args and wrongly charging energy on stream.
  Verified on-stream open costs 0 energy. Aim screen shows `-5 ENERGY`.
- **H (screens): DONE.** Stats screen as a pure renderer over
  `statsSummary()`, with a "FROM:" breakdown naming which props feed each buff.
  Shop BED + ENERGY tabs (beds singleton-equipped off the actually-placed item,
  energy tab shows running total / 200). Debt warning + GAME OVER overlays.
  Title screen: CONTINUE skips dead saves; dead slots show CAREER LOST with
  VIEW STATS + DELETE only. Locations rent copy switched to sleeps.
- **G (hub/world/shell): DONE.** Day→sunset→night gradient across all four
  backdrops with sun/moon, star fade and a whole-canvas ambient wash; global
  1s energy tick + `visibilitychange`; interactive SLEEP with locked WAKE UP
  countdown and auto-wake; disabled SKIP THE NIGHT; WATCH AD overlay +
  cooldown; four hub buttons; move-out lockout; 5 bed props + 4 energy props.
  Fixed a real infinite-recursion bug it found itself: `canWake()` ticks and
  emits `change`, and calling it from inside a `change` listener recursed until
  stack overflow (silently swallowed by State's per-listener try/catch).
- **K (subscribers): DONE** (finished by a follow-up run K2 after the first was
  killed by a session limit). Verified headless: subs persist; `idleIncome`
  gone from the stats buffs (now `subConversion`); **subs pay out before rent**
  ($0 → $650 with 400 subs at the city apartment); with 0 subs rent drives cash
  to −$350 and `debtStrikes` to 1; the 7 `income`-stat items survive, relabelled
  `SUB CONVERSION`. Conversion measured at 13% on a fresh save = 8% base + 5%
  from the starting room's one income-stat prop, i.e. the repurposed buff works.
- **J (tutorial): DONE.** Audited all 7 steps against final V3 behaviour and
  rewrote the stale ones; now 8 steps. Fixed the owner-flagged "training is
  free" line (now "Costs 5 energy") and the END DAY step (now SLEEP, no idle
  income, rent in sleeps). Also caught and fixed a **broken anchor**: step 8
  pointed at `#hub-endday-btn`, which no longer exists — the panel would have
  silently floated unanchored. Added one step covering real-time energy and the
  night regen stop, the biggest V3 change the tutorial never mentioned. Verified
  every step's spotlight rect actually wraps its target element.

<details><summary>K's original partial state (for reference)</summary>
  - DONE: `js/data.js` (subscriber constants, `income` repurposed),
    `js/state.js` (tracked `subscribers`, 8% conversion in
    `applyStreamResult()`, payout before rent, save-schema field),
    `js/stats.js` (`subConversion` buff row replaces the idle-income row),
    `js/hub.js` (floating `+$` particles removed).
  - REMAINING (package K2): `js/shop.js` relabel the `income` stat as
    subscriber conversion; `js/main.js` show subscribers in the top bar;
    `js/stream.js` show subs gained in the result card; `js/locations.js`
    surface the next payout.
  - Syntax clean across all JS after the partial run.
</details>

### Lead verification after G/H/I
Ran a fresh-tab hub entry: **no `onWakeUp` error** — G was right, H's report was
a transient mid-edit read. Hub shows all four buttons (EDIT ROOM / CAREER /
STATS / SLEEP). Day, sunset (purple/orange with warm light on the room) and
night (moon, stars, cool wash, "energy regen stopped" banner + disabled SKIP
THE NIGHT) all render correctly. Zero console errors on hub entry.

### Cross-package handoffs (the ownership map working)
- Package I found the bottom-nav CASES button in `js/main.js` still labelled
  `FREE`. It does not own that file, so it **reported instead of patching** —
  exactly the intended behaviour. Relayed to Package G, which owns `main.js`.

### Attempt log
- V3 Package F attempt 1: killed by a session usage limit before writing
  anything. Restarted clean — `data.js`/`state.js` were untouched.

Key V3 decisions: day = 300s, sunset 300–360s, night indefinite until sleep;
min sleep = 50 regenerated energy; V2 eviction **removed** and replaced by the
two-strike debt game-over.

---

# V2 PROGRESS TRAIL

All 12 requested changes are **implemented and verified**. Spec: `SPEC-V2.md`.

| # | Change | Status |
|---|---|---|
| 1 | Energy: train 0 / play 20 / stream 40 | DONE — verified |
| 2 | No money from solo matches | DONE — verified |
| 3 | Tutorial on new save | DONE — verified |
| 4 | Title screen + 3 save slots + settings | DONE — verified |
| 5 | Coaches (auto-train) + Moderators (auto-ban) | DONE — verified |
| 6 | Room expansion | DONE — verified |
| 7 | Locations, rent, moving minigame | DONE — verified |
| 8 | Scrim requires a team | DONE — verified |
| 9 | Easier early ranks, normal by Tier 3 | DONE — verified |
| 10 | Cases auto-sell, display mechanic dropped | DONE — verified |
| 11 | Stream difficulty scales with viewers | DONE — code verified |
| 12 | New case odds (1/2.5/6.5/25/65) | DONE — verified |

## How it was built

Five packages, to keep parallel agents off each other's files:

- **A — foundation** (`js/data.js`, `js/state.js`): all economy/balance rules,
  staff catalog, locations/rent, save-slot storage. Landed first; everything
  else built on it.
- **B — minigames** (`js/aim.js`, `js/stream.js`, `js/cases.js`,
  `css/minigames.css`).
- **C — title screen** (`js/title.js`, `js/audio.js`, `css/title.css`,
  `js/main.js`).
- **E — rooms** (`js/iso.js`, `js/hub.js`, `js/locations.js`, `js/shop.js`,
  `js/career.js`, `css/style.css`).
- **D — tutorial** (`js/tutorial.js`, `css/tutorial.css`). Ran last.

`index.html` was pre-wired by the lead with every script/link tag, and no-op
stub files were created for the new modules, so B/C/E could run concurrently
without contending over it.

## Verification

**Headless** (`scratchpad/verify.js` + `probe.js`, running the real
`data.js`/`state.js` in a Node VM):

- energy costs 0/20/40/20
- solo match: $1000 -> $1000 over 40 matches; signed: $10,752 over 40
- scrim rejected for free agents, +12 chemistry when signed
- early curve: +42.1 avg ELO at Silver vs +21.5 at ELO 1600
- `openCase()` returns `{value, net}`, inventory stays empty
- odds 65/25/6.5/2.5/1, summing to exactly 1
- staff upkeep charged on `endDay()`
- expansion 6x6 -> 7x7
- rent charged on day 7; evicted on day 15 after 2 misses
- `tutorialDone` survives a save/load round-trip

**In browser** (`http://localhost:8123`, 520x900): title screen -> CONTINUE ->
hub; new save auto-fires the tutorial at step 1/7 with correct spotlight
anchoring on TRAIN; locations screen shows all four with grid/rent/stream
multiplier plus the expansion card; shop STAFF tab lists 4 coaches + 4 mods
with hire cost and upkeep. Zero console errors throughout.

## Fixes made by the lead after the packages landed

1. **`tutorialDone` was silently dropped on every load.** `normalizeSave()`
   only copies keys present in `defaultData()`, and `tutorialDone` wasn't
   there. The tutorial package had worked around it by wrapping
   `createSlot`/`loadSlot`. Fixed at the source in `js/state.js`; the flag now
   round-trips.
2. **Global `AudioParam.prototype` monkey-patch removed.** The audio package
   scaled SFX volume by patching WebAudio prototypes globally, because
   `js/ui.js` was frozen for parallel safety. Once it was free, `UI.playTone()`
   now reads `Game.Audio.soundVolume()` directly and the patch was deleted.
3. **TRAIN nav button read `-0`.** Now reads `FREE` for any zero-cost action.

## Known gaps / not done

- Automation beyond coaches and moderators (auto-scrim, VOD editor, social
  manager, sponsorships, case bot, agent, energy upgrades) was proposed but
  **not implemented** — awaiting a decision.
- `Data.roomTiers` and the two legacy `room`-category lease items remain in
  `js/data.js` as dead data. Nothing reads them (`js/shop.js` filters
  `category !== 'room'`), kept only so old saves normalize cleanly.
- Stream difficulty scaling (#11) was verified by reading the implemented
  formulas and by the mod/HUD wiring, not by a timed in-browser playthrough at
  both 30 and 300+ viewers.
- The procedural music and SFX volumes were never confirmed **by ear** — no
  audio hardware in this environment. Gain math and wiring are correct.
- `mockups/` still reflects the V1 design (no title screen, locations, or
  staff screens).
