/**
 * Test support (not app code): builds the ESPN scoring-oracle cases from committed fixtures, THROUGH
 * THE CANONICAL FORM (ESPN's raw stat line → toCanonicalStats → the league's canonical Scoring →
 * engine scoring, compared with ESPN's league-scored appliedTotal). Used by oracle.test.ts, the
 * cross-platform rule-type coverage test and scripts/oracle-report.ts.
 *
 *   parker-league    Parker's league, weeks 2–3, every rostered player
 *   public-league    the public test league, weeks 2–3 (top-250 pool; week 3 also its roster subset; minimized)
 *   cross-source     Parker's scoring × Sleeper's public stat lines vs ESPN's appliedTotal
 *   every-n          ESPN's own "every N yards/catches" counts vs the engine's stepped rule on the raw
 *                    stat (Parker's and the public league's weeks 2–3 lines): platform evidence for the
 *                    stepped floor, which no league's points exercise
 */
import type { Pos, Scoring } from "@/engine/model";
import { runOracle, type OracleCase, type OracleSummary } from "@/engine/oracle";
import { readMinFixture } from "@/test-utils/fixtures";
import { summarizeSlots } from "./normalize";
import { positionOf } from "./positions";
import { buildEspnScoring, ESPN_READINGS, toCanonicalStats, type EspnReading, type EspnScoringItem, type ScoringContext } from "./scoringMap";
import { LABELS, PUBLIC, readCross, readEspn, type CrossFixture } from "./test-helpers";

export interface EspnPlayerLine {
  id: number;
  defaultPositionId: number;
  stats: Array<{ statSourceId: number; statSplitTypeId: number; scoringPeriodId: number; appliedTotal?: number; stats?: Record<string, number> }>;
}

export interface EspnLeagueFixture {
  settings: { scoringSettings: { scoringItems: EspnScoringItem[] }; rosterSettings: { lineupSlotCounts: Record<string, number> } };
  teams: Array<{ roster: { entries: Array<{ playerPoolEntry: { player: EspnPlayerLine } }> } }>;
}

export interface EspnOracleSuite {
  cases: OracleCase[];
  summary: OracleSummary;
}

/** ESPN's actual single-week line for a scoring period (statSourceId 0, statSplitTypeId 1). */
export function actualLine(p: EspnPlayerLine, week: number) {
  return p.stats.find((s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === week);
}

export function espnCases(source: string, players: readonly EspnPlayerLine[], week: number, scoring: Scoring): OracleCase[] {
  const out: OracleCase[] = [];
  for (const p of players) {
    const a = actualLine(p, week);
    const pos = positionOf(p.defaultPositionId).pos;
    if (!a || a.appliedTotal === undefined || !pos) continue;
    out.push({ source, week, playerId: String(p.id), pos, stats: toCanonicalStats(a.stats ?? {}, pos), scoring, expected: a.appliedTotal });
  }
  return out;
}

const rosteredPlayers = (league: EspnLeagueFixture) => league.teams.flatMap((t) => t.roster.entries.map((e) => e.playerPoolEntry.player));

/** Parker's league scoring and his rostered players' week 2 and 3 lines. */
export function parkerLeague() {
  const league = readEspn<EspnLeagueFixture>(LABELS.league);
  const scoring = buildEspnScoring(league.settings.scoringSettings.scoringItems).scoring;
  const weeks = [2, 3].map((week) => ({ week, players: rosteredPlayers(readEspn<EspnLeagueFixture>(LABELS.roster(week))) }));
  return { scoring, weeks };
}

export function loadEspnParkerOracle(): EspnOracleSuite {
  const { scoring, weeks } = parkerLeague();
  const cases = weeks.flatMap(({ week, players }) => espnCases("espn/parker-league", players, week, scoring));
  return { cases, summary: runOracle(cases) };
}

/**
 * The public test league: its scoring items and lineup context, and each week's players with an
 * actual line (the top-250 pool; week 3 also its roster subset, deduped by id).
 */
export function publicLeague(): { items: EspnScoringItem[]; ctx: ScoringContext; scoring: Scoring; weeks: Array<{ week: number; players: EspnPlayerLine[] }> } {
  const league = readMinFixture<EspnLeagueFixture>("espn", PUBLIC.group, PUBLIC.league);
  const items = league.settings.scoringSettings.scoringItems;
  const ctx = summarizeSlots(league.settings.rosterSettings.lineupSlotCounts, []).scoringCtx;
  const weeks = PUBLIC.weeks.map((week) => {
    const pool = readMinFixture<{ week: number; players: Array<{ player: EspnPlayerLine }> }>("espn", PUBLIC.group, PUBLIC.pool(week));
    const seen = new Set<number>();
    const players = [...pool.players.map((x) => x.player), ...rosteredPlayers(league)].filter((p) => !seen.has(p.id) && seen.add(p.id));
    return { week, players };
  });
  return { items, ctx, scoring: buildEspnScoring(items, ctx).scoring, weeks };
}

/** Weeks 2–3 of the public test league; `scoringOverride` scores the same lines with another reading of its rules. */
export function loadEspnPublicOracle(scoringOverride?: Scoring): EspnOracleSuite {
  const { scoring, weeks } = publicLeague();
  const cases = weeks.flatMap(({ week, players }) => espnCases("espn/public-test-league", players, week, scoringOverride ?? scoring));
  return { cases, summary: runOracle(cases) };
}

/** Parker's scoring on Sleeper's public stat lines for the same players, vs ESPN's appliedTotal. */
export function loadEspnCrossSourceOracle(scoringOverride?: Scoring): EspnOracleSuite & { cross: CrossFixture } {
  const { scoring, weeks } = parkerLeague();
  const cross = readCross();
  const rows = new Map(cross.rows.map((r) => [`${r.week}:${r.espnId}`, r]));
  const cases: OracleCase[] = [];
  for (const { week, players } of weeks)
    for (const p of players) {
      const a = actualLine(p, week);
      const row = rows.get(`${week}:${p.id}`);
      const pos = positionOf(p.defaultPositionId).pos as Pos;
      if (a?.appliedTotal !== undefined && row) cases.push({ source: "espn/cross-source (Sleeper stats × Parker's scoring)", week, playerId: row.sleeperId, pos, stats: row.stats, scoring: scoringOverride ?? scoring, expected: a.appliedTotal });
    }
  return { cases, summary: runOracle(cases), cross };
}

/** ESPN's "every N" readings on a plain (non team/player-split) stat: pass_yd, pass_cmp, pass_inc, rush_yd, rush_att, rec_yd, rec, fgm_yds. */
export const EVERY_N_READINGS: ReadonlyArray<{ statId: number; stat: string; every: number }> = (Object.entries(ESPN_READINGS) as Array<[string, EspnReading]>).flatMap(([id, r]) => (r.kind === "every" && typeof r.stat === "string" ? [{ statId: Number(id), stat: r.stat, every: r.every }] : []));

/**
 * The stepped oracle: for every ESPN every-N count on a line whose raw stat is non-zero, one case
 * whose scoring is a single stepped rule {stat, every: N, points: 1} and whose expected value is
 * ESPN's OWN count (the derived stat id's value). ESPN computes floor(raw / N), so wherever the floor
 * bites (a raw value that isn't a multiple of N) this is platform evidence for the engine's stepped
 * semantics, which no league's scored points exercise. ESPN leaves most 0 counts out, and every count
 * of a negative raw value, so only the counts present are cases. Lines: Parker's weeks 2–3 (every
 * rostered player) and the public test league's weeks 2–3 (pool and roster subset).
 */
export function loadEspnSteppedOracle(): EspnOracleSuite {
  const lines: Array<{ source: string; week: number; player: EspnPlayerLine }> = [];
  for (const { week, players } of parkerLeague().weeks) for (const player of players) lines.push({ source: "espn/every-n (Parker's league)", week, player });
  for (const { week, players } of publicLeague().weeks) for (const player of players) lines.push({ source: "espn/every-n (public test league)", week, player });
  const cases: OracleCase[] = [];
  for (const { source, week, player } of lines) {
    const a = actualLine(player, week);
    const pos = positionOf(player.defaultPositionId).pos;
    if (!a?.stats || !pos) continue;
    const stats = toCanonicalStats(a.stats, pos);
    for (const r of EVERY_N_READINGS) {
      const count = a.stats[String(r.statId)];
      if (count === undefined || !stats[r.stat]) continue;
      cases.push({ source, week, playerId: `${player.id}#${r.statId}`, pos, stats, scoring: { perStat: {}, rules: [{ kind: "stepped", stat: r.stat, every: r.every, points: 1 }], unmapped: [] }, expected: count });
    }
  }
  return { cases, summary: runOracle(cases) };
}
