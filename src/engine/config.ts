/**
 * Config defaults (CLAUDE.md §15). The single source of truth: every tunable number is read from
 * here, never hardcoded. Grouped by the section that uses it.
 */
import type { Pos } from "./model";

export const config = {
  /** §5 Scoring engine. */
  scoring: {
    /**
     * Distributions for expected-value rules on projections (threshold, range, stepped, bounded
     * per-unit; CLAUDE.md §5, planner reply to Checkpoint 1, answer 3; src/engine/scoring.ts):
     * - statSd keys are normal with a fixed SD;
     * - yardage stats (keys matching yardageKeyPattern) are normal with the yardageSd model, floored
     *   at yardageFloor;
     * - count stats (every other key: TDs, receptions, interceptions, sacks, FGs made, 2-point
     *   conversions, fumbles, …) are Poisson with mean = the projection, on the key's statGrid.
     * A floored normal (statFloor, yardageFloor) is placed so its mean still equals the projection.
     */
    /**
     * SD = bonusCv × mean for a continuous (statGrid 0) key without a fixed SD, which can't be a
     * count; yardageSd.default repeats it for yardage keys without a fit.
     */
    bonusCv: 0.5,
    /**
     * Fixed-SD normals. cmp_pct 10 (planner); pts_allow 9 (planner; `npm run measure:stat-sd`
     * measured 9.7 on 2026 weeks 1–3, n 96 team-games). yds_allow 77: the residual SD of actual
     * minus Sleeper's projection over team defenses, measured 2026-09-30 on 2026 weeks 1–3 (n 96;
     * weekly 91, 70, 70; mean residual −15). ⚠️ Past weeks' projections are re-stamped by Sleeper
     * after the games, so this may understate the forecast error (Phase 6 re-measures).
     */
    statSd: { cmp_pct: 10, pts_allow: 9, yds_allow: 77 } as Readonly<Record<string, number>>,
    /**
     * Yardage stats: normal with SD = max(yardageSdMin, a + b × projected mean). Measured 2026-09-30
     * by `npm run measure:stat-sd` on 2026 weeks 1–3: residuals of actual minus Sleeper's projection
     * for players with a real projection who played, pooled across positions, a line through the
     * residual SDs of equal-count bins of the projected mean (standardized residual RMS 0.98–1.07).
     * n: pass_yd 96 (starting QBs only, projected 205–250 yards, so the intercept can't be told
     * apart from the slope there and is pinned at 0), rush_yd 764, rec_yd 1047, kr_yd 307,
     * pr_yd 125. ⚠️ Sleeper re-stamps past weeks' projections after the games (04:00Z the Tuesday
     * after each week), so these may understate the forecast error; Phase 6 re-measures on
     * pre-kickoff snapshots. Keys without a fit use `default` (bonusCv × mean).
     */
    yardageSd: {
      default: { a: 0, b: 0.5 },
      pass_yd: { a: 0, b: 0.341 },
      rush_yd: { a: 3.9, b: 0.48 },
      rec_yd: { a: 8.8, b: 0.502 },
      kr_yd: { a: 20.2, b: 0.561 },
      pr_yd: { a: 3.7, b: 1.452 },
    } as Readonly<Record<string, { a: number; b: number }>>,
    yardageSdMin: 1,
    /** Which stat keys are yardage (normal); bonus_* indicator keys never are. */
    yardageKeyPattern: /(^|_)yds?(_|$)/,
    /**
     * Resolution of a stat for expected-value bounds: counts move in whole units (default 1), IDP
     * sacks in halves, and ratios such as completion percentage are continuous (0). A bound b on a
     * grid g reads "≥ b" as X ≥ ceil(b/g)·g − g/2 and "≤ b" as X ≤ floor(b/g)·g + g/2, so adjacent
     * buckets (14–17, 18–21) tile the line; a continuous stat gets no correction.
     */
    defaultStatGrid: 1,
    statGrid: { idp_sack: 0.5, cmp_pct: 0 } as Readonly<Record<string, number>>,
    /**
     * Stats that can't go below a floor. The normal's mass below it belongs to the lowest bucket, so
     * a closed "0 points allowed" bucket (ESPN, Fleaflicker) and an open bottom bracket (Sleeper,
     * MFL) give the same expected value.
     */
    statFloor: { pts_allow: 0, yds_allow: 0 } as Readonly<Record<string, number>>,
    /** Yardage stats are floored at 0 too (planner reply to Checkpoint 1, answer 3). */
    yardageFloor: 0,
    /** Oracle tolerance (§5): at least 99% of players within 0.05 points. */
    oracleTolerance: 0.05,
    oracleTarget: 0.99,
  },

  /** §4 Import: what every adapter keeps. */
  import: {
    /** LeagueSnapshot.freeAgents: the top N free agents per position by projection. */
    freeAgentsPerPosition: 50,
    /** Free agents are ranked by their mean projection over this many weeks from now, so a bye doesn't hide them. */
    freeAgentRankWeeks: 3,
  },

  /** §6 Projection model. */
  projections: {
    actualWeight: 0.25,
    actualFullGames: 6,
    weekShapeClamp: [0.8, 1.2] as const,
    /** Average ESPN with Sleeper × rules only if they agree within this on average (planner reply 14). */
    espnSleeperAgreement: 0.1,
    /** Log players whose two sources disagree by more than this. */
    sourceDisagreementLog: 0.4,
    /**
     * Past weeks of projections the server fetches, so a player injured now still has his most recent
     * healthy projection (§6 step 1); older injuries use his next projected week or the season line.
     */
    lookbackWeeks: 3,
    /** Games in the NFL regular season: a season projection is divided by this for a per-game rate (⚠️ its span is unverified). */
    seasonGames: 17,
    /** Availability multipliers by weeks from now (index 0 = this week), then 1. */
    injury: {
      OUT: [0, 0.5, 0.85],
      DOUBTFUL: [0.25],
      QUESTIONABLE: [0.85],
      /** ESPN PROBABLE (planner reply to Checkpoint 1, answer 5). */
      PROBABLE: [0.95],
      /** IR or PUP without a known return week: 0 for this many weeks, then `after`, then 1. */
      irUnknown: { outWeeks: 4, after: [0.8] },
      /** SUSPENDED without a known length: 0 for this many weeks. */
      suspendedUnknownWeeks: 2,
      /** NA: not an active NFL player (Sleeper's NA; retired or unsigned): this availability every week. */
      notActive: 0,
    },
    /**
     * A known return week (ESPN's expected return date) is uncertain by a week either way: the
     * player is back at R − 1, R or R + 1 with these probabilities (planner reply to Checkpoint 1,
     * addition C: "give or take a week"; the split is an assumption). Never earlier than his status
     * allows (OUT, IR, PUP and SUSPENDED miss this week).
     */
    returnWeekSpread: [0.25, 0.5, 0.25] as const,
    /**
     * Future injury risk (CLAUDE.md §6 step 3; planner reply to Checkpoint 1, addition B): a
     * two-state weekly model. r = 1 / meanInjuryWeeks; h = M × r / (1 − M); a player healthy now is
     * out k weeks ahead with probability M × (1 − (1 − h − r)^k). missShare = M, the long-run share
     * of games missed. P follows K and IDP (DL, LB, DB) share one number (assumptions). Phase 6
     * estimates both from nflverse weekly data.
     */
    injuryRisk: {
      meanInjuryWeeks: 2.5,
      missShare: { QB: 0.06, RB: 0.14, WR: 0.12, TE: 0.14, K: 0.02, P: 0.02, DEF: 0, DL: 0.1, LB: 0.1, DB: 0.1 } as Readonly<Record<Pos, number>>,
    },
    /** Weekly SD σ = c × p + d. P follows K (assumption: §6 lists no P entry). */
    sigma: {
      QB: { c: 0.3, d: 3 },
      RB: { c: 0.45, d: 2 },
      WR: { c: 0.5, d: 2 },
      TE: { c: 0.55, d: 1.5 },
      K: { c: 0.35, d: 2.5 },
      P: { c: 0.35, d: 2.5 },
      DEF: { c: 0.5, d: 3 },
      DL: { c: 0.5, d: 2 },
      LB: { c: 0.5, d: 2 },
      DB: { c: 0.5, d: 2 },
    } as Readonly<Record<Pos, { c: number; d: number }>>,
  },

  /** §7 Lineups, team strength and needs. */
  lineups: {
    playoffWeight: 1.25,
    needZThreshold: -0.5,
    strengthWeeks: 4,
    /**
     * Availability scenarios (CLAUDE.md §7; planner reply to Checkpoint 1, addition C): exact
     * evaluation averages LV over this many scenarios drawn from the §6 availability model, with
     * common random numbers from this seed (each player's draws depend only on the seed, his id and
     * the scenario index, so they stay the same when he changes teams).
     */
    scenarios: 32,
    scenarioSeed: 20_260_929,
  },

  /** §7 Needs, surplus and best trade partners (League page). */
  needs: {
    /** Surplus: surplus score z(value) − z(MV_lose) within the team's roster at least this (§12 uses the same score). */
    surplusMinScore: 1,
    /**
     * …and "low MV_lose" (§7): a lineup cost below his roster's average, i.e. z(MV_lose) within the
     * roster below this. Keeps stars out of the surplus chips: convex market values give them a high
     * surplus score too.
     */
    surplusMaxCostZ: 0,
    /** …and he would add at least this many points per week to another team's lineup over the next strengthWeeks. */
    surplusStartMinPpw: 1,
    /** Chips shown per team. */
    surplusShown: 3,
    needsShown: 3,
    /** Best trade partners shown for my team. */
    partnersShown: 3,
  },

  /** §8 Season simulator. */
  simulation: {
    finalSims: 5000,
    screeningSims: 1000,
  },

  /** §9 Market value layer. */
  market: {
    /** valueFloor = this fraction of the top value. */
    valueFloorFraction: 0.01,
    /** waiverCreditMin = this fraction of the top value. */
    waiverCreditMinFraction: 0.01,
    studExponent: 1.0,
    /** Unvalued-player estimate: fewer valued players than this at a position → min(valueFloor, lowest real value). */
    unvaluedCurveMinPlayers: 10,
    /** Excluded from trade search by default (IDP = DL, LB, DB); HC is unmapped. */
    tradeSearchExcluded: ["P", "K", "DEF", "DL", "LB", "DB"] as readonly Pos[],
    /**
     * FantasyCalc's TE premium (§2.9): a league whose TEs get more points per catch than WRs asks for
     * "te+" values, or "te++" from this premium up. FantasyCalc doesn't define te+ / te++ in points,
     * so the cut is our assumption (⚠️ unverified; TE values move ×1.149 / ×1.29 in Phase 0).
     */
    tepPlusPlusAt: 0.75,
  },

  /** §10 Benefit, Trade Score and Overall. */
  benefit: {
    weights: { playoffs: 0.35, title: 0.65 },
    marketSanityWeight: 1.0,
    marketSanityClamp: [-0.5, 0.5] as const,
    bFutureScale: 40,
    /** Default λ by my P(playoffs): ≥ 0.5 → contender, 0.2–0.5 → bubble, < 0.2 → rebuild; keeper leagues use keeper. */
    lambda: { contender: 0.35, bubble: 0.5, rebuild: 0.75, keeper: 0.2, contenderAt: 0.5, bubbleAt: 0.2 },
    /** Trade Score ("Helps you") and Overall: round(100 × (1 − e^(−x / bRef))). */
    bRef: 5,
    marketCheckBelow: -0.15,
    marketHideBelow: -0.35,
  },

  /** §11 Acceptance probability. */
  acceptance: {
    beta: { b0: -0.6, gain: 6, loss: 9, need: 0.6, hole: 0.4, complexity: 0.25, activity: 0.35, history: 3 },
    pAcceptClamp: [0.02, 0.95] as const,
    veto: { gBelow: -0.3, factor: 0.5 },
    gClamp: [-0.5, 0.5] as const,
    nScale: 5,
    nClamp: [-2, 2] as const,
    nBlendNextWeeks: 4,
    holeFractionOfMedian: 0.6,
    holeWeeks: 3,
    activity: { recentTradeWeeks: 4, inactiveWeeks: 5, quietWeeks: 3, tradesForActive: 2 },
    historyClamp: [-0.15, 0.15] as const,
    context: { checkedOutBelow: 0.05, checkedOut: -0.8, rebuildingBelow: 0.25, oldPlayerAge: 28, oldPlayerPenalty: -0.25, contenderAbove: 0.6, contenderNeedFactor: 1.3 },
    hot: { multiple: 1.5, weeks: 2, bonus: 0.15 },
    urgency: { days: 7, bonus: 0.2 },
    /** Displayed acceptance is rounded to the nearest 5%. */
    displayStep: 0.05,
    labels: [
      { below: 0.15, label: "Long shot" },
      { below: 0.35, label: "Possible" },
      { below: 0.55, label: "Decent" },
      { below: Number.POSITIVE_INFINITY, label: "Likely" },
    ] as const,
    refitMinOutcomes: 30,
  },

  /** §12 Trade search. */
  search: {
    maxPerSide: 2,
    maxPerSideAllowed: 3,
    givePool: 10,
    getPool: 10,
    beamSecond: 60,
    beamThird: 40,
    keptPerPartner: 30,
    exactEvaluationMax: 200,
    screeningGWindow: [-0.35, 0.6] as const,
    finalists: 40,
    resultsShown: 25,
  },

  /** §13 Ranking and diversity. */
  ranking: {
    perPartnerInTop20: 3,
    perCore: 2,
    fillerCutoffFraction: 0.2,
  },
} as const;

export type Config = typeof config;
export type ScoringConfig = Config["scoring"];
