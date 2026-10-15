/**
 * The League page's settings edits (leagueSettingsEdit.ts; Checkpoint 7e): a return week set or cleared (item 3.5:
 * withReturnWeek, for the snapshot's season: review of wave C, UI-C-3), and the ones that no longer count dropped
 * (withoutStaleReturnWeeks, the page's model and its one save per new snapshot: src/engine/returnWeeks.ts). From the
 * fictional league in testFixtures.ts.
 */
import { describe, expect, it } from "vitest";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { withReturnWeek, withoutStaleReturnWeeks } from "./leagueSettingsEdit";
import { leagueFixture } from "./testFixtures";

const { snapshot } = leagueFixture();
const SEASON = snapshot.season;
const settings = (returnWeeks: Record<string, number>, season: number | null = SEASON): TradeSettings => ({ ...defaultTradeSettings(), returnWeeks, returnWeeksSeason: season });

describe("withReturnWeek", () => {
  it("sets a player's week, replaces it, and clears it with null, the others kept, for the season given", () => {
    const s = withReturnWeek(settings({ a: 9 }), "b", 8, SEASON);
    expect(s.returnWeeks).toEqual({ a: 9, b: 8 });
    expect(s.returnWeeksSeason).toBe(SEASON);
    expect(withReturnWeek(s, "b", 10, SEASON).returnWeeks).toEqual({ a: 9, b: 10 });
    expect(withReturnWeek(s, "b", null, SEASON).returnWeeks).toEqual({ a: 9 });
  });

  it("starts afresh in another season (review of wave C, UI-C-3): last season's weeks don't carry over", () => {
    const next = withReturnWeek(settings({ a: 19, b: 15 }), "c", 8, SEASON + 1);
    expect(next.returnWeeks).toEqual({ c: 8 });
    expect(next.returnWeeksSeason).toBe(SEASON + 1);
    // Weeks saved without a season (a build before the review) go too.
    expect(withReturnWeek(settings({ a: 19 }, null), "c", null, SEASON)).toMatchObject({ returnWeeks: {}, returnWeeksSeason: SEASON });
  });
});

describe("withoutStaleReturnWeeks", () => {
  // Week 12; my team (1): Fiddlesticks on IR, Crumpet Questionable, Pemberton healthy; team 2's Wimbleton Doubtful.

  it("drops the entries that no longer count: a healthy player, another team's, a week that has passed", () => {
    const s = settings({ "107": 14, "103": 12, "101": 14, "206": 15, "108": 11 });
    expect(withoutStaleReturnWeeks(s, snapshot).returnWeeks).toEqual({ "107": 14, "103": 12 });
  });

  it("drops every one set for another season", () => {
    expect(withoutStaleReturnWeeks(settings({ "107": 19, "103": 14 }, SEASON - 1), snapshot).returnWeeks).toEqual({});
  });

  it("returns the very same settings when nothing is stale, or without a team of mine", () => {
    const s = settings({ "107": 14 });
    expect(withoutStaleReturnWeeks(s, snapshot)).toBe(s);
    const all = settings({ "101": 14, "206": 15 });
    expect(withoutStaleReturnWeeks(all, { ...snapshot, myTeamId: null })).toBe(all);
  });
});
