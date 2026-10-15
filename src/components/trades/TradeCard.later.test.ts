/**
 * A trade card's "now or after this week" line (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.2): "Helps you 37 now · 41
 * if done after this week's games." right under the three numbers (after the veto note, before the odds), the planner's tooltip
 * on it, and the same words among the card's facts, which a phone shows (no hover there). None when the card has no line. The
 * feedback buttons are stood in for (TradePages.test.ts has them). A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NOW_OR_LATER_LABEL, NOW_OR_LATER_TITLE, buildTradeCard, type CardFeedback } from "@/lib/tradeView";

vi.mock("./FeedbackControls", () => ({ FeedbackControls: () => null }));

const { TradeCard } = await import("./TradeCard");
const { evaluation, tradeSnapshot } = await import("./testFixtures");

const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };
const render = (card: ReturnType<typeof buildTradeCard>) => renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: () => ({ ok: true as const }) }));
/** The markup's text, tags stripped and entities read back. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\u00a0/g, " ");

describe("a trade card's 'now or after this week' line (Checkpoint 7e, item 4.2)", () => {
  it("sits under the three numbers with the planner's tooltip, its words among the facts too", () => {
    const e = { ...evaluation({ b: 3, dCH: 0.013, dPO: 0.04, detail: { vetoRisk: true } }), pComplete: 0.2, later: { b: 4, tradeScore: 49 } };
    const card = buildTradeCard(e, { snapshot: tradeSnapshot({ tradeReview: "league_vote" }), baseline: { pPlayoffs: 0.65, pTitle: 0.121 } });
    expect(card.nowOrLater?.text).toBe("Helps you 39 now · 49 if done after this week's games.");
    const html = render(card);
    const titled = `title="${NOW_OR_LATER_TITLE.replace(/'/g, "&#x27;")}"`;
    expect(html).toContain(titled);
    const line = html.slice(html.indexOf(">", html.indexOf(titled)) + 1);
    expect(text(line.slice(0, line.indexOf("</p>")))).toBe("Helps you 39 now · , 49 if done after this week's games.");
    // After the numbers and the veto note, before my odds.
    const at = (s: string) => html.indexOf(s);
    expect(at(titled)).toBeGreaterThan(at("</dl>"));
    expect(at(titled)).toBeGreaterThan(at("it goes through"));
    expect(at(titled)).toBeLessThan(at("Title odds"));
    // The tooltip's words where a phone shows them: the card's facts.
    expect(text(html)).toContain(`${NOW_OR_LATER_LABEL}${NOW_OR_LATER_TITLE}`);
  });

  it("shows nothing without a line", () => {
    const card = buildTradeCard({ ...evaluation({ b: 3 }), later: { b: 3.2, tradeScore: 41 } }, { snapshot: tradeSnapshot() });
    expect(card.nowOrLater).toBeNull();
    const html = render(card);
    expect(html).not.toContain("if done after this week");
    expect(html).not.toContain(NOW_OR_LATER_LABEL);
  });
});
