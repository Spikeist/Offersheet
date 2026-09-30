/**
 * Scoring oracle on real data (CLAUDE.md §5): the Phase 0 public MFL test league's rules, compiled by
 * the scoring map, must reproduce MFL's league-scored points from Sleeper's actual stats for every
 * rostered player-week, including players who didn't play (no gp: MFL scores them 0). The fixture is
 * a committed, minimized subset (scripts/minimize/mfl-oracle.ts); its meta records the result on
 * every player-week of the full local copy.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { describeMismatch } from "@/engine/oracle";
import { loadMflOracle } from "./oracleSuite";

const { oracleTarget: TARGET, oracleTolerance: TOLERANCE } = config.scoring;

describe("MFL scoring oracle (Phase 0 public test league, weeks 2–3)", () => {
  const { fx, compiled, cases, summary } = loadMflOracle();
  const played = cases.filter((c) => (c.stats.gp ?? 0) > 0);

  it("maps every rule of the league exactly", () => {
    expect(compiled.scoring.unmapped).toEqual([]);
    expect(compiled.warnings).toEqual([]);
    expect(compiled.mappings.every((m) => m.status === "mapped")).toBe(true);
  });

  it(`matches MFL's points (within ${TOLERANCE}) for ≥ ${TARGET * 100}% of the committed player-weeks`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(150);
    expect(summary.mismatches.map(describeMismatch)).toEqual([]);
    expect(summary.passes).toBe(true);
    expect(summary.rate).toBeGreaterThanOrEqual(TARGET);
  });

  it("includes rostered players who didn't play: MFL scores them 0 and so does the engine", () => {
    const idle = cases.filter((c) => !((c.stats.gp ?? 0) > 0));
    expect(idle.length).toBeGreaterThan(0);
    expect(played.length).toBeGreaterThanOrEqual(150);
    expect(idle.every((c) => c.expected === 0)).toBe(true);
    expect(summary.mismatches.filter((m) => !((m.case.stats.gp ?? 0) > 0))).toEqual([]);
  });

  it(`recorded the full population's result: every rostered player-week within ${TOLERANCE}, played or not`, () => {
    const p = fx.meta.population;
    expect(p.cases).toBeGreaterThanOrEqual(600);
    expect(p.within / p.cases).toBeGreaterThanOrEqual(TARGET);
    expect(p.notPlayed).toBeGreaterThan(0);
    expect(p.notPlayedWithin).toBe(p.notPlayed);
    expect(fx.meta.weeks).toEqual([2, 3]);
  });

  it("tests per-unit rates only (honest rule-type counts), including the half-sack rate", () => {
    // What a match here can prove (ruleTypesIn counts a type only when a wrong reading would change the
    // points): every rule of this league compiles to a per-unit rate. Its position-specific rates have no
    // league-wide base, so replacing and adding give the same points (byPosition 0), and its "1.5/0.5" and
    // "1/0.5" sack rules are exactly linear on the half-sack grid, so they are rates, not stepped rules
    // (stepped 0 since the ENG-1 fix; the floor never bit on a half-sack line anyway).
    expect(summary.ruleTypesExercised.perUnit).toBeGreaterThan(100);
    expect({ ...summary.ruleTypesExercised, perUnit: "> 100" }).toEqual({ perUnit: "> 100", byPosition: 0, threshold: 0, range: 0, stepped: 0, bounded: 0, composite: 0, perGame: 0 });
    expect(compiled.scoring.rules).toEqual([]);
    expect(cases.some((c) => c.pos === "DL" && (c.stats.idp_sack ?? 0) % 1 === 0.5)).toBe(true); // a half sack scored exactly
  });
});
