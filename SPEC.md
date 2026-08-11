# CS2 PRO SIMULATOR — V1 Implementation Spec (CONTRACT)

This file is the **binding contract** between parallel implementation tasks.
Do not change any API described here. Add files only where your task says.

---

## 0. Tech constraints (hard rules)

- **Vanilla JS, zero dependencies, zero build step.** `index.html` must work by
  double-clicking it from the filesystem (`file://`).
- Therefore: **NO ES modules**, no `import`/`export`, no `type="module"`.
  Use classic `<script>` tags and attach to the global `Game` namespace.
- No external fonts, images, or CDN links. All art is drawn procedurally on
  `<canvas>` or built from CSS. Everything offline.
- Target viewport: **mobile portrait, 420×860 logical**, centered on desktop in a
  phone frame. Must also fill the screen on a real phone.
- Canvas art uses `imageSmoothingEnabled = false` and CSS
  `image-rendering: pixelated` for a crisp pixel look.

---

## 1. Visual identity (design tokens)

Defined in `css/tokens.css` as CSS custom properties. **Use these names, never
raw hex, in any other CSS file.**

```
--bg-space:      #070a16   /* starfield backdrop behind the room */
--bg-deep:       #0d1226
--panel:         #1b2140   /* UI panel fill */
--panel-hi:      #2a3260   /* raised panel */
--panel-lo:      #121734   /* inset panel */
--border:        #3d4a80   /* 2px chunky panel border */
--border-hi:     #6b7ac4   /* top/left highlight edge */
--ink:           #eaf0ff   /* primary text */
--ink-dim:       #97a3d0   /* secondary text */

--cash:          #3ddc84   /* money green */
--views:         #34d3ff   /* viewers cyan */
--subs:          #ff4d9d   /* followers pink */
--energy:        #ffc93c   /* energy yellow */
--elo:           #ff8a1f   /* rank orange */
--danger:        #ff4b4b   /* toxic / loss */
--gold:          #ffd54a   /* prestige / rare */

--r-consumer:    #b0c3d9
--r-milspec:     #4b69ff
--r-restricted:  #8847ff
--r-classified:  #d32ce6
--r-covert:      #eb4b4b
--r-rare:        #ffd700   /* knives / gloves */
```

**UI chrome style:** chunky 2px borders, 3px hard drop shadows (no blur),
uppercase headings with `letter-spacing: 1px`, buttons that translate down 2px
on `:active`. Font stack:
`ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace`.
No rounded corners above `4px` — this reads as pixel UI.

---

## 2. Isometric rendering technique (shared)

Both the game and the mockups draw the room the same way: **shaded cuboids in
2:1 isometric projection.** This is what makes it look like the reference art.

Projection, tile size 32×16 (half-tile 16×8), z is height in px:

```js
function iso(x, y, z) {           // grid coords -> screen coords
  return {
    sx: (x - y) * 16,
    sy: (x + y) * 8 - z
  };
}
```

`box(ctx, x, y, z, w, d, h, color)` draws one cuboid:
- **top face** = `color` lightened ~22%
- **left face** = `color` at base value
- **right face** = `color` darkened ~28%
- 1px darker outline on every face seam

Provide `shade(hex, amount)` returning a hex string (`amount` in `-1..1`).
Every prop (desk, PC tower, monitor, chair, bed, plant, poster, display case) is
assembled from 2–8 boxes. Sort draw order by `x + y + z` ascending (painter's
algorithm) so overlaps resolve correctly.

Room floor is a diamond of tiles with a subtle checker; two walls rise at the
back-left and back-right edges. Add a soft radial "monitor glow" (additive,
low alpha) around lit props — it sells the scene.

---

## 3. Global namespace & module layout

```
window.Game = {
  State,      // js/state.js   — save data + mutations
  Data,       // js/data.js    — static catalogs
  Iso,        // js/iso.js     — renderer
  Router,     // js/router.js  — screen switching
  UI,         // js/ui.js      — toasts, number formatting, sfx
  Hub,        // js/hub.js
  Shop,       // js/shop.js
  Career,     // js/career.js
  Aim,        // js/aim.js     ← minigames task
  Stream,     // js/stream.js  ← minigames task
  Cases       // js/cases.js   ← minigames task
}
```

### 3.1 Router API (owned by core task, consumed by minigames task)

```js
Game.Router.register(name, {
  onEnter(params) {},   // build DOM into the screen root, start loops
  onExit() {}           // tear down, cancel rAF/intervals
});
Game.Router.go(name, params);   // switch screens
Game.Router.back();             // return to 'hub'
Game.Router.root(name);         // -> the <div class="screen" id="screen-<name>">
```

Screens live in `#screen-stack`. Exactly one has class `is-active`.
Screen names: `hub`, `aim`, `stream`, `cases`, `shop`, `career`.

### 3.2 UI helpers (owned by core, consumed by everyone)

```js
Game.UI.toast(text, kind)         // kind: 'good'|'bad'|'info'
Game.UI.money(n)                  // 1234.5  -> "$1.23k"
Game.UI.compact(n)                // 25510000 -> "25.51m"
Game.UI.beep(kind)                // WebAudio blip: 'hit'|'miss'|'ban'|'cash'|'rare'|'click'
Game.UI.confetti(el, color)       // cheap particle burst
Game.UI.rewardCard({title, lines, color, onClose})  // full-screen result modal
```

`Game.UI.beep` must synthesize with `AudioContext` oscillators only — no audio
files. Respect `Game.State.data.settings.sound`.

### 3.3 State API (owned by core)

```js
Game.State.data                   // the live save object (schema in §4)
Game.State.load() / save()        // localStorage key 'cs2sim.v1'
Game.State.reset()
Game.State.spend(amount) -> bool  // false if broke
Game.State.earn(amount)
Game.State.useEnergy(n) -> bool
Game.State.gearBonus()            // -> {aim, stream, income, prestige, luck}
Game.State.rank()                 // -> {name, tier, color, next, progress}
Game.State.endDay()               // advance day, pay salary+idle, decay chemistry
Game.State.on(event, fn)          // 'change' fires after any mutation
```

Every mutation must call the internal `emit('change')` so the top bar re-renders.

---

## 4. Save schema

```js
{
  v: 1,
  day: 1,
  cash: 250,
  elo: 120,
  energy: 100, energyMax: 100,
  followers: 0,
  peakViewers: 0,
  hype: 0,              // scout interest 0..100
  chemistry: 0,         // 0..100, only meaningful when signed
  form: null,           // {grade:'S', mult:1.0, day:1} — set by aim trainer, cleared on endDay
  contract: 'free',     // 'free' | 't3' | 't2' | 't1'
  scrimsToday: 0,
  roomTier: 0,          // 0 bedroom, 1 apartment, 2 mansion
  owned: { 'desk_ikea': 1, ... },     // itemId -> count
  placed: [ {id:'desk_ikea', x:2, y:3, rot:0} ],
  inventory: [ {skin:'ak_redline', wear:'FT', value:12.4, id:'uuid'} ],
  stats: { matches:0, wins:0, streams:0, casesOpened:0, bestPull:0 },
  settings: { sound: true }
}
```

---

## 5. Game systems (formulas — implement exactly)

### 5.1 Energy & the day
- `energyMax = 100`, restored fully by `endDay()`.
- Costs: **TRAIN 10**, **PLAY 25**, **STREAM 20**, **SCRIM 20**. Cases/Shop free.
- `endDay()`: `day++`, energy → max, `form = null`, `scrimsToday = 0`,
  pay `salary/30`, pay idle income `gearBonus().income` (per day),
  then chemistry upkeep (§5.5).

### 5.2 Aim trainer → daily form
Grades and multipliers (`M_form`):

| Grade | Label | M_form |
|---|---|---|
| S | IN THE ZONE | 1.00 |
| A | LOCKED IN | 0.70 |
| B | SOLID | 0.45 |
| C | AVERAGE | 0.25 |
| D | SHAKY | 0.10 |
| F | TILTED | 0.00 |

S-rank also grants `hype += 4`.

### 5.3 Match (PLAY)
```
ELO_base = 22 + rand(0..8)
dELO     = ELO_base * (1 + M_form) + B_gear.aim
winChance = clamp(0.30 + 0.35*M_form + B_gear.aim/120 + chemBonus, 0.05, 0.92)
   chemBonus = signed ? (chemistry-50)/300 : 0
```
- Win → `elo += dELO`, earnings `= 40 + elo*0.05 + rand(0..30)`, `hype += 1`.
- Loss → `elo -= dELO * 0.55` (floor 0), earnings `= 12 + rand(0..10)`.
- If no `form` set today, `M_form = 0` **and** show a nudge toast to TRAIN first.
- Present the result as a `rewardCard` with a short animated scoreline
  (e.g. `13 : 9`) — this is the dopamine beat, make it feel good.

### 5.4 Ranks (by elo)
```
0    SILVER            #9aa4b8
250  GOLD NOVA         #d9a441
500  MASTER GUARDIAN   #59b3d9
800  DMG               #4b69ff
1100 LEGENDARY EAGLE   #8847ff
1400 SUPREME           #d32ce6
1750 GLOBAL ELITE      #eb4b4b
2100 FACEIT 10         #ff6b00
2600 PRO               #ffd54a
```

### 5.5 Contracts & chemistry
| id | Name | Requirement | Salary/mo | Scrim quota (energy/day) |
|---|---|---|---|---|
| free | FREE AGENT | — | 0 | 0 |
| t3 | TIER 3 — LOCAL | elo ≥ 2100 (FACEIT 10) | $500 | 30 |
| t2 | TIER 2 — PRO | contract t3 + hype ≥ 60 | $3,500 | 45 |
| t1 | TIER 1 — ELITE | contract t2 + elo ≥ 2600 + chemistry ≥ 70 | $25,000 | 60 |

- SCRIM action: `chemistry += 12` (cap 100), `scrimsToday += 20` energy counted.
- On `endDay()`, if signed and `scrimsToday < quota`: `chemistry -= 15`,
  toast **"COACH IS FURIOUS"**. If `chemistry < 30`, block Tier-1 offers.
- Offers appear on the Career screen when requirements are met — the player must
  actively **SIGN** (a modal with salary and the time cost spelled out).

### 5.6 Cases (authentic CS odds)
Cost **$2.50**. Roll:

| Rarity | Chance | Value range | Color token |
|---|---|---|---|
| Mil-Spec | 79.92% | $0.10 – $3 | --r-milspec |
| Restricted | 15.98% | $2 – $12 | --r-restricted |
| Classified | 3.20% | $10 – $60 | --r-classified |
| Covert | 0.64% | $40 – $300 | --r-covert |
| Rare Special (knife/glove) | 0.26% | $300 – $5000 | --r-rare |

`gearBonus().luck` (0..0.5) shifts odds: move `luck * 0.5` of the Mil-Spec
probability mass proportionally into the three top tiers.

- The reveal is a **horizontal roulette strip** of ~60 tiles that scrolls fast
  and eases out onto the winner, with a center marker. Ticking sound per tile
  passing the marker. This must feel authentic — it is the retention hook.
- Items go to `inventory`. Player can **SELL** (adds `value` to cash) or
  **DISPLAY** (Covert/Rare only → unlocks a display-case room prop granting
  `prestige`).

### 5.7 Stream (chat moderation)
- Chat lines scroll **upward**. ~15% of lines are red **TOXIC** lines.
- Tapping a toxic line = BAN → `hype meter += 8`, combo++.
- A toxic line reaching the top = `tilt += 12` (0..100). Tapping a *normal*
  viewer = false ban → `tilt += 6`, combo reset.
- `tilt >= 100` → stream ends early, halved payout, toast "STREAM SNIPED".
- Hype meter full (100) → **SUB HYPE TRAIN**: 8 seconds of cash rain,
  3× earnings, screen-wide particle burst, viewers spike.
- Session length **45s**. Payout:
  `cash = (8 + followers*0.02) * seconds/10 * (1 + gear.stream) * hypeMult`
  `followers += viewers * 0.05`
- **Case synergy:** a "OPEN CASE ON STREAM" button is live during the session.
  Pulling Covert or Rare while streaming sets a **10× viewer/follower
  multiplier** for the rest of the session and floods chat with hype spam.

### 5.8 Shop & gear
Items grant `{aim, stream, income, prestige, luck}` and are **placed in the
room** (visual upgrade is the reward). Categories: `desk`, `pc`, `chair`,
`decor`, `room`. Buying a `room` item raises `roomTier`.

Provide **at least 18 items** across 3 progression bands (starter / pro / elite),
priced so the first is affordable within ~3 in-game days and the last is a
long-term goal. Higher-tier items visually replace lower ones on the same grid
slot (a desk slot holds one desk).

---

## 6. Screen specs

### Top bar (always visible above the screen stack)
Left: rank badge (colored chip + name + ELO progress bar to next rank).
Center: `$cash` in green, followers in pink, peak viewers in cyan.
Right: day counter + energy bar (yellow, `energy/energyMax`).

### Bottom navigation (always visible)
Five chunky icon buttons, each a distinct color, drawn as inline SVG or CSS:
**[ PLAY ] [ TRAIN ] [ STREAM ] [ CASES ] [ SHOP ]**
Plus a small **CAREER** button and an **END DAY** button in the hub itself.
Disabled state when energy is insufficient (dimmed + lock icon).

### Hub
The isometric room fills the center, drawn on canvas over a starfield. Floating
`+$` numbers drift up from income-generating props. Tapping a placed prop shows
its name and stat contribution. An **EDIT ROOM** mode lets the player drag owned
props onto free grid tiles.

---

## 7. Definition of done

- Loads from `file://` with no console errors.
- A full day is playable: TRAIN → PLAY → STREAM → open a case → buy a prop →
  see it appear in the room → END DAY.
- Save persists across reload; a **RESET** control exists in settings.
- Every number the player sees is animated (count-up), never a raw jump.
- No placeholder text, no `TODO`, no dead buttons.
