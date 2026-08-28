# HANDOFF V2 — CS2 PRO SIMULATOR

> **Read this first, then `TASKS-REMAINING.md`.** Together they are everything
> needed to pick this project up cold.
>
> This supersedes `CONTEXT-NOW.md` (a scratch file from one session) and brings
> the original `HANDOFF.md` up to date through **V21**. The original is still
> worth reading for pre-V20 history and the full balance numbers; where the two
> disagree, **this document wins**.
>
> Project root: `C:\Users\User\Desktop\hujnia`
> State as of writing: **all suites green, build clean, no work in flight.**

---

## 1. WHAT THIS IS

A 2D isometric esports-career tycoon game. You play a CS2 pro: train aim,
play matches, stream, open cases, trade crypto, sign with teams and sponsors,
and furnish the room you do it all in. Portrait, mobile-first, 420x860.

It is **vanilla JavaScript with no build step**. That is not an accident and
must not be "modernised".

## 2. HARD CONSTRAINTS (breaking any of these breaks the product)

1. **Vanilla JS only.** No ES modules, no `import`/`export`, no bundler, no
   dependencies, no framework. Classic `<script>` tags; every file is an IIFE
   attaching to the `window.Game` global.
2. **It must run from `file://`.** This is *why* there are no modules — the
   owner opens `index.html` directly. Never introduce anything requiring a
   server at runtime. (A local server is used only for *testing*, see §7.)
3. **No external assets — with ONE exception, added V22b.** All art is drawn on
   canvas in code. No image files, no webfonts, no CDN. **SFX are still fully
   synthesised.** The exception is **background MUSIC**: `music/` holds three
   `.mp3` tracks the owner wrote for the game, shuffled by `js/audio.js`.
   - They are played through a single reused **`HTMLAudioElement`**, never
     WebAudio's `decodeAudioData` — that needs `fetch`, which is blocked on
     `file://`, and constraint 2 above still stands.
   - One element, reused for every track, because iOS unlocks audio
     per-element on the first gesture-initiated `play()`.
   - `preload='none'`: only the playing track is buffered. The three files are
     ~5.5MB together and playtesters are on mobile data.
   - This is the ONLY asset exception. Do not read it as permission to add
     images or fonts.
   Also added V22b for mobile: `manifest.json` + `icon.svg` (authored SVG, same
   policy as every other icon here) and the `apple-mobile-web-app-*` metas, so
   "Add to Home Screen" launches fullscreen without the address bar eating
   ~100px of a portrait layout.
4. **Tokens-only CSS.** Every colour in every stylesheet comes from a
   `var(--token)` defined in `css/tokens.css`. **Zero raw hex outside
   `tokens.css`** — this is checked mechanically and is currently exactly 0.
   Canvas JS *may* use colour literals, because canvas cannot read CSS
   variables; that is the one legitimate exception.
5. **420x860 portrait, touch-first.** Touch targets ≥ 44px. Text ≥ 4.5:1
   contrast, non-text indicators ≥ 3:1.
6. **Authored SVG for icons.** No emoji, ever. No Unicode glyph doing icon
   duty. House style: 24x24 viewBox, 2px stroke, `currentColor`,
   `aria-hidden="true"`. `js/phone.js` and `js/shop.js` hold the reference set.

## 3. HOW WE WORK (the owner's standing instruction)

> "you work the brains of the project, sonnet agents code it for you"

The lead (you) writes specs with concrete numbers and a **disjoint file
ownership map**, dispatches parallel agents, and then **verifies independently
by grepping and measuring — never by trusting an agent's report.**

That verification step is the single most valuable habit in this project. It
has caught: a save-corrupting migration, a feature that was completely
unbuyable, a suppression flag written by nobody, a permanently-latched button,
contrast failures as low as 1.54:1, and a comment that confidently described
behaviour that measurement disproved.

**Standing owner rules:**
- **Invoke the `/impeccable` skill on every design change, without exception.**
  Agents must be *told to invoke the skill by name*. Embedding craft rules in
  the brief is NOT sufficient — the owner corrected this explicitly.
- **Model policy:** Sonnet 5 on **high** for coding packages; Opus 5 on **low**
  for design packages.
- "Try to use the least usage/credits possible, but don't let that be a
  limiting factor if it means a lower quality design."
- Order agent checklists **smallest-item-first**, so a session-limit kill banks
  real progress instead of losing one large half-finished item.

**Dispatch pattern that works:**
1. Write `SPEC-Vxx-NAME.md` with a numbered ownership table.
2. Pre-wire anything shared **yourself** (`index.html` tags, stub files), so no
   two agents contend over one file.
3. Give every agent: its exact file list, the traps in §5, "verify by
   measurement", and the current expected suite counts.
4. Re-verify everything yourself when it lands.

**Agents die from session limits mid-run, often.** When that happens, **check
what actually landed before assuming anything is broken** — in this session
three agents died and *all three had already written complete, working code*;
their dying message was just narration. Check `node --check`, then grep for the
feature.

## 4. ARCHITECTURE

**`js/state.js` (~312KB) is the rulebook.** Every game rule lives there and is
exported on `Game.State`. Everything else renders it. `js/data.js` is the
catalog and tuning constants (`Game.Data`).

**`js/iso.js` (~208KB) is the renderer.** Isometric projection, all prop art,
the room shell, day/night. Shared shading is `rampShade()` / `boxRamp()` /
`rotatedBoxRamp()`: top ×1.30, left ×1.00, right ×0.70, 1px pure-black
silhouette, top-left highlight. Every prop goes through it.

**`js/hub.js` (~132KB) owns the room screen**, the camera (zoom/pan via
`getCamera()`), hit-testing, and the hold-to-edit placement flow.

Other screens: `career`, `shop`, `locations`, `stats`, `teams`, `tournaments`,
`social`, `sponsors`, `crypto`, `phone`, `title`, `tutorial`, `customise`.
Minigames: `aim`, `stream`, `cases`, `sheep`. Infra: `router`, `ui`, `audio`,
`main`.

Stylesheets mirror the screens; `css/tokens.css` is the palette and primitives
and is normally **lead-owned**.

**Key systems to know before editing:**
- **Footprints.** `footprint: {w,d}` on an item; `State.footprintTiles()`,
  `canPlaceFootprint()`. Rotation reorients w/d.
- **Wall mounts.** `mount: 'wall'`. Rotation is **derived, never chosen** —
  `State.isWallSlot()`, `State.wallRotForTile()`. Wall spans use
  `State.wallFootprintTiles()`, which is the single source for how many wall
  tiles a wall item covers (2 for a wide window).
- **`noCollide`.** LEDs (`rgb_strip`, `neon_sign`) skip the occupancy scan
  entirely — they never block and are never blocked, but two may not share one
  tile. Draw order derives from this flag (`drawOrderFor()` → -0.9, behind
  furniture, so the glow spills from underneath).
- **Hold-to-edit.** 600ms hold enters Moving state, with a timer ring.
- **Disabled controls.** `UI.setDisabled(el, bool, cls)` in `js/ui.js` is the
  **only** correct way to disable a control (see §5.5).

## 5. TRAPS — READ BEFORE DEBUGGING ANYTHING

These are all real, all cost hours, most shipped to the owner at least once.

### 5.1 `normalizeSave()` drops top-level keys — but NOT per-entry fields
`normalizeSave()` starts from `defaultData()` and copies
`for (var k in d) if (raw[k] !== undefined) d[k] = raw[k]`.

- A **new top-level field missing from `defaultData()` is silently dropped on
  load.** This has shipped broken **five or more times**.
- **BUT** `placed` is copied *wholesale*, so arbitrary **per-entry** keys on
  `placed[i]` round-trip automatically. This is verified — `tint`, `designId`
  and `closed` all survive with no `defaultData()` change.

Adding a top-level mirror of a per-item field to "be safe" creates the
*second-copy* bug instead. Know which case you are in.

### 5.2 A missing `propMap` entry renders the prop completely invisible
`drawFamily()` in `js/iso.js` silently no-ops when `propMap[id]` is absent.
Shipped twice: four V15 regen items, then four V20 windows plus the blind.
**Any new placeable item needs a `propMap` entry and a `CATEGORY_ORDER`
draw-order value in `js/iso.js`.**

### 5.3 A new shop category with no tab is unreachable
`js/shop.js`'s `CATEGORY_ORDER` is a hand-written array that *builds* the
category strip. V20 added `window` and `blind` to the catalog and nobody added
them here — five items existed, priced and specced, **with no way to buy them.**
There is now a regression test asserting every `Data.shopItems` category has a
tab, label and icon.

### 5.4 Single source of truth
When two places need one rule, export it from `state.js` and derive. **Four
user-visible bugs came from a stale second copy.** If you catch yourself
writing an id list or re-deriving geometry that another file already knows,
stop and export instead.

### 5.5 A CSS-only "disabled" is not disabled
`pointer-events: none` stops the mouse and nothing else — the control stays
tab-focusable and fires on Enter. Use `UI.setDisabled()`, which sets the native
`disabled` property on real form controls and `aria-disabled` + `tabindex="-1"`
(stashing/restoring the original tabindex) on DIV "buttons".

### 5.6 The preview pane is frequently not compositing
`document.hidden === true` (or a frozen `document.timeline`) freezes
`requestAnimationFrame`, so **working UI looks blank or frozen and screenshots
time out.** Confirm with a rAF tick count before concluding anything is broken:
```js
let n=0; const f=()=>{n++;requestAnimationFrame(f)}; f();
```
Zero (or one) tick in 300ms means the pane, not your code. Work around it with
**offscreen canvas + `getImageData` pixel inspection** and
`getBoundingClientRect` / computed styles. Animations can be forced to settle
with `document.getAnimations().forEach(a => a.finish())`.

### 5.7 The browser serves cached JS and CSS
After editing, **hard reload** or you will test the old file. This produced a
false negative for the lead and for an agent in the same session. Verify the
served file with a cache-busted `fetch()` if in doubt.

### 5.8 Test the real code path
The Gold Nova tutorial bug lived entirely inside `doPlayMatch()`; testing
`State.playMatch()` directly bypassed it and made the bug invisible. The owner
caught it, not the lead. Drive the path the player actually takes.

### 5.9 Comments can lie
`minigames.css` carried a comment asserting a rule kept a label legible
"against that filter". Measured: it did not — 3.35:1. Measure, don't read.

### 5.10 Harness-call signatures the lead has personally got wrong
- `Iso.renderPropIcon(canvas, id)` takes a **canvas**, not a ctx.
- `State.openCase({caseId})`, not `openCase(id)`.
- `State.wake({force:true})` returns `{ok:false}` when already awake — use
  `State.endDay()`.
- `test-v15-rules.js` is **known-slow** (minutes). It is not hung.
- `grep -P` with `\x{...}` above the BMP **errors out on this box**. Scan for
  glyphs with node and `/[\u2190-\u2BFF\uFE0F]/` instead.
- Diffing two rendered frames to isolate a sprite **does not work for the sheep
  minigame** — `start()` re-seeds background RNG, so grass differs per frame.

## 6. WHAT LANDED IN V20 / V21 (the most recent work)

### V20 — room customisation
- **Windows became purchasable items.** Built-in room windows removed from
  `iso.js` entirely. Four new items (small/wide × black/wood rim); wide ones
  carry `footprint:{w:2,d:1}` and span two wall slots. Transparent and
  day/night reactive (measured: the room mean shifts 108 colour units).
- **Blinds** (`blind_slat`) snap onto window tiles, toggle open/closed, darken
  the room when closed (measured: 54 units), and when **every** window is fully
  covered by closed blinds sleep regenerates **+15%** faster
  (`Data.blindsSleepBonusPct`, flat and non-stacking).
- **LEDs ignore tile collision** (`noCollide`) and render behind the furniture
  on their tile so the glow spills out from underneath.
- **Banners/neon** give a flat, non-stacking **+5%** merchandise bonus.
- `lucky_mousepad` renamed **FLOOR LED SCREEN**, stats stripped, id kept.
- Sleep by **tapping the bed**; header sleep key deleted; bed pulses under 20%
  energy; onboarding step 8 retargeted at the bed.

### V21 — the customise modals
- Five customisable items in two families: **fabric** (`poster_team`,
  `blind_slat`) and **LED** (`neon_sign`, `rgb_strip`, `lucky_mousepad`),
  resolved from `customisable` / `ledCustomise` flags in `data.js`.
- `Data.customisePalettes` — 8 fabric + 8 LED colours, **the** source of truth.
- New `State` API: `customiseFamily(itemId)`, `customisePalette(itemId)`,
  `itemTint(placedIdx)`, `setItemTint(placedIdx, tint)`. Refusals:
  `OUT OF RANGE`, `NOT CUSTOMISABLE`, `UNKNOWN COLOUR`. `null` **deletes** the
  key rather than storing `"null"`.
- `js/customise.js` + `css/customise.css` — a bottom-docked paint sheet reusing
  the inventory-well anatomy. Opens already showing the applied colour, applies
  live (no OK/Cancel; FACTORY is the undo), and FACTORY shows the item's real
  untinted sprite.
- `js/iso.js` renders the tint by **recolouring the base and re-deriving the
  ramp** — never a flat fill. LEDs drive their glow from it; fabric stays matte.
  Measured: fabric changes ~1,500px, LEDs 8,000–21,000px (the glow spill).
  `tint = null` restores the original render exactly.

### Also fixed this session
- A **save-corrupting migration bug**: windows and blinds share a tile by
  design, but two load-time migrations treated that as a collision and
  relocated the window on every load, silently switching off the +15% sleep
  buff. Fixed in both `migrateBedFootprints` (now skips wall mounts) and
  `migrateWallMounts` (now footprint-aware and window/blind-aware).
- **Disabled states** are no longer `filter: grayscale()` — they are an
  inverted ramp ("THE DEAD KEY", end of `css/style.css`). Worst prior contrast
  was **1.54:1**; everything is now ≥ 4.5:1.
- Inventory tiles show **visible item names** (were `title`-only, invisible on
  touch).
- Tutorial step 8 spotlights **the bed**, not the whole canvas (100% → 9.8% of
  the canvas), via `Hub.bedScreenRect()`.
- `.mg-back` carries `.btn` instead of hand-rolling a keycap; its tap target
  went from **61x31** (under the 44px floor) to 65x44.
- Unicode icon glyphs replaced with authored SVG, with `.sr-only` text
  preserving the meaning that `✓/✗`, `▲/▼`, `↑/↓` carried.

## 7. VERIFICATION TOOLKIT

Syntax + the tokens rule:
```bash
cd "C:/Users/User/Desktop/hujnia" && for f in js/*.js; do node --check "$f" >/dev/null 2>&1 || echo "SYNTAX FAIL: $f"; done
```
```bash
cd "C:/Users/afgus/Downloads/mainhujnia/hujnia" && grep -n "#[0-9a-fA-F]\{3,6\}" css/*.css | grep -v "^css/tokens.css" | wc -l
```

**Expected suite counts** (all currently passing — a change here is a
regression until proven otherwise):

| suite | count |
|---|---|
| `test-v23-quests.js` | 28 *(V23: quests, the email app, the CLUTCH, scouting)* |
| `test-v22-fixes.js` | 99 *(the owner's bug lists; add each batch here)* |
| `test-v14-phone.js` | 20 *(was 19 — V22 added the SPONSORS gate test)* |
| `test-v21-customise.js` | 18 |
| `test-v20-customise.js` | 38 |
| `test-v12-footprints.js` | 16 |
| `test-v13-rules.js` | 17 |
| `test-v15-banners.js` | 15 |
| `test-v15-tutorials.js` | 26 |
| `test-v16-rooms.js` | 16 |
| `test-v15-rules.js` | 26 *(slow — minutes, not hung)* |

The suites run the real `data.js` + `state.js` in a Node VM against a
`window` + `localStorage` shim. Copy the harness shape from
`test-v20-customise.js` when writing a new one. **Save/load assertions must
reload in a *fresh* VM** or they do not exercise `normalizeSave()`.

**Live testing** — always over HTTP at 420x860, never `file://` (the browser
blocks things there that the owner's real usage does not hit):
```bash
cd "C:/Users/User/Desktop/hujnia" && npx --yes serve -l 8123 .
```
`.claude/launch.json` defines this as `static-server` for `preview_start`.
Note `serve` 301s `/index.html` → `/`, and takes ~20s to boot on first run.

## 8. DOCUMENT MAP

- **`HANDOFF-V2.md`** (this file) — start here.
- **`TASKS-REMAINING.md`** — the queue, and what deliberately isn't in it.
- `HANDOFF.md` — the original; pre-V20 history and full balance numbers.
- `PROGRESS.md` — historical trail per version.
- `ART-DIRECTION.md` — the art rules (shading, outlines, icon policy).
- `SPEC-V*.md` — one per version. **`SPEC-V23-QUESTS.md` is the current one**
  (the email app, LAN quests, THE CLUTCH minigame, and scout interest —
  specced, not built); `SPEC-V20-CUSTOMISE.md` and
  `SPEC-V21-CUSTOMISE-MODALS.md` are the most recent shipped ones.
- `mockups/` — the **V1** gallery, three redesigns stale. Kept as history by the
  owner's decision, not as a target; it carries a banner saying so. Never treat
  it as the current visual reference — `ART-DIRECTION.md` plus whatever the root
  `index.html` renders is the truth.
- `CONTEXT-NOW.md` — **obsolete**, superseded by this file. Safe to delete.
