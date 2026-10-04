/**
 * The optimizer's pool restriction (optimizer.ts, "The pool"; CLAUDE.md §7 one free agent, one team; planner reply to
 * Checkpoint 4, change 3): a run never adds an excluded free agent, every memo key includes the pool, and greedy
 * determinism (excluding free agents a run never adds changes none of its moves), which league.ts's allocation and
 * evaluate.ts's trade sides rely on. Made-up rows (CLAUDE.md §16).
 */
import { describe, expect, it } from "vitest";
import { prepareSlots, type PreparedSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { FULL_POOL, NO_STREAM, createOptimizer, poolRestriction, type OptimizerConfig, type OptimizerSetup } from "./optimizer";
import { weeklySd } from "./projections";
import { mulberry32 } from "./rng";
import type { TableRow } from "./teamValue";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const SLOTS: PreparedSlots = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 2, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"]), slot("K", 1, ["K"])]);
const W = 5;
const S = 8;
const CFG: OptimizerConfig = { faMinGain: 3, faMaxMoves: 5, optimizerExcluded: ["K", "DEF"] };

/** A row with the same points every week, playing every scenario (flags all 1; null without scenarios). */
function flatRow(id: string, pos: Pos, points: number, scenarios = 0): TableRow {
  const pts = Float64Array.from({ length: W }, () => points);
  return { id, pos, eligible: [pos], cond: pts, ev: Float64Array.from(pts), condSd: Float64Array.from(pts, (x) => weeklySd(x, pos)), evSd: Float64Array.from(pts, (x) => weeklySd(x, pos)), flags: scenarios > 0 ? new Uint8Array(scenarios * W).fill(1) : null };
}

/** A row with random points around `base` and random availability (each scenario-week played with probability `p`). */
function randomRow(rand: () => number, id: string, pos: Pos, base: number, p = 0.85): TableRow {
  const cond = Float64Array.from({ length: W }, () => Math.round(base * (0.7 + 0.6 * rand()) * 10) / 10);
  const flags = Uint8Array.from({ length: S * W }, () => (rand() < p ? 1 : 0));
  const ev = Float64Array.from(cond, (c, w) => {
    let n = 0;
    for (let s = 0; s < S; s++) n += flags[s * W + w] as number;
    return (c * n) / S;
  });
  return { id, pos, eligible: [pos], cond, ev, condSd: Float64Array.from(cond, (x) => weeklySd(x, pos)), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags };
}

function setupOf(rows: readonly TableRow[], freeAgents: readonly string[], maxRosterSize: number, scenarios: number, value: (id: string) => number = () => 0, positionLimits?: Partial<Record<Pos, number>>): OptimizerSetup {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    rows: byId,
    weekCount: W,
    slots: SLOTS,
    weights: Float64Array.from({ length: W }, (_, w) => (w === W - 1 ? 1.25 : 1)),
    freeAgents: [...freeAgents],
    info: (id) => byId.get(id),
    positionLimits,
    maxRosterSize,
    dropValue: value,
    scenarios,
  };
}

/** A random team (QB, RBs, WRs, TE, K and a bench) and 4 free agents a position, some at a position limit. */
function randomCase(seed: number) {
  const rand = mulberry32(seed);
  const team: TableRow[] = [];
  const add = (pos: Pos, base: number, n: number) => {
    for (let i = 0; i < n; i++) team.push(randomRow(rand, `t${pos}${i}`, pos, base * (0.5 + rand())));
  };
  add("QB", 18, 1 + Math.floor(rand() * 2));
  add("RB", 11, 2 + Math.floor(rand() * 3));
  add("WR", 11, 2 + Math.floor(rand() * 3));
  add("TE", 8, 1);
  add("K", 7, 1);
  const free: TableRow[] = [];
  for (const [pos, base] of [["QB", 12], ["RB", 8], ["WR", 8], ["TE", 6], ["K", 6]] as [Pos, number][]) for (let i = 0; i < 4; i++) free.push(randomRow(rand, `fa${pos}${i}`, pos, base * (0.4 + rand())));
  const maxRosterSize = team.length + (rand() < 0.4 ? 1 : 0);
  const positionLimits: Partial<Record<Pos, number>> | undefined = rand() < 0.3 ? { RB: team.filter((r) => r.pos === "RB").length } : undefined;
  const value = new Map([...team, ...free].map((r) => [r.id, Math.round(rand() * 1000)]));
  return { team, free, maxRosterSize, positionLimits, value, rand };
}

describe("poolRestriction (optimizer.ts, 'The pool')", () => {
  it("a canonical key: the excluded ids sorted, repeats ignored; none is the whole pool", () => {
    expect(poolRestriction(["b", "a", "a"]).key).toBe(poolRestriction(["a", "b"]).key);
    expect([...poolRestriction(["b", "a", "a"]).excluded].sort()).toEqual(["a", "b"]);
    expect(poolRestriction([])).toBe(FULL_POOL);
    expect(FULL_POOL.key).toBe("");
    expect(poolRestriction(["a"]).key).not.toBe(poolRestriction(["a", "b"]).key);
  });
});

describe("the optimizer against a restricted pool (§7 one free agent, one team)", () => {
  // A small team: QB 20, RBs 15 and 12, WR 14, a second WR 13, TE 8, a 6-point FLEX WR, a 2-point bench RB, K 7 (full: 9 of 9).
  const team = [flatRow("qb", "QB", 20), flatRow("rb1", "RB", 15), flatRow("rb2", "RB", 12), flatRow("wr1", "WR", 14), flatRow("wr2", "WR", 13), flatRow("te", "TE", 8), flatRow("wr3", "WR", 6), flatRow("rb3", "RB", 2), flatRow("k", "K", 7)];
  const ids = team.map((r) => r.id);
  // Free-agent WRs of 10 and 9: either takes the FLEX from the 6-point WR (+4 or +3 a week).
  const rows = [...team, flatRow("fa-wr", "WR", 10), flatRow("fa-wr2", "WR", 9)];

  it("never adds an excluded free agent: the next best one instead, or no move at all", () => {
    const opt = createOptimizer(setupOf(rows, ["fa-wr", "fa-wr2"], 9, 0), CFG);
    const omega = 4 + 1.25;
    expect(opt.optimize(ids).moves).toEqual([{ add: "fa-wr", drop: "rb3", gainEv: expect.closeTo(4 * omega, 9) }]);
    expect(opt.optimize(ids, NO_STREAM, undefined, poolRestriction(["fa-wr"])).moves).toEqual([{ add: "fa-wr2", drop: "rb3", gainEv: expect.closeTo(3 * omega, 9) }]);
    expect(opt.optimize(ids, NO_STREAM, undefined, poolRestriction(["fa-wr", "fa-wr2"])).moves).toEqual([]);
    // An excluded id that isn't a free agent at all changes nothing.
    expect(opt.optimize(ids, NO_STREAM, undefined, poolRestriction(["nobody"])).moves.map((m) => m.add)).toEqual(["fa-wr"]);
  });

  it("the pool is part of every memo key: runs against different pools never share a result; the whole pool and an empty restriction do", () => {
    const opt = createOptimizer(setupOf(rows, ["fa-wr", "fa-wr2"], 9, 0), CFG);
    const full = opt.optimize(ids);
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL)).toBe(full);
    expect(opt.optimize(ids, NO_STREAM, undefined, poolRestriction([]))).toBe(full);
    const without = opt.optimize(ids, NO_STREAM, undefined, poolRestriction(["fa-wr"]));
    expect(without).not.toBe(full);
    expect(opt.optimize(ids, NO_STREAM, undefined, poolRestriction(["fa-wr"]))).toBe(without);
    expect(opt.optimize(ids)).toBe(full);
    // A re-run (reoptimize) is memoized by its pool too. Losing the 14-point WR from V*(T) (fa-wr at FLEX): fa-wr moves up to
    // WR and the open spot takes fa-wr2 at FLEX (+3 a week over the 6-point WR), unless the pool excludes him; then the
    // spot takes back the bench RB V*(T)'s move dropped.
    const start = full.roster.filter((id) => id !== "wr1");
    const lost = opt.reoptimize(full, start, NO_STREAM, 1, ["wr1"]);
    expect(lost.moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr2", null]]);
    const blocked = opt.reoptimize(full, start, NO_STREAM, 1, ["wr1"], undefined, poolRestriction(["fa-wr2"]));
    expect(blocked).not.toBe(lost);
    expect(blocked.moves).toEqual([]);
    expect(blocked.given).toEqual([{ pickup: null, back: "rb3" }]);
    expect(opt.reoptimize(full, start, NO_STREAM, 1, ["wr1"])).toBe(lost);
  });

  it("judged in scenario lineups (scenarios > 0) the same: an excluded free agent is never added", () => {
    const scenRows = [...team.map((r) => flatRow(r.id, r.pos, r.ev[0] as number, S)), flatRow("fa-wr", "WR", 10, S), flatRow("fa-wr2", "WR", 9, S)];
    const opt = createOptimizer(setupOf(scenRows, ["fa-wr", "fa-wr2"], 9, S), CFG);
    expect(opt.judgesScenarios).toBe(true);
    expect(opt.optimize(ids).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr", "rb3"]]);
    expect(opt.optimize(ids, NO_STREAM, undefined, poolRestriction(["fa-wr"])).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr2", "rb3"]]);
  });
});

describe("greedy determinism (optimizer.ts, 'The pool'): excluding free agents a run never adds changes none of its moves", () => {
  for (const scenarios of [0, S]) {
    it(`${scenarios ? "scenario" : "EV"}-judged runs on 40 random teams: the same moves without any free agent the run didn't add; never an excluded one`, () => {
      let changed = 0;
      let moved = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = randomCase(seed);
        const rows = [...c.team, ...c.free];
        const fas = c.free.map((r) => r.id);
        const setup = setupOf(rows, fas, c.maxRosterSize, scenarios, (id) => c.value.get(id) ?? 0, c.positionLimits);
        const roster = c.team.map((r) => r.id);
        const run = createOptimizer(setup, CFG).optimize(roster);
        const adds = new Set(run.moves.map((m) => m.add));
        if (adds.size) moved++;
        // Any subset of the free agents the run never added: a fresh optimizer and the same one (memo by pool) agree.
        const others = fas.filter((id) => !adds.has(id));
        const subset = others.filter(() => c.rand() < 0.6);
        for (const opt of [createOptimizer(setup, CFG), createOptimizer(setup, CFG)]) {
          opt.optimize(roster);
          const restricted = opt.optimize(roster, NO_STREAM, undefined, poolRestriction(subset));
          expect(restricted.moves, `seed ${seed}`).toEqual(run.moves);
          expect(restricted.roster, `seed ${seed}`).toEqual(run.roster);
        }
        // Excluding a free agent the run added: that one is never added (the run may change).
        for (const id of adds) {
          const r = createOptimizer(setup, CFG).optimize(roster, NO_STREAM, undefined, poolRestriction([id]));
          expect(r.moves.map((m) => m.add), `seed ${seed}`).not.toContain(id);
          if (r.moves.length !== run.moves.length || r.moves.some((m, i) => m.add !== run.moves[i]?.add)) changed++;
        }
      }
      expect(moved).toBeGreaterThan(10);
      expect(changed).toBeGreaterThan(5);
    });
  }

  it("a re-run (reoptimize) never adds an excluded free agent either (random teams, every player lost in turn)", () => {
    let rerunsWithMoves = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const c = randomCase(seed);
      const setup = setupOf([...c.team, ...c.free], c.free.map((r) => r.id), c.maxRosterSize, S, (id) => c.value.get(id) ?? 0, c.positionLimits);
      const opt = createOptimizer(setup, CFG);
      const roster = c.team.map((r) => r.id);
      const excluded = c.free.filter(() => c.rand() < 0.5).map((r) => r.id);
      const pool = poolRestriction(excluded);
      const v = opt.optimize(roster, NO_STREAM, undefined, pool);
      for (const id of v.roster) {
        const l = opt.reoptimize(v, v.roster.filter((x) => x !== id), NO_STREAM, 1, [id], undefined, pool);
        if (l.moves.length) rerunsWithMoves++;
        for (const m of l.moves) expect(excluded, `seed ${seed}: ${id}`).not.toContain(m.add);
      }
    }
    expect(rerunsWithMoves).toBeGreaterThan(5);
  });
});
