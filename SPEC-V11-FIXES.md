# CS2 PRO SIMULATOR — V11 FIX BATCH (CONTRACT)

Addendum to `SPEC.md` … `SPEC-V10-CRYPTO.md`. Where they disagree, **this
wins**. All earlier hard constraints apply: vanilla JS, no ES modules, no
dependencies, no external assets, `file://`-safe, tokens-only CSS.

---

## 0. OWNERSHIP

| Package | Owns | Items |
|---|---|---|
| **D1 — fridge consolidation** | `js/data.js`, `js/state.js`, `js/shop.js` | 2 |
| **D2 — rotation & sleep copy** | `js/hub.js`, `js/iso.js` | 1, 3 |

D1 and D2 touch disjoint files and run **in parallel**.

---

## 1. Every placeable prop must rotate (D2)

The V5 rotation feature only ever applied to a whitelist of prop families
(`ROTATING_FAMILIES` — desk, chair, PC, monitor). **Beds and cosmetic/decor
props silently ignore the ROTATE button**, which reads as broken.

**Fix:** rotation must work for **every placeable prop**. Extend the rotated
isometric art to beds and decor, and make the ↻ ROTATE button apply to all of
them.

**Genuinely-symmetric props** (something that looks identical at 0° and 180°,
e.g. a round rug) may still skip *visual* rotation — but if you skip it, the
ROTATE button must not appear to do nothing. Either rotate it anyway or hide
the button for that prop. **Silently ignoring a tap is what caused this
report.**

**Watch the hit-anchor.** A previous fix scoped hit-anchor rotation to the same
family whitelist. Whatever set of props now rotates visually, the tap target
must rotate with it — otherwise the tap point desyncs from the art, which is a
bug that has already appeared once in this codebase.

---

## 2. ONE set of fridges, not two (D1)

**This is a design error introduced in SPEC-V7-FIXES §3 and must be undone.**

That spec added a **new `fridge` category** (`fridge_mini`, `fridge_full`)
purely for energy-drink storage. But the `energy` category **already contained**
`energy_minifridge` and `energy_fridge`, which grant max energy. The result is
two competing sets of fridges in the shop — confusing and clearly wrong.

**The owner's intent:** the *existing* max-energy fridges should also govern
drink storage. They get a little better; there is only ever one set.

### Required changes
- **Delete the `fridge` category entirely** — `fridge_mini`, `fridge_full`, the
  `SECTION_ORDER` entry, its label, and its shop section.
- **The existing `energy` fridges now provide drink storage:**
  - `energy_minifridge` → **4** drinks
  - `energy_fridge` → **12** drinks
  - Non-fridge energy items (the IV drip, etc.) provide **0** storage.
- Energy drinks stay **locked until the player owns a storage-providing
  fridge**; `requiresFridge` keeps working, now satisfied by the energy fridges.
- The **4-per-day consumption limit is unchanged.**

### Capacity rule
Capacity comes from **placed** fridges and **sums** — consistent with how max
energy already stacks across placed energy items, and with the existing
**4-placed energy-item cap** (SPEC-V6 §16). Two placed mini-fridges = 8 storage.

### Check every detail — this is a cross-cutting change
The owner explicitly asked for no new bugs. Audit and fix all of:
- `State.fridgeStatus()` and everything reading it.
- The energy-drink buy gate and its "NEEDS A FRIDGE" / "FRIDGE FULL" copy.
- The shop's `energy` section header, which describes the max-energy cap — it
  must now also explain storage without becoming unreadable.
- **Existing saves that already bought a `fridge_mini`/`fridge_full`** — they
  must not break, and ideally should not lose what they paid for. Decide and
  document how you migrate them.
- Anything in the edit-room tray or prop rendering keyed on the dead category.

---

## 3. Fix the "cannot sleep" message (D2)

Blocking sleep above 50% energy currently says *"…or use SKIP NIGHT — WATCH AN
AD."*

**That advice is impossible to follow.** The skip-night ad is only available
**while asleep**, and the player is being told this precisely because they
cannot fall asleep. It sends them looking for a button that is not there.

Replace it with something actionable — the only real option is to **spend
energy first**. Something in the voice of:

> **TOO WIRED TO SLEEP — BURN SOME ENERGY FIRST (PLAY / TRAIN / STREAM).**

While you are there, **audit the other blocked-action messages** for the same
class of mistake: any message suggesting a remedy the player cannot reach from
their current state.
