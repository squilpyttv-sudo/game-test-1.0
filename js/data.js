/* ==========================================================================
   CS2 PRO SIMULATOR — js/data.js
   Static catalogs. No mutation happens here — see js/state.js.
   ========================================================================== */
(function () {
  'use strict';

  var Data = {};

  /* ---- energy (SPEC-V3 §1 / §9 / §10 — REPLACES V2 costs) -----------------
     Data.energyMax is the BASE max before any energy-category upgrades
     (§10) are owned. The player's actual current cap lives in
     State.data.energyMax, recomputed by state.js as base + owned energy
     props, clamped to Data.energyMaxCap. Every place that used to assume a
     flat 100 must read State.data.energyMax instead. --------------------- */
  Data.energyMax = 100;
  Data.energyMaxCap = 200;
  Data.energyCosts = { train: 5, play: 20, stream: 40, scrim: 20, case: 1 };
  // SPEC-V5 §6r: the SUM of all energy-category item quantities owned may
  // never exceed this (e.g. 4 energy drinks, or 2 drinks + 2 IV drips).
  // Quantities above 1 per item are now allowed (was qty-capped at 1 each);
  // only the total across every energy-category item is hard-capped. See
  // js/state.js's recomputeEnergyMax() (now sums energyAdd * qty) and
  // State.buyItem() (blocks a purchase that would push the total over this).
  // SPEC-V6 §16: this cap now gates PLACED energy-category items (not
  // ownership — you may own any number). See js/state.js's
  // recomputeEnergyMax()/State.placeItem().
  Data.energyItemCap = 4;

  /* ---- SPEC-V6 §7: daytime regen boosters (NEW `regen` shop category) ------
     Stack additively while placed, total bonus hard-capped at
     Data.regenBonusCap so the absolute day rate can never exceed
     Data.dayRegenBase + Data.regenBonusCap. Night regen stays 0 regardless
     (js/state.js's doTick only ever applies regen during the day segment of
     a tick). ---------------------------------------------------------------- */
  Data.dayRegenBase = 1.0;
  Data.regenBonusCap = 2.0;

  /* ---- SPEC-V6 §3: energy drinks are now a stockpiled CONSUMABLE, not a
     max-energy room prop (REPLACES the old `energy` category placement).
     Bought repeatedly from the shop, drunk on demand via
     State.drinkEnergyDrink(). --------------------------------------------- */
  Data.energyDrink = { price: 20, restoreEnergy: 25, maxPerDay: 4 };

  /* ---- subscribers (SPEC-V3 §13 — REPLACES idle income) --------------------
     Idle income is gone entirely (rooms don't print money, and it was
     credited invisibly inside sleep/wake while the hub lied about it with
     floating +$ particles). Streaming now converts a slice of follower gain
     into subscribers (State.applyStreamResult), and subscribers pay out in a
     lump sum every `subscriberPayoutInterval` sleeps, on the same tick as
     rent but BEFORE it (State's applySubscriberPayout/applyRent ordering in
     resolveNewDay), at `subscriberPrice` each — deliberately mirroring a real
     platform's post-cut sub payout. The former `income` gear stat (still
     `stats.income` on shop items below — kept unrenamed per the "extend,
     don't rename" contract) is repurposed: each point now adds
     `subscriberConversionPerPoint` to the base conversion rate instead of
     feeding dead idle income. Balance intent (do not re-tune): 100 followers
     -> 8 subs -> $20/7 sleeps; 2,000 -> 160 -> $400 (city apartment rent);
     20,000 -> 1,600 -> $4,000 (beach villa rent); 100,000 -> 8,000 ->
     $20,000 (mansion rent). -------------------------------------------- */
  Data.subscriberConversionBase = 0.08;       // 8% of a stream's follower gain becomes subscribers
  Data.subscriberConversionPerPoint = 0.05;   // former `income` gear stat: +5% conversion per point owned
  Data.subscriberPrice = 2.50;                // $ paid per subscriber, per payout
  Data.subscriberPayoutInterval = 7;          // sleeps between subscriber payouts (same tick as rent)

  /* ---- SPEC-V20 §3/§4: room-decor flat buffs ------------------------------
     Both are FLAT and NON-STACKING — owning/placing more than one qualifying
     item never multiplies the bonus, it's just on or off. Single source of
     truth for the on/off LOGIC lives in js/state.js
     (State.merchandiseBonusActive()/State.blindsBonusActive()); these two
     numbers are the only tunable magnitude. ------------------------------- */
  // §4: a placed banner (poster_team) OR neon_sign (both carry
  // `merchBonus: true` above) adds this to stream follower/viewer gain AND
  // (since subscribersGained derives from the boosted follower gain) to
  // subscriber gain — see State.applyStreamResult(). A banner + a neon sign
  // together still only give this once.
  Data.streamMerchBonusPct = 0.05;
  // §3: sleeping regenerates energy this much FASTER when every window the
  // player owns is placed AND fully covered by closed blinds — see
  // State.blindsBonusActive()/State's doTick()/canWake() sleep-rate math.
  // Off entirely with zero windows (can't be earned by owning nothing).
  Data.blindsSleepBonusPct = 0.15;

  /* ---- streaming (SPEC-V5 §13r / §14) ---------------------------------------
     Session mechanics (chat, tilt, hype, the countdown/STOP button) live in
     js/stream.js (Package R) — these are just the rule-level constants that
     module reads, plus the tier scaling applied in State.applyStreamResult()
     (js/state.js) on top of the existing location/prestige multipliers.
     §14: bigger audience (more viewers) AND richer viewers (higher
     per-viewer donation value) both rise with the player's signed tier. ---- */
  Data.streamMinSeconds = 10;   // §13r: minimum stream length before STOP is allowed
  Data.streamViewerCap = 500;   // LEGACY flat fallback — kept working (old name, extend don't rename) for any
                                 // caller still reading it directly; SPEC-V6 §1 replaces this with the dynamic
                                 // formula below. Callers should prefer State.viewerCap().
  Data.streamTierViewerMult = { free: 1.0, t3: 1.5, t2: 3.0, t1: 6.0 };   // §14 base-viewer multiplier by tier
  Data.streamTierDonationMult = { free: 1.0, t3: 1.3, t2: 1.8, t1: 2.5 }; // §14 per-viewer donation value by tier

  /* ---- SPEC-V6 §1: viewer cap grows with the career instead of starting at
     500 on day one. streamCap = viewerCapBase * streamCountFactor *
     followerFactor * tierFactor — see js/state.js's State.viewerCap().
     Sanity targets (smoke-tested): new save -> exactly 230; ~300 streams,
     200k followers, T1 -> 1-3 million. Diminishing-returns shape is the
     requirement — never linearise this. ------------------------------------ */
  Data.viewerCapBase = 230;
  Data.viewerCapStreamDivisor = 25;
  Data.viewerCapStreamExp = 1.6;
  Data.viewerCapFollowerDivisor = 8000;
  Data.viewerCapFollowerExp = 0.8;

  /* ---- aim trainer grades (§5.2) ----------------------------------------- */
  Data.formGrades = [
    { grade: 'S', label: 'IN THE ZONE', mult: 1.00 },
    { grade: 'A', label: 'LOCKED IN',   mult: 0.70 },
    { grade: 'B', label: 'SOLID',       mult: 0.45 },
    { grade: 'C', label: 'AVERAGE',     mult: 0.25 },
    { grade: 'D', label: 'SHAKY',       mult: 0.10 },
    { grade: 'F', label: 'TILTED',      mult: 0.00 }
  ];

  /* ---- SPEC-V6 §12: the form multiplier is now a CONTINUOUS function of aim
     trainer performance (accuracy, hit volume, reaction time) across 0..1.0
     — it no longer snaps to a fixed per-grade value. Data.formGrades above
     is kept (old name, extend don't rename) and now serves ONLY as the
     label lookup table: the highest grade whose `mult` the achieved
     multiplier meets or exceeds becomes the display label. See
     js/state.js's State.setFormFromPerformance()/Data.formLabelForMult(). */
  Data.aimFormWeights = { accuracy: 0.50, volume: 0.30, reaction: 0.20 };
  Data.aimFormVolumeTarget = 40;      // hits needed to fully saturate the volume component
  Data.aimFormReactionBestMs = 150;   // reaction time at/below this scores 1.0
  Data.aimFormReactionWorstMs = 600;  // reaction time at/above this scores 0.0
  Data.formLabelForMult = function (mult) {
    var grades = Data.formGrades;
    for (var i = 0; i < grades.length; i++) {
      if (mult >= grades[i].mult) return grades[i];
    }
    return grades[grades.length - 1];
  };

  /* ---- ranks by elo (§5.4) ----------------------------------------------- */
  Data.ranks = [
    { min: 0,    name: 'SILVER',           color: '#9aa4b8' },
    { min: 250,  name: 'GOLD NOVA',        color: '#d9a441' },
    { min: 500,  name: 'MASTER GUARDIAN',  color: '#59b3d9' },
    { min: 800,  name: 'DMG',              color: '#4b69ff' },
    { min: 1100, name: 'LEGENDARY EAGLE',  color: '#8847ff' },
    { min: 1400, name: 'SUPREME',          color: '#d32ce6' },
    { min: 1750, name: 'GLOBAL ELITE',     color: '#eb4b4b' },
    { min: 2100, name: 'FACEIT 10',        color: '#ff6b00' },
    { min: 2600, name: 'PRO',              color: '#ffd54a' }
  ];

  /* ---- contracts & chemistry (§5.5) -------------------------------------- */
  Data.contractOrder = ['free', 't3', 't2', 't1'];
  /* ELO floors per SPEC-V4 §3 (REPLACES SPEC-V2 §5.5 thresholds):
     Tier 3 stays 2,100 (unchanged — FACEIT 10). Tier 2 now requires 2,700.
     Tier 1 now requires 3,500. These are eligibility MINIMUMS only — under
     §5 the player must still receive and accept a team offer via the new
     State.offers / State.acceptOffer() flow (see js/state.js); the legacy
     canSign()/signContract() below are kept working (old name, extend not
     rename) but are no longer the primary path once offers exist. */
  Data.contracts = {
    free: { id: 'free', name: 'FREE AGENT',      salary: 0,     quota: 0,  require: null },
    t3:   { id: 't3',   name: 'TIER 3 — LOCAL',  salary: 500,   quota: 30, require: { elo: 2100 } },
    t2:   { id: 't2',   name: 'TIER 2 — PRO',    salary: 3500,  quota: 45, require: { contract: 't3', elo: 2700 } },
    t1:   { id: 't1',   name: 'TIER 1 — ELITE',  salary: 25000, quota: 60, require: { contract: 't2', elo: 3500, chemistry: 70 } }
  };

  /* ---- 100-team pro leaderboard (SPEC-V4 §5a/§5c) ---------------------------
     Generated programmatically from a compact seed list (real orgs, lightly
     scrambled — see SPEC-V4 §5a for the naming convention) plus a fictional
     regional-org generator for the rest, rather than hand-authored. Only
     `rank`/`strength` move at runtime (after tournaments, §5d) — that
     mutable slice is what actually persists in the save (js/state.js's
     ensureTeams() seeds State.data.teams from this catalog once, then only
     copies rank/strength forward on later loads so a save always reflects
     THIS catalog's static fields, per the "static defs live in data.js,
     only mutable per-team state persists" rule).

     Each entry: id, name, rank (1-100, seed order — state.js may reorder
     this at runtime), tier (1/2/3 by rank per §5a's table), strength (0-100,
     correlates with rank), salary (baseline * trajectory multiplier, §5c),
     signingBonus, contractSleeps (contract length offered, §5b/§5e),
     trajectory ('rising'|'stable'|'declining', §5c), requirements (ELO floor
     per §3 plus a mix of hype/winRate/chemistry/followers, §5b), and the
     logo descriptor (colors/letterform/badgeStyle) Package M's canvas
     renderer draws from — no image assets, per the file-format constraint. */
  /* ---- HLTV-style points model (SPEC-V4 §5d, REPLACES a fixed ±N rank
     nudge) --------------------------------------------------------------
     Rank is NEVER written directly — it is always the leaderboard sorted by
     `points` descending (js/state.js's recomputeRanks()). These are the
     exact constants from §5d; js/state.js's applyPointsEvent()/
     applyRankCeiling() are the only things that touch `points`. Defined
     BEFORE buildTeams() below since it seeds each team's initial `points`. */
  Data.leaguePoints = {
    eventWeight: { t3: 100, t2: 400, t1major: 1500 },
    placementFactor: { win: 1.0, final: 0.6, semi: 0.35, quarter: 0.15, groups: 0.05 },
    decay: 0.08,      // ALL teams lose 8% of points every tournament cycle
    damping: 0.7,     // move 70% of the way from current points to the newly computed total
    ceilingMargin: 5  // a team may not end an event ranked higher than (best rank it beat) - 5
  };
  // Data.pointsForRank: the compact seed curve for the INITIAL points ladder
  // only (rank 1-100 -> a starting points total that sorts back to that same
  // rank at boot). Everything after that is runtime-mutable via the model
  // above (event points, decay, damping). Piecewise-linear and DELIBERATELY
  // steep at the top / near-flat at the bottom — with the exact §5d event
  // weights/decay/damping (fixed by spec, not tunable here), a Tier 3 win's
  // damped points gain only translates into a big rank jump if the Tier 3
  // neighbourhood's point gaps are small to begin with. A smooth curve
  // (tried first: exponential/power) can't be steep at rank 1-20 AND flat at
  // rank 50-100 without either an unrealistic cliff near rank 1 or a T3 gap
  // too wide for a single win to matter — this piecewise curve gets both:
  // T1 (1-20) spans 2200->700, T2 (20-50) spans 700->300, T3 (50-100) spans
  // 300->230 (~1.4 pts/rank — small enough that a Tier 3 title's damped
  // ~40-90pt gain, per the §5d formula, reliably rockets a rank-80 side into
  // the T2 fight, matching the spec's "top 50-60" intent — verified via the
  // Package L smoke test's calibration run). ------------------------------
  Data.pointsForRank = function (rank) {
    var pts = [[1, 2200], [20, 700], [50, 300], [100, 260]];
    if (rank <= pts[0][0]) return pts[0][1];
    if (rank >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (rank >= a[0] && rank <= b[0]) {
        var t = (rank - a[0]) / (b[0] - a[0]);
        return Math.round(a[1] + t * (b[1] - a[1]));
      }
    }
    return pts[pts.length - 1][1];
  };

  (function buildTeams() {
    function clamp01(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    // Deterministic pseudo-random in [0,1) so the roster is stable across
    // reloads without persisting the whole catalog in the save.
    function seededRand(seed) {
      var x = Math.sin(seed * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    }

    // Real orgs, lightly scrambled (SPEC-V4 §5a examples) — fill the top of
    // the leaderboard (all of Tier 1, plus a few Tier 2) since those are the
    // recognisable names; everything below is generated fictional regional
    // orgs per the spec's explicit allowance.
    var SEED_TEAMS = [
      { name: 'NAWY',             colors: ['#ffcc00', '#111111'], letter: 'N',  badge: 'chevron' },
      { name: 'EAZE',              colors: ['#e2001a', '#111111'], letter: 'E',  badge: 'angular' },
      { name: 'J2',                 colors: ['#000000', '#ff5900'], letter: 'J',  badge: 'diagonal' },
      { name: 'VYTALITY',          colors: ['#ffe500', '#111111'], letter: 'V',  badge: 'shield' },
      { name: 'ASTRALIX',          colors: ['#dc1e35', '#111111'], letter: 'A',  badge: 'hex' },
      { name: 'KLOWD9',            colors: ['#1e90ff', '#0a2540'], letter: 'K',  badge: 'circle' },
      { name: 'LIQVID',            colors: ['#0033a0', '#111111'], letter: 'L',  badge: 'diagonal' },
      { name: 'MOUS',              colors: ['#ff5900', '#111111'], letter: 'M',  badge: 'angular' },
      { name: 'HEROWIC',           colors: ['#c9a227', '#111111'], letter: 'H',  badge: 'shield' },
      { name: 'SPYRIT',            colors: ['#f2c200', '#111111'], letter: 'S',  badge: 'monogram' },
      { name: 'FALKONS',           colors: ['#0a5c36', '#111111'], letter: 'F',  badge: 'hex' },
      { name: 'ENSE',              colors: ['#0057b8', '#ffffff'], letter: 'E',  badge: 'circle' },
      { name: 'FNATIK',            colors: ['#ff5900', '#111111'], letter: 'F',  badge: 'chevron' },
      { name: 'VIRTUS.BRO',        colors: ['#f2c200', '#111111'], letter: 'V',  badge: 'shield' },
      { name: 'FURYA',             colors: ['#111111', '#f2c200'], letter: 'F',  badge: 'diagonal' },
      { name: 'PAYN',              colors: ['#a6192e', '#111111'], letter: 'P',  badge: 'monogram' },
      { name: 'KOMPLEXITY',        colors: ['#00539f', '#f26522'], letter: 'K',  badge: 'angular' },
      { name: 'GAMERLEGEND',       colors: ['#7b2ff7', '#111111'], letter: 'G',  badge: 'hex' },
      { name: 'THE MONGULZ',       colors: ['#1f6feb', '#111111'], letter: 'M',  badge: 'circle' },
      { name: 'BAD NEWS BEAGLES',  colors: ['#2e7d32', '#111111'], letter: 'B',  badge: 'shield' },
      { name: 'TYL00',             colors: ['#c8102e', '#111111'], letter: 'T',  badge: 'chevron' },
      { name: 'GREYHOND',          colors: ['#6b5b95', '#333333'], letter: 'G',  badge: 'monogram' },
      { name: 'IMPERIUL',          colors: ['#00a651', '#111111'], letter: 'I',  badge: 'diagonal' },
      { name: '9X',                colors: ['#75aadb', '#111111'], letter: '9',  badge: 'circle' },
      { name: 'APEXS',             colors: ['#0f52ba', '#111111'], letter: 'A',  badge: 'hex' }
    ];

    var BADGE_STYLES = ['angular', 'diagonal', 'shield', 'circle', 'hex', 'chevron', 'monogram'];
    var PALETTE = [
      ['#e2001a', '#111111'], ['#00c2ff', '#0a2540'], ['#f2c200', '#111111'],
      ['#2e7d32', '#111111'], ['#7b2ff7', '#111111'], ['#ff5900', '#111111'],
      ['#0057b8', '#ffffff'], ['#c8102e', '#111111'], ['#00a651', '#111111'],
      ['#6b5b95', '#333333']
    ];

    /* SPEC-V5 §1: the suffix-pool generator (REGION_PREFIX x ORG_SUFFIX) is
       DELETED entirely — it produced dozens of teams sharing a suffix
       ("...TITANS", "...KNIGHTS", "...PHANTOMS", "...REAPERS"), which read
       as obviously generated. The ~75 non-seed teams are now a flat,
       hand-authored literal list — the one place in this file a literal
       list is correct, since generation is what caused the bug.

       Shape is deliberately varied: single words, two-word names,
       abbreviations, numerics, and place/culture-flavoured names. NO WORD
       (splitting each name on spaces) may repeat across this list OR the
       SEED_TEAMS list above — enforced by the assertion at the bottom of
       buildTeams(). If you ever edit this list, keep that invariant: check
       every new word against both lists before adding it. */
    var FICTIONAL_TEAM_NAMES = [
      // -- single words (25) --
      'VANTAGE', 'OBSIDIAN', 'MERIDIAN', 'ZENITH', 'ECLIPSE', 'TEMPEST', 'CIPHER',
      'MONARCH', 'VANGUARD', 'RENEGADE', 'CATALYST', 'PARAGON', 'NEBULA', 'GRAVITY',
      'HORIZON', 'OUTBREAK', 'SANCTUM', 'WARDEN', 'PINNACLE', 'LATITUDE', 'FRONTIER',
      'INSURGENT', 'DYNASTY', 'HOLLOW', 'TRIUMPH',
      // -- two-word names (20) --
      'IRON LOTUS', 'PALE HORSE', 'SILENT ARROW', 'CROWNED WOLF', 'BROKEN CROWN',
      'VELVET STORM', 'AMBER TIDE', 'STONE REACH', 'EMBER FIELD', 'RIVAL STATE',
      'COBALT REIGN', 'MARBLE EDGE', 'GILDED FANG', 'HUNGRY GHOST', 'LOWER DECK',
      'NORTHERN LIGHT', 'CRIMSON VOW', 'SILVER ROUTE', 'GOLDEN HOUR', 'DUSTY TRAIL',
      // -- abbreviations (10) --
      'BKX', 'TRV', 'OM9', 'VXR', 'QLT', 'DRK7', 'PLS', 'NVX', 'KRO', 'XTN',
      // -- numerics (10) --
      'UNIT 77', 'ROOM 402', 'SECTOR 9', 'DIVISION 12', 'LEVEL 5', 'CODE 61',
      'ZONE 88', 'GRID 14', 'LINE 33', 'POST 21',
      // -- place / culture-flavoured (10) --
      'KOPRI', 'SUNDOWN CO', 'NORDVIK', 'HARBORLINE', 'DUNETRACK', 'VESTRA',
      'OSLYN', 'TARABEL', 'MONTFORT', 'CASCADIA'
    ];

    // Exposed on Data (not just closed over here) so js/state.js can
    // recompute a team's tier/salary/requirements after its `rank` moves at
    // runtime (§5d) without duplicating these formulas — single source of
    // truth stays in data.js per the file-ownership map.
    Data.tierForRank = function (rank) { return rank <= 20 ? 1 : (rank <= 50 ? 2 : 3); };
    Data.tierBoundsForTier = function (tier) { return tier === 1 ? [1, 20] : (tier === 2 ? [21, 50] : [51, 100]); };
    Data.eloFloorForTier = function (tier) { return tier === 1 ? 3500 : (tier === 2 ? 2700 : 2100); };
    // SPEC-V6 §8: a team's REQUIRED elo (shown on its offer card, e.g.
    // "MINIMUM 3,300 ELO") is no longer a flat per-tier floor — it's
    // interpolated within the team's tier band by rank, rounded to the
    // nearest 100. Bounds/ranges are exact per the V6 contract table:
    //   T3 rank 100->51 : 2,100 -> 2,500
    //   T2 rank  50->21 : 3,200 -> 4,000
    //   T1 rank  20->1  : 5,000 -> 7,000
    // (Data.eloFloorForTier above is UNCHANGED and still used as the flat
    // "any offers at all" floor, §4/§5 — it is a separate, coarser gate.)
    Data.eloRequirementForRank = function (rank) {
      var tier = Data.tierForRank(rank);
      var hiRank, loRank, loElo, hiElo; // hiRank = the WORSE (higher-numbered) end of the band, pinned to loElo
      if (tier === 3) { hiRank = 100; loRank = 51; loElo = 2100; hiElo = 2500; }
      else if (tier === 2) { hiRank = 50; loRank = 21; loElo = 3200; hiElo = 4000; }
      else { hiRank = 20; loRank = 1; loElo = 5000; hiElo = 7000; }
      var t = clamp01((hiRank - rank) / (hiRank - loRank), 0, 1);
      var raw = loElo + t * (hiElo - loElo);
      return Math.round(raw / 100) * 100;
    };
    Data.trajectoryMultiplier = { rising: 0.65, stable: 1.15, declining: 1.35 };
    Data.trajectoryTags = {
      rising: 'RISING — PAYS LESS NOW',
      stable: 'STABLE — GOOD MONEY, GOING NOWHERE',
      declining: 'DECLINING — BIG MONEY, FALLING FAST'
    };

    // Trajectory bias (§5c): risers cluster near the bottom of each tier
    // (the exciting gambles), stable dominates the middle, decliners are
    // scattered including a few dangerous ones near the very top.
    function trajectoryForRank(rank, tier) {
      var b = Data.tierBoundsForTier(tier);
      var pos = (rank - b[0]) / (b[1] - b[0]); // 0 = best rank in tier, 1 = worst
      var r = seededRand(rank * 7.13);
      if (pos > 0.7 && r < 0.45) return 'rising';
      if (pos < 0.2 && r < 0.22) return 'declining';
      if (r < 0.55) return 'stable';
      if (r < 0.8) return 'declining';
      return 'rising';
    }

    // Baseline salary/month interpolated within its band by rank (§5c table).
    // Continuous at the rank 10/11 boundary ($50,000).
    Data.baselineSalaryForRank = function (rank) {
      var t;
      if (rank >= 51) { t = (100 - rank) / (100 - 51); return 500 + t * (2500 - 500); }
      if (rank >= 21) { t = (50 - rank) / (50 - 21); return 3000 + t * (10000 - 3000); }
      if (rank >= 11) { t = (20 - rank) / (20 - 11); return 20000 + t * (50000 - 20000); }
      t = (10 - rank) / (10 - 1); return 50000 + t * (250000 - 50000);
    };

    // Recomputes a team's live salary from its (possibly moved) rank and its
    // fixed trajectory personality trait — call whenever `rank` changes.
    Data.salaryForRankTrajectory = function (rank, trajectory) {
      var baseline = Math.round(Data.baselineSalaryForRank(rank));
      var mult = Data.trajectoryMultiplier[trajectory] || 1;
      return Math.round(baseline * mult);
    };

    Data.requirementsForRank = function (rank, tier) {
      var b = Data.tierBoundsForTier(tier);
      var pos = (rank - b[0]) / (b[1] - b[0]); // 0 = top of tier (hardest), 1 = bottom (easiest)
      var harder = 1 - pos;
      // SPEC-V6 §8: per-rank required elo (was a flat per-tier floor).
      var req = { elo: Data.eloRequirementForRank(rank) };
      if (tier === 3) {
        req.hype = Math.round(5 + harder * 20);
        req.winRate = Math.round((0.30 + harder * 0.15) * 100) / 100;
      } else if (tier === 2) {
        req.hype = Math.round(30 + harder * 25);
        req.chemistry = Math.round(40 + harder * 20);
      } else {
        req.hype = Math.round(55 + harder * 30);
        req.chemistry = Math.round(60 + harder * 20);
        if (rank <= 10) req.followers = Math.round(4000 + (10 - rank) * 600);
      }
      return req;
    };

    // SPEC-V5 §30: contract length now ranges 8-16 days (was up to 31,
    // varying by tier) — uniform across tiers now.
    function contractSleepsFor(rank, tier) {
      var r = seededRand(rank * 2.31);
      return 8 + Math.round(r * 8);   // 8-16
    }

    var teams = [];
    for (var rank = 1; rank <= 100; rank++) {
      var seed = SEED_TEAMS[rank - 1];
      var name, colors, letter, badge;
      if (seed) {
        name = seed.name; colors = seed.colors; letter = seed.letter; badge = seed.badge;
      } else {
        name = FICTIONAL_TEAM_NAMES[rank - SEED_TEAMS.length - 1];
        colors = PALETTE[rank % PALETTE.length];
        var words = name.split(' ');
        letter = (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
        badge = BADGE_STYLES[rank % BADGE_STYLES.length];
      }
      var tier = Data.tierForRank(rank);
      var trajectory = trajectoryForRank(rank, tier);
      var salary = Data.salaryForRankTrajectory(rank, trajectory);
      var signingBonus = Math.round(salary * (1 + seededRand(rank * 3.71) * 1.5)); // 1x-2.5x monthly salary
      var strength = Math.round(clamp01(100 - (rank - 1) * 0.85 + (seededRand(rank * 5.2) - 0.5) * 6, 5, 100));
      teams.push({
        id: 'team' + rank,
        name: name,
        rank: rank,
        tier: tier,
        strength: strength,
        points: Data.pointsForRank(rank),  // §5d — the mutable ladder score; state.js seeds d.teams from this once
        salary: salary,
        signingBonus: signingBonus,
        contractSleeps: contractSleepsFor(rank, tier),
        trajectory: trajectory,
        requirements: Data.requirementsForRank(rank, tier),
        colors: colors,
        letterform: letter,
        badgeStyle: badge
      });
    }
    Data.teams = teams;

    // SPEC-V5 §1: assert all 100 team names are unique, and that no single
    // word appears in more than one name — runs at module load (boot), so a
    // future edit that reintroduces a collision fails loudly and immediately
    // instead of shipping dozens of "...TITANS" teams again.
    (function assertUniqueTeamNames() {
      var seenNames = {};
      var seenWords = {};
      for (var i = 0; i < teams.length; i++) {
        var n = teams[i].name;
        if (seenNames[n]) throw new Error('Data.teams: duplicate team name "' + n + '"');
        seenNames[n] = true;
        var words = n.split(' ');
        for (var w = 0; w < words.length; w++) {
          var word = words[w];
          if (seenWords[word]) {
            throw new Error('Data.teams: word "' + word + '" repeats across team names (in "' + n + '")');
          }
          seenWords[word] = true;
        }
      }
      if (teams.length !== 100) throw new Error('Data.teams: expected exactly 100 teams, got ' + teams.length);
    })();
  })();

  /* ---- tournament calendar (SPEC-V4 §6a) ------------------------------------
     Keyed by the signed player's team tier. `intervalSleeps` is the same for
     all tiers (every 14 sleeps, §6a) but kept per-entry in case a future
     round wants to vary it. `field` is total teams in the bracket (a power
     of 2, for a clean single-elim bracket); `seedExtra` is how many of those
     slots are higher-ranked "seeded" sides above the nearby-rank pool, so
     upsets are possible per §6a. `prizeSplit` fractions of `prizePool` by
     final placement (winner, runner-up, ... ), summing to 1.0. ------------- */
  // SPEC-V5 §25: every 7 days (was 14) — deliberately the SAME modulus rent
  // uses (State.applyRent's `d.day % 7`), so both fire on the same sleep by
  // construction (both are evaluated in resolveNewDay against the same
  // pre-increment d.day; see js/state.js's maybeRunLeagueCycle/applyRent).
  // Tournaments no longer land on a strict weekly metronome — the cadence is
  // rolled in [min, max] each cycle so the calendar stops being predictable.
  // `tournamentIntervalSleeps` is KEPT as the fallback any older caller reads
  // and as the max; State.rollTournamentInterval() in js/state.js is the only
  // thing that should be picking a real interval.
  Data.tournamentIntervalSleeps = 7;
  Data.tournamentIntervalMinSleeps = 4;
  Data.tournamentIntervalMaxSleeps = 7;

  // How many MAPS the FINAL is played over, by the tournament's tier. Every
  // other match in every bracket stays a single map. Tier 3 finals stay Bo1
  // deliberately — the step up to a Bo3 final is part of what makes reaching
  // tier 2 feel like a promotion. First to 2 maps takes it; a Bo3 therefore
  // spans 2-3 days under the one-match-per-day rule, which is the point.
  Data.tournamentFinalBestOf = { 1: 3, 2: 3, 3: 1 };

  // What reaching TIER 1 costs. All three are required together — see
  // State.hasEarnedTier1(). Tier 1 is the top of the ladder and should read as
  // the hardest thing in the game to be offered, so this is deliberately an
  // AND, not a menu of alternatives.
  /* Sponsor CONTRACT TERM (V22, owner item 1) — a sponsor signs for a fixed
     run of weeks and then leaves of its own accord, freeing the slot.

     The problem this solves: with 3 slots and no expiry, the first three
     sponsors a player ever accepted held those slots for the rest of the
     career. Better sponsors kept scouting and had nowhere to land, and the
     player had no way to trade up — the reward for growing was an offer you
     could only decline. A term turns the roster over on its own, so the
     catalog's better entries actually reach the player.

     Weeks, not days, because a sponsor's whole rhythm is the weekly
     obligation/payout tick — a term that ended mid-week would cut a week the
     player had already done the work for. Term length is rolled per signing
     so all three slots don't fall due together. */
  Data.sponsorTermWeeksMin = 1;
  Data.sponsorTermWeeksMax = 3;

  /* SCOUT HYPE (V22, owner item 6) — every source, in one table.

     The owner's two notes were "it should be based on how many tournament
     games you win or lose" and "it should be slightly harder to gain, since
     currently you get full hype after just one full tier 3 contract."

     Both had the same cause: hype's dominant source was a DAILY one. An
     S-grade TRAIN paid +4, repeatable every single day, so ~25 good training
     days maxed the stat regardless of results — and tournaments, which is
     where a scout would actually be watching, only paid out once per event on
     final placement. The stat measured diligence, not performance.

     Rebalanced so tournament MATCHES are the engine:
       - trainS drops 4 -> 1. Still a reward for a perfect session, no longer
         the whole economy.
       - matchWin (solo PLAY) drops to 0. Solo queue is not scouted; leaving it
         at +1/day would just be the old daily treadmill at a slower speed.
       - tournamentWin/tournamentLoss are NEW and are the point: every
         tournament match moves hype, win or lose.
     Placement bonuses stay but shrink, since the per-match awards now cover
     most of a deep run — otherwise a title would double-pay.

     A hype LOSS on a tournament defeat is deliberately larger than a win's
     gain: hype should be volatile and earned repeatedly, which is what stops
     it from ratcheting to 100 and staying there. */
  /* V22c (owner item 1): a career STARTS on some hype. When hype became a
     tournament-driven stat, 0 became a dead start: tier 3 teams want hype
     before they will offer, and tournaments only exist once you are signed —
     a career could never open the door it needed to walk through. 25 clears
     the tier 3 bar without touching the tier 1 gate (which needs 100). */
  Data.hypeStart = 25;

  /* V22c (owner item 4): a real-time floor between solo PLAY matches, so ELO
     cannot be farmed by spamming the button. Energy alone was not a brake —
     an ad refill or a stack of energy drinks removes it entirely. 45s is long
     enough to stop machine-gunning and short enough that ordinary play never
     notices it (a match already costs 20 energy = ~20s of regen). */
  Data.matchCooldownMs = 45000;

  Data.hype = {
    trainS: 1,             // a perfect TRAIN session
    matchWin: 0,           // solo PLAY win — no longer a hype source
    tournamentWin: 2,      // per tournament MATCH won (a Bo3 series counts once)
    tournamentLoss: -3,    // per tournament MATCH lost
    champion: 12,
    runnerUp: 7,
    semifinalist: 2,
    earlyExit: -3,
    // Kicked off a team for missing the scrim quota three days running. Lives
    // here with the rest so the table is the complete picture of what moves
    // this stat — a penalty left hardcoded in state.js is exactly the kind of
    // number nobody finds when they come to retune hype later.
    kicked: -20
  };

  Data.tier1Gate = {
    hype: 100,         // maxed scout hype — 100/100, nothing less
    chemistry: 90,     // held, not peaked: chemistry decays, so this must be true NOW
    completedTier: 2   // a tier 2 contract RUN TO TERM (never via leaveTeam())
  };
  // SPEC-V5 §23: tournaments are tier-locked — only same-tier teams may
  // enter a tier's event. This REPLACES SPEC-V4 §6a's "plus a couple of
  // seeded higher-ranked sides"; `seedExtra` is kept at 0 (not deleted, old
  // name/shape preserved) purely so any external reader of this table
  // doesn't choke on a missing key, but js/state.js's rollTournamentField()
  // no longer reads it for anything.
  Data.tournamentTiers = {
    1: { tier: 1, event: 'THE MAJOR',          field: 16, prizePool: 1000000, seedExtra: 0 },
    2: { tier: 2, event: 'INTERNATIONAL LAN',  field: 12, prizePool: 50000,   seedExtra: 0 },
    3: { tier: 3, event: 'REGIONAL QUALIFIER', field: 8,  prizePool: 5000,    seedExtra: 0 }
  };
  // SPEC-V5 §28: tournament matches move the player's ELO ~3x a regular
  // match — see js/state.js's applyTournamentElo() (called from
  // resolveMatch() whenever the match involves the player).
  Data.tournamentEloMultiplier = 3;
  // SPEC-V5 §29: AI team tournament results are blended with the existing
  // strength-based winChance rather than replacing it — a signed +bias moves
  // a team's effective 50/50 toward its trajectory's target win rate
  // (rising ~70%, declining ~35%, stable ~50%). See js/state.js's
  // resolveMatch()/trajBiasFor().
  Data.trajectoryWinBias = { rising: 0.20, stable: 0, declining: -0.15 };
  // Placement prize split (§6b: "winner ~50%, runner-up ~20%, and so on"),
  // shared by all tiers/field sizes — remaining placements split the tail
  // evenly across everyone eliminated at that round.
  Data.tournamentPrizeSplit = [0.50, 0.20, 0.10, 0.10, 0.05, 0.05];

  /* ---- official team match prize money (SPEC-V2 §2) -----------------------
     PLAY becomes an OFFICIAL MATCH once signed: prize = tierPrize * (0.5 +
     chemistry/100) on a win, prize * 0.15 on a loss. Free agents earn $0. --- */
  Data.matchPrizes = { t3: 120, t2: 700, t1: 4000 };

  /* ---- SPEC-V6 §18: setup quality feeds TEAM performance -------------------
     desk/pc/monitor/chair tiers (band: starter/pro/elite) average into a
     0..1 "setup quality" score (js/state.js's setupQuality()) that adds a
     bonus to OFFICIAL match and tournament win chance specifically — on top
     of (not instead of) the existing solo-ELO gear.aim contribution. A
     player on a bad rig visibly underperforms for their team. ------------- */
  Data.setupQualityBandValue = { starter: 0, pro: 0.5, elite: 1.0 };
  Data.setupQualityWinBonus = 0.08;   // max +8 percentage points of win chance for an all-elite setup
  Data.setupQualityPowerBonus = 15;   // max +15 tournament "power" points (comparable to the other terms)

  /* ---- cases (SPEC-V3 §11 / §12 — REPLACES SPEC-V2 §12 values + $2.50 cost)
     Chances are UNCHANGED from V2 (65/25/6.5/2.5/1); only value ranges move,
     and the case now costs $7.00 (was $2.50 in V2; briefly $5.00 mid-spec,
     raised to $7.00 to bring EV to ~$7.31, near break-even by design — see
     the LEAD NOTE under SPEC-V3 §12. Do not "fix" this back down.).

     The RARE SPECIAL (gold) row is a deliberate mystery: min/max are null
     and `hidden: true` marks it so a caller knows to render a mystery value
     ('?') instead of a range. The REAL two-tier gold roll (2/3 chance of
     $90-150, 1/3 chance of $250-500) is intentionally NOT stored here or
     anywhere else Data-side — it lives only as private constants inside
     js/state.js's State.openCase(), so nothing the UI can read (including
     this catalog) can leak the split. See SPEC-V3 §11. ------------------- */
  Data.caseCost = 7.00;
  Data.caseOdds = [
    { id: 'milspec',    label: 'MIL-SPEC',     chance: 0.650,  min: 0.40, max: 2.40, colorVar: '--r-milspec' },
    { id: 'restricted', label: 'RESTRICTED',   chance: 0.250,  min: 3.00, max: 7.40, colorVar: '--r-restricted' },
    { id: 'classified', label: 'CLASSIFIED',   chance: 0.065,  min: 12,   max: 28,   colorVar: '--r-classified' },
    { id: 'covert',     label: 'COVERT',       chance: 0.025,  min: 40,   max: 100,  colorVar: '--r-covert' },
    { id: 'rare',       label: 'RARE SPECIAL', chance: 0.010,  min: null, max: null, hidden: true, colorVar: '--r-rare' }
  ];

  /* ---- SPEC-V15 §7/§10: PRIME + ELITE case tiers + the case selector ------
     Same chance table (Data.caseOdds) and the same hidden two-tier gold
     mechanism at EVERY tier — only value bands scale with cost, and they
     scale by exactly `cost / Data.caseCost`, which reproduces the identical
     EV/cost ratio (~+4.4%) the $7 case took three iterations to land on
     (Data.caseOdds's min/max stay the single source of truth for the BASE
     bands; nothing here duplicates them — js/state.js derives every tier's
     scaled bands from these two numbers at read time, never a second copy
     of the ranges). Verified empirically over >=200k simulated opens in
     test-v15-rules.js — see that file for the measured EVs.
     `id` is also what `d.caseSelection.solo`/`.stream` (SPEC-V15 §10) store. */
  Data.caseTiers = [
    { id: 'case_standard', label: 'STANDARD CASE', cost: 7.00 },
    { id: 'case_prime',    label: 'PRIME CASE',     cost: 50.00 },
    { id: 'case_elite',    label: 'ELITE CASE',     cost: 200.00 }
  ];

  /* ---- CASE CONTENTS (V22, owner item 2) ------------------------------------
     Each case has its OWN pool. There used to be a single flat `Data.skins`
     that all three drew from, which is why opening a $200 case showed the same
     items as a $7 one — the price changed, the contents did not.

     Counts mirror the real CS2 cases the owner named, so each case has the
     shape a player would expect from its namesake:

       FRACTURIOUS ($7)   <- Fracture Case:        7/5/3/2 + 4 knives
       GLOVES ($50)       <- Glove Case:           7/5/3/2 + 6 glove sets
       WEAPONS ($200)     <- CS:GO Weapon Case:    3/3/2/1 + 5 knives

     The WEAPONS case is deliberately the SHALLOWEST (9 skins, not 17), exactly
     like its namesake: the original CS:GO Weapon Case was a small pool, and a
     small pool with one Covert in it is what makes the pull feel targeted
     rather than scattered. Fewer items at a higher price is the point.

     Rarity keys match Data.caseOdds' five bands (65/25/6.5/2.5/1) one-for-one,
     so no odds change was needed — only the tables. `rare` is the hidden gold
     band (knives/gloves), which State.openCase never names in advance.

     Names are originals in the CS2 idiom, not the real strings.

     Every skin also carries a `sprite`: the weapon SILHOUETTE id plus its
     finish, which js/cases.js renders as a 16x16 pixel tile on the roulette.
     Silhouettes are shared per weapon (an AK is an AK whatever the finish) and
     the finish supplies the palette — the same way CS skins actually work, and
     the reason 58 distinct tiles need 14 drawn shapes rather than 58. See
     SKIN_SPRITES in js/cases.js. ---------------------------------------- */
  Data.caseSkins = {
    case_standard: {
      milspec: [
        { name: 'P250 | Cassetta',            sprite: { gun: 'pistol', finish: 'tape' } },
        { name: 'SSG 08 | Mainframe 002',     sprite: { gun: 'sniper', finish: 'circuit' } },
        { name: "SG 553 | Ol' Rusted",        sprite: { gun: 'rifle',  finish: 'rust' } },
        { name: 'Negev | Faultzone',          sprite: { gun: 'lmg',    finish: 'fault' } },
        { name: 'PP-Bizon | Riftwalk',        sprite: { gun: 'smg',    finish: 'rift' } },
        { name: 'Dual Berettas | Cracked Pearl', sprite: { gun: 'duals', finish: 'pearl' } },
        { name: 'MAC-10 | Shatterglass',      sprite: { gun: 'smg',    finish: 'glass' } }
      ],
      restricted: [
        { name: 'MAG-7 | Monster Howl',       sprite: { gun: 'shotgun', finish: 'howl' } },
        { name: 'Galil AR | Connexions',      sprite: { gun: 'rifle',   finish: 'circuit' } },
        { name: 'Tec-9 | Brotherhood',        sprite: { gun: 'pistol',  finish: 'crimson' } },
        { name: 'Nova | Fracturine',          sprite: { gun: 'shotgun', finish: 'fault' } },
        { name: 'MP5-SD | Faultline',         sprite: { gun: 'smg',     finish: 'fault' } }
      ],
      classified: [
        { name: 'M4A4 | Tooth Goblin',        sprite: { gun: 'rifle',  finish: 'toxic' } },
        { name: 'Glock-18 | Vogueish',        sprite: { gun: 'pistol', finish: 'vogue' } },
        { name: 'XM1014 | Entombment',        sprite: { gun: 'shotgun', finish: 'tomb' } }
      ],
      covert: [
        { name: 'Desert Eagle | Printstorm',  sprite: { gun: 'pistol', finish: 'printstream' } },
        { name: 'AK-47 | Legion of Osiris',   sprite: { gun: 'rifle',  finish: 'anubis' } }
      ],
      rare: [
        { name: 'Nomad Knife | Fractured',    sprite: { gun: 'knife', finish: 'fault' } },
        { name: 'Paracord Knife | Riftedge',  sprite: { gun: 'knife', finish: 'rift' } },
        { name: 'Skeleton Knife | Boneshard', sprite: { gun: 'knife', finish: 'bone' } },
        { name: 'Survival Knife | Splintered', sprite: { gun: 'knife', finish: 'glass' } }
      ]
    },

    case_prime: {
      milspec: [
        { name: 'MP7 | Cirrostrata',          sprite: { gun: 'smg',    finish: 'cirrus' } },
        { name: 'Glock-18 | Ironworks',       sprite: { gun: 'pistol', finish: 'iron' } },
        { name: 'Galil AR | Blacksands',      sprite: { gun: 'rifle',  finish: 'sand' } },
        { name: 'P2000 | Tanline',            sprite: { gun: 'pistol', finish: 'sand' } },
        { name: 'UMP-45 | Handstitch',        sprite: { gun: 'smg',    finish: 'stitch' } },
        { name: 'CZ75-Auto | Palmgrip',       sprite: { gun: 'pistol', finish: 'leather' } },
        { name: 'Sawed-Off | Knuckleduster',  sprite: { gun: 'shotgun', finish: 'iron' } }
      ],
      restricted: [
        { name: 'USP-S | Cyrexis',            sprite: { gun: 'pistol', finish: 'cyrex' } },
        { name: 'M4A1-S | Flashbacker',       sprite: { gun: 'rifle',  finish: 'flash' } },
        { name: 'Dual Berettas | Royal Consort', sprite: { gun: 'duals', finish: 'royal' } },
        { name: 'Nova | Gloveworn',           sprite: { gun: 'shotgun', finish: 'leather' } },
        // 'leather', not 'stitch': UMP-45 | Handstitch above is already
        // smg+stitch, and an identical gun+finish pair renders a pixel-for-
        // pixel identical tile — two of them at DIFFERENT rarities on the same
        // wheel. test-v22-fixes.js asserts the pairs stay unique.
        { name: 'MP9 | Stitchwork',           sprite: { gun: 'smg',    finish: 'leather' } }
      ],
      classified: [
        { name: 'FAMAS | Mecha Foundry',      sprite: { gun: 'rifle',   finish: 'mecha' } },
        { name: 'P90 | Shallow Tomb',         sprite: { gun: 'smg',     finish: 'tomb' } },
        { name: 'Sawed-Off | Wasteland Duchess', sprite: { gun: 'shotgun', finish: 'waste' } }
      ],
      covert: [
        { name: 'SSG 08 | Dragonflame',       sprite: { gun: 'sniper', finish: 'dragon' } },
        { name: 'M4A4 | Buzzsaw',             sprite: { gun: 'rifle',  finish: 'buzz' } }
      ],
      rare: [
        { name: 'Bloodhound Gloves | Snakebite', sprite: { gun: 'gloves', finish: 'snake' } },
        { name: 'Driver Gloves | Overtake',      sprite: { gun: 'gloves', finish: 'leather' } },
        { name: 'Hand Wraps | Ducttape',         sprite: { gun: 'gloves', finish: 'tape' } },
        { name: 'Moto Gloves | Spearmint Rush',  sprite: { gun: 'gloves', finish: 'mint' } },
        { name: 'Specialist Gloves | Crimson Lattice', sprite: { gun: 'gloves', finish: 'crimson' } },
        { name: 'Sport Gloves | Hedge Maze',     sprite: { gun: 'gloves', finish: 'hedge' } }
      ]
    },

    case_elite: {
      milspec: [
        { name: 'MP7 | Skullwork',            sprite: { gun: 'smg',   finish: 'bone' } },
        { name: 'SG 553 | Ultraviolence',     sprite: { gun: 'rifle', finish: 'violet' } },
        { name: 'AUG | Wingspan',             sprite: { gun: 'rifle', finish: 'pearl' } }
      ],
      restricted: [
        { name: 'M4A1-S | Deepwater',         sprite: { gun: 'rifle',  finish: 'deep' } },
        { name: 'USP-S | Deepwater',          sprite: { gun: 'pistol', finish: 'deep' } },
        { name: 'Glock-18 | Dragon Ink',      sprite: { gun: 'pistol', finish: 'dragon' } }
      ],
      classified: [
        { name: 'AK-47 | Case Tempered',      sprite: { gun: 'rifle',  finish: 'tempered' } },
        { name: 'Desert Eagle | Hypnosis',    sprite: { gun: 'pistol', finish: 'hypno' } }
      ],
      covert: [
        { name: 'AWP | Thunderstrike',        sprite: { gun: 'sniper', finish: 'thunder' } }
      ],
      rare: [
        { name: 'Bayonet | Tempered',         sprite: { gun: 'knife', finish: 'tempered' } },
        { name: 'Flip Knife | Marble Vein',   sprite: { gun: 'knife', finish: 'marble' } },
        { name: 'Gut Knife | Rustbite',       sprite: { gun: 'knife', finish: 'rust' } },
        { name: 'Karambit | Doppelganger',    sprite: { gun: 'knife', finish: 'doppler' } },
        { name: 'M9 Bayonet | Sapphire Vein', sprite: { gun: 'knife', finish: 'sapphire' } }
      ]
    }
  };

  /* skinsForCase — THE resolver. Both consumers (State.openCase's real roll in
     js/state.js and the roulette strip in js/cases.js) go through this, so the
     pool a player sees rushing past is by construction the pool they can
     actually win from. Two separate lookups is precisely how a wheel ends up
     advertising items a case does not contain.

     Falls back to the $7 case for an unknown id rather than returning empty:
     a case that rolls nothing would be a crash, and an old save carrying a
     retired caseSelection id is a real possibility. */
  Data.skinsForCase = function (caseId, rarity) {
    var pools = Data.caseSkins[caseId] || Data.caseSkins.case_standard;
    return (pools && pools[rarity]) || [];
  };

  Data.wears = ['FN', 'MW', 'FT', 'WW', 'BS'];

  /* ---- room tiers — DELETED (TASKS-REMAINING #5) ---------------------------
     `Data.roomTiers` used to live here: a 3-entry table of grid sizes and wall/
     floor materials for CRAMPED BEDROOM / APARTMENT / GAMING MANSION. It is
     gone, and this tombstone is here so nobody re-adds it believing it was an
     oversight.

     It had been dead for several versions while still LOOKING authoritative,
     which is worse than absent:
       - grid size comes from `Data.locations` + `State.currentGrid()`;
       - wall/floor materials come from `LOCATION_VISUALS` in js/iso.js;
       - its `windows: N` field stopped meaning anything in V20, when built-in
         windows were removed and windows became purchasable wall props.

     Beware a name collision when reading js/iso.js: `roomTier` is still a
     LOCAL PARAMETER NAME there (computeCamera/drawFloor/drawWalls/wallTexture).
     Those receive a LOCATION_VISUALS-derived object and never had anything to
     do with this table. Renaming them is a separate, purely cosmetic job.

     Still alive on purpose, do NOT chase these down:
       - `State.data.roomTier` (js/state.js defaultData) — a dead scalar kept so
         old saves normalise cleanly. Written by State.buyItem, read by nothing.
       - the two `category:'room'` lease items below — unreachable, because
         js/shop.js and js/phone.js both filter `category === 'room'` out. They
         stay so an old save that already owns one still resolves its def. ---- */

  /* ---- locations (SPEC-V2 §6 / §7) -----------------------------------------
     REPLACES the roomTier concept entirely: locationId + expansions. This
     table is the source of truth the renderer, the shop's STAFF/LOCATIONS tabs
     and the moving minigame all read.
     gridW/gridD are the BASE grid before expansions; `State.currentGrid()`
     adds `expansions` (capped at `expandCap`) to both dimensions.
     `expandCost = baseExpand * (1.8 ^ expansionsBought)` — see
     `State.expansionCost()` / `State.buyExpansion()`. -------------------- */
  // SPEC-V6 §28: room expansion is DELETED entirely — grid size now comes
  // ONLY from the location, each exactly one tile larger than the last.
  // `expandCap`/`baseExpand` are gone (js/state.js's State.expansionCost()/
  // State.buyExpansion() are kept as no-op stubs — old names, extend don't
  // rename — for any caller still wired to them, per the integration
  // contract). Two new top-end locations added (PENTHOUSE SUITE, PRIVATE
  // ISLAND COMPOUND); existing saves with `expansions > 0` migrate cleanly —
  // see js/state.js's normalizeSave()/currentGrid() (the field is kept,
  // just no longer read for sizing).
  // SPEC-V16 §1 (owner request): every location shrinks by 2 tiles per side —
  // the ladder now starts at 4x4 and still steps exactly +1 per side
  // (4,5,6,7,8,9 — was 6..11). Two knock-ons, both handled rather than
  // worked around: Data.defaultPlaced's bed anchor below is re-derived for a
  // 4x4 grid, and js/state.js's migrateShrunkGrid() relocates (never
  // deletes) props an existing save left outside its now-smaller room.
  Data.locations = [
    { id: 0, name: "PARENTS' BASEMENT",     gridW: 4, gridD: 4, moveInCost: 0,       rent: 0,      streamMult: 1.00, backdrop: 'suburban_night' },
    { id: 1, name: 'CITY CENTRE APARTMENT', gridW: 5, gridD: 5, moveInCost: 3500,    rent: 350,    streamMult: 1.25, backdrop: 'neon_skyline' },
    { id: 2, name: 'BEACH VILLA',           gridW: 6, gridD: 6, moveInCost: 25000,   rent: 1800,   streamMult: 1.60, backdrop: 'ocean_sunset' },
    { id: 3, name: 'ESPORTS MANSION',       gridW: 7, gridD: 7, moveInCost: 150000,  rent: 9000,   streamMult: 2.20, backdrop: 'hills_gated_drive' },
    { id: 4, name: 'PENTHOUSE SUITE',       gridW: 8, gridD: 8, moveInCost: 600000,  rent: 30000,  streamMult: 3.00, backdrop: 'rooftop_haze' },
    { id: 5, name: 'PRIVATE ISLAND COMPOUND', gridW: 9, gridD: 9, moveInCost: 3000000, rent: 120000, streamMult: 4.00, backdrop: 'island_shore' }
  ];

  /* ---- staff: coaches & moderators (SPEC-V2 §5) -----------------------------
     Hired from a new STAFF shop section (next round). One coach + one mod
     active at a time; hiring a better one replaces the old (no refund).
     Coaches: `formMult`/`formLabel` are applied automatically at the start
     of each day by State.endDay() -> State's internal applyCoachAutoForm().
     If the player also trains manually, State.setForm() keeps whichever
     multiplier (coach vs. manual roll) is higher.
     Mods: `autoBanPct` is the share of toxic chat lines auto-banned before
     the player sees them (consumed by js/stream.js in a later round). ---- */
  /* SPEC-V5 §18: LEGENDARY COACH (former level 4) is DELETED — the gap to
     level 3 was negligible. VETERAN IGL (level 3) is now the best coach
     available. Every coach also now handles scrims, via `scrimBehavior`:
       'remind' (L1) — does not fill the quota; js/state.js's sleep-warning
                        check surfaces a prompt if the player tries to sleep
                        before hitting it.
       'gradual' (L2) — js/state.js's effectiveScrimQuota() grants credit
                         that ramps from 0 to the full quota across the day,
                         topped up by nightfall (NIGHT_START_MS).
       'auto' (L3)    — effectiveScrimQuota() always reports the quota met.
     `scrimFraming` is the in-fiction line the UI may show next to the
     coach's scrim behaviour. -------------------------------------------- */
  // SPEC-V7 §10: ROOKIE COACH's auto-form raised 0.25 -> 0.35 — see
  // js/state.js's State.playMatch() winChance retune (base 0.30->0.30,
  // form coefficient 0.35->0.65) for why this alone would still have left
  // a coached player with a losing record (0.30 + 0.35*0.35 = ~0.42).
  Data.staffCoaches = [
    { id: 'coach_rookie',  name: 'ROOKIE COACH', hire: 2000,  upkeep: 40,  formGrade: 'C', formLabel: 'AVERAGE (COACHED)',  formMult: 0.35,
      scrimBehavior: 'remind',  scrimFraming: 'Reminds you if you try to sleep before hitting the team\'s scrim quota.' },
    { id: 'coach_analyst', name: 'TEAM ANALYST', hire: 8000,  upkeep: 150, formGrade: 'B', formLabel: 'SOLID (COACHED)',    formMult: 0.45,
      scrimBehavior: 'gradual', scrimFraming: 'Runs film sessions and drills in the background while you grind.' },
    { id: 'coach_igl',     name: 'VETERAN IGL',  hire: 25000, upkeep: 450, formGrade: 'A', formLabel: 'LOCKED IN (COACHED)', formMult: 0.70,
      scrimBehavior: 'auto',    scrimFraming: 'Schedules and runs the whole practice block — the team trains whether or not you show up early.' }
  ];
  Data.staffMods = [
    { id: 'mod_trial', name: 'TRIAL MOD',   hire: 2000,   upkeep: 60,   autoBanPct: 0.35 },  // SPEC-V5 §19: $3000 -> $2000
    { id: 'mod_vet',   name: 'VETERAN MOD', hire: 8000,   upkeep: 220,  autoBanPct: 0.60 },  // SPEC-V5 §19: $12000 -> $8000
    { id: 'mod_head',  name: 'HEAD MOD',    hire: 40000,  upkeep: 700,  autoBanPct: 0.85 },
    { id: 'mod_ai',    name: 'AUTOMOD AI',  hire: 150000, upkeep: 2400, autoBanPct: 0.97 }
  ];

  /* ---- social media (SPEC-V9 §1-4) ------------------------------------------
     A THIRD master competing with the coach (scrims) and sponsors (stream
     time) for the player's daily energy (§5) — do not add slack that removes
     the choice. Each platform tracks its OWN follower count (js/state.js's
     State.data.social.followers[platformId]); `unlockFollowers` gates on the
     SUM across all platforms (js/state.js's totalSocialFollowers()).
     `followerGainMin/Max` is the TOTAL a single post eventually delivers,
     spread over Data.socialDripDays days (§2) — never instant — and BEFORE
     the §3 virality roll (Data.socialViralityChance/Mult*) which can multiply
     that total 8-15x on ~4% of posts. Posting costs `energyCost` energy for
     the player; social managers (Data.socialManagers below) auto-post for
     free (§4). ---------------------------------------------------------- */
  Data.socialPlatforms = [
    { id: 'clips', name: 'CLIPS', unlockFollowers: 0, energyCost: 12,
      followerGainMin: 30, followerGainMax: 70,
      desc: 'Short-form highlight clips. Frequent, small gains — post often.' },
    { id: 'longform', name: 'LONGFORM', unlockFollowers: 2000, energyCost: 25,
      followerGainMin: 120, followerGainMax: 260,
      desc: 'Full VODs and breakdowns. Slow to make, big payoff per post.' },
    { id: 'microblog', name: 'MICROBLOG', unlockFollowers: 10000, energyCost: 6,
      followerGainMin: 5, followerGainMax: 15,
      desc: 'Quick text takes. Cheap, tiny gains, almost free to keep alive.' }
  ];

  // §2: a post's followers arrive over this many subsequent daily ticks
  // (js/state.js's resolveNewDay -> applySocialDrip), not instantly.
  Data.socialDripDays = 3;

  // §3: virality — same dopamine shape as a rare on-stream case pull.
  Data.socialViralityChance = 0.04;      // ~4% of posts blow up
  Data.socialViralityMultMin = 8;
  Data.socialViralityMultMax = 15;

  // §3: ad revenue, paid on the EXISTING subscriber-payout tick (never a
  // fourth cadence) — see js/state.js's applySocialAdRevenue(), called
  // alongside applySubscriberPayout() in resolveNewDay. $0.015/follower/week
  // keeps this a supplement to (not a replacement for) subscriber income —
  // e.g. the LONGFORM unlock (2,000 followers) is ~$30/week, versus a
  // similarly-sized 2,000-real-follower channel's ~$400/week in subscribers.
  Data.socialAdRevenuePerFollower = 0.015;

  // §3: social followers feed the stream viewer cap's followerFactor
  // (SPEC-V6 §1) at HALF the weight of real followers — see js/state.js's
  // State.viewerCap().
  Data.socialViewerCapFollowerWeight = 0.5;

  // §3: "better subscriber conversion, stacking with the existing
  // income-derived bonus" — see js/state.js's State.applyStreamResult().
  // +1% conversion per 1,000 total social followers, hard-capped at +30%
  // (hit at 30,000 total social followers) so it can never dominate the
  // income-gear-driven base rate.
  Data.socialSubscriberConversionPerThousand = 0.01;
  Data.socialSubscriberConversionCap = 0.30;

  /* ---- social media managers (SPEC-V9 §4) -----------------------------------
     A new staff tier alongside coaches/moderators above — one at a time,
     hire replaces the old (no refund), quits on unpaid upkeep exactly like
     staffCoaches/staffMods (js/state.js's applyStaffUpkeep, extended to
     include the social manager). Auto-posts cost the player ZERO energy —
     that's what the upkeep buys — landing GUARANTEED `postsPerDay` posts,
     every single day (js/state.js's applyManagerAutoPosts()), always on
     Data.socialManagerPlatformId's ('clips') feed, so the manager's output is
     simple to reason about and to surface in the UI as "N posts/day."
     `quality` scales the follower-gain roll on those auto-posts (60/80/100%
     of a normal CLIPS post), same spirit as autoBanPct scaling a mod's
     effectiveness.
     SPEC-V15 §5: replaces the old probabilistic `postsPerWeek/7`-chance-per-
     day model with a guaranteed per-day rate — `postsPerWeek` is gone, there
     is no weekly counter backing this anymore. Still costs the player 0
     energy (SPEC-V9, unchanged). --------------------------------------- */
  Data.socialManagerPlatformId = 'clips';
  Data.socialManagers = [
    { id: 'social_intern',     name: 'SOCIAL INTERN',     hire: 2500,  upkeep: 80,   postsPerDay: 1, quality: 0.60 },
    { id: 'content_editor',    name: 'CONTENT EDITOR',    hire: 12000, upkeep: 300,  postsPerDay: 2, quality: 0.80 },
    { id: 'creative_director', name: 'CREATIVE DIRECTOR', hire: 50000, upkeep: 1200, postsPerDay: 3, quality: 1.00 }
  ];

  /* ---- shop & gear (§5.8) --------------------------------------------------
     stats keys: aim, stream, income, prestige, luck
     `income` (SPEC-V3 §13): no longer idle income (removed) — each point now
     adds +5% subscriber conversion (Data.subscriberConversionPerPoint). Kept
     as `income` in the data so no item's stat key changes; js/shop.js,
     js/hub.js and js/stats.js relabel its display, not its key.
     category: desk | pc | chair | decor | room  (desk/pc/chair are singleton
     slots — buying one replaces the previous placed item of that category)
  ------------------------------------------------------------------------- */
  Data.shopItems = [
    // ---- STARTER BAND -----------------------------------------------------
    { id: 'desk_plywood',       name: 'PLYWOOD DESK',       category: 'desk',  band: 'starter', price: 80,    stats: { aim: 1 },                       desc: 'A wobbly plywood desk. Better than the floor.' },
    { id: 'chair_wooden',       name: 'WOODEN CHAIR',       category: 'chair', band: 'starter', price: 60,    stats: { aim: 1 },                       desc: 'Kitchen chair pressed into esports duty.' },
    { id: 'pc_budget',          name: 'BUDGET RIG',         category: 'pc',    band: 'starter', price: 150,   stats: { aim: 2 },                       desc: 'Runs CS2 on low settings. It boots, mostly.' },
    { id: 'plant_succulent',    name: 'CACTUS',             category: 'decor', band: 'starter', price: 30,    stats: { income: 1 },                    desc: 'Spiky, stubborn, and somehow still alive on stream.' },
    // SPEC-V15-BATCH-B §1: mount: 'wall' — these two occupy a WALL slot
    // (x===0 or y===0 edge tile), not the floor. All wall-slot/rotation/
    // co-tenancy rules live in js/state.js (canPlaceFootprint's def.mount
    // branch) and are exported for js/hub.js to derive from — never a second
    // copy of the rule here or in hub.js.
    // SPEC-V20 §4/§7: `merchBonus: true` marks this as "the banner" for the
    // flat +5% stream views/subscriber gain buff (Data.streamMerchBonusPct,
    // State.merchandiseBonusActive()/merchandiseBonusPct() in state.js) — a
    // banner OR a neon sign placed gives it, the two together still only
    // give it once (non-stacking, single source of truth in state.js).
    // `customisable: true` (§7): same capability as blind/neon/floor-screen/
    // RGB-strip — see State.isCustomisable().
    { id: 'poster_team',        name: 'TEAM POSTER',        category: 'decor', band: 'starter', price: 40,    stats: { prestige: 1 }, mount: 'wall', merchBonus: true, customisable: true, desc: 'Your favorite pro team, taped to the wall.' },
    { id: 'window_blinds',      name: 'MINI BLINDS',        category: 'decor', band: 'starter', price: 70,    stats: { prestige: 1 }, mount: 'wall', desc: 'Keeps the sun off the monitor. Barely.' },
    // V22 (owner item 12) — the rug became a FLOOR UNDERLAY. `noCollide` lets
    // it slide beneath furniture instead of fighting for a tile, and
    // `collideLayer: 'floor'` keeps it out of the LEDs' way (see the noCollide
    // branch in js/state.js's canPlaceFootprint) so a rug can sit under an RGB
    // strip — two rugs still cannot stack. `customisable` puts it in the FABRIC
    // palette alongside the banner and the blind, which is the right family: a
    // rug is dyed cloth, it does not emit light.
    { id: 'rug_pixel',          name: 'PIXEL RUG',          category: 'decor', band: 'starter', price: 50,    stats: { prestige: 1 }, noCollide: true, collideLayer: 'floor', customisable: true, desc: 'An 8-bit rug. Ties the cramped room together.' },
    { id: 'desk_ikea',          name: 'FLATPACK DESK',      category: 'desk',  band: 'starter', price: 220,   stats: { aim: 2, income: 1 },            desc: 'Assembled with the wrong screws, but sturdy.' },
    { id: 'energy_drink_stack', name: 'PIZZA BOX TOWER',    category: 'decor', band: 'starter', price: 90,    stats: { aim: 1, income: 1 },            desc: 'A leaning stack of grease-stained boxes. Fuel of champions.' },
    // MONITORS (SPEC-V5 §5r / §17) — a new singleton category, one of the
    // five minimum-viable-room pieces (bed/desk/chair/pc/monitor). Buying a
    // better one replaces the old one in the room, same as desk/pc/chair/bed
    // (State.buyItem's autoPlaceSingleton). monitor_basic is owned by
    // default (Data.defaultOwned) so a fresh save's room starts complete.
    { id: 'monitor_basic', name: 'BASIC MONITOR',    category: 'monitor', band: 'starter', price: 60,    stats: { aim: 1 },                       desc: 'A hand-me-down monitor. It displays pixels, technically.' },
    { id: 'monitor_144hz', name: '144HZ MONITOR',    category: 'monitor', band: 'pro',     price: 1500,  stats: { aim: 5, stream: 1 },            desc: 'Finally, motion clarity. The frags feel earned now.' },
    { id: 'monitor_240oled', name: '240HZ OLED MONITOR', category: 'monitor', band: 'elite', price: 20000, stats: { aim: 12, stream: 5, prestige: 4 }, desc: 'Inky blacks, zero smear. Looks unreal on stream.' },

    // ---- PRO BAND -----------------------------------------------------------
    { id: 'chair_gaming',       name: 'RACER CHAIR',        category: 'chair', band: 'pro', price: 1200,  stats: { aim: 3, stream: 1 },            desc: 'Faux leather, lumbar support, RGB piping.' },
    { id: 'desk_gaming',        name: 'RGB DESK RIG',       category: 'desk',  band: 'pro', price: 1800,  stats: { aim: 4, income: 3 },            desc: 'Motorized standing desk with a cable-management dream.' },
    // SPEC-V20 §4: gains the same merchBonus capability as poster_team (the
    // banner) and the SAME +5% — placing a banner AND a neon sign together
    // still gives +5% total, never +10% (see State.merchandiseBonusActive()).
    // §2: noCollide — an LED skips tile occupancy entirely (canPlaceFootprint
    // in state.js), so its placement indicator stays green over an occupied
    // tile; two LEDs still can't share one tile.
    // SPEC-V21 §1: `ledCustomise: true` marks this as one of the three LIGHT
    // items (colour picker, driven by Data.customisePalettes.led) rather than
    // one of the two FABRIC items (paint picker, .fabric) — see
    // State.customiseFamily(), the single place that reads this flag. js/hub.js
    // previously derived the same split from a hardcoded id list
    // (LED_CUSTOMISE_IDS) but already prefers this flag when present, so
    // adding it here is what retires that heuristic — no file may keep its
    // own copy of this list.
    { id: 'neon_sign',          name: 'NEON SIGN',          category: 'decor', band: 'pro', price: 1400,  stats: { stream: 2, income: 1 }, noCollide: true, merchBonus: true, customisable: true, ledCustomise: true, desc: 'Buzzes softly. Looks incredible on stream.' },
    { id: 'pc_midrange',        name: 'MID TOWER RIG',      category: 'pc',    band: 'pro', price: 2500,  stats: { aim: 6, stream: 2 },            desc: 'Tempered glass panel, three case fans, real frames.' },
    { id: 'trophy_shelf',       name: 'TROPHY SHELF',       category: 'decor', band: 'pro', price: 3000,  stats: { prestige: 5 },                  desc: 'Empty for now. That will change.' },
    // SPEC-V20 §2: noCollide — skips tile occupancy entirely in
    // canPlaceFootprint() (state.js); never blocks, never blocked. Two LEDs
    // still can't share the same tile. §7: customisable (colour picker is a
    // later package; this just marks the capability for hub.js/H).
    // SPEC-V21 §1: ledCustomise — see the comment on neon_sign above.
    { id: 'rgb_strip',          name: 'RGB LED STRIP',      category: 'decor', band: 'pro', price: 600,   stats: { stream: 2, prestige: 1 }, noCollide: true, customisable: true, ledCustomise: true, desc: 'Sixteen million colors, all of them distracting.' },
    { id: 'cat_bed',            name: 'STREAM CAT BED',     category: 'decor', band: 'pro', price: 900,   stats: { stream: 3, prestige: 2 },       desc: 'The real star of the channel sleeps here.' },
    { id: 'pc_watercooled',     name: 'WATERCOOLED RIG',    category: 'pc',    band: 'pro', price: 6000,  stats: { aim: 9, stream: 4, prestige: 3 }, desc: 'Silent, cold, and terrifyingly fast.' },
    { id: 'room_apartment_lease', name: 'APARTMENT LEASE',  category: 'room',  band: 'pro', price: 5000,  stats: { prestige: 3 }, roomTier: 1,       desc: 'Move out of the childhood bedroom. Finally.' },

    // ---- ELITE BAND -----------------------------------------------------------
    // SPEC-V20 §5: renamed from LUCKY MOUSEPAD -> FLOOR LED SCREEN. The id
    // (`lucky_mousepad`) is KEPT UNCHANGED so existing saves' `owned`/`placed`
    // entries still resolve — only the id is a save-key, never the display
    // name. Its stat effects are stripped entirely (was luck+prestige); it is
    // now purely decorative, same spirit as the RGB strip/neon sign. Gains
    // the shared `customisable` capability (§7) — see State.isCustomisable().
    // SPEC-V21 §1: ledCustomise — see the comment on neon_sign above.
    { id: 'lucky_mousepad',     name: 'FLOOR LED SCREEN',   category: 'decor', band: 'elite', price: 8000,   stats: {}, customisable: true, ledCustomise: true, desc: 'A pulsing floor panel synced to the beat. Pure show, zero stats.' },
    { id: 'chair_pro_esports',  name: 'PRO ESPORTS SEAT',   category: 'chair', band: 'elite', price: 15000,  stats: { aim: 6, stream: 3, prestige: 4 }, desc: 'The exact chair the pros use at Majors.' },
    { id: 'desk_battlestation', name: 'BATTLESTATION DESK', category: 'desk',  band: 'elite', price: 18000,  stats: { aim: 8, income: 8, prestige: 5 }, desc: 'A command center. All that is missing is a coach.' },
    { id: 'pc_elite_rig',       name: 'ELITE HALO RIG',     category: 'pc',    band: 'elite', price: 40000,  stats: { aim: 16, stream: 8, prestige: 10 }, desc: 'Custom loop, dual PSU, absurd frame rates.' },
    { id: 'room_mansion_lease', name: 'MANSION LEASE',      category: 'room',  band: 'elite', price: 60000,  stats: { prestige: 10, income: 5 }, roomTier: 2, desc: 'A whole gaming mansion. You made it.' },

    // ---- BEDS (SPEC-V3 §3) — a new singleton category, like desk/pc/chair.
    // Buying a better bed replaces the old one in the room (see
    // State.buyItem's autoPlaceSingleton). `sleepRate` (energy/sec while
    // asleep) lives outside `stats` since it isn't a gear buff — mirrors how
    // `room` items carry `roomTier` outside `stats`. bed_mattress is owned
    // by default (Data.defaultOwned) and must always exist so
    // State.currentBed() never comes back empty. ---------------------------
    // SPEC-V12 §2: every bed is visually two tiles long — `footprint: {w:2,
    // d:1}` is the general mechanism (js/state.js's footprintTiles()), NOT a
    // bed-specific special case; any item lacking a `footprint` field
    // defaults to 1x1 there. Rotation reorients w/d (0/180 along x, 90/270
    // along y) — see footprintTiles()'s own comment for the exact rule.
    { id: 'bed_mattress',   name: 'FLOOR MATTRESS',  category: 'bed', band: 'starter', price: 0,     sleepRate: 2.5,  footprint: { w: 2, d: 1 }, stats: {}, desc: 'A mattress on the floor. It works, barely.' },
    { id: 'bed_single',     name: 'SINGLE BED',      category: 'bed', band: 'starter', price: 400,   sleepRate: 3.5,  footprint: { w: 2, d: 1 }, stats: {}, desc: 'An actual bed frame. Small upgrade, real difference.' },
    { id: 'bed_memoryfoam', name: 'MEMORY FOAM BED', category: 'bed', band: 'pro',     price: 2500,  sleepRate: 5.0,  footprint: { w: 2, d: 1 }, stats: {}, desc: 'Sinks just right. Recovery time, cut way down.' },
    { id: 'bed_kingsize',   name: 'KING SIZE BED',   category: 'bed', band: 'pro',     price: 12000, sleepRate: 7.0,  footprint: { w: 2, d: 1 }, stats: {}, desc: 'Room to sprawl out after a brutal loss streak.' },
    { id: 'bed_cryopod',    name: 'CRYO SLEEP POD',  category: 'bed', band: 'elite',   price: 90000, sleepRate: 10.0, footprint: { w: 2, d: 1 }, stats: {}, desc: 'Wake up fully charged. Borderline unfair.' },

    // ---- MAX-ENERGY UPGRADES (SPEC-V3 §10) — a new stacking category.
    // SPEC-V13 §2: three distinct energy items (minifridge/fridge/ivdrip),
    // each with its own `energyAdd`. Up to Data.energyItemCap (4) instances
    // of *any mix* of these may be placed at once; State's
    // recomputeEnergyMax() sums energyAdd across all placed energy items and
    // clamps the result to Data.energyMaxCap (200). Four placed IV drips
    // (25 each = 100 bonus) lands exactly on the 200 ceiling. `energyAdd`
    // lives outside `stats` for the same reason `sleepRate` does above.
    // ---------------------------------------------------------------------
    // SPEC-V11 §2 (UNDOES SPEC-V7 §3): the standalone `fridge` category is
    // deleted — it competed with these two items for no reason. These are
    // now the ONLY fridges in the game: besides raising energyMax while
    // placed, they also govern energy-drink storage via `drinkCapacity`
    // (js/state.js's currentFridgeCapacity()/State.fridgeStatus(), same
    // "sum across PLACED items" pattern as energyAdd below). Non-fridge
    // energy items (e.g. the IV drip) simply have no `drinkCapacity` field,
    // which reads as 0.
    { id: 'energy_minifridge', name: 'ENERGY DRINK MINIFRIDGE',  category: 'energy', band: 'pro',     price: 2000,  energyAdd: 15, drinkCapacity: 4,  stats: {}, desc: 'Chills a whole case within arm\'s reach. Place up to 4 to raise max energy. (+15 MAX ENERGY, +4 DRINK STORAGE, WHILE PLACED)' },
    { id: 'energy_fridge',     name: 'ENERGY DRINK FRIDGE',      category: 'energy', band: 'pro',     price: 15000, energyAdd: 20, drinkCapacity: 12, stats: {}, desc: 'Full-height. Never run dry mid-session. Place up to 4 to raise max energy. (+20 MAX ENERGY, +12 DRINK STORAGE, WHILE PLACED)' },
    { id: 'energy_ivdrip',     name: 'ENERGY IV DRIP',           category: 'energy', band: 'elite',   price: 80000, energyAdd: 25, stats: {}, desc: 'Deeply questionable. Deeply effective. Place up to 4 to raise max energy. (+25 MAX ENERGY WHILE PLACED)' },

    // ---- CONSUMABLES (SPEC-V6 §3) — NOT placed in the room; stockpiled in
    // `owned` and drunk on demand via State.drinkEnergyDrink(). REPLACES the
    // old energy_can max-energy room prop entirely (deliberately reuses the
    // same id so any pre-V6 save's owned/placed energy_can entries land on
    // this new definition instead of vanishing — see js/state.js's
    // normalizeSave(), which also strips any stray placed energy_can since
    // consumables are never placeable).
    // SPEC-V7 §3 / SPEC-V11 §2: `requiresFridge: true` marks this item as
    // gated by State.fridgeStatus() in State.buyItem() — locked entirely
    // until a storage-providing energy fridge is placed, and blocked once
    // owned.energy_can reaches the placed fridges' combined capacity.
    { id: 'energy_can', name: 'ENERGY DRINK', category: 'consumable', band: 'starter', price: 20, restoreEnergy: 25, requiresFridge: true, stats: {}, desc: 'A can from the stockpile. Drink it for +25 energy, up to 4 a day. Requires a placed fridge to store.' },
    /* V22c (owner item 5) — CALMING SYRUP. The mirror image of the energy
       drink: it DRAINS 60% of your maximum energy. That is a feature, not a
       cost — energy has to be low to sleep, and sleeping is what advances the
       day, pays salary/subscribers and rolls the tournament clock. This is the
       button for "I want tomorrow now".

       requiresFridge puts it under the SAME storage rule as the can, and
       State.fridgeStatus() counts BOTH stocks against one capacity — 2 cans
       plus 2 syrups fills a 4-slot mini-fridge exactly. */
    { id: 'calming_syrup', name: 'CALMING SYRUP', category: 'consumable', band: 'starter', price: 100, drainEnergyPct: 0.60, requiresFridge: true, stats: {}, desc: 'Thick purple syrup. Drains 60% of your energy so you can actually sleep. Shares fridge space with your cans.' },

    // ---- REGEN (SPEC-V6 §7) — daytime-only regen boosters, placed props.
    // Stack additively while placed; total bonus hard-capped at
    // Data.regenBonusCap (+2.0/s). Night regen stays 0 regardless.
    { id: 'regen_footrest',  name: 'CIRCULATION FAN',          category: 'regen', band: 'starter', price: 800,    regenAdd: 0.15, stats: {}, desc: 'Keeps the air moving through the whole room. (+0.15 ENERGY/S BY DAY, WHILE PLACED)' },
    { id: 'regen_purifier',  name: 'AIR PURIFIER',             category: 'regen', band: 'pro',     price: 4000,   regenAdd: 0.25, stats: {}, desc: 'Clean air, clearer head. (+0.25 ENERGY/S BY DAY, WHILE PLACED)' },
    { id: 'regen_standdesk', name: 'WATER COOLER',             category: 'regen', band: 'pro',     price: 15000,  regenAdd: 0.40, stats: {}, desc: 'Cold water on tap. An iconic corner of any real setup. (+0.40 ENERGY/S BY DAY, WHILE PLACED)' },
    { id: 'regen_hyperbaric', name: 'RECOVERY POD',            category: 'regen', band: 'elite',   price: 120000, regenAdd: 1.00, footprint: { w: 2, d: 1 }, stats: {}, desc: 'Borderline medical equipment. Recovers you fast. (+1.00 ENERGY/S BY DAY, WHILE PLACED)' },

    // ---- WINDOWS (SPEC-V20 §1) — a new `window` category. Built-in room
    // windows are gone; these are the only windows left, purely purchasable
    // now. `mount: 'wall'` — wall-mounted exactly like a banner (reuses
    // State.isWallSlot()/wallRotForTile(), no second wall rule — see
    // js/state.js's canPlaceFootprint()). Wide windows carry `footprint:
    // {w:2,d:1}` and occupy TWO adjacent wall slots (js/state.js's
    // wallFootprintTiles()). `frame` is a renderer hint (black/wood rim) —
    // no mechanical effect. Rendering them at least slightly transparent and
    // reactive to day/night (bright by day, dark at night) is a js/iso.js
    // concern outside this package's ownership (data.js/state.js only) —
    // flagged, not implemented here. stats: {} — purely decorative, like the
    // other wall props.
    { id: 'window_small_black', name: 'SMALL WINDOW — BLACK RIM', category: 'window', band: 'starter', price: 900,  mount: 'wall', frame: 'black', stats: {}, desc: 'A single pane, black-framed. Lets a little of the outside in.' },
    { id: 'window_small_wood',  name: 'SMALL WINDOW — WOOD RIM',  category: 'window', band: 'starter', price: 900,  mount: 'wall', frame: 'wood',  stats: {}, desc: 'A single pane, wood-framed. Lets a little of the outside in.' },
    { id: 'window_wide_black',  name: 'WIDE WINDOW — BLACK RIM',  category: 'window', band: 'pro',     price: 3200, mount: 'wall', frame: 'black', footprint: { w: 2, d: 1 }, stats: {}, desc: 'Two panes wide, black-framed. A real view of the outside.' },
    { id: 'window_wide_wood',   name: 'WIDE WINDOW — WOOD RIM',   category: 'window', band: 'pro',     price: 3200, mount: 'wall', frame: 'wood',  footprint: { w: 2, d: 1 }, stats: {}, desc: 'Two panes wide, wood-framed. A real view of the outside.' },

    // ---- BLINDS (SPEC-V20 §3) — a new `blind` category. `mount: 'wall'`
    // but with its own placement sub-rule (js/state.js's
    // canPlaceFootprint()): snaps ONLY onto a tile that already holds a
    // window, refusing everywhere else with 'BLINDS GO ON WINDOWS'. A small
    // (1-tile) window needs 1 of these; a wide (2-tile) window needs 2 — one
    // per wall tile the window covers. Open/closed is per-instance placed
    // state the player owns (`entry.closed`, defaulted at placement — see
    // State.placeItem()/State.toggleBlind()); tapping to toggle is wired by
    // another package. When EVERY owned-and-placed window is fully covered
    // by CLOSED blinds, sleep regenerates +Data.blindsSleepBonusPct faster
    // (flat, non-stacking, off with zero windows — see
    // State.blindsBonusActive()). Closed blinds also darken the room
    // (js/iso.js rendering concern, outside this package).
    // SPEC-V21 §1: `customisable: true` was missing here — the other four
    // customisable items (poster_team/neon_sign/rgb_strip/lucky_mousepad) all
    // carry it, and SPEC-V20 §7 already lists the blind as customisable
    // (js/hub.js groups it with the banner as "the two fabric ones"), so this
    // was simply an absent flag rather than a design change. No `ledCustomise`
    // here — the blind paints as FABRIC (see State.customiseFamily()).
    { id: 'blind_slat', name: 'WINDOW BLIND', category: 'blind', band: 'starter', price: 150, mount: 'wall', stats: {}, customisable: true, desc: 'Snaps onto a window. Closed, it darkens the room and helps you sleep faster.' }
  ];

  /* ---- SPEC-V21 §4: customisation palettes — ONE source of truth for every
     colour a paintable/LED prop may be set to. js/customise.js (the modal)
     and js/iso.js (the renderer) both read this array; neither may hardcode
     a colour list of its own, or the two will drift the day a palette entry
     changes. `null` ("FACTORY", i.e. no tint / original art) is a valid
     choice everywhere a tint is used but is deliberately NOT a member of
     either array here — it is the absence of a value, not a colour, so
     State.setItemTint()'s validation and the modal's "always offer an undo"
     requirement both handle it as a special case rather than an array entry.
     Fabric colours are matte/desaturated (dyed cloth); LED colours are hot
     and saturated (these are lights, not paint — see js/iso.js's glow()).
     Exactly 8 entries per family per SPEC-V21 §4 — do not resize without
     updating the spec, since §6's swatch-grid layout assumes 8 + FACTORY. */
  Data.customisePalettes = {
    fabric: ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F', '#8E44AD', '#E67E22', '#ECF0F1', '#2C3E50'],
    led:    ['#FF2D6F', '#00CCFF', '#7B5CFF', '#00FF88', '#FFD400', '#FF6A00', '#FF0033', '#FFFFFF']
  };

  /* ---- default starting loadout -------------------------------------------
     bed_mattress is anchored so its SECOND footprint tile (SPEC-V12 §2, 2x1
     at rot 0 spans x and x+1) lands on the room's reserved bed corner
     (bottom-right tile of the grid) — js/state.js's canPlaceFootprint()
     reserves that exact tile for the bed. Anchored one tile short of the
     corner (x = gridW-2, not gridW-1) so the footprint's far edge, not its
     near edge, touches the corner — anchoring AT gridW-1 would push the
     second tile out of bounds. Lines up with the default basement grid,
     which SPEC-V16 §1 shrinks from 6x6 to 4x4 — so the anchor moves with it,
     from (4,5) to (gridW-2, gridD-1) = (2,3), spanning (2,3)+(3,3). The old
     (4,5) is flatly out of bounds at 4x4 (max index 3); this is not a
     cosmetic re-centre. Desk/pc/monitor at (1,1) and chair at (1,2) are
     still in bounds at 4x4 and are unchanged.
     ---------------------------------------------------------------------- */
  // SPEC-V5 §5r: the minimum viable room is bed+desk+chair+pc+monitor — the
  // default loadout now includes a starter monitor so a fresh save's room
  // is already complete (an incomplete room only happens from here on if a
  // future feature lets a core prop be lost, which State.removePlacedAt
  // already guards against for singleton categories).
  // V22 (owner item 1): the career starts on the PLYWOOD DESK, not the
  // FLATPACK. Plywood is the cheapest desk in the catalog ($80 vs $220) and
  // its art is the bare-sawhorse tier — the right first rung for a player who
  // is meant to climb, and it makes the flatpack an actual upgrade to buy
  // rather than something they already own.
  Data.defaultOwned = { desk_plywood: 1, pc_budget: 1, chair_wooden: 1, bed_mattress: 1, monitor_basic: 1 };
  // V22 (owner item 4): the PC is back ON the desk's tile. It stands in the
  // tile's BACK half while the desk occupies the front (see props.pc in
  // js/iso.js) and sorts behind both desk and monitor, so the workstation is
  // one square again without the overlap that made the first attempt wrong.
  //
  // This layout must stay legal under the REAL canPlaceFootprint() on the
  // smallest grid (4x4, PARENTS' BASEMENT) — test-v16-rooms.js asserts exactly
  // that. Occupancy on a fresh 4x4: desk+pc+monitor share (1,1), chair (1,2),
  // bed (2,3)+(3,3) via its {w:2,d:1} footprint.
  /* V22 (owner item 2): a NEW CAREER STARTS WITH AN EMPTY ROOM.
     Everything in Data.defaultOwned sits in the phone's INVENTORY instead, and
     the onboarding's FURNISH YOUR ROOM step has the player place it wherever
     they like — the first thing they do is make the room theirs, rather than
     being handed someone else's layout.

     Consequence, and it is intentional: a fresh save is ROOM INCOMPLETE until
     they finish, so PLAY/TRAIN/STREAM/CASES/CAREER are gated (SPEC-V5 §5r).
     SHOP, room editing and sleeping stay open, so the state is always
     recoverable even for a player who skips the tutorial — and the tutorial
     step will not advance until the room is complete, so the normal path
     cannot strand anyone.

     This reverses the V16 note that "a fresh save's room is already complete".
     That was the right call when nothing taught placement; the furnish step is
     what makes an empty room better than a pre-filled one now.

     Kept as an empty ARRAY, not deleted: normalizeSave() copies it wholesale
     and a missing key would be the §5.1 trap. */
  Data.defaultPlaced = [];

  /* The layout a furnished starter room HAS — the arrangement Data.defaultPlaced
     used to ship. It is no longer applied automatically (the player places
     their own now), but it is kept as the canonical "standard room" because
     several things still need to name one: the test suites assert rules against
     a furnished room, and it documents a layout known to be legal on the
     smallest 4x4 grid. Occupancy: desk+pc+monitor share (1,1), chair (1,2),
     bed (2,3)+(3,3) via its {w:2,d:1} footprint. */
  Data.starterLayout = [
    { id: 'desk_plywood', x: 1, y: 1, rot: 0 },
    { id: 'pc_budget', x: 1, y: 1, rot: 0 },
    { id: 'monitor_basic', x: 1, y: 1, rot: 0 },
    { id: 'chair_wooden', x: 1, y: 2, rot: 0 },
    { id: 'bed_mattress', x: 2, y: 3, rot: 0 }
  ];

  /* ---- COUNTING SHEEP minigame rewards (SPEC-V4 §7) -------------------------
     Deliberately small — form is the headline reward, cash is a token.
     Package N builds the shooting-gallery minigame itself (js/sheep.js);
     these constants + the State.sheepHit()/pendingSheepReward() math in
     state.js are the reward source of truth it calls into. Balance intent
     (do not re-tune): a perfect sleep session is worth +0.10 form and $50 —
     training properly is worth up to +1.00 form. -------------------------- */
  Data.sheepReward = {
    formPerBonus: 0.01,   // form granted per `hitsPerBonus` sheep hit
    hitsPerBonus: 5,       // sheep hits required per +formPerBonus increment
    formCap: 0.10,         // hard cap on total form bonus per sleep
    cashMin: 1, cashMax: 3, // $ per sheep hit, randomised in this range
    cashCapPerSleep: 50,   // hard cap on total sheep cash per sleep
    energyPerHit: 0.03     // SPEC-V15 §6: fraction of max energy restored per hit (was 0.01)
  };

  /* ---- stream chat flavor (§5.7) ------------------------------------------ */
  Data.chatNormal = [
    'gg wp', 'nice frag', 'how do you aim like that', 'clip that!!',
    'W stream', 'first time here, this is sick', 'poggers', 'lets goo',
    'what sens do you use', 'insane read', 'no way', 'clean',
    'sub hype', 'is that a new case', 'ez clap'
  ];
  Data.chatToxic = [
    'uninstall the game', 'you are so bad omegalul', 'report for boosting',
    'bot detected', 'cheater confirmed', 'unfollow speedrun any%',
    'this stream is dogwater', 'ratio + L + no bitches', 'skill issue tbh',
    'go back to bronze'
  ];

  /* ---- sponsors (SPEC-V8 §1-3) -----------------------------------------------
     Static sponsor catalog. Sponsors scout the player on a track separate
     from team offers (js/state.js's tryGenerateSponsorOffers), gated by
     `requires` (followers / subscribers / signed-team leaderboard rank —
     lower rank number is better, mirrors the 100-team leaderboard in
     buildTeams() above). Bigger sponsors pay more (`pay`, $ per week) and
     demand more (`obligation.amount`). Each sponsor carries EXACTLY ONE
     obligation (§2 — never a stack); js/state.js tracks live progress
     toward it and resets on the shared weekly tick (same tick as the
     subscriber payout, SPEC-V3 §13). ------------------------------------- */
  // Data.sponsorObligationTypes: the extensible enum of obligation kinds
  // (§2). obligation.type is read generically everywhere in state.js, so
  // adding a new key + catalog entries needs no save migration.
  // SPEC-V9 §6: CONTENT_POSTS is the fourth type, now implemented — it
  // completes sponsorships (shipped in SPEC-V8 with only 3 of 4 types).
  // Progress is any social-media post, player-authored OR manager
  // auto-posted (js/state.js's recordSponsorContentPost(), called from both
  // State.postContent() and applyManagerAutoPosts()) — counting the manager
  // toward it is deliberate, the exact "pressure valve" role SPEC-V9 §4
  // describes.
  Data.sponsorObligationTypes = {
    STREAM_DAYS: 'stream_days',       // stream on N distinct days this week
    // NOTE THE UNIT: this counts SECONDS, not minutes, despite the id.
    // It originally meant real wall-clock MINUTES, which asked a player to sit
    // streaming for up to four actual hours a week — absurd for a game where a
    // stream session is a minute or two. The amounts are seconds now.
    //
    // The id stays `stream_minutes` on purpose: it is written into saves on
    // every held sponsor, so renaming it would strand every in-flight
    // obligation. Same trade as `lucky_mousepad` further up this file — the id
    // is a save key, never a label. Everything the player SEES says seconds.
    STREAM_MINUTES: 'stream_minutes', // stream N total SECONDS this week (see above)
    MATCH_WINS: 'match_wins',         // win N official (signed-team) matches this week
    CONTENT_POSTS: 'content_posts'    // post N pieces of content (any platform) this week
  };

  Data.sponsors = [
    // -- small local brands: no gate, modest pay, light asks --------------
    { id: 'sp_pixelsnacks', name: 'PIXEL SNACKS', pay: 350,
      requires: { followers: 0, subscribers: 0, rank: 0 },
      obligation: { type: 'stream_days', amount: 2 },
      desc: 'A local snack brand. Just wants your face on stream a couple days a week.' },
    { id: 'sp_fiberline', name: 'FIBERLINE ISP', pay: 500,
      requires: { followers: 500, subscribers: 0, rank: 0 },
      obligation: { type: 'stream_minutes', amount: 120 },
      desc: 'Regional internet provider. Wants a couple of minutes of airtime a week.' },
    { id: 'sp_grindcoffee', name: 'GRIND COFFEE CO', pay: 700,
      requires: { followers: 0, subscribers: 50, rank: 0 },
      obligation: { type: 'stream_days', amount: 3 },
      desc: 'Coffee shop chain. Three streaming days a week keeps the cups full.' },
    // -- mid-tier: real money, real asks -----------------------------------
    { id: 'sp_voltenergy', name: 'VOLT ENERGY', pay: 1200,
      requires: { followers: 5000, subscribers: 200, rank: 0 },
      obligation: { type: 'stream_minutes', amount: 180 },
      desc: 'Mid-tier energy drink. Three minutes of stream time a week.' },
    { id: 'sp_apexperiph', name: 'APEX PERIPHERALS', pay: 1600,
      requires: { followers: 10000, subscribers: 0, rank: 60 },
      obligation: { type: 'match_wins', amount: 2 },
      desc: 'Mouse/keyboard maker. Wants wins on the scoreboard, not screen time.' },
    { id: 'sp_nitroburst', name: 'NITROBURST', pay: 2400,
      requires: { followers: 30000, subscribers: 1500, rank: 40 },
      obligation: { type: 'stream_days', amount: 4 },
      desc: 'National energy drink brand. Four days live a week, no exceptions.' },
    // -- major hardware / energy names: big pay, big demands ---------------
    { id: 'sp_specterhw', name: 'SPECTER HARDWARE', pay: 3200,
      requires: { followers: 60000, subscribers: 3000, rank: 20 },
      obligation: { type: 'stream_minutes', amount: 300 },
      desc: 'Major hardware sponsor. Five minutes of stream time a week, no exceptions.' },
    { id: 'sp_titanchipset', name: 'TITAN CHIPSET', pay: 4500,
      requires: { followers: 150000, subscribers: 8000, rank: 5 },
      obligation: { type: 'match_wins', amount: 4 },
      desc: 'The silicon behind half the league\'s rigs. Wants a winning record, weekly.' },
    // -- SPEC-V9 §6: CONTENT_POSTS sponsors, one per pay tier, so the pool
    // of 4 obligation types no longer repeats across up to 3 held sponsors.
    { id: 'sp_clipfeed', name: 'CLIPFEED', pay: 420,
      requires: { followers: 0, subscribers: 0, rank: 0 },
      obligation: { type: 'content_posts', amount: 2 },
      desc: 'A clip-aggregator app. Just wants you posting a couple times a week.' },
    { id: 'sp_streamgear', name: 'STREAMGEAR CO', pay: 1400,
      requires: { followers: 8000, subscribers: 250, rank: 0 },
      obligation: { type: 'content_posts', amount: 5 },
      desc: 'Webcam/mic bundles. Wants your feeds active — five posts a week.' },
    { id: 'sp_voltagemedia', name: 'VOLTAGE MEDIA GROUP', pay: 3600,
      requires: { followers: 80000, subscribers: 4000, rank: 15 },
      obligation: { type: 'content_posts', amount: 8 },
      desc: 'A media conglomerate. Wants a content machine, not just a player.' }
  ];

  /* ---- SPEC-V15 §4: sponsor pay progress-scaling formula -------------------
     The catalog `pay` above is the BASE. The actual pay a held sponsor
     carries is computed once, at offer-GENERATION time (js/state.js's
     generateSponsorOffer()/refreshSponsorOffers()), by Data.sponsorPayFor(),
     and frozen onto that offer/held sponsor — never recomputed while held, so
     a signed sponsor's pay never drifts week to week. Single source of truth
     so state.js never re-derives this formula a second time. */
  Data.sponsorPayScaling = {
    eloMin: 1500, eloMax: 5000,          // progress = clamp01((elo-eloMin)/(eloMax-eloMin))
    progressMult: 1.15,                  // payMult += progress * progressMult
    tierBoost: { 1: 0.35, 2: 0.20, 3: 0.10 }, // payMult += tierBoost[signedTier] if signed
    floor: 350                           // absolute $/week floor, whatever the maths says
  };
  Data.sponsorPayFor = function (catalogPay, elo, signedTier) {
    var s = Data.sponsorPayScaling;
    var range = (s.eloMax - s.eloMin) || 1;
    var progress = ((elo || 0) - s.eloMin) / range;
    progress = Math.max(0, Math.min(1, progress));
    var tierBoost = signedTier ? (s.tierBoost[signedTier] || 0) : 0;
    var payMult = 1.0 + progress * s.progressMult + tierBoost;
    var pay = Math.round((catalogPay * payMult) / 10) * 10;
    return Math.max(s.floor, pay);
  };

  /* ---- SPEC-V10 §1: crypto market — coin catalog ---------------------------
     Four coins, deliberately different volatility bands and start prices
     spanning orders of magnitude so the portfolio reads like a real exchange.
     dailyVol is the ±% used by js/state.js to scale each price tick (there
     are Data.crypto.ticksPerDay ticks per "crypto day" — see below; per-tick
     volatility is dailyVol scaled down by sqrt(ticksPerDay), standard
     random-walk variance scaling). --------------------------------------- */
  Data.cryptoCoins = [
    { id: 'BITCOYN',  name: 'Bitcoyn',   symbol: 'BCN',  startPrice: 40000, dailyVol: 0.02 }, // blue chip, slow
    { id: 'ETHERIUM', name: 'Etherium',  symbol: 'ETM',  startPrice: 2500,  dailyVol: 0.05 }, // mid-cap
    { id: 'SOLANO',   name: 'Solano',    symbol: 'SLO',  startPrice: 150,   dailyVol: 0.10 }, // high beta
    { id: 'DOGEBORK', name: 'Dogebork',  symbol: 'BORK', startPrice: 0.12,  dailyVol: 0.22 }  // memecoin, absurd
  ];

  /* ---- SPEC-V10 §2-4: crypto market rules -----------------------------------
     NO LEVERAGE. No margin, no liquidation. Spot only — see SPEC-V10-CRYPTO.md
     for why this is a hard, non-negotiable constraint.

     "day" here means Data.crypto.ticksPerDay consecutive price ticks — an
     internal pacing unit for the market, DECOUPLED from the career's
     d.day (which only advances on sleep). Crypto ticks are driven by real
     elapsed time (see State.tickCrypto()) so the market keeps moving across
     a long uninterrupted play session without requiring the player to sleep.
     News resolution windows (2-4 "days") are expressed in this same unit. */
  Data.crypto = {
    ticksPerDay: 6,          // SPEC-V10 §2: "several times per in-game day (~6)"
    tickIntervalMs: 20000,   // real ms between ticks — see State.tickCrypto()
    feeRate: 0.005,          // SPEC-V10 §3: ~0.5% fee on both buys and sells
    reversionStrength: 0.03, // §2: mild pull back toward each coin's startPrice, prevents runaway drift
    floorFactor: 0.02,       // hard floor = startPrice * this (never zero)
    ceilingFactor: 50,       // hard ceiling = startPrice * this (never infinity)
    historyMaxLen: 120,      // capped price-history length kept per coin, for the UI sparkline

    /* ---- SPEC-V10 §4: news — the heart of it ---------------------------- */
    news: {
      reliability: 0.68,          // ~68% of headlines resolve in the telegraphed direction
      fakeoutRate: 0.15,          // ~15% of headlines dip/reverse the opposite way first
      magnitudeMin: 0.03,         // unknown magnitude: total net move over the resolution window, 3%..30%
      magnitudeMax: 0.30,
      fakeoutTickFraction: 0.3,   // fraction of an event's ticks spent moving the "wrong" way, if it's a fake-out
      resolveDaysMin: 2,          // §4.4: staggered resolution over 2-4 "crypto days"
      resolveDaysMax: 4,
      minGapTicks: 18,            // ~3 crypto days between headlines (a few per week, per §4)
      maxGapTicks: 40,            // ~6-7 crypto days
      maxActive: 4,               // at most this many news events live at once, across all coins
      // Direction is what the headline TELEGRAPHS, not what will actually
      // happen — see reliability above. {COIN} is replaced with the coin's
      // display name at spawn time.
      headlines: [
        { direction: 'up',   text: 'US crypto regulation expected to ease over the coming days' },
        { direction: 'up',   text: 'Institutional fund reveals large {COIN} position' },
        { direction: 'up',   text: '{COIN} network upgrade rumored to ship ahead of schedule' },
        { direction: 'up',   text: 'Major payment processor said to be adding {COIN} support' },
        { direction: 'up',   text: 'Whale wallet quietly accumulates {COIN}, on-chain trackers report' },
        { direction: 'up',   text: 'Analysts flag {COIN} as "oversold" after the recent dip' },
        { direction: 'up',   text: 'Rumor: a top-5 exchange is preparing a {COIN} listing push' },
        { direction: 'up',   text: '{COIN} developer activity hits a multi-month high' },
        { direction: 'up',   text: 'Pension fund manager says {COIN} allocation is "under review"' },
        { direction: 'up',   text: 'Retail search interest in {COIN} spikes overnight' },
        { direction: 'down', text: 'Major exchange announces surprise {COIN} delisting review' },
        { direction: 'down', text: 'Unconfirmed reports of a {COIN} wallet exploit circulate online' },
        { direction: 'down', text: 'Regulator opens inquiry into a {COIN}-linked exchange' },
        { direction: 'down', text: 'Large dormant {COIN} wallet moves funds onto an exchange' },
        { direction: 'down', text: '{COIN} network congestion sparks a wave of outage complaints' },
        { direction: 'down', text: 'Prominent fund manager calls {COIN} "badly overextended"' },
        { direction: 'down', text: 'Leaked memo suggests a major {COIN} partnership is falling through' },
        { direction: 'down', text: 'Validators reportedly throttling {COIN} activity amid a cost spike' },
        { direction: 'down', text: 'A competing token launch is said to be draining {COIN} liquidity' },
        { direction: 'down', text: 'Large {COIN} insider unlock looms, traders turn wary' }
      ]
    }
  };

  /* ---- SPEC-V13 §1A: scout intel lines for the offer/team card trajectory
     banner (REPLACES the bare icon, SPEC-V7 §8). Deterministic per
     (teamId, trajectory, seed) so the line does not re-roll on every
     render() — see Data.scoutLineFor() below. ------------------------------ */
  Data.trajectoryScoutLines = {
    rising: [
      'Analysts indicate the team has some untapped potential.',
      'Scouts say their young rifler is about to break out.',
      'They have quietly won three straight scrims against better sides.',
      'The roster finally clicked after their IGL swap.',
      'Insiders expect them to punch well above their seed this season.',
      'Their new coach has completely rebuilt the map pool.',
      'Bookmakers have started shortening their odds every week.',
      'Word is a Tier 1 org already tried to buy the roster out.',
      'They have been bootcamping non-stop and it is starting to show.',
      'Their last three demos have the whole scene talking.',
      'A rebuild nobody rated is starting to look very smart.',
      'The momentum is real — they are winning the close ones now.'
    ],
    stable: [
      'A steady side with no drama and no surprises.',
      'They win what they should and lose what they should.',
      'Analysts call them the most predictable team in the tier.',
      'The roster has been unchanged for months, for better or worse.',
      'Solid, professional, and going precisely nowhere.',
      'No red flags here, but no breakout signs either.',
      'A comfortable mid-table side, and they know it.',
      'Scouts describe them as a safe, unspectacular home.',
      'Their results chart is a flat line, month after month.',
      'A stable org that pays on time and asks few questions.'
    ],
    declining: [
      'According to insiders the team is facing problems with their coach.',
      'Two starters are reportedly already listed for transfer.',
      'Their last four series all ended in the group stage.',
      'Sources say salaries have been paid late twice this month.',
      'The roster has looked disinterested since the shuffle.',
      'Analysts think their star player is well past his peak.',
      'Their main sponsor pulled out and the org has gone quiet.',
      'Practice attendance has reportedly become a real problem.',
      'Rivals have solved their default and they have not adapted.',
      'The org is rumoured to be considering a full rebuild.',
      'Their IGL is reportedly close to stepping down.',
      'Bookmakers have drifted their odds every single week.'
    ]
  };

  // Data.scoutLineFor(teamId, trajectory, seed) -> string
  // Deterministic: same (teamId, trajectory, seed) always yields the same
  // line. `seed` is the trajectory period start day (teamPublic()'s
  // `trajectorySince`, SPEC-V13 §7) so the line changes exactly when the
  // team's heat changes, and never in between. Simple string hash — NEVER
  // Math.random() here, or the banner would flicker on every render().
  Data.scoutLineFor = function (teamId, trajectory, seed) {
    var pool = Data.trajectoryScoutLines[trajectory] || Data.trajectoryScoutLines.stable;
    var str = String(teamId) + '|' + String(trajectory) + '|' + String(seed);
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0; // int32-forced
    }
    var idx = Math.abs(hash) % pool.length;
    return pool[idx];
  };

  /* ---- SPEC-V13 §7A: mutable team trajectory cycling -----------------------
     Trajectory used to be static (baked once at boot — see
     trajectoryForRank() above). It's now mutable per save and re-rolls every
     7-14 days, independently per team. See js/state.js's
     tickTeamTrajectories() / ensureTeamTrajectories(). ---------------------- */
  Data.trajectoryCycleDays = { min: 7, max: 14 };
  Data.trajectoryRollWeights = { rising: 0.30, stable: 0.40, declining: 0.30 };
  // Chance the PLAYER's team flips to 'rising' after a good tournament run,
  // when it is currently 'stable' or 'declining' — see js/state.js's
  // finalizePlayerOutcome() (SPEC-V13 §7C).
  Data.trajectoryTournamentBoost = {
    CHAMPION: 0.65, 'RUNNER-UP': 0.45, SEMIFINALIST: 0.25
  };
  // Data.rollTrajectory(prevTraj) -> new trajectory string. Weighted pick
  // with a mild anti-repeat: if the weighted pick equals prevTraj, re-roll
  // once (and accept whatever the second roll gives) — otherwise a
  // 40%-weighted 'stable' team looks static to the player.
  Data.rollTrajectory = function (prevTraj) {
    function weightedPick() {
      var r = Math.random();
      var acc = 0;
      var keys = ['rising', 'stable', 'declining'];
      for (var i = 0; i < keys.length; i++) {
        acc += Data.trajectoryRollWeights[keys[i]];
        if (r < acc) return keys[i];
      }
      return keys[keys.length - 1];
    }
    var pick = weightedPick();
    if (pick === prevTraj) pick = weightedPick();
    return pick;
  };

  /* ---- SPEC-V13 §9A: top-bar cash ad ---------------------------------------
     Deliberately longer than the energy ad's 60s (state.js's
     AD_COOLDOWN_MS) — 5min real time is roughly 3.3 in-game days. A
     SEPARATE cooldown from the energy ad's so the two never compete; see
     js/state.js's watchAdCash()/cashAdCooldownRemaining()/cashAdReward(). -- */
  Data.cashAdCooldownMs = 300000;

  /* ---- SPEC-V15-BATCH-C §1: contextual tutorial copy -----------------------
     The single-card lesson content for js/state.js's State.tutorialPending()
     system (a SECOND, separate mechanism from the 8-step onboarding in
     js/tutorial.js). Package C2's card UI renders `title` + `lines` verbatim
     for whatever id State.tutorialPending() returns — it authors no copy of
     its own, it just reads this. Every id in SPEC-V15-BATCH-C.md §1's table
     has an entry here, INCLUDING `first_stream`, even though
     State.tutorialPending() itself never hands that one id back (Package C3
     owns that moment and renders it interactively — see js/state.js's
     NO_CARD_TUTORIAL_IDS comment). It's included here anyway so C3 can pull
     the exact wording SPEC-V15-BATCH-C.md §3.2 describes instead of
     authoring a second copy of it ("never mirror a rule/copy").
     Shape: { title: string, lines: [2-4 short strings] }. */
  Data.tutorials = {
    elo_climb: {
      title: 'RANKING UP',
      lines: [
        'You just ranked up to GOLD NOVA.',
        'No organisation will scout you before 2,100 ELO.',
        'Keep playing matches — ELO is the only way up.'
      ]
    },
    career_open: {
      title: 'CAREER TAB UNLOCKED',
      lines: [
        'You’ve hit 2,100 ELO — the CAREER tab is open.',
        'Browse offers, sign a contract, and build chemistry with your team.',
        'The coach sets a daily scrim quota — miss it and chemistry suffers.',
        'Reputation follows you everywhere teams look.'
      ]
    },
    first_stream: {
      title: 'YOUR FIRST STREAM',
      lines: [
        'Red messages are toxic — leaving them up hurts your growth.',
        'Tap a toxic message to ban it.',
        'Once you can afford a MODERATOR, this happens automatically.'
      ]
    },
    aim_stat: {
      title: 'GEAR AND YOUR AIM',
      lines: [
        'AIM gear does more than raise aim-trainer scores.',
        'It directly raises your win chance in real tournaments.',
        'Desk, chair, PC, and monitor tiers all stack together.'
      ]
    },
    // V22 (owner item 5): this used to read "YOUR PHONE IS UNLOCKED" and fire
    // at 300 followers. Both halves went stale at once — the phone is never
    // locked now, and 300 followers no longer unlocks anything at all. It is
    // re-pointed at the SOCIAL MEDIA app (500 followers), which IS a real
    // moment. The `phone_unlock` KEY is deliberately unchanged: it is written
    // into d.tutorialsSeen, so renaming it would re-show this card to every
    // player who has already dismissed it.
    phone_unlock: {
      title: 'SOCIAL MEDIA UNLOCKED',
      lines: [
        'The SOCIAL MEDIA app just installed on your phone.',
        'Posting costs energy now and pays followers over the next few days.',
        'Bigger socials mean better sponsor deals once you have a team.'
      ]
    },
    first_case: {
      title: 'ABOUT CASES',
      lines: [
        'Cases are built to be near break-even — about +4.4% EV.',
        'That makes them variance, not a reliable income source.',
        'Treat them as entertainment, not a strategy.'
      ]
    },
    first_rent: {
      title: 'RENT IS DUE WEEKLY',
      lines: [
        'Rent charges automatically every 7 days.',
        'Miss it twice in a row and your career ends — permanently.',
        'Keep cash on hand before rent day comes around.'
      ]
    },
    first_scrim: {
      title: 'SCRIMS AND CHEMISTRY',
      lines: [
        'Scrims build chemistry with your team.',
        'Your coach sets a daily quota — miss it and chemistry takes a hit.',
        '3 missed scrims total for the contract (not just in a row) gets you kicked.'
      ]
    },
    sponsor_conflict: {
      title: 'COACH VS. SPONSOR',
      lines: [
        'Your coach wants scrims. Your sponsor wants stream time.',
        'One day’s energy cannot cover both.',
        'Decide which one you serve each day — neither one waits.'
      ]
    }
  };

  window.Game = window.Game || {};
  window.Game.Data = Data;
})();
