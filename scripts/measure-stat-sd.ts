/**
 * Where config.scoring.yardageSd and config.scoring.statSd.yds_allow come from (CLAUDE.md §5, §15;
 * planner reply to Checkpoint 1, answer 3): residuals of a week's ACTUAL stats minus Sleeper's
 * PROJECTION for them, on every completed week so far (weeks 1 … Sleeper /state/nfl week − 1).
 * Only public, league-independent Sleeper data is read (/state/nfl, /projections, /stats; never a
 * league endpoint), through the probe fetchers in scripts/lib/shared/fetch.ts: paced per host and
 * cached for 6 hours (CLAUDE.md §2.10).
 *
 *   npm run measure:stat-sd              every completed week
 *   npm run measure:stat-sd -- 2 3       chosen weeks
 *
 * Sample: players with a real projection (hasProjection: not an ADP-only stub) AND an actual line
 * with gp > 0 (a game not played is availability, §6 step 3, not stat noise). Projection rows go
 * through normalizeProjectionStats, so the keys are the ones the engine scores. A player's yardage
 * stat counts when its projection is above 0; missing actual keys are 0 (/stats is sparse).
 *
 * Fit, per yardage stat and pooled across positions (per-position fits are printed for
 * transparency): SD = a + b × projected mean by weighted least squares over equal-count bins of the
 * projected mean. Each bin gives its mean projection and the SD of its residuals about the bin's own
 * mean residual (bias is printed, not folded into the SD); bins are weighted by their size, which
 * for equal-count bins is ordinary least squares on the bin SDs. (Inverse-variance weights,
 * (n − 1) / s², were tried and rejected: low projections are zero-inflated — a returner projected 2
 * kick-return yards who returns nothing has a residual SD near 0 — so those bins took almost all the
 * weight and bent the line: kr_yd came out 0 + 0.36 × mean.) a and b are kept ≥ 0 (refit with the
 * other one alone if either goes negative). Cross-checks printed alongside: an OLS line through
 * |residual − bias| × √(π/2) per player-game (the normal-equivalent scale, less sensitive to
 * outliers), the RMS of residuals standardized by the fitted SD (≈ 1 when the model fits), and a
 * calibration table: games at or above rule-like yardage lines, actual vs expected under the fit
 * (the engine's floored normal, src/engine/distributions.ts) and under the old flat SD = 0.5 × mean.
 * Team defenses: the flat residual SD of pts_allow and yds_allow.
 *
 * Count stats (TDs, receptions, interceptions, …) are Poisson in the engine, with no parameter to
 * fit; the script checks that choice on the same player-games: the dispersion index
 * Σ(actual − mean)² / Σ mean (1 for Poisson) and games at or above bonus-like lines, actual vs
 * expected under the engine's Poisson and under the old flat SD.
 *
 * Caveat (⚠️): Sleeper re-stamps past weeks' projections after the games (Phase 0; the stamps are
 * printed), so these residuals may understate the true forecast error; Phase 6 re-measures on
 * pre-kickoff snapshots. Output is aggregates only (counts, means, SDs, fitted coefficients).
 */
import { hasProjection } from "@/adapters/sleeper/normalize";
import { normalizeProjectionStats } from "@/adapters/sleeper/scoringMap";
import { config } from "@/engine/config";
import { normalCdf } from "@/engine/distributions";
import { expectedRulePoints } from "@/engine/scoring";
import { fetchSleeperProjections, fetchSleeperState, fetchSleeperStats } from "./lib/shared/fetch";
import { parseNflState } from "./lib/shared/weeks";

/** Player yardage stats measured; kr_yd / pr_yd are fitted only with enough games. */
export const YARDAGE_STATS = ["pass_yd", "rush_yd", "rec_yd", "kr_yd", "pr_yd"] as const;
const RETURN_STATS = new Set<string>(["kr_yd", "pr_yd"]);
const RETURN_MIN_N = 50;
const DEF_STATS = ["pts_allow", "yds_allow"] as const;
/** Positions requested from /projections (Sleeper matches fantasy_positions, so FB rows come too). */
const POSITIONS = ["QB", "RB", "WR", "TE", "DEF"];
const LAST_REGULAR_WEEK = 18;
/** Binning: at least this many player-games per bin, at most this many bins. */
const MIN_PER_BIN = 30;
const MAX_BINS = 12;
/** Means at which the old flat SD (0.5 × mean) and the fit are compared. */
const COMPARE_AT = [5, 20, 50, 80, 120, 250];
const OLD_CV = 0.5;
/** Yardage lines for the calibration table (the bonus lines leagues use, plus a lower one for more games). */
const CALIBRATION_LINES: Readonly<Record<string, readonly number[]>> = { pass_yd: [250, 300, 400], rush_yd: [50, 100, 200], rec_yd: [50, 100, 200], kr_yd: [50, 100], pr_yd: [20, 40] };
/** Count stats checked against the engine's Poisson, with bonus-like lines. */
const COUNT_LINES: Readonly<Record<string, readonly number[]>> = {
  pass_td: [2, 3, 4],
  pass_int: [1, 2],
  pass_cmp: [20, 25, 30],
  rush_att: [15, 20],
  rush_td: [1, 2],
  rec: [5, 8, 10],
  rec_td: [1, 2],
  fum_lost: [1],
};

interface Row {
  player_id?: string | number;
  stats?: Record<string, unknown> | null;
  player?: { position?: string | null } | null;
  last_modified?: number | null;
}

export interface Observation {
  week: number;
  /** Sleeper's position for the player (FB stays FB). */
  pos: string;
  stat: string;
  /** Projected mean. */
  mean: number;
  /** Actual − projected. */
  resid: number;
}

export interface SdBin {
  n: number;
  mean: number;
  bias: number;
  sd: number;
}

export interface SdFit {
  a: number;
  b: number;
  n: number;
  bias: number;
  sd: number;
  bins: SdBin[];
  /** Set when a or b came out negative and was pinned at 0. */
  pinned?: "a" | "b";
  /** OLS line through |resid − bias| × √(π/2): a cross-check. */
  mad: { a: number; b: number };
  /** RMS of (resid − bias) / fitted SD: ≈ 1 when the model fits. */
  zRms: number;
}

const isTeamCode = (id: string) => /^[A-Z]{2,3}$/.test(id);

export function summarize(values: readonly number[]): { n: number; bias: number; sd: number } {
  const n = values.length;
  if (!n) return { n, bias: Number.NaN, sd: Number.NaN };
  const bias = values.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - bias) ** 2, 0) / (n - 1)) : Number.NaN;
  return { n, bias, sd };
}

/** Equal-count bins of the observations sorted by projected mean. */
export function equalCountBins(obs: readonly Observation[], binCount: number): SdBin[] {
  const sorted = [...obs].sort((x, y) => x.mean - y.mean);
  const out: SdBin[] = [];
  for (let j = 0; j < binCount; j++) {
    const slice = sorted.slice(Math.floor((j * sorted.length) / binCount), Math.floor(((j + 1) * sorted.length) / binCount));
    if (slice.length < 2) continue;
    const s = summarize(slice.map((o) => o.resid));
    out.push({ n: s.n, mean: slice.reduce((t, o) => t + o.mean, 0) / slice.length, bias: s.bias, sd: s.sd });
  }
  return out;
}

/** Weighted least-squares line y = a + b·x; with `pin`, the other coefficient alone. */
export function weightedLine(points: readonly { x: number; y: number; w: number }[], pin?: "a" | "b"): { a: number; b: number } {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const { x, y, w } of points) {
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  if (pin === "a") return { a: 0, b: sxx > 0 ? sxy / sxx : 0 };
  if (pin === "b") return { a: sw > 0 ? sy / sw : 0, b: 0 };
  const det = sw * sxx - sx * sx;
  if (!(Math.abs(det) > 1e-12)) return { a: sw > 0 ? sy / sw : 0, b: 0 };
  const b = (sw * sxy - sx * sy) / det;
  return { a: (sy - b * sx) / sw, b };
}

/** SD = a + b × mean over the observations (see the file header), or null with too few of them. */
export function fitSdModel(obs: readonly Observation[], minPerBin = MIN_PER_BIN, maxBins = MAX_BINS): SdFit | null {
  const binCount = Math.min(maxBins, Math.floor(obs.length / minPerBin));
  if (binCount < 3) return null;
  const bins = equalCountBins(obs, binCount);
  const points = bins.map((bin) => ({ x: bin.mean, y: bin.sd, w: bin.n }));
  let line = weightedLine(points);
  let pinned: SdFit["pinned"];
  if (line.a < 0) {
    pinned = "a";
    line = weightedLine(points, "a");
  } else if (line.b < 0) {
    pinned = "b";
    line = weightedLine(points, "b");
  }
  const all = summarize(obs.map((o) => o.resid));
  const mad = weightedLine(obs.map((o) => ({ x: o.mean, y: Math.abs(o.resid - all.bias) * Math.sqrt(Math.PI / 2), w: 1 })));
  const zRms = Math.sqrt(obs.reduce((s, o) => s + ((o.resid - all.bias) / Math.max(1e-9, line.a + line.b * o.mean)) ** 2, 0) / obs.length);
  return { ...line, n: all.n, bias: all.bias, sd: all.sd, bins, ...(pinned ? { pinned } : {}), mad, zRms };
}

// ---------------------------------------------------------------------------------------------
// Data

function rowsOf(json: unknown): Row[] | null {
  return Array.isArray(json) ? (json as Row[]) : null;
}

async function completedWeeks(): Promise<{ season: number; weeks: number[]; note: string }> {
  const res = await fetchSleeperState();
  const state = res.ok && !res.isHtml ? parseNflState(res.json) : null;
  if (!state) throw new Error(`Sleeper /state/nfl: HTTP ${res.status}, no season/week in the body`);
  const cli = process.argv
    .slice(2)
    .map(Number)
    .filter((w) => Number.isInteger(w) && w > 0);
  const note = `Sleeper /state/nfl: season ${state.season}, week ${state.week} (${state.seasonType})`;
  if (cli.length) return { season: state.season, weeks: cli, note };
  const last = state.seasonType === "regular" ? state.week - 1 : state.seasonType === "post" || state.seasonType === "off" ? LAST_REGULAR_WEEK : 0;
  return { season: state.season, weeks: Array.from({ length: Math.max(0, Math.min(LAST_REGULAR_WEEK, last)) }, (_, i) => i + 1), note };
}

export interface WeekData {
  players: Observation[];
  /** Count stats (COUNT_LINES keys) projected above 0. */
  counts: Observation[];
  def: Record<(typeof DEF_STATS)[number], number[]>;
  /** One RB game's rushing and receiving residuals, when both were projected. */
  rbPairs: [number, number][];
  projected: number;
  played: number;
  notPlayed: number;
  stamps: number[];
}

/** One week's residuals (or why the week was skipped). */
export async function measureWeek(season: number, week: number): Promise<WeekData | string> {
  const projRes = await fetchSleeperProjections(season, week, POSITIONS, true);
  const statsRes = await fetchSleeperStats(season, week);
  const projRows = projRes.ok ? rowsOf(projRes.json) : null;
  const statRows = statsRes.ok ? rowsOf(statsRes.json) : null;
  if (!projRows) return `projections HTTP ${projRes.status}${projRes.isHtml ? " (HTML)" : ""}`;
  if (!statRows) return `stats HTTP ${statsRes.status}${statsRes.isHtml ? " (HTML)" : ""}`;
  const actual = new Map<string, Record<string, unknown>>();
  for (const r of statRows) if (r.player_id !== undefined && !actual.has(String(r.player_id))) actual.set(String(r.player_id), r.stats ?? {});
  const out: WeekData = { players: [], counts: [], def: { pts_allow: [], yds_allow: [] }, rbPairs: [], projected: 0, played: 0, notPlayed: 0, stamps: [] };
  const seen = new Set<string>();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  for (const row of projRows) {
    const id = row.player_id === undefined ? "" : String(row.player_id);
    if (!id || seen.has(id) || !hasProjection(row.stats)) continue;
    seen.add(id);
    out.projected++;
    const a = actual.get(id);
    if (!a || !(num(a.gp) > 0)) {
      out.notPlayed++;
      continue;
    }
    out.played++;
    if (typeof row.last_modified === "number") out.stamps.push(row.last_modified);
    const pos = row.player?.position ?? (isTeamCode(id) ? "DEF" : "?");
    const line = normalizeProjectionStats(row.stats, pos);
    if (pos === "DEF") {
      for (const s of DEF_STATS) if (line[s] !== undefined) out.def[s].push(num(a[s]) - (line[s] as number));
      continue;
    }
    const resid: Partial<Record<string, number>> = {};
    for (const s of YARDAGE_STATS) {
      const mean = line[s];
      if (mean === undefined || !(mean > 0)) continue;
      resid[s] = num(a[s]) - mean;
      out.players.push({ week, pos, stat: s, mean, resid: resid[s] });
    }
    if (pos === "RB" && resid.rush_yd !== undefined && resid.rec_yd !== undefined) out.rbPairs.push([resid.rush_yd, resid.rec_yd]);
    for (const s of Object.keys(COUNT_LINES)) {
      const mean = line[s];
      if (mean !== undefined && mean > 0) out.counts.push({ week, pos, stat: s, mean, resid: num(a[s]) - mean });
    }
  }
  return out;
}

/** A count stat against the engine's Poisson: dispersion index and games at or above each line. */
export function countCheck(obs: readonly Observation[], stat: string, lines: readonly number[]): { n: number; dispersion: number; lines: { line: number; actual: number; poisson: number; old: number }[] } {
  const meanSum = obs.reduce((s, o) => s + o.mean, 0);
  const dispersion = obs.reduce((s, o) => s + o.resid ** 2, 0) / meanSum;
  return {
    n: obs.length,
    dispersion,
    lines: lines.map((line) => {
      const rule = { kind: "threshold", stat, min: line, points: 1 } as const;
      let actual = 0;
      let poisson = 0;
      let old = 0;
      for (const o of obs) {
        if (o.mean + o.resid >= line) actual++;
        poisson += expectedRulePoints(rule, { [stat]: o.mean });
        old += 1 - normalCdf((line - 0.5 - o.mean) / (OLD_CV * o.mean));
      }
      return { line, actual, poisson, old };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Report

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "n/a");
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
const iso = (ms: number) => new Date(ms).toISOString().replace(/:\d\d\.\d{3}Z$/, "Z");

function pearson(pairs: readonly [number, number][]): number {
  const n = pairs.length;
  if (n < 3) return Number.NaN;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Games at or above a yardage line: actual, expected under the fitted model (the engine's own
 * threshold-rule expected value, floored normal included) and under the old flat SD = 0.5 × mean.
 */
export function calibration(obs: readonly Observation[], stat: string, fit: { a: number; b: number }, line: number): { actual: number; fitted: number; old: number } {
  const cfg = { ...config.scoring, yardageSd: { ...config.scoring.yardageSd, [stat]: { a: fit.a, b: fit.b } } };
  const rule = { kind: "threshold", stat, min: line, points: 1 } as const;
  let actual = 0;
  let fitted = 0;
  let old = 0;
  for (const o of obs) {
    if (o.mean + o.resid >= line) actual++;
    fitted += expectedRulePoints(rule, { [stat]: o.mean }, cfg);
    old += 1 - normalCdf((line - 0.5 - o.mean) / (OLD_CV * o.mean));
  }
  return { actual, fitted, old };
}

function printFit(label: string, fit: SdFit): void {
  console.log(`  ${label}: SD = ${f1(fit.a)} + ${f3(fit.b)} × mean  (n ${fit.n}, bias ${f1(fit.bias)}, pooled SD ${f1(fit.sd)}, standardized RMS ${fit.zRms.toFixed(2)}${fit.pinned ? `, ${fit.pinned} pinned at 0` : ""}; |resid| cross-check ${f1(fit.mad.a)} + ${f3(fit.mad.b)} × mean)`);
}

async function main(): Promise<void> {
  const { season, weeks, note } = await completedWeeks();
  console.log(note);
  if (!weeks.length) {
    console.log("No completed regular-season week yet; nothing to measure.");
    return;
  }
  console.log(`Measuring weeks ${weeks.join(", ")} of ${season} (positions ${POSITIONS.join("/")}; players with a real projection and gp > 0)\n`);
  const obsByStat = new Map<string, Observation[]>();
  const countsByStat = new Map<string, Observation[]>();
  const def: Record<(typeof DEF_STATS)[number], number[]> = { pts_allow: [], yds_allow: [] };
  const perWeekDef: string[] = [];
  const used: number[] = [];
  const rbPairs: [number, number][] = [];
  for (const week of weeks) {
    const data = await measureWeek(season, week);
    if (typeof data === "string") {
      console.log(`week ${week}: skipped (${data})`);
      continue;
    }
    used.push(week);
    const byStat = new Map<string, number[]>();
    for (const o of data.players) {
      push(obsByStat, o.stat, o);
      push(byStat, o.stat, o.resid);
    }
    for (const o of data.counts) push(countsByStat, o.stat, o);
    rbPairs.push(...data.rbPairs);
    for (const s of DEF_STATS) def[s].push(...data.def[s]);
    const stamps = data.stamps.length ? `${iso(Math.min(...data.stamps))} … ${iso(Math.max(...data.stamps))}` : "n/a";
    const counts = YARDAGE_STATS.map((s) => {
      const r = summarize(byStat.get(s) ?? []);
      return `${s} n ${r.n} bias ${f1(r.bias)}`;
    }).join(" · ");
    console.log(`week ${week}: ${data.projected} projected, ${data.played} played (${data.notPlayed} projected but no game); projections last_modified ${stamps}`);
    console.log(`  ${counts}`);
    perWeekDef.push(`week ${week}: ${DEF_STATS.map((s) => `${s} ${(({ n, bias, sd }) => `n ${n}, bias ${f1(bias)}, SD ${f1(sd)}`)(summarize(data.def[s]))}`).join(" · ")}`);
  }
  if (!used.length) {
    console.log("\nNo week could be read; nothing measured.");
    return;
  }

  console.log(`\nYardage SD models (weighted least squares over equal-count bins of the projected mean, ≥ ${MIN_PER_BIN} per bin, ≤ ${MAX_BINS} bins)`);
  const fits = new Map<string, SdFit>();
  for (const s of YARDAGE_STATS) {
    const obs = obsByStat.get(s) ?? [];
    if (RETURN_STATS.has(s) && obs.length < RETURN_MIN_N) {
      console.log(`\n${s}: n ${obs.length} < ${RETURN_MIN_N}; not fitted (the default model applies)`);
      continue;
    }
    const fit = fitSdModel(obs);
    console.log(`\n${s}:`);
    if (!fit) {
      const r = summarize(obs.map((o) => o.resid));
      console.log(`  n ${r.n}: too few to fit (bias ${f1(r.bias)}, SD ${f1(r.sd)})`);
      continue;
    }
    fits.set(s, fit);
    printFit("pooled", fit);
    console.log(`  bins (mean projection → n, bias, residual SD, fitted SD): ${fit.bins.map((b) => `${f1(b.mean)} → ${b.n}, ${f1(b.bias)}, ${f1(b.sd)}, ${f1(fit.a + fit.b * b.mean)}`).join(" | ")}`);
    const positions = [...new Set(obs.map((o) => o.pos))].sort();
    for (const pos of positions) {
      const sub = obs.filter((o) => o.pos === pos);
      const pf = fitSdModel(sub);
      if (pf) printFit(pos, pf);
      else {
        const r = summarize(sub.map((o) => o.resid));
        console.log(`  ${pos}: n ${r.n} (too few to fit; bias ${f1(r.bias)}, SD ${f1(r.sd)})`);
      }
    }
    console.log(`  SD at projected mean (old 0.5 × mean → fit): ${COMPARE_AT.map((m) => `${m}: ${f1(OLD_CV * m)} → ${f1(fit.a + fit.b * m)}`).join(" · ")}`);
    const lines = (CALIBRATION_LINES[s] ?? []).map((line) => {
      const c = calibration(obs, s, fit, line);
      return `${line}+: actual ${c.actual}, fit expects ${f1(c.fitted)}, old expects ${f1(c.old)}`;
    });
    console.log(`  games at or above a line: ${lines.join(" · ")}`);
  }
  console.log(`\nRB rush vs receiving residual correlation (the rush + rec composite assumes independence): r = ${f3(pearson(rbPairs))} over ${rbPairs.length} RB games`);

  console.log("\nCount stats vs the engine's Poisson (dispersion index Σ(actual − mean)² / Σ mean: 1 = Poisson; games at or above a line: actual, Poisson expects, old flat SD expects):");
  for (const [s, lines] of Object.entries(COUNT_LINES)) {
    const c = countCheck(countsByStat.get(s) ?? [], s, lines);
    if (!c.n) continue;
    console.log(`  ${s}: n ${c.n}, dispersion ${c.dispersion.toFixed(2)} · ${c.lines.map((l) => `${l.line}+: ${l.actual} / ${f1(l.poisson)} / ${f1(l.old)}`).join(" · ")}`);
  }

  console.log("\nTeam defenses (flat residual SD):");
  for (const line of perWeekDef) console.log(`  ${line}`);
  const pts = summarize(def.pts_allow);
  const yds = summarize(def.yds_allow);
  console.log(`  pooled: pts_allow n ${pts.n}, bias ${f1(pts.bias)}, SD ${f1(pts.sd)} · yds_allow n ${yds.n}, bias ${f1(yds.bias)}, SD ${f1(yds.sd)}`);

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nPaste into config.scoring (src/engine/config.ts), measured ${today} on ${season} weeks ${used.join(", ")}:`);
  console.log("    yardageSd: {");
  console.log("      default: { a: 0, b: 0.5 },");
  for (const [s, fit] of fits) console.log(`      ${s}: { a: ${fit.a.toFixed(1)}, b: ${fit.b.toFixed(3)} }, // n ${fit.n}`);
  console.log("    } as Readonly<Record<string, { a: number; b: number }>>,");
  console.log(`    statSd.yds_allow: ${Math.round(yds.sd)} (n ${yds.n}); pts_allow measured ${f1(pts.sd)} (n ${pts.n}) — config keeps the planner's 9`);
}

const isMain = process.argv[1] && /measure-stat-sd\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
