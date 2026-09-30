/**
 * Explaining scoring-oracle mismatches (CLAUDE.md §5). For every unmapped or partial rule, estimate
 * what it added to a player-week from Sleeper's stats: exactly when the stats pin it down (a single
 * TD's length is *_td_lng; one or two made FGs have lengths fgm_lng and fgm_yds − fgm_lng; a longest
 * completion under 20 yards means no 20+ completions), otherwise as a range. Each mismatch is then
 *   explained    — exact contributions close the gap (within the tolerance),
 *   consistent   — the gap left fits the range of rules Sleeper's stats can't resolve,
 *   unexplained  — neither (a definition gap or a mapping error).
 * Pure functions: no I/O.
 */
import type { Pos } from "./positions";
import type { OracleRow } from "./scoring";
import { FG_BUCKETS, type RuleMapping } from "./scoring-map";

export interface Cause {
  categoryId: number;
  rule: string;
  /** Points the rule added (exact), or null when Sleeper's stats can't tell. */
  points: number | null;
  /** Range of possible points when not exact (max may be Infinity). */
  min: number;
  max: number;
  /** Points per event, when the rule scores per event (for the "multiple of" test). */
  unit?: number;
  basis: string;
}

type Stats = Readonly<Record<string, number>>;
type Count = { count: number; basis: string } | { count: null; lo: number; hi: number; basis: string } | null;

const TD_FAMILY: Record<number, "pass_td" | "rush_td" | "rec_td"> = { 6: "pass_td", 25: "rush_td", 45: "rec_td" };
const s = (stats: Stats, k: string) => stats[k] ?? 0;

/** TDs of one family (pass/rush/rec) whose length is in [lo, hi]. null = no TD at all. */
export function tdBandCount(stats: Stats, family: string, lo: number | undefined, hi: number | undefined): Count {
  const n = s(stats, family);
  if (!n) return null;
  const from = lo ?? 0;
  const to = hi ?? Infinity;
  const lng = stats[`${family}_lng`];
  const n40 = s(stats, `${family}_40p`);
  const inBand = (x: number) => x >= from && x <= to;
  if (n === 1 && lng !== undefined) return { count: inBand(lng) ? 1 : 0, basis: `1 TD of ${lng} yds (${family}_lng)` };
  if (lng !== undefined && lng < from) return { count: 0, basis: `longest TD ${lng} yds` };
  if (from >= 40 && n40 === 0) return { count: 0, basis: `no TD of 40+ yds (${family}_40p absent)` };
  if (from >= 40 && n40 === 1 && lng !== undefined) return { count: inBand(lng) ? 1 : 0, basis: `one 40+ yd TD, the longest: ${lng} yds` };
  return { count: null, lo: 0, hi: from >= 40 ? n40 : n, basis: `${n} TDs (${n40} of 40+ yds, longest ${lng ?? "?"}): lengths unknown` };
}

/** Made (fgm) or missed (fgmiss) field goals with a length in [lo, hi]. null = no attempt of that kind. */
export function fgBandCount(stats: Stats, kind: "fgm" | "fgmiss", lo: number | undefined, hi: number | undefined): Count {
  const n = s(stats, kind);
  if (!n) return null;
  const from = lo ?? 0;
  const to = hi ?? Infinity;
  const inBand = (x: number) => x >= from && x <= to;
  if (kind === "fgm") {
    const lng = stats.fgm_lng;
    const yds = stats.fgm_yds;
    const lengths = n === 1 && lng !== undefined ? [lng] : n === 2 && lng !== undefined && yds !== undefined ? [lng, yds - lng] : null;
    if (lengths) return { count: lengths.filter(inBand).length, basis: `FG lengths ${lengths.join(", ")} (fgm_lng${n === 2 ? ", fgm_yds" : ""})` };
    if (lng !== undefined && lng < from) return { count: 0, basis: `longest FG ${lng} yds` };
  }
  const bucketCount = (b: { suffix: string }) => s(stats, `${kind}_${b.suffix}`);
  const overlap = FG_BUCKETS.filter((b) => b.hi >= from && b.lo <= to);
  const inOverlap = overlap.reduce((sum, b) => sum + bucketCount(b), 0);
  if (inOverlap === 0) return { count: 0, basis: `no ${kind} in the ${overlap.map((b) => b.suffix).join("/")} buckets` };
  const partial = overlap.filter((b) => bucketCount(b) > 0 && !(b.lo >= from && b.hi <= to));
  if (!partial.length) return { count: inOverlap, basis: "the range covers whole Sleeper buckets" };
  if (kind === "fgm") {
    const lng = stats.fgm_lng;
    const highest = [...FG_BUCKETS].reverse().find((b) => bucketCount(b) > 0);
    if (inOverlap === 1 && lng !== undefined && highest && overlap.includes(highest) && bucketCount(highest) === 1) return { count: inBand(lng) ? 1 : 0, basis: `the only FG in range is the longest: ${lng} yds` };
  }
  const sure = overlap.filter((b) => b.lo >= from && b.hi <= to).reduce((sum, b) => sum + bucketCount(b), 0);
  return { count: null, lo: sure, hi: inOverlap, basis: `${inOverlap} ${kind} in the ${overlap.map((b) => b.suffix).join("/")} buckets: lengths unknown` };
}

/** Completions of 20+ yards (Sleeper has only pass_cmp_40p and pass_lng). */
export function cmp20Count(stats: Stats): Count {
  const n = s(stats, "pass_cmp");
  if (!n) return null;
  const lng = stats.pass_lng;
  if (lng !== undefined && lng < 20) return { count: 0, basis: `longest completion ${lng} yds` };
  if (n === 1 && lng !== undefined) return { count: 1, basis: `1 completion of ${lng} yds` };
  const lo = Math.max(lng !== undefined && lng >= 20 ? 1 : 0, s(stats, "pass_cmp_40p"));
  return { count: null, lo, hi: n, basis: `${n} completions, longest ${lng ?? "?"}, ${s(stats, "pass_cmp_40p")} of 40+ yds` };
}

function unknownRange(count: number, points: number): { min: number; max: number } {
  return points >= 0 ? { min: 0, max: count * points } : { min: count * points, max: 0 };
}

/** What each unmapped/partial rule that applies to `pos` added to this stat line. */
export function ruleContributions(stats: Stats, pos: Pos, rules: readonly RuleMapping[]): Cause[] {
  const out: Cause[] = [];
  for (const m of rules) {
    if (m.status !== "unmapped" && m.status !== "partial") continue;
    if (!m.positions.includes(pos)) continue;
    const { lo, hi, rate, isBonus, multi } = m.shape;
    const perEvent = multi && isBonus ? m.points : rate;
    const push = (c: Count) => {
      if (!c) return;
      if (c.count !== null) {
        if (c.count) out.push({ categoryId: m.categoryId, rule: m.description, points: c.count * perEvent, min: c.count * perEvent, max: c.count * perEvent, unit: perEvent, basis: c.basis });
        return;
      }
      const lowP = c.lo * perEvent;
      const highP = c.hi * perEvent;
      out.push({ categoryId: m.categoryId, rule: m.description, points: null, min: Math.min(lowP, highP), max: Math.max(lowP, highP), unit: perEvent, basis: c.basis });
    };
    const family = TD_FAMILY[m.categoryId];
    if (family && multi) push(tdBandCount(stats, family, lo, hi));
    else if (m.categoryId === 102 && multi && isBonus) push(fgBandCount(stats, "fgm", lo, hi));
    else if (m.categoryId === 106 && multi && isBonus) push(fgBandCount(stats, "fgmiss", lo, hi));
    else if (m.categoryId === 166) push(cmp20Count(stats));
    else if (m.categoryId === 87) {
      // An offensive player's fumble recovery (his own or a teammate's) is not in Sleeper's player
      // stats at all, so any offensive player who played may have one (rare: at most 2 assumed).
      if (OFFENSE.has(pos) && s(stats, "gp") > 0) out.push({ categoryId: 87, rule: m.description, points: null, ...unknownRange(2, rate), unit: rate, basis: "an offensive player's fumble recovery is not in Sleeper's player stats" });
    } else {
      // Other rules Sleeper can't resolve: a candidate only when a triggering stat is non-zero.
      // Rules with no triggering stat at all are left out: they can't be attributed to a row.
      const keys = TRIGGERS[m.categoryId];
      if (!keys || !keys.some((k) => s(stats, k) > 0)) continue;
      const events = Math.max(...keys.map((k) => s(stats, k)));
      const bound = m.categoryId === 82 || m.categoryId === 81 ? Infinity : events;
      out.push({ categoryId: m.categoryId, rule: m.description, points: null, ...unknownRange(bound, perEvent || m.points), unit: perEvent || m.points, basis: `${keys.join("/")} > 0: Sleeper can't tell how much this rule added` });
    }
  }
  return out;
}

const OFFENSE = new Set<Pos>(["QB", "RB", "WR", "TE", "K"]);
/** Stats that show an unresolvable rule may have fired (return TDs, defensive TDs, special-teams snaps). */
const TRIGGERS: Record<number, string[]> = { 64: ["st_td"], 68: ["st_td"], 90: ["idp_def_td"], 119: ["fum_rec_td"], 82: ["st_snp"], 81: ["st_snp"] };

export type Verdict = "explained" | "consistent" | "unexplained";

export interface Explanation {
  row: OracleRow;
  causes: Cause[];
  /** Gap left after the exact contributions (recomputed + exact − platform). */
  residual: number;
  verdict: Verdict;
}

export function explainRow(row: OracleRow, rules: readonly RuleMapping[], tolerance = 0.05): Explanation {
  const causes = row.pos && row.sleeper ? ruleContributions(row.sleeper, row.pos, rules) : [];
  const exact = causes.reduce((n, c) => n + (c.points ?? 0), 0);
  const residual = Math.round(((row.diff ?? 0) + exact) * 100) / 100;
  if (Math.abs(residual) <= tolerance) return { row, causes, residual, verdict: "explained" };
  const unknown = causes.filter((c) => c.points === null);
  const need = -residual; // points the platform has that the recomputation still lacks
  const min = unknown.reduce((n, c) => n + c.min, 0);
  const max = unknown.reduce((n, c) => n + c.max, 0);
  let fits = unknown.length > 0 && need >= min - tolerance && need <= max + tolerance;
  const only = unknown.length === 1 ? unknown[0] : undefined;
  if (fits && only?.unit) {
    const k = need / only.unit;
    fits = Math.abs(k - Math.round(k)) * Math.abs(only.unit) <= tolerance;
  }
  return { row, causes, residual, verdict: fits ? "consistent" : "unexplained" };
}

export interface ExplainSummary {
  mismatches: number;
  verdicts: Record<Verdict, number>;
  /** Per unmapped/partial rule: mismatch rows where it added points exactly, the points, and rows where it may have. */
  byRule: Array<{ categoryId: number; rule: string; exactRows: number; exactPoints: number; unresolvedRows: number }>;
  explanations: Explanation[];
}

export function explainMismatches(mismatches: readonly OracleRow[], rules: readonly RuleMapping[], tolerance = 0.05): ExplainSummary {
  const explanations = mismatches.map((r) => explainRow(r, rules, tolerance));
  const verdicts: Record<Verdict, number> = { explained: 0, consistent: 0, unexplained: 0 };
  const byRule = new Map<string, { categoryId: number; rule: string; exactRows: number; exactPoints: number; unresolvedRows: number }>();
  for (const e of explanations) {
    verdicts[e.verdict]++;
    for (const c of e.causes) {
      const k = `${c.categoryId}|${c.rule}`;
      const b = byRule.get(k) ?? { categoryId: c.categoryId, rule: c.rule, exactRows: 0, exactPoints: 0, unresolvedRows: 0 };
      if (c.points === null) b.unresolvedRows++;
      else {
        b.exactRows++;
        b.exactPoints = Math.round((b.exactPoints + c.points) * 100) / 100;
      }
      byRule.set(k, b);
    }
  }
  return { mismatches: mismatches.length, verdicts, byRule: [...byRule.values()].sort((a, b) => b.exactRows + b.unresolvedRows - (a.exactRows + a.unresolvedRows)), explanations };
}
