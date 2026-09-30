/**
 * Committed Fleaflicker scoring-oracle fixtures (fixtures/sanitized/min/fleaflicker/oracle/), written
 * by scripts/minimize/fleaflicker-oracle.ts from the two Phase 0 public test leagues (a conventional
 * league and an exotic keeper league): each league's scoring rules and a subset of player-weeks with
 * Sleeper's actual stats and Fleaflicker's league-scored points. Placeholder-only: no team, owner or
 * league identities, and no Fleaflicker player ids (canonical Sleeper ids only).
 */
import type { Pos, Scoring, StatLine } from "@/engine/model";
import type { OracleCase } from "@/engine/oracle";

export interface OracleFixtureCase {
  /** Canonical (Sleeper) player id. */
  sleeperId: string;
  /** Fleaflicker's position label (EDR, IL, CB, S, K, P …). */
  platformPos: string;
  pos: Pos;
  week: number;
  /** Sleeper's actual stats for the game: only the keys the scoring reads, plus gp (absent = didn't play). */
  stats: StatLine;
  /** Fleaflicker's league-scored points (box score). */
  expected: number;
}

export interface OraclePopulation {
  /** Player-weeks compared: every box-score player-week crosswalked to a Sleeper id, played or not. */
  cases: number;
  within: number;
  /** Of those, player-weeks without gp (he didn't play; Fleaflicker must score him 0). */
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
    /**
     * Population mismatches sorted by the Phase 0 explainer: "explained" = the unmapped rules' exact
     * contributions (pinned by Sleeper's *_lng / bucket stats) close the gap; "consistent" = the gap
     * fits rules Sleeper's stats can't resolve; "unexplained" = neither.
     */
    mismatchVerdicts?: { explained: number; consistent: number; unexplained: number };
    selection: string;
    generatedBy: string;
  };
  /** FetchLeagueRules trimmed to the fields the scoring map reads. */
  rules: unknown;
  cases: OracleFixtureCase[];
}

/** Fixture cases → engine oracle cases under a compiled scoring. */
export function toOracleCases(fx: OracleFixture, scoring: Scoring, source: string): OracleCase[] {
  return fx.cases.map((c) => ({ source, week: c.week, playerId: c.sleeperId, pos: c.pos, stats: c.stats, scoring, expected: c.expected }));
}
