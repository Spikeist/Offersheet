import { describe, expect, it } from "vitest";
import type { NflGame } from "./nfl";
import { parseNflState, planWeeks, sampleFutureWeeks, scheduleWeek, seasonFromDate } from "./weeks";

const game = (week: number, gameday: string): NflGame => ({ gameId: `g${week}-${gameday}`, season: 2026, week, away: "LA", home: "KC", espnId: null, gameday, gametime: "13:00" });

describe("week plan", () => {
  it("parses Sleeper /state/nfl (season as a string) and rejects bodies without a week", () => {
    expect(parseNflState({ week: 4, season: "2026", season_type: "regular", display_week: 4, leg: 4 })).toEqual({ season: 2026, week: 4, seasonType: "regular", displayWeek: 4 });
    expect(parseNflState({ season: "2026" })).toBeNull();
    expect(parseNflState(null)).toBeNull();
    expect(parseNflState("<html>")).toBeNull();
  });

  it("derives the season from a date when no API says so", () => {
    expect(seasonFromDate("2026-09-29")).toBe(2026);
    expect(seasonFromDate("2027-01-15")).toBe(2026);
    expect(seasonFromDate("2027-03-01")).toBe(2027);
  });

  it("finds the current week from the schedule: the first week with a game on or after today", () => {
    const games = [game(3, "2026-09-24"), game(3, "2026-09-28"), game(4, "2026-10-01"), game(4, "2026-10-05"), game(5, "2026-10-08")];
    expect(scheduleWeek(games, "2026-09-28")).toBe(3);
    expect(scheduleWeek(games, "2026-09-29")).toBe(4);
    expect(scheduleWeek(games, "2027-02-01")).toBeNull();
  });

  it("samples future weeks relative to the current week, ending with the last two weeks", () => {
    expect(sampleFutureWeeks(4, 18)).toEqual([5, 10, 15, 17, 18]);
    expect(sampleFutureWeeks(9, 18)).toEqual([10, 15, 17, 18]);
    expect(sampleFutureWeeks(16, 18)).toEqual([17, 18]);
    expect(sampleFutureWeeks(18, 18)).toEqual([]);
  });

  it("plans completed, stats and future weeks from the state", () => {
    expect(planWeeks({ season: 2026, week: 4, seasonType: "regular" }, 18, "test")).toEqual({
      season: 2026,
      seasonType: "regular",
      currentWeek: 4,
      lastRegularWeek: 18,
      completedWeeks: [1, 2, 3],
      statsWeeks: [1, 2, 3],
      futureWeeks: [5, 10, 15, 17, 18],
      source: "test",
    });
    const late = planWeeks({ season: 2026, week: 12, seasonType: "regular" }, 18, "test");
    expect(late.statsWeeks).toEqual([9, 10, 11]);
    expect(late.futureWeeks).toEqual([13, 17, 18]);
    const pre = planWeeks({ season: 2026, week: 0, seasonType: "pre" }, 18, "test");
    expect(pre).toMatchObject({ currentWeek: 1, completedWeeks: [], statsWeeks: [] });
    const post = planWeeks({ season: 2026, week: 19, seasonType: "post" }, 18, "test");
    expect(post).toMatchObject({ currentWeek: 18, futureWeeks: [] });
  });
});
