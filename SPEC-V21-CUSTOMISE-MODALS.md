# SPEC-V21 — THE CUSTOMISE MODALS

Finishes SPEC-V20 §7. V20 shipped the CUSTOMISE button; tapping it still
toasts "CUSTOMISATION IS COMING SOON" (`js/hub.js:1076`). This spec is the
modal behind it, the rules it writes, and the art that reads those rules.

## 0. OWNERSHIP — files are exclusive, do not touch another package's file

| Package | Files | Model |
|---|---|---|
| **C1 — rules** | `js/data.js`, `js/state.js`, `test-v21-customise.js` (new) | Sonnet, high |
| **C2 — modal** | `js/customise.js`, `css/customise.css` | Opus, low + `/impeccable` |
| **C3 — art** | `js/iso.js` | Opus, low + `/impeccable` |

Already wired by the lead, do not edit: `index.html` (both tags in place),
`js/customise.js` + `css/customise.css` (stubs exist), `js/hub.js` (**frozen** —
it already calls the contract in §2).

## 1. WHAT IS CUSTOMISABLE

Five items, in two families:

| Family | Items | Editor |
|---|---|---|
| **FABRIC** | `poster_team` (TEAM POSTER), `blind_slat` (WINDOW BLIND) | paint |
| **LED** | `neon_sign`, `rgb_strip`, `lucky_mousepad` (FLOOR LED SCREEN) | colour |

**`blind_slat` is currently MISSING `customisable: true` in `js/data.js`**
(verified — the other four have it). SPEC-V20 §7 lists the blind as
customisable and `js/hub.js` already groups it with the banner as one of "the
two fabric ones", so the flag is simply absent. **C1 adds it.**

`js/hub.js` currently splits the two families with a hardcoded id list
(`LED_CUSTOMISE_IDS`) and says so in a comment, but it already honours a
`def.ledCustomise` boolean first if one exists. **C1 must add
`ledCustomise: true` to the three LED items** so the heuristic is retired at
the source — the flags on `Data.shopItems` are the single source of truth for
which editor opens, and neither `customise.js` nor `iso.js` may keep its own
id list.

## 2. THE CONTRACT (already called by `js/hub.js` — do not change)

```js
window.Game.Customise.open(defId, placedIdx)
```

`defId` is the shop item id; `placedIdx` is its index into `State.data.placed`.
No return value. The modal owns its own open/close lifecycle, like `js/phone.js`.

## 3. PERSISTENCE — read this before writing any state

The paint value lives on the **placed entry**: `State.data.placed[i].tint`,
a hex string, or `null`/absent meaning "factory finish, use the original art".

**This needs NO change to `defaultData()`.** `normalizeSave()` copies `placed`
wholesale (`for (var k in d) if (raw[k] !== undefined) d[k] = raw[k]`), so
arbitrary per-entry keys already round-trip — verified directly: a `tint` and
a `designId` written onto a placed entry both survived a save/load in a fresh
VM. The famous "five times shipped broken" trap applies to **top-level** keys
missing from `defaultData()`, which this is not. Do not add a top-level
mirror of the tint; that would be the second-copy bug instead.

`tint` must be **validated on write** against the palette for that item's
family. An unknown value is rejected, not stored — the renderer must never
receive a colour the palette does not contain.

## 4. THE PALETTE — one source of truth, in `js/data.js` (C1 owns)

```js
Data.customisePalettes = {
  fabric: ['#C0392B','#2E86C1','#27AE60','#F1C40F','#8E44AD','#E67E22','#ECF0F1','#2C3E50'],
  led:    ['#FF2D6F','#00CCFF','#7B5CFF','#00FF88','#FFD400','#FF6A00','#FF0033','#FFFFFF']
};
```

Eight per family. **`null` is a valid ninth choice in the UI** ("FACTORY") and
means "no tint" — it is not in the array because it is the absence of a value,
and the modal must offer it so a player can always undo a paint job.

Fabric colours are matte and slightly desaturated; LED colours are hot and
saturated because they are light sources. Both `js/customise.js` and
`js/iso.js` read this array — **neither may hardcode a colour list.**

## 5. C1 — RULES (`js/data.js`, `js/state.js`)

1. Add `customisable: true` to `blind_slat`; add `ledCustomise: true` to
   `neon_sign`, `rgb_strip`, `lucky_mousepad`.
2. Add `Data.customisePalettes` exactly as in §4.
3. Export, following the existing style in this file (single source of truth,
   defensive, no second copies):
   - `State.customiseFamily(itemId)` → `'led' | 'fabric' | null`. Derives from
     `def.ledCustomise` / `def.customisable`. **This is what decides which
     editor opens** — `customise.js` calls it rather than re-deriving.
   - `State.customisePalette(itemId)` → the array for that item's family, or
     `[]`. Reads `Data.customisePalettes`.
   - `State.itemTint(placedIdx)` → the stored tint or `null`.
   - `State.setItemTint(placedIdx, tint)` → `{ok:true}` / `{ok:false, reason}`.
     Refuses: out-of-range index; an item that is not customisable
     (`'NOT CUSTOMISABLE'`); a tint that is neither `null` nor a member of that
     item's palette (`'UNKNOWN COLOUR'`). On success writes
     `placed[idx].tint` (deleting the key when `tint` is `null`, so a factory
     item serialises clean) and persists via the same save path every other
     mutation uses.
4. `test-v21-customise.js`: a new suite in the same harness style as
   `test-v20-customise.js`. Must cover, at minimum — every refusal reason; a
   tint surviving a **save/load round-trip in a fresh VM**; `null` clearing
   the key rather than storing the string `"null"`; the family split resolving
   correctly for all five items and `null` for a non-customisable item; and
   that a wrong-family colour is refused (an LED colour on a blind).
   Report the count.

## 6. C2 — THE MODAL (`js/customise.js`, `css/customise.css`)

**Invoke `/impeccable` first and follow it.** Read `SPEC-V18-PIXEL-UI.md` for
the visual language and `ART-DIRECTION.md`.

A modal, not a screen — it opens over the room with the item still visible if
possible, because the whole point is judging a colour in place.

- **Anatomy:** double-bordered modal (V18), a title naming the item, a swatch
  grid, a FACTORY option, and a close control. Reuse the game's existing
  anatomy — the inventory well (`.phone__slot`, 80px, `--slot-fill` ground,
  1px `--slot-border`, 1px `--pixel-black` outer ring, thick `--slot-sel`
  selection ring) is the established "grid of choosable things" object.
  A second, unrelated grid anatomy is exactly what made the phone read as a
  separate product before V18. **The currently-applied colour must be visibly
  selected on open** — a picker that does not show the current value forces
  the player to remember it.
- **Apply live.** Tapping a swatch writes it immediately via
  `State.setItemTint` and the room re-renders, so the player sees the real
  thing on the real prop rather than a swatch. There is no OK/CANCEL pair;
  FACTORY is the undo. If you disagree after building it, say so in your
  report with what you saw — do not silently add a confirm step.
- **Touch targets ≥ 44px.** Contrast ≥ 4.5:1 for text, ≥ 3:1 for the
  selection indicator against both the swatch and the ground. A selection ring
  that relies on colour alone fails against a swatch of a similar hue —
  measure it against the worst case in the palette (`#ECF0F1` and `#FFFFFF`
  are the dangerous ones), and do not let the ring vanish on white.
- **Zero raw hex in `css/customise.css`.** The swatch colours come from
  `State.customisePalette()` and are set as inline styles by the JS, so they
  never enter the stylesheet. Any new UI colour means a new token — but
  `css/tokens.css` is NOT yours: if you need one, report it and use the
  closest existing token meanwhile.
- Export `open(defId, placedIdx)` only when it fully works (see the stub's
  header for why).

## 7. C3 — THE ART (`js/iso.js`)

**Invoke `/impeccable` first and follow it.**

Make the tint actually visible on the five props, reading
`State.data.placed[i].tint` (and `State.customisePalette` for nothing else —
the value is already validated, just render it).

- **The tint must not flatten the art.** Every prop in this game is shaded
  through `rampShade()`/`boxRamp()` (top ×1.30, left ×1.00, right ×0.70, 1px
  `#000000` silhouette). A tinted prop keeps that ramp — recolour the base and
  re-derive the three tones, never paint a flat fill over the geometry.
- **LED items are light sources.** Their tint should drive the glow as well as
  the body, so an `#00CCFF` strip spills cyan and an `#FF2D6F` one spills pink.
  The existing `glow()` helper is there.
- **Fabric items are not.** The banner and blind take the colour as dyed cloth
  — matte, no bloom.
- A `tint` of `null`/absent must render **exactly** the current art, byte for
  byte. This is the regression risk: do not let "no tint" quietly become
  "tinted with a default".
- Verify with the offscreen-canvas pixel technique, not by eye: render each
  prop at two different palette entries and assert the dominant colours
  actually differ, and that `null` matches today's output.

## 8. DEFINITION OF DONE

1. `node --check` clean on every touched file; **zero raw hex outside
   `css/tokens.css`** (`grep -n "#[0-9a-fA-F]\{3,6\}" css/*.css | grep -v "^css/tokens.css" | wc -l` → `0`).
2. All suites pass at their current counts: v20 **38** · v12 16 · v13 17 ·
   v14 19 · v15-banners 15 · v15-tutorials 26 · v16-rooms 16, plus the new
   v21 suite. `test-v15-rules.js` is **known-slow** — minutes, not hung.
3. Verified live over HTTP at 420x860 on a fresh save — never `file://`.
4. **KNOWN TRAPS.** The preview pane is frequently not compositing
   (`document.hidden === true`), which freezes `requestAnimationFrame` and
   makes working UI look blank — diagnose with a rAF tick count before
   concluding anything is broken, and prefer offscreen-canvas pixel
   inspection. The browser also serves **cached JS**: after editing, hard
   reload, or you will test the old file (this cost the lead a false negative
   this session). `Iso.renderPropIcon(canvas, id)` takes a **canvas**, not a
   ctx.
5. Report per item: done / not done / blocked, **with the measurement that
   proves it**. Name any file you needed but did not own. Do not report a
   claim you did not verify — every package this session has been
   independently re-checked and several "done" claims were false.
