/**
 * An undone promotion leaves no trace (Checkpoint 7h's second review, offers#3; search.ts, "Promoted Last offers"): a later round
 * can undo a promotion (the promoted card merged into, dropped for or pushed off by another card, so its idea is given back), and
 * then its record goes (MergedCards.promoted, the forced Open in the result's offerOpen, the trade the promotion added to the
 * list), the promoted trade leaves the list's merge and drop records it entered as a card (so it's no filler reference: a
 * trade the list ranks on its own is one of its candidates again), and it's never promoted to again. So MergedCards.promoted
 * names only the promotions the final lists show, each idea merged into its card as its "open", and no pair is both promoted
 * and not promoted on a list (the same pair on the other list is that list's own: each list has its own promotions). The
 * reviewer's searches (smallLeague: made-up players, placeholder teams; the promote-detail driver's context): 12 (Team 4, at
 * least 10%), 16 (Team 5, Any), 18 (Team 3, Any) and 49 (all teams, Any), where a promotion a later round undid had stayed in
 * `promoted` and was counted as not promoted too, and on 49 made its trade a filler reference that took two ideas off the
 * "Helps both" list; searches whose promotions stand (5, 8, 4 and 24 at 10%, as Checkpoint 7h's first build had them); and the
 * rule itself (undonePromotions) on made-up records, a chain of promotions whose newest one is undone among them (none of 620
 * synthetic searches scanned for it undid a chain).
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { runTradeSearch, undonePromotions } from "./search";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { MergedTrade, PromotedTrade, TradeSearchResult } from "./tradeModel";

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

/** MergedCards.promoted names only the promotions the final lists show, never a pair also not promoted on its list. */
function standing(r: TradeSearchResult): void {
  const m = r.merged;
  expect(m?.promoted).toBeDefined();
  for (const p of m?.promoted ?? []) {
    const cards = p.list === "overall" ? r.trades : (r.helpsBoth?.trades ?? []);
    const merged = p.list === "overall" ? m?.overall : m?.helpsBoth;
    expect(keys(cards), p.key).toContain(p.key);
    expect(merged?.find((x) => x.key === p.from), p.from).toEqual({ key: p.from, into: p.key, kind: "open" });
    expect(r.offerOpen?.[p.key]).toBe(p.from);
    expect(m?.notPromoted?.some((n) => n.list === p.list && n.card === p.from && n.offer === p.key)).toBe(false);
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

  it("smallLeague 18, Team 3, Any: the promotion whose card was dropped for a better version leaves no trace; the others, a chain among them, stand", () => {
    const r = searchOf(18, 0, "3");
    standing(r);
    const p = "3|give:1003|get:1029";
    expect(r.merged?.promoted?.some((x) => x.key === p)).toBe(false);
    expect(r.merged?.dominated?.some((d) => d.key === p)).toBe(false);
    expect(keys(r.trades)).toContain("3|give:1003|get:1027,1029");
    // The four that stand, as Checkpoint 7h's first build named them; of its chain (3|give:1008|get:1027,1032 promoted to
    // 3|give:1008|get:1027, promoted in turn to 3|give:1008,1011|get:1027) only the newest, its first idea left out for good.
    const promoted: PromotedTrade[] = [
      { key: "3|give:1002|get:1028", from: "3|give:1002|get:1027,1028", list: "overall", kind: "smaller" },
      { key: "3|give:1002|get:1029", from: "3|give:1002|get:1027,1029", list: "overall", kind: "smaller" },
      { key: "3|give:1008,1011|get:1027", from: "3|give:1008|get:1027", list: "overall", kind: "throwIn" },
      { key: "3|give:1003|get:1028", from: "3|give:1003|get:1027,1028", list: "overall", kind: "smaller" },
    ];
    expect(r.merged?.promoted).toEqual(promoted);
    expect(r.merged?.superseded).toBe(1);
    expect(keys(r.trades)).not.toContain("3|give:1008|get:1027,1032");
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

  it("the promotions that stand are as before: 5, 8, 4 and 24 at 10% (Checkpoint 7h's first build's records)", () => {
    const before: Record<number, PromotedTrade[]> = {
      5: [{ key: "3|give:1005,1012|get:1036", from: "3|give:1005,1012|get:1030,1036", list: "overall", kind: "smaller" }],
      8: [{ key: "4|give:1005,1011|get:1043", from: "4|give:1005|get:1043", list: "overall", kind: "throwIn" }],
      4: [{ key: "6|give:1004,1005|get:1065,1068", from: "6|give:1005|get:1065,1068", list: "helpsBoth", kind: "throwIn" }],
      24: [
        { key: "4|give:1011|get:1048", from: "4|give:1011|get:1040,1048", list: "helpsBoth", kind: "smaller" },
        { key: "3|give:1007,1011|get:1031,1032", from: "3|give:1007|get:1031,1032", list: "helpsBoth", kind: "throwIn" },
      ],
    };
    for (const seed of [5, 8, 4, 24]) {
      const r = searchOf(seed, 0.1, null);
      standing(r);
      expect(r.merged?.promoted, `smallLeague ${seed}`).toEqual(before[seed]);
    }
  });
});

describe("undonePromotions: which promotions a later round undid, on one list's records (offers#3)", () => {
  const promotions = (...pairs: [key: string, from: string][]): Map<string, Pick<PromotedTrade, "key" | "from">> => new Map(pairs.map(([key, from]) => [key, { key, from }]));
  const merges = (...rows: [key: string, into: string, kind: MergedTrade["kind"]][]): Map<string, Pick<MergedTrade, "into" | "kind">> => new Map(rows.map(([key, into, kind]) => [key, { into, kind }]));

  it("a promotion stands while the idea it came from is merged into its card as its Open", () => {
    expect(undonePromotions(promotions(["P", "O"]), merges(["O", "P", "open"]))).toEqual({ undo: [], back: [] });
  });

  it("one whose idea was given back, or is held by another card (the promoted card merged into, dropped for or pushed off by another), is undone", () => {
    expect(undonePromotions(promotions(["P", "O"]), merges())).toEqual({ undo: ["P"], back: [] });
    expect(undonePromotions(promotions(["P", "O"]), merges(["O", "K", "then"], ["P", "K", "open"]))).toEqual({ undo: ["P"], back: [] });
    // Merged into its card as another offer than its forced Open (never, but not the promotion's mark).
    expect(undonePromotions(promotions(["P", "O"]), merges(["O", "P", "then"]))).toEqual({ undo: ["P"], back: [] });
  });

  it("a chain stands while its newest promotion does, its first idea left out for good or held by a card above", () => {
    // O promoted to P, P promoted in turn to Q: P merged into Q as its Open; O left out for good, or held by a card K above it.
    const chain = promotions(["P", "O"], ["Q", "P"]);
    expect(undonePromotions(chain, merges(["P", "Q", "open"]), new Set(["O"]))).toEqual({ undo: [], back: [] });
    expect(undonePromotions(chain, merges(["P", "Q", "open"], ["O", "K", "last"]))).toEqual({ undo: [], back: [] });
  });

  it("a chain whose newest promotion is undone is undone whole, and the idea it left out for good comes back", () => {
    const chain = promotions(["P", "O"], ["Q", "P"]);
    // Q merged into another card or pushed off: P given back (no record), or held by a card above.
    expect(undonePromotions(chain, merges(), new Set(["O"]))).toEqual({ undo: ["P", "Q"], back: ["O"] });
    expect(undonePromotions(chain, merges(["P", "K", "then"], ["Q", "K", "open"]), new Set(["O"]))).toEqual({ undo: ["P", "Q"], back: ["O"] });
    // Its first idea held by a card above stays where it is (merged there, not left out).
    expect(undonePromotions(chain, merges(["O", "K", "last"]))).toEqual({ undo: ["P", "Q"], back: [] });
  });

  it("three links, and other promotions on the list, each on its own", () => {
    const records = promotions(["P", "O"], ["Q", "P"], ["R", "Q"], ["B", "A"], ["D", "C"]);
    // R stands (Q merged into it as its Open), so Q and P do; B stands; D's idea was given back.
    expect(undonePromotions(records, merges(["Q", "R", "open"], ["A", "B", "open"]), new Set(["O", "P"]))).toEqual({ undo: ["D"], back: [] });
    // R undone: the whole chain is, and both ideas it left out come back.
    expect(undonePromotions(records, merges(["A", "B", "open"]), new Set(["O", "P"]))).toEqual({ undo: ["P", "Q", "R", "D"], back: ["O", "P"] });
  });
});
