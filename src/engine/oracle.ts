/**
 * Scoring oracle (CLAUDE.md §5): recompute a player's points from raw stats and the league's rules,
 * and compare with the platform's own number. Every platform's oracle tests produce OracleCase[]
 * and run them through runOracle(), so results and rule-type coverage are reported the same way.
 */
import { config } from "./config";
import type { Pos, Scoring, ScoringRule, StatLine } from "./model";
import { pointsBreakdown, rateFor, ruleApplies, rulePoints, type PointsBreakdown } from "./scoring";

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
  /** Matched cases in which each rule type contributed non-zero points. */
  ruleTypesExercised: Record<RuleType, number>;
}

function isBounded(rule: ScoringRule): boolean {
  if (rule.kind === "perUnit") return rule.min !== undefined || rule.max !== undefined;
  if (rule.kind === "stepped") return rule.max !== undefined || (rule.min ?? 0) !== 0;
  if (rule.kind === "range") return rule.min !== undefined && rule.max !== undefined;
  return false;
}

/** Which rule types contributed non-zero points to this case. */
export function ruleTypesIn(c: OracleCase): Set<RuleType> {
  const out = new Set<RuleType>();
  for (const [key, value] of Object.entries(c.stats)) {
    if (!value) continue;
    const override = c.scoring.byPosition?.[c.pos]?.[key];
    if (override !== undefined && override !== 0) out.add("byPosition");
    else if (rateFor(c.scoring, key, c.pos)) out.add("perUnit");
  }
  for (const rule of c.scoring.rules) {
    if (!ruleApplies(rule, c.pos) || !rulePoints(rule, c.stats)) continue;
    out.add(rule.kind === "perUnit" ? "perUnit" : rule.kind);
    if (isBounded(rule)) out.add("bounded");
    if (rule.kind !== "perGame" && typeof rule.stat !== "string") out.add("composite");
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
