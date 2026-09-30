import { describe, expect, it } from "vitest";
import { diffHistogram, evaluate, statForBonus, statLine, summarizeOracle, type OracleRow } from "./scoring";
import type { ConvertedScoring } from "./scoring-map";

const scoring: ConvertedScoring = {
  perStat: { rec: 0.5, rec_yd: 0.1, rec_td: 6, pass_yd: 0.04 },
  byPosition: { TE: { rec: 1 } },
  bonuses: [
    { stat: "rec_yd", threshold: 100, points: 3, positions: ["WR", "TE"] },
    { stat: "pts_allow", threshold: -1e9, max: 0, points: 10, positions: ["DEF"] },
    { stat: "cmp_pct", threshold: -1e9, max: 50, points: -2, positions: ["QB"] },
  ],
  unmapped: [],
};

describe("evaluate", () => {
  it("applies per-stat rates, byPosition replacement rates and bonuses", () => {
    expect(evaluate({ rec: 5, rec_yd: 120, rec_td: 1 }, "WR", scoring)).toBeCloseTo(2.5 + 12 + 6 + 3, 10);
    expect(evaluate({ rec: 5, rec_yd: 50 }, "TE", scoring)).toBeCloseTo(5 + 5, 10);
    expect(evaluate({ rec: 5, rec_yd: 120 }, "RB", scoring)).toBeCloseTo(2.5 + 12, 10); // bonus is WR/TE only
  });

  it("treats a missing count as 0 only for players who played (Sleeper omits zeros)", () => {
    expect(evaluate({ gp: 1, sack: 3 }, "DEF", scoring)).toBe(10); // shutout: pts_allow omitted
    expect(evaluate({ gms_active: 1 }, "DEF", scoring)).toBe(0); // didn't play
    expect(evaluate({ gp: 1, pts_allow: 7 }, "DEF", scoring)).toBe(0);
  });

  it("never fires a tier on a missing ratio (no completion % without attempts)", () => {
    expect(evaluate({ gp: 1 }, "QB", scoring)).toBe(0);
    expect(evaluate({ gp: 1, cmp_pct: 45, pass_yd: 100 }, "QB", scoring)).toBeCloseTo(4 - 2, 10);
  });

  it("statLine lists the non-zero stats the scoring reads", () => {
    expect(statLine({ rec: 3, rec_yd: 0, snaps: 40, pass_yd: 12 }, scoring)).toEqual({ rec: 3, pass_yd: 12 });
  });

  it("a bonus on a sum of keys reads their sum; a gp bonus fires once per game played", () => {
    const s: ConvertedScoring = {
      perStat: {},
      byPosition: {},
      bonuses: [
        { stat: "rec_fd+rec_td", threshold: 4, points: 1, positions: ["WR"] },
        { stat: "gp", threshold: 1, points: 2, positions: ["QB", "K"] },
      ],
      unmapped: [],
    };
    expect(evaluate({ gp: 1, rec_fd: 2, rec_td: 2 }, "WR", s)).toBe(1);
    expect(evaluate({ gp: 1, rec_fd: 3 }, "WR", s)).toBe(0);
    expect(statForBonus({ gp: 1 }, "rec_fd+rec_td")).toBe(0);
    expect(statForBonus({}, "rec_fd+rec_td")).toBeUndefined();
    expect(evaluate({ gp: 1, pass_yd: 150 }, "QB", s)).toBe(2);
    expect(evaluate({ gms_active: 1 }, "QB", s)).toBe(0); // active but didn't play
  });
});

describe("summarizeOracle", () => {
  const row = (diff: number | null, ffPos = "WR", reason?: string): OracleRow => ({ week: 3, ffId: 1, name: "Player", ffPos, pos: "WR", actual: 10, computed: diff === null ? null : 10 + diff, diff, reason });
  it("counts rows within the tolerance, by position, and sorts mismatches by size", () => {
    const s = summarizeOracle([row(0), row(0.04), row(-0.25), row(3, "RB"), row(null, "P", "no model position (P)")], 0.05);
    expect(s).toMatchObject({ rows: 5, compared: 4, within: 2, skipped: { "no model position (P)": 1 } });
    expect(s.rate).toBe(0.5);
    expect(s.byPos).toEqual({ WR: { compared: 3, within: 2 }, RB: { compared: 1, within: 0 } });
    expect(s.mismatches.map((m) => m.diff)).toEqual([3, -0.25]);
  });

  it("reports 0-vs-0 rows (players who didn't play) and the rate without them", () => {
    const zero: OracleRow = { week: 3, ffId: 2, name: "Bench Player", ffPos: "WR", pos: "WR", actual: 0, computed: 0, diff: 0 };
    const s = summarizeOracle([row(0), row(-1), zero, zero], 0.05);
    expect(s).toMatchObject({ compared: 4, within: 3, zeroZero: 2 });
    expect(s.rateNonZero).toBe(0.5); // 1 of the 2 rows where someone scored
  });

  it("diffHistogram counts differences, most frequent first", () => {
    expect(diffHistogram([row(-1), row(-2), row(-1), row(null), row(-0.004)])).toEqual([
      { diff: -1, count: 2 },
      { diff: -2, count: 1 },
      { diff: 0, count: 1 },
    ]);
  });
});
