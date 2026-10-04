/**
 * The waiver credit W from the allocation (league.ts step 4; planner reply to Checkpoint 4c, A3: "use the best free agent no
 * team is predicted to claim, consistent with one free agent, one team"): market.waiverCredit's `claimed`, the fixed point
 * (waiverCreditFixedPoint: W read off the allocation, the allocation run with W), the League model's W and the trade
 * evaluation's long-term W. Made-up leagues (CLAUDE.md §16); teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, tradeInternals } from "./evaluate";
import { buildLeagueModel, buildLeagueModelWithContext, waiverCreditFixedPoint, type BuildLeagueModelOptions, type LeagueModelConfig } from "./league";
import type { LeagueModel, TeamModel } from "./leagueModel";
import { waiverCredit } from "./market";
import type { LeagueSnapshot, Pos } from "./model";
import { mulberry32 } from "./rng";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW, buildTestLeague, randomLeague, type TestLeagueSpec, type TestPlayer, type TestTeam } from "./testLeague";
import { flat, handLeague } from "./trade.testing";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
/** No future injury risk: every healthy player certainly plays (the hand-built cases stay obvious). */
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
/** EV lineups, the user's team streaming nothing. */
const OPTS: BuildLeagueModelOptions = { now: TEST_NOW, scenarios: 0, sims: 0, settings: { ...defaultTradeSettings(), streamPositions: [] } };

const p = (id: string, pos: Pos, points: number, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, ...extra });
const team = (id: string, roster: TestPlayer[]): TestTeam => ({ id, roster });
const teamOf = (m: LeagueModel, id: string): TeamModel => m.teams.find((t) => t.id === id) as TeamModel;
/** A full starting lineup (QB, 2 RB, 2 WR, TE, FLEX, K, D/ST); `wrTeam` the NFL team of its two WRs. */
const starters = (t: string, wrTeam = "AAA"): TestPlayer[] => [
  p(`${t}-qb`, "QB", 20),
  p(`${t}-rb1`, "RB", 15),
  p(`${t}-rb2`, "RB", 13),
  p(`${t}-wr1`, "WR", 15, { nflTeam: wrTeam }),
  p(`${t}-wr2`, "WR", 13, { nflTeam: wrTeam }),
  p(`${t}-te`, "TE", 10),
  p(`${t}-flex`, "WR", 11),
  p(`${t}-k`, "K", 8),
  p(`${t}-def`, "DEF", 7),
];

/** `league` with these waiver ranks (team ids, first claim first) and an active roster size. */
function ranked(league: { snapshot: LeagueSnapshot; inputs: ReturnType<typeof buildTestLeague>["inputs"] }, order: string[], maxRosterSize?: number) {
  const teams = league.snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 }));
  return { ...league, snapshot: { ...league.snapshot, teams, settings: { ...league.snapshot.settings, ...(maxRosterSize ? { maxRosterSize } : {}) } } };
}

describe("market.waiverCredit: the best free agent no team claims (A3)", () => {
  it("leaves the claimed free agents out; at least waiverCreditMin; without `claimed` every free agent counts", () => {
    const values = { fa1: 3000, fa2: 800, fa3: 20, rostered: 9000 };
    expect(waiverCredit(values, ["fa1", "fa2", "fa3"], 10_000)).toBe(3000);
    expect(waiverCredit(values, ["fa1", "fa2", "fa3"], 10_000, config.market, new Set(["fa1"]))).toBe(800);
    expect(waiverCredit(values, ["fa1", "fa2", "fa3"], 10_000, config.market, new Set(["fa1", "fa2"]))).toBe(100); // the minimum, 1% of the top
    expect(waiverCredit(values, ["fa1"], 10_000, config.market, new Set(["fa1"]))).toBe(100);
  });
});

describe("waiverCreditFixedPoint: W read off the allocation, the allocation run with W", () => {
  /** A fake allocation: allocate(W) claims `claims[W]`; the claims' best unclaimed value is `next[claims]`. */
  const fake = (claimsAt: Record<number, string[]>, creditAfter: Record<string, number>) => {
    const calls: number[] = [];
    const allocate = (credit: number) => {
      calls.push(credit);
      return { claimed: [claimsAt[credit] ?? []], credit };
    };
    const creditOf = (claimed: ReadonlySet<string>) => creditAfter[[...claimed].sort().join(",")] ?? 0;
    return { allocate, creditOf, calls };
  };
  const always = () => true;
  const never = () => false;

  it("the first W when the best free agent stays unclaimed: one allocation", () => {
    const f = fake({ 500: ["a"] }, { a: 500 });
    const r = waiverCreditFixedPoint(500, f.allocate, f.creditOf, always, 4);
    expect([r.credit, r.pass.credit, r.fix]).toEqual([500, 500, { value: 500, tried: [500], settled: "fixed" }]);
    expect(f.calls).toEqual([500]);
  });

  it("a lower W that no modeled player's value tells apart from the first: that W, with the same allocation (no second run)", () => {
    const f = fake({ 640: ["herbert"] }, { herbert: 470 });
    const r = waiverCreditFixedPoint(640, f.allocate, f.creditOf, never, 4);
    expect(r.credit).toBe(470);
    expect(r.pass.credit).toBe(640);
    expect(r.fix).toEqual({ value: 470, tried: [640], settled: "fixed" });
    expect(f.calls).toEqual([640]);
  });

  it("a W the floor reads differently: allocate again with it until W repeats", () => {
    // With 640 the allocation claims Herbert (→ 470); with 470 it claims Herbert and Lloyd, which leaves 470 again.
    const f = fake({ 640: ["herbert"], 470: ["herbert", "lloyd"] }, { herbert: 470, "herbert,lloyd": 470 });
    const r = waiverCreditFixedPoint(640, f.allocate, f.creditOf, always, 4);
    expect(r.credit).toBe(470);
    expect(r.pass).toEqual({ claimed: [["herbert", "lloyd"]], credit: 470 });
    expect(r.fix).toEqual({ value: 470, tried: [640, 470], settled: "fixed" });
  });

  it("⚠️ a cycle: the smaller W of the cycle and the allocation run with it", () => {
    // 600 → 400 → 500 → 400: the cycle is 400 ↔ 500.
    const f = fake({ 600: ["x"], 400: ["y"], 500: ["z"] }, { x: 400, y: 500, z: 400 });
    const r = waiverCreditFixedPoint(600, f.allocate, f.creditOf, always, 9);
    expect(r.credit).toBe(400);
    expect(r.pass).toEqual({ claimed: [["y"]], credit: 400 });
    expect(r.fix).toEqual({ value: 400, tried: [600, 400, 500], settled: "cycle" });
  });

  it("⚠️ the cap (config.allocation.waiverCreditPasses): the smallest W tried and its allocation; one pass keeps the first W when the floor reads them differently", () => {
    const f = fake({ 900: ["a"], 700: ["b"], 800: ["c"] }, { a: 700, b: 800, c: 600 });
    const r = waiverCreditFixedPoint(900, f.allocate, f.creditOf, always, 3);
    expect(r.fix).toEqual({ value: 700, tried: [900, 700, 800], settled: "cap" });
    expect(r.pass).toEqual({ claimed: [["b"]], credit: 700 });
    const one = fake({ 900: ["a"] }, { a: 700 });
    expect(waiverCreditFixedPoint(900, one.allocate, one.creditOf, always, 1).fix).toEqual({ value: 900, tried: [900], settled: "cap" });
    // A cap that isn't a whole number ≥ 1 reads as 1.
    const bad = fake({ 900: ["a"] }, { a: 700 });
    expect(waiverCreditFixedPoint(900, bad.allocate, bad.creditOf, always, Number.NaN).fix.tried).toEqual([900]);
  });
});

describe("the League model's W: the best free agent its allocation leaves unclaimed (A3)", () => {
  /**
   * Team 2 claims first. Its two WRs share a bye in week 6 and it carries two bench WRs: b1 (3 points, worth `b1Value`) and
   * b2 (4 points, worth 100), with room for no one more (11 players). The 14-point free-agent WR (worth 3,000) is +3 a week
   * to it (and +11 in week 6), so it picks him up; the 5-point free-agent WR (worth 800) is no use to anyone. In week 6 b2
   * still starts after the pickup (in the FLEX), so cutting b1 is the best move by 1 point: within the near-tie tolerance
   * (config.lineups.dropNearTieWeekly a week: about 2.95 points here), so when b1 is worth more than W the cheaper b2 goes.
   */
  const league = (b1Value: number) => {
    const two = [...starters("2", "B6"), p("2-b1", "WR", 3, { value: b1Value }), p("2-b2", "WR", 4, { value: 100 })];
    const built = buildTestLeague({
      teams: [team("1", starters("1")), team("2", two), team("3", starters("3"))],
      freeAgents: [p("fa-wr", "WR", 14, { value: 3000 }), p("fa-x", "WR", 5, { value: 800 })],
      byeWeek: { B6: 6 },
    });
    return ranked(built, ["2", "1", "3"], 11);
  };

  it("W = the best unclaimed free agent's value, found in two allocations when a player's value lies between; the allocation run with that W", () => {
    const l = league(1500);
    const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, OPTS, NO_RISK);
    expect(teamOf(model, "2").faMoves.map((m) => m.add)).toEqual(["fa-wr"]);
    expect(model.market.waiverCredit).toBe(800);
    expect(context.waiverCredit).toEqual({ value: 800, tried: [3000, 800], settled: "fixed" });
    expect([...context.claimedAll]).toEqual(["fa-wr"]);
    // b1 (1,500) lies between 3,000 and 800: with W 800 he is worth more than W, so the near-tie cut takes b2 instead (the
    // allocation run with the final W). With the first W he was worth at most W and the best move cut him.
    expect(teamOf(model, "2").faMoves.map((m) => m.drop)).toEqual(["2-b2"]);
    const passes = { ...NO_RISK, allocation: { ...NO_RISK.allocation, waiverCreditPasses: 1 } };
    const first = buildLeagueModelWithContext(l.snapshot, l.inputs, OPTS, passes);
    expect(first.context.waiverCredit).toEqual({ value: 3000, tried: [3000], settled: "cap" });
    expect(teamOf(first.model, "2").faMoves.map((m) => m.drop)).toEqual(["2-b1"]);
  });

  it("without near-tie cuts (config.lineups.dropNearTieWeekly 0, as with long-term values) the allocation doesn't read W: W from the first allocation, no second one", () => {
    // (With them, the claimed free agent's own value always lies between the two W's: a second allocation runs whenever
    // W drops, since a later move could cut him.)
    const l = league(1500);
    const noTie = { ...NO_RISK, lineups: { ...NO_RISK.lineups, dropNearTieWeekly: 0 } };
    const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, OPTS, noTie);
    expect(context.waiverCredit).toEqual({ value: 800, tried: [3000], settled: "fixed" });
    expect(model.market.waiverCredit).toBe(800);
    // No near-tie: the best move cuts b1, whatever his value.
    expect(teamOf(model, "2").faMoves).toMatchObject([{ add: "fa-wr", drop: "2-b1" }]);
  });

  it("the best free agent nobody picks up: W is his value after one allocation, as before A3", () => {
    const l = league(1500);
    const stash = { ...l, snapshot: { ...l.snapshot, players: { ...l.snapshot.players }, freeAgents: [...l.snapshot.freeAgents] } };
    const extra = buildTestLeague({ teams: [], freeAgents: [p("fa-big", "WR", 2, { value: 5000 })] });
    stash.snapshot.players["fa-big"] = extra.snapshot.players["fa-big"] as NonNullable<LeagueSnapshot["players"][string]>;
    stash.snapshot.freeAgents.push("fa-big");
    const market = stash.inputs.market as NonNullable<typeof stash.inputs.market>;
    const inputs = { ...stash.inputs, players: { ...stash.inputs.players, "fa-big": extra.inputs.players["fa-big"] as NonNullable<(typeof extra.inputs.players)[string]> }, market: { ...market, values: { ...market.values, "fa-big": 5000 }, topValue: 5000 } };
    const { model, context } = buildLeagueModelWithContext(stash.snapshot, inputs, OPTS, NO_RISK);
    expect(teamOf(model, "2").faMoves.map((m) => m.add)).toEqual(["fa-wr"]);
    expect(context.waiverCredit).toEqual({ value: 5000, tried: [5000], settled: "fixed" });
  });

  it("faAllocation 'independent' (Checkpoint 4's rule): W is the best free agent of all", () => {
    const l = league(1500);
    const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, { ...OPTS, faAllocation: "independent" }, NO_RISK);
    expect(model.market.waiverCredit).toBe(3000);
    expect(context.waiverCredit).toEqual({ value: 3000, tried: [3000], settled: "fixed" });
    expect(context.claimedAll.size).toBe(0);
  });

  it("random leagues: W is the best free agent the model's own allocation leaves unclaimed, deterministically", { timeout: 60_000 }, () => {
    let lower = 0;
    for (const seed of [21, 22, 23, 24]) {
      const raw = randomLeague({ teams: 6, seed, freeAgentsPerPosition: 4 });
      const rand = mulberry32(seed);
      const ids = raw.snapshot.teams.map((t) => t.id).sort(() => rand() - 0.5);
      const l = ranked(raw, ids);
      const opts = { now: TEST_NOW, scenarios: 4, seed: 3, sims: 0 };
      const { model, context } = buildLeagueModelWithContext(l.snapshot, l.inputs, opts);
      const claimed = new Set(model.teams.flatMap((t) => t.faMoves.map((m) => m.add)));
      expect([...context.claimedAll].sort(), `seed ${seed}`).toEqual([...claimed].sort());
      const values: Record<string, number> = {};
      for (const [id, pm] of Object.entries(model.players)) if (pm.value) values[id] = pm.value.value;
      const top = l.inputs.market?.topValue ?? 0;
      if (context.waiverCredit.settled === "fixed") expect(model.market.waiverCredit, `seed ${seed}`).toBe(waiverCredit(values, context.freeAgentIds, top, config.market, claimed));
      if (model.market.waiverCredit < waiverCredit(values, context.freeAgentIds, top)) lower++;
      expect(buildLeagueModel(l.snapshot, l.inputs, opts).market).toEqual(model.market);
    }
    expect(lower).toBeGreaterThan(0); // in these leagues a claimed free agent did set the old W
  });
});

describe("the trade evaluation's W, perception and long-term alike (evaluate.ts)", () => {
  /** My weak WR2 (4 points): V*(me) picks up the 9-point free-agent WR (worth 2,025); the 6-point free-agent QB (900) stays on the wire. */
  const edit = (spec: TestLeagueSpec) => {
    const mine = spec.teams[0] as TestTeam;
    mine.roster = mine.roster.map((x) => (x.id === "wb1" ? flat("wb1", "WR", 4) : x.id === "rc1" ? flat("rc1", "RB", 10) : x));
    const two = spec.teams[1] as TestTeam;
    two.roster = two.roster.map((x) => (x.id === "rc2" ? flat("rc2", "RB", 10) : x));
    spec.freeAgents = [...(spec.freeAgents ?? []), flat("zfa", "WR", 9)];
  };

  it("the context's W is the League model's: the best free agent left unclaimed (my own pickup included)", () => {
    const { snapshot, inputs } = handLeague(edit);
    const I = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }));
    expect(I.me?.vstar.moves.map((m) => m.add)).toEqual(["zfa"]);
    expect(I.credit).toBe(900);
    expect(I.credit).toBe(I.model.market.waiverCredit);
  });

  it("dynasty: the long-term W leaves the claimed free agents out too; 'independent' counts every free agent", () => {
    const { snapshot, inputs } = handLeague(edit, { leagueType: "dynasty" });
    if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
    const I = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }));
    expect(I.future?.credit).toBe(900);
    const each = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, faAllocation: "independent" }));
    expect(each.future?.credit).toBe(2025);
  });
});
