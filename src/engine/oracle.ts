/**
 * Scoring oracle (CLAUDE.md §5): recompute a player's points from raw stats and the league's rules,
 * and compare with the platform's own number. Every platform's oracle tests produce OracleCase[]
 * and run them through runOracle(), so results and rule-type coverage are reported the same way.
 */
import { config } from "./config";
import type { Pos, Scoring, StatLine } from "./model";
import { playedGame, pointsBreakdown, rateFor, ruleApplies, rulePoints, statValue, type PointsBreakdown } from "./scoring";

export interface OracleCase {
  /** e.g. "espn/parker-league" or "sleeper/cross-league-2". Placeholder-only. */
  source: string;
  week: number;
  playerId: string;
  pos: Pos;
  /** Actual stats for the game, in canonical keys. */
  stats: StatLine;
  scoring: Scoring;
  /** The platform's league-scored points. */
  expected: number;
}

/** Rule types the planner requires the oracle to cover (reply to Checkpoint 0, answer 4). */
export const RULE_TYPES = ["perUnit", "byPosition", "threshold", "range", "stepped", "bounded", "composite", "perGame"] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export interface OracleMismatch {
  case: OracleCase;
  got: number;
  diff: number;
  breakdown: PointsBreakdown;
}

export interface OracleSummary {
  total: number;
  within: number;
  rate: number;
  passes: boolean;
  mismatches: OracleMismatch[];
  /**
   * Matched cases in which each rule type was actually TESTED: a wrong reading of that type would
   * have changed the case's points (see ruleTypesIn).
   */
  ruleTypesExercised: Record<RuleType, number>;
}

/**
 * Which rule types this case tests. A type counts only when a wrong reading of it would change the
 * points, so a match is real evidence (Phase 1 review):
 * - byPosition: a position rate that differs from a non-zero base rate (replace ≠ add);
 * - stepped: the floor bites ((min(x, max) − min) / every isn't whole);
 * - bounded: a per-unit or stepped rule's bound cut the stat (x outside [min, max]);
 * - composite: at least two parts of a summed stat are non-zero and the rule scored;
 * - perUnit, threshold, range, perGame: the rule scored.
 */
export function ruleTypesIn(c: OracleCase): Set<RuleType> {
  const out = new Set<RuleType>();
  for (const [key, value] of Object.entries(c.stats)) {
    if (!value) continue;
    const override = c.scoring.byPosition?.[c.pos]?.[key];
    const base = c.scoring.perStat[key] ?? 0;
    if (override !== undefined && base !== 0 && override !== base) out.add("byPosition");
    else if (rateFor(c.scoring, key, c.pos)) out.add("perUnit");
  }
  // A line without games played scores no rule (engine/scoring.ts playedGame), so it tests none.
  for (const rule of playedGame(c.stats) ? c.scoring.rules : []) {
    if (!ruleApplies(rule, c.pos)) continue;
    const points = rulePoints(rule, c.stats);
    if (rule.kind === "perGame") {
      if (points) out.add("perGame");
      continue;
    }
    const x = statValue(c.stats, rule.stat);
    const max = "max" in rule ? rule.max : undefined;
    // A bound is tested only when it cut a non-zero stat (cutting 0 changes nothing).
    const outside = x !== 0 && ((rule.min !== undefined && x < rule.min) || (max !== undefined && x > max));
    switch (rule.kind) {
      case "threshold":
      case "range":
        if (points) out.add(rule.kind);
        break;
      case "perUnit":
        if (rule.min === undefined && rule.max === undefined) {
          if (points) out.add("perUnit");
        } else if (outside) out.add("bounded");
        else if (points) out.add("perUnit");
        break;
      case "stepped": {
        const lo = rule.min ?? 0;
        const steps = (Math.min(x, rule.max ?? Number.POSITIVE_INFINITY) - lo) / rule.every;
        if (x >= lo && Math.abs(steps - Math.round(steps)) > 1e-9) out.add("stepped");
        if (rule.max !== undefined && x > rule.max) out.add("bounded");
        break;
      }
    }
    if (points && typeof rule.stat !== "string" && rule.stat.sum.filter((k) => c.stats[k]).length >= 2) out.add("composite");
  }
  return out;
}

export function runOracle(cases: OracleCase[], tolerance: number = config.scoring.oracleTolerance, target: number = config.scoring.oracleTarget): OracleSummary {
  const exercised = Object.fromEntries(RULE_TYPES.map((t) => [t, 0])) as Record<RuleType, number>;
  const mismatches: OracleMismatch[] = [];
  let within = 0;
  for (const c of cases) {
    const breakdown = pointsBreakdown(c.stats, c.pos, c.scoring);
    const diff = breakdown.total - c.expected;
    if (Math.abs(diff) <= tolerance + 1e-9) {
      within++;
      for (const t of ruleTypesIn(c)) exercised[t]++;
    } else mismatches.push({ case: c, got: breakdown.total, diff, breakdown });
  }
  const rate = cases.length ? within / cases.length : 0;
  return { total: cases.length, within, rate, passes: cases.length > 0 && rate >= target, mismatches, ruleTypesExercised: exercised };
}

/** One line per mismatch with its stat line (§5: report every mismatch along with its stat line). */
export function describeMismatch(m: OracleMismatch): string {
  const stats = Object.entries(m.case.stats)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${m.case.source} wk${m.case.week} ${m.case.pos} ${m.case.playerId}: expected ${m.case.expected}, got ${m.got.toFixed(2)} (${m.diff > 0 ? "+" : ""}${m.diff.toFixed(2)}) | ${stats}`;
}
