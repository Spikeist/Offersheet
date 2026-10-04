/**
 * The free-agent optimizer with IR returners (optimizer.StreamSpec.returners; league.ts step 5b): a returner rides in
 * every lineup it solves, after the streaming rows, but takes no active spot, is never dropped, and never counts for the
 * lineup-fill rule; a roster's scenario lineups after an open-spot move are built incrementally from the one before it,
 * the newcomer placed before the streaming rows and the returners. Made-up rows.
 */
import { describe, expect, it } from "vitest";
import { prepareSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { createOptimizer, rosterKey, type OptimizerConfig, type OptimizerSetup, type StreamSpec } from "./optimizer";
import { weeklySd } from "./projections";
import { scenarioValues, teamEval, type TableRow } from "./teamValue";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const SLOTS = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 2, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"])]);
const W = 5;
const CFG: OptimizerConfig = { faMinGain: 3, faMaxMoves: 5, optimizerExcluded: ["K", "DEF"] };

/** A row scoring `points` every week from week index `from` (flags for S scenarios: every one from then, or each with chance p). */
function row(id: string, pos: Pos, points: number, opts: { from?: number; S?: number; p?: number; seed?: number } = {}): TableRow {
  const from = opts.from ?? 0;
  const S = opts.S ?? 0;
  let x = opts.seed ?? 7;
  const rand = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  const cond = new Float64Array(W).fill(points);
  const flags = S > 0 ? Uint8Array.from({ length: S * W }, (_, i) => (i % W >= from && rand() < (opts.p ?? 1) ? 1 : 0)) : null;
  const ev = Float64Array.from(cond, (c, w) => {
    if (w < from) return 0;
    if (!flags) return c;
    let n = 0;
    for (let s = 0; s < S; s++) n += flags[s * W + w] as number;
    return (c * n) / S;
  });
  return { id, pos, eligible: [pos], cond, ev, condSd: Float64Array.from(cond, (c) => weeklySd(c, pos)), evSd: Float64Array.from(ev, (c) => weeklySd(c, pos)), flags };
}

function setup(rows: TableRow[], freeAgents: string[], maxRosterSize: number, values: Record<string, number> = {}, scenarios = 0): OptimizerSetup {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    rows: byId,
    weekCount: W,
    slots: SLOTS,
    weights: new Float64Array(W).fill(1),
    freeAgents,
    info: (id) => byId.get(id),
    maxRosterSize,
    dropValue: (id) => values[id] ?? 0,
    scenarios,
  };
}

const STARTERS = () => [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("wr2", "WR", 11), row("te", "TE", 8)];

describe("the free-agent optimizer with IR returners", () => {
  it("never drops a returner nor counts him on the active roster: a full roster drops one of its own, an open spot stays open for a free agent", () => {
    // The returner is the weakest player of all (0.5): he'd be the drop if he were a roster player.
    const active = [...STARTERS(), row("rbB", "RB", 2), row("wrB", "WR", 1)];
    const back = row("back", "WR", 0.5);
    const fa = row("faWR", "WR", 9);
    const spec: StreamSpec = { rows: [], positions: [], returners: [back] };
    const ids = active.map((r) => r.id);
    const full = createOptimizer(setup([...active, back, fa], ["faWR"], 8), CFG).optimize(ids, spec);
    expect(full.moves.map((m) => m.add)).toEqual(["faWR"]);
    expect(full.moves[0]?.drop).not.toBeNull();
    expect(full.moves.some((m) => m.drop === "back")).toBe(false);
    expect(full.roster).not.toContain("back");
    // His row is in the lineups the optimizer solves, after the roster's players.
    expect(full.team.rows.at(-1)?.id).toBe("back");
    const open = createOptimizer(setup([...active, back, fa], ["faWR"], 9), CFG).optimize(ids, spec);
    expect(open.moves).toEqual([{ add: "faWR", drop: null, gainEv: expect.any(Number) }]);
  });

  it("the lineup-fill rule leaves the returners out: the only TE on the active roster stays, though a returning TE would cover the slot", () => {
    // Dropping the 2-point TE or the 1-point bench RB for the 9-point WR gains the same (the returning TE starts either
    // way); the TE is the less valuable, so without the rule he'd go. With it, the bench RB goes.
    const active = [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("wr2", "WR", 11), row("te", "TE", 2), row("rbB", "RB", 1)];
    const back = row("backTE", "TE", 10);
    const fa = row("faWR", "WR", 9);
    const opt = createOptimizer(setup([...active, back, fa], ["faWR"], 7, { te: 10, rbB: 500 }), CFG);
    const run = opt.optimize(
      active.map((r) => r.id),
      { rows: [], positions: [], returners: [back] },
    );
    expect(run.moves.map((m) => [m.add, m.drop])).toEqual([["faWR", "rbB"]]);
  });

  it("memo keys tell rosters with different returners apart", () => {
    const active = STARTERS();
    const back = row("back", "RB", 16);
    const opt = createOptimizer(setup([...active, back], [], 8), CFG);
    const ids = active.map((r) => r.id);
    const a = opt.evaluate(ids, { rows: [], positions: [] });
    const b = opt.evaluate(ids, { rows: [], positions: [], returners: [back] });
    expect(b).not.toBe(a);
    expect(b.evRos).toBeGreaterThan(a.evRos);
    expect(rosterKey(ids, { rows: [], positions: [], returners: [back] })).not.toBe(rosterKey(ids));
  });

  it("scenario lineups after an open-spot move, built from the roster's before it (the newcomer before the returners): bit for bit, lineups kept", () => {
    const S = 8;
    const active = [row("qb", "QB", 20, { S }), row("rb1", "RB", 15, { S, p: 0.8, seed: 3 }), row("rb2", "RB", 12, { S, p: 0.8, seed: 5 }), row("wr1", "WR", 14, { S }), row("wr2", "WR", 11, { S, p: 0.7, seed: 9 }), row("te", "TE", 8, { S })];
    const back = row("back", "RB", 13, { S, from: 2 });
    const fa = row("faRB", "RB", 10, { S, p: 0.9, seed: 11 });
    const stream = row("stream:TE", "TE", 3, { S });
    const opt = createOptimizer(setup([...active, back, fa], ["faRB"], 7, {}, S), CFG);
    expect(opt.judgesScenarios).toBe(true);
    const spec: StreamSpec = { rows: [stream], positions: ["TE"], returners: [back] };
    const run = opt.optimize(
      active.map((r) => r.id),
      spec,
    );
    expect(run.moves).toEqual([{ add: "faRB", drop: null, gainEv: expect.any(Number) }]);
    // The team's rows: its players (the newcomer last), the streaming row, the returner.
    expect(run.team.rows.map((r) => r.id)).toEqual([...active.map((r) => r.id), "faRB", "stream:TE", "back"]);
    const got = opt.scenarioValuesOf(run.roster, spec);
    const want = scenarioValues(teamEval(run.team.rows, SLOTS), W, S, null, true, true);
    expect(Array.from(got?.mean ?? [])).toEqual(Array.from(want.mean));
    expect(Array.from(got?.sd ?? [])).toEqual(Array.from(want.sd));
    expect(Array.from(got?.within ?? [])).toEqual(Array.from(want.within ?? []));
    // Built after the move, not solved again from scratch: fewer lineups solved.
    expect(got?.solves).toBeLessThan(want.solves);
  });
});
