/**
 * The user's own return week (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.5; availability.ts, the file header's
 * step 1): AvailabilityPlayer.userReturnWeek is followed whatever his status says, with returnWeekSpread around it but never
 * before it (75% back at R, all of it from R + 1), "out for the season" after the NFL's last week, and nothing else changes:
 * a player without one reads exactly as before. Also followsKnownReturnWeek, the rule behind the "ESPN" mark.
 */
import { describe, expect, it } from "vitest";
import {
  expectedAvailability,
  expectedReturnWeek,
  followsKnownReturnWeek,
  injuryRisk,
  pOut,
  returnWeekDistribution,
  scenarioAvailability,
  userReturnWeekDistribution,
  type AvailabilityConfig,
  type AvailabilityContext,
  type AvailabilityPlayer,
  type ReturnWeek,
} from "./availability";
import { config } from "./config";
import { POSITIONS, type InjuryStatus, type Pos } from "./model";

const W0 = 6;
/** NFL weeks 6..17: 12 remaining weeks (week 6 is "this week"). */
const WEEKS = Array.from({ length: 12 }, (_, i) => W0 + i);
const cfg = config.projections;
const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({ weeks: WEEKS, currentWeek: W0, byeWeek: undefined, started: false, hasTeam: true, ...over });
const zeroShares = Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Pos, number>;
/** No future injuries: availability is then the return-week distribution alone. */
const noRisk: AvailabilityConfig = { ...cfg, injuryRisk: { ...cfg.injuryRisk, missShare: zeroShares } };
const STATUSES: InjuryStatus[] = ["ACTIVE", "PROBABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "IR", "PUP", "SUSPENDED", "NA"];

function expectDist(actual: ReturnWeek[], expected: Array<[week: number, p: number]>): void {
  expect(actual.map((d) => d.week)).toEqual(expected.map(([w]) => w));
  actual.forEach((d, i) => expect(d.p).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 12));
}

/** The weeks' availability with no future injuries: 0 before `from`, `at` in `from`, 1 after (byes 0). */
function ramp(from: number, at: number, bye?: number): number[] {
  return WEEKS.map((w) => (w === bye ? 0 : w < from ? 0 : w === from ? at : 1));
}

describe("userReturnWeekDistribution: the user's own week, never before it", () => {
  it("moves R − 1's share of the platform's spread to R: 75% back at R, the rest at R + 1", () => {
    expect(cfg.returnWeekSpread).toEqual([0.25, 0.5, 0.25]);
    expectDist(userReturnWeekDistribution(8, W0), [
      [8, 0.75],
      [9, 0.25],
    ]);
    // Next week and this week alike: never earlier than the week itself.
    expectDist(userReturnWeekDistribution(7, W0), [
      [7, 0.75],
      [8, 0.25],
    ]);
    expectDist(userReturnWeekDistribution(6, W0), [
      [6, 0.75],
      [7, 0.25],
    ]);
  });

  it("reads a week after the NFL's last as out for the season (no return), as the platform's last week + 1", () => {
    expect(userReturnWeekDistribution(19, W0, cfg, 18)).toEqual([]);
    expectDist(userReturnWeekDistribution(18, W0, cfg, 18), [
      [18, 0.75],
      [19, 0.25],
    ]);
  });

  it("follows the config's spread: a wider one keeps every share from R on, R's own and the earlier ones' at R", () => {
    const wide = { returnWeekSpread: [0.1, 0.2, 0.4, 0.2, 0.1] };
    expectDist(userReturnWeekDistribution(10, W0, wide), [
      [10, 0.7],
      [11, 0.2],
      [12, 0.1],
    ]);
  });
});

describe("availability with the user's week, whatever his status", () => {
  it("is 0 before his week, 75% in it and 1 after it, for every status, the platform's date and the tag table ignored", () => {
    for (const injury of STATUSES) {
      for (const platform of [undefined, 12, 4]) {
        const player: AvailabilityPlayer = { injury, ...(platform !== undefined ? { injuryReturnWeek: platform } : {}), userReturnWeek: 9 };
        expect(expectedAvailability(player, "RB", ctx(), noRisk), `${injury} ${platform}`).toEqual(ramp(9, 0.75));
      }
    }
  });

  it("keeps the gates: his bye, a game already started, and no NFL team", () => {
    const player: AvailabilityPlayer = { injury: "IR", injuryReturnWeek: 12, userReturnWeek: 6 };
    expect(expectedAvailability(player, "WR", ctx({ byeWeek: 8 }), noRisk)).toEqual(ramp(6, 0.75, 8));
    expect(expectedAvailability(player, "WR", ctx({ started: true }), noRisk)[0]).toBe(0);
    expect(expectedAvailability(player, "WR", ctx({ hasTeam: false }), noRisk)).toEqual(WEEKS.map(() => 0));
  });

  it("adds the future injury risk from his return, as for any return", () => {
    const risk = injuryRisk("RB", cfg);
    const a = expectedAvailability({ injury: "OUT", userReturnWeek: 8 }, "RB", ctx(), cfg);
    const expected = WEEKS.map((w) => (w < 8 ? 0 : 0.75 * (1 - pOut(w - 8, risk)) + (w >= 9 ? 0.25 * (1 - pOut(w - 9, risk)) : 0)));
    a.forEach((x, i) => expect(x).toBeCloseTo(expected[i] as number, 12));
  });

  it("puts him back at his week (expectedReturnWeek), or never when it's after the NFL's last week", () => {
    const span = { weeks: WEEKS, currentWeek: W0, hasTeam: true, lastNflWeek: 18 };
    expect(expectedReturnWeek({ injury: "IR", injuryReturnWeek: 12, userReturnWeek: 8 }, span, cfg, 0.5)).toBe(8);
    expect(expectedReturnWeek({ injury: "QUESTIONABLE", injuryReturnWeek: 8, userReturnWeek: 7 }, span, cfg, 0.5)).toBe(7);
    // 75% back in his week: a quantile above it reads the week after.
    expect(expectedReturnWeek({ injury: "OUT", userReturnWeek: 8 }, span, cfg, 0.8)).toBe(9);
    expect(expectedReturnWeek({ injury: "IR", injuryReturnWeek: 12, userReturnWeek: 19 }, span, cfg, 0.5)).toBeNull();
    // An NA player too: the user's week is followed whatever his status says.
    expect(expectedReturnWeek({ injury: "NA", userReturnWeek: 10 }, span, cfg, 0.5)).toBe(10);
  });

  it("draws scenarios whose mean is the expected availability, from his own streams", () => {
    const S = 4000;
    const player: AvailabilityPlayer = { injury: "QUESTIONABLE", injuryReturnWeek: 9, userReturnWeek: 8 };
    const flags = scenarioAvailability("rb-1", player, "RB", ctx(), S, 20_261_014, cfg);
    const mean = WEEKS.map((_, wi) => {
      let n = 0;
      for (let s = 0; s < S; s++) n += flags[s * WEEKS.length + wi] as number;
      return n / S;
    });
    const a = expectedAvailability(player, "RB", ctx(), cfg);
    mean.forEach((m, i) => expect(Math.abs(m - (a[i] as number))).toBeLessThan(0.03));
    // Never before his week, in any scenario.
    for (let s = 0; s < S; s++) for (let wi = 0; wi < 2; wi++) expect(flags[s * WEEKS.length + wi]).toBe(0);
  });

  it("changes nothing for a player without one: the platform's rule, bit for bit", () => {
    for (const injury of STATUSES) {
      for (const R of [undefined, 7, 9, 19]) {
        const plain: AvailabilityPlayer = R === undefined ? { injury } : { injury, injuryReturnWeek: R };
        const unset: AvailabilityPlayer = { ...plain, userReturnWeek: undefined };
        expect(expectedAvailability(unset, "TE", ctx({ lastNflWeek: 18 }), cfg)).toEqual(expectedAvailability(plain, "TE", ctx({ lastNflWeek: 18 }), cfg));
        expect(scenarioAvailability("te-1", unset, "TE", ctx(), 64, 7, cfg)).toEqual(scenarioAvailability("te-1", plain, "TE", ctx(), 64, 7, cfg));
        expect(expectedReturnWeek(unset, ctx())).toBe(expectedReturnWeek(plain, ctx()));
      }
    }
  });
});

describe("followsKnownReturnWeek: whether the platform's date is what his numbers follow", () => {
  it("IR, PUP and SUSPENDED with any date; OUT from next week on; a game-time tag only with a far date; never ACTIVE or NA", () => {
    expect(followsKnownReturnWeek("IR", 3, W0)).toBe(true);
    expect(followsKnownReturnWeek("PUP", 9, W0)).toBe(true);
    expect(followsKnownReturnWeek("SUSPENDED", 8, W0)).toBe(true);
    expect(followsKnownReturnWeek("OUT", 7, W0)).toBe(true);
    expect(followsKnownReturnWeek("OUT", 6, W0)).toBe(false);
    expect(followsKnownReturnWeek("QUESTIONABLE", 8, W0)).toBe(true);
    expect(followsKnownReturnWeek("DOUBTFUL", 7, W0)).toBe(false);
    expect(followsKnownReturnWeek("ACTIVE", 9, W0)).toBe(false);
    expect(followsKnownReturnWeek("NA", 9, W0)).toBe(false);
    expect(followsKnownReturnWeek("IR", undefined, W0)).toBe(false);
  });

  it("matches returnWeekDistribution: a date it follows moves his distribution, one it doesn't leaves the status's table", () => {
    for (const injury of STATUSES) {
      for (const R of [3, 6, 7, 8, 11]) {
        const withDate = returnWeekDistribution(injury, R, W0, cfg);
        const without = returnWeekDistribution(injury, undefined, W0, cfg);
        if (!followsKnownReturnWeek(injury, R, W0)) expect(withDate, `${injury} ${R}`).toEqual(without);
      }
    }
  });
});
