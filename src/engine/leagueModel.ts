/**
 * The League model (CLAUDE.md §6, §7, §9, §14 "League"): what src/engine/league.ts computes from a
 * LeagueSnapshot and its ModelInputs, and what the League page and the checkpoint report show.
 * Pure types only. Arrays marked "per week" are aligned with LeagueModel.weeks.
 */
import type { FantasyCalcFormat } from "./inputs";
import type { Pos } from "./model";
import type { Goal } from "./settings";

export type BaseRateSource = "espn+sleeper" | "sleeper" | "espn" | "season" | "actual" | "none";
export type ValueSource = "fantasycalc" | "estimate" | "floor";

export interface LeagueModel {
  /** Remaining NFL weeks, currentWeek..lastWeek, in order. */
  weeks: number[];
  /** The remaining regular-season and playoff weeks (subsets of `weeks`). */
  regularWeeks: number[];
  playoffWeeks: number[];
  /** Availability scenarios per exact evaluation (§7), 0 when scenarios were skipped. */
  scenarios: number;
  /**
   * ω for playoff weeks in every ROS(T) and lineup-point number (§7): the free-agent optimizer, lineup costs, needs and
   * strength, trade chips, partner fit and the trade search's shortlists. Since the planner's reply to Checkpoint 7a (§6.1)
   * set automatically from my odds under my goal (playoffWeightAuto, league.ts step 5c), else config.lineups.playoffWeight
   * (1.25, the old default); before, the user's setting (TradeSettings.playoffWeight, which the engine no longer reads).
   * Pages label lineup points with it. Players' own ROS points (§6 step 7) are never weighted.
   */
  playoffWeight: number;
  /**
   * How playoffWeight was set (planner reply to Checkpoint 7a, §6.1; league.ts step 5c): measured ("auto") or the fallback,
   * with why, the goal and both runs' B per point (the Settings page and the reports read it). Absent in a model built
   * before Phase 7b.
   */
  playoffWeightAuto?: PlayoffWeightAuto;
  /**
   * The thresholds in ROS lineup points this model's team numbers were judged by (league.ts step 5c; LineupThresholds):
   * config's × Σω ÷ Σω₀, so under ω they mean what they did at ω₀. A page that quotes one (the trade chips' least gap) reads
   * it here. Absent in a model built before Phase 7b (config's then).
   */
  lineupThresholds?: LineupThresholds;
  /** Streaming positions (§7; planner reply to Checkpoint 3, model change 1): who streams what, and this week's picks. */
  streaming: StreamingSummary;
  /**
   * One free agent, one team (§7; planner reply to Checkpoint 4, change 3): the order teams got their free-agent pickups
   * in (snapshot team ids, first claim first) and what decided it: "faab" (remaining budget, highest first), "waiver"
   * (the platform's waiver order) or "gain" (each team's best available gain first: the league reports no order).
   * Absent in models built before Phase 4b.
   */
  faAllocation?: FaAllocation;
  /**
   * The current week when any of its games has already kicked off (null otherwise). Team-level numbers
   * (ROS(T), PPW, strength, needs, lineup costs, free-agent moves, trade chips, partner fit) then skip
   * it: lineups are locking and its points are being scored, so it no longer says how good a team is.
   * Its per-week LV is still reported (a partial week). Players' own ROS points count the games that
   * haven't started.
   */
  inProgressWeek: number | null;
  /** Every rostered player (IR and taxi included) and every snapshot free agent with inputs. */
  players: Record<string, PlayerModel>;
  /** Same order as snapshot.teams. */
  teams: TeamModel[];
  myTeamId: string | null;
  /** Heatmap columns: the league's starting slots, one per instance (QB1, RB1, RB2, …, FLEX1, K1). */
  slots: SlotInstance[];
  /** Best trade partners for my team (§7), best first; empty without a team. */
  partners: TradePartner[];
  market: MarketSummary;
  projection: ProjectionSummary;
  /**
   * The season simulation (§8): playoff, bye and title odds, expected records and each remaining week's
   * matchup odds. Null when it was skipped (sims 0) or no fantasy game is left to play (or, with a
   * warning, when the rest of the regular season has no schedule or the simulator refused the season's
   * setup).
   */
  odds: SeasonOdds | null;
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 9, "one baseline everywhere"): `odds` is the headline, every team
   * after its free-agent pickups (V*(T), one free agent per team), on the same seasons and scores as the trade search's
   * baseline, so the League page and every card's "before" agree; this is the second line, every team as it stands.
   * Null when `odds` is.
   */
  oddsAsRostersStand?: SeasonOdds | null;
  /**
   * Phase 7a (planner reply to Checkpoint 4c, A2: "Helps you" calibrates itself): my odds' changes from a uniform
   * +config.benefit.helpsGain (3) projected points a week in every week a trade can change, against `odds` on the same
   * seasons (league.ts step 8c, helpsCalibrationOf). benefit.helpsScale turns it into B₃ for a goal and λ, the scale of every
   * card's Helps you and Overall. Null when `odds` is or without my team; absent in a model built before Phase 7a.
   */
  helpsCalibration?: HelpsCalibration | null;
  /**
   * "Waiver upgrades" for my team (planner reply to Checkpoint 7a, §6.2; league.ts step 10, src/engine/waivers.ts): every free
   * agent who projects for more points than one of my players at his position, with what picking him up adds to my lineup
   * and whom it drops, for the rest of the season and for one week (two while a week is under way: its games still to play,
   * and the next week). Null without my team (or when the build skipped it: BuildLeagueModelOptions.waiverUpgrades false);
   * absent in a model built before Phase 7b.
   */
  waiverUpgrades?: WaiverUpgrades | null;
  /** Milliseconds per stage, when the caller passed a clock. */
  timings: Record<string, number>;
  /** Plain-English notes about gaps (a source missing, a player without projections). */
  warnings: string[];
}

/**
 * The "Helps you" calibration run (LeagueModel.helpsCalibration; league.ts helpsCalibrationOf): my weekly score mean + `gain`
 * in every model week from `from` on (σ unchanged; every other team as in the baseline), simulated on the baseline's own
 * seasons (common random numbers), against the baseline: every team after its free-agent pickups (LeagueModel.odds, the
 * trade search's baseline on its final block).
 */
export interface HelpsCalibration {
  /** Projected points a week added (config.benefit.helpsGain). */
  gain: number;
  /**
   * The first model week (index into LeagueModel.weeks) the gain is added from: 1 when the first week is under way (a trade
   * can't change it: evaluate.ts holds it at the score as rosters stand), else 0. Regular-season and playoff weeks alike.
   */
  from: number;
  /** My P(playoffs) change, a fraction (+0.06 = 6 percentage points). */
  dPO: number;
  /** My P(title) change; null when the league's title odds are unknown (B₃ then counts the playoff odds alone, as every trade's B). */
  dCH: number | null;
}

/**
 * "Waiver upgrades" (LeagueModel.waiverUpgrades; planner reply to Checkpoint 7a, §6.2; src/engine/waivers.ts has the rules):
 * my team's lists, "Rest of season" and one week ("This week"; while a week is under way, "This week" for its games still
 * to play and "Next week").
 */
export interface WaiverUpgrades {
  teamId: string;
  /** "Rest of season": every remaining week team numbers count (a week under way left out). Null when no week is left. */
  ros: WaiverList | null;
  /**
   * "This week" while the current week is under way (LeagueModel.inProgressWeek): its games still to play, the week
   * "Streaming picks this week" lists, my players whose games have started held where my lineup before its first kickoff
   * had them (waivers.ts). Null when no week is under way, none of its games is left, or no week after it is left.
   */
  underWay: WaiverList | null;
  /**
   * The first week team numbers count: the current week ("This week"), or while the current week is under way the next one
   * ("Next week"). Null when no week is left.
   */
  week: WaiverList | null;
}

/** One of the lists (WaiverUpgrades). */
export interface WaiverList {
  /** The NFL weeks the lineup gains count (one for a one-week list), ascending. */
  weeks: number[];
  /** The positions listed, in POSITIONS order: rest of season, every position the lineup starts that I don't stream; one week, all of them. */
  positions: Pos[];
  /**
   * Whether my streaming rows (StreamingSummary) were in the lineups the gains compare: yes for the rest of the season (a
   * pickup competes with the streamer the model assumes, wherever a flex takes his position too), no for one week (that
   * week's streaming pickup is the decision the list is for: compared with my roster as it stands, a kicker fills the slot
   * of one on bye instead of beating the streamer the model already counted).
   */
  streaming: boolean;
  /**
   * Most lineup gain first as the page shows it (config.waivers.gainDecimals: two gains that print the same tie, and every
   * gain that prints as no gain is one tie), a row whose move can't be made last; then more points, then the smaller id.
   */
  rows: WaiverRow[];
  /**
   * My active players with projections at the listed positions who score nothing in the list's terms, so no free agent is
   * listed as "better than" them (waivers.ts): on bye that week, out (injured, suspended, for the rest of the season), or,
   * in the week under way, with their games already started. Roster order.
   */
  idle: WaiverIdle[];
}

/** One of my players who scores nothing in a waiver list's terms (WaiverList.idle). */
export interface WaiverIdle {
  playerId: string;
  /** His primary position. */
  pos: Pos;
  /** On bye that week; his game in the week under way has started; or out (no points, whatever the reason). */
  why: "bye" | "started" | "out";
}

/** One free agent in a waiver list (waivers.ts). */
export interface WaiverRow {
  playerId: string;
  /** His points in the list's terms: rest-of-season points (PlayerModel.ros.total) or that week's projection (PlayerModel.weekly[w].p). */
  points: number;
  /**
   * My active players at his position (with projections) he out-projects in the same terms, most points first; never one
   * who scores nothing there (WaiverList.idle). Empty when none of mine there scores.
   */
  betterThan: string[];
  /**
   * What picking him up adds to my lineup over the list's weeks, unweighted (a playoff week counts once, as players' ROS
   * points do): ROS(R + him − drop) − ROS(R), my roster as it stands, in scenario lineups (expected-value lineups without
   * scenarios). Null when he can't join my roster (every player who could make room is needed).
   */
  gain: number | null;
  /**
   * The player he'd replace on my roster (the engine's best drop: waivers.ts), or null for an open roster spot (or when gain
   * is null). The same in every list, but in the week under way when that player's game has started (he's locked): there
   * the next one in the drop order.
   */
  drop: string | null;
  /**
   * He wouldn't start for me in any of the list's weeks in expected-value lineups (no injuries simulated; config.waivers.
   * startsMinPoints), even with the drop gone: his gain, if any, comes from covering injuries and byes. The page says "depth only".
   */
  depthOnly: boolean;
}

/**
 * Why the automatic playoff weight fell back to config.lineups.playoffWeight (PlayoffWeightAuto.reason; league.ts step 5c):
 * - "noTeam": no team picked (ω is measured from my team's odds);
 * - "noRegularWeeks": no regular-season week left that team numbers count (the planner: "If no regular-season weeks remain,
 *   ω doesn't matter");
 * - "noPlayoffWeeks": no playoff week left that they count (none listed, or the season's over);
 * - "noOdds": the season wasn't simulated (sims 0), or can't be (the rest of the schedule didn't load, nothing left to
 *   simulate, the simulator refused the setup);
 * - "titleUnknown": my title odds are unknown (a played playoff round without a result we can match, fewer listed playoff
 *   rounds than the bracket needs), so a playoff week's points can't be priced;
 * - "noEffect": neither run moves my odds under my goal (both per-point B's at or below 0: a team certainly out, say);
 * - "notFinite": a per-point B isn't a number.
 */
export type PlayoffWeightFallback = "noTeam" | "noRegularWeeks" | "noPlayoffWeeks" | "noOdds" | "titleUnknown" | "noEffect" | "notFinite";

/** One run of the automatic playoff weight (PlayoffWeightAuto.runs): my weekly score + gain in `weeks`, against the base run. */
export interface PlayoffWeightRun {
  /** The NFL weeks my score gained points in (the counted weeks of that kind: a week under way is left out). */
  weeks: number[];
  /** My P(playoffs) and P(title) changes, fractions; dCH null when title odds are unknown. */
  dPO: number;
  dCH: number | null;
}

/**
 * The automatic playoff-week weight (planner reply to Checkpoint 7a, §6.1; league.ts step 5c; LeagueModel.playoffWeightAuto).
 * ω = playoffPerPoint ÷ regularPerPoint, clamped to config.lineups.playoffWeightAuto.clamp and rounded to its decimals; the
 * fallback config.lineups.playoffWeight when it can't be measured (`reason`). Measured on my team as it stands, before any
 * free-agent pickup (the odds as rosters stand: the pickups themselves depend on ω), on the headline's seasons.
 */
export interface PlayoffWeightAuto {
  /** ω used (LeagueModel.playoffWeight). */
  omega: number;
  basis: "auto" | "fallback";
  /** Why the fallback; null when measured. */
  reason: PlayoffWeightFallback | null;
  /** The goal ("What matters most", TradeSettings.goal) both runs' B_win weigh my odds by. */
  goal: Goal;
  /** Points a week added in each run (config.lineups.playoffWeightAuto.gain). */
  gain: number;
  /** Seasons simulated (each run on the same ones: common random numbers); 0 when nothing was simulated. */
  sims: number;
  /**
   * B per projected point a week: B_win(ΔPO, ΔCH) under the goal ÷ (gain × the weeks changed), in the regular-season run and
   * in the playoff run; null when that run wasn't made or its ΔCH is unknown.
   */
  regularPerPoint: number | null;
  playoffPerPoint: number | null;
  /** playoffPerPoint ÷ regularPerPoint before the clamp and the rounding; null unless both are above 0. */
  ratio: number | null;
  /**
   * ω at an end of the clamp: the ratio fell outside it, or one per-point B wasn't above 0 while the other was ("low": only the
   * regular season moves my odds; "high": only the playoffs do). Null otherwise, and for the fallback.
   */
  clamped: "low" | "high" | null;
  /** The two runs' changes (null when they weren't made). */
  runs: { regular: PlayoffWeightRun; playoffs: PlayoffWeightRun } | null;
}

/**
 * The thresholds in ROS lineup points a League model judged team numbers by (LeagueModel.lineupThresholds; league.ts step 5c,
 * lineupThresholdScale; review of the engine track, Phase 7b): config.freeAgentOptimizer.faMinGain and config.needs.chipMinGap
 * × `scale` = Σω ÷ Σω₀ over the weeks team numbers count (ω this build's playoff weight, ω₀ config.lineups.playoffWeight),
 * so each keeps the meaning it was calibrated with at ω₀ whatever ω the goal gives (scale 1 at ω₀, or when no week counts).
 * The trade search's throw-ins scale config.search.throwInMaxCost by the same `scale` (evaluate.ts throwIns).
 */
export interface LineupThresholds {
  /** Σω ÷ Σω₀ over the weeks team numbers count. */
  scale: number;
  /** The least gain of a free-agent move (TeamModel.faMoves; optimizer.ts), ROS lineup points. */
  faMinGain: number;
  /** The least gap of a trade chip (TradeChip.gap), ROS lineup points. */
  chipMinGap: number;
}

export interface PlayerModel {
  id: string;
  base: {
    /** b_i: points per game played in this league's scoring (§6 step 1). */
    b: number;
    /** proj_now_i and the week it came from (null when no weekly projection exists). */
    projNow: number | null;
    projWeek: number | null;
    /** m_{i,now}: the week shape of projWeek (1 when unknown). */
    mNow: number;
    /** Season-to-date points per game played, and games played. */
    actualPpg: number | null;
    games: number;
    alpha: number;
    source: BaseRateSource;
  };
  /** Per week. */
  weekly: WeekProjection[];
  ros: RosSummary;
  /** Market value (§9); null when the player has no value and no estimate could be made. */
  value: { value: number; source: ValueSource } | null;
  /**
   * Conflicting ESPN signals (§6 step 3): set for every PROBABLE, QUESTIONABLE or DOUBTFUL player whose
   * ESPN return week is 2+ weeks away (his tag and the date disagree); absent for everyone else.
   */
  availabilityNote?: AvailabilityNote;
  /**
   * The market blend (§6 step 8; planner reply to Checkpoint 4, change 1), for players it moved: present only when his
   * weight is above 0 and his own projection isn't 0. The League page's player detail says in words which way it leans
   * (src/lib/leagueView.ts blendText; no number since Phase 7b: FantasyCalc's values are never displayed).
   */
  blend?: PlayerBlend;
}

/**
 * A blended player's rest-of-season points (§6 step 8), on the ros.total basis the tables show: `ours` before the blend,
 * `used` after it (= ros.total), and `market` such that used = (1 − weight) × ours + weight × market exactly: his ROS at
 * the market's points per game (ours × R_pos(v) ÷ b, R_pos the position's curve of healthy players' base rates on
 * market value; src/engine/blend.ts).
 */
export interface PlayerBlend {
  ours: number;
  market: number;
  used: number;
  weight: number;
  /**
   * Phase 4c (planner reply to Checkpoint 4b, change 4): the factor hit config.marketBlend.factorClamp, so `used` is ours ×
   * the clamp's bound rather than the blend (market stays the market's number). Absent when it didn't.
   */
  clamped?: "low" | "high";
}

/** LeagueModel.faAllocation (§7 one free agent, one team). */
export interface FaAllocation {
  basis: "faab" | "waiver" | "gain";
  /** Team ids, first claim first. */
  order: string[];
}

/**
 * Which ESPN signal a conflicted player's availability follows (§6 step 3; planner reply to Checkpoint
 * 2, answer 6). "sleeper": Sleeper still projects him this week at config.projections.staleReturnShare
 * or more of his healthy base rate, so the return date is stale: the one-week table for his tag applies
 * this week, then he's healthy (future injury risk as usual). "returnDate": he follows the date (give or
 * take a week), because Sleeper doesn't project him this week or projects him below that share, or
 * because Sleeper's projections for this week didn't load (sleeperUnavailable: no tiebreaker).
 */
export interface AvailabilityNote {
  status: "PROBABLE" | "QUESTIONABLE" | "DOUBTFUL";
  /** ESPN's expected return week (after the NFL's last week = out for the season). */
  returnWeek: number;
  used: "sleeper" | "returnDate";
  /**
   * Sleeper's projection this week, league points; null when it doesn't project him (a stub or 0) or,
   * with sleeperUnavailable, when its projections for this week didn't load.
   */
  sleeperNow: number | null;
  /**
   * True when Sleeper's projections for this week didn't load at all (an outage: no player in the model
   * inputs has this week), so the tiebreaker is missing, not negative, and he follows the return date.
   * Absent when they loaded: sleeperNow null then means Sleeper doesn't project him.
   */
  sleeperUnavailable?: boolean;
  /**
   * His healthy base rate: step 1's base rate as if neither source had projected him this week (the latest
   * healthy week before it, else his nearest later one, else the season line; projections.ts
   * priorHealthyBaseRate); null when there is none.
   */
  healthyRate: number | null;
}

export interface WeekProjection {
  /** p_{i,w} = b × m × a (§6 step 4). */
  p: number;
  /** a_{i,w}: expected availability, including byes and future injury risk. */
  a: number;
  /** m_{i,w}: week shape. */
  m: number;
  bye: boolean;
  /** σ_{i,w} = c_pos × p + d_pos (§6 step 5). */
  sd: number;
}

export interface RosSummary {
  /** Σ p over the remaining weeks, and split into regular-season and playoff weeks (§6 step 7). */
  total: number;
  regular: number;
  playoffs: number;
  /** Remaining weeks his NFL team plays (a game already kicked off this week doesn't count). */
  gamesLeft: number;
  gamesLeftRegular: number;
  gamesLeftPlayoffs: number;
  /** "bye done" / "bye wk 9" (§6 step 7); unknown when the NFL schedule has no bye for his team. */
  bye: { status: "done" | "upcoming" | "unknown"; week?: number };
}

export interface LineupValues {
  /** LV(T, w) per week. */
  lv: number[];
  /** ROS(T) = Σ ω_w LV(T, w), ω = playoffWeight in playoff weeks (§7). */
  ros: number;
  /** Average LV over the remaining regular-season weeks (0 when none remain). */
  ppw: number;
}

export interface TeamModel {
  id: string;
  /**
   * Expected-value lineups (§7; the fast screening method) of the team as it stands: its active roster, streaming rows and
   * IR returners, with the roster spot a returner needs from his return week (league.ts step 5b; so do scen, strength,
   * needs and score).
   */
  ev: LineupValues;
  /** Availability-scenario lineups (§7 exact evaluation); sd = spread of LV across scenarios, per week. Null when skipped. */
  scen: (LineupValues & { sd: number[] }) | null;
  /** Slot instance key → average starter points over the next strengthWeeks and over the rest of the season, with z-scores across teams. */
  strength: Record<string, SlotStrength>;
  needs: Need[];
  /** Every trade chip of this team (§7), best gap first (ties: the smaller cost, then the smaller player id). The League page shows the first config.needs.chipsShown. */
  chips: TradeChip[];
  /**
   * Rostered players' marginal values: the active roster's players with a model and, since Phase 4b, the IR returners (IR
   * players with a model expected back within the remaining weeks: league.ts step 5b), whose lineup cost is what losing
   * him costs V*(T)'s lineups with nobody refilling his spot (his IR slot opens, no active spot does; autoAdd null). Other
   * IR players and taxi players are absent.
   */
  players: Record<string, TeamPlayerValue>;
  /**
   * The free-agent optimizer's moves for the team as it stands (§7 V*(T); src/engine/optimizer.ts), in order:
   * each adds the best free agent left to it in the allocation order (one free agent, one team: no team earlier in
   * LeagueModel.faAllocation's order claimed him; planner reply to Checkpoint 4, change 3), dropping a player or into an
   * open roster spot, while it raises the team's rest-of-season lineup points by at least
   * LeagueModel.lineupThresholds.faMinGain (config.freeAgentOptimizer.faMinGain × Σω ÷ Σω₀; ⚠️ a pickup that drops a less
   * valuable player in a near-tie can raise them up to config.lineups.dropNearTieWeekly a week less: optimizer.ts's header),
   * at most faMaxMoves of them; never a kicker or a team defense (streamed or kept), nor a position the team streams. Empty when no move qualifies. No free agent shows in two teams' moves
   * (except under league.ts faAllocation "independent", Checkpoint 4's rule for reports). Lineup costs and trade chips
   * are measured from the roster after these moves (V*), so a trade never gets credit for a pickup the team could make
   * anyway. The League page lists them as "Free-agent pickups that would help".
   */
  faMoves: FaMove[];
  /**
   * The star premium of every player the team rosters (active, IR and taxi), as his owner sees him (planner addendum to
   * Checkpoint 3, §1–§2): e = e_rank + e_elite, and the "Harder to get" tag (e ≥ config.acceptance.starPremium.
   * harderToGetMin). Absent in a model built before the addendum.
   */
  premiums?: Record<string, PlayerPremium>;
  /**
   * The weekly score distribution the season simulator draws from (§8), per week of LeagueModel.weeks:
   * mean = LV (the scenario mean when scenarios ran, else the EV lineup), sd = sqrt(the within-lineup
   * variance Σ σ² of that week's starters + the spread of LV across the availability scenarios²). For a
   * week in progress (LeagueModel.inProgressWeek) both hold the whole week as if none of its games had
   * started: live scores aren't read, so the simulator plays that week from projections. ⚠️ Today's
   * rosters and injury tags, not the ones at kickoff (league.ts preKickoffTable).
   */
  score: { mean: number[]; sd: number[] };
  /**
   * Phase 4c ("one baseline everywhere"): the same distribution for the team after its free-agent pickups, V*(T) (one free
   * agent per team, IR returners and the drop at return), as the trade search's baseline prices it; LeagueModel.odds
   * simulates these. The week in progress keeps `score`'s week (⚠️ the model plays a week under way with today's rosters).
   */
  scoreWithPickups?: { mean: number[]; sd: number[] };
  /**
   * The roster spots IR returners take back from their return weeks (§7 IR players; league.ts step 5b,
   * returners.finalLineups): who is released, from which week, and for which returner, on the team as it stands (the lineups
   * behind ev, scen, strength, needs and score) and after its free-agent pickups (displacedWithPickups: V*(T)'s, behind
   * scoreWithPickups and the trade search's baseline). Empty when nobody is. A released player plays nothing for the team
   * from that week on, which the League page's likely starters mirror (leagueView.likelyStarters; review of the engine
   * track, Phase 7b: without it the page and the cards could name different likely starters). Absent in a model built
   * before Phase 7b.
   */
  displaced?: TeamDisplacement[];
  displacedWithPickups?: TeamDisplacement[];
}

/** One roster spot an IR returner takes back (TeamModel.displaced; returners.Displacement with an NFL week). */
export interface TeamDisplacement {
  /** The player released: an active player, an earlier returner, or the returner himself (released at his return). */
  id: string;
  /** The NFL week (one of LeagueModel.weeks) he is off the roster from. */
  week: number;
  /** The returner who takes the spot. */
  returner: string;
}

/** A rostered player's star premium for his owner (TeamModel.premiums). */
export interface PlayerPremium {
  /** e = e_rank + e_elite (dynasty: halved for an older RB or WR on a rebuilding team). */
  e: number;
  /** His rank by market value on his team's roster (1 = most valuable; ties: more ROS points, then the smaller id). */
  rank: number;
  /** Among the top config.acceptance.starPremium.eliteTop players by FantasyCalc value in the league's format. */
  elite: boolean;
  harderToGet: boolean;
}

/** One free-agent move of a team (TeamModel.faMoves). */
export interface FaMove {
  add: string;
  /** null = an open active-roster spot, nobody dropped. */
  drop: string | null;
  /**
   * ROS lineup points the move gains (the roster after it minus the roster before it), with expected-value
   * lineups and with scenario lineups (null without scenarios). The optimizer chooses by the scenario gain when
   * scenarios run (at least faMinGain, ⚠️ but for a near-tie's cheaper drop: optimizer.ts's header; the same lineups B is measured in, so no trade gets credit for a depth pickup
   * the team could make anyway; Phase 4 review), else by the EV gain. So with scenarios gainEv can be below
   * faMinGain, even below 0, for a pickup that adds depth.
   */
  gainEv: number;
  gainScen: number | null;
}

export interface SlotStrength {
  next: number;
  ros: number;
  zNext: number;
  zRos: number;
}

export interface TeamPlayerValue {
  /**
   * MV_lose(T, i) under expected-value lineups and under scenario lineups (ROS lineup points, §7): ROS(V*(T)) −
   * ROS(V*(T − i)), the team after its free-agent moves (TeamModel.faMoves) against the same team without him after
   * it re-optimizes: the optimizer's re-run from V*(T)'s roster, held to faMaxMoves pickups as a run from scratch
   * (league.ts step 5; optimizer.reoptimize). Floored at 0; 0 when V*(T) drops him anyway.
   */
  mvLoseEv: number;
  mvLoseScen: number | null;
  /** The first free agent the team would add after losing him (the re-run's first move), or null. */
  autoAdd: string | null;
  /** z(v) − z(MV_lose) within T's roster (its active players with a model and its IR returners): §12's surplus score, which ranks the give pool (Phase 4). */
  surplusScore: number;
}

export interface SlotInstance {
  /** Stable key, e.g. "RB2". */
  key: string;
  /** Short label for the heatmap, e.g. "RB2" or "D/ST". */
  label: string;
  /** The lineup slot it belongs to (SlotDef.slot) and its rank within that slot (1 = best starter). */
  slot: string;
  rank: number;
}

export interface Need {
  slot: string;
  z: number;
  /** "ros": weak for the rest of the season; "next": weak only over the next strengthWeeks (injuries, byes). */
  window: "ros" | "next";
}

/**
 * A trade chip (§7; planner reply to Checkpoint 2, answer 2): a player worth at least LeagueModel.lineupThresholds.
 * chipMinGap (config.needs.chipMinGap × Σω ÷ Σω₀) more rest-of-season lineup points to another team than to his own.
 * Every number is ROS lineup points (playoff weeks × playoffWeight, a week in progress skipped), measured against
 * free-agent-adjusted baselines, in scenario lineups when scenarios ran, else expected-value lineups.
 */
export interface TradeChip {
  playerId: string;
  /** maxOther − cost (≥ LeagueModel.lineupThresholds.chipMinGap). */
  gap: number;
  /** MV_lose(his team, i): what his team loses without him, after its free-agent moves (TeamPlayerValue). */
  cost: number;
  /**
   * The most he'd add to another team: the largest MV_add(T′, i) = ROS(V*(T′ + i − drop)) − ROS(V*(T′)) over the
   * other teams T′ (floored at 0), where V*(T′) is T′ after its free-agent moves, drop, when its active roster is
   * full, is the V*(T′) player whose loss costs its lineup least (nobody refilling his spot: the newcomer takes it;
   * at i's position when a position limit binds), and V*(T′ + i − drop) is the optimizer's re-run from V*(T′) + i −
   * drop, held to faMaxMoves pickups as a run from scratch (league.ts step 6).
   */
  maxOther: number;
  /** The team where he'd add maxOther (ties: the smaller team id). */
  bestTeamId: string;
  /**
   * cost ÷ Σ ω over the weeks team numbers count: what his team loses per week, in lineup points (playoff
   * weeks weighted like cost). 0 when no week counts. The League page shows it ("costs you 6.1 pts/wk").
   */
  costPerWeek: number;
  /**
   * He starts for his own team: he's in the expected-value lineup of V*(T), his team after its free-agent moves (the
   * roster his cost is measured from; streaming rows included), in at least half of the weeks team numbers count in
   * which he plays (p > 0). Never when those moves drop him. The page tags him "starter".
   */
  starter: boolean;
}

/**
 * Streaming positions (§7; lead decision L1): many managers stream K and D/ST, starting whichever free agent
 * is projected highest each week. A streamed slot is worth, each week, max(the best rostered player, the
 * streaming replacement), the config.streaming.streamRank-th best free agent at that position that week. Where
 * a flex takes the position too (a streamed TE or QB), the replacement is one more player that week and can
 * start there as well (league.ts, step 5a).
 */
export interface StreamingSummary {
  /**
   * Every team: the positions it streams (only positions its lineup starts, in POSITIONS order) and why. My
   * team (LeagueModel.myTeamId) follows my setting ("Positions I stream weekly"); every other team streams a
   * streamable position once it made config.streaming.detectAdds or more adds there this season ("detected").
   */
  byTeam: Record<string, StreamingTeam>;
  /** The streaming replacement per week (aligned with LeagueModel.weeks), for every position some team streams. */
  replacement: Partial<Record<Pos, number[]>>;
  /**
   * "Streaming picks this week": the best config.streaming.picksShown free agents at K and at DEF (when the
   * lineup starts them) by this week's expected points, best first (ties: the smaller id); a free agent who
   * can't play this week (bye, a game already started) isn't one. Empty once no week is left.
   */
  picks: StreamingPick[];
}

export interface StreamingTeam {
  positions: Pos[];
  source: "setting" | "detected";
  /** Adds at each streamable position this season (the detection's evidence; a position without adds is absent). */
  adds: Partial<Record<Pos, number>>;
}

export interface StreamingPick {
  playerId: string;
  pos: "K" | "DEF";
  /** p this week (§6 step 4: expected points, availability included). */
  projection: number;
  /** This week's NFL opponent (inputs.nfl.opponents), or null when unknown. */
  opponent: { team: string; home: boolean } | null;
}

export interface TradePartner {
  teamId: string;
  /**
   * true: their trade chips fit my needs and mine fit theirs (§7). false: they have chips who would start
   * for me, but I have none they need, so a trade would likely cost me a starter. One-sided fits are
   * listed after every mutual one.
   */
  mutual: boolean;
  /**
   * Mutual: sqrt(what their chips add to my lineup × what my chips add to theirs); one-sided: what theirs
   * add to mine. Points per week against each receiving team after its free-agent moves (V*), each side's
   * JOINT gain (its players added at once, so two players competing for one slot count once) over the
   * chips that stay chips together: at most config.search.maxPerSide a side, each still a chip once the
   * ones before him have left his team (league.ts step 7). The lists below show every chip with its own gain.
   */
  score: number;
  /** Their trade chips that would help me, and mine that would help them (points per week each adds to the other lineup). */
  theyCanGive: { playerId: string; ppw: number }[];
  youCanGive: { playerId: string; ppw: number }[];
}

export interface MarketSummary {
  format: FantasyCalcFormat | null;
  /** W (§9): the value of the best free agent the baseline allocation leaves unclaimed (league.ts step 4; planner reply to Checkpoint 4c, A3), at least waiverCreditMin. 0 without values. */
  waiverCredit: number;
  topValue: number;
  /** Players by value source. */
  counts: Record<ValueSource | "none", number>;
}

export interface ProjectionSummary {
  /** ESPN leagues: whether ESPN's and Sleeper's projections were averaged (§6: only when they agree within 10% on average). */
  espnAveraged: boolean;
  /** The agreement measure over rostered players, when both sources exist. */
  agreement: { meanRelDiff: number; players: number; week: number } | null;
  /** Players whose two sources disagree by more than config.projections.sourceDisagreementLog (§6: "log"). */
  disagreements: { playerId: string; espn: number; sleeper: number; week: number }[];
  /** Players by base-rate source. */
  sources: Record<BaseRateSource, number>;
}

/**
 * Season simulation results (§8). Probabilities are fractions in [0, 1]; null means unknown (never NaN,
 * which wouldn't survive the worker boundary as a number the page can print).
 */
export interface SeasonOdds {
  /** Simulated seasons and the common-random-numbers seed (config.simulation). */
  sims: number;
  seed: number;
  playoffTeams: number;
  /** Top seeds that skip the first playoff round. */
  byes: number;
  /** The standings tiebreaker after win percentage, and whether it was assumed (the platform doesn't report it). */
  tiebreaker: { rule: "pointsFor" | "headToHead" | "divisionRecord"; assumed: boolean };
  /** Re-seeding after each round (true) or a fixed bracket, and whether it was assumed. */
  reseed: { value: boolean; assumed: boolean };
  /**
   * False when a playoff round already played has no result, or when the league's own playoff schedule
   * pairs teams differently from the bracket built from the final standings: title and bye odds are then
   * unknown (null).
   */
  playoffsKnown: boolean;
  /** Same order as LeagueModel.teams. */
  teams: TeamOdds[];
  /** Each remaining regular-season week with games to simulate, ascending. */
  weekly: WeekOdds[];
  /** Plain-English notes for the page: seasons simulated, the seeding rule, the bracket, a week in progress, … */
  notes: string[];
}

export interface TeamOdds {
  teamId: string;
  /** Today's standings position by the league's own rules (records, then its tiebreakers; 1 = first). */
  rank: number;
  pPlayoffs: number;
  /** Null when the league has no byes or the playoffs are unknown. */
  pBye: number | null;
  /** Null when the playoffs are unknown, or when the league lists fewer playoff rounds than its bracket needs. */
  pTitle: number | null;
  /** Expected final regular-season record: the current record plus the simulated games (median games included). */
  expWins: number;
  expLosses: number;
  expTies: number;
  /** P(final seed = k + 1), k = 0 … teams − 1 (the whole final standings order, not only playoff seeds). */
  seedDist: number[];
  /**
   * Certainly out of the title race: it has lost a playoff game, or it can't make the playoffs. Before the
   * regular season ends, only when the records alone rule it out: at least as many teams as there are
   * playoff spots finish with a better win percentage even if it wins every result still to come and they
   * lose theirs (with a division rival among them in leagues with divisions); points-only leagues wait for
   * the end of the regular season. Never set from simulation counts alone (a 0% in 5,000 seasons isn't
   * proof), nor from tiebreakers we reconstruct (head-to-head, division record, an assumed rule): a team
   * tied at the playoff cut on what the platform reports isn't certainly out (season.ts).
   */
  eliminated: boolean;
}

export interface WeekOdds {
  week: number;
  /** One entry per team with a game that week (a multi-week game appears in its first simulated week). */
  games: { teamId: string; opponentId: string | null; pWin: number | null; pMedianWin: number | null }[];
}
