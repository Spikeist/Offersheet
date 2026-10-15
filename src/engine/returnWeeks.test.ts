/**
 * Which of the user's saved return weeks count (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.5; returnWeeks.ts):
 * my active roster and IR, a status other than ACTIVE, a week not yet passed, set for the snapshot's season (review of wave
 * C, UI-C-3); the rest are stale. Made-up players.
 */
import { describe, expect, it } from "vitest";
import type { InjuryStatus, LeagueSnapshot, PlayerInfo } from "./model";
import { staleReturnWeeks, userReturnWeeks, type ReturnWeekSnapshot } from "./returnWeeks";

const player = (id: string, injury: InjuryStatus): PlayerInfo => ({ id, name: `Player ${id}`, pos: "RB", eligible: ["RB"], nflTeam: "AAA", injury, ids: {} });

const SEASON = 2026;

function snapshot(myTeamId: string | null = "1", season = SEASON): ReturnWeekSnapshot {
  const teams: LeagueSnapshot["teams"] = [
    { id: "1", name: "Team 1", ownerName: "Owner 1", roster: ["a-out", "a-active", "a-q"], ir: ["a-ir"], taxi: ["a-taxi"], record: { w: 0, l: 0, t: 0 }, pointsFor: 0, pointsAgainst: 0 },
    { id: "2", name: "Team 2", ownerName: "Owner 2", roster: ["b-out"], ir: [], taxi: [], record: { w: 0, l: 0, t: 0 }, pointsFor: 0, pointsAgainst: 0 },
  ];
  const players = Object.fromEntries(
    [player("a-out", "OUT"), player("a-active", "ACTIVE"), player("a-q", "QUESTIONABLE"), player("a-ir", "IR"), player("a-taxi", "IR"), player("b-out", "OUT"), player("fa-out", "OUT")].map((p) => [p.id, p]),
  );
  return { teams, players, currentWeek: 6, myTeamId, season };
}

/** Saved weeks, set for `season` (this one by default). */
const weeks = (returnWeeks: Record<string, number>, season: number | null = SEASON) => ({ returnWeeks, returnWeeksSeason: season });

describe("userReturnWeeks: the saved return weeks the engine follows", () => {
  it("keeps my active-roster and IR players who aren't ACTIVE, with a week from this one on", () => {
    const saved = weeks({ "a-out": 8, "a-q": 6, "a-ir": 19, "a-active": 9, "a-taxi": 9, "b-out": 9, "fa-out": 9, gone: 9 });
    expect(Object.fromEntries(userReturnWeeks(snapshot(), saved))).toEqual({ "a-out": 8, "a-q": 6, "a-ir": 19 });
  });

  it("drops a week that has passed, and anything that isn't a whole week", () => {
    expect(userReturnWeeks(snapshot(), weeks({ "a-out": 5, "a-ir": 7.5 })).size).toBe(0);
    expect(userReturnWeeks(snapshot(), weeks({ "a-out": Number.NaN })).size).toBe(0);
  });

  it("counts nothing without a team of mine, or with nothing saved", () => {
    expect(userReturnWeeks(snapshot(null), weeks({ "a-out": 8 })).size).toBe(0);
    expect(userReturnWeeks(snapshot("9"), weeks({ "a-out": 8 })).size).toBe(0);
    expect(userReturnWeeks(snapshot(), undefined).size).toBe(0);
    expect(userReturnWeeks(snapshot(), weeks({})).size).toBe(0);
  });

  it("counts only weeks set for the snapshot's season (review of wave C, UI-C-3): last season's 'out for the season' holds nobody out now", () => {
    expect(userReturnWeeks(snapshot("1", SEASON + 1), weeks({ "a-ir": 19, "a-out": 15 })).size).toBe(0);
    // Weeks saved without their season (a build before the review) don't count either.
    expect(userReturnWeeks(snapshot(), weeks({ "a-ir": 19 }, null)).size).toBe(0);
    expect(userReturnWeeks(snapshot(), { returnWeeks: { "a-ir": 19 } }).size).toBe(0);
  });
});

describe("staleReturnWeeks: the saved return weeks that no longer count", () => {
  it("lists every other entry, in id order: active again, off my roster and IR, or a week that has passed", () => {
    const saved = weeks({ "b-out": 9, "a-active": 9, "a-out": 5, "a-q": 7, "a-taxi": 9, gone: 9 });
    expect(staleReturnWeeks(snapshot(), saved)).toEqual(["a-active", "a-out", "a-taxi", "b-out", "gone"]);
    expect(staleReturnWeeks(snapshot(), weeks({ "a-q": 7 }))).toEqual([]);
  });

  it("leaves this season's be without a team of mine (no roster to judge by)", () => {
    expect(staleReturnWeeks(snapshot(null), weeks({ "a-active": 9, gone: 9 }))).toEqual([]);
    expect(staleReturnWeeks(snapshot("9"), weeks({ "a-active": 9 }))).toEqual([]);
  });

  it("lists every one set for another season, or for none, team or not (review of wave C, UI-C-3)", () => {
    expect(staleReturnWeeks(snapshot("1", SEASON + 1), weeks({ "a-q": 7, "a-ir": 19 }))).toEqual(["a-ir", "a-q"]);
    expect(staleReturnWeeks(snapshot(null, SEASON + 1), weeks({ gone: 9 }))).toEqual(["gone"]);
    expect(staleReturnWeeks(snapshot(), weeks({ "a-q": 7 }, null))).toEqual(["a-q"]);
    expect(staleReturnWeeks(snapshot(), weeks({}, SEASON + 1))).toEqual([]);
  });
});
