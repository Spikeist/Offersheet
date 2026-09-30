/**
 * Scoring engine (CLAUDE.md §5). Pure and deterministic.
 *
 * points = Σ rate(k, pos) × stat[k] + Σ rules, where rate(k, pos) = byPosition[pos][k] (a REPLACEMENT
 * rate, as ESPN pointsOverrides work) or else perStat[k].
 *
 * Two modes:
 * - actualPoints(): a real stat line (one game). Every rule is evaluated exactly. The oracle tests
 *   compare this with the platform's own number.
 * - expectedPoints(): projected means. Linear parts are exact in expectation; threshold, range,
 *   stepped and bounded per-unit rules are expected values over Normal(mean, sd), with sd from
 *   config.statSd or bonusCv × mean. Bounds sit halfway between a stat's grid points
 *   (config.statGrid: counts 1, IDP sacks 0.5, ratios continuous) so adjacent buckets (14–17, 18–21)
 *   tile the line, and mass below a stat's floor (config.statFloor: points allowed ≥ 0) counts in the
 *   lowest bucket. A rule whose stats the projection doesn't carry scores 0. Per-game constants
 *   count once per projected game.
 */
import { config } from "./config";
import type { ScoringConfig } from "./config";
import type { Pos, Scoring, ScoringRule, StatExpr, StatLine } from "./model";

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

/** Standard normal CDF (Abramowitz & Stegun 7.1.26; absolute error < 1.5e-7). */
export function normalCdf(z: number): number {
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function normalPdf(z: number): number {
  if (!Number.isFinite(z)) return 0;
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** SD of a stat expression's projection; a composite sums independent component variances. */
export function statSd(expr: StatExpr, proj: StatLine, cfg: ScoringConfig = config.scoring): number {
  const sdOf = (key: string) => cfg.statSd[key] ?? cfg.bonusCv * Math.abs(proj[key] ?? 0);
  if (typeof expr === "string") return sdOf(expr);
  let variance = 0;
  for (const k of expr.sum) variance += sdOf(k) ** 2;
  return Math.sqrt(variance);
}

/** A stat expression's grid (0 = continuous); a composite takes its finest component. */
export function statGrid(expr: StatExpr, cfg: ScoringConfig = config.scoring): number {
  const gridOf = (key: string) => cfg.statGrid[key] ?? cfg.defaultStatGrid;
  if (typeof expr === "string") return gridOf(expr);
  const grids = expr.sum.map(gridOf);
  return grids.some((g) => !(g > 0)) ? 0 : Math.min(...grids);
}

const EPS = 1e-9;

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

/** P(lo ≤ X ≤ hi) for X ~ Normal(mu, sigma). */
function probBetween(lo: number, hi: number, mu: number, sigma: number): number {
  return Math.max(0, normalCdf((hi - mu) / sigma) - normalCdf((lo - mu) / sigma));
}

const STEPPED_MAX_TERMS = 10_000;

/** Expected points of one rule for projected means. */
export function expectedRulePoints(rule: ScoringRule, proj: StatLine, cfg: ScoringConfig = config.scoring): number {
  if (rule.kind === "perGame") return rule.points; // once per projected game; availability applies later (§6)
  if (!projected(rule.stat, proj)) return 0; // e.g. a D/ST row without points allowed: no phantom shutout bonus
  const mu = statValue(proj, rule.stat);
  const sigma = statSd(rule.stat, proj, cfg);
  if (!(sigma > 1e-9)) return rulePoints(rule, proj); // no spread: the projection is treated as exact
  const grid = statGrid(rule.stat, cfg);
  const floor = typeof rule.stat === "string" ? cfg.statFloor[rule.stat] : undefined;
  const lower = (b: number | undefined) => lowerBound(b, grid, floor);
  const upper = (b: number | undefined) => upperBound(b, grid);
  switch (rule.kind) {
    case "threshold":
      return rule.points * probBetween(lower(rule.min), Number.POSITIVE_INFINITY, mu, sigma);
    case "range":
      return rule.points * probBetween(lower(rule.min), upper(rule.max), mu, sigma);
    case "perUnit": {
      if (rule.min === undefined && rule.max === undefined) return rule.points * mu;
      // Partial expectation E[X · 1{a ≤ X ≤ b}] = mu·(Φ(β) − Φ(α)) + sigma·(φ(α) − φ(β)).
      const a = (lower(rule.min) - mu) / sigma;
      const b = (upper(rule.max) - mu) / sigma;
      return rule.points * (mu * (normalCdf(b) - normalCdf(a)) + sigma * (normalPdf(a) - normalPdf(b)));
    }
    case "stepped": {
      // floor((min(X, hi) − lo) / every) ≥ k  ⇔  X ≥ lo + k·every (for lo + k·every ≤ hi),
      // so E[count] = Σ_k P(X ≥ lo + k·every).
      const lo = rule.min ?? 0;
      const hi = rule.max ?? Number.POSITIVE_INFINITY;
      let expected = 0;
      for (let k = 1; k <= STEPPED_MAX_TERMS; k++) {
        const t = lo + k * rule.every;
        if (t > hi) break;
        const p = probBetween(lower(t), Number.POSITIVE_INFINITY, mu, sigma);
        expected += p;
        if (p < 1e-12 && t > mu) break;
      }
      return rule.points * expected;
    }
  }
}

/** Expected fantasy points for one game from projected stat means. */
export function expectedPoints(proj: StatLine, pos: Pos, scoring: Scoring, cfg: ScoringConfig = config.scoring): number {
  let total = 0;
  for (const [key, value] of Object.entries(proj)) {
    if (!value) continue;
    const rate = rateFor(scoring, key, pos);
    if (rate) total += rate * value;
  }
  for (const rule of scoring.rules) if (ruleApplies(rule, pos)) total += expectedRulePoints(rule, proj, cfg);
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
