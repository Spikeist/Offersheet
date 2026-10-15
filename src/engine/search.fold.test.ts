/**
 * No folding since Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1; the lead's addendum for wave D, "What goes": the
 * search no longer makes "Offer first / if they say no" steps, "and the folding that read them (search.foldedCards) goes
 * with them (each card's first message is now its own trade)"). From the final review of Phase 4c (finding PAGES-3) until
 * then, when a card's steps named another card of the list, the lower-ranked of the two left the list, which was ranked again
 * without it (on Parker's league, Oct 4 09:24Z: Kyle Monangai + Bo Nix → Jadarian Price said "Offer first: Bo Nix for
 * Jadarian Price", the card two places above it). Now the list is the finalists' ranking on the ranking block, ranked again
 * on its cards' printed numbers (search.ts, "The shown pass"), and a card and its version with a throw-in can both show: each
 * card's "How to offer it" is worked out when it's opened (offers.ts). Synthetic leagues (smallLeague: made-up players,
 * placeholder teams), the ones the folding was measured on.
 */
import { describe, expect, it } from "vitest";
import { assetValue, buildTradeContext, tradeInternals } from "./evaluate";
import { rankTrades } from "./rank";
import { extraPlayersOf, rankCaps, runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague, withWaiverStash } from "./trade.testing";
import type { TradeEvaluation, TradeEvaluationCore } from "./tradeModel";

const bare = (c: TradeEvaluationCore): TradeEvaluation => ({ ...c, reasons: [], pitch: "" });

describe("no steps and no folding (smallLeague 30 and 67, scenario lineups)", { timeout: 120_000 }, () => {
  const settings = (minChance: number) => ({ ...defaultTradeSettings(), minChance });
  for (const seed of [30, 67]) {
    it(`seed ${seed}: the cards carry no steps; the list is the finalists' ranking with no card folded; a card and its version with more players can both show`, () => {
      // The setup the folding was measured on (W at the best free agent's value, withWaiverStash, and the fallback playoff
      // weight, league.ts step 5c not measured), where it folded cards at both minimums.
      const lg = withWaiverStash(smallLeague(seed));
      const ctx = buildTradeContext(lg.snapshot, lg.inputs, { now: TEST_NOW, scenarios: 8, playoffWeightSims: 0 });
      const I = tradeInternals(ctx);
      let pairs = 0;
      for (const minChance of [0, 0.1]) {
        const r = runTradeSearch(ctx, { settings: settings(minChance) });
        expect(r.trades.length).toBeGreaterThan(0);
        for (const t of [...r.trades, ...(r.helpsBoth?.trades ?? [])]) expect(t.steps, t.key).toBeUndefined();
        // The list replayed by hand: the finalists the ranking picked (the "Helps both" extras left out), ranked on the
        // ranking block, then ranked again on the numbers the cards print. No card leaves for another card's steps.
        const st = searchStateOf(r) as SearchState;
        const extras = new Set(st.helpsBothExtras);
        const caps = rankCaps({ relaxed: false, onePartner: false });
        const ranking = rankTrades(st.finals.filter((c) => !extras.has(c.key)).map(bare), assetValue(I), caps, { minChance, givenCapExempt: st.forcedGive });
        const printed = rankTrades(ranking.trades.map((t) => bare(st.shownByKey.get(t.key) ?? t)), assetValue(I), caps, { minChance, givenCapExempt: st.forcedGive });
        expect(r.trades.map((t) => t.key)).toEqual(printed.trades.map((t) => t.key));
        // Cards that are versions of each other (one plus players of the other), which the folding would have kept apart.
        for (const t of r.trades) pairs += r.trades.filter((u) => u !== t && u.proposal.partnerId === t.proposal.partnerId && extraPlayersOf(t.proposal, u.proposal) !== null).length;
        // A re-filter is a fresh search's list.
        expect(runRefilter(ctx, st, { minChance: minChance === 0 ? 0.1 : 0 })).toEqual(runTradeSearch(ctx, { settings: settings(minChance === 0 ? 0.1 : 0) }));
      }
      expect(pairs, `seed ${seed}`).toBeGreaterThan(0);
    });
  }
});
