/**
 * check:browser's "now or after this week" contract (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2; contracts.ts
 * nowOrLaterProblems): a line must read "Helps you 37 now · 41 if done after this week's games.", start from its card's own
 * Helps you, show only more than config.explain.nowOrLaterMin apart, with the planner's words as its tooltip and right under it
 * (since Checkpoint 7h, in the card's Details; until then among the card's facts); and the card's own markup (TradeCard.tsx), read
 * the way inPage.ts nowOrLaterOf reads it, passes. A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { config } from "@/engine/config";
import { NOW_OR_LATER_TITLE, buildTradeCard, type CardFeedback } from "@/lib/tradeView";
import { decodeEntities, nowOrLaterProblems, type NowOrLaterRead } from "./contracts";

vi.mock("@/components/trades/FeedbackControls", () => ({ FeedbackControls: () => null }));

const { TradeCard } = await import("@/components/trades/TradeCard");
const { evaluation, tradeSnapshot } = await import("@/components/trades/testFixtures");

const want = { min: config.explain.nowOrLaterMin, title: NOW_OR_LATER_TITLE };
const good: NowOrLaterRead = { helps: "39", line: { text: "Helps you 39 now · 49 if done after this week's games.", title: NOW_OR_LATER_TITLE }, fact: NOW_OR_LATER_TITLE };

describe("check:browser's 'now or after this week' contract (Checkpoint 7e, item 4.2)", () => {
  it("passes a card that reads as it should, and one without a line", () => {
    expect(nowOrLaterProblems([good, { helps: "12", line: null, fact: null }], want)).toEqual([]);
  });

  it("names each way a line can be wrong", () => {
    const with_ = (over: Partial<NowOrLaterRead> & { text?: string; title?: string | null }): NowOrLaterRead => ({
      helps: over.helps ?? good.helps,
      line: { text: over.text ?? (good.line?.text as string), title: over.title === undefined ? NOW_OR_LATER_TITLE : over.title },
      fact: over.fact === undefined ? good.fact : over.fact,
    });
    expect(nowOrLaterProblems([with_({ text: "Helps you 39 now, 49 later." })], want)).toEqual(["idea 1's line reads “Helps you 39 now, 49 later.”"]);
    expect(nowOrLaterProblems([with_({ helps: "41" })], want)).toEqual(["idea 1's line starts from 39, its Helps you is 41"]);
    expect(nowOrLaterProblems([with_({ text: "Helps you 39 now · 42 if done after this week's games." })], want)).toEqual(["idea 1's line shows 39 and 42, within 3 of each other"]);
    expect(nowOrLaterProblems([with_({ title: null })], want)).toEqual(["idea 1's line has the tooltip “(none)”"]);
    expect(nowOrLaterProblems([with_({ fact: null })], want)).toEqual(["idea 1's words under the later line say “(nothing)”"]);
    expect(nowOrLaterProblems([{ helps: "39", line: null, fact: NOW_OR_LATER_TITLE }], want, () => "the Analyzer's card")).toEqual(["the Analyzer's card explains a later line it doesn't show"]);
  });

  it("the card's own markup passes, read as inPage.ts reads it", () => {
    const card = buildTradeCard({ ...evaluation({ b: 3 }), later: { b: 4, tradeScore: 49 } }, { snapshot: tradeSnapshot() });
    const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };
    const html = renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: () => ({ ok: true as const }) }));
    // The line: a titled paragraph of the card's own (in its Details since Checkpoint 7h), its words without the
    // screen-reader-only parts, whitespace as the page reads it; the words under it carry data-now-or-later-words.
    const p = /<p title="([^"]*)">(.*?)<\/p>/.exec(html);
    if (!p) throw new Error("no titled paragraph on the card");
    const seen = (s: string) => decodeEntities(s.replace(/<span class="sr-only">.*?<\/span>/g, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const fact = /<p data-now-or-later-words="[^"]*"[^>]*>(.*?)<\/p>/.exec(html);
    const read: NowOrLaterRead = { helps: card.numbers.helps.value, line: { text: seen(p[2] as string), title: decodeEntities(p[1] as string) }, fact: fact ? seen(fact[1] as string) : null };
    expect(read.line?.text).toBe("Helps you 39 now · 49 if done after this week's games.");
    expect(nowOrLaterProblems([read], want)).toEqual([]);
  });
});
