import { describe, expect, it } from "vitest";
import { config } from "./config";
import type { Scoring, ScoringRule } from "./model";
import { actualPoints, expectedPoints, expectedRulePoints, normalCdf, pointsBreakdown, rulePoints, scoringStatKeys, statValue } from "./scoring";

const base: Scoring = {
  perStat: { pass_yd: 0.04, pass_td: 4, rec: 0.5, rec_yd: 0.1, rush_yd: 0.1, fum_lost: -2 },
  byPosition: { TE: { rec: 1.5 } },
  rules: [],
  unmapped: [],
};
const withRules = (rules: ScoringRule[]): Scoring => ({ ...base, rules });

describe("actualPoints", () => {
  it("sums per-unit rates and lets byPosition REPLACE the base rate", () => {
    const line = { rec: 5, rec_yd: 60 };
    expect(actualPoints(line, "WR", base)).toBeCloseTo(5 * 0.5 + 6, 10);
    expect(actualPoints(line, "TE", base)).toBeCloseTo(5 * 1.5 + 6, 10); // replaced, not 0.5 + 1.5
  });

  it("threshold: stat ≥ min", () => {
    const s = withRules([{ kind: "threshold", stat: "rush_yd", min: 100, points: 3 }]);
    expect(actualPoints({ rush_yd: 99 }, "RB", s)).toBeCloseTo(9.9, 10);
    expect(actualPoints({ rush_yd: 100 }, "RB", s)).toBeCloseTo(13, 10);
  });

  it("range: inclusive buckets, open ends allowed", () => {
    const s = withRules([
      { kind: "range", stat: "pts_allow", min: 14, max: 17, points: 1, positions: ["DEF"] },
      { kind: "range", stat: "pts_allow", min: 46, points: -7, positions: ["DEF"] },
      { kind: "range", stat: "pts_allow", max: 0, points: 5, positions: ["DEF"] },
    ]);
    expect([13, 14, 17, 18].map((v) => actualPoints({ pts_allow: v }, "DEF", s))).toEqual([0, 1, 1, 0]);
    expect(actualPoints({ pts_allow: 50 }, "DEF", s)).toBe(-7);
    expect(actualPoints({ pts_allow: 0 }, "DEF", s)).toBe(5);
    expect(actualPoints({ pts_allow: 14 }, "QB", s)).toBe(0); // positions filter
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

  it("perGame: once per game played (gp), assumed played when gp is absent", () => {
    const rule: ScoringRule = { kind: "perGame", points: 2, positions: ["QB", "K"] };
    const s = withRules([rule]);
    expect(actualPoints({ gp: 1 }, "QB", s)).toBe(2);
    expect(actualPoints({ gp: 0 }, "QB", s)).toBe(0);
    expect(actualPoints({}, "K", s)).toBe(2);
    expect(actualPoints({ gp: 1 }, "RB", s)).toBe(0);
  });

  it("breakdown explains every point", () => {
    const s = withRules([{ kind: "threshold", stat: "rec_yd", min: 100, points: 3 }]);
    const b = pointsBreakdown({ rec: 8, rec_yd: 120, fum_lost: 1 }, "WR", s);
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
  it("normal CDF is accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
  });

  it("linear parts are exact in expectation", () => {
    expect(expectedPoints({ rec: 5.5, rec_yd: 61.2 }, "TE", base)).toBeCloseTo(5.5 * 1.5 + 6.12, 10);
  });

  it("threshold EV moves smoothly between 0 and the bonus", () => {
    const rule: ScoringRule = { kind: "threshold", stat: "rush_yd", min: 100, points: 3 };
    // Default SD = bonusCv × mean grows with the mean: at 400 yds sd = 200, so P(X ≥ 99.5) ≈ 0.934.
    expect(expectedRulePoints(rule, { rush_yd: 400 })).toBeCloseTo(3 * normalCdf((400 - 99.5) / 200), 6);
    expect(expectedRulePoints(rule, { rush_yd: 400 }, { ...config.scoring, statSd: { rush_yd: 20 } })).toBeGreaterThan(2.999);
    expect(expectedRulePoints(rule, { rush_yd: 10 })).toBeLessThan(0.01);
    const atLine = expectedRulePoints(rule, { rush_yd: 100 });
    expect(atLine).toBeGreaterThan(1.5); // mean at the threshold: ≈ P(X ≥ 99.5) with sd 50
    expect(atLine).toBeLessThan(1.6);
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
  });

  it("stepped EV approaches the floor when spread is small relative to the step", () => {
    const rule: ScoringRule = { kind: "stepped", stat: "pass_yd", every: 25, points: 1 };
    const tight = { ...config.scoring, statSd: { pass_yd: 1 } };
    expect(expectedRulePoints(rule, { pass_yd: 262 }, tight)).toBeCloseTo(10, 3);
    // With the default spread (sd = 0.5 × 262), EV stays close to mean/every minus about half a step.
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

  it("composite SD combines components", () => {
    const rule: ScoringRule = { kind: "threshold", stat: { sum: ["pass_yd", "rush_yd"] }, min: 300, points: 2 };
    const ev = expectedRulePoints(rule, { pass_yd: 260, rush_yd: 40 });
    expect(ev).toBeGreaterThan(0.9); // mean 300 at the threshold
    expect(ev).toBeLessThan(1.1);
  });

  it("per-game constants count once per projected game; zero-spread stats are exact", () => {
    expect(expectedRulePoints({ kind: "perGame", points: 2 }, {})).toBe(2);
    expect(expectedRulePoints({ kind: "threshold", stat: "def_td", min: 1, points: 6 }, {})).toBe(0);
  });
});
