/**
 * The League model (CLAUDE.md §6, §7, §9 and §14 "League"; planner reply to Checkpoint 1, additions A–C):
 * buildLeagueModel turns a LeagueSnapshot and its ModelInputs into the LeagueModel (src/engine/
 * leagueModel.ts) that the League page's Web Worker and the checkpoint report show. Pure and
 * deterministic: no I/O; the moment the model is for (`now`), the scenario seed and an optional clock
 * (stage timings only) are passed in, and every tunable number comes from config.
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
 *    scenario, never on his team).
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
 *    constant within the team, so surplus scores don't change.
 * 6. needs.ts: strength z-scores across teams, needs, "would start for" counts (mvAddPpw over the next
 *    strengthWeeks against every other team), surplus scores and surplus players (depth: a lineup cost
 *    below the roster's average too, surplusMaxCostZ), and my team's best trade partners (each side
 *    scored by its joint gain over every remaining week: all of their helpful surplus added to my roster
 *    at once, one lineup solve per week, and mine to theirs; the cards list each player's own gain).
 *    Without trade values (inputs.market null) nothing is surplus and there are no partners, with a
 *    warning: surplus is "high value, low lineup cost" (§7), and lineup cost alone would pick backup
 *    kickers. For the same reason a roster whose players all have the same value (all at the value
 *    floor) has no surplus. Timings only when opts.clock is given.
 *
 * Game days (Phase 2 review decisions; LeagueModel.inProgressWeek): once any game of the current week has
 * kicked off (inputs.nfl.kickoffs[currentWeek] at or before `now`), every team-level number skips that
 * week (teamWeeks): ROS(T) and the lineup costs and waiver move built on it (ω = 0), PPW, both strength
 * windows (they start the week after), needs, "would start for" and partner fit. Its lineups are locking
 * and its points are being scored, so a week whose early games are over would say more about kickoff
 * times than about teams (a team whose starters played Thursday would look weak all weekend). Its per-week
 * LV is still computed and reported, a partial week (the players whose games haven't started), so every
 * per-week array stays aligned with LeagueModel.weeks; players' own weekly points and ROS points still
 * count their games that haven't started.
 *
 * Choices the spec leaves open (Checkpoint 2 lists them): TeamModel.surplus holds the first
 * surplusShown surplus players, while partner fit reads every surplus player; TeamModel.players covers
 * the active-roster players with a model; Need.slot is a slot instance key (LeagueModel.slots). Only
 * players with a model are drop candidates for the waiver move: one without projections isn't known to
 * be worthless, so he is never the one dropped (he still takes a roster spot).
 */
import { config } from "./config";
import { expectedAvailability, scenarioAvailability, type AvailabilityConfig, type AvailabilityContext } from "./availability";
import type { ModelInputs, NflScheduleInputs } from "./inputs";
import type { BaseRateSource, LeagueModel, LineupValues, PlayerModel, ProjectionSummary, TeamModel, TeamPlayerValue, WaiverMove } from "./leagueModel";
import { prepareLeagueSlots } from "./lineup";
import { marketSummary, marketValues, valuesForTerm, waiverCredit, type MarketConfig } from "./market";
import type { LeagueSettings, LeagueSnapshot, PlayerInfo, Pos, Team } from "./model";
import {
  findNeeds,
  helpfulPlayers,
  instanceIndex,
  qualifyingSurplus,
  rankPartners,
  slotInstances,
  standardize,
  strengthTable,
  surplusScores,
  windowAverage,
  type PartnerCandidate,
  type PartnerPlayer,
} from "./needs";
import { baseRateSourceCounts, espnSleeperAgreement, projectPlayer, type ProjectionConfig, type SourceAgreement } from "./projections";
import {
  addGainExact,
  addRowsGain,
  addUpperBound,
  evInstancePoints,
  pickFreeAgent,
  positionAllows,
  ppw,
  rosValue,
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
  type ScenarioValues,
  type SolvedWeeks,
  type TableRow,
  type TeamEval,
} from "./teamValue";

/** Gains closer than this are zero (float noise, not a tunable). */
const EPS = 1e-9;

/** The config keys the League model reads, widened from config's `as const` literals so tests and calibration can vary them. */
export interface LeagueModelConfig {
  readonly projections: ProjectionConfig & AvailabilityConfig;
  readonly market: MarketConfig;
  readonly lineups: {
    readonly playoffWeight: number;
    readonly needZThreshold: number;
    readonly strengthWeeks: number;
    readonly scenarios: number;
    readonly scenarioSeed: number;
  };
  readonly needs: {
    readonly surplusMinScore: number;
    readonly surplusMaxCostZ: number;
    readonly surplusStartMinPpw: number;
    readonly surplusShown: number;
    readonly needsShown: number;
    readonly partnersShown: number;
  };
}

export interface BuildLeagueModelOptions {
  /** The moment the model is for: a game that kicked off at or before it is no longer a game left. */
  now: Date;
  /** Availability scenarios per lineup evaluation (default config.lineups.scenarios; 0 = expected-value lineups only). */
  scenarios?: number;
  /** Scenario seed (default config.lineups.scenarioSeed). */
  seed?: number;
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
  /** ω per week for ROS(T), lineup costs and the waiver move (weekWeights; 0 for the week in progress). */
  weights: Float64Array;
  /** The regular-season weeks PPW averages (the week in progress left out; none left → PPW 0). */
  regularWeeks: number[];
  /** Weeks in the "next" strength window: strengthWeeks, or fewer when fewer are left from `from`. */
  nNext: number;
  /** Equal weights over the next nNext weeks from `from` ("would start for") and over every week from `from` (partner fit). */
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

/** Players, projections and the projection table (steps 1–3), before scenarios are drawn. */
export interface LeaguePlayers {
  weeks: LeagueWeeks;
  /** Relevant players with a model (LeagueModel.players, values still null). */
  players: Record<string, PlayerModel>;
  /** Availability context per modeled player (scenario draws reuse it). */
  contexts: Map<string, { info: PlayerInfo; ctx: AvailabilityContext }>;
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
  const contexts = new Map<string, { info: PlayerInfo; ctx: AvailabilityContext }>();
  const skipped = { rostered: [] as string[], freeAgents: [] as string[] };
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
    const availability = expectedAvailability(info, info.pos, ctx, cfg.projections);
    players[id] = projectPlayer(
      id,
      info.pos,
      pin,
      availability,
      { currentWeek, weeks: weeks.weeks, espnAveraged, regularWeeks: weeks.regularWeeks, playoffWeeks: weeks.playoffWeeks, byeWeek, started, hasTeam: team !== null },
      cfg.projections,
    );
    contexts.set(id, { info, ctx });
  }
  return { weeks, players, contexts, relevant, skipped, agreement, espnAveraged };
}

/**
 * The projection table (teamValue.ts) from projected players: conditional points b·m_w, expected points
 * p_w and, when S > 0, S availability scenarios for active-roster players and free agents (streamFor
 * (seed, playerId, s): the same flags whichever team he is on).
 */
export function projectionTable(lp: LeaguePlayers, S: number, seed: number, cfg: LeagueModelConfig = config): ProjectionTable {
  const rows = new Map<string, TableRow>();
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  const freeAgents = new Set(lp.relevant.freeAgents);
  for (const [id, pm] of Object.entries(lp.players)) {
    const c = lp.contexts.get(id);
    if (!c) continue;
    const drawn = scenarios > 0 && (lp.relevant.active.has(id) || freeAgents.has(id));
    rows.set(id, {
      id,
      pos: c.info.pos,
      eligible: c.info.eligible,
      cond: Float64Array.from(pm.weekly, (w) => pm.base.b * w.m),
      ev: Float64Array.from(pm.weekly, (w) => w.p),
      flags: drawn ? scenarioAvailability(id, c.info, c.info.pos, c.ctx, scenarios, seed, cfg.projections) : null,
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

// ---------------------------------------------------------------------------------------------
// Warnings

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function nameList(ids: readonly string[], snapshot: LeagueSnapshot, max = 5): string {
  const names = ids.slice(0, max).map((id) => snapshot.players[id]?.name ?? id);
  return `${names.join(", ")}${ids.length > max ? ", …" : ""}`;
}

/** The trade-values warning (no FantasyCalc values: no surplus, no partners). */
export const NO_TRADE_VALUES_WARNING = "Surplus players and trade partners need trade values, so none are picked until FantasyCalc's values load.";

/**
 * Plain-English notes about gaps, worded from what actually loaded. The ESPN/Sleeper note (ESPN leagues
 * whose projections weren't averaged) follows the base-rate sources (`sources`): which projections the
 * numbers use, and it says the two were compared only when they were. Nothing about projections once no
 * week is left to project.
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
  if (weeksLeft && !inputs.market) out.push(NO_TRADE_VALUES_WARNING);
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
  evalT: TeamEval;
  /** EV lineups, week by week (kept for pricing added players). */
  solved: SolvedWeeks;
  /** ROS(T) with EV lineups. */
  evRos: number;
  scen: ScenarioValues | null;
  /** Per active row: T − i + fa_i (drop = his id, add = the free agent T − i would add, or null). */
  losses: MoveWork[];
  /** T + the free agent T would add, when the active roster has an open spot and one helps; else null. */
  open: MoveWork | null;
  /** Per active row: MV_lose' = V(T) − ROS(T − i + fa_i), EV and scenario (settleLineupCosts). */
  mvLoseEv: number[];
  mvLoseScen: (number | null)[];
  waiver: WaiverMove | null;
  startsFor: number[];
  scores: number[];
  /** z(MV_lose) within the roster, per active row (the surplus cost cut). */
  costZ: number[];
  /** Whether the roster's market values tell its players apart (trade values loaded and not all equal): surplus needs them. */
  valued: boolean;
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
 * Lineup costs from V(T) and the team's best free-agent move (teamValue.waiverAdjustment; see the file
 * header, step 5). `scenRos` is ROS(T) with scenario lineups (null without scenarios).
 */
function settleLineupCosts(t: TeamWork, scenRos: number | null, valueOf: (id: string) => number): void {
  const moves: RosterMove[] = [...t.losses, ...(t.open ? [t.open] : [])].map((m) => ({ add: m.add, drop: m.drop, ev: m.evAfter, scen: m.scenAfter }));
  const adj = waiverAdjustment({ ev: t.evRos, scen: scenRos }, moves, valueOf);
  t.mvLoseEv = t.losses.map((m) => adj.vEv - m.evAfter);
  t.mvLoseScen = t.losses.map((m) => (adj.vScen !== null && m.scenAfter !== null ? adj.vScen - m.scenAfter : null));
  const best = adj.best;
  t.waiver =
    best && best.add !== null
      ? { add: best.add, drop: best.drop, gainEv: best.ev - t.evRos, gainScen: best.scen !== null && scenRos !== null ? best.scen - scenRos : null }
      : null;
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
  const valuePlayers = modelIds.map((id) => ({ id, pos: (lp.contexts.get(id) as { info: PlayerInfo }).info.pos }));
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
  // Surplus is "high value, low lineup cost" (§7): without any trade values it can't be picked (a warning says so).
  const hasValues = Boolean(inputs.market);
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
    const evalT = teamEval(rows, slots);
    const solved = solveEvWeeks(evalT, W);
    const evRos = rosValue(solved.lv, weights);
    const losses: MoveWork[] = rows.map((lost, x) => {
      const minus = teamEval(
        rows.filter((_, i) => i !== x),
        slots,
      );
      const base = solveEvWeeks(minus, W);
      const left = withoutOne(positions, lost.pos);
      const pick = pickFreeAgent(base, candidates, weights, (row) => positionAllows(limits, left, row.pos));
      // ROS(T − i + fa) = ROS(T − i) + fa's gain; pick.team is T − i + fa, prepared.
      return { add: pick ? pick.row.id : null, drop: lost.id, evAfter: rosValue(base.lv, weights) + (pick ? pick.gain : 0), scenAfter: null, after: pick ? pick.team : minus };
    });
    // An open active-roster spot (every player on team.roster takes one, with a model or not): T + fa.
    const fa = seen.size < maxRosterSize ? pickFreeAgent(solved, candidates, weights, (row) => positionAllows(limits, positions, row.pos)) : null;
    const open: MoveWork | null = fa ? { add: fa.row.id, drop: null, evAfter: evRos + fa.gain, scenAfter: null, after: fa.team } : null;
    const zeros = () => rows.map(() => 0);
    return { team, rows, evalT, solved, evRos, scen: null, losses, open, mvLoseEv: zeros(), mvLoseScen: rows.map(() => null), waiver: null, startsFor: zeros(), scores: zeros(), costZ: zeros(), valued: false };
  });
  mark("EV lineups and marginal values");

  // 5. Teams: scenario lineups of T and of every roster one move away (the same free agents), then the
  // lineup costs from V(T) and the waiver move.
  for (const t of work) {
    let scenRos: number | null = null;
    if (S > 0) {
      t.scen = scenarioValues(t.evalT, W, S, index);
      scenRos = rosValue(t.scen.mean, weights);
      for (const m of [...t.losses, ...(t.open ? [t.open] : [])]) m.scenAfter = rosValue(scenarioValues(m.after, W, S).mean, weights);
    }
    settleLineupCosts(t, scenRos, valueOf);
  }
  if (S > 0) mark("scenario lineups and marginal values");

  // 6. Strength, needs, "would start for", surplus, partners: over the weeks team numbers count (tw).
  const perWeek = work.map((t) => (t.scen?.instances ? t.scen.instances : evInstancePoints(t.solved, index)));
  const strengths = strengthTable(
    instances,
    perWeek.map((p) => windowAverage(p, tw.from, tw.from + tw.nNext, index.size)),
    perWeek.map((p) => windowAverage(p, tw.from, W, index.size)),
  );
  const threshold = cfg.needs.surplusStartMinPpw;
  work.forEach((t, ti) => {
    t.rows.forEach((row, x) => {
      const mask = maskOf(row);
      let count = 0;
      work.forEach((u, ui) => {
        if (ui === ti || u.team.roster.includes(row.id)) return;
        if (addUpperBound(u.solved, row, mask, tw.nextWeights) < threshold - EPS) return;
        if (addGainExact(u.solved, row, mask, tw.nextWeights).gain >= threshold - EPS) count++;
      });
      t.startsFor[x] = count;
    });
    const costs = t.rows.map((_, x) => t.mvLoseScen[x] ?? (t.mvLoseEv[x] as number));
    const rowValues = t.rows.map((r) => valueOf(r.id));
    t.scores = surplusScores(rowValues, costs);
    t.costZ = standardize(costs);
    t.valued = hasValues && standardize(rowValues).some((z) => z !== 0);
  });
  // Surplus needs values that tell a roster's players apart: with none (FantasyCalc down) or all equal, z(value) is 0
  // for everyone and the score would be lineup cost alone.
  const surplusAll = work.map((t) =>
    t.valued
      ? qualifyingSurplus(
          t.rows.map((r, x) => ({ playerId: r.id, score: t.scores[x] as number, costZ: t.costZ[x] as number, startsFor: t.startsFor[x] as number })),
          cfg.needs,
        )
      : [],
  );

  const myIndex = snapshot.myTeamId === null ? -1 : work.findIndex((t) => t.team.id === snapshot.myTeamId);
  const myTeamId = myIndex >= 0 ? (work[myIndex] as TeamWork).team.id : null;
  let partners: LeagueModel["partners"] = [];
  if (myIndex >= 0 && hasValues) {
    const me = work[myIndex] as TeamWork;
    /** What one player adds to `to`'s lineup per week, over every week team numbers count. */
    const gainOf = (to: TeamWork, playerId: string): number => {
      const row = table.rows.get(playerId);
      if (!row || to.team.roster.includes(playerId)) return 0;
      const mask = maskOf(row);
      if (addUpperBound(to.solved, row, mask, tw.allWeights) <= EPS) return 0;
      return addGainExact(to.solved, row, mask, tw.allWeights).gain;
    };
    /** What the helpful players add to `to`'s lineup together, per week (one lineup per week: players competing for one slot count once). */
    const jointGain = (to: TeamWork, players: readonly PartnerPlayer[]): number => {
      const rows = helpfulPlayers(players).flatMap((x) => {
        const row = table.rows.get(x.playerId);
        return row && !to.team.roster.includes(x.playerId) ? [row] : [];
      });
      return addRowsGain(
        to.solved,
        rows,
        rows.map((row) => maskOf(row)),
        tw.allWeights,
      );
    };
    const cands: PartnerCandidate[] = work.flatMap((p, pi) => {
      if (pi === myIndex) return [];
      const theyCanGive = (surplusAll[pi] ?? []).map((s) => ({ playerId: s.playerId, ppw: gainOf(me, s.playerId) }));
      const youCanGive = (surplusAll[myIndex] ?? []).map((s) => ({ playerId: s.playerId, ppw: gainOf(p, s.playerId) }));
      return [{ teamId: p.team.id, theyCanGive, youCanGive, get: jointGain(me, theyCanGive), give: jointGain(p, youCanGive) }];
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
        startsFor: t.startsFor[x] as number,
      };
    });
    return {
      id: t.team.id,
      ev: lineupValues(t.solved.lv, tw, weeks),
      scen: t.scen ? { ...lineupValues(t.scen.mean, tw, weeks), sd: Array.from(t.scen.sd) } : null,
      strength,
      needs: findNeeds(strength, instances, cfg.lineups.needZThreshold),
      surplus: (surplusAll[ti] ?? []).slice(0, Math.max(0, Math.floor(cfg.needs.surplusShown))),
      players,
      waiver: t.waiver,
    };
  });

  const projection: ProjectionSummary = {
    espnAveraged: lp.espnAveraged,
    agreement: lp.agreement?.agreement ?? null,
    disagreements: lp.agreement?.disagreements ?? [],
    sources: baseRateSourceCounts(Object.values(lp.players)),
  };
  mark("needs, surplus and partners");
  if (clock) timings.total = last - start;

  return {
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
    timings,
    warnings: modelWarnings(snapshot, inputs, lp, projection.sources, cfg),
  };
}
