/**
 * A trade card's feedback presses carry what the card prints (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1: the
 * export holds "only what the user saw and entered"): TradeCard sends every press of its feedback buttons through
 * src/lib/tradeView.ts cardPress, so the record a press makes keeps the card's printed numbers and lines (TradeCardView.shown)
 * for the export. FeedbackControls is stood in for here, to hold the onChange the card gives it; its own behavior is
 * TradePages.test.ts's. A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { titleDeltas } from "@/engine/reward";
import type { PartnerNumbers } from "@/engine/tradeModel";
import type { FeedbackChange } from "@/lib/feedbackStore";
import { buildFinderView, buildTradeCard, type CardFeedback } from "@/lib/tradeView";

/** The onChange the card gave its feedback buttons, at the last render. */
const given: { onChange: ((change: FeedbackChange) => unknown) | null } = { onChange: null };

vi.mock("./FeedbackControls", () => ({
  FeedbackControls: (props: { onChange: (change: FeedbackChange) => unknown }) => {
    given.onChange = props.onChange;
    return null;
  },
}));

const { TradeCard } = await import("./TradeCard");
const { evaluation, searchResult, tradeSnapshot } = await import("./testFixtures");

const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };

/** The presses the page's onFeedback receives from a card's buttons. */
function pressesOn(card: ReturnType<typeof buildTradeCard>, changes: FeedbackChange[]): FeedbackChange[] {
  const received: FeedbackChange[] = [];
  given.onChange = null;
  renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: (change: FeedbackChange) => (received.push(change), { ok: true as const }) }));
  // Set by the stand-in during the render (TypeScript can't see that).
  const onChange = given.onChange as ((change: FeedbackChange) => unknown) | null;
  if (!onChange) throw new Error("the card gave its feedback buttons no onChange");
  for (const change of changes) onChange(change);
  return received;
}

describe("a trade card's feedback presses (Checkpoint 7d)", () => {
  it("passes every press on with what the card prints: outcomes, a version sent, a report, a clear", () => {
    const card = buildTradeCard(evaluation({ dCH: 0.013, dPO: 0.04 }), { snapshot: tradeSnapshot(), baseline: { pPlayoffs: 0.65, pTitle: 0.121 } });
    const sent = { version: "full" as const, key: card.key, pAccept: 0.4, pComplete: 0.4 };
    const changes: FeedbackChange[] = [{ outcome: "sent", sent }, { outcome: "accepted" }, { report: { reason: "other", note: "Asked twice." } }, { outcome: null }];
    expect(pressesOn(card, changes)).toEqual(changes.map((c) => ({ ...c, shown: card.shown })));
    expect(card.shown.odds).toEqual(["Title odds 12.1% → 13.4%", "Playoff odds 65% → 69%"]);
  });

  it("a Trade Finder card's press carries its own printed words: no partner's line when the card shows none", () => {
    const them: PartnerNumbers = { b: 0.4, bWin: 0.4, bFuture: null, lambda: null, b3: 4, helps: 4, dPO: 0.04, dCH: 0.009, dPrizes: titleDeltas(0.009), before: { pPlayoffs: 0.41, pTitle: 0.06, prizes: { first: 0.06, second: null, third: null, weeklyHigh: 0, pointsLeader: 0 } } };
    const e = { ...evaluation(), them };
    const finderCard = buildFinderView({ result: searchResult([e]), sort: "overall", snapshot: tradeSnapshot(), partnerId: null }).cards[0];
    if (!finderCard) throw new Error("the Finder shows the card");
    const [press] = pressesOn(finderCard, [{ outcome: "sent" }]);
    expect(press?.shown).toEqual(finderCard.shown);
    expect(press?.shown).not.toHaveProperty("helpsThem");
  });
});
