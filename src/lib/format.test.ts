import { describe, expect, it } from "vitest";
import { fmtNum, fmtPoints, fmtSigned, fmtWhole, formatDate, formatDateTime, formatShortDateTime, formatTime, plural, recordText, weekRuns, weeksText } from "./format";
import { statLabel } from "./labels";

describe("number formatting", () => {
  it("trims trailing zeros and uses a real minus sign", () => {
    expect(fmtNum(0.5)).toBe("0.5");
    expect(fmtNum(2)).toBe("2");
    expect(fmtNum(0.04, 3)).toBe("0.04");
    expect(fmtNum(-2)).toBe("−2");
    expect(fmtNum(-0.001)).toBe("0");
    expect(fmtNum(123.456, 1)).toBe("123.5");
    expect(fmtNum(100, 2)).toBe("100");
    expect(fmtNum(10.1, 2)).toBe("10.1");
    expect(fmtNum(1210.25, 1)).toBe("1210.3");
  });

  it("strips zeros only after a decimal point, so whole numbers keep theirs (maxDecimals 0)", () => {
    expect(fmtNum(110, 0)).toBe("110");
    expect(fmtNum(0, 0)).toBe("0");
    expect(fmtNum(100.4, 0)).toBe("100");
    expect(fmtNum(99.5, 0)).toBe("100");
    expect(fmtNum(-20, 0)).toBe("−20");
    expect(fmtNum(-0.4, 0)).toBe("0");
    expect(fmtNum(0, 2)).toBe("0");
    expect(fmtNum(Number.NaN)).toBe("NaN");
    expect(fmtSigned(10, 0)).toBe("+10");
    expect(fmtPoints(10, 0)).toBe("10 pts");
  });

  it("prints whole numbers with thousands separators and a real minus sign", () => {
    expect(fmtWhole(7342)).toBe("7,342");
    expect(fmtWhole(110)).toBe("110");
    expect(fmtWhole(1479.6)).toBe("1,480");
    expect(fmtWhole(0)).toBe("0");
    expect(fmtWhole(-0.4)).toBe("0");
    expect(fmtWhole(-3)).toBe("−3");
    expect(fmtWhole(-12345.6)).toBe("−12,346");
    expect(fmtWhole(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("signs bonuses and pluralizes points", () => {
    expect(fmtSigned(2)).toBe("+2");
    expect(fmtSigned(-1.5)).toBe("−1.5");
    expect(fmtSigned(0)).toBe("0");
    expect(fmtPoints(1)).toBe("1 pt");
    expect(fmtPoints(4)).toBe("4 pts");
    expect(fmtPoints(-2)).toBe("−2 pts");
    expect(plural(1, "team")).toBe("1 team");
    expect(plural(3, "bye")).toBe("3 byes");
  });
});

describe("weeks", () => {
  it("collapses runs", () => {
    expect(weekRuns([3, 1, 2, 5, 5])).toEqual([
      [1, 3],
      [5, 5],
    ]);
    expect(weeksText([15, 16, 17])).toBe("Weeks 15–17");
    expect(weeksText([4])).toBe("Week 4");
    expect(weeksText([1, 2, 4])).toBe("Weeks 1–2, 4");
    expect(weeksText([])).toBe("None");
  });
});

describe("dates", () => {
  it("formats in the viewer's time zone", () => {
    expect(formatDateTime("2026-12-02T17:00:00.000Z", "America/New_York")).toBe("Wed, Dec 2, 2026, 12:00 PM EST");
    expect(formatDate("2026-12-02T17:00:00.000Z", "America/Los_Angeles")).toBe("Wed, Dec 2, 2026");
    expect(formatDate("not a date", "UTC")).toBe("not a date");
    expect(formatTime("2026-09-30T02:08:00.000Z", "America/Chicago")).toBe("9:08 PM");
    expect(formatTime("not a date", "UTC")).toBe("not a date");
  });

  it("gives a compact timestamp that always has the date, and the year when it isn't this year", () => {
    const now = "2026-11-27T12:00:00.000Z";
    expect(formatShortDateTime("2026-11-26T21:55:00.000Z", "America/Chicago", now)).toBe("Thu, Nov 26, 3:55 PM");
    // The day is the viewer's own: 9:55 PM UTC is still Thursday, 4:55 AM in Tokyo is Friday.
    expect(formatShortDateTime("2026-11-26T21:55:00.000Z", "UTC", now)).toBe("Thu, Nov 26, 9:55 PM");
    expect(formatShortDateTime("2026-11-26T19:55:00.000Z", "Asia/Tokyo", now)).toBe("Fri, Nov 27, 4:55 AM");
    // A week-old copy says so: never a bare weekday that passes for this week's.
    expect(formatShortDateTime("2026-11-19T21:55:00.000Z", "America/Chicago", now)).toBe("Thu, Nov 19, 3:55 PM");
    // Another year (in the viewer's zone), or no "now" to compare with: the year too.
    expect(formatShortDateTime("2025-12-31T23:30:00.000Z", "America/Chicago", "2026-01-01T12:00:00.000Z")).toBe("Wed, Dec 31, 2025, 5:30 PM");
    expect(formatShortDateTime("2026-01-01T03:30:00.000Z", "America/Chicago", "2026-01-01T12:00:00.000Z")).toBe("Wed, Dec 31, 2025, 9:30 PM");
    expect(formatShortDateTime("2026-11-26T21:55:00.000Z", "America/Chicago")).toBe("Thu, Nov 26, 2026, 3:55 PM");
    expect(formatShortDateTime("2026-11-26T21:55:00.000Z", "America/Chicago", "not a date")).toBe("Thu, Nov 26, 2026, 3:55 PM");
    expect(formatShortDateTime("not a date", "UTC", now)).toBe("not a date");
    expect(formatShortDateTime("2026-11-26T21:55:00.000Z", "Not/AZone", now)).toBe("2026-11-26 21:55");
  });

  it("formats records", () => {
    expect(recordText({ w: 3, l: 1, t: 0 })).toBe("3–1");
    expect(recordText({ w: 2, l: 1, t: 1 })).toBe("2–1–1");
  });
});

describe("statLabel", () => {
  it("labels known keys, ranges and unknown keys", () => {
    expect(statLabel("pass_yd")).toBe("Passing yards");
    expect(statLabel("bonus_rec_te")).toBe("Bonus per TE reception (TE premium)");
    expect(statLabel("pts_allow_14_20")).toBe("14–20 points allowed");
    expect(statLabel("pts_allow_35p")).toBe("35+ points allowed");
    expect(statLabel("fgm_50p")).toBe("Field goals made (50+ yds)");
    expect(statLabel("fgmiss_0_19")).toBe("Missed field goals (0–19 yds)");
    expect(statLabel("some_new_key")).toBe("Some new key");
  });
});
