/**
 * Config defaults (CLAUDE.md §15). The single source of truth: every tunable number is read from
 * here, never hardcoded. Grouped by the section that uses it.
 */
import type { InjuryStatus, Pos } from "./model";

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
    /**
     * Conflicting ESPN signals (CLAUDE.md §6 step 3; planner reply to Checkpoint 2, answer 6): a PROBABLE,
     * QUESTIONABLE or DOUBTFUL player whose ESPN return week is 2+ weeks away (returnConflictWeeks) follows the
     * one-week table (the date is stale) when Sleeper projects him this week at this share or more of his healthy
     * base rate; otherwise he follows the return week.
     */
    staleReturnShare: 0.5,
    /**
     * A PROBABLE, QUESTIONABLE or DOUBTFUL player's ESPN return week counts only when it is at least this many weeks
     * after the current week (§6 step 3: "Q/D/P use it only 2+ weeks out"; ESPN then expects a longer absence than the
     * tag says, the conflict above); a nearer date is ignored and the tag's one-week table applies. One rule for his
     * availability (availability.returnWeekDistribution), the conflict (returnDateConflict, the ESPN Import Report note)
     * and the trade card's injury tag (explain.injuryTags).
     */
    returnConflictWeeks: 2,
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
     * An IR player's expected return week (planner reply to Checkpoint 4, change 5; availability.expectedReturnWeek):
     * the first remaining week whose chance he's back (his return-week distribution, before future injury risk)
     * reaches this share. From it he takes an active roster spot (the lowest keep value bench player goes when the
     * roster is full).
     */
    returnWeekQuantile: 0.5,
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

  /**
   * §6 step 8, market-blended projections (planner reply to Checkpoint 4, change 1): the search ranks thousands of trades
   * by our own model's edge, so its top fills with the places our projections disagree most with the market (the
   * optimizer's curse). For players at `positions` with a real FantasyCalc value (redraft values in the league's format;
   * dynasty leagues too), per game played (review of track A): b′ = (1 − weight) × b + weight × R_pos(v), b his base
   * rate, R_pos an isotonic fit of b on value over the position's healthy valued players (each read off the fit without
   * him, except at the value range's ends; at least `minPlayers` of them, else no blend there); his weekly points and
   * ROS scale by b′ / b (blend.ts).
   */
  marketBlend: {
    weight: 0.5,
    positions: ["QB", "RB", "WR", "TE"] as readonly Pos[],
    minPlayers: 10,
    /**
     * Phase 4c (planner reply to Checkpoint 4b, change 4): f is clamped to this range after the blend. Extreme factors are
     * where data glitches (a fallback base rate, a role change the projections haven't caught) and market hype concentrate.
     */
    factorClamp: [0.75, 1.35] as const,
  },

  /** §7 Lineups, team strength and needs. */
  lineups: {
    /**
     * ω, the weight of a playoff week in every ROS(T) and lineup-point number (§7): until the planner's reply to Checkpoint 7a
     * (§6.1) the user's setting, default 1.25. Since then the League model sets ω itself (playoffWeightAuto, below; league.ts
     * step 5c), and this is the fallback when it can't be measured (no team picked, no odds, title odds unknown, no
     * regular-season or no playoff week left to count, or my odds don't move) and the weight the measurement's own baseline
     * reads (ω₀: the IR returners' roster spots, step 5c).
     */
    playoffWeight: 1.25,
    /**
     * The automatic playoff-week weight (planner reply to Checkpoint 7a, §6.1; league.ts step 5c, LeagueModel.playoffWeightAuto):
     * ω = (B per point in playoff weeks) ÷ (B per point in regular-season weeks), for my team under my goal ("What matters
     * most", TradeSettings.goal), from two extra season simulations on the headline's seasons (common random numbers): my
     * weekly score + `gain` points in the remaining regular-season weeks team numbers count only, then in the playoff weeks
     * only; B per point = B_win of that run (ΔPO and ΔCH under the goal) ÷ (gain × the weeks changed). Clamped to `clamp`
     * (one per-point B not above 0 while the other is: that end); ⚠️ rounded to `decimals` (ours: far below the
     * simulation's own noise). The pages print it with one decimal ("Playoff weeks count: 2.0×").
     */
    playoffWeightAuto: { gain: 3, clamp: [0.5, 4] as const, decimals: 2 },
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
    /**
     * Injury statuses an IR slot accepts when the platform doesn't report its own rule (planner reply to Checkpoint 4,
     * change 5: a received IR player goes into an open IR slot if he's eligible): a Sleeper league without reserve_allow_*
     * flags (6 of 250 crawled), or a platform that reports none. ESPN's adapter sets IR and OUT from ESPN's help center
     * (LeagueSettings.irEligible), so this default doesn't apply there.
     */
    irEligibleDefault: ["IR", "PUP"] as readonly InjuryStatus[],
    /**
     * Forced drops (§7: roster legality's rules 1 and 2, and the roster spot an IR player needs from his return,
     * returners.ts; final review of Phase 4c, finding R6, ⚠️ ours) where a keep value is the lineup cost alone (redraft
     * leagues, and dynasty or keeper ones without long-term values): among the candidates whose keep value is within this
     * many projected points a week of the lowest (× the weights of the weeks it counts: ROS lineup points), the one with the
     * lowest trade value floored at the waiver credit W goes (teamValue.lowestKeepValue; between players worth at most W,
     * whom every package counts at W, the lineup decides as before). On Parker's league (Oct 4 09:24Z) a 2-for-1 cut Kyle
     * Monangai (worth [value]) where Marvin Harrison Jr. ([value] ≤ W [value]) cost the lineup 0.02 points a week more: noise, while
     * the trade value lost was real. ⚠️ The free-agent optimizer's cuts follow the same rule (verification of that review,
     * finding VF-1; optimizer.ts's header, league.nearTieRos): a pickup whose best cut is worth more than W cuts a cheaper
     * player instead when that swap is within this of it (my moves after a trade are charged in my market term). 0.2
     * rather than the review's example of 0.5: at 0.5, without the floor, a returner's team kept a rookie worth 756 over a
     * D/ST worth 0.37 points a week of its lineup, which moved Parker's baseline playoff odds 1.2 points. At 0.2 with the
     * floor (verification finding VF-4), against 0 on the same data: the headline odds (every team after its pickups) are
     * the same for every team, and so is every team's roster after its pickups (Team 5 pairs its two pickups with its two
     * cuts the other way round); the odds as rosters stand move, by 0.26 points of playoff odds at most (Parker's 65.06% →
     * 65.04%), because Team 6's IR rookie Jordyn Tyson, worth more than W, keeps his spot from week 5 and Emanuel Wilson
     * goes, where exact ties released Tyson (Team 6: 1 ROS point, 104.9 → 104.8 points a week; 86.9% → 86.8% playoffs).
     */
    dropNearTieWeekly: 0.2,
  },

  /** §7 Needs, trade chips and best trade partners (League page). */
  needs: {
    /**
     * Trade chips (CLAUDE.md §7; planner reply to Checkpoint 2, answer 2): gap = the most he'd add to
     * another team's lineup − what his own team would lose (ROS lineup points, free-agent-adjusted
     * baselines); a chip when the gap is at least this. ROS lineup points at ω₀ (lineups.playoffWeight): under the automatic
     * playoff weight it is × Σω ÷ Σω₀ (league.ts step 5c, LeagueModel.lineupThresholds; review of the engine track, Phase 7b).
     */
    chipMinGap: 10,
    /** Chips shown per team on the League page (every chip joins the §12 give pool). */
    chipsShown: 3,
    /**
     * Performance knob for chip gains: when exact scenario lineups for every (player, other team) pair are
     * too slow, only this many other teams per player (the best by exact expected-value gain) get them.
     */
    chipScreenTeams: 3,
    /** Need chips shown per team. */
    needsShown: 3,
    /** Best trade partners shown for my team. */
    partnersShown: 3,
    /**
     * A partner card's lead line, "Best of their trade chips" ("Best target" until Phase 4b; planner addendum to Checkpoint
     * 3, §2; Phase 4 addendum lead decision N12): the
     * best of their trade chips without the "Harder to get" tag who adds at least this many projected points a week
     * to my lineup, as printed (one decimal). When none does, the single best one leads alone if he's tagged ("Best of
     * their trade chips, harder to get"), and weaker chips are listed after. ⚠️ Ours (a review found "+0.1/wk" leading next to
     * "+7.2/wk").
     */
    bestTargetMin: 1,
  },

  /**
   * §7 Streaming positions (planner reply to Checkpoint 3, model change 1, from Parker): a streamed slot is worth,
   * each week, max(the best rostered player, the streaming replacement), the streamRank-th best free agent at
   * that position that week by that week's projection. It applies to the user's team (TradeSettings.
   * streamPositions) and to any other team that made detectAdds or more adds at a streamable position this season.
   */
  streaming: {
    /** "Positions I stream weekly" by default. */
    defaultPositions: ["K", "DEF"] as readonly Pos[],
    /** Positions the setting offers, and the positions another team can be detected streaming. */
    streamable: ["K", "DEF", "QB", "TE"] as readonly Pos[],
    /** The replacement is this-th best free agent that week (3: other teams stream too). */
    streamRank: 3,
    /** Another team streams a position after this many adds there this season. */
    detectAdds: 2,
    /** "Streaming picks this week" (League page): free agents listed per position (K and DEF). */
    picksShown: 3,
    /** Never part of the free-agent optimizer's moves, for any team (K and DEF are streamed or kept). */
    optimizerExcluded: ["K", "DEF"] as readonly Pos[],
  },

  /**
   * §7 The free-agent optimizer V*(X) (planner reply to Checkpoint 3, model change 2): repeatedly apply the best
   * add/drop while it improves ROS by at least faMinGain, at most faMaxMoves moves; in dynasty and keeper leagues
   * never drop a player whose dynasty value exceeds the added player's by more than faDynGuard × the top dynasty
   * value (⚠️ the planner named the guard without a default; 5% of the top value is ours). faMinGain is ROS lineup points at
   * ω₀ (lineups.playoffWeight): under the automatic playoff weight it is × Σω ÷ Σω₀ (league.ts step 5c,
   * LeagueModel.lineupThresholds; review of the engine track, Phase 7b).
   */
  freeAgentOptimizer: {
    faMinGain: 3,
    faMaxMoves: 5,
    faDynGuard: 0.05,
  },

  /**
   * §7 One free agent, one team (planner reply to Checkpoint 4, change 3), and two rules from the planner's reply to
   * Checkpoint 4c (league.ts step 5): who takes part in the allocation (A4) and the waiver credit W it leaves (A3).
   */
  allocation: {
    /**
     * A4: a team with no transaction of any type in this many weeks (the activity feature's window: transactions whose week
     * is above the league week − this, so with fewer weeks played none this season) makes no free-agent pickups, in the
     * baseline or after a trade (acceptance.inactiveTeams). ⚠️ Never my team; and nobody in a league whose snapshot holds no
     * transaction at all, or may be missing some in this window (a week that didn't load, rows that couldn't be read, a trade
     * listed without one of its teams: acceptance.inactiveRuleBlock). 0 turns the rule off.
     */
    inactiveWeeks: 5,
    /**
     * A3: W is the value of the best free agent the allocation leaves unclaimed, and the allocation reads W (its near-tie
     * cuts floor values at W), so W is found by allocating again with the new W until it repeats: at most this many
     * allocations (league.ts waiverCreditFixedPoint; a performance limit: Parker's league, Oct 4 09:24Z, takes 2, 615 →
     * 491, and about 15 ms more per League model build). ⚠️ When it cycles or reaches this cap, the smaller W tried and its
     * allocation are taken.
     */
    waiverCreditPasses: 4,
  },

  /** §8 Season simulator. */
  simulation: {
    finalSims: 5000,
    screeningSims: 1000,
    /** Seed of the common-random-numbers score matrix (§8): the "before" and every "after" run share it. */
    seed: 20_260_930,
    /**
     * Exact title odds (sim.ts "Title odds"): a re-seeding bracket is computed exactly from the first round with at
     * most this many teams left (2, 4 or 8; others round down into that range), its earlier rounds drawn. A
     * performance limit, not a model number: the expectation is the same at any value, only the noise differs.
     */
    exactReseedTeams: 8,
  },

  /**
   * §8 and §14 "League": the League page's remaining schedule ("show each remaining week's risk", §8)
   * flags a week as risky, in words, when my chance to win its matchup is under riskyWinChance (as the
   * page prints it; head-to-head leagues only), or when riskyByes or more of my likely starters are on
   * bye that week (Parker's week 13 bye crunch, planner reply to Checkpoint 2). Display thresholds only:
   * no odds or projection depends on them.
   */
  leaguePage: {
    riskyWinChance: 0.4,
    riskyByes: 3,
    /**
     * Phase 4c (lead decision): the positions whose streamed slot covers a likely starter's bye in the risky-week count
     * (evaluate.ts riskyWeeksOf and leagueView.ts scheduleByeRule leave a starter there out when the team streams it): a
     * streaming kicker or D/ST is about as good as a rostered one. A streamed QB's or TE's replacement is much weaker (with TE
     * streamed on Parker's data, Brock Bowers' 11.8 a week would get a 6.1 one), so their byes still count.
     */
    streamCoversBye: ["K", "DEF"] as readonly Pos[],
  },

  /**
   * §14 "League": "Waiver upgrades" (planner reply to Checkpoint 7a, §6.2; src/engine/waivers.ts, league.ts step 10): every
   * free agent who projects for more points than one of my players at his position, with what picking him up adds to my
   * lineup. Display rules only: no odds, projection or trade number depends on them.
   */
  waivers: {
    /**
     * A pickup "starts" when he adds more than this many projected points to my expected-value lineups (no injuries
     * simulated) over the weeks a list counts, with the player he'd replace on the roster gone; otherwise whatever he adds
     * comes from covering injuries and byes, and the page tags him "depth only". A few hundredths of a point isn't a start.
     */
    startsMinPoints: 0.05,
    /**
     * At most perPositionCap rows per position at these positions (kickers and team defenses: only the best few matter),
     * at a position I stream in a one-week list (its slot is filled from the free agents every week), and at a position
     * where none of my players with projections scores in the list's weeks (nobody on my roster there, or all of them on
     * bye, out or with games already started: every free agent there is "better"): the best by the list's points.
     * "Streaming picks this week" lists as many (streaming.picksShown).
     */
    cappedPositions: ["K", "DEF"] as readonly Pos[],
    perPositionCap: 3,
    /**
     * The page shows each lineup gain to this many decimals ("+2.2 pts"), and rows are ordered by the gain as shown: two
     * gains that print the same are a tie, decided by points, and every gain that rounds to 0 or below ("No gain") is one.
     */
    gainDecimals: 1,
    /** Rows the League page shows before "Show all" (display only). */
    rowsShown: 10,
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
     * "te+" values, or "te++" from this premium up. ✅ Confirmed by FantasyCalc on 2026-10-05 (their reply, condition 5:
     * reports/fantasycalc-permission.md; planner reply to Checkpoint 7a, 5.4); before, the cut was our assumption, as
     * FantasyCalc doesn't define te+ / te++ in points (TE values move ×1.149 / ×1.29 in Phase 0).
     */
    tepPlusPlusAt: 0.75,
    /**
     * Phase 4c (planner reply to Checkpoint 4b, change 12): when FantasyCalc doesn't answer, the last saved list stands in
     * for up to this many days, with a "values from <date>" note.
     */
    fantasyCalcStaleDays: 7,
    /**
     * … after that, the model's own value curve values every player: an old list (at most this many days old) only
     * calibrates the curve of value on rest-of-season points, with a clear banner. Older or none: no values.
     */
    fantasyCalcCurveDays: 90,
  },

  /** §10 Benefit, Trade Score and Overall. */
  benefit: {
    /**
     * B_win's weights by the per-league setting "What does your league reward?" (TradeSettings.goal; Phase 4c, planner reply to
     * Checkpoint 4b, change 8; since Checkpoint 7c, planner reply to Checkpoint 7b, §6, league prizes): B_win = 100 ×
     * (playoffs × ΔPO + prizes × ΔE[S]), E[S] my expected share of the league's prizes (src/engine/reward.ts: "title" and
     * "playoffs" pay 1st place everything, so ΔE[S] is ΔCH there and their numbers didn't move; "prizes" reads the league's
     * split, TradeSettings.prizes). "Top finishers too" ("balanced": 0.35 / 0.65 on ΔPO and ΔCH) went then; a stored one reads
     * as "prizes" (settings.ts). Checkpoint 4c measured that a uniform +3 points a week moves ΔPO about twice as much as ΔCH in
     * Parker's league, so under a fixed B_ref "Win the title" read about a fifth lower than Balanced; since Phase 7a "Helps
     * you" is scaled by B₃ under the same goal and prizes (helpsGain below), so the same lineup gain reads the same under
     * every goal.
     */
    goals: {
      title: { playoffs: 0.15, prizes: 0.85 },
      prizes: { playoffs: 0.15, prizes: 0.85 },
      playoffs: { playoffs: 0.7, prizes: 0.3 },
    },
    goalDefault: "title" as "title" | "prizes" | "playoffs",
    /**
     * "Several prizes"' prefilled amounts (planner reply to Checkpoint 7b, §6: "Prefilled: 60 / 30 / 10, with the rest blank"):
     * 1st, 2nd and 3rd place, the weekly high score and the most points in the regular season (TradeSettings.prizes; null =
     * not paid). Also the split a stored "Top finishers too" becomes (settings.ts, the planner's "Migration").
     */
    prizesDefault: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null } as { readonly first: number | null; readonly second: number | null; readonly third: number | null; readonly weeklyHigh: number | null; readonly pointsLeader: number | null },
    /**
     * "Protect my trade value" (planner addendum to Checkpoint 3, §3; priced in lineup points since the planner's reply to
     * Checkpoint 7a, §2 question 5): κ_pts by the user's setting (TradeSettings.protectValue), in projected points a week per
     * 100% of trade value. Redraft B = B_win + (B₃ / helpsGain) × κ_pts × clamp(g_mkt(me), marketSanityClamp), B₃ the "Helps
     * you" scale of the same evaluation (benefit.ts helpsScale), so the term reads exactly κ_pts × clamp(g_mkt(me)) points a
     * week on that scale, in every league under every goal: at medium, giving 25% more value than you get (g_mkt(me) =
     * −0.20) costs 0.4 points a week. (From the addendum to Checkpoint 3 until Checkpoint 7a: κ 2 / 4 / 8 in B units, which
     * cost a different number of points a week in each league and under each goal: that example cost 0.48 points a week under
     * "Win the title" in Parker's league, B₃ 4.96, and 0.31 under "Make the playoffs", B₃ 7.63.)
     */
    protectValue: { low: 1, medium: 2, high: 4 },
    protectValueDefault: "medium" as "low" | "medium" | "high",
    marketSanityClamp: [-0.5, 0.5] as const,
    bFutureScale: 40,
    /** Default λ by my P(playoffs): ≥ 0.5 → contender, 0.2–0.5 → bubble, < 0.2 → rebuild; keeper leagues use keeper. */
    lambda: { contender: 0.35, bubble: 0.5, rebuild: 0.75, keeper: 0.2, contenderAt: 0.5, bubbleAt: 0.2 },
    /**
     * The "Helps you" scale calibrates itself per league and goal (planner reply to Checkpoint 4c, A2; benefit.ts helpsScale;
     * it replaces Checkpoint 3's fixed B_ref 6): Helps you = round(100 × (1 − e^(−B / B₃))) and Overall = round(100 × (1 −
     * e^(−B × P_complete / B₃))), B₃ = the B of a uniform +helpsGain projected points a week for my team in every week a
     * trade can change, on the same baseline, goal and seasons (league.ts helpsCalibrationOf). So +1, +3 and +6 points a week
     * read about 28, 63 and 86 in every league under every goal. B₃ is floored at helpsFloor: below it my odds barely move
     * with lineup changes, and the search and the Analyzer say so (benefit.helpsScaleNotes: HELPS_FLOOR_NOTE).
     */
    helpsGain: 3,
    helpsFloor: 0.5,
    /**
     * Dynasty and keeper leagues with long-term values (planner reply to Checkpoint 7a, §2 question 6: "the dynasty scale
     * follows the slider"): the scale is B_ref(λ) = (1 − λ) × B_win₃ + λ × F₁₀, F₁₀ = the B_future of gaining this share of
     * my roster's long-term value: bFutureScale × helpsFutureShare = 40 × 0.10 = 4 (benefit.ts helpsScale). So 63 reads as
     * good as +helpsGain points a week this season together with +10% long-term value, at the trade's λ. (It replaces review
     * SC-1's cap on λ in B₃, helpsLambdaMax 0.75, and its note.)
     */
    helpsFutureShare: 0.1,
    /**
     * "Helps both" (Checkpoint 7c; planner reply to Checkpoint 7b, §7, its `config.helpsThemMin`, kept here beside the scale
     * it reads): a trade helps both teams when its Helps you and its Helps them, each as printed, are at least this
     * (benefit.ts helpsBoth; Helps you since Checkpoint 7d, planner reply to Checkpoint 7c, answer 5: "the same bar as Helps
     * them"; above 0 before). 10 is about +0.3 projected points a week: 10 = 100 × (1 − e^(−x)) at x ≈ 0.105 of the B of
     * +3 points a week, the planner's "A score of 10 is about +0.3 points a week for them".
     */
    helpsThemMin: 10,
    marketCheckBelow: -0.15,
    marketHideBelow: -0.35,
    /** §10 guard: a trade that depends on a player I'd receive with one of these statuses is flagged ("currently OUT or on IR"; PUP is a reserve list like IR). */
    injuredStatuses: ["OUT", "IR", "PUP"] as readonly InjuryStatus[],
  },

  /** §11 Acceptance probability. */
  acceptance: {
    /**
     * β_need is `need` in redraft and keeper leagues and `needDynasty` in dynasty leagues (planner reply to Checkpoint 4,
     * change 2: in redraft a manager's own lineup weighs more).
     */
    beta: { b0: -0.6, gain: 6, loss: 9, need: 1.2, needDynasty: 0.6, hole: 0.4, complexity: 0.25, activity: 0.35, history: 3 },
    pAcceptClamp: [0.02, 0.85] as const,
    veto: { gBelow: -0.3, factor: 0.5 },
    gClamp: [-0.5, 0.5] as const,
    nScale: 5,
    nClamp: [-2, 2] as const,
    nBlendNextWeeks: 4,
    /** ΔLineup_P's weight on the next nBlendNextWeeks weeks; the rest of the season gets 1 − it (§11: 50/50). */
    nBlendWeight: 0.5,
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
    /**
     * The star premium (planner addendum to Checkpoint 3, §1): managers value their own best players a bit above market.
     * For each player j the partner gives, v′_j = max(v_j, W) × (1 + e_j) (the value floor of the planner's reply to
     * Checkpoint 4, change 4, then the premium), e_j = e_rank + e_elite, used in place of v for the partner's given
     * players in the partner's g (the waiver credit per open spot unchanged; my g_mkt and B use the floored values
     * without the premium).
     * - rank: e_rank for j's rank by market value on the partner's roster (ties: more ROS points): #1, #2; others 0.
     * - elite / eliteTop: e_elite when j is among the top eliteTop players by FantasyCalc value in the league's format.
     * - rebuild (dynasty only): for a partner whose P(playoffs) is below `below`, e × factor for `positions` aged `age`+.
     * - harderToGetMin: a player whose e for his owner is at least this is tagged "Harder to get" (a top-12 player who
     *   is also his team's #1 or #2), on the League page and on trade cards (§2).
     * Starting assumptions: Phase 6 fits a scale factor for e from Accepted/Rejected outcomes alongside the β refit.
     */
    starPremium: {
      rank: [0.1, 0.05] as readonly number[],
      elite: 0.1,
      eliteTop: 12,
      rebuild: { below: 0.25, age: 27, factor: 0.5, positions: ["RB", "WR"] as readonly Pos[] },
      harderToGetMin: 0.15,
    },
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
    /**
     * Trades that get the final simulation. 60 since Phase 4c (planner reply to Checkpoint 4b, change 1; 40 before): the
     * minimum chance and the diversity caps apply after it, so more trades that qualify remain for the list (the Finder
     * re-filters from them). ⚠️ No promise of a full list: on Parker's league the exact trades give only a few players of
     * mine, and the given-player cap binds first (the 2026-10-04 00:51Z dump: 9 of my players in the 200 exact trades, 17
     * of 25 cards at the default 10%; Checkpoint 4c).
     */
    finalists: 60,
    /**
     * Checkpoint 7c (planner reply to Checkpoint 7b, §7: "so this sort has enough candidates, add to the final simulation the
     * top 20 by Helps you among trades that help both on the screening run"): on top of the finalists, the first this many
     * exact trades by B on the screening block that help both teams (benefit.ts helpsBoth, on the printed scores) and aren't
     * hidden by default (B ≤ 0 or the market guard) get the final simulation too; the "Helps both" list checks each again on
     * its final numbers (search.ts finalistsOf), and ⚠️ only that list ranks them: the Overall list stays the finalists'. ⚠️
     * The plain top 20 (the lead's call): no diversity caps in the choice.
     */
    helpsBothFinalists: 20,
    resultsShown: 25,
    /**
     * An extension step (§12) adds one player to my side, one to theirs, or one to each (a 1-for-1 becomes a 2-for-1,
     * 1-for-2 or 2-for-2): every single addition is screened, and the one-on-each additions pair the
     * pairExtensionTop best single additions on each side (Phase 4 wave 2 decision M7; for speed).
     */
    pairExtensionTop: 5,
    /**
     * Phase 4c (planner reply to Checkpoint 4b, change 1): exhaustive candidates per partner on top of the beams, so a
     * two-player package is found even when neither half helps on its own: every 1-for-2 and 2-for-1 from the give and get
     * pools, and every 2-for-2 from the top twoForTwoTop of each pool (in pool order). maxPerSide still caps each side.
     */
    exhaustive: { twoForTwoTop: 6 },
    /** Get pool H (planner addendum to Checkpoint 3, §2): the top getPool untagged players by MV_add(me, j), plus the top this many "Harder to get" ones. */
    getPoolTagged: 3,
    /**
     * "Offer first / if they say no" (planner addendum to Checkpoint 3, §4). A throw-in is one of my players whose loss
     * costs me at most throwInMaxCost ROS lineup points against my free-agent-optimized roster, in scenario lineups (at ω₀ =
     * lineups.playoffWeight: × Σω ÷ Σω₀ under the automatic playoff weight, league.ts step 5c, LineupThresholds).
     * A step is shown only when it raises the chance they accept by at least minAcceptGain and the offer-first version
     * prints (acceptance.displayAcceptance, the nearest 5%) at least minOfferFirst, and in case 1 at least the user's minimum
     * chance too (Phase 4c, evaluate.offerFirstBar); a throw-in added "if they say no" must keep B at least minBShare of the
     * offer's.
     * preScreen is a performance knob, not a model number (lead decision N4, ⚠️ ours): when the throw-in is added "if they
     * say no", only the best this many candidates by the screening's quick estimate of the chance they accept get exact
     * evaluation (evaluate.ts tradeSteps; the Checkpoint 4 report measures how often that misses the exact choice).
     */
    throwInMaxCost: 5,
    steps: { minAcceptGain: 0.05, minOfferFirst: 0.1, minBShare: 0.8, preScreen: 2 },
    /**
     * Plan B, "If they say no, try:" (planner reply to Checkpoint 4, change 6), for a card without a qualifying throw-in
     * step: the best other evaluated trade with the same partner whose Helps you is at least minHelpsShare of the card's
     * (B > 0, not hidden by the market guard); at most `tries` candidates get the final simulation.
     */
    planB: { minHelpsShare: 0.5, tries: 3 },
    /** The Trade Analyzer lets the user build up to this many players a side (counteroffers included). */
    analyzerMaxPerSide: 4,
    /**
     * Responsiveness, not a model number (M8: at most ~50 ms of work between progress yields): the search yields after
     * this many screens (about 15 ms on Parker's 10-team league in Node) and after this many screening simulations
     * (each about 2–3 ms); exact evaluations and final simulations yield one by one.
     */
    yieldEveryScreens: 100,
    yieldEverySims: 5,
  },

  /** §13 Ranking and diversity. */
  ranking: {
    perPartnerInTop20: 3,
    /** The partner cap applies within the first this many trades kept (§13's "top 20"). */
    partnerCapTop: 20,
    /** At most this many trades in the top 20 give the same player of mine (planner reply to Checkpoint 4, answer 7). */
    perGivenPlayerInTop20: 3,
    perCore: 2,
    fillerCutoffFraction: 0.2,
    /**
     * Phase 4c (planner reply to Checkpoint 4b, change 10): the Trade Finder's "Chance they accept: at least …" filter
     * (TradeSettings.minChance, on P_complete as the card prints it), applied before the diversity caps; the options it
     * offers, its default, and below how many shown ideas the page suggests a lower setting (when one would show more:
     * TradeSearchResult.filter.few).
     */
    minChanceOptions: [0, 0.1, 0.2, 0.3, 0.4, 0.5] as readonly number[],
    minChanceDefault: 0.1,
    minChanceFew: 5,
  },

  /**
   * §13 Plain-English reasons and the pitch (src/engine/explain.ts): when a fact is worth a sentence. Display
   * thresholds only: no number behind B, P_accept or the ranking depends on them. Points are projected points per
   * week; shares are fractions (0.05 = 5%).
   */
  explain: {
    /** A slot instance's change (mine or the partner's, TradeDetail.mySlots / partnerSlots) worth a sentence ("Your RB2 spot goes from 9.1 to 14.3 …"). */
    slotChangeMin: 1,
    /** A whole starting lineup's change worth a sentence when no slot says it: my ΔPPW, or the partner's ΔLineup. */
    lineupChangeMin: 0.5,
    /** My playoff-week lineup change worth its own sentence: at least this, and at least this much more than the regular season's. */
    playoffGainMin: 1,
    /** A risky week of mine (TradeDetail.riskyWeeks) the trade covers, or weakens: my starting points that week move at least this much. */
    riskyWeekGain: 3,
    /**
     * Trade value within this share either way reads as even (g_mkt of the partner). With a star premium, their perceived
     * g against it picks the premium line's ending: under it "expect them to want a little extra", else "they'd still come out ahead".
     */
    valueEven: 0.05,
    /** A partner-side reason (activity, history, season context, a hot player, deadline urgency, the lineup) is said only when it moved the acceptance estimate at least this much (logit units, TradeDetail.terms); the value line and the star premium line are always candidates. */
    termMin: 0.1,
    /** Partner-side reasons kept, the ones that moved the estimate most first; the star premium line always has a place among them (lead decision N7). */
    partnerReasons: 3,
    /** Dynasty and keeper leagues: a change in my roster's long-term value worth a sentence (share of my roster's value). */
    longTermMin: 0.01,
    /** …said right after my lineup gain, before the odds, when the trade's λ (Win now 0 ↔ Future 1) is at least this. */
    futureFirstLambda: 0.5,
    /**
     * A hole the trade fills quotes the partner's rest-of-season rank there ("They're 9th of 10 at TE") only when it's
     * in the bottom part of the league: rank > teams × this (0.5: the bottom half). A better rank means a short-term
     * hole (holes are judged over the next config.acceptance.holeWeeks weeks: an injury or a bye), worded as one.
     */
    holeRankFromBottom: 0.5,
    /**
     * Phase 4c (planner reply to Checkpoint 4b, change 9): a card's "Win chance by week" line lists the weeks whose win
     * chance moves at least weeklyLineMin (3 points), at most weeklyLineMax of them (the weeks it drops first, then the
     * largest gains: final review of Phase 4c, finding R8; shown in week order).
     */
    weeklyLineMin: 0.03,
    weeklyLineMax: 4,
    /**
     * Phase 4c (change 6): the Trade Finder's pattern note shows when at least patternMinCount of the uncapped top
     * patternTop (the ranking without the given-player cap) give the same player of mine.
     */
    patternMinCount: 5,
    patternTop: 10,
    /**
     * The pattern note's drivers (src/engine/pattern.ts; the lead's Phase 4c design): one is named when it holds in at least
     * patternDriverShare of that player's trades in the list (half: the words, "usually" among them, assume at least
     * half), at most patternDriversMax of them.
     */
    patternDriverShare: 0.5,
    patternDriversMax: 3,
    /**
     * The pattern note's "injury cover" driver (src/engine/pattern.ts; ⚠️ ours, the lead's Phase 4c design): a trade's
     * TradeDetail.depthCover (my ΔPPW in scenario lineups minus in expected-value lineups) is at least this many points a
     * week. Display only.
     */
    patternDepthCoverMin: 0.5,
  },
} as const;

export type Config = typeof config;
export type ScoringConfig = Config["scoring"];
