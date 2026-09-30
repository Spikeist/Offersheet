/**
 * Points from canonical (Sleeper-key) stats with a converted Fleaflicker scoring (CLAUDE.md §5):
 *   points = Σ rate(k, pos) × stat[k] + bonuses, rate(k, pos) = byPosition[pos][k] ?? perStat[k].
 * Bonuses here are evaluated on actual game stats (≥ threshold, ≤ max when given), not as the
 * expected value used for projections. Used for the scoring-oracle preview (check K).
 */
import type { Pos } from "./positions";
import { scoringKeys, type ConvertedScoring } from "./scoring-map";

/** Ratios are undefined without attempts (a QB who didn't throw has no completion %). */
const RATIO_STATS = new Set(["cmp_pct", "fgm_pct", "rec_ypr", "rec_ypt", "rush_ypa", "pass_ypa", "pass_ypc", "pass_rtg"]);

/**
 * Sleeper omits zero values, and a player who didn't play has no `gp`. A missing count counts as 0
 * only for players who played (a shutout D/ST has no pts_allow); a missing ratio never fires a tier.
 * A composite key "a+b" is the sum of its parts (e.g. Fleaflicker first downs = rec_fd + rec_td).
 */
export function statForBonus(stats: Readonly<Record<string, number>>, key: string): number | undefined {
  if (key.includes("+")) {
    const parts = key.split("+").map((k) => stats[k]);
    if (parts.some((v) => v !== undefined)) return parts.reduce<number>((n, v) => n + (v ?? 0), 0);
    return (stats.gp ?? 0) > 0 ? 0 : undefined;
  }
  const v = stats[key];
  if (v !== undefined) return v;
  if (RATIO_STATS.has(key)) return undefined;
  return (stats.gp ?? 0) > 0 ? 0 : undefined;
}

export function evaluate(stats: Readonly<Record<string, number>>, pos: Pos, s: ConvertedScoring): number {
  let total = 0;
  const own = s.byPosition[pos] ?? {};
  const keys = new Set([...Object.keys(s.perStat), ...Object.keys(own)]);
  for (const k of keys) {
    const v = stats[k];
    if (!v) continue;
    total += (own[k] ?? s.perStat[k] ?? 0) * v;
  }
  for (const b of s.bonuses) {
    if (b.positions && !b.positions.includes(pos)) continue;
    const v = statForBonus(stats, b.stat);
    if (v === undefined) continue;
    if (v >= b.threshold && (b.max === undefined || v <= b.max)) total += b.points;
  }
  return total;
}

export interface OracleRow {
  week: number;
  /** Fleaflicker player id (public). */
  ffId: number;
  name: string;
  ffPos: string;
  pos: Pos | null;
  /** League-scored points from the box score. */
  actual: number;
  computed: number | null;
  diff: number | null;
  /** Why no comparison was made, or a hint for a mismatch. */
  reason?: string;
  /** Non-zero stats the scoring reads (for mismatch reports). */
  statLine?: Record<string, number>;
  /** The player's full Sleeper stat row (for explaining mismatches; never serialized). */
  sleeper?: Readonly<Record<string, number>>;
}

export interface OracleSummary {
  rows: number;
  compared: number;
  within: number;
  rate: number;
  /** Compared rows where both sides are 0 (mostly players who didn't play): they inflate the rate. */
  zeroZero: number;
  /** Rate over the rows that are not 0-vs-0. */
  rateNonZero: number;
  skipped: Record<string, number>;
  byPos: Record<string, { compared: number; within: number }>;
  mismatches: OracleRow[];
}

export function summarizeOracle(rows: readonly OracleRow[], tolerance = 0.05): OracleSummary {
  const out: OracleSummary = { rows: rows.length, compared: 0, within: 0, rate: 0, zeroZero: 0, rateNonZero: 0, skipped: {}, byPos: {}, mismatches: [] };
  for (const r of rows) {
    if (r.computed === null || r.diff === null) {
      const why = r.reason ?? "not compared";
      out.skipped[why] = (out.skipped[why] ?? 0) + 1;
      continue;
    }
    out.compared++;
    if (Math.abs(r.actual) <= tolerance && Math.abs(r.computed) <= tolerance) out.zeroZero++;
    const bucket = (out.byPos[r.ffPos] ??= { compared: 0, within: 0 });
    bucket.compared++;
    if (Math.abs(r.diff) <= tolerance) {
      out.within++;
      bucket.within++;
    } else out.mismatches.push(r);
  }
  out.rate = out.compared ? out.within / out.compared : 0;
  const nonZero = out.compared - out.zeroZero;
  out.rateNonZero = nonZero ? (out.within - out.zeroZero) / nonZero : 0;
  out.mismatches.sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0));
  return out;
}

/** Counts per difference (recomputed − platform, rounded to 0.01), largest count first. */
export function diffHistogram(rows: readonly OracleRow[]): Array<{ diff: number; count: number }> {
  const counts = new Map<number, number>();
  for (const r of rows) {
    if (r.diff === null) continue;
    const d = Math.round(r.diff * 100) / 100 || 0; // no "-0"
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].map(([diff, count]) => ({ diff, count })).sort((a, b) => b.count - a.count || a.diff - b.diff);
}

/** The stats a scoring reads that are non-zero for this player (a compact stat line). */
export function statLine(stats: Readonly<Record<string, number>>, s: ConvertedScoring): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of scoringKeys(s)) if (stats[k]) out[k] = stats[k] as number;
  return out;
}
