/**
 * Scoring oracle dry run for MFL (CLAUDE.md §5). MFL never publishes raw stats (api_info: "We can not
 * and will not under any circumstance make raw NFL player stats available"), so the oracle recomputes
 * MFL's league-scored playerScores from Sleeper's weekly stats through the compiled rule map, joined
 * via a player-ID crosswalk. Pure functions; the probe does the fetching.
 */
import type { Compiled } from "./rules";
import { scoreStats } from "./rules";

export interface MflPlayerIds {
  id: string;
  name?: string;
  position?: string;
  espn_id?: string;
  rotowire_id?: string;
  sportsdata_id?: string;
  stats_id?: string;
}

export interface SleeperIds {
  player_id: string;
  espn_id?: unknown;
  rotowire_id?: unknown;
  sportradar_id?: unknown;
  stats_id?: unknown;
}

export type XwalkMethod = "dynastyprocess" | "espn_id" | "sportradar_id" | "rotowire_id" | "stats_id";

export interface Crosswalk {
  sleeperOf: Map<string, { sleeperId: string; via: XwalkMethod }>;
  /** Where DynastyProcess and an ID join both give an answer: how often they agree. */
  agreement: Record<Exclude<XwalkMethod, "dynastyprocess">, { agree: number; disagree: number }>;
}

const clean = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && s !== "NA" && s !== "0" ? s : undefined;
};

/**
 * MFL id → Sleeper id. DynastyProcess (mfl_id → sleeper_id) first; then joins through the Sleeper
 * players DB on ESPN, Sportradar (MFL calls it sportsdata_id), Rotowire and STATS ids.
 */
export function buildCrosswalk(mfl: MflPlayerIds[], dpRows: Array<Record<string, string>>, sleeper: SleeperIds[]): Crosswalk {
  const dp = new Map<string, string>();
  for (const r of dpRows) {
    const m = clean(r.mfl_id);
    const s = clean(r.sleeper_id);
    if (m && s && !dp.has(m)) dp.set(m, s);
  }
  const joins: Array<[Exclude<XwalkMethod, "dynastyprocess">, keyof MflPlayerIds, keyof SleeperIds]> = [
    ["espn_id", "espn_id", "espn_id"],
    ["sportradar_id", "sportsdata_id", "sportradar_id"],
    ["rotowire_id", "rotowire_id", "rotowire_id"],
    ["stats_id", "stats_id", "stats_id"],
  ];
  const index = new Map<string, Map<string, string>>();
  for (const [method, , sKey] of joins) {
    const m = new Map<string, string>();
    for (const p of sleeper) {
      const v = clean(p[sKey]);
      if (v && !m.has(v.toLowerCase())) m.set(v.toLowerCase(), p.player_id);
    }
    index.set(method, m);
  }
  const out: Crosswalk = { sleeperOf: new Map(), agreement: { espn_id: { agree: 0, disagree: 0 }, sportradar_id: { agree: 0, disagree: 0 }, rotowire_id: { agree: 0, disagree: 0 }, stats_id: { agree: 0, disagree: 0 } } };
  for (const p of mfl) {
    const fromDp = dp.get(p.id);
    let chosen: { sleeperId: string; via: XwalkMethod } | undefined = fromDp ? { sleeperId: fromDp, via: "dynastyprocess" } : undefined;
    for (const [method, mKey] of joins) {
      const v = clean(p[mKey]);
      const hit = v ? index.get(method)?.get(v.toLowerCase()) : undefined;
      if (!hit) continue;
      if (fromDp) out.agreement[method][hit === fromDp ? "agree" : "disagree"]++;
      chosen ??= { sleeperId: hit, via: method };
    }
    if (chosen) out.sleeperOf.set(p.id, chosen);
  }
  return out;
}

export interface OracleRow {
  week: number;
  mflId: string;
  mflPos: string;
  mfl: number;
  ours: number;
  diff: number;
}

export interface OracleResult {
  compared: number;
  within: number;
  rate: number;
  byPos: Record<string, { compared: number; within: number }>;
  /** Not compared: no crosswalk / no compiled scoring; bothZero = 0 on both sides (didn't play). */
  skipped: { noCrosswalk: number; noCompiledScoring: number; bothZero: number };
  worst: OracleRow[];
}

/**
 * Compare MFL's league-scored points with points recomputed from Sleeper stats (tolerance 0.05, the
 * §5 target). A player with no Sleeper stat row that week scores 0 on our side.
 */
export function runOracle(args: {
  weeks: number[];
  players: Array<{ mflId: string; mflPos: string }>;
  mflScores: Map<number, Map<string, number>>;
  sleeperStats: Map<number, Map<string, Record<string, number>>>;
  compiled: Map<string, Compiled>;
  xwalk: Crosswalk;
  tolerance?: number;
}): { result: OracleResult; rows: OracleRow[] } {
  const tol = args.tolerance ?? 0.05;
  const rows: OracleRow[] = [];
  const skipped = { noCrosswalk: 0, noCompiledScoring: 0, bothZero: 0 };
  for (const week of args.weeks) {
    const mfl = args.mflScores.get(week) ?? new Map<string, number>();
    const stats = args.sleeperStats.get(week) ?? new Map<string, Record<string, number>>();
    for (const p of args.players) {
      const c = args.compiled.get(p.mflPos);
      if (!c) {
        skipped.noCompiledScoring++;
        continue;
      }
      const x = args.xwalk.sleeperOf.get(p.mflId);
      if (!x) {
        skipped.noCrosswalk++;
        continue;
      }
      const ours = Math.round(scoreStats(c, stats.get(x.sleeperId) ?? {}) * 1000) / 1000;
      const theirs = mfl.get(p.mflId) ?? 0;
      if (Math.abs(ours) < 1e-9 && Math.abs(theirs) < 1e-9) {
        skipped.bothZero++; // didn't play (bye, IR, inactive): trivially equal, so left out of the rate
        continue;
      }
      rows.push({ week, mflId: p.mflId, mflPos: p.mflPos, mfl: theirs, ours, diff: Math.round((ours - theirs) * 1000) / 1000 });
    }
  }
  const byPos: OracleResult["byPos"] = {};
  let within = 0;
  for (const r of rows) {
    const ok = Math.abs(r.diff) <= tol + 1e-9;
    if (ok) within++;
    const b = (byPos[r.mflPos] ??= { compared: 0, within: 0 });
    b.compared++;
    if (ok) b.within++;
  }
  const worst = [...rows].filter((r) => Math.abs(r.diff) > tol).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { result: { compared: rows.length, within, rate: rows.length ? within / rows.length : 0, byPos, skipped, worst: worst.slice(0, 12) }, rows };
}

export interface ProjectionPair {
  mflId: string;
  mflPos: string;
  /** MFL projectedScores (league-scored per api_info). */
  mfl: number;
  /** Sleeper projected stats × this league's compiled rules. */
  ours: number;
  /** Sleeper's own pts_half_ppr, when present (a scoring-independent reference). */
  halfPpr?: number;
}

export interface AgreementGroup {
  n: number;
  medianRatio: number;
  /** Players whose MFL/ours ratio is outside 1 ± tolerance (CLAUDE.md §6 "disagree by more than 40%"). */
  disagree: number;
  /** Median MFL / Sleeper pts_half_ppr (shows position-specific scoring such as a TE premium). */
  medianHalfPpr?: number;
  nHalfPpr: number;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/**
 * CLAUDE.md §6: MFL leagues average MFL's projectedScores with Sleeper × league scoring and log players
 * whose sources disagree by more than 40%. Pairs where either side is ≤ minPoints are left out (tiny
 * projections make ratios meaningless).
 */
export function projectionAgreement(pairs: ProjectionPair[], minPoints = 3, tolerance = 0.4): { byPos: Record<string, AgreementGroup>; overall: AgreementGroup } {
  const kept = pairs.filter((p) => p.mfl > minPoints && p.ours > minPoints);
  const group = (rows: ProjectionPair[]): AgreementGroup => {
    const ratios = rows.map((r) => r.mfl / r.ours);
    const half = rows.filter((r) => (r.halfPpr ?? 0) > minPoints).map((r) => r.mfl / (r.halfPpr as number));
    return {
      n: rows.length,
      medianRatio: Math.round(median(ratios) * 1000) / 1000,
      disagree: ratios.filter((x) => Math.abs(x - 1) > tolerance).length,
      medianHalfPpr: half.length ? Math.round(median(half) * 1000) / 1000 : undefined,
      nHalfPpr: half.length,
    };
  };
  const byPos: Record<string, AgreementGroup> = {};
  for (const pos of [...new Set(kept.map((p) => p.mflPos))].sort()) byPos[pos] = group(kept.filter((p) => p.mflPos === pos));
  return { byPos, overall: group(kept) };
}
