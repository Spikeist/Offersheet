/**
 * Test support (not app code): builds the Sleeper scoring-oracle cases from the committed minimized
 * fixtures: Sleeper's raw /stats lines scored with the NORMALIZED scoring (bonus flags replaced by
 * threshold/range rules, D/ST brackets by DEF ranges, position bonuses kept as per-unit keys) vs
 * Sleeper's own players_points. The stat lines still carry Sleeper's flags, so a double count would
 * show up as a mismatch. Used by oracle.test.ts, the cross-platform rule-type coverage test and
 * scripts/oracle-report.ts.
 */
import type { Pos, StatLine } from "@/engine/model";
import { runOracle, type OracleCase, type OracleSummary } from "@/engine/oracle";
import { fixtureLabels, readMinFixture } from "@/test-utils/fixtures";
import { sleeperPos } from "./normalize";
import { mapSleeperScoring } from "./scoringMap";
import { loadTestLeague } from "./test-helpers";

export interface SleeperOracleSuite {
  cases: OracleCase[];
  summary: OracleSummary;
}

/** The public test league, weeks 2–3 (the committed subset of its rosters). */
export function sleeperTestLeagueCases(): OracleCase[] {
  const t = loadTestLeague();
  const scoring = mapSleeperScoring(t.league.scoring_settings).scoring;
  const players = new Map(t.players.map((p) => [p.id, p]));
  const cases: OracleCase[] = [];
  for (const week of t.meta.oracleWeeks) {
    const stats = new Map((t.stats[week] ?? []).map((r) => [r.player_id, r.stats]));
    for (const m of t.matchups[week] ?? []) {
      for (const playerId of m.players as string[]) {
        const p = players.get(playerId);
        const pos = p ? sleeperPos(p.position, p.fantasyPositions) : null;
        if (!pos) throw new Error(`no position for ${playerId}`);
        cases.push({ source: "sleeper/test-league", week, playerId, pos, stats: stats.get(playerId) ?? {}, scoring, expected: m.players_points[playerId] });
      }
    }
  }
  return cases;
}

interface OracleLeagueFixture {
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  cases: Array<{ sleeperId: string; pos: Pos; week: number; stats: StatLine; players_points: number }>;
}

/** Labels of the Phase 0 cross-league oracle leagues ("oracle-league-1" …). */
export const sleeperOracleLeagueLabels = (): string[] => fixtureLabels("fixtures/sanitized/min/sleeper/oracle-leagues").sort();

export function sleeperOracleLeagueCases(label: string): OracleCase[] {
  const f = readMinFixture<OracleLeagueFixture>("sleeper", "oracle-leagues", label);
  const scoring = mapSleeperScoring(f.scoring_settings).scoring;
  return f.cases.map((c) => ({ source: `sleeper/${label}`, week: c.week, playerId: c.sleeperId, pos: c.pos, stats: c.stats, scoring, expected: c.players_points }));
}

export function loadSleeperTestLeagueOracle(): SleeperOracleSuite {
  const cases = sleeperTestLeagueCases();
  return { cases, summary: runOracle(cases) };
}

export function loadSleeperOracleLeague(label: string): SleeperOracleSuite {
  const cases = sleeperOracleLeagueCases(label);
  return { cases, summary: runOracle(cases) };
}
