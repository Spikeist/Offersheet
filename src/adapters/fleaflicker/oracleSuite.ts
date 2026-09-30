/**
 * Test support (not app code): loads a committed Fleaflicker oracle fixture and runs it through the
 * scoring map and the engine's oracle. Used by oracle.test.ts and the cross-platform rule-type
 * coverage test.
 */
import { runOracle } from "@/engine/oracle";
import { readMinFixture } from "@/test-utils/fixtures";
import { toOracleCases, type OracleFixture } from "./oracleFixture";
import { fleaflickerRulesToScoring, type ConvertOptions } from "./scoringMap";

export type FleaflickerOracleLeague = "conventional-league" | "keeper-league";

/**
 * The exotic keeper league can't reach §5's 99%: 25 of its 82 rules have no Sleeper stat key and 3
 * are only partly mappable (listed as unmapped). This is a REGRESSION PIN, not a target: the result
 * measured on the committed subset (2026-09-29, after the Phase 1 review fixes ENG-3/ENG-5; the
 * subset now includes 30 player-weeks of players who didn't play, all matched). It was 229/270 before
 * those player-weeks joined; the 270 player-weeks of players who played still give 229.
 */
export const KEEPER_REGRESSION_PIN = { within: 259, total: 300 } as const;
/** The same for the keeper league's full local population (fixture meta): it was 736/873. */
export const KEEPER_POPULATION_PIN = { within: 838, total: 975 } as const;

export function loadFleaflickerOracle(league: FleaflickerOracleLeague, opts: ConvertOptions = {}) {
  const fx = readMinFixture<OracleFixture>("fleaflicker", "oracle", league);
  const compiled = fleaflickerRulesToScoring(fx.rules, opts);
  const cases = toOracleCases(fx, compiled.scoring, `fleaflicker/${league}`);
  return { fx, compiled, cases, summary: runOracle(cases) };
}
