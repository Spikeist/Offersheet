/**
 * Config defaults (CLAUDE.md §15). The single source of truth: every tunable number is read from
 * here, never hardcoded. Grouped by the section that uses it.
 */
import type { Pos } from "./model";

export const config = {
  /** §5 Scoring engine. */
  scoring: {
    /** SD = bonusCv × mean for stats without a statSd entry (expected-value rules on projections). */
    bonusCv: 0.5,
    /**
     * Per-stat SD for expected-value rules (threshold, range, stepped). pts_allow ≈ 9 is the
     * planner's number. yds_allow 70 (⚠️ one week) is the residual SD of actual minus Sleeper's
     * projection over 32 defenses in 2026 week 3 (npm run measure:stat-sd; bonusCv × mean would give
     * about 165). Phase 6 re-tunes both on pre-kickoff projections.
     */
    statSd: { pts_allow: 9, yds_allow: 70 } as Readonly<Record<string, number>>,
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
    /** Availability multipliers by weeks from now (index 0 = this week), then 1. */
    injury: {
      OUT: [0, 0.5, 0.85],
      DOUBTFUL: [0.25],
      QUESTIONABLE: [0.85],
      /** IR or PUP without a known return week: 0 for this many weeks, then `after`, then 1. */
      irUnknown: { outWeeks: 4, after: [0.8] },
      /** SUSPENDED without a known length: 0 for this many weeks. */
      suspendedUnknownWeeks: 2,
      /** NA: not an active NFL player (Sleeper's NA; retired or unsigned): this availability every week. */
      notActive: 0,
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
