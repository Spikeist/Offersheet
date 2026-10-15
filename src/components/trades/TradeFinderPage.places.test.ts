/**
 * The Trade Finder gives every card the list's places (the lead's call for Checkpoint 7e's wave D: an offer of "How to offer it"
 * can be another card of its list, and then says so, "Also shown as trade idea 2.": TradeCard's `places`): the same map for
 * each card, every card's key with its place in the sort shown (1 = first), so a re-sort moves the numbers with the cards.
 * TradeCard is stood in for, to hold the props the list gives it (TradeCard.offers.test.ts renders the line). A made-up league.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TradeCardProps } from "./TradeCard";

/** The props each card got, in the order the list rendered them. */
const given: TradeCardProps[] = [];

vi.mock("./TradeCard", () => ({
  TradeCard: (props: TradeCardProps) => {
    given.push(props);
    return null;
  },
}));

const { FinderFrame } = await import("./TradeFinderPage");
const { buildFinderView } = await import("@/lib/tradeView");
const { evaluation, searchResult, tradeSnapshot } = await import("./testFixtures");

describe("the Trade Finder's cards get the list's places (the lead's call, wave D)", () => {
  it("each card the same map, every card's key with its place in the sort shown", () => {
    const snapshot = tradeSnapshot();
    // Overall: b (EG 1.8), a (1.5), c (0.8); Chance they accept: a (50%), c (40%), b (30%).
    const trades = [evaluation({ key: "a", b: 3, pComplete: 0.5 }), evaluation({ key: "b", b: 6, pComplete: 0.3, give: ["105"] }), evaluation({ key: "c", b: 2, pComplete: 0.4, give: ["108"] })];
    const orders = new Set<string>();
    for (const sort of ["overall", "helps", "accept"] as const) {
      given.length = 0;
      const view = buildFinderView({ result: searchResult(trades), sort, snapshot, partnerId: null });
      renderToStaticMarkup(createElement(FinderFrame, { state: { kind: "done", view }, teamName: "Moonbeam Mudcats", controls: null, records: [], leagueKey: "espn:0000abcd", onFeedback: () => ({ ok: true as const }) }));
      const keys = view.cards.map((c) => c.key);
      orders.add(keys.join(","));
      expect(given.map((p) => p.card.key), sort).toEqual(keys);
      for (const p of given) expect([...(p.places ?? new Map<string, number>())], `${sort} ${p.card.key}`).toEqual(keys.map((k, i) => [k, i + 1]));
    }
    // The sorts gave the cards other places (a fact of these made-up numbers): the map followed them.
    expect(orders.size).toBeGreaterThan(1);
  });
});
