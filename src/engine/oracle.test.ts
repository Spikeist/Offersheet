import { describe, expect, it } from "vitest";
import type { Scoring } from "./model";
import { runOracle, ruleTypesIn, type OracleCase } from "./oracle";

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
const c = (pos: OracleCase["pos"], stats: OracleCase["stats"], expected: number): OracleCase => ({ source: "test", week: 2, playerId: "x", pos, stats, scoring, expected });

describe("oracle runner", () => {
  it("counts matches within tolerance and reports mismatches with breakdowns", () => {
    const s = runOracle([c("WR", { rec: 6, rec_yd: 110 }, 17), c("WR", { rec: 1 }, 9)]);
    expect(s.total).toBe(2);
    expect(s.within).toBe(1);
    expect(s.passes).toBe(false);
    expect(s.mismatches[0]?.diff).toBeCloseTo(-8.5, 10);
  });

  it("detects every rule type a matched case exercised", () => {
    expect([...ruleTypesIn(c("TE", { rec: 5, rec_yd: 120, rec_fd: 3, rec_td: 1 }, 0))].sort()).toEqual(["byPosition", "composite", "perUnit", "threshold"]);
    expect([...ruleTypesIn(c("QB", { pass_yd: 310 }, 0))].sort()).toEqual(["bounded", "perUnit", "stepped"]);
    expect([...ruleTypesIn(c("DEF", { pts_allow: 15 }, 0))].sort()).toEqual(["bounded", "range"]);
    expect([...ruleTypesIn(c("K", { gp: 1 }, 0))]).toEqual(["perGame"]);
  });
});
