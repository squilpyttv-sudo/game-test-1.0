# CONTEXT-NOW.md — live working state

> **Purpose:** this file is the lead's working memory. It is rewritten as work
> moves, and it is the FIRST thing to read after a context compaction, before
> `PROGRESS.md` and after `HANDOFF.md`.
>
> Reading order: **`HANDOFF.md`** (the game, the rules, the constraints, the
> recurring bug patterns) → **this file** (what is happening right now) →
> `PROGRESS.md` (the historical trail).
>
> Last updated: 2026-08-09, during V20.

---

## 1. WORKING METHOD (do not deviate — this is the owner's standing instruction)

> "you work the brains of the project, sonnet agents code it for you"

The lead writes specs with concrete numbers, dispatches parallel agents with a
**disjoint file-ownership map**, and then **verifies independently by grepping
and measuring — never by trusting an agent's report.**

That verification step is not ceremony. It has caught, so far: a stomped-card
bug, a suppression flag written by nobody, a permanently-latched button, several
contrast failures below 4.5:1, a comment that falsely claimed a rule worked, and
multiple "done" claims that were simply false.

**Standing owner constraints:**
- **`/impeccable` on every design change, without exception.** Agents must be
  told to invoke the skill by name — embedding craft-floor rules in the brief is
  NOT sufficient. The owner corrected this once already: *"dont forget to use
  /impeccable on all design agents"*.
- **Model policy (current):** *"use sonnet 5 agents for coding on high, use opus
  5 on low for design."*
- *"Try to use up the least amount of usage limits and credits as possible, but
  dont let this be a limiting factor if it means a lower quality design."*
- Order agent checklists **smallest-item-first**, so a session-limit kill banks
  real progress instead of losing a half-finished large item.

---

## 2. WHERE THINGS STAND RIGHT NOW (V20)

Build state: **all JS syntax-clean · zero raw hex outside `tokens.css` · suites
34 / 16 / 17 / 19 / 15 / 16 all green.**

### Landed and verified
- **Package R** (`js/data.js`, `js/state.js`) — all V20 rules: windows, LED
  `noCollide`, blinds, banner/neon merchandise buff, FLOOR LED SCREEN rename.
  Exports added: `State.isCustomisable()`, `toggleBlind()`, `isWindowTile()`,
  `blindsBonusActive()`, `merchandiseBonusPct()`, `effectiveSleepRate()`,
  `wallFootprintTiles()`.
- **Package L** (`js/cases.js`, `js/stream.js`, `css/minigames.css`) — GO LIVE
  button. Diagnosed the `.mg-start-btn` blur as **three** separate causes
  (inherited `text-shadow`, a fractional 114.984375px box width straddling two
  device columns, and `filter:` forcing its own render surface).
- **Package H** (`js/hub.js`, `js/main.js`, `css/style.css`, `js/tutorial.js`) —
  died on a session limit but had **already landed everything except one
  relayed item**: bed-tap sleep (`hub.js:1778` → `main.js:955`), header sleep
  key deleted, onboarding step 5 retargeted at the bed, bed pulse under 20%
  energy (`hub.js:1667`, a self-gating canvas outline), and the CUSTOMISE disc
  with paint/LED icon variants.
- **Shop reachability (lead, by hand).** `js/shop.js`'s `CATEGORY_ORDER` is a
  hand-written array and nobody added `'window'` / `'blind'` to it — so all
  five new items existed, priced and specced, **with no tab to reach them
  from.** Fixed, plus `CATEGORY_LABEL`, two authored `CATEGORY_ICON` SVGs, and
  stat chips (windows show wall-tile span; blinds show the sleep bonus
  **derived from `Data.blindsSleepBonusPct`**, not typed as "15%").
  A permanent regression guard now asserts the *relationship* — every
  `Data.shopItems` category must have a tab, label and icon — so any future
  category added without a tab fails the suite instead of a playtest.

- **Package W** (`js/iso.js`) — hit the session limit mid-narration but its
  code all landed and is verified: built-in windows removed, propMap entries
  for all five new ids, `window` + `blind` prop families, and LED z-order
  derived from `noCollide` (-0.9, behind everything). Measured: all five
  props paint; windows carry real partial alpha; day/night moves the room
  mean 108 colour units; a closed blind darkens it 54; black vs wood rims are
  136 apart. The glass single-pass fix it was mid-way through is DONE (the
  band partition is non-overlapping — overlapping 0.82 twice composites to
  0.97 and shows as an opaque seam).
- **Package G** (`css/*`) — done. Disabled is now an inverted ramp
  ("THE DEAD KEY", end of `style.css`) instead of a filter. Four new tokens
  (`--dead-fill/-shade/-rim/-ink`). Every disabled label measured ≥ 4.5:1;
  worst prior states were **1.54:1** (STREAM nav) and **2.11:1** (danger
  button), now 7.35:1. All four contrast claims re-verified independently.
- **Lead fixes:** the `phone.css` pager button joined the dead-key language
  (it was `opacity:.35`, 2.43:1); and the step-8 tutorial spotlight now
  anchors to the BED via `Hub.bedScreenRect()` instead of the whole canvas —
  9.8% of the canvas instead of 100%.

### In flight
- Nothing. Session limit resets 9:30pm; no agents can be dispatched until then.

### Known-outstanding
- **CUSTOMISE is an intentional stub** — `hub.js:1076` toasts "CUSTOMISATION IS
  COMING SOON". The paint modal and LED colour-picker modal were deliberately
  deferred to their own package. **This is the next feature package.**
- `js/sheep.js` — Package S died during *verification*, not mid-write. The file
  is complete and syntax-clean. The two defects a previous agent reported
  ("head reads as a detached wedge, hooves sink below the ground line") are
  **unconfirmed** — they may already be fixed. Needs pixel-level checking.
- `css/teams.css:1223` still has `filter: grayscale(.6)` — outside Package G's
  ownership, deliberately.
- Unicode glyphs still used as icons: `career.js:296` (`✉`), `crypto.js:341`
  (`▲▼`), `crypto.js:378` (`✓✗`), `tournaments.js:430` (`↑↓`), plus `hub.js`,
  `locations.js`, `title.js`.
- `.mg-back` hand-rolls its keycap instead of carrying `.btn` (markup fix in
  `js/aim.js` / `js/hub.js`).
- Three `color-mix()` values in the header, awaiting a decision on whether they
  become real tokens.
- `js/shop.js:143` hardcodes the singleton category list, which `js/hub.js:872`
  gets from a `State` export with a named fallback. Second copy of one rule —
  the exact pattern that has caused four user-visible bugs. Worth unifying.
- Never built: night-based progression, and late-game content past the T3→T1
  gate (seasons / rivals / burnout).

---

## 3. TRAPS THAT HAVE COST REAL TIME (read before debugging anything)

1. **`normalizeSave()` only copies keys present in `defaultData()`.** Any new
   persisted field missing from it is **silently dropped on load**. This has
   shipped broken **five or more times**.
2. **`propMap` in `js/iso.js` has no entry → the prop renders completely
   invisible.** `drawFamily()` silently no-ops on a missing key. Hit V15 (all
   four regen items) and again in V20 (four windows + `blind_slat`).
3. **Single source of truth.** When two places need one rule, export it from
   `state.js` and derive. Four user-visible bugs came from a stale second copy.
4. **The preview pane is often not compositing** (`document.hidden === true`),
   which freezes `requestAnimationFrame` and makes perfectly good UI look
   frozen or blank. Confirm with
   `let n=0; const f=()=>{n++;requestAnimationFrame(f)}; f();` → 0 ticks means
   the pane, not the code. Two agents and the lead have each lost time to this.
   Use offscreen canvas + pixel inspection instead.
5. **`test-v15-rules.js` is KNOWN-SLOW** — minutes, not hung. Do not kill it.
6. **Comments can lie.** `minigames.css:701` carried a comment claiming a rule
   kept a label legible "against that filter"; measured, it did not. Measure,
   don't read.
7. **Harness-call mistakes the lead has personally made** — check the signature
   before concluding a bug exists: `openCase({caseId})` not `openCase(id)`;
   `Iso.renderPropIcon(canvas, id)` takes a **canvas**, not a ctx;
   `State.wake({force:true})` returns `{ok:false}` when already awake (use
   `State.endDay()`); and always reload the page after an agent writes.
8. **Test the real path.** The Gold Nova tutorial bug lived entirely inside
   `doPlayMatch()`; testing `State.playMatch()` directly bypassed it and made
   the bug invisible. The owner caught this, not the lead.

---

## 4. FILE OWNERSHIP MAP (V20)

| File | Owner | State |
|---|---|---|
| `js/data.js`, `js/state.js` | R | done |
| `js/cases.js`, `js/stream.js` | L | done |
| `js/hub.js`, `js/main.js`, `js/tutorial.js` | H | done (agent died after landing) |
| `js/shop.js` | lead | done |
| `js/iso.js` | W | done (verified) |
| `css/style.css`, `css/tokens.css`, `css/minigames.css` | G | done (verified) |
| `js/phone.js`, `css/phone.css`, `js/tutorial.js` | lead | done |
| `js/sheep.js` | S (dead) | written, **unverified** |
| `css/teams.css` | — | unowned |

### Next up, in priority order
1. **The CUSTOMISE modals** — the paint picker and the LED colour picker.
   `hub.js:1076` still toasts "CUSTOMISATION IS COMING SOON". Note that R
   added **no colour persistence at all** — `isCustomisable()` only reports
   capability — so this package must add a persisted per-placed-item colour
   AND add it to `defaultData()`, or `normalizeSave()` drops it on load
   (trap 1). This is the biggest remaining feature gap.
2. ~~Verify `js/sheep.js`~~ — **DONE, both defects fixed.** Verified
   mechanically, not by eye: the sprite bitmap is 232 solid cells forming
   ONE connected component with all 21 face cells reachable from the body,
   so the head is attached (no "detached wedge"). Hooves: grounded
   (`tuck=0`) `oy = -17c`, `legTop = -5.2c`, `legLen = 5.2c` → the leg bottom
   lands at exactly `0`, the ground line, and the hoof block spans `-1c…0`.
   Squash-and-stretch scales about that same origin, so `y=0` is a fixed
   point and compression cannot push hooves under the line either.
   NOTE: diffing two rendered frames to isolate the sheep does NOT work —
   `start()` re-seeds background RNG, so grass tufts differ between frames
   and contaminate the diff. Verify this sprite by bitmap/arithmetic instead.
3. ~~Disabled buttons are keyboard-activatable~~ — **DONE.** `UI.setDisabled`
   (`js/ui.js`) is now the one way to disable a control, and all 20 sites
   across 9 files call it. Real form controls get the native `disabled`
   property; DIV "buttons" (`tournaments.js`, the `main.js` nav tiles) get
   `aria-disabled` + `tabindex="-1"` with the original tabindex stashed and
   restored. Verified both branches: a disabled button reports
   `disabled === true`, is not focusable, and fires **0** click handlers
   while disabled vs 1 after re-enable.
4. Unicode glyphs used as icons — **dispatched (Package I)**, opus +
   `/impeccable`, owning `career.js`/`crypto.js`/`title.js`/`tournaments.js`/
   `style.css`. 9 sites are real icon duty. Deliberately EXCLUDED as
   typographic, not icons: `cases.js:525` (a minus sign inside a formatted
   number), `career.js:579` and `locations.js:76` (arrows inside prose
   sentences), and every occurrence inside a comment.
   NOTE: `grep -P` with `\x{...}` above the BMP errors out on this box — scan
   for glyphs with node and `/[←-⯿️]/` instead.
5. ~~`.mg-back` hand-rolls its keycap~~ — **DONE.** `js/aim.js`,
   `js/cases.js` and `js/stream.js` now emit `class="btn mg-back"`, and the
   duplicated outline/bevel/drop/press was deleted from `css/minigames.css`.
   `background` deliberately STAYS — it is the fill the `::before`/`::after`
   ramp strips derive themselves from. Measured: ramp now
   `brightness(1.42)`/`brightness(0.48)`, box-shadow identical to a reference
   `.btn`. Also fixed a pre-existing defect found while measuring — the tap
   target was **61x31**, 13px under the 44px floor, on the only way out of a
   minigame. Now 65x44 on all three screens with no header growth.
6. `css/teams.css:1223` — the last `filter: grayscale()`. G measured it and
   contrast is genuinely fine (grayscale preserves luminance); the only cost
   is putting a text-filled card on its own render surface. Low priority.

`css/tokens.css` is normally lead-owned; it is lent to G for this pass because
the disabled treatment lives there.

---

## 5. VERIFICATION COMMANDS

```bash
cd "C:/Users/User/Desktop/hujnia" && for f in js/*.js; do node --check "$f" >/dev/null 2>&1 || echo "SYNTAX FAIL: $f"; done
```

```bash
cd "C:/Users/User/Desktop/hujnia" && grep -n "#[0-9a-fA-F]\{3,6\}" css/*.css | grep -v "^css/tokens.css" | wc -l
```

Expected suite counts: `test-v20-customise` 34 · `test-v12-footprints` 16 ·
`test-v13-rules` 17 · `test-v14-phone` 19 · `test-v15-banners` 15 ·
`test-v16-rooms` 16 · `test-v15-tutorials` 26 · `test-v15-rules` 26 (slow).
