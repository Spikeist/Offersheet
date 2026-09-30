import { describe, expect, it } from "vitest";
import { contributions, leaguePoints, runOracle, type StatLine } from "./oracle";

const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rec: 0.5, rec_yd: 0.1, fum_rec: 2, pts_allow_7_13: 4 };

describe("leaguePoints", () => {
  it("sums rate × stat over scoring keys, ignoring unscored stats", () => {
    expect(leaguePoints(scoring, { pass_yd: 250, pass_td: 2, pass_int: 1, rush_yd: 12, pass_att: 35 })).toBeCloseTo(10 + 8 - 1 + 1.2, 9);
    expect(leaguePoints(scoring, { pts_allow_7_13: 1, pts_allow: 10 })).toBe(4);
    expect(leaguePoints(scoring, null)).toBe(0);
  });

  it("lists non-zero contributions, largest first", () => {
    expect(contributions(scoring, { rec: 4, rec_yd: 60 }).map((c) => c.key)).toEqual(["rec_yd", "rec"]);
  });
});

describe("runOracle", () => {
  it("counts matches within tolerance and explains a single-key mismatch", () => {
    const stats = new Map<string, StatLine>([
      ["A", { rec: 5, rec_yd: 70 }], // 2.5 + 7 = 9.5
      ["B", { rush_yd: 50, fum_rec: 1 }], // 5 + 2 = 7, but Sleeper says 5 (doesn't count fum_rec for this player)
    ]);
    const result = runOracle(scoring, [{ week: 2, entries: [{ rosterId: 1, players: ["A", "B", "C"], playersPoints: { A: 9.5, B: 5, C: 0 } }], stats }], (id) => (id === "B" ? "RB" : "WR"));
    expect(result.total).toBe(3);
    expect(result.within).toBe(2);
    expect(result.nonZeroTotal).toBe(2); // C has 0 points and no stats
    expect(result.mismatches).toHaveLength(1);
    const m = result.mismatches[0];
    expect(m?.playerId).toBe("B");
    expect(m?.diff).toBe(-2);
    expect(m?.explainedBy[0]).toMatch(/^fum_rec/);
    expect(Object.keys(result.patterns)[0]).toMatch(/^RB: fum_rec/);
  });

  it("flags platform points with no stats row", () => {
    const result = runOracle(scoring, [{ week: 3, entries: [{ rosterId: 2, players: ["X"], playersPoints: { X: 6 } }], stats: new Map() }], () => "TE");
    expect(result.missingStats).toBe(1);
    expect(result.patterns).toEqual({ "TE: no stats row": 1 });
  });

  it("counts, per scoring key, the player-weeks it contributed to and how many matched", () => {
    const te = { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 };
    const stats = new Map<string, StatLine>([
      ["T1", { rec: 6, rec_yd: 80, bonus_rec_te: 6 }], // 6 + 8 + 3 = 17
      ["T2", { rec: 2, rec_yd: 10, bonus_rec_te: 2 }], // 2 + 1 + 1 = 4, Sleeper says 3
      ["W1", { rec_yd: 12 }],
    ]);
    const result = runOracle(te, [{ week: 3, entries: [{ rosterId: 1, players: ["T1", "T2", "W1"], playersPoints: { T1: 17, T2: 3, W1: 1.2 } }], stats }], () => "TE");
    expect(result.byKey).toEqual({ rec: { exercised: 2, within: 1 }, rec_yd: { exercised: 3, within: 2 }, bonus_rec_te: { exercised: 2, within: 1 } });
  });
});
