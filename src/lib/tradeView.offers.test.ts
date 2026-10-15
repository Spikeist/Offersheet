/**
 * The keys a Trade Finder card's "How to offer it" may not offer, as the page sends them for a card whose search the engine no
 * longer keeps (src/lib/tradeView.ts offersBarredOf; the review of wave D, D-ENG-3 and UI-D-4): the card's Plan B alone,
 * exactly what the engine bars itself while it keeps the search (src/engine/offers.ts ladderJobOfSearch). ⚠️ Not the other
 * cards of its list (the lead's call, wave D, in place of D-ENG-2 and UI-D-2): one can be an offer, which the card labels
 * ("Also shown as trade idea 2.": TradeCard.tsx). Made-up keys.
 */
import { describe, expect, it } from "vitest";
import { ladderJobOfSearch } from "@/engine/offers";
import type { SearchState } from "@/engine/search";
import { defaultTradeSettings } from "@/engine/settings";
import type { TradeEvaluation } from "@/engine/tradeModel";
import { offersBarredOf } from "./tradeView";

const card = (key: string, planB?: string) => ({ key, proposal: { partnerId: "6", give: [], get: [] }, ...(planB ? { planB: { key: planB } } : {}) }) as unknown as TradeEvaluation;

/** A search's state as far as ladderJobOfSearch reads it (nothing evaluated: the job's barred keys are all this reads). */
const state = { I: { sim: null }, settings: defaultTradeSettings(), shownPass: false, versions: new Map(), shownByKey: new Map(), finalByKey: new Map(), getPools: new Map() } as unknown as SearchState;

describe("offersBarredOf (the lead's call, wave D)", () => {
  const a = card("a", "boxA");
  const b = card("b");

  it("the card's Plan B alone (none without one), never another card of its list", () => {
    expect(offersBarredOf(a)).toEqual(["boxA"]);
    expect(offersBarredOf(b)).toEqual([]);
  });

  it("agrees with what the engine bars itself (offers.ts ladderJobOfSearch: the Plan B)", () => {
    for (const x of [a, b]) expect(new Set(offersBarredOf(x))).toEqual(ladderJobOfSearch(state, x).barred);
  });
});
