/**
 * The search's filters, step by step (review of track E, item 4e): the screening shortlist (the g window, the dominance
 * pruning of lead decision N11, keptPerPartner, the exactEvaluationMax cap), the finalists (relaxed caps, then the fill by
 * EG; item 3) and the pools (K and D/ST out of G by default; H only players who'd add to my lineup, except forced ones).
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, harderToGetFor, proposalKey, tradeInternals, type Screened, type TeamState } from "./evaluate";
import { addValueOf, baseFor } from "./league";
import { belowWaiverCredit, buildPools, dominancePruned, finalistsOf, partnerCandidates, runTradeSearch, shortlistOf } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeAsset } from "./tradeModel";
import { tradeEvaluation } from "./tradeTestFixtures";

const screened = (partnerId: string, i: number, objective: number, gPartner = 0): Screened => ({
  key: `${partnerId}|give:g${String(i).padStart(3, "0")}|get:h${i}`,
  partnerId,
  give: [`g${i}`],
  get: [`h${i}`],
  objective,
  myDelta: objective,
  pQuick: 1,
  gPartner,
});

describe("the screening shortlist (shortlistOf)", () => {
  it("drops g_mkt(P) outside the window (bounds included, non-finite out)", () => {
    const [lo, hi] = config.search.screeningGWindow;
    const list = [screened("2", 1, 5, lo - 0.01), screened("2", 2, 4, lo), screened("2", 3, 3, hi), screened("2", 4, 2, hi + 0.01), screened("2", 5, 1, Number.POSITIVE_INFINITY), screened("2", 6, 1, Number.NaN)];
    expect(shortlistOf([list]).map((x) => x.give[0])).toEqual(["g2", "g3"]);
  });

  it("keeps each partner's best keptPerPartner, then the best exactEvaluationMax over all, by objective then key", () => {
    const kept = config.search.keptPerPartner;
    const partners = Math.ceil(config.search.exactEvaluationMax / kept) + 2;
    const lists = Array.from({ length: partners }, (_, t) => Array.from({ length: kept + 5 }, (_, i) => screened(String(t + 2), i, 1000 - i - t * 0.5)));
    const out = shortlistOf(lists);
    expect(out).toHaveLength(config.search.exactEvaluationMax);
    for (const list of lists) {
      const mine = out.filter((x) => x.partnerId === list[0]?.partnerId);
      expect(mine.length).toBeLessThanOrEqual(kept);
      // A partner's kept ones are its best.
      for (const x of mine) expect(list.indexOf(x)).toBeLessThan(kept);
    }
    for (let i = 1; i < out.length; i++) expect((out[i - 1] as Screened).objective).toBeGreaterThanOrEqual((out[i] as Screened).objective);
    // Equal objectives: the smaller key first.
    const tie = shortlistOf([[screened("3", 2, 1), screened("2", 1, 1)]]);
    expect(tie.map((x) => x.partnerId)).toEqual(["2", "3"]);
  });
});

describe("the dominance pruning (lead decision N11: dominancePruned, shortlistOf)", () => {
  const asPlayers = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
  /** A screened trade with the search's key (proposalKey: each side sorted). */
  const s = (partnerId: string, give: string[], get: string[], objective: number, gPartner = 0, pQuick = 1): Screened => ({
    key: proposalKey({ partnerId, give: asPlayers(give), get: asPlayers(get) }),
    partnerId,
    give,
    get,
    objective,
    myDelta: objective / pQuick,
    pQuick,
    gPartner,
  });
  /** My players worth less than the waiver credit: the ones whose id starts with "t". */
  const cheap = (id: string) => id.startsWith("t");
  const keys = (xs: readonly Screened[]) => xs.map((x) => x.key);

  it("drops a trade giving a player worth less than W when the trade without him screened at least as well (a tie counts)", () => {
    const lean = s("2", ["a"], ["x"], 5);
    const worse = s("2", ["a", "t1"], ["x"], 4);
    const tie = s("2", ["t2", "a"], ["x"], 5);
    const better = s("2", ["a", "t3"], ["x"], 6);
    expect(keys(dominancePruned([worse, lean, tie, better], cheap))).toEqual(keys([lean, better]));
    // Within float noise of the lean one's objective is a tie.
    expect(dominancePruned([lean, s("2", ["a", "t1"], ["x"], 5 + 1e-12)], cheap)).toEqual([lean]);
  });

  it("only players worth less than W, and only against the same trade without him: same partner, same players of theirs", () => {
    const pricey = s("2", ["a", "b"], ["x"], 1);
    const variant = s("2", ["a", "t1"], ["x"], 1);
    const others = [s("2", ["a"], ["x", "y"], 9), s("2", ["a"], ["y"], 9), s("3", ["a"], ["x"], 9), s("2", ["b"], ["x"], 9)];
    // b isn't cheap; none of the others is a+t1 → x without t1.
    expect(keys(dominancePruned([pricey, variant, ...others], cheap))).toEqual(keys([pricey, variant, ...others]));
    // With a → x itself (even worse than the variant), only the variant goes.
    const lean = s("2", ["a"], ["x"], 1);
    expect(keys(dominancePruned([pricey, variant, lean, ...others], cheap))).toEqual(keys([pricey, lean, ...others]));
  });

  it("only players I give: a player of theirs worth less than W never drops a trade (end-of-Phase-4 review)", () => {
    // Two players of mine worth W or more for a cheap player of theirs: nothing of mine to leave out, so it stays, even
    // beside better trades giving one of the two (they are other trades, not this one without a cheap player of mine).
    const theirsCheap = s("2", ["a", "b"], ["t9"], 1);
    const singles = [s("2", ["a"], ["t9"], 9), s("2", ["b"], ["t9"], 9)];
    expect(keys(dominancePruned([theirsCheap, ...singles], cheap))).toEqual(keys([theirsCheap, ...singles]));
    // A cheap player on both sides: only mine is tried (the trade without my t1, here worse, keeps it).
    const both = s("2", ["a", "t1"], ["t9"], 2);
    const leanBoth = s("2", ["a"], ["t9"], 1);
    expect(keys(dominancePruned([both, leanBoth], cheap))).toEqual(keys([both, leanBoth]));
  });

  it("the objective alone decides: a lean version that screened better drops the variant even with a lower quick acceptance", () => {
    // N11 compares the screening objective (my ΔROS × quick P_accept), not its parts: the lean version's lower quick
    // acceptance (0.2 against 0.6) is already in its objective.
    const lean = s("2", ["a"], ["x"], 5, 0, 0.2);
    const variant = s("2", ["a", "t1"], ["x"], 4, 0, 0.6);
    expect(variant.pQuick).toBeGreaterThan(lean.pQuick);
    expect(keys(dominancePruned([variant, lean], cheap))).toEqual(keys([lean]));
  });

  it("my side always keeps a player: a 1-for-1 is never dropped, even against a better trade giving nothing", () => {
    const nothing = s("2", [], ["x"], 9);
    const one = s("2", ["t1"], ["x"], 1);
    expect(keys(dominancePruned([nothing, one], cheap))).toEqual(keys([nothing, one]));
    // Two cheap players: the one without the other, if it screened at least as well, keeps the trade's place.
    const both = s("2", ["t1", "t2"], ["x"], 1);
    expect(keys(dominancePruned([both, one], cheap))).toEqual(keys([one]));
  });

  it("every cheap player is tried, and a chain keeps its leanest best (each trade dropped leaves one at least as good)", () => {
    // Without t1 the trade wasn't screened; without t2 it was, and better: dropped.
    const three = s("2", ["a", "t1", "t2"], ["x"], 3);
    const withT1 = s("2", ["a", "t1"], ["x"], 4);
    expect(keys(dominancePruned([three, withT1], cheap))).toEqual(keys([withT1]));
    // A chain: a+t1+t2 ≤ a+t1 ≤ a. Each is compared with the trades screened, dropped or not: only a → x is left.
    const lean = s("2", ["a"], ["x"], 5);
    expect(keys(dominancePruned([three, withT1, lean], cheap))).toEqual(keys([lean]));
  });

  it("in the shortlist: after the g window (a trade outside it drops nothing), before keptPerPartner; null prunes nothing", () => {
    const [, hi] = config.search.screeningGWindow;
    const outside = s("2", ["a"], ["x"], 9, hi + 0.1);
    const variant = s("2", ["a", "t1"], ["x"], 1);
    expect(keys(shortlistOf([[outside, variant]], cheap))).toEqual(keys([variant]));
    // keptPerPartner trades that nothing dominates, plus a dominated variant ranked among them: pruned first, so the
    // last of the others still makes the cut.
    const kept = config.search.keptPerPartner;
    const plain = Array.from({ length: kept }, (_, i) => s("2", [`g${String(i).padStart(3, "0")}`], [`h${i}`], 100 - i));
    const dominated = s("2", ["g000", "t1"], ["h0"], 99.5);
    const pruned = shortlistOf([[...plain, dominated]], cheap);
    expect(keys(pruned)).toEqual(keys(plain));
    const unpruned = shortlistOf([[...plain, dominated]], null);
    expect(unpruned).toContain(dominated);
    expect(unpruned).not.toContain(plain.at(-1));
    expect(shortlistOf([[...plain, dominated]])).toEqual(unpruned);
  });

  it("worth less than W: strictly below the waiver credit (perception values; a player without one counts 0)", () => {
    const below = belowWaiverCredit({ values: { at: 900, under: 899.5, over: 901 }, credit: 900 });
    expect(["at", "under", "over", "none"].map(below)).toEqual([false, true, false, true]);
    // No market values: W is 0 and nobody is below it.
    expect(belowWaiverCredit({ values: {}, credit: 0 })("none")).toBe(false);
  });

  describe("in the search (smallLeague(11), Team 5's TEs only: one player to get, so the 2-for-1s are my pairs)", () => {
    const league = smallLeague(11);
    const settings: TradeSettings = { ...defaultTradeSettings(), targetPositions: ["TE"] };
    /** Team 5's screened candidates inside the g window, as the search builds them (buildPools, partnerCandidates). */
    const windowed = (I: ReturnType<typeof tradeInternals>, at: TradeSettings = settings) => {
      const pools = buildPools(I, at, "5");
      const partner = pools.partners[0] as TeamState;
      const h = pools.get.get("5") as { pool: string[]; forced: string[] };
      const it = partnerCandidates(I, partner, { give: pools.give, forcedGive: pools.forcedGive, get: h.pool, forcedGet: h.forced }, at.maxPerSide, { screened: 0 });
      let r = it.next();
      while (!r.done) r = it.next();
      const [lo, hi] = config.search.screeningGWindow;
      return r.value.filter((x) => x.gPartner >= lo - 1e-9 && x.gPartner <= hi + 1e-9);
    };
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
    const before = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0, beforeAddendum: true });
    const I = tradeInternals(ctx);

    it("exact evaluation gets the pruned list; the before-addendum variant the whole window", () => {
      const list = windowed(I);
      const pruned = dominancePruned(list, belowWaiverCredit(I));
      // Fewer than keptPerPartner are left, so the pruning shows in the count of exact evaluations.
      expect(list.length).toBeLessThanOrEqual(config.search.keptPerPartner);
      expect(pruned.length).toBeLessThan(list.length - 5);
      expect(pruned.every((x) => x.give.length >= 1)).toBe(true);
      // Every trade dropped gives a player of mine worth less than W, beside another of mine.
      for (const x of list.filter((y) => !pruned.includes(y))) {
        expect(x.give.length).toBeGreaterThanOrEqual(2);
        expect(x.give.some((id) => (I.values[id] ?? 0) < I.credit)).toBe(true);
      }
      expect(runTradeSearch(ctx, { partnerId: "5", settings }).counts.exact).toBe(pruned.length);
      // The before-addendum variant screens the same trades into the window (no tagged player here; the window reads the
      // raw g) and prunes none of them.
      const Ib = tradeInternals(before);
      expect(new Set(windowed(Ib).map((x) => x.key))).toEqual(new Set(list.map((x) => x.key)));
      expect(runTradeSearch(before, { partnerId: "5", settings }).counts.exact).toBe(list.length);
    });

    it("whatever the settings: 3 a side allowed, and a must-include player of mine (the pruning tries my other players)", () => {
      const cheap = belowWaiverCredit(I);
      const me = I.me as TeamState;
      // maxPerSide 3, my four most valuable players untouchable so the window stays under keptPerPartner (the pruning then
      // shows in the count of exact evaluations); 3-for-1s are among the trades it drops.
      const top4 = [...me.roster].sort((a, b) => (I.values[b] ?? 0) - (I.values[a] ?? 0) || (a < b ? -1 : 1)).slice(0, 4);
      const three: TradeSettings = { ...settings, maxPerSide: 3, untouchables: top4 };
      const list3 = windowed(I, three);
      const pruned3 = dominancePruned(list3, cheap);
      expect(list3.length).toBeLessThanOrEqual(config.search.keptPerPartner);
      expect(pruned3.length).toBeLessThan(list3.length);
      expect(list3.filter((x) => !pruned3.includes(x)).some((x) => x.give.length === 3)).toBe(true);
      expect(runTradeSearch(ctx, { partnerId: "5", settings: three }).counts.exact).toBe(pruned3.length);
      // A must-include player of mine worth W or more (the first on my roster whose trades have dominated variants): he is
      // in every trade, and the variants that add a cheap player of mine to a trade that screened at least as well go.
      const mustWith = (id: string): TradeSettings => ({ ...settings, mustInclude: [id] });
      const forced = me.roster.find((id) => {
        if (cheap(id) || !I.league.table.rows.has(id)) return false;
        const l = windowed(I, mustWith(id));
        return dominancePruned(l, cheap).length < l.length;
      }) as string;
      expect(forced).toBeDefined();
      const listF = windowed(I, mustWith(forced));
      const prunedF = dominancePruned(listF, cheap);
      expect(listF.every((x) => x.give.includes(forced))).toBe(true);
      for (const x of listF.filter((y) => !prunedF.includes(y))) expect(x.give.some((id) => id !== forced && cheap(id))).toBe(true);
      expect(listF.length).toBeLessThanOrEqual(config.search.keptPerPartner);
      expect(runTradeSearch(ctx, { partnerId: "5", settings: mustWith(forced) }).counts.exact).toBe(prunedF.length);
    });
  });
});

describe("the finalists (finalistsOf; item 3)", () => {
  const value = (asset: TradeAsset) => (asset.kind === "player" ? ({ nix: 9000, kelce: 8000 } as Record<string, number>)[asset.id] ?? 100 : 0);
  /** 40 other trades, each with its own core and partner, below the ones a test is about. */
  const others = Array.from({ length: config.search.finalists }, (_, i) => tradeEvaluation({ partnerId: `o${i}`, give: [`x${i}`], get: [`y${i}`], b: 5 - i * 0.01, pComplete: 0.5, stage: "exact", sims: 1000 }));

  it("a core may have perCore + 1 finalists (the strict cap applies only in the final ranking)", () => {
    const core = [1, 2, 3, 4].map((i) => tradeEvaluation({ partnerId: `c${i}`, give: ["nix", `f${i}`], get: ["kelce"], b: 10 - i * 0.1, pComplete: 0.5 }));
    const { keys } = finalistsOf([...core, ...others], value);
    expect(keys.size).toBe(config.search.finalists);
    const kept = core.filter((t) => keys.has(t.key)).length;
    expect(kept).toBe(config.ranking.perCore + 1);
    expect(keys.has((core[3] as { key: string }).key)).toBe(false);
  });

  it("a partner may have perPartnerInTop20 + 1 finalists among the first 20", () => {
    const n = config.ranking.perPartnerInTop20 + 2;
    const mine = Array.from({ length: n }, (_, i) => tradeEvaluation({ partnerId: "7", give: [`m${i}`], get: [`k${i}`], b: 10 - i * 0.1, pComplete: 0.5 }));
    const { keys } = finalistsOf([...mine, ...others], value);
    expect(mine.filter((t) => keys.has(t.key)).length).toBe(config.ranking.perPartnerInTop20 + 1);
  });

  it("the fill takes the best others by EG up to `finalists`, never a hidden one; the hidden are counted", () => {
    // Three trades share a core (one is over the relaxed cap), one has B ≤ 0, one is hidden by the market guard.
    const core = [1, 2, 3, 4, 5].map((i) => tradeEvaluation({ partnerId: `c${i}`, give: ["nix", `f${i}`], get: ["kelce"], b: 10 - i * 0.1, pComplete: 0.5 }));
    const zero = tradeEvaluation({ partnerId: "z", give: ["za"], get: ["zb"], b: -1, pComplete: 0.9 });
    const market = tradeEvaluation({ partnerId: "m", give: ["ma"], get: ["mb"], b: 4, pComplete: 0.5, gMine: -0.5 });
    const { keys, hidden } = finalistsOf([...core, zero, market], value);
    // The ranking keeps 3 of the core; the fill adds the other 2 (room is left), never the hidden ones.
    expect(core.every((t) => keys.has(t.key))).toBe(true);
    expect(keys.has(zero.key)).toBe(false);
    expect(keys.has(market.key)).toBe(false);
    expect(hidden).toEqual({ byBenefit: 1, byMarket: 1 });
  });
});

describe("the pools (buildPools)", () => {
  const league = smallLeague(11);
  const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 });
  const I = tradeInternals(ctx);
  const me = I.me as TeamState;
  const pos = (id: string) => league.snapshot.players[id]?.pos;
  const mvAdd = (id: string): number => {
    const row = I.league.table.rows.get(id);
    if (!row) return Number.NaN;
    const base = baseFor(I.league, I.bases, me.index, row.pos);
    return base ? addValueOf(I.league)(me.index, base, row, I.league.maskOf(row), false) : Number.NaN;
  };

  it("G: no K or D/ST by default; at most givePool by surplus plus chips; H: only players who'd add to my lineup", () => {
    const pools = buildPools(I, defaultTradeSettings(), null);
    expect(pools.stop).toBe(false);
    expect(pools.give.some((id) => pos(id) === "K" || pos(id) === "DEF")).toBe(false);
    expect(pools.give.length).toBeLessThanOrEqual(config.search.givePool + (I.model.teams[me.index]?.chips.length ?? 0));
    for (const p of pools.partners) {
      const h = pools.get.get(p.id);
      // "Harder to get" players apart (planner addendum §2): at most getPool untagged and getPoolTagged tagged.
      const tagged = (h?.pool ?? []).filter((id) => harderToGetFor(I, p.id, id));
      expect((h?.pool.length ?? 0) - tagged.length).toBeLessThanOrEqual(config.search.getPool);
      expect(tagged.length).toBeLessThanOrEqual(config.search.getPoolTagged);
      for (const id of h?.pool ?? []) expect(mvAdd(id), id).toBeGreaterThan(0);
    }
  });

  it("a forced player of theirs is in H whatever he'd add, and only his team is searched", () => {
    const partner = I.byId.get("3") as TeamState;
    const useless = partner.roster.find((id) => I.league.table.rows.has(id) && !(mvAdd(id) > 0)) as string;
    expect(useless).toBeDefined();
    const pools = buildPools(I, { ...defaultTradeSettings(), mustInclude: [useless] }, null);
    expect(pools.partners.map((t) => t.id)).toEqual(["3"]);
    expect(pools.get.get("3")?.forced).toEqual([useless]);
    expect(pools.get.get("3")?.pool).toContain(useless);
  });
});
