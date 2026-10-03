/**
 * What reaches each number of an evaluation (review of track E, item 4): the rows the simulation reads, the after-trade
 * V* re-run, the week in progress, every acceptance feature and card number in scenario lineups, the legality readings
 * (pre-trade caps, minimums, the dynasty keep value), and items 5–7 (kickers refilled for a team that doesn't stream
 * them, a bye crunch inside a two-week matchup, the explanation context).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { needFeature, partnerLineupDelta } from "./acceptance";
import { analyzeTrade, buildTradeContext, evaluateExact, explainContextOf, simCounts, simulateTrade, tradeInternals, type ExactTrade, type SimState, type TeamState, type TradeContextOptions } from "./evaluate";
import type { Matchup } from "./model";
import { seasonOdds, type SeasonModel } from "./season";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, roundRobin, type SeasonSpec } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

function context(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague(edit, season);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
}

function exact(ctx: ReturnType<typeof buildTradeContext>, proposal: TradeProposal): ExactTrade {
  const x = evaluateExact(tradeInternals(ctx), proposal, 4);
  if ("illegal" in x) throw new Error(x.illegal);
  return x;
}

describe("the rows that reach the simulation (item 4a)", () => {
  const ctx = context(() => undefined, {}, { scenarios: 8 });
  const I = tradeInternals(ctx);
  const me = I.me as TeamState;
  // My bench WR for Team 2's starting RB: a clear upgrade for me, a loss for a rival.
  const x = exact(ctx, trade("2", ["wc1"], ["ra2"]));

  it("a trade that clearly upgrades me, in a league where my P(playoffs) is between 0 and 1: ΔPO > 0, B > 0", () => {
    const base = I.sim?.base.final.pPlayoffs as number;
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(1);
    const final = simulateTrade(I, x, "final", null);
    expect(final.dPO).toBeGreaterThan(0);
    expect(final.b).toBeGreaterThan(0);
  });

  it("my row and the partner's row each move my odds on their own", () => {
    const onlyMine = simulateTrade(I, { ...x, theirs: x.partner.base }, "final", null);
    const onlyTheirs = simulateTrade(I, { ...x, mine: me.base }, "final", null);
    expect(onlyMine.dPO).toBeGreaterThan(0);
    // The partner, a rival for the two playoff spots, gets weaker.
    expect(onlyTheirs.dPO).toBeGreaterThan(0);
    expect(onlyTheirs.dPO).toBeLessThan(simulateTrade(I, x, "final", null).dPO as number);
  });

  it("ΔPO equals season.seasonOdds run with both rows swapped, on the final block of seasons", () => {
    const sim = I.sim as SimState;
    const model = (swap: boolean): SeasonModel => ({
      weeks: I.league.lp.weeks.weeks,
      regularWeeks: I.league.lp.weeks.regularWeeks,
      playoffWeeks: I.league.lp.weeks.playoffWeeks,
      inProgressWeek: I.league.tw.inProgressWeek,
      teams: I.teams.map((t) => {
        const score = swap && t === me ? x.mine.score : swap && t === x.partner ? x.theirs.score : t.base.score;
        return { id: t.id, score: { mean: Array.from(score.mean), sd: Array.from(score.sd) } };
      }),
    });
    const odds = (swap: boolean) => seasonOdds(I.snapshot, model(swap), { sims: simCounts().final, seed: sim.seed, normals: sim.blocks.final })?.teams[me.index]?.pPlayoffs as number;
    expect(simulateTrade(I, x, "final", null).dPO).toBe(odds(true) - odds(false));
    // The screening block is another set of seasons: the baseline differs between the two.
    expect(sim.base.screen.pPlayoffs).not.toBe(sim.base.final.pPlayoffs);
  });
});

describe("the after-trade V* re-run (item 4b)", () => {
  it("re-makes the pickup V*(me) made: the after roster is the optimizer's output, not the legality roster", () => {
    // My WR2 is weak (4) and a 9-point free-agent WR is V*(me)'s pickup; a trade of RBs leaves that hole open.
    const ctx = context((spec) => {
      swapPlayer(spec, "1", "wb1", flat("wb1", "WR", 4));
      swapPlayer(spec, "1", "rc1", flat("rc1", "RB", 10));
      spec.freeAgents = [...(spec.freeAgents ?? []), flat("zfa", "WR", 9)];
    });
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    expect(me.vstar.moves.map((m) => m.add)).toEqual(["zfa"]);
    const x = exact(ctx, trade("2", ["rb1"], ["rb2"]));
    expect(x.evaluation.required.me).toEqual({ drops: [], adds: [] });
    const legal = [...me.roster].map((id) => (id === "rb1" ? "rb2" : id));
    const run = I.league.optimizer.optimize(legal, me.stream);
    expect([...x.mine.roster]).toEqual([...run.roster]);
    expect(x.mine.roster).toContain("zfa");
    expect([...x.mine.roster].sort()).not.toEqual([...legal].sort());
  });
});

describe("the week in progress (item 4c)", () => {
  it("is held at TeamModel.score's week-0 value on both sides, though the trade changes that week's lineup", () => {
    // AAA's week-5 game has kicked off, BBB's hasn't: the traded WRs play later this week.
    const ctx = context((spec) => {
      spec.kickoffs = { 5: { AAA: "2026-09-29T00:00:00.000Z", BBB: "2026-10-05T00:00:00.000Z" } };
      swapPlayer(spec, "1", "wa1", flat("wa1", "WR", 14, { nflTeam: "BBB" }));
      swapPlayer(spec, "2", "wa2", flat("wa2", "WR", 18, { nflTeam: "BBB" }));
    });
    const I = tradeInternals(ctx);
    const me = I.me as TeamState;
    expect(I.inProgress).toBe(true);
    const x = exact(ctx, trade("2", ["wa1"], ["wa2"]));
    expect(x.mine.lv[0]).not.toBe(me.base.lv[0]); // the partial week does change (BBB hasn't played)
    expect(x.mine.score.mean[0]).toBe(I.model.teams[me.index]?.score.mean[0]);
    expect(x.mine.score.sd[0]).toBe(I.model.teams[me.index]?.score.sd[0]);
    expect(x.theirs.score.mean[0]).toBe(I.model.teams[x.partner.index]?.score.mean[0]);
    expect(x.evaluation.detail.weekly[0]).toEqual({ week: 5, before: I.model.teams[me.index]?.score.mean[0], after: I.model.teams[me.index]?.score.mean[0] });
  });
});

describe("one Analyzer evaluation in scenario lineups, wire by wire (item 4d)", () => {
  // NFL week 7 of a 1–8 regular season, a 2-team playoff in week 9. Team 2 is 6-0 (a contender), Team 4 0-6 (out).
  // My QB, RB1 and WR1 are on bye in week 8; my WR2 is hot, and so is Team 2's; Team 2's TE scores 1 (a hole) and its
  // RB2 is out. The deadline is 3 days away.
  const ctx = context(
    (spec) => {
      spec.currentWeek = 7;
      spec.byeWeek = { BYE8: 8 };
      swapPlayer(spec, "1", "wb1", flat("wb1", "WR", 11, { actual: { 5: 22, 6: 23 } }));
      for (const [id, pos, pts] of [["q1", "QB", 20], ["ra1", "RB", 15], ["wa1", "WR", 14]] as const) swapPlayer(spec, "1", id, flat(id, pos, pts, { nflTeam: "BYE8" }));
      swapPlayer(spec, "2", "te2", flat("te2", "TE", 1));
      swapPlayer(spec, "2", "rb2", flat("ox2", "RB", 12, { injury: "OUT" }));
      swapPlayer(spec, "2", "wb2", flat("hot2", "WR", 10, { actual: { 5: 25, 6: 21 } }));
    },
    { pastWinnersOrder: ["2", "1", "3", "4"], tradeDeadline: { date: "2026-10-03T00:00:00.000Z" } },
    { scenarios: 16 },
  );
  const I = tradeInternals(ctx);
  const me = I.me as TeamState;
  const proposal = trade("2", ["te1", "wb1"], ["ox2"]);
  const ev = analyzeTrade(ctx, proposal).evaluation;
  const x = exact(ctx, proposal);
  const ros = (id: string) => I.league.lp.players[id]?.ros.total as number;

  it("hot, urgency and the partner's context", () => {
    expect(ev?.features.hot).toBe(config.acceptance.hot.bonus); // Team 2 receives my hot WR
    expect(ev?.detail.hotReceived).toEqual(["wb1"]);
    expect(ev?.detail.hotGiven).toEqual([]);
    expect(analyzeTrade(ctx, trade("2", ["wc1"], ["hot2"])).evaluation?.features.hot).toBe(-config.acceptance.hot.bonus);
    expect(ev?.features.urg).toBe(config.acceptance.urgency.bonus);
    expect(ev?.detail.urgency).toBe(config.acceptance.urgency.bonus);
    expect(ev?.detail.context.contender).toBe(true);
    expect(ev?.features.ctx).toBeCloseTo(config.acceptance.beta.need * (ev?.features.n as number) * (config.acceptance.context.contenderNeedFactor - 1), 12);
    const out = analyzeTrade(ctx, trade("4", ["wc1"], ["wc4"])).evaluation;
    expect(out?.detail.context.checkedOut).toBe(true);
    expect(out?.features.ctx).toBe(config.acceptance.context.checkedOut);
  });

  it("the hole the trade fills, the injured player received, ROS points and values by side", () => {
    expect(ev?.features.h).toBe(1);
    expect(ev?.detail.holes).toEqual(["TE1"]);
    expect(ev?.detail.holesFilled).toEqual(["TE1"]);
    expect(ev?.flags.injured).toEqual(["ox2"]);
    expect(ev?.ros.given).toBeCloseTo(ros("te1") + ros("wb1"), 9);
    expect(ev?.ros.received).toBeCloseTo(ros("ox2"), 9);
    // I receive one player for two: the waiver credit goes on my received side.
    expect(ev?.value.given).toBeCloseTo((I.values.te1 ?? 0) + (I.values.wb1 ?? 0), 9);
    expect(ev?.value.received).toBeCloseTo((I.values.ox2 ?? 0) + I.credit, 9);
  });

  it("ΔPPW over the counted regular-season weeks only, ΔPPW in the playoffs, and n from the partner's scenario lineups", () => {
    const mean = (a: Float64Array, b: Float64Array, idx: number[]) => idx.reduce((s, w) => s + (a[w] as number) - (b[w] as number), 0) / idx.length;
    expect(I.regIdx).toEqual([0, 1]);
    expect(I.poIdx).toEqual([2]);
    expect(ev?.dPPW).toBeCloseTo(mean(x.mine.lv, me.base.lv, I.regIdx), 9);
    expect(ev?.dPPWPlayoffs).toBeCloseTo(mean(x.mine.lv, me.base.lv, I.poIdx), 9);
    const delta = partnerLineupDelta(x.partner.base.lv, x.theirs.lv, I.from).blended;
    expect(ev?.partnerDeltaLineup).toBe(delta);
    expect(ev?.features.n).toBe(needFeature(delta));
  });

  it("the partner's ranks, my risky weeks, and title odds", () => {
    const partner = x.partner;
    ev?.detail.partnerSlots.forEach((s, i) => expect(s.rank, s.key).toBe(1 + I.teams.filter((t) => (t.base.regular[i] as number) > (partner.base.regular[i] as number) + 1e-9).length));
    expect(ev?.detail.riskyWeeks).toEqual([8]);
    expect(ev?.dCH).not.toBeNull();
  });

  it("ΔCH is null when the league's title odds are unknown (fewer playoff rounds than its bracket needs)", () => {
    const unknown = context(() => undefined, { playoffTeams: 3 }, { scenarios: 8 });
    const a = analyzeTrade(unknown, trade("2", ["wc1"], ["ra2"])).evaluation;
    expect(tradeInternals(unknown).sim?.base.final.pTitle).toBeNull();
    expect(a?.dCH).toBeNull();
    expect(a?.dPO).not.toBeNull();
    expect(a?.detail.notes).toContain("Title odds aren't available for this league, so “Helps you” uses playoff odds in their place.");
  });
});

describe("legality readings (item 4f)", () => {
  it("a team already over a position limit is held to its count before the trade", () => {
    const ctx = context((spec) => {
      spec.positionLimits = { QB: 1 };
      swapPlayer(spec, "1", "wc1", flat("qx1", "QB", 5));
      swapPlayer(spec, "2", "wc2", flat("qx2", "QB", 5));
    });
    // Team 2 has 2 QBs (over its limit of 1): a trade without QBs forces nothing.
    expect(analyzeTrade(ctx, trade("2", ["rc1"], ["rc2"])).evaluation?.required.partner).toEqual({ drops: [], adds: [] });
    // Receiving a third QB: one of its own goes (back down to 2, not to 1); the spot it opens is refilled.
    const r = analyzeTrade(ctx, trade("2", ["qx1"], ["rc2"])).evaluation?.required.partner;
    expect(r?.drops).toEqual(["qx2"]);
    expect(r?.adds).toHaveLength(1);
  });

  it("a roster already over the size is held to its size before the trade", () => {
    const ctx = context(
      (spec) => {
        spec.teams[1]?.roster.push(flat("xtra2", "WR", 2));
      },
      { maxRosterSize: 10 },
    );
    expect(analyzeTrade(ctx, trade("2", ["wc1"], ["wc2"])).evaluation?.required.partner).toEqual({ drops: [], adds: [] });
    expect(analyzeTrade(ctx, trade("2", ["wc1", "rc1"], ["wc2"])).evaluation?.required.partner.drops).toHaveLength(1);
  });

  it("a minimum is enforced only up to the count the team had before the trade", () => {
    // TE minimum 2, but my team has 1: giving it away adds one free-agent TE, not two.
    const ctx = context(() => undefined, { rosterMinimums: { TE: 2 } });
    const me = analyzeTrade(ctx, trade("2", ["te1"], ["rb2"])).evaluation?.required.me;
    expect(me?.adds).toEqual(["ft"]);
    expect(me?.drops).toHaveLength(1);
  });

  it("dynasty and keeper leagues: the keep value adds the long-term value, so a valuable bench prospect stays", () => {
    // Team 2's bench WR scores 2 but is worth 9,000 long-term; its FLEX RB costs a sliver to lose once mine arrive.
    const edit = (spec: TestLeagueSpec) => swapPlayer(spec, "2", "wc2", flat("young2", "WR", 2, { value: 9000 }));
    const drops = (leagueType: "redraft" | "dynasty") => {
      const { snapshot, inputs } = handLeague(edit, { leagueType });
      if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: leagueType === "dynasty" };
      const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
      return analyzeTrade(ctx, trade("2", ["rc1", "wc1"], ["wa2"])).evaluation?.required.partner.drops;
    };
    expect(drops("redraft")).toEqual(["young2"]);
    expect(drops("dynasty")).toEqual(["rc2"]);
  });
});

describe("items 5–7", () => {
  it("item 5: a team that doesn't stream kickers and trades its only one gets a free-agent kicker in the spot", () => {
    const r = analyzeTrade(context(), trade("2", ["wc1"], ["k2", "wc2"])).evaluation?.required.partner;
    expect(r?.adds).toEqual(["fk"]);
    // My team streams K (the default setting): no kicker is added for me.
    const mine = analyzeTrade(context(), trade("2", ["k1", "wc1"], ["wc2"])).evaluation?.required.me;
    expect(mine?.adds.some((id) => id === "fk")).toBe(false);
  });

  it("item 6: a bye crunch in the second week of a two-week matchup flags the game's first week", () => {
    // Weeks 6–7 are one matchup; my QB, RB1 and WR1 are on bye in week 7.
    const { snapshot, inputs } = handLeague((spec) => {
      spec.byeWeek = { BYE7: 7 };
      for (const [id, pos, pts] of [["q1", "QB", 20], ["ra1", "RB", 15], ["wa1", "WR", 14]] as const) swapPlayer(spec, "1", id, flat(id, pos, pts, { nflTeam: "BYE7" }));
    });
    const ids = snapshot.teams.map((t) => t.id);
    const schedule: Matchup[] = roundRobin(ids, [5, 6, 8]).map((m) => (m.week === 6 ? { ...m, weeks: [6, 7] } : m));
    const ctx = buildTradeContext({ ...snapshot, schedule }, inputs, { now: TEST_NOW, scenarios: 0 });
    expect(ctx.notes).toEqual([]);
    expect(tradeInternals(ctx).riskyWeeks).toContain(6);
    expect(tradeInternals(ctx).riskyWeeks).not.toContain(7);
  });

  it("item 7: the explanation context carries injury statuses and each slot's positions", () => {
    const ctx = context((spec) => swapPlayer(spec, "2", "rb2", flat("rb2", "RB", 11, { injury: "OUT" })));
    const e = explainContextOf(tradeInternals(ctx));
    expect(e.player("rb2")?.injury).toBe("OUT");
    expect(e.player("ra2")?.injury).toBe("ACTIVE");
    const eligible = Object.fromEntries(e.slots.map((s) => [s.key, s.eligible]));
    expect(eligible.TE1).toEqual(["TE"]);
    expect(eligible.FLEX1).toEqual(["RB", "WR", "TE"]);
    expect(eligible.QB1).toEqual(["QB"]);
  });
});
