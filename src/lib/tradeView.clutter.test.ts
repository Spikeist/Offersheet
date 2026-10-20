/**
 * The Trade Finder's view after Checkpoint 7h (planner reply to Checkpoint 7g, §1; the lead's rulings for track "clutter", items
 * 4 and 5): "Assumed with or without this trade" said once above the list (baselineAssumedLines, FinderView.assumed) and left out
 * of every card, Plan B box and offer whose own line is the same (withoutListLine); a Plan B several ideas share shown only on the
 * highest of them in the sort shown, and offered only there as a version the feedback asks about. A made-up league.
 */
import { describe, expect, it } from "vitest";
import type { TradeEvaluation } from "@/engine/tradeModel";
import { planBFixture } from "@/engine/tradeTestFixtures";
import { evaluation, searchResult, tradeSnapshot } from "@/components/trades/testFixtures";
import { BASELINE_ASSUMED, MY_MOVES_ASSUMED, assumedLinesOf, baselineAssumedLines, buildFinderView, buildLadderView, buildTradeCard, withoutListLine } from "./tradeView";

const snapshot = tradeSnapshot();
const LINE = "add Floopy Freeman, drop Glimmer Oddfellow";
const pickup = { assumed: [{ add: "901", drop: "105" }] };

describe("the line of moves made with or without a trade, once above the list (Checkpoint 7h, item 4)", () => {
  it("says the baseline's moves in a card's words, for “a trade” above the list and “this trade” to match a card's", () => {
    expect(BASELINE_ASSUMED).toBe("Assumed with or without a trade:");
    expect(baselineAssumedLines(pickup, snapshot)).toEqual({ text: `${BASELINE_ASSUMED} ${LINE}.`, cardLine: `${MY_MOVES_ASSUMED} ${LINE}.` });
    // The card line is exactly the line a card with the same moves prints (myMovesLines' assumed line).
    expect(assumedLinesOf(pickup, snapshot)).toEqual([`${MY_MOVES_ASSUMED} ${LINE}.`]);
    // With a release at an IR return: one list (one pickup group and one release), the release by week.
    const both = { ...pickup, assumedLater: [{ week: 9, player: "206", returner: "206" }] };
    expect(baselineAssumedLines(both, snapshot)?.text).toBe(`${BASELINE_ASSUMED} ${LINE}, release Rupert Wimbleton in week 9, when he returns from IR.`);
    // Nothing made either way, or nothing known (an older worker's result): no line.
    expect(baselineAssumedLines({ assumed: [] }, snapshot)).toBeNull();
    expect(baselineAssumedLines(null, snapshot)).toBeNull();
    expect(baselineAssumedLines(undefined, snapshot)).toBeNull();
  });

  it("leaves exactly that line out of a list of roster moves (withoutListLine)", () => {
    const line = `${MY_MOVES_ASSUMED} ${LINE}.`;
    expect(withoutListLine(["Make room for Cornelius Snoot: drop Tobias Thimble (TE).", line], line)).toEqual(["Make room for Cornelius Snoot: drop Tobias Thimble (TE)."]);
    expect(withoutListLine([line], `${MY_MOVES_ASSUMED} add Floopy Freeman.`)).toEqual([line]);
    expect(withoutListLine([line], null)).toEqual([line]);
  });

  it("shows it above the list and leaves it out of the cards, boxes and offers that say the same, never of one that differs", () => {
    const same: TradeEvaluation = { ...evaluation({ key: "a" }), myMoves: { moves: [{ kind: "makeRoom", week: 6, drop: ["108"], for: ["204"] }], ...pickup } };
    const other: TradeEvaluation = { ...evaluation({ key: "b", b: 2, give: ["106"] }), myMoves: { moves: [], assumed: [{ add: "901", drop: "108" }] } };
    const view = buildFinderView({ result: searchResult([same, other], { baselineMoves: pickup }), sort: "overall", snapshot, partnerId: null });
    expect(view.assumed).toBe(`${BASELINE_ASSUMED} ${LINE}.`);
    expect(view.assumedCardLine).toBe(`${MY_MOVES_ASSUMED} ${LINE}.`);
    const byKey = new Map(view.cards.map((c) => [c.key, c]));
    expect(byKey.get("a")?.required).toEqual(["Make room for Cornelius Snoot: drop Tobias Thimble (TE)."]);
    expect(byKey.get("b")?.required).toEqual([`${MY_MOVES_ASSUMED} add Floopy Freeman, drop Tobias Thimble.`]);
    // An offer of "How to offer it" with the same line leaves it out too (LadderContext.assumedLine).
    const card = byKey.get("a");
    if (!card) throw new Error("no card a");
    const ladder = buildLadderView({ cardKey: "a", steps: [{ kind: "open", evaluation: { ...evaluation({ key: "o", get: ["202", "204"] }), myMoves: { moves: [], ...pickup } }, message: "Hey!" }, { kind: "suggested", evaluation: same, message: "x" }] }, card, { snapshot, assumedLine: view.assumedCardLine });
    expect(ladder.steps[0]?.moves).toEqual([]);
    // Without the baseline's moves (an older worker's result): every card names its own, and no line above the list.
    const old = buildFinderView({ result: searchResult([same]), sort: "overall", snapshot, partnerId: null });
    expect(old.assumed).toBeNull();
    expect(old.cards[0]?.required).toContain(`${MY_MOVES_ASSUMED} ${LINE}.`);
    // No line above an empty list.
    expect(buildFinderView({ result: searchResult([], { baselineMoves: pickup }), sort: "overall", snapshot, partnerId: null }).assumed).toBeNull();
  });

  it("leaves it out of a Plan B box whose own line is the same", () => {
    const planB = { ...planBFixture({ partnerId: "2", give: ["105"], get: ["203"] }), myMoves: { moves: [], ...pickup } };
    const card = buildTradeCard(evaluation({ planB }), { snapshot, assumedLine: `${MY_MOVES_ASSUMED} ${LINE}.` });
    expect(card.planB?.moves).toEqual([]);
    expect(buildTradeCard(evaluation({ planB }), { snapshot }).planB?.moves).toEqual([`${MY_MOVES_ASSUMED} ${LINE}.`]);
  });
});

describe("a Plan B several ideas share shows on the highest of them only (Checkpoint 7h, item 5)", () => {
  const shared = planBFixture({ partnerId: "2", give: ["105"], get: ["203"] });
  const trades = [evaluation({ key: "a", b: 4, pComplete: 0.3, planB: shared }), evaluation({ key: "b", b: 6, pComplete: 0.1, give: ["105"], planB: shared }), evaluation({ key: "c", b: 1, pComplete: 0.5, planB: shared })];
  const view = (sort: "overall" | "helps") => buildFinderView({ result: searchResult(trades), sort, snapshot, partnerId: null });

  it("in the sort shown: the first card holding it keeps it, the others show none and don't offer it as a version", () => {
    for (const sort of ["overall", "helps"] as const) {
      const cards = view(sort).cards;
      const holders = cards.filter((c) => c.planB !== null);
      expect(holders.map((c) => c.key), sort).toEqual([cards[0]?.key]);
      for (const c of cards.slice(1)) expect(c.versions.some((v) => v.version === "planB"), `${sort}: ${c.key}`).toBe(false);
      expect(cards[0]?.versions.some((v) => v.version === "planB")).toBe(true);
    }
    // Overall puts "a" first (4 × 0.3 against 6 × 0.1 and 1 × 0.5); Helps you puts "b" first.
    expect(view("overall").cards[0]?.key).toBe("a");
    expect(view("helps").cards[0]?.key).toBe("b");
  });

  it("leaves different Plan Bs alone", () => {
    const other = planBFixture({ partnerId: "2", give: ["106"], get: ["205"] });
    const cards = buildFinderView({ result: searchResult([evaluation({ key: "a", planB: shared }), evaluation({ key: "b", b: 2, give: ["105"], planB: other })]), sort: "overall", snapshot, partnerId: null }).cards;
    expect(cards.map((c) => c.planB?.key ?? null)).toEqual([shared.key, other.key]);
  });
});
