# CS2 PRO SIMULATOR — ART DIRECTION (V15 REDESIGN)

Companion to `VISUAL-MAP.md` (what exists today) and `visual-map.html` (what it
actually looks like, rendered). This file is **what it becomes**.

Direction **pinned by the owner**: take inspiration from *PewDiePie's Tuber
Simulator* (references in `inspo/`), do not copy it, and give it our own twist.
No concept exploration is owed here — the brief decides the world, and this
document only resolves how to execute it.

---

## 1. THE DIAGNOSIS — why the current look reads as "AI slop"

This is not a vague feeling; it is a specific, nameable cluster.

| Current | Effect |
|---|---|
| Near-black navy ground (`--bg-space #070a16`) everywhere | Nothing has weight; every surface recedes |
| Thin neon accents on dark | The single most over-produced AI interface look there is |
| **No outlines on anything** | Props and tiles dissolve into the background |
| Monospace system stack | Reads "technical dashboard", not "toy" |
| `box-shadow: 0 3px 0` as the only depth cue | A drop shadow is not a bevel; objects look printed, not moulded |
| Props drawn on a dark ground with mid-tone faces | Silhouettes are mush at 420px |

The reference does the opposite on every single line. **The gap is not talent,
it is contrast and edges.**

---

## 2. THE FIVE MOVES THAT DO 80% OF THE WORK

Ordered by impact-per-effort. If we only ever did these, the game would already
stop looking generic.

### 2.1 Outline everything
A **2px near-black outline** on every prop, tile, button, card and icon.
Not pure black — `--outline: #0b0e1c`, a blue-black that belongs to our world.

This single change is the largest visual difference between our art and the
reference. It is also cheap: for canvas props it is one stroke pass per shape.

### 2.2 A fixed isometric shading ramp
Today each prop is shaded ad hoc, which is why tiers and families don't feel
like one set. Every prop adopts **one ramp**, derived from its base colour:

| Face | Multiplier |
|---|---|
| Top | **×1.30** (lightest — catches the light) |
| Left | **×1.00** (base) |
| Right | **×0.70** |
| Outline | **×0.35**, or `--outline`, whichever is darker |

Cohesion for free, and it is what makes the reference's furniture read as a
family rather than a pile of assets.

### 2.3 Raise the value of the UI ground
The reference's panels are **mid-blue**, not near-black. Ours are `#1b2140`.
Introduce a brighter surface family for cards and tiles while keeping deep navy
for the app frame and the room's sky. Props then sit on something, instead of
floating in a void.

### 2.4 Real bevels, not drop shadows
Replace the single hard drop shadow with a three-part edge:
```
outer 2px  --outline           (near-black)
inner top 2px  base ×1.35      (light)
inner bottom 2px  base ×0.65   (dark)
```
That is what makes the reference's tiles feel pressable.

### 2.5 Kill every Unicode glyph used as an icon
`✉ ▲ ▼ ✓ ✗ ↻ 🔥 ❄` are currently doing icon duty. All become **authored SVG**,
24×24 viewBox, 2px stroke, `currentColor` — the standard the phone already set.
`VISUAL-MAP.md` Part 5 carries the exhaustive list.

---

## 3. OUR OWN TWIST — ESPORTS BROADCAST

The reference is a YouTube bedroom. We are a CS2 career. Same chunkiness and
edge language, different personality:

- **Section headers as broadcast lower-thirds** — an angled cut corner and a
  team-colour bar, instead of a centred pill.
- **Numbers get scoreboard chrome** — the tournament match animation already
  found this register; push it everywhere numbers matter (cash, ELO, viewers).
- **Sponsors read as arena banners**, not shop cards.
- **Room backdrops move toward LAN-arena neon** — stage lighting, crowd haze,
  rig glow — rather than generic city skylines.
- **Rarity keeps CS's own language.** `--r-milspec` through `--r-covert` are
  real CS2 rarity colours and are already correct. Do not redesign these.

**What we deliberately do NOT take:** their palette wholesale, their icon
drawings, their mascot, the "Tap!" card layout, their exact wallpaper motifs.

---

## 4. TYPOGRAPHY — the hard constraint, resolved

No external assets is a hard project rule (it is why the game runs from
`file://` with zero dependencies), so a pixel webfont is out.

**Decision (owner-confirmed): hand-author a bitmap font as code.**

- A **5×7 pixel glyph grid**, uppercase A–Z, 0–9, and `$ % / . , : + - ! ? ' "`.
- Drawn as filled rects on canvas, with a 1px `--outline` offset so lettering
  carries the same edge language as everything else.
- Stored as compact per-glyph bit patterns in a new `js/pixelfont.js`.

**Where it is used:** canvas-drawn text — in-room labels, minigame HUDs, the
match animation's scoreboard, big reward numbers, screen titles rendered into a
small canvas.

**Where it is not:** long DOM copy (sponsor obligations, item descriptions,
tutorial text). Those stay in the monospace stack with tightened tracking and a
1px dark `text-shadow` so they sit in the same world.

**Honest risk:** this is the least certain item in the batch. A hand-made
bitmap font is a real chunk of authoring, and if it lands mediocre it will look
worse than the monospace it replaced. Build it as **one standalone module,
proven in the gallery before any screen adopts it** — never as a step inside a
bigger package.

---

## 5. PALETTE

Keep every existing **resource** colour. They are already saturated, already
meaningful, and already correct: cash green, views cyan, subs pink, energy
yellow, ELO orange, danger red, gold. The redesign is not a recolour of
meaning — it is a change of ground and edge.

Add:

| Token | Role |
|---|---|
| `--outline` | the universal near-black edge |
| `--surface` / `--surface-hi` / `--surface-lo` | the raised mid-value card family (§2.3) |
| `--bevel-hi` / `--bevel-lo` | the two inner bevel edges |
| `--wallpaper-ink` | the tiled background motif, used at very low alpha |

**Category owns a hue** on tiles, as the reference does — the phone's app tiles
already prove the pattern works in our world.

---

## 6. BACKGROUNDS

Flat panels become **tiled motif wallpaper**, built from repeating CSS
gradients (no external assets): a faint crosshair / scoreboard grid at ~4%
alpha. The reference varies wallpaper hue per section; we do the same per
screen family, which also helps the player know where they are.

---

## 7. STATES — inherit the reference's discipline

- **Locked**: shown, never hidden — desaturated, padlock, and the unlock
  condition as the label. We already do this on the phone and on social
  platforms; make it universal.
- **Unowned / unaffordable**: dimmed but the silhouette stays readable.
- **Disabled**: greyscale + reduced brightness, never invisible.
- **Notification**: chunky outlined red badge, overlapping the tile's corner.

---

## 8. ROLLOUT ORDER

Deliberately cheapest-and-most-visible first, so value lands early and the
riskiest work happens once the language is proven.

| Phase | Scope | Why here |
|---|---|---|
| **1** | Tokens + bevel/outline primitives (`tokens.css`, `.btn`, `.panel`, badges) | Every screen inherits it at once. Highest impact per line changed. |
| **2** | The isometric shading ramp + outlines across all ~30 props | The room is the game's face. One shared helper in `iso.js`, applied everywhere. |
| **3** | Icon sweep — every Unicode glyph → authored SVG | Small, mechanical, and removes the last obviously-cheap detail. |
| **4** | The pixel font module, proven standalone in the gallery | Highest risk; do it once the world around it is settled. |
| **5** | Backdrops and grounds → LAN-arena direction | Largest canvas authoring job; benefits from the ramp existing first. |
| **6** | Per-screen chrome: lower-thirds, wallpaper, scoreboard numbers | Polish pass over a world that already reads correctly. |

**Phase 1 and 2 alone should be enough to judge whether the direction is
right.** Stop and look after Phase 2 rather than committing the whole batch.

---

## 9. RISKS, NAMED

- **The font may not land.** Mitigated by building it standalone (§4).
- **Canvas art is code, not files.** Every prop is a hand-written draw
  function; a restyle means editing ~30 of them. The shared ramp helper is what
  keeps this from being 30 independent redesigns.
- **Tokens-only CSS is a real constraint.** New colours must become tokens
  first, or the batch will quietly grow raw hex across eight stylesheets.
- **Contrast can regress.** Raising surface values (§2.3) risks dropping text
  contrast below 4.5:1. Every new surface/ink pair gets checked, not eyeballed.
- **420×860 is unforgiving.** A 2px outline at that size is proportionally
  heavy; verify at real scale, never zoomed.
