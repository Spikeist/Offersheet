import { describe, expect, it } from "vitest";
import { LeagueImportError } from "@/adapters/types";
import type { Pos, ScoringRule, StatLine } from "@/engine/model";
import { POSITIONS } from "@/engine/model";
import { actualPoints, expectedPoints, rateFor } from "@/engine/scoring";
import { mflRuleValue, parseMflRules, parsePoints, parseRange, type MflRule } from "./rules";
import { MFL_EVENTS, compileMflScoring, mflRulesToScoring, translateTotalRule } from "./scoringMap";

type RuleRow = [event: string, range: string, points: string, thresholdPoints?: string];
/** Build a TYPE=rules body the way MFL shapes it ("$t" nodes; one-or-many). */
function rulesJson(groups: Array<{ positions: string; rules: RuleRow[] }>): unknown {
  return {
    rules: {
      positionRules: groups.map((g) => ({
        positions: g.positions,
        rule: g.rules.map(([event, range, points, t]) => ({ event: { $t: event }, range: { $t: range }, points: { $t: points }, ...(t ? { thresholdPoints: { $t: t } } : {}) })),
      })),
    },
  };
}
const compile = (groups: Array<{ positions: string; rules: RuleRow[] }>) => mflRulesToScoring(rulesJson(groups));
const pts = (groups: Array<{ positions: string; rules: RuleRow[] }>, pos: Pos, stats: StatLine) => actualPoints({ gp: 1, ...stats }, pos, compile(groups).scoring);
const rulesOf = (groups: Array<{ positions: string; rules: RuleRow[] }>) => compile(groups).scoring.rules;
const oneRule = (event: string, range: string, points: string, t?: string): MflRule => ({ group: 0, index: 0, path: "x", positions: ["RB"], event, ...(parseRange(range) as { lo: number; hi: number }), rangeRaw: range, pointsRaw: points, points: parsePoints(points, t), extra: {}, ...(t ? { thresholdPoints: t } : {}) });

/** Deterministic PRNG (mulberry32) for the property test. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("MFL rule parsing", () => {
  it("parses ranges and the four points formats", () => {
    expect(parseRange("-50-999")).toEqual({ lo: -50, hi: 999 });
    expect(parseRange("0.5-20.0")).toEqual({ lo: 0.5, hi: 20 });
    expect(parseRange("5")).toEqual({ lo: 5, hi: 5 });
    expect(parseRange("9-1")).toBeUndefined();
    expect(parsePoints("*.04")).toEqual({ kind: "each", n: 0.04 });
    expect(parsePoints("*-4")).toEqual({ kind: "each", n: -4 });
    expect(parsePoints("1/10")).toEqual({ kind: "every", a: 1, b: 10 });
    expect(parsePoints("-1/49", "-1")).toEqual({ kind: "formula", threshold: -1, a: -1, b: 49 });
    expect(parsePoints("6")).toEqual({ kind: "flat", n: 6 });
    expect(parsePoints("abc")).toEqual({ kind: "unknown" });
  });

  it("evaluates MFL semantics: per unit, stepped from 0, flat in range, formula", () => {
    expect(mflRuleValue(oneRule("RY", "-50-999", "*0.1"), 128)).toBeCloseTo(12.8, 10);
    expect(mflRuleValue(oneRule("RY", "1-999", "1/10"), 128)).toBe(12); // "1 point for every 10 yards" is stepped
    expect(mflRuleValue(oneRule("RY", "100-999", "5"), 99)).toBe(0);
    expect(mflRuleValue(oneRule("RY", "100-999", "5"), 100)).toBe(5);
    expect(mflRuleValue(oneRule("PY", "250-999", "2/25", "10"), 300)).toBe(14); // 10 for reaching 250, 2 per 25 beyond
  });

  it("handles one-or-many and $t nodes, and keeps unknown formats for the unmapped list", () => {
    const single = { rules: { positionRules: { positions: "QB", rule: { event: { $t: "PY" }, range: { $t: "0-999" }, points: { $t: "*.04" } } } } };
    const parsed = parseMflRules(single);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ positions: ["QB"], event: "PY", lo: 0, hi: 999, path: "rules.positionRules.rule" });
    const odd = parseMflRules(rulesJson([{ positions: "QB|RB", rules: [["PY", "abc", "??"]] }]));
    expect(odd[0]).toMatchObject({ positions: ["QB", "RB"], points: { kind: "unknown" } });
    expect(Number.isNaN(odd[0]?.lo)).toBe(true);
  });

  it("rejects a malformed body with the JSON path of the missing field", () => {
    const bad = { rules: { positionRules: [{ positions: "QB", rule: [{ event: { $t: "PY" }, range: { $t: "0-999" } }] }] } };
    expect(() => parseMflRules(bad)).toThrow(LeagueImportError);
    try {
      parseMflRules(bad);
    } catch (err) {
      expect(err).toMatchObject({ code: "BAD_RESPONSE", detail: { platform: "mfl", path: "rules.positionRules[0].rule[0].points" } });
    }
    expect(() => parseMflRules({ version: "1.0" })).toThrow(/rules\.positionRules|rules/);
    expect(() => parseMflRules({ error: { $t: "API requires logged in user" } })).toThrow(LeagueImportError);
    expect(mflRulesToScoring({ rules: { positionRules: [] } }).warnings.map((w) => w.code)).toEqual(["SCORING_EMPTY"]);
  });
});

describe("MFL rules → Scoring", () => {
  it("per-unit rules covering the whole line become plain rates; overlapping groups add up (TE premium)", () => {
    const groups = [
      { positions: "QB|RB|WR|TE", rules: [["CC", "0-99", "*1"], ["CY", "-50-999", "*.1"]] as RuleRow[] },
      { positions: "TE", rules: [["CC", "0-99", "*.5"]] as RuleRow[] },
    ];
    const s = compile(groups).scoring;
    expect(s.rules).toEqual([]);
    expect(rateFor(s, "rec", "TE")).toBe(1.5);
    expect(rateFor(s, "rec", "WR")).toBe(1);
    expect(rateFor(s, "rec_yd", "RB")).toBe(0.1);
    expect(pts(groups, "TE", { rec: 4, rec_yd: 50 })).toBeCloseTo(11, 10);
  });

  it("a per-unit rule whose range starts at 0 gives nothing for negative totals (bounded perUnit)", () => {
    const groups = [{ positions: "RB", rules: [["RY", "0-999", "*.1"]] as RuleRow[] }];
    expect(rulesOf(groups)).toEqual([{ kind: "perUnit", stat: "rush_yd", points: 0.1, min: 0, positions: ["RB"] }]);
    expect(pts(groups, "RB", { rush_yd: -4 })).toBe(0);
    expect(pts(groups, "RB", { rush_yd: 35 })).toBeCloseTo(3.5, 10);
  });

  it("a/b is stepped (floor) when the steps are coarser than the stat's grid", () => {
    const rush = [{ positions: "RB", rules: [["RY", "1-999", "1/10"]] as RuleRow[] }];
    expect(rulesOf(rush)).toEqual([{ kind: "stepped", stat: "rush_yd", every: 10, points: 1, positions: ["RB"] }]);
    expect(pts(rush, "RB", { rush_yd: 128 })).toBe(12);
    const wholeSacks = [{ positions: "LB", rules: [["SK", "0.5-20.0", "1/1"]] as RuleRow[] }]; // a point per WHOLE sack
    expect(rulesOf(wholeSacks)).toEqual([{ kind: "stepped", stat: "idp_sack", every: 1, points: 1, positions: ["LB"] }]);
    expect([0.5, 1, 1.5, 2].map((s) => pts(wholeSacks, "LB", { idp_sack: s }))).toEqual([0, 1, 1, 2]);
  });

  it("a/b that is exactly linear on the stat's grid is a per-unit rate (half sacks), so its expected value is exact", () => {
    // "1.5 for every half sack" on a stat that moves in half sacks is 3 per sack: every step lands on a
    // grid point. As a stepped rule its expected value collapsed (a DL at 0.3 projected sacks got 0.27
    // instead of 0.9; Phase 1 review ENG-1).
    const sacks = [{ positions: "DT|DE", rules: [["SK", "0.5-20.0", "1.5/0.5"]] as RuleRow[] }];
    const r = compile(sacks);
    expect(r.scoring.rules).toEqual([]);
    expect(rateFor(r.scoring, "idp_sack", "DL")).toBe(3);
    expect(r.mappings.map((m) => [m.status, m.detail])).toEqual([["mapped", "→ idp_sack ×3"]]);
    for (const s of [0, 0.5, 1, 1.5, 4]) expect(pts(sacks, "DL", { idp_sack: s })).toBeCloseTo(mflRuleValue(oneRule("SK", "0.5-20.0", "1.5/0.5"), s), 10);
    for (const [mu, want] of [[0.3, 0.9], [0.1, 0.3], [1, 3]] as const) expect(expectedPoints({ idp_sack: mu }, "DL", r.scoring)).toBeCloseTo(want, 10);
    // The committed test league's LB and CB|S rule "1/0.5" is 2 per sack.
    expect(rateFor(compile([{ positions: "LB", rules: [["SK", "0.5-20.0", "1/0.5"]] }]).scoring, "idp_sack", "LB")).toBe(2);
  });

  it("a linear a/b or formula rule that starts inside the line is a bounded per-unit rule", () => {
    const from1 = [{ positions: "LB", rules: [["SK", "1-20", "1/0.5"]] as RuleRow[] }]; // nothing for a lone half sack
    expect(rulesOf(from1)).toEqual([{ kind: "perUnit", stat: "idp_sack", points: 2, min: 1, positions: ["LB"] }]);
    expect([0.5, 1, 2.5].map((s) => pts(from1, "LB", { idp_sack: s }))).toEqual([0, 2, 5]);
    // thresholdPoints 1 on reaching 1 sack, then 1 per half sack beyond: 1 + 2·(x − 1) = 2x − 1.
    const formula = [{ positions: "LB", rules: [["SK", "1-20", "1/0.5", "1"]] as RuleRow[] }];
    const r = oneRule("SK", "1-20", "1/0.5", "1");
    expect(rulesOf(formula)).toEqual([
      { kind: "perUnit", stat: "idp_sack", points: 2, min: 1, positions: ["LB"] },
      { kind: "range", stat: "idp_sack", points: -1, min: 1, positions: ["LB"] },
    ]);
    for (const s of [0, 0.5, 1, 1.5, 3]) expect(pts(formula, "LB", { idp_sack: s })).toBeCloseTo(mflRuleValue(r, s), 10);
  });

  it("a stepped rule inside part of the line counts from 0 only in range (range + stepped + cancelling threshold)", () => {
    const groups = [{ positions: "RB", rules: [["RY", "100-199", "1/10"]] as RuleRow[] }];
    const r = oneRule("RY", "100-199", "1/10");
    for (const y of [-5, 0, 99, 100, 105, 150, 199, 200, 250]) expect(pts(groups, "RB", { rush_yd: y })).toBeCloseTo(mflRuleValue(r, y), 10);
    expect(rulesOf(groups).map((x) => x.kind).sort()).toEqual(["range", "stepped", "threshold"]);
  });

  it("flat bands become range rules that don't stack", () => {
    const groups = [{ positions: "RB", rules: [["RY", "-50-999", "*.1"], ["RY", "100-199", "3"], ["RY", "200-999", "5"]] as RuleRow[] }];
    expect(rulesOf(groups)).toEqual([
      { kind: "range", stat: "rush_yd", points: 3, min: 100, max: 199, positions: ["RB"] },
      { kind: "range", stat: "rush_yd", points: 5, min: 200, positions: ["RB"] },
    ]);
    expect(pts(groups, "RB", { rush_yd: 150 })).toBeCloseTo(18, 10);
    expect(pts(groups, "RB", { rush_yd: 250 })).toBeCloseTo(30, 10); // 25 + 5 only
  });

  it("formula rules (thresholdPoints) become range + stepped from the range low", () => {
    const groups = [{ positions: "QB", rules: [["PY", "250-999", "2/25", "10"]] as RuleRow[] }];
    const r = oneRule("PY", "250-999", "2/25", "10");
    for (const y of [0, 249, 250, 274, 275, 300, 480]) expect(pts(groups, "QB", { pass_yd: y })).toBeCloseTo(mflRuleValue(r, y), 10);
  });

  it("sums of stats use a composite stat; scaled stats (AS2 = assists ÷ 2) are rescaled", () => {
    const tys = [{ positions: "QB", rules: [["TYS", "300-999", "4"]] as RuleRow[] }];
    expect(rulesOf(tys)).toEqual([{ kind: "range", stat: { sum: ["pass_yd", "rush_yd", "rec_yd"] }, points: 4, min: 300, positions: ["QB"] }]);
    expect(pts(tys, "QB", { pass_yd: 280, rush_yd: 25 })).toBe(4);
    const fd = compile([{ positions: "WR", rules: [["FD", "0-99", "*1"]] }]).scoring;
    expect([rateFor(fd, "pass_fd", "WR"), rateFor(fd, "rush_fd", "WR"), rateFor(fd, "rec_fd", "WR")]).toEqual([1, 1, 1]);
    const as2 = compile([{ positions: "LB", rules: [["AS2", "0-99", "*1"]] }]).scoring;
    expect(rateFor(as2, "idp_tkl_ast", "LB")).toBe(0.5);
  });

  it("maps TD length rules onto Sleeper's TD and 40+/50+ keys, or reports them", () => {
    expect(rateFor(compile([{ positions: "QB", rules: [["PS", "1-39", "4"], ["PS", "40-110", "6"]] }]).scoring, "pass_td_40p", "QB")).toBe(2);
    const wr = compile([{ positions: "WR", rules: [["RC", "1-39", "6"], ["RC", "40-49", "7"], ["RC", "50-99", "8"]] }]).scoring;
    expect([rateFor(wr, "rec_td", "WR"), rateFor(wr, "rec_td_40p", "WR"), rateFor(wr, "rec_td_50p", "WR")]).toEqual([6, 1, 1]);
    const odd = compile([{ positions: "WR", rules: [["RC", "1-45", "6"], ["RC", "46-99", "8"]] }]);
    expect(odd.scoring.unmapped).toHaveLength(2);
    expect(odd.warnings.every((w) => w.code === "SCORING_RULE_UNMAPPED")).toBe(true);
  });

  it("maps field goals by distance bucket, per yard, and the formula missed-FG rule", () => {
    // Only K is scored here, so its rates are league-wide (perStat) and every other position gets 0.
    const pk = compile([{ positions: "PK", rules: [["FG", "17-39", "3"], ["FG", "40-49", "4"], ["FG", "50-110", "5"]] }]).scoring;
    expect(pk.perStat).toEqual({ fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5 });
    expect(rateFor(pk, "fgm_50p", "QB")).toBe(0);
    expect(rateFor(compile([{ positions: "PK", rules: [["FG", "0-99", "*0.1"]] }]).scoring, "fgm_yds", "K")).toBe(0.1);
    const mg = compile([{ positions: "PK", rules: [["MG", "17-49", "-1/49", "-1"], ["MG", "50-110", "0"]] }]);
    expect(mg.scoring.perStat).toEqual({ fgmiss_0_19: -1, fgmiss_20_29: -1, fgmiss_30_39: -1, fgmiss_40_49: -1 });
    expect(mg.scoring.unmapped).toEqual([]);
  });

  it("does not double-count Sleeper keys that merge several MFL events", () => {
    expect(rateFor(compile([{ positions: "LB", rules: [["#IR", "0-10", "*6"], ["#DR", "0-10", "*6"], ["BF", "1-110", "6"]] }]).scoring, "idp_def_td", "LB")).toBe(6);
    const diff = compile([{ positions: "LB", rules: [["#IR", "0-10", "*6"], ["#DR", "0-10", "*4"]] }]);
    expect(rateFor(diff.scoring, "idp_def_td", "LB")).toBe(6);
    expect(diff.warnings.map((w) => w.code)).toContain("SCORING_RULE_APPROXIMATE");
    expect(rateFor(compile([{ positions: "LB", rules: [["#D", "0-10", "*6"], ["#IR", "0-10", "*2"]] }]).scoring, "idp_def_td", "LB")).toBe(8);
    expect(rateFor(compile([{ positions: "LB", rules: [["BLF", "1-99", "*2"], ["BLP", "1-99", "*2"], ["BLE", "1-99", "*2"]] }]).scoring, "idp_blk_kick", "LB")).toBe(2);
  });

  it("reads the keys Sleeper fills for a player's return TDs, forced fumbles and recoveries (st_td, idp_ff, idp_fum_rec + st_fum_rec)", () => {
    // Phase 1 review ENG-5: the map read pr_td / kr_td / ff / fum_rec, which Sleeper never puts on a
    // player row, so this WR line scored 0 instead of MFL's 10.
    const wr = [{ positions: "WR", rules: [["#UT", "0-5", "*6"], ["#KT", "0-5", "*6"], ["FF", "0-9", "*2"], ["FC", "0-9", "*2"]] as RuleRow[] }];
    expect(pts(wr, "WR", { st_td: 1, idp_ff: 1, idp_fum_rec: 1 })).toBe(10);
    expect(pts(wr, "WR", { st_fum_rec: 1, st_ff: 1 })).toBe(2); // a special-teams recovery counts; st_ff is already inside idp_ff
    const r = compile(wr);
    expect(["pr_td", "kr_td", "ff", "fum_rec"].map((k) => rateFor(r.scoring, k, "WR"))).toEqual([0, 0, 0, 0]);
    // Both return-TD types score the same, so st_td is exact; the offensive fumble plays are flagged.
    const status = Object.fromEntries(r.mappings.map((m) => [m.event, m.status]));
    expect(status).toEqual({ "#UT": "mapped", "#KT": "mapped", FF: "approximate", FC: "approximate" });
    expect(r.warnings.filter((w) => w.code === "SCORING_RULE_APPROXIMATE")).toHaveLength(2);
  });

  it("st_td merges kickoff and punt return TDs: exact only when both are scored the same", () => {
    const onlyKick = compile([{ positions: "RB", rules: [["#KT", "0-5", "*6"]] }]);
    expect(rateFor(onlyKick.scoring, "st_td", "RB")).toBe(6);
    expect(onlyKick.mappings[0]).toMatchObject({ status: "approximate", detail: expect.stringMatching(/also counts punt return TDs/) });
    expect(onlyKick.warnings.map((w) => w.code)).toEqual(["SCORING_RULE_APPROXIMATE"]);
    const differ = compile([{ positions: "RB", rules: [["#KT", "0-5", "*6"], ["#UT", "0-5", "*4"]] }]);
    expect(rateFor(differ.scoring, "st_td", "RB")).toBe(6);
    expect(differ.mappings.every((m) => m.status === "approximate")).toBe(true);
    // A count rule and a length rule for the same play add up (MFL scores both): 6 + 2 per punt return TD.
    const both = compile([{ positions: "RB", rules: [["#UT", "0-5", "*6"], ["PR", "1-110", "2"], ["KO", "1-110", "8"]] }]);
    expect(rateFor(both.scoring, "st_td", "RB")).toBe(8);
    expect(both.mappings.every((m) => m.status === "mapped")).toBe(true);
    expect(both.warnings).toEqual([]);
  });

  it("IDP fumble recoveries include special-teams ones (MFL's FC); forced fumbles read idp_ff alone", () => {
    const lb = compile([{ positions: "LB", rules: [["FC", "1-99", "*2"], ["FF", "1-99", "*2"]] }]);
    expect(["idp_fum_rec", "st_fum_rec", "idp_ff", "st_ff"].map((k) => rateFor(lb.scoring, k, "LB"))).toEqual([2, 2, 2, 0]);
    expect(lb.warnings).toEqual([]);
    const def = compile([{ positions: "Def", rules: [["FC", "0-9", "*2"], ["FF", "0-9", "*1"]] }]);
    expect([rateFor(def.scoring, "fum_rec", "DEF"), rateFor(def.scoring, "def_st_fum_rec", "DEF"), rateFor(def.scoring, "ff", "DEF")]).toEqual([2, 2, 1]);
    expect(def.mappings.map((m) => m.status)).toEqual(["approximate", "approximate"]); // no MFL league with a team defense was checked
  });

  it("offensive length rules (TD length, FG distance) at a defensive position are unmapped: Sleeper has no key for them there", () => {
    for (const [positions, event, range, points] of [["LB", "PS", "1-110", "6"], ["Def", "FG", "17-110", "3"], ["CB|S", "RC", "40-110", "2"]] as const) {
      const r = compile([{ positions, rules: [[event, range, points]] }]);
      expect(r.scoring.unmapped.map((u) => u.platformKey), `${positions} ${event}`).toEqual([event]);
      expect(r.warnings.map((w) => w.code)).toEqual(["SCORING_RULE_UNMAPPED"]);
      expect(r.mappings[0]?.detail).toMatch(/no Sleeper key for this rule at a (defensive player|team defense) position/);
    }
  });

  it("scores team-defense points allowed with range rules on pts_allow", () => {
    const groups = [{ positions: "Def", rules: [["TPA", "0-0", "10"], ["TPA", "1-6", "7"], ["TPA", "7-13", "4"], ["TPA", "14-17", "1"], ["TPA", "35-99", "-4"], ["SK", "0-20", "*1"]] as RuleRow[] }];
    const r = compile(groups);
    expect(r.scoring.rules).toContainEqual({ kind: "range", stat: "pts_allow", points: 1, min: 14, max: 17, positions: ["DEF"] });
    expect(pts(groups, "DEF", { pts_allow: 0, sack: 3 })).toBe(13);
    expect(pts(groups, "DEF", { pts_allow: 16 })).toBe(1);
    expect(pts(groups, "DEF", { pts_allow: 20 })).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain("SCORING_RULE_APPROXIMATE"); // MFL's points allowed vs Sleeper's is unverified
  });

  it("reports unknown codes, conditional rules, unsupported positions (HC) and merged DT/DE", () => {
    const unknown = compile([{ positions: "QB", rules: [["RATE", "0-158", "*0.1"]] }]);
    expect(unknown.scoring.unmapped[0]).toMatchObject({ platformKey: "RATE", points: 0.1 });
    const conditional = mflRulesToScoring({ rules: { positionRules: { positions: "QB", rule: { event: { $t: "PY" }, range: { $t: "0-999" }, points: { $t: "*.04" }, conditionalEvent: { $t: "PA" } } } } });
    expect(conditional.mappings[0]?.detail).toMatch(/conditional/);
    const coach = compile([{ positions: "Coach", rules: [["#P", "0-9", "*1"]] }]);
    expect(coach.warnings.map((w) => w.code)).toEqual(["SCORING_POSITION_UNSUPPORTED"]);
    expect(coach.scoring.unmapped).toHaveLength(1);
    const punter = compile([{ positions: "PN", rules: [["#N", "0-20", "*0.5"], ["PI", "0-20", "*2"]] }]).scoring;
    expect([rateFor(punter, "punts", "P"), rateFor(punter, "punt_in_20", "P")]).toEqual([0.5, 2]);
    const idp = compile([
      { positions: "DT", rules: [["SK", "0.5-20", "1/0.5"]] },
      { positions: "DE", rules: [["SK", "0.5-20", "2/0.5"]] },
    ]);
    expect(idp.warnings.map((w) => w.code)).toEqual(["SCORING_POSITIONS_MERGED"]);
    expect(idp.positions.DL).toEqual(["DT", "DE"]);
    expect(rateFor(idp.scoring, "idp_sack", "DL")).toBe(4); // DE's rules win: 2 per half sack
    expect(idp.scoring.rules).toEqual([]);
  });

  it("perStat holds only rates every scored position shares; the rest are exact per position", () => {
    const groups = [
      { positions: "QB|RB", rules: [["FL", "1-99", "*-2"], ["RY", "-50-999", "*.1"]] as RuleRow[] },
      { positions: "PK", rules: [["FL", "1-99", "*-2"], ["EP", "0-10", "*1"]] as RuleRow[] },
    ];
    const s = compile(groups).scoring;
    expect(s.perStat).toEqual({ fum_lost: -2 });
    expect(rateFor(s, "rush_yd", "QB")).toBe(0.1);
    expect(rateFor(s, "rush_yd", "K")).toBe(0); // kickers' rushing isn't scored in this league
    expect(rateFor(s, "xpm", "RB")).toBe(0);
    for (const p of POSITIONS.filter((x) => !["QB", "RB", "K"].includes(x))) expect(rateFor(s, "fum_lost", p)).toBe(0); // unscored positions
  });

  it("translations reproduce MFL's semantics on the grid for random rules (property test)", () => {
    const rnd = prng(20260929);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
    let checked = 0;
    for (let t = 0; t < 400; t++) {
      const event = pick(["RY", "PY", "CC", "SK", "AS2", "TYS", "IN"]);
      const ev = MFL_EVENTS[event]!;
      const lo = pick([-50, 0, 0.5, 1, 3, 25, 100, 150, 250]);
      const hi = lo + pick([0, 1, 9, 49, 99, 999]);
      const points = pick(["*0.1", "*-1", "*2", "1/10", "3/25", "1/0.5", "2", "-3", "5", "1/3"]);
      const threshold = points.includes("/") && rnd() < 0.3 ? String(pick([1, 5, -2])) : undefined;
      const rule = oneRule(event, `${lo}-${hi}`, points, threshold);
      const keys = ev.off ?? ev.idp ?? [];
      const stat = keys.length === 1 ? (keys[0] as string) : { sum: keys };
      const tr = translateTotalRule(rule, stat, ev);
      expect(tr, `${event} ${lo}-${hi} ${points} ${threshold ?? ""}`).toBeDefined();
      const scale = ev.scale ?? 1;
      const key = typeof stat === "string" ? stat : (stat.sum[0] as string);
      for (let x = ev.min ?? 0; x <= (ev.max ?? 20); x += ev.step ?? 1) {
        const line = { gp: 1, [key]: x };
        let got = (tr?.rate ?? 0) * x;
        for (const r of tr?.rules ?? []) got += actualPoints(line, "RB", { perStat: {}, rules: [r as ScoringRule], unmapped: [] });
        expect(got).toBeCloseTo(mflRuleValue(rule, scale * x), 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("gives finite expected points for projections through every rule kind it emits", () => {
    const groups = [
      { positions: "RB", rules: [["RY", "0-999", "*.1"], ["RY", "100-199", "3"], ["RY", "200-999", "5"], ["CC", "1-99", "1/2"], ["PY", "250-999", "2/25", "10"]] as RuleRow[] },
    ];
    const s = compile(groups).scoring;
    const e = expectedPoints({ rush_yd: 85, rec: 3.5, pass_yd: 0 }, "RB", s);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeGreaterThan(8.5); // at least the per-yard part, plus some chance of the 100-yard band
  });

  it("compiles parsed rules directly as well", () => {
    const r = compileMflScoring(parseMflRules(rulesJson([{ positions: "QB", rules: [["PS", "1-110", "6"]] }])));
    expect(rateFor(r.scoring, "pass_td", "QB")).toBe(6);
    expect(r.mappings).toEqual([{ path: "rules.positionRules[0].rule[0]", rule: "QB: PS 1-110 6", event: "PS", positions: ["QB"], status: "mapped", detail: "→ pass_td 6 per TD" }]);
  });
});
