import { describe, expect, it } from "vitest";
import { MAX_SLOT_GROUPS, lineupOrder, lineupStarters, lineupTotal, prepareLeagueSlots, prepareRoster, prepareSlots, solveLineup, type Lineup, type LineupPlayer, type PreparedRoster, type StarterLimits } from "./lineup";
import { bruteForceLineup, fitsSlot, readLimit } from "./lineup.testing";
import { POSITIONS, type Pos, type SlotDef } from "./model";
import { mulberry32 } from "./rng";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const pl = (id: string, pos: Pos, points: number, eligible: Pos[] = [pos]): LineupPlayer => ({ id, pos, eligible, points });

/** A common redraft lineup: QB, 2 RB, 2 WR, TE, FLEX, K, D/ST (9 starters). */
const STANDARD: SlotDef[] = [
  slot("QB", 1, ["QB"]),
  slot("RB", 2, ["RB"]),
  slot("WR", 2, ["WR"]),
  slot("TE", 1, ["TE"]),
  slot("FLEX", 1, ["RB", "WR", "TE"]),
  slot("K", 1, ["K"]),
  slot("DEF", 1, ["DEF"]),
];

const starterPairs = (l: Lineup) => l.starters.map((s) => `${s.slot}:${s.id}`);

// ---------------------------------------------------------------------------------------------
// Legality of a solver lineup, independent of the solver

interface Checked {
  minSeats: number;
}

/** Asserts the lineup is legal (§7: eligibility, slot counts, starter limits) and returns its starter-minimum seats. */
function checkLegal(players: readonly LineupPlayer[], lineup: readonly SlotDef[], limits: StarterLimits | undefined, got: Lineup, note: string): Checked {
  const byId = new Map(players.map((p) => [p.id, p]));
  const capacity = new Map<string, number>();
  for (const d of lineup) capacity.set(d.slot, (capacity.get(d.slot) ?? 0) + Math.max(0, Math.floor(d.count)));
  const used = new Set<string>();
  const perSlot = new Map<string, number>();
  const perPos = new Map<Pos, number>();
  let sum = 0;
  for (const s of got.starters) {
    const p = byId.get(s.id);
    expect(p, note).toBeDefined();
    if (!p) continue;
    expect(used.has(s.id), note).toBe(false);
    used.add(s.id);
    const defs = lineup.filter((d) => d.slot === s.slot);
    expect(defs.some((d) => fitsSlot(p, d.eligible)), `${note}: ${s.id} can't fill ${s.slot}`).toBe(true);
    perSlot.set(s.slot, (perSlot.get(s.slot) ?? 0) + 1);
    perPos.set(p.pos, (perPos.get(p.pos) ?? 0) + 1);
    expect(s.points, note).toBe(p.points);
    sum += s.points;
  }
  for (const [name, c] of perSlot) expect(c, note).toBeLessThanOrEqual(capacity.get(name) ?? 0);
  expect(Math.abs(got.total - sum), note).toBeLessThanOrEqual(1e-9);
  let minSeats = 0;
  for (const [pos, l] of Object.entries(limits ?? {}) as [Pos, { min: number; max: number }][]) {
    const { lo, hi } = readLimit(l);
    const c = perPos.get(pos) ?? 0;
    expect(c, `${note}: ${pos} starters over the maximum`).toBeLessThanOrEqual(hi);
    minSeats += Math.min(c, lo);
  }
  // A player worth 0 or less starts only to fill a starter minimum.
  for (const s of got.starters) {
    if (s.points > 0) continue;
    const pos = (byId.get(s.id) as LineupPlayer).pos;
    const l = limits?.[pos];
    expect(l, `${note}: ${s.id} starts at ${s.points} points without a minimum`).toBeDefined();
    if (l) expect(perPos.get(pos) ?? 0, note).toBeLessThanOrEqual(readLimit(l).lo);
  }
  return { minSeats };
}

/** Solver vs brute force: same total (1e-9), same starter-minimum seats, and a legal lineup. */
function checkCase(players: LineupPlayer[], lineup: SlotDef[], limits?: StarterLimits): { usesFlow: boolean } {
  const note = JSON.stringify({ lineup, limits, players });
  const slots = prepareSlots(lineup, limits);
  const got = solveLineup(players, slots);
  const want = bruteForceLineup(players, lineup, limits);
  expect(Math.abs(got.total - want.total), note).toBeLessThanOrEqual(1e-9);
  expect(checkLegal(players, lineup, limits, got, note).minSeats, note).toBe(want.minSeats);
  return { usesFlow: prepareRoster(players, slots).usesFlow };
}

// ---------------------------------------------------------------------------------------------
// Random leagues (seeded: src/engine/rng.ts)

type Rand = () => number;
const randInt = (rand: Rand, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(rand: Rand, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;

/** Platform slots (Sleeper, ESPN) with their eligibility. */
const SLOT_KINDS: Readonly<Record<string, readonly Pos[]>> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  P: ["P"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  OP: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  "RB/WR": ["RB", "WR"],
  IDP_FLEX: ["DL", "LB", "DB"],
  "DL/LB": ["DL", "LB"],
};

function randomLineup(rand: Rand, maxInstances: number): SlotDef[] {
  const out: SlotDef[] = [];
  const used = new Set<string>();
  let instances = 0;
  const kinds = randInt(rand, 1, 6);
  for (let i = 0; i < kinds && instances < maxInstances; i++) {
    let name: string;
    let eligible: Pos[];
    if (rand() < 0.15) {
      name = `X${i}`; // an arbitrary eligibility set
      eligible = [...new Set(Array.from({ length: randInt(rand, 1, 4) }, () => pick(rand, POSITIONS)))];
    } else {
      name = pick(rand, Object.keys(SLOT_KINDS));
      eligible = [...(SLOT_KINDS[name] as Pos[])];
    }
    if (used.has(name)) continue;
    used.add(name);
    const count = Math.min(randInt(rand, 1, 3), maxInstances - instances);
    out.push(slot(name, count, eligible));
    instances += count;
  }
  return out;
}

/** Zeros, negatives, ties and continuous values. */
function randomPoints(rand: Rand): number {
  const u = rand();
  if (u < 0.15) return 0;
  if (u < 0.25) return -Math.round(rand() * 50) / 10;
  if (u < 0.55) return pick(rand, [4, 6.5, 8, 10, 12.5]);
  return Math.round(rand() * 3000) / 100;
}

/** Players mostly at the lineup's positions (sometimes one no slot takes); `multi` = chance of extra eligible positions. */
function randomRoster(rand: Rand, lineup: readonly SlotDef[], n: number, multi: number): LineupPlayer[] {
  const inLineup = [...new Set(lineup.flatMap((d) => d.eligible))];
  const pool = inLineup.length > 0 ? inLineup : [...POSITIONS];
  return Array.from({ length: n }, (_, k) => {
    const pos = rand() < 0.1 ? pick(rand, POSITIONS) : pick(rand, pool);
    const eligible = new Set<Pos>([pos]);
    if (rand() < multi) for (let e = randInt(rand, 1, 2); e > 0; e--) eligible.add(pick(rand, pool));
    // Ids not in index order, so the id tie-break is exercised independently of input order.
    return pl(`${String.fromCharCode(97 + ((k * 7) % 26))}${k}`, pos, randomPoints(rand), [...eligible]);
  });
}

function randomLimits(rand: Rand, positions: readonly Pos[]): StarterLimits {
  const out: StarterLimits = {};
  for (let i = randInt(rand, 1, Math.min(4, positions.length)); i > 0; i--) {
    const pos = pick(rand, positions);
    const max = rand() < 0.1 ? randInt(rand, 0, 3) + 0.5 : randInt(rand, 0, 3);
    const min = rand() < 0.15 ? Math.floor(max) + 1 : rand() < 0.1 ? 0.5 : randInt(rand, 0, Math.floor(max));
    out[pos] = { min, max };
  }
  return out;
}

/** MFL: one pool of starters with per-position min–max; one position per player. */
function randomMfl(rand: Rand): { lineup: SlotDef[]; limits: StarterLimits } {
  const positions: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const lineup = [slot("STARTER", randInt(rand, 3, 9), positions)];
  const table: Record<string, [number, number, number, number]> = { QB: [0, 1, 1, 2], RB: [1, 2, 2, 4], WR: [1, 3, 3, 5], TE: [0, 1, 1, 2], K: [0, 1, 1, 1], DEF: [0, 1, 1, 1] };
  const limits: StarterLimits = {};
  for (const pos of positions) {
    if (rand() < 0.2) continue;
    const [minLo, minHi, maxLo, maxHi] = table[pos] as [number, number, number, number];
    limits[pos] = { min: randInt(rand, minLo, minHi), max: randInt(rand, maxLo, maxHi) };
  }
  return { lineup, limits };
}

// ---------------------------------------------------------------------------------------------

describe("prepareSlots (§7)", () => {
  it("orders slot groups most restrictive first, merges same-name same-eligibility slots and drops empty ones", () => {
    const slots = prepareSlots([
      slot("FLEX", 1, ["RB", "WR", "TE"]),
      slot("QB", 1, ["QB"]),
      slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"]),
      slot("RB", 1, ["RB"]),
      slot("RB", 1, ["RB"]),
      slot("K", 0, ["K"]),
      slot("HC", 1, []),
    ]);
    expect(slots.groups.map((g) => `${g.slot}×${g.count}@${g.lineupIndex}`)).toEqual(["QB×1@1", "RB×2@3", "FLEX×1@0", "SUPER_FLEX×1@2"]);
    expect([...slots.capacity]).toEqual([1, 2, 1, 1]);
    expect(slots.starters).toBe(5);
    const bits = (pos: Pos) => slots.posMask[POSITIONS.indexOf(pos)];
    expect(bits("QB")).toBe(0b1001);
    expect(bits("RB")).toBe(0b1110);
    expect(bits("TE")).toBe(0b1100);
    expect(bits("K")).toBe(0);
    expect(slots.limits).toBeNull();
  });

  it("reads starter limits as at least ceil(min), at most floor(max), min clamped into [0, max]; limits that can't bind are dropped", () => {
    const slots = prepareSlots([slot("STARTER", 6, ["QB", "RB", "WR", "TE", "K"])], {
      QB: { min: 1, max: 2 },
      RB: { min: 3, max: 1 },
      TE: { min: 0, max: 99 },
      K: { min: 0.5, max: 1.8 },
    });
    const at = (arr: Int32Array, pos: Pos) => arr[POSITIONS.indexOf(pos)];
    const limits = slots.limits;
    expect(limits).not.toBeNull();
    if (!limits) return;
    expect([at(limits.min, "QB"), at(limits.max, "QB")]).toEqual([1, 2]);
    expect([at(limits.min, "RB"), at(limits.max, "RB")]).toEqual([1, 1]);
    expect([at(limits.min, "TE"), at(limits.max, "TE")]).toEqual([0, 6]);
    expect([at(limits.min, "K"), at(limits.max, "K")]).toEqual([1, 1]);
    const limited = POSITIONS.filter((_, i) => (limits.limited >> i) & 1);
    expect(limited).toEqual(["QB", "RB", "K"]);
    expect(prepareSlots(STANDARD, { QB: { min: 0, max: 9 } }).limits).toBeNull();
    expect(prepareLeagueSlots({ lineup: STANDARD, starterLimits: { QB: { min: 1, max: 1 } } }).limits).not.toBeNull();
  });

  it(`rejects more than ${MAX_SLOT_GROUPS} kinds of starting slots`, () => {
    const many = Array.from({ length: MAX_SLOT_GROUPS + 1 }, (_, i) => slot(`S${i}`, 1, ["RB"]));
    expect(() => prepareSlots(many)).toThrow(/more than 31/);
    expect(prepareSlots(many.slice(1)).groups).toHaveLength(MAX_SLOT_GROUPS);
  });
});

describe("solveLineup: hand cases (§7 weekly lineup value)", () => {
  const slots = prepareSlots(STANDARD);
  const roster = [
    pl("qb1", "QB", 20),
    pl("qb2", "QB", 17),
    pl("rb1", "RB", 15),
    pl("rb2", "RB", 12),
    pl("rb3", "RB", 9),
    pl("wr1", "WR", 14),
    pl("wr2", "WR", 11),
    pl("wr3", "WR", 10.5),
    pl("te1", "TE", 12),
    pl("te2", "TE", 10.9),
    pl("k1", "K", 7),
    pl("def1", "DEF", 6),
  ];

  it("FLEX takes the best leftover RB/WR/TE; the RB, WR and TE slots hold the top players there", () => {
    const got = solveLineup(roster, slots);
    expect(got.total).toBeCloseTo(20 + 15 + 12 + 14 + 11 + 12 + 10.9 + 7 + 6, 10);
    expect(starterPairs(got)).toEqual(["QB:qb1", "RB:rb1", "RB:rb2", "WR:wr1", "WR:wr2", "TE:te1", "FLEX:te2", "K:k1", "DEF:def1"]);
  });

  it("SUPER_FLEX starts the second QB only when he outscores the best leftover RB", () => {
    const sf = prepareSlots([slot("QB", 1, ["QB"]), slot("RB", 1, ["RB"]), slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"])]);
    const players = [pl("qb1", "QB", 22), pl("qb2", "QB", 16), pl("rb1", "RB", 14), pl("rb2", "RB", 15)];
    expect(starterPairs(solveLineup(players, sf))).toEqual(["QB:qb1", "RB:rb2", "SUPER_FLEX:qb2"]);
    expect(solveLineup(players, sf).total).toBe(53);
    const weakQb2 = players.map((p) => (p.id === "qb2" ? { ...p, points: 13 } : p));
    expect(starterPairs(solveLineup(weakQb2, sf))).toEqual(["QB:qb1", "RB:rb2", "SUPER_FLEX:rb1"]);
    expect(solveLineup(weakQb2, sf).total).toBe(51);
  });

  it("too few players: every useful player starts and the other slots stay empty (score 0)", () => {
    const got = solveLineup([pl("qb", "QB", 18), pl("rb", "RB", 10), pl("k", "K", 5)], slots);
    expect(got.total).toBe(33);
    expect(starterPairs(got)).toEqual(["QB:qb", "RB:rb", "K:k"]);
    expect(solveLineup([], slots)).toEqual({ total: 0, starters: [] });
    expect(solveLineup(roster, prepareSlots([]))).toEqual({ total: 0, starters: [] });
  });

  it("players with 0 or fewer points never start (an empty slot scores 0), even into an empty slot", () => {
    const got = solveLineup([pl("qb", "QB", 18), pl("rb", "RB", -1), pl("k", "K", 0), pl("def", "DEF", -2), pl("te", "TE", Number.NaN)], slots);
    expect(got.total).toBe(18);
    expect(starterPairs(got)).toEqual(["QB:qb"]);
  });

  it("a player who fits no slot never starts (a punter in a league without P)", () => {
    expect(starterPairs(solveLineup([pl("p", "P", 30), pl("qb", "QB", 18)], slots))).toEqual(["QB:qb"]);
  });

  it("augmenting path: an RB/WR shifts to WR so a pure RB can start", () => {
    const got = solveLineup([pl("a", "RB", 20, ["RB", "WR"]), pl("b", "RB", 15), pl("c", "WR", 10)], prepareSlots([slot("RB", 1, ["RB"]), slot("WR", 1, ["WR"])]));
    expect(got.total).toBe(35);
    expect(starterPairs(got)).toEqual(["RB:b", "WR:a"]);
  });

  it("canonical seats after a shift: the better RB sits in the RB slot and the FLEX holds the leftover", () => {
    const three = prepareSlots([slot("RB", 1, ["RB"]), slot("WR", 1, ["WR"]), slot("FLEX", 1, ["RB", "WR"])]);
    const got = solveLineup([pl("a", "RB", 30, ["RB", "WR"]), pl("b", "RB", 25), pl("c", "RB", 20)], three);
    expect(got.total).toBe(75);
    expect(starterPairs(got)).toEqual(["RB:b", "WR:a", "FLEX:c"]);
  });

  it("ties are deterministic: equal points → the smaller id starts, whatever the input order", () => {
    const one = prepareSlots([slot("RB", 1, ["RB"])]);
    expect(starterPairs(solveLineup([pl("rb-b", "RB", 10), pl("rb-a", "RB", 10)], one))).toEqual(["RB:rb-a"]);
    expect(starterPairs(solveLineup([pl("rb-a", "RB", 10), pl("rb-b", "RB", 10)], one))).toEqual(["RB:rb-a"]);
  });

  it("IR and taxi are the caller's business: only the players passed in can start", () => {
    const active = roster.filter((p) => p.id !== "qb1");
    expect(starterPairs(solveLineup(active, slots))[0]).toBe("QB:qb2");
  });
});

describe("solveLineup: starter limits (MFL, §4 starterLimits)", () => {
  const MFL4 = [slot("STARTER", 4, ["QB", "RB", "WR", "TE"])];
  const limits: StarterLimits = { QB: { min: 1, max: 1 }, RB: { min: 1, max: 2 }, WR: { min: 1, max: 2 }, TE: { min: 1, max: 1 } };
  const players = [pl("qb1", "QB", 20), pl("qb2", "QB", 18), pl("rb1", "RB", 15), pl("rb2", "RB", 14), pl("rb3", "RB", 13), pl("wr1", "WR", 12), pl("te1", "TE", 3)];

  it("minimums seat the top-min players of each position first (a weak TE still takes a spot)", () => {
    const got = solveLineup(players, prepareSlots(MFL4, limits));
    expect(got.total).toBe(20 + 15 + 12 + 3);
    expect(got.starters.map((s) => s.id).sort()).toEqual(["qb1", "rb1", "te1", "wr1"]);
    expect(checkCase(players, MFL4, limits).usesFlow).toBe(false);
  });

  it("a TE on bye still fills the TE minimum, scoring 0 (MFL makes you start one)", () => {
    const slots = prepareSlots(MFL4, limits);
    const roster = prepareRoster(players, slots);
    const points = Float64Array.from(players, (p) => p.points);
    const available = Uint8Array.from(players, (p) => (p.id === "te1" ? 0 : 1));
    const seat = new Int32Array(players.length);
    expect(lineupTotal(roster, points, available, seat)).toBe(20 + 15 + 12);
    expect(lineupStarters(roster, points, seat, available).find((s) => s.id === "te1")).toEqual({ id: "te1", slot: "STARTER", points: 0 });
  });

  it("a minimum the roster can't meet (no TE) is best effort: the spot goes to the best legal player", () => {
    const noTe = players.filter((p) => p.pos !== "TE");
    expect(solveLineup(noTe, prepareSlots(MFL4, limits)).total).toBe(20 + 15 + 14 + 12);
    checkCase(noTe, MFL4, limits);
  });

  it("maximums cap starters by primary position", () => {
    const three = [slot("STARTER", 3, ["RB", "WR"])];
    const capped = { RB: { min: 0, max: 1 } };
    const got = solveLineup([pl("rb1", "RB", 20), pl("rb2", "RB", 19), pl("wr1", "WR", 10), pl("wr2", "WR", 9)], prepareSlots(three, capped));
    expect(got.total).toBe(39);
    expect(got.starters.map((s) => s.id).sort()).toEqual(["rb1", "wr1", "wr2"]);
  });

  it("a forced player with negative points still starts, and counts", () => {
    const got = solveLineup([pl("te", "TE", -1), pl("wr", "WR", 9), pl("wr2", "WR", 8)], prepareSlots([slot("STARTER", 2, ["WR", "TE"])], { TE: { min: 1, max: 1 } }));
    expect(got.total).toBe(8);
    expect(got.starters.map((s) => s.id).sort()).toEqual(["te", "wr"]);
  });

  it("minimums the slots can't all hold: the most minimum seats first, then the most points", () => {
    const lineup = [slot("FLEX", 1, ["RB", "WR", "TE"])];
    const both = { RB: { min: 1, max: 1 }, TE: { min: 1, max: 1 } };
    const players2 = [pl("rb", "RB", 10), pl("te", "TE", 5), pl("wr", "WR", 20)];
    expect(starterPairs(solveLineup(players2, prepareSlots(lineup, both)))).toEqual(["FLEX:rb"]);
    checkCase(players2, lineup, both);
  });

  it("mixed eligibility at a limited position is solved exactly by min-cost flow (the greedy would keep 10, not 9 + 8)", () => {
    const lineup = [slot("WR", 1, ["WR"]), slot("TE", 1, ["TE"])];
    const rbMax = { RB: { min: 0, max: 1 } };
    const players3 = [pl("a", "RB", 10, ["RB", "WR"]), pl("b", "RB", 9, ["RB", "TE"]), pl("c", "WR", 8)];
    const slots = prepareSlots(lineup, rbMax);
    expect(prepareRoster(players3, slots).usesFlow).toBe(true);
    const got = solveLineup(players3, slots);
    expect(got.total).toBe(17);
    expect(starterPairs(got)).toEqual(["WR:c", "TE:b"]);
    expect(checkCase(players3, lineup, rbMax).usesFlow).toBe(true);
  });

  it("the flow, like the greedy, starts a 0-point player only to fill a minimum", () => {
    const lineup = [slot("WR", 1, ["WR"]), slot("FLEX", 2, ["RB", "WR", "TE"])];
    const rb = { RB: { min: 1, max: 2 } };
    const players4 = [pl("r0", "RB", 0, ["RB", "WR"]), pl("r1", "RB", 0), pl("r2", "RB", 5), pl("w", "WR", 7)];
    expect(prepareRoster(players4, prepareSlots(lineup, rb)).usesFlow).toBe(true);
    const got = solveLineup(players4, prepareSlots(lineup, rb));
    expect(got.total).toBe(12);
    expect(got.starters.map((s) => s.id).sort()).toEqual(["r2", "w"]);
  });
});

describe("solveLineup: property tests against brute force (§7, §16)", () => {
  it("1,200 random rosters × platform slot mixes (multi-position players, zeros, negatives, ties)", () => {
    const rand = mulberry32(7001);
    for (let c = 0; c < 1200; c++) {
      const lineup = randomLineup(rand, 10);
      checkCase(randomRoster(rand, lineup, randInt(rand, 0, 12), 0.3), lineup);
    }
  });

  it("500 random rosters with starter limits, one position per player (the greedy path)", () => {
    const rand = mulberry32(7002);
    for (let c = 0; c < 500; c++) {
      const lineup = randomLineup(rand, 9);
      const players = randomRoster(rand, lineup, randInt(rand, 0, 12), 0);
      const positions = [...new Set([...lineup.flatMap((d) => d.eligible), ...players.map((p) => p.pos)])];
      expect(checkCase(players, lineup, randomLimits(rand, positions)).usesFlow).toBe(false);
    }
  });

  it("400 random rosters with starter limits and multi-position players (min-cost flow when eligibility is mixed)", () => {
    const rand = mulberry32(7003);
    let flow = 0;
    for (let c = 0; c < 400; c++) {
      const lineup = randomLineup(rand, 9);
      const players = randomRoster(rand, lineup, randInt(rand, 2, 12), 0.5);
      const positions = [...new Set(players.map((p) => p.pos))];
      if (checkCase(players, lineup, randomLimits(rand, positions)).usesFlow) flow++;
    }
    expect(flow).toBeGreaterThan(100);
  });

  it("300 MFL-style leagues: one pool of starters with per-position min–max", () => {
    const rand = mulberry32(7004);
    for (let c = 0; c < 300; c++) {
      const { lineup, limits } = randomMfl(rand);
      checkCase(randomRoster(rand, lineup, randInt(rand, 0, 13), 0), lineup, limits);
    }
  });

  it("the lineup doesn't depend on the order players are passed in (ties go to the smaller id)", () => {
    const rand = mulberry32(7007);
    for (let c = 0; c < 300; c++) {
      const lineup = randomLineup(rand, 10);
      const players = randomRoster(rand, lineup, randInt(rand, 0, 12), 0.3);
      const positions = [...new Set(players.map((p) => p.pos))];
      const limits = positions.length > 0 && rand() < 0.3 ? randomLimits(rand, positions) : undefined;
      const slots = prepareSlots(lineup, limits);
      const shuffled = [...players].sort(() => rand() - 0.5);
      const a = solveLineup(players, slots);
      const b = solveLineup(shuffled, slots);
      const note = JSON.stringify({ lineup, limits, players });
      expect(Math.abs(a.total - b.total), note).toBeLessThanOrEqual(1e-9);
      // The min-cost flow (mixed eligibility under starter limits) may settle an exact tie by roster order.
      if (!prepareRoster(players, slots).usesFlow) expect(b.starters, note).toEqual(a.starters);
    }
  });

  it("40 full 16-player rosters in the standard 9-starter lineup", () => {
    const rand = mulberry32(7005);
    const shape: Pos[] = ["QB", "QB", "RB", "RB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "WR", "TE", "TE", "K", "DEF"];
    for (let c = 0; c < 40; c++) {
      const players = shape.map((pos, k) => pl(`p${(k * 11) % 16}`, pos, randomPoints(rand), pos === "RB" && rand() < 0.2 ? ["RB", "WR"] : [pos]));
      checkCase(players, STANDARD);
    }
  });
});

describe("fast API for hot loops (prepareRoster + lineupTotal)", () => {
  /** Of two starters who could swap slots, the better one sits in the more restrictive group (lower index). */
  function expectCanonical(r: PreparedRoster, points: Float64Array, available: Uint8Array, seat: Int32Array, note: string) {
    const eff = (k: number) => (available[k] === 0 ? 0 : (points[k] as number));
    const better = (a: number, b: number) => eff(a) > eff(b) || (eff(a) === eff(b) && (r.idRank[a] as number) < (r.idRank[b] as number));
    for (let a = 0; a < r.size; a++) {
      for (let b = 0; b < r.size; b++) {
        const ga = seat[a] as number;
        const gb = seat[b] as number;
        if (ga < 0 || gb < 0 || ga >= gb) continue;
        const canSwap = ((r.masks[b] as number) & (1 << ga)) !== 0 && ((r.masks[a] as number) & (1 << gb)) !== 0;
        expect(canSwap && better(b, a), note).toBe(false);
      }
    }
  }

  it("an availability row = those players at 0; a presorted order and a reused roster change nothing; seats are canonical", () => {
    const rand = mulberry32(7006);
    for (let c = 0; c < 300; c++) {
      const lineup = randomLineup(rand, 10);
      const players = randomRoster(rand, lineup, randInt(rand, 0, 14), 0.3);
      const positions = [...new Set(players.map((p) => p.pos))];
      const limits = positions.length > 0 && rand() < 0.3 ? randomLimits(rand, positions) : undefined;
      const slots = prepareSlots(lineup, limits);
      const roster = prepareRoster(players, slots);
      const points = Float64Array.from(players, (p) => p.points);
      const order = lineupOrder(roster, points);
      for (let s = 0; s < 8; s++) {
        const available = Uint8Array.from(players, () => (rand() < 0.3 ? 0 : 1));
        const zeroed = players.map((p, k) => ({ ...p, points: available[k] === 0 ? 0 : p.points }));
        const fresh = solveLineup(zeroed, slots);
        const seatA = new Int32Array(players.length);
        const seatB = new Int32Array(players.length);
        const note = JSON.stringify({ lineup, limits, zeroed });
        const a = lineupTotal(roster, points, available, seatA);
        expect(a, note).toBe(fresh.total);
        expect(lineupTotal(roster, points, available, seatB, order), note).toBe(a);
        expect(lineupTotal(roster, points, available), note).toBe(a);
        expect([...seatB], note).toEqual([...seatA]);
        expect(lineupStarters(roster, points, seatA, available), note).toEqual(fresh.starters);
        expectCanonical(roster, points, available, seatA, note);
      }
    }
  });

  it("lineupOrder lists players with points > 0 who fit a slot, best first, ties by id", () => {
    const slots = prepareSlots(STANDARD);
    const players = [pl("c", "RB", 10), pl("a", "RB", 10), pl("b", "WR", 12), pl("z", "RB", 0), pl("n", "RB", -3), pl("p", "P", 40), pl("q", "QB", Number.NaN)];
    const r = prepareRoster(players, slots);
    const order = lineupOrder(r, Float64Array.from(players, (p) => p.points));
    expect([...order].map((k) => players[k]?.id)).toEqual(["b", "a", "c"]);
    const buf = new Int32Array(10);
    expect(lineupOrder(r, Float64Array.from(players, (p) => p.points), buf).buffer).toBe(buf.buffer);
  });

  it("seat output: slot group per player (−1 on the bench), groups indexing roster.slots.groups", () => {
    const slots = prepareSlots(STANDARD);
    const players = [pl("qb", "QB", 20), pl("rb1", "RB", 15), pl("rb2", "RB", 14), pl("rb3", "RB", 13), pl("rb4", "RB", 1)];
    const r = prepareRoster(players, slots);
    const seat = new Int32Array(players.length);
    expect(lineupTotal(r, Float64Array.from(players, (p) => p.points), null, seat)).toBe(62);
    expect([...seat].map((g) => (g < 0 ? "bench" : slots.groups[g]?.slot))).toEqual(["QB", "RB", "RB", "FLEX", "bench"]);
  });

  it("rejects arrays shorter than the roster", () => {
    const r = prepareRoster([pl("a", "RB", 1), pl("b", "RB", 2)], prepareSlots(STANDARD));
    expect(() => lineupTotal(r, new Float64Array(1))).toThrow(RangeError);
    expect(() => lineupTotal(r, new Float64Array(2), new Uint8Array(1))).toThrow(RangeError);
    expect(() => lineupTotal(r, new Float64Array(2), null, new Int32Array(1))).toThrow(RangeError);
  });
});
