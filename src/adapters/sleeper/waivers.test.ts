import { describe, expect, it } from "vitest";
import { normalizeSleeperLeague } from "./normalize";
import { fakeResolver, loadTestLeague, rawOf, type TestLeague } from "./test-helpers";
import { WAIVER_RESET_BEFORE_GAMES, WAIVER_TYPE, WAIVER_TYPE_UNKNOWN, anyGamePlayed, reverseStandings, sleeperWaiverOrder, type SleeperWaiverTeam } from "./waivers";

/** A made-up roster: its live waiver position and record. */
const team = (id: string, waiverPosition: number | null, w: number, l: number, pointsFor: number, pointsAgainst = 300, t = 0): SleeperWaiverTeam => ({ id, waiverPosition, record: { w, l, t }, pointsFor, pointsAgainst });

/** Four made-up rosters after week 3: the standings 2 (3-0) > 4 (2-1) > 1 (1-2) > 3 (0-3); positions mid-week, after claims. */
const four = (): SleeperWaiverTeam[] => [team("1", 1, 1, 2, 300), team("2", 2, 3, 0, 350), team("3", 3, 0, 3, 280), team("4", 4, 2, 1, 320)];

const ranksOf = (r: ReturnType<typeof sleeperWaiverOrder>) => Object.fromEntries([...r.ranks].map(([id, x]) => [id, x.waiverRank]));
const liveOf = (r: ReturnType<typeof sleeperWaiverOrder>) => Object.fromEntries([...r.ranks].map(([id, x]) => [id, x.liveWaiverRank]));

describe("sleeperWaiverOrder (Phase 4c; planner reply to Checkpoint 4b, answer 2)", () => {
  it("reverse-standings waivers (waiver_type 1): the reverse standings, whatever the order is today; the position kept apart", () => {
    const r = sleeperWaiverOrder(four(), { waiverType: WAIVER_TYPE.reverseStandings, divisions: false });
    expect(r.used).toBe("weeklyReset");
    expect(ranksOf(r)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(liveOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(r.notes.join(" ")).toMatch(/reset every week to the reverse standings.*Sleeper's order right now is different/);
    expect(r.warnings).toEqual([]);
    // Any live order gives the same reset order (the day of the import doesn't matter).
    for (const live of [
      [4, 3, 2, 1],
      [2, 1, 4, 3],
      [null, null, null, null],
    ])
      expect(ranksOf(sleeperWaiverOrder(four().map((t, i) => ({ ...t, waiverPosition: live[i] })), { waiverType: 1, divisions: false })), String(live)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
  });

  it("at the reset (the position already is the reverse standings, as in the 2 leagues read before their waiver run): no note", () => {
    const atReset = four().map((t) => ({ ...t, waiverPosition: ({ "1": 2, "2": 4, "3": 1, "4": 3 })[t.id] as number }));
    const r = sleeperWaiverOrder(atReset, { waiverType: 1, divisions: false });
    expect(ranksOf(r)).toEqual(liveOf(r));
    expect(r.notes).toEqual([]);
  });

  it("the reverse standings: worst win % first, then fewer points for, then fewer points against, then roster id", () => {
    const tied = [team("1", 1, 2, 1, 300, 310), team("2", 2, 2, 1, 290, 400), team("3", 3, 2, 1, 300, 290), team("10", 4, 2, 1, 300, 290), team("4", 5, 1, 1, 500, 300, 1)];
    // 4 (1-1-1: half a win for the tie) is worst; then 2 (fewest points for); 3 and 10 tie on points against (by id), then 1.
    expect(Object.fromEntries(reverseStandings(tied))).toEqual({ "4": 1, "2": 2, "3": 3, "10": 4, "1": 5 });
  });

  it("⚠️ with divisions: the overall standings, with a SETTING_INFERRED warning", () => {
    const r = sleeperWaiverOrder(four(), { waiverType: 1, divisions: true });
    expect(ranksOf(r)).toEqual({ "1": 2, "2": 4, "3": 1, "4": 3 });
    expect(r.warnings).toEqual([expect.objectContaining({ code: "SETTING_INFERRED", platformPath: "settings.waiver_type" })]);
  });

  it("before any game (no standings to reset to): the position, with a warning the Import Report's row reads", () => {
    const fresh = four().map((t) => ({ ...t, record: { w: 0, l: 0, t: 0 }, pointsFor: 0 }));
    expect(anyGamePlayed(fresh)).toBe(false);
    const r = sleeperWaiverOrder(fresh, { waiverType: 1, divisions: true });
    expect(r.used).toBe("live");
    expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(liveOf(r)).toEqual({ "1": undefined, "2": undefined, "3": undefined, "4": undefined });
    // The divisions caveat is about the reset order, which isn't used yet.
    expect(r.warnings).toEqual([expect.objectContaining({ code: WAIVER_RESET_BEFORE_GAMES, platformPath: "rosters[].settings" })]);
    expect(r.warnings[0]?.message).toMatch(/No games have been played yet.*until the first games are played the pickups may depend on the day you import/);
    expect(r.notes).toEqual([]);
    // Only a league that resets weekly is marked: rolling waivers are the live order whenever you import.
    const rolling = sleeperWaiverOrder(fresh, { waiverType: WAIVER_TYPE.rolling, divisions: false });
    expect(rolling.used).toBe("live");
    expect([...rolling.notes, ...rolling.warnings]).toEqual([]);
    // Without a position for every roster no order is used, so nothing is warned.
    const partial = sleeperWaiverOrder(
      fresh.map((t, i) => ({ ...t, waiverPosition: i === 0 ? null : t.waiverPosition })),
      { waiverType: 1, divisions: false },
    );
    expect(partial.used).toBeUndefined();
    expect(partial.warnings).toEqual([]);
  });

  it("rolling waivers (waiver_type 0): the position as it stands; FAAB (2): the position, the tiebreak", () => {
    const rolling = sleeperWaiverOrder(four(), { waiverType: WAIVER_TYPE.rolling, divisions: false });
    expect(rolling.used).toBe("live");
    expect(ranksOf(rolling)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
    expect(liveOf(rolling)).toEqual({ "1": undefined, "2": undefined, "3": undefined, "4": undefined });
    expect([...rolling.notes, ...rolling.warnings]).toEqual([]);
    const faab = sleeperWaiverOrder(four(), { waiverType: WAIVER_TYPE.faab, divisions: false });
    expect(faab.used).toBe("faab");
    expect(ranksOf(faab)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
  });

  it("a waiver type that's missing or unknown: the position as it stands, with a warning", () => {
    for (const waiverType of [undefined, 7]) {
      const r = sleeperWaiverOrder(four(), { ...(waiverType !== undefined ? { waiverType } : {}), divisions: false });
      expect(r.used).toBe("live");
      expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": 3, "4": 4 });
      expect(r.warnings).toEqual([expect.objectContaining({ code: WAIVER_TYPE_UNKNOWN, platformPath: "settings.waiver_type" })]);
    }
  });

  it("a live order counts only when every roster has a position (the engine's rule): otherwise no order is used, nothing warned", () => {
    const partial = four().map((t, i) => ({ ...t, waiverPosition: i === 2 ? 0 : t.waiverPosition }));
    for (const waiverType of [0, undefined]) {
      const r = sleeperWaiverOrder(partial, { ...(waiverType !== undefined ? { waiverType } : {}), divisions: false });
      expect(r.used).toBeUndefined();
      expect(ranksOf(r)).toEqual({ "1": 1, "2": 2, "3": undefined, "4": 4 });
      expect(r.warnings).toEqual([]);
    }
  });
});

describe("normalizeSleeperLeague: the waiver order (minimized test league; waiver positions made up, as the fixture keeps none)", () => {
  // Tuesday of NFL week 4, as normalize.test.ts runs it.
  const run = (t: TestLeague) => normalizeSleeperLeague(rawOf(t), { now: new Date("2026-09-29T18:00:00Z"), resolver: fakeResolver(t.players) });
  /** Made-up positions, roster ids 1..12 in order. */
  const positions = [5, 1, 12, 7, 2, 9, 3, 11, 4, 8, 6, 10];
  const withPositions = (t: TestLeague) => {
    t.rosters.forEach((r) => Object.assign(r.settings, { waiver_position: positions[r.roster_id - 1] }));
    return t;
  };

  it("the test league's rolling waivers (waiver_type 0): Sleeper's positions as they stand", () => {
    const t = withPositions(loadTestLeague());
    expect(t.league.settings.waiver_type).toBe(0);
    const { snapshot } = run(t);
    expect(snapshot.settings.waiverOrderUsed).toBe("live");
    expect(snapshot.teams.map((x) => x.waiverRank)).toEqual(positions);
    expect(snapshot.teams.every((x) => x.liveWaiverRank === undefined)).toBe(true);
  });

  it("reverse-standings waivers (waiver_type 1): the reverse of the league's real standings in waiverRank, the positions in liveWaiverRank", () => {
    const t = withPositions(loadTestLeague());
    t.league.settings.waiver_type = 1;
    const { snapshot, notes } = run(t);
    expect(snapshot.settings.waiverOrderUsed).toBe("weeklyReset");
    // The fixture's records after week 3: worst first 8 (0-3), then the 1-2 teams by points for (12, 3, 5, 2), then the 2-1 teams (6, 4, 7, 9, 11, 1, 10).
    const worstFirst = [...snapshot.teams].sort((a, b) => (a.waiverRank as number) - (b.waiverRank as number)).map((x) => x.id);
    expect(worstFirst).toEqual(["8", "12", "3", "5", "2", "6", "4", "7", "9", "11", "1", "10"]);
    expect(snapshot.teams.map((x) => x.liveWaiverRank)).toEqual(positions);
    expect(notes.some((n) => n.startsWith("Waiver order: this league's reverse-standings waivers"))).toBe(true);
  });

  it("FAAB (waiver_type 2): waiverOrderUsed faab; no liveWaiverRank", () => {
    const t = withPositions(loadTestLeague());
    Object.assign(t.league.settings, { waiver_type: 2, waiver_budget: 100 });
    const { snapshot } = run(t);
    expect(snapshot.settings.waiverOrderUsed).toBe("faab");
    expect(snapshot.teams.map((x) => x.waiverRank)).toEqual(positions);
    expect(snapshot.teams.every((x) => x.liveWaiverRank === undefined)).toBe(true);
    // Without a waiver_budget (never seen): still a FAAB league, but no budget for the engine, which then uses the positions.
    const noBudget = withPositions(loadTestLeague());
    noBudget.league.settings.waiver_type = 2;
    delete (noBudget.league.settings as Record<string, unknown>).waiver_budget;
    const s = run(noBudget).snapshot;
    expect(s.settings).toMatchObject({ waiverOrderUsed: "faab" });
    expect(s.settings.faabBudget).toBeUndefined();
    expect(s.teams.map((x) => x.waiverRank)).toEqual(positions);
  });

  it("reverse-standings waivers before any game (every record 0-0, no points): the positions, warned", () => {
    const t = withPositions(loadTestLeague());
    t.league.settings.waiver_type = 1;
    t.rosters.forEach((r) => Object.assign(r.settings, { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 }));
    const { snapshot, notes } = run(t);
    expect(snapshot.settings.waiverOrderUsed).toBe("live");
    expect(snapshot.teams.map((x) => x.waiverRank)).toEqual(positions);
    expect(snapshot.teams.every((x) => x.liveWaiverRank === undefined)).toBe(true);
    expect(snapshot.warnings.map((w) => w.code)).toContain(WAIVER_RESET_BEFORE_GAMES);
    expect(notes.filter((n) => n.startsWith("Waiver order"))).toEqual([]);
    // The test league's own rolling waivers: no warning before any game either.
    const rolling = withPositions(loadTestLeague());
    rolling.rosters.forEach((r) => Object.assign(r.settings, { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 }));
    expect(run(rolling).snapshot.warnings.map((w) => w.code)).not.toContain(WAIVER_RESET_BEFORE_GAMES);
  });
});
