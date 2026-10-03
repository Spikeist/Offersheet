/**
 * The League model (CLAUDE.md §6, §7, §9, §14 "League"): what src/engine/league.ts computes from a
 * LeagueSnapshot and its ModelInputs, and what the League page and the checkpoint report show.
 * Pure types only. Arrays marked "per week" are aligned with LeagueModel.weeks.
 */
import type { FantasyCalcFormat } from "./inputs";
import type { Pos } from "./model";

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
   * ω for playoff weeks in every ROS(T) and lineup-point number (§7): the user's setting (TradeSettings.
   * playoffWeight, default config.lineups.playoffWeight). Pages label lineup points with it.
   */
  playoffWeight: number;
  /** Streaming positions (§7; planner reply to Checkpoint 3, model change 1): who streams what, and this week's picks. */
  streaming: StreamingSummary;
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
  /** Milliseconds per stage, when the caller passed a clock. */
  timings: Record<string, number>;
  /** Plain-English notes about gaps (a source missing, a player without projections). */
  warnings: string[];
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
  /** Expected-value lineups (§7; the fast screening method). */
  ev: LineupValues;
  /** Availability-scenario lineups (§7 exact evaluation); sd = spread of LV across scenarios, per week. Null when skipped. */
  scen: (LineupValues & { sd: number[] }) | null;
  /** Slot instance key → average starter points over the next strengthWeeks and over the rest of the season, with z-scores across teams. */
  strength: Record<string, SlotStrength>;
  needs: Need[];
  /** Every trade chip of this team (§7), best gap first (ties: the smaller cost, then the smaller player id). The League page shows the first config.needs.chipsShown. */
  chips: TradeChip[];
  /** Rostered players' marginal values (active roster only; IR and taxi players are absent). */
  players: Record<string, TeamPlayerValue>;
  /**
   * The free-agent optimizer's moves for the team as it stands (§7 V*(T); src/engine/optimizer.ts), in order:
   * each adds the best free agent (dropping a player, or into an open roster spot) while it raises the team's
   * rest-of-season lineup points by at least config.freeAgentOptimizer.faMinGain, at most faMaxMoves of them;
   * never a kicker or a team defense (streamed or kept), nor a position the team streams. Empty when no move
   * qualifies. Lineup costs and trade chips are measured from the roster after these moves (V*), so a trade
   * never gets credit for a pickup the team could make anyway. The League page lists them as "Free-agent pickups
   * that would help".
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
   * scenarios run (at least faMinGain: the same lineups B is measured in, so no trade gets credit for a depth pickup
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
  /** z(v) − z(MV_lose) within T's roster: §12's surplus score, which ranks the give pool (Phase 4). */
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
 * A trade chip (§7; planner reply to Checkpoint 2, answer 2): a player worth at least config.needs.
 * chipMinGap more rest-of-season lineup points to another team than to his own. Every number is ROS
 * lineup points (playoff weeks × playoffWeight, a week in progress skipped), measured against
 * free-agent-adjusted baselines, in scenario lineups when scenarios ran, else expected-value lineups.
 */
export interface TradeChip {
  playerId: string;
  /** maxOther − cost (≥ chipMinGap). */
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
  /** W (§9): the best available free agent's value, at least waiverCreditMin. 0 without values. */
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
