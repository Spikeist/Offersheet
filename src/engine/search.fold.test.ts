/**
 * Folding (search.ts foldedCards and finish; final review of Phase 4c, finding PAGES-3): when a card's "How to offer it"
 * steps name another card of the list (its offer first or its full version), the two show one plan and both messages
 * would propose the same first offer, so the lower-ranked of the two leaves the list, which is ranked again without it.
 * On Parker's league, Oct 4 09:24Z: Kyle Monangai + Bo Nix → Jadarian Price said "Offer first: Bo Nix for Jadarian
 * Price", the card two places above it. Synthetic leagues (smallLeague: made-up players, placeholder teams).
 */
import { describe, expect, it } from "vitest";
import { assetValue, buildTradeContext, tradeInternals, tradeSteps } from "./evaluate";
import { rankTrades } from "./rank";
import { extraPlayersOf, foldedCards, rankCaps, runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague, withWaiverStash } from "./trade.testing";
import type { TradeSteps } from "./tradeModel";

/** Steps naming `offer` first and `full` after (only the keys matter here). */
const steps = (offer: string, full: string): TradeSteps => ({ offerFirst: { key: offer }, ifNo: { add: "x", full: { key: full } }, ranked: "full" }) as unknown as TradeSteps;

describe("foldedCards", () => {
  it("the lower-ranked of two cards that show one plan leaves: the named card when it's below, the card itself when it's above", () => {
    // B (2nd) is A's offer first: B leaves. D (4th) names C (3rd) above it: D leaves.
    expect(foldedCards([
      { key: "A", steps: steps("B", "A") },
      { key: "B", steps: null },
      { key: "C", steps: null },
      { key: "D", steps: steps("C", "D") },
    ])).toEqual(["B", "D"]);
    // A case-2 card (offer first itself) whose full version is a card below: that card leaves.
    expect(foldedCards([{ key: "A", steps: steps("A", "C") }, { key: "B", steps: null }, { key: "C", steps: null }])).toEqual(["C"]);
    // A card already leaving folds nothing: B leaves through A's steps, so B's own steps naming C leave C on the list.
    expect(foldedCards([{ key: "A", steps: steps("B", "A") }, { key: "B", steps: steps("C", "B") }, { key: "C", steps: null }])).toEqual(["B"]);
    // Steps naming no card, or no steps: nothing.
    expect(foldedCards([{ key: "A", steps: steps("Z", "A") }, { key: "B", steps: null }])).toEqual([]);
    expect(foldedCards([])).toEqual([]);
  });
});

describe("folding in the searches (smallLeague 30 and 67, scenario lineups)", { timeout: 120_000 }, () => {
  const settings = (minChance: number) => ({ ...defaultTradeSettings(), minChance });
  for (const seed of [30, 67]) {
    it(`seed ${seed}: no card's steps name another card; the cards that did are gone from the list ranked without folding`, () => {
      // W at the best free agent's value (withWaiverStash: Checkpoint 4c's rule, which the folding here was measured on);
      // A3's W, the best free agent left unclaimed, is lower in seed 30 (1,237 against 3,064) and leaves no folding there.
      // And the fallback playoff weight (league.ts step 5c not measured: 1.25, the weight before the planner's reply to
      // Checkpoint 7a, §6.1), which the folding here was measured with.
      const lg = withWaiverStash(smallLeague(seed));
      const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8, playoffWeightSims: 0 });
      const I = tradeInternals(ctx);
      for (const minChance of [0, 0.1]) {
        const r = runTradeSearch(ctx, { settings: settings(minChance) });
        const shown = new Set(r.trades.map((t) => t.key));
        for (const t of r.trades) {
          if (!t.steps) continue;
          for (const k of [t.steps.offerFirst.key, t.steps.ifNo.full.key]) if (k !== t.key) expect(shown.has(k), `seed ${seed} at ${minChance}: ${t.key} names ${k}`).toBe(false);
        }
        // Folding happened, and the list is the ranking replayed by hand: rank, take each card's steps, fold the cards that
        // share a plan (foldedCards), rank again without them, until none do. The cards folded are versions of a card shown,
        // with its partner (that card plus or minus a throw-in).
        const st = searchStateOf(r) as SearchState;
        const cores = st.finals.map((c) => ({ ...c, reasons: [], pitch: "" }));
        const rank = (out: ReadonlySet<string>) => rankTrades(cores.filter((c) => !out.has(c.key)), assetValue(I), rankCaps({ relaxed: false, onePartner: false }), { minChance });
        const stepsOf = (key: string) => {
          const v = st.versions.get(key);
          return v ? tradeSteps(I, v, { settings: settings(minChance), maxPerSide: 2, versions: st.versions }) : null;
        };
        const out = new Set<string>();
        let list = rank(out);
        for (let round = 0; round < 50; round++) {
          const fold = foldedCards(list.trades.map((t) => ({ key: t.key, steps: stepsOf(t.key) })));
          if (!fold.length) break;
          for (const k of fold) out.add(k);
          list = rank(out);
        }
        expect(out.size, `seed ${seed} at ${minChance}`).toBeGreaterThan(0);
        expect(r.trades.map((t) => t.key)).toEqual(list.trades.map((t) => t.key));
        for (const k of out) {
          const g = cores.find((c) => c.key === k);
          const version = !!g && r.trades.some((t) => t.proposal.partnerId === g.proposal.partnerId && (extraPlayersOf(t.proposal, g.proposal) !== null || extraPlayersOf(g.proposal, t.proposal) !== null));
          expect(version, `seed ${seed} at ${minChance}: ${k}`).toBe(true);
        }
        // A re-filter folds the same way as a fresh search.
        expect(runRefilter(ctx, st, { minChance: minChance === 0 ? 0.1 : 0 })).toEqual(runTradeSearch(ctx, { settings: settings(minChance === 0 ? 0.1 : 0) }));
      }
    });
  }
});
