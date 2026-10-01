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
 *    were missing (sleeperUnavailable), not that Sleeper doesn't project him.
 * 4. Market values (§9, perception term) with the ROS totals feeding the estimate curve, and the waiver
 *    credit W (the best free agent's value, estimates included, at least waiverCreditMin).
 * 5. Per team (teamValue.ts): EV and scenario lineups, ROS (playoff weeks × playoffWeight), PPW, slot
 *    strength; for every active-roster player, T − i + fa_i with the free agent T − i would add (the
 *    largest EV ROS gain within position limits; the same one in both modes), and, when the active
 *    roster has an open spot (fewer players than maxRosterSize), T + the free agent T would add. Lineup
 *    costs are measured from V(T), the best of T and those rosters (teamValue.waiverAdjustment):
 *    MV_lose'(T, i) = V(T) − ROS(T − i + fa_i) ≥ 0, EV and scenario, and TeamModel.waiver is the best
 *    move (by scenario ROS when scenarios ran, else EV ROS). §7's ROS(T) − ROS(T − i + fa_i) went
 *    negative for every bench player whenever a free agent beat one of T's starters; the shift is a
 *    constant within the team, so surplus scores don't change. T_V is the team after that move (T itself
 *    when none helps). TeamModel.score, the weekly score the simulator draws (§8; teamValue.ts): with
 *    scenarios the scenario mean LV and sqrt(within-lineup variance + LV spread²), the law of total
 *    variance; without them the EV lineup's LV and sqrt(Σ σ²) of its starters.
 * 6. Trade chips (§7; answer 2): gap_i = maxOther_i − cost_i ≥ chipMinGap, all in ROS lineup points in the
 *    lineup costs' mode (scenario lineups when scenarios ran, else EV). cost_i = MV_lose'(own team, i).
 *    maxOther_i = the largest MV_add'(T′, i) over the other teams (ties: the smaller team id), with the
 *    free-agent-adjusted baseline of answer 1: MV_add'(T′, i) = ROS(T′_V + i − drop) − ROS(T′_V), floored
 *    at 0, where drop is the player T′_V drops to make room when its active roster is full (every id on
 *    team.roster takes a spot; the waiver move keeps the count, an open-spot move adds one): the one whose
 *    loss costs T′_V's lineup least, in the same lineup mode, with nobody refilling his spot (§7's keep
 *    value, marginal ROS contribution: teamValue.evRemovalCosts / scenarioRemovalCosts), among T′_V's
 *    players with a model, never the free agent just added (ties: the lower market value, then the smaller
 *    id; teamValue.lowestKeepValue). Not his lineup cost: that refills his spot with a free agent, so a
 *    starting kicker with a free agent almost as good would cost ~0 there, be the one dropped, and take all
 *    his points with him, leaving no chip a way to that team. The drop doesn't depend on i, so each team
 *    gets one base B′ = T′_V − drop and MV_add'(T′, i) = max(0, gain(B′, i) − (ROS(T′_V) − ROS(B′))). T′
 *    keeps its own best move after the trade (design C2), where §7 writes V(T′ + i − drop) − V(T′): the
 *    roster after the trade picks its move anew. §7's number is never lower with EV lineups (V picks its
 *    free agents by EV) and is higher when i makes T′'s move redundant (a QB-needy team whose best pickup
 *    is a free-agent QB then spends its one move elsewhere, and the trade is credited with that pickup;
 *    Checkpoint 3 lists it). B′ + i must respect positionLimits, else T′ is skipped for i. Candidates:
 *    active-roster players with a model whose position isn't in config.market.tradeSearchExcluded (P, K,
 *    DEF, IDP: excluded from trade search by default, §9); IR and taxi players aren't candidates in
 *    Phase 3. Chips need no market values. The search is exact and all pairs count, but only pairs whose
 *    bound (teamValue: the scenario or EV bound of adding a player) could reach the best value found, or
 *    make a chip at all, are solved (the bound is tight without starter limits, so that's about one team
 *    per chip candidate: Checkpoint 3 has the timings). Under starter limits nothing is bounded, so with
 *    scenarios the other teams are screened by their exact EV value and the best chipScreenTeams of them
 *    get scenario lineups. Chips are listed best gap first; equal gaps list the cheaper one to lose first
 *    (lead decision D3: EV lineups give a starter and the backup who covers him the same gap).
 * 7. needs.ts: strength z-scores across teams, needs, §12's surplus scores (kept for Phase 4's give pool),
 *    and my team's best trade partners from the chips: their chips that would start for me and mine that
 *    would start for them, over every week team numbers count, against the receiving team's T_V (EV
 *    lineups). The cards list every such chip with its own gain; each side's score counts only chips that
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
 *
 * Game days (Phase 2 review decisions; LeagueModel.inProgressWeek): once any game of the current week has
 * kicked off (inputs.nfl.kickoffs[currentWeek] at or before `now`), every team-level number skips that
 * week (teamWeeks): ROS(T) and the lineup costs, waiver move and trade chips built on it (ω = 0), PPW, both
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
 * the waiver move and for making room: one without projections isn't known to be worthless, so he is never
 * the one dropped (he still takes a roster spot). The keep value that picks the drop is his marginal ROS
 * contribution alone (step 6); §7's dynasty keep value (plus normalized market value) is Phase 4's
 * roster-legality work.
 */
import { config } from "./config";
import { expectedAvailability, returnDateConflict, scenarioAvailability, type AvailabilityConfig, type AvailabilityContext, type AvailabilityPlayer } from "./availability";
import type { ModelInputs, NflScheduleInputs, PlayerInputs } from "./inputs";
import type { AvailabilityNote, BaseRateSource, LeagueModel, LineupValues, PlayerModel, ProjectionSummary, SeasonOdds, TeamModel, TeamPlayerValue, TradeChip, WaiverMove } from "./leagueModel";
import { prepareLeagueSlots, type PreparedSlots } from "./lineup";
import { marketSummary, marketValues, valuesForTerm, waiverCredit, type MarketConfig } from "./market";
import type { LeagueSettings, LeagueSnapshot, PlayerInfo, Pos, Team } from "./model";
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
import { baseRateSourceCounts, espnSleeperAgreement, projectPlayer, staleReturnCheck, weeklySd, type BaseRateContext, type ProjectionConfig, type SourceAgreement } from "./projections";
import { oddsSkippedWarning, seasonOdds, type SeasonConfig } from "./season";
import {
  addGainExact,
  addRowsGain,
  addUpperBound,
  evInstancePoints,
  evRemovalCosts,
  evScore,
  lowestKeepValue,
  pickFreeAgent,
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
  teamEval,
  waiverAdjustment,
  weekWeights,
  windowWeights,
  type FreeAgentCandidate,
  type ProjectionTable,
  type RosterMove,
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
  /** ω per week for ROS(T), lineup costs, the waiver move and trade chips (weekWeights; 0 for the week in progress). */
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
    const pm = projectPlayer(id, info.pos, pin, availability, { ...baseCtx, regularWeeks: weeks.regularWeeks, playoffWeeks: weeks.playoffWeeks, byeWeek, started, hasTeam: team !== null }, cfg.projections);
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
 * projection table rebuilt for 1 ms before the week's earliest known kickoff. Rostered players only (free
 * agents don't change a team's score). A player's projection doesn't depend on the moment, and his
 * scenario draws depend only on the seed, his id and the scenario, so the table matches the one at
 * `opts.now` in every week but the first, where only the games that had kicked off come back. ⚠️ It is
 * not the week as it stood at kickoff: the snapshot's rosters and injury tags are today's (a tag added
 * after a player's game zeroes that game here, and a player moved since kickoff plays for his new team).
 * Null when `inProgressWeek` is null (LeagueModel.inProgressWeek) or its kickoffs are unknown.
 */
export function preKickoffTable(snapshot: LeagueSnapshot, inputs: ModelInputs, inProgressWeek: number | null, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): { now: Date; table: ProjectionTable } | null {
  if (inProgressWeek === null) return null;
  const first = firstKickoff(inputs.nfl, inProgressWeek);
  if (first === null) return null;
  const now = new Date(first - 1);
  const players = projectLeaguePlayers({ ...snapshot, freeAgents: [] }, inputs, now, cfg);
  return { now, table: projectionTable(players, scenarioCount(opts.scenarios ?? cfg.lineups.scenarios), opts.seed ?? cfg.lineups.scenarioSeed, cfg) };
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

/** A roster one move away from T (T − i + fa_i, or T + fa into an open spot): its ROS, EV and scenario, and the roster prepared. */
interface MoveWork {
  add: string | null;
  drop: string | null;
  evAfter: number;
  /** Filled in the scenario stage (null without scenarios). */
  scenAfter: number | null;
  after: TeamEval;
}

interface TeamWork {
  team: Team;
  /** Active-roster players with a model, in roster order. */
  rows: TableRow[];
  /** Positions of every active-roster player the snapshot knows, with a model or not: position limits count them all. */
  positions: Pos[];
  /** Active-roster size: every id on team.roster takes a spot, with a model or not. */
  size: number;
  evalT: TeamEval;
  /** EV lineups, week by week (kept for pricing added players). */
  solved: SolvedWeeks;
  /** ROS(T) with EV lineups, and with scenario lineups (null without scenarios). */
  evRos: number;
  scenRos: number | null;
  scen: ScenarioValues | null;
  /** Per active row: T − i + fa_i (drop = his id, add = the free agent T − i would add, or null). */
  losses: MoveWork[];
  /** T + the free agent T would add, when the active roster has an open spot and one helps; else null. */
  open: MoveWork | null;
  /** Per active row: MV_lose' = V(T) − ROS(T − i + fa_i), EV and scenario (settleLineupCosts). */
  mvLoseEv: number[];
  mvLoseScen: (number | null)[];
  waiver: WaiverMove | null;
  /** The roster `waiver` moves to (T_V), or null when no move helps (T_V = T). */
  move: MoveWork | null;
  scores: number[];
}

/** What evaluating one active roster needs (step 5): the weeks and their weights, the slots, the free agents and the limits. */
interface RosterContext {
  readonly W: number;
  readonly S: number;
  readonly weights: Float64Array;
  readonly slots: PreparedSlots;
  readonly candidates: readonly FreeAgentCandidate[];
  readonly limits: Partial<Record<Pos, number>> | undefined;
  readonly maxRosterSize: number;
  readonly valueOf: (id: string) => number;
}

/** T − rows[x] + fa_x (step 5): the free agent T − i would add, the largest EV ROS gain within position limits (EV ROS only). */
function lossMove(rows: readonly TableRow[], positions: readonly Pos[], x: number, rc: RosterContext): MoveWork {
  const { W, weights, slots, candidates, limits } = rc;
  const lost = rows[x] as TableRow;
  const minus = teamEval(
    rows.filter((_, i) => i !== x),
    slots,
  );
  const base = solveEvWeeks(minus, W);
  const left = withoutOne(positions, lost.pos);
  const pick = pickFreeAgent(base, candidates, weights, (row) => positionAllows(limits, left, row.pos));
  // ROS(T − i + fa) = ROS(T − i) + fa's gain; pick.team is T − i + fa, prepared.
  return { add: pick ? pick.row.id : null, drop: lost.id, evAfter: rosValue(base.lv, weights) + (pick ? pick.gain : 0), scenAfter: null, after: pick ? pick.team : minus };
}

/**
 * Step 5 with EV lineups for one active roster: T (its rows, the positions of every player on it and its
 * size, players without a model included), every T − i + fa_i and, with an open spot, T + fa.
 */
function rosterWork(team: Team, rows: TableRow[], positions: Pos[], size: number, rc: RosterContext): TeamWork {
  const { W, weights, slots, candidates, limits } = rc;
  const evalT = teamEval(rows, slots);
  const solved = solveEvWeeks(evalT, W);
  const evRos = rosValue(solved.lv, weights);
  const losses: MoveWork[] = rows.map((_, x) => lossMove(rows, positions, x, rc));
  // An open active-roster spot (every player on team.roster takes one, with a model or not): T + fa.
  const fa = size < rc.maxRosterSize ? pickFreeAgent(solved, candidates, weights, (row) => positionAllows(limits, positions, row.pos)) : null;
  const open: MoveWork | null = fa ? { add: fa.row.id, drop: null, evAfter: evRos + fa.gain, scenAfter: null, after: fa.team } : null;
  const zeros = () => rows.map(() => 0);
  return {
    team,
    rows,
    positions,
    size,
    evalT,
    solved,
    evRos,
    scenRos: null,
    scen: null,
    losses,
    open,
    mvLoseEv: zeros(),
    mvLoseScen: rows.map(() => null),
    waiver: null,
    move: null,
    scores: zeros(),
  };
}

/**
 * Step 5 with scenario lineups (when S > 0) of T and of every roster one move away (the same free agents),
 * then the lineup costs from V(T) and the waiver move (settleLineupCosts). `index` = the heatmap's slot
 * instances, for T's own strength, and `spread` its within-lineup variance, for its weekly score (both
 * only for the league's own teams: a roster priced for its lineup costs alone needs neither).
 */
function settleRoster(t: TeamWork, rc: RosterContext, index: InstanceIndex | null, spread: boolean): void {
  if (rc.S > 0) {
    t.scen = scenarioValues(t.evalT, rc.W, rc.S, index, false, spread);
    t.scenRos = rosValue(t.scen.mean, rc.weights);
    for (const m of [...t.losses, ...(t.open ? [t.open] : [])]) m.scenAfter = rosValue(scenarioValues(m.after, rc.W, rc.S).mean, rc.weights);
  }
  settleLineupCosts(t, rc.valueOf);
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

/** A lineup cost in the mode chips and drops read: scenario lineups when scenarios ran, else EV. */
function costOf(t: TeamWork, x: number): number {
  return t.mvLoseScen[x] ?? (t.mvLoseEv[x] as number);
}

/**
 * Lineup costs from V(T) and the team's best free-agent move (teamValue.waiverAdjustment; see the file
 * header, step 5), and the move itself (the roster T_V).
 */
function settleLineupCosts(t: TeamWork, valueOf: (id: string) => number): void {
  const all = [...t.losses, ...(t.open ? [t.open] : [])];
  const moves: RosterMove[] = all.map((m) => ({ add: m.add, drop: m.drop, ev: m.evAfter, scen: m.scenAfter }));
  const adj = waiverAdjustment({ ev: t.evRos, scen: t.scenRos }, moves, valueOf);
  t.mvLoseEv = t.losses.map((m) => adj.vEv - m.evAfter);
  t.mvLoseScen = t.losses.map((m) => (adj.vScen !== null && m.scenAfter !== null ? adj.vScen - m.scenAfter : null));
  const best = adj.best;
  const move = best && best.add !== null ? all[moves.indexOf(best)] : undefined;
  t.move = move ?? null;
  t.waiver =
    best && best.add !== null
      ? { add: best.add, drop: best.drop, gainEv: best.ev - t.evRos, gainScen: best.scen !== null && t.scenRos !== null ? best.scen - t.scenRos : null }
      : null;
}

/**
 * A team after its best free-agent move (T_V, §7 answer 1) and the base its trade-chip gains are priced
 * from (the file header, step 6).
 */
interface TeamV {
  /** T_V's EV lineups (partner fit). */
  solved: SolvedWeeks;
  /** B′ = T_V − the player it drops to make room when its active roster is full (the one whose loss costs its lineup least); null when it's full and nobody can be dropped. */
  base: AddBase | null;
}

interface AddBase {
  /** B′'s EV lineups, and its scenario lineups cell by cell (null without scenarios). */
  ev: SolvedWeeks;
  cells: ScenarioCells | null;
  /** ROS(T_V) − ROS(B′), EV and scenario: what making room costs (0 without a drop). */
  dropCostEv: number;
  dropCostScen: number;
  /** Positions on B′ (the newcomer must fit positionLimits). */
  positions: Pos[];
  /** The player T_V drops to make room, or null (an open spot). */
  drop: string | null;
}

/**
 * The base the trade-chip search adds a player to (TeamV). `posOf` is a modeled player's position (the
 * move's free agent and T's rows all have table rows).
 */
function teamV(t: TeamWork, W: number, S: number, weights: ArrayLike<number>, maxRosterSize: number, valueOf: (id: string) => number, posOf: (id: string) => Pos | undefined): TeamV {
  const m = t.move;
  const vEval = m ? m.after : t.evalT;
  const solved = m ? solveEvWeeks(m.after, W) : t.solved;
  const vCells = S > 0 ? scenarioValues(vEval, W, S, null, true).cells : null;
  // T_V's positions and size: the move swaps its drop for its add, or adds into an open spot.
  let positions = [...t.positions];
  if (m?.drop) {
    const pos = posOf(m.drop);
    if (pos) positions = withoutOne(positions, pos);
  }
  const addPos = m?.add ? posOf(m.add) : undefined;
  if (addPos) positions.push(addPos);
  const size = t.size + (m && m.drop === null ? 1 : 0);
  if (size < maxRosterSize) return { solved, base: { ev: solved, cells: vCells, dropCostEv: 0, dropCostScen: 0, positions, drop: null } };
  // A full roster drops the player whose loss costs T_V's lineup least, in the chips' lineup mode, with nobody
  // refilling his spot (the newcomer takes it): §7's keep value, marginal ROS contribution. Not his lineup cost,
  // which refills the spot with a free agent (the file header, step 6). Candidates: T_V's players with a model,
  // never the free agent just added.
  const removal = vCells ? scenarioRemovalCosts(vCells, weights) : evRemovalCosts(solved, weights);
  const drop = lowestKeepValue(vEval.rows.flatMap((r, k) => (r.id === m?.add ? [] : [{ id: r.id, keep: removal[k] as number, value: valueOf(r.id) }])));
  if (drop === null) return { solved, base: null };
  const dropPos = posOf(drop);
  if (dropPos) positions = withoutOne(positions, dropPos);
  const bEval = teamEval(
    vEval.rows.filter((r) => r.id !== drop),
    vEval.prep.slots,
  );
  const ev = solveEvWeeks(bEval, W);
  const scen = S > 0 ? scenarioValues(bEval, W, S, null, true) : null;
  // Both sides through the same lineup functions (T_V's EV lineups as solved above; its scenario ROS as the move
  // stage computed it), so a drop who never starts costs 0; differences under 1e-9 are float noise, 0.
  const vScenRos = m ? m.scenAfter : t.scenRos;
  const noise = (x: number) => (Math.abs(x) < EPS ? 0 : x);
  return {
    solved,
    base: {
      ev,
      cells: scen?.cells ?? null,
      dropCostEv: noise(rosValue(solved.lv, weights) - rosValue(ev.lv, weights)),
      dropCostScen: scen && vScenRos !== null ? noise(vScenRos - rosValue(scen.mean, weights)) : 0,
      positions,
      drop,
    },
  };
}

/** One other team a candidate could go to: its bound on MV_add' (+Infinity when nothing is bounded) and the exact value. */
interface AddOption {
  teamId: string;
  ub: number;
  exact: () => number;
}

/**
 * The largest MV_add' over `options` and its team (ties: the smaller team id), exactly, solving as few as
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

/**
 * The League model (see the file header). `snapshot.myTeamId` is the user's team (null = none picked);
 * `opts.now` decides which current-week games have started, and so whether the current week is in progress.
 */
export function buildLeagueModel(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: BuildLeagueModelOptions, cfg: LeagueModelConfig = config): LeagueModel {
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
  const S = scenarioCount(opts.scenarios ?? cfg.lineups.scenarios);
  const seed = opts.seed ?? cfg.lineups.scenarioSeed;

  // 1–3. Weeks, players, projections, scenarios; the weeks team numbers count (game days: the file header).
  const lp = projectLeaguePlayers(snapshot, inputs, opts.now, cfg);
  const { weeks } = lp;
  const W = weeks.weeks.length;
  const tw = teamWeeks(weeks, weekKickedOff(inputs.nfl, snapshot.currentWeek, opts.now.getTime()) ? snapshot.currentWeek : null, cfg.lineups);
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

  // 5. Teams: EV lineups, and every roster one move away (T − i + fa_i; T + fa into an open spot).
  const slots = prepareLeagueSlots(snapshot.settings);
  const instances = slotInstances(snapshot.settings.lineup);
  const index = instanceIndex(instances, slots);
  const masks = new Map<string, number>();
  for (const row of table.rows.values()) masks.set(row.id, slotMask(slots, row.pos, row.eligible));
  const maskOf = (row: TableRow) => masks.get(row.id) ?? 0;
  const candidates: FreeAgentCandidate[] = freeAgentIds.map((id) => {
    const row = table.rows.get(id) as TableRow;
    return { row, mask: maskOf(row) };
  });
  const limits = snapshot.settings.positionLimits;
  const maxRosterSize = snapshot.settings.maxRosterSize;
  const rc: RosterContext = { W, S, weights, slots, candidates, limits, maxRosterSize, valueOf };

  const work: TeamWork[] = snapshot.teams.map((team) => {
    const seen = new Set<string>();
    const rows: TableRow[] = [];
    // Positions of every active-roster player the snapshot knows, with a model or not: position limits count them all.
    const positions: Pos[] = [];
    for (const id of team.roster) {
      if (seen.has(id)) continue;
      seen.add(id);
      const info = snapshot.players[id];
      if (info) positions.push(info.pos);
      const row = table.rows.get(id);
      if (row) rows.push(row);
    }
    return rosterWork(team, rows, positions, seen.size, rc);
  });
  mark("EV lineups and marginal values");

  // 5. Teams: scenario lineups of T and of every roster one move away (the same free agents), then the
  // lineup costs from V(T) and the waiver move; the weekly score the season simulator draws (step 8).
  const scores: WeeklyScore[] = work.map((t) => {
    settleRoster(t, rc, index, true);
    return t.scen ? scenarioScore(t.scen) : evScore(t.solved);
  });
  if (S > 0) mark("scenario lineups and marginal values");
  // The week in progress: its score with every game still to play (step 8; today's rosters and tags).
  const pre = preKickoffTable(snapshot, inputs, tw.inProgressWeek, opts, cfg);
  if (pre && W > 0) {
    work.forEach((t, ti) => {
      const rows = t.rows.flatMap((r) => pre.table.rows.get(r.id) ?? []);
      const first = teamEval(rows, slots);
      const s = S > 0 ? scenarioScore(scenarioValues(first, 1, S, null, false, true)) : evScore(solveEvWeeks(first, 1));
      const score = scores[ti] as WeeklyScore;
      score.mean[0] = s.mean[0] as number;
      score.sd[0] = s.sd[0] as number;
    });
    mark("week in progress before kickoff");
  }

  // 6. Trade chips: each team's T_V and base B′, then every candidate's best other team (the file header).
  const posOf = (id: string) => table.rows.get(id)?.pos;
  const vs = work.map((t) => teamV(t, W, S, weights, maxRosterSize, valueOf, posOf));
  const excluded = new Set<Pos>(cfg.market.tradeSearchExcluded);
  const limited = slots.limits !== null;
  const minGap = cfg.needs.chipMinGap;
  const screenTeams = Number.isFinite(cfg.needs.chipScreenTeams) ? Math.max(1, Math.floor(cfg.needs.chipScreenTeams)) : 1;
  /** MV_add'(u, row) exactly, in the lineup costs' mode. */
  const addValue = (b: AddBase, row: TableRow, mask: number, scenario: boolean): number =>
    scenario ? scenarioAddGain(b.cells as ScenarioCells, row, mask, weights) - b.dropCostScen : addGainExact(b.ev, row, mask, weights).gain - b.dropCostEv;
  const chipsAll: TradeChip[][] = work.map((t, ti) => {
    const cands: ChipCandidate[] = [];
    t.rows.forEach((row, x) => {
      if (excluded.has(row.pos)) return;
      const mask = maskOf(row);
      const cost = costOf(t, x);
      const options: (AddOption & { base: AddBase })[] = [];
      work.forEach((u, ui) => {
        const base = (vs[ui] as TeamV).base;
        if (ui === ti || !base || u.team.roster.includes(row.id) || !positionAllows(limits, base.positions, row.pos)) return;
        const ub = S > 0 ? scenarioAddUpperBound(base.cells as ScenarioCells, row, mask, weights) - base.dropCostScen : addUpperBound(base.ev, row, mask, weights) - base.dropCostEv;
        options.push({ teamId: u.team.id, ub, exact: () => addValue(base, row, mask, S > 0), base });
      });
      let best: { value: number; teamId: string } | null;
      if (S > 0 && limited) {
        // Starter limits bound nothing: the best chipScreenTeams teams by exact EV value get scenario lineups.
        const screened = options
          .map((o) => ({ o, ev: Math.max(0, addValue(o.base, row, mask, false)) }))
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
      cands.push({ playerId: row.id, cost, best });
    });
    return tradeChips(cands, cfg.needs);
  });
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
      t.rows.map((r) => valueOf(r.id)),
      t.rows.map((_, x) => costOf(t, x)),
    );
  }

  const myIndex = snapshot.myTeamId === null ? -1 : work.findIndex((t) => t.team.id === snapshot.myTeamId);
  const myTeamId = myIndex >= 0 ? (work[myIndex] as TeamWork).team.id : null;
  let partners: LeagueModel["partners"] = [];
  if (myIndex >= 0) {
    /** What one player adds to team `to`'s lineup per week, after its best free-agent move, over every week team numbers count. */
    const gainOf = (to: number, playerId: string): number => {
      const row = table.rows.get(playerId);
      if (!row || (work[to] as TeamWork).team.roster.includes(playerId)) return 0;
      const mask = maskOf(row);
      const base = (vs[to] as TeamV).solved;
      if (addUpperBound(base, row, mask, tw.allWeights) <= EPS) return 0;
      return addGainExact(base, row, mask, tw.allWeights).gain;
    };
    /** What the players add to team `to`'s lineup together, per week (one lineup per week: players competing for one slot count once). */
    const jointGain = (to: number, ids: readonly string[]): number => {
      const rows = ids.flatMap((id) => {
        const row = table.rows.get(id);
        return row && !(work[to] as TeamWork).team.roster.includes(id) ? [row] : [];
      });
      return addRowsGain(
        (vs[to] as TeamV).solved,
        rows,
        rows.map((row) => maskOf(row)),
        tw.allWeights,
      );
    };
    // D2: a side counts only chips that stay chips together (step 7 in the file header).
    const stillChip = chipsStayChips(work, chipsAll, rc, posOf, minGap);
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
        autoAdd: t.losses[x]?.add ?? null,
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
      waiver: t.waiver,
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

  const model: LeagueModel = {
    weeks: weeks.weeks,
    regularWeeks: weeks.regularWeeks,
    playoffWeeks: weeks.playoffWeeks,
    scenarios: S,
    inProgressWeek: tw.inProgressWeek,
    players: lp.players,
    teams,
    myTeamId,
    slots: instances,
    partners,
    market,
    projection,
    odds: null,
    timings,
    warnings: modelWarnings(snapshot, inputs, lp, projection.sources, cfg),
  };

  // 8. The season simulation (§8): last, from every team's weekly score.
  const sims = opts.sims ?? cfg.simulation.finalSims;
  if (Number.isFinite(sims) && sims >= 1) {
    model.odds = simulate(snapshot, model, Math.floor(sims), opts.simSeed ?? cfg.simulation.seed, cfg);
    mark("season simulation");
  }
  if (clock) timings.total = last - start;
  return model;
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

/**
 * D2 (step 7 in the file header): whether chip `playerId` of team `ti` is still a chip once the chips in
 * `taken` have left that team: maxOther − cost(T − taken) ≥ chipMinGap, with maxOther his chip's and the
 * cost his lineup cost on T − taken, by the same rules as TeamModel.chips' cost (step 5 on that roster:
 * V(T − taken) − ROS(T − taken − i + fa_i), scenario lineups when scenarios ran, else EV).
 *
 * Exact, and cheap where it can be. The cost is V(T − taken) − ROS(T − taken − i + fa_i), and V (the best
 * ROS one move away) is bounded without solving every move: below by T − taken itself and by T − taken
 * plus the free agent its open spot would take (two of the rosters V is the best of, priced with step 5's
 * own arithmetic); above, without starter limits, by T − taken plus the largest bound on any free agent's
 * gain (teamValue's add bounds; more players never lower a lineup, so no roster one move away beats
 * T − taken plus its free agent). A cost bound that already decides the cut decides it; only a cut between
 * the two bounds runs step 5 on T − taken for the exact cost. Rosters are memoized.
 */
function chipsStayChips(
  work: readonly TeamWork[],
  chipsAll: readonly (readonly TradeChip[])[],
  rc: RosterContext,
  posOf: (id: string) => Pos | undefined,
  minGap: number,
): (ti: number, playerId: string, taken: readonly string[]) => boolean {
  /**
   * T − taken: its rows, positions and size; its ROS and the bounds on V (in the lineup costs' mode, each
   * computed when first needed); each row's ROS(T − taken − i + fa_i); the exact costs once needed.
   */
  interface Without {
    team: Team;
    rows: TableRow[];
    positions: Pos[];
    size: number;
    evalW: TeamEval;
    solved: SolvedWeeks;
    evRos: number;
    ros: number;
    low: number | null;
    high: number | null;
    after: Map<string, number>;
    costs: Map<string, number> | null;
  }
  const memo = new Map<string, Without>();
  const scenRos = (team: TeamEval): number => rosValue(scenarioValues(team, rc.W, rc.S).mean, rc.weights);
  const without = (ti: number, taken: readonly string[]): Without => {
    const key = `${ti}\u0000${[...taken].sort(byId).join("\u0000")}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const t = work[ti] as TeamWork;
    const gone = new Set(taken);
    const rows = t.rows.filter((r) => !gone.has(r.id));
    let positions = t.positions;
    for (const id of taken) {
      const pos = posOf(id);
      if (pos) positions = withoutOne(positions, pos);
    }
    const evalW = teamEval(rows, rc.slots);
    const solved = solveEvWeeks(evalW, rc.W);
    const evRos = rosValue(solved.lv, rc.weights);
    const w: Without = { team: t.team, rows, positions, size: t.size - (t.rows.length - rows.length), evalW, solved, evRos, ros: rc.S > 0 ? scenRos(evalW) : evRos, low: null, high: null, after: new Map(), costs: null };
    memo.set(key, w);
    return w;
  };
  /** V ≥ the best of T − taken and its open-spot move (two of V's rosters, priced as rosterWork and settleRoster price them). */
  const lowOf = (w: Without): number => {
    if (w.low === null) {
      const fa = w.size < rc.maxRosterSize ? pickFreeAgent(w.solved, rc.candidates, rc.weights, (row) => positionAllows(rc.limits, w.positions, row.pos)) : null;
      w.low = fa ? Math.max(w.ros, rc.S > 0 ? scenRos(fa.team) : w.evRos + fa.gain) : w.ros;
    }
    return w.low;
  };
  /** V ≤ ROS(T − taken) + the largest bound on a free agent's gain; +Infinity under starter limits (nothing bounded). */
  const highOf = (w: Without): number => {
    if (w.high === null) {
      if (rc.slots.limits !== null) w.high = Number.POSITIVE_INFINITY;
      else {
        const cells = rc.S > 0 ? (scenarioValues(w.evalW, rc.W, rc.S, null, true).cells as ScenarioCells) : null;
        let gain = 0;
        for (const c of rc.candidates) {
          const ub = cells ? scenarioAddUpperBound(cells, c.row, c.mask, rc.weights) : addUpperBound(w.solved, c.row, c.mask, rc.weights);
          if (ub > gain) gain = ub;
        }
        // EPS keeps the bound above V through float rounding (a bound can equal the exact gain).
        w.high = w.ros + gain + EPS;
      }
    }
    return w.high;
  };
  return (ti, playerId, taken) => {
    const chip = (chipsAll[ti] ?? []).find((c) => c.playerId === playerId);
    if (!chip) return false;
    const w = without(ti, taken);
    const x = w.rows.findIndex((r) => r.id === playerId);
    if (x < 0) return false;
    let after = w.after.get(playerId);
    if (after === undefined) {
      const m = lossMove(w.rows, w.positions, x, rc);
      after = rc.S > 0 ? scenRos(m.after) : m.evAfter;
      w.after.set(playerId, after);
    }
    // Cheapest first: a cost bound that already decides the cut decides it.
    if (chip.maxOther - (w.ros - after) < minGap - EPS) return false;
    if (chip.maxOther - (lowOf(w) - after) < minGap - EPS) return false;
    if (chip.maxOther - (highOf(w) - after) >= minGap - EPS) return true;
    if (!w.costs) {
      const exact = rosterWork(w.team, w.rows, w.positions, w.size, rc);
      settleRoster(exact, rc, null, false);
      w.costs = new Map(exact.rows.map((r, k) => [r.id, costOf(exact, k)]));
    }
    const cost = w.costs.get(playerId);
    return cost !== undefined && chip.maxOther - cost >= minGap - EPS;
  };
}
