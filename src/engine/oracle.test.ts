import { describe, expect, it } from "vitest";
import type { Scoring } from "./model";
import { describeMismatch, runOracle, ruleTypesIn, type OracleCase } from "./oracle";

const scoring: Scoring = {
  perStat: { rec: 0.5, rec_yd: 0.1 },
  byPosition: { TE: { rec: 1 } },
  rules: [
    { kind: "threshold", stat: "rec_yd", min: 100, points: 3 },
    { kind: "range", stat: "pts_allow", min: 14, max: 17, points: 1, positions: ["DEF"] },
    { kind: "stepped", stat: "pass_yd", every: 25, points: 1 },
    { kind: "perUnit", stat: "pass_yd", points: 0.01, min: 300, max: 999 },
    { kind: "threshold", stat: { sum: ["rec_fd", "rec_td"] }, min: 4, points: 2 },
    { kind: "perGame", points: 2, positions: ["K"] },
  ],
  unmapped: [],
};
/** A game played unless the line says otherwise (no rule fires on a line without gp). */
const c = (pos: OracleCase["pos"], stats: OracleCase["stats"], expected: number): OracleCase => ({ source: "test", week: 2, playerId: "x", pos, stats: { gp: 1, ...stats }, scoring, expected });

describe("oracle runner", () => {
  it("counts matches within tolerance and reports mismatches with breakdowns", () => {
    const s = runOracle([c("WR", { rec: 6, rec_yd: 110 }, 17), c("WR", { rec: 1 }, 9)]);
    expect(s.total).toBe(2);
    expect(s.within).toBe(1);
    expect(s.passes).toBe(false);
    expect(s.mismatches[0]?.diff).toBeCloseTo(-8.5, 10);
    // §5: every mismatch is reported with its stat line.
    expect(describeMismatch(s.mismatches[0]!)).toBe("test wk2 WR x: expected 9, got 0.50 (-8.50) | gp=1 rec=1");
  });

  it("counts a rule type only when a wrong reading of it would change the case's points", () => {
    const types = (pos: OracleCase["pos"], stats: OracleCase["stats"]) => [...ruleTypesIn(c(pos, stats, 0))].sort();
    // TE rec: 1 replaces the 0.5 base (replace ≠ add); rec_fd + rec_td both non-zero in the summed bonus.
    expect(types("TE", { rec: 5, rec_yd: 120, rec_fd: 3, rec_td: 1 })).toEqual(["byPosition", "composite", "perUnit", "threshold"]);
    // 310 / 25 = 12.4: the floor bites. 310 is inside the bounded per-unit rule's [300, 999].
    expect(types("QB", { pass_yd: 310 })).toEqual(["perUnit", "stepped"]);
    // 250 / 25 = 10 exactly (floor doesn't bite); 250 < 300, so the bound decided the per-unit rule.
    expect(types("QB", { pass_yd: 250 })).toEqual(["bounded"]);
    expect(types("DEF", { pts_allow: 15 })).toEqual(["range"]);
    expect(types("K", { gp: 1 })).toEqual(["perGame"]);
    expect(types("K", { gp: 0 })).toEqual([]); // a game not played scores (and tests) no rule
    expect(types("TE", { rec_fd: 4 })).toEqual(["threshold"]); // one non-zero part: not evidence for summing
    // A position rate over a zero base can't tell replace from add.
    const zeroBase: Scoring = { ...scoring, perStat: { rec_yd: 0.1 }, byPosition: { TE: { rec: 1 } } };
    expect([...ruleTypesIn({ ...c("TE", { rec: 5 }, 0), scoring: zeroBase })]).toEqual(["perUnit"]);
  });
});
