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
  othersPool,
  proposalKey,
  screenTrade,
  simCounts,
  simulateTrade,
  tradeInternals,
  tradeRoster,
  tradeSides,
  type ExactTrade,
  type OpenSpotFill,
  type TeamState,
  type TradeContextOptions,
} from "./evaluate";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, smallLeague, type SeasonSpec } from "./trade.testing";
import { returnersOf } from "./optimizer";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { addGainExact, rosValue, solveEvWeeks, teamEval, type TableRow } from "./teamValue";
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

  it("“Several prizes” paying a weekly high score or the points title: no season-over stop while one can still be won (Checkpoint 7c; reward.ts prizeStillMovable)", () => {
    const late = (spec: TestLeagueSpec) => {
      spec.currentWeek = 8;
    };
    const season: SeasonSpec = { pastWinnersOrder: ["2", "3", "4", "1"] };
    const prizes = (a: Partial<TradeSettings["prizes"]>): TradeSettings => ({ ...defaultTradeSettings(), goal: "prizes", prizes: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null, ...a } });
    // Week 8, the last regular-season week, still to play: its high score can be won.
    const weekly = context(late, season, { settings: prizes({ weeklyHigh: 5 }) });
    const I = tradeInternals(weekly);
    expect(I.sim?.odds.teams[0]?.eliminated).toBe(true);
    expect(I.sim?.highScores).toBe(true);
    expect(I.sim?.odds.highScorePeriods).toBe(1);
    expect(weekly.notes).not.toContain(SEASON_OVER_NOTE);
    expect(I.blocked).toBe(false);
    // The regular season isn't over: the points title can still be won.
    expect(context(late, season, { settings: prizes({ pointsLeader: 20 }) }).notes).not.toContain(SEASON_OVER_NOTE);
    // The prefilled split pays the places only. With 2 playoff teams 3rd is seed 3 of the final standings (sim.ts), but my
    // 0-7 team is certainly 4th (its best finish), so the stop, as under "Only the champion".
    const places = context(late, season, { settings: prizes({}) });
    expect(tradeInternals(places).sim?.odds.teams[0]?.bestFinish).toBe(4);
    expect(places.notes).toContain(SEASON_OVER_NOTE);
  });

  it("a place the final standings decide (the review of the reward engine, RW-2): with 2 playoff teams 3rd is seed 3, so a team out of the title race that can still finish 3rd gets no stop while 3rd pays", () => {
    // Week 7: my team is 0-6 with 2 games left, team 4 is 2-4: certainly out of the top 2, but not of the top 3.
    const week7 = (spec: TestLeagueSpec) => {
      spec.currentWeek = 7;
    };
    const season: SeasonSpec = { pastWinnersOrder: ["3", "2", "4", "1"] };
    const title = context(week7, season);
    const I = tradeInternals(title);
    const mine = I.sim?.odds.teams[0];
    expect(I.sim?.odds.playoffTeams).toBe(2);
    expect(mine).toMatchObject({ eliminated: true, bestFinish: 3, pTitle: 0, pSecond: 0 });
    expect(mine?.pThird as number).toBeGreaterThan(0);
    expect(title.notes).toContain(SEASON_OVER_NOTE);
    // "Several prizes" on the prefilled split pays 3rd: no stop, and a trade can move my 3rd-place odds.
    const settings: TradeSettings = { ...defaultTradeSettings(), goal: "prizes" };
    const ctx = context(week7, season, { settings });
    expect(ctx.notes).not.toContain(SEASON_OVER_NOTE);
    expect(tradeInternals(ctx).blocked).toBe(false);
    const a = analyzeTrade(ctx, trade("4", ["rc1"], ["ra4"]), { settings });
    expect(a.evaluation?.dPrizes?.third as number).toBeGreaterThan(0);
    expect(a.evaluation?.bWin as number).toBeGreaterThan(0);
    // 2nd alone paid (the final's loser in a bracket of 2): out of the race is out of 2nd, so the stop.
    expect(context(week7, season, { settings: { ...settings, prizes: { first: 70, second: 30, third: null, weeklyHigh: null, pointsLeader: null } } }).notes).toContain(SEASON_OVER_NOTE);
  });

  it("the last regular-season week under way (the review of the reward engine, RW-3): a trade can't change it, so neither its high score nor the points title keeps the season going", () => {
    const season: SeasonSpec = { pastWinnersOrder: ["2", "3", "4", "1"] };
    const prizes = (a: Partial<TradeSettings["prizes"]>): TradeSettings => ({ ...defaultTradeSettings(), goal: "prizes", prizes: { first: 60, second: 30, third: 10, weeklyHigh: null, pointsLeader: null, ...a } });
    const underWay = (spec: TestLeagueSpec) => {
      spec.currentWeek = 8;
      spec.kickoffs = { 8: { AAA: "2026-09-29T17:00:00.000Z" } };
    };
    for (const settings of [prizes({ weeklyHigh: 5 }), prizes({ pointsLeader: 20 }), prizes({ weeklyHigh: 5, pointsLeader: 20 })]) {
      const ctx = context(underWay, season, { settings });
      const I = tradeInternals(ctx);
      expect(I.model.inProgressWeek).toBe(8);
      // The week under way is simulated (its high score too, when the weekly prize pays), but no trade can change it.
      expect(I.sim?.odds.highScorePeriods).toBe(settings.prizes.weeklyHigh ? 1 : 0);
      expect(I.sim?.odds.regularLeft).toEqual({ periods: 0, weeks: 0 });
      expect(I.sim?.odds.teams[0]?.eliminated).toBe(true);
      expect(ctx.notes).toContain(SEASON_OVER_NOTE);
    }
    // Before its first kickoff, the same week can still be changed: its high score and the points title keep the season going.
    const notYet = context((spec) => {
      spec.currentWeek = 8;
    }, season, { settings: prizes({ weeklyHigh: 5 }) });
    expect(tradeInternals(notYet).sim?.odds.regularLeft).toEqual({ periods: 1, weeks: 1 });
    expect(notYet.notes).not.toContain(SEASON_OVER_NOTE);
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
  it("rule 2: the side over the roster size drops its lowest keep value player; rule 4: the side with an open spot adds the best free agent at the position it gave up (none helps: the most ROS points there)", () => {
    const a = analyzeTrade(context(), trade("2", ["wb1", "rc1"], ["wa2"]));
    // Team 2 receives two for one: its bench WR (never starts: costs nothing) goes. I give a WR and an RB for a WR: the
    // spot is the RB's (planner reply to Checkpoint 7b, section 5). No free-agent RB improves my lineup, so the one with the
    // most ROS points there fills it: the 2-point RB (Checkpoint 7b's rule took the 6-point QB, the most ROS points at any
    // position); never a K or D/ST.
    expect(a.evaluation?.required).toEqual({ me: { drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] }, partner: { drops: ["wc2"], adds: [] } });
    const before = analyzeTrade(context(() => undefined, {}, { openSpotFill: "bestAny" }), trade("2", ["wb1", "rc1"], ["wa2"]));
    expect(before.evaluation?.required.me).toEqual({ drops: [], adds: ["fq"], openSpots: [{ playerId: "fq", pos: null }] });
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
    // Team 2 has 2 QBs (its limit) and receives one: its bench QB goes; its FLEX is then empty. It gave its bench RB, so
    // the spot takes the free-agent RB (planner reply to Checkpoint 7b, section 5), though the 2-point WR would fill the
    // FLEX a hair better (an RB's future injury risk is higher: Checkpoint 7b's rule took the WR).
    expect(a.evaluation?.required).toEqual({ me: { drops: [], adds: [] }, partner: { drops: ["qx2"], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] } });
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

  it("rule 4 (Checkpoint 7b's rule, openSpotFill bestAny): the free agent with the largest gain wins over more ROS points; never a K or D/ST, nor a position I stream", () => {
    const old = { openSpotFill: "bestAny" } as const;
    // Giving both my RB2 and my FLEX RB leaves an RB slot empty: the 2-point free-agent RB fills it.
    expect(analyzeTrade(context(() => undefined, {}, old), trade("2", ["rb1", "rc1"], ["wa2"])).evaluation?.required.me.adds).toEqual(["fr"]);
    // A 9-point free-agent kicker has the most ROS points, but kickers are never added.
    const kicker = context((spec) => {
      spec.freeAgents = (spec.freeAgents ?? []).map((x) => (x.id === "fk" ? flat("fk", "K", 9) : x));
    }, {}, old);
    expect(analyzeTrade(kicker, trade("2", ["wb1", "rc1"], ["wa2"])).evaluation?.required.me.adds).toEqual(["fq"]);
    // Streaming QBs: the free-agent QB is out; of the 2-point RB and WR, the WR has more ROS points (less injury risk).
    const streamQb = context(() => undefined, {}, { ...old, settings: { ...defaultTradeSettings(), streamPositions: ["K", "DEF", "QB"] } });
    expect(analyzeTrade(streamQb, trade("2", ["wb1", "rc1"], ["wa2"])).evaluation?.required.me.adds).toEqual(["fw"]);
  });

  it("rule 4 (planner reply to Checkpoint 7b, section 5): the spot takes the best free agent at the position given up, even where another position gains more", () => {
    // An 11-point free-agent TE would start at TE (my 8-point TE moving to FLEX): my baseline's own pickup (V*(me) adds him).
    // Giving my RB2 and my bench RB for a WR leaves an RB slot empty: the 2-point RB fills it (+2 a week), though the TE
    // would gain more there (+3: my WR3 holds the FLEX). After the trade V*(after) makes the TE pickup again, with the
    // baseline's drop (the planner: "Any big upgrade at another position is already in the baseline's pickups").
    const te = (spec: TestLeagueSpec) => {
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fte", "TE", 11)];
    };
    const ctx = context(te);
    const I = tradeInternals(ctx);
    expect((I.me as TeamState).vstar.moves.map((m) => m.add)).toEqual(["fte"]);
    const x = exact(ctx, trade("2", ["rb1", "rc1"], ["wa2"]));
    expect(x.evaluation.required.me).toEqual({ drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] });
    expect(x.mine.roster).toEqual(expect.arrayContaining(["fr", "fte"]));
    // Checkpoint 7b's rule took the TE, the largest gain at any position, and the card then also named the RB as a
    // free-agent move the trade's numbers count on (planner: the card "read as if the trade depends on an unrelated pickup").
    const old = exact(context(te, {}, { openSpotFill: "bestAny" }), trade("2", ["rb1", "rc1"], ["wa2"]));
    expect(old.evaluation.required.me.adds).toEqual(["fte"]);
    expect(old.evaluation.required.me.openSpots).toEqual([{ playerId: "fte", pos: null }]);
    expect(old.evaluation.required.me.faMoves?.adds).toEqual(["fr"]);
    expect(old.mine.roster).toEqual(expect.arrayContaining(["fr", "fte"]));
    // With my RB2 and my WR2 given for a WR, the spot is the RB's whichever position gains more: a 9-point free-agent WR or
    // the TE would gain more (my FLEX would score 3.1, my bench RB moving up to RB2), the 2-point RB nothing. (Both are my
    // baseline pickups here, for my bench WR and my bench RB: giving either of those would open no spot of the trade's.)
    const wr = context((spec) => {
      te(spec);
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fw9", "WR", 9)];
    });
    expect(tradeInternals(wr).me?.vstar.moves.map((m) => [m.add, m.drop])).toEqual([
      ["fte", "wc1"],
      ["fw9", "rc1"],
    ]);
    expect(exact(wr, trade("2", ["rb1", "wb1"], ["wa2"])).evaluation.required.me.openSpots).toEqual([{ playerId: "fr", pos: "RB" }]);
  });

  it("rule 4: several open spots are filled one at a time, each from the positions still short; none available there: the best at any position", () => {
    // Two RBs and a WR for one WR: RB is short by 2, and there's one free-agent RB. The first spot takes him; RB is still
    // short, with nobody left there, so the second spot takes the best at any position: none helps, so the most ROS
    // points, the 6-point QB (never a K or D/ST I stream).
    const a = analyzeTrade(context(), trade("2", ["rb1", "wb1", "rc1"], ["wa2"]));
    expect(a.evaluation?.required.me).toEqual({ drops: [], adds: ["fr", "fq"], openSpots: [{ playerId: "fr", pos: "RB" }, { playerId: "fq", pos: null, short: ["RB"] }] });
  });

  it("rule 4 in exact evaluation with scenarios: the fallback too is the free agent whose add gains the most scenario ROS, over every one allowed (brute force), and names the position none could fill", () => {
    // The same trade in scenario lineups, with a 3.5-point free-agent WR besides. The first spot takes the only free-agent
    // RB; RB is still short with nobody left there, so the second spot takes the best at any position by scenario gain: the
    // 6-point QB, who covers my QB's injuries. Expected-value lineups (screening's metric) would take the WR, who'd start at
    // my FLEX (my bench is gone) where the QB never starts (review of Phase 7c's fill, finding pickups-6).
    const ctx = context(
      (spec) => {
        spec.freeAgents = [...(spec.freeAgents ?? []), flat("fw4", "WR", 3.5)];
      },
      {},
      { scenarios: 8 },
    );
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const pool = othersPool(I, I.byId.get("2") as TeamState);
    const side = legalSide(I, me, me.roster, ["rb1", "wb1", "rc1"], ["wa2"], "exact", "You", "none", pool);
    if ("illegal" in side) throw new Error(side.illegal);
    const [first, second] = side.change.openSpots ?? [];
    expect(first).toEqual({ playerId: "fr", pos: "RB" });
    // Every free agent the second spot may take (not on the roster, not another team's claim, not at a position I stream),
    // priced by his add to the roster after the first fill.
    const pre = side.roster.filter((id) => id !== second?.playerId);
    const streamed = new Set<string>(me.stream.positions);
    const ros = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
    const allowed = I.league.freeAgentIds.filter((id) => !pre.includes(id) && !pool.excluded.has(id) && !streamed.has(I.league.table.rows.get(id)?.pos ?? ""));
    expect([...allowed].sort()).toEqual(["fq", "ft", "fw", "fw4"]);
    const base = I.league.scenRosOf(pre, side.spec);
    const gains = allowed.map((id) => ({ id, gain: I.league.scenRosOf([...pre, id], side.spec) - base }));
    const top = Math.max(...gains.map((g) => g.gain));
    const want = gains.filter((g) => g.gain >= top - 1e-6).sort((a, b) => ros(b.id) - ros(a.id) || (a.id < b.id ? -1 : 1))[0]?.id;
    expect(top).toBeGreaterThan(1);
    expect(want).toBe("fq");
    expect(second).toEqual({ playerId: want, pos: null, short: ["RB"] });
    // Expected-value lineups' pick on the same roster: the WR.
    const ev = solveEvWeeks(teamEval([...pre.flatMap((id) => I.league.table.rows.get(id) ?? []), ...side.spec.rows, ...returnersOf(side.spec)], I.league.slots), I.W);
    const evGain = (id: string) => {
      const r = I.league.table.rows.get(id) as TableRow;
      return addGainExact(ev, r, I.league.maskOf(r), I.weights).gain;
    };
    expect([...allowed].sort((a, b) => evGain(b) - evGain(a) || ros(b) - ros(a) || (a < b ? -1 : 1))[0]).toBe("fw4");
  });

  it("rule 4 on the partner's side too (planner: \"Both teams\"): the position it gave up", () => {
    // Team 2 gives a WR and its bench RB for my WR: its spot is the RB's.
    const a = analyzeTrade(context(), trade("2", ["wb1"], ["wa2", "rc2"]));
    expect(a.evaluation?.required.partner).toEqual({ drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] });
  });

  it("rule 4: a short position at its limit, or one I stream, has no candidate: the best at any position (the card names only the first)", () => {
    // Four RBs with a limit of 3 (held to my count before the trade): giving one leaves 3, the limit, so no RB can come in.
    const limited = context((spec) => {
      spec.positionLimits = { RB: 3 };
      swapPlayer(spec, "1", "wc1", flat("rx1", "RB", 3));
    });
    expect(analyzeTrade(limited, trade("2", ["rb1"], [])).evaluation?.required.me).toEqual({ drops: [], adds: ["fq"], openSpots: [{ playerId: "fq", pos: null, short: ["RB"] }] });
    // My only kicker and my bench WR for a bench WR: K is short, but I stream kickers (the default): the streaming row fills
    // the slot every week, so the spot takes the best at any position, and the card doesn't say no kicker is available.
    const streamed = analyzeTrade(context(), trade("2", ["k1", "wc1"], ["wc2"])).evaluation?.required.me;
    expect(streamed).toEqual({ drops: [], adds: ["fq"], openSpots: [{ playerId: "fq", pos: null }] });
    // No spot opened, no open spots.
    expect(analyzeTrade(context(), trade("2", ["wb1"], ["wa2"])).evaluation?.required.me).toEqual({ drops: [], adds: [] });
  });

  it("V*(after) never drops rule 4's fill (the optimizer's keep set): it makes the side's own baseline pickup again with the baseline's drop", () => {
    // Team 2's 2-point TE makes an 11-point free-agent TE its baseline pickup (it gains the most from him, so it claims him
    // first), for that TE. A trade where it gives a WR and its bench RB for my WR opens an RB spot: the 2-point RB fills
    // it. After the trade its V*(after) adds the TE again: dropping the fill or its old TE gains the same, and the fill (the
    // smaller id, the same value) would go; kept, the old TE goes, as in the baseline.
    const edit = (spec: TestLeagueSpec) => {
      swapPlayer(spec, "2", "te2", flat("te2w", "TE", 2));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fte", "TE", 11)];
    };
    const ctx = context(edit);
    const I = tradeInternals(ctx);
    const two = I.byId.get("2") as TeamState;
    expect(two.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fte", "te2w"]]);
    const proposal = trade("2", ["wb1"], ["wa2", "rc2"]);
    const x = exact(ctx, proposal);
    expect(x.evaluation.required.partner).toEqual({ drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] });
    expect(x.theirs.roster).toEqual(expect.arrayContaining(["fr", "fte"]));
    expect(x.theirs.roster).not.toContain("te2w");
    // Without the keep set the same run drops the fill: the card would name a pickup the evaluated roster doesn't hold.
    const after = tradeSides(I, I.me as TeamState, two, ["wb1"], ["wa2", "rc2"], "Team 2");
    if ("illegal" in after) throw new Error(after.illegal);
    const unkept = I.league.optimizer.optimize(after.theirLegal.roster, after.theirLegal.spec, undefined, after.pools.theirs);
    expect(unkept.moves.map((m) => [m.add, m.drop])).toEqual([["fte", "fr"]]);
    // Checkpoint 7b's rule (openSpotFill bestAny) put the TE, its own baseline pickup, into the spot.
    const old = exact(context(edit, {}, { openSpotFill: "bestAny" }), proposal);
    expect(old.evaluation.required.partner.adds).toEqual(["fte"]);
    expect(old.theirs.roster).not.toContain("fr");
  });

  it("openSpotFill bestAny (Checkpoint 7b's rule) runs V*(after) without the keep set, so it can drop the fill (smallLeague(11), scenario lineups)", () => {
    // Facts of the synthetic data: my baseline picks up 1092 for my backup QB 1011. Giving my RB 1002 and 1011 for Team 4's
    // 1038 opens a spot under Checkpoint 7b's rule; its fill, the QB 1075, goes again when V*(after) picks up 1092 (review of
    // Phase 7c's fill, finding pickups-6).
    const league = smallLeague(11, { pastWinnersOrder: ["2", "5", "1", "3", "6", "4"] });
    const at = (openSpotFill: OpenSpotFill) => tradeInternals(buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 4, openSpotFill }));
    const proposal = trade("4", ["1011", "1002"], ["1038"]);
    const oldI = at("bestAny");
    expect((oldI.me as TeamState).vstar.moves.map((m) => [m.add, m.drop])).toEqual([["1092", "1011"]]);
    const old = evaluateExact(oldI, proposal, 4);
    if ("illegal" in old) throw new Error(old.illegal);
    expect(old.evaluation.required.me.openSpots).toEqual([{ playerId: "1075", pos: null }]);
    expect(old.mine.roster).not.toContain("1075");
    expect(old.mine.roster).toContain("1092");
    // Now 1011's spot is the baseline pickup's (the next test): nothing fills it, and V*(after) picks up 1092 into it, for
    // the same roster.
    const now = evaluateExact(at("samePosition"), proposal, 4);
    if ("illegal" in now) throw new Error(now.illegal);
    expect(now.evaluation.required.me.adds).toEqual([]);
    expect(now.evaluation.required.me.openSpots).toBeUndefined();
    expect([...now.mine.roster].sort()).toEqual([...old.mine.roster].sort());
  });

  it("⚠️ a given player my own baseline cuts anyway (V*(me) drops him for a pickup at another position) opens no spot: the trade reads as it does without him (review of Phase 7c's fill, finding pickups-1)", () => {
    // An 11-point free-agent TE is my baseline pickup, for my bench WR (3.1 points, worth less than W, so no trade value
    // moves with him either). Counted as given, my bench WR opened a spot of the trade's: the free-agent WR (or, with my RB2,
    // the free-agent RB) filled it, kept by V*(after), which then cut another bench player of mine for the TE.
    const ctx = context((spec) => {
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fte", "TE", 11)];
    });
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    expect(me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fte", "wc1"]]);
    expect(I.values.wc1 as number).toBeLessThan(I.credit);
    const sorted = (ids: readonly string[]) => [...ids].sort();
    // Given for nothing: his spot was the TE's, so nothing fills it, my roster after the trade is V*(me)'s and nothing moves.
    const dump = exact(ctx, trade("2", ["wc1"], []));
    expect(dump.evaluation.required.me).toEqual({ drops: [], adds: [] });
    expect(sorted(dump.mine.roster)).toEqual(sorted(me.vstar.roster));
    const gone = analyzeTrade(ctx, trade("2", ["wc1"], [])).evaluation;
    for (const k of ["dPO", "dCH", "dPPW", "b", "gMine"] as const) expect(gone?.[k], k).toBe(0);
    // With my RB2 for Team 2's WR1: the same as my RB2 alone.
    const both = analyzeTrade(ctx, trade("2", ["wc1", "rb1"], ["wa2"])).evaluation;
    const alone = analyzeTrade(ctx, trade("2", ["rb1"], ["wa2"])).evaluation;
    expect(both?.required.me).toEqual({ drops: [], adds: [] });
    expect(alone?.required.me).toEqual({ drops: [], adds: [] });
    for (const k of ["dPO", "dCH", "dPPW", "b", "gMine"] as const) expect(both?.[k], k).toBeCloseTo(alone?.[k] as number, 12);
    expect(both?.b as number).not.toBe(0);
    // Screening, from V*(me), never had him on the roster: no spot there either.
    const screened = legalSide(I, me, me.vstar.roster, ["wc1", "rb1"], ["wa2"], "ev", "You", "ros", me.pool);
    if ("illegal" in screened) throw new Error(screened.illegal);
    expect(screened.change).toEqual({ drops: [], adds: [] });
  });

  it("a partner that claims before me can fill its spot with my own baseline pickup: the spot says so (OpenSpot.yours; review of Phase 7c's fill, finding pickups-4)", () => {
    // Team 2's TE (10.8 points) and WRs (12) leave an 11-point free-agent TE little to add there, so he's my baseline pickup
    // (for my bench WR). Team 2 gives its TE and its bench RB for my WR2: its spot takes him (the largest gain at TE or RB).
    const edit = (spec: TestLeagueSpec) => {
      swapPlayer(spec, "2", "te2", flat("te2", "TE", 10.8));
      swapPlayer(spec, "2", "wb2", flat("wb2", "WR", 12));
      swapPlayer(spec, "2", "wc2", flat("wc2", "WR", 12));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fte", "TE", 11)];
    };
    const ranked = (order: string[]) => {
      const { snapshot, inputs } = handLeague(edit);
      return buildTradeContext({ ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 })) }, inputs, { now: TEST_NOW, scenarios: 0 });
    };
    const proposal = trade("2", ["wb1"], ["te2", "rc2"]);
    // Team 2 claims first: it takes him, so my free-agent pickups after the trade can't.
    const theyFirst = ranked(["2", "1", "3", "4"]);
    const I = tradeInternals(theyFirst);
    expect((I.me as TeamState).vstar.moves.map((m) => m.add)).toEqual(["fte"]);
    expect((I.byId.get("2") as TeamState).vstar.moves).toEqual([]);
    const a = exact(theyFirst, proposal);
    expect(a.evaluation.required.partner).toEqual({ drops: [], adds: ["fte"], openSpots: [{ playerId: "fte", pos: "TE", yours: true }] });
    expect(a.mine.roster).not.toContain("fte");
    // I claim first: Team 2 can't take him (my pickups after the trade have him again), and its spot takes the next TE.
    const meFirst = exact(ranked(["1", "2", "3", "4"]), proposal);
    expect(meFirst.evaluation.required.partner).toEqual({ drops: [], adds: ["ft"], openSpots: [{ playerId: "ft", pos: "TE" }] });
    expect(meFirst.mine.roster).toContain("fte");
    // A partner claiming after me, with nobody between us, takes my pickup only when I no longer want him: not marked. My
    // 12-point bench RB holds my FLEX, so once I get Team 2's 14-point TE the free-agent TE adds nothing for me.
    const { snapshot, inputs } = handLeague((spec) => {
      swapPlayer(spec, "1", "rc1", flat("rc1", "RB", 12));
      swapPlayer(spec, "2", "te2", flat("te2", "TE", 14));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("fte", "TE", 11)];
    });
    const after = buildTradeContext({ ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, waiverRank: Number(t.id) })) }, inputs, { now: TEST_NOW, scenarios: 0 });
    expect(tradeInternals(after).me?.vstar.moves.map((m) => m.add)).toEqual(["fte"]);
    const given = exact(after, proposal);
    expect(given.mine.roster).not.toContain("fte");
    expect(given.evaluation.required.partner).toEqual({ drops: [], adds: ["fte"], openSpots: [{ playerId: "fte", pos: "TE" }] });
  });

  it("rule 4 in exact evaluation with scenarios: the fill is the free agent at the short position whose add gains the most scenario ROS (brute force; ties: more ROS points)", () => {
    // Free-agent RBs of every kind: steady ones, one out this week, one doubtful; the trades leave an RB slot empty, the FLEX
    // to an RB, or only the bench short (depth: he starts only when a starter is hurt or on bye). Never my bench RB: my
    // baseline cuts him for the RB who's out this week, so giving him opens no spot of the trade's (finding pickups-1, below).
    const ctx = context(
      (spec) => {
        spec.freeAgents = [
          ...(spec.freeAgents ?? []),
          flat("fr3", "RB", 3.4),
          flat("fr5", "RB", 5.2, { injury: "OUT" }),
          flat("fr4", "RB", 4.4, { injury: "DOUBTFUL" }),
          flat("fw6", "WR", 6),
        ];
      },
      {},
      { scenarios: 8 },
    );
    const I = tradeInternals(ctx);
    expect(I.S).toBe(8);
    const me = I.me as TeamState;
    const ros = (id: string) => I.league.lp.players[id]?.ros.total ?? 0;
    const pool = othersPool(I, I.byId.get("2") as TeamState);
    let differs = 0;
    expect(me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fr5", "rc1"]]);
    for (const [give, get] of [
      [["ra1", "rb1"], ["wa2"]],
      [["rb1", "wb1"], ["wa2"]],
      [["rb1", "wc1"], ["wa2"]],
    ] as [string[], string[]][]) {
      const side = legalSide(I, me, me.roster, give, get, "exact", "You", "none", pool);
      if ("illegal" in side) throw new Error(side.illegal);
      const pre = side.roster.filter((id) => !side.change.adds.includes(id));
      const base = I.league.scenRosOf(pre, side.spec);
      const rbs = I.league.freeAgentIds.filter((id) => I.league.table.rows.get(id)?.pos === "RB" && !pool.excluded.has(id));
      expect(rbs.length, `${give} for ${get}`).toBeGreaterThan(2);
      const gains = rbs.map((id) => ({ id, gain: I.league.scenRosOf([...pre, id], side.spec) - base }));
      const top = Math.max(...gains.map((g) => g.gain));
      const want = top > 1e-9 ? gains.filter((g) => g.gain >= top - 1e-6).sort((a, b) => ros(b.id) - ros(a.id) || (a.id < b.id ? -1 : 1))[0]?.id : gains.map((g) => g.id).sort((a, b) => ros(b) - ros(a) || (a < b ? -1 : 1))[0];
      expect(top, `${give} for ${get}`).toBeGreaterThan(1);
      expect(side.change.openSpots, `${give} for ${get}`).toEqual([{ playerId: want, pos: "RB" }]);
      // The EV lineups' pick (screening's metric) on the same roster.
      const ev = solveEvWeeks(teamEval([...pre.flatMap((id) => I.league.table.rows.get(id) ?? []), ...side.spec.rows, ...returnersOf(side.spec)], I.league.slots), I.W);
      const evGain = (id: string) => {
        const r = I.league.table.rows.get(id) as TableRow;
        return addGainExact(ev, r, I.league.maskOf(r), I.weights).gain;
      };
      const evBest = [...rbs].sort((a, b) => evGain(b) - evGain(a) || ros(b) - ros(a) || (a < b ? -1 : 1))[0];
      if (evBest !== want) differs++;
    }
    // A depth pickup can be worth more in scenario lineups than his expected-value gain says: the pick can differ.
    expect(differs).toBeGreaterThan(0);
  });

  it("rule 4 in screening (EV lineups, from V*(T)) picks by the same rule: the position given up", () => {
    const ctx = context();
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    const side = legalSide(I, me, me.vstar.roster, ["wb1", "rc1"], ["wa2"], "ev", "You", "ros", me.pool);
    if ("illegal" in side) throw new Error(side.illegal);
    expect(side.change).toEqual({ drops: [], adds: ["fr"], openSpots: [{ playerId: "fr", pos: "RB" }] });
    // Its EV ROS is the final roster's, exactly (the add's gain tracked: legalSide's header).
    expect(side.ros).toBeCloseTo(rosValue(tradeInternals(ctx).league.optimizer.evaluate(side.roster, me.stream).solved.lv, I.weights), 9);
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
  it("evaluates exactly as a card is shown: final stage, shownSims seasons (Checkpoint 7e), the card's numbers, words", () => {
    const ctx = context(() => undefined, {}, { scenarios: 8 });
    const proposal = trade("2", ["wb1", "rc1"], ["wa2"]);
    const a = analyzeTrade(ctx, proposal);
    const ev = a.evaluation;
    expect(a.illegal).toBeNull();
    expect(ev?.key).toBe(proposalKey(proposal));
    expect(ev?.stage).toBe("final");
    // The shown block (Checkpoint 7e, planner reply to Checkpoint 7d, item 1.1): the seasons every card's numbers are printed
    // from, which the Analyzer evaluates on (the search ranks on the first simCounts().final of them).
    expect(ev?.sims).toBe(simCounts().shown);
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
