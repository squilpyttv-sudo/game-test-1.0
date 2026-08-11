# VISUAL MAP — CS2 PRO SIMULATOR

Written visual inventory of every rendered element in the game, for planning the art-style redesign. Companion to the separately-built `visual-map.html` live gallery (not this document's job to render anything — this is the index).

All line numbers verified against the repo at the time of writing. Re-grep before trusting a line number if the file has since changed.

---

## PART 1 — CANVAS ART (`js/iso.js`, 1923 lines)

### 1.0 File shape

`js/iso.js` is one IIFE exposing `window.Game.Iso`. It has two layers of drawing code:

1. **Structural draw functions** (`function draw*`) — starfield, sky/backdrops, ground planes, room shell (floor/walls/windows), travel transition, packed box. 25 of these.
2. **`props.*` family renderers** — one function per prop family (desk, pc, monitor, chair, bed, plant, poster, rug, displayCase, rgb, trophy, energy, energyUp, cat), stored in the `props` object and dispatched via `drawFamily()`. 14 of these.

Primitives: `iso()` (13), `box()` (76), `diamond()` (96), `glow()` (105), `shade()` (28, lighten/darken a hex by `amount`), `hslToHex()` (43), `project()` (56), `rotatedBox()`/`rotatedDiamond()`/`rotatedLocalPoint()` (1155/1164/1176) — the rotation-wrapper trick every family opts into.

### 1.1 The 25 structural `draw*` functions

| Function | Line | Draws | Varies by |
|---|---|---|---|
| `drawPoly` | 62 | Generic filled+stroked polygon primitive | fill/stroke color args |
| `drawStarfield` | 214 | Seeded twinkling star field + radial sky gradient | time (twinkle), canvas size (star count/cache) |
| `drawSunMoon` | 295 | One shared sun→moon celestial body, crossfades and arcs toward horizon | `dnT` (day/night progress) |
| `drawGroundBase` | 332 | Shared linear-gradient ground fill (top→bottom color) every ground plane starts from | `topC`/`botC` args (per-location, per-dnT) |
| `drawGrassGround` | 349 | Textured green ground plane (grass patches, tuft strokes) | `dnT`, time |
| `drawSuburbanNight` | 398 | **Backdrop 1/6** — basement's suburban night skyline (houses silhouette) + calls `drawGrassGround` | time, `dnT` |
| `drawPavementGround` | 442 | Textured grey pavement/sidewalk ground plane | `dnT`, time |
| `drawNeonSkyline` | 502 | **Backdrop 2/6** — apartment's neon city skyline + calls `drawPavementGround` | time, `dnT` |
| `drawSandGround` | 548 | Textured sand/beach ground plane | `dnT`, time |
| `drawOceanSunset` | 588 | **Backdrop 3/6** — beach villa's ocean + sunset sky + calls `drawSandGround` | time, `dnT` |
| `drawLawnGround` | 644 | Textured manicured-lawn ground plane | `dnT`, time |
| `drawGravelPatch` | 665 | Small gravel-patch texture detail (used inside mansion backdrop) | `dnT` |
| `drawHillsGatedDrive` | 691 | **Backdrop 4/6** — mansion's gated-drive hills scene + calls `drawLawnGround`/`drawGravelPatch` | time, `dnT` |
| `drawDeckingGround` | 753 | Textured wood-decking ground plane | `dnT`, time |
| `drawRooftopHaze` | 779 | **Backdrop 5/6** — penthouse's rooftop haze skyline + calls `drawDeckingGround` | time, `dnT` |
| `drawWaterlineGround` | 850 | Textured waterline/shore ground plane | `dnT`, time |
| `drawIslandShore` | 892 | **Backdrop 6/6** — private-island shore scene + calls `drawWaterlineGround` | time, `dnT` |
| `drawBackdrop` | 956 | Dispatches to one of the 6 backdrop fns via the `BACKDROPS` map (947) | `backdropId` |
| `drawVanShape` | 990 | The moving-truck van sprite (body, windshield, wheels) | scale only (no tier/state) |
| `drawTravelTransition` | 1016 | Moving-minigame travel beat: van drives across a road strip, backdrop swaps mid-transition | `t` (progress 0..1), `fromBackdropId`/`toBackdropId` |
| `drawPackedBox` | 1473 | A placed prop that's been packed during the moving minigame renders as a cardboard crate with a pop-in grow animation | `packTime` age |
| `drawFamily` | 1586 | Dispatches `gx,gy,tier,camera,time,rot` to the right `props.*` fn | `familyId` |
| `drawFloor` | 1593 | Checkerboard floor tiles (`floorA`/`floorB` alternating) + plank/tile seam line | `roomTier.floorA/floorB` |
| `wallQuad` | 1614 | Fills+strokes one wall polygon | color |
| `wallTexture` | 1620 | Plaster speckle + vertical panel seams, clipped to a wall quad | wall color, seed |
| `drawWindowAt` | 1662 | One recessed window: frame, dark glass, 3 star-pixel highlights | wall color |
| `drawWalls` | 1676 | Both room walls (left/right), skirting boards, and N windows positioned along them | `roomTier.wallColor/trimColor/windows` |

Also structural but not `draw*`-named: `renderRoom` (1729, main entry point), `pickProp` (1837, hit-testing), `renderPropIcon` (1885, draws a single prop into a small icon canvas for shop/inventory UI), `getRoomVisual` (166), `computeCamera` (1050), `screenToGrid` (~1090s).

### 1.2 `Iso.propMap` — every shop item → {family, tier}

Source: `js/iso.js:1487-1530`. Cross-referenced against `Data.shopItems` (`js/data.js`) for name/price.

| Family | Tiers | Item id | Name | Price | Notes |
|---|---|---|---|---|---|
| **desk** | 0–3 | `desk_plywood` | PLYWOOD DESK | 80 | starter |
| | | `desk_ikea` | FLATPACK DESK | 220 | starter; also the default-placed starting desk |
| | | `desk_gaming` | RGB DESK RIG | 1800 | pro; tier≥2 gets RGB underglow strip |
| | | `desk_battlestation` | BATTLESTATION DESK | 18000 | elite; tier≥3 gets cable-tray riser panel |
| **pc** | 0–3 | `pc_budget` | BUDGET RIG | 150 | starter; also default-placed |
| | | `pc_midrange` | MID TOWER RIG | 2500 | pro |
| | | `pc_watercooled` | WATERCOOLED RIG | 6000 | pro; tier≥2 gets extra glass-panel highlight box |
| | | `pc_elite_rig` | ELITE HALO RIG | 40000 | elite |
| **chair** | 0–2 | `chair_wooden` | WOODEN CHAIR | 60 | starter; also default-placed |
| | | `chair_gaming` | RACER CHAIR | 1200 | pro |
| | | `chair_pro_esports` | PRO ESPORTS SEAT | 15000 | elite; tier≥2 gets yellow RGB accent strip |
| **monitor** | 0–2 | `monitor_basic` | BASIC MONITOR | 60 | starter; also default-placed |
| | | `monitor_144hz` | 144HZ MONITOR | 1500 | pro; tier≥1 gets thin RGB top trim |
| | | `monitor_240oled` | 240HZ OLED MONITOR | 20000 | elite; tier≥2 gets slim curved OLED accent bar |
| **poster** | 0–1 | `poster_team` | TEAM POSTER | 40 | starter; orange/purple art panel by tier |
| | | `window_blinds` | MINI BLINDS | 70 | starter — shares the `poster` family/silhouette (see OBSERVATIONS) |
| **plant** | 0 | `plant_succulent` | SUCCULENT | 30 | starter — only 1 tier |
| **rug** | 0–1 | `rug_pixel` | PIXEL RUG | 50 | starter; red base |
| | | `lucky_mousepad` | LUCKY MOUSEPAD | 8000 | elite — shares the `rug` family/silhouette despite being a very different-tier item (see OBSERVATIONS); gold base |
| **energy** (decor) | 0 | `energy_drink_stack` | ENERGY DRINK STACK | 90 | starter — only 1 tier, 4-can static decor prop |
| **rgb** | 0–1 | `rgb_strip` | RGB LED STRIP | 600 | pro; hue-cycling strip + glow |
| | | `neon_sign` | NEON SIGN | 1400 | pro — shares the `rgb` family; tier 1 adds a second cycling bar |
| **trophy** | 0 | `trophy_shelf` | TROPHY SHELF | 3000 | pro — only 1 tier |
| **cat** | 0 | `cat_bed` | STREAM CAT BED | 900 | pro — only 1 tier, animated idle bob |
| **bed** | 0–4 | `bed_mattress` | FLOOR MATTRESS | 0 | starter, default-placed, `sleepRate` 2.5 |
| | | `bed_single` | SINGLE BED | 400 | starter, `sleepRate` 3.5 |
| | | `bed_memoryfoam` | MEMORY FOAM BED | 2500 | pro, `sleepRate` 5.0, `plush` variant |
| | | `bed_kingsize` | KING SIZE BED | 12000 | pro, `sleepRate` 7.0, `wide` variant (2 pillows) |
| | | `bed_cryopod` | CRYO SLEEP POD | 90000 | elite, `sleepRate` 10.0, `pod` variant — sealed capsule + pulsing glow, no pillow |
| **energyUp** | 0–3 | `energy_can` | ENERGY DRINK | 20 | starter (consumable, `requiresFridge`) — can |
| | | `energy_minifridge` | ENERGY DRINK MINIFRIDGE | 2000 | pro — waist-height fridge, flickering shelf line |
| | | `energy_fridge` | ENERGY DRINK FRIDGE | 15000 | pro — full-height glass-front fridge |
| | | `energy_ivdrip` | ENERGY IV DRIP | 80000 | elite — IV stand with pulsing bag |

All 14 families in one table above (28 shop item ids total map into them). `displayCase` is a 15th prop renderer (line 1388) but it is NOT in `propMap` / not shop-placeable — it's static room furniture drawn directly by `renderRoom` when `state.displayCase.items.length > 0` (line 1820-1822), showing up to 3 trophies scaled by count.

### 1.3 Rotation behaviour

Per the `ROTATING_FAMILIES` map (1581-1584), **every** family (`desk, chair, pc, monitor, bed, plant, poster, rug, rgb, trophy, energy, energyUp, cat`) opts into rotation via `rotatedBox`/`rotatedDiamond`. `rug` is geometrically symmetric (a centered diamond) so rotation is a no-op for it visually, but it is still wired through the same mechanism (see comment at 1375-1386) — no family is exempt by design. `displayCase` (static furniture, not in `propMap`) has no rotation concept.

### 1.4 Backdrops and grounds (6 + 6, one pair per location)

`BACKDROPS` map, `js/iso.js:947-954`. Each backdrop function internally calls exactly one ground function (verified by grep) — they are a fixed 1:1 pair, not independently combinable. Location data: `Data.locations`, `js/data.js:562-568`.

| Location id | Name | `backdrop` id | Backdrop fn | Ground fn | gridW×D |
|---|---|---|---|---|---|
| 0 | PARENTS' BASEMENT | `suburban_night` | `drawSuburbanNight` (398) | `drawGrassGround` (349) | 6×6 |
| 1 | CITY CENTRE APARTMENT | `neon_skyline` | `drawNeonSkyline` (502) | `drawPavementGround` (442) | 7×7 |
| 2 | BEACH VILLA | `ocean_sunset` | `drawOceanSunset` (588) | `drawSandGround` (548) | 8×8 |
| 3 | ESPORTS MANSION | `hills_gated_drive` | `drawHillsGatedDrive` (691) | `drawLawnGround` (644) + `drawGravelPatch` (665) | 9×9 |
| 4 | PENTHOUSE SUITE | `rooftop_haze` | `drawRooftopHaze` (779) | `drawDeckingGround` (753) | 10×10 |
| 5 | PRIVATE ISLAND COMPOUND | `island_shore` | `drawIslandShore` (892) | `drawWaterlineGround` (850) | 11×11 |

Fallback: `drawBackdrop` (956) defaults to `drawSuburbanNight` if `backdropId` is unrecognized.

### 1.5 Room shell — floor/wall materials per location

`LOCATION_VISUALS` array, `js/iso.js:151-161` — indexed by `locationId` (0-5, same order as the table above), consumed by `getRoomVisual()` (166-181). NOT the same as the legacy `Data.roomTiers`, which was **deleted** (TASKS-REMAINING #5) — a tombstone comment sits where it used to be in `js/data.js`. Note that `roomTier` survives as a *local parameter name* inside `js/iso.js` (`computeCamera`/`drawFloor`/`drawWalls`/`wallTexture`); those receive a `LOCATION_VISUALS`-derived object and never referred to the deleted table.

| Loc | wallColor | floorA | floorB | trimColor | windows |
|---|---|---|---|---|---|
| 0 basement | `#b99a76` | `#c9a06a` | `#b78a54` | `#8a6a45` | 2 |
| 1 apartment | `#c7ae8c` | `#d6b98a` | `#c4a06e` | `#7a5f42` | 3 |
| 2 beach villa | `#eee0ba` | `#f3e2a8` | `#e0c980` | `#3aa7a0` | 3 |
| 3 mansion | `#e9dcc0` | `#f0dfa0` | `#dcc37e` | `#c9a04a` | 4 |
| 4 penthouse | `#cfd6e2` | `#8f97a6` | `#7c8494` | `#2c3140` | 5 |
| 5 island | `#f2e6c9` | `#e8d6ab` | `#d9c08a` | `#2a9d8f` | 5 |

- `drawFloor` (1593): checkerboard of `floorA`/`floorB` by `(gx+gy)%2`, plus a shaded seam line per tile.
- `drawWalls` (1676): left wall shaded `shade(wallColor,-0.05)`, right wall `shade(wallColor,-0.30)` (fake directional light), both get `wallTexture` (speckle+seams), plus a skirting board (`SKIRT_H=5`) in `trimColor`.
- `drawWindowAt` (1662): windows count/placement driven by `roomTier.windows`, split `Math.ceil(n/2)` on right wall / `Math.floor(n/2)` on left wall, evenly spaced.
- Grid size for rendering is NOT read from `Data.locations` directly — it comes from `State.currentGrid()` (base size + purchased expansions), only falling back to `loc.gridW/gridD` if `State` is unavailable (line 171-174).

### 1.6 Day/night threading

- `renderRoom(ctx, canvasW, canvasH, state, opts)` (1729): reads `opts.sunsetProgress` (a 0..1 float from `State.dayPhase().sunsetProgress`) into local `dayNightT`. 0 = day, ramps across a 60s sunset window, 1 = locked for all of night (comment at 239-243).
- Threaded as `dnT` into: `drawBackdrop` → the 6 backdrop fns → `skyGradient` (262, 3-stop day/sunset/night color ramp via `stopColor()`), `drawSunMoon` (295, sun sinks & fades out 0.45-0.75 dnT, crossfades to a moon rising 0.55-0.85 dnT), `starOverlay` (274, stars fade in 0.35-0.85 dnT), and each ground fn (grass/pavement/sand/lawn/decking/waterline all take `dnT` for their own color ramps).
- `ambientOverlay(ctx,w,h,dnT)` (966-984): applied LAST, over the whole rendered scene (backdrop+floor+walls+props+glows) — a warm `#ff9d5c` "lighter"-blend wash peaking at dnT=0.5 (sunset midpoint), plus a cool `#0a1030` wash building in from dnT=0.12 to full night. This is the only place room/prop pixels themselves get tinted by time of day — individual props do not each have their own day/night branch.
- Room walls/floor/props do NOT change base color by day/night (no separate night palette) — only the ambient overlay wash and the backdrop/ground/sky do.

### 1.7 States that vary canvas art

| State | What changes | Where |
|---|---|---|
| Tier (0-4 depending on family) | Palette + added detail boxes (RGB strips, trim, accent bars) — see table in 1.2 | each `props.*` fn |
| Rotation (0-3, ×90°) | Every family's whole silhouette rotates in place via `rotatedBox`/`rotatedDiamond` | 1155-1182 |
| Day/night (`dnT` 0..1) | Sky, sun/moon, stars, ground color ramps, whole-scene ambient wash | see 1.6 |
| Room tier / location (0-5) | Wall/floor/trim palette, window count, backdrop, ground | `LOCATION_VISUALS`, `getRoomVisual` |
| Packing (moving minigame) | Prop replaced by `drawPackedBox` cardboard crate with pop-in grow anim | 1473-1484, 1786-1789 |
| Edit-mode highlight | Semi-transparent green/red tile overlay under drag-hover | 1753-1766 |
| Travel transition | Backdrop A → van drives across → backdrop B | `drawTravelTransition`, 1016+ |

### 1.8 Literal color palette actually used in canvas art

Canvas cannot read CSS variables, so every color below is a raw hex literal in `js/iso.js`. Colors repeated across ≥2 unrelated families/contexts are flagged — these are the highest-leverage single edits for a redesign since changing one constant would need to be replicated everywhere it's inlined.

| Hex | Used for | Repeated in |
|---|---|---|
| `#ffd54a` (amber/gold) | chair tier-2 RGB strip (1275), rug tier-1 base (1383), trophy cup studs ×3 (1413-1415), monitor... | **4 unrelated families** (chair, rug, trophy, + energy fridge accent `#ffc93c` is a near-neighbor) |
| `#34d3ff` (cyan) | monitor tier-0 glow (1253), rug/energy/cat glows, bed cryo-pod blanket/glow (1290,1333), energy fridge shelf light (1439/1444), old hardcoded pillow color per the §23 fix comment (1292-1300, now replaced) | **PC accent tier-1** (`accentPal[1]`, 1221), **monitor glow tier-0**, **bed cryopod**, **energy fridge** — de facto "the cyan accent" used everywhere without a shared constant |
| `#ff4b4b` (red) | energy drink can body (1432, 1422 cols[0]), energy fridge accent box (1445), edit-mode invalid-highlight tile (1763) | prop art AND UI-state color reused for the same "red = X" meaning, worth checking for consistency |
| `#3ddc84` (green) | bed tier-1 blanket (1287), edit-mode valid-highlight tile (1763), energy-drink can col (1422) | prop art AND UI-state semantic green |
| `#8847ff` (purple) | poster tier-0 art color (1370), desk tier≥2 RGB underglow (1214), rug tier-1... no — bed tier-2 blanket (1288) | 3 unrelated families |
| `#20263e` / `#151a2c` (dark navy-black) | Used as a near-black "frame/bezel/base" color in monitor stand (1260-1261), chair base (1272), poster frame (1371), trophy base pegs (1411-1412), PC no... | generic "dark chassis" color, repeated 5+ times, never centralized as a constant |
| `#eaf0ff` (near-white) | window star-pixel highlight (1669), edit-highlight stroke (1763), sun body highlight tone family | shared "bright highlight" white |
| `#8a94c0` (muted blue-grey) | minifridge shelf (1437), full fridge shelf (1442), IV stand hardware ×3 (1449-1450,1453) | shared "brushed metal" tone across the whole energyUp family |
| `#c79a5c` / `#8a6238` (cardboard tan/brown) | `drawPackedBox` crate body/flaps (1481-1483) — unique to packing, not reused elsewhere | — |

No shared `COLORS` or palette constant object exists anywhere in `iso.js` — every family hand-rolls its own hex literals inline, including ones that clearly intend to mean the same thing (see OBSERVATIONS).

### 1.9 Other `Iso.`-exported drawing entry points

Full export list, `js/iso.js:1897-1922`:

| Export | Line def | Purpose |
|---|---|---|
| `renderRoom` | 1729 | Main per-frame room render (floor, walls, backdrop, props, glows, ambient overlay) |
| `drawTravelTransition` | 1016 | Moving-minigame van/backdrop-swap transition |
| `drawFamily` | 1586 | Draw one prop family at a tile |
| `pickProp` | 1837 | Hit-test screen coords → placed prop (for tap/drag in edit mode) |
| `renderPropIcon` | 1885 | Draws a single prop onto a small icon `<canvas>` (used by shop/inventory listings) — isometric diamond floor tile + the prop, camera fixed at `{ox:w/2, oy:h*0.66}` |
| `propMap` | 1487 | The item-id → {family,tier} table (1.2 above) |
| `props` | 1184 | Raw family-renderer map |
| `getRoomVisual` | 166 | state → {gridW,gridD,wallColor,floorA,floorB,trimColor,windows,backdrop,name} |
| `box`, `diamond`, `glow`, `project`, `iso`, `shade`, `hslToHex`, `computeCamera`, `screenToGrid`, `rotatePoint`, `CATEGORY_ORDER` | various | Primitives/utilities reused by `hub.js` for ghost-preview drawing during placement |

`drawPackedBox` (1473) and `displayCase` prop (1388) are used internally by `renderRoom` but not separately exported — a redesign touching them must edit `iso.js` directly, not call them from `hub.js`.
