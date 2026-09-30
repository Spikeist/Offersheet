/**
 * Inputs from other Phase 0 probes, read-only:
 * - reports/probe-output/<name>.json checks (probe:sleeper-codes CODES.*, probe:shared PROJ-S.*),
 *   cited as evidence for code meanings;
 * - the sleeper-codes crawl sample in data-local/sleeper-codes/leagues-2026.json (git-ignored), used
 *   to pick a few public leagues for the cross-league scoring oracle. Only aggregates leave this
 *   module's callers; league identities never reach reports or fixtures.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../env";
import { saltedOrder } from "./salt";
import type { CrawlCheck } from "./settings";

export interface ProbeChecks {
  generatedAt: string;
  checks: Map<string, CrawlCheck>;
  questions: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks of another probe's output (reports/probe-output/<name>.json), or null when it hasn't run. */
export function readProbeChecks(name: string, dir = path.join(ROOT, "reports", "probe-output")): ProbeChecks | null {
  const file = path.join(dir, `${name}.json`);
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { generatedAt?: unknown; checks?: unknown; questions?: unknown };
    const checks = new Map<string, CrawlCheck>();
    for (const c of Array.isArray(j.checks) ? j.checks : []) {
      if (isRecord(c) && typeof c.key === "string" && typeof c.status === "string") checks.set(c.key, { status: c.status, summary: typeof c.summary === "string" ? c.summary : "" });
    }
    const questions = Array.isArray(j.questions) ? j.questions.filter((q): q is string => typeof q === "string") : [];
    return { generatedAt: typeof j.generatedAt === "string" ? j.generatedAt : "", checks, questions };
  } catch {
    return null;
  }
}

/** First sentence-ish clause of a check summary, for citing it in one line. */
export function firstClause(summary: string, max = 160): string {
  const idx = summary.search(/[.;:]\s|\s—\s/);
  const cut = idx < 0 ? summary : summary.slice(0, summary[idx] === " " ? idx : idx + 1);
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

/**
 * The informative part of a crawl summary: its first clause after a leading "Verified:",
 * "Inferred:" or "Partly verified (…):" label.
 */
export function crawlGist(summary: string, max = 110): string {
  const rest = summary.replace(/^(Verified|Inferred|Partly verified)\b[^:]*:\s*/, "");
  return firstClause(rest || summary, max).replace(/[;:,]$/, "");
}

/** Scoring keys with a non-zero value across the crawl sample (probe:sleeper-codes meta.scoringKeysNonzero). */
export function readCrawlScoringKeys(dir = path.join(ROOT, "reports", "probe-output")): { leagues: number; keys: Array<{ key: string; leagues: number }> } | null {
  const file = path.join(dir, "sleeper-codes.json");
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { meta?: { scoringKeysNonzero?: unknown; sample?: { leagues2026?: unknown } } };
    const raw = j.meta?.scoringKeysNonzero;
    if (!isRecord(raw)) return null;
    const keys = Object.entries(raw)
      .filter((e): e is [string, number] => typeof e[1] === "number")
      .map(([key, leagues]) => ({ key, leagues }))
      .sort((a, b) => b.leagues - a.leagues || a.key.localeCompare(b.key));
    return { leagues: Number(j.meta?.sample?.leagues2026 ?? 0), keys };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Crawl sample → leagues for the cross-league oracle

export interface CrawlLeague {
  leagueId: string;
  status: string;
  season: string;
  totalRosters: number;
  settings: Record<string, unknown>;
  rosterPositions: string[];
  scoringNonzero: string[];
}

export const CRAWL_LEAGUES_FILE = path.join(ROOT, "data-local", "sleeper-codes", "leagues-2026.json");

/** The crawl's 2026 league summaries (IDs stay in memory only), or null when the crawl hasn't run. */
export function readCrawlLeagues(file = CRAWL_LEAGUES_FILE): CrawlLeague[] | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) return null;
    return raw.filter(isRecord).flatMap((l) =>
      typeof l.leagueId === "string" && isRecord(l.settings)
        ? [
            {
              leagueId: l.leagueId,
              status: String(l.status ?? ""),
              season: String(l.season ?? ""),
              totalRosters: Number(l.totalRosters ?? 0),
              settings: l.settings,
              rosterPositions: Array.isArray(l.rosterPositions) ? l.rosterPositions.filter((x): x is string => typeof x === "string") : [],
              scoringNonzero: Array.isArray(l.scoringNonzero) ? l.scoringNonzero.filter((x): x is string => typeof x === "string") : [],
            },
          ]
        : [],
    );
  } catch {
    return null;
  }
}

export interface OracleTarget {
  name: string;
  /** Scoring keys that belong to the feature (for counting exercised player-weeks). */
  test: (key: string) => boolean;
  /** Whether a crawled league can exercise the feature: it scores it and can start the players. */
  covers: (l: CrawlLeague) => boolean;
}

const YARDAGE_BONUS = /^bonus_(pass|rush|rec|rush_rec)_yd_\d+/;
const FIRST_DOWNS = /^bonus_fd_|_fd$/;
const YDS_ALLOW = /^yds_allow_\d/;
const scores = (l: CrawlLeague, test: (k: string) => boolean) => l.scoringNonzero.some(test);
const starts = (l: CrawlLeague, ...slots: string[]) => slots.some((s) => l.rosterPositions.includes(s));

/** Scoring features the single fixture league doesn't exercise; the oracle leagues are picked to cover them. */
export const ORACLE_TARGETS: readonly OracleTarget[] = [
  { name: "rec (PPR)", test: (k) => k === "rec", covers: (l) => scores(l, (k) => k === "rec") },
  { name: "bonus_rec_te (TE premium)", test: (k) => k === "bonus_rec_te", covers: (l) => scores(l, (k) => k === "bonus_rec_te") },
  { name: "yardage bonuses (bonus_*_yd_*)", test: (k) => YARDAGE_BONUS.test(k), covers: (l) => scores(l, (k) => YARDAGE_BONUS.test(k)) },
  { name: "IDP (idp_*)", test: (k) => k.startsWith("idp_"), covers: (l) => scores(l, (k) => k.startsWith("idp_")) && starts(l, "DL", "LB", "DB", "IDP_FLEX") },
  { name: "first downs (*_fd, bonus_fd_*)", test: (k) => FIRST_DOWNS.test(k), covers: (l) => scores(l, (k) => FIRST_DOWNS.test(k)) },
  { name: "long field goals (fgm_50_59, fgm_60p)", test: (k) => k === "fgm_50_59" || k === "fgm_60p", covers: (l) => scores(l, (k) => k === "fgm_50_59") && starts(l, "K") },
  // A league scoring only an extreme bracket (e.g. yds_allow_0_100) would rarely be exercised.
  { name: "yards-allowed brackets (yds_allow_*)", test: (k) => YDS_ALLOW.test(k), covers: (l) => l.scoringNonzero.filter((k) => YDS_ALLOW.test(k)).length >= 3 && starts(l, "DEF") },
];

/** In season, both oracle weeks scored, not a guillotine league. */
export function eligibleForOracle(l: CrawlLeague, weeks: readonly number[]): boolean {
  if (!weeks.length) return false;
  const s = l.settings;
  return l.status === "in_season" && Number(s.last_scored_leg ?? 0) >= Math.max(...weeks) && Number(s.start_week ?? 1) <= Math.min(...weeks) && Number(s.type ?? 0) !== 3;
}

export function targetsCovered(l: CrawlLeague): string[] {
  return ORACLE_TARGETS.filter((t) => t.covers(l)).map((t) => t.name);
}

/**
 * One more league for features still not exercised: the untried eligible league covering the most
 * of `wanted` (ties in salted order), or null.
 */
export function pickOneMore(leagues: readonly CrawlLeague[], weeks: readonly number[], salt: string, tried: ReadonlySet<string>, wanted: ReadonlySet<string>): CrawlLeague | null {
  let best: CrawlLeague | null = null;
  let bestGain = 0;
  for (const l of saltedOrder(leagues.filter((x) => !tried.has(x.leagueId) && eligibleForOracle(x, weeks)), (x) => x.leagueId, salt, "cross-oracle-more")) {
    const gain = targetsCovered(l).filter((n) => wanted.has(n)).length;
    if (gain > bestGain) {
      best = l;
      bestGain = gain;
    }
  }
  return best;
}

/** The clause of a crawl summary about one value, e.g. "0 → 1-week rounds (29/29 seasons from 29 leagues)", for citing. */
export function crawlValueClause(summary: string, value: number | string, max = 140): string | null {
  const v = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Up to the next ";" or the next ", <value> →/=" of a comma-separated list.
  const m = new RegExp(`(?:^|[\\s;:,(])${v} (?:→|=) ((?:(?!,\\s*\\d+ (?:→|=))[^;])+)`).exec(summary);
  if (!m?.[1]) return null;
  const clause = `${value} → ${m[1].trim()}`;
  return clause.length > max ? `${clause.slice(0, max - 1)}…` : clause;
}

/**
 * Greedy set cover over ORACLE_TARGETS (ties broken by a salted order, so the choice can't be
 * re-derived from the code), topped up to `min` leagues.
 */
export function pickOracleLeagues(leagues: readonly CrawlLeague[], weeks: readonly number[], salt: string, max = 5, min = 3): CrawlLeague[] {
  const pool = saltedOrder(
    leagues.filter((l) => eligibleForOracle(l, weeks)),
    (l) => l.leagueId,
    salt,
    "cross-oracle",
  );
  const uncovered = new Set(ORACLE_TARGETS.map((t) => t.name));
  const out: CrawlLeague[] = [];
  while (out.length < max && uncovered.size) {
    let best: CrawlLeague | null = null;
    let bestGain = 0;
    for (const l of pool) {
      if (out.includes(l)) continue;
      const gain = targetsCovered(l).filter((n) => uncovered.has(n)).length;
      if (gain > bestGain) {
        best = l;
        bestGain = gain;
      }
    }
    if (!best) break;
    out.push(best);
    for (const n of targetsCovered(best)) uncovered.delete(n);
  }
  for (const l of pool) {
    if (out.length >= Math.min(min, max)) break;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}
