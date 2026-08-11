# V7 BACKLOG — mid-game depth (DESIGN, NOT YET APPROVED FOR BUILD)

Three systems aimed at the tier-2 lull, where the loop collapses to
wake → scrim → sleep. **All three are now APPROVED by the owner.** Nothing is
dispatched yet — these wait until the SPEC-V6 batch is finished and verified.

The diagnosis this all serves: the mid-game has too few *decisions*, not too few
*activities*. Anything added must create a choice with a cost, not another
button that always pays.

---

## 1. SPONSORSHIPS — APPROVED

Recurring income with **obligations that compete with your team's**. This is the
point: the coach wants scrims, the sponsor wants stream hours, and your daily
energy cannot serve both.

- Offers arrive as your **followers / subscribers / rank** grow, like team
  offers but on a separate track.
- Each sponsor has **one** obligation type (never a stack), refreshed weekly:
  - *stream N days this week*
  - *stream N total minutes this week*
  - *post N pieces of content this week* (needs Social Media, §2)
  - *win N official matches this week*
- **Payment weekly**, on the subscriber payout tick.
- **Missing the obligation**: warning first, then the sponsor drops you and it
  costs **reputation** (reuses SPEC-V5 §12).
- Bigger sponsors pay more and demand more.
- **Up to 3 sponsors may be held at once** (owner's call). Each still carries
  exactly one obligation, so three sponsors means three clear asks, not a
  tangle.

**Why one obligation per sponsor:** stacking demands turns a decision into a
chore list. One clear ask per sponsor keeps it legible.

**Why 3 concurrent sponsors is affordable** (owner's reasoning, recorded so it
is not "balanced away" later): by the time sponsors unlock, the player already
has several max-energy items placed, plus energy drinks and the ad refill. The
energy budget at that point genuinely supports three obligations. If playtesting
shows otherwise, raise the energy ceiling rather than cutting the sponsor limit.

---

## 2. SOCIAL MEDIA — APPROVED

Owner's sketch: opening an account requires **recording content** (costs
energy); social managers can be hired to automate it; sponsors can demand
content; growth feeds money, subscribers, followers and stream viewers.

### Proposed shape
- **Platforms unlock progressively** (short-form clips → long-form → microblog),
  each with its own follower count.
- **Recording content costs ~15 energy** and produces a post that accrues
  followers over the following days rather than instantly.
- **Posts are an investment, not a payout** *(owner approved this explicitly).*
  Recording costs energy **now**; the followers arrive **over the following
  days**. So skipping a day of posting has a delayed cost you only feel later —
  which is what makes consistency matter instead of burst-posting.
- **Payoffs:** ad revenue (weekly, with the subscriber payout), a multiplier
  into the stream viewer cap's `followerFactor` (SPEC-V6 §1), and improved
  subscriber conversion.
- **Virality:** a small random chance a post blows up — a big spike. Cheap
  dopamine, same shape as an on-stream rare pull.
- **Social media manager staff** (tiered like coaches/mods): auto-posts N times
  per week, quality scaling with price, daily upkeep. Fits the existing
  automation ladder.

### The concern to resolve first
This is a **third** energy sink competing with scrims and streaming. Rough daily
budget today: ~100 starting energy + ~90 regen per 90-second day. Costs are
play 20 / train 5 / stream 40 / scrim 20 / content 15.

That is roughly 4–6 actions a day against three masters (coach, sponsor,
channel). Tight is good — that *is* the decision. But if sponsors demand
content **and** streams **and** the coach demands scrims, it stops being a
choice and becomes a failure state. Hence the one-obligation-per-sponsor rule
in §1, and why social managers matter as a pressure valve.

---

## 3. CRYPTO MARKET — APPROVED, **NO LEVERAGE**

Owner prefers crypto over a skin market: simpler, more legible to a CS player.
Agreed — skins would need a whole item-pricing layer, crypto needs one number
per coin.

### Shape
- **3–5 coins** with different volatility profiles (a stable large-cap, a
  mid-cap, a memecoin that swings wildly).
- **Prices tick several times per in-game day**, so a position can be opened and
  closed within a day rather than only at wake.
- **Invest any amount, cash out any time.**
- **NO LEVERAGE. No margin, no liquidation.** *(Owner's decision, reversing the
  earlier 10x proposal.)* Reasoning, recorded so it is not re-added later:
  leverage plus readable news headlines makes it trivially exploitable — read
  one headline, go all-in at 10x, print money. Removing leverage keeps the
  system a genuine investment decision instead of a one-shot exploit.

### News must move prices — but must NOT be a reliable oracle
**Pure random walk = cases with extra steps.** If prices are unpredictable
noise, this is a slot machine and the player never feels clever.

So headlines telegraph direction — *"US crypto regulation expected to ease over
the coming days"* → that coin trends up over the following days. But because
there is no leverage to amplify a correct read, and because the player can go
all-in on spot, the headlines must stay **genuinely uncertain**:

- **Imperfect reliability:** a headline points the right way roughly **65–70%**
  of the time, not always.
- **Unknown magnitude:** direction is hinted, size is not.
- **Fake-outs:** some headlines are noise, or reverse after an initial move.
- **Staggered resolution:** the move plays out over several days rather than
  instantly, so the player must decide when to exit, not just when to enter.

The target feel: reading the news gives a real edge over ignoring it, but
never a sure thing. Skill, not certainty.

---

## Note: store vs. sink

Crypto is a **store** of money, not a **sink** — it does not remove cash from the
economy. The actual late-game sinks are the new locations added in SPEC-V6 §28
(penthouse $600k, private island $3M) plus staff upkeep. If money still piles up
after those, the answer is more sinks, not more markets.

---

## Build order — FINAL

1. **Sponsorships** — DONE (rules landed; UI in progress). See
   `SPEC-V8-SPONSORS.md`.
2. **Social media** — next.
3. **Crypto market** — last.

The owner initially reordered crypto ahead of social media, then delegated the
call back to the lead. **Decision: social media second.** Reasoning, recorded so
it is not re-swapped without cause:

1. **Sponsorships are incomplete without it.** They shipped with three of four
   obligation types; the fourth (*post N pieces of content this week*) needs
   social media. With up to 3 concurrent sponsors drawing from only 3 types,
   repeats show up immediately. Social media closes that gap.
2. **They compete for the same resource and should be balanced together.**
   Content recording is a new energy cost sitting alongside scrims and streams —
   the "three masters" tension. Landing both back to back lets the energy budget
   be tuned **once with both in view**, rather than tuned now and retuned later.
   Crypto touches energy not at all.
3. **Crypto is orthogonal**, so it is the safest thing to land last — it cannot
   destabilise the daily loop and nothing is waiting on it.

Note the money-sink argument does **not** favour crypto going earlier: crypto is
a *store* of money, not a sink. The real late-game sinks already exist — the
penthouse ($600k), the private island ($3M), and staff upkeep.
