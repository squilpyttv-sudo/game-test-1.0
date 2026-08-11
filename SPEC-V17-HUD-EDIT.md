# CS2 PRO SIMULATOR — V17: HUD PURGE, PHONE OS, HOLD-TO-EDIT

Addendum to `SPEC.md` … `SPEC-V16-REDESIGN.md`. Where they disagree, **this
wins**. Hard constraints unchanged: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860.

Design language: `ART-DIRECTION.md` §2. Reference: `inspo/`.

---

## 0. OWNERSHIP — four packages, disjoint, run in PARALLEL

| Pkg | Files | Scope |
|---|---|---|
| **P1** | `js/hub.js`, `js/iso.js` | §2 hold-to-edit · §4 rotation bug |
| **P2** | `js/main.js`, `css/style.css` | §1 HUD purge · §3 header sleep button |
| **P3** | `js/phone.js`, `css/phone.css` | §5 phone apps + inventory |
| **P4** | `css/teams.css`, `css/minigames.css`, `css/stats.css`, `css/title.css`, `css/tutorial.css` | §6 menu audit |

`js/state.js` and `js/data.js` are **FROZEN** — no rules change is needed.

### Cross-package API (P1 exposes, P3 calls defensively)
```js
G.Hub.spawnIntoMoveState(itemId)  // -> bool; spawns the item centre-screen
                                  //    already in the Moving state
```
P3 calls it as `G.Hub && G.Hub.spawnIntoMoveState && G.Hub.spawnIntoMoveState(id)`,
exactly as `js/sponsors.js` calls `G.Phone.open()`.

---

## 1. HUD PURGE (P1 markup, P2 styles)

- **Delete the hub control row entirely**: EDIT ROOM, CAREER, STATS, SLEEP.
  P1 removes the markup + handlers from `js/hub.js`; P2 removes the now-dead
  `.hub__controls` / `.hub__edit-btn` / `.hub__career-btn` / `.hub__stats-btn` /
  `.hub__sleep-btn` rules from `css/style.css`.
- **Delete the horizontal edit tray** (`#hub-tray`, `.hub__edit-tray`,
  `.hub__tray-empty`) and everything that renders into it. Its job moves to the
  phone's INVENTORY app.
- **Delete the inspect popover** (`#hub-inspect`, `.hub__inspect`,
  `showInspect`/`hideInspect` and their timer). Tapping a prop no longer shows
  a description — that gesture now belongs to hold-to-edit. **Remove it fully**,
  do not leave it dormant.
- The hub's CAREER notification dot (`#hub-career-badge`) goes with the row.
  Its signal must survive — see §5.

---

## 2. HOLD-TO-EDIT (P1)

Replace the whole EDIT-ROOM-mode flow with a direct-manipulation model. **There
is no edit mode any more** — the room is always editable by holding.

### 2.1 State machine
- **Hold any placed prop for 600ms** → enter **Moving** state for that prop.
- A tap shorter than 600ms does nothing (no popup — see §1).
- Moving a finger more than ~10px before 600ms cancels the hold (it was a pan,
  not a hold).

### 2.2 Moving-state visuals
- The prop **lifts a few pixels on the Y axis**.
- A **dark semi-transparent isometric shadow** is cast on the floor beneath it.
- The **green (valid) / red (invalid) isometric tile highlight** is drawn
  directly under its footprint — the full footprint, not just the anchor tile
  (a bed is 2 tiles; `State.footprintTiles()` already returns them).

### 2.3 Dragging
While Moving, dragging **or tapping another tile** moves the prop, snapping to
the grid. Validity re-evaluates live via the existing `State.canMoveItem()` /
`State.canMoveGroup()` — **do not write new occupancy logic**; four
user-visible bugs here came from a second copy of one rule.

### 2.4 Floating context menu
Three **round icon buttons** directly above the prop. Icons, not text.
**Authored SVG only — no emoji, no Unicode glyphs.**

| Button | Look | Action |
|---|---|---|
| **Stash** (left) | brown cardboard-box icon | Remove from the room (stays in `owned`, so inventory count rises), exit Moving |
| **Rotate** (centre) | `#4A4E8E` base, white circular arrow | Rotate 90°, update the grid footprint |
| **Place** (right) | `#84E070` base, white checkmark | Commit, play a placement particle + sound, exit Moving |

- **Place is disabled/greyed when the tile underneath is red.**
- **Stash must refuse the last placed core item** (desk/pc/chair/monitor/bed —
  `State.removePlacedAt()` already enforces this). Show a toast explaining why;
  never a silent no-op.
- **Rotate is hidden for wall-mounted items** (banners) — their rotation is
  derived from the wall (SPEC-V15-BATCH-B §1).

### 2.5 The trap to avoid
`js/hub.js` has a rAF render loop. **Never reposition the context-menu buttons
from it.** Position them on state-change edges only. Rewriting a live tap
target's position every frame is the documented cause of this project's
multi-tap bug (HANDOFF §9.5) — and these buttons appear *under the player's
finger* mid-drag, which is the worst possible case.

---

## 3. HEADER SLEEP BUTTON (P2)

- Bind SLEEP into the **top-right of the header, beside the energy bar**.
- **Pulse gently** (scale to 110% and back over a 1.5s loop) when energy is
  **under 15%** of max **or** the day phase is night.
- **Greyed out / not clickable when energy is over 50%** — the existing
  `State` sleep gate already refuses above 50%; mirror that visually rather
  than re-deriving the threshold.
- Honour `prefers-reduced-motion: reduce` (drop the pulse).
- Never rebuild the button from `refreshTopbar()`'s 1s tick — bind once at
  build time, only toggle classes on refresh.

---

## 4. ROTATION TRANSPARENCY BUG (P1)

**Owner report:** "rotate a fridge to the side and you can see its door through
its side and back walls."

Detail geometry (doors, seams, panels, magnets) is drawn on faces that are
**back-facing at some rotations**, so it shows through the solid body. Fix the
draw order / face culling in `js/iso.js` so a detail is only drawn when the
face it belongs to is actually visible at the current rotation. Audit **every**
family with front-face detailing — fridges, PCs, monitors, desks, the water
cooler, the recovery pod — at all 4 rotations, not just the fridge.

---

## 5. PHONE OS EXPANSION (P3)

Three new apps, **visually identical in construction to the existing SPONSORS /
SOCIAL MEDIA tiles** (same size, border, bevel, label treatment, notification
dot). Authored SVG icons only.

| App | Base | Icon |
|---|---|---|
| **CAREER** | `#F58A2B` | white 16-bit briefcase / ID badge |
| **STATS** | `#63C7EB` | white 16-bit trending line graph |
| **INVENTORY** | cardboard brown | pixel-art cardboard box — **the icon IS the button**, like a real phone app |

- **CAREER carries the notification dot** that the deleted hub row used to show
  (pending tournament or unmet scrim quota — read `State.scrimQuotaStatus()`
  and the tournament check the hub used). That signal must not be lost.
- CAREER and STATS route to the existing `career` / `stats` screens; their BACK
  returns to the phone, like every other app.

### 5.1 INVENTORY app
- A **3x3 grid of square slots**, most empty.
- Each filled slot shows the **item's real sprite** via `Iso.renderPropIcon`
  (already used by the shop and the old tray) and a **quantity badge bottom-
  right** (`x3`).
- Inventory = **owned minus placed**, derived from `State.data.owned` /
  `.placed`. No new persisted field.
- Tapping a slot: **close the phone immediately**, then call
  `G.Hub.spawnIntoMoveState(itemId)` so the prop appears centre-screen already
  in the Moving state, ready to drag.
- More than 9 stacks: paginate or scroll — never hide items with no way to
  reach them.

---

## 6. MENU AUDIT (P4)

Every modal, overlay and panel in the game must match the V16 language
(`ART-DIRECTION.md` §2: 2px `--outline` edge, light-top/dark-bottom bevel,
3px pixel corners, tokens only). Several predate V16 and were never updated.

**Audit and bring up to standard**, at minimum: reward cards (match result,
case pull, sleep/morning summary), confirm dialogs, the energy modal, the
top-bar resources modal, tutorial cards, the 8-step onboarding overlay, the
GAME OVER / debt overlays, the title screen and save slots, settings, offer and
sponsor cards, the tournament match overlay, the shop's confirm, and the stats
screen's panels.

- **Tokens only, zero raw hex.** New colours must become tokens — but
  `css/tokens.css` is **not owned by this package**, so if you need one, STOP
  and report it.
- Report any menu that needs a **JS** change (markup, not styling) rather than
  editing a JS file you do not own.

---

## 7. DEFINITION OF DONE (all packages)
1. `node --check` clean; **zero raw hex outside `css/tokens.css`**.
2. All suites pass: `test-v12-footprints.js`, `test-v13-rules.js`,
   `test-v14-phone.js`, `test-v15-banners.js`, `test-v15-tutorials.js`,
   `test-v16-rooms.js`. (`test-v15-rules.js` is known-slow — minutes, not hung.)
3. Verified live over HTTP at 420x860 on a **fresh save** — never `file://`.
4. Screenshots of what changed.
