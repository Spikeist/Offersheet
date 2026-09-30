import { describe, expect, it } from "vitest";
import type { FfRule } from "./api";
import { cmp20Count, explainMismatches, explainRow, fgBandCount, tdBandCount } from "./oracle-explain";
import type { OracleRow } from "./scoring";
import { convertRules } from "./scoring-map";

function rule(id: number, name: string, extra: Partial<FfRule> & { pts: number; multi?: boolean }): FfRule {
  const { pts, multi, ...rest } = extra;
  return { category: { id, nameSingular: name, abbreviation: "X", ...(multi ? { multiValue: true } : {}) }, points: { value: pts, formatted: String(pts) }, ...rest };
}

describe("band counts from Sleeper stats", () => {
  it("TD length bands: exact for one TD (or one 40+ TD), else a range", () => {
    expect(tdBandCount({ rec_td: 1, rec_td_lng: 52 }, "rec_td", 40, 59)).toMatchObject({ count: 1 });
    expect(tdBandCount({ rec_td: 2, rec_td_40p: 1, rec_td_lng: 65 }, "rec_td", 60, 79)).toMatchObject({ count: 1 });
    expect(tdBandCount({ rec_td: 2, rec_td_lng: 12 }, "rec_td", 40, 59)).toMatchObject({ count: 0 });
    expect(tdBandCount({ rec_td: 2, rec_td_40p: 2, rec_td_lng: 70 }, "rec_td", 40, 59)).toMatchObject({ count: null, lo: 0, hi: 2 });
    expect(tdBandCount({}, "rec_td", 40, 59)).toBeNull();
  });

  it("FG bands: lengths known for one or two makes (fgm_lng, fgm_yds), else from buckets", () => {
    expect(fgBandCount({ fgm: 2, fgm_lng: 47, fgm_yds: 89 }, "fgm", 41, 43)).toMatchObject({ count: 1 }); // 47 and 42
    expect(fgBandCount({ fgm: 3, fgm_lng: 38, fgm_30_39: 1, fgm_20_29: 2 }, "fgm", 41, 43)).toMatchObject({ count: 0 });
    expect(fgBandCount({ fgm: 3, fgm_lng: 44, fgm_40_49: 1, fgm_20_29: 2 }, "fgm", 44, 46)).toMatchObject({ count: 1 }); // the only 40s FG is the longest
    expect(fgBandCount({ fgm: 3, fgm_lng: 48, fgm_40_49: 2, fgm_30_39: 1 }, "fgm", 41, 43)).toMatchObject({ count: null, lo: 0, hi: 2 });
    expect(fgBandCount({ fgmiss: 1, fgmiss_20_29: 1 }, "fgmiss", undefined, 35)).toMatchObject({ count: 1 });
    expect(fgBandCount({ fgmiss: 1, fgmiss_30_39: 1 }, "fgmiss", undefined, 35)).toMatchObject({ count: null, lo: 0, hi: 1 });
  });

  it("20+ yard completions: none when the longest is under 20, a range otherwise", () => {
    expect(cmp20Count({ pass_cmp: 14, pass_lng: 18 })).toMatchObject({ count: 0 });
    expect(cmp20Count({ pass_cmp: 20, pass_lng: 45, pass_cmp_40p: 2 })).toMatchObject({ count: null, lo: 2, hi: 20 });
    expect(cmp20Count({})).toBeNull();
  });
});

describe("explaining mismatches", () => {
  const { mappings } = convertRules([
    {
      label: "G",
      scoringRules: [
        rule(45, "Receiving TD", { pts: 2, multi: true, isBonus: true, boundLower: 40, boundUpper: 59, rangeType: "RANGE_DOUBLE_BOUND", applyTo: ["WR"] }),
        rule(166, "Passing Completion of 20+ Yards", { pts: 1, forEvery: 1, applyTo: ["QB"] }),
      ],
    },
  ]);
  const row = (pos: "WR" | "QB", diff: number, sleeper: Record<string, number>): OracleRow => ({ week: 3, ffId: 1, name: "Zorblax Quintavious", ffPos: pos, pos, actual: 10, computed: 10 + diff, diff, sleeper });

  it("explained: an exact band contribution closes the gap", () => {
    expect(explainRow(row("WR", -2, { gp: 1, rec_td: 1, rec_td_lng: 45 }), mappings).verdict).toBe("explained");
  });
  it("consistent: the gap fits a rule Sleeper's stats can't resolve", () => {
    const e = explainRow(row("QB", -3, { gp: 1, pass_cmp: 20, pass_lng: 45, pass_cmp_40p: 1 }), mappings);
    expect(e.verdict).toBe("consistent");
    expect(e.causes[0]).toMatchObject({ points: null, min: 1, max: 20 });
  });
  it("unexplained: nothing accounts for the gap", () => {
    expect(explainRow(row("WR", -1.5, { gp: 1, rec_td: 1, rec_td_lng: 12 }), mappings).verdict).toBe("unexplained");
    expect(explainRow(row("QB", -0.5, { gp: 1, pass_cmp: 20, pass_lng: 45 }), mappings).verdict).toBe("unexplained"); // not a whole completion
  });
  it("an offensive fumble recovery (not in Sleeper's player stats) can explain whole recoveries only; rules with no trigger stat never do", () => {
    const partial = convertRules([
      {
        label: "G",
        scoringRules: [rule(87, "Fumble Recovered", { pts: 4, forEvery: 1, applyToAll: true, applyTo: ["RB", "LB"] }), rule(125, "Conversion Return", { pts: 2, forEvery: 1, applyToAll: true, applyTo: ["RB", "LB"] })],
      },
    ]).mappings;
    const rb = (diff: number): OracleRow => ({ week: 2, ffId: 2, name: "Zorblax Quintavious", ffPos: "RB", pos: "RB", actual: 9, computed: 9 + diff, diff, sleeper: { gp: 1, rush_yd: 40 } });
    const four = explainRow(rb(-4), partial);
    expect(four.verdict).toBe("consistent");
    expect(four.causes.map((c) => c.categoryId)).toEqual([87]); // 125 has no triggering stat: not a candidate
    expect(explainRow(rb(-2), partial).verdict).toBe("unexplained"); // not a multiple of 4
  });

  it("summarizes verdicts and per-rule effects", () => {
    const s = explainMismatches([row("WR", -2, { gp: 1, rec_td: 1, rec_td_lng: 45 }), row("QB", -3, { gp: 1, pass_cmp: 9, pass_lng: 30 })], mappings);
    expect(s.verdicts).toEqual({ explained: 1, consistent: 1, unexplained: 0 });
    expect(s.byRule.find((b) => b.categoryId === 45)).toMatchObject({ exactRows: 1, exactPoints: 2, unresolvedRows: 0 });
  });
});
