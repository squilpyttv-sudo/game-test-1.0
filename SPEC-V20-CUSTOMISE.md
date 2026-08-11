# CS2 PRO SIMULATOR — V20: WINDOWS, LEDs, BANNERS & BLINDS

Addendum to `SPEC.md` … `SPEC-V19`. Where they disagree, **this wins**. Hard
constraints unchanged: vanilla JS, no ES modules, no dependencies, no external
assets, `file://`-safe, tokens-only CSS, 420x860.

---

## 0. OWNERSHIP

| Pkg | Files | Scope |
|---|---|---|
| **R** | `js/data.js`, `js/state.js` | §1–§5 rules + catalog |
| **H** | `js/hub.js`, `js/main.js`, `css/style.css`, `js/tutorial.js` | §6 bed-sleep + §7 customise button |
| **S** | `js/sheep.js` | finish the V19 sheep remake |
| **L** | `js/cases.js`, `js/stream.js`, `css/minigames.css` | GO LIVE button |

Painting/colour-picker MODALS are a later package — R and H only expose the
data and the entry point.

---

## 1. WINDOWS BECOME PURCHASABLE ITEMS

Windows are currently baked into the room and always render dark.

- **Remove built-in windows from the room shell entirely.** No location draws
  a window any more.
- Add a **`window` category** to `Data.shopItems`. Ship **4**:
  | id | name | size | frame | price |
  |---|---|---|---|---|
  | `window_small_black` | SMALL WINDOW — BLACK RIM | 1 tile | black | 900 |
  | `window_small_wood` | SMALL WINDOW — WOOD RIM | 1 tile | wood | 900 |
  | `window_wide_black` | WIDE WINDOW — BLACK RIM | **2 tiles** | black | 3200 |
  | `window_wide_wood` | WIDE WINDOW — WOOD RIM | **2 tiles** | wood | 3200 |
- Windows are **wall-mounted**, exactly like banners: `mount: 'wall'`, only on
  a wall slot, rotation derived from the wall. Reuse `State.isWallSlot()` /
  `wallRotForTile()` — **do not write a second wall rule.**
- Wide windows carry `footprint: { w: 2, d: 1 }` and occupy **two adjacent
  wall slots**.
- They must be **at least slightly transparent** and **react to day/night** —
  bright by day, dark at night, following the existing day-night value the
  room already threads through.

## 2. LED LIGHTS IGNORE TILE COLLISION

`rgb_strip` (and `neon_sign`) must be placeable on a tile that already holds
anything else.

- Add **`noCollide: true`** to those item definitions.
- In `canPlaceFootprint()`, an item with `noCollide` **skips the occupancy
  scan entirely** — it never blocks and is never blocked. The footprint
  indicator therefore stays **green over an occupied tile**.
- Two LEDs still may not share the *same* tile (no stacking duplicates).
- This is one rule in `state.js`. `hub.js` derives — **no second copy.**
- **Z-ordering:** an LED renders flat against the wall/floor **behind** the
  furniture on its tile, so its glow reads as spilling out from underneath.

## 3. BLINDS

- Add a **`blind` category**. Blinds snap to **window tiles only** — refuse
  elsewhere with `BLINDS GO ON WINDOWS`.
- **A small window needs 1 blind; a wide window needs 2.**
- Tapping a placed blind **outside a move** toggles OPEN / CLOSED.
- **Buff:** when **every window in the room is fully covered by closed
  blinds**, sleeping regenerates energy **+15% faster**. It does **not stack**
  — it is a single flat bonus, on or off. With zero windows owned the bonus is
  **off** (you cannot earn it by owning nothing).
- Closed blinds also darken the room.

## 4. BANNERS & NEON SIGNS

- Banners keep `mount: 'wall'`. **Buff: +5% to stream views and subscriber
  gain.** Like §3 it is **flat and non-stacking** — owning six banners gives
  +5%, not +30%.
- **`neon_sign` gains the same customise capability as a banner and the same
  +5% buff.** A banner and a neon sign together still give **+5% total**, not
  +10% — one merchandise bonus.

## 5. FLOOR LED SCREEN

- Rename `lucky_mousepad` → **`FLOOR LED SCREEN`**. **Keep the id** so saves
  keep what they paid for.
- **Strip its stat effects entirely** — it becomes purely decorative.
- It gains the same customise capability as banners/neon.

## 6. SLEEP BY TAPPING THE BED (package H)

- Tapping the bed (outside a move) **sleeps**, using the existing sleep path
  and all its existing refusals/toasts.
- **Remove the header sleep button** added in V17/V18 — this replaces it.
- When energy is **below 20%**, the bed gains a **pulsing yellow outline** in
  the room to signal it.
- The tutorial must teach tapping the bed. Update the onboarding step that
  currently points at the removed button — its selector will be dead.

## 7. THE CUSTOMISE BUTTON (package H)

A **4th round button** joins Stash / Rotate / Place in the move context menu,
**only** for customisable items (banner, blind, neon sign, floor LED screen,
RGB strip).

- Style: square 16-bit, `#DE5285` (or `#00CCFF` for LEDs), white authored-SVG
  paintbrush / lightbulb icon. **No emoji.**
- Tapping it opens the relevant editor. **H only wires the entry point and
  reports the API it needs** — the paint and colour-picker modals are a
  separate package.

## 8. DEFINITION OF DONE
1. `node --check` clean; zero raw hex outside `css/tokens.css`.
2. All suites pass: v12 16 · v13 17 · v14 19 · v15-banners 15 ·
   v15-tutorials 26 · v16-rooms 16.
3. **New persisted fields must be added to `defaultData()`** or they are
   silently dropped on load — this has shipped broken five times.
4. Verified live over HTTP at 420x860 on a fresh save — never `file://`.
