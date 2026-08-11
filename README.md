# CS2 PRO SIMULATOR — V1

A 2D isometric esports-career tycoon. Rise from a Silver-ranked player in a
cramped bedroom to a Tier-1 Major champion in a gaming mansion — by grinding
matches, streaming, moderating your own chat, and gambling on cases.

Visual and structural inspiration: *PewDiePie's Tuber Simulator*.

---

## Run it

No build step, no dependencies, no server required.

```bash
start index.html
```

Or just double-click `index.html`. Everything runs offline from `file://`.

The mockup gallery is standalone as well:

```bash
start mockups/index.html
```

---

## What V1 contains

**The daily loop.** You get 100 energy per day and spend it across four actions:

| Action | Energy | Effect |
|---|---|---|
| TRAIN | 0 | Aim-trainer minigame → sets your daily form multiplier. Free, once a day. |
| PLAY | 20 | Ranked match → ELO. Solo matches pay **no money**. |
| STREAM | 40 | Chat-moderation minigame → cash and followers |
| SCRIM | 20 | Team practice → chemistry. Only exists once you're signed. |

Then END DAY: energy refills, salary and idle income pay out, staff upkeep and
rent are deducted, form resets, and the coach checks your scrim quota.

**Money is the constraint.** Ranking up earns you nothing directly — solo
matchmaking pays $0. Income comes from streaming, lucky case pulls, your team
salary, and prize money from official matches once you're signed. That's the
central tension: the thing that advances your career doesn't pay for it.

**Three minigames**, each a different dopamine shape:

- *Aim Trainer* — 15 seconds of shrinking targets, graded S through F. The grade
  feeds directly into the ELO formula, so mechanical skill compounds.
- *Stream Chat Moderation* — tap to BAN toxic messages before they reach the top
  and tilt you. Keep it clean and you trigger a Sub Hype Train.
- *Case Unboxing* — a high-speed roulette strip at 65 / 25 / 6.5 / 2.5 / 1%.
  Skins sell instantly. Pull a red or gold **while streaming** and the chat
  explodes for a 10× viewer multiplier — the gamble becomes a growth strategy.

Stream difficulty scales with your audience: at 30 viewers chat is a trickle you
can clear by hand, at 300+ it's a flood. Growth is what creates the pressure.

**The room is the progression.** Every purchase is a physical object placed in
your isometric room, and every object is a permanent stat buff — aim bonus,
stream multiplier, idle income, prestige, or case luck.

**Locations and rent.** You start in your parents' basement, rent free. Moving
up — city centre apartment, beach villa, esports mansion — means a bigger grid,
a better stream multiplier because viewers like the setup, and **rent due every
7 days**. Miss it twice and you're evicted back to your parents. Moving is a
minigame: pack every item by tapping it, then drive the van to the new place.

**Automation.** Late game you hire staff. Coaches set your daily form so you can
stop aim-training (cheaper coaches give worse grades, and you can still beat
them by hand). Moderators auto-ban a share of toxic chat, which is what makes a
300-viewer stream survivable. Both cost daily upkeep, and quit if you go broke.

**Career ladder.** Free Agent → Tier 3 (Local) → Tier 2 (Pro) → Tier 1 (Elite).
Each contract raises your salary and takes a bigger bite of your daily energy as
mandatory scrims. Skipping practice to stream drops chemistry and angers the
coach — the central tension of the design.

---

## Layout

```
index.html            game shell — defines DOM ids and script load order
SPEC.md               V1 implementation contract (formulas, APIs, catalogs)
SPEC-V2.md            V2 change contract — overrides SPEC.md where they differ
PROGRESS.md           what shipped, how it was verified, known gaps
css/
  tokens.css          design tokens — the only place raw colour values live
  style.css           core UI: top bar, nav, hub, shop, career, modals
  minigames.css       aim / stream / cases screens
  title.css           front page, save slots, settings
  tutorial.css        onboarding overlay
js/
  data.js             static catalogs: items, skins, ranks, staff, locations
  state.js            save data, economy, every mutation, save slots
  ui.js               toasts, number formatting, WebAudio beeps, reward cards
  audio.js            procedural background music + volume settings
  iso.js              isometric renderer — shaded cuboids, props, backdrops
  router.js           screen registration and switching
  hub.js              main hub: the room, idle animation, edit + packing modes
  shop.js  career.js  shop grid (incl. STAFF), rank ladder, contract offers
  locations.js        locations, room expansion, moving
  aim.js  stream.js  cases.js    the three minigames
  title.js            front page, save slots, settings
  tutorial.js         7-step skippable onboarding
  main.js             bootstrap
mockups/              standalone mockup gallery (still reflects the V1 design)
```

Read `SPEC-V2.md` first, then `SPEC.md` — together they hold the exact formulas,
drop tables, and module APIs the files agree on. `PROGRESS.md` records what was
verified and what wasn't.

---

## Design notes

**Why cuboids.** All isometric art is drawn procedurally as shaded boxes in a
2:1 projection — top face lightened, left face base, right face darkened, sorted
painter's-algorithm. No sprite sheets to author or load, every prop is a few
lines of data, and recolouring is free. It is also what gives the room its clean,
readable Tuber-Simulator look.

**Why no build step.** V1 is a concept to be opened, played, and judged in under
ten seconds. A `npm install` between the reader and the game is a tax the concept
doesn't need to pay.

**Save data** lives in `localStorage` under `cs2sim.saves` — three slots, each
with its own name and playtime. A V1 `cs2sim.v1` save migrates into slot 0 on
first boot. Volume settings are stored globally under `cs2sim.audio`. Reset
controls are in settings.

---

## Known scope limits

- No cloud sync.
- Tournaments are resolved as a single roll rather than a bracket.
- The skin economy is static — no fluctuating market prices.
- Balance is tuned for a readable demo arc, not a long-tail idle curve.
- Automation stops at coaches and moderators; auto-scrim, VOD editing, social
  management and sponsorships are designed but not built.
- The mockup gallery predates V2 and doesn't show the title, locations, or
  staff screens.

---

## Copyright

Copyright © 2026. All rights reserved.

**This repository is public to read, not to reuse.** There is deliberately no
`LICENSE` file, and that absence is the point: under copyright law, code and
assets published without a license grant **no** rights to copy, modify,
redistribute or reuse them. Viewing and cloning are not permission.

That covers everything here, and specifically:

- **`music/`** — three original tracks written for this game by the author.
  They are not stock, not licensed, and not cleared for reuse in any other
  project. Do not extract, sample or redistribute them.
- **`js/`, `css/`, the SPEC/HANDOFF documents** — all original work.

If you want to use any part of this, ask first.

*(Being downloadable is not a license. A browser must fetch the audio to play
it; that is how the web works, and it does not grant any right to keep or
reuse the files.)*

## Playtest build

This is a **private playtest**, not a release. It carries `robots.txt` and a
`noindex` meta so it stays out of search results — see `robots.txt` for why
those two have to work together rather than simply blocking crawlers.
