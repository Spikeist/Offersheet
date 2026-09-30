/**
 * Scoring engine (CLAUDE.md §5). Pure and deterministic.
 *
 * points = Σ rate(k, pos) × stat[k] + Σ rules, where rate(k, pos) = byPosition[pos][k] (a REPLACEMENT
 * rate, as ESPN pointsOverrides work) or else perStat[k].
 *
 * Two modes:
 * - actualPoints(): a real stat line (one game). Every rule is evaluated exactly. The oracle tests
 *   compare this with the platform's own number.
 * - expectedPoints(): projected means. Linear parts (per-unit rates, unbounded per-unit rules) are
 *   exact in expectation. Threshold, range, stepped and bounded per-unit rules are expected values
 *   over a distribution around the projected stat (planner reply to Checkpoint 1, answer 3; the
 *   math is in distributions.ts), chosen per stat key in this order:
 *   1. a key in config.statSd → Normal with that fixed SD (completion % 10, D/ST points allowed 9,
 *      D/ST yards allowed as measured);
 *   2. a yardage key (config.yardageKeyPattern, never a bonus_* key) → Normal with the measured
 *      model SD = max(yardageSdMin, a + b × mean) (config.yardageSd, `npm run measure:stat-sd`);
 *   3. any other key is a count (TDs, receptions, interceptions, sacks, FGs made, 2-point
 *      conversions, fumbles, attempts, tackles, …) → Poisson with mean = the projection, on the
 *      stat's grid (IDP sacks in halves), so P(X ≥ k) is exact: a "2+ TD" bonus at 0.8 projected TDs
 *      is worth 19% of its points, not ≈ 0. A continuous key (grid 0) outside statSd can't be a count
 *      and falls back to Normal(mean, bonusCv × mean).
 *   A composite stat (a sum of keys) is Poisson of the summed mean when every part is a count on one
 *   grid (exact for independent counts); otherwise a normal with the summed mean and variance
 *   (a count adds unit × mean), floored at the summed floors when every normal part has one (a
 *   count's floor is 0).
 *   Floors: config.statFloor (points and yards allowed ≥ 0) and yardageFloor (yards ≥ 0). The
 *   floor's mass counts in the lowest bucket, and a floored normal is placed so its mean still equals
 *   the projection. Bounds sit halfway between a stat's grid points (config.statGrid: counts 1, IDP
 *   sacks 0.5, ratios continuous), which is exact for the lattice Poisson and makes adjacent buckets
 *   (14–17, 18–21) tile the line. A projection with no spread (a zero mean count, a stat at its
 *   floor) is scored exactly at its mean. A rule whose stats the projection doesn't carry scores 0.
 *   Per-game constants count once per projected game.
 */
import { config } from "./config";
import type { ScoringConfig } from "./config";
import { normalDist, poissonDist, type StatDist } from "./distributions";
import type { Pos, Scoring, ScoringRule, StatExpr, StatLine } from "./model";

export { normalCdf, normalPdf, type StatDist } from "./distributions";

/** Value of a stat expression in a line; missing keys count as 0. */
export function statValue(stats: StatLine, expr: StatExpr): number {
  if (typeof expr === "string") return stats[expr] ?? 0;
  let sum = 0;
  for (const k of expr.sum) sum += stats[k] ?? 0;
  return sum;
}

/** Per-unit rate for a key at a position: byPosition replaces perStat. */
export function rateFor(scoring: Scoring, key: string, pos: Pos): number {
  const override = scoring.byPosition?.[pos]?.[key];
  return override ?? scoring.perStat[key] ?? 0;
}

export function ruleApplies(rule: ScoringRule, pos: Pos): boolean {
  return !rule.positions || rule.positions.includes(pos);
}

/**
 * Exact points for one rule on an actual stat line. A per-game constant needs games played: platforms
 * leave gp out of the line of a player who didn't play (Sleeper, ESPN stat 210), and he scores 0.
 */
export function rulePoints(rule: ScoringRule, stats: StatLine): number {
  if (rule.kind === "perGame") return rule.points * (stats.gp ?? 0);
  const x = statValue(stats, rule.stat);
  switch (rule.kind) {
    case "threshold":
      return x >= rule.min ? rule.points : 0;
    case "range":
      return (rule.min === undefined || x >= rule.min) && (rule.max === undefined || x <= rule.max) ? rule.points : 0;
    case "perUnit":
      return (rule.min === undefined || x >= rule.min) && (rule.max === undefined || x <= rule.max) ? rule.points * x : 0;
    case "stepped": {
      const lo = rule.min ?? 0;
      const hi = rule.max ?? Number.POSITIVE_INFINITY;
      if (x < lo) return 0;
      // Small epsilon so 125 yards / 25 is exactly 5 despite floating-point noise.
      return Math.floor((Math.min(x, hi) - lo) / rule.every + 1e-9) * rule.points;
    }
  }
}

export interface PointsBreakdown {
  total: number;
  perStat: { key: string; value: number; rate: number; points: number }[];
  rules: { index: number; kind: ScoringRule["kind"]; points: number }[];
}

/**
 * Whether an actual stat line is a game played. Platforms leave gp out of the line of a player who
 * didn't play (Sleeper, ESPN stat 210), and score him 0: no rule fires on an empty line (a "≤ 50%
 * completions" tier or a "0 points allowed" bucket would otherwise pay out for a bye).
 */
export function playedGame(stats: StatLine): boolean {
  return (stats.gp ?? 0) > 0;
}

/** Actual points with a per-key and per-rule breakdown (used to explain oracle mismatches). */
export function pointsBreakdown(stats: StatLine, pos: Pos, scoring: Scoring): PointsBreakdown {
  const out: PointsBreakdown = { total: 0, perStat: [], rules: [] };
  const played = playedGame(stats);
  for (const [key, value] of Object.entries(stats)) {
    if (!value) continue;
    const rate = rateFor(scoring, key, pos);
    if (!rate) continue;
    const points = rate * value;
    out.perStat.push({ key, value, rate, points });
    out.total += points;
  }
  scoring.rules.forEach((rule, index) => {
    if (!played || !ruleApplies(rule, pos)) return;
    const points = rulePoints(rule, stats);
    if (points) out.rules.push({ index, kind: rule.kind, points });
    out.total += points;
  });
  return out;
}

/** Actual fantasy points for one game's stat line. */
export function actualPoints(stats: StatLine, pos: Pos, scoring: Scoring): number {
  return pointsBreakdown(stats, pos, scoring).total;
}

// ---------------------------------------------------------------------------------------------
// Expected points for projections

/** Tolerance for bounds that land on a grid point despite floating-point noise. */
const EPS = 1e-9;
/** Below this SD a projection is treated as exact (no spread). */
const SD_EPS = 1e-9;

/** A stat expression's grid (0 = continuous); a composite takes its finest component. */
export function statGrid(expr: StatExpr, cfg: ScoringConfig = config.scoring): number {
  const gridOf = (key: string) => cfg.statGrid[key] ?? cfg.defaultStatGrid;
  if (typeof expr === "string") return gridOf(expr);
  const grids = expr.sum.map(gridOf);
  return grids.some((g) => !(g > 0)) ? 0 : Math.min(...grids);
}

/** Whether a stat key is yardage (a normal with the measured SD model); bonus_* indicator keys never are. */
export function isYardageKey(key: string, cfg: ScoringConfig = config.scoring): boolean {
  return !key.startsWith("bonus_") && cfg.yardageKeyPattern.test(key);
}

/** The yardage SD model: max(yardageSdMin, a + b × mean), with {a, b} measured per stat (config.yardageSd, else its default). */
export function yardageSd(key: string, mean: number, cfg: ScoringConfig = config.scoring): number {
  const model = cfg.yardageSd[key] ?? cfg.yardageSd.default ?? { a: 0, b: cfg.bonusCv };
  return Math.max(cfg.yardageSdMin, model.a + model.b * Math.max(0, mean));
}

/** One stat key's distribution family and parameters (the order is in the file header). */
type KeyModel = { family: "normal"; mean: number; sd: number; floor: number | undefined } | { family: "poisson"; mean: number; unit: number };

function keyModel(key: string, proj: StatLine, cfg: ScoringConfig): KeyModel {
  const mean = proj[key] ?? 0;
  const yardage = isYardageKey(key, cfg);
  const floor = cfg.statFloor[key] ?? (yardage ? cfg.yardageFloor : undefined);
  const fixed = cfg.statSd[key];
  if (fixed !== undefined) return { family: "normal", mean, sd: fixed, floor };
  if (yardage) return { family: "normal", mean, sd: yardageSd(key, mean, cfg), floor };
  const grid = statGrid(key, cfg);
  // A continuous ratio without a fixed SD can't be a count.
  if (!(grid > 0)) return { family: "normal", mean, sd: cfg.bonusCv * Math.abs(mean), floor };
  return { family: "poisson", mean, unit: grid };
}

const keysOf = (expr: StatExpr): readonly string[] => (typeof expr === "string" ? [expr] : expr.sum);

/**
 * A key's variance before any floor: unit × mean for a count, sd² for a normal — 0 for a floored
 * stat projected at or below its floor (or not projected at all), which has no spread (the same
 * reading a single key gets: scored exactly at its mean).
 */
function partVariance(m: KeyModel): number {
  if (m.family === "poisson") return m.unit * Math.max(0, m.mean);
  return m.floor !== undefined && !(m.mean > m.floor) ? 0 : m.sd ** 2;
}

/**
 * SD of a stat expression's projection before any floor: the fixed or yardage-model SD of a normal
 * key, √(unit × mean) of a count, 0 for a floored stat at its floor; a composite sums independent
 * component variances (the measured RB rushing/receiving residual correlation is ≈ 0).
 */
export function statSd(expr: StatExpr, proj: StatLine, cfg: ScoringConfig = config.scoring): number {
  let variance = 0;
  for (const k of keysOf(expr)) variance += partVariance(keyModel(k, proj, cfg));
  return Math.sqrt(variance);
}

/**
 * The distribution a projected stat expression is evaluated over (see the file header). A point
 * mass (family "point") means no spread: rules are then scored exactly at the projected means.
 */
export function statDistribution(expr: StatExpr, proj: StatLine, cfg: ScoringConfig = config.scoring): StatDist {
  const parts = keysOf(expr).map((k) => keyModel(k, proj, cfg));
  const first = parts[0];
  if (first?.family === "poisson" && parts.every((p) => p.family === "poisson" && p.unit === first.unit)) {
    // Independent counts on one grid: the sum is Poisson with the summed mean (exact).
    return poissonDist(
      parts.reduce((s, p) => s + Math.max(0, p.mean), 0),
      first.unit,
    );
  }
  // A normal key, or a composite matched on mean and variance (counts add unit × mean, floor 0).
  let mean = 0;
  let variance = 0;
  let floor: number | undefined = 0;
  for (const p of parts) {
    mean += p.mean;
    variance += partVariance(p);
    if (p.family === "normal") floor = floor === undefined || p.floor === undefined ? undefined : floor + p.floor;
  }
  const sd = Math.sqrt(variance);
  return sd > SD_EPS ? normalDist(mean, sd, floor) : normalDist(mean, 0);
}

/** "X ≥ b" on grid g: X ≥ ceil(b/g)·g − g/2 (b itself when continuous). A bound at or below the stat's floor is no bound. */
function lowerBound(b: number | undefined, grid: number, floor: number | undefined): number {
  if (b === undefined || (floor !== undefined && b <= floor)) return Number.NEGATIVE_INFINITY;
  return grid > 0 ? Math.ceil(b / grid - EPS) * grid - grid / 2 : b;
}
/** "X ≤ b" on grid g: X ≤ floor(b/g)·g + g/2 (b itself when continuous). */
function upperBound(b: number | undefined, grid: number): number {
  if (b === undefined) return Number.POSITIVE_INFINITY;
  return grid > 0 ? Math.floor(b / grid + EPS) * grid + grid / 2 : b;
}

/** Whether the projection carries any of the expression's stats (a missing stat is unknown, not 0). */
function projected(expr: StatExpr, proj: StatLine): boolean {
  return typeof expr === "string" ? proj[expr] !== undefined : expr.sum.some((k) => proj[k] !== undefined);
}

const STEPPED_MAX_TERMS = 10_000;

/** Distributions already built for one projected line, by stat expression (bucket rules share one). */
type DistMemo = Map<string, StatDist>;

function memoKey(expr: StatExpr): string {
  return typeof expr === "string" ? expr : `\u0000${expr.sum.join("\u0000")}`;
}

function ruleExpectation(rule: ScoringRule, proj: StatLine, cfg: ScoringConfig, memo: DistMemo): number {
  if (rule.kind === "perGame") return rule.points; // once per projected game; availability applies later (§6)
  if (!projected(rule.stat, proj)) return 0; // e.g. a D/ST row without points allowed: no phantom shutout bonus
  // An unbounded per-unit rule is linear: exact in expectation whatever the distribution.
  if (rule.kind === "perUnit" && rule.min === undefined && rule.max === undefined) return rule.points * statValue(proj, rule.stat);
  const key = memoKey(rule.stat);
  let dist = memo.get(key);
  if (!dist) {
    dist = statDistribution(rule.stat, proj, cfg);
    memo.set(key, dist);
  }
  if (dist.family === "point") return rulePoints(rule, proj); // no spread: the projection is treated as exact
  const grid = statGrid(rule.stat, cfg);
  const floor = dist.floor;
  const lower = (b: number | undefined) => lowerBound(b, grid, floor);
  const upper = (b: number | undefined) => upperBound(b, grid);
  switch (rule.kind) {
    case "threshold":
      return rule.points * dist.prob(lower(rule.min), Number.POSITIVE_INFINITY);
    case "range":
      return rule.points * dist.prob(lower(rule.min), upper(rule.max));
    case "perUnit":
      return rule.points * dist.partialMean(lower(rule.min), upper(rule.max));
    case "stepped": {
      // floor((min(X, hi) − lo) / every) ≥ k  ⇔  X ≥ lo + k·every (for lo + k·every ≤ hi),
      // so E[count] = Σ_k P(X ≥ lo + k·every).
      const lo = rule.min ?? 0;
      const hi = rule.max ?? Number.POSITIVE_INFINITY;
      let expected = 0;
      for (let k = 1; k <= STEPPED_MAX_TERMS; k++) {
        const t = lo + k * rule.every;
        if (t > hi) break;
        const p = dist.prob(lower(t), Number.POSITIVE_INFINITY);
        expected += p;
        if (p < 1e-12 && t > dist.mean) break;
      }
      return rule.points * expected;
    }
  }
}

/** Expected points of one rule for projected means. */
export function expectedRulePoints(rule: ScoringRule, proj: StatLine, cfg: ScoringConfig = config.scoring): number {
  return ruleExpectation(rule, proj, cfg, new Map());
}

/** Expected fantasy points for one game from projected stat means. */
export function expectedPoints(proj: StatLine, pos: Pos, scoring: Scoring, cfg: ScoringConfig = config.scoring): number {
  let total = 0;
  for (const [key, value] of Object.entries(proj)) {
    if (!value) continue;
    const rate = rateFor(scoring, key, pos);
    if (rate) total += rate * value;
  }
  const memo: DistMemo = new Map();
  for (const rule of scoring.rules) if (ruleApplies(rule, pos)) total += ruleExpectation(rule, proj, cfg, memo);
  return total;
}

/** Every canonical stat key a scoring system reads (for coverage checks against a stat source). */
export function scoringStatKeys(scoring: Scoring): Set<string> {
  const keys = new Set<string>(Object.keys(scoring.perStat));
  for (const table of Object.values(scoring.byPosition ?? {})) for (const k of Object.keys(table ?? {})) keys.add(k);
  for (const rule of scoring.rules) {
    if (rule.kind === "perGame") continue;
    if (typeof rule.stat === "string") keys.add(rule.stat);
    else for (const k of rule.stat.sum) keys.add(k);
  }
  return keys;
}
