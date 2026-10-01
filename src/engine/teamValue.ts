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
 * its ACTIVE players (team.roster): IR and taxi players never start and are not candidates.
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
 *   flags counts as never available in scenarios (only IR and taxi players lack them, and they never
 *   start).
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
 * - MV_lose(T, i) = ROS(T) − ROS(T − i + fa) (§7 marginal values with the roster-legality add): fa is the
 *   free agent with the largest EV ROS gain for T − i (ties: the smaller id) among the candidates the
 *   active roster's position limits allow; none when no free agent would improve T − i's lineup. The EV
 *   and scenario versions use the same fa. As written, it goes negative for every bench player whenever
 *   a free agent beats one of T's starters (T − i + fa then beats T), so the League model measures lineup
 *   costs from V(T), the best ROS T reaches with one move (waiverAdjustment): MV_lose'(T, i) =
 *   V(T) − ROS(T − i + fa) ≥ 0, a constant shift within the team (surplus z-scores don't change).
 * - MV_add without an auto drop (mvAddPpw): the average weekly EV LV gain of adding a player over a window
 *   of weeks, as partner fit reads it (a roster's own bench player dropped for him seldom changes its best
 *   lineup). Several players at once (addRowsGain, mvAddGroupPpw) take one lineup solve per week, so two
 *   players competing for one slot count once: without starter limits the joint gain is at most the sum
 *   of their own gains (the weighted rank of a matroid is submodular) and can be much less.
 * - MV_add with the drop, for trade chips (league.ts; CLAUDE.md §7): the ROS gain of adding a player to a
 *   base roster B′ (the team after its best free-agent move, minus the player it would drop when full) is
 *   addGainExact in EV lineups and scenarioAddGain in scenario lineups; the caller subtracts what the drop
 *   cost. The drop is the player whose loss costs that roster's lineup least (§7 roster legality: keep
 *   value = marginal ROS contribution; evRemovalCosts or scenarioRemovalCosts, then lowestKeepValue), with
 *   nobody refilling his spot: the newcomer takes it. (A lineup cost, MV_lose, refills it with a free agent,
 *   so it can't pick the drop: a starting kicker with a free agent almost as good costs his team ~0 there,
 *   but dropping him to make room loses all his points.)
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
 */
import { config } from "./config";
import { lineupOrder, lineupStarters, lineupTotal, prepareRoster, type LineupStarter, type PreparedRoster, type PreparedSlots } from "./lineup";
import { POSITIONS, type Pos } from "./model";
import { instancePointsInto, type InstanceIndex } from "./needs";

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
  for (let w = 0; w < weekCount; w++) {
    const p = new Float64Array(n);
    for (let k = 0; k < n; k++) p[k] = (rows[k] as TableRow).ev[w] as number;
    const s = new Int32Array(n);
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
 * The slot groups a player who fits `mask` can reach in a lineup (seat[k] = player k's slot group, −1 =
 * bench): his own, then every group a starter seated in a reached group also fits (the file header).
 */
function reachFrom(mask: number, seat: Int32Array, masks: Int32Array, n: number): number {
  let reach = mask;
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = 0; k < n; k++) {
      const g = seat[k] as number;
      if (g < 0 || ((reach >>> g) & 1) === 0) continue;
      const next = reach | (masks[k] as number);
      if (next !== reach) {
        reach = next;
        changed = true;
      }
    }
  }
  return reach;
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
  const { size: n, masks } = base.team.prep;
  for (let w = 0; w < W; w++) {
    const seat = base.seat[w] as Int32Array;
    const pts = base.pts[w] as Float64Array;
    const reach = reachFrom(mask, seat, masks, n);
    if ((reach & (base.open[w] as number)) !== 0) continue; // a free spot he can reach: floor 0
    let lo = Number.POSITIVE_INFINITY;
    for (let k = 0; k < n; k++) {
      const g = seat[k] as number;
      if (g >= 0 && ((reach >>> g) & 1) === 1 && (pts[k] as number) < lo) lo = pts[k] as number;
    }
    floors[w] = Number.isFinite(lo) ? lo : 0;
  }
  base.floors.set(mask, floors);
  return floors;
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
  /** Distinct lineups solved (after the memo). */
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

/** Bitmask of the slot groups a lineup leaves with a free spot (its seats; −1 = bench). */
function openGroups(slots: PreparedSlots, seat: Int32Array, n: number): number {
  const fill = new Int32Array(slots.groups.length);
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
  const seat = index || kept || within ? new Int32Array(n) : null;
  const orderBuf = new Int32Array(n);
  const flags = rows.map((r) => r.flags);
  const stride = Int32Array.from(rows, (r) => flagStride(r));
  /** Whether player k plays in scenario s, week w (flagStride: the row's own week count, never W). */
  const plays = (k: number, s: number, w: number): boolean => {
    const f = flags[k];
    return f !== null && f !== undefined && f[s * (stride[k] as number) + w] === 1;
  };
  for (let w = 0; w < W; w++) {
    for (let k = 0; k < n; k++) cond[k] = (rows[k] as TableRow).cond[w] as number;
    const order = lineupOrder(prep, cond, orderBuf);
    const m = order.length;
    if (m === 0) {
      emptyWeek(); // nobody can score this week: LV 0 in every scenario
      continue;
    }
    avail.fill(0); // only this week's order is set below: nobody else plays (and can't score anyway)
    const memo = new Map<number | string, number>();
    const lvs: number[] = [];
    const vars: number[] = [];
    const counts: number[] = [];
    const rowsInst: Float64Array[] = [];
    const weekPattern = kept ? (kept.pattern[w] as Int32Array) : null;
    const weekAvail: Uint8Array[] = [];
    const weekSeat: Int32Array[] = [];
    const weekOpen: number[] = [];
    for (let s = 0; s < scenarios; s++) {
      let key: number | string;
      if (m <= 30) {
        let bits = 0;
        for (let i = 0; i < m; i++) if (plays(order[i] as number, s, w)) bits |= 1 << i;
        key = bits;
      } else {
        let text = "";
        for (let i = 0; i < m; i++) text += plays(order[i] as number, s, w) ? "1" : "0";
        key = text;
      }
      let slot = memo.get(key);
      if (slot === undefined) {
        for (let i = 0; i < m; i++) {
          const k = order[i] as number;
          avail[k] = plays(k, s, w) ? 1 : 0;
        }
        slot = lvs.length;
        memo.set(key, slot);
        lvs.push(lineupTotal(prep, cond, avail, seat, order));
        if (within && seat) {
          // The starters who play (seated and available): Σ condSd² is this pattern's within-lineup variance.
          let v = 0;
          for (let k = 0; k < n; k++) {
            if ((seat[k] as number) < 0 || avail[k] !== 1) continue;
            const sdk = (rows[k] as TableRow).condSd[w] as number;
            v += sdk * sdk;
          }
          vars.push(v);
        }
        counts.push(0);
        if (index && seat) rowsInst.push(instancePointsInto(index, seat, cond, avail, n, new Float64Array(index.size)));
        if (kept && seat) {
          // Who plays: the players who can score this week and play in this pattern (the rest score 0 anyway).
          const who = new Uint8Array(n);
          for (let i = 0; i < m; i++) {
            const k = order[i] as number;
            who[k] = avail[k] as number;
          }
          weekAvail.push(who);
          weekSeat.push(Int32Array.from(seat));
          weekOpen.push(openGroups(prep.slots, seat, n));
        }
        solves++;
      }
      counts[slot] = (counts[slot] as number) + 1;
      if (weekPattern) weekPattern[s] = slot;
    }
    if (kept) {
      kept.lv.push(Float64Array.from(lvs));
      kept.avail.push(weekAvail);
      kept.seat.push(weekSeat);
      kept.open.push(Int32Array.from(weekOpen));
    }
    let mu = 0;
    for (let j = 0; j < lvs.length; j++) mu += (counts[j] as number) * (lvs[j] as number);
    mu = lvs.length === 1 ? (lvs[0] as number) : mu / scenarios;
    let ss = 0;
    if (lvs.length > 1) for (let j = 0; j < lvs.length; j++) ss += (counts[j] as number) * ((lvs[j] as number) - mu) ** 2;
    mean[w] = mu;
    sd[w] = Math.sqrt(ss / scenarios);
    if (within) {
      let vw = 0;
      for (let j = 0; j < vars.length; j++) vw += (counts[j] as number) * (vars[j] as number);
      within[w] = vars.length === 1 ? (vars[0] as number) : vw / scenarios;
    }
    if (instances && index) {
      const acc = instances[w] as Float64Array;
      for (let j = 0; j < rowsInst.length; j++) {
        const v = rowsInst[j] as Float64Array;
        const c = (counts[j] as number) / scenarios;
        for (let i = 0; i < index.size; i++) acc[i] = (acc[i] as number) + c * (v[i] as number);
      }
    }
  }
  return result();
}

/**
 * Per week, per pattern: the lowest starter a newcomer with `mask` could displace, 0 when he can reach a
 * free spot (floorsFor's rule on each kept lineup; cached per mask). A seated player plays, so his points
 * are his conditional points that week. Without starter limits only (callers don't bound under them).
 */
function cellFloors(cells: ScenarioCells, mask: number): Float64Array[] {
  const hit = cells.floors.get(mask);
  if (hit) return hit;
  const { team, weekCount: W } = cells;
  const { size: n, masks } = team.prep;
  const out: Float64Array[] = [];
  for (let w = 0; w < W; w++) {
    const seats = cells.seat[w] as readonly Int32Array[];
    const open = cells.open[w] as Int32Array;
    const floors = new Float64Array(seats.length);
    for (let p = 0; p < seats.length; p++) {
      const seat = seats[p] as Int32Array;
      const reach = reachFrom(mask, seat, masks, n);
      if ((reach & (open[p] as number)) !== 0) continue; // a free spot he can reach: floor 0
      let lo = Number.POSITIVE_INFINITY;
      for (let k = 0; k < n; k++) {
        const g = seat[k] as number;
        const pts = (team.rows[k] as TableRow).cond[w] as number;
        if (g >= 0 && ((reach >>> g) & 1) === 1 && pts < lo) lo = pts;
      }
      floors[p] = Number.isFinite(lo) ? lo : 0;
    }
    out.push(floors);
  }
  cells.floors.set(mask, out);
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

// ---------------------------------------------------------------------------------------------
// Removing a player: what each one's loss costs a lineup (the drop that makes room)

/** Scratch for addRemovalCosts: the bench players who could step in, their points and the slot groups they reach. */
interface RemovalScratch {
  readonly pts: Float64Array;
  readonly reach: Int32Array;
}

/**
 * Adds scale × (what losing him costs this lineup) to out[k] for every starter k (the file header, "Pricing a
 * removed player"): his points minus the most a bench player who can take his place scores (a bench player
 * e can when k's slot group is among the groups e reaches; nobody, or only players scoring 0, → his whole
 * points). A bench player costs nothing. `points` = what each player scores in this week or scenario
 * pattern (0 = can't play), `seat` = the lineup. Without starter limits only.
 */
function addRemovalCosts(points: ArrayLike<number>, seat: Int32Array, masks: Int32Array, n: number, scale: number, out: Float64Array, scratch: RemovalScratch): void {
  let bench = 0;
  for (let e = 0; e < n; e++) {
    if ((seat[e] as number) >= 0) continue;
    const pts = points[e] as number;
    if (!(pts > 0) || masks[e] === 0) continue;
    scratch.pts[bench] = pts;
    scratch.reach[bench] = reachFrom(masks[e] as number, seat, masks, n);
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
  const scratch: RemovalScratch = { pts: new Float64Array(n), reach: new Int32Array(n) };
  for (let w = 0; w < W; w++) {
    const wt = weights[w] ?? 0;
    if (!(wt > 0)) continue;
    addRemovalCosts(solved.pts[w] as Float64Array, solved.seat[w] as Int32Array, team.prep.masks, n, wt, out, scratch);
  }
  return out;
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
  const scratch: RemovalScratch = { pts: new Float64Array(n), reach: new Int32Array(n) };
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
      addRemovalCosts(pts, seats[p] as Int32Array, team.prep.masks, n, (wt * count) / S, out, scratch);
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
// The best single move, and lineup costs measured from it

/**
 * A roster one move away from T: T − drop + add. drop null = into an open active-roster spot; add null =
 * a drop only (T − i when no free agent would improve its lineup). ev / scen = its ROS with EV lineups and
 * with scenario lineups (null without scenarios).
 */
export interface RosterMove {
  readonly add: string | null;
  readonly drop: string | null;
  readonly ev: number;
  readonly scen: number | null;
}

export interface WaiverAdjustment {
  /**
   * V(T) = the largest ROS among T itself and every candidate move, with EV lineups; vScen the same with
   * scenario lineups over the same candidate rosters (its maximum may come from another move; null without
   * scenarios). MV_lose'(T, i) = V(T) − ROS(T − i + fa_i) ≥ 0 for every candidate.
   */
  readonly vEv: number;
  readonly vScen: number | null;
  /**
   * The best move that adds a free agent, when it gains more than 1e-9 ROS points over T; else null. With
   * scenarios it is the scenario-best move (the lineup costs the League page shows are scenario costs, so
   * the move it shows is the one they're measured from); without them, the EV-best.
   */
  readonly best: RosterMove | null;
}

/** Whether move a beats move b for "best" (see waiverAdjustment's ties); `byScen` ranks by scenario ROS first. */
function betterMove(a: RosterMove, b: RosterMove, dropValue: (id: string) => number, byScen: boolean): boolean {
  const scenKnown = a.scen !== null && b.scen !== null;
  if (byScen && scenKnown && Math.abs((a.scen as number) - (b.scen as number)) > EPS) return (a.scen as number) > (b.scen as number);
  if (Math.abs(a.ev - b.ev) > EPS) return a.ev > b.ev;
  if ((a.drop === null) !== (b.drop === null)) return a.drop === null;
  if (!byScen && scenKnown && Math.abs((a.scen as number) - (b.scen as number)) > EPS) return (a.scen as number) > (b.scen as number);
  if (a.drop !== null && b.drop !== null && a.drop !== b.drop) {
    const va = dropValue(a.drop) || 0;
    const vb = dropValue(b.drop) || 0;
    return va !== vb ? va < vb : a.drop < b.drop;
  }
  return (a.add ?? "") < (b.add ?? "");
}

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

/**
 * V(T) and the team's best single free-agent move (§7 marginal values with roster legality; the planner's
 * fix for negative lineup costs). `base` is T's own ROS, `moves` the rosters one move away: T − i + fa_i for
 * each player i (fa_i = the free agent T − i would add, or none) and, when the active roster has an open
 * spot, T + fa (the free agent T itself would add).
 *
 * Every lineup cost is then V(T) − ROS(after): never below 0, and a constant shift of §7's
 * ROS(T) − ROS(T − i + fa_i) within the team, so the surplus score's within-roster z-scores are unchanged.
 * A drop-only move counts in V (so no cost is negative) but is never `best`: it only beats T under
 * starter limits, when a roster that can't meet a minimum gets lineup.ts's best effort.
 *
 * `best` ranks moves by scenario ROS when scenarios exist, else by EV ROS. Ties (within 1e-9): the other
 * ROS, then an open spot first (nobody is lost), then the dropped player with the lower `dropValue`
 * (market value: keep the more valuable player), then the smaller ids.
 */
export function waiverAdjustment(base: { readonly ev: number; readonly scen: number | null }, moves: readonly RosterMove[], dropValue: (id: string) => number = () => 0): WaiverAdjustment {
  let vEv = base.ev;
  let vScen = base.scen;
  let best: RosterMove | null = null;
  const byScen = base.scen !== null;
  for (const m of moves) {
    if (m.ev > vEv) vEv = m.ev;
    if (vScen !== null && m.scen !== null && m.scen > vScen) vScen = m.scen;
    if (m.add === null) continue;
    const gain = byScen && m.scen !== null ? m.scen - (base.scen as number) : m.ev - base.ev;
    if (!(gain > EPS)) continue;
    if (!best || betterMove(m, best, dropValue, byScen)) best = m;
  }
  return { vEv, vScen, best };
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
   * (default: the rows' positions). mvLose removes the lost player's position itself.
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

/**
 * MV_lose(T, i) as §7 writes it: ROS(T) − ROS(T − i + fa) with EV lineups and with scenario lineups (null
 * when the table has no scenarios), fa = the free agent T − i would add (the same one for both), or null.
 * Negative when a free agent beats one of T's starters; the League model shifts it per team to
 * V(T) − ROS(T − i + fa) (waiverAdjustment).
 */
export function mvLose(roster: readonly string[], playerId: string, candidates: readonly string[], table: ProjectionTable, slots: PreparedSlots, opts: FreeAgentOptions): { ev: number; scen: number | null; autoAdd: string | null } {
  const W = table.weeks.length;
  const rows = tableRows(roster, table);
  const full = teamEval(rows, slots);
  const minusRows = rows.filter((r) => r.id !== playerId);
  const minus = teamEval(minusRows, slots);
  const baseMinus = solveEvWeeks(minus, W);
  const onRoster = new Set(roster);
  const lostPos = table.rows.get(playerId)?.pos;
  const positions: Pos[] = opts.rosterPositions ? [...opts.rosterPositions] : minusRows.map((r) => r.pos);
  const lostAt = opts.rosterPositions && lostPos !== undefined ? positions.indexOf(lostPos) : -1;
  if (lostAt >= 0) positions.splice(lostAt, 1);
  const cands = tableRows(candidates, table)
    .filter((r) => !onRoster.has(r.id))
    .map((row) => ({ row, mask: slotMask(slots, row.pos, row.eligible) }));
  const pick = pickFreeAgent(baseMinus, cands, opts.weights, (row) => positionAllows(opts.positionLimits, positions, row.pos));
  const evBefore = rosValue(solveEvWeeks(full, W).lv, opts.weights);
  const evAfter = rosValue(baseMinus.lv, opts.weights) + (pick ? pick.gain : 0);
  let scen: number | null = null;
  if (table.scenarios > 0) {
    const before = rosValue(scenarioValues(full, W, table.scenarios).mean, opts.weights);
    const after = rosValue(scenarioValues(pick ? pick.team : minus, W, table.scenarios).mean, opts.weights);
    scen = before - after;
  }
  return { ev: evBefore - evAfter, scen, autoAdd: pick ? pick.row.id : null };
}
