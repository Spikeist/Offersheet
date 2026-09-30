import { describe, expect, it } from "vitest";
import { fmtNum, fmtPoints, fmtSigned, formatDate, formatDateTime, formatTime, plural, recordText, weekRuns, weeksText } from "./format";
import { statLabel } from "./labels";

describe("number formatting", () => {
  it("trims trailing zeros and uses a real minus sign", () => {
    expect(fmtNum(0.5)).toBe("0.5");
    expect(fmtNum(2)).toBe("2");
    expect(fmtNum(0.04, 3)).toBe("0.04");
    expect(fmtNum(-2)).toBe("−2");
    expect(fmtNum(-0.001)).toBe("0");
    expect(fmtNum(123.456, 1)).toBe("123.5");
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
