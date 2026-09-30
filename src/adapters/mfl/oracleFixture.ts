/**
 * Committed MFL scoring-oracle fixture (fixtures/sanitized/min/mfl/oracle/), written by
 * scripts/minimize/mfl-oracle.ts from the Phase 0 public test league: the league's scoring rules and
 * a subset of player-weeks with Sleeper's actual stats and MFL's league-scored points. Placeholder-
 * only: no team, owner or league identities, and no MFL player ids (canonical Sleeper ids only).
 */
import type { Pos, Scoring, StatLine } from "@/engine/model";
import type { OracleCase } from "@/engine/oracle";

export interface OracleFixtureCase {
  /** Canonical (Sleeper) player id. */
  sleeperId: string;
  /** The platform's position label (MFL DT/DE, Fleaflicker EDR/IL …). */
  platformPos: string;
  pos: Pos;
  week: number;
  /** Sleeper's actual stats for the game: only the keys the scoring reads, plus gp (absent = didn't play). */
  stats: StatLine;
  /** The platform's league-scored points. */
  expected: number;
}

export interface OraclePopulation {
  /** Player-weeks compared: every rostered player-week crosswalked to a Sleeper id, played or not. */
  cases: number;
  within: number;
  /** Of those, player-weeks without gp (he didn't play; the platform must score him 0). */
  notPlayed?: number;
  /** Of the player-weeks without gp, those within tolerance. */
  notPlayedWithin?: number;
  byPos: Record<string, { cases: number; within: number }>;
  /** Player-weeks left out, by reason. */
  skipped: Record<string, number>;
}

export interface OracleFixture {
  meta: {
    platform: string;
    /** Generic description only (no identities). */
    league: string;
    season: number;
    weeks: number[];
    source: string;
    /** Measured by the minimizer on every player-week of the full local copy. */
    population: OraclePopulation;
    selection: string;
    generatedBy: string;
  };
  /** The league's scoring rules in the platform's own format, trimmed to the fields the scoring map reads. */
  rules: unknown;
  cases: OracleFixtureCase[];
}

/** Fixture cases → engine oracle cases under a compiled scoring. */
export function toOracleCases(fx: OracleFixture, scoring: Scoring, source: string): OracleCase[] {
  return fx.cases.map((c) => ({ source, week: c.week, playerId: c.sleeperId, pos: c.pos, stats: c.stats, scoring, expected: c.expected }));
}
