/**
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7): the "Helps both" list of the trade search (search.ts finalistsOf's
 * extras, finish's second list; TradeSearchResult.helpsBoth). Every card helps both teams on its final numbers, in Helps-you
 * order, with the minimum chance and §13's caps; the extras are the top config.search.helpsBothFinalists screening trades
 * that help both, checked again on the final run; a card on both lists is one evaluation; no Plan B box names a card of a
 * list its card is on; the review's findings (HB-1 to HB-5): the Overall list is what it is without the second list, a card
 * that helps both offers first and falls back only on trades that help both, the list shows no filler of its own cards; a
 * lower minimum's suggestion; re-filtering equals a fresh search; one partner and must-include players.
 * Synthetic leagues (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds show what is a fact of
 * the synthetic data, said where a test leans on it.
 */
import { describe, expect, it } from "vitest";
import { helpsBoth } from "./benefit";
import { config } from "./config";
import { analyzeTrade, assetValue, buildTradeContext, tradeInternals, tradeSteps, type SimState, type TeamState, type TradeContext, type TradeVersion } from "./evaluate";
import { assetId, meetsMinChance, rankTrades } from "./rank";
import { rankCaps, runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeSearchResult } from "./tradeModel";

const at = (minChance: number, x: Partial<TradeSettings> = {}): TradeSettings => ({ ...defaultTradeSettings(), ...x, minChance });

const contexts = new Map<number, TradeContext>();
function contextOf(seed: number): TradeContext {
  let ctx = contexts.get(seed);
  if (!ctx) {
    const league = smallLeague(seed);
    ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    contexts.set(seed, ctx);
  }
  return ctx;
}
const searches = new Map<string, TradeSearchResult>();
/**
 * A search (shared): the all-teams search at 10% fresh, another minimum re-filtered from it (a fresh search's result exactly:
 * the re-filtering test below and search.refilter.test.ts check it), a one-partner or settings variant fresh.
 */
function search(seed: number, minChance: number, opts: { partnerId?: string | null; settings?: Partial<TradeSettings> } = {}): TradeSearchResult {
  const key = `${seed}|${minChance}|${opts.partnerId ?? "all"}|${JSON.stringify(opts.settings ?? {})}`;
  let r = searches.get(key);
  if (!r) {
    const plain = !opts.partnerId && !opts.settings;
    r = plain && minChance !== 0.1 ? runRefilter(contextOf(seed), stateOf(search(seed, 0.1)), { minChance }) : runTradeSearch(contextOf(seed), { settings: at(minChance, opts.settings), partnerId: opts.partnerId ?? null });
    searches.set(key, r);
  }
  return r;
}
const stateOf = (r: TradeSearchResult) => searchStateOf(r) as SearchState;
const listOf = (r: TradeSearchResult): TradeEvaluation[] => r.helpsBoth?.trades ?? [];
const keys = (ts: readonly { key: string }[]) => ts.map((t) => t.key);
const given = (t: Pick<TradeEvaluation, "proposal">) => t.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));

/** A side's highest-value asset (rank.ts's core rule: ties and unknown values to the smaller id). */
function coreOf(assets: readonly TradeAsset[], value: (a: TradeAsset) => number): string {
  let best = "";
  let v = Number.NEGATIVE_INFINITY;
  for (const a of assets) {
    const x = Number.isFinite(value(a)) ? value(a) : Number.NEGATIVE_INFINITY;
    const id = assetId(a);
    if (best === "" || x > v || (x === v && id < best)) {
      best = id;
      v = x;
    }
  }
  return best;
}

/** Hidden by default at these numbers (§10 guards): B ≤ 0 or unknown, or the market guard. */
const hidden = (c: Pick<TradeEvaluationCore, "b" | "flags">) => c.b === null || !(c.b > 0) || c.flags.hiddenByMarket;

const SEEDS = [8, 11, 23, 58, 67];

describe("the “Helps both” list (TradeSearchResult.helpsBoth)", { timeout: 120_000 }, () => {
  it("every card helps both teams on its final numbers, in Helps-you order, at least the minimum chance as printed, within §13's caps", () => {
    let cards = 0;
    for (const seed of SEEDS) {
      for (const minChance of [0, 0.1, 0.3]) {
        const r = search(seed, minChance);
        const list = listOf(r);
        const st = stateOf(r);
        const value = assetValue(st.I);
        const label = `seed ${seed} at ${minChance}`;
        expect(r.helpsBoth, label).toBeDefined();
        expect(list.length, label).toBeLessThanOrEqual(config.search.resultsShown);
        expect(r.helpsBoth?.qualifying ?? 0, label).toBeGreaterThanOrEqual(list.length);
        const finals = new Map(st.finals.map((c) => [c.key, c]));
        for (const t of list) {
          expect(t.stage, `${label} ${t.key}`).toBe("final");
          expect(finals.has(t.key), `${label} ${t.key}`).toBe(true);
          expect(helpsBoth(t), `${label} ${t.key}`).toBe(true);
          expect(t.tradeScore as number, `${label} ${t.key}`).toBeGreaterThan(0);
          expect(t.them?.helps as number, `${label} ${t.key}`).toBeGreaterThanOrEqual(config.benefit.helpsThemMin);
          expect(meetsMinChance(t.pComplete, minChance), `${label} ${t.key}`).toBe(true);
          expect(t.flags.hiddenByMarket, `${label} ${t.key}`).toBe(false);
        }
        for (let i = 1; i < list.length; i++) expect((list[i] as TradeEvaluation).b as number, label).toBeLessThanOrEqual((list[i - 1] as TradeEvaluation).b as number);
        expect(new Set(keys(list)).size, label).toBe(list.length);
        // §13's caps in the list's own order: partner and given player in the top 20, core over the list.
        const top = list.slice(0, config.ranking.partnerCapTop);
        const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
        for (const n of count(top.map((t) => t.proposal.partnerId)).values()) expect(n, label).toBeLessThanOrEqual(config.ranking.perPartnerInTop20);
        for (const n of count(top.flatMap(given)).values()) expect(n, label).toBeLessThanOrEqual(config.ranking.perGivenPlayerInTop20);
        for (const n of count(list.map((t) => `${coreOf(t.proposal.give, value)}|${coreOf(t.proposal.get, value)}`)).values()) expect(n, label).toBeLessThanOrEqual(config.ranking.perCore);
        // The minimum's hidden count for this list: the finalists that help both, pass the guards and miss the minimum.
        const under = st.finals.filter((c) => !hidden(c) && helpsBoth(c) && !meetsMinChance(c.pComplete, minChance)).length;
        expect(r.helpsBoth?.byChance, label).toBe(under);
        cards += list.length;
      }
    }
    expect(cards).toBeGreaterThan(0); // a fact of the synthetic data: the check isn't empty
  });

  it("the extras: the first helpsBothFinalists exact trades by B on the screening block that help both and aren't hidden join the final simulation", () => {
    let extras = 0;
    for (const seed of [...SEEDS, 77]) {
      const r = search(seed, 0.1);
      const st = stateOf(r);
      const screened = [...st.exactByKey.keys()].map((k) => st.versions.get(k)?.screen as TradeEvaluationCore);
      const top = screened
        .filter((c) => !hidden(c) && helpsBoth(c))
        .sort((a, b) => (b.b as number) - (a.b as number) || (a.key < b.key ? -1 : 1))
        .slice(0, config.search.helpsBothFinalists);
      const finals = new Set(keys(st.finals));
      for (const c of top) expect(finals.has(c.key), `seed ${seed} ${c.key}`).toBe(true);
      const topKeys = new Set(keys(top));
      for (const k of st.helpsBothExtras) expect(topKeys.has(k), `seed ${seed} ${k}`).toBe(true);
      // The finalists the ranking picked, then the extras: at most finalists of the former, and every final simulated once.
      expect(st.finals.length - st.helpsBothExtras.length, `seed ${seed}`).toBeLessThanOrEqual(config.search.finalists);
      expect(r.counts.simFinal, `seed ${seed}`).toBe(st.finals.length);
      expect(finals.size, `seed ${seed}`).toBe(st.finals.length);
      extras += st.helpsBothExtras.length;
    }
    expect(extras).toBeGreaterThan(0); // a fact of the synthetic data
  });

  it("re-checked on the final run: an extra that doesn't help both on its final numbers stays off the list (smallLeague(77))", () => {
    const r = search(77, 0.1);
    const st = stateOf(r);
    const out = st.finals.filter((c) => st.helpsBothExtras.includes(c.key) && !helpsBoth(c));
    expect(out.length).toBeGreaterThan(0); // a fact of the synthetic data
    for (const c of out) expect(keys(listOf(r))).not.toContain(c.key);
  });

  it("one evaluation per card: a card on both lists is the very same object (one set of steps, one Plan B, one set of words)", () => {
    let shared = 0;
    for (const seed of SEEDS) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        for (const t of listOf(r)) {
          const same = r.trades.find((x) => x.key === t.key);
          if (!same) continue;
          shared++;
          expect(t, `seed ${seed} ${t.key}`).toBe(same);
        }
      }
    }
    expect(shared).toBeGreaterThan(0); // a fact of the synthetic data
  });

  it("no Plan B box names a card of a list its card is on, nor a version that list's steps show; ⚠️ an Overall card's box may be a card only the “Helps both” list shows (HB-2: the page shows one list at a time)", () => {
    let boxes = 0;
    let otherList = 0;
    for (const seed of [...SEEDS, 40]) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        const lists = [r.trades, listOf(r)];
        const bars = lists.map((list) => {
          const barred = new Set(keys(list));
          for (const c of list) if (c.steps) for (const k of [c.steps.offerFirst.key, c.steps.ifNo.full.key]) barred.add(k);
          return barred;
        });
        for (const c of new Set([...r.trades, ...listOf(r)])) {
          if (!c.planB) continue;
          boxes++;
          lists.forEach((list, i) => {
            if (list.includes(c)) expect(bars[i]?.has(c.planB?.key as string), `seed ${seed} ${c.key} → ${c.planB?.key}`).toBe(false);
          });
          if (!listOf(r).includes(c) && keys(listOf(r)).includes(c.planB.key)) otherList++;
          expect(c.planB.proposal.partnerId).toBe(c.proposal.partnerId);
          // One Plan B per card: never next to steps.
          expect(c.steps).toBeUndefined();
        }
      }
    }
    expect(boxes).toBeGreaterThan(0); // a fact of the synthetic data
    expect(otherList).toBeGreaterThan(0); // smallLeague(40): a fact of the synthetic data
  });

  it("⚠️ the Overall list is what it is without the second list (HB-2, HB-5): with every partner's scale unknown, so that no trade helps both, the same cards, steps, boxes, words, `few`, pattern note and counts but the final runs", () => {
    let wouldEnter = 0;
    for (const seed of [8, 12, 13, 40]) {
      const r = search(seed, 0.1);
      const st = stateOf(r);
      // Only the second list ranks the extras.
      for (const t of r.trades) expect(st.helpsBothExtras, `seed ${seed}`).not.toContain(t.key);
      // ... which the Overall ranking would otherwise have kept (smallLeague(8), (12) and (13): facts of the synthetic data).
      const every = rankTrades(st.finals.map((c) => ({ ...c, reasons: [], pitch: "" })), assetValue(st.I), rankCaps({ relaxed: false, onePartner: false }), { minChance: 0.1 });
      wouldEnter += every.trades.filter((t) => st.helpsBothExtras.includes(t.key)).length;
      // The same league with no partner's calibration run: Helps them unknown everywhere, no extras, an empty second list.
      const league = smallLeague(seed);
      const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
      const sim = tradeInternals(ctx).sim as SimState;
      for (const t of tradeInternals(ctx).teams) sim.partners.set(t.id, null);
      const plain = runTradeSearch(ctx, { settings: at(0.1) });
      expect(listOf(plain), `seed ${seed}`).toEqual([]);
      expect(stateOf(plain).helpsBothExtras, `seed ${seed}`).toEqual([]);
      const strip = (x: TradeSearchResult) => ({ ...x, trades: x.trades.map(({ them: _them, ...t }) => (void _them, t)), counts: { ...x.counts, simFinal: 0 }, helpsBoth: undefined });
      expect(strip(r), `seed ${seed}`).toEqual(strip(plain));
    }
    expect(wouldEnter).toBeGreaterThan(0);
  });

  it("⚠️ a card that helps both teams, on either list, offers first only a version that helps both and has a box that helps both (HB-1, HB-4); smallLeague(20): the rule takes a card's steps", () => {
    let tagged = 0;
    for (const seed of [...SEEDS, 20, 32, 36]) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        const st = stateOf(r);
        for (const c of new Set([...r.trades, ...listOf(r)])) {
          if (!helpsBoth(c)) continue;
          tagged++;
          if (c.steps) expect(helpsBoth(st.versions.get(c.steps.offerFirst.key)?.screen as TradeEvaluationCore), `seed ${seed} ${c.key}`).toBe(true);
          if (c.planB) expect(helpsBoth(st.finalByKey.get(c.planB.key) as TradeEvaluationCore), `seed ${seed} ${c.key} → ${c.planB.key}`).toBe(true);
        }
      }
    }
    expect(tagged).toBeGreaterThan(0);
    // smallLeague(20): a card that helps both whose lean version doesn't (a fact of the synthetic data). Without the rule its
    // steps would offer that version first; with it, none, and the card is one offer. The Analyzer says the same.
    const r = search(20, 0.1);
    const st = stateOf(r);
    const settings = at(0.1);
    const card = listOf(r).find((t) => {
      const plain = tradeSteps(st.I, st.versions.get(t.key) as TradeVersion, { settings, maxPerSide: settings.maxPerSide, versions: st.versions });
      return plain !== null && plain.ranked === "full" && !helpsBoth(st.versions.get(plain.offerFirst.key)?.screen as TradeEvaluationCore);
    });
    expect(card).toBeDefined();
    const c = card as TradeEvaluation;
    expect(c.steps).toBeUndefined();
    expect(tradeSteps(st.I, st.versions.get(c.key) as TradeVersion, { settings, maxPerSide: settings.maxPerSide, versions: st.versions, helpsBoth: true })).toBeNull();
    const a = analyzeTrade(contextOf(20), c.proposal, { settings }).evaluation as TradeEvaluation;
    expect(helpsBoth(a)).toBe(true);
    expect(a.steps).toBeUndefined();
    // The pitch names the card's own trade (no offer-first version): every player of mine in it, the throw-in too.
    for (const id of given(c)) expect(c.pitch, id).toContain(st.I.snapshot.players[id]?.name as string);
  });

  it("⚠️ the list shows no card that is filler of another card it shows, judged as the Overall order does (HB-3); smallLeague(12): a variant ahead by B leaves for its smaller trade", () => {
    const sub = (a: Pick<TradeEvaluation, "proposal">, b: Pick<TradeEvaluation, "proposal">) => {
      const ids = (t: Pick<TradeEvaluation, "proposal">) => new Set([...t.proposal.give.map((x) => `g:${assetId(x)}`), ...t.proposal.get.map((x) => `r:${assetId(x)}`)]);
      const x = ids(a);
      const y = ids(b);
      return a.proposal.partnerId === b.proposal.partnerId && x.size < y.size && [...x].every((v) => y.has(v));
    };
    const f = config.ranking.fillerCutoffFraction;
    const filler = (big: TradeEvaluationCore, small: TradeEvaluationCore) =>
      sub(small, big) && (Math.abs((big.b as number) - (small.b as number)) < f * (small.b as number) || ((big.b as number) <= (small.b as number) && big.pComplete < small.pComplete)) && (big.b as number) * big.pComplete < (small.b as number) * small.pComplete;
    let aheadByB = 0;
    for (const seed of [...SEEDS, 12]) {
      for (const minChance of [0, 0.1]) {
        const r = search(seed, minChance);
        const list = listOf(r);
        for (const big of list) for (const small of list) expect(big !== small && filler(big, small), `seed ${seed} ${big.key} / ${small.key}`).toBe(false);
        // A finalist that qualifies for the list, ahead of a card of it by B, left off as its filler.
        for (const big of stateOf(r).finals) {
          if (list.some((t) => t.key === big.key) || hidden(big) || !helpsBoth(big) || !meetsMinChance(big.pComplete, minChance)) continue;
          if (list.some((small) => filler(big, small) && (big.b as number) > (small.b as number))) aheadByB++;
        }
      }
    }
    expect(aheadByB).toBeGreaterThan(0); // smallLeague(12): a fact of the synthetic data
  });

  it("lowerWouldAdd: the same finalists at Any would show more trades that help both; never at Any (smallLeague(31) at 10%)", () => {
    let suggested = 0;
    for (const seed of [...SEEDS, 31]) {
      const any = runRefilter(contextOf(seed), stateOf(search(seed, 0.1)), { minChance: 0 });
      expect(any.helpsBoth?.lowerWouldAdd, `seed ${seed} at Any`).toBe(false);
      for (const minChance of [0.1, 0.3, 0.5]) {
        const r = runRefilter(contextOf(seed), stateOf(search(seed, 0.1)), { minChance });
        const more = listOf(any).length > listOf(r).length;
        expect(r.helpsBoth?.lowerWouldAdd, `seed ${seed} at ${minChance}`).toBe(more);
        if (more) suggested++;
      }
    }
    expect(suggested).toBeGreaterThan(0); // a fact of the synthetic data
    expect(search(31, 0.1).helpsBoth).toMatchObject({ lowerWouldAdd: true, byChance: 1 });
  });

  it("re-filtering at another minimum gives exactly a fresh search's result, the “Helps both” list included", () => {
    for (const seed of [23, 31]) {
      const base = search(seed, 0.1);
      for (const minChance of [0, 0.3]) {
        const fresh = runTradeSearch(contextOf(seed), { settings: at(minChance) });
        expect(runRefilter(contextOf(seed), stateOf(base), { minChance }), `seed ${seed}: 0.1 → ${minChance}`).toEqual(fresh);
        expect(fresh.helpsBoth, `seed ${seed} at ${minChance}`).toEqual(search(seed, minChance).helpsBoth);
      }
    }
  });

  it("deterministic, and its result survives a structured clone (a worker's postMessage)", () => {
    const r = search(23, 0.1);
    expect(runTradeSearch(contextOf(23), { settings: at(0.1) })).toEqual(r);
    const copy = structuredClone(r);
    expect(copy).toEqual(r);
    // A card on both lists stays one object within the message.
    const shared = listOf(copy).find((t) => copy.trades.includes(t));
    if (listOf(r).some((t) => r.trades.includes(t))) expect(shared).toBeDefined();
  });

  it("one partner: only that partner's trades, no partner cap; must-include players of mine: in every card, outside the given-player cap", () => {
    const st = stateOf(search(23, 0.1));
    const partner = listOf(search(23, 0))[0]?.proposal.partnerId ?? st.I.teams.find((t) => t !== st.I.me)?.id;
    const one = search(23, 0, { partnerId: partner as string });
    for (const t of listOf(one)) expect(t.proposal.partnerId).toBe(partner);
    expect(one.helpsBoth?.dropped.partnerCap).toBe(0);
    // My player most often given in the all-teams list, made must-include.
    const counts = new Map<string, number>();
    for (const t of listOf(search(23, 0))) for (const id of given(t)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const forced = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    expect(forced).toBeDefined();
    const must = search(23, 0, { settings: { mustInclude: [forced as string] } });
    for (const t of listOf(must)) expect(given(t)).toContain(forced);
    for (const t of must.trades) expect(given(t)).toContain(forced);
  });

  it("an empty list is still a list (smallLeague(41): no trade helps both); a search stopped before ranking has none", () => {
    expect(search(41, 0.1).helpsBoth).toEqual({ trades: [], qualifying: 0, byChance: 0, lowerWouldAdd: false, dropped: { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 } });
    const league = smallLeague(23);
    const none = runTradeSearch(buildTradeContext({ ...league.snapshot, myTeamId: null }, league.inputs, { now: TEST_NOW, scenarios: 0 }), { settings: at(0.1) });
    expect(none.helpsBoth).toBeUndefined();
  });

  it("each partner's calibration run is made once, before the screening simulation, for the partners of the exact trades", () => {
    const league = smallLeague(58);
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    const I = tradeInternals(ctx);
    const sim = I.sim as SimState;
    expect(sim.partners.size).toBe(0);
    const r = runTradeSearch(ctx, { settings: at(0.1) });
    const partners = new Set([...stateOf(r).exactByKey.values()].map((x) => x.partner.id));
    expect(new Set(sim.partners.keys())).toEqual(partners);
    expect([...sim.partners.values()].every((run) => run !== null)).toBe(true);
    expect(partners.has((I.me as TeamState).id)).toBe(false);
    // Every simulated card carries its partner's numbers, scored on that partner's one scale.
    const scales = new Map<string, number>();
    for (const t of [...r.trades, ...listOf(r)]) {
      expect(t.them, t.key).toBeDefined();
      const b3 = t.them?.b3 as number;
      const seen = scales.get(t.proposal.partnerId);
      if (seen !== undefined) expect(b3, t.key).toBe(seen);
      scales.set(t.proposal.partnerId, b3);
    }
  });
});
