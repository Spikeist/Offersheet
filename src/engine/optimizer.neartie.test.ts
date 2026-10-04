/**
 * Near-ties in whom the free-agent optimizer's move cuts (optimizer.ts's header; verification of the final review of
 * Phase 4c, finding VF-1; OptimizerSetup.dropNearTie and dropValueFloor): when the best move cuts a player worth more than
 * the waiver credit W, its free agent comes in instead for the droppable player worth least (values floored at W) whose
 * swap gains at least the best move's gain − the tolerance (and more than 0), so a pickup never costs a player's trade
 * value for lineup noise. Against brute force (every move priced on its own, the rule applied literally), in EV and in
 * scenario lineups, whole runs and re-runs; greedy determinism with a restricted pool. Made-up rows (CLAUDE.md §16).
 */
import { describe, expect, it } from "vitest";
import { prepareSlots, solveLineup, type PreparedSlots } from "./lineup";
import type { Pos, SlotDef } from "./model";
import { NO_STREAM, applyStep, createOptimizer, fillCount, poolRestriction, type OptimizerConfig, type OptimizerSetup, type StreamSpec } from "./optimizer";
import { weeklySd } from "./projections";
import { mulberry32 } from "./rng";
import { positionAllows, rosValue, scenarioValues, solveEvWeeks, streamRow, teamEval, type TableRow } from "./teamValue";
import { TEST_LINEUP } from "./testLeague";

const EPS = 1e-9;
const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const SMALL = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 1, ["WR"]), slot("TE", 1, ["TE"]), slot("FLEX", 1, ["RB", "WR", "TE"]), slot("K", 1, ["K"])]);
const STANDARD = prepareSlots(TEST_LINEUP);
const SUPERFLEX = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 1, ["RB"]), slot("WR", 2, ["WR"]), slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"]), slot("TE", 1, ["TE"])]);
const CFG: OptimizerConfig = { faMinGain: 3, faMaxMoves: 5, optimizerExcluded: ["K", "DEF"] };

/** A row with these points per week; with `scenarios`, playing every scenario (so its scenario lineups are its EV lineups). */
function row(id: string, pos: Pos, pts: number | number[], scenarios = 0, W = 4): TableRow {
  const ev = Float64Array.from(typeof pts === "number" ? new Array<number>(W).fill(pts) : pts);
  return { id, pos, eligible: [pos], cond: Float64Array.from(ev), ev, condSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags: scenarios > 0 ? new Uint8Array(scenarios * ev.length).fill(1) : null };
}

describe("near-ties in whom a move cuts (VF-1)", () => {
  // QB 20, RBs 15 and 12 (the RB2 on bye in week 3), WR 14 (on bye in week 2), a 9-point FLEX WR worth 9,000, TE 8, K 7;
  // the bench: a 3-point RB worth 300 who starts in the RB2's bye, and a 2.9-point RB worth 5,000 (a stash) who never starts.
  // An 11-point free-agent WR takes the FLEX (and the WR slot in the WR's bye): cutting the stash gains 14, the cheap RB
  // 13.9 (the stash fills the bye at 2.9, 0.1 less), the FLEX WR 8 (he's the WR in week 2).
  const team = (S = 0) => [
    row("qb", "QB", 20, S),
    row("rb1", "RB", 15, S),
    row("rb2", "RB", [12, 12, 0, 12], S),
    row("wr1", "WR", [14, 0, 14, 14], S),
    row("wr2", "WR", 9, S),
    row("te", "TE", 8, S),
    row("k", "K", 7, S),
    row("cheap", "RB", 3, S),
    row("stash", "RB", 2.9, S),
  ];
  const IDS = ["qb", "rb1", "rb2", "wr1", "wr2", "te", "k", "cheap", "stash"];
  const VALUES: Record<string, number> = { cheap: 300, stash: 5000, wr2: 9000, "fa-wr": 100 };
  const setupOf = (opts: { tie?: number; floor?: number; S?: number } = {}): OptimizerSetup => {
    const rows = new Map([...team(opts.S ?? 0), row("fa-wr", "WR", 11, opts.S ?? 0)].map((r) => [r.id, r]));
    return {
      rows,
      weekCount: 4,
      slots: SMALL,
      weights: new Float64Array(4).fill(1),
      freeAgents: ["fa-wr"],
      info: (id) => rows.get(id),
      maxRosterSize: 9,
      dropValue: (id) => VALUES[id] ?? 0,
      ...(opts.tie !== undefined ? { dropNearTie: opts.tie } : {}),
      ...(opts.floor !== undefined ? { dropValueFloor: opts.floor } : {}),
      ...(opts.S ? { scenarios: opts.S } : {}),
    };
  };
  const firstMove = (opts: Parameters<typeof setupOf>[0], cfg: OptimizerConfig = CFG) => createOptimizer(setupOf(opts), cfg).optimize(IDS, NO_STREAM, 1).moves[0];

  it("without a tolerance the lineup decides: the stash goes (+14)", () => {
    expect(firstMove({})).toEqual({ add: "fa-wr", drop: "stash", gainEv: expect.closeTo(14, 9) });
    expect(firstMove({ tie: 0, floor: 900 })).toEqual({ add: "fa-wr", drop: "stash", gainEv: expect.closeTo(14, 9) });
  });

  it("within the tolerance the cheaper player goes: the stash stays for 0.1 lineup point", () => {
    expect(firstMove({ tie: 0.5, floor: 900 })).toEqual({ add: "fa-wr", drop: "cheap", gainEv: expect.closeTo(13.9, 9) });
    // Exactly at the tolerance (float noise counts as within it), and just under it.
    expect(firstMove({ tie: 0.1, floor: 900 })?.drop).toBe("cheap");
    expect(firstMove({ tie: 0.09, floor: 900 })?.drop).toBe("stash");
    // Never the FLEX WR (worth 9,000, more than the stash) however wide the tolerance: only a cheaper player can take the cut.
    expect(firstMove({ tie: 100, floor: 900 })?.drop).toBe("cheap");
  });

  it("values floored at W: when both are worth at most W the lineup decides, as without a tolerance", () => {
    expect(firstMove({ tie: 0.5, floor: 6000 })?.drop).toBe("stash");
    // Without a floor the raw values decide (W 0).
    expect(firstMove({ tie: 0.5 })?.drop).toBe("cheap");
  });

  it("the best move decides whether to move: its near-tie may gain less than faMinGain", () => {
    // faMinGain 13.95: the stash's move (+14) qualifies, the cheap RB's (+13.9) alone wouldn't; it's made all the same.
    const strict: OptimizerConfig = { ...CFG, faMinGain: 13.95 };
    expect(firstMove({ tie: 0.5, floor: 900 }, strict)).toEqual({ add: "fa-wr", drop: "cheap", gainEv: expect.closeTo(13.9, 9) });
    // And when no move qualifies, none is made.
    expect(firstMove({ tie: 0.5, floor: 900 }, { ...CFG, faMinGain: 14.5 })).toBeUndefined();
  });

  it("judged in scenario lineups the same (every player plays every scenario: the scenario gains are the EV gains)", () => {
    const opt = createOptimizer(setupOf({ tie: 0.5, floor: 900, S: 8 }), CFG);
    expect(opt.judgesScenarios).toBe(true);
    expect(opt.optimize(IDS, NO_STREAM, 1).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr", "cheap"]]);
    expect(createOptimizer(setupOf({ S: 8 }), CFG).optimize(IDS, NO_STREAM, 1).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr", "stash"]]);
  });

  it("a re-run (reoptimize, EV-judged) cuts by the same rule", () => {
    // The FLEX WR's spot taken by a WR without projections (he takes a spot but is never dropped): a full roster again,
    // without the 9-point FLEX. The free-agent WR then starts every week (FLEX, or WR in the WR's bye): cutting the stash
    // gains 35.1, the cheap RB 34.9 (the stash fills in for him at 2.9 in weeks 2 and 3).
    const full = [...IDS.filter((id) => id !== "wr2"), "ghostWR"];
    const withGhost = (s: OptimizerSetup): OptimizerSetup => ({ ...s, info: (id) => (id === "ghostWR" ? { pos: "WR", eligible: ["WR"] } : s.info(id)) });
    const rerun = (s: OptimizerSetup) => {
      const opt = createOptimizer(withGhost(s), CFG);
      return opt.reoptimize(opt.optimize(full, NO_STREAM, 0), full, NO_STREAM, 1).moves;
    };
    expect(rerun(setupOf({ tie: 0.5, floor: 900 }))).toEqual([{ add: "fa-wr", drop: "cheap", gainEv: expect.closeTo(34.9, 9) }]);
    expect(rerun(setupOf({}))).toEqual([{ add: "fa-wr", drop: "stash", gainEv: expect.closeTo(35.1, 9) }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Brute force: every move priced on its own (lineup.solveLineup per week, or scenario lineups from scratch), the rules
// and the near-tie rule applied literally.

/** Kuhn's matching: starting slots a set of players can fill (no starter limits). */
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

interface Spec {
  rows: Map<string, TableRow>;
  slots: PreparedSlots;
  weights: Float64Array;
  freeAgents: string[];
  maxRosterSize: number;
  limits?: Partial<Record<Pos, number>>;
  values: Record<string, number>;
  stream: StreamSpec;
  cfg: OptimizerConfig;
  ghosts: Record<string, Pos>;
  tie: number;
  floor: number;
  /** Scenario-judged (the rows' flags): ROS in scenario lineups; else EV lineups. */
  scenarios: number;
}

type M = { add: string; drop: string | null; gain: number };

function tools(b: Spec) {
  const W = b.weights.length;
  const ros = (ids: readonly string[]): number => {
    const rows = [...ids.flatMap((id) => b.rows.get(id) ?? []), ...b.stream.rows];
    if (b.scenarios > 0) return rosValue(scenarioValues(teamEval(rows, b.slots), W, b.scenarios).mean, b.weights);
    let total = 0;
    for (let w = 0; w < W; w++) total += (b.weights[w] as number) * solveLineup(rows.map((r) => ({ id: r.id, pos: r.pos, eligible: r.eligible, points: r.ev[w] as number })), b.slots).total;
    return total;
  };
  const evRos = (ids: readonly string[]): number => rosValue(solveEvWeeks(teamEval([...ids.flatMap((id) => b.rows.get(id) ?? []), ...b.stream.rows], b.slots), W).lv, b.weights);
  const info = (id: string) => {
    const r = b.rows.get(id);
    return r ? { pos: r.pos, eligible: r.eligible } : b.ghosts[id] ? { pos: b.ghosts[id] as Pos, eligible: [b.ghosts[id] as Pos] } : undefined;
  };
  const fill = (ids: readonly string[]) => bruteFill([...ids.flatMap((id) => info(id) ?? []), ...b.stream.rows], b.slots);
  const positions = (ids: readonly string[]) => ids.flatMap((id) => info(id)?.pos ?? []);
  return { ros, evRos, info, fill, positions };
}

/** better(): the larger gain, then an open spot, then the lower value dropped, then the smaller ids. */
function legacyBetter(a: M, b: M, values: Record<string, number>): boolean {
  if (Math.abs(a.gain - b.gain) > EPS) return a.gain > b.gain;
  if ((a.drop === null) !== (b.drop === null)) return a.drop === null;
  if (a.drop !== null && b.drop !== null && a.drop !== b.drop) {
    const va = values[a.drop] ?? 0;
    const vb = values[b.drop] ?? 0;
    return va !== vb ? va < vb : a.drop < b.drop;
  }
  return a.add < b.add;
}

/** The move from `roster` by brute force: every legal move priced; the best by better(); then the near-tie rule. */
function bruteBest(roster: readonly string[], added: ReadonlySet<string>, b: Spec, open: boolean, dropOnly: ((id: string) => boolean) | null = null): M | null {
  const { ros, fill, positions: positionsOf } = tools(b);
  const excluded = (pos: Pos) => b.cfg.optimizerExcluded.includes(pos) || b.stream.positions.includes(pos);
  const base = ros(roster);
  const fillBefore = fill(roster);
  const positions = positionsOf(roster);
  const cands = b.freeAgents.filter((id) => b.rows.has(id) && !roster.includes(id) && !added.has(id) && !excluded((b.rows.get(id) as TableRow).pos));
  const options: M[] = [];
  if (open && roster.length < b.maxRosterSize) {
    for (const a of cands) if (positionAllows(b.limits, positions, (b.rows.get(a) as TableRow).pos)) options.push({ add: a, drop: null, gain: ros([...roster, a]) - base });
  }
  for (const k of roster) {
    const kr = b.rows.get(k);
    if (!kr || excluded(kr.pos) || (dropOnly && !dropOnly(k))) continue;
    const left = [...positions];
    left.splice(left.indexOf(kr.pos), 1);
    for (const a of cands) {
      if (!positionAllows(b.limits, left, (b.rows.get(a) as TableRow).pos)) continue;
      const after = applyStep(roster, { add: a, drop: k });
      if (fill(after) < fillBefore) continue;
      options.push({ add: a, drop: k, gain: ros(after) - base });
    }
  }
  let best: M | null = null;
  for (const o of options) if (o.gain >= b.cfg.faMinGain - EPS && (!best || legacyBetter(o, best, b.values))) best = o;
  if (!best || !(b.tie > 0) || best.drop === null) return best;
  const fv = (drop: string) => Math.max(b.values[drop] ?? 0, b.floor);
  const top = fv(best.drop);
  if (!(top > b.floor)) return best;
  let pick: M = best;
  const bar = Math.max(best.gain - b.tie, 0);
  for (const o of options) {
    if (o.add !== best.add || o.drop === null || o.drop === best.drop || !(fv(o.drop) < top)) continue;
    if (!(o.gain >= bar - EPS) || !(o.gain > EPS)) continue;
    const va = fv(o.drop);
    const vp = pick.drop === null ? b.floor : fv(pick.drop);
    if (va < vp || (va === vp && legacyBetter(o, pick, b.values))) pick = o;
  }
  return pick;
}

function bruteOptimize(start: readonly string[], b: Spec): { roster: string[]; moves: { add: string; drop: string | null; gainEv: number }[] } {
  const { evRos } = tools(b);
  let roster = [...start];
  const added = new Set<string>();
  const moves: { add: string; drop: string | null; gainEv: number }[] = [];
  for (let step = 0; step < b.cfg.faMaxMoves; step++) {
    const best = bruteBest(roster, added, b, true);
    if (!best) break;
    const next = applyStep(roster, best);
    moves.push({ add: best.add, drop: best.drop, gainEv: evRos(next) - evRos(roster) });
    added.add(best.add);
    roster = next;
  }
  return { roster, moves };
}

/** reoptimize by brute force (optimizer.test.ts's bruteReoptimize, its accounting applied literally), with bruteBest's near-ties. */
function bruteReoptimize(from: { roster: readonly string[]; moves: readonly { add: string; drop: string | null }[] }, start: readonly string[], b: Spec, extra: number, gone: readonly string[] = []): { roster: string[]; moves: [string, string | null][] } {
  const { evRos, positions: positionsOf, info } = tools(b);
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
  const moves: [string, string | null][] = [];
  for (let step = 0; step < limit; step++) {
    let move = bruteBest(roster, added, b, true);
    if (!move) break;
    const grows = move.drop === null || !origin.has(move.drop);
    if (grows && origin.size + 1 > cap) {
      const made = applyStep(roster, move);
      const positions = positionsOf(made);
      let best: { w: string; back: string | null; roster: string[]; ros: number } | null = null;
      for (const [w, k] of origin) {
        if (!made.includes(w)) continue;
        const back = k !== null && !gone.includes(k) && !made.includes(k) ? k : null;
        if (back !== null) {
          const left = [...positions];
          const wPos = info(w)?.pos;
          if (wPos) left.splice(left.indexOf(wPos), 1);
          const bPos = info(back)?.pos;
          if (bPos && !positionAllows(b.limits, left, bPos)) continue;
        }
        const next = back === null ? made.filter((id) => id !== w) : made.map((id) => (id === w ? back : id));
        const r = evRos(next);
        if (!best || r > best.ros + EPS || (Math.abs(r - best.ros) <= EPS && w < best.w)) best = { w, back, roster: next, ros: r };
      }
      if (best && best.ros > evRos(roster) + EPS) {
        origin.set(move.add, move.drop);
        origin.delete(best.w);
        added.add(move.add);
        moves.push([move.add, move.drop]);
        roster = best.roster;
        continue;
      }
      move = bruteBest(roster, added, b, false, (id) => origin.has(id));
      if (!move) break;
    }
    if (move.drop !== null && origin.has(move.drop)) {
      origin.set(move.add, origin.get(move.drop) ?? null);
      origin.delete(move.drop);
    } else origin.set(move.add, move.drop);
    roster = applyStep(roster, move);
    added.add(move.add);
    moves.push([move.add, move.drop]);
  }
  for (let open = from.roster.length - first.length; open > 0 && roster.length < b.maxRosterSize; open--) {
    const positions = positionsOf(roster);
    let best: { w: string; k: string; ros: number } | null = null;
    for (const [w, k] of origin) {
      if (k === null || gone.includes(k) || roster.includes(k)) continue;
      const kPos = info(k)?.pos;
      if (kPos && !positionAllows(b.limits, positions, kPos)) continue;
      const r = evRos([...roster, k]);
      if (!best || r > best.ros + EPS) best = { w, k, ros: r };
    }
    if (!best) break;
    origin.set(best.w, null);
    roster = [...roster, best.k];
  }
  return { roster, moves };
}

const POSITIONS_RANDOM: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"];

/** A random small league (optimizer.test.ts's): rows, free agents, roster size, limits, streaming, ghosts, values. */
function randomLeague(rand: () => number, trial: number, scenarios: number) {
  const W = 4;
  const S = scenarios;
  const weights = Float64Array.from([1, 1, 1.25, rand() < 0.2 ? 0 : 1.25]);
  const slots = trial % 3 === 0 ? SUPERFLEX : trial % 3 === 1 ? STANDARD : SMALL;
  const mk = (id: string, scale: number): TableRow => {
    const pos = POSITIONS_RANDOM[Math.floor(rand() * POSITIONS_RANDOM.length)] as Pos;
    const cond = Array.from({ length: W }, () => (rand() < 0.15 ? 0 : Math.round(rand() * 200 * scale) / 10));
    const eligible: Pos[] = pos === "WR" && rand() < 0.2 ? ["WR", "RB"] : [pos];
    if (!S) return { ...row(id, pos, cond, 0, W), eligible };
    // Random availability per scenario-week (each played with probability 0.85); EV = points × the share played.
    const flags = Uint8Array.from({ length: S * W }, () => (rand() < 0.85 ? 1 : 0));
    const ev = Float64Array.from(cond, (c, w) => {
      let n = 0;
      for (let s = 0; s < S; s++) n += flags[s * W + w] as number;
      return (c * n) / S;
    });
    return { id, pos, eligible, cond: Float64Array.from(cond), ev, condSd: Float64Array.from(cond, (x) => weeklySd(x, pos)), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags };
  };
  const n = 5 + Math.floor(rand() * 7);
  const roster = Array.from({ length: n }, (_, k) => mk(`r${k}`, 1));
  const pool = Array.from({ length: 4 + Math.floor(rand() * 7) }, (_, k) => mk(`f${k}`, 0.9));
  const ghosts: Record<string, Pos> = rand() < 0.3 ? { ghost: "RB" } : {};
  const ids = [...roster.map((r) => r.id), ...Object.keys(ghosts)];
  const maxRosterSize = ids.length + (rand() < 0.3 ? 1 : 0);
  const limits: Partial<Record<Pos, number>> | undefined = rand() < 0.3 ? { RB: 2 + Math.floor(rand() * 2), WR: 3, TE: 1 + Math.floor(rand() * 2) } : undefined;
  const stream: StreamSpec = rand() < 0.3 ? { rows: [S ? { ...streamRow("TE", [5, 6, 5, 6], 0), flags: new Uint8Array(S * W).fill(1) } : streamRow("TE", [5, 6, 5, 6], 0)], positions: ["TE"] } : NO_STREAM;
  const values: Record<string, number> = Object.fromEntries([...roster, ...pool].map((r) => [r.id, Math.round(rand() * 1000)]));
  const cfg: OptimizerConfig = { faMinGain: 2 + Math.floor(rand() * 4), faMaxMoves: 1 + Math.floor(rand() * 4), optimizerExcluded: rand() < 0.5 ? ["K", "DEF"] : [] };
  const tie = [1, 3, 8][Math.floor(rand() * 3)] as number;
  const floor = [0, 200, 400][Math.floor(rand() * 3)] as number;
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
    dropNearTie: tie,
    dropValueFloor: floor,
    ...(S ? { scenarios: S } : {}),
  };
  const spec: Spec = { rows, slots, weights, freeAgents: pool.map((r) => r.id), maxRosterSize, ...(limits ? { limits } : {}), values, stream, cfg, ghosts, tie, floor, scenarios: S };
  return { ids, setup, spec, cfg, stream };
}

describe("near-ties against brute force (every move priced on its own, the rule applied literally)", () => {
  for (const scenarios of [0, 6]) {
    it(`${scenarios ? "scenario" : "EV"}-judged whole runs: exactly the brute force's moves and gains (300 random small leagues), and the rule decides some`, { timeout: 120_000 }, () => {
      const rand = mulberry32(scenarios ? 4040 : 2026);
      let moves = 0;
      let decided = 0;
      for (let trial = 0; trial < 300; trial++) {
        const { ids, setup, spec, cfg, stream } = randomLeague(rand, trial, scenarios);
        const got = createOptimizer(setup, cfg).optimize(ids, stream);
        const want = bruteOptimize(ids, spec);
        expect(got.moves.map((m) => [m.add, m.drop]), `trial ${trial}`).toEqual(want.moves.map((m) => [m.add, m.drop]));
        got.moves.forEach((m, i) => expect(m.gainEv, `trial ${trial} move ${i}`).toBeCloseTo(want.moves[i]?.gainEv as number, 6));
        expect(got.roster, `trial ${trial}`).toEqual(want.roster);
        moves += got.moves.length;
        // How often the rule decides: the brute force without the tolerance moves differently.
        const plain = bruteOptimize(ids, { ...spec, tie: 0 });
        if (JSON.stringify(plain.moves.map((m) => [m.add, m.drop])) !== JSON.stringify(want.moves.map((m) => [m.add, m.drop]))) decided++;
      }
      expect(moves).toBeGreaterThan(150);
      expect(decided).toBeGreaterThan(10);
    });
  }

  it("re-runs (reoptimize, EV-judged) after a loss and with a newcomer: exactly the brute force's moves (150 random small leagues)", { timeout: 120_000 }, () => {
    const rand = mulberry32(31337);
    let checked = 0;
    for (let trial = 0; trial < 150; trial++) {
      const { ids, setup, spec, cfg, stream } = randomLeague(rand, trial, 0);
      const opt = createOptimizer(setup, cfg);
      const from = opt.optimize(ids, stream);
      const want0 = bruteOptimize(ids, spec);
      expect(from.moves.map((m) => [m.add, m.drop]), `trial ${trial}`).toEqual(want0.moves.map((m) => [m.add, m.drop]));
      // A loss: the first roster player with a model.
      const lost = from.roster.find((id) => spec.rows.has(id));
      if (lost) {
        const start = from.roster.filter((id) => id !== lost);
        const got = opt.reoptimize(from, start, stream, 1, [lost]);
        const want = bruteReoptimize(from, start, spec, 1, [lost]);
        expect(got.moves.map((m) => [m.add, m.drop]), `trial ${trial} loss`).toEqual(want.moves);
        expect([...got.roster].sort(), `trial ${trial} loss`).toEqual([...want.roster].sort());
        checked++;
      }
      // A newcomer: a free agent the run didn't add, onto the roster (the drop: the first roster player with a model).
      const newcomer = spec.freeAgents.find((id) => !from.roster.includes(id));
      const drop = from.roster.find((id) => spec.rows.has(id));
      if (newcomer && drop) {
        const start = from.roster.map((id) => (id === drop ? newcomer : id));
        const got = opt.reoptimize(from, start, stream, 1, [drop]);
        const want = bruteReoptimize(from, start, spec, 1, [drop]);
        expect(got.moves.map((m) => [m.add, m.drop]), `trial ${trial} newcomer`).toEqual(want.moves);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  for (const scenarios of [0, 6]) {
    it(`greedy determinism holds (${scenarios ? "scenario" : "EV"}-judged): without any free agent a run never adds, the very same moves (200 random small leagues)`, { timeout: 120_000 }, () => {
      const rand = mulberry32(scenarios ? 99 : 98);
      let restricted = 0;
      for (let trial = 0; trial < 200; trial++) {
        const { ids, setup, cfg, stream } = randomLeague(rand, trial, scenarios);
        const run = createOptimizer(setup, cfg).optimize(ids, stream);
        const adds = new Set(run.moves.map((m) => m.add));
        const others = setup.freeAgents.filter((id) => !adds.has(id) && rand() < 0.6);
        if (!others.length) continue;
        const again = createOptimizer(setup, cfg).optimize(ids, stream, undefined, poolRestriction(others));
        expect(again.moves, `trial ${trial}`).toEqual(run.moves);
        restricted++;
      }
      expect(restricted).toBeGreaterThan(100);
    });
  }
});

describe("the lineup-fill rule still holds under near-ties", () => {
  it("never cuts the only player who can fill a slot, however cheap: the near-tie goes to another", () => {
    // The TE scores 0 (hurt), worth 10: dropping him costs nothing, but he's the only TE. The stash (worth 5,000) never
    // starts; the free-agent WR (11) takes the FLEX. Cutting the stash or the TE gains the same, and the TE is cheaper, but
    // the lineup needs him: the stash goes.
    const rows = new Map([row("qb", "QB", 20), row("rb1", "RB", 15), row("rb2", "RB", 12), row("wr1", "WR", 14), row("wr2", "WR", 6), row("te", "TE", 0), row("k", "K", 7), row("stash", "RB", 1), row("fa-wr", "WR", 11)].map((r) => [r.id, r]));
    const values: Record<string, number> = { te: 10, stash: 5000, wr2: 8000 };
    const setup: OptimizerSetup = { rows, weekCount: 4, slots: SMALL, weights: new Float64Array(4).fill(1), freeAgents: ["fa-wr"], info: (id) => rows.get(id), maxRosterSize: 8, dropValue: (id) => values[id] ?? 0, dropNearTie: 5, dropValueFloor: 100 };
    const ids = ["qb", "rb1", "rb2", "wr1", "wr2", "te", "k", "stash"];
    expect(createOptimizer(setup, CFG).optimize(ids, NO_STREAM, 1).moves.map((m) => [m.add, m.drop])).toEqual([["fa-wr", "stash"]]);
    expect(fillCount(ids.filter((id) => id !== "te").map((id) => ({ id, pos: (rows.get(id) as TableRow).pos, eligible: (rows.get(id) as TableRow).eligible })), SMALL)).toBe(6);
  });
});
