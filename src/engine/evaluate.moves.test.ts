/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, items 2.1 and 2.2; review of wave B, findings B-1, B-3, B-5,
 * moves-skip-reason-spot-taken, moves-waiver-takes-pickup-drop and moves-before-release-unnamed): whole searches on made-up
 * leagues whose free-agent pickups are held to one move a run (config mocked), so baselines stop at the cap and trades have
 * either-way moves (evaluate.ts eitherWayMoves), with cards and Plan B boxes whose numbers start from their own "before".
 * - Every exact trade's list of my roster moves (TradeEvaluation.myMoves) names every way my roster after the trade differs
 *   from its "before" (my baseline with its either-way moves), the trade's own players aside, each once, and nothing that
 *   doesn't differ; and at each IR return where the two release different players, it says what happens (moves.testing.ts
 *   movesMismatch).
 * - A search is deterministic, a re-filter equals a fresh search, every card and box carries its own exact evaluation's
 *   "before" and moves, and trades without either-way moves read exactly as with item 2.1 switched off
 *   (TradeContextOptions.eitherWay false: Checkpoint 7d's rule).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  const c = actual.config;
  return { ...actual, config: { ...c, freeAgentOptimizer: { ...c.freeAgentOptimizer, faMaxMoves: 1 } } };
});

import { buildTradeContext, tradeInternals } from "./evaluate";
import { movesMismatch } from "./moves.testing";
import { runRefilter, runTradeSearch, searchStateOf } from "./search";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeEvaluation, TradeSearchResult } from "./tradeModel";

/** A search result as its cards print, for equality between searches. */
function digest(result: TradeSearchResult): string {
  const strip = (e: TradeEvaluation) => ({
    key: e.key,
    b: e.b,
    pComplete: e.pComplete,
    overall: e.overall,
    them: e.them?.helps ?? null,
    before: e.before ?? null,
    myMoves: e.myMoves ?? null,
    planB: e.planB ? { key: e.planB.key, before: e.planB.before ?? null, myMoves: e.planB.myMoves ?? null } : null,
    reasons: e.reasons,
  });
  return JSON.stringify({ trades: result.trades.map(strip), both: (result.helpsBoth?.trades ?? []).map(strip), hidden: result.hidden, counts: result.counts });
}

describe("my roster moves and the trade's own before through whole searches (Checkpoint 7e, items 2.1 and 2.2)", { timeout: 300_000 }, () => {
  it("every exact trade's list names each way my roster after it differs from its before, once, and nothing else", () => {
    let trades = 0;
    let own = 0;
    for (const seed of [11, 13, 16]) {
      const l = smallLeague(seed);
      const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
      const I = tradeInternals(ctx);
      const state = searchStateOf(runTradeSearch(ctx));
      if (!state) throw new Error("no search state");
      for (const [key, x] of state.exactByKey) {
        trades++;
        if (x.before) own++;
        expect(movesMismatch(I, x), `seed ${seed}, ${key}`).toEqual([]);
      }
    }
    // Enough of both kinds to mean something (the baselines stop at the one-move cap).
    expect(trades).toBeGreaterThan(500);
    expect(own).toBeGreaterThan(50);
  });

  it("is deterministic, re-filters as a fresh search, carries each card's and box's own before and moves, and reads trades without either-way moves as item 2.1 switched off does", () => {
    const seed = 16;
    const l = smallLeague(seed);
    const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
    const result = runTradeSearch(ctx);
    const state = searchStateOf(result);
    if (!state) throw new Error("no search state");
    // Cards and boxes whose odds start from their own "before", each carrying its own exact evaluation's.
    const cards = [...result.trades, ...(result.helpsBoth?.trades ?? [])];
    let ownCards = 0;
    let ownBoxes = 0;
    for (const t of cards) {
      const x = state.exactByKey.get(t.key);
      expect(t.myMoves).toEqual(x?.evaluation.myMoves);
      expect(t.before !== undefined).toBe((x?.before ?? null) !== null);
      if (t.before) ownCards++;
      if (!t.planB) continue;
      const box = state.exactByKey.get(t.planB.key);
      expect(t.planB.myMoves).toEqual(box?.evaluation.myMoves);
      expect(t.planB.before !== undefined).toBe((box?.before ?? null) !== null);
      if (t.planB.before) ownBoxes++;
    }
    expect(ownCards).toBeGreaterThan(0);
    expect(ownBoxes).toBeGreaterThan(0);
    // Determinism: a fresh context, the same search.
    const l2 = smallLeague(seed);
    expect(digest(runTradeSearch(buildTradeContext(l2.snapshot, l2.inputs, { now: TEST_NOW })))).toBe(digest(result));
    // A re-filter at 20% equals a fresh search at 20%; back at 10% it equals the first.
    const at20 = runRefilter(ctx, state, { minChance: 0.2 });
    const l3 = smallLeague(seed);
    const ctx3 = buildTradeContext(l3.snapshot, l3.inputs, { now: TEST_NOW });
    expect(digest(at20)).toBe(digest(runTradeSearch(ctx3, { settings: { ...tradeInternals(ctx3).settings, minChance: 0.2 } })));
    const state20 = searchStateOf(at20);
    if (!state20) throw new Error("no search state");
    expect(digest(runRefilter(ctx, state20, { minChance: 0.1 }))).toBe(digest(result));
    // Item 2.1 switched off (Checkpoint 7d's rule): every trade without either-way moves reads the same, bit for bit, at every
    // stage both searches reached; no trade has a "before" of its own there.
    const l4 = smallLeague(seed);
    const offState = searchStateOf(runTradeSearch(buildTradeContext(l4.snapshot, l4.inputs, { now: TEST_NOW, eitherWay: false })));
    if (!offState) throw new Error("no search state");
    let compared = 0;
    for (const [key, x] of state.exactByKey) {
      const off = offState.exactByKey.get(key);
      expect(off?.before ?? null, key).toBeNull();
      if (x.before || !off) continue;
      compared++;
      expect(off.evaluation, key).toEqual(x.evaluation);
      const final = state.finalByKey.get(key);
      const offFinal = offState.finalByKey.get(key);
      if (final && offFinal) expect(offFinal, key).toEqual(final);
    }
    expect(compared).toBeGreaterThan(50);
  });
});
