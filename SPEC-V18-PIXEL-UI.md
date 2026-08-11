# CS2 PRO SIMULATOR — V18: HOLD TIMER + DENSE 16-BIT UI OVERHAUL

Addendum to `SPEC.md` … `SPEC-V17-HUD-EDIT.md`. Where they disagree, **this
wins**. Hard constraints unchanged: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860.

Reference: `inspo/`. Direction: `ART-DIRECTION.md`.

---

## 0. OWNERSHIP — five packages, disjoint, PARALLEL

| Pkg | Files | Scope |
|---|---|---|
| **A** | `css/style.css` | §2 core primitives: buttons, modals, lists, checkerboard |
| **B** | `js/ui.js`, `js/main.js` | §3 modal chrome in markup (close button, docked header) |
| **C** | `css/teams.css`, `css/minigames.css`, `css/stats.css`, `css/title.css` | §4 screens, grids, lists |
| **D** | `css/tutorial.css`, `js/tutorial.js`, `css/phone.css`, `js/phone.js` | §5 tutorial dialogs + phone grids |
| **E** | `js/hub.js` | §1 hold timer ring |

**`css/tokens.css` is DONE and FROZEN** — the lead has already added every V18
token. Use them; do not add hex anywhere else. If a value you need has no
token, STOP and report it.

---

## 1. E — HOLD TIMER RING (`js/hub.js`)

SPEC-V17 §2 made holding a placed prop for **600ms** enter the Moving state.
Nothing tells the player that. Add a **subtle circular progress ring** that
fills over those 600ms, centred on the held prop.

- **Draw it on the canvas**, not in the DOM — it is anchored to an isometric
  prop, and `hub.js` already renders there. This also avoids any DOM tap-target
  churn under the finger (HANDOFF §9.5).
- Subtle: a thin ring, no fill flood, no bounce. It should read as "keep
  holding", not as a celebration.
- It must **disappear instantly** on release-before-600ms, on cancel (finger
  moved >10px = a pan, not a hold), and the moment Moving state begins.
- Do not start it on props that cannot be moved.

---

## 2. A — CORE PRIMITIVES (`css/style.css`)

### 2.1 The one-pixel rule
**Every** UI element — button, panel, icon frame, modal, slot, row — carries a
continuous **1px solid `var(--pixel-black)`** outer outline.

### 2.2 Buttons — the 3-tone tactile ramp (never flat)
```
top    1-2px strip  brightness(var(--btn-hi-lift))  ← lightest
middle base fill    the button's own colour
bottom 2-3px strip  brightness(var(--btn-lo-drop))  ← darkest, above the black outline
```
Derive the two strips from the button's **own** background so a new colour
never needs three hand-picked hexes — `.btn::after` already uses
`background: inherit` + `filter` for exactly this; extend that pattern.

**Press:** the sprite physically drops `var(--btn-press)` (2px) and the bottom
shadow strip **compresses or disappears**, so it reads as pushed into the
screen.

### 2.3 Modal anatomy
- `var(--modal-outer)` (2px) black outer border, immediately followed by a
  **1px bright inner highlight** line (`--modal-inner`) — the glassy encased look.
- **3px rounded pixel corners** (`--radius-pixel`).
- A **docked header tab at the top** of every menu.

### 2.4 Full-screen menu grounds
Never a flat field. A subtle **two-tone checkerboard** built from
`--checker-a` / `--checker-b` at `--checker-size`, via repeating gradients
(no external assets).

### 2.5 Lists
Stacked pill rows: alternating `--row-a` / `--row-b`, a 1px `--row-divider`
line, **icon/label hard left, numbers or action buttons hard right.**

### 2.6 Type
Headers and button labels in `--ink-head` (pure white) carrying
`text-shadow: var(--text-outline)`. Numbers and stats in `--num-warm` /
`--num-cool`.

**Honest constraint, already settled:** a real pixel *font* needs an external
file, which this project forbids (it is why the game runs from `file://` with
zero dependencies). The stack stays the existing monospace with
`-webkit-font-smoothing: none` (already set) plus the outline above. Do not
attempt to load a webfont.

---

## 3. B — MODAL CHROME IN MARKUP (`js/ui.js`, `js/main.js`)

Every modal must gain, in markup:
- A **chunky close button top-right**, slightly **overlapping the outer
  border**: `--close-fill` red disc, thick white pixel X with a black outline.
  **Authored SVG — no Unicode `✕`.**
- A **docked header tab**.

Cover every modal these two files build: `UI.rewardCard`, `UI.confirmModal`,
the energy modal and the resources modal in `main.js`. Closing via the X must
use the same path the existing close/dismiss uses — do not add a second
teardown route.

**Do not** rebuild modal nodes from `refreshTopbar()`'s 1s tick.

---

## 4. C — SCREENS, GRIDS, LISTS (four stylesheets)

Apply §2's language across every screen these files own.

- **Grids** (shop, cases, any item grid): square inset slots — `--slot-fill`
  background, 1px `--slot-border`, sprite centred. Selected/active swaps the
  border to a thick `--slot-sel` (or `--slot-sel-alt`).
- **Lists** (stats rows, settings, leaderboard): §2.5 exactly.
- **Buttons**: §2.2's ramp, inherited from `style.css` — do not re-declare it
  per file; only set each variant's base colour.

Tokens only, **zero raw hex** in all four files.

---

## 5. D — TUTORIAL DIALOGS + PHONE (`tutorial.*`, `phone.*`)

### 5.1 Speech bubbles
Tutorial text renders inside pixel-art **speech bubbles**: `--bubble-fill`
background, `--bubble-ink` text, 1px black outline, with a **stepped pixel
tail** pointing at the element being described. Stepped — built from a couple
of hard-edged blocks, not a smooth CSS triangle.

### 5.2 Spotlight
When a tutorial asks the player to tap a specific control: darken the rest of
the screen with **50% black**, leave the target fully lit, and add a **pulsing
arrow** indicator. The existing 8-step onboarding already computes a spotlight
rect — reuse it rather than writing a second one.

### 5.3 Phone
Inventory/app slots follow §4's grid anatomy so the phone and the shop read as
one system.

`prefers-reduced-motion: reduce` must drop the arrow pulse.

---

## 6. HAZARDS (all packages)
- **Never animate layout properties** (width/height/max-height/top/margin).
  `transform`/`opacity` only. A `max-height` fade in the stream chat caused
  continuous reflow and made messages physically hard to tap.
- **Never reposition or rebuild a tap target from a render loop.**
- Contrast: body text ≥4.5:1 on its surface. Raising a surface without raising
  its secondary text is the classic trap.
- 420x860: nothing overflows horizontally; a modal taller than the viewport
  scrolls internally.

## 7. DEFINITION OF DONE
1. `node --check` clean; **zero raw hex outside `css/tokens.css`**.
2. Suites pass: v12 16 · v13 17 · v14 19 · v15-banners 15 · v15-tutorials 26 ·
   v16-rooms 16. (`test-v15-rules.js` is known-slow — minutes, not hung.)
3. Verified live over HTTP at 420x860 on a **fresh save** — never `file://`.
