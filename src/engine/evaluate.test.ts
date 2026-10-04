import { describe, expect, it } from "vitest";
import {
  DEADLINE_PASSED_NOTE,
  NO_ODDS_NOTE,
  NO_TEAM_NOTE,
  NO_WEEKS_NOTE,
  SEASON_OVER_NOTE,
  analyzeTrade,
  buildTradeContext,
  evaluateExact,
  legalSide,
  proposalKey,
  screenTrade,
  simCounts,
  simulateTrade,
  tradeInternals,
  tradeRoster,
  type ExactTrade,
  type TeamState,
  type TradeContextOptions,
} from "./evaluate";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, type SeasonSpec } from "./trade.testing";
import { defaultTradeSettings } from "./settings";
import { rosValue } from "./teamValue";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });

/** A hand league's context (EV lineups unless `opts.scenarios` says otherwise). */
function context(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague(edit, season);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
}

/** Replaces a player of a team (by id) in a spec. */
function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const i = team.roster.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no player ${id}`);
  team.roster[i] = by;
}

function exact(ctx: ReturnType<typeof buildTradeContext>, proposal: TradeProposal, maxPerSide = 4): ExactTrade {
  const x = evaluateExact(tradeInternals(ctx), proposal, maxPerSide);
  if ("illegal" in x) throw new Error(x.illegal);
  return x;
}

describe("the evaluation context (M1)", () => {
  it("builds once: partners in snapshot order, every team at V*, baseline odds on one matrix, no notes", () => {
    const ctx = context(() => undefined, {}, { clock: () => 0 });
    expect(ctx.myTeamId).toBe("1");
    expect(ctx.partnerIds).toEqual(["2", "3", "4"]);
    expect(ctx.notes).toEqual([]);
    expect(ctx.warnings).toEqual([]);
    expect(Object.keys(ctx.timings)).toEqual(["league model", "baseline lineups", "simulation", "profiles", "total"]);
    const I = tradeInternals(ctx);
    expect(I.sim).not.toBeNull();
    const base = I.sim?.base.final;
    expect(base?.pPlayoffs).toBeGreaterThan(0);
    expect(base?.pPlayoffs).toBeLessThan(1);
    // The baseline rosters are the League model's V*(T) (no free agent helps anyone here).
    for (const t of I.teams) expect([...t.vstar.roster]).toEqual(t.team.roster);
    // Without a clock, no timings.
    expect(context().timings).toEqual({});
  });

  it("no team picked: a note, nothing evaluated (the Analyzer can't run either)", () => {
    const ctx = context((spec) => {
      spec.myTeamId = null;
    });
    expect(ctx.myTeamId).toBeNull();
    expect(ctx.notes).toEqual([NO_TEAM_NOTE]);
    expect(ctx.partnerIds).toEqual(["1", "2", "3", "4"]);
    expect(analyzeTrade(ctx, trade("2", ["wb1"], ["wa2"]))).toEqual({ evaluation: null, illegal: null, notes: [NO_TEAM_NOTE] });
  });

  it("the trade deadline passed: a note (the search stops), the Analyzer still evaluates", () => {
    const ctx = context(() => undefined, { tradeDeadline: { date: "2026-09-01T00:00:00.000Z" } });
    expect(ctx.notes).toEqual([DEADLINE_PASSED_NOTE]);
    expect(tradeInternals(ctx).blocked).toBe(true);
    const a = analyzeTrade(ctx, trade("2", ["wb1"], ["wa2"]));
    expect(a.evaluation?.stage).toBe("final");
    expect(a.notes[0]).toBe(DEADLINE_PASSED_NOTE);
  });

  it("no odds (the schedule didn't load): a note and the warning; the Analyzer evaluates without B", () => {
    const { snapshot, inputs } = handLeague();
    const ctx = buildTradeContext({ ...snapshot, schedule: [] }, inputs, { now: TEST_NOW, scenarios: 0 });
    expect(ctx.notes).toEqual([NO_ODDS_NOTE]);
    expect(ctx.warnings.some((w) => w.includes("no matchups for the rest of the regular season"))).toBe(true);
    const ev = analyzeTrade(ctx, trade("2", ["wb1"], ["wa2"])).evaluation;
    expect(ev).not.toBeNull();
    expect(ev?.b).toBeNull();
    expect(ev?.dPO).toBeNull();
    expect(ev?.tradeScore).toBeNull();
    expect(ev?.stage).toBe("exact");
    expect(ev?.sims).toBe(0);
    expect(ev?.pAccept).toBeGreaterThan(0);
  });

  it("my team certainly eliminated in a redraft league: the season-over note (not in a keeper league)", () => {
    const late = (spec: TestLeagueSpec) => {
      spec.currentWeek = 8;
    };
    const season: SeasonSpec = { pastWinnersOrder: ["2", "3", "4", "1"] };
    const ctx = context(late, season);
    expect(ctx.notes).toContain(SEASON_OVER_NOTE);
    expect(tradeInternals(ctx).sim?.odds.teams[0]?.eliminated).toBe(true);
    const keeper = context((spec) => {
      late(spec);
      spec.leagueType = "keeper";
    }, season);
    expect(keeper.notes).not.toContain(SEASON_OVER_NOTE);
  });

  it("no weeks left: a note", () => {
    const ctx = context((spec) => {
      spec.currentWeek = 10;
    });
    expect(ctx.notes).toEqual([NO_WEEKS_NOTE]);
    expect(tradeInternals(ctx).sim).toBeNull();
  });
});

describe("proposals the Analyzer refuses (M2)", () => {
  const reserves = (spec: TestLeagueSpec) => {
    (spec.teams[0] as { ir?: TestPlayer[]; taxi?: TestPlayer[] }).ir = [flat("ir1", "RB", 9, { injury: "IR" })];
    (spec.teams[0] as { ir?: TestPlayer[]; taxi?: TestPlayer[] }).taxi = [flat("tx1", "WR", 3)];
    (spec.teams[1] as { ir?: TestPlayer[]; taxi?: TestPlayer[] }).ir = [flat("ir2", "WR", 9, { injury: "IR" })];
    (spec.teams[1] as { ir?: TestPlayer[]; taxi?: TestPlayer[] }).taxi = [flat("tx2", "WR", 3)];
  };
  const ctx = context(reserves);
  const cases: [string, TradeProposal, string][] = [
    ["a pick", { partnerId: "2", give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "1" }], get: p("wa2") }, "Draft picks can't be part of a trade here yet: pick players only."],
    ["no asset", trade("2", [], []), "Pick at least one player to trade."],
    ["a player twice", trade("2", ["wb1", "wb1"], ["wa2"]), "Testy McTest wb1 is in the trade twice."],
    ["too many a side", trade("2", ["q1", "ra1", "rb1", "wa1", "wb1"], ["wa2"]), "A trade can have at most 4 players a side here."],
    ["not on my roster", trade("2", ["wa2"], ["wb2"]), "Testy McTest wa2 isn't on your active roster or IR."],
    ["my taxi player", trade("2", ["tx1"], ["wa2"]), "Testy McTest tx1 is on your taxi squad: only active-roster and IR players can be traded here."],
    ["their taxi player", trade("2", ["wb1"], ["tx2"]), "Testy McTest tx2 is on Team 2's taxi squad: only active-roster and IR players can be traded here."],
    ["not on their roster", trade("2", ["wb1"], ["wa3"]), "Testy McTest wa3 isn't on Team 2's active roster or IR."],
    ["no such partner", trade("9", ["wb1"], ["wa2"]), "Pick a team to trade with."],
    ["my own team", trade("1", ["wb1"], ["wa1"]), "Pick a team to trade with."],
  ];
  for (const [name, proposal, reason] of cases) {
    it(name, () => {
      expect(analyzeTrade(ctx, proposal)).toEqual({ evaluation: null, illegal: reason, notes: [] });
    });
  }

  it("IR players are tradable (Phase 4b, planner reply to Checkpoint 4, change 5): mine and theirs", () => {
    for (const proposal of [trade("2", ["ir1"], ["wa2"]), trade("2", ["wb1"], ["ir2"])]) {
      const a = analyzeTrade(ctx, proposal);
      expect(a.illegal, JSON.stringify(proposal)).toBeNull();
      expect(a.evaluation?.stage).toBe("final");
    }
  });

  it("irReturners false (Checkpoint 4's rule, for the report): IR players aren't tradable, with Checkpoint 4's words", () => {
    const old = context(reserves, {}, { irReturners: false });
    expect(analyzeTrade(old, trade("2", ["ir1"], ["wa2"]))).toEqual({ evaluation: null, illegal: "Testy McTest ir1 is on your IR or taxi squad: only active-roster players can be traded here.", notes: [] });
    expect(analyzeTrade(old, trade("2", ["wb1"], ["ir2"]))).toEqual({ evaluation: null, illegal: "Testy McTest ir2 is on Team 2's IR or taxi squad: only active-roster players can be traded here.", notes: [] });
    expect(analyzeTrade(old, trade("2", ["wa2"], ["wb2"])).illegal).toBe("Testy McTest wa2 isn't on your active roster.");
  });

  it("one empty side is legal (a 1-for-0)", () => {
    const a = analyzeTrade(ctx, trade("2", ["wc1"], []));
    expect(a.illegal).toBeNull();
    expect(a.evaluation?.features.c).toBe(0);
  });
});

describe("roster legality after a trade (§7; M2's rules and their order)", () => {
  it("rule 2: the side over the roster size drops its lowest keep value player; rule 4: the side with an open spot adds the free agent who helps most (none helps: the most ROS points)", () => {
    const a = analyzeTrade(context(), trade("2", ["wb1", "rc1"], ["wa2"]));
    // Team 2 receives two for one: its bench WR (never starts: costs nothing) goes. I give two for one: no free agent
    // improves my lineup, so the one with the most ROS points (the QB) fills the spot; never a K or D/ST.
    expect(a.evaluation?.required).toEqual({ me: { drops: [], adds: ["fq"] }, partner: { drops: ["wc2"], adds: [] } });
  });

  it("rule 2 never drops a player just received, even the cheapest to lose", () => {
    const a = analyzeTrade(context(), trade("2", ["rc1", "wc1"], ["wa2"]));
    // Team 2's received bench players cost nothing to lose but stay; its own WR2 and FLEX RB each cost about 0.1 a week
    // (a received one steps in). Phase 4b: the market blend (§6 step 8) reads the received RB a little lower than the
    // received WR (0.43% and 0.37%), so the WR is the cheaper one to lose (0.52 ROS points against the RB's 0.54).
    expect(a.evaluation?.required.partner).toEqual({ drops: ["wc2"], adds: [] });
  });

  it("rule 2 never drops a player the starting lineup needs (Team 2's only kicker, worth nothing now)", () => {
    const a = analyzeTrade(
      context((spec) => swapPlayer(spec, "2", "k2", flat("k2", "K", 7, { injury: "NA" }))),
      trade("2", ["wb1", "rc1"], ["wa2"]),
    );
    expect(a.evaluation?.required.partner).toEqual({ drops: ["wc2"], adds: [] });
  });

  it("rule 2 never drops the last player at a position the side streams (final review of Phase 4b): the streamed slot needs his roster spot", () => {
    // My kicker scores what the streaming replacement does (the one free-agent kicker, 5): losing him costs my lineup
    // nothing, and his value (a flat minimum) is below my bench WR's, so he's my lowest keep value player. I stream K
    // (the default), and he's my only kicker: my bench WR goes instead, in exact evaluation and in screening alike.
    const ctx = context((spec) => swapPlayer(spec, "1", "k1", flat("k1", "K", 5)));
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    expect(me.stream.positions).toContain("K");
    expect(analyzeTrade(ctx, trade("2", ["rc1"], ["wb2", "wc2"])).evaluation?.required.me).toEqual({ drops: ["wc1"], adds: [] });
    for (const mode of ["exact", "ev"] as const) {
      const side = legalSide(I, me, mode === "ev" ? me.vstar.roster : me.roster, ["rc1"], ["wb2", "wc2"], mode, "You");
      if ("illegal" in side) throw new Error(side.illegal);
      expect(side.change.drops, mode).toEqual(["wc1"]);
      expect(side.roster, mode).toContain("k1");
    }
    // With a second kicker on the roster, one of the two can go (the lower value, then the smaller id: both cost nothing).
    const two = context((spec) => {
      swapPlayer(spec, "1", "k1", flat("k1", "K", 5));
      swapPlayer(spec, "1", "wc1", flat("kx1", "K", 5));
    });
    const x = analyzeTrade(two, trade("2", ["rc1"], ["wb2", "wc2"])).evaluation?.required.me;
    expect(x?.drops).toHaveLength(1);
    expect(["k1", "kx1"]).toContain(x?.drops[0]);
  });

  it("rule 1: a position over its limit drops the position's lowest keep value player not received; then rule 4 fills the spot that opens", () => {
    const ctx = context(
      (spec) => {
        spec.positionLimits = { QB: 2 };
        swapPlayer(spec, "1", "wc1", flat("qx1", "QB", 5));
        swapPlayer(spec, "2", "wc2", flat("qx2", "QB", 5));
      },
      {},
    );
    const a = analyzeTrade(ctx, trade("2", ["qx1"], ["rc2"]));
    // Team 2 has 2 QBs (its limit) and receives one: its bench QB goes; its FLEX is then empty, and of the free agents
    // a QB can't come in (the limit): the 2-point WR fills it best (an RB's future injury risk is higher).
    expect(a.evaluation?.required).toEqual({ me: { drops: [], adds: [] }, partner: { drops: ["qx2"], adds: ["fw"] } });
  });

  it("rule 1: illegal when only received players are left at the position", () => {
    const ctx = context((spec) => {
      spec.positionLimits = { QB: 1 };
      swapPlayer(spec, "1", "wc1", flat("qx1", "QB", 5));
    });
    // My team was already over the QB limit before the trade (held to its count then); Team 2 isn't.
    expect(analyzeTrade(ctx, trade("2", ["q1", "qx1"], ["ra2", "rb2"])).illegal).toBe("Team 2 can have at most 1 QB.");
  });

  it("rule 3: a position under its minimum adds the best free agent there, then rule 2 makes room (never the one added)", () => {
    const ctx = context(() => undefined, { rosterMinimums: { TE: 1 } });
    const a = analyzeTrade(ctx, trade("2", ["te1"], ["rb2"]));
    expect(a.evaluation?.required.me).toEqual({ drops: ["wc1"], adds: ["ft"] });
    // No free-agent TE: illegal.
    const none = context(
      (spec) => {
        spec.freeAgents = (spec.freeAgents ?? []).filter((x) => x.pos !== "TE");
      },
      { rosterMinimums: { TE: 1 } },
    );
    expect(analyzeTrade(none, trade("2", ["te1"], ["rb2"])).illegal).toBe("You must keep at least 1 TE, and no free agent is available to fill the spot.");
  });

  it("rule 4: the free agent with the largest gain wins over more ROS points; never a K or D/ST, nor a position I stream", () => {
    // Giving both my RB2 and my FLEX RB leaves an RB slot empty: the 2-point free-agent RB fills it.
    expect(analyzeTrade(context(), trade("2", ["rb1", "rc1"], ["wa2"])).evaluation?.required.me.adds).toEqual(["fr"]);
    // A 9-point free-agent kicker has the most ROS points, but kickers are never added.
    const kicker = context((spec) => {
      spec.freeAgents = (spec.freeAgents ?? []).map((x) => (x.id === "fk" ? flat("fk", "K", 9) : x));
    });
    expect(analyzeTrade(kicker, trade("2", ["wb1", "rc1"], ["wa2"])).evaluation?.required.me.adds).toEqual(["fq"]);
    // Streaming QBs: the free-agent QB is out; of the 2-point RB and WR, the WR has more ROS points (less injury risk).
    const streamQb = context(() => undefined, {}, { settings: { ...defaultTradeSettings(), streamPositions: ["K", "DEF", "QB"] } });
    expect(analyzeTrade(streamQb, trade("2", ["wb1", "rc1"], ["wa2"])).evaluation?.required.me.adds).toEqual(["fw"]);
  });

  it("received players take the given players' places in roster order", () => {
    expect(tradeRoster(["a", "b", "c", "d"], ["b", "d"], ["x"])).toEqual(["a", "x", "c"]);
    expect(tradeRoster(["a", "b", "c"], ["b"], ["x", "y"])).toEqual(["a", "x", "c", "y"]);
    expect(tradeRoster(["a", "b"], [], ["x"])).toEqual(["a", "b", "x"]);
  });
});

describe("screening vs exact evaluation (M5, M3)", () => {
  it("in EV lineups, with V* making no move, screening's ΔROS, g_mkt(P) and quick P_accept equal the exact numbers", () => {
    const ctx = context();
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    for (const [partnerId, give, get] of [
      ["2", ["wb1"], ["wa2"]],
      ["3", ["rb1"], ["ra3"]],
      ["2", ["wb1", "rc1"], ["wa2", "wc2"]],
      ["4", ["te1"], ["te4"]],
    ] as [string, string[], string[]][]) {
      const partner = I.byId.get(partnerId) as TeamState;
      const s = screenTrade(I, partner, give, get);
      const x = exact(ctx, trade(partnerId, give, get));
      expect(s, `${give} for ${get}`).not.toBeNull();
      // V* made no move on either side: the exact rosters are the trade's.
      expect(x.evaluation.required).toEqual({ me: { drops: [], adds: [] }, partner: { drops: [], adds: [] } });
      expect(s?.myDelta).toBeCloseTo(rosValue(x.mine.lv, I.weights) - rosValue(me.base.lv, I.weights), 9);
      expect(s?.gPartner).toBe(x.evaluation.gPartner);
      // No hot players, no deadline, no review: the full model's z is the quick one's.
      expect(x.evaluation.features.hot).toBe(0);
      expect(x.evaluation.features.urg).toBe(0);
      expect(s?.pQuick).toBeCloseTo(x.evaluation.pAccept, 12);
      expect(s?.key).toBe(x.evaluation.key);
    }
  });

  it("screening drops a trade legality makes illegal", () => {
    const ctx = context((spec) => {
      spec.positionLimits = { QB: 1 };
      swapPlayer(spec, "1", "wc1", flat("qx1", "QB", 5));
    });
    const I = tradeInternals(ctx);
    expect(screenTrade(I, I.byId.get("2") as TeamState, ["q1", "qx1"], ["ra2", "rb2"])).toBeNull();
  });
});

describe("the simulation behind B (M4)", () => {
  it("a no-op (my V* and the partner's unchanged) moves no odds: ΔPO = ΔCH = ΔEW = 0 exactly, at both counts", () => {
    const ctx = context(() => undefined, {}, { scenarios: 8 });
    const I = tradeInternals(ctx);
    const x = exact(ctx, trade("2", ["wb1"], ["wa2"]));
    for (const stage of ["screen", "final"] as const) {
      const noop = simulateTrade(I, { ...x, mine: (I.me as TeamState).base, theirs: x.partner.base }, stage, null);
      expect(noop.dPO).toBe(0);
      expect(noop.dCH).toBe(0);
      expect(noop.dEW).toBe(0);
      expect(noop.bWin).toBe(0);
      expect(noop.sims).toBe(simCounts()[stage]);
    }
  });

  it("a real trade of identical bench players moves nothing either (EV lineups)", () => {
    const ctx = context((spec) => swapPlayer(spec, "2", "wc2", flat("wc2", "WR", 3.1)));
    const a = analyzeTrade(ctx, trade("2", ["wc1"], ["wc2"]));
    expect(a.evaluation?.dPO).toBe(0);
    expect(a.evaluation?.dCH).toBe(0);
    expect(a.evaluation?.dEW).toBe(0);
    expect(a.evaluation?.gMine).toBe(0);
    expect(a.evaluation?.bWin).toBe(0);
    // B is the market term alone, which counts both players (worth less than the waiver credit) at the credit (planner
    // reply to Checkpoint 4, change 4; evaluate.addendum.test.ts): an even swap, B = 0, so it doesn't help.
    expect(a.evaluation?.b).toBe(0);
    expect(a.evaluation?.flags.hiddenByBenefit).toBe(true);
  });

  it("Checkpoint 4: a trade whose whole effect a free-agent pickup reproduces gets no B from it (ΔPO = ΔCH = 0 exactly)", () => {
    // My WR2 is weak (4 points; my FLEX scores 10) and a 9-point free-agent WR is the pickup V*(me) makes. Team 2's bench
    // WR is the same player in every way but his id (he never starts there: its FLEX scores 10 too). Trading my bench WR
    // for him does exactly what the pickup does: B must not count it.
    const ctx = context((spec) => {
      swapPlayer(spec, "1", "wb1", flat("wb1", "WR", 4));
      swapPlayer(spec, "1", "rc1", flat("rc1", "RB", 10));
      swapPlayer(spec, "2", "rc2", flat("rc2", "RB", 10));
      swapPlayer(spec, "2", "wc2", flat("y2", "WR", 9));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("zfa", "WR", 9)];
    });
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    expect(me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["zfa", "wc1"]]);
    const x = exact(ctx, trade("2", ["wc1"], ["y2"]));
    // After the trade V* picks up nobody (the received WR does the pickup's job).
    expect([...x.mine.roster]).toEqual([...me.vstar.roster].map((id) => (id === "zfa" ? "y2" : id)));
    const final = simulateTrade(I, x, "final", null);
    expect(final.dPO).toBe(0);
    expect(final.dCH).toBe(0);
    expect(final.dEW).toBe(0);
    expect(final.bWin).toBe(0);
    expect(Array.from(x.mine.score.mean)).toEqual(Array.from(me.base.score.mean));
  });

  it("is deterministic: the same inputs give the same evaluation", () => {
    const a = analyzeTrade(context(() => undefined, {}, { scenarios: 8 }), trade("3", ["wb1", "rc1"], ["wa3"]));
    const b = analyzeTrade(context(() => undefined, {}, { scenarios: 8 }), trade("3", ["wb1", "rc1"], ["wa3"]));
    expect(b).toEqual(a);
  });
});

describe("the Trade Analyzer on a legal trade", () => {
  it("evaluates exactly as a finalist: final stage, finalSims seasons, the card's numbers, words", () => {
    const ctx = context(() => undefined, {}, { scenarios: 8 });
    const proposal = trade("2", ["wb1", "rc1"], ["wa2"]);
    const a = analyzeTrade(ctx, proposal);
    const ev = a.evaluation;
    expect(a.illegal).toBeNull();
    expect(ev?.key).toBe(proposalKey(proposal));
    expect(ev?.stage).toBe("final");
    expect(ev?.sims).toBe(simCounts().final);
    expect(Number.isFinite(ev?.b)).toBe(true);
    expect(ev?.dPO).not.toBeNull();
    expect(ev?.pComplete).toBe(ev?.pAccept); // no trade review in this league
    expect(ev?.value.given).toBeGreaterThan(0);
    expect(ev?.ros.received).toBeGreaterThan(0);
    expect(ev?.detail.mySlots.map((s) => s.key)).toEqual(tradeInternals(ctx).instances.map((i) => i.key));
    expect(ev?.detail.partnerSlots.every((s) => s.rank >= 1 && s.rank <= 4)).toBe(true);
    expect(ev?.detail.weekly.map((w) => w.week)).toEqual([5, 6, 7, 8, 9]);
    expect(ev?.reasons.length).toBeGreaterThan(0);
    expect(ev?.pitch.length).toBeGreaterThan(0);
    for (const n of ev?.detail.notes ?? []) expect(a.notes).toContain(n);
  });

  it("a week under way: its score stays the same before and after the trade, and the card says so", () => {
    const ctx = context((spec) => {
      spec.kickoffs = { 5: { AAA: "2026-09-29T00:00:00.000Z" } };
    });
    const ev = analyzeTrade(ctx, trade("2", ["wb1"], ["wa2"])).evaluation;
    expect(tradeInternals(ctx).inProgress).toBe(true);
    expect(ev?.detail.weekly[0]?.before).toBe(ev?.detail.weekly[0]?.after);
    expect(ev?.detail.notes[0]).toBe("Week 5 is under way: these odds play it with today's rosters, before and after the trade.");
  });
});
