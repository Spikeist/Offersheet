import { describe, expect, it } from "vitest";
import {
  activeShare,
  canPlayWeek,
  expectedAvailability,
  expectedReturnWeek,
  farReturnWeek,
  injuryRisk,
  pOut,
  pRecover,
  returnDateConflict,
  returnWeekDistribution,
  scenarioAvailability,
  type AvailabilityConfig,
  type AvailabilityContext,
  type AvailabilityPlayer,
  type InjuryRisk,
  type ReturnWeek,
} from "./availability";
import { config } from "./config";
import { POSITIONS, type InjuryStatus, type Pos } from "./model";
import { mulberry32, streamFor } from "./rng";

const W0 = 4;
/** NFL weeks 4..17: 14 remaining weeks. */
const WEEKS = Array.from({ length: 14 }, (_, i) => W0 + i);
/** The tests' own scenario seed: re-seeding config.lineups.scenarioSeed must not move a statistical check. */
const SEED = 20_260_929;
const cfg = config.projections;
const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({ weeks: WEEKS, currentWeek: W0, byeWeek: undefined, started: false, hasTeam: true, ...over });
const zeroShares = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Pos, number>;
/** No future injuries: availability is then §6's tables alone. */
const noRisk: AvailabilityConfig = { ...cfg, injuryRisk: { ...cfg.injuryRisk, missShare: zeroShares } };
const withNotActive = (notActive: number): AvailabilityConfig => ({ ...cfg, injury: { ...cfg.injury, notActive } });
const dist = (injury: InjuryStatus, R?: number, c: AvailabilityConfig = cfg, lastNflWeek?: number) => returnWeekDistribution(injury, R, W0, c, lastNflWeek);
const player = (injury: InjuryStatus, injuryReturnWeek?: number): AvailabilityPlayer => (injuryReturnWeek === undefined ? { injury } : { injury, injuryReturnWeek });
const STATUSES: InjuryStatus[] = ["ACTIVE", "PROBABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "IR", "PUP", "SUSPENDED", "NA"];

function expectDist(actual: ReturnWeek[], expected: Array<[week: number, p: number]>): void {
  expect(actual.map((d) => d.week)).toEqual(expected.map(([w]) => w));
  actual.forEach((d, i) => expect(d.p).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 12));
}

function expectClose(actual: number[], expected: number[], digits = 12): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((a, i) => expect(a, `index ${i}`).toBeCloseTo(expected[i] ?? Number.NaN, digits));
}

/** Mean flag per week across scenarios. */
function scenarioMeans(flags: Uint8Array, S: number, W: number): number[] {
  const means = new Array<number>(W).fill(0);
  for (let s = 0; s < S; s++) for (let wi = 0; wi < W; wi++) means[wi]! += flags[s * W + wi] as number;
  return means.map((m) => m / S);
}

describe("returnWeekDistribution: the first week he can play again (CLAUDE.md §6 step 3)", () => {
  it("ACTIVE: this week (a return date is ignored)", () => {
    expectDist(dist("ACTIVE"), [[4, 1]]);
    expectDist(dist("ACTIVE", 9), [[4, 1]]);
  });

  it("PROBABLE: 0.95 this week, then 1 (planner reply to Checkpoint 1, answer 5)", () => {
    expectDist(dist("PROBABLE"), [[4, 0.95], [5, 0.05]]);
  });

  it("QUESTIONABLE and DOUBTFUL: the table's chance this week, else next week", () => {
    expectDist(dist("QUESTIONABLE"), [[4, 0.85], [5, 0.15]]);
    expectDist(dist("DOUBTFUL"), [[4, 0.25], [5, 0.75]]);
  });

  it("OUT: the table [0, 0.5, 0.85] is the cumulative chance he's back", () => {
    expectDist(dist("OUT"), [[5, 0.5], [6, 0.35], [7, 0.15]]);
  });

  it("IR and PUP without a return week: 0 for 4 weeks, then 0.8, then 1", () => {
    expectDist(dist("IR"), [[8, 0.8], [9, 0.2]]);
    expectDist(dist("PUP"), [[8, 0.8], [9, 0.2]]);
  });

  it("SUSPENDED: exactly the known week (no spread), 2 weeks when unknown, never this week", () => {
    expectDist(dist("SUSPENDED", 7), [[7, 1]]);
    expectDist(dist("SUSPENDED"), [[6, 1]]);
    expectDist(dist("SUSPENDED", 4), [[5, 1]]);
    expectDist(dist("SUSPENDED", 2), [[5, 1]]);
  });

  it("NA: never back when notActive is 0; otherwise healthy now, with notActive applied every week", () => {
    expect(dist("NA")).toEqual([]);
    expect(activeShare("NA")).toBe(0);
    expectDist(dist("NA", undefined, withNotActive(0.5)), [[4, 1]]);
    expect(activeShare("NA", withNotActive(0.5))).toBe(0.5);
    expect(activeShare("OUT", withNotActive(0.5))).toBe(1);
  });

  it("a known return week R spreads over R − 1, R and R + 1 (addition C: give or take a week)", () => {
    expect(cfg.returnWeekSpread).toEqual([0.25, 0.5, 0.25]);
    expectDist(dist("OUT", 7), [[6, 0.25], [7, 0.5], [8, 0.25]]);
    expectDist(dist("IR", 10), [[9, 0.25], [10, 0.5], [11, 0.25]]);
    expectDist(dist("PUP", 6), [[5, 0.25], [6, 0.5], [7, 0.25]]);
  });

  it("never earlier than the status allows: mass below the first possible week moves up to it (a stale date = back then)", () => {
    expectDist(dist("OUT", 5), [[5, 0.75], [6, 0.25]]);
    expectDist(dist("IR", 5), [[5, 0.75], [6, 0.25]]);
    expectDist(dist("IR", 4), [[5, 1]]);
    expectDist(dist("PUP", 1), [[5, 1]]);
  });

  it("PROBABLE, QUESTIONABLE and DOUBTFUL use a known week only when it's two or more weeks out", () => {
    expectDist(dist("QUESTIONABLE", 4), [[4, 0.85], [5, 0.15]]);
    expectDist(dist("QUESTIONABLE", 5), [[4, 0.85], [5, 0.15]]);
    expectDist(dist("QUESTIONABLE", 6), [[5, 0.25], [6, 0.5], [7, 0.25]]);
    expectDist(dist("DOUBTFUL", 8), [[7, 0.25], [8, 0.5], [9, 0.25]]);
    expectDist(dist("PROBABLE", 6), [[5, 0.25], [6, 0.5], [7, 0.25]]);
  });

  it("returnDateConflict names the conflicting ESPN signals (§6 step 3): a game-time tag with a return week 2+ weeks out", () => {
    expect(returnDateConflict(player("QUESTIONABLE", 8), W0)).toEqual({ status: "QUESTIONABLE", returnWeek: 8 }); // Josh Jacobs' case
    expect(returnDateConflict(player("DOUBTFUL", 6), W0)).toEqual({ status: "DOUBTFUL", returnWeek: 6 });
    expect(returnDateConflict(player("PROBABLE", 19), W0)).toEqual({ status: "PROBABLE", returnWeek: 19 }); // "out for the season" too
    expect(returnDateConflict(player("QUESTIONABLE", 6.4), W0)).toEqual({ status: "QUESTIONABLE", returnWeek: 6 }); // whole weeks, as returnWeekDistribution reads it
    // A date within a week of now, no date, or a status the date doesn't contradict: no conflict.
    for (const p of [player("QUESTIONABLE", 5), player("QUESTIONABLE", 4), player("QUESTIONABLE"), player("OUT", 8), player("IR", 8), player("ACTIVE", 8), player("SUSPENDED", 8), player("QUESTIONABLE", Number.NaN)]) {
      expect(returnDateConflict(p, W0), JSON.stringify(p)).toBeNull();
    }
  });

  it("one rule, config.projections.returnConflictWeeks (2), decides when a game-time tag's date counts: the distribution and the conflict both follow it", () => {
    expect(cfg.returnConflictWeeks).toBe(2);
    expect([4, 5, 6, 7].map((R) => farReturnWeek(R, W0))).toEqual([false, false, true, true]);
    // Three weeks out instead: a date two weeks out is then ignored by both.
    const three: AvailabilityConfig = { ...cfg, returnConflictWeeks: 3 };
    expect([5, 6, 7].map((R) => farReturnWeek(R, W0, three))).toEqual([false, false, true]);
    expectDist(dist("QUESTIONABLE", 6, three), [[4, 0.85], [5, 0.15]]);
    expectDist(dist("QUESTIONABLE", 7, three), [[6, 0.25], [7, 0.5], [8, 0.25]]);
    expect(returnDateConflict(player("QUESTIONABLE", 6), W0, three)).toBeNull();
    expect(returnDateConflict(player("QUESTIONABLE", 7), W0, three)).toEqual({ status: "QUESTIONABLE", returnWeek: 7 });
  });

  it("a conflicted player follows his return week; passed without it (a stale date, dropped by league.ts) he gets his tag's one-week table", () => {
    expectDist(dist("QUESTIONABLE", 8), [[7, 0.25], [8, 0.5], [9, 0.25]]);
    expectDist(returnWeekDistribution("QUESTIONABLE", undefined, W0), [[4, 0.85], [5, 0.15]]);
    expectClose(expectedAvailability(player("QUESTIONABLE"), "RB", ctx(), noRisk), [0.85, ...new Array<number>(13).fill(1)]);
  });

  it("OUT with a return date that has already passed falls back to the table", () => {
    expectDist(dist("OUT", 4), [[5, 0.5], [6, 0.35], [7, 0.15]]);
    expectDist(dist("OUT", 2), [[5, 0.5], [6, 0.35], [7, 0.15]]);
  });

  it("not back this season: injuryReturnWeek = last NFL week + 1 (§4) is no return at all when lastNflWeek is known", () => {
    for (const status of ["OUT", "IR", "PUP", "SUSPENDED", "QUESTIONABLE", "DOUBTFUL", "PROBABLE"] as const) expect(dist(status, 19, cfg, 18), status).toEqual([]);
    expectDist(dist("IR", 18, cfg, 18), [[17, 0.25], [18, 0.5], [19, 0.25]]); // week 18 itself is still this season
    // Without lastNflWeek the spread lies past a fantasy season that ends in week 17: 0 there anyway…
    expectDist(dist("IR", 19), [[18, 0.25], [19, 0.5], [20, 0.25]]);
    expect(expectedAvailability(player("IR", 19), "RB", ctx())).toEqual(new Array(14).fill(0));
    // …but a fantasy season through week 18 needs lastNflWeek, or R − 1 would bring him back in week 18.
    const thru18 = ctx({ weeks: [...WEEKS, 18] });
    expect(expectedAvailability(player("IR", 19), "RB", thru18).at(-1)).toBeCloseTo(0.25, 12);
    expect(expectedAvailability(player("IR", 19), "RB", { ...thru18, lastNflWeek: 18 })).toEqual(new Array(15).fill(0));
  });

  it("every distribution is sorted, positive, within the season's rules and sums to 1", () => {
    for (const status of STATUSES) {
      for (const R of [undefined, 1, 3, 4, 5, 6, 7, 10, 17, 18, 19]) {
        for (const c of [cfg, withNotActive(0.3)]) {
          const d = returnWeekDistribution(status, R, W0, c);
          if (d.length === 0) {
            expect(status).toBe("NA");
            continue;
          }
          const label = `${status} R=${R}`;
          expect(d.reduce((s, x) => s + x.p, 0), label).toBeCloseTo(1, 12);
          expect(d.every((x) => x.p > 0 && Number.isInteger(x.week)), label).toBe(true);
          expect(d.every((x, i) => i === 0 || x.week > (d[i - 1] as ReturnWeek).week), label).toBe(true);
          const earliest = ["OUT", "IR", "PUP", "SUSPENDED"].includes(status) ? W0 + 1 : W0;
          expect(d[0]!.week, label).toBeGreaterThanOrEqual(earliest);
        }
      }
    }
  });

  it("reads config robustly: a table that dips is its running maximum, the spread is normalized", () => {
    const odd: AvailabilityConfig = { ...cfg, injury: { ...cfg.injury, OUT: [0.5, 0.3, 1.2] }, returnWeekSpread: [1, 2, 1] };
    expectDist(returnWeekDistribution("OUT", undefined, W0, odd), [[4, 0.5], [6, 0.5]]);
    expectDist(returnWeekDistribution("OUT", 7, W0, odd), [[6, 0.25], [7, 0.5], [8, 0.25]]);
    expectDist(returnWeekDistribution("IR", 9, W0, { ...cfg, returnWeekSpread: [0, 1, 0] }), [[9, 1]]);
    expectDist(returnWeekDistribution("IR", 9, W0, { ...cfg, returnWeekSpread: [] }), [[9, 1]]);
  });
});

describe("expectedReturnWeek: an IR player's expected return week R (planner reply to Checkpoint 4, change 5)", () => {
  const R = (p: AvailabilityPlayer, over: Partial<AvailabilityContext> = {}, c: AvailabilityConfig = cfg, q?: number) => expectedReturnWeek(p, ctx(over), c, q);

  it("is the first remaining week his chance of being back reaches returnWeekQuantile (0.5): the lead's examples", () => {
    expect(config.projections.returnWeekQuantile).toBe(0.5);
    // IR with ESPN's date: back at R − 1, R or R + 1 (25% / 50% / 25%): 75% by R.
    expect(R(player("IR", 8))).toBe(8);
    expect(R(player("PUP", 11))).toBe(11);
    // IR without a date: 0 for irUnknown.outWeeks weeks, then 0.8.
    expect(R(player("IR"))).toBe(W0 + cfg.injury.irUnknown.outWeeks);
    // OUT without a date: 50% next week.
    expect(R(player("OUT"))).toBe(W0 + 1);
    // OUT with a date next week or later follows it; a healthy player in an IR slot can be activated now.
    expect(R(player("OUT", 7))).toBe(7);
    expect(R(player("ACTIVE"))).toBe(W0);
    // Game-time tags: Questionable (85% this week) and Probable now, Doubtful (25% this week) next week.
    expect(R(player("QUESTIONABLE"))).toBe(W0);
    expect(R(player("PROBABLE"))).toBe(W0);
    expect(R(player("DOUBTFUL"))).toBe(W0 + 1);
    // A suspension's length is exact.
    expect(R(player("SUSPENDED", 9))).toBe(9);
    expect(R(player("SUSPENDED"))).toBe(W0 + cfg.injury.suspendedUnknownWeeks);
  });

  it("is none when he isn't back within the remaining weeks: out for the season, NA, no NFL team, or a return past the last week", () => {
    expect(R(player("IR", 19), { lastNflWeek: 18 })).toBeNull();
    expect(R(player("NA"))).toBeNull();
    expect(R(player("IR", 8), { hasTeam: false })).toBeNull();
    // Weeks 4–17: a date of 18 is back by 17 only 25% of the time.
    expect(R(player("IR", 18))).toBeNull();
    expect(R(player("IR", 17))).toBe(17);
    expect(R(player("IR", 8), { weeks: [] })).toBeNull();
    // NA players who sometimes play (notActive above 0) are back now, as their distribution says.
    expect(R(player("NA"), {}, withNotActive(0.3))).toBe(W0);
  });

  it("reads the quantile from config (another one moves R), before future injury risk, and on the remaining weeks given (a gap is skipped)", () => {
    expect(R(player("IR", 8), {}, cfg, 0.2)).toBe(7);
    expect(R(player("IR", 8), {}, cfg, 0.8)).toBe(9);
    expect(R(player("IR", 8), {}, cfg, 1)).toBe(9);
    // Future injury risk doesn't move it (the distribution is before it).
    expect(R(player("IR", 8), {}, noRisk)).toBe(R(player("IR", 8)));
    // Weeks listed with a gap: the first listed week at or past the quantile.
    expect(R(player("IR", 8), { weeks: [4, 5, 6, 9, 10] })).toBe(9);
  });

  it("a quantile at or below 0 is the first week he has any chance of being back, never one before it (review of track E)", () => {
    // ESPN's date 8: 25% / 50% / 25% over weeks 7–9, so nothing before week 7 (weeks 4–17 remain).
    for (const q of [0, -1, 1e-15, 1e-12]) expect(R(player("IR", 8), {}, cfg, q), `quantile ${q}`).toBe(7);
    expect(R(player("OUT"), {}, cfg, 0)).toBe(W0 + 1);
    expect(R(player("ACTIVE"), {}, cfg, 0)).toBe(W0);
    // Above 1, or not a number: 1.
    expect(R(player("IR", 8), {}, cfg, 2)).toBe(9);
    expect(R(player("IR", 8), {}, cfg, Number.NaN)).toBe(9);
    // Still none when he isn't back at all.
    expect(R(player("NA"), {}, cfg, 0)).toBeNull();
  });
});

describe("injuryRisk and pOut: future injuries (planner reply to Checkpoint 1, addition B)", () => {
  /** P(out after k steps) by enumerating every healthy/out path of the chain: exact brute force. */
  function bruteForceOut(risk: InjuryRisk, k: number, startOut: boolean): number {
    let total = 0;
    for (let path = 0; path < 1 << k; path++) {
      let p = 1;
      let out = startOut;
      for (let step = 0; step < k; step++) {
        const next = ((path >> step) & 1) === 1;
        p *= out ? (next ? 1 - risk.r : risk.r) : next ? risk.h : 1 - risk.h;
        out = next;
      }
      if (out) total += p;
    }
    return total;
  }

  it("r = 1 / meanInjuryWeeks and h = M·r / (1 − M), per position", () => {
    const rb = injuryRisk("RB");
    expect(rb.M).toBe(0.14);
    expect(rb.r).toBeCloseTo(1 / 2.5, 15);
    expect(rb.h).toBeCloseTo((0.14 * 0.4) / 0.86, 15);
    for (const pos of POSITIONS) expect(injuryRisk(pos).M, pos).toBe(cfg.injuryRisk.missShare[pos]);
    expect(injuryRisk("DEF")).toMatchObject({ M: 0, h: 0 });
  });

  it("pOut(k) matches a brute-force two-state Markov chain for every position (and pRecover from out)", () => {
    for (const pos of POSITIONS) {
      const risk = injuryRisk(pos);
      for (let k = 0; k <= 10; k++) {
        expect(pOut(k, risk), `${pos} k=${k}`).toBeCloseTo(bruteForceOut(risk, k, false), 14);
        expect(pRecover(k, risk), `${pos} k=${k}`).toBeCloseTo(1 - bruteForceOut(risk, k, true), 14);
      }
      // Longer horizons: propagate the probability vector step by step.
      let pH = 1;
      let pO = 0;
      for (let k = 1; k <= 60; k++) {
        [pH, pO] = [pH * (1 - risk.h) + pO * risk.r, pH * risk.h + pO * (1 - risk.r)];
        expect(pOut(k, risk), `${pos} k=${k}`).toBeCloseTo(pO, 14);
      }
    }
  });

  it("the stationary share of weeks out equals M", () => {
    for (const pos of POSITIONS) {
      const { M, h, r } = injuryRisk(pos);
      // π = (1 − M, M) is stationary: π·P = π.
      expect((1 - M) * h + M * (1 - r), pos).toBeCloseTo(M, 15);
      expect(pOut(500, injuryRisk(pos)), pos).toBeCloseTo(M, 12);
      expect(pRecover(500, injuryRisk(pos)), pos).toBeCloseTo(1 - M, 12);
    }
    // A long simulated RB career spends about M of its weeks out.
    const risk = injuryRisk("RB");
    const rand = mulberry32(99);
    let out = false;
    let weeksOut = 0;
    const steps = 400_000;
    for (let i = 0; i < steps; i++) {
      out = out ? rand() >= risk.r : rand() < risk.h;
      if (out) weeksOut++;
    }
    expect(Math.abs(weeksOut / steps - risk.M)).toBeLessThan(0.005);
  });

  it("pOut(0) = 0 and the chance grows with k toward M", () => {
    const risk = injuryRisk("WR");
    expect(pOut(0, risk)).toBe(0);
    expect(pOut(-1, risk)).toBe(0);
    expect(pOut(1, risk)).toBeCloseTo(risk.h, 15);
    for (let k = 1; k < 20; k++) expect(pOut(k + 1, risk)).toBeGreaterThan(pOut(k, risk));
    expect(pOut(20, risk)).toBeLessThanOrEqual(risk.M);
  });

  it("no risk at M = 0 or when injuries never heal; M is capped so h stays a probability", () => {
    expect(pOut(5, injuryRisk("DEF"))).toBe(0);
    const never: AvailabilityConfig = { ...cfg, injuryRisk: { ...cfg.injuryRisk, meanInjuryWeeks: Number.POSITIVE_INFINITY } };
    expect(injuryRisk("RB", never)).toMatchObject({ M: 0, h: 0, r: 0 });
    const huge: AvailabilityConfig = { ...cfg, injuryRisk: { ...cfg.injuryRisk, missShare: { ...zeroShares, RB: 0.9 } } };
    const capped = injuryRisk("RB", huge);
    expect(capped.M).toBeCloseTo(1 / 1.4, 15);
    expect(capped.h).toBeCloseTo(1, 12);
    const short: AvailabilityConfig = { ...cfg, injuryRisk: { ...cfg.injuryRisk, meanInjuryWeeks: 0.5 } };
    expect(injuryRisk("RB", short).r).toBe(1); // an injury lasts at least a week
  });
});

describe("expectedAvailability: a_{i,w} with future injury risk (CLAUDE.md §6 step 3)", () => {
  const ones = (n: number) => new Array<number>(n).fill(1);

  it("without future injuries it reproduces §6's tables exactly", () => {
    const a = (injury: InjuryStatus, R?: number) => expectedAvailability(player(injury, R), "RB", ctx(), noRisk);
    expectClose(a("ACTIVE"), ones(14));
    expectClose(a("PROBABLE"), [0.95, ...ones(13)]);
    expectClose(a("QUESTIONABLE"), [0.85, ...ones(13)]);
    expectClose(a("DOUBTFUL"), [0.25, ...ones(13)]);
    expectClose(a("OUT"), [0, 0.5, 0.85, ...ones(11)]);
    expectClose(a("IR"), [0, 0, 0, 0, 0.8, ...ones(9)]);
    expectClose(a("SUSPENDED"), [0, 0, 1, ...ones(11)]);
    expectClose(a("OUT", 7), [0, 0, 0.25, 0.75, ...ones(10)]); // back at 6, 7 or 8
    expectClose(a("NA"), new Array(14).fill(0));
  });

  it("a healthy player's availability decays toward 1 − M: a_w = 1 − pOut(w − w0)", () => {
    const risk = injuryRisk("RB");
    const a = expectedAvailability(player("ACTIVE"), "RB", ctx());
    expectClose(a, WEEKS.map((w) => 1 - pOut(w - W0, risk)));
    expect(a[0]).toBe(1);
    expect(a[13]).toBeCloseTo(1 - risk.M, 3);
    // A QB (M 0.06) keeps more of his value than an RB (M 0.14); a D/ST never gets hurt.
    expect(expectedAvailability(player("ACTIVE"), "QB", ctx())[13]).toBeGreaterThan(a[13] as number);
    expectClose(expectedAvailability(player("ACTIVE"), "DEF", ctx()), ones(14));
  });

  it("an injured player's future risk starts at his return week: a_w = Σ_t P(T = t)·(1 − pOut(w − t))", () => {
    const risk = injuryRisk("RB");
    const d = dist("OUT");
    const a = expectedAvailability(player("OUT"), "RB", ctx());
    expectClose(a, WEEKS.map((w) => d.reduce((s, { week: t, p }) => s + (w >= t ? p * (1 - pOut(w - t, risk)) : 0), 0)));
    expect(a[1]).toBeCloseTo(0.5, 12); // back next week with chance 0.5, and not hurt again yet
    expect(a[2]).toBeCloseTo(0.5 * (1 - risk.h) + 0.35, 12);
  });

  it("0 in his bye week, 0 this week once his game has kicked off, 0 everywhere without an NFL team", () => {
    const base = expectedAvailability(player("ACTIVE"), "WR", ctx());
    const bye = expectedAvailability(player("ACTIVE"), "WR", ctx({ byeWeek: 7 }));
    expect(bye[3]).toBe(0);
    expectClose(bye.filter((_, i) => i !== 3), base.filter((_, i) => i !== 3));
    const started = expectedAvailability(player("QUESTIONABLE"), "WR", ctx({ started: true }));
    expect(started[0]).toBe(0);
    expect(started[1]).toBeGreaterThan(0.9);
    expect(expectedAvailability(player("ACTIVE"), "WR", ctx({ hasTeam: false }))).toEqual(new Array(14).fill(0));
    expect(canPlayWeek(ctx({ byeWeek: 7, started: true }), 7)).toBe(false);
    expect(canPlayWeek(ctx({ byeWeek: 7, started: true }), 4)).toBe(false);
    expect(canPlayWeek(ctx({ byeWeek: 7, started: true }), 5)).toBe(true);
    expect(canPlayWeek(ctx({ hasTeam: false }), 5)).toBe(false);
  });

  it("NA: notActive multiplies every week (0 by default: never plays)", () => {
    expect(expectedAvailability(player("NA"), "RB", ctx())).toEqual(new Array(14).fill(0));
    const risk = injuryRisk("RB");
    expectClose(expectedAvailability(player("NA"), "RB", ctx(), withNotActive(0.5)), WEEKS.map((w) => 0.5 * (1 - pOut(w - W0, risk))));
  });

  it("gives one value per listed week, for any ascending list (gaps included) and none for no weeks", () => {
    const risk = injuryRisk("TE");
    expectClose(expectedAvailability(player("ACTIVE"), "TE", ctx({ weeks: [4, 6, 9] })), [1, 1 - pOut(2, risk), 1 - pOut(5, risk)]);
    expect(expectedAvailability(player("ACTIVE"), "TE", ctx({ weeks: [] }))).toEqual([]);
  });
});

describe("scenarioAvailability: availability scenarios with common random numbers (§7; addition C)", () => {
  /** A plain walk of the documented draw order, for consecutive weeks: u0 picks T, then one uniform per week (+ one for NA). */
  function referenceFlags(id: string, p: AvailabilityPlayer, pos: Pos, c: AvailabilityContext, S: number, seed: number, conf: AvailabilityConfig = cfg): Uint8Array {
    const W = c.weeks.length;
    const out = new Uint8Array(S * W);
    const d = returnWeekDistribution(p.injury, p.injuryReturnWeek, c.currentWeek, conf, c.lastNflWeek);
    const share = activeShare(p.injury, conf);
    const { h, r } = injuryRisk(pos, conf);
    if (!c.hasTeam || d.length === 0 || share === 0) return out;
    for (let s = 0; s < S; s++) {
      const rand = streamFor(seed, id, s);
      const u0 = rand();
      let acc = 0;
      let T = (d.at(-1) as ReturnWeek).week;
      for (const x of d) {
        acc += x.p;
        if (u0 < acc) {
          T = x.week;
          break;
        }
      }
      let healthy = true;
      c.weeks.forEach((w, wi) => {
        const u = rand();
        const v = share < 1 ? rand() : 0;
        if (w < T) return;
        if (w > T) healthy = healthy ? u >= h : u < r;
        if (healthy && canPlayWeek(c, w) && (share === 1 || v < share)) out[s * W + wi] = 1;
      });
    }
    return out;
  }

  it("returns S × W flags, row-major (scenario s, week index wi at s·W + wi), each 0 or 1", () => {
    const flags = scenarioAvailability("4046", player("OUT"), "RB", ctx(), 8, SEED);
    expect(flags).toBeInstanceOf(Uint8Array);
    expect(flags).toHaveLength(8 * 14);
    expect([...flags].every((f) => f === 0 || f === 1)).toBe(true);
    for (let s = 0; s < 8; s++) expect(flags[s * 14]).toBe(0); // OUT: never plays this week
  });

  it("follows the documented draw order of streamFor(seed, playerId, s) bit for bit", () => {
    const cases: Array<[string, AvailabilityPlayer, Pos, AvailabilityContext, AvailabilityConfig?]> = [
      ["4046", player("ACTIVE"), "RB", ctx()],
      ["espn:4239996", player("OUT", 7), "WR", ctx({ byeWeek: 9 })],
      ["6794", player("IR"), "TE", ctx({ started: true })],
      ["8150", player("QUESTIONABLE"), "QB", ctx({ byeWeek: 4 })],
      ["2133", player("NA"), "LB", ctx(), withNotActive(0.5)],
      ["DAL", player("ACTIVE"), "DEF", ctx({ byeWeek: 10 })],
      // Back exactly in the last listed week (T = 17 with chance 0.25): he plays it (the walk above has no early exit).
      ["4984", player("IR", 18), "RB", ctx()],
      ["9493", player("SUSPENDED", 17), "WR", ctx()],
    ];
    for (const [id, p, pos, c, conf] of cases) expect(scenarioAvailability(id, p, pos, c, 64, SEED, conf), id).toEqual(referenceFlags(id, p, pos, c, 64, SEED, conf));
  });

  it("each player's draws depend only on (seed, playerId, s): not on S, and the gates only zero flags", () => {
    const p = player("OUT", 8);
    const big = scenarioAvailability("4046", p, "RB", ctx(), 32, SEED);
    expect(scenarioAvailability("4046", p, "RB", ctx(), 10, SEED)).toEqual(big.subarray(0, 10 * 14));
    // A bye in week 7 and a kicked-off week-4 game change nothing else.
    const gated = scenarioAvailability("4046", p, "RB", ctx({ byeWeek: 7, started: true }), 32, SEED);
    big.forEach((f, i) => expect(gated[i], `flag ${i}`).toBe(WEEKS[i % 14] === 7 || WEEKS[i % 14] === 4 ? 0 : f));
    expect(scenarioAvailability("4047", p, "RB", ctx(), 32, SEED)).not.toEqual(big);
    expect(scenarioAvailability("4046", p, "RB", ctx(), 32, SEED + 1)).not.toEqual(big);
  });

  it("the stream position never depends on T: two versions of a player agree from the first week both play", () => {
    const S = 2000;
    const healthy = scenarioAvailability("4046", player("ACTIVE"), "RB", ctx(), S, SEED);
    const injured = scenarioAvailability("4046", player("IR", 8), "RB", ctx(), S, SEED);
    let coupled = 0;
    for (let s = 0; s < S; s++) {
      const row = s * 14;
      let both = -1;
      for (let wi = 0; wi < 14 && both < 0; wi++) if (healthy[row + wi] === 1 && injured[row + wi] === 1) both = wi;
      if (both < 0) continue;
      coupled++;
      for (let wi = both; wi < 14; wi++) expect(injured[row + wi], `scenario ${s} week index ${wi}`).toBe(healthy[row + wi]);
    }
    expect(coupled / S).toBeGreaterThan(0.8);
  });

  it("its mean is expectedAvailability: S = 20 000, every status, known return weeks (the last listed week too), byes and a kicked-off game (within 4.5 standard errors)", () => {
    const S = 20_000;
    const cases: Array<[string, AvailabilityPlayer, Pos, AvailabilityContext, AvailabilityConfig?]> = [
      ["active-rb", player("ACTIVE"), "RB", ctx()],
      ["active-qb-bye-started", player("ACTIVE"), "QB", ctx({ byeWeek: 9, started: true })],
      ["probable-wr", player("PROBABLE"), "WR", ctx()],
      ["questionable-te-started", player("QUESTIONABLE"), "TE", ctx({ started: true })],
      ["doubtful-wr-bye", player("DOUBTFUL"), "WR", ctx({ byeWeek: 5 })],
      ["out-rb", player("OUT"), "RB", ctx()],
      ["out-rb-known", player("OUT", 7), "RB", ctx()],
      ["out-rb-known-clamped", player("OUT", 5), "RB", ctx({ byeWeek: 6 })],
      ["ir-wr", player("IR"), "WR", ctx()],
      ["ir-rb-known-bye", player("IR", 9), "RB", ctx({ byeWeek: 9 })],
      ["pup-te-stale", player("PUP", 3), "TE", ctx()],
      ["suspended-qb", player("SUSPENDED"), "QB", ctx()],
      ["suspended-wr-known", player("SUSPENDED", 8), "WR", ctx()],
      ["questionable-rb-known", player("QUESTIONABLE", 7), "RB", ctx()],
      ["na-lb-half", player("NA"), "LB", ctx(), withNotActive(0.5)],
      ["def-bye", player("ACTIVE"), "DEF", ctx({ byeWeek: 6 })],
      ["k", player("ACTIVE"), "K", ctx()],
      ["gaps-out-known", player("OUT", 7), "RB", ctx({ weeks: [4, 6, 9, 10, 15] })],
      ["gaps-ir", player("IR"), "WR", ctx({ weeks: [5, 8, 9, 13, 17] })],
      // Back exactly in the last listed week: IR with R = 18 is back at 17 with chance 0.25; a suspension ending at 17
      // makes him certain to play it (an exact 1, so any off-by-one in "back after the last week" shows); gaps too.
      ["ir-back-last-week", player("IR", 18), "RB", ctx()],
      ["suspended-back-last-week", player("SUSPENDED", 17), "WR", ctx()],
      ["gaps-out-back-last-listed", player("OUT", 15), "RB", ctx({ weeks: [4, 6, 9, 10, 15] })],
    ];
    let sumZ2 = 0;
    let comparisons = 0;
    for (const [id, p, pos, c, conf] of cases) {
      const W = c.weeks.length;
      const means = scenarioMeans(scenarioAvailability(id, p, pos, c, S, SEED, conf), S, W);
      const ev = expectedAvailability(p, pos, c, conf);
      means.forEach((m, wi) => {
        const a = ev[wi] as number;
        const diff = Math.abs(m - a);
        const se = Math.sqrt((a * (1 - a)) / S);
        // A mean of S Bernoulli(a) draws is within 4.5 standard errors of a except once in ~150,000 cells, whatever the
        // seed (a fixed 0.01 was 2.8 SE at a = 0.5: about 7% of seeds failed correct code somewhere).
        expect(diff, `${id} week ${c.weeks[wi]}: mean ${m} vs EV ${a}`).toBeLessThan(4.5 * se + 1e-3);
        if (se > 0) {
          sumZ2 += (diff / se) ** 2;
          comparisons++;
        }
        // Exact zeros and ones stay exact: bye, kicked-off game, before the earliest return, no risk.
        if (se === 0) expect(m, `${id} week ${c.weeks[wi]}`).toBe(a);
      });
    }
    // No bias: squared standard errors average about 1 (a bias of 0.005 would push this to about 3).
    expect(comparisons).toBeGreaterThan(150);
    expect(sumZ2 / comparisons).toBeLessThan(2);
  });

  it("never plays: no NFL team, NA with notActive 0, not back this season; S = 0 or no weeks gives no flags", () => {
    const zeros = (f: Uint8Array) => f.every((x) => x === 0);
    expect(zeros(scenarioAvailability("1", player("ACTIVE"), "WR", ctx({ hasTeam: false }), 16, SEED))).toBe(true);
    expect(zeros(scenarioAvailability("2", player("NA"), "WR", ctx(), 16, SEED))).toBe(true);
    expect(zeros(scenarioAvailability("3", player("IR", 19), "WR", ctx({ weeks: [...WEEKS, 18], lastNflWeek: 18 }), 16, SEED))).toBe(true);
    expect(zeros(scenarioAvailability("4", player("IR", 25), "WR", ctx(), 16, SEED))).toBe(true);
    expect(scenarioAvailability("5", player("ACTIVE"), "WR", ctx(), 0, SEED)).toHaveLength(0);
    expect(scenarioAvailability("6", player("ACTIVE"), "WR", ctx({ weeks: [] }), 16, SEED)).toHaveLength(0);
    expect(scenarioAvailability("7", player("ACTIVE"), "WR", ctx(), 2.7, SEED)).toHaveLength(2 * 14);
  });
});
