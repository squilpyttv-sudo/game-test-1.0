# TASKS REMAINING — CS2 PRO SIMULATOR

> Companion to `HANDOFF-V2.md`. That document explains the project, the rules
> and the traps; this one is the queue.
>
> Ordered by value. Items 1–3 are things the owner has already asked for.
> Items 4+ are things I found and the owner has not yet ruled on.

---

## STATE AS OF 2026-08-10 — READ THIS FIRST

**No work in flight. All 10 suites green, build clean, 25 files syntax-clean,
zero raw hex outside `tokens.css`.**

| suite | count |
|---|---|
| `test-v22-fixes.js` | 47 |
| `test-v21-customise.js` | 18 |
| `test-v20-customise.js` | 38 |
| `test-v12-footprints.js` | 16 |
| `test-v13-rules.js` | 17 |
| `test-v14-phone.js` | 20 |
| `test-v15-banners.js` | 15 |
| `test-v15-tutorials.js` | 26 |
| `test-v16-rooms.js` | 16 |
| `test-v15-rules.js` | 26 *(slow, ~5-6 min)* |

**From the original queue below: items 3, 4, 5, 6 and 7 are DONE.** What is
still open there is **#1 and #2** — late-game content and night-based
progression — both of which need a design conversation with the owner before
any spec is written. Do not invent an economy for either.

**The owner's separate 15-item bug list is ALSO complete** — see the V22
section immediately below.

### Owner decisions already made — do not re-ask

1. **`mockups/` stays on disk as history.** Do not delete it.
2. Queue item 3 was fixed by moving the room, not the sheet — see that section
   for why a literal camera *pan* is impossible here.
3. Sponsors expire on a fixed term rather than being droppable at will.
4. The PC gets its own tile; old saves migrate on load.

---

## V22 — THE OWNER'S 15-ITEM LIST — **ALL DONE**

Delivered in five batches, each left at a green checkpoint. Regression cover
for every item is in **`test-v22-fixes.js`** (47 checks) — add to that file
rather than starting a new one.

| # | Item | Where |
|---|---|---|
| 1 | Sponsors run a 1-3 week term, then free the slot | `state.js`, `data.js` |
| 2 | Three cases with distinct contents + 16x16 sprites | `data.js`, `cases.js`, `minigames.css` |
| 3 | Stream payout popup under-reported | `state.js`, `stream.js` |
| 4 | Sponsor stream obligations: minutes → seconds | `data.js`, `state.js`, `sponsors.js` |
| 5 | Phone available from the start; apps gated | `state.js`, `data.js`, `tutorial.js` |
| 6 | Tournaments every 4-7 days | `state.js`, `data.js` |
| 7 | T1/T2 finals are Bo3 | `state.js`, `data.js`, `tournaments.js` |
| 8 | `undefined/WK` on social managers | `shop.js`, `social.js` |
| 9 | Overtime only from 12-12 | `tournaments.js` |
| 10 | Round pips no longer leak the final score | `tournaments.js` |
| 11 | Tier 1 gate: 100 hype + 90 chem + T2 contract | `state.js`, `data.js` |
| 12 | Rug redesign, underlay placement, dyeable | `data.js`, `state.js`, `iso.js` |
| 13 | Bed outlines itself; night triggers it too | `hub.js` |
| 14 | Return to phone inventory after placing | `phone.js`, `hub.js` |
| 15 | PC gets its own tile, with save migration | `state.js`, `data.js` |

---

## V22b — THE OWNER'S SECOND LIST (9 ITEMS) — **ALL DONE**

| # | Item | Where |
|---|---|---|
| 1 | Career starts on the PLYWOOD desk | `data.js` |
| 2 | Room starts EMPTY; onboarding's FURNISH step places it | `data.js`, `tutorial.js` |
| 3 | Flatpack desk's detached "grey box" drawer removed | `iso.js` |
| 4 | PC back on the desk tile — back half, drawn behind | `state.js`, `data.js`, `iso.js` |
| 5 | More zoom-out in every room bigger than the basement | `hub.js` |
| 6 | HYPE driven by tournament matches, harder to gain | `data.js`, `state.js` |
| 7 | LEAVE TEAM EARLY label no longer blurred | `style.css`, `teams.css` |
| 8 | ASLEEP panel no longer squishes the room | `style.css` |
| 9 | Fan grille no longer drifts with zoom | `iso.js` |

### The two that changed shared rules — read before touching either

**Item 2 emptied `Data.defaultPlaced`.** A new career is therefore ROOM
INCOMPLETE until the player furnishes it, which gates PLAY/TRAIN/STREAM/CASES/
signing (SPEC-V5 §5r). SHOP, room editing and sleeping stay open, and the
tutorial's FURNISH step will not advance until the room is complete, so nobody
gets stranded. `Data.starterLayout` keeps the old arrangement as the canonical
"standard room" — **every test suite calls a local `furnish(win)` helper that
applies it**; if a new test asserts anything about a furnished room, call that
helper rather than assuming the default.

**Item 4 reversed item 15 from the first list.** The PC shares the desk's tile
again. The original complaint was never "it shares a tile", it was that the
tower OVERLAPPED the desk and monitor art — fixed properly this time:
`props.pc` stands in the tile's BACK half (`y 0.10..0.46`) while every desk
tier occupies the front (`y >= 0.50`), and `CATEGORY_ORDER` sorts `pc` at 0.5,
behind desk (1) and monitor (2.5). A workstation rotates as a group, so the
front/back split holds at all four rotations. `migratePcOwnTile()` is deleted;
a save whose tower was moved to its own tile is still legal and is left alone.

### Also worth knowing

- **HYPE now lives entirely in `Data.hype`** — nine entries, including the
  kicked-off-team penalty. There are no hardcoded hype deltas left in
  `state.js`, and a test asserts that stays true.
- **A tutorial step can gate NEXT** via `waitFor()` (+ `waitLabel`), polled
  every 250ms and cleared in `stop()`. It uses `UI.setDisabled`, never a
  CSS-only fade (§5.5). The overlay is `pointer-events:none`, which is what
  makes an interactive step possible at all.
- **`css/teams.css` trips the design hook's `side-tab` rule four times.** They
  are FALSE POSITIVES: every one is `box-shadow: inset`, not a border, and V18
  deliberately made that change for the exact reason the rule exists. Do not
  "fix" them. There is also a real `bounce-easing` finding at teams.css:659
  (a career popup overshoot) left unchanged as out of scope.

### Things that will bite you if you forget them

- **`stream_minutes` counts SECONDS.** The id is a legacy save key. Same trick
  as `lucky_mousepad` and the `phone_unlock` tutorial id: an id written into a
  save is never renamed, only redocumented.
- **`d.phoneUnlocked` gates nothing.** The handset is always available; use
  `d.socialAppUnlocked` / `d.sponsorsAppUnlocked`. Several tests were seeding
  the old flag and silently getting no sponsor offers at all.
- **`Customise`/sheet callbacks pass `null` to clear, never `0`.** Zero is a
  valid viewport coordinate meaning "covers everything".
- **Sprites are gun silhouette × finish.** Two skins sharing a gun+finish pair
  render pixel-identical tiles; a test now guards that.
- **A warned sponsor week does not burn down its term** — otherwise failing an
  obligation would be better than meeting it.

---

## V22d — THE 15-SECOND ACTIVE MATCH — **DONE**

PLAY no longer resolves instantly behind a cooldown. It opens
**`js/matchgames.js`** (`Game.MatchGames`): a 15s master timer and one of three
CS-themed minigames, picked at random with no immediate repeat.

| Game | Verb | Wins when |
|---|---|---|
| `awp` | one reaction **tap** | you fire within 300ms of the peek (peek at 1.5–3.5s) |
| `spray` | one continuous **drag** | you land 80% of the AK's 30 rounds |
| `bhop` | alternating rhythmic **taps** | you reach Outside on the Nuke route |

### The spray is TWO ZONES, and the split is load-bearing

Top 60% is the visual zone (brick range, wooden dummy, first-person AK,
crosshair). Bottom 40% is the control pad, and the compensation line lives
**entirely inside it**. The first version drew that line across the dummy, so
the player's own hand covered the thing they were aiming at — if you ever find
yourself moving the guide back up, that is the bug you are reintroducing.

- `AK_PATH` is authored in **pad fractions**, and one array feeds the dotted
  guide, the pacing node and the scoring. A second copy is how a guide ends up
  describing a different test from the one being run.
- `drift()` is the single error measure: it decides whether a round hits AND how
  far the crosshair is thrown. What the player sees is what they are graded on.
- 30 rounds at `AK_SHOT_MS` 100 = exactly the 3s the pacing node takes.
  `AK_RUN_MS` is derived from both so they cannot drift apart.
- Lifting off does not end the run early — the magazine empties on its own
  clock and a player who lets go just misses the rest.

### The bhop rhythm SWEEPS

The marker runs left, then back right, and each traverse is one strafe. There is
no separate "which side is next" state: the direction of travel **is** the side
to tap, so the two cannot desync.

- The period scales with speed (`BH_BEAT_SLOW_MS` 760 → `BH_BEAT_FAST_MS` 430),
  so going faster is something you earn rather than just a bigger number.
- `phase` is **accumulated**, never `now() % period` — the period moves, and a
  modulo of a moving divisor teleports the marker every time speed changes.
- `advance()` is idempotent and is called from the pointer handler and the probe
  as well as `update()`. A tap judged against a phase one throttled frame stale
  is judged against a marker the player is not looking at.
- `BH_COAST_DROP` (18) is deliberately **smaller** than the +26 a good jump
  gains. At 40 the penalty outweighed the reward and anything under ~61%
  accuracy could never climb at all.

Win → the bar snaps to 100%, holds 1.5s, then the ELO card. Fail → TRY AGAIN
(only while >900ms remains) / QUIT. Timer hits zero → force-close, ELO card
anyway.

**The minigame decides how FAST a match resolves, never WHETHER it is won.**
`State.playMatch()` rolls ELO in `doPlayMatch()` *before* the overlay opens, so
the player can never finish a minigame and only then be refused for energy or an
incomplete room — and the minigame can never become a difficulty gate on core
progression. Keep that ordering.

### Things in here that are easy to break

- **Three input verbs on purpose.** A rotation of three games that all wanted
  the same gesture would read as one game with reskins.
- **Wall-clock, not frame-accumulated.** The spray's rounds, the bhop's beat and
  the master timer all read `Date.now()`. A dt accumulator time-dilates the
  moment the frame rate drops, and the recoil guide would drift out of step with
  the rounds it describes. `bhop`'s *distance* is the one dt integral left, and
  it is why a throttled tab makes that run crawl.
- **The bhop track length is derived from `BH_PATH`**, not typed twice. Its
  ~3492 units are tuned so a clean run lands ~9.4s and someone mashing, stuck at
  `BH_MIN_SPEED`, needs 15.3s and *loses*. A test asserts both ends; reshaping
  the route without re-checking it silently makes the game free.
- **Art is drawn from the owner's reference shots.** `awp` is scoped mid doors
  on Dust 2 — the gap is derived from the scope centre (`gapX = w/2 - gapW/2`)
  so the reticle is always on it. `bhop` is top-down Nuke, textured as the
  plant: asphalt, concrete, hazard hatching, containers, the Cedar Creek blue
  band, the ribbed silo.
- **The bhop map is authored ROTATED 90°** so the run goes up-screen on a
  portrait phone. Real map north is therefore screen-LEFT — that is why MAIN
  sits left of the route and T RED right. Baking the rotation into the data
  (instead of yawing the camera) keeps every rect axis-aligned and pixel-crisp.
- **Structure must stay darker than every walkable surface.** The first pass
  used near-identical greys for the roof deck and the outdoor concrete and the
  route stopped reading as a route. A test compares their luminance.
- **`sizeCanvas()` measures the CANVAS, not the overlay.** The canvas sits below
  the timer bar and label; measuring the overlay gave the backing store more
  rows than the element shows and the browser squashed every frame.

### Environment — this bit the last session, twice

- **Node IS installed** (v24.19.0, `C:\Program Files\nodejs`) but is **not on
  the agent tool-shell PATH**, so bare `node`/`npx` fail. Prefix every command:
  `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; node ...`
  With that prefix the suites and `node --check` all work normally.
- Python is **not** installed, so it is not a fallback for anything.
- The project moved to `C:\Users\afgus\Downloads\mainhujnia\hujnia`.
  `HANDOFF-V2.md` §1 still names the old Desktop path.
- **It IS a git repo now**, pushed to `squilpyttv-sudo/game-test-1.0` and served
  by GitHub Pages. `inspo/` and `.claude/skills/` are excluded; there is
  deliberately no LICENSE, so all rights stay reserved.
- HANDOFF-V2 §5.6 needs amending: `screenshot` **does** work. What actually
  breaks is that **rAF is throttled to roughly 1fps whenever the Browser pane
  is not being composited** — so anything driven by frame deltas crawls between
  tool calls while wall-clock timers run on normally. To inspect a later frame,
  stub `requestAnimationFrame` and pump it with a synthetic clock rather than
  waiting for the game to get there.

### `/impeccable` is installed but needs a session restart

`npx --yes impeccable install` put the skill at **project scope**
(`.claude/skills/impeccable/`, v4.0.4) and wired two hooks into
`.claude/settings.local.json` (PostToolUse on Edit/Write/MultiEdit, and Stop).
Its own `doctor.mjs` reports no drift, and the hooks were observed firing.

Skills are enumerated at session start, so it does **not** register in a
session that installed it — `Skill(impeccable)` returns "Unknown skill" until a
restart. **#3 and #4 are both design changes and the owner's standing rule is
that `/impeccable` must be invoked BY NAME on every design change**, so they
were deliberately left for a restarted session. Verify it resolves before
starting them.

---

## 1. LATE-GAME CONTENT (owner asked, never built)

The biggest genuine gap in the game. Raised in the V15 list ("late-game
content") and still untouched. Right now the T3 → T1 team ladder is the whole
arc, and once a player tops it there is nothing left to pursue.

Ideas the owner floated, none decided: **seasons**, **rivals**, **burnout**.
None of these are specced. **This one needs a design conversation with the
owner before any agent is dispatched** — do not invent an economy for it.

## 2. NIGHT-BASED PROGRESSION (owner asked, never built)

V15 list item 9. Also never specced, also needs the owner's intent before it
is turned into a spec. The current day/night cycle drives energy regen and the
room's lighting but is not itself a progression axis.

## 3. THE CUSTOMISE MODAL COVERS THE PROP IT IS EDITING — **DONE**

Both halves fixed, and verified end-to-end through the real 600ms hold gesture
rather than by calling the modal directly (HANDOFF-V2 §5.8).

**Measured, at 420x860, on the front-most tile (3,3) — the worst case:**

| | neon sign, canvas y | sheet top at y=432 |
|---|---|---|
| before | 569–627 | **entirely hidden** |
| after | 387–432 | **fully visible**, flush to the edge |

**How.** `js/hub.js` gained `Hub.setSheetTop(viewportY)`; a bottom-docked modal
reports where its top edge is and passes `null` on close. `getCamera()` then
frames the room into `canvasH - inset` instead of the full height.

**Why not a pan** — this matters if you ever revisit it. A raw pan *cannot*
work: `getCamera()` forces `view.panY = 0` whenever the room already fits the
canvas, which at ZOOM_MIN is the normal case, so any externally-written pan is
clamped straight back to zero on the next call. Shortening the viewport works
*with* that clamp instead of against it.

Lifting alone was still not enough — the room projects taller than the 432px
left above the sheet, so the prop stayed 34px behind it. `getCamera()` now also
scales to fit while a sheet is up. That deliberately overrides `view.zoom` for
the duration; `view.zoom` itself is never written, so the player's zoom returns
intact on close.

**No `Hub.propScreenRect()` was added.** Reframing clears *every* prop, so
nothing needed to know which one was being edited. `bedScreenRect()` reads
`getCamera()` and so follows the lift for free.

The context-menu discs now hide while a sheet is up, driven off the same
`sheetInset.target` that `setSheetTop()` writes rather than a second flag
(HANDOFF-V2 §5 lists "a suppression flag written by nobody" as a real bug).
Verified with `pending` still set, so it is genuinely the new guard firing.

**Two bugs measurement caught during the work, both now fixed** — worth reading
before touching this code:

1. Passing the card's *height* over-lifted the room by the 97px of card that
   hangs below the canvas. The sheet reports its top edge; the hub works out
   the overlap, because that is a fact about the canvas.
2. `close()` passed `0`, and `0` is a legitimate viewport y meaning "covers
   everything" — so closing left the room fully lifted (inset 487 instead of
   0). It passes `null` now. **Do not "simplify" that back to 0.**

Also note `card.getBoundingClientRect().top` is 18px off at open time, because
`cust-rise` starts at `translateY(18px)` with `fill-mode: both` and rects apply
transforms. The settled top is derived from the un-animated backdrop instead.

## 4. `css/teams.css` — THE LAST `filter: grayscale()` — **DONE**

Gone. There are now **zero** live `filter: grayscale()` declarations in the
game; every remaining match in `css/` is a historical comment.

The original note was right that contrast was never the problem here. What the
fix turned on was working out what the filter was actually *for*: a locked card
returns early in `js/social.js` (`buildPlatformCard`, ~line 84), so it contains
only the name, the LOCKED chip, two `--ink-dim` lines and the unlock meter.
Every one of those is already a neutral ink token, and the brand accent stripe
was already overridden to `--ink-dim` on the very next line.

So the filter was desaturating exactly **one** element — the meter's `--views`
fill — and charging a whole compositing layer for an entire text-filled card to
do it. That layer is the mechanism behind the `.mg-start-btn` blurring.

Replaced by naming that one element: `.social-card--locked .meter__fill` takes
`--dead-ink`, which is the dead-key read (chroma removed, not lightness dimmed)
and still an unmistakable progress bar. No third treatment invented.

## 5. THE ROOM/`roomTiers` DEAD DATA — **DONE**

`Data.roomTiers` is **deleted**, with a tombstone comment where it sat so
nobody re-adds it thinking it was an oversight. Stale comments in `js/iso.js`
(two) and `VISUAL-MAP.md` that described it as merely "unused but left in
place" are corrected.

Two things were deliberately KEPT, and the tombstone says why:

- `State.data.roomTier` — a dead scalar in `defaultData()`, kept so old saves
  normalise cleanly. `State.buyItem` still writes it; nothing reads it.
- the two `category:'room'` lease items — unreachable, since `js/shop.js` and
  `js/phone.js` both filter that category out, but kept so an old save that
  already owns one still resolves its def.

One correction to the original note above: it claimed "nothing reads them",
but `js/state.js:4649` does still read `def.category === 'room'` and
`def.roomTier` on purchase. That path is unreachable through the UI rather
than absent, which is why the lease items stay.

Watch out for the name collision this leaves: `roomTier` is still a **local
parameter name** in `js/iso.js` (`computeCamera`/`drawFloor`/`drawWalls`/
`wallTexture`) holding a `LOCATION_VISUALS`-derived object. Renaming those is
cosmetic and was not done.

## 6. `mockups/` IS THREE MAJOR REDESIGNS OUT OF DATE

Still reflects the V1 design — no title screen, locations, staff, phone, or
any of the V16/V18 pixel-UI work.

**Partly handled.** The owner ruled: keep it as history, do not delete. A stale
banner now sits at the top of `mockups/index.html` (inline styles, so it
survives edits to `mockups.css` and adds no colours to a stylesheet), and the
`<title>` is prefixed `[OUTDATED V1]`. It no longer misinforms at a glance.

**Still open:** actually regenerating the gallery against the current V21
design. That is a large job and wants its own spec'd package — do not bundle it
into an unrelated batch.

## 7. VERIFY THE V21 CUSTOMISE FEATURE END-TO-END — **MOSTLY DONE**

Driven as one continuous pass at 420x860 over HTTP. What was exercised through
the genuine code path, with results:

- **hold to edit** — a real 600ms pointer hold on the canvas over tile (3,3)
  set `pending = {defId:'neon_sign', moveIdx:5, groupIdxs:[5]}` and raised all
  four discs. This is the path HANDOFF-V2 §5.8 warns about; calling the modal
  directly bypasses it, so it was tested properly.
- **CUSTOMISE disc** — opened via a real `pointerdown` (the discs bind
  `pointerdown`, **not** `click`; a `.click()` silently does nothing).
- **opens showing the applied colour** — `session.current` came back
  `#00FF88`, not null, as designed.
- **pick a colour** — clicked a swatch through its own DOM handler;
  `itemTint(5)` became `#00FF88` and the selection mark moved to it.
- **it renders** — differential pixel measurement against the factory frame:
  green channel **+378,897**, red **−70,125** across the canvas.
- **survives reload** — full page reload, resumed via CONTINUE; the entry came
  back as `{"id":"neon_sign","x":3,"y":3,"rot":0,"tint":"#00FF88"}`.

**Two steps NOT done as a player**, and honestly they are the two that matter
least — both are covered by existing suites:

- the purchase went through `State.buyItem('neon_sign')` rather than the shop
  UI (shop reachability has its own regression test — see the
  `CATEGORY_ORDER` assertion in `test-v20-customise.js`);
- no **sleep** cycle was run between applying the colour and reloading. The
  reload alone already proves the save path, and `test-v21-customise.js`
  covers the tint round trip in a fresh VM.

Anyone wanting to close this out fully: buy one in the shop, sleep, reload.

---

## THINGS DELIBERATELY *NOT* ON THIS LIST

Recording these so nobody "fixes" them later:

- **`js/cases.js:525`** uses `−` (a real minus sign) inside formatted money
  (`−$1,200`). That is correct typography, not a stray glyph.
- **`js/career.js:623`** and **`js/locations.js:76`** use `→` inside prose
  sentences (`TIER 3 → TIER 2`, `500 SUBS → $120`). Prose, not icons.
- Arrows and ticks inside **comments** (`js/hub.js`, `css/style.css`, and the
  explanatory comments the icon package left in `career.js` / `crypto.js` /
  `title.js` / `tournaments.js`). Comments are not rendered.
- **The bottom-right corner tile** is no longer reserved. That was an obsolete
  SPEC-V3 rule removed in V19 after the owner reported it; it is not a
  regression if you see a prop there.
- **`normalizeSave()` does NOT need per-entry `placed` fields added to
  `defaultData()`.** See `HANDOFF-V2.md` §5.1 — the famous trap applies to
  top-level keys only. Adding a top-level mirror of a per-item field would
  introduce the *second-copy* bug instead.
