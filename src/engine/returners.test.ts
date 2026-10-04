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
import { rosterKey, type StreamSpec } from "./optimizer";
import { weeklySd } from "./projections";
import { activeSpots, finalLineups, irAfterTrade, irEligibleStatuses, returnerSpec, tradeActiveSpots, type ReturnerSetup } from "./returners";
import { mulberry32 } from "./rng";
import { maskedRow, scenarioValues, scenarioValuesMasked, solveEvWeeks, solveEvWeeksMasked, streamRow, teamEval, type ScenarioCells, type ScenarioValues, type TableRow } from "./teamValue";
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
    expect(activeSpots(["x", "a"], ["b"], { givenIR: ["x"], toIR: [] })).toEqual({ give: 1, recv: 1 });
    expect(activeSpots(["a"], ["y", "b"], { givenIR: [], toIR: ["y"] })).toEqual({ give: 1, recv: 1 });
    expect(activeSpots(["a", "b"], ["c"], { givenIR: [], toIR: [] })).toEqual({ give: 2, recv: 1 });
  });

  it("reads the league itself (each team's IR, the slot's statuses): the engine's counts whatever the received players' order", () => {
    const players: Record<string, { injury: InjuryStatus }> = { mineIr: { injury: "IR" }, a: { injury: "ACTIVE" }, theirIr1: { injury: "IR" }, theirIr2: { injury: "OUT" }, b: { injury: "ACTIVE" } };
    const team = (id: string, roster: string[], ir: string[]) => ({ id, roster, ir });
    const league = (irSlots: number, irEligible?: InjuryStatus[], dataError = false) => ({
      teams: [team("1", ["a", ...(dataError ? ["mineIr"] : [])], ["mineIr"]), team("2", ["b"], ["theirIr1", "theirIr2"])],
      players,
      settings: { irSlots, ...(irEligible ? { irEligible } : {}) },
    }) as unknown as Parameters<typeof tradeActiveSpots>[0];
    // My IR player for theirs (IR status, my slot opens): nothing moves on or off my active roster.
    expect(tradeActiveSpots(league(1), "1", "2", ["mineIr"], ["theirIr1"])).toEqual({ spots: { give: 0, recv: 0 }, irMoved: true });
    // Their OUT player can't take my slot under the default (IR, PUP): he takes an active spot; with OUT eligible, the slot.
    expect(tradeActiveSpots(league(1), "1", "2", ["mineIr"], ["theirIr2"])).toEqual({ spots: { give: 0, recv: 1 }, irMoved: true });
    expect(tradeActiveSpots(league(1, ["IR", "OUT"]), "1", "2", ["mineIr"], ["theirIr2"])).toEqual({ spots: { give: 0, recv: 0 }, irMoved: true });
    // Two of theirs for one open slot: one takes it, the other an active spot (which one doesn't change the count).
    expect(tradeActiveSpots(league(1, ["IR", "OUT"]), "1", "2", ["mineIr", "a"], ["theirIr1", "theirIr2"]).spots).toEqual({ give: 1, recv: 1 });
    // No IR player: the player counts.
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

  it("the lineup-fill rule counts the returners back by then: a returner at a position frees its old starter to go (review of track E)", () => {
    // The returning TE (9) takes the TE slot from week 3, so the old TE (8) costs nothing from then, and he's no longer the
    // only TE the lineup needs: the cheapest of the zero-cost players (te 2000, wr2 3000) goes.
    const early: TableRow = { ...row("wr2", "WR", 11), ev: Float64Array.from([11, 11, 11, 0, 0, 0]), cond: Float64Array.from([11, 11, 11, 0, 0, 0]) };
    const active = team8().map((r) => (r.id === "wr2" ? early : r));
    const b = build({ active, returners: [{ row: row("back", "TE", 9, { from: 3 }), at: 3 }], max: 8, values: { ...VALUES, wrB: 5000, rbB: 5000 } });
    expect(finalLineups(b.setup, b.roster, b.spec, b.raw).displaced).toEqual([{ id: "te", from: 3, returner: "back" }]);
  });

  it("⚠️ the returner himself is a candidate: when he's the least useful from his week, he's released and the team is never weaker for his return", () => {
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

  it("⚠️ never makes a team weaker than without its returner (one returner, the fill rule never needing him): 300 random rosters, EV and scenarios", () => {
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
