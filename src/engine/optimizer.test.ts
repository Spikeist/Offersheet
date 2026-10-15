import { describe, expect, it } from "vitest";
import { config } from "./config";
import { prepareSlots, solveLineup, type PreparedSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { FULL_POOL, NO_STREAM, applyStep, createOptimizer, fillCount, optimizerConfig, rosterKey, type DynastyGuard, type OptimizerConfig, type OptimizerSetup, type StreamSpec } from "./optimizer";
import { weeklySd } from "./projections";
import { mulberry32 } from "./rng";
import { positionAllows, streamRow, type TableRow } from "./teamValue";
import { TEST_LINEUP } from "./testLeague";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });

/** A table row with the same expected points every week, or per week. */
function row(id: string, pos: Pos, ev: number | number[], W = 4, eligible: Pos[] = [pos]): TableRow {
  const pts = typeof ev === "number" ? new Array<number>(W).fill(ev) : ev;
  return {
    id,
    pos,
    eligible,
    cond: Float64Array.from(pts),
    ev: Float64Array.from(pts),
    condSd: Float64Array.from(pts, (x) => weeklySd(x, pos)),
    evSd: Float64Array.from(pts, (x) => weeklySd(x, pos)),
    flags: null,
  };
}

const STANDARD = prepareSlots(TEST_LINEUP);
const SMALL = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 1, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"]), slot("K", 1, ["K"])]);
const SUPERFLEX = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 1, ["RB"]), slot("WR", 2, ["WR"]), slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"]), slot("TE", 1, ["TE"])]);

/** A setup from rows (rostered and free agents), every week weighing 1 unless given. */
function setupOf(rows: TableRow[], opts: Partial<OptimizerSetup> & { freeAgents: string[]; slots?: PreparedSlots; ghosts?: Record<string, Pos> }): OptimizerSetup {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const W = rows[0]?.ev.length ?? 0;
  return {
    rows: byId,
    weekCount: W,
    slots: opts.slots ?? SMALL,
    weights: opts.weights ?? new Float64Array(W).fill(1),
    freeAgents: opts.freeAgents,
    info: (id) => {
      const r = byId.get(id);
      if (r) return { pos: r.pos, eligible: r.eligible };
      const ghost = opts.ghosts?.[id];
      return ghost ? { pos: ghost, eligible: [ghost] } : undefined;
    },
    positionLimits: opts.positionLimits,
    maxRosterSize: opts.maxRosterSize ?? 8,
    dropValue: opts.dropValue ?? (() => 0),
    dynasty: opts.dynasty ?? null,
  };
}

const CFG: OptimizerConfig = { faMinGain: 3, faMaxMoves: 5, optimizerExcluded: ["K", "DEF"] };

/** A small team: QB 20, RBs 15 and 12, WR 14, TE 8, a 6-point bench WR, K 7 (the SMALL lineup's FLEX is the bench WR's). */
function team(): TableRow[] {
  return [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 8), row("wr2", "WR", 6), row("k", "K", 7)];
}
const TEAM_IDS = ["qb", "rb1", "rb2", "wr1", "te", "wr2", "k"];

describe("the free-agent optimizer's rules (CLAUDE.md §7 V*; lead decision L2)", () => {
  it("makes the best move while it gains at least faMinGain, then stops; each move's gain is the roster's EV ROS change", () => {
    // A 10-point free-agent WR takes the FLEX from the 6-point bench WR: +4 a week × 4 weeks = 16 ≥ 3. Roster full (8 of 8 with a bench RB).
    const rows = [...team(), row("rb3", "RB", 2), row("fa-wr", "WR", 10), row("fa-rb", "RB", 3)];
    const opt = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr", "fa-rb"], maxRosterSize: 8 }), CFG);
    const v = opt.optimize([...TEAM_IDS, "rb3"]);
    // Dropping the 2-point bench RB (never starts) for the free-agent WR: +16. Then the 3-point free-agent RB for the
    // now-bench 6-point WR would gain nothing (he starts nowhere): stop.
    expect(v.moves).toEqual([{ add: "fa-wr", drop: "rb3", gainEv: 16 }]);
    expect(v.roster).toEqual(["qb", "rb1", "rb2", "wr1", "te", "wr2", "k", "fa-wr"]);
    expect(v.evRos).toBeCloseTo(4 * (20 + 15 + 12 + 14 + 8 + 10 + 7), 9);
    // Raise the bar above 16: no move.
    expect(createOptimizer(setupOf(rows, { freeAgents: ["fa-wr", "fa-rb"] }), { ...CFG, faMinGain: 16.5 }).optimize([...TEAM_IDS, "rb3"]).moves).toEqual([]);
    // Exactly at the bar: the move is made.
    expect(createOptimizer(setupOf(rows, { freeAgents: ["fa-wr", "fa-rb"] }), { ...CFG, faMinGain: 16 }).optimize([...TEAM_IDS, "rb3"]).moves).toHaveLength(1);
  });

  it("stops after faMaxMoves moves, and takes a smaller budget per call", () => {
    // Three weak starters (TE 8, QB 20, RB2 12; the FLEX is a 13-point WR) and three bench RBs who never start (b1–b3): free
    // agents of 12 at TE (+4 a week), 23 at QB (+3) and 14 at RB (+2) come in one at a time, best first, each for a bench RB.
    const rows = [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 8), row("wr2", "WR", 13), row("k", "K", 7), row("b1", "RB", 1), row("b2", "RB", 1), row("b3", "RB", 1), row("fa-te", "TE", 12), row("fa-qb", "QB", 23), row("fa-rb", "RB", 14)];
    const ids = ["qb", "rb1", "rb2", "wr1", "te", "wr2", "k", "b1", "b2", "b3"];
    const fas = ["fa-qb", "fa-te", "fa-rb"];
    const opt = createOptimizer(setupOf(rows, { freeAgents: fas, maxRosterSize: 10 }), CFG);
    expect(opt.optimize(ids).moves).toEqual([
      { add: "fa-te", drop: "b1", gainEv: 16 },
      { add: "fa-qb", drop: "b2", gainEv: 12 },
      { add: "fa-rb", drop: "b3", gainEv: 8 },
    ]);
    expect(createOptimizer(setupOf(rows, { freeAgents: fas, maxRosterSize: 10 }), { ...CFG, faMaxMoves: 2 }).optimize(ids).moves.map((m) => m.add)).toEqual(["fa-te", "fa-qb"]);
    expect(opt.optimize(ids, NO_STREAM, 1).moves.map((m) => m.add)).toEqual(["fa-te"]);
    expect(opt.optimize(ids, NO_STREAM, 0).moves).toEqual([]);
  });

  it("fills an open spot first: on a tie, nobody is lost", () => {
    // 7 of 8: the free-agent WR (10) can go into the open spot or for the 6-point WR's bench twin; the gain is the same.
    const rows = [...team(), row("fa-wr", "WR", 10)];
    const v = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"], maxRosterSize: 8 }), CFG).optimize(TEAM_IDS);
    expect(v.moves).toEqual([{ add: "fa-wr", drop: null, gainEv: 16 }]);
    expect(v.roster).toEqual([...TEAM_IDS, "fa-wr"]);
  });

  it("never adds or drops a kicker or team defense, nor a position the team streams", () => {
    // A 12-point free-agent K would beat the team's 7: excluded. A 9-point free-agent TE would beat the TE: not while it streams TE.
    const rows = [...team(), row("rb3", "RB", 2), row("fa-k", "K", 12), row("fa-te", "TE", 9)];
    const ids = [...TEAM_IDS, "rb3"];
    const setup = setupOf(rows, { freeAgents: ["fa-k", "fa-te"] });
    // The TE moves to the FLEX over the 6-point WR: +1 at TE and +2 at FLEX a week.
    expect(createOptimizer(setup, CFG).optimize(ids).moves).toEqual([{ add: "fa-te", drop: "rb3", gainEv: 12 }]);
    const te: StreamSpec = { rows: [streamRow("TE", [1, 1, 1, 1], 0)], positions: ["TE"] };
    expect(createOptimizer(setup, CFG).optimize(ids, te).moves).toEqual([]);
    // With K and DEF allowed (a test config), the kicker swap is the best move.
    expect(createOptimizer(setup, { ...CFG, optimizerExcluded: [] }).optimize(ids).moves[0]).toMatchObject({ add: "fa-k", drop: "k" });
    expect(optimizerConfig()).toEqual({ faMinGain: config.freeAgentOptimizer.faMinGain, faMaxMoves: config.freeAgentOptimizer.faMaxMoves, optimizerExcluded: config.streaming.optimizerExcluded });
  });

  it("never drops a player the starting lineup needs: the only TE goes only for a free-agent TE", () => {
    // The TE scores 0 (hurt all season), so dropping him costs nothing, but he's the only one who can fill the TE slot. The
    // bench RB (5, never starts: the FLEX is the 6-point WR) costs nothing either, and "te" < "tz" < "wr2" would win the tie (dropping the
    // 6-point WR for the 9-point one gains the same).
    const rows = [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 0), row("wr2", "WR", 6), row("k", "K", 7), row("tz", "RB", 5), row("fa-wr", "WR", 9), row("fa-te", "TE", 4)];
    const ids = ["qb", "rb1", "rb2", "wr1", "te", "wr2", "k", "tz"];
    // Without the free-agent TE, the WR (FLEX 9 over 6: +12) comes in for the bench RB, not the TE.
    const noTe = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"] }), CFG).optimize(ids);
    expect(noTe.moves).toEqual([{ add: "fa-wr", drop: "tz", gainEv: 12 }]);
    // With him, the TE swap (+16: dropping either costs nothing, and the tie goes to "te") comes first, the WR after it.
    const both = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr", "fa-te"] }), CFG).optimize(ids);
    expect(both.moves).toEqual([
      { add: "fa-te", drop: "te", gainEv: 16 },
      { add: "fa-wr", drop: "tz", gainEv: 12 },
    ]);
    // Structurally: a lineup missing its TE fills 6 of 7 slots; swapping the 0-point TE for a WR would make it 6 from 7.
    expect(fillCount(ids.map((id) => ({ id, pos: rows.find((r) => r.id === id)?.pos as Pos, eligible: [rows.find((r) => r.id === id)?.pos as Pos] })), SMALL)).toBe(7);
  });

  it("a lineup that already can't be filled only may not lose more: a team without a QB can still swap bench players", () => {
    const rows = [row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 8), row("wr2", "WR", 6), row("k", "K", 7), row("rb3", "RB", 2), row("fa-rb", "RB", 13)];
    const v = createOptimizer(setupOf(rows, { freeAgents: ["fa-rb"], maxRosterSize: 7 }), CFG).optimize(["rb1", "rb2", "wr1", "te", "wr2", "k", "rb3"]);
    // The free-agent RB takes RB2 (13), the 12-point RB moves to the FLEX over the 6-point WR: +7 a week.
    expect(v.moves).toEqual([{ add: "fa-rb", drop: "rb3", gainEv: 28 }]);
  });

  it("dynasty and keeper leagues: never drops a player worth more than the guard over the free agent", () => {
    // The bench RB is a prospect (dynasty value 5,000); the free agent 100. Guard: 5% of a 10,000 top value = 500.
    const rows = [...team(), row("rb3", "RB", 2), row("fa-wr", "WR", 10)];
    const values: Record<string, number> = { rb3: 5000, "fa-wr": 100, wr2: 400 };
    const guard: DynastyGuard = { value: (id) => values[id] ?? 0, maxDrop: 0.05 * 10_000 };
    const v = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"], dynasty: guard }), CFG).optimize([...TEAM_IDS, "rb3"]);
    // The prospect stays; the 6-point WR (400 − 100 ≤ 500) goes instead, for the same +16 (the free agent takes the FLEX).
    expect(v.moves).toEqual([{ add: "fa-wr", drop: "wr2", gainEv: 16 }]);
    // Within the guard (600 − 100 = 500), he can go.
    values.rb3 = 600;
    expect(createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"], dynasty: guard }), CFG).optimize([...TEAM_IDS, "rb3"]).moves[0]?.drop).toBe("rb3");
  });

  it("position limits: a free agent at a full position comes in only for a player at that position; the open spot can't take him", () => {
    // RB limit 3 with 3 RBs and an open spot: the 16-point free-agent RB can't go into it.
    const rows = [...team(), row("rb3", "RB", 2), row("fa-rb", "RB", 16)];
    const ids = [...TEAM_IDS, "rb3"];
    const v = createOptimizer(setupOf(rows, { freeAgents: ["fa-rb"], maxRosterSize: 9, positionLimits: { RB: 3 } }), CFG).optimize(ids);
    // He replaces the 2-point bench RB: RB1 16, RB2 15, FLEX 12 (over the 6-point WR): +(16 + 12 − 12 − 6) = +10 a week.
    expect(v.moves).toEqual([{ add: "fa-rb", drop: "rb3", gainEv: 40 }]);
    expect(positionAllows({ RB: 3 }, ["RB", "RB", "RB"], "RB")).toBe(false);
  });

  it("a player without a model takes a spot and counts toward limits, but is never dropped", () => {
    // 8 of 8 with a ghost (no projections): the free-agent WR has to come in for someone else.
    const rows = [...team(), row("fa-wr", "WR", 10)];
    const v = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"], maxRosterSize: 8, ghosts: { ghost: "RB" } }), CFG).optimize([...TEAM_IDS, "ghost"]);
    expect(v.moves).toEqual([{ add: "fa-wr", drop: "wr2", gainEv: 16 }]);
    expect(v.roster).toContain("ghost");
    // The ghost counts toward an RB limit of 3 (rb1, rb2 and him): an RB free agent needs an RB's spot.
    const rbRows = [...team(), row("fa-rb", "RB", 13)];
    const limited = createOptimizer(setupOf(rbRows, { freeAgents: ["fa-rb"], maxRosterSize: 9, positionLimits: { RB: 3 }, ghosts: { ghost: "RB" } }), CFG).optimize([...TEAM_IDS, "ghost"]);
    expect(limited.moves).toEqual([{ add: "fa-rb", drop: "rb2", gainEv: 4 }]);
  });

  it("ties: equal gains drop the less valuable player, then the smaller ids", () => {
    // Two bench RBs who never start (2 and 1 points): dropping either for the free-agent WR gains the same 16.
    const rows = [...team(), row("rb-b", "RB", 2), row("rb-a", "RB", 1), row("fa-wr", "WR", 10)];
    const ids = [...TEAM_IDS.filter((id) => id !== "wr2"), "wr2", "rb-b", "rb-a"];
    const by = (values: Record<string, number>) => createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"], maxRosterSize: 9, dropValue: (id) => values[id] ?? 0 }), CFG).optimize(ids).moves[0]?.drop;
    expect(by({ "rb-a": 300, "rb-b": 200, wr2: 500 })).toBe("rb-b"); // the lower value goes
    expect(by({ "rb-a": 200, "rb-b": 300, wr2: 500 })).toBe("rb-a");
    expect(by({})).toBe("rb-a"); // equal values: the smaller id
    // Equal free agents: the smaller id is added.
    const twins = [...team(), row("rb3", "RB", 2), row("fa-b", "WR", 10), row("fa-a", "WR", 10)];
    expect(createOptimizer(setupOf(twins, { freeAgents: ["fa-b", "fa-a"] }), CFG).optimize([...TEAM_IDS, "rb3"]).moves[0]?.add).toBe("fa-a");
  });

  it("is deterministic and memoized: the same roster in any order gives the same moves; applyStep and rosterKey", () => {
    const rows = [...team(), row("rb3", "RB", 2), row("fa-wr", "WR", 10), row("fa-te", "TE", 9)];
    const opt = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr", "fa-te"] }), CFG);
    const a = opt.optimize([...TEAM_IDS, "rb3"]);
    const b = opt.optimize([...TEAM_IDS, "rb3"].reverse());
    expect(b).toBe(a);
    expect(opt.stats.hits).toBe(1);
    const fresh = createOptimizer(setupOf(rows, { freeAgents: ["fa-te", "fa-wr"] }), CFG).optimize([...TEAM_IDS, "rb3"].reverse());
    expect(fresh.moves).toEqual(a.moves);
    expect(applyStep(["a", "b", "c"], { add: "x", drop: "b" })).toEqual(["a", "x", "c"]);
    expect(applyStep(["a", "b"], { add: "x", drop: null })).toEqual(["a", "b", "x"]);
    expect(rosterKey(["b", "a", "a"])).toBe(rosterKey(["a", "b"]));
    expect(rosterKey(["a"], { rows: [], positions: ["K"] })).not.toBe(rosterKey(["a"]));
  });

  it("the keep set (Phase 7c, planner reply to Checkpoint 7b, section 5): a kept player is never dropped; the memo keeps the runs apart, and a keep set with nobody on the roster is none", () => {
    // Dropping the bench RB (he never starts) or the FLEX WR for the 10-point free-agent WR gains the same 16; the tie goes
    // to the smaller id, the bench RB. Kept, the FLEX WR goes instead; both kept, nothing else gains enough: no move.
    const rows = [...team(), row("rb3", "RB", 2), row("fa-wr", "WR", 10)];
    const ids = [...TEAM_IDS, "rb3"];
    const opt = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"] }), CFG);
    const free = opt.optimize(ids);
    expect(free.moves).toEqual([{ add: "fa-wr", drop: "rb3", gainEv: 16 }]);
    const kept = opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, ["rb3"]);
    expect(kept.moves).toEqual([{ add: "fa-wr", drop: "wr2", gainEv: 16 }]);
    expect(kept.roster).toContain("rb3");
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, ["wr2", "rb3"]).moves).toEqual([]);
    // Memoized apart: the same keep set in any order is one entry; an empty one, or one holding nobody on the roster, is
    // the run without one (its very entry: the League model's runs keep their keys).
    expect(opt.optimize([...ids].reverse(), NO_STREAM, undefined, FULL_POOL, ["rb3", "rb3"])).toBe(kept);
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, [])).toBe(free);
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, ["fa-wr", "nobody"])).toBe(free);
    // A kept player the run never drops changes nothing (better() is a total order).
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, ["qb"]).moves).toEqual(free.moves);
  });

  it("the keep set in scenario-judged runs too (the scenario scan's drops)", () => {
    // The same league with every player playing in every scenario: scenario lineups are the EV ones, so the same tie.
    const S = 4;
    const scen = (r: TableRow): TableRow => ({ ...r, flags: new Uint8Array(S * r.ev.length).fill(1) });
    const rows = [...team(), row("rb3", "RB", 2), row("fa-wr", "WR", 10)].map(scen);
    const ids = [...TEAM_IDS, "rb3"];
    const opt = createOptimizer({ ...setupOf(rows, { freeAgents: ["fa-wr"] }), scenarios: S }, CFG);
    expect(opt.judgesScenarios).toBe(true);
    expect(opt.optimize(ids).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr", "rb3"]]);
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, ["rb3"]).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr", "wr2"]]);
    expect(opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, ["rb3", "wr2"]).moves).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Brute force: every move solved on its own (lineup.solveLineup per week), the rules applied literally.

/** Kuhn's matching: starting slots a set of players can fill (a reference for fillCount, without starter limits). */
function bruteFill(players: readonly { pos: Pos; eligible: readonly Pos[] }[], slots: PreparedSlots): number {
  const seats: number[] = [];
  slots.groups.forEach((g, gi) => {
    for (let c = 0; c < g.count; c++) seats.push(gi);
  });
  const owner = new Array<number>(seats.length).fill(-1);
  const fits = (p: { pos: Pos; eligible: readonly Pos[] }, s: number) => {
    const g = slots.groups[seats[s] as number];
    return !!g && (g.eligible.includes(p.pos) || p.eligible.some((e) => g.eligible.includes(e)));
  };
  const tryAssign = (pi: number, seen: boolean[]): boolean => {
    for (let s = 0; s < seats.length; s++) {
      if (seen[s] || !fits(players[pi] as { pos: Pos; eligible: readonly Pos[] }, s)) continue;
      seen[s] = true;
      if (owner[s] === -1 || tryAssign(owner[s] as number, seen)) {
        owner[s] = pi;
        return true;
      }
    }
    return false;
  };
  let n = 0;
  for (let pi = 0; pi < players.length; pi++) if (tryAssign(pi, new Array<boolean>(seats.length).fill(false))) n++;
  return n;
}

interface BruteSpec {
  rows: Map<string, TableRow>;
  slots: PreparedSlots;
  weights: Float64Array;
  freeAgents: string[];
  maxRosterSize: number;
  limits?: Partial<Record<Pos, number>>;
  values: Record<string, number>;
  dynasty: DynastyGuard | null;
  stream: StreamSpec;
  cfg: OptimizerConfig;
  ghosts: Record<string, Pos>;
  /** Starting slots the players can fill (default: bruteFill, which ignores starter limits). */
  fill?: (players: readonly { pos: Pos; eligible: readonly Pos[] }[]) => number;
}

type BruteMove = { add: string; drop: string | null; gain: number };

/** Brute force's pieces for a spec: ROS of any roster (each week solved on its own), positions, structural fill. */
function bruteTools(b: BruteSpec) {
  const W = b.weights.length;
  const ros = (ids: readonly string[]) => {
    const rows = [...ids.flatMap((id) => b.rows.get(id) ?? []), ...b.stream.rows];
    let total = 0;
    for (let w = 0; w < W; w++) total += (b.weights[w] as number) * solveLineup(rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible, points: r.ev[w] as number })), b.slots).total;
    return total;
  };
  const info = (id: string) => {
    const r = b.rows.get(id);
    return r ? { pos: r.pos, eligible: r.eligible } : b.ghosts[id] ? { pos: b.ghosts[id] as Pos, eligible: [b.ghosts[id] as Pos] } : undefined;
  };
  const fill = (ids: readonly string[]) => {
    const players = [...ids.flatMap((id) => info(id) ?? []), ...b.stream.rows];
    return b.fill ? b.fill(players) : bruteFill(players, b.slots);
  };
  const positions = (ids: readonly string[]) => ids.flatMap((id) => info(id)?.pos ?? []);
  return { ros, info, fill, positions };
}

/**
 * The best move from `roster` by brute force, the rules applied literally: every open-spot add (when `open`) and every
 * drop of a droppable player (only those `dropOnly` accepts, when given) for every candidate, each roster solved.
 */
function bruteBest(roster: readonly string[], added: ReadonlySet<string>, b: BruteSpec, open: boolean, dropOnly: ((id: string) => boolean) | null = null): BruteMove | null {
  const { ros, fill, positions: positionsOf } = bruteTools(b);
  const excluded = (pos: Pos) => b.cfg.optimizerExcluded.includes(pos) || b.stream.positions.includes(pos);
  const base = ros(roster);
  const fillBefore = fill(roster);
  const positions = positionsOf(roster);
  const cands = b.freeAgents.filter((id) => b.rows.has(id) && !roster.includes(id) && !added.has(id) && !excluded((b.rows.get(id) as TableRow).pos));
  const options: BruteMove[] = [];
  if (open && roster.length < b.maxRosterSize) {
    for (const a of cands) if (positionAllows(b.limits, positions, (b.rows.get(a) as TableRow).pos)) options.push({ add: a, drop: null, gain: ros([...roster, a]) - base });
  }
  for (const k of roster) {
    const kr = b.rows.get(k);
    if (!kr || excluded(kr.pos) || (dropOnly && !dropOnly(k))) continue;
    const left = [...positions];
    left.splice(left.indexOf(kr.pos), 1);
    for (const a of cands) {
      const ar = b.rows.get(a) as TableRow;
      if (!positionAllows(b.limits, left, ar.pos)) continue;
      if (b.dynasty && b.dynasty.value(k) - b.dynasty.value(a) > b.dynasty.maxDrop + 1e-9) continue;
      const after = applyStep(roster, { add: a, drop: k });
      if (fill(after) < fillBefore) continue;
      options.push({ add: a, drop: k, gain: ros(after) - base });
    }
  }
  let best: BruteMove | null = null;
  for (const o of options) {
    if (!(o.gain >= b.cfg.faMinGain - 1e-9)) continue;
    if (!best) {
      best = o;
      continue;
    }
    const d = o.gain - best.gain;
    if (Math.abs(d) > 1e-9) {
      if (d > 0) best = o;
      continue;
    }
    if ((o.drop === null) !== (best.drop === null)) {
      if (o.drop === null) best = o;
      continue;
    }
    if (o.drop !== null && best.drop !== null && o.drop !== best.drop) {
      const vo = b.values[o.drop] ?? 0;
      const vb = b.values[best.drop] ?? 0;
      if (vo !== vb ? vo < vb : o.drop < best.drop) best = o;
      continue;
    }
    if (o.add < best.add) best = o;
  }
  return best;
}

/** V* by brute force; `keep`: players never dropped (optimize's keep set: the drops are limited to the others). */
function bruteOptimize(start: string[], b: BruteSpec, keep: ReadonlySet<string> = new Set()): { roster: string[]; moves: BruteMove[] } {
  let roster = [...start];
  const added = new Set<string>();
  const moves: BruteMove[] = [];
  for (let step = 0; step < b.cfg.faMaxMoves; step++) {
    const best = bruteBest(roster, added, b, true, keep.size ? (id) => !keep.has(id) : null);
    if (!best) break;
    roster = applyStep(roster, best);
    added.add(best.add);
    moves.push(best);
  }
  return { roster, moves };
}

/**
 * reoptimize by brute force, its accounting applied literally (optimizer.ts header, "Re-running from an optimized
 * roster"): the pickups and who each one's move dropped, from `from`'s moves; free moves while at most faMaxMoves
 * pickups stay on the roster, `extra` more; a move that would hold one pickup too many is an exchange when giving back
 * some pickup (the one whose roster then scores most; ties: the smaller id; the player its move dropped comes back unless
 * gone, on the roster or over a position limit) beats not moving, else the best swap of a pickup, else the end; then each
 * open spot left by a player gone from `from`'s roster takes back a player a pickup's move dropped (the most ROS; ties:
 * the earliest move).
 */
function bruteReoptimize(
  from: { roster: readonly string[]; moves: readonly { add: string; drop: string | null }[] },
  start: readonly string[],
  b: BruteSpec,
  extra: number,
  gone: readonly string[] = [],
  keep: ReadonlySet<string> = new Set(),
): { roster: string[]; moves: BruteMove[]; given: { pickup: string | null; back: string | null }[] } {
  const { ros, positions: positionsOf, info } = bruteTools(b);
  const all = new Map<string, string | null>();
  for (const m of from.moves) {
    if (m.drop !== null && all.has(m.drop)) {
      all.set(m.add, all.get(m.drop) ?? null);
      all.delete(m.drop);
    } else all.set(m.add, m.drop);
  }
  const first = [...new Set(start)];
  const origin = new Map([...all].filter(([id]) => first.includes(id)));
  const cap = b.cfg.faMaxMoves;
  const limit = Math.max(0, cap - origin.size) + extra;
  let roster = [...first];
  const added = new Set<string>();
  const moves: BruteMove[] = [];
  const given: { pickup: string | null; back: string | null }[] = [];
  for (let step = 0; step < limit; step++) {
    // A keep set's players are never dropped, nor given back by an exchange (optimizer.ts, "The keep set").
    let move = bruteBest(roster, added, b, true, keep.size ? (id) => !keep.has(id) : null);
    if (!move) break;
    const grows = move.drop === null || !origin.has(move.drop);
    if (grows && origin.size + 1 > cap) {
      const made = applyStep(roster, move);
      const positions = positionsOf(made);
      let best: { w: string; back: string | null; roster: string[]; ros: number } | null = null;
      for (const [w, k] of origin) {
        if (!made.includes(w) || keep.has(w)) continue;
        const back = k !== null && !gone.includes(k) && !made.includes(k) ? k : null;
        if (back !== null) {
          const left = [...positions];
          const wPos = info(w)?.pos;
          if (wPos) left.splice(left.indexOf(wPos), 1);
          const bPos = info(back)?.pos;
          if (bPos && !positionAllows(b.limits, left, bPos)) continue;
        }
        const next = back === null ? made.filter((id) => id !== w) : made.map((id) => (id === w ? back : id));
        const r = ros(next);
        if (!best || r > best.ros + 1e-9 || (Math.abs(r - best.ros) <= 1e-9 && w < best.w)) best = { w, back, roster: next, ros: r };
      }
      if (best && best.ros > ros(roster) + 1e-9) {
        origin.set(move.add, move.drop);
        origin.delete(best.w);
        given.push({ pickup: best.w, back: best.back });
        added.add(move.add);
        moves.push(move);
        roster = best.roster;
        continue;
      }
      move = bruteBest(roster, added, b, false, (id) => origin.has(id) && !keep.has(id));
      if (!move) break;
    }
    if (move.drop !== null && origin.has(move.drop)) {
      origin.set(move.add, origin.get(move.drop) ?? null);
      origin.delete(move.drop);
    } else origin.set(move.add, move.drop);
    roster = applyStep(roster, move);
    added.add(move.add);
    moves.push(move);
  }
  for (let open = from.roster.length - first.length; open > 0 && roster.length < b.maxRosterSize; open--) {
    const positions = positionsOf(roster);
    let best: { w: string; k: string; ros: number } | null = null;
    for (const [w, k] of origin) {
      if (k === null || gone.includes(k) || roster.includes(k)) continue;
      const kPos = info(k)?.pos;
      if (kPos && !positionAllows(b.limits, positions, kPos)) continue;
      const r = ros([...roster, k]);
      if (!best || r > best.ros + 1e-9) best = { w, k, ros: r };
    }
    if (!best) break;
    origin.set(best.w, null);
    given.push({ pickup: null, back: best.k });
    roster = [...roster, best.k];
  }
  return { roster, moves, given };
}

const POSITIONS_RANDOM: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"];

describe("the free-agent optimizer against brute force (every move solved on its own)", () => {
  it("makes exactly the brute force's moves, in order, with its gains: 300 random small leagues (open spots, limits, streaming, ghosts, dynasty guard)", { timeout: 60_000 }, () => {
    const rand = mulberry32(2026);
    let movesSeen = 0;
    let opens = 0;
    let dropsGuarded = 0;
    for (let trial = 0; trial < 300; trial++) {
      const W = 4;
      const weights = Float64Array.from([1, 1, 1.25, rand() < 0.2 ? 0 : 1.25]);
      const slots = trial % 3 === 0 ? SUPERFLEX : trial % 3 === 1 ? STANDARD : SMALL;
      const mk = (id: string, scale: number): TableRow => {
        const pos = POSITIONS_RANDOM[Math.floor(rand() * POSITIONS_RANDOM.length)] as Pos;
        const ev = Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 200 * scale) / 10));
        return row(id, pos, ev, W, pos === "WR" && rand() < 0.2 ? ["WR", "RB"] : [pos]);
      };
      const n = 4 + Math.floor(rand() * 8);
      const roster = Array.from({ length: n }, (_, k) => mk(`r${k}`, 1));
      const pool = Array.from({ length: 4 + Math.floor(rand() * 8) }, (_, k) => mk(`f${k}`, 0.9));
      const ghosts: Record<string, Pos> = rand() < 0.3 ? { ghost: "RB" } : {};
      const ids = [...roster.map((r) => r.id), ...Object.keys(ghosts)];
      const maxRosterSize = ids.length + (rand() < 0.4 ? 1 + Math.floor(rand() * 2) : 0);
      const limits: Partial<Record<Pos, number>> | undefined = rand() < 0.4 ? { RB: 2 + Math.floor(rand() * 2), WR: 3, TE: 1 + Math.floor(rand() * 2) } : undefined;
      const stream: StreamSpec = rand() < 0.3 ? { rows: [streamRow("TE", [5, 6, 5, 6], 0)], positions: ["TE"] } : NO_STREAM;
      const values: Record<string, number> = Object.fromEntries([...roster, ...pool].map((r) => [r.id, Math.round(rand() * 1000)]));
      const dynasty: DynastyGuard | null = rand() < 0.3 ? { value: (id) => values[id] ?? 0, maxDrop: 300 } : null;
      const cfg: OptimizerConfig = { faMinGain: 2 + Math.floor(rand() * 4), faMaxMoves: 1 + Math.floor(rand() * 4), optimizerExcluded: rand() < 0.5 ? ["K", "DEF"] : [] };
      const rows = new Map([...roster, ...pool].map((r) => [r.id, r]));
      const setup: OptimizerSetup = {
        rows,
        weekCount: W,
        slots,
        weights,
        freeAgents: pool.map((r) => r.id),
        info: (id) => {
          const r = rows.get(id);
          return r ? { pos: r.pos, eligible: r.eligible } : ghosts[id] ? { pos: ghosts[id] as Pos, eligible: [ghosts[id] as Pos] } : undefined;
        },
        positionLimits: limits,
        maxRosterSize,
        dropValue: (id) => values[id] ?? 0,
        dynasty,
      };
      const got = createOptimizer(setup, cfg).optimize(ids, stream);
      const want = bruteOptimize(ids, { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, ...(limits ? { limits } : {}), values, dynasty, stream, cfg, ghosts });
      expect(
        got.moves.map((m) => [m.add, m.drop]),
        `trial ${trial}`,
      ).toEqual(want.moves.map((m) => [m.add, m.drop]));
      got.moves.forEach((m, i) => expect(m.gainEv, `trial ${trial} move ${i}`).toBeCloseTo(want.moves[i]?.gain as number, 6));
      expect(got.roster, `trial ${trial}`).toEqual(want.roster);
      movesSeen += got.moves.length;
      opens += got.moves.filter((m) => m.drop === null).length;
      if (dynasty) dropsGuarded++;
    }
    // The cases cover moves, open spots and the guard.
    expect(movesSeen).toBeGreaterThan(150);
    expect(opens).toBeGreaterThan(10);
    expect(dropsGuarded).toBeGreaterThan(30);
  });

  it("with a keep set (Phase 7c), makes exactly the brute force's moves with drops limited to the others: 200 random small leagues, the kept player one the free run drops", { timeout: 60_000 }, () => {
    const rand = mulberry32(7007);
    let kept = 0;
    let movesSeen = 0;
    for (let trial = 0; trial < 200; trial++) {
      const W = 4;
      const weights = Float64Array.from([1, 1, 1.25, 1.25]);
      const slots = trial % 2 === 0 ? STANDARD : SMALL;
      const mk = (id: string, scale: number): TableRow => {
        const pos = POSITIONS_RANDOM[Math.floor(rand() * POSITIONS_RANDOM.length)] as Pos;
        return row(id, pos, Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 200 * scale) / 10)), W);
      };
      const roster = Array.from({ length: 5 + Math.floor(rand() * 7) }, (_, k) => mk(`r${k}`, 1));
      const pool = Array.from({ length: 4 + Math.floor(rand() * 8) }, (_, k) => mk(`f${k}`, 0.9));
      const ids = roster.map((r) => r.id);
      const maxRosterSize = ids.length + (rand() < 0.3 ? 1 : 0);
      const limits: Partial<Record<Pos, number>> | undefined = rand() < 0.3 ? { RB: 2 + Math.floor(rand() * 2), WR: 3 } : undefined;
      const values: Record<string, number> = Object.fromEntries([...roster, ...pool].map((r) => [r.id, Math.round(rand() * 1000)]));
      const cfg: OptimizerConfig = { faMinGain: 2 + Math.floor(rand() * 4), faMaxMoves: 1 + Math.floor(rand() * 4), optimizerExcluded: ["K", "DEF"] };
      const rows = new Map([...roster, ...pool].map((r) => [r.id, r]));
      const setup: OptimizerSetup = { rows, weekCount: W, slots, weights, freeAgents: pool.map((r) => r.id), info: (id) => rows.get(id), positionLimits: limits, maxRosterSize, dropValue: (id) => values[id] ?? 0 };
      const opt = createOptimizer(setup, cfg);
      const free = opt.optimize(ids);
      // Keep the first player the free run drops (else a random one of the roster: the same moves, a run of its own).
      const keep = free.moves.find((m) => m.drop !== null)?.drop ?? (ids[Math.floor(rand() * ids.length)] as string);
      const got = opt.optimize(ids, NO_STREAM, undefined, FULL_POOL, [keep]);
      const want = bruteOptimize(ids, { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, ...(limits ? { limits } : {}), values, dynasty: null, stream: NO_STREAM, cfg, ghosts: {} }, new Set([keep]));
      expect(got.moves.map((m) => [m.add, m.drop]), `trial ${trial}`).toEqual(want.moves.map((m) => [m.add, m.drop]));
      expect(got.roster, `trial ${trial}`).toContain(keep);
      if (!free.moves.some((m) => m.drop === keep)) expect(got.moves, `trial ${trial}`).toEqual(free.moves);
      else kept++;
      movesSeen += got.moves.length;
    }
    // The cases cover a kept player the free run would have dropped.
    expect(kept).toBeGreaterThan(40);
    expect(movesSeen).toBeGreaterThan(100);
  });

  it("fillCount matches a plain bipartite matching (no starter limits): 300 random rosters", () => {
    const rand = mulberry32(5);
    for (let trial = 0; trial < 300; trial++) {
      const slots = trial % 2 === 0 ? SUPERFLEX : STANDARD;
      const players = Array.from({ length: Math.floor(rand() * 12) }, (_, k) => {
        const pos = POSITIONS_RANDOM[Math.floor(rand() * POSITIONS_RANDOM.length)] as Pos;
        return { id: `p${k}`, pos, eligible: pos === "WR" && rand() < 0.3 ? (["WR", "TE"] as Pos[]) : [pos] };
      });
      expect(fillCount(players, slots), `trial ${trial}`).toBe(bruteFill(players, slots));
    }
  });

  it("stays exact under starter limits (MFL), where only the relaxed-lineup bound screens free agents and every remaining move is solved: 80 random cases", { timeout: 60_000 }, () => {
    const lineup = [slot("QB", 1, ["QB"]), slot("FLEX", 4, ["RB", "WR", "TE"])];
    const slots = prepareSlots(lineup, { RB: { min: 1, max: 3 }, WR: { min: 1, max: 3 }, TE: { min: 1, max: 1 } });
    const rand = mulberry32(77);
    const positions: Pos[] = ["QB", "RB", "WR", "TE"];
    // The structural fill honors the starter maxima (a fourth RB fills no FLEX spot): this lineup's QB slot takes QBs only.
    const count = (players: readonly { pos: Pos }[], pos: Pos) => players.filter((p) => p.pos === pos).length;
    const limitedFill = (players: readonly { pos: Pos; eligible: readonly Pos[] }[]) =>
      Math.min(1, count(players, "QB")) + Math.min(4, Math.min(3, count(players, "RB")) + Math.min(3, count(players, "WR")) + Math.min(1, count(players, "TE")));
    let moves = 0;
    let guarded = 0;
    for (let trial = 0; trial < 80; trial++) {
      const W = 3;
      const mk = (id: string): TableRow => row(id, positions[Math.floor(rand() * positions.length)] as Pos, Array.from({ length: W }, () => (rand() < 0.25 ? 0 : Math.round(rand() * 200) / 10)), W);
      const roster = Array.from({ length: 3 + Math.floor(rand() * 5) }, (_, k) => mk(`r${k}`));
      const pool = Array.from({ length: 5 }, (_, k) => mk(`f${k}`));
      const rows = new Map([...roster, ...pool].map((r) => [r.id, r]));
      const cfg: OptimizerConfig = { faMinGain: 2, faMaxMoves: 3, optimizerExcluded: [] };
      const weights = Float64Array.from([1, 1, 1]);
      const maxRosterSize = roster.length + (trial % 2);
      const setup: OptimizerSetup = { rows, weekCount: W, slots, weights, freeAgents: pool.map((r) => r.id), info: (id) => rows.get(id), maxRosterSize, dropValue: () => 0 };
      const ids = roster.map((r) => r.id);
      const got = createOptimizer(setup, cfg).optimize(ids);
      const want = bruteOptimize(ids, { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, values: {}, dynasty: null, stream: NO_STREAM, cfg, ghosts: {}, fill: limitedFill });
      expect(got.moves.map((m) => [m.add, m.drop]), `trial ${trial}`).toEqual(want.moves.map((m) => [m.add, m.drop]));
      moves += got.moves.length;
      // How often the guard decides: the brute force without it would have moved differently.
      const unguarded = bruteOptimize(ids, { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, values: {}, dynasty: null, stream: NO_STREAM, cfg, ghosts: {}, fill: () => 0 });
      if (JSON.stringify(unguarded.moves) !== JSON.stringify(want.moves)) guarded++;
      expect(fillCount(roster.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible })), slots), `trial ${trial}`).toBe(limitedFill(roster));
    }
    expect(moves).toBeGreaterThan(20);
    expect(guarded).toBeGreaterThan(0);
  });

  it("stays exact under starter limits with many players of each kind: the dominance shortlists and the relaxed-lineup bounds change no move (60 random cases)", { timeout: 120_000 }, () => {
    // Few weeks with flat-ish points, so many free agents (and roster players) of one position are dominated by another.
    const lineup = [slot("QB", 1, ["QB"]), slot("FLEX", 4, ["RB", "WR", "TE"])];
    const slots = prepareSlots(lineup, { RB: { min: 1, max: 3 }, WR: { min: 1, max: 3 }, TE: { min: 1, max: 1 } });
    const rand = mulberry32(991);
    const positions: Pos[] = ["QB", "RB", "WR", "TE"];
    const count = (players: readonly { pos: Pos }[], pos: Pos) => players.filter((p) => p.pos === pos).length;
    const limitedFill = (players: readonly { pos: Pos; eligible: readonly Pos[] }[]) =>
      Math.min(1, count(players, "QB")) + Math.min(4, Math.min(3, count(players, "RB")) + Math.min(3, count(players, "WR")) + Math.min(1, count(players, "TE")));
    let moves = 0;
    let solved = 0;
    let candidatesTimesDrops = 0;
    for (let trial = 0; trial < 60; trial++) {
      const W = 3;
      const mk = (id: string, scale: number): TableRow => {
        const base = Math.round(rand() * 150 * scale) / 10;
        return row(id, positions[Math.floor(rand() * positions.length)] as Pos, Array.from({ length: W }, () => (rand() < 0.1 ? 0 : Math.max(0, base + Math.round((rand() - 0.5) * 20) / 10))), W);
      };
      const roster = Array.from({ length: 5 + Math.floor(rand() * 4) }, (_, k) => mk(`r${k}`, 1));
      const pool = Array.from({ length: 10 + Math.floor(rand() * 6) }, (_, k) => mk(`f${k}`, 1));
      const rows = new Map([...roster, ...pool].map((r) => [r.id, r]));
      const values: Record<string, number> = Object.fromEntries([...roster, ...pool].map((r) => [r.id, Math.round(rand() * 1000)]));
      const cfg: OptimizerConfig = { faMinGain: 2, faMaxMoves: 3, optimizerExcluded: [] };
      const weights = Float64Array.from([1, 1, 1.25]);
      const maxRosterSize = roster.length + (trial % 3 === 0 ? 1 : 0);
      const dynasty: DynastyGuard | null = trial % 4 === 0 ? { value: (id) => values[id] ?? 0, maxDrop: 250 } : null;
      const setup: OptimizerSetup = { rows, weekCount: W, slots, weights, freeAgents: pool.map((r) => r.id), info: (id) => rows.get(id), maxRosterSize, dropValue: (id) => values[id] ?? 0, dynasty };
      const ids = roster.map((r) => r.id);
      const opt = createOptimizer(setup, cfg);
      const got = opt.optimize(ids);
      const want = bruteOptimize(ids, { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, values, dynasty, stream: NO_STREAM, cfg, ghosts: {}, fill: limitedFill });
      expect(got.moves.map((m) => [m.add, m.drop]), `trial ${trial}`).toEqual(want.moves.map((m) => [m.add, m.drop]));
      got.moves.forEach((m, i) => expect(m.gainEv, `trial ${trial} move ${i}`).toBeCloseTo(want.moves[i]?.gain as number, 6));
      moves += got.moves.length;
      solved += opt.stats.dropsSolved;
      candidatesTimesDrops += (got.moves.length + 1) * roster.length;
    }
    expect(moves).toBeGreaterThan(30);
    // The shortlists and bounds leave most drops unsolved: fewer drop solves than one per droppable player per step.
    expect(solved).toBeLessThan(candidatesTimesDrops);
  });
});

describe("re-running from an optimized roster (reoptimize; the file header; review of track A2)", () => {
  /** QB 20, RBs 15 and 12, WR 14, TE 8, a 9-point WR in the FLEX (the TE never moves there), K 7, a bench QB 12 and a bench RB 1. */
  const roster = (): TableRow[] => [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 8), row("wr2", "WR", 9), row("k", "K", 7), row("qb2", "QB", 12), row("b1", "RB", 1)];
  const IDS = ["qb", "rb1", "rb2", "wr1", "te", "wr2", "k", "qb2", "b1"];
  const capped: OptimizerConfig = { ...CFG, faMaxMoves: 2 };

  it("at the cap, replacing a lost starter is an exchange: made only when it beats the cheapest pickup, which goes", () => {
    // V*: a 13-point WR takes the FLEX (+4 a week) and an 11-point TE the TE (+3, the 8-point TE to the bench), both into
    // open spots. Losing the QB: a 16-point free-agent QB is +4 a week over the 12-point backup, more than the TE pickup.
    const fas = (qb: number) => [row("fa-wr", "WR", 13), row("fa-te", "TE", 11), row("fa-qb", "QB", qb)];
    const opt = (qb: number) => createOptimizer(setupOf([...roster(), ...fas(qb)], { freeAgents: ["fa-wr", "fa-te", "fa-qb"], maxRosterSize: 12 }), capped);
    const o16 = opt(16);
    const from = o16.optimize(IDS);
    expect(from.moves).toEqual([
      { add: "fa-wr", drop: null, gainEv: 16 },
      { add: "fa-te", drop: null, gainEv: 12 },
    ]);
    const lost = from.roster.filter((id) => id !== "qb");
    const r = o16.reoptimize(from, lost, NO_STREAM, 1, ["qb"]);
    expect(r.moves).toEqual([{ add: "fa-qb", drop: null, gainEv: 16 - 12 }]);
    expect(r.given).toEqual([{ pickup: "fa-te", back: null }]);
    expect(r.roster.slice().sort()).toEqual([...lost.filter((id) => id !== "fa-te"), "fa-qb"].sort());
    // The roster a run from scratch from T − QB ends with (its two best moves), and the same ROS.
    const scratch = o16.optimize(IDS.filter((id) => id !== "qb"));
    expect(scratch.roster.slice().sort()).toEqual(r.roster.slice().sort());
    expect(r.evRos).toBeCloseTo(scratch.evRos, 9);
    // A 14-point free agent (+2 a week, less than the TE pickup's +3): no exchange, and no swap pays: nothing changes.
    const o14 = opt(14);
    const from14 = o14.optimize(IDS);
    const r14 = o14.reoptimize(from14, from14.roster.filter((id) => id !== "qb"), NO_STREAM, 1, ["qb"]);
    expect(r14.moves).toEqual([]);
    expect(r14.given).toEqual([]);
    expect(o14.optimize(IDS.filter((id) => id !== "qb")).moves.map((m) => m.add).sort()).toEqual(["fa-te", "fa-wr"]);
    // Below the cap the replacement is free: one move left.
    const roomy = createOptimizer(setupOf([...roster(), ...fas(16)], { freeAgents: ["fa-wr", "fa-te", "fa-qb"], maxRosterSize: 12 }), CFG);
    const fromRoomy = roomy.optimize(IDS);
    expect(roomy.reoptimize(fromRoomy, fromRoomy.roster.filter((id) => id !== "qb"), NO_STREAM, 1).given).toEqual([]);
    expect(roomy.rerunMoves(fromRoomy, fromRoomy.roster, 1)).toBe(CFG.faMaxMoves - 2 + 1);
    expect(o16.rerunMoves(from, lost, 1)).toBe(1);
  });

  it("a swap of a pickup the newcomer made redundant is free (it adds no pickup), as a run from scratch would choose", () => {
    // The QB is off in weeks 2 and 3: V* (one move) picks up a 10-point QB for them (+20), over a 9-point TE (+12: TE 9,
    // the 8-point TE to the FLEX over the 6-point WR). An 18-point QB arrives: the QB pickup never plays again, so it is
    // swapped for the TE.
    const rows = [row("qb", "QB", [20, 0, 0, 20]), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 8), row("wr2", "WR", 6), row("k", "K", 7), row("fa-qb", "QB", 10), row("fa-te", "TE", 9), row("new-qb", "QB", 18)];
    const ids = ["qb", "rb1", "rb2", "wr1", "te", "wr2", "k"];
    const o = createOptimizer(setupOf(rows, { freeAgents: ["fa-qb", "fa-te"], maxRosterSize: 9, dropValue: (id) => (id === "wr2" ? 500 : 0) }), { ...CFG, faMaxMoves: 1 });
    const from = o.optimize(ids);
    expect(from.moves).toEqual([{ add: "fa-qb", drop: null, gainEv: 20 }]);
    const r = o.reoptimize(from, [...from.roster, "new-qb"], NO_STREAM, 1);
    expect(r.moves).toEqual([{ add: "fa-te", drop: "fa-qb", gainEv: 12 }]);
    expect(r.given).toEqual([]);
    expect(o.optimize([...ids, "new-qb"]).roster.slice().sort()).toEqual(r.roster.slice().sort());
    // The base hint (a roster the start contains) only speeds the first step up: the same run.
    const hinted = createOptimizer(setupOf(rows, { freeAgents: ["fa-qb", "fa-te"], maxRosterSize: 9, dropValue: (id) => (id === "wr2" ? 500 : 0) }), { ...CFG, faMaxMoves: 1 });
    const h = hinted.reoptimize(hinted.optimize(ids), [...from.roster, "new-qb"], NO_STREAM, 1, [], from.roster);
    expect(h.moves).toEqual(r.moves);
    expect(h.roster).toEqual(r.roster);
  });

  it("the spot a lost player leaves takes back a player a pickup's move dropped (as from scratch: the pickup goes into the spot), never one who is gone", () => {
    // Full at 8: V* swaps the 1-point bench RB (the least valuable) for a 10-point WR in the FLEX. Losing the 15-point RB
    // opens a spot: the bench RB comes back and starts (no free agent left to take it).
    const rows = [...team(), row("b1", "RB", 5), row("fa-wr", "WR", 10)];
    const ids = [...TEAM_IDS, "b1"];
    const o = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"], maxRosterSize: 8, dropValue: (id) => (id === "b1" ? 100 : 200) }), CFG);
    const from = o.optimize(ids);
    expect(from.moves).toEqual([{ add: "fa-wr", drop: "b1", gainEv: 16 }]);
    const lost = from.roster.filter((id) => id !== "rb1");
    const r = o.reoptimize(from, lost, NO_STREAM, 1, ["rb1"]);
    expect(r.moves).toEqual([]);
    expect(r.given).toEqual([{ pickup: null, back: "b1" }]);
    expect(r.roster.slice().sort()).toEqual([...lost, "b1"].sort());
    expect(o.optimize(ids.filter((id) => id !== "rb1")).roster.slice().sort()).toEqual(r.roster.slice().sort());
    // Gone (traded away too): he can't come back.
    expect(o.reoptimize(from, lost, NO_STREAM, 1, ["rb1", "b1"]).given).toEqual([]);
    // With the optimizer off (faMaxMoves 0) a re-run moves nothing: no pickup, nobody given back.
    const off = createOptimizer(setupOf([...roster(), row("fa-qb", "QB", 19)], { freeAgents: ["fa-qb"], maxRosterSize: 12 }), { ...CFG, faMaxMoves: 0 });
    const none = off.optimize(IDS);
    expect(none.moves).toEqual([]);
    const after = off.reoptimize(none, IDS.filter((id) => id !== "qb"), NO_STREAM, 1, ["qb"]);
    expect(after.moves).toEqual([]);
    expect(after.given).toEqual([]);
  });

  it("matches a brute force of its accounting: 200 random small leagues, after a loss, two losses and a newcomer (open spots, limits, streaming, ghosts, dynasty guard)", { timeout: 120_000 }, () => {
    const rand = mulberry32(4242);
    let exchanges = 0;
    let swaps = 0;
    let backs = 0;
    for (let trial = 0; trial < 200; trial++) {
      const W = 4;
      const weights = Float64Array.from([1, 1, 1.25, rand() < 0.2 ? 0 : 1.25]);
      const slots = trial % 3 === 0 ? SUPERFLEX : trial % 3 === 1 ? STANDARD : SMALL;
      const mk = (id: string, scale: number): TableRow => {
        const pos = POSITIONS_RANDOM[Math.floor(rand() * POSITIONS_RANDOM.length)] as Pos;
        const ev = Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 200 * scale) / 10));
        return row(id, pos, ev, W, pos === "WR" && rand() < 0.2 ? ["WR", "RB"] : [pos]);
      };
      const n = 5 + Math.floor(rand() * 7);
      const own = Array.from({ length: n }, (_, k) => mk(`r${k}`, 1));
      const pool = Array.from({ length: 5 + Math.floor(rand() * 8) }, (_, k) => mk(`f${k}`, 0.9));
      const outsiders = Array.from({ length: 2 }, (_, k) => mk(`o${k}`, 1.1));
      const ghosts: Record<string, Pos> = rand() < 0.2 ? { ghost: "RB" } : {};
      const ids = [...own.map((r) => r.id), ...Object.keys(ghosts)];
      const maxRosterSize = ids.length + (rand() < 0.5 ? Math.floor(rand() * 3) : 0);
      const limits: Partial<Record<Pos, number>> | undefined = rand() < 0.4 ? { RB: 2 + Math.floor(rand() * 2), WR: 3, TE: 1 + Math.floor(rand() * 2), QB: 2 } : undefined;
      const stream: StreamSpec = rand() < 0.25 ? { rows: [streamRow("TE", [5, 6, 5, 6], 0)], positions: ["TE"] } : NO_STREAM;
      const values: Record<string, number> = Object.fromEntries([...own, ...pool, ...outsiders].map((r) => [r.id, Math.round(rand() * 1000)]));
      const dynasty: DynastyGuard | null = rand() < 0.25 ? { value: (id) => values[id] ?? 0, maxDrop: 300 } : null;
      const cfg: OptimizerConfig = { faMinGain: 2 + Math.floor(rand() * 3), faMaxMoves: 1 + Math.floor(rand() * 3), optimizerExcluded: rand() < 0.5 ? ["K", "DEF"] : [] };
      const rows = new Map([...own, ...pool, ...outsiders].map((r) => [r.id, r]));
      const info = (id: string) => {
        const r = rows.get(id);
        return r ? { pos: r.pos, eligible: r.eligible } : ghosts[id] ? { pos: ghosts[id] as Pos, eligible: [ghosts[id] as Pos] } : undefined;
      };
      const setup: OptimizerSetup = { rows, weekCount: W, slots, weights, freeAgents: pool.map((r) => r.id), info, positionLimits: limits, maxRosterSize, dropValue: (id) => values[id] ?? 0, dynasty };
      const spec: BruteSpec = { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, ...(limits ? { limits } : {}), values, dynasty, stream, cfg, ghosts };
      const opt = createOptimizer(setup, cfg);
      const from = opt.optimize(ids, stream);
      const modeled = from.roster.filter((id) => rows.has(id));
      const pickOne = () => modeled[Math.floor(rand() * modeled.length)] as string;
      const cases: { start: string[]; extra: number; gone: string[]; base?: string[] }[] = [];
      if (modeled.length) {
        const i = pickOne();
        cases.push({ start: from.roster.filter((id) => id !== i), extra: 1, gone: [i] });
        const k = pickOne();
        if (k !== i) cases.push({ start: from.roster.filter((id) => id !== i && id !== k), extra: 2, gone: [i, k] });
        // A newcomer: into an open spot, or for a player who makes room.
        const j = (outsiders[Math.floor(rand() * outsiders.length)] as TableRow).id;
        const base = from.roster.length < maxRosterSize ? [...from.roster] : from.roster.filter((id) => id !== pickOne());
        if (positionAllows(limits, base.flatMap((id) => info(id)?.pos ?? []), (rows.get(j) as TableRow).pos)) cases.push({ start: [...base, j], extra: 1, gone: [], base });
      }
      for (const c of cases) {
        const got = opt.reoptimize(from, c.start, stream, c.extra, c.gone, c.base);
        const want = bruteReoptimize(from, c.start, spec, c.extra, c.gone);
        const label = `trial ${trial}: ${JSON.stringify(c)}`;
        expect(got.moves.map((m) => [m.add, m.drop]), label).toEqual(want.moves.map((m) => [m.add, m.drop]));
        expect(got.given, label).toEqual(want.given);
        expect(got.roster.slice().sort(), label).toEqual(want.roster.slice().sort());
        exchanges += got.given.filter((g) => g.pickup !== null).length;
        backs += got.given.filter((g) => g.pickup === null).length;
        swaps += got.moves.filter((m) => m.drop !== null && from.moves.some((x) => x.add === m.drop)).length;
      }
    }
    // The cases cover exchanges, swaps of pickups and players coming back into open spots.
    expect(exchanges).toBeGreaterThan(5);
    expect(swaps).toBeGreaterThan(2);
    expect(backs).toBeGreaterThan(5);
  });

  it("the keep set (Checkpoint 7e, planner reply to Checkpoint 7d, item 3.3: my untouchables in the League model's re-runs): a kept player is never dropped; the memo keeps the runs apart, and a keep set with nobody on the roster is none", () => {
    // From the team before any move, a re-run makes the very move a run from scratch does: the 10-point free-agent WR for the
    // bench RB (a tie with the FLEX WR, to the smaller id). Kept, the FLEX WR goes instead; both kept, no move.
    const rows = [...team(), row("rb3", "RB", 2), row("fa-wr", "WR", 10)];
    const ids = [...TEAM_IDS, "rb3"];
    const opt = createOptimizer(setupOf(rows, { freeAgents: ["fa-wr"] }), CFG);
    const from = opt.optimize(ids, NO_STREAM, 0);
    const free = opt.reoptimize(from, ids, NO_STREAM, 1);
    expect(free.moves).toEqual([{ add: "fa-wr", drop: "rb3", gainEv: 16 }]);
    const kept = opt.reoptimize(from, ids, NO_STREAM, 1, [], undefined, FULL_POOL, ["rb3"]);
    expect(kept.moves).toEqual([{ add: "fa-wr", drop: "wr2", gainEv: 16 }]);
    expect(kept.roster).toContain("rb3");
    expect(opt.reoptimize(from, ids, NO_STREAM, 1, [], undefined, FULL_POOL, ["wr2", "rb3"]).moves).toEqual([]);
    // Memoized apart: the same keep set in any order is one entry; an empty one, or one holding nobody on the roster, is the
    // run without one (its very entry).
    expect(opt.reoptimize(from, [...ids].reverse(), NO_STREAM, 1, [], undefined, FULL_POOL, ["rb3", "rb3"])).toBe(kept);
    expect(opt.reoptimize(from, ids, NO_STREAM, 1, [], undefined, FULL_POOL, [])).toBe(free);
    expect(opt.reoptimize(from, ids, NO_STREAM, 1, [], undefined, FULL_POOL, ["fa-wr", "nobody"])).toBe(free);
  });

  it("an exchange never gives a kept pickup back (a caller's keep set may name one)", () => {
    // The first test's exchange: losing the QB, a 16-point free-agent QB comes in for the TE pickup, the cheaper one. With
    // that pickup kept, giving back the WR pickup instead would gain nothing (+4 a week for the QB, −4 for the WR), and no
    // swap pays: no move.
    const fas = [row("fa-wr", "WR", 13), row("fa-te", "TE", 11), row("fa-qb", "QB", 16)];
    const roster = [row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("te", "TE", 8), row("wr2", "WR", 9), row("k", "K", 7), row("qb2", "QB", 12), row("b1", "RB", 1)];
    const ids = ["qb", "rb1", "rb2", "wr1", "te", "wr2", "k", "qb2", "b1"];
    const o = createOptimizer(setupOf([...roster, ...fas], { freeAgents: ["fa-wr", "fa-te", "fa-qb"], maxRosterSize: 12 }), { ...CFG, faMaxMoves: 2 });
    const from = o.optimize(ids);
    const lost = from.roster.filter((id) => id !== "qb");
    expect(o.reoptimize(from, lost, NO_STREAM, 1, ["qb"]).given).toEqual([{ pickup: "fa-te", back: null }]);
    const r = o.reoptimize(from, lost, NO_STREAM, 1, ["qb"], undefined, FULL_POOL, ["fa-te"]);
    expect(r.moves).toEqual([]);
    expect(r.given).toEqual([]);
    expect(r.roster).toEqual(lost);
  });

  it("with a keep set, matches the brute force's accounting with drops limited to the others: 400 random small leagues, after a loss and with a newcomer", { timeout: 120_000 }, () => {
    const rand = mulberry32(7317);
    let keptDrops = 0;
    for (let trial = 0; trial < 400; trial++) {
      const W = 4;
      const weights = Float64Array.from([1, 1, 1.25, rand() < 0.2 ? 0 : 1.25]);
      const slots = trial % 3 === 0 ? SUPERFLEX : trial % 3 === 1 ? STANDARD : SMALL;
      const mk = (id: string, scale: number): TableRow => {
        const pos = POSITIONS_RANDOM[Math.floor(rand() * POSITIONS_RANDOM.length)] as Pos;
        const ev = Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 200 * scale) / 10));
        return row(id, pos, ev, W, pos === "WR" && rand() < 0.2 ? ["WR", "RB"] : [pos]);
      };
      const n = 5 + Math.floor(rand() * 7);
      const own = Array.from({ length: n }, (_, k) => mk(`r${k}`, 1));
      // Free agents about as good as the team's players, so re-runs often drop one of its own.
      const pool = Array.from({ length: 5 + Math.floor(rand() * 8) }, (_, k) => mk(`f${k}`, 1.1));
      const outsiders = Array.from({ length: 2 }, (_, k) => mk(`o${k}`, 1.1));
      const ids = own.map((r) => r.id);
      const maxRosterSize = ids.length + (rand() < 0.5 ? Math.floor(rand() * 3) : 0);
      const limits: Partial<Record<Pos, number>> | undefined = rand() < 0.4 ? { RB: 2 + Math.floor(rand() * 2), WR: 3, TE: 1 + Math.floor(rand() * 2), QB: 2 } : undefined;
      const values: Record<string, number> = Object.fromEntries([...own, ...pool, ...outsiders].map((r) => [r.id, Math.round(rand() * 1000)]));
      const cfg: OptimizerConfig = { faMinGain: 2 + Math.floor(rand() * 3), faMaxMoves: 1 + Math.floor(rand() * 3), optimizerExcluded: rand() < 0.5 ? ["K", "DEF"] : [] };
      const rows = new Map([...own, ...pool, ...outsiders].map((r) => [r.id, r]));
      const info = (id: string) => {
        const r = rows.get(id);
        return r ? { pos: r.pos, eligible: r.eligible } : undefined;
      };
      const setup: OptimizerSetup = { rows, weekCount: W, slots, weights, freeAgents: pool.map((r) => r.id), info, positionLimits: limits, maxRosterSize, dropValue: (id) => values[id] ?? 0, dynasty: null };
      const spec: BruteSpec = { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, ...(limits ? { limits } : {}), values, dynasty: null, stream: NO_STREAM, cfg, ghosts: {} };
      const opt = createOptimizer(setup, cfg);
      const from = opt.optimize(ids);
      // The team's own players a free re-run would drop are the ones worth keeping: one of them (or any of its players).
      const own0 = from.roster.filter((id) => ids.includes(id));
      const pick = () => own0[Math.floor(rand() * own0.length)] as string;
      const cases: { start: string[]; extra: number; gone: string[]; base?: string[] }[] = [];
      if (own0.length) {
        const i = pick();
        cases.push({ start: from.roster.filter((id) => id !== i), extra: 1, gone: [i] });
        const j = (outsiders[Math.floor(rand() * outsiders.length)] as TableRow).id;
        const base = from.roster.length < maxRosterSize ? [...from.roster] : from.roster.filter((id) => id !== pick());
        if (positionAllows(limits, base.flatMap((id) => info(id)?.pos ?? []), (rows.get(j) as TableRow).pos)) cases.push({ start: [...base, j], extra: 1, gone: [], base });
      }
      for (const c of cases) {
        const freeRun = opt.reoptimize(from, c.start, NO_STREAM, c.extra, c.gone, c.base);
        const droppedOwn = freeRun.moves.flatMap((m) => (m.drop !== null && ids.includes(m.drop) ? [m.drop] : []));
        const candidates = c.start.filter((id) => ids.includes(id));
        const keep = droppedOwn.length ? [droppedOwn[0] as string] : candidates.length ? [candidates[Math.floor(rand() * candidates.length)] as string] : [];
        if (!keep.length) continue;
        const got = opt.reoptimize(from, c.start, NO_STREAM, c.extra, c.gone, c.base, FULL_POOL, keep);
        const want = bruteReoptimize(from, c.start, spec, c.extra, c.gone, new Set(keep));
        const label = `trial ${trial}: ${JSON.stringify({ ...c, keep })}`;
        expect(got.moves.map((m) => [m.add, m.drop]), label).toEqual(want.moves.map((m) => [m.add, m.drop]));
        expect(got.given, label).toEqual(want.given);
        expect(got.roster.slice().sort(), label).toEqual(want.roster.slice().sort());
        for (const id of keep) expect(got.roster, label).toContain(id);
        if (droppedOwn.length) keptDrops++;
      }
    }
    // Many cases keep the very player the free re-run drops.
    expect(keptDrops).toBeGreaterThan(20);
  });
});
