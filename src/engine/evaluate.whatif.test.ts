/**
 * The Trade Analyzer's "What if" (Checkpoint 7h; planner reply to Checkpoint 7g, section 4: "Pick players to take off your
 * roster and any players to put on it, from any team or from free agency. There's no partner and no chance they accept.
 * Roster rules apply as usual."; evaluate.ts analyzeWhatIf). Hand leagues (trade.testing.ts handLeague: 4 teams of 10, every
 * roster full, flat projections, team "1" mine) whose right answers are obvious. Teams are placeholders and players made up.
 */
import { describe, expect, it } from "vitest";
import { benefitWin, helpsScale, tradeScore } from "./benefit";
import { config } from "./config";
import {
  WHAT_IF_NO_ODDS_NOTE,
  WHAT_IF_NO_TEAM_NOTE,
  WHAT_IF_SEASON_OVER_NOTE,
  analyzeTrade,
  analyzeWhatIf,
  buildTradeContext,
  helpsScaleOf,
  rewardFor,
  tradeInternals,
  untouchableDropNote,
  whatIfKey,
  whatIfScaleOf,
  type TradeContextOptions,
  type WhatIfAnalysis,
  type WhatIfEvaluation,
} from "./evaluate";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import type { TestLeagueSpec } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, type SeasonSpec } from "./trade.testing";

/** A hand league's context (EV lineups unless `opts.scenarios` says otherwise), with `settings` (the context reads my untouchables). */
function context(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague(edit, season);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
}

/** The evaluation, or the reason it can't be made as an Error (the tests that need one). */
function evaluated(a: WhatIfAnalysis): WhatIfEvaluation {
  if (!a.evaluation) throw new Error(a.illegal ?? "no evaluation");
  return a.evaluation;
}

/** A free agent my baseline picks up (V*(T): +4.9 a week at FLEX over Testy rc1), dropping my bench WR wc1. */
const withMyPickup = (spec: TestLeagueSpec) => {
  spec.freeAgents = [...(spec.freeAgents ?? []), flat("fx", "WR", 9)];
};

describe("analyzeWhatIf: nothing changed reads nothing", () => {
  it("an empty what-if is the baseline itself: every change exactly 0, no move", () => {
    const ctx = context();
    const e = evaluated(analyzeWhatIf(ctx, { remove: [], add: [] }));
    const I = tradeInternals(ctx);
    expect(e.key).toBe("whatif|remove:|add:");
    expect([e.dPO, e.dCH, e.dEW, e.dPPW, e.dPPWPlayoffs]).toEqual([0, 0, 0, 0, 0]);
    expect(Object.values(e.dPrizes ?? {}).every((d) => d === 0 || d === null)).toBe(true);
    expect(e.b).toBe(0);
    expect(e.tradeScore).toBeNull();
    expect(e.before).toBeUndefined();
    expect(e.myMoves).toEqual({ moves: [], assumed: [] });
    expect(e.roster).toEqual([...(I.me?.vstar.roster ?? [])]);
    expect(e.ros).toEqual({ removed: 0, added: 0 });
    expect(e.sims).toBe(config.simulation.shownSims);
    expect((e.detail.winChance ?? []).every((w) => w.before === w.after)).toBe(true);
  });

  it("taking off a player my baseline cuts anyway changes nothing exactly (his spot is my pickup's either way)", () => {
    const ctx = context(withMyPickup);
    const I = tradeInternals(ctx);
    // The baseline picks up fx for wc1 (my bench WR).
    expect(I.me?.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["fx", "wc1"]]);
    const e = evaluated(analyzeWhatIf(ctx, { remove: ["wc1"], add: [] }));
    expect([e.dPO, e.dCH, e.dEW, e.dPPW, e.dPPWPlayoffs, e.b]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(e.roster).toEqual([...(I.me?.vstar.roster ?? [])]);
    // No move of the change's own; the League page's pickup is assumed either way (its drop taken off here).
    expect(e.myMoves.moves).toEqual([]);
    expect(e.myMoves.assumed).toEqual([{ add: "fx", drop: null }]);
  });

  it("deterministic: the same what-if on two contexts built alike gives the same answer", () => {
    const a = analyzeWhatIf(context(withMyPickup), { remove: ["q1"], add: ["fw"] });
    const b = analyzeWhatIf(context(withMyPickup), { remove: ["q1"], add: ["fw"] });
    expect(a).toEqual(b);
    expect(a.evaluation?.dCH).not.toBe(0);
  });
});

describe("analyzeWhatIf: my roster rules as for my side of a trade", () => {
  it("putting a player on a full roster drops one by legality (the lowest keep value, never the player put on)", () => {
    const e = evaluated(analyzeWhatIf(context(), { remove: [], add: ["fw"] }));
    expect(e.roster).toContain("fw");
    expect(e.roster).not.toContain("wc1");
    expect(e.myMoves.moves).toEqual([{ kind: "makeRoom", week: 5, drop: ["wc1"], for: ["fw"] }]);
    // A bench WR for a bench WR: the lineup doesn't move, nor do the odds.
    expect(e.dPPW).toBe(0);
    expect(e.dCH).toBe(0);
    expect(e.ros.added).toBeGreaterThan(0);
    expect(e.ros.removed).toBe(0);
  });

  it("taking off a starter lowers my odds: the open spot takes the best free agent at his position", () => {
    const e = evaluated(analyzeWhatIf(context(), { remove: ["q1"], add: [] }));
    expect(e.roster).toContain("fq");
    expect(e.myMoves.moves).toEqual([{ kind: "openSpot", week: 5, spot: { playerId: "fq", pos: "QB" } }]);
    // Testy fq's 6 points a week for Testy q1's 20 (less a little each for future injury risk: availability below 1).
    expect(e.dPPW).toBeLessThan(-12);
    expect(e.dPPW).toBeGreaterThan(-14.5);
    expect(e.dCH).toBeLessThan(0);
    expect(e.dPO).toBeLessThanOrEqual(0);
    expect(e.b).toBeLessThan(0);
    expect(e.tradeScore).toBeNull();
    // My win chance falls in every week I play.
    const weeks = e.detail.winChance ?? [];
    expect(weeks.length).toBeGreaterThan(0);
    for (const w of weeks) expect(w.after as number).toBeLessThan(w.before as number);
  });

  it("putting on a better player raises my odds, Helps you on the season's scale (B_win on B_win₃)", () => {
    const ctx = context();
    const a = analyzeWhatIf(ctx, { remove: [], add: ["ra2"] });
    const e = evaluated(a);
    expect(e.dPPW).toBeGreaterThan(0);
    expect(e.b).toBeGreaterThan(0);
    const I = tradeInternals(ctx);
    const reward = rewardFor(I, defaultTradeSettings());
    expect(e.b).toBe(benefitWin(e.dPO, e.dPrizes, config.benefit, reward).bWin);
    expect(e.b3).toBe(whatIfScaleOf(I, reward)?.b3);
    expect(e.tradeScore).toBe(tradeScore(e.b, e.b3));
    expect(e.tradeScore).toBeGreaterThan(0);
    // In a redraft league the season's scale is the trade's own B₃ for the same reward.
    expect(e.b3).toBe(helpsScaleOf(I, null, reward)?.b3);
    expect(a.helpsScale?.lambda).toBeNull();
  });

  it("other teams stay as they are: the player put on still plays for his team (a trade taking him from them helps me more)", () => {
    const ctx = context();
    const whatIf = evaluated(analyzeWhatIf(ctx, { remove: [], add: ["ra2"] }));
    const trade = analyzeTrade(ctx, { partnerId: "2", give: [], get: [{ kind: "player", id: "ra2" }] }, { later: false }).evaluation;
    // My side is the same roster either way …
    expect(whatIf.dPPW).toBeCloseTo(trade?.dPPW ?? NaN, 9);
    // … but the trade also weakens Team 2, so my title odds rise more there.
    expect(trade?.dCH ?? 0).toBeGreaterThan(whatIf.dCH ?? 0);
  });

  it("the open spot's fill comes from my own pool: a free agent another team's baseline picks up stays its pickup", () => {
    const { snapshot, inputs } = handLeague(withMyPickup);
    // Team 2 claims first (the waiver order), so it picks up fx (+4.8 a week at its FLEX).
    const order = ["2", "1", "3", "4"];
    const ranked = { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, waiverRank: order.indexOf(t.id) + 1 })) };
    const ctx = buildTradeContext(ranked, inputs, { now: TEST_NOW, scenarios: 0 });
    expect(tradeInternals(ctx).byId.get("2")?.claimed).toEqual(["fx"]);
    const e = evaluated(analyzeWhatIf(ctx, { remove: ["wa1"], add: [] }));
    // The WR spot taking off Testy wa1 opens takes fw, the best WR left to me, never Team 2's fx.
    expect(e.roster).toContain("fw");
    expect(e.roster).not.toContain("fx");
    // Putting fx on myself is the user's call: allowed (Team 2 keeps its pickup too, as every other team stays as it is).
    expect(evaluated(analyzeWhatIf(ctx, { remove: [], add: ["fx"] })).roster).toContain("fx");
  });

  it("my pickups after the change never drop a player put on (⚠️ ours), so the numbers are about having him", () => {
    const ctx = context(withMyPickup);
    const e = evaluated(analyzeWhatIf(ctx, { remove: [], add: ["fw"] }));
    // Legality drops wc1 for him; my pickup fx then cuts rc1, not fw (without the keep set, the cheaper fw would go).
    expect(e.roster).toEqual(expect.arrayContaining(["fw", "fx"]));
    expect(e.roster).not.toContain("rc1");
    expect(e.myMoves.moves).toEqual([{ kind: "makeRoom", week: 5, drop: ["rc1"], for: ["fw"] }]);
    expect(e.myMoves.assumed).toEqual([{ add: "fx", drop: "wc1" }]);
  });

  it("a player put on from another team's IR goes into my open IR slot (rule 5): no roster spot now, a release at his return", () => {
    const ctx = context((spec) => {
      const team2 = spec.teams[1];
      if (team2) team2.ir = [flat("ir2", "WR", 15, { injury: "IR", injuryReturnWeek: 7 })];
    });
    const e = evaluated(analyzeWhatIf(ctx, { remove: [], add: ["ir2"] }));
    // My roster is full, so when he's back in week 7 the lowest keep value player goes (returners.ts), as after a trade.
    expect(e.myMoves.moves).toEqual([
      { kind: "toIR", week: 5, player: "ir2" },
      { kind: "release", week: 7, player: "wc1", returner: "ir2" },
    ]);
    expect(e.roster).not.toContain("ir2");
    expect(e.roster).toContain("wc1");
    expect(e.tagged).toEqual([{ playerId: "ir2", side: "get", status: "IR", returnWeek: 7 }]);
    // He helps once he's back.
    expect(e.dPPWPlayoffs).toBeGreaterThan(0);
  });

  it("never drops one of my untouchables; with only untouchables to drop it can't be made, and says why", () => {
    const withUntouchables = (untouchables: string[]): Partial<TradeContextOptions> => ({ settings: { ...defaultTradeSettings(), untouchables } as TradeSettings });
    const e = evaluated(analyzeWhatIf(context(() => undefined, {}, withUntouchables(["wc1"])), { remove: [], add: ["fw"] }));
    expect(e.roster).toContain("wc1");
    expect(e.myMoves.moves).toEqual([{ kind: "makeRoom", week: 5, drop: ["rc1"], for: ["fw"] }]);
    const mine = ["q1", "ra1", "rb1", "wa1", "wb1", "te1", "k1", "d1", "rc1", "wc1"];
    const all = analyzeWhatIf(context(() => undefined, {}, withUntouchables(mine)), { remove: [], add: ["fw"] });
    expect(all.evaluation).toBeNull();
    expect(all.illegal).toBe(untouchableDropNote(null));
    // Taking off an untouchable is the user's own call (as giving him in a trade).
    expect(analyzeWhatIf(context(() => undefined, {}, withUntouchables(["wc1"])), { remove: ["wc1"], add: [] }).illegal).toBeNull();
  });
});

describe("analyzeWhatIf: what can't be checked, and the notes", () => {
  it("refuses players it can't move, in plain words", () => {
    const ctx = context((spec) => {
      const team3 = spec.teams[2];
      if (team3) team3.taxi = [flat("tx3", "RB", 5)];
    });
    const why = (remove: string[], add: string[]) => analyzeWhatIf(ctx, { remove, add }).illegal;
    expect(why(["ra2"], [])).toBe("Testy McTest ra2 isn't on your active roster or IR.");
    expect(why([], ["ra1"])).toBe("Testy McTest ra1 is already on your roster.");
    expect(why(["q1"], ["q1"])).toBe("Testy McTest q1 is picked twice.");
    expect(why([], ["fw", "fw"])).toBe("Testy McTest fw is picked twice.");
    expect(why([], ["tx3"])).toBe("Testy McTest tx3 is on Team 3's taxi squad: only active-roster and IR players can be put on here.");
    expect(why([], ["nobody"])).toBe("A player isn't on a roster or among the free agents in this league's data.");
    const max = config.search.analyzerMaxPerSide;
    expect(why(["q1", "ra1", "rb1", "wa1", "wb1"].slice(0, max + 1), [])).toBe(`You can take off at most ${max} players and put on at most ${max} players here.`);
    expect(why([], ["fq", "fr", "fw", "ft", "fk"].slice(0, max + 1))).toBe(`You can take off at most ${max} players and put on at most ${max} players here.`);
    // Another team's player, a free agent, my IR-less roster's players: all fine.
    expect(why(["wb1"], ["wa3", "fr"])).toBeNull();
  });

  it("no team picked: nothing evaluated, the note in a what-if's words", () => {
    const ctx = context((spec) => {
      spec.myTeamId = null;
    });
    expect(analyzeWhatIf(ctx, { remove: [], add: ["fw"] })).toEqual({ evaluation: null, illegal: null, notes: [WHAT_IF_NO_TEAM_NOTE] });
  });

  it("no odds: the roster moves and points, no B, the note in a what-if's words", () => {
    const { snapshot, inputs } = handLeague();
    const ctx = buildTradeContext({ ...snapshot, schedule: [] }, inputs, { now: TEST_NOW, scenarios: 0 });
    const a = analyzeWhatIf(ctx, { remove: ["q1"], add: [] });
    const e = evaluated(a);
    expect(a.notes).toContain(WHAT_IF_NO_ODDS_NOTE);
    expect([e.b, e.tradeScore, e.b3, e.dPO, e.dCH, e.dPrizes]).toEqual([null, null, null, null, null, null]);
    expect(e.sims).toBe(0);
    expect(e.detail.winChance).toBeUndefined();
    expect(e.dPPW).toBeLessThan(-12);
    expect(a.helpsScale).toBeNull();
  });

  it("the trade deadline isn't a what-if's note; the season over is, in its words", () => {
    const deadline = analyzeWhatIf(context(() => undefined, { tradeDeadline: { date: "2026-09-01T00:00:00.000Z" } }), { remove: [], add: ["fw"] });
    expect(deadline.notes).toEqual([]);
    expect(deadline.evaluation).not.toBeNull();
    const over = analyzeWhatIf(
      context(
        (spec) => {
          spec.currentWeek = 8;
        },
        { pastWinnersOrder: ["2", "3", "4", "1"] },
      ),
      { remove: [], add: ["fw"] },
    );
    expect(over.notes).toContain(WHAT_IF_SEASON_OVER_NOTE);
    expect(over.notes.every((n) => !/\btrade/i.test(n))).toBe(true);
  });

  it("a player put on without projections is said to add nothing", () => {
    const ctx = context((spec) => {
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("blank", "WR", 0, { noInputs: true })];
    });
    const a = analyzeWhatIf(ctx, { remove: [], add: ["blank"] });
    expect(a.notes).toContain("Testy McTest blank has no projections here, so he adds nothing to these numbers.");
  });

  it("whatIfKey sorts each list, so the order picked doesn't matter", () => {
    expect(whatIfKey({ remove: ["b", "a"], add: ["d", "c"] })).toBe("whatif|remove:a,b|add:c,d");
    expect(whatIfKey({ remove: ["a", "b"], add: ["c", "d"] })).toBe(whatIfKey({ remove: ["b", "a"], add: ["d", "c"] }));
  });
});

describe("analyzeWhatIf's scale in a dynasty league: the season's, never mixed with long-term value", () => {
  it("B₃ is B_win₃ (no long-term mix), while a trade's is B_ref(λ)", () => {
    const { snapshot, inputs } = handLeague(() => undefined, { leagueType: "dynasty" });
    const market = inputs.market;
    if (!market) throw new Error("no market");
    // Long-term values loaded (benefit.futureValuesLoaded: a dynasty format's list).
    const ctx = buildTradeContext(snapshot, { ...inputs, market: { ...market, format: { ...market.format, isDynasty: true } } }, { now: TEST_NOW, scenarios: 0 });
    const I = tradeInternals(ctx);
    expect(I.future).not.toBeNull();
    const reward = rewardFor(I, defaultTradeSettings());
    const own = whatIfScaleOf(I, reward);
    const season = helpsScale(I.sim?.calibration, { leagueType: "dynasty", myPPlayoffs: I.sim?.base.shown.pPlayoffs ?? null, lambda: null, reward, dynastyTotal: null });
    expect(own?.b3).toBe(season?.b3);
    expect(own?.lambda).toBeNull();
    // A trade's scale mixes long-term value in (B_ref(λ)); the what-if's doesn't.
    const trade = helpsScaleOf(I, null, reward);
    expect(trade?.lambda).not.toBeNull();
    expect(trade?.b3).not.toBe(own?.b3);
    const a = analyzeWhatIf(ctx, { remove: [], add: ["ra2"] });
    const e = evaluated(a);
    expect(e.b3).toBe(own?.b3);
    expect(a.helpsScale?.lambda).toBeNull();
    // B is the odds' alone: no long-term term.
    expect(e.b).toBe(benefitWin(e.dPO, e.dPrizes, config.benefit, reward).bWin);
  });
});
