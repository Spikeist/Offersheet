/**
 * IR players (src/engine/returners.ts; planner reply to Checkpoint 4, change 5): where a traded IR player goes, the specs
 * that bring returners into lineups, a player masked from a week on (priced again only where he started, bit for bit the
 * solve from scratch), and the displacement a returner causes on a full roster (final evaluations only). Made-up rows.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { prepareSlots } from "./lineup";
import type { InjuryStatus, Pos, SlotDef } from "./model";
import { instanceIndex, slotInstances } from "./needs";
import { fillCount, rosterKey, type StreamSpec } from "./optimizer";
import { weeklySd } from "./projections";
import { activeSpots, finalLineups, irAfterTrade, irEligibleStatuses, returnerSpec, tradeActiveSpots, valueShareFrom, type ReturnerSetup } from "./returners";
import { mulberry32 } from "./rng";
import {
  evRemovalCosts,
  lowestKeepValue,
  maskedRow,
  scenarioRemovalCosts,
  scenarioValues,
  scenarioValuesMasked,
  solveEvWeeks,
  solveEvWeeksMasked,
  streamRow,
  teamEval,
  type ScenarioCells,
  type ScenarioValues,
  type TableRow,
} from "./teamValue";
import { TEST_LINEUP } from "./testLeague";

const slot = (name: string, count: number, eligible: Pos[]): SlotDef => ({ slot: name, count, eligible });
const plain = (xs: ArrayLike<number> | null | undefined) => (xs ? Array.from(xs) : xs);

// ---------------------------------------------------------------------------------------------
// Where a traded IR player goes

describe("irAfterTrade and irEligibleStatuses: a traded IR player's place (rule 5)", () => {
  const ros: Record<string, number> = { a: 50, b: 80, c: 30, d: 90 };
  const base = { ir: ["x"], irSlots: 2, given: [] as string[], received: [] as string[], fromIR: () => true, eligible: () => true, ros: (id: string) => ros[id] ?? 0 };

  it("a given IR player leaves the IR; received IR players fill the open slots, the most ROS points first", () => {
    expect(irAfterTrade({ ...base, given: ["x"], received: ["a", "b", "c"] })).toEqual({ givenIR: ["x"], toIR: ["b", "a"], ir: ["b", "a"] });
    expect(irAfterTrade({ ...base, received: ["a", "b"] })).toEqual({ givenIR: [], toIR: ["b"], ir: ["x", "b"] });
    // Ties in ROS points: the smaller id.
    expect(irAfterTrade({ ...base, ir: [], received: ["z", "y"], ros: () => 10 }).toIR).toEqual(["y", "z"]);
  });

  it("no open slot, a status the slot doesn't take, or a player from the other team's active roster: he joins the active roster", () => {
    expect(irAfterTrade({ ...base, irSlots: 1, received: ["a"] }).toIR).toEqual([]);
    expect(irAfterTrade({ ...base, received: ["a", "d"], eligible: (id) => id !== "d" }).toIR).toEqual(["a"]);
    expect(irAfterTrade({ ...base, received: ["a"], fromIR: () => false }).toIR).toEqual([]);
    // A side over its IR slots opens none by giving one of its IR players away.
    expect(irAfterTrade({ ...base, ir: ["x", "y", "w"], given: ["x"], received: ["a"] }).toIR).toEqual([]);
    expect(irAfterTrade({ ...base, ir: ["x", "y", "w"], given: ["x"], received: ["a"] }).ir).toEqual(["y", "w"]);
  });

  it("the slot takes the platform's statuses when it reports them, else config's default (IR and PUP)", () => {
    expect([...irEligibleStatuses({})]).toEqual([...config.lineups.irEligibleDefault]);
    expect([...irEligibleStatuses({})].sort()).toEqual(["IR", "PUP"]);
    expect([...irEligibleStatuses({ irEligible: ["IR", "PUP", "OUT"] })]).toEqual(["IR", "PUP", "OUT"]);
  });
});

describe("activeSpots and tradeActiveSpots: the active-roster spots a trade's packages count (review of track E)", () => {
  it("counts the players a side moves on and off its active roster: IR players leaving its IR or taking its IR slots aren't", () => {
    expect(activeSpots(["x", "a"], ["b"], { givenIR: ["x"], toIR: [] })).toMatchObject({ give: 1, recv: 1 });
    expect(activeSpots(["a"], ["y", "b"], { givenIR: [], toIR: ["y"] })).toMatchObject({ give: 1, recv: 1 });
    expect(activeSpots(["a", "b"], ["c"], { givenIR: [], toIR: [] })).toEqual({ give: 2, recv: 1 });
  });

  it("Phase 4c: names the side's own IR movers as `inactive` (the neutral throw-in rule's input), none when no IR player moves", () => {
    expect(activeSpots(["x", "a"], ["b"], { givenIR: ["x"], toIR: [] })).toEqual({ give: 1, recv: 1, inactive: new Set(["x"]) });
    expect(activeSpots(["a"], ["y", "b"], { givenIR: [], toIR: ["y"] })).toEqual({ give: 1, recv: 1, inactive: new Set(["y"]) });
    expect(activeSpots(["x"], ["y", "b"], { givenIR: ["x"], toIR: ["y"] })).toEqual({ give: 0, recv: 1, inactive: new Set(["x", "y"]) });
    // Only players of this trade: the side's other IR moves (another trade's) aren't its movers here.
    expect(activeSpots(["a"], ["b"], { givenIR: ["x"], toIR: ["y"] })).toEqual({ give: 1, recv: 1 });
    expect("inactive" in activeSpots(["a", "b"], ["c"], { givenIR: [], toIR: [] })).toBe(false);
  });

  it("reads the league itself (each team's IR, the slot's statuses): the engine's counts whatever the received players' order", () => {
    const players: Record<string, { injury: InjuryStatus }> = { mineIr: { injury: "IR" }, a: { injury: "ACTIVE" }, theirIr1: { injury: "IR" }, theirIr2: { injury: "OUT" }, b: { injury: "ACTIVE" } };
    const team = (id: string, roster: string[], ir: string[]) => ({ id, roster, ir });
    const league = (irSlots: number, irEligible?: InjuryStatus[], dataError = false) => ({
      teams: [team("1", ["a", ...(dataError ? ["mineIr"] : [])], ["mineIr"]), team("2", ["b"], ["theirIr1", "theirIr2"])],
      players,
      settings: { irSlots, ...(irEligible ? { irEligible } : {}) },
    }) as unknown as Parameters<typeof tradeActiveSpots>[0];
    const inactive = (s: { spots: { inactive?: ReadonlySet<string> } }) => [...(s.spots.inactive ?? [])].sort();
    // My IR player for theirs (IR status, my slot opens): nothing moves on or off my active roster; both move without a spot.
    const swap = tradeActiveSpots(league(1), "1", "2", ["mineIr"], ["theirIr1"]);
    expect(swap).toMatchObject({ spots: { give: 0, recv: 0 }, irMoved: true });
    expect(inactive(swap)).toEqual(["mineIr", "theirIr1"]);
    // Their OUT player can't take my slot under the default (IR, PUP): he takes an active spot; with OUT eligible, the slot.
    const out = tradeActiveSpots(league(1), "1", "2", ["mineIr"], ["theirIr2"]);
    expect(out).toMatchObject({ spots: { give: 0, recv: 1 }, irMoved: true });
    expect(inactive(out)).toEqual(["mineIr"]);
    const slotted = tradeActiveSpots(league(1, ["IR", "OUT"]), "1", "2", ["mineIr"], ["theirIr2"]);
    expect(slotted).toMatchObject({ spots: { give: 0, recv: 0 }, irMoved: true });
    expect(inactive(slotted)).toEqual(["mineIr", "theirIr2"]);
    // Two of theirs for one open slot: one takes it, the other an active spot (which one doesn't change the count; it
    // decides which is inactive: the most ROS points first, as the engine reads them, else the smaller id).
    const two = (ros?: (id: string) => number) => tradeActiveSpots(league(1, ["IR", "OUT"]), "1", "2", ["mineIr", "a"], ["theirIr1", "theirIr2"], ros);
    expect(two().spots).toMatchObject({ give: 1, recv: 1 });
    expect(inactive(two())).toEqual(["mineIr", "theirIr1"]);
    expect(inactive(two((id) => (id === "theirIr2" ? 90 : 10)))).toEqual(["mineIr", "theirIr2"]);
    expect(two((id) => (id === "theirIr2" ? 90 : 10)).spots).toMatchObject({ give: 1, recv: 1 });
    // No IR player: the player counts, and nobody is inactive.
    expect(tradeActiveSpots(league(1), "1", "2", ["a"], ["b"])).toEqual({ spots: { give: 1, recv: 1 }, irMoved: false });
    // A player listed on my active roster and my IR (a data error) is an active player, as the League model reads him.
    expect(tradeActiveSpots(league(1, undefined, true), "1", "2", ["mineIr"], ["b"])).toEqual({ spots: { give: 1, recv: 1 }, irMoved: false });
  });
});

// ---------------------------------------------------------------------------------------------
// Rows

const W = 6;

/** A row that scores `points` every week he plays: from week index `from` on (a returner's own availability), every scenario. */
function row(id: string, pos: Pos, points: number, opts: { from?: number; S?: number } = {}): TableRow {
  const from = opts.from ?? 0;
  const S = opts.S ?? 0;
  const cond = new Float64Array(W).fill(points);
  const ev = Float64Array.from(cond, (c, w) => (w >= from ? c : 0));
  const flags = S > 0 ? Uint8Array.from({ length: S * W }, (_, i) => (i % W >= from ? 1 : 0)) : null;
  return { id, pos, eligible: [pos], cond, ev, condSd: Float64Array.from(cond, (c) => weeklySd(c, pos)), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags };
}

describe("returnerSpec: the rows that bring a team's IR players back", () => {
  const rows = new Map([["b", row("b", "RB", 10)], ["a", row("a", "WR", 9)], ["c", row("c", "TE", 5)]]);
  const base: StreamSpec = { rows: [streamRow("K", new Float64Array(W).fill(7), 0)], positions: ["K"] };

  it("keeps the returners (a model and a return week) in id order, the streaming rows and positions as they were", () => {
    const spec = returnerSpec(base, ["b", "a", "c", "zz"], (id) => rows.get(id), (id) => id !== "c");
    expect(spec.rows).toBe(base.rows);
    expect(spec.positions).toBe(base.positions);
    expect(spec.returners?.map((r) => r.id)).toEqual(["a", "b"]);
    // The memo key names them, in any order the IR lists them.
    expect(rosterKey(["q"], spec)).toBe(rosterKey(["q"], returnerSpec(base, ["a", "b"], (id) => rows.get(id), () => true)));
    expect(rosterKey(["q"], spec)).not.toBe(rosterKey(["q"], base));
  });

  it("without returners, no field at all (Checkpoint 4's spec and memo keys)", () => {
    const spec = returnerSpec(base, ["c"], (id) => rows.get(id), () => false);
    expect(spec).toEqual({ rows: base.rows, positions: base.positions });
    expect(rosterKey(["q"], spec)).toBe(rosterKey(["q"], base));
  });
});

// ---------------------------------------------------------------------------------------------
// Masking a row from a week on

describe("maskedRow: a player with nothing from a week on", () => {
  it("zeroes points, SDs and every scenario's flags from that week, and is the same object for the same row and week", () => {
    const r = row("p", "RB", 12, { S: 3 });
    const m = maskedRow(r, 2);
    expect(plain(m.cond)).toEqual([12, 12, 0, 0, 0, 0]);
    expect(plain(m.ev)).toEqual([12, 12, 0, 0, 0, 0]);
    expect(plain(m.condSd)?.slice(2)).toEqual([0, 0, 0, 0]);
    expect(plain(m.evSd)?.slice(0, 2)).toEqual(plain(r.evSd)?.slice(0, 2));
    expect(plain(m.flags)).toEqual([1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
    expect(maskedRow(r, 2)).toBe(m);
    expect(maskedRow(r, 0).ev.every((x) => x === 0)).toBe(true);
    // Past the last week: the row itself.
    expect(maskedRow(r, W)).toBe(r);
    // The original row is untouched.
    expect(plain(r.ev)).toEqual([12, 12, 12, 12, 12, 12]);
  });
});

/** A random row: some zero weeks, availability for EV, flags for S scenarios (now and then none). */
function randomRow(rand: () => number, id: string, Wn: number, S: number): TableRow {
  const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "K", "DEF"];
  const pos = positions[Math.floor(rand() * positions.length)] as Pos;
  const cond = Float64Array.from({ length: Wn }, () => (rand() < 0.1 ? 0 : Math.round(rand() * 250) / 10));
  const ev = Float64Array.from(cond, (c) => (rand() < 0.15 ? 0 : c * (Math.round(rand() * 100) / 100)));
  const flags = rand() < 0.05 ? null : Uint8Array.from({ length: S * Wn }, () => (rand() < 0.8 ? 1 : 0));
  return { id, pos, eligible: pos === "WR" && rand() < 0.25 ? ["WR", "RB"] : [pos], cond, ev, condSd: Float64Array.from(cond, (c) => weeklySd(c, pos)), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags };
}

function expectSameScen(got: ScenarioValues, want: ScenarioValues, label: string): void {
  expect(plain(got.mean), `${label} mean`).toEqual(plain(want.mean));
  expect(plain(got.sd), `${label} sd`).toEqual(plain(want.sd));
  expect(plain(got.within), `${label} within`).toEqual(plain(want.within));
  expect(got.instances?.map(plain) ?? null, `${label} instances`).toEqual(want.instances?.map(plain) ?? null);
  const cells = (c: ScenarioCells | null) => c && { pattern: c.pattern.map(plain), lv: c.lv.map(plain), avail: c.avail.map((w) => w.map(plain)), seat: c.seat.map((w) => w.map(plain)), open: c.open.map(plain) };
  expect(cells(got.cells), `${label} cells`).toEqual(cells(want.cells));
}

describe("solveEvWeeksMasked and scenarioValuesMasked: the lineups priced again only where the masked player started", () => {
  const LINEUPS = [TEST_LINEUP, [...TEST_LINEUP, slot("SUPER_FLEX", 1, ["QB", "RB", "WR", "TE"])]];

  it("equal the solves from scratch, bit for bit (EV: lineups, points, seats, open slots; scenarios: every number and cell): 300 random masks", () => {
    const rand = mulberry32(20261003);
    let reusedEv = 0;
    let reusedScen = 0;
    for (let trial = 0; trial < 300; trial++) {
      const lineup = LINEUPS[trial % 2] as SlotDef[];
      const slots = prepareSlots(lineup);
      const index = trial % 2 === 0 ? instanceIndex(slotInstances(lineup), slots) : null;
      const Wn = 1 + Math.floor(rand() * 6);
      const S = 1 + Math.floor(rand() * 32);
      const n = 2 + Math.floor(rand() * 16);
      const rows = Array.from({ length: n }, (_, k) => randomRow(rand, `p${String(k).padStart(2, "0")}`, Wn, S));
      const team = teamEval(rows, slots);
      const k = Math.floor(rand() * n);
      const from = Math.floor(rand() * (Wn + 1));
      const after = teamEval(
        rows.map((r, j) => (j === k ? maskedRow(r, from) : r)),
        slots,
      );
      const before = solveEvWeeks(team, Wn);
      const ev = solveEvWeeksMasked(before, after, k, from, Wn);
      const want = solveEvWeeks(after, Wn);
      expect(plain(ev.lv), `trial ${trial} lv`).toEqual(plain(want.lv));
      expect(ev.pts.map(plain), `trial ${trial} pts`).toEqual(want.pts.map(plain));
      expect(ev.seat.map(plain), `trial ${trial} seat`).toEqual(want.seat.map(plain));
      expect(plain(ev.open), `trial ${trial} open`).toEqual(plain(want.open));
      if (from < Wn && before.seat.slice(from).some((s) => (s[k] as number) < 0)) reusedEv++;
      const keep = trial % 3 !== 0;
      const spread = trial % 4 !== 0;
      const scenBefore = scenarioValues(team, Wn, S, index, true, true);
      const got = scenarioValuesMasked(scenBefore, after, k, from, Wn, S, index, keep, spread);
      expect(got, `trial ${trial}`).not.toBeNull();
      const wantScen = scenarioValues(after, Wn, S, index, keep, spread);
      expectSameScen(got as ScenarioValues, wantScen, `trial ${trial}`);
      if ((got as ScenarioValues).solves < wantScen.solves) reusedScen++;
    }
    // The shortcuts really skip solves.
    expect(reusedEv).toBeGreaterThan(100);
    expect(reusedScen).toBeGreaterThan(100);
  });

  it("solves from scratch when the shapes don't match (another row changed, or no kept cells)", () => {
    const slots = prepareSlots(TEST_LINEUP);
    const rows = [row("a", "QB", 20, { S: 2 }), row("b", "RB", 10, { S: 2 })];
    const team = teamEval(rows, slots);
    const other = teamEval([rows[0] as TableRow, row("c", "RB", 9, { S: 2 })], slots);
    expect(scenarioValuesMasked(scenarioValues(team, W, 2, null, true), other, 0, 2, W, 2)).toBeNull();
    expect(scenarioValuesMasked(scenarioValues(team, W, 2, null, false), team, 0, 2, W, 2)).toBeNull();
    const ev = solveEvWeeksMasked(solveEvWeeks(team, W), other, 0, 2, W);
    expect(plain(ev.lv)).toEqual(plain(solveEvWeeks(other, W).lv));
  });
});

// ---------------------------------------------------------------------------------------------
// The displacement

/** QB, 2 RB, 2 WR, TE (6 starters). */
const LINEUP: SlotDef[] = [slot("QB", 1, ["QB"]), slot("RB", 2, ["RB"]), slot("WR", 2, ["WR"]), slot("TE", 1, ["TE"])];

interface Built {
  setup: ReturnerSetup;
  roster: string[];
  spec: StreamSpec;
  raw: { ev: ReturnType<typeof solveEvWeeks>; scen: ScenarioValues | null };
  rows: Map<string, TableRow>;
}

/**
 * A team: its active rows, its returners (each back from his week index), the roster size, values for ties, the lineup
 * mode, and optionally streaming (rows after the players, as the optimizer orders them), position limits and minimums.
 */
function build(opts: {
  active: TableRow[];
  returners: { row: TableRow; at: number | null }[];
  max: number;
  values?: Record<string, number>;
  S?: number;
  lineup?: SlotDef[];
  future?: ReturnerSetup["future"];
  weights?: number[];
  stream?: { rows: TableRow[]; positions: Pos[] };
  limits?: Partial<Record<Pos, number>>;
  minimums?: Partial<Record<Pos, number>>;
  /** Near-ties (points a week) and the waiver credit their values are floored at (ReturnerSetup.nearTieWeekly, valueFloor); absent: exact ties. */
  nearTie?: number;
  floor?: number;
  /** W from a return week on (ReturnerSetup.valueFloorFrom; Checkpoint 7e); absent: `floor` in every week. */
  floorFrom?: (from: number) => number;
}): Built {
  const slots = prepareSlots(opts.lineup ?? LINEUP);
  const S = opts.S ?? 0;
  const rows = new Map([...opts.active, ...opts.returners.map((r) => r.row)].map((r) => [r.id, r]));
  const at = new Map(opts.returners.map((r) => [r.row.id, r.at]));
  const setup: ReturnerSetup = {
    slots,
    weekCount: W,
    scenarios: S,
    weights: opts.weights ?? new Array<number>(W).fill(1),
    maxRosterSize: opts.max,
    positionLimits: opts.limits,
    rosterMinimums: opts.minimums,
    info: (id) => rows.get(id),
    dropValue: (id) => opts.values?.[id] ?? 0,
    ...(opts.nearTie !== undefined ? { nearTieWeekly: opts.nearTie } : {}),
    ...(opts.floor !== undefined ? { valueFloor: opts.floor } : {}),
    ...(opts.floorFrom ? { valueFloorFrom: opts.floorFrom } : {}),
    future: opts.future ?? null,
    returnIndex: (id) => at.get(id) ?? null,
    index: instanceIndex(slotInstances(opts.lineup ?? LINEUP), slots),
  };
  const streamRows = opts.stream?.rows ?? [];
  const spec: StreamSpec = { rows: streamRows, positions: opts.stream?.positions ?? [], returners: opts.returners.map((r) => r.row) };
  const team = teamEval([...opts.active, ...streamRows, ...opts.returners.map((r) => r.row)], slots);
  const raw = { ev: solveEvWeeks(team, W), scen: S > 0 ? scenarioValues(team, W, S, setup.index, true, true) : null };
  return { setup, roster: opts.active.map((r) => r.id), spec, raw, rows };
}

/** Σ ω LV (every week ω 1 in these cases) of a final evaluation, in its lineup mode. */
const rosOf = (f: { ev: { lv: Float64Array }; scen: ScenarioValues | null }): number => Array.from(f.scen ? f.scen.mean : f.ev.lv).reduce((s, x) => s + x, 0);

/** A full roster of 8: QB, RB ×2, WR ×2, TE, a bench RB and a bench WR. */
const team8 = (S = 0) => [row("qb", "QB", 20, { S }), row("rb1", "RB", 15, { S }), row("rb2", "RB", 12, { S }), row("wr1", "WR", 14, { S }), row("wr2", "WR", 11, { S }), row("te", "TE", 8, { S }), row("rbB", "RB", 5, { S }), row("wrB", "WR", 3, { S })];
const VALUES = { qb: 9000, rb1: 7000, rb2: 4000, wr1: 6000, wr2: 3000, te: 2000, rbB: 300, wrB: 100 };

describe("finalLineups: the roster spot a returner needs from his week (final evaluations only)", () => {
  it("a full roster drops its lowest keep value player from the returner's week on, never before; the lineups are the masked roster's", () => {
    // An RB back from week index 2 (16 points): from then he starts, so rb2 sits; the bench RB and WR cost nothing to lose,
    // and the less valuable one goes (the tie rule).
    const b = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 8, values: VALUES });
    const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
    expect(f.displaced).toEqual([{ id: "wrB", from: 2, returner: "back" }]);
    const masked = f.team.rows.find((r) => r.id === "wrB") as TableRow;
    expect(plain(masked.ev)).toEqual([3, 3, 0, 0, 0, 0]);
    expect(plain(f.ev.lv)).toEqual([80, 80, 84, 84, 84, 84]);
    expect(plain(f.ev.lv)).toEqual(plain(solveEvWeeks(f.team, W).lv));
  });

  it("with an open roster spot at the return there's no displacement: the raw lineups themselves", () => {
    const b = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 9, values: VALUES });
    const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
    expect(f.displaced).toEqual([]);
    expect(f.ev).toBe(b.raw.ev);
    expect(f.team).toBe(b.raw.ev.team);
    // A returner not back within the weeks needs no spot either.
    const never = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: W }), at: null }], max: 8, values: VALUES });
    expect(finalLineups(never.setup, never.roster, never.spec, never.raw).displaced).toEqual([]);
  });

  it("keeps a player the starting lineup needs (the lineup-fill rule): the cheaper of the others goes", () => {
    // The kicker scores nothing (keep value 0) and is the least valuable, but he's the only K: the bench RB goes instead.
    const lineup = [...LINEUP, slot("K", 1, ["K"])];
    const active = [...team8(), row("k", "K", 0)];
    const b = build({ active, returners: [{ row: row("back", "RB", 16, { from: 1 }), at: 1 }], max: 9, values: { ...VALUES, k: 1, wrB: 400 }, lineup });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "rbB", from: 1, returner: "back" }]);
    // A second kicker on the roster makes the zero-point one droppable.
    const two = build({ active: [...active, row("k2", "K", 7)], returners: [{ row: row("back", "RB", 16, { from: 1 }), at: 1 }], max: 10, values: { ...VALUES, k: 1, k2: 50, wrB: 400 }, lineup });
    expect(finalLineups(two.setup, two.roster, two.spec, two.raw).displaced).toEqual([{ id: "k", from: 1, returner: "back" }]);
  });

  it("judges keep values over the weeks from the return on: a player who only plays before it is the cheapest then", () => {
    // wr2 plays weeks 0–2 only (out after): from week 3 on he costs nothing to lose, like the bench RB (over every week he'd
    // cost 33, the bench RB 0). The TE the returner benches costs nothing then either; the bench players and the TE are
    // worth more, so wr2 is the one who goes.
    const early: TableRow = { ...row("wr2", "WR", 11), ev: Float64Array.from([11, 11, 11, 0, 0, 0]), cond: Float64Array.from([11, 11, 11, 0, 0, 0]) };
    const active = team8().map((r) => (r.id === "wr2" ? early : r));
    const b = build({ active, returners: [{ row: row("back", "TE", 9, { from: 3 }), at: 3 }], max: 8, values: { ...VALUES, wrB: 5000, rbB: 5000, te: 5000 } });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "wr2", from: 3, returner: "back" }]);
  });

  /** A row that plays only in the week indexes `weeks` (his points there, 0 elsewhere: out before, or gone after). */
  const only = (id: string, pos: Pos, points: number, weeks: readonly number[], S: number): TableRow => {
    const ev = Float64Array.from({ length: W }, (_, w) => (weeks.includes(w) ? points : 0));
    return { ...row(id, pos, points, { S }), ev, cond: Float64Array.from(ev), evSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), condSd: Float64Array.from(ev, (x) => weeklySd(x, pos)), flags: S > 0 ? Uint8Array.from({ length: S * W }, (_, i) => (weeks.includes(i % W) ? 1 : 0)) : null };
  };

  it("Checkpoint 7e (planner reply to Checkpoint 7d, item 2.3): the trade values the ties compare are read from the return on too: one who plays only before it is worth nothing then and goes, though he's worth the most today", () => {
    // From week 3 the returning RB (16) benches rb2 (12): rb2, the bench RB and the bench WR all cost nothing to lose. The
    // bench WR plays weeks 0–2 only (worth 5000 today, nothing from week 3 on), the bench RB every week (300 today, 150 left
    // at week 3). Today's values would release the bench RB; read from the return on, the bench WR goes. Exact ties, and
    // near-ties with W 400 (both then floored at W, and the lower value left decides).
    const values = { ...VALUES, wrB: 5000, rbB: 300 };
    expect(lowestKeepValue(["rb2", "rbB", "wrB"].map((id) => ({ id, keep: 0, value: values[id as keyof typeof values] })), 0, 0)).toBe("rbB");
    for (const S of [0, 8]) {
      const active = team8(S).map((r) => (r.id === "wrB" ? only("wrB", "WR", 3, [0, 1, 2], S) : r));
      const returners = [{ row: row("back", "RB", 16, { from: 3, S }), at: 3 }];
      for (const near of [{}, { nearTie: 0.5, floor: 400 }]) {
        const b = build({ active, returners, max: 8, values, S, ...near });
        expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced, `${S} scenarios ${JSON.stringify(near)}`).toEqual([{ id: "wrB", from: 3, returner: "back" }]);
      }
    }
  });

  it("Checkpoint 7e: one worth more from the return on stays: a teammate out until then keeps his whole value, so a player who's worth more today but has played half his season by then goes", () => {
    // Two bench WRs who never start: wrB plays every week (600 today, 300 left at week 3), `late` is out until week 3 and
    // plays from then on (450 today, all of it left). Today's values would release `late`; from the return on, wrB goes.
    const values = { ...VALUES, wrB: 600, late: 450, rbB: 5000 };
    for (const S of [0, 8]) {
      const active = [...team8(S), only("late", "WR", 2, [3, 4, 5], S)];
      const b = build({ active, returners: [{ row: row("back", "RB", 16, { from: 3, S }), at: 3 }], max: 9, values, S });
      expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced, `${S} scenarios`).toEqual([{ id: "wrB", from: 3, returner: "back" }]);
    }
  });

  it("Checkpoint 7e: W from the return week on (ReturnerSetup.valueFloorFrom): two near-tied players worth less than W today but more than W then are told apart by their values, not by their keep values", () => {
    // wr1's bye in week 4 puts the bench WR (3) in the lineup, so from week 3 he costs 3 to lose; the bench RB and rb2 (benched
    // by the returning RB) cost nothing; the tolerance is 2 × 3 weeks = 6. Values left at week 3: rb2 2000, the bench RB 235,
    // the bench WR 225. With W 500 in every week both bench players floor at W and the lower keep value goes (the bench RB);
    // with W 200 from week 3 on (the best free agent's value left then), the bench WR, worth less then, goes: the near-tie
    // rule decided it, so the bench RB, the lineup's own pick, is the one kept instead (Checkpoint 7f).
    const bye = (r: TableRow): TableRow => (r.id === "wr1" ? { ...r, ev: Float64Array.from(r.ev, (x, w) => (w === 4 ? 0 : x)), cond: Float64Array.from(r.cond, (x, w) => (w === 4 ? 0 : x)) } : r);
    const values = { ...VALUES, rbB: 470, wrB: 450 };
    const asked: number[] = [];
    const base = { active: team8().map(bye), returners: [{ row: row("back", "RB", 16, { from: 3 }), at: 3 }], max: 8, values, nearTie: 2, floor: 500 };
    const fixed = build(base);
    expect(finalLineups(fixed.setup, fixed.roster, fixed.spec, fixed.raw).displaced).toEqual([{ id: "rbB", from: 3, returner: "back" }]);
    const then = build({
      ...base,
      floorFrom: (from) => {
        asked.push(from);
        return 200;
      },
    });
    expect(finalLineups(then.setup, then.roster, then.spec, then.raw).displaced).toEqual([{ id: "wrB", from: 3, returner: "back", keptInstead: "rbB" }]);
    expect(asked).toEqual([3]);
  });

  it("the lineup-fill rule counts the returners back by then: a returner at a position frees its old starter to go (review of track E)", () => {
    // The returning TE (9) takes the TE slot from week 3, so the old TE (8) costs nothing from then, and he's no longer the
    // only TE the lineup needs: the cheapest of the zero-cost players (te 2000, the bench RB and WR 5000) goes. Read without
    // the returner, the TE would be needed and the bench RB would go. (Checkpoint 7e: wr2 plays every week here; when he
    // plays only before the return, as in the case above, his value from then on is nothing, so he goes first.)
    const b = build({ active: team8(), returners: [{ row: row("back", "TE", 9, { from: 3 }), at: 3 }], max: 8, values: { ...VALUES, wrB: 5000, rbB: 5000 } });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "te", from: 3, returner: "back" }]);
  });

  it("⚠️ the returner himself is a candidate: when he's the least useful from his week, he's released and (exact ties) the team is never weaker for his return", () => {
    // A bench WR back from week 2 who scores 2: every other player starts or out-scores him, so he's the one who goes.
    const b = build({ active: team8(), returners: [{ row: row("back", "WR", 2, { from: 2 }), at: 2 }], max: 8, values: { ...VALUES, back: 10 } });
    const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
    expect(f.displaced).toEqual([{ id: "back", from: 2, returner: "back" }]);
    // His weeks from his return are gone; the lineups are the roster's without him (he never started).
    const without = solveEvWeeks(teamEval(team8(), b.setup.slots), W);
    expect(plain(f.ev.lv)).toEqual(plain(without.lv));
    // Even when he's worth the most: every other bench player covers a bye (the bench RB rb2's in week 3, the bench WR
    // wr2's in week 4, better than the returner would), so losing either costs points and losing the returner nothing. The
    // rule before the review (never the returner) dropped the bench WR, and the team lost a point in week 4 for his return.
    const withBye = (id: string, week: number) => (r: TableRow): TableRow => (r.id === id ? { ...r, ev: Float64Array.from(r.ev, (x, w) => (w === week ? 0 : x)), cond: Float64Array.from(r.cond, (x, w) => (w === week ? 0 : x)) } : r);
    const byes = team8().map(withBye("rb2", 3)).map(withBye("wr2", 4));
    const covered = build({ active: byes, returners: [{ row: row("back", "WR", 2, { from: 2 }), at: 2 }], max: 8, values: { ...VALUES, back: 9999 } });
    const g = finalLineups(covered.setup, covered.roster, covered.spec, covered.raw);
    expect(g.displaced).toEqual([{ id: "back", from: 2, returner: "back" }]);
    const none = solveEvWeeks(teamEval(byes, covered.setup.slots), W);
    expect(plain(g.ev.lv)).toEqual(plain(none.lv));
    expect(g.ev.lv[4]).toBe(20 + 15 + 12 + 14 + 3 + 8);
    // The old rule's choice, for the record: the bench WR masked from the return costs the point in week 4.
    const old = solveEvWeeks(teamEval([...byes.map((r) => (r.id === "wrB" ? maskedRow(r, 2) : r)), row("back", "WR", 2, { from: 2 })], covered.setup.slots), W);
    expect((none.lv[4] as number) - (old.lv[4] as number)).toBe(1);
  });

  it("⚠️ with exact ties, never makes a team weaker than without its returner (one returner, the fill rule never needing him): 300 random rosters, EV and scenarios", () => {
    const rand = mulberry32(20261004);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE"];
    for (let trial = 0; trial < 300; trial++) {
      const S = trial % 2 === 0 ? 0 : 1 + Math.floor(rand() * 12);
      // Every slot filled by the active roster alone, then a random bench: the returner is never the one the lineup needs.
      const starters = positions.map((pos, k) => ({ ...randomRow(rand, `a${k}`, W, S), pos, eligible: [pos] }));
      const bench = Array.from({ length: Math.floor(rand() * 4) }, (_, k) => randomRow(rand, `b${k}`, W, S)).map((r) => ({ ...r, eligible: [r.pos] }));
      const active = [...starters, ...bench];
      const at = Math.floor(rand() * W);
      const back = { ...randomRow(rand, "ret", W, S), pos: positions[Math.floor(rand() * positions.length)] as Pos };
      const ret: TableRow = { ...back, eligible: [back.pos] };
      const b = build({ active, returners: [{ row: ret, at }], max: active.length, values: Object.fromEntries([...active, ret].map((r) => [r.id, Math.floor(rand() * 9000)])), S });
      const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
      expect(f.displaced, `trial ${trial}`).toHaveLength(1);
      const team = teamEval(active, b.setup.slots);
      const none = S > 0 ? scenarioValues(team, W, S, b.setup.index, true, true) : null;
      // Keep values tie within 1e-9 (teamValue.lowestKeepValue), so a near-tie can cost that much per candidate.
      expect(rosOf(f), `trial ${trial}`).toBeGreaterThanOrEqual(rosOf({ ev: solveEvWeeks(team, W), scen: none }) - 1e-7);
    }
  });

  it("⚠️ with near-ties (verification of the final review, finding VF-4), weaker than without its returner by at most the tolerance from his week on: 300 random rosters, EV and scenarios", () => {
    const rand = mulberry32(20261005);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE"];
    let weaker = 0;
    let keptValuable = 0;
    for (let trial = 0; trial < 300; trial++) {
      const S = trial % 2 === 0 ? 0 : 1 + Math.floor(rand() * 12);
      const starters = positions.map((pos, k) => ({ ...randomRow(rand, `a${k}`, W, S), pos, eligible: [pos] }));
      const bench = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, k) => randomRow(rand, `b${k}`, W, S)).map((r) => ({ ...r, eligible: [r.pos] }));
      const active = [...starters, ...bench];
      const at = Math.floor(rand() * W);
      const back = { ...randomRow(rand, "ret", W, S), pos: positions[Math.floor(rand() * positions.length)] as Pos };
      const ret: TableRow = { ...back, eligible: [back.pos] };
      const nearTie = 0.5 + 3 * rand();
      const floor = Math.floor(rand() * 4000);
      const values = Object.fromEntries([...active, ret].map((r) => [r.id, Math.floor(rand() * 9000)]));
      const b = build({ active, returners: [{ row: ret, at }], max: active.length, values, S, nearTie, floor });
      const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
      expect(f.displaced, `trial ${trial}`).toHaveLength(1);
      const team = teamEval(active, b.setup.slots);
      const none = rosOf({ ev: solveEvWeeks(team, W), scen: S > 0 ? scenarioValues(team, W, S, b.setup.index, true, true) : null });
      // The tolerance in ROS points: points a week × the weights from his return on (every week weighs 1 here).
      const tolerance = nearTie * (W - at);
      expect(rosOf(f), `trial ${trial}`).toBeGreaterThanOrEqual(none - tolerance - 1e-7);
      if (rosOf(f) < none - 1e-7) {
        weaker++;
        // Only to keep a returner worth more than W over a cheaper player, both valued from his return on (Checkpoint 7e: the
        // share of each one's value left then, valueShareFrom on his own row; W as the setup gives it).
        const left = (id: string) => (values[id] as number) * valueShareFrom((b.rows.get(id) as TableRow).ev, b.setup.weights, at);
        expect(Math.max(left("ret"), floor), `trial ${trial}`).toBeGreaterThan(Math.max(left(f.displaced[0]?.id as string), floor));
        if (f.displaced[0]?.id !== "ret") keptValuable++;
      }
    }
    // The exception happens, and only that way.
    expect(weaker).toBeGreaterThan(5);
    expect(keptValuable).toBe(weaker);
  });

  it("a position at its limit drops one at the returner's position, even with room on the roster; legality's cap when already over", () => {
    // RB limit 3: rb1, rb2 and the bench RB, and an RB back from week 2. The bench WR (3) is the cheapest overall, but the
    // limit binds, so an RB goes: the bench RB (benched by the returner) — even with a roster spot to spare.
    const b = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 9, values: VALUES, limits: { RB: 3 } });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "rbB", from: 2, returner: "back" }]);
    // Without the limit there's room: nothing goes.
    const free = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 9, values: VALUES });
    expect(finalLineups(free.setup, free.roster, free.spec, free.raw).displaced).toEqual([]);
    // A limit the roster is already over (RB 2, three RBs as it stands) holds it to its count, as legality does: one RB goes.
    const over = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 9, values: VALUES, limits: { RB: 2 } });
    expect(finalLineups(over.setup, over.roster, over.spec, over.raw).displaced).toEqual([{ id: "rbB", from: 2, returner: "back" }]);
    // A full roster whose returner's position is at its limit: still one drop, at his position (the bench WR stays).
    const full = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 8, values: { ...VALUES, rbB: 5000 }, limits: { RB: 3 } });
    expect(finalLineups(full.setup, full.roster, full.spec, full.raw).displaced).toEqual([{ id: "rb2", from: 2, returner: "back" }]);
  });

  it("never drops one a position's minimum needs (held to the count it had, legality's rule)", () => {
    // The bench WR (3) would go, but WR minimum 3 needs him (three WRs as it stands): the bench RB goes instead.
    const b = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 8, values: VALUES, minimums: { WR: 3 } });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "rbB", from: 2, returner: "back" }]);
    // A minimum above the count it had is held to that count (3 WRs): the same.
    const high = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 8, values: VALUES, minimums: { WR: 5 } });
    expect(finalLineups(high.setup, high.roster, high.spec, high.raw).displaced).toEqual([{ id: "rbB", from: 2, returner: "back" }]);
  });

  it("⚠️ never drops the last rostered player at a position the team streams (the week's pickup needs his spot); a second one can go", () => {
    // The team streams D/ST: its streaming row fills the slot (a replacement scoring 6), so its own D/ST (5) costs nothing to
    // lose and is the least valuable — but he's its only D/ST, so the bench WR goes.
    const lineup = [...LINEUP, slot("D/ST", 1, ["DEF"])];
    const stream = { rows: [streamRow("DEF", new Float64Array(W).fill(6), 0)], positions: ["DEF"] as Pos[] };
    const active = [...team8(), row("def", "DEF", 5)];
    const b = build({ active, returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 9, values: { ...VALUES, def: 1 }, lineup, stream });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "wrB", from: 2, returner: "back" }]);
    // With a second D/ST on the roster, the cheaper one can go.
    const two = build({ active: [...active, row("def2", "DEF", 4)], returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 10, values: { ...VALUES, def: 1, def2: 2 }, lineup, stream });
    expect(finalLineups(two.setup, two.roster, two.spec, two.raw).displaced).toEqual([{ id: "def", from: 2, returner: "back" }]);
    // A team that doesn't stream D/ST keeps its only one through the lineup-fill rule instead, even one scoring nothing.
    const zero = [...team8(), row("def", "DEF", 0)];
    const own = build({ active: zero, returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 9, values: { ...VALUES, def: 1 }, lineup });
    expect(finalLineups(own.setup, own.roster, own.spec, own.raw).displaced).toEqual([{ id: "wrB", from: 2, returner: "back" }]);
  });

  it("each returner past the roster's room drops one player from his own week, in order of return (ties: the smaller id)", () => {
    const b = build({ active: team8(), returners: [{ row: row("late", "WR", 13, { from: 4 }), at: 4 }, { row: row("soon", "RB", 16, { from: 1 }), at: 1 }], max: 8, values: VALUES });
    const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
    expect(f.displaced).toEqual([
      { id: "wrB", from: 1, returner: "soon" },
      { id: "rbB", from: 4, returner: "late" },
    ]);
    // One spot of room: only the later return needs a drop.
    const room = build({ active: team8(), returners: [{ row: row("late", "WR", 13, { from: 4 }), at: 4 }, { row: row("soon", "RB", 16, { from: 1 }), at: 1 }], max: 9, values: VALUES });
    expect(finalLineups(room.setup, room.roster, room.spec, room.raw).displaced).toEqual([{ id: "wrB", from: 4, returner: "late" }]);
  });

  it("⚠️ a roster already over the size is held to its own size (legality's rule): one drop per returner, not more", () => {
    const b = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 6, values: VALUES });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toHaveLength(1);
  });

  it("dynasty and keeper leagues with long-term values add the normalized market value to the keep value (legality's reading)", () => {
    // Both bench players cost nothing; wrB is worth a lot in dynasty value, so the bench RB goes.
    const future = { value: (id: string) => (id === "wrB" ? 9000 : 100), top: 10000 };
    const b = build({ active: team8(), returners: [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }], max: 8, values: VALUES, future });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced.map((d) => d.id)).toEqual(["rbB"]);
  });

  it("in scenario lineups: the keep values and the final lineups are the scenarios' (bit for bit the masked roster solved from scratch)", () => {
    const S = 8;
    const b = build({ active: team8(S), returners: [{ row: row("back", "RB", 16, { from: 2, S }), at: 2 }], max: 8, values: VALUES, S });
    const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
    expect(f.displaced).toEqual([{ id: "wrB", from: 2, returner: "back" }]);
    const want = scenarioValues(f.team, W, S, b.setup.index, true, true);
    expectSameScen(f.scen as ScenarioValues, want, "scenario");
    // Without kept cells the raw scenario lineups are solved first: the same result.
    const noCells = finalLineups(b.setup, b.roster, b.spec, { ev: b.raw.ev, scen: scenarioValues(b.raw.ev.team, W, S, b.setup.index, false, true) });
    expect(noCells.displaced).toEqual(f.displaced);
    expectSameScen(noCells.scen as ScenarioValues, want, "no cells");
  });
});

describe("finalLineups' keep: my untouchables are never released at a return (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.3)", () => {
  const back = () => [{ row: row("back", "RB", 16, { from: 2 }), at: 2 }];

  it("a kept player is never the one released: the next lowest keep value goes; a keep set naming nobody on the roster changes nothing", () => {
    const b = build({ active: team8(), returners: back(), max: 8, values: VALUES });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "wrB", from: 2, returner: "back" }]);
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw, ["wrB"]).displaced).toEqual([{ id: "rbB", from: 2, returner: "back" }]);
    // Both bench players kept: the cheapest of the rest to lose from week 2 on goes (rb2, whom the returner benches then).
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw, ["wrB", "rbB"]).displaced).toEqual([{ id: "rb2", from: 2, returner: "back" }]);
    // Nobody of the roster in the keep set: the very result (the same objects without a displacement change).
    const none = finalLineups(b.setup, b.roster, b.spec, b.raw, ["someone-else"]);
    expect(none.displaced).toEqual([{ id: "wrB", from: 2, returner: "back" }]);
  });

  it("with only kept players (and the returner) to choose from, the returner himself goes; a kept returner with everyone else kept: nobody, the roster runs over", () => {
    const b = build({ active: team8(), returners: back(), max: 8, values: VALUES });
    const everyone = b.roster;
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw, everyone).displaced).toEqual([{ id: "back", from: 2, returner: "back" }]);
    const all = finalLineups(b.setup, b.roster, b.spec, b.raw, [...everyone, "back"]);
    expect(all.displaced).toEqual([]);
    expect(all.ev).toBe(b.raw.ev);
  });

  it("at a position whose limit binds, a kept player there is passed over (the next one at his position goes), in scenario lineups too", () => {
    for (const S of [0, 8]) {
      // RB limit 3, an RB back from week 2: the bench RB goes; kept, rb2 (whom the returner benches then) goes instead.
      const b = build({ active: team8(S), returners: [{ row: row("back", "RB", 16, { from: 2, S }), at: 2 }], max: 9, values: VALUES, limits: { RB: 3 }, S });
      expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced, `${S} scenarios`).toEqual([{ id: "rbB", from: 2, returner: "back" }]);
      expect(finalLineups(b.setup, b.roster, b.spec, b.raw, ["rbB"]).displaced, `${S} scenarios`).toEqual([{ id: "rb2", from: 2, returner: "back" }]);
    }
  });
});

describe("Displacement.keptInstead: the player the lineup alone would have released, when the near-tie rule decided (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4)", () => {
  // Parker's week-7 return in made-up rows: the returning TE (2 points a week from his return, week index 2) starts only in
  // week 3, the TE's bye, so he costs 2.0 to lose from then; a bench RB who never starts costs nothing but is worth more than
  // W then (965 × 4/6 = 643 against W 418), the returner less (243). The tolerance: 0.6 a week over weeks 2–5, 2.4.
  const teBye = (r: TableRow): TableRow => (r.id === "te" ? { ...r, ev: Float64Array.from(r.ev, (x, w) => (w === 3 ? 0 : x)), cond: Float64Array.from(r.cond, (x, w) => (w === 3 ? 0 : x)) } : r);
  const starters = (S: number) => team8(S).filter((r) => r.id !== "rbB" && r.id !== "wrB").map(teBye);
  const back = (S: number) => [{ row: row("ret", "TE", 2, { from: 2, S }), at: 2 }];
  const values = { ...VALUES, rbK: 965, rbK2: 1500, ret: 243 };
  const near = { nearTie: 0.6, floor: 418 };

  it("the rule releases the returner over a bench player nearly even for the lineup and worth more: keptInstead names the bench player; the lineups are the masked roster's, as without it", () => {
    for (const S of [0, 8]) {
      const b = build({ active: [...starters(S), row("rbK", "RB", 5, { S })], returners: back(S), max: 7, values, S, ...near });
      const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
      expect(f.displaced, `${S} scenarios`).toEqual([{ id: "ret", from: 2, returner: "ret", keptInstead: "rbK" }]);
      expect(plain(f.ev.lv), `${S} scenarios`).toEqual(plain(solveEvWeeks(f.team, W).lv));
      if (S > 0) expectSameScen(f.scen as ScenarioValues, scenarioValues(f.team, W, S, b.setup.index, true, true), `${S} scenarios`);
      // Exact ties (the lineup alone) release the player kept instead.
      const exact = build({ active: [...starters(S), row("rbK", "RB", 5, { S })], returners: back(S), max: 7, values, S });
      expect(finalLineups(exact.setup, exact.roster, exact.spec, exact.raw).displaced, `${S} scenarios`).toEqual([{ id: "rbK", from: 2, returner: "ret" }]);
    }
  });

  it("no keptInstead when the lineup decides: the bench player worth at most W then (he goes himself), keep values farther apart than the tolerance, or long-term values (exact ties)", () => {
    const active = [...starters(0), row("rbK", "RB", 5)];
    const cheap = build({ active, returners: back(0), max: 7, values: { ...values, rbK: 600 }, ...near });
    expect(finalLineups(cheap.setup, cheap.roster, cheap.spec, cheap.raw).displaced).toEqual([{ id: "rbK", from: 2, returner: "ret" }]);
    const far = build({ active, returners: back(0), max: 7, values, nearTie: 0.4, floor: 418 });
    expect(finalLineups(far.setup, far.roster, far.spec, far.raw).displaced).toEqual([{ id: "rbK", from: 2, returner: "ret" }]);
    const future = build({ active, returners: back(0), max: 7, values, ...near, future: { value: (id: string) => (id === "ret" ? 50 : 900), top: 10000 } });
    const g = finalLineups(future.setup, future.roster, future.spec, future.raw);
    expect(g.displaced).toHaveLength(1);
    expect(g.displaced[0]?.keptInstead).toBeUndefined();
  });

  it("never names one of my untouchables: kept, the bench player isn't a candidate and the next one is kept instead; locking the player released leaves someone to release", () => {
    const active = [...starters(0), row("rbK", "RB", 5), row("rbK2", "RB", 4)];
    const b = build({ active, returners: back(0), max: 8, values, ...near });
    // Both bench backs cost nothing; on the lineup alone the one worth less from the return on goes (rbK 643, rbK2 1000).
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "ret", from: 2, returner: "ret", keptInstead: "rbK" }]);
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw, ["rbK"]).displaced).toEqual([{ id: "ret", from: 2, returner: "ret", keptInstead: "rbK2" }]);
    // "Lock Pierce to keep him instead": the returner kept, the bench back worth less from his return on goes, by the lineup.
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw, ["ret"]).displaced).toEqual([{ id: "rbK", from: 2, returner: "ret" }]);
  });

  it("property, 200 random rosters (one returner, near-ties, EV and scenarios): the release is the rule's over the header's candidates and the lineups the masked roster's, as without the field; keptInstead is exactly the release on the lineup alone when that's another player, nearly even and worth more from the return on; locking the release leaves someone to go", () => {
    const rand = mulberry32(20261015);
    const positions: Pos[] = ["QB", "RB", "RB", "WR", "WR", "TE"];
    let decided = 0;
    for (let trial = 0; trial < 200; trial++) {
      const S = trial % 2 === 0 ? 0 : 1 + Math.floor(rand() * 12);
      const starters = positions.map((pos, k) => ({ ...randomRow(rand, `a${k}`, W, S), pos, eligible: [pos] }));
      const bench = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, k) => randomRow(rand, `b${k}`, W, S)).map((r) => ({ ...r, eligible: [r.pos] }));
      const active = [...starters, ...bench];
      const at = Math.floor(rand() * W);
      const draw = { ...randomRow(rand, "ret", W, S), pos: positions[Math.floor(rand() * positions.length)] as Pos };
      const ret: TableRow = { ...draw, eligible: [draw.pos] };
      const nearTie = 0.5 + 3 * rand();
      const floor = Math.floor(rand() * 4000);
      const vals: Record<string, number> = Object.fromEntries([...active, ret].map((r) => [r.id, Math.floor(rand() * 9000)]));
      const opts = { active, returners: [{ row: ret, at }], max: active.length, values: vals, S, floor };
      const b = build({ ...opts, nearTie });
      const f = finalLineups(b.setup, b.roster, b.spec, b.raw);
      // The decision as returners.ts's header defines it, on the raw lineups (one returner: nothing released before him): keep
      // values from his return on, the lineup-fill rule, values from then on, the tolerance over those weeks.
      const wf = Float64Array.from({ length: W }, (_, w) => (w >= at ? 1 : 0));
      const costs = S > 0 ? scenarioRemovalCosts((b.raw.scen as ScenarioValues).cells as ScenarioCells, wf) : evRemovalCosts(b.raw.ev, wf);
      const index = new Map(b.raw.ev.team.rows.map((r, k) => [r.id, k] as const));
      const live = [...b.roster, "ret"];
      const entries = (ids: readonly string[]) => ids.map((id) => ({ id, pos: (b.rows.get(id) as TableRow).pos, eligible: (b.rows.get(id) as TableRow).eligible }));
      const fill = fillCount(entries(live), b.setup.slots);
      const valueOf = (id: string) => (vals[id] ?? 0) * valueShareFrom((b.rows.get(id) as TableRow).ev, b.setup.weights, at);
      const cands = live.filter((id) => fillCount(entries(live.filter((x) => x !== id)), b.setup.slots) >= fill).map((id) => ({ id, keep: costs[index.get(id) as number] as number, value: valueOf(id) }));
      const tie = nearTie * (W - at);
      const pick = lowestKeepValue(cands, tie, floor) as string;
      const kept = lowestKeepValue(cands, 0) as string;
      expect(f.displaced, `trial ${trial}`).toEqual([{ id: pick, from: at, returner: "ret", ...(kept !== pick ? { keptInstead: kept } : {}) }]);
      const masked = teamEval(b.raw.ev.team.rows.map((r) => (r.id === pick ? maskedRow(r, at) : r)), b.setup.slots);
      expect(plain(f.ev.lv), `trial ${trial}`).toEqual(plain(solveEvWeeks(masked, W).lv));
      if (S > 0) expect(plain(f.scen?.mean), `trial ${trial}`).toEqual(plain(scenarioValues(masked, W, S, b.setup.index, true, true).mean));
      const keep = (id: string) => cands.find((c) => c.id === id)?.keep as number;
      if (kept !== pick) {
        decided++;
        // Nearly even for the lineup from the return on, and worth more then (floored at W): the card's sentence holds.
        expect(keep(kept), `trial ${trial}`).toBeLessThanOrEqual(keep(pick) + 1e-9);
        expect(keep(pick) - keep(kept), `trial ${trial}`).toBeLessThanOrEqual(tie + 1e-9);
        expect(Math.max(valueOf(kept), floor), `trial ${trial}`).toBeGreaterThan(Math.max(valueOf(pick), floor));
      }
      // Exact ties release the player kept instead (or the same one, with no reason).
      const exact = build(opts);
      expect(finalLineups(exact.setup, exact.roster, exact.spec, exact.raw).displaced, `trial ${trial}`).toEqual([{ id: kept, from: at, returner: "ret" }]);
      // "Lock him to keep him instead": someone else goes at that return.
      const locked = finalLineups(b.setup, b.roster, b.spec, b.raw, [pick]).displaced;
      expect(locked.map((d) => [d.from, d.returner]), `trial ${trial}`).toEqual([[at, "ret"]]);
      expect(locked[0]?.id, `trial ${trial}`).not.toBe(pick);
      expect(locked[0]?.keptInstead, `trial ${trial}`).not.toBe(pick);
    }
    expect(decided).toBeGreaterThan(20);
  });
});

describe("valueShareFrom: the share of a player's trade value left at a return week (Checkpoint 7e)", () => {
  it("his projected points from that week on over those of every week that counts, each counted week once", () => {
    const flat6 = [2, 2, 2, 2, 2, 2];
    const ones = [1, 1, 1, 1, 1, 1];
    expect(valueShareFrom(flat6, ones, 3)).toBe(0.5);
    expect(valueShareFrom(flat6, ones, 6)).toBe(0);
    expect(valueShareFrom([4, 4, 2, 2, 2, 2], ones, 2)).toBe(0.5);
    // ω doesn't weigh the weeks (the market prices points): playoff weeks at 2 change nothing.
    expect(valueShareFrom([4, 4, 2, 2, 2, 2], [1, 1, 1, 1, 2, 2], 2)).toBe(0.5);
    // A week that doesn't count (a week under way, weight 0) is left out of both.
    expect(valueShareFrom([9, 2, 2, 2], [0, 1, 1, 1], 2)).toBeCloseTo(2 / 3, 15);
  });

  it("exactly 1 when none of his points come before that week (a returner, a decision in the first week that counts, no points at all), 0 when all do", () => {
    const ones = [1, 1, 1, 1, 1, 1];
    expect(valueShareFrom([0, 0, 3, 3, 3, 3], ones, 2)).toBe(1);
    expect(valueShareFrom([0, 0, 3, 3, 3, 3], ones, 4)).toBe(0.5);
    expect(valueShareFrom([2, 2, 2, 2, 2, 2], ones, 0)).toBe(1);
    expect(valueShareFrom([9, 2, 2, 2], [0, 1, 1, 1], 1)).toBe(1);
    expect(valueShareFrom([0, 0, 0, 0, 0, 0], ones, 3)).toBe(1);
    expect(valueShareFrom([5, 5, 0, 0, 0, 0], ones, 2)).toBe(0);
    // A week below 0 (a D/ST's expected points can be) counts as 0.
    expect(valueShareFrom([-3, 2, 2], [1, 1, 1], 1)).toBe(1);
  });
});
