import { describe, expect, it } from "vitest";
import { weekOfCalendarDate, weekOfInstant, weekWindows, type WeekWindow } from "./weeks";
import { LABELS, readEspn } from "./test-helpers";

const windows: WeekWindow[] = weekWindows(readEspn<{ settings: { proTeams: Parameters<typeof weekWindows>[0] } }>(LABELS.proSchedule).settings.proTeams);

describe("NFL weeks from ESPN's schedule", () => {
  it("builds one window per NFL week (2026: weeks 1–18)", () => {
    expect(windows.map((w) => w.week)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("puts an instant after Monday night's kickoff in the coming week", () => {
    const w4 = windows[3] as WeekWindow;
    expect(weekOfInstant(w4.lastKickoff, windows)).toBe(4);
    expect(weekOfInstant(w4.lastKickoff + 1, windows)).toBe(5);
    expect(weekOfInstant((windows[17] as WeekWindow).lastKickoff + 1, windows)).toBeNull();
  });

  it("reads ESPN's expectedReturnDate [year, month (1-based), day] as an NFL week; after the season → the week after", () => {
    expect(weekOfCalendarDate([2026, 10, 4], windows)).toBe(4); // Sunday of week 4
    expect(weekOfCalendarDate([2026, 10, 6], windows)).toBe(5); // Tuesday: the coming week
    expect(weekOfCalendarDate([2026, 10, 30], windows)).toBe(8); // Friday after week 8's Thursday game
    expect(weekOfCalendarDate([2027, 2, 15], windows)).toBe(19);
    expect(weekOfCalendarDate([2026, 13, 1], windows)).toBeUndefined();
    expect(weekOfCalendarDate([2026, 10], windows)).toBeUndefined();
    expect(weekOfCalendarDate([2026, 10, 4], [])).toBeUndefined();
  });
});
