/**
 * The League model (CLAUDE.md §6, §7, §8, §9 and §14 "League"; planner reply to Checkpoint 1, additions
 * A–C; planner reply to Checkpoint 2, answers 1, 2 and 6): buildLeagueModel turns a LeagueSnapshot and its
 * ModelInputs into the LeagueModel (src/engine/leagueModel.ts) that the League page's Web Worker and the
 * checkpoint report show. Pure and deterministic: no I/O; the moment the model is for (`now`), the scenario
 * and simulation seeds and an optional clock (stage timings only) are passed in, and every tunable number
 * comes from config.
 *
 * 1. Weeks: the remaining NFL weeks currentWeek..lastWeek, lastWeek = the last playoff week (the last
 *    regular-season week without playoffs), and which of them are regular-season and playoff weeks. A
 *    season with no weeks left gives a valid model with empty weeks. Relevant players: everyone on a
 *    roster (IR and taxi included) and every snapshot free agent, when the snapshot knows him and the
 *    inputs have him; the others are left out and counted in a warning.
 * 2. ESPN leagues: ESPN's league-scored projections are averaged with Sleeper's only when the two agree
 *    within espnSleeperAgreement at currentWeek over the rostered players (§6 step 1).
 * 3. Per player: availability (§6 step 3; his currentWeek game "started" once its kickoff in
 *    inputs.nfl.kickoffs is at or before `now`, so it is no longer a game left; a known return week after
 *    inputs.nfl.lastWeek, the NFL's last week, means "not back this season"), the projection (§6 steps 1,
 *    2, 4, 5, 7) and, for active-roster players and free agents, S availability scenarios drawn with
 *    common random numbers (addition C: a player's draws depend only on the seed, his id and the
 *    scenario, never on his team). Conflicting ESPN signals (§6 step 3; availability.returnDateConflict):
 *    a PROBABLE, QUESTIONABLE or DOUBTFUL player whose return week is 2+ weeks away gets Sleeper as the
 *    tiebreaker (projections.staleReturnCheck). A stale date is dropped (the tag's one-week table, then
 *    healthy) for his expected availability and his scenarios alike, and PlayerModel.availabilityNote says
 *    which signal he follows. When Sleeper's projections for this week didn't load at all
 *    (sleeperWeekLoaded), there is no tiebreaker: he follows the date, and the note says the projections
 *    were missing (sleeperUnavailable), not that Sleeper doesn't project him. Every PROBABLE, QUESTIONABLE
 *    or DOUBTFUL player gets the Q/D/P base rate (projections.gameTimeBaseRate; planner reply to Checkpoint 3,
 *    answer 5): this week's injury-cut projections count neither in b nor in the week shape (this week's shape
 *    is 1), and proj_now is his nearest later healthy week, which carries his current role (review of track A1).
 * 4. Market values (§9, perception term) with the ROS totals feeding the estimate curve, and the waiver
 *    credit W (the best free agent's value, estimates included, at least waiverCreditMin).
 * 5. Per team (teamValue.ts): EV and scenario lineups of the team as it stands, ROS (playoff weeks × the user's
 *    playoff weight: opts.settings, TradeSettings.playoffWeight; LeagueModel.playoffWeight), PPW, slot strength
 *    and TeamModel.score, the weekly score the simulator draws (§8; teamValue.ts): with scenarios the scenario
 *    mean LV and sqrt(within-lineup variance + LV spread²), the law of total variance; without them the EV
 *    lineup's LV and sqrt(Σ σ²) of its starters. Then the free-agent-optimized baseline (§7; planner reply to
 *    Checkpoint 3, model change 2; lead decisions L2 and L3): V*(T), the free-agent optimizer's roster
 *    (optimizer.ts: from T, the best add/drop or open-spot add while it gains at least faMinGain ROS points, at most
 *    faMaxMoves moves; never K or DEF or a position the team streams; never a player the starting lineup needs; the
 *    dynasty guard in dynasty and keeper leagues whose dynasty values loaded, with §9's future-term values). Its moves
 *    are judged in scenario lineups when scenarios run (review of track E, item 1: the lineups B and the lineup costs
 *    are measured in, so a depth pickup worth little in EV lineups is made, and a trade never gets credit for it), else
 *    in EV lineups. Its moves are TeamModel.faMoves, each with its EV gain and its scenario gain (the
 *    roster after the move minus the roster before it, in scenario lineups). Lineup costs:
 *    MV_lose(T, i) = ROS(V*(T)) − ROS(V*(T − i)), in EV and in scenario lineups (the same rosters priced in each
 *    mode), floored at 0, and 0 when V*(T) dropped him. V*(T − i) is the optimizer re-run from V*(T)'s roster
 *    without him (L3's shortcut; optimizer.reoptimize with one extra move). Like a run from scratch, the re-run
 *    holds at most faMaxMoves pickups ⚠️ and judges its moves in EV lineups (optimizer.reoptimize, for speed: the lineup
 *    costs, MV_add's re-runs and chips staying chips re-run it hundreds of times a build; V*(T) itself, the trade
 *    baseline and the League page's pickups, is scenario-judged): at a team that used every move, replacing him is an exchange, made only when
 *    giving back the pickup that then costs least (and bringing back the player its move dropped) still beats not
 *    replacing him; and when no free-agent move fills the spot he leaves, a player V*(T)'s moves dropped comes back
 *    into it (a run from scratch would have used that spot instead of dropping him). The roster it ends with is
 *    priced like any other, in each mode (optimizer.ts header, with the greedy-path difference that remains). Review of track A2: the first version let this re-run make one move
 *    past the cap for free (and MV_add none), which put lineup costs at capped teams up to 29 points below a run
 *    from scratch, about their smallest pickup (11 of 91 chips in Parker's league on the offline report's inputs,
 *    Bo Nix among them, would not have been chips at the from-scratch cost). A cost below 0 is the threshold at
 *    work (losing him opens a spot for a pickup worth less than faMinGain over him, which V*(T) didn't make), so
 *    it's floored. TeamPlayerValue.autoAdd is the re-run's first add. The optimizer is memoized by roster within
 *    the build (chips and partners re-run it too). With faMaxMoves 0 nothing is picked up anywhere: MV_lose is
 *    ROS(T) − ROS(T − i).
 *    ⚠️ Each team is optimized on its own, so two teams can both "claim" the same free agent (CLAUDE.md §7).
 * 5a. Streaming positions (§7; planner reply to Checkpoint 3, model change 1; lead decision L1): my team
 *    streams the positions of my setting (opts.settings.streamPositions, default K and DEF); every other team
 *    streams a config.streaming.streamable position (K, DEF, QB, TE) where it made detectAdds (2) or more adds
 *    this season (streamingAdds: "add" and "waiver" moves to the team, at the move's position, else the
 *    player's; unknown positions don't count). Only positions the lineup starts. A streamed position's
 *    replacement in week w is the streamRank-th (3rd) best free agent with a model at that primary position by
 *    p_w (fewer → the last one, none → 0; teamValue.streamingReplacement), and one virtual row per position
 *    carries it (teamValue.streamRow: id `stream:<POS>`, cond = ev = the replacement, flags all 1, σ from §6
 *    step 5). The row joins the team's lineup evaluation, after its players, wherever its lineup is valued:
 *    LV, ROS, PPW, strength and needs, the free-agent optimizer and lineup costs, trade chips (the drop that makes
 *    room never picks it), partner fit and TeamModel.score. So a streamed slot is worth max(the best rostered
 *    player, the replacement) every week, in every scenario (the exact lineup solver), and exactly that where no
 *    flex takes the position (K, D/ST). Where a flex takes it too (TE and FLEX, QB and SUPER_FLEX or OP), the
 *    streamer is one more player that week and
 *    starts wherever he helps most: in the flex when he beats its starter, or in the position's slot with the
 *    team's own player moving to the flex (teamValue's header: holding him to the position's slot changes no
 *    total; review of track A1). It takes no roster spot, isn't a player (TeamModel.players, chips and the
 *    free-agent candidates never see it), and a league that starts two at a position still gets one streamer.
 *    On a game day the current week's replacement uses that week's p (a free agent whose game started scores
 *    0), and TeamModel.score's pre-kickoff week rebuilds the free agents at streamed positions before kickoff
 *    too. LeagueModel.streaming has who streams what (with the adds behind it), each streamed position's
 *    replacement per week, and "Streaming picks this week" (streamingPicks: the top picksShown free agents at K
 *    and DEF this week, with their opponents). The free-agent optimizer (step 5) never adds or drops a K or DEF,
 *    nor a position the team streams: those slots are valued by streaming (or kept as rostered).
 * 6. Trade chips (§7; answer 2): gap_i = maxOther_i − cost_i ≥ chipMinGap, all in ROS lineup points in the
 *    lineup costs' mode (scenario lineups when scenarios ran, else EV). cost_i = MV_lose(own team, i) (step 5).
 *    maxOther_i = the largest MV_add(T′, i) over the other teams (ties: the smaller team id), floored at 0:
 *    MV_add(T′, i) = ROS(V*(V*(T′) + i − drop)) − ROS(V*(T′)) (L3's shortcut: from V*(T′)'s roster), where drop
 *    is the player V*(T′) drops to make room when its active roster is full (every id on team.roster takes a
 *    spot, and every free agent V*(T′) added): the one whose loss costs V*(T′)'s lineup least, in the same lineup
 *    mode, with nobody refilling his spot (§7's keep value, marginal ROS contribution: teamValue.evRemovalCosts /
 *    scenarioRemovalCosts), among its players with a model (a free agent it added included), never the newcomer
 *    (ties: the lower market value, then the smaller id; teamValue.lowestKeepValue). Not his lineup cost: that
 *    refills his spot with free agents, so a starter with a free agent almost as good would cost ~0 there, be
 *    the one dropped, and take all his points with him. Position limits (L7, roster legality): when that leaves
 *    i's position at its limit, the drop is instead V*(T′)'s lowest keep value player AT i's position (the same
 *    keep value and ties, never the newcomer; often one of V*(T′)'s own pickups), which makes room on the roster
 *    and at the position at once, and T′ is skipped for i only when nobody there can go (only players with a
 *    model are dropped) or the roster is full with nobody to drop. (Review of track A2: the first version skipped
 *    T′ whenever V*(T′) minus the general drop was at the limit, so a team whose own pickups had filled its QB
 *    spots could take no QB at all: Bo Nix → Team 1 on the offline report's inputs, 18 such pairs in that league,
 *    every one legal on the team's own roster.) Then the optimizer re-runs from V*(T′) + i − drop
 *    (optimizer.reoptimize with one extra move, step 5's rule): it may hold at most faMaxMoves pickups, so a team
 *    that used every move makes one more pickup only as an exchange (giving back the pickup that then costs least,
 *    when that pays), while a swap of a pickup the newcomer made redundant needs none. So a newcomer who makes one
 *    of T′'s players redundant frees that spot for a pickup (Bo Nix to Team 1: a QB it has, or one it picked up,
 *    can go for a free agent), which Phase 3's pinned one-move baseline couldn't credit; and a pickup T′ could have
 *    made anyway, past its cap, counts only by what it beats T′'s cheapest pickup by. The drop doesn't depend on i
 *    (only on his position when a limit binds), so each team gets one base B′ = V*(T′) − drop (and one per limited
 *    position, built when first needed), and MV_add(T′, i) = gain(B′, i) − (ROS(V*(T′)) − ROS(B′)) + what the
 *    re-run adds. The re-run is run only for a newcomer who starts for B′ in some week team numbers count (rerunCounts:
 *    ⚠️ for speed, an approximation it measures). Candidates: active-roster players with a model
 *    whose position isn't in config.market.tradeSearchExcluded (P, K, DEF, IDP: excluded from trade search by
 *    default, §9); IR and taxi players aren't candidates yet. Chips need no market values. The search is exact
 *    and all pairs count, but only pairs whose bound could reach the best value found, or make a chip at all, are
 *    solved: the bound is teamValue's bound on adding i to B′ plus a bound on what the re-run can add. That is 0
 *    when no free agent's add bound on B′ reaches faMinGain (the re-run's first move gains at most what adding
 *    its free agent to B′ + i gains, which is at most what adding him to B′ gains: more players never lower a
 *    lineup, and a player added to a bigger roster gains no more), else the sum of the largest (the re-run's
 *    moves: optimizer.rerunMoves) add bounds on B′ (all it adds is at most what adding its free agents to B′
 *    would add), plus the largest add bound of a player V*(T′) dropped (an exchange can bring one back). That
 *    leaves a few teams per chip candidate (the bounds are tight without starter limits). Under starter limits nothing is bounded and the re-run is skipped (⚠️ for speed: every move there
 *    is solved, so MV_add is the pinned formula), and with scenarios the other teams are screened by their exact
 *    EV value and the best chipScreenTeams of them get scenario lineups. Chips are listed best gap first; equal
 *    gaps list the cheaper one to lose first (lead decision D3: EV lineups give a starter and the backup who
 *    covers him the same gap). For the page (lead decision L5; planner reply to Checkpoint 3, answer 3) each chip
 *    also carries cost ÷ Σ ω over the weeks team numbers count (costPerWeek) and whether he starts for his team
 *    (starter: in the EV lineup of V*(T), the roster his cost is measured from, streaming rows included, in at
 *    least half of the counted weeks in which he plays; teamValue.evStarter; never when V*(T) dropped him, so a
 *    "starter" tag never sits next to the 0 cost of a player the team's pickups replace: review of track A2).
 *    leagueMarginals gives any team's V*, MV_lose and MV_add by these same rules (scripts, the trade search).
 * 7. needs.ts: strength z-scores across teams, needs, §12's surplus scores (kept for Phase 4's give pool),
 *    and my team's best trade partners from the chips: their chips that would start for me and mine that
 *    would start for them, over every week team numbers count, against the receiving team's V* (EV lineups,
 *    no drop). The cards list every such chip with its own gain; each side's score counts only chips that
 *    stay chips together (lead decision D2; needs.chipsTogether), at most config.search.maxPerSide of them
 *    (a partner trade has at most that many players a side): the side's chips by their own gain (ties: the
 *    larger gap, then the smaller id); the first counts; each next one counts only while he is still a chip
 *    once the chips already counted have left his team: maxOther − cost(T − counted) ≥ chipMinGap, his
 *    lineup cost on that roster by step 5's rules (chipsStayChips). Chips come in groups (a starter and his
 *    backup each qualify because the other covers him), so a deep team's whole group no longer inflates its
 *    fit. The side's score is the joint gain of the chips counted (one lineup solve per week, so chips
 *    competing for one slot count once). Partners don't need trade values either.
 * 8. The season simulation (§8; season.ts, sim.ts): LeagueModel.odds from every team's weekly score,
 *    opts.sims seasons (default config.simulation.finalSims; 0 = none, odds null) on the common-random-
 *    numbers matrix of opts.simSeed (default config.simulation.seed). Null when nothing is left to simulate,
 *    and null with a warning when the rest of the regular season has no schedule (season.ts
 *    oddsSkippedWarning) or the simulator refuses the setup. Timings only when opts.clock is given.
 * 9. The star premium (planner addendum to Checkpoint 3, §1–§2; lead decisions N1 and N2; premium.ts): every rostered
 *    player's (active, IR and taxi) for his own team, TeamModel.premiums: his rank by perception value on the roster
 *    (ties: more ROS points, then the smaller id), whether he is a top-12 FantasyCalc player, e and the "Harder to get"
 *    tag, from step 4's values and step 8's odds (dynasty leagues: a rebuilding team's older RBs and WRs count half;
 *    without odds, P(playoffs) is unknown and nothing is halved). Last, and read by nothing above it: no other number
 *    of the model depends on it.
 *
 * Game days (Phase 2 review decisions; LeagueModel.inProgressWeek): once any game of the current week has
 * kicked off (inputs.nfl.kickoffs[currentWeek] at or before `now`), every team-level number skips that
 * week (teamWeeks): ROS(T) and the free-agent moves, lineup costs and trade chips built on it (ω = 0), PPW, both
 * strength windows (they start the week after), needs and partner fit. Its lineups are locking and its
 * points are being scored, so a week whose early games are over would say more about kickoff times than
 * about teams (a team whose starters played Thursday would look weak all weekend). Its per-week LV is still
 * computed and reported, a partial week (the players whose games haven't started), so every per-week
 * array stays aligned with LeagueModel.weeks; players' own weekly points and ROS points still count their
 * games that haven't started. The simulator plays that week's games from projections (lead decision D6:
 * live scores aren't read), so TeamModel.score's first week is the whole week as if none of its games had
 * started (preKickoffTable: the players rebuilt for 1 ms before its earliest kickoff, each team's first
 * week solved alone; scenario lineups when scenarios ran, else EV). Nothing else about the week changes,
 * and the scenario draws are the same ones (they depend on the seed, the player and the scenario only).
 * ⚠️ Only the clock is turned back: the rosters and injury tags are today's, since nothing records them as
 * they were at kickoff. A player tagged out after the game he already played counts as missing it, and a
 * player moved since kickoff counts for his new team (the odds' note says so: season.ts weekUnderWayNote).
 *
 * Choices the spec leaves open (Checkpoints 2 and 3 list them): TeamModel.chips holds every chip, and the
 * page shows the first chipsShown; TeamModel.players covers the active-roster players with a model;
 * Need.slot is a slot instance key (LeagueModel.slots). Only players with a model are drop candidates, for
 * the free-agent optimizer and for making room: one without projections isn't known to be worthless, so he is
 * never the one dropped (he still takes a roster spot). The keep value that picks the drop is his marginal ROS
 * contribution alone (step 6); §7's dynasty keep value (plus normalized market value) is Phase 4's
 * roster-legality work (a trade's forced moves).
 */
import { config } from "./config";
import { expectedAvailability, returnDateConflict, scenarioAvailability, type AvailabilityConfig, type AvailabilityContext, type AvailabilityPlayer } from "./availability";
import { futureValuesLoaded } from "./benefit";
import type { ModelInputs, NflScheduleInputs, PlayerInputs } from "./inputs";
import type {
  AvailabilityNote,
  BaseRateSource,
  FaMove,
  LeagueModel,
  LineupValues,
  MarketSummary,
  PlayerModel,
  ProjectionSummary,
  SeasonOdds,
  SlotInstance,
  StreamingPick,
  StreamingTeam,
  TeamModel,
  TeamPlayerValue,
  TradeChip,
} from "./leagueModel";
import { prepareLeagueSlots, type PreparedSlots } from "./lineup";
import { marketSummary, marketValues, valuesForTerm, waiverCredit, type MarketConfig } from "./market";
import { POSITIONS, type LeagueSettings, type LeagueSnapshot, type PlayerInfo, type Pos, type Team } from "./model";
import {
  chipsTogether,
  findNeeds,
  instanceIndex,
  rankPartners,
  slotInstances,
  strengthTable,
  surplusScores,
  tradeChips,
  windowAverage,
  type ChipCandidate,
  type InstanceIndex,
  type PartnerCandidate,
  type PartnerPlayer,
} from "./needs";
import { applyStep, createOptimizer, rosterKey, type DynastyGuard, type OptimizedRoster, type RosterOptimizer, type StreamSpec } from "./optimizer";
import { leaguePremiums, type StarPremiumConfig } from "./premium";
import { baseRateSourceCounts, espnSleeperAgreement, projectPlayer, staleReturnCheck, weeklySd, type BaseRateContext, type ProjectionConfig, type SourceAgreement } from "./projections";
import { oddsSkippedWarning, seasonOdds, type SeasonConfig } from "./season";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import {
  addGainExact,
  addRowsGain,
  addUpperBound,
  evInstancePoints,
  evRemovalCosts,
  evScore,
  evStarter,
  isStreamId,
  lowestKeepValue,
  positionAllows,
  ppw,
  rosValue,
  scenarioAddGain,
  scenarioAddUpperBound,
  scenarioRemovalCosts,
  scenarioScore,
  scenarioValues,
  slotMask,
  solveEvWeeks,
  streamRow,
  streamRowId,
  streamingReplacement,
  teamEval,
  weekWeights,
  windowWeights,
  type ProjectionTable,
  type ScenarioCells,
  type ScenarioValues,
  type SolvedWeeks,
  type TableRow,
  type TeamEval,
  type WeeklyScore,
} from "./teamValue";

/** Gains closer than this are zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The config keys the League model reads, widened from config's `as const` literals so tests and calibration can vary them. */
export interface LeagueModelConfig extends SeasonConfig {
  readonly projections: ProjectionConfig & AvailabilityConfig;
  readonly market: MarketConfig & { readonly tradeSearchExcluded: readonly Pos[] };
  readonly lineups: {
    readonly playoffWeight: number;
    readonly needZThreshold: number;
    readonly strengthWeeks: number;
    readonly scenarios: number;
    readonly scenarioSeed: number;
  };
  readonly needs: {
    readonly chipMinGap: number;
    readonly chipScreenTeams: number;
    readonly needsShown: number;
    readonly partnersShown: number;
  };
  /** Partner fit counts at most maxPerSide chips a side (a partner trade has at most that many players a side, §12). */
  readonly search: { readonly maxPerSide: number };
  /** Streaming positions (§7; the file header, step 5a); optimizerExcluded: never the free-agent optimizer's moves (K, DEF). */
  readonly streaming: {
    readonly streamable: readonly Pos[];
    readonly streamRank: number;
    readonly detectAdds: number;
    readonly picksShown: number;
    readonly optimizerExcluded: readonly Pos[];
  };
  /** The free-agent optimizer V* (§7; the file header, step 5). */
  readonly freeAgentOptimizer: {
    readonly faMinGain: number;
    readonly faMaxMoves: number;
    readonly faDynGuard: number;
  };
  /** The star premium (the file header, step 9; premium.ts). */
  readonly acceptance: { readonly starPremium: StarPremiumConfig };
}

export interface BuildLeagueModelOptions {
  /** The moment the model is for: a game that kicked off at or before it is no longer a game left. */
  now: Date;
  /** Availability scenarios per lineup evaluation (default config.lineups.scenarios; 0 = expected-value lineups only). */
  scenarios?: number;
  /** Scenario seed (default config.lineups.scenarioSeed). */
  seed?: number;
  /** Simulated seasons for LeagueModel.odds (§8; default config.simulation.finalSims; 0 = no simulation, odds null). */
  sims?: number;
  /** The season simulation's common-random-numbers seed (default config.simulation.seed). */
  simSeed?: number;
  /** Milliseconds (performance.now in the browser): LeagueModel.timings is filled only when given. */
  clock?: () => number;
  /**
   * The user's settings (src/engine/settings.ts; Phase 4): the positions my team streams weekly and the playoff
   * weight. Default: defaultTradeSettings(). Read through normalizeTradeSettings (a stored copy from an older
   * version, or a bad value, falls back to its default); without them, the playoff weight is the config's.
   */
  settings?: TradeSettings;
}

// ---------------------------------------------------------------------------------------------
// Weeks and players

export interface LeagueWeeks {
  /** currentWeek..lastWeek. */
  weeks: number[];
  regularWeeks: number[];
  playoffWeeks: number[];
  lastWeek: number;
}

/**
 * The remaining NFL weeks (the Weeks section of the Phase 2 spec): currentWeek..lastWeek, lastWeek =
 * the last playoff week, else the last regular-season week, else `fallbackLastWeek` (inputs.lastWeek).
 */
export function leagueWeeks(settings: Pick<LeagueSettings, "regularSeasonWeeks" | "playoffWeeks">, currentWeek: number, fallbackLastWeek?: number): LeagueWeeks {
  const regular = settings.regularSeasonWeeks.filter((w) => Number.isInteger(w));
  const playoff = settings.playoffWeeks.filter((w) => Number.isInteger(w));
  const lastWeek = playoff.length ? Math.max(...playoff) : regular.length ? Math.max(...regular) : fallbackLastWeek !== undefined && Number.isInteger(fallbackLastWeek) ? fallbackLastWeek : currentWeek - 1;
  const weeks: number[] = [];
  if (Number.isInteger(currentWeek)) for (let w = currentWeek; w <= lastWeek; w++) weeks.push(w);
  const reg = new Set(regular);
  const po = new Set(playoff);
  return { weeks, regularWeeks: weeks.filter((w) => reg.has(w)), playoffWeeks: weeks.filter((w) => po.has(w)), lastWeek };
}

/**
 * The NFL regular season's last week from the inputs' schedule (ESPN's out-for-season marker is this + 1,
 * §4), or undefined when unknown (no schedule, or not a whole week ≥ 1).
 */
export function nflLastWeek(nfl: NflScheduleInputs | undefined): number | undefined {
  const w = nfl?.lastWeek;
  return typeof w === "number" && Number.isInteger(w) && w >= 1 ? w : undefined;
}

/** Whether his NFL team's currentWeek game has kicked off by `nowMs` (an unknown kickoff = not started). */
export function gameStarted(nflTeam: string | null, nfl: NflScheduleInputs | undefined, currentWeek: number, nowMs: number): boolean {
  if (!nflTeam || !nfl) return false;
  const iso = nfl.kickoffs?.[currentWeek]?.[nflTeam];
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= nowMs;
}

/** Whether any game of NFL week `week` has kicked off by `nowMs` (inputs.nfl.kickoffs; unknown kickoffs haven't). */
export function weekKickedOff(nfl: NflScheduleInputs | undefined, week: number, nowMs: number): boolean {
  const games = nfl?.kickoffs?.[week];
  if (!games) return false;
  return Object.values(games).some((iso) => {
    const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(t) && t <= nowMs;
  });
}

/**
 * The weeks team-level numbers count (the file header's game days), as indexes into LeagueModel.weeks.
 * With an in-progress current week (the first of `weeks`) they start the week after it.
 */
export interface TeamWeeks {
  /** The skipped current week, or null when every week counts (none in progress, or it isn't weeks[0]). */
  inProgressWeek: number | null;
  /** The first week index team numbers count: 1 with a week in progress, else 0. */
  from: number;
  /** ω per week for ROS(T), the free-agent optimizer, lineup costs and trade chips (weekWeights; 0 for the week in progress). */
  weights: Float64Array;
  /** The regular-season weeks PPW averages (the week in progress left out; none left → PPW 0). */
  regularWeeks: number[];
  /** Weeks in the "next" strength window: strengthWeeks, or fewer when fewer are left from `from`. */
  nNext: number;
  /** Equal weights over the next nNext weeks from `from`, and over every week from `from` (partner fit). */
  nextWeights: Float64Array;
  allWeights: Float64Array;
}

/**
 * TeamWeeks for a model's weeks and its week in progress (LeagueModel.inProgressWeek): scripts and Phase 4
 * price rosters over the same weeks the League model does.
 */
export function teamWeeks(
  weeks: { readonly weeks: readonly number[]; readonly regularWeeks: readonly number[]; readonly playoffWeeks: readonly number[] },
  inProgressWeek: number | null,
  cfg: { readonly playoffWeight: number; readonly strengthWeeks: number } = config.lineups,
): TeamWeeks {
  const W = weeks.weeks.length;
  const skipped = inProgressWeek !== null && W > 0 && weeks.weeks[0] === inProgressWeek ? inProgressWeek : null;
  const from = skipped === null ? 0 : 1;
  const weights = weekWeights(weeks.weeks, weeks.regularWeeks, weeks.playoffWeeks, cfg);
  if (skipped !== null) weights[0] = 0;
  const strengthWeeks = Number.isFinite(cfg.strengthWeeks) ? Math.max(0, Math.floor(cfg.strengthWeeks)) : 0;
  const nNext = Math.min(W - from, strengthWeeks);
  return {
    inProgressWeek: skipped,
    from,
    weights,
    regularWeeks: weeks.regularWeeks.filter((w) => w !== skipped),
    nNext,
    nextWeights: windowWeights(W, from, from + nNext),
    allWeights: windowWeights(W, from, W),
  };
}

/** Relevant player ids by role, in snapshot order (unique). */
interface Relevant {
  /** Every rostered id (active, IR, taxi), then every free agent not on a roster. */
  all: string[];
  active: Set<string>;
  rostered: Set<string>;
  freeAgents: string[];
}

function relevantIds(snapshot: LeagueSnapshot): Relevant {
  const all: string[] = [];
  const seen = new Set<string>();
  const active = new Set<string>();
  const rostered = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    all.push(id);
  };
  for (const t of snapshot.teams) {
    for (const id of t.roster) {
      active.add(id);
      rostered.add(id);
      add(id);
    }
    for (const id of [...t.ir, ...t.taxi]) {
      rostered.add(id);
      add(id);
    }
  }
  const freeAgents: string[] = [];
  for (const id of snapshot.freeAgents) {
    if (rostered.has(id) || seen.has(id)) continue;
    add(id);
    freeAgents.push(id);
  }
  return { all, active, rostered, freeAgents };
}

/**
 * Conflicting ESPN signals (§6 step 3; the file header, step 3): for a PROBABLE, QUESTIONABLE or DOUBTFUL
 * player whose ESPN return week is 2+ weeks away, which signal his availability follows (Sleeper breaks the
 * tie) and the numbers behind it; undefined for everyone else. `sleeperWeekLoaded` false (sleeperWeekLoaded,
 * below: Sleeper's projections for this week didn't load) leaves no tiebreaker: he follows the date, and
 * the note says the projections were missing rather than that Sleeper doesn't project him.
 */
export function availabilityNoteFor(
  info: Pick<PlayerInfo, "injury" | "injuryReturnWeek">,
  inputs: PlayerInputs,
  ctx: BaseRateContext,
  cfg: ProjectionConfig = config.projections,
  sleeperWeekLoaded = true,
): AvailabilityNote | undefined {
  const conflict = returnDateConflict(info, ctx.currentWeek);
  if (!conflict) return undefined;
  const check = staleReturnCheck(inputs, ctx, cfg);
  const note: AvailabilityNote = { status: conflict.status, returnWeek: conflict.returnWeek, used: check.stale ? "sleeper" : "returnDate", sleeperNow: check.sleeperNow, healthyRate: check.healthyRate };
  if (sleeperWeekLoaded) return note;
  return { ...note, used: "returnDate", sleeperNow: null, sleeperUnavailable: true };
}

/**
 * Whether Sleeper's projections for NFL week `week` loaded: some player's inputs have that week (the model
 * inputs write every loaded week for every player with a Sleeper id, null when he has no real line, and
 * leave a week that didn't load out for everyone: src/server/modelInputs.ts assembleModelInputs).
 */
export function sleeperWeekLoaded(players: Readonly<Record<string, PlayerInputs>>, week: number): boolean {
  return Object.values(players).some((p) => Object.prototype.hasOwnProperty.call(p.sleeper, week));
}

/** A modeled player's availability inputs: who he is, his week context, and the availability player the model reads (without a stale return week). */
export interface PlayerContext {
  info: PlayerInfo;
  ctx: AvailabilityContext;
  /** What availability reads (availability.ts): his info, or his tag alone when Sleeper found his ESPN return date stale. */
  avail: AvailabilityPlayer;
}

/** Players, projections and the projection table (steps 1–3), before scenarios are drawn. */
export interface LeaguePlayers {
  weeks: LeagueWeeks;
  /** Relevant players with a model (LeagueModel.players, values still null). */
  players: Record<string, PlayerModel>;
  /** Availability context per modeled player (scenario draws reuse it). */
  contexts: Map<string, PlayerContext>;
  relevant: Relevant;
  /** Relevant players left out: not in snapshot.players, or without model inputs. */
  skipped: { rostered: string[]; freeAgents: string[] };
  agreement: SourceAgreement | null;
  espnAveraged: boolean;
}

/** Steps 1–3 without the scenarios: weeks, the ESPN/Sleeper agreement, availability and projections. */
export function projectLeaguePlayers(snapshot: LeagueSnapshot, inputs: ModelInputs, now: Date, cfg: LeagueModelConfig = config): LeaguePlayers {
  const currentWeek = snapshot.currentWeek;
  const weeks = leagueWeeks(snapshot.settings, currentWeek, inputs.lastWeek);
  const relevant = relevantIds(snapshot);
  const inputPlayers = inputs.players ?? {};

  let agreement: SourceAgreement | null = null;
  if (snapshot.platform === "espn" && inputs.espnProjections) {
    agreement = espnSleeperAgreement(
      [...relevant.rostered].filter((id) => inputPlayers[id]),
      inputPlayers,
      currentWeek,
      cfg.projections,
    );
  }
  const espnAveraged = agreement?.agree === true;

  const nowMs = now.getTime();
  const lastNflWeek = nflLastWeek(inputs.nfl);
  const players: Record<string, PlayerModel> = {};
  const contexts = new Map<string, PlayerContext>();
  const skipped = { rostered: [] as string[], freeAgents: [] as string[] };
  const baseCtx: BaseRateContext = { currentWeek, weeks: weeks.weeks, espnAveraged };
  const sleeperNowLoaded = sleeperWeekLoaded(inputPlayers, currentWeek);
  for (const id of relevant.all) {
    const info = snapshot.players[id];
    const pin = inputPlayers[id];
    if (!info || !pin) {
      (relevant.rostered.has(id) ? skipped.rostered : skipped.freeAgents).push(id);
      continue;
    }
    const team = info.nflTeam ? info.nflTeam : null;
    const byeWeek = team ? inputs.nfl?.byeWeek?.[team] : undefined;
    const started = gameStarted(team, inputs.nfl, currentWeek, nowMs);
    const ctx: AvailabilityContext = { weeks: weeks.weeks, currentWeek, byeWeek, started, hasTeam: team !== null, ...(lastNflWeek !== undefined ? { lastNflWeek } : {}) };
    // Conflicting ESPN signals: a stale return date is dropped, for his expected availability and his scenarios alike.
    const note = availabilityNoteFor(info, pin, baseCtx, cfg.projections, sleeperNowLoaded);
    const avail: AvailabilityPlayer = note?.used === "sleeper" ? { injury: info.injury } : info;
    const availability = expectedAvailability(avail, info.pos, ctx, cfg.projections);
    // A PROBABLE, QUESTIONABLE or DOUBTFUL player gets the Q/D/P base rate (projections.ts): this week's cut projections count nowhere.
    const pm = projectPlayer(id, info.pos, pin, availability, { ...baseCtx, regularWeeks: weeks.regularWeeks, playoffWeeks: weeks.playoffWeeks, byeWeek, started, hasTeam: team !== null, injury: info.injury }, cfg.projections);
    players[id] = note ? { ...pm, availabilityNote: note } : pm;
    contexts.set(id, { info, ctx, avail });
  }
  return { weeks, players, contexts, relevant, skipped, agreement, espnAveraged };
}

/**
 * The projection table (teamValue.ts) from projected players: conditional points b·m_w, expected points
 * p_w, their SDs (§6 step 5: σ given he plays, c_pos × b·m_w + d_pos, and PlayerModel.weekly[w].sd) and,
 * when S > 0, S availability scenarios for active-roster players and free agents (streamFor(seed,
 * playerId, s): the same flags whichever team he is on).
 */
export function projectionTable(lp: LeaguePlayers, S: number, seed: number, cfg: LeagueModelConfig = config): ProjectionTable {
  const rows = new Map<string, TableRow>();
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  const freeAgents = new Set(lp.relevant.freeAgents);
  for (const [id, pm] of Object.entries(lp.players)) {
    const c = lp.contexts.get(id);
    if (!c) continue;
    const drawn = scenarios > 0 && (lp.relevant.active.has(id) || freeAgents.has(id));
    const cond = Float64Array.from(pm.weekly, (w) => pm.base.b * w.m);
    rows.set(id, {
      id,
      pos: c.info.pos,
      eligible: c.info.eligible,
      cond,
      ev: Float64Array.from(pm.weekly, (w) => w.p),
      condSd: Float64Array.from(cond, (x) => weeklySd(x, c.info.pos, cfg.projections)),
      evSd: Float64Array.from(pm.weekly, (w) => w.sd),
      flags: drawn ? scenarioAvailability(id, c.avail, c.info.pos, c.ctx, scenarios, seed, cfg.projections) : null,
    });
  }
  return { weeks: lp.weeks.weeks, scenarios, rows };
}

/** Steps 1–3 in one call (tests and scripts): projected players and their projection table. */
export function buildProjectionTable(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): { players: LeaguePlayers; table: ProjectionTable } {
  const players = projectLeaguePlayers(snapshot, inputs, opts.now, cfg);
  return { players, table: projectionTable(players, scenarioCount(opts.scenarios ?? cfg.lineups.scenarios), opts.seed ?? cfg.lineups.scenarioSeed, cfg) };
}

function scenarioCount(s: number): number {
  return Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
}

/** The earliest kickoff of NFL week `week` (inputs.nfl.kickoffs; unreadable times skipped), ms since the epoch, or null when none is known. */
export function firstKickoff(nfl: NflScheduleInputs | undefined, week: number): number | null {
  let first = Number.POSITIVE_INFINITY;
  for (const iso of Object.values(nfl?.kickoffs?.[week] ?? {})) {
    const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
    if (Number.isFinite(t) && t < first) first = t;
  }
  return Number.isFinite(first) ? first : null;
}

/**
 * The week in progress with every game still to play (the file header, "Game days"; TeamModel.score): the
 * projection table rebuilt for 1 ms before the week's earliest known kickoff. Rostered players, and the free
 * agents at `freeAgentPositions` (the streamed positions: their streaming replacement that week is taken
 * before kickoff too); other free agents don't change a team's score. A player's projection doesn't depend
 * on the moment, and his scenario draws depend only on the seed, his id and the scenario, so the table
 * matches the one at `opts.now` in every week but the first, where only the games that had kicked off come
 * back. ⚠️ It is not the week as it stood at kickoff: the snapshot's rosters and injury tags are today's (a
 * tag added after a player's game zeroes that game here, and a player moved since kickoff plays for his new
 * team). Null when `inProgressWeek` is null (LeagueModel.inProgressWeek) or its kickoffs are unknown.
 */
export function preKickoffTable(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  inProgressWeek: number | null,
  opts: BuildLeagueModelOptions,
  cfg: LeagueModelConfig = config,
  freeAgentPositions: ReadonlySet<Pos> = new Set(),
): { now: Date; table: ProjectionTable } | null {
  if (inProgressWeek === null) return null;
  const first = firstKickoff(inputs.nfl, inProgressWeek);
  if (first === null) return null;
  const now = new Date(first - 1);
  const freeAgents = snapshot.freeAgents.filter((id) => {
    const pos = snapshot.players[id]?.pos;
    return pos !== undefined && freeAgentPositions.has(pos);
  });
  const players = projectLeaguePlayers({ ...snapshot, freeAgents }, inputs, now, cfg);
  return { now, table: projectionTable(players, scenarioCount(opts.scenarios ?? cfg.lineups.scenarios), opts.seed ?? cfg.lineups.scenarioSeed, cfg) };
}

// ---------------------------------------------------------------------------------------------
// Streaming positions (§7; planner reply to Checkpoint 3, model change 1; the file header, step 5a)

/** Positions the league's lineup starts: a starting slot with at least one spot lists them (lineup.ts drops the rest). */
export function startablePositions(settings: Pick<LeagueSettings, "lineup">): Set<Pos> {
  const known = new Set<Pos>(POSITIONS);
  const out = new Set<Pos>();
  for (const s of settings.lineup) {
    if (!(Number.isFinite(s.count) && Math.floor(s.count) >= 1)) continue;
    for (const p of s.eligible) if (known.has(p)) out.add(p);
  }
  return out;
}


/**
 * Adds per team at each streamable position this season (the detection's evidence; step 5a): every move to
 * a team in an "add" or "waiver" transaction (snapshot.transactions are this season's), at the move's
 * position (Transaction moves carry it since Phase 4) or, without one, the player's in snapshot.players. A
 * move whose position is unknown or not streamable doesn't count. Team id → position → adds.
 */
export function streamingAdds(snapshot: Pick<LeagueSnapshot, "transactions" | "players">, streamable: readonly Pos[]): Map<string, Partial<Record<Pos, number>>> {
  const allowed = new Set<Pos>(streamable);
  const out = new Map<string, Partial<Record<Pos, number>>>();
  for (const t of snapshot.transactions ?? []) {
    if (t.type !== "add" && t.type !== "waiver") continue;
    for (const m of t.moves ?? []) {
      if (!m.to) continue;
      const pos = m.pos ?? snapshot.players[m.playerId]?.pos;
      if (pos === undefined || !allowed.has(pos)) continue;
      const counts = out.get(m.to) ?? {};
      counts[pos] = (counts[pos] ?? 0) + 1;
      out.set(m.to, counts);
    }
  }
  return out;
}

/**
 * The positions each team streams (step 5a; lead decision L1): my team (`myTeamId`, when it is one of the
 * league's teams) streams `streamPositions` (the user's "Positions I stream weekly"), whatever its adds; every
 * other team streams each config.streaming.streamable position where it made detectAdds or more adds this
 * season (streamingAdds). Only streamable positions the lineup starts count, in POSITIONS order.
 */
export function streamedPositions(
  snapshot: Pick<LeagueSnapshot, "teams" | "transactions" | "players" | "settings">,
  myTeamId: string | null,
  settings: Pick<TradeSettings, "streamPositions">,
  cfg: Pick<LeagueModelConfig, "streaming"> = config,
): Record<string, StreamingTeam> {
  const streamable = new Set<Pos>(cfg.streaming.streamable);
  const startable = startablePositions(snapshot.settings);
  const usable = (p: Pos) => streamable.has(p) && startable.has(p);
  const adds = streamingAdds(snapshot, cfg.streaming.streamable);
  const mine = new Set<Pos>(settings.streamPositions);
  const out: Record<string, StreamingTeam> = {};
  for (const team of snapshot.teams) {
    const counts = adds.get(team.id) ?? {};
    const setting = team.id === myTeamId;
    const positions = POSITIONS.filter((p) => usable(p) && (setting ? mine.has(p) : (counts[p] ?? 0) >= cfg.streaming.detectAdds));
    out[team.id] = { positions, source: setting ? "setting" : "detected", adds: { ...counts } };
  }
  return out;
}

/** Streaming rows from one projection table (streamingRows). */
export interface StreamingRows {
  /** The virtual row per position (teamValue.streamRow), only when its replacement scores in some week (a row of 0s changes no lineup). */
  rows: Map<Pos, TableRow>;
  /** The replacement per week (aligned with the table's weeks) for every position asked for (0s without free agents there). */
  replacement: Map<Pos, Float64Array>;
}

/**
 * The streaming rows for `positions` (step 5a): at each, the replacement per week from the free agents with a
 * row in `table` at that primary position (teamValue.streamingReplacement: the config.streaming.streamRank-th
 * best that week), and its virtual row. One row per position serves every team that streams it.
 */
export function streamingRows(table: ProjectionTable, freeAgentIds: readonly string[], positions: Iterable<Pos>, cfg: Pick<LeagueModelConfig, "streaming" | "projections"> = config): StreamingRows {
  const rows = new Map<Pos, TableRow>();
  const replacement = new Map<Pos, Float64Array>();
  const W = table.weeks.length;
  for (const pos of new Set(positions)) {
    const candidates = freeAgentIds.flatMap((id) => {
      const row = table.rows.get(id);
      return row && row.pos === pos && !isStreamId(id) ? [row] : [];
    });
    const rep = streamingReplacement(candidates, W, cfg.streaming.streamRank);
    replacement.set(pos, rep);
    if (rep.some((x) => x > 0)) rows.set(pos, streamRow(pos, rep, table.scenarios, cfg.projections));
  }
  return { rows, replacement };
}

/** The positions "Streaming picks this week" lists (§7, planner's model change 1): kickers and team defenses. */
const PICK_POSITIONS: readonly StreamingPick["pos"][] = ["K", "DEF"];

/**
 * "Streaming picks this week" (step 5a): for K and DEF, when the lineup starts them, the free agents with a row
 * in `table` at that primary position, by their expected points in the table's first week (the current NFL
 * week; availability included, so one on bye or whose game has started scores 0 and isn't a pick), best first
 * (ties: the smaller id), the first config.streaming.picksShown; each with that week's opponent from
 * `nfl.opponents` (null when unknown). Empty when the table's first week isn't `currentWeek` (no week left).
 */
export function streamingPicks(
  table: ProjectionTable,
  freeAgentIds: readonly string[],
  snapshot: Pick<LeagueSnapshot, "players" | "settings" | "currentWeek">,
  nfl: NflScheduleInputs | undefined,
  cfg: Pick<LeagueModelConfig, "streaming"> = config,
): StreamingPick[] {
  if (table.weeks[0] !== snapshot.currentWeek) return [];
  const startable = startablePositions(snapshot.settings);
  const shown = Number.isFinite(cfg.streaming.picksShown) ? Math.max(0, Math.floor(cfg.streaming.picksShown)) : 0;
  const out: StreamingPick[] = [];
  for (const pos of PICK_POSITIONS) {
    if (!startable.has(pos)) continue;
    const best = freeAgentIds
      .flatMap((id) => {
        const row = table.rows.get(id);
        const p = row?.ev[0] ?? 0;
        return row && row.pos === pos && p > 0 && Number.isFinite(p) ? [{ id, p }] : [];
      })
      .sort((a, b) => b.p - a.p || byId(a.id, b.id))
      .slice(0, shown);
    for (const { id, p } of best) {
      const team = snapshot.players[id]?.nflTeam;
      const opp = team ? nfl?.opponents?.[snapshot.currentWeek]?.[team] : undefined;
      out.push({ playerId: id, pos, projection: p, opponent: opp ? { team: opp.team, home: opp.home } : null });
    }
  }
  return out;
}

/**
 * `table` with streaming rows added under their ids (`stream:<POS>`), so teamValue's friendly API (functions
 * that take roster ids) prices a team as the League model does when the roster lists its streamIds. Scripts,
 * tests and trade evaluation use it; the model itself keeps the rows apart from the table.
 */
export function withStreamingRows(table: ProjectionTable, rows: Iterable<TableRow>): ProjectionTable {
  const all = new Map(table.rows);
  for (const r of rows) all.set(r.id, r);
  return { weeks: table.weeks, scenarios: table.scenarios, rows: all };
}

/** A team's streaming row ids (LeagueModel.streaming.byTeam), for rosters priced through withStreamingRows (a position without a row is skipped there). */
export function streamIds(model: Pick<LeagueModel, "streaming">, teamId: string): string[] {
  return (model.streaming.byTeam[teamId]?.positions ?? []).map(streamRowId);
}

/**
 * A projection table (buildProjectionTable's) with the League model's streaming rows added
 * (withStreamingRows), built from the table's own free agents the way buildLeagueModel builds them.
 */
export function tableWithStreaming(built: { players: LeaguePlayers; table: ProjectionTable }, model: Pick<LeagueModel, "streaming">, cfg: Pick<LeagueModelConfig, "streaming" | "projections"> = config): ProjectionTable {
  const positions = new Set(Object.values(model.streaming.byTeam).flatMap((s) => s.positions));
  const freeAgents = built.players.relevant.freeAgents.filter((id) => built.table.rows.has(id));
  return withStreamingRows(built.table, streamingRows(built.table, freeAgents, positions, cfg).rows.values());
}

/**
 * The settings the model runs with (BuildLeagueModelOptions.settings): normalized (settings.ts), or the
 * defaults with the config's playoff weight (the same as defaultTradeSettings() unless a caller tunes the
 * config).
 */
export function modelSettings(raw: TradeSettings | undefined, cfg: Pick<LeagueModelConfig, "lineups"> = config): TradeSettings {
  return raw ? normalizeTradeSettings(raw) : { ...defaultTradeSettings(), playoffWeight: cfg.lineups.playoffWeight };
}

// ---------------------------------------------------------------------------------------------
// Warnings

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function nameList(ids: readonly string[], snapshot: LeagueSnapshot, max = 5): string {
  const names = ids.slice(0, max).map((id) => snapshot.players[id]?.name ?? id);
  return `${names.join(", ")}${ids.length > max ? ", …" : ""}`;
}

/**
 * Plain-English notes about gaps, worded from what actually loaded. The ESPN/Sleeper note (ESPN leagues
 * whose projections weren't averaged) follows the base-rate sources (`sources`): which projections the
 * numbers use, and it says the two were compared only when they were. Nothing about projections once no
 * week is left to project. Missing trade values are the model inputs' own warning (nothing here needs
 * them: trade chips and partners are lineup points).
 */
function modelWarnings(snapshot: LeagueSnapshot, inputs: ModelInputs, lp: LeaguePlayers, sources: Readonly<Record<BaseRateSource, number>>, cfg: LeagueModelConfig): string[] {
  const out: string[] = [];
  const weeksLeft = lp.weeks.weeks.length > 0;
  if (inputs.currentWeek !== snapshot.currentWeek) {
    out.push(`The projections were prepared for week ${inputs.currentWeek}, but the league is in week ${snapshot.currentWeek}. Refresh to update them.`);
  }
  const { rostered, freeAgents } = lp.skipped;
  if (rostered.length) out.push(`No projections for ${plural(rostered.length, "rostered player")} (${nameList(rostered, snapshot)}), so they count as 0 points.`);
  if (freeAgents.length) out.push(`No projections for ${plural(freeAgents.length, "free agent")}, so they are left out.`);
  if (weeksLeft && snapshot.platform === "espn" && inputs.espnProjections && !lp.espnAveraged) {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const a = lp.agreement?.agreement;
    const fromSleeper = sources.sleeper + sources["espn+sleeper"];
    // Players Sleeper doesn't project fall back to ESPN's own projection (projections.ts).
    const espnOnly = sources.espn > 0 ? ` (ESPN's for the ${plural(sources.espn, "player")} Sleeper doesn't project)` : "";
    if (a) {
      out.push(`ESPN's projections differ from Sleeper's by ${pct(a.meanRelDiff)} on average this week (more than ${pct(cfg.projections.espnSleeperAgreement)}), so projections use Sleeper's alone${espnOnly}.`);
    } else if (fromSleeper > 0) {
      out.push(`ESPN's and Sleeper's projections couldn't be compared this week (no rostered player has both), so projections use Sleeper's alone${espnOnly}.`);
    } else if (sources.espn > 0) {
      out.push("Sleeper's projections are missing, so projections use ESPN's alone.");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Teams

export interface TeamWork {
  team: Team;
  /** Every distinct id on team.roster, in roster order: each takes an active-roster spot, with a model or not. */
  ids: string[];
  /** Active-roster players with a model, in roster order. */
  rows: TableRow[];
  /**
   * The team's streaming rows and streamed positions (step 5a). Every lineup of the team is valued with the
   * rows after its players (so a player's roster index is the same in both), but they are never one of its
   * players: no roster spot, no lineup cost, never dropped, a chip or a free-agent move.
   */
  stream: StreamSpec;
  /** The team as it stands: its rows and streaming rows prepared, its EV lineups and EV ROS. */
  evalT: TeamEval;
  solved: SolvedWeeks;
  evRos: number;
  /** Its scenario lineups (instances for strength, the within-lineup variance for its score) and scenario ROS; null without scenarios. */
  scen: ScenarioValues | null;
  scenRos: number | null;
  /** V*(T), the free-agent optimizer's roster (step 5), its scenario ROS and scenario lineups cell by cell (null without scenarios). */
  vstar: OptimizedRoster;
  vstarScen: number | null;
  vstarCells: ScenarioCells | null;
  /** Per row: V*(T − i), the re-run from V*(T)'s roster without him (step 5; its exchanges in `given`), or null when V*(T) dropped him. */
  losses: (OptimizedRoster | null)[];
  /** Per row: MV_lose, EV and scenario lineups (step 5). */
  mvLoseEv: number[];
  mvLoseScen: (number | null)[];
  faMoves: FaMove[];
  scores: number[];
}

/** Everything steps 1–5 build: the League model, its trade chips and partners, and leagueMarginals read it (and Phase 4's trade evaluation: evaluate.ts). */
export interface LeagueContext {
  snapshot: LeagueSnapshot;
  cfg: LeagueModelConfig;
  settings: TradeSettings;
  S: number;
  W: number;
  lp: LeaguePlayers;
  tw: TeamWeeks;
  weights: Float64Array;
  table: ProjectionTable;
  valueOf: (id: string) => number;
  market: MarketSummary;
  freeAgentIds: string[];
  slots: PreparedSlots;
  instances: SlotInstance[];
  index: InstanceIndex;
  maskOf: (row: TableRow) => number;
  posOf: (id: string) => Pos | undefined;
  limits: Partial<Record<Pos, number>> | undefined;
  maxRosterSize: number;
  byTeam: Record<string, StreamingTeam>;
  streamed: Set<Pos>;
  stream: StreamingRows;
  picks: StreamingPick[];
  optimizer: RosterOptimizer;
  /** A roster's ROS in scenario lineups (memoized by its key); only with scenarios. */
  scenRosOf: (roster: readonly string[], stream: StreamSpec) => number;
  work: TeamWork[];
}

/** A lineup cost in the mode chips and drops read: scenario lineups when scenarios ran, else EV. */
function costOf(t: TeamWork, x: number): number {
  return t.mvLoseScen[x] ?? (t.mvLoseEv[x] as number);
}

/** A re-run's ROS in the lineup costs' mode (scenario lineups when scenarios ran, else EV). */
function rerunRos(ctx: LeagueContext, t: TeamWork, run: OptimizedRoster): number {
  return ctx.S > 0 ? ctx.scenRosOf(run.roster, t.stream) : run.evRos;
}

/** LV per week (every week, a week in progress included: a partial week), and ROS(T) and PPW over the weeks team numbers count. */
function lineupValues(lv: ArrayLike<number>, tw: TeamWeeks, weeks: LeagueWeeks): LineupValues {
  return { lv: Array.from(lv), ros: rosValue(lv, tw.weights), ppw: ppw(lv, weeks.weeks, tw.regularWeeks) };
}

/** positions without one occurrence of `pos`. */
function withoutOne(positions: readonly Pos[], pos: Pos): Pos[] {
  const i = positions.indexOf(pos);
  return i < 0 ? [...positions] : [...positions.slice(0, i), ...positions.slice(i + 1)];
}

/**
 * The dynasty guard (step 5): in dynasty and keeper leagues whose dynasty values loaded (benefit.futureValuesLoaded),
 * the long-term values (§9's future term, estimates for players FantasyCalc doesn't value) and the most a drop may
 * give up over the free agent added: faDynGuard × the top dynasty value. Null otherwise (no guard).
 */
function dynastyGuard(snapshot: LeagueSnapshot, inputs: ModelInputs, players: readonly { id: string; pos: Pos }[], rosPoints: Readonly<Record<string, number>>, cfg: LeagueModelConfig): DynastyGuard | null {
  const market = inputs.market ?? null;
  if (!market || !futureValuesLoaded(snapshot.settings.leagueType, market)) return null;
  const future = marketValues(players, rosPoints, market, cfg.market, "future");
  const top = valuesForTerm(market, "future").topValue;
  return { value: (id) => future[id]?.value ?? 0, maxDrop: cfg.freeAgentOptimizer.faDynGuard * (Number.isFinite(top) && top > 0 ? top : 0) };
}

/** Steps 1–5 (the file header): projections, scenarios, values, streaming, every team's lineups, V* and lineup costs. */
function prepareLeague(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig, mark: (stage: string) => void): LeagueContext {
  const S = scenarioCount(opts.scenarios ?? cfg.lineups.scenarios);
  const seed = opts.seed ?? cfg.lineups.scenarioSeed;
  // The user's settings: my streamed positions (step 5a) and the playoff weight every ROS(T) uses.
  const settings = modelSettings(opts.settings, cfg);

  // 1–3. Weeks, players, projections, scenarios; the weeks team numbers count (game days: the file header).
  const lp = projectLeaguePlayers(snapshot, inputs, opts.now, cfg);
  const { weeks } = lp;
  const W = weeks.weeks.length;
  const tw = teamWeeks(weeks, weekKickedOff(inputs.nfl, snapshot.currentWeek, opts.now.getTime()) ? snapshot.currentWeek : null, { ...cfg.lineups, playoffWeight: settings.playoffWeight });
  const { weights } = tw;
  mark("projections");
  const table = projectionTable(lp, S, seed, cfg);
  if (S > 0) mark("availability scenarios");

  // 4. Market values and the waiver credit.
  const modelIds = Object.keys(lp.players);
  const valuePlayers = modelIds.map((id) => ({ id, pos: (lp.contexts.get(id) as PlayerContext).info.pos }));
  // The estimate curve (§9) fits values to ROS points over the weeks team numbers count, so on game days a
  // player whose game has kicked off isn't worth less than one who plays later that week (review final check).
  const rosPoints: Record<string, number> = {};
  for (const id of modelIds) rosPoints[id] = (lp.players[id] as PlayerModel).weekly.slice(tw.from).reduce((s, w) => s + w.p, 0);
  const values = marketValues(valuePlayers, rosPoints, inputs.market ?? null, cfg.market);
  for (const id of modelIds) (lp.players[id] as PlayerModel).value = values[id] ?? null;
  const freeAgentIds = lp.relevant.freeAgents.filter((id) => table.rows.has(id));
  const topValue = inputs.market ? valuesForTerm(inputs.market).topValue : 0;
  const credit = inputs.market ? waiverCredit(values, freeAgentIds, topValue, cfg.market) : 0;
  const market = marketSummary(modelIds, values, inputs.market ?? null, credit);
  const valueOf = (id: string) => values[id]?.value ?? 0;
  mark("market values");

  // 5. Slots, masks, limits.
  const slots = prepareLeagueSlots(snapshot.settings);
  const instances = slotInstances(snapshot.settings.lineup);
  const index = instanceIndex(instances, slots);
  const masks = new Map<string, number>();
  for (const row of table.rows.values()) masks.set(row.id, slotMask(slots, row.pos, row.eligible));
  const maskOf = (row: TableRow) => masks.get(row.id) ?? 0;
  const posOf = (id: string) => table.rows.get(id)?.pos ?? snapshot.players[id]?.pos;
  const limits = snapshot.settings.positionLimits;
  const maxRosterSize = snapshot.settings.maxRosterSize;

  // 5a. Streaming: who streams what, one virtual row per streamed position, and this week's picks.
  const myTeamKnown = snapshot.myTeamId !== null && snapshot.teams.some((t) => t.id === snapshot.myTeamId);
  const byTeam = streamedPositions(snapshot, myTeamKnown ? snapshot.myTeamId : null, settings, cfg);
  const streamed = new Set<Pos>(Object.values(byTeam).flatMap((s) => s.positions));
  const stream = streamingRows(table, freeAgentIds, streamed, cfg);
  const picks = streamingPicks(table, freeAgentIds, snapshot, inputs.nfl, cfg);
  mark("streaming");

  // 5. Teams: EV lineups, V*(T) and its moves, and every V*(V*(T) − i).
  const optimizer = createOptimizer(
    {
      rows: table.rows,
      weekCount: W,
      slots,
      weights,
      freeAgents: freeAgentIds,
      info: (id) => snapshot.players[id],
      positionLimits: limits,
      maxRosterSize,
      dropValue: valueOf,
      dynasty: dynastyGuard(snapshot, inputs, valuePlayers, rosPoints, cfg),
      // V*(T) judges its moves in scenario lineups when scenarios run (the file header, step 5); the re-runs don't.
      scenarios: S,
      instanceIndex: index,
    },
    { faMinGain: cfg.freeAgentOptimizer.faMinGain, faMaxMoves: cfg.freeAgentOptimizer.faMaxMoves, optimizerExcluded: cfg.streaming.optimizerExcluded },
  );
  const work: TeamWork[] = snapshot.teams.map((team) => {
    const ids = [...new Set(team.roster)];
    const rows = ids.flatMap((id) => table.rows.get(id) ?? []);
    const spec: StreamSpec = { rows: (byTeam[team.id]?.positions ?? []).flatMap((p) => stream.rows.get(p) ?? []), positions: byTeam[team.id]?.positions ?? [] };
    const cur = optimizer.evaluate(ids, spec);
    const vstar = optimizer.optimize(ids, spec);
    const inV = new Set(vstar.roster);
    // V*(T − i): the re-run from V*(T)'s roster without him, one move beyond the free ones (step 5: an exchange at the cap).
    const losses = rows.map((r) => (inV.has(r.id) ? optimizer.reoptimize(vstar, vstar.roster.filter((id) => id !== r.id), spec, 1, [r.id]) : null));
    return {
      team,
      ids,
      rows,
      stream: spec,
      evalT: cur.team,
      solved: cur.solved,
      evRos: cur.evRos,
      scen: null,
      scenRos: null,
      vstar,
      vstarScen: null,
      vstarCells: null,
      losses,
      mvLoseEv: losses.map((l) => (l ? Math.max(0, vstar.evRos - l.evRos) : 0)),
      mvLoseScen: rows.map(() => null),
      faMoves: [],
      scores: rows.map(() => 0),
    };
  });
  mark("EV lineups and the free-agent optimizer");

  // 5. Scenario lineups of T (its strength and score), of V*(T) (cell by cell: removal costs and the chip base), of
  // each roster after a move, and of every V*(V*(T) − i): lineup costs and the moves' scenario gains.
  const scenMemo = new Map<string, number>();
  const scenRosOf = (roster: readonly string[], spec: StreamSpec): number => {
    const key = rosterKey(roster, spec);
    let ros = scenMemo.get(key);
    if (ros === undefined) {
      ros = rosValue(scenarioValues(optimizer.evaluate(roster, spec).team, W, S).mean, weights);
      scenMemo.set(key, ros);
    }
    return ros;
  };
  for (const t of work) {
    const steps = t.vstar.moves;
    if (S > 0) {
      const noMove = steps.length === 0;
      t.scen = scenarioValues(t.evalT, W, S, index, noMove, true);
      t.scenRos = rosValue(t.scen.mean, weights);
      scenMemo.set(rosterKey(t.ids, t.stream), t.scenRos);
      if (noMove) {
        t.vstarCells = t.scen.cells;
        t.vstarScen = t.scenRos;
      } else {
        const v = scenarioValues(t.vstar.team, W, S, null, true);
        t.vstarCells = v.cells;
        t.vstarScen = rosValue(v.mean, weights);
        scenMemo.set(rosterKey(t.vstar.roster, t.stream), t.vstarScen);
      }
    }
    let roster: readonly string[] = t.ids;
    let evBefore = t.evRos;
    let scenBefore = t.scenRos;
    t.faMoves = steps.map((m) => {
      roster = applyStep(roster, m);
      const ev = optimizer.evaluate(roster, t.stream).evRos;
      const scen = S > 0 ? scenRosOf(roster, t.stream) : null;
      const move: FaMove = { add: m.add, drop: m.drop, gainEv: ev - evBefore, gainScen: scen !== null && scenBefore !== null ? scen - scenBefore : null };
      evBefore = ev;
      scenBefore = scen;
      return move;
    });
    if (S > 0) {
      // A re-run that changed nothing is V*(T) minus him: his scenario removal cost, without solving again (teamValue.ts).
      const removal = scenarioRemovalCosts(t.vstarCells as ScenarioCells, weights);
      const at = new Map(t.vstar.team.rows.map((r, k) => [r.id, k]));
      t.mvLoseScen = t.rows.map((r, x) => {
        const l = t.losses[x];
        if (!l) return 0;
        const lost = l.moves.length === 0 && l.given.length === 0 ? (removal[at.get(r.id) as number] as number) : (t.vstarScen as number) - scenRosOf(l.roster, t.stream);
        return Math.max(0, lost);
      });
    }
  }
  if (S > 0) mark("scenario lineups and marginal values");

  return { snapshot, cfg, settings, S, W, lp, tw, weights, table, valueOf, market, freeAgentIds, slots, instances, index, maskOf, posOf, limits, maxRosterSize, byTeam, streamed, stream, picks, optimizer, scenRosOf, work };
}

/**
 * A team's bases for trade chips (step 6): V*(T′)'s ROS in the lineup costs' mode; B′ = V*(T′) minus the player it
 * drops to make room when its active roster is full (null when it's full and nobody can be dropped); and, built when
 * first needed, B′ for a newcomer at a position B′ has at its limit (L7: V*(T′) minus its lowest keep value player at
 * that position; null when nobody there can go).
 */
export interface TeamBase {
  vRos: number;
  base: AddBase | null;
  atLimit: Map<Pos, AddBase | null>;
  /** What losing each of V*(T′)'s players (its team rows) costs its lineup, nobody refilling his spot, in the chips' mode: the keep value. */
  keep: Float64Array | null;
}

export interface AddBase {
  /** B′'s roster: the optimizer re-runs from B′ + i. */
  ids: string[];
  /** B′'s EV lineups, and its scenario lineups cell by cell (null without scenarios). */
  ev: SolvedWeeks;
  cells: ScenarioCells | null;
  /** ROS(V*(T′)) − ROS(B′), EV and scenario: what making room costs (0 without a drop). */
  dropCostEv: number;
  dropCostScen: number;
  /** Positions on B′ (the newcomer must fit positionLimits). */
  positions: Pos[];
  /** The player V*(T′) drops to make room, or null (an open spot). */
  drop: string | null;
  /**
   * A bound on what the re-run adds after any newcomer, in the lineup costs' mode and in EV lineups (step 6): 0 when
   * no free-agent move can follow (no free agent's add bound on B′ reaching faMinGain, no move allowed, or starter
   * limits: the re-run is skipped there).
   */
  extra: number;
  extraEv: number;
}

/**
 * Whether the optimizer's re-run from B′ + i is run for MV_add (step 6): only when i starts for B′ in some week team
 * numbers count (his EV gain on B′'s lineups is above 0). A newcomer who starts nowhere there is priced without it, and
 * his bound has no re-run part, for speed (L14: re-running for every such pair took the League model on Parker's league
 * from about 345 to about 550 ms). ⚠️ An approximation: he can still free a move, as a backup good enough that the
 * team's backup QB can go for a free agent and its QB pickup can be given back (Drake Maye to Team 10 on the offline
 * report's inputs: 1.2 without the re-run, 17.2 with it). Measured on Parker's league: 10 of 1,413 (player, team) pairs
 * change, one chip of 89 is missed; in random 10-team leagues, 0 and 50 of 1,440 pairs, by at most 4.3 points, no chip.
 */
function rerunCounts(b: AddBase, row: TableRow, mask: number, weights: ArrayLike<number>): boolean {
  return addGainExact(b.ev, row, mask, weights).gain > EPS;
}

/** The sum of the k largest of xs (0 for k ≤ 0). */
function topSum(xs: number[], k: number): number {
  if (!(k > 0)) return 0;
  return [...xs]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, x) => s + Math.max(0, x), 0);
}

/** TeamBase.keep, computed once: each V*(T′) player's removal cost, nobody refilling his spot, in the chips' lineup mode (§7 keep value). */
function keepCosts(ctx: LeagueContext, t: TeamWork, tb: TeamBase): Float64Array {
  if (!tb.keep) tb.keep = t.vstarCells ? scenarioRemovalCosts(t.vstarCells, ctx.weights) : evRemovalCosts(t.vstar.solved, ctx.weights);
  return tb.keep;
}

/** B′ = V*(T′) minus `drop` (null: V*(T′) itself, an open spot), with what making room costs and the re-run's bound (step 6). */
function makeBase(ctx: LeagueContext, t: TeamWork, drop: string | null): AddBase {
  const { S, W, weights, slots, posOf } = ctx;
  const R = t.vstar;
  const noise = (x: number) => (Math.abs(x) < EPS ? 0 : x);
  const positions = R.roster.flatMap((id) => posOf(id) ?? []);
  let base: AddBase;
  if (drop === null) {
    base = { ids: [...R.roster], ev: R.solved, cells: t.vstarCells, dropCostEv: 0, dropCostScen: 0, positions, drop: null, extra: 0, extraEv: 0 };
  } else {
    const bEval = teamEval(
      R.team.rows.filter((r) => r.id !== drop),
      slots,
    );
    const ev = solveEvWeeks(bEval, W);
    const scen = S > 0 ? scenarioValues(bEval, W, S, null, true) : null;
    const dropPos = posOf(drop);
    base = {
      ids: R.roster.filter((id) => id !== drop),
      ev,
      cells: scen?.cells ?? null,
      // Both sides through the same lineup functions, so a drop who never starts costs 0; differences under 1e-9 are float noise, 0.
      dropCostEv: noise(R.evRos - rosValue(ev.lv, weights)),
      dropCostScen: scen && t.vstarScen !== null ? noise(t.vstarScen - rosValue(scen.mean, weights)) : 0,
      positions: dropPos ? withoutOne(positions, dropPos) : positions,
      drop,
      extra: 0,
      extraEv: 0,
    };
  }
  // The re-run's bound (step 6): its first move gains at most what a free agent adds to B′ (none reaching faMinGain: no
  // move at all); everything it ends with is at most B′ + i plus its free agents and, after an exchange, the player who
  // comes back (more players never lower a lineup), and each adds at most his add bound on B′ (a player added to a
  // bigger roster gains no more). So: the (its moves: optimizer.rerunMoves, one extra for the newcomer) largest free
  // agents' add bounds, plus the largest add bound of a player V*(T′) dropped (the one exchange can bring one back).
  // Under starter limits the re-run is skipped.
  const moves = slots.limits === null ? ctx.optimizer.rerunMoves(R, base.ids, 1) : 0;
  if (moves > 0) {
    const minGain = ctx.cfg.freeAgentOptimizer.faMinGain;
    const always = new Set<Pos>(ctx.cfg.streaming.optimizerExcluded);
    const onBase = new Set(base.ids);
    const excluded = (pos: Pos) => always.has(pos) || t.stream.positions.includes(pos);
    // With one move (a team at its cap: the extra one), it starts from B′ + i, a superset of B′, so its free agent's EV
    // gain, at least faMinGain, is at most his add bound on B′: only those free agents can be in it.
    const single = moves === 1;
    const evB: number[] = [];
    const scB: number[] = [];
    let first = 0;
    for (const id of ctx.freeAgentIds) {
      const row = ctx.table.rows.get(id) as TableRow;
      if (onBase.has(id) || excluded(row.pos)) continue;
      const mask = ctx.maskOf(row);
      const ub = addUpperBound(base.ev, row, mask, weights);
      if (ub > first) first = ub;
      evB.push(ub);
      if (base.cells && (!single || ub >= minGain - EPS)) scB.push(scenarioAddUpperBound(base.cells, row, mask, weights));
    }
    if (first >= minGain - EPS) {
      let backEv = 0;
      let backScen = 0;
      for (const id of droppedBy(R)) {
        const row = ctx.table.rows.get(id);
        if (!row || onBase.has(id)) continue;
        const mask = ctx.maskOf(row);
        backEv = Math.max(backEv, addUpperBound(base.ev, row, mask, weights));
        if (base.cells) backScen = Math.max(backScen, scenarioAddUpperBound(base.cells, row, mask, weights));
      }
      base.extraEv = topSum(evB, moves) + backEv + EPS;
      base.extra = base.cells ? topSum(scB, moves) + backScen + EPS : base.extraEv;
    }
  }
  return base;
}

/** The team's own players an optimizer run dropped (a drop that wasn't one of its own pickups): who an exchange can bring back. */
function droppedBy(run: OptimizedRoster): string[] {
  const added = new Set<string>();
  const out: string[] = [];
  for (const m of run.moves) {
    if (m.drop !== null && !added.has(m.drop)) out.push(m.drop);
    added.add(m.add);
  }
  return out;
}

/** TeamBase for every team (step 6; the file header): the general B′ now, the ones for limited positions when first needed (baseFor). */
export function teamBases(ctx: LeagueContext): TeamBase[] {
  return ctx.work.map((t) => {
    const R = t.vstar;
    const tb: TeamBase = { vRos: ctx.S > 0 ? (t.vstarScen as number) : R.evRos, base: null, atLimit: new Map(), keep: null };
    if (R.roster.length < ctx.maxRosterSize) {
      tb.base = makeBase(ctx, t, null);
      return tb;
    }
    // A full roster drops the player whose loss costs V*(T′)'s lineup least, in the chips' lineup mode, with nobody
    // refilling his spot (the newcomer takes it): §7's keep value, marginal ROS contribution. Not his lineup cost,
    // which refills the spot with free agents (the file header, step 6). Candidates: V*(T′)'s players with a model
    // (free agents it added included); never a streaming row (it takes no roster spot).
    const keep = keepCosts(ctx, t, tb);
    const drop = lowestKeepValue(R.team.rows.flatMap((r, k) => (isStreamId(r.id) ? [] : [{ id: r.id, keep: keep[k] as number, value: ctx.valueOf(r.id) }])));
    tb.base = drop === null ? null : makeBase(ctx, t, drop);
    return tb;
  });
}

/**
 * The base a newcomer at `pos` joins on team `u` (step 6; L7 roster legality): its general B′ when that leaves room
 * at his position, else V*(T′) minus its lowest keep value player at `pos` (his primary position; a player with a
 * model, never a streaming row; ties as lowestKeepValue), built once per position. Null when the roster is full with
 * nobody to drop, when nobody at `pos` can go, or when one going still leaves the position at its limit.
 */
export function baseFor(ctx: LeagueContext, bases: readonly TeamBase[], u: number, pos: Pos): AddBase | null {
  const tb = bases[u] as TeamBase;
  if (!tb.base) return null;
  if (positionAllows(ctx.limits, tb.base.positions, pos)) return tb.base;
  let b = tb.atLimit.get(pos);
  if (b === undefined) {
    const t = ctx.work[u] as TeamWork;
    const keep = keepCosts(ctx, t, tb);
    const drop = lowestKeepValue(t.vstar.team.rows.flatMap((r, k) => (isStreamId(r.id) || r.pos !== pos ? [] : [{ id: r.id, keep: keep[k] as number, value: ctx.valueOf(r.id) }])));
    const positions = t.vstar.roster.flatMap((id) => ctx.posOf(id) ?? []);
    b = drop !== null && positionAllows(ctx.limits, withoutOne(positions, pos), pos) ? makeBase(ctx, t, drop) : null;
    tb.atLimit.set(pos, b);
  }
  return b;
}

/**
 * MV_add(T′, i) exactly (step 6) on base `b` of team `u`, in scenario lineups (`scenario`) or EV: the pinned part,
 * gain(B′, i) − what making room costs, and when a free-agent move can follow (AddBase.extraEv > 0), the optimizer
 * re-run from B′ + i (optimizer.reoptimize with one extra move) priced against V*(T′). Not floored.
 */
export function addValueOf(ctx: LeagueContext): (u: number, b: AddBase, row: TableRow, mask: number, scenario: boolean) => number {
  return (u, b, row, mask, scenario) => {
    const pinned = () => (scenario ? scenarioAddGain(b.cells as ScenarioCells, row, mask, ctx.weights) - b.dropCostScen : addGainExact(b.ev, row, mask, ctx.weights).gain - b.dropCostEv);
    if (!(b.extraEv > 0) || !rerunCounts(b, row, mask, ctx.weights)) return pinned();
    const t = ctx.work[u] as TeamWork;
    const run = ctx.optimizer.reoptimize(t.vstar, [...b.ids, row.id], t.stream, 1, [], b.ids);
    if (!run.moves.length && !run.given.length) return pinned();
    return scenario ? ctx.scenRosOf(run.roster, t.stream) - (t.vstarScen as number) : run.evRos - t.vstar.evRos;
  };
}

/** One other team a candidate could go to: its bound on MV_add (+Infinity when nothing is bounded) and the exact value. */
interface AddOption {
  teamId: string;
  ub: number;
  exact: () => number;
}

/**
 * The largest MV_add over `options` and its team (ties: the smaller team id), exactly, solving as few as
 * it can (the file header, step 6): options in bound order, and the search stops once no bound can reach
 * the best value found, or once neither that value nor any remaining bound can make a chip (then the
 * player isn't a chip, whatever the rest are worth). Null when no option is solved.
 */
function bestAddition(options: readonly AddOption[], cost: number, minGap: number): { value: number; teamId: string } | null {
  const sorted = [...options].sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.teamId, b.teamId));
  let best: { value: number; teamId: string } | null = null;
  for (const o of sorted) {
    const couldChip = o.ub - cost >= minGap - EPS;
    if (best) {
      if (o.ub < best.value - EPS) break;
      if (!couldChip && best.value - cost < minGap - EPS) break;
    } else if (!couldChip) {
      break;
    }
    const value = Math.max(0, o.exact());
    if (!best || value > best.value + EPS || (Math.abs(value - best.value) <= EPS && o.teamId < best.teamId)) best = { value, teamId: o.teamId };
  }
  return best;
}

/** Step 6: every team's trade chips (the file header). */
function tradeChipsAll(ctx: LeagueContext, bases: readonly TeamBase[]): TradeChip[][] {
  const { S, weights, work, cfg } = ctx;
  const excluded = new Set<Pos>(cfg.market.tradeSearchExcluded);
  const limited = ctx.slots.limits !== null;
  const minGap = cfg.needs.chipMinGap;
  const screenTeams = Number.isFinite(cfg.needs.chipScreenTeams) ? Math.max(1, Math.floor(cfg.needs.chipScreenTeams)) : 1;
  const addValue = addValueOf(ctx);
  // Σ ω over the weeks team numbers count: a chip's cost per week (lead decision L5).
  let omega = 0;
  for (let w = 0; w < ctx.W; w++) omega += weights[w] ?? 0;
  return work.map((t, ti) => {
    // The starter tag reads V*(T)'s EV lineups, the roster his cost is measured from: each player's index there.
    const inV = new Map(t.vstar.team.rows.map((r, k) => [r.id, k]));
    const cands: ChipCandidate[] = [];
    t.rows.forEach((row, x) => {
      if (excluded.has(row.pos)) return;
      const mask = ctx.maskOf(row);
      const cost = costOf(t, x);
      // Display only (L5): what he costs per week, and whether he starts for his team after its pickups (never when V*(T) dropped him).
      const k = inV.get(row.id);
      const display = { costPerWeek: omega > EPS ? cost / omega : 0, starter: k !== undefined && evStarter(t.vstar.solved, k, weights) };
      const options: (AddOption & { ui: number; base: AddBase })[] = [];
      work.forEach((u, ui) => {
        if (ui === ti || u.team.roster.includes(row.id)) return;
        const base = baseFor(ctx, bases, ui, row.pos);
        if (!base) return;
        const evUb = addUpperBound(base.ev, row, mask, weights);
        const pinnedUb = S > 0 ? scenarioAddUpperBound(base.cells as ScenarioCells, row, mask, weights) - base.dropCostScen : evUb - base.dropCostEv;
        // Nothing beyond the pinned part when the re-run is skipped: no EV gain on B′ (rerunCounts; a bound of 0 says so).
        options.push({ ui, base, teamId: u.team.id, ub: pinnedUb + (evUb > EPS ? base.extra : 0), exact: () => addValue(ui, base, row, mask, S > 0) });
      });
      let best: { value: number; teamId: string } | null;
      if (S > 0 && limited) {
        // Starter limits bound nothing: the best chipScreenTeams teams by exact EV value get scenario lineups.
        const screened = options
          .map((o) => ({ o, ev: Math.max(0, addValue(o.ui, o.base, row, mask, false)) }))
          .sort((a, b) => (Math.abs(b.ev - a.ev) > EPS ? b.ev - a.ev : byId(a.o.teamId, b.o.teamId)))
          .slice(0, screenTeams);
        best = bestAddition(
          screened.map(({ o }) => ({ teamId: o.teamId, ub: Number.POSITIVE_INFINITY, exact: o.exact })),
          cost,
          minGap,
        );
      } else {
        best = bestAddition(options, cost, minGap);
      }
      cands.push({ playerId: row.id, cost, best, ...display });
    });
    return tradeChips(cands, cfg.needs);
  });
}

/**
 * D2 (step 7 in the file header): whether chip `playerId` of team `ti` is still a chip once the chips in `taken`
 * have left that team: maxOther − cost(T − taken) ≥ chipMinGap, with maxOther his chip's and the cost his lineup
 * cost on T − taken by step 5's rules: ROS(V*(T − taken)) − ROS(V*(T − taken − i)), each the re-run from V*(T)'s
 * roster (optimizer.reoptimize) with one extra move per player gone (an exchange at the cap, as step 5 lets a team
 * replace a lost player; a player taken never comes back), in the lineup costs' mode, floored at 0; 0 when V*(T)
 * dropped him. Rosters are memoized by the optimizer.
 */
function chipsStayChips(ctx: LeagueContext, chipsAll: readonly (readonly TradeChip[])[], minGap: number): (ti: number, playerId: string, taken: readonly string[]) => boolean {
  return (ti, playerId, taken) => {
    const chip = (chipsAll[ti] ?? []).find((c) => c.playerId === playerId);
    const t = ctx.work[ti];
    if (!chip || !t) return false;
    const R = t.vstar.roster;
    let cost = 0;
    if (R.includes(playerId)) {
      const gone = new Set(taken);
      const start = R.filter((id) => !gone.has(id));
      const out = R.length - start.length;
      const before = ctx.optimizer.reoptimize(t.vstar, start, t.stream, out, taken);
      const after = ctx.optimizer.reoptimize(
        t.vstar,
        start.filter((id) => id !== playerId),
        t.stream,
        out + 1,
        [...taken, playerId],
      );
      cost = Math.max(0, rerunRos(ctx, t, before) - rerunRos(ctx, t, after));
    }
    return chip.maxOther - cost >= minGap - EPS;
  };
}

/**
 * The League model (see the file header). `snapshot.myTeamId` is the user's team (null = none picked);
 * `opts.now` decides which current-week games have started, and so whether the current week is in progress.
 */
export function buildLeagueModel(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueModel {
  return buildLeagueModelWithContext(snapshot, inputs, opts, cfg).model;
}

/** buildLeagueModel's result with what it was built from, for Phase 4's trade evaluation (evaluate.ts): steps 1–5 and step 6's bases. */
export interface LeagueModelBuild {
  model: LeagueModel;
  /** Steps 1–5: projections, scenarios, values, streaming, every team's lineups, V* and lineup costs. */
  context: LeagueContext;
  /** Step 6's bases for MV_add (teamBases; baseFor builds the position-limited ones when first needed). */
  bases: TeamBase[];
}

/**
 * buildLeagueModel, also returning the context and bases it was built from (LeagueModelBuild), so the trade evaluation
 * reuses every number the League model computed instead of building it twice. The model is the same object
 * buildLeagueModel returns.
 */
export function buildLeagueModelWithContext(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueModelBuild {
  const clock = opts.clock;
  const timings: Record<string, number> = {};
  const start = clock ? clock() : 0;
  let last = start;
  const mark = (stage: string) => {
    if (!clock) return;
    const t = clock();
    timings[stage] = (timings[stage] ?? 0) + (t - last);
    last = t;
  };
  const ctx = prepareLeague(snapshot, inputs, opts, cfg, mark);
  const { S, W, lp, tw, work, slots, index, instances, byTeam, streamed, stream } = ctx;
  const { weeks } = lp;

  // The weekly score the season simulator draws (step 8): T as it stands, its streaming rows included.
  const scores: WeeklyScore[] = work.map((t) => (t.scen ? scenarioScore(t.scen) : evScore(t.solved)));
  // The week in progress: its score with every game still to play (step 8; today's rosters and tags), its
  // streaming replacement before kickoff too (step 5a: the free agents at the streamed positions are rebuilt).
  const pre = preKickoffTable(snapshot, inputs, tw.inProgressWeek, opts, cfg, streamed);
  if (pre && W > 0) {
    const preStream = streamingRows(
      pre.table,
      ctx.freeAgentIds.filter((id) => pre.table.rows.has(id)),
      streamed,
      cfg,
    ).rows;
    work.forEach((t, ti) => {
      const rows = [...t.rows.flatMap((r) => pre.table.rows.get(r.id) ?? []), ...(byTeam[t.team.id]?.positions ?? []).flatMap((p) => preStream.get(p) ?? [])];
      const first = teamEval(rows, slots);
      const s = S > 0 ? scenarioScore(scenarioValues(first, 1, S, null, false, true)) : evScore(solveEvWeeks(first, 1));
      const score = scores[ti] as WeeklyScore;
      score.mean[0] = s.mean[0] as number;
      score.sd[0] = s.sd[0] as number;
    });
    mark("week in progress before kickoff");
  }

  // 6. Trade chips: each team's base B′ (from V*), then every candidate's best other team (the file header).
  const bases = teamBases(ctx);
  const chipsAll = tradeChipsAll(ctx, bases);
  mark("trade chips");

  // 7. Strength, needs, partners and surplus scores: over the weeks team numbers count (tw).
  const perWeek = work.map((t) => (t.scen?.instances ? t.scen.instances : evInstancePoints(t.solved, index)));
  const strengths = strengthTable(
    instances,
    perWeek.map((p) => windowAverage(p, tw.from, tw.from + tw.nNext, index.size)),
    perWeek.map((p) => windowAverage(p, tw.from, W, index.size)),
  );
  for (const t of work) {
    t.scores = surplusScores(
      t.rows.map((r) => ctx.valueOf(r.id)),
      t.rows.map((_, x) => costOf(t, x)),
    );
  }

  const myIndex = snapshot.myTeamId === null ? -1 : work.findIndex((t) => t.team.id === snapshot.myTeamId);
  const myTeamId = myIndex >= 0 ? (work[myIndex] as TeamWork).team.id : null;
  let partners: LeagueModel["partners"] = [];
  if (myIndex >= 0) {
    /** What one player adds to team `to`'s lineup per week, after its free-agent optimizer (V*), over every week team numbers count. */
    const gainOf = (to: number, playerId: string): number => {
      const row = ctx.table.rows.get(playerId);
      if (!row || (work[to] as TeamWork).team.roster.includes(playerId)) return 0;
      const mask = ctx.maskOf(row);
      const base = (work[to] as TeamWork).vstar.solved;
      if (addUpperBound(base, row, mask, tw.allWeights) <= EPS) return 0;
      return addGainExact(base, row, mask, tw.allWeights).gain;
    };
    /** What the players add to team `to`'s lineup together, per week (one lineup per week: players competing for one slot count once). */
    const jointGain = (to: number, ids: readonly string[]): number => {
      const rows = ids.flatMap((id) => {
        const row = ctx.table.rows.get(id);
        return row && !(work[to] as TeamWork).team.roster.includes(id) ? [row] : [];
      });
      return addRowsGain(
        (work[to] as TeamWork).vstar.solved,
        rows,
        rows.map((row) => ctx.maskOf(row)),
        tw.allWeights,
      );
    };
    // D2: a side counts only chips that stay chips together (step 7 in the file header).
    const stillChip = chipsStayChips(ctx, chipsAll, cfg.needs.chipMinGap);
    const maxPerSide = Number.isFinite(cfg.search.maxPerSide) ? Math.max(1, Math.floor(cfg.search.maxPerSide)) : 1;
    /** One side's chips with what each alone adds to team `to`, and the ones that count for the fit. */
    const side = (from: number, to: number): { players: PartnerPlayer[]; counted: string[] } => {
      const chips = chipsAll[from] ?? [];
      const players = chips.map((c) => ({ playerId: c.playerId, ppw: gainOf(to, c.playerId) }));
      const counted = chipsTogether(
        chips.map((c, i) => ({ playerId: c.playerId, ppw: (players[i] as PartnerPlayer).ppw, gap: c.gap })),
        maxPerSide,
        (playerId, taken) => stillChip(from, playerId, taken),
      );
      return { players, counted };
    };
    const cands: PartnerCandidate[] = work.flatMap((p, pi) => {
      if (pi === myIndex) return [];
      const theirs = side(pi, myIndex);
      const mine = side(myIndex, pi);
      return [{ teamId: p.team.id, theyCanGive: theirs.players, youCanGive: mine.players, get: jointGain(myIndex, theirs.counted), give: jointGain(pi, mine.counted) }];
    });
    partners = rankPartners(cands, cfg.needs);
  }

  const teams: TeamModel[] = work.map((t, ti) => {
    const strength = strengths[ti] ?? {};
    const players: Record<string, TeamPlayerValue> = {};
    t.rows.forEach((row, x) => {
      players[row.id] = {
        mvLoseEv: t.mvLoseEv[x] as number,
        mvLoseScen: t.mvLoseScen[x] ?? null,
        autoAdd: t.losses[x]?.moves[0]?.add ?? null,
        surplusScore: t.scores[x] as number,
      };
    });
    const score = scores[ti] as WeeklyScore;
    return {
      id: t.team.id,
      ev: lineupValues(t.solved.lv, tw, weeks),
      scen: t.scen ? { ...lineupValues(t.scen.mean, tw, weeks), sd: Array.from(t.scen.sd) } : null,
      strength,
      needs: findNeeds(strength, instances, cfg.lineups.needZThreshold),
      chips: chipsAll[ti] ?? [],
      players,
      faMoves: t.faMoves,
      score: { mean: Array.from(score.mean), sd: Array.from(score.sd) },
    };
  });

  const projection: ProjectionSummary = {
    espnAveraged: lp.espnAveraged,
    agreement: lp.agreement?.agreement ?? null,
    disagreements: lp.agreement?.disagreements ?? [],
    sources: baseRateSourceCounts(Object.values(lp.players)),
  };
  mark("needs and partners");

  const replacement: LeagueModel["streaming"]["replacement"] = {};
  for (const [pos, rep] of stream.replacement) replacement[pos] = Array.from(rep);
  const model: LeagueModel = {
    weeks: weeks.weeks,
    regularWeeks: weeks.regularWeeks,
    playoffWeeks: weeks.playoffWeeks,
    scenarios: S,
    playoffWeight: ctx.settings.playoffWeight,
    streaming: { byTeam, replacement, picks: ctx.picks },
    inProgressWeek: tw.inProgressWeek,
    players: lp.players,
    teams,
    myTeamId,
    slots: instances,
    partners,
    market: ctx.market,
    projection,
    odds: null,
    timings,
    warnings: modelWarnings(snapshot, inputs, lp, projection.sources, cfg),
  };

  // 8. The season simulation (§8): from every team's weekly score.
  const sims = opts.sims ?? cfg.simulation.finalSims;
  if (Number.isFinite(sims) && sims >= 1) {
    model.odds = simulate(snapshot, model, Math.floor(sims), opts.simSeed ?? cfg.simulation.seed, cfg);
    mark("season simulation");
  }

  // 9. The star premium (the file header): every rostered player's, for his own team, from the values and the odds.
  const odds = model.odds;
  const premiums = leaguePremiums(
    {
      snapshot,
      market: inputs.market,
      value: ctx.valueOf,
      ros: (id) => lp.players[id]?.ros.total ?? 0,
      pPlayoffs: (teamId) => odds?.teams.find((o) => o.teamId === teamId)?.pPlayoffs ?? null,
    },
    cfg.acceptance.starPremium,
  );
  for (const t of model.teams) t.premiums = premiums.get(t.id) ?? {};
  if (clock) timings.total = last - start;
  return { model, context: ctx, bases };
}

/**
 * The warning when the season simulator refuses the league's setup (simulate, below): plain and generic.
 * The simulator's own message is for developers (it names week numbers and team indexes), never the page.
 */
export const ODDS_REFUSED_WARNING = "The playoff odds couldn't be worked out from this league's schedule, so they're left out.";

/**
 * LeagueModel.odds (step 8). A season that can't be simulated although weeks remain (season.ts
 * oddsSkippedWarning: the rest of the schedule didn't load) has no odds, with that warning. The
 * simulator refuses a setup it can't decide (a RangeError; season.ts builds setups it accepts): the rest
 * of the model is still good, so the odds are left out with ODDS_REFUSED_WARNING instead of losing the
 * whole League page. The RangeError's message stays out of every user-facing text.
 */
function simulate(snapshot: LeagueSnapshot, model: LeagueModel, sims: number, seed: number, cfg: LeagueModelConfig): SeasonOdds | null {
  const skipped = oddsSkippedWarning(snapshot, model);
  if (skipped !== null) {
    model.warnings.push(skipped);
    return null;
  }
  try {
    return seasonOdds(snapshot, model, { sims, seed }, cfg);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    model.warnings.push(ODDS_REFUSED_WARNING);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Marginal values outside the model (scripts, tests, Phase 4's trade search)

/** V*(T) of a team: the roster after the free-agent optimizer, its moves, and its ROS in EV and scenario lineups (null without scenarios). */
export interface VStarSummary {
  roster: string[];
  moves: FaMove[];
  ev: number;
  scen: number | null;
}

/** A marginal value in ROS lineup points (§7), EV and scenario lineups (null without scenarios), unfloored. */
export interface MarginalValue {
  ev: number;
  scen: number | null;
}

export interface LeagueMarginals {
  /** The model's settings, weeks and scenario count the numbers come from. */
  readonly scenarios: number;
  /** V*(T) (step 5); null for an unknown team. */
  vStar(teamId: string): VStarSummary | null;
  /**
   * The free-agent optimizer from any active roster of a team (its streaming rows and streamed positions; the build's
   * optimizer and memo), with at most `maxMoves` moves (default faMaxMoves): the roster after, its moves with their EV
   * and scenario gains, and its ROS in EV and scenario lineups. A trade's "after" (lead decision L6) is this on the
   * roster after the trade. Null for an unknown team.
   */
  optimize(teamId: string, roster: readonly string[], maxMoves?: number): VStarSummary | null;
  /** MV_lose(T, i) as TeamModel.players has it (step 5: floored at 0, 0 when V*(T) dropped him); null when he isn't one of T's players with a model. */
  mvLose(teamId: string, playerId: string): (MarginalValue & { autoAdd: string | null }) | null;
  /**
   * MV_add(T′, j) as trade chips measure it (step 6: V*(T′) + j − the drop, the optimizer re-run from there with one
   * extra move, net of what its exchanges give back, against V*(T′); unfloored), with the player V*(T′) drops to make
   * room (at j's position when a position limit binds). Null when j has no model, is on T′'s roster, T′ is full with
   * nobody to drop, or j's position is at its limit with nobody there who can go.
   */
  mvAdd(teamId: string, playerId: string): (MarginalValue & { drop: string | null }) | null;
  /**
   * Why mvAdd is null: an unknown team or a player without a model, a player already on that team, a full V*(T′) with
   * nobody to drop, or a position at its limit on V*(T′) with nobody there who can be dropped (with the limit); null
   * when mvAdd has a value.
   */
  mvAddBlocked(teamId: string, playerId: string): { reason: "unknown" | "onTeam" | "full" } | { reason: "positionLimit"; pos: Pos; limit: number } | null;
}

/**
 * The marginal values behind the League model's lineup costs and trade chips, for any team and player (the report's
 * Bo Nix → Team 1 example; Phase 4's trade search): built from the same steps 1–5 and step 6's bases, so every
 * number equals the model's own (a chip's maxOther is the largest mvAdd over the other teams, floored at 0).
 */
export function leagueMarginals(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueMarginals {
  const ctx = prepareLeague(snapshot, inputs, opts, cfg, () => undefined);
  const bases = teamBases(ctx);
  const addValue = addValueOf(ctx);
  const indexOf = new Map(ctx.work.map((t, i) => [t.team.id, i]));
  const scen = ctx.S > 0;
  const blocked: LeagueMarginals["mvAddBlocked"] = (teamId, playerId) => {
    const ui = indexOf.get(teamId) ?? -1;
    const t = ctx.work[ui];
    const row = ctx.table.rows.get(playerId);
    if (!t || !row) return { reason: "unknown" };
    if (t.team.roster.includes(playerId)) return { reason: "onTeam" };
    if (!(bases[ui] as TeamBase).base) return { reason: "full" };
    if (!baseFor(ctx, bases, ui, row.pos)) return { reason: "positionLimit", pos: row.pos, limit: ctx.limits?.[row.pos] as number };
    return null;
  };
  return {
    scenarios: ctx.S,
    vStar(teamId) {
      const t = ctx.work[indexOf.get(teamId) ?? -1];
      return t ? { roster: [...t.vstar.roster], moves: t.faMoves.map((m) => ({ ...m })), ev: t.vstar.evRos, scen: t.vstarScen } : null;
    },
    mvLose(teamId, playerId) {
      const t = ctx.work[indexOf.get(teamId) ?? -1];
      const x = t ? t.rows.findIndex((r) => r.id === playerId) : -1;
      if (!t || x < 0) return null;
      return { ev: t.mvLoseEv[x] as number, scen: t.mvLoseScen[x] ?? null, autoAdd: t.losses[x]?.moves[0]?.add ?? null };
    },
    mvAdd(teamId, playerId) {
      if (blocked(teamId, playerId)) return null;
      const ui = indexOf.get(teamId) as number;
      const row = ctx.table.rows.get(playerId) as TableRow;
      const mask = ctx.maskOf(row);
      const base = baseFor(ctx, bases, ui, row.pos) as AddBase;
      return { ev: addValue(ui, base, row, mask, false), scen: scen ? addValue(ui, base, row, mask, true) : null, drop: base.drop };
    },
    mvAddBlocked: blocked,
    optimize(teamId, roster, maxMoves) {
      const t = ctx.work[indexOf.get(teamId) ?? -1];
      if (!t) return null;
      const run = ctx.optimizer.optimize(roster, t.stream, maxMoves);
      let at: readonly string[] = run.start;
      let ev = ctx.optimizer.evaluate(at, t.stream).evRos;
      let sc = scen ? ctx.scenRosOf(at, t.stream) : null;
      const moves = run.moves.map((m) => {
        at = applyStep(at, m);
        const nextEv = ctx.optimizer.evaluate(at, t.stream).evRos;
        const nextSc = scen ? ctx.scenRosOf(at, t.stream) : null;
        const move: FaMove = { add: m.add, drop: m.drop, gainEv: nextEv - ev, gainScen: nextSc !== null && sc !== null ? nextSc - sc : null };
        ev = nextEv;
        sc = nextSc;
        return move;
      });
      return { roster: [...run.roster], moves, ev: run.evRos, scen: sc };
    },
  };
}
