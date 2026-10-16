import { describe, expect, it } from "vitest";
import { config } from "./config";
import type { PlayerInputs } from "./inputs";
import { POSITIONS, type InjuryStatus, type Pos } from "./model";
import {
  actualWeightFor,
  agreementAside,
  agreementLeftOutText,
  agreementPercent,
  baseRate,
  baseRateSourceCounts,
  espnSleeperAgreement,
  gameTimeBaseRate,
  latestHealthyProjection,
  nearestHealthyProjection,
  priorHealthyBaseRate,
  projectPlayer,
  rosSummary,
  staleReturnCheck,
  usesHealthyBaseRate,
  weekShape,
  weeklySd,
  type ProjectionConfig,
  type ProjectPlayerContext,
} from "./projections";

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Every injury status (a Record, so a status added to the type must be listed here). */
const STATUS_SET: Record<InjuryStatus, true> = { ACTIVE: true, PROBABLE: true, QUESTIONABLE: true, DOUBTFUL: true, OUT: true, IR: true, PUP: true, SUSPENDED: true, NA: true };
const INJURY_STATUSES = Object.keys(STATUS_SET) as InjuryStatus[];

// A Parker-like league (Checkpoint 1): ESPN, NFL week 4, regular season weeks 1–14, playoffs weeks 15–17.
const CURRENT = 4;
const WEEKS = range(4, 17);
const REGULAR = range(1, 14);
const PLAYOFFS = range(15, 17);

const player = (sleeper: PlayerInputs["sleeper"], extra: Partial<PlayerInputs> = {}): PlayerInputs => ({ sleeper, actual: {}, ...extra });
const ctx = (over: Partial<ProjectPlayerContext> = {}): ProjectPlayerContext => ({
  currentWeek: CURRENT,
  weeks: WEEKS,
  regularWeeks: REGULAR,
  playoffWeeks: PLAYOFFS,
  espnAveraged: false,
  byeWeek: undefined,
  started: false,
  ...over,
});
const flat = (weeks: number[], v: number): Record<number, number> => Object.fromEntries(weeks.map((w) => [w, v]));
const ones = (n: number): number[] => Array.from({ length: n }, () => 1);

describe("weekShape (§6 step 2)", () => {
  it("divides by his mean over the REMAINING weeks he's projected, clamps to weekShapeClamp, and shapes past weeks too", () => {
    // Remaining weeks 4–8; projected 10, 20, 30 → mean 20. Past weeks 2–3 don't enter the mean (with them it would be 19).
    const shape = weekShape(player({ 2: 13, 3: 22, 4: 10, 5: 20, 6: 30, 7: null, 8: 0 }), [4, 5, 6, 7, 8]);
    expect(shape.get(5)).toBe(1);
    expect(shape.get(4)).toBe(0.8); // 0.5 clamped up
    expect(shape.get(6)).toBe(1.2); // 1.5 clamped down
    expect(shape.get(3)).toBeCloseTo(1.1, 12); // a past week: 22 / 20, so m_now exists for a lookback week
    expect(shape.get(2)).toBe(0.8); // 13 / 20 = 0.65, clamped
    // A stub (null) or 0 week isn't a healthy projection: m = 1 (§6: "use 1 when data is missing").
    expect(shape.get(7)).toBe(1);
    expect(shape.get(8)).toBe(1);
    expect(shape.get(9)).toBeUndefined(); // not a remaining week, not projected
  });

  it("is 1 everywhere, past weeks included, when no remaining week is projected", () => {
    const shape = weekShape(player({ 2: 15, 3: 18, 4: null, 5: null }), [4, 5]);
    expect([2, 3, 4, 5].map((w) => shape.get(w))).toEqual([1, 1, 1, 1]);
    expect([...weekShape(player({}), [4, 5]).values()]).toEqual([1, 1]);
  });

  it("reads its clamp from config", () => {
    const cfg: ProjectionConfig = { ...config.projections, weekShapeClamp: [0.5, 2] };
    const shape = weekShape(player({ 4: 10, 5: 20, 6: 30 }), [4, 5, 6], cfg);
    expect([shape.get(4), shape.get(5), shape.get(6)]).toEqual([0.5, 1, 1.5]);
  });
});

describe("latestHealthyProjection (§6 step 1: proj_now's week)", () => {
  it("takes the latest week ≤ currentWeek with a value > 0 (stubs and zeros skipped)", () => {
    expect(latestHealthyProjection({ 1: 10, 2: 12, 3: null, 4: 0, 5: 14 }, 4, WEEKS)).toEqual({ week: 2, value: 12 });
    expect(latestHealthyProjection({ 3: 11, 4: 13 }, 4, WEEKS)).toEqual({ week: 4, value: 13 });
  });

  it("otherwise the nearest later remaining week; null when there is none", () => {
    expect(latestHealthyProjection({ 1: null, 2: null, 3: null, 4: null, 5: 0, 8: 11, 6: 9 }, 4, WEEKS)).toEqual({ week: 6, value: 9 });
    expect(latestHealthyProjection({ 4: null, 20: 12 }, 4, WEEKS)).toBeNull(); // week 20 isn't a remaining week
    expect(latestHealthyProjection({ 3: -2, 4: null }, 4, WEEKS)).toBeNull();
    expect(latestHealthyProjection(undefined, 4, WEEKS)).toBeNull();
  });
});

describe("nearestHealthyProjection (§6 step 3, the Q/D/P base rate's week)", () => {
  it("takes the earliest remaining week after currentWeek with a value > 0 (a bye's stub and zeros skipped), never currentWeek itself", () => {
    expect(nearestHealthyProjection({ 3: 19, 4: 6, 5: 20, 6: 22 }, 4, WEEKS)).toEqual({ week: 5, value: 20 });
    expect(nearestHealthyProjection({ 3: 19, 4: 6, 5: null, 6: 0, 7: 21 }, 4, WEEKS)).toEqual({ week: 7, value: 21 });
    expect(nearestHealthyProjection({ 4: 15, 9: 12, 8: 11 }, 4, WEEKS)).toEqual({ week: 8, value: 11 });
  });

  it("otherwise the latest week before currentWeek with one; null when there is neither", () => {
    expect(nearestHealthyProjection({ 1: 10, 2: 12, 3: null, 4: 6, 5: null }, 4, WEEKS)).toEqual({ week: 2, value: 12 });
    expect(nearestHealthyProjection({ 3: 19, 4: 6, 20: 12 }, 4, WEEKS)).toEqual({ week: 3, value: 19 }); // week 20 isn't a remaining week
    expect(nearestHealthyProjection({ 4: 15 }, 4, WEEKS)).toBeNull();
    expect(nearestHealthyProjection({ 3: -2, 4: 6, 5: 0 }, 4, WEEKS)).toBeNull();
    expect(nearestHealthyProjection(undefined, 4, WEEKS)).toBeNull();
  });
});

describe("baseRate (§6 step 1)", () => {
  const weeks = [4, 5, 6];

  it("b = (1 − α)·(proj_now / m_now) + α·actual_ppg, with α = actualWeight × min(1, games / actualFullGames) (no position: the default weight)", () => {
    // proj_now 16 in week 4; remaining mean (16 + 20 + 24) / 3 = 20 → m_now 0.8 → 20 points in a neutral matchup.
    // 3 games at 18 per game → α = 0.25 × 3/6 = 0.125 → b = 0.875 × 20 + 0.125 × 18 = 19.75.
    const base = baseRate(player({ 3: 18, 4: 16, 5: 20, 6: 24 }, { actual: { 1: 12, 2: 18, 3: 24 } }), { currentWeek: 4, weeks, espnAveraged: false });
    expect(base).toMatchObject({ projNow: 16, projWeek: 4, mNow: 0.8, actualPpg: 18, games: 3, alpha: 0.125, source: "sleeper" });
    expect(base.b).toBeCloseTo(19.75, 12);
  });

  it("α grows with games played up to actualWeight at actualFullGames (every position but K and DEF), and reads both from config", () => {
    const alphaFor = (games: number, cfg: ProjectionConfig = config.projections) =>
      baseRate(player({ 4: 10 }, { actual: flat(range(1, games), 10) }), { currentWeek: 4, weeks, espnAveraged: false }, cfg).alpha;
    expect(alphaFor(0)).toBe(0);
    expect(alphaFor(3)).toBeCloseTo(0.125, 12);
    expect(alphaFor(6)).toBe(0.25);
    expect(alphaFor(8)).toBe(0.25);
    const cfg: ProjectionConfig = { ...config.projections, actualWeight: 0.5, actualFullGames: 2 };
    expect(alphaFor(1, cfg)).toBe(0.25);
    expect(alphaFor(3, cfg)).toBe(0.5);
    // No games: actual_ppg is unknown (null), not 0, and b is the de-matchuped projection alone.
    expect(baseRate(player({ 4: 10 }), { currentWeek: 4, weeks, espnAveraged: false })).toMatchObject({ b: 10, actualPpg: null, games: 0, alpha: 0 });
  });

  it("an injured star whose current week is a stub keeps his last healthy projection (never an injury-zeroed 0)", () => {
    // OUT this week and next (Sleeper stubs, null), back in week 6; bye week 10. Healthy projections weeks 1–3.
    const star = player(
      { 1: 18, 2: 20, 3: 19, 4: null, 5: null, 6: 17.5, 7: 19.5, 8: 18.2, 9: 20.4, 10: null, 11: 18.8, 12: 19.1, 13: 17.9, 14: 18.6, 15: 19.3, 16: 18.1, 17: 19 },
      { actual: { 1: 24.3, 2: 16.1, 3: 21 } },
    );
    const base = baseRate(star, { currentWeek: CURRENT, weeks: WEEKS, espnAveraged: false });
    const mean = 206.4 / 11; // his 11 projected remaining weeks
    expect(base).toMatchObject({ projNow: 19, projWeek: 3, games: 3, alpha: 0.125, source: "sleeper" });
    expect(base.mNow).toBeCloseTo(19 / mean, 12);
    expect(base.b).toBeCloseTo(0.875 * (19 / (19 / mean)) + 0.125 * (61.4 / 3), 10);
    expect(base.b).toBeCloseTo(18.9765, 4);

    // His availability (§6 step 3, an input) is what keeps him off this week's lineup, not b.
    const a = [0, 0.5, 0.85, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1];
    const model = projectPlayer("star", "RB", star, a, ctx({ byeWeek: 10 }));
    expect(model.base).toEqual(base);
    expect(model.weekly[0]).toEqual({ p: 0, a: 0, m: 1, bye: false, sd: 0 });
    expect(model.weekly[2]!.p).toBeCloseTo(base.b * (17.5 / mean) * 0.85, 10);
    expect(model.weekly[6]).toMatchObject({ p: 0, bye: true });
    expect(model.ros.total).toBeGreaterThan(200); // an injured star still carries most of his season
  });

  it("a player hurt through the whole lookback uses his first projected week ahead", () => {
    const base = baseRate(player({ 1: null, 2: null, 3: null, 4: null, 5: null, 6: 0, 7: 15, 8: 16.5 }), { currentWeek: 4, weeks: range(4, 8), espnAveraged: false });
    expect(base).toMatchObject({ projNow: 15, projWeek: 7, source: "sleeper" });
    expect(base.mNow).toBeCloseTo(15 / 15.75, 12);
    expect(base.b).toBeCloseTo(15.75, 12); // no games: b = proj_now / m_now = his remaining mean
  });

  it("ESPN leagues average ESPN in proj_now's week only when the sources agree and ESPN projects him that week", () => {
    const inputs = player({ 3: 12, 4: 14, 5: 14 }, { espn: { 3: 13, 4: 15 } });
    const agreeing = baseRate(inputs, { currentWeek: 4, weeks: [4, 5], espnAveraged: true });
    expect(agreeing).toMatchObject({ projNow: 14.5, projWeek: 4, mNow: 1, b: 14.5, source: "espn+sleeper" });
    // The sources disagree league-wide (§6: "otherwise use Sleeper × league scoring").
    expect(baseRate(inputs, { currentWeek: 4, weeks: [4, 5], espnAveraged: false })).toMatchObject({ projNow: 14, source: "sleeper" });
    // ESPN zeroes injured players (null or 0): Sleeper alone.
    expect(baseRate(player({ 4: 14 }, { espn: { 4: null } }), { currentWeek: 4, weeks: [4], espnAveraged: true })).toMatchObject({ projNow: 14, source: "sleeper" });
    expect(baseRate(player({ 4: 14 }, { espn: { 4: 0 } }), { currentWeek: 4, weeks: [4], espnAveraged: true })).toMatchObject({ projNow: 14, source: "sleeper" });
    // ESPN's value from another week is never mixed in: proj_now's week is Sleeper's latest healthy week (3).
    expect(baseRate(player({ 3: 19, 4: null }, { espn: { 3: null, 4: 20 } }), { currentWeek: 4, weeks: [4], espnAveraged: true })).toMatchObject({ projNow: 19, projWeek: 3, source: "sleeper" });
  });

  it("uses ESPN alone when Sleeper never projects him (no Sleeper id, or only stubs), whether or not the sources agree", () => {
    for (const espnAveraged of [true, false]) {
      expect(baseRate(player({}, { espn: { 3: 7.5, 4: 8.1 } }), { currentWeek: 4, weeks: [4, 5], espnAveraged })).toMatchObject({ projNow: 8.1, projWeek: 4, mNow: 1, b: 8.1, source: "espn" });
    }
    expect(baseRate(player({ 3: null, 4: null, 5: null }, { espn: { 4: null, 5: 6 } }), { currentWeek: 4, weeks: [4, 5], espnAveraged: false })).toMatchObject({ projNow: 6, projWeek: 5, source: "espn" });
  });

  it("source precedence: a Sleeper week, then ESPN alone, then the season line, then actual points", () => {
    const c = { currentWeek: 4, weeks: [4, 5], espnAveraged: false };
    const actual = { 1: 20 };
    expect(baseRate(player({ 5: 10 }, { espn: { 4: 8 }, sleeperSeasonPerGame: 14, actual }), c).source).toBe("sleeper");
    expect(baseRate(player({ 4: null }, { espn: { 4: 8 }, sleeperSeasonPerGame: 14, actual }), c).source).toBe("espn");
    expect(baseRate(player({ 4: null }, { espn: { 4: null }, sleeperSeasonPerGame: 14, actual }), c).source).toBe("season");
    expect(baseRate(player({ 4: null }, { espn: { 4: null }, actual }), c).source).toBe("actual");
  });

  it("ignores week keys that aren't week numbers and actual values that aren't finite (malformed JSON)", () => {
    const inputs = JSON.parse('{"sleeper": {"4": 10, "x": 50, "5": 10}, "actual": {"1": 12, "2": null}}') as PlayerInputs;
    expect(weekShape(inputs, [4, 5]).get(Number.NaN)).toBeUndefined();
    const base = baseRate(inputs, { currentWeek: 4, weeks: [4, 5], espnAveraged: false });
    expect(base).toMatchObject({ projNow: 10, projWeek: 4, mNow: 1, actualPpg: 12, games: 1, source: "sleeper" });
  });

  it("falls back to Sleeper's season projection per game (projWeek null, m_now 1), then to actual points per game", () => {
    const actual = { 1: 9, 2: 13 };
    const season = baseRate(player({ 3: null, 4: null }, { sleeperSeasonPerGame: 11.2, actual }), { currentWeek: 4, weeks, espnAveraged: true });
    const alpha = 0.25 * (2 / 6);
    expect(season).toMatchObject({ projNow: 11.2, projWeek: null, mNow: 1, actualPpg: 11, games: 2, source: "season" });
    expect(season.alpha).toBeCloseTo(alpha, 12);
    expect(season.b).toBeCloseTo((1 - alpha) * 11.2 + alpha * 11, 12);
    // A season line worth 0 isn't a projection. With no projection at all, his actual points per game are b (α = 1).
    expect(baseRate(player({}, { sleeperSeasonPerGame: 0, actual }), { currentWeek: 4, weeks, espnAveraged: false })).toEqual({
      b: 11,
      projNow: null,
      projWeek: null,
      mNow: 1,
      actualPpg: 11,
      games: 2,
      alpha: 1,
      source: "actual",
    });
  });

  it("with no projection and no games, b = 0 (source none)", () => {
    expect(baseRate(player({ 4: null }), { currentWeek: 4, weeks, espnAveraged: false })).toEqual({ b: 0, projNow: null, projWeek: null, mNow: 1, actualPpg: null, games: 0, alpha: 0, source: "none" });
  });

  it("b is never below 0", () => {
    // 0.75 × 1 + 0.25 × (−20) = −4.25 → 0.
    const blended = baseRate(player({ 4: 1 }, { actual: flat(range(1, 6), -20) }), { currentWeek: 4, weeks: [4], espnAveraged: false });
    expect(blended).toMatchObject({ b: 0, actualPpg: -20, alpha: 0.25, source: "sleeper" });
    expect(baseRate(player({}, { actual: { 3: -1 } }), { currentWeek: 4, weeks, espnAveraged: false })).toMatchObject({ b: 0, actualPpg: -1, source: "actual" });
  });
});

describe("the season-to-date weight by position (§6 step 1; planner reply to Checkpoint 7d, item 1.2: K and DEF 0)", () => {
  const c = { currentWeek: 4, weeks: [4, 5, 6], espnAveraged: false };
  // 16 projected this week, (16 + 20 + 24) / 3 = 20 a week → m_now 0.8; 3 games at 18 a game (α 0.125 at 0.25).
  const inputs = player({ 3: 18, 4: 16, 5: 20, 6: 24 }, { actual: { 1: 12, 2: 18, 3: 24 } });
  /** The rule before item 1.2: every position at actualWeight. */
  const before: ProjectionConfig = { ...config.projections, actualWeightByPos: {} };
  const others = POSITIONS.filter((pos) => pos !== "K" && pos !== "DEF");

  it("config: K and DEF weigh 0, every other position actualWeight (0.25), and so does a caller without a position", () => {
    expect(config.projections.actualWeight).toBe(0.25);
    expect(Object.fromEntries(POSITIONS.map((pos) => [pos, actualWeightFor(pos)]))).toEqual({ QB: 0.25, RB: 0.25, WR: 0.25, TE: 0.25, K: 0, P: 0.25, DEF: 0, DL: 0.25, LB: 0.25, DB: 0.25 });
    expect(actualWeightFor(undefined)).toBe(0.25);
    // A config without the map (a test's own) reads actualWeight everywhere; an entry replaces it for its position only.
    const noMap: ProjectionConfig = { ...config.projections, actualWeightByPos: undefined };
    expect(actualWeightFor("K", noMap)).toBe(0.25);
    const wr: ProjectionConfig = { ...config.projections, actualWeightByPos: { WR: 0.5 } };
    expect([actualWeightFor("WR", wr), actualWeightFor("K", wr), actualWeightFor("TE", wr)]).toEqual([0.5, 0.25, 0.25]);
  });

  it("K and DEF: b is the projection with the matchup taken out (proj_now / m_now), whatever their points so far", () => {
    for (const pos of ["K", "DEF"] as const) {
      const base = baseRate(inputs, { ...c, pos });
      // Games and points per game are still reported (facts), but weigh nothing.
      expect(base).toMatchObject({ projNow: 16, projWeek: 4, mNow: 0.8, actualPpg: 18, games: 3, alpha: 0, source: "sleeper" });
      expect(base.b).toBe(16 / 0.8);
      // A full season of games, or points per game below 0 (a defense's bad start), changes nothing.
      for (const actual of [flat(range(1, 8), 30), flat(range(1, 3), -4)]) expect(baseRate({ ...inputs, actual }, { ...c, pos }).b).toBe(16 / 0.8);
      // The rule before blended them in: 0.875 × 20 + 0.125 × 18 = 19.75.
      expect(baseRate(inputs, { ...c, pos }, before).b).toBeCloseTo(19.75, 12);
    }
  });

  it("⚠️ a K or DEF whom no source projects at all still falls back to his points per game so far, every position's last resort", () => {
    for (const pos of ["K", "DEF"] as const) {
      expect(baseRate(player({ 4: null }, { actual: { 1: 9, 2: 13 } }), { ...c, pos })).toMatchObject({ b: 11, alpha: 1, source: "actual" });
    }
  });

  it("every other position, and a caller without a position, keeps the rule before bit for bit", () => {
    for (const pos of others) {
      expect(baseRate(inputs, { ...c, pos })).toEqual(baseRate(inputs, { ...c, pos }, before));
      expect(baseRate(inputs, { ...c, pos })).toEqual(baseRate(inputs, c, before));
    }
    expect(baseRate(inputs, c)).toEqual(baseRate(inputs, c, before));
    expect(baseRate(inputs, c).alpha).toBe(0.125);
  });

  it("projectPlayer weighs by its own `pos` (ctx.pos isn't read): a team defense's week is his projection, and no other position moves", () => {
    // A defense projected 7.2 this week, 6 a week after it, with 14 points a game in 3 games.
    const d = player({ 3: 6, ...flat(range(4, 17), 6), 4: 7.2 }, { actual: { 1: 14, 2: 10, 3: 18 } });
    const a = ones(WEEKS.length);
    const def = projectPlayer("d", "DEF", d, a, ctx());
    expect(def.base).toMatchObject({ alpha: 0, games: 3, actualPpg: 14 });
    expect(def.weekly[0]!.p).toBeCloseTo(7.2, 12); // this week: Sleeper's projection (× availability 1)
    expect(projectPlayer("d", "DEF", d, a, ctx({ pos: "WR" }))).toEqual(def);
    expect(projectPlayer("d", "DEF", d, a, ctx(), before).weekly[0]!.p).toBeGreaterThan(def.weekly[0]!.p); // 14 a game pulled it up
    for (const pos of others) expect(projectPlayer("d", pos, d, a, ctx({ pos: "K" }))).toEqual(projectPlayer("d", pos, d, a, ctx(), before));
  });

  it("the Q/D/P base rate and the stale-date tiebreaker's healthy base rate read ctx.pos's weight too", () => {
    // A questionable kicker: Sleeper cut him to 3 this week, 8 a week otherwise; 3 games at 16.
    const k = player({ 1: 8, 2: 8, 3: 8, 4: 3, 5: 8, 6: 8 }, { actual: { 1: 16, 2: 16, 3: 16 } });
    expect(gameTimeBaseRate(k, { ...c, pos: "K" })).toMatchObject({ b: 8, alpha: 0, projWeek: 5 });
    expect(gameTimeBaseRate(k, c)).toMatchObject({ b: 9, alpha: 0.125 }); // 0.875 × 8 + 0.125 × 16
    expect(priorHealthyBaseRate(k, { ...c, pos: "K" })).toMatchObject({ b: 8, alpha: 0, projWeek: 3 });
    expect(staleReturnCheck(k, { ...c, pos: "K" })).toEqual({ sleeperNow: 3, healthyRate: 8, stale: false });
    expect(staleReturnCheck(k, c)).toEqual({ sleeperNow: 3, healthyRate: 9, stale: false });
  });
});

describe("priorHealthyBaseRate (§6 step 3 'Conflicting ESPN signals': the healthy base rate, step 1's as if he weren't projected this week)", () => {
  const c = { currentWeek: 4, weeks: [4, 5, 6], espnAveraged: false };

  it("is step 1's base rate with proj_now taken from the latest healthy week BEFORE this week, the same α blend, and this week out of the shape's mean", () => {
    // Questionable this week: Sleeper cut him to 6. Healthy before: 18, 20, 19 (week 3). The shape's mean leaves the cut
    // out: (20 + 22) / 2 = 21, not (6 + 20 + 22) / 3 = 16, which would divide week 3 by 1.1875 and pull H down to 16.5.
    const q = player({ 1: 18, 2: 20, 3: 19, 4: 6, 5: 20, 6: 22 }, { actual: { 1: 21, 2: 17, 3: 22 } });
    const prior = priorHealthyBaseRate(q, c);
    const mPrior = 19 / 21;
    expect(prior).toMatchObject({ projNow: 19, projWeek: 3, alpha: 0.125, games: 3, actualPpg: 20, source: "sleeper" });
    expect(prior.mNow).toBeCloseTo(mPrior, 12);
    expect(prior.b).toBeCloseTo(0.875 * (19 / mPrior) + 0.125 * 20, 12); // 20.875
    // Step 1's own base rate takes this week's reduced 6 (the week he's questionable), with the cut in the mean.
    expect(baseRate(q, c)).toMatchObject({ projNow: 6, projWeek: 4 });
    expect(weekShape(q, c.weeks).get(3)).toBeCloseTo(19 / 16, 12);
    // H doesn't move with this week's number, whatever Sleeper says: it is what S_now is compared with.
    for (const now of [null, 0.5, 6, 18, 30]) expect(priorHealthyBaseRate({ ...q, sleeper: { ...q.sleeper, 4: now } }, c).b, `now ${now}`).toBeCloseTo(prior.b, 12);
  });

  it("averages ESPN's value for that same week when the sources are averaged", () => {
    const q = player({ 3: 20, 4: 5 }, { espn: { 3: 22, 4: 4 } });
    expect(priorHealthyBaseRate(q, { ...c, weeks: [4], espnAveraged: true })).toMatchObject({ projNow: 21, projWeek: 3, source: "espn+sleeper" });
    expect(priorHealthyBaseRate(q, { ...c, weeks: [4] })).toMatchObject({ projNow: 20, source: "sleeper" });
  });

  it("hurt all season so far: his nearest later healthy week, not the season line ÷ 17, which counts the games he's expected to miss (Josh Jacobs)", () => {
    // Josh Jacobs's live inputs (rebuilt offline, league points): stubs in weeks 1–7 (his week-4 line is a stub too),
    // 10.28 from week 8, a bye in week 11; Sleeper's season line is 127.9 half-PPR points, 7.52 a game.
    const weeks = range(4, 17);
    const jacobs = player({ ...flat(range(1, 7), 0), 8: 10.28, 9: 9.65, 10: 8.14, 11: null, 12: 10.1, 13: 8.57, 14: 10.78, 15: 10.8, 16: 10.65, 17: 9.49 }, { sleeperSeasonPerGame: 7.52 });
    const h = priorHealthyBaseRate(jacobs, { currentWeek: 4, weeks, espnAveraged: true });
    expect(h).toMatchObject({ projNow: 10.28, projWeek: 8, source: "sleeper" });
    // The same as step 1's own base rate, which uses week 8 as well: the note's healthy rate is the rate he's projected at.
    expect(h.b).toBeCloseTo(baseRate(jacobs, { currentWeek: 4, weeks, espnAveraged: true }).b, 12);
    expect(h.b).toBeGreaterThan(9.5);
    // A later Sleeper week comes before ESPN's week and the season line, as in step 1.
    expect(priorHealthyBaseRate(player({ 3: null, 4: 15, 5: 16 }, { espn: { 3: 12 }, sleeperSeasonPerGame: 13.5 }), c)).toMatchObject({ projNow: 16, projWeek: 5, source: "sleeper" });
  });

  it("never looks at this week: falls back to ESPN's other weeks, Sleeper's season line, then points per game, then nothing", () => {
    expect(priorHealthyBaseRate(player({ 3: null, 4: 15 }, { espn: { 3: 12, 4: 14 } }), c)).toMatchObject({ projNow: 12, projWeek: 3, source: "espn" });
    expect(priorHealthyBaseRate(player({ 3: null, 4: 15 }, { espn: { 3: null, 4: 15 }, sleeperSeasonPerGame: 13.5 }), c)).toMatchObject({ projNow: 13.5, projWeek: null, source: "season" });
    expect(priorHealthyBaseRate(player({ 3: 0, 4: 15 }, { actual: { 1: 11, 2: 9 } }), c)).toMatchObject({ b: 10, source: "actual" });
    expect(priorHealthyBaseRate(player({ 4: 15 }), c)).toMatchObject({ b: 0, source: "none" });
    // Step 1's base rate would use this week's 15.
    expect(baseRate(player({ 4: 15 }), c)).toMatchObject({ projNow: 15, projWeek: 4 });
    // The inputs themselves aren't touched.
    const inputs = player({ 3: 20, 4: 6 }, { espn: { 4: 5 } });
    priorHealthyBaseRate(inputs, c);
    expect(inputs).toEqual(player({ 3: 20, 4: 6 }, { espn: { 4: 5 } }));
  });
});

describe("the Q/D/P base rate (§6 step 3; planner reply to Checkpoint 3, answer 5): this week's injury-cut projections count nowhere", () => {
  // Healthy before: 18, 20, 19 (week 3); this week Sleeper cut him to 6 (ESPN to 5); 20 and 22 after. Three games at 20 a game.
  const q = player({ 1: 18, 2: 20, 3: 19, 4: 6, 5: 20, 6: 22 }, { actual: { 1: 21, 2: 17, 3: 22 }, espn: { 3: 21, 4: 5 } });
  const c = ctx({ weeks: [4, 5, 6] });
  /** His tag's one-week table this week, then healthy (availability.ts; no future injury risk here). */
  const a = [0.85, 1, 1];

  it("b = gameTimeBaseRate: proj_now from his nearest later healthy week; this week's shape is 1; the other weeks' shapes leave the cut out of the mean", () => {
    const g = gameTimeBaseRate(q, c);
    // Week 5's 20 ÷ (20 / 21) = 21 (the shapes' mean leaves this week's 6 out: (20 + 22) / 2), blended with 20 a game.
    expect(g).toMatchObject({ projNow: 20, projWeek: 5, alpha: 0.125, games: 3, actualPpg: 20, source: "sleeper" });
    expect(g.mNow).toBeCloseTo(20 / 21, 12);
    expect(g.b).toBeCloseTo(0.875 * 21 + 0.125 * 20, 12); // 20.875
    // Nothing but the cut changed this week, so the week before (H: week 3's 19 ÷ (19 / 21)) gives the same rate.
    expect(g.b).toBeCloseTo(priorHealthyBaseRate(q, c).b, 12);
    for (const injury of ["QUESTIONABLE", "DOUBTFUL", "PROBABLE"] as const) {
      expect(usesHealthyBaseRate(injury)).toBe(true);
      const m = projectPlayer("q", "RB", q, a, { ...c, injury });
      expect(m.base, injury).toEqual(g);
      expect(m.weekly[0]?.m).toBe(1);
      expect(m.weekly[1]?.m).toBeCloseTo(20 / 21, 12);
      expect(m.weekly[2]?.m).toBeCloseTo(22 / 21, 12);
      // The tag's table, applied once: p = b × 1 × 0.85.
      expect(m.weekly[0]?.p).toBeCloseTo(g.b * 0.85, 12);
      expect(m.weekly[0]?.sd).toBeCloseTo(weeklySd(g.b * 0.85, "RB"), 12);
    }
    // This week's number never moves it, whatever Sleeper says.
    for (const now of [null, 0.5, 6, 18, 30]) expect(gameTimeBaseRate({ ...q, sleeper: { ...q.sleeper, 4: now } }, c).b, `now ${now}`).toBeCloseTo(g.b, 12);
  });

  it("a role that changed this week carries on: a backup promoted to starter keeps his new rate under a game-time tag (review of track A1)", () => {
    // 4 a week as a backup in weeks 1–3 (3, 5 and 4 points); this week he starts (13), and 14 a week from week 5 on.
    const promoted = player({ ...flat(range(1, 3), 4), 4: 13, ...flat(range(5, 17), 14) }, { actual: { 1: 3, 2: 5, 3: 4 } });
    const full = ctx();
    const untagged = projectPlayer("b", "RB", promoted, ones(WEEKS.length), full).base;
    expect(untagged.b).toBeCloseTo(0.875 * (195 / 14) + 0.125 * 4, 12); // step 1 reads this week's 13: 12.69
    for (const injury of ["PROBABLE", "QUESTIONABLE", "DOUBTFUL"] as const) {
      const m = projectPlayer("b", "RB", promoted, ones(WEEKS.length), { ...full, injury });
      // Week 5's 14 (every later week is 14: shape 1), blended with 4 a game: 0.875 × 14 + 0.125 × 4 = 12.75.
      expect(m.base, injury).toMatchObject({ projNow: 14, projWeek: 5, source: "sleeper" });
      expect(m.base.b).toBeCloseTo(12.75, 12);
    }
    // The latest earlier week first (lead decision L4 as first built: b = H) kept his backup's rate all season: week 3's 4
    // ÷ 0.8 (its shape clamped up), blended: 4.875. H keeps that order for the stale-date tiebreaker.
    expect(priorHealthyBaseRate(promoted, full)).toMatchObject({ projNow: 4, projWeek: 3 });
    expect(priorHealthyBaseRate(promoted, full).b).toBeCloseTo(0.875 * 5 + 0.125 * 4, 12);
  });

  it("Sleeper's live line for a questionable RB whose role grew (2026-09-30): his b matches the untagged one, not week 3's backup rate", () => {
    // Ollie Gordon (RB, MIA), half-PPR: 2.1, 2.3 and 3.2 in weeks 1–3, 7.34 this week, a bye (a stub) in week 6; 0.7 and 13
    // points in his two games (week 3's breakout).
    const gordon = player(
      { 1: 2.1, 2: 2.3, 3: 3.2, 4: 7.34, 5: 7.81, 6: null, 7: 6.59, 8: 6.55, 9: 7.73, 10: 6.58, 11: 7.34, 12: 6.65, 13: 6.45, 14: 7.41, 15: 6.9, 16: 5.88, 17: 7.41 },
      { actual: { 2: 0.7, 3: 13 } },
    );
    const full = ctx({ byeWeek: 6 });
    const later = [7.81, 6.59, 6.55, 7.73, 6.58, 7.34, 6.65, 6.45, 7.41, 6.9, 5.88, 7.41];
    const mean = later.reduce((sum, x) => sum + x, 0) / later.length; // 6.94: weeks 5–17 but his bye, this week left out
    const alpha = 0.25 * (2 / 6);
    const m = projectPlayer("gordon", "RB", gordon, ones(WEEKS.length), { ...full, injury: "QUESTIONABLE" });
    expect(m.base).toMatchObject({ projNow: 7.81, projWeek: 5, source: "sleeper" });
    expect(m.base.b).toBeCloseTo((1 - alpha) * mean + alpha * 6.85, 9); // 6.93
    const untagged = projectPlayer("gordon", "RB", gordon, ones(WEEKS.length), full).base;
    expect(Math.abs(m.base.b / untagged.b - 1)).toBeLessThan(0.01); // 6.96
    // Week 3's 3.2 ÷ 0.8 (clamped), blended: 4.24, 39% under.
    expect(priorHealthyBaseRate(gordon, full).b).toBeCloseTo((1 - alpha) * 4 + alpha * 6.85, 9);
  });

  it("a bye next week: the week after it; no later healthy week: the latest one before this week; then ESPN's other weeks, the season line, points per game, nothing", () => {
    expect(gameTimeBaseRate(player({ 3: 19, 4: 6, 5: null, 6: 22, 7: 20 }), ctx({ weeks: [4, 5, 6, 7] }))).toMatchObject({ projNow: 22, projWeek: 6, source: "sleeper" });
    // Sleeper has nothing for him after this week (stubs and a 0): his last healthy week before it.
    expect(gameTimeBaseRate(player({ 2: 18, 3: 19, 4: 6, 5: null, 6: 0 }), c)).toMatchObject({ projNow: 19, projWeek: 3, source: "sleeper" });
    // No healthy week before this one (Josh Jacobs's case): the first week Sleeper projects him again.
    expect(gameTimeBaseRate(player({ 1: 0, 2: 0, 3: 0, 4: 3, 5: null, 6: 10 }), c)).toMatchObject({ projNow: 10, projWeek: 6, b: 10 });
    expect(gameTimeBaseRate(player({ 3: null, 4: 15 }, { espn: { 3: 12, 4: 14 } }), c)).toMatchObject({ projNow: 12, projWeek: 3, source: "espn" });
    expect(gameTimeBaseRate(player({ 4: 15 }, { sleeperSeasonPerGame: 13.5 }), c)).toMatchObject({ projNow: 13.5, projWeek: null, source: "season" });
    expect(gameTimeBaseRate(player({ 3: 0, 4: 15 }, { actual: { 1: 11, 2: 9 } }), c)).toMatchObject({ b: 10, source: "actual" });
    expect(gameTimeBaseRate(player({ 4: 15 }), c)).toMatchObject({ b: 0, source: "none" });
  });

  it("every other status keeps step 1 (an OUT player's stub this week is never a base rate anyway), and so does a caller that gives no status", () => {
    const step1 = baseRate(q, c);
    expect(step1).toMatchObject({ projNow: 6, projWeek: 4, mNow: 0.8 }); // 6 ÷ (16) clamped up to 0.8
    for (const injury of ["ACTIVE", "OUT", "IR", "PUP", "SUSPENDED", "NA"] as const) {
      expect(usesHealthyBaseRate(injury)).toBe(false);
      expect(projectPlayer("q", "RB", q, a, { ...c, injury }).base, injury).toEqual(step1);
    }
    expect(usesHealthyBaseRate(undefined)).toBe(false);
    expect(projectPlayer("q", "RB", q, a, c).base).toEqual(step1);
    // Counting the cut twice (Phase 3: Sleeper's 6 in b, then the tag's 0.85 on top) gave him under half his points this week.
    const before = projectPlayer("q", "RB", q, a, c).weekly[0]?.p as number;
    const now = projectPlayer("q", "RB", q, a, { ...c, injury: "QUESTIONABLE" }).weekly[0]?.p as number;
    expect(before).toBeCloseTo(9.0625 * 0.8 * 0.85, 10);
    expect(now).toBeGreaterThan(2 * before);
  });

  it("ESPN leagues: a later week has no ESPN projection (the import carries ESPN's previous and current weeks), so b is Sleeper's; a week before this one averages the two", () => {
    const m = projectPlayer("q", "RB", q, a, { ...c, espnAveraged: true, injury: "QUESTIONABLE" });
    expect(m.base).toMatchObject({ projNow: 20, projWeek: 5, source: "sleeper" });
    expect(m.base).toEqual(gameTimeBaseRate(q, { ...c, espnAveraged: true }));
    // Without a later healthy week: his healthy week before this one, averaged with ESPN's value for it (not this week's cut).
    const onlyBefore = player({ 3: 19, 4: 6 }, { actual: { 1: 21, 2: 17, 3: 22 }, espn: { 3: 21, 4: 5 } });
    expect(projectPlayer("q", "RB", onlyBefore, [0.85], { ...c, weeks: [4], espnAveraged: true, injury: "QUESTIONABLE" }).base).toMatchObject({ projNow: 20, projWeek: 3, source: "espn+sleeper" });
  });

  it("the inputs aren't touched, and a week Sleeper didn't send gives what a cut one does", () => {
    const inputs = player({ 3: 20, 4: 6, 5: 20 }, { espn: { 4: 5 } });
    const cut = projectPlayer("q", "RB", inputs, [0.85, 1, 1], { ...c, injury: "DOUBTFUL" });
    expect(inputs).toEqual(player({ 3: 20, 4: 6, 5: 20 }, { espn: { 4: 5 } }));
    expect(projectPlayer("q", "RB", player({ 3: 20, 5: 20 }), [0.85, 1, 1], { ...c, injury: "DOUBTFUL" }).base).toEqual(cut.base);
  });
});

describe("staleReturnCheck (§6 step 3: Sleeper breaks the tie between ESPN's tag and its return date)", () => {
  const c = { currentWeek: 4, weeks: [4, 5, 6], espnAveraged: false };
  /** Healthy before: 20 a week, flat, so H = 20 exactly (no games played). */
  const withNow = (now: number | null) => player({ 1: 20, 2: 20, 3: 20, 4: now, 5: 20, 6: 20 });

  it("is stale when Sleeper projects him this week at staleReturnShare (50%) of his healthy base rate or more", () => {
    expect(config.projections.staleReturnShare).toBe(0.5);
    // Healthy before: 20 (week 3), and 20 in the weeks after: H = 20 whatever this week says (it's left out of the shape's mean).
    const q = withNow(18);
    expect(priorHealthyBaseRate(q, c).b).toBe(20);
    expect(staleReturnCheck(q, c)).toEqual({ sleeperNow: 18, healthyRate: 20, stale: true });
    expect(staleReturnCheck(withNow(4), c)).toEqual({ sleeperNow: 4, healthyRate: 20, stale: false });
  });

  it("the boundary: S_now exactly 50% of H is stale, a hair below isn't", () => {
    // H = 20: week 3's 20 against the later weeks' mean of 20 (this week's number isn't in it).
    const at = (now: number) => player({ 3: 20, 4: now, 5: 20, 6: 20 });
    expect(priorHealthyBaseRate(at(10), c).b).toBe(20);
    expect(staleReturnCheck(at(10), c)).toEqual({ sleeperNow: 10, healthyRate: 20, stale: true });
    expect(staleReturnCheck(at(9.99), c).stale).toBe(false);
  });

  it("a stub or 0 this week is never stale (follow the date); without a healthy base rate nothing is stale; the share comes from config", () => {
    expect(staleReturnCheck(withNow(null), c)).toMatchObject({ sleeperNow: null, stale: false });
    expect(staleReturnCheck(withNow(0), c)).toMatchObject({ sleeperNow: null, stale: false });
    // A week that didn't load (no key) is the same to the check: no tiebreaker (league.ts says why in the note).
    expect(staleReturnCheck(player({ 1: 20, 2: 20, 3: 20, 5: 20, 6: 20 }), c)).toEqual({ sleeperNow: null, healthyRate: 20, stale: false });
    expect(staleReturnCheck(player({ 4: 12 }), c)).toEqual({ sleeperNow: 12, healthyRate: null, stale: false });
    // H = 20: 90% of it is 18.
    const at = (now: number) => player({ 3: 20, 4: now, 5: 20, 6: 20 });
    const strict: ProjectionConfig = { ...config.projections, staleReturnShare: 0.9 };
    expect(staleReturnCheck(at(15), c, strict).stale).toBe(false);
    expect(staleReturnCheck(at(18), c, strict).stale).toBe(true);
  });

  it("the 50% bar is half his healthy rate, not half of a rate this week's own cut pulled down (review AVAIL-1/2)", () => {
    // Healthy 15 before and after; this week 7.2 (48% of 15). With the cut in the shape's mean (12.4), week 3's shape was
    // 1.2 and H 12.5, whose half 7.2 cleared.
    const q = player({ 1: 15, 2: 15, 3: 15, 4: 7.2, 5: 15, 6: 15 });
    expect(staleReturnCheck(q, c)).toEqual({ sleeperNow: 7.2, healthyRate: 15, stale: false });
    // Hurt all season (no healthy week before this one): H is his healthy weekly rate once back, not the season line ÷ 17.
    const late = player({ 1: null, 2: null, 3: null, 4: 4, 5: 10, 6: 10 }, { sleeperSeasonPerGame: 7.5 });
    expect(staleReturnCheck(late, c)).toEqual({ sleeperNow: 4, healthyRate: 10, stale: false }); // 4 < 5; against 7.5 ÷ 2 it was stale
  });
});

describe("projectPlayer (§6 steps 4 and 5)", () => {
  it("Parker-like half-PPR WR: p = b × m × a, σ = c × p + d, ESPN averaged, bye week 9", () => {
    const wr = player(
      { 1: 13.2, 2: 12.8, 3: 14.1, 4: 13.5, 5: 12, 6: 14.6, 7: 13, 8: 12.4, 9: null, 10: 15, 11: 13.8, 12: 12.2, 13: 14.4, 14: 13.1, 15: 12.7, 16: 14, 17: 13.3 },
      { espn: { 3: 14.6, 4: 13.9 }, actual: { 1: 18.4, 2: 7.9, 3: 15.2 } },
    );
    // Availability as src/engine/availability.ts would give it: healthy now, future injury risk, 0 on the bye.
    const a = [1, 0.97, 0.95, 0.93, 0.92, 0, 0.91, 0.9, 0.9, 0.89, 0.89, 0.89, 0.88, 0.88];
    const model = projectPlayer("wr1", "WR", wr, a, ctx({ espnAveraged: true, byeWeek: 9 }));

    const mean = 174 / 13; // his 13 projected remaining weeks (week 9 is his bye)
    const mNow = 13.5 / mean;
    const b = 0.875 * ((13.5 + 13.9) / 2 / mNow) + 0.125 * (41.5 / 3);
    expect(model.id).toBe("wr1");
    expect(model.value).toBeNull();
    expect(model.base).toMatchObject({ projNow: 13.7, projWeek: 4, games: 3, alpha: 0.125, source: "espn+sleeper" });
    expect(model.base.mNow).toBeCloseTo(mNow, 12);
    expect(model.base.b).toBeCloseTo(b, 10);
    expect(model.base.b).toBeCloseTo(13.6142, 4); // independent hand computation

    expect(model.weekly).toHaveLength(14);
    model.weekly.forEach((wk, i) => {
      const w = WEEKS[i]!;
      const m = w === 9 ? 1 : (wr.sleeper[w] as number) / mean;
      expect(wk.m).toBeCloseTo(m, 12);
      expect(wk.a).toBe(a[i]);
      expect(wk.p).toBeCloseTo(b * m * a[i]!, 10);
      expect(wk.bye).toBe(w === 9);
      expect(wk.sd).toBe(wk.p > 0 ? 0.5 * wk.p + 2 : 0);
    });
    expect(model.weekly[0]!.p).toBeCloseTo(13.7316, 4);
    expect(model.weekly[0]!.sd).toBeCloseTo(8.8658, 4);
    expect(model.weekly[5]).toEqual({ p: 0, a: 0, m: 1, bye: true, sd: 0 });

    expect(model.ros.total).toBeCloseTo(162.0936, 4);
    expect(model.ros.regular).toBeCloseTo(126.1606, 4);
    expect(model.ros.playoffs).toBeCloseTo(35.933, 4);
    expect(model.ros.total).toBeCloseTo(model.ros.regular + model.ros.playoffs, 10);
    expect(model.ros).toMatchObject({ gamesLeft: 13, gamesLeftRegular: 10, gamesLeftPlayoffs: 3, bye: { status: "upcoming", week: 9 } });
  });

  it("σ = c_pos × p + d_pos from config.projections.sigma (P follows K); 0 when he can't score", () => {
    expect(weeklySd(10, "QB")).toBeCloseTo(6, 12);
    expect(weeklySd(10, "RB")).toBeCloseTo(6.5, 12);
    expect(weeklySd(10, "TE")).toBeCloseTo(7, 12);
    expect(weeklySd(10, "P")).toBeCloseTo(weeklySd(10, "K"), 12);
    expect(weeklySd(8, "DEF")).toBeCloseTo(7, 12);
    expect(weeklySd(8, "LB")).toBeCloseTo(6, 12);
    expect(weeklySd(0, "RB")).toBe(0);
    const cfg: ProjectionConfig = { ...config.projections, sigma: { ...config.projections.sigma, WR: { c: 1, d: 0 } } };
    expect(weeklySd(10, "WR", cfg)).toBe(10);
  });

  it("a player with no projection scores 0 every week, with no spread", () => {
    const model = projectPlayer("x", "WR", player({}), ones(WEEKS.length), ctx());
    expect(model.base.source).toBe("none");
    expect(model.weekly.every((w) => w.p === 0 && w.sd === 0 && w.a === 1)).toBe(true);
    expect(model.ros).toMatchObject({ total: 0, gamesLeft: 14, bye: { status: "unknown" } });
  });

  it("availability must be aligned with the weeks", () => {
    expect(() => projectPlayer("x", "WR", player({ 4: 10 }), ones(3), ctx())).toThrow(/3 availability values for 14 weeks/);
  });
});

describe("rosSummary (§6 step 7)", () => {
  it("a player whose bye already passed gets credit for one more game than one whose bye is ahead", () => {
    // NFL week 10: remaining weeks 10–17 (regular 10–14, playoffs 15–17). Same player, flat 10 points a game.
    const weeks = range(10, 17);
    const c = (byeWeek: number) => ctx({ currentWeek: 10, weeks, byeWeek });
    const avail = (byeWeek: number) => weeks.map((w) => (w === byeWeek ? 0 : 1));
    const byeDone = projectPlayer("a", "WR", player(flat(range(7, 17), 10)), avail(7), c(7));
    const byeAhead = projectPlayer("b", "WR", player({ ...flat(range(7, 17), 10), 12: null }), avail(12), c(12));
    expect(byeDone.ros).toEqual({ total: 80, regular: 50, playoffs: 30, gamesLeft: 8, gamesLeftRegular: 5, gamesLeftPlayoffs: 3, bye: { status: "done" } });
    expect(byeAhead.ros).toEqual({ total: 70, regular: 40, playoffs: 30, gamesLeft: 7, gamesLeftRegular: 4, gamesLeftPlayoffs: 3, bye: { status: "upcoming", week: 12 } });
    expect(byeDone.ros.gamesLeft - byeAhead.ros.gamesLeft).toBe(1);
  });

  it("a bye this week is upcoming and not a game left; neither is a game that already kicked off this week", () => {
    const weekly = [{ p: 0 }, { p: 12 }, { p: 11 }];
    expect(rosSummary(weekly, [4, 5, 6], REGULAR, PLAYOFFS, 4, 4, false)).toMatchObject({ total: 23, gamesLeft: 2, bye: { status: "upcoming", week: 4 } });
    // Started: availability already zeroed this week's p (§6 step 3); the game doesn't count as left.
    expect(rosSummary(weekly, [4, 5, 6], REGULAR, PLAYOFFS, 9, 4, true)).toMatchObject({ total: 23, gamesLeft: 2, gamesLeftRegular: 2, bye: { status: "upcoming", week: 9 } });
    expect(rosSummary(weekly, [4, 5, 6], REGULAR, PLAYOFFS, 9, 4, false).gamesLeft).toBe(3);
  });

  it("without a known bye, the status is unknown and every remaining week counts", () => {
    expect(rosSummary([{ p: 5 }, { p: 5 }], [16, 17], REGULAR, PLAYOFFS, undefined, 16, false)).toEqual({
      total: 10,
      regular: 0,
      playoffs: 10,
      gamesLeft: 2,
      gamesLeftRegular: 0,
      gamesLeftPlayoffs: 2,
      bye: { status: "unknown" },
    });
  });

  it("a teamless player has no games left", () => {
    expect(rosSummary([{ p: 0 }, { p: 0 }], [4, 5], REGULAR, PLAYOFFS, undefined, 4, false, false)).toMatchObject({ gamesLeft: 0, gamesLeftRegular: 0, bye: { status: "unknown" } });
    const model = projectPlayer("fa", "RB", player({ 3: 8 }), [0, 0], ctx({ weeks: [4, 5], hasTeam: false }));
    expect(model.ros).toMatchObject({ total: 0, gamesLeft: 0 });
  });

  it("a week in neither the regular season nor the playoffs counts only in the totals", () => {
    // Regular season through week 13, playoffs 15–16: week 14 is a gap week.
    const s = rosSummary([{ p: 1 }, { p: 2 }, { p: 4 }, { p: 8 }], [13, 14, 15, 16], range(1, 13), [15, 16], 6, 13, false);
    expect(s).toMatchObject({ total: 15, regular: 1, playoffs: 12, gamesLeft: 4, gamesLeftRegular: 1, gamesLeftPlayoffs: 2, bye: { status: "done" } });
  });

  it("after the season (no remaining weeks) everything is 0", () => {
    expect(rosSummary([], [], REGULAR, PLAYOFFS, 9, 18, false)).toEqual({ total: 0, regular: 0, playoffs: 0, gamesLeft: 0, gamesLeftRegular: 0, gamesLeftPlayoffs: 0, bye: { status: "done" } });
  });

  it("weekly must be aligned with the weeks", () => {
    expect(() => rosSummary([{ p: 1 }], [4, 5], REGULAR, PLAYOFFS, undefined, 4, false)).toThrow(/1 weekly projections for 2 weeks/);
  });
});

describe("espnSleeperAgreement (§6 step 1, ESPN leagues)", () => {
  const both = (espn: number | null, sleeper: number | null, week = 4): PlayerInputs => player({ [week]: sleeper }, { espn: { [week]: espn } });

  it("Parker-like week 4: the sources agree when Σ|E − S| / Σ S ≤ espnSleeperAgreement", () => {
    const pairs: [number, number][] = [
      [13.9, 13.5],
      [21.2, 19.8],
      [6.1, 6.9],
      [9.4, 8.6],
      [15, 16.2],
    ];
    const players = Object.fromEntries(pairs.map(([e, s], i) => [`p${i}`, both(e, s)]));
    const r = espnSleeperAgreement(Object.keys(players), players, 4);
    expect(r.agreement).toEqual({ meanRelDiff: expect.closeTo(4.6 / 65, 12), players: 5, week: 4 });
    expect(r.agreement!.meanRelDiff).toBeCloseTo(0.0708, 4);
    expect(r.agree).toBe(true);
    expect(r.disagreements).toEqual([]);
  });

  it("is a ratio of sums, so a bench player's tiny projection doesn't sink the league", () => {
    // Relative gaps 5% and 200%: their mean (≈ 1.03) would fail; the ratio of sums (2 / 20.5 ≈ 0.098) passes.
    const players = { starter: both(21, 20), bench: both(1.5, 0.5) };
    const r = espnSleeperAgreement(["starter", "bench"], players, 4);
    expect(r.agreement!.meanRelDiff).toBeCloseTo(2 / 20.5, 12);
    expect(r.agree).toBe(true);
    expect(r.disagreements).toEqual([{ playerId: "bench", espn: 1.5, sleeper: 0.5, week: 4 }]); // still logged (> 40%)
  });

  it("counts only rostered players both sources project (> 0) in that week, each once", () => {
    const players: Record<string, PlayerInputs> = {
      ok: both(11, 10),
      espnZeroed: both(null, 12), // ESPN zeroes injured players
      espnZero: both(0, 12),
      noSleeper: both(9, null),
      otherWeek: both(15, 15, 5),
      noEspn: player({ 4: 10 }),
      freeAgent: both(30, 10),
    };
    const r = espnSleeperAgreement(["ok", "espnZeroed", "espnZero", "noSleeper", "otherWeek", "noEspn", "missing", "ok"], players, 4);
    expect(r.agreement).toEqual({ meanRelDiff: 0.1, players: 1, week: 4 });
  });

  it("agrees exactly at the threshold, not above it, and reads the threshold from config", () => {
    expect(espnSleeperAgreement(["a"], { a: both(11, 10) }, 4).agree).toBe(true); // 0.1
    expect(espnSleeperAgreement(["a"], { a: both(11.01, 10) }, 4).agree).toBe(false); // 0.101
    expect(espnSleeperAgreement(["a"], { a: both(8.99, 10) }, 4).agree).toBe(false);
    const cfg: ProjectionConfig = { ...config.projections, espnSleeperAgreement: 0.2 };
    expect(espnSleeperAgreement(["a"], { a: both(11.5, 10) }, 4, cfg).agree).toBe(true);
  });

  it("without any player projected by both, there is no agreement and nothing is averaged", () => {
    expect(espnSleeperAgreement(["a", "b"], { a: player({ 4: 10 }), b: both(null, 10) }, 4)).toEqual({ agree: false, agreement: null, disagreements: [] });
    expect(espnSleeperAgreement([], {}, 4)).toEqual({ agree: false, agreement: null, disagreements: [] });
  });

  it("logs players whose sources differ by more than sourceDisagreementLog of the larger value, largest gap first", () => {
    const players = {
      wr: both(5.66, 9.48), // 3.82 / 9.48 ≈ 0.403
      rb: both(14.82, 8.44), // 6.38 / 14.82 ≈ 0.430
      te: both(6, 10), // exactly 0.4: not more than
      qb: both(20, 21),
    };
    const r = espnSleeperAgreement(["wr", "rb", "te", "qb"], players, 4);
    expect(r.disagreements).toEqual([
      { playerId: "rb", espn: 14.82, sleeper: 8.44, week: 4 },
      { playerId: "wr", espn: 5.66, sleeper: 9.48, week: 4 },
    ]);
    expect(r.agree).toBe(false);
    const loose: ProjectionConfig = { ...config.projections, sourceDisagreementLog: 0.42 };
    expect(espnSleeperAgreement(["wr", "rb", "te", "qb"], players, 4, loose).disagreements.map((d) => d.playerId)).toEqual(["rb"]);
    // Equal gaps: by player id, whatever the roster order.
    const tied = { b: both(5, 10), a: both(10, 5) };
    expect(espnSleeperAgreement(["b", "a"], tied, 4).disagreements.map((d) => d.playerId)).toEqual(["a", "b"]);
  });

  describe("kickers and D/STs aside (planner reply to Checkpoint 7e, item 6: config.projections.espnSleeperAgreementExcluded)", () => {
    const at = (pos: Pos) => ({ pos });

    it("reads K and DEF from config", () => {
      expect(config.projections.espnSleeperAgreementExcluded).toEqual(["K", "DEF"]);
    });

    it("leaves the configured positions out of its sums and count, never out of the disagreement log", () => {
      // ESPN projects the kicker at twice Sleeper's line: he alone would sink the test.
      const players = { qb: both(20, 21), wr: both(10, 10), k: both(12, 6) };
      const ids = ["qb", "wr", "k"];
      const logged = [{ playerId: "k", espn: 12, sleeper: 6, week: 4 }]; // 6 / 12 = 0.5 > sourceDisagreementLog
      const everyone = espnSleeperAgreement(ids, players, 4);
      expect(everyone).toStrictEqual({ agree: false, agreement: { meanRelDiff: 7 / 37, players: 3, week: 4 }, disagreements: logged });
      const aside = espnSleeperAgreement(ids, players, 4, config.projections, { qb: at("QB"), wr: at("WR"), k: at("K") });
      expect(aside).toStrictEqual({ agree: true, agreement: { meanRelDiff: 1 / 31, players: 2, week: 4, leftOut: ["K"] }, leftOut: ["K"], disagreements: logged });
    });

    it("counts everyone without positions, with no or an empty exclusion list, or for an id the positions don't know", () => {
      const players = { qb: both(20, 21), k: both(12, 6) };
      const all = { agree: false, agreement: { meanRelDiff: 7 / 27, players: 2, week: 4 }, disagreements: [{ playerId: "k", espn: 12, sleeper: 6, week: 4 }] };
      const positions = { qb: at("QB"), k: at("K") };
      expect(espnSleeperAgreement(["qb", "k"], players, 4)).toStrictEqual(all);
      const empty: ProjectionConfig = { ...config.projections, espnSleeperAgreementExcluded: [] };
      expect(espnSleeperAgreement(["qb", "k"], players, 4, empty, positions)).toStrictEqual(all);
      const own: ProjectionConfig = { ...config.projections, espnSleeperAgreementExcluded: undefined };
      expect(espnSleeperAgreement(["qb", "k"], players, 4, own, positions)).toStrictEqual(all);
      expect(espnSleeperAgreement(["qb", "k"], players, 4, config.projections, { qb: at("QB") })).toStrictEqual(all);
    });

    it("is the test without positions bit for bit when no rostered player is at an excluded position", () => {
      const pairs: [number, number, Pos][] = [
        [13.9, 13.5, "QB"],
        [21.2, 19.8, "RB"],
        [6.1, 6.9, "WR"],
        [9.4, 8.6, "TE"],
        [15, 16.2, "WR"],
        [1.5, 0.5, "RB"],
      ];
      const players = Object.fromEntries(pairs.map(([e, s], i) => [`p${i}`, both(e, s)]));
      const positions = Object.fromEntries(pairs.map(([, , pos], i) => [`p${i}`, at(pos)]));
      const without = espnSleeperAgreement(Object.keys(players), players, 4);
      expect(espnSleeperAgreement(Object.keys(players), players, 4, config.projections, positions)).toStrictEqual(without);
    });

    it("lists the positions left out in the config's order, whatever the roster order, and compares nobody when only they have both", () => {
      const players = { d: both(4, 5), k: both(12, 6), qb: both(null, 20) };
      const positions = { d: at("DEF"), k: at("K"), qb: at("QB") };
      expect(espnSleeperAgreement(["d", "k", "qb"], players, 4, config.projections, positions)).toStrictEqual({
        agree: false,
        agreement: null,
        leftOut: ["K", "DEF"],
        disagreements: [{ playerId: "k", espn: 12, sleeper: 6, week: 4 }],
      });
      // A kicker without both projections is no kicker left out.
      const withQb = { ...players, qb: both(21, 20), k: both(12, null) };
      expect(espnSleeperAgreement(["d", "k", "qb"], withQb, 4, config.projections, positions)).toStrictEqual({
        agree: true,
        agreement: { meanRelDiff: 1 / 20, players: 1, week: 4, leftOut: ["DEF"] },
        leftOut: ["DEF"],
        disagreements: [],
      });
    });
  });

  describe("questionable, doubtful and probable players aside (planner reply to Checkpoint 7f, answer 4: config.projections.espnSleeperAgreementExcludedStatuses)", () => {
    const tagged = (pos: Pos, injury: InjuryStatus) => ({ pos, injury });

    it("reads them from config: exactly the statuses the Q/D/P base rate takes (usesHealthyBaseRate), so a player is left out of the test exactly when his base rate leaves this week out", () => {
      const statuses = config.projections.espnSleeperAgreementExcludedStatuses;
      expect(statuses).toEqual(["QUESTIONABLE", "DOUBTFUL", "PROBABLE"]);
      for (const status of INJURY_STATUSES) expect(statuses.includes(status), status).toBe(usesHealthyBaseRate(status));
    });

    it("this week's ESPN line, the one the test compares, never reaches a tagged player's base rate, averaged or not (the planner's “their ESPN numbers never reach a base rate”)", () => {
      // Sleeper cuts him this week (6) and projects him healthy from next week (15); ESPN projects only this week and last.
      const sleeper = { 1: 14, 2: 15, 3: 16, ...flat(range(4, 17), 15), 4: 6 };
      for (const injury of config.projections.espnSleeperAgreementExcludedStatuses) {
        for (const espnAveraged of [true, false]) {
          const at = (espnNow: number) => projectPlayer("q", "RB", player(sleeper, { espn: { 3: 17, 4: espnNow } }), ones(WEEKS.length), ctx({ injury, espnAveraged }));
          const low = at(3);
          const high = at(60);
          expect(high.base, `${injury}, averaged ${espnAveraged}`).toStrictEqual(low.base);
          expect(high.weekly, `${injury}, averaged ${espnAveraged}`).toStrictEqual(low.weekly);
          // His nearest later healthy week, week 5: Sleeper's (ESPN doesn't project it), with this week's shape 1.
          expect(low.base).toMatchObject({ projWeek: 5, projNow: 15, source: "sleeper" });
        }
      }
      // An untagged player's base rate does read it, once the sources are averaged: that's what the test is for.
      const untagged = (espnNow: number) => projectPlayer("a", "RB", player(sleeper, { espn: { 3: 17, 4: espnNow } }), ones(WEEKS.length), ctx({ espnAveraged: true }));
      expect(untagged(3).base.b).not.toBe(untagged(60).base.b);
    });

    it("leaves them out of its sums and count, never out of the disagreement log, and a tagged kicker as a kicker", () => {
      // Sleeper cuts the questionable RB this week and ESPN doesn't: he alone would sink the test.
      const players = { qb: both(20, 21), wr: both(10, 10), rb: both(14, 7), k: both(12, 6) };
      const ids = ["qb", "wr", "rb", "k"];
      const info = { qb: tagged("QB", "ACTIVE"), wr: tagged("WR", "ACTIVE"), rb: tagged("RB", "QUESTIONABLE"), k: tagged("K", "QUESTIONABLE") };
      // 7 / 14 = 0.5 and 6 / 12 = 0.5: both still logged (> sourceDisagreementLog), by id on the tie.
      const logged = [
        { playerId: "k", espn: 12, sleeper: 6, week: 4 },
        { playerId: "rb", espn: 14, sleeper: 7, week: 4 },
      ];
      expect(espnSleeperAgreement(ids, players, 4)).toStrictEqual({ agree: false, agreement: { meanRelDiff: 14 / 44, players: 4, week: 4 }, disagreements: logged });
      expect(espnSleeperAgreement(ids, players, 4, config.projections, info)).toStrictEqual({
        agree: true,
        agreement: { meanRelDiff: 1 / 31, players: 2, week: 4, leftOut: ["K"], leftOutStatuses: ["QUESTIONABLE"] },
        leftOut: ["K"],
        leftOutStatuses: ["QUESTIONABLE"],
        disagreements: logged,
      });
      // The kicker alone tagged: left out as a kicker, so no status is named.
      const kickerOnly = { ...info, rb: tagged("RB", "ACTIVE") };
      expect(espnSleeperAgreement(["qb", "wr", "k"], players, 4, config.projections, kickerOnly)).toStrictEqual({
        agree: true,
        agreement: { meanRelDiff: 1 / 31, players: 2, week: 4, leftOut: ["K"] },
        leftOut: ["K"],
        disagreements: [{ playerId: "k", espn: 12, sleeper: 6, week: 4 }],
      });
    });

    it("counts every other status (ACTIVE, OUT, IR, PUP, SUSPENDED, NA) and a player without one; lists the statuses left out in the config's order", () => {
      const others = INJURY_STATUSES.filter((s) => !usesHealthyBaseRate(s));
      expect(others).toEqual(["ACTIVE", "OUT", "IR", "PUP", "SUSPENDED", "NA"]);
      const players = Object.fromEntries([...others, "none"].map((s) => [s, both(11, 10)]));
      const info = Object.fromEntries(others.map((s) => [s, tagged("WR", s)]));
      const all = espnSleeperAgreement(Object.keys(players), players, 4, config.projections, { ...info, none: { pos: "WR" } });
      expect(all).toStrictEqual(espnSleeperAgreement(Object.keys(players), players, 4));
      expect(all.agreement?.players).toBe(others.length + 1);
      // Probable before doubtful in the roster, the config's order in the result.
      const mixed = { p: both(20, 10), d: both(9, 18), a: both(10, 10) };
      expect(espnSleeperAgreement(["p", "d", "a"], mixed, 4, config.projections, { p: tagged("WR", "PROBABLE"), d: tagged("TE", "DOUBTFUL"), a: tagged("QB", "ACTIVE") })).toMatchObject({
        agree: true,
        agreement: { meanRelDiff: 0, players: 1, week: 4, leftOutStatuses: ["DOUBTFUL", "PROBABLE"] },
        leftOutStatuses: ["DOUBTFUL", "PROBABLE"],
      });
    });

    it("compares nobody when only left-out players have both, and is the test of Checkpoint 7f with no or an empty status list", () => {
      const players = { q: both(14, 7), k: both(12, 6), out: both(null, 20) };
      const info = { q: tagged("RB", "QUESTIONABLE"), k: tagged("K", "ACTIVE"), out: tagged("WR", "OUT") };
      const logged = [
        { playerId: "k", espn: 12, sleeper: 6, week: 4 },
        { playerId: "q", espn: 14, sleeper: 7, week: 4 },
      ];
      expect(espnSleeperAgreement(["q", "k", "out"], players, 4, config.projections, info)).toStrictEqual({ agree: false, agreement: null, leftOut: ["K"], leftOutStatuses: ["QUESTIONABLE"], disagreements: logged });
      // Checkpoint 7f's test: the questionable RB counts (7 / 7 = 100%).
      const before = { agree: false, agreement: { meanRelDiff: 1, players: 1, week: 4, leftOut: ["K"] }, leftOut: ["K"], disagreements: logged };
      for (const list of [[], undefined]) {
        const cfg: ProjectionConfig = { ...config.projections, espnSleeperAgreementExcludedStatuses: list };
        expect(espnSleeperAgreement(["q", "k", "out"], players, 4, cfg, info)).toStrictEqual(before);
      }
    });
  });
});

describe("agreementAside and agreementPercent: the averaging test in words (Checkpoint 7f)", () => {
  it("names the positions left aside, a team defense as ESPN's D/ST", () => {
    expect(agreementAside(undefined)).toBe("");
    expect(agreementAside([])).toBe("");
    expect(agreementAside(["K"])).toBe(", kickers aside");
    expect(agreementAside(["DEF"])).toBe(", D/STs aside");
    expect(agreementAside(["K", "DEF"])).toBe(", kickers and D/STs aside");
    expect(agreementAside(["P", "K", "DEF"])).toBe(", punters, kickers and D/STs aside");
    expect(agreementAside(["QB"])).toBe(", QBs aside");
  });

  it("names the injury tags left aside after the positions, as one group of players (Checkpoint 7g; planner reply to Checkpoint 7f, answer 4)", () => {
    expect(agreementAside(["K", "DEF"], ["QUESTIONABLE"])).toBe(", kickers, D/STs and questionable players aside");
    expect(agreementAside(["K", "DEF"], ["QUESTIONABLE", "DOUBTFUL"])).toBe(", kickers, D/STs and questionable or doubtful players aside");
    expect(agreementAside(["K"], ["QUESTIONABLE", "DOUBTFUL", "PROBABLE"])).toBe(", kickers and questionable, doubtful or probable players aside");
    expect(agreementAside([], ["DOUBTFUL"])).toBe(", doubtful players aside");
    expect(agreementAside(undefined, ["PROBABLE"])).toBe(", probable players aside");
    expect(agreementAside(["K", "DEF"], [])).toBe(", kickers and D/STs aside");
    expect(agreementAside(undefined, undefined)).toBe("");
    // The list alone (the League page's "though kickers and D/STs are averaged too").
    expect(agreementLeftOutText(["K", "DEF"])).toBe("kickers and D/STs");
    expect(agreementLeftOutText(["K", "DEF"], ["QUESTIONABLE"])).toBe("kickers, D/STs and questionable players");
    expect(agreementLeftOutText([], [])).toBe("");
  });

  it("prints a whole percent, or one decimal when that whole percent is the bar's, so a gap beside the bar never reads as the bar", () => {
    // Oct 9 (week 5): 10.03% with kickers and D/STs, 9.86% without; both read "10%" as whole percents.
    expect(agreementPercent(0.09855)).toBe("9.9%");
    expect(agreementPercent(config.projections.espnSleeperAgreement)).toBe("10.0%");
    expect(agreementPercent(0.095)).toBe("9.5%");
    expect(agreementPercent(0.1049)).toBe("10.5%");
    // Away from the bar: whole percents, as before.
    expect(agreementPercent(0.0949)).toBe("9%");
    expect(agreementPercent(0.11684)).toBe("12%");
    expect(agreementPercent(1 / 30)).toBe("3%");
    // Another bar.
    expect(agreementPercent(0.2, 0.2)).toBe("20.0%");
    expect(agreementPercent(0.1, 0.2)).toBe("10%");
  });

  it("prints two decimals where one would be the bar's, so a gap from 10.00% to 10.05% never reads “10.0%, more than the 10% we allow” (review of Checkpoint 7f, AVERAGING-1)", () => {
    // Oct 9 with kickers and D/STs, 10.026%: it read "10.0%" beside "more than the 10% we allow".
    expect(agreementPercent(0.10026)).toBe("10.03%");
    expect(agreementPercent(0.1003)).toBe("10.03%");
    expect(agreementPercent(0.10049)).toBe("10.05%");
    expect(agreementPercent(0.0996)).toBe("9.96%");
    expect(agreementPercent(0.09951)).toBe("9.95%");
    // ⚠️ Ours: within 0.005 points of the bar, the nearest hundredth on the verdict's side (two decimals would print the bar).
    expect(agreementPercent(0.10001)).toBe("10.01%");
    expect(agreementPercent(0.100049)).toBe("10.01%");
    expect(agreementPercent(0.099951)).toBe("9.99%");
    // The bar itself: one decimal (it passes: within).
    expect(agreementPercent(0.1)).toBe("10.0%");
    // Every gap in the band reads on its own side of the bar: over the bar above 10, under it below, never 10 itself.
    const bar = config.projections.espnSleeperAgreement;
    for (let k = 1; k < 500; k++)
      for (const gap of [bar + k * 1e-6, bar - k * 1e-6]) {
        const text = agreementPercent(gap);
        const shown = Number.parseFloat(text);
        expect(shown, `${gap} → ${text}`).not.toBe(bar * 100);
        expect(shown > bar * 100, `${gap} → ${text}`).toBe(gap > bar);
      }
  });
});

describe("baseRateSourceCounts (ProjectionSummary.sources)", () => {
  it("counts players by base-rate source, every source present", () => {
    const models = [
      baseRate(player({ 4: 10 }), { currentWeek: 4, weeks: [4], espnAveraged: false }),
      baseRate(player({ 4: 10 }), { currentWeek: 4, weeks: [4], espnAveraged: false }),
      baseRate(player({}, { actual: { 1: 3 } }), { currentWeek: 4, weeks: [4], espnAveraged: false }),
    ].map((base) => ({ base }));
    expect(baseRateSourceCounts(models)).toEqual({ "espn+sleeper": 0, sleeper: 2, espn: 0, season: 0, actual: 1, none: 0 });
  });
});
