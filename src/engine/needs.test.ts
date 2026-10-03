import { describe, expect, it } from "vitest";
import { config } from "./config";
import type { SlotStrength } from "./leagueModel";
import { lineupTotal, prepareRoster, prepareSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import {
  chipsTogether,
  findNeeds,
  helpfulPlayers,
  instanceIndex,
  instancePointsInto,
  rankPartners,
  slotInstances,
  standardize,
  strengthTable,
  surplusScores,
  tradeChips,
  windowAverage,
  zScores,
  type ChipCandidate,
  type SideChip,
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

describe("the surplus score (§12 step 2: kept for Phase 4's give pool)", () => {
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

  it("is 0 − z(MV_lose) when values don't tell the roster's players apart (all equal, or none loaded)", () => {
    const mvLose = [30, 10, 0];
    const zl = standardize(mvLose);
    surplusScores([0, 0, 0], mvLose).forEach((s, i) => expect(s).toBeCloseTo(-(zl[i] as number), 12));
    expect(standardize([40, 40, 40])).toEqual([0, 0, 0]);
  });
});

describe("tradeChips (§7; planner reply to Checkpoint 2, answer 2)", () => {
  const best = (value: number, teamId: string) => ({ value, teamId });
  /** A candidate; the display fields (lead decision L5) don't change the rule, so most cases leave them at 0 and false. */
  const cand = (playerId: string, cost: number, b: { value: number; teamId: string } | null, display: Partial<Pick<ChipCandidate, "costPerWeek" | "starter">> = {}): ChipCandidate => ({
    playerId,
    cost,
    best: b,
    costPerWeek: display.costPerWeek ?? 0,
    starter: display.starter ?? false,
  });

  it("keeps players worth at least chipMinGap more to another team than to their own: gap = maxOther − cost, biggest first, ties by id", () => {
    expect(config.needs.chipMinGap).toBe(10);
    const got = tradeChips(
      [
        cand("nix", 14, best(45, "6")), // gap 31
        cand("starter", 120, best(125, "6")), // gap 5: his team needs him
        cand("b", 0, best(31, "2")), // gap 31: ties with nix, smaller id first
        cand("nobody", 3, null), // he'd add nothing anywhere
        cand("edge", 5, best(15, "4")), // gap exactly 10
      ],
      config.needs,
    );
    expect(got.map((c) => c.playerId)).toEqual(["b", "nix", "edge"]);
    expect(got[1]).toEqual({ playerId: "nix", gap: 31, cost: 14, maxOther: 45, bestTeamId: "6", costPerWeek: 0, starter: false });
  });

  it("passes the display fields through (L5: cost per week and the starter tag), which the rule never reads", () => {
    const got = tradeChips([cand("cmc", 85.3, best(118.3, "2"), { costPerWeek: 6.1, starter: true }), cand("bench", 0, best(40, "3"), { costPerWeek: 0, starter: false })], config.needs);
    expect(got).toEqual([
      { playerId: "bench", gap: 40, cost: 0, maxOther: 40, bestTeamId: "3", costPerWeek: 0, starter: false },
      { playerId: "cmc", gap: expect.closeTo(33, 9), cost: 85.3, maxOther: 118.3, bestTeamId: "2", costPerWeek: 6.1, starter: true },
    ]);
    // The same candidates without the display fields' values: the same chips, in the same order.
    expect(tradeChips([cand("cmc", 85.3, best(118.3, "2")), cand("bench", 0, best(40, "3"))], config.needs).map((c) => c.playerId)).toEqual(got.map((c) => c.playerId));
  });

  it("equal gaps list the cheaper one to lose first, then the smaller id (D3: a starter and the backup who covers him share a gap)", () => {
    const got = tradeChips(
      [
        cand("a-starter", 7 * 14.75, best(15 * 14.75, "2")), // gap 8 × 14.75
        cand("z-backup", 0, best(8 * 14.75, "2")), // the same gap, nothing to lose
        cand("m-mid", 3 * 14.75 + 1e-12, best(11 * 14.75 + 1e-12, "3")), // the same gap summed another way
        cand("b-twin", 3 * 14.75, best(11 * 14.75, "4")), // an equal cost: the id decides
      ],
      config.needs,
    );
    expect(got.map((c) => c.playerId)).toEqual(["z-backup", "b-twin", "m-mid", "a-starter"]);
  });

  it("counts a gap within float noise of the cut as at it, reads the cut from config, and never keeps a non-finite gap", () => {
    expect(tradeChips([cand("x", 0.1 + 0.2, best(10.3, "2"))], config.needs).map((c) => c.playerId)).toEqual(["x"]); // 9.999999999999998
    expect(tradeChips([cand("x", 0, best(9.99, "2"))], config.needs)).toEqual([]);
    expect(tradeChips([cand("x", 0, best(9.99, "2"))], { chipMinGap: 5 }).map((c) => c.playerId)).toEqual(["x"]);
    expect(tradeChips([cand("x", Number.NaN, best(50, "2"))], config.needs)).toEqual([]);
    expect(tradeChips([cand("x", 0, best(Number.POSITIVE_INFINITY, "2"))], config.needs)).toEqual([]);
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

  it("chipsTogether (D2): the first chip by own gain counts; each next one only while still a chip once the counted ones have left; at most maxPerSide", () => {
    const side: SideChip[] = [
      { playerId: "backup", ppw: 4, gap: 30 },
      { playerId: "starter", ppw: 9, gap: 30 },
      { playerId: "spare", ppw: 3, gap: 12 },
      { playerId: "useless", ppw: 0, gap: 40 }, // adds nothing to the other lineup: never counted, never asked about
    ];
    const asked: [string, string[]][] = [];
    // Once the starter has left, his backup is the starter: no longer a chip. The spare stays one.
    const stillChip = (id: string, taken: readonly string[]) => {
      asked.push([id, [...taken]]);
      return !(id === "backup" && taken.includes("starter"));
    };
    expect(chipsTogether(side, 2, stillChip)).toEqual(["starter", "spare"]);
    expect(asked).toEqual([
      ["backup", ["starter"]],
      ["spare", ["starter"]],
    ]);
    // maxPerSide caps the count (the first is never asked about); 3 lets a third one in when he stays a chip.
    asked.length = 0;
    expect(chipsTogether(side, 1, stillChip)).toEqual(["starter"]);
    expect(asked).toEqual([]);
    expect(chipsTogether(side, 3, () => true)).toEqual(["starter", "backup", "spare"]);
    expect(chipsTogether(side, Number.NaN, () => true)).toEqual(["starter"]);
    expect(chipsTogether([], 2, () => true)).toEqual([]);
  });

  it("chipsTogether orders equal gains (within float noise) by the larger gap, then the smaller id", () => {
    const side: SideChip[] = [
      { playerId: "c", ppw: 7, gap: 20 },
      { playerId: "b", ppw: 7 + 1e-12, gap: 25 },
      { playerId: "a", ppw: 7, gap: 20 },
    ];
    expect(chipsTogether(side, 3, () => true)).toEqual(["b", "a", "c"]);
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
