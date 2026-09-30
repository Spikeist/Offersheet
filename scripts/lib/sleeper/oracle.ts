/**
 * Scoring oracle preview (CLAUDE.md §5): recompute each rostered player's league points from raw
 * stats and compare with the points Sleeper reports in /matchups players_points.
 *
 * /stats uses the same keys as scoring_settings, so points = Σ scoring_settings[k] × stats[k] with
 * no mapping step (projections are different: see scoringKeys.ts). Missing stat keys count as 0
 * (the stats feed is sparse).
 */

export type StatLine = Record<string, number>;

/** Σ rate × stat over every scoring key (unknown/missing stats count as 0). */
export function leaguePoints(scoring: Record<string, number>, stats: StatLine | null | undefined): number {
  if (!stats) return 0;
  let total = 0;
  for (const [k, rate] of Object.entries(scoring)) {
    const v = stats[k];
    if (typeof v === "number" && Number.isFinite(v) && rate) total += rate * v;
  }
  return total;
}

/** Each scoring key's contribution for one stat line (non-zero only), largest first. */
export function contributions(scoring: Record<string, number>, stats: StatLine | null | undefined): Array<{ key: string; stat: number; rate: number; points: number }> {
  const out: Array<{ key: string; stat: number; rate: number; points: number }> = [];
  if (!stats) return out;
  for (const [k, rate] of Object.entries(scoring)) {
    const v = stats[k];
    if (typeof v === "number" && v !== 0 && rate) out.push({ key: k, stat: v, rate, points: rate * v });
  }
  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

export interface OracleWeekInput {
  week: number;
  /** One entry per roster: the players on it that week and Sleeper's per-player points. */
  entries: Array<{ rosterId: number; players: string[]; playersPoints: Record<string, number> }>;
  /** Actual stats for the week by player ID (from /stats). */
  stats: Map<string, StatLine>;
}

export interface OracleMismatch {
  week: number;
  rosterId: number;
  playerId: string;
  pos: string;
  platform: number;
  computed: number;
  /** platform − computed */
  diff: number;
  hasStats: boolean;
  /** Scoring keys whose contribution alone would explain the difference (pattern hints). */
  explainedBy: string[];
  /** The player's non-zero scored stats: key → stat value. */
  statLine: StatLine;
}

export interface OracleResult {
  tolerance: number;
  /** Every rostered player-week that has a players_points entry. */
  total: number;
  within: number;
  rate: number;
  /** Player-weeks where Sleeper's points or our computed points are non-zero (the informative ones). */
  nonZeroTotal: number;
  nonZeroWithin: number;
  nonZeroRate: number;
  /** Player-weeks with players_points but no stats row, and non-zero platform points. */
  missingStats: number;
  mismatches: OracleMismatch[];
  /** Counts by "POS: explanation" for quick pattern reading. */
  patterns: Record<string, number>;
  byPosition: Record<string, { total: number; within: number }>;
  /**
   * Per scoring key: player-weeks where the key contributed (non-zero stat and rate) and how many of
   * those matched Sleeper. Shows which rules the oracle actually exercised.
   */
  byKey: Record<string, { exercised: number; within: number }>;
}

export function runOracle(scoring: Record<string, number>, weeks: OracleWeekInput[], positionOf: (playerId: string) => string, tolerance = 0.05): OracleResult {
  let total = 0;
  let within = 0;
  let nonZeroTotal = 0;
  let nonZeroWithin = 0;
  let missingStats = 0;
  const mismatches: OracleMismatch[] = [];
  const patterns: Record<string, number> = {};
  const byPosition: Record<string, { total: number; within: number }> = {};
  const byKey: Record<string, { exercised: number; within: number }> = {};

  for (const w of weeks) {
    for (const e of w.entries) {
      for (const pid of e.players) {
        const platform = e.playersPoints[pid];
        if (typeof platform !== "number") continue;
        const stats = w.stats.get(pid);
        const computed = leaguePoints(scoring, stats);
        const diff = platform - computed;
        const ok = Math.abs(diff) <= tolerance;
        const pos = positionOf(pid) || "?";
        total++;
        const bp = (byPosition[pos] ??= { total: 0, within: 0 });
        bp.total++;
        if (ok) {
          within++;
          bp.within++;
        }
        for (const c of contributions(scoring, stats)) {
          const k = (byKey[c.key] ??= { exercised: 0, within: 0 });
          k.exercised++;
          if (ok) k.within++;
        }
        if (platform !== 0 || Math.abs(computed) > 1e-9) {
          nonZeroTotal++;
          if (ok) nonZeroWithin++;
        }
        if (!stats && platform !== 0) missingStats++;
        if (!ok) {
          const contrib = contributions(scoring, stats);
          // A key that we counted but Sleeper didn't (diff ≈ −points), or the reverse.
          const explainedBy = contrib.filter((c) => Math.abs(Math.abs(c.points) - Math.abs(diff)) <= tolerance).map((c) => `${c.key}${Math.sign(c.points) === -Math.sign(diff) ? " (we count it, Sleeper doesn't)" : " (Sleeper counts it twice?)"}`);
          const statLine: StatLine = Object.fromEntries(contrib.map((c) => [c.key, c.stat]));
          mismatches.push({ week: w.week, rosterId: e.rosterId, playerId: pid, pos, platform, computed: round2(computed), diff: round2(diff), hasStats: Boolean(stats), explainedBy, statLine });
          const why = !stats ? "no stats row" : explainedBy[0] ?? (diff > 0 ? "Sleeper higher (a scored stat missing from /stats?)" : "Sleeper lower");
          const key = `${pos}: ${why}`;
          patterns[key] = (patterns[key] ?? 0) + 1;
        }
      }
    }
  }
  return {
    tolerance,
    total,
    within,
    rate: total ? within / total : 0,
    nonZeroTotal,
    nonZeroWithin,
    nonZeroRate: nonZeroTotal ? nonZeroWithin / nonZeroTotal : 0,
    missingStats,
    mismatches,
    patterns,
    byPosition,
    byKey,
  };
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
