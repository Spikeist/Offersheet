/**
 * The free-agent optimizer judged in scenario lineups (optimizer.ts "Judging moves in scenario lineups"; review of track
 * E, item 1) against brute force, and the teamValue helpers it prices moves with (scenarioSwapGains,
 * scenarioRemovalCells, scenarioCellFloors through the add bound).
 */
import { describe, expect, it } from "vitest";
import { prepareSlots, type PreparedSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { NO_STREAM, applyStep, createOptimizer, fillCount, type OptimizerConfig } from "./optimizer";
import { weeklySd } from "./projections";
import { mulberry32 } from "./rng";
import { positionAllows, rosValue, scenarioAddGain, scenarioAddUpperBound, scenarioRemovalCells, scenarioRemovalCosts, scenarioSwapGains, scenarioValues, slotMask, solveEvWeeks, teamEval, type ScenarioCells, type TableRow } from "./teamValue";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const SLOTS: PreparedSlots = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 2, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"]), slot("K", 1, ["K"])]);
const W = 5;
const S = 8;
const CFG: OptimizerConfig = { faMinGain: 3, faMaxMoves: 5, optimizerExcluded: ["K", "DEF"] };
const EPS = 1e-9;

/** A row with random points around `base` and random availability (each scenario-week played with probability `p`). */
function row(rand: () => number, id: string, pos: Pos, base: number, p = 0.85): TableRow {
  const cond = Float64Array.from({ length: W }, () => Math.round(base * (0.7 + 0.6 * rand()) * 10) / 10);
  const flags = Uint8Array.from({ length: S * W }, () => (rand() < p ? 1 : 0));
  const ev = Float64Array.from(cond, (c, w) => {
    let n = 0;
    for (let s = 0; s < S; s++) n += flags[s * W + w] as number;
    return (c * n) / S;
  });
  return { id, pos, eligible: [pos], cond, ev, condSd: Float64Array.from(cond, (x) => weeklySd(x, pos)), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags };
}

/** A random team (QB, RBs, WRs, TE, K and a bench) and free agents, some at a position limit. */
function randomCase(seed: number) {
  const rand = mulberry32(seed);
  const team: TableRow[] = [];
  const add = (pos: Pos, base: number, n: number, tag: string) => {
    for (let i = 0; i < n; i++) team.push(row(rand, `${tag}${pos}${i}`, pos, base * (0.5 + rand())));
  };
  add("QB", 18, 1 + Math.floor(rand() * 2), "t");
  add("RB", 11, 2 + Math.floor(rand() * 3), "t");
  add("WR", 11, 2 + Math.floor(rand() * 3), "t");
  add("TE", 8, 1, "t");
  add("K", 7, 1, "t");
  const free: TableRow[] = [];
  for (const [pos, base] of [["QB", 12], ["RB", 7], ["WR", 7], ["TE", 5], ["K", 6]] as [Pos, number][]) for (let i = 0; i < 3; i++) free.push(row(rand, `fa${pos}${i}`, pos, base * (0.4 + rand())));
  const maxRosterSize = team.length + (rand() < 0.3 ? 1 : 0);
  const positionLimits: Partial<Record<Pos, number>> | undefined = rand() < 0.4 ? { RB: team.filter((r) => r.pos === "RB").length } : undefined;
  const value = new Map([...team, ...free].map((r) => [r.id, Math.round(rand() * 1000)]));
  return { team, free, maxRosterSize, positionLimits, value };
}

describe("scenario-judged moves (optimizer.ts; review of track E, item 1)", () => {
  it("the first move is the brute-force best by scenario gain (open spot, swaps; limits, the lineup-fill rule, ties)", () => {
    let moved = 0;
    let none = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const c = randomCase(seed);
      const rows = new Map([...c.team, ...c.free].map((r) => [r.id, r]));
      const weights = Float64Array.from({ length: W }, (_, w) => (w === W - 1 ? 1.25 : 1));
      const opt = createOptimizer(
        {
          rows,
          weekCount: W,
          slots: SLOTS,
          weights,
          freeAgents: c.free.map((r) => r.id),
          info: (id) => rows.get(id),
          positionLimits: c.positionLimits,
          maxRosterSize: c.maxRosterSize,
          dropValue: (id) => c.value.get(id) ?? 0,
          scenarios: S,
        },
        CFG,
      );
      expect(opt.judgesScenarios).toBe(true);
      const roster = c.team.map((r) => r.id);
      const ros = (ids: readonly string[]) => rosValue(scenarioValues(teamEval(ids.map((id) => rows.get(id) as TableRow), SLOTS), W, S).mean, weights);
      const base = ros(roster);
      const entries = (ids: readonly string[]) => ids.map((id) => ({ id, pos: (rows.get(id) as TableRow).pos, eligible: (rows.get(id) as TableRow).eligible }));
      const fillBefore = fillCount(entries(roster), SLOTS);
      const positions = (ids: readonly string[]) => ids.map((id) => (rows.get(id) as TableRow).pos);
      type M = { add: string; drop: string | null; gain: number };
      let best: M | null = null;
      const better = (a: M, b: M) => {
        if (Math.abs(a.gain - b.gain) > EPS) return a.gain > b.gain;
        if ((a.drop === null) !== (b.drop === null)) return a.drop === null;
        if (a.drop !== null && b.drop !== null && a.drop !== b.drop) {
          const va = c.value.get(a.drop) ?? 0;
          const vb = c.value.get(b.drop) ?? 0;
          return va !== vb ? va < vb : a.drop < b.drop;
        }
        return a.add < b.add;
      };
      const consider = (m: M) => {
        if (m.gain >= CFG.faMinGain - EPS && (!best || better(m, best))) best = m;
      };
      for (const a of c.free) {
        if (a.pos === "K") continue;
        if (roster.length < c.maxRosterSize && positionAllows(c.positionLimits, positions(roster), a.pos)) consider({ add: a.id, drop: null, gain: ros([...roster, a.id]) - base });
        for (const k of roster) {
          if ((rows.get(k) as TableRow).pos === "K") continue;
          const rest = roster.filter((x) => x !== k);
          if (!positionAllows(c.positionLimits, positions(rest), a.pos)) continue;
          if (fillCount(entries(rest), SLOTS) < fillBefore && fillCount(entries([...rest, a.id]), SLOTS) < fillBefore) continue;
          consider({ add: a.id, drop: k, gain: ros(roster.map((x) => (x === k ? a.id : x))) - base });
        }
      }
      const run = opt.optimize(roster, NO_STREAM, 1);
      const want = best as M | null;
      if (want === null) {
        none++;
        expect(run.moves, `seed ${seed}`).toEqual([]);
      } else {
        moved++;
        expect(run.moves.map((m) => [m.add, m.drop]), `seed ${seed}`).toEqual([[want.add, want.drop]]);
      }
    }
    // Both kinds of case occur.
    expect(moved).toBeGreaterThan(5);
    expect(none).toBeGreaterThan(0);
  });

  it("whole runs (every move and its EV gain) match a multi-move brute force, down at the cheap bounds' edge (review of the addendum, engine finding 6)", () => {
    // Thin rosters (a starting slot often empty) and free agents worth a point or two a week: many moves gain just over
    // faMinGain from a free agent whose cheap bound (scenScan's: every scenario at the week's lowest floor, at most
    // Σ ω × his points) is under 2 × faMinGain, where a pruning bug would skip him. Each step of the brute force prices
    // every legal move by scenario ROS from scratch and applies the best (the optimizer's rules and ties) while it gains at
    // least faMinGain, at most faMaxMoves moves.
    const weights = Float64Array.from({ length: W }, (_, w) => (w === W - 1 ? 1.25 : 1));
    const cheapTotal = (r: TableRow) => r.cond.reduce((s, c, w) => s + (weights[w] as number) * Math.max(0, c), 0);
    let moves = 0;
    let lowBound = 0;
    let multi = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const rand = mulberry32(7000 + seed);
      const team: TableRow[] = [];
      const add = (pos: Pos, base: number, n: number) => {
        for (let i = 0; i < n; i++) team.push(row(rand, `t${pos}${i}`, pos, base * (0.6 + 0.8 * rand())));
      };
      add("QB", 16, 1);
      add("RB", 9, Math.floor(rand() * 3));
      add("WR", 9, 1 + Math.floor(rand() * 2));
      add("TE", 6, rand() < 0.5 ? 0 : 1);
      add("K", 7, 1);
      // Sometimes a bench WR who barely scores (a drop for a swap).
      if (rand() < 0.5) team.push(row(rand, "tWR9", "WR", 0.4));
      const free: TableRow[] = [];
      for (const [pos, base] of [["QB", 3], ["RB", 1.2], ["WR", 1.2], ["TE", 1], ["K", 2]] as [Pos, number][]) for (let i = 0; i < 3; i++) free.push(row(rand, `fa${pos}${i}`, pos, base * (0.4 + rand())));
      // One to three open roster spots; sometimes a position limit.
      const maxRosterSize = team.length + 1 + Math.floor(rand() * 3);
      const positionLimits: Partial<Record<Pos, number>> | undefined = rand() < 0.3 ? { RB: team.filter((r) => r.pos === "RB").length + 1 } : undefined;
      const value = new Map([...team, ...free].map((r) => [r.id, Math.round(rand() * 1000)]));
      const rows = new Map([...team, ...free].map((r) => [r.id, r]));
      const opt = createOptimizer(
        { rows, weekCount: W, slots: SLOTS, weights, freeAgents: free.map((r) => r.id), info: (id) => rows.get(id), positionLimits, maxRosterSize, dropValue: (id) => value.get(id) ?? 0, scenarios: S },
        CFG,
      );
      const scenRos = (ids: readonly string[]) => rosValue(scenarioValues(teamEval(ids.map((id) => rows.get(id) as TableRow), SLOTS), W, S).mean, weights);
      const evRos = (ids: readonly string[]) => rosValue(solveEvWeeks(teamEval(ids.map((id) => rows.get(id) as TableRow), SLOTS), W).lv, weights);
      const entries = (ids: readonly string[]) => ids.map((id) => ({ id, pos: (rows.get(id) as TableRow).pos, eligible: (rows.get(id) as TableRow).eligible }));
      const positions = (ids: readonly string[]) => ids.map((id) => (rows.get(id) as TableRow).pos);
      type M = { add: string; drop: string | null; gain: number };
      const better = (a: M, b: M) => {
        if (Math.abs(a.gain - b.gain) > EPS) return a.gain > b.gain;
        if ((a.drop === null) !== (b.drop === null)) return a.drop === null;
        if (a.drop !== null && b.drop !== null && a.drop !== b.drop) {
          const va = value.get(a.drop) ?? 0;
          const vb = value.get(b.drop) ?? 0;
          return va !== vb ? va < vb : a.drop < b.drop;
        }
        return a.add < b.add;
      };
      let roster = team.map((r) => r.id);
      const added = new Set<string>();
      const want: { add: string; drop: string | null; gainEv: number }[] = [];
      for (let step = 0; step < CFG.faMaxMoves; step++) {
        const base = scenRos(roster);
        const fillBefore = fillCount(entries(roster), SLOTS);
        let best: M | null = null;
        const consider = (m: M) => {
          if (m.gain >= CFG.faMinGain - EPS && (!best || better(m, best))) best = m;
        };
        for (const a of free) {
          if (a.pos === "K" || added.has(a.id)) continue;
          if (roster.length < maxRosterSize && positionAllows(positionLimits, positions(roster), a.pos)) consider({ add: a.id, drop: null, gain: scenRos([...roster, a.id]) - base });
          for (const k of roster) {
            if ((rows.get(k) as TableRow).pos === "K") continue;
            const rest = roster.filter((x) => x !== k);
            if (!positionAllows(positionLimits, positions(rest), a.pos)) continue;
            if (fillCount(entries(rest), SLOTS) < fillBefore && fillCount(entries([...rest, a.id]), SLOTS) < fillBefore) continue;
            consider({ add: a.id, drop: k, gain: scenRos(roster.map((x) => (x === k ? a.id : x))) - base });
          }
        }
        const move = best as M | null;
        if (!move) break;
        const next = applyStep(roster, move);
        want.push({ add: move.add, drop: move.drop, gainEv: evRos(next) - evRos(roster) });
        if (cheapTotal(rows.get(move.add) as TableRow) < 2 * CFG.faMinGain) lowBound++;
        added.add(move.add);
        roster = next;
      }
      const run = opt.optimize(team.map((r) => r.id), NO_STREAM);
      expect(
        run.moves.map((m) => [m.add, m.drop]),
        `seed ${seed}`,
      ).toEqual(want.map((m) => [m.add, m.drop]));
      run.moves.forEach((m, i) => expect(m.gainEv, `seed ${seed} move ${i}`).toBeCloseTo((want[i] as { gainEv: number }).gainEv, 9));
      expect([...run.roster].sort()).toEqual([...roster].sort());
      moves += want.length;
      if (want.length > 1) multi++;
    }
    // The cases reach where the bounds matter: many moves, runs of several moves, and moves whose free agent's cheap bound
    // is under 2 × faMinGain.
    expect(moves).toBeGreaterThan(100);
    expect(multi).toBeGreaterThan(30);
    expect(lowBound).toBeGreaterThan(10);
  });

  it("judges in EV lineups without scenarios, and in scenario lineups a depth pickup EV lineups would skip", () => {
    // A team with no bench RB: a 6-point free-agent RB never starts in the average lineup (RBs of 15 and 14, a FLEX WR of
    // 12) but plays whenever an RB is out.
    const rand = mulberry32(3);
    const mk = (id: string, pos: Pos, pts: number) => {
      const r = row(rand, id, pos, pts, 0.8);
      r.cond.fill(pts);
      return { ...r, ev: Float64Array.from(r.cond, (x, w) => (x * Array.from({ length: S }, (_, s) => (r.flags as Uint8Array)[s * W + w] as number).reduce((a, b) => a + b, 0)) / S) };
    };
    const team = [mk("qb", "QB", 20), mk("rb1", "RB", 15), mk("rb2", "RB", 14), mk("wr1", "WR", 14), mk("wr2", "WR", 13), mk("wr3", "WR", 12), mk("te", "TE", 8), mk("k", "K", 7)];
    const fa = mk("fa-rb", "RB", 6);
    const rows = new Map([...team, fa].map((r) => [r.id, r]));
    const setup = { rows, weekCount: W, slots: SLOTS, weights: new Float64Array(W).fill(1), freeAgents: ["fa-rb"], info: (id: string) => rows.get(id), maxRosterSize: 9, dropValue: () => 0 };
    const ev = createOptimizer(setup, CFG).optimize(team.map((r) => r.id));
    const scen = createOptimizer({ ...setup, scenarios: S }, CFG).optimize(team.map((r) => r.id));
    expect(ev.moves).toEqual([]);
    expect(scen.moves.map((m) => [m.add, m.drop])).toEqual([["fa-rb", null]]);
    expect(scen.moves[0]?.gainEv as number).toBeLessThan(CFG.faMinGain);
  });
});

describe("teamValue's scenario move pricing", () => {
  const rand = mulberry32(9);
  const cases = Array.from({ length: 25 }, (_, i) => randomCase(100 + i));

  it("scenarioSwapGains equals the difference of the two rosters' scenario ROS; the add bound bounds every swap", () => {
    for (const c of cases) {
      const weights = Float64Array.from({ length: W }, () => 0.5 + rand());
      const cells = scenarioValues(teamEval(c.team, SLOTS), W, S, null, true).cells as ScenarioCells;
      const base = rosValue(scenarioValues(teamEval(c.team, SLOTS), W, S).mean, weights);
      const ks = c.team.map((_, k) => k);
      for (const a of c.free) {
        const mask = slotMask(SLOTS, a.pos, a.eligible);
        const gains = scenarioSwapGains(cells, ks, a, mask, weights);
        const ub = scenarioAddUpperBound(cells, a, mask, weights);
        expect(scenarioAddGain(cells, a, mask, weights)).toBeLessThanOrEqual(ub + EPS);
        ks.forEach((k, j) => {
          const swapped = c.team.map((r, i) => (i === k ? a : r));
          const want = rosValue(scenarioValues(teamEval(swapped, SLOTS), W, S).mean, weights) - base;
          expect(gains[j] as number, `${a.id} for ${(c.team[k] as TableRow).id}`).toBeCloseTo(want, 9);
          expect(gains[j] as number).toBeLessThanOrEqual(ub + EPS);
        });
      }
    }
  });

  it("scenarioRemovalCells sums, by pattern counts and weights, to scenarioRemovalCosts", () => {
    for (const c of cases) {
      const weights = Float64Array.from({ length: W }, () => 0.5 + rand());
      const cells = scenarioValues(teamEval(c.team, SLOTS), W, S, null, true).cells as ScenarioCells;
      const per = scenarioRemovalCells(cells) as Float64Array[];
      const total = scenarioRemovalCosts(cells, weights);
      const n = c.team.length;
      c.team.forEach((_, k) => {
        let sum = 0;
        for (let w = 0; w < W; w++) for (let s = 0; s < S; s++) sum += ((weights[w] as number) / S) * ((per[w] as Float64Array)[((cells.pattern[w] as Int32Array)[s] as number) * n + k] as number);
        expect(sum).toBeCloseTo(total[k] as number, 9);
      });
    }
  });
});
