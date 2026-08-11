# CS2 PRO SIMULATOR — V15 BATCH B: BANNERS, SHOP, CASE SELECTOR

Addendum to `SPEC.md` … `SPEC-V15-BATCH-A.md`. Where they disagree, **this
wins**. Hard constraints unchanged: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860.

Design work follows `ART-DIRECTION.md` — read §2 (the five moves) before
touching any visual.

---

## 0. OWNERSHIP

| File | Package |
|---|---|
| `js/data.js`, `js/state.js`, `js/hub.js`, `js/iso.js` | **B1** (banners) |
| `js/shop.js`, `js/cases.js`, `css/teams.css`, `css/minigames.css` | **B2** (shop + cases) |

Disjoint — B1 and B2 run in parallel.

---

## 1. B1 — BANNERS MOUNT ON WALLS (owner item §1)

Today `poster_team` and `window_blinds` are floor props placed on any tile, so
they visibly float.

### Rules (`data.js` + `state.js`)
- Add `mount: 'wall'` to those two item definitions.
- A wall item may only occupy a **wall slot**: a tile on the `x === 0` or
  `y === 0` edge (the two visible walls).
- **Rotation is derived, never chosen.** The item auto-orients to the wall it
  is on: `y === 0` → one facing, `x === 0` → the other. Hide the ROTATE button
  for wall items entirely rather than letting it no-op.
- Wall items do **not** consume floor occupancy — a desk may share the tile,
  because the banner is on the wall, not the floor. Two wall items **may not**
  share the same wall slot.
- On the corner tile `(0,0)`, default to the `y === 0` wall.
- Refusal toast: `BANNERS MOUNT ON WALLS ONLY`.
- **All of this lives in `state.js` and is exported; `hub.js` derives.** This
  project has had four user-visible bugs from a second copy of one rule
  (SPEC-V12 §3). Do not add a wall check to `hub.js`.
- **Migration:** a save with a banner on a non-wall tile must be relocated to
  the nearest free wall slot, or left owned-but-unplaced if none exists.
  **Never delete a player's item.**

### Art (`iso.js`)
Redraw both so they hang flat against the wall plane rather than standing on
the floor, using the **existing `Iso.rampShade`/`boxRamp` helper** added in
Batch A. Do not add a second ramp.

---

## 2. B2 — SHOP REDESIGN (owner item §6)

**The root cause is a deliberate past decision.** SPEC-V5 §20 specified "one
continuous scroll through SECTION_ORDER… **No tabs, no category filter — every
section renders every time.**" That is 10 sections and ~39 items rendered
simultaneously in a 420px column. Playtesters cannot find anything. **§20 is
hereby reversed.**

### The new shop
Take the structure the reference material uses (see `inspo/`, especially the
"Affordable Items" and "All Items" screens) without copying its art:

1. **A category strip** across the top: chunky icon tiles, one per category,
   one selected at a time. **Only the selected category's items render.**
   Categories: DESK · PC · MONITOR · CHAIR · BED · ENERGY · REGEN · DRINKS ·
   DECOR · STAFF. Horizontally scrollable at 420px — do not wrap to two rows.
2. **A filter row**: `AFFORDABLE ONLY` toggle and a sort control
   (PRICE ↑ / PRICE ↓ / TIER). The reference leads with "Affordable Items" for
   exactly this reason — it is the question a player actually has.
3. **Item cards in a 2-column grid**, each showing:
   - the **real prop art** as its icon via `Iso.renderPropIcon` — not an emoji,
     not a generic glyph. This is what makes shop icons and edit-tray icons one
     system.
   - name, price, band (STARTER/PRO/ELITE), stat chips
   - **state, unmistakably**: OWNED · PLACED · CAN'T AFFORD · CAP REACHED
   - unaffordable items stay **visible and dimmed** with the price legible —
     never hidden. That is how the reference does it and it gives the player a
     goal.
4. **A category badge** showing how many items in that category are affordable
   right now, so the strip itself answers "where can I spend?".

### Craft floor (from `ART-DIRECTION.md`)
- 2px near-black outline on tiles and cards; the light-top/dark-bottom bevel.
- **No emoji or Unicode glyphs as icons** — authored SVG or rendered prop art
  only. The category strip icons are authored SVG at one 2px stroke weight.
- Tokens-only CSS, zero raw hex.
- Do not nest cards inside cards.

### Must not regress
Every existing purchase rule stays: the energy 4-placed cap and its confirm,
`requiresFridge` gating on energy drinks with `NEEDS A FRIDGE` / `FRIDGE FULL`,
staff hire/replace, the `room` category staying filtered out, and the
placed-vs-owned cap copy.

---

## 3. B2 — CASE SELECTOR (owner item §10, UI half)

The rules already exist and are verified: `Data.caseTiers`
(`case_standard` $7 / `case_prime` $50 / `case_elite` $200),
`d.caseSelection = { solo, stream }`, and `State.setCaseSelection()`.
`State.openCase({ caseId, onStream })` takes an **options object** — note the
shape, it is not a bare id.

Build the picker in `js/cases.js`:
- Three case tiles showing cost, and each tier's **value range** so the player
  can see what they are buying into. Never expose the gold split — it stays `?`
  (SPEC-V3 §11).
- **Two independent selections**: which case opens **solo** and which opens
  **on stream**. That separation is the owner's explicit ask; make it obvious
  which is being set, not a single toggle the player has to infer.
- A tier the player cannot afford is **selectable but marked `CAN'T AFFORD`**,
  never hidden.
- The selection persists (it is already on the save) and is shown on the CASES
  screen so the player always knows what will open.

---

## 4. DEFINITION OF DONE
1. `node --check` clean; zero raw hex in every touched stylesheet.
2. No second copy of the wall rule outside `state.js`.
3. Banner migration proven not to delete anything.
4. Every refused action toasts a reason.
5. Verified live over HTTP at 420x860 on a **fresh save** — never `file://`.
6. The shop's existing purchase rules re-verified, not assumed.
