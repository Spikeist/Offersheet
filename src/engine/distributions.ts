/**
 * Distributions for expected-value scoring rules (CLAUDE.md §5; planner reply to Checkpoint 1,
 * answer 3). Pure math with no config: scoring.ts picks the family and its parameters per stat.
 *
 * - Poisson on a lattice (count stats): X = unit · N with N ~ Poisson(mean / unit). Counts move in
 *   whole units (unit 1); IDP sacks move in halves (unit 0.5), so "≥ 1.5 sacks" and "≥ 2 sacks" stay
 *   different events. Probabilities are exact: the pmf comes from the recurrence p(0) = e^−λ,
 *   p(k) = p(k−1)·λ/k, summed until the tail left is below 1e-17. Above λ = 700 (e^−λ underflows
 *   near 745) it falls back to Normal(mean, √(unit·mean)); the half-grid bounds scoring.ts uses then
 *   act as the continuity correction.
 * - Normal (yardage, D/ST points and yards allowed, completion %), optionally floored: the stat is
 *   X' = max(X, floor) with X ~ Normal(m, sd), so the mass below the floor sits AT the floor and
 *   counts in the lowest bucket. The location m is chosen so that E[X'] equals the projection
 *   (mean-matched): without that, flooring would raise the mean of a small projection (a WR projected
 *   for 5.6 receiving yards with SD 19 would average 10.7), and a rule that is linear over the whole
 *   line (MFL "0–999 yards × 0.1") would stop being exact in expectation. Unfloored, m = the
 *   projection. A floored stat projected at (or below) its floor is a point mass there.
 *
 * Every distribution answers P(lo ≤ X ≤ hi) with inclusive bounds (open ends are ±Infinity) and the
 * partial mean E[X · 1{lo ≤ X ≤ hi}] that bounded per-unit rules need.
 */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26; absolute error < 1.5e-7). */
export function normalCdf(z: number): number {
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function normalPdf(z: number): number {
  if (!Number.isFinite(z)) return 0;
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** A stat's distribution for expected values. */
export interface StatDist {
  readonly family: "poisson" | "normal" | "point";
  /** E[X]: the projection (after any floor). */
  readonly mean: number;
  /** SD of the distribution before any floor (Poisson: √(unit · mean)). */
  readonly sd: number;
  /** The lowest value X takes (mass below it sits there), if any. */
  readonly floor: number | undefined;
  /** P(X ≤ x). */
  cdf(x: number): number;
  /** P(lo ≤ X ≤ hi), bounds inclusive; open ends as ±Infinity. */
  prob(lo: number, hi: number): number;
  /** E[X · 1{lo ≤ X ≤ hi}]. */
  partialMean(lo: number, hi: number): number;
}

/** Numerical guards, not model parameters (so they don't live in config). */
const POISSON_NORMAL_ABOVE = 700;
const LATTICE_EPS = 1e-9;
const POISSON_TAIL_EPS = 1e-17;
/** A floored normal whose projection sits this many SDs above the floor has no mass worth moving. */
const FLOOR_NEGLIGIBLE_Z = 8;
/** …and one this close to its floor (in SDs) is a point mass at the floor. */
const FLOOR_POINT_Z = 1e-9;
const NEWTON_MAX_STEPS = 100;

/** A point mass at `value` (a projection with no spread). */
export function pointDist(value: number): StatDist {
  const inside = (lo: number, hi: number) => lo <= value && value <= hi;
  return {
    family: "point",
    mean: value,
    sd: 0,
    floor: undefined,
    cdf: (x) => (x >= value ? 1 : 0),
    prob: (lo, hi) => (inside(lo, hi) ? 1 : 0),
    partialMean: (lo, hi) => (inside(lo, hi) ? value : 0),
  };
}

/**
 * P(N ≤ n) for N ~ Poisson(lambda), as a lazily extended cumulative table (a stepped rule asks for
 * many n). Past the mode the tail after k is below p(k)·r/(1 − r) with r = λ/(k + 1); once that is
 * negligible the table stops growing.
 */
function poissonCumulative(lambda: number): (n: number) => number {
  const cum: number[] = [];
  let pmf = Math.exp(-lambda);
  let total = 0;
  let saturated = false;
  return (n: number): number => {
    if (n < 0) return 0;
    if (n === Number.POSITIVE_INFINITY) return 1;
    while (!saturated && cum.length <= n) {
      const k = cum.length;
      if (k > 0) pmf *= lambda / k;
      total += pmf;
      cum.push(total);
      const r = lambda / (k + 1);
      if (r < 1 && (pmf * r) / (1 - r) < POISSON_TAIL_EPS) saturated = true;
    }
    return Math.min(1, n < cum.length ? (cum[n] as number) : total);
  };
}

/** X = unit · N, N ~ Poisson(mean / unit). A mean of 0 (or below) is a point mass at 0. */
export function poissonDist(mean: number, unit = 1): StatDist {
  const mu = Math.max(0, mean);
  if (!(unit > 0)) throw new Error(`poissonDist: the lattice unit must be positive (got ${unit})`);
  if (mu === 0) return pointDist(0);
  const lambda = mu / unit;
  if (lambda > POISSON_NORMAL_ABOVE) return normalDist(mu, Math.sqrt(unit * mu)); // no floor needed: P(X < 0) < e^−26²/2
  const cdfN = poissonCumulative(lambda);
  /** Largest n with unit·n ≤ x. */
  const atMost = (x: number) => (x === Number.POSITIVE_INFINITY ? x : Math.floor(x / unit + LATTICE_EPS));
  /** Smallest n ≥ 0 with unit·n ≥ x. */
  const atLeast = (x: number) => (x === Number.NEGATIVE_INFINITY ? 0 : Math.max(0, Math.ceil(x / unit - LATTICE_EPS)));
  return {
    family: "poisson",
    mean: mu,
    sd: Math.sqrt(unit * mu),
    floor: 0,
    cdf: (x) => cdfN(atMost(x)),
    prob: (lo, hi) => {
      const a = atLeast(lo);
      const b = atMost(hi);
      return b < a ? 0 : Math.max(0, cdfN(b) - cdfN(a - 1));
    },
    // Σ_{a ≤ n ≤ b} unit·n·p(n) = unit·λ·Σ p(n − 1) = mean · P(a − 1 ≤ N ≤ b − 1), as n·p(n) = λ·p(n − 1).
    partialMean: (lo, hi) => {
      const a = atLeast(lo);
      const b = atMost(hi);
      return b < a ? 0 : mu * Math.max(0, cdfN(b - 1) - cdfN(a - 2));
    },
  };
}

/** P(N = k) for N ~ Poisson(lambda). */
export function poissonPmf(k: number, lambda: number): number {
  return Number.isInteger(k) ? poissonDist(lambda).prob(k, k) : 0;
}

/** P(N ≤ k) for N ~ Poisson(lambda). */
export function poissonCdf(k: number, lambda: number): number {
  return poissonDist(lambda).cdf(k);
}

/** P(N ≥ k) for N ~ Poisson(lambda). */
export function poissonTail(k: number, lambda: number): number {
  return poissonDist(lambda).prob(k, Number.POSITIVE_INFINITY);
}

/**
 * The location m of Normal(m, sd) whose floored version max(X, floor) has mean `mean`:
 * E[max(X, f)] = f + sd·ψ((m − f)/sd) with ψ(z) = z·Φ(z) + φ(z), which is convex and increasing
 * (ψ' = Φ). Newton from z = (mean − f)/sd, where ψ(z) > z, converges monotonically from the right.
 * Needs mean > floor.
 */
export function floorLocation(mean: number, sd: number, floor: number): number {
  const t = (mean - floor) / sd;
  if (!(t < FLOOR_NEGLIGIBLE_Z)) return mean;
  let z = t;
  for (let i = 0; i < NEWTON_MAX_STEPS; i++) {
    const cdf = normalCdf(z);
    if (!(cdf > 0)) break;
    const step = (z * cdf + normalPdf(z) - t) / cdf;
    z -= step;
    if (!(Math.abs(step) > 1e-12 * (1 + Math.abs(z)))) break;
  }
  return floor + z * sd;
}

/**
 * Normal(mean, sd), or with a floor the mean-matched floored normal (see the header). A projection at
 * or below its floor, or no spread at all, is a point mass.
 */
export function normalDist(mean: number, sd: number, floor?: number): StatDist {
  if (floor !== undefined && !((mean - floor) / sd > FLOOR_POINT_Z)) return pointDist(Math.max(mean, floor));
  if (!(sd > 0)) return pointDist(mean);
  const loc = floor === undefined ? mean : floorLocation(mean, sd, floor);
  const phi = (x: number) => normalCdf((x - loc) / sd);
  /** P(X' ≤ x): nothing below the floor. */
  const cdf = (x: number) => (floor !== undefined && x < floor ? 0 : phi(x));
  /** P(X' < x): the floor's atom is not below a bound at the floor. */
  const below = (x: number) => (floor !== undefined && x <= floor ? 0 : phi(x));
  return {
    family: "normal",
    mean,
    sd,
    floor,
    cdf,
    prob: (lo, hi) => (hi < lo ? 0 : Math.max(0, cdf(hi) - below(lo))),
    partialMean: (lo, hi) => {
      if (hi < lo || (floor !== undefined && hi < floor)) return 0;
      let total = 0;
      let start = lo;
      if (floor !== undefined) {
        if (lo <= floor) total += floor * phi(floor); // the atom: the mass below the floor sits at it
        start = Math.max(lo, floor);
      }
      // ∫ x·φ over [start, hi] = loc·(Φ(β) − Φ(α)) + sd·(φ(α) − φ(β)).
      const a = (start - loc) / sd;
      const b = (hi - loc) / sd;
      return total + loc * (normalCdf(b) - normalCdf(a)) + sd * (normalPdf(a) - normalPdf(b));
    },
  };
}
