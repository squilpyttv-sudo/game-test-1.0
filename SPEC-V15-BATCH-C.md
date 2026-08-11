# CS2 PRO SIMULATOR — V15 BATCH C: TUTORIALS, PHONE LOCK SCREEN, PC ICON

Addendum to `SPEC.md` … `SPEC-V15-BATCH-B.md`. Where they disagree, **this
wins**. Hard constraints unchanged: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860.

Covers owner items **2, 3, 5, 7, 11, 13, 14** plus the PC icon defect.

---

## 0. OWNERSHIP

| File | Package |
|---|---|
| `js/data.js`, `js/state.js` | **C1** |
| `js/tutorial.js`, `css/tutorial.css`, `js/phone.js`, `css/phone.css` | **C2** |
| `js/stream.js`, `css/minigames.css` | **C3** |
| `js/iso.js` | **C4** |

C1 first (C2/C3 consume its API). C4 is independent — runs immediately.

### New persisted field
`d.tutorialsSeen` — an object keyed by tutorial id. **Must be added to
`defaultData()`** or it is silently dropped on load. That mistake has shipped
**five times** in this project. Prove it survives save → reload.

---

## 1. C1 — THE CONTEXTUAL TUTORIAL SYSTEM

The existing 8-step onboarding in `js/tutorial.js` stays. This is a **second,
separate mechanism**: short, single-card lessons fired by a milestone, shown
**once ever**, never repeated.

### API
```js
State.tutorialPending()          // -> the highest-priority unseen triggered id, or null
State.markTutorialSeen(id)       // -> records it, commits
State.tutorialSeen(id)           // -> bool
```
Evaluate triggers in the existing per-tick / per-day reconciliation so a
milestone crossed mid-action fires promptly, not only after sleeping.

### The triggers (owner items 2/3/7/11/14)
| id | Fires when | Teaches |
|---|---|---|
| `elo_climb` | first rank-up **into Gold Nova** (owner §2) | You need **2,100 ELO** before any org will sign you. Rank up by playing matches. |
| `career_open` | ELO first reaches **2,100** (owner §3) | The full CAREER tab: offers, contracts, chemistry, scrim quota, reputation. |
| `first_stream` | first STREAM session starts (owner §5) | Handled by **C3** — interactive, see §3. |
| `aim_stat` | first item with an `aim` stat is bought | **AIM gear raises your tournament win chance**, not just the aim trainer (owner §11). |
| `phone_unlock` | `d.phoneUnlocked` flips true (owner §14) | Sponsors, social media, **and** that CRYPTO TRADING unlocks at $20k. |
| `first_case` | first case opened | Cases are **near break-even by design** (+4.4% EV) — variance, not income. |
| `first_rent` | first rent charged | Rent every 7 days; **two negative balances ends the career**. |
| `first_scrim` | first scrim completed | Chemistry, the coach's quota, and that 3 cumulative misses gets you kicked. |
| `sponsor_conflict` | player holds a sponsor **and** a coach | The core mid-game tension: the coach wants scrims, the sponsor wants stream time, and one day's energy cannot do both. |

**Priority order** = the order above. Never show two at once.

**Do not fire a tutorial during**: a live stream (C3 owns that moment), the
move-out packing flow, sleep, or while the 8-step onboarding is running.

---

## 2. C2 — TUTORIAL CARD UI + PHONE LOCK SCREEN

### 2.1 The tutorial card
A **single compact card**, not the 8-step spotlight overlay. Per
`ART-DIRECTION.md` §2: 2px `--outline` edge, the bevel, tokens only.
- A title, 2–4 short lines, one **GOT IT** button. Dismiss = seen forever.
- Must never trap the player: dismissible, and never blocks a live action.
- Reuse the existing modal layer; do not invent a second overlay system.
- **No emoji or Unicode glyphs as icons** — authored SVG only.

### 2.2 Phone lock screen (owner item §13)
Today the phone is **completely hidden** below 300 followers. The owner wants
it **visible but locked**, so the player knows it is coming.
- The peek renders at all times (subject to the existing hide rules: asleep,
  moving out, EDIT ROOM open).
- Tapping it while locked opens a **lock screen**: the handset with a padlock,
  the real follower progress (`current / 300`), and one line explaining it
  unlocks at 300 stream followers.
- **No app grid while locked** — the apps are not teasable content, the
  unlock condition is.
- Use `State.phoneStatus()`'s existing `followers` / `needed` fields. Do not
  recompute the threshold — that is the exported rule.

---

## 3. C3 — STREAM: READABILITY FIRST, THEN THE TUTORIAL

**Order matters. The readability fix is the higher-value half** — playtesters
said toxic messages are *physically hard to hit*, which no tutorial can fix.

### 3.1 Chat readability (owner item §5, second half)
- **Bigger messages** — raise font size and row padding so a toxic message is a
  comfortable tap target at 420px. Verify the real hit area, do not eyeball it.
- **Replace the jump with a slide.** New messages appear as they do now; old
  ones **slide upward and fade out** rather than being removed instantly.
  The current instant removal is what makes the list jump and a tap miss.
- **Never reposition a message under an active touch** — HANDOFF §9.5, the
  documented cause of this project's multi-tap bug. Animate with `transform`
  and `opacity` only; do not re-layout the list mid-touch.

### 3.2 First-stream tutorial (owner item §5, first half)
On the player's **first ever stream**, and only when they cannot yet afford a
moderator:
1. Spawn one **toxic** message and **freeze the chat** — nothing scrolls, no
   new messages, no timer pressure.
2. Show tutorial copy explaining that red messages are toxic, that banning them
   protects viewer growth, and that a moderator will later do this
   automatically.
3. The player **must tap that message** to continue. Tapping anything else does
   nothing (but must not feel broken — no penalty, no scary toast).
4. On success: confirm, unfreeze, the stream proceeds normally.
5. Mark `first_stream` seen via C1's API so it never repeats.

The stream must be fully playable and winnable during the frozen state — do not
let the freeze count against the player's session time or viewer count.

---

## 4. C4 — PC PROP ICON DEFECT (independent, dispatch immediately)

**Measured by the lead**, non-transparent pixels on a 56x56 icon canvas above
the 324px empty-tile baseline that `Iso.renderPropIcon` always draws:

```
desk_ikea 224 · chair_wooden 290 · bed_mattress 782
regen_standdesk 490 · monitor_basic 144
pc_budget 57 · pc_midrange 57 · pc_elite_rig 57   <-- broken
```

Two defects: the `pc` family barely renders at icon scale, **and all tiers
render identically** — a player cannot tell a budget PC from an $18k elite rig
in the new shop or the edit tray, on a screen whose whole job is choosing.

- Fix the `pc` family draw function so it reads at 56x56 **and** in-room at
  420x860. Do **not** special-case the icon path.
- Make all four PC tiers **visually distinct** from one another.
- Use the existing `Iso.rampShade` / `boxRamp` helper — do not add a second ramp.
- **Re-measure and report** the pixel counts; each tier should clear ~200 above
  baseline and differ from its neighbours.

---

## 5. DEFINITION OF DONE
1. `node --check` clean; zero raw hex in every touched stylesheet.
2. `d.tutorialsSeen` proven to survive save → reload.
3. Every tutorial fires **once only**, proven by test.
4. No tutorial can fire during a live stream, packing, or sleep.
5. Verified live over HTTP at 420x860 on a **fresh save** — never `file://`.
