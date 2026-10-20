/**
 * The free-agent optimizer V*(X) (CLAUDE.md §7 "Free-agent-optimized baseline everywhere a trade is scored";
 * planner reply to Checkpoint 3, model change 2; Phase 4 lead decision L2). Pure and deterministic: no I/O,
 * no clock, no randomness; every tunable number comes from config.freeAgentOptimizer and config.streaming.
 *
 * From an active roster X it repeatedly applies the best free-agent move while that move raises the roster's
 * rest-of-season lineup points by at least faMinGain, at most faMaxMoves moves. Lineup points are EV ROS (scenario ROS
 * when optimize() judges in scenario lineups: "Judging moves in scenario lineups" below):
 * Σ_w ω_w LV_w with expected-value lineups over the weeks team numbers count (the caller's weights: the
 * League model's ω in the playoff weeks, league.ts step 5c; a week in progress at 0), the team's streaming rows included (teamValue.ts).
 * - A move adds one free agent: into an open active-roster spot (X has fewer than maxRosterSize players;
 *   every id on the roster takes a spot, with a model or not), or for a droppable player k (X − k + the best
 *   free agent for X − k).
 * - The best move has the largest exact EV gain. Ties (within 1e-9): an open spot first (nobody is lost),
 *   then the lower market value dropped (keep the more valuable player), then the smaller ids (the drop, then
 *   the add): Phase 2's waiver ties.
 * - ⚠️ Near-ties in whom a move cuts (verification of the final review of Phase 4c, finding VF-1; ours: roster legality's
 *   rule for forced drops, evaluate.ts dropOrder, applied to the drops this optimizer chooses; OptimizerSetup.dropNearTie
 *   and dropValueFloor). The trade evaluation counts my free-agent moves after a trade in my market term and the card names
 *   them (evaluate.ts freeAgentMovesOf), so whom a move cuts costs trade value, not only lineup points. With dropNearTie
 *   above 0 (league.ts: config.lineups.dropNearTieWeekly × the weeks' weights, ROS points; 0 with long-term values, as
 *   legality's keep values read them): when the best move above cuts a player worth more than dropValueFloor (the waiver
 *   credit W; every package counts a player worth at most W at W), the move made is its free agent for whichever droppable
 *   player (the rules above) is worth least, values floored at W, among those whose swap gains at least the best move's
 *   gain − dropNearTie and more than 0 (ties: the larger gain, then the ties above). Its free agent is always the best
 *   move's: then which free agents a run adds depends only on the best moves, so greedy determinism ("The pool" below)
 *   holds as before (a near-tie among different free agents would let one a run never adds change its moves). The swap
 *   may gain less than faMinGain: the best move decides that a pickup is worth making, the near-tie only whom it cuts.
 *   Between drops worth at most W the gain decides, as without the tolerance; an open-spot add never gives way (it cuts
 *   nobody). Exact: the best move is found as above, then its free agent is priced for each cheaper droppable player
 *   (scenario-judged runs prune by the swap bounds below at that bar). On Parker's league (Oct 4 09:24Z) Bo Nix → Jadarian
 *   Price had my V*(after) pick up Malik Willis for Josh Allen's week-7 bye and cut Kyle Monangai (worth [value] > W [value])
 *   where cutting Marvin Harrison Jr. ([value]) cost 0.09 ROS points: the card said to drop Monangai and my market term charged
 *   him; now the move cuts Harrison (and the next one, the baseline's Malik Washington, Rico Dowdle), the roster Rico
 *   Dowdle + Bo Nix → Jadarian Price leaves, and the trade reads the same g_mkt(me). ⚠️ So each move can give up to
 *   dropNearTie ROS points (0.2 a week on Parker's league) to keep a player's trade value.
 * - Free-agent candidates: the free agents with a model that aren't on the roster, not at
 *   config.streaming.optimizerExcluded positions (K, DEF: streamed or kept, never picked up here) or at the
 *   team's streamed positions, not already added by this run, and within positionLimits after the move
 *   (every known position on the roster counts, players without a model included). A player dropped isn't
 *   a candidate: he isn't one of the snapshot's free agents.
 * - Droppable: active-roster players with a model (one without projections isn't known to be worthless),
 *   not at K/DEF or the team's streamed positions, not in the run's keep set (below), and not needed to fill the
 *   starting lineup: after the move every starting slot that could be filled before can still be filled. That is a
 *   structural matching that ignores points, byes and injuries (every player counts 1; lineup.ts honors starter
 *   limits), with every known player on the roster and the streaming rows (for their position). A lineup that already
 *   can't be filled only may not lose more. In dynasty and keeper leagues k is never dropped for a when v_dyn(k) −
 *   v_dyn(a) > faDynGuard × the top dynasty value (the caller passes the values and that amount; no dynasty
 *   values → no guard).
 * - The keep set (optimize's `keep`; Phase 7c, planner reply to Checkpoint 7b, section 5): players a run never drops, so
 *   they're never droppable above (the near-ties below only ever cut droppable players, so they're covered too). The
 *   trade evaluation passes legality's adds (evaluate.ts tradeSides: the free agents rules 3 and 4 put into a roster
 *   after a trade), so V*(after) never drops a same-position fill, mostly to make the side's own baseline pickup again,
 *   which would leave the card naming a pickup the evaluated roster doesn't hold (on Parker's league, Oct 4 09:24Z, on 21
 *   of the 96 sides with a fill in a search's exact trades, 18 of them in a move making one of that side's baseline
 *   pickups). A keep set holding none of the
 *   roster's players is no keep set: its runs are the same runs, under the same memo key. Every other move is as without
 *   it, and a run whose best moves never drop a kept player makes the very same moves (better() is a total order).
 *   reoptimize() takes one too since Checkpoint 7e (planner reply to Checkpoint 7d, item 3.3: "Untouchables are never
 *   suggested as drops anywhere"): the League model passes my untouchables (league.ts TeamWork.keep) to every run of my
 *   team, V*(T) and its re-runs alike (lineup costs, MV_add, chips that stay chips), and evaluate.ts to my V*(after) with
 *   legality's adds. A re-run's moves and swaps never drop a kept player (its exchanges give back pickups only, never one of
 *   the team's own players), under the same rule for its memo key.
 *
 * Exact, and fast without starter limits (teamValue.ts header, "Swapping a player"): any move gains at most
 * what adding its free agent alone to X gains, so a roster where no free agent's add bound reaches faMinGain
 * stops at once. With an open spot, a drop move whose free agent the open spot could take too is never better
 * (equal at best, and ties go to the open spot), so drops are tried only with the free agents a position
 * limit keeps out of the open spot. Only free agents whose add bound reaches faMinGain are considered at all.
 * Dropping k for a gains at most Σ_w ω_w × (a's add bound in a week k sits on the bench; min(a's add bound, a's
 * points − what losing k costs) in a week he starts); drops are solved best bound first, and only while a bound
 * can still reach faMinGain and the best move found. A drop who sits in every week that counts needs no solve: the
 * swap gains exactly what adding the free agent alone gains. Under starter limits (MFL) a minimum can force a
 * newcomer in at 0 points, so adding a player can even lower a lineup and those bounds don't hold; but a lineup
 * under limits never scores more than the same players without them (the "relaxed" lineup: every limited lineup is
 * a relaxed one). So any move from X gains at most (X's relaxed points − its points under limits) + what adding its
 * free agent gains to X's relaxed lineup (bounded as above), which prunes the free agents that can't reach
 * faMinGain (and stops at once when none can) without giving up exactness. The same holds each week and for each
 * drop (the per-drop bound above on the relaxed lineups, plus that week's shortfall), so drops are solved best bound
 * first there too, and each pick of a free agent solves only those whose bound can still win. Since minimums that bind
 * make those bounds loose, two exact shortlists help as well (review of track A2): a free agent whom another of the
 * same position and eligibility outscores in every week that counts (and, with a dynasty guard, matches in value)
 * never makes a better move nor wins a tie, and dropping a player who outscores a teammate of the same kind (whose
 * drop comes first on ties and who is worth no more) never beats dropping that teammate: any lineup with the weaker
 * one is a lineup with the stronger for at least as many points, limits included. ⚠️ Still slow when minimums bind: a
 * 12-team MFL-style league with 30 free agents a position takes about 2.6 s for its League model (6 s before these):
 * Phase 5 (MFL) needs more.
 *
 * Judging moves in scenario lineups (OptimizerSetup.scenarios > 0, no starter limits; review of track E, item 1):
 * optimize() then picks and keeps moves by their gain in scenario lineups, the basis B and the League model's
 * lineup costs are measured on, with the same threshold (faMinGain, now scenario ROS points). In EV lineups a depth
 * pickup (a bench player who plays only when a starter is hurt) gains nearly nothing, so an EV-judged V* skipped it and
 * a trade that brought the same depth got credit for a pickup the team could make anyway (Malik Washington: 2.7 EV
 * points, about 8 in scenario lineups). The candidate, drop, lineup-fill, dynasty and tie rules are the EV search's. It
 * is exact and needs few solves:
 * - Every move gains at most what adding its free agent alone gains (more players never lower a lineup), bounded by
 *   teamValue.scenarioAddUpperBound; a cheaper bound screens free agents first (per slot mask, each week's floors
 *   sorted, his own availability ignored), so most never get the full bound.
 * - Per scenario and week, dropping k for a gains at most min(a's add bound there, a's points − k's removal cost
 *   there) when a plays, and exactly −(k's removal cost) when he doesn't (teamValue.scenarioCellFloors,
 *   scenarioRemovalCells): a near-exact bound per (k, a), so only the swaps that can reach faMinGain and the best move
 *   found are priced.
 * - Those are priced exactly without solving the roster again: an open-spot add and every swap of one free agent at once
 *   by teamValue.scenarioMoveGains (bit for bit scenarioAddGain's and scenarioSwapGains'), which solve only the scenarios
 *   the move can change (a scenario where k sits and a can't beat the floor gains exactly 0; where k sits and a gets in,
 *   the swap's lineup is the add's, solved once for every such k). Free agents go best bound first, and the scan stops
 *   once no bound reaches the best move.
 * - Speed only (Phase 4 addendum, lead decision N6; teamValue.speed.test.ts checks each against the exact path): the
 *   cheap bound sums each week's patterns directly after an even cheaper one (every scenario at the week's lowest floor);
 *   swap bounds add each (pattern, whether a plays) cell once times its scenarios; and after a move the next roster's
 *   scenario lineups are built from the roster's before it (teamValue.scenarioValuesAfterMove: only the patterns the move
 *   can change are solved again, bit for bit scenarioValues').
 * reoptimize() always judges in EV lineups: ⚠️ the League model's re-runs (lineup costs' V*(T − i), MV_add's re-runs
 * for trade chips, chips that stay chips together) need its speed, so they start from a scenario-judged V*(T) but add
 * by EV gains (league.ts step 5 says so). Under starter limits optimize() judges in EV lineups too (⚠️ an exact scenario
 * search there would solve every free agent and every drop: Phase 5's MFL).
 *
 * Memoized within one optimizer (one League model build, or one trade search) by the roster's ids (sorted),
 * the team's streamed positions, the move budget, the pool (the file header, "The pool") and, only when it holds a
 * player of the roster, the keep set (its ids on the roster, sorted; so every run without one keeps its key): V* is a
 * function of its starting roster, the free agents it may add and the players it may not drop. A memo hit returns the
 * first call's result, roster order included.
 *
 * Re-running from an optimized roster (reoptimize; league.ts step 5's shortcut, lead decision L3): V*(X − i)
 * and V*(X + j − drop) start from V*(X)'s roster (minus i, or plus j minus the drop) instead of from X's, for
 * speed, so the re-run starts with V*(X)'s pickups already made. A run from scratch makes at most faMaxMoves
 * moves, so its roster holds at most faMaxMoves free agents a move added ("pickups"); the re-run is held to the
 * same, on both sides (review of track A2: giving only the loss side one move past the cap, free, put lineup
 * costs at capped teams up to 29 points below a run from scratch, about their smallest pickup, while the
 * newcomer side got no move there at all):
 * - Free moves: as many as leave at most faMaxMoves pickups on the roster (faMaxMoves − the pickups the start
 *   roster holds). A move that drops a pickup for another free agent (a swap) adds none, so it is always free.
 * - `extra` more moves (one per player who left V*(X)'s roster, one for a newcomer). One that would put
 *   faMaxMoves + 1 pickups on the roster is an exchange: with it made, the pickup whose loss then costs least is
 *   given back, and the player that pickup's move dropped comes back (none when it went into an open spot, or when
 *   he is `gone`; position limits honored), when the roster that leaves beats not making the move at all (in EV
 *   lineups). That is a run from scratch's choice: of V*(X)'s moves and the new one, it keeps the ones worth most
 *   together. The roster is then a real roster, priced like any other (no gain is carried over from when V*(X)
 *   made its moves: losing the QB makes a backup-QB pickup worth more, review of track A2). When no exchange pays,
 *   the best swap is made instead, else the run stops. Each pickup remembers who its move dropped through swaps.
 * - Last, each player who left V*(X)'s roster opened a spot. One the moves left empty takes back a player a
 *   pickup's move dropped (the one adding the most EV points; ties: the earliest move; position limits honored;
 *   never one who is `gone`): a run from scratch would have put that pickup in the open spot instead of dropping
 *   him, the optimizer's own tie rule (an open spot first, nobody lost), even at no EV gain, and his depth counts in
 *   scenario lineups. Without it, a team that lost its D/ST kept an empty spot where a run from scratch kept the
 *   bench RB it had dropped (review of track A2). A free agent worth a move still takes the spot first.
 * ⚠️ The greedy-path difference that remains (measured on Parker's league, synthetic inputs, against runs from
 * scratch, with and without the real NFL schedule: in EV lineups, lineup costs within −3.6..+6.0 points and MV_add
 * within −5.0..+5.7, the median and the 10th and 90th percentiles within 0.11 of 0, 1 of 157 costs and 1 of 1,215
 * MV_adds off by more than 5; in scenario lineups, where the same EV moves can differ in depth, lineup costs mostly
 * within −0.9..+2.7 (10th to 90th percentile), with a few up to ±20): moves are greedy one at a time, an exchange
 * gives back one pickup for one new move, and a swap V*(X) itself would have made as a move past the cap is free here
 * (none in Parker's league or 35 random 12-team leagues: every such sixth move dropped a team's own player).
 *
 * The pool (CLAUDE.md §7, one free agent, one team; planner reply to Checkpoint 4, change 3): optimize() and
 * reoptimize() take a PoolRestriction, the free agents a run may not add (the ones allocated to other teams: league.ts
 * step 5, evaluate.ts's trade sides). Excluded free agents are left out of every candidate list (the bounds, the
 * scans, reoptimize's `base` shortlist), so a run against a restricted pool is the run the same rules make with
 * fewer free agents; the exactness machinery is unchanged. Every memo key includes the restriction's key (its ids
 * sorted), so runs against different pools never share a result. Greedy determinism: a run's moves depend only on
 * the candidates' rows, so removing free agents the run never adds (at any move) changes none of its moves; league.ts
 * and evaluate.ts rely on it (a team re-run against the pool minus every other team's pickups makes the very moves it
 * made against the pool minus the earlier teams' pickups). evaluate() prices a roster alone and takes no pool.
 * ⚠️ Exact but for near-ties (review of track C): gains within EPS (1e-9) of each other tie, and that isn't transitive,
 * so when three or more candidates' gains are spread over more than EPS with each step within it, which one a scan keeps
 * can depend on whether a never-chosen one among them is there (removing it can break the chain of ties). Making it
 * exact would put gains on a grid in every comparison (here and in teamValue.pickFreeAgent) with each bound's pruning
 * checked against the grid; it needs distinct projections to land within 2e-9 of each other, and hasn't happened on
 * Parker's league (10 teams, Oct 3) or in 60 random leagues.
 *
 * IR returners (StreamSpec.returners; league.ts step 5b; planner reply to Checkpoint 4, change 5): a team's IR players who
 * are expected back join every lineup this file solves, after the streaming rows, through their own rows (their
 * availability keeps them out until they're back). They aren't on the roster, so they never take an active spot (the
 * open-spot test counts the roster alone), are never dropped (only roster ids are), never a candidate, and never count
 * for the lineup-fill rule (entries: they can't play now). The memo keys include them (rosterKey). The roster spot one
 * needs from his return week (the displacement, which may release him then) is applied to final evaluations only, never
 * here (league.ts step 5b; returners.finalLineups).
 *
 * ⚠️ Known approximations: the moves are greedy, one at a time: two moves worth more together than either alone
 * are made only when each reaches faMinGain on its own, and a move's free agent is the one that's best for
 * that move.
 */
import { config } from "./config";
import { lineupTotal, prepareRoster, prepareSlots, type LineupCandidate, type PreparedSlots } from "./lineup";
import type { Pos } from "./model";
import type { InstanceIndex } from "./needs";
import {
  addGainExact,
  addUpperBound,
  addUpperBoundWeeks,
  evRemovalWeeks,
  pickFreeAgent,
  positionAllows,
  rosValue,
  scenarioAddUpperBound,
  scenarioCellFloors,
  scenarioMoveGains,
  scenarioRemovalCells,
  scenarioValues,
  scenarioValuesAfterMove,
  slotMask,
  solveEvWeeks,
  teamEval,
  type FreeAgentCandidate,
  type ScenarioCells,
  type ScenarioValues,
  type SolvedWeeks,
  type TableRow,
  type TeamEval,
} from "./teamValue";

/** Gains closer than this are ties or zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The config keys the optimizer reads (config.freeAgentOptimizer, config.streaming.optimizerExcluded), widened for tests. */
export interface OptimizerConfig {
  /**
   * A move is made only when it gains at least this many ROS points (in the lineups it judges moves in). The League model
   * passes config.freeAgentOptimizer.faMinGain × Σω ÷ Σω₀, its own weights' sum against ω₀'s (league.ts step 5c,
   * LeagueContext.thresholds), so the threshold means under ω what it did at ω₀.
   */
  readonly faMinGain: number;
  /** At most this many moves per run. */
  readonly faMaxMoves: number;
  /** Positions never added or dropped (K and DEF). */
  readonly optimizerExcluded: readonly Pos[];
}

/** The defaults from config (§15). */
export function optimizerConfig(): OptimizerConfig {
  return { faMinGain: config.freeAgentOptimizer.faMinGain, faMaxMoves: config.freeAgentOptimizer.faMaxMoves, optimizerExcluded: config.streaming.optimizerExcluded };
}

/** Dynasty and keeper leagues with dynasty values: never drop k for a when value(k) − value(a) > maxDrop. */
export interface DynastyGuard {
  readonly value: (id: string) => number;
  /** faDynGuard × the top dynasty value. */
  readonly maxDrop: number;
}

/** Everything one optimizer shares across rosters (one League model build, or one trade search). */
export interface OptimizerSetup {
  /** Every modeled player's row: rostered players and free agents (ProjectionTable.rows). */
  readonly rows: ReadonlyMap<string, TableRow>;
  /** Weeks each lineup is solved for (the table's weeks). */
  readonly weekCount: number;
  readonly slots: PreparedSlots;
  /** ω per week over the weeks team numbers count (TeamWeeks.weights with the League model's ω: league.ts step 5c). */
  readonly weights: ArrayLike<number>;
  /** The snapshot's free agents (ids without a row are skipped). */
  readonly freeAgents: readonly string[];
  /** Position and eligibility of any id on a roster, with a model or not (snapshot.players); undefined = unknown. */
  readonly info: (id: string) => { readonly pos: Pos; readonly eligible: readonly Pos[] } | undefined;
  readonly positionLimits?: Partial<Record<Pos, number>> | undefined;
  readonly maxRosterSize: number;
  /** Market value (perception) for drop ties: the less valuable player goes. (Not `valueOf`: every object has one.) */
  readonly dropValue: (id: string) => number;
  /**
   * ⚠️ Near-ties in whom a move cuts (the file header; verification of the final review of Phase 4c, finding VF-1): ROS
   * points (the units of the moves' gains) within which the best move's free agent comes in for a player worth less
   * (dropValue floored at dropValueFloor) than the one the best move cuts. 0 or absent: exact ties only (as before).
   */
  readonly dropNearTie?: number;
  /** The waiver credit W: near-ties' drop values are floored at it (only a best move cutting a player worth more can give way). Absent: 0. */
  readonly dropValueFloor?: number;
  readonly dynasty?: DynastyGuard | null;
  /**
   * Judge optimize()'s moves in scenario lineups (the file header, "Judging moves in scenario lineups"): the scenarios
   * the rows' flags carry (ProjectionTable.scenarios). 0 or absent: EV lineups. reoptimize always judges in EV lineups.
   */
  readonly scenarios?: number;
  /**
   * With scenarios: the slot instances' index (needs.instanceIndex), so the scenario lineups a scenario-judged run
   * computes for its rosters carry instance points and the within-lineup variance (scenarioValuesOf), and callers
   * pricing V*'s roster reuse them instead of solving again.
   */
  readonly instanceIndex?: InstanceIndex | null;
}

/**
 * A team's streaming rows (league.ts step 5a) and the positions it streams (even one whose replacement scores 0 everywhere,
 * so it has no row), and its IR returners (league.ts step 5b; planner reply to Checkpoint 4, change 5).
 */
export interface StreamSpec {
  readonly rows: readonly TableRow[];
  readonly positions: readonly Pos[];
  /**
   * The team's IR players with a model and an expected return week (availability.expectedReturnWeek), as their own table
   * rows: appended after the streaming rows wherever the team's lineup is solved, so a returner starts once his own
   * availability says he's back (no masking before then). They take no active roster spot, are never dropped nor a
   * free-agent move, and don't count for the lineup-fill rule (they can't play now: fillCount's entries leave them out).
   * Only a final evaluation's displacement (returners.finalLineups: from his return he's on the active roster) can count
   * one structurally, or release one. rosterKey includes their ids. Absent or empty: none (Checkpoint 4's rule).
   */
  readonly returners?: readonly TableRow[];
}

export const NO_STREAM: StreamSpec = { rows: [], positions: [] };

/** No player kept (the file header, "The keep set"). */
const NO_KEEP: ReadonlySet<string> = new Set();

/**
 * The free agents a run may not add (the file header, "The pool"; §7 one free agent, one team): `excluded`, and `key`,
 * its canonical form (the ids sorted, without repeats; "" for none), which every memo key includes. Build one with
 * poolRestriction.
 */
export interface PoolRestriction {
  readonly key: string;
  readonly excluded: ReadonlySet<string>;
}

/** The whole pool: no free agent excluded. */
export const FULL_POOL: PoolRestriction = { key: "", excluded: new Set() };

/** A pool restriction excluding `ids` (any order, repeats ignored); none → FULL_POOL's key, so their memo entries are shared. */
export function poolRestriction(ids: Iterable<string>): PoolRestriction {
  const excluded = new Set(ids);
  if (!excluded.size) return FULL_POOL;
  return { key: [...excluded].sort().join("\u0000"), excluded };
}

/** One move of a run: add a free agent, dropping a player or into an open spot (drop null), and its EV ROS gain. */
export interface FaStep {
  readonly add: string;
  readonly drop: string | null;
  readonly gainEv: number;
}

export interface OptimizedRoster {
  /** The start roster (deduplicated), in its order. */
  readonly start: readonly string[];
  /** The active roster after the moves: each add takes its drop's place, or goes at the end for an open spot. */
  readonly roster: readonly string[];
  readonly moves: readonly FaStep[];
  /** The roster's players with a model (roster order) and the streaming rows, prepared; and its EV lineups and EV ROS. */
  readonly team: TeamEval;
  readonly solved: SolvedWeeks;
  readonly evRos: number;
  /**
   * A re-run's changes besides its moves (reoptimize; the file header), in order: players who came back into open spots
   * and pickups its exchanges gave back. Empty for an ordinary run.
   */
  readonly given: readonly GivenBack[];
}

/**
 * One change of a re-run besides its moves (reoptimize): a pickup given back by an exchange and the player who came
 * back in his place (null: nobody, a spot opened); or, with pickup null, a player who came back into an open spot.
 */
export interface GivenBack {
  readonly pickup: string | null;
  readonly back: string | null;
}

export interface RosterOptimizer {
  /**
   * V*(roster) for a team that streams `stream`, with at most `maxMoves` moves (default faMaxMoves), adding only free
   * agents `pool` doesn't exclude (default FULL_POOL: the file header, "The pool"), never dropping a player of `keep` (the
   * file header, "The keep set"; default none). Memoized by roster, streamed positions, budget, pool and, when it holds a
   * player of the roster, the keep set.
   */
  optimize(roster: readonly string[], stream?: StreamSpec, maxMoves?: number, pool?: PoolRestriction, keep?: readonly string[]): OptimizedRoster;
  /**
   * The re-run from `start`, a roster derived from the optimized roster `from` (its players minus some, plus a
   * newcomer), with `extra` moves beyond the free ones (the file header, "Re-running from an optimized roster"), adding
   * only free agents `pool` doesn't exclude (default FULL_POOL; league.ts passes the team's exclusion).
   * `gone`: players who never come back when an exchange gives a pickup back (traded away). `base`, a roster that
   * `start` contains (league.ts: B′ for B′ + a newcomer), only speeds it up: every move of the first step gains at
   * most what adding its free agent to `start` gains, at most what adding him to `base` gains (more players never
   * raise a newcomer's gain), so only free agents whose add bound on `base` reaches faMinGain are scanned there.
   * `keep`: players it never drops (the file header, "The keep set"; default none). Memoized by roster, streamed
   * positions, `from`, `extra`, `gone`, pool and, when it holds a player of `start`, the keep set.
   */
  reoptimize(from: OptimizedRoster, start: readonly string[], stream: StreamSpec, extra: number, gone?: readonly string[], base?: readonly string[], pool?: PoolRestriction, keep?: readonly string[]): OptimizedRoster;
  /** How many moves reoptimize may make from `start` (the free ones and `extra`): a bound for callers that skip it. */
  rerunMoves(from: OptimizedRoster, start: readonly string[], extra: number): number;
  /** The roster's EV lineups without any move (the start of a run; memoized like optimize). */
  evaluate(roster: readonly string[], stream?: StreamSpec): { team: TeamEval; solved: SolvedWeeks; evRos: number };
  readonly setup: OptimizerSetup;
  readonly cfg: OptimizerConfig;
  /** Runs made, memo hits and moves considered (each step), for timings. */
  readonly stats: { runs: number; hits: number; steps: number; dropsSolved: number };
  /** Whether optimize() judges moves in scenario lineups (OptimizerSetup.scenarios, no starter limits). */
  readonly judgesScenarios: boolean;
  /**
   * A roster's scenario lineups as a scenario-judged run computes them (teamValue.scenarioValues with the cells kept, the
   * within-lineup variance, and instance points when setup.instanceIndex was given), memoized by roster: free for the
   * rosters a run passed through, V*'s own included. Null when the optimizer doesn't judge in scenario lineups.
   */
  scenarioValuesOf(roster: readonly string[], stream?: StreamSpec): ScenarioValues | null;
  /**
   * Checkpoint 7h (memory only; search.ts, "Whole rosters": a Thorough search's exact evaluations memoized about 4,000
   * rosters' scenario lineups, some 130 KB each, about 550 MB on Parker's 12-team league, kept as long as the context): how
   * many rosters' scenario lineups the memo holds (scenarioValuesOf's and the scenario-judged runs'), in the order they were
   * memoized.
   */
  scenarioMemoSize(): number;
  /**
   * The scenario memo cut back to its first `size` rosters (the ones memoized later go). Speed only: a roster that's gone is
   * worked out again when next needed, bit for bit the same (scenarioValues, or scenarioValuesAfterMove, which equals it).
   * Never call it while a run is under way (callers trim between their own evaluations).
   */
  trimScenarioMemo(size: number): void;
}

/**
 * A roster's memo key: its ids sorted (the default sort orders strings by UTF-16 code units, as `<` does), without
 * repeats, its streamed positions and, when it has any, its IR returners' ids (sorted; StreamSpec.returners).
 */
export function rosterKey(roster: readonly string[], stream: StreamSpec = NO_STREAM): string {
  const ids = [...roster].sort();
  let key = "";
  for (let i = 0; i < ids.length; i++) if (i === 0 || ids[i] !== ids[i - 1]) key += i === 0 ? (ids[i] as string) : `\u0000${ids[i] as string}`;
  const base = `${key}\u0001${stream.positions.length > 1 ? [...stream.positions].sort().join(",") : stream.positions.join(",")}`;
  const back = stream.returners;
  return back && back.length ? `${base}\u0006${back.map((r) => r.id).sort().join("\u0000")}` : base;
}

/** A spec's returner rows (none when absent). */
export function returnersOf(stream: StreamSpec): readonly TableRow[] {
  return stream.returners ?? [];
}

/** The roster after a move: the add takes the drop's place, or goes at the end. */
export function applyStep(roster: readonly string[], step: Pick<FaStep, "add" | "drop">): string[] {
  if (step.drop === null) return [...roster, step.add];
  return roster.map((id) => (id === step.drop ? step.add : id));
}

/** positions without one occurrence of `pos`. */
function withoutOne(positions: readonly Pos[], pos: Pos): Pos[] {
  const i = positions.indexOf(pos);
  return i < 0 ? [...positions] : [...positions.slice(0, i), ...positions.slice(i + 1)];
}

interface Move {
  add: string;
  drop: string | null;
  gain: number;
}

/** Between two drops of equal gain, whether dropping `a` comes first (the file header's ties: the lower value, then the smaller id). */
function dropBefore(a: string, b: string, dropValue: (id: string) => number): boolean {
  const va = dropValue(a) || 0;
  const vb = dropValue(b) || 0;
  return va !== vb ? va < vb : a < b;
}

/** A move beats another (the file header's ties). */
function better(a: Move, b: Move, dropValue: (id: string) => number): boolean {
  if (Math.abs(a.gain - b.gain) > EPS) return a.gain > b.gain;
  if ((a.drop === null) !== (b.drop === null)) return a.drop === null;
  if (a.drop !== null && b.drop !== null && a.drop !== b.drop) return dropBefore(a.drop, b.drop, dropValue);
  return a.add < b.add;
}

/**
 * Starting slots a set of players can fill, structurally (every player counts 1: points, byes and injuries
 * ignored; starter limits honored by lineup.ts). It depends only on the players' positions and eligibility (the most
 * players that can start together: ids only break ties between interchangeable players), so it is memoized per prepared
 * slots by that multiset (speed only).
 */
export function fillCount(entries: readonly LineupCandidate[], slots: PreparedSlots): number {
  if (!entries.length) return 0;
  let memo = fillMemo.get(slots);
  if (!memo) {
    memo = new Map();
    fillMemo.set(slots, memo);
  }
  const kinds = entries.map((e) => `${e.pos}|${e.eligible.join(",")}`);
  kinds.sort();
  const key = kinds.join(";");
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const prep = prepareRoster(entries, slots);
  const count = lineupTotal(prep, new Float64Array(entries.length).fill(1));
  memo.set(key, count);
  return count;
}

const fillMemo = new WeakMap<PreparedSlots, Map<string, number>>();

/** The optimizer (see the file header). */
export function createOptimizer(setup: OptimizerSetup, cfg: OptimizerConfig = optimizerConfig()): RosterOptimizer {
  const { slots, weights } = setup;
  const W = Math.max(0, Math.floor(setup.weekCount));
  const minGain = cfg.faMinGain;
  const maxMoves = Number.isFinite(cfg.faMaxMoves) ? Math.max(0, Math.floor(cfg.faMaxMoves)) : 0;
  const limited = slots.limits !== null;
  // Starter limits: the same slots without them (the file header's relaxed lineup), for bounds that stay valid.
  const relaxed = limited ? prepareSlots(slots.groups.map((g) => ({ slot: g.slot, count: g.count, eligible: [...g.eligible] }))) : null;
  const always = new Set<Pos>(cfg.optimizerExcluded);
  const limits = setup.positionLimits;
  const seen = new Set<string>();
  const candidates: FreeAgentCandidate[] = [];
  for (const id of setup.freeAgents) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = setup.rows.get(id);
    if (row) candidates.push({ row, mask: slotMask(slots, row.pos, row.eligible) });
  }
  const memo = new Map<string, OptimizedRoster>();
  const evals = new Map<string, { team: TeamEval; solved: SolvedWeeks; evRos: number }>();
  const stats = { runs: 0, hits: 0, steps: 0, dropsSolved: 0 };
  const dyn = setup.dynasty ?? null;
  // Scenario-judged optimize() (the file header): only without starter limits (⚠️ under them its moves are judged in EV
  // lineups: an exact scenario search there would solve every free agent and every drop, too slow for Phase 5's MFL).
  const S = setup.scenarios !== undefined && Number.isFinite(setup.scenarios) ? Math.max(0, Math.floor(setup.scenarios)) : 0;
  const judgeScen = S > 0 && !limited;
  // Near-ties in whom a move cuts (the file header): the tolerance (ROS points) and the floor (W) on the drops' values.
  const nearTie = setup.dropNearTie !== undefined && Number.isFinite(setup.dropNearTie) && setup.dropNearTie > 0 ? setup.dropNearTie : 0;
  const valueFloor = setup.dropValueFloor !== undefined && Number.isFinite(setup.dropValueFloor) && setup.dropValueFloor > 0 ? setup.dropValueFloor : 0;
  /** A drop's value as near-ties read it: dropValue floored at W (an open-spot add, `null`, counts as W). */
  const flooredValue = (drop: string | null): number => (drop === null ? valueFloor : Math.max(setup.dropValue(drop) || 0, valueFloor));
  /** Between two near-ties: the lower floored drop value, then better()'s order (the larger gain first). */
  const nearBetter = (a: Move, b: Move): boolean => {
    const va = flooredValue(a.drop);
    const vb = flooredValue(b.drop);
    return va !== vb ? va < vb : better(a, b, setup.dropValue);
  };
  /** Whether a near-tie could replace the best move: it cuts a player worth more than W (nothing floors below W). */
  const contested = (best: Move | null): best is Move => nearTie > 0 && best !== null && best.drop !== null && flooredValue(best.drop) > valueFloor;
  /**
   * The move a scan makes (the file header, near-ties): `best`, the best move by the rules above, unless it cuts a player
   * worth more than W; then the same free agent for another of `droppable` (indices into `rows`, the scan's team rows) worth
   * less (floored), when that swap gains at least best's gain − nearTie and more than 0: the lowest floored value, then
   * better()'s order (the larger gain first). `price(ks, a, bar)` prices dropping each k of `ks` for `a` exactly, leaving
   * out the ones a rule forbids (and may leave out any whose bound is under `bar`).
   */
  const nearTiePick = (best: Move | null, rows: readonly TableRow[], droppable: readonly number[], price: (ks: readonly number[], a: TableRow, bar: number) => readonly Move[]): Move | null => {
    if (!contested(best)) return best;
    const a = setup.rows.get(best.add);
    if (!a) return best;
    const top = flooredValue(best.drop);
    const ks = droppable.filter((k) => {
      const id = rows[k]?.id;
      return id !== undefined && id !== best.drop && flooredValue(id) < top;
    });
    if (!ks.length) return best;
    const bar = Math.max(best.gain - nearTie, 0);
    let pick: Move = best;
    for (const m of price(ks, a, bar)) if (m.gain >= bar - EPS && m.gain > EPS && nearBetter(m, pick)) pick = m;
    return pick;
  };

  const evaluate = (roster: readonly string[], stream: StreamSpec = NO_STREAM) => {
    const key = rosterKey(roster, stream);
    const hit = evals.get(key);
    if (hit) return hit;
    const rows: TableRow[] = [];
    const ids = new Set<string>();
    for (const id of roster) {
      if (ids.has(id)) continue;
      ids.add(id);
      const row = setup.rows.get(id);
      if (row) rows.push(row);
    }
    const team = teamEval([...rows, ...stream.rows, ...returnersOf(stream)], slots);
    const solved = solveEvWeeks(team, W);
    const out = { team, solved, evRos: rosValue(solved.lv, weights) };
    evals.set(key, out);
    return out;
  };

  /** The structural entries of a roster (known players) and of the streaming rows; never the returners (StreamSpec.returners). */
  const entries = (roster: readonly string[], stream: StreamSpec): LineupCandidate[] => [
    ...roster.flatMap((id) => {
      const info = setup.info(id);
      return info ? [{ id, pos: info.pos, eligible: info.eligible }] : [];
    }),
    ...stream.rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible })),
  ];

  /**
   * The moves from `roster` (the file header's rules), scanned once: the bounds on every free agent and on every drop
   * are shared by the two searches. best(): the best move (null when none qualifies or none exists). bestDrop(only):
   * the best move that drops a player `only` accepts, never an open-spot add (reoptimize's swaps: a pickup for another
   * free agent). A drop's best free agent is solved once for both. `within`: only these free agents (reoptimize's
   * first step from a roster that contains a base: the rest can't make a move there, so leaving them out changes
   * nothing). `pool`: the free agents the run may not add are left out (the file header, "The pool"). `keep`: players
   * never dropped (the file header, "The keep set").
   */
  const scanMoves = (
    roster: readonly string[],
    cur: { team: TeamEval; solved: SolvedWeeks; evRos: number },
    stream: StreamSpec,
    added: ReadonlySet<string>,
    within: ReadonlySet<string> | null = null,
    pool: PoolRestriction = FULL_POOL,
    keep: ReadonlySet<string> = NO_KEEP,
  ): { best: () => Move | null; bestDrop: (only: (id: string) => boolean) => Move | null } => {
    stats.steps++;
    const none = { best: () => null, bestDrop: () => null };
    const streamed = new Set<Pos>(stream.positions);
    const excluded = (pos: Pos) => always.has(pos) || streamed.has(pos);
    const onRoster = new Set(roster);
    const taken = pool.excluded;
    const cands = candidates.filter((c) => !onRoster.has(c.row.id) && !added.has(c.row.id) && !taken.has(c.row.id) && !excluded(c.row.pos) && (within === null || within.has(c.row.id)));
    if (!cands.length) return none;
    const positions: Pos[] = roster.flatMap((id) => {
      const info = setup.info(id);
      return info ? [info.pos] : [];
    });
    const openAllows = (row: TableRow) => positionAllows(limits, positions, row.pos);
    /** The weeks that count, and whether one row scores at least another's points in every one of them (`strict`: more in one). */
    const counted: number[] = [];
    for (let w = 0; w < W; w++) if ((weights[w] ?? 0) > 0) counted.push(w);
    const atLeast = (a: TableRow, b: TableRow): { all: boolean; strict: boolean } => {
      let strict = false;
      for (const w of counted) {
        const x = a.ev[w] as number;
        const y = b.ev[w] as number;
        if (x < y) return { all: false, strict: false };
        if (x > y) strict = true;
      }
      return { all: true, strict };
    };
    const kindOf = (r: TableRow) => `${r.pos}|${r.eligible.join(",")}`;
    /**
     * Free agents no other of the same kind (position and eligibility) dominates: b is dominated by a who scores at least
     * as much in every week that counts (more in one, or the same and the smaller id: pickFreeAgent's tie) and, with a
     * dynasty guard, is worth at least as much (so any drop allowed for b is allowed for a). With the same position, any
     * lineup with b is one with a for at least as many points, under starter limits too, so every move with b gains at most
     * what the same move with a gains, and loses its ties: leaving b out changes no result.
     */
    const undominatedAdds = (list: readonly FreeAgentCandidate[]): FreeAgentCandidate[] => {
      const byKind = new Map<string, FreeAgentCandidate[]>();
      for (const c of list) byKind.set(kindOf(c.row), [...(byKind.get(kindOf(c.row)) ?? []), c]);
      return list.filter((b) =>
        !(byKind.get(kindOf(b.row)) ?? []).some((a) => {
          if (a === b || (dyn && dyn.value(a.row.id) < dyn.value(b.row.id))) return false;
          const d = atLeast(a.row, b.row);
          return d.all && (d.strict || a.row.id < b.row.id);
        }),
      );
    };

    // Every move gains at most what adding its free agent alone gains (the file header): bound them all at once.
    let bounds: { c: FreeAgentCandidate; ub: Float64Array; total: number }[] | null = null;
    // Under starter limits: (relaxed − limited points of X) + the free agent's relaxed add bound, a looser bound that
    // only screens free agents (the per-drop bounds below need the exact structure, so they aren't used there).
    let screened: FreeAgentCandidate[] | null = null;
    // Under starter limits: X's relaxed lineups and, per week, how far its limited lineup falls short of them.
    let freeCur: SolvedWeeks | null = null;
    let penCur: Float64Array | null = null;
    if (!limited) {
      bounds = [];
      let top = 0;
      const scratch = new Float64Array(W);
      for (const c of cands) {
        const ub = addUpperBoundWeeks(cur.solved, c.row, c.mask, scratch) as Float64Array;
        let total = 0;
        for (let w = 0; w < W; w++) total += (weights[w] ?? 0) * (ub[w] as number);
        if (total > top) top = total;
        if (total >= minGain - EPS) bounds.push({ c, ub: Float64Array.from(ub.subarray(0, W)), total });
      }
      if (top < minGain - EPS) return none;
    } else if (relaxed) {
      const free = solveEvWeeks(teamEval(cur.team.rows, relaxed), W);
      const short = Float64Array.from({ length: W }, (_, w) => Math.max(0, (free.lv[w] as number) - (cur.solved.lv[w] as number)));
      freeCur = free;
      penCur = short;
      let penalty = 0;
      for (let w = 0; w < W; w++) penalty += (weights[w] ?? 0) * (short[w] as number);
      screened = [];
      for (const c of cands) {
        const ub = penalty + addUpperBound(free, c.row, slotMask(relaxed, c.row.pos, c.row.eligible), weights);
        if (ub >= minGain - EPS) screened.push(c);
      }
      if (!screened.length) return none;
      // Nothing is bounded below: only the free agents no other one of the same kind dominates (the file header).
      screened = undominatedAdds(screened);
    }
    // Only a free agent whose add bound reaches faMinGain can make a move that does (every move gains at most what
    // adding him alone gains), so the rest are left out of every pick below: exact, and much less work.
    const able = bounds ? bounds.map((b) => b.c) : (screened ?? cands);
    /**
     * Under starter limits, pickFreeAgent's pick (the largest exact gain above 0, ties to the smaller id), solving only the
     * free agents whose bound can still win: a lineup under limits never scores more than the same players without them,
     * so adding a gains at most, each week, (the roster's relaxed lineup − its limited one) + a's add bound on the relaxed
     * lineup (the file header).
     */
    const pickLimited = (solved: SolvedWeeks, list: readonly FreeAgentCandidate[], allowed: (row: TableRow) => boolean, free: SolvedWeeks | null = null, pen: Float64Array | null = null): { row: TableRow; gain: number } | null => {
      if (!relaxed) return pickFreeAgent(solved, list, weights, allowed);
      const fr = free ?? solveEvWeeks(teamEval(solved.team.rows, relaxed), W);
      const pn = pen ?? Float64Array.from({ length: W }, (_, w) => Math.max(0, (fr.lv[w] as number) - (solved.lv[w] as number)));
      const scored: { c: FreeAgentCandidate; ub: number }[] = [];
      for (const c of list) {
        if (!allowed(c.row)) continue;
        const rub = addUpperBoundWeeks(fr, c.row, slotMask(relaxed, c.row.pos, c.row.eligible)) as Float64Array;
        let ub = 0;
        for (let w = 0; w < W; w++) ub += (weights[w] ?? 0) * ((pn[w] as number) + (rub[w] as number));
        if (ub > EPS) scored.push({ c, ub });
      }
      scored.sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.c.row.id, b.c.row.id));
      let best: { row: TableRow; gain: number } | null = null;
      for (const { c, ub } of scored) {
        if (best && ub < best.gain - EPS) break;
        const { gain } = addGainExact(solved, c.row, c.mask, weights);
        if (!(gain > EPS)) continue;
        if (!best || gain > best.gain + EPS || (Math.abs(gain - best.gain) <= EPS && c.row.id < best.row.id)) best = { row: c.row, gain };
      }
      return best;
    };
    const teamRows = cur.team.rows;
    const dropFirst = (a: string, b: string) => dropBefore(a, b, setup.dropValue);
    /**
     * Drops no other of the same kind dominates: dropping k2 is dominated by dropping k1 who scores no more in every week
     * that counts, comes first on a tie (the lower value, then the smaller id) and, with a dynasty guard, is worth no more
     * (so any free agent allowed for k2 is allowed for k1): keeping the better player of the same position never lowers a
     * lineup, so every move dropping k2 gains at most what the same move dropping k1 gains, and loses its ties.
     */
    const undominatedDrops = (ks: readonly number[]): number[] =>
      ks.filter((k2) => {
        const r2 = teamRows[k2] as TableRow;
        return !ks.some((k1) => {
          if (k1 === k2) return false;
          const r1 = teamRows[k1] as TableRow;
          if (kindOf(r1) !== kindOf(r2) || !dropFirst(r1.id, r2.id) || (dyn && dyn.value(r1.id) > dyn.value(r2.id))) return false;
          return atLeast(r2, r1).all;
        });
      });
    let rem: Float64Array[] | null = null;
    let fillBefore: number | null = null;
    /** Whether roster index k sits on the bench in every week that counts (weights > 0). */
    const benched = (k: number): boolean => {
      for (let w = 0; w < W; w++) if ((weights[w] ?? 0) > 0 && ((cur.solved.seat[w] as Int32Array)[k] as number) >= 0) return false;
      return true;
    };
    /**
     * Per drop k: which free agents may come in for him (position limits without him, the dynasty guard, and the lineup-fill
     * rule: without him every slot fillable before still is, or the free agent restores it), and the roster's EV lineups
     * without him (solved when first needed).
     */
    const dropRules = new Map<number, { allowed: (a: TableRow) => boolean; minus: () => SolvedWeeks }>();
    const rulesOf = (k: number): { allowed: (a: TableRow) => boolean; minus: () => SolvedWeeks } => {
      const known = dropRules.get(k);
      if (known) return known;
      const kRow = teamRows[k] as TableRow;
      const left = withoutOne(positions, kRow.pos);
      const restRoster = roster.filter((id) => id !== kRow.id);
      if (fillBefore === null) fillBefore = fillCount(entries(roster, stream), slots);
      const before = fillBefore;
      const restEntries = entries(restRoster, stream);
      const needed = fillCount(restEntries, slots) < before;
      const restores = new Map<string, boolean>();
      const fillOk = (a: TableRow): boolean => {
        if (!needed) return true;
        const fk = `${a.pos}|${a.eligible.join(",")}`;
        let ok = restores.get(fk);
        if (ok === undefined) {
          ok = fillCount([...restEntries, { id: a.id, pos: a.pos, eligible: a.eligible }], slots) >= before;
          restores.set(fk, ok);
        }
        return ok;
      };
      const dynOk = (a: TableRow): boolean => !dyn || dyn.value(kRow.id) - dyn.value(a.id) <= dyn.maxDrop + EPS;
      let solvedMinus: SolvedWeeks | null = null;
      const rules = {
        allowed: (a: TableRow) => positionAllows(limits, left, a.pos) && dynOk(a) && fillOk(a),
        minus: (): SolvedWeeks => {
          if (!solvedMinus) {
            stats.dropsSolved++;
            solvedMinus = solveEvWeeks(
              teamEval(
                teamRows.filter((_, j) => j !== k),
                slots,
              ),
              W,
            );
          }
          return solvedMinus;
        },
      };
      dropRules.set(k, rules);
      return rules;
    };
    // Each drop's best free agent, per candidate set ("all": every able one; "closed": those an open spot can't take).
    const picked = new Map<string, Move | null>();
    const dropMove = (k: number, dropCands: readonly FreeAgentCandidate[], tag: string): Move | null => {
      const key = `${k}|${tag}`;
      if (picked.has(key)) return picked.get(key) ?? null;
      const kRow = teamRows[k] as TableRow;
      const { allowed, minus } = rulesOf(k);
      let move: Move | null = null;
      // A player who starts in no week that counts costs nothing to lose, and the best lineup with the free agent never
      // holds him, so the swap gains exactly what adding the free agent alone gains: no lineup to solve again.
      if (!limited && benched(k)) {
        const pick = pickFreeAgent(cur.solved, dropCands, weights, allowed);
        if (pick) move = { add: pick.row.id, drop: kRow.id, gain: pick.gain };
      } else {
        const solvedMinus = minus();
        const pick = limited ? pickLimited(solvedMinus, dropCands, allowed) : pickFreeAgent(solvedMinus, dropCands, weights, allowed);
        if (pick) move = { add: pick.row.id, drop: kRow.id, gain: rosValue(solvedMinus.lv, weights) - cur.evRos + pick.gain };
      }
      picked.set(key, move);
      return move;
    };
    /** Dropping k for the free agent `a` (the near-ties: the best move's own free agent), exactly; null when a rule forbids it. */
    const swapFor = (k: number, a: TableRow): Move | null => {
      const { allowed, minus } = rulesOf(k);
      if (!allowed(a)) return null;
      const mask = slotMask(slots, a.pos, a.eligible);
      const id = (teamRows[k] as TableRow).id;
      // A player benched in every week that counts: the swap gains exactly what adding him alone gains (dropMove's shortcut).
      if (!limited && benched(k)) return { add: a.id, drop: id, gain: addGainExact(cur.solved, a, mask, weights).gain };
      const solvedMinus = minus();
      return { add: a.id, drop: id, gain: rosValue(solvedMinus.lv, weights) - cur.evRos + addGainExact(solvedMinus, a, mask, weights).gain };
    };

    const search = (open: boolean, only: ((id: string) => boolean) | null): Move | null => {
      let best: Move | null = null;
      const consider = (m: Move) => {
        if (!(m.gain >= minGain - EPS)) return;
        if (!best || better(m, best, setup.dropValue)) best = m;
      };
      if (open) {
        const pick = limited ? pickLimited(cur.solved, able, openAllows, freeCur, penCur) : pickFreeAgent(cur.solved, able, weights, openAllows);
        if (pick) consider({ add: pick.row.id, drop: null, gain: pick.gain });
      }
      // Drop moves: only with free agents the open spot can't take (a position limit), when there is one; under
      // starter limits nothing dominates, so every candidate.
      const closed = open && !limited;
      const dropCands = closed ? able.filter((c) => !openAllows(c.row)) : able;
      if (!dropCands.length) return best;
      let droppable: number[] = [];
      teamRows.forEach((row, k) => {
        if (onRoster.has(row.id) && !excluded(row.pos) && !keep.has(row.id) && (only === null || only(row.id))) droppable.push(k);
      });
      if (limited) droppable = undominatedDrops(droppable);
      if (!droppable.length) return best;

      // Bound each drop (the file header) and solve them best bound first. A drop's bound with a free agent is at most
      // his own add bound, so the free agents are taken largest add bound first, and only while that can still beat
      // the drop's best so far (the same bound, less work).
      let order: { k: number; bound: number }[];
      if (bounds) {
        const dropSet = new Set(dropCands);
        const usable = bounds.filter((b) => dropSet.has(b.c)).sort((a, b) => b.total - a.total);
        if (rem === null) rem = evRemovalWeeks(cur.solved) as Float64Array[];
        const removal = rem;
        const fits = new Map<string, boolean>();
        order = droppable.map((k) => {
          const kPos = (teamRows[k] as TableRow).pos;
          let left: Pos[] | null = null;
          // The weeks that count in which he starts: only there can dropping him cost the free agent anything.
          const starts: number[] = [];
          for (let w = 0; w < W; w++) if ((weights[w] ?? 0) > 0 && ((cur.solved.seat[w] as Int32Array)[k] as number) >= 0) starts.push(w);
          let bound = Number.NEGATIVE_INFINITY;
          for (const b of usable) {
            if (b.total <= bound) break;
            const key = `${kPos}|${b.c.row.pos}`;
            let ok = fits.get(key);
            if (ok === undefined) {
              left ??= withoutOne(positions, kPos);
              ok = positionAllows(limits, left, b.c.row.pos);
              fits.set(key, ok);
            }
            if (!ok) continue;
            let x = b.total;
            for (const w of starts) {
              const u = b.ub[w] as number;
              const alt = (b.c.row.ev[w] as number) - ((removal[w] as Float64Array)[k] as number);
              if (alt < u) x -= (weights[w] as number) * (u - alt);
            }
            if (x > bound) bound = x;
          }
          return { k, bound };
        });
        order.sort((a, b) => b.bound - a.bound || a.k - b.k);
      } else if (freeCur && penCur && relaxed) {
        // Under starter limits, the same bound on the relaxed lineups, plus how far the limited one falls short each week:
        // L(X − k + a) − L(X) ≤ R(X − k + a) − R(X) + (R(X) − L(X)) (the file header).
        const fr = freeCur;
        const pn = penCur;
        const relaxedSlots = relaxed;
        const remR = evRemovalWeeks(fr) as Float64Array[];
        const dropSet = new Set(dropCands);
        const usable = able
          .filter((c) => dropSet.has(c))
          .map((c) => {
            const rub = Float64Array.from(addUpperBoundWeeks(fr, c.row, slotMask(relaxedSlots, c.row.pos, c.row.eligible)) as Float64Array);
            let total = 0;
            for (let w = 0; w < W; w++) total += (weights[w] ?? 0) * ((pn[w] as number) + (rub[w] as number));
            return { c, rub, total };
          })
          .sort((a, b) => b.total - a.total);
        order = droppable.map((k) => {
          const kPos = (teamRows[k] as TableRow).pos;
          const left = withoutOne(positions, kPos);
          const starts: number[] = [];
          for (let w = 0; w < W; w++) if ((weights[w] ?? 0) > 0 && ((fr.seat[w] as Int32Array)[k] as number) >= 0) starts.push(w);
          let bound = Number.NEGATIVE_INFINITY;
          for (const b of usable) {
            if (b.total <= bound) break;
            if (!positionAllows(limits, left, b.c.row.pos)) continue;
            let x = b.total;
            for (const w of starts) {
              const u = b.rub[w] as number;
              const alt = (b.c.row.ev[w] as number) - ((remR[w] as Float64Array)[k] as number);
              if (alt < u) x -= (weights[w] as number) * (u - alt);
            }
            if (x > bound) bound = x;
          }
          return { k, bound };
        });
        order.sort((a, b) => b.bound - a.bound || a.k - b.k);
      } else {
        order = droppable.map((k) => ({ k, bound: Number.POSITIVE_INFINITY }));
      }
      for (const { k, bound } of order) {
        const top = best as Move | null;
        const threshold = Math.max(minGain, top ? top.gain : minGain) - EPS;
        if (bound < threshold) break;
        // At most a tie with the best found, which this drop would lose (an open spot wins ties, then the lower value,
        // then the smaller id): no need to solve it.
        if (top && bound <= top.gain + EPS && (top.drop === null || !dropFirst((teamRows[k] as TableRow).id, top.drop))) continue;
        const m = dropMove(k, dropCands, closed ? "closed" : "all");
        if (m) consider(m);
      }
      // Near-ties (the file header): when the best move cuts a player worth more than W, its free agent for another droppable
      // player worth less, within nearTie of it (each priced exactly: swapFor).
      return nearTiePick(best, teamRows, droppable, (ks, a) => ks.flatMap((k) => swapFor(k, a) ?? []));
    };

    let first: { move: Move | null } | null = null;
    return {
      best: () => {
        if (!first) first = { move: search(roster.length < setup.maxRosterSize, null) };
        return first.move;
      },
      bestDrop: (only) => search(false, only),
    };
  };

  /**
   * Scenario-judged moves (setup.scenarios > 0; the file header, "Judging moves in scenario lineups"): a roster's
   * scenario lineups kept cell by cell and its scenario ROS, memoized by roster along a run's path.
   */
  type ScenEntry = { cells: ScenarioCells; ros: number; team: TeamEval; values: ScenarioValues };
  const scenMemo = new Map<string, ScenEntry>();
  const scenEval = (roster: readonly string[], stream: StreamSpec): ScenEntry => {
    const key = rosterKey(roster, stream);
    const hit = scenMemo.get(key);
    if (hit) return hit;
    const { team } = evaluate(roster, stream);
    const v = scenarioValues(team, W, S, setup.instanceIndex ?? null, true, true);
    const out = { cells: v.cells as ScenarioCells, ros: rosValue(v.mean, weights), team, values: v };
    scenMemo.set(key, out);
    return out;
  };
  /**
   * The scenario lineups of the roster after a move (applyStep), from the roster's before it (teamValue.
   * scenarioValuesAfterMove: only the patterns the move can change are solved again; bit for bit scenarioValues'), so the
   * next scan finds them in the memo. From scratch when the rows aren't the move's (a memoized roster of another order).
   */
  const scenEvalAfter = (prev: ScenEntry, roster: readonly string[], stream: StreamSpec, team: TeamEval, move: Move): void => {
    const key = rosterKey(roster, stream);
    if (scenMemo.has(key)) return;
    // An open-spot add sits after the roster's players, before the streaming rows and the returners (evaluate's order).
    const at = move.drop === null ? prev.team.rows.length - stream.rows.length - returnersOf(stream).length : prev.team.rows.findIndex((r) => r.id === move.drop);
    const incremental = at >= 0 && team.rows[at]?.id === move.add ? scenarioValuesAfterMove(prev.values, team, { drop: move.drop === null ? null : at, at }, W, S, setup.instanceIndex ?? null, true, true) : null;
    const v = incremental ?? scenarioValues(team, W, S, setup.instanceIndex ?? null, true, true);
    scenMemo.set(key, { cells: v.cells as ScenarioCells, ros: rosValue(v.mean, weights), team, values: v });
  };

  /**
   * scenScan's cheap bound on a free agent's scenario add gain, his own availability ignored, for the roster `cells` kept:
   * Σ_w ω_w / S × Σ_p n_p × max(0, his points − p's floor), n_p the scenarios in pattern p (teamValue.scenarioCellFloors),
   * never below the exact gain. Before it, a cheaper one (every scenario at the week's lowest floor: Σ_w ω_w max(0,
   * points − lowest)) is returned when it is already below `bar`. +Infinity without floors (starter limits). Speed only:
   * the bounds decide which free agents are priced exactly, never a gain.
   */
  const cheapBounds = (cells: ScenarioCells): ((row: TableRow, mask: number, bar: number) => number) => {
    const Sc = cells.scenarios;
    const tables = new Map<number, { lo: Float64Array; floors: Float64Array[] } | null>();
    // Scenarios per pattern, per week (the same for every mask).
    const counts = cells.pattern.map((pat, w) => {
      const n = new Float64Array((cells.lv[w] as Float64Array).length);
      for (let s = 0; s < pat.length; s++) n[pat[s] as number] = (n[pat[s] as number] as number) + 1;
      return n;
    });
    return (row, mask, bar) => {
      let t = tables.get(mask);
      if (t === undefined) {
        const floors = scenarioCellFloors(cells, mask);
        t = floors ? { lo: Float64Array.from(floors, (fl) => fl.reduce((m, x) => (x < m ? x : m), Number.POSITIVE_INFINITY)), floors } : null;
        tables.set(mask, t);
      }
      if (!t) return Number.POSITIVE_INFINITY;
      let ub0 = 0;
      for (let w = 0; w < W; w++) {
        const wt = weights[w] ?? 0;
        const c = row.cond[w] as number;
        if (!(wt > 0) || !(c > 0)) continue;
        const x = c - (t.lo[w] as number);
        if (x > 0) ub0 += wt * x;
      }
      if (ub0 < bar) return ub0;
      let ub = 0;
      for (let w = 0; w < W; w++) {
        const wt = weights[w] ?? 0;
        const c = row.cond[w] as number;
        if (!(wt > 0) || !(c > 0)) continue;
        const fl = t.floors[w] as Float64Array;
        const n = counts[w] as Float64Array;
        let sum = 0;
        for (let p = 0; p < fl.length; p++) {
          const x = c - (fl[p] as number);
          if (x > 0) sum += (n[p] as number) * x;
        }
        ub += (wt / Sc) * sum;
      }
      return ub;
    };
  };

  /**
   * The best scenario-judged move from `roster` (the file header): every free agent a whose scenario add bound on the
   * roster (teamValue.scenarioAddUpperBound) reaches faMinGain and the best gain found is solved once, as the roster
   * plus him (T + a, cells kept): adding him into an open spot gains g_a = ROS(T + a) − ROS(T), and dropping k for him
   * gains exactly g_a − k's removal cost in T + a (teamValue.scenarioRemovalCosts: LV(T − k + a) = LV(T + a) − that
   * cost, cell by cell), so one solve prices every drop. Free agents go best bound first, and the scan stops once no
   * bound can reach the best move (a swap gains at most what adding its free agent alone gains). The candidate, drop and
   * tie rules are scanMoves' (an open spot first, then the lower value dropped, then the smaller ids), the pool's and the
   * keep set's too.
   */
  const scenScan = (roster: readonly string[], cur: { cells: ScenarioCells; ros: number; team: TeamEval }, stream: StreamSpec, added: ReadonlySet<string>, pool: PoolRestriction, keep: ReadonlySet<string> = NO_KEEP): Move | null => {
    stats.steps++;
    const streamed = new Set<Pos>(stream.positions);
    const excluded = (pos: Pos) => always.has(pos) || streamed.has(pos);
    const onRoster = new Set(roster);
    const taken = pool.excluded;
    // A cheap bound first (his own availability ignored): per week, per pattern, his points above the floor there,
    // weighted by the scenarios in the pattern (cheapBounds). Only those reaching faMinGain get scenarioAddUpperBound.
    const cheap = cheapBounds(cur.cells);
    const scored: { c: FreeAgentCandidate; ub: number }[] = [];
    for (const c of candidates) {
      if (onRoster.has(c.row.id) || added.has(c.row.id) || taken.has(c.row.id) || excluded(c.row.pos)) continue;
      if (c.mask === 0 || c.row.flags === null || cheap(c.row, c.mask, minGain - EPS) < minGain - EPS) continue;
      const ub = scenarioAddUpperBound(cur.cells, c.row, c.mask, weights);
      if (ub >= minGain - EPS) scored.push({ c, ub });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.c.row.id, b.c.row.id));
    const positions: Pos[] = roster.flatMap((id) => {
      const info = setup.info(id);
      return info ? [info.pos] : [];
    });
    const open = roster.length < setup.maxRosterSize;
    const teamRows = cur.team.rows;
    const droppable: number[] = [];
    teamRows.forEach((row, k) => {
      if (onRoster.has(row.id) && !excluded(row.pos) && !keep.has(row.id)) droppable.push(k);
    });
    // The lineup-fill rule (scanMoves'): structural fill without k, and whether a newcomer of a kind restores it.
    let fillBefore: number | null = null;
    const neededMemo = new Map<number, { rest: LineupCandidate[]; needed: boolean; restores: Map<string, boolean> }>();
    const fillOk = (k: number, a: TableRow): boolean => {
      let f = neededMemo.get(k);
      if (!f) {
        fillBefore ??= fillCount(entries(roster, stream), slots);
        const id = (teamRows[k] as TableRow).id;
        const rest = entries(
          roster.filter((x) => x !== id),
          stream,
        );
        f = { rest, needed: fillCount(rest, slots) < fillBefore, restores: new Map() };
        neededMemo.set(k, f);
      }
      if (!f.needed) return true;
      const kind = `${a.pos}|${a.eligible.join(",")}`;
      let ok = f.restores.get(kind);
      if (ok === undefined) {
        ok = fillCount([...f.rest, { id: a.id, pos: a.pos, eligible: a.eligible }], slots) >= (fillBefore as number);
        f.restores.set(kind, ok);
      }
      return ok;
    };
    let best: Move | null = null;
    // Every move priced, by add and drop, for the near-ties below (only with a tolerance).
    const priced = new Map<string, Move>();
    const moveKey = (add: string, drop: string | null) => `${add}\u0000${drop ?? ""}`;
    const consider = (m: Move) => {
      if (nearTie > 0) priced.set(moveKey(m.add, m.drop), m);
      if (!(m.gain >= minGain - EPS)) return;
      if (!best || better(m, best, setup.dropValue)) best = m;
    };
    const pairOk = (k: number, a: TableRow): boolean => {
      const kRow = teamRows[k] as TableRow;
      if (!positionAllows(limits, withoutOne(positions, kRow.pos), a.pos)) return false;
      if (dyn && dyn.value(kRow.id) - dyn.value(a.id) > dyn.maxDrop + EPS) return false;
      return fillOk(k, a);
    };
    // The bound on dropping k for a, cell by cell (week w, scenario s, pattern p of T): when a plays, a swap gains at
    // most min(his add bound there, his points − k's removal cost there) (LV(T − k + a) ≤ LV(T + a), and ≤ LV(T − k) +
    // his points); when he doesn't, exactly −k's removal cost. Near exact: a free agent is solved only when some
    // swap's bound (or the open spot's) reaches the best move.
    let remCells: Float64Array[] | null | undefined;
    const n = teamRows.length;
    const swapBounds = (a: TableRow, mask: number, ks: readonly number[]): Float64Array => {
      if (remCells === undefined) remCells = scenarioRemovalCells(cur.cells);
      const floors = scenarioCellFloors(cur.cells, mask);
      if (!remCells || !floors) return new Float64Array(ks.length).fill(Number.POSITIVE_INFINITY);
      const acc = new Float64Array(ks.length);
      const f = a.flags;
      const stride = a.cond.length;
      const Sc = cur.cells.scenarios;
      // The scenarios of each (pattern, whether he plays) cell are counted first, so each cell's terms are added once,
      // times its count (speed only: a bound, summed in another order).
      let cellCounts = new Int32Array(0);
      for (let w = 0; w < W; w++) {
        const wt = weights[w] ?? 0;
        if (!(wt > 0)) continue;
        const c = a.cond[w] as number;
        const pat = cur.cells.pattern[w] as Int32Array;
        const fl = floors[w] as Float64Array;
        const rem = remCells[w] as Float64Array;
        const scale = wt / Sc;
        const P = fl.length;
        if (cellCounts.length < 2 * P) cellCounts = new Int32Array(2 * P);
        else cellCounts.fill(0, 0, 2 * P);
        for (let sc = 0; sc < Sc; sc++) {
          const plays = f !== null && c > 0 && f[sc * stride + w] === 1 ? 1 : 0;
          const cell = 2 * (pat[sc] as number) + plays;
          cellCounts[cell] = (cellCounts[cell] as number) + 1;
        }
        for (let p = 0; p < P; p++) {
          const at = p * n;
          const out = cellCounts[2 * p] as number;
          if (out > 0) {
            const x = scale * out;
            for (let j = 0; j < ks.length; j++) acc[j] = (acc[j] as number) - x * (rem[at + (ks[j] as number)] as number);
          }
          const inn = cellCounts[2 * p + 1] as number;
          if (inn > 0) {
            const x = scale * inn;
            const u = Math.max(0, c - (fl[p] as number));
            for (let j = 0; j < ks.length; j++) acc[j] = (acc[j] as number) + x * Math.min(u, c - (rem[at + (ks[j] as number)] as number));
          }
        }
      }
      return acc;
    };
    for (const { c, ub } of scored) {
      const top = best as Move | null;
      const bar = Math.max(minGain, top ? top.gain : minGain) - EPS;
      if (ub < bar) break;
      const a = c.row;
      const openFits = open && positionAllows(limits, positions, a.pos);
      // A swap is never better than the open spot for a free agent the open spot can take (scanMoves' rule).
      const pairs = openFits && !limited ? [] : droppable.filter((k) => pairOk(k, a));
      const bounds = pairs.length ? swapBounds(a, c.mask, pairs) : null;
      const ks = pairs.filter((_, j) => ((bounds as Float64Array)[j] as number) >= bar);
      if (!openFits && !ks.length) continue;
      stats.dropsSolved++;
      // Exact gains without solving T + a whole: only the scenarios the move can change (teamValue.scenarioMoveGains: the
      // add's and every swap's, bit for bit scenarioAddGain's and scenarioSwapGains', sharing their solves).
      const gains = scenarioMoveGains(cur.cells, ks, a, c.mask, weights, openFits);
      if (openFits) consider({ add: a.id, drop: null, gain: gains.add });
      ks.forEach((k, j) => consider({ add: a.id, drop: (teamRows[k] as TableRow).id, gain: gains.swaps[j] as number }));
    }
    // Near-ties (the file header): when the best move cuts a player worth more than W, its free agent for another droppable
    // player worth less, within nearTie of it: the swaps priced above as they are, the rest pruned by their bounds as above
    // and priced at once (scenarioMoveGains prices each swap on its own: the same bits as above).
    return nearTiePick(best, teamRows, droppable, (ks, a, bar) => {
      const mask = slotMask(slots, a.pos, a.eligible);
      const known: Move[] = [];
      const rest: number[] = [];
      for (const k of ks) {
        const m = priced.get(moveKey(a.id, (teamRows[k] as TableRow).id));
        if (m) known.push(m);
        else if (pairOk(k, a)) rest.push(k);
      }
      const bounds = rest.length ? swapBounds(a, mask, rest) : null;
      const solve = rest.filter((_, j) => ((bounds as Float64Array)[j] as number) >= bar - EPS);
      if (!solve.length) return known;
      stats.dropsSolved++;
      const gains = scenarioMoveGains(cur.cells, solve, a, mask, weights, false);
      return [...known, ...solve.map((k, j) => ({ add: a.id, drop: (teamRows[k] as TableRow).id, gain: gains.swaps[j] as number }))];
    });
  };

  /** The best move from `roster` (null when no move qualifies or none exists): scanMoves' best. */
  const bestMove = (roster: readonly string[], cur: { team: TeamEval; solved: SolvedWeeks; evRos: number }, stream: StreamSpec, added: ReadonlySet<string>, pool: PoolRestriction, keep: ReadonlySet<string> = NO_KEEP): Move | null =>
    scanMoves(roster, cur, stream, added, null, pool, keep).best();

  /** A keep set's players on the start roster, sorted (the file header, "The keep set"): none when it holds nobody there. */
  const keptOn = (start: readonly string[], keep: readonly string[]): string[] => {
    if (!keep.length) return [];
    const onStart = new Set(start);
    return [...new Set(keep)].filter((id) => onStart.has(id)).sort();
  };
  /** A memo key's keep part: empty without kept players, so a run without one keeps its key. */
  const keepKey = (kept: readonly string[]): string => (kept.length ? `\u0007${kept.join("\u0000")}` : "");

  const optimize = (start: readonly string[], stream: StreamSpec = NO_STREAM, budget: number = maxMoves, pool: PoolRestriction = FULL_POOL, keep: readonly string[] = []): OptimizedRoster => {
    const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
    // The keep set (the file header): its players on the roster, sorted; in the memo key only when there are any, so a
    // run without one keeps its key (the League model's and the trade context's runs share one optimizer).
    const kept = keptOn(start, keep);
    const key = `${rosterKey(start, stream)}\u0002${limit}\u0005${pool.key}${keepKey(kept)}`;
    const hit = memo.get(key);
    if (hit) {
      stats.hits++;
      return hit;
    }
    stats.runs++;
    const keepSet: ReadonlySet<string> = kept.length ? new Set(kept) : NO_KEEP;
    const first = [...new Set(start)];
    let roster = first;
    let cur = evaluate(roster, stream);
    const moves: FaStep[] = [];
    const added = new Set<string>();
    for (let step = 0; step < limit; step++) {
      const scen = judgeScen ? scenEval(roster, stream) : null;
      const move = scen ? scenScan(roster, scen, stream, added, pool, keepSet) : bestMove(roster, cur, stream, added, pool, keepSet);
      if (!move) break;
      roster = applyStep(roster, move);
      added.add(move.add);
      const next = evaluate(roster, stream);
      if (scen) scenEvalAfter(scen, roster, stream, next.team, move);
      moves.push({ add: move.add, drop: move.drop, gainEv: next.evRos - cur.evRos });
      cur = next;
    }
    const out: OptimizedRoster = { start: first, roster, moves, team: cur.team, solved: cur.solved, evRos: cur.evRos, given: [] };
    memo.set(key, out);
    return out;
  };

  // Re-running from an optimized roster (the file header): each original run's pickups, with the player each one's
  // move dropped (who comes back when it is given back; null = it went into an open spot).
  const serials = new WeakMap<OptimizedRoster, number>();
  const origins = new WeakMap<OptimizedRoster, ReadonlyMap<string, string | null>>();
  const originsOf = (from: OptimizedRoster): ReadonlyMap<string, string | null> => {
    let o = origins.get(from);
    if (!o) {
      const map = new Map<string, string | null>();
      for (const m of from.moves) {
        // A move that dropped an earlier pickup swapped it: the new one holds that pickup's place and origin.
        if (m.drop !== null && map.has(m.drop)) {
          map.set(m.add, map.get(m.drop) ?? null);
          map.delete(m.drop);
        } else {
          map.set(m.add, m.drop);
        }
      }
      o = map;
      origins.set(from, o);
    }
    return o;
  };
  let nextSerial = 0;
  const serialOf = (from: OptimizedRoster): number => {
    let s = serials.get(from);
    if (s === undefined) {
      s = nextSerial++;
      serials.set(from, s);
    }
    return s;
  };
  const extraOf = (extra: number) => (Number.isFinite(extra) ? Math.max(0, Math.floor(extra)) : 0);
  /** The original run's pickups on `start`, with their origins, in the order its moves made them. */
  const pickupsOf = (from: OptimizedRoster, start: readonly string[]): Map<string, string | null> => {
    const on = new Set(start);
    const out = new Map<string, string | null>();
    for (const [id, k] of originsOf(from)) if (on.has(id)) out.set(id, k);
    return out;
  };

  const rerunMoves = (from: OptimizedRoster, start: readonly string[], extra: number): number => Math.max(0, maxMoves - pickupsOf(from, [...new Set(start)]).size) + extraOf(extra);

  /** Free agents the pool allows whose add bound on `base` reaches faMinGain (reoptimize's `base`; memoized by roster, streamed positions and pool). */
  const ableOn = new Map<string, ReadonlySet<string>>();
  const ableFor = (base: readonly string[], stream: StreamSpec, pool: PoolRestriction): ReadonlySet<string> | null => {
    if (limited) return null;
    const key = `${rosterKey(base, stream)}\u0005${pool.key}`;
    let out = ableOn.get(key);
    if (!out) {
      const e = evaluate(base, stream);
      const ids = new Set<string>();
      for (const c of candidates) if (!pool.excluded.has(c.row.id) && addUpperBound(e.solved, c.row, c.mask, weights) >= minGain - EPS) ids.add(c.row.id);
      out = ids;
      ableOn.set(key, out);
    }
    return out;
  };

  const reoptimize = (from: OptimizedRoster, start: readonly string[], stream: StreamSpec, extra: number, gone: readonly string[] = [], base?: readonly string[], pool: PoolRestriction = FULL_POOL, keep: readonly string[] = []): OptimizedRoster => {
    const more = extraOf(extra);
    const goneSet = new Set(gone);
    // The keep set (the file header), as optimize() reads it: in the memo key only when it holds a player of the start roster.
    const kept = keptOn(start, keep);
    const key = `${rosterKey(start, stream)}\u0003${serialOf(from)}\u0003${more}\u0003${[...goneSet].sort(byId).join(",")}\u0005${pool.key}${keepKey(kept)}`;
    const hit = memo.get(key);
    if (hit) {
      stats.hits++;
      return hit;
    }
    stats.runs++;
    const keepSet: ReadonlySet<string> = kept.length ? new Set(kept) : NO_KEEP;
    const first = [...new Set(start)];
    // The pickups on the roster (the original run's and this run's), each with the player its move dropped.
    const origin = pickupsOf(from, first);
    const isPickup = (id: string) => origin.has(id);
    let roster = first;
    let cur = evaluate(roster, stream);
    const moves: FaStep[] = [];
    const given: GivenBack[] = [];
    const added = new Set<string>();
    const limit = Math.max(0, maxMoves - origin.size) + more;
    const posOf = (id: string) => setup.info(id)?.pos;
    const positionsOf = (ids: readonly string[]): Pos[] =>
      ids.flatMap((id) => {
        const p = posOf(id);
        return p ? [p] : [];
      });
    for (let step = 0; step < limit; step++) {
      const scan = scanMoves(roster, cur, stream, added, step === 0 && base ? ableFor(base, stream, pool) : null, pool, keepSet);
      let move = scan.best();
      if (!move) break;
      const grows = move.drop === null || !isPickup(move.drop);
      if (grows && origin.size + 1 > maxMoves) {
        // One pickup too many: with the move made, give back the pickup whose loss costs least (the player his move
        // dropped comes back; none when he went into an open spot or that player is gone), when that beats not making
        // the move; else the best swap of a pickup (it adds none), else stop.
        const made = applyStep(roster, move);
        const positions = positionsOf(made);
        // The moved roster, solved once: what losing each pickup costs it (exact, nobody refilling his spot), and at
        // most what the player who comes back adds each week (his points, and what losing the pickup frees plus his
        // add bound): only give-backs that could beat not moving are solved. Under starter limits each one is.
        const m = evaluate(made, stream);
        const remW = limited ? null : (evRemovalWeeks(m.solved) as Float64Array[]);
        const at = new Map(m.team.rows.map((r, k) => [r.id, k]));
        const options: { w: string; back: string | null; next: string[]; ub: number; exact: boolean }[] = [];
        for (const [w, k] of origin) {
          // A kept player is never given back (a pickup in the keep set: a caller's own list may name one).
          if (!made.includes(w) || keepSet.has(w)) continue;
          const back = k !== null && !goneSet.has(k) && !made.includes(k) ? k : null;
          const wPos = posOf(w);
          const backPos = back === null ? undefined : posOf(back);
          if (backPos !== undefined && !positionAllows(limits, wPos ? withoutOne(positions, wPos) : positions, backPos)) continue;
          const next = back === null ? made.filter((id) => id !== w) : made.map((id) => (id === w ? back : id));
          let ub = Number.POSITIVE_INFINITY;
          // The bound is the roster's EV exactly when nobody comes back, or when he can add nothing (each week's part 0).
          let exact = false;
          const kw = at.get(w);
          const backRow = back === null ? undefined : setup.rows.get(back);
          if (remW && kw !== undefined && (back === null || backRow)) {
            const backUb = backRow ? addUpperBoundWeeks(m.solved, backRow, slotMask(slots, backRow.pos, backRow.eligible)) : null;
            ub = m.evRos;
            let backGain = 0;
            for (let wk = 0; wk < W; wk++) {
              const wt = weights[wk] ?? 0;
              if (!(wt > 0)) continue;
              const r = (remW[wk] as Float64Array)[kw] as number;
              ub -= wt * r;
              if (backRow && backUb) backGain += wt * Math.min(Math.max(0, backRow.ev[wk] as number), r + (backUb[wk] as number));
            }
            ub += backGain;
            exact = !(backGain > 0);
          }
          options.push({ w, back, next, ub, exact });
        }
        options.sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.w, b.w));
        let best: { w: string; back: string | null; roster: string[]; ev: number } | null = null;
        for (const o of options) {
          if (o.ub <= cur.evRos + EPS || (best && o.ub < best.ev - EPS)) break;
          const ev = o.exact ? o.ub : evaluate(o.next, stream).evRos;
          if (!best || ev > best.ev + EPS || (Math.abs(ev - best.ev) <= EPS && o.w < best.w)) best = { w: o.w, back: o.back, roster: o.next, ev };
        }
        if (best && best.ev > cur.evRos + EPS) {
          const next = evaluate(best.roster, stream);
          origin.set(move.add, move.drop);
          origin.delete(best.w);
          given.push({ pickup: best.w, back: best.back });
          added.add(move.add);
          moves.push({ add: move.add, drop: move.drop, gainEv: next.evRos - cur.evRos });
          roster = best.roster;
          cur = next;
          continue;
        }
        move = scan.bestDrop(isPickup);
        if (!move) break;
      }
      // A free move (a pickup within the cap, or a swap that keeps the pickups' count).
      if (move.drop !== null && origin.has(move.drop)) {
        origin.set(move.add, origin.get(move.drop) ?? null);
        origin.delete(move.drop);
      } else {
        origin.set(move.add, move.drop);
      }
      roster = applyStep(roster, move);
      added.add(move.add);
      const next = evaluate(roster, stream);
      moves.push({ add: move.add, drop: move.drop, gainEv: next.evRos - cur.evRos });
      cur = next;
    }
    // Each player who left `from`'s roster opened a spot. One the moves above left empty takes back a player a pickup's
    // move dropped: a run from scratch would have put that pickup there instead of dropping him (the one adding the most
    // EV points; ties: the earliest move), and the pickup counts as an open-spot add from then on. Even at no EV gain:
    // that is the optimizer's own tie rule (an open spot first, nobody lost), and the depth he adds counts in scenario
    // lineups.
    for (let open = from.roster.length - first.length; open > 0 && roster.length < setup.maxRosterSize; open--) {
      const positions = positionsOf(roster);
      // Each one's add bound first (best first; ties keep the moves' order), solved only while it could still win.
      const options: { w: string; k: string; row: TableRow | undefined; ub: number; at: number }[] = [];
      let at = 0;
      for (const [w, k] of origin) {
        at++;
        if (k === null || goneSet.has(k) || roster.includes(k)) continue;
        const kPos = posOf(k);
        if (kPos !== undefined && !positionAllows(limits, positions, kPos)) continue;
        const row = setup.rows.get(k);
        options.push({ w, k, row, ub: row ? addUpperBound(cur.solved, row, slotMask(slots, row.pos, row.eligible), weights) : Number.POSITIVE_INFINITY, at });
      }
      options.sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || a.at - b.at);
      let best: { w: string; back: string; gain: number; at: number } | null = null;
      for (const o of options) {
        if (best && o.ub < best.gain - EPS) break;
        const gain = o.row ? addGainExact(cur.solved, o.row, slotMask(slots, o.row.pos, o.row.eligible), weights).gain : evaluate([...roster, o.k], stream).evRos - cur.evRos;
        if (!best || gain > best.gain + EPS || (Math.abs(gain - best.gain) <= EPS && o.at < best.at)) best = { w: o.w, back: o.k, gain, at: o.at };
      }
      if (!best) break;
      origin.set(best.w, null);
      given.push({ pickup: null, back: best.back });
      roster = [...roster, best.back];
      cur = evaluate(roster, stream);
    }
    const out: OptimizedRoster = { start: first, roster, moves, team: cur.team, solved: cur.solved, evRos: cur.evRos, given };
    memo.set(key, out);
    return out;
  };

  const scenarioValuesOf = (roster: readonly string[], stream: StreamSpec = NO_STREAM): ScenarioValues | null => (judgeScen ? scenEval(roster, stream).values : null);
  // The memo only ever grows between trims, and a Map keeps insertion order (a set on a key it holds doesn't move it), so
  // its first `size` keys are the rosters memoized while it held at most `size`.
  const scenarioMemoSize = (): number => scenMemo.size;
  const trimScenarioMemo = (size: number): void => {
    const keep = Math.max(0, Math.floor(size));
    if (scenMemo.size <= keep) return;
    let i = 0;
    for (const key of [...scenMemo.keys()]) if (i++ >= keep) scenMemo.delete(key);
  };
  return { optimize, reoptimize, rerunMoves, evaluate, setup, cfg, stats, judgesScenarios: judgeScen, scenarioValuesOf, scenarioMemoSize, trimScenarioMemo };
}
