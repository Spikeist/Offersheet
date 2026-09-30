/**
 * Shared helpers for the MFL and Fleaflicker scoring-oracle minimizers (mfl-oracle.ts,
 * fleaflicker-oracle.ts; CLAUDE.md §0.6, §5; planner reply to Checkpoint 0, answer 2).
 *
 * - Public data comes from the Phase 0 probes' cache, OFFLINE: Sleeper weekly stats, the Sleeper
 *   players DB and the DynastyProcess ID map. Nothing is fetched and no league is crawled.
 * - The population is every rostered player-week that crosswalks to a Sleeper id, whether or not he
 *   played (CLAUDE.md §5: every rostered player). A player who didn't play has no gp on Sleeper's
 *   line and must score 0: that is the evidence that per-game constants need games played (Phase 1
 *   review ENG-3; the populations used to leave these player-weeks out).
 * - The committed subset of player-weeks is chosen by rule-type coverage, position and whether the
 *   player played, in a fixed hash order — never by whether a case matches the platform's number.
 * - Stat lines keep only the keys the league's scoring reads, plus gp.
 * - Tolerance and target come from config.scoring (oracleTolerance, oracleTarget).
 */
import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import type { OracleFixtureCase, OraclePopulation } from "@/adapters/mfl/oracleFixture";
import { config } from "@/engine/config";
import type { Scoring, StatLine } from "@/engine/model";
import { POSITIONS } from "@/engine/model";
import { RULE_TYPES, describeMismatch, ruleTypesIn, runOracle, type OracleCase, type RuleType } from "@/engine/oracle";
import { ruleApplies, scoringStatKeys } from "@/engine/scoring";
import { TTL } from "../lib/cache";
import { request } from "../lib/http";

export const SEASON = 2026;
/** The last two completed weeks on 2026-09-29 (CLAUDE.md §5: the oracle uses the last 2 completed weeks). */
export const ORACLE_WEEKS = [2, 3] as const;

const SLEEPER_STATS_URL = (w: number) => `https://api.sleeper.app/stats/nfl/${SEASON}/${w}?season_type=regular`;
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const DP_IDMAP_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

/** Sleeper's actual stats for a week (public data), from the probes' cache. */
export async function sleeperWeekStats(week: number): Promise<Map<string, StatLine>> {
  const url = SLEEPER_STATS_URL(week);
  const res = await request(url, { cache: { key: `stats:${url}`, ttlMs: TTL.projections, namespace: "stats" }, offline: true, label: `Sleeper stats week ${week}` });
  const out = new Map<string, StatLine>();
  const rows = Array.isArray(res.json) ? (res.json as Array<{ player_id?: unknown; stats?: Record<string, unknown> }>) : [];
  for (const row of rows) {
    if (row.player_id === undefined || !row.stats) continue;
    const stats: StatLine = {};
    for (const [k, v] of Object.entries(row.stats)) if (typeof v === "number" && Number.isFinite(v)) stats[k] = v;
    out.set(String(row.player_id), stats);
  }
  return out;
}

export interface SleeperPlayerRow {
  player_id: string;
  position?: string | null;
  espn_id?: unknown;
  rotowire_id?: unknown;
  sportradar_id?: unknown;
  stats_id?: unknown;
}

/** The Sleeper players DB (public), from the probes' cache. */
export async function sleeperPlayers(): Promise<Record<string, SleeperPlayerRow>> {
  const res = await request(SLEEPER_PLAYERS_URL, { cache: { key: `sleeper:${SLEEPER_PLAYERS_URL}`, ttlMs: TTL.sleeperPlayers, namespace: "sleeper-players" }, offline: true, label: "Sleeper players DB" });
  return res.json as Record<string, SleeperPlayerRow>;
}

/** DynastyProcess ID map rows (public), from the probes' cache. */
export async function dynastyProcessRows(): Promise<Array<Record<string, string>>> {
  const res = await request(DP_IDMAP_URL, { cache: { key: `idmap:${DP_IDMAP_URL}`, ttlMs: TTL.idMap, namespace: "idmap" }, offline: true, label: "DynastyProcess db_playerids.csv" });
  return parseCsv(res.text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Array<Record<string, string>>;
}

export function asOracleCase(c: OracleFixtureCase, scoring: Scoring, source: string): OracleCase {
  return { source, week: c.week, playerId: c.sleeperId, pos: c.pos, stats: c.stats, scoring, expected: c.expected };
}

/** Sleeper leaves gp out of the line of a player who didn't play (it never sends gp = 0). */
function played(stats: StatLine): boolean {
  return (stats.gp ?? 0) > 0;
}

/** A per-game constant applies to the player's position although he didn't play: the engine must score it 0. */
function perGameWithoutGp(c: OracleFixtureCase, scoring: Scoring): boolean {
  return !played(c.stats) && scoring.rules.some((r) => r.kind === "perGame" && ruleApplies(r, c.pos));
}

/** "within <tolerance>" for console output (config.scoring.oracleTolerance). */
export const TOLERANCE_TEXT = `within ${config.scoring.oracleTolerance}`;

/** Run the oracle on every player-week of the full local copy (aggregate numbers only). */
export function measurePopulation(cases: OracleFixtureCase[], scoring: Scoring, skipped: Record<string, number>): { population: OraclePopulation; mismatches: string[]; exercised: Record<RuleType, number>; perGameWithoutGp: { cases: number; within: number } } {
  const byPos: OraclePopulation["byPos"] = {};
  let within = 0;
  const summary = runOracle(cases.map((c) => asOracleCase(c, scoring, "population")));
  const missed = new Set(summary.mismatches.map((m) => `${m.case.playerId}|${m.case.week}`));
  const noGp = { cases: 0, within: 0 };
  const idle = { cases: 0, within: 0 };
  for (const c of cases) {
    const b = (byPos[c.platformPos] ??= { cases: 0, within: 0 });
    const ok = !missed.has(`${c.sleeperId}|${c.week}`);
    b.cases++;
    if (ok) {
      b.within++;
      within++;
    }
    if (!played(c.stats)) {
      idle.cases++;
      if (ok) idle.within++;
    }
    if (perGameWithoutGp(c, scoring)) {
      noGp.cases++;
      if (ok) noGp.within++;
    }
  }
  const sorted = Object.fromEntries(Object.entries(byPos).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    population: { cases: cases.length, within, notPlayed: idle.cases, notPlayedWithin: idle.within, byPos: sorted, skipped },
    mismatches: summary.mismatches.map(describeMismatch),
    exercised: summary.ruleTypesExercised,
    perGameWithoutGp: noGp,
  };
}

/**
 * The committed subset: in a fixed hash order, up to `perType` player-weeks for every rule type the
 * oracle counts as tested (ruleTypesIn) and for per-game rules whose player didn't play, then each
 * position × week stratum of players who played is filled up to `fraction` of its size (rounded up),
 * and each stratum of players who didn't play up to `fractionNotPlayed` (their lines are empty, so a
 * few per stratum are enough). Selection never looks at the platform's number, so mismatches are kept
 * in proportion. About 30% keeps each roster a small subset while leaving enough cases (≥ 100 per
 * league) for a 99% target to tolerate a single provider difference.
 */
export function selectSubset(cases: OracleFixtureCase[], scoring: Scoring, opts: { perType: number; fraction: number; fractionNotPlayed: number; salt: string }): OracleFixtureCase[] {
  const hash = (c: OracleFixtureCase) => createHash("sha256").update(`${opts.salt}|${c.sleeperId}|${c.week}`).digest("hex");
  const order = [...cases].map((c) => ({ c, h: hash(c) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.c);
  // Only a player who played can exercise a rule: on the empty line of one who didn't, a rule that
  // includes 0 (completion % ≤ 50) seems to fire, but the platform scores him 0.
  const types = new Map(order.map((c) => [c, played(c.stats) ? ruleTypesIn(asOracleCase(c, scoring, "selection")) : new Set<RuleType>()]));
  const chosen = new Set<OracleFixtureCase>();
  const cover = (has: (c: OracleFixtureCase) => boolean) => {
    let n = 0;
    for (const c of order) {
      if (n >= opts.perType) break;
      if (has(c)) {
        chosen.add(c);
        n++;
      }
    }
  };
  for (const t of RULE_TYPES) cover((c) => types.get(c)?.has(t) === true);
  cover((c) => perGameWithoutGp(c, scoring));
  const weeks = [...new Set(cases.map((c) => c.week))].sort((a, b) => a - b);
  for (const w of weeks) {
    for (const p of POSITIONS) {
      for (const didPlay of [true, false]) {
        const inStratum = (c: OracleFixtureCase) => c.week === w && c.pos === p && played(c.stats) === didPlay;
        const target = Math.ceil((didPlay ? opts.fraction : opts.fractionNotPlayed) * cases.filter(inStratum).length);
        let n = [...chosen].filter(inStratum).length;
        for (const c of order) {
          if (n >= target) break;
          if (inStratum(c) && !chosen.has(c)) {
            chosen.add(c);
            n++;
          }
        }
      }
    }
  }
  const posIndex = (p: string) => POSITIONS.indexOf(p as (typeof POSITIONS)[number]);
  return [...chosen].sort((a, b) => a.week - b.week || posIndex(a.pos) - posIndex(b.pos) || (a.sleeperId < b.sleeperId ? -1 : a.sleeperId > b.sleeperId ? 1 : 0));
}

/** Keep only the stat keys the scoring reads (plus gp), in a stable order. */
export function minimizeStats(stats: StatLine, scoring: Scoring): StatLine {
  const keep = new Set([...scoringStatKeys(scoring), "gp"]);
  return Object.fromEntries(Object.entries(stats).filter(([k, v]) => keep.has(k) && v !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Round a platform's points the way it displays them (2 decimals; MFL sometimes 3). */
export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : "n/a";
}
