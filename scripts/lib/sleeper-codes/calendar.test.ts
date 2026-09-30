import { describe, expect, it } from "vitest";
import { dayNumber, easternParts, nflCalendar, timingInWeek, wednesdayOnOrBefore, weekdayOf } from "./calendar";

// A slice of nflverse games.csv (extra columns ignored); 2025 week 11 starts Thursday 2025-11-13.
const CSV = [
  "game_id,season,game_type,week,gameday,weekday,gametime,away_team,home_team",
  "2025_10_A_B,2025,REG,10,2025-11-06,Thursday,20:15,AAA,BBB",
  "2025_10_C_D,2025,REG,10,2025-11-09,Sunday,13:00,CCC,DDD",
  "2025_11_A_B,2025,REG,11,2025-11-13,Thursday,20:15,AAA,BBB",
  "2025_11_C_D,2025,REG,11,2025-11-17,Monday,20:15,CCC,DDD",
  "2025_12_A_B,2025,REG,12,2025-11-20,Thursday,20:15,AAA,BBB",
  "2024_17_A_B,2024,REG,17,2024-12-25,Wednesday,13:00,AAA,BBB",
].join("\n");

/** Epoch ms for a US Eastern wall-clock time in November (EST = UTC−5). */
const est = (date: string, hour: number) => Date.parse(`${date}T00:00:00Z`) + (hour + 5) * 3_600_000;

describe("calendar arithmetic", () => {
  it("finds the Wednesday that starts an NFL week", () => {
    expect(weekdayOf("2025-11-13")).toBe(4);
    expect(wednesdayOnOrBefore("2025-11-13")).toBe("2025-11-12");
    expect(wednesdayOnOrBefore("2026-01-03")).toBe("2025-12-31"); // a Saturday week 18
    expect(wednesdayOnOrBefore("2024-12-25")).toBe("2024-12-25"); // a Wednesday game
    expect(dayNumber("2025-11-13") - dayNumber("2025-11-12")).toBe(1);
  });

  it("reads US Eastern dates and hours across daylight saving", () => {
    expect(easternParts(Date.parse("2025-11-18T02:00:00Z"))).toEqual({ date: "2025-11-17", hour: 21 }); // EST
    expect(easternParts(Date.parse("2025-09-08T02:00:00Z"))).toEqual({ date: "2025-09-07", hour: 22 }); // EDT
  });
});

describe("nflCalendar", () => {
  const cal = nflCalendar(CSV);

  it("builds Wednesday-to-Tuesday week windows", () => {
    expect(cal.seasons).toEqual([2024, 2025]);
    expect(cal.weekStart(2025, 11)).toBe("2025-11-12");
    expect(cal.weekOf(2025, est("2025-11-12", 0))).toBe(11);
    expect(cal.weekOf(2025, est("2025-11-18", 23))).toBe(11); // the Tuesday after week 11
    expect(cal.weekOf(2025, est("2025-11-19", 1))).toBe(12);
    expect(cal.weekOf(2025, est("2025-09-01", 12))).toBeUndefined(); // before the slice's first week
  });

  it("buckets a completion time relative to week D", () => {
    expect(timingInWeek(cal, 2025, 11, est("2025-11-11", 20))).toBe("before NFL week D");
    expect(timingInWeek(cal, 2025, 11, est("2025-11-14", 9))).toBe("Wed–Sat of NFL week D");
    expect(timingInWeek(cal, 2025, 11, est("2025-11-16", 11))).toBe("Sunday of week D before 1 pm ET");
    expect(timingInWeek(cal, 2025, 11, est("2025-11-16", 15))).toBe("Sunday 1 pm ET – Monday of week D");
    expect(timingInWeek(cal, 2025, 11, est("2025-11-17", 22))).toBe("Sunday 1 pm ET – Monday of week D");
    expect(timingInWeek(cal, 2025, 11, est("2025-11-18", 10))).toBe("Tuesday after week D");
    expect(timingInWeek(cal, 2025, 11, est("2025-11-19", 4))).toBe("Wednesday after week D or later");
    expect(timingInWeek(cal, 2025, 30, est("2025-11-19", 4))).toBeUndefined();
  });
});
