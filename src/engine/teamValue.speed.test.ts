/**
 * The speed-ups of the Phase 4 addendum (lead decision N6) against the exact paths they replace, bit for bit, on random
 * cases: every number the fast versions produce must equal the reference's exactly (Object.is), so the search's results
 * can't move. The references are the code as it was before the speed work (scenario.testing.ts) or the functions the
 * shortcut combines.
 */
import { describe, expect, it } from "vitest";
import { lineupTotal, prepareRoster, prepareSlots, type LineupCandidate, type PreparedSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { instanceIndex, slotInstances, type InstanceIndex } from "./needs";
import { fillCount } from "./optimizer";
import { weeklySd } from "./projections";
import { mulberry32 } from "./rng";
import { referenceCellFloors, referenceEvFloors, referenceRemovalCosts, referenceScenarioValues } from "./scenario.testing";
import {
  addFloors,
  evRemovalCosts,
  evRemovalWeeks,
  scenarioAddGain,
  scenarioCellFloors,
  scenarioMoveGains,
  scenarioRemovalCells,
  scenarioRemovalCosts,
  scenarioSwapGains,
  scenarioValues,
  scenarioValuesAfterMove,
  slotMask,
  solveEvWeeks,
  teamEval,
  type ScenarioCells,
  type ScenarioValues,
  type TableRow,
} from "./teamValue";
import { TEST_LINEUP } from "./testLeague";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const SUPERFLEX_LINEUP: SlotDef[] = [...TEST_LINEUP, slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"])];
const IDP_LINEUP: SlotDef[] = [...TEST_LINEUP, slot("DL", 2, ["DL"]), slot("LB", 2, ["LB"]), slot("DB", 2, ["DB"]), slot("IDP_FLEX", 1, ["DL", "LB", "DB"])];
const LINEUPS = [TEST_LINEUP, SUPERFLEX_LINEUP, IDP_LINEUP];
const POSITIONS: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const LIMITED = prepareSlots([slot("QB", 1, ["QB"]), slot("FLEX", 6, ["RB", "WR", "TE"]), slot("K", 1, ["K"])], { RB: { min: 2, max: 4 }, WR: { min: 2, max: 4 }, TE: { min: 1, max: 2 } });

/**
 * A random row: conditional points (some zero weeks), availability for the EV points, and flags for `S` scenarios (null now
 * and then: a row without flags; fewer scenarios than asked now and then: readers treat the missing ones as "doesn't play").
 */
function randomRow(rand: () => number, id: string, W: number, S: number, opts: { avail?: number; noFlags?: number; short?: number } = {}): TableRow {
  const pos = POSITIONS[Math.floor(rand() * POSITIONS.length)] as Pos;
  const cond = Float64Array.from({ length: W }, () => (rand() < 0.1 ? 0 : Math.round(rand() * 250) / 10));
  const a = Float64Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 100) / 100));
  const ev = Float64Array.from(cond, (c, w) => c * (a[w] as number));
  const p = opts.avail ?? 0.8;
  const rowS = rand() < (opts.short ?? 0.05) ? Math.max(0, S - 1 - Math.floor(rand() * 3)) : S;
  const flags = rand() < (opts.noFlags ?? 0.05) ? null : Uint8Array.from({ length: rowS * W }, () => (rand() < p ? 1 : 0));
  return {
    id,
    pos,
    eligible: pos === "WR" && rand() < 0.25 ? ["WR", "RB"] : [pos],
    cond,
    ev,
    condSd: Float64Array.from(cond, (c) => weeklySd(c, pos)),
    evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)),
    flags,
  };
}

const plain = (xs: ArrayLike<number> | null | undefined) => (xs ? Array.from(xs) : xs);

/** Two ScenarioValues equal number for number (Object.is), cells included. */
function expectSame(got: ScenarioValues, want: ScenarioValues, label: string): void {
  expect(plain(got.mean), `${label} mean`).toEqual(plain(want.mean));
  expect(plain(got.sd), `${label} sd`).toEqual(plain(want.sd));
  expect(plain(got.within), `${label} within`).toEqual(plain(want.within));
  expect(got.instances?.map(plain) ?? null, `${label} instances`).toEqual(want.instances?.map(plain) ?? null);
  const cells = (c: ScenarioCells | null) =>
    c && {
      weekCount: c.weekCount,
      scenarios: c.scenarios,
      pattern: c.pattern.map(plain),
      lv: c.lv.map(plain),
      avail: c.avail.map((week) => week.map(plain)),
      seat: c.seat.map((week) => week.map(plain)),
      open: c.open.map(plain),
    };
  expect(cells(got.cells), `${label} cells`).toEqual(cells(want.cells));
}

describe("scenario lineups (teamValue.scenarioValues: per-week bitmasks, pattern keys and buffers)", () => {
  it("equal the code before the speed work, bit for bit: 400 random rosters (up to 40 scenarios, deep rosters, rows without flags)", () => {
    const rand = mulberry32(20261002);
    let deep = 0;
    for (let trial = 0; trial < 400; trial++) {
      const lineup = LINEUPS[trial % 3] as SlotDef[];
      const slots = prepareSlots(lineup);
      const W = 1 + Math.floor(rand() * 5);
      const S = trial % 10 === 0 ? 33 + Math.floor(rand() * 8) : 1 + Math.floor(rand() * 32);
      const isDeep = trial % 7 === 0;
      const n = isDeep ? 32 + Math.floor(rand() * 8) : 1 + Math.floor(rand() * 18);
      if (isDeep) deep++;
      const rows = Array.from({ length: n }, (_, k) => randomRow(rand, `p${String(k).padStart(2, "0")}`, W, S, { avail: isDeep ? 0.97 : 0.8 }));
      const team = teamEval(rows, slots);
      const index: InstanceIndex | null = trial % 2 === 0 ? instanceIndex(slotInstances(lineup), slots) : null;
      const keep = trial % 3 !== 1;
      const spread = trial % 4 !== 1;
      const got = scenarioValues(team, W, S, index, keep, spread);
      const want = referenceScenarioValues(team, W, S, index, keep, spread);
      expectSame(got, want, `trial ${trial}`);
      expect(got.solves, `trial ${trial} solves`).toBe(want.solves);
    }
    expect(deep).toBeGreaterThan(40);
  });

  it("no scenarios, no players, or a week nobody can score: the same empty weeks", () => {
    const slots = prepareSlots(TEST_LINEUP);
    const rand = mulberry32(5);
    const rows = [randomRow(rand, "a", 2, 3), randomRow(rand, "b", 2, 3)];
    for (const [team, S] of [
      [teamEval(rows, slots), 0],
      [teamEval([], slots), 4],
      [teamEval([{ ...(rows[0] as TableRow), cond: new Float64Array(2) }], slots), 3],
    ] as const)
      expectSame(scenarioValues(team, 2, S, null, true, true), referenceScenarioValues(team, 2, S, null, true, true), `S ${S}`);
  });
});

describe("a roster's scenario lineups after one move (teamValue.scenarioValuesAfterMove: only the patterns the move can change are solved)", () => {
  it("equal scenarioValues of the new roster, bit for bit, swaps and open-spot adds: 400 random moves; lineups really are kept", () => {
    const rand = mulberry32(777);
    let kept = 0;
    let fallback = 0;
    for (let trial = 0; trial < 400; trial++) {
      const lineup = LINEUPS[trial % 3] as SlotDef[];
      const slots = prepareSlots(lineup);
      const index = instanceIndex(slotInstances(lineup), slots);
      const W = 1 + Math.floor(rand() * 5);
      const S = trial % 25 === 0 ? 33 + Math.floor(rand() * 4) : 1 + Math.floor(rand() * 32);
      const players = Array.from({ length: 2 + Math.floor(rand() * 16) }, (_, k) => randomRow(rand, `p${k}`, W, S));
      // Streaming rows (every flag 1) after the players, now and then, as the optimizer's rosters have them.
      const stream = trial % 3 === 0 ? [{ ...randomRow(rand, "stream:K", W, S, { noFlags: 0, short: 0 }), pos: "K" as Pos, eligible: ["K"] as Pos[], flags: new Uint8Array(S * W).fill(1) }] : [];
      const newcomer = randomRow(rand, "new", W, S, { avail: 0.7 });
      const before = scenarioValues(teamEval([...players, ...stream], slots), W, S, index, true, true);
      const swap = rand() < 0.6;
      const drop = swap ? Math.floor(rand() * players.length) : null;
      const afterRows = swap ? [...players.slice(0, drop as number), newcomer, ...players.slice((drop as number) + 1), ...stream] : [...players, newcomer, ...stream];
      const at = swap ? (drop as number) : players.length;
      const after = teamEval(afterRows, slots);
      const got = scenarioValuesAfterMove(before, after, { drop, at }, W, S, index, true, true);
      const want = scenarioValues(after, W, S, index, true, true);
      if (got === null) {
        fallback++;
        expect(S, `trial ${trial}: only more than 32 scenarios fall back`).toBeGreaterThan(32);
        continue;
      }
      expectSame(got, want, `trial ${trial}`);
      if (got.solves < want.solves) kept++;
    }
    expect(kept).toBeGreaterThan(200); // most moves leave some lineups as they were
    expect(fallback).toBeGreaterThan(0);
  });

  it("falls back (null) under starter limits, without kept cells, or when the rows aren't the move's", () => {
    const rand = mulberry32(31);
    const W = 2;
    const S = 4;
    const rows = Array.from({ length: 8 }, (_, k) => randomRow(rand, `p${k}`, W, S));
    const newcomer = randomRow(rand, "new", W, S);
    const limited = scenarioValues(teamEval(rows, LIMITED), W, S, null, true, true);
    expect(scenarioValuesAfterMove(limited, teamEval([...rows, newcomer], LIMITED), { drop: null, at: 8 }, W, S)).toBeNull();
    const slots = prepareSlots(TEST_LINEUP);
    const noCells = scenarioValues(teamEval(rows, slots), W, S);
    expect(scenarioValuesAfterMove(noCells, teamEval([...rows, newcomer], slots), { drop: null, at: 8 }, W, S)).toBeNull();
    const before = scenarioValues(teamEval(rows, slots), W, S, null, true, true);
    // The newcomer somewhere else than `at` says, or the other rows reordered.
    expect(scenarioValuesAfterMove(before, teamEval([newcomer, ...rows], slots), { drop: null, at: 8 }, W, S)).toBeNull();
    expect(scenarioValuesAfterMove(before, teamEval([...rows.slice(1, 3), rows[0] as TableRow, ...rows.slice(3, 7), newcomer], slots), { drop: 7, at: 7 }, W, S)).toBeNull();
  });
});

describe("a newcomer's add and swap gains at once (teamValue.scenarioMoveGains: the benched drops share the add's solves)", () => {
  it("equal scenarioAddGain and scenarioSwapGains, bit for bit: 300 random cases (starter limits, a newcomer who fits no slot or never plays)", () => {
    const rand = mulberry32(4243);
    let shared = 0;
    for (let trial = 0; trial < 300; trial++) {
      const slots = trial % 10 === 9 ? LIMITED : prepareSlots(LINEUPS[trial % 3] as SlotDef[]);
      const W = 1 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 32);
      const base = Array.from({ length: 2 + Math.floor(rand() * 15) }, (_, k) => randomRow(rand, `r${k}`, W, S));
      const added = randomRow(rand, "new", W, S, { avail: 0.85 });
      const weights = Float64Array.from({ length: W }, () => (rand() < 0.2 ? 0 : rand() < 0.5 ? 1 : 1.25));
      const cells = scenarioValues(teamEval(base, slots), W, S, null, true).cells as ScenarioCells;
      const mask = trial % 13 === 0 ? 0 : slotMask(slots, added.pos, added.eligible);
      const ks = base.map((_, k) => k).filter(() => rand() < 0.7);
      const withAdd = trial % 4 !== 0;
      const got = scenarioMoveGains(cells, ks, added, mask, weights, withAdd);
      expect(got.add, `trial ${trial} add`).toBe(withAdd ? scenarioAddGain(cells, added, mask, weights) : 0);
      const swaps = scenarioSwapGains(cells, ks, added, mask, weights);
      ks.forEach((k, j) => expect(got.swaps[j], `trial ${trial} swap ${k}`).toBe(swaps[j]));
      if (ks.length > 1 && slots !== LIMITED) shared++;
    }
    expect(shared).toBeGreaterThan(150);
  });
});

describe("floors and removal costs from a lineup's group graph (teamValue.ts: the same reach as the walk, once per lineup)", () => {
  it("EV floors, kept cells' floors and removal costs equal the walk's, bit for bit: 300 random rosters, three lineups", () => {
    const rand = mulberry32(9192);
    for (let trial = 0; trial < 300; trial++) {
      const slots = prepareSlots(LINEUPS[trial % 3] as SlotDef[]);
      const W = 1 + Math.floor(rand() * 4);
      const S = 1 + Math.floor(rand() * 12);
      const rows = Array.from({ length: 1 + Math.floor(rand() * 17) }, (_, k) => randomRow(rand, `r${k}`, W, S));
      const team = teamEval(rows, slots);
      const n = rows.length;
      const weights = Float64Array.from({ length: W }, () => (rand() < 0.2 ? 0 : rand() < 0.5 ? 1 : 1.25));
      const masks = [...new Set(POSITIONS.map((p) => slotMask(slots, p, [p])).concat(slotMask(slots, "WR", ["WR", "RB"])))];
      // EV lineups.
      const solved = solveEvWeeks(team, W);
      for (const mask of masks) expect(plain(addFloors(solved, mask)), `trial ${trial} EV floors ${mask}`).toEqual(plain(referenceEvFloors(solved, mask)));
      const weeks = evRemovalWeeks(solved) as Float64Array[];
      const total = new Float64Array(n);
      for (let w = 0; w < W; w++) {
        const one = referenceRemovalCosts(solved.pts[w] as Float64Array, solved.seat[w] as Int32Array, team.prep.masks, n);
        expect(plain(weeks[w]), `trial ${trial} EV removal week ${w}`).toEqual(plain(one));
        const wt = weights[w] as number;
        if (wt > 0) for (let k = 0; k < n; k++) if ((solved.seat[w] as Int32Array)[k] as number >= 0) total[k] = (total[k] as number) + wt * (one[k] as number);
      }
      expect(plain(evRemovalCosts(solved, weights)), `trial ${trial} EV removal costs`).toEqual(plain(total));
      // Scenario lineups kept cell by cell.
      const cells = scenarioValues(team, W, S, null, true).cells as ScenarioCells;
      for (const mask of masks) expect(scenarioCellFloors(cells, mask)?.map(plain), `trial ${trial} cell floors ${mask}`).toEqual(referenceCellFloors(cells, mask).map(plain));
      const removal = scenarioRemovalCells(cells) as Float64Array[];
      const scen = new Float64Array(n);
      for (let w = 0; w < W; w++) {
        const counts = new Int32Array((cells.lv[w] as Float64Array).length);
        for (const p of cells.pattern[w] as Int32Array) counts[p] = (counts[p] as number) + 1;
        (cells.seat[w] as Int32Array[]).forEach((seat, p) => {
          const pts = Float64Array.from(rows, (r, k) => ((cells.avail[w] as Uint8Array[])[p]?.[k] === 1 ? (r.cond[w] as number) : 0));
          const one = referenceRemovalCosts(pts, seat, team.prep.masks, n);
          expect(plain((removal[w] as Float64Array).subarray(p * n, (p + 1) * n)), `trial ${trial} cells week ${w} pattern ${p}`).toEqual(plain(one));
          const wt = weights[w] as number;
          const count = counts[p] as number;
          if (wt > 0 && count > 0) for (let k = 0; k < n; k++) if ((seat[k] as number) >= 0) scen[k] = (scen[k] as number) + ((wt * count) / S) * (one[k] as number);
        });
      }
      expect(plain(scenarioRemovalCosts(cells, weights)), `trial ${trial} scenario removal costs`).toEqual(plain(scen));
    }
  });
});

describe("the structural fill count (optimizer.fillCount, memoized by the players' positions and eligibility)", () => {
  it("equals a fresh solve with every player worth 1, whatever the order and however often asked: 300 random sets, starter limits included", () => {
    const rand = mulberry32(11);
    const lineups: PreparedSlots[] = [...LINEUPS.map((l) => prepareSlots(l)), LIMITED];
    for (let trial = 0; trial < 300; trial++) {
      const slots = lineups[trial % lineups.length] as PreparedSlots;
      const entries: LineupCandidate[] = Array.from({ length: Math.floor(rand() * 14) }, (_, k) => {
        const pos = POSITIONS[Math.floor(rand() * POSITIONS.length)] as Pos;
        return { id: `e${k}`, pos, eligible: pos === "WR" && rand() < 0.3 ? ["WR", "RB"] : [pos] };
      });
      const fresh = entries.length ? lineupTotal(prepareRoster(entries, slots), new Float64Array(entries.length).fill(1)) : 0;
      expect(fillCount(entries, slots), `trial ${trial}`).toBe(fresh);
      const shuffled = [...entries].sort(() => rand() - 0.5).map((e, k) => ({ ...e, id: `x${k}` }));
      expect(fillCount(shuffled, slots), `trial ${trial} again`).toBe(fresh);
    }
  });
});
