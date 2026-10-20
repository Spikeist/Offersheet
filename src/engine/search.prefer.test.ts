/**
 * Preferring the version on the list (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(b): "When more than one version
 * meets a step's rules, prefer the one that's on the list, so it merges."; the lead's D7–D13; search.ts preferredOf and the
 * merge's top-down loop, offers.ts "Preferring the cards of its lists"): which versions a card prefers (preferredOf on made-up
 * cards: below it, not taken, not given back, on either list since the final review's E3, leaves only, the other list's when
 * it's on it, the cross-list guard; on whole searches each below its card as printed and a card of a list or merged into one),
 * the preferring ladder kept only when it holds more of them (smallLeague 24 and 12-team 1, where it does, and smallLeague 4 and 42,
 * where it would only move a listed version up to the Open and is set aside), the step's own order among listed versions
 * (12-team 1's lean "Helps both" pair merges as the Open), the worker's fallback with the preference the search recorded equal to
 * the kept ladder (and not without it), the cache key, the result's offerPrefer, and the switch. Synthetic leagues
 * (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds show what is a fact of the synthetic data,
 * found on this tree.
 */
import { describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { choiceOffers, heldOf, ladderChoicesOf, ladderJobOfSearch, offerLadderOfProposal, offerLadderOfSearch, preferKey } from "./offers";
import { compareOverall } from "./rank";
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

  it("never a trade a card above it took this round or its list gave back, whichever list it's on (the final review, E3)", () => {
    // x on both lists (and y on the other only), below b.
    const x = card("x", 1, 0.25, 20);
    const y = card("y", 1, 0.15, 20);
    const both = { cards: [...cards, x], other: [b, x, y] };
    expect(of(both)).toEqual(["c", "d", "e", "x", "y"]);
    // A card above b took x this round: x isn't preferred through either list.
    expect(of({ ...both, taken: new Set(["x"]) })).toEqual(["c", "d", "e", "y"]);
    // b's list gave x back: likewise.
    expect(of({ ...both, released: new Set(["x"]) })).toEqual(["c", "d", "e", "y"]);
    // On the other list only, the same.
    expect(of({ other: [b, x, y], taken: new Set(["x"]) })).toEqual(["c", "d", "e", "y"]);
    expect(of({ other: [b, x, y], released: new Set(["y"]) })).toEqual(["c", "d", "e", "x"]);
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
        // The preference holds only versions below the card on Overall as printed (preferredOf's `below`: compareOverall on the
        // numbers both print), each a card of a list or a trade merged into one by the end (never a Plan B box or a trade no list
        // holds: a fact of the synthetic data on these searches, since a preferred card the ladder doesn't take can leave later
        // under the usual rules; the final review, merge-b-test-below-unpinned).
        const cards = cardsOf(r);
        const merged = [...(r.merged?.overall ?? []), ...(r.merged?.helpsBoth ?? [])];
        for (const k of prefer) {
          const n = st.shownByKey.get(k) as TradeEvaluation | undefined;
          expect(n, `${w} prefers ${k}`).toBeDefined();
          expect(compareOverall(c, n as TradeEvaluation), `${w} prefers ${k}, below it`).toBeLessThan(0);
          const held = cards.some((t) => t.key === k) || merged.some((m) => m.key === k && cards.some((t) => t.key === m.into));
          expect(held, `${w} prefers ${k}: a card or a trade merged into one`).toBe(true);
        }
      }
    }
    // Both ladders are kept somewhere (facts of the synthetic data): a preferring one, and the usual one beside a preference.
    expect(preferring).toBeGreaterThan(0);
    expect(usual).toBeGreaterThan(0);
  });

  it("smallLeague 4 and 42 (10%): the usual ladder holds the listed version as a Then; preferring it would make it the Open and drop the Open before it, holding no more, so the usual ladder stays (the lead's D9)", () => {
    // ⚠️ Since Checkpoint 7h the preference is narrowed (config.offers.preferWithinHelps; offers.ts narrowedPick): on smallLeague
    // 4 the listed version prints Helps you 64 against the usual Open's 67, within 3, so preferring it still makes it the Open
    // (D9 keeps the usual ladder); on 42 it prints 78 against 82, more than 3 under, so the preferring ladder is the usual one.
    // The D9 rule is pinned at Checkpoint 7g's unnarrowed preference (preferWithinHelps without bound), both leagues.
    const within = config.offers as { preferWithinHelps: number };
    const original = within.preferWithinHelps;
    for (const [seed, cardKey, listedKey, narrowed] of [
      [4, "5|give:1004,1012|get:1052", "5|give:1012|get:1052", false],
      [42, "2|give:1007,1011|get:1016,1024", "2|give:1007,1011|get:1014", true],
    ] as const) {
      const r = search(seed, 6, 0.1);
      const st = searchStateOf(r) as SearchState;
      const c = cardsOf(r).find((t) => t.key === cardKey);
      if (!c) throw new Error(`smallLeague ${seed} no longer shows ${cardKey}: find another card`);
      const prefer = st.prefers?.get(cardKey);
      expect(prefer && [...prefer]).toEqual([listedKey]);
      try {
        within.preferWithinHelps = Number.POSITIVE_INFINITY;
        const { usual, preferring } = ladderChoicesOf(ladderJobOfSearch(st, c, prefer));
        expect(choiceOffers(usual).find((o) => o.key === listedKey)?.kind).toBe("then");
        expect(choiceOffers(preferring)).toEqual([{ key: listedKey, kind: "open" }]);
        expect(choiceOffers(usual).length).toBeGreaterThan(choiceOffers(preferring).length);
      } finally {
        within.preferWithinHelps = original;
      }
      const { usual, preferring } = ladderChoicesOf(ladderJobOfSearch(st, c, prefer));
      if (narrowed) expect(choiceOffers(preferring)).toEqual(choiceOffers(usual));
      else expect(choiceOffers(preferring)).toEqual([{ key: listedKey, kind: "open" }]);
      expect((offerLadderOfSearch(r, cardKey) as OfferLadder).steps.map((s) => s.evaluation.key)).toEqual([...choiceOffers(usual).filter((o) => o.kind !== "last").map((o) => o.key), cardKey, ...choiceOffers(usual).filter((o) => o.kind === "last").map((o) => o.key)]);
    }
  });

  it("12-team 1 (Any): the lean \"Helps both\" pair merges, the lean one the bigger one's Open, where without the preference both stay with a label (Checkpoint 7f's shape (ii)); since Checkpoint 7h's narrowing it doesn't (the lean one prints 68, more than 3 under the usual Open's 73)", () => {
    const big = "9|give:1004,1011|get:1098,1100";
    const lean = "9|give:1004|get:1098,1100";
    const within = config.offers as { preferWithinHelps: number };
    const original = within.preferWithinHelps;
    let unnarrowed: TradeSearchResult;
    try {
      within.preferWithinHelps = Number.POSITIVE_INFINITY;
      unnarrowed = runTradeSearch(freshContext(1, 12), { settings: at(0) });
    } finally {
      within.preferWithinHelps = original;
    }
    expect(unnarrowed.merged?.helpsBoth).toContainEqual({ key: lean, into: big, kind: "open" });
    expect((unnarrowed.helpsBoth?.trades ?? []).map((t) => t.key)).not.toContain(lean);
    // Narrowed (Checkpoint 7h, answer 4): the big one's usual Open, 9|give:1004,1011|get:1101,1108, prints Helps you 73, the
    // lean one 68, more than config.offers.preferWithinHelps under it, so the big one opens with the usual Open and both stay.
    const r = search(1, 12, 0);
    expect(r.merged?.helpsBoth ?? []).not.toContainEqual({ key: lean, into: big, kind: "open" });
    const rKeys = (r.helpsBoth?.trades ?? []).map((t) => t.key);
    expect(rKeys).toContain(big);
    expect(rKeys).toContain(lean);
    const bigOpen = (offerLadderOfSearch(r, big) as OfferLadder).steps.find((s) => s.kind === "open");
    expect(bigOpen?.evaluation.key).toBe("9|give:1004,1011|get:1101,1108");
    const leanPrinted = (searchStateOf(r) as SearchState).shownByKey.get(lean) as TradeEvaluation;
    expect((bigOpen?.evaluation.tradeScore as number) - (leanPrinted.tradeScore as number)).toBeGreaterThan(config.offers.preferWithinHelps);
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
