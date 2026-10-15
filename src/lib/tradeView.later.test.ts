/**
 * "Now or after this week" on the trade cards (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2): tradeView.ts
 * nowOrLaterView ("Helps you 37 now · 41 if done after this week's games.", only when the two printed numbers differ by more
 * than config.explain.nowOrLaterMin), the planner's tooltip and the same words among the card's facts; the Trade Analyzer's card
 * from its evaluation's own numbers (TradeEvaluation.later), the Trade Finder's from the lines the worker posts after the search
 * (buildFinderView's `later`), with the list's "pending" / "done". The fictional league of components/trades/testFixtures.ts.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import type { LaterNumbers } from "@/engine/tradeModel";
import { evaluation, searchResult, tradeSnapshot } from "@/components/trades/testFixtures";
import { NOW_OR_LATER_LABEL, NOW_OR_LATER_TITLE, buildAnalysisView, buildFinderView, nowOrLaterView } from "./tradeView";

const snapshot = tradeSnapshot();
/** Helps you as the fixtures score it (B₃ 6): B 3 → 39, B 4 → 49, B 3.4 → 43, B 2.5 → 34. */
const at = (b: number): LaterNumbers => ({ b, tradeScore: Math.round(100 * (1 - Math.exp(-b / 6))) });

describe("nowOrLaterView (Checkpoint 7e, item 4.2)", () => {
  it("words both printed numbers, with the planner's tooltip, when they differ by more than nowOrLaterMin", () => {
    expect(config.explain.nowOrLaterMin).toBe(3);
    const e = evaluation({ b: 3 });
    expect(e.tradeScore).toBe(39);
    expect(nowOrLaterView(e, at(4))).toEqual({
      now: "Helps you 39 now",
      later: "49 if done after this week's games.",
      text: "Helps you 39 now · 49 if done after this week's games.",
      title: NOW_OR_LATER_TITLE,
    });
    expect(NOW_OR_LATER_TITLE).toBe("Assumes the same deal is still there next week. Injuries, big games or another trade can change that, and their answer may change too.");
    // Lower later works the same way.
    expect(nowOrLaterView(e, at(2.5))?.text).toBe("Helps you 39 now · 34 if done after this week's games.");
  });

  it("stays quiet within the noise, and without later numbers", () => {
    const e = evaluation({ b: 3 });
    // 39 → 43: 4 points, shown; 39 → 42: 3, not more than 3.
    expect(nowOrLaterView(e, { b: 3.4, tradeScore: 43 })).not.toBeNull();
    expect(nowOrLaterView(e, { b: 3.3, tradeScore: 42 })).toBeNull();
    expect(nowOrLaterView(e, { b: 2.7, tradeScore: 36 })).toBeNull();
    expect(nowOrLaterView(e, null)).toBeNull();
    expect(nowOrLaterView(e, undefined)).toBeNull();
    // An unknown B on either side prints "—": no line.
    expect(nowOrLaterView(e, { b: null, tradeScore: null })).toBeNull();
  });

  it("prints a B of 0 or less as 0, as the card's Helps you does", () => {
    const e = evaluation({ b: 3 });
    expect(nowOrLaterView(e, { b: -0.4, tradeScore: null })?.text).toBe("Helps you 39 now · 0 if done after this week's games.");
    const hurts = evaluation({ b: -1 });
    expect(nowOrLaterView(hurts, at(1))?.text).toBe("Helps you 0 now · 15 if done after this week's games.");
  });
});

describe("the cards' line (Checkpoint 7e, item 4.2)", () => {
  it("the Trade Analyzer's card reads its evaluation's own numbers, the tooltip's words among its facts", () => {
    const view = buildAnalysisView({ evaluation: { ...evaluation({ b: 3 }), later: at(4) }, illegal: null, notes: [] }, snapshot);
    expect(view.card?.nowOrLater?.text).toBe("Helps you 39 now · 49 if done after this week's games.");
    expect(view.card?.facts.find((f) => f.label === NOW_OR_LATER_LABEL)?.value).toBe(NOW_OR_LATER_TITLE);
    // Without a line, no such fact.
    const quiet = buildAnalysisView({ evaluation: { ...evaluation({ b: 3 }), later: at(3.2) }, illegal: null, notes: [] }, snapshot);
    expect(quiet.card?.nowOrLater).toBeNull();
    expect(quiet.card?.facts.some((f) => f.label === NOW_OR_LATER_LABEL)).toBe(false);
  });

  it("the Trade Finder's cards read the lines as they arrive, and the list says whether they're all in", () => {
    const a = evaluation({ b: 3 });
    const b = evaluation({ give: ["105"], get: ["203"], b: 4 });
    const result = searchResult([a, b]);
    const base = { result, sort: "overall" as const, snapshot, partnerId: null };
    // None yet: no line, and none expected.
    const before = buildFinderView(base);
    expect(before.cards.map((c) => c.nowOrLater)).toEqual([null, null]);
    expect(before.nowOrLater).toBeUndefined();
    // The first card's arrived; the second's still to come.
    const some = buildFinderView({ ...base, later: { lines: new Map([[a.key, at(4)]]), done: false } });
    const card = (key: string) => some.cards.find((c) => c.key === key);
    expect(card(a.key)?.nowOrLater?.text).toBe("Helps you 39 now · 49 if done after this week's games.");
    expect(card(b.key)?.nowOrLater).toBeNull();
    expect(some.nowOrLater).toBe("pending");
    // All in: the second's within the noise (49 → 51), or none for it (a null line): no line either way.
    const all = buildFinderView({ ...base, later: { lines: new Map([[a.key, at(4)], [b.key, at(4.3)]]), done: true } });
    expect(all.cards.find((c) => c.key === b.key)?.nowOrLater).toBeNull();
    expect(all.nowOrLater).toBe("done");
    const none = buildFinderView({ ...base, later: { lines: new Map([[a.key, null], [b.key, null]]), done: true } });
    expect(none.cards.map((c) => c.nowOrLater)).toEqual([null, null]);
    // The ranking stays on "now": the same cards in the same order whatever the lines say.
    expect(all.cards.map((c) => c.key)).toEqual(before.cards.map((c) => c.key));
  });
});
