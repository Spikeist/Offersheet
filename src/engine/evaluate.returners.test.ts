/**
 * IR players in the trade evaluation (evaluate.ts rule 5 and "IR players"; search.ts pools; planner reply to Checkpoint 4,
 * change 5): where a traded IR player goes, the spec every later solve of a side uses, the roster spot a returner needs
 * in the final pricing, the give and get pools, screening, and a no-op with displacements on both sides. Hand-built
 * leagues (trade.testing.ts handLeague: 4 full rosters of 10, NFL week 5 of a 1–8 regular season, one IR slot each).
 */
import { describe, expect, it } from "vitest";
import { tradePackage } from "./benefit";
import { config } from "./config";
import { buildTradeContext, evaluateExact, legalSide, screenTrade, sideEval, simulateTrade, tradeInternals, type TeamState, type TradeContextOptions } from "./evaluate";
import type { LeagueSnapshot } from "./model";
import { returnersOf } from "./optimizer";
import { buildPools } from "./search";
import { defaultTradeSettings } from "./settings";
import { rosValue, solveEvWeeks, teamEval, type TableRow } from "./teamValue";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });

/** An IR RB of team t, back in week 7 (25% / 50% / 25% over weeks 6–8). */
const irRb = (t: number, extra: Partial<TestPlayer> = {}): TestPlayer => flat(`ir${t}`, "RB", 9, { injury: "IR", injuryReturnWeek: 7, ...extra });

function context(edit: (spec: TestLeagueSpec) => void, opts: Partial<TradeContextOptions> = {}, snap: (s: LeagueSnapshot) => LeagueSnapshot = (s) => s) {
  const { snapshot, inputs } = handLeague(edit);
  const ctx = buildTradeContext(snap(snapshot), inputs, { now: TEST_NOW, scenarios: 0, ...opts });
  const I = tradeInternals(ctx);
  return { ctx, I, me: I.me as TeamState, two: I.byId.get("2") as TeamState };
}

const withIr = (teams: Record<number, TestPlayer>) => (spec: TestLeagueSpec) => {
  for (const [t, player] of Object.entries(teams)) (spec.teams[Number(t) - 1] as { ir?: TestPlayer[] }).ir = [player];
};

describe("roster legality, rule 5: a traded IR player's place", () => {
  it("received into my open IR slot (his status is one it takes): a returner, no active spot; the giver's IR opens, no active spot does", () => {
    const { I, me, two } = context(withIr({ 2: irRb(2) }));
    const mine = legalSide(I, me, me.roster, ["wc1"], ["ir2"], "exact", "You");
    if ("illegal" in mine) throw new Error(mine.illegal);
    expect(mine.ir).toEqual(["ir2"]);
    expect(returnersOf(mine.spec).map((r) => r.id)).toEqual(["ir2"]);
    expect(mine.roster).not.toContain("ir2");
    // I gave an active player and took no active spot: rule 4 fills the spot that opened, at the position I gave up (a
    // received IR player in my IR slot isn't received onto my active roster: planner reply to Checkpoint 7b, section 5).
    expect(mine.change.adds).toEqual(["fw"]);
    expect(mine.change.openSpots).toEqual([{ playerId: "fw", pos: "WR" }]);
    expect(mine.change.drops).toEqual([]);
    const theirs = legalSide(I, two, two.roster, ["ir2"], ["wc1"], "exact", "Team 2");
    if ("illegal" in theirs) throw new Error(theirs.illegal);
    expect(theirs.ir).toEqual([]);
    expect(returnersOf(theirs.spec)).toEqual([]);
    // Team 2's active roster gains a player (its IR slot opened, no active spot did): rule 2 drops one.
    expect(theirs.change.drops).toHaveLength(1);
    expect(theirs.roster).toHaveLength(10);
  });

  it("no open IR slot, or a status the slot doesn't take (OUT, with the default IR and PUP): he joins the active roster", () => {
    const full = context(withIr({ 1: irRb(1), 2: irRb(2) }));
    const a = legalSide(full.I, full.me, full.me.roster, ["wc1"], ["ir2"], "exact", "You");
    if ("illegal" in a) throw new Error(a.illegal);
    expect(a.roster).toContain("ir2");
    expect(a.ir).toEqual(["ir1"]);
    expect(a.change).toEqual({ drops: [], adds: [] });
    const out = context(withIr({ 2: irRb(2, { injury: "OUT" }) }));
    const b = legalSide(out.I, out.me, out.me.roster, ["wc1"], ["ir2"], "exact", "You");
    if ("illegal" in b) throw new Error(b.illegal);
    expect(b.roster).toContain("ir2");
    expect(b.ir).toEqual([]);
    // A league whose IR slots take OUT players (Sleeper's reserve_allow_out): into the slot.
    const sleeperish = context(withIr({ 2: irRb(2, { injury: "OUT" }) }), {}, (s) => ({ ...s, settings: { ...s.settings, irEligible: ["IR", "PUP", "OUT"] } }));
    const c = legalSide(sleeperish.I, sleeperish.me, sleeperish.me.roster, ["wc1"], ["ir2"], "exact", "You");
    if ("illegal" in c) throw new Error(c.illegal);
    expect(c.ir).toEqual(["ir2"]);
    expect(c.roster).not.toContain("ir2");
  });

  it("giving my IR player opens no active spot (no free agent comes in) and takes his returner row out of my lineups", () => {
    const { I, me } = context(withIr({ 1: irRb(1), 2: irRb(2) }));
    expect(returnersOf(me.stream).map((r) => r.id)).toEqual(["ir1"]);
    const mine = legalSide(I, me, me.roster, ["ir1"], [], "exact", "You");
    if ("illegal" in mine) throw new Error(mine.illegal);
    expect(mine.change).toEqual({ drops: [], adds: [] });
    expect(mine.roster).toEqual([...me.roster]);
    expect(mine.ir).toEqual([]);
    expect(returnersOf(mine.spec)).toEqual([]);
  });
});

describe("exact evaluation with IR players: the sides' specs after the trade and the final pricing", () => {
  it("a returner I receive scores for me from his return (in V*(after)'s lineups), and my full roster gives him a spot from then", () => {
    const { I } = context(withIr({ 2: irRb(2) }));
    const x = evaluateExact(I, trade("2", ["wc1"], ["ir2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.evaluation.required.me.adds).toHaveLength(1);
    expect(x.mine.roster).not.toContain("ir2");
    // My active roster is full again after the free agent: from week 7 (index 2) the cheapest player goes.
    expect(x.mine.displaced).toEqual([{ id: expect.any(String), from: 2, returner: "ir2" }]);
    // He starts at FLEX (9 against my bench RB's 4.1) once he's back: my regular-season lineup gains.
    expect(x.evaluation.dPPW).toBeGreaterThan(0);
    // The partner's side lost its returner (its baseline had him, with a drop from week 7).
    expect(x.partner.base.displaced.map((d) => d.returner)).toEqual(["ir2"]);
    expect(x.theirs.displaced).toEqual([]);
    expect(x.evaluation.flags.injured).toEqual(["ir2"]);
  });

  it("the card's forced moves (TradeEvaluation.required) name the IR player placed in my IR slot and the player his return displaces, by NFL week", () => {
    const { I } = context(withIr({ 2: irRb(2) }));
    const x = evaluateExact(I, trade("2", ["wc1"], ["ir2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    const d = x.mine.displaced[0] as { id: string; from: number; returner: string };
    expect(x.evaluation.required.me).toEqual({ drops: [], adds: ["fw"], openSpots: [{ playerId: "fw", pos: "WR" }], toIR: ["ir2"], displaced: [{ playerId: d.id, week: 7, returner: "ir2" }] });
    expect(I.league.lp.weeks.weeks[d.from]).toBe(7);
    // Team 2 gave its returner away: its baseline displacement is gone, and nothing new is forced on it.
    expect(x.evaluation.required.partner).toEqual({ drops: [expect.any(String)], adds: [] });
    // The steps' versions carry the same fields (TradeStep.required is the version's own).
    const s = simulateTrade(I, x, "screen", null);
    expect(s.required).toEqual(x.evaluation.required);
  });

  it("⚠️ a displacement the baseline has too isn't the trade's move: not on the card (rosterChangeOf)", () => {
    const { I, me } = context(withIr({ 1: irRb(1) }));
    const base = me.base.displaced[0] as { id: string; from: number; returner: string };
    expect(base.returner).toBe("ir1");
    // A starters' swap that leaves my bench alone: after it the same player still goes from the same week.
    const keep = ["wa1", "wb1"].find((id) => id !== base.id) as string;
    const x = evaluateExact(I, trade("2", [keep], ["wa2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.mine.displaced).toEqual([base]);
    expect(x.evaluation.required.me).toEqual({ drops: [], adds: [] });
    // Giving that very player away moves the displacement to someone else: that one is the trade's.
    const y = evaluateExact(I, trade("2", [base.id], ["wc2"]), 4);
    if ("illegal" in y) throw new Error(y.illegal);
    const after = y.mine.displaced[0] as { id: string; from: number; returner: string };
    expect(after.id).not.toBe(base.id);
    expect(y.evaluation.required.me.displaced).toEqual([{ playerId: after.id, week: I.league.lp.weeks.weeks[after.from], returner: "ir1" }]);
  });

  it("the final pricing equals the roster's lineups with the displaced player masked from the return on (EV mode)", () => {
    const { I, me } = context(withIr({ 1: irRb(1) }));
    const base = me.base;
    expect(base.displaced).toHaveLength(1);
    const d = base.displaced[0] as { id: string; from: number };
    const rows: TableRow[] = [];
    for (const id of me.vstar.roster) {
      const r = I.league.table.rows.get(id);
      if (r) rows.push(r);
    }
    const all = [...rows, ...me.stream.rows, ...returnersOf(me.stream)];
    const masked = all.map((r) => (r.id === d.id ? { ...r, ev: Float64Array.from(r.ev, (x, w) => (w >= d.from ? 0 : x)) } : r));
    expect(Array.from(base.lv)).toEqual(Array.from(solveEvWeeks(teamEval(masked, I.league.slots), I.W).lv));
    // A spec without the returner prices another roster: the memo keeps them apart.
    const plain = sideEval(I, me, me.vstar, { rows: me.stream.rows, positions: me.stream.positions });
    expect(plain).not.toBe(base);
    expect(plain.displaced).toEqual([]);
    expect(sideEval(I, me, me.vstar)).toBe(base);
  });

  it("a no-op with displacements on both sides moves no odds: ΔPO = ΔCH = ΔEW = 0 exactly (bench WRs swapped, both teams' returners back)", () => {
    const { I } = context(withIr({ 1: irRb(1), 2: irRb(2) }));
    expect(I.teams.slice(0, 2).map((t) => t.base.displaced.length)).toEqual([1, 1]);
    const x = evaluateExact(I, trade("2", ["wc1"], ["wc2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.mine.displaced).toHaveLength(1);
    expect(x.theirs.displaced).toHaveLength(1);
    expect(Array.from(x.mine.score.mean)).toEqual(Array.from((I.me as TeamState).base.score.mean));
    expect(Array.from(x.theirs.score.mean)).toEqual(Array.from(x.partner.base.score.mean));
    for (const stage of ["screen", "final"] as const) {
      const s = simulateTrade(I, x, stage, null);
      expect(s.dPO).toBe(0);
      expect(s.dCH).toBe(0);
      expect(s.dEW).toBe(0);
    }
  });

  it("irReturners false: Checkpoint 4's rule (no returner rows, no displacement, the IR players untradable)", () => {
    const { I, me } = context(withIr({ 1: irRb(1), 2: irRb(2) }), { irReturners: false });
    expect(returnersOf(me.stream)).toEqual([]);
    expect(me.base.displaced).toEqual([]);
    expect(evaluateExact(I, trade("2", ["wc1"], ["ir2"]), 4)).toEqual({ illegal: "Testy McTest ir2 is on Team 2's IR or taxi squad: only active-roster players can be traded here." });
  });
});

describe("the packages' open-spot credit counts active roster spots (review of track E: an IR slot isn't one)", () => {
  /** g for the side that receives `recv` and gives `give`, its credit from `spots` (or the player counts when absent). */
  const gOf = (I: ReturnType<typeof context>["I"], recv: string[], give: string[], spots?: { recv: number; give: number }) => tradePackage({ players: recv }, { players: give }, I.values, I.credit, config.market, spots).g;

  it("a partner giving an active player and an IR player for one player opens no active spot: no credit (screening and exact agree)", () => {
    // My IR slot is full, so their IR RB joins my active roster; their active roster loses one player and gains one.
    const { I, two } = context(withIr({ 1: irRb(1), 2: irRb(2) }));
    const x = evaluateExact(I, trade("2", ["wc1"], ["wc2", "ir2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    const want = gOf(I, ["wc1"], ["wc2", "ir2"], { recv: 1, give: 1 });
    expect(x.evaluation.gPartner).toBe(want);
    // Counting players credited them a spot their roster never opens.
    expect(gOf(I, ["wc1"], ["wc2", "ir2"])).toBeGreaterThan(want + 0.1);
    expect(screenTrade(I, two, ["wc1"], ["wc2", "ir2"])?.gPartner).toBe(want);
    // My side: two players onto my active roster for one, so the spot I fill counts on what I give (the counts agree).
    expect(x.evaluation.gMine).toBe(gOf(I, ["wc2", "ir2"], ["wc1"], { recv: 2, give: 1 }));
    // Phase 4c (neutral throw-ins, planner reply to Checkpoint 4b, change 2): their bench WR, worth less than W on the
    // side moving more players, is left out with the spot he takes on my roster: W (my bench WR, floored) for their IR RB.
    expect(I.values.wc2 as number).toBeLessThan(I.credit);
    expect(x.evaluation.value).toEqual({ given: I.credit, received: I.values.ir2 ?? 0 });
  });

  it("my IR player given with an active one for one player: my active roster gains one and loses one, so no spot is credited to me", () => {
    const { I } = context(withIr({ 1: irRb(1), 2: irRb(2) }));
    const x = evaluateExact(I, trade("2", ["ir1", "wc1"], ["wa2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.evaluation.gMine).toBe(gOf(I, ["wa2"], ["ir1", "wc1"], { recv: 1, give: 1 }));
    // Counting players, my side was credited an open spot: the trade read better for me than it is.
    expect(gOf(I, ["wa2"], ["ir1", "wc1"])).toBeGreaterThan(x.evaluation.gMine + 0.1);
    // Their IR slot is full, so my IR RB joins their active roster: two on, one off, the spot they fill counts.
    expect(x.evaluation.gPartner).toBe(gOf(I, ["ir1", "wc1"], ["wa2"], { recv: 2, give: 1 }));
  });

  it("an IR player received into my open IR slot fills no active spot: the active player I let go opens one (credited to what I get)", () => {
    const { I } = context(withIr({ 2: irRb(2) }));
    const x = evaluateExact(I, trade("2", ["wc1"], ["ir2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.evaluation.gMine).toBe(gOf(I, ["ir2"], ["wc1"], { recv: 0, give: 1 }));
    expect(x.evaluation.value.received).toBe((I.values.ir2 ?? 0) + I.credit);
    // Their side: an IR player off their IR, an active player on: the spot they fill counts on what they give.
    expect(x.evaluation.gPartner).toBe(gOf(I, ["wc1"], ["ir2"], { recv: 1, give: 0 }));
  });

  it("without an IR player in the trade the two sides mirror each other exactly, as before", () => {
    const { I } = context(withIr({ 1: irRb(1), 2: irRb(2) }));
    const x = evaluateExact(I, trade("2", ["wc1", "rc1"], ["wb2"]), 4);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.evaluation.gMine).toBe(gOf(I, ["wb2"], ["wc1", "rc1"]));
    expect(x.evaluation.gPartner).toBe(gOf(I, ["wc1", "rc1"], ["wb2"]));
  });
});

describe("my risky weeks with IR returners (review of track E)", () => {
  it("a starter's bye counts only in weeks he's on my active roster: not after a return displaces him", () => {
    // Points only (byes alone flag a week). My RB1, WR1 and TE share a bye in week 8; my IR TE (10) is back in week 7 and
    // takes the TE spot, so my weak TE (2: below my bench RB and WR for the FLEX) costs nothing from then and goes from
    // week 7. He's a likely starter before that (the TE in week 5, his return's 25% week 6 aside).
    const edit = (spec: TestLeagueSpec) => {
      const t = spec.teams[0] as { roster: TestPlayer[]; ir?: TestPlayer[] };
      t.roster = t.roster.map((x) => (x.id === "te1" ? flat("te1", "TE", 2, { nflTeam: "BYE" }) : ["ra1", "wa1"].includes(x.id) ? { ...x, nflTeam: "BYE" } : x));
      t.ir = [flat("irte", "TE", 10, { injury: "IR", injuryReturnWeek: 7 })];
      spec.byeWeek = { BYE: 8 };
    };
    const pointsOnly = (s: LeagueSnapshot): LeagueSnapshot => ({ ...s, settings: { ...s.settings, pointsOnly: true } });
    const on = context(edit, {}, pointsOnly);
    expect(on.me.base.displaced).toEqual([{ id: "te1", from: 2, returner: "irte" }]);
    // Two starters on bye in week 8 (the TE is gone by then): under the riskyByes bar.
    expect(on.I.riskyWeeks).toEqual([]);
    // Checkpoint 4's rule (no returner): all three are on bye that week.
    const off = context(edit, { irReturners: false }, pointsOnly);
    expect(off.I.riskyWeeks).toEqual([8]);
  });
});

describe("screening and the pools with IR players", () => {
  it("screening a returner received into my open IR slot: my EV ROS gains his weeks back (V*(me)'s lineups plus his row)", () => {
    const { I, me, two } = context(withIr({ 2: irRb(2) }));
    const s = screenTrade(I, two, [], ["ir2"]);
    expect(s).not.toBeNull();
    const rows: TableRow[] = [...me.vstar.team.rows, I.league.table.rows.get("ir2") as TableRow];
    const want = rosValue(solveEvWeeks(teamEval(rows, I.league.slots), I.W).lv, I.weights) - me.baseEv.ros;
    expect(s?.myDelta).toBeCloseTo(want, 9);
    expect(s?.myDelta).toBeGreaterThan(0);
  });

  it("G holds my IR returner (ranked by his surplus score), H the partner's IR player (as a returner into my open slot, else like anyone)", () => {
    const open = context(withIr({ 1: irRb(1, { injuryReturnWeek: 6 }), 3: irRb(3) }));
    const settings = defaultTradeSettings();
    const pools = buildPools(open.I, settings, null);
    expect(pools.give).toContain("ir1");
    expect(open.I.model.teams[0]?.players.ir1?.surplusScore).toEqual(expect.any(Number));
    // My IR slot is full (ir1): team 3's IR RB comes like any player (taking an active spot).
    expect(pools.get.get("3")?.pool).toContain("ir3");
    // With my slot open, he comes as a returner.
    const roomy = context(withIr({ 3: irRb(3) }));
    expect(buildPools(roomy.I, settings, null).get.get("3")?.pool).toContain("ir3");
    // Checkpoint 4's rule: neither pool holds an IR player.
    const old = context(withIr({ 1: irRb(1, { injuryReturnWeek: 6 }), 3: irRb(3) }), { irReturners: false });
    const oldPools = buildPools(old.I, settings, null);
    expect(oldPools.give).not.toContain("ir1");
    expect(oldPools.get.get("3")?.pool).not.toContain("ir3");
  });
});
