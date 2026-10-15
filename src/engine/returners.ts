/**
 * IR players (CLAUDE.md §6, §7, §12; planner reply to Checkpoint 4, change 5 and answer 11; Phase 4b track E): who comes
 * back from IR, the lineup rows that bring him back, the roster spot he needs from his return, and where a traded IR player
 * goes. Pure and deterministic: no I/O, no clock, no randomness of its own; the tunables are config.projections.
 * returnWeekQuantile (the expected return week, availability.ts) and config.lineups.irEligibleDefault.
 *
 * 1. Returners (returnerSpec; league.ts step 5b): a team's IR players with a model and an expected return week R
 *    (availability.expectedReturnWeek: the first remaining week his chance of being back reaches returnWeekQuantile; none
 *    when he isn't back within the remaining weeks) ride with its lineup rows after the streaming rows
 *    (optimizer.StreamSpec.returners), wherever the team's lineup is solved: the League model, the free-agent optimizer,
 *    roster legality, screening and exact evaluation. Their own availability keeps them out until they're back (no
 *    masking). They take no active roster spot, are never dropped nor a free-agent move, and don't count for the
 *    lineup-fill rule (they can't play now): everywhere but item 2, where from his return a returner is on the active
 *    roster like anyone.
 * 2. The roster spot from R (finalLineups; the displacement): from his return week a returner is on the active roster
 *    again (§7's roster legality, IR exempt until then). Returners join in order of R (ties: the smaller id), each from his
 *    own R; a join that leaves the active roster over its size (max(maxRosterSize, the active roster's own size): ⚠️ a
 *    roster already over the size isn't trimmed by it, legality's rule) or his position over its limit (positionLimits:
 *    max(the limit, the position's count on the active roster as it stands), the same rule) drops one player from R on:
 *    at his position when its limit binds, else anyone. The lowest keep value player goes: §7's keep value, what losing him
 *    costs the lineup over the weeks from R on with nobody refilling his spot (teamValue.evRemovalCosts /
 *    scenarioRemovalCosts) in the evaluation's lineup mode (scenario lineups with scenarios, else EV), plus in dynasty and
 *    keeper leagues with long-term values the normalized market value as roster legality reads it (cost ÷ the roster's
 *    largest + v_dyn ÷ the top dynasty value). Candidates: the active roster left and the returners back by then (⚠️ the
 *    returner himself included, review of track E: on a full roster from R on he is a bench player like any other, so
 *    with exact ties a team never comes out weaker with its returner than without him; when he's the one, he's released at
 *    R; ⚠️ with the near-ties below, by at most their tolerance: a returner worth more than W keeps his spot over a cheaper
 *    bench player whose keep value is up to that much higher, verification of the final review, finding VF-4: on
 *    Parker's league, Oct 4 09:24Z, Team 6 keeps Jordyn Tyson from week 5 and drops Emanuel Wilson, 1 ROS point, 104.9 →
 *    104.8 points a week as its roster stands, where exact ties released Tyson), with a model;
 *    never one the starting lineup needs (the lineup-fill rule, structurally: the candidates and the streaming rows),
 *    never one a position's minimum needs (rosterMinimums, held to the count the position had, legality's rule), and never
 *    the last one at a position the team streams (⚠️ review of track E: streaming a K or D/ST takes a roster spot for the
 *    week's pickup, so the streaming row doesn't make the team's only rostered one free to drop; legality's rule 2 keeps
 *    him too since the final review of Phase 4b); ties: the lower perception value, then the smaller id
 *    (teamValue.lowestKeepValue), and ⚠️ without long-term values near-ties count as ties (final review of Phase 4c,
 *    finding R6, roster legality's rule: ReturnerSetup.nearTieWeekly, config.lineups.dropNearTieWeekly points a week × the
 *    weights from R on): among the candidates within that of the lowest keep value, the lowest perception value floored at
 *    the waiver credit W goes (ReturnerSetup.valueFloor; then the lower keep value), so a return releases a near-free bench
 *    player worth at most W rather than a tradable one, and between players worth at most W the lineup decides as before.
 *    Everything the choice reads is from R on (Checkpoint 7e; planner reply to Checkpoint 7d, item 2.3: "A decision that
 *    happens in a future week compares players over the weeks from then on, not from today"). The keep values and the
 *    near-ties' tolerance already were; the trade values the ties compare were today's, so a player who plays only before
 *    R kept his whole value then. Now each candidate's perception value counts only the share of it left at R
 *    (valueShareFrom: his projected points from R on ÷ his projected points over every week team numbers count; a
 *    returner keeps all of his, a player who plays only before R none), and W is the best free agent no team claims,
 *    valued the same way (ReturnerSetup.valueFloorFrom; W itself when no week that counts comes before R). ⚠️ Ours:
 *    projected points each week once (the market prices rest-of-season points), long-term values as they are (they
 *    price later seasons), W's minimum as it is, and a returner's own value is the market's today, which also prices the
 *    chance his return slips (at his return that's settled, but the model has no healthy price for him). The drop is a
 *    masked copy of the player's row (teamValue.maskedRow: nothing from R on), and the lineups are priced again only where
 *    he started (solveEvWeeksMasked, scenarioValuesMasked). When nobody can go, ⚠️ the roster runs over (nothing is
 *    dropped). ⚠️ Applied to FINAL team evaluations only: the League model's teams as they stand (LV, ROS, PPW, strength,
 *    needs, TeamModel.score and the League page's odds) and every side the trade evaluation prices after the free-agent
 *    optimizer (the baseline at V*(T) and both sides of every exact trade: B, n, h and the simulations). Never inside the
 *    optimizer's moves, screening, legality, lineup costs, MV_add, trade chips or partner fit: that machinery compares
 *    rosters with each other, and the displacement is about the same on both sides of each comparison (a constant per
 *    team).
 * 3. A traded IR player (irAfterTrade; evaluate.ts roster legality, rule 5) and the active-roster spots a trade's packages
 *    count (activeSpots, tradeActiveSpots; market.ts §9's waiver credit, review of track E: an IR slot isn't a roster
 *    spot; Phase 4c: each side's own IR movers too, ActiveSpots.inactive): irSlots.ts, a light module a reader outside the
 *    engine can use, re-exported here.
 */
import type { Pos } from "./model";
import type { InstanceIndex } from "./needs";
import { fillCount, returnersOf, type StreamSpec } from "./optimizer";
import type { LineupCandidate, PreparedSlots } from "./lineup";
import {
  evRemovalCosts,
  lowestKeepValue,
  maskedRow,
  scenarioRemovalCosts,
  scenarioValues,
  scenarioValuesMasked,
  solveEvWeeksMasked,
  teamEval,
  type ScenarioValues,
  type SolvedWeeks,
  type TableRow,
  type TeamEval,
} from "./teamValue";

export { activeSpots, irAfterTrade, irEligibleStatuses, tradeActiveSpots, type IrAfterTrade, type IrTradeInput } from "./irSlots";

/** Keep values closer than this are ties, and a largest cost below it normalizes nothing (float noise, not a tunable). */
const EPS = 1e-9;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// Returners

/**
 * `base` (a team's streaming rows and positions) with the returners among `ir` (the team's IR players): the rows of those
 * `isReturner` accepts (a model and an expected return week), in id order (one canonical order, so the same IR set gives
 * the same rows in the same order whichever way it was reached). Without any, `base`'s rows and positions alone (no
 * `returners` field: Checkpoint 4's spec, and its memo keys).
 */
export function returnerSpec(base: StreamSpec, ir: readonly string[], rowOf: (id: string) => TableRow | undefined, isReturner: (id: string) => boolean): StreamSpec {
  const rows = [...new Set(ir)]
    .filter(isReturner)
    .sort(byId)
    .flatMap((id) => rowOf(id) ?? []);
  return rows.length ? { rows: base.rows, positions: base.positions, returners: rows } : { rows: base.rows, positions: base.positions };
}

// ---------------------------------------------------------------------------------------------
// The displacement (final evaluations)

/**
 * The share of a player's trade value left at week index `from` (the file header, item 2; Checkpoint 7e, planner reply to
 * Checkpoint 7d, item 2.3): his projected points (`ev`, availability included, each week at least 0) over the weeks team
 * numbers count (`weights` above 0) from `from` on, ÷ those over every week team numbers count. Exactly 1 when none of his
 * points come before `from` (nothing to leave out: a returner, or a decision in the first week that counts), 0 when all of
 * them do (he plays only before then).
 */
export function valueShareFrom(ev: ArrayLike<number>, weights: ArrayLike<number>, from: number): number {
  let before = 0;
  let after = 0;
  for (let w = 0; w < weights.length; w++) {
    if (!((weights[w] ?? 0) > 0)) continue;
    const p = Math.max(0, Number(ev[w]) || 0);
    if (w < from) before += p;
    else after += p;
  }
  return before > 0 ? after / (before + after) : 1;
}

/** Long-term values for the dynasty part of the keep value (dynasty and keeper leagues whose dynasty values loaded). */
export interface FutureKeep {
  readonly value: (id: string) => number;
  /** The top dynasty value (the normalization). */
  readonly top: number;
}

/** What finalLineups reads: one League model build's (league.ts LeagueContext.returnerSetup). */
export interface ReturnerSetup {
  readonly slots: PreparedSlots;
  /** Weeks each lineup is solved for (LeagueModel.weeks). */
  readonly weekCount: number;
  /** Availability scenarios (0: EV lineups only): the evaluation's lineup mode for keep values. */
  readonly scenarios: number;
  /** ω per week over the weeks team numbers count (a week in progress at 0). */
  readonly weights: ArrayLike<number>;
  readonly maxRosterSize: number;
  /** The most players per position on the active roster (LeagueSettings.positionLimits; IR exempt), when the league has them. */
  readonly positionLimits?: Partial<Record<Pos, number>> | undefined;
  /** The fewest players per position (LeagueSettings.rosterMinimums), when the league has them. */
  readonly rosterMinimums?: Partial<Record<Pos, number>> | undefined;
  /** Position and eligibility of any rostered id (the lineup-fill rule, the position rules), with a model or not. */
  readonly info: (id: string) => { readonly pos: Pos; readonly eligible: readonly Pos[] } | undefined;
  /**
   * Perception value (keep-value ties: the less valuable player goes), today's: finalLineups counts only the share of it
   * left at the return week (valueShareFrom; Checkpoint 7e).
   */
  readonly dropValue: (id: string) => number;
  /**
   * Near-ties (final review of Phase 4c, finding R6; config.lineups.dropNearTieWeekly, projected points a week): without
   * long-term values (`future` null), a keep value within this × the weights of the weeks from the return on of the lowest
   * counts as a tie, so the less valuable player goes (teamValue.lowestKeepValue's `tie`). Absent or 0: exact ties only.
   */
  readonly nearTieWeekly?: number;
  /** The waiver credit W (§9): the near-ties' values are floored at it (teamValue.lowestKeepValue's `floor`). Absent: 0. */
  readonly valueFloor?: number;
  /**
   * W from a week index on (Checkpoint 7e; league.ts: the best free agent no team claims, his value × valueShareFrom, at
   * least W's minimum, never above W; W itself when no week that counts comes before it): the floor of a return in that
   * week. Absent: valueFloor in every week.
   */
  readonly valueFloorFrom?: (from: number) => number;
  readonly future: FutureKeep | null;
  /** A returner's expected return week as an index into the model's weeks (0 = the current week); null when he isn't back. */
  readonly returnIndex: (id: string) => number | null;
  /** Slot instances for the final scenario lineups' instance points (strength, needs, h). */
  readonly index: InstanceIndex | null;
}

/**
 * One displacement: `id` is dropped from week index `from` on (LeagueModel.weeks), to make room for `returner`: an active
 * player, an earlier returner, or the returner himself (released at his return: `id` = `returner`).
 */
export interface Displacement {
  readonly id: string;
  readonly from: number;
  readonly returner: string;
}

/** A final evaluation: the displacements, the rows priced (masked copies in place) and their lineups. */
export interface FinalLineups {
  readonly displaced: readonly Displacement[];
  readonly team: TeamEval;
  /** EV lineups of `team`. */
  readonly ev: SolvedWeeks;
  /**
   * Its scenario lineups (null without scenarios): with instance points (setup.index) and the within-lineup variance when a
   * displacement happened; else `raw.scen` as given.
   */
  readonly scen: ScenarioValues | null;
}

/** A position limit or minimum when it is a finite number, else undefined. */
const bound = (x: number | undefined): number | undefined => (x !== undefined && Number.isFinite(x) ? x : undefined);

/**
 * The final evaluation of an active roster (the file header, item 2): `roster` (active ids; every distinct id takes a spot,
 * with a model or not) and `spec` (the team's streaming rows and returners), whose lineups without any displacement are
 * `raw`: EV lineups of exactly the rows the optimizer prices (the roster's players with a model in roster order, the
 * streaming rows, the returners: optimizer.evaluate's team) and, with scenarios, their scenario lineups with cells kept
 * (scenarioValues with `keep`; solved here when they aren't). No displacement (no returner back within the weeks, or
 * room for every one with no position past its limit): `raw` itself, so a caller gets the very numbers it would without
 * IR players.
 */
export function finalLineups(setup: ReturnerSetup, roster: readonly string[], spec: StreamSpec, raw: { readonly ev: SolvedWeeks; readonly scen: ScenarioValues | null }): FinalLineups {
  const fast: FinalLineups = { displaced: [], team: raw.ev.team, ev: raw.ev, scen: raw.scen };
  const back = returnersOf(spec);
  if (!back.length) return fast;
  const plan = back
    .flatMap((r) => {
      const at = setup.returnIndex(r.id);
      return at === null || !Number.isFinite(at) ? [] : [{ id: r.id, at: Math.max(0, Math.floor(at)) }];
    })
    .sort((a, b) => a.at - b.at || byId(a.id, b.id));
  if (!plan.length) return fast;
  const active = [...new Set(roster)];
  const max = setup.maxRosterSize;
  const sizeCap = Number.isFinite(max) && max > 0 ? Math.max(Math.floor(max), active.length) : Number.POSITIVE_INFINITY;
  // Players per position on the active roster as it stands (the caps' and minimums' base), then as returners join and
  // players go.
  const posOf = (id: string): Pos | undefined => setup.info(id)?.pos;
  const count = new Map<Pos, number>();
  const bump = (id: string, by: number) => {
    const p = posOf(id);
    if (p !== undefined) count.set(p, (count.get(p) ?? 0) + by);
  };
  for (const id of active) bump(id, 1);
  const before = new Map(count);
  /** A position's cap: its limit, or its count as it stands when already over (legality's rule); no limit → none. */
  const capOf = (p: Pos): number => {
    const l = bound(setup.positionLimits?.[p]);
    return l === undefined ? Number.POSITIVE_INFINITY : Math.max(l, before.get(p) ?? 0);
  };
  /** A position's minimum target: its minimum, held to its count as it stands (legality's minTarget). */
  const minOf = (p: Pos): number => {
    const m = bound(setup.rosterMinimums?.[p]);
    return m === undefined ? 0 : Math.min(m, before.get(p) ?? 0);
  };
  // Room for every returner and no position past its cap with all of them back: nothing to drop.
  const backAt = new Map<Pos, number>();
  for (const r of plan) {
    const p = posOf(r.id);
    if (p !== undefined) backAt.set(p, (backAt.get(p) ?? 0) + 1);
  }
  if (active.length + plan.length <= sizeCap && [...backAt].every(([p, n]) => (before.get(p) ?? 0) + n <= capOf(p))) return fast;

  const W = setup.weekCount;
  const S = Number.isFinite(setup.scenarios) ? Math.max(0, Math.floor(setup.scenarios)) : 0;
  let team = raw.ev.team;
  let ev = raw.ev;
  let scen: ScenarioValues | null = S > 0 ? (raw.scen?.cells ? raw.scen : scenarioValues(team, W, S, setup.index, true, true)) : null;
  const streamEntries: LineupCandidate[] = spec.rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible }));
  const entries = (ids: readonly string[]): LineupCandidate[] => [
    ...ids.flatMap((id) => {
      const i = setup.info(id);
      return i ? [{ id, pos: i.pos, eligible: i.eligible }] : [];
    }),
    ...streamEntries,
  ];
  const streamed = new Set<Pos>(spec.positions);
  /** The active roster from the week being decided: the roster as it stands and the returners back by then, minus the drops. */
  const live: string[] = [...active];
  const displaced: Displacement[] = [];
  for (const ret of plan) {
    live.push(ret.id);
    bump(ret.id, 1);
    const pos = posOf(ret.id);
    const overPos = pos !== undefined && (count.get(pos) ?? 0) > capOf(pos);
    if (!overPos && live.length <= sizeCap) continue;
    const from = ret.at;
    // Keep values over the weeks from his return on, nobody refilling the spot, in the evaluation's lineup mode.
    const wf = Float64Array.from({ length: W }, (_, w) => (w >= from ? (setup.weights[w] ?? 0) : 0));
    const costs = scen?.cells ? scenarioRemovalCosts(scen.cells, wf) : evRemovalCosts(ev, wf);
    const at = new Map<string, number>();
    team.rows.forEach((r, k) => {
      if (!at.has(r.id)) at.set(r.id, k);
    });
    const modeled = live.filter((id) => at.has(id));
    const cost = (id: string) => costs[at.get(id) as number] as number;
    const fut = setup.future;
    let largest = 0;
    if (fut) for (const id of modeled) largest = Math.max(largest, cost(id));
    const keep = (id: string) => (fut ? (largest > EPS ? cost(id) / largest : 0) + (fut.top > 0 ? fut.value(id) / fut.top : 0) : cost(id));
    // The lineup-fill rule: without him, every starting slot the players left (and the streaming rows) could fill still can.
    const fillBefore = fillCount(entries(live), setup.slots);
    const candidates = modeled.filter((id) => {
      const p = posOf(id);
      if (overPos && p !== pos) return false; // the limit binds: one at his position goes
      if (p !== undefined) {
        const n = count.get(p) ?? 0;
        if (n <= minOf(p)) return false; // a position's minimum needs him
        if (streamed.has(p) && n <= 1) return false; // the last one at a position the team streams
      }
      return fillCount(entries(live.filter((x) => x !== id)), setup.slots) >= fillBefore;
    });
    // Near-ties when the keep value is the lineup cost alone (ReturnerSetup.nearTieWeekly × the weights from his return on),
    // and the trade values the ties compare from his return on too (Checkpoint 7e, the file header): each candidate's value
    // counts the share of it left then (valueShareFrom on his own row), and the floor is W from then (valueFloorFrom).
    const perWeek = setup.nearTieWeekly ?? 0;
    let tie = 0;
    if (!fut && Number.isFinite(perWeek) && perWeek > 0) for (let w = from; w < W; w++) tie += Math.max(0, (wf[w] as number) || 0) * perWeek;
    const valueFrom = (id: string) => (setup.dropValue(id) || 0) * valueShareFrom((team.rows[at.get(id) as number] as TableRow).ev, setup.weights, from);
    const pick = lowestKeepValue(
      candidates.map((id) => ({ id, keep: keep(id), value: valueFrom(id) })),
      tie,
      setup.valueFloorFrom ? setup.valueFloorFrom(from) : (setup.valueFloor ?? 0),
    );
    if (pick === null) continue; // ⚠️ nobody can go: the roster runs over
    const k = at.get(pick) as number;
    const rows = [...team.rows];
    rows[k] = maskedRow(rows[k] as TableRow, from);
    const next = teamEval(rows, setup.slots);
    ev = solveEvWeeksMasked(ev, next, k, from, W);
    if (scen) scen = scenarioValuesMasked(scen, next, k, from, W, S, setup.index, true, true) ?? scenarioValues(next, W, S, setup.index, true, true);
    team = next;
    live.splice(live.indexOf(pick), 1);
    bump(pick, -1);
    displaced.push({ id: pick, from, returner: ret.id });
  }
  return displaced.length ? { displaced, team, ev, scen } : fast;
}
