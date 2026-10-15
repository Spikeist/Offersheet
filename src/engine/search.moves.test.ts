/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, items 2.1 and 2.2): the search's shown pass carries what a card's and a Plan B
 * box's numbers rest on: my roster moves they assume (TradeEvaluation.myMoves, "a Plan B box when it has moves") and, with
 * either-way moves, the trade's own "before" (search.ts boxWith). Made-up leagues at the app's own pickup cap (none of their
 * trades has either-way moves: evaluate.moves.test.ts holds the cap to one move for those); every exact trade's list names
 * each way my roster after it differs from its "before", once, and nothing else (review of wave B: moves.testing.ts).
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, tradeInternals } from "./evaluate";
import { movesMismatch } from "./moves.testing";
import { runTradeSearch, searchStateOf } from "./search";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";

describe("my roster moves through the search (Checkpoint 7e, item 2.2)", { timeout: 120_000 }, () => {
  it("every card and every Plan B box carries the moves of its own exact evaluation, and every exact trade's list accounts for its roster", () => {
    let boxes = 0;
    for (const seed of [11, 12]) {
      const l = smallLeague(seed);
      const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
      const r = runTradeSearch(ctx);
      const state = searchStateOf(r);
      if (!state) throw new Error("no search state");
      const cards = [...r.trades, ...(r.helpsBoth?.trades ?? [])];
      expect(cards.length).toBeGreaterThan(0);
      for (const t of cards) {
        const own = state.exactByKey.get(t.key);
        expect(t.myMoves).toBeDefined();
        expect(t.myMoves).toEqual(own?.evaluation.myMoves);
        // Its own "before" only with either-way moves (none here: my baseline makes every move that clears the bar).
        expect(t.before === undefined).toBe((own?.before ?? null) === null);
        if (!t.planB) continue;
        boxes++;
        const box = state.exactByKey.get(t.planB.key);
        expect(t.planB.myMoves).toEqual(box?.evaluation.myMoves);
        expect(t.planB.before === undefined).toBe((box?.before ?? null) === null);
      }
      const I = tradeInternals(ctx);
      for (const [key, x] of state.exactByKey) expect(movesMismatch(I, x), `seed ${seed}, ${key}`).toEqual([]);
    }
    expect(boxes).toBeGreaterThan(0);
  });
});
