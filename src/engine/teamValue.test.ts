import { describe, expect, it } from "vitest";
import { config } from "./config";
import { lineupOrder, lineupTotal, prepareRoster, prepareSlots, solveLineup, type PreparedSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { instanceIndex, instancePointsInto, slotInstances } from "./needs";
import { weeklySd } from "./projections";
import { mulberry32 } from "./rng";
import {
  addGainExact,
  addRowsGain,
  addUpperBound,
  bestFreeAgent,
  evLineups,
  evRemovalCosts,
  evScore,
  lowestKeepValue,
  mvAddGroupPpw,
  mvAddPpw,
  mvLose,
  pickFreeAgent,
  positionAllows,
  ppw,
  rosterScore,
  rosValue,
  scenarioAddGain,
  scenarioAddUpperBound,
  scenarioLineups,
  scenarioRemovalCosts,
  scenarioScore,
  scenarioValues,
  slotMask,
  solveEvWeeks,
  tableRows,
  teamEval,
  waiverAdjustment,
  weekWeights,
  windowWeights,
  type ProjectionTable,
  type RosterMove,
  type ScenarioCells,
  type TableRow,
} from "./teamValue";
import { TEST_LINEUP } from "./testLeague";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });

/** A table row from per-week conditional points and availability (EV = c × a; SDs by §6 step 5, as league.ts builds them); flags S × W row-major. */
function row(id: string, pos: Pos, cond: number[], opts: { a?: number[]; flags?: number[][]; eligible?: Pos[] } = {}): TableRow {
  const W = cond.length;
  const a = opts.a ?? cond.map(() => 1);
  const flags = opts.flags ? Uint8Array.from(opts.flags.flat()) : null;
  if (flags && flags.length % W !== 0) throw new Error("flags must be S × W");
  const ev = Float64Array.from(cond, (c, w) => c * (a[w] as number));
  return {
    id,
    pos,
    eligible: opts.eligible ?? [pos],
    cond: Float64Array.from(cond),
    ev,
    condSd: Float64Array.from(cond, (c) => weeklySd(c, pos)),
    evSd: Float64Array.from(ev, (p) => weeklySd(p, pos)),
    flags,
  };
}

function table(rows: TableRow[], weeks: number[], scenarios = 0): ProjectionTable {
  return { weeks, scenarios, rows: new Map(rows.map((r) => [r.id, r])) };
}

/** Brute-force LV for one week: solveLineup over the given points. */
function lv(rows: readonly TableRow[], slots: PreparedSlots, points: (r: TableRow) => number): number {
  return solveLineup(
    rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible, points: points(r) })),
    slots,
  ).total;
}

const STANDARD = prepareSlots(TEST_LINEUP);
const SUPERFLEX_LINEUP: SlotDef[] = [slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 2, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"]), slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"]), slot("WRRB_FLEX", 1, ["RB", "WR"])];
const SUPERFLEX = prepareSlots(SUPERFLEX_LINEUP);
const IDP_LINEUP: SlotDef[] = [...TEST_LINEUP, slot("DL", 2, ["DL"]), slot("LB", 2, ["LB"]), slot("DB", 2, ["DB"]), slot("IDP_FLEX", 1, ["DL", "LB", "DB"])];

// ---------------------------------------------------------------------------------------------

describe("ROS and PPW (§7 rest of season)", () => {
  const weeks = [12, 13, 14, 15, 16, 17];
  const regular = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const playoffs = [15, 16, 17];

  it("ω = 1 in regular weeks and playoffWeight in playoff weeks; ROS = Σ ω·LV", () => {
    const w = weekWeights(weeks, regular, playoffs);
    expect([...w]).toEqual([1, 1, 1, config.lineups.playoffWeight, config.lineups.playoffWeight, config.lineups.playoffWeight]);
    expect(rosValue([100, 100, 100, 100, 100, 100], w)).toBeCloseTo(300 + 300 * config.lineups.playoffWeight, 9);
    expect([...weekWeights(weeks, regular, playoffs, { playoffWeight: 2 })]).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it("a remaining week that is neither regular season nor playoffs weighs 0 (no fantasy game in it)", () => {
    expect([...weekWeights([13, 14, 15], [13], [15])]).toEqual([1, 0, config.lineups.playoffWeight]);
  });

  it("PPW averages LV over the remaining regular-season weeks only; 0 when none remain", () => {
    expect(ppw([90, 100, 110, 500, 500, 500], weeks, regular)).toBe(100);
    expect(ppw([500, 500], [16, 17], regular)).toBe(0);
  });

  it("windowWeights average a window of weeks", () => {
    expect([...windowWeights(6, 0, 4)]).toEqual([0.25, 0.25, 0.25, 0.25, 0, 0]);
    expect([...windowWeights(2, 0, 4)]).toEqual([0.5, 0.5]);
    expect([...windowWeights(0, 0, 4)]).toEqual([]);
  });
});

describe("EV lineups (§7 LV with expected points)", () => {
  it("each week's best lineup of the active roster, with its starters", () => {
    const rows = [row("qb", "QB", [20, 18]), row("rb1", "RB", [15, 0]), row("rb2", "RB", [12, 11]), row("rb3", "RB", [9, 10]), row("wr1", "WR", [14, 14])];
    const t = table(rows, [5, 6]);
    const got = evLineups(["qb", "rb1", "rb2", "rb3", "wr1"], t, STANDARD);
    expect(got.lv).toEqual([20 + 15 + 12 + 14 + 9, 18 + 11 + 10 + 14]);
    expect(got.starters[1]?.map((s) => `${s.slot}:${s.id}`)).toEqual(["QB:qb", "RB:rb2", "RB:rb3", "WR:wr1"]);
  });

  it("ignores ids without a row (players the model has no projection for)", () => {
    const t = table([row("qb", "QB", [20])], [5]);
    expect(evLineups(["qb", "ghost"], t, STANDARD).lv).toEqual([20]);
  });
});

describe("scenario lineups (planner reply to Checkpoint 1, addition C)", () => {
  it("a bench RB behind two stars never starts in the EV lineup but starts whenever a star is out", () => {
    // Two scenarios, two weeks. Scenario 1: star A is out in week 1.
    const a = row("rbA", "RB", [20, 20], { a: [0.5, 1], flags: [[1, 1], [0, 1]] });
    const b = row("rbB", "RB", [18, 18], { flags: [[1, 1], [1, 1]] });
    const c = row("rbC", "RB", [10, 10], { flags: [[1, 1], [1, 1]] });
    const lineup = [slot("RB", 2, ["RB"])];
    const slots = prepareSlots(lineup);
    const t = table([a, b, c], [5, 6], 2);
    // EV week 5: A 10 (20 × 0.5), B 18, C 10 → the best two are 18 + 10 (a tie at 10 goes to the smaller id, rbA).
    expect(evLineups(["rbA", "rbB", "rbC"], t, slots).lv).toEqual([28, 38]);
    const scen = scenarioLineups(["rbA", "rbB", "rbC"], t, slots);
    expect(scen.lv).toEqual([(38 + 28) / 2, 38]);
    expect(scen.sd[0]).toBeCloseTo(5, 12);
    expect(scen.sd[1]).toBe(0);
  });

  it("with every player certain to play or not, scenario LV equals EV LV exactly and the spread is 0", () => {
    const weeks = [5, 6, 7];
    const rows = [row("qb", "QB", [20, 0, 18]), row("rb1", "RB", [15, 16, 0]), row("rb2", "RB", [9, 12, 11])].map((r) => {
      const S = 4;
      const flags = Array.from({ length: S }, () => [...r.cond].map((c) => (c > 0 ? 1 : 0)));
      return row(r.id, r.pos, [...r.cond], { flags });
    });
    const t = table(rows, weeks, 4);
    const ids = rows.map((r) => r.id);
    expect(scenarioLineups(ids, t, STANDARD).lv).toEqual(evLineups(ids, t, STANDARD).lv);
    expect(scenarioLineups(ids, t, STANDARD).sd).toEqual([0, 0, 0]);
  });

  it("matches a naive solve of every scenario (the per-week memo changes nothing): 300 random rosters", () => {
    const rand = mulberry32(20260930);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"];
    for (let trial = 0; trial < 300; trial++) {
      const W = 1 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 12);
      const n = 3 + Math.floor(rand() * 12);
      const lineup = trial % 2 === 0 ? TEST_LINEUP : SUPERFLEX_LINEUP;
      const slots = prepareSlots(lineup);
      const rows = Array.from({ length: n }, (_, k) => {
        const pos = positions[Math.floor(rand() * positions.length)] as Pos;
        const cond = Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 250) / 10));
        // Mostly available, so scenarios repeat and the memo is exercised.
        const flags = Array.from({ length: S }, () => Array.from({ length: W }, () => (rand() < 0.8 ? 1 : 0)));
        return row(`p${k}`, pos, cond, { flags, eligible: pos === "RB" && rand() < 0.3 ? ["RB", "WR"] : [pos] });
      });
      const index = instanceIndex(slotInstances(lineup), slots);
      const got = scenarioValues(teamEval(rows, slots), W, S, index, false, true);
      const naive = prepareRoster(rows, slots);
      for (let w = 0; w < W; w++) {
        const lvs: number[] = [];
        let within = 0;
        const inst = new Float64Array(index.size);
        for (let s = 0; s < S; s++) {
          // Scenario s, week w: a player scores c_w when his flag is 1, else 0; one plain solve per scenario.
          const pts = Float64Array.from(rows, (r) => ((r.flags as Uint8Array)[s * W + w] === 1 ? (r.cond[w] as number) : 0));
          const seat = new Int32Array(n);
          lvs.push(lineupTotal(naive, pts, null, seat));
          // The starters who play add their SD given they play: Σ condSd² (the law of total variance's within part).
          rows.forEach((r, k) => {
            if ((seat[k] as number) >= 0 && (r.flags as Uint8Array)[s * W + w] === 1) within += ((r.condSd[w] as number) ** 2) / S;
          });
          const one = instancePointsInto(index, seat, pts, null, n, new Float64Array(index.size));
          for (let i = 0; i < index.size; i++) inst[i] = (inst[i] as number) + (one[i] as number) / S;
        }
        const mean = lvs.reduce((x, y) => x + y, 0) / S;
        const sd = Math.sqrt(lvs.reduce((x, y) => x + (y - mean) ** 2, 0) / S);
        expect(got.mean[w], `trial ${trial} week ${w}`).toBeCloseTo(mean, 9);
        expect(got.sd[w], `trial ${trial} week ${w}`).toBeCloseTo(sd, 9);
        expect(got.within?.[w], `trial ${trial} week ${w}`).toBeCloseTo(within, 9);
        for (let i = 0; i < index.size; i++) expect(got.instances?.[w]?.[i], `trial ${trial} week ${w} instance ${i}`).toBeCloseTo(inst[i] as number, 9);
      }
      expect(got.solves).toBeLessThanOrEqual(S * W);
    }
  });

  it("matches a naive solve on deep rosters where more than 30 players can score (the memo's string key): 80 random rosters", () => {
    const rand = mulberry32(424242);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
    const lineups = [TEST_LINEUP, SUPERFLEX_LINEUP, IDP_LINEUP];
    let deep = 0;
    for (let trial = 0; trial < 80; trial++) {
      const W = 1 + Math.floor(rand() * 3);
      const S = 2 + Math.floor(rand() * 7);
      const n = 32 + Math.floor(rand() * 14);
      const lineup = lineups[trial % 3] as SlotDef[];
      const slots = prepareSlots(lineup);
      // Mostly available, so scenarios repeat on the top players and the memo is reused.
      const pAvail = trial % 2 === 0 ? 0.97 : 0.8;
      const rows = Array.from({ length: n }, (_, k) => {
        const pos = positions[Math.floor(rand() * positions.length)] as Pos;
        const cond = Array.from({ length: W }, () => (rand() < 0.05 ? 0 : 0.1 + Math.round(rand() * 250) / 10));
        const flags = Array.from({ length: S }, () => Array.from({ length: W }, () => (rand() < pAvail ? 1 : 0)));
        return row(`p${String(k).padStart(2, "0")}`, pos, cond, { flags });
      });
      const team = teamEval(rows, slots);
      const got = scenarioValues(team, W, S, null, false, trial % 2 === 0);
      const naive = prepareRoster(rows, slots);
      for (let w = 0; w < W; w++) {
        if (lineupOrder(team.prep, Float64Array.from(rows, (r) => r.cond[w] as number)).length > 30) deep++;
        let within = 0;
        const lvs = Array.from({ length: S }, (_, s) => {
          const seat = new Int32Array(n);
          const lv = lineupTotal(naive, Float64Array.from(rows, (r) => ((r.flags as Uint8Array)[s * W + w] === 1 ? (r.cond[w] as number) : 0)), null, seat);
          rows.forEach((r, k) => {
            if ((seat[k] as number) >= 0 && (r.flags as Uint8Array)[s * W + w] === 1) within += ((r.condSd[w] as number) ** 2) / S;
          });
          return lv;
        });
        const mean = lvs.reduce((x, y) => x + y, 0) / S;
        const sd = Math.sqrt(lvs.reduce((x, y) => x + (y - mean) ** 2, 0) / S);
        expect(got.mean[w], `trial ${trial} week ${w}`).toBeCloseTo(mean, 9);
        expect(got.sd[w], `trial ${trial} week ${w}`).toBeCloseTo(sd, 9);
        // The within-lineup variance only when asked for (it needs every lineup's seats).
        if (trial % 2 === 0) expect(got.within?.[w], `trial ${trial} week ${w}`).toBeCloseTo(within, 9);
        else expect(got.within).toBeNull();
      }
    }
    expect(deep).toBeGreaterThan(40); // the string key really ran
  });

  it("two scenarios that differ only in a player ranked past 30th get their own lineups (the memo key covers every player who can score)", () => {
    // 33 skill players scoring 52 down to 20, the only K (5 points: 34th) who plays in scenario 0 but not in scenario 1, and a D/ST.
    const skill: Pos[] = ["QB", "RB", "WR", "TE"];
    const rows = Array.from({ length: 33 }, (_, k) => row(`s${String(k).padStart(2, "0")}`, skill[k % 4] as Pos, [52 - k], { flags: [[1], [1]] }));
    rows.push(row("zk", "K", [5], { flags: [[1], [0]] }), row("zdef", "DEF", [4], { flags: [[1], [1]] }));
    const team = teamEval(rows, STANDARD);
    expect(lineupOrder(team.prep, Float64Array.from(rows, (r) => r.cond[0] as number))).toHaveLength(35);
    const got = scenarioValues(team, 1, 2);
    expect(got.solves).toBe(2);
    expect(got.sd[0]).toBeCloseTo(2.5, 12); // the two lineups differ by the kicker's 5 points
  });

  it("a row without scenario flags never plays in scenarios (only IR and taxi players lack them)", () => {
    const t = table([row("a", "QB", [20], { flags: [[1], [1]] }), row("b", "QB", [30])], [5], 2);
    expect(scenarioLineups(["a", "b"], t, STANDARD).lv).toEqual([20]);
  });
});

describe("the weekly score the season simulator draws (§8; TeamModel.score)", () => {
  const QB_ONLY = prepareSlots([slot("QB", 1, ["QB"])]);

  it("scenario lineups, by hand: one starter who plays in 3 of 4 scenarios has σ² = condSd² × P(plays) + the LV spread²", () => {
    // σ given he plays: 0.3 × 20 + 3 = 9 (§6 step 5, QB). LV is 20 or 0: mean 15, spread² 0.75 × 0.25 × 20².
    const qb = row("qb", "QB", [20], { flags: [[1], [1], [0], [1]] });
    expect(qb.condSd[0]).toBe(9);
    const v = scenarioValues(teamEval([qb], QB_ONLY), 1, 4, null, false, true);
    expect(v.mean[0]).toBe(15);
    expect(v.sd[0]).toBeCloseTo(Math.sqrt(0.75 * 0.25 * 400), 12);
    expect(v.within?.[0]).toBeCloseTo(0.75 * 81, 12);
    const score = scenarioScore(v);
    expect(score.mean[0]).toBe(15);
    expect(score.sd[0]).toBeCloseTo(Math.sqrt(0.75 * 81 + 0.75 * 0.25 * 400), 12);
    // Without `spread` there's no within part to give (and scenarioScore refuses).
    expect(() => scenarioScore(scenarioValues(teamEval([qb], QB_ONLY), 1, 4))).toThrow(/spread/);
  });

  it("scenario lineups: two independent starters add their variances; a bench player adds only when he starts", () => {
    // Two RB slots: A (20, plays in scenario 0 only), B (15, always), C (8, bench unless A is out: scenario 1).
    const a = row("a", "RB", [20], { flags: [[1], [0]] });
    const b = row("b", "RB", [15], { flags: [[1], [1]] });
    const c = row("c", "RB", [8], { flags: [[1], [1]] });
    const v = scenarioValues(teamEval([a, b, c], prepareSlots([slot("RB", 2, ["RB"])])), 1, 2, null, false, true);
    const sd = (x: number) => 0.45 * x + 2; // RB
    // Scenario 0: A and B start; scenario 1: B and C.
    expect(v.within?.[0]).toBeCloseTo((sd(20) ** 2 + sd(15) ** 2 + sd(15) ** 2 + sd(8) ** 2) / 2, 12);
    expect(v.mean[0]).toBe((35 + 23) / 2);
    expect(v.sd[0]).toBe(6);
  });

  it("EV lineups: the LV and sqrt(Σ σ²) over each week's starters (σ = c × p + d on expected points); the bench adds nothing", () => {
    // QB expected 20 × 0.5 = 10 (σ 0.3 × 10 + 3 = 6); RB 15 (σ 0.45 × 15 + 2 = 8.75); a 5-point bench RB with one RB slot.
    const rows = [row("qb", "QB", [20, 20], { a: [0.5, 1] }), row("rb", "RB", [15, 15]), row("rb2", "RB", [5, 5])];
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 1, ["RB"])]);
    const score = evScore(solveEvWeeks(teamEval(rows, slots), 2));
    expect([...score.mean]).toEqual([25, 35]);
    expect(score.sd[0]).toBeCloseTo(Math.sqrt(6 ** 2 + 8.75 ** 2), 12);
    expect(score.sd[1]).toBeCloseTo(Math.sqrt((0.3 * 20 + 3) ** 2 + 8.75 ** 2), 12);
  });

  it("a starter a minimum forces in without playing (a benched-out MFL TE) scores 0 and adds no spread", () => {
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("TE", 1, ["TE"])], { TE: { min: 1, max: 1 } });
    const te = row("te", "TE", [10], { flags: [[0], [0]] }); // out in both scenarios, still forced into the TE spot
    const qb = row("qb", "QB", [20], { flags: [[1], [1]] });
    const v = scenarioValues(teamEval([qb, te], slots), 1, 2, null, true, true);
    expect(v.cells?.seat[0]?.[0]?.[1]).toBeGreaterThanOrEqual(0); // the TE is seated…
    expect(v.within?.[0]).toBeCloseTo(9 ** 2, 12); // …but only the QB's spread counts
    expect(v.mean[0]).toBe(20);
  });

  it("rosterScore (scripts, Phase 4): scenario lineups when the table has scenarios, else EV; the first k weeks on request", () => {
    const rows = [row("qb", "QB", [20, 18], { a: [0.5, 1], flags: [[1, 1], [0, 1]] }), row("rb", "RB", [15, 15], { flags: [[1, 1], [1, 0]] })];
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 1, ["RB"])]);
    const withScenarios = table(rows, [5, 6], 2);
    const expected = scenarioScore(scenarioValues(teamEval(rows, slots), 2, 2, null, false, true));
    expect(rosterScore(["qb", "rb"], withScenarios, slots)).toEqual({ mean: [...expected.mean], sd: [...expected.sd] });
    expect(rosterScore(["qb", "rb"], withScenarios, slots, 1)).toEqual({ mean: [expected.mean[0]], sd: [expected.sd[0]] });
    const ev = evScore(solveEvWeeks(teamEval(rows, slots), 2));
    expect(rosterScore(["qb", "rb"], table(rows, [5, 6], 0), slots)).toEqual({ mean: [...ev.mean], sd: [...ev.sd] });
  });
});

describe("scenario flags have one stride, the row's own week count (solving fewer weeks or scenarios than the table holds)", () => {
  it("the first k weeks solved alone equal the first k weeks of the full solve, for every reader of the flags: 100 random rosters", () => {
    const rand = mulberry32(8484);
    for (let trial = 0; trial < 100; trial++) {
      const W = 2 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 8);
      const slots = trial % 2 === 0 ? STANDARD : SUPERFLEX;
      const lineup = trial % 2 === 0 ? TEST_LINEUP : SUPERFLEX_LINEUP;
      const index = instanceIndex(slotInstances(lineup), slots);
      const rows = Array.from({ length: 2 + Math.floor(rand() * 12) }, (_, k) => scenarioRow(rand, `r${k}`, W, S));
      const added = scenarioRow(rand, "new", W, S, 0.9);
      const mask = slotMask(slots, added.pos, added.eligible);
      const team = teamEval(rows, slots);
      const full = scenarioValues(team, W, S, index, true, true);
      for (let k = 1; k < W; k++) {
        const part = scenarioValues(team, k, S, index, true, true);
        for (let w = 0; w < k; w++) {
          expect(part.mean[w], `trial ${trial}, ${k} of ${W} weeks, week ${w}`).toBe(full.mean[w]);
          expect(part.sd[w], `trial ${trial}, ${k} of ${W} weeks, week ${w}`).toBe(full.sd[w]);
          expect(part.within?.[w], `trial ${trial}, ${k} of ${W} weeks, week ${w}`).toBe(full.within?.[w]);
          expect(part.instances?.[w], `trial ${trial}, ${k} of ${W} weeks, week ${w}`).toEqual(full.instances?.[w]);
        }
        // Adding and removing players on the k-week cells: the full cells with the later weeks weighted 0.
        const weights = Float64Array.from({ length: W }, (_, w) => (w < k ? 1 + (w % 2) * 0.25 : 0));
        const partCells = part.cells as ScenarioCells;
        const fullCells = full.cells as ScenarioCells;
        expect(scenarioAddGain(partCells, added, mask, weights), `trial ${trial}`).toBeCloseTo(scenarioAddGain(fullCells, added, mask, weights), 12);
        expect(scenarioAddUpperBound(partCells, added, mask, weights), `trial ${trial}`).toBeCloseTo(scenarioAddUpperBound(fullCells, added, mask, weights), 12);
        expect([...scenarioRemovalCosts(partCells, weights)].map((x) => x.toFixed(9)), `trial ${trial}`).toEqual([...scenarioRemovalCosts(fullCells, weights)].map((x) => x.toFixed(9)));
      }
    }
  });

  it("the first S′ scenarios of a table with more read the same flags as a table built with S′ (the stride isn't flags.length / S′)", () => {
    const rand = mulberry32(5151);
    for (let trial = 0; trial < 50; trial++) {
      const W = 1 + Math.floor(rand() * 4);
      const S = 4 + Math.floor(rand() * 6);
      const Sp = 1 + Math.floor(rand() * (S - 1));
      const rows = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, k) => scenarioRow(rand, `r${k}`, W, S));
      const fewer = rows.map((r) => ({ ...r, flags: (r.flags as Uint8Array).slice(0, Sp * W) }));
      const got = scenarioValues(teamEval(rows, STANDARD), W, Sp, null, true, true);
      const want = scenarioValues(teamEval(fewer, STANDARD), W, Sp, null, true, true);
      expect([...got.mean], `trial ${trial}`).toEqual([...want.mean]);
      expect([...got.sd], `trial ${trial}`).toEqual([...want.sd]);
      expect([...(got.within as Float64Array)], `trial ${trial}`).toEqual([...(want.within as Float64Array)]);
      // A newcomer with the table's S scenarios, added to S′-scenario cells, reads his first S′.
      const added = scenarioRow(rand, "new", W, S, 0.9);
      const addedFewer = { ...added, flags: (added.flags as Uint8Array).slice(0, Sp * W) };
      const mask = slotMask(STANDARD, added.pos, added.eligible);
      const weights = Float64Array.from({ length: W }, () => 1);
      expect(scenarioAddGain(got.cells as ScenarioCells, added, mask, weights), `trial ${trial}`).toBe(scenarioAddGain(want.cells as ScenarioCells, addedFewer, mask, weights));
      expect(scenarioAddUpperBound(got.cells as ScenarioCells, added, mask, weights), `trial ${trial}`).toBe(scenarioAddUpperBound(want.cells as ScenarioCells, addedFewer, mask, weights));
    }
  });
});

// ---------------------------------------------------------------------------------------------

/** A random roster and candidate pool for the add-a-player tests. */
function randomPool(rand: () => number, W: number, n: number, m: number): { roster: TableRow[]; pool: TableRow[] } {
  const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"];
  const mk = (id: string, scale: number): TableRow => {
    const pos = positions[Math.floor(rand() * positions.length)] as Pos;
    const cond = Array.from({ length: W }, () => (rand() < 0.1 ? 0 : Math.round(rand() * 250 * scale) / 10));
    const a = Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 100) / 100));
    return row(id, pos, cond, { a, eligible: pos === "WR" && rand() < 0.25 ? ["WR", "RB"] : [pos] });
  };
  return { roster: Array.from({ length: n }, (_, k) => mk(`r${k}`, 1)), pool: Array.from({ length: m }, (_, k) => mk(`f${k}`, 0.8)) };
}

describe("pricing an added player (§7 MV_add; the bound that makes it fast)", () => {
  it("the bound is never below the exact gain, week by week: 400 random rosters, two lineups", () => {
    const rand = mulberry32(7);
    for (let trial = 0; trial < 400; trial++) {
      const W = 3;
      const slots = trial % 2 === 0 ? STANDARD : SUPERFLEX;
      const { roster, pool } = randomPool(rand, W, 2 + Math.floor(rand() * 16), 6);
      const base = solveEvWeeks(teamEval(roster, slots), W);
      for (const cand of pool) {
        const mask = slotMask(slots, cand.pos, cand.eligible);
        for (let w = 0; w < W; w++) {
          const oneHot = Float64Array.from({ length: W }, (_, i) => (i === w ? 1 : 0));
          const exact = lv([...roster, cand], slots, (r) => r.ev[w] as number) - lv(roster, slots, (r) => r.ev[w] as number);
          expect(addUpperBound(base, cand, mask, oneHot), `trial ${trial} ${cand.id} week ${w}`).toBeGreaterThanOrEqual(exact - 1e-9);
          expect(addGainExact(base, cand, mask, oneHot).gain, `trial ${trial} ${cand.id} week ${w}`).toBeCloseTo(exact, 9);
        }
      }
    }
  });

  it("slotMask matches the roster masks prepareRoster computes", () => {
    const players = [
      { id: "a", pos: "WR" as Pos, eligible: ["WR", "RB"] as Pos[] },
      { id: "b", pos: "QB" as Pos, eligible: ["QB"] as Pos[] },
      { id: "c", pos: "P" as Pos, eligible: ["P"] as Pos[] },
    ];
    const prep = prepareRoster(players, SUPERFLEX);
    players.forEach((p, k) => expect(slotMask(SUPERFLEX, p.pos, p.eligible)).toBe(prep.masks[k]));
  });

  it("mvAddPpw is the average weekly EV LV gain over the window, without a drop; 0 for a player already on the roster", () => {
    const rows = [row("qb", "QB", [20, 20, 20, 20]), row("rb1", "RB", [15, 15, 15, 15]), row("rb2", "RB", [8, 8, 0, 8])];
    const newRb = row("rb3", "RB", [10, 10, 10, 30]);
    const t = table([...rows, newRb], [5, 6, 7, 8]);
    const ids = rows.map((r) => r.id);
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"])]);
    // Weeks 5–7: RB3 replaces rb2 (+2, +2) and fills rb2's empty spot in week 7 (+10); week 8 (outside the window) +22.
    expect(mvAddPpw(ids, "rb3", t, slots, { from: 0, to: 3 })).toBeCloseTo(14 / 3, 12);
    expect(mvAddPpw(ids, "rb3", t, slots)).toBeCloseTo((2 + 2 + 10 + 22) / 4, 12);
    // With a FLEX spot open he adds all his points.
    expect(mvAddPpw(ids, "rb3", t, STANDARD, { from: 0, to: 1 })).toBeCloseTo(10, 12);
    expect(mvAddPpw(ids, "rb1", t, slots)).toBe(0);
    expect(mvAddPpw(ids, "nobody", t, slots)).toBe(0);
  });

  it("adding several players at once equals brute force, and is at most the sum of their own gains (players competing for a slot count once): 300 random rosters", () => {
    const rand = mulberry32(31);
    let lessThanSum = 0;
    for (let trial = 0; trial < 300; trial++) {
      const W = 3;
      const weights = Float64Array.from([1, 0, 1.25]); // a week that weighs 0 is skipped
      const slots = trial % 2 === 0 ? STANDARD : SUPERFLEX;
      const { roster, pool } = randomPool(rand, W, 2 + Math.floor(rand() * 14), 4);
      const added = pool.slice(0, 1 + Math.floor(rand() * 4));
      const masks = added.map((r) => slotMask(slots, r.pos, r.eligible));
      const base = solveEvWeeks(teamEval(roster, slots), W);
      let exact = 0;
      for (let w = 0; w < W; w++) exact += (weights[w] as number) * (lv([...roster, ...added], slots, (r) => r.ev[w] as number) - lv(roster, slots, (r) => r.ev[w] as number));
      const got = addRowsGain(base, added, masks, weights);
      expect(got, `trial ${trial}`).toBeCloseTo(exact, 9);
      const sum = added.reduce((s, r, j) => s + addGainExact(base, r, masks[j] as number, weights).gain, 0);
      expect(got, `trial ${trial}`).toBeLessThanOrEqual(sum + 1e-9);
      expect(got, `trial ${trial}`).toBeGreaterThanOrEqual(-1e-9);
      if (got < sum - 1e-9) lessThanSum++;
      if (added.length === 1) expect(got).toBeCloseTo(addGainExact(base, added[0] as TableRow, masks[0] as number, weights).gain, 12);
    }
    expect(lessThanSum).toBeGreaterThan(20); // the case the joint gain exists for does occur
    expect(addRowsGain(solveEvWeeks(teamEval([], STANDARD), 1), [], [], [1])).toBe(0);
    expect(() => addRowsGain(solveEvWeeks(teamEval([], STANDARD), 1), [row("a", "QB", [5])], [], [1])).toThrow(/1 rows but 0 masks/);
  });

  it("adding several players stays exact under starter minimums (MFL), where it can even lower LV: 150 random cases", () => {
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("FLEX", 6, ["RB", "WR", "TE"]), slot("K", 1, ["K"])], { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } });
    const rand = mulberry32(77);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K"];
    const mk = (id: string, W: number): TableRow => row(id, positions[Math.floor(rand() * positions.length)] as Pos, Array.from({ length: W }, () => (rand() < 0.25 ? 0 : Math.round(rand() * 200) / 10)));
    for (let trial = 0; trial < 150; trial++) {
      const W = 3;
      const weights = Float64Array.from([1, 1, 1]);
      const roster = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, k) => mk(`r${k}`, W));
      const added = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => mk(`f${k}`, W));
      const base = solveEvWeeks(teamEval(roster, slots), W);
      let exact = 0;
      for (let w = 0; w < W; w++) exact += lv([...roster, ...added], slots, (r) => r.ev[w] as number) - lv(roster, slots, (r) => r.ev[w] as number);
      expect(
        addRowsGain(
          base,
          added,
          added.map((r) => slotMask(slots, r.pos, r.eligible)),
          weights,
        ),
        `trial ${trial}`,
      ).toBeCloseTo(exact, 9);
    }
  });

  it("mvAddGroupPpw: the average weekly gain of adding several players together, over a window; ids on the roster or without a row are skipped", () => {
    const slots = prepareSlots([slot("RB", 2, ["RB"])]);
    const t = table([row("rb1", "RB", [15, 15]), row("rb2", "RB", [8, 8]), row("a", "RB", [11, 11]), row("b", "RB", [10, 20])], [5, 6]);
    // Week 5: a (11) and b (10) compete for rb2's spot: +3, not 3 + 2. Week 6: b (20) starts next to rb1 (35 against 23); a doesn't.
    expect(mvAddGroupPpw(["rb1", "rb2"], ["a", "b"], t, slots, { from: 0, to: 1 })).toBeCloseTo(3, 12);
    expect(mvAddGroupPpw(["rb1", "rb2"], ["a", "b"], t, slots)).toBeCloseTo((3 + (20 + 15 - 23)) / 2, 12);
    expect(mvAddGroupPpw(["rb1", "rb2"], ["a", "rb1", "ghost", "a"], t, slots, { from: 0, to: 1 })).toBeCloseTo(mvAddPpw(["rb1", "rb2"], "a", t, slots, { from: 0, to: 1 }), 12);
    expect(mvAddGroupPpw(["rb1", "rb2"], [], t, slots)).toBe(0);
  });
});

describe("the free agent a team adds (§7 roster legality: the best available free agent)", () => {
  it("equals brute force over every candidate (largest EV ROS gain, ties to the smaller id): 300 random cases", () => {
    const rand = mulberry32(11);
    for (let trial = 0; trial < 300; trial++) {
      const W = 4;
      const weights = Float64Array.from([1, 1, 1.25, 1.25]);
      const slots = trial % 3 === 0 ? SUPERFLEX : STANDARD;
      const { roster, pool } = randomPool(rand, W, 3 + Math.floor(rand() * 14), 25);
      if (trial % 5 === 0) pool.push(row("tie-b", "K", [5, 5, 5, 5]), row("tie-a", "K", [5, 5, 5, 5]));
      const base = solveEvWeeks(teamEval(roster, slots), W);
      const got = pickFreeAgent(
        base,
        pool.map((r) => ({ row: r, mask: slotMask(slots, r.pos, r.eligible) })),
        weights,
      );
      let best: { id: string; gain: number } | null = null;
      for (const cand of pool) {
        let gain = 0;
        for (let w = 0; w < W; w++) gain += (weights[w] as number) * (lv([...roster, cand], slots, (r) => r.ev[w] as number) - lv(roster, slots, (r) => r.ev[w] as number));
        if (!(gain > 1e-9)) continue;
        if (!best || gain > best.gain + 1e-9 || (Math.abs(gain - best.gain) <= 1e-9 && cand.id < best.id)) best = { id: cand.id, gain };
      }
      expect(got?.row.id ?? null, `trial ${trial}`).toBe(best?.id ?? null);
      if (best && got) expect(got.gain).toBeCloseTo(best.gain, 9);
    }
  });

  it("stays exact under starter minimums (MFL), where adding a player can even lower LV: 200 random cases", () => {
    const lineup = [slot("QB", 1, ["QB"]), slot("FLEX", 6, ["RB", "WR", "TE"]), slot("K", 1, ["K"])];
    const slots = prepareSlots(lineup, { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } });
    const rand = mulberry32(99);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K"];
    let negative = 0;
    for (let trial = 0; trial < 200; trial++) {
      const W = 3;
      const weights = Float64Array.from([1, 1, 1]);
      const mk = (id: string): TableRow => {
        const pos = positions[Math.floor(rand() * positions.length)] as Pos;
        const cond = Array.from({ length: W }, () => (rand() < 0.25 ? 0 : Math.round(rand() * 200) / 10)); // byes and zero weeks force 0-point starters
        return row(id, pos, cond);
      };
      const roster = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, k) => mk(`r${k}`));
      const pool = Array.from({ length: 12 }, (_, k) => mk(`f${k}`));
      const base = solveEvWeeks(teamEval(roster, slots), W);
      const cands = pool.map((r) => ({ row: r, mask: slotMask(slots, r.pos, r.eligible) }));
      let best: { id: string; gain: number } | null = null;
      for (const cand of pool) {
        let gain = 0;
        for (let w = 0; w < W; w++) {
          const g = lv([...roster, cand], slots, (r) => r.ev[w] as number) - lv(roster, slots, (r) => r.ev[w] as number);
          if (g < -1e-9) negative++;
          gain += g;
        }
        expect(addGainExact(base, cand, slotMask(slots, cand.pos, cand.eligible), weights).gain, `trial ${trial} ${cand.id}`).toBeCloseTo(gain, 9);
        if (!(gain > 1e-9)) continue;
        if (!best || gain > best.gain + 1e-9 || (Math.abs(gain - best.gain) <= 1e-9 && cand.id < best.id)) best = { id: cand.id, gain };
      }
      const got = pickFreeAgent(base, cands, weights);
      expect(got?.row.id ?? null, `trial ${trial}`).toBe(best?.id ?? null);
    }
    expect(negative).toBeGreaterThan(0); // the case the bound can't handle does occur
  });

  it("respects position limits on the active roster, and returns null when no free agent helps", () => {
    const weights = weekWeights([5], [5], []);
    const rows = [row("qb", "QB", [20]), row("rb1", "RB", [15]), row("rb2", "RB", [12])];
    const t = table([...rows, row("fa-rb", "RB", [30]), row("fa-wr", "WR", [9]), row("fa-k", "K", [0])], [5]);
    const ids = rows.map((r) => r.id);
    expect(bestFreeAgent(ids, ["fa-rb", "fa-wr"], t, STANDARD, { weights })).toEqual({ id: "fa-rb", gain: 30 }); // the FLEX spot was empty
    // RB limit 2 is full: the RB can't be added, the WR can.
    expect(bestFreeAgent(ids, ["fa-rb", "fa-wr"], t, STANDARD, { weights, positionLimits: { RB: 2 } })).toEqual({ id: "fa-wr", gain: 9 });
    expect(bestFreeAgent(ids, ["fa-k"], t, STANDARD, { weights })).toBeNull();
    expect(positionAllows({ RB: 2 }, ["RB", "RB", "QB"], "RB")).toBe(false);
    expect(positionAllows({ RB: 2 }, ["RB", "QB"], "RB")).toBe(true);
    expect(positionAllows(undefined, ["RB", "RB"], "RB")).toBe(true);
  });
});

describe("MV_lose (§7 marginal values; addition C: depth counts in scenario lineups)", () => {
  // Weeks 5–6; RB slots only; two scenarios in which star A misses week 5 in the second.
  const a = row("rbA", "RB", [20, 20], { a: [0.5, 1], flags: [[1, 1], [0, 1]] });
  const b = row("rbB", "RB", [18, 18], { flags: [[1, 1], [1, 1]] });
  const c = row("rbC", "RB", [9, 9], { a: [0.5, 1], flags: [[1, 1], [0, 1]] });
  const fa = row("faRB", "RB", [6, 6], { flags: [[1, 1], [1, 1]] });
  const slots = prepareSlots([slot("RB", 2, ["RB"])]);
  const t = table([a, b, c, fa], [5, 6], 2);
  const weights = weekWeights([5, 6], [5, 6], []);

  it("ROS(T) − ROS(T − i + fa) with the same free agent in both modes", () => {
    const got = mvLose(["rbA", "rbB", "rbC"], "rbB", ["faRB"], t, slots, { weights });
    // EV: T = (18 + 10) + (20 + 18) = 66. T − B = (10 + 4.5) + (20 + 9); the free agent (6) beats C's 4.5 in week 5,
    // so T − B + fa = (10 + 6) + (20 + 9) = 45.
    expect(got.autoAdd).toBe("faRB");
    expect(got.ev).toBeCloseTo(66 - 45, 9);
    // Scenarios: T = mean(20 + 18, 18 + 0) + 38 = 66; T − B + fa = mean(20 + 9, 0 + 6) + 29 = 46.5.
    expect(got.scen).toBeCloseTo(66 - 46.5, 9);
  });

  it("a deep bench player costs nothing in EV lineups but something in scenario lineups", () => {
    const deep = row("rbD", "RB", [8, 8], { flags: [[1, 1], [1, 1]] });
    const t2 = table([a, b, deep], [5, 6], 2);
    const got = mvLose(["rbA", "rbB", "rbD"], "rbD", [], t2, slots, { weights });
    // EV week 5: A 10, B 18, D 8 → D never starts: MV_lose 0. Scenario 2 (A out): D starts for 8 → half of 8 over two scenarios.
    expect(got.ev).toBe(0);
    expect(got.scen).toBeCloseTo(4, 9);
    expect(got.autoAdd).toBeNull();
  });

  it("scen is null without scenarios, and position limits pass through (the lost player frees his spot)", () => {
    const tNo = table([a, b, c, fa], [5, 6], 0);
    const got = mvLose(["rbA", "rbB", "rbC"], "rbB", ["faRB"], tNo, slots, { weights, positionLimits: { RB: 3 }, rosterPositions: ["RB", "RB", "RB"] });
    expect(got.scen).toBeNull();
    expect(got.autoAdd).toBe("faRB");
    expect(tableRows(["rbA", "ghost", "rbA"], tNo).map((r) => r.id)).toEqual(["rbA"]);
  });

  it("goes negative, as §7 writes it, when a free agent beats one of T's starters (the League model shifts it: waiverAdjustment)", () => {
    // RB slots only: A 20, B 18, and a 5-point bench RB; a free-agent RB of 19 beats B.
    const rows = [row("rbA", "RB", [20, 20]), row("rbB", "RB", [18, 18]), row("rbC", "RB", [5, 5]), row("faRB", "RB", [19, 19])];
    const t = table(rows, [5, 6]);
    const raw = mvLose(["rbA", "rbB", "rbC"], "rbC", ["faRB"], t, slots, { weights });
    expect(raw).toMatchObject({ ev: -2, autoAdd: "faRB" }); // T − C + fa = 20 + 19 twice, against T's 20 + 18
  });
});

const SCENARIO_POSITIONS: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"];
/** A random row with S scenarios of flags (mostly available, so patterns repeat), and zero or bye weeks now and then. */
function scenarioRow(rand: () => number, id: string, W: number, S: number, scale = 1, positions: readonly Pos[] = SCENARIO_POSITIONS, zero = 0.1): TableRow {
  const pos = positions[Math.floor(rand() * positions.length)] as Pos;
  const cond = Array.from({ length: W }, () => (rand() < zero ? 0 : Math.round(rand() * 250 * scale) / 10));
  const flags = Array.from({ length: S }, () => Array.from({ length: W }, () => (rand() < 0.8 ? 1 : 0)));
  return row(id, pos, cond, { flags, eligible: pos === "WR" && rand() < 0.25 ? ["WR", "RB"] : [pos] });
}

describe("adding a player in scenario lineups (trade chips, §7: ScenarioCells, scenarioAddUpperBound, scenarioAddGain)", () => {
  /** Σ_w weights_w · (mean LV of base + added − mean LV of base): the brute-force scenario gain. */
  function bruteGain(base: TableRow[], added: TableRow, slots: PreparedSlots, W: number, S: number, weights: ArrayLike<number>): number {
    const before = scenarioValues(teamEval(base, slots), W, S).mean;
    const after = scenarioValues(teamEval([...base, added], slots), W, S).mean;
    let gain = 0;
    for (let w = 0; w < W; w++) gain += (weights[w] as number) * ((after[w] as number) - (before[w] as number));
    return gain;
  }

  it("keeps each week's patterns: every scenario's LV is its pattern's, and the mean is scenarioValues' own", () => {
    const rand = mulberry32(515);
    for (let trial = 0; trial < 60; trial++) {
      const W = 1 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 10);
      const slots = trial % 2 === 0 ? STANDARD : SUPERFLEX;
      const rows = Array.from({ length: 2 + Math.floor(rand() * 12) }, (_, k) => scenarioRow(rand, `p${k}`, W, S));
      const team = teamEval(rows, slots);
      const kept = scenarioValues(team, W, S, null, true);
      const cells = kept.cells as ScenarioCells;
      expect([...kept.mean]).toEqual([...scenarioValues(team, W, S).mean]);
      expect(scenarioValues(team, W, S).cells).toBeNull();
      const naive = prepareRoster(rows, slots);
      for (let w = 0; w < W; w++) {
        const pattern = cells.pattern[w] as Int32Array;
        expect(pattern).toHaveLength(S);
        for (let s = 0; s < S; s++) {
          const pts = Float64Array.from(rows, (r) => ((r.flags as Uint8Array)[s * W + w] === 1 ? (r.cond[w] as number) : 0));
          const p = pattern[s] as number;
          expect(cells.lv[w]?.[p], `trial ${trial} week ${w} scenario ${s}`).toBeCloseTo(lineupTotal(naive, pts), 9);
          // Who plays in the pattern: exactly the players who can score (points and a slot) and play in this scenario.
          rows.forEach((r, k) => expect(cells.avail[w]?.[p]?.[k], `trial ${trial} week ${w} scenario ${s} player ${k}`).toBe((pts[k] as number) > 0 && slotMask(slots, r.pos, r.eligible) !== 0 ? 1 : 0));
        }
      }
    }
  });

  it("the exact gain is the difference of the two rosters' scenario means (brute force); the bound is never below it, and a 0 bound means exactly 0: 300 random cases", () => {
    const rand = mulberry32(4242);
    let bounded = 0;
    let positive = 0;
    for (let trial = 0; trial < 300; trial++) {
      const W = 1 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 12);
      const slots = trial % 2 === 0 ? STANDARD : SUPERFLEX;
      const base = Array.from({ length: 2 + Math.floor(rand() * 14) }, (_, k) => scenarioRow(rand, `r${k}`, W, S));
      const added = scenarioRow(rand, "new", W, S, 0.9);
      const weights = Float64Array.from({ length: W }, () => (rand() < 0.2 ? 0 : rand() < 0.5 ? 1 : 1.25));
      const cells = scenarioValues(teamEval(base, slots), W, S, null, true).cells as ScenarioCells;
      const mask = slotMask(slots, added.pos, added.eligible);
      const exact = scenarioAddGain(cells, added, mask, weights);
      expect(exact, `trial ${trial}`).toBeCloseTo(bruteGain(base, added, slots, W, S, weights), 9);
      const ub = scenarioAddUpperBound(cells, added, mask, weights);
      expect(ub, `trial ${trial}`).toBeGreaterThanOrEqual(exact - 1e-9);
      // Tight, in fact (the file header): every starter in a group he can reach is one he can push out.
      expect(ub, `trial ${trial}`).toBeCloseTo(exact, 9);
      if (ub === 0) {
        expect(exact, `trial ${trial}`).toBe(0);
        bounded++;
      }
      if (exact > 1e-9) positive++;
      // The cells are cached per slot mask: asking again gives the same bound.
      expect(scenarioAddUpperBound(cells, added, mask, weights)).toBe(ub);
    }
    expect(bounded).toBeGreaterThan(20); // the case that skips every solve does occur
    expect(positive).toBeGreaterThan(50);
  });

  it("stays exact under starter minimums (MFL), where nothing is bounded (+Infinity) and a newcomer can even lower LV: 150 random cases", () => {
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("FLEX", 6, ["RB", "WR", "TE"]), slot("K", 1, ["K"])], { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } });
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K"];
    const rand = mulberry32(8080);
    let negative = 0;
    for (let trial = 0; trial < 150; trial++) {
      const W = 1 + Math.floor(rand() * 3);
      const S = 1 + Math.floor(rand() * 8);
      // Byes and zero weeks force 0-point starters into the minimums.
      const base = Array.from({ length: 4 + Math.floor(rand() * 9) }, (_, k) => scenarioRow(rand, `r${k}`, W, S, 1, positions, 0.3));
      const added = scenarioRow(rand, "new", W, S, 1, positions, 0.3);
      const weights = Float64Array.from({ length: W }, () => 1);
      const cells = scenarioValues(teamEval(base, slots), W, S, null, true).cells as ScenarioCells;
      const mask = slotMask(slots, added.pos, added.eligible);
      const exact = scenarioAddGain(cells, added, mask, weights);
      expect(exact, `trial ${trial}`).toBeCloseTo(bruteGain(base, added, slots, W, S, weights), 9);
      expect(scenarioAddUpperBound(cells, added, mask, weights)).toBe(Number.POSITIVE_INFINITY);
      if (exact < -1e-9) negative++;
    }
    expect(negative).toBeGreaterThan(0);
  });

  it("a newcomer who never plays in scenarios (no flags) or fits no slot adds nothing; without scenarios nothing is added", () => {
    const base = [row("qb", "QB", [20], { flags: [[1], [1]] })];
    const cells = scenarioValues(teamEval(base, STANDARD), 1, 2, null, true).cells as ScenarioCells;
    const noFlags = row("rb", "RB", [15]);
    expect(scenarioAddGain(cells, noFlags, slotMask(STANDARD, "RB", ["RB"]), [1])).toBe(0);
    expect(scenarioAddUpperBound(cells, noFlags, slotMask(STANDARD, "RB", ["RB"]), [1])).toBe(0);
    const punter = row("p", "P", [9], { flags: [[1], [1]] });
    expect(slotMask(STANDARD, "P", ["P"])).toBe(0);
    expect(scenarioAddGain(cells, punter, 0, [1])).toBe(0);
    // An RB into the empty RB slots: his whole 15 in the scenario he plays.
    const rb = row("rb", "RB", [15], { flags: [[1], [0]] });
    expect(scenarioAddGain(cells, rb, slotMask(STANDARD, "RB", ["RB"]), [1])).toBeCloseTo(7.5, 12);
    expect(scenarioAddUpperBound(cells, rb, slotMask(STANDARD, "RB", ["RB"]), [1])).toBeCloseTo(7.5, 12);
    const none = scenarioValues(teamEval(base, STANDARD), 1, 0, null, true).cells as ScenarioCells;
    expect(scenarioAddGain(none, rb, slotMask(STANDARD, "RB", ["RB"]), [1])).toBe(0);
    expect(scenarioAddUpperBound(none, rb, slotMask(STANDARD, "RB", ["RB"]), [1])).toBe(0);
  });
});

describe("removing a player (§7 roster legality: keep value = marginal ROS contribution, which picks the player a full roster drops)", () => {
  // One week, standard lineup: two equal QBs, a FLEX WR, a 9-point bench RB (who plays in the scenarios `rb3` says), no backup TE, K or D/ST.
  const BOTH = [[1], [1]];
  const handRows = (rb3: number[][] = BOTH): TableRow[] => [
    row("qb", "QB", [20], { flags: BOTH }),
    row("qb2", "QB", [20], { flags: BOTH }),
    row("rb1", "RB", [15], { flags: BOTH }),
    row("rb2", "RB", [13], { flags: BOTH }),
    row("wr1", "WR", [15], { flags: BOTH }),
    row("wr2", "WR", [13], { flags: BOTH }),
    row("flex", "WR", [11], { flags: BOTH }),
    row("te", "TE", [10], { flags: BOTH }),
    row("k", "K", [8], { flags: BOTH }),
    row("def", "DEF", [7], { flags: BOTH }),
    row("rb3", "RB", [9], { flags: rb3 }),
  ];
  const byId = (team: { rows: readonly TableRow[] }, costs: Float64Array) => Object.fromEntries(team.rows.map((r, k) => [r.id, costs[k]]));

  it("a starter nobody can replace costs all his points, one with an equal backup nothing, a bench player nothing; the bench RB covers a WR through the FLEX", () => {
    const team = teamEval(handRows(), STANDARD);
    const expected = {
      qb: 0, // the other 20-point QB steps in
      qb2: 0, // bench
      rb1: 15 - 9, // the bench RB
      rb2: 13 - 9,
      wr1: 15 - 9, // the FLEX WR moves over and the bench RB takes the FLEX
      wr2: 13 - 9,
      flex: 11 - 9,
      te: 10, // nobody else fits: his whole points
      k: 8,
      def: 7,
      rb3: 0,
    };
    expect(byId(team, evRemovalCosts(solveEvWeeks(team, 1), [1]))).toEqual(expected);
    // Scenario lineups: the same when everyone plays in every scenario, and weights scale it.
    const cells = scenarioValues(team, 1, 2, null, true).cells as ScenarioCells;
    expect(byId(team, scenarioRemovalCosts(cells, [1]))).toEqual(expected);
    expect(byId(team, scenarioRemovalCosts(cells, [1.25]))).toEqual(Object.fromEntries(Object.entries(expected).map(([id, c]) => [id, c * 1.25])));
    // The bench RB plays in one scenario of two: in the other nobody covers an RB, a WR or the FLEX.
    const half = teamEval(handRows([[1], [0]]), STANDARD);
    const halfCells = scenarioValues(half, 1, 2, null, true).cells as ScenarioCells;
    expect(byId(half, scenarioRemovalCosts(halfCells, [1]))).toEqual({ ...expected, rb1: (6 + 15) / 2, rb2: (4 + 13) / 2, wr1: (6 + 15) / 2, wr2: (4 + 13) / 2, flex: (2 + 11) / 2 });
  });

  it("equals brute force (the roster without him solved on its own), EV and scenario lineups: 300 random rosters, three lineups", () => {
    const rand = mulberry32(9191);
    const lineups = [STANDARD, SUPERFLEX, prepareSlots(IDP_LINEUP)];
    const idpPositions: Pos[] = [...SCENARIO_POSITIONS, "DL", "LB", "DB"];
    let expensive = 0;
    for (let trial = 0; trial < 300; trial++) {
      const W = 1 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 10);
      const slots = lineups[trial % 3] as PreparedSlots;
      const weights = Float64Array.from({ length: W }, () => (rand() < 0.2 ? 0 : rand() < 0.5 ? 1 : 1.25));
      // EV: rows with random availability (so EV points ≠ conditional points), byes and zero weeks.
      const { roster } = randomPool(rand, W, 1 + Math.floor(rand() * 16), 0);
      const ev = evRemovalCosts(solveEvWeeks(teamEval(roster, slots), W), weights);
      roster.forEach((r, k) => {
        const minus = roster.filter((_, i) => i !== k);
        let exact = 0;
        for (let w = 0; w < W; w++) exact += (weights[w] as number) * (lv(roster, slots, (x) => x.ev[w] as number) - lv(minus, slots, (x) => x.ev[w] as number));
        expect(ev[k], `trial ${trial} EV ${r.id}`).toBeCloseTo(exact, 9);
      });
      // Scenario lineups.
      const rows = Array.from({ length: 1 + Math.floor(rand() * 16) }, (_, k) => scenarioRow(rand, `r${k}`, W, S, 1, trial % 3 === 2 ? idpPositions : SCENARIO_POSITIONS));
      const team = teamEval(rows, slots);
      const kept = scenarioValues(team, W, S, null, true);
      const scen = scenarioRemovalCosts(kept.cells as ScenarioCells, weights);
      const before = rosValue(kept.mean, weights);
      rows.forEach((r, k) => {
        const exact = before - rosValue(scenarioValues(teamEval(rows.filter((_, i) => i !== k), slots), W, S).mean, weights);
        expect(scen[k], `trial ${trial} scenarios ${r.id}`).toBeCloseTo(exact, 9);
        expect(scen[k] as number, `trial ${trial} scenarios ${r.id}`).toBeGreaterThanOrEqual(-1e-9);
        if (exact > 1) expensive++;
      });
    }
    expect(expensive).toBeGreaterThan(300); // starters who cost something do occur
  });

  it("stays exact under starter minimums (MFL), where each roster without him is solved again (his loss can even raise LV there): 100 random cases", () => {
    const slots = prepareSlots([slot("QB", 1, ["QB"]), slot("FLEX", 6, ["RB", "WR", "TE"]), slot("K", 1, ["K"])], { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } });
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K"];
    const rand = mulberry32(6262);
    let raises = 0;
    for (let trial = 0; trial < 100; trial++) {
      const W = 1 + Math.floor(rand() * 3);
      const S = 1 + Math.floor(rand() * 6);
      const weights = Float64Array.from({ length: W }, () => 1);
      // Byes and zero weeks force 0-point starters into the minimums.
      const rows = Array.from({ length: 3 + Math.floor(rand() * 10) }, (_, k) => scenarioRow(rand, `r${k}`, W, S, 1, positions, 0.3));
      const team = teamEval(rows, slots);
      const ev = evRemovalCosts(solveEvWeeks(team, W), weights);
      const kept = scenarioValues(team, W, S, null, true);
      const scen = scenarioRemovalCosts(kept.cells as ScenarioCells, weights);
      rows.forEach((r, k) => {
        const minus = rows.filter((_, i) => i !== k);
        let exactEv = 0;
        for (let w = 0; w < W; w++) exactEv += lv(rows, slots, (x) => x.ev[w] as number) - lv(minus, slots, (x) => x.ev[w] as number);
        expect(ev[k], `trial ${trial} EV ${r.id}`).toBeCloseTo(exactEv, 9);
        const exactScen = rosValue(kept.mean, weights) - rosValue(scenarioValues(teamEval(minus, slots), W, S).mean, weights);
        expect(scen[k], `trial ${trial} scenarios ${r.id}`).toBeCloseTo(exactScen, 9);
        if (exactEv < -1e-9 || exactScen < -1e-9) raises++;
      });
    }
    expect(raises).toBeGreaterThan(0); // a forced 0-point starter whose loss frees his slot for a better player
  });

  it("nothing to lose without scenarios, players or weight", () => {
    const team = teamEval(handRows(), STANDARD);
    expect([...scenarioRemovalCosts(scenarioValues(team, 1, 0, null, true).cells as ScenarioCells, [1])]).toEqual(new Array(11).fill(0));
    expect([...evRemovalCosts(solveEvWeeks(team, 1), [0])]).toEqual(new Array(11).fill(0));
    expect([...evRemovalCosts(solveEvWeeks(teamEval([], STANDARD), 2), [1, 1])]).toEqual([]);
  });
});

describe("lowestKeepValue (§7 roster legality: the player a full roster drops)", () => {
  it("drops the lowest keep value; ties within 1e-9 go to the lower market value, then the smaller id; null without candidates", () => {
    expect(lowestKeepValue([])).toBeNull();
    expect(
      lowestKeepValue([
        { id: "a", keep: 5, value: 100 },
        { id: "b", keep: 0.4, value: 900 },
        { id: "c", keep: 3, value: 10 },
      ]),
    ).toBe("b");
    // Equal keep values (float noise included): the less valuable player goes, whatever the ids say.
    expect(
      lowestKeepValue([
        { id: "a-pricey", keep: 0, value: 900 },
        { id: "z-cheap", keep: 1e-12, value: 100 },
      ]),
    ).toBe("z-cheap");
    expect(
      lowestKeepValue([
        { id: "y", keep: 0, value: 100 },
        { id: "x", keep: 0, value: 100 },
      ]),
    ).toBe("x");
  });
});

describe("waiverAdjustment (§7 lineup costs from the team after its best free-agent move)", () => {
  const move = (add: string | null, drop: string | null, ev: number, scen: number | null = null): RosterMove => ({ add, drop, ev, scen });

  it("V = the best of T and every roster one move away, so every lineup cost V − ROS(after) is ≥ 0; best = the scenario-best move that adds someone (EV-best without scenarios)", () => {
    const moves = [move("fa", "bench", 104, 110), move("fa", "star", 80, 85), move("fa", "k", 104, 111), move("fa2", null, 103, 112)];
    const adj = waiverAdjustment({ ev: 100, scen: 108 }, moves);
    expect(adj.vEv).toBe(104);
    expect(adj.vScen).toBe(112);
    // With scenarios the shown move is the one the scenario lineup costs are measured from: the open spot.
    expect(adj.best).toBe(moves[3]);
    expect(adj.vScen).toBe(adj.best?.scen);
    // Without scenarios: the EV-best, and an EV tie ("bench" vs "k") goes to the higher scenario ROS.
    const noScen = moves.map((m) => ({ ...m }));
    expect(waiverAdjustment({ ev: 100, scen: null }, noScen).best?.drop).toBe("k");
    for (const m of moves) {
      expect(adj.vEv - m.ev).toBeGreaterThanOrEqual(0);
      expect(adj.vScen as number).toBeGreaterThanOrEqual(m.scen as number);
    }
  });

  it("no move gains more than 1e-9: V is T's own ROS and there is no best move; without scenarios vScen is null", () => {
    const adj = waiverAdjustment({ ev: 100, scen: null }, [move("fa", "x", 100 + 1e-12), move("fa", "y", 60)]);
    expect(adj.best).toBeNull();
    expect(adj.vEv).toBeCloseTo(100, 9);
    expect(adj.vScen).toBeNull();
    expect(waiverAdjustment({ ev: 50, scen: 55 }, [])).toEqual({ vEv: 50, vScen: 55, best: null });
  });

  it("a drop-only move counts in V (no lineup cost below 0) but is never the best move", () => {
    // Only under starter limits can T − i beat T: lineup.ts's best effort when a minimum can't be met.
    const moves = [move(null, "forced", 106, 107), move("fa", "bench", 103, 104)];
    const adj = waiverAdjustment({ ev: 100, scen: 101 }, moves);
    expect(adj).toMatchObject({ vEv: 106, vScen: 107 });
    expect(adj.best).toBe(moves[1]);
    expect(waiverAdjustment({ ev: 100, scen: null }, [move(null, "forced", 106)]).best).toBeNull();
  });

  it("ties: the other ROS, then an open spot first, then the lower market value dropped, then the smaller ids", () => {
    // Ids sort against value here ("a-pricey" < "z-cheap"), so the value rule is what decides.
    const value: Record<string, number> = { "z-cheap": 100, "a-pricey": 900, a: 500, b: 500 };
    const valueOf = (id: string) => value[id] ?? 0;
    const open = move("fa", null, 104, 100);
    const drop = move("fa", "z-cheap", 104, 120);
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [drop, open], valueOf).best).toBe(drop); // with scenarios, scenario ROS decides first
    const openTie = move("fa", null, 104, 120);
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [drop, openTie], valueOf).best).toBe(openTie); // then nobody lost beats a drop
    const deep = move("fa", "a-pricey", 104, 109);
    const shallow = move("fa", "z-cheap", 104 + 1e-12, 108);
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [shallow, deep], valueOf).best).toBe(deep); // scenario ROS before value
    const keepPricey = move("fa", "z-cheap", 104, 108);
    const keepCheap = move("fa", "a-pricey", 104, 108);
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [keepCheap, keepPricey], valueOf).best).toBe(keepPricey); // drop the less valuable player
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [keepPricey, keepCheap], valueOf).best).toBe(keepPricey); // whatever the order
    expect(waiverAdjustment({ ev: 100, scen: null }, [move("fa", "b", 104), move("fa", "a", 104)], valueOf).best?.drop).toBe("a");
    expect(waiverAdjustment({ ev: 100, scen: null }, [move("fb", "a", 104), move("fa", "a", 104)], valueOf).best?.add).toBe("fa");
    // A clear winner ignores every tie-break: a higher scenario ROS beats a higher EV ROS with scenarios; the EV ROS decides without them.
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [open, move("fa", "a-pricey", 104.5, 90)], valueOf).best).toBe(open);
    expect(waiverAdjustment({ ev: 100, scen: null }, [move("fa", null, 104), move("fa", "a-pricey", 104.5)], valueOf).best?.drop).toBe("a-pricey");
  });

  it("with scenarios a move qualifies by its scenario gain alone: a scenario-only gain is the best move, an EV-only gain isn't one", () => {
    const scenOnly = move("fa", "x", 99.5, 101); // scenario ROS +2, EV ROS −0.5
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [scenOnly]).best).toBe(scenOnly);
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [move("fa", "x", 104.5, 90)]).best).toBeNull(); // EV +4.5, scenario −9
    expect(waiverAdjustment({ ev: 100, scen: 99 }, [move("fa", "x", 104.5, 99)]).best).toBeNull(); // scenario +0: no gain
    // Without scenarios the EV gain is what qualifies.
    expect(waiverAdjustment({ ev: 100, scen: null }, [move("fa", "x", 104.5)]).best?.ev).toBe(104.5);
    expect(waiverAdjustment({ ev: 100, scen: null }, [move("fa", "x", 99.5)]).best).toBeNull();
  });
});
