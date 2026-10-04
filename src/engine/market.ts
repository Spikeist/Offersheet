/**
 * Market value layer (CLAUDE.md §9; FantasyCalc parameters §2.9; config.market §15): how managers
 * perceive a trade. Pure and deterministic: no I/O, and every tunable number comes from
 * config.market.
 *
 * FantasyCalc format (§2.9; facts from the Phase 0 captures in reports/probe-output/shared.md):
 * - numQbs is 2 when a slot takes a QB and another position (SUPER_FLEX, OP) or the league starts two
 *   or more QB-only slots.
 * - numTeams: FantasyCalc supports 8, 10, 12 and 14 teams and silently answers any other size with
 *   its 12-team values, so we request the nearest supported size ourselves (a tie goes to the larger)
 *   and the Import Report says so ("16 teams → FantasyCalc's 14-team values"; planner reply 1).
 * - ppr: the nearest of 0, 0.5 and 1 to a WR's points per reception (a tie goes to the larger).
 * - tep: te+ and te++ change only TE values (median ×1.149 and ×1.29 in the captures), and
 *   FantasyCalc never says what they mean in points. Our mapping: a TE premium (a TE's minus a WR's
 *   points per reception) above 0 and under 0.75 → te+, 0.75 or more → te++. The Import Report note
 *   says the mapping is ours.
 * - Redraft leagues use redraft values and dynasty leagues dynasty values. Keeper leagues use dynasty
 *   values for the future term and redraft values for perception (§9), so the server requests both
 *   formats: MarketInputs.values holds the dynasty values and MarketInputs.redraftValues the redraft
 *   ones. Perception is what §11's g and the surplus score read.
 *
 * Player values v_i (§9; planner reply to Checkpoint 0, answer 7):
 * - the FantasyCalc value, when FantasyCalc has one (a positive number);
 * - otherwise, at a position with at least unvaluedCurveMinPlayers valued players, an estimate from
 *   an isotonic (pool-adjacent-violators, non-decreasing) fit of value against rest-of-season
 *   points: linear between the fitted points, proportional toward 0 below the lowest one, flat above
 *   the highest, and capped at the lowest real value at that position. Every fitted value is an
 *   average of real values, so it is never below the lowest one: the cap binds everywhere from the
 *   lowest valued player's ROS points up, and only players below that range can get less;
 * - otherwise (FantasyCalc values too few players there; it has no K, DEF or IDP at all) the floor:
 *   min(valueFloor, the lowest real value at that position), or valueFloor when none has a value.
 *   valueFloor = valueFloorFraction × the top value.
 *
 * The curve fallback (Phase 4c; planner reply to Checkpoint 4b, change 12; MarketInputs.fallback kind "curve"): when
 * FantasyCalc didn't answer and the newest saved list is more than config.market.fantasyCalcStaleDays old (at most
 * fantasyCalcCurveDays: src/server/modelInputs.ts decides), that list only calibrates the model's own value curve
 * (curveMarketValues): per position (ours), the same isotonic fit of value on rest-of-season points, and EVERY player
 * there, valued or not, is valued by the curve at his own ROS points (source "estimate", no cap; ⚠️ ours: no old value is
 * used directly, since a player's value may have moved a lot since that list, while the curve reads today's
 * projections). ⚠️ The curve's points are the HEALTHY players the old list values with points left (review of track MK,
 * as the market blend's curve, blend.ts rule 4): no injury tag and a game left (MarketPlayer.fit, the caller's flag;
 * absent counts as fit) and ROS points above 0. An injured or tagged player's value prices his full-strength worth while
 * his ROS counts only the games he's expected to play (dynasty lists keep injured young players high), and a player
 * projected for nothing tells the curve nothing about points, so in the fit they would lift and flatten its bottom, and
 * with no cap here that reaches every value, W included (toy: one WR out for the season valued 8,000 put every WR with
 * ROS ≤ 60 at 1,979 instead of his own 100–1,850). They are still read off the curve at their own ROS points, so ⚠️ an
 * injured player's value counts only the games he's expected to play (the banner says so). A position with fewer curve
 * points than unvaluedCurveMinPlayers gets the floor, as above. The other readers of the old list keep off it: no market
 * blend (blend.blendValues), no long-term term (benefit.futureValuesLoaded) and an elite list from the model's estimates
 * (premium.eliteIds). A saved list at most fantasyCalcStaleDays old (kind "saved") is read as FantasyCalc's own.
 * fantasyCalcFallbackText words both for users.
 *
 * Package value (§9): the side that receives fewer players gets the waiver credit W for each open
 * roster spot (an active one: see below), and g_mkt(X) = (PV_recv − PV_give) / PV_give. Each player counts at max(v, W)
 * (planner reply to Checkpoint 4, change 4; it replaces lead decision N10, which floored only the players I give
 * and only in B's market term): a player worth less than the best free agent is replaceable by him, so
 * his roster spot is worth W whoever holds it. packageValues is the one place every package sum goes
 * through (marketGain; benefit.tradePackage for B's market term, ΔDyn and the card's values;
 * premium.perceivedPackage; the partner's trade history), so g_mkt(me), g_mkt(P), the Market check, the
 * hide threshold, the veto rule and the screening window all read the same packages. A value missing counts 0 before
 * the floor, so W after it. A roster's total (benefit.rosterValue, MyDynTotal) passes W = 0: raw.
 * config.market.studExponent γ replaces every value with v^γ after the floor, W included (W is a player's value too).
 *
 * Neutral throw-ins (Phase 4c; planner reply to Checkpoint 4b, change 2 and answer 6: "drop any player worth at most W
 * who's on the side giving more players, together with his roster-spot credit. Then apply the usual floor and credit to
 * what's left."; neutralThrowIns). When W > 0, before any sum, players worth at most W (his own value, before the floor;
 * a missing one is 0) are left out in two steps, each with the roster spot he moves (his side's spot count drops by one,
 * except for a player who moves without an active spot: ActiveSpots.inactive, an IR player leaving his IR slot or taking
 * one):
 * 1. the planner's: when one side of a package moves d more players than the other (players, not roster spots), up to d
 *    of that side's, cheapest first (ties: the smaller id);
 * 2. ⚠️ the lead's (Phase 4c, closing the gap the review of track EF found, finding 1: the planner's literal rule leaves
 *    nobody out once the counts are even): then matched pairs, one from each side, cheapest first on each side, as many
 *    pairs as the side with fewer of them left has. Without it A + x → B + c (x and c worth at most W) left nobody out
 *    while A → B + c left c out, so c counted again at W beside x: both sums grew by W and both g's moved toward 0, up
 *    for a partner losing value (W [value]: A 1,000 for B 1,500 + c 100 read −33.3% for the partner, vetoed; with x 200
 *    added −23.6%, not vetoed). Now both read as A → B.
 * The floor and the credit then apply to what's left. The players worth at most W that the steps leave in are all on one
 * side, the one with fewer players worth more than W, at most as many as that difference: each counts W where the
 * roster-spot credit he stands for would. So when every player moves with an active spot (no IR move), a package equals
 * the one with every player worth at most W left out with his spot (market.test.ts), and:
 * - an even swap of two players worth at most W reads g = 0 for both sides (both are left out: nothing against nothing);
 * - giving one away for nothing reads g = 0 (he and his spot are left out);
 * - a player worth at most W added to either side of any trade moves neither side's g, so through value he can only
 *   lower acceptance: he still counts in the complexity term c, and roster legality still makes the receiving side drop
 *   someone (market.test.ts's property tests: with n, h and hot held fixed, P_accept and P_complete never rise). ⚠️ He
 *   can still raise it through what he does for the partner's lineup (n, h: a cheap player can still start for them or
 *   fill a hole) or a hot streak (hot): that is where an "if they say no, add him" step's rise comes from (evaluate.ts;
 *   review of NT, finding 2: on Parker's league, the 00:51Z dump, the steps that add Rico Dowdle, worth [value] ≤ W [value], raise
 *   the chance 7.6 to 8.2 points through n and h, he fills a hole in Team 2's lineup, with the partner's g at 0% in both
 *   versions). Before Phase 4c he counted W on one side and the spot he took W on the other, which pulled each g toward
 *   0: a cheap throw-in could lift a lopsided trade past the veto line, the Market check or the hide threshold, and raise
 *   acceptance through value when the partner was losing value.
 * - Both sides leave out the same players (the steps read only values and ids, the same on both sides of a trade), so
 *   when no IR player moves my package and the partner's mirror each other exactly (my PV_give is its PV_recv).
 *   premium.perceivedPackage decides on the raw values too (packageValues' throwInValues), whatever premium it puts on
 *   the players left.
 * ⚠️ The exception, IR moves (market.test.ts checks this statement on random trades): the steps count players and pick by
 * value alone (so both sides leave out the same players), while the credit counts active roster spots. A side's package
 * equals the one with every player worth at most W left out with his spot exactly when the players worth at most W the
 * steps leave in all move with an active spot and are no more than the roster-spot credits their list would count
 * without them (one for each active player worth more than W the other list has beyond theirs). A trade that moves an IR
 * player can break that: a cheap IR player left in counts W with no spot behind him, or a player worth more than W who
 * moves without a spot leaves more cheap players in than credits, each adding W to both sums. Only when it is broken,
 * with him or without him, can a player worth at most W move a side's g, either way (toward 0 too: a partner losing
 * value can gain from him). Likewise a cheap player who carries a star premium (his team's #1 or #2 by value, or a top-12
 * player, worth less than the best free agent: never on a real roster) counts his premium when he is one of those left in.
 *
 * Open roster spots are ACTIVE roster spots (review of Phase 4b track E, which made IR players tradable): an IR player who
 * leaves his IR slot opens none, and one received into an open IR slot fills none (no free agent could take an IR slot).
 * So a trade evaluation passes each side's own active-roster moves (ActiveSpots: returners.activeSpots after roster
 * legality's rule 5) and the credit counts those: W per spot a side opens on what it receives, W per spot it fills on
 * what it gives. Without them every player takes a spot (the counts above: a trade without IR players, the partner's
 * history). The two sides' packages then mirror each other only when no IR player moves (my PV_give is the partner's
 * PV_recv): with one, each side's credit follows its own roster (on Parker's league, Oct 3, "Rico Dowdle for Kalif
 * Raymond + Jordan Mason (IR)" credited Team 2 an open spot its roster never had, g_mkt 0% where it gives two players
 * for one: −50% counting active spots; since Phase 4c's matched pairs all three, each worth at most W, are left out,
 * nothing against nothing: 0% for both sides). ⚠️ An IR player still counts at max(v, W) (the planner's "each player"),
 * though his IR slot isn't a spot a free agent could fill: a player worth less than W taking a receiver's open IR slot
 * reads as W received, unless the neutral throw-in rule leaves him out (then his side loses no spot credit with him: he
 * had none).
 */
import { config } from "./config";
import type { FantasyCalcFormat, MarketInputs } from "./inputs";
import type { MarketSummary, ValueSource } from "./leagueModel";
import type { LeagueSettings, MarketValues, Pos, Scoring, SlotDef } from "./model";
import { rateFor, ruleApplies } from "./scoring";

/** The config.market keys this module reads, widened so calibration and tests can pass other numbers. */
export interface MarketConfig {
  readonly valueFloorFraction: number;
  readonly waiverCreditMinFraction: number;
  readonly studExponent: number;
  readonly unvaluedCurveMinPlayers: number;
}

/** League sizes FantasyCalc supports (§2.9). Any other size silently gets its 12-team values. */
export const FANTASYCALC_TEAM_SIZES = [8, 10, 12, 14] as const;
/** Points per reception FantasyCalc supports (§2.9). */
export const FANTASYCALC_PPR = [0, 0.5, 1] as const;

/** Tolerance for comparing scoring rates (sums of decimals such as 0.1 + 0.2). */
const EPS = 1e-9;

/** Which FantasyCalc list a request asks for. */
export type FantasyCalcMode = "redraft" | "dynasty";

/** §9: perception = how managers value a trade today; future = long-term (dynasty) value. */
export type ValueTerm = "perception" | "future";

// ---------------------------------------------------------------------------------------------
// FantasyCalc format (§2.9)

/** The list a league's `values` come from: dynasty for dynasty and keeper leagues (the future term), redraft otherwise. */
export function defaultFantasyCalcMode(leagueType: LeagueSettings["leagueType"]): FantasyCalcMode {
  return leagueType === "redraft" ? "redraft" : "dynasty";
}

/** The option closest to x; a tie goes to the larger option. */
export function nearestOption<T extends number>(options: readonly T[], x: number): T {
  let best = options[0] as T;
  for (const o of options) {
    const d = Math.abs(o - x);
    const bestD = Math.abs(best - x);
    if (d < bestD - EPS || (Math.abs(d - bestD) <= EPS && o > best)) best = o;
  }
  return best;
}

/**
 * Points for one reception at a position: the reception rate (byPosition replaces perStat, as ESPN's
 * pointsOverrides do), Sleeper's position bonus key (bonus_rec_te …, a stat of its own that equals
 * receptions), and any plain unbounded per-unit rule on receptions. The Import Report's per-catch
 * line counts the same parts.
 */
export function receptionRate(scoring: Scoring, pos: Pos): number {
  let points = rateFor(scoring, "rec", pos) + rateFor(scoring, `bonus_rec_${pos.toLowerCase()}`, pos);
  for (const rule of scoring.rules) {
    if (rule.kind === "perUnit" && rule.stat === "rec" && rule.min === undefined && rule.max === undefined && ruleApplies(rule, pos)) points += rule.points;
  }
  return points;
}

/** QB starting spots: whether a slot takes a QB and another position, how many QB-only spots, and the total. */
function qbSpots(lineup: readonly SlotDef[]): { superflex: boolean; qbOnly: number; total: number } {
  let superflex = false;
  let qbOnly = 0;
  let total = 0;
  for (const slot of lineup) {
    if (!(slot.count > 0) || !slot.eligible.includes("QB")) continue;
    total += slot.count;
    if (slot.eligible.some((p) => p !== "QB")) superflex = true;
    else qbOnly += slot.count;
  }
  return { superflex, qbOnly, total };
}

/** A number for a note: at most 3 decimals, no trailing zeros ("0.75", "1"). */
function fmt(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

function pprWords(ppr: number): string {
  if (ppr === 1) return "PPR";
  if (ppr === 0.5) return "half-PPR";
  if (ppr === 0) return "non-PPR";
  return `${fmt(ppr)} PPR`;
}

const tepWords = (tep: "te+" | "te++") => (tep === "te+" ? "TE+" : "TE++");

/**
 * The FantasyCalc /values/current format for a league (§2.9). `mode` defaults by league type
 * (defaultFantasyCalcMode); for a keeper league the server also requests mode "redraft", whose values
 * become MarketInputs.redraftValues (perception, §9). `substitutions` lists, in words for the Import
 * Report, everywhere the request differs from the league. The size, PPR and TE notes are the same in
 * both modes, so a caller showing both formats should show them once.
 */
export function fantasyCalcFormat(settings: LeagueSettings, mode: FantasyCalcMode = defaultFantasyCalcMode(settings.leagueType)): FantasyCalcFormat {
  const substitutions: string[] = [];

  if (settings.leagueType === "keeper") {
    substitutions.push(mode === "dynasty" ? "keeper league → FantasyCalc's dynasty values for long-term worth" : "keeper league → FantasyCalc's redraft values for how managers see a trade this season");
  } else if (settings.leagueType !== mode) {
    substitutions.push(`${settings.leagueType} league → FantasyCalc's ${mode} values`);
  }

  const numTeams = nearestOption(FANTASYCALC_TEAM_SIZES, settings.numTeams);
  if (numTeams !== settings.numTeams) substitutions.push(`${settings.numTeams} teams → FantasyCalc's ${numTeams}-team values`);

  const qbs = qbSpots(settings.lineup);
  const numQbs: 1 | 2 = qbs.superflex || qbs.qbOnly >= 2 ? 2 : 1;
  if (qbs.total > 2) substitutions.push(`${qbs.total} QB starting spots → FantasyCalc's 2-QB values`);

  const wr = receptionRate(settings.scoring, "WR");
  const ppr = nearestOption(FANTASYCALC_PPR, wr);
  if (Math.abs(ppr - wr) > EPS) substitutions.push(`${fmt(wr)} points per reception → FantasyCalc's ${pprWords(ppr)} values`);
  const rb = receptionRate(settings.scoring, "RB");
  if (Math.abs(rb - wr) > EPS) substitutions.push(`RBs get ${fmt(rb)} points per reception and WRs ${fmt(wr)}; FantasyCalc's values use one rate for both`);

  const premium = receptionRate(settings.scoring, "TE") - wr;
  let tep: "te+" | "te++" | undefined;
  if (premium > EPS) {
    tep = premium < config.market.tepPlusPlusAt - EPS ? "te+" : "te++";
    substitutions.push(`TE premium +${fmt(premium)} per reception → FantasyCalc's ${tepWords(tep)} values (our mapping: FantasyCalc doesn't define TE+ or TE++ in points)`);
  } else if (premium < -EPS) {
    substitutions.push(`TEs get ${fmt(-premium)} fewer points per reception than WRs; FantasyCalc has no setting for that, so TE values assume the WR rate`);
  }

  return { isDynasty: mode === "dynasty", numQbs, numTeams, ppr, ...(tep ? { tep } : {}), substitutions };
}

/** "10 teams · half-PPR · 1 QB · redraft", plus " · TE+" or " · TE++" with a TE premium. */
export function fantasyCalcFormatLabel(f: FantasyCalcFormat): string {
  const parts = [`${f.numTeams} teams`, pprWords(f.ppr), `${f.numQbs} QB`, f.isDynasty ? "dynasty" : "redraft"];
  if (f.tep) parts.push(tepWords(f.tep));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------------------
// Isotonic curve (§9 "a monotone curve of value against rest-of-season points")

export interface IsotonicCurve {
  /** Distinct x values, ascending. */
  xs: number[];
  /** Fitted values at xs: non-decreasing, each the average of the observed values in its block. */
  ys: number[];
}

/**
 * Least-squares non-decreasing fit (pool adjacent violators). Points sharing an x are pooled first,
 * so the input order never matters. Non-finite points are ignored.
 */
export function isotonicFit(points: ReadonlyArray<{ x: number; y: number }>): IsotonicCurve {
  const sorted = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x || a.y - b.y);
  const xs: number[] = [];
  const sums: number[] = [];
  const weights: number[] = [];
  for (const p of sorted) {
    const last = xs.length - 1;
    if (last >= 0 && xs[last] === p.x) {
      sums[last] = (sums[last] as number) + p.y;
      weights[last] = (weights[last] as number) + 1;
    } else {
      xs.push(p.x);
      sums.push(p.y);
      weights.push(1);
    }
  }
  // Blocks of consecutive xs whose means rise left to right; a new point merges back while it violates.
  const blockSum: number[] = [];
  const blockWeight: number[] = [];
  const blockLength: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    let s = sums[i] as number;
    let w = weights[i] as number;
    let length = 1;
    while (blockSum.length > 0) {
      const j = blockSum.length - 1;
      // prev mean ≤ this mean ⇔ prevSum·w ≤ s·prevWeight (weights are positive)
      if ((blockSum[j] as number) * w <= s * (blockWeight[j] as number)) break;
      s += blockSum.pop() as number;
      w += blockWeight.pop() as number;
      length += blockLength.pop() as number;
    }
    blockSum.push(s);
    blockWeight.push(w);
    blockLength.push(length);
  }
  const ys: number[] = [];
  for (let b = 0; b < blockSum.length; b++) {
    const mean = (blockSum[b] as number) / (blockWeight[b] as number);
    for (let k = 0; k < (blockLength[b] as number); k++) ys.push(mean);
  }
  return { xs, ys };
}

/**
 * The curve at x: linear between fitted points, flat above the last, and proportional toward 0 below
 * the first (y0 · x / x0; 0 when x0 ≤ 0 or x ≤ 0). An empty curve is 0 everywhere.
 */
export function curveValue(curve: IsotonicCurve, x: number): number {
  const { xs, ys } = curve;
  const n = xs.length;
  if (n === 0) return 0;
  const x0 = xs[0] as number;
  if (x < x0) return x0 > 0 ? ((ys[0] as number) * Math.max(0, x)) / x0 : 0;
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number;
  let lo = 0; // xs[lo] ≤ x < xs[hi]
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  const xl = xs[lo] as number;
  const yl = ys[lo] as number;
  return yl + ((x - xl) / ((xs[hi] as number) - xl)) * ((ys[hi] as number) - yl);
}

// ---------------------------------------------------------------------------------------------
// Player values (§9)

export interface MarketPlayer {
  readonly id: string;
  readonly pos: Pos;
  /**
   * Phase 4c, read by the curve fallback only (curveMarketValues; the file header): he may be one of his position's curve
   * points, healthy with a game left, by the market blend's rule for its own curve points (blend.ts rule 4, league.ts
   * buildMarketBlend: no injury tag, an NFL team, a remaining week that isn't his bye), which only the caller knows (the
   * League model's market step). Absent: true. §9's estimate curve for unvalued players (marketValues) fits every valued
   * player, as §9 writes it: its estimates are capped at the lowest real value, so only its bottom end matters.
   */
  readonly fit?: boolean;
}

/**
 * The value table and top value for a term (§9). Perception reads MarketInputs.redraftValues when it
 * holds any value (the server sets it for keeper leagues only), else `values`; the future term always
 * reads `values`. MarketInputs carries one topValue, the one for `format`, so the perception table's
 * top is its own largest value: the list's top in practice, since FantasyCalc's top redraft player is
 * rostered in any league.
 */
export function valuesForTerm(market: MarketInputs, term: ValueTerm = "perception"): { values: Readonly<Record<string, number>>; topValue: number } {
  if (term === "perception" && market.redraftValues) {
    let top = 0;
    for (const v of Object.values(market.redraftValues)) if (Number.isFinite(v) && v > top) top = v;
    if (top > 0) return { values: market.redraftValues, topValue: top };
  }
  return { values: market.values, topValue: market.topValue };
}

/** A FantasyCalc value counts only when it is a positive, finite number. */
function realValue(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
}

const finiteOrUndefined = (x: number | undefined): number | undefined => (x !== undefined && Number.isFinite(x) ? x : undefined);

/**
 * v_i for every player (§9): the FantasyCalc value, else a curve estimate from his rest-of-season
 * points (`rosPoints`, the ROS total in league points), else the floor (see the file header). The
 * lowest real value and the curve use the valued players in `players` at the same position (our
 * position, not FantasyCalc's). A player at a curve position without ROS points gets no estimate and
 * is left out, as is everyone when there are no market values (FantasyCalc down). In the curve fallback
 * (MarketInputs.fallback kind "curve"), curveMarketValues instead: everyone from the curve.
 *
 * `term` picks the table (valuesForTerm): perception (the default: the League page, the surplus score
 * and §11's g) or future (§10's ΔDyn). The two differ only in keeper leagues.
 */
export function marketValues(players: readonly MarketPlayer[], rosPoints: Readonly<Record<string, number>>, market: MarketInputs | null, cfg: MarketConfig = config.market, term: ValueTerm = "perception"): MarketValues {
  const out: MarketValues = {};
  if (!market) return out;
  if (market.fallback?.kind === "curve") return curveMarketValues(players, rosPoints, market, cfg, term);
  const { values, topValue } = valuesForTerm(market, term);
  const valueFloor = cfg.valueFloorFraction * (Number.isFinite(topValue) && topValue > 0 ? topValue : 0);

  const byPos = new Map<Pos, { valued: { x: number | undefined; v: number }[]; unvalued: MarketPlayer[] }>();
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    let group = byPos.get(p.pos);
    if (!group) byPos.set(p.pos, (group = { valued: [], unvalued: [] }));
    const v = realValue(values[p.id]);
    if (v === undefined) {
      group.unvalued.push(p);
      continue;
    }
    out[p.id] = { value: v, source: "fantasycalc" };
    group.valued.push({ x: finiteOrUndefined(rosPoints[p.id]), v });
  }

  for (const group of byPos.values()) {
    if (group.unvalued.length === 0) continue;
    let lowest = Number.POSITIVE_INFINITY;
    for (const { v } of group.valued) if (v < lowest) lowest = v;
    const points: { x: number; y: number }[] = [];
    for (const { x, v } of group.valued) if (x !== undefined) points.push({ x, y: v });

    if (points.length < Math.max(1, cfg.unvaluedCurveMinPlayers)) {
      const floor = Number.isFinite(lowest) ? Math.min(valueFloor, lowest) : valueFloor;
      for (const p of group.unvalued) out[p.id] = { value: floor, source: "floor" };
      continue;
    }
    const curve = isotonicFit(points);
    for (const p of group.unvalued) {
      const x = finiteOrUndefined(rosPoints[p.id]);
      if (x === undefined) continue; // no ROS points: no estimate can be made
      out[p.id] = { value: Math.min(lowest, Math.max(0, curveValue(curve, x))), source: "estimate" };
    }
  }
  return out;
}

/**
 * The curve fallback (the file header; planner reply to Checkpoint 4b, change 12): v_i for every player from the model's
 * own value curve, calibrated on an old saved list (MarketInputs.fallback kind "curve"; its tables hold that list). Per
 * position (ours): the isotonic fit of the term's table (valuesForTerm) on `rosPoints` over its curve points, the players
 * it values who are fit (MarketPlayer.fit not false: healthy with a game left) with ROS points above 0 (review of track
 * MK: the file header has why), then every player there with ROS points, fit or not, at curveValue(the fit, his ROS
 * points) (source "estimate", at least 0, no cap: the curve stands in for the market); a player without ROS points is
 * left out. A position with fewer curve points than unvaluedCurveMinPlayers: everyone there at the floor, min(valueFloor,
 * the lowest old value there, any player's), or valueFloor when none is valued (K, DEF, IDP). valueFloor is a fraction of
 * the old list's top value. Deterministic whatever the players' order (each id counts once, his first entry).
 */
export function curveMarketValues(players: readonly MarketPlayer[], rosPoints: Readonly<Record<string, number>>, market: MarketInputs, cfg: MarketConfig = config.market, term: ValueTerm = "perception"): MarketValues {
  const out: MarketValues = {};
  const { values, topValue } = valuesForTerm(market, term);
  const valueFloor = cfg.valueFloorFraction * (Number.isFinite(topValue) && topValue > 0 ? topValue : 0);
  const byPos = new Map<Pos, { members: MarketPlayer[]; points: { x: number; y: number }[]; lowest: number }>();
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    let group = byPos.get(p.pos);
    if (!group) byPos.set(p.pos, (group = { members: [], points: [], lowest: Number.POSITIVE_INFINITY }));
    group.members.push(p);
    const v = realValue(values[p.id]);
    if (v === undefined) continue;
    if (v < group.lowest) group.lowest = v;
    const x = finiteOrUndefined(rosPoints[p.id]);
    // A curve point: healthy with a game left, and some points to project (an injured player's value prices games his ROS
    // doesn't count; a player projected for nothing says nothing about what points are worth).
    if (x !== undefined && x > 0 && p.fit !== false) group.points.push({ x, y: v });
  }
  for (const group of byPos.values()) {
    if (group.points.length < Math.max(1, cfg.unvaluedCurveMinPlayers)) {
      const floor = Number.isFinite(group.lowest) ? Math.min(valueFloor, group.lowest) : valueFloor;
      for (const p of group.members) out[p.id] = { value: floor, source: "floor" };
      continue;
    }
    const curve = isotonicFit(group.points);
    for (const p of group.members) {
      const x = finiteOrUndefined(rosPoints[p.id]);
      if (x === undefined) continue; // no ROS points: no estimate can be made
      out[p.id] = { value: Math.max(0, curveValue(curve, x)), source: "estimate" };
    }
  }
  return out;
}

/** The user-facing words for a FantasyCalc fallback (fantasyCalcFallbackText): the config.market key they read. */
export interface FallbackTextConfig {
  readonly fantasyCalcStaleDays: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Sep 28": the UTC day of an ISO time, for notes; null when it isn't one. */
export function noteDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * The words for a FantasyCalc fallback (MarketInputs.fallback; the file header), for the League page and the model inputs'
 * notes and warnings: "saved" → "Trade values from Sep 28: FantasyCalc didn't answer." (a note); "curve" → a banner
 * saying the values are our own estimates, calibrated on the list from that day, and that an injured player's counts only
 * the games he's expected to play (curveMarketValues reads everyone off the curve at his own ROS points).
 */
export function fantasyCalcFallbackText(fallback: NonNullable<MarketInputs["fallback"]>, cfg: FallbackTextConfig = config.market): string {
  const day = noteDay(fallback.listDate) ?? "an earlier day";
  if (fallback.kind === "saved") return `Trade values from ${day}: FantasyCalc didn't answer.`;
  return `Trade values are our own estimates, not FantasyCalc's: FantasyCalc didn't answer, and the newest list we have, from ${day}, is more than ${cfg.fantasyCalcStaleDays} days old. Each player's value comes from his projected points for the rest of the season, on a curve fitted to that list, so an injured player's value counts only the games he's expected to play. Read trade values as rough.`;
}

// ---------------------------------------------------------------------------------------------
// Waiver credit and package value (§9)

/** Player id → value, as a plain number or a MarketValues entry. A missing id is worth 0. */
export type ValueLookup = Readonly<Record<string, number | { readonly value: number } | undefined>>;

function valueOf(entry: number | { readonly value: number } | undefined): number {
  const v = typeof entry === "number" ? entry : entry?.value;
  return v !== undefined && Number.isFinite(v) ? v : 0;
}

/**
 * W (§9): the value of the best available free agent, at least waiverCreditMinFraction × topValue.
 * Pass the value table and top value of the term being compared (perception for §11's g).
 */
export function waiverCredit(values: ValueLookup, freeAgentIds: readonly string[], topValue: number, cfg: MarketConfig = config.market): number {
  let best = 0;
  for (const id of freeAgentIds) {
    const v = valueOf(values[id]);
    if (v > best) best = v;
  }
  return Math.max(best, cfg.waiverCreditMinFraction * (Number.isFinite(topValue) && topValue > 0 ? topValue : 0));
}

/** v^γ (config.market.studExponent; γ = 1 is off). Values below 0 count as 0. */
function studValue(v: number, gamma: number): number {
  const x = Math.max(0, v);
  return gamma === 1 ? x : x ** gamma;
}

/**
 * The players a side receives onto and gives from its active roster in a trade (the file header): what §9's open-spot
 * credit counts. An IR player given from an IR slot isn't one of `give`, and one received into an IR slot isn't one of
 * `recv` (returners.activeSpots).
 */
export interface ActiveSpots {
  readonly recv: number;
  readonly give: number;
  /**
   * Phase 4c (the neutral throw-in rule, planner reply to Checkpoint 4b, change 2): players who move without an active roster
   * spot (an IR player leaving an IR slot, or one received into an open IR slot), so dropping one of them as a throw-in
   * removes no roster-spot credit. Absent: every player moves with an active spot.
   */
  readonly inactive?: ReadonlySet<string>;
}

/** A spot count when it is a finite number (at least 0), else the fallback (the side's player count). */
const spotCount = (x: number | undefined, fallback: number): number => (x !== undefined && Number.isFinite(x) ? Math.max(0, x) : fallback);

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A package once its neutral throw-ins are left out (neutralThrowIns). */
export interface NeutralPackage {
  /** The players the side receives and gives that still count, each in its given order. */
  readonly recv: readonly string[];
  readonly give: readonly string[];
  /**
   * The players left out (the planner's step, on the side moving more players, then the matched pairs, one from each side:
   * the file header), lowest value first (ties: the smaller id): the same list, in the same order, from either side of a trade.
   */
  readonly removed: readonly string[];
  /** The side's active-roster spots after them: received onto, and given from, its active roster (ActiveSpots' counts). */
  readonly spots: { readonly recv: number; readonly give: number };
}

/** A side's players worth at most `floor` (raw value: a missing or non-finite one is 0), cheapest first (ties: the smaller id, then the place). */
function cheapest(side: readonly string[], values: ValueLookup, floor: number): { id: string; i: number; v: number }[] {
  return side
    .map((id, i) => ({ id, i, v: valueOf(values[id]) }))
    .filter((x) => x.v <= floor)
    .sort((a, b) => a.v - b.v || byId(a.id, b.id) || a.i - b.i);
}

/**
 * The neutral throw-ins of the package of the side that receives `recv` and gives `give` (the file header; planner reply to
 * Checkpoint 4b, change 2, and the lead's closing of the gap the review of track EF found, finding 1): when W is a positive
 * finite number, (1) when one side moves d > 0 more players than the other, up to d of that side's players worth at most W
 * (`values`, before the floor; a missing or non-finite value is 0), cheapest first (ties: the smaller id); (2) then matched
 * pairs of players worth at most W, one from each side, cheapest first on each side (ties: the smaller id), as many pairs as
 * the side with fewer such players left has. Each one left out lowers his side's spot count (spots.give for `give`,
 * spots.recv for `recv`; floored at 0) unless he is in spots.inactive. `spots` defaults to the player counts. Both sides of a
 * trade leave out the same players (the rule reads only `values`, W and the ids), and on each side the players left out are
 * its cheapest ones (a prefix of its cheap players in that order). `opts.pairs` false runs step (1) alone, the planner's
 * own step (search.ts leanVersionOf reads it when both steps would leave a side empty; packages always run both).
 */
export function neutralThrowIns(recv: readonly string[], give: readonly string[], values: ValueLookup, W: number, spots?: ActiveSpots, opts: { readonly pairs?: boolean } = {}): NeutralPackage {
  const floor = Number.isFinite(W) && W > 0 ? W : 0;
  const onto = spotCount(spots?.recv, recv.length);
  const off = spotCount(spots?.give, give.length);
  if (floor === 0) return { recv: [...recv], give: [...give], removed: [], spots: { recv: onto, give: off } };
  const cheapRecv = cheapest(recv, values, floor);
  const cheapGive = cheapest(give, values, floor);
  // (1) The planner's step: on the side moving d more players, up to d of its cheapest.
  const d = give.length - recv.length;
  let nRecv = d < 0 ? Math.min(-d, cheapRecv.length) : 0;
  let nGive = d > 0 ? Math.min(d, cheapGive.length) : 0;
  // (2) Matched pairs of the cheap players left, one from each side, cheapest first on each.
  const pairs = opts.pairs === false ? 0 : Math.min(cheapRecv.length - nRecv, cheapGive.length - nGive);
  nRecv += pairs;
  nGive += pairs;
  const outRecv = cheapRecv.slice(0, nRecv);
  const outGive = cheapGive.slice(0, nGive);
  const goneRecv = new Set(outRecv.map((x) => x.i));
  const goneGive = new Set(outGive.map((x) => x.i));
  const withSpot = (out: readonly { id: string }[]) => out.filter((x) => !spots?.inactive?.has(x.id)).length;
  const removed = [...outRecv, ...outGive].sort((a, b) => a.v - b.v || byId(a.id, b.id)).map((x) => x.id);
  return {
    recv: recv.filter((_, i) => !goneRecv.has(i)),
    give: give.filter((_, i) => !goneGive.has(i)),
    removed,
    spots: { recv: Math.max(0, onto - withSpot(outRecv)), give: Math.max(0, off - withSpot(outGive)) },
  };
}

/**
 * PV_recv and PV_give for the side that receives `recv` and gives `give` (§9; the file header): first the neutral
 * throw-ins are left out (neutralThrowIns, chosen on `throwInValues`, default `values`), then the sum of each player
 * left's max(v, W)^γ, plus W^γ per open active roster spot: max(0, spots.give − spots.recv) on PV_recv (the spots the
 * side opens) and max(0, spots.recv − spots.give) on PV_give (the spots it fills), the spots after the throw-ins.
 * `spots` (ActiveSpots) defaults to the player counts (every player on or off the active roster).
 * A W that isn't a positive finite number counts 0: it floors nothing, credits nothing and leaves nobody out. Pass W = 0
 * for a plain sum of values (benefit.rosterValue). `throwInValues`: premium.perceivedPackage passes the raw values while
 * `values` carries the partner's star premium, so its package leaves out the same players as everyone else's.
 */
export function packageValues(
  recv: readonly string[],
  give: readonly string[],
  values: ValueLookup,
  W: number,
  cfg: MarketConfig = config.market,
  spots?: ActiveSpots,
  throwInValues: ValueLookup = values,
): { recv: number; give: number } {
  const gamma = cfg.studExponent;
  const floor = Number.isFinite(W) && W > 0 ? W : 0;
  const pkg = neutralThrowIns(recv, give, throwInValues, floor, spots);
  let pvRecv = 0;
  for (const id of pkg.recv) pvRecv += studValue(Math.max(valueOf(values[id]), floor), gamma);
  let pvGive = 0;
  for (const id of pkg.give) pvGive += studValue(Math.max(valueOf(values[id]), floor), gamma);
  const credit = studValue(floor, gamma);
  pvRecv += Math.max(0, pkg.spots.give - pkg.spots.recv) * credit;
  pvGive += Math.max(0, pkg.spots.recv - pkg.spots.give) * credit;
  return { recv: pvRecv, give: pvGive };
}

/**
 * g_mkt for the side that receives `recv` and gives `give` (§9): (PV_recv − PV_give) / PV_give, as a
 * fraction (+0.04 = +4%), neutral throw-ins left out (packageValues). For my side pass (what I get, what I give); for
 * the partner, swap them, and pass each side's own ActiveSpots when a trade moves IR players (packageValues).
 * A side that gives nothing of value gains +Infinity when it receives something, else 0.
 */
export function marketGain(recv: readonly string[], give: readonly string[], values: ValueLookup, W: number, cfg: MarketConfig = config.market, spots?: ActiveSpots): number {
  const pv = packageValues(recv, give, values, W, cfg, spots);
  if (pv.give > 0) return (pv.recv - pv.give) / pv.give;
  return pv.recv > 0 ? Number.POSITIVE_INFINITY : 0;
}

/** The League page's market summary: the format, W, the top value and players by value source (an id without a value counts as "none"). */
export function marketSummary(playerIds: readonly string[], values: MarketValues, market: MarketInputs | null, W: number): MarketSummary {
  const counts: Record<ValueSource | "none", number> = { fantasycalc: 0, estimate: 0, floor: 0, none: 0 };
  for (const id of new Set(playerIds)) counts[values[id]?.source ?? "none"] += 1;
  return { format: market?.format ?? null, waiverCredit: market ? W : 0, topValue: market?.topValue ?? 0, counts };
}
