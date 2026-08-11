# CS2 PRO SIMULATOR — V16: ROOM SIZES + THE PIXEL-ART REDESIGN

Addendum to `SPEC.md` … `SPEC-V15-BATCH-C.md`. Where they disagree, **this
wins**. Hard constraints unchanged: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860.

Reference screenshots: `inspo/`. **Take inspiration, do not copy.**
Companion: `ART-DIRECTION.md` (the direction), `VISUAL-MAP.md` (what exists).

---

## 0. OWNERSHIP — three packages, fully disjoint, run in PARALLEL

| Package | Files | Scope |
|---|---|---|
| **R1** | `js/data.js`, `js/state.js` | §1 room sizes |
| **R2** | `js/iso.js` | §2 world art (props, walls, floors, backdrops) |
| **R3** | `css/tokens.css`, `css/style.css`, `js/main.js` | §3 UI chrome |

No file is shared. If you need one you don't own, STOP and report it.

---

## 1. R1 — ROOM SIZES (owner request)

Start at **4x4**; every location is exactly **1 tile larger per side**:

| id | Location | old | **new** |
|---|---|---|---|
| 0 | PARENTS' BASEMENT | 6x6 | **4x4** |
| 1 | CITY CENTRE APARTMENT | 7x7 | **5x5** |
| 2 | BEACH VILLA | 8x8 | **6x6** |
| 3 | ESPORTS MANSION | 9x9 | **7x7** |
| 4 | PENTHOUSE SUITE | 10x10 | **8x8** |
| 5 | PRIVATE ISLAND COMPOUND | 11x11 | **9x9** |

### Two things that WILL break — handle both
1. **`Data.defaultPlaced` puts the bed at `{x:4, y:5}`** — valid in 6x6, **out
   of bounds in 4x4** (max index 3), and it is a 2x1 footprint. Re-anchor the
   starter loadout for a 4x4 grid. The bed must occupy the reserved corner:
   anchor at `(gridW-2, gridD-1)` = **(2,3)** so it spans (2,3)+(3,3) — the
   existing comment above `defaultPlaced` explains exactly why it anchors one
   short of the corner. Desk/pc/monitor at (1,1) and chair at (1,2) still fit.
2. **Existing saves shrink.** A save at location 5 drops 11x11 → 9x9, so placed
   props can sit outside the new grid. Add a migration that relocates any
   out-of-bounds prop to a free in-bounds tile, and if none exists leaves it
   **owned but unplaced**. **NEVER delete a player's item** — that rule is
   absolute here. Follow `migrateBedFootprints()` / `migrateCoreSingletons()`.

Verify a 4x4 fresh save is a **complete minimum room** (bed+desk+chair+pc+
monitor all placed, no ROOM INCOMPLETE banner) and that the bed still rotates.

---

## 2. R2 — WORLD ART (`js/iso.js`)

Apply to **every** prop, wall, floor and window. Four global passes first, then
the specific objects.

### 2.1 The four global passes
1. **Pixel-grid quantisation.** Rasterise onto a strict pixel grid — no
   sub-pixel edges. Stair-step along the 2:1 isometric slope (2px across, 1px
   down).
2. **"Chubby" toy proportions.** Reduce vertical scale ~15-20%, broaden base
   footprints, chamfer sharp 90° corners by 1-2px. Current geometry is tall,
   thin and clinical; it must read as a solid toy.
3. **Outlines.** A strict **1px pure black (`#000000`)** outer outline around
   every object silhouette. **Internal** line art (drawer seams, folds) uses a
   *darker tint of the local surface colour*, never pure black. Plus a **1px
   bright accent line along the top-left edge** of top surfaces.
4. **3-tone shading, exactly 3 per material.** Implied **top-left** light.
   Top = highlight · left face = base · right face = shadow (~25% darker,
   shifted slightly blue/purple).

**Extend the existing `Iso.rampShade()`/`boxRamp()` helper** (added in V15) to
carry the black outline and the top-left highlight. Do **not** add a second
ramp — every prop must end up on one shared helper.

### 2.2 Specific object redesigns
- **Fridges (mini + full):** off-white body (`#E2E8F0` top / `#CBD5E1` left /
  `#94A3B8` right). 1px dark door seam with a rubber-gasket accent. Metallic
  handles with a 1px white glare dot. Scatter 2x2px cyan/pink/yellow magnets.
- **Bed:** warm wood frame (`#C47B49`) with dark grain lines. Blanket with
  2-tone diagonal crease lines and rounded fold-over corners. Pillow becomes a
  rounded squishy shape casting a shadow onto the mattress.
- **Pizza box tower:** offset the middle box 2px horizontally (lived-in, not
  perfectly stacked). 4-5px tall per box. 1px protruding lid lip on the
  front-left/front-right edges. Top `#D09263` with a `#EAC2A0` top-left
  highlight, left `#C47B49`, right `#96542B`. Each box casts a 1px `#633418`
  shadow line onto the lid below. A 6x6px pizza-slice logo or a green/red
  (`#388E3C`/`#D32F2F`) striped lid border. 2px dark side tabs, two 1x1px vent
  dots, and one irregular 3x2px `#A06030` grease spot.
- **Cactus:** segmented organic stems via stepped pixel curves (not blocky
  cubes), 1px pale-green/white spine dots along the edges. Terracotta pot
  (`#D97706` highlight / `#B45309` base) with a thick extruded rim casting a
  shadow onto the pot base.
- **Chairs (all tiers):** plush cushions with curved pixel corners; 1px dark
  shadow dots in a grid across the backrest for tufting; a metallic 5-point
  caster base with 2x2px wheel sprites. Give each tier its own variation.
- **Standing fan (CIRCULATION FAN):** a circular pixel cage with 1px dark
  diagonal grill lines and an implied 3-blade silhouette inside. It does not
  need to animate.

### 2.3 Environment
- **Walls.** Basement ONLY gets damage: jagged irregular `#8E7761` plaster
  patches, each bordered on its **bottom and right** edges by a 1px `#E8E2D5`
  cream line to read as wallpaper thickness. **Every other location is
  progressively more prestigious — no damage, distinct wall and floor colours
  that get richer with price.**
- **Windows:** thick wooden frames (`#A25B33`) with 1px white diagonal
  light-streak lines across dark glass.
- **Floors:** darker base (slate/warm brown). Basement only: jagged horizontal
  cutouts exposing `#5A3B30` wood planks split by 1px dark lines, with dark
  grey/black pixels on the **top-left interior** edge of each hole for inset
  depth.
- **Backdrops:** the basement's sky/houses/gradient concept is good and stays —
  but **houses currently float in places**. Fix the horizon so every building
  is grounded. Do not redesign the concept.

---

## 3. R3 — UI CHROME (`css/tokens.css`, `css/style.css`, `js/main.js`)

### 3.1 Palette (add as tokens; zero raw hex outside `tokens.css`)
- Containers: `#1B284A` / `#233863`
- Accents: cyan `#00E5FF`, neon green `#00FF66`, gold `#FFD000`
- **Bottom nav, one colour per tab:** TRAIN `#FFCC00` · PLAY `#FF5500` ·
  STREAM `#FF00A0` · CASES `#00CCFF` · SHOP `#77EE00`

### 3.2 Buttons — 3D and tactile
- A **darker shade of the button's own colour** as a solid bottom shadow edge,
  so it reads as a raised 3D block.
- **Press: depress 2px vertically and hide the lower shadow edge.** (`.btn`
  already translates 2px on `:active` — extend it to remove the shadow.)
- **Gloss:** a 45°, 1px diagonal highlight stripe across the top-left edge.
- Nav icons must be **authored pixel-art SVG** with their own 1px black
  outline — no emoji, no Unicode glyphs.

### 3.3 Modals
Outer 2px black border; inner 1px light stroke (e.g. `#3B82EC` inside dark
blue); 3px rounded pixel corner cut-outs.

### 3.4 Motion
- Floating world-space UI (the energy-drink can) bobs **±4px sinusoidally**.
- Red notification pips **pulse gently**.
- Respect `prefers-reduced-motion: reduce`.

**Do not touch `js/iso.js`** — R2 owns all canvas art.

---

## 4. DEFINITION OF DONE (all packages)
1. `node --check` clean; **zero raw hex outside `css/tokens.css`**.
2. All existing suites still pass: `test-v12-footprints.js`,
   `test-v13-rules.js`, `test-v14-phone.js`, `test-v15-banners.js`,
   `test-v15-tutorials.js`, `test-v15-rules.js`.
3. Verified live over HTTP at 420x860 on a **fresh save** — never `file://`.
4. Screenshots of what changed.
