# CS2 PRO SIMULATOR — V14: THE PHONE (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V13-PLAYTEST.md`. Where they disagree, **this
wins**. All hard constraints still apply: vanilla JS, no ES modules, no
dependencies, no external assets, `file://`-safe, tokens-only CSS, 420x860.

---

## 0. DIRECTION CONTRACT

This is a **new surface inside an established visual world**, not a new world.
The game's identity — deep-space navy grounds, chunky 2px borders, hard
unblurred shadows, 4px max radius, monospace uppercase, neon resource colours —
is **fixed and inherited**. Do not invent a second identity for the phone.

Mode: **Operate.** The player opens the phone to *do* something — check a
sponsor, post content, trade. Expression must never obscure the task or the
state. The personality lives in precise details, not in decoration.

**THESIS** — The phone is a diegetic object the player owns, not a menu. It
refuses the "row of nav buttons" arrangement the career page currently uses.

**OWN-WORLD** — The existing token set, rendered as consumer hardware: a
`--bg-space` bezel around a `--panel-lo` screen, chunky app tiles carrying one
resource colour each, authored SVG glyphs at a single stroke weight.

**STORY** — The player earns a phone at 300 followers, sees apps they cannot
open yet, and works toward installing them.

**FIRST VIEWPORT** — The top of the handset peeking above the SLEEP button,
bottom-right. One tap slides it up.

**SIGNATURE DETAIL** — **The phone's battery meter IS the player's energy, and
its clock IS the in-game day.** Free from existing state, instantly readable,
and it makes the object feel like it belongs to this world rather than being a
UI panel with rounded corners.

**FINISH** — unreviewed and undocumented is unfinished; this build ends with the
finish review and its verdict.

### Craft floor for this batch (non-negotiable)
- **No emoji or Unicode glyphs as icons.** Every app icon is an **authored
  SVG** at one consistent stroke weight, matching the existing authored icons
  in `js/main.js` (`ICONS`) and the energy-drink glyph in `js/hub.js`. This is
  the one place the current codebase is weakest (🔥/❄/✉ are used as icons
  elsewhere); do not extend that habit here.
- **No nested cards.** App tiles sit directly on the phone screen.
- **No kicker/eyebrow labels** above headings.
- **One authored motion moment** — the phone sliding up, with its app tiles
  staggering in behind it. Not scattered hover effects.
- Hard offset shadows and monospace are **correct here** — they are the
  committed world (`--shadow: 0 3px 0`, "hard, never blurred"), not a costume.
- Contrast: all label text ≥4.5:1 against its tile.

---

## 1. FILE OWNERSHIP MAP

| File | Package |
|---|---|
| `index.html`, `css/tokens.css` | **LEAD** (pre-wired before dispatch) |
| `js/data.js`, `js/state.js` | **P1** |
| `js/phone.js`, `css/phone.css`, `js/hub.js` | **P2** |
| `js/sponsors.js`, `js/career.js`, `js/social.js`, `js/crypto.js`, `css/teams.css` | **P3** |

**P1 runs first and alone.** P2 and P3 then run in parallel. P2 cannot start
until the in-flight banner package releases `js/hub.js`.

---

## 2. UNLOCK RULES (owner-decided — do not re-tune)

| Thing | Unlocks at | Sticky? |
|---|---|---|
| **The phone** (and with it, social media) | `followers >= 300` | **Yes** |
| **CRYPTO TRADING app** | `cash >= 20000` | **Yes** |
| SPONSORS app | with the phone | — |
| SOCIAL MEDIA app | with the phone | — |

**"Sticky" means: once unlocked, permanently unlocked**, recorded as a boolean
on the save. It must never re-lock if the underlying number falls.

This is not cosmetic. Crypto holdings persist — a player who buys coins, drops
below $20,000 and loses the app would be **unable to sell**, a genuine
soft-lock. The same reasoning applies to the phone.

### New persisted fields — §0 of SPEC-V13 applies with full force
`normalizeSave()` only copies keys present in `defaultData()`. **Both flags must
be added there or they are silently dropped on load** — this has shipped five
times in this project.
- `d.phoneUnlocked` (bool, default `false`)
- `d.cryptoAppUnlocked` (bool, default `false`)

Evaluate and set both in the existing per-tick/per-day reconciliation so they
latch the moment the threshold is crossed, and expose:
- `State.phoneStatus()` → `{ unlocked, followers, needed, apps: [...] }`
- Each app entry: `{ id, name, unlocked, unlockLabel, notifCount }`

### Two consequences that must be handled, not discovered later
1. **No sponsor offers before the phone exists.** Sponsors live on the phone
   now; an offer arriving at 50 followers would be unreachable. Gate the sponsor
   offer track on `d.phoneUnlocked`.
2. **No `content_posts` sponsor obligations until the phone exists.** That
   obligation type requires social media, which is now gated. A sponsor
   demanding posts the player cannot make would be an unwinnable obligation
   paying $0. Exclude that type from the roll while `!d.phoneUnlocked`.

---

## 3. THE PHONE OBJECT (P2)

### 3.1 Peek state
- Anchored **bottom-right of the canvas area, above the SLEEP button**, showing
  the **top ~36px** of the handset: bezel, speaker slot, status strip, and a
  sliver of screen.
- Always visible once unlocked. **Hidden entirely while `!d.phoneUnlocked`**,
  while asleep, while moving out, and **while EDIT ROOM is open** (the edit tray
  slides up over exactly that area — they must never collide).
- Carries an unread badge when any app has a notification.
- Tap target ≥44px tall including the invisible hit padding, even though only
  36px is drawn.

### 3.2 Open state — the phone home screen
Slides up into a handset roughly **300px wide**, anchored bottom-right, over a
dimmed hub. Tapping outside it, or the phone's own home bar, closes it.

**Anatomy, top to bottom:**
1. **Bezel** — `--bg-space`, 3px, `--border` outline, `--radius`. A 2px speaker
   slot centred at the top.
2. **Status strip** — `--panel-lo`, 9px uppercase tracked:
   - left: `PRO-NET` and three ascending signal bars (authored SVG)
   - right: **`DAY <n>`** as the clock, then a **pixel battery** whose fill is
     `energy / energyMax` and whose colour is `--energy`, dropping to
     `--danger` below 20%.
3. **App grid** — 2 columns, 56x56 tiles, 10px gap:
   - tile: `--panel` ground, 2px border, `--radius`, the app's identity colour
     as a low-alpha wash plus a full-strength 2px border in that colour
   - **authored SVG glyph**, 2px stroke, `currentColor`, ~26px
   - label beneath, 9px uppercase tracked, `--ink`
   - notification dot top-right, reusing the existing `.badge-dot`
4. **Home bar** — a 4px rounded bar, `--border-hi`, tappable to close.

**Identity colours:** SPONSORS `--cash` · SOCIAL MEDIA `--subs` ·
CRYPTO TRADING `--gold`.

### 3.3 Locked apps are SHOWN, never hidden
A locked app renders desaturated with an authored padlock glyph, and its label
is replaced by its **unlock condition** — `$20,000 TO INSTALL`. Tapping it
toasts the same condition; it never silently does nothing.

This matches an existing product decision: V9 deliberately showed locked social
platforms with their thresholds and a progress meter "rather than being hidden".
Give the crypto tile the same progress meter against $20,000.

### 3.4 Motion — the one authored moment
Open: the handset translates up from behind the controls row over **220ms** on
an exponential ease-out, and app tiles stagger in at **20ms** intervals. Close:
reverse, 160ms, no stagger. Nothing else animates. Respect
`prefers-reduced-motion: reduce` by dropping to a plain fade.

### 3.5 Do not break these
- The phone must not repaint or reposition on the hub's rAF render loop.
  Build it once, update it on state-change edges only. Repositioning a live tap
  target every frame is the documented cause of this project's multi-tap bug.
- Opening the phone must not pause or disturb the room render.

---

## 4. MOVING THE APPS (P3)

### 4.1 Career page loses three things
Its nav row becomes **LEADERBOARD + TOURNAMENTS** only. Remove the SOCIAL and
CRYPTO buttons and the crypto badge added in SPEC-V13 §8B (it moves to the
phone — see §5).

### 4.2 Sponsors becomes its own screen
The sponsors UI is currently a **panel inside `js/career.js`** (~46 references),
not a screen. Extract it wholesale into **`js/sponsors.js`** rendering
`#screen-sponsors`. Behaviour, copy and the V8 warning/at-risk states must
survive the move unchanged — this is a relocation, not a redesign. Its BACK
returns to **the phone**.

### 4.3 Back-navigation
`js/social.js` and `js/crypto.js` currently return to CAREER. All three app
screens' BACK now returns to **the phone home screen**. This project has fixed
a wrong-back-target bug three separate times; get it right once here.

---

## 5. NOTIFICATIONS MOVE TO THE PHONE (P2 + P3)

The V13 crypto dot lived on the career nav's CRYPTO button, which no longer
exists.

- **CRYPTO tile** — dot when `State.cryptoUnseenNewsCount() > 0`.
- **SPONSORS tile** — dot when any held sponsor is `atRisk` or `warned`. Without
  this the player must open the phone to discover a sponsor is about to pay
  **$0**, which is exactly the decision V8 exists to make legible.
- **SOCIAL tile** — **no dot.** Posts are always available; a permanent dot
  would mean nothing. Recorded so it is not "fixed" later.
- **The peek** carries a single dot when any app has one.
- The hub's CAREER badge is **unchanged** — it keeps meaning "tournament or
  scrim quota", and phone notifications must not leak into it.

---

## 6. DEFINITION OF DONE
1. `node --check` clean on every touched file.
2. `grep -cE '#[0-9a-fA-F]{3,8}\b'` prints **0** for every stylesheet touched.
3. Both new persisted flags proven to survive save → reload.
4. No emoji used as an icon anywhere in the new UI.
5. Every locked/refused tap explains itself with a toast.
6. Verified live over HTTP on a fresh save at 420x860 — never `file://`.
