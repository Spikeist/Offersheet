/**
 * Planner reply to Checkpoint 0, answer 4 (CLAUDE.md §5, §16): the oracle tests must cover EVERY
 * rule type. Every real-data suite must meet §5's target (or its documented regression pin), and each
 * rule type must have platform evidence. Counts are honest (engine/oracle.ts ruleTypesIn): a type
 * counts only where a wrong reading would have changed the points. Where no league in our data can
 * provide such cases, the evidence is stated explicitly and marked ⚠️ in reports/oracle-results.md:
 * - byPosition: ESPN's overrides match only when read as replacements (espnReplacementEvidence);
 * - stepped: ESPN's own every-N counts, where the floor bites (derived counts, not league points);
 * - bounded: no league in our data has a bound that cuts a stat (engine unit tests only);
 * - perGame: one derived Fleaflicker rule, including idle weeks without gp.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { RULE_TYPES, type RuleType } from "@/engine/oracle";
import { allOracleSuites, espnReplacementEvidence, ruleTypeEvidence } from "./oracleSuites";

describe("scoring oracle across platforms", () => {
  const suites = allOracleSuites();
  const total = (t: RuleType, platform?: string) => suites.filter((s) => !platform || s.name.startsWith(platform)).reduce((n, s) => n + s.summary.ruleTypesExercised[t], 0);

  it("runs every platform's suites", () => {
    expect(new Set(suites.map((s) => s.name.split(" · ")[0]))).toEqual(new Set(["ESPN", "Sleeper", "MFL", "Fleaflicker"]));
    expect(suites.length).toBe(12);
  });

  it.each(suites.map((s) => [s.name, s] as const))("%s meets §5's target or its regression pin", (_name, s) => {
    expect(s.summary.total).toBeGreaterThanOrEqual(100);
    expect(s.summary.rate).toBeGreaterThanOrEqual(s.target);
    if (!s.pin) expect(s.target).toBe(config.scoring.oracleTarget);
  });

  it("has league-scored evidence for per-unit rates, thresholds, ranges and composite stats", () => {
    const leaguePoints = suites.filter((s) => !s.name.includes("every-N"));
    for (const t of ["perUnit", "threshold", "range", "composite"] as const) expect(leaguePoints.reduce((n, s) => n + s.summary.ruleTypesExercised[t], 0), t).toBeGreaterThan(0);
    expect(total("threshold", "Sleeper")).toBeGreaterThan(0); // bonus keys as thresholds
    expect(total("composite", "Sleeper")).toBeGreaterThan(0); // rush + rec yards bonus
    expect(total("range", "ESPN")).toBeGreaterThan(0); // D/ST points-allowed buckets
  });

  it("proves byPosition REPLACEMENT against ESPN's own points (the per-case counter can't: no override sits on a non-zero base)", () => {
    const { replace, additive } = espnReplacementEvidence();
    expect(replace.rate).toBeGreaterThanOrEqual(config.scoring.oracleTarget);
    expect(additive.rate).toBeLessThan(config.scoring.oracleTarget);
    expect(total("byPosition")).toBe(0);
  });

  it("has stepped evidence where the floor bites, from ESPN's own every-N counts", () => {
    expect(total("stepped", "ESPN · every-N")).toBeGreaterThan(1000);
    expect(total("stepped") - total("stepped", "ESPN · every-N")).toBe(0); // no league scores a stepped rule
  });

  it("has per-game evidence only from the Fleaflicker keeper league's derived rule, and no bounded evidence", () => {
    expect(total("perGame")).toBe(total("perGame", "Fleaflicker · exotic"));
    expect(total("perGame")).toBeGreaterThan(0);
    expect(total("bounded")).toBe(0);
  });

  it("states the evidence for every rule type, ✅ only where league-scored points verify it", () => {
    const evidence = ruleTypeEvidence(suites);
    expect(evidence.map((e) => e.type)).toEqual([...RULE_TYPES]);
    expect(Object.fromEntries(evidence.map((e) => [e.type, e.status]))).toEqual({ perUnit: "✅", byPosition: "✅", threshold: "✅", range: "✅", stepped: "⚠️", bounded: "⚠️", composite: "✅", perGame: "⚠️" });
  });
});
