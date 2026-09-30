import { describe, expect, it } from "vitest";
import { floorLocation, normalCdf, normalDist, normalPdf, pointDist, poissonCdf, poissonDist, poissonPmf, poissonTail } from "./distributions";

/** Brute-force Poisson pmf by the closed form (independent of the recurrence under test). */
function pmf(n: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let k = 1; k <= n; k++) p *= lambda / k;
  return p;
}

/** Riemann sum of E[max(X, f) · 1{lo ≤ max(X, f) ≤ hi}] for X ~ Normal(loc, sd), independent of the closed form. */
function flooredPartialMeanNumeric(loc: number, sd: number, f: number, lo: number, hi: number): number {
  let total = lo <= f && f <= hi ? f * normalCdf((f - loc) / sd) : 0;
  const start = Math.max(lo, f);
  const end = Math.min(hi, loc + 12 * sd);
  const dx = (end - start) / 200_000;
  for (let x = start + dx / 2; x < end; x += dx) total += x * (normalPdf((x - loc) / sd) / sd) * dx;
  return total;
}

describe("Poisson distribution for count stats (planner reply to Checkpoint 1, answer 3)", () => {
  it("gives exact tails P(X ≥ k) (§5: a '2+ TD' bonus gets its true expected value)", () => {
    const cases: [number, number, number][] = [
      [1.6, 2, 0.475069],
      [0.4, 2, 0.061552],
      [1.8, 3, 0.269379],
      [6, 10, 0.083924],
      [22, 25, 0.288281],
      [0.8, 2, 0.191208],
    ];
    for (const [mean, k, want] of cases) {
      expect({ mean, k, p: Math.round(poissonTail(k, mean) * 1e6) / 1e6 }).toEqual({ mean, k, p: want });
      expect(poissonDist(mean).prob(k, Number.POSITIVE_INFINITY)).toBeCloseTo(want, 6);
      // A half-grid bound reads the same event (scoring.ts puts "X ≥ k" at k − 0.5).
      expect(poissonDist(mean).prob(k - 0.5, Number.POSITIVE_INFINITY)).toBeCloseTo(want, 6);
    }
  });

  it("pmf, cdf and tail agree with the closed form and sum to 1", () => {
    for (const lambda of [0.05, 0.8, 3.3, 12, 45]) {
      let sum = 0;
      for (let n = 0; n <= 200; n++) {
        expect(poissonPmf(n, lambda)).toBeCloseTo(pmf(n, lambda), 12);
        sum += pmf(n, lambda);
        if (n % 7 === 0) expect(poissonCdf(n, lambda) + poissonTail(n + 1, lambda)).toBeCloseTo(1, 12);
      }
      expect(sum).toBeCloseTo(1, 12);
      expect(poissonCdf(-1, lambda)).toBe(0);
      expect(poissonTail(0, lambda)).toBe(1);
      expect(poissonDist(lambda).cdf(Number.POSITIVE_INFINITY)).toBe(1);
    }
    expect(poissonPmf(1.5, 2)).toBe(0);
  });

  it("partial mean E[X · 1{lo ≤ X ≤ hi}] equals the brute-force sum, on lattice and half-grid bounds", () => {
    const lambda = 4;
    const brute = (a: number, b: number) => {
      let s = 0;
      for (let n = a; n <= b; n++) s += n * pmf(n, lambda);
      return s;
    };
    const d = poissonDist(lambda);
    expect(d.partialMean(3, 6)).toBeCloseTo(brute(3, 6), 12);
    expect(d.partialMean(2.5, 6.5)).toBeCloseTo(brute(3, 6), 12);
    expect(d.partialMean(1, 3)).toBeCloseTo(brute(1, 3), 12);
    expect(d.partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeCloseTo(lambda, 12);
    expect(d.partialMean(0, 0)).toBe(0);
    expect(d.partialMean(5, 4)).toBe(0);
    // λ = 2 over [1, 3]: 10·e^−2 (checked by hand: 2e^−2 + 4e^−2 + 4e^−2).
    expect(poissonDist(2).partialMean(1, 3)).toBeCloseTo(10 * Math.exp(-2), 12);
  });

  it("lives on the stat's grid: half sacks are 0.5 × Poisson(2 × mean)", () => {
    const d = poissonDist(1, 0.5);
    expect(d.sd).toBeCloseTo(Math.sqrt(0.5), 12);
    // "≥ 1.5 sacks" = N ≥ 3 and "≥ 2 sacks" = N ≥ 4, N ~ Poisson(2): different events.
    expect(d.prob(1.25, Number.POSITIVE_INFINITY)).toBeCloseTo(1 - (pmf(0, 2) + pmf(1, 2) + pmf(2, 2)), 12);
    expect(d.prob(1.75, Number.POSITIVE_INFINITY)).toBeCloseTo(1 - (pmf(0, 2) + pmf(1, 2) + pmf(2, 2) + pmf(3, 2)), 12);
    expect(d.partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeCloseTo(1, 12);
    expect(d.cdf(1.5)).toBeCloseTo(pmf(0, 2) + pmf(1, 2) + pmf(2, 2) + pmf(3, 2), 12);
    expect(() => poissonDist(1, 0)).toThrow(/unit must be positive/);
  });

  it("a zero (or negative) mean is a point mass at 0", () => {
    for (const d of [poissonDist(0), poissonDist(-0.3)]) {
      expect(d.family).toBe("point");
      expect(d.prob(0, 0)).toBe(1);
      expect(d.prob(0.5, Number.POSITIVE_INFINITY)).toBe(0);
      expect(d.partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
    }
  });

  it("falls back to the normal above λ = 700, where e^−λ underflows", () => {
    const d = poissonDist(900);
    expect(d.family).toBe("normal");
    expect(d.sd).toBeCloseTo(30, 12);
    // Half-grid bounds are the continuity correction: P(X ≥ 900) = P(X ≥ 899.5) ≈ 0.5 + φ(0)/60.
    expect(d.prob(899.5, Number.POSITIVE_INFINITY)).toBeCloseTo(0.5 + 0.5 / (30 * Math.sqrt(2 * Math.PI)), 3);
    // Just below the switch it is still the exact lattice and matches the normal closely.
    const exact = poissonDist(690);
    expect(exact.family).toBe("poisson");
    expect(exact.prob(689.5, Number.POSITIVE_INFINITY)).toBeCloseTo(1 - normalCdf((689.5 - 690) / Math.sqrt(690)), 2);
    expect(exact.partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeCloseTo(690, 6);
  });
});

describe("normal distribution for yardage and D/ST lines (§5)", () => {
  it("normal CDF and PDF are accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
    expect(normalCdf(-5)).toBeCloseTo(2.8665e-7, 9);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(normalPdf(0)).toBeCloseTo(0.398942, 6);
    expect(normalPdf(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("without a floor is Normal(mean, sd): probabilities, the full mean and the closed-form partial mean", () => {
    const d = normalDist(60, 25);
    expect(d.family).toBe("normal");
    expect(d.prob(99.5, Number.POSITIVE_INFINITY)).toBeCloseTo(1 - normalCdf((99.5 - 60) / 25), 12);
    expect(d.prob(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(1);
    expect(d.partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeCloseTo(60, 6);
    expect(d.partialMean(40, 90)).toBeCloseTo(flooredPartialMeanNumeric(60, 25, Number.NEGATIVE_INFINITY, 40, 90), 4);
    expect(d.prob(90, 40)).toBe(0);
    expect(normalDist(5, 0).family).toBe("point");
  });

  it("with a floor puts the mass below it AT the floor and keeps the mean at the projection", () => {
    // A WR projected for 5.6 receiving yards with SD 19: floored at the projection the mean would be 10.7.
    const naive = 5.6 * normalCdf(5.6 / 19) + 19 * normalPdf(5.6 / 19);
    expect(naive).toBeCloseTo(10.7, 1);
    const d = normalDist(5.6, 19, 0);
    const loc = floorLocation(5.6, 19, 0);
    expect(loc).toBeLessThan(0); // the underlying normal sits lower…
    expect(loc * normalCdf(loc / 19) + 19 * normalPdf(loc / 19)).toBeCloseTo(5.6, 9); // …so E[max(X, 0)] = 5.6
    expect(d.partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeCloseTo(5.6, 9);
    expect(d.partialMean(0, 999.5)).toBeCloseTo(5.6, 9);
    // Nothing lies below the floor; the floor's atom counts in "≤ 0" buckets but not in "≥ 1".
    expect(d.cdf(-0.01)).toBe(0);
    expect(d.prob(Number.NEGATIVE_INFINITY, 0.5)).toBeCloseTo(normalCdf((0.5 - loc) / 19), 12);
    expect(d.prob(0, 0)).toBeCloseTo(normalCdf(-loc / 19), 12);
    expect(d.prob(0.5, Number.POSITIVE_INFINITY) + d.prob(Number.NEGATIVE_INFINITY, 0.5)).toBeCloseTo(1, 12);
    // The partial mean over a band starting at the floor matches a numeric integral.
    for (const [lo, hi] of [[Number.NEGATIVE_INFINITY, 9.5], [9.5, 29.5], [0, 0], [-30, 99.5]] as const)
      expect(d.partialMean(lo, hi)).toBeCloseTo(flooredPartialMeanNumeric(loc, 19, 0, lo, hi), 4);
    expect(d.partialMean(-5, -1)).toBe(0);
  });

  it("floorLocation solves E[max(X, f)] = mean, is the projection far above the floor, and handles other floors", () => {
    for (const [mean, sd, f] of [[0.01, 12, 0], [3, 9, 0], [20.75, 9, 0], [55, 30, 10], [-8, 5, -10]] as const) {
      const loc = floorLocation(mean, sd, f);
      const z = (loc - f) / sd;
      expect({ mean, sd, f, e: f + sd * (z * normalCdf(z) + normalPdf(z)) }).toEqual({ mean, sd, f, e: expect.closeTo(mean, 8) });
      expect(normalDist(mean, sd, f).partialMean(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBeCloseTo(mean, 6);
    }
    expect(floorLocation(300, 30, 0)).toBe(300); // 10 SDs above: nothing to move
  });

  it("a projection at or below its floor is a point mass at the floor", () => {
    for (const mean of [0, -2]) {
      const d = normalDist(mean, 12, 0);
      expect(d.family).toBe("point");
      expect(d.mean).toBe(0);
      expect(d.prob(0, 0)).toBe(1);
    }
    expect(pointDist(3).partialMean(0, 5)).toBe(3);
    expect(pointDist(3).partialMean(4, 5)).toBe(0);
    expect(pointDist(3).cdf(2.9)).toBe(0);
  });
});
