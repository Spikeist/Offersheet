/**
 * The planner's addendum to Checkpoint 3 in trade evaluation (lead decisions N1 and N3), with the value floor of the
 * planner's reply to Checkpoint 4 (change 4, which replaces lead decision N10): the partner's g feature reads its
 * perceived g (the star premium on what it gives) in screening and in exact evaluation, while the card's g, my side and
 * the veto rule read the raw g; TradeDetail.premium; the context's premiums (P(playoffs) from its own baseline, every team
 * at V*); κ by the "Protect my trade value" level in redraft B, none in dynasty and keeper leagues; and every package with
 * each player at max(v, W) on both sides: B's market term, the card's values and g's, ΔDyn and the partner's g. Phase 4b
 * removed the before-addendum variant (N5) these tests used to compare with.
 */
import { describe, expect, it } from "vitest";
import { gFeature } from "./acceptance";
import { protectValueWeight, tradePackage } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, evaluateExact, harderToGetFor, perceivedG, premiumOf, screenTrade, tradeInternals, type ExactTrade, type TeamState, type TradeContextOptions } from "./evaluate";
import { leaguePremiums, perceivedPackage, premiumFacts } from "./premium";
import { runTradeSearch } from "./search";
import { defaultTradeSettings, PROTECT_VALUE_LEVELS, type ProtectValue } from "./settings";
import type { TestLeagueSpec, TestPlayer } from "./testLeague";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, type SeasonSpec } from "./trade.testing";
import type { TradeAsset, TradeEvaluation, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const trade = (partnerId: string, give: string[], get: string[]): TradeProposal => ({ partnerId, give: p(...give), get: p(...get) });
const clampG = (g: number) => Math.min(config.benefit.marketSanityClamp[1], Math.max(config.benefit.marketSanityClamp[0], g));

function swapPlayer(spec: TestLeagueSpec, teamId: string, id: string, by: TestPlayer): void {
  const team = spec.teams.find((t) => t.id === teamId);
  const i = team ? team.roster.findIndex((x) => x.id === id) : -1;
  if (!team || i < 0) throw new Error(`no player ${id} on team ${teamId}`);
  team.roster[i] = by;
}

/** A hand league's context (EV lineups unless `opts.scenarios` says otherwise). Team 2's QB (19 points) is its #1 and top-12, its RB1 its #2 and top-12. */
function context(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}, opts: Partial<TradeContextOptions> = {}) {
  const { snapshot, inputs } = handLeague(edit, season);
  return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
}

function exact(ctx: ReturnType<typeof buildTradeContext>, proposal: TradeProposal): ExactTrade {
  const x = evaluateExact(tradeInternals(ctx), proposal, 4);
  if ("illegal" in x) throw new Error(x.illegal);
  return x;
}

const settingsAt = (protectValue: ProtectValue) => ({ settings: { ...defaultTradeSettings(), protectValue } });

describe("the context's star premiums (N1)", () => {
  it("every team's rostered players, by the League model's own function, with P(playoffs) from the context's baseline", () => {
    const ctx = context();
    const I = tradeInternals(ctx);
    const expected = leaguePremiums({
      snapshot: I.snapshot,
      market: I.inputs.market,
      value: (id) => I.values[id] ?? 0,
      ros: (id) => I.league.lp.players[id]?.ros.total ?? 0,
      pPlayoffs: (teamId) => I.sim?.odds.teams.find((o) => o.teamId === teamId)?.pPlayoffs ?? null,
    });
    expect([...I.premiums.keys()]).toEqual(["1", "2", "3", "4"]);
    for (const [teamId, premiums] of I.premiums) expect(premiums, teamId).toStrictEqual(expected.get(teamId));
    // In a redraft league they are the League model's (TeamModel.premiums).
    for (const t of I.model.teams) expect(t.premiums).toStrictEqual(I.premiums.get(t.id));
    expect(I.premiums.get("2")?.q2).toMatchObject({ rank: 1, elite: true, harderToGet: true });
    expect(I.premiums.get("2")?.ra2).toMatchObject({ rank: 2, elite: true, harderToGet: true });
    expect(premiumOf(I, "2")("q2")).toBeCloseTo(0.2, 12);
    expect(premiumOf(I, "2")("q3")).toBe(0); // not Team 2's
    expect(harderToGetFor(I, "2", "ra2")).toBe(true);
    expect(harderToGetFor(I, "3", "ra2")).toBe(false);
  });

  it("dynasty: a rebuilding partner (its baseline P(playoffs) below 25%) counts its 28-year-old #1 RB half", () => {
    const { snapshot, inputs } = handLeague((spec) => swapPlayer(spec, "4", "ra4", flat("ra4", "RB", 12, { value: 9500 })), { leagueType: "dynasty", pastWinnersOrder: ["1", "2", "3", "4"] });
    if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
    snapshot.players.ra4 = { ...(snapshot.players.ra4 as NonNullable<(typeof snapshot.players)["ra4"]>), age: 28 };
    const I = tradeInternals(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 }));
    const odds = I.sim?.odds.teams.find((o) => o.teamId === "4");
    expect(odds?.pPlayoffs).toBeLessThan(config.acceptance.starPremium.rebuild.below);
    expect(I.premiums.get("4")?.ra4).toMatchObject({ rank: 1, elite: true, harderToGet: false });
    expect(I.premiums.get("4")?.ra4?.e).toBeCloseTo(0.1, 12);
    // The context's League model has no odds (it simulates nothing itself): there, P(playoffs) is unknown and nothing is halved.
    expect(I.model.odds).toBeNull();
    expect(I.model.teams.find((t) => t.id === "4")?.premiums?.ra4?.e).toBeCloseTo(0.2, 12);
  });
});

describe("the perceived g in evaluation (N1)", () => {
  // My WR1 (14 points, 4,900) for Team 2's RB1 (14 points, 4,900: its #2 and a top-12 player, e = 0.15).
  const ctx = context();
  const I = tradeInternals(ctx);
  const x = exact(ctx, trade("2", ["wa1"], ["ra2"]));
  const ev = x.evaluation;

  it("exact evaluation: the g feature reads the partner's perceived g; the card's g, my g and the values stay raw", () => {
    const raw = tradePackage({ players: ["wa1"] }, { players: ["ra2"] }, I.values, I.credit).g;
    const perceived = perceivedPackage({ players: ["wa1"] }, { players: ["ra2"] }, I.values, I.credit, premiumOf(I, "2")).g;
    expect(raw).toBe(0);
    expect(perceived).toBeCloseTo(1 / 1.15 - 1, 12);
    expect(perceivedG(I, "2", ["wa1"], ["ra2"])).toBe(perceived);
    expect(ev.gPartner).toBe(raw);
    expect(ev.features.g).toBe(gFeature(perceived));
    expect(ev.gMine).toBe(tradePackage({ players: ["ra2"] }, { players: ["wa1"] }, I.values, I.credit).g);
    expect(ev.value).toEqual({ given: I.values.wa1, received: I.values.ra2 });
    expect(ev.detail.premium).toStrictEqual(premiumFacts(["ra2"], I.premiums.get("2")));
    expect(ev.detail.premium?.[0]).toMatchObject({ playerId: "ra2", rank: 2, elite: true, harderToGet: true });
  });

  it("without a premium on what the partner gives, the perceived g is the raw g (perceivedG's shortcut is exact)", () => {
    // Team 2's WR2 is its #5 and not a top-12 player: e = 0.
    expect(premiumOf(I, "2")("wb2")).toBe(0);
    const raw = tradePackage({ players: ["wa1"] }, { players: ["wb2"] }, I.values, I.credit).g;
    expect(perceivedG(I, "2", ["wa1"], ["wb2"])).toBe(raw);
    expect(perceivedG(I, "2", ["wa1"], ["wb2"], raw)).toBe(raw);
    // With a premium the shortcut isn't taken, whatever raw g is passed.
    expect(perceivedG(I, "2", ["wa1"], ["ra2"], 0)).toBeCloseTo(1 / 1.15 - 1, 12);
  });

  it("a 1-for-2 where only one player the partner gives carries a premium: the perceived g, in screening and in exact evaluation", () => {
    // My RB1 for Team 2's RB1 (its #2 and a top-12 player: e = 0.15) and its bench RB (e = 0): perceivedG's shortcut
    // (the raw g when no player they give carries a premium) must not be taken (review of the addendum, engine finding 5).
    const give = ["ra1"];
    const get = ["ra2", "rc2"];
    expect(premiumOf(I, "2")("ra2")).toBeCloseTo(0.15, 12);
    expect(premiumOf(I, "2")("rc2")).toBe(0);
    const raw = tradePackage({ players: give }, { players: get }, I.values, I.credit).g;
    const perceived = perceivedPackage({ players: give }, { players: get }, I.values, I.credit, premiumOf(I, "2")).g;
    expect(perceived).toBeLessThan(raw - 0.1);
    expect(perceivedG(I, "2", give, get, raw)).toBe(perceived);
    const ev2 = exact(ctx, trade("2", give, get)).evaluation;
    expect(ev2.gPartner).toBe(raw);
    expect(ev2.features.g).toBe(gFeature(perceived));
    const s = screenTrade(I, I.byId.get("2") as TeamState, give, get);
    expect(s?.gPartner).toBe(raw);
    expect(s?.pQuick).toBeCloseTo(ev2.pAccept, 12);
  });

  it("screening's quick estimate reads the perceived g too (and equals the exact one here); its g window keeps the raw g", () => {
    const s = screenTrade(I, I.byId.get("2") as TeamState, ["wa1"], ["ra2"]);
    expect(s?.gPartner).toBe(ev.gPartner);
    expect(s?.pQuick).toBeCloseTo(ev.pAccept, 12);
  });

  it("the veto reads the raw g: −20% at market is no veto, though the partner perceives −33%", () => {
    // My bench WR is worth 7,220 (80% of Team 2's QB, 9,025: its top-12 #1, e = 0.2), in a league that votes on trades.
    const vote = context((spec) => swapPlayer(spec, "1", "wc1", flat("v1", "WR", 3, { value: 7220 })), { tradeReview: "league_vote" });
    const v = exact(vote, trade("2", ["v1"], ["q2"])).evaluation;
    expect(v.gPartner).toBeCloseTo(-0.2, 12);
    expect(v.features.g).toBeCloseTo(7220 / (9025 * 1.2) - 1, 12);
    expect(v.features.g).toBeLessThan(config.acceptance.veto.gBelow);
    expect(v.detail.vetoRisk).toBe(false);
    expect(v.pComplete).toBe(v.pAccept);
  });

  it("a search: one premium fact per player the partner gives, and the g feature on the perceived g", () => {
    const r = runTradeSearch(ctx, { partnerId: "2", settings: { ...defaultTradeSettings(), maxPerSide: 1 } });
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) {
      const get = t.proposal.get.flatMap((a) => (a.kind === "player" ? [a.id] : []));
      const give = t.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));
      expect(t.detail.premium?.map((f) => f.playerId)).toEqual(get);
      expect(t.features.g).toBe(gFeature(perceivedG(I, "2", give, get)));
    }
  });
});

describe("κ, \"Protect my trade value\" (N3)", () => {
  // My WR1 (4,900) for Team 3's WR1 (3,600): I give more trade value than I get (g_mkt(me) ≈ −0.27, inside the clamp).
  const proposal = trade("3", ["wa1"], ["wa3"]);

  it("redraft: B = B_win + κ × clamp(g_mkt(me)) with κ 2 / 4 / 8 by level, on the same seasons", () => {
    const ctx = context(() => undefined, {}, { scenarios: 8 });
    const at = Object.fromEntries(PROTECT_VALUE_LEVELS.map((level) => [level, analyzeTrade(ctx, proposal, settingsAt(level)).evaluation as TradeEvaluation])) as Record<ProtectValue, TradeEvaluation>;
    const g = at.medium.gMine;
    expect(g).toBeCloseTo(3600 / 4900 - 1, 12);
    for (const level of PROTECT_VALUE_LEVELS) {
      const ev = at[level];
      expect(ev.bWin, level).toBe(at.medium.bWin); // the simulation doesn't depend on κ
      expect(ev.b as number).toBeCloseTo((ev.bWin as number) + protectValueWeight(level) * clampG(g), 12);
      expect(protectValueWeight(level)).toBe(config.benefit.protectValue[level]);
    }
    expect(at.high.b as number).toBeLessThan(at.medium.b as number);
    expect(at.medium.b as number).toBeLessThan(at.low.b as number);
    // The default settings are medium.
    expect(analyzeTrade(ctx, proposal).evaluation?.b).toBe(at.medium.b);
  });

  it("dynasty and keeper leagues: no market term, whatever the level", () => {
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const { snapshot, inputs } = handLeague(() => undefined, { leagueType });
      if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
      const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
      const bs = PROTECT_VALUE_LEVELS.map((level) => analyzeTrade(ctx, proposal, settingsAt(level)).evaluation?.b);
      expect(bs[0], leagueType).not.toBeNull();
      expect(new Set(bs).size, leagueType).toBe(1);
    }
  });
});

describe("the value floor at W on both sides (planner reply to Checkpoint 4, change 4; replaces N10)", () => {
  /**
   * My WR2 is weak (4 points; my FLEX RB scores 10), so V*(me) picks up a 9-point free-agent WR (worth 2,025: the waiver
   * credit W) and drops my bench WR (3.1 points, worth 240, below W). Team 2's FLEX RB scores 10 too, so it doesn't want
   * the free agent (as in evaluate.test.ts's consistency test). EV lineups.
   */
  const edit = (spec: TestLeagueSpec) => {
    swapPlayer(spec, "1", "wb1", flat("wb1", "WR", 4));
    swapPlayer(spec, "1", "rc1", flat("rc1", "RB", 10));
    swapPlayer(spec, "2", "rc2", flat("rc2", "RB", 10));
    spec.freeAgents = [...(spec.freeAgents ?? []), flat("zfa", "WR", 9)];
  };
  const ctx = context(edit);
  const I = tradeInternals(ctx);
  const me = I.me as TeamState;
  const W = I.credit;
  const dump = trade("2", ["wc1"], []);

  it("a player V* drops anyway, worth less than W, given for nothing: B = 0 at Low, Medium and High", () => {
    expect(me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["zfa", "wc1"]]);
    expect(W).toBe(I.values.zfa);
    expect(I.values.wc1 as number).toBeLessThan(W);
    // After the trade my roster is V*(me)'s: the spot he opens takes the free agent V*(me) picks up anyway.
    const x = exact(ctx, dump);
    expect([...x.mine.roster]).toEqual([...me.vstar.roster]);
    // His floored W against the open spot's W: even, on the card too.
    expect(x.evaluation.gMine).toBe(0);
    for (const level of PROTECT_VALUE_LEVELS) {
      const ev = analyzeTrade(ctx, dump, settingsAt(level)).evaluation as TradeEvaluation;
      for (const k of ["dPO", "dCH", "dEW", "bWin", "b", "gMine"] as const) expect(ev[k], `${level} ${k}`).toBe(0);
      expect(ev.tradeScore, level).toBeNull();
      expect(ev.flags.hiddenByBenefit, level).toBe(true);
      expect(ev.value, level).toEqual({ given: W, received: W });
      expect(ev.flags.marketCheck, level).toBe(false);
      // Team 2 gets him (W, floored) for the roster spot he takes (W): even for it too.
      expect(ev.gPartner, level).toBe(0);
    }
  });

  it("a mixed package: the cheap player counts W, the others their value, on every number the card shows", () => {
    // My WR1 (4,900) and my bench WR (240) for Team 2's RB1 (4,900; its #2 and a top-12 player).
    const give = ["wa1", "wc1"];
    const get = ["ra2"];
    const ev = exact(ctx, trade("2", give, get)).evaluation;
    // I give 4,900 + W and get 4,900 + W (the spot I open): even.
    expect(ev.value).toEqual({ given: 4900 + W, received: 4900 + W });
    expect(ev.gMine).toBe(0);
    expect(ev.gMine).toBe(tradePackage({ players: get }, { players: give }, I.values, I.credit).g);
    // Team 2's g: even at market; as it sees it, its RB1 at 4,900 × 1.15 (the premium on the floored value, here his own).
    expect(ev.gPartner).toBe(0);
    expect(ev.features.g).toBe(gFeature(perceivedG(I, "2", give, get)));
    expect(perceivedG(I, "2", give, get)).toBeCloseTo((4900 + W) / (4900 * 1.15 + W) - 1, 12);
    for (const level of PROTECT_VALUE_LEVELS) {
      const a = analyzeTrade(ctx, trade("2", give, get), settingsAt(level)).evaluation as TradeEvaluation;
      // B is B_win alone: the market term reads the floored g, 0.
      expect(a.b as number, level).toBe(a.bWin as number);
      expect(a.gMine, level).toBe(0);
      expect(a.flags.marketCheck, level).toBe(false);
    }
  });

  it("a cheap throw-in adds 0 value; the complexity term still counts him", () => {
    const lean = exact(ctx, trade("2", ["wa1"], ["ra2"])).evaluation;
    const full = exact(ctx, trade("2", ["wa1", "wc1"], ["ra2"])).evaluation;
    // The value difference is the same (0 here): he adds W to what I give and W for the spot it opens on what I get.
    expect(full.value.received - full.value.given).toBe(lean.value.received - lean.value.given);
    expect(full.value).toEqual({ given: lean.value.given + W, received: lean.value.received + W });
    expect([lean.gMine, full.gMine, lean.gPartner, full.gPartner]).toEqual([0, 0, 0, 0]);
    // One player more: c = 1, and its term in z.
    expect([lean.features.c, full.features.c]).toEqual([0, 1]);
    expect(full.detail.terms.complexity).toBeCloseTo(-config.acceptance.beta.complexity, 12);
  });

  it("⚠️ away from even, a cheap throw-in still adds 0 value but edges every g toward 0, so the market guard and the veto can flip (reported to the planner)", () => {
    // My WR1 (4,900) for Team 2's WR1 (4,225), and the same with my bench WR (240, below W) thrown in.
    const lean = exact(ctx, trade("2", ["wa1"], ["wa2"])).evaluation;
    const full = exact(ctx, trade("2", ["wa1", "wc1"], ["wa2"])).evaluation;
    expect(full.value.received - full.value.given).toBe(lean.value.received - lean.value.given);
    expect(full.value).toEqual({ given: lean.value.given + W, received: lean.value.received + W });
    // Each g × PV_give / (PV_give + W): mine over what I give, the partner's over what it gives (what I get).
    expect(full.gMine).toBeCloseTo((lean.gMine * lean.value.given) / (lean.value.given + W), 12);
    expect(full.gPartner).toBeCloseTo((lean.gPartner * lean.value.received) / (lean.value.received + W), 12);
    expect(lean.gMine).toBeLessThan(full.gMine);
    expect(full.gMine).toBeLessThan(0);
    expect(lean.gPartner).toBeGreaterThan(full.gPartner);
    expect(full.gPartner).toBeGreaterThan(0);

    // The hide threshold: my WR1 for Team 2's WR2 (2,500) reads −49% for me (hidden); with him −34.7% (shown, still a
    // market check).
    const hidden = exact(ctx, trade("2", ["wa1"], ["wb2"])).evaluation;
    const shown = exact(ctx, trade("2", ["wa1", "wc1"], ["wb2"])).evaluation;
    expect(hidden.gMine).toBeCloseTo((2500 - 4900) / 4900, 12);
    expect(hidden.flags).toMatchObject({ hiddenByMarket: true, marketCheck: true });
    expect(shown.gMine).toBeCloseTo(-2400 / (4900 + W), 12);
    expect(shown.flags).toMatchObject({ hiddenByMarket: false, marketCheck: true });

    // The veto, in a league that votes on trades: my RB rc1 (2,500) for Team 2's WR1 (4,225) reads −40.8% for Team 2
    // (vetoed); with him −27.6%, so the veto no longer halves P_complete.
    const vote = context(edit, { tradeReview: "league_vote" });
    const Wv = tradeInternals(vote).credit;
    expect(Wv).toBe(W);
    const vetoed = exact(vote, trade("2", ["rc1"], ["wa2"])).evaluation;
    const lifted = exact(vote, trade("2", ["rc1", "wc1"], ["wa2"])).evaluation;
    expect(vetoed.gPartner).toBeCloseTo((2500 - 4225) / 4225, 12);
    expect(lifted.gPartner).toBeCloseTo(-1725 / (4225 + Wv), 12);
    expect([vetoed.detail.vetoRisk, lifted.detail.vetoRisk]).toEqual([true, false]);
    expect(vetoed.pComplete).toBeCloseTo(vetoed.pAccept * config.acceptance.veto.factor, 12);
    expect(lifted.pComplete).toBe(lifted.pAccept);
  });

  it("two players worth less than W swapped: g = 0 for both sides, so B = B_win = 0 (the market check and the hide threshold read the same g)", () => {
    // The plain hand league (W = 900, the free-agent QB's value): my bench WR for Team 2's, the same player but his id.
    const plain = context((spec) => swapPlayer(spec, "2", "wc2", flat("wc2", "WR", 3.1)));
    const Ip = tradeInternals(plain);
    expect(Ip.values.wc1).toBe(Ip.values.wc2);
    expect(Ip.values.wc1 as number).toBeLessThan(Ip.credit);
    for (const level of PROTECT_VALUE_LEVELS) {
      const ev = analyzeTrade(plain, trade("2", ["wc1"], ["wc2"]), settingsAt(level)).evaluation as TradeEvaluation;
      expect([ev.bWin, ev.gMine, ev.gPartner, ev.b], level).toEqual([0, 0, 0, 0]);
      expect(ev.value, level).toEqual({ given: Ip.credit, received: Ip.credit });
      expect(ev.flags, level).toMatchObject({ hiddenByBenefit: true, marketCheck: false, hiddenByMarket: false });
    }
    // Two cheap players of different values read the same: each counts W.
    const uneven = context((spec) => swapPlayer(spec, "2", "wc2", flat("wc2", "WR", 2)));
    const u = analyzeTrade(uneven, trade("2", ["wc1"], ["wc2"])).evaluation as TradeEvaluation;
    expect(tradeInternals(uneven).values.wc2 as number).toBeLessThan(tradeInternals(uneven).values.wc1 as number);
    expect([u.gMine, u.gPartner]).toEqual([0, 0]);
  });

  it("a dynasty league: no market term; B = (1 − λ) B_win + λ B_future", () => {
    const { snapshot, inputs } = handLeague(edit, { leagueType: "dynasty" });
    if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
    const dctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
    const ev = analyzeTrade(dctx, trade("2", ["wa1", "wc1"], ["ra2"])).evaluation as TradeEvaluation;
    expect(ev.b as number).toBeCloseTo((1 - (ev.lambda as number)) * (ev.bWin as number) + (ev.lambda as number) * (ev.bFuture as number), 12);
  });

  it("dynasty and keeper leagues: ΔDyn counts each player at max(v, W) too, so the same dump gives B = 0", () => {
    // The final review of Phase 4: ΔDyn's waiver credit for the spot a player worth less than W opens would otherwise be a
    // long-term gain for a trade that changes nothing (+1,785 = 2,025 − 240).
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const { snapshot, inputs } = handLeague(edit, { leagueType });
      if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
      const dctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
      const Id = tradeInternals(dctx);
      expect(Id.future, leagueType).not.toBeNull();
      const ev = analyzeTrade(dctx, dump).evaluation as TradeEvaluation;
      for (const k of ["dPO", "dCH", "dEW", "bWin", "dDyn", "bFuture", "b"] as const) expect(ev[k], `${leagueType} ${k}`).toBe(0);
      expect(ev.flags.hiddenByBenefit, leagueType).toBe(true);
      // MyDynTotal stays raw: the sum of my long-term values, no floor.
      const mine = [...(Id.me?.team.roster ?? []), ...(Id.me?.team.ir ?? []), ...(Id.me?.team.taxi ?? [])];
      expect(Id.future?.myTotal, leagueType).toBe(mine.reduce((s, id) => s + (Id.future?.values[id] ?? 0), 0));
    }
  });
});
