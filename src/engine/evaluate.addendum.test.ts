/**
 * The planner's addendum to Checkpoint 3 in trade evaluation (lead decisions N1, N3, N5 and N10): the partner's g feature
 * reads its perceived g (the star premium on what it gives) in screening and in exact evaluation, while the card's g, my
 * side and the veto rule read the raw g; TradeDetail.premium; the context's premiums (P(playoffs) from its own baseline,
 * every team at V*); κ by the "Protect my trade value" level in redraft B, none in dynasty and keeper leagues; B's market
 * term with my given players at max(v, W) while every number the card shows stays raw (N10); and the before-addendum
 * variant, which reproduces the model before all of it.
 */
import { describe, expect, it } from "vitest";
import { gFeature } from "./acceptance";
import { marketTermPackage, protectValueWeight, tradePackage } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, evaluateExact, harderToGetFor, kappaFor, perceivedG, premiumOf, screenTrade, tradeInternals, type ExactTrade, type TeamState, type TradeContextOptions } from "./evaluate";
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
    // The pre-addendum model (the raw g) reads the same trade as much better for Team 2.
    const before = tradeInternals(context(() => undefined, {}, { beforeAddendum: true }));
    const sBefore = screenTrade(before, before.byId.get("2") as TeamState, give, get);
    expect(sBefore?.pQuick as number).toBeGreaterThan((s?.pQuick as number) + 0.1);
  });

  it("screening's quick estimate reads the perceived g too (and equals the exact one here); its g window keeps the raw g", () => {
    const s = screenTrade(I, I.byId.get("2") as TeamState, ["wa1"], ["ra2"]);
    expect(s?.gPartner).toBe(ev.gPartner);
    expect(s?.pQuick).toBeCloseTo(ev.pAccept, 12);
    // The pre-addendum model's quick estimate is higher: the partner sees an even trade there.
    const before = tradeInternals(context(() => undefined, {}, { beforeAddendum: true }));
    const sBefore = screenTrade(before, before.byId.get("2") as TeamState, ["wa1"], ["ra2"]);
    expect(sBefore?.gPartner).toBe(s?.gPartner);
    expect(sBefore?.myDelta).toBe(s?.myDelta);
    expect(sBefore?.pQuick as number).toBeGreaterThan(s?.pQuick as number);
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
      expect(kappaFor(tradeInternals(ctx), level)).toBe(config.benefit.protectValue[level]);
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

describe("B's market term with my given players at max(v, W) (N10)", () => {
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
  const dump = trade("2", ["wc1"], []);
  const termG = (give: string[], get: string[]) => marketTermPackage({ players: get }, { players: give }, I.values, I.credit).g;

  it("a player V* drops anyway, worth less than W, given for nothing: B = 0 at Low, Medium and High", () => {
    expect(me.vstar.moves.map((m) => [m.add, m.drop])).toEqual([["zfa", "wc1"]]);
    expect(I.credit).toBe(I.values.zfa);
    expect(I.values.wc1 as number).toBeLessThan(I.credit);
    // After the trade my roster is V*(me)'s: the spot he opens takes the free agent V*(me) picks up anyway.
    const x = exact(ctx, dump);
    expect([...x.mine.roster]).toEqual([...me.vstar.roster]);
    expect(x.gMarket).toBe(0);
    for (const level of PROTECT_VALUE_LEVELS) {
      const ev = analyzeTrade(ctx, dump, settingsAt(level)).evaluation as TradeEvaluation;
      for (const k of ["dPO", "dCH", "dEW", "bWin", "b"] as const) expect(ev[k], `${level} ${k}`).toBe(0);
      expect(ev.tradeScore, level).toBeNull();
      expect(ev.flags.hiddenByBenefit, level).toBe(true);
      // The card stays raw: I give 240 and get the credit for the open spot, far more than +50% at market.
      expect(ev.value, level).toEqual({ given: I.values.wc1, received: I.credit });
      expect(ev.gMine, level).toBeCloseTo(I.credit / (I.values.wc1 as number) - 1, 12);
      expect(ev.flags.marketCheck, level).toBe(false);
    }
    // Before the addendum (the raw g, κ 1) the open spot's credit counted twice: B = +0.5 for a trade that changes nothing.
    const before = analyzeTrade(context(edit, {}, { beforeAddendum: true }), dump).evaluation as TradeEvaluation;
    expect(before.bWin).toBe(0);
    expect(before.b).toBe(config.benefit.marketSanityWeight * clampG(before.gMine));
    expect(before.b as number).toBeGreaterThan(0);
  });

  it("a mixed package: the market term counts the cheap player at W and the other at his value; every raw reading stays", () => {
    // My WR1 (4,900) and my bench WR (240) for Team 2's RB1 (4,900; its #2 and a top-12 player).
    const give = ["wa1", "wc1"];
    const get = ["ra2"];
    const x = exact(ctx, trade("2", give, get));
    const ev = x.evaluation;
    // The floored g: I give 4,900 + W and get 4,900 + W (the spot I open): even.
    expect(termG(give, get)).toBe(0);
    expect(x.gMarket).toBe(termG(give, get));
    // Raw: I give 5,140 and get 4,900 + W, a gain at market (it was B's market term before N10).
    const raw = tradePackage({ players: get }, { players: give }, I.values, I.credit);
    expect(ev.gMine).toBe(raw.g);
    expect(ev.gMine).toBeGreaterThan(0.25);
    expect(ev.value).toEqual({ given: raw.give, received: raw.recv });
    // The partner's g's stay theirs: the raw one on the card, the perceived one (its premium on Team 2's RB1) in acceptance.
    expect(ev.gPartner).toBe(tradePackage({ players: give }, { players: get }, I.values, I.credit).g);
    expect(ev.features.g).toBe(gFeature(perceivedG(I, "2", give, get) as number));
    for (const level of PROTECT_VALUE_LEVELS) {
      const a = analyzeTrade(ctx, trade("2", give, get), settingsAt(level)).evaluation as TradeEvaluation;
      expect(a.b as number, level).toBeCloseTo((a.bWin as number) + protectValueWeight(level) * clampG(termG(give, get)), 12);
      expect(a.b as number, level).toBeLessThan((a.bWin as number) + protectValueWeight(level) * clampG(a.gMine) - 0.5);
      expect(a.gMine, level).toBe(ev.gMine);
      expect(a.flags.marketCheck, level).toBe(false);
    }
  });

  it("two players worth less than W swapped: the one I give counts W, the one I get his value (the market check and the hide threshold read the raw g)", () => {
    // The plain hand league (W = 900, the free-agent QB's value): my bench WR for Team 2's, the same player but his id.
    const plain = context((spec) => swapPlayer(spec, "2", "wc2", flat("wc2", "WR", 3.1)));
    const Ip = tradeInternals(plain);
    expect(Ip.values.wc1).toBe(Ip.values.wc2);
    expect(Ip.values.wc1 as number).toBeLessThan(Ip.credit);
    const ev = analyzeTrade(plain, trade("2", ["wc1"], ["wc2"])).evaluation as TradeEvaluation;
    expect(ev.bWin).toBe(0);
    expect(ev.gMine).toBe(0);
    // ⚠️ The decision floors the given side only: (240 − 900) / 900 = −73%, clamped to −50%: B = 4 × −0.5 at Medium.
    const g = marketTermPackage({ players: ["wc2"] }, { players: ["wc1"] }, Ip.values, Ip.credit).g;
    expect(g).toBeCloseTo((Ip.values.wc2 as number) / Ip.credit - 1, 12);
    expect(ev.b).toBe(protectValueWeight("medium") * config.benefit.marketSanityClamp[0]);
    expect(ev.flags).toMatchObject({ hiddenByBenefit: true, marketCheck: false, hiddenByMarket: false });
  });

  it("a dynasty league: no market term; B = (1 − λ) B_win + λ B_future", () => {
    const { snapshot, inputs } = handLeague(edit, { leagueType: "dynasty" });
    if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
    const dctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
    const ev = analyzeTrade(dctx, trade("2", ["wa1", "wc1"], ["ra2"])).evaluation as TradeEvaluation;
    expect(ev.b as number).toBeCloseTo((1 - (ev.lambda as number)) * (ev.bWin as number) + (ev.lambda as number) * (ev.bFuture as number), 12);
  });

  it("dynasty and keeper leagues: ΔDyn counts my given players at max(v, W) too, so the same dump gives B = 0 (raw before the addendum)", () => {
    // The final review of Phase 4: in dynasty and keeper leagues the double count lived on in B_future, through ΔDyn's
    // waiver credit for the spot a player worth less than W opens (ΔDyn +1,785 = 2,025 − 240 for a trade that changes nothing).
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const build = (opts: Partial<TradeContextOptions>) => {
        const { snapshot, inputs } = handLeague(edit, { leagueType });
        if (inputs.market) inputs.market.format = { ...inputs.market.format, isDynasty: true };
        return buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, ...opts });
      };
      const Id = tradeInternals(build({}));
      expect(Id.future, leagueType).not.toBeNull();
      const ev = analyzeTrade(build({}), dump).evaluation as TradeEvaluation;
      for (const k of ["dPO", "dCH", "dEW", "bWin", "dDyn", "bFuture", "b"] as const) expect(ev[k], `${leagueType} ${k}`).toBe(0);
      expect(ev.flags.hiddenByBenefit, leagueType).toBe(true);
      // Before the addendum ΔDyn credited the open spot: the long-term waiver credit minus his long-term value.
      const before = analyzeTrade(build({ beforeAddendum: true }), dump).evaluation as TradeEvaluation;
      expect(before.bWin, leagueType).toBe(0);
      expect(before.dDyn as number, leagueType).toBeGreaterThan(0);
      expect(before.b as number, leagueType).toBeGreaterThan(0);
    }
  });
});

describe("the before-addendum variant (N5)", () => {
  const proposal = trade("2", ["wa1"], ["ra2"]);
  const after = context(() => undefined, {}, { scenarios: 8 });
  const before = context(() => undefined, {}, { scenarios: 8, beforeAddendum: true });

  it("no star premium: the g feature is the raw g, no premium facts; κ is the old weight (1.0) whatever the level", () => {
    const I = tradeInternals(before);
    expect(I.beforeAddendum).toBe(true);
    expect(I.premiums.get("2")?.ra2?.harderToGet).toBe(true); // computed, never read
    expect(premiumOf(I, "2")("ra2")).toBe(0);
    expect(harderToGetFor(I, "2", "ra2")).toBe(false);
    expect(perceivedG(I, "2", ["wa1"], ["ra2"])).toBeUndefined();
    for (const level of PROTECT_VALUE_LEVELS) expect(kappaFor(I, level)).toBe(config.benefit.marketSanityWeight);
    const ev = analyzeTrade(before, trade("3", ["wb1", "rc1"], ["wa3"]), settingsAt("high")).evaluation as TradeEvaluation;
    expect(ev.b as number).toBeCloseTo((ev.bWin as number) + config.benefit.marketSanityWeight * clampG(ev.gMine), 12);
    const x = analyzeTrade(before, proposal).evaluation as TradeEvaluation;
    expect(x.features.g).toBe(gFeature(x.gPartner));
    expect(x.detail.premium).toBeUndefined();
  });

  it("everything else is the same model: lineups, odds, B_win, the raw g's and the values", () => {
    const a = analyzeTrade(after, proposal).evaluation as TradeEvaluation;
    const b = analyzeTrade(before, proposal).evaluation as TradeEvaluation;
    for (const k of ["dPO", "dCH", "dEW", "bWin", "dPPW", "dPPWPlayoffs", "gMine", "gPartner", "partnerDeltaLineup"] as const) expect(b[k], k).toBe(a[k]);
    expect(b.value).toEqual(a.value);
    expect(b.required).toEqual(a.required);
    expect(b.features.n).toBe(a.features.n);
    expect(b.features.h).toBe(a.features.h);
    // The partner sees the trade as even before the addendum, as a loss after it.
    expect(b.features.g).toBe(0);
    expect(a.features.g).toBeLessThan(0);
    expect(b.pAccept).toBeGreaterThan(a.pAccept);
  });

  it("a search: no premium facts and the raw g before; one fact per player the partner gives and the perceived g after", () => {
    const opts = { partnerId: "2", settings: { ...defaultTradeSettings(), maxPerSide: 1 } };
    const rb = runTradeSearch(context(() => undefined, {}, { beforeAddendum: true }), opts);
    const ra = runTradeSearch(context(), opts);
    expect(rb.trades.length).toBeGreaterThan(0);
    expect(ra.trades.length).toBeGreaterThan(0);
    for (const t of rb.trades) {
      expect(t.detail.premium).toBeUndefined();
      expect(t.features.g).toBe(gFeature(t.gPartner));
    }
    const I = tradeInternals(context());
    for (const t of ra.trades) {
      const get = t.proposal.get.flatMap((x) => (x.kind === "player" ? [x.id] : []));
      const give = t.proposal.give.flatMap((x) => (x.kind === "player" ? [x.id] : []));
      expect(t.detail.premium?.map((f) => f.playerId)).toEqual(get);
      expect(t.features.g).toBe(gFeature(perceivedG(I, "2", give, get) as number));
    }
  });
});
