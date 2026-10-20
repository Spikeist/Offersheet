/**
 * An undone promotion leaves no trace (Checkpoint 7h's second review, offers#3; search.ts, "Promoted Last offers"): a later round
 * can undo a promotion (the promoted card merged into, dropped for or pushed off by another card, so its idea is given back), and
 * then its record goes (MergedCards.promoted, the forced Open in the result's offerOpen, the trade the promotion added to the
 * list), the promoted trade leaves the list's merge and drop records it entered as a card (so it's no filler reference: a
 * trade the list ranks on its own is one of its candidates again), and it's never promoted to again. So MergedCards.promoted
 * names only the promotions the final lists show, each idea merged into its card as its "open", and no pair is both promoted
 * and not promoted. The reviewer's searches (smallLeague: made-up players, placeholder teams; the promote-detail driver's
 * context): 12 (Team 4, at least 10%), 16 (Team 5, Any), 18 (Team 3, Any) and 49 (all teams, Any), where a promotion a later
 * round undid had stayed in `promoted` and was counted as not promoted too, and on 49 made its trade a filler reference that
 * took two ideas off the "Helps both" list; and searches whose promotions stand (5, 8, 4 and 24 at 10%).
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { runTradeSearch } from "./search";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { TradeSearchResult } from "./tradeModel";

const contexts = new Map<number, TradeContext>();
function contextOf(seed: number): TradeContext {
  let ctx = contexts.get(seed);
  if (!ctx) {
    const league = smallLeague(seed, {}, 6);
    ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    contexts.set(seed, ctx);
  }
  return ctx;
}
const searchOf = (seed: number, minChance: number, partnerId: string | null, promoteLastOffers = true): TradeSearchResult =>
  runTradeSearch(contextOf(seed), { settings: { ...defaultTradeSettings(), minChance }, ...(partnerId ? { partnerId } : {}), ...(promoteLastOffers ? {} : { promoteLastOffers: false }) });
const keys = (list: readonly { key: string }[] | undefined): string[] => (list ?? []).map((t) => t.key);

/** MergedCards.promoted names only the promotions the final lists show, never a pair also not promoted. */
function standing(r: TradeSearchResult): void {
  const m = r.merged;
  expect(m?.promoted).toBeDefined();
  for (const p of m?.promoted ?? []) {
    const cards = p.list === "overall" ? r.trades : (r.helpsBoth?.trades ?? []);
    const merged = p.list === "overall" ? m?.overall : m?.helpsBoth;
    expect(keys(cards), p.key).toContain(p.key);
    expect(merged?.find((x) => x.key === p.from), p.from).toEqual({ key: p.from, into: p.key, kind: "open" });
    expect(r.offerOpen?.[p.key]).toBe(p.from);
    expect(m?.notPromoted?.some((n) => n.card === p.from && n.offer === p.key)).toBe(false);
  }
  // Every forced Open the result carries is a standing promotion's.
  for (const [card, from] of Object.entries(r.offerOpen ?? {})) expect(m?.promoted?.some((p) => p.key === card && p.from === from)).toBe(true);
}

describe("an undone promotion leaves no trace (offers#3)", { timeout: 600_000 }, () => {
  it("smallLeague 12, Team 4, at least 10%: the idea given back, the promotion gone, the lists as without promotions", () => {
    const r = searchOf(12, 0.1, "4");
    const off = searchOf(12, 0.1, "4", false);
    standing(r);
    expect(r.merged?.promoted).toEqual([]);
    // The idea it came from is a card again, with its Last offer, not promoted for that reason.
    const from = "4|give:1003,1007|get:1039,1040";
    const offer = "4|give:1003,1007|get:1040";
    expect(keys(r.trades)).toContain(from);
    expect(r.merged?.notPromoted).toContainEqual({ card: from, offer, list: "overall", reason: "released" });
    // The promoted trade, never one of the list's own candidates, leaves its records: no longer merged into another card.
    expect(r.merged?.overall.some((x) => x.key === offer)).toBe(false);
    expect(keys(r.trades)).toEqual(keys(off.trades));
    expect(keys(r.helpsBoth?.trades)).toEqual(keys(off.helpsBoth?.trades));
  });

  it("smallLeague 16, Team 5, Any: likewise", () => {
    const r = searchOf(16, 0, "5");
    const off = searchOf(16, 0, "5", false);
    standing(r);
    expect(r.merged?.promoted).toEqual([]);
    expect(r.merged?.overall.some((x) => x.key === "5|give:1007|get:1054")).toBe(false);
    expect(keys(r.trades)).toEqual(keys(off.trades));
  });

  it("smallLeague 18, Team 3, Any: the promotion whose card was dropped for a better version leaves no trace; the others stand", () => {
    const r = searchOf(18, 0, "3");
    standing(r);
    const p = "3|give:1003|get:1029";
    expect(r.merged?.promoted?.some((x) => x.key === p)).toBe(false);
    expect(r.merged?.dominated?.some((d) => d.key === p)).toBe(false);
    expect(keys(r.trades)).toContain("3|give:1003|get:1027,1029");
    expect((r.merged?.promoted ?? []).length).toBeGreaterThan(0);
  });

  it("smallLeague 49, all teams, Any: the \"Helps both\" list is the one without that promotion (its trade no filler reference)", () => {
    const r = searchOf(49, 0, null);
    const off = searchOf(49, 0, null, false);
    standing(r);
    expect(r.merged?.promoted).toEqual([]);
    expect(r.merged?.helpsBoth.some((x) => x.key === "6|give:1008,1012|get:1062")).toBe(false);
    expect(keys(r.helpsBoth?.trades)).toEqual(keys(off.helpsBoth?.trades));
    expect(keys(r.trades)).toEqual(keys(off.trades));
  });

  it("the promotions that stand are as before: 5, 8, 4 and 24 at 10%", () => {
    for (const seed of [5, 8, 4, 24]) {
      const r = searchOf(seed, 0.1, null);
      standing(r);
      expect((r.merged?.promoted ?? []).length, `smallLeague ${seed}`).toBeGreaterThan(0);
    }
  });
});
