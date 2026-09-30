import { describe, expect, it } from "vitest";
import { config } from "./config";
import { floorLocation } from "./distributions";
import type { Scoring, ScoringRule, StatExpr } from "./model";
import {
  actualPoints,
  expectedPoints,
  expectedRulePoints,
  isYardageKey,
  normalCdf,
  normalPdf,
  pointsBreakdown,
  rateFor,
  ruleApplies,
  rulePoints,
  scoringStatKeys,
  statDistribution,
  statGrid,
  statSd,
  statValue,
  yardageSd,
} from "./scoring";

const base: Scoring = {
  perStat: { pass_yd: 0.04, pass_td: 4, rec: 0.5, rec_yd: 0.1, rush_yd: 0.1, fum_lost: -2 },
  byPosition: { TE: { rec: 1.5 } },
  rules: [],
  unmapped: [],
};
const withRules = (rules: ScoringRule[]): Scoring => ({ ...base, rules });

describe("actualPoints", () => {
  it("sums per-unit rates and lets byPosition REPLACE the base rate", () => {
    const line = { gp: 1, rec: 5, rec_yd: 60 };
    expect(actualPoints(line, "WR", base)).toBeCloseTo(5 * 0.5 + 6, 10);
    expect(actualPoints(line, "TE", base)).toBeCloseTo(5 * 1.5 + 6, 10); // replaced, not 0.5 + 1.5
  });

  it("threshold: stat ≥ min", () => {
    const s = withRules([{ kind: "threshold", stat: "rush_yd", min: 100, points: 3 }]);
    expect(actualPoints({ gp: 1, rush_yd: 99 }, "RB", s)).toBeCloseTo(9.9, 10);
    expect(actualPoints({ gp: 1, rush_yd: 100 }, "RB", s)).toBeCloseTo(13, 10);
  });

  it("range: inclusive buckets, open ends allowed", () => {
    const s = withRules([
      { kind: "range", stat: "pts_allow", min: 14, max: 17, points: 1, positions: ["DEF"] },
      { kind: "range", stat: "pts_allow", min: 46, points: -7, positions: ["DEF"] },
      { kind: "range", stat: "pts_allow", max: 0, points: 5, positions: ["DEF"] },
    ]);
    expect([13, 14, 17, 18].map((v) => actualPoints({ gp: 1, pts_allow: v }, "DEF", s))).toEqual([0, 1, 1, 0]);
    expect(actualPoints({ gp: 1, pts_allow: 50 }, "DEF", s)).toBe(-7);
    expect(actualPoints({ gp: 1, pts_allow: 0 }, "DEF", s)).toBe(5);
    expect(actualPoints({ gp: 1, pts_allow: 14 }, "QB", s)).toBe(0); // positions filter
  });

  it("stepped: points for every N units within [min, max]", () => {
    const every25: ScoringRule = { kind: "stepped", stat: "pass_yd", every: 25, points: 1 };
    expect(rulePoints(every25, { pass_yd: 249 })).toBe(9);
    expect(rulePoints(every25, { pass_yd: 250 })).toBe(10);
    const bounded: ScoringRule = { kind: "stepped", stat: "rush_yd", every: 10, points: 1, min: 20, max: 60 };
    expect([19, 29, 30, 60, 200].map((v) => rulePoints(bounded, { rush_yd: v }))).toEqual([0, 0, 1, 4, 4]);
  });

  it("perUnit: composite stats and bounded rates", () => {
    const composite: ScoringRule = { kind: "perUnit", stat: { sum: ["rush_yd", "rec_yd"] }, points: 0.05 };
    expect(rulePoints(composite, { rush_yd: 40, rec_yd: 60 })).toBeCloseTo(5, 10);
    const bounded: ScoringRule = { kind: "perUnit", stat: "pass_yd", points: 0.02, min: 300, max: 999 };
    expect(rulePoints(bounded, { pass_yd: 299 })).toBe(0);
    expect(rulePoints(bounded, { pass_yd: 300 })).toBeCloseTo(6, 10);
  });

  it("composite threshold (e.g. first downs + receiving TDs ≥ 4)", () => {
    const rule: ScoringRule = { kind: "threshold", stat: { sum: ["rec_fd", "rec_td"] }, min: 4, points: 2 };
    expect(rulePoints(rule, { rec_fd: 3 })).toBe(0);
    expect(rulePoints(rule, { rec_fd: 3, rec_td: 1 })).toBe(2);
    expect(statValue({ rec_fd: 3, rec_td: 1 }, { sum: ["rec_fd", "rec_td"] })).toBe(4);
  });

  it("perGame: once per game played (gp); a line without gp is a game not played", () => {
    const rule: ScoringRule = { kind: "perGame", points: 2, positions: ["QB", "K"] };
    const s = withRules([rule]);
    expect(actualPoints({ gp: 1 }, "QB", s)).toBe(2);
    expect(actualPoints({ gp: 0 }, "QB", s)).toBe(0);
    expect(actualPoints({}, "K", s)).toBe(0); // Sleeper and ESPN leave gp out for players who didn't play
    expect(actualPoints({ gp: 1 }, "RB", s)).toBe(0);
  });

  it("no rule fires on the empty line of a player who didn't play (a '≤ 50%' tier or a shutout bucket)", () => {
    const s = withRules([
      { kind: "range", stat: "cmp_pct", max: 50, points: -2, positions: ["QB"] },
      { kind: "range", stat: "pts_allow", max: 0, points: 10, positions: ["DEF"] },
    ]);
    expect(actualPoints({}, "QB", s)).toBe(0);
    expect(actualPoints({}, "DEF", s)).toBe(0);
    expect(actualPoints({ gp: 1, cmp_pct: 45 }, "QB", s)).toBe(-2);
    expect(actualPoints({ gp: 1, pts_allow: 0 }, "DEF", s)).toBe(10);
    // Per-unit stats on a line still count (platforms send stats only for games played anyway).
    expect(actualPoints({ rec: 2 }, "WR", s)).toBe(1);
  });

  it("rateFor replaces the base rate per position; ruleApplies filters by position", () => {
    expect(rateFor(base, "rec", "TE")).toBe(1.5);
    expect(rateFor(base, "rec", "WR")).toBe(0.5);
    expect(rateFor(base, "sack", "WR")).toBe(0);
    expect(rateFor({ ...base, byPosition: { TE: { rec: 0 } } }, "rec", "TE")).toBe(0); // a zero override is still a replacement
    expect(ruleApplies({ kind: "perGame", points: 1, positions: ["K"] }, "K")).toBe(true);
    expect(ruleApplies({ kind: "perGame", points: 1, positions: ["K"] }, "QB")).toBe(false);
    expect(ruleApplies({ kind: "perGame", points: 1 }, "QB")).toBe(true);
  });

  it("breakdown explains every point", () => {
    const s = withRules([{ kind: "threshold", stat: "rec_yd", min: 100, points: 3 }]);
    const b = pointsBreakdown({ gp: 1, rec: 8, rec_yd: 120, fum_lost: 1 }, "WR", s);
    expect(b.total).toBeCloseTo(4 + 12 - 2 + 3, 10);
    expect(b.perStat.map((x) => x.key).sort()).toEqual(["fum_lost", "rec", "rec_yd"]);
    expect(b.rules).toEqual([{ index: 0, kind: "threshold", points: 3 }]);
  });

  it("lists the stat keys a scoring system reads", () => {
    const s = withRules([{ kind: "range", stat: "pts_allow", min: 1, max: 6, points: 4 }, { kind: "perUnit", stat: { sum: ["a", "b"] }, points: 1 }, { kind: "perGame", points: 1 }]);
    expect([...scoringStatKeys(s)].sort()).toEqual(["a", "b", "fum_lost", "pass_td", "pass_yd", "pts_allow", "rec", "rec_yd", "rush_yd"]);
  });
});

describe("expected points for projections", () => {
  it("normal CDF and PDF are accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
    expect(normalPdf(0)).toBeCloseTo(0.398942, 6);
    expect(normalPdf(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalPdf(Number.NaN)).toBe(0);
  });

  it("linear parts are exact in expectation", () => {
    expect(expectedPoints({ rec: 5.5, rec_yd: 61.2 }, "TE", base)).toBeCloseTo(5.5 * 1.5 + 6.12, 10);
  });

  it("threshold EV moves smoothly between 0 and the bonus (yardage: the measured SD model)", () => {
    const rule: ScoringRule = { kind: "threshold", stat: "rush_yd", min: 100, points: 3 };
    // Yardage is normal with SD = max(yardageSdMin, a + b × mean) from config.yardageSd, floored at 0
    // with its mean kept at the projection: P(X ≥ 99.5) = Φ((m − 99.5)/sd), m the floored location.
    for (const mu of [10, 60, 100, 400]) {
      const sd = yardageSd("rush_yd", mu);
      const m = floorLocation(mu, sd, config.scoring.yardageFloor);
      expect(expectedRulePoints(rule, { rush_yd: mu })).toBeCloseTo(3 * normalCdf((m - 99.5) / sd), 6);
    }
    expect(expectedRulePoints(rule, { rush_yd: 400 }, { ...config.scoring, statSd: { rush_yd: 20 } })).toBeGreaterThan(2.999);
    expect(expectedRulePoints(rule, { rush_yd: 10 })).toBeLessThan(0.01);
    // Mean at the threshold: P(X ≥ 99.5) ≈ 0.5 (the floor at 0 moves the wide normal a little below
    // the mean, so it can land just under 0.5).
    const atLine = expectedRulePoints(rule, { rush_yd: 100 });
    expect(atLine).toBeGreaterThan(1.45);
    expect(atLine).toBeLessThan(1.55);
  });

  it("integer range buckets tile the line (D/ST points allowed, sd 9)", () => {
    const buckets: [number | undefined, number | undefined][] = [
      [undefined, 0],
      [1, 6],
      [7, 13],
      [14, 17],
      [18, 21],
      [22, 27],
      [28, 34],
      [35, 45],
      [46, undefined],
    ];
    const rules: ScoringRule[] = buckets.map(([min, max]) => ({ kind: "range", stat: "pts_allow", min, max, points: 1 }));
    const total = rules.reduce((s, r) => s + expectedRulePoints(r, { pts_allow: 20.75 }), 0);
    expect(total).toBeCloseTo(1, 6);
    expect(config.scoring.statSd.pts_allow).toBe(9);
    // ESPN and Fleaflicker close the bottom bucket ("0 points allowed" = [0, 0]); Sleeper and MFL leave
    // it open. Points allowed can't go below 0, so both readings give the same EV and still tile.
    for (const mu of [3, 10, 14, 21]) {
      const closed = rules.map((r, i) => (i === 0 ? { ...r, min: 0 } : r));
      const sum = (rs: ScoringRule[]) => rs.reduce((s, r) => s + expectedRulePoints(r, { pts_allow: mu }), 0);
      expect(sum(closed)).toBeCloseTo(1, 6);
      expect(expectedRulePoints(closed[0] as ScoringRule, { pts_allow: mu })).toBeCloseTo(expectedRulePoints(rules[0] as ScoringRule, { pts_allow: mu }), 9);
    }
  });

  it("bounds sit between a stat's grid points: half sacks, whole counts, continuous ratios", () => {
    // MFL "1.5 points for every half sack" is linear on the half-sack grid: EV = 3 × mean exactly
    // (sacks are 0.5 × Poisson(2 × mean), so the stepped count is Poisson's mean).
    const halfSacks: ScoringRule = { kind: "stepped", stat: "idp_sack", every: 0.5, points: 1.5 };
    expect(expectedRulePoints(halfSacks, { idp_sack: 0.3 })).toBeCloseTo(0.9, 12);
    // On the half grid "≥ 1.5" and "≥ 2" are different events (Poisson on half sacks, and a normal).
    const atLeast = (min: number): ScoringRule => ({ kind: "threshold", stat: "idp_sack", min, points: 1 });
    expect(expectedRulePoints(atLeast(1.5), { idp_sack: 1 })).toBeCloseTo(0.3233236, 6); // P(N ≥ 3), N ~ Poisson(2)
    expect(expectedRulePoints(atLeast(2), { idp_sack: 1 })).toBeCloseTo(0.1428765, 6); // P(N ≥ 4)
    const cfg = { ...config.scoring, statSd: { idp_sack: 0.5 } };
    expect(expectedRulePoints(atLeast(1.5), { idp_sack: 1 }, cfg)).toBeGreaterThan(expectedRulePoints(atLeast(2), { idp_sack: 1 }, cfg) + 0.1);
    expect(expectedRulePoints(atLeast(1.5), { idp_sack: 1 }, cfg)).toBeCloseTo(1 - normalCdf((1.25 - 1) / 0.5), 6);
    // Completion percentage is continuous: "≥ 70" means X ≥ 70, with no correction.
    const cmp: ScoringRule = { kind: "threshold", stat: "cmp_pct", min: 70, points: 1 };
    expect(expectedRulePoints(cmp, { cmp_pct: 70 }, { ...config.scoring, statSd: { cmp_pct: 9 } })).toBeCloseTo(0.5, 6);
    expect(statGrid("rush_yd")).toBe(1);
    expect(statGrid({ sum: ["idp_sack", "idp_tkl"] })).toBe(0.5);
    expect(statGrid({ sum: ["cmp_pct", "pass_yd"] })).toBe(0);
  });

  it("a rule whose stats the projection doesn't carry scores 0 (no phantom shutout bonus)", () => {
    const shutout: ScoringRule = { kind: "range", stat: "pts_allow", max: 0, points: 10, positions: ["DEF"] };
    expect(expectedRulePoints(shutout, {})).toBe(0);
    expect(expectedPoints({ sack: 2.5 }, "DEF", withRules([shutout]))).toBe(0);
    expect(expectedRulePoints(shutout, { pts_allow: 3 })).toBeGreaterThan(0);
  });

  it("stepped EV approaches the floor when spread is small relative to the step", () => {
    const rule: ScoringRule = { kind: "stepped", stat: "pass_yd", every: 25, points: 1 };
    const tight = { ...config.scoring, statSd: { pass_yd: 1 } };
    expect(expectedRulePoints(rule, { pass_yd: 262 }, tight)).toBeCloseTo(10, 3);
    // With the measured spread (sd = a + b × 262, several steps wide), EV stays close to mean/every
    // minus about half a step.
    expect(statSd("pass_yd", { pass_yd: 262 })).toBeGreaterThan(25);
    const loose = expectedRulePoints(rule, { pass_yd: 262 });
    expect(loose).toBeGreaterThan(9.5);
    expect(loose).toBeLessThan(10.6);
  });

  it("bounded perUnit EV matches a numeric integral", () => {
    const rule: ScoringRule = { kind: "perUnit", stat: "pass_yd", points: 0.02, min: 300, max: 999 };
    const cfg = { ...config.scoring, statSd: { pass_yd: 60 } };
    const ev = expectedRulePoints(rule, { pass_yd: 280 }, cfg);
    // Riemann sum of 0.02·x·pdf over [299.5, 999.5].
    let numeric = 0;
    for (let x = 299.5; x < 999.5; x += 0.01) numeric += 0.02 * (x + 0.005) * (Math.exp(-0.5 * ((x + 0.005 - 280) / 60) ** 2) / (60 * Math.sqrt(2 * Math.PI))) * 0.01;
    expect(ev).toBeCloseTo(numeric, 3);
  });

  it("composite SD combines components (yardage parts: summed variance, summed floors)", () => {
    const rule: ScoringRule = { kind: "threshold", stat: { sum: ["pass_yd", "rush_yd"] }, min: 300, points: 2 };
    const proj = { pass_yd: 260, rush_yd: 40 };
    const ev = expectedRulePoints(rule, proj);
    expect(ev).toBeGreaterThan(0.9); // mean 300 at the threshold
    expect(ev).toBeLessThan(1.1);
    const d = statDistribution({ sum: ["pass_yd", "rush_yd"] }, proj);
    expect(d.family).toBe("normal");
    expect(d.sd).toBeCloseTo(Math.hypot(yardageSd("pass_yd", 260), yardageSd("rush_yd", 40)), 12);
    expect(d.floor).toBe(2 * config.scoring.yardageFloor);
    expect(statSd({ sum: ["pass_yd", "rush_yd"] }, proj)).toBeCloseTo(d.sd, 12);
    // A part the projection doesn't carry, or projects at its floor, adds no spread (as a single key there has none).
    const rushRec = { sum: ["rush_yd", "rec_yd"] };
    const lines: Record<string, number>[] = [{ rush_yd: 20 }, { rush_yd: 20, rec_yd: 0 }];
    for (const line of lines) expect(statDistribution(rushRec, line).sd).toBeCloseTo(yardageSd("rush_yd", 20), 12);
    expect(statSd("rec_yd", { rec_yd: 0 })).toBe(0);
    expect(statDistribution(rushRec, { rush_yd: 0, rec_yd: 0 }).family).toBe("point");
  });

  it("per-game constants count once per projected game; zero-spread stats are exact", () => {
    expect(expectedRulePoints({ kind: "perGame", points: 2 }, {})).toBe(2);
    expect(expectedRulePoints({ kind: "threshold", stat: "def_td", min: 1, points: 6 }, {})).toBe(0);
    // A count projected at 0 and a yardage stat at its floor have no spread: scored at the mean.
    expect(expectedRulePoints({ kind: "threshold", stat: "def_td", min: 1, points: 6 }, { def_td: 0 })).toBe(0);
    expect(expectedRulePoints({ kind: "range", stat: "pass_td", max: 0, points: -1 }, { pass_td: 0 })).toBe(-1);
    expect(statDistribution("rec_yd", { rec_yd: 0 }).family).toBe("point");
    expect(expectedRulePoints({ kind: "range", stat: "rec_yd", max: 0, points: -2 }, { rec_yd: 0 })).toBe(-2);
  });
});

describe("distributions per stat (§5; planner reply to Checkpoint 1, answer 3)", () => {
  const threshold = (stat: StatExpr, min: number, points = 1): ScoringRule => ({ kind: "threshold", stat, min, points });

  it("count stats are Poisson with exact tails: TDs, receptions, interceptions, sacks, FGs, 2-pt, fumbles", () => {
    const cases: [string, number, number, number][] = [
      ["pass_td", 1.6, 2, 0.475069],
      ["rec_td", 0.4, 2, 0.061552],
      ["pass_int", 1.8, 3, 0.269379],
      ["rec", 6, 10, 0.083924],
      ["pass_cmp", 22, 25, 0.288281],
    ];
    for (const [stat, mean, k, want] of cases) {
      expect(statDistribution(stat, { [stat]: mean }).family).toBe("poisson");
      expect({ stat, ev: Math.round(expectedRulePoints(threshold(stat, k), { [stat]: mean }) * 1e6) / 1e6 }).toEqual({ stat, ev: want });
    }
    for (const stat of ["fgm", "pass_2pt", "fum_lost", "idp_sack", "sack", "int", "rush_att", "idp_tkl", "rec_fd"]) expect({ stat, family: statDistribution(stat, { [stat]: 1.2 }).family }).toEqual({ stat, family: "poisson" });
  });

  it('a "2+ TD" bonus gets its true expected value instead of about 0', () => {
    const twoPlus = threshold("pass_td", 2, 3);
    expect(expectedRulePoints(twoPlus, { pass_td: 0.8 })).toBeCloseTo(3 * 0.191208, 6);
    // In a whole line: linear TD points are exact, the bonus adds P(X ≥ 2) × 3.
    const s = withRules([twoPlus]);
    expect(expectedPoints({ pass_td: 0.8 }, "QB", s)).toBeCloseTo(0.8 * 4 + 3 * 0.191208, 6);
    // The old flat SD (0.5 × mean = 0.4) put "≥ 1.5" 1.75 SDs out: ≈ 0.04 × 3.
    expect(3 * (1 - normalCdf((1.5 - 0.8) / 0.4))).toBeLessThan(0.13);
  });

  it("bounded per-unit on a count is the Poisson partial mean", () => {
    const rule: ScoringRule = { kind: "perUnit", stat: "rec", points: 0.5, min: 3, max: 6 };
    // E[X · 1{3 ≤ X ≤ 6}] for X ~ Poisson(4) = Σ_{n=3..6} n·p(n) = 2.774209.
    expect(expectedRulePoints(rule, { rec: 4 })).toBeCloseTo(0.5 * 2.7742088, 6);
    expect(expectedRulePoints({ ...rule, min: undefined, max: undefined }, { rec: 4 })).toBe(2); // unbounded: linear
  });

  it("a composite of counts is Poisson of the summed mean (exact for independent counts)", () => {
    const sum = { sum: ["rush_td", "rec_td"] };
    const proj = { rush_td: 0.5, rec_td: 0.3 };
    const d = statDistribution(sum, proj);
    expect(d.family).toBe("poisson");
    expect(d.mean).toBeCloseTo(0.8, 12);
    expect(expectedRulePoints(threshold(sum, 2), proj)).toBeCloseTo(expectedRulePoints(threshold("pass_td", 2), { pass_td: 0.8 }), 12);
    // A part the projection lacks counts as 0; a composite with no part projected scores 0.
    expect(expectedRulePoints(threshold(sum, 1), { rush_td: 0.5 })).toBeCloseTo(1 - Math.exp(-0.5), 12);
    expect(expectedRulePoints(threshold(sum, 1), { pass_td: 2 })).toBe(0);
  });

  it("count range buckets tile the line: expected points sum to 1 at any mean", () => {
    const buckets: [number | undefined, number | undefined][] = [[undefined, 0], [1, 2], [3, 5], [6, 9], [10, undefined]];
    const rules: ScoringRule[] = buckets.map(([min, max]) => ({ kind: "range", stat: "rec", min, max, points: 1 }));
    for (const mu of [0.2, 1, 4.5, 9, 30]) expect(rules.reduce((s, r) => s + expectedRulePoints(r, { rec: mu }), 0)).toBeCloseTo(1, 12);
    // A stepped rule with every = 1 counts every unit: EV = mean exactly.
    expect(expectedRulePoints({ kind: "stepped", stat: "rec", every: 1, points: 1 }, { rec: 4.5 })).toBeCloseTo(4.5, 12);
    // …and every 2: E[floor(X / 2)] = Σ_k P(X ≥ 2k).
    let want = 0;
    for (let k = 1; k < 40; k++) want += expectedRulePoints(threshold("rec", 2 * k), { rec: 4.5 });
    expect(expectedRulePoints({ kind: "stepped", stat: "rec", every: 2, points: 1 }, { rec: 4.5 })).toBeCloseTo(want, 12);
  });

  it("yardage is floored at 0: the mass below counts in the lowest bucket, and the partial mean keeps the projection", () => {
    // A wide model (SD 9 at 5 yards), as measured for low projections, makes the floor matter.
    const cfg = { ...config.scoring, yardageSd: { default: { a: 8, b: 0.2 } } };
    const d = statDistribution("rush_yd", { rush_yd: 5 }, cfg);
    expect(d.family).toBe("normal");
    expect(d.sd).toBeCloseTo(9, 12);
    expect(d.floor).toBe(config.scoring.yardageFloor);
    expect(d.cdf(-1)).toBe(0);
    // MFL "rushing yards 0–999 × 0.1" (a bounded per-unit rule): exact in expectation, not inflated by
    // the floor (a normal floored at the projection itself would average 6.6 yards here).
    const perYard: ScoringRule = { kind: "perUnit", stat: "rush_yd", points: 0.1, min: 0, max: 999 };
    expect(5 * normalCdf(5 / 9) + 9 * normalPdf(5 / 9)).toBeCloseTo(6.6, 1);
    expect(expectedRulePoints(perYard, { rush_yd: 5 }, cfg)).toBeCloseTo(0.5, 9);
    expect(expectedRulePoints({ ...perYard, min: -30 }, { rush_yd: 5 }, cfg)).toBeCloseTo(0.5, 9);
    // A "≤ 0 yards" bucket gets the floor's mass (P(X ≤ 0.5) under the shifted normal); "1+" gets the rest.
    const none: ScoringRule = { kind: "range", stat: "rush_yd", max: 0, points: 1 };
    const some: ScoringRule = { kind: "range", stat: "rush_yd", min: 1, points: 1 };
    const pNone = expectedRulePoints(none, { rush_yd: 5 }, cfg);
    expect(pNone).toBeCloseTo(normalCdf((0.5 - floorLocation(5, 9, 0)) / 9), 12);
    expect(pNone).toBeGreaterThan(0.3);
    for (const c of [cfg, config.scoring]) {
      expect(expectedRulePoints(none, { rush_yd: 5 }, c) + expectedRulePoints(some, { rush_yd: 5 }, c)).toBeCloseTo(1, 12);
      expect(expectedRulePoints({ kind: "range", stat: "rush_yd", max: -1, points: 1 }, { rush_yd: 5 }, c)).toBe(0);
      expect(expectedRulePoints(perYard, { rush_yd: 40 }, c)).toBeCloseTo(4, 6);
    }
  });

  it("the yardage SD model is max(yardageSdMin, a + b × mean), per stat with a default", () => {
    const { yardageSd: fits, yardageSdMin } = config.scoring;
    for (const stat of ["pass_yd", "rush_yd", "rec_yd"]) {
      const fit = fits[stat] ?? fits.default;
      expect(fit).toBeDefined();
      for (const mu of [0, 5, 40, 250]) expect(yardageSd(stat, mu)).toBeCloseTo(Math.max(yardageSdMin, (fit?.a ?? 0) + (fit?.b ?? 0) * mu), 12);
      expect(statSd(stat, { [stat]: 60 })).toBeCloseTo(yardageSd(stat, 60), 12);
    }
    // A stat without its own fit uses the default; the minimum binds for a tiny model.
    const cfg = { ...config.scoring, yardageSd: { default: { a: 2, b: 0.25 }, rec_yd: { a: 0, b: 0.01 } } };
    expect(yardageSd("kr_yd", 20, cfg)).toBeCloseTo(7, 12);
    expect(yardageSd("rec_yd", 50, cfg)).toBe(yardageSdMin);
    expect(yardageSd("rec_yd", -4, cfg)).toBe(yardageSdMin); // a negative projection uses the SD at 0
  });

  it("family order: statSd first, then yardage (never bonus_* keys), then Poisson", () => {
    // yds_allow matches the yardage pattern but has a fixed SD.
    expect(isYardageKey("yds_allow")).toBe(true);
    for (const mu of [150, 330, 480]) expect(statSd("yds_allow", { yds_allow: mu })).toBe(config.scoring.statSd.yds_allow);
    expect(statDistribution("yds_allow", { yds_allow: 330 }).floor).toBe(0);
    expect(statSd("pts_allow", { pts_allow: 21 })).toBe(9);
    // bonus_* keys are indicators, never yardage: a 0/1 flag's mean is a probability, a count.
    for (const k of ["bonus_rec_yd_100", "bonus_pass_yd_300"]) {
      expect(isYardageKey(k)).toBe(false);
      expect(statDistribution(k, { [k]: 0.2 }).family).toBe("poisson");
    }
    for (const k of ["pass_yd", "rush_yd", "rec_yd", "kr_yd", "pr_yd", "fgm_yds"]) expect({ k, yardage: isYardageKey(k) }).toEqual({ k, yardage: true });
    for (const k of ["pass_td", "rec", "rec_td", "idp_sack", "pts_allow"]) expect({ k, yardage: isYardageKey(k) }).toEqual({ k, yardage: false });
    // Half sacks: Poisson on the 0.5 grid, SD √(0.5 × mean).
    expect(statSd("idp_sack", { idp_sack: 0.8 })).toBeCloseTo(Math.sqrt(0.4), 12);
    // A continuous stat without a fixed SD can't be a count: Normal(mean, bonusCv × mean).
    const ratio = { ...config.scoring, statGrid: { ...config.scoring.statGrid, rush_ypa: 0 } };
    expect(statDistribution("rush_ypa", { rush_ypa: 4.2 }, ratio).family).toBe("normal");
    expect(statSd("rush_ypa", { rush_ypa: 4.2 }, ratio)).toBeCloseTo(config.scoring.bonusCv * 4.2, 12);
  });

  it("completion percentage is Normal with SD 10 (continuous: no grid correction)", () => {
    expect(config.scoring.statSd.cmp_pct).toBe(10);
    expect(statGrid("cmp_pct")).toBe(0);
    const d = statDistribution("cmp_pct", { cmp_pct: 65 });
    expect(d.family).toBe("normal");
    expect(d.sd).toBe(10);
    expect(expectedRulePoints(threshold("cmp_pct", 70), { cmp_pct: 65 })).toBeCloseTo(1 - normalCdf(0.5), 9);
  });

  it("a mixed composite (yardage + a count) is a moment-matched normal", () => {
    const expr = { sum: ["rec_yd", "rec"] };
    const proj = { rec_yd: 50, rec: 4 };
    const d = statDistribution(expr, proj);
    expect(d.family).toBe("normal");
    expect(d.mean).toBe(54);
    expect(d.sd).toBeCloseTo(Math.sqrt(yardageSd("rec_yd", 50) ** 2 + 4), 12); // a count adds variance = its mean
    expect(d.floor).toBe(config.scoring.yardageFloor); // yardage floor + a count's 0
    // Counts on different grids (half sacks + tackles) are matched the same way: variance Σ unit × mean.
    const idp = statDistribution({ sum: ["idp_sack", "idp_tkl"] }, { idp_sack: 0.6, idp_tkl: 5 });
    expect(idp.family).toBe("normal");
    expect(idp.sd).toBeCloseTo(Math.sqrt(0.5 * 0.6 + 5), 12);
    // A fixed-SD part without a floor (completion %) leaves the composite unfloored.
    expect(statDistribution({ sum: ["cmp_pct", "pass_td"] }, { cmp_pct: 60, pass_td: 2 }).floor).toBeUndefined();
  });
});
