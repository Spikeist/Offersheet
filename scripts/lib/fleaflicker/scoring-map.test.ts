import { describe, expect, it } from "vitest";
import type { FfRule } from "./api";
import { convertRules, distanceKeys, mappingCounts, ruleBounds, ruleRate, scoringKeys } from "./scoring-map";

const ALL = ["QB", "RB", "WR", "TE", "K", "P", "D/ST", "CB", "S", "EDR", "IL", "LB"];

function rule(id: number, name: string, extra: Partial<FfRule> & { pts: number; multi?: boolean }): FfRule {
  const { pts, multi, ...rest } = extra;
  return { category: { id, nameSingular: name, abbreviation: "X", ...(multi ? { multiValue: true } : {}) }, points: { value: pts, formatted: String(pts) }, ...rest };
}
const group = (...scoringRules: FfRule[]) => [{ label: "G", scoringRules }];

describe("ruleBounds (proto3 omits a bound of 0)", () => {
  it("uses rangeType to know which bounds exist", () => {
    expect(ruleBounds(rule(94, "Point Allowed", { pts: 15, isBonus: true, rangeType: "RANGE_UPPER_BOUND" }))).toEqual({ hi: 0 });
    expect(ruleBounds(rule(95, "Net Yard Allowed", { pts: 10, isBonus: true, boundUpper: 125, rangeType: "RANGE_DOUBLE_BOUND" }))).toEqual({ lo: 0, hi: 125 });
    expect(ruleBounds(rule(3, "Passing Yard", { pts: 5, isBonus: true, boundLower: 500, rangeType: "RANGE_LOWER_BOUND" }))).toEqual({ lo: 500 });
    expect(ruleBounds(rule(3, "Passing Yard", { pts: 1, forEvery: 20 }))).toEqual({ lo: undefined, hi: undefined });
  });

  it("rate is points / forEvery (pointsPer is a float32 display copy)", () => {
    expect(ruleRate(rule(123, "Target", { pts: 1, forEvery: 3, pointsPer: { value: 0.33333334 } }))).toBeCloseTo(1 / 3, 12);
    expect(ruleRate(rule(5, "Passing TD", { pts: 6 }))).toBe(6);
  });
});

describe("distanceKeys", () => {
  it("maps TD length ranges only onto Sleeper's 40+/50+ counts", () => {
    expect(distanceKeys("rec_td", 40, undefined)).toEqual([{ key: "rec_td_40p", weight: 1 }]);
    expect(distanceKeys("rec_td", 40, 49)).toEqual([
      { key: "rec_td_40p", weight: 1 },
      { key: "rec_td_50p", weight: -1 },
    ]);
    expect(distanceKeys("rec_td", 40, 59)).toBeNull();
    expect(distanceKeys("rec_td", 80, undefined)).toBeNull();
  });

  it("maps FG ranges that are unions of Sleeper's buckets", () => {
    expect(distanceKeys("fgm", 40, 49)).toEqual([{ key: "fgm_40_49", weight: 1 }]);
    expect(distanceKeys("fgm", 50, undefined)).toEqual([{ key: "fgm_50p", weight: 1 }]);
    expect(distanceKeys("fgm", 30, 49)?.map((b) => b.key)).toEqual(["fgm_30_39", "fgm_40_49"]);
    expect(distanceKeys("fgm", 41, 43)).toBeNull();
    expect(distanceKeys("fgmiss", undefined, 30)).toBeNull(); // 0–30 splits the 30–39 bucket
  });
});

describe("convertRules", () => {
  it("per-unit rules for all positions go to perStat, once per key even when classes share it", () => {
    const { scoring, mappings } = convertRules(group(rule(44, "Receiving TD", { pts: 6, forEvery: 1, applyTo: ALL, applyToAll: true }), rule(3, "Passing Yard", { pts: 1, forEvery: 25, applyTo: ALL, applyToAll: true })));
    expect(scoring.perStat).toEqual({ rec_td: 6, pass_yd: 0.04 });
    expect(mappings.map((m) => m.status)).toEqual(["per-unit", "per-unit"]);
  });

  it("position subsets become byPosition replacement rates (TE targets vs RB/WR targets)", () => {
    const { scoring } = convertRules(group(rule(123, "Target", { pts: 1, forEvery: 1, applyTo: ["TE"] }), rule(123, "Target", { pts: 1, forEvery: 3, applyTo: ["RB", "WR"] })));
    expect(scoring.perStat.rec_tgt).toBeUndefined();
    expect(scoring.byPosition.TE?.rec_tgt).toBe(1);
    expect(scoring.byPosition.RB?.rec_tgt).toBeCloseTo(0.333333, 6);
    expect(scoring.byPosition.WR?.rec_tgt).toBeCloseTo(0.333333, 6);
  });

  it("a TE premium on top of an all-position reception rate replaces the rate for TE", () => {
    const { scoring } = convertRules(group(rule(41, "Catch", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ALL }), rule(41, "Catch", { pts: 1, forEvery: 2, applyTo: ["TE"] })));
    expect(scoring.perStat.rec).toBe(1);
    expect(scoring.byPosition.TE?.rec).toBe(1.5);
  });

  it("defensive stats use idp_ keys for IDP and team keys for D/ST", () => {
    const { scoring } = convertRules(group(rule(85, "Sack", { pts: 2, forEvery: 1, applyToAll: true, applyTo: ALL }), rule(83, "Solo Tackle", { pts: 1, forEvery: 1, applyTo: ["CB", "S", "EDR", "IL", "LB"] })));
    expect(scoring.perStat).toEqual({ idp_sack: 2, sack: 2 });
    expect(scoring.byPosition.DB?.idp_tkl_solo).toBe(1);
    expect(scoring.byPosition.DL?.idp_tkl_solo).toBe(1);
    expect(scoring.byPosition.DEF).toBeUndefined();
  });

  it("threshold bonuses, bounded tiers and ≤-only tiers", () => {
    const { scoring, mappings } = convertRules(
      group(
        rule(21, "Rushing Attempt", { pts: 4, isBonus: true, boundLower: 20, rangeType: "RANGE_LOWER_BOUND", applyToAll: true, applyTo: ALL }),
        rule(3, "Passing Yard", { pts: 2, isBonus: true, boundLower: 400, boundUpper: 499, rangeType: "RANGE_DOUBLE_BOUND", applyToAll: true, applyTo: ALL }),
        rule(94, "Point Allowed", { pts: 15, isBonus: true, rangeType: "RANGE_UPPER_BOUND", applyTo: ["D/ST"] }),
      ),
    );
    expect(mappings.map((m) => m.status)).toEqual(["bonus", "tier", "tier"]);
    expect(scoring.bonuses).toContainEqual({ stat: "rush_att", threshold: 20, points: 4, positions: ["QB", "RB", "WR", "TE", "K"] });
    expect(scoring.bonuses).toContainEqual({ stat: "pass_yd", threshold: 400, max: 499, points: 2, positions: ["QB", "RB", "WR", "TE", "K"] });
    expect(scoring.bonuses).toContainEqual({ stat: "pts_allow", threshold: -1e9, max: 0, points: 15, positions: ["DEF"] });
  });

  it("per-event distance rules map to buckets or stay unmapped", () => {
    const { scoring, mappings } = convertRules(
      group(
        rule(102, "Field Goal Made", { pts: 2, multi: true, isBonus: true, boundLower: 40, boundUpper: 49, rangeType: "RANGE_DOUBLE_BOUND", applyTo: ["K"] }),
        rule(102, "Field Goal Made", { pts: 1, multi: true, isBonus: true, boundLower: 41, boundUpper: 43, rangeType: "RANGE_DOUBLE_BOUND", applyTo: ["K"] }),
        rule(102, "Field Goal Made", { pts: 1, multi: true, forEvery: 10, boundLower: 30, rangeType: "RANGE_LOWER_BOUND", applyTo: ["K"] }),
        rule(45, "Receiving TD", { pts: 2, multi: true, isBonus: true, boundLower: 40, boundUpper: 59, rangeType: "RANGE_DOUBLE_BOUND", applyToAll: true, applyTo: ALL }),
      ),
    );
    expect(mappings.map((m) => m.status)).toEqual(["distance", "unmapped", "distance", "unmapped"]);
    expect(scoring.byPosition.K).toEqual({ fgm_40_49: 2, fgm_yds_over_30: 0.1 });
    expect(scoring.unmapped.map((u) => u.platformKey)).toEqual(["102:X", "45:X"]);
  });

  it("reports unknown ids, renamed categories, inactive rules and punter-only rules", () => {
    const { mappings, scoring } = convertRules(
      group(
        rule(999, "Mystery", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ALL }),
        rule(5, "Something Else", { pts: 6, forEvery: 1, applyToAll: true, applyTo: ALL }),
        rule(101, "Field Goal Made", { pts: 3, forEvery: 1 }),
        rule(154, "Punt Attempt", { pts: 1, forEvery: 1, applyTo: ["P"] }),
        rule(26, "Fumble", { pts: -1, forEvery: 1, applyTo: ["RB"] }),
      ),
    );
    expect(mappings.map((m) => m.status)).toEqual(["unmapped", "unmapped", "inactive", "unmapped", "per-unit"]);
    expect(mappingCounts(mappings)).toMatchObject({ unmapped: 3, inactive: 1, "per-unit": 1 });
    expect(scoring.unmapped).toHaveLength(3); // inactive rules are not "unmapped"
    expect(scoringKeys(scoring)).toEqual(["fum"]);
  });

  it("takes positions from applyTo even when applyToAll is true (live data omits D/ST when it can't start)", () => {
    const noDst = ["QB", "RB", "WR", "TE", "K", "P", "CB", "S", "EDR", "IL", "LB"];
    const { scoring, mappings } = convertRules(group(rule(85, "Sack", { pts: 4, forEvery: 1, applyToAll: true, applyTo: noDst })));
    expect(mappings[0]?.positions).not.toContain("DEF");
    expect(scoring.perStat).toEqual({ idp_sack: 4 }); // no team key "sack" without D/ST in applyTo
    const everyone = convertRules(group(rule(85, "Sack", { pts: 4, forEvery: 1, applyToAll: true })));
    expect(everyone.mappings[0]?.positions).toContain("DEF"); // applyToAll with no applyTo at all
    expect(everyone.scoring.perStat).toEqual({ idp_sack: 4, sack: 4 });
  });

  it("receiving first downs include TD catches (adjustment), also inside a bonus", () => {
    const rules = group(
      rule(131, "Receiving First Down", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ALL }),
      rule(131, "Receiving First Down", { pts: 1, isBonus: true, boundLower: 4, rangeType: "RANGE_LOWER_BOUND", applyToAll: true, applyTo: ALL }),
    );
    const on = convertRules(rules);
    expect(on.scoring.perStat).toMatchObject({ rec_fd: 1, rec_td: 1 });
    expect(on.scoring.bonuses[0]?.stat).toBe("rec_fd+rec_td");
    expect(on.mappings.map((m) => m.adjustments)).toEqual([["recFdIncludesRecTd"], ["recFdIncludesRecTd"]]);
    expect(scoringKeys(on.scoring)).toEqual(["rec_fd", "rec_td"]);
    const off = convertRules(rules, { disable: ["recFdIncludesRecTd"] });
    expect(off.scoring.perStat).toEqual({ rec_fd: 1 });
    expect(off.scoring.bonuses[0]?.stat).toBe("rec_fd");
    expect(off.mappings.every((m) => m.adjustments.length === 0)).toBe(true);
  });

  it("special-teams plays count for every position in applyTo (adjustment); assisted tackles stay partial", () => {
    const rules = group(rule(83, "Solo Tackle", { pts: 2, forEvery: 1, applyToAll: true, applyTo: ALL }), rule(82, "Assisted Tackle", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ALL }));
    const on = convertRules(rules);
    expect(on.scoring.perStat).toEqual({ st_tkl_solo: 2, idp_tkl_solo: 2, tkl_solo: 2, idp_tkl_ast: 1, tkl_ast: 1 });
    expect(on.mappings.map((m) => m.status)).toEqual(["per-unit", "partial"]);
    const off = convertRules(rules, { disable: ["specialTeamsPlays"] });
    expect(off.scoring.perStat).toEqual({ idp_tkl_solo: 2, tkl_solo: 2, idp_tkl_ast: 1, tkl_ast: 1 });
    const own = convertRules(group(rule(87, "Fumble Recovered", { pts: 4, forEvery: 1, applyToAll: true, applyTo: ["QB", "RB", "CB"] })));
    expect(own.mappings[0]?.status).toBe("partial"); // an offensive player's own recovery has no Sleeper key
    expect(own.scoring.perStat).toEqual({ st_fum_rec: 4, idp_fum_rec: 4 });
    // idp_ff already includes special-teams forced fumbles: offense reads idp_ff, st_ff is never added.
    const ff = convertRules(group(rule(86, "Fumble Forced", { pts: 3, forEvery: 1, applyToAll: true, applyTo: ["WR", "LB"] })));
    expect(ff.scoring.perStat).toEqual({ idp_ff: 3 });
    expect(ff.mappings[0]?.adjustments).toEqual(["specialTeamsPlays"]);
  });

  it("a punter-only tier that includes 0 is a per-game constant for QB/K (adjustment); otherwise unmapped", () => {
    const tier = rule(161, "Yard on Returned Punt", { pts: 2, isBonus: true, boundUpper: 5, rangeType: "RANGE_UPPER_BOUND", applyTo: ["QB", "K", "P"] });
    const on = convertRules(group(tier));
    expect(on.mappings[0]).toMatchObject({ status: "tier", keys: ["gp"], adjustments: ["punterOnlyZeroTier"], droppedPositions: ["P"] });
    expect(on.scoring.bonuses).toEqual([{ stat: "gp", threshold: 1, points: 2, positions: ["QB", "K"] }]);
    const off = convertRules(group(tier), { disable: ["punterOnlyZeroTier"] });
    expect(off.mappings[0]?.status).toBe("unmapped");
    const never = convertRules(group(rule(161, "Yard on Returned Punt", { pts: 2, isBonus: true, boundLower: 50, rangeType: "RANGE_LOWER_BOUND", applyTo: ["QB", "K"] })));
    expect(never.mappings[0]?.status).toBe("inactive"); // 0 is never ≥ 50
    expect(never.scoring.bonuses).toEqual([]);
  });

  it("maps the categories added from other public leagues (81, 107, 128) and names the rest", () => {
    const { mappings, scoring } = convertRules(
      group(
        rule(81, "Total Tackle", { pts: 1, forEvery: 2, applyTo: ["LB", "D/ST"] }),
        rule(107, "Field Goal Attempt", { pts: 3, forEvery: 6, applyTo: ["K"] }),
        rule(128, "Interception Return Yard", { pts: 1, forEvery: 10, applyTo: ["CB", "D/ST"] }),
        rule(99, "Fumble Return TD", { pts: 6, forEvery: 1, applyTo: ["D/ST"] }),
      ),
    );
    expect(scoring.byPosition.LB).toMatchObject({ idp_tkl: 0.5, st_tkl_solo: 0.5 });
    expect(scoring.byPosition.DEF).toMatchObject({ tkl: 0.5, int_ret_yd: 0.1 });
    expect(scoring.byPosition.K).toEqual({ fga: 0.5 });
    expect(scoring.byPosition.DB).toEqual({ idp_int_ret_yd: 0.1 });
    expect(mappings[3]?.notes.at(-1)).toMatch(/combined idp_def_td/);
  });

  it("maps kick + punt return TDs to Sleeper's merged st_td / def_st_td only when both score the same", () => {
    const both = convertRules(group(rule(63, "Kick Return TD", { pts: 6, forEvery: 1, applyTo: ["RB", "WR", "D/ST"] }), rule(67, "Punt Return TD", { pts: 6, forEvery: 1, applyTo: ["WR", "RB", "D/ST"] })));
    expect(both.mappings.map((m) => m.status)).toEqual(["per-unit", "per-unit"]);
    expect(both.scoring.byPosition).toEqual({ RB: { st_td: 6 }, WR: { st_td: 6 }, DEF: { def_st_td: 6 } }); // added once, not 12

    const onlyKr = convertRules(group(rule(63, "Kick Return TD", { pts: 6, forEvery: 1, applyTo: ["WR"] })));
    expect(onlyKr.mappings[0]?.status).toBe("unmapped");

    const differ = convertRules(group(rule(63, "Kick Return TD", { pts: 6, forEvery: 1, applyTo: ["WR"] }), rule(67, "Punt Return TD", { pts: 4, forEvery: 1, applyTo: ["WR"] })));
    expect(differ.mappings.map((m) => m.status)).toEqual(["unmapped", "unmapped"]);
    expect(differ.scoring.byPosition).toEqual({});
  });
});
