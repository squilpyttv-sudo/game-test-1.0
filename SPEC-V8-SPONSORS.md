# CS2 PRO SIMULATOR — V8: SPONSORSHIPS (CONTRACT)

First of the three approved mid-game systems from `SPEC-V7-BACKLOG.md`. Social
media and the crypto market follow later.

All earlier hard constraints apply: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS.

---

## Why this exists

The mid-game collapses into wake → scrim → sleep because there are **no
decisions**. Scrimming is an obligation with a penalty, not a choice.

Sponsorships fix that by introducing a **second master with competing demands**.
The coach wants scrims; the sponsor wants stream hours. Your daily energy cannot
serve both. That tension *is* the feature — do not soften it.

---

## 0. OWNERSHIP

| Package | Owns |
|---|---|
| **A1 — rules & data** | `js/data.js`, `js/state.js` |
| **A2 — UI** | `js/career.js`, `css/teams.css` (+ a new `js/sponsors.js` if a dedicated screen is warranted) |

A1 lands first and is frozen; A2 follows.

---

## 1. Sponsor offers

- Sponsors scout you on a **separate track from team offers**, driven by
  **followers, subscribers and leaderboard rank**.
- Offers arrive **gradually over days**, like team offers — never in a batch.
- The player may hold **up to 3 sponsors at once**.

**Owner's note, recorded so it is not "balanced away":** three concurrent
sponsors is affordable because by the time sponsors unlock, the player has
several max-energy items placed, plus energy drinks and the ad refill. If
playtesting shows it is too tight, **raise the energy ceiling rather than
cutting the sponsor limit.**

---

## 2. One obligation per sponsor — never a stack

Each sponsor carries **exactly one** obligation, refreshed weekly:

| Obligation | Example |
|---|---|
| Stream on N days this week | "GO LIVE 3 DAYS THIS WEEK" |
| Stream N total minutes this week | "STREAM 20 MINUTES THIS WEEK" |
| Win N official matches this week | "WIN 2 OFFICIAL MATCHES" |

**Do NOT implement content-posting obligations yet** — those depend on the
social-media system, which is not built. Leave the enum extensible so it can be
added without a migration.

Stacking demands turns a decision into a chore list. One clear ask per sponsor
keeps three sponsors legible.

---

## 3. Money and failure

- **Paid weekly**, on the same tick as the subscriber payout.
- Bigger sponsors pay more and demand more. Scale the offer pool off followers /
  subscribers / rank so a Tier 1 player sees meaningfully larger deals.
- **Missing the obligation:** a warning the first time, then the sponsor
  **drops you** and it costs **reputation** (reuse the SPEC-V5 §12 system —
  suggest **−10**, tune if it feels wrong next to the −25 for leaving a team).
- A dropped sponsor frees its slot.

**Package A1 tuning note, recorded so A2 doesn't have to reverse-engineer it:**
payout is **contingent on the obligation having been met that week** — a
missed week pays $0 (not just a warning with a free paycheck), which is what
actually makes "I skipped the sponsor's ask for a scrim" feel like a real
trade-off instead of a free pass. A sponsor that succeeds after a warning has
its warning cleared — the two misses that cause a drop must be **consecutive**.

---

## 4. It must be visible

The player has to be able to see, at a glance:

- which sponsors they hold, what each demands, and **progress toward it this
  week**,
- how many days remain in the current week,
- what each pays and when the next payout lands,
- which obligations are **at risk** — that warning has to arrive early enough to
  act on, not after the fact.

A sponsor obligation the player forgets about is a bad mechanic; a sponsor
obligation they *chose* to sacrifice for a scrim is a good one. The UI is what
makes the difference.

---

## 5. Save-schema warning

`normalizeSave()` only copies keys present in `defaultData()`. **Every new
persisted field must be added there** — held sponsors, weekly progress counters,
the week boundary, warning state — or it is silently dropped on load. This has
bitten the project five times.

---

## Package A1 — API additions

Implemented in `js/data.js` and `js/state.js`. Every existing `Game.State.*` /
`Game.Data.*` name is untouched — everything below is additive. A2 reads only
this section; it should not need to open data.js/state.js to find these.

### `js/data.js`

```js
Data.sponsorObligationTypes = {
  STREAM_DAYS: 'stream_days',       // stream on N distinct days this week
  STREAM_MINUTES: 'stream_minutes', // stream N total minutes this week
  MATCH_WINS: 'match_wins'          // win N official (signed-team) matches this week
  // extensible: a future content-posting type is just a new key here, read
  // generically everywhere obligation.type is used — no migration needed.
};

Data.sponsors = [
  {
    id: 'sp_pixelsnacks',           // stable catalog id — this is what `sponsorId` on offers/held sponsors refers to
    name: 'PIXEL SNACKS',
    pay: 30,                         // $ paid per successful week
    requires: { followers: 0, subscribers: 0, rank: 0 },  // gates (see below); 0/absent = no gate on that field
    obligation: { type: 'stream_days', amount: 2 },        // the ONE obligation this sponsor carries
    desc: '...'
  },
  // ... 8 entries total, scaling from small local brands ($30/wk, no gate)
  // up to major hardware/energy names ($750/wk, gated on followers/
  // subscribers/leaderboard rank). See the catalog itself for the full list
  // and exact thresholds.
];
```

`requires` fields (all optional, all AND'd together):
- `followers` — `d.followers` must be >= this.
- `subscribers` — `d.subscribers` must be >= this.
- `rank` — the player's **signed team's** leaderboard rank (1-100, lower is
  better — same meaning as everywhere else `rank` appears) must be <= this. A
  free agent has no team rank, so any sponsor with a `rank` gate simply will
  not offer to a free agent, regardless of followers/subscribers.

### `js/state.js` — sponsor offers (separate track from team `offers`)

- `State.sponsorOffers()` → `[{ id, sponsorId, name, pay, obligation: {type,amount}, desc, createdDay, expiresAtDay }, ...]`
  Open, unexpired offers only (auto-filtered on read).
- `State.acceptSponsorOffer(offerId)` → `{ ok: true, sponsor: {...} }` or
  `{ ok: false, reason: 'dead' | 'sponsor-slots-full' | 'not-found' | 'expired' | 'invalid-sponsor' }`.
  Moves the offer into the held roster (max 3 — see `sponsorsStatus().slotsMax`).
- `State.declineSponsorOffer(offerId)` → `{ ok: true }`. Removes it from the inbox.

Offers arrive automatically, one at a time, every 2-5 real days (gated by
followers/subscribers/rank, never batched), driven internally every
`resolveNewDay()` — same mechanism as team offers, fully independent track.
Nothing to call to "start" this; it just runs.

### `js/state.js` — held sponsors, live status (what the UI reads every frame)

```js
State.sponsorsStatus()
// -> {
//   held: [
//     {
//       id, sponsorId, name, pay,
//       obligation: {
//         type,            // one of Data.sponsorObligationTypes' values
//         amount,          // target for this week
//         progress,        // current progress toward `amount` this week
//         met,             // progress >= amount
//         pct              // progress/amount, clamped 0..1 (1 if amount is 0)
//       },
//       warned,            // true if last week's obligation was missed (one more miss drops this sponsor)
//       atRisk,            // true if the UI should flag this NOW — warned, OR daysLeftInWeek <= 2 and not met
//       daysLeftInWeek,    // sleeps remaining until the next payout/obligation-check tick (0 = resolves tonight)
//       nextPayoutDay      // d.day value the next payout tick lands on
//     }, ...
//   ],
//   slotsUsed,   // held.length
//   slotsMax,    // 3
//   daysLeftInWeek, nextPayoutDay   // same values, top-level for convenience
// }
```

`daysLeftInWeek`/`nextPayoutDay` are derived from `d.day % Data.subscriberPayoutInterval`
— the identical cadence the subscriber payout already uses (no per-save
offset, unlike rent). This is the same tick `State.statsSummary().subscribers`
already surfaces, so a sponsor payout and a subscriber payout always show the
same "days until" number.

### `js/state.js` — obligation progress hooks (already wired; nothing for A2 to call)

- `State.playMatch()`: a win while `d.contract !== 'free'` (an official match)
  advances every held `match_wins` obligation by 1.
- `State.applyStreamResult(res)`: every call advances every held `stream_days`
  obligation (distinct-day dedupe — multiple streams in one day only count
  once). It also reads an **optional** `res.durationMs` to advance
  `stream_minutes` obligations by that many minutes. **`js/stream.js` does not
  currently pass `durationMs`** — until that integration lands, `stream_days`
  progress works today, but `stream_minutes` progress will stay at 0 in the
  live UI (it is fully exercised and correct in the headless smoke test,
  which passes `durationMs` directly). Flagging this because it's the one
  place A1's contract depends on a file A1 doesn't own.

### `js/state.js` — weekly payout + failure path (already wired; nothing for A2 to call)

Runs inside `resolveNewDay()`, immediately after the subscriber payout, on
the same `d.day % Data.subscriberPayoutInterval === 0` tick:

- Obligation met → pay `sponsor.pay` to `d.cash`, reset progress, clear `warned`.
- Obligation missed, not yet warned → set `warned = true`, reset progress,
  **no payout this week**, toast, sponsor stays held (one more chance).
- Obligation missed, already warned (i.e. missed twice in a row) → drop the
  sponsor (removed from `d.sponsors`, slot freed), `applyReputationChange(d, -10)`,
  toast, **no payout**.

`summary.sponsorPayout` (the per-sleep summary object `resolveNewDay`/
`State.endDay()` already return) gets a new key:
`{ due, paid, warned: [{id,name}, ...], dropped: [{id,name}, ...] }`.

### Persisted fields (added to `defaultData()`, all covered by `normalizeSave()`)

- `d.sponsors` — held sponsors: `[{ id, sponsorId, name, pay, obligation:{type,amount}, progress, warned, acquiredDay }, ...]`, max 3.
- `d.sponsorOffers` — open inbox: `[{ id, sponsorId, createdDay, expiresAtDay }, ...]`.
- `d.nextSponsorOfferEligibleDay` — day the next offer roll may fire.
- `d.sponsorStreamDaysThisWeek` — distinct `day` values streamed on this obligation week (internal bookkeeping for `stream_days` dedupe; not generally needed by the UI — use `sponsorsStatus()` instead).
- `d.sponsorWeekStartDay` — informational only; the real week boundary is derived from `d.day % Data.subscriberPayoutInterval`, not from this field.

### What A1 left for the UI / did not build

- No dedicated sponsor screen/markup — A2 owns `js/career.js` /
  `css/teams.css` (+ optionally a new `js/sponsors.js`) per the ownership
  table in §0.
- Content-posting obligations are not implemented (blocked on the unbuilt
  social-media system) — the enum and every obligation-generic code path are
  ready for one to be added later with no save migration.
- `stream_minutes` obligation progress needs `js/stream.js` (not an A1/A2
  file) to start passing `durationMs` into `State.applyStreamResult()` — see
  the hook note above. Everything else (offer arrival, the 3-sponsor cap,
  `stream_days`, `match_wins`, weekly payout, warn/drop, reputation, save
  round-trip) is fully live end-to-end today.

### Verification

- `node --check js/data.js` / `node --check js/state.js` both pass.
- The unmodified title screen → SAVES → START CAREER → NAME YOUR CAREER flow
  boots with no console errors against the changed files.
- A headless Node smoke test (loads the real `js/data.js`/`js/state.js` into a
  faked `window`/`localStorage`) exercises: gradual, never-batched offer
  arrival; the 3-sponsor cap and its refusal path; each obligation type
  progressing and completing (including the same-day dedupe for
  `stream_days` and the official-only gate for `match_wins`); the weekly
  payout landing exactly on the subscriber-payout tick and never off it; the
  warn-then-drop failure path with its exact −10 reputation hit; and a
  save/reload round trip proving every new field survives `normalizeSave()`,
  including a simulated pre-V8 save with the new keys entirely absent.
