import { describe, expect, it } from "vitest";
import { tradePackage } from "./benefit";
import { config } from "./config";
import { NO_TEAM_NOTE, assetValue, buildTradeContext, evaluateExact, simCounts, simulateTrade, tradeInternals, type ExactTrade, type TeamState } from "./evaluate";
import { assetId, rankTrades } from "./rank";
import { atMostWaiverCredit, buildPools, finalistsOf, partnerCandidates, rankCaps, runTradeSearch, searchStateOf, shortlistOf, tradeSearch, type SearchState, type TradeSearchOptions } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { handLeague, smallLeague, withWaiverStash } from "./trade.testing";
import { tradeEvaluation } from "./tradeTestFixtures";
import type { TradeEvaluation, TradeEvaluationCore, TradeSearchProgress, TradeSearchResult } from "./tradeModel";

// With a free agent nobody can use worth the best free agent's value (withWaiverStash): the W these tests were measured on
// (Checkpoint 4c's, the best free agent of all), which A3 (the best one left unclaimed) lowers here from 3,276 to 750.
const league = withWaiverStash(smallLeague(11));
const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
const I = tradeInternals(ctx);
const me = I.me as TeamState;

const settingsWith = (x: Partial<TradeSettings>): TradeSettings => ({ ...defaultTradeSettings(), ...x });
const ids = (t: TradeEvaluation, side: "give" | "get") => t.proposal[side].flatMap((a) => (a.kind === "player" ? [a.id] : []));
const pos = (id: string) => league.snapshot.players[id]?.pos;

/** The whole search once (shared): its result and progress, timed by a counting clock. */
let full: { result: TradeSearchResult; progress: TradeSearchProgress[] } | null = null;
function fullSearch() {
  if (!full) {
    let tick = 0;
    const progress: TradeSearchProgress[] = [];
    const result = runTradeSearch(ctx, { clock: () => tick++ }, (p) => progress.push(p));
    full = { result, progress };
  }
  return full;
}

const search = (opts: TradeSearchOptions) => runTradeSearch(ctx, opts);

describe("the trade search (§12; M6–M8)", { timeout: 60_000 }, () => {
  it("returns at most resultsShown finished trades: final stage, finalSims seasons, B > 0, not hidden, Overall order, with words", () => {
    const { result } = fullSearch();
    expect(result.myTeamId).toBe(me.id);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.length).toBeLessThanOrEqual(config.search.resultsShown);
    const eg = (t: TradeEvaluation) => (t.b as number) * t.pComplete;
    result.trades.forEach((t, i) => {
      expect(t.stage).toBe("final");
      expect(t.sims).toBe(simCounts().final);
      expect(t.illegal).toBeNull();
      expect(t.b).toBeGreaterThan(0);
      expect(t.flags.hiddenByMarket).toBe(false);
      expect(t.reasons.length).toBeGreaterThan(0);
      expect(t.pitch.length).toBeGreaterThan(0);
      if (i > 0) expect(eg(result.trades[i - 1] as TradeEvaluation)).toBeGreaterThanOrEqual(eg(t) - 1e-12);
    });
    expect(result.baseline.pPlayoffs).toBe(I.sim?.base.final.pPlayoffs);
    expect(result.notes).toContain("Kickers and D/STs are left out; turn them on in Settings.");
  });

  it("every trade: active-roster players, at most maxPerSide a side, no K or D/ST by default, g_mkt(P) inside the screening window", () => {
    const { result } = fullSearch();
    const [lo, hi] = config.search.screeningGWindow;
    for (const t of result.trades) {
      const partner = I.byId.get(t.proposal.partnerId) as TeamState;
      expect(ids(t, "give").every((id) => me.roster.includes(id))).toBe(true);
      expect(ids(t, "get").every((id) => partner.roster.includes(id))).toBe(true);
      expect(ids(t, "give").length).toBeLessThanOrEqual(2);
      expect(ids(t, "get").length).toBeLessThanOrEqual(2);
      expect([...ids(t, "give"), ...ids(t, "get")].some((id) => pos(id) === "K" || pos(id) === "DEF")).toBe(false);
      expect(t.gPartner).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(t.gPartner).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("counts and timings per stage", () => {
    const { result } = fullSearch();
    const c = result.counts;
    expect(c.screened).toBeGreaterThanOrEqual(c.exact);
    expect(c.exact).toBeGreaterThan(0);
    // The shortlist (at most exactEvaluationMax) and its lean companions on top, at most one per shortlisted trade (Phase 4c).
    const companions = (searchStateOf(result) as SearchState).companions.length;
    expect(companions).toBeGreaterThan(0);
    expect(c.exact).toBeLessThanOrEqual(config.search.exactEvaluationMax + companions);
    expect(companions).toBeLessThanOrEqual(config.search.exactEvaluationMax);
    expect(c.simScreen).toBe(c.exact);
    expect(c.simFinal).toBeLessThanOrEqual(config.search.finalists);
    expect(c.simFinal).toBeGreaterThanOrEqual(result.trades.length);
    expect(Object.keys(result.timings)).toEqual(["setup", "screening", "exact", "simScreen", "simFinal", "rank", "steps", "total"]);
    // Without a clock, no timings.
    expect(search({ partnerId: "2", settings: settingsWith({ maxPerSide: 1 }) }).timings).toEqual({});
  });

  it("progress: the stages in order, done never above total, ending with the ranking (one unit per shown trade's steps)", () => {
    const { progress, result } = fullSearch();
    const order = ["setup", "screening", "exact", "simScreen", "simFinal", "rank"];
    let at = 0;
    for (const p of progress) {
      const k = order.indexOf(p.stage);
      expect(k).toBeGreaterThanOrEqual(at);
      at = k;
      expect(p.done).toBeLessThanOrEqual(p.total);
    }
    expect(new Set(progress.map((p) => p.stage)).size).toBe(order.length);
    const n = Math.max(1, result.trades.length);
    expect(progress.at(-1)).toEqual({ stage: "rank", done: n, total: n });
  });

  it("is deterministic: the same context and options (or a fresh context) give the same result", () => {
    const opts: TradeSearchOptions = { partnerId: "3", settings: settingsWith({ maxPerSide: 2 }) };
    const a = search(opts);
    expect(search(opts)).toEqual(a);
    const fresh = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    expect(runTradeSearch(fresh, opts)).toEqual(a);
  });

  it("a context that stops the search (no team): no trades, the context's notes, nothing counted", () => {
    const none = buildTradeContext({ ...league.snapshot, myTeamId: null }, league.inputs, { now: TEST_NOW, scenarios: 0 });
    const progress: TradeSearchProgress[] = [];
    const r = runTradeSearch(none, {}, (p) => progress.push(p));
    expect(r.trades).toEqual([]);
    expect(r.notes).toEqual([NO_TEAM_NOTE]);
    expect(r.counts).toEqual({ screened: 0, exact: 0, simScreen: 0, simFinal: 0 });
    expect(r.baseline).toEqual({ pPlayoffs: null, pTitle: null, expWins: null });
    expect(progress).toEqual([{ stage: "setup", done: 0, total: 1 }]);
  });

  it("the generator can be stopped between steps", () => {
    const it = tradeSearch(ctx, { partnerId: "2" });
    expect(it.next().value).toEqual({ stage: "setup", done: 0, total: 1 });
    expect(it.return({} as TradeSearchResult).done).toBe(true);
  });
});

describe("pools and settings (M6)", { timeout: 60_000 }, () => {
  it("a partner filter searches that team only; maxPerSide 1 gives 1-for-1s only", () => {
    const r = search({ partnerId: "2", settings: settingsWith({ maxPerSide: 1 }) });
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) {
      expect(t.proposal.partnerId).toBe("2");
      expect(ids(t, "give")).toHaveLength(1);
      expect(ids(t, "get")).toHaveLength(1);
    }
  });

  it("untouchables are never offered", () => {
    const base = search({ partnerId: "4", settings: settingsWith({ maxPerSide: 1 }) });
    const offered = [...new Set(base.trades.flatMap((t) => ids(t, "give")))];
    expect(offered.length).toBeGreaterThan(0);
    const r = search({ partnerId: "4", settings: settingsWith({ maxPerSide: 1, untouchables: offered }) });
    for (const t of r.trades) for (const id of ids(t, "give")) expect(offered).not.toContain(id);
  });

  it("my must-include player is in every trade, even when also untouchable; theirs picks the partner", () => {
    const base = search({ partnerId: "2", settings: settingsWith({ maxPerSide: 1 }) });
    const mine = ids(base.trades[0] as TradeEvaluation, "give")[0] as string;
    for (const s of [settingsWith({ maxPerSide: 1, mustInclude: [mine] }), settingsWith({ maxPerSide: 1, mustInclude: [mine], untouchables: [mine] })]) {
      const r = search({ partnerId: "2", settings: s });
      expect(r.trades.length).toBeGreaterThan(0);
      for (const t of r.trades) expect(ids(t, "give")).toContain(mine);
    }
    const theirs = (I.byId.get("5") as TeamState).roster.find((id) => pos(id) === "WR") as string;
    const r = search({ settings: settingsWith({ maxPerSide: 1, mustInclude: [theirs] }) });
    expect(r.counts.exact).toBeGreaterThan(0);
    for (const t of r.trades) {
      expect(t.proposal.partnerId).toBe("5");
      expect(ids(t, "get")).toEqual([theirs]);
    }
  });

  it("must-include problems: players on two other teams (no trades), on no roster (ignored), another team than the filter", () => {
    const a = (I.byId.get("2") as TeamState).roster[0] as string;
    const b = (I.byId.get("3") as TeamState).roster[0] as string;
    const two = search({ settings: settingsWith({ mustInclude: [a, b] }) });
    expect(two.trades).toEqual([]);
    expect(two.notes).toContain("Your must-include players are on different teams, and a trade is with one team, so no trade can include them all.");
    const ghost = search({ partnerId: "2", settings: settingsWith({ maxPerSide: 1, mustInclude: ["nobody"] }) });
    expect(ghost.notes).toContain("1 must-include player isn't on any team's active roster or IR, so it's ignored.");
    expect(ghost.trades.length).toBeGreaterThan(0);
    const other = search({ partnerId: "3", settings: settingsWith({ mustInclude: [a] }) });
    expect(other.trades).toEqual([]);
    expect(other.notes).toContain("Your must-include players are on another team than the one you picked, so no trade with this team can include them.");
  });

  it("the planner's get pool (addendum to Checkpoint 3, §2): the top 10 players not tagged \"Harder to get\" plus the top 3 tagged", () => {
    expect(config.search.getPool).toBe(10);
    expect(config.search.getPoolTagged).toBe(3);
  });

  it("target and avoid positions shape what I get", () => {
    const wr = search({ partnerId: "2", settings: settingsWith({ maxPerSide: 1, targetPositions: ["WR"] }) });
    expect(wr.counts.exact).toBeGreaterThan(0);
    for (const t of wr.trades) for (const id of ids(t, "get")) expect(pos(id)).toBe("WR");
    const noRb = search({ partnerId: "2", settings: settingsWith({ maxPerSide: 1, avoidPositions: ["RB"] }) });
    expect(noRb.counts.exact).toBeGreaterThan(0);
    for (const t of noRb.trades) for (const id of ids(t, "get")) expect(pos(id)).not.toBe("RB");
  });

  it("notes: K/D/ST left out unless included; picks deferred in dynasty and keeper leagues only", () => {
    const opts = { partnerId: "2", settings: settingsWith({ maxPerSide: 1 }) };
    expect(search(opts).notes).toContain("Kickers and D/STs are left out; turn them on in Settings.");
    expect(search({ ...opts, settings: settingsWith({ maxPerSide: 1, includeKDefIdp: true }) }).notes).not.toContain("Kickers and D/STs are left out; turn them on in Settings.");
    expect(search({ ...opts, settings: settingsWith({ maxPerSide: 1, includePicks: true }) }).notes).not.toContain("Draft picks aren't part of trade ideas yet.");
    const dynasty = smallLeague(11, { leagueType: "dynasty" });
    const dctx = buildTradeContext(dynasty.snapshot, dynasty.inputs, { now: TEST_NOW, scenarios: 0 });
    const notes = runTradeSearch(dctx, { ...opts, settings: settingsWith({ maxPerSide: 1, includePicks: true }) }).notes;
    expect(notes).toContain("Draft picks aren't part of trade ideas yet.");
    // This test league's values are redraft values: B counts this season only, and says so once.
    expect(notes).toContain("Long-term trade values aren't available, so “Helps you” counts this season only.");
  });
});

describe("\"Protect my trade value\" per call (planner addendum to Checkpoint 3, §3; review of the addendum, engine finding 4)", { timeout: 60_000 }, () => {
  it("the search reads the call's level, not the context's: the same result as a context built with that level", () => {
    // The shared context was built with the default settings (medium); a cached context in the worker can hold older ones.
    expect(I.settings.protectValue).toBe("medium");
    const high = settingsWith({ protectValue: "high" });
    const ctxHigh = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8, settings: high });
    const r = search({ settings: high });
    expect(r).toEqual(runTradeSearch(ctxHigh, { settings: high }));
    expect(r.trades.length).toBeGreaterThan(0);
    const [lo, hi] = config.benefit.marketSanityClamp;
    // B's market term reads g_mkt(me), the card's own, every player at max(v, W) (planner reply to Checkpoint 4, change 4).
    for (const t of r.trades) {
      expect(t.gMine).toBe(tradePackage({ players: ids(t, "get") }, { players: ids(t, "give") }, I.values, I.credit).g);
      expect(t.b as number).toBeCloseTo((t.bWin as number) + config.benefit.protectValue.high * Math.min(hi, Math.max(lo, t.gMine)), 12);
    }
    // The level moves trades in and out: the high list isn't the medium one. (Since Phase 4c's matched pairs, the neutral
    // throw-in rule's second step, as many evaluated trades stop helping at high as at medium on this league, 7 each, where
    // Phase 4c's first rule alone hid 9 and 18; the lists still differ: 11 cards at medium, 9 at high.)
    expect(r.trades.map((t) => t.key)).not.toEqual(fullSearch().result.trades.map((t) => t.key));
  });
});

describe("B's market term in both of the search's simulations: every player at max(v, W) (planner reply to Checkpoint 4, change 4; replaces N10)", { timeout: 60_000 }, () => {
  // The hand league (W = 900, the free-agent QB's value) with my bench RB (worth 420, below W) in every trade, a
  // must-include player of mine; Team 4 only, so at most keptPerPartner exact trades and every one that helps me at
  // screening numbers is a finalist. EV lineups.
  const hand = handLeague();
  const hctx = buildTradeContext(hand.snapshot, hand.inputs, { now: TEST_NOW, scenarios: 0 });
  const HI = tradeInternals(hctx);
  const settings = settingsWith({ mustInclude: ["rc1"] });
  const kappa = config.benefit.protectValue[settings.protectValue];
  const [lo, hi] = config.benefit.marketSanityClamp;
  const clampG = (g: number) => Math.min(hi, Math.max(lo, g));
  let result: TradeSearchResult | null = null;
  const run = () => (result ??= runTradeSearch(hctx, { partnerId: "4", settings }));
  /** g_mkt(me) without the floor, by hand (each player at his own value, W per open spot): the reading before change 4. */
  const unflooredG = (get: readonly string[], give: readonly string[]): number => {
    const v = (id: string) => HI.values[id] ?? 0;
    const r = get.reduce((s, id) => s + v(id), 0) + Math.max(0, give.length - get.length) * HI.credit;
    const g = give.reduce((s, id) => s + v(id), 0) + Math.max(0, get.length - give.length) * HI.credit;
    return (r - g) / g;
  };

  it("the final simulation: every shown trade's B is B_win + κ × clamp(g_mkt(me)), the card's g, every player floored at W", () => {
    expect(HI.values.rc1 as number).toBeLessThan(HI.credit);
    const r = run();
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) {
      const give = ids(t, "give");
      const get = ids(t, "get");
      expect(give).toContain("rc1");
      const floored = tradePackage({ players: get }, { players: give }, HI.values, HI.credit).g;
      expect(t.gMine, t.key).toBe(floored);
      // The floor moves g on every trade here, so the unfloored g would give another B.
      expect(Math.abs(unflooredG(get, give) - floored), t.key).toBeGreaterThan(0.01);
      expect(t.b as number, t.key).toBeCloseTo((t.bWin as number) + kappa * clampG(floored), 12);
    }
  });

  it("the screening simulation reads the same floored g: every exact trade's screening B, and the finalists they pick", () => {
    const r = run();
    // The exact trades, rebuilt as the search builds them.
    const pools = buildPools(HI, settings, "4");
    const perPartner = pools.partners.map((p) => {
      const h = pools.get.get(p.id) as { pool: string[]; forced: string[] };
      const it = partnerCandidates(HI, p, { give: pools.give, forcedGive: pools.forcedGive, get: h.pool, forcedGet: h.forced }, settings.maxPerSide, { screened: 0 });
      let next = it.next();
      while (!next.done) next = it.next();
      return next.value;
    });
    const exact = shortlistOf(perPartner, atMostWaiverCredit(HI)).flatMap((s) => {
      const x = evaluateExact(HI, { partnerId: s.partnerId, give: s.give.map((id) => ({ kind: "player", id })), get: s.get.map((id) => ({ kind: "player", id })) }, settings.maxPerSide);
      return "illegal" in x ? [] : [x];
    });
    expect(exact.length).toBe(r.counts.exact);
    const screen = (x: ExactTrade) => simulateTrade(HI, x, "screen", settings.lambda, settings.protectValue);
    // The same exact trade with g_mkt(me) unfloored (B's market term and the guards read evaluation.gMine).
    const rawOf = (x: ExactTrade): ExactTrade => {
      const ev = x.evaluation;
      return { ...x, evaluation: { ...ev, gMine: unflooredG(ev.proposal.get.flatMap((a) => (a.kind === "player" ? [a.id] : [])), ev.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []))) } };
    };
    const value = assetValue(HI);
    const cores = exact.map(screen);
    // Every exact trade's screening B reads the floored g (the card's g_mkt(me)); the unfloored reading would give
    // another B on each of them, since each gives my bench RB (worth less than W).
    const side = (c: TradeEvaluationCore, s: "give" | "get") => c.proposal[s].flatMap((a) => (a.kind === "player" ? [a.id] : []));
    cores.forEach((c, i) => {
      expect(c.gMine, c.key).toBe(tradePackage({ players: side(c, "get") }, { players: side(c, "give") }, HI.values, HI.credit).g);
      expect(c.b as number, c.key).toBeCloseTo((c.bWin as number) + kappa * clampG(c.gMine), 12);
      const other = screen(rawOf(exact[i] as ExactTrade));
      expect(other.bWin, c.key).toBe(c.bWin);
      expect(Math.abs((other.b as number) - (c.b as number)), c.key).toBeGreaterThan(0);
    });
    // The search's finalists are the ones those numbers pick.
    const floored = finalistsOf(cores, value, true).keys;
    expect(r.counts.simFinal).toBe(floored.size);
    for (const t of r.trades) expect(floored.has(t.key), t.key).toBe(true);
  });
});

describe("a search of one partner: no per-partner cap (⚠️ ours; end-of-Phase-4 review, finding 5)", { timeout: 60_000 }, () => {
  const keys = (xs: readonly TradeEvaluation[]) => xs.map((t) => t.key);
  const value = assetValue(I);

  it("rankCaps: §13's caps, one looser for the finalists, and no per-partner cap with one partner", () => {
    const strict = { perPartnerInTop20: config.ranking.perPartnerInTop20, partnerCapTop: config.ranking.partnerCapTop, perGivenPlayerInTop20: config.ranking.perGivenPlayerInTop20, perCore: config.ranking.perCore, fillerCutoffFraction: config.ranking.fillerCutoffFraction, resultsShown: config.search.resultsShown, marketHideBelow: config.benefit.marketHideBelow };
    expect(rankCaps({ relaxed: false, onePartner: false })).toEqual(strict);
    // The finalists' partner and given-player caps cover every finalist (final review of Phase 4b), not just the top 20.
    expect(rankCaps({ relaxed: true, onePartner: false })).toEqual({
      ...strict,
      perPartnerInTop20: strict.perPartnerInTop20 + 1,
      partnerCapTop: Math.max(config.ranking.partnerCapTop, config.search.finalists),
      perGivenPlayerInTop20: strict.perGivenPlayerInTop20 + 1,
      perCore: strict.perCore + 1,
      resultsShown: config.search.finalists,
    });
    expect(rankCaps({ relaxed: false, onePartner: true })).toEqual({ ...strict, perPartnerInTop20: Number.POSITIVE_INFINITY });
    expect(rankCaps({ relaxed: true, onePartner: true }).perPartnerInTop20).toBe(Number.POSITIVE_INFINITY);
  });

  it("the partner filter: more than perPartnerInTop20 ideas; the per-core and filler rules still apply, and the drops are counted", () => {
    const r = search({ partnerId: "2" });
    expect(r.trades.length).toBeGreaterThan(config.ranking.perPartnerInTop20);
    expect(r.trades.every((t) => t.proposal.partnerId === "2")).toBe(true);
    expect(r.dropped?.partnerCap).toBe(0);
    expect((r.dropped?.core ?? 0) + (r.dropped?.filler ?? 0)).toBeGreaterThan(0);
    // The shown list passes §13's rules without the per-partner cap (ranking it again keeps every trade) …
    expect(keys(rankTrades(r.trades, value, rankCaps({ relaxed: false, onePartner: true })).trades)).toEqual(keys(r.trades));
    // … and the all-teams caps would cut it to perPartnerInTop20.
    expect(keys(rankTrades(r.trades, value).trades)).toEqual(keys(r.trades.slice(0, config.ranking.perPartnerInTop20)));
  });

  it("must-include players of theirs fix the partner: the same", () => {
    const theirs = (I.byId.get("5") as TeamState).roster.find((id) => pos(id) === "WR") as string;
    const r = search({ settings: settingsWith({ mustInclude: [theirs] }) });
    expect(r.trades.length).toBeGreaterThan(config.ranking.perPartnerInTop20);
    expect(r.trades.every((t) => t.proposal.partnerId === "5" && ids(t, "get").includes(theirs))).toBe(true);
    expect(r.dropped?.partnerCap).toBe(0);
  });

  it("a search of all teams keeps §13's cap (at most perPartnerInTop20 a partner in the top 20) and counts what it drops", () => {
    const { result } = fullSearch();
    const top = new Map<string, number>();
    for (const t of result.trades.slice(0, config.ranking.partnerCapTop)) top.set(t.proposal.partnerId, (top.get(t.proposal.partnerId) ?? 0) + 1);
    expect(top.size).toBeGreaterThan(1);
    for (const [partnerId, n] of top) expect(n, partnerId).toBeLessThanOrEqual(config.ranking.perPartnerInTop20);
    expect(result.dropped?.partnerCap).toBeGreaterThan(0);
    // A search stopped early drops nothing.
    const none = runTradeSearch(buildTradeContext({ ...league.snapshot, myTeamId: null }, league.inputs, { now: TEST_NOW, scenarios: 0 }), {});
    expect(none.dropped).toEqual({ partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 });
  });
});

describe("beams (M7)", () => {
  const partner = I.byId.get("2") as TeamState;
  const skill = (t: TeamState) => t.roster.filter((id) => pos(id) !== "K" && pos(id) !== "DEF" && I.league.table.rows.has(id));
  const pool = { give: skill(me).slice(0, 6), forcedGive: [] as string[], get: skill(partner).slice(0, 6), forcedGet: [] as string[] };
  const candidates = (maxPerSide: number, p = pool) => {
    const tally = { screened: 0 };
    const it = partnerCandidates(I, partner, p, maxPerSide, tally);
    let r = it.next();
    while (!r.done) r = it.next();
    return { list: r.value, tally };
  };
  const shape = (x: { give: string[]; get: string[] }) => `${x.give.length}-${x.get.length}`;

  it("maxPerSide 1: the seeds alone, every 1-for-1 of the pools (each screened once)", () => {
    const { list, tally } = candidates(1);
    expect(new Set(list.map(shape))).toEqual(new Set(["1-1"]));
    expect(tally.screened).toBe(pool.give.length * pool.get.length);
    expect(new Set(list.map((x) => x.key)).size).toBe(list.length);
  });

  it("maxPerSide 2: extensions make 2-for-1s, 1-for-2s and 2-for-2s, never 3 a side", () => {
    const { list } = candidates(2);
    const shapes = new Set(list.map(shape));
    for (const s of ["1-1", "2-1", "1-2", "2-2"]) expect(shapes.has(s), s).toBe(true);
    expect(list.every((x) => x.give.length <= 2 && x.get.length <= 2)).toBe(true);
    expect(new Set(list.map((x) => x.key)).size).toBe(list.length);
  });

  it("maxPerSide 3: a second extension reaches 3 a side", () => {
    const { list } = candidates(3);
    expect(list.some((x) => x.give.length === 3 || x.get.length === 3)).toBe(true);
    expect(list.every((x) => x.give.length <= 3 && x.get.length <= 3)).toBe(true);
  });

  it("forced players are in every candidate (the core completed to a player a side)", () => {
    const forced = pool.give[0] as string;
    const { list } = candidates(2, { ...pool, forcedGive: [forced] });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.give.includes(forced) && x.get.length >= 1)).toBe(true);
    const both = candidates(2, { ...pool, forcedGive: [forced], forcedGet: [pool.get[0] as string] }).list;
    expect(both.every((x) => x.give.includes(forced) && x.get.includes(pool.get[0] as string))).toBe(true);
  });
});

describe("finalistsOf: the relaxed caps cover every finalist (final review of Phase 4b)", () => {
  it("config: 60 finalists since Phase 4c (planner reply to Checkpoint 4b, change 1; 40 before)", () => {
    expect(config.search.finalists).toBe(60);
  });

  it("a player of mine given past the cap doesn't fill the finalists' last places while other trades wait", () => {
    // finalists − 15 trades each giving their own player (the best), 30 giving "g1" (next), 10 more each giving their own
    // player (last); every trade its own partner and its own core. With the window at the top 20, the finalists after the
    // 20th were uncapped: more "g1" trades, none of the last 10. Covering every finalist, "g1" is held to the relaxed cap
    // (3 + 1) and the last 10 get in; the leftover place goes to the best "g1" trade left (the fill-up by expected gain).
    const t = (give: string, get: string, partnerId: string, b: number) => tradeEvaluation({ partnerId, give: [give], get: [get], b, pComplete: 0.5, stage: "exact", sims: 1000 });
    const best = config.search.finalists - 15;
    const cores = [
      ...Array.from({ length: best }, (_, i) => t(`d${i + 1}`, `x${i + 1}`, `p${i + 1}`, 5)),
      ...Array.from({ length: 30 }, (_, i) => t("g1", `y${i + 1}`, `q${i + 1}`, 4)),
      ...Array.from({ length: 10 }, (_, i) => t(`e${i + 1}`, `z${i + 1}`, `r${i + 1}`, 3)),
    ];
    const value = (a: Parameters<typeof assetId>[0]) => Number(assetId(a).replace(/\D/g, "")) || 0;
    const { keys } = finalistsOf(cores, value);
    expect(keys.size).toBe(config.search.finalists);
    const givers = (prefix: string) => cores.filter((c) => keys.has(c.key) && ids(c as TradeEvaluation, "give")[0]?.startsWith(prefix)).length;
    expect(givers("d")).toBe(best);
    expect(givers("e")).toBe(10);
    expect(givers("g")).toBe(config.ranking.perGivenPlayerInTop20 + 1 + 1);
  });

  it("⚠️ my must-include players (forcedGive) are outside the relaxed given-player cap, so the other caps keep the finalists varied (review of track SR, finding 1)", () => {
    // Every trade gives "must" (worth the most, so every give-side core is his): 40 with partner "a" (the best), then one
    // with each of 30 other partners. Counting him, only 4 trades are ranked and the fill by EG takes partner a's next 36;
    // outside the cap, partner a is held to the relaxed partner cap and all 30 others get in.
    const t = (partnerId: string, i: number, b: number) => tradeEvaluation({ partnerId, give: ["must", `x${partnerId}${i}`], get: [`y${partnerId}${i}`], b, pComplete: 0.5, stage: "exact", sims: 1000 });
    const cores = [...Array.from({ length: 40 }, (_, i) => t("a", i, 10 - i * 0.01)), ...Array.from({ length: 30 }, (_, j) => t(`p${j}`, 0, 5 - j * 0.01))];
    const value = (a: Parameters<typeof assetId>[0]) => (assetId(a) === "must" ? 9000 : 100);
    const fromA = (keys: Set<string>) => cores.filter((c) => keys.has(c.key) && c.proposal.partnerId === "a").length;
    const counted = finalistsOf(cores, value).keys;
    const exempt = finalistsOf(cores, value, false, ["must"]).keys;
    expect(counted.size).toBe(config.search.finalists);
    expect(exempt.size).toBe(config.search.finalists);
    expect(fromA(counted)).toBe(40);
    expect(fromA(exempt)).toBe(config.search.finalists - 30);
  });
});
