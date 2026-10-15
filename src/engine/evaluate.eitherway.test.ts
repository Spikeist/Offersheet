/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, items 2.1 and 2.2): no credit for free-agent moves I could make anyway
 * (evaluate.ts eitherWayMoves: a move my pickups after a trade make that clears the pickup bar on my baseline too is made in
 * both versions, through the trade's own "before"; ⚠️ one whose drop my baseline already cut, with the drop my optimizer
 * itself would make there: review of wave B, finding B-2), and my roster moves as the card lists them (myRosterMoves). A
 * hand-built league whose free-agent pickups are held to one move a run (config mocked), so my baseline leaves a second
 * pickup that clears the bar unmade, which a trade's pickups then make; the market blend off and expected-value lineups (no
 * scenarios), so each projection is its points and every lineup number is exact. Made-up players.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, marketBlend: { ...c.marketBlend, weight: 0 }, freeAgentOptimizer: { ...c.freeAgentOptimizer, faMaxMoves: 1 } } };
});

import { tradePackage } from "./benefit";
import { config } from "./config";
import { buildTradeContext, eitherWayMoves, evaluateExact, simulateTrade, tradeInternals, tradeSides, type ExactTrade, type TeamState, type TradeInternals } from "./evaluate";
import { poolRestriction } from "./optimizer";
import { defaultTradeSettings } from "./settings";
import { ppw } from "./teamValue";
import { TEST_NOW, type TestLeagueSpec, type TestPlayer } from "./testLeague";
import { flat, handLeague } from "./trade.testing";
import type { TradeAsset } from "./tradeModel";

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

// My team (1): QB 20, RBs 15 and 12, WRs 14 and 11, TE 8, the FLEX my bench RB rc1 (4.1), my bench WR wc1 (3.1). Two free
// agents help me alone (every other team starts RBs at 14 and 13, a 13 in its FLEX and a TE at 12, so neither is an upgrade
// there): fx, an RB at 13 (+8.9 a week: RB2, my RB 12 to the FLEX), and fy, a TE at 12 (+7.9: TE, my TE 8 to the FLEX). Held
// to one move, my baseline takes fx for wc1, and fy (then +4 a week, for rc1) clears the bar there too but isn't made.
const league = handLeague((spec) => {
  for (const t of ["2", "3", "4"]) {
    swapPlayer(spec, t, `ra${t}`, flat(`ra${t}`, "RB", 13));
    swapPlayer(spec, t, `rb${t}`, flat(`rb${t}`, "RB", 13));
    swapPlayer(spec, t, `rc${t}`, flat(`rc${t}`, "RB", 14));
    swapPlayer(spec, t, `te${t}`, flat(`te${t}`, "TE", 12));
  }
  spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "RB", 13), flat("fy", "TE", 12)];
});

function contextOf(settings = defaultTradeSettings()): { I: TradeInternals; me: TeamState; exact: (give: string[], get: string[]) => ExactTrade } {
  const I = tradeInternals(buildTradeContext({ ...league.snapshot, myTeamId: "1" }, league.inputs, { now: TEST_NOW, scenarios: 0, settings }));
  const exact = (give: string[], get: string[]): ExactTrade => {
    const x = evaluateExact(I, { partnerId: "2", give: players(give), get: players(get) }, 3);
    if ("illegal" in x) throw new Error(x.illegal);
    return x;
  };
  return { I, me: I.me as TeamState, exact };
}

/** My pickups after a trade (V*(after)'s steps). */
function afterMoves(I: TradeInternals, me: TeamState, x: ExactTrade, give: string[], get: string[]) {
  const sides = tradeSides(I, me, x.partner, give, get, "Team 2");
  if ("illegal" in sides) throw new Error(sides.illegal);
  return sides.mine;
}

const pairs = (moves: readonly { add: string; drop: string | null }[]) => moves.map((m) => [m.add, m.drop]);

describe("no credit for moves I could make anyway (item 2.1)", () => {
  it("a move that clears the pickup bar on my baseline too goes to both versions: the trade's numbers start from my baseline with it", () => {
    const { I, me, exact } = contextOf();
    // My baseline: one move (the cap), fx for wc1.
    expect(pairs(me.vstar.moves)).toEqual([["fx", "wc1"]]);
    // wc1 for their bench RB at 14: fx then adds 1 a week, fy 4, so my one pickup after the trade is fy, for rc1.
    const x = exact(["wc1"], ["rc2"]);
    const after = afterMoves(I, me, x, ["wc1"], ["rc2"]);
    expect(pairs(after.moves)).toEqual([["fy", "rc1"]]);
    // On my baseline (fx for wc1 made) fy for rc1 gains 4 a week, over the bar: an either-way move.
    expect(pairs(eitherWayMoves(I, me, after))).toEqual([["fy", "rc1"]]);
    // The trade's "before": my baseline with it made.
    expect([...(x.before?.roster ?? [])].sort()).toEqual(me.vstar.roster.map((id) => (id === "rc1" ? "fy" : id)).sort());
    // My lineup gain is the trade's alone, measured from that "before": their RB at 14 where my baseline has fx at 13, about
    // +1 a week (less the chance either misses a game: future injury risk), where the baseline would credit fy's +4 a week
    // to the trade too.
    const weeks = I.league.lp.weeks.weeks;
    const before = x.before;
    if (!before) throw new Error("no before");
    expect(x.evaluation.dPPW).toBe(ppw(x.mine.lv, weeks, I.regWeeks) - ppw(before.lv, weeks, I.regWeeks));
    expect(x.evaluation.dPPW).toBeGreaterThan(0.8);
    expect(x.evaluation.dPPW).toBeLessThanOrEqual(1 + 1e-9);
    expect(ppw(before.lv, weeks, I.regWeeks) - ppw(me.base.lv, weeks, I.regWeeks)).toBeGreaterThan(3);
    for (const w of x.evaluation.detail.weekly) {
      expect(w.after - w.before).toBeGreaterThan(0.8);
      expect(w.after - w.before).toBeLessThanOrEqual(1 + 1e-9);
    }
    // My market package is the trade's alone (fy and rc1 counted neither way: the move is in both versions).
    const alone = tradePackage({ players: ["rc2"] }, { players: ["wc1"] }, I.values, I.credit, config.market);
    expect(x.evaluation.value).toEqual({ given: alone.give, received: alone.recv });
    expect(x.evaluation.gMine).toBeCloseTo(alone.g, 12);
    expect(x.evaluation.required.me.faMoves).toBeUndefined();
  });

  it("the card's list: the move made either way on its own line, the League page's pickup the trade leaves out as a skip", () => {
    const { exact } = contextOf();
    const x = exact(["wc1"], ["rc2"]);
    expect(x.evaluation.myMoves?.assumed).toEqual([{ add: "fy", drop: "rc1", eitherWay: true }]);
    // fx isn't picked up after the trade (+1 a week, and the one move is fy's): his drop, wc1, goes in the trade, so the
    // player received takes his roster spot (review of wave B, finding moves-skip-reason-spot-taken; "unneeded" before).
    expect(x.evaluation.myMoves?.moves).toEqual([{ kind: "skip", week: 5, add: "fx", keep: null, why: "spot", by: ["rc2"] }]);
  });

  it("B measures the trade alone: every change starts from the trade's own before, simulated on the same seasons", () => {
    const { I, me, exact } = contextOf();
    const x = exact(["wc1"], ["rc2"]);
    const sim = I.sim;
    if (!sim) throw new Error("no odds");
    const s = simulateTrade(I, x, "final", null);
    // The old rule, from the baseline: the same "after", a "before" without fy.
    const old = simulateTrade(I, { ...x, before: null }, "final", null);
    expect(old.before).toBeUndefined();
    const before = s.before;
    if (!before) throw new Error("no before");
    // fy helps my odds: the trade's own before is above the baseline, and both measure up to the same "after".
    expect(before.pPlayoffs).toBeGreaterThan(sim.base.final.pPlayoffs);
    expect((s.dPO as number) + before.pPlayoffs).toBeCloseTo((old.dPO as number) + sim.base.final.pPlayoffs, 12);
    expect(s.dPO as number).toBeLessThan(old.dPO as number);
    expect(s.b as number).toBeLessThan(old.b as number);
    // The partner's numbers come from the same two runs: its "after" is the same either way.
    expect(s.them).toBeDefined();
    expect(old.them).toBeDefined();
    if (s.them && old.them) expect(s.them.dPO + s.them.before.pPlayoffs).toBeCloseTo(old.them.dPO + old.them.before.pPlayoffs, 12);
    // A "before" that is my baseline itself reads exactly as the baseline does, on every block: the per-trade machinery adds
    // nothing of its own, so a trade without an either-way move reads as it did.
    for (const stage of ["final", "shown", "screen"] as const) {
      const same = simulateTrade(I, { ...x, before: me.base }, stage, null);
      const base = simulateTrade(I, { ...x, before: null }, stage, null);
      expect(same.dPO).toBe(base.dPO);
      expect(same.dCH).toBe(base.dCH);
      expect(same.dPrizes).toEqual(base.dPrizes);
      expect(same.b).toBe(base.b);
      expect(same.detail.winChance).toEqual(base.detail.winChance);
      expect(same.them?.helps).toBe(base.them?.helps);
    }
  });
});

describe("⚠️ a move whose drop my baseline already cut (review of wave B, finding B-2)", () => {
  it("its free agent is tried with the drop my optimizer itself would make there: the trade gets no credit for a pickup I could make anyway", () => {
    const { I, me, exact } = contextOf();
    // rc1 for their RB at 14: my pickup after it is fy, for wc1, whom my baseline already cut for fx, so that very move can't
    // be made on my baseline; fy with the drop my optimizer makes there (rc1, my bench RB) gains 4 a week, over the bar: the
    // either-way move, as for wc1 for the same RB (the decisions' first reading kept fy with this trade, crediting it with him).
    const x = exact(["rc1"], ["rc2"]);
    const after = afterMoves(I, me, x, ["rc1"], ["rc2"]);
    expect(pairs(after.moves)).toEqual([["fy", "wc1"]]);
    expect(pairs(eitherWayMoves(I, me, after))).toEqual([["fy", "rc1"]]);
    const same = exact(["wc1"], ["rc2"]);
    expect([...(x.before?.roster ?? [])].sort()).toEqual([...(same.before?.roster ?? [])].sort());
    // Both trades leave the same roster against the same "before" (my baseline with fy for rc1): the same numbers.
    expect([...x.mine.roster].sort()).toEqual([...same.mine.roster].sort());
    expect(x.evaluation.dPPW).toBe(same.evaluation.dPPW);
    const s = simulateTrade(I, x, "final", null);
    expect(s.b).toBe(simulateTrade(I, same, "final", null).b);
    expect(s.b as number).toBeLessThan(simulateTrade(I, { ...x, before: null }, "final", null).b as number);
    // The card: their RB takes the roster spot of the League page's fx (my baseline's drop for him, wc1, I send away; it went
    // to fy after the trade), fy assumed either way (his drop, rc1, I send away), wc1 dropped either way.
    expect(x.evaluation.myMoves).toEqual({
      moves: [{ kind: "skip", week: 5, add: "fx", keep: null, why: "spot", by: ["rc2"] }],
      assumed: [
        { add: "fy", drop: null, eitherWay: true },
        { add: null, drop: "wc1" },
      ],
    });
  });

  it("a giveaway whose open spot takes the League page's pickup reads as nothing gained (Helps you 70 under the first reading)", () => {
    const { I, me, exact } = contextOf();
    // My bench RB for nothing: the spot takes the best free agent at RB, fx (my baseline's own pickup); then fy comes in for
    // wc1. My roster after the trade is my baseline with fy for rc1, a move that clears the bar there: the "before" makes it.
    const x = exact(["rc1"], []);
    expect([...x.mine.roster].sort()).toEqual([...(x.before?.roster ?? [])].sort());
    expect(x.evaluation.dPPW).toBe(0);
    expect(simulateTrade(I, x, "final", null).b as number).toBeLessThanOrEqual(0);
    expect(simulateTrade(I, { ...x, before: null }, "final", null).b as number).toBeGreaterThan(5);
    expect(me.vstar.moves.map((m) => m.add)).toEqual(["fx"]);
    expect(x.evaluation.myMoves).toEqual({
      moves: [{ kind: "openSpot", week: 5, spot: { playerId: "fx", pos: "RB" }, pickup: { keep: null } }],
      assumed: [
        { add: "fy", drop: null, eitherWay: true },
        { add: null, drop: "wc1" },
      ],
    });
  });
});

describe("moves that stay with the trade (item 2.1)", () => {
  it("one whose free agent another team claims in my baseline stays with the trade; an untouchable is never the drop the test makes", () => {
    const { I, me, exact } = contextOf();
    const after = afterMoves(I, me, exact(["wc1"], ["rc2"]), ["wc1"], ["rc2"]);
    expect(eitherWayMoves(I, me, after)).toHaveLength(1);
    expect(eitherWayMoves(I, { ...me, pool: poolRestriction(["fy"]) }, after)).toEqual([]);
    // fy for rc1 can't be made with rc1 untouchable; fy with the drop my optimizer makes instead, te1 (my TE at 8), clears the
    // bar there too: still a pickup I could make anyway, and rc1 stays.
    const locked = contextOf({ ...defaultTradeSettings(), untouchables: ["rc1"] });
    const either = eitherWayMoves(locked.I, locked.me, afterMoves(locked.I, locked.me, locked.exact(["wc1"], ["rc2"]), ["wc1"], ["rc2"]));
    expect(pairs(either)).toEqual([["fy", "te1"]]);
  });

  it("one under the bar on my baseline: a pickup only the trade makes worthwhile stays with it", () => {
    // My backup QB covers my QB's week-6 bye in the baseline (no move); trading him, the free-agent QB comes in for my stash.
    const bye = handLeague((spec) => {
      swapPlayer(spec, "1", "q1", flat("q1", "QB", 20, { nflTeam: "B6" }));
      swapPlayer(spec, "1", "wc1", flat("bq1", "QB", 12, { value: 3000 }));
      swapPlayer(spec, "1", "rc1", flat("st1", "WR", 2.5, { value: 5000 }));
      spec.byeWeek = { B6: 6 };
    });
    const I = tradeInternals(buildTradeContext({ ...bye.snapshot, myTeamId: "1" }, bye.inputs, { now: TEST_NOW, scenarios: 0 }));
    expect((I.me as TeamState).vstar.moves).toEqual([]);
    const x = evaluateExact(I, { partnerId: "2", give: players(["bq1"]), get: players(["wc2"]) }, 3);
    if ("illegal" in x) throw new Error(x.illegal);
    expect(x.before).toBeNull();
    expect(x.evaluation.myMoves).toEqual({ moves: [{ kind: "waiver", week: 5, add: "fq", drop: "st1", starts: [6] }], assumed: [] });
  });
});

describe("my roster moves on the card (item 2.2)", () => {
  it("the League page's pickup made after the trade with the same drop is assumed either way, not listed as the trade's", () => {
    const { exact } = contextOf();
    // My TE for their TE at 12: fy no longer helps, fx still does, for wc1, as in my baseline.
    const x = exact(["te1"], ["te2"]);
    expect(x.evaluation.myMoves).toEqual({ moves: [], assumed: [{ add: "fx", drop: "wc1" }] });
  });

  it("⚠️ a make-room drop my baseline cuts anyway is named by the drop my pickups then make, the League page's pickup assumed either way", () => {
    const { exact } = contextOf();
    // My TE for their TE and a WR at 10: legality drops wc1 (whom my baseline cuts for fx), and my pickups after the trade
    // make fx again, for rc1. Against the "before" (which cuts wc1 for fx anyway) the trade costs rc1.
    const x = exact(["te1"], ["te2", "wb2"]);
    expect(x.evaluation.required.me.drops).toEqual(["wc1"]);
    expect(x.before).toBeNull();
    expect(x.evaluation.myMoves).toEqual({ moves: [{ kind: "makeRoom", week: 5, drop: ["rc1"], for: ["wb2"] }], assumed: [{ add: "fx", drop: "wc1" }] });
  });

  it("⚠️ so is one my baseline cuts anyway that I send away: the player received in his spot needs the room the pickup then takes", () => {
    const { exact } = contextOf();
    // wc1 (cut for fx in my baseline) for their TE at 12: no spot opens for him (legality's rule 4), te2 takes it, and my
    // pickups make fx again, for rc1: the trade costs rc1.
    const x = exact(["wc1"], ["te2"]);
    expect(x.evaluation.required.me.drops).toEqual([]);
    expect(x.evaluation.myMoves).toEqual({ moves: [{ kind: "makeRoom", week: 5, drop: ["rc1"], for: ["te2"] }], assumed: [{ add: "fx", drop: null }] });
  });

  it("a trade's open roster spot that takes the League page's pickup says so, and that the League page's drop for him stays (review of wave B, finding B-1)", () => {
    const { exact } = contextOf();
    // My bench RB and my TE for their TE at 12: the spot (an RB short) takes fx, my baseline's own pickup, and wc1, whom my
    // baseline drops for him, stays: against the "before" the trade keeps wc1, which the spot's line says (it named fx alone).
    const x = exact(["rc1", "te1"], ["te2"]);
    expect(x.before).toBeNull();
    expect(x.mine.roster).toContain("wc1");
    expect(x.evaluation.myMoves).toEqual({ moves: [{ kind: "openSpot", week: 5, spot: { playerId: "fx", pos: "RB" }, pickup: { keep: "wc1" } }], assumed: [] });
  });
});
