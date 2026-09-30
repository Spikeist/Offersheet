/**
 * Test support (not app code): loads the committed MFL oracle fixture and runs it through the
 * scoring map and the engine's oracle. Used by oracle.test.ts and the cross-platform rule-type
 * coverage test.
 */
import { runOracle } from "@/engine/oracle";
import { readMinFixture } from "@/test-utils/fixtures";
import { toOracleCases, type OracleFixture } from "./oracleFixture";
import { mflRulesToScoring } from "./scoringMap";

export function loadMflOracle() {
  const fx = readMinFixture<OracleFixture>("mfl", "oracle", "test-league");
  const compiled = mflRulesToScoring(fx.rules);
  const cases = toOracleCases(fx, compiled.scoring, "mfl/test-league");
  return { fx, compiled, cases, summary: runOracle(cases) };
}
