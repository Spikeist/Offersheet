/**
 * Team values (CLAUDE.md §7: weekly lineup value LV, rest of season ROS and PPW, marginal values MV_lose
 * and MV_add, the free agent a team adds when it loses a player; planner reply to Checkpoint 1,
 * addition C: availability scenarios give depth its credit). Pure and deterministic: no I/O, no clock
 * and no randomness of its own (scenario availability arrives as flags drawn by availability.ts); the
 * only tunable number, playoffWeight, comes from config.lineups.
 *
 * Input: a ProjectionTable (league.ts builds it), one row per relevant player: his conditional points
 * c_w = b·m_w (what he scores in week w when he plays, §6 steps 1–2), his expected points p_w = c_w·a_w
 * (§6 step 4), their weekly SDs (§6 step 5: σ = c_pos × points + d_pos, for c_w and for p_w) and S
 * availability scenarios (flags from availability.scenarioAvailability, drawn with common random
 * numbers, so a player's scenarios never depend on his team). Weeks are LeagueModel.weeks. A roster is
 * its ACTIVE players (team.roster); league.ts adds a team's streaming rows and its IR returners (Phase 4b: IR players
 * expected back, optimizer.StreamSpec.returners) wherever it values the team's lineup. Taxi players never start, and IR
 * players start only as returners.
 *
 * Streaming (CLAUDE.md §7 "Streaming positions"; Phase 4): a team that streams a position gets one virtual
 * row for it (streamRow, id `stream:<POS>`) whose points each week are the streaming replacement
 * (streamingReplacement: the config.streaming.streamRank-th best free agent at that position that week).
 * league.ts adds it to the team's rows wherever its lineup is valued; it takes no roster spot and is never
 * dropped, traded, a trade chip or a free-agent pick (league.ts keeps it apart from the team's players). The
 * functions here treat it as one more player at that position, so a streamed slot is worth max(the best
 * rostered player, the replacement) in every week and every scenario, exactly so where no flex takes the
 * position (K, D/ST, a QB without a superflex). Where a flex takes it too (TE and FLEX, QB and SUPER_FLEX or
 * OP), the streamer is one more player that week and starts wherever he helps most: in the flex when he beats
 * its starter, or in the position's slot with the team's own player moving to the flex, so the lineup can gain
 * more than that slot's max. Holding him to the position's own slot would change no lineup total, since the
 * team's own player then takes the flex instead (the solver's basis exchange; 0 of 20,000 random rosters
 * differed in the review of track A1), so he isn't held there. ⚠️ He takes no roster spot, as everywhere.
 *
 * Scenario flags are S × weeks row-major for the table's FULL week list, so every reader steps through
 * a row's flags with one stride, the row's own week count (flagStride), never the number of weeks a
 * caller solves or flags.length over the scenarios it asks for: solving only the first k weeks (the week
 * in progress before kickoff, league.ts), or the first S′ scenarios, reads the same flags as solving them
 * all.
 *
 * - Expected-value (EV) lineups: LV(T, w) = the best lineup of T's active roster for the points p_w
 *   (lineup.ts's exact solver). §12's screening uses these.
 * - Scenario lineups (addition C): in scenario s a player scores c_w when his flag says he plays that
 *   week and 0 when not; LV_s(T, w) is the best lineup for those points, LV(T, w) their mean over the S
 *   scenarios and sd their population spread. A bench RB behind two healthy stars never starts in the
 *   average-case lineup but starts in every scenario where a star is hurt, so depth counts. Per week one
 *   sort serves every scenario (lineupOrder), and scenarios in which the same players who could score
 *   are available (the same bitmask) share one solve: memoized per week, within a call. A row without
 *   flags counts as never available in scenarios (only taxi players lack them, and they never start;
 *   since Phase 4b IR players get flags, so a returner comes back in scenarios as his availability says).
 * - A player dropped from a week on (the roster spot an IR returner needs, league.ts step 5b): maskedRow
 *   zeroes his row from that week, and solveEvWeeksMasked / scenarioValuesMasked price the roster with it
 *   from the lineups without the mask, solving only the weeks (scenario patterns) where he started.
 * - The weekly score the season simulator draws (§8; TeamModel.score): with scenario lineups, the law of
 *   total variance. Given scenario s, the score is LV_s plus the noise of the starters who play in it
 *   (seated and available), each with his SD given he plays (condSd = c_pos × c_w + d_pos), independent:
 *   variance Σ condSd². So Var = E_s[Σ condSd²] (`within`, averaged over the scenarios) + Var_s(LV_s)
 *   (sd²): mean = the scenario mean, sd = sqrt(within + sd²) (scenarioScore; scenarioValues computes
 *   `within` only when asked, since it needs every lineup's seats). A starter who plays in fraction q of
 *   the scenarios adds q·condSd² + q(1 − q)·c_w² when he alone moves LV. With expected-value lineups
 *   there is no scenario spread: sd = sqrt(Σ σ_{i,w}²) over the EV lineup's starters, σ_{i,w} =
 *   c_pos × p_w + d_pos (PlayerModel.weekly[w].sd; evScore). Under starter limits a forced starter who
 *   can't play (a benched-out MFL TE) scores 0 and adds no spread.
 * - ROS(T) = Σ_w ω_w LV(T, w): ω = 1 in regular-season weeks and playoffWeight in playoff weeks. A
 *   remaining week that is neither (no adapter produces one: their weeks are contiguous) weighs 0, as no
 *   fantasy game is played in it. PPW = the average LV over the remaining regular-season weeks (0 when
 *   none remain).
 * - MV_lose and MV_add (§7 marginal values) compare rosters after the free-agent optimizer V* (src/engine/
 *   optimizer.ts; planner reply to Checkpoint 3, model change 2), built from this file's pieces: the best
 *   free agent for a roster (pickFreeAgent, exact), the bounds on what adding a player can gain
 *   (addUpperBound, addUpperBoundWeeks) and what losing each player costs (evRemovalCosts, evRemovalWeeks,
 *   scenarioRemovalCosts). league.ts wires them; Phase 2–3's one-move baseline V(T) is gone.
 * - MV_add without an auto drop (mvAddPpw): the average weekly EV LV gain of adding a player over a window
 *   of weeks, as partner fit reads it (a roster's own bench player dropped for him seldom changes its best
 *   lineup). Several players at once (addRowsGain, mvAddGroupPpw) take one lineup solve per week, so two
 *   players competing for one slot count once: without starter limits the joint gain is at most the sum
 *   of their own gains (the weighted rank of a matroid is submodular) and can be much less.
 * - MV_add with the drop, for trade chips (league.ts; CLAUDE.md §7): the ROS gain of adding a player to a
 *   base roster B′ (the team after its free-agent optimizer, minus the player it would drop when full) is
 *   addGainExact in EV lineups and scenarioAddGain in scenario lineups; the caller subtracts what the drop
 *   cost. The drop is the player whose loss costs that roster's lineup least (§7 roster legality: keep
 *   value = marginal ROS contribution; evRemovalCosts or scenarioRemovalCosts, then lowestKeepValue), with
 *   nobody refilling his spot: the newcomer takes it. (A lineup cost, MV_lose, refills it with free agents,
 *   so it can't pick the drop: a starter with a free agent almost as good costs his team ~0 there, but
 *   dropping him to make room loses all his points.)
 *
 * Pricing an added player fast, and still exactly: in a week whose best lineup has no free spot the
 * newcomer can reach (through Kuhn's augmenting paths: he takes a slot group, its starter shifts to
 * another group he fits, …), he can only replace a starter. The starters form a basis of a transversal
 * matroid (lineup.ts's header), so the new best lineup swaps him for the weakest starter on his
 * fundamental circuit, and every circuit member sits in a group reachable from his own. His gain that
 * week is therefore at most max(0, his points − the lowest reachable starter's points); with a reachable
 * free spot, at most his points. Candidates are solved in the order of that bound, weeks where it is 0
 * are skipped, and the search stops once no bound can reach the best gain found: the answers are exact.
 * Scenario lineups use the same bound cell by cell (scenarioAddUpperBound): scenarioValues can keep each
 * week's distinct availability patterns with their lineups (ScenarioCells), and in a scenario where the
 * newcomer doesn't play, or plays but can't beat the lowest starter he could reach, his gain is exactly
 * 0, so only the other patterns are solved again (scenarioAddGain), once per pattern.
 * The bound is in fact tight without starter limits (measured: 0 of 3,000 random rosters, standard,
 * superflex and IDP lineups, EV and scenario): every starter seated in a group he can reach can be pushed
 * out along the chain of shifts that reached it, so the weakest of them is exactly who he replaces. The
 * searches still solve the candidates they keep, so they stay exact without relying on that, but it is
 * why they solve about one candidate each.
 * With starter limits (MFL) nothing is bounded and every candidate and week is solved: a starter minimum
 * can force a newcomer into the lineup at 0 points, so his gain can even be negative.
 *
 * Pricing a removed player, exactly and without solving again: a bench player's loss costs nothing (the
 * same lineup is still the best), and the best lineup without a starter k is the lineup minus k plus the
 * best bench player who can take his place, or nobody (basis exchange in the transversal matroid: bench
 * player e can take k's place when k's slot group is among the groups e reaches, the reach above). So k's
 * loss costs a week (or a scenario pattern) his points minus that bench player's, or all his points when
 * nobody scoring more than 0 can step in. Under starter limits each roster without k is solved again.
 *
 * Swapping a player for a free agent (the optimizer's moves, optimizer.ts), bounded without solving: dropping
 * k and adding a gains at most what adding a alone gains (more players never lower the best lineup), in every
 * week; in a week k sits on the bench it gains exactly that (the best lineup with a never holds k), and in a
 * week k starts at most a's points minus what losing k costs that week (a newcomer adds at most his own
 * points). addUpperBoundWeeks and evRemovalWeeks give those per-week numbers. Without starter limits only.
 *
 * Speed (Phase 4 addendum, lead decision N6), each the same numbers as the plain way, bit for bit (teamValue.speed.test.ts
 * checks them against the code as it was, scenario.testing.ts):
 * - A lineup's slot groups as a graph (GroupGraph): the groups a newcomer reaches and the lowest starter there, built once
 *   per lineup instead of walking the starters again for every slot mask and every bench player (floors, removal costs).
 * - scenarioValues keeps each row's flags as one bitmask per week (up to 32 scenarios), finds each scenario's pattern from
 *   them, and allocates a week's buffers once; patterns, their order and every sum are as before.
 * - scenarioValuesAfterMove: a roster's scenario lineups after one move, from the roster's before it, solving only the
 *   patterns the move can change (the matroid argument there).
 * - scenarioMoveGains: a newcomer's add and swap gains at once, the benched drops sharing the add's solves.
 */
import { config } from "./config";
import { lineupOrder, lineupStarters, lineupTotal, prepareRoster, type LineupStarter, type PreparedRoster, type PreparedSlots } from "./lineup";
import { POSITIONS, type Pos } from "./model";
import { instancePointsInto, type InstanceIndex } from "./needs";
import { weeklySd, type ProjectionConfig } from "./projections";

/** Gains closer than this are ties or zero (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// The projection table

/** One relevant player's numbers per week of the table (league.ts builds them from his PlayerModel). */
export interface TableRow {
  readonly id: string;
  /** Primary position (starter limits count it) and every position he may fill. */
  readonly pos: Pos;
  readonly eligible: readonly Pos[];
  /** c_w = b·m_w: his points in week w when he plays (§6 steps 1–2). */
  readonly cond: Float64Array;
  /** p_w = c_w·a_w: his expected points (§6 step 4). */
  readonly ev: Float64Array;
  /** His SD in week w given he plays: c_pos × c_w + d_pos (§6 step 5 on his conditional points), 0 when c_w = 0. */
  readonly condSd: Float64Array;
  /** σ_{i,w} = c_pos × p_w + d_pos, 0 when p_w = 0 (§6 step 5; PlayerModel.weekly[w].sd): his spread in an EV lineup. */
  readonly evSd: Float64Array;
  /**
   * Availability scenarios (availability.ts; 1 = he plays), S × weeks row-major over the table's full week
   * list (scenario s, week w at s × cond.length + w: flagStride), or null without them.
   */
  readonly flags: Uint8Array | null;
}

export interface ProjectionTable {
  /** The remaining NFL weeks the rows cover (LeagueModel.weeks). */
  readonly weeks: readonly number[];
  /** Scenarios per row's flags (0 = none). */
  readonly scenarios: number;
  readonly rows: ReadonlyMap<string, TableRow>;
}

// ---------------------------------------------------------------------------------------------
// Streaming rows (CLAUDE.md §7 "Streaming positions"; planner reply to Checkpoint 3, model change 1)

/** Streaming rows' ids are `stream:<POS>`: never a player's (canonical ids are Sleeper ids or `${platform}:${id}`). */
export const STREAM_ID_PREFIX = "stream:";

/** The streaming row's id for a position ("stream:K"). */
export function streamRowId(pos: Pos): string {
  return `${STREAM_ID_PREFIX}${pos}`;
}

/** Whether an id is a streaming row's (a virtual row, never a player). */
export function isStreamId(id: string): boolean {
  return id.startsWith(STREAM_ID_PREFIX);
}

/**
 * The streaming replacement per week (§7 streaming positions; lead decision L1): in week w, the rank-th best
 * (1-based) of the candidates' expected points p_w (TableRow.ev: availability included, so a free agent on
 * bye or whose game has started scores 0 that week); fewer candidates than `rank` → the last one (the worst
 * of them); none → 0. The candidates are the free agents at one position. Ties don't matter here: equal
 * points give the same value whoever holds them (streamingPicks, league.ts, names players and breaks ties by
 * id). A rank below 1 reads as 1.
 */
export function streamingReplacement(candidates: readonly TableRow[], weekCount: number, rank: number): Float64Array {
  const out = new Float64Array(Math.max(0, weekCount));
  const n = candidates.length;
  if (n === 0) return out;
  const k = Math.min(n, Number.isFinite(rank) ? Math.max(1, Math.floor(rank)) : 1);
  const points = new Float64Array(n);
  for (let w = 0; w < out.length; w++) {
    for (let i = 0; i < n; i++) {
      const x = (candidates[i] as TableRow).ev[w];
      points[i] = typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
    }
    points.sort(); // ascending: the k-th best is k from the end
    out[w] = points[n - k] as number;
  }
  return out;
}

/**
 * The virtual row of a streamed position (lead decision L1): id streamRowId(pos), primary position `pos`,
 * eligible [pos], conditional and expected points both the replacement (it is already an expectation, so he
 * "plays" every scenario: flags all 1, S × weeks row-major like a player's), and the SD of those points
 * (§6 step 5, σ = c_pos × p + d_pos; 0 in a week the replacement is 0). It joins a team's lineup evaluation
 * only: the exact solver then values the slot at max(the best rostered player, the replacement) every week,
 * and where a flex takes the position too, he starts wherever he helps most (the file header). One row per
 * position, whatever the number of slots it can fill (a league starting two kickers still gets one streamer).
 */
export function streamRow(pos: Pos, replacement: ArrayLike<number>, scenarios: number, cfg: Pick<ProjectionConfig, "sigma"> = config.projections): TableRow {
  const points = Float64Array.from({ length: replacement.length }, (_, w) => {
    const x = replacement[w] as number;
    return Number.isFinite(x) && x > 0 ? x : 0;
  });
  const sd = Float64Array.from(points, (x) => weeklySd(x, pos, cfg));
  const S = Number.isFinite(scenarios) ? Math.max(0, Math.floor(scenarios)) : 0;
  return {
    id: streamRowId(pos),
    pos,
    eligible: [pos],
    cond: points,
    ev: Float64Array.from(points),
    condSd: sd,
    evSd: Float64Array.from(sd),
    flags: S > 0 ? new Uint8Array(S * points.length).fill(1) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// ROS and PPW

/** ω per week (§7): 1 in regular-season weeks, playoffWeight in playoff weeks, 0 in a week that is neither. */
export function weekWeights(weeks: readonly number[], regularWeeks: readonly number[], playoffWeeks: readonly number[], cfg: { readonly playoffWeight: number } = config.lineups): Float64Array {
  const regular = new Set(regularWeeks);
  const playoff = new Set(playoffWeeks);
  return Float64Array.from(weeks, (w) => (playoff.has(w) ? cfg.playoffWeight : regular.has(w) ? 1 : 0));
}

/** Equal weights 1 / (to − from) on the weeks [from, to), 0 elsewhere: a weekly average over a window (mvAddPpw). */
export function windowWeights(weekCount: number, from: number, to: number): Float64Array {
  const out = new Float64Array(Math.max(0, weekCount));
  const lo = Math.max(0, from);
  const hi = Math.min(out.length, to);
  for (let w = lo; w < hi; w++) out[w] = 1 / (hi - lo);
  return out;
}

/** ROS(T) = Σ_w ω_w LV(T, w) (§7). */
export function rosValue(lv: ArrayLike<number>, weights: ArrayLike<number>): number {
  let total = 0;
  for (let w = 0; w < lv.length; w++) total += (weights[w] ?? 0) * (lv[w] as number);
  return total;
}

/** PPW (§7): the average LV over the remaining regular-season weeks; 0 when none remain. */
export function ppw(lv: ArrayLike<number>, weeks: readonly number[], regularWeeks: readonly number[]): number {
  const regular = new Set(regularWeeks);
  let total = 0;
  let n = 0;
  weeks.forEach((w, i) => {
    if (!regular.has(w)) return;
    total += lv[i] ?? 0;
    n++;
  });
  return n > 0 ? total / n : 0;
}

// ---------------------------------------------------------------------------------------------
// Rosters

/** A roster prepared for repeated solves: lineup.ts's prepared roster and the table rows in its order. */
export interface TeamEval {
  readonly prep: PreparedRoster;
  readonly rows: readonly TableRow[];
}

/** Prepares rows (distinct players) against the league's slots. */
export function teamEval(rows: readonly TableRow[], slots: PreparedSlots): TeamEval {
  return { prep: prepareRoster(rows, slots), rows };
}

/** The rows of the given ids (duplicates and players without a row skipped). */
export function tableRows(ids: Iterable<string>, table: ProjectionTable): TableRow[] {
  const seen = new Set<string>();
  const out: TableRow[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = table.rows.get(id);
    if (row) out.push(row);
  }
  return out;
}

/** The bitmask of slot groups a player can fill (as prepareRoster computes it; 0 = none). */
export function slotMask(slots: PreparedSlots, pos: Pos, eligible: readonly Pos[]): number {
  let mask = 0;
  const own = POSITIONS.indexOf(pos);
  if (own >= 0) mask |= slots.posMask[own] as number;
  for (const e of eligible) {
    const i = POSITIONS.indexOf(e);
    if (i >= 0) mask |= slots.posMask[i] as number;
  }
  return mask;
}

// ---------------------------------------------------------------------------------------------
// Expected-value lineups

/** A roster's EV lineups, week by week, kept for pricing an added player. */
export interface SolvedWeeks {
  readonly team: TeamEval;
  /** EV LV per week. */
  readonly lv: Float64Array;
  /** Per week: EV points by roster index, and the canonical seats (lineupTotal's seat output, −1 = bench). */
  readonly pts: readonly Float64Array[];
  readonly seat: readonly Int32Array[];
  /** Per week: bitmask of slot groups with a free spot. */
  readonly open: Int32Array;
  /** Slot mask → per-week floor: the lowest starter a newcomer with that mask could displace (0 = he can reach a free spot). */
  readonly floors: Map<number, Float64Array>;
}

/** EV lineups of a roster for weeks [0, weekCount) (§7 LV with expected points). */
export function solveEvWeeks(team: TeamEval, weekCount: number): SolvedWeeks {
  const { prep, rows } = team;
  const n = rows.length;
  const groups = prep.slots.groups.length;
  const capacity = prep.slots.capacity;
  const lv = new Float64Array(weekCount);
  const open = new Int32Array(weekCount);
  const pts: Float64Array[] = [];
  const seat: Int32Array[] = [];
  const fill = new Int32Array(groups);
  // One buffer each for every week's points and seats (views per week): far fewer allocations on the optimizer's many solves.
  const ptsAll = new Float64Array(weekCount * n);
  const seatAll = new Int32Array(weekCount * n);
  for (let w = 0; w < weekCount; w++) {
    const p = ptsAll.subarray(w * n, (w + 1) * n);
    for (let k = 0; k < n; k++) p[k] = (rows[k] as TableRow).ev[w] as number;
    const s = seatAll.subarray(w * n, (w + 1) * n);
    lv[w] = lineupTotal(prep, p, null, s);
    fill.fill(0);
    for (let k = 0; k < n; k++) {
      const g = s[k] as number;
      if (g >= 0) fill[g] = (fill[g] as number) + 1;
    }
    let free = 0;
    for (let g = 0; g < groups; g++) if ((fill[g] as number) < (capacity[g] as number)) free |= 1 << g;
    open[w] = free;
    pts.push(p);
    seat.push(s);
  }
  return { team, lv, pts, seat, open, floors: new Map() };
}

/** Per week: starter points by slot instance for a solved roster's EV lineups (strength without scenarios). */
export function evInstancePoints(solved: SolvedWeeks, index: InstanceIndex): Float64Array[] {
  const n = solved.team.rows.length;
  return solved.pts.map((p, w) => instancePointsInto(index, solved.seat[w] as Int32Array, p, null, n, new Float64Array(index.size)));
}

/**
 * Whether roster index k of a solved roster is one of its starters (a trade chip's "starter" tag; lead
 * decision L5): he is in the EV lineup in at least half of the weeks that count (weights_w > 0) in which he
 * plays (p_w > 0). Never when he plays in none of them. A week where a starter limit seats him at 0 points
 * isn't one he plays.
 */
export function evStarter(solved: SolvedWeeks, k: number, weights: ArrayLike<number>): boolean {
  let plays = 0;
  let seated = 0;
  for (let w = 0; w < solved.lv.length; w++) {
    if (!((weights[w] ?? 0) > 0)) continue;
    if (!(((solved.pts[w] as Float64Array)[k] ?? 0) > 0)) continue;
    plays++;
    if (((solved.seat[w] as Int32Array)[k] ?? -1) >= 0) seated++;
  }
  return plays > 0 && 2 * seated >= plays;
}

/**
 * The slot groups a player who fits `mask` can reach in a lineup (seat[k] = player k's slot group, −1 = bench) are his own,
 * then every group a starter seated in a reached group also fits (the file header). A lineup's slot groups as a graph
 * gives them fast (speed only: the same sets and minimums, computed once per lineup instead of once per newcomer by walking
 * the starters again): per group g, `reach[g]` = the groups a newcomer who can take g reaches (g itself, then every group a
 * starter seated in a reached group also fits), and `min[g]` = the lowest points of a starter seated in g (+Infinity when
 * none). The groups reached from `mask` are the union of reach[g] over the groups in it (the walk is a closure, and the
 * closure of a union is the union of the closures), and the lowest starter there is the lowest min[g] over them.
 */
interface GroupGraph {
  readonly reach: Int32Array;
  readonly min: Float64Array;
}

/** Lowest set bit's index (mask ≠ 0). */
function lowBitIndex(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/** groupGraph for a lineup (seat[k] = player k's group, −1 = bench; pts[k] = his points there), into `out` (G groups). */
function groupGraphInto(seat: ArrayLike<number>, masks: Int32Array, n: number, pts: ArrayLike<number>, out: GroupGraph, adj: Int32Array): void {
  const G = out.reach.length;
  out.min.fill(Number.POSITIVE_INFINITY);
  adj.fill(0, 0, G);
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g < 0) continue;
    adj[g] = (adj[g] as number) | (masks[k] as number);
    const p = pts[k] as number;
    if (p < (out.min[g] as number)) out.min[g] = p;
  }
  for (let g = 0; g < G; g++) {
    let r = 1 << g;
    for (;;) {
      let next = r;
      for (let m = r; m !== 0; m &= m - 1) next |= adj[lowBitIndex(m)] as number;
      if (next === r) break;
      r = next;
    }
    out.reach[g] = r;
  }
}

/** The groups a newcomer with `mask` reaches, from a lineup's group graph: the union of reach[g] over the groups in `mask`. */
function reachOf(graph: GroupGraph, mask: number): number {
  let r = 0;
  for (let m = mask; m !== 0; m &= m - 1) r |= graph.reach[lowBitIndex(m)] as number;
  return r;
}

/** The lowest starter a newcomer with `mask` could displace (the file header): 0 when he reaches a free spot (`open`) or no starter. */
function floorOf(graph: GroupGraph, mask: number, open: number): number {
  const reach = reachOf(graph, mask);
  if ((reach & open) !== 0) return 0; // a free spot he can reach: floor 0
  let lo = Number.POSITIVE_INFINITY;
  for (let m = reach; m !== 0; m &= m - 1) {
    const v = graph.min[lowBitIndex(m)] as number;
    if (v < lo) lo = v;
  }
  return Number.isFinite(lo) ? lo : 0;
}

/** A SolvedWeeks' group graphs, one per week, built when first needed (floorsFor). */
const evGraphs = new WeakMap<SolvedWeeks, (GroupGraph | undefined)[]>();

function evGraph(base: SolvedWeeks, w: number): GroupGraph {
  let all = evGraphs.get(base);
  if (!all) {
    all = new Array<GroupGraph | undefined>(base.lv.length);
    evGraphs.set(base, all);
  }
  let graph = all[w];
  if (!graph) {
    const G = base.team.prep.slots.groups.length;
    graph = { reach: new Int32Array(G), min: new Float64Array(G) };
    groupGraphInto(base.seat[w] as Int32Array, base.team.prep.masks, base.team.prep.size, base.pts[w] as Float64Array, graph, new Int32Array(G));
    all[w] = graph;
  }
  return graph;
}

/**
 * See the file header: per week, the lowest starter a newcomer with `mask` could displace, 0 when he can
 * reach a free spot. Without starter limits only (callers don't bound under them).
 */
function floorsFor(base: SolvedWeeks, mask: number): Float64Array {
  const hit = base.floors.get(mask);
  if (hit) return hit;
  const W = base.lv.length;
  const floors = new Float64Array(W);
  for (let w = 0; w < W; w++) floors[w] = floorOf(evGraph(base, w), mask, base.open[w] as number);
  base.floors.set(mask, floors);
  return floors;
}

/**
 * floorsFor for callers outside this file (Phase 4's trade evaluation bounds many players of one slot mask against one
 * roster): per week, the lowest starter a newcomer with `mask` could displace in `base`'s EV lineups, 0 when he can reach
 * a free spot (cached per mask on `base`). Null under starter limits (nothing is bounded there).
 */
export function addFloors(base: SolvedWeeks, mask: number): Float64Array | null {
  if (base.team.prep.slots.limits !== null) return null;
  return floorsFor(base, mask);
}

/**
 * An upper bound on Σ_w weights_w · (LV(base + row, w) − LV(base, w)), the EV gain of adding `row` (mask =
 * slotMask of his positions). +Infinity under starter limits (no bound; see the file header).
 */
export function addUpperBound(base: SolvedWeeks, row: TableRow, mask: number, weights: ArrayLike<number>): number {
  if (mask === 0) return 0; // he fits no slot: never starts, never forced
  if (base.team.prep.slots.limits !== null) return Number.POSITIVE_INFINITY;
  const floors = floorsFor(base, mask);
  let ub = 0;
  for (let w = 0; w < base.lv.length; w++) {
    const wt = weights[w] ?? 0;
    const p = row.ev[w] as number;
    const f = floors[w] as number;
    if (wt > 0 && p > f) ub += wt * (p - f);
  }
  return ub;
}

/**
 * addUpperBound week by week, unweighted: out[w] = max(0, his points − the lowest starter he could displace),
 * his points when he can reach a free spot, 0 when he fits no slot. Null under starter limits (nothing is
 * bounded there). The free-agent optimizer bounds a swap with it (the file header).
 */
export function addUpperBoundWeeks(base: SolvedWeeks, row: TableRow, mask: number, out?: Float64Array): Float64Array | null {
  if (base.team.prep.slots.limits !== null) return null;
  const W = base.lv.length;
  const ub = out && out.length >= W ? out : new Float64Array(W);
  if (mask === 0) {
    ub.fill(0, 0, W);
    return ub;
  }
  const floors = floorsFor(base, mask);
  for (let w = 0; w < W; w++) {
    const p = row.ev[w] as number;
    const f = floors[w] as number;
    ub[w] = p > f ? p - f : 0;
  }
  return ub;
}

/**
 * The exact EV gain Σ_w weights_w · (LV(base + row, w) − LV(base, w)) of adding `row` to a roster that
 * doesn't have him, and the prepared roster with him. Without starter limits, weeks where the bound is 0
 * are skipped (his gain there is exactly 0).
 */
export function addGainExact(base: SolvedWeeks, row: TableRow, mask: number, weights: ArrayLike<number>): { gain: number; team: TeamEval } {
  const rows = [...base.team.rows, row];
  const team = teamEval(rows, base.team.prep.slots);
  if (mask === 0) return { gain: 0, team };
  const floors = base.team.prep.slots.limits === null ? floorsFor(base, mask) : null;
  const n = rows.length;
  const pts = new Float64Array(n);
  let gain = 0;
  for (let w = 0; w < base.lv.length; w++) {
    const wt = weights[w] ?? 0;
    const p = row.ev[w] as number;
    if (!(wt > 0) || (floors !== null && !(p > (floors[w] as number)))) continue;
    pts.set(base.pts[w] as Float64Array);
    pts[n - 1] = p;
    gain += wt * (lineupTotal(team.prep, pts) - (base.lv[w] as number));
  }
  return { gain, team };
}

/**
 * The exact EV gain Σ_w weights_w · (LV(base + rows, w) − LV(base, w)) of adding several players at once
 * (distinct, none of them on the roster; masks[j] = slotMask of rows[j]): one lineup solve per week, so
 * players who compete for one slot count once. Without starter limits a week where no newcomer's bound is
 * above 0 is skipped: each one's own gain is 0 there, and the joint gain is at most their sum (the file
 * header), so it's 0 too. One row gives addGainExact's gain; no rows give 0.
 */
export function addRowsGain(base: SolvedWeeks, rows: readonly TableRow[], masks: readonly number[], weights: ArrayLike<number>): number {
  if (rows.length !== masks.length) throw new Error(`addRowsGain: ${rows.length} rows but ${masks.length} masks`);
  if (rows.length === 0) return 0;
  const n0 = base.team.rows.length;
  const team = teamEval([...base.team.rows, ...rows], base.team.prep.slots);
  const floors = base.team.prep.slots.limits === null ? masks.map((mask) => (mask === 0 ? null : floorsFor(base, mask))) : null;
  const pts = new Float64Array(n0 + rows.length);
  let gain = 0;
  for (let w = 0; w < base.lv.length; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    if (floors !== null && !rows.some((r, j) => floors[j] !== null && (r.ev[w] as number) > ((floors[j] as Float64Array)[w] as number))) continue;
    pts.set(base.pts[w] as Float64Array);
    rows.forEach((r, j) => {
      pts[n0 + j] = r.ev[w] as number;
    });
    gain += wt * (lineupTotal(team.prep, pts) - (base.lv[w] as number));
  }
  return gain;
}

export interface FreeAgentCandidate {
  readonly row: TableRow;
  /** slotMask(slots, row.pos, row.eligible). */
  readonly mask: number;
}

export interface FreeAgentPick {
  readonly row: TableRow;
  /** Σ_w ω_w (LV(base + fa, w) − LV(base, w)) > 0. */
  readonly gain: number;
  /** The roster with him, prepared (scenario lineups reuse it). */
  readonly team: TeamEval;
}

/**
 * The free agent with the largest EV gain for `base` (§7 roster legality: the team adds the best
 * available free agent), ties to the smaller id; null when none would improve the lineup. `allowed`
 * filters candidates (position limits). Exact: candidates are solved in bound order until no bound can
 * reach the best gain (see the file header).
 */
export function pickFreeAgent(base: SolvedWeeks, candidates: readonly FreeAgentCandidate[], weights: ArrayLike<number>, allowed?: (row: TableRow) => boolean): FreeAgentPick | null {
  const scored: { c: FreeAgentCandidate; ub: number }[] = [];
  for (const c of candidates) {
    if (allowed && !allowed(c.row)) continue;
    const ub = addUpperBound(base, c.row, c.mask, weights);
    if (ub > EPS) scored.push({ c, ub });
  }
  scored.sort((a, b) => (a.ub === b.ub ? 0 : b.ub - a.ub) || byId(a.c.row.id, b.c.row.id));
  let best: FreeAgentPick | null = null;
  for (const { c, ub } of scored) {
    if (best && ub < best.gain - EPS) break;
    const { gain, team } = addGainExact(base, c.row, c.mask, weights);
    if (!(gain > EPS)) continue;
    if (!best || gain > best.gain + EPS || (Math.abs(gain - best.gain) <= EPS && c.row.id < best.row.id)) best = { row: c.row, gain, team };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Scenario lineups

export interface ScenarioValues {
  /** Per week: the mean LV over the scenarios, and its population SD. */
  readonly mean: Float64Array;
  readonly sd: Float64Array;
  /**
   * Per week: the mean over the scenarios of Σ condSd² over the starters who play in that scenario's
   * lineup (seated and available): the within-lineup variance of the law of total variance (scenarioScore).
   * Only when asked for (`spread`: it needs every lineup's seats); null otherwise.
   */
  readonly within: Float64Array | null;
  /** Per week: mean starter points by slot instance (only when an InstanceIndex was given). */
  readonly instances: Float64Array[] | null;
  /** Distinct lineups solved (after the memo; scenarioValuesAfterMove: not counting the lineups it kept). */
  readonly solves: number;
  /** The solved lineups cell by cell, for pricing an added player (only when `keep` was passed). */
  readonly cells: ScenarioCells | null;
}

/**
 * A roster's scenario lineups kept cell by cell (scenarioValues with `keep`), for pricing an added
 * player without solving again the scenarios he can't change (scenarioAddUpperBound, scenarioAddGain;
 * the file header). Per week, the distinct availability patterns its S scenarios fall into (the memo:
 * which of the players who can score that week play), with each pattern's LV, who plays, the seats and
 * the slot groups left with a free spot. A week nobody can score has one pattern, LV 0, nobody seated.
 */
export interface ScenarioCells {
  readonly team: TeamEval;
  readonly weekCount: number;
  readonly scenarios: number;
  /** Per week: each scenario's pattern (length S). */
  readonly pattern: readonly Int32Array[];
  /** Per week, per pattern: its LV. */
  readonly lv: readonly Float64Array[];
  /** Per week, per pattern: who plays, in roster order (1 = available with points that week). */
  readonly avail: readonly (readonly Uint8Array[])[];
  /** Per week, per pattern: lineupTotal's canonical seats (−1 = bench). */
  readonly seat: readonly (readonly Int32Array[])[];
  /** Per week, per pattern: bitmask of the slot groups with a free spot. */
  readonly open: readonly Int32Array[];
  /** Slot mask → per week, per pattern: the lowest starter a newcomer with that mask could displace (0 = he can reach a free spot). */
  readonly floors: Map<number, Float64Array[]>;
}

/** Bitmask of the slot groups a lineup leaves with a free spot (its seats; −1 = bench); `fill` is scratch, one entry per group. */
function openGroupsInto(slots: PreparedSlots, seat: Int32Array, n: number, fill: Int32Array): number {
  fill.fill(0);
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g >= 0) fill[g] = (fill[g] as number) + 1;
  }
  let free = 0;
  for (let g = 0; g < fill.length; g++) if ((fill[g] as number) < (slots.capacity[g] as number)) free |= 1 << g;
  return free;
}

/**
 * Row stride of a player's scenario flags: the table's full week count, which is his own (flags are
 * S × weeks row-major over the table's weeks, cond has one entry per week). Every reader uses it, so a
 * caller may solve fewer weeks, or fewer scenarios, than the table holds.
 */
function flagStride(row: TableRow): number {
  return row.cond.length;
}

/**
 * Scenario lineups (addition C) for weeks [0, weekCount) and the first S scenarios of the rows' flags:
 * per week the mean LV and its spread, optionally the mean instance points (slot strength), with `keep`
 * the lineups cell by cell (ScenarioCells), for pricing an added player, and with `spread` the
 * within-lineup variance (ScenarioValues.within) for the weekly score (scenarioScore).
 */
export function scenarioValues(team: TeamEval, weekCount: number, S: number, index: InstanceIndex | null = null, keep = false, spread = false): ScenarioValues {
  return scenarioValuesWith(team, weekCount, S, index, keep, spread, null);
}

/**
 * A pattern's lineup known without solving (scenarioValuesAfterMove): for week w and the pattern's first scenario s, its
 * LV, with its canonical seats written into `seat`; null when it must be solved.
 */
type LineupReuse = (w: number, s: number, seat: Int32Array) => number | null;

/** scenarioValues, with the lineups `reuse` knows taken from it instead of solved (the same LV and seats). */
function scenarioValuesWith(team: TeamEval, weekCount: number, S: number, index: InstanceIndex | null, keep: boolean, spread: boolean, reuse: LineupReuse | null): ScenarioValues {
  const { prep, rows } = team;
  const n = rows.length;
  const W = weekCount;
  const mean = new Float64Array(W);
  const sd = new Float64Array(W);
  const within = spread ? new Float64Array(W) : null;
  const instances = index ? Array.from({ length: W }, () => new Float64Array(index.size)) : null;
  let solves = 0;
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  const kept = keep
    ? {
        pattern: Array.from({ length: W }, () => new Int32Array(scenarios)),
        lv: [] as Float64Array[],
        avail: [] as Uint8Array[][],
        seat: [] as Int32Array[][],
        open: [] as Int32Array[],
      }
    : null;
  // A week nobody can score (or no scenarios, or no players): one pattern, LV 0, nobody seated.
  const allOpen = prep.slots.groups.length > 0 ? (2 ** prep.slots.groups.length - 1) | 0 : 0;
  const emptyWeek = () => {
    if (!kept) return;
    kept.lv.push(Float64Array.of(0));
    kept.avail.push([new Uint8Array(n)]);
    kept.seat.push([new Int32Array(n).fill(-1)]);
    kept.open.push(Int32Array.of(allOpen));
  };
  const result = (): ScenarioValues => ({
    mean,
    sd,
    within,
    instances,
    solves,
    cells: kept ? { team, weekCount: W, scenarios, pattern: kept.pattern, lv: kept.lv, avail: kept.avail, seat: kept.seat, open: kept.open, floors: new Map() } : null,
  });
  if (scenarios === 0 || n === 0) {
    for (let w = 0; w < W; w++) emptyWeek();
    return result();
  }

  const cond = new Float64Array(n);
  const avail = new Uint8Array(n);
  // Seats cost a canonical ordering per solve (lineup.ts), so they're read only when something needs the starters.
  const seat = index || kept || within || reuse ? new Int32Array(n) : null;
  const orderBuf = new Int32Array(n);
  const flags = rows.map((r) => r.flags);
  const stride = Int32Array.from(rows, (r) => flagStride(r));
  // Up to 32 scenarios, each row's flags as one bitmask per week (scenarioBits: speed only, the same flags).
  const bits = scenarios <= 32 ? rows.map((r) => scenarioBits(r)) : null;
  /** Whether player k plays in scenario s, week w (flagStride: the row's own week count, never W). */
  const plays = (k: number, s: number, w: number): boolean => {
    if (bits) {
      const b = bits[k];
      return b !== null && b !== undefined && (((b[w] as number) >>> s) & 1) === 1;
    }
    const f = flags[k];
    return f !== null && f !== undefined && f[s * (stride[k] as number) + w] === 1;
  };
  const groups = prep.slots.groups.length;
  const fill = new Int32Array(groups);
  const intKeys = new Int32Array(scenarios);
  const found = new Int32Array(scenarios);
  const firstOf = new Int32Array(scenarios);
  const counts = new Int32Array(scenarios);
  const scratchPattern = new Int32Array(scenarios);
  for (let w = 0; w < W; w++) {
    for (let k = 0; k < n; k++) cond[k] = (rows[k] as TableRow).cond[w] as number;
    const order = lineupOrder(prep, cond, orderBuf);
    const m = order.length;
    if (m === 0) {
      emptyWeek(); // nobody can score this week: LV 0 in every scenario
      continue;
    }
    avail.fill(0); // only this week's order is set below: nobody else plays (and can't score anyway)
    // Each scenario's pattern: which of the players who can score this week (order) play. Patterns are numbered in the
    // order they first occur; every scenario of a pattern shares one lineup (the memo).
    const weekPattern = kept ? (kept.pattern[w] as Int32Array) : scratchPattern;
    let P = 0;
    if (bits && m <= 30) {
      intKeys.fill(0);
      for (let i = 0; i < m; i++) {
        const b = bits[order[i] as number];
        if (!b) continue;
        const x = b[w] as number;
        if (x === 0) continue;
        const bit = 1 << i;
        for (let s = 0; s < scenarios; s++) if (((x >>> s) & 1) === 1) intKeys[s] = (intKeys[s] as number) | bit;
      }
      for (let s = 0; s < scenarios; s++) {
        const key = intKeys[s] as number;
        let slot = -1;
        for (let j = 0; j < P; j++) {
          if (found[j] === key) {
            slot = j;
            break;
          }
        }
        if (slot < 0) {
          slot = P++;
          found[slot] = key;
          firstOf[slot] = s;
          counts[slot] = 0;
        }
        counts[slot] = (counts[slot] as number) + 1;
        weekPattern[s] = slot;
      }
    } else {
      // More than 30 players who can score (or more than 32 scenarios): text keys.
      const memo = new Map<number | string, number>();
      for (let s = 0; s < scenarios; s++) {
        let key: number | string;
        if (m <= 30) {
          let k = 0;
          for (let i = 0; i < m; i++) if (plays(order[i] as number, s, w)) k |= 1 << i;
          key = k;
        } else {
          let text = "";
          for (let i = 0; i < m; i++) text += plays(order[i] as number, s, w) ? "1" : "0";
          key = text;
        }
        let slot = memo.get(key);
        if (slot === undefined) {
          slot = P++;
          memo.set(key, slot);
          firstOf[slot] = s;
          counts[slot] = 0;
        }
        counts[slot] = (counts[slot] as number) + 1;
        weekPattern[s] = slot;
      }
    }
    // One lineup per pattern, in the order the patterns first occur.
    const lvs = new Float64Array(P);
    const vars = within ? new Float64Array(P) : null;
    const size = index ? index.size : 0;
    const inst = index ? new Float64Array(P * size) : null;
    const whoAll = kept ? new Uint8Array(P * n) : null;
    const seatAll = kept ? new Int32Array(P * n) : null;
    const weekAvail: Uint8Array[] = [];
    const weekSeat: Int32Array[] = [];
    const weekOpen = kept ? new Int32Array(P) : null;
    for (let j = 0; j < P; j++) {
      const s = firstOf[j] as number;
      for (let i = 0; i < m; i++) {
        const k = order[i] as number;
        avail[k] = plays(k, s, w) ? 1 : 0;
      }
      const known = reuse && seat ? reuse(w, s, seat) : null;
      if (known === null) {
        lvs[j] = lineupTotal(prep, cond, avail, seat, order);
        solves++;
      } else lvs[j] = known;
      if (vars && seat) {
        // The starters who play (seated and available): Σ condSd² is this pattern's within-lineup variance.
        let v = 0;
        for (let k = 0; k < n; k++) {
          if ((seat[k] as number) < 0 || avail[k] !== 1) continue;
          const sdk = (rows[k] as TableRow).condSd[w] as number;
          v += sdk * sdk;
        }
        vars[j] = v;
      }
      if (index && inst && seat) instancePointsInto(index, seat, cond, avail, n, inst.subarray(j * size, (j + 1) * size));
      if (kept && whoAll && seatAll && weekOpen && seat) {
        // Who plays: the players who can score this week and play in this pattern (the rest score 0 anyway).
        const who = whoAll.subarray(j * n, (j + 1) * n);
        for (let i = 0; i < m; i++) {
          const k = order[i] as number;
          who[k] = avail[k] as number;
        }
        weekAvail.push(who);
        const kSeat = seatAll.subarray(j * n, (j + 1) * n);
        kSeat.set(seat);
        weekSeat.push(kSeat);
        weekOpen[j] = openGroupsInto(prep.slots, seat, n, fill);
      }
    }
    if (kept && weekOpen) {
      kept.lv.push(lvs);
      kept.avail.push(weekAvail);
      kept.seat.push(weekSeat);
      kept.open.push(weekOpen);
    }
    let mu = 0;
    for (let j = 0; j < P; j++) mu += (counts[j] as number) * (lvs[j] as number);
    mu = P === 1 ? (lvs[0] as number) : mu / scenarios;
    let ss = 0;
    if (P > 1) for (let j = 0; j < P; j++) ss += (counts[j] as number) * ((lvs[j] as number) - mu) ** 2;
    mean[w] = mu;
    sd[w] = Math.sqrt(ss / scenarios);
    if (within && vars) {
      let vw = 0;
      for (let j = 0; j < P; j++) vw += (counts[j] as number) * (vars[j] as number);
      within[w] = P === 1 ? (vars[0] as number) : vw / scenarios;
    }
    if (instances && index && inst) {
      const acc = instances[w] as Float64Array;
      for (let j = 0; j < P; j++) {
        const c = (counts[j] as number) / scenarios;
        for (let i = 0; i < size; i++) acc[i] = (acc[i] as number) + c * (inst[j * size + i] as number);
      }
    }
  }
  return result();
}

/**
 * One move on a roster (the free-agent optimizer's): `after` is `before`'s roster with the newcomer at roster index `at`,
 * either in the place of the player at index `drop` (at = drop, every other index the same) or, with drop null, added after
 * the players, before the streaming rows and the IR returners (indexes from `at` on move up by one).
 */
export interface RosterMove {
  drop: number | null;
  at: number;
}

/**
 * scenarioValues(after, …) bit for bit, from `before`'s scenario lineups kept cell by cell (scenarioValues with `keep`), where
 * `after` is `before`'s roster after one move (E's suggestion in the Phase 4 addendum: build a roster's scenario lineups
 * incrementally after a move; speed only). A pattern of `after` keeps the lineup of its first scenario's pattern in `before`
 * (its LV and seats) when the player dropped doesn't start there and the newcomer can't get in: he doesn't play, or his
 * points are below the lowest starter he could displace there (cellFloors, strictly). Then the matroid greedy takes the very
 * same players in the same order: every starter he could push out is taken before him (they score more) and spans him, and
 * a dropped bench player was spanned too (lineup.ts: rejected players never change what is taken, nor where, after them).
 * Every other pattern is solved as scenarioValues solves it, and every pattern's number, order and sums are scenarioValues'
 * own. Null (the caller solves from scratch) under starter limits, without kept cells, or when the shapes don't match.
 */
export function scenarioValuesAfterMove(before: ScenarioValues, after: TeamEval, move: RosterMove, weekCount: number, S: number, index: InstanceIndex | null = null, keep = false, spread = false): ScenarioValues | null {
  const cells = before.cells;
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  if (!cells || after.prep.slots.limits !== null || cells.scenarios !== scenarios || cells.weekCount < weekCount) return null;
  const n0 = cells.team.rows.length;
  const n = after.rows.length;
  const { drop, at } = move;
  if (drop === null ? n !== n0 + 1 : n !== n0 || drop !== at) return null;
  const row = after.rows[at];
  if (!row || at < 0 || at >= n) return null;
  // Every other row is `before`'s, in the move's order (the seats are copied index for index).
  for (let i = 0; i < n0; i++) if (i !== drop && after.rows[drop === null && i >= at ? i + 1 : i] !== cells.team.rows[i]) return null;
  const mask = after.prep.masks[at] as number;
  const bits = scenarioBits(row);
  const floors = mask !== 0 && bits !== null && scenarios <= 32 ? cellFloors(cells, mask) : null;
  if (mask !== 0 && bits !== null && !floors) return null; // more than 32 scenarios: no bits (scenarioValues reads the flags)
  const reuse: LineupReuse = (w, s, seat) => {
    const p = (cells.pattern[w] as Int32Array)[s] as number;
    const old = (cells.seat[w] as readonly Int32Array[])[p] as Int32Array;
    if (drop !== null && (old[drop] as number) >= 0) return null; // the player dropped starts there
    const c = row.cond[w] as number;
    if (floors && bits && c > 0 && (((bits[w] as number) >>> s) & 1) === 1 && !(c < ((floors[w] as Float64Array)[p] as number))) return null; // the newcomer can get in
    if (drop !== null) {
      seat.set(old);
      seat[at] = -1;
    } else {
      for (let i = 0; i < at; i++) seat[i] = old[i] as number;
      seat[at] = -1;
      for (let i = at; i < n0; i++) seat[i + 1] = old[i] as number;
    }
    return (cells.lv[w] as Float64Array)[p] as number;
  };
  return scenarioValuesWith(after, weekCount, scenarios, index, keep, spread, reuse);
}

// ---------------------------------------------------------------------------------------------
// A player dropped from a week on (the displacement an IR returner causes: league.ts step 5b)

/** Masked copies by row and first masked week, so the same mask is the same object (the scenario-bits cache, memo keys). */
const maskedRows = new WeakMap<TableRow, Map<number, TableRow>>();

/**
 * `row` with nothing from week index `from` on (planner reply to Checkpoint 4, change 5: the player a full roster drops when
 * an IR returner comes back): conditional and expected points, both SDs and every scenario's flags 0 in weeks ≥ from (the
 * flags' stride is the row's own week count, flagStride), the rest unchanged. `from` ≤ 0 masks every week; past the last
 * week, the row itself. Cached: the same row and week give the same object.
 */
export function maskedRow(row: TableRow, from: number): TableRow {
  const W = row.cond.length;
  const f = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : W;
  if (f >= W) return row;
  let byFrom = maskedRows.get(row);
  if (!byFrom) {
    byFrom = new Map();
    maskedRows.set(row, byFrom);
  }
  const hit = byFrom.get(f);
  if (hit) return hit;
  const cut = (xs: Float64Array) => {
    const out = Float64Array.from(xs);
    out.fill(0, f);
    return out;
  };
  let flags: Uint8Array | null = null;
  if (row.flags) {
    flags = Uint8Array.from(row.flags);
    const scenarios = W > 0 ? Math.floor(flags.length / W) : 0;
    for (let s = 0; s < scenarios; s++) flags.fill(0, s * W + f, (s + 1) * W);
  }
  const out: TableRow = { id: row.id, pos: row.pos, eligible: row.eligible, cond: cut(row.cond), ev: cut(row.ev), condSd: cut(row.condSd), evSd: cut(row.evSd), flags };
  byFrom.set(f, out);
  return out;
}

/** Whether `after` is `before`'s rows with row k replaced (the same objects, the same order, the same prepared slots). */
function sameRowsBut(before: TeamEval, after: TeamEval, k: number): boolean {
  const n = after.rows.length;
  if (n !== before.rows.length || k < 0 || k >= n || after.prep.slots !== before.prep.slots) return false;
  for (let i = 0; i < n; i++) if (i !== k && after.rows[i] !== before.rows[i]) return false;
  return true;
}

/**
 * solveEvWeeks(after, weekCount), bit for bit, from `before`'s lineups, where `after` is `before`'s team with row k replaced
 * by its masked copy from week index `from` on (maskedRow): a week before `from` keeps its lineup (the rows are the same),
 * and so does a week from `from` on where player k sat on the bench (removing a bench player never changes an optimal
 * lineup, and the matroid greedy seats the others where it seated them: scenarioValuesAfterMove's argument); only the weeks
 * he started are solved again, and under starter limits every week from `from` on (the same total, but the solver's seats
 * among equal lineups aren't argued there). From scratch when the shapes don't match.
 */
export function solveEvWeeksMasked(before: SolvedWeeks, after: TeamEval, k: number, from: number, weekCount: number): SolvedWeeks {
  if (!sameRowsBut(before.team, after, k) || before.lv.length < weekCount) return solveEvWeeks(after, weekCount);
  const { prep, rows } = after;
  const limited = prep.slots.limits !== null;
  const n = rows.length;
  const lv = new Float64Array(weekCount);
  const open = new Int32Array(weekCount);
  const ptsAll = new Float64Array(weekCount * n);
  const seatAll = new Int32Array(weekCount * n);
  const pts: Float64Array[] = [];
  const seat: Int32Array[] = [];
  const fill = new Int32Array(prep.slots.groups.length);
  for (let w = 0; w < weekCount; w++) {
    const p = ptsAll.subarray(w * n, (w + 1) * n);
    for (let j = 0; j < n; j++) p[j] = (rows[j] as TableRow).ev[w] as number;
    const s = seatAll.subarray(w * n, (w + 1) * n);
    const old = before.seat[w] as Int32Array;
    if (w < from || (!limited && (old[k] as number) < 0)) {
      s.set(old);
      lv[w] = before.lv[w] as number;
      open[w] = before.open[w] as number;
    } else {
      lv[w] = lineupTotal(prep, p, null, s);
      open[w] = openGroupsInto(prep.slots, s, n, fill);
    }
    pts.push(p);
    seat.push(s);
  }
  return { team: after, lv, pts, seat, open, floors: new Map() };
}

/**
 * scenarioValues(after, …) bit for bit, from `before`'s scenario lineups kept cell by cell (scenarioValues with `keep`), where
 * `after` is `before`'s team with row k replaced by its masked copy from week index `from` on (maskedRow). A pattern of
 * `after` keeps the lineup of its first scenario's pattern in `before` (its LV and seats) in a week before `from` (the rows
 * are the same there), and from `from` on when player k isn't seated in it (he sat or couldn't play: the matroid greedy
 * takes the very same players in the same places without him, scenarioValuesAfterMove's argument for a dropped bench
 * player); the others are solved. Null (the caller solves from scratch) under starter limits, without kept cells, or when
 * the shapes don't match.
 */
export function scenarioValuesMasked(before: ScenarioValues, after: TeamEval, k: number, from: number, weekCount: number, S: number, index: InstanceIndex | null = null, keep = false, spread = false): ScenarioValues | null {
  const cells = before.cells;
  const scenarios = Number.isFinite(S) ? Math.max(0, Math.floor(S)) : 0;
  if (!cells || after.prep.slots.limits !== null || cells.scenarios !== scenarios || cells.weekCount < weekCount || !sameRowsBut(cells.team, after, k)) return null;
  const reuse: LineupReuse = (w, s, seat) => {
    const p = (cells.pattern[w] as Int32Array)[s] as number;
    const old = (cells.seat[w] as readonly Int32Array[])[p] as Int32Array;
    if (w >= from && (old[k] as number) >= 0) return null; // he started there: solve it
    seat.set(old);
    return (cells.lv[w] as Float64Array)[p] as number;
  };
  return scenarioValuesWith(after, weekCount, scenarios, index, keep, spread, reuse);
}

/** A row's scenario flags as one bitmask per week of its table (bit s = he plays in scenario s), for the first 32 scenarios; null without flags. Cached per row. */
const scenarioBitsCache = new WeakMap<TableRow, Uint32Array>();

function scenarioBits(row: TableRow): Uint32Array | null {
  const f = row.flags;
  if (f === null) return null;
  const hit = scenarioBitsCache.get(row);
  if (hit) return hit;
  const stride = flagStride(row);
  const out = new Uint32Array(stride);
  const rowScenarios = stride > 0 ? Math.min(32, Math.floor(f.length / stride)) : 0;
  for (let s = 0; s < rowScenarios; s++) {
    const bit = 1 << s;
    for (let w = 0; w < stride; w++) if (f[s * stride + w] === 1) out[w] = (out[w] as number) | bit;
  }
  scenarioBitsCache.set(row, out);
  return out;
}

/**
 * Per week, per pattern: the lowest starter a newcomer with `mask` could displace, 0 when he can reach a
 * free spot (floorsFor's rule on each kept lineup; cached per mask). A seated player plays, so his points
 * are his conditional points that week. Without starter limits only (callers don't bound under them).
 */
function cellFloors(cells: ScenarioCells, mask: number): Float64Array[] {
  const hit = cells.floors.get(mask);
  if (hit) return hit;
  const W = cells.weekCount;
  const graphs = cellGraphs(cells);
  const out: Float64Array[] = [];
  for (let w = 0; w < W; w++) {
    const weekGraphs = graphs[w] as readonly GroupGraph[];
    const open = cells.open[w] as Int32Array;
    const floors = new Float64Array(weekGraphs.length);
    for (let p = 0; p < weekGraphs.length; p++) floors[p] = floorOf(weekGraphs[p] as GroupGraph, mask, open[p] as number);
    out.push(floors);
  }
  cells.floors.set(mask, out);
  return out;
}

/** Kept cells' group graphs (GroupGraph), per week, per pattern: a seated player plays, so his points are his conditional points that week. */
const cellGraphCache = new WeakMap<ScenarioCells, GroupGraph[][]>();

function cellGraphs(cells: ScenarioCells): GroupGraph[][] {
  const hit = cellGraphCache.get(cells);
  if (hit) return hit;
  const { team, weekCount: W } = cells;
  const { size: n, masks } = team.prep;
  const G = team.prep.slots.groups.length;
  const adj = new Int32Array(G);
  const pts = new Float64Array(n);
  const out: GroupGraph[][] = [];
  for (let w = 0; w < W; w++) {
    for (let k = 0; k < n; k++) pts[k] = (team.rows[k] as TableRow).cond[w] as number;
    const seats = cells.seat[w] as readonly Int32Array[];
    const P = seats.length;
    const reach = new Int32Array(P * G);
    const min = new Float64Array(P * G);
    const week: GroupGraph[] = [];
    for (let p = 0; p < P; p++) {
      const graph = { reach: reach.subarray(p * G, (p + 1) * G), min: min.subarray(p * G, (p + 1) * G) };
      groupGraphInto(seats[p] as Int32Array, masks, n, pts, graph, adj);
      week.push(graph);
    }
    out.push(week);
  }
  cellGraphCache.set(cells, out);
  return out;
}

/**
 * An upper bound on Σ_w weights_w · mean_s (LV_s(base + row, w) − LV_s(base, w)), the scenario gain of
 * adding `row` (mask = slotMask of his positions) to the roster `cells` kept (the file header): per
 * scenario and week, max(0, his points − the floor) when he plays, else 0. +Infinity under starter
 * limits (no bound). 0 without scenarios.
 */
export function scenarioAddUpperBound(cells: ScenarioCells, row: TableRow, mask: number, weights: ArrayLike<number>): number {
  const S = cells.scenarios;
  if (S === 0) return 0;
  if (cells.team.prep.slots.limits !== null) return Number.POSITIVE_INFINITY;
  const f = row.flags;
  if (mask === 0 || f === null) return 0; // he fits no slot, or never plays in scenarios
  const floors = cellFloors(cells, mask);
  const stride = flagStride(row);
  let ub = 0;
  for (let w = 0; w < cells.weekCount; w++) {
    const wt = weights[w] ?? 0;
    const c = row.cond[w] as number;
    if (!(wt > 0) || !(c > 0)) continue;
    const pattern = cells.pattern[w] as Int32Array;
    const fl = floors[w] as Float64Array;
    let sum = 0;
    for (let s = 0; s < S; s++) {
      if (f[s * stride + w] !== 1) continue;
      const floor = fl[pattern[s] as number] as number;
      if (c > floor) sum += c - floor;
    }
    ub += wt * (sum / S);
  }
  return ub;
}

/**
 * The exact scenario gain Σ_w weights_w · mean_s (LV_s(base + row, w) − LV_s(base, w)) of adding `row`
 * to the roster `cells` kept, which doesn't have him. Without starter limits, a scenario where he doesn't
 * play, or can't beat the floor, gains exactly 0 and isn't solved; the others are solved once per pattern
 * (he plays in all of them). Under starter limits every pattern is solved, with him playing or not (a
 * minimum can seat him at 0 points). It equals the difference of scenarioValues' means for the two
 * rosters (up to float rounding).
 */
export function scenarioAddGain(cells: ScenarioCells, row: TableRow, mask: number, weights: ArrayLike<number>): number {
  const S = cells.scenarios;
  if (S === 0) return 0;
  const limited = cells.team.prep.slots.limits !== null;
  const f = row.flags;
  if (!limited && (mask === 0 || f === null)) return 0;
  const floors = limited ? null : cellFloors(cells, mask);
  const stride = flagStride(row);
  const base = cells.team;
  const n0 = base.rows.length;
  const plus = teamEval([...base.rows, row], base.prep.slots);
  const cond = new Float64Array(n0 + 1);
  const avail = new Uint8Array(n0 + 1);
  const orderBuf = new Int32Array(n0 + 1);
  const solved = new Map<number, number>();
  let gain = 0;
  for (let w = 0; w < cells.weekCount; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    const c = row.cond[w] as number;
    if (!limited && !(c > 0)) continue;
    const pattern = cells.pattern[w] as Int32Array;
    const lv = cells.lv[w] as Float64Array;
    const fl = floors ? (floors[w] as Float64Array) : null;
    let order: Int32Array | null = null;
    solved.clear();
    let sum = 0;
    for (let s = 0; s < S; s++) {
      const plays = f !== null && f[s * stride + w] === 1 ? 1 : 0;
      const p = pattern[s] as number;
      if (fl && (plays === 0 || !(c > (fl[p] as number)))) continue; // exactly 0 (the file header)
      const key = 2 * p + plays;
      let delta = solved.get(key);
      if (delta === undefined) {
        if (order === null) {
          for (let k = 0; k < n0; k++) cond[k] = (base.rows[k] as TableRow).cond[w] as number;
          cond[n0] = c;
          order = lineupOrder(plus.prep, cond, orderBuf);
        }
        avail.set((cells.avail[w] as readonly Uint8Array[])[p] as Uint8Array);
        avail[n0] = plays;
        delta = lineupTotal(plus.prep, cond, avail, null, order) - (lv[p] as number);
        solved.set(key, delta);
      }
      sum += delta;
    }
    gain += wt * (sum / S);
  }
  return gain;
}

/**
 * The exact scenario gains of swaps: for each roster index k in `ks`, Σ_w weights_w · mean_s (LV_s(T − k + row, w) −
 * LV_s(T, w)) on the roster `cells` kept (T), which doesn't have `row`. Without starter limits, a scenario where k sits
 * on the bench and the newcomer doesn't play or can't beat the lowest starter he could displace gains exactly 0
 * (removing a bench player leaves the best lineup as it is, and he can't improve it); every other one is solved once
 * per (k, pattern, newcomer plays), with the newcomer added and k unavailable. Under starter limits every pattern is
 * solved. It equals the difference of scenarioValues' means for the two rosters (up to float rounding). The free-agent
 * optimizer's scenario-judged moves price their swaps with it.
 */
export function scenarioSwapGains(cells: ScenarioCells, ks: readonly number[], row: TableRow, mask: number, weights: ArrayLike<number>): Float64Array {
  const out = new Float64Array(ks.length);
  const S = cells.scenarios;
  if (S === 0 || ks.length === 0) return out;
  const limited = cells.team.prep.slots.limits !== null;
  const f = row.flags;
  const floors = limited || mask === 0 ? null : cellFloors(cells, mask);
  const stride = flagStride(row);
  const base = cells.team;
  const n0 = base.rows.length;
  const plus = teamEval([...base.rows, row], base.prep.slots);
  const cond = new Float64Array(n0 + 1);
  const avail = new Uint8Array(n0 + 1);
  const orderBuf = new Int32Array(n0 + 1);
  const solved = new Map<number, number>();
  for (let w = 0; w < cells.weekCount; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    const c = row.cond[w] as number;
    const pattern = cells.pattern[w] as Int32Array;
    const lv = cells.lv[w] as Float64Array;
    const seats = cells.seat[w] as readonly Int32Array[];
    const fl = floors ? (floors[w] as Float64Array) : null;
    let order: Int32Array | null = null;
    for (let j = 0; j < ks.length; j++) {
      const k = ks[j] as number;
      solved.clear();
      let sum = 0;
      for (let s = 0; s < S; s++) {
        const p = pattern[s] as number;
        const plays = f !== null && c > 0 && f[s * stride + w] === 1 ? 1 : 0;
        const kSeated = ((seats[p] as Int32Array)[k] as number) >= 0;
        if (!limited && !kSeated && (plays === 0 || mask === 0 || !(c > ((fl as Float64Array)[p] as number)))) continue; // exactly 0
        const key = 2 * p + plays;
        let delta = solved.get(key);
        if (delta === undefined) {
          if (order === null) {
            for (let i = 0; i < n0; i++) cond[i] = (base.rows[i] as TableRow).cond[w] as number;
            cond[n0] = c;
            order = lineupOrder(plus.prep, cond, orderBuf);
          }
          avail.set((cells.avail[w] as readonly Uint8Array[])[p] as Uint8Array);
          avail[k] = 0;
          avail[n0] = plays;
          delta = lineupTotal(plus.prep, cond, avail, null, order) - (lv[p] as number);
          solved.set(key, delta);
        }
        sum += delta;
      }
      out[j] = (out[j] as number) + wt * (sum / S);
    }
  }
  return out;
}

/**
 * scenarioAddGain (when `withAdd`) and scenarioSwapGains for one newcomer at once, bit for bit (the free-agent optimizer's
 * scenario-judged moves; speed only). Without starter limits, in a pattern where k sits on the bench (or can't play) the
 * swap's lineup is the newcomer's add lineup: the best lineup of T + row keeps out every player T's best lineup keeps out
 * (in the matroid greedy, a player rejected for T is spanned by the players taken before him, and adding the newcomer only
 * enlarges what they span), so the greedy takes the very same players with k available or not and sums the same points in
 * the same order. So that pattern's solve is done once for the add and every such k, instead of once per k. Under starter
 * limits, or for a newcomer who fits no slot or never plays in scenarios, the two functions themselves.
 */
export function scenarioMoveGains(cells: ScenarioCells, ks: readonly number[], row: TableRow, mask: number, weights: ArrayLike<number>, withAdd: boolean): { add: number; swaps: Float64Array } {
  const S = cells.scenarios;
  const f = row.flags;
  if (cells.team.prep.slots.limits !== null || S === 0 || mask === 0 || f === null) {
    return { add: withAdd ? scenarioAddGain(cells, row, mask, weights) : 0, swaps: scenarioSwapGains(cells, ks, row, mask, weights) };
  }
  const swaps = new Float64Array(ks.length);
  const floors = cellFloors(cells, mask);
  const stride = flagStride(row);
  const base = cells.team;
  const n0 = base.rows.length;
  const plus = teamEval([...base.rows, row], base.prep.slots);
  const cond = new Float64Array(n0 + 1);
  const avail = new Uint8Array(n0 + 1);
  const orderBuf = new Int32Array(n0 + 1);
  let add = 0;
  for (let w = 0; w < cells.weekCount; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    const c = row.cond[w] as number;
    const pattern = cells.pattern[w] as Int32Array;
    const lv = cells.lv[w] as Float64Array;
    const seats = cells.seat[w] as readonly Int32Array[];
    const avails = cells.avail[w] as readonly Uint8Array[];
    const fl = floors[w] as Float64Array;
    const P = lv.length;
    let order: Int32Array | null = null;
    const orderOf = (): Int32Array => {
      if (order === null) {
        for (let i = 0; i < n0; i++) cond[i] = (base.rows[i] as TableRow).cond[w] as number;
        cond[n0] = c;
        order = lineupOrder(plus.prep, cond, orderBuf);
      }
      return order;
    };
    // The newcomer's add delta per pattern (he plays), solved when first needed: shared by the add and every benched k.
    const added = new Float64Array(P).fill(Number.NaN);
    const addDelta = (p: number): number => {
      let d = added[p] as number;
      if (d !== d) {
        const o = orderOf();
        avail.set(avails[p] as Uint8Array);
        avail[n0] = 1;
        d = lineupTotal(plus.prep, cond, avail, null, o) - (lv[p] as number);
        added[p] = d;
      }
      return d;
    };
    if (withAdd && c > 0) {
      let sum = 0;
      for (let s = 0; s < S; s++) {
        const p = pattern[s] as number;
        if (f[s * stride + w] !== 1 || !(c > (fl[p] as number))) continue; // exactly 0 (scenarioAddGain)
        sum += addDelta(p);
      }
      add += wt * (sum / S);
    }
    if (!ks.length) continue;
    // Per k, the patterns where he starts: solved with him out (scenarioSwapGains' keys: pattern and whether the newcomer plays).
    const own = new Float64Array(2 * P);
    for (let j = 0; j < ks.length; j++) {
      const k = ks[j] as number;
      own.fill(Number.NaN);
      let sum = 0;
      for (let s = 0; s < S; s++) {
        const p = pattern[s] as number;
        const plays = c > 0 && f[s * stride + w] === 1 ? 1 : 0;
        if (((seats[p] as Int32Array)[k] as number) < 0) {
          if (plays === 0 || !(c > (fl[p] as number))) continue; // exactly 0 (scenarioSwapGains)
          sum += addDelta(p);
          continue;
        }
        const key = 2 * p + plays;
        let delta = own[key] as number;
        if (delta !== delta) {
          const o = orderOf();
          avail.set(avails[p] as Uint8Array);
          avail[k] = 0;
          avail[n0] = plays;
          delta = lineupTotal(plus.prep, cond, avail, null, o) - (lv[p] as number);
          own[key] = delta;
        }
        sum += delta;
      }
      swaps[j] = (swaps[j] as number) + wt * (sum / S);
    }
  }
  return { add, swaps };
}

// ---------------------------------------------------------------------------------------------
// Removing a player: what each one's loss costs a lineup (the drop that makes room)

/** Scratch for addRemovalCosts: the bench players who could step in, their points and the slot groups they reach, and the lineup's group graph. */
interface RemovalScratch {
  readonly pts: Float64Array;
  readonly reach: Int32Array;
  readonly graph: GroupGraph;
  readonly adj: Int32Array;
}

function removalScratch(n: number, groups: number): RemovalScratch {
  return { pts: new Float64Array(n), reach: new Int32Array(n), graph: { reach: new Int32Array(groups), min: new Float64Array(groups) }, adj: new Int32Array(groups) };
}

/**
 * Adds scale × (what losing him costs this lineup) to out[k] for every starter k (the file header, "Pricing a
 * removed player"): his points minus the most a bench player who can take his place scores (a bench player
 * e can when k's slot group is among the groups e reaches; nobody, or only players scoring 0, → his whole
 * points). A bench player costs nothing. `points` = what each player scores in this week or scenario
 * pattern (0 = can't play), `seat` = the lineup. Without starter limits only.
 */
function addRemovalCosts(points: ArrayLike<number>, seat: Int32Array, masks: Int32Array, n: number, scale: number, out: Float64Array, scratch: RemovalScratch, built: GroupGraph | null = null): void {
  let bench = 0;
  // The groups each bench player reaches, from the lineup's group graph: `built` (a kept cell's, cellGraphs: the same
  // seats), or built once here for the first bench player who needs it.
  let graph = built;
  for (let e = 0; e < n; e++) {
    if ((seat[e] as number) >= 0) continue;
    const pts = points[e] as number;
    if (!(pts > 0) || masks[e] === 0) continue;
    if (!graph) {
      groupGraphInto(seat, masks, n, points, scratch.graph, scratch.adj);
      graph = scratch.graph;
    }
    scratch.pts[bench] = pts;
    scratch.reach[bench] = reachOf(graph, masks[e] as number);
    bench++;
  }
  for (let k = 0; k < n; k++) {
    const g = seat[k] as number;
    if (g < 0) continue;
    let best = 0;
    for (let j = 0; j < bench; j++) {
      const pts = scratch.pts[j] as number;
      if (pts > best && (((scratch.reach[j] as number) >>> g) & 1) === 1) best = pts;
    }
    out[k] = (out[k] as number) + scale * ((points[k] as number) - best);
  }
}

/**
 * What losing each player costs a roster with EV lineups (§7 roster legality: keep value = marginal ROS
 * contribution): out[k] = Σ_w weights_w (LV(T, w) − LV(T − k, w)) for roster index k of `solved.team`, with
 * nobody refilling his spot. Exact (the file header): without starter limits no lineup is solved again;
 * under them each roster without k is.
 */
export function evRemovalCosts(solved: SolvedWeeks, weights: ArrayLike<number>): Float64Array {
  const { team } = solved;
  const n = team.rows.length;
  const W = solved.lv.length;
  const out = new Float64Array(n);
  if (team.prep.slots.limits !== null) {
    const before = rosValue(solved.lv, weights);
    for (let k = 0; k < n; k++) {
      const minus = teamEval(
        team.rows.filter((_, i) => i !== k),
        team.prep.slots,
      );
      out[k] = before - rosValue(solveEvWeeks(minus, W).lv, weights);
    }
    return out;
  }
  const scratch = removalScratch(n, team.prep.slots.groups.length);
  for (let w = 0; w < W; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    addRemovalCosts(solved.pts[w] as Float64Array, solved.seat[w] as Int32Array, team.prep.masks, n, wt, out, scratch);
  }
  return out;
}

/**
 * evRemovalCosts week by week, unweighted: out[w][k] = LV(T, w) − LV(T − k, w) for roster index k, nobody
 * refilling his spot (0 for a bench player). Null under starter limits (the optimizer then solves each
 * roster). The free-agent optimizer bounds a swap with it (the file header).
 */
export function evRemovalWeeks(solved: SolvedWeeks): Float64Array[] | null {
  const { team } = solved;
  if (team.prep.slots.limits !== null) return null;
  const n = team.rows.length;
  const scratch = removalScratch(n, team.prep.slots.groups.length);
  const all = new Float64Array(solved.pts.length * n);
  return solved.pts.map((pts, w) => {
    const out = all.subarray(w * n, (w + 1) * n);
    addRemovalCosts(pts, solved.seat[w] as Int32Array, team.prep.masks, n, 1, out, scratch);
    return out;
  });
}

/** Σ_w weights_w · the mean LV over the scenarios, from kept cells (scenarioValues' own arithmetic: patterns in order, a single pattern as is). */
function cellsRos(cells: ScenarioCells, weights: ArrayLike<number>): number {
  const S = cells.scenarios;
  let total = 0;
  for (let w = 0; w < cells.weekCount; w++) {
    const lv = cells.lv[w] as Float64Array;
    const counts = patternCounts(cells, w);
    let mu = 0;
    for (let j = 0; j < lv.length; j++) mu += (counts[j] as number) * (lv[j] as number);
    total += (weights[w] ?? 0) * (lv.length === 1 ? (lv[0] as number) : mu / S);
  }
  return total;
}

/** How many of the S scenarios fall into each of week w's patterns. */
function patternCounts(cells: ScenarioCells, w: number): Int32Array {
  const counts = new Int32Array((cells.lv[w] as Float64Array).length);
  const pattern = cells.pattern[w] as Int32Array;
  for (let s = 0; s < cells.scenarios; s++) {
    const p = pattern[s] as number;
    counts[p] = (counts[p] as number) + 1;
  }
  return counts;
}

/**
 * cellFloors for callers outside this file (the free-agent optimizer's scenario-judged moves): per week, per pattern of
 * `cells`, the lowest starter a newcomer with `mask` could displace (0 = he can reach a free spot; cached per mask).
 * Null under starter limits (nothing is bounded there).
 */
export function scenarioCellFloors(cells: ScenarioCells, mask: number): Float64Array[] | null {
  if (cells.team.prep.slots.limits !== null) return null;
  return cellFloors(cells, mask);
}

/**
 * scenarioRemovalCosts cell by cell and unweighted: per week, out[w][p·n + k] = LV_p(T, w) − LV_p(T − k, w) in pattern
 * p (n = the roster's rows), nobody refilling his spot (0 for a bench player; a seated player plays, so his points there
 * are his conditional points). Exact without starter limits; null under them. The optimizer bounds a swap with it.
 */
export function scenarioRemovalCells(cells: ScenarioCells): Float64Array[] | null {
  const { team, weekCount: W } = cells;
  if (team.prep.slots.limits !== null) return null;
  const n = team.rows.length;
  const scratch = removalScratch(n, team.prep.slots.groups.length);
  const graphs = cellGraphs(cells);
  const pts = new Float64Array(n);
  const out: Float64Array[] = [];
  for (let w = 0; w < W; w++) {
    const avail = cells.avail[w] as readonly Uint8Array[];
    const seats = cells.seat[w] as readonly Int32Array[];
    const P = seats.length;
    const week = new Float64Array(P * n);
    for (let p = 0; p < P; p++) {
      const who = avail[p] as Uint8Array;
      for (let k = 0; k < n; k++) pts[k] = who[k] === 1 ? ((team.rows[k] as TableRow).cond[w] as number) : 0;
      addRemovalCosts(pts, seats[p] as Int32Array, team.prep.masks, n, 1, week.subarray(p * n, (p + 1) * n), scratch, (graphs[w] as GroupGraph[])[p] as GroupGraph);
    }
    out.push(week);
  }
  return out;
}

/**
 * evRemovalCosts in scenario lineups: out[k] = Σ_w weights_w · mean_s (LV_s(T, w) − LV_s(T − k, w)) for
 * roster index k of the roster `cells` kept (scenarioValues with `keep`), nobody refilling his spot. Each
 * pattern is priced once and counted for its scenarios; a seated player plays, so his points there are his
 * conditional points. Exact (the file header): without starter limits no lineup is solved again; under
 * them each roster without k gets its own scenario lineups. 0s without scenarios.
 */
export function scenarioRemovalCosts(cells: ScenarioCells, weights: ArrayLike<number>): Float64Array {
  const { team, weekCount: W, scenarios: S } = cells;
  const n = team.rows.length;
  const out = new Float64Array(n);
  if (S === 0 || n === 0) return out;
  if (team.prep.slots.limits !== null) {
    const before = cellsRos(cells, weights);
    for (let k = 0; k < n; k++) {
      const minus = teamEval(
        team.rows.filter((_, i) => i !== k),
        team.prep.slots,
      );
      out[k] = before - rosValue(scenarioValues(minus, W, S).mean, weights);
    }
    return out;
  }
  const scratch = removalScratch(n, team.prep.slots.groups.length);
  const graphs = cellGraphs(cells);
  const pts = new Float64Array(n);
  for (let w = 0; w < W; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    const counts = patternCounts(cells, w);
    const avail = cells.avail[w] as readonly Uint8Array[];
    const seats = cells.seat[w] as readonly Int32Array[];
    for (let p = 0; p < counts.length; p++) {
      const count = counts[p] as number;
      if (count === 0) continue;
      const who = avail[p] as Uint8Array;
      for (let k = 0; k < n; k++) pts[k] = who[k] === 1 ? ((team.rows[k] as TableRow).cond[w] as number) : 0;
      addRemovalCosts(pts, seats[p] as Int32Array, team.prep.masks, n, (wt * count) / S, out, scratch, (graphs[w] as GroupGraph[])[p] as GroupGraph);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The weekly score the season simulator draws (§8; TeamModel.score)

/** A roster's weekly score distribution: per week, its mean and SD. */
export interface WeeklyScore {
  readonly mean: Float64Array;
  readonly sd: Float64Array;
}

/**
 * The weekly score with EV lineups (the file header): mean = LV, sd = sqrt(Σ σ_{i,w}²) over each week's
 * starters (TableRow.evSd; a starter a minimum forces in at 0 points adds nothing).
 */
export function evScore(solved: SolvedWeeks): WeeklyScore {
  const rows = solved.team.rows;
  const n = rows.length;
  const W = solved.lv.length;
  const sd = new Float64Array(W);
  for (let w = 0; w < W; w++) {
    const seat = solved.seat[w] as Int32Array;
    let v = 0;
    for (let k = 0; k < n; k++) {
      if ((seat[k] as number) < 0) continue;
      const s = (rows[k] as TableRow).evSd[w] as number;
      v += s * s;
    }
    sd[w] = Math.sqrt(v);
  }
  return { mean: Float64Array.from(solved.lv), sd };
}

/**
 * The weekly score with scenario lineups (the file header): mean = the scenario mean LV, sd =
 * sqrt(within + sd²), the law of total variance (ScenarioValues.within and .sd: scenarioValues with `spread`).
 */
export function scenarioScore(v: ScenarioValues): WeeklyScore {
  const within = v.within;
  if (!within) throw new Error("scenarioScore needs scenarioValues(…, spread = true)");
  return { mean: Float64Array.from(v.mean), sd: Float64Array.from(v.sd, (s, w) => Math.sqrt((within[w] as number) + s * s)) };
}

// ---------------------------------------------------------------------------------------------
// The player a full roster drops to make room (§7 roster legality)

/**
 * The player a full active roster drops to make room for a newcomer (§7 roster legality: the lowest "keep
 * value"; the League model's keep value is what losing him costs the roster's lineup, evRemovalCosts or
 * scenarioRemovalCosts, league.ts), ties within 1e-9 to the lower market value, then the smaller id. Null
 * without candidates.
 */
export function lowestKeepValue(candidates: readonly { readonly id: string; readonly keep: number; readonly value: number }[]): string | null {
  let best: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (!best) best = c;
    else if (c.keep < best.keep - EPS) best = c;
    else if (Math.abs(c.keep - best.keep) <= EPS && (c.value < best.value || (c.value === best.value && c.id < best.id))) best = c;
  }
  return best ? best.id : null;
}

// ---------------------------------------------------------------------------------------------
// Friendly API (tests, scripts, Phase 4): ids in, numbers out

/** EV lineups of an active roster (§7): LV per week and each week's starters. */
export function evLineups(roster: readonly string[], table: ProjectionTable, slots: PreparedSlots): { lv: number[]; starters: LineupStarter[][] } {
  const team = teamEval(tableRows(roster, table), slots);
  const solved = solveEvWeeks(team, table.weeks.length);
  return { lv: [...solved.lv], starters: solved.pts.map((p, w) => lineupStarters(team.prep, p, solved.seat[w] as Int32Array)) };
}

/** Scenario lineups of an active roster (addition C): mean LV and its SD per week, and mean instance points per week when an index is given. */
export function scenarioLineups(roster: readonly string[], table: ProjectionTable, slots: PreparedSlots, index: InstanceIndex | null = null): { lv: number[]; sd: number[]; instances: number[][] | null } {
  const team = teamEval(tableRows(roster, table), slots);
  const v = scenarioValues(team, table.weeks.length, table.scenarios, index);
  return { lv: [...v.mean], sd: [...v.sd], instances: v.instances ? v.instances.map((x) => [...x]) : null };
}

/**
 * An active roster's weekly score distribution (§8; TeamModel.score's rule): scenario lineups when the
 * table has scenarios (scenarioScore), else EV lineups (evScore), for weeks [0, weekCount) (default:
 * every week of the table). Scripts and Phase 4 price any roster with it; a week in progress needs a
 * table built before its first kickoff (league.ts preKickoffTable).
 */
export function rosterScore(roster: readonly string[], table: ProjectionTable, slots: PreparedSlots, weekCount = table.weeks.length): { mean: number[]; sd: number[] } {
  const team = teamEval(tableRows(roster, table), slots);
  const score = table.scenarios > 0 ? scenarioScore(scenarioValues(team, weekCount, table.scenarios, null, false, true)) : evScore(solveEvWeeks(team, weekCount));
  return { mean: [...score.mean], sd: [...score.sd] };
}

/**
 * MV_add without an auto drop (§7), per week: the average EV LV gain of adding `playerId` to the roster
 * over the weeks [from, to) (default: every week of the table). 0 when he's already on it or has no row.
 */
export function mvAddPpw(roster: readonly string[], playerId: string, table: ProjectionTable, slots: PreparedSlots, window?: { from: number; to: number }): number {
  const row = table.rows.get(playerId);
  if (!row || roster.includes(playerId)) return 0;
  const W = table.weeks.length;
  const base = solveEvWeeks(teamEval(tableRows(roster, table), slots), W);
  const weights = windowWeights(W, window?.from ?? 0, window?.to ?? W);
  return addGainExact(base, row, slotMask(slots, row.pos, row.eligible), weights).gain;
}

/**
 * MV_add of several players at once (partner fit): the average weekly EV LV gain of adding every one of
 * `playerIds` to the roster together over the weeks [from, to) (default: every week), one lineup per week.
 * Ids already on the roster, repeated or without a row are skipped; 0 when none is left.
 */
export function mvAddGroupPpw(roster: readonly string[], playerIds: readonly string[], table: ProjectionTable, slots: PreparedSlots, window?: { from: number; to: number }): number {
  const onRoster = new Set(roster);
  const rows = tableRows(
    playerIds.filter((id) => !onRoster.has(id)),
    table,
  );
  const W = table.weeks.length;
  const base = solveEvWeeks(teamEval(tableRows(roster, table), slots), W);
  const weights = windowWeights(W, window?.from ?? 0, window?.to ?? W);
  return addRowsGain(
    base,
    rows,
    rows.map((row) => slotMask(slots, row.pos, row.eligible)),
    weights,
  );
}

export interface FreeAgentOptions {
  /** ω per week (weekWeights). */
  weights: ArrayLike<number>;
  /** Max players per position on the active roster (settings.positionLimits; IR exempt). */
  positionLimits?: Partial<Record<Pos, number>>;
  /**
   * Positions of every player on the active roster passed in, players without a table row included
   * (default: the rows' positions).
   */
  rosterPositions?: readonly Pos[];
}

/** Whether position limits let a roster with these positions add a player at `pos`. */
export function positionAllows(limits: Partial<Record<Pos, number>> | undefined, rosterPositions: readonly Pos[], pos: Pos): boolean {
  const limit = limits?.[pos];
  if (limit === undefined || !Number.isFinite(limit)) return true;
  let count = 0;
  for (const p of rosterPositions) if (p === pos) count++;
  return count < limit;
}

/** The free agent a roster would add (§7): largest EV ROS gain among `candidates`, within position limits; null when none helps. */
export function bestFreeAgent(roster: readonly string[], candidates: readonly string[], table: ProjectionTable, slots: PreparedSlots, opts: FreeAgentOptions): { id: string; gain: number } | null {
  const rows = tableRows(roster, table);
  const onRoster = new Set(roster);
  const base = solveEvWeeks(teamEval(rows, slots), table.weeks.length);
  const positions = opts.rosterPositions ?? rows.map((r) => r.pos);
  const cands = tableRows(candidates, table)
    .filter((r) => !onRoster.has(r.id))
    .map((row) => ({ row, mask: slotMask(slots, row.pos, row.eligible) }));
  const pick = pickFreeAgent(base, cands, opts.weights, (row) => positionAllows(opts.positionLimits, positions, row.pos));
  return pick ? { id: pick.row.id, gain: pick.gain } : null;
}
