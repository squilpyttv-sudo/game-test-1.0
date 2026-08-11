# CS2 PRO SIMULATOR — V12: TILE OCCUPANCY & FOOTPRINTS (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V11-FIXES.md`. Where they disagree, **this wins**.
All earlier hard constraints apply: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS.

**Ownership:** one package — `js/data.js`, `js/state.js`, `js/hub.js`,
`js/iso.js`. This is cross-cutting; a single agent owns the whole vertical so
the rule cannot end up duplicated (see §3).

---

## 1. REGRESSION — props can be placed inside one another

**Reported by the owner after V11.** Props that should each need their own tile
can now be stacked on top of each other.

**Likely cause (verify before fixing):** `pendingTileValid()` in `js/hub.js` has
a **relaxed move-branch for core singletons**. V11 added `bed` to
`isCoreSingleton()` to make tapping a settled bed work — which also routed beds,
and possibly the whole singleton set, down that relaxed branch, loosening
occupancy checks in general.

### The rule
**Exactly one group of props may share a tile: `desk` + `pc` + `monitor`.**
Every other prop requires its own exclusive tile.

- A `monitor` may only be placed on a tile that already holds a `desk` (existing
  rule from SPEC-V6 §10 — keep it).
- No tile may ever hold two props of the **same** category.
- Everything outside that trio — bed, plant, poster, rug, RGB strip, trophy
  shelf, energy items, fridges, cat, all decor — is **exclusive**: it cannot be
  placed on an occupied tile, and nothing may be placed on its tile.

Express this as **one explicit, readable rule** (e.g. a co-tenancy group table)
rather than scattered conditionals. Rebuild the check for the *moving* case too
— moving a prop must validate its destination exactly as placing a new one does.
The relaxed move-branch must not be a hole.

---

## 2. The bed occupies TWO tiles

A bed is visually two tiles long but is currently tracked as occupying one, so
props can be placed "inside" it.

### Requirements
- Introduce a general **footprint** concept — e.g. `footprint: { w: 2, d: 1 }` on
  the item definition, defaulting to `1x1` for everything else. **Do not
  special-case the bed** — a general footprint system is barely more work and
  the next large prop will need it.
- **Rotation changes the footprint's orientation.** At 0°/180° a 2x1 bed spans
  `(x, y)` and `(x+1, y)`; at 90°/270° it spans `(x, y)` and `(x, y+1)`.
- **Every tile in the footprint must be in-bounds and free** before the bed can
  be placed, moved, or rotated into that orientation.
- **Both directions must be blocked:**
  - a bed cannot be placed or rotated onto a tile occupied by anything else;
  - nothing else can be placed onto **either** tile the bed occupies.
- **Rotating in place must re-validate.** A bed lying along x may not have room
  to rotate along y — if the second tile would be out of bounds or occupied,
  refuse the rotation **with a toast explaining why**. Do not silently ignore
  it (see §4).
- Occupancy lookups must consider footprints throughout — placement validation,
  the ghost preview's valid/invalid highlight, prop picking, and the packing/
  move-out flow.

---

## 3. Do not create a second source of truth

The occupancy rule must live in **one place** and be consumed everywhere —
`state.js`'s placement validation, `hub.js`'s `tileValid()` /
`pendingTileValid()` and the ghost highlight all need the same answer.

**This project has had four user-visible bugs caused by two copies of one rule**
(coach quota, sleep deadlock, rent countdown, bed singleton). The V11 fix
explicitly removed the last hardcoded mirror by exporting
`State.SINGLETON_ROOM_CATEGORIES` from `state.js`. **Follow that pattern**:
put the footprint/occupancy logic in `state.js`, export it, and have `hub.js`
derive. Do not re-introduce a mirror.

---

## 4. No silent refusals

Every rejected placement, move or rotation must explain itself with a toast —
"NEEDS TWO FREE TILES", "TILE ALREADY OCCUPIED", "MONITOR NEEDS A DESK ON THAT
TILE", "NOT ENOUGH ROOM TO ROTATE".

A tap that does nothing is what generated the original rotation report and the
bed-tap report. It must not happen again.

---

## 5. Existing saves

Saves already exist with beds placed as 1x1. On load, a bed's second tile may
overlap another prop.

**Resolve it without losing anything:** prefer nudging the bed (or the
conflicting prop) to a free tile; if the room is genuinely full, leave the
conflicting prop in `owned` but unplaced rather than deleting it. **Never delete
a player's item.** Document the migration you chose.
