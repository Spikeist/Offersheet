/**
 * Scoring oracle (CLAUDE.md §5) for Sleeper on committed minimized fixtures: recompute every kept
 * player-week from Sleeper's raw /stats with the NORMALIZED scoring (bonus flags replaced by
 * threshold/range rules, D/ST brackets by DEF ranges, position bonuses such as bonus_rec_te and
 * bonus_fd_rb kept as per-unit keys) and compare with Sleeper's own players_points. The stat lines
 * still carry Sleeper's flags, so a double count would show up as a mismatch.
 *
 * Full local runs (scripts/minimize/sleeper.ts, 2026 weeks 2–3): test league 571/571; the four
 * Phase 0 cross-league oracle leagues 1273/1273, 559/559, 580/580, 395/395. The committed subsets
 * below re-check a sample of those, covering every rule type Sleeper's scoring has. The cases are
 * built in ./oracleSuite.ts (shared with the cross-platform coverage test).
 *
 * Rule-type counts follow engine/oracle.ts ruleTypesIn(): a type counts only when a wrong reading of
 * it would have changed the points. Sleeper's scoring has per-unit keys, thresholds, ranges and one
 * composite (rush + rec yards); it has NO byPosition rate (its position bonuses are stats of their
 * own), no bounded per-unit or stepped rule (its bounded tiers and D/ST brackets are ranges) and no
 * per-game rule, so those four types come from the other platforms' oracles.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { describeMismatch, RULE_TYPES, runOracle, type OracleSummary, type RuleType } from "@/engine/oracle";
import { sleeperOracleLeagueCases as leagueCases, sleeperOracleLeagueLabels, sleeperTestLeagueCases as testLeagueCases } from "./oracleSuite";

const { oracleTarget: TARGET, oracleTolerance: TOLERANCE } = config.scoring;
const TARGET_TEXT = `≥ ${TARGET * 100}% within ${TOLERANCE}`;
const oracleLabels = sleeperOracleLeagueLabels();

function expectPasses(summary: OracleSummary): void {
  if (summary.mismatches.length) console.log(summary.mismatches.map(describeMismatch).join("\n"));
  expect(summary.total).toBeGreaterThan(50);
  expect(summary.rate).toBeGreaterThanOrEqual(TARGET);
  expect(summary.passes).toBe(true);
}

describe("Sleeper scoring oracle", () => {
  it(`test league, weeks 2–3: ${TARGET_TEXT} (per-unit keys and D/ST bracket ranges)`, () => {
    const cases = testLeagueCases();
    const s = runOracle(cases);
    expectPasses(s);
    expect(s.within).toBe(s.total); // 100% in the committed subset
    expect(s.ruleTypesExercised.perUnit).toBeGreaterThan(50);
    expect(s.ruleTypesExercised.range).toBeGreaterThan(0); // pts_allow / yds_allow brackets
    // The brackets are ranges (both bounds), not bounded per-unit rules; the league scores no bonus tier.
    expect(s.ruleTypesExercised.bounded).toBe(0);
    expect(s.ruleTypesExercised.threshold).toBe(0);
    // The DEF lines still carry Sleeper's bracket flags; they must not be counted twice.
    expect(cases.some((c) => c.pos === "DEF" && Object.keys(c.stats).some((k) => /^(pts|yds)_allow_\d/.test(k)))).toBe(true);
  });

  it.each(oracleLabels)(`%s: ${TARGET_TEXT}`, (label) => {
    expect(oracleLabels).toHaveLength(4);
    const s = runOracle(leagueCases(label));
    expectPasses(s);
    expect(s.within).toBe(s.total);
  });

  it("the cross-league sample exercises every rule type Sleeper's scoring has", () => {
    const all = oracleLabels.flatMap(leagueCases);
    const s = runOracle(all);
    expectPasses(s);
    const exercised = (t: RuleType) => s.ruleTypesExercised[t];
    expect(exercised("perUnit")).toBeGreaterThan(100);
    expect(exercised("threshold")).toBeGreaterThan(0); // bonus keys: top yardage tiers, pass_cmp_25, IDP 2+ sacks / 10+ tackles / 3+ PD
    expect(exercised("range")).toBeGreaterThan(0); // lower yardage tiers and D/ST brackets
    expect(exercised("composite")).toBeGreaterThan(0); // rush + rec yards bonus with both parts non-zero
    // Not in Sleeper's scoring (see the file comment): these come from the other platforms' oracles.
    expect(exercised("byPosition")).toBe(0); // bonus_fd_<pos> / bonus_rec_<pos> are per-unit keys (review SLP-7)
    expect(exercised("bounded")).toBe(0);
    expect(exercised("stepped")).toBe(0);
    expect(exercised("perGame")).toBe(0);
    expect(RULE_TYPES).toHaveLength(8);
  });

  it("covers the first-down bonus (per-unit bonus_fd_<pos>) on real league points", () => {
    const all = oracleLabels.flatMap(leagueCases);
    const fd = all.filter((c) => Object.keys(c.scoring.perStat).some((k) => k.startsWith("bonus_fd_") && c.stats[k]));
    expect(fd.length).toBeGreaterThan(20);
    expect(runOracle(fd).rate).toBe(1);
  });

  it("covers TE premium (per-unit bonus_rec_te) and IDP scoring", () => {
    const all = oracleLabels.flatMap(leagueCases);
    const tePremium = all.filter((c) => c.pos === "TE" && c.stats.bonus_rec_te && c.scoring.perStat.bonus_rec_te);
    expect(tePremium.length).toBeGreaterThan(5);
    expect(runOracle(tePremium).rate).toBe(1);
    const idp = all.filter((c) => ["DL", "LB", "DB"].includes(c.pos) && Object.keys(c.stats).some((k) => k.startsWith("idp_")));
    expect(idp.length).toBeGreaterThan(20);
    expect(runOracle(idp).rate).toBe(1);
  });

  it("scores exclusive yardage tiers the way Sleeper's league points do", () => {
    const all = oracleLabels.flatMap(leagueCases);
    const upper = all.filter((c) => (c.stats.rush_yd ?? 0) + (c.stats.rec_yd ?? 0) >= 200 && c.scoring.rules.some((r) => r.kind === "range" && typeof r.stat !== "string"));
    expect(upper.length).toBeGreaterThan(0); // a 200+ rush+rec game in a league scoring both tiers
    expect(runOracle(upper).rate).toBe(1);
  });
});
