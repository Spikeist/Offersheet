import { describe, expect, it } from "vitest";
import { config } from "./config";
import type { SlotStrength } from "./leagueModel";
import { lineupTotal, prepareRoster, prepareSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import {
  findNeeds,
  helpfulPlayers,
  instanceIndex,
  instancePointsInto,
  qualifyingSurplus,
  rankPartners,
  slotInstances,
  standardize,
  strengthTable,
  surplusScores,
  windowAverage,
  zScores,
} from "./needs";
import { TEST_LINEUP } from "./testLeague";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });

describe("slotInstances (§7 strength by lineup slot; the League page's heatmap columns)", () => {
  it("gives one instance per starting spot: rank 1 even alone, labels drop the rank for single spots, DEF reads D/ST", () => {
    const got = slotInstances(TEST_LINEUP);
    expect(got.map((s) => s.key)).toEqual(["QB1", "RB1", "RB2", "WR1", "WR2", "TE1", "FLEX1", "K1", "DEF1"]);
    expect(got.map((s) => s.label)).toEqual(["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "K", "D/ST"]);
    expect(got[2]).toEqual({ key: "RB2", label: "RB2", slot: "RB", rank: 2 });
  });

  it("keeps the platform's slot names in keys (ESPN D/ST) and uses short labels for flex slots", () => {
    const espn = slotInstances([slot("QB", 1, ["QB"]), slot("D/ST", 1, ["DEF"]), slot("RB/WR/TE", 2, ["RB", "WR", "TE"])]);
    expect(espn.map((s) => [s.key, s.label])).toEqual([
      ["QB1", "QB"],
      ["D/ST1", "D/ST"],
      ["RB/WR/TE1", "FLEX1"],
      ["RB/WR/TE2", "FLEX2"],
    ]);
    const sleeper = slotInstances([slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"]), slot("REC_FLEX", 1, ["WR", "TE"]), slot("WRRB_FLEX", 1, ["RB", "WR"]), slot("IDP_FLEX", 1, ["DL", "LB", "DB"])]);
    expect(sleeper.map((s) => s.label)).toEqual(["SF", "W/T", "W/R", "IDP"]);
  });

  it("numbers slots of one name together at the name's first place, and skips spots lineup.ts can't fill", () => {
    const got = slotInstances([slot("RB", 1, ["RB"]), slot("WR", 1, ["WR"]), slot("RB", 1, ["RB"]), slot("OP", 0, ["QB"]), slot("HC", 1, [])]);
    expect(got.map((s) => s.key)).toEqual(["RB1", "RB2", "WR1"]);
    expect(slotInstances([slot("TE", 1.7, ["TE"])]).map((s) => s.key)).toEqual(["TE1"]); // whole spots, as prepareSlots counts them
  });

  it("never repeats a key, even for a slot name ending in a digit", () => {
    const got = slotInstances([slot("WR", 12, ["WR"]), slot("WR1", 2, ["WR"])]);
    expect(new Set(got.map((s) => s.key)).size).toBe(14);
  });
});

describe("instancePointsInto (§7: a lineup's starters by slot instance)", () => {
  it("sorts each slot's starters by points, best in rank 1; FLEX holds the best leftover; empty spots are 0", () => {
    const slots = prepareSlots(TEST_LINEUP);
    const instances = slotInstances(TEST_LINEUP);
    const index = instanceIndex(instances, slots);
    const players = [
      { id: "rb-a", pos: "RB" as Pos, eligible: ["RB" as Pos] },
      { id: "rb-b", pos: "RB" as Pos, eligible: ["RB" as Pos] },
      { id: "rb-c", pos: "RB" as Pos, eligible: ["RB" as Pos] },
      { id: "wr-a", pos: "WR" as Pos, eligible: ["WR" as Pos] },
      { id: "qb", pos: "QB" as Pos, eligible: ["QB" as Pos] },
    ];
    const roster = prepareRoster(players, slots);
    const points = Float64Array.from([9, 15, 12, 11, 20]);
    const seat = new Int32Array(players.length);
    lineupTotal(roster, points, null, seat);
    const out = instancePointsInto(index, seat, points, null, players.length, new Float64Array(index.size));
    const byKey = Object.fromEntries(instances.map((s, i) => [s.key, out[i]]));
    expect(byKey).toEqual({ QB1: 20, RB1: 15, RB2: 12, WR1: 11, WR2: 0, TE1: 0, FLEX1: 9, K1: 0, DEF1: 0 });
    // An unavailable starter scores 0 in his spot (a scenario lineup that still seats him: an MFL minimum).
    const avail = Uint8Array.from([1, 0, 1, 1, 1]);
    const again = instancePointsInto(index, seat, points, avail, players.length, new Float64Array(index.size));
    expect(again[instances.findIndex((s) => s.key === "RB1")]).toBe(12);
    expect(again[instances.findIndex((s) => s.key === "RB2")]).toBe(0);
  });
});

describe("windowAverage", () => {
  it("averages per-week instance points over [from, to), clipped to the weeks there are", () => {
    const perWeek = [Float64Array.from([10, 2]), Float64Array.from([20, 4]), Float64Array.from([30, 6])];
    expect([...windowAverage(perWeek, 0, 2, 2)]).toEqual([15, 3]);
    expect([...windowAverage(perWeek, 0, 9, 2)]).toEqual([20, 4]);
    expect([...windowAverage(perWeek, 0, 0, 2)]).toEqual([0, 0]);
    expect([...windowAverage([], 0, 4, 2)]).toEqual([0, 0]);
  });
});

describe("z-scores (§7 strength across teams; §12 surplus score within a roster)", () => {
  it("zScores centers on the league MEDIAN and divides by the population SD", () => {
    const xs = [10, 12, 14, 30];
    const mean = 16.5;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    const z = zScores(xs);
    xs.forEach((x, i) => expect(z[i]).toBeCloseTo((x - 13) / sd, 12));
  });

  it("gives 0 everywhere when every team is the same (SD below 1e-9)", () => {
    expect(zScores([7, 7, 7])).toEqual([0, 0, 0]);
    expect(zScores([])).toEqual([]);
    expect(standardize([3, 3])).toEqual([0, 0]);
  });

  it("standardize centers on the mean", () => {
    const z = standardize([1, 2, 3]);
    expect(z[0]).toBeCloseTo(-Math.sqrt(1.5), 12);
    expect(z[1]).toBe(0);
    expect(z[2]).toBeCloseTo(Math.sqrt(1.5), 12);
  });
});

describe("strengthTable and findNeeds (§7: needs are slots with z ≤ needZThreshold)", () => {
  const instances = slotInstances([slot("QB", 1, ["QB"]), slot("TE", 1, ["TE"]), slot("K", 1, ["K"])]);
  // Four teams; team 3 has no TE; team 4's QB is weak only over the next weeks (an injury).
  const next = [Float64Array.from([20, 10, 8]), Float64Array.from([20, 9, 8]), Float64Array.from([20, 0, 8]), Float64Array.from([5, 11, 8])];
  const ros = [Float64Array.from([20, 10, 8]), Float64Array.from([20, 9, 8]), Float64Array.from([20, 0, 8]), Float64Array.from([20, 11, 8])];
  const table = strengthTable(instances, next, ros);

  it("stores each team's window averages with z-scores across teams", () => {
    expect(table[2]?.TE1).toMatchObject({ next: 0, ros: 0 });
    expect(table[2]?.TE1?.zRos).toBeLessThan(-1);
    expect(table[0]?.K1).toEqual({ next: 8, ros: 8, zNext: 0, zRos: 0 }); // everyone equal: z 0
  });

  it("flags rest-of-season needs, and next-weeks-only needs when the rest of the season is fine; weakest first", () => {
    const threshold = config.lineups.needZThreshold;
    expect(findNeeds(table[2] as Record<string, SlotStrength>, instances, threshold)).toEqual([{ slot: "TE1", z: table[2]?.TE1?.zRos, window: "ros" }]);
    expect(findNeeds(table[3] as Record<string, SlotStrength>, instances, threshold)).toEqual([{ slot: "QB1", z: table[3]?.QB1?.zNext, window: "next" }]);
    expect(findNeeds(table[0] as Record<string, SlotStrength>, instances, threshold)).toEqual([]);
    const both = { QB1: { next: 0, ros: 0, zNext: -0.6, zRos: -0.7 }, TE1: { next: 0, ros: 0, zNext: -3, zRos: -2 } };
    expect(findNeeds(both, instances, threshold).map((n) => n.slot)).toEqual(["TE1", "QB1"]);
  });
});

describe("surplus (§7 high value, low MV_lose; §12 surplus score)", () => {
  it("surplusScores = z(value) − z(MV_lose) within the roster", () => {
    const values = [9000, 8000, 500, 100];
    const mvLose = [120, 5, 60, 0];
    const zv = standardize(values);
    const zl = standardize(mvLose);
    surplusScores(values, mvLose).forEach((s, i) => expect(s).toBeCloseTo((zv[i] as number) - (zl[i] as number), 12));
    // The valuable player his team barely needs scores highest.
    const scores = surplusScores(values, mvLose);
    expect(scores.indexOf(Math.max(...scores))).toBe(1);
  });

  it("a surplus player needs the minimum score, a below-average lineup cost AND to start for another team; best first, ties by id", () => {
    const got = qualifyingSurplus(
      [
        { playerId: "a", score: 2, costZ: -1, startsFor: 0 },
        { playerId: "b", score: 1.5, costZ: -0.4, startsFor: 2 },
        { playerId: "c", score: 0.9, costZ: -1.2, startsFor: 5 },
        { playerId: "e", score: 1.5, costZ: -0.9, startsFor: 1 },
        { playerId: "d", score: 3, costZ: -0.1, startsFor: 1 },
      ],
      config.needs,
    );
    expect(got.map((s) => s.playerId)).toEqual(["d", "b", "e"]);
    expect(got[0]).toEqual({ playerId: "d", score: 3, startsFor: 1 });
  });

  it("a star isn't surplus: convex values give him a high score, but his lineup cost is above the roster's average (§7: low MV_lose)", () => {
    expect(config.needs.surplusMaxCostZ).toBe(0);
    // A roster: a star (value 20,000; the biggest lineup cost), seven ordinary starters, and a valuable backup who costs nothing.
    const values = [20_000, 2_000, 1_800, 1_500, 1_500, 1_200, 1_000, 900, 6_000];
    const mvLose = [260, 200, 190, 180, 170, 150, 140, 120, 0];
    const scores = surplusScores(values, mvLose);
    const costZ = standardize(mvLose);
    expect(scores[0]).toBeGreaterThanOrEqual(config.needs.surplusMinScore); // the old rule made the star a chip
    expect(costZ[0]).toBeGreaterThan(0);
    const got = qualifyingSurplus(
      values.map((_, i) => ({ playerId: `p${i}`, score: scores[i] as number, costZ: costZ[i] as number, startsFor: 3 })),
      config.needs,
    );
    expect(got.map((s) => s.playerId)).toEqual(["p8"]); // only the backup: depth that would start elsewhere
  });

  it("the cost cut is strict: an exactly average cost (z 0, or float noise around it) doesn't count as low; neither does a roster whose costs are all equal", () => {
    const row = (costZ: number) => ({ playerId: "x", score: 2, costZ, startsFor: 1 });
    expect(qualifyingSurplus([row(0)], config.needs)).toEqual([]);
    expect(qualifyingSurplus([row(-1e-12)], config.needs)).toEqual([]);
    expect(qualifyingSurplus([row(-0.01)], config.needs).map((s) => s.playerId)).toEqual(["x"]);
    expect(qualifyingSurplus([row(0.5)], { surplusMinScore: 1, surplusMaxCostZ: 1 }).map((s) => s.playerId)).toEqual(["x"]); // the cut comes from config
    expect(standardize([40, 40, 40])).toEqual([0, 0, 0]);
  });
});

describe("rankPartners (§7 best trade partners; Phase 2 review: each side scored by its joint gain)", () => {
  it("scores sqrt(what theirs adds to me together × what mine adds to them together), mutual fits first, best first, keeps partnersShown", () => {
    const got = rankPartners(
      [
        { teamId: "2", theyCanGive: [{ playerId: "x", ppw: 2 }], youCanGive: [{ playerId: "y", ppw: 8 }], get: 2, give: 8 },
        { teamId: "3", theyCanGive: [{ playerId: "p", ppw: 9 }], youCanGive: [], get: 9, give: 0 },
        // q and r compete for one slot: together they add 3.5 a week, not 1 + 3.
        { teamId: "4", theyCanGive: [{ playerId: "q", ppw: 1 }, { playerId: "r", ppw: 3 }, { playerId: "s", ppw: 0 }], youCanGive: [{ playerId: "y", ppw: 1 }], get: 3.5, give: 1 },
        { teamId: "5", theyCanGive: [{ playerId: "t", ppw: 1 }], youCanGive: [{ playerId: "y", ppw: 1 }], get: 1, give: 1 },
        { teamId: "6", theyCanGive: [{ playerId: "u", ppw: 0.5 }], youCanGive: [{ playerId: "y", ppw: 0.5 }], get: 0.5, give: 0.5 },
      ],
      { partnersShown: 3 },
    );
    expect(got.map((p) => p.teamId)).toEqual(["2", "4", "5"]); // mutual fits fill the list before team 3's one-sided fit
    expect(got.every((p) => p.mutual)).toBe(true);
    expect(got[0]?.score).toBeCloseTo(4, 12);
    expect(got[1]?.score).toBeCloseTo(Math.sqrt(3.5), 12);
    expect(got[1]?.theyCanGive).toEqual([
      { playerId: "r", ppw: 3 },
      { playerId: "q", ppw: 1 },
    ]); // the card lists each player's own gain: the 0-point player is dropped, most helpful first
  });

  it("two spare players who compete for one slot don't outrank one better player: the score is their joint gain, not the sum", () => {
    // Team 2's two 11-point RBs each add 5.29 alone but only 5.29 together (one RB slot to upgrade); team 3's 13-point RB adds 7.05.
    const got = rankPartners(
      [
        { teamId: "2", theyCanGive: [{ playerId: "a", ppw: 5.29 }, { playerId: "b", ppw: 5.29 }], youCanGive: [], get: 5.29, give: 0 },
        { teamId: "3", theyCanGive: [{ playerId: "c", ppw: 7.05 }], youCanGive: [], get: 7.05, give: 0 },
      ],
      { partnersShown: 3 },
    );
    expect(got.map((p) => [p.teamId, p.score])).toEqual([
      ["3", 7.05],
      ["2", 5.29],
    ]);
    expect(got[1]?.theyCanGive.map((x) => x.ppw)).toEqual([5.29, 5.29]);
  });

  it("a side with no helpful player scores 0 whatever its joint gain says; a joint gain that isn't finite counts as 0", () => {
    const got = rankPartners(
      [
        { teamId: "2", theyCanGive: [{ playerId: "x", ppw: 0 }], youCanGive: [{ playerId: "y", ppw: 4 }], get: 6, give: 4 },
        { teamId: "3", theyCanGive: [{ playerId: "p", ppw: 2 }], youCanGive: [{ playerId: "y", ppw: 4 }], get: Number.NaN, give: 4 },
        { teamId: "4", theyCanGive: [{ playerId: "q", ppw: 2 }], youCanGive: [{ playerId: "y", ppw: 4 }], get: 2, give: Number.POSITIVE_INFINITY },
      ],
      { partnersShown: 3 },
    );
    expect(got).toEqual([{ teamId: "4", mutual: false, score: 2, theyCanGive: [{ playerId: "q", ppw: 2 }], youCanGive: [] }]);
  });

  it("lists one-sided fits (they could help me, I can't help them) after every mutual one; drops fits where only I help them", () => {
    const got = rankPartners(
      [
        { teamId: "2", theyCanGive: [{ playerId: "x", ppw: 1 }], youCanGive: [{ playerId: "y", ppw: 1 }], get: 1, give: 1 },
        { teamId: "3", theyCanGive: [{ playerId: "p", ppw: 9 }], youCanGive: [], get: 9, give: 0 },
        { teamId: "4", theyCanGive: [], youCanGive: [{ playerId: "y", ppw: 7 }], get: 0, give: 7 },
        { teamId: "5", theyCanGive: [{ playerId: "t", ppw: 2 }, { playerId: "u", ppw: 3 }], youCanGive: [{ playerId: "y", ppw: 0 }], get: 5, give: 0 },
      ],
      { partnersShown: 5 },
    );
    expect(got.map((p) => [p.teamId, p.mutual])).toEqual([
      ["2", true],
      ["3", false],
      ["5", false],
    ]);
    expect(got[1]?.score).toBe(9); // one-sided: what they'd add to my lineup
    expect(got[2]?.score).toBe(5);
    expect(got[2]?.youCanGive).toEqual([]);
  });

  it("helpfulPlayers keeps the players who add more than 0 (float noise aside), most first, ties by id", () => {
    expect(
      helpfulPlayers([
        { playerId: "b", ppw: 2 },
        { playerId: "z", ppw: 1e-12 },
        { playerId: "a", ppw: 2 },
        { playerId: "c", ppw: 5 },
        { playerId: "d", ppw: -1 },
      ]),
    ).toEqual([
      { playerId: "c", ppw: 5 },
      { playerId: "a", ppw: 2 },
      { playerId: "b", ppw: 2 },
    ]);
  });
});
