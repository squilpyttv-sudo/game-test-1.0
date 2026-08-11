# CS2 PRO SIMULATOR — V9: SOCIAL MEDIA (CONTRACT)

Second of the three approved mid-game systems (`SPEC-V7-BACKLOG.md`).
Sponsorships shipped in `SPEC-V8-SPONSORS.md`; the crypto market follows last.

All earlier hard constraints apply: vanilla JS, no ES modules, no dependencies,
no external assets, `file://`-safe, tokens-only CSS, 420x860 portrait.

---

## Why this exists, and the one rule that matters

Social media is a **third master competing for the same daily energy**. The
coach wants scrims, the sponsor wants stream time, the channel wants content.
Your energy cannot serve all three. **That competition is the feature — do not
add slack that removes the choice.**

It also **completes sponsorships**: they shipped with 3 of 4 obligation types
because the fourth needs this system (see §6).

---

## 0. OWNERSHIP

| Package | Owns |
|---|---|
| **B1 — rules & data** | `js/data.js`, `js/state.js` |
| **B2 — UI** | `js/social.js` (new), `js/career.js`, `js/shop.js`, `css/teams.css` |

B1 lands first and is frozen; B2 follows. The lead will pre-wire `index.html`
and a stub for `js/social.js` before B2 starts.

---

## 1. Platforms

Three platforms, each with its **own follower count**, unlocked progressively so
the system reveals itself over time rather than dumping three feeds at once.

| Platform | Unlock | Post cost | Character |
|---|---|---|---|
| **CLIPS** (short-form) | from the start | **12 energy** | frequent, small gains |
| **LONGFORM** (VODs) | 2,000 total social followers | **25 energy** | slow, large gains |
| **MICROBLOG** | 10,000 total social followers | **6 energy** | cheap, tiny gains |

Posting is the action; opening an account is free.

---

## 2. Posts are an INVESTMENT, not a payout

This is the owner's explicit design call and the thing that makes consistency
matter.

- Recording a post costs energy **now**.
- Its followers arrive **spread over the following ~3 days**, not instantly.
- So skipping a day has a **delayed cost** the player only feels later, and
  burst-posting is worse than posting steadily.

Track pending drip per post and apply it on each wake.

---

## 3. Payoffs

- **Ad revenue**, paid **weekly on the existing subscriber-payout tick** — do
  **not** invent a fourth cadence. Suggested **$0.015 per social follower per
  week** (50k followers ≈ $750/week), tune against subscriber income so it
  supplements rather than dwarfs it.
- **Bigger streams:** social followers feed the stream viewer cap's
  `followerFactor` (SPEC-V6 §1) at roughly **half weight** of real followers.
- **Better subscriber conversion**, stacking with the existing `income`-derived
  bonus.
- **Virality:** ~**4%** of posts blow up for **8–15x** that post's follower
  gain. Same dopamine shape as a rare on-stream case pull.

---

## 4. Social media managers (staff)

A new staff tier alongside coaches and moderators — one-time hire plus **daily
upkeep**, and they quit if cash runs out, exactly like existing staff.

| Manager | Hire | Upkeep/day | Auto-posts | Quality |
|---|---|---|---|---|
| SOCIAL INTERN | $2,500 | $80 | 2 / week | 60% |
| CONTENT EDITOR | $12,000 | $300 | 4 / week | 80% |
| CREATIVE DIRECTOR | $50,000 | $1,200 | 7 / week | 100% |

Auto-posts **cost no player energy** — that is what the player is buying. Only
one manager at a time; hiring a better one replaces the old.

This is the pressure valve, exactly as moderators are for high-viewer streams.

---

## 5. Energy budget — check this before tuning anything

Adding a third sink is the risk in this whole design. Current costs: play 20,
train 5, stream 40, scrim 20, case 1, and now content 6–25.

**Verify the player can still meaningfully serve two of three masters in a day,
and must genuinely choose.** If it proves too tight in practice, the owner's
standing instruction is to **raise the energy ceiling rather than cut the
obligations** — the competition is the point.

---

## 6. Re-enable the sponsor content obligation

`Data.sponsorObligationTypes` was deliberately left extensible. Add the fourth
type — **post N pieces of content this week** — and include it in the sponsor
offer pool.

With four types instead of three across up to three concurrent sponsors, the
sponsor pool stops repeating. **This is the item that completes sponsorships.**

---

## 7. Save-schema warning

`normalizeSave()` only copies keys present in `defaultData()`. **Every new
persisted field must be added there** — per-platform follower counts, pending
post drips, weekly post counters, the hired manager, unlock state — or it is
silently dropped on load. This has bitten the project five times.

---

## Package B1 — API additions

Everything below is implemented in `js/data.js` + `js/state.js` and frozen.
Package B2 needs nothing else from `state.js` — this section is the complete
contract. `node --check` passes on both files; a 45-assertion headless smoke
test covers unlock thresholds, energy cost, the multi-day drip, virality rate,
weekly ad revenue, manager auto-posting (zero player energy), the new sponsor
obligation, and a save/reload round trip (including a pre-V9 save with no
`social` key at all).

### Data additions (`js/data.js`)

```js
Data.socialPlatforms = [
  { id: 'clips',     name: 'CLIPS',     unlockFollowers: 0,     energyCost: 12,
    followerGainMin: 30,  followerGainMax: 70,  desc: '...' },
  { id: 'longform',  name: 'LONGFORM',  unlockFollowers: 2000,  energyCost: 25,
    followerGainMin: 120, followerGainMax: 260, desc: '...' },
  { id: 'microblog', name: 'MICROBLOG', unlockFollowers: 10000, energyCost: 6,
    followerGainMin: 5,   followerGainMax: 15,  desc: '...' }
];
// unlockFollowers gates on the SUM across all platforms (State.socialStatus().totalFollowers),
// NOT that platform's own count. followerGainMin/Max is a POST'S TOTAL eventual
// gain, spread over Data.socialDripDays days, before the virality roll.

Data.socialDripDays = 3;                        // days a post's followers are spread over
Data.socialViralityChance = 0.04;                // ~4% of posts blow up
Data.socialViralityMultMin = 8;                  // ...for 8-15x that post's follower gain
Data.socialViralityMultMax = 15;
Data.socialAdRevenuePerFollower = 0.015;         // $ per TOTAL social follower, paid weekly
Data.socialViewerCapFollowerWeight = 0.5;        // social followers' weight in viewerCap's followerFactor
Data.socialSubscriberConversionPerThousand = 0.01; // +1% subscriber conversion per 1,000 total social followers
Data.socialSubscriberConversionCap = 0.30;         // ...capped at +30% (hit at 30,000 followers)
Data.socialManagerPlatformId = 'clips';          // the ONE platform a hired manager always auto-posts to

Data.socialManagers = [
  { id: 'social_intern',     name: 'SOCIAL INTERN',     hire: 2500,  upkeep: 80,   postsPerWeek: 2, quality: 0.60 },
  { id: 'content_editor',    name: 'CONTENT EDITOR',    hire: 12000, upkeep: 300,  postsPerWeek: 4, quality: 0.80 },
  { id: 'creative_director', name: 'CREATIVE DIRECTOR', hire: 50000, upkeep: 1200, postsPerWeek: 7, quality: 1.00 }
];
// quality scales a manager auto-post's follower-gain roll (0.6/0.8/1.0x). One
// manager at a time — hiring a different one replaces the old, same as coaches/mods.

Data.sponsorObligationTypes.CONTENT_POSTS = 'content_posts'; // the 4th type — §6, now implemented
// 3 new catalog entries in Data.sponsors use it: sp_clipfeed (small, amount 2),
// sp_streamgear (mid, amount 5), sp_voltagemedia (major, amount 8). Progress
// advances on EVERY post, player or manager alike.
```

### Save shape (`State.data.social`)

```js
State.data.social = {
  followers:     { clips: 0, longform: 0, microblog: 0 },      // per-platform, whole followers
  unlocked:      { clips: true, longform: false, microblog: false },
  postsThisWeek: { clips: 0, longform: 0, microblog: 0 },      // resets on the weekly ad-revenue tick
  managerId:     null,                                          // one of Data.socialManagers[].id, or null
  drips:         []  // [{ platform, remaining: [n1, n2, ...], viral: bool }, ...]
                      // `remaining` shrinks by one element (paid out) per wake;
                      // the entry is removed once `remaining` is empty.
};
```
This is fully normalized by `normalizeSave()` — a save missing the `social`
key entirely (pre-V9) loads with every field correctly defaulted, and a save
missing a platform some future catalog change adds gets that platform
lazy-filled too (see `defaultSocial()`/`ensureSocial()` in `state.js`).

### State functions (`js/state.js`)

```js
// The player action (§2). Costs the platform's energyCost NOW; returns
// { ok, reason? } on failure ('dead' | 'invalid' | 'locked' | 'energy'), or
// { ok: true, platform, energyCost, totalGain, viral, dripDays } on success.
// totalGain is the POST'S FULL eventual gain (already virality-adjusted) —
// it is NOT credited to followers yet; it arrives via the drip over the next
// `dripDays` wakes.
State.postContent(platformId) -> { ok, ... }

// Read-only snapshot for the UI — everything §11 asks for in one call.
State.socialStatus() -> {
  totalFollowers: number,                 // sum across all platforms
  platforms: [
    { id, name, unlocked, unlockFollowers, followers, energyCost,
      postsThisWeek, pendingDrip }        // pendingDrip = sum of all NOT-YET-PAID
                                            // drip slices for this platform, across every open post
  ],
  manager: { id, name, postsPerWeek, quality, hire, upkeep } | null,
  projectedWeeklyAdRevenue: number,       // totalFollowers * Data.socialAdRevenuePerFollower, AT CURRENT followers
  daysUntilAdPayout: number               // 0..6, same clock as the subscriber-payout countdown
}

// Hire/fire — identical contract to State.hireCoach/fireCoach.
State.hireSocialManager(id) -> { ok: true, manager } | { ok: false, reason: 'dead'|'invalid'|'already-hired'|'cash' }
State.fireSocialManager() -> boolean
State.currentSocialManager() -> managerDef | null
```

### resolveNewDay() summary additions (every `State.wake()`/`State.endDay()` result)

```js
summary.socialDrip       = { clips: n, longform: n, microblog: n } // followers actually credited THIS wake (omits zero platforms)
summary.socialAutoPosts  = [ { platform, totalGain, viral, dripDays }, ... ] // 0 or 1 entries — the manager's roll for the day
summary.socialAdRevenue  = { due: bool, paid: number, followers: number }   // due only on the weekly tick
summary.staffQuit        = [ { role: 'coach'|'mod'|'social', id, name }, ... ] // 'social' is new — a manager
                                                                                  // quitting reads exactly like a coach/mod quitting
```

### Design decisions B2 should know (not re-derivable from the UI side)

- **Unlocks are permanent** once total social followers cross the threshold — they never re-lock.
- **A manager only ever posts to CLIPS** (`Data.socialManagerPlatformId`) — simplest to reason about and to surface as "N/7 posts this week." Not per-platform.
- **Drip ordering**: on each wake, ALL pending drips (from posts made any earlier day) pay out one slice each BEFORE that day's manager auto-post is rolled — so a post never pays out the same wake it was created on, player or manager alike.
- **Virality is rolled once per post**, at creation, and already baked into the drip total returned by `postContent()`/reported in `socialAutoPosts` — there's no separate "viral moment" mid-drip.
- **§5 energy-budget sanity check**: base 100 energy. scrim(20)+stream(40)+CLIPS(12) = 72/100 — all three masters fit in one day on base energy alone, with room for a 4th action (e.g. a second CLIPS post or training). scrim+LONGFORM(25) = 45/100; stream+LONGFORM = 65/100. The tightest real combo — scrim+stream+LONGFORM = 85/100 — still fits base energy. No energy-ceiling raise was needed to preserve genuine choice; the design's "raise the ceiling, not cut the obligations" fallback was not exercised.
