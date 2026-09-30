import { describe, expect, it } from "vitest";
import { LeagueImportError } from "@/adapters/types";
import type { Pos, StatLine } from "@/engine/model";
import { actualPoints, expectedPoints, rateFor } from "@/engine/scoring";
import { mapPos } from "./positions";
import type { FfRule } from "./schema";
import { convertFleaflickerRules, distanceKeys, fleaflickerRulesToScoring, ruleBounds, ruleRate } from "./scoringMap";

const ALL = ["QB", "RB", "WR", "TE", "K", "P", "D/ST", "CB", "S", "EDR", "IL", "LB"];

function rule(id: number, name: string, extra: Partial<FfRule> & { pts: number; multi?: boolean }): FfRule {
  const { pts, multi, ...rest } = extra;
  return { category: { id, nameSingular: name, abbreviation: "X", ...(multi ? { multiValue: true } : {}) }, points: { value: pts, formatted: String(pts) }, ...rest };
}
const group = (...scoringRules: FfRule[]) => [{ label: "G", scoringRules }];
const score = (rules: FfRule[], pos: Pos, stats: StatLine) => actualPoints({ gp: 1, ...stats }, pos, convertFleaflickerRules(group(...rules)).scoring);

describe("Fleaflicker rule helpers", () => {
  it("uses rangeType to know which bounds exist (proto3 omits a bound of 0)", () => {
    expect(ruleBounds(rule(94, "Point Allowed", { pts: 15, isBonus: true, rangeType: "RANGE_UPPER_BOUND" }))).toEqual({ hi: 0 });
    expect(ruleBounds(rule(95, "Net Yard Allowed", { pts: 10, isBonus: true, boundUpper: 125, rangeType: "RANGE_DOUBLE_BOUND" }))).toEqual({ lo: 0, hi: 125 });
    expect(ruleBounds(rule(3, "Passing Yard", { pts: 5, isBonus: true, boundLower: 500, rangeType: "RANGE_LOWER_BOUND" }))).toEqual({ lo: 500 });
    expect(ruleBounds(rule(3, "Passing Yard", { pts: 1, forEvery: 20 }))).toEqual({ lo: undefined, hi: undefined });
  });

  it("rate is points / forEvery (pointsPer is a float32 display copy)", () => {
    expect(ruleRate(rule(123, "Target", { pts: 1, forEvery: 3, pointsPer: { value: 0.33333334 } } as Partial<FfRule> & { pts: number }))).toBeCloseTo(1 / 3, 12);
    expect(ruleRate(rule(5, "Passing TD", { pts: 6 }))).toBe(6);
  });

  it("maps TD length bands only onto Sleeper's 40+/50+ counts, FG bands onto whole buckets", () => {
    expect(distanceKeys("rec_td", 40, undefined)).toEqual([{ key: "rec_td_40p", weight: 1 }]);
    expect(distanceKeys("rec_td", 40, 49)).toEqual([
      { key: "rec_td_40p", weight: 1 },
      { key: "rec_td_50p", weight: -1 },
    ]);
    expect(distanceKeys("rec_td", 40, 59)).toBeNull();
    expect(distanceKeys("fgm", 40, 49)).toEqual([{ key: "fgm_40_49", weight: 1 }]);
    expect(distanceKeys("fgm", 30, 49)?.map((b) => b.key)).toEqual(["fgm_30_39", "fgm_40_49"]);
    expect(distanceKeys("fgm", 41, 43)).toBeNull();
    expect(distanceKeys("fgmiss", undefined, 30)).toBeNull(); // 0–30 splits the 30–39 bucket
  });

  it("maps positions, including punters (P) and Fleaflicker's IDP labels", () => {
    expect(["P", "EDR", "IL", "CB", "S", "D/ST", "WR/CB", "XX"].map(mapPos)).toEqual(["P", "DL", "DL", "DB", "DB", "DEF", "WR", null]);
  });
});

describe("FetchLeagueRules → Scoring", () => {
  it("per-unit rules for all positions go to perStat once per key; subsets are byPosition replacement rates", () => {
    const { scoring } = convertFleaflickerRules(group(rule(44, "Receiving TD", { pts: 6, forEvery: 1, applyTo: ALL, applyToAll: true }), rule(3, "Passing Yard", { pts: 1, forEvery: 25, applyTo: ALL, applyToAll: true }), rule(123, "Target", { pts: 1, forEvery: 1, applyTo: ["TE"] }), rule(123, "Target", { pts: 1, forEvery: 3, applyTo: ["RB", "WR"] })));
    expect(scoring.perStat).toEqual({ rec_td: 6, pass_yd: 0.04 });
    expect(rateFor(scoring, "rec_tgt", "TE")).toBe(1);
    expect(rateFor(scoring, "rec_tgt", "WR")).toBeCloseTo(0.333333, 6);
    expect(rateFor(scoring, "rec_tgt", "QB")).toBe(0);
  });

  it("a TE premium on top of an all-position reception rate replaces the rate for TE", () => {
    const { scoring } = convertFleaflickerRules(group(rule(41, "Catch", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ALL }), rule(41, "Catch", { pts: 1, forEvery: 2, applyTo: ["TE"] })));
    expect(scoring.perStat.rec).toBe(1);
    expect(scoring.byPosition?.TE?.rec).toBe(1.5);
  });

  it("defensive stats use idp_ keys for players (IDP and offense alike) and team keys for D/ST", () => {
    const { scoring } = convertFleaflickerRules(group(rule(85, "Sack", { pts: 2, forEvery: 1, applyToAll: true, applyTo: ALL }), rule(84, "Interception", { pts: 3, forEvery: 1, applyTo: ["CB", "S", "WR"] })));
    expect(scoring.perStat).toEqual({ idp_sack: 2, sack: 2 });
    expect(rateFor(scoring, "idp_int", "DB")).toBe(3);
    expect(rateFor(scoring, "idp_int", "WR")).toBe(3); // a two-way player's interception
    expect(rateFor(scoring, "int", "DEF")).toBe(0);
  });

  it("bonuses become threshold rules; bounded and ≤-only tiers become range rules", () => {
    const { scoring, mappings } = convertFleaflickerRules(
      group(
        rule(21, "Rushing Attempt", { pts: 4, isBonus: true, boundLower: 20, rangeType: "RANGE_LOWER_BOUND", applyToAll: true, applyTo: ["QB", "RB"] }),
        rule(3, "Passing Yard", { pts: 2, isBonus: true, boundLower: 400, boundUpper: 499, rangeType: "RANGE_DOUBLE_BOUND", applyToAll: true, applyTo: ["QB", "RB"] }),
        rule(94, "Point Allowed", { pts: 15, isBonus: true, rangeType: "RANGE_UPPER_BOUND", applyTo: ["D/ST"] }),
      ),
    );
    expect(mappings.map((m) => m.kinds)).toEqual([["threshold"], ["range"], ["range"]]);
    expect(scoring.rules).toEqual([
      { kind: "threshold", stat: "rush_att", min: 20, points: 4, positions: ["QB", "RB"] },
      { kind: "range", stat: "pass_yd", min: 400, max: 499, points: 2, positions: ["QB", "RB"] },
      { kind: "range", stat: "pts_allow", max: 0, points: 15, positions: ["DEF"] },
    ]);
    const rules = [rule(3, "Passing Yard", { pts: 2, isBonus: true, boundLower: 400, boundUpper: 499, rangeType: "RANGE_DOUBLE_BOUND", applyTo: ["QB"] })];
    expect([399, 400, 499, 500].map((y) => score(rules, "QB", { pass_yd: y }))).toEqual([0, 2, 2, 0]);
  });

  it("per-event distance rules map to Sleeper's keys or stay unmapped with their points", () => {
    const { scoring, mappings } = convertFleaflickerRules(
      group(
        rule(102, "Field Goal Made", { pts: 2, multi: true, isBonus: true, boundLower: 40, boundUpper: 49, rangeType: "RANGE_DOUBLE_BOUND", applyTo: ["K"] }),
        rule(102, "Field Goal Made", { pts: 1, multi: true, isBonus: true, boundLower: 41, boundUpper: 43, rangeType: "RANGE_DOUBLE_BOUND", applyTo: ["K"] }),
        rule(102, "Field Goal Made", { pts: 1, multi: true, forEvery: 10, boundLower: 30, rangeType: "RANGE_LOWER_BOUND", applyTo: ["K"] }),
        rule(45, "Receiving TD", { pts: 2, multi: true, isBonus: true, boundLower: 40, boundUpper: 59, rangeType: "RANGE_DOUBLE_BOUND", applyToAll: true, applyTo: ALL }),
      ),
    );
    expect(mappings.map((m) => m.status)).toEqual(["mapped", "unmapped", "mapped", "unmapped"]);
    expect(scoring.byPosition?.K).toEqual({ fgm_40_49: 2, fgm_yds_over_30: 0.1 });
    expect(scoring.unmapped.map((u) => [u.platformKey, u.points])).toEqual([
      ["102:X (Field Goal Made)", 1],
      ["45:X (Receiving TD)", 2],
    ]);
  });

  it("reports unknown ids, renamed categories, inactive rules and per-unit rules with bounds", () => {
    const { mappings, scoring, warnings } = convertFleaflickerRules(
      group(
        rule(999, "Mystery", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ALL }),
        rule(5, "Something Else", { pts: 6, forEvery: 1, applyToAll: true, applyTo: ALL }),
        rule(101, "Field Goal Made", { pts: 3, forEvery: 1 }),
        rule(22, "Rushing Yard", { pts: 1, forEvery: 10, boundLower: 100, rangeType: "RANGE_LOWER_BOUND", applyTo: ["RB"] }),
        rule(26, "Fumble", { pts: -1, forEvery: 1, applyTo: ["RB"] }),
      ),
    );
    expect(mappings.map((m) => m.status)).toEqual(["unmapped", "unmapped", "inactive", "unmapped", "mapped"]);
    expect(scoring.unmapped).toHaveLength(3); // inactive rules are not "unmapped"
    expect(warnings.filter((w) => w.code === "SCORING_RULE_UNMAPPED").map((w) => w.platformPath)).toEqual(["groups[0].scoringRules[0]", "groups[0].scoringRules[1]", "groups[0].scoringRules[3]"]);
    expect(mappings[3]?.notes.at(-1)).toMatch(/semantics are unverified/);
    expect(rateFor(scoring, "fum", "RB")).toBe(-1);
  });

  it("applyTo is authoritative even with applyToAll (live data omits D/ST when it can't start)", () => {
    const noDst = ["QB", "RB", "WR", "TE", "K", "P", "CB", "S", "EDR", "IL", "LB"];
    const { scoring, mappings } = convertFleaflickerRules(group(rule(85, "Sack", { pts: 4, forEvery: 1, applyToAll: true, applyTo: noDst })));
    expect(mappings[0]?.positions).not.toContain("DEF");
    expect(scoring.perStat).toEqual({ idp_sack: 4 }); // no team key "sack" without D/ST in applyTo
    const everyone = convertFleaflickerRules(group(rule(85, "Sack", { pts: 4, forEvery: 1, applyToAll: true })));
    expect(everyone.mappings[0]?.positions).toContain("DEF");
    expect(everyone.scoring.perStat).toEqual({ idp_sack: 4, sack: 4 });
  });

  it("receiving first downs read the composite rec_fd + rec_td (adjustment), also inside a bonus", () => {
    const rules = [rule(131, "Receiving First Down", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ["WR", "TE"] }), rule(131, "Receiving First Down", { pts: 1, isBonus: true, boundLower: 4, rangeType: "RANGE_LOWER_BOUND", applyToAll: true, applyTo: ["WR", "TE"] })];
    const on = convertFleaflickerRules(group(...rules));
    expect(on.scoring.rules).toEqual([
      { kind: "perUnit", stat: { sum: ["rec_fd", "rec_td"] }, points: 1, positions: ["WR", "TE"] },
      { kind: "threshold", stat: { sum: ["rec_fd", "rec_td"] }, min: 4, points: 1, positions: ["WR", "TE"] },
    ]);
    expect(on.scoring.perStat).toEqual({});
    expect(score(rules, "WR", { rec_fd: 3, rec_td: 1 })).toBe(5); // 4 first downs incl. the TD, + the ≥ 4 bonus
    expect(on.warnings.map((w) => w.code)).toEqual(["SCORING_DEFINITION_ADJUSTED"]);
    const off = convertFleaflickerRules(group(...rules), { disable: ["recFdIncludesRecTd"] });
    expect(off.scoring.perStat).toEqual({ rec_fd: 1 });
    expect(off.scoring.rules).toEqual([{ kind: "threshold", stat: "rec_fd", min: 4, points: 1, positions: ["WR", "TE"] }]);
  });

  it("special-teams plays count for every position (adjustment); assisted tackles and own recoveries stay partial", () => {
    const rules = group(rule(83, "Solo Tackle", { pts: 2, forEvery: 1, applyToAll: true, applyTo: ["WR", "P", "LB"] }), rule(82, "Assisted Tackle", { pts: 1, forEvery: 1, applyToAll: true, applyTo: ["WR", "LB"] }));
    const on = convertFleaflickerRules(rules);
    expect(on.scoring.rules).toEqual([{ kind: "perUnit", stat: { sum: ["idp_tkl_solo", "st_tkl_solo"] }, points: 2, positions: ["WR", "P", "LB"] }]);
    expect(on.scoring.perStat).toEqual({ idp_tkl_ast: 1 });
    expect(on.mappings.map((m) => m.status)).toEqual(["mapped", "partial"]);
    expect(on.scoring.unmapped[0]?.label).toMatch(/^\(partly mapped\) /);
    const off = convertFleaflickerRules(rules, { disable: ["specialTeamsPlays"] });
    expect(off.scoring.perStat).toEqual({ idp_tkl_solo: 2, idp_tkl_ast: 1 });
    const own = convertFleaflickerRules(group(rule(87, "Fumble Recovered", { pts: 4, forEvery: 1, applyToAll: true, applyTo: ["QB", "CB"] })));
    expect(own.mappings[0]?.status).toBe("partial"); // an offensive player's own recovery has no Sleeper key
    expect(own.scoring.rules).toEqual([{ kind: "perUnit", stat: { sum: ["idp_fum_rec", "st_fum_rec"] }, points: 4, positions: ["QB", "DB"] }]);
    const ff = convertFleaflickerRules(group(rule(86, "Fumble Forced", { pts: 3, forEvery: 1, applyToAll: true, applyTo: ["WR", "LB"] })));
    expect(ff.scoring.perStat).toEqual({ idp_ff: 3 }); // idp_ff already includes special-teams forced fumbles
  });

  it("a punter-only tier that includes 0 is a per-game constant for QB/K (adjustment) and partial for P", () => {
    const tier = rule(161, "Yard on Returned Punt", { pts: 2, isBonus: true, boundUpper: 5, rangeType: "RANGE_UPPER_BOUND", applyTo: ["QB", "K", "P"] });
    const on = convertFleaflickerRules(group(tier));
    expect(on.scoring.rules).toEqual([{ kind: "perGame", points: 2, positions: ["QB", "K"] }]);
    expect(on.mappings[0]).toMatchObject({ status: "partial", kinds: ["perGame"], adjustments: ["punterOnlyZeroTier"] });
    expect(score([tier], "K", { xpm: 1 })).toBe(2);
    expect(score([tier], "K", { gp: 0 })).toBe(0);
    expect(expectedPoints({}, "QB", on.scoring)).toBe(2); // once per projected game
    const off = convertFleaflickerRules(group(tier), { disable: ["punterOnlyZeroTier"] });
    expect(off.mappings[0]?.status).toBe("unmapped");
    const never = convertFleaflickerRules(group(rule(161, "Yard on Returned Punt", { pts: 2, isBonus: true, boundLower: 50, rangeType: "RANGE_LOWER_BOUND", applyTo: ["QB", "K"] })));
    expect(never.mappings[0]?.status).toBe("inactive"); // 0 is never ≥ 50
    expect(never.scoring.rules).toEqual([]);
  });

  it("maps kick + punt return TDs to Sleeper's merged st_td only when both score the same", () => {
    const both = convertFleaflickerRules(group(rule(63, "Kick Return TD", { pts: 6, forEvery: 1, applyTo: ["RB", "WR", "D/ST"] }), rule(67, "Punt Return TD", { pts: 6, forEvery: 1, applyTo: ["WR", "RB", "D/ST"] })));
    expect(both.mappings.map((m) => m.status)).toEqual(["mapped", "mapped"]);
    expect(both.scoring.byPosition).toEqual({ RB: { st_td: 6 }, WR: { st_td: 6 }, DEF: { def_st_td: 6 } }); // added once, not 12
    const differ = convertFleaflickerRules(group(rule(63, "Kick Return TD", { pts: 6, forEvery: 1, applyTo: ["WR"] }), rule(67, "Punt Return TD", { pts: 4, forEvery: 1, applyTo: ["WR"] })));
    expect(differ.mappings.map((m) => m.status)).toEqual(["unmapped", "unmapped"]);
  });

  it("notes rules that name only some of the labels a model position merges", () => {
    const { warnings } = convertFleaflickerRules(group(rule(85, "Sack", { pts: 2, forEvery: 1, applyTo: ["EDR", "LB"] })));
    expect(warnings).toEqual([{ code: "SCORING_POSITIONS_MERGED", message: "A scoring rule applies to EDR but not IL; the model's DL can't tell them apart." }]);
  });

  it("validates the body at the boundary: a missing category id is a BAD_RESPONSE naming the path", () => {
    const bad = { groups: [{ label: "Passing", scoringRules: [{ category: { nameSingular: "Passing Yard" }, points: { value: 1 } }] }] };
    expect(() => fleaflickerRulesToScoring(bad)).toThrow(LeagueImportError);
    try {
      fleaflickerRulesToScoring(bad);
    } catch (err) {
      expect(err).toMatchObject({ code: "BAD_RESPONSE", detail: { platform: "fleaflicker", path: "groups[0].scoringRules[0].category.id" } });
    }
    const empty = fleaflickerRulesToScoring({ rosterPositions: [] }); // proto3: no groups
    expect(empty.scoring).toEqual({ perStat: {}, byPosition: {}, rules: [], unmapped: [] });
    expect(empty.warnings.map((w) => w.code)).toEqual(["SCORING_EMPTY"]);
  });
});
