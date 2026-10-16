/**
 * Preferring the version on the list (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(b): "When more than one version
 * meets a step's rules, prefer the one that's on the list, so it merges."; the lead's D7–D13; search.ts preferredOf and the
 * merge's top-down loop, offers.ts "Preferring the cards of its lists"): which versions a card prefers (preferredOf on made-up
 * cards: below it, not taken, not given back, leaves only, the other list's when it's on it, the cross-list guard), the
 * preferring ladder kept only when it holds more of them (smallLeague 24 and 12-team 1, where it does, and smallLeague 4 and 42,
 * where it would only move a listed version up to the Open and is set aside), the step's own order among listed versions
 * (12-team 1's lean "Helps both" pair merges as the Open), the worker's fallback with the preference the search recorded equal to
 * the kept ladder (and not without it), the cache key, the result's offerPrefer, and the switch. Synthetic leagues
 * (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds show what is a fact of the synthetic data,
 * found on this tree.
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { choiceOffers, heldOf, ladderChoicesOf, ladderJobOfSearch, offerLadderOfProposal, offerLadderOfSearch, preferKey } from "./offers";
import { preferredOf, runRefilter, runTradeSearch, searchStateOf, type PreferInputs, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeEvaluation, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });

const contexts = new Map<string, TradeContext>();
function contextOf(seed: number, teams: number): TradeContext {
  const key = `${seed}|${teams}`;
  let ctx = contexts.get(key);
  if (!ctx) {
    const league = smallLeague(seed, {}, teams);
    ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
    contexts.set(key, ctx);
  }
  return ctx;
}
const freshContext = (seed: number, teams: number): TradeContext => {
  const league = smallLeague(seed, {}, teams);
  return buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
};
const searches = new Map<string, TradeSearchResult>();
function search(seed: number, teams: number, minChance: number, extra: { preferListed?: boolean } = {}): TradeSearchResult {
  const key = `${seed}|${teams}|${minChance}|${JSON.stringify(extra)}`;
  let r = searches.get(key);
  if (!r) {
    r = runTradeSearch(contextOf(seed, teams), { settings: at(minChance), ...extra });
    searches.set(key, r);
  }
  return r;
}
const cardsOf = (r: TradeSearchResult): TradeEvaluation[] => [...new Map([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => [t.key, t])).values()];
const strip = (l: unknown) => JSON.stringify(l, (k, v) => (k === "ms" ? undefined : v));

/** A made-up card: its key, B and P_complete (Overall order: EG = B × P, then the key), Helps you and Helps them. */
function card(key: string, b: number, p: number, helpsThem: number | null = null): TradeEvaluation {
  return { key, b, pComplete: p, tradeScore: 50, them: helpsThem === null ? undefined : { helps: helpsThem }, proposal: { partnerId: "4", give: [], get: [] } } as unknown as TradeEvaluation;
}

describe("preferredOf (made-up cards)", () => {
  // Overall order: a (EG 0.5) > b (0.4) > c (0.3) > d (0.2) > e (0.1).
  const a = card("a", 1, 0.5, 20);
  const b = card("b", 1, 0.4, 20);
  const c = card("c", 1, 0.3, 0);
  const d = card("d", 1, 0.2, 20);
  const e = card("e", 1, 0.1, 0);
  const cards = [a, b, c, d, e];
  const all = (_card: TradeEvaluation, pool: readonly TradeEvaluation[]) => pool.map((n) => n.key);
  const base: PreferInputs = { card: b, cards, other: [], holders: new Set(), taken: new Set(), released: new Set(), overallList: false, feasible: all };
  const of = (x: Partial<PreferInputs>) => [...preferredOf({ ...base, ...x })].sort();

  it("the cards of its list below it on Overall, feasible, that no card above it took this round and its list didn't give back, leaves only", () => {
    expect(of({})).toEqual(["c", "d", "e"]);
    expect(of({ card: a })).toEqual(["b", "c", "d", "e"]);
    expect(of({ card: e })).toEqual([]);
    expect(of({ taken: new Set(["c"]) })).toEqual(["d", "e"]);
    expect(of({ released: new Set(["d"]) })).toEqual(["c", "e"]);
    // A card that holds merged trades isn't a leaf (preferring it would break its plan up: the file header).
    expect(of({ holders: new Set(["c", "e"]) })).toEqual(["d"]);
    // Only the feasible ones (ladderNeighbors and offerFeasible on both printed numbers).
    expect(of({ feasible: (_k, pool) => pool.filter((n) => n.key === "d").map((n) => n.key) })).toEqual(["d"]);
  });

  it("a card on the other list prefers that list's cards below it too, leaves only", () => {
    const x = card("x", 1, 0.25, 20);
    const y = card("y", 1, 0.45, 20);
    expect(of({ other: [b, x, y] })).toEqual(["c", "d", "e", "x"]);
    expect(of({ other: [b, x, y], holders: new Set(["x"]) })).toEqual(["c", "d", "e"]);
    // Not on the other list: none of its cards.
    expect(of({ other: [x, y] })).toEqual(["c", "d", "e"]);
  });

  it("the cross-list guard: while the Overall list is merged, a card that helps both but isn't on the \"Helps both\" list's first ranking prefers no version that helps both", () => {
    // b helps both (Helps you 50, Helps them 20); d helps both, c and e don't.
    expect(of({ overallList: true, other: [] })).toEqual(["c", "e"]);
    // b on the "Helps both" list from the start: no guard.
    expect(of({ overallList: true, other: [b] })).toEqual(["c", "d", "e"]);
    // Merging the "Helps both" list: no guard.
    expect(of({ overallList: false, other: [] })).toEqual(["c", "d", "e"]);
    // A card that doesn't help both: no guard.
    const plain = card("p", 1, 0.45, 0);
    expect(of({ card: plain, cards: [plain, c, d, e], overallList: true, other: [] })).toEqual(["c", "d", "e"]);
  });
});

describe("the preferring ladder, kept only when it holds more of the preferred versions", { timeout: 900_000 }, () => {
  it("smallLeague 24 (10%) and 12-team 1 (Any): every card with a preference keeps the ladder that holds more of them, and some keep the preferring one (facts of the synthetic data)", () => {
    let preferring = 0;
    let usual = 0;
    for (const [seed, teams, minChance] of [
      [24, 6, 0.1],
      [1, 12, 0],
    ] as const) {
      const r = search(seed, teams, minChance);
      const st = searchStateOf(r) as SearchState;
      for (const c of cardsOf(r)) {
        const prefer = st.prefers?.get(c.key);
        if (!prefer) continue;
        const job = ladderJobOfSearch(st, c, prefer);
        const both = ladderChoicesOf(job);
        const kept = job.store.choices?.get(`${minChance}|${c.key}|${preferKey(prefer)}`);
        expect(kept, c.key).toBeDefined();
        const w = `${seed} ${c.key}`;
        if (kept?.preferred) {
          preferring++;
          expect(heldOf(both.preferring, prefer), w).toBeGreaterThan(heldOf(both.usual, prefer));
          expect(choiceOffers(kept)).toEqual(choiceOffers(both.preferring));
        } else {
          usual++;
          expect(heldOf(both.preferring, prefer), w).toBeLessThanOrEqual(heldOf(both.usual, prefer));
          expect(choiceOffers(kept ?? null)).toEqual(choiceOffers(both.usual));
        }
        // The preference holds only cards of its lists below it on Overall.
        const listed = new Map(cardsOf(r).map((t) => [t.key, t]));
        for (const k of prefer) {
          const n = listed.get(k) ?? (st.shownByKey.get(k) as TradeEvaluation | undefined);
          expect(n, `${w} prefers ${k}`).toBeDefined();
        }
      }
    }
    expect(preferring).toBeGreaterThan(0);
    expect(usual).toBeGreaterThanOrEqual(0);
  });

  it("smallLeague 4 and 42 (10%): the usual ladder holds the listed version as a Then; preferring it would make it the Open and drop the Open before it, holding no more, so the usual ladder stays (the lead's D9)", () => {
    for (const [seed, cardKey, listedKey] of [
      [4, "5|give:1004,1012|get:1052", "5|give:1012|get:1052"],
      [42, "2|give:1007,1011|get:1016,1024", "2|give:1007,1011|get:1014"],
    ] as const) {
      const r = search(seed, 6, 0.1);
      const st = searchStateOf(r) as SearchState;
      const c = cardsOf(r).find((t) => t.key === cardKey);
      if (!c) throw new Error(`smallLeague ${seed} no longer shows ${cardKey}: find another card`);
      const prefer = st.prefers?.get(cardKey);
      expect(prefer && [...prefer]).toEqual([listedKey]);
      const { usual, preferring } = ladderChoicesOf(ladderJobOfSearch(st, c, prefer));
      expect(choiceOffers(usual).find((o) => o.key === listedKey)?.kind).toBe("then");
      expect(choiceOffers(preferring)).toEqual([{ key: listedKey, kind: "open" }]);
      expect(choiceOffers(usual).length).toBeGreaterThan(choiceOffers(preferring).length);
      expect((offerLadderOfSearch(r, cardKey) as OfferLadder).steps.map((s) => s.evaluation.key)).toEqual([...choiceOffers(usual).filter((o) => o.kind !== "last").map((o) => o.key), cardKey, ...choiceOffers(usual).filter((o) => o.kind === "last").map((o) => o.key)]);
    }
  });

  it("12-team 1 (Any): the lean \"Helps both\" pair merges, the lean one the bigger one's Open, where without the preference both stay with a label (Checkpoint 7f's shape (ii))", () => {
    const big = "9|give:1004,1011|get:1098,1100";
    const lean = "9|give:1004|get:1098,1100";
    const r = search(1, 12, 0);
    expect(r.merged?.helpsBoth).toContainEqual({ key: lean, into: big, kind: "open" });
    expect((r.helpsBoth?.trades ?? []).map((t) => t.key)).not.toContain(lean);
    const plain = search(1, 12, 0, { preferListed: false });
    const keys = (plain.helpsBoth?.trades ?? []).map((t) => t.key);
    expect(keys).toContain(big);
    expect(keys).toContain(lean);
    // The lean one's ladder holds the big one (the label), the big one's doesn't hold the lean one.
    const of = (res: TradeSearchResult, key: string) => (offerLadderOfSearch(res, key) as OfferLadder).steps.filter((s) => s.kind !== "suggested").map((s) => s.evaluation.key);
    expect(of(plain, big)).not.toContain(lean);
    expect(of(plain, lean)).toContain(big);
  });
});

describe("the worker's fallback, the cache and the switch", { timeout: 900_000 }, () => {
  it("each card's ladder from its trade on a context of its own, with the preference its search recorded, is the kept one; without it, smallLeague 24's and 12-team 1's preferring ladders differ", () => {
    let withPrefer = 0;
    let needed = 0;
    for (const [seed, teams, minChance] of [
      [24, 6, 0.1],
      [1, 12, 0],
    ] as const) {
      const r = search(seed, teams, minChance);
      const st = searchStateOf(r) as SearchState;
      for (const c of cardsOf(r)) {
        const prefer = st.prefers?.get(c.key);
        if (!prefer) continue;
        withPrefer++;
        const kept = strip(offerLadderOfSearch(r, c.key));
        expect(strip(offerLadderOfProposal(freshContext(seed, teams), c.proposal, { settings: at(minChance), page: "finder", prefer })), c.key).toBe(kept);
        // The result names it for the page (TradeSearchResult.offerPrefer, sorted).
        expect(r.offerPrefer?.[c.key]).toEqual([...prefer].sort());
        if (strip(offerLadderOfProposal(freshContext(seed, teams), c.proposal, { settings: at(minChance), page: "finder" })) !== kept) needed++;
      }
    }
    expect(withPrefer).toBeGreaterThan(0);
    expect(needed).toBeGreaterThan(0);
  });

  it("a re-filter to another minimum and back reads the same choices, the preference in their key, and equals a fresh search", () => {
    const r = search(24, 6, 0.1);
    const st = searchStateOf(r) as SearchState;
    const there = runRefilter(contextOf(24, 6), st, { minChance: 0 });
    expect(there).toEqual(runTradeSearch(contextOf(24, 6), { settings: at(0) }));
    const back = runRefilter(contextOf(24, 6), searchStateOf(there) as SearchState, { minChance: 0.1 });
    expect(back).toEqual(r);
    expect(searchStateOf(back)?.prefers).toEqual(st.prefers);
    for (const [key, prefer] of st.prefers ?? new Map<string, ReadonlySet<string>>()) {
      const c = cardsOf(r).find((t) => t.key === key) as TradeEvaluation;
      const choices = ladderJobOfSearch(st, c, prefer).store.choices;
      expect(choices?.has(`0.1|${key}|${preferKey(prefer)}`), key).toBe(true);
      expect(preferKey(prefer)).not.toBe("");
    }
  });

  it("with the switch off (TradeSearchOptions.preferListed false) no card has a preference and the result names none", () => {
    for (const [seed, teams, minChance] of [
      [24, 6, 0.1],
      [1, 12, 0],
    ] as const) {
      const r = search(seed, teams, minChance, { preferListed: false });
      expect(r.offerPrefer).toBeUndefined();
      expect(searchStateOf(r)?.prefers?.size ?? 0).toBe(0);
    }
  });
});
