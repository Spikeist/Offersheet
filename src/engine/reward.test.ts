/**
 * League prizes (src/engine/reward.ts; CLAUDE.md §10; planner reply to Checkpoint 7b, §6; the lead's reward engine contract
 * for Checkpoint 7c): prize shares with the weekly high score counted once per prize period, Parker's split, whole percents
 * by the largest remainder, the league's prize periods (an ESPN period of several weeks once, a points-only league by its
 * weeks), ΔE[S] reading only the prizes that pay, the weekly change of runs made without the high scores (unknown, refused
 * under a split that pays them), and whether a prize can still move (the places the final standings decide included). Made-up
 * leagues and Parker's sanitized ESPN fixture (placeholders).
 */
import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { NOW, PARKER, fakeResolver, parkerBundle } from "@/adapters/espn/test-helpers";
import type { TeamOdds } from "./leagueModel";
import type { LeagueSnapshot, Matchup } from "./model";
import {
  TITLE_ONLY,
  assertWeeklyMeasured,
  isTitleOnly,
  paidPrizesKnown,
  paysWeekly,
  prizeDeltas,
  prizeOddsOf,
  prizePercents,
  prizePeriods,
  prizeShares,
  prizeStillMovable,
  rewardOf,
  rewardWith,
  runPrizeDeltas,
  shareChange,
  titleDeltas,
  type PrizeDeltas,
  type PrizeOdds,
  type PrizeShares,
} from "./reward";
import { PRIZE_KEYS, defaultTradeSettings, type PrizeAmounts } from "./settings";

const amounts = (a: Partial<Record<keyof PrizeAmounts, number | null>>): PrizeAmounts => ({ first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null, ...a });
const PARKER_PRIZES = amounts({ first: 2000, second: 1600, third: 900 });

/** A snapshot with only what prizePeriods reads. */
function season(regular: number[], schedule: Matchup[], pointsOnly = false): Pick<LeagueSnapshot, "settings" | "schedule"> {
  return { settings: { regularSeasonWeeks: regular, pointsOnly } as LeagueSnapshot["settings"], schedule };
}
const game = (week: number, a: string, b: string | null, extra: Partial<Matchup> = {}): Matchup => ({ week, teamA: a, teamB: b, isPlayoff: false, ...extra });

describe("prizeShares: each prize's amount ÷ the season's total, the weekly high score counted once per prize period", () => {
  it("Parker's 2000 / 1600 / 900: 4/9, 16/45 and 1/5; whole percents 44 / 36 / 20", () => {
    const s = prizeShares(PARKER_PRIZES, 14) as PrizeShares;
    expect(s).toStrictEqual({ first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 });
    expect(prizePercents(s)).toStrictEqual({ first: 44, second: 36, third: 20, weeklyHigh: 0, pointsLeader: 0 });
  });

  it("the weekly high score × the periods in the total; blanks pay nothing; the shares add up to 1", () => {
    // 60 + 30 + 10 + 5 × 14 + 30 = 200.
    const s = prizeShares(amounts({ first: 60, second: 30, third: 10, weeklyHigh: 5, pointsLeader: 30 }), 14) as PrizeShares;
    expect(s).toStrictEqual({ first: 0.3, second: 0.15, third: 0.05, weeklyHigh: 0.35, pointsLeader: 0.15 });
    expect(PRIZE_KEYS.reduce((sum, k) => sum + s[k], 0)).toBeCloseTo(1, 12);
    // The prefilled split (planner: "Prefilled: 60 / 30 / 10, with the rest blank").
    expect(prizeShares(defaultTradeSettings().prizes, 14)).toStrictEqual({ first: 0.6, second: 0.3, third: 0.1, weeklyHigh: 0, pointsLeader: 0 });
    // Dollars or percent, one unit for all: only the split matters.
    expect(prizeShares(amounts({ first: 2, second: 1 }), 14)).toStrictEqual(prizeShares(amounts({ first: 200, second: 100 }), 14));
    // No prize period (no regular season): the weekly prize counts nothing.
    expect(prizeShares(amounts({ first: 50, weeklyHigh: 10 }), 0)).toStrictEqual({ first: 1, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 });
  });

  it("nothing paid (all blank, zeros, or junk that isn't a positive number): null", () => {
    expect(prizeShares(amounts({}), 14)).toBeNull();
    expect(prizeShares(amounts({ first: 0, second: 0 }), 14)).toBeNull();
    expect(prizeShares(amounts({ weeklyHigh: 10 }), 0)).toBeNull();
    expect(prizeShares(amounts({ first: -5, second: Number.NaN, third: Number.POSITIVE_INFINITY }), 14)).toBeNull();
  });
});

describe("prizePercents: whole percents adding up to 100 by the largest remainder", () => {
  it("ties go in PRIZE_KEYS order; unpaid prizes stay 0; every result adds up to 100", () => {
    expect(prizePercents({ first: 1 / 3, second: 1 / 3, third: 1 / 3, weeklyHigh: 0, pointsLeader: 0 })).toStrictEqual({ first: 34, second: 33, third: 33, weeklyHigh: 0, pointsLeader: 0 });
    expect(prizePercents(TITLE_ONLY)).toStrictEqual({ first: 100, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 });
    expect(prizePercents({ first: 0.125, second: 0.125, third: 0.125, weeklyHigh: 0.5, pointsLeader: 0.125 })).toStrictEqual({ first: 13, second: 13, third: 12, weeklyHigh: 50, pointsLeader: 12 });
    // Random splits: always 100, each within a point of its exact share, 0 exactly where nothing is paid.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const a = amounts({ first: rand() * 5000, second: i % 3 ? rand() * 3000 : null, third: rand() * 900, weeklyHigh: i % 2 ? rand() * 40 : null, pointsLeader: i % 5 ? null : rand() * 700 });
      const s = prizeShares(a, 13) as PrizeShares;
      const p = prizePercents(s);
      expect(PRIZE_KEYS.reduce((sum, k) => sum + p[k], 0)).toBe(100);
      for (const k of PRIZE_KEYS) {
        expect(Math.abs(p[k] - 100 * s[k])).toBeLessThan(1);
        if (s[k] === 0) expect(p[k]).toBe(0);
      }
    }
  });
});

describe("prizePeriods: the league's regular-season prize periods", () => {
  it("one per regular-season week in a league of one-week matchups; Parker's league: 14", () => {
    const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
    expect(snapshot.settings.regularSeasonWeeks).toHaveLength(14);
    expect(prizePeriods(snapshot)).toBe(14);
    expect(rewardOf({ goal: "prizes", prizes: PARKER_PRIZES }, snapshot)).toMatchObject({ goal: "prizes", periods: 14, empty: false, shares: { first: 4 / 9, second: 16 / 45, third: 1 / 5 } });
  });

  it("an ESPN matchup period of several NFL weeks counts once; playoff games never count", () => {
    const s = season([1, 2, 3, 4, 5, 6], [
      game(1, "1", "2"),
      game(1, "3", "4"),
      game(2, "1", "3"),
      game(3, "1", "4", { weeks: [3, 4] }),
      game(3, "2", "3", { weeks: [3, 4] }),
      game(5, "1", "2", { weeks: [5, 6] }),
      game(7, "1", "2", { isPlayoff: true }),
    ]);
    // Periods: week 1, week 2, weeks 3–4, weeks 5–6.
    expect(prizePeriods(s)).toBe(4);
  });

  it("a regular-season week no listed matchup covers counts one (⚠️ ours); none listed: the regular-season weeks", () => {
    expect(prizePeriods(season([1, 2, 3, 4], [game(1, "1", "2"), game(2, "1", "2")]))).toBe(4);
    expect(prizePeriods(season([1, 2, 3, 4, 5], []))).toBe(5);
    // A bye (no opponent) still makes its week a period.
    expect(prizePeriods(season([1, 2], [game(1, "1", null), game(2, "1", "2")]))).toBe(2);
  });

  it("a points-only league: its regular-season weeks, whatever the schedule lists", () => {
    expect(prizePeriods(season([1, 2, 3], [game(1, "1", "2", { weeks: [1, 2] })], true))).toBe(3);
  });
});

describe("rewardOf: what the goal pays for", () => {
  const snap = season([1, 2, 3, 4], []);
  it("“Only the champion” and “Making the playoffs” pay 1st place everything, whatever prizes are stored", () => {
    for (const goal of ["title", "playoffs"] as const) {
      expect(rewardOf({ goal, prizes: PARKER_PRIZES }, snap)).toStrictEqual({ goal, shares: TITLE_ONLY, periods: 4, empty: false });
    }
    expect(isTitleOnly(TITLE_ONLY)).toBe(true);
  });

  it("“Several prizes”: the league's split; nothing entered reads as 1st place paying everything, marked empty", () => {
    const r = rewardOf({ goal: "prizes", prizes: amounts({ first: 50, weeklyHigh: 5 }) }, snap);
    expect(r).toStrictEqual({ goal: "prizes", shares: { first: 50 / 70, second: 0, third: 0, weeklyHigh: 20 / 70, pointsLeader: 0 }, periods: 4, empty: false });
    expect(isTitleOnly(r.shares)).toBe(false);
    expect(rewardOf({ goal: "prizes", prizes: amounts({}) }, snap)).toStrictEqual({ goal: "prizes", shares: TITLE_ONLY, periods: 4, empty: true });
    // 1st alone entered: the same split as "Only the champion", not empty.
    const solo = rewardOf({ goal: "prizes", prizes: amounts({ first: 100 }) }, snap);
    expect(solo).toMatchObject({ empty: false });
    expect(isTitleOnly(solo.shares)).toBe(true);
    expect(rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14)).toStrictEqual(rewardOf({ goal: "prizes", prizes: PARKER_PRIZES }, season(Array.from({ length: 14 }, (_, i) => i + 1), [])));
  });
});

describe("prize components and ΔE[S]", () => {
  const before: PrizeOdds = { first: 0.1, second: 0.08, third: 0.11, weeklyHigh: 1.2, pointsLeader: 0.15 };
  const after: PrizeOdds = { first: 0.12, second: 0.09, third: 0.1, weeklyHigh: 1.5, pointsLeader: 0.2 };

  it("prizeOddsOf reads TeamOdds' components; prizeDeltas subtracts them, null where either side is unknown", () => {
    const t = { pTitle: 0.1, pSecond: 0.08, pThird: null, expHighScores: 1.2, pPointsLeader: 0.15 } as Pick<TeamOdds, "pTitle" | "pSecond" | "pThird" | "expHighScores" | "pPointsLeader">;
    expect(prizeOddsOf(t)).toStrictEqual({ first: 0.1, second: 0.08, third: null, weeklyHigh: 1.2, pointsLeader: 0.15 });
    // A TeamOdds made before Checkpoint 7c: 2nd and 3rd unknown, no high scores, no points title.
    expect(prizeOddsOf({ pTitle: 0.3 })).toStrictEqual({ first: 0.3, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 });
    expect(prizeDeltas(before, after)).toStrictEqual({ first: 0.12 - 0.1, second: 0.09 - 0.08, third: 0.1 - 0.11, weeklyHigh: 1.5 - 1.2, pointsLeader: 0.2 - 0.15 });
    expect(prizeDeltas({ ...before, third: null }, after).third).toBeNull();
    expect(prizeDeltas(before, { ...after, second: Number.NaN }).second).toBeNull();
  });

  it("shareChange: Σ share × Δ over the prizes that pay, the weekly high score per prize period", () => {
    const r = rewardWith({ goal: "prizes", prizes: amounts({ first: 60, second: 30, third: 10, weeklyHigh: 5, pointsLeader: 30 }) }, 14);
    const d = prizeDeltas(before, after);
    const want = 0.3 * (d.first as number) + 0.15 * (d.second as number) + 0.05 * (d.third as number) + (0.35 / 14) * (d.weeklyHigh as number) + 0.15 * (d.pointsLeader as number);
    expect(shareChange(d, r)).toBeCloseTo(want, 15);
  });

  it("reads only the prizes that pay: TITLE_ONLY gives exactly ΔCH, whatever the other components hold", () => {
    const title = rewardWith({ goal: "title", prizes: PARKER_PRIZES }, 14);
    for (const dCH of [0.0123, -0.004, 0, 1e-17]) {
      const junk: PrizeDeltas = { first: dCH, second: Number.NaN, third: null, weeklyHigh: Number.POSITIVE_INFINITY, pointsLeader: null };
      expect(shareChange(junk, title)).toBe(dCH);
      expect(shareChange(titleDeltas(dCH), title)).toBe(dCH);
    }
    // A split without 3rd place doesn't need its odds; one with it does.
    const twoPlaces = rewardWith({ goal: "prizes", prizes: amounts({ first: 70, second: 30 }) }, 14);
    expect(shareChange({ first: 0.01, second: 0.02, third: null, weeklyHigh: null, pointsLeader: null }, twoPlaces)).toBeCloseTo(0.7 * 0.01 + 0.3 * 0.02, 15);
    expect(shareChange({ first: 0.01, second: 0.02, third: null, weeklyHigh: null, pointsLeader: null }, rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14))).toBeNull();
    // A paid component unknown: null; a reward paying nothing at all reads 0.
    expect(shareChange(titleDeltas(null), title)).toBeNull();
    expect(shareChange(null, title)).toBeNull();
    expect(shareChange({}, { shares: { first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 }, periods: 14 })).toBe(0);
  });

  it("paidPrizesKnown: every prize that pays has known odds", () => {
    const parker = rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14);
    expect(paidPrizesKnown(before, parker)).toBe(true);
    expect(paidPrizesKnown({ ...before, third: null }, parker)).toBe(false);
    expect(paidPrizesKnown({ ...before, third: null }, rewardWith({ goal: "title", prizes: PARKER_PRIZES }, 14))).toBe(true);
    expect(paidPrizesKnown({ ...before, first: null, second: null, third: null }, rewardWith({ goal: "prizes", prizes: amounts({ weeklyHigh: 5, pointsLeader: 20 }) }, 14))).toBe(true);
  });
});

describe("runPrizeDeltas and assertWeeklyMeasured: a weekly change only from runs that simulated the high scores (the review of the reward engine, compat-R1)", () => {
  const before: PrizeOdds = { first: 0.1, second: 0.08, third: 0.11, weeklyHigh: 0, pointsLeader: 0.15 };
  const after: PrizeOdds = { first: 0.12, second: 0.09, third: 0.1, weeklyHigh: 0, pointsLeader: 0.2 };
  const weekly = rewardWith({ goal: "prizes", prizes: amounts({ first: 50, weeklyHigh: 10 }) }, 8);

  it("runs without the high scores: the weekly change is unknown, not 0; the rest is prizeDeltas", () => {
    expect(runPrizeDeltas(before, after, true)).toStrictEqual(prizeDeltas(before, after));
    expect(runPrizeDeltas(before, after, true).weeklyHigh).toBe(0);
    expect(runPrizeDeltas(before, after, false)).toStrictEqual({ ...prizeDeltas(before, after), weeklyHigh: null });
    // So a split paying the weekly high score can't read them; one that doesn't still does, bit for bit.
    expect(shareChange(runPrizeDeltas(before, after, false), weekly)).toBeNull();
    expect(shareChange(runPrizeDeltas(before, after, false), rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14))).toBe(shareChange(prizeDeltas(before, after), rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14)));
    expect(paysWeekly(weekly)).toBe(true);
    expect([paysWeekly(rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14)), paysWeekly({ shares: TITLE_ONLY }), paysWeekly(null), paysWeekly(undefined)]).toEqual([false, false, false, false]);
  });

  it("assertWeeklyMeasured throws only for a made run without the weekly change, under a reward that pays it", () => {
    const blind = { dPO: 0.05, dPrizes: runPrizeDeltas(before, after, false) };
    expect(() => assertWeeklyMeasured(weekly, blind, "These runs")).toThrow(/These runs didn't simulate the weekly high scores this reward pays/);
    // A run made before Checkpoint 7c (no prize components at all) can't be priced under it either.
    expect(() => assertWeeklyMeasured(weekly, { dPO: 0.05 }, "Old runs")).toThrow(/Old runs/);
    // Fine: the high scores simulated; a reward that doesn't pay them; a run that wasn't made (no ΔPO: no odds).
    expect(() => assertWeeklyMeasured(weekly, { dPO: 0.05, dPrizes: runPrizeDeltas(before, after, true) }, "x")).not.toThrow();
    for (const r of [rewardWith({ goal: "title", prizes: PARKER_PRIZES }, 14), rewardWith({ goal: "prizes", prizes: PARKER_PRIZES }, 14)]) expect(() => assertWeeklyMeasured(r, blind, "x")).not.toThrow();
    expect(() => assertWeeklyMeasured(weekly, { dPO: Number.NaN, dPrizes: blind.dPrizes }, "x")).not.toThrow();
    expect(() => assertWeeklyMeasured(weekly, { dPO: null }, "x")).not.toThrow();
  });
});

describe("prizeStillMovable: whether a team's trades can still change its share of the prizes", () => {
  const title = { shares: TITLE_ONLY };
  const weekly = { shares: { first: 0.5, second: 0, third: 0, weeklyHigh: 0.5, pointsLeader: 0 } };
  const leader = { shares: { first: 0.5, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0.5 } };
  const places = { shares: { first: 0.6, second: 0.3, third: 0.1, weeklyHigh: 0, pointsLeader: 0 } };
  const second = { shares: { first: 0.7, second: 0.3, third: 0, weeklyHigh: 0, pointsLeader: 0 } };
  /** A season's odds: `n` playoff teams, `periods` high-score periods and `weeks` regular-season weeks a trade can change. */
  const odds = (n: number, periods: number, weeks: number) => ({ playoffTeams: n, regularLeft: { periods, weeks } });
  const out = (bestFinish: number) => ({ eliminated: true, bestFinish });

  it("not eliminated: always", () => {
    expect(prizeStillMovable(title, odds(4, 0, 0), { eliminated: false, bestFinish: 1 })).toBe(true);
  });

  it("eliminated: a weekly high score with a prize period left, or a points title with a regular-season week left", () => {
    expect(prizeStillMovable(title, odds(4, 5, 5), out(6))).toBe(false);
    expect(prizeStillMovable(weekly, odds(4, 5, 5), out(6))).toBe(true);
    expect(prizeStillMovable(weekly, odds(4, 0, 0), out(6))).toBe(false);
    expect(prizeStillMovable(leader, odds(4, 0, 2), out(6))).toBe(true);
    expect(prizeStillMovable(leader, odds(4, 3, 0), out(6))).toBe(false);
  });

  it("a place the final standings decide (RW-2): 3rd in a bracket of 2 playoff teams or fewer, 2nd too with 1 or none, while the team can still finish there", () => {
    // A bracket of 4 (or 3): every place comes from the playoffs, out of the race is out of the places.
    for (const n of [3, 4]) expect(prizeStillMovable(places, odds(n, 3, 3), out(3)), `${n} playoff teams`).toBe(false);
    // 2 playoff teams: seed 3 is 3rd. Still reachable (best finish 3): movable; certainly 4th or worse: not.
    expect(prizeStillMovable(places, odds(2, 3, 3), out(3))).toBe(true);
    expect(prizeStillMovable(places, odds(2, 3, 3), out(4))).toBe(false);
    // 2nd alone paid: the final's loser in a bracket of 2, the standings' 2nd with 1 playoff team or none.
    expect(prizeStillMovable(second, odds(2, 3, 3), out(2))).toBe(false);
    for (const n of [0, 1]) {
      expect(prizeStillMovable(second, odds(n, 3, 3), out(2)), `${n}`).toBe(true);
      expect(prizeStillMovable(second, odds(n, 3, 3), out(3)), `${n}`).toBe(false);
      expect(prizeStillMovable(places, odds(n, 3, 3), out(3)), `${n}`).toBe(true);
    }
    // No regular-season week a trade can change (the standings are final, or only the week under way is left): not movable.
    expect(prizeStillMovable(places, odds(2, 0, 0), out(3))).toBe(false);
    expect(prizeStillMovable(second, odds(1, 0, 0), out(2))).toBe(false);
  });

  it("3rd place a playoff game decides (final review of Checkpoint 7c, ui-UI-7C-1): a team that lost its semifinal plays for it while its chance is open and a playoff week a trade can change is left", () => {
    const semi = (pThird: number | null) => ({ eliminated: true, bestFinish: 1, pThird });
    /** The regular season over; `n` playoff teams and `left` playoff weeks a trade can change. */
    const after = (n: number, left: number) => ({ playoffTeams: n, regularLeft: { periods: 0, weeks: 0 }, playoffLeft: { weeks: left } });
    // An open chance with the final round ahead: movable when 3rd place pays (a bracket of 3 or more), not for the title or
    // 2nd place alone.
    for (const n of [3, 4, 6, 8]) expect(prizeStillMovable(places, after(n, 1), semi(0.5)), `${n} playoff teams`).toBe(true);
    expect(prizeStillMovable(title, after(4, 1), semi(0.5))).toBe(false);
    expect(prizeStillMovable(second, after(4, 1), semi(0.5))).toBe(false);
    // Settled (0 or 1, float noise too: a quarterfinal loser, the better seed with no game), unknown or not given: not.
    for (const p of [0, 1, 1e-12, 1 - 1e-12, null, Number.NaN]) expect(prizeStillMovable(places, after(4, 1), semi(p)), `${p}`).toBe(false);
    expect(prizeStillMovable(places, after(4, 1), out(1))).toBe(false);
    // No playoff week a trade can change (the final round's week under way, or none left): not. Odds without the count (made
    // before): taken as within reach.
    expect(prizeStillMovable(places, after(4, 0), semi(0.5))).toBe(false);
    expect(prizeStillMovable(places, odds(4, 0, 0), semi(0.5))).toBe(true);
    // A bracket of 2: 3rd goes to the final standings (RW-2, above), not to a game, so an open chance needs a regular-season week.
    expect(prizeStillMovable(places, after(2, 1), { ...semi(0.5), bestFinish: 3 })).toBe(false);
    expect(prizeStillMovable(places, odds(2, 1, 1), { ...semi(0.5), bestFinish: 3 })).toBe(true);
  });

  it("odds made before Checkpoint 7c (no regularLeft, no bestFinish): a paid prize is taken as still within reach; the title alone still stops", () => {
    const old = { playoffTeams: 2 } as Parameters<typeof prizeStillMovable>[1];
    const team = { eliminated: true } as Parameters<typeof prizeStillMovable>[2];
    expect(prizeStillMovable(title, old, team)).toBe(false);
    for (const r of [weekly, leader, places]) expect(prizeStillMovable(r, old, team)).toBe(true);
  });
});
