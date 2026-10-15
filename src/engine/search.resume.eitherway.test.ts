/**
 * Checkpoint 7f (planner reply to Checkpoint 7e, answer 2; evaluate.ts runSim, sim.ts's "Continuing a run"): a trade's own
 * "before" (Checkpoint 7e's either-way moves: ExactTrade.before, evaluate.ts beforeOddsOf) keeps its ranking run's progress,
 * and its run on the shown block continues it, like the trade's own run: the cards and boxes that start from their own
 * "before" print the full runs' numbers bit for bit (TradeContextOptions.resume false). Made-up leagues whose free-agent
 * pickups are held to one move a run (config mocked, as evaluate.moves.test.ts does), so baselines stop at the cap and trades
 * have either-way moves; placeholder teams.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, freeAgentOptimizer: { ...c.freeAgentOptimizer, faMaxMoves: 1 } } };
});

import { analyzeTrade, buildTradeContext, laterNumbers, rankProgressOf, simCounts, tradeInternals, type ExactTrade, type SimState } from "./evaluate";
import { offerLadderOfSearch } from "./offers";
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation, TradeSearchResult } from "./tradeModel";

const cardsOf = (r: TradeSearchResult): TradeEvaluation[] => [...new Map([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => [t.key, t])).values()];

describe("a trade's own “before” continues its ranking run too (either-way moves, one pickup a run)", { timeout: 300_000 }, () => {
  it("smallLeague 16: every card and box with its own “before” prints the full runs' numbers; its “before” and its trade continued", () => {
    const l = smallLeague(16);
    const on = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
    const off = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW, resume: false });
    const rOn = runTradeSearch(on);
    const rOff = runTradeSearch(off);
    expect(rOn).toEqual(rOff);
    const sOn = searchStateOf(rOn) as SearchState;
    const sim = tradeInternals(on).sim as SimState;
    const { final } = simCounts();
    let own = 0;
    for (const t of cardsOf(rOn)) {
      for (const key of [t.key, ...(t.planB ? [t.planB.key] : [])]) {
        const x = sOn.exactByKey.get(key) as ExactTrade;
        expect(rankProgressOf(sim, x.mine, x.theirs)?.sims, key).toBe(final);
        if (!x.before) continue;
        own++;
        expect(rankProgressOf(sim, x.before, null)?.sims, key).toBe(final);
      }
    }
    expect(own).toBeGreaterThan(0); // a fact of the synthetic data: cards and boxes with their own "before"
    // Re-filters, every card's later numbers and offers, and the Analyzer on every card: the full runs' too.
    const sOff = searchStateOf(rOff) as SearchState;
    expect(runRefilter(on, sOn, { minChance: 0 })).toEqual(runRefilter(off, sOff, { minChance: 0 }));
    for (const t of cardsOf(rOn)) {
      expect(laterNumbers(sOn.I, sOn.exactByKey.get(t.key) as ExactTrade, sOn.settings), t.key).toEqual(laterNumbers(sOff.I, sOff.exactByKey.get(t.key) as ExactTrade, sOff.settings));
      expect(offerLadderOfSearch(rOn, t.key), t.key).toEqual(offerLadderOfSearch(rOff, t.key));
      expect(analyzeTrade(on, t.proposal), t.key).toEqual(analyzeTrade(off, t.proposal));
    }
  });
});
